// 로그인·관리자 체크. API는 JSON 401/403, 화면은 /login으로 redirect
const pool = require("../db");
const isApi = (req) => req.originalUrl.startsWith("/api");

function needLogin(req, res) {
  if (isApi(req)) return res.status(401).json({ ok: false, error: "로그인이 필요해요" });
  res.redirect("/login");
}

// 관리자가 회원을 지우면 그 사람의 세션도 바로 끊는다 (지운 뒤 요청마다 500이 나지 않게)
exports.requireLogin = async (req, res, next) => {
  if (!req.session.user) return needLogin(req, res);
  try {
    const [[u]] = await pool.query("SELECT 1 FROM users WHERE user_id = ?", [req.session.user.user_id]);
    if (u) return next();
    req.session.destroy(() => needLogin(req, res));
  } catch (err) {
    next(err);
  }
};

exports.requireAdmin = (req, res, next) => {
  if (req.session.user?.role === "admin") return next();
  if (isApi(req)) return res.status(403).json({ ok: false, error: "관리자만 접근할 수 있어요" });
  res.redirect("/");
};
