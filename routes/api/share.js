// /api/share  내 일정 공유 링크 (친구가 로그인 없이 보는 읽기 전용 주간 일정)
// 링크 주소 = /s/<토큰>. 토큰은 추측할 수 없는 랜덤 32자, 끄면 행을 지우고 다시 켜면 새 토큰
// 공개 범위: busy(바쁜 시간만) / title(수업·일정 제목) / all(제목 + 할 일 마감). 메일·메모·할 일 상세는 어느 범위에서도 내보내지 않는다
const crypto = require("crypto");
const express = require("express");
const pool = require("../../db");
const { requireLogin } = require("../../middleware/auth");
const academic = require("../../config/academic");

const router = express.Router();

const LEVELS = ["busy", "title", "all"];
const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

const newToken = () => crypto.randomBytes(24).toString("base64url"); // 32자
const addDays = (ymd, n) =>
  new Date(Date.parse(ymd + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const dowOf = (ymd) => new Date(ymd + "T12:00:00Z").getUTCDay();
const toMin = (hms) => Number(hms.slice(0, 2)) * 60 + Number(hms.slice(3, 5));
const hm = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
// 일정 색: 과목색(사용자가 고름)과 겹치지 않는 인디고. 수업은 과목색, 일정은 이 색 (애플·노션 캘린더처럼 옅은 바탕 + 왼쪽 띠)
const EVENT_COLOR = "#5E5CE6";
const safeColor = (c) => (/^#[0-9a-fA-F]{6}$/.test(c || "") ? c : null);
// 그 날짜가 속한 주의 월요일 (한국 시간 날짜 기준)
const mondayOf = (ymd) => addDays(ymd, -((dowOf(ymd) + 6) % 7));

// ---------- 공유 설정 ----------
async function getShare(userId) {
  const [[row]] = await pool.query(
    "SELECT share_id, token, visibility, view_count, last_viewed_at, created_at FROM share_links WHERE user_id = ?",
    [userId],
  );
  return row || null;
}

// 토큰으로 공유 찾기 (공개 화면용). 주인 이름도 같이
async function findByToken(token) {
  if (!TOKEN_RE.test(token || "")) return null;
  const [[row]] = await pool.query(
    `SELECT sl.share_id, sl.user_id, sl.visibility, u.user_name
     FROM share_links sl JOIN users u ON u.user_id = sl.user_id WHERE sl.token = ?`,
    [token],
  );
  return row || null;
}

async function countView(shareId) {
  await pool.query(
    "UPDATE share_links SET view_count = view_count + 1, last_viewed_at = ? WHERE share_id = ?",
    [pool.kst(), shareId],
  );
}

// 화면·API에 내보내는 모양 (주소는 요청한 호스트 기준)
function shareOut(req, row) {
  if (!row) return null;
  return {
    url: `${req.protocol}://${req.get("host")}/s/${row.token}`,
    visibility: row.visibility,
    view_count: row.view_count,
    last_viewed_at: row.last_viewed_at,
    created_at: row.created_at,
  };
}

// ---------- 주간 보드 데이터 (내 화면·공유 화면 공용) ----------
// 겹치는 블록은 옆으로 나눠 놓는다: 겹침 묶음마다 빈 줄(lane)에 차례로 배치
function assignLanes(items) {
  items.sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  let group = [];
  let groupEnd = -1;
  const close = () => {
    const lanes = Math.max(1, ...group.map((x) => x.lane + 1));
    group.forEach((x) => (x.lanes = lanes));
    group = [];
  };
  for (const it of items) {
    if (it.startMin >= groupEnd && group.length) close();
    const used = new Set(group.filter((x) => x.endMin > it.startMin).map((x) => x.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    it.lane = lane;
    group.push(it);
    groupEnd = Math.max(groupEnd, it.endMin);
  }
  if (group.length) close();
  return items;
}

// DB에서 한 주 치 수업·일정·마감을 읽는다. 공유 화면에서 마감은 'all'일 때만, 안 끝난 것만 읽는다
async function loadWeek(userId, monday, level) {
  const owner = level === "owner";
  const end = `${addDays(monday, 7)} 00:00:00`;
  const [classes] = await pool.query(
    `SELECT s.subject_id, s.name, s.color, sc.day_of_week, sc.start_time, sc.end_time, sc.room
     FROM schedules sc JOIN subjects s ON s.subject_id = sc.subject_id WHERE s.user_id = ?`,
    [userId],
  );
  const [events] = await pool.query(
    "SELECT event_id, title, start_at, end_at, location FROM events WHERE user_id = ? AND start_at < ? AND end_at > ? ORDER BY start_at",
    [userId, end, `${monday} 00:00:00`],
  );
  let tasks = [];
  if (owner || level === "all") {
    [tasks] = await pool.query(
      `SELECT t.title, t.due_at, t.status, s.name AS subject_name, s.color AS subject_color
       FROM tasks t LEFT JOIN subjects s ON s.subject_id = t.subject_id
       WHERE t.user_id = ? AND t.due_at >= ? AND t.due_at < ? ${owner ? "" : "AND t.status <> 'done'"} ORDER BY t.due_at`,
      [userId, `${monday} 00:00:00`, end],
    );
  }
  return { classes, events, tasks };
}

async function weekBoard(userId, monday, level) {
  return buildBoard(await loadWeek(userId, monday, level), monday, level, pool.kst());
}

/**
 * 한 주(월~일) 보드 만들기 (DB 없이 계산만, 미리보기 서버도 같이 쓴다)
 * level: owner(내 화면, 전부) | busy(바쁨만) | title(제목) | all(제목+마감)
 * 반환: { monday, sunday, days[7]: { ymd, dow, label, date, isToday, blocks[], allDay[], deadlines[] }, from, to, nowMin, counts }
 */
function buildBoard({ classes, events, tasks }, monday, level, nowKst) {
  const owner = level === "owner";
  const showTitle = owner || level === "title" || level === "all";
  const showDeadlines = owner || level === "all";
  const sunday = addDays(monday, 6);
  const today = nowKst.slice(0, 10);

  const days = Array.from({ length: 7 }, (_, i) => {
    const ymd = addDays(monday, i);
    return {
      ymd,
      dow: dowOf(ymd),
      label: WEEK[dowOf(ymd)],
      date: Number(ymd.slice(8)),
      month: Number(ymd.slice(5, 7)),
      isToday: ymd === today,
      blocks: [],
      allDay: [],
      deadlines: [],
      note: academic.dayNote(ymd), // 공휴일·종강·시험 기간·방학 표시
    };
  });
  const counts = { class: 0, event: 0, deadline: 0 };

  // 수업: 요일별 시간표를 이 주 날짜에 펼친다. 방학·공휴일은 건너뛴다
  for (const c of classes) {
    const day = days.find((d) => d.dow === c.day_of_week);
    if (!day || !academic.classOn(day.ymd)) continue;
    counts.class++;
    day.blocks.push({
      kind: "class",
      title: showTitle ? c.name : "바쁨",
      sub: showTitle ? c.room : null,
      color: showTitle ? safeColor(c.color) : null,
      href: owner ? `/subjects/${c.subject_id}` : null,
      startMin: toMin(c.start_time),
      endMin: toMin(c.end_time),
    });
  }

  // 일정: 여러 날에 걸치면 날짜마다 잘라서 넣고, 하루 전체를 덮으면 '하루 종일' 줄로
  for (const e of events) {
    let counted = false;
    for (const day of days) {
      const dayStart = `${day.ymd} 00:00:00`;
      const dayEnd = `${addDays(day.ymd, 1)} 00:00:00`;
      if (!(e.start_at < dayEnd && e.end_at > dayStart)) continue;
      const startMin = e.start_at <= dayStart ? 0 : toMin(e.start_at.slice(11));
      const endMin = e.end_at >= dayEnd ? 24 * 60 : toMin(e.end_at.slice(11));
      if (!counted) {
        counts.event++;
        counted = true;
      }
      const title = showTitle ? e.title : "바쁨";
      if (startMin === 0 && endMin === 24 * 60) {
        day.allDay.push({ kind: "event", title, color: showTitle ? EVENT_COLOR : null });
        continue;
      }
      day.blocks.push({
        kind: "event",
        title,
        sub: owner ? e.location : null,
        color: showTitle ? EVENT_COLOR : null,
        href: null,
        startMin,
        endMin: Math.max(endMin, startMin + 30),
      });
    }
  }

  // 마감: 내 화면은 전부(완료 포함), 공유는 'all'일 때 안 끝난 것만. 제목·과목만 (메모·출처 등은 안 보냄)
  if (showDeadlines) {
    for (const t of tasks) {
      if (!owner && t.status === "done") continue;
      const day = days.find((d) => d.ymd === t.due_at.slice(0, 10));
      if (!day) continue;
      counts.deadline++;
      day.deadlines.push({
        title: t.title,
        time: t.due_at.slice(11, 16),
        subject: t.subject_name,
        color: safeColor(t.subject_color),
        done: t.status === "done",
        late: t.status !== "done" && t.due_at < nowKst,
      });
    }
  }

  // 시간 범위: 기본 9~21시, 블록이 밖에 있으면 넓힌다
  const all = days.flatMap((d) => d.blocks);
  const from = Math.max(0, Math.min(9, ...all.map((b) => Math.floor(b.startMin / 60))));
  const to = Math.min(24, Math.max(21, ...all.map((b) => Math.ceil(b.endMin / 60))));
  // 지난 일정은 흐리게 (구글·애플 캘린더와 같은 관례)
  const curMin = toMin(nowKst.slice(11));
  for (const d of days) {
    assignLanes(d.blocks);
    d.blocks.forEach((b) => {
      b.range = `${hm(b.startMin)}~${hm(b.endMin)}`;
      b.past = d.ymd < today || (d.ymd === today && b.endMin <= curMin);
    });
    d.allDay.forEach((x) => (x.past = d.ymd < today));
    d.busy = d.blocks.length + d.allDay.length;
  }
  const nowMin = today >= monday && today <= sunday ? toMin(nowKst.slice(11)) : null;
  return { monday, sunday, today, days, from, to, nowMin, counts, level };
}

// 쿼리 ?w=YYYY-MM-DD → 그 주 월요일. 공유 화면은 지난주~8주 뒤까지만
function pickMonday(w, { limit = false, today = pool.kst().slice(0, 10) } = {}) {
  const thisMonday = mondayOf(today);
  let monday = YMD.test(w || "") && !Number.isNaN(Date.parse(w)) ? mondayOf(w) : thisMonday;
  const weeks = Math.round((Date.parse(monday) - Date.parse(thisMonday)) / (7 * 86400000));
  const min = limit ? -1 : -52;
  const max = limit ? 8 : 52;
  if (weeks < min) monday = addDays(thisMonday, min * 7);
  if (weeks > max) monday = addDays(thisMonday, max * 7);
  const offset = Math.round((Date.parse(monday) - Date.parse(thisMonday)) / (7 * 86400000));
  const sunday = addDays(monday, 6);
  const md = (ymd) => `${Number(ymd.slice(5, 7))}월 ${Number(ymd.slice(8))}일`;
  return {
    monday,
    offset,
    label: { 0: "이번 주", 1: "다음 주", "-1": "지난주" }[offset] || `${md(monday)} 주`,
    range: `${md(monday)} – ${monday.slice(5, 7) === sunday.slice(5, 7) ? `${Number(sunday.slice(8))}일` : md(sunday)}`,
    thisMonday,
    prev: offset > min ? addDays(monday, -7) : null,
    next: offset < max ? addDays(monday, 7) : null,
  };
}

// ---------- API ----------
router.use(requireLogin);

// 내 공유 상태 (꺼져 있으면 data = null)
router.get("/", async (req, res, next) => {
  try {
    res.json({ ok: true, data: shareOut(req, await getShare(req.session.user.user_id)) });
  } catch (err) {
    next(err);
  }
});

// 공유 켜기 (이미 켜져 있으면 그대로 돌려준다)
router.post("/", async (req, res, next) => {
  try {
    const userId = req.session.user.user_id;
    const visibility = LEVELS.includes(req.body?.visibility) ? req.body.visibility : "busy";
    if (!(await getShare(userId)))
      await pool.query("INSERT INTO share_links (user_id, token, visibility) VALUES (?, ?, ?)", [
        userId,
        newToken(),
        visibility,
      ]);
    res.status(201).json({ ok: true, data: shareOut(req, await getShare(userId)) });
  } catch (err) {
    next(err);
  }
});

// 공개 범위 바꾸기
router.patch("/", async (req, res, next) => {
  try {
    const userId = req.session.user.user_id;
    const visibility = req.body?.visibility;
    if (!LEVELS.includes(visibility))
      return res.status(400).json({ ok: false, error: "공개 범위가 올바르지 않아요" });
    const [r] = await pool.query("UPDATE share_links SET visibility = ? WHERE user_id = ?", [
      visibility,
      userId,
    ]);
    if (!r.affectedRows) return res.status(404).json({ ok: false, error: "공유가 꺼져 있어요" });
    res.json({ ok: true, data: shareOut(req, await getShare(userId)) });
  } catch (err) {
    next(err);
  }
});

// 새 링크로 바꾸기: 예전 주소는 바로 열리지 않는다
router.post("/regenerate", async (req, res, next) => {
  try {
    const userId = req.session.user.user_id;
    const [r] = await pool.query(
      "UPDATE share_links SET token = ?, view_count = 0, last_viewed_at = NULL, created_at = ? WHERE user_id = ?",
      [newToken(), pool.kst(), userId],
    );
    if (!r.affectedRows) return res.status(404).json({ ok: false, error: "공유가 꺼져 있어요" });
    res.json({ ok: true, data: shareOut(req, await getShare(userId)) });
  } catch (err) {
    next(err);
  }
});

// 공유 끄기
router.delete("/", async (req, res, next) => {
  try {
    await pool.query("DELETE FROM share_links WHERE user_id = ?", [req.session.user.user_id]);
    res.json({ ok: true, data: null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.getShare = getShare;
module.exports.findByToken = findByToken;
module.exports.countView = countView;
module.exports.shareOut = shareOut;
module.exports.weekBoard = weekBoard;
module.exports.buildBoard = buildBoard;
module.exports.pickMonday = pickMonday;
module.exports.LEVELS = LEVELS;
