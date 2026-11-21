// schema.sql을 DB에 적용 (기존 데이터 삭제됨). 샘플 계정 비밀번호를 bcrypt 해시로 교체
require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, multipleStatements: true,
  });
  await c.query(fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8"));
  const hash = await bcrypt.hash("test1234", 10);
  await c.query("UPDATE voiceplanner.users SET password_hash = ? WHERE password_hash = 'CHANGE_ME_BCRYPT'", [hash]);
  const [[{ n }]] = await c.query("SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema='voiceplanner'");
  console.log(`DB 초기화 완료: 테이블 ${n}개, 샘플 계정 student@vp.com / test1234`);
  await c.end();
})().catch((e) => { console.error("DB 초기화 실패:", e.message); process.exit(1); });
