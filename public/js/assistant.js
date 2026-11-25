// 음성 비서 (모든 화면 오른쪽 아래). 말하기/입력 → POST /api/assistant → 답변 + TTS
// 다른 페이지 스크립트와 이름이 겹치지 않게 즉시 실행 함수로 감싼다
(() => {
  const fab = document.getElementById("assist-fab");
  const panel = document.getElementById("assist");
  const body = document.getElementById("assist-body");
  const log = document.getElementById("assist-log");
  const input = document.getElementById("assist-input");
  const micBtn = document.getElementById("assist-mic");
  const stopSpeak = document.getElementById("assist-speak-stop");
  const suggest = document.getElementById("assist-suggest");
  const state = document.getElementById("assist-state");
  let session = null;
  let busy = false;
  let discard = false; // 듣는 중에 다른 문장을 보내면, 듣던 내용은 버린다

  // 머리 상태 줄: 듣는 중(빨강) / 읽는 중(파랑) / 기본(초록)
  const STATE = { idle: ["ok", "말하거나 입력하세요"], listening: ["live", "듣는 중"], thinking: ["blue", "생각하는 중"], speaking: ["blue", "읽는 중"] };
  function setState(s) {
    const [cls, text] = STATE[s];
    state.className = `status-dot ${cls}`;
    state.textContent = text;
    stopSpeak.hidden = s !== "speaking";
    stopSpeak.classList.toggle("speaking", s === "speaking");
  }

  const bubble = (cls, html) => {
    const el = document.createElement("div");
    el.className = cls;
    el.innerHTML = html;
    log.append(el);
    body.scrollTop = body.scrollHeight;
    return el;
  };

  function open() {
    panel.classList.remove("hidden");
    fab.classList.add("open");
    fab.setAttribute("aria-expanded", "true");
    if (Voice.sttSupported) listen();
    else input.focus();
  }

  function close() {
    stopListening();
    Voice.stopSpeaking();
    setState("idle");
    panel.classList.add("hidden");
    fab.classList.remove("open");
    fab.setAttribute("aria-expanded", "false");
    fab.focus();
  }

  function setMic(on) {
    micBtn.classList.toggle("recording", on);
    micBtn.innerHTML = on
      ? `<span class="wave" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></span>`
      : `<svg class="i"><use href="#i-mic"/></svg>`;
    micBtn.setAttribute("aria-label", on ? "그만 듣기" : "말하기");
    // 끌 때는 '듣는 중'일 때만 기본으로 (그 사이 '생각/읽는 중'으로 바뀌었으면 그대로 둔다)
    if (on) setState("listening");
    else if (state.classList.contains("live")) setState("idle");
  }

  function stopListening() {
    session?.stop();
    session = null;
  }

  function listen() {
    if (!Voice.sttSupported) return toast("이 브라우저는 음성 인식을 지원하지 않아요. 입력해 주세요", { type: "fail" });
    if (session || busy) return;
    Voice.stopSpeaking();
    let text = "";
    const live = bubble("bubble me live", "");
    setMic(true);
    session = Voice.listen({
      once: true,
      onInterim: (t) => (live.textContent = (text + " " + t).trim()),
      onFinal: (t) => {
        text = (text + " " + t).trim();
        live.textContent = text;
      },
      onError: (msg) => toast(msg, { type: "fail" }),
      onEnd: () => {
        session = null;
        setMic(false);
        live.remove();
        if (text && !discard) send(text);
        discard = false;
      },
    });
  }

  async function send(text) {
    text = text.trim();
    if (!text || busy) return;
    if (session) {
      discard = true; // 듣는 중에 추천 문장·입력으로 보내면 마이크를 끈다
      stopListening();
    }
    busy = true;
    suggest.classList.add("hidden");
    log.querySelectorAll(".assist-choices, .assist-hint").forEach((el) => el.remove());
    bubble("bubble me", esc(text));
    const thinking = bubble("bubble bot thinking", "<i></i><i></i><i></i>");
    setState("thinking");
    input.value = "";
    const r = await api("/api/assistant", { method: "POST", body: { text }, quiet: true });
    thinking.remove();
    busy = false;
    if (!r.ok) {
      bubble("bubble bot", "잘 못 알아들었어요. 다시 말씀해 주세요.");
      return setState("idle");
    }
    const { reply, actions = [], pending } = r.data;
    bubble("bubble bot", esc(reply));
    if (actions.length)
      bubble("action-chips", actions.map((a) => `<span class="badge green"><svg class="i"><use href="#i-check"/></svg>${esc(a.label)}</span>`).join(""));
    if (pending) {
      bubble("assist-choices", `<button class="btn sm" data-say="좋아">좋아</button><button class="btn line sm" data-say="다른 시간">다른 시간</button>`);
      if (Voice.sttSupported) bubble("assist-hint", "‘좋아’라고 말해도 돼요");
    }
    if (actions.length) document.dispatchEvent(new CustomEvent("assistant:done"));
    if (!Voice.ttsSupported) return setState("idle");
    setState("speaking");
    Voice.speak(reply, () => setState("idle"));
  }

  fab.addEventListener("click", open);
  document.getElementById("assist-close").addEventListener("click", close);
  document.addEventListener("keydown", (e) => e.key === "Escape" && !panel.classList.contains("hidden") && close());
  micBtn.addEventListener("click", () => (session ? stopListening() : listen()));
  stopSpeak.addEventListener("click", () => {
    Voice.stopSpeaking();
    setState("idle");
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
