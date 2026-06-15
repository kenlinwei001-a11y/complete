import { z } from "zod";

// ---------------------------------------------------------------------------
// 平台 PRD §6.1 / 前端 PRD §4.1：GET /a/v1/me/workspace 响应契约
// （前端真连对齐批次补定；renderer 为开放字符串，经前端 renderer 注册表分发）
// ---------------------------------------------------------------------------

export const ViewConfigSchema = z.object({
  viewKey: z.string(),
  name: z.string(),
  /** "dashboard" | "ontology-graph" | "risk-board" | "ledger" | "plan-audit" | "plan-generate" | "project-sim" | "sop-balance" | … */
  renderer: z.string(),
  /** renderer 专属声明式配置（如 dashboard 的 widget 布局） */
  layout: z.record(z.string(), z.unknown()).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
});
export type ViewConfig = z.infer<typeof ViewConfigSchema>;

export const NavigationItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  viewKey: z.string().optional(),
  group: z.enum(["business", "admin"]).default("business"),
});
export type NavigationItem = z.infer<typeof NavigationItemSchema>;

export const WorkspaceSchema = z.object({
  tenant: z.object({ id: z.string(), name: z.string() }),
  user: z.object({
    id: z.string(),
    username: z.string(),
    roles: z.array(z.string()),
    attributes: z.record(z.string(), z.unknown()).optional(),
  }),
  theme: z.record(z.string(), z.string()).default({}),
  navigation: z.array(NavigationItemSchema),
  views: z.array(ViewConfigSchema),
  scenarioPackages: z.array(
    z.object({ id: z.string(), name: z.string() }).catchall(z.unknown()),
  ),
  /** Entitlement 增量：解析后的生效功能集 + 配置版本 */
  features: z.array(z.string()),
  configVersion: z.number().int(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;
