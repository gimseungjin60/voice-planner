// 할 일 보드: 3열 카드, 상태 버튼 → PATCH → 새로고침 없이 다시 그림
let tasks = JSON.parse(document.getElementById("tasks-data").textContent);
const filter = document.getElementById("subject-filter");
const ORDER = ["todo", "doing", "done"];
const PRIORITY = { high: "높음", mid: "보통", low: "낮음" };

function card(t) {
  const i = ORDER.indexOf(t.status);
  const { label, cls } = t.status === "done" ? { label: dueInfo(t.due_at).label, cls: "" } : dueInfo(t.due_at);
  const chip = t.subject_name ? `<span class="chip" style="background:${esc(t.subject_color)}">${esc(t.subject_name)}</span> ` : "";
  return `<article class="task" style="border-left-color:${esc(t.subject_color || "var(--line)")}">
    <div class="task-title">${esc(t.title)}</div>
    <div>${chip}<span class="due ${cls}">${esc(label)}</span> <span class="muted">· ${PRIORITY[t.priority]}${t.source === "ai" ? " · 🎙️AI" : ""}</span></div>
    <div class="task-actions">
      ${i > 0 ? `<button class="btn ghost sm" data-move="${t.task_id}" data-to="${ORDER[i - 1]}">← 이전</button>` : ""}
      ${i < 2 ? `<button class="btn sm" data-move="${t.task_id}" data-to="${ORDER[i + 1]}">${i === 0 ? "시작 →" : "완료 ✓"}</button>` : ""}
      <button class="btn ghost sm" data-del="${t.task_id}" aria-label="삭제">🗑</button>
    </div></article>`;
}

function render() {
  const shown = tasks.filter((t) => !filter.value || String(t.subject_id) === filter.value);
  document.querySelectorAll(".column").forEach((col) => {
    const list = shown.filter((t) => t.status === col.dataset.status);
    col.querySelector(".cards").innerHTML = list.map(card).join("") || `<p class="muted">비어 있어요</p>`;
    col.querySelector(".count").textContent = list.length;
  });
}

document.querySelector(".board").addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.move) {
    const r = await api(`/api/tasks/${b.dataset.move}`, { method: "PATCH", body: { status: b.dataset.to } });
    if (r.ok) tasks = tasks.map((t) => (t.task_id === r.data.task_id ? r.data : t));
  } else if (b.dataset.del) {
    if (!confirm("이 할 일을 삭제할까요?")) return;
    const r = await api(`/api/tasks/${b.dataset.del}`, { method: "DELETE" });
    if (r.ok) tasks = tasks.filter((t) => t.task_id !== Number(b.dataset.del));
  }
  render();
});

const form = document.getElementById("task-form");
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(form));
  const r = await api("/api/tasks", { method: "POST", body: { ...body, subject_id: body.subject_id || null } });
  if (!r.ok) return;
  tasks.push(r.data);
  form.reset();
  render();
});

filter.addEventListener("change", render);
render();
