import type { PermissionPolicy } from "@platform/contracts";
import type { AuthCtx } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import { evaluateExpression, parseExpression } from "./ruledsl.js";
import { forbidden } from "./errors.js";

export type ResourceKind = "OBJECT_TYPE" | "CONNECTION" | "RULE_SET" | "ACTION_TYPE";
export type Op = "READ" | "WRITE" | "EXECUTE";

export interface AccessDecision {
  allowed: boolean;
  matchedPolicies: PermissionPolicy[];
  /** rowFilter expressions to AND together (data-layer enforcement). */
  rowFilters: string[];
  reason: string;
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
        reason: "platform_admin 不在任何租户的业务数据策略中（平台运维角色，禁止读业务对象）",
      };
    }
    // 租户管理员（admin）= 本租户超级用户：对本租户业务资源（对象/规则/动作）全量访问，不受逐策略授权与
    // 行级过滤约束（仍守 R2）。修：此前 admin 仅在被显式 grant 的资源上可读，凡有限制性策略而未授 admin 的
    // 资源即"权限不足"——与"admin 拥有全部模块访问权"相悖。真值写入安全仍由 R4（Action 审批）独立保证。
    // 例外 CONNECTION：数据源/知识库连接器可对 admin 单独设限（敏感来源隔离，刻意保留的边界，见 kb V11）。
    if (kind !== "CONNECTION" && ctx.roles.some((r) => r.split(":")[0] === "admin")) {
      return { allowed: true, matchedPolicies: [], rowFilters: [], reason: "tenant admin: full access within tenant" };
    }
    const policies = await this.repos.policies.list(
      ctx.tenantId,
      (p) => p.resource.kind === kind && (p.resource.key === key || p.resource.key === "*"),
    );
    if (policies.length === 0) {
      // No policy attached to the resource: tenant isolation still applies; default allow.
      return { allowed: true, matchedPolicies: [], rowFilters: [], reason: "no policy attached; default allow" };
    }
    const matched: PermissionPolicy[] = [];
    const rowFilters: string[] = [];
    let granted = false;
    for (const policy of policies) {
      const grant = policy.grants.find((g) => roleMatches(g.role, ctx.roles) && g.ops.includes(op));
      if (!grant) continue;
      matched.push(policy);
      granted = true;
      if (policy.rowFilter) rowFilters.push(policy.rowFilter);
    }
    if (!granted) {
      return {
        allowed: false,
        matchedPolicies: [],
        rowFilters: [],
        reason: `no grant gives ${op} on ${kind}:${key} for roles [${ctx.roles.join(", ")}]`,
      };
    }
    return {
      allowed: true,
      matchedPolicies: matched,
      rowFilters,
      reason: `granted by ${matched.map((p) => p.id).join(", ")}`,
    };
  }

  /** Throws 403 when not allowed; returns the row filters otherwise. */
  async require(ctx: AuthCtx, kind: ResourceKind, key: string, op: Op): Promise<string[]> {
    const d = await this.decide(ctx, kind, key, op);
    if (!d.allowed) throw forbidden(d.reason);
    return d.rowFilters;
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
      reason: d.reason,
    };
  }
}
