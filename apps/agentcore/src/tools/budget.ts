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
  readonly startedAt = Date.now();
  exhausted = false;

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

  /** Try to consume one tool call. Returns failure reason on exhaustion. */
  tryConsume(costClass: "CHEAP" | "EXPENSIVE"): { ok: true } | { ok: false; reason: string } {
    if (this.durationExceeded()) {
      this.exhausted = true;
      return { ok: false, reason: "maxDurationMs exceeded" };
    }
    if (this.toolCalls >= this.budget.maxToolCalls) {
      this.exhausted = true;
      return { ok: false, reason: "maxToolCalls exceeded" };
    }
    if (costClass === "EXPENSIVE" && this.solverCalls >= this.budget.maxSolverCalls) {
      this.exhausted = true;
      return { ok: false, reason: "maxSolverCalls exceeded" };
    }
    this.toolCalls += 1;
    if (costClass === "EXPENSIVE") this.solverCalls += 1;
    return { ok: true };
  }
}
