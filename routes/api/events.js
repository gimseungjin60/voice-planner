// /api/events  일정 목록 · 직접 추가 · 삭제
// 지금은 provider='manual'만 만든다. 구글 캘린더에도 함께 만드는 부분은 services/google.js 연동 때 추가 (@Dev.md /api/events)
const express = require("express");
const pool = require("../../db");
const { requireLogin } = require("../../middleware/auth");
const { toDatetime } = require("./tasks");

const router = express.Router();
router.use(requireLogin);

const YMD = /^\d{4}-\d{2}-\d{2}$/;

router.get("/", async (req, res, next) => {
  try {
    const today = pool.kst().slice(0, 10);
    const from = YMD.test(req.query.from || "") ? req.query.from : today;
    const to = YMD.test(req.query.to || "") ? req.query.to : from;
    const [rows] = await pool.query(
      "SELECT event_id, provider, title, start_at, end_at, location FROM events WHERE user_id = ? AND start_at <= ? AND end_at >= ? ORDER BY start_at",
      [req.session.user.user_id, `${to} 23:59:59`, `${from} 00:00:00`],
    );
    res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const b = req.body || {};
    const title = String(b.title || "").trim();
    const startAt = toDatetime(b.start_at);
    const endAt = b.end_at ? toDatetime(b.end_at) : startAt;
    if (!title || title.length > 200) return res.status(400).json({ ok: false, error: "제목을 입력하세요 (200자 이내)" });
    if (!startAt || !endAt) return res.status(400).json({ ok: false, error: "시작 시각을 입력하세요" });
    if (endAt < startAt) return res.status(400).json({ ok: false, error: "끝 시각은 시작 시각보다 늦어야 해요" });
    const [r] = await pool.query("INSERT INTO events (user_id, provider, title, start_at, end_at, location) VALUES (?, 'manual', ?, ?, ?, ?)", [
      req.session.user.user_id,
      title,
      startAt,
      endAt,
      String(b.location || "").trim().slice(0, 200) || null,
    ]);
    const [[row]] = await pool.query("SELECT event_id, provider, title, start_at, end_at, location FROM events WHERE event_id = ? AND user_id = ?", [
      r.insertId,
      req.session.user.user_id,
    ]);
    res.status(201).json({ ok: true, data: row });
  } catch (err) {
    next(err);
  }
});

// 구글에서 온 일정은 구글 연동 후 구글에서도 지워야 하므로 지금은 직접 만든 일정만 지운다
router.delete("/:id", async (req, res, next) => {
  try {
    const [r] = await pool.query("DELETE FROM events WHERE event_id = ? AND user_id = ? AND provider = 'manual'", [req.params.id, req.session.user.user_id]);
    if (!r.affectedRows) return res.status(404).json({ ok: false, error: "직접 만든 일정만 여기서 지울 수 있어요" });
    res.json({ ok: true, data: null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
