import { z } from "zod";

/**
 * WO-D2/D3 · 同步求解代理 `POST /b/v1/solvers/{key}/run` 的**超时诊断 + incumbent（可行非最优解）**契约。
 *
 * 病灶（审核方真跑坐实·承 WO-D1「取消已通到底层」之后）：超时之后**用户什么都不知道、也什么都拿不到**——
 *   ① 超时载荷只有一个错误码 `SOLVER_TIMEOUT`，不说哪个求解器 / 跑了多久 / 数据多大 / 有没有可行解；
 *   ② CP-SAT 族求解器在证最优之前先有 **incumbent**（逐步改进的可行解），超时却**全丢**。
 *
 * 本文件是这两件事的**跨半共享契约**（R1 contracts-only-shared：B 出、前端读，谁也不各写一份）。
 *
 * ⛔ 加性纪律（**不得改既有必填**）：本契约**全部字段可选**、且只以**新增顶层键**的形式挂在既有响应上——
 *    - 成功 200 载荷：既有 `{ data, snapshotVersion }` 原样保留，另加 `incumbent/optimal/resultKind/notice/diagnostics`；
 *    - 超时 504 载荷：既有 `{ error: { code, message, requestId } }` 信封**逐字节保留**，另加 `diagnostics`。
 *    → 老版本前端（只读 `error.code` / 只读 `data`）**仍能原样解析**，不做任何改动即向后兼容（R6）。
 *
 * ⚠ 诚实边界（写死在契约里，避免下游误读）：
 *    - `incumbent:true` 一律**同时**带 `optimal:false`——incumbent 是「已找到的可行解」，**不是最优解**，
 *      也**未被证明**最优（`proven:false`）。任何消费方不得把它当最优解展示。
 *    - **无 incumbent 时不得编造**：底层没交回可行解 → 照旧 504，`diagnostics.hasIncumbent:false`。
 *    - `inputScale.source` 显式标注规模来自哪一层：`"args"` = 仅代理层可见的入参规模（真实但不完整——
 *      订单/基地等真数据规模在 DataCore 侧，超时后拿不到）；`"payload"` = 从交回的解里实测的规模。
 */

/** 输入规模：**真实计数**，不是常数占位。`counts` 逐键给出可数的量（数组长度/对象键数）。 */
export const SolverInputScaleSchema = z.object({
  /** 规模从哪来：args = 代理层入参（真实但不完整）· payload = 从交回的解实测 · mixed = 两者合并。 */
  source: z.enum(["args", "payload", "mixed"]),
  /** 逐键真实计数（如 `{ scenarios: 2, orderIds: 137, capacity: 40 }`）。空 = 入参无可数集合（诚实留空，不编）。 */
  counts: z.record(z.string(), z.number()).default({}),
  /** `counts` 各项之和（一眼看规模量级）。 */
  totalElements: z.number().int().nonnegative(),
  /** 入参顶层键名（哪些旋钮被拨过 → 复现该次超时的最小信息）。 */
  argKeys: z.array(z.string()).default([]),
});
export type SolverInputScale = z.infer<typeof SolverInputScaleSchema>;

/** 求解阶段（可得则给；不可得**留空**而不是瞎标一个）。 */
export const SolverPhaseSchema = z.enum([
  /** 已发出调用、超时前未收到任何响应。 */
  "dispatched",
  /** 超时后向底层讨要 incumbent 的交卷窗口内。 */
  "incumbent_handback",
  /** 底层在交卷窗口内交回了可行解。 */
  "incumbent_returned",
  /** 底层在交卷窗口内以错误/取消收场，无解可交。 */
  "aborted_no_result",
]);
export type SolverPhase = z.infer<typeof SolverPhaseSchema>;

/**
 * D3 · 超时诊断（挂在 504 载荷与 incumbent 200 载荷上·全可选加性）。
 * 每个字段都必须是**真值**：`elapsedMs` 是真耗时（Date.now 差），`inputScale` 是真计数。
 */
export const SolverTimeoutDiagnosticsSchema = z.object({
  /** 哪个求解器（路径参数原值）。 */
  solverKey: z.string(),
  /** 生效的超时阈值（agentcore `SOLVER_RUN_TIMEOUT_MS`）。 */
  timeoutMs: z.number().int().nonnegative(),
  /** **真实**耗时（从收到请求到给出结论）——不是把 timeoutMs 抄一遍。 */
  elapsedMs: z.number().int().nonnegative(),
  /** 超时后等底层交卷的窗口长度（ms）。 */
  handbackWindowMs: z.number().int().nonnegative().optional(),
  /** 输入规模（真实计数）。 */
  inputScale: SolverInputScaleSchema.optional(),
  /** 底层到底有没有交回可行解（无 → 504，不编）。 */
  hasIncumbent: z.boolean(),
  /** 求解阶段（可得则给）。 */
  phase: SolverPhaseSchema.optional(),
  /** 是否已向底层发出取消（WO-D1：超时 → 真取消，不只是不再等）。 */
  cancelRequested: z.boolean().optional(),
  /** 底层在交卷窗口内给出的失败原因原文（有则给·便于排查，不粉饰）。 */
  underlyingError: z.string().optional(),
  /** 这一层做得到什么、做不到什么的人话说明（诚实边界，不许省）。 */
  honestNote: z.string().optional(),
});
export type SolverTimeoutDiagnostics = z.infer<typeof SolverTimeoutDiagnosticsSchema>;

/**
 * D2 · incumbent 诚实标注（挂在**成功 200** 载荷顶层·全可选加性）。
 * 出现即意味着：**这不是最优解**，是超时前已找到的可行解。
 */
export const SolverIncumbentEnvelopeSchema = z.object({
  /** 恒 true——本次返回的是 incumbent（可行解）。 */
  incumbent: z.literal(true),
  /** 恒 false——**不得**让调用方误以为是最优解。 */
  optimal: z.literal(false),
  /** 恒 false——最优性**未被证明**。 */
  proven: z.literal(false),
  /** 结果种类判别式（前端一个 switch 就能分流）。 */
  resultKind: z.literal("incumbent"),
  /** 恒 true——本次结果是降级结果（时间预算耗尽所致）。 */
  degraded: z.literal(true),
  /** 给人看的一句话（前端可直接渲染成醒目提示，杜绝「泛化 toastError」）。 */
  notice: z.string(),
  /** 诊断（与 504 同一套字段，便于同一个渲染器复用）。 */
  diagnostics: SolverTimeoutDiagnosticsSchema.optional(),
});
export type SolverIncumbentEnvelope = z.infer<typeof SolverIncumbentEnvelopeSchema>;

/** 超时 504 载荷（既有 `error` 信封 + 加性 `diagnostics`）。老前端只读 `error` 仍成立。 */
export const SolverTimeoutPayloadSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }),
  diagnostics: SolverTimeoutDiagnosticsSchema.optional(),
});
export type SolverTimeoutPayload = z.infer<typeof SolverTimeoutPayloadSchema>;

/**
 * incumbent 提示文案单一来源（B 出、前端不各写一份）。
 * 措辞纪律：先说「不是最优解」，再说为什么——**不许**用"已完成/已优化"之类会被读成最优的词。
 */
export function incumbentNotice(solverKey: string, timeoutMs: number, elapsedMs: number): string {
  return (
    `【非最优解】求解器 ${solverKey} 在 ${timeoutMs}ms 预算内未能求到（也未能证明）最优解；` +
    `这里返回的是超时前已找到的**可行解（incumbent）**，实际耗时 ${elapsedMs}ms。` +
    `可直接参考，但不得当作最优方案对外承诺；需要最优请放宽超时或缩小求解规模后重跑。`
  );
}
