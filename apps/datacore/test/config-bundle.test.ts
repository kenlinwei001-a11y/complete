import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, debugUser } from "./helpers.js";

/**
 * OC3 环境间配置迁移 + 跨系统 Saga（execution-semantics §3 / OC3）：导出本租户配置 → 另一环境导入，
 * DRY_RUN_OK→APPLYING_A→APPLYING_B→COMMITTED；B 失败 → COMPENSATING→COMPENSATED（回滚 A）。
 * 工业级：真实多功能键配置 + 全状态跃迁 + schemaVersion/未知键/冲突拒绝 + 补偿回滚 + R2。
 */
const ACME = debugUser("acme", "admin", "admin");
type Job = { state: string; error?: string; diff?: { featureOverrides: { added: string[]; changed: unknown[] }; conflicts: string[] } };
type Bundle = { platformSchemaVersion: string; sourceTenantId: string; exportedAt?: string; featureOverrides: Record<string, boolean>; agentCore?: Record<string, unknown> };

describe("OC3 配置迁移 + 跨系统 Saga", () => {
  it("导出→另环境 dry-run diff→应用 COMMITTED；schemaVersion/未知键/冲突拒绝；R2 隔离", async () => {
    const t = await makeApp();
    // —— 源环境 demo：关 3 个真实功能（entitlement 配置 = 可售包形态）——
    const OVERRIDES = { "view.plan-audit": false, "view.geo-map": false, "domain.factory": false };
    const put = await t.app.inject({ method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN, payload: { overrides: OVERRIDES } });
    expect(put.statusCode).toBe(200);

    // —— 导出 ——
    const bundle = (await (await t.app.inject({ method: "GET", url: "/a/v1/config-bundles/export", headers: ADMIN })).json()) as Bundle;
    expect(bundle.platformSchemaVersion).toBe("1.0");
    expect(bundle.sourceTenantId).toBe("demo");
    expect(bundle.featureOverrides["view.plan-audit"]).toBe(false);
    expect(Object.keys(bundle.featureOverrides).length).toBe(3);

    // —— 目标环境 acme：dry-run diff（3 项新增，零写）——
    const dry = (await (await t.app.inject({ method: "POST", url: "/a/v1/config-bundles/import", headers: ACME, payload: { bundle, dryRun: true } })).json()) as Job;
    expect(dry.state).toBe("DRY_RUN_OK");
    expect(dry.diff!.featureOverrides.added.length).toBe(3);
    const acmeBefore = (await (await t.app.inject({ method: "GET", url: "/a/v1/config-bundles/export", headers: ACME })).json()) as Bundle;
    expect(Object.keys(acmeBefore.featureOverrides).length, "dry-run 零写").toBe(0);

    // —— 应用（Saga 跑完）→ COMMITTED，acme 现持有 overrides ——
    const applied = (await (await t.app.inject({ method: "POST", url: "/a/v1/config-bundles/import", headers: ACME, payload: { bundle } })).json()) as Job;
    expect(applied.state).toBe("COMMITTED");
    const acmeAfter = (await (await t.app.inject({ method: "GET", url: "/a/v1/config-bundles/export", headers: ACME })).json()) as Bundle;
    expect(acmeAfter.featureOverrides["view.plan-audit"]).toBe(false);
    expect(acmeAfter.featureOverrides["domain.factory"]).toBe(false);

    // —— schemaVersion major 不兼容 → FAILED ——
    const badVer = (await (await t.app.inject({ method: "POST", url: "/a/v1/config-bundles/import", headers: ACME, payload: { bundle: { ...bundle, platformSchemaVersion: "2.0" } } })).json()) as Job;
    expect(badVer.state).toBe("FAILED");
    expect(badVer.error).toContain("schemaVersion");

    // —— 未知功能键（目标环境无此 feature）→ FAILED ——
    const unknown = (await (await t.app.inject({ method: "POST", url: "/a/v1/config-bundles/import", headers: ACME, payload: { bundle: { ...bundle, featureOverrides: { "view.does-not-exist": false } } } })).json()) as Job;
    expect(unknown.state).toBe("FAILED");

    // —— 冲突 + policy=FAIL → FAILED（不部分应用）：acme 已有 view.plan-audit=false，导入 true = 冲突 ——
    const conflict = (await (await t.app.inject({ method: "POST", url: "/a/v1/config-bundles/import", headers: ACME, payload: { bundle: { ...bundle, featureOverrides: { "view.plan-audit": true } }, conflictPolicy: "FAIL" } })).json()) as Job;
    expect(conflict.state).toBe("FAILED");
    expect(conflict.diff!.conflicts).toContain("view.plan-audit");
    // acme 仍 false（冲突未应用）
    const stillFalse = (await (await t.app.inject({ method: "GET", url: "/a/v1/config-bundles/export", headers: ACME })).json()) as Bundle;
    expect(stillFalse.featureOverrides["view.plan-audit"]).toBe(false);

    // —— R2：所有 acme 导入不影响 demo（源环境配置不变）——
    const demoStill = (await (await t.app.inject({ method: "GET", url: "/a/v1/config-bundles/export", headers: ADMIN })).json()) as Bundle;
    expect(Object.keys(demoStill.featureOverrides).length).toBe(3);
  });

  it("M 跨系统 Saga 补偿：B 段（AgentCore）失败 → COMPENSATING→COMPENSATED，A 段回滚（Saga 一致）", async () => {
    const t = await makeApp();
    // 注入失败的 B 客户端（部署态=AgentCore；此处模拟 B 段失败触发补偿）
    t.services.configBundle.setAgentCoreApply(async () => ({ ok: false }));

    // acme 先有一个基线配置（view.geo-map=false），用于验证补偿"回滚到之前"
    await t.app.inject({ method: "PUT", url: "/a/v1/tenants/acme/features", headers: ACME, payload: { overrides: { "view.geo-map": false } } });

    // 导入一个含 agentCore 段的 bundle（触发 B 段）→ A 段应用 view.plan-audit=false 后 B 失败 → 补偿
    const bundle: Bundle = { platformSchemaVersion: "1.0", sourceTenantId: "demo", exportedAt: new Date().toISOString(), featureOverrides: { "view.plan-audit": false }, agentCore: { scenarios: ["s1"] } };
    const job = (await (await t.app.inject({ method: "POST", url: "/a/v1/config-bundles/import", headers: ACME, payload: { bundle } })).json()) as Job;
    expect(job.state).toBe("COMPENSATED");
    expect(job.error).toContain("补偿");

    // A 段已回滚：view.plan-audit 不应被持久化（恢复到导入前），基线 view.geo-map=false 保留
    const after = (await (await t.app.inject({ method: "GET", url: "/a/v1/config-bundles/export", headers: ACME })).json()) as Bundle;
    expect(after.featureOverrides["view.plan-audit"], "B 失败 → A 回滚，view.plan-audit 未落").toBeUndefined();
    expect(after.featureOverrides["view.geo-map"], "补偿恢复到导入前基线").toBe(false);
  });

  it("B 段成功（注入 ok 客户端）→ COMMITTED（跨系统两段都过）", async () => {
    const t = await makeApp();
    t.services.configBundle.setAgentCoreApply(async () => ({ ok: true }));
    const bundle: Bundle = { platformSchemaVersion: "1.0", sourceTenantId: "demo", exportedAt: new Date().toISOString(), featureOverrides: { "view.plan-audit": false }, agentCore: { scenarios: ["s1"] } };
    const job = (await (await t.app.inject({ method: "POST", url: "/a/v1/config-bundles/import", headers: ACME, payload: { bundle } })).json()) as Job;
    expect(job.state).toBe("COMMITTED");
    const after = (await (await t.app.inject({ method: "GET", url: "/a/v1/config-bundles/export", headers: ACME })).json()) as Bundle;
    expect(after.featureOverrides["view.plan-audit"]).toBe(false);
  });
});
