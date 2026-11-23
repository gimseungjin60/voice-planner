// 대시보드: 한눈에 타일 + 통합 타임라인 + AI Top3 + 브리핑(TTS) + 동기화
const $ = (id) => document.getElementById(id);
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const kstNow = () => new Date(Date.now() + 9 * 3600000).toISOString().replace("T", " ").slice(0, 19);
const addDays = (ymd, n) => new Date(Date.parse(ymd) + n * 86400000).toISOString().slice(0, 10);

// ---------- 한눈에 타일 + Top3 ----------
async function loadSummary() {
  const r = await api("/api/tasks/summary");
  if (!r.ok) return;
  const s = r.data;
  $("sum-today").textContent = s.today;
  $("sum-week").textContent = s.week;
  $("sum-overdue").textContent = s.overdue;
  if (s.today) $("hero-due").innerHTML = ` · 오늘 마감 <b>${s.today}개</b>`;

  if (s.nearest) {
    const { short, cls } = dueInfo(s.nearest.due_at);
    $("sum-nearest").textContent = short;
    $("sum-nearest").className = `tile-value ${cls}`;
    $("sum-nearest-title").textContent = s.nearest.title;
  } else {
    $("sum-nearest").textContent = "없음";
    $("sum-nearest-title").textContent = "여유로워요";
  }

  $("top-note").textContent = s.ai_ok ? "" : "AI 연결 실패 · 마감순";
  $("top-list").innerHTML = s.top.length
    ? s.top
        .map((t) => {
          const { label, cls } = dueInfo(t.due_at);
          return `<li><div><div class="top3-title">${esc(t.title)}</div>
            <div class="top3-meta">${chip(t.subject_name, t.subject_color)}<span class="due ${cls}">${esc(label)}</span></div>
            <div class="top3-reason">${esc(t.reason)}</div></div></li>`;
        })
        .join("")
    : `<div class="empty" style="padding: 24px 0"><div class="empty-icon"><svg class="i"><use href="#i-check"/></svg></div><strong>남은 할 일이 없어요</strong>오늘은 마음껏 쉬어도 돼요 🎉</div>`;
}

// ---------- 받은 편지함 새 후보 ----------
async function loadInbox() {
  const r = await api("/api/inbox?status=pending", { quiet: true });
  const n = r.ok ? r.data.counts.pending : 0;
  $("sum-inbox").textContent = r.ok ? n : "-";
}

// ---------- 통합 타임라인 ----------
let range = "today";
const KIND = { class: ["book", "수업"], event: ["calendar", "일정"], task: ["flag", "마감"] };

function itemHtml(it, now) {
  const [icon, label] = KIND[it.kind];
  const start = it.kind === "task" ? it.due_at : it.start_at;
  const end = it.kind === "task" ? it.due_at : it.end_at;
  const past = end < now || it.status === "done";
  const sub =
    it.kind === "task"
      ? `<span class="due ${it.status === "done" ? "" : dueInfo(it.due_at).cls}">${it.status === "done" ? "완료" : dueInfo(it.due_at).short}</span>`
      : it.location
        ? `<span><svg class="i sm"><use href="#i-pin"/></svg> ${esc(it.location)}</span>`
        : "";
  const source = it.kind === "event" ? `<span class="badge">${it.provider === "google" ? "구글" : "직접 추가"}</span>` : "";
  return `<li class="tl-item kind-${it.kind}${past ? " past" : ""}" style="--c:${esc(it.subject_color || (it.kind === "event" ? "var(--primary-focus)" : "#8e8e93"))}">
    <div class="tl-time">${start.slice(11, 16)}<small>${it.kind === "task" ? "마감" : end.slice(11, 16)}</small></div>
    <div class="tl-bar"></div>
    <div class="tl-body">
      <div class="tl-title"><svg class="i" aria-label="${label}"><use href="#i-${icon}"/></svg>${esc(it.title)}</div>
      <div class="tl-meta">${it.subject_name && it.kind !== "class" ? chip(it.subject_name, it.subject_color) : ""}${sub}${source}</div>
    </div></li>`;
}

function renderTimeline(items, from) {
  const now = kstNow();
  const today = now.slice(0, 10);
  if (!items.length) {
    $("timeline").innerHTML = `<li class="empty"><div class="empty-icon"><svg class="i"><use href="#i-calendar"/></svg></div>
      <strong>${range === "today" ? "오늘은 일정이 없어요" : "이번 주 일정이 없어요"}</strong>말로 일정을 추가해 보세요</li>`;
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
      html += `<li class="tl-day${day === today ? " today" : ""}">${day === today ? "오늘 · " : day === addDays(today, 1) ? "내일 · " : ""}${Number(day.slice(5, 7))}월 ${Number(day.slice(8))}일 ${dow}요일</li>`;
      lastDay = day;
    }
    if (!nowShown && day === today && at(it) > now) {
      html += `<li class="tl-now" aria-label="지금">${now.slice(11, 16)}</li>`;
      nowShown = true;
    }
    html += itemHtml(it, now);
  }
  if (!nowShown && range === "today") html += `<li class="tl-now">${now.slice(11, 16)}</li>`;
  $("timeline").innerHTML = html;
}

function banner(google) {
  const box = $("tl-banner");
  if (google === "connected") return (box.innerHTML = "");
  box.innerHTML =
    google === "expired"
      ? `<div class="banner warn" style="margin: 8px 20px 0"><svg class="i"><use href="#i-alert"/></svg><span class="grow">구글 연결이 만료됐어요. 저장된 일정만 보여요</span><a class="btn sm" href="/settings">다시 연결</a></div>`
      : `<div class="banner" style="margin: 8px 20px 0"><svg class="i"><use href="#i-calendar"/></svg><span class="grow">구글 캘린더를 연결하면 일정도 여기에 모여요</span><a class="btn sm secondary" href="/settings">연결하기</a></div>`;
}

async function loadTimeline() {
  const from = kstNow().slice(0, 10);
  const to = range === "today" ? from : addDays(from, 6);
  const r = await api(`/api/timeline?from=${from}&to=${to}`, { quiet: true });
  if (r.ok) {
    banner(r.data.google);
    return renderTimeline(r.data.items, from);
  }
  // 타임라인 API가 아직 없으면 오늘 수업만이라도 보여준다
  banner("disconnected");
  const classes = JSON.parse($("classes-data").textContent);
  renderTimeline(
    classes.map((c) => ({
      kind: "class", title: c.name, subject_name: c.name, subject_color: c.color, location: c.room,
      start_at: `${from} ${c.start_time}`, end_at: `${from} ${c.end_time}`,
    })),
    from,
  );
}

$("tl-range").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || b.dataset.range === range) return;
  range = b.dataset.range;
  $("tl-range").querySelectorAll("button").forEach((x) => {
    x.classList.toggle("active", x === b);
    x.setAttribute("aria-selected", x === b);
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
  $("briefing-text").querySelector(".speaking-dot")?.remove();
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
  box.innerHTML = `<span class="speaking-dot"></span>${esc(r.data.content)}`;
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
  setTimeout(() => briefingBtn.classList.remove("loading"), 8000);
});

// ---------- 동기화 (캘린더 + Gmail) ----------
const syncBtn = $("sync-btn");
syncBtn.addEventListener("click", async () => {
  syncBtn.classList.add("loading");
  const [cal, mail] = await Promise.all([
    api("/api/sync/calendar", { method: "POST", quiet: true }),
    api("/api/sync/gmail", { method: "POST", quiet: true }),
  ]);
  syncBtn.classList.remove("loading");
  if (!cal.ok && !mail.ok) return toast("구글을 연결하면 동기화할 수 있어요");
  toast(`동기화했어요 · 일정 ${cal.data?.synced ?? 0}개, 새 과제 후보 ${mail.data?.found ?? 0}개`);
  loadTimeline();
  loadInbox();
});

// 음성 비서가 일정·할 일을 바꾸면 바로 반영
document.addEventListener("assistant:done", () => {
  loadSummary();
  loadTimeline();
});

loadSummary();
loadTimeline();
loadInbox();
