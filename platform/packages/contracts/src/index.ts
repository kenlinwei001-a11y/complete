/** 共享契约（骨架版）——与 PRD 字段名保持一致，团队扩展时勿改既有字段 */

export interface AuthCtx { tenantId: string; userId: string; roles: string[]; attributes: Record<string, string | string[]> }

export interface ObjectRef { objectType: string; objectId: string; label?: string }
export interface SessionContext {
  view: string;
  selectedObjects: ObjectRef[];
  filters: Record<string, string | string[]>;
  timeWindow?: { from: string; to: string };
  conversationId?: string;
}

export type TaskStatus = "ROUTING" | "AWAITING_CLARIFICATION" | "EXECUTING_WORKFLOW" | "EXECUTING_AGENT" | "COMPLETED" | "FAILED" | "CANCELLED";

export type AnswerBlock =
  | { type: "text"; markdown: string }
  | { type: "table"; columns: string[]; rows: (string | number | null)[][]; provId: string }
  | { type: "kpi"; label: string; value: string; unit?: string; provId: string }
  | { type: "rule_violation"; ruleId: string; severity: string; explanation: string; provId: string }
  | { type: "action_draft"; draftId: string; actionType: string; summary: string };

export interface ProvenanceRef { id: string; source: "TOOL_RESULT"; toolCallId: string; toolName: string; outputPath: string; snapshotVersion?: string }

export interface Answer {
  trustLevel: "VERIFIED_WORKFLOW" | "AGENT_EXPLORATORY";
  blocks: AnswerBlock[];
  provenance: ProvenanceRef[];
  unverifiedNumerics: boolean;
}

export interface QueryTask {
  id: string; tenantId: string; userId: string; packageId: string; conversationId: string;
  query: string; context: SessionContext; status: TaskStatus;
  path?: "WORKFLOW" | "AGENT";
  classification?: { candidates: { intentKey: string; confidence: number }[]; outOfCatalog: boolean; extractedSlots: Record<string, unknown>; latencyMs: number; model: string };
  matchedIntent?: { intentKey: string; version: number };
  slots?: Record<string, unknown>;
  clarificationRounds: number;
  answer?: Answer;
  error?: { code: string; message: string; stepId?: string };
  resolvedRefs: { kind: string; key: string; version: number | string }[];
  createdAt: string; completedAt?: string;
}

export type SceneMode = "WORKFLOW_FIRST" | "WORKFLOW_ONLY" | "AGENT_FIRST" | "AGENT_ONLY";
export interface SceneEntryConfig {
  viewKey: string; mode: SceneMode; defaultAgentKey?: string;
  intentCatalogFilter?: string[];
  uiHints: { placeholder: string; suggestedQuestions: string[] };
}

export interface SlotDef {
  name: string; type: "string" | "number" | "date" | "timeWindow" | "objectRef" | "enum";
  required: boolean; enumValues?: string[]; defaultFrom?: string; clarifyPrompt?: string; description: string;
}
export interface IntentDefinition {
  key: string; version: number; name: string; description: string; examples: string[];
  enabledViews: string[] | "*"; slots: SlotDef[]; planKey: string;
  riskLevel: "READ" | "COMPUTE" | "ACTION_DRAFT";
}

export type PlanStep =
  | { id: string; type: "query_objects"; params: { objectType: string; filter: Record<string, unknown>; limit?: number } }
  | { id: string; type: "invoke_solver"; params: { solverKey: string; args: Record<string, unknown> } }
  | { id: string; type: "evaluate_rules"; params: { ruleIds: string[]; payload: unknown } }
  | { id: string; type: "render_answer"; params: { blocks: unknown[] } };
export interface ExecutionPlan { key: string; version: number; steps: PlanStep[] }

export interface AgentDefinition {
  key: string; version: number; name: string; model: string; systemPrompt: string;
  tools: string[];                    // 内置工具名（骨架版；MCP/workflow 引用由团队扩展）
  scopeDeclaration: { objectTypes: string[]; toolNames: string[] };
  budget: { maxIterations: number; maxToolCalls: number; maxSolverCalls: number; maxDurationMs: number };
}

export interface RuleVerdict { ruleId: string; passed: boolean; severity: "BLOCK" | "WARN"; explanation: string }
export interface ToolPayload { data: unknown; snapshotVersion: string }

/** SSE 事件名（与 QOS-PRD §8.2 一字不差） */
export type TaskEventName =
  | "task.accepted" | "routing.completed" | "clarification.required"
  | "step.started" | "step.completed" | "answer.final"
  | "action_draft.created" | "task.failed" | "task.cancelled";
