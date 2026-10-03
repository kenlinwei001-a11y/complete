#!/usr/bin/env node
/**
 * gate-census.mjs · 门禁普查器（门账的机械来源，供门与人共用）
 *
 * 为什么要有它：本仓 39 个 `scripts/check-*.mjs` 里只有一部分真跑，其余在制度上宣称存在、
 * 实际不执行（假绿第 5 形态 G-DEAD-GATE-BY-POLICY）。人肉 grep 判不准——`gate.sh` 里有的门
 * 是用 npm alias 调的，只匹配文件名会漏；`不并入 pnpm gates` 这类否定句会被朴素正则误判成宣称。
 * 故普查必须机械化并可被门现算复用（`check-gate-ledger.mjs` 判据③ 现算，不读缓存）。
 *
 * 输出（stdout JSON，供门消费；--human 输出人读表）：
 *   { scripts: { "<file>": { alias, binding, callers } }, claims: { "<file>": {...} }, counts: {...} }
 *
 * binding 六分类（与 PRD-gate-ledger §4.1 一致）：
 *   GATES_CHAIN  进 package.json 的 `gates` 串 —— 每次 gate/CI 真跑
 *   GATE_SH      未进 gates 串，但被 scripts/gate.sh 直调（文件名或 npm alias）
 *   CI_ONLY      上两者皆非，但被 .github/workflows/*.yml 直调
 *   MANUAL       无自动路径，但有 package.json 别名（人可手动跑）
 *   NONE         零调用方：无自动路径、无别名
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const ROOT = process.cwd();
const SCRIPTS_DIR = join(ROOT, "scripts");
const ONTOLOGY = join(ROOT, "docs", "SYSTEM-ONTOLOGY.md");

const rd = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const RE_CHECK = /check-[a-z0-9-]+\.mjs/g;
const refsIn = (text) => new Set((text || "").match(RE_CHECK) || []);

/** 所有门脚本（真值 = 文件系统，不是任何清单） */
export function listGateScripts() {
  return readdirSync(SCRIPTS_DIR)
    .filter((f) => /^check-[a-z0-9-]+\.mjs$/.test(f))
    .sort();
}

/**
 * package.json 的 npm 别名反查：<脚本文件> -> [别名…]
 * 注意 `gates` 本身也是别名，需排除，否则每个进链的门都会被算成"有别名"。
 */
function aliasMap(pkg) {
  const out = {};
  for (const [name, body] of Object.entries(pkg.scripts || {})) {
    if (name === "gates") continue;
    for (const f of refsIn(body)) (out[f] ||= []).push(name);
  }
  return out;
}

/** 某文本里是否经 npm 别名调用了该门（`pnpm x:check` / `npm run x`） */
function calledByAlias(text, aliases) {
  return (aliases || []).some((a) =>
    new RegExp(String.raw`(pnpm|npm)\s+(run\s+)?${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\s|$|"|')`).test(text),
  );
}

export function census() {
  const pkg = JSON.parse(rd(join(ROOT, "package.json")) || "{}");
  const gatesSrc = pkg.scripts?.gates || "";
  const gateSh = rd(join(SCRIPTS_DIR, "gate.sh"));
  const ciDir = join(ROOT, ".github", "workflows");
  const ci = existsSync(ciDir)
    ? readdirSync(ciDir).map((f) => rd(join(ciDir, f))).join("\n")
    : "";

  const inChain = refsIn(gatesSrc);
  const alias = aliasMap(pkg);

  // 其它脚本（非 check-* 自身）对门的引用 —— 用于 callers 溯源，不作为 binding 依据
  const otherRefs = {};
  for (const f of readdirSync(SCRIPTS_DIR)) {
    if (!/\.(mjs|js|sh|cjs)$/.test(f)) continue;
    const t = rd(join(SCRIPTS_DIR, f));
    for (const g of refsIn(t)) if (g !== f) (otherRefs[g] ||= []).push(`scripts/${f}`);
  }

  const scripts = {};
  for (const f of listGateScripts()) {
    const a = alias[f] || [];
    const inGateSh = refsIn(gateSh).has(f) || calledByAlias(gateSh, a);
    const inCi = refsIn(ci).has(f) || calledByAlias(ci, a);

    let binding;
    if (inChain.has(f)) binding = "GATES_CHAIN";
    else if (inGateSh) binding = "GATE_SH";
    else if (inCi) binding = "CI_ONLY";
    else if (a.length) binding = "MANUAL";
    else binding = "NONE";

    const callers = [];
    if (inChain.has(f)) callers.push("package.json:gates");
    if (inGateSh) callers.push("scripts/gate.sh");
    if (inCi) callers.push(".github/workflows");
    for (const c of otherRefs[f] || []) callers.push(c);

    scripts[f] = { alias: a.length ? a[0] : null, aliases: a, binding, callers };
  }

  return { scripts, claims: ontologyClaims(scripts), counts: tally(scripts) };
}

function tally(scripts) {
  const c = { GATES_CHAIN: 0, GATE_SH: 0, CI_ONLY: 0, MANUAL: 0, NONE: 0, total: 0 };
  for (const v of Object.values(scripts)) { c[v.binding]++; c.total++; }
  return c;
}

/**
 * 本体 §7 的接线宣称抽取。
 *
 * 三条纪律（都是踩过的坑）：
 *  ① 必须先排否定句：`不并入 pnpm gates` 是**正确**的声明（如 handoff-ledger 是独立 CI job），
 *     朴素 /并入 pnpm gates/ 会把它误报成撒谎。
 *  ② 一行里可能出现多次「并入 pnpm gates」，其中一次是**在描述该门自己断言什么**
 *     （writeback 那条：「静态断言每个并入 pnpm gates 的门…」），不是在声明自身归属。
 *     故只认与"脚本路径/别名"同句出现的那次。
 *  ③ 宣称与现实的差异分两类，修法完全不同 —— 见 verdict。
 */
export function ontologyClaims(scripts) {
  const lines = rd(ONTOLOGY).split("\n");
  const out = {};
  for (const f of Object.keys(scripts)) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes(f)) continue;

      // 本行即该门在 §7 的条目，行内的「并入 pnpm gates」默认就是它对自己的声明。
      // 但要剔掉两类**不是自我声明**的句子（都踩过）：
      //  · 否定句：`不并入 pnpm gates`（handoff-ledger 是独立 CI job，这么写是对的）
      //  · 全称描述：`静态断言每个并入 pnpm gates 的门…`（writeback 在描述自己断言什么，不是在说自己归属）
      const claimsIn = [];
      for (const sent of line.split(/[。；]/)) {
        if (!/并入\s*`?pnpm gates`?/.test(sent)) continue;
        const negated = /不并入|非\s*`?pnpm gates`?\s*内|聚合外/.test(sent);
        const descriptive = /(每个|每一个|凡|所有)并入/.test(sent);
        if (descriptive && !negated) continue;
        claimsIn.push({ sent: sent.trim(), negated });
      }
      const positive = claimsIn.find((c) => !c.negated);
      const negative = claimsIn.find((c) => c.negated);

      const claimed = positive ? "IN_GATES" : negative ? "NOT_IN_GATES" : "NONE";
      const actual = scripts[f].binding;

      let verdict = "OK";
      if (claimed === "IN_GATES" && actual === "NONE") verdict = "LIE_DEAD";       // 宣称已接线，实际零调用 —— 最重
      else if (claimed === "IN_GATES" && actual !== "GATES_CHAIN") verdict = "LIE_BINDING"; // 接着线，但接的不是它说的那条
      out[f] = {
        ontologyLine: i + 1,
        claimed,
        actual,
        verdict,
        evidence: (positive || negative)?.sent?.slice(0, 160) || null,
      };
      break;
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = census();
  if (process.argv.includes("--human")) {
    console.log("门脚本总数:", r.counts.total);
    for (const k of ["GATES_CHAIN", "GATE_SH", "CI_ONLY", "MANUAL", "NONE"]) console.log(`  ${k}: ${r.counts[k]}`);
    const lies = Object.entries(r.claims).filter(([, v]) => v.verdict !== "OK");
    console.log(`\n本体宣称与现实不符: ${lies.length} 条`);
    for (const [f, v] of lies) console.log(`  [${v.verdict}] ${f}  §行${v.ontologyLine}  宣称=${v.claimed} 实际=${v.actual}`);
  } else {
    console.log(JSON.stringify(r, null, 2));
  }
}
