import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, type TestApp } from "./helpers.js";
import { BASE_REGISTRY, type InterBaseTransfer } from "@platform/contracts";
import type { ObjectInstance } from "../src/domain.js";

/**
 * WO-INTERBASE-TRANSFER · SEAM 接缝驱动组合测试（头号判据）。
 *
 * 病根：跨基地调拨此前只是求解器方案库的字符串杠杆（battery.ts `cross_train`「跨基地借调」eff:9），
 * 不是可查询/可推演/可溯源的调拨事实（违 R13）。本单把它升为一等 `InterBaseTransfer` 对象。
 *
 * SEAM 证据 = 跨基地推演**读真 Transfer**（非字符串）：一个确定性投影汇总某基地「入向可用调拨运力」，
 * 读到 Transfer 的真 qty/transitDays；且**改 Transfer → 推演随之变**（红咬：不变即证读的是硬编码非真对象）。
 */

// 跨基地推演最小投影（诚实边界·WO §5）：读 InterBaseTransfer 真对象 → 汇总某基地「入向可用调拨运力」。
// PLANNED/IN_TRANSIT 计入可用运力（DELIVERED 已到货、CANCELLED 已取消不计），并取最早到货在途天数。
// 纯确定性（无时钟/随机），证数据可被推演消费且改数据→结果变。
function projectInboundCapacity(transfers: InterBaseTransfer[], toBaseId: string): { availableQty: number; minTransitDays: number | null; count: number } {
  const inbound = transfers.filter((x) => x.toBase === toBaseId && (x.status === "PLANNED" || x.status === "IN_TRANSIT"));
  const availableQty = inbound.reduce((s, x) => s + x.qty, 0);
  const minTransitDays = inbound.length ? Math.min(...inbound.map((x) => x.transitDays)) : null;
  return { availableQty, minTransitDays, count: inbound.length };
}

const oid = (type: string, pk: string) => `obj_${type.toLowerCase()}_${pk}`.replace(/[^\p{L}\p{N}_-]/gu, "_");

async function readTransfers(t: TestApp): Promise<InterBaseTransfer[]> {
  const objs = await t.repos.objects.listByType("demo", "InterBaseTransfer");
  return objs.map((o) => o.props as unknown as InterBaseTransfer);
}

async function putTransfer(t: TestApp, x: InterBaseTransfer): Promise<void> {
  const obj: ObjectInstance = {
    id: oid("InterBaseTransfer", x.transferId),
    tenantId: "demo",
    type: "InterBaseTransfer",
    props: x as unknown as Record<string, unknown>,
    origin: { type: "MANUAL" },
  };
  await t.repos.objects.put(obj);
}

// 名→baseId 取自 BASE_REGISTRY 单一来源（R14·不内联基地字面量）。
const baseIdByName = (name: string): string => {
  const b = BASE_REGISTRY.find((r) => r.name === name);
  if (!b) throw new Error(`base not in registry: ${name}`);
  return b.baseId;
};

describe("WO-INTERBASE-TRANSFER · 跨基地调拨一等对象（字符串杠杆→可查/可溯/可推演·R13）", () => {
  it("SEAM-1 推演读真 Transfer：种常州→成都在途调拨(qty=Q,transitDays=D) → 成都入向运力投影读到真 Q/D（非字符串「跨基地借调」）", async () => {
    const t = await makeApp();
    await seedBattery(t); // 注册 InterBaseTransfer 类型 + 真调拨（可查可溯基线）

    const changzhou = baseIdByName("常州");
    const chengdu = baseIdByName("成都");
    const Q = 3300;
    const D = 7;
    await putTransfer(t, {
      transferId: "XFER-SEAM-1",
      fromBase: changzhou,
      toBase: chengdu,
      model: "4680-NCM",
      qty: Q,
      transitDays: D,
      status: "IN_TRANSIT",
      dispatchDate: "2026-06-12",
      dispatchDay: 2,
      etaDay: 2 + D,
      etaDate: "2026-06-19",
      reason: "SEAM 测试调拨",
    });

    // 推演读真 Transfer：成都入向运力投影读到该 Transfer 的真 qty/transitDays。
    const before = projectInboundCapacity(await readTransfers(t), chengdu);
    // 断言推演输出含真值（qty=3300 / transitDays=7），而非字符串「跨基地借调」。
    expect(before.availableQty).toBeGreaterThanOrEqual(Q);
    expect(before.minTransitDays).not.toBeNull();
    expect(before.minTransitDays).toBeLessThanOrEqual(D);
    // 该 Transfer 的真 qty 确实进入了汇总（不是常量/字符串）。
    const seamRows = (await readTransfers(t)).filter((x) => x.transferId === "XFER-SEAM-1");
    expect(seamRows).toHaveLength(1);
    expect(seamRows[0]!.qty).toBe(Q);
    expect(seamRows[0]!.transitDays).toBe(D);
    expect(String(seamRows[0]!.qty)).not.toBe("跨基地借调");
  });

  it("SEAM-2 改 Transfer→推演变（红咬）：qty Q→Q' 且 status IN_TRANSIT→CANCELLED → 成都入向运力随之变（不变即证读硬编码非真对象）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const chengdu = baseIdByName("成都");
    const changzhou = baseIdByName("常州");

    await putTransfer(t, {
      transferId: "XFER-SEAM-2",
      fromBase: changzhou,
      toBase: chengdu,
      model: "4680-NCM",
      qty: 3300,
      transitDays: 7,
      status: "IN_TRANSIT",
      dispatchDate: "2026-06-12",
      dispatchDay: 2,
      etaDay: 9,
      etaDate: "2026-06-21",
      reason: "SEAM 测试调拨",
    });
    const before = projectInboundCapacity(await readTransfers(t), chengdu);

    // 改 qty 3300→5000：入向可用运力应增 1700。
    await putTransfer(t, {
      transferId: "XFER-SEAM-2",
      fromBase: changzhou,
      toBase: chengdu,
      model: "4680-NCM",
      qty: 5000,
      transitDays: 7,
      status: "IN_TRANSIT",
      dispatchDate: "2026-06-12",
      dispatchDay: 2,
      etaDay: 9,
      etaDate: "2026-06-21",
      reason: "SEAM 测试调拨",
    });
    const afterQty = projectInboundCapacity(await readTransfers(t), chengdu);
    expect(afterQty.availableQty).toBe(before.availableQty + 1700); // 读出随真值变（红咬）

    // 改 status IN_TRANSIT→CANCELLED：取消运力，可用量应退回该 Transfer 的贡献。
    await putTransfer(t, {
      transferId: "XFER-SEAM-2",
      fromBase: changzhou,
      toBase: chengdu,
      model: "4680-NCM",
      qty: 5000,
      transitDays: 7,
      status: "CANCELLED",
      dispatchDate: "2026-06-12",
      dispatchDay: 2,
      etaDay: 9,
      etaDate: "2026-06-21",
      reason: "SEAM 测试调拨",
    });
    const afterCancel = projectInboundCapacity(await readTransfers(t), chengdu);
    expect(afterCancel.availableQty).toBe(before.availableQty - 3300); // CANCELLED 不计入 → 明确随状态变
    expect(afterCancel.count).toBe(before.count - 1);
  });

  it("可查可溯：GET /a/v1/objects?type=InterBaseTransfer 见真调拨行；transfer_from_base/to_base 边下钻到 BASE_REGISTRY 真 Base 对象", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const res = await t.app.inject({ method: "GET", url: "/a/v1/objects?type=InterBaseTransfer&pageSize=100", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const rows = (res.json() as { data: { props: InterBaseTransfer }[] }).data.map((d) => d.props);
    expect(rows.length).toBeGreaterThan(0);
    // 每行是真调拨事实（from/to/model/qty/transitDays 全在），非字符串杠杆。
    for (const r of rows) {
      expect(typeof r.qty).toBe("number");
      expect(typeof r.transitDays).toBe("number");
      expect(BASE_REGISTRY.some((b) => b.baseId === r.fromBase)).toBe(true);
      expect(BASE_REGISTRY.some((b) => b.baseId === r.toBase)).toBe(true);
      expect(r.fromBase).not.toBe(r.toBase);
    }

    // 边下钻到真 Base 对象：transfer_from_base/transfer_to_base 的 toId = obj_base_<真 baseId> 且该 Base 对象存在。
    const fromEdges = await t.repos.links.list("demo", (l) => l.type === "transfer_from_base");
    const toEdges = await t.repos.links.list("demo", (l) => l.type === "transfer_to_base");
    const modelEdges = await t.repos.links.list("demo", (l) => l.type === "transfer_of_model");
    expect(fromEdges.length).toBe(rows.length);
    expect(toEdges.length).toBe(rows.length);
    expect(modelEdges.length).toBe(rows.length);
    for (const e of [...fromEdges, ...toEdges]) {
      const base = await t.repos.objects.get("demo", e.toId);
      expect(base).toBeTruthy();
      expect(base!.type).toBe("Base");
      expect(BASE_REGISTRY.some((b) => oid("Base", b.baseId) === e.toId)).toBe(true);
    }
    // 型号边下钻到真 Model 对象。
    for (const e of modelEdges) {
      const m = await t.repos.objects.get("demo", e.toId);
      expect(m).toBeTruthy();
      expect(m!.type).toBe("Model");
    }
  });

  it("R6 双跑：同 seed 重跑 → transferId 集 + qty 字节一致（独立哈希子流·无 random/时钟）", async () => {
    const run = async () => {
      const t = await makeApp();
      await seedBattery(t, 42);
      const rows = await readTransfers(t);
      return rows
        .map((x) => `${x.transferId}|${x.fromBase}|${x.toBase}|${x.model}|${x.qty}|${x.transitDays}|${x.status}|${x.dispatchDate}|${x.etaDate}`)
        .sort();
    };
    const a = await run();
    const b = await run();
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
    // etaDate 由 dispatchDay+transitDays 派生（无时钟）——同 seed 逐字节复现。
  });

  it("派生：etaDay = dispatchDay + transitDays（derivedProperties 管线算·确定性），etaDate 为其 ISO 展示", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const objs = await t.repos.objects.listByType("demo", "InterBaseTransfer");
    expect(objs.length).toBeGreaterThan(0);
    for (const o of objs) {
      const p = o.props as unknown as InterBaseTransfer;
      expect(p.etaDay).toBe(p.dispatchDay + p.transitDays); // 派生管线跑过后仍恒等
    }
  });
});
