#!/usr/bin/env node
// Diagnostic: classify every SMELL line in scan globs under OLD vs NEW LEGIT regex.
import { readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { execSync } from "node:child_process";

const ROOT = "/home/user/complete/.claude/worktrees/agent-a7d85f004db7063b1";
const SCAN_GLOBS = ["apps/datacore/src/solvers", "apps/frontend-shell/src/views"];
const SMELL_RE = /\b\w*[Hh]ash\w*\s*\(/;
const COMMENT_RE = /^\s*(\/\/|\*|\/\*)/;
const OLD_LEGIT = /(_?id\b|Id\b|version|rsv_|bucket|splitPct|`e\$\{|toString\(\s*36\s*\)|toString\(\s*16\s*\)|createHash\s*\(|\.digest\s*\()/;
const NEW_LEGIT = /(\b(?:const|let|var)\s+\w*[Ii]d\b|\w*[Ii]d\s*[=:]|version|rsv_|bucket|splitPct|`e\$\{|toString\(\s*36\s*\)|toString\(\s*16\s*\)|createHash\s*\(|\.digest\s*\()/;

function listFiles() {
  const out = [];
  for (const g of SCAN_GLOBS) {
    const abs = join(ROOT, g);
    if (!existsSync(abs)) continue;
    const found = execSync(
      `find ${abs} -type f \\( -name '*.ts' -o -name '*.tsx' \\) -not -name '*.test.*' -not -name '*.spec.*'`,
      { encoding: "utf8" },
    ).trim().split("\n").filter(Boolean);
    out.push(...found);
  }
  return out.sort();
}

let total = 0, comment = 0, oldLegit = 0, newLegit = 0;
const regressions = []; // was legit under OLD, now NOT legit under NEW (and not a comment)
const allSmell = [];
for (const file of listFiles()) {
  const rel = relative(ROOT, file);
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (!SMELL_RE.test(line)) return;
    total++;
    const loc = `${rel}:${i + 1}`;
    const isComment = COMMENT_RE.test(line);
    const oL = OLD_LEGIT.test(line);
    const nL = NEW_LEGIT.test(line);
    if (isComment) comment++;
    if (oL) oldLegit++;
    if (nL) newLegit++;
    allSmell.push({ loc, isComment, oL, nL, snippet: line.trim().slice(0, 110) });
    // Regression = a line that becomes NEWLY flagged: previously passed (comment or old-legit), now neither comment nor new-legit
    const passedBefore = isComment || oL;
    const passesNow = isComment || nL;
    if (passedBefore && !passesNow) regressions.push({ loc, snippet: line.trim().slice(0, 110), oL, nL });
  });
}

console.log(`Total SMELL lines: ${total}`);
console.log(`  comment-exempt: ${comment}`);
console.log(`  OLD-LEGIT match: ${oldLegit}`);
console.log(`  NEW-LEGIT match: ${newLegit}`);
console.log("\n--- ALL SMELL LINES ---");
for (const s of allSmell) {
  console.log(`${s.loc}\n   comment=${s.isComment} oldLegit=${s.oL} newLegit=${s.nL}\n   ${s.snippet}`);
}
console.log("\n--- REGRESSIONS (passed before, newly flagged now) ---");
if (regressions.length === 0) console.log("  NONE");
for (const r of regressions) console.log(`  ${r.loc}  oldLegit=${r.oL} newLegit=${r.nL}\n     ${r.snippet}`);
