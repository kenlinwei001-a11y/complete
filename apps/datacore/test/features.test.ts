import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, ADMIN, PLANNER } from "./helpers.js";

describe("Feature entitlement backend (E)", () => {
  it("registry + resolution: battery defaults all-on; tenant override narrows; ETag on GET", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const reg = (await t.app.inject({ method: "GET", url: "/a/v1/features/registry", headers: ADMIN })).json() as {
      key: string;
      level: string;
      defaultOn: boolean;
    }[];
    expect(reg.length).toBeGreaterThanOrEqual(15);
    expect(reg.some((f) => f.key === "view.plan-audit" && f.level === "VIEW")).toBe(true);

    const resolved = (await t.app.inject({ method: "GET", url: "/a/v1/tenants/demo/features", headers: ADMIN })).json() as {
      features: string[];
      configVersion: number;
    };
    expect(resolved.features).toContain("view.plan-audit");
    expect(resolved.configVersion).toBe(0);

    // tenant-level off
    const put = await t.app.inject({
      method: "PUT",
      url: "/a/v1/tenants/demo/features",
      headers: ADMIN,
      payload: { overrides: { "view.plan-audit": false } },
    });
    expect(put.statusCode).toBe(200);
    const after = (put.json() as { features: string[]; configVersion: number });
    expect(after.features).not.toContain("view.plan-audit");
    expect(after.configVersion).toBe(1);

    // ETag keyed by configVersion → 304 on If-None-Match
    const get1 = await t.app.inject({ method: "GET", url: "/a/v1/tenants/demo/features", headers: ADMIN });
    const etag = get1.headers.etag as string;
    expect(etag).toBe('W/"fv-1"');
    const get2 = await t.app.inject({
      method: "GET",
      url: "/a/v1/tenants/demo/features",
      headers: { ...ADMIN, "if-none-match": etag },
    });
    expect(get2.statusCode).toBe(304);

    // audit log records the diff
    const audit = (await t.app.inject({ method: "GET", url: "/a/v1/tenants/demo/features/audit", headers: ADMIN })).json() as {
      diff: Record<string, { to: boolean }>;
      configVersion: number;
    }[];
    expect(audit[0]!.configVersion).toBe(1);
    expect(audit[0]!.diff["view.plan-audit"]!.to).toBe(false);
  });

  it("E1/middleware: tenant-disabled feature → solver endpoint 404 FEATURE_NOT_FOUND (before authz)", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // works while enabled
    const ok = await invokeSolver(t, "plan_audit", {
      dem: 100, seg_pas: 52, seg_ess: 32, seg_com: 16, sup: 100, ltaCov: 70, kitGap: 0, gmTarget: 14, cashCushion: 60, capex: 5,
    });
    expect(ok.statusCode).toBe(200);
    await t.app.inject({
      method: "PUT",
      url: "/a/v1/tenants/demo/features",
      headers: ADMIN,
      payload: { overrides: { "view.plan-audit": false } },
    });
    const gone = await invokeSolver(t, "plan_audit", {
      dem: 100, seg_pas: 52, seg_ess: 32, seg_com: 16, sup: 100, ltaCov: 70, kitGap: 0, gmTarget: 14, cashCushion: 60, capex: 5,
    });
    expect(gone.statusCode).toBe(404);
    expect((gone.json() as { error: { code: string } }).error.code).toBe("FEATURE_NOT_FOUND");
    // unrelated solver stays reachable
    expect((await invokeSolver(t, "plan_generate", {})).statusCode).toBe(200);
    // api-tagged routes: disable view.sop-balance → sop endpoints 404
    await t.app.inject({
      method: "PUT",
      url: "/a/v1/tenants/demo/features",
      headers: ADMIN,
      payload: { overrides: { "view.plan-audit": false, "view.sop-balance": false } },
    });
    const sopGone = await t.app.inject({
      method: "POST",
      url: "/a/v1/sop/versions",
      headers: ADMIN,
      payload: { month: "2026-07" },
    });
    expect(sopGone.statusCode).toBe(404);
    expect((sopGone.json() as { error: { code: string } }).error.code).toBe("FEATURE_NOT_FOUND");
  });

  it("E6: role narrowing only — enabling beyond the tenant set → 422 ROLE_CANNOT_EXCEED_TENANT", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await t.app.inject({
      method: "PUT",
      url: "/a/v1/tenants/demo/features",
      headers: ADMIN,
      payload: { overrides: { "view.plan-audit": false } },
    });
    const exceed = await t.app.inject({
      method: "PUT",
      url: "/a/v1/tenants/demo/features/roles/planner",
      headers: ADMIN,
      payload: { overrides: { "view.plan-audit": true } },
    });
    expect(exceed.statusCode).toBe(422);
    expect((exceed.json() as { error: { code: string } }).error.code).toBe("ROLE_CANNOT_EXCEED_TENANT");
    // narrowing is allowed
    const narrow = await t.app.inject({
      method: "PUT",
      url: "/a/v1/tenants/demo/features/roles/planner",
      headers: ADMIN,
      payload: { overrides: { "act.adopt-to-draft": false } },
    });
    expect(narrow.statusCode).toBe(200);
    expect((narrow.json() as { features: string[] }).features).not.toContain("act.adopt-to-draft");
    // preview by role
    const preview = (
      await t.app.inject({ method: "GET", url: "/a/v1/tenants/demo/features/preview?role=planner", headers: ADMIN })
    ).json() as { features: string[] };
    expect(preview.features).not.toContain("act.adopt-to-draft");
    // other roles unaffected
    const adminSet = (
      await t.app.inject({ method: "GET", url: "/a/v1/tenants/demo/features/preview?role=admin", headers: ADMIN })
    ).json() as { features: string[] };
    expect(adminSet.features).toContain("act.adopt-to-draft");
  });

  it("E4: parent off cascades children off (view.project-sim → whatif)", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await t.app.inject({
      method: "PUT",
      url: "/a/v1/tenants/demo/features",
      headers: ADMIN,
      payload: { overrides: { "view.project-sim": false } },
    });
    const resolved = (await t.app.inject({ method: "GET", url: "/a/v1/tenants/demo/features", headers: ADMIN })).json() as {
      features: string[];
    };
    expect(resolved.features).not.toContain("view.project-sim");
    expect(resolved.features).not.toContain("view.project-sim.whatif"); // child gone although not overridden
  });

  it("E5/workspace: features + configVersion in workspace; navigation/views filtered server-side", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const ws1 = (await t.app.inject({ method: "GET", url: "/a/v1/me/workspace", headers: PLANNER })).json() as {
      features: string[];
      configVersion: number;
      views: { key: string }[];
      navigation: { key: string }[];
    };
    expect(ws1.features).toContain("view.risk-board");
    expect(ws1.views.map((v) => v.key)).toContain("risk");

    await t.app.inject({
      method: "PUT",
      url: "/a/v1/tenants/demo/features",
      headers: ADMIN,
      payload: { overrides: { "view.risk-board": false } },
    });
    const ws2 = (await t.app.inject({ method: "GET", url: "/a/v1/me/workspace", headers: PLANNER })).json() as {
      features: string[];
      configVersion: number;
      views: { key: string }[];
      navigation: { key: string }[];
    };
    expect(ws2.configVersion).toBe(1);
    expect(ws2.features).not.toContain("view.risk-board");
    expect(ws2.views.map((v) => v.key)).not.toContain("risk");
    expect(ws2.navigation.map((n) => n.key)).not.toContain("risk");
    // and the bound solver endpoint is gone too
    const risk = await invokeSolver(t, "risk_timeline", { base: "常州", factor: "物料齐套", horizon: 10 }, PLANNER);
    expect(risk.statusCode).toBe(404);
  });

  it("E7: synthetic generation skips view seeds bound to disabled features", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await t.app.inject({
      method: "PUT",
      url: "/a/v1/tenants/demo/features",
      headers: ADMIN,
      payload: { overrides: { "view.risk-board": false } },
    });
    // re-run the synthetic job → risk view seed is skipped
    await seedBattery(t);
    const job = (await t.repos.syntheticJobs.list("demo")).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]!;
    expect(job.report!.views).toContain("dash");
    expect(job.report!.views).toContain("order");
    expect(job.report!.views).not.toContain("risk");
    const vcs = await t.repos.viewConfigs.list("demo", (v) => v.origin === "SYNTHETIC");
    for (const vc of vcs) expect(vc.views.map((v) => v.key)).not.toContain("risk");
  });
});
