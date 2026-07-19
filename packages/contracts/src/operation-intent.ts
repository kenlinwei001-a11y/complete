import { z } from "zod";

/**
 * A15 · CLI 通用操作外壳 —— 操作型意图目录（OPERATION_CATALOG）+ 分类契约。
 *
 * 区别于查询型 Intent（QOS ask）：操作型意图把"导入/建模/规则/求解/合成/建域/审批…"等**写/操作**动作
 * 注册为配置化目录（R14），每条带关键词/目标端点/必填槽/是否经 R4/CLI 命令/（不宜内联时）GUI 深链。
 * `operations/classify` 据此把自然语言判为 QUERY（走 ask）或 OPERATION（路由到模块）；CLI 与 GUI 平行同源。
 *
 * R15「CLI 对等」的真值源：每个对外模块能力必须在此注册 cliCommand 或 uiDeepLink（cli-parity:check 守门）。
 */

export const OPERATION_KINDS = [
  "import", "model", "browse", "rule", "solve", "synth", "build",
  "scene-config", "scenario", "approve", "agent", "workflow", "skill", "mcp",
  "eval", "llm", "ops", "tenant", "catalog", "connection",
  "meta", "slice", "rule-extract", "sop", "platform-config", "validate",
  "metric", "notify", "config-bundle", "boundary",
  "calibration", "policy", "signal", "quarantine", "features", "growth", "kb",
  "bootstrap", "sim",
] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

/** 操作型意图目录条目（配置驱动 R14）。 */
export const OperationCatalogEntrySchema = z.object({
  op: z.enum(OPERATION_KINDS),
  /** GUI 能力一句话（覆盖矩阵行）。 */
  label: z.string(),
  /**
   * LLM 可读描述（发现供给侧统一字段·WO-RESOURCE-DESCRIPTOR）：这条操作意图做什么、回答/服务哪类诉求。
   * 「无描述不允许发布」全池纪律推广到操作意图池——非空是 resource-descriptor:check 硬门。
   */
  description: z.string().min(1),
  /** 关键词（确定性分类用；命中即候选，多命中按命中数排序）。 */
  keywords: z.array(z.string()),
  /** 复用的后端端点（信息性；CLI/GUI 同源调用）。 */
  endpoint: z.string(),
  /** 必填槽位（CLI 内交互补参）。 */
  requiredSlots: z.array(z.string()).default([]),
  /** 是否经 R4 审批（写真值动作）。 */
  r4: z.boolean().default(false),
  /** CLI 等价命令（R15 对等；与 uiDeepLink 至少其一）。 */
  cliCommand: z.string().optional(),
  /** 不宜 CLI 内联时的 GUI 深链（R15 对等的诚实边界，§3.6）。 */
  uiDeepLink: z.string().optional(),
});
export type OperationCatalogEntry = z.infer<typeof OperationCatalogEntrySchema>;

/**
 * 操作型意图目录（附录 A 覆盖矩阵的机器可读形）。新增对外模块能力 → 必须在此追加一行
 * （cliCommand 或 uiDeepLink 至少其一），否则 cli-parity:check 红（R15 强制对等）。
 */
export const OPERATION_CATALOG: OperationCatalogEntry[] = [
  { op: "import", label: "连接器·建连接/上传/同步", description: "接入外部数据：建连接器实例、上传 CSV/文件、触发同步，把原始数据经唯一上传口落入平台管线。", keywords: ["导入", "上传", "import", "csv", "连接器", "数据接入"], endpoint: "/a/v1/connectors/upload", requiredSlots: ["file"], r4: false, cliCommand: "import" },
  { op: "model", label: "半自动建模·数据→本体草稿→发布", description: "半自动建模：从已接入数据集派生对象类型/属性/链路草稿，人工确认后经 R4 审批发布为一等本体。", keywords: ["建模", "model", "建模型", "类型", "schema"], endpoint: "/a/v1/modeling/derive", requiredSlots: ["datasetIds"], r4: true, cliCommand: "model" },
  { op: "browse", label: "对象/类型浏览（A4）", description: "浏览已发布对象类型与实例：查类型清单、字段明细、对象数据；查对象前先在此确认真实类型名。", keywords: ["浏览", "看类型", "对象", "browse", "types", "实例"], endpoint: "/a/v1/ontology/object-types/stats", requiredSlots: [], r4: false, cliCommand: "types" },
  { op: "rule", label: "规则库·建/dry-run/发布", description: "业务规则库：新建/编辑约束规则、dry-run 试评、发布为可评估底线（C 约束族）。", keywords: ["规则", "约束", "rule", "底线"], endpoint: "/a/v1/rules", requiredSlots: ["expression"], r4: true, cliCommand: "rule" },
  { op: "solve", label: "求解器·调用既有", description: "调用既有确定性求解器：按 solverKey 传参求解（产能推演/瓶颈/归因等），返回可溯源结果。", keywords: ["求解", "计算", "solve", "推演求解器", "调用求解器"], endpoint: "/a/v1/solvers", requiredSlots: ["solverKey"], r4: false, cliCommand: "solve", uiDeepLink: "/admin/solvers/new" },
  { op: "synth", label: "合成数据·生成作业", description: "合成数据：按行业×规模×种子确定性生成业务数据作业，物化到未审核态供后续读回分析。", keywords: ["合成", "造数据", "synth", "synthetic", "种子"], endpoint: "/a/v1/synthetic/jobs", requiredSlots: ["industry"], r4: false, cliCommand: "synth" },
  { op: "build", label: "数据构建发动机（FDE）·故事建域", description: "故事驱动建域：以自然语言故事倒推全栈 BuildPlan，建出对象/规则/求解器骨架（未审核态）。", keywords: ["建域", "故事", "build", "倒推", "发动机"], endpoint: "/a/v1/databuilder/runs", requiredSlots: ["script"], r4: false, cliCommand: "build" },
  // scene-config 在 scenario 之前，使“场景配置”与“场景”同分时前者胜出（PRD-CLI §A3b 0 误路由）
  { op: "scene-config", label: "场景/视图配置·入口/包/视图", description: "配置场景入口/能力包/视图渲染：治理前端场景卡片与视图分发（GUI 深链）。", keywords: ["场景配置", "视图配置", "scene", "入口", "包", "view-config"], endpoint: "/b/v1/scene-entries", requiredSlots: [], r4: false, cliCommand: "scene-config", uiDeepLink: "/admin/scenes" },
  { op: "scenario", label: "场景入口/启动器", description: "浏览与启动场景入口卡片：从场景启动器进入某业务分析/操作流程。", keywords: ["场景", "启动", "scenario", "launch", "卡片"], endpoint: "/b/v1/scenarios", requiredSlots: [], r4: false, cliCommand: "scenarios" },
  { op: "approve", label: "Action 审批", description: "审批 Action 草稿：批复/驳回待执行的写真值动作（R4 唯一落地闸）。", keywords: ["审批", "批复", "approve", "草稿", "draft"], endpoint: "/a/v1/action-drafts", requiredSlots: ["draftId"], r4: true, cliCommand: "approve" },
  { op: "agent", label: "Agent/智能体 配置", description: "配置智能体：建/编辑 Agent 定义、工具授权与场景绑定。", keywords: ["agent", "智能体"], endpoint: "/b/v1/agents", requiredSlots: [], r4: false, cliCommand: "agent" },
  { op: "workflow", label: "工作流编排·建/发布/列", description: "编排工作流：建/发布/列出多步声明式流程（路径 A 查询编排的供给侧）。", keywords: ["工作流", "编排", "workflow", "流程", "步骤"], endpoint: "/b/v1/workflows", requiredSlots: [], r4: false, cliCommand: "workflow" },
  { op: "skill", label: "技能·建/绑定/列", description: "管理技能：建/绑定/列出可渐进披露的能力句与附件资源。", keywords: ["技能", "skill", "能力句", "解读"], endpoint: "/b/v1/skills", requiredSlots: [], r4: false, cliCommand: "skill" },
  { op: "mcp", label: "MCP·服务/工具配置", description: "配置 MCP：注册外部工具服务与工具清单，治理按需加载的 mcp_tool 池。", keywords: ["mcp", "外部工具", "工具服务", "server", "tool"], endpoint: "/b/v1/mcp-configs", requiredSlots: [], r4: false, cliCommand: "mcp" },
  { op: "eval", label: "评测套件·跑/历史/parity", description: "评测：跑测试套件、查历史与 parity 回归，守能力不漂移。", keywords: ["评测", "eval", "用例", "套件", "回归", "parity"], endpoint: "/b/v1/evals", requiredSlots: [], r4: false, cliCommand: "eval" },
  { op: "llm", label: "LLM 供应商/用途绑定/预算", description: "管理 LLM：供应商凭据、用途绑定、预算配额（凭据加密落库、响应不回显明文）。", keywords: ["llm", "供应商", "provider", "模型", "绑定", "binding", "预算", "budget"], endpoint: "/a/v1/llm-providers", requiredSlots: [], r4: false, cliCommand: "llm" },
  { op: "ops", label: "运营/调度/模拟时钟/回放", description: "运营台：作业调度、模拟时钟 tick、运营态回放与 persona 驱动。", keywords: ["运营", "调度", "scheduler", "时钟", "tick", "回放", "replay", "persona"], endpoint: "/a/v1/scheduler/jobs", requiredSlots: [], r4: false, cliCommand: "ops" },
  { op: "tenant", label: "租户/用户/角色 IAM", description: "IAM 治理：租户、用户、角色与账号管理（跨租户一律隔离）。", keywords: ["租户", "tenant", "用户", "user", "角色", "role", "账号"], endpoint: "/a/v1/tenants", requiredSlots: [], r4: false, cliCommand: "tenant", uiDeepLink: "/admin/tenants" },
  { op: "catalog", label: "语义目录·检索（schema-linking）", description: "语义目录检索（schema-linking）：把自然语言落到具体的 类型.字段，供字段发现与生成接地。", keywords: ["目录", "catalog", "检索", "schema", "找列", "找表", "描述"], endpoint: "/a/v1/catalog/search", requiredSlots: ["q"], r4: false, cliCommand: "catalog" },
  { op: "connection", label: "连接器实例·校验策略/分类/模版", description: "连接器实例治理：配置校验策略、数据分类与导入模版。", keywords: ["连接器实例", "连接", "connection", "校验策略", "数据分类", "模版"], endpoint: "/a/v1/connections", requiredSlots: [], r4: false, cliCommand: "connection" },
  { op: "meta", label: "系统自我本体·同步/影响分析", description: "系统自我本体：同步元本体、做『改 X 影响什么』影响分析（dogfooding）。", keywords: ["meta", "系统本体", "元本体", "影响分析", "dogfooding", "impact"], endpoint: "/a/v1/meta/sync", requiredSlots: [], r4: false, cliCommand: "meta" },
  { op: "slice", label: "本体切片·规划/库/索引", description: "本体切片：规划/复用多跳子图、查切片库与索引（QOS 数据供给侧）。", keywords: ["切片", "slice", "路径", "子图", "规划器"], endpoint: "/a/v1/slices", requiredSlots: [], r4: false, cliCommand: "slice" },
  { op: "rule-extract", label: "规则文档抽取·上传/候选审核", description: "规则文档抽取：上传规则文档、审核抽取出的候选规则再入库。", keywords: ["规则抽取", "规则文档", "ruledoc", "抽取", "候选", "审核规则"], endpoint: "/a/v1/rule-docs", requiredSlots: [], r4: false, cliCommand: "rule-extract" },
  { op: "sop", label: "S&OP 月度平衡·版本/定稿", description: "S&OP 月度产销平衡：建版本、五步法推演、经 R4 审批定稿。", keywords: ["sop", "产销平衡", "月度平衡", "版本", "定稿", "五步法"], endpoint: "/a/v1/sop/versions", requiredSlots: [], r4: true, cliCommand: "sop" },
  { op: "platform-config", label: "平台配置·提示词/工厂日历/写回回声", description: "平台配置：提示词模板、工厂日历、写回回声等平台级参数治理。", keywords: ["平台配置", "提示词", "prompt", "日历", "calendar", "写回", "writeback"], endpoint: "/a/v1/prompt-templates", requiredSlots: [], r4: false, cliCommand: "platform-config" },
  { op: "validate", label: "校验/VLE·跑验证", description: "校验：跑 VLE 验证作业，评估查全/查准与参照一致性。", keywords: ["校验", "validation", "vle", "验证", "查全查准", "参照"], endpoint: "/a/v1/validation/runs", requiredSlots: [], r4: false, cliCommand: "validate" },
  { op: "metric", label: "经营指标/KSF/责任主体（SPINE）", description: "经营主脊（SPINE）：治理经营指标、关键成功要素 KSF、责任主体与达成情况。", keywords: ["指标", "metric", "ksf", "责任主体", "principal", "达成"], endpoint: "/a/v1/metrics", requiredSlots: [], r4: false, cliCommand: "metric", uiDeepLink: "/admin/metrics" },
  { op: "notify", label: "通知中心·列/已读", description: "通知中心：列出/标记已读平台消息与提醒。", keywords: ["通知", "notification", "消息", "收件箱", "提醒"], endpoint: "/a/v1/notifications", requiredSlots: [], r4: false, cliCommand: "notify" },
  { op: "config-bundle", label: "配置迁移·导出/导入（环境间 Saga）", description: "配置迁移：跨环境导出/导入配置包（Saga 事务）。", keywords: ["配置迁移", "config bundle", "导出配置", "导入配置", "环境迁移", "saga"], endpoint: "/a/v1/config-bundles", requiredSlots: [], r4: false, cliCommand: "config-bundle" },
  { op: "boundary", label: "生成边界·词表/影响/发布", description: "生成边界：管理业务词表与生成接地边界、做影响分析并经 R4 发布。", keywords: ["生成边界", "boundary", "业务词表", "边界", "接地", "发布边界"], endpoint: "/a/v1/boundary", requiredSlots: [], r4: true, cliCommand: "boundary" },
  { op: "calibration", label: "校准·提案/应用", description: "校准：生成/应用校准提案，对齐派生与真值（经 R4 审批）。", keywords: ["校准", "calib", "calibration", "提案"], endpoint: "/a/v1/calibration", requiredSlots: [], r4: true, cliCommand: "calib" },
  { op: "policy", label: "权限/策略·行级过滤", description: "权限策略：配置行级过滤等数据访问策略。", keywords: ["权限", "策略", "policy", "行级", "过滤"], endpoint: "/a/v1/policies", requiredSlots: [], r4: false, cliCommand: "policy" },
  { op: "signal", label: "外部信号·敏感性", description: "外部信号：管理外部敏感性信号与弹性参数。", keywords: ["信号", "敏感性", "signal", "外部", "弹性"], endpoint: "/a/v1/external-signals", requiredSlots: [], r4: false, cliCommand: "signals" },
  { op: "quarantine", label: "隔离区/实体合并", description: "隔离区：审阅隔离数据、合并重复实体后重入（经 R4 审批）。", keywords: ["隔离", "合并", "quarantine", "merge", "重入"], endpoint: "/a/v1/quarantine", requiredSlots: [], r4: true, cliCommand: "quarantine" },
  { op: "features", label: "功能开通·entitlement", description: "功能开通（entitlement）：切换租户级 feature 开关（关=能力不存在，404）。", keywords: ["功能", "开通", "features", "entitlement", "开关"], endpoint: "/a/v1/features", requiredSlots: [], r4: false, cliCommand: "features" },
  { op: "growth", label: "自成长·工单/施工", description: "自成长发动机：发现/认领/提交成长工单，厂商中立施工闭环。", keywords: ["工单", "成长", "ticket", "claim", "grow"], endpoint: "/api/v1/growth", requiredSlots: [], r4: false, cliCommand: "tickets" },
  { op: "kb", label: "知识库·索引/检索", description: "知识库：索引/检索已同步文档，供语义检索与答案溯源。", keywords: ["知识库", "kb", "检索", "索引", "文档"], endpoint: "/a/v1/kb", requiredSlots: [], r4: false, cliCommand: "kb" },
  { op: "bootstrap", label: "空租户冷启动引导·计划域 seed→SopVersion 定稿", description: "冷启动引导：空租户一键 seed 计划域并定稿首版 SopVersion（经 R4 审批）。", keywords: ["引导", "冷启动", "bootstrap", "空租户", "初始化", "一键引导"], endpoint: "/a/v1/bootstrap", requiredSlots: [], r4: true, cliCommand: "bootstrap" },
  { op: "sim", label: "推演沙盘·会话/tick/检查点/分支（G-11·暗发 entitlement）", description: "推演沙盘：开会话、tick 传导、检查点与分支（模拟态，绝不写真值）。", keywords: ["沙盘", "推演", "sim", "sandbox", "tick", "传导", "检查点", "分支"], endpoint: "/a/v1/sim/sessions", requiredSlots: [], r4: false, cliCommand: "sim" },
];

export const OperationClassifyKindSchema = z.enum(["QUERY", "OPERATION"]);
export type OperationClassifyKind = z.infer<typeof OperationClassifyKindSchema>;

export const OperationCandidateSchema = z.object({ op: z.enum(OPERATION_KINDS), score: z.number(), label: z.string() });
export type OperationCandidate = z.infer<typeof OperationCandidateSchema>;

/** operations/classify 输出：QUERY 走 QOS ask；OPERATION 路由到模块（低置信/多候选 → candidates 让用户选，不瞎猜）。 */
export const OperationClassifyOutputSchema = z.object({
  kind: OperationClassifyKindSchema,
  op: z.enum(OPERATION_KINDS).optional(),
  confidence: z.number(),
  /** 命中的目标端点 + 是否 R4 + 必填槽（CLI 据此交互补参）。 */
  endpoint: z.string().optional(),
  r4: z.boolean().optional(),
  requiredSlots: z.array(z.string()).default([]),
  cliCommand: z.string().optional(),
  uiDeepLink: z.string().optional(),
  /** 多候选（不确定时列出让用户选）。 */
  candidates: z.array(OperationCandidateSchema).default([]),
});
export type OperationClassifyOutput = z.infer<typeof OperationClassifyOutputSchema>;

export const OperationClassifyRequestSchema = z.object({ input: z.string().min(1) });
export type OperationClassifyRequest = z.infer<typeof OperationClassifyRequestSchema>;

/**
 * 确定性操作意图分类（R6：纯关键词打分，无 LLM；意图分类的不确定不影响被触发操作的确定性）。
 * 命中操作关键词 → OPERATION（取最高分；并列/低分 → candidates 让用户选）；无命中 → QUERY（走 QOS ask）。
 */
export function classifyOperation(input: string): OperationClassifyOutput {
  const s = input.toLowerCase();
  const scored = OPERATION_CATALOG.map((e) => ({
    entry: e,
    score: e.keywords.reduce((n, k) => (s.includes(k.toLowerCase()) ? n + 1 : n), 0),
  })).filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score || OPERATION_CATALOG.indexOf(a.entry) - OPERATION_CATALOG.indexOf(b.entry));

  if (scored.length === 0) {
    return { kind: "QUERY", confidence: 1, requiredSlots: [], candidates: [] };
  }
  const top = scored[0]!;
  const candidates = scored.map((x) => ({ op: x.entry.op, score: x.score, label: x.entry.label }));
  // 置信度：top 分占总命中比（独占 → 高；多 op 并列 → 低，CLI 列候选）。
  const totalHits = scored.reduce((n, x) => n + x.score, 0);
  const tiedTop = scored.filter((x) => x.score === top.score).length;
  const confidence = tiedTop > 1 ? 0.5 : Math.min(1, top.score / Math.max(1, totalHits) + 0.3);
  return {
    kind: "OPERATION",
    op: top.entry.op,
    confidence,
    endpoint: top.entry.endpoint,
    r4: top.entry.r4,
    requiredSlots: top.entry.requiredSlots,
    ...(top.entry.cliCommand ? { cliCommand: top.entry.cliCommand } : {}),
    ...(top.entry.uiDeepLink ? { uiDeepLink: top.entry.uiDeepLink } : {}),
    candidates,
  };
}
