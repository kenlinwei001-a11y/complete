/**
 * 最优化引擎客户端（datacore → CP-SAT sidecar 的内部 REST 代理）。
 *
 * 平台把 OR-Tools CP-SAT 封装成自有 API（services/optimizer），datacore 经本客户端调用,
 * 对外只暴露平台术语求解器键（selection_optimize…），不出现外部产品名（CLAUDE.md 命名铁律）。
 * 测试用 mock 实现（与 LLM 的 scripted/routed 双实现同构）；生产用 HttpOptimizerClient（env 发现）。
 */

export interface OptimizationItem {
  id: string;
  value: number;
  weight: number;
}

export interface OptimizationRequest {
  model: "selection";
  seed: number;
  items: OptimizationItem[];
  budget: number;
  maxCount?: number;
  minValue?: number;
}

export interface OptimizationResult {
  status: "OPTIMAL" | "FEASIBLE" | "INFEASIBLE";
  optimal: boolean;
  selected: string[];
  totalValue: number;
  totalWeight: number;
}

export interface OptimizerClient {
  solve(req: OptimizationRequest): Promise<OptimizationResult>;
}

/** 生产实现：POST {baseUrl}/solve。错误转平台错误信封风格的异常。 */
export class HttpOptimizerClient implements OptimizerClient {
  constructor(private readonly baseUrl: string) {}

  async solve(req: OptimizationRequest): Promise<OptimizationResult> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/solve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(`optimizer ${res.status}: ${body.error?.message ?? "solve failed"}`);
    }
    return (await res.json()) as OptimizationResult;
  }
}
