// 할 일 보드: 3열 카드. 체크·이동 버튼 → PATCH → 새로고침 없이 다시 그림
let tasks = JSON.parse(document.getElementById("tasks-data").textContent);
const filter = document.getElementById("subject-filter");
const board = document.querySelector(".board");
const ORDER = ["todo", "doing", "done"];
const PRIORITY = { high: "높음", mid: "보통", low: "낮음" };
const SOURCE = { ai: ["mic", "음성 메모"], voice: ["sparkles", "음성 비서"], gmail: ["mail", "메일"] };

function card(t) {
  const i = ORDER.indexOf(t.status);
  const done = t.status === "done";
  const { label, cls } = dueInfo(t.due_at);
  const src = SOURCE[t.source];
  const doneAt = done && t.completed_at ? `<span class="fine">완료 ${Number(t.completed_at.slice(5, 7))}/${Number(t.completed_at.slice(8, 10))}</span>` : "";
  return `<article class="task${done ? " done" : ""}">
    <button class="check${done ? " on" : ""}" data-move="${t.task_id}" data-to="${done ? "todo" : "done"}" aria-label="${done ? "완료 취소" : "완료로 표시"}"></button>
    <div class="task-title">${esc(t.title)}</div>
    <div class="task-meta">
      ${t.subject_name ? chip(t.subject_name, t.subject_color) : ""}
      <span class="due ${done ? "" : cls}">${esc(label)}</span>
      <span class="prio ${t.priority}" title="우선순위 ${PRIORITY[t.priority]}" aria-label="우선순위 ${PRIORITY[t.priority]}"><i></i><i></i><i></i></span>
      ${src ? `<span class="badge"><svg class="i"><use href="#i-${src[0]}"/></svg>${src[1]}</span>` : ""}
      ${doneAt}
    </div>
    <div class="task-actions">
      ${i > 0 ? `<button class="btn plain sm" data-move="${t.task_id}" data-to="${ORDER[i - 1]}"><svg class="i sm"><use href="#i-chevron-left"/></svg>${i === 1 ? "할 일로" : "진행 중으로"}</button>` : ""}
      ${i === 0 ? `<button class="btn plain sm" data-move="${t.task_id}" data-to="doing">시작하기<svg class="i sm"><use href="#i-chevron"/></svg></button>` : ""}
      <span class="spacer"></span>
      <button class="btn plain danger icon sm" data-del="${t.task_id}" aria-label="삭제"><svg class="i sm"><use href="#i-trash"/></svg></button>
    </div></article>`;
}

const EMPTY = { todo: "할 일이 없어요. 위에서 추가하거나 말로 남겨보세요", doing: "진행 중인 일이 없어요", done: "완료한 일이 여기에 모여요" };

function render() {
  const shown = tasks.filter((t) => !filter.value || String(t.subject_id) === filter.value);
  document.querySelectorAll(".column").forEach((col) => {
    const st = col.dataset.status;
    const list = shown.filter((t) => t.status === st);
    col.querySelector(".cards").innerHTML = list.map(card).join("") || `<div class="column-empty">${EMPTY[st]}</div>`;
    col.querySelector(".count").textContent = list.length;
  });
  document.getElementById("total-count").textContent = `${shown.filter((t) => t.status !== "done").length}개 남음`;
}

board.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.move) {
    const r = await api(`/api/tasks/${b.dataset.move}`, { method: "PATCH", body: { status: b.dataset.to } });
    if (!r.ok) return;
    tasks = tasks.map((t) => (t.task_id === r.data.task_id ? r.data : t));
    if (b.dataset.to === "done") toast("완료했어요 👏");
  } else if (b.dataset.del) {
    const id = Number(b.dataset.del);
    const t = tasks.find((x) => x.task_id === id);
    if (!(await ask(`'${t.title}'을(를) 삭제할까요?`, "삭제"))) return;
    const r = await api(`/api/tasks/${id}`, { method: "DELETE" });
    if (r.ok) tasks = tasks.filter((x) => x.task_id !== id);
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
  document.getElementById("t-title").focus();
  render();
});

filter.addEventListener("change", render);
render();
