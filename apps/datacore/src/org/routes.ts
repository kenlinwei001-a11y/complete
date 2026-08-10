import type { FastifyInstance, FastifyRequest } from "fastify";
import { ApprovalMatterSchema } from "@platform/contracts";
import type { AuthCtx } from "../domain.js";
import { validationError } from "../errors.js";
import type { OrgWorldService } from "./service.js";

/**
 * WO-ORG-WORLD · 组织世界 REST（`/a/v1/org/*`）。
 *
 * ══ Entitlement 先于 authz（铁律）════════════════════════════════════════
 * 每条路由**第一件事**是 `requireFeatureTag(req,"apiTags","org-world")` ——
 * 功能关闭 = 不存在 → 404 `FEATURE_NOT_FOUND`，**排在任何角色判定之前**。
 * `org.world` 是 `defaultOn:false` 暗发（开关默认值是产品决策，dev 不自己开）。
 *
 * ══ no-secrets-echo（铁律）══════════════════════════════════════════════
 * 组织世界承载的是**人**。本路由下发的人员字段严格限于
 * `principalId / orgKey / name / title / kind / parentRef / roleRefs /
 *  platformRoles / available / workload`（见 `personVM`）——
 * **不含**密码散列、联系方式、证件号、薪酬等任何敏感字段。
 * 这不是「现在恰好没有这些字段」就够了：`OrgPrincipal` 将来加字段时，
 * 下发面是**白名单**而不是 `...spread`，新字段默认不外泄。
 * `org-world.test.ts` 有一条断言把响应键集与白名单逐字比对 —— 谁加了字段又顺手 spread 出去，当场红。
 */

/** 人员/主体下发白名单（no-secrets-echo：新字段默认不外泄）。 */
export const ORG_PRINCIPAL_VM_KEYS = [
  "principalId",
  "orgKey",
  "name",
  "title",
  "kind",
  "parentRef",
  "roleRefs",
  "platformRoles",
  "available",
  "workload",
] as const;

type PrincipalLike = Record<string, unknown>;
const personVM = (p: PrincipalLike): Record<string, unknown> =>
  Object.fromEntries(ORG_PRINCIPAL_VM_KEYS.map((k) => [k, p[k]]));

interface OrgDeps {
  service: OrgWorldService;
  ctx: (req: FastifyRequest) => AuthCtx;
  /** Entitlement 门（app.ts 的 requireFeatureTag，绑定同一个 FeatureService）。 */
  requireFeature: (req: FastifyRequest) => Promise<void>;
}

export function registerOrgWorldRoutes(app: FastifyInstance, deps: OrgDeps): void {
  const { service, ctx, requireFeature } = deps;

  /** 组织架构（部门/角色/人三层）。 */
  app.get("/a/v1/org/chart", async (req) => {
    await requireFeature(req);
    const chart = await service.orgChart(ctx(req));
    return {
      departments: chart.departments.map(personVM),
      roles: chart.roles.map(personVM),
      persons: chart.persons.map(personVM),
    };
  });

  /** 职权 + 额度 + 代理（配置面只读；写面属管理台，本单不做）。 */
  app.get("/a/v1/org/authorities", async (req) => {
    await requireFeature(req);
    const c = ctx(req);
    const [authorities, limits] = await Promise.all([service.listAuthorities(c), service.listApprovalLimits(c)]);
    return { authorities, limits };
  });

  app.get("/a/v1/org/delegations", async (req) => {
    await requireFeature(req);
    return { delegations: await service.listDelegations(ctx(req)) };
  });

  /**
   * **本单的主端点**：给定一个待批事项 → 谁有权批 + 谁为什么批不了。
   *
   * 与 `WO-APPROVAL-POLICY` 的接缝就在这里：那一单拿 `eligible[]` 去编排批复链
   * （会签/或签/超时升级/发起人不得自批），本单**只回答「谁有权」**。
   */
  app.post("/a/v1/org/approvers/resolve", async (req) => {
    await requireFeature(req);
    const parsed = ApprovalMatterSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    return service.resolveApprovers(ctx(req), parsed.data);
  });
}
