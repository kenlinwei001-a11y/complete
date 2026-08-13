#!/usr/bin/env node
/**
 * 门 `solver-arg-key-drift:check`（WO-SILENT-WRONG-ANSWER-3 · 键名漂移门 · 闭 `G-SOLVER-ARG-KEY-DRIFT`）：
 *
 * ── 它挡的是哪一类事故 ────────────────────────────────────────────────────────────────
 * **目录 `argHints` 声明的键，求解器根本不读** —— 于是「照说明书调用」= 静默拿到错答案：
 *   · `capacity_forecast` 声明 `{modelId,qty,weeks}`（`base` 连声明都没有），求解器读 `args.base`
 *     ⇒ 想限定基地的调用方照兄弟求解器惯例传 `baseId` → **静默答全网**（实测 p50 12.3016 vs 常州 5.5176，
 *       且与"完全不传基地"逐字节相同）；
 *   · `risk_timeline` 声明 `{baseId,days}`，求解器读 `{base,factor,horizon}` ⇒ **两个声明键一个都不被读**
 *     （实测 `{baseId:"zaozhuang"}` 返回 8 张卡且枣庄不在其中）。
 * 这一类的共同形态：**HTTP 200 + 页面正常 + 数字是错的**。跑不通用户会来问，静默错答用户会信。
 *
 * ── 判据（两条，缺一不可）────────────────────────────────────────────────────────────
 * ① 目录 `argHints` 的每个键，必须**要么**在求解器源里真被读（`args.<key>` / `args["key"]` / `has("key")`），
 *    **要么**登记在生产别名表 `SOLVER_ARG_ALIASES`（= 归一后会落到规范键上，仍然到得了）。
 * ② 别名表登记的每一条，其规范键必须**真的被读** —— 否则归一等于把参数搬到了另一个没人看的地方。
 *
 * ── 铁律 0.6：扫描类结论一律先自证工具（金丝雀与主逻辑**共用同一份 `isRead`**，不许各抄一份）──
 *   · 正金丝雀：`capacity_forecast.modelId` / `risk_timeline.horizon` / `capacity_forecast.base` 必须命中；
 *   · 负金丝雀：一个绝不存在的键必须**不**命中（防"正则宽到什么都匹" → 全绿是假的）；
 *   · 目录抽取条数必须 > 0。
 *   任一金丝雀不成立 ⇒ 报「**工具坏了**」并 exit 2，**不许**报「代码干净 / 无漂移」。
 *
 * ── 存量登记（`KNOWN_DRIFT`）──────────────────────────────────────────────────────
 * 本单只查证并修了 `capacity_forecast` / `risk_timeline` / `kit_readiness` 三个（有真实用户病历的那三个）。
 * 其余存量项**逐条追一层到读取点后分成两类**（`VERIFIED-OK` 假阳性 / `REAL-DRIFT` 真漂移·附求解器实读的键）——
 * 悄悄豁免真断裂正是本门要防的事，所以不许只写一句「已知」。
 * 新增任何一条未登记的漂移 ⇒ 门红。
 *
 * 用法：node scripts/check-solver-arg-key-drift.mjs（先 pnpm --filter datacore build）。
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
  console.error(`⛔ check-solver-arg-key-drift.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = new URL("../", import.meta.url);
const abs = (rel) => new URL(rel, root);
const fails = [];
const notes = [];

// ── 依赖：datacore dist（生产别名表 + 目录，**共用同一份表**，不在本文件另抄） ──
const distAliases = abs("apps/datacore/dist/solvers/arg-aliases.js");
const distCatalog = abs("apps/datacore/dist/catalog.js");
for (const [label, u] of [["datacore/solvers/arg-aliases", distAliases], ["datacore/catalog", distCatalog]]) {
  if (!existsSync(u)) {
    console.error(`✗ solver-arg-key-drift:check 失败（前置）：${label} dist 未构建（${u.pathname}）——先 pnpm --filter datacore build`);
    process.exit(1);
  }
}
const { SOLVER_ARG_ALIASES, knownArgKeys } = await import(distAliases.href);
// ⚠ 必须用 **ALL_SOLVER_CATALOG**（= SOLVER_CATALOG 22 ∪ GENERIC 20 ∪ COCKPIT 17 = 59），不是 SOLVER_CATALOG。
//    第一版本门写成 `SOLVER_CATALOG` 时只扫到 22/59，会在**只看了三分之一**的情况下报「无漂移」——
//    正是铁律 0.6 那个形态：「我用 X 当作 Y 的证据，而 X 并不度量 Y」。故下面加一条扫描面自证。
const { ALL_SOLVER_CATALOG, SOLVER_CATALOG, GENERIC_SOLVER_CATALOG, COCKPIT_SOLVER_CATALOG } = await import(distCatalog.href);
const CATALOG = ALL_SOLVER_CATALOG;

// ── 扫描面：求解器实现（solvers/*.ts）+ app.ts（少数求解器入参在路由层读） ──
const solverDir = fileURLToPath(abs("apps/datacore/src/solvers/"));
const srcFiles = readdirSync(solverDir).filter((f) => f.endsWith(".ts"));
const BLOB =
  srcFiles.map((f) => readFileSync(join(solverDir, f), "utf8")).join("\n") +
  "\n" +
  readFileSync(abs("apps/datacore/src/app.ts"), "utf8");

/**
 * 「这个键真的被读了吗」——**唯一实现**，金丝雀与主逻辑共用（抄第二份 = 改主正则时金丝雀拿旧的去测、照样绿）。
 *
 * ⚠ **本门自己的诚实位（已知局限·不许当成"扫过了就没事"）**：判据是**全仓求解器源里有没有人读这个键名**，
 *   **不是**「这个求解器读不读」。故存在一类**假阴性**：某键被**别的**求解器读，本求解器不读 —— 本门看不见。
 *   实测例（green→red 变异当场暴露）：把 `risk_timeline` 的 argHints 退回 `{baseId, days}` 并删掉别名登记，
 *   本门只红在 `days`；`baseId` **没红**，因为 `base_capacity_outlook`/`affected_orders` 在读 `args.baseId`。
 *   ⇒ 本门只能挡住「**全仓没人读**」这一档；「本求解器不读、别人读」那一档要靠
 *   `apps/datacore/test/silent-wrong-answer-3.seam.test.ts` 的**差分断言**（换一个基地答案必须变）来咬。
 *   两道门形态不同、都要在：静态门覆盖面广但粒度粗，差分门粒度准但只覆盖被点名的求解器。
 */
function isRead(key) {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`args\\.${k}\\b|args\\[["']${k}["']\\]|\\bhas\\(["']${k}["']\\)`).test(BLOB);
}

// ── 金丝雀（必须先于任何否定结论） ──
const POSITIVE = [
  ["capacity_forecast", "modelId"], // capacity.ts `str(args.modelId)`
  ["risk_timeline", "horizon"], // risk.ts `num(args.horizon, 30)`
  ["capacity_forecast", "base"], // capacity.ts `normalizeBaseRef(args.base)`
];
const posMiss = POSITIVE.filter(([, k]) => !isRead(k));
const NEG_KEY = "__key_that_must_never_exist_zzz__";
if (posMiss.length > 0 || isRead(NEG_KEY) || CATALOG.length === 0) {
  console.error("✗ solver-arg-key-drift:check —— **工具坏了**，拒绝报「无漂移」这种否定结论：");
  if (posMiss.length) console.error(`  - 正金丝雀未命中：${posMiss.map(([s, k]) => `${s}.${k}`).join(", ")}（这些键源码里确实在读）`);
  if (isRead(NEG_KEY)) console.error(`  - 负金丝雀命中：正则宽到连 ${NEG_KEY} 都算"被读"了 → 全绿是假的`);
  if (CATALOG.length === 0) console.error("  - ALL_SOLVER_CATALOG 抽出 0 条");
  process.exit(2);
}
const sumParts = SOLVER_CATALOG.length + GENERIC_SOLVER_CATALOG.length + COCKPIT_SOLVER_CATALOG.length;
if (sumParts !== CATALOG.length) {
  console.error(`✗ 工具坏了：扫描面不完整 —— ALL_SOLVER_CATALOG=${CATALOG.length} ≠ 22+20+17 的实际和 ${sumParts}（目录被拆分/新增了子表而本门没跟上）`);
  process.exit(2);
}
console.log(
  `✓ 金丝雀：正 ${POSITIVE.map(([s, k]) => `${s}.${k}`).join(" / ")} 全部命中；` +
    `负 ${NEG_KEY} 未命中；目录 ${CATALOG.length} 条（SOLVER ${SOLVER_CATALOG.length} ∪ GENERIC ${GENERIC_SOLVER_CATALOG.length} ∪ COCKPIT ${COCKPIT_SOLVER_CATALOG.length}） · 扫描面 ${srcFiles.length} 个求解器源文件 + app.ts（${BLOB.length} 字符）`,
);

/**
 * 存量漂移登记（**逐条已追一层到读取点**·铁律 0.5：grep 命中数不是结论）。
 *
 * 两类，**定性不同不许混**：
 *   · `VERIFIED-OK`  = 本门扫描面的**假阳性** —— 该键确实被读，只是不走 `args.<key>` 字面量
 *     （整包 `args` 交给 zod schema 解析）。已追到那一行，附 file:line。
 *   · `REAL-DRIFT`   = **真漂移** —— 已追到求解器实读的键，与目录声明的键对不上。与本单 ①② 同一类病，
 *     只是没有用户病历、不在本单范围，故不修；**每条都写出求解器真读的键**，下一单一行可改。
 *
 * 本单只修了有真实用户病历的三个（capacity_forecast / risk_timeline / kit_readiness）。
 * 新增任何一条未登记的漂移 ⇒ 门红。
 */
const KNOWN_DRIFT = {
  // ── VERIFIED-OK：整包 args 经 zod 解析，不走 args.<key> 字面读取（service.ts:1182 OntologyQueryInputSchema.safeParse(rawInput)）──
  ontology_query: {
    rootFilter: "VERIFIED-OK：service.ts:1182 把整包 args 交 OntologyQueryInputSchema 解析 → 该键真被读（本门字面扫描的假阳性）",
    hops: "VERIFIED-OK：同上（service.ts:1182）——本门第一版曾把它报成漂移，追一层后确认是假阳性",
  },
  // ── REAL-DRIFT：已追到求解器实读的键（file:line 在下方注释），与目录声明对不上 ──
  plan_audit: { versionId: "REAL-DRIFT：service.ts:4529 要求的是 10 个必填数值 dem/seg_pas/seg_ess/seg_com/sup/ltaCov/kitGap/gmTarget/cashCushion/capex；versionId 无读者（WO-ENGINE-SCOPE-FORENSICS §3.1 已记）" },
  plan_generate: { objective: "REAL-DRIFT：plan.ts planGenerate 读 targets/base/hard，objective 无读者（同上 §3.1）" },
  shared_bottleneck: { upstreamType: "REAL-DRIFT：service.ts:1046-1051 实读 resourceType/sharedByType/viaField/capacityField/demandField/priorityField —— 目录该写 resourceType+sharedByType" },
  assignment_optimize: { bins: "REAL-DRIFT：service.ts:3708-3712 实读 itemType/binType/weightField/capacityField/costField —— 目录该写 binType" },
  sequencing_optimize: {
    jobs: "REAL-DRIFT：service.ts:3746-3747 实读 jobType/groupField —— 目录该写 jobType",
    changeover: "REAL-DRIFT：同上，无 changeover 读者 —— 目录该写 groupField",
  },
  facility_location: { serveCost: "REAL-DRIFT：service.ts:4100-4102 实读 facilities/clients/assignCosts —— 目录该写 assignCosts" },
  set_cover: { subsets: "REAL-DRIFT：service.ts:4141-4143 实读 sets/universe —— 目录该写 sets" },
  optimize_whatif: {
    templateKey: "REAL-DRIFT：service.ts:3886 实读 family（OptTemplateFamily）—— 目录该写 family",
    perturbation: "REAL-DRIFT：service.ts:3888 实读 perturbations（复数）—— 目录该写 perturbations",
  },
};

// ── 断言① 目录声明的键必须到得了求解器 ──
let ok1 = 0;
for (const item of CATALOG) {
  const hints = Object.keys(item.argHints ?? {});
  const known = knownArgKeys(item.key); // 生产别名表（规范键 ∪ 别名）
  for (const hint of hints) {
    if (isRead(hint) || known.has(hint)) { ok1++; continue; }
    const reason = KNOWN_DRIFT[item.key]?.[hint];
    if (reason) { notes.push(`  · 存量登记 ${item.key}.${hint}：${reason}`); continue; }
    fails.push(
      `断言① 键名漂移：目录 argHints 声明 「${item.key}.${hint}」，但全部求解器源里找不到任何读取点，` +
        `且未登记为别名（SOLVER_ARG_ALIASES）⇒ 照说明书传这个键 = **静默丢参 → plausible-but-WRONG**` +
        `（G-SOLVER-ARG-KEY-DRIFT：capacity_forecast 传 baseId 静默答全网 / risk_timeline 传 days 窗口恒 30）。` +
        `修：改 catalog.ts 声明成求解器真读的键，或把该键收进 apps/datacore/src/solvers/arg-aliases.ts 的别名表。`,
    );
  }
}

// ── 断言② 别名表的规范键必须真被读（否则归一只是把参数搬到另一个没人看的地方） ──
let ok2 = 0;
for (const [solverKey, spec] of Object.entries(SOLVER_ARG_ALIASES)) {
  for (const [canonical, aliases] of Object.entries(spec)) {
    if (!isRead(canonical)) {
      fails.push(
        `断言② 别名指向空处：${solverKey} 的规范键「${canonical}」在求解器源里找不到读取点 ——` +
          `把 ${aliases.join("/")} 归一到一个没人读的键上，等于换个地方继续静默丢参。`,
      );
      continue;
    }
    ok2++;
  }
}

// ── 汇总 ──
if (notes.length) {
  console.log("solver-arg-key-drift:check · 存量登记（逐条已追一层·VERIFIED-OK=假阳性 / REAL-DRIFT=真漂移·非静默豁免）：");
  for (const n of notes) console.log(n);
}
if (fails.length) {
  console.error(`\n✗ solver-arg-key-drift:check 失败（${fails.length}）：`);
  for (const f of fails) console.error("  - " + f);
  process.exit(1);
}
console.log(
  `\n✓ solver-arg-key-drift:check 通过：${CATALOG.length} 个目录求解器 · ${ok1} 条 argHints 键到得了求解器` +
    `（${notes.length} 条存量已登记：${notes.filter((n) => n.includes("REAL-DRIFT")).length} 条 REAL-DRIFT 待后续单修 / ${notes.filter((n) => n.includes("VERIFIED-OK")).length} 条 VERIFIED-OK 假阳性）；别名表 ${Object.keys(SOLVER_ARG_ALIASES).length} 个求解器 · ${ok2} 个规范键全部有真读取点。`,
);
