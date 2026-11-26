// /auth/google  구글 동의 화면으로 보내고, callback에서 토큰을 받아 integrations에 저장 → 연동 설정 화면으로
// state: 세션에 저장한 랜덤 값과 callback의 값이 같아야만 저장 (CSRF 방지)
const crypto = require("crypto");
const express = require("express");
const google = require("../services/google");
const { requireLogin } = require("../middleware/auth");

const router = express.Router();
router.use(requireLogin);

router.get("/google", (req, res, next) => {
  try {
    if (!google.configured()) return res.redirect("/settings?google=unconfigured");
    const state = crypto.randomBytes(16).toString("hex");
    req.session.googleState = state;
    res.redirect(google.authUrl(state));
  } catch (err) {
    next(err);
  }
});

router.get("/google/callback", async (req, res, next) => {
  try {
    const expected = req.session.googleState;
    delete req.session.googleState;
    // 사용자가 동의 화면에서 취소한 경우
    if (req.query.error) return res.redirect("/settings?google=denied");
    if (!expected || req.query.state !== expected || !req.query.code) return res.redirect("/settings?google=error");
    const scopes = await google.saveTokens(req.session.user.user_id, String(req.query.code));
    // 체크박스를 끄고 허용하면 일부 권한이 빠질 수 있다
    const full = scopes.some((s) => s.includes("calendar")) && scopes.some((s) => s.includes("gmail"));
    res.redirect(`/settings?google=${full ? "connected" : "partial"}`);
  } catch (err) {
    console.error("[oauth:google]", err.response?.data?.error || err.message);
    res.redirect("/settings?google=error");
  }
});

module.exports = router;
