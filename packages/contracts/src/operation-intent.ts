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
  "scenario", "approve", "agent", "calibration", "policy", "signal",
  "quarantine", "features", "growth", "kb", "bootstrap", "sim",
] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

/** 操作型意图目录条目（配置驱动 R14）。 */
export const OperationCatalogEntrySchema = z.object({
  op: z.enum(OPERATION_KINDS),
  /** GUI 能力一句话（覆盖矩阵行）。 */
  label: z.string(),
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
  { op: "import", label: "连接器·建连接/上传/同步", keywords: ["导入", "上传", "import", "csv", "连接器", "数据接入"], endpoint: "/a/v1/connectors/upload", requiredSlots: ["file"], r4: false, cliCommand: "import" },
  { op: "model", label: "半自动建模·数据→本体草稿→发布", keywords: ["建模", "本体", "model", "建模型", "类型", "schema"], endpoint: "/a/v1/modeling/derive", requiredSlots: ["datasetIds"], r4: true, cliCommand: "model" },
  { op: "browse", label: "对象/类型浏览（A4）", keywords: ["浏览", "看类型", "对象", "browse", "types", "实例"], endpoint: "/a/v1/ontology/object-types/stats", requiredSlots: [], r4: false, cliCommand: "types" },
  { op: "rule", label: "规则库·建/dry-run/发布", keywords: ["规则", "约束", "rule", "校验", "底线"], endpoint: "/a/v1/rules", requiredSlots: ["expression"], r4: true, cliCommand: "rule" },
  { op: "solve", label: "求解器·调用既有", keywords: ["求解", "计算", "solve", "推演求解器", "调用求解器"], endpoint: "/a/v1/solvers", requiredSlots: ["solverKey"], r4: false, cliCommand: "solve", uiDeepLink: "/admin/solvers/new" },
  { op: "synth", label: "合成数据·生成作业", keywords: ["合成", "造数据", "synth", "synthetic", "种子"], endpoint: "/a/v1/synthetic/jobs", requiredSlots: ["industry"], r4: false, cliCommand: "synth" },
  { op: "build", label: "数据构建发动机（FDE）·故事建域", keywords: ["建域", "故事", "build", "倒推", "发动机"], endpoint: "/a/v1/databuilder/runs", requiredSlots: ["script"], r4: false, cliCommand: "build" },
  { op: "scenario", label: "场景入口/启动器", keywords: ["场景", "启动", "scenario", "launch", "卡片"], endpoint: "/b/v1/scenarios", requiredSlots: [], r4: false, cliCommand: "scenarios" },
  { op: "approve", label: "Action 审批", keywords: ["审批", "批复", "approve", "草稿", "draft"], endpoint: "/a/v1/action-drafts", requiredSlots: ["draftId"], r4: true, cliCommand: "approve" },
  { op: "agent", label: "Agent/Skill/Workflow 配置", keywords: ["agent", "技能", "skill", "工作流", "workflow", "智能体"], endpoint: "/b/v1/agents", requiredSlots: [], r4: false, cliCommand: "agent" },
  { op: "calibration", label: "校准·提案/应用", keywords: ["校准", "calib", "calibration", "提案"], endpoint: "/a/v1/calibration", requiredSlots: [], r4: true, cliCommand: "calib" },
  { op: "policy", label: "权限/策略·行级过滤", keywords: ["权限", "策略", "policy", "行级", "过滤"], endpoint: "/a/v1/policies", requiredSlots: [], r4: false, cliCommand: "policy" },
  { op: "signal", label: "外部信号·敏感性", keywords: ["信号", "敏感性", "signal", "外部", "弹性"], endpoint: "/a/v1/external-signals", requiredSlots: [], r4: false, cliCommand: "signals" },
  { op: "quarantine", label: "隔离区/实体合并", keywords: ["隔离", "合并", "quarantine", "merge", "重入"], endpoint: "/a/v1/quarantine", requiredSlots: [], r4: true, cliCommand: "quarantine" },
  { op: "features", label: "功能开通·entitlement", keywords: ["功能", "开通", "features", "entitlement", "开关"], endpoint: "/a/v1/features", requiredSlots: [], r4: false, cliCommand: "features" },
  { op: "growth", label: "自成长·工单/施工", keywords: ["工单", "成长", "ticket", "claim", "grow"], endpoint: "/api/v1/growth", requiredSlots: [], r4: false, cliCommand: "tickets" },
  { op: "kb", label: "知识库·索引/检索", keywords: ["知识库", "kb", "检索", "索引", "文档"], endpoint: "/a/v1/kb", requiredSlots: [], r4: false, cliCommand: "kb" },
  { op: "bootstrap", label: "空租户冷启动引导·计划域 seed→SopVersion 定稿", keywords: ["引导", "冷启动", "bootstrap", "空租户", "初始化", "一键引导"], endpoint: "/a/v1/bootstrap", requiredSlots: [], r4: true, cliCommand: "bootstrap" },
  { op: "sim", label: "推演沙盘·会话/tick/检查点/分支（G-11·暗发 entitlement）", keywords: ["沙盘", "推演", "sim", "sandbox", "tick", "传导", "检查点", "分支"], endpoint: "/a/v1/sim/sessions", requiredSlots: [], r4: false, cliCommand: "sim" },
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
