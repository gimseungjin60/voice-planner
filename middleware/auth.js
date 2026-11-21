// 로그인·관리자 체크. API는 JSON 401/403, 화면은 /login으로 redirect
const isApi = (req) => req.originalUrl.startsWith("/api");

exports.requireLogin = (req, res, next) => {
  if (req.session.user) return next();
  if (isApi(req)) return res.status(401).json({ ok: false, error: "로그인이 필요해요" });
  res.redirect("/login");
};

exports.requireAdmin = (req, res, next) => {
  if (req.session.user?.role === "admin") return next();
  if (isApi(req)) return res.status(403).json({ ok: false, error: "관리자만 접근할 수 있어요" });
  res.redirect("/");
};
