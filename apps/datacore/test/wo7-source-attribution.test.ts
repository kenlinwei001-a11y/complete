import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";
import { TYPE_SOURCE_SYSTEM } from "../src/graphmeta.js";

/**
 * WO-7：来源系统总览逐源真对象数归因（非0非假）。
 *
 * 根因（修前）：demo 全部对象经"单一合成连接器"物化，故图谱 sourceBindings.connId 对 9 业务源
 * 系统恒不匹配 → 前端 join 逐源对象数恒 0。修：服务端 buildDataHealth 按权威表
 * TYPE_SOURCE_SYSTEM（对象类型→真实来源系统）归因 + 真实实例数，下发 sources[].members/objectCount。
 *
 * 红线：禁止伪造分布——只计真实物化类型的真实实例数；LIMS 当前 demo 无物化对象类型 → 诚实空
 * （监控中·无物化对象），不虚增。
 */
const fetchHealth = (t: TestApp) =>
  t.app
    .inject({ method: "GET", url: "/a/v1/data-health", headers: ADMIN })
    .then((r) => r.json() as {
      sources: { connId: string; objectCount?: number; members?: { typeKey: string; count: number }[] }[];
    });

describe("WO-7 来源系统逐源真对象数归因", () => {
  it("8 个有物化类型的业务源各 join 非0真对象数；归因键与 TYPE_SOURCE_SYSTEM 一致", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const { sources } = await fetchHealth(t);
    const bySrc = new Map(sources.map((s) => [s.connId, s]));

    // demo 现有 34 类型归因下，这 8 源各应有 ≥1 真实物化类型与非0实例数。
    for (const sid of ["iot-scada", "mes", "erp", "srm", "plm", "wms", "qms", "ems"]) {
      const s = bySrc.get(sid);
      expect(s, `源 ${sid} 应在 data-health`).toBeTruthy();
      expect((s!.objectCount ?? 0) > 0, `源 ${sid} objectCount 应>0（非0真对象）`).toBe(true);
      expect((s!.members ?? []).length, `源 ${sid} 应有归因类型`).toBeGreaterThan(0);
      // 归因键须与权威表一致（非伪造塞入）
      for (const m of s!.members ?? []) {
        expect(TYPE_SOURCE_SYSTEM[m.typeKey], `${m.typeKey} 归因应为 ${sid}`).toBe(sid);
        expect(m.count, `${m.typeKey} 实例数应>0`).toBeGreaterThan(0);
      }
    }
  });

  it("LIMS 无物化对象类型 → 诚实空(objectCount 0/无 members)，不伪造", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const { sources } = await fetchHealth(t);
    const lims = sources.find((s) => s.connId === "lims");
    expect(lims, "lims 源仍在监控列表").toBeTruthy();
    expect(lims!.objectCount ?? 0).toBe(0);
    expect((lims!.members ?? []).length).toBe(0);
  });

  it("逐源对象数 = 该源归因类型真实实例数之和（无虚增）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const { sources } = await fetchHealth(t);
    for (const s of sources) {
      const sum = (s.members ?? []).reduce((a, m) => a + m.count, 0);
      expect(s.objectCount ?? 0, `${s.connId} objectCount 应=成员实例和`).toBe(sum);
    }
  });
});
