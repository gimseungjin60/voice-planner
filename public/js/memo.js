// 음성 메모: STT 실시간 표시 → AI 분석 → 할 일 후보 체크 → 저장
const $ = (id) => document.getElementById(id);
const textarea = $("transcript");
const micBtn = $("mic-btn");
let memoType = "memo";
let session = null;
let startedAt = 0;
let duration = 0;
let memoId = null;

const HELP = {
  memo: '예) "데이터베이스 교수님이 다음 주 화요일까지 ERD 과제 내래"',
  lecture: "강의를 켜두면 길게 받아 적고, AI가 핵심 3~5줄과 시험 포인트로 요약해요",
};
document.querySelectorAll(".tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
    memoType = b.dataset.type;
    $("type-help").textContent = HELP[memoType];
  }),
);

// 음성 인식 미지원 브라우저는 텍스트 입력만
if (!Voice.sttSupported) {
  $("mic-area").classList.add("hidden");
  $("no-stt").classList.remove("hidden");
}

function stopListening() {
  if (!session) return;
  session.stop();
  session = null;
}

function onStopped() {
  session = null;
  duration += Math.round((Date.now() - startedAt) / 1000);
  micBtn.classList.remove("recording");
  $("mic-status").textContent = "정지됨 · 내용을 확인하고 AI 분석을 누르세요";
  $("interim").textContent = "";
}

function startListening() {
  startedAt = Date.now();
  micBtn.classList.add("recording");
  $("mic-status").textContent = "듣는 중… 다시 누르면 정지";
  session = Voice.listen({
    onInterim: (t) => ($("interim").textContent = t),
    onFinal: (t) => (textarea.value += (textarea.value && !textarea.value.endsWith("\n") ? " " : "") + t),
    onEnd: onStopped,
    onError: (msg) => ($("memo-error").textContent = msg),
  });
}

micBtn.addEventListener("click", () => (session ? stopListening() : startListening()));
// 대시보드 마이크 버튼으로 들어오면 바로 듣기 시작
if (Voice.sttSupported && new URLSearchParams(location.search).has("start")) {
  try {
    startListening();
  } catch {
    micBtn.classList.remove("recording");
  }
}

$("analyze-btn").addEventListener("click", async () => {
  stopListening();
  const transcript = textarea.value.trim();
  if (!transcript) return ($("memo-error").textContent = "메모 내용이 비어 있어요");
  $("memo-error").textContent = "";
  const btn = $("analyze-btn");
  btn.disabled = true;
  btn.textContent = "AI가 정리하는 중…";
  const r = await api("/api/memos", { method: "POST", body: { transcript, memo_type: memoType, duration_sec: duration || null } });
  btn.disabled = false;
  btn.textContent = "✨ AI 분석";
  if (!r.ok) return;

  const { memo, ai_ok, ai_error, candidates } = r.data;
  memoId = memo.memo_id;
  $("result").classList.remove("hidden");
  $("summary").textContent = ai_ok ? memo.summary || "(요약 없음)" : ai_error;
  $("memo-link").href = `/memos/${memoId}`;
  renderCandidates(candidates);
  textarea.value = "";
  duration = 0;
  $("result").scrollIntoView({ behavior: "smooth" });
});

function renderCandidates(list) {
  const box = $("candidates");
  box.innerHTML = "";
  $("cand-wrap").classList.toggle("hidden", !list.length);
  for (const t of list) {
    const el = $("cand-tpl").content.firstElementChild.cloneNode(true);
    el.querySelector(".c-title").value = t.title;
    el.querySelector(".c-due").value = t.due_at ? t.due_at.replace(" ", "T") : "";
    el.querySelector(".c-priority").value = t.priority;
    el.querySelector(".c-subject").value = t.subject_id || "";
    box.append(el);
  }
}

$("confirm-btn").addEventListener("click", async () => {
  const tasks = [...document.querySelectorAll(".candidate")]
    .filter((el) => el.querySelector("input[type=checkbox]").checked)
    .map((el) => ({
      title: el.querySelector(".c-title").value,
      due_at: el.querySelector(".c-due").value || null,
      priority: el.querySelector(".c-priority").value,
      subject_id: el.querySelector(".c-subject").value || null,
    }));
  if (!tasks.length) return toast("저장할 할 일을 체크하세요");
  const r = await api(`/api/memos/${memoId}/confirm`, { method: "POST", body: { tasks } });
  if (!r.ok) return;
  toast(`할 일 ${r.data.saved}개를 저장했어요`);
  setTimeout(() => (location.href = "/tasks"), 800);
});
