/**
 * 风险因子 → 根因树结构节点 对齐词表（CI-b「对症根因」·display 侧启发式匹配）。
 *
 * R14：领域关键词（锂电工艺/物料术语，如「化成/正极/电解液」）**不内联视图**——外置到本配置层，
 * 换行业只改此表、视图零改。权威根因分类是 datacore `RootCauseChain` 对象（kpiCategory→factor→
 * driverType.evidenceField）；此表是**前端展示侧的模糊对齐启发式**（把方案/越线因子标签匹配到
 * gap_attribution 投影出的根因树节点标签），非第二真源。命中即真链（同一 gap_attribution 出处）。
 *
 * 结构：每组 [因子侧关键词正则, 根因标签侧关键词正则]；`matchRiskFactorToRootCause` 顺序匹配首个命中。
 */
export const RISK_FACTOR_ROOTCAUSE_GROUPS: [RegExp, RegExp][] = [
  [/物料|齐套|正极|电解液|隔膜/, /物料|正极|短缺|电解液|隔膜/],
  [/设备|OEE|化成|柜/, /设备|OEE/],
  [/瓶颈|工序|产能/, /瓶颈|工序|产能/],
  [/换型|排产|冲突/, /换型|排产|冲突/],
  [/人力|工时/, /人力|工时/],
  [/物流|运输/, /物流|运输|订单/],
];

/** 因子标签 → 根因树节点标签（命中即返回该根因标签；无命中返回 null）。 */
export function matchRiskFactorToRootCause(factor: string, rootCauseFactors: string[]): string | null {
  for (const [fRe, rRe] of RISK_FACTOR_ROOTCAUSE_GROUPS) {
    if (fRe.test(factor)) {
      const hit = rootCauseFactors.find((l) => rRe.test(l));
      if (hit) return hit;
    }
  }
  return null;
}
