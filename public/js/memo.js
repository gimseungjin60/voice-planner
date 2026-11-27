// 음성 메모: 짧은 메모(STT 실시간 자막) / 강의 녹음(10분 조각 받아쓰기) → AI 정리 → 할 일 후보 체크 → 저장
const $ = (id) => document.getElementById(id);
const textarea = $("transcript");
const micBtn = $("mic-btn");
const analyzeBtn = $("analyze-btn");
let memoType = "memo";
let session = null;
let startedAt = 0;
let duration = 0;
let memoId = null;
let tick = null;

const MODE = {
  memo: {
    desc: "떠오른 할 일을 말로 남기면 AI가 할 일 후보로 정리해 드려요.",
    placeholder: "예: 데이터베이스 교수님이 다음 주 화요일까지 ERD 과제 내래",
    idle: ["버튼을 누르고 말하세요", "말하는 동안 받아쓴 내용에 글자가 바로 적혀요"],
  },
  lecture: {
    desc: "수업 내내 켜 두면 10분마다 글로 받아쓰고, 끝나면 AI가 요약해 드려요.",
    placeholder: "녹음을 시작하고 강의를 켜 두세요. 10분마다 받아쓴 글이 여기에 쌓여요",
    idle: ["버튼을 누르면 녹음이 시작돼요", "수업이 끝날 때까지 켜 두면 10분마다 글자로 바뀌어요"],
  },
};

function setIdleText() {
  const [title, sub] = MODE[memoType].idle;
  $("mic-status").textContent = textarea.value.trim() ? "정지됨 · 내용을 확인하고 AI로 정리하세요" : title;
  $("mic-sub").textContent = sub;
}

// 글자 수 + [AI로 정리하기] 활성 (비었거나 녹음·받아쓰기 중이면 비활성)
function updateAnalyze() {
  const n = textarea.value.trim().length;
  $("char-count").textContent = session || rec ? "받아쓰는 중…" : `${n.toLocaleString()}자`;
  if (!analyzeBtn.classList.contains("loading")) analyzeBtn.disabled = !n || !!(session || rec || pending);
  // 버튼이 왜 꺼져 있는지 옆에 한 줄로 알려 준다
  $("analyze-hint").textContent = n ? (session || rec || pending ? "받아쓰기가 끝나면 정리할 수 있어요" : "") : "말하거나 입력하면 정리할 수 있어요";
}
textarea.addEventListener("input", updateAnalyze);

document.querySelectorAll(".seg button[data-type]").forEach((b) =>
  b.addEventListener("click", () => {
    if (session || rec) return toast("녹음을 먼저 멈추세요", { type: "fail" });
    document.querySelectorAll(".seg button[data-type]").forEach((x) => {
      x.classList.toggle("active", x === b);
      x.setAttribute("aria-pressed", x === b);
    });
    memoType = b.dataset.type;
    $("memo-page").classList.toggle("mode-lecture", memoType === "lecture");
    $("memo-desc").textContent = MODE[memoType].desc;
    textarea.placeholder = MODE[memoType].placeholder;
    $("timer").textContent = mmss(duration);
    setIdleText();
  }),
);

// 음성 인식 미지원 브라우저: 짧은 메모는 직접 입력만
if (!Voice.sttSupported) {
  $("mic-area").classList.add("hidden");
  $("no-stt").classList.remove("hidden");
}

const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const elapsed = () => duration + Math.round((Date.now() - startedAt) / 1000);

function setRecording(on) {
  micBtn.classList.toggle("recording", on);
  micBtn.setAttribute("aria-label", on ? "녹음 정지" : "녹음 시작");
  micBtn.querySelector("use").setAttribute("href", on ? "#i-stop" : "#i-mic");
  $("wave").classList.toggle("hidden", !on);
  $("timer").classList.toggle("hidden", !on);
  clearInterval(tick);
  if (on) tick = setInterval(() => ($("timer").textContent = mmss(elapsed())), 500);
  updateAnalyze();
}

function stopListening() {
  if (!session) return;
  session.stop();
  session = null;
}

function onStopped() {
  session = null;
  duration = elapsed();
  setRecording(false);
  setIdleText();
  $("interim").textContent = "";
  updateAnalyze();
}

const append = (t) => (textarea.value += (textarea.value && !/\s$/.test(textarea.value) ? " " : "") + t);

function startListening() {
  $("memo-error").textContent = "";
  startedAt = Date.now();
  $("timer").textContent = mmss(duration);
  $("mic-status").textContent = "듣는 중 · 다시 누르면 정지";
  session = Voice.listen({
    onInterim: (t) => ($("interim").textContent = t),
    onFinal: (t) => {
      append(t);
      updateAnalyze();
    },
    onEnd: onStopped,
    onError: (msg) => ($("memo-error").textContent = msg),
  });
  setRecording(true);
}

// ---------- 강의 녹음: 파일로 녹음해 10분마다 서버로 보내 받아쓰기 (OpenAI). 짧은 메모는 위 Web Speech ----------
const SEGMENT_MS = 10 * 60 * 1000;
let rec = null; // { stream, recorder, timer, stopping }
let uploads = Promise.resolve(); // 조각 순서대로 이어 붙이기
let pending = 0;
let failed = []; // 실패한 조각은 버리지 않고 다시 시도할 수 있게 보관 { blob, seg }
const segs = []; // 화면의 "받아쓰기 · 10분 조각" 목록 { from, to, state: rec|wait|ok|fail }
const SEG_STATE = { rec: ["rec", "녹음 중"], wait: ["wait", "받아쓰는 중…"], ok: ["ok", "받아씀"], fail: ["fail", "받아쓰지 못했어요"] };

function renderSegs() {
  $("seg-list").innerHTML = segs
    .map((s) => {
      const [cls, text] = SEG_STATE[s.state];
      return `<li><span>${mmss(s.from)}~${s.to == null ? "" : mmss(s.to)}</span><span class="${cls}">${s.state === "ok" ? `<svg class="i sm" aria-hidden="true"><use href="#i-check"/></svg> ` : ""}${text}</span></li>`;
    })
    .join("");
}

function lectureStatus() {
  updateAnalyze();
  renderSegs();
  if (rec) $("mic-status").textContent = "녹음 중 · 10분마다 글자로 바뀌어요";
  else if (pending) $("mic-status").textContent = `받아쓰는 중… (${pending}개 남음)`;
  else if (failed.length) $("mic-status").textContent = "받아쓰지 못한 부분이 있어요";
  else if (segs.length) $("mic-status").textContent = "녹음 끝 · 받아쓰기 완료";
  else setIdleText();
}

function queueUpload(blob, seg) {
  pending++;
  seg.state = "wait";
  lectureStatus();
  uploads = uploads.then(async () => {
    const prompt = encodeURIComponent(textarea.value.slice(-200));
    const j = await fetch(`/api/memos/transcribe?prompt=${prompt}`, { method: "POST", headers: { "Content-Type": blob.type }, body: blob })
      .then((res) => res.json())
      .catch(() => ({ ok: false, error: "서버에 연결할 수 없어요" }));
    pending--;
    if (j.ok) {
      append(j.data.text);
      seg.state = "ok";
    } else {
      seg.state = "fail";
      failed.push({ blob, seg });
      $("memo-error").innerHTML = `${esc(j.error)} · 녹음은 그대로 남아 있어요 <button class="btn line sm" id="retry-btn">다시 시도</button>`;
    }
    lectureStatus();
  });
}

function nextSegment() {
  const mimeType = ["audio/webm;codecs=opus", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(rec.stream, { mimeType, audioBitsPerSecond: 32000 }); // 10분 ≈ 2.4MB
  const chunks = [];
  const seg = { from: elapsed(), to: null, state: "rec" };
  segs.push(seg);
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = () => {
    seg.to = elapsed();
    if (chunks.length) queueUpload(new Blob(chunks, { type: recorder.mimeType.split(";")[0] }), seg);
    else segs.splice(segs.indexOf(seg), 1);
    if (!rec.stopping) return nextSegment();
    rec.stream.getTracks().forEach((t) => t.stop());
    rec = null;
    onStopped();
    lectureStatus();
  };
  recorder.start();
  rec.recorder = recorder;
  rec.timer = setTimeout(() => recorder.state === "recording" && recorder.stop(), SEGMENT_MS);
  renderSegs();
}

async function startRecording() {
  $("memo-error").textContent = "";
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    $("memo-error").textContent = "마이크 권한을 허용해 주세요";
    return;
  }
  rec = { stream };
  startedAt = Date.now();
  $("timer").textContent = mmss(duration);
  setRecording(true);
  nextSegment();
  lectureStatus();
}

function stopRecording() {
  if (!rec || rec.stopping) return;
  rec.stopping = true;
  clearTimeout(rec.timer);
  rec.recorder.stop();
}

$("memo-error").addEventListener("click", (e) => {
  if (e.target.id !== "retry-btn") return;
  $("memo-error").textContent = "";
  const again = failed;
  failed = [];
  again.forEach((f) => queueUpload(f.blob, f.seg));
});

micBtn.addEventListener("click", () => {
  if (memoType === "lecture") return rec ? stopRecording() : startRecording();
  session ? stopListening() : startListening();
});
// 대시보드 마이크 버튼으로 들어오면 바로 듣기 시작
if (Voice.sttSupported && new URLSearchParams(location.search).has("start")) {
  try {
    startListening();
  } catch {
    setRecording(false);
  }
}

// ---------- AI 정리 결과 ----------
// 강의 요약: "• 핵심" 줄 + "[시험 포인트]" 아래 "★ 포인트" 줄
function lectureHtml(text) {
  const [main, exam = ""] = text.split("[시험 포인트]");
  const items = (s, mark) =>
    s.split("\n").map((l) => l.trim().replace(mark, "").trim()).filter(Boolean).map((l) => `<li>${esc(l)}</li>`).join("");
  return `<ul class="points" style="margin-top: 16px">${items(main, /^[•\-*]/)}</ul>${
    exam.trim()
      ? `<div class="exam"><b><svg class="i" aria-hidden="true"><use href="#i-star"/></svg>시험 포인트</b><ul class="points">${items(exam, /^★/)}</ul></div>`
      : ""
  }`;
}

analyzeBtn.addEventListener("click", async () => {
  if (rec || pending) return toast("받아쓰기가 끝나면 정리할 수 있어요", { type: "fail" });
  stopListening();
  const transcript = textarea.value.trim();
  if (!transcript) {
    $("memo-error").textContent = "메모 내용이 비어 있어요";
    return textarea.focus();
  }
  $("memo-error").textContent = "";
  analyzeBtn.classList.add("loading");
  analyzeBtn.disabled = false;
  analyzeBtn.querySelector("span").textContent = "AI가 정리하는 중…";
  $("result").classList.remove("hidden");
  $("summary").className = "summary";
  $("summary").innerHTML = `<span class="skel" style="width: 320px; height: 16px"></span>`;
  $("lecture-body").innerHTML = `<p class="fine" style="margin-top: 14px">문장을 할 일로 나누고, 날짜와 과목을 찾고 있어요.</p>
    <span class="skel" style="width: 90%"></span><span class="skel" style="width: 70%"></span><span class="skel" style="width: 80%"></span>`;
  ["cand-wrap", "no-cand", "lecture-foot"].forEach((id) => $(id).classList.add("hidden"));
  $("result").scrollIntoView({ behavior: "smooth", block: "nearest" });

  const r = await api("/api/memos", { method: "POST", body: { transcript, memo_type: memoType, duration_sec: duration || null } });
  analyzeBtn.classList.remove("loading");
  analyzeBtn.querySelector("span").textContent = "AI로 정리하기";
  if (!r.ok) {
    $("result").classList.add("hidden");
    return updateAnalyze();
  }

  const { memo, ai_ok, ai_error, candidates } = r.data;
  memoId = memo.memo_id;
  const lecture = memo.memo_type === "lecture";
  $("memo-link").href = $("memo-link-2").href = `/memos/${memoId}`;
  if (!ai_ok) {
    $("summary").className = "summary warn";
    $("summary").textContent = `${ai_error || "AI 정리에 실패했어요"} · 원문은 메모에 저장했어요`;
    $("lecture-body").innerHTML = "";
  } else if (lecture) {
    $("summary").textContent = "강의 요약";
    $("lecture-body").innerHTML = lectureHtml(memo.summary || "");
  } else {
    $("summary").textContent = memo.summary || "(요약 없음)";
    $("lecture-body").innerHTML = "";
  }
  if (lecture) {
    $("lecture-meta").textContent = `강의 녹음 · ${mmss(duration)} · 자동 저장됨`;
    $("lecture-foot").classList.remove("hidden");
  } else renderCandidates(candidates);
  textarea.value = "";
  duration = 0;
  segs.length = 0;
  renderSegs();
  setIdleText();
  updateAnalyze();
});

// "2026-12-03 09:55" → "12/3(목) 09:55" (23:59는 날짜만)
const WEEK_KO = "일월화수목금토";
function shortDue(v) {
  if (!v) return "없음";
  const [d, tm] = String(v).replace("T", " ").split(" ");
  const dt = new Date(`${d}T12:00:00`);
  const time = tm && tm.slice(0, 5) !== "23:59" ? ` ${tm.slice(0, 5)}` : "";
  return `${dt.getMonth() + 1}/${dt.getDate()}(${WEEK_KO[dt.getDay()]})${time}`;
}

function renderCandidates(list) {
  const box = $("candidates");
  box.innerHTML = "";
  $("cand-wrap").classList.toggle("hidden", !list.length);
  $("no-cand").classList.toggle("hidden", !!list.length);
  const dup = list.filter((t) => t.kind === "same").length;
  $("cand-title").textContent = `할 일 후보 ${list.length}개` + (dup ? ` · ${dup}개는 이미 있어요` : "");
  $("confirm-btn").disabled = false;
  $("confirm-btn").querySelector("span").textContent = "할 일로 저장";
  for (const t of list) {
    const el = $("cand-tpl").content.firstElementChild.cloneNode(true);
    el.querySelector(".c-title").value = t.title;
    el.querySelector(".c-due").value = t.due_at ? t.due_at.replace(" ", "T").slice(0, 16) : "";
    el.querySelector(".c-priority").value = t.priority;
    el.querySelector(".c-subject").value = t.subject_id || "";
    const cb = el.querySelector(".check");
    // 이미 있는 할 일과 같으면 체크 해제, 마감이 바뀌었으면 기존 할 일을 고치는 후보로
    if (t.match) {
      el.dataset.taskId = t.match.task_id;
      el.querySelector(".c-title").value = t.match.title;
      const note = el.querySelector(".c-match");
      note.classList.remove("hidden");
      if (t.kind === "same") {
        cb.checked = false;
        el.classList.add("off", "dup");
        note.textContent = "이미 있는 할 일이에요";
      } else {
        el.classList.add("upd");
        note.textContent = `마감 변경 · 원래 ${shortDue(t.match.due_at)}`;
      }
    }
    cb.addEventListener("change", () => el.classList.toggle("off", !cb.checked));
    box.append(el);
  }
}

$("confirm-btn").addEventListener("click", async () => {
  const tasks = [...document.querySelectorAll(".candidate")]
    .filter((el) => el.querySelector(".check").checked)
    .map((el) => ({
      title: el.querySelector(".c-title").value,
      due_at: el.querySelector(".c-due").value || null,
      priority: el.querySelector(".c-priority").value,
      subject_id: el.querySelector(".c-subject").value || null,
      task_id: el.dataset.taskId ? Number(el.dataset.taskId) : null,
    }));
  if (!tasks.length) return toast("저장할 할 일을 체크하세요", { type: "fail" });
  const btn = $("confirm-btn");
  btn.classList.add("loading");
  const r = await api(`/api/memos/${memoId}/confirm`, { method: "POST", body: { tasks } });
  btn.classList.remove("loading");
  if (!r.ok) return;
  btn.disabled = true;
  btn.querySelector("span").textContent = "저장했어요";
  const { saved, updated } = r.data;
  const msg = saved && updated ? `할 일 ${saved}개를 저장하고 ${updated}개를 고쳤어요` : updated ? `기존 할 일 ${updated}개를 고쳤어요` : `할 일 ${saved}개를 저장했어요`;
  toast(msg, { action: { label: "할 일 보기", onClick: () => (location.href = "/tasks") } });
});

updateAnalyze();
