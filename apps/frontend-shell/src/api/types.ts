/**
 * 本地视图模型类型（仅限 contracts 未覆盖的前端消费形态——契约缺口见交付报告；
 * 与契约重复的类型一律从 @platform/contracts 导入，禁止重新定义）。
 */
import { z } from "zod";

// ---- workspace（平台 PRD §6.1 + Entitlement 增量；contracts 未定义 → 本地 VM） ----

// 真实后端按 contracts WorkspaceSchema 下发（viewKey/name、scenarioPackages 对象数组、
// navigation 带 group）；本 VM 兼容两种形态并归一化为前端消费形态（key/title/字符串包 id）。
export const ViewConfigVMSchema = z
  .object({
    viewKey: z.string().optional(),
    key: z.string().optional(),
    name: z.string().optional(),
    title: z.string().optional(),
    renderer: z.string().optional(),
    layout: z.record(z.string(), z.unknown()).optional(),
    /** renderer 专属配置（如图谱视角 graphOptions —— 契约 ViewConfig.options） */
    options: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => Boolean(v.viewKey ?? v.key), { message: "view requires viewKey or key" })
  .transform((v) => ({
    key: (v.viewKey ?? v.key) as string,
    title: v.name ?? v.title ?? ((v.viewKey ?? v.key) as string),
    renderer: v.renderer,
    layout: v.layout,
    options: v.options,
  }));
export type ViewConfigVM = z.infer<typeof ViewConfigVMSchema>;

export const WorkspaceSchema = z.object({
  tenant: z.object({ id: z.string(), name: z.string().optional(), industry: z.string().optional() }),
  user: z
    .object({
      id: z.string(),
      username: z.string(),
      roles: z.array(z.string()),
      attributes: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  theme: z.record(z.string(), z.unknown()).default({}),
  navigation: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        viewKey: z.string().optional(),
        group: z.enum(["business", "admin"]).optional(),
      }),
    )
    .default([]),
  views: z.array(ViewConfigVMSchema).default([]),
  /** 契约形态为 [{id,name}]，旧 mock 形态为 string[]；归一化为 id 字符串数组 */
  scenarioPackages: z
    .array(z.union([z.string(), z.object({ id: z.string() }).loose()]))
    .default([])
    .transform((arr) => arr.map((p) => (typeof p === "string" ? p : p.id))),
  /** Entitlement 增量：解析后的生效功能集 + 配置版本 */
  features: z.array(z.string()).optional(),
  configVersion: z.number().int().optional(),
  /** 去电池锁死（R14）：按租户/行业下发的项目推演配置（型号/地址/物流），替代前端写死常量 */
  simConfig: z
    .object({
      models: z.array(z.string()).optional(),
      addresses: z.array(z.string()).optional(),
      logistics: z.record(z.string(), z.number()).optional(),
    })
    .optional(),
  /** 去电池锁死（R14）：S&OP KPI 阈值 + 需求三段（按租户/行业），替代前端写死 */
  sopConfig: z
    .object({
      gapRed: z.number().optional(),
      cashFloor: z.number().optional(),
      revBudget: z.number().optional(),
      segments: z
        // WO-P50-REMAINING-3：三线对照全列口径 = **万套/月**（分母是月，不是年）；
        // 分位列名自带口径，不留裸 `p90`（那个名字在本仓背过 6 个量纲）。
        .array(z.object({ key: z.string(), name: z.string(), target: z.number(), rolling: z.number(), rollingWanPerMonthP90: z.number().optional(), lastActual: z.number() }))
        .optional(),
      /** 决议增量默认项（去电池锁死 R14：按租户/行业下发，替代前端写死电池决议名）。 */
      defaultResolutions: z.array(z.object({ name: z.string(), delta: z.number() })).optional(),
    })
    .optional(),
  /** 去电池锁死（R14）：规划建议的经营目标默认值（按租户/行业），替代前端写死 */
  planGoals: z
    .object({
      revGrowthPct: z.number().optional(),
      gmFloorPct: z.number().optional(),
      sharePts: z.number().optional(),
      capexCap: z.number().optional(),
      cashFloor: z.number().optional(),
      invTurns: z.number().optional(),
    })
    .optional(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;
/** schema 输入形态（契约形态/旧 mock 形态皆可），fixtures 用 */
export type WorkspaceInput = z.input<typeof WorkspaceSchema>;

// ---- dashboard 声明式 widget（ViewConfig.layout 内容，元数据驱动） ----

export interface DashboardWidgetDef {
  key: string;
  type: "kpi" | "chart" | "table" | "summary" | "dag" | "metric-strip" | "counterfactual" | "version-toggle" | "order-ledger" | "plan-drill";
  title: string;
  /** BLOCK 级 feature key（view.dash.widget.{key}），缺省不受控 */
  featureKey?: string;
  span?: number;
  query: WidgetQueryDef;
  /** 悬停溯源描述 */
  provenance?: { toolName: string; outputPath: string; snapshotVersion?: string; label?: string };
  unit?: string;
  /**
   * 值是 0~1 的**小数比率**（需 ×100 才是 `unit` 声明的那个单位），缺省 = 值已是 `unit` 的数。
   *
   * 存在的理由：本仓同为 `unit:"%"` 的属性量纲相反 —— 2026-08-28 实测 `Base.util` 70~88（百分点）、
   * `Line.schedule_attainment` 0.879~0.949（比率）。
   * 复验：`GET /a/v1/objects?type=Base` 与 `?type=Line` 各取一页看这两个属性的取值区间。
   * **光看 unit 分不出来**，光看取值范围
   * 更分不出来（一个已是百分点的量取值恰为 1 时，与 100% 长得一模一样）。故量纲必须由
   * 下发方显式声明，不许前端猜。
   */
  ratio?: boolean;
  /**
   * WO-DASH-ONHAND · 卡片**口径副标题**（下发方声明，前端零写死 R14）。
   *
   * 存在的理由是实测出来的病（**2026-08-29 实测**，真后端内存态 `SEED_DEMO=1`）：
   * 修前同屏「AOP 基准营收 601.50 亿」与全簿订单额 507.26 亿差 15.7%，而屏上**没有一个字**
   * 说明它们不是一个账（一个是年度计划口径、一个是订单簿口径）；修前「在手订单」与台账
   * 那个叫「全部」的 chip 同样是两个口径顶着同一个词。
   * 数字本身没错的时候，缺的就是这一行 —— 所以它是 widget 的**一等字段**，不是样式。
   *
   * 复验方式（两条命令，带 `X-Debug-User: demo:admin:admin|planner|catalog_admin`）：
   *  · `POST /a/v1/solvers/cockpit_kpi/invoke {"args":{}}` → `data.aopBaseRev` 实测 **601.5**（亿·计划口径）
   *  · `POST /a/v1/objects/aggregate {"typeKey":"Order","groupBy":[],"metrics":[{"prop":"value","fn":"sum"}]}`
   *    → `rows[0].metrics.sum_value` 实测 **50,725,911,442**（= 507.26 亿·订单簿口径）
   * 比值 0.843；两本账有桥、不是对不上，故**只标注不对齐**（口径判定见 `synthetic/service.ts` 的 `aop-base` widget 头注）。
   */
  caption?: string;
  chartKind?: "line" | "bar" | "trideviation";
  /** 三线偏差复合图（trideviation）的系列声明：data 各项的数值字段 → 线名/色。 */
  chartSeries?: { key: string; name: string; color?: string }[];
}

export type WidgetQueryDef =
  | { kind: "objects"; objectType: string; filter?: Record<string, unknown>; columns?: string[]; limit?: number }
  | { kind: "objects-aggregate"; objectType: string; agg: "count" | "sum" | "avg"; prop?: string; filter?: Record<string, unknown> }
  | { kind: "solver"; solverKey: string; args: Record<string, unknown>; valuePath?: string }
  | { kind: "timeseries"; seriesKey: string; entityIds: string[]; grain: "shift" | "day" | "week"; agg: string; days: number }
  // 运营态出厂配置增量 §4.1：驾驶舱历史 widget（数据源 = GET /a/v1/history/bundle 字段）
  | { kind: "history"; field: "trend" | "onTimeRate" | "executedCount" | "delivered" | "deviation"; columns?: string[] };

// ---- 对象查询（GET /a/v1/objects?type=&q=，前端 PRD §6.4） ----

export interface ObjectsPage {
  items: { id: string; type: string; props: Record<string, unknown> }[];
  /**
   * **符合条件的总行数**（与 page / pageSize 无关，也与服务端任何内部读上限无关）。
   * 曾被服务端一个 ≤1000 的硬顶夹住：`EquipmentOEE` 自报 1000 而真值 5460，
   * 且调用方无从察觉 —— `total` 正是唯一的检测手段，而它自己被截断。已修。
   */
  total: number;
  /**
   * `true` = 匹配行数撞上了服务端安全上限，`total` 只是**已知下界**，不是真值。
   * 屏上凡显示 `total` 的地方都必须把这一位显示出来（写成「≥N」而不是「N」），
   * 否则就退回成同一个病：给了错的数、而调用方看不出来。
   */
  totalIsLowerBound?: boolean;
  /**
   * 本次**生效**的页号 / 页长（不是请求值）。请求的 `pageSize` 可能被服务端夹到上限
   * （现为 500），拿请求值去算「还有没有下一页」会算错，所以以这两个回显值为准。
   */
  page?: number;
  pageSize?: number;
  /**
   * 还有没有下一页。**判断截断优先用它**，别自己写 `page * pageSize < total` ——
   * 那道算术在 `pageSize` 被夹时必错，而且每个调用方都要重写一遍。
   */
  hasMore?: boolean;
  /** 服务端对本次请求的提示（如 pageSize 被夹到上限、传了它不认识的查询参数）。不该被静默丢掉。 */
  warnings?: string[];
}

// ---- 本体图谱（GET /a/v1/ontology/graph） ----

export interface GraphNodeVM {
  id: string;
  key: string;
  label: string;
  kind: "object" | "solver" | "agent";
  domain: string;
  tier?: number;
  /** 数据来源视角（§7.18 colorBy=source）：ERP/MES/IoT/… 派生/求解/智能体 视为非源数据淡出 */
  sourceSystem?: string;
  /** MVP 视角缺口节点（⊕ 虚线强调） */
  mvpGap?: boolean;
  properties?: { propKey: string; dataType: string; isPrimaryKey?: boolean }[];
  /** fieldMappings: propKey → 源字段名（字段全建模覆盖 + CSV 模版来源）。 */
  sourceBindings?: { connId: string; dataset: string; fieldMappings?: Record<string, string> }[];
  rules?: { key: string; name: string; expression: string }[];
  derivations?: { propKey: string; formula: string }[];
}

export interface GraphEdgeVM {
  id: string;
  from: string;
  to: string;
  label?: string;
  /** 边类型（§7.18 linkKinds 过滤）：rel/flow/agg/solve/fb/orch */
  kind?: string;
}

export interface OntologyGraphVM {
  nodes: GraphNodeVM[];
  edges: GraphEdgeVM[];
}

// ---- 合成数据作业（六阶段轮询形态） ----

export interface SyntheticJobVM {
  id: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  phase: number; // 0-5（六阶段）
  phases: { name: string; status: "PENDING" | "RUNNING" | "DONE" | "FAILED" }[];
  report?: SyntheticReportVM;
  error?: string;
}

export interface SyntheticReportVM {
  rowCounts: Record<string, number>;
  ruleScan: { ruleKey: string; evaluated: number; violations: number }[];
  derivationSpotChecks: { typeKey: string; propKey: string; ok: boolean }[];
  timeseries?: { seriesKey: string; points: number; gaps: number; aggSpotCheckOk: boolean }[];
}

// ---- 模拟时钟（A8 §6.2/6.3） ----

export interface SimClockVM {
  simDate: string;
  currentTick: number;
  status: "ACTIVE" | "RESETTING" | "TICKING";
  script: { tick: number; event: string; fired: boolean }[];
}

export interface TickReportVM {
  tick: number;
  simDate: string;
  newPoints: number;
  changedProps: { object: string; prop: string; from: number; to: number }[];
  newAlerts: { ruleKey: string; message: string }[];
  clearedAlerts: string[];
  forecastDeviation?: number;
}

// ---- S&OP 月度版本（DataCore /a/v1/sop/versions，契约只定义状态枚举 → 本地 VM） ----

import type { SopVersionStatus } from "@platform/contracts";

export interface SopVersionVM {
  id: string;
  month: string;
  status: SopVersionStatus;
  inputs: Record<string, unknown>;
  steps: {
    s1?: Record<string, unknown>;
    s2?: Record<string, unknown>;
    s3?: Record<string, unknown>;
    s4?: Record<string, unknown>;
    s5?: Record<string, unknown>;
  };
  agenda: { source: string; title: string; detail?: Record<string, unknown> }[];
  resolutions: { name: string; delta: number }[];
  supFinal?: number;
  /** 增量 §7.12：定稿 Action 草稿已创建、待审批（EXECUTED → FINAL 时清除） */
  pendingApproval?: { draftId: string } | null;
  createdAt: string;
  updatedAt: string;
}

// ---- 兜底统计 ----

export interface FallbackClusterVM {
  traceId: string;
  querySample: string;
  count: number;
  lastSeen: string;
  outcomeBreakdown: Record<string, number>;
  topToolSketch: string[];
  trend: number[];
}

// ---- 同步作业 / 上传 ----

export interface SyncJobVM {
  id: string;
  connId: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  rowCounts: Record<string, number>;
  error?: string;
}

// ---- 订单全链聚合（§7.16：affected_orders 求解输出扩展形态；problems[] 用契约 schema） ----

import type { OrderProblemGroup } from "@platform/contracts";

/** 受影响订单行上的风险点引用（与 risk-board RiskPopover 共用数据形态） */
export interface OrderRiskRefVM {
  base: string;
  factor: string;
  crossDay: number | null;
  peak: number;
  series?: number[];
  threshold?: number;
}

export interface AffectedOrderRowVM {
  so: string;
  cust: string;
  seg: string;
  model: string;
  qty: number; // 套（WO-UNIT-NORMALIZE §3：Order.qty 单位规范=套）
  due: string;
  delay: number; // 天（取最大）
  risks: OrderRiskRefVM[];
}

export interface AffectedOrdersOutputVM {
  summary: { orderCount: number; totalQty: number; custCount: number; revenue: number };
  rows: AffectedOrderRowVM[];
  problems: OrderProblemGroup[];
  /**
   * WO-DASH-ONHAND ②：聚合分支（无 baseId）回带的**交期窗口**——「本表在列什么」的天数取自此处。
   * 单基地分支不回带 ⇒ optional；缺省时前端只说口径不报天数（**不许编一个数**）。
   */
  window?: { fromDay: number; toDay: number; forecastStart: string };
}

// ---- 任务事件（SSE 帧形态，QOS-PRD §8.2） ----

export interface TaskEventFrame {
  id: string;
  event: string;
  data: Record<string, unknown>;
}

// ---- WO-BEFE-B · 行动与审批 / 调度 / 工厂日历（契约未定义 → 本地 VM） ----
//
// 为什么是本地 VM 而不是 `@platform/contracts`：这三组的后端记录类型住在
// `apps/datacore/src/domain.ts`（`ScheduledJobRecord` / `SchedulerRunRecord`）与
// `actions.ts` 的 `audit()` 返回上，**从未进过契约包**。contracts-only-shared 禁止跨 app
// 引源码，故按本文件既有惯例（`TickReportVM` 等）在前端侧定义消费形态。
// ⚠️ 这不是「契约已有还重定义」——落在契约里的 `ActionDraft` / `FactoryCalendar` 仍从
// `@platform/contracts` 导入，本处只补契约**没有**的那几个形状。

/** `GET /a/v1/action-drafts/:id/audit` 响应（后端 `actions.ts:822`）。 */
export interface ActionDraftAuditVM {
  draft: unknown;
  steps: {
    seq: number;
    role: string;
    decision?: "APPROVE" | "REJECT";
    approverId?: string;
    comment?: string;
    decidedAt?: string;
    selfApproved?: boolean;
  }[];
  /** 执行结果；未执行 = `null`（诚实空，前端必须显「未执行」而不是空对象）。 */
  executionResult: unknown | null;
  /** 后端 outbox 里 `action.*` 事件按时间正序（R4 留痕的真凭据）。 */
  events: { event: string; payload: Record<string, unknown>; at: string; status?: string }[];
}

/** `GET /a/v1/scheduler/jobs`（后端 `domain.ts:786 ScheduledJobRecord`）。 */
export interface ScheduledJobVM {
  id: string;
  tenantId: string;
  kind: string;
  refId: string;
  cron: string;
  timezone: string;
  nextRunAt: string;
  lastRunAt?: string;
  status: "ACTIVE" | "PAUSED";
  lastError?: string;
}

/** `GET /a/v1/scheduler/jobs/:id/runs`（后端 `domain.ts:799 SchedulerRunRecord`）。 */
export interface SchedulerRunVM {
  id: string;
  tenantId: string;
  jobId: string;
  scheduledAt: string;
  startedAt?: string;
  finishedAt?: string;
  status: string;
  error?: string;
}

/** `GET /a/v1/calendars/:key/net-window`（后端 `app.ts:1304`）。 */
export interface CalendarNetWindowVM {
  calendarKey: string;
  from: string;
  to: string;
  netProductionDays: number;
}
