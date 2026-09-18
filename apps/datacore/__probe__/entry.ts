// Probe: dump every demo propagation rule's effective coefficient + routing facts.
// Used to compare canonical vs branch WITHOUT string-counting (铁律 0.6 第 6 条).
import { demoPropagationRulesWithDomain } from "../src/seed.js";

const rules = demoPropagationRulesWithDomain();
const out = rules.map((r: any) => ({
  key: r.key,
  coefficient: r.coefficient,
  coefficientRef: r.coefficientRef ? `${r.coefficientRef.ruleKey}.${r.coefficientRef.paramKey}` : null,
  sourceTypeKey: r.sourceTypeKey,
  sourceStateVar: r.sourceStateVar,
  targetTypeKey: r.targetTypeKey,
  targetStateVar: r.targetStateVar,
  weightRef: r.weightRef ? JSON.stringify(r.weightRef) : null,
  viaLinkKey: r.viaLinkKey,
  delayTicks: r.delayTicks,
  combine: r.combine,
}));
// eslint-disable-next-line no-console
console.log("__PROBE_JSON__" + JSON.stringify({ count: out.length, rules: out }));
