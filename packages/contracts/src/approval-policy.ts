/**
 * WO-APPROVAL-POLICY · **批复策略引擎**（Approval Policy Engine）。
 *
 * ══ 这份文件解决的那一个问题 ═════════════════════════════════════════════
 *
 * 仓主原话：**「批复流程必须与业务流程分开，二者是正交的。」**
 *
 *   业务流程：`订单变更 → 产能分析 → 排产`
 *   批复流程：`销售经理 → 计划经理 → 供应链 → 财务 → 制造 → 经营负责人`
 *
 * 同一个业务节点（如 `Capacity Shortage`），产能缺口 12% 走一条链、毛利率 7.2% 走另一条链。
 * 所以 **批复链不是写死的 Workflow，而是由「业务规则 × 组织权限」在求值时生成的**：
 *
 *   ApprovalPolicy.condition（业务规则·复用 A5 规则 DSL）
 *     ×  ApprovalAuthority（组织权限·谁有权签这一级）
 *     =  ApprovalChain（本次、本上下文下的批复链）
 *
 * ── 🔴 红线 1 · 批复链**不得**嵌进业务流程定义 ────────────────────────────
 *
 * `ProcessDefinition`（`process.ts` §4）**一个字段都不许为审批而加**。它的注释里已经写死了
 * 这条纪律的前半句：`PROCESS_WAIT_KINDS` 刻意只有四种、**没有** `WAITING_APPROVAL`，理由原文是
 * 「流程级审批既无承载物、也无状态机、也无消费方 …… 真要做审批，**先有承载物再回来加这一项**」。
 *
 * 本文件就是那个承载物（`ApprovalInstance` + `ApprovalTask` = 状态机与消费方）。但**承载物有了
 * 也不等于该往流程层加字段** —— 恰恰相反：正交的做法是业务节点只发出「需要批复 + 上下文事实」
 * （`ApprovalRequest`），由本引擎决定链条。业务流程定义因此**零改动**，
 * 这一点由 `apps/datacore/test/approval-policy.test.ts` 的正交性断言机器化守住：
 *   · 只改 policy（一个数）→ 链变；
 *   · 只改 ProcessDefinition（名字/职能/工期）→ 链**逐字节不变**。
 * 谁哪天把 `approvalChain` 塞进 `ProcessDefinitionSchema`，第二条断言当场红。
 *
 * ── 🔴 红线 2 · `condition` 复用既有规则 DSL，**不许另造一套表达式语言** ──
 *
 * 本仓出过「两个 dev 各造一套词表、交集为 0」的事故。`condition` 是 `apps/datacore/src/ruledsl.ts`
 * 的表达式字符串，逐字复用它的词法/语法/求值器与**命名阈值** `params.<名>` 一等操作数
 * （`ruledsl.ts` Operand `kind:"param"`）：阈值只存 `params` 一处，`condition` 只引用不复制。
 * 发布期校验直接调 `rules.ts` 的 `assertValidExpression`（同一份实现，不抄第二份）。
 *
 * ── 🔴 红线 3 · 组织权限只建**本引擎必需的最小面** ────────────────────────
 *
 * 实测（2026-08-10，金丝雀已自证 grep 有效）：`ApprovalLimit` / `ApprovalAuthority` / `OrgUnit`
 * 全仓 **0 命中** —— 组织权限世界今天不存在。本单**不**把它整个建起来（那是另一张单），
 * 只建链路求值必需的一层：`ApprovalAuthority`（权限位 = 谁能签这一级）。
 * 缺什么、为什么不在本单做，见 `docs/WO-APPROVAL-POLICY-delivery.md` §6。
 *
 * ── R6 确定性 / R14 行业无关 ──────────────────────────────────────────────
 * 全文件常量 + zod schema，无时钟、无随机。求值结果只由 (policies, authorities, facts) 决定；
 * 合并次序是**全序**（见 §5 `mergeOrder`），同输入必同输出。
 * 职能/职级/链条内容属租户组织数据，落种子与租户配置，不在本文件。
 */
import { z } from "zod";

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 组织权限最小面 `ApprovalAuthority`
// ══════════════════════════════════════════════════════════════════════════

/**
 * 一个**权限位**：组织里「有权签这一级」的那个位置（如 `planning_director` 计划总监）。
 *
 * ── 为什么不直接用平台角色（`roles` claim）当批复链元素 ────────────────────
 * 因为二者是**两个层次**，混用会把组织结构焊死在鉴权词表上：
 *  · `roleKey`（平台角色，如 `planner`/`admin`）回答「**谁能操作**」——鉴权用，粒度粗、跨租户复用；
 *  · `key`（权限位，如 `planning_director`）回答「**这一级由哪个岗位把关**」——组织用，
 *    随企业层级走，同一个 `roleKey` 可以承载多个层级的权限位（计划经理与计划总监都是 `planner`，
 *    但**不是同一级**，签字先后不同）。
 * 所以链条元素是权限位，落到具体人时才经 `roleKey` 去 `users` 里解析候选批复人。
 *
 * ── `functionKey` 为什么必须锚到既有登记册 ────────────────────────────────
 * `process.ts` §2 的 `PROCESS_OWNER_FUNCTIONS`（15 条职能）已经是本平台「谁做」的单一词表。
 * 权限位若另起一套部门名，就是第二套组织词表 —— 与 `process.ts` §3 极力避免的那次事故同形态。
 * 故 `functionKey` 必须落在该登记册内，由 `approval-policy.test.ts` 断言（不是装饰）。
 */
export const ApprovalAuthoritySchema = z.strictObject({
  /** 仓储主键（`Store<T>` 要求 id + tenantId）。形如 `auth_<tenant>_planning_director`。 */
  id: z.string().min(1),
  tenantId: z.string().min(1), // R2
  /** 权限位 key，租户内唯一。形如 `planning_director`（小写下划线）。 */
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, "authority key 须为小写下划线标识符"),
  displayName: z.string().min(1),
  /** 🔴 锚到 `PROCESS_OWNER_FUNCTION_KEYS`（15 条职能登记册）—— 见上方注释。 */
  functionKey: z.string().min(1),
  /**
   * 解析到具体批复人时使用的平台角色（`users.roles` / `X-Debug-User` 的角色串）。
   * 允许带限定后缀（如 `base_manager:常州`）—— 与 `authz.ts` 的 `roleMatches` 同口径，
   * 本引擎解析候选人时按 base role 比对。
   */
  roleKey: z.string().min(1),
  /**
   * 组织**层级**：数越大越高（如 经理 10 / 总监 20 / 经营负责人 40）。
   *
   * 这个字段是合并口径的骨架（见 §5）：多条策略同时命中时，链条按 level 升序 = 逐级上报。
   * 它**不是**装饰性排序键 —— 换掉它，「终审人 = 命中策略中层级最高者」这条语义就没了。
   */
  level: z.number().int().nonnegative(),
});
export type ApprovalAuthority = z.infer<typeof ApprovalAuthoritySchema>;

// ══════════════════════════════════════════════════════════════════════════
// § 2 · 批复策略 `ApprovalPolicy`
// ══════════════════════════════════════════════════════════════════════════

/**
 * 一条批复策略 —— 逐条对应仓主给的 YAML：
 *
 * ```yaml
 * approval_policy:
 *   condition: capacity_gap > 10%
 *   approval: [planning_director, manufacturing_director, gm]
 * ```
 *
 * `condition` 落成规则 DSL 字符串 + 命名阈值：
 *   `{ condition: "capacity_gap > params.gapThreshold", params: { gapThreshold: 0.10 } }`
 * 阈值走 `params` 而不是把 `0.10` 写进表达式，是为了「改一个数」是**改数据**不是改表达式
 * （也让 `collectParamRefs` 的闭包校验能挡住引用未声明阈值的哑弹策略）。
 */
export const ApprovalPolicySchema = z.strictObject({
  id: z.string().min(1),
  tenantId: z.string().min(1), // R2
  /** 策略 key，租户内唯一。 */
  key: z.string().min(1),
  name: z.string().min(1),
  /**
   * 触发条件 —— **规则 DSL 表达式**（`apps/datacore/src/ruledsl.ts`，红线 2）。
   * 求值为 true ⇒ 本策略命中 ⇒ 其 `approval` 序列并入本次批复链。
   */
  condition: z.string().min(1),
  /** 本策略的命名阈值（供 `params.<名>` 解析）。`condition` 引用的名字必须都在这里声明。 */
  params: z.record(z.string(), z.number()).default({}),
  /**
   * 批复人序列 —— `ApprovalAuthority.key` 的有序列表（业务序，如
   * `[planning_director, manufacturing_director, gm]`）。
   *
   * ⚠ 这里存的是**权限位 key，不是人、也不是平台角色**（§1 注释）。
   * 引用了未定义的权限位不会被静默丢掉：求值时进 `missing`、`degraded=true`（§4 诚实降级）。
   */
  approval: z.array(z.string().min(1)).min(1),
  /**
   * 适用主体类型白名单（如 `["process"]` / `["decision"]`）。**空数组 = 不限主体**。
   *
   * 这是"策略挑业务"，方向刻意与红线 1 一致：业务侧不知道有哪些策略，策略侧自己声明适用范围。
   * 反过来做（业务定义里列出要走哪些策略）就是把批复链焊回业务流程，正交性当场丢失。
   */
  subjectKinds: z.array(z.string().min(1)).default([]),
  /**
   * 合并时的策略优先级（数小者先）。**只影响同层级权限位之间的先后**，不影响是否命中。
   * 存在的理由是确定性（R6）：两条策略贡献了同 level 的两个权限位时，需要一个全序键。
   */
  priority: z.number().int().default(100),
  status: z.enum(["DRAFT", "PUBLISHED"]).default("DRAFT"),
});
export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>;

// ══════════════════════════════════════════════════════════════════════════
// § 3 · 求值输入 `ApprovalRequest`
// ══════════════════════════════════════════════════════════════════════════

/**
 * 业务侧发出的**唯一**东西：「我需要批复 + 这是上下文事实」。
 *
 * 🔴 正交性的实现落点就在这个形状上：这里**没有** `chain`、没有 `approvers`、没有 `policyKeys`。
 * 业务节点无从指定批复链 —— 想指定也没有字段可填。能力的缺席就是纪律的载体。
 */
export const ApprovalRequestSchema = z.strictObject({
  /** 主体类型，如 `process` / `decision` / `action`。与 `ApprovalPolicy.subjectKinds` 比对。 */
  subjectKind: z.string().min(1),
  /** 主体标识（如 `P40`、决策 id）。引擎**不解释**它，只随实例存档供追溯。 */
  subjectKey: z.string().min(1),
  /**
   * 上下文事实 —— 交给规则 DSL 求值的 payload（如 `{ capacity_gap: 0.12, gross_margin: 0.072 }`）。
   * 字段名由策略作者与业务节点约定，引擎不预设词表（R14 行业无关）。
   */
  facts: z.record(z.string(), z.unknown()).default({}),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

// ══════════════════════════════════════════════════════════════════════════
// § 4 · 求值结果 `ApprovalChainResolution`
// ══════════════════════════════════════════════════════════════════════════

/** 链条上的一级。`viaPolicyKeys` 是溯源：这一级是被哪几条策略要求的。 */
export const ApprovalChainStepSchema = z.strictObject({
  seq: z.number().int().positive(),
  authorityKey: z.string().min(1),
  displayName: z.string().min(1),
  functionKey: z.string().min(1),
  roleKey: z.string().min(1),
  level: z.number().int().nonnegative(),
  /** 溯源：要求这一级的策略 key（升序去重）。多条 ⇒ 这一级是被合并出来的。 */
  viaPolicyKeys: z.array(z.string().min(1)).min(1),
});
export type ApprovalChainStep = z.infer<typeof ApprovalChainStepSchema>;

/**
 * **诚实降级**的载体（工单判据④）。缺组织权限数据时，引擎既不静默返回空链，也不兜底给 gm ——
 * 而是把「缺谁、为什么缺、是哪条策略要的」逐条报出来，并把 `degraded` 置真。
 *
 * 两种缺法必须分开（本仓「三种不工作不许混为一谈」的同一条纪律）——修法完全不同：
 *  · `AUTHORITY_UNDEFINED`   权限位本身没登记 ⇒ 补 `ApprovalAuthority` 数据（或改策略拼写）。
 *  · `NO_ELIGIBLE_APPROVER`  权限位登记了，但租户里**没有人**持有它的 `roleKey` ⇒ 补人/补角色。
 * 合成一句「组织数据缺失」会让人去改错的地方。
 */
export const APPROVAL_MISSING_REASONS = ["AUTHORITY_UNDEFINED", "NO_ELIGIBLE_APPROVER"] as const;
export const ApprovalMissingSchema = z.strictObject({
  authorityKey: z.string().min(1),
  reason: z.enum(APPROVAL_MISSING_REASONS),
  detail: z.string().min(1),
  viaPolicyKeys: z.array(z.string().min(1)).min(1),
});
export type ApprovalMissing = z.infer<typeof ApprovalMissingSchema>;

/** 逐策略求值痕迹（含求值出错的策略——出错不等于未命中，必须分开报）。 */
export const ApprovalPolicyTraceSchema = z.strictObject({
  policyKey: z.string().min(1),
  matched: z.boolean(),
  /** 未参与求值的原因（主体类型不适用 / 表达式求值抛错）。命中或正常未命中时为 undefined。 */
  skipped: z.string().optional(),
  error: z.string().optional(),
});
export type ApprovalPolicyTrace = z.infer<typeof ApprovalPolicyTraceSchema>;

export const ApprovalChainResolutionSchema = z.strictObject({
  /** 是否需要批复 = 至少一条策略命中。零命中 ⇒ false + 空链（这是**正常**结论，不是降级）。 */
  required: z.boolean(),
  chain: z.array(ApprovalChainStepSchema),
  /** 命中的策略 key（升序）。 */
  matchedPolicyKeys: z.array(z.string().min(1)),
  /** 逐策略痕迹（按 policyKey 升序，确定性 R6）。 */
  trace: z.array(ApprovalPolicyTraceSchema),
  /** 诚实降级清单（见上）。非空 ⇒ `degraded` 必为 true。 */
  missing: z.array(ApprovalMissingSchema),
  /**
   * 链条**不完整**。true 时链条不可用于开审批实例（路由直接 409），
   * 因为一条缺了把关人的链跑起来 = 拿一条看着合理的链冒充完整的链。
   */
  degraded: z.boolean(),
});
export type ApprovalChainResolution = z.infer<typeof ApprovalChainResolutionSchema>;

// ══════════════════════════════════════════════════════════════════════════
// § 5 · 合并口径（多条策略同时命中）
// ══════════════════════════════════════════════════════════════════════════

/**
 * **并集 + 去重 + 按 (level, priority, 首现序) 升序** —— 三句话，缺一条就不是全序。
 *
 * ── 为什么是并集而不是"取最严的那一条" ────────────────────────────────────
 * 两条策略各自代表一个**独立的把关诉求**（产能缺口要计划+制造把关；毛利过低要财务+销售把关）。
 * 取其一丢其一 ⇒ 被丢那条的诉求**无人把关**，而界面上审批还照走 —— 这正是本仓最怕的
 * 「看着在跑其实没在管」。所以合并 = 并集，一个诉求都不丢。
 *
 * ── "最严"去哪了：它是并集的**效果**，不是另一种口径 ─────────────────────
 * 并集之后，链条的**终审人 = 命中策略中层级最高者**（level 最大者排最后）。
 * 即：任何一条策略要求上到经营负责人，合并链就一定上到经营负责人 —— 严的那条被完整保留，
 * 且宽的那条也没被吞掉。这比"取最严"更严，不是折中。
 *
 * ── 去重的判据是**权限位**，不是人也不是角色 ──────────────────────────────
 * 两条策略都要 `gm` ⇒ `gm` 只出现一次（同一个人不该为同一件事签两次），
 * 但溯源 `viaPolicyKeys` 记两条 —— 谁要求的这一级不能因为去重而丢失。
 *
 * ── 排序键为什么要三段 ────────────────────────────────────────────────────
 * `level` 定逐级上报；同 level 时用**贡献策略的最小 priority**（业务上更重要的策略先签）；
 * 再同则用**首现序**（策略按 key 升序遍历、序列内按声明序）—— 这一段是确定性兜底（R6）：
 * 没有它，同 level 同 priority 的两个权限位次序会随存储迭代序漂，重跑结果就不字节一致了。
 */
export const APPROVAL_MERGE_MODE = "UNION_BY_LEVEL" as const;

/** 一条内置的默认权限位登记（**仅** demo/测试种子引用；引擎不硬编码任何权限位）。 */
export const APPROVAL_AUTHORITY_SEED_HINT =
  "权限位属租户组织数据，随种子落库；引擎侧零硬编码（改种子不改代码）";

// ══════════════════════════════════════════════════════════════════════════
// § 6 · 批复实例与任务（状态机 = 承载物）
// ══════════════════════════════════════════════════════════════════════════

export const APPROVAL_TASK_STATUSES = ["PENDING", "APPROVED", "REJECTED", "SKIPPED"] as const;
export const ApprovalTaskSchema = z.strictObject({
  seq: z.number().int().positive(),
  authorityKey: z.string().min(1),
  roleKey: z.string().min(1),
  level: z.number().int().nonnegative(),
  viaPolicyKeys: z.array(z.string().min(1)).min(1),
  status: z.enum(APPROVAL_TASK_STATUSES),
  approverId: z.string().optional(),
  comment: z.string().optional(),
  decidedAt: z.string().optional(),
});
export type ApprovalTask = z.infer<typeof ApprovalTaskSchema>;

export const APPROVAL_INSTANCE_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export const ApprovalInstanceSchema = z.strictObject({
  id: z.string().min(1),
  tenantId: z.string().min(1), // R2
  subjectKind: z.string().min(1),
  subjectKey: z.string().min(1),
  /**
   * 求值时的事实快照。**必须存**：链条是这堆事实在那一刻求出来的，事实变了链条的解释坐标就变了
   * （同 `actions.ts` 的 `actionTypeVersion` 快照同一条理由 —— 历史记录要有永久解释坐标）。
   */
  facts: z.record(z.string(), z.unknown()),
  /** 派生这条链的策略 key（升序）。溯源用，不参与状态机。 */
  matchedPolicyKeys: z.array(z.string().min(1)),
  tasks: z.array(ApprovalTaskSchema).min(1),
  status: z.enum(APPROVAL_INSTANCE_STATUSES),
  createdBy: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type ApprovalInstance = z.infer<typeof ApprovalInstanceSchema>;
