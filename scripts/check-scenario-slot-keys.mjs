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
  console.error(`⛔ check-scenario-slot-keys.mjs 未预期异常（${e?.message || e}）⇒ **工具坏了，不是代码坏了**。`);
  console.error("   本次结论作废：**不许**读作「代码干净 / 无违规 / 通过」——本门这次没跑完，它什么都没证明。");
  console.error("   " + String(e?.stack || "").split("\n").slice(1, 4).join("\n   "));
  process.exit(2); // 2 = 工具自己坏了（1 留给主判据明确判负那一条路径，两者处置相反，不许合并）
}


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

/**
 * 场景 preset 常见旧键名 → 意图槽正式名。
 *
 * ★ WO-DERIVED-INTENT-SLOT-DEAF：这张表是**回落**，不是**改写** —— 见下方 `resolveKey`。
 *   本表成文时，会声明槽位的只有 4 个原生意图（槽名 `model`/`base`，preset 却写 `modelId`/`baseId`），
 *   所以「见到 modelId 就当 model」当时恒对。本单把 16 个派生意图的槽位从**求解器已声明的入参**派生后，
 *   槽名就**等于**求解器入参名（`carbon_q` 的槽确实叫 `modelId`/`baseName`——因为 `carbon_footprint`
 *   读的就是 `args.modelId`/`args.baseName`）。此时无条件改写会把**精确命中**的键改成一个不存在的槽名，
 *   门反过来误杀正确接线。规则改为：**精确命中优先，别名只在精确不命中时兜底**（判据更严，不是放宽）。
 */
const ALIASES = { modelId: "model", baseId: "base", baseName: "base" };

/** 精确命中优先；否则走旧键名别名（两边都不命中时原样返回，交下面报失败）。 */
const resolveKey = (rawKey, slotNames) => (slotNames.has(rawKey) ? rawKey : (ALIASES[rawKey] ?? rawKey));

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
    const key = resolveKey(rawKey, slotNames);
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
