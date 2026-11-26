// Claude 호출은 전부 여기서. 실패해도 null을 돌려줄 뿐 예외를 던지지 않는다 (앱이 죽으면 안 됨)
const Anthropic = require("@anthropic-ai/sdk");
const pool = require("../db");

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
const MODEL = process.env.AI_MODEL || "claude-haiku-5-5";
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

// 모델 출력에서 JSON 객체만 꺼낸다 (```json 펜스나 앞뒤 설명이 붙어도 OK)
function parseJson(text) {
  const m = text && text.match(/\{[\s\S]*\}/);
  try {
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
}

// 공통 호출 + ai_logs 기록. json=true면 파싱 결과(실패 시 null), 아니면 텍스트
async function call({ feature, userId, memoId = null, system, input, json = true, maxTokens = 1024 }) {
  let text = null;
  let tokens = null;
  let result = null;
  try {
    if (!client) throw new Error("ANTHROPIC_API_KEY가 설정되지 않았어요");
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: input }],
    });
    text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    tokens = (msg.usage?.input_tokens || 0) + (msg.usage?.output_tokens || 0);
    result = json ? parseJson(text) : text || null;
  } catch (err) {
    text = `ERROR: ${err.message}`;
    console.error(`[ai:${feature}]`, redact(err.message));
  }
  await log(userId, memoId, feature, input, text, tokens, result !== null);
  return result;
}

// 에러 메시지에 섞여 오는 키 조각 가리기 (로그·DB에 키 금지)
const redact = (m) => String(m).replace(/(sk-|Bearer\s+)[\w*.-]+/gi, "$1***");

// ai_logs 기록 (실패해도 무시)
function log(userId, memoId, feature, input, output, tokens, success, toolName = null) {
  output = output && redact(output);
  return pool
    .query(
      "INSERT INTO ai_logs (user_id, memo_id, feature, tool_name, input_text, output_text, tokens, success) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [userId, memoId, feature, toolName, String(input).slice(0, 60000), output, tokens, success],
    )
    .catch((e) => console.error("[ai_logs]", e.message));
}

// ---------- OpenAI 음성 (SDK 없이 fetch). 키가 없거나 실패하면 null ----------
const OPENAI = "https://api.openai.com/v1/audio";
const openaiHeaders = () => ({ Authorization: `Bearer ${process.env.OPENAI_API_KEY}` });

// 강의 녹음 조각 → 텍스트 (gpt-4o-mini-transcribe, 분당 $0.003). prompt = 앞 조각 끝부분 (문맥 이어 붙이기)
async function transcribe({ userId, audio, mime, prompt = "" }) {
  let text = null;
  try {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY가 설정되지 않았어요");
    const form = new FormData();
    const ext = { "audio/mpeg": "mp3", "audio/mp4": "mp4", "audio/ogg": "ogg", "audio/wav": "wav" }[mime] || "webm";
    form.append("file", new Blob([audio], { type: mime }), `lecture.${ext}`);
    form.append("model", "gpt-4o-mini-transcribe");
    form.append("language", "ko");
    form.append("chunking_strategy", "auto");
    if (prompt) form.append("prompt", prompt.slice(-500));
    // 10분 조각 실측 약 11초. 멈춘 요청이 서버를 붙잡지 않게 90초 제한 (nginx proxy_read_timeout 120s보다 짧게)
    const res = await fetch(`${OPENAI}/transcriptions`, { method: "POST", headers: openaiHeaders(), body: form, signal: AbortSignal.timeout(90000) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error?.message || `HTTP ${res.status}`);
    text = String(body.text || "").trim();
  } catch (err) {
    console.error("[ai:transcribe]", redact(err.message));
    await log(userId, null, "transcribe", `audio ${audio.length} bytes`, `ERROR: ${err.message}`, null, false);
    return null;
  }
  await log(userId, null, "transcribe", `audio ${audio.length} bytes`, text, null, true);
  return text;
}

// 브리핑 문장 → mp3 스트림 (gpt-4o-mini-tts, 목소리 marin: OpenAI 권장 최고 품질)
// 전체 생성(약 5초)을 기다리지 않고 만들어지는 대로 흘려보내 첫 소리를 빨리 낸다. 실패하면 null
async function speak({ userId, text }) {
  try {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY가 설정되지 않았어요");
    const res = await fetch(`${OPENAI}/speech`, {
      method: "POST",
      headers: { ...openaiHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "marin",
        input: text.slice(0, 4096),
        instructions: "대학생에게 아침 일정을 알려주는 다정한 한국어 비서. 밝고 차분한 20대 톤, 또박또박 자연스러운 서울 표준어, 약간 빠르게.",
        response_format: "mp3",
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error?.message || `HTTP ${res.status}`);
    await log(userId, null, "tts", text, "mp3 stream", null, true);
    return res.body;
  } catch (err) {
    console.error("[ai:tts]", redact(err.message));
    await log(userId, null, "tts", text, `ERROR: ${err.message}`, null, false);
    return null;
  }
}

// 오늘부터 14일 달력. "다음 주 화요일" 같은 상대 날짜를 모델이 정확히 계산하도록 표로 준다
function calendar(today) {
  const base = new Date(`${today}T12:00:00Z`);
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(base.getTime() + i * 86400000);
    return `${d.toISOString().slice(0, 10)}(${WEEK[d.getUTCDay()]})`;
  }).join(", ");
}

// 1. 음성 메모 → 요약 + 할 일 후보
async function extractTasks({ userId, memoId, transcript, subjects, today }) {
  const system = `너는 대학생 플래너 비서다. 사용자의 음성 메모(STT 원문, 오타가 있을 수 있음)에서 할 일을 뽑는다.
오늘: ${today} (${WEEK[new Date(today + "T12:00:00Z").getUTCDay()]}요일)
달력: ${calendar(today)}
내 과목 목록: ${subjects.length ? subjects.join(", ") : "(없음)"}
규칙:
- "다음 주 화요일", "모레" 같은 상대 날짜는 위 달력으로 실제 날짜로 바꾼다. "다음 주"는 오늘이 속한 주(월~일)의 다음 주다.
- 시간이 없으면 23:59로 둔다. 마감을 알 수 없으면 due_at은 null.
- subject는 내 과목 목록에 있는 이름 중에서만 고르고, 없으면 null.
- priority는 low/mid/high 중 하나. 시험·과제 제출은 high.
- 할 일이 없으면 tasks는 빈 배열.
JSON만 출력: {"summary":"한 줄 요약","subject":"과목명 또는 null","tasks":[{"title":"...","due_at":"YYYY-MM-DD HH:mm","priority":"mid"}]}`;
  const r = await call({ feature: "extract", userId, memoId, system, input: transcript });
  if (!r) return null;
  const pick = (s) => (subjects.includes(s) ? s : null);
  return {
    summary: String(r.summary || "").slice(0, 1000),
    subject: pick(r.subject),
    tasks: (Array.isArray(r.tasks) ? r.tasks : [])
      .filter((t) => t && t.title)
      .map((t) => ({
        title: String(t.title).slice(0, 200),
        due_at: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(t.due_at || "") ? t.due_at.slice(0, 16) : null,
        priority: ["low", "mid", "high"].includes(t.priority) ? t.priority : "mid",
        subject: pick(t.subject) || pick(r.subject),
      })),
  };
}

// 2. 강의 녹음 → 핵심 3~5줄 + 시험 포인트
async function summarizeLecture({ userId, memoId, transcript, subjects }) {
  const system = `너는 대학 강의 요약 도우미다. 강의 녹음 STT 원문(오타 있음)을 정리한다.
내 과목 목록: ${subjects.length ? subjects.join(", ") : "(없음)"}
JSON만 출력: {"subject":"목록 중 과목명 또는 null","points":["핵심 3~5줄"],"exam":["시험에 나올 것 같은 포인트 1~3개"]}`;
  const r = await call({ feature: "summary", userId, memoId, system, input: transcript, maxTokens: 1500 });
  if (!r) return null;
  const points = (r.points || []).map((p) => `• ${p}`).join("\n");
  const exam = (r.exam || []).map((p) => `★ ${p}`).join("\n");
  return {
    summary: [points, exam && `\n[시험 포인트]\n${exam}`].filter(Boolean).join("\n"),
    subject: subjects.includes(r.subject) ? r.subject : null,
    tasks: [],
  };
}

// 3. 열린 할 일 → 오늘 할 Top3 + 이유. 실패하면 null (호출부에서 마감순으로 대체)
async function prioritize({ userId, tasks, now }) {
  if (!tasks.length) return [];
  const input = tasks
    .map((t) => `${t.task_id}|${t.title}|${t.subject_name || "-"}|마감:${t.due_at || "없음"}${t.due_at && t.due_at < now ? "(지남)" : ""}|${t.priority}|${t.status}`)
    .join("\n");
  const system = `지금은 ${now}. 대학생의 할 일 목록(id|제목|과목|마감|우선순위|상태)을 보고 오늘 먼저 할 3개를 고른다.
마감이 지난 것(지남), 마감이 가까운 것, 우선순위 high, 이미 진행 중(doing)인 것을 우선한다. 이유는 20자 내외 한국어 한 줄.
(지남) 표시가 있으면 이유에 "지났어요"처럼 지난 사실을 쓰고 "오늘 밤 마감" 같은 앞으로의 표현은 쓰지 않는다.
JSON만 출력: {"top":[{"task_id":1,"reason":"..."}]}`;
  const r = await call({ feature: "prioritize", userId, system, input, maxTokens: 400 });
  if (!r || !Array.isArray(r.top)) return null;
  const byId = new Map(tasks.map((t) => [t.task_id, t]));
  return r.top
    .filter((x) => byId.has(Number(x.task_id)))
    .slice(0, 3)
    .map((x) => ({ ...byId.get(Number(x.task_id)), reason: String(x.reason || "") }));
}

// 4. 아침 브리핑 → 30초 분량 TTS용 문장
async function makeBriefing({ userId, userName, today, classes, dueTasks }) {
  const input = `이름: ${userName}
오늘: ${today}
오늘 수업: ${classes.map((c) => `${c.name} ${c.start_time.slice(0, 5)} ${c.room || ""}`).join(", ") || "없음"}
다가오는 마감: ${dueTasks.map((t) => `${t.title}(${t.due_at})`).join(", ") || "없음"}`;
  const system = `너는 다정한 아침 브리핑 비서다. 주어진 정보로 소리 내어 읽을 30초 분량(3~5문장) 한국어 브리핑을 쓴다.
이모지·마크다운·괄호 없이 말하듯이. 시간은 "오전 10시"처럼 읽기 쉽게. 마지막에 짧은 응원 한마디.`;
  return call({ feature: "briefing", userId, system, input, json: false, maxTokens: 500 });
}

// 5. 메일(보낸 사람·제목·snippet만) → 과제·마감이 있는 메일만 할 일 후보로. 실패하면 null (호출부는 다음 동기화 때 다시 시도)
async function analyzeMails({ userId, mails, subjects, today }) {
  if (!mails.length) return [];
  const input = mails.map((m, i) => `${i}|${m.sender}|${m.subject}|${m.snippet}`).join("\n");
  const system = `너는 대학생 메일함에서 할 일을 찾는 비서다. 각 줄은 번호|보낸 사람|제목|미리보기다.
오늘: ${today} (${WEEK[new Date(today + "T12:00:00Z").getUTCDay()]}요일)
달력: ${calendar(today)}
내 과목 목록: ${subjects.length ? subjects.join(", ") : "(없음)"}
규칙:
- 과제 제출, 시험, 퀴즈, 발표, 신청 마감처럼 학생이 직접 해야 할 일이 있는 메일만 고른다. 광고·뉴스레터·알림성 메일은 고르지 않는다.
- title은 "기말 리포트 제출"처럼 할 일 이름으로 30자 이내.
- 마감이 보이면 due_at을 "YYYY-MM-DD HH:mm"으로, 시간이 없으면 23:59. 모르면 null.
- subject는 내 과목 목록에 있는 이름 중에서만, 없으면 null.
JSON만 출력: {"items":[{"index":0,"title":"...","due_at":"YYYY-MM-DD HH:mm","subject":"과목명 또는 null"}]} (할 일이 없으면 items는 빈 배열)`;
  const r = await call({ feature: "mail", userId, system, input, maxTokens: 1500 });
  if (!r || !Array.isArray(r.items)) return null;
  return r.items
    .filter((x) => mails[Number(x.index)] && x.title)
    .map((x) => ({
      mail: mails[Number(x.index)],
      title: String(x.title).slice(0, 200),
      due_at: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(x.due_at || "") ? x.due_at.slice(0, 16) + ":00" : null,
      subject: subjects.includes(x.subject) ? x.subject : null,
    }));
}

// 6. 음성 비서 (Claude tool use). 도구 실행은 호출부(routes/api/assistant.js)의 runTool이 맡는다
// 도구 호출 반복은 최대 3회. 실패하면 null (호출부가 "다시 말해 달라"고 답한다)
const obj = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const ASSISTANT_TOOLS = [
  {
    name: "add_task",
    description: "할 일을 추가한다. 과제·시험 준비·제출처럼 마감이 있는 일.",
    input_schema: obj(
      {
        title: { type: "string", description: "할 일 이름 (30자 이내)" },
        due_at: { type: ["string", "null"], description: "마감 YYYY-MM-DD HH:mm. 시간이 없으면 23:59, 모르면 null" },
        subject: { type: ["string", "null"], description: "내 과목 목록에 있는 과목명, 없으면 null" },
        priority: { type: "string", enum: ["low", "mid", "high"] },
      },
      ["title", "due_at", "subject", "priority"],
    ),
  },
  {
    name: "list_tasks",
    description: "아직 끝내지 않은 할 일 목록을 본다. complete_task에 쓸 task_id도 여기서 얻는다.",
    input_schema: obj({ range: { type: "string", enum: ["today", "week", "all"], description: "today=오늘 마감, week=7일 안 마감, all=전체" } }, ["range"]),
  },
  {
    name: "complete_task",
    description: "할 일을 완료로 표시한다. task_id는 list_tasks로 먼저 확인한다.",
    input_schema: obj({ task_id: { type: "integer" } }, ["task_id"]),
  },
  {
    name: "add_event",
    description: "약속·회의 같은 일정을 추가한다. 수업이나 다른 일정과 겹치면 서버가 추가하지 않고 빈 시간을 제안해 돌려준다.",
    input_schema: obj(
      {
        title: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD" },
        start_time: { type: "string", description: "HH:mm (24시간)" },
        minutes: { type: "integer", description: "길이(분). 말이 없으면 60" },
        location: { type: ["string", "null"] },
      },
      ["title", "date", "start_time", "minutes", "location"],
    ),
  },
  {
    name: "list_schedule",
    description: "날짜 범위의 수업(시간표)과 일정을 본다.",
    input_schema: obj({ from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" } }, ["from", "to"]),
  },
  {
    name: "find_free_slot",
    description: "그날 수업·일정을 피해 빈 시간을 찾는다 (09:00~22:00).",
    input_schema: obj({ date: { type: "string", description: "YYYY-MM-DD" }, minutes: { type: "integer" } }, ["date", "minutes"]),
  },
  {
    name: "add_class",
    description: "시간표에 매주 반복되는 수업 시간을 추가한다. 과목이 없으면 새로 만든다. 요일이 여러 개면 요일마다 한 번씩 호출한다.",
    input_schema: obj(
      {
        subject: { type: "string", description: "과목명. 내 과목 목록에 비슷한 이름이 있으면 그 이름을 그대로 쓴다" },
        day_of_week: { type: "integer", description: "0=일 1=월 2=화 3=수 4=목 5=금 6=토" },
        start_time: { type: "string", description: "HH:mm (24시간)" },
        end_time: { type: "string", description: "HH:mm (24시간)" },
        room: { type: ["string", "null"], description: "강의실, 없으면 null" },
        professor: { type: ["string", "null"], description: "교수명, 없으면 null" },
      },
      ["subject", "day_of_week", "start_time", "end_time", "room", "professor"],
    ),
  },
];

async function runAssistant({ userId, text, today, subjects, runTool }) {
  if (!client) {
    await log(userId, null, "assistant", text, "ERROR: ANTHROPIC_API_KEY가 설정되지 않았어요", null, false);
    return null;
  }
  const system = `너는 대학생 플래너의 음성 비서다. 사용자의 말(음성 인식 결과, 오타 있음)을 듣고 도구로 처리한 뒤 짧게 답한다.
오늘: ${today} (${WEEK[new Date(today + "T12:00:00Z").getUTCDay()]}요일)
달력: ${calendar(today)}
내 과목 목록: ${subjects.length ? subjects.join(", ") : "(없음)"}
규칙:
- "내일", "다음 주 화요일" 같은 날짜는 위 달력으로 실제 날짜로 바꾼다. "오후 3시"는 15:00. 오전/오후가 없고 1~7시면 오후로 본다.
- 시간표(매주 반복 수업)를 추가해 달라고 하면 add_class, 한 번뿐인 약속·회의는 add_event, 해야 할 일·과제는 add_task.
- 수업 끝 시간을 말하지 않으면 다시 묻지 말고 시작 시각 + 1시간 30분으로 둔다.
- 도구 결과에 conflict가 있으면 일정이 추가되지 않은 것이다. 겹치는 이유와 제안 시간을 말하고 "괜찮으면 좋아라고 말해 주세요"처럼 확인을 구한다.
- 답은 소리 내어 읽기 좋게 1~2문장 한국어 존댓말. 이모지·마크다운·목록 금지. 시간은 "오후 4시 30분"처럼.
- 플래너와 관계없는 말이면 할 수 있는 일(일정 잡기, 할 일 추가·완료, 마감 확인, 시간표 추가)을 짧게 안내한다.`;
  const messages = [{ role: "user", content: text }];
  const actions = [];
  let tokens = 0;
  try {
    for (let round = 0; round <= 3; round++) {
      const msg = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system,
        // 마지막 바퀴는 도구 없이 답만 받는다 (도구 호출 최대 3회)
        ...(round < 3 ? { tools: ASSISTANT_TOOLS } : {}),
        messages,
      });
      tokens += (msg.usage?.input_tokens || 0) + (msg.usage?.output_tokens || 0);
      const uses = msg.content.filter((b) => b.type === "tool_use");
      if (msg.stop_reason !== "tool_use" || !uses.length) {
        const reply = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
        await log(userId, null, "assistant", text, reply || `(stop: ${msg.stop_reason})`, tokens, !!reply);
        return reply ? { reply, actions } : null;
      }
      messages.push({ role: "assistant", content: msg.content });
      const results = [];
      for (const u of uses) {
        let result;
        try {
          result = await runTool(u.name, u.input || {});
        } catch (err) {
          result = { error: err.message };
        }
        actions.push({ tool: u.name, input: u.input, result });
        await log(userId, null, "assistant", JSON.stringify(u.input), JSON.stringify(result).slice(0, 60000), null, !result?.error, u.name);
        results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(result), ...(result?.error ? { is_error: true } : {}) });
      }
      messages.push({ role: "user", content: results });
    }
  } catch (err) {
    console.error("[ai:assistant]", redact(err.message));
    await log(userId, null, "assistant", text, `ERROR: ${err.message}`, tokens || null, false);
  }
  return null;
}

module.exports = { transcribe, speak, extractTasks, summarizeLecture, prioritize, makeBriefing, analyzeMails, runAssistant, parseJson, calendar };
