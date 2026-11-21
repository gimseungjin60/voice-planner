// information_schema → Mermaid erDiagram 출력
require("dotenv").config({ quiet: true });
const mysql = require("mysql2/promise");
(async () => {
  const db = process.env.DB_NAME || "voiceplanner";
  const c = await mysql.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: db });
  const [cols] = await c.query(
    "SELECT TABLE_NAME t, COLUMN_NAME c, DATA_TYPE d, COLUMN_KEY k, IS_NULLABLE n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME, ORDINAL_POSITION", [db]);
  const [fks] = await c.query(
    "SELECT k.TABLE_NAME t, k.COLUMN_NAME c, k.REFERENCED_TABLE_NAME rt, col.IS_NULLABLE n FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.COLUMNS col ON col.TABLE_SCHEMA=k.TABLE_SCHEMA AND col.TABLE_NAME=k.TABLE_NAME AND col.COLUMN_NAME=k.COLUMN_NAME WHERE k.TABLE_SCHEMA=? AND k.REFERENCED_TABLE_NAME IS NOT NULL", [db]);
  await c.end();
  const fkSet = new Set(fks.map((f) => f.t + "." + f.c));
  const out = ["# ERD", "", "```mermaid", "erDiagram"];
  for (const f of fks) out.push(`    ${f.rt} ${f.n === "YES" ? "|o" : "||"}--o{ ${f.t} : "${f.c}"`);
  let cur = null;
  for (const r of cols) {
    if (r.t !== cur) { if (cur) out.push("    }"); out.push(`    ${r.t} {`); cur = r.t; }
    const key = r.k === "PRI" ? " PK" : fkSet.has(r.t + "." + r.c) ? " FK" : r.k === "UNI" ? " UK" : "";
    out.push(`        ${r.d} ${r.c}${key}`);
  }
  if (cur) out.push("    }");
  out.push("```");
  console.log(out.join("\n"));
})().catch((e) => { console.error(e.message); process.exit(1); });
