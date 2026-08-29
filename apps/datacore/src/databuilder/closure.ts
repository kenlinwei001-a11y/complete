import type { BuildMode, BuildPlan, ClosureFinding, ClosurePolicy, ClosureReport } from "@platform/contracts";
import { SOLVER_KEYS, SOLVER_OUTPUT_SHAPES } from "../solvers/service.js";
import { checkDomainInvariants } from "./domain-invariants.js";

/** 工作流求解器（非注册求解器，走 /a/v1/sop/*）—— 与 chain:check 口径一致。 */
const WORKFLOW_SOLVERS = new Set(["sop_balance"]);

/**
 * 双向闭包校验器（设计共识见 memory/project_a7_builder_design.md）：
 *  - 反向-对象：孤儿对象（无本体切片/domain）= HARD，必绑，否则 FAILED；
 *  - 反向-data：未被消费字段 = SOFT，默认 PASS_AND_MARK；
 *  - 正向：脚本所需分析（求解器入参 / 规则 scope）依赖字段缺失 = HARD，FAILED。
 *  - CHAIN（R11 全链闭包）：求解器需求必须在 DataCore 注册，否则路径A 全链断(SOLVER_NOT_FOUND)
 *    —— 把 chain:check 的跨系统校验焊进构建发动机的闭包报告，建图时即挡 G-1/G-2 类断点。
 *
 * A18 双模：buildMode=STRICT（默认）维持 HARD 原子闸（缺一环→gatePassed=false→阻断/不写真值）；
 * buildMode=PROVISIONAL 把所有 HARD 失败**降级为 ADVISORY**（severity=ADVISORY），如实记录全部缺口但
 * `blocked=false`（不阻断，守"不靠阻断成 0"）。gatePassed 始终保留"STRICT 口径下是否过"的诚实判定。
 */
export function validateClosure(plan: BuildPlan, policy: ClosurePolicy, buildMode: BuildMode = "STRICT"): ClosureReport {
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

  // ---- E14 域运营本体不变量（数据驱动 RL5）：碎片树（悬空 ref / 无根碎片）= OBJECT/SOFT（ORPHAN_PASSED）----
  // 评审校正：DANGLING_REF 与 ORPHAN_NO_ROOT 均 SOFT surface 进 GapReport（非静默），但**不 HARD 阻断**——
  // 合法最小域（LLM 只产 Proc+Ord、不建全工厂）是可建的，"无根/悬空"是"倒推或不完整"的 advisory 信号、非误杀理由。
  for (const f of checkDomainInvariants(plan)) findings.push(f);

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

  // ---- SHAPE（R11 渲染契约 · BuildPlan 扩 AgentCore 渲染栈）：渲染绑定字段必须在求解器输出形状 ----
  // 把"求解器算得出、渲染取不到"(G-2 跨服务形状/"绿测试≠能用")挡在建图期。
  let shapeBroken = 0;
  for (const s of plan.solverNeeds) {
    const bindings = s.renderBindings ?? [];
    if (bindings.length === 0) continue;
    const shape = SOLVER_OUTPUT_SHAPES[s.solverKey];
    if (!shape) {
      // 输出形状未声明 → 无法校验，放行并标记（渐进补齐，不阻塞）。
      findings.push({ kind: "SHAPE", ref: `solver:${s.solverKey}`, status: "ORPHAN_PASSED", detail: "求解器输出形状未声明（跳过 SHAPE）" });
      continue;
    }
    const known = new Set(shape);
    for (const b of bindings) {
      const top = b.split(".")[0]!.split("[")[0]!; // 顶层 output key
      const ref = `${s.solverKey}.output.${b}`;
      if (known.has(top)) {
        findings.push({ kind: "SHAPE", ref, status: "BOUND" });
      } else {
        shapeBroken++;
        findings.push({ kind: "SHAPE", ref, status: "FAILED", detail: `渲染绑定 '${top}' 不在求解器输出形状（G-2 跨服务形状断）` });
      }
    }
  }

  const hasObjectFail = findings.some((f) => f.kind === "OBJECT" && f.status === "FAILED");
  const hasDataFail = findings.some((f) => f.kind === "DATA" && f.status === "FAILED");
  // gatePassed = STRICT 口径下是否过（诚实保留，不随 buildMode 变）。
  const gatePassed = !hasObjectFail && !hasDataFail && forwardMissing === 0 && chainBroken === 0 && shapeBroken === 0;

  // A18 双模：PROVISIONAL 把所有 FAILED/MISSING 降级 ADVISORY（如实记录、不阻断）；STRICT 维持 HARD 阻断。
  let advisoryCount = 0;
  if (buildMode === "PROVISIONAL") {
    for (const f of findings) {
      if (f.status === "FAILED" || f.status === "MISSING") {
        f.severity = "ADVISORY";
        advisoryCount++;
      }
    }
  }
  const blocked = buildMode === "STRICT" ? !gatePassed : false;

  return { gatePassed, findings, objectsBound, dataOrphans, forwardMissing, chainBroken, shapeBroken, buildMode, advisoryCount, blocked };
}
