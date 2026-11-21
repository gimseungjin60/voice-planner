// EJS 화면 렌더 (GET만). 데이터 변경은 public/js에서 fetch('/api/...')
const express = require("express");
const pool = require("../db");
const { requireLogin, requireAdmin } = require("../middleware/auth");
const { listSubjects } = require("./api/subjects");
const { TASK_SELECT } = require("./api/tasks");
const { listMemos, getMemo } = require("./api/memos");
const { todayClasses } = require("./api/briefing");
const { listUsers, getStats } = require("./api/admin");

const router = express.Router();

router.get(["/login", "/signup"], (req, res) => {
  if (req.session.user) return res.redirect("/");
  res.render("login", { title: req.path === "/signup" ? "회원가입" : "로그인", mode: req.path.slice(1) });
});

router.use(requireLogin);

router.get("/", async (req, res, next) => {
  try {
    res.render("dashboard", { title: "대시보드", today: pool.kst(), classes: await todayClasses(req.session.user.user_id) });
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
    res.render("timetable", { title: "시간표", subjects: await listSubjects(req.session.user.user_id) });
  } catch (err) {
    next(err);
  }
});

router.get("/admin", requireAdmin, async (req, res, next) => {
  try {
    res.render("admin", { title: "관리자", users: await listUsers(), stats: await getStats() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
