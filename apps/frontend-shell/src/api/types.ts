/**
 * 本地视图模型类型（仅限 contracts 未覆盖的前端消费形态——契约缺口见交付报告；
 * 与契约重复的类型一律从 @platform/contracts 导入，禁止重新定义）。
 */
import { z } from "zod";

// ---- workspace（平台 PRD §6.1 + Entitlement 增量；contracts 未定义 → 本地 VM） ----

export const ViewConfigVMSchema = z.object({
  key: z.string(),
  title: z.string(),
  renderer: z.string().optional(),
  layout: z.record(z.string(), z.unknown()).optional(),
});
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
  navigation: z.array(z.object({ key: z.string(), label: z.string() })).default([]),
  views: z.array(ViewConfigVMSchema).default([]),
  scenarioPackages: z.array(z.string()).default([]),
  /** Entitlement 增量：解析后的生效功能集 + 配置版本 */
  features: z.array(z.string()).optional(),
  configVersion: z.number().int().optional(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

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

// ---- 任务事件（SSE 帧形态，QOS-PRD §8.2） ----

export interface TaskEventFrame {
  id: string;
  event: string;
  data: Record<string, unknown>;
}
