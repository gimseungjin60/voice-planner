// /api/notion/export  이번 주(오늘~7일, 대시보드 '이번 주'와 같은 기준) 또는 고른 할 일을 노션 DB에 행으로 추가
// 내보낸 할 일은 tasks.external_id에 노션 페이지 ID를 남겨 다시 내보내지 않는다. 그 뒤로는 양방향 동기화(services/notion-sync.js)로 맞춘다
// /api/notion/sync    노션에서 바뀐 것 가져오기 (대시보드 자동 동기화·연동 설정 '지금 동기화')
const express = require("express");
const pool = require("../../db");
const notion = require("../../services/notion");
const notionSync = require("../../services/notion-sync");
const { requireLogin } = require("../../middleware/auth");
const { TASK_SELECT } = require("./tasks");

const router = express.Router();
router.use(requireLogin);

router.post("/export", async (req, res, next) => {
  try {
    const userId = req.session.user.user_id;
    const [[n]] = await pool.query("SELECT access_token, target_ref FROM integrations WHERE user_id = ? AND provider = 'notion'", [userId]);
    if (!n || !n.target_ref) return res.status(400).json({ ok: false, error: "연동 설정에서 노션 토큰과 데이터베이스를 먼저 저장하세요" });

    const ids = Array.isArray(req.body?.task_ids) ? req.body.task_ids.map(Number).filter(Number.isInteger).slice(0, 100) : [];
    let tasks;
    if (ids.length) {
      [tasks] = await pool.query(`${TASK_SELECT} WHERE t.user_id = ? AND t.task_id IN (?) AND t.external_id IS NULL ORDER BY t.due_at`, [userId, ids]);
    } else {
      const today = pool.kst().slice(0, 10);
      const weekEnd = pool.kst(new Date(Date.now() + 6 * 86400000)).slice(0, 10);
      [tasks] = await pool.query(
        `${TASK_SELECT} WHERE t.user_id = ? AND t.status <> 'done' AND t.external_id IS NULL AND t.due_at BETWEEN ? AND ? ORDER BY t.due_at LIMIT 50`,
        [userId, `${today} 00:00:00`, `${weekEnd} 23:59:59`],
      );
    }
    if (!tasks.length) return res.json({ ok: true, data: { exported: 0, failed: 0 } });

    const done = await notion.exportTasks({ token: n.access_token, ref: n.target_ref, tasks });
    for (const d of done) {
      await pool.query("UPDATE tasks SET external_id = ? WHERE task_id = ? AND user_id = ?", [d.page_id, d.task_id, userId]);
    }
    await pool.query("UPDATE integrations SET last_synced_at = ? WHERE user_id = ? AND provider = 'notion'", [pool.kst(), userId]);
    res.json({ ok: true, data: { exported: done.length, failed: tasks.length - done.length } });
  } catch (err) {
    next(err);
  }
});

router.post("/sync", async (req, res, next) => {
  try {
    const result = await notionSync.pull(req.session.user.user_id);
    if (!result) return res.status(400).json({ ok: false, error: "노션이 연결되어 있지 않아요" });
    res.json({ ok: true, data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
