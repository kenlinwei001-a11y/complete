import type { InferenceEdge, InferenceNodeKind } from "@platform/contracts";

/**
 * 编排推演 DAG 骨架（PRD-IND-story §2.2/§2.3/§4.1）—— 单一来源。
 *
 * 这是**视图定义级常量**（i18n/ViewDef，类比 PmDag 层定义 / NAV_GROUPS），不违反 R14：
 * 10 节点短名/标题/坐标/色 + 12 边拓扑 + IPO 文案模板。
 * 真实 QueryTask 轨迹经 projectTrace（§4.3）覆盖各节点 status/data/solvers/agents/gapCode，
 * 具体业务数据**必须**来自 trace（禁止把 HTML 的 cmp 5 行 / qa 答案硬编码）。
 *
 * 坐标对齐 HTML：x = 78 + rank*128，y = 128 + row*78（§2.2 _SD/_sdx/_sdy）。
 */

export interface SkeletonNode {
  id: number; // 1..10（= ordinal）
  shortLabel: string; // STORY_SHORT
  label: string; // steps[].t（详情标题）
  kind: InferenceNodeKind;
  rank: number;
  row: number;
  in: string; // IPO 模板
  proc: string;
  out: string;
  /** 默认占位（真实 trace 覆盖；R13 lineage 候选）。 */
  data: string[];
  solvers: string[];
  agents: string[];
}

export const SKELETON_NODES: readonly SkeletonNode[] = [
  {
    id: 1,
    shortLabel: "解析场景",
    label: "接收意图 · 解析场景",
    kind: "factory",
    rank: 0,
    row: 0,
    in: "原始问句 + 在手订单 + 当前产能基线",
    proc: "意图解析Agent 将自然语言映射为结构化预测场景对象（需求量 / 交付窗口 / 候选对策集）；按规则 C10 校验场景必填字段完整性",
    out: "结构化预测场景：需求 · 交付窗口 · 候选对策集",
    data: ["需求/订单", "预测场景"],
    solvers: [],
    agents: ["编排Agent", "意图解析Agent"],
  },
  {
    id: 2,
    shortLabel: "检索切片",
    label: "检索业务建模切片 · 召回历史(仅作校正)",
    kind: "capacity",
    rank: 1,
    row: -1,
    in: "预测场景对象 · 业务本体全图 · 经验记忆库历史案例",
    proc: "检索Agent 以 resolveSlice 声明式按『型号→可产基地→产线→工序』取子图（非语义搜索）；经验记忆库按时效加权召回相似案例，仅用于残差校正",
    out: "相关业务建模子图 + 时效加权的相似历史案例（校正用）",
    data: ["工厂", "产线1", "产线2", "电芯", "4680"],
    solvers: [],
    agents: ["检索Agent", "经验记忆库"],
  },
  {
    id: 3,
    shortLabel: "装载因子",
    label: "装载量化驱动因子 · 暴露缺口",
    kind: "capacity",
    rank: 1,
    row: 1,
    in: "OEE指标/OEE历史/良率/可用工时/物料齐套/换型时间/生产工单MO（各带来源系统与采集时间）",
    proc: "建模求解Agent 装载带时序的量化驱动因子；对未接入项显式标红为缺口",
    out: "带时序的驱动因子集；显式标红缺失项",
    data: ["OEE指标", "OEE历史", "良率", "可用工时", "物料齐套", "换型时间", "生产工单MO"],
    solvers: [],
    agents: ["建模求解Agent"],
  },
  {
    id: 4,
    shortLabel: "聚合产能",
    label: "逐级聚合产能 · 算清现状",
    kind: "solver",
    rank: 2,
    row: 0,
    in: "设备级 节拍×OEE×良率×人力 + 工序串并联结构",
    proc: "聚合求解器按『设备产能→工序产能(串行取 min / 并行 Σ通道)→产线产能→工厂产能』逐级核算；引用规则 C01 / C02",
    out: "现状各级产能基线(设备→工序→产线→工厂)，每级可下钻到公式与输入因子",
    data: ["设备产能", "工序产能", "产线产能", "工厂产能"],
    solvers: ["聚合求解器"],
    agents: ["建模求解Agent"],
  },
  {
    id: 5,
    shortLabel: "识别瓶颈",
    label: "识别瓶颈 · 多维根因诊断",
    kind: "solver",
    rank: 3,
    row: 0,
    in: "各级产能基线 + 7 维约束因素当前值（取自多维瓶颈矩阵）",
    proc: "瓶颈求解器按工艺链最小割定位主瓶颈；瓶颈诊断Agent 并扫 设备OEE/人力工时/物料齐套/物流时长 等维度；引用规则 C05",
    out: "多维瓶颈定位：主瓶颈工序/设备 + 次约束",
    data: ["化成", "老化", "瓶颈", "物料齐套"],
    solvers: ["瓶颈求解器"],
    agents: ["瓶颈诊断Agent"],
  },
  {
    id: 6,
    shortLabel: "情景推演",
    label: "情景推演 · 多方案求解",
    kind: "solver",
    rank: 4,
    row: 0,
    in: "预测场景 + 瓶颈定位结果 + 候选对策集",
    proc: "场景求解器对每个对策在 live 数据上前向重算 产能/缺口/交期，计入 ramp-up；引用规则 C03 / C08；每方案假设与约束显式列出、可复算",
    out: "按瓶颈对症的多套方案（各自产能/缺口/交期均算清）",
    data: ["预测场景", "需求/订单", "产能预测"],
    solvers: ["场景求解器"],
    agents: ["建模求解Agent"],
  },
  {
    id: 7,
    shortLabel: "方案比对",
    label: "方案比对 · 人机对话",
    kind: "agent",
    rank: 5,
    row: 0,
    in: "各对策的推演结果（产能/缺口/交期/成本/风险）",
    proc: "解释校验Agent 生成并排比对表；编排Agent 接受追问/调参/要替代方案，结果实时由场景求解器重算",
    out: "多套方案并排比对 + 人机对话（可追问、调参、要替代方案）",
    data: ["预测场景", "产能预测"],
    solvers: ["场景求解器"],
    agents: ["编排Agent", "解释校验Agent"],
  },
  {
    id: 8,
    shortLabel: "校验解释",
    label: "校验与可解释 · 守护防错",
    kind: "agent",
    rank: 6,
    row: 0,
    in: "候选预测结果 + 约束规则注册表(C01–C12)",
    proc: "解释校验Agent 逐条执行约束校验并留痕；超物理上限等违规结论被规则 C03 拦截并说明；输出 P50/P90 置信区间",
    out: "通过校验的预测 + 置信区间 + 自然语言解释",
    data: ["产能预测"],
    solvers: [],
    agents: ["解释校验Agent", "约束规则"],
  },
  {
    id: 9,
    shortLabel: "写回行动",
    label: "决策建议 · 写回行动",
    kind: "forecast",
    rank: 7,
    row: 0,
    in: "通过校验的推荐组合 + Action 类型参数 schema",
    proc: "行动Agent 生成结构化工单(MO)，按规则 C10 要求审批人并留审计；编排Agent 编排发起→审批链路",
    out: "对症组合建议，写回工单(Action)",
    data: ["产能预测", "生产工单MO"],
    solvers: [],
    agents: ["行动Agent", "编排Agent"],
  },
  {
    id: 10,
    shortLabel: "执行回采",
    label: "执行回采 · 自学习闭环",
    kind: "quality",
    rank: 8,
    row: 0,
    in: "实际产出/OEE历史/良率 回采值 + 上一轮预测值",
    proc: "精度校准器比对 预测↔实际，按规则 C12 反向校准 节拍/良率/OEE基线 并调参求解器；案例入经验记忆库",
    out: "校准后的参数 + 入库案例 + 偏差→精度提升的量化趋势",
    data: ["实际产出", "产能预测", "良率", "OEE历史"],
    solvers: ["精度校准器"],
    agents: ["学习Agent", "经验记忆库"],
  },
] as const;

/**
 * 12 边（STORY_EDGES，§2.3）。注意 1:1 真相：fb 边源是 ⑨(id 9)，非 ⑩——以 HTML 代码为准。
 * id 为 1-based（与节点 id 对齐）。
 */
export const SKELETON_EDGES: readonly InferenceEdge[] = [
  { from: 1, to: 2, type: "par", label: "分叉" },
  { from: 1, to: 3, type: "par" },
  { from: 2, to: 4, type: "conv", label: "本体子图" },
  { from: 3, to: 4, type: "conv", label: "驱动因子" },
  { from: 2, to: 5, type: "aux", label: "历史校正" },
  { from: 4, to: 5, type: "seq" },
  { from: 5, to: 6, type: "seq" },
  { from: 6, to: 7, type: "seq" },
  { from: 7, to: 8, type: "seq" },
  { from: 8, to: 9, type: "seq" },
  { from: 9, to: 2, type: "fb", label: "案例回流" },
  { from: 9, to: 4, type: "fb", label: "系数校准" },
] as const;

/** 场景默认示例文案（被 task.query 覆盖；仅无 task 时的占位）。 */
export const SKELETON_SCENARIO_EXAMPLE =
  "重点客户追加 20% 的 4680 PACK 订单，要求 6 周交付——能否接？瓶颈在哪？要不要加夜班 / 扩化成通道 / 外协？";
