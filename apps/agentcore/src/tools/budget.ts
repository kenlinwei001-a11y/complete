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
}
