import { z } from "zod";

// ---------------------------------------------------------------------------
// CL.4 · 空租户冷启动引导（PRD-empty-tenant-bootstrap）：把"从空到可用计划域"理成
// 幂等、确定、可一键跑的清单（合成 seed → SopVersion 定稿 FINAL → plan_audit 有料）。
// 三面同源：GUI 向导 / CLI `platform bootstrap` / agent 工具组合。
// ---------------------------------------------------------------------------

export const BootstrapRequestSchema = z.object({
  industry: z.string().default("battery-manufacturing"),
  scale: z.enum(["S", "M", "L", "XL"]).default("M"),
  seed: z.number().int().default(42),
  month: z.string().default("2026-07"), // 目标月度计划版本
});
export type BootstrapRequest = z.infer<typeof BootstrapRequestSchema>;

export const BootstrapStepStatusSchema = z.enum(["DONE", "SKIPPED", "FAILED"]);
export type BootstrapStepStatus = z.infer<typeof BootstrapStepStatusSchema>;

export const BootstrapStepSchema = z.object({
  step: z.number().int(), // 1..7
  name: z.string(),
  status: BootstrapStepStatusSchema,
  produced: z.record(z.string(), z.unknown()).optional(), // 该步产出元信息
  verify: z.string().optional(), // 核对说明
  gapCode: z.string().optional(), // 失败时结构化缺口码
});
export type BootstrapStep = z.infer<typeof BootstrapStepSchema>;

export const BootstrapReportSchema = z.object({
  ok: z.boolean(), // 七步全通
  steps: z.array(BootstrapStepSchema),
  finalVersionId: z.string().optional(), // 定稿 FINAL 的 SopVersion id
  /** 任一步核对未达 → 停并报结构化缺口（诚实，不空转）。 */
  gap: z.object({ step: z.number().int(), code: z.string(), hint: z.string() }).optional(),
});
export type BootstrapReport = z.infer<typeof BootstrapReportSchema>;
