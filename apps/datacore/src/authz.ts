import type { PermissionPolicy } from "@platform/contracts";
import type { AuthCtx } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import { evaluateExpression, parseExpression } from "./ruledsl.js";
import { forbidden, propertyForbidden } from "./errors.js";

export type ResourceKind = "OBJECT_TYPE" | "CONNECTION" | "RULE_SET" | "ACTION_TYPE";
export type Op = "READ" | "WRITE" | "EXECUTE";

/**
 * 一条**已授权策略**贡献的列级（属性级）规则。空规则（策略未配 propertyPolicy）= 该策略放行全部属性。
 * 保留"逐策略"粒度而非提前压平成集合，是为了让多策略/多角色的并集语义**精确**（见 propAllowed）。
 */
export interface ColumnRule {
  readable?: string[];
  denyRead?: string[];
  writable?: string[];
  denyWrite?: string[];
}

export interface AccessDecision {
  allowed: boolean;
  matchedPolicies: PermissionPolicy[];
  /** rowFilter expressions to AND together (data-layer enforcement). */
  rowFilters: string[];
  /**
   * A6 列级（属性级）安全 —— 逐条已授权策略的列规则。**唯一出处**：所有读/写路径都从
   * `decide()` 拿这一份，不许各路径自己再实现一套（本仓复发病根 = 两半用不同机制不对接）。
   * 空数组 = 无任何列级约束（admin 旁路 / 无策略 default-allow / 策略未配 propertyPolicy）。
   */
  columnRules: ColumnRule[];
  /** 快门：false 时所有列级投影/校验都是**零成本恒等**（逐字节保持现行为）。 */
  columnRestricted: boolean;
  reason: string;
}

/** 无列级约束的决策片段（admin 旁路 / default-allow 都复用它 → S4 向后兼容由构造保证）。 */
const UNRESTRICTED = { columnRules: [] as ColumnRule[], columnRestricted: false };

function toColumnRule(p: PermissionPolicy): ColumnRule {
  const pp = p.propertyPolicy;
  if (!pp) return {};
  return {
    ...(pp.readable ? { readable: pp.readable } : {}),
    ...(pp.denyRead ? { denyRead: pp.denyRead } : {}),
    ...(pp.writable ? { writable: pp.writable } : {}),
    ...(pp.denyWrite ? { denyWrite: pp.denyWrite } : {}),
  };
}

function ruleHasColumnConstraint(r: ColumnRule): boolean {
  return !!(r.readable || r.denyRead || r.writable || r.denyWrite);
}

/** Roles may be qualified like "base_manager:常州"; policies may grant on the base role. */
function roleMatches(grantRole: string, userRoles: string[]): boolean {
  return userRoles.some((r) => r === grantRole || r.split(":")[0] === grantRole || grantRole === "*");
}

/**
 * A6 permission evaluation (PRD §6.2). Layer 1 (tenant) is enforced by the
 * repositories; this service computes layers 2 (resource grants) and 3 (row
 * filters) which the object query executor applies BEFORE returning data.
 */
export class AuthzService {
  constructor(private repos: Repos) {}

  async decide(ctx: AuthCtx, kind: ResourceKind, key: string, op: Op): Promise<AccessDecision> {
    // 管理平台增量 §1：platform_admin 是平台运维角色（管别人房子不看别人抽屉）——
    // 不出现在任何租户的业务数据策略中，业务数据访问一律拒绝（含 default-allow 路径）。
    if (ctx.roles.some((r) => r.split(":")[0] === "platform_admin")) {
      return {
        allowed: false,
        matchedPolicies: [],
        rowFilters: [],
        ...UNRESTRICTED,
        reason: "platform_admin 不在任何租户的业务数据策略中（平台运维角色，禁止读业务对象）",
      };
    }
    // 租户管理员（admin）= 本租户超级用户：对本租户业务资源（对象/规则/动作）全量访问，不受逐策略授权与
    // 行级过滤约束（仍守 R2）。修：此前 admin 仅在被显式 grant 的资源上可读，凡有限制性策略而未授 admin 的
    // 资源即"权限不足"——与"admin 拥有全部模块访问权"相悖。真值写入安全仍由 R4（Action 审批）独立保证。
    // 例外 CONNECTION：数据源/知识库连接器可对 admin 单独设限（敏感来源隔离，刻意保留的边界，见 kb V11）。
    if (kind !== "CONNECTION" && ctx.roles.some((r) => r.split(":")[0] === "admin")) {
      // 列级安全刻意不收窄本旁路：admin 仍看/改全部属性（S4 向后兼容硬要求）。
      return { allowed: true, matchedPolicies: [], rowFilters: [], ...UNRESTRICTED, reason: "tenant admin: full access within tenant" };
    }
    const policies = await this.repos.policies.list(
      ctx.tenantId,
      (p) => p.resource.kind === kind && (p.resource.key === key || p.resource.key === "*"),
    );
    if (policies.length === 0) {
      // No policy attached to the resource: tenant isolation still applies; default allow.
      // 列级安全同样默认全开（无策略 = 全部属性可读可写·S4 向后兼容硬要求）。
      return { allowed: true, matchedPolicies: [], rowFilters: [], ...UNRESTRICTED, reason: "no policy attached; default allow" };
    }
    const matched: PermissionPolicy[] = [];
    const rowFilters: string[] = [];
    const columnRules: ColumnRule[] = [];
    let granted = false;
    for (const policy of policies) {
      const grant = policy.grants.find((g) => roleMatches(g.role, ctx.roles) && g.ops.includes(op));
      if (!grant) continue;
      matched.push(policy);
      granted = true;
      if (policy.rowFilter) rowFilters.push(policy.rowFilter);
      columnRules.push(toColumnRule(policy));
    }
    if (!granted) {
      return {
        allowed: false,
        matchedPolicies: [],
        rowFilters: [],
        ...UNRESTRICTED,
        reason: `no grant gives ${op} on ${kind}:${key} for roles [${ctx.roles.join(", ")}]`,
      };
    }
    return {
      allowed: true,
      matchedPolicies: matched,
      rowFilters,
      columnRules,
      columnRestricted: columnRules.some(ruleHasColumnConstraint),
      reason: `granted by ${matched.map((p) => p.id).join(", ")}`,
    };
  }

  /** Throws 403 when not allowed; returns the row filters otherwise. */
  async require(ctx: AuthCtx, kind: ResourceKind, key: string, op: Op): Promise<string[]> {
    const d = await this.decide(ctx, kind, key, op);
    if (!d.allowed) throw forbidden(d.reason);
    return d.rowFilters;
  }

  /**
   * 与 `require` 同门禁，但返回**完整决策**（含列级规则）。列级安全的所有调用方走这一个入口 ——
   * 一个机制，不是每条路径各自再实现一遍。
   */
  async requireDecision(ctx: AuthCtx, kind: ResourceKind, key: string, op: Op): Promise<AccessDecision> {
    const d = await this.decide(ctx, kind, key, op);
    if (!d.allowed) throw forbidden(d.reason);
    return d;
  }

  // -- A6 列级（属性级）安全：唯一判定 + 唯一投影 ------------------------------------
  //
  // **多策略/多角色解析语义 = 最宽松者胜（并集）**：一个属性只要被**任意一条已授权策略**放行即放行。
  // 依据：多条策略/多个角色是"叠加授权"而非"叠加限制"——用户同时是 planner 与 finance 时，应当拿到
  // 两者可见字段的并集；否则加一个角色反而会让人看得更少（与 grants 的并集语义自相矛盾）。
  // 未配 propertyPolicy 的策略放行全部属性，故它与任何限制性策略并存时即"解除"该限制（与 grants 一致）。

  private static ruleAllows(r: ColumnRule, prop: string, op: "READ" | "WRITE"): boolean {
    const allow = op === "READ" ? r.readable : r.writable;
    const deny = op === "READ" ? r.denyRead : r.denyWrite;
    if (allow) return allow.includes(prop); // 白名单：只有列出的放行
    if (deny) return !deny.includes(prop); // 黑名单：列出的拦掉
    return true; // 该策略无列级约束 → 放行
  }

  /** 属性是否可读（并集语义）。 */
  propReadable(d: AccessDecision, prop: string): boolean {
    if (!d.columnRestricted) return true;
    return d.columnRules.some((r) => AuthzService.ruleAllows(r, prop, "READ"));
  }

  /** 属性是否可写（并集语义）。 */
  propWritable(d: AccessDecision, prop: string): boolean {
    if (!d.columnRestricted) return true;
    return d.columnRules.some((r) => AuthzService.ruleAllows(r, prop, "WRITE"));
  }

  /**
   * 读投影：**剔除而非置空** —— 不可读属性是被 `delete` 掉的键，绝不置 `null`
   * （`null` 在下游读作"业务值为空"= 凭空造数据，比泄露更坏）。
   * 无列级约束时返回**原对象引用**（零拷贝·逐字节现行为·S4）。
   */
  projectProps<T extends Record<string, unknown>>(d: AccessDecision, props: T): T {
    if (!d.columnRestricted) return props;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(props)) {
      if (this.propReadable(d, k)) out[k] = props[k];
    }
    return out as T;
  }

  /** 对象级读投影（保留 id/type 等外壳，只投影 props）。 */
  projectObject<T extends { props: Record<string, unknown> }>(d: AccessDecision, o: T): T {
    if (!d.columnRestricted) return o;
    return { ...o, props: this.projectProps(d, o.props) };
  }

  /** 写校验：命中不可写属性即抛 403 `PROPERTY_FORBIDDEN`（拒绝而非静默丢弃 —— 值绝不落库）。 */
  assertPropsWritable(d: AccessDecision, props: Record<string, unknown>, detail = ""): void {
    if (!d.columnRestricted) return;
    const bad = Object.keys(props).filter((k) => !this.propWritable(d, k));
    if (bad.length > 0) throw propertyForbidden(bad.sort(), detail);
  }

  /** Apply all rowFilters (AND-merged) to an object's props. */
  rowAllowed(ctx: AuthCtx, rowFilters: string[], props: Record<string, unknown>): boolean {
    for (const filter of rowFilters) {
      try {
        const ok = evaluateExpression(filter, {
          payload: { ...props, Object: props },
          user: { userId: ctx.userId, roles: ctx.roles, attributes: ctx.attributes },
        });
        if (!ok) return false;
      } catch {
        // Unevaluable filter fails closed.
        return false;
      }
    }
    return true;
  }

  /** Debug endpoint payload (POST /a/v1/authz/explain). */
  async explain(
    ctx: AuthCtx,
    kind: ResourceKind,
    key: string,
    op: Op,
  ): Promise<{
    allowed: boolean;
    matchedPolicies: PermissionPolicy[];
    effectiveRowFilter: string | null;
    rowFilterValid: boolean;
    columnRestricted: boolean;
    columnRules: ColumnRule[];
    reason: string;
  }> {
    const d = await this.decide(ctx, kind, key, op);
    const effective = d.rowFilters.length > 0 ? d.rowFilters.map((f) => `(${f})`).join(" AND ") : null;
    let valid = true;
    if (effective) {
      try {
        for (const f of d.rowFilters) parseExpression(f);
      } catch {
        valid = false;
      }
    }
    return {
      allowed: d.allowed,
      matchedPolicies: d.matchedPolicies,
      effectiveRowFilter: effective,
      rowFilterValid: valid,
      columnRestricted: d.columnRestricted,
      columnRules: d.columnRules,
      reason: d.reason,
    };
  }
}
