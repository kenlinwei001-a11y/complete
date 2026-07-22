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
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DIST = join(ROOT, "apps/datacore/dist");

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!existsSync(DIST)) {
  fail("缺少 apps/datacore/dist/，请先运行 pnpm -r build（或 pnpm --filter datacore build）");
}

// 平台配置/元类型、审计/日志类型、Dogfooding 元层：合法地不在业务切片中。
const EXEMPT_TYPES = new Set([
  // 平台配置/元类型
  "FeatureConfig",
  "Tenant",
  "User",
  "LlmProvider",
  "LlmPurposeBinding",
  "PromptTemplate",
  "ConfigBundle",
  "SystemObjectType",
  // 审计/日志类型
  "OutboxEvent",
  "Notification",
  "IdempotencyRecord",
  // Dogfooding 元层
  "SystemInvariant",
  "SystemBreakpoint",
  "SystemGate",
]);

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
