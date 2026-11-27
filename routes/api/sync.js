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

// 아직 요약이 없는 할 일 후보 메일(최대 10통)의 본문을 받아 형식 요약만 저장 (본문은 저장하지 않음)
// 메일 하나가 실패해도 나머지는 계속, 실패한 것은 다음 동기화 때 다시 시도
async function summarizePending(userId) {
  const [items] = await pool.query(
    "SELECT item_id, external_id, sender, subject FROM inbox_items WHERE user_id = ? AND ai_title IS NOT NULL AND summary IS NULL AND status = 'pending' ORDER BY received_at DESC LIMIT 10",
    [userId],
  );
  const today = pool.kst().slice(0, 10);
  const done = await Promise.all(
    items.map(async (it) => {
      try {
        const body = await google.mailBody(userId, it.external_id);
        if (!body) return 0;
        const summary = await ai.summarizeMail({ userId, sender: it.sender, subject: it.subject, body, today });
        if (!summary) return 0;
        await pool.query("UPDATE inbox_items SET summary = ? WHERE item_id = ? AND user_id = ?", [summary, it.item_id, userId]);
        return 1;
      } catch (err) {
        console.error("[sync:summary]", err.message);
        return 0;
      }
    }),
  );
  return done.reduce((a, b) => a + b, 0);
}

// 중요 메일 후보 → 할 일 (source='gmail'). 후보는 accepted + task_id로 묶어 출처 링크·중복 방지에 쓴다
async function addAsTask(userId, itemId, subjectId, f) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [t] = await conn.query("INSERT INTO tasks (user_id, subject_id, title, due_at, priority, source) VALUES (?, ?, ?, ?, 'high', 'gmail')", [
      userId,
      subjectId,
      f.title,
      f.due_at,
    ]);
    await conn.query("UPDATE inbox_items SET status = 'accepted', task_id = ? WHERE item_id = ? AND user_id = ? AND status = 'pending'", [t.insertId, itemId, userId]);
    await conn.commit();
    return true;
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error("[sync:auto-task]", err.message);
    return false;
  } finally {
    conn.release();
  }
}

// 최근 7일 메일 중 처음 보는 것만 AI에 보낸다 (보낸 사람·제목·snippet만). 후보로 뽑힌 메일만 본문을 받아 형식 요약 (본문 저장 안 함)
// 중요 메일(important)이면서 마감일이 있으면 바로 할 일로 추가하고 후보는 accepted로 남긴다 (받은 편지함 '추가함'에서 확인)
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
    let autoAdded = 0;
    for (const m of mails) {
      const f = byMail.get(m.id);
      if (f) {
        const [ins] = await pool.query(
          `INSERT IGNORE INTO inbox_items (user_id, provider, external_id, sender, subject, received_at, subject_id, ai_title, ai_due_at)
           VALUES (?, 'gmail', ?, ?, ?, ?, ?, ?, ?)`,
          [userId, m.id, m.sender, m.subject, m.received_at, subjectId(f.subject), f.title, f.due_at],
        );
        if (ins.affectedRows && f.important && f.due_at && (await addAsTask(userId, ins.insertId, subjectId(f.subject), f))) autoAdded++;
      } else {
        await pool.query("INSERT IGNORE INTO inbox_items (user_id, provider, external_id, status) VALUES (?, 'gmail', ?, 'ignored')", [userId, m.id]);
      }
    }
    const summarized = await summarizePending(userId);
    await pool.query("UPDATE integrations SET last_synced_at = ? WHERE user_id = ? AND provider = 'google'", [pool.kst(), userId]);
    res.json({ ok: true, data: { found: found.length - autoAdded, auto_added: autoAdded, checked: mails.length, summarized } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
