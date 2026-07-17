import { z } from "zod";

/**
 * WO-CEO-6 · CEO agent + PageContext 注入（闭平台断点 G-3：presetContext 未注入 QOS）。
 *
 * 北极星：CEO 在某页自然语言深问 →（PageContext 自动注入 presetContext）→ QOS 分类器用它 scope +
 * agent 上下文用它 → 答案 + 每跳溯源链。角色化（CEO 全域 / base-planner 基地 scope·A6 行级）。
 *
 * PageContext 从页面渲染的**真对象派生**（每 entity drillRef→真 Metric/RootCause/Order），非写死文案（R13）。
 * 注入后 agent 全知「用户在哪页、看什么、选中谁」——答案受它 scope/enrich（对比不带则不同·证 G-3 真闭）。
 */

/** 页面实体：页面上渲染的一个真对象引用（drillRef 可反向驱动页面·下钻回源对象）。 */
export const PageEntitySchema = z.object({
  type: z.string(), // 对象类型（Metric/GapAttribution/DecisionOption/Order…）
  id: z.string(),
  label: z.string(),
  value: z.number().optional(), // 页面显示的真值（如 gap/contribution）
  drillRef: z.string().optional(), // 反向驱动引用（objectId / factorId·前端可定位）
});
export type PageEntity = z.infer<typeof PageEntitySchema>;

/** 页面上下文：从页面真对象派生·注入 QOS 分类器 + agent 上下文（闭 G-3）。 */
export const PageContextSchema = z.object({
  view: z.string(), // 所在视图 key
  focus: z
    .object({
      metric: z.string().optional(), // 聚焦指标 key（如 seg_attain_ess）
      gap: z.number().optional(),
      base: z.string().optional(),
      line: z.string().optional(),
      factorId: z.string().optional(), // 聚焦根因（gap_attribution 叶）
    })
    .optional(),
  entities: z.array(PageEntitySchema).max(50).default([]), // 页面渲染的真对象（每个 drillRef→源对象）
  selection: z.array(z.string()).default([]), // 当前选中实体 id（如选中"正极粉短缺"根因）
  drillPath: z.array(z.string()).default([]), // 下钻路径（面包屑·从总目标到当前聚焦）
  actions: z.array(z.string()).default([]), // 页面可用动作（供 agent 建议下一步）
});
export type PageContext = z.infer<typeof PageContextSchema>;

/** CEO 角色 agent 画像：CEO 全域 / base-planner 基地 scope（A6 行级过滤·关注面预设）。 */
export const CeoAgentRoleSchema = z.enum(["ceo", "base-planner"]);
export type CeoAgentRole = z.infer<typeof CeoAgentRoleSchema>;

export const CeoAgentProfileSchema = z.object({
  profileId: z.string(),
  role: CeoAgentRoleSchema,
  scope: z.object({
    allBases: z.boolean(), // CEO 全域 = true；base-planner = false
    baseIds: z.array(z.string()).default([]), // base-planner 可见基地（A6 行级·跨基地剪枝/403）
  }),
  focusMetrics: z.array(z.string()).default([]), // 关注面预设（该角色默认盯的指标 key）
});
export type CeoAgentProfile = z.infer<typeof CeoAgentProfileSchema>;

/** 深问路由决策（分类器 + presetContext → 路由到哪个能力·溯源可见）。 */
export const CeoRouteKindSchema = z.enum([
  "gap_attribution", // 根因深问（为什么/根因）
  "decision_play", // 方案（怎么补/有哪些选择）
  "signal", // 信号（外部信号/触发）
  "metric_rollup", // 达标（差多少）
]);
export type CeoRouteKind = z.infer<typeof CeoRouteKindSchema>;

/** CEO 深问路由 + 答案 + 每跳溯源（R13）——供 6b 路由与前端反向驱动。 */
export const CeoQueryRouteSchema = z.object({
  route: CeoRouteKindSchema,
  reason: z.string(), // 路由依据（问句意图 + presetContext·trace 证）
  usedPageContext: z.boolean(), // 是否真用了 PageContext（证 G-3 注入生效）
  scopedBaseIds: z.array(z.string()).default([]), // 经角色 scope 剪枝后的基地（A6）
  solverKey: z.string(), // 落到的 datacore 求解器
  args: z.record(z.string(), z.unknown()).default({}), // 注入 args（从 PageContext.focus 派生）
});
export type CeoQueryRoute = z.infer<typeof CeoQueryRouteSchema>;
