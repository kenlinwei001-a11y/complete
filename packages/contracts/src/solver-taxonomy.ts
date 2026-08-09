import { z } from "zod";

/**
 * WO-L7A · 内置求解器决策问题分类维（10 类）。
 *
 * **为什么要有这一维**：`SOLVER_KEYS` 是一张 59 条的平表，既没有分组也没有"这类求解器解决什么决策问题"
 * 的说法。前端治理页只能一次性铺 59 条，Agent 选型只能靠问句/标签模糊命中——**没有"按类找求解器"这个动作**。
 *
 * **归纳原则（本单硬约束）**：按「**解决什么决策问题**」分，**不**按「用什么算法」分。
 * 故 `job_shop_schedule`（CP-SAT）与 `changeover_sequence`（贪心）同属「计划与排程」——
 * 它们回答的是同一个问题「谁在什么时候、按什么顺序做」；而 `margin_attribution`（净室通用）
 * 与 `plan_rootcause`（电池域）同属「归因与根因诊断」，尽管一个通用一个专用。
 *
 * **不是新真值源（R13 派生投影）**：分类只是给既有 `SOLVER_KEYS` 挂一维检索标签，
 * 不改任何求解器实现、不改任何 key 名（改 key = 断链）。
 *
 * 稳定排序（R6 确定性）：类目顺序 = 本数组声明序；类目内求解器顺序 = `SOLVER_KEYS` 声明序。
 * 二者都不依赖对象键序（`Object.keys` 顺序不参与任何对外输出）。
 */
export const SOLVER_CATEGORIES = [
  "capacity_bottleneck",
  "planning_scheduling",
  "material_inventory",
  "risk_propagation",
  "root_cause_attribution",
  "countermeasure_closure",
  "order_commitment",
  "performance_finance",
  "combinatorial_allocation",
  "whatif_exploration",
] as const;

export type SolverCategory = (typeof SOLVER_CATEGORIES)[number];
export const SolverCategorySchema = z.enum(SOLVER_CATEGORIES);

/** 类目元信息：中文标签 + 该类目回答的**决策问句**（选型判据，供治理页分组标题与 Agent 选型提示）。 */
export interface SolverCategoryMeta {
  /** 中文标签（治理页分组标题）。 */
  label: string;
  /** 这一类求解器回答的决策问题（一句话·选型判据）。 */
  decisionQuestion: string;
}

/**
 * 10 类定义（键序 = `SOLVER_CATEGORIES` 声明序）。
 * 判据写成"问句"而非"名词"，是为了让归类可证伪：一个求解器属不属于本类，
 * 看它回答的是不是这句问话，而不是看它内部用了哪种算法。
 */
export const SOLVER_CATEGORY_META: Record<SolverCategory, SolverCategoryMeta> = {
  capacity_bottleneck: {
    label: "产能与瓶颈",
    decisionQuestion: "产能够不够、被哪道工序/哪个共享资源卡住了？",
  },
  planning_scheduling: {
    label: "计划与排程",
    decisionQuestion: "谁在什么时候、按什么顺序、在哪个基地做？这版计划行不行？",
  },
  material_inventory: {
    label: "物料与库存",
    decisionQuestion: "料够不够齐套、缺口补多少、库存水位摆在哪？",
  },
  risk_propagation: {
    label: "风险预警与影响传导",
    decisionQuestion: "未来会不会出事、什么时候越线、会波及到谁？",
  },
  root_cause_attribution: {
    label: "归因与根因诊断",
    decisionQuestion: "为什么没达标？缺口一路归到哪些根因、各占多少、证据是什么？",
  },
  countermeasure_closure: {
    label: "对策与缺口闭合",
    decisionQuestion: "怎么补？有哪些方案、各自代价多大、组合起来能收窄多少？",
  },
  order_commitment: {
    label: "商务接单与承诺",
    decisionQuestion: "这单能不能接、能接多少、何时交、赚不赚、客户能不能欠？",
  },
  performance_finance: {
    label: "经营绩效与财务测算",
    decisionQuestion: "经营指标达成多少、钱怎么样、这笔投入投不投？",
  },
  combinatorial_allocation: {
    label: "通用组合最优化",
    decisionQuestion: "给定候选集与约束，选谁/分给谁/装哪/怎么流，才是可证最优的组合？",
  },
  whatif_exploration: {
    label: "假设推演与关联探查",
    decisionQuestion: "把某个假设值改掉，下游会怎样？沿本体从这里能关联到什么？",
  },
};

/** 类目是否合法（路由 query 参数校验用；非法类目一律拒绝，不静默返全量）。 */
export function isSolverCategory(v: unknown): v is SolverCategory {
  return typeof v === "string" && (SOLVER_CATEGORIES as readonly string[]).includes(v);
}
