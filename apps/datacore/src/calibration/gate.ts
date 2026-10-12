import type { CalibrationDebt } from "@platform/contracts";
import type { Repos } from "../repo/repo.js";
import type { SolverService } from "../solvers/service.js";
import { AppError } from "../errors.js";

/**
 * M0-F3 实料闸（PRD-ai-sim-rev2-ground-truth §2.1 F3）：学习类能力的统一准入。
 *
 * **今天的行为是 X**：B7 代理模型 / C5 结构校准 / C6 推演经验库 / A10 假设搜索环
 * 四项能力**全部不存在**（grep 实测：surrogate/代理模型 RC=1 零命中；regress 零命中；
 * 经验库/searchLoop 零命中 —— 金丝雀：同法查 `realizedOutcomes` 必中）。
 * 且 PRD 自己把它们排在 M3–M5（B7 P2 · C5 P2 · C6 P3 · A10 P1），M0 不许各写一版。
 *
 * **应该是 Y**：四项能力将来落地时**运行时读同一个闸** `calibrationDebt.paired >= expected.minPaired`。
 * 本模块就是那个闸 —— 三件事：
 *  ① 判定函数 `evaluateRealizedGate`（纯函数，T2 变异反证直接咬它：闸被改成恒放行 ⇒ 门红）；
 *  ② 统一披露 `realizedGateStatus`（四项各自 allowed + 原因，`GET /a/v1/calibration/gate`）；
 *  ③ 准入断言 `assertRealizedGateOpen` —— 四项能力的入口**必须**调它；
 *     未达标 ⇒ 409 披露（哪项能力 · paired/minPaired · 欠 N 对 · rationale），
 *     ⛔ 不许降级成「用仿真数据凑合跑」（那是循环论证，零信息 —— PRD §0/§3.2）。
 *
 * C6 按 PRD §3.3 在通闸前**不建模块**——它的「调用经验库 ⇒ 拒绝并披露」就是本闸的拒绝行为本身。
 */

/** 四项学习类能力的准入声明表（key 稳定 —— 披露与测试都按 key 咬）。 */
export const LEARNING_CAPABILITIES = [
  { key: "B7", name: "代理模型（surrogate 双臂对照）" },
  { key: "C5", name: "结构校准（边权重/系数回归）" },
  { key: "C6", name: "推演经验库（扰动,预测,实际 三元组）" },
  { key: "A10", name: "假设搜索环（推翻数度量）" },
] as const;

export type LearningCapabilityKey = (typeof LEARNING_CAPABILITIES)[number]["key"];

export interface RealizedGateVerdict {
  open: boolean;
  paired: number;
  minPaired: number;
  shortfall: number;
}

/** 闸的判定（纯函数 —— T2 变异反证的咬合点：把它改成恒 true，m11 测试「M0-F3」必须红）。 */
export function evaluateRealizedGate(debt: Pick<CalibrationDebt, "paired" | "expected">): RealizedGateVerdict {
  const minPaired = debt.expected.minPaired;
  const shortfall = Math.max(0, minPaired - debt.paired);
  return { open: debt.paired >= minPaired, paired: debt.paired, minPaired, shortfall };
}

export interface CapabilityAdmission {
  key: LearningCapabilityKey;
  name: string;
  allowed: boolean;
  /** 拒绝原因（allowed=true 时为达标陈述）——披露是硬要求，不许只给布尔。 */
  reason: string;
}

export interface RealizedGateStatus extends RealizedGateVerdict {
  capabilities: CapabilityAdmission[];
  rationale: string;
}

/** 四项能力 × 同一个闸：各自 allowed + 披露原因（拒绝必须点名哪项能力、欠几对）。 */
export function gateStatusOf(debt: CalibrationDebt): RealizedGateStatus {
  const v = evaluateRealizedGate(debt);
  const capabilities = LEARNING_CAPABILITIES.map((c) => ({
    key: c.key,
    name: c.name,
    allowed: v.open,
    reason: v.open
      ? `实料配对 ${v.paired} ≥ 准入期望 ${v.minPaired} —— 准予启用（trainedOn:REALIZED 方可作保真度证据）`
      : `${c.key} ${c.name} 拒绝启用：实料配对 ${v.paired} < 准入期望 ${v.minPaired}（欠 ${v.shortfall} 对）——` +
        `⛔ 不许降级成用仿真数据凑合跑（循环论证，零信息）；先经 F1 摄取面补实料`,
  }));
  return { ...v, capabilities, rationale: debt.expected.rationale };
}

/**
 * 准入断言 —— 学习类能力入口的运行时闸门（B7/C5/C6/A10 的模块落地时必须调用）。
 * 未达标 ⇒ 409 REALIZED_GATE_CLOSED + 披露（能力名 · 欠 N 对 · rationale）。
 */
export async function assertRealizedGateOpen(
  repos: Repos,
  solvers: SolverService,
  tenantId: string,
  capability: LearningCapabilityKey,
  debtOf: (tenantId: string) => Promise<CalibrationDebt>,
): Promise<void> {
  const debt = await debtOf(tenantId);
  const status = gateStatusOf(debt);
  const admission = status.capabilities.find((c) => c.key === capability)!;
  if (!admission.allowed) {
    throw new AppError("REALIZED_GATE_CLOSED", `${admission.reason}。${debt.expected.rationale}`, 409);
  }
}
