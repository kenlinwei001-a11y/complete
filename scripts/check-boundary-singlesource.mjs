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
 *
 * ══ WO-GATE-ROSTER-SWEEP 修（2026-08-16）· 扫描面从**手抄 3 个文件**改成**全仓现算** ══════
 *
 * **病**（本体 §8 `G-GATE-ROSTER-HANDCOPIED` 的教科书级现场，实测不是推想）：
 * 上面 WO-76 那三条收紧全都收在**判据**上（阈值 5→0、剥注释、oracle 自册派生），
 * 唯独**受检对象集合**一直是手抄的 `CONSUMERS` 那 3 个文件 —— 内联回潮扫描**只问它们**。
 * 而那 3 个文件恰恰是当年**修干净了**的那 3 个（现算实测：3 个里内联命中 **0**）。
 * 于是这道门每天都在报「内联基地字面量 0（零容忍）」，而全仓真实情况是：
 *
 * | 文件 | 内联册内 baseId | 在旧名单里吗 |
 * |---|---|---|
 * | `apps/datacore/src/connectors/registry.ts`      | 4 处 | ❌ 从未被问过 |
 * | `apps/datacore/src/livedin/engine.ts`           | 10 处 | ❌ 从未被问过 |
 * | `apps/frontend-shell/src/mocks/livedInFixtures.ts` | 7 处 | ❌ 从未被问过 |
 * | `apps/frontend-shell/src/mocks/handlers.ts`     | 2 处 | ❌ 从未被问过 |
 * | `apps/frontend-shell/src/mocks/planFixtures.ts` | 1 处 | ❌ 从未被问过 |
 *
 * **形态**（CLAUDE.md 铁律 0.6 句式）：
 *   **「我用『名单里那 3 个都干净』当作『全仓都干净』的证据，而前者并不度量后者。」**
 * 更毒的是这个名单**自带幸存者偏差**：它当初就是照「已知有问题的那几个」抄的，
 * 修好之后名单不变 ⇒ 门**永远绿**，且绿得理直气壮（打印的数字是真的，只是它不指向全仓）。
 *
 * **修法**（照 `scripts/lib/sim-page-roster.mjs` 立的样子）：
 *   ① 内联回潮的扫描面 = `SCAN_ROOTS` 下**全部** `.ts/.tsx` **现算**（单一来源册本身除外——
 *      那里的字面量就是定义本身）；名单**不再**决定谁被扫。
 *   ② `CONSUMERS`/`SEG_CONSUMERS`/`PLAN_GOAL_CONSUMERS` 三张表**降级为正向断言名册**：
 *      它们答的是「**这几个绑定必须由册派生**」（判据，会随架构变但不随内容变），
 *      **不再**兼任「该扫谁」。两个职责合在一张表上，正是上面那个病的成因。
 *   ③ 存量 24 处进**棘轮基线** `scripts/boundary-singlesource-baseline.json`，逐条带 `why`，
 *      **只降不升**：修好一处就跑 `--tighten` 收回额度；新增一处当场红。
 *   ④ **死账断言**：名册里的文件若已不再引用对应 registry token ⇒ 红
 *      （名册只减不增会烂成"历史遗迹"，这条逼它跟着现实走）。
 *   ⑤ **扫描面下界自证**：扫到的文件数低于下界 ⇒ 报 **RC=2「工具坏了」**，
 *      **不许**报「内联 0」—— 集合变空则差集恒空、门恒绿，那是失败的危险方向。
 *
 * 用法：
 *   node scripts/check-boundary-singlesource.mjs            # 门（0 干净 / 1 有违规 / 2 工具坏了）
 *   node scripts/check-boundary-singlesource.mjs --census    # 现算全表：谁内联了、名册与现实差在哪
 *   node scripts/check-boundary-singlesource.mjs --selftest  # 只跑金丝雀（双向）
 *   node scripts/check-boundary-singlesource.mjs --seed      # 首次建棘轮基线
 *   node scripts/check-boundary-singlesource.mjs --tighten   # 收紧基线（只许降）
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


import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBaselineDoc, baselineDocCanary } from "./lib/baseline-doc.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = join(ROOT, "scripts/boundary-singlesource-baseline.json");

/**
 * **正向断言名册**（判据，非扫描面）：这几个绑定必须由册 `.map(...)` 派生。
 * ⚠ 它**不再**决定"扫谁"——扫描面见 `SCAN_ROOTS` 现算。两个职责合在一张表上正是本门的旧病。
 */
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

/**
 * **扫描面（现算的唯一输入）** —— 生产 + mock 源码根。`test/` 有意排除：
 * 测试里为构造断言写死一个 baseId 是**判据本体**，不是"册的重复定义"。
 * 这张表本身是**判据**（"哪些目录算生产源码"），随包结构变而非随内容变。
 */
const SCAN_ROOTS = [
  "apps/datacore/src",
  "apps/agentcore/src",
  "apps/frontend-shell/src",
  "packages/contracts/src",
  "packages/llm-adapters/src",
];
/**
 * 扫描面规模**下界**（金丝雀 · 失败的危险方向在这里）：
 * 枚举器一旦坏掉（目录改名 / 过滤写反）集合就变空 ⇒ 内联命中恒 0 ⇒ 门**恒绿**且一声不吭。
 * 实测 2026-08-16 为 602 个 `.ts/.tsx`；掉到 400 以下判「工具坏了」（RC=2），不判「代码干净」。
 */
const MIN_SCAN_FILES = 400;

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

/** 递归枚举扫描面（现算，不读任何名单）。 */
function scanFiles(roots = SCAN_ROOTS) {
  const out = [];
  const walk = (abs) => {
    if (!existsSync(abs)) return;
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "dist" || e.name === "build") continue;
      const p = join(abs, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(relative(ROOT, p).split("\\").join("/"));
    }
  };
  for (const r of roots) walk(join(ROOT, r));
  return out.sort();
}

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

/**
 * **双向金丝雀** —— 直接跑上面那几个解析器**本体**，不另抄一份正则
 * （抄一份就是装饰品：改主正则时金丝雀拿旧的去测、照样绿。本仓 2026-08-08 实测过）。
 *
 * 必中侧钉住「真内联要被抓到」；必不中侧钉住「注释里的示例 / 册外 id 不许误报」——
 * 只做必中侧的金丝雀证明不了工具没在乱咬，而乱咬的门会被人为放宽，最后一起烂掉。
 */
function boundaryCanary() {
  const ids = new Set(["changzhou", "hefei"]);
  const MUST_BITE = `const X = [{ baseId: "changzhou", n: 1 }, { baseId: "hefei", n: 2 }];`;
  const MUST_NOT_COMMENT = `// const X = [{ baseId: "changzhou" }];\n/* baseId: "hefei" */\nconst Y = 1;`;
  const MUST_NOT_FOREIGN = `const X = [{ baseId: "atlantis", n: 1 }];`; // 册外 id ⇒ 不是"册的重复定义"
  const MUST_NOT_TOPOLOGY = `const MODEL_BASE_MAP = { "4680": ["changzhou", "hefei"] };`; // 拓扑数组，非字段赋值

  const bite = inlineBaseIdHits(MUST_BITE, ids);
  const cmt = inlineBaseIdHits(MUST_NOT_COMMENT, ids);
  const foreign = inlineBaseIdHits(MUST_NOT_FOREIGN, ids);
  const topo = inlineBaseIdHits(MUST_NOT_TOPOLOGY, ids);
  // 绑定级派生判据也要自证：能认出真派生，且认得出被打断的派生。
  const derived = bindingDerivesFromRegistry(`const BASES = BASE_REGISTRY.map((b) => b.baseId);`, "BASES");
  const broken = bindingDerivesFromRegistry(`const BASES = [].map((b) => b.baseId);`, "BASES");

  const checks = {
    "①必中·两处真内联全抓到": bite.length === 2 && bite[0].id === "changzhou",
    "②必不中·注释里的内联一处都不许报": cmt.length === 0,
    "③必不中·册外 baseId 不报（那是悬空引用，另一种病，不归本门）": foreign.length === 0,
    "④必不中·拓扑数组不报（非字段赋值，见文件头作用域说明）": topo.length === 0,
    "⑤必中·真派生认得出": derived.ok === true,
    "⑥必中·被打断的派生认得出": broken.ok === false,
  };
  const bad = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  return { ok: bad.length === 0, got: bad.length ? `未通过：${bad.join(" · ")}` : "六向全通过" };
}

function toolBroken(what, detail = "") {
  console.error(`⛔ boundary-singlesource:check **工具坏了**：${what}`);
  console.error("   本次结论作废：**不许**读作「单一来源没问题 / 内联 0 / 通过」——本门这次什么都没证明。");
  if (detail) console.error("   " + detail);
  process.exit(2);
}

const readBaseline = () => (existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : null);
/** 存量条目的稳定 id：`<文件>#<baseId>` —— **刻意不含行号**（行号会漂，写死行号的账天生带保质期）。 */
const hitId = (file, h) => `${file}#${h.id}`;

const BASELINE_NOTE =
  "① 本文件是 `check-boundary-singlesource.mjs` 的**内联基地字面量存量棘轮**。" +
  "受检对象集合（扫谁）由门**现算**（SCAN_ROOTS 全遍历），本文件里一个扫描面路径都不存 —— " +
  "名单一手抄，名单外的文件就永远绿，那正是本门 2026-08-16 之前的病（本体 §8 G-GATE-ROSTER-HANDCOPIED）。" +
  "② 每条必须写 `why`（<10 字即判红）：**无理由白名单正是棘轮要治的病**，豁免要说清「凭什么这条今天可以不修」。" +
  "③ `maxEntries` 必须恒等于 entries 条数；评审唯一必须拒绝的一行，就是把它调大。" +
  "④ `--tighten` **只删不加**：修好一处即收回额度；新增内联**不自动收编**，当场红。";

function main() {
  const argv = process.argv.slice(2);
  const isCensus = argv.includes("--census");
  const isSeed = argv.includes("--seed");
  const isTighten = argv.includes("--tighten");

  /* ── 保命判据：金丝雀先跑。不过 ⇒ RC=2「门自己坏了」，与 RC=1「代码坏了」处置相反 ── */
  const c = boundaryCanary();
  if (!c.ok) toolBroken(`金丝雀${c.got}（解析器本体已失效，扫描结果不可信）`);
  const bc = baselineDocCanary();
  if (!bc.ok) toolBroken(`基线写入器金丝雀${bc.got}`);
  if (argv.includes("--selftest")) {
    console.log(`✓ 金丝雀：${c.got}；基线写入器：${bc.got}`);
    return 0;
  }

  const BASE_IDS = registryBaseIds();
  // 册读不出来 ⇒ 判据没了，差集恒空、门恒绿 ⇒ 这是**工具坏了**，不是"代码干净"。
  if (BASE_IDS.size === 0) toolBroken(`读不到 ${REGISTRY_FILE} 里的 BASE_REGISTRY baseId 全集（单一来源册结构变了？门失去判据）`);

  /* ── 扫描面**现算**（本单的核心改动：名单不再决定扫谁）───────────────────────── */
  const files = scanFiles();
  if (files.length < MIN_SCAN_FILES) {
    toolBroken(`扫描面只枚举到 ${files.length} 个 .ts/.tsx（下界 ${MIN_SCAN_FILES}）—— 枚举器坏了，不是文件没了`);
  }

  const fails = [];
  /* ── 判据①：三个绑定必须由册派生（正向断言名册；这是判据，不是扫描面）────────── */
  for (const { file, binding } of CONSUMERS) {
    let src;
    try { src = read(file); } catch { fails.push(`① 读不到正向断言名册里的 ${file}（名册与现实脱节：文件挪了就该同批改名册）`); continue; }
    const code = stripComments(src);
    if (!(/BASE_REGISTRY/.test(code) && /from "@platform\/contracts"/.test(code))) {
      fails.push(`① ${file}：未从 @platform/contracts 导入 BASE_REGISTRY`);
      continue;
    }
    const d = bindingDerivesFromRegistry(src, binding);
    if (!d.ok) {
      fails.push(`① ${d.line ? `${file}:${d.line}` : `${file}（未见 const ${binding} 声明）`}：绑定 ${binding} 未由 BASE_REGISTRY.map(...) 初始化（派生被打断）`);
    }
  }

  /* ── 判据②：SEG / PLAN_GOAL 名册成员必须引用对应 registry（含死账断言）─────────── */
  for (const [label, list, token] of [
    ["② SEG", SEG_CONSUMERS, "SEG_REGISTRY"],
    ["③ PLAN_GOAL", PLAN_GOAL_CONSUMERS, "PLAN_GOAL_TARGETS"],
  ]) {
    for (const file of list) {
      let src;
      try { src = read(file); } catch { fails.push(`${label} 读不到 ${file}（名册死账：文件已不存在，须同批删名册）`); continue; }
      if (!new RegExp(token).test(stripComments(src))) {
        fails.push(`${label} ${file}：未从 ${token} 派生（疑内联回潮；若该文件已不再是消费方，请从名册里删掉——留着就是死账）`);
      }
    }
  }

  /* ── 判据④：内联回潮 —— **全仓现算**，棘轮只降不升 ──────────────────────────── */
  const live = new Map(); // id -> {file, id, lines:[]}
  for (const file of files) {
    if (file === REGISTRY_FILE) continue; // 单一来源册本身：那里的字面量就是定义
    for (const h of inlineBaseIdHits(read(file), BASE_IDS)) {
      const key = hitId(file, h);
      if (!live.has(key)) live.set(key, { file, base: h.id, lines: [], text: h.text });
      live.get(key).lines.push(h.line);
    }
  }
  const base = readBaseline();
  const known = new Map(Object.entries(base?.entries ?? {}));

  if (isCensus) {
    console.log(`· 扫描面现算：${files.length} 个 .ts/.tsx（SCAN_ROOTS ${SCAN_ROOTS.length} 根）· 册内 baseId ${BASE_IDS.size} 个`);
    console.log(`· 内联命中 ${live.size} 组（按 文件#baseId 归并）：`);
    const byFile = {};
    for (const v of live.values()) (byFile[v.file] ||= []).push(`${v.base}×${v.lines.length}`);
    for (const [f, v] of Object.entries(byFile)) {
      const listed = CONSUMERS.some((c) => c.file === f);
      console.log(`    ${listed ? "[旧名单内]" : "[❗旧名单外·从未被问过]"} ${f}  ${v.join(" ")}`);
    }
    console.log(`· 正向断言名册：BASE ${CONSUMERS.length} · SEG ${SEG_CONSUMERS.length} · PLAN_GOAL ${PLAN_GOAL_CONSUMERS.length}`);
    return 0;
  }

  if (isSeed || isTighten) {
    // **只删不加**：--tighten 保留仍然命中的存量条目（连同人手写的 why），删掉已修好的。
    // --seed 首次建账才把当前全部命中落成条目（why 待人补，先落机器算得出的事实）。
    const prevEntries = base?.entries ?? {};
    const nextEntries = {};
    for (const [key, v] of live) {
      if (isTighten && !(key in prevEntries)) continue; // 新增的不自动收编（收编 = 买绿）
      nextEntries[key] = prevEntries[key] ?? {
        file: v.file,
        base: v.base,
        count: v.lines.length,
        why: "【待人补】首次建账由 --seed 落的机器事实，尚未写明「凭什么这条今天可以不修」。",
      };
      nextEntries[key].count = v.lines.length; // 算出来的字段永远刷新（否则棘轮被冻结）
    }
    const doc = buildBaselineDoc({
      prev: base,
      generatedBy: `node scripts/check-boundary-singlesource.mjs ${isSeed ? "--seed" : "--tighten"}`,
      prose: { note: BASELINE_NOTE },
      computed: { entries: nextEntries, maxEntries: Object.keys(nextEntries).length },
    });
    writeFileSync(BASELINE, JSON.stringify(doc, null, 2) + "\n");
    console.log(`✓ 基线已写：${Object.keys(nextEntries).length} 条存量（${isTighten ? "只删不加" : "首次建账"}）`);
    return 0;
  }

  if (!base) {
    toolBroken("找不到 scripts/boundary-singlesource-baseline.json —— 棘轮基线是本门判据④的输入，缺账即无从判定存量与新增", "先跑：node scripts/check-boundary-singlesource.mjs --seed");
  }
  if (typeof base.maxEntries === "number" && base.maxEntries !== known.size) {
    fails.push(`④ 基线自洽：maxEntries=${base.maxEntries} ≠ entries 条数 ${known.size}（改额度必须是一处显眼 diff，评审才看得见）`);
  }
  for (const [key, e] of known) {
    if (!e || typeof e.why !== "string" || e.why.trim().length < 10) {
      fails.push(`④ 基线条目 ${key} 缺 why（<10 字）——无理由白名单正是棘轮要治的病`);
    }
  }
  // 正向：新增内联（不在基线里）⇒ 红
  for (const [key, v] of live) {
    if (!known.has(key)) {
      fails.push(`④ 新增内联基地字面量：${v.file}:${v.lines.join(",")} baseId: "${v.base}"（应从 BASE_REGISTRY 查册派生）\n    ${v.text}`);
    }
  }
  // 反向：基线里有、现算已无 ⇒ 死账（免检名额），逼着跑 --tighten 收回
  for (const key of known.keys()) {
    if (!live.has(key)) {
      fails.push(`④ 棘轮松弛：基线仍挂着 ${key}，但现算已无此内联 —— 那是一张可以随时退回去的免检名额，请跑 --tighten 收紧`);
    }
  }

  if (fails.length) {
    console.error(`\n✗ boundary-singlesource:check 未通过（${fails.length} 条）：`);
    for (const m of fails) console.error(`  - ${m}`);
    console.error("\n  判据：基地集/应用细分/规划目标阈值须单一来源（@platform/contracts BASE_REGISTRY/SEG_REGISTRY/PLAN_GOAL_TARGETS），不得内联。");
    return 1;
  }
  console.log(
    `✓ boundary-singlesource:check：BASE_REGISTRY(${BASE_IDS.size} 基地) + SEG_REGISTRY + PLAN_GOAL_TARGETS 单一来源；` +
      `扫描面**现算** ${files.length} 个 .ts/.tsx（非手抄名单），内联存量 ${live.size} 组全部在棘轮基线内且各有 why，无新增、无死账。`,
  );
  return 0;
}

/* ── 顶层兜底（Program 直接子语句）—— 未预期异常一律归 RC=2「工具坏了」，不是 RC=1「代码坏了」。 */
try {
  process.exit(main());
} catch (e) {
  toolBroken(`未预期异常（${e?.message || e}）`, String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
}
