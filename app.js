// 미들웨어·라우터 등록만 한다. 로직은 routes/, services/에
require("dotenv").config({ quiet: true });
const path = require("path");
const express = require("express");
const session = require("express-session");

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("trust proxy", 1); // EC2 nginx 뒤에서 동작

app.use(express.json({ limit: "200kb" })); // 강의 녹음 텍스트가 길 수 있음
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));
// ponytail: 메모리 세션 저장소라 서버 재시작 시 로그아웃됨. 필요하면 express-mysql-session으로 교체
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-only-secret",
    resave: false,
    saveUninitialized: false,
    // secure "auto": EC2 HTTPS(nginx X-Forwarded-Proto)에선 secure 쿠키, 로컬 http에선 일반 쿠키
    cookie: { httpOnly: true, secure: "auto", sameSite: "lax", maxAge: 1000 * 60 * 60 * 24 * 7 },
  }),
);
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.path = req.path;
  next();
});

app.use("/api/auth", require("./routes/api/auth"));
app.use("/api/subjects", require("./routes/api/subjects"));
app.use("/api/memos", require("./routes/api/memos"));
app.use("/api/tasks", require("./routes/api/tasks"));
app.use("/api/briefing", require("./routes/api/briefing"));
app.use("/api/admin", require("./routes/api/admin"));
app.use("/api/inbox", require("./routes/api/inbox"));
app.use("/api/integrations", require("./routes/api/integrations"));
app.use("/api/events", require("./routes/api/events"));
app.use("/api/timeline", require("./routes/api/timeline"));
app.use("/api/sync", require("./routes/api/sync"));
app.use("/api/notion", require("./routes/api/notion"));
app.use("/api/assistant", require("./routes/api/assistant"));
app.use("/auth", require("./routes/oauth"));
app.use("/", require("./routes/pages"));

app.use((req, res) => {
  if (req.originalUrl.startsWith("/api")) return res.status(404).json({ ok: false, error: "없는 API예요" });
  res.status(404).render("error", { title: "404", message: "페이지를 찾을 수 없어요" });
});
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (err.expose) console.error(`[${status}] ${err.message}`);
  else console.error(err);
  if (res.headersSent) return res.destroy(); // 음성 스트리밍 도중 실패: 이미 보낸 응답은 끊기만 한다
  // 5xx는 내부 메시지를 숨긴다. 단 외부 연동 안내(services에서 expose=true로 만든 에러)는 그대로 보여준다
  const message = status < 500 || err.expose ? err.message : "서버 오류가 발생했어요";
  if (req.originalUrl.startsWith("/api")) return res.status(status).json({ ok: false, error: message });
  res.status(status).render("error", { title: "오류", message });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`보이스 플래너 실행 중: http://localhost:${port}`));
