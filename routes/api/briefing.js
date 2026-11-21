// /api/briefing  오늘 브리핑 (없으면 AI로 만들어 저장)
const express = require("express");
const pool = require("../../db");
const ai = require("../../services/ai");
const { requireLogin } = require("../../middleware/auth");

const router = express.Router();
router.use(requireLogin);

// 오늘(한국 시간) 요일의 내 수업. 대시보드에서도 재사용
async function todayClasses(userId) {
  const [rows] = await pool.query(
    `SELECT s.subject_id, s.name, s.color, sc.start_time, sc.end_time, sc.room
     FROM schedules sc JOIN subjects s ON s.subject_id = sc.subject_id
     WHERE s.user_id = ? AND sc.day_of_week = ? ORDER BY sc.start_time`,
    [userId, pool.kstDay()],
  );
  return rows;
}

// AI 실패 시 쓰는 기본 문장 (저장하지 않아 다음에 다시 AI를 시도한다)
function fallbackText(name, classes, dueTasks) {
  const c = classes.length ? `오늘 수업은 ${classes.map((x) => `${x.name} ${x.start_time.slice(0, 5)}`).join(", ")}입니다.` : "오늘은 수업이 없어요.";
  const d = dueTasks.length ? `다가오는 마감은 ${dueTasks.map((t) => t.title).join(", ")}입니다.` : "급한 마감은 없어요.";
  return `${name}님, 좋은 아침이에요. ${c} ${d} 오늘도 힘내세요!`;
}

router.get("/today", async (req, res, next) => {
  try {
    const { user_id: userId, user_name: userName } = req.session.user;
    const today = pool.kst().slice(0, 10);
    const [[saved]] = await pool.query("SELECT content FROM briefings WHERE user_id = ? AND brief_date = ?", [userId, today]);
    if (saved) return res.json({ ok: true, data: { content: saved.content, cached: true } });

    const classes = await todayClasses(userId);
    const threeDays = pool.kst(new Date(Date.now() + 3 * 86400000));
    const [dueTasks] = await pool.query(
      `SELECT title, due_at FROM tasks WHERE user_id = ? AND status <> 'done' AND due_at <= ?
       ORDER BY due_at LIMIT 5`,
      [userId, threeDays],
    );
    const content = await ai.makeBriefing({ userId, userName, today, classes, dueTasks });
    if (!content) return res.json({ ok: true, data: { content: fallbackText(userName, classes, dueTasks), ai_ok: false } });
    // 동시에 두 번 요청돼도 하루 1개 (uq_user_date)
    await pool.query("INSERT IGNORE INTO briefings (user_id, brief_date, content) VALUES (?, ?, ?)", [userId, today, content]);
    res.json({ ok: true, data: { content, cached: false } });
  } catch (err) {
    next(err);
  }
});

router.todayClasses = todayClasses;
module.exports = router;
