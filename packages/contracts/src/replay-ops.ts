import { z } from "zod";

// ---------------------------------------------------------------------------
// PRD 增量 · 回放编排器与虚拟操作团队（Replay Orchestrator）
//
// 共享契约（additive）：
//   §1 VirtualPersona —— 随运营态合成创建的虚拟操作账号（与真人同表）。
//   §2 OpsPlaybook DSL —— 场景包内容，版本化；cadence + OpsAction 联合类型。
//   §6 OpsSchedule —— 真实租户运营自动化配置（tenant_admin 管理台）。
//
// 红线：虚拟操作一律走与真人相同的 API（QOS 提问 / 审批 / S&OP / 孵化 / 求解），
// 编排器禁止直写任何结果表。文本池（提问/审批意见/决议）由 A9 在合成时一次性预生成
// 并缓存 —— 回放执行期零 LLM 调用（确定性、离线）。
// ---------------------------------------------------------------------------

// ---- §1 VirtualPersona ----------------------------------------------------

export const VirtualPersonaSchema = z.object({
  username: z.string(), // 如 vp_planner_zhang / vp_approver_li / vp_sop_host
  roles: z.array(z.string()), // 与真实角色同体系（planner / tenant_admin / catalog_admin / base_manager:…）
  attributes: z.record(z.string(), z.unknown()), // 行级属性（基地负责人等）
  isVirtual: z.literal(true), // 登录禁用、审计可识别、前端头像徽标
  styleSeed: z.number().int(), // 决定文本池抽取子流
  displayName: z.string().optional(),
});
export type VirtualPersona = z.infer<typeof VirtualPersonaSchema>;

// ---- §2 OpsPlaybook DSL ---------------------------------------------------

export const OpsActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ask"),
    persona: z.string(),
    view: z.string(),
    queryPool: z.string(),
    prob: z.number().min(0).max(1).optional(), // 每日触发概率（默认 0.6）
  }),
  z.object({
    kind: z.literal("run_forecast"),
    persona: z.string(),
    modelPool: z.array(z.string()),
  }),
  z.object({
    kind: z.literal("review_actions"),
    persona: z.string(),
    policy: z.object({ approve: z.number(), reject: z.number(), cancel: z.number() }), // 默认 0.82/0.11/0.04
    commentPool: z.string(), // 被拒必带意见（预生成文本池键）
  }),
  z.object({
    kind: z.literal("sop_cycle"),
    persona: z.string(),
  }),
  z.object({
    kind: z.literal("adopt_mitigation"),
    persona: z.string(),
  }),
  z.object({
    kind: z.literal("promote_intent"),
    persona: z.string(),
    afterFallbackCount: z.number().int().positive(),
  }),
]);
export type OpsAction = z.infer<typeof OpsActionSchema>;

export const OpsCadenceSchema = z.object({
  daily: z.array(OpsActionSchema).optional(),
  weekly: z.array(OpsActionSchema).optional(),
  monthly: z.array(OpsActionSchema).optional(),
  onEvent: z.array(z.object({ event: z.string(), actions: z.array(OpsActionSchema) })).optional(),
});
export type OpsCadence = z.infer<typeof OpsCadenceSchema>;

export const OpsPlaybookSchema = z.object({
  key: z.string(),
  version: z.number().int(),
  cadence: OpsCadenceSchema,
});
export type OpsPlaybook = z.infer<typeof OpsPlaybookSchema>;

// ---- §3 回放 tick 报告（第⑦步执行剧本的精简报告） ------------------------

export const OpsTickReportSchema = z.object({
  tick: z.number().int(),
  date: z.string(),
  executed: z.array(
    z.object({
      kind: z.string(),
      persona: z.string(),
      ref: z.string().optional(), // taskId / draftId / versionId / intentId
      decision: z.string().optional(),
    }),
  ),
  skipped: z.array(z.object({ kind: z.string(), persona: z.string(), reason: z.string() })),
});
export type OpsTickReport = z.infer<typeof OpsTickReportSchema>;

// ---- §6 OpsSchedule（真实租户运营自动化） --------------------------------

export const OpsScheduleSchema = z.object({
  forecasts: z
    .array(
      z.object({
        cron: z.string(),
        modelIds: z.union([z.array(z.string()), z.literal("ALL_ACTIVE")]),
        weeks: z.number().int().positive(),
      }),
    )
    .default([]),
  sopCycle: z
    .object({
      openCron: z.string(), // 如每月25日开启下月版本
      stepDeadlines: z.array(z.number().int()).default([]), // ①–④各步催办期限（天）
      escalateAfterDays: z.number().int(),
    })
    .optional(),
  approvalReminder: z
    .object({
      remindAfterDays: z.number().int(),
      escalateAfterDays: z.number().int(),
      escalateToRole: z.string(),
    })
    .optional(),
  // 默认 enabled=false；开启需 tenant_admin 显式配置 + 全审计（先例为 M11 autoApply）
  autoApprove: z
    .object({
      actionTypes: z.array(z.string()),
      maxAmount: z.number().optional(),
      enabled: z.boolean().default(false),
    })
    .optional(),
});
export type OpsSchedule = z.infer<typeof OpsScheduleSchema>;

export const OpsScheduleRecordSchema = OpsScheduleSchema.extend({
  tenantId: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string(),
});
export type OpsScheduleRecord = z.infer<typeof OpsScheduleRecordSchema>;
