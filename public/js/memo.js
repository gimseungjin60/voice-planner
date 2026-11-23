// 음성 메모: STT 실시간 자막 → AI 정리 → 할 일 후보 체크 → 저장
const $ = (id) => document.getElementById(id);
const textarea = $("transcript");
const micBtn = $("mic-btn");
let memoType = "memo";
let session = null;
let startedAt = 0;
let duration = 0;
let memoId = null;
let tick = null;

const PLACEHOLDER = {
  memo: "데이터베이스 교수님이 다음 주 화요일까지 ERD 과제 내래",
  lecture: "녹음 버튼을 누르고 강의를 켜두세요. 10분마다 받아쓴 글이 여기에 쌓이고, 끝나면 AI가 핵심과 시험 포인트로 요약해요",
};
document.querySelectorAll(".seg button[data-type]").forEach((b) =>
  b.addEventListener("click", () => {
    if (session || rec) return toast("녹음을 먼저 멈추세요");
    document.querySelectorAll(".seg button[data-type]").forEach((x) => {
      x.classList.toggle("active", x === b);
      x.setAttribute("aria-selected", x === b);
    });
    memoType = b.dataset.type;
    textarea.placeholder = PLACEHOLDER[memoType];
  }),
);

// 음성 인식 미지원 브라우저는 텍스트 입력만
if (!Voice.sttSupported) {
  $("mic-area").classList.add("hidden");
  $("no-stt").classList.remove("hidden");
}

const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

function setRecording(on) {
  micBtn.classList.toggle("recording", on);
  micBtn.classList.toggle("idle-pulse", !on);
  micBtn.setAttribute("aria-label", on ? "녹음 정지" : "녹음 시작");
  micBtn.querySelector("use").setAttribute("href", on ? "#i-stop" : "#i-mic");
  $("wave").classList.toggle("hidden", !on);
  $("wave").classList.toggle("on", on);
  $("timer").classList.toggle("hidden", !on);
  clearInterval(tick);
  if (on) tick = setInterval(() => ($("timer").textContent = mmss(duration + Math.round((Date.now() - startedAt) / 1000))), 500);
}

function stopListening() {
  if (!session) return;
  session.stop();
  session = null;
}

function onStopped() {
  session = null;
  duration += Math.round((Date.now() - startedAt) / 1000);
  setRecording(false);
  $("mic-status").textContent = textarea.value.trim() ? "정지됨 · 내용을 확인하고 AI로 정리하세요" : "버튼을 누르고 말하세요";
  $("interim").textContent = "";
}

function startListening() {
  $("memo-error").textContent = "";
  startedAt = Date.now();
  $("timer").textContent = mmss(duration);
  setRecording(true);
  $("mic-status").textContent = "듣는 중 · 다시 누르면 정지";
  session = Voice.listen({
    onInterim: (t) => ($("interim").textContent = t),
    onFinal: (t) => (textarea.value += (textarea.value && !/\s$/.test(textarea.value) ? " " : "") + t),
    onEnd: onStopped,
    onError: (msg) => ($("memo-error").textContent = msg),
  });
}

// ---------- 강의 녹음: 파일로 녹음해 10분마다 서버로 보내 받아쓰기 (OpenAI). 짧은 메모는 위 Web Speech ----------
const SEGMENT_MS = 10 * 60 * 1000;
let rec = null; // { stream, recorder, timer, stopping }
let uploads = Promise.resolve(); // 조각 순서대로 이어 붙이기
let pending = 0;
let failed = []; // 실패한 조각은 버리지 않고 다시 시도할 수 있게 보관

function lectureStatus() {
  $("analyze-btn").disabled = !!(rec || pending);
  if (pending) $("mic-status").textContent = `받아쓰는 중… (${pending}개 남음)`;
  else if (rec) $("mic-status").textContent = "녹음 중 · 10분마다 글자로 바뀌어요";
  else if (failed.length) $("mic-status").textContent = "받아쓰지 못한 부분이 있어요";
  else $("mic-status").textContent = textarea.value.trim() ? "정지됨 · 내용을 확인하고 AI로 정리하세요" : "버튼을 누르고 말하세요";
}

function queueUpload(blob) {
  pending++;
  lectureStatus();
  uploads = uploads.then(async () => {
    const prompt = encodeURIComponent(textarea.value.slice(-200));
    const j = await fetch(`/api/memos/transcribe?prompt=${prompt}`, { method: "POST", headers: { "Content-Type": blob.type }, body: blob })
      .then((res) => res.json())
      .catch(() => ({ ok: false, error: "서버에 연결할 수 없어요" }));
    pending--;
    if (j.ok) textarea.value += (textarea.value && !/s$/.test(textarea.value) ? " " : "") + j.data.text;
    else {
      failed.push(blob);
      $("memo-error").innerHTML = `${esc(j.error)} <button class="btn sm gray" id="retry-btn">다시 시도</button>`;
    }
    lectureStatus();
  });
}

function nextSegment() {
  const mimeType = ["audio/webm;codecs=opus", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(rec.stream, { mimeType, audioBitsPerSecond: 32000 }); // 10분 ≈ 2.4MB
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = () => {
    if (chunks.length) queueUpload(new Blob(chunks, { type: recorder.mimeType.split(";")[0] }));
    if (!rec.stopping) return nextSegment();
    rec.stream.getTracks().forEach((t) => t.stop());
    rec = null;
    onStopped();
    lectureStatus();
  };
  recorder.start();
  rec.recorder = recorder;
  rec.timer = setTimeout(() => recorder.state === "recording" && recorder.stop(), SEGMENT_MS);
}

async function startRecording() {
  $("memo-error").textContent = "";
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    $("memo-error").textContent = "마이크 권한을 허용해주세요";
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
  again.forEach(queueUpload);
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

$("analyze-btn").addEventListener("click", async () => {
  if (rec || pending) return toast("받아쓰기가 끝나면 정리할 수 있어요");
  stopListening();
  const transcript = textarea.value.trim();
  if (!transcript) {
    $("memo-error").textContent = "메모 내용이 비어 있어요";
    return textarea.focus();
  }
  $("memo-error").textContent = "";
  const btn = $("analyze-btn");
  btn.classList.add("loading");
  btn.querySelector("span").textContent = "AI가 정리하는 중…";
  $("result").classList.remove("hidden");
  $("summary").className = "summary ai";
  $("summary").innerHTML = `<span class="skel" style="width: 85%"></span><span class="skel" style="width: 60%"></span>`;
  $("cand-wrap").classList.add("hidden");
  $("lecture-foot").classList.add("hidden");
  $("result").scrollIntoView({ behavior: "smooth", block: "start" });

  const r = await api("/api/memos", { method: "POST", body: { transcript, memo_type: memoType, duration_sec: duration || null } });
  btn.classList.remove("loading");
  btn.querySelector("span").textContent = "AI로 정리하기";
  if (!r.ok) return $("result").classList.add("hidden");

  const { memo, ai_ok, ai_error, candidates } = r.data;
  memoId = memo.memo_id;
  $("summary").className = ai_ok ? "summary ai" : "summary warn";
  $("summary").textContent = ai_ok ? memo.summary || "(요약 없음)" : ai_error;
  $("memo-link").href = $("memo-link-2").href = `/memos/${memoId}`;
  renderCandidates(candidates);
  textarea.value = "";
  duration = 0;
  $("mic-status").textContent = "버튼을 누르고 말하세요";
});

function renderCandidates(list) {
  const box = $("candidates");
  box.innerHTML = "";
  $("cand-wrap").classList.toggle("hidden", !list.length);
  $("lecture-foot").classList.toggle("hidden", !!list.length);
  for (const t of list) {
    const el = $("cand-tpl").content.firstElementChild.cloneNode(true);
    el.querySelector(".c-title").value = t.title;
    el.querySelector(".c-due").value = t.due_at ? t.due_at.replace(" ", "T").slice(0, 16) : "";
    el.querySelector(".c-priority").value = t.priority;
    el.querySelector(".c-subject").value = t.subject_id || "";
    const cb = el.querySelector(".check");
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
    }));
  if (!tasks.length) return toast("저장할 할 일을 체크하세요");
  const btn = $("confirm-btn");
  btn.classList.add("loading");
  const r = await api(`/api/memos/${memoId}/confirm`, { method: "POST", body: { tasks } });
  btn.classList.remove("loading");
  if (!r.ok) return;
  toast(`할 일 ${r.data.saved}개를 저장했어요`);
  setTimeout(() => (location.href = "/tasks"), 900);
});
