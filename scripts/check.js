// npm run check: 모든 .js 문법 검사 + (서버가 떠 있으면) 주요 화면 스모크 테스트
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    if (["node_modules", ".git"].includes(f)) continue;
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".js")) files.push(p);
  }
})(root);
let fail = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); }
  catch (e) { fail++; console.error(`문법 오류: ${path.relative(root, f)}\n${e.stderr}`); }
}
console.log(`문법 검사: ${files.length}개 중 ${files.length - fail}개 통과`);
const port = process.env.PORT || 3000;
fetch(`http://localhost:${port}/login`)
  .then((r) => { console.log(`스모크: GET /login → ${r.status}`); if (r.status >= 500) fail++; })
  .catch(() => console.log("스모크: 서버가 꺼져 있어 건너뜀"))
  .finally(() => process.exit(fail ? 1 : 0));
