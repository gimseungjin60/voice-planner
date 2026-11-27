// 대시보드: 숫자 카드 + 통합 타임라인 + 오늘 이것부터(AI) + 브리핑(TTS) + 동기화
const $ = (id) => document.getElementById(id);
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const kstNow = () => new Date(Date.now() + 9 * 3600000).toISOString().replace("T", " ").slice(0, 19);
const addDays = (ymd, n) => new Date(Date.parse(ymd) + n * 86400000).toISOString().slice(0, 10);
const hm = (v) => v.slice(11, 16);

// ---------- 숫자 카드 + 오늘 이것부터 ----------
// 숫자 카드는 AI 없이 바로(?ai=0), 오늘 이것부터는 AI 추천이 오면 그린다. 숫자 카드가 2~5초씩 비어 있지 않게
async function loadSummary() {
  const quick = api("/api/tasks/summary?ai=0", { quiet: true }).then((r) => r.ok && (renderCounts(r.data), true));
  const r = await api("/api/tasks/summary", { quiet: true });
  const countsShown = await quick;
  if (!r.ok) {
    if (!countsShown) ["sum-today", "sum-week", "sum-nearest"].forEach((id) => ($(id).textContent = "-"));
    $("top-list").innerHTML = `<li class="empty"><div class="empty-icon"><svg class="i"><use href="#i-alert"/></svg></div>
      <p class="title">할 일을 불러오지 못했어요</p><p class="desc">저장한 할 일은 그대로 있어요. 잠시 뒤 새로고침해 주세요.</p></li>`;
    return;
  }
  const s = r.data;
  renderCounts(s);
  renderTop(s);
}

function renderCounts(s) {
  $("sum-today").textContent = s.today;
  $("sum-week").textContent = s.week;
  // 지난 마감은 제목 줄에서만 한 번 알린다. 없으면 오늘 남은 마감 수를 보여 준다
  $("hero-due").innerHTML = s.overdue
    ? ` · 지난 마감 <b class="red">${s.overdue}개</b>`
    : ` · 오늘 남은 마감 <b>${s.today}개</b>`;

  if (s.nearest) {
    const { short, cls } = dueInfo(s.nearest.due_at);
    $("sum-nearest").textContent = short;
    $("sum-nearest").classList.toggle("red", cls.includes("due-red"));
    $("sum-nearest-title").textContent = `${s.nearest.title} · ${hm(s.nearest.due_at)}`;
  } else {
    $("sum-nearest").textContent = "없음";
    $("sum-nearest-title").textContent = "남은 마감이 없어요";
  }
}

function renderTop(s) {
  $("top-note").textContent = s.ai_ok ? "" : "마감 순으로 골랐어요";
  $("top-list").innerHTML = s.top.length
    ? s.top
        .map((t) => {
          const { label, cls } = dueInfo(t.due_at);
          return `<li><div>
            <div class="top3-title">${esc(t.title)}</div>
            <div class="top3-meta">${chip(t.subject_name, t.subject_color)}${t.due_at ? `<span class="due ${cls}">${esc(label)}</span>` : ""}</div>
            ${t.reason ? `<div class="top3-reason">${esc(t.reason)}</div>` : ""}</div></li>`;
        })
        .join("")
    : `<li class="empty"><div class="empty-icon green"><svg class="i"><use href="#i-check"/></svg></div>
        <p class="title">오늘은 마음껏 쉬어도 돼요</p><p class="desc">남은 할 일이 없어요.</p></li>`;
}

// ---------- 받은 편지함 새 후보 ----------
async function loadInbox() {
  const r = await api("/api/inbox?status=pending", { quiet: true });
  const n = r.ok ? r.data.counts.pending : 0;
  $("sum-inbox").textContent = r.ok ? n : "-";
  $("inbox-dot").classList.toggle("hidden", !n);
}

// ---------- 통합 타임라인 ----------
let range = "today";
const KIND = { class: "수업", event: "일정", task: "마감" };

// 곧 시작: "40분 후" / "2시간 후" (3시간 안쪽만)
function soon(start, now) {
  const min = Math.round((Date.parse(start.replace(" ", "T")) - Date.parse(now.replace(" ", "T"))) / 60000);
  if (min <= 0 || min > 180) return "";
  return `<span class="badge soon">${min < 60 ? `${min}분 후` : `${Math.floor(min / 60)}시간 후`}</span>`;
}

function itemHtml(it, now, isNext) {
  const task = it.kind === "task";
  const start = task ? it.due_at : it.start_at;
  const end = task ? it.due_at : it.end_at;
  const done = it.status === "done";
  const past = !task && end < now;
  const color = it.subject_color ? `--c:${esc(it.subject_color)}` : "";
  let right = "";
  if (task) right = done ? `<span class="due done">완료</span>` : `<span class="due ${dueInfo(it.due_at).cls}">${esc(dueInfo(it.due_at).label)}</span>`;
  else if (isNext && !past) right = soon(start, now);
  if (!right && it.kind === "event" && it.provider === "google")
    right = `<span class="badge"><svg class="i" aria-hidden="true"><use href="#i-calendar"/></svg>구글</span>`;
  const body = task
    ? `<div class="tl-title"><span class="t">${esc(it.title)}</span>${it.subject_name ? chip(it.subject_name, it.subject_color, true) : ""}</div>`
    : `<div class="tl-title"><span class="dot" style="${color}"></span><span class="t">${esc(it.title)}</span></div>
       ${it.location ? `<div class="tl-place">${esc(it.location)}</div>` : ""}`;
  return `<li class="${past || done ? "past" : ""}">
    <span class="tl-time">${task ? hm(start) : `${hm(start)}~${hm(end)}`}</span><span class="tl-kind">${KIND[it.kind]}</span>
    <div class="tl-body">${body}</div><div>${right}</div></li>`;
}

const nowRow = (now) => `<li class="tl-now"><span>${hm(now)} 지금</span><i aria-hidden="true"></i></li>`;

function renderTimeline(items) {
  const now = kstNow();
  const today = now.slice(0, 10);
  if (!items.length) {
    $("timeline").innerHTML = `<li class="empty"><div class="empty-icon"><svg class="i"><use href="#i-calendar"/></svg></div>
      <p class="title">${range === "today" ? "오늘은 일정이 없어요" : "이번 주 일정이 없어요"}</p>
      <p class="desc">수업도 약속도 없는 ${range === "today" ? "하루" : "한 주"}예요.</p></li>`;
    return;
  }
  const at = (it) => (it.kind === "task" ? it.due_at : it.start_at);
  items.sort((a, b) => at(a).localeCompare(at(b)));
  let html = "";
  let lastDay = null;
  let nowShown = false;
  for (const it of items) {
    const day = at(it).slice(0, 10);
    if (range === "week" && day !== lastDay) {
      const dow = WEEK[new Date(day + "T12:00:00Z").getUTCDay()];
      html += `<li class="tl-day">${dow} ${md(day)}${day === today ? " · 오늘" : day === addDays(today, 1) ? " · 내일" : ""}</li>`;
      lastDay = day;
    }
    const next = !nowShown && day === today && at(it) > now;
    if (next) {
      html += nowRow(now);
      nowShown = true;
    }
    html += itemHtml(it, now, next);
  }
  if (!nowShown && range === "today") html += nowRow(now);
  $("timeline").innerHTML = html;
}

function banner(google) {
  const box = $("tl-banner");
  if (google === "connected") return (box.innerHTML = "");
  box.innerHTML =
    google === "expired"
      ? `<div class="banner warn"><svg class="i" aria-hidden="true"><use href="#i-warn"/></svg><span class="grow">구글 연결이 만료됐어요. 저장된 일정만 보여요</span><a class="btn sm" href="/settings">다시 연결</a></div>`
      : `<div class="banner"><svg class="i" aria-hidden="true"><use href="#i-info"/></svg><span class="grow">구글 캘린더를 연결하면 일정도 여기에 모여요</span><a class="btn sm" href="/settings">연결하기</a></div>`;
}

async function loadTimeline() {
  const from = kstNow().slice(0, 10);
  const to = range === "today" ? from : addDays(from, 6);
  const r = await api(`/api/timeline?from=${from}&to=${to}`, { quiet: true });
  if (r.ok) {
    banner(r.data.google);
    return renderTimeline(r.data.items);
  }
  // 타임라인 API가 아직 없으면 오늘 수업만이라도 보여준다
  banner("disconnected");
  const classes = JSON.parse($("classes-data").textContent);
  renderTimeline(
    classes.map((c) => ({
      kind: "class", title: c.name, subject_name: c.name, subject_color: c.color, location: c.room,
      start_at: `${from} ${c.start_time}`, end_at: `${from} ${c.end_time}`,
    })),
  );
}

$("tl-range").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || b.dataset.range === range) return;
  range = b.dataset.range;
  $("tl-range").querySelectorAll("button").forEach((x) => {
    x.classList.toggle("active", x === b);
    x.setAttribute("aria-pressed", x === b);
  });
  loadTimeline();
});

// ---------- 브리핑 듣기: OpenAI 음성(mp3)을 먼저, 안 되면 브라우저 TTS ----------
const briefingBtn = $("briefing-btn");
const briefingLabel = briefingBtn.querySelector("span");
let player = null;
const briefingDone = () => {
  player = null;
  briefingLabel.textContent = "브리핑 듣기";
  briefingBtn.classList.remove("playing");
};
briefingBtn.addEventListener("click", async () => {
  if (player || Voice.speaking) {
    player?.pause();
    Voice.stopSpeaking();
    return briefingDone();
  }
  briefingBtn.classList.add("loading");
  briefingLabel.textContent = "준비 중…";
  const r = await api("/api/briefing/today");
  if (!r.ok) {
    briefingBtn.classList.remove("loading");
    return briefingDone();
  }
  const box = $("briefing-text");
  box.textContent = r.data.content;
  box.classList.remove("hidden");
  player = new Audio("/api/briefing/today/audio");
  player.onended = briefingDone;
  player.onerror = () => {
    player = null; // 음성 파일을 못 받으면 브라우저 목소리로
    Voice.speak(r.data.content, briefingDone);
  };
  player.oncanplay = () => briefingBtn.classList.remove("loading");
  player.play().catch(() => {});
  briefingLabel.textContent = "그만 듣기";
  briefingBtn.classList.add("playing");
  setTimeout(() => briefingBtn.classList.remove("loading"), 8000);
});

// ---------- 동기화 (캘린더 + Gmail) ----------
const syncBtn = $("sync-btn");
async function sync({ auto = false } = {}) {
  syncBtn.classList.add("loading");
  syncBtn.querySelector("span").textContent = "동기화 중…";
  const [cal, mail] = await Promise.all([
    api("/api/sync/calendar", { method: "POST", quiet: true }),
    api("/api/sync/gmail", { method: "POST", quiet: true }),
  ]);
  syncBtn.classList.remove("loading");
  syncBtn.querySelector("span").textContent = "동기화";
  if (!cal.ok && !mail.ok) return auto || toast(cal.error || "구글을 연결하면 동기화할 수 있어요", { type: "fail" });
  $("sync-note").textContent = "구글 캘린더·메일 · 방금 동기화";
  if (!auto || mail.data?.found || mail.data?.auto_added) toast(syncMessage(cal, mail), { type: cal.ok && mail.ok && !mail.data.ai_failed ? "sync" : "fail" });
  loadTimeline();
  loadInbox();
}
syncBtn.addEventListener("click", () => sync());

// 대시보드에 들어왔을 때 마지막 동기화가 10분 넘게 지났으면 자동 1회 (@Dev.md logic 9)
api("/api/integrations", { quiet: true }).then((r) => {
  const g = r.ok && r.data.google;
  if (!g || !g.connected || g.expired) return;
  const last = g.last_synced_at ? Date.parse(g.last_synced_at.replace(" ", "T") + "+09:00") : 0;
  if (Date.now() - last > 10 * 60 * 1000) sync({ auto: true });
});

// 음성 비서가 일정·할 일을 바꾸면 바로 반영
document.addEventListener("assistant:done", () => {
  loadSummary();
  loadTimeline();
});

loadSummary();
loadTimeline();
loadInbox();
