import { ErrorCodes } from "@platform/contracts";
import type { BudgetTracker } from "./tools/budget.js";

/** Nesting context for agent↔workflow invocations (platform PRD §8.2). */
export interface NestingCtx {
  /** Entries like "agent:agt_x" / "workflow:wf_y". Top-level entry is NOT counted. */
  callChain: string[];
  /** Shared budget — nested invocations consume the top-level counters. */
  budget: BudgetTracker;
}

export class NestingError extends Error {
  constructor(
    readonly code: typeof ErrorCodes.NESTING_DEPTH_EXCEEDED | typeof ErrorCodes.CYCLIC_INVOCATION,
    message: string,
  ) {
    super(message);
    this.name = "NestingError";
  }
}

const MAX_DEPTH = 3;

/** Enter a nested invocation; throws on depth/cycle violations. */
export function enterNesting(nesting: NestingCtx, kind: "agent" | "workflow", id: string): NestingCtx {
  const key = `${kind}:${id}`;
  if (nesting.callChain.includes(key)) {
    throw new NestingError(ErrorCodes.CYCLIC_INVOCATION, `cyclic invocation detected: ${[...nesting.callChain, key].join(" -> ")}`);
  }
  const callChain = [...nesting.callChain, key];
  if (callChain.length > MAX_DEPTH) {
    throw new NestingError(
      ErrorCodes.NESTING_DEPTH_EXCEEDED,
      `nesting depth ${callChain.length} exceeds limit ${MAX_DEPTH}: ${callChain.join(" -> ")}`,
    );
  }
  return { callChain, budget: nesting.budget };
}
