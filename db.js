// mysql2 커넥션 풀 (교수님 todosapp과 같은 방식). dateStrings: DATETIME을 'YYYY-MM-DD HH:mm:ss' 문자열로 받아 시간대 문제를 피한다
require("dotenv").config({ quiet: true });
const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  dateStrings: true,
  connectionLimit: 10,
});

// 한국 시간 기준 'YYYY-MM-DD HH:mm:ss' (EC2 서버 시간대가 UTC여도 동일하게 동작)
pool.kst = (d = new Date()) => d.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" });
// 한국 시간 기준 요일 (0=일 ~ 6=토)
pool.kstDay = (d = new Date()) => new Date(pool.kst(d).replace(" ", "T")).getDay();

module.exports = pool;
