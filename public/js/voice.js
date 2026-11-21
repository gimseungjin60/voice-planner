// Web Speech API 래퍼: STT(SpeechRecognition) + TTS(speechSynthesis), 한국어 ko-KR
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const Voice = {
  sttSupported: !!Recognition,
  ttsSupported: "speechSynthesis" in window,

  // 듣기 시작. onInterim(임시 글자), onFinal(확정 문장), onEnd(완전히 끝남), onError(메시지)
  // 크롬은 말이 멈추면 인식을 스스로 끝내므로, 사용자가 stop()할 때까지 다시 시작한다
  listen({ onInterim, onFinal, onEnd, onError }) {
    const rec = new Recognition();
    rec.lang = "ko-KR";
    rec.continuous = true;
    rec.interimResults = true;
    let stopped = false;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript;
        if (e.results[i].isFinal) onFinal?.(text.trim());
        else interim += text;
      }
      onInterim?.(interim);
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      stopped = true;
      onError?.(e.error === "not-allowed" ? "마이크 권한을 허용해주세요" : `음성 인식 오류: ${e.error}`);
    };
    rec.onend = () => {
      if (stopped) return onEnd?.();
      try {
        rec.start();
      } catch {
        onEnd?.();
      }
    };
    rec.start();
    return {
      stop() {
        stopped = true;
        rec.stop();
      },
    };
  },

  // 소리 내어 읽기. 이미 읽는 중이면 멈춘다
  speak(text, onEnd) {
    if (!this.ttsSupported) return toast("이 브라우저는 음성 출력을 지원하지 않아요");
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ko-KR";
    u.rate = 1.05;
    const ko = speechSynthesis.getVoices().find((v) => v.lang.startsWith("ko"));
    if (ko) u.voice = ko;
    u.onend = u.onerror = () => onEnd?.();
    speechSynthesis.speak(u);
  },
  stopSpeaking() {
    if (this.ttsSupported) speechSynthesis.cancel();
  },
  get speaking() {
    return this.ttsSupported && speechSynthesis.speaking;
  },
};
// 일부 브라우저는 음성 목록을 늦게 불러온다
if (Voice.ttsSupported) speechSynthesis.getVoices();
