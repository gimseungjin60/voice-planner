// 음성 비서 (모든 화면 오른쪽 아래). 말하기/입력 → POST /api/assistant → 답변 말풍선 + TTS
// 다른 페이지 스크립트와 이름이 겹치지 않게 즉시 실행 함수로 감싼다
(() => {
  const fab = document.getElementById("assist-fab");
  const panel = document.getElementById("assist");
  const log = document.getElementById("assist-log");
  const input = document.getElementById("assist-input");
  const micBtn = document.getElementById("assist-mic");
  const stopSpeak = document.getElementById("assist-speak-stop");
  const suggest = document.getElementById("assist-suggest");
  let session = null;
  let busy = false;

  const bubble = (cls, html) => {
    const el = document.createElement("div");
    el.className = cls;
    el.innerHTML = html;
    log.append(el);
    log.scrollTop = log.scrollHeight;
    return el;
  };

  function open() {
    panel.classList.remove("hidden");
    fab.classList.add("open");
    fab.setAttribute("aria-expanded", "true");
    if (!log.children.length) bubble("bubble bot", "무엇을 도와드릴까요? 일정 추가, 마감 확인, 할 일 완료를 말로 해보세요.");
    if (Voice.sttSupported) listen();
    else input.focus();
  }

  function close() {
    stopListening();
    Voice.stopSpeaking();
    panel.classList.add("hidden");
    fab.classList.remove("open");
    fab.setAttribute("aria-expanded", "false");
    fab.focus();
  }

  function setMic(on) {
    micBtn.classList.toggle("recording", on);
    micBtn.innerHTML = on
      ? `<span class="wave on"><span></span><span></span><span></span><span></span><span></span></span>`
      : `<svg class="i"><use href="#i-mic"/></svg>`;
    micBtn.setAttribute("aria-label", on ? "그만 듣기" : "말하기");
  }

  function stopListening() {
    session?.stop();
    session = null;
  }

  function listen() {
    if (!Voice.sttSupported) return toast("이 브라우저는 음성 인식을 지원하지 않아요. 입력해 주세요");
    if (session || busy) return;
    Voice.stopSpeaking();
    let text = "";
    const live = bubble("bubble me live", "듣는 중…");
    setMic(true);
    session = Voice.listen({
      once: true,
      onInterim: (t) => (live.textContent = (text + " " + t).trim() || "듣는 중…"),
      onFinal: (t) => {
        text = (text + " " + t).trim();
        live.textContent = text;
      },
      onError: (msg) => toast(msg),
      onEnd: () => {
        session = null;
        setMic(false);
        live.remove();
        if (text) send(text);
      },
    });
  }

  async function send(text) {
    text = text.trim();
    if (!text || busy) return;
    busy = true;
    suggest.classList.add("hidden");
    log.querySelectorAll(".assist-choices, .assist-hint").forEach((el) => el.remove());
    bubble("bubble me", esc(text));
    const thinking = bubble("bubble bot thinking", "<i></i><i></i><i></i>");
    input.value = "";
    const r = await api("/api/assistant", { method: "POST", body: { text }, quiet: true });
    thinking.remove();
    busy = false;
    if (!r.ok) {
      bubble("bubble bot", "잘 못 알아들었어요. 다시 말씀해 주세요.");
      return;
    }
    const { reply, actions = [], pending } = r.data;
    bubble("bubble bot", esc(reply));
    if (actions.length)
      bubble("action-chips", actions.map((a) => `<span class="badge blue"><svg class="i"><use href="#i-check"/></svg>${esc(a.label)}</span>`).join(""));
    if (pending) {
      bubble("assist-choices", `<button class="btn sm" data-say="좋아">좋아</button><button class="btn sm gray" data-say="다른 시간">다른 시간</button>`);
      if (Voice.sttSupported) bubble("assist-hint", "‘좋아’라고 말해도 돼요");
    }
    if (actions.length) document.dispatchEvent(new CustomEvent("assistant:done"));
    stopSpeak.hidden = false;
    Voice.speak(reply, () => (stopSpeak.hidden = true));
  }

  fab.addEventListener("click", open);
  document.getElementById("assist-close").addEventListener("click", close);
  document.addEventListener("keydown", (e) => e.key === "Escape" && !panel.classList.contains("hidden") && close());
  micBtn.addEventListener("click", () => (session ? stopListening() : listen()));
  stopSpeak.addEventListener("click", () => {
    Voice.stopSpeaking();
    stopSpeak.hidden = true;
  });
  document.getElementById("assist-form").addEventListener("submit", (e) => {
    e.preventDefault();
    send(input.value);
  });
  panel.addEventListener("click", (e) => {
    const b = e.target.closest("[data-say]");
    if (b) send(b.dataset.say);
  });
})();
