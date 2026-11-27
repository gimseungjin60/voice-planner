// /api/memos  음성 메모 저장 + AI 분석 + 후보 확정
const express = require("express");
const pool = require("../../db");
const ai = require("../../services/ai");
const { requireLogin } = require("../../middleware/auth");
const { ownSubjectId, toDatetime } = require("./tasks");

const router = express.Router();
router.use(requireLogin);

const PAGE_SIZE = 10;
const MEMO_SELECT = `SELECT m.*, s.name AS subject_name, s.color AS subject_color
  FROM voice_memos m LEFT JOIN subjects s ON s.subject_id = m.subject_id`;

// 메모 목록 (10개씩 최신순, 과목 필터). 화면에서도 재사용
async function listMemos(userId, page = 1, subjectId = null) {
  const where = ["m.user_id = ?"];
  const params = [userId];
  if (subjectId) where.push("m.subject_id = ?") && params.push(subjectId);
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM voice_memos m WHERE ${where.join(" AND ")}`, params);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  page = Math.min(Math.max(1, Number(page) || 1), pages);
  const [rows] = await pool.query(
    `${MEMO_SELECT} WHERE ${where.join(" AND ")} ORDER BY m.created_at DESC, m.memo_id DESC LIMIT ? OFFSET ?`,
    [...params, PAGE_SIZE, (page - 1) * PAGE_SIZE],
  );
  return { items: rows, page, pages, total };
}

// 강의 녹음 조각(10분 이하) → 텍스트. 본문은 녹음 파일 그대로 (OpenAI 한도 25MB)
router.post("/transcribe", express.raw({ type: ["audio/*", "video/webm"], limit: "25mb" }), async (req, res, next) => {
  try {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ ok: false, error: "녹음 파일이 비어 있어요" });
    const text = await ai.transcribe({
      userId: req.session.user.user_id,
      audio: req.body,
      mime: req.get("content-type").split(";")[0],
      prompt: String(req.query.prompt || ""),
    });
    if (text === null) return res.status(502).json({ ok: false, error: "받아쓰기에 실패했어요. 잠시 후 다시 시도하세요" });
    res.json({ ok: true, data: { text } });
  } catch (err) {
    next(err);
  }
});

async function getMemo(userId, memoId) {
  const [[memo]] = await pool.query(`${MEMO_SELECT} WHERE m.memo_id = ? AND m.user_id = ?`, [memoId, userId]);
  if (!memo) return null;
  const [tasks] = await pool.query(
    "SELECT task_id, title, due_at, priority, status FROM tasks WHERE memo_id = ? AND user_id = ? ORDER BY due_at",
    [memoId, userId],
  );
  return { ...memo, tasks };
}

// 저장 → AI 분석 → 요약·과목 갱신 → 후보 반환. AI가 실패해도 원문은 남는다
router.post("/", async (req, res, next) => {
  try {
    const b = req.body || {};
    const userId = req.session.user.user_id;
    const transcript = String(b.transcript || "").trim();
    const memoType = b.memo_type === "lecture" ? "lecture" : "memo";
    if (!transcript) return res.status(400).json({ ok: false, error: "메모 내용이 비어 있어요" });
    if (transcript.length > 60000) return res.status(400).json({ ok: false, error: "메모가 너무 길어요 (6만 자 이내)" });
    const duration = Number.isInteger(Number(b.duration_sec)) ? Number(b.duration_sec) : null;

    const [r] = await pool.query(
      "INSERT INTO voice_memos (user_id, memo_type, transcript, duration_sec) VALUES (?, ?, ?, ?)",
      [userId, memoType, transcript, duration],
    );
    const memoId = r.insertId;
    const [subjects] = await pool.query("SELECT subject_id, name FROM subjects WHERE user_id = ?", [userId]);
    const names = subjects.map((s) => s.name);
    const idOf = (name) => subjects.find((s) => s.name === name)?.subject_id || null;

    // 시간표: 시각 없는 시험·퀴즈를 그 과목 수업 시작 시각으로 맞추는 데 쓴다
    const [timetable] = await pool.query(
      "SELECT s.name, sc.day_of_week, sc.start_time FROM schedules sc JOIN subjects s ON s.subject_id = sc.subject_id WHERE s.user_id = ? ORDER BY sc.day_of_week, sc.start_time",
      [userId],
    );
    const now = pool.kst();
    const input = { userId, memoId, transcript, subjects: names, today: now.slice(0, 10), now: now.slice(0, 16), timetable };
    const result = memoType === "lecture" ? await ai.summarizeLecture(input) : await ai.extractTasks(input);
    if (result) {
      await pool.query("UPDATE voice_memos SET summary = ?, subject_id = ? WHERE memo_id = ? AND user_id = ?", [
        result.summary || null,
        idOf(result.subject),
        memoId,
        userId,
      ]);
    }
    const memo = await getMemo(userId, memoId);
    res.status(201).json({
      ok: true,
      data: {
        memo,
        ai_ok: !!result,
        ai_error: result ? null : "AI 분석에 실패했어요. 메모 원문만 저장했어요.",
        candidates: (result?.tasks || []).map((t) => ({ ...t, subject_id: idOf(t.subject) })),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/", async (req, res, next) => {
  try {
    res.json({ ok: true, data: await listMemos(req.session.user.user_id, req.query.page, req.query.subject) });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const memo = await getMemo(req.session.user.user_id, req.params.id);
    if (!memo) return res.status(404).json({ ok: false, error: "메모를 찾을 수 없어요" });
    res.json({ ok: true, data: memo });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const [r] = await pool.query("DELETE FROM voice_memos WHERE memo_id = ? AND user_id = ?", [
      req.params.id,
      req.session.user.user_id,
    ]);
    if (!r.affectedRows) return res.status(404).json({ ok: false, error: "메모를 찾을 수 없어요" });
    res.json({ ok: true, data: null });
  } catch (err) {
    next(err);
  }
});

// 사용자가 체크(·수정)한 후보만 tasks로 저장. body: { tasks: [{ title, due_at, priority, subject_id }] }
router.post("/:id/confirm", async (req, res, next) => {
  const userId = req.session.user.user_id;
  const list = Array.isArray(req.body?.tasks) ? req.body.tasks : [];
  if (!list.length) return res.status(400).json({ ok: false, error: "저장할 할 일을 선택하세요" });
  const conn = await pool.getConnection();
  try {
    const [[memo]] = await conn.query("SELECT memo_id FROM voice_memos WHERE memo_id = ? AND user_id = ?", [
      req.params.id,
      userId,
    ]);
    if (!memo) return res.status(404).json({ ok: false, error: "메모를 찾을 수 없어요" });
    const rows = [];
    for (const t of list) {
      const title = String(t.title || "").trim();
      const dueAt = toDatetime(t.due_at);
      if (!title || title.length > 200) return res.status(400).json({ ok: false, error: "제목을 입력하세요 (200자 이내)" });
      if (dueAt === undefined) return res.status(400).json({ ok: false, error: `마감일 형식이 올바르지 않아요: ${title}` });
      const priority = ["low", "mid", "high"].includes(t.priority) ? t.priority : "mid";
      rows.push([userId, await ownSubjectId(userId, t.subject_id), memo.memo_id, title, dueAt, priority]);
    }
    await conn.beginTransaction();
    for (const row of rows)
      await conn.query(
        "INSERT INTO tasks (user_id, subject_id, memo_id, title, due_at, priority, source) VALUES (?, ?, ?, ?, ?, ?, 'ai')",
        row,
      );
    await conn.commit();
    res.status(201).json({ ok: true, data: { saved: rows.length } });
  } catch (err) {
    await conn.rollback().catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

router.listMemos = listMemos;
router.getMemo = getMemo;
module.exports = router;
