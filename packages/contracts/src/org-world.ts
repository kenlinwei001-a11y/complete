/**
 * WO-ORG-WORLD · **组织世界**（七世界之②）。
 *
 * 仓主原话：「真实企业最重要的不是机器，而是人。」本文件的目的只有一个 ——
 * 让系统能回答「**为什么这个流程现在卡住了**」。卡住的答案十有八九不在机器侧，
 * 而在人侧：**没人有那么大的额度**、**有额度的那个人不在岗**、**跨基地这件事谁都批不了**。
 *
 * ══ 🔴 单源红线：扩既有 `Principal`，**不新造 `Person`** ═══════════════════════
 *
 * `spine.ts` 的 `PrincipalSchema` 已经是本仓的身份/责任主体载体，
 * 且 `PRINCIPAL_KINDS = ["org","role","person"]` **三值本来就含 person**。
 * 组织世界要的 Person / Role / Department 三者，在既有模型里分别是
 * `kind="person"` / `kind="role"` / `kind="org"` —— **一个字段就够，不需要第二个身份类型**。
 *
 * 所以本文件的 `OrgPrincipalSchema` 是 **`PrincipalSchema.extend(...)`**，
 * 不是一个平行的 `z.object({...})`。这不是风格选择，是可机器验证的承诺：
 *  · `OrgPrincipalSchema.shape` 必然是 `PrincipalSchema.shape` 的超集；
 *  · `kind` 的值域直接来自 `PRINCIPAL_KINDS`，**不抄第二份**。
 * 两条都在 `apps/datacore/test/org-world.test.ts` 的「单源断言」里咬死 ——
 * 谁哪天把 `.extend()` 换成一个新造的 `z.object`，那条断言当场红。
 *
 * 造第二个身份真值源在本仓炸过多次（「两个 dev 各发明一套词表、交集为 0」）。
 * 这条红线就是那次事故的机器化形式。
 *
 * ══ ⚠️ 欠账 #139 的坑，与本文件的命名纪律 ══════════════════════════════════
 *
 * #139 的原文是「**角色词库只认 `propKey` 原文，挂中文 `displayName` 无效**」
 * （`apps/datacore/src/solvers/field-role-lexicon.ts` 的 `lexiconHit(name, role)`
 *  拿 `propKey`/`typeKey` **原文** 去 `test()`，从不看中文名）。
 *
 * 这个坑的**一般形态**是：**匹配面读的是机器键，人读的是中文名，两者错位。**
 * 在组织世界里它有一个更要命的具体形态 —— 需求原文写的是
 * 「销售经理 / 财务负责人 / 总经理 / 经营委员会」**四个中文名**，
 * 而 JWT claim `roles` 与 `X-Debug-User` 里流的是 `planner` / `base_manager:常州`
 * 这种**机器键**。若把审批额度挂在中文名上去跟 `roles` 匹配，**永远匹配不上**，
 * 而且是静默的 ——「谁都没权批」会被读成「这单确实没人能批」。
 *
 * 本文件的纪律（三条，都可机器验证）：
 *  1. **一切匹配只认 `orgKey` / `authorityKey` / `roleKey` 等机器键**（`^[a-z][a-z0-9_]*$`）。
 *     `name` 是中文显示名，**只用于给人看，任何判定路径都不读它**。
 *  2. 组织世界**不另造角色词表** —— `platformRoles` 显式映射到既有
 *     `BUILT_IN_ROLES`（`admin.ts`）+ 参数化角色（`base_manager:常州`）。
 *  3. **数值 propKey 必须避开 `ROLE_LEXICON` 的五个字段级词库**
 *     （capacity / demand / priority / revenue / cost）。这不是洁癖：
 *     `field-roles.ts:91/93/95/102` 拿 `numFields(t)` 的 `propKey` 去 `lexiconHit`，
 *     一个叫 `maxCapexValue` 的字段里那三个字母 `cap` 会让整个 `ApprovalLimit`
 *     被通用图求解器推断成「资源/产能类型」。故本文件刻意写作：
 *       · `maxInvestmentValue`（**不叫** `maxCapexValue` —— `cap` 撞 capacity 词库）
 *       · `maxCustomerImportance`（**不叫** `maxCustomerTier` —— `tier` 撞 priority 词库）
 *       · `escalationRank`（**不叫** `level` —— `level` 撞 priority 词库）
 *     这三条是 `org-world.test.ts` 的 `#139 守门` 用**真的 `lexiconHit`**（共用同一份实现，
 *     不抄正则）逐个 propKey 跑出来的，不是靠人记得。
 *
 * ══ R6 确定性 ═════════════════════════════════════════════════════════════
 * 本文件全是常量与 zod schema，**无时钟、无随机**。代理关系的生效窗口
 * (`activeFrom`/`activeTo`) 只在调用方**显式传 `asOf`** 时参与判定 ——
 * 绝不 `Date.now()`，否则「同 seed 重跑字节级一致」当场破。
 */
import { z } from "zod";
import { PRINCIPAL_KINDS, PrincipalSchema } from "./spine.js";

/** 机器键格式：小写 ASCII + 下划线。中文名一律进 `name`，不进任何匹配面（#139）。 */
export const ORG_KEY_RE = /^[a-z][a-z0-9_]*$/;
const orgKey = () => z.string().regex(ORG_KEY_RE, "机器键须匹配 ^[a-z][a-z0-9_]*$（中文名请放 name 字段）");

/**
 * 职权域：一条待批事项落在哪个域。刻意做成**闭集**，避免各处各写一个字符串。
 * 需求四条分别落在：订单(order) ×3、资本投入(investment) ×1。
 */
export const AUTHORITY_SCOPES = ["order", "investment", "pricing", "procurement", "production"] as const;
export type AuthorityScope = (typeof AUTHORITY_SCOPES)[number];

/** 客户重要度（序数，越大越重要）。`maxCustomerImportance` 表达「可批到哪一档」。 */
export const CUSTOMER_IMPORTANCE = ["normal", "key", "strategic"] as const;
export type CustomerImportance = (typeof CUSTOMER_IMPORTANCE)[number];
/** 序数化（判定用；确定性纯函数）。 */
export const importanceRank = (v: CustomerImportance): number => CUSTOMER_IMPORTANCE.indexOf(v);

// ══════════════════════════════════════════════════════════════════════════
// ① Principal 扩展 —— Person / Role / Department 三者共用一个类型
// ══════════════════════════════════════════════════════════════════════════

/**
 * 组织世界的责任主体 = **既有 `Principal` + 组织属性**。
 *
 * `kind` 三值的组织学读法（值域来自 `PRINCIPAL_KINDS`，未抄第二份）：
 *  · `org`    → **Department / 委员会**（部门、经营委员会）
 *  · `role`   → **Role**（销售经理、财务负责人、总经理…）
 *  · `person` → **Person**（具体的人）
 *
 * 继承来的 `parentRef` 继续表示**组织树父节点**（人/角色 → 所属部门；部门 → 上级部门），
 * 语义与既有 7 条种子（`prin-plan.parentRef = prin-coo`）**完全一致**，未被本单改写。
 */
export const OrgPrincipalSchema = PrincipalSchema.extend({
  /** 行 id（仓储层主键）；`principalId` 是业务键，两者在种子里同值以便对账。 */
  id: z.string(),
  tenantId: z.string(),
  /** 机器键 —— **唯一匹配面**（#139 纪律 1）。 */
  orgKey: orgKey(),
  /** 中文职务/部门显示名（display only，判定路径不读）。 */
  title: z.string().default(""),
  /** `kind="person"` 持有的角色 principalId 列表（→ `kind="role"` 的主体）。 */
  roleRefs: z.array(z.string()).default([]),
  /**
   * 映射到**既有**平台角色词表：`BUILT_IN_ROLES`（admin.ts）或参数化角色 `base_manager:常州`。
   * 组织世界**不另造**角色词表（#139 纪律 2）——这里是两套体系唯一的接缝。
   */
  platformRoles: z.array(z.string()).default([]),
  /** 是否在岗。**显式字段，不读时钟**（R6）；不在岗 → 触发代理链。 */
  available: z.boolean().default(true),
  /** 在办负荷（件）。用于同额度多人时的确定性排序（负荷小者优先）。 */
  workload: z.number().int().min(0).default(0),
});
export type OrgPrincipal = z.infer<typeof OrgPrincipalSchema>;

// ══════════════════════════════════════════════════════════════════════════
// ② Authority —— 某主体在某域上的职权（额度挂在它下面）
// ══════════════════════════════════════════════════════════════════════════

export const AuthoritySchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  /** 机器键（唯一匹配面）。 */
  authorityKey: orgKey(),
  /** → `OrgPrincipal.principalId`（通常指向 `kind="role"`，也可直接指向某个人）。 */
  principalRef: z.string(),
  scope: z.enum(AUTHORITY_SCOPES),
  /**
   * 升级阶梯序，**越大越高**（销售经理 10 < 总经理 30 < 经营委员会 40）。
   * ⚠️ 刻意**不叫 `level`** —— `level` 撞 `ROLE_LEXICON.priority` 词库（#139 纪律 3）。
   */
  escalationRank: z.number().int(),
  /** 中文显示名（display only）。 */
  name: z.string().default(""),
});
export type Authority = z.infer<typeof AuthoritySchema>;

// ══════════════════════════════════════════════════════════════════════════
// ③ ApprovalLimit —— 需求原文那四条的可执行形式
// ══════════════════════════════════════════════════════════════════════════

/**
 * 审批额度。**每个维度 `null` = 该维度不设限**（不是「上限为 0」——两者天差地别，
 * 混了会把「总经理不看利润率」读成「总经理只能批利润率 ≥ 0 的单」）。
 *
 * 需求原文 → 字段映射：
 * | 需求原文                          | 字段                                    |
 * |-----------------------------------|-----------------------------------------|
 * | 销售经理 → 可审批 ≤ 500万订单      | `maxOrderValue = 5_000_000`             |
 * | 财务负责人 → 可审批利润率 ≥ 5%     | `minMarginPct = 5`                      |
 * | 总经理 → 可审批重大客户订单        | `maxCustomerImportance = "strategic"`   |
 * | 经营委员会 → 跨基地 / 大额资本投入 | `allowCrossBase = true` + `maxInvestmentValue` |
 */
export const ApprovalLimitSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  limitKey: orgKey(),
  /** → `Authority.authorityKey`。 */
  authorityRef: orgKey(),
  /** 订单金额上限（元）；`null` = 金额维度不设限。 */
  maxOrderValue: z.number().nullable().default(null),
  /** 可批的**最低**利润率（%）：事项利润率 ≥ 本值才可批；`null` = 不看利润率。 */
  minMarginPct: z.number().nullable().default(null),
  /** 可批到的**最高**客户重要度；`null` = 不看客户重要度。 */
  maxCustomerImportance: z.enum(CUSTOMER_IMPORTANCE).nullable().default(null),
  /** 是否可批**跨基地**事项。默认 false —— 跨基地是刻意收紧的维度。 */
  allowCrossBase: z.boolean().default(false),
  /**
   * 资本投入上限（元）；`null` = **不可批**资本投入（注意与「不设限」相反的缺省，
   * 见下方 `evaluateLimit` 的注释：资本投入是白名单维度，其余是黑名单维度）。
   * ⚠️ 刻意**不叫 `maxCapexValue`** —— `cap` 撞 `ROLE_LEXICON.capacity` 词库（#139 纪律 3）。
   */
  maxInvestmentValue: z.number().nullable().default(null),
});
export type ApprovalLimit = z.infer<typeof ApprovalLimitSchema>;

// ══════════════════════════════════════════════════════════════════════════
// ④ Delegation —— 被代理人不可用时，权力落到谁身上
// ══════════════════════════════════════════════════════════════════════════

export const DelegationSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  delegationKey: orgKey(),
  /** 被代理人 → `OrgPrincipal.principalId`（`kind="person"`）。 */
  fromPrincipalRef: z.string(),
  /** 代理人 → `OrgPrincipal.principalId`（`kind="person"`）。 */
  toPrincipalRef: z.string(),
  /** 限定职权域；`null` = 全部域。 */
  scope: z.enum(AUTHORITY_SCOPES).nullable().default(null),
  /**
   * 生效窗口（`YYYY-MM-DD`，含边界）。**只在调用方显式传 `asOf` 时参与判定**（R6：不读时钟）。
   * 两端都为 `null` = 长期有效。
   */
  activeFrom: z.string().nullable().default(null),
  activeTo: z.string().nullable().default(null),
  reason: z.string().default(""),
});
export type Delegation = z.infer<typeof DelegationSchema>;

// ══════════════════════════════════════════════════════════════════════════
// ⑤ 查询面 —— 「给定一个待批事项，谁有权批」
// ══════════════════════════════════════════════════════════════════════════

/**
 * 待批事项。**本单只回答「谁有权」这一半** —— 批复链编排（顺序会签/或签/超时升级）
 * 属 `WO-APPROVAL-POLICY`，本文件刻意不碰。
 */
export const ApprovalMatterSchema = z.object({
  scope: z.enum(AUTHORITY_SCOPES).default("order"),
  /** 事项金额（元）。 */
  amount: z.number().default(0),
  /** 事项利润率（%）；`null` = 未知（未知时**不放行**任何设了 `minMarginPct` 的额度）。 */
  marginPct: z.number().nullable().default(null),
  /** 客户重要度；`null` = 普通（按 `normal` 处理）。 */
  customerImportance: z.enum(CUSTOMER_IMPORTANCE).nullable().default(null),
  /** 是否跨基地。 */
  crossBase: z.boolean().default(false),
  /** 是否属资本投入（大额资本支出）。 */
  capitalExpenditure: z.boolean().default(false),
  /** 判定基准日（`YYYY-MM-DD`）。**不传则不做窗口判定**（R6：绝不 `Date.now()`）。 */
  asOf: z.string().nullable().default(null),
});
export type ApprovalMatter = z.infer<typeof ApprovalMatterSchema>;

/** 候选人取得权力的方式。 */
export const APPROVER_VIA = ["direct", "delegated"] as const;

export const ApproverCandidateSchema = z.object({
  principalId: z.string(),
  orgKey: orgKey(),
  /** 中文姓名/名称（display only）。 */
  name: z.string(),
  title: z.string(),
  /** 该人持有的、命中本事项的职权。 */
  authorityKey: orgKey(),
  authorityName: z.string(),
  scope: z.enum(AUTHORITY_SCOPES),
  escalationRank: z.number().int(),
  via: z.enum(APPROVER_VIA),
  /** `via="delegated"` 时的被代理人 principalId；否则 `null`。 */
  delegatedFrom: z.string().nullable().default(null),
  available: z.boolean(),
  workload: z.number().int(),
  /** 平台角色映射（给下游做 authz 对账用，不是第二套角色表）。 */
  platformRoles: z.array(z.string()).default([]),
});
export type ApproverCandidate = z.infer<typeof ApproverCandidateSchema>;

/** 落选者 + 落选原因 —— 这才是「为什么这个流程现在卡住了」的答案。 */
export const ApproverBlockerSchema = z.object({
  authorityKey: orgKey(),
  authorityName: z.string(),
  principalId: z.string(),
  name: z.string(),
  escalationRank: z.number().int(),
  /** 人可读的落选原因（每条额度维度一句），确定性顺序。 */
  reasons: z.array(z.string()),
});
export type ApproverBlocker = z.infer<typeof ApproverBlockerSchema>;

export const ApproverResolutionSchema = z.object({
  matter: ApprovalMatterSchema,
  /** 有权批的人（确定性排序：escalationRank ↑ → workload ↑ → orgKey 字典序）。 */
  eligible: z.array(ApproverCandidateSchema),
  /** 无权批的职权 + 逐条原因。 */
  blockers: z.array(ApproverBlockerSchema),
  /** `eligible` 为空 = 流程卡住。 */
  stuck: z.boolean(),
  /** 卡住时的一句话诊断；不卡住时为 ""。 */
  diagnosis: z.string(),
});
export type ApproverResolution = z.infer<typeof ApproverResolutionSchema>;

// ══════════════════════════════════════════════════════════════════════════
// ⑥ 额度判定（纯函数，无 IO 无时钟 —— 引擎侧与前端可共用同一份口径）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 单条额度对单个事项的判定。返回**落选原因数组**，空数组 = 通过。
 *
 * 缺省语义（两类维度**方向相反**，刻意如此，注释写死免得后人猜）：
 *  · **黑名单维度**（金额/利润率/客户重要度）：`null` = 该维度**不设限** ⇒ 不产生落选原因。
 *  · **白名单维度**（跨基地/资本投入）：默认**不可批**，必须显式授予
 *    （`allowCrossBase = true` / `maxInvestmentValue ≠ null`）。
 *    理由：跨基地与资本投入是「越权」事故高发区，缺省收紧比缺省放开安全。
 */
export function evaluateLimit(limit: ApprovalLimit, matter: ApprovalMatter): string[] {
  const reasons: string[] = [];
  // ① 金额上限（黑名单维度）
  if (limit.maxOrderValue !== null && matter.amount > limit.maxOrderValue) {
    reasons.push(`金额 ${matter.amount} 超过可批上限 ${limit.maxOrderValue}`);
  }
  // ② 利润率下限（黑名单维度）；事项利润率未知时不放行——「不知道」不等于「达标」。
  if (limit.minMarginPct !== null) {
    if (matter.marginPct === null) reasons.push(`事项未提供利润率，无法满足利润率下限 ${limit.minMarginPct}%`);
    else if (matter.marginPct < limit.minMarginPct) {
      reasons.push(`利润率 ${matter.marginPct}% 低于可批下限 ${limit.minMarginPct}%`);
    }
  }
  // ③ 客户重要度上限（黑名单维度）
  if (limit.maxCustomerImportance !== null) {
    const want = importanceRank(matter.customerImportance ?? "normal");
    const cap = importanceRank(limit.maxCustomerImportance);
    if (want > cap) reasons.push(`客户重要度 ${matter.customerImportance} 高于可批上限 ${limit.maxCustomerImportance}`);
  }
  // ④ 跨基地（白名单维度）
  if (matter.crossBase && !limit.allowCrossBase) reasons.push("无跨基地审批权");
  // ⑤ 资本投入（白名单维度）
  if (matter.capitalExpenditure) {
    if (limit.maxInvestmentValue === null) reasons.push("无资本投入审批权");
    else if (matter.amount > limit.maxInvestmentValue) {
      reasons.push(`资本投入 ${matter.amount} 超过可批上限 ${limit.maxInvestmentValue}`);
    }
  }
  return reasons;
}

/**
 * 代理关系在基准日是否生效。`asOf = null` ⇒ **不做窗口判定**（视为生效），R6 不读时钟。
 * 字符串日期按 `YYYY-MM-DD` 字典序比较 —— 该格式下字典序 ≡ 时间序，无需 Date 解析。
 */
export function delegationActive(d: Delegation, scope: AuthorityScope, asOf: string | null): boolean {
  if (d.scope !== null && d.scope !== scope) return false;
  if (asOf === null) return true;
  if (d.activeFrom !== null && asOf < d.activeFrom) return false;
  if (d.activeTo !== null && asOf > d.activeTo) return false;
  return true;
}
