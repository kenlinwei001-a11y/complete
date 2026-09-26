import { z } from "zod";
import { JsonSchemaObject } from "./common.js";
import { OnErrorSchema, TemplateValueSchema } from "./qos.js";

// ---------------------------------------------------------------------------
// WO-A · No-code Plan Builder Canvas ↔ PlanDSL
// Canvas 是 PlanDSL 的可视化编辑层；PlanDSL 编译产物 = 现有 ExecutionPlan。
// ---------------------------------------------------------------------------

export const PlanBuilderNodeTypeSchema = z.enum([
  "INPUT",
  "SOLVER",
  "TRANSFORM",
  "CONDITION",
  "LOOP",
  "MERGE",
  "OUTPUT",
]);
export type PlanBuilderNodeType = z.infer<typeof PlanBuilderNodeTypeSchema>;

export const PlanBuilderPositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});
export type PlanBuilderPosition = z.infer<typeof PlanBuilderPositionSchema>;

export const PlanBuilderNodeSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string(),
    type: z.literal("INPUT"),
    label: z.string(),
    position: PlanBuilderPositionSchema,
    outputSchema: JsonSchemaObject.optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("SOLVER"),
    label: z.string(),
    position: PlanBuilderPositionSchema,
    solverKey: z.string(),
    args: z.record(z.string(), TemplateValueSchema).default({}),
    timeoutMs: z.number().int().optional(),
    onError: OnErrorSchema.optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("TRANSFORM"),
    label: z.string(),
    position: PlanBuilderPositionSchema,
    stepType: z.enum([
      "resolve_slice",
      "query_objects",
      "evaluate_rules",
      "llm_compose",
      "invoke_mcp_tool",
    ]),
    params: z.record(z.string(), TemplateValueSchema).default({}),
    timeoutMs: z.number().int().optional(),
    onError: OnErrorSchema.optional(),
  }),
  // Phase 2 才支持实际编译；Phase 1 schema 占位，编译时返回不支持错误。
  z.object({
    id: z.string(),
    type: z.literal("CONDITION"),
    label: z.string(),
    position: PlanBuilderPositionSchema,
    expr: z.string(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("LOOP"),
    label: z.string(),
    position: PlanBuilderPositionSchema,
    over: z.string(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("MERGE"),
    label: z.string(),
    position: PlanBuilderPositionSchema,
    strategy: z.enum(["concat", "sum", "zip"]),
  }),
  z.object({
    id: z.string(),
    type: z.literal("OUTPUT"),
    label: z.string(),
    position: PlanBuilderPositionSchema,
    blocks: z.array(z.record(z.string(), z.unknown())).default([]),
  }),
]);
export type PlanBuilderNode = z.infer<typeof PlanBuilderNodeSchema>;

export const PlanBuilderEdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
});
export type PlanBuilderEdge = z.infer<typeof PlanBuilderEdgeSchema>;

export const PlanDSLSchema = z.object({
  version: z.literal("1"),
  nodes: z.array(PlanBuilderNodeSchema).min(1),
  edges: z.array(PlanBuilderEdgeSchema).default([]),
});
export type PlanDSL = z.infer<typeof PlanDSLSchema>;

export const PlanBuilderCanvasSchema = z.object({
  id: z.string(), // pbc_
  tenantId: z.string(),
  packageId: z.string(),
  key: z.string(),
  version: z.number().int(),
  name: z.string(),
  description: z.string().optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "RETIRED"]),
  dsl: PlanDSLSchema,
  compiledPlanId: z.string().optional(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
});
export type PlanBuilderCanvas = z.infer<typeof PlanBuilderCanvasSchema>;

export const CreatePlanBuilderBodySchema = PlanBuilderCanvasSchema.omit({
  id: true,
  tenantId: true,
  packageId: true,
  version: true,
  status: true,
  compiledPlanId: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
});
export type CreatePlanBuilderBody = z.infer<typeof CreatePlanBuilderBodySchema>;

export const UpdatePlanBuilderBodySchema = CreatePlanBuilderBodySchema.partial();
export type UpdatePlanBuilderBody = z.infer<typeof UpdatePlanBuilderBodySchema>;

export const PlanBuilderCompileResultSchema = z.object({
  ok: z.boolean(),
  plan: z.record(z.string(), z.unknown()).optional(),
  errors: z.array(
    z.object({
      code: z.string(),
      message: z.string(),
      nodeId: z.string().optional(),
    }),
  ),
});
export type PlanBuilderCompileResult = z.infer<typeof PlanBuilderCompileResultSchema>;

export const PlanBuilderPublishResultSchema = z.object({
  ok: z.boolean(),
  canvas: PlanBuilderCanvasSchema,
  plan: z.record(z.string(), z.unknown()).optional(),
  errors: z.array(z.object({ code: z.string(), message: z.string(), nodeId: z.string().optional() })),
  impact: z
    .object({
      agents: z.number().int(),
      plans: z.number().int(),
      intents: z.number().int(),
    })
    .default({ agents: 0, plans: 0, intents: 0 }),
});
export type PlanBuilderPublishResult = z.infer<typeof PlanBuilderPublishResultSchema>;
