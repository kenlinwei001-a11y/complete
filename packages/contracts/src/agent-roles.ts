import { z } from "zod";
import { CeoAgentRoleSchema } from "./ceo-agent.js";

/**
 * WO-FIVE-ROLE-AI-EMPLOYEE P1 · 五角色化 agent + Coordinator 编排契约。
 *
 * 病根：单一 universal path-B agent 服务所有问句；无"角色"维。本单把它升级为 CEO / 供应链 / 生产 / 质量 /
 * base-planner 五角色化 agent（各绑 scope + 工具 + prompt），并加 **Coordinator 编排**——一个跨域问题→确定性拆成
 * 子问→分派多角色 agent（经 workflow invoke_agent 真调）→汇总（谁答什么 + 冲突/一致 + 综合结论 + 每角色溯源）。
 *
 * P2 双向 A2A（角色间相互提问/协商）标"二期"·不在本契约。
 */

/** 角色枚举 = CeoAgentRole 五值单一来源（ceo/supply-chain/production/quality/base-planner·向后兼容）。 */
export const AgentRoleSchema = CeoAgentRoleSchema;
export type AgentRole = z.infer<typeof AgentRoleSchema>;

/** 固定角色序（确定性扇出/汇总顺序·R6）。 */
export const AGENT_ROLE_ORDER = ["ceo", "supply-chain", "production", "quality", "base-planner"] as const;

/**
 * 单条角色分派：Coordinator 把大问题确定性拆成的一个子问 → 指派给某角色（绑其 agentId + scope）。
 * scope 真隔离经绑定 agent 的 scopeDeclaration（objectTypes/toolNames）在执行器强制（越界拒·非声明装饰）。
 */
export const RoleDispatchSchema = z.object({
  role: AgentRoleSchema,
  subQuestion: z.string(), // 拆给该角色的子问（如 供应链[物料齐套]/生产[产能瓶颈]/质量[良率]）
  agentId: z.string(), // 该角色绑定的 seed agent（invoke_agent 真调）
  scope: z.object({
    allBases: z.boolean(),
    baseIds: z.array(z.string()).default([]),
  }),
  objectTypes: z.array(z.string()).default([]), // 该角色取证对象域（信息展示·真实约束在 agent scopeDeclaration）
  focusHint: z.string().optional(), // 子问聚焦提示（如 "物料齐套"）
});
export type RoleDispatch = z.infer<typeof RoleDispatchSchema>;

/**
 * Coordinator 编排计划：一个跨域问题 → 确定性拆多角色子问（R6·非蒙 LLM）。
 * `synthesis` 由 synthesize 阶段填（结构化汇总文案·谁答什么 + 冲突/一致 + 综合结论）。
 */
export const CoordinatorPlanSchema = z.object({
  question: z.string(),
  trigger: z.string(), // 命中的跨域触发（交付风险/综合诊断/多角色关键词共现…·审计可见）
  dispatches: z.array(RoleDispatchSchema).min(1),
  synthesis: z.string().optional(),
});
export type CoordinatorPlan = z.infer<typeof CoordinatorPlanSchema>;

/** 单角色作答（汇总卡渲染用·前端一栏一角色）。 */
export const RoleAnswerSchema = z.object({
  role: AgentRoleSchema,
  agentId: z.string(),
  subQuestion: z.string(),
  summary: z.string(), // 该角色答案首段摘要
  scope: z.object({ allBases: z.boolean(), baseIds: z.array(z.string()).default([]) }),
  objectTypes: z.array(z.string()).default([]),
});
export type RoleAnswer = z.infer<typeof RoleAnswerSchema>;
