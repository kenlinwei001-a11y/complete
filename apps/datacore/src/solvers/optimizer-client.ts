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

// A8.1 指派最优化（订单/需求 → 基地/产线）：x[i,j]∈{0,1}，每 item 一指派、Σ 容量约束、资格 mask；min Σ cost·x。
export interface AssignmentRequest {
  model: "assignment";
  seed: number;
  items: { id: string; weight: number }[];
  bins: { id: string; capacity: number }[];
  /** 每 (item,bin) 指派成本；缺省对 = 不可指派（资格 mask）。 */
  costs: { item: string; bin: string; cost: number }[];
}
export interface AssignmentResult {
  status: "OPTIMAL" | "FEASIBLE" | "INFEASIBLE";
  optimal: boolean;
  /** item→bin 指派（INFEASIBLE 时空）。 */
  assignments: { item: string; bin: string; cost: number }[];
  objective: number;
}

// A8.2 排序最优化（产线换型排序）：把 jobs 按 group 排序，最小化相邻 group 切换的换型损失（默认每次切换=1，
// 或给 changeover 矩阵 group→group 成本）。开放路径（非环）。
export interface SequencingRequest {
  model: "sequencing";
  seed: number;
  jobs: { id: string; group: string }[];
  /** 可选换型成本矩阵（from group → to group）；缺省 = 不同 group 相邻计 1，同 group 计 0。 */
  changeover?: { from: string; to: string; cost: number }[];
}
export interface SequencingResult {
  status: "OPTIMAL" | "FEASIBLE" | "INFEASIBLE";
  optimal: boolean;
  /** 最优生产顺序（job id 序）。 */
  sequence: string[];
  /** 换型次数（相邻 group 不同的段数）。 */
  changeovers: number;
  objective: number;
}

// A8.3 装箱最优化（产能装箱/排产填充）：items(size) 装入容量为 binCapacity 的 bin，最小化 bin 数（bin-packing 族）。
export interface PackingRequest {
  model: "packing";
  seed: number;
  items: { id: string; size: number }[];
  binCapacity: number;
  maxBins?: number;
}
export interface PackingResult {
  status: "OPTIMAL" | "FEASIBLE" | "INFEASIBLE";
  optimal: boolean;
  /** 每个使用中的 bin 及其装入的 item id。 */
  bins: { items: string[]; load: number }[];
  binCount: number;
  objective: number;
}

export interface OptimizerClient {
  solve(req: OptimizationRequest): Promise<OptimizationResult>;
  /** A8.1 指派 / A8.2 排序 / A8.3 装箱（可选实现；未实现的 client 被调时抛"未接入"）。 */
  solveAssignment?(req: AssignmentRequest): Promise<AssignmentResult>;
  solveSequencing?(req: SequencingRequest): Promise<SequencingResult>;
  solvePacking?(req: PackingRequest): Promise<PackingResult>;
}

/** 生产实现：POST {baseUrl}/solve（背包）、/assignment（指派）。错误转平台错误信封风格的异常。 */
export class HttpOptimizerClient implements OptimizerClient {
  constructor(private readonly baseUrl: string) {}

  private async post<T>(path: string, req: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(`optimizer ${res.status}: ${body.error?.message ?? "solve failed"}`);
    }
    return (await res.json()) as T;
  }

  async solve(req: OptimizationRequest): Promise<OptimizationResult> {
    return this.post<OptimizationResult>("/solve", req);
  }

  async solveAssignment(req: AssignmentRequest): Promise<AssignmentResult> {
    return this.post<AssignmentResult>("/solve", req); // sidecar 单端点按 model 判别（dispatch）
  }

  async solveSequencing(req: SequencingRequest): Promise<SequencingResult> {
    return this.post<SequencingResult>("/solve", req);
  }

  async solvePacking(req: PackingRequest): Promise<PackingResult> {
    return this.post<PackingResult>("/solve", req);
  }
}
