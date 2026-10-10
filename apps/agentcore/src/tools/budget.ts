import type { AgentBudget } from "@platform/contracts";
import { DEFAULT_AGENT_BUDGET } from "@platform/contracts";

/**
 * Budget tracker shared across a top-level task. Nested agents/workflows consume
 * the same counters (platform PRD §8.2 预算继承).
 */
export class BudgetTracker {
  readonly budget: AgentBudget;
  toolCalls = 0;
  solverCalls = 0;
  iterations = 0;
  /** WO-Phase4：探索类工具（discover/search_experience/query_system_ontology）已消耗次数。 */
  discoverCalls = 0;
  /** WO-Phase4：已完成的「LLM→工具执行→结果返回」轮次（= SSE iteration 序号·loop 每轮末 +1）。 */
  roundTrips = 0;
  readonly startedAt = Date.now();
  exhausted = false;
  /** 置 exhausted 时记录首个触发原因（degrade 溯源用·确定性 R6·不依赖 LLM 输出内容）。 */
  exhaustedReason?: string;
  /**
   * WO-LOOP-CONTROL-P2 · per-tool 调用上界（PRD §3.3·机制 #3·**opt-in·缺省 undefined=不限=现行为字节兼容**）。
   * 某工具（按名）累计调用达此上界 → 置 exhausted（复用现成降级路径）。与 P1 loop-hash 互补：hash 认「同参重复」、
   * cap 认「同工具**异参**刷屏」。生产经 config `QOS_AGENT_PER_TOOL_CALL_CAP` 注入（推荐 8）·由循环侧在 loop 起始设入。
   */
  perToolCallCap?: number;
  /** WO-LOOP-CONTROL-P2 · 逐工具累计调用计数（perToolCallCap 判定用·R6 确定性·无时钟/随机）。 */
  readonly toolCallCounts = new Map<string, number>();

  constructor(overrides?: Partial<AgentBudget>) {
    this.budget = { ...DEFAULT_AGENT_BUDGET, ...(overrides ?? {}) };
  }

  elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  durationExceeded(): boolean {
    return this.elapsedMs() > this.budget.maxDurationMs;
  }

  iterationsExceeded(): boolean {
    return this.iterations >= this.budget.maxIterations;
  }

  /** WO-Phase4：round-trip 上界已达（loop 每轮迭代前查·超即硬预算降级）。 */
  roundTripsExceeded(): boolean {
    return this.roundTrips >= this.budget.maxRoundTrips;
  }

  private markExhausted(reason: string): { ok: false; reason: string } {
    this.exhausted = true;
    if (this.exhaustedReason === undefined) this.exhaustedReason = reason;
    return { ok: false, reason };
  }

  /** Try to consume one tool call. Returns failure reason on exhaustion. */
  tryConsume(costClass: "CHEAP" | "EXPENSIVE"): { ok: true } | { ok: false; reason: string } {
    if (this.durationExceeded()) {
      return this.markExhausted("maxDurationMs exceeded");
    }
    if (this.toolCalls >= this.budget.maxToolCalls) {
      return this.markExhausted("maxToolCalls exceeded");
    }
    if (costClass === "EXPENSIVE" && this.solverCalls >= this.budget.maxSolverCalls) {
      return this.markExhausted("maxSolverCalls exceeded");
    }
    this.toolCalls += 1;
    if (costClass === "EXPENSIVE") this.solverCalls += 1;
    return { ok: true };
  }

  /**
   * WO-DSH-ARM-GAPS · **退费**：给「确实没跑」的 EXPENSIVE 调用退还名额。
   *
   * ══ 为什么需要它（实测，不是推理）═══════════════════════════════════════════════════
   * `tryConsume("EXPENSIVE")` 在 **executor 派发之前**扣费（executor.ts 预算段），而求解器是在
   * **之后的 `dispatch` 里**才真跑的。于是「被求解器服务当场拒绝（入参不合 / 求解器不存在）」的调用
   * **照样吃掉一个名额** —— 那类调用一次算力都没烧。
   *
   * 实测账（task_01M3YBSW69ED2N36YF27RHFVPQ · kernel=EXTERNAL · deepseek-chat · 排产问句）：
   *   8 个名额里 **5 次真跑成、3 次 ERROR 照扣**；三次 ERROR 的 durationMs 分别是 11 / 11 / 1
   *   —— **合计 23 毫秒、零求解器执行，吃掉 37.5% 的求解器预算**。模型当时正在猜 `sop_reschedule`
   *   的入参名（`targetOrder` 还是 `targetOrderId`），而名额刚好在它猜对之后用完：下一次调用
   *   （同一个刚跑通的 `sop_reschedule`，它要的就是第二个方案做对比）直接 `BUDGET_EXCEEDED`。
   *
   * 形态（铁律 0.6 句式）：
   * > **「我用『这个调用花了预算』当作『这个调用烧了算力』的证据，而前者并不度量后者。」**
   *
   * ⇒ `maxSolverCalls` 的语义是**求解器执行次数**的上界，就该只数**真执行**的次数。
   *
   * ⚠️ **只退 `solverCalls`，不退 `toolCalls`**，这是刻意的：`maxToolCalls` 是**尝试次数**的上界，
   *   退掉它等于把「模型可以无限重试」的口子打开（退费只在刻意收窄的条件下发生，见调用点判据）。
   *   两个计数器的语义不同，本方法只动前者。
   * ⚠️ **不动 `exhausted`**：能走到退费说明这次 `tryConsume` 是成功的（没置 exhausted）；
   *   而 `exhausted` 一旦被置上，走的是降级路，不会再有扣费调用发生。确定性 R6（纯计数·无时钟/随机）。
   */
  refundExpensive(): void {
    if (this.solverCalls > 0) this.solverCalls -= 1;
  }

  /**
   * WO-Phase4：探索类工具专用预算消耗（在 executor 里对 discover/search_experience/query_system_ontology 调用）。
   * 超 maxDiscoverCalls → 失败并置 exhausted（loop 下一轮迭代前查 exhausted → 硬预算降级收尾）。确定性 R6。
   */
  tryConsumeDiscover(): { ok: true } | { ok: false; reason: string } {
    if (this.discoverCalls >= this.budget.maxDiscoverCalls) {
      return this.markExhausted("maxDiscoverCalls exceeded");
    }
    this.discoverCalls += 1;
    return { ok: true };
  }

  /**
   * WO-SCENARIO-INPUT-PHASE0：嵌套 workflow-as-tool 消耗共享预算（按 EXPENSIVE 计，
   * 与 solver 调用共享上界，防止子 workflow 无限烧预算）。
   */
  tryConsumeWorkflow(): { ok: true } | { ok: false; reason: string } {
    return this.tryConsume("EXPENSIVE");
  }

  /**
   * WO-LOOP-CONTROL-P2 · per-tool 调用上界消耗（PRD §3.3）：某工具（按名）累计调用达 perToolCallCap → 置 exhausted
   *（复用既有 exhausted 降级路径·loop 下一轮迭代前 `budget.exhausted` 守卫优雅降级·零新降级路径）。缺省不设 cap →
   * 直接放行（现行为字节兼容）。确定性 R6（纯计数·无 Date.now/随机）。补 P1 loop-hash「同参重复」之外的「异参刷屏」。
   */
  tryConsumeTool(name: string): { ok: true } | { ok: false; reason: string } {
    if (this.perToolCallCap === undefined) return { ok: true };
    const used = this.toolCallCounts.get(name) ?? 0;
    if (used >= this.perToolCallCap) {
      return this.markExhausted(`perToolCallCap:${name}`);
    }
    this.toolCallCounts.set(name, used + 1);
    return { ok: true };
  }
}
