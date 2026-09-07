import { describe, it, expect, beforeAll } from "vitest";
import { makeApp, seedBattery, ADMIN, type TestApp } from "./helpers.js";

/** 存量测量：种子里的每个类型，今天能不能经自己的 REST 路由原样回写。 */
describe("measure · REST round-trip", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeApp();
    await seedBattery(t);
  }, 180_000);

  it("每个 ACTIVE 类型经 POST /a/v1/ontology/object-types 回写", async () => {
    const listRes = await t.app.inject({ method: "GET", url: "/a/v1/ontology/object-types", headers: ADMIN });
    const types = JSON.parse(listRes.body) as any[];
    const fails: string[] = [];
    for (const ty of types) {
      const body = {
        key: ty.key,
        displayName: ty.displayName,
        ...(ty.domain ? { domain: ty.domain } : {}),
        properties: ty.properties,
        derivedProperties: ty.derivedProperties ?? [],
        sourceBindings: ty.sourceBindings ?? [],
      };
      const res = await t.app.inject({
        method: "POST",
        url: "/a/v1/ontology/object-types",
        headers: ADMIN,
        payload: body,
      });
      if (res.statusCode !== 201) {
        fails.push(`${ty.key} → ${res.statusCode} ${JSON.parse(res.body)?.error?.message ?? res.body.slice(0, 200)}`);
      }
    }
    console.log("ROUNDTRIP_TOTAL=", types.length, "FAILS=", fails.length);
    for (const f of fails) console.log("ROUNDTRIP_FAIL", f);
    expect(types.length).toBeGreaterThan(50);
  });
});
