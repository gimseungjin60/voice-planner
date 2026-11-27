// 할 일 월간 달력: 이번 달에 어떤 마감이 남았는지 한눈에. tasks.js의 tasks·subjectFilter·render를 같이 쓴다
// - 날짜를 누르면 오른쪽(모바일은 아래)에 그날 할 일 목록: 완료 체크 · 마감일 바꾸기 · 원본 열기 · 그날 할 일 추가
// - 할 일 칩을 다른 날짜로 끌어다 놓으면 마감일만 그 날로 바뀐다 (시각은 유지, 4초 동안 실행 취소)
const calView = document.getElementById("cal-view");
const calGrid = document.getElementById("cal-grid");
const calSide = document.getElementById("cal-side");
const calMonthInput = document.getElementById("cal-month");
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const MAX_IN_CELL = 3;

const kstToday = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const pad = (n) => String(n).padStart(2, "0");
const ymOf = (ymd) => ymd.slice(0, 7);
// 'YYYY-MM-DD' + n일 (UTC 기준 계산이라 시간대 영향 없음)
const addDay = (ymd, n) => new Date(Date.parse(ymd + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const dow = (ymd) => new Date(ymd + "T00:00:00Z").getUTCDay();
const dayLabel = (ymd) => `${Number(ymd.slice(5, 7))}월 ${Number(ymd.slice(8, 10))}일 (${WEEK[dow(ymd)]})`;
const timeOf = (due) => (due && due.slice(11, 16) !== "23:59" ? due.slice(11, 16) : "");

let calMonth = ymOf(kstToday()); // 보고 있는 달 'YYYY-MM'
let calSelected = kstToday(); // 오른쪽 목록에 보여줄 날짜

// 과목 필터를 반영한 할 일
const calTasks = () => tasks.filter((t) => !subjectFilter || String(t.subject_id) === subjectFilter);

// 6주(42칸) 달력: 그 달 1일이 있는 주의 일요일부터
function monthCells(ym) {
  const first = `${ym}-01`;
  const start = addDay(first, -dow(first));
  return Array.from({ length: 42 }, (_, i) => addDay(start, i));
}

function itemHtml(t) {
  const done = t.status === "done";
  const over = !done && dueInfo(t.due_at).cls.includes("due-over");
  const time = timeOf(t.due_at);
  return `<button type="button" class="cal-item${done ? " done" : ""}${over ? " over" : ""}" draggable="true" data-task="${t.task_id}"
    style="--c:${esc(t.subject_color || "#8e8e93")}" title="${esc(t.title)}${t.subject_name ? ` · ${esc(t.subject_name)}` : ""}${time ? ` · ${time}` : ""}">
    ${srcLogo(t)}${time ? `<span class="cal-time">${time}</span>` : ""}<span class="cal-item-title">${esc(t.title)}</span></button>`;
}

function renderCalendar() {
  if (!calView) return;
  const today = kstToday();
  const [y, m] = calMonth.split("-").map(Number);
  document.getElementById("cal-title").textContent = `${y}년 ${m}월`;
  calMonthInput.value = calMonth;

  // 날짜별로 묶기 (마감 시각 순)
  const byDay = new Map();
  for (const t of calTasks()) {
    if (!t.due_at) continue;
    const d = t.due_at.slice(0, 10);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(t);
  }
  for (const list of byDay.values()) list.sort((a, b) => (a.status === "done") - (b.status === "done") || a.due_at.localeCompare(b.due_at));

  calGrid.innerHTML = monthCells(calMonth)
    .map((d) => {
      const list = byDay.get(d) || [];
      const open = list.filter((t) => t.status !== "done").length;
      const cls = [
        "cal-day",
        ymOf(d) !== calMonth && "out",
        d === today && "today",
        d === calSelected && "selected",
        d < today && "past",
        dow(d) === 0 && "sun",
        dow(d) === 6 && "sat",
      ]
        .filter(Boolean)
        .join(" ");
      const more = list.length - MAX_IN_CELL;
      return `<div class="${cls}" role="gridcell" data-day="${d}" tabindex="0" aria-label="${dayLabel(d)}, 할 일 ${list.length}개${open ? `, 남은 ${open}개` : ""}">
        <div class="cal-date"><span class="num">${Number(d.slice(8, 10))}</span>${open ? `<span class="cal-open">${open}</span>` : ""}</div>
        <div class="cal-items">${list.slice(0, MAX_IN_CELL).map(itemHtml).join("")}${more > 0 ? `<span class="cal-more">+${more}개</span>` : ""}</div>
        <div class="cal-dots" aria-hidden="true">${list
          .slice(0, 4)
          .map((t) => `<i class="${t.status === "done" ? "done" : ""}" style="--c:${esc(t.subject_color || "#8e8e93")}"></i>`)
          .join("")}</div>
      </div>`;
    })
    .join("");

  // 이번 달 요약: 남은 할 일 · 지난 마감 · 완료
  const inMonth = calTasks().filter((t) => t.due_at && ymOf(t.due_at) === calMonth);
  const left = inMonth.filter((t) => t.status !== "done");
  const over = left.filter((t) => dueInfo(t.due_at).cls.includes("due-over"));
  const done = inMonth.length - left.length;
  document.getElementById("cal-stats").innerHTML =
    `<span><b class="num">${left.length}</b>개 남음</span>` +
    (over.length ? `<span class="over"><b class="num">${over.length}</b>개 마감 지남</span>` : "") +
    `<span class="muted"><b class="num">${done}</b>개 완료</span>`;

  renderSide();
}

// 오른쪽 목록: 고른 날짜의 할 일 + 그날로 빠르게 추가 + 마감 없는 할 일
function sideRow(t) {
  const done = t.status === "done";
  return `<li class="cal-row${done ? " done" : ""}" data-task="${t.task_id}" style="--c:${esc(t.subject_color || "#8e8e93")}">
    <button class="check${done ? " on" : ""}" data-cal-toggle="${t.task_id}" aria-label="${done ? "완료 취소" : "완료로 표시"}: ${esc(t.title)}"></button>
    <div class="cal-row-body">
      <div class="cal-row-title">${esc(t.title)}</div>
      <div class="cal-row-meta">
        ${t.subject_name ? chip(t.subject_name, t.subject_color, true) : ""}
        ${srcBadge(t)}
      </div>
      <label class="cal-due"><span class="sr-only">마감일 바꾸기</span>
        <input type="datetime-local" value="${t.due_at ? t.due_at.slice(0, 16).replace(" ", "T") : ""}" data-cal-due="${t.task_id}" /></label>
    </div>
  </li>`;
}

function renderSide() {
  const list = calTasks()
    .filter((t) => t.due_at && t.due_at.slice(0, 10) === calSelected)
    .sort((a, b) => (a.status === "done") - (b.status === "done") || a.due_at.localeCompare(b.due_at));
  const noDue = calTasks().filter((t) => !t.due_at && t.status !== "done");
  calSide.innerHTML = `
    <div class="cal-side-head">
      <h3>${dayLabel(calSelected)}${calSelected === kstToday() ? ' <span class="cal-badge">오늘</span>' : ""}</h3>
      <span class="muted">${list.filter((t) => t.status !== "done").length}개 남음</span>
    </div>
    ${list.length ? `<ul class="cal-list">${list.map(sideRow).join("")}</ul>` : `<p class="cal-empty">이 날은 마감이 없어요</p>`}
    <form class="cal-add" id="cal-add">
      <input name="title" maxlength="200" required placeholder="${Number(calSelected.slice(5, 7))}/${Number(calSelected.slice(8, 10))}에 할 일 추가" aria-label="이 날 할 일 추가" />
      <button class="btn sm">추가</button>
    </form>
    ${
      noDue.length
        ? `<details class="cal-nodue"><summary>마감 없는 할 일 ${noDue.length}개</summary><p class="muted">날짜를 넣으면 달력에 표시돼요.</p><ul class="cal-list">${noDue.map(sideRow).join("")}</ul></details>`
        : ""
    }`;
}

// 한 할 일 고치기 → tasks 배열 교체 → 보드·달력 다시 그림
async function patchTask(id, body) {
  const r = await api(`/api/tasks/${id}`, { method: "PATCH", body });
  if (!r.ok) return null;
  tasks = tasks.map((t) => (t.task_id === r.data.task_id ? r.data : t));
  render();
  return r.data;
}

// 마감일을 다른 날로 (시각은 그대로, 시각이 없으면 23:59)
async function moveDue(id, day) {
  const t = tasks.find((x) => x.task_id === id);
  if (!t || (t.due_at && t.due_at.slice(0, 10) === day)) return;
  const before = t.due_at;
  const time = t.due_at ? t.due_at.slice(11, 16) : "23:59";
  const updated = await patchTask(id, { due_at: `${day} ${time}` });
  if (!updated) return;
  toast(`‘${updated.title}’ 마감을 ${dayLabel(day)}로 옮겼어요`, { action: { label: "실행 취소", onClick: () => patchTask(id, { due_at: before }) } });
}

function selectDay(day) {
  calSelected = day;
  if (ymOf(day) !== calMonth) calMonth = ymOf(day);
  renderCalendar();
}

// 달 이동
const shiftMonth = (n) => {
  const [y, m] = calMonth.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  calMonth = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  renderCalendar();
};
document.getElementById("cal-prev").addEventListener("click", () => shiftMonth(-1));
document.getElementById("cal-next").addEventListener("click", () => shiftMonth(1));
document.getElementById("cal-today").addEventListener("click", () => selectDay(kstToday()));
calMonthInput.addEventListener("change", () => {
  if (/^\d{4}-\d{2}$/.test(calMonthInput.value)) (calMonth = calMonthInput.value), renderCalendar();
});

// 날짜 칸 누르기 / 키보드(Enter·Space·화살표)
calGrid.addEventListener("click", (e) => {
  const cell = e.target.closest(".cal-day");
  if (cell) selectDay(cell.dataset.day);
});
calGrid.addEventListener("keydown", (e) => {
  const cell = e.target.closest(".cal-day");
  if (!cell) return;
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
  if (e.key === "Enter" || e.key === " ") return e.preventDefault(), selectDay(cell.dataset.day);
  if (!step) return;
  e.preventDefault();
  selectDay(addDay(cell.dataset.day, step));
  calGrid.querySelector(`[data-day="${calSelected}"]`)?.focus();
});

// 끌어다 놓기로 마감일 바꾸기
calGrid.addEventListener("dragstart", (e) => {
  const item = e.target.closest(".cal-item");
  if (!item) return;
  e.dataTransfer.setData("text/plain", item.dataset.task);
  e.dataTransfer.effectAllowed = "move";
  item.classList.add("dragging");
});
calGrid.addEventListener("dragend", (e) => e.target.closest?.(".cal-item")?.classList.remove("dragging"));
calGrid.addEventListener("dragover", (e) => {
  const cell = e.target.closest(".cal-day");
  if (!cell) return;
  e.preventDefault();
  calGrid.querySelectorAll(".drop").forEach((c) => c !== cell && c.classList.remove("drop"));
  cell.classList.add("drop");
});
calGrid.addEventListener("dragleave", (e) => {
  const cell = e.target.closest(".cal-day");
  if (cell && !cell.contains(e.relatedTarget)) cell.classList.remove("drop");
});
calGrid.addEventListener("drop", (e) => {
  const cell = e.target.closest(".cal-day");
  if (!cell) return;
  e.preventDefault();
  cell.classList.remove("drop");
  const id = Number(e.dataTransfer.getData("text/plain"));
  if (id) moveDue(id, cell.dataset.day);
});

// 오른쪽 목록: 완료 체크 · 마감일 바꾸기 · 그날 할 일 추가
calSide.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-cal-toggle]");
  if (!b) return;
  const id = Number(b.dataset.calToggle);
  const t = tasks.find((x) => x.task_id === id);
  const from = t.status;
  const updated = await patchTask(id, { status: from === "done" ? "todo" : "done" });
  if (updated?.status === "done") toast(`‘${updated.title}’ 완료했어요`, { action: { label: "실행 취소", onClick: () => patchTask(id, { status: from }) } });
});
calSide.addEventListener("change", async (e) => {
  const input = e.target.closest("[data-cal-due]");
  if (!input || !input.value) return;
  const id = Number(input.dataset.calDue);
  const updated = await patchTask(id, { due_at: input.value.replace("T", " ") });
  if (updated) {
    toast(`마감을 ${dayLabel(updated.due_at.slice(0, 10))} ${updated.due_at.slice(11, 16)}로 바꿨어요`);
    selectDay(updated.due_at.slice(0, 10));
  }
});
calSide.addEventListener("submit", async (e) => {
  if (e.target.id !== "cal-add") return;
  e.preventDefault();
  const title = new FormData(e.target).get("title");
  const r = await api("/api/tasks", { method: "POST", body: { title, due_at: `${calSelected} 23:59`, priority: "mid", subject_id: subjectFilter || null } });
  if (!r.ok) return;
  tasks.push(r.data);
  render();
  toast(`${dayLabel(calSelected)}에 할 일을 추가했어요`);
  document.querySelector("#cal-add input")?.focus();
});

// 보기 전환 (달력 / 보드). 고른 보기는 이 브라우저에 기억
const boardEl = document.querySelector(".board");
const toggle = document.getElementById("view-toggle");
function setView(v) {
  calView.hidden = v !== "calendar";
  boardEl.hidden = v === "calendar";
  toggle.querySelectorAll("button").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === v);
    b.setAttribute("aria-pressed", b.dataset.view === v);
  });
  try {
    localStorage.setItem("tasksView", v);
  } catch {}
}
toggle.addEventListener("click", (e) => {
  const b = e.target.closest("[data-view]");
  if (b) setView(b.dataset.view);
});
let savedView = "calendar";
try {
  savedView = localStorage.getItem("tasksView") || "calendar";
} catch {}
setView(savedView === "board" ? "board" : "calendar");
renderCalendar();
