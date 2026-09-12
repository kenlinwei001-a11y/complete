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
      order: z.string().optional(), // 聚焦订单号（WO-SOP-RESCHEDULE：产销重排 targetOrderId 源·如 SO-3402）
    })
    .optional(),
  entities: z.array(PageEntitySchema).max(50).default([]), // 页面渲染的真对象（每个 drillRef→源对象）
  selection: z.array(z.string()).default([]), // 当前选中实体 id（如选中"正极粉短缺"根因）
  drillPath: z.array(z.string()).default([]), // 下钻路径（面包屑·从总目标到当前聚焦）
  actions: z.array(z.string()).default([]), // 页面可用动作（供 agent 建议下一步）
  /**
   * WO-BLOCK-DIALOGUE（闭 G-3 块级·additive）：当前活跃的**块级对话锚**——用户点某个 block「深问此块」时，
   * 把该块**真实渲染数据**的结构化快照（blockData）连同块身份（blockId/blockType/blockTitle）随查询搭车推给 agent。
   * orchestrator 据 `hasBlockContext` 门 + blockType 定向路由到对应推演求解器/agent，blockData 作强上下文进 prompt/args，
   * 答案针对性锚定「哪页·哪块·块里有哪些信息」。无活跃块则不填（退化为页面级 PageContext·不破 CEO-6-FE）。
   */
  block: z
    .object({
      blockId: z.string(), // 块唯一标识（= data-testid·如 dash-supply-demand）
      blockType: z.string(), // 块语义类型（供 blockType 定向路由：supply-demand/counterfactual/metric-strip/root-cause-tree/decision-root-cause/decision-options/decision-matrix）
      blockTitle: z.string(), // 块标题（人读·进 agent prompt 锚定）
      blockData: z.record(z.string(), z.unknown()), // 该块真实渲染数据的结构化快照（点击时 getData() 捕获·非写死·改块数据即变 C4）
      provenanceRef: z.string().optional(), // 溯源引用（块数据来源求解器/对象·可选）
      selection: z.array(z.string()).default([]), // 块内选中项 id（如选中某根因叶/某方案·驱动 factorId）
    })
    .optional(),
});
export type PageContext = z.infer<typeof PageContextSchema>;

/**
 * 五角色 AI 员工画像（WO-FIVE-ROLE-AI-EMPLOYEE P1）——CEO 全域 / 供应链 / 生产 / 质量 / base-planner 基地 scope。
 * **向后兼容**：保留 ceo / base-planner（WO-CEO-6 两角色）；新增 supply-chain / production / quality。
 * `resolveCeoRoute` 等既有签名不破（仍接受 CeoAgentRole 联合类型）。
 */
export const CeoAgentRoleSchema = z.enum(["ceo", "supply-chain", "production", "quality", "base-planner"]);
export type CeoAgentRole = z.infer<typeof CeoAgentRoleSchema>;

/**
 * 激活的角色画像（此前 app 侧零消费的死契约·P1 落地）：每角色一 profile——
 * role + scope{allBases,baseIds} + focusMetrics + **绑定 seed agentId** + **工具白名单** + **对象类型 scope** + **system 片段 key**。
 * CEO=全域全工具·供应链=Material/Supplier/PO·生产=Line/Process/Model·质量=Process/Equipment/QualityStandard·base-planner=单基地。
 */
export const CeoAgentProfileSchema = z.object({
  profileId: z.string(),
  role: CeoAgentRoleSchema,
  scope: z.object({
    allBases: z.boolean(), // CEO 全域 = true；base-planner = false
    baseIds: z.array(z.string()).default([]), // base-planner 可见基地（A6 行级·跨基地剪枝/403）
  }),
  focusMetrics: z.array(z.string()).default([]), // 关注面预设（该角色默认盯的指标 key）
  agentId: z.string().optional(), // 绑定的 seed agent（Coordinator 扇出时经 invoke_agent 真调此 agent）
  toolWhitelist: z.array(z.string()).default([]), // 该角色可用工具（展示·真实约束以绑定 agent scopeDeclaration.toolNames 为准）
  objectTypes: z.array(z.string()).default([]), // 该角色取证对象域（真实约束以绑定 agent scopeDeclaration.objectTypes 为准·越界拒）
  systemKey: z.string().optional(), // system 片段 key（prompts.ts ROLE_SYSTEM_FRAGMENTS）
});
export type CeoAgentProfile = z.infer<typeof CeoAgentProfileSchema>;

/** 深问路由决策（分类器 + presetContext → 路由到哪个能力·溯源可见）。 */
export const CeoRouteKindSchema = z.enum([
  "gap_attribution", // 根因深问（为什么/根因）
  "decision_play", // 方案（怎么补/有哪些选择）
  "signal", // 信号（外部信号/触发）
  "metric_rollup", // 达标（差多少）
  "sop_reschedule", // 产销重排（能否提前/挤占谁/拆哪些基地/代价·WO-SOP-RESCHEDULE·避 decision_play 劫持）
  // WO-TIER2-B：B/C 域高频意图确定性直绑 solver
  "credit_exposure", // 信用/逾期/敞口
  "finance_pnl", // 毛利/量价本利
  "supply_demand_gap_attribution", // 供需/产销对不上
  "atp_check", // 能不能接/交期/承诺
  // WO-QOS-ROUTE-COVER（真 Kimi 10 题 v3/v4 实测：以下题无确定性意图→落 path-B 洪泛/被 gap_attribution 过度捕获）：
  "bottleneck_matrix", // 瓶颈定位/OEE/换型损失（#1/#4·先于 RE_ROOTCAUSE 免被 gap_attribution 抢）
  "base_capacity_outlook", // 未来 30/60/90 天产能前瞻/穿仓（#9）
  // WO-Phase1-D+A：what-if 结构化杠杆 + Q7 产能可行性歧义修
  "generic_inference", // 扩通道/加夜班/加%%/外包/降%% 等结构化杠杆前向重算
  "capacity_forecast", // 型号+周期+加/扩 → 产能可行性（S01）
  // WO-DIALOGUE-Q1Q2：产能反向阈值（「型号 加 多少 需求量 N 周就不能接了/穿仓」）→ capacity_forecast(mode:"threshold")
  // 反推「还能加多少 = P90 天花板 − 已占基线需求」。独立路由值，映射到 ceo_capacity_threshold 意图（forward S01 口径不动）。
  "capacity_threshold", // 反向：还能加多少需求量才穿仓（阈值增量·mode:"threshold"）
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
