import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";

/**
 * WO-SANDBOX-TRUST-BADGE（S2·后端半·Dev-1）· 沙盘每数字 dataMode 透传 teeth。
 *
 * 纯透传既有诚信信号（不发明新档·不伪造 LIVE·KILL-MOCK-RED 同源）：
 *  · view-config.nodeObjectMode = 逐 (对象,变量) 诚信位（obj.origin 血缘 + C09 新鲜度派生）。
 *  · 合成对象（origin=SYNTHETIC）→ SYNTHETIC（不冒充 LIVE）——绿→红齿①。
 *  · 真对象（origin≠SYNTHETIC）→ LIVE；叠关键源滞后 → STALE（C09 同判据）——绿→红齿②③。
 *  · 关 sim.trust_badge → nodeObjectMode 缺席（view-config 字节一致·回退演练）。
 *  · R6：同 session 双跑逐位字节一致。
 */

const enableSim = (t: Awaited<ReturnType<typeof makeApp>>, trustBadge = true) =>
  t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true, "sim.certification": true, "sim.trust_badge": trustBadge } },
  });

type Cfg = {
  stateVars: string[];
  nodeObjectState: Record<string, Record<string, number>>;
  nodeObjectMode?: Record<string, Record<string, string>>;
};

const getCfg = async (t: Awaited<ReturnType<typeof makeApp>>): Promise<Cfg> =>
  (await (await t.app.inject({ method: "GET", url: "/a/v1/sim/view-config", headers: ADMIN })).json()) as Cfg;

/** 把第一个携带 stateVar `sv` 的对象 origin 翻成给定 type（模拟真接入/合成血缘切换）；返回该对象 id。 */
const flipOrigin = async (
  t: Awaited<ReturnType<typeof makeApp>>,
  sv: string,
  originType: string,
): Promise<string> => {
  for (const ty of await t.repos.ontologyTypes.list("demo")) {
    for (const o of await t.repos.objects.listByType("demo", ty.key)) {
      if (o.mergedInto) continue;
      const v = (o.props as Record<string, unknown>)[sv];
      if (typeof v === "number" && Number.isFinite(v)) {
        await t.repos.objects.put({ ...o, origin: { type: originType } });
        return o.id;
      }
    }
  }
  throw new Error(`no object carries ${sv}`);
};

const seeded = async () => {
  const t = await makeApp();
  await seedBattery(t);
  await seedDemoPropagationRules(t.repos);
  return t;
};

describe("WO-SANDBOX-TRUST-BADGE · 沙盘 dataMode 后端透传（teeth）", () => {
  it("齿①：合成租户全数字 → nodeObjectMode 逐位 SYNTHETIC（绝不冒充 LIVE）", async () => {
    const t = await seeded();
    await enableSim(t);
    const cfg = await getCfg(t);
    expect(cfg.nodeObjectMode).toBeDefined();
    const cells = Object.values(cfg.nodeObjectMode!).flatMap((r) => Object.values(r));
    expect(cells.length).toBeGreaterThan(0);
    // battery seed 全对象 origin=SYNTHETIC → 每一格 SYNTHETIC，零 LIVE（诚实血缘·不假标实测）。
    expect(cells.every((m) => m === "SYNTHETIC")).toBe(true);
    expect(cells.includes("LIVE")).toBe(false);
    // 逐格必对应 nodeObjectState 的真数值格（透传·非凭空造位）。
    for (const [objId, row] of Object.entries(cfg.nodeObjectMode!)) {
      for (const sv of Object.keys(row)) expect(typeof cfg.nodeObjectState[objId]?.[sv]).toBe("number");
    }
  });

  it("齿②：某对象翻成真接入 origin(MATERIALIZED) → 其格转 LIVE（真派生·非写死）", async () => {
    const t = await seeded();
    await enableSim(t);
    const before = await getCfg(t);
    expect(before.nodeObjectMode!).toBeDefined();
    const realId = await flipOrigin(t, "totalDemand", "MATERIALIZED");
    const after = await getCfg(t);
    // 翻真的对象：totalDemand 格从 SYNTHETIC → LIVE（源新鲜·真血缘）。
    expect(before.nodeObjectMode![realId]?.totalDemand).toBe("SYNTHETIC");
    expect(after.nodeObjectMode![realId]?.totalDemand).toBe("LIVE");
    // 其余合成对象仍 SYNTHETIC（未污染·逐对象独立派生）。
    const others = Object.entries(after.nodeObjectMode!).filter(([id]) => id !== realId).flatMap(([, r]) => Object.values(r));
    expect(others.every((m) => m === "SYNTHETIC")).toBe(true);
  });

  it("齿③：真对象 + 关键源 dataHealth.critical 滞后(C09) → 其格转 STALE", async () => {
    const t = await seeded();
    await enableSim(t);
    const realId = await flipOrigin(t, "totalDemand", "MATERIALIZED");
    // 造关键源滞后（C09 同判据：critical=true 且 lagHours>staleHours=2）。
    await t.repos.objects.put({ id: "dsh-stale", tenantId: "demo", type: "DataSourceHealth", props: { sourceId: "iot-x", name: "IoT", critical: true, lagHours: 9999 } });
    const cfg = await getCfg(t);
    // 真对象叠关键源滞后 → STALE（复用既有 C09 新鲜度判据·不新造）。
    expect(cfg.nodeObjectMode![realId]?.totalDemand).toBe("STALE");
  });

  it("关闸字节一致：sim.trust_badge OFF → view-config 无 nodeObjectMode（回退演练）", async () => {
    const t = await seeded();
    await enableSim(t, false); // trust_badge 关
    const off = await getCfg(t);
    expect(off.nodeObjectMode).toBeUndefined();
    // 开闸后 nodeObjectMode 出现，其余字段不变（additive·关闸零破坏）。
    await enableSim(t, true);
    const on = await getCfg(t);
    expect(on.nodeObjectMode).toBeDefined();
    expect(on.stateVars).toEqual(off.stateVars);
    expect(on.nodeObjectState).toEqual(off.nodeObjectState);
  });

  it("tick 响应带整体可信度汇总位 dataMode（worst-mode·合成→SYNTHETIC）+ R6 双跑一致", async () => {
    const t = await seeded();
    await enableSim(t);
    const cfg1 = await getCfg(t);
    const cfg2 = await getCfg(t);
    // R6：同输入双跑逐位字节一致。
    expect(cfg1.nodeObjectMode).toEqual(cfg2.nodeObjectMode);
    // /tick 汇总位 = 最不可信档（全合成 → SYNTHETIC·恒诚实不冒充整体 LIVE）。
    const sid = (await (await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot: cfg1.nodeObjectState } })).json()).id as string;
    const tick = await (await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } })).json();
    expect(tick.dataMode).toBe("SYNTHETIC");
  });
});
