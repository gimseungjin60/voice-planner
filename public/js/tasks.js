// 할 일 보드: 3열 카드. 체크·이동 버튼 → PATCH → 새로고침 없이 다시 그림. 이동 후 4초 동안 실행 취소
let tasks = JSON.parse(document.getElementById("tasks-data").textContent);
const filterNav = document.getElementById("subject-filter");
let subjectFilter = "";
const board = document.querySelector(".board");
const ORDER = ["todo", "doing", "done"];
const STATUS_LABEL = { todo: "할 일", doing: "진행 중", done: "완료" };
// 할 일이 어디서 왔는지 짧은 배지로 (직접 추가는 배지 없음)
// [로고 심볼, 이름, 색 클래스] — 서비스마다 고유 색 타일로 한눈에 구분 (Todoist·Akiflow 연동 칩 방식)
const SOURCE = { ai: ["memo", "음성 메모", "memo"], voice: ["voice", "음성 비서", "voice"], gmail: ["gmail", "Gmail", "gmail"], notion: ["notion", "Notion", "notion"], google: ["gcal", "캘린더", "gcal"] };

// 출처 로고 타일만 (달력 칸처럼 좁은 곳)
function srcLogo(t) {
  const src = SOURCE[t.source];
  return src ? `<span class="src-logo ${src[2]}" aria-hidden="true"><svg><use href="#logo-${src[0]}"/></svg></span>` : "";
}
// 출처 배지: 로고 타일 + 이름. 원본 주소가 있으면 누르면 그 페이지로 이동
function srcBadge(t) {
  const src = SOURCE[t.source];
  if (!src) return "";
  const link = sourceLink(t);
  const inner = `${srcLogo(t)}<span class="src-label">${src[1]}</span>${link && link.ext ? '<svg class="i src-ext" aria-hidden="true"><use href="#i-external"/></svg>' : ""}`;
  return link
    ? `<a class="src ${src[2]}" ${linkAttrs(link)} title="${link.label}">${inner}</a>`
    : `<span class="src ${src[2]}" title="출처: ${src[1]}">${inner}</span>`;
}

// 출처 원본 주소: Gmail 메일 · 노션 페이지 · 음성 메모 상세. 없으면 null
function sourceLink(t) {
  if (t.source === "gmail" && t.mail_id) return { href: `https://mail.google.com/mail/#all/${encodeURIComponent(t.mail_id)}`, label: "Gmail에서 원본 메일 열기", ext: true };
  if (t.external_id && /^[0-9a-f-]{32,36}$/i.test(t.external_id))
    return { href: `https://www.notion.so/${t.external_id.replace(/-/g, "")}`, label: t.source === "notion" ? "Notion에서 원본 열기" : "Notion에서 열기", ext: true };
  if ((t.source === "ai" || t.source === "voice") && t.memo_id) return { href: `/memos/${t.memo_id}`, label: "원본 음성 메모 보기", ext: false };
  return null;
}
const linkAttrs = (l) => `href="${esc(l.href)}"${l.ext ? ' target="_blank" rel="noopener"' : ""}`;

function card(t) {
  const done = t.status === "done";
  const { label, cls } = dueInfo(t.due_at);
  const link = sourceLink(t);
  // 제목 줄 오른쪽: 다음 단계로 옮기는 아이콘 버튼 1개 + '…' 메뉴(이전 단계로 · 삭제)
  const step = { todo: ["doing", "play", "시작하기"], doing: ["done", "check", "완료"] }[t.status];
  const back = { doing: ["todo", "할 일로 되돌리기"], done: ["doing", "진행 중으로 되돌리기"] }[t.status];
  return `<article class="task${done ? " done" : ""}${t.priority === "high" && !done ? " high" : ""}">
    <button class="check${done ? " on" : ""}" data-move="${t.task_id}" data-to="${done ? "todo" : "done"}" aria-label="${done ? "완료 취소" : "완료로 표시"}: ${esc(t.title)}"></button>
    <div class="task-title">${esc(t.title)}</div>
    <div class="task-tools">
      ${step ? `<button class="icon-btn step" data-move="${t.task_id}" data-to="${step[0]}" title="${step[2]}" aria-label="${step[2]}: ${esc(t.title)}"><svg class="i sm" aria-hidden="true"><use href="#i-${step[1]}"/></svg></button>` : ""}
      <details class="pop">
        <summary class="icon-btn" aria-label="더 보기: ${esc(t.title)}"><svg class="i sm" aria-hidden="true"><use href="#i-more"/></svg></summary>
        <div class="menu">
          ${link ? `<a ${linkAttrs(link)}>${link.label}</a>` : ""}
          ${back ? `<button data-move="${t.task_id}" data-to="${back[0]}">${back[1]}</button>` : ""}
          <button class="danger" data-del="${t.task_id}">삭제</button>
        </div>
      </details>
    </div>
    <div class="task-meta">
      ${t.subject_name ? chip(t.subject_name, t.subject_color, true) : ""}
      ${done ? (t.completed_at ? `<span class="due done">완료 ${when(t.completed_at)}</span>` : "") : t.due_at ? `<span class="due ${cls}">${esc(label)}</span>` : ""}
      ${t.priority === "high" && !done ? `<span class="prio-high"><svg class="i sm" aria-hidden="true"><use href="#i-flag"/></svg>중요</span>` : ""}
      ${srcBadge(t)}
    </div>
  </article>`;
}

const DONE_LIMIT = 5;
let showAllDone = false;
const EMPTY = { todo: "할 일이 없어요. 위에서 추가하거나 말로 남겨보세요", doing: "진행 중인 일이 없어요", done: "아직 완료한 할 일이 없어요" };

function render() {
  const shown = tasks.filter((t) => !subjectFilter || String(t.subject_id) === subjectFilter);
  document.querySelectorAll(".column").forEach((col) => {
    const st = col.dataset.status;
    const list = shown.filter((t) => t.status === st);
    // 완료 열은 최근 5개만 보이고 나머지는 접는다 (열 길이 균형)
    const cut = st === "done" && !showAllDone && list.length > DONE_LIMIT;
    const visible = st === "done" ? [...list].sort((a, b) => (b.completed_at || "").localeCompare(a.completed_at || "")) : list;
    col.querySelector(".cards").innerHTML =
      (cut ? visible.slice(0, DONE_LIMIT) : visible).map(card).join("") +
        (cut ? `<button type="button" class="more-done" data-more-done>완료 ${list.length - DONE_LIMIT}개 더 보기</button>` : "") ||
      `<div class="empty-col">${EMPTY[st]}</div>`;
    col.querySelector(".count").textContent = list.length;
  });
  document.getElementById("total-count").textContent = `${shown.filter((t) => t.status !== "done").length}개 남음`;
  if (typeof renderCalendar === "function") renderCalendar(); // 달력 보기도 같은 데이터로 다시 그림
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
  b.closest("details")?.removeAttribute("open");
  if (b.hasAttribute("data-more-done")) return (showAllDone = true), render();
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

// 카드에서 우클릭: 브라우저 메뉴 대신 카드의 '…' 메뉴(원본 열기 · 되돌리기 · 삭제)를 연다
board.addEventListener("contextmenu", (e) => {
  const pop = e.target.closest(".task")?.querySelector("details.pop");
  if (!pop || e.target.closest("a")) return;
  e.preventDefault();
  document.querySelectorAll("details.pop[open]").forEach((m) => m !== pop && (m.open = false));
  pop.open = true;
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

// 과목 칩 필터 (메모 목록과 같은 모양)
filterNav.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  subjectFilter = b.dataset.subject;
  filterNav.querySelectorAll("button").forEach((x) => {
    x.classList.toggle("active", x === b);
    x.setAttribute("aria-pressed", x === b);
  });
  render();
});

// 마감 빠른 선택: 오늘 23:59 · 내일 23:59 · 이번 주 일요일 23:59 (한국 시간)
const dueInput = document.getElementById("t-due");
const quickBtns = document.querySelectorAll("[data-quick]");
document.querySelector(".due-quick").addEventListener("click", (e) => {
  const b = e.target.closest("[data-quick]");
  if (!b) return;
  const today = new Date(Date.now() + 9 * 3600000); // UTC 필드로 한국 날짜를 읽는다
  const add = { today: 0, tomorrow: 1, week: (7 - today.getUTCDay()) % 7 }[b.dataset.quick];
  dueInput.value = new Date(today.getTime() + add * 86400000).toISOString().slice(0, 10) + "T23:59";
  quickBtns.forEach((x) => x.classList.toggle("on", x === b));
});
dueInput.addEventListener("input", () => quickBtns.forEach((x) => x.classList.remove("on")));
form.addEventListener("reset", () => quickBtns.forEach((x) => x.classList.remove("on")));
render();
