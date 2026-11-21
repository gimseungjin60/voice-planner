// /api/admin  회원 관리·통계 (role=admin만). 전체 사용자 대상이라 user_id 조건 예외
const express = require("express");
const pool = require("../../db");
const { requireAdmin } = require("../../middleware/auth");

const router = express.Router();
router.use(requireAdmin);

async function listUsers() {
  const [rows] = await pool.query(
    `SELECT u.user_id, u.email, u.user_name, u.role, u.created_at,
       (SELECT COUNT(*) FROM voice_memos m WHERE m.user_id = u.user_id) AS memo_count,
       (SELECT COUNT(*) FROM tasks t WHERE t.user_id = u.user_id) AS task_count
     FROM users u ORDER BY u.created_at DESC`,
  );
  return rows;
}

async function getStats() {
  const [[s]] = await pool.query(
    `SELECT (SELECT COUNT(*) FROM users) AS users,
       (SELECT COUNT(*) FROM voice_memos) AS memos,
       (SELECT COUNT(*) FROM tasks) AS tasks,
       (SELECT COUNT(*) FROM ai_logs) AS ai_calls,
       (SELECT COUNT(*) FROM ai_logs WHERE success = FALSE) AS ai_failed,
       (SELECT COALESCE(SUM(tokens), 0) FROM ai_logs) AS ai_tokens`,
  );
  return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Number(v)]));
}

router.get("/users", async (req, res, next) => {
  try {
    res.json({ ok: true, data: await listUsers() });
  } catch (err) {
    next(err);
  }
});

router.delete("/users/:id", async (req, res, next) => {
  try {
    if (Number(req.params.id) === req.session.user.user_id)
      return res.status(400).json({ ok: false, error: "자기 자신은 삭제할 수 없어요" });
    const [r] = await pool.query("DELETE FROM users WHERE user_id = ?", [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ ok: false, error: "회원을 찾을 수 없어요" });
    res.json({ ok: true, data: null });
  } catch (err) {
    next(err);
  }
});

router.get("/stats", async (req, res, next) => {
  try {
    res.json({ ok: true, data: await getStats() });
  } catch (err) {
    next(err);
  }
});

router.listUsers = listUsers;
router.getStats = getStats;
module.exports = router;
