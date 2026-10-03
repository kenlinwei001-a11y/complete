import { describe, expect, it } from "vitest";
import { makeApp, seedBattery } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";

/**
 * #13 电池产能灰数据面板接缝修 · SEAM-GATE（数据半 Equipment/Line/Process × 引擎半 bottleneck_matrix·非各半绿）。
 *
 * 病根（真 bug·假绿掩盖）：前端 CapacityDerivationDag 传 `baseIds:[card.base]`——card.base = **中文基地名"常州"**，
 * 但 `liveTightness` 按 `e.props.baseId === baseId` 过滤（真 baseId = "changzhou"）→ 恒空 → dataMode 恒 MOCK →
 * FRONTEND 加的 `dataMode:"LIVE"` 是**死接线**，改真 Equipment.oee_current 格子不变色。前端 SEAM test 却 mock 掉
 * HTTP 回 `dataMode:"LIVE"`，从不跑真 baseId→Equipment 过滤 → 假绿（绿测试≠能用·断在接缝）。
 *
 * 本门驱动真接缝（真 generateBattery ctx·经 services.solvers.invoke 真建 SolverContext·非 mock HTTP）：
 *   ① 传中文名"常州"→ 规范到真 baseId → **dataMode LIVE**（改前恒 MOCK·此断言改前红）；
 *   ② 改真 Equipment.oee_current → **设备OEE 张力真变**（证真读 Equipment·非恒定 mock seed·变异反证非重言）；
 *   ③ **provenanceSynthetic=true**（demo 合成物化 → 前端诚实"合成·未接实测"·守 KILL-MOCK-RED·不谎报实测）；
 *   ④ 传真 id "changzhou" 亦 LIVE（证名归一不破坏 id 直传）。
 */
const CTX: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
type BnOut = {
  dataMode: "LIVE" | "MOCK";
  factors: string[];
  rows: { base: string; tightness: Record<string, number>; primary: string; provenanceSynthetic?: boolean }[];
};
const invokeBn = (t: Awaited<ReturnType<typeof makeApp>>, baseRef: string): Promise<BnOut> =>
  t.services.solvers.invoke(CTX, "bottleneck_matrix", { baseIds: [baseRef], dataMode: "LIVE" }) as Promise<BnOut>;

describe("#13 · bottleneck_matrix 灰数据接缝（中文名归一→真 LIVE + 改真 OEE 张力真变 + 合成 provenance）", () => {
  it("SEAM 头号：中文基地名'常州'→ dataMode LIVE（非死接线 MOCK）+ 改真 Equipment.oee_current → 设备张力真变 + provenanceSynthetic", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // ① 前端同式：传中文名"常州"（RiskBoardView card.base）→ 修后规范到 changzhou → Equipment 命中 → LIVE（修前恒 MOCK·红）。
    const r0 = await invokeBn(t, "常州");
    expect(r0.dataMode).toBe("LIVE"); // ★命门：名归一 + 真 Equipment 命中
    const row0 = r0.rows.find((r) => r.base === "常州") ?? r0.rows[0]!;
    // ③ demo 合成物化 → 诚实标记（前端据此显"合成·未接实测"·不把合成谎报"实测"）。
    expect(row0.provenanceSynthetic).toBe(true);
    const t0 = row0.tightness["设备OEE"];
    expect(typeof t0).toBe("number");

    // ② 改真 Equipment.oee_current（changzhou 全设低 0.30·OEE↓→张力↑·risk.ts liveTightness 口径）→ 设备张力真变。
    const equip = (await t.repos.objects.listByType("demo", "Equipment")).filter((e) => String(e.props.baseId) === "changzhou");
    expect(equip.length).toBeGreaterThan(0);
    for (const e of equip) {
      await t.repos.objects.put({ ...e, props: { ...e.props, oee_current: 0.3 } });
    }
    const r1 = await invokeBn(t, "常州");
    expect(r1.dataMode).toBe("LIVE"); // 仍 LIVE（真读）
    const t1 = (r1.rows.find((r) => r.base === "常州") ?? r1.rows[0]!).tightness["设备OEE"];
    // ★改真数据 → 上游张力真变（OEE 0.30 更低 → 张力更高）：证走的是真 Equipment 读、非恒定 mock seed（死接线会 t1===t0）。
    expect(t1).toBeGreaterThan(t0!);

    // ④ 传真 id "changzhou" 亦 LIVE（名归一不破坏 id 直传·resolveRef 双口径）。
    const rId = await invokeBn(t, "changzhou");
    expect(rId.dataMode).toBe("LIVE");
  });
});
