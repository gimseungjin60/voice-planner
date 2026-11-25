// UI 미리보기 서버: DB·AI 없이 가짜 데이터로 실제 views/·public/을 그대로 띄운다 (개발용)
// 실행: npm run preview → http://localhost:3001
// 상태 바꿔 보기: 아무 주소 뒤에 ?google=connected|expired|disconnected, ?notion=on|off
const path = require("path");
const express = require("express");

const root = path.join(__dirname, "..");
const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(root, "views"));
app.use(express.json());
app.use(express.static(path.join(root, "public")));

// ---------- 날짜 도우미 (한국 시간) ----------
const kst = (d = new Date()) => d.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" });
const today = () => kst().slice(0, 10);
const addDays = (ymd, n) => new Date(Date.parse(ymd) + n * 86400000).toISOString().slice(0, 10);
const at = (days, hm) => `${addDays(today(), days)} ${hm}:00`;
const dowOf = (ymd) => new Date(ymd + "T12:00:00Z").getUTCDay();
const minutesAgo = (m) => kst(new Date(Date.now() - m * 60000));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (res, data, status = 200) => res.status(status).json({ ok: true, data });
const fail = (res, status, error) => res.status(status).json({ ok: false, error });

// ---------- 가짜 데이터 ----------
const user = { user_id: 2, email: "student@vp.com", user_name: "김학생", role: "admin" };
const state = { loggedIn: true, google: "connected", notion: false, notionRef: "", googleSynced: minutesAgo(12), seq: 100, pending: null };

const subjects = [
  { subject_id: 1, name: "심화응용프로젝트", professor: "류교수", color: "#6C8EF5", schedules: [] },
  { subject_id: 2, name: "데이터베이스", professor: "박교수", color: "#F5A86C", schedules: [] },
  { subject_id: 3, name: "운영체제", professor: "이교수", color: "#7CC9A0", schedules: [] },
];
const schedules = [
  { schedule_id: 1, subject_id: 1, day_of_week: 1, start_time: "10:00:00", end_time: "12:00:00", room: "공학관 301" },
  { schedule_id: 2, subject_id: 2, day_of_week: 2, start_time: "13:30:00", end_time: "15:30:00", room: "공학관 204" },
  { schedule_id: 3, subject_id: 2, day_of_week: 4, start_time: "13:00:00", end_time: "14:00:00", room: "공학관 204" },
  { schedule_id: 4, subject_id: 3, day_of_week: 3, start_time: "09:00:00", end_time: "11:00:00", room: "정보관 102" },
  { schedule_id: 5, subject_id: 3, day_of_week: 1, start_time: "14:00:00", end_time: "15:30:00", room: "정보관 실습실" },
];
const subj = (id) => subjects.find((s) => s.subject_id === Number(id));
const withSubject = (row) => ({ ...row, subject_name: subj(row.subject_id)?.name || null, subject_color: subj(row.subject_id)?.color || null });
const subjectsWithSchedules = () =>
  subjects.map((s) => ({ ...s, schedules: schedules.filter((x) => x.subject_id === s.subject_id).sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time)) }));

let tasks = [
  { task_id: 1, subject_id: 2, memo_id: 1, title: "ERD 과제 제출", due_at: at(8, "23:59"), priority: "high", status: "todo", source: "ai" },
  { task_id: 2, subject_id: 2, memo_id: 1, title: "DB 퀴즈 준비", due_at: at(3, "13:00"), priority: "mid", status: "doing", source: "ai" },
  { task_id: 3, subject_id: 1, memo_id: null, title: "기말 발표 PDF 제출", due_at: at(4, "23:59"), priority: "high", status: "todo", source: "manual" },
  { task_id: 4, subject_id: 3, memo_id: 3, title: "운영체제 3장 복습", due_at: at(0, "21:00"), priority: "mid", status: "todo", source: "voice" },
  { task_id: 5, subject_id: 1, memo_id: null, title: "캡스톤 회의록 정리해서 공유", due_at: at(1, "18:00"), priority: "low", status: "doing", source: "manual" },
  { task_id: 6, subject_id: 3, memo_id: null, title: "OS 과제 2 제출", due_at: at(-2, "23:59"), priority: "high", status: "done", source: "ai", completed_at: at(-3, "20:10") },
  { task_id: 7, subject_id: null, memo_id: null, title: "도서관 책 반납", due_at: at(6, "18:00"), priority: "low", status: "todo", source: "manual" },
  { task_id: 9, subject_id: 2, memo_id: null, title: "DB 실습 3 제출", due_at: at(0, "12:00"), priority: "mid", status: "done", source: "manual", completed_at: at(0, "11:20") },
  { task_id: 10, subject_id: 1, memo_id: null, title: "발표 자료 초안 작성", due_at: at(1, "23:59"), priority: "high", status: "done", source: "voice", completed_at: at(0, "10:05") },
  { task_id: 11, subject_id: 3, memo_id: null, title: "OS 2장 정리", due_at: at(-8, "23:59"), priority: "low", status: "done", source: "manual", completed_at: at(-9, "21:00") },
  { task_id: 8, subject_id: 1, memo_id: null, title: "기말 발표 리허설", due_at: at(3, "15:00"), priority: "mid", status: "todo", source: "gmail" },
];
const taskOut = (t) => withSubject({ completed_at: null, created_at: at(-5, "10:00"), ...t });

let events = [
  { event_id: 1, provider: "manual", title: "캡스톤 조 회의", start_at: at(0, "16:30"), end_at: at(0, "17:30"), location: "도서관 스터디룸" },
  { event_id: 2, provider: "google", title: "치과 예약", start_at: at(1, "11:00"), end_at: at(1, "11:30"), location: "학교 앞 치과" },
  { event_id: 3, provider: "google", title: "동아리 정기 모임", start_at: at(2, "18:00"), end_at: at(2, "20:00"), location: null },
  { event_id: 4, provider: "google", title: "팀플 중간 점검", start_at: at(4, "19:00"), end_at: at(4, "20:00"), location: "온라인 (Zoom)" },
];

let memos = [
  { memo_id: 1, subject_id: 2, memo_type: "memo", transcript: "데이터베이스 교수님이 다음 주 화요일까지 ERD 과제 내래 그리고 목요일에 퀴즈 있대", summary: "DB: ERD 과제(다음 주 화) / 퀴즈(목)", duration_sec: 8, created_at: minutesAgo(60 * 26) },
  { memo_id: 2, subject_id: 3, memo_type: "lecture", transcript: "오늘은 프로세스 스케줄링을 배웁니다. FCFS는 먼저 온 순서대로 처리하고, SJF는 실행 시간이 짧은 작업부터 처리합니다. 라운드 로빈은 타임 퀀텀만큼 돌아가며 실행하는데, 퀀텀이 너무 작으면 문맥 교환 오버헤드가 커집니다. 기말에 SJF와 라운드 로빈 비교 문제가 나올 수 있습니다.", summary: "• FCFS는 도착 순서대로 처리한다\n• SJF는 실행 시간이 짧은 작업을 먼저 처리해 평균 대기 시간이 가장 짧다\n• 라운드 로빈은 타임 퀀텀 단위로 번갈아 실행한다\n• 퀀텀이 작을수록 문맥 교환 오버헤드가 커진다\n\n[시험 포인트]\n★ SJF와 라운드 로빈의 평균 대기 시간 비교\n★ 타임 퀀텀 크기와 오버헤드의 관계", duration_sec: 1820, created_at: minutesAgo(60 * 50) },
  { memo_id: 3, subject_id: 3, memo_type: "memo", transcript: "오늘 밤까지 운영체제 3장 복습해야 해", summary: "운영체제 3장 복습 (오늘 밤)", duration_sec: 4, created_at: minutesAgo(180) },
  { memo_id: 4, subject_id: null, memo_type: "memo", transcript: "이번 주 토요일에 도서관 책 반납하기", summary: null, duration_sec: 5, created_at: minutesAgo(60 * 72) },
  { memo_id: 5, subject_id: 1, memo_type: "memo", transcript: "캡스톤 회의 끝나면 회의록 정리해서 단톡방에 공유", summary: "회의록 정리·공유 (내일 저녁)", duration_sec: 6, created_at: minutesAgo(60 * 5) },
];
const memoOut = (m) => withSubject(m);

let inbox = [
  { item_id: 1, sender: "박교수 <prof.park@inhatc.ac.kr>", subject: "[데이터베이스] 기말 리포트 제출 안내", received_at: at(-1, "09:12"), subject_id: 2, ai_title: "기말 리포트 제출", ai_due_at: at(12, "23:59"), status: "pending", task_id: null },
  { item_id: 2, sender: "운영체제 조교 <os-ta@inhatc.ac.kr>", subject: "[운영체제] 퀴즈 범위 공지 (5~7장)", received_at: at(0, "08:40"), subject_id: 3, ai_title: "운영체제 퀴즈 준비 (5~7장)", ai_due_at: at(5, "10:00"), status: "pending", task_id: null },
  { item_id: 3, sender: "류교수 <prof.ryu@inhatc.ac.kr>", subject: "[심화응용프로젝트] 기말 발표 순서 안내", received_at: at(-2, "14:03"), subject_id: 1, ai_title: "기말 발표 리허설", ai_due_at: at(3, "15:00"), status: "accepted", task_id: 8 },
  { item_id: 4, sender: "학생지원팀 <help@inhatc.ac.kr>", subject: "[공지] 동계 계절학기 수강신청 안내", received_at: at(-3, "10:00"), subject_id: null, ai_title: "계절학기 수강신청", ai_due_at: at(9, "17:00"), status: "ignored", task_id: null },
];

// ---------- 공통 미들웨어 ----------
app.use((req, res, next) => {
  if (["connected", "expired", "disconnected"].includes(req.query.google)) state.google = req.query.google;
  if (req.query.notion) state.notion = req.query.notion === "on";
  res.locals.user = state.loggedIn ? user : null;
  res.locals.path = req.path;
  next();
});

// ---------- 화면 ----------
app.get(["/login", "/signup"], (req, res) => {
  res.locals.user = null;
  res.render("login", { title: req.path === "/signup" ? "회원가입" : "로그인", mode: req.path.slice(1) });
});
app.use((req, res, next) => (state.loggedIn || req.path.startsWith("/api") ? next() : res.redirect("/login")));

const classesOn = (ymd) =>
  schedules
    .filter((x) => x.day_of_week === dowOf(ymd))
    .map((x) => ({ ...x, name: subj(x.subject_id).name, color: subj(x.subject_id).color }))
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

app.get("/", (req, res) => res.render("dashboard", { title: "대시보드", today: kst(), classes: classesOn(today()), subjects: subjectsWithSchedules(), todayDow: dowOf(today()) }));
app.get("/memo", (req, res) => res.render("memo", { title: "음성 메모", subjects: subjectsWithSchedules() }));
app.get("/memos", (req, res) => {
  const subject = Number(req.query.subject) || null;
  const all = memos.filter((m) => !subject || m.subject_id === subject).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const pages = Math.max(1, Math.ceil(all.length / 10));
  const page = Math.min(Math.max(1, Number(req.query.page) || 1), pages);
  res.render("memos", { title: "메모 목록", list: { items: all.slice((page - 1) * 10, page * 10).map(memoOut), page, pages, total: all.length }, subjects: subjectsWithSchedules(), subject });
});
app.get("/memos/:id", (req, res) => {
  const m = memos.find((x) => x.memo_id === Number(req.params.id));
  if (!m) return res.status(404).render("error", { title: "404", message: "메모를 찾을 수 없어요" });
  res.render("memo-detail", { title: "메모 상세", memo: { ...memoOut(m), tasks: tasks.filter((t) => t.memo_id === m.memo_id) } });
});
app.get("/tasks", (req, res) =>
  res.render("tasks", { title: "할 일 보드", tasks: [...tasks].sort((a, b) => (a.due_at || "9").localeCompare(b.due_at || "9")).map(taskOut), subjects: subjectsWithSchedules() }),
);
app.get("/timetable", (req, res) => res.render("timetable", { title: "시간표", subjects: subjectsWithSchedules(), todayDow: dowOf(today()) }));
app.get("/subjects/:id", (req, res) => {
  const s = subjectsWithSchedules().find((x) => x.subject_id === Number(req.params.id));
  if (!s) return res.status(404).render("error", { title: "404", message: "과목을 찾을 수 없어요" });
  const mine = (x) => x.subject_id === s.subject_id;
  const subject = {
    ...s,
    tasks: tasks.filter(mine).sort((a, b) => (a.status === "done") - (b.status === "done") || (a.due_at || "9").localeCompare(b.due_at || "9")),
    memos: memos.filter(mine).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    mails: inbox.filter(mine),
  };
  res.render("subject", { title: s.name, subject });
});
app.get("/report", (req, res) => {
  const t0 = today();
  const mon = addDays(t0, -((dowOf(t0) + 6) % 7));
  const next = addDays(mon, 7);
  const last = addDays(mon, -7);
  const inWeek = (v, a, b) => v && v.slice(0, 10) >= a && v.slice(0, 10) < b;
  const done = tasks.filter((t) => inWeek(t.completed_at, mon, next));
  const due = tasks.filter((t) => inWeek(t.due_at, mon, next));
  const groups = [...new Set(due.map((t) => t.subject_id))].map((id) => {
    const g = due.filter((t) => t.subject_id === id);
    return { name: subj(id)?.name || null, color: subj(id)?.color || null, total: g.length, done: g.filter((t) => t.status === "done").length };
  });
  res.render("report", {
    title: "주간 리포트",
    report: {
      from: mon,
      to: addDays(mon, 6),
      done: done.length,
      lastDone: tasks.filter((t) => inWeek(t.completed_at, last, mon)).length,
      overdue: tasks.filter((t) => t.status !== "done" && t.due_at && t.due_at < kst()).length,
      daily: [0, 1, 2, 3, 4, 5, 6].map((i) => done.filter((t) => t.completed_at.startsWith(addDays(mon, i))).length),
      bySubject: groups.sort((a, b) => b.total - a.total),
      completed: done.sort((a, b) => b.completed_at.localeCompare(a.completed_at)).map(taskOut),
    },
  });
});
app.get("/inbox", (req, res) => res.render("inbox", { title: "받은 편지함", subjects: subjectsWithSchedules() }));
app.get("/settings", (req, res) => res.render("settings", { title: "연동 설정" }));
app.get("/admin", (req, res) =>
  res.render("admin", {
    title: "관리자",
    users: [
      { user_id: 2, email: user.email, user_name: user.user_name, role: "admin", memo_count: memos.length, task_count: tasks.length, created_at: at(-20, "10:00") },
      { user_id: 3, email: "lee@vp.com", user_name: "이수현", role: "user", memo_count: 12, task_count: 31, created_at: at(-12, "14:22") },
      { user_id: 4, email: "park@vp.com", user_name: "박지민", role: "user", memo_count: 4, task_count: 9, created_at: at(-3, "09:05") },
    ],
    stats: { users: 3, memos: memos.length + 16, tasks: tasks.length + 40, ai_calls: 128, ai_failed: 2, ai_tokens: 48210 },
  }),
);
app.get("/auth/google", (req, res) => {
  state.google = "connected";
  state.googleSynced = kst();
  res.redirect("/settings");
});

// ---------- API: 인증 ----------
app.post(["/api/auth/login", "/api/auth/signup"], async (req, res) => {
  await sleep(500);
  if (!req.body.email || !req.body.password) return fail(res, 400, "이메일과 비밀번호를 입력하세요");
  if (req.body.password.length < 4) return fail(res, 401, "이메일 또는 비밀번호가 틀렸어요");
  state.loggedIn = true;
  ok(res, user);
});
app.post("/api/auth/logout", (req, res) => {
  state.loggedIn = false;
  ok(res, null);
});

// ---------- API: 할 일 ----------
app.get("/api/tasks/summary", async (req, res) => {
  await sleep(400);
  const now = kst();
  const t0 = today();
  const week = addDays(t0, 7);
  const open = tasks.filter((t) => t.status !== "done").sort((a, b) => (a.due_at || "9").localeCompare(b.due_at || "9"));
  // 이유 문구는 마감 상태에 맞춘다 (지난 마감에 "오늘 밤 마감"이라 쓰지 않게)
  const reasonOf = (t, i) =>
    t.due_at && t.due_at < now ? "마감이 지났어요. 먼저 끝내요" : ["오늘 안에 끝내야 해요", "이미 진행 중이라 이어서 끝내기 좋아요", "우선순위가 높고 마감이 다가와요"][i];
  const top = [open.find((t) => t.due_at?.startsWith(t0)), open.find((t) => t.status === "doing"), open.find((t) => t.priority === "high")]
    .filter((t, i, a) => t && a.indexOf(t) === i)
    .slice(0, 3)
    .map((t, i) => ({ ...taskOut(t), reason: reasonOf(t, i) }));
  ok(res, {
    today: open.filter((t) => t.due_at?.startsWith(t0) && t.due_at >= now).length,
    week: open.filter((t) => t.due_at && t.due_at >= now && t.due_at.slice(0, 10) <= week).length,
    overdue: open.filter((t) => t.due_at && t.due_at < now).length,
    nearest: open.find((t) => t.due_at && t.due_at >= now) ? taskOut(open.find((t) => t.due_at && t.due_at >= now)) : null,
    top,
    ai_ok: true,
  });
});
app.post("/api/tasks", (req, res) => {
  const b = req.body;
  if (!String(b.title || "").trim()) return fail(res, 400, "제목을 입력하세요 (200자 이내)");
  const t = { task_id: ++state.seq, subject_id: Number(b.subject_id) || null, memo_id: null, title: b.title.trim(), due_at: b.due_at ? b.due_at.replace("T", " ").slice(0, 16) + ":00" : null, priority: b.priority || "mid", status: "todo", source: "manual" };
  tasks.push(t);
  ok(res, taskOut(t), 201);
});
app.patch("/api/tasks/:id", (req, res) => {
  const t = tasks.find((x) => x.task_id === Number(req.params.id));
  if (!t) return fail(res, 404, "할 일을 찾을 수 없어요");
  if (req.body.status) {
    t.completed_at = req.body.status === "done" ? t.completed_at || kst() : null;
    t.status = req.body.status;
  }
  ok(res, taskOut(t));
});
app.delete("/api/tasks/:id", (req, res) => {
  tasks = tasks.filter((x) => x.task_id !== Number(req.params.id));
  ok(res, null);
});

// ---------- API: 음성 메모 (가짜 AI) ----------
app.post("/api/memos", async (req, res) => {
  const transcript = String(req.body.transcript || "").trim();
  if (!transcript) return fail(res, 400, "메모 내용이 비어 있어요");
  await sleep(1400);
  const lecture = req.body.memo_type === "lecture";
  const guess = subjects.find((s) => transcript.includes(s.name) || (s.name === "데이터베이스" && /DB|디비/i.test(transcript)) || (s.name === "운영체제" && /OS/i.test(transcript)));
  const memo = { memo_id: ++state.seq, subject_id: guess?.subject_id || null, memo_type: lecture ? "lecture" : "memo", transcript, duration_sec: req.body.duration_sec || null, created_at: kst() };
  let candidates = [];
  if (lecture) {
    memo.summary = "• 오늘 강의의 핵심 개념을 정리했어요\n• 예시와 함께 원리를 설명했어요\n• 다음 시간 내용과 이어져요\n\n[시험 포인트]\n★ 개념 간 차이를 비교하는 문제";
  } else if (/ERD|과제|퀴즈|시험|리포트|제출/.test(transcript)) {
    memo.summary = `${guess?.name || "할 일"}: ${transcript.slice(0, 40)}${transcript.length > 40 ? "…" : ""}`;
    candidates = [
      { title: /ERD/.test(transcript) ? "ERD 과제 제출" : "과제 제출", due_at: at(8, "23:59").slice(0, 16), priority: "high", subject_id: guess?.subject_id || null },
      ...(/퀴즈|시험/.test(transcript) ? [{ title: "퀴즈 준비", due_at: at(3, "13:00").slice(0, 16), priority: "mid", subject_id: guess?.subject_id || null }] : []),
    ];
  } else {
    memo.summary = transcript.slice(0, 50);
    candidates = [{ title: transcript.slice(0, 30), due_at: at(1, "23:59").slice(0, 16), priority: "mid", subject_id: guess?.subject_id || null }];
  }
  memos.push(memo);
  ok(res, { memo: { ...memoOut(memo), tasks: [] }, ai_ok: true, ai_error: null, candidates }, 201);
});
// 강의 녹음 받아쓰기 (가짜). 브리핑 음성(/api/briefing/today/audio)은 없음(404) → 브라우저 TTS로 대체되는 흐름 확인용
app.post("/api/memos/transcribe", async (req, res) => {
  req.resume();
  await sleep(1500);
  ok(res, { text: "오늘은 프로세스 스케줄링을 배웁니다. FCFS는 먼저 온 순서대로, SJF는 짧은 작업부터 처리합니다. 라운드 로빈은 타임 퀀텀만큼 돌아가며 실행합니다." });
});
app.post("/api/memos/:id/confirm", (req, res) => {
  const list = req.body.tasks || [];
  for (const t of list)
    tasks.push({ task_id: ++state.seq, subject_id: Number(t.subject_id) || null, memo_id: Number(req.params.id), title: t.title, due_at: t.due_at ? t.due_at.replace("T", " ").slice(0, 16) + ":00" : null, priority: t.priority, status: "todo", source: "ai" });
  ok(res, { saved: list.length }, 201);
});
app.delete("/api/memos/:id", (req, res) => {
  memos = memos.filter((m) => m.memo_id !== Number(req.params.id));
  ok(res, null);
});

// ---------- API: 과목 ----------
app.post("/api/subjects", (req, res) => {
  if (subjects.some((s) => s.name === req.body.name)) return fail(res, 409, "이미 있는 과목명이에요");
  const id = ++state.seq;
  subjects.push({ subject_id: id, name: req.body.name, professor: req.body.professor || null, color: req.body.color, schedules: [] });
  (req.body.schedules || []).forEach((s) => schedules.push({ schedule_id: ++state.seq, subject_id: id, day_of_week: s.day_of_week, start_time: s.start_time + ":00", end_time: s.end_time + ":00", room: s.room || null }));
  ok(res, { subject_id: id }, 201);
});
app.put("/api/subjects/:id", (req, res) => {
  const s = subj(req.params.id);
  if (!s) return fail(res, 404, "과목을 찾을 수 없어요");
  if ((req.body.schedules || []).some((x) => x.end_time <= x.start_time)) return fail(res, 400, "끝 시간은 시작 시간보다 늦어야 해요");
  Object.assign(s, { name: req.body.name, professor: req.body.professor || null, color: req.body.color });
  for (let i = schedules.length - 1; i >= 0; i--) if (schedules[i].subject_id === s.subject_id) schedules.splice(i, 1);
  (req.body.schedules || []).forEach((x) => schedules.push({ schedule_id: ++state.seq, subject_id: s.subject_id, day_of_week: x.day_of_week, start_time: x.start_time.slice(0, 5) + ":00", end_time: x.end_time.slice(0, 5) + ":00", room: x.room || null }));
  ok(res, { subject_id: s.subject_id });
});
app.delete("/api/subjects/:id", (req, res) => {
  const i = subjects.findIndex((s) => s.subject_id === Number(req.params.id));
  if (i >= 0) subjects.splice(i, 1);
  ok(res, null);
});

// ---------- API: 브리핑·타임라인 ----------
app.get("/api/briefing/today", async (req, res) => {
  await sleep(900);
  const cls = classesOn(today());
  ok(res, {
    content: `${user.user_name}님, 좋은 아침이에요. 오늘은 ${cls.map((c) => `${c.name} 수업이 ${Number(c.start_time.slice(0, 2)) < 12 ? "오전" : "오후"} ${Number(c.start_time.slice(0, 2)) % 12 || 12}시에`).join(", ") || "수업이 없고"} 있어요. 오후 4시 반에는 캡스톤 조 회의가 잡혀 있어요. 운영체제 3장 복습이 오늘 밤 9시까지예요. 오늘도 차근차근 해봐요!`,
    cached: false,
  });
});
app.get("/api/timeline", async (req, res) => {
  await sleep(300);
  const from = req.query.from || today();
  const to = req.query.to || from;
  const items = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    classesOn(d).forEach((c) => items.push({ kind: "class", title: c.name, subject_name: c.name, subject_color: c.color, location: c.room, start_at: `${d} ${c.start_time}`, end_at: `${d} ${c.end_time}` }));
  }
  // 구글 미연결이면 직접 만든 일정만
  events
    .filter((e) => e.start_at.slice(0, 10) >= from && e.start_at.slice(0, 10) <= to && (state.google !== "disconnected" || e.provider === "manual"))
    .forEach((e) => items.push({ kind: "event", ...e }));
  tasks.filter((t) => t.due_at && t.due_at.slice(0, 10) >= from && t.due_at.slice(0, 10) <= to).forEach((t) => items.push({ kind: "task", ...taskOut(t) }));
  ok(res, { items, google: state.google });
});

// ---------- API: 받은 편지함·연동·동기화 ----------
app.get("/api/inbox", async (req, res) => {
  await sleep(300);
  if (state.google === "disconnected") return ok(res, { connected: false, items: [], counts: {} });
  const counts = Object.fromEntries(["pending", "accepted", "ignored"].map((s) => [s, inbox.filter((x) => x.status === s).length]));
  const status = req.query.status || "pending";
  ok(res, { connected: true, last_synced_at: state.googleSynced, counts, items: inbox.filter((x) => x.status === status).map(withSubject) });
});
app.post("/api/inbox/:id/accept", (req, res) => {
  const it = inbox.find((x) => x.item_id === Number(req.params.id));
  if (!it) return fail(res, 404, "후보를 찾을 수 없어요");
  const t = { task_id: ++state.seq, subject_id: Number(req.body.subject_id) || null, memo_id: null, title: req.body.title || it.ai_title, due_at: req.body.due_at ? req.body.due_at.replace("T", " ").slice(0, 16) + ":00" : null, priority: "high", status: "todo", source: "gmail" };
  tasks.push(t);
  Object.assign(it, { status: "accepted", task_id: t.task_id, ai_title: t.title, ai_due_at: t.due_at, subject_id: t.subject_id });
  ok(res, { task_id: t.task_id });
});
app.post("/api/inbox/:id/ignore", (req, res) => {
  const it = inbox.find((x) => x.item_id === Number(req.params.id));
  if (it) it.status = "ignored";
  ok(res, null);
});
app.get("/api/integrations", (req, res) =>
  ok(res, {
    google: state.google === "disconnected" ? { connected: false } : { connected: true, expired: state.google === "expired", account_email: "student.kim@gmail.com", scopes: ["calendar", "gmail"], connected_at: at(-2, "21:10"), last_synced_at: state.googleSynced },
    notion: state.notion ? { connected: true, token_hint: "••••3f9a", target_ref: state.notionRef || "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d", connected_at: at(-1, "12:00") } : { connected: false },
  }),
);
app.put("/api/integrations/notion", (req, res) => {
  if (!state.notion && !req.body.token) return fail(res, 400, "노션 토큰을 입력하세요");
  state.notion = true;
  state.notionRef = req.body.target_ref;
  ok(res, null);
});
app.delete("/api/integrations/:provider", (req, res) => {
  if (req.params.provider === "google") state.google = "disconnected";
  else state.notion = false;
  ok(res, null);
});
app.post("/api/sync/calendar", async (req, res) => {
  await sleep(900);
  if (state.google !== "connected") return fail(res, 400, state.google === "expired" ? "구글 연결이 만료됐어요. 다시 연결해 주세요" : "구글 계정을 먼저 연결하세요");
  state.googleSynced = kst();
  ok(res, { synced: events.filter((e) => e.provider === "google").length });
});
app.post("/api/sync/gmail", async (req, res) => {
  await sleep(1100);
  if (state.google !== "connected") return fail(res, 400, "구글 계정을 먼저 연결하세요");
  state.googleSynced = kst();
  ok(res, { found: 0 });
});
app.post("/api/notion/export", async (req, res) => {
  await sleep(800);
  ok(res, { exported: tasks.filter((t) => t.status !== "done" && t.due_at && t.due_at.slice(0, 10) <= addDays(today(), 7)).length });
});

// ---------- API: 음성 비서 (대본) ----------
const hm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const speakTime = (min) => `${min < 720 ? "오전" : "오후"} ${Math.floor(min / 60) % 12 || 12}시${min % 60 ? ` ${min % 60}분` : ""}`;
function addEvent(p) {
  events.push({ event_id: ++state.seq, provider: state.google === "connected" ? "google" : "manual", title: p.title, start_at: `${p.date} ${hm(p.start)}:00`, end_at: `${p.date} ${hm(p.start + 60)}:00`, location: null });
  state.pending = null;
  return { label: `일정 추가 · ${Number(p.date.slice(5, 7))}/${Number(p.date.slice(8))} ${hm(p.start)}` };
}
app.post("/api/assistant", async (req, res) => {
  const text = String(req.body.text || "").trim();
  await sleep(800);
  const p = state.pending;
  if (p && /^(좋아|응|그래|네|ㅇㅇ|오케이|좋아요)/.test(text)) {
    const action = addEvent(p);
    return ok(res, { reply: `좋아요. ${speakTime(p.start)}에 ${p.title}를 추가했어요.${state.google === "connected" ? " 구글 캘린더에도 넣었어요." : ""}`, actions: [action], pending: null });
  }
  if (p && /다른|아니|싫/.test(text)) {
    p.start += 90;
    return ok(res, { reply: `그럼 ${speakTime(p.start)}은 어때요?`, actions: [], pending: { label: hm(p.start) } });
  }
  state.pending = null;
  if (/회의|약속|일정|잡아/.test(text)) {
    const date = addDays(today(), /모레/.test(text) ? 2 : /내일/.test(text) ? 1 : 0);
    const h = Number((text.match(/(\d{1,2})\s*시/) || [, 15])[1]);
    const start = (/오전/.test(text) || h >= 12 ? h : h + 12) * 60;
    const title = (text.match(/(\S+\s?(?:조\s)?(?:회의|약속|모임|스터디))/) || [, "새 일정"])[1].replace(/^(오후|오전|\d+시에?)\s*/, "");
    const clash = classesOn(date).find((c) => start < Number(c.end_time.slice(0, 2)) * 60 + Number(c.end_time.slice(3, 5)) && start + 60 > Number(c.start_time.slice(0, 2)) * 60 + Number(c.start_time.slice(3, 5)));
    if (clash) {
      const end = Number(clash.end_time.slice(0, 2)) * 60 + Number(clash.end_time.slice(3, 5));
      state.pending = { title, date, start: Math.ceil((end + 60) / 30) * 30 };
      return ok(res, { reply: `그 시간엔 ${clash.name} 수업이 있어요. ${speakTime(state.pending.start)}은 어때요?`, actions: [], pending: { label: hm(state.pending.start) } });
    }
    const action = addEvent({ title, date, start });
    return ok(res, { reply: `${speakTime(start)}에 ${title}를 추가했어요.`, actions: [action], pending: null });
  }
  if (/마감/.test(text)) {
    const week = tasks.filter((t) => t.status !== "done" && t.due_at && t.due_at.slice(0, 10) <= addDays(today(), 7)).sort((a, b) => a.due_at.localeCompare(b.due_at));
    return ok(res, { reply: week.length ? `이번 주 마감은 ${week.length}개예요. 가장 급한 건 ${week[0].title}이고, 다음은 ${week[1]?.title || "없어요"}예요.` : "이번 주에는 마감이 없어요.", actions: [], pending: null });
  }
  if (/수업/.test(text)) {
    const cls = classesOn(today());
    return ok(res, { reply: cls.length ? `오늘 수업은 ${cls.map((c) => `${speakTime(Number(c.start_time.slice(0, 2)) * 60 + Number(c.start_time.slice(3, 5)))} ${c.name}`).join(", ")}이에요.` : "오늘은 수업이 없어요.", actions: [], pending: null });
  }
  if (/완료|끝냈|다\s?했/.test(text)) {
    const t = tasks.find((x) => x.status !== "done" && text.includes(x.title.slice(0, 4)));
    if (t) {
      t.status = "done";
      t.completed_at = kst();
      return ok(res, { reply: `${t.title}를 완료로 표시했어요. 수고했어요!`, actions: [{ label: `완료 · ${t.title}` }], pending: null });
    }
  }
  if (/추가|해야|할 일/.test(text)) {
    const title = text.replace(/(할 일에?|추가해줘|추가|해야 해|해야돼)/g, "").trim() || text;
    tasks.push({ task_id: ++state.seq, subject_id: null, memo_id: null, title, due_at: null, priority: "mid", status: "todo", source: "voice" });
    return ok(res, { reply: `할 일에 '${title}'를 추가했어요.`, actions: [{ label: `할 일 추가 · ${title}` }], pending: null });
  }
  ok(res, { reply: "일정 잡기, 할 일 추가·완료, 이번 주 마감 확인을 도와드릴 수 있어요.", actions: [], pending: null });
});

app.delete("/api/admin/users/:id", (req, res) => ok(res, null));

app.use((req, res) => {
  if (req.path.startsWith("/api")) return fail(res, 404, "없는 API예요");
  res.status(404).render("error", { title: "404", message: "주소를 다시 확인해 주세요" });
});

const port = process.env.PREVIEW_PORT || 3001;
app.listen(port, () => console.log(`UI 미리보기: http://localhost:${port}  (가짜 데이터, DB·AI 없음)`));
