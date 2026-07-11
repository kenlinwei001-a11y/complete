/**
 * hold 守恒诚实（WO-SANDBOX-TEMPORAL-GROUNDING·S6·§3.4·闭 G-C）。
 *
 * 问题：v1.1 的 `hold`（钉住水位·"库存保持 X"）只钉值不记维持它的流量 → "库存保持 X"凭空变料·魔法推演。
 *
 * 解法：hold 每 tick 记录 `sustainingFlow[tick] = pinnedValue − naturalValue[tick]`（钉住值与**自然演化值**之差）。
 *  - ImpactAssessment **必含**一维「隐含净补/日 = mean(sustainingFlow)」（机械派生·维持高水位的代价·常是利空的一部分）；
 *  - 若 target 变量**无任何流入规则支撑**（图上没有指向它的传导边）→ 标注「纯政策假设」（诚实降级·不禁跑）。
 *
 * naturalValue 由调用方在**同一真引擎**上跑一遍**不钉**的自然演化（propagateTick 无 hold）逐 tick 读 target 格得到——
 * 本模块只做守恒会计（纯数值·R6），不自造轨迹（KILL-MOCK-RED：sustainingFlow 全来自真自然轨迹 vs 真钉住值）。
 */
import type { ImpactVerdict } from "@platform/contracts";

const PRECISION = 1e12;
function round12(n: number): number {
  const r = Math.round(n * PRECISION) / PRECISION;
  return Object.is(r, -0) ? 0 : r;
}

export interface HoldConservationInput {
  /** 钉住的水位值（hold action.value）。 */
  pinnedValue: number;
  /** 自然演化值 per tick（同真引擎跑**不钉**的传导得到的 target 格逐 tick 值·真轨迹）。 */
  naturalTrajectory: number[];
  /** 图上是否有指向该 target(type,stateVar) 的传导边（有流入模型支撑）。 */
  hasInflowRule: boolean;
}

export interface HoldConservationResult {
  /** 逐 tick 维持流量 = pinnedValue − naturalValue（>0 = 需净补进料维持；<0 = 需泄放）。 */
  sustainingFlow: number[];
  /** 隐含净补/日 = mean(sustainingFlow)（维持该水位的日均代价·机械派生）。 */
  impliedNetReplenishPerDay: number;
  /** 无流入边 → 纯政策假设（该水位无流入模型支撑）。 */
  policyAssumptionOnly: boolean;
  /** 诚实标注（纯政策假设时非空）。 */
  annotation: string | null;
}

/** hold 守恒会计（纯数值·确定性 R6）。 */
export function computeHoldConservation(input: HoldConservationInput): HoldConservationResult {
  const sustainingFlow = input.naturalTrajectory.map((nat) => round12(input.pinnedValue - nat));
  const impliedNetReplenishPerDay =
    sustainingFlow.length > 0 ? round12(sustainingFlow.reduce((a, b) => a + b, 0) / sustainingFlow.length) : 0;
  const policyAssumptionOnly = !input.hasInflowRule;
  return {
    sustainingFlow,
    impliedNetReplenishPerDay,
    policyAssumptionOnly,
    annotation: policyAssumptionOnly ? "该水位无流入模型支撑·纯政策假设" : null,
  };
}

/** 图上是否存在指向 (targetTypeKey, targetStateVar) 的传导边（PropagationRule）——判 hold 是否有流入支撑。 */
export function hasInflowRule(
  rules: { targetTypeKey: string; targetStateVar: string }[],
  targetTypeKey: string,
  targetStateVar: string,
): boolean {
  return rules.some((r) => r.targetTypeKey === targetTypeKey && r.targetStateVar === targetStateVar);
}

/** ImpactAssessment 的「隐含净补/日」维（hold 守恒必含·R13 evidence 溯 trace）。 */
export function holdConservationDim(
  result: HoldConservationResult,
  evidenceRef: string,
): { dimKey: string; baseline: number; scenario: number; delta: number; verdict: ImpactVerdict; evidence: string } {
  const cost = result.impliedNetReplenishPerDay;
  // verdict 纯机械：需净补(>0)=维持代价=利空；需泄放(<0)=中性（本维不判利好，仅暴露代价）；无=中性。
  const verdict: ImpactVerdict = cost > 0 ? "UNFAVORABLE" : "NEUTRAL";
  const suffix = result.policyAssumptionOnly ? `·${result.annotation}` : "";
  return {
    dimKey: "隐含净补/日",
    baseline: 0, // 不钉住时无维持代价
    scenario: cost,
    delta: cost,
    verdict,
    evidence: `sustainingFlow=mean(pinned−natural)·${evidenceRef}${suffix}`,
  };
}
