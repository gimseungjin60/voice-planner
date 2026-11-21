// 대시보드: 총정리 카드 + AI Top3 + 브리핑 듣기(TTS)
(async () => {
  const r = await api("/api/tasks/summary");
  if (!r.ok) return;
  const s = r.data;
  document.getElementById("sum-today").textContent = s.today;
  document.getElementById("sum-week").textContent = s.week;
  document.getElementById("sum-overdue").textContent = s.overdue;

  const nearest = document.getElementById("sum-nearest");
  if (s.nearest) {
    const { label, cls } = dueInfo(s.nearest.due_at);
    nearest.innerHTML = `<div class="stat ${cls}">${esc(label.split(" · ")[0])}</div><div>${esc(s.nearest.title)}</div>`;
  } else nearest.textContent = "다가오는 마감이 없어요";

  document.getElementById("top-note").textContent = s.ai_ok ? "" : "(AI 연결 실패 · 마감순)";
  const list = document.getElementById("top-list");
  list.innerHTML = s.top.length
    ? s.top
        .map((t) => {
          const { label, cls } = dueInfo(t.due_at);
          const chip = t.subject_name ? `<span class="chip" style="background:${esc(t.subject_color)}">${esc(t.subject_name)}</span>` : "";
          return `<li>${chip}<b>${esc(t.title)}</b><span class="due ${cls}">${esc(label)}</span><span class="muted">— ${esc(t.reason)}</span></li>`;
        })
        .join("")
    : `<li class="muted">남은 할 일이 없어요 🎉</li>`;
})();

const briefingBtn = document.getElementById("briefing-btn");
briefingBtn.addEventListener("click", async () => {
  if (Voice.speaking) {
    Voice.stopSpeaking();
    return (briefingBtn.textContent = "🔊 브리핑 듣기");
  }
  briefingBtn.disabled = true;
  briefingBtn.textContent = "브리핑 준비 중…";
  const r = await api("/api/briefing/today");
  briefingBtn.disabled = false;
  briefingBtn.textContent = "🔊 브리핑 듣기";
  if (!r.ok) return;
  const box = document.getElementById("briefing-text");
  box.textContent = r.data.content;
  box.classList.remove("hidden");
  briefingBtn.textContent = "⏹ 그만 듣기";
  Voice.speak(r.data.content, () => (briefingBtn.textContent = "🔊 브리핑 듣기"));
});
