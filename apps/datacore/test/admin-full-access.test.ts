import { describe, expect, it } from "vitest";
import type { AuthCtx } from "../src/domain.js";
import { AuthzService } from "../src/authz.js";
import { makeApp } from "./helpers.js";

/**
 * 租户管理员全量访问（修：场景卡推演里 admin 看到"因权限不足无法获取数据"）。
 * admin = 本租户超级用户：对本租户业务资源全量可读、不受逐策略授权与行级过滤约束（仍守 R2）。
 * 真值写入安全由 R4（Action 审批）独立保证，与此粗粒度读门正交。
 *
 * 故事脚本（~100 字）：管理员小赵在场景启动器点开一张卡推演，求解器要读一类挂了"仅基地经理可读"
 * 限制策略、且没给 admin 授权的对象。此前 admin 命中"无 grant → 权限不足"，对话里弹"因权限不足
 * 无法获取数据"——与"admin 有全部模块访问权"相悖。修复后 admin 直通全读，基地经理受策略约束，
 * 平台运维角色仍被业务数据拒之门外，跨租户仍零可见。
 */
const ctx = (roles: string[], attributes: Record<string, unknown> = {}, tenantId = "demo"): AuthCtx => ({ tenantId, userId: "u", roles, attributes });

describe("租户 admin 全量访问（权限不足 bug 修复）", () => {
  it("admin 对'仅基地经理可读、未授 admin'的资源仍全读（不再权限不足）", async () => {
    const t = await makeApp();
    const az = new AuthzService(t.repos);
    // 限制性策略：只给 base_manager 读 + 行级过滤；不给 admin 任何 grant
    await t.repos.policies.put({
      id: "pol_secret", tenantId: "demo",
      resource: { kind: "OBJECT_TYPE", key: "SecretType" },
      grants: [{ role: "base_manager", ops: ["READ"] }],
      rowFilter: "Object.baseId IN ${user.attributes.baseScope}",
    });

    const admin = await az.decide(ctx(["admin"]), "OBJECT_TYPE", "SecretType", "READ");
    expect(admin.allowed).toBe(true); // 直通
    expect(admin.rowFilters).toEqual([]); // 不受行级过滤约束

    // 复合角色（admin + 其它）同样直通
    expect((await az.decide(ctx(["catalog_admin", "admin"]), "OBJECT_TYPE", "SecretType", "WRITE")).allowed).toBe(true);
  });

  it("非 admin 仍按策略：planner 无 grant → 拒；base_manager → 准但带行级过滤", async () => {
    const t = await makeApp();
    const az = new AuthzService(t.repos);
    await t.repos.policies.put({
      id: "pol_secret2", tenantId: "demo",
      resource: { kind: "OBJECT_TYPE", key: "SecretType" },
      grants: [{ role: "base_manager", ops: ["READ"] }],
      rowFilter: "Object.baseId IN ${user.attributes.baseScope}",
    });
    expect((await az.decide(ctx(["planner"]), "OBJECT_TYPE", "SecretType", "READ")).allowed).toBe(false);
    const bm = await az.decide(ctx(["base_manager:常州"], { baseScope: ["changzhou"] }), "OBJECT_TYPE", "SecretType", "READ");
    expect(bm.allowed).toBe(true);
    expect(bm.rowFilters.length).toBe(1); // 基地经理仍受行级过滤
  });

  it("admin 直通不破坏 R2/运维隔离：platform_admin 仍拒业务数据；admin 限本租户", async () => {
    const t = await makeApp();
    const az = new AuthzService(t.repos);
    expect((await az.decide(ctx(["platform_admin"]), "OBJECT_TYPE", "Base", "READ")).allowed).toBe(false);
    // admin 的"全量"只在本租户成立（R2 由仓储层保证：跨租户读不到行）——此处验证 admin 决策不携带跨租户授权
    const adminDecision = await az.decide(ctx(["admin"], {}, "other-tenant"), "OBJECT_TYPE", "Base", "READ");
    expect(adminDecision.reason).toContain("tenant admin");
  });

  it("例外边界：CONNECTION 级限制仍可对 admin 生效（敏感数据源/知识库隔离，kb V11）", async () => {
    const t = await makeApp();
    const az = new AuthzService(t.repos);
    // 某连接器只授 planner、不授 admin → admin 在该连接器上仍被拒（业务数据全读不波及此边界）
    await t.repos.policies.put({ id: "pol_conn", tenantId: "demo", resource: { kind: "CONNECTION", key: "connSecret" }, grants: [{ role: "planner", ops: ["READ"] }] });
    expect((await az.decide(ctx(["admin"]), "CONNECTION", "connSecret", "READ")).allowed).toBe(false);
    // 但同一 admin 读业务对象仍全通
    expect((await az.decide(ctx(["admin"]), "OBJECT_TYPE", "SecretType", "READ")).allowed).toBe(true);
  });
});
