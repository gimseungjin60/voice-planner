// PreToolUse: 위험한 명령·파일 수정을 실행 전에 막는다. exit 2 = 차단 (stderr가 Claude에게 전달됨)
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const input = JSON.parse(raw || "{}");
  const tool = input.tool_name || "";
  const ti = input.tool_input || {};
  const block = (msg) => {
    process.stderr.write(`[guard] 차단: ${msg}\n`);
    process.exit(2);
  };

  if (tool === "Edit" || tool === "Write") {
    const p = (ti.file_path || "").replace(/\\/g, "/");
    if (/(^|\/)\.env(\.|$)/.test(p) && !p.endsWith(".env.example"))
      block(".env 파일은 직접 수정하지 않습니다. 필요한 키는 .env.example에 추가하고 사용자에게 알려주세요.");
    if (/(^|\/)node_modules\//.test(p)) block("node_modules는 수정하지 않습니다.");
  }

  if (tool === "Bash") {
    const cmd = ti.command || "";
    if (/rm\s+-[a-z]*r[a-z]*f?\s+(\/|~|\*|\.\s*$)/i.test(cmd)) block("광범위한 rm -rf 명령입니다.");
    if (/git\s+push\s+.*(--force|-f\b)/.test(cmd)) block("force push는 금지입니다.");
    if (/\b(DROP\s+(TABLE|DATABASE)|TRUNCATE)\b/i.test(cmd) && !/schema\.sql|db:init/.test(cmd))
      block("DROP/TRUNCATE는 schema.sql + npm run db:init으로만 실행합니다.");
    if (/cat\s+.*\.env\b/.test(cmd)) block(".env 내용을 출력하지 않습니다.");
  }

  if (tool.startsWith("mcp__mysql__")) {
    const sql = ti.sql || ti.query || "";
    if (/\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT|ALTER)\b/i.test(sql))
      block("MySQL MCP는 조회(SELECT/SHOW/DESCRIBE) 전용입니다.");
  }
  process.exit(0);
});
