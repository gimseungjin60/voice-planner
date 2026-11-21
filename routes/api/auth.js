// /api/auth  회원가입·로그인·로그아웃·내 정보
const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../../db");
const { requireLogin } = require("../../middleware/auth");

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 세션 고정 공격 방지: 로그인 시 세션 ID를 새로 발급
function startSession(req, user) {
  return new Promise((resolve, reject) =>
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.user = { user_id: user.user_id, email: user.email, user_name: user.user_name, role: user.role };
      req.session.save((e) => (e ? reject(e) : resolve(req.session.user)));
    }),
  );
}

router.post("/signup", async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const userName = String(req.body?.user_name || "").trim();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ ok: false, error: "이메일 형식이 올바르지 않아요" });
    if (password.length < 8) return res.status(400).json({ ok: false, error: "비밀번호는 8자 이상이어야 해요" });
    if (!userName || userName.length > 50) return res.status(400).json({ ok: false, error: "이름을 입력하세요 (50자 이내)" });

    const hash = await bcrypt.hash(password, 10);
    const [r] = await pool.query("INSERT INTO users (email, password_hash, user_name) VALUES (?, ?, ?)", [
      email,
      hash,
      userName,
    ]);
    const user = await startSession(req, { user_id: r.insertId, email, user_name: userName, role: "user" });
    res.status(201).json({ ok: true, data: user });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ ok: false, error: "이미 가입된 이메일이에요" });
    next(err);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const [[user]] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ ok: false, error: "이메일 또는 비밀번호가 틀렸어요" });
    res.json({ ok: true, data: await startSession(req, user) });
  } catch (err) {
    next(err);
  }
});

router.post("/logout", requireLogin, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("connect.sid");
    res.json({ ok: true, data: null });
  });
});

router.get("/me", requireLogin, (req, res) => {
  res.json({ ok: true, data: req.session.user });
});

module.exports = router;
