import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";

/**
 * G-9 发育闭环招牌：空租户经合成正门自动 provision 一致起步世界（POST /a/v1/growth/provision-world）。
 * 守：① 空租户 → 真合成（FK 一致·R6·SYNTHETIC，对象数>0）；② 非空租户 → 拒执行（TENANT_NOT_EMPTY，
 * 不 clobber 真数据）。industry 由 datacore 据租户配置派生（agentcore 零行业常数 R14）。
 */
const fresh = (t: string) => ({ "X-Debug-User": `${t}:usr_${t}_admin:admin`, "content-type": "application/json" });

describe("G-9 · provision-world 空租户自动补一致世界", () => {
  it("空租户 → 经合成正门 provision，对象世界从无到有（确定性）", async () => {
    const t = await makeApp();
    const r = await t.app.inject({ method: "POST", url: "/a/v1/growth/provision-world", headers: fresh("g9a"), payload: { scale: "S", seed: 42 } });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { provisioned: boolean; objectCount?: number; industry?: string };
    expect(body.provisioned).toBe(true);
    expect(body.objectCount ?? 0).toBeGreaterThan(0);
    // R6：同租户重跑（已非空）→ 拒执行（不重复/不 clobber）
    const r2 = await t.app.inject({ method: "POST", url: "/a/v1/growth/provision-world", headers: fresh("g9a"), payload: {} });
    expect((r2.json() as { provisioned: boolean }).provisioned).toBe(false);
  });

  it("非空租户（已 seed demo）→ 拒执行（TENANT_NOT_EMPTY，守不 clobber 真数据）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const r = await t.app.inject({ method: "POST", url: "/a/v1/growth/provision-world", headers: ADMIN, payload: {} });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { provisioned: boolean; reason?: string; existingObjects?: number };
    expect(body.provisioned).toBe(false);
    expect(body.reason).toBe("TENANT_NOT_EMPTY");
    expect(body.existingObjects ?? 0).toBeGreaterThan(20);
  });
});
