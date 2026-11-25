// /api/inbox  받은 편지함: Gmail에서 AI가 찾은 할 일 후보 목록 · 수락(→ tasks) · 무시
// 후보를 만드는 일(/api/sync/gmail)은 services/google.js 연동 후 추가. 여기는 DB에 있는 후보만 다룬다
const express = require("express");
const pool = require("../../db");
const { requireLogin } = require("../../middleware/auth");
const { toDatetime, ownSubjectId, TASK_SELECT } = require("./tasks");

const router = express.Router();
router.use(requireLogin);

const STATUS = ["pending", "accepted", "ignored"];

router.get("/", async (req, res, next) => {
  try {
    const userId = req.session.user.user_id;
    const [[google]] = await pool.query("SELECT last_synced_at FROM integrations WHERE user_id = ? AND provider = 'google'", [userId]);
    // 구글을 끊었어도 이미 가져온 후보가 있으면 보여준다 (연동 해제 시 데이터는 유지)
    const [countRows] = await pool.query("SELECT status, COUNT(*) AS n FROM inbox_items WHERE user_id = ? GROUP BY status", [userId]);
    const counts = Object.fromEntries(STATUS.map((s) => [s, Number(countRows.find((r) => r.status === s)?.n || 0)]));
    if (!google && !countRows.length) return res.json({ ok: true, data: { connected: false, items: [], counts } });
    const status = STATUS.includes(req.query.status) ? req.query.status : "pending";
    const [items] = await pool.query(
      `SELECT i.*, s.name AS subject_name, s.color AS subject_color
       FROM inbox_items i LEFT JOIN subjects s ON s.subject_id = i.subject_id
       WHERE i.user_id = ? AND i.status = ? ORDER BY i.received_at DESC, i.item_id DESC LIMIT 100`,
      [userId, status],
    );
    res.json({ ok: true, data: { connected: true, last_synced_at: google?.last_synced_at || null, counts, items } });
  } catch (err) {
    next(err);
  }
});

// 후보 → 할 일. 사용자가 고친 제목·마감·과목이 있으면 그 값으로 저장 (source = 'gmail')
router.post("/:id/accept", async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const userId = req.session.user.user_id;
    const b = req.body || {};
    const [[item]] = await conn.query("SELECT * FROM inbox_items WHERE item_id = ? AND user_id = ?", [req.params.id, userId]);
    if (!item) return res.status(404).json({ ok: false, error: "후보를 찾을 수 없어요" });
    if (item.status === "accepted") return res.status(409).json({ ok: false, error: "이미 할 일로 추가한 후보예요" });
    const title = String(b.title ?? item.ai_title ?? item.subject ?? "").trim();
    if (!title || title.length > 200) return res.status(400).json({ ok: false, error: "제목을 입력하세요 (200자 이내)" });
    const dueAt = b.due_at === undefined ? item.ai_due_at : toDatetime(b.due_at);
    if (dueAt === undefined) return res.status(400).json({ ok: false, error: "마감일 형식이 올바르지 않아요" });
    const subjectId = await ownSubjectId(userId, b.subject_id === undefined ? item.subject_id : b.subject_id);

    await conn.beginTransaction();
    const [r] = await conn.query("INSERT INTO tasks (user_id, subject_id, title, due_at, priority, source) VALUES (?, ?, ?, ?, 'mid', 'gmail')", [
      userId,
      subjectId,
      title,
      dueAt,
    ]);
    await conn.query("UPDATE inbox_items SET status = 'accepted', task_id = ?, ai_title = ?, ai_due_at = ?, subject_id = ? WHERE item_id = ? AND user_id = ?", [
      r.insertId,
      title,
      dueAt,
      subjectId,
      item.item_id,
      userId,
    ]);
    await conn.commit();
    const [[task]] = await conn.query(`${TASK_SELECT} WHERE t.task_id = ? AND t.user_id = ?`, [r.insertId, userId]);
    res.status(201).json({ ok: true, data: task });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

router.post("/:id/ignore", async (req, res, next) => {
  try {
    const [r] = await pool.query("UPDATE inbox_items SET status = 'ignored' WHERE item_id = ? AND user_id = ? AND status = 'pending'", [
      req.params.id,
      req.session.user.user_id,
    ]);
    if (!r.affectedRows) return res.status(404).json({ ok: false, error: "후보를 찾을 수 없어요" });
    res.json({ ok: true, data: null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
