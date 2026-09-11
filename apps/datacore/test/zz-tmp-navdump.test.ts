// TEMPORARY measurement rig for WO-SIM-GATE-DECOUPLE — deleted before final commit.
// Dumps demo·admin workspace under several entitlement scenarios so the frontend
// counting rig can replay the REAL nav filter over the REAL backend payload.
import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { makeApp, seedBattery, debugUser } from "./helpers.js";

const OUT = process.env.NAVDUMP_OUT ?? "/tmp/navdump";
// 真实 demo·admin 三角色（CLAUDE.md：admin+planner+catalog_admin）
const DEMO_ADMIN = debugUser("demo", "admin", "admin|planner|catalog_admin");

type WS = {
  features: string[];
  configVersion: number;
  views: { key: string }[];
  navigation: { key: string; label?: string; group?: string; viewKey?: string }[];
};

describe("zz-tmp navdump", () => {
  it("dumps workspace under entitlement scenarios", async () => {
    const t = await makeApp();
    await seedBattery(t);
    mkdirSync(OUT, { recursive: true });

    const ws = async (): Promise<WS> =>
      (await t.app.inject({ method: "GET", url: "/a/v1/me/workspace", headers: DEMO_ADMIN })).json() as WS;

    const put = async (overrides: Record<string, boolean>) => {
      const r = await t.app.inject({
        method: "PUT",
        url: "/a/v1/tenants/demo/features",
        headers: DEMO_ADMIN,
        payload: { overrides },
      });
      return { status: r.statusCode, body: r.body.slice(0, 300) };
    };

    // S0 · 默认态（不动任何 override）
    const s0 = await ws();
    writeFileSync(`${OUT}/s0-default.json`, JSON.stringify(s0, null, 2));
    // 金丝雀：基线必须非空，且 configVersion 为 0（⇒ 没有既存 override 被我覆盖）
    expect(s0.features.length).toBeGreaterThan(50);
    expect(s0.navigation.length).toBeGreaterThan(10);
    // eslint-disable-next-line no-console
    console.log(
      `[NAVDUMP] S0 configVersion=${s0.configVersion} features=${s0.features.length} navigation=${s0.navigation.length} views=${s0.views.length}` +
        ` simSandbox=${s0.features.includes("sim.sandbox")}` +
        ` viewSimSandbox=${s0.features.includes("view.sim-sandbox")}` +
        ` viewSimUnified=${s0.features.includes("view.sim-unified")}`,
    );

    // S1 · 只关“沙盘页面闸”，能力闸保持开
    const r1 = await put({ "view.sim-sandbox": false });
    const s1 = r1.status === 200 ? await ws() : null;
    if (s1) writeFileSync(`${OUT}/s1-pagegate-off.json`, JSON.stringify(s1, null, 2));
    // eslint-disable-next-line no-console
    console.log(
      `[NAVDUMP] S1 put=${r1.status} ${r1.status === 200 ? "" : r1.body} ` +
        (s1
          ? `features=${s1.features.length} navigation=${s1.navigation.length} simSandbox=${s1.features.includes("sim.sandbox")} viewSimSandbox=${s1.features.includes("view.sim-sandbox")}`
          : ""),
    );

    // S2 · 关能力闸（今天唯一可行的关法），作为对照
    const r2 = await put({ "sim.sandbox": false });
    const s2 = r2.status === 200 ? await ws() : null;
    if (s2) writeFileSync(`${OUT}/s2-capability-off.json`, JSON.stringify(s2, null, 2));
    // eslint-disable-next-line no-console
    console.log(
      `[NAVDUMP] S2 put=${r2.status} ` +
        (s2 ? `features=${s2.features.length} navigation=${s2.navigation.length}` : ""),
    );

    // 复位金丝雀：清空 override 后必须回到 S0 的读数（⇒ 实验基线可复现）
    await put({});
    const s0b = await ws();
    // eslint-disable-next-line no-console
    console.log(
      `[NAVDUMP] RESET features=${s0b.features.length} navigation=${s0b.navigation.length} (S0 was ${s0.features.length}/${s0.navigation.length})`,
    );
    expect(s0b.features.length).toBe(s0.features.length);
    expect(s0b.navigation.length).toBe(s0.navigation.length);
  }, 180_000);
});
