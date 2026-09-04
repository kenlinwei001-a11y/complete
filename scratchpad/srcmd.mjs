import fs from "node:fs";
import path from "node:path";
const roots = ["apps/frontend-shell/src", "apps/datacore/src", "apps/agentcore/src", "packages/contracts/src"];
const files = [];
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
  }
}
roots.forEach(walk);
// 剥注释：逐字符状态机（区分字符串/模板/注释）
function stripComments(s) {
  let out = "", i = 0, n = s.length;
  let st = null; // "'", '"', '`', '//', '/*'
  while (i < n) {
    const c = s[i], c2 = s[i + 1];
    if (st === null) {
      if (c === "/" && c2 === "/") { st = "//"; i += 2; continue; }
      if (c === "/" && c2 === "*") { st = "/*"; i += 2; continue; }
      if (c === "'" || c === '"' || c === "`") { st = c; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (st === "//") { if (c === "\n") { st = null; out += "\n"; } i++; continue; }
    if (st === "/*") { if (c === "*" && c2 === "/") { st = null; i += 2; } else i++; continue; }
    // in string
    if (c === "\\") { out += c + (c2 ?? ""); i += 2; continue; }
    out += c;
    if (c === st) st = null;
    i++;
  }
  return out;
}
let total = 0;
const hits = [];
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const stripped = stripComments(src);
  const lines = stripped.split("\n");
  lines.forEach((ln, idx) => {
    const m = ln.match(/\*\*[^*\n]{1,120}\*\*/g);
    if (m) { total += m.length; hits.push(`${f}:${idx + 1}: ${ln.trim().slice(0, 160)}`); }
  });
}
console.log("FILES", files.length, "HITS", total);
hits.forEach((h) => console.log(h));
