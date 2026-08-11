#!/usr/bin/env node
/**
 * 本体描述覆盖率门禁（WO-RESOURCE-CATALOG-ONTOLOGY T3 · 描述不许腐化）。
 *
 * 纪律：**ACTIVE object_type 必须有非空 displayName 且非空 description；property 必须有非空 description。**
 * 资源目录（object_type/field kind）自此真值源投影——本体描述腐化 = Agent 拿到的地图腐化。
 *
 * 机制：棘轮基线（同 check-debattery.mjs）——`scripts/ontology-description-baseline.json` 记录存量缺失键，
 *   - 出现基线之外的违规 → 红（**新增**缺失被禁：新类型/新属性必须带描述）；
 *   - 存量违规减少 → 绿，并提示 `--update` 收紧基线（补全成果落账）。
 * 违规键：`type:<TypeKey>:displayName` / `type:<TypeKey>:description` / `prop:<TypeKey>.<propKey>`。
 *
 * 真值源：datacore dist 的 batteryObjectTypes() + extendedObjectTypes()（demo 租户已发布本体，
 * 与 check-ontology-slice-coverage.mjs 同一真值集）。运行前需 pnpm --filter datacore build。
 * 用法：node scripts/check-ontology-descriptions.mjs [--update]   （package.json: ontology:check 链路一环）
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DIST = join(ROOT, "apps/datacore/dist");
const BASELINE = join(ROOT, "scripts/ontology-description-baseline.json");

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!existsSync(DIST)) {
  fail("缺少 apps/datacore/dist/，请先运行 pnpm -r build（或 pnpm --filter datacore build）");
}

const { batteryObjectTypes } = await import(join(DIST, "synthetic/battery.js"));
const { extendedObjectTypes } = await import(join(DIST, "synthetic/battery-extended.js"));

// demo 租户已发布本体（与 check-ontology-slice-coverage.mjs 同一真值集）。
const types = [...batteryObjectTypes(), ...extendedObjectTypes()];

const nonEmpty = (s) => typeof s === "string" && s.trim().length > 0;

/** 收集当前违规键（确定性字典序·R6）。 */
function collectViolations() {
  const out = [];
  for (const t of types) {
    const status = t.status ?? "ACTIVE";
    if (status !== "ACTIVE") continue; // 只守 ACTIVE（WO T3）
    if (!nonEmpty(t.displayName)) out.push(`type:${t.key}:displayName`);
    if (!nonEmpty(t.description)) out.push(`type:${t.key}:description`);
    for (const p of t.properties ?? []) {
      if (!nonEmpty(p.description)) out.push(`prop:${t.key}.${p.propKey}`);
    }
  }
  return out.sort();
}

const current = collectViolations();
const update = process.argv.includes("--update");

if (update) {
  writeFileSync(BASELINE, JSON.stringify({ violations: current }, null, 2) + "\n");
  console.log(`✓ 本体描述基线已更新：${current.length} 条存量违规（${types.length} 类型扫描）。`);
  process.exit(0);
}

const baseline = existsSync(BASELINE)
  ? (JSON.parse(readFileSync(BASELINE, "utf8")).violations ?? [])
  : [];
const baseSet = new Set(baseline);
const curSet = new Set(current);

const regressions = current.filter((v) => !baseSet.has(v)); // 新增违规 → 红
const shrunk = baseline.filter((v) => !curSet.has(v)); // 已补全 → 提示收紧

const typeCount = current.filter((v) => v.startsWith("type:")).length;
const propCount = current.length - typeCount;
console.log(`· 扫描 ACTIVE 类型 ${types.filter((t) => (t.status ?? "ACTIVE") === "ACTIVE").length} 个`);
console.log(`· 描述缺失：类型级 ${typeCount} · 属性级 ${propCount}；基线 ${baseline.length}`);
if (shrunk.length) console.log(`· 已补全 ${shrunk.length} 条（可 \`node scripts/check-ontology-descriptions.mjs --update\` 收紧基线）`);

if (regressions.length) {
  console.error("\n✗ 本体描述覆盖率门未通过（新增缺失 → ACTIVE 类型/属性必须带非空 displayName+description）：");
  for (const v of regressions.slice(0, 30)) console.error(`  - ${v}`);
  if (regressions.length > 30) console.error(`  … 共 ${regressions.length} 条`);
  console.error("\n  修法：给对应 ObjectTypeDef/PropertyDef 补 description（及类型 displayName）；描述是能力语义，非可选项。");
  process.exit(1);
}
console.log("\n✓ 本体描述覆盖率门通过（无新增缺失；存量见基线，随补全收窄）。");
