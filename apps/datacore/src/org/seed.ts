import {
  ApprovalLimitSchema,
  AuthoritySchema,
  DelegationSchema,
  OrgPrincipalSchema,
  type ApprovalLimit,
  type Authority,
  type Delegation,
  type OrgPrincipal,
} from "@platform/contracts";
import type { Repos } from "../repo/repo.js";

/**
 * WO-ORG-WORLD · demo 租户组织世界种子。
 *
 * ══ R6 确定性（本仓铁律）════════════════════════════════════════════════════
 * 全是字面量常量：**无 `Date.now()`、无 `Math.random()`、无自增计数器**。
 * id 由 `orgKey` 直接派生（`orgp_<tenant>_<orgKey>`），故同 (tenant) 重跑字节级一致 ——
 * 不需要 seed 参数，因为压根没有随机源可播。
 *
 * ══ 与既有 7 条 synthetic `Principal` 的关系（不造重复实体）══════════════════
 * `battery.ts:4006` 已有 7 条责任主体：`prin-coo`（运营负责人·role）、
 * `prin-plan`/`prin-supply`/`prin-fin`（计划部/供应链部/财务部·org）+ 三条业务线。
 * 本种子**复用其中的部门 principalId**（`prin-fin` 就是财务部，不另造 `dept_finance`），
 * 只新增它没有的东西：**人**、**角色**、**职权**、**额度**、**代理**。
 * 这条复用关系由 `org-world.test.ts` 的「不造重复实体」断言把守（带金丝雀）。
 *
 * ══ ⚠️ #139 纪律 ═══════════════════════════════════════════════════════════
 * 需求原文的四个中文名（销售经理/财务负责人/总经理/经营委员会）一律只进 `name`；
 * 一切匹配面走 `orgKey`/`authorityKey` 机器键。`platformRoles` 显式映射到**既有**
 * `BUILT_IN_ROLES` + 参数化角色，组织世界不另造第三套角色词表。
 */

/** 既有 synthetic Principal 的部门 id（复用，不另造）。改动前先看 `battery.ts:4006`。 */
export const REUSED_SYNTHETIC_DEPT_IDS = {
  ops: "prin-coo", // 运营负责人（role）—— 组织树根
  planning: "prin-plan", // 计划部
  supply: "prin-supply", // 供应链部
  finance: "prin-fin", // 财务部
} as const;

/** 本单新增的部门/委员会（synthetic 里没有的）。 */
const DEPARTMENTS: { orgKey: string; principalId: string; name: string; parentRef: string | null }[] = [
  { orgKey: "dept_sales", principalId: "prin-sales", name: "销售部", parentRef: REUSED_SYNTHETIC_DEPT_IDS.ops },
  // 经营委员会：跨基地/大额资本投入的最高决策体。建模成 kind="org"（合议体，非单人角色），
  // 职权展开时按「直属的人」展开 ⇒ 委员会成员即其直属 person。
  { orgKey: "exec_committee", principalId: "prin-exec", name: "经营委员会", parentRef: null },
];

/** 角色（`kind="role"`）—— 需求原文那四个中文名落在这里的 `name` 上，匹配走 `orgKey`。 */
const ROLES: { orgKey: string; principalId: string; name: string; parentRef: string; platformRoles: string[] }[] = [
  {
    orgKey: "role_sales_manager",
    principalId: "prin-role-sales-mgr",
    name: "销售经理",
    parentRef: "prin-sales",
    platformRoles: ["planner"],
  },
  {
    orgKey: "role_finance_head",
    principalId: "prin-role-fin-head",
    name: "财务负责人",
    parentRef: REUSED_SYNTHETIC_DEPT_IDS.finance,
    platformRoles: ["approver"],
  },
  {
    orgKey: "role_general_manager",
    principalId: "prin-role-gm",
    name: "总经理",
    parentRef: REUSED_SYNTHETIC_DEPT_IDS.ops,
    platformRoles: ["admin"],
  },
  {
    orgKey: "role_base_manager",
    principalId: "prin-role-base-mgr",
    name: "基地负责人",
    parentRef: REUSED_SYNTHETIC_DEPT_IDS.planning,
    // 参数化角色（`base_manager:常州`）—— 与 demo 账号 base_manager 的 roles 逐字一致。
    platformRoles: ["base_manager:常州"],
  },
];

/**
 * 人（`kind="person"`）。
 * `available` 是**显式字段**（R6 不读时钟）：本种子里全部在岗；
 * 「代理生效」的判据由测试显式把某人置为不在岗后驱动 —— 种子里预置一条常备代理关系。
 */
const PERSONS: {
  orgKey: string;
  principalId: string;
  name: string;
  title: string;
  parentRef: string;
  roleRefs: string[];
  platformRoles: string[];
  workload: number;
}[] = [
  {
    orgKey: "p_zhang_ming",
    principalId: "prin-p-zhangming",
    name: "张明",
    title: "销售经理",
    parentRef: "prin-sales",
    roleRefs: ["prin-role-sales-mgr"],
    platformRoles: ["planner"],
    workload: 7,
  },
  {
    orgKey: "p_zhao_min",
    principalId: "prin-p-zhaomin",
    name: "赵敏",
    title: "销售副经理",
    parentRef: "prin-sales",
    roleRefs: [], // 不直接持销售经理角色 —— 只在张明不在岗时经代理顶上
    platformRoles: ["planner"],
    workload: 3,
  },
  {
    orgKey: "p_li_fang",
    principalId: "prin-p-lifang",
    name: "李芳",
    title: "财务负责人",
    parentRef: REUSED_SYNTHETIC_DEPT_IDS.finance,
    roleRefs: ["prin-role-fin-head"],
    platformRoles: ["approver"],
    workload: 5,
  },
  {
    orgKey: "p_wang_qiang",
    principalId: "prin-p-wangqiang",
    name: "王强",
    title: "总经理",
    parentRef: REUSED_SYNTHETIC_DEPT_IDS.ops,
    roleRefs: ["prin-role-gm"],
    platformRoles: ["admin"],
    workload: 2,
  },
  {
    orgKey: "p_chen_li",
    principalId: "prin-p-chenli",
    name: "陈立",
    title: "常州基地负责人",
    parentRef: REUSED_SYNTHETIC_DEPT_IDS.planning,
    roleRefs: ["prin-role-base-mgr"],
    platformRoles: ["base_manager:常州"],
    workload: 9,
  },
  // 经营委员会成员（parentRef → prin-exec ⇒ 委员会职权按「直属的人」展开）。
  {
    orgKey: "p_sun_wei",
    principalId: "prin-p-sunwei",
    name: "孙伟",
    title: "经营委员会主任委员",
    parentRef: "prin-exec",
    roleRefs: [],
    platformRoles: ["admin"],
    workload: 4,
  },
];

/**
 * 职权 + 额度 —— **需求原文那四条的可执行形式**。
 *
 * | 需求原文                          | authorityKey        | 额度                                            |
 * |-----------------------------------|---------------------|-------------------------------------------------|
 * | 销售经理 → 可审批 ≤ 500万订单      | `auth_sales_order`  | `maxOrderValue = 5_000_000`                     |
 * | 财务负责人 → 可审批利润率 ≥ 5%     | `auth_finance_order`| `minMarginPct = 5`                              |
 * | 总经理 → 可审批重大客户订单        | `auth_gm_order`     | `maxCustomerImportance = "strategic"` + 5000万上限 |
 * | 经营委员会 → 跨基地 / 大额资本投入 | `auth_exec_order` / `auth_exec_investment` | `allowCrossBase` / `maxInvestmentValue` |
 *
 * `escalationRank` 越大越高（10 销售 < 20 财务 < 30 总经理 < 40 经营委员会）——
 * 「上浮到总经理」这件事就是靠它排序的，故它必须是**数值**而非中文职级名。
 */
const AUTHORITIES: Authority[] = (
  [
    { authorityKey: "auth_sales_order", principalRef: "prin-role-sales-mgr", scope: "order", escalationRank: 10, name: "销售经理·订单审批权" },
    { authorityKey: "auth_finance_order", principalRef: "prin-role-fin-head", scope: "order", escalationRank: 20, name: "财务负责人·订单审批权" },
    { authorityKey: "auth_gm_order", principalRef: "prin-role-gm", scope: "order", escalationRank: 30, name: "总经理·订单审批权" },
    { authorityKey: "auth_exec_order", principalRef: "prin-exec", scope: "order", escalationRank: 40, name: "经营委员会·订单审批权" },
    { authorityKey: "auth_exec_investment", principalRef: "prin-exec", scope: "investment", escalationRank: 40, name: "经营委员会·资本投入审批权" },
    { authorityKey: "auth_gm_investment", principalRef: "prin-role-gm", scope: "investment", escalationRank: 30, name: "总经理·资本投入审批权" },
  ] as const
).map((a) => AuthoritySchema.parse({ ...a, id: "", tenantId: "" }));

const LIMITS: ApprovalLimit[] = (
  [
    // 销售经理：≤ 500 万订单。不跨基地、不批资本投入（白名单维度缺省收紧）。
    { limitKey: "lim_sales_order", authorityRef: "auth_sales_order", maxOrderValue: 5_000_000 },
    // 财务负责人：利润率 ≥ 5% 才可批；金额上限 2000 万。
    { limitKey: "lim_finance_order", authorityRef: "auth_finance_order", maxOrderValue: 20_000_000, minMarginPct: 5 },
    // 总经理：可批到重大（strategic）客户订单，金额上限 5000 万。
    {
      limitKey: "lim_gm_order",
      authorityRef: "auth_gm_order",
      maxOrderValue: 50_000_000,
      maxCustomerImportance: "strategic",
    },
    // 总经理资本投入权：≤ 1000 万（大额要上经营委员会）。
    { limitKey: "lim_gm_investment", authorityRef: "auth_gm_investment", maxInvestmentValue: 10_000_000 },
    // 经营委员会：跨基地订单（金额不设限 = maxOrderValue null）。
    { limitKey: "lim_exec_order", authorityRef: "auth_exec_order", allowCrossBase: true, maxCustomerImportance: "strategic" },
    // 经营委员会：大额资本投入 ≤ 10 亿，且可跨基地。
    {
      limitKey: "lim_exec_investment",
      authorityRef: "auth_exec_investment",
      allowCrossBase: true,
      maxInvestmentValue: 1_000_000_000,
    },
  ] as const
).map((l) => ApprovalLimitSchema.parse({ ...l, id: "", tenantId: "" }));

/**
 * 代理关系：张明（销售经理）不在岗时 → 赵敏（销售副经理）代批订单。
 * `activeFrom`/`activeTo` 给了显式窗口 —— 但**只在调用方传 `asOf` 时**参与判定（R6）。
 */
const DELEGATIONS: Delegation[] = (
  [
    {
      delegationKey: "dlg_sales_zhang_to_zhao",
      fromPrincipalRef: "prin-p-zhangming",
      toPrincipalRef: "prin-p-zhaomin",
      scope: "order",
      activeFrom: "2026-01-01",
      activeTo: "2026-12-31",
      reason: "销售经理外出期间订单审批代理",
    },
  ] as const
).map((d) => DelegationSchema.parse({ ...d, id: "", tenantId: "" }));

/** id 派生：确定性、可读、与 orgKey 一一对应（无计数器、无时钟）。 */
const rowId = (prefix: string, tenantId: string, key: string): string => `${prefix}_${tenantId}_${key}`;

/** 组装本租户的全部组织主体（部门 + 角色 + 人）。纯函数，供种子与测试共用同一份口径。 */
export function buildOrgPrincipals(tenantId: string): OrgPrincipal[] {
  const mk = (raw: Record<string, unknown>): OrgPrincipal =>
    OrgPrincipalSchema.parse({ ...raw, id: rowId("orgp", tenantId, raw.orgKey as string), tenantId });
  return [
    ...DEPARTMENTS.map((d) => mk({ ...d, kind: "org", title: d.name })),
    ...ROLES.map((r) => mk({ ...r, kind: "role", title: r.name })),
    ...PERSONS.map((p) => mk({ ...p, kind: "person" })),
  ];
}

export function buildAuthorities(tenantId: string): Authority[] {
  return AUTHORITIES.map((a) => ({ ...a, id: rowId("orga", tenantId, a.authorityKey), tenantId }));
}

export function buildApprovalLimits(tenantId: string): ApprovalLimit[] {
  return LIMITS.map((l) => ({ ...l, id: rowId("orgl", tenantId, l.limitKey), tenantId }));
}

export function buildDelegations(tenantId: string): Delegation[] {
  return DELEGATIONS.map((d) => ({ ...d, id: rowId("orgd", tenantId, d.delegationKey), tenantId }));
}

/**
 * 播种 demo 租户组织世界。
 *
 * **不放进基座 `seedDemo`**（与 `seedDemoProcessLayer` 同一条理由）：单测 `makeApp()` 需要
 * 「干净 demo」基线，组织世界是行业/租户的配置内容，不该出现在每个不相干的单测里。
 * 由 `SEED_DEMO=1` 启动路径（`server.ts` / `seed-cli.ts`）调用。
 */
export async function seedOrgWorld(repos: Repos, tenantId: string): Promise<void> {
  await repos.orgPrincipals.putMany(buildOrgPrincipals(tenantId));
  await repos.orgAuthorities.putMany(buildAuthorities(tenantId));
  await repos.orgApprovalLimits.putMany(buildApprovalLimits(tenantId));
  await repos.orgDelegations.putMany(buildDelegations(tenantId));
}
