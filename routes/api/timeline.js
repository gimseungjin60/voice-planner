// /api/timeline?from=YYYY-MM-DD&to=YYYY-MM-DD  수업(schedules) + 일정(events) + 할 일 마감(tasks)을 시간순 한 배열로
// 화면은 DB만 읽는다. 구글 일정은 /api/sync/calendar가 events에 넣어 둔 것을 보여준다
const express = require("express");
const pool = require("../../db");
const { requireLogin } = require("../../middleware/auth");
const { TASK_SELECT } = require("./tasks");
const academic = require("../../config/academic");

const router = express.Router();
router.use(requireLogin);

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (ymd, n) => new Date(Date.parse(ymd + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

// 구글 연결 상태: connected · expired · disconnected (대시보드 안내 배너용)
async function googleState(userId) {
  const [[g]] = await pool.query("SELECT refresh_token, expires_at FROM integrations WHERE user_id = ? AND provider = 'google'", [userId]);
  if (!g) return "disconnected";
  return !g.refresh_token && g.expires_at && g.expires_at < pool.kst() ? "expired" : "connected";
}

router.get("/", async (req, res, next) => {
  try {
    const userId = req.session.user.user_id;
    const from = YMD.test(req.query.from || "") ? req.query.from : pool.kst().slice(0, 10);
    const to = YMD.test(req.query.to || "") && req.query.to >= from ? req.query.to : from;
    // 월간 달력 한 장(6주 = 42일)까지
    if (Date.parse(to) - Date.parse(from) > 41 * 86400000) return res.status(400).json({ ok: false, error: "한 번에 42일까지만 볼 수 있어요" });

    // 수업: 요일별 시간표를 날짜마다 펼친다. 학기 밖(방학)·공휴일은 건너뛴다 (config/academic.js)
    const [classes] = await pool.query(
      `SELECT s.subject_id, s.name, s.color, sc.day_of_week, sc.start_time, sc.end_time, sc.room
       FROM schedules sc JOIN subjects s ON s.subject_id = sc.subject_id WHERE s.user_id = ?`,
      [userId],
    );
    const items = [];
    const days = {}; // 날짜별 학사 표시 (공휴일·종강·시험 기간·방학)
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const note = academic.dayNote(d);
      if (note) days[d] = note;
      if (!academic.classOn(d)) continue;
      const dow = new Date(d + "T12:00:00Z").getUTCDay();
      classes
        .filter((c) => c.day_of_week === dow)
        .forEach((c) =>
          items.push({ kind: "class", title: c.name, subject_id: c.subject_id, subject_name: c.name, subject_color: c.color, location: c.room, start_at: `${d} ${c.start_time}`, end_at: `${d} ${c.end_time}` }),
        );
    }
    const [events] = await pool.query(
      "SELECT event_id, provider, title, start_at, end_at, location FROM events WHERE user_id = ? AND start_at < ? AND end_at >= ? ORDER BY start_at",
      [userId, `${addDays(to, 1)} 00:00:00`, `${from} 00:00:00`],
    );
    events.forEach((e) => items.push({ kind: "event", ...e }));
    const [tasks] = await pool.query(`${TASK_SELECT} WHERE t.user_id = ? AND t.due_at >= ? AND t.due_at < ? ORDER BY t.due_at`, [
      userId,
      `${from} 00:00:00`,
      `${addDays(to, 1)} 00:00:00`,
    ]);
    tasks.forEach((t) => items.push({ kind: "task", ...t }));

    items.sort((a, b) => (a.start_at || a.due_at).localeCompare(b.start_at || b.due_at));
    res.json({ ok: true, data: { items, days, google: await googleState(userId) } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
