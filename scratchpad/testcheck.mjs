import fs from "node:fs";
import path from "node:path";
const hits = JSON.parse(fs.readFileSync(process.env.HITS ?? "/tmp/scb/out3/hits.json", "utf8"));
const strs = [...new Set(hits.flatMap((h) => [...h.innerText, ...h.title]))];
const roots = ["apps/frontend-shell/test", "apps/datacore/test", "apps/agentcore/test", "packages/contracts/test", "scripts"];
const files = [];
const walk = (d) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx|mjs|js|json)$/.test(e.name)) files.push(p); } };
roots.forEach(walk);
let n = 0;
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  src.split("\n").forEach((ln, i) => { for (const s of strs) if (ln.includes(s)) { console.log(`${f}:${i + 1} ${s}`); n++; } });
}
console.log("TEST/SCRIPT 引用数:", n, "（金丝雀：扫了", files.length, "个文件）");
