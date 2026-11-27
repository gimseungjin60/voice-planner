// /api/briefing  오늘 브리핑 (없으면 AI로 만들어 저장)
const express = require("express");
const pool = require("../../db");
const ai = require("../../services/ai");
const { requireLogin } = require("../../middleware/auth");
const academic = require("../../config/academic");

const router = express.Router();
router.use(requireLogin);

// 오늘(한국 시간) 요일의 내 수업. 대시보드에서도 재사용. 방학·공휴일이면 빈 배열 (config/academic.js)
async function todayClasses(userId) {
  if (!academic.classOn(pool.kst().slice(0, 10))) return [];
  const [rows] = await pool.query(
    `SELECT s.subject_id, s.name, s.color, sc.start_time, sc.end_time, sc.room
     FROM schedules sc JOIN subjects s ON s.subject_id = sc.subject_id
     WHERE s.user_id = ? AND sc.day_of_week = ? ORDER BY sc.start_time`,
    [userId, pool.kstDay()],
  );
  return rows;
}

// 마지막 글자에 받침이 있나 ('추석이라' / '추석 연휴라')
const hasBatchim = (w) => {
  const c = w.charCodeAt(w.length - 1) - 0xac00;
  return c >= 0 && c <= 11171 && c % 28 !== 0;
};

// AI 실패 시 쓰는 기본 문장 (저장하지 않아 다음에 다시 AI를 시도한다)
function fallbackText(name, classes, dueTasks, now = pool.kst()) {
  const h = Number(now.slice(11, 13));
  const hello = h < 12 ? "좋은 아침이에요" : h < 18 ? "좋은 오후예요" : "오늘 하루 수고했어요";
  const why = academic.noClassReason(now.slice(0, 10));
  const c = classes.length ? `오늘 수업은 ${classes.map((x) => `${x.name} ${x.start_time.slice(0, 5)}`).join(", ")}입니다.` : why ? `오늘은 ${why}${hasBatchim(why) ? "이라" : "라"} 수업이 없어요.` : "오늘은 수업이 없어요.";
  const upcoming = dueTasks.filter((t) => t.due_at >= now);
  const d2 = upcoming.length ? `다가오는 마감은 ${upcoming.map((t) => t.title).join(", ")}입니다.` : "급한 마감은 없어요.";
  return `${name}님, ${hello}. ${c} ${d2} 오늘도 힘내세요!`;
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
    const now = pool.kst();
    const content = await ai.makeBriefing({ userId, userName, today, now: now.slice(0, 16), classes, dueTasks, dayNote: academic.dayNote(today)?.label });
    if (!content) return res.json({ ok: true, data: { content: fallbackText(userName, classes, dueTasks, now), ai_ok: false } });
    // 동시에 두 번 요청돼도 하루 1개 (uq_user_date)
    await pool.query("INSERT IGNORE INTO briefings (user_id, brief_date, content) VALUES (?, ?, ?)", [userId, today, content]);
    res.json({ ok: true, data: { content, cached: false } });
  } catch (err) {
    next(err);
  }
});

// 오늘 브리핑 음성(mp3). 브리핑이 아직 없으면 404 → 화면은 브라우저 TTS로 대체
// ponytail: 메모리 캐시라 서버 재시작 시 다시 생성 (하루 1~2센트). 사용자 많아지면 파일로 저장
const audioCache = new Map();
router.get("/today/audio", async (req, res, next) => {
  try {
    const userId = req.session.user.user_id;
    const today = pool.kst().slice(0, 10);
    const [[saved]] = await pool.query("SELECT content FROM briefings WHERE user_id = ? AND brief_date = ?", [userId, today]);
    if (!saved) return res.status(404).json({ ok: false, error: "오늘 브리핑이 아직 없어요" });
    const key = `${userId}:${today}`;
    if (audioCache.has(key)) return res.type("audio/mpeg").send(audioCache.get(key));
    const stream = await ai.speak({ userId, text: saved.content });
    if (!stream) return res.status(502).json({ ok: false, error: "음성을 만들지 못했어요" });
    // 만들어지는 대로 브라우저로 흘려보내면서 모아 두었다가 다 받으면 캐시 (nginx 버퍼링 끔)
    res.type("audio/mpeg").set("X-Accel-Buffering", "no");
    const parts = [];
    for await (const chunk of stream) {
      parts.push(chunk);
      res.write(chunk);
    }
    res.end();
    for (const k of audioCache.keys()) if (!k.endsWith(today)) audioCache.delete(k); // 지난 날짜 정리
    audioCache.set(key, Buffer.concat(parts));
  } catch (err) {
    next(err);
  }
});

router.todayClasses = todayClasses;
module.exports = router;
