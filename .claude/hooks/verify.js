// Stop: Claude가 "다 했다"고 멈추기 전에 문법 검사를 통과해야 한다. 실패 시 exit 2 → 계속 고치게 함
const { execSync } = require("child_process");
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const input = JSON.parse(raw || "{}");
  if (input.stop_hook_active) process.exit(0); // 무한 루프 방지: 한 번만 되돌려 보냄
  const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  try {
    execSync("npm run --silent check", { cwd: dir, stdio: "pipe" });
    process.exit(0);
  } catch (e) {
    const out = ((e.stdout || "") + (e.stderr || "")).toString().slice(-1500);
    process.stderr.write(`[verify] npm run check 실패. 고친 뒤 마무리하세요.\n${out}\n`);
    process.exit(2);
  }
});
