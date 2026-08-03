/**
 * 最优化引擎客户端（datacore → CP-SAT sidecar 的内部 REST 代理）。
 *
 * 平台把 OR-Tools CP-SAT 封装成自有 API（services/optimizer），datacore 经本客户端调用,
 * 对外只暴露平台术语求解器键（selection_optimize…），不出现外部产品名（CLAUDE.md 命名铁律）。
 * 测试用 mock 实现（与 LLM 的 scripted/routed 双实现同构）；生产用 HttpOptimizerClient（env 发现）。
 */
import { currentCancellationSignal, SolverCancelledError } from "./cancellation.js";

export interface OptimizationItem {
  id: string;
  value: number;
  weight: number;
}

export interface OptimizationRequest {
  model: "selection" | "job_shop_schedule";
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

// A8 小时级工序排程（job-shop scheduling）：每 (job,op) 建 IntervalVar，同机器不重叠 + 同 job 工艺顺序 →
// 单目标最小化 makespan（可证最优）。changeover 可选（按 op.group 对查换型分钟数）。零业务常数 R14。
export interface JobShopScheduleRequest {
  model: "job_shop_schedule";
  seed: number;
  jobs: { jobId: string; ops: { opId: string; machine: string; duration: number; order: number; group?: string }[] }[];
  /** 可选 sequence-dependent 换型（分组 from→to 分钟数）；缺省 = 无换型（纯 AddNoOverlap）。 */
  changeover?: { from: string; to: string; minutes: number }[];
  /** 可选时间轴上界（缺省 = Σduration + Σchangeover + 1）。 */
  horizon?: number;
}
export interface JobShopScheduleResult {
  status: "OPTIMAL" | "FEASIBLE" | "INFEASIBLE";
  optimal: boolean;
  /** 每工序带开始-结束时刻（涂布 0-120、卷绕 120-210…）。 */
  schedule: { jobId: string; opId: string; machine: string; start: number; end: number }[];
  /** 完工跨度（最大 end）。 */
  makespan: number;
  objective: number;
}

// ── 轨B·增量1 抽象优化模板池 5 CP-SAT 核心（OptModelTemplate 引擎侧请求/结果；零业务常数 R14） ──

// facility_location 选址：选开哪些设施(openCost)+把需求点指派到开着的设施(assignCost)，min Σ开设+Σ指派。
export interface FacilityLocationRequest {
  model: "facility_location";
  seed: number;
  facilities: { id: string; openCost: number; capacity?: number }[];
  clients: { id: string; demand?: number }[];
  assignCosts: { client: string; facility: string; cost: number }[];
}
export interface FacilityLocationResult {
  status: "OPTIMAL" | "FEASIBLE" | "INFEASIBLE";
  optimal: boolean;
  openFacilities: string[];
  assignments: { client: string; facility: string }[];
  objective: number;
}

// min_cost_flow 最小成本流：节点 supply(>0 源/<0 汇)，弧 cost+cap，求供需平衡、不超容、总成本最小的流。
export interface MinCostFlowRequest {
  model: "min_cost_flow";
  seed: number;
  nodes: { id: string; supply: number }[];
  arcs: { from: string; to: string; cost: number; cap?: number }[];
}
export interface MinCostFlowResult {
  status: "OPTIMAL" | "FEASIBLE" | "INFEASIBLE";
  optimal: boolean;
  flows: { from: string; to: string; flow: number }[];
  objective: number;
}

// set_cover 集合覆盖：选最小总成本集合使所有元素被覆盖（universe 缺省=覆盖元素之并）。
export interface SetCoverRequest {
  model: "set_cover";
  seed: number;
  sets: { id: string; cost?: number; covers: string[] }[];
  universe?: string[];
}
export interface SetCoverResult {
  status: "OPTIMAL" | "FEASIBLE" | "INFEASIBLE";
  optimal: boolean;
  chosen: string[];
  objective: number;
}

// independent_set 最大权独立集：选两两不相邻(edges 冲突)的节点使总权重最大。
export interface IndependentSetRequest {
  model: "independent_set";
  seed: number;
  nodes: { id: string; weight?: number }[];
  edges: { a: string; b: string }[];
}
export interface IndependentSetResult {
  status: "OPTIMAL" | "FEASIBLE" | "INFEASIBLE";
  optimal: boolean;
  chosen: string[];
  objective: number;
}

// combinatorial_auction 组合拍卖赢者裁定（WDP）：选互不共享物品的中标包使总收益最大。
export interface CombinatorialAuctionRequest {
  model: "combinatorial_auction";
  seed: number;
  bids: { id: string; value: number; items: string[] }[];
}
export interface CombinatorialAuctionResult {
  status: "OPTIMAL" | "FEASIBLE" | "INFEASIBLE";
  optimal: boolean;
  winners: string[];
  objective: number;
}

// ── WO-CROSS-OBJECT-MULTIOBJ 多目标（加权/ε-约束/字典序）+ 跨对象占用（订单×产线×合同三元互斥） ──

/** 多目标：决策变量（bool/int）+ 线性约束 + 多目标（各带 sense/weight）+ method。零业务名 R14。 */
export interface MultiObjectiveRequest {
  model: "multi_objective";
  seed: number;
  scale?: number;
  vars: { id: string; kind: "bool" | "int"; lo?: number; hi?: number }[];
  constraints: { terms: { var: string; coef: number }[]; op: "<=" | ">=" | "=="; rhs: number }[];
  objectives: { key: string; sense: "max" | "min"; terms: { var: string; coef: number }[]; weight?: number }[];
  method: "weighted" | "epsilon" | "lexicographic";
  /** epsilon 法：次目标转 ε-约束的界。 */
  epsilon?: { key: string; bound: number }[];
  /** lexicographic 法：目标优先序（key 序）。 */
  priority?: string[];
}
export interface MultiObjectiveResult {
  status: "OPTIMAL" | "FEASIBLE" | "INFEASIBLE";
  optimal: boolean;
  values: Record<string, number>;
  /** 每目标值分别回报（前端 Δ 分解用）。 */
  objectiveValues: Record<string, number>;
  method: string;
}

/** 跨对象占用：订单×产线×合同三元互斥（一单占某线=同耗产线产能+合同额度，同(线)互斥）。 */
export interface CrossObjectOccupancyRequest {
  model: "cross_object_occupancy";
  seed: number;
  scale?: number;
  orders: { id: string; revenue: number; penalty: number; contractId?: string; qty: number }[];
  lines: { id: string; capacity: number }[];
  contracts: { id: string; cap: number }[];
  eligibility: { order: string; line: string; cost: number }[];
  objectives?: { key: "revenue" | "penalty" | "cost"; weight?: number }[];
  method?: "weighted" | "epsilon" | "lexicographic";
  epsilon?: { key: string; bound: number }[];
  priority?: string[];
}
export interface CrossObjectOccupancyResult {
  status: "OPTIMAL" | "FEASIBLE" | "INFEASIBLE";
  optimal: boolean;
  values: Record<string, number>;
  objectiveValues: Record<string, number>;
  /** 哪些订单上哪条线。 */
  occupancy: { order: string; line: string }[];
  /** 被挤订单（未获排产 served=0）。 */
  displaced: string[];
  method: string;
  summary: string;
}

// ── WO-PORTFOLIO-OPTIMAL 全订单×全基地×时间 联合最优组合（共享产能守恒·冻结子集·多方案） ──
// cross_object_occupancy 的「加时间窗」变体：每 (base,窗口) 是容量 bin，需求项按可行窗口 mask 指派，
// Σ_i qty_i·x[i,b,t] ≤ cap[b,t] 共享产能守恒（防重复占用）。系数全在调用层预算好（R14·零业务名）。
export interface PortfolioCell {
  item: string;
  base: string;
  window: number;
  /** 该格是否按期（t ≤ dueWindow → 1）。 */
  ontime: 0 | 1;
  /** 延误量 = qty × 延误天（min_delay 目标）。 */
  delayUnits: number;
  /** 换型量（该基地切到该型号的换型分钟·min_changeover 目标）。 */
  changeUnits: number;
  /** 成品持有量 = qty × 提前窗数 × 窗天（min_fg_inventory 目标·对称 delayUnits：提前生产=成品压库）。 */
  fgHoldUnits: number;
  /** 该格综合代价（延误罚 + 换型代价 + 成品持有代价·min_cost 目标）。 */
  cost: number;
}
export interface PortfolioRequest {
  model: "portfolio";
  seed: number;
  scale?: number;
  items: { id: string; qty: number; unservedPenalty?: number }[];
  /** cap[b,t] 共享产能（Σ 该基地 Line.capacityDaily × 窗口天数）。 */
  capacity: { base: string; window: number; cap: number }[];
  cells: PortfolioCell[];
  /** 优化目标子集（缺省 ontime 单目标）；5 项均恒计回报（含 fgInventory 成品持有）。 */
  objectives?: { key: "ontime" | "delay" | "changeover" | "cost" | "fgInventory"; sense?: "max" | "min"; weight?: number }[];
  method?: "weighted" | "epsilon" | "lexicographic";
  epsilon?: { key: string; bound: number }[];
  priority?: string[];
  /**
   * ⑤ G-VAR-3 · 多目标组合法开关（opt-in·灭方法旋钮空转）：true → 按 method(weighted/epsilon/lexicographic)
   * 组合**全部** objectives 择格（改权重/ε上界/字典序 → 分配真变）；缺省/false → 保原「按首目标贪心」口径（默认路径字节不变）。
   */
  multiObjective?: boolean;
}
/**
 * WO-D2 · incumbent（可行但未证最优解）在**优化器这一层**的诚实现状 —— 写清楚做得到什么、做不到什么：
 *
 * - **做得到**：本结果的 `status`/`optimal` 已经是 sidecar 对「这个解到底是不是最优」的**如实自述**——
 *   `OPTIMAL`+`optimal:true` = 可证最优；`FEASIBLE`+`optimal:false` = **求到了可行解但没证到最优**
 *   （CP-SAT 打到求解上限时就是这个形态）。上层据此标注 incumbent 是有真依据的，不是猜的。
 * - **做不到（不假装）**：`services/optimizer/server.py` 是 `ThreadingHTTPServer + BaseHTTPRequestHandler`，
 *   **一次请求一次终局响应**：没有取消接口、不感知客户端断开、**也没有任何「求解中途把当前 incumbent
 *   推回来」的通道**（既无 SSE/chunked 流，也无 `GET /incumbent?runId=` 之类的旁路）。
 *   所以「CP-SAT 跑到一半、我们中途把它的 incumbent 抢出来」这件事**这一层做不到**——
 *   要做到得给 sidecar 加求解回调 + incumbent 推送/查询端点（不在本 WO 边界）。
 *   当前可行解的真实来源是：**DataCore 侧自有时间预算**（`SOLVER_INCUMBENT_BUDGET_MS`）在调用方放弃前收手，
 *   把**已经拿到的**（整次求解已返回的）可行解交出去。上层绝不谎报"我们从 CP-SAT 中途取到了解"。
 */
export interface PortfolioResult {
  status: "OPTIMAL" | "FEASIBLE" | "INFEASIBLE";
  optimal: boolean;
  /** served_<id> + x_<i>_<b>_<w> 决策值。 */
  values: Record<string, number>;
  /** 4 项目标值（ontime/delay/changeover/cost·恒计·供方案对比）。 */
  objectiveValues: Record<string, number>;
  /** x=1 的指派格（需求项 → 基地×窗口）。 */
  occupancy: { item: string; base: string; window: number }[];
  /** 未获排（served=0）的需求项 id。 */
  displaced: string[];
  method: string;
}

export interface OptimizerClient {
  solve(req: OptimizationRequest): Promise<OptimizationResult>;
  /** A8.1 指派 / A8.2 排序 / A8.3 装箱（可选实现；未实现的 client 被调时抛"未接入"）。 */
  solveAssignment?(req: AssignmentRequest): Promise<AssignmentResult>;
  solveSequencing?(req: SequencingRequest): Promise<SequencingResult>;
  solvePacking?(req: PackingRequest): Promise<PackingResult>;
  /** A8 工序排程（IntervalVar/AddNoOverlap，makespan 最优；未实现 → 调用方抛"未接入"）。 */
  solveJobShop?(req: JobShopScheduleRequest): Promise<JobShopScheduleResult>;
  /** 轨B·增量1 抽象模板池 5 CP-SAT 核心（OptModelTemplate 引擎侧；未实现 → 调用方抛"未接入"）。 */
  solveFacilityLocation?(req: FacilityLocationRequest): Promise<FacilityLocationResult>;
  solveMinCostFlow?(req: MinCostFlowRequest): Promise<MinCostFlowResult>;
  solveSetCover?(req: SetCoverRequest): Promise<SetCoverResult>;
  solveIndependentSet?(req: IndependentSetRequest): Promise<IndependentSetResult>;
  solveCombinatorialAuction?(req: CombinatorialAuctionRequest): Promise<CombinatorialAuctionResult>;
  /** WO-CROSS-OBJECT-MULTIOBJ 多目标 / 跨对象占用（未实现 → 调用方抛"未接入"）。 */
  solveMultiObjective?(req: MultiObjectiveRequest): Promise<MultiObjectiveResult>;
  solveCrossObjectOccupancy?(req: CrossObjectOccupancyRequest): Promise<CrossObjectOccupancyResult>;
  /** WO-PORTFOLIO-OPTIMAL 联合最优组合（未实现 → 调用方抛"未接入"）。 */
  solvePortfolio?(req: PortfolioRequest): Promise<PortfolioResult>;
}

/** 生产实现：POST {baseUrl}/solve（背包）、/assignment（指派）。错误转平台错误信封风格的异常。 */
export class HttpOptimizerClient implements OptimizerClient {
  constructor(private readonly baseUrl: string) {}

  /**
   * WO-D1 · 取消透传到 sidecar 调用：请求作用域取消信号（cancellation.ts·客户端断开/上游超时派生）
   * 直接喂给 fetch → 取消时**连接真中断**，datacore 不再等、不再占用 socket、也不再拿回结果。
   *
   * ⚠ 诚实边界（不许假装能取消）：`services/optimizer/server.py` 是 ThreadingHTTPServer +
   * BaseHTTPRequestHandler，**没有取消接口、也不感知客户端断开** —— 那个 handler 线程会把当次 CP-SAT
   * 求完（只在最后写响应到已死 socket 时失败）。所以这一层的真相是：**我们取消的是"调用"，不是"求解进程"**。
   * 要让 sidecar 真停，需给 services/optimizer 加求解句柄 + 取消端点（或让其在 solve 回调里查连接存活），
   * 那不在本 WO 边界内，故此处如实标注，不在上层谎报"底层已停"。
   */
  private async post<T>(path: string, req: unknown): Promise<T> {
    const signal = currentCancellationSignal();
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
      ...(signal ? { signal } : {}),
    }).catch((e: unknown) => {
      // 取消导致的 fetch 失败 → 统一成 SolverCancelledError（不冒充"引擎故障"）。
      if (signal?.aborted) throw new SolverCancelledError(`optimizer ${path}`);
      throw e;
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

  async solveJobShop(req: JobShopScheduleRequest): Promise<JobShopScheduleResult> {
    return this.post<JobShopScheduleResult>("/solve", req); // sidecar 单端点按 model 判别（dispatch）
  }

  // 轨B·增量1：5 核心同走单端点 /solve（sidecar 按 model 字段 dispatch）。
  async solveFacilityLocation(req: FacilityLocationRequest): Promise<FacilityLocationResult> {
    return this.post<FacilityLocationResult>("/solve", req);
  }

  async solveMinCostFlow(req: MinCostFlowRequest): Promise<MinCostFlowResult> {
    return this.post<MinCostFlowResult>("/solve", req);
  }

  async solveSetCover(req: SetCoverRequest): Promise<SetCoverResult> {
    return this.post<SetCoverResult>("/solve", req);
  }

  async solveIndependentSet(req: IndependentSetRequest): Promise<IndependentSetResult> {
    return this.post<IndependentSetResult>("/solve", req);
  }

  async solveCombinatorialAuction(req: CombinatorialAuctionRequest): Promise<CombinatorialAuctionResult> {
    return this.post<CombinatorialAuctionResult>("/solve", req);
  }

  // WO-CROSS-OBJECT-MULTIOBJ：多目标 / 跨对象占用同走单端点 /solve（sidecar 按 model 字段 dispatch）。
  async solveMultiObjective(req: MultiObjectiveRequest): Promise<MultiObjectiveResult> {
    return this.post<MultiObjectiveResult>("/solve", req);
  }

  async solveCrossObjectOccupancy(req: CrossObjectOccupancyRequest): Promise<CrossObjectOccupancyResult> {
    return this.post<CrossObjectOccupancyResult>("/solve", req);
  }

  // WO-PORTFOLIO-OPTIMAL 联合最优组合同走单端点 /solve（sidecar 按 model 字段 dispatch）。
  async solvePortfolio(req: PortfolioRequest): Promise<PortfolioResult> {
    return this.post<PortfolioResult>("/solve", req);
  }
}
