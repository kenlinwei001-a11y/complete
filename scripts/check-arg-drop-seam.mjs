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
 *      credit_exposure 有 AMBIGUOUS_SCOPE + scope:CUSTOMER/ALL 且**无**首客户静默默认；base_capacity_outlook 缺 baseId throw
 *      **且经 normalizeBaseRef 归一**（症②b·此前只断言 throw 不断言归一 → 门恒绿而 obj_base_<id> 硬 404 的盲区）。
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

// ── 断言①·base 族（WO-BASE-ID-FIDELITY·project/QOS 吃 base 作用域维的意图）──
// bug 类同源（G-ARG-DROP-SEAM·base 族）：路由可解析 base（sim-planner parseCapacityFeasibilityVariant「XX基地」/ 分类器 /
//   选中基地 / PageContext.focus.base）→ 若 base 未声明为 slot 或 plan 未透传 → fillSlots 静默丢 → 求解器恒全网/首基地
//   （capacity_forecast「常州基地 4680 加20%」与「4680 加20%」答案相同·affected_orders 缺 base 全域）。
// 断言：每「吃 base 维」intent 的 base ∈ slotNames ∪ base ∈ plan 任一步的 {{slots.base…}} 引用（声明⊕透传双半齐·任缺即静默丢）。
const PROJECT_BASE_EMITS = {
  capacity_feasibility: ["base"], // WO-BASE-ID-FIDELITY 症①（本单补 base 槽 + 专门 solverArgs 透传）
  affected_orders: ["base"], // 既有 objectRef base 槽（受影响订单限基地）
  risk_root_cause: ["base"], // 既有 base 槽（基地风险画像）
  adopt_mitigation: ["base"], // 既有 base 槽（处置方案落基地）
};
let okBase = 0;
for (const [key, emits] of Object.entries(PROJECT_BASE_EMITS)) {
  const intent = intentByKey.get(key);
  if (!intent) {
    fails.push(`断言①·base族：project intent「${key}」在种子中缺失（PROJECT_BASE_EMITS 登记却无对口意图）`);
    continue;
  }
  const slotNames = new Set((intent.slots ?? []).map((s) => s.name));
  const plan = planById.get(intent.planId);
  // 全步扫描 {{slots.X}} 引用（base 可经 invoke_solver args / resolve_slice args / evaluate_rules|create_action_draft payload 透传）。
  const planRefs = plan ? collectSlotRefs(plan.steps ?? []) : new Set();
  for (const ent of emits) {
    if (!slotNames.has(ent)) {
      fails.push(
        `断言①·base族 丢参接缝：project intent「${key}」吃 base 维但未声明 slot「${ent}」(slotNames=[${[...slotNames].join(",")}])` +
          ` → fillSlots 静默丢 base → 求解器恒全网/首基地（G-ARG-DROP-SEAM·base 族）。修：seed.ts 补 base 槽。`,
      );
      continue;
    }
    if (!planRefs.has(ent)) {
      fails.push(
        `断言①·base族 断透传：project intent「${key}」声明了 slot「${ent}」但 plan 任一步都未引用 {{slots.${ent}…}}` +
          ` → base 声明了却没进 solverArgs → 仍静默丢。修：plan 步 args/payload 补 base 映射。`,
      );
      continue;
    }
    okBase++;
  }
}

// ── 断言② 引擎半（静态哨兵·读 solver 源）──
const extendedSrc = readFileSync(abs("apps/datacore/src/solvers/extended.ts"), "utf8");
const serviceSrc = readFileSync(abs("apps/datacore/src/solvers/service.ts"), "utf8");
const capacitySrc = readFileSync(abs("apps/datacore/src/solvers/capacity.ts"), "utf8");
const riskSrc = readFileSync(abs("apps/datacore/src/solvers/risk.ts"), "utf8");

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

// 症②b（门盲区补·WO-BASE-ID-FIDELITY）：base_capacity_outlook 此前只断言「缺 baseId 会 throw」，对「是否归一」零断言 →
//   门恒绿而 bug 活着：它是唯一自写一套「只认 baseId|中文名」归一的 base 族求解器，不认 `obj_base_<id>`（synthetic 图节点 id
//   ＝ 前端地理地图选中态写入的真对象 id）→ 同页同选中对象，问「未来 90 天产能够不够」硬 404、问「瓶颈卡哪道工序」
//   （bottleneck_matrix 已归一）却正常。哨兵：该求解器体内必须出现 normalizeBaseRef（复用单一出处·勿另起词表）。
{
  const outlookStart = serviceSrc.indexOf("private async baseCapacityOutlook");
  if (outlookStart < 0) {
    fails.push("断言②·base族 引擎半：service.ts 缺 baseCapacityOutlook 方法（base_capacity_outlook 引擎半消失）");
  } else {
    // 方法体 = 声明起至下一个 `private async ` / `async ` 方法声明（足够覆盖该求解器且不误吞邻居）。
    const rest = serviceSrc.slice(outlookStart + 1);
    const nextDecl = rest.search(/\n {2}(private |protected |public )?(async )?[A-Za-z_$][\w$]*\(/);
    const outlookBlock = nextDecl < 0 ? rest : rest.slice(0, nextDecl);
    if (!/normalizeBaseRef\s*\(\s*args\.baseId\s*\)/.test(outlookBlock))
      fails.push(
        '断言②·base族 引擎半：base_capacity_outlook 未经 normalizeBaseRef 归一 baseId（症②b：回潮成 str(args.baseId) 裸匹配' +
          ' → 前端选中态 `obj_base_<id>` 硬 404 `Base obj_base_changzhou`，而同页 bottleneck_matrix 正常 → 一通一炸）。' +
          '修：service.ts baseCapacityOutlook 复用单一出处 types.normalizeBaseRef（勿另起一套 baseId|中文名 词表）。',
      );
  }
}

// ── 断言②·base 族引擎半（静态哨兵·WO-BASE-ID-FIDELITY 三症·删则红）──
// 症① capacity_forecast：给 base → 收窄该基地 scope:"BASE"；无 base → scope:"ALL" 诚实标（无静默全网冒充某基地）。
if (!/scope:\s*"BASE"/.test(capacitySrc) || !/scope:\s*"ALL"/.test(capacitySrc))
  fails.push('断言②·base族 引擎半：capacity.ts 缺 base 作用域诚实标（scope:"BASE"|"ALL"）——症①：删则「常州基地 X 加20%」静默冒充「X 加20%（全网）」');
// 症① base 归一复用单一出处（capacity.ts 不另起规范化·复用 risk.resolveBaseId）。
if (!/resolveBaseId\(c,\s*args\.base\)/.test(capacitySrc))
  fails.push('断言②·base族 引擎半：capacity.ts 未经 resolveBaseId 归一 base（症①/②同源单一规范化出处·勿散落）');
// 症② resolveBaseId 经 normalizeBaseRef 归一（认 obj_base_<id> 图节点 id）——回潮成裸 find(baseId===ref) 即 obj_base_ 硬 400。
if (!/normalizeBaseRef/.test(riskSrc))
  fails.push('断言②·base族 引擎半：risk.ts resolveBaseId 未经 normalizeBaseRef 归一（症②：obj_base_<id> 不 strip → unknown base 硬 400）');

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
const baseEmitCount = Object.values(PROJECT_BASE_EMITS).reduce((a, b) => a + b.length, 0);
console.log(
  `\n✓ arg-drop-seam:check 通过：${Object.keys(ROUTER_EMITS).length} 个 CEO intent · ${emitCount} 条路由解析实体` +
    ` 全部 ⊆ slotNames ∪ 豁免（${ok1} 达标 slot）；plan 无孤儿模板引用；credit_exposure/base_capacity_outlook 求解器诚实化在位。` +
    `\n  base 族（WO-BASE-ID-FIDELITY）：${Object.keys(PROJECT_BASE_EMITS).length} 个吃 base 维 project intent · ${baseEmitCount} 条 base 声明⊕透传齐（${okBase} 达标）；` +
    `capacity_forecast scope:"BASE"|"ALL" 诚实标 · risk.resolveBaseId 与 base_capacity_outlook 均经 normalizeBaseRef 归一（obj_base_<id> strip·单一出处）。`,
);
