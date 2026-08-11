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
 * 金丝雀**与主逻辑共用同一份实现**（`symbolExistsOnBranch` / `newlyExportedSymbols`）——
 * 不许各抄一份，抄了就是装饰品：改主逻辑时金丝雀拿旧的去测、照样绿。
 *
 * ⚠️ **本门自己犯过这条戒律，代价是整道门空转（2026-08-11 实测·欠账 #189）**：
 * 第一版只给「搜分支」那一半（`symbolExistsOnBranch`）配了金丝雀，
 * 而「算本次新增了什么」那一半（`newlyExportedSymbols`）**赤膊上阵、无金丝雀背书**。
 * 那一半的 pathspec 写的正是 `packages/<星>/src` 与 `apps/<星>/src`（`<星>` = 通配符 `*`；
 * 这里不写字面量是因为它会提前闭合本块注释）—— 就是 `symbolExistsOnBranch` 上方
 * 白纸黑字警告过的那个坑（`*` 不跨 `/` ⇒ 恒匹配 0 个文件）。
 * 后果：**输入恒为空集**，于是「符号 × 分支」的双重循环一次都不进，
 * 门每次都走到「✅ 本次未新增导出符号 —— 无重造风险」这一行，`exit 0`，**从上线起从未真正检查过任何东西**。
 * 实测：基线 `55bf21d1^` → `55bf21d1` 门报「新增导出符号 **0** 个」，真值 **13**
 * （`SkillExecutionSchema` / `GraphScheduler` / `compileExecution` …）。
 * 讽刺的是这 13 个符号里就有本门 4 号来历的主角 `SkillExecutionSchema` ——
 * **这道门连自己诞生的那个案例都抓不到。**
 *
 * 教训（照 CLAUDE.md 铁律 0.6 的句式）：
 *   **「我用『搜分支那一半有金丝雀』当作『这道门有金丝雀』的证据，而前者不度量后者。」**
 * 一道门有几个**独立会坏的环节**，就得有几条金丝雀 —— 给其中一环配了金丝雀，
 * 不等于另一环也被背书。故现补 `CANARY_DIFF`，与主逻辑共用 `newlyExportedSymbols`。
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

/** 金丝雀①（搜分支这一环）：已知必中的 (符号, 分支) 对。改动本仓时若这条不再成立，须连同来历一起更新。 */
const CANARY = {
  symbol: "SkillExecutionSchema",
  branch: `origin/claude/handoff-skill-orchestrator-s1`,
  why: "55bf21d1「对名裁决 Skill.execution」——本门存在的第 4 号来历",
};

/**
 * 金丝雀②（算新增导出这一环）：钉死在**同一个** commit `55bf21d1` 上。
 *
 * 为什么必须跑**真 git**、不能只喂一段手写 diff 文本给正则：
 * #189 那个 bug 根本不在正则里 —— 正则一直是对的，坏的是 `git diff` 的 **pathspec**，
 * 它让 git 什么都不返回。只单测正则会全绿，而门照样恒报 0（本仓 2026-08-08 五连犯的同一形态：
 * 「测了一个看起来相关的东西，它不度量我要度量的那件事」）。
 * 故本金丝雀调用的是**主逻辑那一个函数本身**（`newlyExportedSymbols`），端到端走真 git。
 *
 * 双向判据（单向测不出恒真/恒假的实现）：
 *   正向 `mustInclude` —— 该提交确实新增的导出，必须抽得到；
 *   反向 `mustExclude` —— 仓里存在但**不是该提交新增**的符号，必须抽不到
 *                        （一个「扫整棵树而不是扫 diff」的坏实现会在这里当场露馅）。
 */
// 人手复验命令（两条数字必须不同；相同 ⇒ pathspec 又坏了）：
//   git diff --name-only 55bf21d1^...55bf21d1 -- "apps/*/src" | wc -l   # 坏写法 → 0
//   git diff --name-only 55bf21d1^...55bf21d1 -- apps         | wc -l   # 好写法 → >0
const CANARY_DIFF = {
  base: "55bf21d1^",
  head: "55bf21d1",
  expectCount: 13,
  mustInclude: ["SkillExecutionSchema", "GraphScheduler", "compileExecution"],
  mustExclude: ["batteryLinkTypes"],
  why:
    "同一个提交 55bf21d1（本门 4 号来历）实增 13 个导出；" +
    "pathspec 一旦写成 `apps/*/src` 这里立刻变 0 —— 欠账 #189 就是这么空转的",
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
 * 显式区分「命令失败」与「输出为空」。
 *
 * ⚠️ 为什么单有 `git(..., {allowFail:true})` 不够：它把**报错**也压成 `""`，
 * 而 `""` 在下游一律读作「没有命中 / 没有新增」—— 这正是 CLAUDE.md
 * 「门必须显式捕获退出码」那条戒律的形态（拿一个恒 0/恒空的信号当「干净」的证据）。
 * `git diff` 的失败是真会发生的：`maxBuffer` 溢出（超大 range）、base ref 取不到（浅克隆）。
 * 这些必须报「**工具坏了**」（exit 2），不许悄悄变成「无重造」。
 */
function gitTry(args) {
  try {
    return { ok: true, out: execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }) };
  } catch (e) {
    return { ok: false, out: "", err: e?.message ?? String(e) };
  }
}

/** 源码面：只要源码，排除 dist/ 产物（测试引用 ≠ 已实现，但它同样证明「别处已有」，故保留 test）。 */
const isSourceFile = (f) => !f.includes("/dist/") && (f.includes("/src/") || f.includes("/test/"));

/** git `-w` 的词边界（词字符 = [A-Za-z0-9_]），用于把一次批量 grep 的结果归属回各个符号。 */
const wordRe = (sym) => new RegExp(String.raw`(?<![A-Za-z0-9_])${sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_])`);

/**
 * 主逻辑 · 单一实现：**一批**符号各自出现在分支 B 的哪些源码文件里。
 * 返回 Map<symbol, files[]>。
 *
 * ⚠️ 为什么批量：一次 `git grep` ≈ 0.15s，**与 `-e` 个数基本无关**（实测 1 个 vs 3 个同耗时）。
 *    逐符号调用是 O(符号数 × 分支数) 次进程启动 —— 13 符号 × 313 分支实测 **跑不完 10 分钟**。
 *    批量后是 O(分支数) 次，实测约 50s。
 *    （这个性能坑此前被 #189 掩盖着：pathspec 坏掉 ⇒ 符号恒 0 个 ⇒ 双重循环一次都不进 ⇒ 门「很快」。
 *      门跑得快，是因为它什么都没做。）
 */
function symbolsOnBranch(symbols, branchRef) {
  const res = new Map(symbols.map((s) => [s, []]));
  if (symbols.length === 0) return res;
  // ⚠️ pathspec 用**目录**（`packages` / `apps`），不许写 `packages` + 通配 + `src`：
  //    CLAUDE.md 铁律 0.5 判据 #5 —— pathspec 里的 `*` **不跨 `/`**，`apps/*/src` 恒匹配 0 个文件，
  //    于是每个符号都读作「零命中」，整份清单会得出「全是死代码」这个恰好相反的结论。
  //    本门第一次跑就踩了这个坑，被金丝雀当场抓住（正是它存在的理由）。
  const args = ["grep", "-n", "-I", "-w"];
  for (const s of symbols) args.push("-e", s);
  args.push(branchRef, "--", "packages", "apps");
  const out = git(args, { allowFail: true }); // 无命中时 git grep 退出码 1 ⇒ 这里正常读作空
  if (!out) return res;
  const prefix = `${branchRef}:`;
  for (const line of out.split("\n")) {
    if (!line.startsWith(prefix)) continue;
    const m = /^([^:]+):\d+:([\s\S]*)$/.exec(line.slice(prefix.length));
    if (!m) continue;
    const [, file, content] = m;
    if (!isSourceFile(file)) continue;
    for (const s of symbols) {
      if (wordRe(s).test(content) && !res.get(s).includes(file)) res.get(s).push(file);
    }
  }
  return res;
}

/**
 * 单符号便捷式 —— **薄包装，不另起实现**。
 * 金丝雀①走的就是这一条，因此它与主检测共用同一份 grep 逻辑（「不许各抄一份正则」那条纪律）。
 */
function symbolExistsOnBranch(symbol, branchRef) {
  return symbolsOnBranch([symbol], branchRef).get(symbol) ?? [];
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

/**
 * 本次改动新增的导出符号（只看新增行，不看删除行）。
 *
 * ⚠️⚠️ pathspec 必须是**目录**（`packages` / `apps`），过滤 `src/` 交给下面的 `+++ b/` 逐文件判断。
 *      本函数的第一版写的是 `-- "packages/<星>/src" "apps/<星>/src"`（`<星>` = 通配符 `*`），
 *      与 `symbolExistsOnBranch` 上方警告的坑一模一样：pathspec 里的 `*` **不跨 `/`**
 *      ⇒ 该模式只能匹配名叫 `src` 的**文件**（不存在）⇒ 恒匹配 0 个文件 ⇒ diff 恒空
 *      ⇒ 本门恒报「新增 0 个 · 无重造风险」并 exit 0。
 *      实测差距：同一个 range 报 0，真值 13。复验命令见 CANARY_DIFF 上方注释
 *      （坏写法 → 0 个文件，好写法 → >0 个文件；两条数字相同即 pathspec 又坏了）。
 *
 * `--text`：本仓有 NUL 字节混入文本文件的先例（另见 scripts/check-no-raw-nul.mjs）。
 *      git 会把这种文件判为 binary 而只打印「Binary files differ」⇒ 其中的新增导出**静默消失**。
 *      `--text` 强制按文本出 diff，宁可多看不可少看；误报由 `/src/` + 导出正则两道过滤挡住。
 */
function newlyExportedSymbols(base, head) {
  const r = gitTry(["diff", "-U0", "--text", `${base}...${head}`, "--", "packages", "apps"]);
  if (!r.ok) {
    return { ok: false, symbols: [], files: 0, err: r.err };
  }
  const syms = new Set();
  const re = /^\+\s*export\s+(?:const|function|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/;
  const files = new Set();
  let cur = "";
  for (const line of r.out.split("\n")) {
    const fm = /^\+\+\+ b\/(.+)$/.exec(line);
    if (fm) {
      cur = fm[1];
      continue;
    }
    // 只认源码（`packages/*/src` / `apps/*/src` 的原意），排除 dist 产物
    if (!cur.includes("/src/") || cur.includes("/dist/")) continue;
    const m = re.exec(line);
    if (!m) continue;
    files.add(cur);
    if (!IGNORE.has(m[1].toLowerCase())) syms.add(m[1]);
  }
  return { ok: true, symbols: [...syms].sort(), files: files.size };
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
    `✗ **门自己坏了**：金丝雀① ${CANARY.symbol} 在 ${CANARY.branch} 上没命中。\n` +
      `   来历：${CANARY.why}\n` +
      `   ⇒ 报的是「工具坏了」，**不是**「代码干净 / 无重复造轮子」。\n` +
      `   这两句话的区别就是本仓一整天的教训：「我没找到」和「它不存在」是两个不同的命题。`,
  );
  process.exit(2);
}

// ── 🐤 金丝雀②：「算新增导出」这一环（欠账 #189 就坏在这里，且当时无金丝雀背书）──
//    调的是主逻辑那一个函数本身，端到端走真 git —— 只单测正则测不出 pathspec 坏掉。
const die2 = (lines) => {
  console.error(`✗ **门自己坏了**：金丝雀②「算新增导出」未过 —— 本次**不产出任何结论**。`);
  console.error(`   来历：${CANARY_DIFF.why}`);
  for (const l of lines) console.error(`   ${l}`);
  console.error(
    `   ⇒ 报的是「工具坏了」，**不是**「本次未新增导出符号 / 无重造风险」。\n` +
      `     （铁律 0.6：金丝雀不中只许报「工具坏了」。#189 的整道门就是被这行 exit 0 空转掉的。）`,
  );
  process.exit(2);
};
if (!git(["rev-parse", "--verify", "-q", `${CANARY_DIFF.head}^{commit}`], { allowFail: true })) {
  die2([
    `金丝雀提交 ${CANARY_DIFF.head} 本地取不到（浅克隆？）。`,
    `CI 请为 actions/checkout 设置 fetch-depth: 0；本地先 git fetch origin。`,
  ]);
}
const canaryDiff = newlyExportedSymbols(CANARY_DIFF.base, CANARY_DIFF.head);
if (!canaryDiff.ok) die2([`git diff 本身失败（不是「没有新增」）：${canaryDiff.err}`]);
{
  const got = canaryDiff.symbols;
  const missing = CANARY_DIFF.mustInclude.filter((s) => !got.includes(s));
  const leaked = CANARY_DIFF.mustExclude.filter((s) => got.includes(s));
  const problems = [];
  if (got.length === 0)
    problems.push(
      `抽出 **0** 个导出 —— 这正是 #189 的病征（pathspec 恒匹配 0 个文件 ⇒ 输入恒空集）。`,
    );
  if (missing.length) problems.push(`正向：该提交确实新增却没抽到 → ${missing.join(", ")}`);
  if (leaked.length)
    problems.push(
      `反向：不该出现的符号被抽到了 → ${leaked.join(", ")}（说明扫的是整棵树而不是这段 diff）`,
    );
  if (got.length !== CANARY_DIFF.expectCount)
    problems.push(
      `计数：期望 ${CANARY_DIFF.expectCount} 个，实得 ${got.length} 个 → [${got.join(", ")}]\n` +
        `     （若确认是 canonical 历史变了而非工具坏了，改 CANARY_DIFF.expectCount 并在此写明为什么）`,
    );
  if (problems.length) die2(problems);
}
const CANARY2_EVIDENCE =
  `🐤 金丝雀②命中：${CANARY_DIFF.base}→${CANARY_DIFF.head} 抽出 ${canaryDiff.symbols.length} 个新增导出` +
  `（含 ${CANARY_DIFF.mustInclude.join(" / ")}；${CANARY_DIFF.mustExclude.join(" / ")} 正确地未出现）⇒ 抽取器有效`;

// ── 单符号查询模式（落笔前用：我要新建 X，别处有没有？）────────────────────────
const oneSymbol = argOf("--symbol");
if (oneSymbol) {
  console.log(`🐤 金丝雀①命中：${CANARY.symbol} → ${CANARY.branch}（${canaryHits.length} 个文件）⇒ 工具有效`);
  console.log(`${CANARY2_EVIDENCE}\n`);
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

const scan = newlyExportedSymbols(baseSha, head);
if (!scan.ok) {
  console.error(
    `✗ **门自己坏了**：git diff ${base}...HEAD 执行失败（不是「没有新增」）：${scan.err}\n` +
      `   ⇒ 不报「无重造」。`,
  );
  process.exit(2);
}
const symbols = scan.symbols;
console.log(`🐤 金丝雀①命中：${CANARY.symbol} → ${CANARY.branch}（${canaryHits.length} 个文件）⇒ 工具有效`);
console.log(CANARY2_EVIDENCE);
console.log(`基线 ${base} → HEAD：新增导出符号 ${symbols.length} 个（来自 ${scan.files} 个 src 文件）`);
console.log(`未并远端分支 ${branches.length} 条（远端共 ${totalRemote} 条）${remoteReachable ? "" : "· ⚠️ 远端不可达"}\n`);

if (symbols.length === 0) {
  console.log("✅ 本次未新增导出符号 —— 无重造风险。");
  console.log(`   （此否定结论有金丝雀②背书：同一份实现在 ${CANARY_DIFF.base}→${CANARY_DIFF.head} 上确实抽得出 ${canaryDiff.symbols.length} 个）`);
  process.exit(0);
}

const collisions = [];
for (const b of branches) {
  // 一条分支一次 grep（批量），不是「每个符号一次」——见 symbolsOnBranch 顶注的性能账。
  for (const [s, hits] of symbolsOnBranch(symbols, b)) {
    if (hits.length) collisions.push({ symbol: s, branch: b, files: hits });
  }
}
collisions.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.branch.localeCompare(b.branch));

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
