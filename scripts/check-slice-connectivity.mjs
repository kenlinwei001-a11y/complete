#!/usr/bin/env node
/**
 * 本体切片连通性门禁（WO-SLICE-CONNECTIVITY · 方案 D 地基接缝）。
 *
 * 原则：从本体图（types+links）确定性派生切片库（deriveSliceLibrary），
 * 把「切片可 join」形式化——两切片相连 ⟺ 共享 ≥1 spannedType 或 存在一条 link 桥接双方类型。
 * 孤岛 = 度 0 的切片（与任何其他切片既无共享类型也无桥接 link → 无法 join）。
 * 非豁免孤岛即 §8 G-BUILD-LINK 的检测面（建域切片链路派生不稳·恒空/孤立切片）→ exit 1。
 *
 * 运行前需先构建 datacore：pnpm --filter datacore build
 * 用法：node scripts/check-slice-connectivity.mjs   （建议经 package.json slice-connectivity:check）
 */
import { existsSync, writeFileSync } from "node:fs";
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

// 合法孤岛（自成体系的切片，与业务履约图不 join 是设计而非断裂）。每条须注释为何合法孤立——
// 防「悄悄豁免真断裂」：新增豁免前先真跑确认其确实是自封闭分析层，不是漏了桥接 link。
const EXEMPT_SLICES = new Set([
  // biz.decision.causalfactor：decision 域内切片，root=CausalFactor（字典序首）。CausalFactor 的
  // 唯一本体边是自指因果链 caused_by（CausalFactor→CausalFactor），由 gap_attribution 引擎遍历，
  // 全本体无任何 link 把 CausalFactor 与业务履约类型相连（设计如此：因果推理是决策层独立分析图，
  // 经引擎图遍历消费而非切片 join）→ 合法自封闭孤岛，非 G-BUILD-LINK 断裂。
  "biz.decision.causalfactor",
]);

const { deriveSliceLibrary, auditSliceConnectivity } = await import(join(DIST, "ontology/slice-library.js"));
const { batteryObjectTypes, batteryLinkTypes } = await import(join(DIST, "synthetic/battery.js"));
const { extendedObjectTypes } = await import(join(DIST, "synthetic/battery-extended.js"));

// 电池 battery 本体（types+links → 派生库输入形）。
const types = [...batteryObjectTypes(), ...extendedObjectTypes()].map((t) => ({ key: t.key, domain: t.domain }));
const links = batteryLinkTypes().map((l) => ({ linkKey: l.key, fromTypeKey: l.fromTypeKey, toTypeKey: l.toTypeKey }));

const { intra, cross } = deriveSliceLibrary(types, links);
const entries = [...intra, ...cross];
const report = auditSliceConnectivity(entries, types, links);

const viaCount = report.edges.reduce((m, e) => ((m[e.via] = (m[e.via] || 0) + 1), m), {});
const bridgeEdges = report.edges.filter((e) => e.via === "bridge-link");

console.log(`· 本体：类型 ${types.length}，链路 ${links.length}`);
console.log(`· 切片库：${report.slices.length}（域内 ${intra.length}，跨域 ${cross.length}）`);
console.log(`· 连通边：${report.edges.length}（shared-type ${viaCount["shared-type"] || 0}，bridge-link ${viaCount["bridge-link"] || 0}）`);
console.log(`· 孤岛：${report.islands.length}（豁免 ${EXEMPT_SLICES.size}）`);

const nonExemptIslands = report.islands.filter((is) => !EXEMPT_SLICES.has(is.sliceKey));
const exemptIslands = report.islands.filter((is) => EXEMPT_SLICES.has(is.sliceKey));

if (exemptIslands.length > 0) {
  console.log(`· 豁免孤岛（已审计，不阻断）：${exemptIslands.map((is) => is.sliceKey).join(", ")}`);
}

// 写/更新可读缺口报告（连通图摘要 + 孤岛表 + bridge-link join 字段清单）。
const typeSetOf = new Map(entries.map((e) => [e.sliceKey, e.spannedTypes]));
const lines = [];
lines.push("# 本体切片连通性缺口报告（ONTOLOGY-SLICE-GAPS）");
lines.push("");
lines.push("> 门禁 `slice-connectivity:check` 产物（`scripts/check-slice-connectivity.mjs`）。请勿手改——重跑门禁即刷新。");
lines.push("> 节点=切片，边=两切片可 join（共享 spannedType 或 桥接 link）；孤岛=度 0 切片（§8 G-BUILD-LINK 检测面）。");
lines.push("");
lines.push("## 连通图摘要");
lines.push("");
lines.push(`- 本体：类型 **${types.length}**，链路 **${links.length}**`);
lines.push(`- 切片库：**${report.slices.length}**（域内 ${intra.length} · 跨域 ${cross.length}）`);
lines.push(`- 连通边：**${report.edges.length}**（shared-type ${viaCount["shared-type"] || 0} · bridge-link ${viaCount["bridge-link"] || 0}）`);
lines.push(`- 孤岛：**${report.islands.length}**（豁免 ${EXEMPT_SLICES.size} · 非豁免 ${nonExemptIslands.length}）`);
lines.push("");
lines.push("## 孤岛表");
lines.push("");
if (report.islands.length === 0) {
  lines.push("_无孤岛：所有切片至少与一个其他切片可 join。_");
} else {
  lines.push("| 切片 | spannedTypes | 状态 | 说明 |");
  lines.push("|---|---|---|---|");
  for (const is of report.islands) {
    const exempt = EXEMPT_SLICES.has(is.sliceKey);
    lines.push(`| \`${is.sliceKey}\` | ${(typeSetOf.get(is.sliceKey) || []).join(", ")} | ${exempt ? "✅ 已豁免" : "✗ 待桥接"} | ${is.reason} |`);
  }
}
lines.push("");
lines.push("## bridge-link join 字段清单");
lines.push("");
lines.push("> 每条经 link 桥接的切片对（非共享类型直连），记 linkKey + join 字段 from→to type。这是「跨切片关联字段真实存在本体图」的正向闭包证据（R12）。");
lines.push("");
if (bridgeEdges.length === 0) {
  lines.push("_无 bridge-link 边（所有连通均经共享类型直连）。_");
} else {
  lines.push("| 切片 A | 切片 B | join（linkKey: from→to） |");
  lines.push("|---|---|---|");
  for (const e of bridgeEdges) {
    lines.push(`| \`${e.a}\` | \`${e.b}\` | ${e.detail} |`);
  }
}
lines.push("");
writeFileSync(join(ROOT, "docs/ONTOLOGY-SLICE-GAPS.md"), lines.join("\n"));

if (nonExemptIslands.length > 0) {
  console.error("\n✗ 切片连通性门禁未通过（以下切片是孤岛——与任何其他切片既无共享类型也无桥接 link，无法 join）：");
  for (const is of nonExemptIslands) {
    const spanned = (typeSetOf.get(is.sliceKey) || []).join(", ");
    console.error(`  - ${is.sliceKey}（spannedTypes: ${spanned}）`);
    // 建议桥接点：该切片跨越的类型若在其它 link 里出现对端，提示可补的 link。
    const spannedSet = new Set(typeSetOf.get(is.sliceKey) || []);
    const near = links.filter((l) => spannedSet.has(l.fromTypeKey) !== spannedSet.has(l.toTypeKey));
    if (near.length > 0) {
      console.error(`      可疑桥接点（含该切片类型的链路）：${near.slice(0, 5).map((l) => `${l.linkKey}(${l.fromTypeKey}→${l.toTypeKey})`).join(", ")}`);
    } else {
      console.error("      该切片类型在本体中无任何跨切片链路 → 补一条 link 桥接，或确认为合法孤岛后登记 EXEMPT_SLICES（附理由）。");
    }
  }
  console.error("\n  修法：补桥接 link 使切片可 join，或在 EXEMPT_SLICES 登记为合法孤岛（每条注明为何自封闭）。");
  process.exit(1);
}

console.log("\n✓ 切片连通性门禁通过（无非豁免孤岛，切片库全连通/合法孤立，缺口报告已刷新 docs/ONTOLOGY-SLICE-GAPS.md）。");
process.exit(0);
