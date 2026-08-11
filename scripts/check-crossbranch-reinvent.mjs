#!/usr/bin/env node
/**
 * 门 · 跨分支重复造轮子检测（check-crossbranch-reinvent）
 *
 * ── 来历（铁律 0.6 第 3 级处置：同一个错第 4 次，必须建机制） ──────────────────
 * 形态：**「我用『我没在主线上看到它』当作『它不存在』的证据，而前者不度量后者。」**
 *
 *   ① 2026-08-0x 判「OntologySlice 不是一等实体」→ 实为 slice_specs 表 + SliceSpecRecord
 *      + executeSlice + 4 条种子，全接线。
 *   ② WO-PACK-twin-data D3 单让 dev 给 BOM/Routing/Supplier/Material 建表 → 全都已存在且有数据。
 *   ③ 同包 D1 单让 dev 新造 `Person` 类型 → `Principal` 已有 `kind:"person"`。
 *   ④ 2026-08-09 PRD-UPGRADE-decision-sandbox-v2 初稿自造 `Skill.execution`
 *      → `SkillExecutionSchema` 已在 `claude/handoff-skill-orchestrator-s1` 上设计好、
 *        实现好、带 SEAM 测试（commit 55bf21d1 标题就是「对名裁决 Skill.execution」）。
 *
 * 第 4 次比前三次多一层：**东西在未并分支上，主线 grep 必然 0 命中。**
 * 本仓当前有 12 条 skill 分支、未并实现 4664 行 —— 只搜主线会把它们全判成「不存在」。
 *
 * ── 这道门做什么 ────────────────────────────────────────────────────────────
 * 取本次改动**新增的导出符号**，逐个到**每一条未并的远端分支**上搜。
 * 命中 ⇒ 报「这个符号在分支 X 上已经有了，别重造，去复验并入」。
 *
 * 判据是**祖先关系**（`merge-base --is-ancestor`），不是文件存在性 ——
 * 那个错一天骗到 4 个 dev（铁律 0.6 第 2 条机制）。
 *
 * ── 金丝雀纪律 ──────────────────────────────────────────────────────────────
 * 报「0 命中 / 没有重造」这类**否定结论**前，必须先跑一个已知必中的样例。
 * 金丝雀**与主逻辑共用同一份实现**（`symbolExistsOnBranch`）—— 不许各抄一份，
 * 抄了就是装饰品：改主逻辑时金丝雀拿旧的去测、照样绿。
 *
 * 用法：
 *   node scripts/check-crossbranch-reinvent.mjs              # 比 origin/<canonical>
 *   node scripts/check-crossbranch-reinvent.mjs --base <rev>
 *   node scripts/check-crossbranch-reinvent.mjs --symbol Foo # 直接查一个符号（落笔前用）
 *
 * 退出码：0 = 无重造（且金丝雀已过） · 1 = 检出重造 · 2 = **门自己坏了**
 */

import { execFileSync } from "node:child_process";

const CANONICAL = "claude/inspiring-gates-aqczjg";

/** 金丝雀：已知必中的 (符号, 分支) 对。改动本仓时若这条不再成立，须连同来历一起更新。 */
const CANARY = {
  symbol: "SkillExecutionSchema",
  branch: `origin/claude/handoff-skill-orchestrator-s1`,
  why: "55bf21d1「对名裁决 Skill.execution」——本门存在的第 4 号来历",
};

/** 噪声符号：太通用，搜出来全是误报。命中这些不算重造。 */
const IGNORE = new Set(["default", "index", "types", "schema", "config", "utils", "constants"]);

function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
  } catch (e) {
    if (allowFail) return "";
    throw e;
  }
}

/**
 * 主逻辑 · 单一实现：符号 S 是否出现在分支 B 的源码里。
 * 金丝雀与主检测都走这一个函数 —— 这正是「不许各抄一份正则」那条纪律。
 */
function symbolExistsOnBranch(symbol, branchRef) {
  // ⚠️ pathspec 用**目录**（`packages` / `apps`），不许写 `packages/*/src`：
  //    CLAUDE.md 铁律 0.5 判据 #5 —— pathspec 里的 `*` **不跨 `/`**，`apps/*/src` 恒匹配 0 个文件，
  //    于是每个符号都读作「零命中」，整份清单会得出「全是死代码」这个恰好相反的结论。
  //    本门第一次跑就踩了这个坑，被金丝雀当场抓住（正是它存在的理由）。
  const out = git(["grep", "-l", "-w", "-e", symbol, branchRef, "--", "packages", "apps"], {
    allowFail: true,
  });
  if (!out) return [];
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => l.replace(`${branchRef}:`, ""))
    // 只要源码，排除 dist/ 与测试（测试引用 ≠ 已实现，但它同样证明「别处已有」，故保留 test）
    .filter((f) => !f.includes("/dist/") && (f.includes("/src/") || f.includes("/test/")));
}

/** 取「未并的远端分支」——判据是祖先关系，不是文件存在性。 */
function unmergedRemoteBranches(head) {
  const raw = git(["ls-remote", "--heads", "origin"], { allowFail: true });
  if (!raw) return { branches: [], remoteReachable: false };
  const names = raw
    .split("\n")
    .map((l) => l.split("refs/heads/")[1])
    .filter(Boolean)
    .filter((n) => n !== CANONICAL);

  const out = [];
  for (const n of names) {
    const ref = `origin/${n}`;
    // ref 取不到 = 本地没 fetch 过这条分支，不是「它不存在」——跳过并计数，最后如实报。
    const sha = git(["rev-parse", "--verify", "-q", ref], { allowFail: true });
    if (!sha) continue;
    // 是 head 的祖先 ⇒ 已全并 ⇒ 不是「别处已有」的来源
    let merged = true;
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", ref, head], { stdio: "ignore" });
    } catch {
      merged = false;
    }
    if (!merged) out.push(ref);
  }
  return { branches: out, remoteReachable: true, totalRemote: names.length };
}

/** 本次改动新增的导出符号（只看新增行，不看删除行）。 */
function newlyExportedSymbols(base, head) {
  const diff = git(["diff", "-U0", `${base}...${head}`, "--", "packages/*/src", "apps/*/src"], {
    allowFail: true,
  });
  const syms = new Set();
  const re = /^\+\s*export\s+(?:const|function|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/;
  for (const line of diff.split("\n")) {
    const m = re.exec(line);
    if (m && !IGNORE.has(m[1].toLowerCase())) syms.add(m[1]);
  }
  return [...syms].sort();
}

// ── main ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const argOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};

const head = git(["rev-parse", "HEAD"]);
const { branches, remoteReachable, totalRemote } = unmergedRemoteBranches(head);

// ── 🐤 金丝雀：先证明工具是对的，再允许报任何否定结论 ────────────────────────
const canaryFetched = git(["rev-parse", "--verify", "-q", CANARY.branch], { allowFail: true });
if (!canaryFetched) {
  console.error(
    `⚠️  金丝雀分支 ${CANARY.branch} 本地取不到（未 fetch）。\n` +
      `   本门**不报「无重造」** —— 那会是一个没有自证的否定结论。\n` +
      `   先跑：git fetch origin ${CANARY.branch.replace("origin/", "")}`,
  );
  process.exit(2);
}
const canaryHits = symbolExistsOnBranch(CANARY.symbol, CANARY.branch);
if (canaryHits.length === 0) {
  console.error(
    `✗ **门自己坏了**：金丝雀 ${CANARY.symbol} 在 ${CANARY.branch} 上没命中。\n` +
      `   来历：${CANARY.why}\n` +
      `   ⇒ 报的是「工具坏了」，**不是**「代码干净 / 无重复造轮子」。\n` +
      `   这两句话的区别就是本仓一整天的教训：「我没找到」和「它不存在」是两个不同的命题。`,
  );
  process.exit(2);
}

// ── 单符号查询模式（落笔前用：我要新建 X，别处有没有？）────────────────────────
const oneSymbol = argOf("--symbol");
if (oneSymbol) {
  console.log(`🐤 金丝雀命中：${CANARY.symbol} → ${CANARY.branch}（${canaryHits.length} 个文件）⇒ 工具有效\n`);
  console.log(`查询符号：${oneSymbol}\n扫描范围：${branches.length} 条未并远端分支（远端共 ${totalRemote} 条）\n`);
  let found = 0;
  for (const b of branches) {
    const hits = symbolExistsOnBranch(oneSymbol, b);
    if (hits.length) {
      found += hits.length;
      console.log(`  ❗ ${b}`);
      for (const f of hits) console.log(`       ${f}`);
    }
  }
  if (found === 0) {
    console.log(`  ✅ ${branches.length} 条未并分支上都没有 ${oneSymbol} —— 可以新建。`);
    console.log(`     （此否定结论有金丝雀背书：同一份实现在 ${CANARY.branch} 上确实搜得到 ${CANARY.symbol}）`);
    process.exit(0);
  }
  console.log(`\n⛔ ${oneSymbol} 在别的分支上已经有了 —— **不许新建，改为「复验并入」**。`);
  process.exit(1);
}

// ── 门模式：扫本次改动新增的导出符号 ─────────────────────────────────────────
const base = argOf("--base") ?? `origin/${CANONICAL}`;
const baseSha = git(["rev-parse", "--verify", "-q", base], { allowFail: true });
if (!baseSha) {
  console.error(`✗ **门自己坏了**：基线 ${base} 取不到 ⇒ 无法算「本次新增了什么」。不报「无重造」。`);
  process.exit(2);
}

const symbols = newlyExportedSymbols(baseSha, head);
console.log(`🐤 金丝雀命中：${CANARY.symbol} → ${CANARY.branch}（${canaryHits.length} 个文件）⇒ 工具有效`);
console.log(`基线 ${base} → HEAD：新增导出符号 ${symbols.length} 个`);
console.log(`未并远端分支 ${branches.length} 条（远端共 ${totalRemote} 条）${remoteReachable ? "" : "· ⚠️ 远端不可达"}\n`);

if (symbols.length === 0) {
  console.log("✅ 本次未新增导出符号 —— 无重造风险。");
  process.exit(0);
}

const collisions = [];
for (const s of symbols) {
  for (const b of branches) {
    const hits = symbolExistsOnBranch(s, b);
    if (hits.length) collisions.push({ symbol: s, branch: b, files: hits });
  }
}

if (collisions.length === 0) {
  console.log(`✅ ${symbols.length} 个新符号在 ${branches.length} 条未并分支上均无同名实现。`);
  console.log(`   （此否定结论有金丝雀背书 —— 见上方命中证据）`);
  process.exit(0);
}

console.error(`⛔ 检出 ${collisions.length} 处**可能的重复造轮子**：\n`);
for (const c of collisions) {
  console.error(`  ${c.symbol}  已存在于  ${c.branch}`);
  for (const f of c.files) console.error(`      ${f}`);
}
console.error(
  `\n处置：**不要新写** —— 先 git show 那条分支上的实现，比较设计优劣。\n` +
    `      它更好 ⇒ 撤回自己的设计，改为「复验并入」（本门第 4 号来历就是这么处理的）。\n` +
    `      自己的更好 ⇒ 在 PRD 里写明为什么，并注明将废弃分支上的那一份。\n` +
    `      确属同名不同物 ⇒ 改名，或把该符号加进本脚本的 IGNORE。`,
);
process.exit(1);
