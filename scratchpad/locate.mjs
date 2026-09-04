import fs from "node:fs";
import path from "node:path";
const hits = JSON.parse(fs.readFileSync("/tmp/scb/out3/hits.json", "utf8"));
const strs = new Set();
for (const h of hits) for (const k of ["innerText", "title"]) for (const s of h[k]) strs.add(s);
const roots = ["apps/frontend-shell/src", "apps/datacore/src", "apps/agentcore/src", "packages/contracts/src"];
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name)) files.push(p); } };
roots.forEach(walk);
const byFile = new Map();
for (const s of strs) {
  const found = [];
  for (const f of files) {
    const lines = fs.readFileSync(f, "utf8").split("\n");
    lines.forEach((ln, i) => { if (ln.includes(s)) found.push(`${f}:${i + 1}`); });
  }
  if (found.length === 0) console.log("NOT-FOUND-IN-SRC", s);
  for (const loc of found) { const f = loc.split(":")[0]; byFile.set(f, (byFile.get(f) || 0) + 1); }
  console.log(s, "=>", found.join(" , "));
}
console.log("\n== 按文件汇总");
for (const [f, n] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) console.log(n, f);
