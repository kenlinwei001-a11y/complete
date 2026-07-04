import { z } from "zod";
import { IndustryTemplateSchema } from "./datacore.js";

// ---------------------------------------------------------------------------
// IndustryPack — 单一声明式行业包契约（P1 北极星 · R14 零跨文件电池硬编码收口）
// ---------------------------------------------------------------------------
//
// 缘起（AUDIT-hardcode-remnants §1 统一根因）：平台已 genericize 了「数据层」（BASE/SEG_REGISTRY
// 单源），但「派发层 / 结构层 / 阈值层 / 时间层 / 实体层」曾各自散落成电池硬编码——「换个行业/租户」
// 还得改 ~15 个文件。5 个前置 HARDCODE WO 各把一层从硬编码转为**可消费 descriptor**：
//   · 派发 → SolverDescriptor（solver-registry.ts SOLVER_REGISTRY，平台共享·R14 零业务常数）
//   · 结构 → ViewConfig.layout（viewlayout.ts KpiCardDef/DagLayerLayout/DagPalette）
//   · 阈值 → SolverParam（solvers.ts SolverParamsSchema · 默认值入 IndustryPack）
//   · 时间 → sim-clock t0（clockderive.ts DEFAULT_SIM_T0）
//   · 实体 → SEG/keywords/值域（base-registry.ts SEG_REGISTRY + classifySegment）
//
// 本契约把上述各层**收敛为单一声明式包**：作者写一份 `IndustryPack` = 全栈可装配。加载器
// （datacore synthetic/industry-pack.ts）在启动/租户绑定时消费 pack 装配全栈——**新增一个行业 =
// 写一份 IndustryPack，零跨文件代码改动**（logistics-warehouse 实证）。
//
// 设计铁律：**消费既有类型·不重定义·不再加一层间接**——
//   · `template` 直接复用既有 `IndustryTemplateSchema`（ontology/generation/rules/scenarioSeed.intents/
//      solverParams/features/tsGenerators/scenarioScript）——即「ontologySlices / params / intents」层的既有单源，
//      **不拆散重建**（拆散=rebuild 违 WO）。
//   · `solverKeys` 只**按 key 绑定**共享 `SOLVER_REGISTRY` descriptor（省略=全平台）——**不把平台共享
//      的 SolverDescriptor 复制进每个行业包**（那样既 redefine 又违「descriptor 平台共享·R14」）。
//   · `views` = ViewConfig.layout 视图结构（结构层）·`entities` = SEG（实体层）·`clock` = t0（时间层）。
// 字节一致（R6）：电池包各字段**引用**既有常量（BATTERY_TEMPLATE / BATTERY_SOLVER_PARAMS / SEG_REGISTRY /
//   VIEW_DEFS 片段），搬家不改值——现有测试断言不变即证。

/**
 * 应用细分实体（= base-registry.ts CanonicalSeg 的可校验镜像·实体层）。
 * 电池包 `entities.segments` 引用 SEG_REGISTRY（字节一致）；换行业换册即换分类语义（classifySegment 零改）。
 */
export const IndustrySegmentSchema = z.object({
  seg: z.string(),
  key: z.string(),
  priceWan: z.number(),
  marginPct: z.number(),
  floorPct: z.number(),
  color: z.string(),
  /** 客户名→细分归类关键词；`[]` = 兜底桶（无关键词命中时落桶）。 */
  keywords: z.array(z.string()),
});
export type IndustrySegment = z.infer<typeof IndustrySegmentSchema>;

/**
 * 视图定义（结构层 · = VIEW_DEFS 条目）：renderer + ViewConfig.layout 结构。
 * layout 承载 KPI 卡 / 列 / 字段组 / DAG 层拓扑等呈现结构（viewlayout.ts 契约的实例数据），
 * 前端渲染器迭代 config（非内联 JS 数组）；换租户/行业=换 pack.views 即界面跟着变（G-5 8a 收口）。
 */
export const IndustryViewDefSchema = z.object({
  title: z.string(),
  renderer: z.string(),
  layout: z.record(z.string(), z.unknown()).default({}),
  options: z.record(z.string(), z.unknown()).optional(),
});
export type IndustryViewDef = z.infer<typeof IndustryViewDefSchema>;

/**
 * 决策场景卡（C3 活体·非电池行业「完整 app 场景可答」）：一张卡 = 一个决策问题 + 声明式答案 query。
 * 答案由既有 dashboard 声明式 query 求解（objects-aggregate / objects / solver）——前端零写死，config-driven
 * （同 DashboardWidget query 通道；换行业换 pack.scenarios 即场景随之变，引擎零改 R14）。
 * `answer.kind==="solver"` 走求解器派发（descriptor 平台共享·pack 只按 key 绑定）——真 CP-SAT 需 OR-Tools sidecar；
 * 无 sidecar 环境用 objects-aggregate/objects 直答（确定性·真数据·浏览器可见）。
 */
export const IndustryScenarioSchema = z.object({
  key: z.string(),
  title: z.string(),
  /** 决策问题（场景卡问句）。 */
  question: z.string(),
  /** 答案声明式 query（复用 dashboard widget 语义·前端零写死 R14）。 */
  answer: z.object({
    kind: z.enum(["objects-aggregate", "objects", "solver"]),
    objectType: z.string().optional(),
    agg: z.enum(["sum", "avg", "count", "min", "max"]).optional(),
    prop: z.string().optional(),
    columns: z.array(z.string()).optional(),
    limit: z.number().optional(),
    solverKey: z.string().optional(),
    args: z.record(z.string(), z.unknown()).optional(),
    unit: z.string().optional(),
  }),
});
export type IndustryScenario = z.infer<typeof IndustryScenarioSchema>;

/**
 * 单一声明式行业包：作者写一份 = 加载器装配全栈（R14·零跨文件电池硬编码）。
 *
 * 层映射（WO 北极星形态 → 本契约字段·单源不漂）：
 *   industryKey        → industryKey
 *   ontologySlices     → template.ontology（+ template.generation 生成规约）
 *   params(阈值)        → template.solverParams（SolverParam 默认值·单源，pack 不另存以防漂移）
 *   intents            → template.scenarioSeed.intents（authoring 意图·运行期 reconcile 为 MaterializedIntent）
 *   solverDescriptors  → solverKeys（绑定共享 SOLVER_REGISTRY·省略=全平台）
 *   viewLayouts(结构)   → views
 *   entities(实体)      → entities.segments
 *   clock/t0(时间)      → clock.t0（= template.solverParams.forecastStart 权威·此处显式暴露供加载器/时钟派生消费）
 */
export const IndustryPackSchema = z.object({
  /** 行业键（= template.industryKey·加载器路由键）。 */
  industryKey: z.string(),
  /** 数据/本体/生成/规则/意图/阈值层：复用既有 IndustryTemplate 束（不拆散重建）。 */
  template: IndustryTemplateSchema,
  /**
   * 派发层：本行业栈消费的平台求解器 descriptor **键**（绑定共享 `SOLVER_REGISTRY`）。
   * 省略 = 消费全平台求解器（电池包用全集）。**不复制 SolverDescriptor 进包**（R14 平台共享）。
   */
  solverKeys: z.array(z.string()).optional(),
  /** 结构层：viewKey → 视图定义（ViewConfig.layout 承载 KPI/列/字段组/DAG 结构）。 */
  views: z.record(z.string(), IndustryViewDefSchema).default({}),
  /**
   * 决策场景层（C3 活体）：本行业 app 可答的决策场景卡（问题 + 声明式答案 query）。
   * 加载器把 pack.scenarios 物化为「决策场景」视图（renderer=dashboard·config-driven）——换行业换 pack.scenarios。
   * 省略/空 = 无专属场景（电池走既有推演视图·此字段默认 `[]` 保持 batteryPack 不变）。
   */
  scenarios: z.array(IndustryScenarioSchema).default([]),
  /** 实体层：应用细分/关键词/值域（SEG）。换行业换册=换分类语义（classifySegment 逻辑零改）。 */
  entities: z
    .object({
      segments: z.array(IndustrySegmentSchema).default([]),
    })
    .default({ segments: [] }),
  /** 时间层：模拟时钟 t0 默认（权威=template.solverParams.forecastStart；此处显式暴露给加载器/时钟派生）。 */
  clock: z.object({ t0: z.string() }),
});
export type IndustryPack = z.infer<typeof IndustryPackSchema>;
