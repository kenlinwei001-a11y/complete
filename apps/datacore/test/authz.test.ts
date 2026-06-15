import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";

async function seedBattery(t: TestApp): Promise<void> {
  const res = await t.app.inject({
    method: "POST",
    url: "/a/v1/synthetic/jobs",
    headers: ADMIN,
    payload: { industry: "battery-manufacturing", scale: "S", seed: 42 },
  });
  expect(res.statusCode).toBe(202);
}

async function login(t: TestApp, username: string): Promise<string> {
  const res = await t.app.inject({
    method: "POST",
    url: "/a/v1/auth/login",
    payload: { tenantId: "demo", username, password: "demo1234" },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { accessToken: string }).accessToken;
}

describe("A0 IAM + A6 permissions", () => {
  it("login → access/refresh pair; refresh issues a new working token; jwks served", async () => {
    const t = await makeApp();
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/auth/login",
      payload: { username: "admin", password: "demo1234" },
    });
    expect(res.statusCode).toBe(200);
    const pair = res.json() as { accessToken: string; refreshToken: string; expiresIn: number };
    expect(pair.expiresIn).toBe(900);

    const refreshed = await t.app.inject({
      method: "POST",
      url: "/a/v1/auth/refresh",
      payload: { refreshToken: pair.refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);
    const next = refreshed.json() as { accessToken: string };
    const ws = await t.app.inject({
      method: "GET",
      url: "/a/v1/me/workspace",
      headers: { authorization: `Bearer ${next.accessToken}` },
    });
    expect(ws.statusCode).toBe(200);

    // refresh token must not work as an access token
    const misuse = await t.app.inject({
      method: "GET",
      url: "/a/v1/me/workspace",
      headers: { authorization: `Bearer ${pair.refreshToken}` },
    });
    expect(misuse.statusCode).toBe(401);

    const jwks = await t.app.inject({ method: "GET", url: "/a/v1/.well-known/jwks.json" });
    const keys = (jwks.json() as { keys: { kty: string; alg: string }[] }).keys;
    expect(keys[0]).toMatchObject({ kty: "RSA", alg: "RS256" });

    const bad = await t.app.inject({
      method: "POST",
      url: "/a/v1/auth/login",
      payload: { username: "admin", password: "wrong" },
    });
    expect(bad.statusCode).toBe(401);
    expect((bad.json() as { error: { code: string } }).error.code).toBe("UNAUTHORIZED");
  });

  it("AU1: planner vs base_manager(常州) — different workspace, same query different rows", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const plannerToken = await login(t, "planner");
    const bmToken = await login(t, "base_manager");

    const wsPlanner = (
      await t.app.inject({ method: "GET", url: "/a/v1/me/workspace", headers: { authorization: `Bearer ${plannerToken}` } })
    ).json() as { views: { key: string }[]; tenant: { id: string } };
    const wsBm = (
      await t.app.inject({ method: "GET", url: "/a/v1/me/workspace", headers: { authorization: `Bearer ${bmToken}` } })
    ).json() as { views: { key: string }[] };
    expect(wsPlanner.tenant.id).toBe("demo");
    expect(wsPlanner.views.map((v) => v.key)).toContain("dash");
    expect(wsBm.views.map((v) => v.key)).not.toContain("dash");

    const query = { objectType: "Order", filter: {}, limit: 100 };
    const plannerRows = (
      await t.app.inject({
        method: "POST",
        url: "/a/v1/objects/query",
        headers: { authorization: `Bearer ${plannerToken}` },
        payload: query,
      })
    ).json() as { data: { props: { bases: string[] } }[] };
    const bmRows = (
      await t.app.inject({
        method: "POST",
        url: "/a/v1/objects/query",
        headers: { authorization: `Bearer ${bmToken}` },
        payload: query,
      })
    ).json() as { data: { props: { bases: string[] } }[] };

    expect(plannerRows.data).toHaveLength(20);
    expect(bmRows.data.length).toBeGreaterThan(0);
    expect(bmRows.data.length).toBeLessThan(plannerRows.data.length);
    for (const row of bmRows.data) expect(row.props.bases).toContain("changzhou");

    // Base query: base_manager sees only 常州
    const bmBases = (
      await t.app.inject({
        method: "POST",
        url: "/a/v1/objects/query",
        headers: { authorization: `Bearer ${bmToken}` },
        payload: { objectType: "Base", filter: {}, limit: 100 },
      })
    ).json() as { data: { props: { baseId: string } }[] };
    expect(bmBases.data).toHaveLength(1);
    expect(bmBases.data[0]!.props.baseId).toBe("changzhou");

    // slices apply the same data-layer filtering from the caller's JWT
    const bmSlice = (
      await t.app.inject({
        method: "POST",
        url: "/a/v1/slices/base_risk_profile/resolve",
        headers: { authorization: `Bearer ${bmToken}` },
        payload: { args: { baseId: "changzhou" } },
      })
    ).json() as { data: { orders: unknown[] }; snapshotVersion: string };
    expect(bmSlice.snapshotVersion).toMatch(/^\d+\.\d+$/);
    const denied = await t.app.inject({
      method: "POST",
      url: "/a/v1/slices/base_risk_profile/resolve",
      headers: { authorization: `Bearer ${bmToken}` },
      payload: { args: { baseId: "hefei" } },
    });
    expect(denied.statusCode).toBe(404); // other bases filtered out before returning
  });

  it("authz explain returns matched policies + effective row filter", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const explain = (
      await t.app.inject({
        method: "POST",
        url: "/a/v1/authz/explain",
        headers: ADMIN,
        payload: {
          user: { roles: ["base_manager:常州"], attributes: { baseScope: ["changzhou"] } },
          resource: { kind: "OBJECT_TYPE", key: "Base" },
          op: "READ",
        },
      })
    ).json() as { allowed: boolean; effectiveRowFilter: string | null; rowFilterValid: boolean; matchedPolicies: unknown[] };
    expect(explain.allowed).toBe(true);
    expect(explain.effectiveRowFilter).toContain("baseScope");
    expect(explain.rowFilterValid).toBe(true);
    expect(explain.matchedPolicies).toHaveLength(1);

    const deniedWrite = (
      await t.app.inject({
        method: "POST",
        url: "/a/v1/authz/explain",
        headers: ADMIN,
        payload: {
          user: { roles: ["planner"] },
          resource: { kind: "OBJECT_TYPE", key: "Base" },
          op: "WRITE",
        },
      })
    ).json() as { allowed: boolean };
    expect(deniedWrite.allowed).toBe(false);
  });

  it("tenant isolation: another tenant sees nothing of demo's data", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const other = { "x-debug-user": "other:intruder:admin" };
    const rows = (
      await t.app.inject({
        method: "POST",
        url: "/a/v1/objects/query",
        headers: other,
        payload: { objectType: "Order", filter: {}, limit: 100 },
      })
    ).json() as { data: unknown[] };
    expect(rows.data).toHaveLength(0);
    const rules = (await t.app.inject({ method: "GET", url: "/a/v1/rules", headers: other })).json() as unknown[];
    expect(rules).toHaveLength(0);
  });

  it("requests without credentials are rejected with the unified envelope", async () => {
    const t = await makeApp();
    const res = await t.app.inject({ method: "GET", url: "/a/v1/rules" });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.requestId).toMatch(/^req_/);
  });
});
