// /api/assistant  음성 비서. body { text } → Claude tool use로 도구 실행 → { reply(TTS용 문장), actions[], pending }
// 일정이 수업·다른 일정과 겹치면 추가하지 않고 빈 시간을 제안해 세션(pendingAction)에 보관한다.
// 다음 말이 수락(좋아·응·그래…)이면 AI를 다시 부르지 않고 바로 추가, 다른 말이면 버린다
const express = require("express");
const pool = require("../../db");
const ai = require("../../services/ai");
const { requireLogin } = require("../../middleware/auth");
const academic = require("../../config/academic");
const { toDatetime, ownSubjectId, TASK_SELECT } = require("./tasks");
const { createEvent } = require("./events");

const router = express.Router();
router.use(requireLogin);

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
// 제안 수락: 짧은 동의 말만 (문장 앞이 "어"·"응"이어도 "어 아니 다른 시간"처럼 뒤에 말이 이어지면 수락이 아님)
const ACCEPT =
  /^(좋아|좋아요|좋습니다|응|어|그래|그래요|네|넵|예|ㅇㅇ|ㅇㅋ|오케이|ok|okay|콜|그걸로|거기로|그렇게해|그렇게해줘|추가해|추가해줘|넣어줘)[.!~요]*$/i;
const PALETTE = [
  "#6C8EF5",
  "#F5A86C",
  "#7CC9A0",
  "#E57373",
  "#A98BF0",
  "#F2C94C",
  "#56C2D6",
  "#A1887F",
];

const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const hm = (m) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const addDays = (ymd, n) =>
  new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const dayOf = (ymd) => new Date(`${ymd}T12:00:00Z`).getUTCDay();
const normTime = (t) => {
  const m = String(t || "").match(HM);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
};

// 그날 바쁜 시간 (수업 + 일정), 분 단위 [start, end, 이름]
async function busyOn(userId, date) {
  // 방학·공휴일에는 시간표 수업이 없다 (config/academic.js)
  const [classes] = !academic.classOn(date) ? [[]] : await pool.query(
    `SELECT s.name, sc.start_time, sc.end_time FROM schedules sc JOIN subjects s ON s.subject_id = sc.subject_id
     WHERE s.user_id = ? AND sc.day_of_week = ? ORDER BY sc.start_time`,
    [userId, dayOf(date)],
  );
  const [events] = await pool.query(
    "SELECT title, start_at, end_at FROM events WHERE user_id = ? AND start_at <= ? AND end_at >= ? ORDER BY start_at",
    [userId, `${date} 23:59:59`, `${date} 00:00:00`],
  );
  return [
    ...classes.map((c) => ({
      start: toMin(c.start_time),
      end: toMin(c.end_time),
      label: `${c.name} 수업`,
    })),
    ...events.map((e) => ({
      start: e.start_at.slice(0, 10) < date ? 0 : toMin(e.start_at.slice(11, 16)),
      end: e.end_at.slice(0, 10) > date ? 24 * 60 : toMin(e.end_at.slice(11, 16)),
      label: e.title,
    })),
  ].sort((a, b) => a.start - b.start);
}

// after(분) 이후 첫 빈 시간 (30분 단위, 09:00~22:00). 없으면 null
function freeSlot(busy, minutes, after = 9 * 60) {
  for (let s = Math.max(9 * 60, Math.ceil(after / 30) * 30); s + minutes <= 22 * 60; s += 30)
    if (!busy.some((b) => s < b.end && s + minutes > b.start)) return s;
  return null;
}

async function listTasks(userId, range) {
  const now = pool.kst();
  const today = now.slice(0, 10);
  const where = ["t.user_id = ?", "t.status <> 'done'"];
  const params = [userId];
  if (range === "today") where.push("DATE(t.due_at) <= ?") && params.push(today);
  if (range === "week") where.push("t.due_at <= ?") && params.push(`${addDays(today, 7)} 23:59:59`);
  const [rows] = await pool.query(
    `${TASK_SELECT} WHERE ${where.join(" AND ")} ORDER BY t.due_at IS NULL, t.due_at LIMIT 15`,
    params,
  );
  return rows.map((t) => ({
    task_id: t.task_id,
    title: t.title,
    subject: t.subject_name,
    due_at: t.due_at,
    overdue: !!t.due_at && t.due_at < now,
    status: t.status,
  }));
}

async function subjectIdByName(userId, name) {
  if (!name) return null;
  const [[row]] = await pool.query(
    "SELECT subject_id FROM subjects WHERE user_id = ? AND name = ?",
    [userId, name],
  );
  return row ? row.subject_id : null;
}

// 일정 추가. 겹치면 추가하지 않고 제안을 세션에 보관
async function addEvent(req, input) {
  const userId = req.session.user.user_id;
  const title = String(input.title || "")
    .trim()
    .slice(0, 200);
  const start = normTime(input.start_time);
  const minutes = Math.min(Math.max(Number(input.minutes) || 60, 10), 12 * 60);
  if (!title || !YMD.test(input.date || "") || !start)
    return { error: "제목·날짜·시작 시각이 필요해요" };
  const s = toMin(start);
  const busy = await busyOn(userId, input.date);
  const clash = busy.find((b) => s < b.end && s + minutes > b.start);
  if (clash) {
    const slot = freeSlot(busy, minutes, clash.end);
    if (slot === null) return { conflict: `${clash.label}과(와) 겹치고 그날은 빈 시간이 없어요` };
    req.session.pendingAction = {
      tool: "add_event",
      input: { ...input, title, start_time: hm(slot), minutes },
    };
    return {
      conflict: `${clash.label}(${hm(clash.start)}~${hm(clash.end)})과(와) 겹쳐서 추가하지 않았어요`,
      suggested_start: hm(slot),
      needs_confirm: true,
    };
  }
  const end = s + minutes;
  const row = await createEvent(userId, {
    title,
    startAt: `${input.date} ${start}:00`,
    endAt: end >= 24 * 60 ? `${input.date} 23:59:00` : `${input.date} ${hm(end)}:00`,
    location:
      String(input.location || "")
        .trim()
        .slice(0, 200) || null,
  });
  return {
    ok: true,
    event_id: row.event_id,
    google: row.provider === "google",
    label: `일정 추가 · ${Number(input.date.slice(5, 7))}/${Number(input.date.slice(8))} ${start} ${title}`,
  };
}

// 시간표에 수업 추가. 과목이 없으면 만든다. 같은 요일 다른 수업과 겹치면 추가하지 않는다
async function addClass(userId, input) {
  const name = String(input.subject || "")
    .trim()
    .slice(0, 100);
  const day = Number(input.day_of_week);
  const start = normTime(input.start_time);
  const end = normTime(input.end_time);
  if (!name) return { error: "과목명이 필요해요" };
  if (!(Number.isInteger(day) && day >= 0 && day <= 6)) return { error: "요일이 올바르지 않아요" };
  if (!start || !end || end <= start) return { error: "시작·끝 시간이 올바르지 않아요" };
  const room =
    String(input.room || "")
      .trim()
      .slice(0, 50) || null;
  const [clash] = await pool.query(
    `SELECT s.name, sc.start_time, sc.end_time FROM schedules sc JOIN subjects s ON s.subject_id = sc.subject_id
     WHERE s.user_id = ? AND sc.day_of_week = ? AND sc.start_time < ? AND sc.end_time > ?`,
    [userId, day, `${end}:00`, `${start}:00`],
  );
  const same = clash.find(
    (c) => c.name === name && c.start_time.slice(0, 5) === start && c.end_time.slice(0, 5) === end,
  );
  if (same)
    return { ok: true, already: true, label: `이미 있는 수업 · ${name} ${WEEK[day]} ${start}` };
  if (clash.length)
    return {
      conflict: `${WEEK[day]}요일 ${clash[0].start_time.slice(0, 5)}~${clash[0].end_time.slice(0, 5)} ${clash[0].name} 수업과 겹쳐서 추가하지 않았어요`,
    };

  let subjectId = await subjectIdByName(userId, name);
  let created = false;
  if (!subjectId) {
    const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM subjects WHERE user_id = ?", [
      userId,
    ]);
    const [r] = await pool.query(
      "INSERT INTO subjects (user_id, name, professor, color) VALUES (?, ?, ?, ?)",
      [
        userId,
        name,
        String(input.professor || "")
          .trim()
          .slice(0, 50) || null,
        PALETTE[Number(n) % PALETTE.length],
      ],
    );
    subjectId = r.insertId;
    created = true;
  }
  await pool.query(
    "INSERT INTO schedules (subject_id, day_of_week, start_time, end_time, room) VALUES (?, ?, ?, ?, ?)",
    [subjectId, day, start, end, room],
  );
  return {
    ok: true,
    new_subject: created,
    label: `시간표 추가 · ${name} ${WEEK[day]} ${start}~${end}${room ? ` ${room}` : ""}`,
  };
}

// 도구 실행. 모든 쿼리는 로그인한 사용자 것만
async function runTool(req, name, input) {
  const userId = req.session.user.user_id;
  switch (name) {
    case "add_task": {
      const title = String(input.title || "")
        .trim()
        .slice(0, 200);
      if (!title) return { error: "할 일 이름이 필요해요" };
      const dueAt = toDatetime(input.due_at) || null;
      const subjectId = await ownSubjectId(userId, await subjectIdByName(userId, input.subject));
      const priority = ["low", "mid", "high"].includes(input.priority) ? input.priority : "mid";
      // 같은 과목·같은 이름의 안 끝난 할 일이 있으면 새로 만들지 않고 마감만 맞춘다
      const [[dup]] = await pool.query(
        `SELECT task_id, due_at FROM tasks WHERE user_id = ? AND status <> 'done' AND subject_id <=> ?
         AND REPLACE(LOWER(title), ' ', '') = REPLACE(LOWER(?), ' ', '') LIMIT 1`,
        [userId, subjectId, title],
      );
      if (dup) {
        if (dueAt && dueAt !== dup.due_at) {
          await pool.query("UPDATE tasks SET due_at = ? WHERE task_id = ? AND user_id = ?", [dueAt, dup.task_id, userId]);
          return { ok: true, task_id: dup.task_id, due_at: dueAt, updated: true, label: `마감 변경 · ${title}` };
        }
        return { ok: true, task_id: dup.task_id, already: true, label: `이미 있는 할 일 · ${title}` };
      }
      const [r] = await pool.query(
        "INSERT INTO tasks (user_id, subject_id, title, due_at, priority, source) VALUES (?, ?, ?, ?, ?, 'voice')",
        [userId, subjectId, title, dueAt, priority],
      );
      return { ok: true, task_id: r.insertId, due_at: dueAt, label: `할 일 추가 · ${title}` };
    }
    case "list_tasks":
      return { tasks: await listTasks(userId, input.range) };
    case "complete_task": {
      const [[t]] = await pool.query(
        "SELECT task_id, title FROM tasks WHERE task_id = ? AND user_id = ?",
        [input.task_id, userId],
      );
      if (!t) return { error: "그 할 일을 찾지 못했어요" };
      await pool.query(
        "UPDATE tasks SET status = 'done', completed_at = ? WHERE task_id = ? AND user_id = ?",
        [pool.kst(), t.task_id, userId],
      );
      return { ok: true, label: `완료 · ${t.title}` };
    }
    case "add_event":
      return addEvent(req, input);
    case "list_schedule": {
      if (!YMD.test(input.from || "") || !YMD.test(input.to || ""))
        return { error: "날짜 형식이 올바르지 않아요" };
      const days = [];
      for (let d = input.from, i = 0; d <= input.to && i < 14; d = addDays(d, 1), i++)
        days.push({
          date: d,
          weekday: WEEK[dayOf(d)],
          items: (await busyOn(userId, d)).map((b) => `${hm(b.start)}~${hm(b.end)} ${b.label}`),
        });
      return { days };
    }
    case "find_free_slot": {
      if (!YMD.test(input.date || "")) return { error: "날짜 형식이 올바르지 않아요" };
      const minutes = Math.min(Math.max(Number(input.minutes) || 60, 10), 12 * 60);
      const slot = freeSlot(await busyOn(userId, input.date), minutes);
      return slot === null ? { free: null } : { free: `${hm(slot)}~${hm(slot + minutes)}` };
    }
    case "add_class":
      return addClass(userId, input);
    default:
      return { error: `모르는 도구: ${name}` };
  }
}

const speakTime = (t) => {
  const m = toMin(t);
  const ampm = m < 720 ? "오전" : m < 780 ? "낮" : "오후";
  return `${ampm} ${Math.floor(m / 60) % 12 || 12}시${m % 60 ? ` ${m % 60}분` : ""}`;
};

router.post("/", async (req, res, next) => {
  try {
    const text = String(req.body?.text || "")
      .trim()
      .slice(0, 500);
    if (!text) return res.status(400).json({ ok: false, error: "말씀이나 입력이 비어 있어요" });
    const userId = req.session.user.user_id;

    // 직전에 제안한 일정이 있으면: 수락이면 바로 추가, 아니면 버리고 새 요청으로 처리
    const pending = req.session.pendingAction;
    req.session.pendingAction = null;
    if (pending && ACCEPT.test(text.replace(/\s/g, ""))) {
      const r = await addEvent(req, pending.input);
      const p = req.session.pendingAction; // 그 사이 다른 일정이 생겨 또 겹치면 새 제안
      const reply = r.ok
        ? `좋아요. ${speakTime(pending.input.start_time)}에 ${pending.input.title} 일정을 추가했어요.${r.google ? " 구글 캘린더에도 넣었어요." : ""}`
        : p
          ? `그 사이 일정이 생겨서 겹쳐요. ${speakTime(p.input.start_time)}은 어때요?`
          : r.conflict || r.error;
      return res.json({
        ok: true,
        data: {
          reply,
          actions: r.ok ? [{ tool: "add_event", label: r.label }] : [],
          pending: p ? { label: p.input.start_time } : null,
        },
      });
    }

    const [subjects] = await pool.query(
      "SELECT name FROM subjects WHERE user_id = ? ORDER BY name",
      [userId],
    );
    const result = await ai.runAssistant({
      userId,
      text,
      today: pool.kst().slice(0, 10),
      subjects: subjects.map((s) => s.name),
      runTool: (name, input) => runTool(req, name, input),
    });
    if (!result)
      return res
        .status(502)
        .json({ ok: false, error: "AI 비서가 지금 응답하지 않아요. 잠시 후 다시 말씀해 주세요" });

    // 화면에는 실제로 바뀐 것만 칩으로 보여준다 (조회 도구는 제외)
    const actions = result.actions
      .filter((a) => a.result?.label)
      .map((a) => ({ tool: a.tool, label: a.result.label }));
    const p = req.session.pendingAction;
    res.json({
      ok: true,
      data: { reply: result.reply, actions, pending: p ? { label: p.input.start_time } : null },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
