import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
import { BASE_REGISTRY, type InterBaseTransfer } from "@platform/contracts";
import { baseDistanceKm, cellSourceMap, BATTERY_SOLVER_PARAMS } from "../src/synthetic/battery.js";

/**
 * WO-GSIM-1-DATA · 全域模拟数据半 SEAM 接缝驱动组合测试（头号判据·驱动接缝非各半绿）。
 *
 * 三处病根（数据半）：
 *  - G-TRANSIT-NOT-GEO：跨基地在途天数此前是哈希常量（`2 + floor(h/46)%12`）——与地理距离无关，改基地坐标不动。
 *  - G-NO-FREIGHT-COST：调拨无运费字段——跨基地经济性不可推演。
 *  - G-CELL-PACK-2STAGE（数据半）：电芯→电池包两段制无「PACK 厂由哪些芯厂就近供芯」的可查事实。
 *
 * SEAM 证据 = 距离/运费/供芯**真咬**：改距离→天数真变、运费随距离/量变、供芯图就近排序读真 Base 坐标。
 */

const ibp = BATTERY_SOLVER_PARAMS.interbase as { dailyTruckKm: number; minTransitDays: number; tonKmRate: number; qtyToTon: number };
const expectedTransitDays = (from: string, to: string): number =>
  Math.max(ibp.minTransitDays, Math.ceil(baseDistanceKm(from, to) / ibp.dailyTruckKm));
const expectedFreight = (from: string, to: string, qty: number): number =>
  Math.round(baseDistanceKm(from, to) * ibp.tonKmRate * (qty * ibp.qtyToTon));

async function readTransfers(t: TestApp): Promise<InterBaseTransfer[]> {
  const objs = await t.repos.objects.listByType("demo", "InterBaseTransfer");
  return objs.map((o) => o.props as unknown as InterBaseTransfer);
}
const factoryType = (b: { kind: string }): string =>
  b.kind === "动力+储能" ? "CELL+PACK" : b.kind === "动力" ? "CELL" : "PACK";
const basesForCellMap = () => BASE_REGISTRY.map((b) => ({ baseId: b.baseId, factory_type: factoryType(b) }));

describe("WO-GSIM-1-DATA · 全域模拟数据半（距离派生在途 + 运费 + 供芯图·SEAM 真咬）", () => {
  it("SEAM-1 距离真咬：在途天数 = ceil(baseDistanceKm/dailyTruckKm)（非哈希常量）——近基地天数少、远基地天数多", async () => {
    // 纯距离层：近对 < 远对（哈希公式无此单调性 → 证读的是地理距离）。
    const nearKm = baseDistanceKm("changzhou", "hefei"); // ~252km
    const farKm = baseDistanceKm("changzhou", "handan"); // ~735km
    expect(farKm).toBeGreaterThan(nearKm);
    expect(expectedTransitDays("changzhou", "hefei")).toBeLessThan(expectedTransitDays("changzhou", "handan"));
    // 改「输入基地」= 改坐标：同起点换更远终点 → 天数真变大（灭 G-TRANSIT-NOT-GEO）。
    expect(baseDistanceKm("changzhou", "changzhou")).toBe(0);

    // 种子态每条真 Transfer 的 transitDays 严格等于距离派生值（而非旧哈希 2..13）。
    const t = await makeApp();
    await seedBattery(t);
    const rows = await readTransfers(t);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.transitDays).toBe(expectedTransitDays(r.fromBase, r.toBase)); // 距离派生·红咬（改公式即红）
      expect(r.transitDays).toBeGreaterThanOrEqual(ibp.minTransitDays);
      expect(r.etaDay).toBe(r.dispatchDay + r.transitDays); // etaDay 恒等保持
    }
  });

  it("SEAM-2 运费真咬：freightCost = 距离×费率×(量×吨/套)——随距离/量变，同基地=0", async () => {
    // 同基地 距=0 → 费=0；跨基地远>近·量大>量小（严格单调 → 证真依赖距离与量）。
    expect(expectedFreight("changzhou", "changzhou", 3000)).toBe(0);
    expect(expectedFreight("changzhou", "handan", 3000)).toBeGreaterThan(expectedFreight("changzhou", "hefei", 3000));
    expect(expectedFreight("changzhou", "handan", 5000)).toBeGreaterThan(expectedFreight("changzhou", "handan", 1000));

    const t = await makeApp();
    await seedBattery(t);
    const rows = await readTransfers(t);
    for (const r of rows) {
      expect(typeof r.freightCost).toBe("number");
      expect(r.freightCost).toBe(expectedFreight(r.fromBase, r.toBase, r.qty)); // 红咬：改费率/公式即红
      expect(r.freightCost!).toBeGreaterThan(0); // 跨基地真调拨（from≠to）→ 距>0 → 费>0
    }
  });

  it("SEAM-3 供芯真咬：cellSourceMap[PACK 基地] 就近排序（含最近芯厂 hefei/changzhou）·读真 Base 坐标", async () => {
    const cs = cellSourceMap(basesForCellMap());
    // 5 纯 PACK 基地各有供芯集。
    expect(Object.keys(cs).sort()).toEqual(["handan", "jiangmen", "meishan", "xinyang", "yangzhou"]);
    const handan = cs["handan"]!;
    // 含最近若干芯厂（hefei/changzhou 均在集内）。
    expect(handan).toContain("hefei");
    expect(handan).toContain("changzhou");
    // 就近排序：逐位距离非降（改坐标即重排 → 证读真距离而非硬编码顺序）。
    for (let i = 1; i < handan.length; i++) {
      expect(baseDistanceKm("handan", handan[i]!)).toBeGreaterThanOrEqual(baseDistanceKm("handan", handan[i - 1]!));
    }
    // 首选 = 真最近芯厂（自洽于 baseDistanceKm）。
    const trueNearest = handan.slice().sort((a, b) => baseDistanceKm("handan", a) - baseDistanceKm("handan", b))[0];
    expect(handan[0]).toBe(trueNearest);
  });

  it("SEAM-3b 供芯物料真咬：种子含 PACK 基地入向 CELL→PACK 就近供芯真 Transfer（fromBase=就近芯厂→toBase=PACK 厂）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const rows = await readTransfers(t);
    const cs = cellSourceMap(basesForCellMap());
    const packById = new Map(BASE_REGISTRY.map((b) => [b.baseId, factoryType(b)]));
    // handan（PACK）入向就近芯厂供芯行存在，fromBase 属 CELL/CELL+PACK 且为 handan 供芯集首选。
    const handanInbound = rows.filter((r) => r.toBase === "handan" && r.transferId.startsWith("XFER-CELL-"));
    expect(handanInbound.length).toBeGreaterThan(0);
    for (const r of handanInbound) {
      expect(packById.get(r.toBase)).toBe("PACK");
      expect(["CELL", "CELL+PACK"]).toContain(packById.get(r.fromBase));
      expect(r.fromBase).toBe(cs["handan"]![0]); // 就近首选芯厂（供芯图×调拨事实 接缝闭合）
    }
  });

  it("SEAM-4 线级可读：每 base×line 的 Line.capacityDaily 逐线可读（非仅基地聚合）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const lines = (await t.repos.objects.listByType("demo", "Line")).map((o) => o.props as Record<string, unknown>);
    expect(lines.length).toBeGreaterThan(0);
    const byBase = new Map<string, Record<string, unknown>[]>();
    for (const l of lines) {
      // 逐条 Line 携本行 capacityDaily（套/日·数值·>0）——线级一等可读。
      expect(typeof l.capacityDaily).toBe("number");
      expect(l.capacityDaily as number).toBeGreaterThan(0);
      expect(typeof l.lineId).toBe("string");
      const bid = String(l.baseId);
      (byBase.get(bid) ?? byBase.set(bid, []).get(bid)!).push(l);
    }
    // 存在同基地多线（证 base×line 粒度 · 非仅基地聚合口径）。
    const multiLineBase = [...byBase.values()].find((v) => v.length > 1);
    expect(multiLineBase).toBeTruthy();
    // 每条线各带自身 capacityDaily（逐线可读）。
    for (const l of multiLineBase!) expect(typeof l.capacityDaily).toBe("number");
  });

  it("SEAM-5 R6：同 seed 两跑 → transitDays/freightCost 字节一致（距离派生·无 rng/时钟）", async () => {
    const run = async () => {
      const t = await makeApp();
      await seedBattery(t, 42);
      return (await readTransfers(t))
        .map((x) => `${x.transferId}|${x.transitDays}|${x.freightCost}`)
        .sort();
    };
    const a = await run();
    const b = await run();
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });
});
