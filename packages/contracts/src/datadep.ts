import { z } from "zod";
import { IsoTime } from "./common.js";
import { GapFindingSchema } from "./growth.js";

/**
 * DATADEP-MANIFEST-READINESS · 站② 数据补齐拱心石（脊）.
 *
 * 每个推演入口（求解器/场景/意图/视图）声明一份**声明式数据依赖清单**（DataDependency）——
 * 「跑之前该有哪些对象、多少行、哪些参数/切片」的机器可读前置条件（precondition-first），
 * 与输出侧 `SOLVER_OUTPUT_SHAPES`（DF.6 覆盖门）对偶：本清单是**输入侧覆盖门**的单一真相源。
 *
 * 设计不变量：
 *  - **本体绑定·零业务常数（R14）**：`roleType` 是**抽象角色键**（base/line/order/…，经 SolverBinding
 *    role→租户真实类型解析·非 "常州"/"NCM4680" 等业务字面量），`minRows` 是结构性下限（≥1），
 *    整份清单不含任何行业实体名 → 换行业=换 IndustryPack 数据·0 码改（挂 INDUSTRY-PACK-CONVERGE）。
 *  - **design-time 不产数值·runtime 恒确定性（R6）**：清单只声明**需求结构（WHAT）**，不产任何数值；
 *    真数据仍由确定性合成 / 真人正门导入产生。runtime 读清单做就绪探测（纯计数比较），不调 LLM。
 *  - **治本副产**：`loadContext` 从写死 22 类改为**读清单并集**——`SOLVER_DATADEP` 各求解器清单里声明的
 *    上下文角色并集驱动 loadContext 该加载什么（杀掉 Hα/Hγ 硬编码 22 类；门守每个上下文角色被清单覆盖）。
 */

/** 单条数据依赖（一个对象角色的最小就绪要求）。 */
export const DataDependencyItemSchema = z.object({
  /** 本体角色类型键（抽象角色·经 SolverBinding 映射真类型·R14；非业务字面量）。 */
  roleType: z.string().min(1),
  /** 就绪最小行数（结构性下限·≥1；不是业务量·不写死具体业务规模）。 */
  minRows: z.number().int().min(1),
  /** 必需经过的链路（可选·空态判定用；如 order 需 order_uses_model 边）。 */
  viaLinks: z.array(z.string()).optional(),
  /** 必需属性（可选·空态判定用；实例存在但关键属性缺 → 视为未就绪）。 */
  props: z.array(z.string()).optional(),
});
export type DataDependencyItem = z.infer<typeof DataDependencyItemSchema>;

export const DataDependencySchema = z.object({
  /** 需要的对象角色（就绪探测计数源）。 */
  requires: z.array(DataDependencyItemSchema),
  /** 必需的 SolverParam 键（可选）。 */
  params: z.array(z.string()).optional(),
  /** 必需可解析的切片键（可选）。 */
  slices: z.array(z.string()).optional(),
});
export type DataDependency = z.infer<typeof DataDependencySchema>;

/** 站③ 通用就绪探测输出：每角色 present-vs-needed（镜像沙盘 certification 形态·泛化到所有入口）。 */
export const ReadinessRoleStatusSchema = z.object({
  roleType: z.string(),
  /** 解析后的租户真实类型（无绑定=canonical 默认）。 */
  resolvedType: z.string(),
  present: z.number().int(),
  needed: z.number().int(),
  ok: z.boolean(),
});
export type ReadinessRoleStatus = z.infer<typeof ReadinessRoleStatusSchema>;

/**
 * 站③ 就绪探测报告：`ready`（可跑）+ present-vs-needed 明细 + 诚实缺口（复用 growth GapFinding/CL.3）。
 * 缺口喂 GROWTH-WORKLIST 看板（④·人工闸），不静默、不假值。
 */
export const EntryReadinessSchema = z.object({
  /** 入口引用（solver:<key> / scenario:<key> / view:<key>）。 */
  entryRef: z.string(),
  ready: z.boolean(),
  roles: z.array(ReadinessRoleStatusSchema),
  /** 缺参数键（清单声明但当前无 SolverParam）。 */
  missingParams: z.array(z.string()),
  /** 诚实缺口（复用 growth GapFinding·EMPTY_DATA/NO_SLICE…）→ 喂看板。 */
  gaps: z.array(GapFindingSchema),
  generatedAt: IsoTime,
});
export type EntryReadiness = z.infer<typeof EntryReadinessSchema>;

/**
 * 站① 填充引擎（comprehend LLM 倒推·design-time）产出的清单以及本 registry 均遵此形态。
 *
 * `SOLVER_DATADEP`：出厂求解器入口的**声明式数据依赖清单单一来源**（脊）。
 *  - 角色键为抽象角色（经 SolverBinding「context」域 role→真实类型解析）。
 *  - 上下文角色（base/line/…/carbonFactor）的**并集**驱动 datacore `loadContext`（治本读清单·非写死）；
 *    门 `datadep-manifest:check` 守「每个上下文角色被某清单覆盖」+「每个已注册求解器有清单」+「minRows≥1」。
 *  - `materialBalance` 等非上下文角色（mrp/order 直接 listByType 读）也可声明 → 就绪探测覆盖之，
 *    不影响 loadContext 并集（loadContext 只取角色∩上下文角色集）。
 *
 * 换行业 0 码改：本 registry 的 roleType 全为抽象角色，无业务常数；真实类型由 IndustryPack 的
 * SolverBinding 提供（INDUSTRY-PACK-CONVERGE）。
 */
export const SOLVER_DATADEP: Readonly<Record<string, DataDependency>> = Object.freeze({
  capacity_rollup: { requires: [r("base"), r("line"), r("process"), r("equipment"), r("model")] },
  capacity_forecast: { requires: [r("base"), r("line"), r("process"), r("equipment"), r("maintPlan"), r("model")] },
  bottleneck_matrix: { requires: [r("base"), r("line"), r("process"), r("equipment")] },
  risk_timeline: { requires: [r("base"), r("order"), r("shipment"), r("segment"), r("demandSegment"), r("sopVersion"), r("dataHealth")] },
  affected_orders: { requires: [r("base"), r("order"), r("model")] },
  plan_audit: { requires: [r("base"), r("segment"), r("sopVersion")] },
  plan_generate: { requires: [r("base"), r("segment"), r("sopVersion")] },
  capex_scenario: { requires: [r("base"), r("capexProject")] },
  order_fullchain: { requires: [r("order"), r("model"), r("demandSegment"), r("materialBalance")] },
  // QUERY30-ORCH Q01：急单挤占推演——读在手单/线级产能/型号目录（deriveArgs 从 c.orders/c.lines/c.models 装配）。
  what_if_displacement: { requires: [r("order"), r("line"), r("model")] },
  // QUERY30-ORCH Q01：多方案比较矩阵——纯聚合层，无 schemes 时 deriveArgs 复用 what_if_displacement 自对象图装配四型方案（同数据依赖）。
  multi_plan_compare: { requires: [r("order"), r("line"), r("model")] },
  mrp_netting: { requires: [r("materialBalance")] },
  finance_pnl: { requires: [r("segment"), r("sopVersion")] },
  audit_timeline: { requires: [r("dataHealth")] },
  countermeasure_combo: { requires: [r("base"), r("segment")] },
  mitigation_select: { requires: [r("base")] },
  cert_schedule: { requires: [r("model"), r("certification")] },
  kit_readiness: { requires: [r("material"), r("materialBatch")] },
  lta_gap: { requires: [r("material"), r("purchaseOrder")] },
  inventory_optimize: { requires: [r("material"), r("materialBatch")] },
  changeover_sequence: { requires: [r("line"), r("changeoverMatrix")] },
  yield_diagnosis: { requires: [r("process"), r("energyMeter")] },
  maintenance_stagger: { requires: [r("maintPlan"), r("equipment")] },
  outsourcing_split: { requires: [r("base"), r("order")] },
  quote_margin: { requires: [r("order"), r("customer")] },
  credit_exposure: { requires: [r("customer"), r("arInvoice")] },
  quarterly_gap: { requires: [r("segment"), r("sopVersion")] },
  carbon_footprint: { requires: [r("model"), r("carbonFactor")] },
});

/** 短构造器：结构性最小就绪 = 该角色 ≥1 行。 */
function r(roleType: string): DataDependencyItem {
  return { roleType, minRows: 1 };
}

/**
 * WO ONTO-SCEN-RENDER-PROJ ③：角色键 → 本体规范类型（canonical）的契约层投影。
 * 与 datacore `solvers/datadep-context.ts ROLE_CANONICAL` **逐键一致**（门 `datadep-manifest:check`
 * 读 datacore 编译产物对账，漂移即红）——放契约层是为让 agentcore 的切片目标派生
 * （`deriveSliceTargetCandidates`）不跨包 import datacore 源码（contracts-only-shared）。
 * 零业务常数（R14）：角色/类型键都是结构性本体键，非行业实体名。
 */
export const DATADEP_ROLE_CANONICAL: Readonly<Record<string, string>> = Object.freeze({
  base: "Base",
  line: "Line",
  process: "Process",
  equipment: "Equipment",
  maintPlan: "MaintPlan",
  model: "Model",
  order: "Order",
  shipment: "Shipment",
  segment: "Segment",
  dataHealth: "DataSourceHealth",
  demandSegment: "DemandSegment",
  sopVersion: "SopVersionRow",
  material: "Material",
  materialBatch: "MaterialBatch",
  customer: "Customer",
  arInvoice: "ARInvoice",
  certification: "Certification",
  energyMeter: "EnergyMeter",
  changeoverMatrix: "ChangeoverMatrix",
  capexProject: "CapexProject",
  purchaseOrder: "PurchaseOrder",
  carbonFactor: "CarbonFactor",
  materialBalance: "MaterialBalance",
});

/**
 * PRD-scenario-ontogenesis §2.2 P2（WO ③）：从求解器数据依赖清单**自动派生**切片目标候选
 * （root + 目标覆盖类型）——场景卡 `sliceTargets` 不再手焙。growScenario（O11）据此调
 * slice-planner（A3.3 确定性 BFS ⊕ A3.4 索引复用）规划真切片；planner 是可达性唯一裁判
 * （无本体链路的清单类型≠切片缺口——该类数据经清单就绪探测直读覆盖，规划时以可达子集收敛）。
 * 确定性（R6）：同 solverKey 同 primaryType 恒同输出（targets 排序）。
 */
export function deriveSliceTargetCandidates(
  solverKey: string,
  primaryType?: string,
): { rootType: string; targets: string[] } | null {
  const dep = SOLVER_DATADEP[solverKey];
  if (!dep || dep.requires.length === 0) return null;
  const types: string[] = [];
  for (const req of dep.requires) {
    const t = DATADEP_ROLE_CANONICAL[req.roleType] ?? req.roleType;
    if (!types.includes(t)) types.push(t);
  }
  const rootType = primaryType && types.includes(primaryType) ? primaryType : types[0]!;
  const targets = types.filter((t) => t !== rootType).sort();
  return { rootType, targets };
}
