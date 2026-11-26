// /api/sync  구글 캘린더 일정 → events, Gmail 새 메일 → AI 분석 → inbox_items
// 외부에서 받은 것은 DB에 저장만 한다. 화면은 /api/timeline·/api/inbox가 DB에서 읽는다
const express = require("express");
const pool = require("../../db");
const google = require("../../services/google");
const ai = require("../../services/ai");
const { requireLogin } = require("../../middleware/auth");

const router = express.Router();
router.use(requireLogin);

const addDays = (ymd, n) => new Date(Date.parse(ymd + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

// 오늘~14일 일정을 upsert하고, 같은 범위에서 구글에 더 이상 없는 구글 일정은 지운다
router.post("/calendar", async (req, res, next) => {
  try {
    const userId = req.session.user.user_id;
    const from = pool.kst().slice(0, 10);
    const to = addDays(from, 13);
    const events = await google.listEvents(userId, from, to);
    const now = pool.kst();
    for (const e of events) {
      await pool.query(
        `INSERT INTO events (user_id, provider, external_id, title, start_at, end_at, location, synced_at) VALUES (?, 'google', ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE title = VALUES(title), start_at = VALUES(start_at), end_at = VALUES(end_at), location = VALUES(location), synced_at = VALUES(synced_at)`,
        [userId, e.external_id, e.title, e.start_at, e.end_at, e.location, now],
      );
    }
    // 이번 동기화에서 갱신되지 않은(=구글에서 지워진) 범위 안 구글 일정 삭제
    const [del] = await pool.query(
      "DELETE FROM events WHERE user_id = ? AND provider = 'google' AND start_at <= ? AND end_at >= ? AND (synced_at IS NULL OR synced_at < ?)",
      [userId, `${to} 23:59:59`, `${from} 00:00:00`, now],
    );
    await pool.query("UPDATE integrations SET last_synced_at = ? WHERE user_id = ? AND provider = 'google'", [now, userId]);
    res.json({ ok: true, data: { synced: events.length, removed: del.affectedRows } });
  } catch (err) {
    next(err);
  }
});

// 최근 7일 메일 중 처음 보는 것만 AI에 보낸다 (보낸 사람·제목·snippet만, 본문 저장 안 함)
// 할 일이 없는 메일도 '봤음' 표시로 inbox_items에 ID만 남긴다 (ai_title NULL + ignored → 목록에는 안 보임, 다시 분석 안 함)
router.post("/gmail", async (req, res, next) => {
  try {
    const userId = req.session.user.user_id;
    const [seen] = await pool.query("SELECT external_id FROM inbox_items WHERE user_id = ? AND provider = 'gmail' ORDER BY item_id DESC LIMIT 500", [userId]);
    const mails = await google.recentMails(userId, new Set(seen.map((r) => r.external_id)));
    if (!mails.length) return res.json({ ok: true, data: { found: 0, checked: 0 } });

    const [subjects] = await pool.query("SELECT subject_id, name FROM subjects WHERE user_id = ?", [userId]);
    const found = await ai.analyzeMails({ userId, mails, subjects: subjects.map((s) => s.name), today: pool.kst().slice(0, 10) });
    // AI 실패: 아무것도 표시하지 않고 다음 동기화 때 다시 분석
    if (!found) return res.json({ ok: true, data: { found: 0, checked: mails.length, ai_failed: true } });

    const byMail = new Map(found.map((f) => [f.mail.id, f]));
    const subjectId = (name) => subjects.find((s) => s.name === name)?.subject_id || null;
    for (const m of mails) {
      const f = byMail.get(m.id);
      if (f) {
        await pool.query(
          `INSERT IGNORE INTO inbox_items (user_id, provider, external_id, sender, subject, received_at, subject_id, ai_title, ai_due_at)
           VALUES (?, 'gmail', ?, ?, ?, ?, ?, ?, ?)`,
          [userId, m.id, m.sender, m.subject, m.received_at, subjectId(f.subject), f.title, f.due_at],
        );
      } else {
        await pool.query("INSERT IGNORE INTO inbox_items (user_id, provider, external_id, status) VALUES (?, 'gmail', ?, 'ignored')", [userId, m.id]);
      }
    }
    await pool.query("UPDATE integrations SET last_synced_at = ? WHERE user_id = ? AND provider = 'google'", [pool.kst(), userId]);
    res.json({ ok: true, data: { found: found.length, checked: mails.length } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
