import type { BuildPlan, ClosureFinding, ClosurePolicy, ClosureReport } from "@platform/contracts";
import { SOLVER_KEYS } from "../solvers/service.js";

/** 工作流求解器（非注册求解器，走 /a/v1/sop/*）—— 与 chain:check 口径一致。 */
const WORKFLOW_SOLVERS = new Set(["sop_balance"]);

/**
 * 双向闭包校验器（设计共识见 memory/project_a7_builder_design.md）：
 *  - 反向-对象：孤儿对象（无本体切片/domain）= HARD，必绑，否则 FAILED；
 *  - 反向-data：未被消费字段 = SOFT，默认 PASS_AND_MARK；
 *  - 正向：脚本所需分析（求解器入参 / 规则 scope）依赖字段缺失 = HARD，FAILED。
 *  - CHAIN（R11 全链闭包）：求解器需求必须在 DataCore 注册，否则路径A 全链断(SOLVER_NOT_FOUND)
 *    —— 把 chain:check 的跨系统校验焊进构建发动机的闭包报告，建图时即挡 G-1/G-2 类断点。
 */
export function validateClosure(plan: BuildPlan, policy: ClosurePolicy): ClosureReport {
  const findings: ClosureFinding[] = [];
  const typeByKey = new Map(plan.objectTypes.map((t) => [t.typeKey, t]));

  // ---- 反向-对象：每个对象类型必须落在某个本体切片（domain）----
  let objectsBound = 0;
  for (const t of plan.objectTypes) {
    const sliced = !!t.domain && t.domain !== "unassigned";
    if (sliced) {
      objectsBound++;
      findings.push({ kind: "OBJECT", ref: t.typeKey, status: "BOUND", detail: `domain=${t.domain}` });
    } else if (policy.object.mode === "HARD") {
      findings.push({ kind: "OBJECT", ref: t.typeKey, status: "FAILED", detail: "对象未落本体切片（domain 缺失）" });
    } else {
      findings.push({ kind: "OBJECT", ref: t.typeKey, status: "ORPHAN_PASSED", detail: "domain 缺失（SOFT 放行）" });
    }
  }

  // ---- 反向-data：字段是否被消费（映射进对象属性 / 规则操作数 / 求解器入参）----
  const consumedFields = new Set<string>();
  for (const t of plan.objectTypes) {
    for (const p of t.properties) if (p.sourceField) consumedFields.add(`${t.sourceDataset ?? ""}.${p.sourceField}`);
  }
  // 规则表达式里出现的 Type.prop → 标记该 prop 对应的源字段被消费。
  const ruleRefs = new Set<string>();
  for (const r of plan.rules) {
    const m = r.expression.match(/[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    for (const ref of m) ruleRefs.add(ref);
  }
  let dataOrphans = 0;
  for (const ds of plan.dataSources) {
    for (const f of ds.fields) {
      const mappedKey = `${ds.datasetKey}.${f.name}`;
      const t = plan.objectTypes.find((x) => x.sourceDataset === ds.datasetKey);
      const propConsumed = consumedFields.has(mappedKey);
      const ruleConsumed = t ? ruleRefs.has(`${t.typeKey}.${f.name}`) : false;
      const solverConsumed = t
        ? plan.solverNeeds.some((s) => s.inputFields.some((inp) => inp.typeKey === t.typeKey && inp.propKey === f.name))
        : false;
      if (propConsumed || ruleConsumed || solverConsumed) {
        findings.push({ kind: "DATA", ref: mappedKey, status: "BOUND" });
      } else if (policy.data.onOrphan === "DROP") {
        dataOrphans++;
        findings.push({ kind: "DATA", ref: mappedKey, status: "DROPPED", detail: "孤儿字段已删" });
      } else if (policy.data.onOrphan === "FAIL" || policy.data.mode === "HARD") {
        dataOrphans++;
        findings.push({ kind: "DATA", ref: mappedKey, status: "FAILED", detail: "孤儿字段（HARD）" });
      } else {
        dataOrphans++;
        findings.push({ kind: "DATA", ref: mappedKey, status: "ORPHAN_PASSED", detail: "无下游消费（SOFT 放行）" });
      }
    }
  }

  // ---- 正向：求解器入参依赖的字段必须真实存在于对象类型属性中 ----
  let forwardMissing = 0;
  const propExists = (typeKey: string, propKey: string): boolean => {
    const t = typeByKey.get(typeKey);
    return !!t && t.properties.some((p) => p.propKey === propKey);
  };
  for (const s of plan.solverNeeds) {
    for (const inp of s.inputFields) {
      const ref = `${s.solverKey}:${inp.typeKey}.${inp.propKey}`;
      if (propExists(inp.typeKey, inp.propKey)) {
        findings.push({ kind: "FORWARD", ref, status: "BOUND" });
      } else if (policy.forward.mode === "HARD") {
        forwardMissing++;
        findings.push({ kind: "FORWARD", ref, status: "MISSING", detail: "求解器依赖字段缺失（HARD）" });
      } else {
        findings.push({ kind: "FORWARD", ref, status: "ORPHAN_PASSED", detail: "依赖缺失（SOFT 放行）" });
      }
    }
  }
  // 规则 scope 类型必须存在（正向）。
  for (const r of plan.rules) {
    for (const t of r.scopeObjectTypes) {
      const ref = `rule:${r.key}->${t}`;
      if (typeByKey.has(t)) {
        findings.push({ kind: "FORWARD", ref, status: "BOUND" });
      } else if (policy.forward.mode === "HARD") {
        forwardMissing++;
        findings.push({ kind: "FORWARD", ref, status: "MISSING", detail: "规则 scope 类型缺失（HARD）" });
      } else {
        findings.push({ kind: "FORWARD", ref, status: "ORPHAN_PASSED" });
      }
    }
  }

  // ---- CHAIN（R11 全链闭包）：求解器需求必须在 DataCore 注册（焊进 chain:check）----
  let chainBroken = 0;
  const registered = new Set<string>(SOLVER_KEYS as readonly string[]);
  const seenSolvers = new Set<string>();
  for (const s of plan.solverNeeds) {
    if (seenSolvers.has(s.solverKey)) continue;
    seenSolvers.add(s.solverKey);
    const ref = `solver:${s.solverKey}`;
    if (WORKFLOW_SOLVERS.has(s.solverKey) || registered.has(s.solverKey)) {
      findings.push({ kind: "CHAIN", ref, status: "BOUND" });
    } else {
      chainBroken++;
      findings.push({ kind: "CHAIN", ref, status: "FAILED", detail: "求解器未在 DataCore 注册 → 路径A 全链断(SOLVER_NOT_FOUND)" });
    }
  }

  const hasObjectFail = findings.some((f) => f.kind === "OBJECT" && f.status === "FAILED");
  const hasDataFail = findings.some((f) => f.kind === "DATA" && f.status === "FAILED");
  const gatePassed = !hasObjectFail && !hasDataFail && forwardMissing === 0 && chainBroken === 0;

  return { gatePassed, findings, objectsBound, dataOrphans, forwardMissing, chainBroken };
}
