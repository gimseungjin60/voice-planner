// 할 일 보드: 3열 카드. 체크·이동 버튼 → PATCH → 새로고침 없이 다시 그림. 이동 후 4초 동안 실행 취소
let tasks = JSON.parse(document.getElementById("tasks-data").textContent);
const filter = document.getElementById("subject-filter");
const board = document.querySelector(".board");
const ORDER = ["todo", "doing", "done"];
const STATUS_LABEL = { todo: "할 일", doing: "진행 중", done: "완료" };
const SOURCE = { ai: ["mic", "음성 메모"], voice: ["chat", "음성 비서"], gmail: ["mail", "메일"] }; // 직접 추가는 배지 없음

function card(t) {
  const done = t.status === "done";
  const { label, cls } = dueInfo(t.due_at);
  const src = SOURCE[t.source];
  const move = (to, text, style) => `<button class="btn ${style} sm" data-move="${t.task_id}" data-to="${to}">${text}</button>`;
  const prev = `<svg class="i sm" aria-hidden="true"><use href="#i-chevron-left"/></svg>`;
  const next = `<svg class="i sm" aria-hidden="true"><use href="#i-chevron"/></svg>`;
  return `<article class="task${done ? " done" : ""}">
    <button class="check${done ? " on" : ""}" data-move="${t.task_id}" data-to="${done ? "todo" : "done"}" aria-label="${done ? "완료 취소" : "완료로 표시"}: ${esc(t.title)}"></button>
    <div class="task-title">${esc(t.title)}</div>
    <div class="task-meta">
      ${t.subject_name ? chip(t.subject_name, t.subject_color) : ""}
      ${done ? (t.completed_at ? `<span class="due done">완료 ${md(t.completed_at)}</span>` : "") : t.due_at ? `<span class="due ${cls}">${esc(label)}</span>` : ""}
    </div>
    ${done ? "" : `<div class="task-sub">${prio(t.priority)}${src ? `<span class="src"><svg class="i" aria-hidden="true"><use href="#i-${src[0]}"/></svg>${src[1]}</span>` : ""}</div>`}
    ${
      t.status === "todo"
        ? `<div class="task-actions"><span class="spacer"></span>${move("doing", `시작하기${next}`, "line")}</div>`
        : t.status === "doing"
          ? `<div class="task-actions">${move("todo", `${prev}할 일로`, "line")}<span class="spacer"></span>${move("done", `완료${next}`, "")}</div>`
          : ""
    }
    <button class="icon-btn danger del" data-del="${t.task_id}" aria-label="삭제: ${esc(t.title)}"><svg class="i sm"><use href="#i-trash"/></svg></button>
  </article>`;
}

const EMPTY = { todo: "할 일이 없어요. 위에서 추가하거나 말로 남겨보세요", doing: "진행 중인 일이 없어요", done: "아직 완료한 할 일이 없어요" };

function render() {
  const shown = tasks.filter((t) => !filter.value || String(t.subject_id) === filter.value);
  document.querySelectorAll(".column").forEach((col) => {
    const st = col.dataset.status;
    const list = shown.filter((t) => t.status === st);
    col.querySelector(".cards").innerHTML = list.map(card).join("") || `<div class="empty-col">${EMPTY[st]}</div>`;
    col.querySelector(".count").textContent = list.length;
  });
  document.getElementById("total-count").textContent = `· ${shown.filter((t) => t.status !== "done").length}개 남음`;
}

async function moveTask(id, to) {
  const r = await api(`/api/tasks/${id}`, { method: "PATCH", body: { status: to } });
  if (!r.ok) return null;
  tasks = tasks.map((t) => (t.task_id === r.data.task_id ? r.data : t));
  render();
  return r.data;
}

board.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.move) {
    const id = Number(b.dataset.move);
    const from = tasks.find((t) => t.task_id === id).status;
    const t = await moveTask(id, b.dataset.to);
    if (!t) return;
    toast(t.status === "done" ? `‘${t.title}’ 완료했어요` : `‘${STATUS_LABEL[t.status]}’로 옮겼어요`, {
      action: { label: "실행 취소", onClick: () => moveTask(id, from) },
    });
  } else if (b.dataset.del) {
    const id = Number(b.dataset.del);
    if (!(await ask("이 할 일을 삭제할까요?\n삭제하면 되돌릴 수 없어요.", "삭제"))) return;
    const r = await api(`/api/tasks/${id}`, { method: "DELETE" });
    if (!r.ok) return;
    tasks = tasks.filter((x) => x.task_id !== id);
    render();
    toast("할 일을 삭제했어요");
  }
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
  toast("할 일을 추가했어요");
});

filter.addEventListener("change", render);
render();
