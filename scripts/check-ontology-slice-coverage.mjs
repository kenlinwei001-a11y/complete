#!/usr/bin/env node
/**
 * 本体切片字段覆盖门禁（WO-Phase1-D+A · 方案 D）。
 *
 * 原则：每个已发布 OntologyType 的非派生字段必须被至少一个 SliceSpec 覆盖；
 * derivedProperties 中的派生字段豁免（由 recompute 链路生成，不入切片不等于缺失）。
 *
 * 运行前需先构建 datacore：pnpm --filter datacore build
 * 用法：node scripts/check-ontology-slice-coverage.mjs   （建议经 package.json ontology-slice-coverage:check）
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
  console.error(`⛔ check-ontology-slice-coverage.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


import { assertDistFresh } from "./dist-freshness.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DIST = join(ROOT, "apps/datacore/dist");

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// ⛔ 守卫必须在 import dist **之前**（欠账 #161）：本门用 dist 的类型/切片算字段覆盖率并与基线比，
//    dist 过期时覆盖率是**旧世界**的数，却被当作源码欠账报出来。
assertDistFresh(["apps/datacore/dist"], { gate: "ontology-slice-coverage:check" });

// 平台配置/元类型、审计/日志类型、Dogfooding 元层：合法地不在业务切片中。
// ── 豁免名单大改（WO-GATE-ROSTER-SWEEP-2，2026-08-18）────────────────────────────
// 旧形态：14 条手抄豁免（平台配置 8 · 审计日志 3 · Dogfooding 元层 3）。实测**全部 14 条
// 不在本门宇宙的已发布类型里**（battery+extended 共 94 个类型，零个平台/元类型）——
// 即整份名单今天豁免了「无」，是纯死账；而明天谁把 SystemInvariant 之类种进电池本体，
// 它会**自动免切片覆盖**。豁免绝不该自动生效（现算豁免 = 自动豁免，同样是错的方向）。
// 故照普查处方落四条机器纪律（断点 G-GATE-ROSTER-HANDCOPIED 本条收口）：
//   ① 死账当场清零（下面这份名单现在是空的）；
//   ② 每条豁免必须带 ≥20 字理由（机器断言，写不出理由的豁免就是不该豁免）；
//   ③ 死账断言：豁免类型不在已发布类型里 ⇒ 红（类型删了/改名了，豁免不许留下来当幽灵）；
//   ④ 条数上限 EXEMPT_CAP 只降不升：新增豁免必然顶破上限 ⇒ 红 ⇒ 抬上限是个显眼 diff，
//      review 时必须能说出为什么。
/** 豁免类型 → 理由（≥20字）。当前**零条**（14 条死账已于 2026-08-18 清零）。 @type {Map<string, string>} */
const EXEMPT_TYPES = new Map([]);
/** 豁免条数上限（只降不升）。抬它 = 显眼 diff，须附带「为什么这个类型合法地无切片」的人工裁决。 */
const EXEMPT_CAP = 0;

const { batteryObjectTypes, batteryLinkTypes, batteryBuiltinSlices } = await import(join(DIST, "synthetic/battery.js"));
const { extendedObjectTypes } = await import(join(DIST, "synthetic/battery-extended.js"));
const { batteryCoverageSlices, batteryDataCategories } = await import(join(DIST, "synthetic/data-categories.js"));
const { computeFieldCoverage, computeCategoryCoverage } = await import(join(DIST, "databuilder/slice-coverage.js"));

// 模拟已发布本体（demo 租户）。
const types = [...batteryObjectTypes(), ...extendedObjectTypes()].map((t) => ({
  ...t,
  id: `type_${t.key}`,
  tenantId: "demo",
  version: 1,
  status: "ACTIVE",
}));
const links = batteryLinkTypes().map((l) => ({
  ...l,
  id: `link_${l.key}`,
  tenantId: "demo",
  version: 1,
}));
const slices = [...batteryBuiltinSlices(), ...batteryCoverageSlices()].map((s) => ({
  sliceKey: s.sliceKey,
  spec: s.spec,
}));

const categories = batteryDataCategories();

// ── 豁免名单三断言（在算覆盖率之前先审名单本身；机器盯名单，不靠人记得）─────────────
if (EXEMPT_TYPES.size > EXEMPT_CAP) {
  fail(`豁免名单 ${EXEMPT_TYPES.size} 条 > 上限 ${EXEMPT_CAP} —— 上限只降不升：新增豁免必须先把理由摆进 review（抬 EXEMPT_CAP 是个显眼 diff）。`);
}
for (const [k, why] of EXEMPT_TYPES) {
  if (!why || why.length < 20) fail(`豁免类型 ${k} 无理由或理由不足 20 字 —— 写不出理由的豁免就是不该豁免。`);
  if (!types.some((t) => t.key === k)) fail(`豁免类型 ${k} 是**死账**：不在已发布类型（battery+extended）里 —— 类型已删/改名，豁免不许留下当幽灵（它会豁免未来某个同名类型）。摘掉它。`);
}

const fieldReport = computeFieldCoverage(types, links, slices);
const catReport = computeCategoryCoverage(types, categories);

// 豁免类型不计入未覆盖。
const nonExemptUncovered = fieldReport.byType.filter((t) => !EXEMPT_TYPES.has(t.typeKey) && t.uncovered.length > 0);
const exemptUncovered = fieldReport.byType.filter((t) => EXEMPT_TYPES.has(t.typeKey) && t.uncovered.length > 0);

console.log(`· 已发布类型：${types.length}（豁免 ${EXEMPT_TYPES.size} 个元类型）`);
console.log(`· 字段总数：${fieldReport.totalFields}，已覆盖：${fieldReport.coveredFields}，未覆盖：${fieldReport.totalFields - fieldReport.coveredFields}`);
console.log(`· 分类覆盖：${catReport.categorizedTypes.length} 个类型已归入分类，未分类 ${catReport.uncategorizedTypes.length} 个，重复 ${catReport.duplicateTypes.length} 个`);

if (exemptUncovered.length > 0) {
  console.log(`· 豁免类型未覆盖字段（已审计，不阻断）：${exemptUncovered.length} 个类型`);
  for (const t of exemptUncovered) {
    console.log(`  - ${t.typeKey}：${t.uncovered.join(", ")}`);
  }
}

let exitCode = 0;

if (nonExemptUncovered.length > 0) {
  console.error("\n✗ 本体切片字段覆盖门禁未通过（以下非派生字段未被任何 SliceSpec 覆盖）：");
  for (const t of nonExemptUncovered) {
    console.error(`  - ${t.typeKey}（${t.uncovered.length}/${t.totalFields}）：${t.uncovered.join(", ")}`);
  }
  console.error("\n  修法：把字段补进相关 SliceSpec 的 project，或在合法豁免清单中登记类型。");
  exitCode = 1;
}

if (!catReport.complete) {
  console.error("\n✗ 数据分类覆盖未通过：");
  if (catReport.uncategorizedTypes.length) console.error(`  未分类类型：${catReport.uncategorizedTypes.join(", ")}`);
  if (catReport.duplicateTypes.length) console.error(`  重复分类类型：${catReport.duplicateTypes.join(", ")}`);
  exitCode = 1;
}

if (exitCode === 0) {
  console.log("\n✓ 本体切片字段覆盖门禁通过（所有非派生字段均被切片覆盖，且每个类型恰好归入一个分类）。");
}

process.exit(exitCode);
