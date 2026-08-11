#!/usr/bin/env node
/**
 * DF.1 门禁 `boundary-singlesource:check`：业务实例册单一来源不回潮守门（G-5 / R14 / R6）。
 * 断言三消费端（datacore battery.ts BASES · 前端 fixtures.ts BASES · simSolvers.ts MOCK_BASES）
 * 均从 @platform/contracts BASE_REGISTRY **派生**（含 `BASE_REGISTRY.map`），
 * 且不再内联基地字面量（防"改一处崩前后端不同步"漂移复发）。
 * 另守 DF.3 SEG_REGISTRY 四消费端 / DF.4 PLAN_GOAL_TARGETS 三消费端引用不内联。
 *
 * WO-76 修（此门此前**自身是红的且零接线**——本体 §7 谎称"已并入 pnpm gates"，实则 package.json
 * 里既无 `boundary-singlesource:check` 脚本、gates 串里也没有它；红了 24 个 commit 无人知）。本次三处**收紧**：
 *  ① 容忍度 5 → 0：旧启发是"baseId 字面量 ≥6 即红"（认为只有整集回潮才算漂移），
 *     于是 `a1fbc950` 把风险卡从 1 处灌到 7 处才刚好触红，而 1~5 处的**单条**内联长期免疫——
 *     可单条内联同样是 G-5/R14 漂移（册里改 id/删基地 → 引用静默悬空）。门自己的注释本就写着
 *     "registry 里只 1 处定义，**消费端 0**"，本次让实现追上该口径。消费端现已真修到 0（非放宽阈值凑绿）。
 *  ② 只扫**代码**：先剥注释再匹配，说明性注释里出现的示例字面量不再误报（本门自身注释即含示例）。
 *  ③ 判据自册派生：只对**确实是 BASE_REGISTRY 成员**的 baseId 报红（oracle 从单一来源册解析，
 *     改册即自动跟随），并逐条打印 `file:line` 便于定位。
 * 作用域刻意限定为 `baseId: "…"` **字段赋值**：`MODEL_BASE_MAP` 那类 `["changzhou", …]` 拓扑数组
 * 是"哪个型号能在哪产"的真信息、非册的重复定义，不在本门射程内（扩进去只会逼出 allowlist 让门腐坏）。
 */
/* ── 退出码纪律 · 顶层兜底（WO-GATE-RC2-DISCIPLINE）─────────────────────────────
 * 本仓门的退出码是**三分**约定（docs/SOP-reviewer-claim-discipline.md §3）：
 *   0 = 干净 · 1 = **真有问题**（先修代码）· 2 = **工具自己坏了**（只许说「我没查出来」）。
 * 而 node 对**未捕获异常一律退 1** —— 恰好撞上「真有问题」这个码。于是「门根本没跑起来」
 * （缺依赖 / 只读 FS / 权限 / OOM / node 版本差异 / dist 没构建）会被 gate.sh 和人一起
 * 读成「你的代码有问题」，方向**正好相反**。2026-08-11 一天之内两道门各撞一次，故建此机制。
 * 形态（铁律 0.6 句式）：「我用『进程非 0 退出』当作『代码有问题』的证据，而前者并不度量后者。」
 *
 * 这段只**加**默认失败方向，**不动**任何既有 exit(0)/exit(1)：兜底若把真违规也吞成 2，
 * 那是拿一个更糟的假绿换掉一个假红。RC=1 仍然只由主判据明确判负产生。
 * 守门的门：scripts/check-gate-exit-discipline.mjs（新加的门不带兜底会被它当场判红）。 */
process.on("uncaughtException", (e) => gateToolBroken(e));
process.on("unhandledRejection", (e) => gateToolBroken(e));
function gateToolBroken(e) {
  console.error(`⛔ check-boundary-singlesource.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import { readFileSync } from "node:fs";

const CONSUMERS = [
  { file: "apps/datacore/src/synthetic/battery.ts", binding: "BASES" },
  { file: "apps/frontend-shell/src/mocks/fixtures.ts", binding: "BASES" },
  { file: "apps/frontend-shell/src/mocks/simSolvers.ts", binding: "MOCK_BASES" },
];
// DF.3 SEG 单一来源消费端：均须引用 SEG_REGISTRY（防 SEG 价/利/色内联回潮）。
const SEG_CONSUMERS = [
  "apps/datacore/src/synthetic/battery.ts",
  "apps/datacore/src/solvers/risk.ts",
  "apps/frontend-shell/src/views/plan/OrderChainView.tsx",
  "apps/frontend-shell/src/mocks/simSolvers.ts",
];
// DF.4 规划目标阈值单一来源消费端：均须引用 PLAN_GOAL_TARGETS（防三处目标阈值漂移回潮）。
const PLAN_GOAL_CONSUMERS = [
  "apps/datacore/src/synthetic/battery.ts",
  "apps/frontend-shell/src/views/sim/PlanGenerateView.tsx",
  "apps/frontend-shell/src/mocks/fixtures.ts",
];
const REGISTRY_FILE = "packages/contracts/src/base-registry.ts";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

/**
 * 剥掉行注释与块注释两种形式，**保留换行**（行号不偏移，报错仍能给准 file:line）。
 * 逐字符扫描并跟踪字符串/模板字面量状态，避免把 "http://…" 里的斜杠误当注释起点。
 */
function stripComments(src) {
  let out = "";
  let i = 0;
  let quote = null; // 当前所处字符串定界符
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (quote) {
      if (c === "\\") { out += c + (next ?? ""); i += 2; continue; }
      if (c === quote) quote = null;
      out += c; i++; continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; i++; continue; }
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue; // 换行本身留给下一轮
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") out += "\n"; // 保行号
        i++;
      }
      i += 2;
      continue;
    }
    out += c; i++;
  }
  return out;
}

/** 从单一来源册解析 baseId 全集（oracle 自册派生：改册自动跟随，不在门里写死基地名）。 */
function registryBaseIds() {
  const src = stripComments(read(REGISTRY_FILE));
  const ids = [...src.matchAll(/baseId:\s*"([a-z]+)"/g)].map((m) => m[1]);
  return new Set(ids);
}

/**
 * 断言**该绑定本身**由 `BASE_REGISTRY.map(` 初始化（WO-76 变异反证 M3 揪出的旧洞）：
 * 旧实现只问"文件里**任意位置**是否出现 `BASE_REGISTRY.map(` token"——而 simSolvers.ts 有 3 处
 * （MOCK_BASES + 两张 portBaseId/Name 映射表），故把 MOCK_BASES 改成 `[].map(` 打断派生后，
 * 另两处仍让 token 存在 → 门照绿。典型"文件级 token 存在性冒充绑定级派生"的假绿。
 * 现改为：定位 `const <绑定>` 声明 → 跳过类型标注（可跨行、含 {} []）找到顶层 `=` → 校验
 * 初始化表达式确实以 `BASE_REGISTRY.map(` 起头。
 */
function bindingDerivesFromRegistry(src, binding) {
  const code = stripComments(src);
  const lineOf = (idx) => code.slice(0, idx).split("\n").length; // 剥注释保行号，与原文件一致
  let declLine = 0;
  for (const m of code.matchAll(new RegExp(`\\bconst\\s+${binding}\\b`, "g"))) {
    declLine = declLine || lineOf(m.index);
    let i = m.index + m[0].length;
    let depth = 0;
    let eq = -1;
    while (i < code.length) {
      const c = code[i];
      if (c === "{" || c === "[" || c === "(") depth++;
      else if (c === "}" || c === "]" || c === ")") depth--;
      else if (c === ";" && depth <= 0) break; // 声明结束却无赋值
      else if (c === "=" && depth <= 0 && code[i + 1] !== "=" && !"=!<>".includes(code[i - 1])) { eq = i; break; }
      i++;
    }
    if (eq >= 0 && code.slice(eq + 1).trimStart().startsWith("BASE_REGISTRY.map(")) return { ok: true, line: lineOf(m.index) };
  }
  return { ok: false, line: declLine };
}

/** 逐行找出内联的册内 baseId 字面量，返回 {line, id, text}[]。 */
function inlineBaseIdHits(src, baseIds) {
  const hits = [];
  stripComments(src).split("\n").forEach((line, idx) => {
    for (const m of line.matchAll(/baseId:\s*"([a-z]+)"/g)) {
      if (baseIds.has(m[1])) hits.push({ line: idx + 1, id: m[1], text: line.trim() });
    }
  });
  return hits;
}

let red = false;
const BASE_IDS = registryBaseIds();
if (BASE_IDS.size === 0) {
  console.error(`✗ 读不到 ${REGISTRY_FILE} 里的 BASE_REGISTRY baseId 全集（单一来源册结构变了？门失去判据）`);
  process.exit(1);
}

for (const { file, binding } of CONSUMERS) {
  let src;
  try {
    src = read(file);
  } catch {
    console.error(`✗ 读不到 ${file}`);
    red = true;
    continue;
  }
  const code = stripComments(src);
  const importsRegistry = /BASE_REGISTRY/.test(code) && /from "@platform\/contracts"/.test(code);
  if (!importsRegistry) {
    console.error(`✗ ${file}：未从 @platform/contracts 导入 BASE_REGISTRY`);
    red = true;
  } else {
    // 绑定级（非文件级 token 存在性）：该绑定的初始化表达式须就是 BASE_REGISTRY.map(...)。
    const d = bindingDerivesFromRegistry(src, binding);
    if (!d.ok) {
      const at = d.line ? `${file}:${d.line}` : `${file}（未见 const ${binding} 声明）`;
      console.error(`✗ ${at}：绑定 ${binding} 未由 BASE_REGISTRY.map(...) 初始化（派生被打断）`);
      red = true;
    }
  }
  // 零容忍：消费端不得内联任何册内 baseId 字面量（单条也算漂移；改册即静默悬空）。
  for (const h of inlineBaseIdHits(src, BASE_IDS)) {
    console.error(`✗ ${file}:${h.line}：内联基地字面量 baseId: "${h.id}"（应从 BASE_REGISTRY 查册派生）`);
    console.error(`    ${h.text}`);
    red = true;
  }
}

for (const file of SEG_CONSUMERS) {
  let src;
  try {
    src = read(file);
  } catch {
    console.error(`✗ 读不到 ${file}`);
    red = true;
    continue;
  }
  // 扫剥注释后的代码：注释里提一句 SEG_REGISTRY 不算数（否则删掉真派生、留个注释即可骗绿）。
  if (!/SEG_REGISTRY/.test(stripComments(src))) {
    console.error(`✗ ${file}：SEG 价/利/色未从 SEG_REGISTRY 派生（疑内联回潮）`);
    red = true;
  }
}

for (const file of PLAN_GOAL_CONSUMERS) {
  let src;
  try {
    src = read(file);
  } catch {
    console.error(`✗ 读不到 ${file}`);
    red = true;
    continue;
  }
  // 同上：只认代码里的真引用，注释不算数。
  if (!/PLAN_GOAL_TARGETS/.test(stripComments(src))) {
    console.error(`✗ ${file}：规划目标阈值未从 PLAN_GOAL_TARGETS 派生（疑内联回潮）`);
    red = true;
  }
}

if (red) {
  console.error("\n✗ boundary-singlesource:check 未通过：基地集/应用细分/规划目标阈值须单一来源（@platform/contracts BASE_REGISTRY/SEG_REGISTRY/PLAN_GOAL_TARGETS），不得内联。");
  process.exit(1);
}
console.log(`✓ boundary-singlesource:check：BASE_REGISTRY(${BASE_IDS.size} 基地) + SEG_REGISTRY + PLAN_GOAL_TARGETS 单一来源，${CONSUMERS.length} BASE / ${SEG_CONSUMERS.length} SEG / ${PLAN_GOAL_CONSUMERS.length} PLAN_GOAL 消费端均派生、内联基地字面量 0（零容忍）。`);
