// /api/events  일정 목록 · 직접 추가 · 삭제
// 구글이 연결돼 있으면 구글 캘린더에도 만들고 provider='google' + 구글 이벤트 ID로 저장 (다음 동기화 때 중복 없음)
// 구글 호출이 실패하면 우리 DB에만 'manual'로 저장하고 google_error로 알려준다 (앱은 멈추지 않음)
const express = require("express");
const pool = require("../../db");
const { requireLogin } = require("../../middleware/auth");
const { toDatetime } = require("./tasks");
const google = require("../../services/google");

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
    const userId = req.session.user.user_id;
    const location = String(b.location || "").trim().slice(0, 200) || null;
    let externalId = null;
    let googleError = null;
    const [[g]] = await pool.query("SELECT 1 FROM integrations WHERE user_id = ? AND provider = 'google'", [userId]);
    if (g && google.configured()) {
      try {
        externalId = await google.insertEvent(userId, { title, start_at: startAt, end_at: endAt, location });
      } catch (err) {
        googleError = err.message;
      }
    }
    const [r] = await pool.query("INSERT INTO events (user_id, provider, external_id, title, start_at, end_at, location, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
      userId,
      externalId ? "google" : "manual",
      externalId,
      title,
      startAt,
      endAt,
      location,
      externalId ? pool.kst() : null,
    ]);
    const [[row]] = await pool.query("SELECT event_id, provider, title, start_at, end_at, location FROM events WHERE event_id = ? AND user_id = ?", [
      r.insertId,
      userId,
    ]);
    if (googleError) row.google_error = googleError;
    res.status(201).json({ ok: true, data: row });
  } catch (err) {
    next(err);
  }
});

// 구글 일정이면 구글 캘린더에서도 지운다. 구글 쪽 삭제가 실패하면 우리 DB도 그대로 둔다 (다음 동기화 때 되살아나지 않게)
router.delete("/:id", async (req, res, next) => {
  try {
    const userId = req.session.user.user_id;
    const [[ev]] = await pool.query("SELECT event_id, provider, external_id FROM events WHERE event_id = ? AND user_id = ?", [req.params.id, userId]);
    if (!ev) return res.status(404).json({ ok: false, error: "일정을 찾을 수 없어요" });
    // 구글 연결을 해제한 뒤라면 구글 쪽은 건드릴 수 없으니 우리 DB에서만 지운다
    const [[g]] = await pool.query("SELECT 1 FROM integrations WHERE user_id = ? AND provider = 'google'", [userId]);
    if (ev.provider === "google" && ev.external_id && g) await google.deleteEvent(userId, ev.external_id);
    await pool.query("DELETE FROM events WHERE event_id = ? AND user_id = ?", [ev.event_id, userId]);
    res.json({ ok: true, data: null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
