#!/usr/bin/env node
/**
 * 门 `arg-drop-seam:check`（WO-SEAM-ARG-DROP · 接缝丢参门 · 堵死整类 · KILL-MOCK-RED · R6 · 闭本体 §8 G-ARG-DROP-SEAM）：
 *
 * bug 类（危险级·静默给错答案）：`问句 → resolveCeoRoute(args) → fillSlots(只填 intent.slots) → plan {{slots.X}} → solver`。
 *   两放大器相交才成灾：(a) 路由解析了实体但 intent.slotNames 漏声明 → `fillSlots`（slots.ts:307 只迭代 intent.slots）静默丢；
 *   (b) 求解器缺过滤维落"全部/首个/qty=0"默认。(a)×(b) = plausible-but-WRONG（信阳→全12基地 / 敞口→首个客户）。
 *
 * 本门两条断言（守 R-ARG-FIDELITY「路由解析出的过滤实体必达求解器或被显式声明/豁免」）：
 *   ① 数据半（动态·读 agentcore dist 真种子）：每 CEO intent 的「路由可解析过滤实体集」⊆ slotNames ∪ 显式豁免表（EXEMPT）。
 *      并：plan 的 solverArgs 里每个 `{{slots.X}}` 引用的 X 必 ∈ 声明槽（无孤儿模板引用 → 无运行期 TemplateResolutionError）。
 *   ② 引擎半（静态哨兵·读 datacore solver 源）：吃过滤维的求解器缺该维时**报错或显式标 scope**（无静默全部/首个）——
 *      credit_exposure 有 AMBIGUOUS_SCOPE + scope:CUSTOMER/ALL 且**无**首客户静默默认；base_capacity_outlook 缺 baseId throw。
 *
 * green→red 有牙：把某 CEO intent 的 slot 删掉（如 ceo_credit_exposure 去 custName）→ 断言① 红；把 credit_exposure 还原成
 *   `?? customers[0]` 首客户静默默认 → 断言② 红。ROUTER_EMITS 表的单一来源 = `apps/agentcore/src/router/ceo-route.ts`
 *   的 *ArgsFrom / resolveCeoRoute（路由解析出哪些实体·人工派生并在此登记·改路由解析须同步本表）。
 *
 * 用法：node scripts/check-arg-drop-seam.mjs（先 pnpm -r build 或至少 build agentcore）。
 * 本体登记：docs/SYSTEM-ONTOLOGY.md §5 R-ARG-FIDELITY · §7 门 arg-drop-seam:check · §8 G-ARG-DROP-SEAM。
 */
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const abs = (rel) => new URL(rel, root);
const fails = [];
const notes = [];

// ── 依赖：agentcore dist（真种子 + collectSlotRefs 模板扫描器） ──
const distSeed = abs("apps/agentcore/dist/mocks/seed.js");
const distTemplate = abs("apps/agentcore/dist/util/template.js");
for (const [label, u] of [["agentcore/mocks/seed", distSeed], ["agentcore/util/template", distTemplate]]) {
  if (!existsSync(u)) fails.push(`${label} dist 未构建（${u.pathname}）——先 pnpm --filter agentcore build 再跑本门`);
}
if (fails.length) {
  console.error("✗ arg-drop-seam:check 失败（前置）：");
  for (const f of fails) console.error("  - " + f);
  process.exit(1);
}

const { seedIntentsAndPlans } = await import(distSeed.href);
const { collectSlotRefs } = await import(distTemplate.href);

/**
 * 路由可解析的**过滤实体**集（单一来源 = ceo-route.ts *ArgsFrom / resolveCeoRoute）。
 * 只列会 scope 答案的实体键；常量键（mode/targetType/targetProp/topK 由专门映射直接注入·非实体）不列。
 */
const ROUTER_EMITS = {
  ceo_root_cause: ["metricKey", "factorId"],
  ceo_decision: ["metricKey", "factorId"],
  ceo_metric: ["metricKey"],
  ceo_credit_exposure: ["custName"],
  ceo_finance_pnl: ["metricKey"],
  ceo_supply_demand_gap: ["metricKey", "factorId"],
  ceo_atp_check: ["orderRef"],
  ceo_bottleneck: ["baseIds"],
  ceo_base_outlook: ["baseId"],
  ceo_whatif: ["scopeObjectIds", "factors"],
  ceo_capacity_threshold: ["modelId", "weeks"],
};

/**
 * 显式豁免表：路由发但**合法地**不作 slot（求解器全域 by design·无 scope 维 / 或独立未接线 seam）——**每条带理由**（防悄悄豁免真断裂）。
 * 注意：CONFIRMED 项（custName / scopeObjectIds）**绝不**在此——它们必须真进 slotNames，否则门红。
 */
const EXEMPT = {
  ceo_root_cause: {
    factorId: "gap_attribution 读 args.scope.factorId（非顶层）·顶层 factorId 双端未接=独立 seam（NEEDS-CHECK）·缺 metricKey 时诚实默认最严重越线·非静默错答",
  },
  ceo_finance_pnl: {
    metricKey: "financePnl(ctx) 无 args·全公司 P&L·无 scope 过滤维可误默认（SAFE·全域 by design）",
  },
  ceo_supply_demand_gap: {
    factorId: "supply_demand_gap_attribution 全 S&OP 双向归因·不吃 factorId（SAFE·全域 by design）",
  },
};

const { intents, plans } = seedIntentsAndPlans("demo");
const intentByKey = new Map(intents.map((i) => [i.key, i]));
const planById = new Map(plans.map((p) => [p.id, p]));

// ── 断言① 数据半 ──
let ok1 = 0;
for (const [key, emits] of Object.entries(ROUTER_EMITS)) {
  const intent = intentByKey.get(key);
  if (!intent) {
    fails.push(`断言①：CEO intent「${key}」在种子中缺失（ROUTER_EMITS 登记了它却无对口意图 → 路由落空）`);
    continue;
  }
  const slotNames = new Set((intent.slots ?? []).map((s) => s.name));
  const exempt = EXEMPT[key] ?? {};
  // ①a：路由解析实体 ⊆ slotNames ∪ 豁免
  for (const ent of emits) {
    if (slotNames.has(ent)) { ok1++; continue; }
    if (exempt[ent]) { notes.push(`  · 豁免 ${key}.${ent}：${exempt[ent]}`); continue; }
    fails.push(
      `断言①a 丢参接缝：intent「${key}」路由解析出过滤实体「${ent}」，但未声明为 slot（slotNames=[${[...slotNames].join(",")}]）且不在豁免表` +
        ` → fillSlots 会静默丢 → 求解器缺过滤维 → plausible-but-WRONG（G-ARG-DROP-SEAM）。修：seed.ts 补 slotNames + 专门 solverArgs 映射。`,
    );
  }
  // ①b：plan solverArgs 的 {{slots.X}} 引用 ⊆ 声明槽（无孤儿模板引用 → 无运行期 TemplateResolutionError）
  const plan = planById.get(intent.planId);
  if (plan) {
    const invoke = (plan.steps ?? []).find((s) => s.type === "invoke_solver");
    const refs = invoke ? collectSlotRefs(invoke.params?.args ?? {}) : new Set();
    for (const r of refs) {
      if (!slotNames.has(r)) {
        fails.push(
          `断言①b 孤儿模板引用：intent「${key}」plan solverArgs 引用 {{slots.${r}}} 但 ${r} 未声明为 slot` +
            ` → fillSlots 不产出该键 → 运行期 TemplateResolutionError。修：补 slot 声明或改映射。`,
        );
      }
    }
  }
}

// ── 断言② 引擎半（静态哨兵·读 solver 源）──
const extendedSrc = readFileSync(abs("apps/datacore/src/solvers/extended.ts"), "utf8");
const serviceSrc = readFileSync(abs("apps/datacore/src/solvers/service.ts"), "utf8");

/** 取 deriveExtendedArgs 里某 case 块（`case "X": {` 到下一 `case "`）。 */
function caseBlock(src, key) {
  const start = src.indexOf(`case "${key}":`);
  if (start < 0) return "";
  const rest = src.slice(start + 1);
  const next = rest.indexOf('case "');
  return next < 0 ? rest : rest.slice(0, next);
}

const creditBlock = caseBlock(extendedSrc, "credit_exposure");
if (!creditBlock) {
  fails.push("断言②：extended.ts 缺 credit_exposure 分支（deriveExtendedArgs）");
} else {
  if (!creditBlock.includes("AMBIGUOUS_SCOPE"))
    fails.push('断言② 引擎半：credit_exposure 缺 AMBIGUOUS_SCOPE 诚实报错（指定客户无匹配须报错·不静默落首客户）');
  if (!/scope:\s*\{\s*mode:\s*"CUSTOMER"/.test(creditBlock) || !/scope:\s*\{\s*mode:\s*"ALL"/.test(creditBlock))
    fails.push('断言② 引擎半：credit_exposure 缺 scope:{mode:"CUSTOMER"|"ALL"} 显式作用域标（未指定客户须标全域合计·非首客户）');
  // 静默首客户回潮哨兵：`.map(props)[0] ?? {}` 是旧的首客户静默默认惯用法
  if (/customers\s*\?\?\s*\[\]\)\.map\(props\)\[0\]\s*\?\?\s*\{\}/.test(creditBlock) || /\.map\(props\)\[0\]\s*\?\?\s*\{\}/.test(creditBlock))
    fails.push('断言② 引擎半：credit_exposure 检出首客户静默默认惯用法 `.map(props)[0] ?? {}` 回潮（G-ARG-DROP-SEAM 回归）');
}

if (!serviceSrc.includes("base_capacity_outlook 需 baseId"))
  fails.push('断言② 引擎半：base_capacity_outlook 缺「缺 baseId 即 throw」的诚实报错（诚实典范丢失）');

// ── 汇总 ──
if (notes.length) {
  console.log("arg-drop-seam:check · 豁免登记（带理由·非静默丢）：");
  for (const n of notes) console.log(n);
}
if (fails.length) {
  console.error(`\n✗ arg-drop-seam:check 失败（${fails.length}）：`);
  for (const f of fails) console.error("  - " + f);
  process.exit(1);
}
const emitCount = Object.values(ROUTER_EMITS).reduce((a, b) => a + b.length, 0);
console.log(
  `\n✓ arg-drop-seam:check 通过：${Object.keys(ROUTER_EMITS).length} 个 CEO intent · ${emitCount} 条路由解析实体` +
    ` 全部 ⊆ slotNames ∪ 豁免（${ok1} 达标 slot）；plan 无孤儿模板引用；credit_exposure/base_capacity_outlook 求解器诚实化在位。`,
);
