import {
  ApprovalLimitSchema,
  AuthoritySchema,
  DelegationSchema,
  OrgPrincipalSchema,
  delegationActive,
  evaluateLimit,
  type ApprovalLimit,
  type ApprovalMatter,
  type ApproverBlocker,
  type ApproverCandidate,
  type ApproverResolution,
  type Authority,
  type Delegation,
  type OrgPrincipal,
} from "@platform/contracts";

/**
 * WO-BEFE-D · 组织世界 mock 数据（`/a/v1/org/*` 的 mock 模式与前端测试共用）。
 *
 * ══ 两条纪律（都是本仓踩出来的）═════════════════════════════════════════════
 *
 * ① **判定逻辑不许在这里再写一遍。**
 *    `resolveApproversMock()` 直接调 `@platform/contracts` 的 `evaluateLimit()` /
 *    `delegationActive()` —— 与真后端 `apps/datacore/src/org/service.ts` **同一份实现**。
 *    自己抄一份 if-else 的后果是：后端改了缺省语义（如「白名单维度默认收紧」），
 *    mock 照旧放行，于是前端测试全绿而生产 403/空表 —— 这正是"哑门"的成因。
 *    装配部分（职权展开 / 代理一跳 / 三级排序 / 去重 / 诊断）是编排不是判定，
 *    contracts 里没有可复用的函数，故此处照 `service.ts` 的算法逐步复刻并注明行号。
 *
 * ② **数据照抄真种子**（`apps/datacore/src/org/seed.ts`），不另发明一套人名/职权。
 *    R1 禁止前端 import 后端源码，所以只能复制；复制就要**逐字对齐**，
 *    否则 mock 模式演示的是一个真实租户里不存在的组织（往"更好看"方向说谎）。
 *    对齐锚点：`prin-p-zhangming`(张明·销售经理·workload 7) /
 *    `auth_sales_order`(rank 10·≤500 万) / `dlg_sales_zhang_to_zhao`（张明→赵敏·order 域）。
 */

const TENANT = "demo";
const rowId = (prefix: string, key: string): string => `${prefix}_${TENANT}_${key}`;

/** 部门 / 委员会（复用 synthetic 既有 principalId：prin-coo/prin-plan/prin-supply/prin-fin）。 */
const DEPARTMENTS = [
  { orgKey: "dept_sales", principalId: "prin-sales", name: "销售部", parentRef: "prin-coo" },
  { orgKey: "exec_committee", principalId: "prin-exec", name: "经营委员会", parentRef: null },
  { orgKey: "dept_finance", principalId: "prin-fin", name: "财务部", parentRef: "prin-coo" },
  { orgKey: "dept_planning", principalId: "prin-plan", name: "计划部", parentRef: "prin-coo" },
];

const ROLES = [
  { orgKey: "role_sales_manager", principalId: "prin-role-sales-mgr", name: "销售经理", parentRef: "prin-sales", platformRoles: ["planner"] },
  { orgKey: "role_finance_head", principalId: "prin-role-fin-head", name: "财务负责人", parentRef: "prin-fin", platformRoles: ["approver"] },
  { orgKey: "role_general_manager", principalId: "prin-role-gm", name: "总经理", parentRef: "prin-coo", platformRoles: ["admin"] },
  { orgKey: "role_base_manager", principalId: "prin-role-base-mgr", name: "基地负责人", parentRef: "prin-plan", platformRoles: ["base_manager:常州"] },
];

const PERSONS = [
  { orgKey: "p_zhang_ming", principalId: "prin-p-zhangming", name: "张明", title: "销售经理", parentRef: "prin-sales", roleRefs: ["prin-role-sales-mgr"], platformRoles: ["planner"], workload: 7 },
  { orgKey: "p_zhao_min", principalId: "prin-p-zhaomin", name: "赵敏", title: "销售副经理", parentRef: "prin-sales", roleRefs: [], platformRoles: ["planner"], workload: 3 },
  { orgKey: "p_li_fang", principalId: "prin-p-lifang", name: "李芳", title: "财务负责人", parentRef: "prin-fin", roleRefs: ["prin-role-fin-head"], platformRoles: ["approver"], workload: 5 },
  { orgKey: "p_wang_qiang", principalId: "prin-p-wangqiang", name: "王强", title: "总经理", parentRef: "prin-coo", roleRefs: ["prin-role-gm"], platformRoles: ["admin"], workload: 2 },
  { orgKey: "p_chen_li", principalId: "prin-p-chenli", name: "陈立", title: "常州基地负责人", parentRef: "prin-plan", roleRefs: ["prin-role-base-mgr"], platformRoles: ["base_manager:常州"], workload: 9 },
  { orgKey: "p_sun_wei", principalId: "prin-p-sunwei", name: "孙伟", title: "经营委员会主任委员", parentRef: "prin-exec", roleRefs: [], platformRoles: ["admin"], workload: 4 },
];

export const ORG_AUTHORITIES: Authority[] = (
  [
    { authorityKey: "auth_sales_order", principalRef: "prin-role-sales-mgr", scope: "order", escalationRank: 10, name: "销售经理·订单审批权" },
    { authorityKey: "auth_finance_order", principalRef: "prin-role-fin-head", scope: "order", escalationRank: 20, name: "财务负责人·订单审批权" },
    { authorityKey: "auth_gm_order", principalRef: "prin-role-gm", scope: "order", escalationRank: 30, name: "总经理·订单审批权" },
    { authorityKey: "auth_exec_order", principalRef: "prin-exec", scope: "order", escalationRank: 40, name: "经营委员会·订单审批权" },
    { authorityKey: "auth_exec_investment", principalRef: "prin-exec", scope: "investment", escalationRank: 40, name: "经营委员会·资本投入审批权" },
    { authorityKey: "auth_gm_investment", principalRef: "prin-role-gm", scope: "investment", escalationRank: 30, name: "总经理·资本投入审批权" },
  ] as const
).map((a) => AuthoritySchema.parse({ ...a, id: rowId("orga", a.authorityKey), tenantId: TENANT }));

export const ORG_LIMITS: ApprovalLimit[] = (
  [
    { limitKey: "lim_sales_order", authorityRef: "auth_sales_order", maxOrderValue: 5_000_000 },
    { limitKey: "lim_finance_order", authorityRef: "auth_finance_order", maxOrderValue: 20_000_000, minMarginPct: 5 },
    { limitKey: "lim_gm_order", authorityRef: "auth_gm_order", maxOrderValue: 50_000_000, maxCustomerImportance: "strategic" },
    { limitKey: "lim_gm_investment", authorityRef: "auth_gm_investment", maxInvestmentValue: 10_000_000 },
    { limitKey: "lim_exec_order", authorityRef: "auth_exec_order", allowCrossBase: true, maxCustomerImportance: "strategic" },
    { limitKey: "lim_exec_investment", authorityRef: "auth_exec_investment", allowCrossBase: true, maxInvestmentValue: 1_000_000_000 },
  ] as const
).map((l) => ApprovalLimitSchema.parse({ ...l, id: rowId("orgl", l.limitKey), tenantId: TENANT }));

export const ORG_DELEGATIONS: Delegation[] = (
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
).map((d) => DelegationSchema.parse({ ...d, id: rowId("orgd", d.delegationKey), tenantId: TENANT }));

function buildPrincipals(): OrgPrincipal[] {
  const mk = (raw: Record<string, unknown>): OrgPrincipal =>
    OrgPrincipalSchema.parse({ ...raw, id: rowId("orgp", raw.orgKey as string), tenantId: TENANT });
  return [
    ...DEPARTMENTS.map((d) => mk({ ...d, kind: "org", title: d.name })),
    ...ROLES.map((r) => mk({ ...r, kind: "role", title: r.name })),
    ...PERSONS.map((p) => mk({ ...p, kind: "person" })),
  ];
}

/**
 * mock 的可变状态 —— `available` 由 `PATCH …/availability` 真改，
 * 于是「置为不在岗 → 重新解析 → 代理人顶上」这条链在 mock 模式下**真的会跑**，
 * 而不是永远停在种子的 `available: true`（那就是本仓「接了线没数据」的原样复现）。
 */
export const orgState: { principals: OrgPrincipal[] } = { principals: buildPrincipals() };

export function resetOrgState(): void {
  orgState.principals = buildPrincipals();
}

const byOrgKey = (a: { orgKey: string }, b: { orgKey: string }): number => a.orgKey.localeCompare(b.orgKey);

export function orgChartMock(): { departments: OrgPrincipal[]; roles: OrgPrincipal[]; persons: OrgPrincipal[] } {
  const by = (kind: OrgPrincipal["kind"]): OrgPrincipal[] =>
    orgState.principals.filter((p) => p.kind === kind).slice().sort(byOrgKey);
  return { departments: by("org"), roles: by("role"), persons: by("person") };
}

/** 职权持有者 → 具体的人（service.ts:216 `expandToPersons` 同款三分支）。 */
function expandToPersons(holder: OrgPrincipal, all: OrgPrincipal[]): OrgPrincipal[] {
  const persons = all.filter((p) => p.kind === "person");
  const picked =
    holder.kind === "person"
      ? [holder]
      : holder.kind === "role"
        ? persons.filter((p) => p.roleRefs.includes(holder.principalId))
        : persons.filter((p) => p.parentRef === holder.principalId);
  return picked.slice().sort(byOrgKey);
}

function candidate(
  person: OrgPrincipal,
  auth: Authority,
  via: "direct" | "delegated",
  delegatedFrom: string | null,
): ApproverCandidate {
  return {
    principalId: person.principalId,
    orgKey: person.orgKey,
    name: person.name,
    title: person.title,
    authorityKey: auth.authorityKey,
    authorityName: auth.name,
    scope: auth.scope,
    escalationRank: auth.escalationRank,
    via,
    delegatedFrom,
    available: person.available,
    workload: person.workload,
    platformRoles: person.platformRoles,
  };
}

/**
 * 「谁能批这一单」—— 与 `apps/datacore/src/org/service.ts:113 resolveApprovers()` 逐步对齐。
 * ⚠ 判定那两步（额度 / 代理窗口）走 contracts 的纯函数，**不在这里重写**（见文件顶注纪律①）。
 */
export function resolveApproversMock(matter: ApprovalMatter): ApproverResolution {
  const principals = orgState.principals;
  const byId = new Map(principals.map((p) => [p.principalId, p]));
  const inScope = ORG_AUTHORITIES.filter((a) => a.scope === matter.scope).sort(
    (a, b) => a.escalationRank - b.escalationRank || a.authorityKey.localeCompare(b.authorityKey),
  );

  const eligible: ApproverCandidate[] = [];
  const blockers: ApproverBlocker[] = [];

  for (const auth of inScope) {
    const holder = byId.get(auth.principalRef);
    if (!holder) {
      blockers.push({
        authorityKey: auth.authorityKey,
        authorityName: auth.name,
        principalId: auth.principalRef,
        name: "",
        escalationRank: auth.escalationRank,
        reasons: [`职权指向的主体 ${auth.principalRef} 不存在（组织数据断链）`],
      });
      continue;
    }
    const mine = ORG_LIMITS.filter((l) => l.authorityRef === auth.authorityKey).sort((a, b) =>
      a.limitKey.localeCompare(b.limitKey),
    );
    // 零额度 = 未授权（缺省收紧）；有额度则 AND 语义（全部通过才算通过）。
    const reasons = mine.length === 0 ? ["该职权未配置任何审批额度（未授权）"] : mine.flatMap((l) => evaluateLimit(l, matter));

    if (reasons.length > 0) {
      const persons = expandToPersons(holder, principals);
      for (const p of persons.length > 0 ? persons : [holder]) {
        blockers.push({
          authorityKey: auth.authorityKey,
          authorityName: auth.name,
          principalId: p.principalId,
          name: p.name,
          escalationRank: auth.escalationRank,
          reasons,
        });
      }
      continue;
    }

    for (const person of expandToPersons(holder, principals)) {
      if (person.available) {
        eligible.push(candidate(person, auth, "direct", null));
        continue;
      }
      const cands = ORG_DELEGATIONS.filter(
        (d) => d.fromPrincipalRef === person.principalId && delegationActive(d, matter.scope, matter.asOf),
      ).sort((a, b) => a.delegationKey.localeCompare(b.delegationKey));
      const deputy = cands.map((d) => byId.get(d.toPrincipalRef)).find((p) => p && p.available) ?? null;
      if (deputy) eligible.push(candidate(deputy, auth, "delegated", person.principalId));
      else {
        blockers.push({
          authorityKey: auth.authorityKey,
          authorityName: auth.name,
          principalId: person.principalId,
          name: person.name,
          escalationRank: auth.escalationRank,
          reasons: ["该审批人当前不在岗，且无可用代理人"],
        });
      }
    }
  }

  const seen = new Set<string>();
  const sorted = eligible
    .sort((a, b) => a.escalationRank - b.escalationRank || a.workload - b.workload || a.orgKey.localeCompare(b.orgKey))
    .filter((c) => (seen.has(c.principalId) ? false : (seen.add(c.principalId), true)));

  const diagnose = (): string => {
    if (blockers.length === 0) return "本域没有配置任何职权，无人可批";
    const top = blockers.reduce((m, b) => (b.escalationRank > m.escalationRank ? b : m), blockers[0]!);
    return `无人有权审批：最高职权「${top.authorityName || top.authorityKey}」亦被挡 —— ${top.reasons[0] ?? "原因未知"}`;
  };

  return {
    matter,
    eligible: sorted,
    blockers: blockers.sort(
      (a, b) =>
        a.escalationRank - b.escalationRank ||
        a.authorityKey.localeCompare(b.authorityKey) ||
        a.principalId.localeCompare(b.principalId),
    ),
    stuck: sorted.length === 0,
    diagnosis: sorted.length === 0 ? diagnose() : "",
  };
}
