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
    console.error(`[ai:${feature}]`, err.message);
  }
  await pool
    .query(
      "INSERT INTO ai_logs (user_id, memo_id, feature, input_text, output_text, tokens, success) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [userId, memoId, feature, input.slice(0, 60000), text, tokens, result !== null],
    )
    .catch((e) => console.error("[ai_logs]", e.message));
  return result;
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
    .map((t) => `${t.task_id}|${t.title}|${t.subject_name || "-"}|마감:${t.due_at || "없음"}|${t.priority}|${t.status}`)
    .join("\n");
  const system = `지금은 ${now}. 대학생의 할 일 목록(id|제목|과목|마감|우선순위|상태)을 보고 오늘 먼저 할 3개를 고른다.
마감이 가까운 것, 우선순위 high, 이미 진행 중(doing)인 것을 우선한다. 이유는 20자 내외 한국어 한 줄.
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

module.exports = { extractTasks, summarizeLecture, prioritize, makeBriefing, parseJson, calendar };
