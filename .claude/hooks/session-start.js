// SessionStart: 세션 시작 시 현재 상태를 Claude에게 알려준다 (stdout = 컨텍스트로 추가됨)
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const lines = ["[보이스 플래너 세션 상태]"];
lines.push(fs.existsSync(path.join(dir, ".env")) ? "- .env 있음" : "- .env 없음: .env.example을 복사해 만들라고 사용자에게 안내");
lines.push(fs.existsSync(path.join(dir, "node_modules")) ? "- 의존성 설치됨" : "- node_modules 없음: npm install 필요");
try {
  require(path.join(dir, "node_modules/dotenv")).config({ path: path.join(dir, ".env"), quiet: true });
  const mysql = require(path.join(dir, "node_modules/mysql2"));
  const c = mysql.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  c.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE()", (err, rows) => {
    lines.push(err ? `- DB 연결 실패: ${err.code}` : `- DB 연결 OK, 테이블 ${rows[0].n}개 (8개가 정상)`);
    c.end();
    finish();
  });
} catch (_) {
  lines.push("- DB 확인 건너뜀 (의존성 또는 .env 없음)");
  finish();
}
function finish() {
  try { lines.push("- 브랜치: " + execSync("git branch --show-current", { cwd: dir, stdio: ["ignore", "pipe", "ignore"] }).toString().trim()); } catch (_) {}
  console.log(lines.join("\n"));
}
