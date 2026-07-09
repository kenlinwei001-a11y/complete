import { z } from "zod";

// ---------------------------------------------------------------------------
// ViewConfig.layout 结构声明（G-5 8a 收口 · R14 config 驱动）
// 决策视图的 KPI 卡 / 列 / 步骤 / DAG 层拓扑 **结构** 由后端 view.layout 下发，
// 前端渲染器迭代 config（非内联 JS 数组）；前端常量仅作兜底（换租户=换配置·0 码改）。
// 金标准 = SandboxView / OntologyGraphView（全 config 派生）。
//
// 说明：value/color 等**数值/裁决色**仍由前端按 card.key 绑定求解器真值实算
// （逐值对照后端·不改语义），此处只声明**呈现结构**（哪些卡、次序、标签、公式文案、
// 输入因子、关联规则）。公式/输入文案可含占位符 {gapRed}/{revBudget}/{cashFloor}
// 由渲染器以生效阈值替换（阈值本身来自 WorkspaceConfig/SolverParam 权威）。
// ---------------------------------------------------------------------------

/** KPI 卡呈现结构（SopBalance 六卡 / OrderChain 全链卡）。 */
export const KpiCardDefSchema = z.object({
  key: z.string(),
  label: z.string(),
  /** 公式文案（可含 {gapRed}/{revBudget}/{cashFloor} 占位符）。 */
  formula: z.string().optional(),
  source: z.string().optional(),
  /** 输入因子（每项可含占位符）。 */
  inputs: z.array(z.string()).optional(),
  /** 关联规则号；OrderChain 卡用 ruleKey 声明取哪个判定的 ruleRefs。 */
  rule: z.string().optional(),
  ruleKey: z.string().optional(),
  note: z.string().optional(),
});
export type KpiCardDef = z.infer<typeof KpiCardDefSchema>;

/** DAG 层拓扑声明（OrderChain 全链 11 节点分层）：节点 kind → 层序 + 层标题。 */
export const DagLayerLayoutSchema = z.object({
  /** 节点 kind → 层序号（0 起）。 */
  kindLayers: z.record(z.string(), z.number().int()),
  /** 各层标题。 */
  layerTitles: z.array(z.string()),
});
export type DagLayerLayout = z.infer<typeof DagLayerLayoutSchema>;

/** DAG 调色板 + 固定求解器节点声明（ProjectSim 六层 DAG 结构骨架）。 */
export const DagPaletteSchema = z.object({
  colors: z.record(z.string(), z.string()),
  /** 固定求解器节点（聚合/瓶颈）静态标签，动态 sub 由渲染器接求解器真值填充。 */
  solverNodes: z.array(z.object({ id: z.string(), label: z.string() })),
});
export type DagPalette = z.infer<typeof DagPaletteSchema>;

/**
 * 通用表列定义（列头 label + 取值键·渲染器按 key 从行对象取值/格式化，value 仍绑后端真值）。
 * FILL-XINDUSTRY-LAYOUT（G-5 8a 续收）：RiskBoard 受影响订单表列曾 JSX 字面量写死（型号/营收敞口等制造订单维度），
 * 迁入 `view.layout.affectedOrderColumns` → 换行业换 config 即换列（值格式化按 key 绑真值·不改语义）。
 */
export const ViewColumnDefSchema = z.object({ key: z.string(), label: z.string() });
export type ViewColumnDef = z.infer<typeof ViewColumnDefSchema>;
