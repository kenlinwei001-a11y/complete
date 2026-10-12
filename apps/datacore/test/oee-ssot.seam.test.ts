import { describe, expect, it } from "vitest";
import { makeApp, seedBattery } from "./helpers.js";
import { round } from "../src/prng.js";
import { equipmentOee } from "../src/solvers/capacity.js";
import { PROP_DISPLAY_NAMES } from "../src/synthetic/battery.js";

/**
 * WO-OEE-UNIFY 接缝测试（仓主裁决 C：`EquipmentOEE` 日事实表当权威）。
 *
 * 端到端断言（`G-OEE-DUAL-TRUTH` 断点的闭合判据）：
 *  - 归一后「三套口径」算出的最差设备是**同一台**（裁决前：三台不同·两两最差10台重叠 0/0/1）；
 *  - `Equipment.oee_current` 只剩**一个写入方**（生成期事实表派生），时序聚合不再碰它；
 *  - 裁决前病根：`battery.ts` 播种期回填 `round(A×P×Q,3)` + `oee_daily_7d` 物化覆写，
 *    一个字段两个写入方、写两个不同定义的量。
 *
 * 变异反证（交单报告贴原文）：临时把 `oee_daily_7d` 规格加回 `BATTERY_TS_AGG_SPECS`
 * ⇒ S3 当场红（oee_current 被时序覆写）；临时把 S2 断言改成「最差设备两两不同」⇒ 红。
 */
const mean3 = (xs: number[]) => round(xs.reduce((a, b) => a + b, 0) / xs.length, 3);

describe("OEE SSOT seam（WO-OEE-UNIFY · 裁决 C）", () => {
  it("S1 单一出处：780/780 台 Equipment 四个 OEE 属性 === 其 EquipmentOEE 事实行 7 日均值", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const equips = await t.repos.objects.listByType("demo", "Equipment");
    const oeeRows = await t.repos.objects.listByType("demo", "EquipmentOEE");
    // 金丝雀（自证工具）：规模不符 ⇒ 工具坏了，不许报数
    expect(equips.length).toBe(780);
    expect(oeeRows.length).toBe(5460);

    const byEquip = new Map<string, { a: number; p: number; q: number; oee: number }[]>();
    for (const r of oeeRows) {
      const eid = String(r.props.equipId);
      if (!byEquip.has(eid)) byEquip.set(eid, []);
      byEquip.get(eid)!.push({
        a: Number(r.props.availability),
        p: Number(r.props.performance),
        q: Number(r.props.quality),
        oee: Number(r.props.oee),
      });
      // 事实行逐行自洽（round(,3) 截断容差）
      expect(Math.abs(Number(r.props.oee) - Number(r.props.availability) * Number(r.props.performance) * Number(r.props.quality))).toBeLessThanOrEqual(1e-3);
    }
    for (const e of equips) {
      const rows = byEquip.get(String(e.props.equipId))!;
      expect(rows.length).toBe(7);
      expect(e.props.oeeA).toBe(mean3(rows.map((r) => r.a)));
      expect(e.props.oeeP).toBe(mean3(rows.map((r) => r.p)));
      expect(e.props.oeeQ).toBe(mean3(rows.map((r) => r.q)));
      expect(e.props.oee_current).toBe(mean3(rows.map((r) => r.oee)));
    }
  });

  it("S2 端到端：三套口径算出的最差设备是同一台", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const equips = await t.repos.objects.listByType("demo", "Equipment");
    const oeeRows = await t.repos.objects.listByType("demo", "EquipmentOEE");
    expect(equips.length).toBe(780); // 金丝雀

    const factSum = new Map<string, { sum: number; n: number }>();
    for (const r of oeeRows) {
      const eid = String(r.props.equipId);
      const acc = factSum.get(eid) ?? { sum: 0, n: 0 };
      acc.sum += Number(r.props.oee);
      acc.n += 1;
      factSum.set(eid, acc);
    }
    const worstOf = (valueOf: (e: (typeof equips)[number]) => number) =>
      equips.reduce((worst, e) => (valueOf(e) < valueOf(worst) ? e : worst)).props.equipId;

    const worstNameplate = worstOf((e) => Number(e.props.oeeA) * Number(e.props.oeeP) * Number(e.props.oeeQ)); // 旧①
    const worstCurrent = worstOf((e) => Number(e.props.oee_current)); // 旧②的落点字段
    const worstFact = worstOf((e) => factSum.get(String(e.props.equipId))!.sum / factSum.get(String(e.props.equipId))!.n); // ③
    // 裁决 C 的闭合判据：同一台（裁决前三台不同）
    expect(worstNameplate).toBe(worstFact);
    expect(worstCurrent).toBe(worstFact);
  });

  it("S3 单一写入方：跑完全量时序聚合，oee_current 纹丝不动且无 TS_AGGREGATE provenance", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const before = new Map(
      (await t.repos.objects.listByType("demo", "Equipment")).map((e) => [String(e.props.equipId), e.props.oee_current]),
    );
    expect(before.size).toBe(780); // 金丝雀
    // 全量跑一遍所有存活 tsAgg 规格（oee_daily_7d 已不在其中——本断言正是守这条）
    await t.services.timeseries.runAggregation("demo");
    const specKeys = new Set((await t.repos.tsAggSpecs.list("demo")).map((s) => s.key));
    expect(specKeys.has("oee_daily_7d")).toBe(false);
    for (const e of await t.repos.objects.listByType("demo", "Equipment")) {
      const eid = String(e.props.equipId);
      expect(e.props.oee_current).toBe(before.get(eid));
      const prov = (e.props.__prov as Record<string, { source?: string }> | undefined)?.oee_current;
      expect(prov?.source ?? "SEED").not.toBe("TS_AGGREGATE");
    }
  });

  it("S4 产能链唯一出入口 equipmentOee() 与事实表同源：返回值 === oee_current === 事实行 7 日均值", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const equips = await t.repos.objects.listByType("demo", "Equipment");
    const oeeRows = await t.repos.objects.listByType("demo", "EquipmentOEE");
    expect(equips.length).toBe(780); // 金丝雀
    const factAvg = new Map<string, number>();
    for (const e of equips) {
      const rows = oeeRows.filter((r) => r.props.equipId === e.props.equipId);
      factAvg.set(String(e.props.equipId), mean3(rows.map((r) => Number(r.props.oee))));
    }
    for (const e of equips) {
      expect(equipmentOee(e.props)).toBe(e.props.oee_current);
      expect(equipmentOee(e.props)).toBe(factAvg.get(String(e.props.equipId)));
    }
  });

  it("S5 屏上标注：Equipment 四个 OEE displayName 全部标明「事实表7日均值」（含门看不见的运行时下发屏）", () => {
    for (const key of ["Equipment.oeeA", "Equipment.oeeP", "Equipment.oeeQ", "Equipment.oee_current"]) {
      expect(PROP_DISPLAY_NAMES[key], `${key} 的 displayName 必须带口径标注`).toContain("事实表7日均值");
    }
    // 综合值不得再挂原子名（裁决前的同屏混用：前三个乘起来 ≠ 第四个且无说明）
    expect(PROP_DISPLAY_NAMES["Equipment.oee_current"]).toContain("综合");
  });
});
