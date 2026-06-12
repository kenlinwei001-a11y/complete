import { z } from "zod";
import { AgentBudgetSchema, PlanStepSchema } from "./qos.js";
import { JsonSchemaObject } from "./common.js";

// ---------------------------------------------------------------------------
// 平台 PRD §8.1 B1 Agent 注册表
// ---------------------------------------------------------------------------

export const AgentToolRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("BUILTIN"), name: z.string() }),
  z.object({
    kind: z.literal("MCP"),
    mcpConfigId: z.string(),
    toolFilter: z.array(z.string()).optional(),
  }),
  z.object({
    kind: z.literal("WORKFLOW"),
    workflowId: z.string(),
    version: z.union([z.number().int(), z.literal("latest")]),
  }),
]);
export type AgentToolRef = z.infer<typeof AgentToolRefSchema>;

export const AgentDefinitionSchema = z.object({
  id: z.string(), // agt_
  tenantId: z.string(),
  key: z.string(),
  version: z.number().int(),
  name: z.string(),
  description: z.string(),
  model: z.string().default("claude-opus-4-8"),
  systemPrompt: z.string(),
  tools: z.array(AgentToolRefSchema),
  ruleBindings: z.object({
    ruleKeys: z.union([z.array(z.string()), z.literal("ALL_APPLICABLE")]),
    mode: z.enum(["PRE_CHECK", "POST_CHECK", "BOTH"]),
  }),
  skills: z.array(
    z.object({
      skillId: z.string(),
      version: z.union([z.number().int(), z.literal("latest")]),
    }),
  ),
  mcpServers: z.array(z.object({ mcpConfigId: z.string() })),
  scopeDeclaration: z.object({
    objectTypes: z.array(z.string()),
    toolNames: z.array(z.string()),
  }),
  budget: AgentBudgetSchema.partial().optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "RETIRED"]),
});
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

// ---------------------------------------------------------------------------
// 平台 PRD §8.2 B2 Workflow（独立于 QOS ExecutionPlan 的租户级工作流定义；additive）
// ---------------------------------------------------------------------------

export const WorkflowDefinitionSchema = z.object({
  id: z.string(), // wf_
  tenantId: z.string(),
  key: z.string(),
  version: z.number().int(),
  name: z.string(),
  description: z.string().optional(),
  /** JSON Schema describing the workflow inputs（暴露为 agent 工具时的 input_schema） */
  inputs: JsonSchemaObject,
  steps: z.array(PlanStepSchema).min(1).max(12),
  status: z.enum(["DRAFT", "PUBLISHED", "RETIRED"]),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

// ---------------------------------------------------------------------------
// 平台 PRD §8.3 B3 MCP
// ---------------------------------------------------------------------------

export const McpServerConfigSchema = z.object({
  id: z.string(), // mcp_
  tenantId: z.string(),
  name: z.string(),
  transport: z.discriminatedUnion("type", [
    z.object({ type: z.literal("streamable_http"), url: z.string() }),
    z.object({ type: z.literal("stdio"), command: z.string(), args: z.array(z.string()) }),
  ]),
  credentialRef: z.string().optional(),
  status: z.enum(["ACTIVE", "DISABLED"]),
});
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

// ---------------------------------------------------------------------------
// 平台 PRD §8.4 B4 Skill 库
// ---------------------------------------------------------------------------

export const SkillDefinitionSchema = z.object({
  id: z.string(), // skl_
  tenantId: z.string(),
  key: z.string(),
  version: z.number().int(),
  name: z.string(),
  summary: z.string().max(400),
  body: z.string().max(50_000),
  resources: z.array(z.object({ name: z.string(), blobKey: z.string() })),
  status: z.enum(["DRAFT", "PUBLISHED"]),
});
export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>;

// ---------------------------------------------------------------------------
// 平台 PRD §8.5 B5 场景入口模式
// ---------------------------------------------------------------------------

export const SceneEntryModeSchema = z.enum([
  "WORKFLOW_FIRST",
  "WORKFLOW_ONLY",
  "AGENT_FIRST",
  "AGENT_ONLY",
]);
export type SceneEntryMode = z.infer<typeof SceneEntryModeSchema>;

export const SceneEntryConfigSchema = z.object({
  id: z.string(), // scn_
  tenantId: z.string(),
  viewKey: z.string(),
  mode: SceneEntryModeSchema,
  defaultAgentId: z.string().optional(),
  intentCatalogFilter: z.array(z.string()).optional(),
  uiHints: z.object({
    placeholder: z.string(),
    suggestedQuestions: z.array(z.string()),
  }),
});
export type SceneEntryConfig = z.infer<typeof SceneEntryConfigSchema>;
