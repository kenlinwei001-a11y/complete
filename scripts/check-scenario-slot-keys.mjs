#!/usr/bin/env node
/**
 * 门 `scenario-slot-keys:check`（WO-SCENARIO-INPUT-PHASE0 · 场景卡 slotPresets 键名一致性门）。
 *
 * 断言：每张场景卡 presetContext.slotPresets 的键必须是其声明意图 slots.name 的子集。
 * 作用：堵死「 preset 用 modelId/baseId 但意图槽名是 model/base → 静默丢槽 →  fallback 默认 6 周」类 bug。
 *
 * 依赖：agentcore dist（SCENARIO_CATALOG + seedIntentsAndPlans）。
 * 用法：node scripts/check-scenario-slot-keys.mjs（先 pnpm --filter agentcore build）。
 */
import { existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const abs = (rel) => new URL(rel, root);
const fails = [];
const notes = [];

const distCatalog = abs("apps/agentcore/dist/scenarios-catalog.js");
const distSeed = abs("apps/agentcore/dist/mocks/seed.js");
for (const [label, u] of [
  ["agentcore/scenarios-catalog", distCatalog],
  ["agentcore/mocks/seed", distSeed],
]) {
  if (!existsSync(u)) {
    console.error(`✗ ${label} dist 未构建（${u.pathname}）——先 pnpm --filter agentcore build 再跑本门`);
    process.exit(1);
  }
}

const { SCENARIO_CATALOG } = await import(distCatalog.href);
const { seedIntentsAndPlans } = await import(distSeed.href);
const { intents } = seedIntentsAndPlans();

const intentSlotNames = new Map();
for (const intent of intents) {
  intentSlotNames.set(intent.key, new Set((intent.slots ?? []).map((s) => s.name)));
}

/** 场景 preset 常见旧键名 → 意图槽正式名。 */
const ALIASES = { modelId: "model", baseId: "base", baseName: "base" };

let checked = 0;
for (const card of SCENARIO_CATALOG) {
  const slotNames = intentSlotNames.get(card.intentKey);
  if (!slotNames) {
    notes.push(`${card.sNo} 意图 ${card.intentKey} 不在种子 intents 中，跳过键名检查`);
    continue;
  }
  // WO-SCENARIO-INPUT-PHASE0：只约束**声明了槽位**的意图。自动生成的意图 slots=[] 时，
  // preset 直接透传给 solver，不做槽名一致性断言（否则大量合法场景卡被误杀）。
  if (slotNames.size === 0) {
    notes.push(`${card.sNo} 意图 ${card.intentKey} 未声明槽位，跳过键名检查`);
    continue;
  }
  checked++;
  const presets = card.presetContext?.slotPresets ?? {};
  for (const rawKey of Object.keys(presets)) {
    const key = ALIASES[rawKey] ?? rawKey;
    if (!slotNames.has(key)) {
      fails.push(`${card.sNo}（${card.intentKey}）slotPresets 含未声明键「${rawKey}」→ 不在意图槽 [${[...slotNames].join(", ")}] 中`);
    }
  }
}

if (notes.length) {
  console.log("ℹ 备注:");
  for (const n of notes) console.log("  - " + n);
}
if (fails.length) {
  console.error("✗ scenario-slot-keys:check 失败:");
  for (const f of fails) console.error("  - " + f);
  process.exit(1);
}
console.log(`✓ scenario-slot-keys:check 通过（检查 ${checked} 张场景卡）`);
