#!/usr/bin/env node
/**
 * 门 `derive-fields:check`（WO-DB-DERIVE-DECISION-FIELDS·G4·KILL-MOCK-RED·R6·R13·R14·堵 §8 G-8）：
 * 守"导入记录字段 → 决策字段 派生引擎"**从真源值算·非 hash/写死/兜底冒充**，且**口径全来自可配置 mapping·
 * 零电池/行业常数**（R14 generality-mandatory·电池只是一份 mapping 实例）。
 *
 * 静态牙齿（apps/datacore/src/decision/derive-fields.ts）：
 *   - 引擎不得含 hash 造值（`\w*[Hh]ash\w*(`）——注入 hashString 即红。
 *   - 引擎不得内联电池业务常数（基地名/工序/型号 token）——写死即红。
 *   - 必含真聚合算子实现（avg/sum/ratio/weighted_avg 分支）。
 * 动态牙齿（dist·真跑引擎）：
 *   - 喂真源记录 → 逐值断言 Base.util = 真均值（oracle·非 hash）；
 *   - green→red 自证：把一条结果 value 改成伪造值 → validateDerivedFields 必逮（否则门无牙即红）。
 *
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §7（gates）+ §8 G-8。用法：node scripts/check-derive-fields.mjs
 */
import { readFileSync, existsSync } from "node:fs";
const root = new URL("../", import.meta.url);
const read = (rel) => (existsSync(new URL(rel, root)) ? readFileSync(new URL(rel, root), "utf8") : null);
const fail = [];

// ── 静态：引擎源无 hash 造值 / 无电池常数 / 有真聚合 ──
const src = read("apps/datacore/src/decision/derive-fields.ts");
if (!src) fail.push("apps/datacore/src/decision/derive-fields.ts 缺失（派生引擎未在位）");
else {
  const strip = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""); // 去注释（注释里写"不 hash"不算残口）
  if (/\b\w*[Hh]ash\w*\s*\(/.test(strip)) fail.push("derive-fields.ts 含 hash 调用（派生值疑由 hash 造·KILL-MOCK-RED）");
  if (/Math\.random|Date\.now|new Date\(/.test(strip)) fail.push("derive-fields.ts 含时钟/随机（违 R6 确定性）");
  const BATTERY = ["常州", "合肥", "西安", "宜宾", "化成", "涂布", "卷绕", "4680", "刀片", "乘用车", "商用车"];
  const hit = BATTERY.find((t) => strip.includes(t));
  if (hit) fail.push(`derive-fields.ts 内联电池业务常数「${hit}」（违 R14·引擎须零行业常数·电池只是 mapping 实例）`);
  for (const op of ["avg", "sum", "ratio", "weighted_avg"])
    if (!new RegExp(`case "${op}"`).test(strip)) fail.push(`derive-fields.ts 缺聚合算子 ${op} 分支（口径不全）`);
  if (!/validateDerivedFields/.test(strip)) fail.push("derive-fields.ts 缺 validateDerivedFields（KILL-MOCK 测谎牙齿未在位）");
}

async function dynamic() {
  const dist = new URL("apps/datacore/dist/decision/derive-fields.js", root);
  if (!existsSync(dist)) { fail.push("dist 未构建——跳过动态（跑 pnpm --filter datacore build）"); return; }
  const { deriveDecisionFields, validateDerivedFields } = await import(dist.href);

  // 可配置 mapping（**非电池内联**·门内以抽象数据提供：类 REVIEW §4 Base.util = avg(Line.oee BY factory 键)）。
  const mapping = {
    rules: [
      { target: { objectType: "Base", field: "util" }, source: { objectType: "ProductionLine", field: "oee", groupByField: "factory_id" }, op: "avg", targetKeyField: "factory_id", scale: 0.01, clampMin: 0, clampMax: 1, precision: 4 },
    ],
  };
  // 真源记录（真值·非 hash）：F001 两条线 oee=90/80 → avg=85 → ×0.01 = 0.85。
  const byType = new Map([
    ["Base", [{ id: "obj_Base_F001", props: { factory_id: "F001" }, real: true }]],
    ["ProductionLine", [
      { id: "obj_PL_L1", props: { factory_id: "F001", oee: 90 }, real: true },
      { id: "obj_PL_L2", props: { factory_id: "F001", oee: 80 }, real: true },
    ]],
  ]);
  const results = deriveDecisionFields(mapping, byType);
  const util = results.find((r) => r.field === "util");
  if (!util) { fail.push("引擎未产 Base.util 结果（派生断）"); return; }
  if (util.value !== 0.85) fail.push(`Base.util 逐值 oracle 失守：期望 0.85（真均值 (90+80)/2×0.01）实得 ${util.value}（值非从真源算）`);
  if (util.dataMode !== "LIVE") fail.push(`Base.util dataMode 期望 LIVE（贡献源全真导入）实得 ${util.dataMode}`);
  if (util.sourceObjectIds.length !== 2) fail.push(`Base.util sourceObjectIds 应含 2 真源（R13）实得 ${util.sourceObjectIds.length}`);

  // green→red 自证：把结果 value 篡成伪造值 → validate 必逮（门牙）。
  const clean = validateDerivedFields(mapping, byType, results);
  if (clean.length !== 0) { fail.push(`真结果不该有违例，validate 误报：${clean.join("；")}`); return; }
  const poisoned = results.map((r) => (r.field === "util" ? { ...r, value: 0.123456 } : r));
  const caught = validateDerivedFields(mapping, byType, poisoned);
  if (caught.length === 0) fail.push("green→red 自证失守：伪造 Base.util=0.123456 未被 validateDerivedFields 逮（门无牙·假值可蒙混）");
}
await dynamic();

if (fail.length) { console.error("✗ derive-fields:check 失败："); for (const f of fail) console.error("  - " + f); process.exit(1); }
console.log("✓ derive-fields:check 通过（派生引擎从真源算·逐值 oracle 对上·零业务常数·validate 逮伪造·green→red 有牙）");
