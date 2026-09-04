import fs from "node:fs";
import path from "node:path";
/**
 * WO-SCREEN-CALIBER ② · 剥掉**会上屏**的 Markdown 星号。
 * 判据（两条都必须成立，缺一条就不动）：
 *   ① 这个串**实测在真浏览器上屏了**（/tmp/scb/out3/hits.json，六个页面的 innerText / title 属性）；
 *   ② 这一处出现在**字符串字面量**里（剥注释后仍在），不是给读代码的人看的注释。
 * 排除：`markdown:` 字段（那一路真有 Markdown 渲染器）。
 */
const hits = JSON.parse(fs.readFileSync("/tmp/scb/out3/hits.json", "utf8"));
const strs = [...new Set(hits.flatMap((h) => [...h.innerText, ...h.title]))];
const roots = ["apps/frontend-shell/src", "apps/datacore/src", "apps/agentcore/src", "packages/contracts/src"];
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name)) files.push(p); } };
roots.forEach(walk);

// 逐字符状态机：返回每一行「本行是否含代码（非注释）区域」的映射 —— 用 stripped 行做判据
function stripComments(s) {
  let out = "", i = 0; const n = s.length; let st = null;
  while (i < n) {
    const c = s[i], c2 = s[i + 1];
    if (st === null) {
      if (c === "/" && c2 === "/") { st = "//"; i += 2; continue; }
      if (c === "/" && c2 === "*") { st = "/*"; i += 2; continue; }
      if (c === "'" || c === '"' || c === "`") { st = c; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (st === "//") { if (c === "\n") { st = null; out += "\n"; } else out += " "; i++; continue; }
    if (st === "/*") { if (c === "*" && c2 === "/") { st = null; out += "  "; i += 2; } else { out += c === "\n" ? "\n" : " "; i++; } continue; }
    if (c === "\\") { out += c + (c2 ?? ""); i += 2; continue; }
    out += c; if (c === st) st = null; i++;
  }
  return out;
}
const apply = process.argv.includes("--apply");
let changed = 0, touchedFiles = 0;
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const codeLines = stripComments(src).split("\n");
  const lines = src.split("\n");
  let dirty = false;
  for (let i = 0; i < lines.length; i++) {
    const code = codeLines[i] ?? "";
    if (/markdown\s*:/.test(code)) continue;
    let ln = lines[i];
    for (const s of strs) {
      if (!code.includes(s)) continue; // 只改「代码区」里的那一处
      const bare = s.slice(2, -2);
      if (ln.includes(s)) { ln = ln.split(s).join(bare); changed++; dirty = true; console.log(`${f}:${i + 1}  ${s} -> ${bare}`); }
    }
    lines[i] = ln;
  }
  if (dirty) { touchedFiles++; if (apply) fs.writeFileSync(f, lines.join("\n")); }
}
console.log(`\n${apply ? "APPLIED" : "DRY-RUN"}: ${changed} 处 / ${touchedFiles} 个文件`);
