import { requiredArgKeys, solverArgsSchema, type ComposePlan, type ComposeStep, type ComposeCompileResult } from "@platform/contracts";
import type { NavigationSlice } from "../agent/navigation-slice.js";

/**
 * WO-Phase2-C · 组合路径编译器（compileSolverPlan·纯函数 R6·消费 dev 地基 SOLVER_ARGS_SCHEMAS）。
 *
 * 定位（orchestrator §0）：path-A（单 solver 命中·秒答）与 path-B（runAgentLoop ReAct·真开放题）之间的中间路径——
 * 导航图里有**多个对口 solver 且可串**时，编译成 `ComposePlan` 服务端执行（各步 invoke_solver·LLM 只综合一次）。
 * 编不出合法计划 → `{ok:false, fallback:"react", why}`（结构化 why·点名哪个 solver 哪个 required arg 从哪填不上）。
 *
 * 纯函数（R6·无 LLM/时钟/随机）：同 (query, navSlice, slots) → 同 CompileResult（稳定 solverKey 序）。
 */

/**
 * 退化单步表（覆盖层 §3.1.6·防双算）：`{ 下游: [被其内部已自调/等价的上游…] }`。
 * 某 solver 入选时，其列出的「内部已含」solver **不再拉成前置步**（避免双算 + 二次编排）。
 *  - sop_reschedule 内部已按型号可产基地跑等价 capacity_forecast（freeDaily 产能核算）→ 单步 sop_reschedule。
 */
export const COMPOSE_SELF_SUFFICIENT: Record<string, string[]> = {
  sop_reschedule: ["capacity_forecast"],
};

/**
 * 语义接线表（上游输出字段 → 可填的下游 arg）：动态入参「输出接输入」的类型/语义匹配依据（R6 确定·非 LLM 猜）。
 * 只登记语义明确的匹配（型号/订单/基地/指标）；未登记的 arg 不做动态接线（宁回退不猜·KILL-MOCK-RED）。
 * 键 = 下游 arg 名；值 = 上游 SOLVER_OUTPUT_SHAPES 里可作来源的顶层输出字段名（按序优先）。
 */
const SEMANTIC_ARG_SOURCES: Record<string, string[]> = {
  metricKey: ["rootMetric", "metrics", "metricKey"],
  modelId: ["modelId", "byModel"],
  baseId: ["baseId", "base"],
  orderRef: ["orderRef", "displaced"],
  so: ["orderRef", "displaced"],
  targetOrderId: ["targetOrder", "displaced"],
};

/** 从上游候选（已入选步）里找能填 arg 的输出字段：返回 {fromStep, outputPath} 或 undefined。 */
function findUpstreamSource(
  arg: string,
  selected: { step: ComposeStep; outputShape: string[] }[],
): { fromStep: string; outputPath: string } | undefined {
  const sources = SEMANTIC_ARG_SOURCES[arg];
  if (!sources) return undefined;
  for (const up of selected) {
    for (const src of sources) {
      if (up.outputShape.includes(src)) return { fromStep: up.step.stepId, outputPath: src };
    }
  }
  return undefined;
}

export interface CompileSlots {
  /** 静态可填入参（从问句/domainResolve.args/PageContext.focus 派生·值非空即视为可填该 arg）。 */
  [k: string]: unknown;
}

/**
 * 编译组合计划。navSlice.solvers = 已按问句投影的对口 solver（key + outputShape）；slots = 静态可填入参。
 * 算法（契约 §2）：候选 → 退化单步过滤 → 逐 required arg 静态/动态填 → 建 DAG 拓扑分组 → 出计划或 fallback。
 */
export function compileSolverPlan(query: string, navSlice: NavigationSlice, slots: CompileSlots): ComposeCompileResult {
  // 候选：导航图里的 solver，且**已登记 args schema**（未登记 = 输入模式未知 → 不能派生·不臆造映射）。稳定序。
  const candidates = navSlice.solvers
    .filter((s) => solverArgsSchema(s.key) !== undefined)
    .map((s) => ({ key: s.key, outputShape: s.outputShape }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  if (candidates.length === 0) {
    return { ok: false, fallback: "react", why: `compile-miss: 导航图无已登记 args schema 的对口 solver（无候选）→ fallback react` };
  }

  // 退化单步（§3.1.6）：入选集里某 solver 的「内部已含」上游从候选剔除（防双算）。
  const candKeys = new Set(candidates.map((c) => c.key));
  const suppressed = new Set<string>();
  for (const c of candidates) {
    for (const sub of COMPOSE_SELF_SUFFICIENT[c.key] ?? []) {
      if (candKeys.has(sub)) suppressed.add(sub);
    }
  }
  const active = candidates.filter((c) => !suppressed.has(c.key));

  // 逐候选按序编排：先能纯静态满足的（无依赖·parallelGroup 待定）入选为上游，再让其余从已入选上游动态接线。
  // 两趟：① 静态可满足的先入选（含无必填的）② 其余尝试动态接线到已入选上游。
  const selected: { step: ComposeStep; outputShape: string[] }[] = [];
  const pending = [...active];

  const tryPlace = (c: { key: string; outputShape: string[] }): { placed: boolean; why?: string } => {
    const req = requiredArgKeys(c.key);
    const args: Record<string, unknown> = {};
    const argsFrom: ComposeStep["argsFrom"] = [];
    const triedUpstream: string[] = [];
    for (const arg of req) {
      // a. 静态：从 slots 派生。
      if (slots[arg] != null) {
        args[arg] = slots[arg];
        continue;
      }
      // b. 动态：从已入选上游输出接线。
      const up = findUpstreamSource(arg, selected);
      if (up) {
        argsFrom.push({ fromStep: up.fromStep, outputPath: up.outputPath, toArg: arg });
        continue;
      }
      // c. 都填不上 → 该 solver 本轮不可入选。
      triedUpstream.push(...selected.map((s) => s.step.solverKey));
      return {
        placed: false,
        why: `compile-miss: solver=${c.key} requiredArg=${arg} · 静态(问句/slots)无 · 上游输出无匹配(${[...new Set(triedUpstream)].join("|") || "无候选"}) → fallback react`,
      };
    }
    // 静态入参再补：非必填但 slots 有值的也带上（不影响可满足性）。
    for (const [k, v] of Object.entries(slots)) if (v != null && !(k in args)) args[k] = v;
    const step: ComposeStep = {
      stepId: `s${selected.length + 1}`,
      solverKey: c.key,
      parallelGroup: argsFrom.length > 0 ? 1 : 0, // 有上游依赖 → 后组；否则首组（拓扑在下方 recompute）
      args,
      argsFrom,
      reads: [],
    };
    selected.push({ step, outputShape: c.outputShape });
    return { placed: true };
  };

  // 定点迭代：反复扫 pending，凡能 place 的就入选（让后续能接线到新入选上游），直到无进展。
  let lastWhy: string | undefined;
  for (let guard = 0; guard < active.length + 1; guard++) {
    let progressed = false;
    for (let i = pending.length - 1; i >= 0; i--) {
      const r = tryPlace(pending[i]!);
      if (r.placed) {
        pending.splice(i, 1);
        progressed = true;
      } else {
        lastWhy = r.why;
      }
    }
    if (pending.length === 0 || !progressed) break;
  }

  if (selected.length === 0) {
    return { ok: false, fallback: "react", why: lastWhy ?? `compile-miss: 无可满足输入模式的 solver → fallback react` };
  }

  // 拓扑分组：无 argsFrom = group 0；有依赖 = max(上游 group)+1（环不会出现·仅接线到已入选上游）。
  const groupOf = new Map<string, number>();
  for (const { step } of selected) {
    const g = step.argsFrom.length === 0 ? 0 : Math.max(...step.argsFrom.map((f) => (groupOf.get(f.fromStep) ?? 0) + 1));
    groupOf.set(step.stepId, g);
    step.parallelGroup = g;
  }

  const plan: ComposePlan = {
    planId: `compose_${candidates.map((c) => c.key).join("-")}`,
    steps: selected.map((s) => s.step),
    synthesizeBlocks: navSlice.primarySolver === "decision_play" ? ["根因", "方案"] : ["根因", "台账"],
  };
  return { ok: true, plan };
}

// ---------------------------------------------------------------------------
// WO-DRIL-P3 · Compose 路径消费 DRIL 资源包（PRD §8.2·additive·不改 compileSolverPlan 语义）。
// ResourceRouter.buildResourcePackage 产出 `{solvers,...}`；这里把其 solver 候选**并入**导航图 solver 集，
// 再走既有 compileSolverPlan。既有 Phase2-C compose 调用路径（直接 compileSolverPlan）完全不受影响。
// ---------------------------------------------------------------------------

/** DRIL 资源包中与 Compose 相关的最小结构（结构化解耦·不 runtime 依赖 resource-router）。 */
export interface ComposableResourcePackage {
  solvers: { key: string; outputShape?: string[] }[];
}

/**
 * 把资源包 solver 候选并入导航图（去重·保留导航图已有 outputShape·additive·纯 R6）。
 * 资源包新带的 solver 若导航图缺 outputShape 则用包内 shape（缺省 []·仍可静态单步入选）。
 */
export function mergeResourcePackage(navSlice: NavigationSlice, pkg: ComposableResourcePackage): NavigationSlice {
  const byKey = new Map(navSlice.solvers.map((s) => [s.key, s] as const));
  for (const s of pkg.solvers) {
    if (!byKey.has(s.key)) {
      byKey.set(s.key, { key: s.key, capability: `${s.key} 能力`, outputShape: s.outputShape ?? [] });
    }
  }
  const solvers = [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { ...navSlice, solvers, nonEmpty: solvers.length > 0 };
}

/**
 * DRIL 资源包 → Compose 计划：并入包再走 compileSolverPlan（§8.2 主收益场景）。
 * 与直接 compileSolverPlan 同签名扩展一个 pkg 参数·同 R6 确定性（同 query/nav/pkg/slots → 同结果）。
 */
export function compileWithResourcePackage(
  query: string,
  navSlice: NavigationSlice,
  pkg: ComposableResourcePackage,
  slots: CompileSlots,
): ComposeCompileResult {
  return compileSolverPlan(query, mergeResourcePackage(navSlice, pkg), slots);
}
