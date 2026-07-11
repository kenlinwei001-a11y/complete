/**
 * WO-SANDBOX-AS-RENDER-TARGET（S1）· SimulationRequest 归一装配器（纯函数·R6·零 LLM）。
 *
 * 五类触发（人机对话/场景卡/what-if 按钮/沙盘工作台/主动告警）经各自入口把「时序推演意图 + 槽位」
 * 折叠为**同一** SimulationRequest → 同一渲染管线（配套预检→渲染进沙盘→答案先行）。本模块只做
 * **对话触发（source=dialogue）**的 slots→request 确定性映射 + sandbox_render 答案块组装（其余触发在各自
 * 上游已有归一通道·whatif.ts/场景卡 presetContext）。
 *
 * ⛔ MVP 边界（钉死·S1 只启用 shock）：hold/trend/policy 情景原型 + ImpactAssessment 求解器维须待
 * WO-SANDBOX-TEMPORAL-GROUNDING（S6·外生驱动/overlay/守恒）才上线，否则基线==情景=假评估（KILL-MOCK-RED）。
 * 本装配器对 hold/trend/policy 意图返回 DEFERRED（诚实答"时序接地建设中"+ 工单信号），**绝不假跑**。
 *
 * 确定性：无 Date.now/随机；同 (intentKey, slots, selectedObjects) → 字节一致 request（R6）。
 */
import type { AnswerBlock, ObjectRef, ScenarioAction, SimulationRequest } from "@platform/contracts";
import { S1_EXECUTABLE_ACTION_KINDS } from "@platform/contracts";

/** 情景四原型（判别）。意图键 → 原型：优先显式表，回退键名后缀（shock/hold/trend/policy）。 */
export type ScenarioPrototype = "shock" | "hold" | "trend" | "policy";

/** 时序推演意图键 → 情景原型（单一来源·与 scenarios-catalog / intent-mode 的 4 意图对齐）。 */
export const SIM_INTENT_PROTOTYPE: Record<string, ScenarioPrototype> = {
  "sim.shock_whatif": "shock",
  "sim.hold_whatif": "hold",
  "sim.trend_whatif": "trend",
  "sim.policy_whatif": "policy",
};

/** 是否时序推演意图（装配器只对这些意图动作）。 */
export function isSimIntent(intentKey: string | undefined): boolean {
  if (!intentKey) return false;
  return intentKey in SIM_INTENT_PROTOTYPE || /^sim\.(shock|hold|trend|policy)_/.test(intentKey);
}

/** 意图键 → 原型（表优先·回退键名后缀·未知回退 shock 保守）。 */
export function prototypeForIntent(intentKey: string): ScenarioPrototype {
  const direct = SIM_INTENT_PROTOTYPE[intentKey];
  if (direct) return direct;
  const m = /^sim\.(shock|hold|trend|policy)_/.exec(intentKey);
  return (m?.[1] as ScenarioPrototype) ?? "shock";
}

/** 装配结果（判别联合·orchestrator 据此分派）。 */
export type SimAssembleResult =
  | { status: "READY"; request: SimulationRequest; block: Extract<AnswerBlock, { type: "sandbox_render" }> }
  | { status: "DEFERRED"; prototype: ScenarioPrototype; horizonTicks: number; reason: string }
  | { status: "NOT_SIM" };

const num = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
};
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : undefined);

/**
 * 时窗槽 → tick 数（tick=1 模拟日·simclock 同义）。优先级：horizonTicks/days > weeks*7 > months*30；
 * 缺省 14（两周·保守短程）。确定性纯计算（R6·无时钟）。
 */
export function resolveHorizonTicks(slots: Record<string, unknown>): number {
  const direct = num(slots.horizonTicks) ?? num(slots.days) ?? num(slots.horizon);
  if (direct !== undefined && direct >= 1) return Math.floor(direct);
  const weeks = num(slots.weeks);
  if (weeks !== undefined && weeks >= 1) return Math.floor(weeks * 7);
  const months = num(slots.months);
  if (months !== undefined && months >= 1) return Math.floor(months * 30);
  return 14;
}

/** scope 解析：优先 selectedObjects（同类型聚合）；否则 slots.{objectType, objectIds|scope}。缺 objectType → undefined。 */
export function resolveScope(
  slots: Record<string, unknown>,
  selectedObjects: readonly ObjectRef[],
): { objectType: string; objectIds: string[] } | undefined {
  if (selectedObjects.length > 0) {
    const objectType = selectedObjects[0]!.objectType;
    const objectIds = selectedObjects.filter((o) => o.objectType === objectType).map((o) => o.objectId);
    return { objectType, objectIds };
  }
  const objectType = str(slots.objectType) ?? str(slots.scopeType);
  if (!objectType) return undefined;
  const raw = slots.objectIds ?? slots.scope;
  const objectIds = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : str(raw) ? [str(raw)!] : [];
  return { objectType, objectIds };
}

/**
 * 装配 SimulationRequest（source=dialogue）+ sandbox_render 答案块。
 * - 非时序意图 → NOT_SIM。
 * - hold/trend/policy（非 S1 可执行原型）→ DEFERRED（诚实待 S6·不产 request）。
 * - shock 且 scope 可解析 → READY（request + 答案先行横幅）。
 * - shock 但 scope 缺（无 objectType/objectIds）→ DEFERRED reason=scope 缺（不造伪 scope）。
 */
export function assembleSimulationRequest(
  intentKey: string | undefined,
  slots: Record<string, unknown>,
  selectedObjects: readonly ObjectRef[] = [],
): SimAssembleResult {
  if (!isSimIntent(intentKey)) return { status: "NOT_SIM" };
  const prototype = prototypeForIntent(intentKey!);
  const horizonTicks = resolveHorizonTicks(slots);

  // MVP 边界：非 shock 原型一律 DEFERRED（S6 接地前不上线·KILL-MOCK-RED）。
  if (!(S1_EXECUTABLE_ACTION_KINDS as readonly string[]).includes(prototype)) {
    return {
      status: "DEFERRED",
      prototype,
      horizonTicks,
      reason: `「${prototype}」类时序推演（如库存水位保持/趋势/政策系数）需时序接地配套（外生驱动·守恒·overlay）——由 WO-SANDBOX-TEMPORAL-GROUNDING（S6）提供，当前建设中。已为你记录该推演诉求（工单）。当前可跑冲击型（stop/急单）短程推演。`,
    };
  }

  const scope = resolveScope(slots, selectedObjects);
  if (!scope || scope.objectIds.length === 0) {
    // scope 缺 → 诚实 DEFERRED（不造伪 scope·不假跑）。
    return {
      status: "DEFERRED",
      prototype,
      horizonTicks,
      reason: "冲击型推演需明确作用对象（哪个基地/产线的哪个状态变量）——未能从问句解析出对象范围。请指明对象后重试。",
    };
  }

  // shock 动作：delta（冲击增量·必须）+ 目标状态变量（缺省 = scope 上通用 load 类·由 slots.stateVar 指定）。
  const delta = num(slots.delta) ?? num(slots.shockDelta) ?? num(slots.demandDelta);
  const stateVar = str(slots.stateVar) ?? str(slots.target) ?? "load";
  const atTick = num(slots.atTick) ?? 0;
  const shock: ScenarioAction = {
    kind: "shock",
    target: { objectType: scope.objectType, objectIds: scope.objectIds, stateVar },
    delta: delta ?? 0, // 缺 delta → 0（纯当前态短程演化·诚实非造数）
    atTick: Math.floor(atTick),
  };

  const request: SimulationRequest = {
    targetView: "sim-sandbox",
    scope,
    scenario: [shock],
    horizonTicks,
    compareBaseline: false, // S1 MVP：shock 短程只出状态级结论（双跑 ImpactAssessment 求解器维待 S6）
    slotPresets: slots,
    source: "dialogue",
  };

  const objLabel = scope.objectIds.length === 1 ? scope.objectIds[0]! : `${scope.objectType}×${scope.objectIds.length}`;
  const headline =
    delta !== undefined
      ? `已把「${objLabel}·${stateVar} ${delta >= 0 ? "+" : ""}${delta}」冲击注入推演，推进 ${horizonTicks} tick（≈${horizonTicks} 天）——逐 tick 出状态级传导结论。`
      : `已就「${objLabel}·${stateVar}」建立 ${horizonTicks} tick 短程推演（当前态演化）——逐 tick 出状态级结论。`;

  const block: Extract<AnswerBlock, { type: "sandbox_render" }> = { type: "sandbox_render", request, headline };
  return { status: "READY", request, block };
}
