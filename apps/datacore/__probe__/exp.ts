// 对照实验（铁律 1.5 判据一）：
//   ① 单源还在：改 C36.params 某条边的值 ⇒ 该边传导量按比例变，同轮其余边逐字节不动。
//   ② 反向金丝雀：摘掉该边的 coefficientRef ⇒ 改同一个参数，它必须一位不动。
import { demoPropagationRulesWithDomain } from "../src/seed.js";
import { PROPAGATION_COEF_PARAMS, STATE_VAR_DOMAINS } from "../src/synthetic/battery.js";
import { propagateTick, pairWeightKey, type PropagationGraph } from "../src/sim/propagation.js";

const rules = demoPropagationRulesWithDomain().map((r) => ({ ...r, tenantId: "demo" })) as any[];

// 每条规则一对专属对象 + 一条专属链路实例，状态量全部置 50。
const objects: { id: string; typeKey: string }[] = [];
const links: { fromId: string; toId: string; linkKey: string }[] = [];
const state: Record<string, Record<string, number>> = {};
const SEEDVAL = 50;
for (const r of rules) {
  const s = `src__${r.key}`, d = `dst__${r.key}`;
  objects.push({ id: s, typeKey: r.sourceTypeKey }, { id: d, typeKey: r.targetTypeKey });
  links.push({ fromId: s, toId: d, linkKey: r.viaLinkKey });
  state[s] = { ...(state[s] ?? {}), [r.sourceStateVar]: SEEDVAL };
  state[d] = { ...(state[d] ?? {}), [r.targetStateVar]: SEEDVAL };
}
const graph: PropagationGraph = { objects, links };

// 声明了分摊口径的边，没有权重表就会**诚实缺席**（UnresolvedPairWeight/NO_WEIGHTS）——
// 那正是第一版实验里 34 条边一条没触发、把「目标边没动」读成绿的原因。每对给 1.0。
const pairWeights: Record<string, Record<string, number>> = {};
for (const r of rules) {
  if (!r.weightRef) continue;
  pairWeights[r.key] = { [pairWeightKey(`src__${r.key}`, `dst__${r.key}`)]: 1 };
}

function runOnce(params: Record<string, number>, ruleSet: any[]): Map<string, number> {
  const out = propagateTick(
    graph, state as any, ruleSet as any, [], 0,
    { C36: params } as any, {}, [], pairWeights as any, STATE_VAR_DOMAINS as any,
  );
  const m = new Map<string, number>();
  for (const t of out.trace) m.set(`${t.ruleKey}|${t.fromObjectId}|${t.toObjectId}`, t.amount);
  return m;
}

const TARGET = process.argv[2] ?? "demo_material_price_to_model_cost";
const base = runOnce(PROPAGATION_COEF_PARAMS, rules);

// ① 把目标边的参数改成 1/10
const scaled = { ...PROPAGATION_COEF_PARAMS, [TARGET]: PROPAGATION_COEF_PARAMS[TARGET]! * 0.1 };
const after = runOnce(scaled, rules);

// ② 反向金丝雀：同样的参数改动，但把该边的 coefficientRef 摘掉（回落到内联 coefficient）
const stripped = rules.map((r) => (r.key === TARGET ? { ...r, coefficientRef: null } : r));
const baseNoRef = runOnce(PROPAGATION_COEF_PARAMS, stripped);
const afterNoRef = runOnce(scaled, stripped);

const fmt = (m: Map<string, number>, k: string) => (m.has(k) ? String(m.get(k)) : "—(本拍未触发)");
const keysOfTarget = [...base.keys()].filter((k) => k.startsWith(TARGET + "|"));

const fired = new Set([...base.keys()].map((k) => k.split("|")[0]));
const notFired = rules.filter((r) => !fired.has(r.key)).map((r) => ({
  key: r.key, via: r.viaLinkKey, delay: r.delayTicks, combine: r.combine,
  reaction: r.reaction ? "REACTION" : null, coef: r.coefficient,
  src: `${r.sourceTypeKey}.${r.sourceStateVar}`, dst: `${r.targetTypeKey}.${r.targetStateVar}`,
}));
console.log("__DIAG__" + JSON.stringify({ firedRules: fired.size, notFired }));

console.log("__EXP__" + JSON.stringify({
  target: TARGET,
  c36Before: PROPAGATION_COEF_PARAMS[TARGET],
  c36After: scaled[TARGET],
  traceRows: base.size,
  targetKeys: keysOfTarget,
  targetBefore: keysOfTarget.map((k) => fmt(base, k)),
  targetAfter: keysOfTarget.map((k) => fmt(after, k)),
  // 同轮其余边：逐条比对
  othersMoved: [...base.keys()].filter((k) => !k.startsWith(TARGET + "|") && base.get(k) !== after.get(k))
    .map((k) => ({ k, before: base.get(k), after: after.get(k) })),
  othersTotal: [...base.keys()].filter((k) => !k.startsWith(TARGET + "|")).length,
  // 反向金丝雀
  noRefBefore: keysOfTarget.map((k) => fmt(baseNoRef, k)),
  noRefAfter: keysOfTarget.map((k) => fmt(afterNoRef, k)),
  noRefMoved: keysOfTarget.some((k) => baseNoRef.get(k) !== afterNoRef.get(k)),
}));
