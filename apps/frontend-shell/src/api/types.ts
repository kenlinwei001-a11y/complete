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
});
export type Workspace = z.infer<typeof WorkspaceSchema>;
/** schema 输入形态（契约形态/旧 mock 形态皆可），fixtures 用 */
export type WorkspaceInput = z.input<typeof WorkspaceSchema>;

// ---- dashboard 声明式 widget（ViewConfig.layout 内容，元数据驱动） ----

export interface DashboardWidgetDef {
  key: string;
  type: "kpi" | "chart" | "table";
  title: string;
  /** BLOCK 级 feature key（view.dash.widget.{key}），缺省不受控 */
  featureKey?: string;
  span?: number;
  query: WidgetQueryDef;
  /** 悬停溯源描述 */
  provenance?: { toolName: string; outputPath: string; snapshotVersion?: string; label?: string };
  unit?: string;
  chartKind?: "line" | "bar";
}

export type WidgetQueryDef =
  | { kind: "objects"; objectType: string; filter?: Record<string, unknown>; columns?: string[]; limit?: number }
  | { kind: "objects-aggregate"; objectType: string; agg: "count" | "sum" | "avg"; prop?: string; filter?: Record<string, unknown> }
  | { kind: "solver"; solverKey: string; args: Record<string, unknown>; valuePath?: string }
  | { kind: "timeseries"; seriesKey: string; entityIds: string[]; grain: "shift" | "day" | "week"; agg: string; days: number };

// ---- 对象查询（GET /a/v1/objects?type=&q=，前端 PRD §6.4） ----

export interface ObjectsPage {
  items: { id: string; type: string; props: Record<string, unknown> }[];
  total: number;
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
  sourceBindings?: { connId: string; dataset: string }[];
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
  qty: number; // 万套
  due: string;
  delay: number; // 天（取最大）
  risks: OrderRiskRefVM[];
}

export interface AffectedOrdersOutputVM {
  summary: { orderCount: number; totalQty: number; custCount: number; revenue: number };
  rows: AffectedOrderRowVM[];
  problems: OrderProblemGroup[];
}

// ---- 任务事件（SSE 帧形态，QOS-PRD §8.2） ----

export interface TaskEventFrame {
  id: string;
  event: string;
  data: Record<string, unknown>;
}
