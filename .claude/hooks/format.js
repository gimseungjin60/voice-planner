// PostToolUse: Claude가 저장한 js/css/json/md 파일을 Prettier로 자동 정리 (실패해도 작업은 계속)
const { execFileSync } = require("child_process");
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const ti = (JSON.parse(raw || "{}").tool_input) || {};
  const p = ti.file_path || "";
  if (!/\.(js|css|json|md)$/.test(p) || /node_modules/.test(p)) return;
  try {
    execFileSync("npx", ["--no-install", "prettier", "--write", p], { stdio: "ignore", shell: process.platform === "win32" });
  } catch (_) {
    /* prettier 미설치 등은 무시 */
  }
});
