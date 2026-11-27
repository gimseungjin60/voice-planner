// /api/subjects  과목 + 시간표 (과목 1:N 수업시간)
const express = require("express");
const pool = require("../../db");
const { requireLogin } = require("../../middleware/auth");

const router = express.Router();
router.use(requireLogin);

// 내 과목 + 시간표 묶어서 조회 (화면에서도 재사용)
async function listSubjects(userId) {
  const [subjects] = await pool.query("SELECT * FROM subjects WHERE user_id = ? ORDER BY name", [userId]);
  const [schedules] = await pool.query(
    `SELECT sc.* FROM schedules sc JOIN subjects s ON s.subject_id = sc.subject_id
     WHERE s.user_id = ? ORDER BY sc.day_of_week, sc.start_time`,
    [userId],
  );
  return subjects.map((s) => ({ ...s, schedules: schedules.filter((x) => x.subject_id === s.subject_id) }));
}

// 과목 모아보기: 과목 + 이 과목의 할 일·음성 메모·메일 과제 (없으면 null)
async function subjectOverview(userId, subjectId) {
  const subject = (await listSubjects(userId)).find((s) => s.subject_id === Number(subjectId));
  if (!subject) return null;
  const args = [userId, subject.subject_id];
  const [tasks] = await pool.query(
    "SELECT * FROM tasks WHERE user_id = ? AND subject_id = ? ORDER BY status = 'done', due_at IS NULL, due_at",
    args,
  );
  const [memos] = await pool.query(
    "SELECT memo_id, memo_type, summary, transcript, created_at FROM voice_memos WHERE user_id = ? AND subject_id = ? ORDER BY created_at DESC LIMIT 20",
    args,
  );
  const [mails] = await pool.query(
    "SELECT item_id, sender, subject, received_at, ai_title, ai_due_at, status FROM inbox_items WHERE user_id = ? AND subject_id = ? ORDER BY received_at DESC LIMIT 20",
    args,
  );
  return { ...subject, tasks, memos, mails };
}

// 입력 검증. 문제가 있으면 에러 메시지 문자열, 없으면 정리된 값
function parseBody(b = {}) {
  const name = String(b.name || "").trim();
  if (!name || name.length > 100) return "과목명을 입력하세요 (100자 이내)";
  const color = /^#[0-9a-fA-F]{6}$/.test(b.color || "") ? b.color : "#6C8EF5";
  const schedules = Array.isArray(b.schedules) ? b.schedules : [];
  for (const s of schedules) {
    if (!(Number(s.day_of_week) >= 0 && Number(s.day_of_week) <= 6)) return "요일이 올바르지 않아요";
    if (!/^\d{2}:\d{2}/.test(s.start_time || "") || !/^\d{2}:\d{2}/.test(s.end_time || "")) return "시간 형식이 올바르지 않아요";
    if (s.end_time <= s.start_time) return "끝 시간은 시작 시간보다 늦어야 해요";
  }
  return { name, professor: String(b.professor || "").trim().slice(0, 50) || null, color, schedules };
}

// 시간표 겹침 검사: 입력끼리 + 내 다른 과목 수업과. 겹치면 안내 문구, 없으면 null (음성 비서 add_class와 같은 기준)
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const hm = (t) => String(t).slice(0, 5);
async function scheduleClash(userId, schedules, exceptSubjectId = null) {
  for (let i = 0; i < schedules.length; i++)
    for (let j = i + 1; j < schedules.length; j++) {
      const [a, b] = [schedules[i], schedules[j]];
      if (Number(a.day_of_week) === Number(b.day_of_week) && hm(a.start_time) < hm(b.end_time) && hm(b.start_time) < hm(a.end_time))
        return `${WEEK[a.day_of_week]}요일 수업 시간이 서로 겹쳐요`;
    }
  for (const s of schedules) {
    const [[c]] = await pool.query(
      `SELECT s.name, sc.start_time, sc.end_time FROM schedules sc JOIN subjects s ON s.subject_id = sc.subject_id
       WHERE s.user_id = ? AND NOT (s.subject_id <=> ?) AND sc.day_of_week = ? AND sc.start_time < ? AND sc.end_time > ? LIMIT 1`,
      [userId, exceptSubjectId, Number(s.day_of_week), `${hm(s.end_time)}:00`, `${hm(s.start_time)}:00`],
    );
    if (c) return `${WEEK[s.day_of_week]}요일 ${hm(c.start_time)}~${hm(c.end_time)} ${c.name} 수업과 겹쳐요`;
  }
  return null;
}

async function saveSchedules(conn, subjectId, schedules) {
  await conn.query("DELETE FROM schedules WHERE subject_id = ?", [subjectId]);
  for (const s of schedules)
    await conn.query("INSERT INTO schedules (subject_id, day_of_week, start_time, end_time, room) VALUES (?, ?, ?, ?, ?)", [
      subjectId,
      Number(s.day_of_week),
      s.start_time,
      s.end_time,
      String(s.room || "").trim().slice(0, 50) || null,
    ]);
}

router.get("/", async (req, res, next) => {
  try {
    res.json({ ok: true, data: await listSubjects(req.session.user.user_id) });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  const v = parseBody(req.body);
  if (typeof v === "string") return res.status(400).json({ ok: false, error: v });
  let clash;
  try {
    clash = await scheduleClash(req.session.user.user_id, v.schedules);
  } catch (err) {
    return next(err);
  }
  if (clash) return res.status(409).json({ ok: false, error: clash });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query("INSERT INTO subjects (user_id, name, professor, color) VALUES (?, ?, ?, ?)", [
      req.session.user.user_id,
      v.name,
      v.professor,
      v.color,
    ]);
    await saveSchedules(conn, r.insertId, v.schedules);
    await conn.commit();
    res.status(201).json({ ok: true, data: { subject_id: r.insertId } });
  } catch (err) {
    await conn.rollback();
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ ok: false, error: "이미 있는 과목명이에요" });
    next(err);
  } finally {
    conn.release();
  }
});

router.put("/:id", async (req, res, next) => {
  const v = parseBody(req.body);
  if (typeof v === "string") return res.status(400).json({ ok: false, error: v });
  let clash;
  try {
    clash = await scheduleClash(req.session.user.user_id, v.schedules, Number(req.params.id));
  } catch (err) {
    return next(err);
  }
  if (clash) return res.status(409).json({ ok: false, error: clash });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query("UPDATE subjects SET name = ?, professor = ?, color = ? WHERE subject_id = ? AND user_id = ?", [
      v.name,
      v.professor,
      v.color,
      req.params.id,
      req.session.user.user_id,
    ]);
    if (!r.affectedRows) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "과목을 찾을 수 없어요" });
    }
    await saveSchedules(conn, req.params.id, v.schedules);
    await conn.commit();
    res.json({ ok: true, data: { subject_id: Number(req.params.id) } });
  } catch (err) {
    await conn.rollback();
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ ok: false, error: "이미 있는 과목명이에요" });
    next(err);
  } finally {
    conn.release();
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const [r] = await pool.query("DELETE FROM subjects WHERE subject_id = ? AND user_id = ?", [
      req.params.id,
      req.session.user.user_id,
    ]);
    if (!r.affectedRows) return res.status(404).json({ ok: false, error: "과목을 찾을 수 없어요" });
    res.json({ ok: true, data: null });
  } catch (err) {
    next(err);
  }
});

router.listSubjects = listSubjects;
router.subjectOverview = subjectOverview;
module.exports = router;
