// /api/tasks  할 일 CRUD + 총정리(summary)
const express = require("express");
const pool = require("../../db");
const ai = require("../../services/ai");
const { requireLogin } = require("../../middleware/auth");

const router = express.Router();
router.use(requireLogin);

const STATUS = ["todo", "doing", "done"];
const PRIORITY = ["low", "mid", "high"];
const TASK_SELECT = `SELECT t.*, s.name AS subject_name, s.color AS subject_color
  FROM tasks t LEFT JOIN subjects s ON s.subject_id = t.subject_id`;

// 주간 리포트: 이번 주(월~일, 한국 시간) 완료 수·지난주 대비·요일별·과목별 완료율
async function weeklyReport(userId) {
  const now = pool.kst();
  const day = (ymd, n) => new Date(Date.parse(ymd) + n * 86400000).toISOString().slice(0, 10);
  const mon = day(now.slice(0, 10), -((pool.kstDay() + 6) % 7));
  const [thisMon, lastMon, nextMon] = [mon, day(mon, -7), day(mon, 7)];
  const [[c]] = await pool.query(
    `SELECT SUM(completed_at >= ?) AS done, SUM(completed_at >= ? AND completed_at < ?) AS last_done,
            SUM(status <> 'done' AND due_at < ?) AS overdue
     FROM tasks WHERE user_id = ?`,
    [thisMon, lastMon, thisMon, now, userId],
  );
  const [days] = await pool.query(
    "SELECT DATE_FORMAT(completed_at, '%Y-%m-%d') AS d, COUNT(*) AS n FROM tasks WHERE user_id = ? AND completed_at >= ? AND completed_at < ? GROUP BY d",
    [userId, thisMon, nextMon],
  );
  const [bySubject] = await pool.query(
    `SELECT s.name, s.color, COUNT(*) AS total, SUM(t.status = 'done') AS done
     FROM tasks t LEFT JOIN subjects s ON s.subject_id = t.subject_id
     WHERE t.user_id = ? AND t.due_at >= ? AND t.due_at < ?
     GROUP BY t.subject_id, s.name, s.color ORDER BY total DESC`,
    [userId, thisMon, nextMon],
  );
  const [completed] = await pool.query(
    `${TASK_SELECT} WHERE t.user_id = ? AND t.completed_at >= ? ORDER BY t.completed_at DESC LIMIT 30`,
    [userId, thisMon],
  );
  return {
    from: thisMon,
    to: day(mon, 6),
    done: Number(c.done) || 0,
    lastDone: Number(c.last_done) || 0,
    overdue: Number(c.overdue) || 0,
    daily: [0, 1, 2, 3, 4, 5, 6].map((i) => Number(days.find((x) => x.d === day(mon, i))?.n) || 0),
    bySubject: bySubject.map((x) => ({ ...x, total: Number(x.total), done: Number(x.done) || 0 })),
    completed,
  };
}

// 'YYYY-MM-DDTHH:mm' / 'YYYY-MM-DD HH:mm' / 'YYYY-MM-DD' → 'YYYY-MM-DD HH:mm:ss', 빈 값은 null, 이상하면 undefined
function toDatetime(v) {
  if (v === null || v === "" || v === undefined) return null;
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/);
  return m ? `${m[1]} ${m[2] || "23:59"}:00` : undefined;
}

// 남의 과목 ID를 넣지 못하게: 내 과목이면 그 ID, 아니면 null
async function ownSubjectId(userId, subjectId) {
  if (!subjectId) return null;
  const [[row]] = await pool.query("SELECT subject_id FROM subjects WHERE subject_id = ? AND user_id = ?", [subjectId, userId]);
  return row ? row.subject_id : null;
}

router.get("/", async (req, res, next) => {
  try {
    const where = ["t.user_id = ?"];
    const params = [req.session.user.user_id];
    if (STATUS.includes(req.query.status)) where.push("t.status = ?") && params.push(req.query.status);
    if (req.query.subject) where.push("t.subject_id = ?") && params.push(req.query.subject);
    const [rows] = await pool.query(
      `${TASK_SELECT} WHERE ${where.join(" AND ")} ORDER BY t.due_at IS NULL, t.due_at, t.created_at DESC`,
      params,
    );
    res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
});

// 대시보드 총정리: 오늘·이번 주·지난 마감 개수 + 가장 가까운 D-day + AI 추천 Top3
router.get("/summary", async (req, res, next) => {
  try {
    const userId = req.session.user.user_id;
    const now = pool.kst();
    const today = now.slice(0, 10);
    const weekEnd = pool.kst(new Date(Date.now() + 7 * 86400000)).slice(0, 10);
    const [[counts]] = await pool.query(
      `SELECT
         SUM(DATE(due_at) = ? AND due_at >= ?) AS today,
         SUM(DATE(due_at) BETWEEN ? AND ? AND due_at >= ?) AS week,
         SUM(due_at < ?) AS overdue
       FROM tasks WHERE user_id = ? AND status <> 'done'`,
      // 오늘·이번 주는 아직 남은 마감만 센다. 이미 지난 것은 overdue 하나로만 보여 숫자가 겹치지 않게
      [today, now, today, weekEnd, now, now, userId],
    );
    const [open] = await pool.query(
      `${TASK_SELECT} WHERE t.user_id = ? AND t.status <> 'done'
       ORDER BY t.due_at IS NULL, t.due_at LIMIT 20`,
      [userId],
    );
    const nearest = open.find((t) => t.due_at && t.due_at >= now) || null;
    let top = await ai.prioritize({ userId, tasks: open, now });
    const aiOk = top !== null;
    // AI 실패 시 마감 가까운 순으로 대체
    if (!aiOk)
      top = open.slice(0, 3).map((t) => ({
        ...t,
        reason: !t.due_at ? "아직 마감이 없어요" : t.due_at < now ? "마감이 지났어요. 먼저 끝내요" : "마감이 가까워요",
      }));
    res.json({
      ok: true,
      data: {
        today: Number(counts.today) || 0,
        week: Number(counts.week) || 0,
        overdue: Number(counts.overdue) || 0,
        nearest,
        top,
        ai_ok: aiOk,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const b = req.body || {};
    const userId = req.session.user.user_id;
    const title = String(b.title || "").trim();
    const dueAt = toDatetime(b.due_at);
    if (!title || title.length > 200) return res.status(400).json({ ok: false, error: "제목을 입력하세요 (200자 이내)" });
    if (dueAt === undefined) return res.status(400).json({ ok: false, error: "마감일 형식이 올바르지 않아요" });
    const [r] = await pool.query(
      "INSERT INTO tasks (user_id, subject_id, title, due_at, priority, status) VALUES (?, ?, ?, ?, ?, ?)",
      [
        userId,
        await ownSubjectId(userId, b.subject_id),
        title,
        dueAt,
        PRIORITY.includes(b.priority) ? b.priority : "mid",
        STATUS.includes(b.status) ? b.status : "todo",
      ],
    );
    const [[task]] = await pool.query(`${TASK_SELECT} WHERE t.task_id = ?`, [r.insertId]);
    res.status(201).json({ ok: true, data: task });
  } catch (err) {
    next(err);
  }
});

// 보낸 필드만 수정 (상태 버튼은 { status }만 보냄)
router.patch("/:id", async (req, res, next) => {
  try {
    const b = req.body || {};
    const userId = req.session.user.user_id;
    const sets = [];
    const params = [];
    if (b.title !== undefined) {
      const title = String(b.title).trim();
      if (!title || title.length > 200) return res.status(400).json({ ok: false, error: "제목을 입력하세요 (200자 이내)" });
      sets.push("title = ?") && params.push(title);
    }
    if (b.due_at !== undefined) {
      const dueAt = toDatetime(b.due_at);
      if (dueAt === undefined) return res.status(400).json({ ok: false, error: "마감일 형식이 올바르지 않아요" });
      sets.push("due_at = ?") && params.push(dueAt);
    }
    if (b.status !== undefined) {
      if (!STATUS.includes(b.status)) return res.status(400).json({ ok: false, error: "상태 값이 올바르지 않아요" });
      sets.push("status = ?") && params.push(b.status);
      // 완료 시각 기록 (완료율 통계용). 이미 done이면 처음 완료한 시각 유지
      sets.push(b.status === "done" ? "completed_at = COALESCE(completed_at, ?)" : "completed_at = NULL");
      if (b.status === "done") params.push(pool.kst());
    }
    if (b.priority !== undefined) {
      if (!PRIORITY.includes(b.priority)) return res.status(400).json({ ok: false, error: "우선순위 값이 올바르지 않아요" });
      sets.push("priority = ?") && params.push(b.priority);
    }
    if (b.subject_id !== undefined) sets.push("subject_id = ?") && params.push(await ownSubjectId(userId, b.subject_id));
    if (!sets.length) return res.status(400).json({ ok: false, error: "수정할 내용이 없어요" });

    const [r] = await pool.query(`UPDATE tasks SET ${sets.join(", ")} WHERE task_id = ? AND user_id = ?`, [
      ...params,
      req.params.id,
      userId,
    ]);
    if (!r.affectedRows) return res.status(404).json({ ok: false, error: "할 일을 찾을 수 없어요" });
    const [[task]] = await pool.query(`${TASK_SELECT} WHERE t.task_id = ?`, [req.params.id]);
    res.json({ ok: true, data: task });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const [r] = await pool.query("DELETE FROM tasks WHERE task_id = ? AND user_id = ?", [
      req.params.id,
      req.session.user.user_id,
    ]);
    if (!r.affectedRows) return res.status(404).json({ ok: false, error: "할 일을 찾을 수 없어요" });
    res.json({ ok: true, data: null });
  } catch (err) {
    next(err);
  }
});

router.weeklyReport = weeklyReport;
router.ownSubjectId = ownSubjectId;
router.toDatetime = toDatetime;
router.TASK_SELECT = TASK_SELECT;
module.exports = router;
