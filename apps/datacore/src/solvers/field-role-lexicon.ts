// A13 字段角色命名语义表（配置化 R14，非业务常数内联）：通用图求解器把"哪个字段/类型是
// 资源/需求/优先级(地板)/营收/成本/根源/汇点"映射到任意本体时的命名启发。结构信号(扇入扇出/基数/PK/
// 数值)为主、命名为辅；本表是命名辅助信号的单一来源（solver-args 与 field-roles 共用，去重）。

export const ROLE_LEXICON = {
  /** 产能/上限（shared_bottleneck 资源字段）。 */
  capacity: /产能|capacity|cap|容量|上限|可用|额定/i,
  /** 需求/用量（shared_bottleneck 共享者字段）。 */
  demand: /需求|demand|qty|数量|用量|消耗|negotiat|订量|需量/i,
  /** 优先级/地板（降级/底线判定字段，"地板语义"）。 */
  priority: /优先|priority|prio|级别|等级|权重|floor|threshold|底线|tier|grade|level/i,
  /** 营收/售价（margin_attribution）。 */
  revenue: /营收|revenue|售价|单价|price|收入|金额|amount|售/i,
  /** 成本/费用（margin_attribution 成本项）。 */
  cost: /成本|cost|费用|损|料价|原料|开支|支出|耗费/i,
  /** 根源/汇点类型名（供应商/源头：supplier_disruption_radius 的 root；concentration_risk 的 sink）。 */
  sourceSink: /供应商|supplier|vendor|源|source|原料|material|根|root/i,
  /** 叶层/敞口类型名（客户/订单：扇出的叶层敞口）。 */
  leaf: /客户|customer|订单|order|买家|buyer|终端|leaf/i,
} as const;

export type RoleLexiconKey = keyof typeof ROLE_LEXICON;

/** 命名命中：propKey/typeKey 是否匹配某角色词库。 */
export function lexiconHit(name: string, role: RoleLexiconKey): boolean {
  return ROLE_LEXICON[role].test(name);
}
