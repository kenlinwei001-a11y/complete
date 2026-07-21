/**
 * WO-CAPACITY-DEEPEN-ADDITIVE 块C · 20 因素产能本体表（单一来源·R14 无写死）。
 *
 * 产能金字塔 6 层因素本体（沿 SYSTEM-ONTOLOGY §3 产能派生链路·自下而上）：
 *   设备 → 工序 → 产线 → 可投 → 预测 → 缺口
 * 每层配色**只用现有 CSS 变量**（tokens.css·禁新色值），与产能推演看板同一色板。
 *
 * 此表为块A（派生 DAG 层色）/块B（爬坡子曲线因素）/块C（图例 + ②④因子徽标）三块的唯一数据源——
 * 改这里即三块同步（无内联字面量伪造·R14）。
 */

export interface OntoLayer {
  /** 层号 1..6（自下而上）。 */
  layer: number;
  /** 层名（= 块A DAG 层名）。 */
  name: string;
  /** 层色（**现有 CSS 变量**·禁新色值·禁字面色值）。 */
  colorVar: string;
  /** 一句话层义。 */
  role: string;
}

export interface OntoFactor {
  /** 圈号 ①..⑳（展示徽标）。 */
  mark: string;
  /** 序号 1..20。 */
  num: number;
  /** 所属层号。 */
  layer: number;
  /** 因素名。 */
  name: string;
  /** 在派生公式中的角色（× 乘子 / min 瓶颈 / ∩ 约束 / − 扣减）。 */
  op: "×" | "min" | "∩" | "−";
}

/** 6 层（自下而上）·层色复用现有 CSS 变量（--c-capacity/--c-forecast/--c-solver/--ok/--accent/--danger）。 */
export const ONTO_LAYERS: OntoLayer[] = [
  { layer: 1, name: "设备产能", colorVar: "var(--c-capacity)", role: "节拍 × OEE × 通道 × 班次 → 单机日产出" },
  { layer: 2, name: "工序产能", colorVar: "var(--c-forecast)", role: "× 良率 × 在岗 → 工序日吞吐" },
  { layer: 3, name: "产线产能", colorVar: "var(--c-solver)", role: "min(瓶颈工序) · WIP · 平衡" },
  { layer: 4, name: "可投产能", colorVar: "var(--ok)", role: "∩ 物料齐套 · 到货约束" },
  { layer: 5, name: "产能预测", colorVar: "var(--accent)", role: "× 爬坡 − 换型 − 检修" },
  { layer: 6, name: "产能缺口", colorVar: "var(--danger)", role: "− 需求 → 缺口/富余" },
];

/** 20 因素（圈号单一来源）。 */
export const ONTO_FACTORS: OntoFactor[] = [
  // 层1 设备
  { mark: "①", num: 1, layer: 1, name: "节拍 CT", op: "×" },
  { mark: "②", num: 2, layer: 1, name: "通道数", op: "×" },
  { mark: "③", num: 3, layer: 1, name: "可用率 OEE-A", op: "×" },
  { mark: "④", num: 4, layer: 1, name: "性能 OEE-P", op: "×" },
  { mark: "⑧", num: 8, layer: 1, name: "利用率", op: "×" },
  { mark: "⑯", num: 16, layer: 1, name: "班次时长×班次", op: "×" },
  // 层2 工序
  { mark: "⑥", num: 6, layer: 2, name: "工序良率", op: "×" },
  { mark: "⑦", num: 7, layer: 2, name: "质量 OEE-Q", op: "×" },
  { mark: "⑨", num: 9, layer: 2, name: "良率爬坡", op: "×" },
  { mark: "⑰", num: 17, layer: 2, name: "在岗出勤/熟练", op: "×" },
  // 层3 产线
  { mark: "⑩", num: 10, layer: 3, name: "瓶颈工序", op: "min" },
  { mark: "⑪", num: 11, layer: 3, name: "在制 WIP", op: "min" },
  { mark: "⑫", num: 12, layer: 3, name: "产线平衡", op: "min" },
  // 层4 可投
  { mark: "⑬", num: 13, layer: 4, name: "物料齐套", op: "∩" },
  { mark: "⑭", num: 14, layer: 4, name: "BOM 齐套", op: "∩" },
  { mark: "⑮", num: 15, layer: 4, name: "物料到货", op: "∩" },
  // 层5 预测
  { mark: "⑳", num: 20, layer: 5, name: "投产爬坡", op: "×" },
  { mark: "⑤", num: 5, layer: 5, name: "换型损失", op: "−" },
  { mark: "⑱", num: 18, layer: 5, name: "设备检修", op: "−" },
  // 层6 缺口
  { mark: "⑲", num: 19, layer: 6, name: "需求", op: "−" },
];

/** 层号 → 层定义。 */
export function layerOf(layer: number): OntoLayer {
  return ONTO_LAYERS.find((l) => l.layer === layer) ?? ONTO_LAYERS[0]!;
}
/** 圈号 → 因素。 */
export function factorByMark(mark: string): OntoFactor | undefined {
  return ONTO_FACTORS.find((f) => f.mark === mark);
}

/**
 * bottleneck_matrix 因素名 → 本体圈号（给现有 ②根因树/瓶颈因素**附加**徽标·纯附加·不动现有文字）。
 * 单一来源：现页 bottleneck_matrix 的 BN_FACTORS（设备OEE/物料齐套/…）映射到 20 因素坐标。
 */
export const BN_FACTOR_TO_MARK: Record<string, string> = {
  瓶颈工序: "⑩",
  设备OEE: "③",
  人力工时: "⑰",
  物料齐套: "⑬",
  物流时长: "⑮",
  换型损失: "⑤",
  良率波动: "⑥",
  // 常见别名（根因树因子/求解器 mainBn 口径）。
  化成通道: "⑩",
  化成柜: "⑩",
  老化库: "⑩",
  卷绕机稼动: "③",
  涂布机: "③",
  人员: "⑰",
};

/**
 * 缓解方案杠杆关键词 → 本体圈号（给 ④缓解方案杠杆**附加**徽标·配置单源）。
 */
export const LEVER_KEYWORD_TO_MARK: { kw: string; mark: string }[] = [
  { kw: "加班", mark: "⑯" },
  { kw: "夜班", mark: "⑯" },
  { kw: "跨基地", mark: "⑫" },
  { kw: "调剂", mark: "⑫" },
  { kw: "外协", mark: "⑬" },
  { kw: "认证", mark: "⑨" },
  { kw: "换型", mark: "⑤" },
  { kw: "良率", mark: "⑥" },
  { kw: "物料", mark: "⑬" },
  { kw: "检修", mark: "⑱" },
];

/** 给任意因素/杠杆文案匹配本体徽标（先精确 BN 名·再关键词）。返回圈号或 undefined。 */
export function markForText(text: string): string | undefined {
  if (BN_FACTOR_TO_MARK[text]) return BN_FACTOR_TO_MARK[text];
  for (const { kw, mark } of LEVER_KEYWORD_TO_MARK) if (text.includes(kw)) return mark;
  return undefined;
}

/**
 * 块B · 6 条产能爬坡子曲线（min 包络）——每条子爬坡的"天花板"取自真数据字段（bottleneck_matrix 该因素张力·R14），
 * 曲线形状取自爬坡配置 RAMP_PROFILE（配置单源·非内联伪造）。min 包络 = 实际爬坡；最低天花板 = 被谁拖住。
 */
export interface RampSubcurve {
  mark: string;
  name: string;
  /** 天花板来源：bottleneck_matrix 因素名（张力越高天花板越低）；null=投产爬坡本身（形状来自 RAMP_PROFILE 配置）。 */
  bnFactor: string | null;
}
export const RAMP_SUBCURVES: RampSubcurve[] = [
  { mark: "⑳", name: "投产爬坡", bnFactor: null },
  { mark: "⑨", name: "良率爬坡", bnFactor: "良率波动" },
  { mark: "③", name: "OEE 爬坡", bnFactor: "设备OEE" },
  { mark: "⑰", name: "熟练度", bnFactor: "人力工时" },
  { mark: "⑤", name: "换型收敛", bnFactor: "换型损失" },
  { mark: "⑬", name: "物料齐套", bnFactor: "物料齐套" },
];

/**
 * 爬坡形状配置（R6 确定性·R14 配置单源·= capacity_forecast 爬坡口径 base 0.88 / step 0.03 / 满产周 5）。
 * rampShape(dayFrac) 随窗口推进 0→1 单调升；子曲线 = 天花板 × rampShape。
 */
export const RAMP_PROFILE = { base: 0.88, step: 0.03, fullWeek: 5 } as const;

/** 张力(0..100) → 该因素爬坡天花板(0..1)：张力越高 headroom 越小（确定性·纯函数·无随机）。 */
export function tightnessToCeiling(tightness: number): number {
  const t = Math.max(0, Math.min(100, tightness));
  return Math.max(0.15, Math.min(1, 1 - (t / 100) * 0.85));
}

/** 归一化爬坡形状 dayFrac∈[0,1] → [base,1]（周 5 满产·线性逼近·确定性）。 */
export function rampShape(dayFrac: number): number {
  const wk = Math.max(0, Math.min(1, dayFrac)) * RAMP_PROFILE.fullWeek;
  const m = wk >= RAMP_PROFILE.fullWeek ? 1 : RAMP_PROFILE.base + RAMP_PROFILE.step * wk;
  return Math.max(0, Math.min(1, m));
}
