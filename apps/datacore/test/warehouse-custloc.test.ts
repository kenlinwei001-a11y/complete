import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
import { BASE_REGISTRY } from "@platform/contracts";

// helpers.ADMIN 是 X-Debug-User 请求头对象（非 AuthCtx）；仓储直读用 tenantId 字符串 "demo"。
const TENANT = "demo";

/**
 * WO-WAREHOUSE-CUSTLOC · Phase1 地基接缝驱动组合测（SEAM-GATE 头号判据）。
 * 库存仓位（Warehouse.warehouseId）× 交付地理（CustomerLocation）落点，跨「合成种子 × 本体链路」两半。
 *  - SEAM-1：每基地成品仓齐（13 基地各 ≥1 FINISHED）+ warehouse_of_base 边解析到真 Base。
 *  - SEAM-2：库存可挂仓位（WO-INVENTORY 未落 → 退化断言 Warehouse 可被 warehouseId 引用解析）。
 *  - SEAM-3：交付读真地点（订单 Customer → custloc_of_customer → CustomerLocation 省市/交付地）。
 *  - R6：warehouseId/locId 集 + 省市字节一致；无内联基地字面量（BASE_REGISTRY 派生）。
 */
describe("WO-WAREHOUSE-CUSTLOC · 仓库/客户地点接缝驱动组合测", () => {
  const listByType = (t: TestApp, type: string) => t.repos.objects.listByType(TENANT, type);

  it("SEAM-1 · 每基地成品仓齐（13 基地各 ≥1 FINISHED）+ warehouse_of_base 解析真 Base", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const warehouses = await listByType(t, "Warehouse");
    expect(warehouses.length).toBeGreaterThan(0);

    // 覆盖 BASE_REGISTRY 全基地，每基地 ≥1 成品仓 FINISHED（漏一即红）
    for (const b of BASE_REGISTRY) {
      const finished = warehouses.filter((w) => w.props.baseId === b.baseId && w.props.whType === "FINISHED");
      expect(finished.length, `基地 ${b.baseId} 缺成品仓 FINISHED`).toBeGreaterThanOrEqual(1);
    }
    expect(BASE_REGISTRY.length).toBe(13);

    // warehouse_of_base 边：Base 1:N Warehouse（方向翻转），每条边解析到真 Base 与真 Warehouse
    const links = await t.repos.links.list(TENANT, (l) => l.type === "warehouse_of_base");
    expect(links.length).toBe(warehouses.length);
    for (const w of warehouses) {
      const edge = links.find((l) => l.toId === `obj_warehouse_${String(w.props.warehouseId)}`);
      expect(edge, `仓 ${String(w.props.warehouseId)} 无 warehouse_of_base 边`).toBeTruthy();
      const base = await t.repos.objects.get(TENANT, edge!.fromId);
      expect(base?.type).toBe("Base");
      expect(base!.props.baseId).toBe(w.props.baseId);
    }
  });

  it("SEAM-2 · 库存可挂仓位（Warehouse 对象可被 warehouseId 引用解析·退化断言）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const warehouses = await listByType(t, "Warehouse");
    // WO-INVENTORY 未落 → 退化断言：仓位可解析性（任一 warehouseId 能解析回真 Warehouse 对象 + 有容量单位）
    const anyWh = warehouses.find((w) => w.props.whType === "FINISHED")!;
    const warehouseId = String(anyWh.props.warehouseId);
    const resolved = await t.repos.objects.get(TENANT, `obj_warehouse_${warehouseId}`);
    expect(resolved?.type).toBe("Warehouse");
    expect(resolved!.props.warehouseId).toBe(warehouseId);
    expect(typeof resolved!.props.capacityUnits).toBe("number");
    // 成品仓供 FG 挂位：whType=FINISHED 存在
    expect(anyWh.props.whType).toBe("FINISHED");
  });

  it("SEAM-3 · 交付读真地点（订单 Customer → custloc_of_customer → CustomerLocation 省市/交付地）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const custLocs = await listByType(t, "CustomerLocation");
    expect(custLocs.length).toBeGreaterThan(0);

    // 取一订单 → order_of_customer → Customer
    const orderLinks = await t.repos.links.list(TENANT, (l) => l.type === "order_of_customer");
    expect(orderLinks.length).toBeGreaterThan(0);
    const custObjId = orderLinks[0]!.toId; // obj_customer_<custId>
    const cust = await t.repos.objects.get(TENANT, custObjId);
    expect(cust?.type).toBe("Customer");

    // Customer → custloc_of_customer（CustomerLocation → Customer 方向）→ 反查该客户交付地点
    const locLinks = await t.repos.links.list(TENANT, (l) => l.type === "custloc_of_customer" && l.toId === custObjId);
    expect(locLinks.length, "订单客户无交付地点").toBeGreaterThanOrEqual(1);
    const loc = await t.repos.objects.get(TENANT, locLinks[0]!.fromId);
    expect(loc?.type).toBe("CustomerLocation");
    // 断言可得真地点：省市/交付地/默认标记非空
    expect(String(loc!.props.province).length).toBeGreaterThan(0);
    expect(String(loc!.props.city).length).toBeGreaterThan(0);
    expect(String(loc!.props.address).length).toBeGreaterThan(0);
    expect(loc!.props.customerRef).toBe(cust!.props.custId);

    // 每客户至少一个 isDeliveryDefault 交付地（交付读默认地点可落）
    const custIds = new Set(custLocs.map((l) => String(l.props.customerRef)));
    for (const cid of custIds) {
      const defaults = custLocs.filter((l) => l.props.customerRef === cid && l.props.isDeliveryDefault === true);
      expect(defaults.length, `客户 ${cid} 无默认交付地`).toBeGreaterThanOrEqual(1);
    }
  });

  it("R6 · 同 seed 两跑：warehouseId/locId 集 + 省市字节一致；省市从 BASE_REGISTRY 派生（无内联基地字面量）", async () => {
    const snapshot = async () => {
      const t = await makeApp();
      await seedBattery(t);
      const wh = (await listByType(t, "Warehouse"))
        .map((w) => `${String(w.props.warehouseId)}|${String(w.props.province)}|${String(w.props.city)}|${String(w.props.whType)}`)
        .sort();
      const locs = (await listByType(t, "CustomerLocation"))
        .map((l) => `${String(l.props.locId)}|${String(l.props.province)}|${String(l.props.city)}`)
        .sort();
      return { wh, locs };
    };
    const a = await snapshot();
    const b = await snapshot();
    expect(a.wh).toEqual(b.wh);
    expect(a.locs).toEqual(b.locs);

    // 仓库省市从生成态 Base 派生（源 BASE_REGISTRY）：每仓省市 = 其所属 Base 的省市（单一来源，无内联）
    const t = await makeApp();
    await seedBattery(t);
    const warehouses = await listByType(t, "Warehouse");
    const bases = await listByType(t, "Base");
    const baseById = new Map(bases.map((x) => [String(x.props.baseId), x]));
    for (const w of warehouses) {
      const base = baseById.get(String(w.props.baseId))!;
      expect(w.props.province).toBe(base.props.province);
      expect(w.props.city).toBe(base.props.city);
    }
  });
});
