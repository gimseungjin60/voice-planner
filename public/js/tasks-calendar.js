// 할 일 월간 달력: 이번 달에 어떤 마감이 남았는지 한눈에. tasks.js의 tasks·subjectFilter·render를 같이 쓴다
// - 날짜를 누르면 오른쪽(모바일은 아래)에 그날 할 일 목록: 완료 체크 · 마감일 바꾸기 · 원본 열기 · 그날 할 일 추가
// - 할 일 칩을 다른 날짜로 끌어다 놓으면 마감일만 그 날로 바뀐다 (시각은 유지, 4초 동안 실행 취소)
// - 수업(시간표)·구글 캘린더 일정도 같은 칸에 시간순으로 (보기 전용, /api/timeline). 할 일·수업·일정은 각각 켜고 끌 수 있음
const calView = document.getElementById("cal-view");
const calGrid = document.getElementById("cal-grid");
const calSide = document.getElementById("cal-side");
const calMonthInput = document.getElementById("cal-month");
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const MAX_IN_CELL = 4;

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

// 달력에 보일 것 (이 브라우저에 기억)
let layers = { task: true, class: true, event: true };
try {
  layers = { ...layers, ...JSON.parse(localStorage.getItem("calLayers") || "{}") };
} catch {}

// 수업·구글 일정: 달(6주)마다 한 번 받아 날짜별로 보관. 실패해도 할 일은 그대로 보인다
const agenda = new Map(); // 'YYYY-MM' → Map(day → [항목])
const dayNotes = new Map(); // 'YYYY-MM-DD' → { kind, label } 공휴일·종강·시험 기간 (방학은 표시 안 함)
async function loadAgenda(ym) {
  if (agenda.has(ym)) return;
  agenda.set(ym, new Map());
  const cells = monthCells(ym);
  const r = await api(`/api/timeline?from=${cells[0]}&to=${cells[41]}`, { quiet: true });
  if (!r.ok) return agenda.delete(ym);
  for (const [d, n] of Object.entries(r.data.days || {})) if (n.kind !== "break") dayNotes.set(d, n);
  const byDay = new Map();
  for (const it of r.data.items) {
    if (it.kind === "task") continue;
    // 여러 날에 걸친 일정(종일 일정 등)은 걸친 날마다
    const last = it.end_at.slice(11) === "00:00:00" && it.end_at > it.start_at ? addDay(it.end_at.slice(0, 10), -1) : it.end_at.slice(0, 10);
    for (let d = it.start_at.slice(0, 10); d <= last && d <= cells[41]; d = addDay(d, 1)) {
      if (!byDay.has(d)) byDay.set(d, []);
      // 구글 종일 일정은 00:00:00 ~ 마지막 날 23:59:59로 저장돼 있다
      byDay.get(d).push({ ...it, allDay: it.start_at.slice(11, 16) === "00:00" && ["23:59", "00:00"].includes(it.end_at.slice(11, 16)) });
    }
  }
  agenda.set(ym, byDay);
  if (ym === calMonth) renderCalendar();
}
// 그날 수업·일정 (과목 필터는 수업에만, 일정은 과목이 없어 과목을 고르면 숨김)
function agendaOf(day) {
  const list = agenda.get(calMonth)?.get(day) || [];
  return list.filter((x) => layers[x.kind] && (!subjectFilter || (x.kind === "class" && String(x.subject_id) === subjectFilter)));
}
const hm = (dt) => dt.slice(11, 16);

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

// 구글 일정은 캘린더 로고, 직접 만든 일정은 회색 달력 아이콘
const evLogo = (x) =>
  x.provider === "google"
    ? `<span class="src-logo gcal" aria-hidden="true"><svg><use href="#logo-gcal"/></svg></span>`
    : `<svg class="i ev-ico" aria-hidden="true"><use href="#i-calendar"/></svg>`;
// 칸 안의 수업·일정 한 줄 (누르면 그 날짜 선택)
function evHtml(x) {
  const time = x.allDay ? "종일" : hm(x.start_at);
  const tip = `${x.title} · ${x.allDay ? "하루 종일" : `${hm(x.start_at)}~${hm(x.end_at)}`}${x.location ? ` · ${x.location}` : ""}`;
  return x.kind === "class"
    ? `<span class="cal-ev class" style="--c:${esc(x.subject_color || "#8e8e93")}" title="${esc(tip)}"><i aria-hidden="true"></i><span class="cal-time">${time}</span><span class="cal-item-title">${esc(x.title)}</span></span>`
    : `<span class="cal-ev event" title="${esc(tip)}">${evLogo(x)}<span class="cal-time">${time}</span><span class="cal-item-title">${esc(x.title)}</span></span>`;
}

function renderCalendar() {
  if (!calView) return;
  loadAgenda(calMonth);
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
        dayNotes.get(d)?.kind === "holiday" && "holiday",
      ]
        .filter(Boolean)
        .join(" ");
      const evs = agendaOf(d);
      const shownTasks = layers.task ? list : [];
      // 하루를 시간순으로: 종일 일정 → 시각 있는 것 → 시각 없는 마감(23:59)
      const keyOf = (x) => (x.kind ? (x.allDay ? "00:00a" : hm(x.start_at)) : x.due_at.slice(11, 16) + (x.status === "done" ? "z" : ""));
      const merged = [...evs, ...shownTasks].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
      const more = merged.length - MAX_IN_CELL;
      const classes = evs.filter((x) => x.kind === "class").length;
      const events = evs.length - classes;
      const label = [dayLabel(d), dayNotes.get(d)?.label, classes && `수업 ${classes}개`, events && `일정 ${events}개`, shownTasks.length && `할 일 ${shownTasks.length}개`, open && layers.task && `남은 할 일 ${open}개`].filter(Boolean).join(", ");
      return `<div class="${cls}" role="gridcell" data-day="${d}" tabindex="0" aria-label="${label}">
        <div class="cal-date"><span class="num">${Number(d.slice(8, 10))}</span>${dayNotes.has(d) ? `<span class="cal-note ${dayNotes.get(d).kind}" title="${esc(dayNotes.get(d).label)}">${esc(dayNotes.get(d).label)}</span>` : ""}${open && layers.task ? `<span class="cal-open" title="남은 할 일">${open}</span>` : ""}</div>
        <div class="cal-items">${merged
          .slice(0, MAX_IN_CELL)
          .map((x) => (x.kind ? evHtml(x) : itemHtml(x)))
          .join("")}${more > 0 ? `<span class="cal-more">+${more}개</span>` : ""}</div>
        <div class="cal-dots" aria-hidden="true">${merged
          .slice(0, 5)
          .map((x) =>
            x.kind === "event"
              ? `<i class="ev"></i>`
              : x.kind === "class"
                ? `<i class="cls" style="--c:${esc(x.subject_color || "#8e8e93")}"></i>`
                : `<i class="${x.status === "done" ? "done" : ""}" style="--c:${esc(x.subject_color || "#8e8e93")}"></i>`,
          )
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
  const evs = agendaOf(calSelected).sort((a, b) => (a.allDay ? "00" : hm(a.start_at)).localeCompare(b.allDay ? "00" : hm(b.start_at)));
  calSide.innerHTML = `
    <div class="cal-side-head">
      <h3>${dayLabel(calSelected)}${calSelected === kstToday() ? ' <span class="cal-badge">오늘</span>' : ""}</h3>
      <span class="muted">${list.filter((t) => t.status !== "done").length}개 남음</span>
    </div>
    ${
      evs.length
        ? `<ul class="cal-agenda" aria-label="수업·일정">${evs
            .map(
              (x) => `<li class="${x.kind}" style="--c:${esc(x.subject_color || "#1a73e8")}">
            <span class="cal-agenda-time num">${x.allDay ? "하루 종일" : `${hm(x.start_at)}<br>${hm(x.end_at)}`}</span>
            <span class="cal-agenda-body"><b>${esc(x.title)}</b><span>${x.kind === "class" ? "수업" : x.provider === "google" ? `${evLogo(x)}구글 캘린더` : `${evLogo(x)}일정`}${x.location ? ` · ${esc(x.location)}` : ""}</span></span>
          </li>`,
            )
            .join("")}</ul>`
        : ""
    }
    ${layers.task ? "" : '<p class="cal-empty">할 일 표시를 꺼 두었어요</p>'}
    ${!layers.task ? "" : list.length ? `<ul class="cal-list">${list.map(sideRow).join("")}</ul>` : `<p class="cal-empty">이 날은 마감이 없어요</p>`}
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

// 할 일 · 수업 · 구글 일정 켜고 끄기
const layerBox = document.getElementById("cal-layers");
function paintLayers() {
  layerBox.querySelectorAll("[data-layer]").forEach((b) => b.setAttribute("aria-pressed", layers[b.dataset.layer]));
}
layerBox.addEventListener("click", (e) => {
  const b = e.target.closest("[data-layer]");
  if (!b) return;
  layers[b.dataset.layer] = !layers[b.dataset.layer];
  try {
    localStorage.setItem("calLayers", JSON.stringify(layers));
  } catch {}
  paintLayers();
  renderCalendar();
});
paintLayers();

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
