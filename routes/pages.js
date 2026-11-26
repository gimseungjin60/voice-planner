// EJS 화면 렌더 (GET만). 데이터 변경은 public/js에서 fetch('/api/...')
const express = require("express");
const pool = require("../db");
const { requireLogin, requireAdmin } = require("../middleware/auth");
const { listSubjects, subjectOverview } = require("./api/subjects");
const { TASK_SELECT, weeklyReport } = require("./api/tasks");
const { listMemos, getMemo } = require("./api/memos");
const { todayClasses } = require("./api/briefing");
const { listUsers, getStats } = require("./api/admin");
const share = require("./api/share");

const router = express.Router();

router.get(["/login", "/signup"], (req, res) => {
  if (req.session.user) return res.redirect("/");
  res.render("login", { title: req.path === "/signup" ? "회원가입" : "로그인", mode: req.path.slice(1) });
});

// 친구가 보는 공유 일정 (로그인 없이). 링크가 꺼졌거나 바뀌었으면 404
router.get("/s/:token", async (req, res, next) => {
  try {
    // 검색 엔진 수집·캐시·Referer로 링크가 새지 않게
    res.set({ "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" });
    const link = await share.findByToken(req.params.token);
    if (!link) return res.status(404).render("shared", { title: "링크를 열 수 없어요", user: null, gone: true });
    const isOwner = req.session.user?.user_id === link.user_id;
    if (!isOwner) await share.countView(link.share_id);
    const week = share.pickMonday(req.query.w, { limit: true });
    res.render("shared", {
      title: `${link.user_name}님의 일정`,
      gone: false,
      user: null, // 공유 화면에는 내 메뉴·비서를 띄우지 않는다
      ownerName: link.user_name,
      isOwner,
      week,
      board: await share.weekBoard(link.user_id, week.monday, link.visibility),
      generatedAt: pool.kst(),
    });
  } catch (err) {
    next(err);
  }
});

router.use(requireLogin);

router.get("/", async (req, res, next) => {
  try {
    const userId = req.session.user.user_id;
    res.render("dashboard", {
      title: "대시보드",
      today: pool.kst(),
      classes: await todayClasses(userId),
      subjects: await listSubjects(userId),
      todayDow: pool.kstDay(),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/memo", async (req, res, next) => {
  try {
    res.render("memo", { title: "음성 메모", subjects: await listSubjects(req.session.user.user_id) });
  } catch (err) {
    next(err);
  }
});

router.get("/memos", async (req, res, next) => {
  try {
    const userId = req.session.user.user_id;
    const subject = Number(req.query.subject) || null;
    res.render("memos", {
      title: "메모 목록",
      list: await listMemos(userId, req.query.page, subject),
      subjects: await listSubjects(userId),
      subject,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/memos/:id", async (req, res, next) => {
  try {
    const memo = await getMemo(req.session.user.user_id, req.params.id);
    if (!memo) return res.status(404).render("error", { title: "404", message: "메모를 찾을 수 없어요" });
    res.render("memo-detail", { title: "메모 상세", memo });
  } catch (err) {
    next(err);
  }
});

router.get("/tasks", async (req, res, next) => {
  try {
    const userId = req.session.user.user_id;
    const [tasks] = await pool.query(`${TASK_SELECT} WHERE t.user_id = ? ORDER BY t.due_at IS NULL, t.due_at`, [userId]);
    res.render("tasks", { title: "할 일 보드", tasks, subjects: await listSubjects(userId) });
  } catch (err) {
    next(err);
  }
});

router.get("/timetable", async (req, res, next) => {
  try {
    res.render("timetable", { title: "시간표", subjects: await listSubjects(req.session.user.user_id), todayDow: pool.kstDay() });
  } catch (err) {
    next(err);
  }
});

router.get("/subjects/:id", async (req, res, next) => {
  try {
    const subject = await subjectOverview(req.session.user.user_id, req.params.id);
    if (!subject) return res.status(404).render("error", { title: "404", message: "과목을 찾을 수 없어요" });
    res.render("subject", { title: subject.name, subject });
  } catch (err) {
    next(err);
  }
});

router.get("/report", async (req, res, next) => {
  try {
    res.render("report", { title: "주간 리포트", report: await weeklyReport(req.session.user.user_id) });
  } catch (err) {
    next(err);
  }
});

// 받은 편지함·연동 설정: 데이터는 화면에서 /api/inbox, /api/integrations로 불러온다
router.get("/inbox", async (req, res, next) => {
  try {
    res.render("inbox", { title: "받은 편지함", subjects: await listSubjects(req.session.user.user_id) });
  } catch (err) {
    next(err);
  }
});

// 내 일정 한 페이지 + 공유 링크 관리. ?view=friend면 친구에게 보이는 모습으로
router.get("/share", async (req, res, next) => {
  try {
    const userId = req.session.user.user_id;
    const link = await share.getShare(userId);
    const asFriend = req.query.view === "friend";
    const week = share.pickMonday(req.query.w);
    res.render("share", {
      title: "일정 공유",
      share: share.shareOut(req, link),
      asFriend,
      week,
      board: await share.weekBoard(userId, week.monday, asFriend ? link?.visibility || "busy" : "owner"),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/settings", (req, res) => res.render("settings", { title: "연동 설정" }));

router.get("/admin", requireAdmin, async (req, res, next) => {
  try {
    res.render("admin", { title: "관리자", users: await listUsers(), stats: await getStats() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
