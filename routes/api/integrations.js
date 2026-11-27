// /api/integrations  연동 상태 조회 · 노션 설정 저장 · LMS 피드 저장 · 연동 해제
// 토큰은 절대 응답에 넣지 않는다 (노션은 끝 4자리 힌트만). 구글 연결은 /auth/google(routes/oauth.js)에서 만든다
const express = require("express");
const pool = require("../../db");
const { requireLogin } = require("../../middleware/auth");
const notion = require("../../services/notion");
const lms = require("../../services/lms");

const router = express.Router();
router.use(requireLogin);

// 승인 범위 문자열 → 화면용 짧은 이름
const scopeNames = (s) => [(s = s || "").includes("calendar") && "calendar", s.includes("gmail") && "gmail"].filter(Boolean);

router.get("/", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      "SELECT provider, access_token, refresh_token, expires_at, scopes, target_ref, connected_at, last_synced_at FROM integrations WHERE user_id = ?",
      [req.session.user.user_id],
    );
    const g = rows.find((r) => r.provider === "google");
    const n = rows.find((r) => r.provider === "notion");
    const l = rows.find((r) => r.provider === "lms");
    // 구글: access token이 만료됐고 갱신할 refresh token도 없으면 '만료'로 본다
    const expired = !!g && !g.refresh_token && !!g.expires_at && g.expires_at < pool.kst();
    res.json({
      ok: true,
      data: {
        google: g ? { connected: true, expired, scopes: scopeNames(g.scopes), connected_at: g.connected_at, last_synced_at: g.last_synced_at } : { connected: false },
        notion: n ? { connected: true, token_hint: `••••${n.access_token.slice(-4)}`, target_ref: n.target_ref, connected_at: n.connected_at, last_synced_at: n.last_synced_at } : { connected: false },
        // LMS 피드 주소는 주소 자체가 비밀번호라 학교 주소(호스트)만 보여준다
        lms: l ? { connected: true, host: new URL(l.access_token).host, connected_at: l.connected_at, last_synced_at: l.last_synced_at } : { connected: false },
      },
    });
  } catch (err) {
    next(err);
  }
});

// 노션 토큰 · 데이터베이스 ID 저장. 이미 연결돼 있으면 토큰은 비워 두고 ID만 바꿀 수 있다
router.put("/notion", async (req, res, next) => {
  try {
    const userId = req.session.user.user_id;
    const token = String(req.body?.token || "").trim();
    const ref = String(req.body?.target_ref || "").replace(/-/g, "").toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(ref)) return res.status(400).json({ ok: false, error: "데이터베이스 ID는 32자리여야 해요" });
    if (token && !/^(ntn_|secret_)\S{10,}$/.test(token)) return res.status(400).json({ ok: false, error: "노션 토큰 형식이 올바르지 않아요" });
    if (token) {
      await pool.query(
        `INSERT INTO integrations (user_id, provider, access_token, target_ref, connected_at) VALUES (?, 'notion', ?, ?, ?)
         ON DUPLICATE KEY UPDATE access_token = VALUES(access_token), target_ref = VALUES(target_ref)`,
        [userId, token, ref, pool.kst()], // 서버(EC2) 시간대가 UTC라 한국 시간을 직접 넣는다
      );
    } else {
      const [r] = await pool.query("UPDATE integrations SET target_ref = ? WHERE user_id = ? AND provider = 'notion'", [ref, userId]);
      if (!r.affectedRows) return res.status(400).json({ ok: false, error: "노션 토큰을 입력하세요" });
    }
    notion.forget(ref); // 속성 이름을 새로 찾게
    res.json({ ok: true, data: null });
  } catch (err) {
    next(err);
  }
});

// LMS 달력 피드 주소 저장. 저장 전에 한 번 읽어 봐서 맞는 주소인지 확인한다 (과목 연결·숨김 설정은 유지)
router.put("/lms", async (req, res, next) => {
  try {
    const userId = req.session.user.user_id;
    const feedUrl = String(req.body?.feed_url || "").trim();
    const items = await lms.fetchAssignments(feedUrl); // 형식이 틀리거나 못 읽으면 안내 메시지 에러
    await pool.query(
      `INSERT INTO integrations (user_id, provider, access_token, target_ref, connected_at) VALUES (?, 'lms', ?, '{}', ?)
       ON DUPLICATE KEY UPDATE access_token = VALUES(access_token)`,
      [userId, feedUrl, pool.kst()],
    );
    res.json({ ok: true, data: { found: items.length } });
  } catch (err) {
    next(err);
  }
});

// 연동 해제: 토큰만 지운다. 이미 가져온 일정·후보·할 일은 그대로 둔다
router.delete("/:provider", async (req, res, next) => {
  try {
    if (!["google", "notion", "lms"].includes(req.params.provider)) return res.status(400).json({ ok: false, error: "알 수 없는 연동이에요" });
    await pool.query("DELETE FROM integrations WHERE user_id = ? AND provider = ?", [req.session.user.user_id, req.params.provider]);
    res.json({ ok: true, data: null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
