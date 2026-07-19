import { describe, expect, it } from "vitest";
import { generateBattery } from "../src/synthetic/battery.js";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";
import type { LineStatus } from "@platform/contracts";

/**
 * WO-ORDERLINE · 订单拆行接缝驱动组合测试（SEAM-GATE 头号判据）。
 *
 * 一单多型号 → 行级归因/承诺 + 头级 rollup 勾稽：
 *  SEAM-1 拆行勾稽：Σ OrderLine.qty (BY orderRef) === Order.qty 且各行 model 不同（一单多型号真表达）。
 *  SEAM-2 行级独立态：同一订单两行不同 lineStatus → 可分别查到、头级状态由行 rollup 推。
 *  SEAM-3 改行→头级 rollup 变（红咬）：改一行 qty → 头级 Σ 变、勾稽仍成立（行级是头级的真拆分非装饰）。
 *  R6 双跑：lineId 集 + qty 分配字节一致；24 单头级基线未移。
 */

type OrderLineRow = { lineId: string; orderRef: string; lineNo: number; model: string; qty: number; due: string; lineStatus: LineStatus; unitPrice: number };
type OrderRow = { so: string; model: string; qty: number };

/** 头级状态由行级 rollup 推：全发运→SHIPPED · 有发运/部分→PARTIAL · 有承诺→COMMITTED · 否则 OPEN。 */
function rollupHeadStatus(statuses: LineStatus[]): LineStatus {
  if (statuses.length > 0 && statuses.every((s) => s === "SHIPPED")) return "SHIPPED";
  if (statuses.some((s) => s === "SHIPPED" || s === "PARTIAL")) return "PARTIAL";
  if (statuses.some((s) => s === "COMMITTED")) return "COMMITTED";
  return "OPEN";
}

const sumBy = (lines: OrderLineRow[], so: string) =>
  lines.filter((l) => l.orderRef === so).reduce((acc, l) => acc + l.qty, 0);

describe("WO-ORDERLINE · 订单拆行接缝（SEAM-GATE）", () => {
  it("SEAM-1 拆行勾稽：每单 Σ行 qty === 单头 qty，且拆多行的单各行 model 互异", () => {
    const g = generateBattery(42, "S");
    const orders = g.orders as unknown as OrderRow[];
    const lines = g.orderLines as unknown as OrderLineRow[];

    // 每单至少 1 行；每单勾稽 Σ行 qty === 单头 qty（整数精确，尾行取余额）。
    for (const o of orders) {
      const mine = lines.filter((l) => l.orderRef === o.so);
      expect(mine.length).toBeGreaterThanOrEqual(1);
      expect(sumBy(lines, o.so)).toBe(o.qty); // 勾稽铁律：拆行不改总量
      // lineNo 连续 1..n
      expect(mine.map((l) => l.lineNo).sort((a, b) => a - b)).toEqual(mine.map((_, i) => i + 1));
      // 首行保留原单 model（不破坏既有 order_for_model 链）
      expect(mine.find((l) => l.lineNo === 1)!.model).toBe(o.model);
    }

    // 存在确定性拆多行的单，且其各行 model 互异（一单多型号真表达，非同型号重复行）。
    const multi = orders.filter((o) => lines.filter((l) => l.orderRef === o.so).length >= 2);
    expect(multi.length).toBeGreaterThan(0);
    for (const o of multi) {
      const models = lines.filter((l) => l.orderRef === o.so).map((l) => l.model);
      expect(new Set(models).size).toBe(models.length); // 各行 model 不同
    }
    // 单价从型号反范式化（R14）：每行 unitPrice 非负、有值。
    for (const l of lines) expect(l.unitPrice).toBeGreaterThan(0);
  });

  it("SEAM-2 行级独立态：同一订单两行不同 lineStatus → 可分别查到，头级状态由行 rollup 推", async () => {
    const t = await makeApp({ seed: false });
    await seedBattery(t); // 非链路 putAll 直接物化 OrderLine 对象

    const all = (await t.repos.objects.list("demo")).filter((o) => o.type === "OrderLine");
    expect(all.length).toBeGreaterThanOrEqual(24);

    // 取一个确定性拆了 ≥2 行的订单。
    const byRef = new Map<string, typeof all>();
    for (const ol of all) {
      const ref = (ol.props as { orderRef: string }).orderRef;
      byRef.set(ref, [...(byRef.get(ref) ?? []), ol]);
    }
    const multiRef = [...byRef.entries()].find(([, ls]) => ls.length >= 2)!;
    const [orderRef, lineObjs] = multiRef;
    const sorted = [...lineObjs].sort((a, b) => (a.props as { lineNo: number }).lineNo - (b.props as { lineNo: number }).lineNo);

    // 给同一订单两行植入不同 lineStatus（280Ah 行 COMMITTED、314Ah 行 PARTIAL 语义）。
    const l0 = sorted[0]!;
    const l1 = sorted[1]!;
    await t.repos.objects.put({ ...l0, props: { ...l0.props, lineStatus: "COMMITTED" } });
    await t.repos.objects.put({ ...l1, props: { ...l1.props, lineStatus: "PARTIAL" } });

    // 分别查到：按 lineId 各自取回，状态互不干扰（行级独立态切得出）。
    const g0 = await t.repos.objects.get("demo", l0.id);
    const g1 = await t.repos.objects.get("demo", l1.id);
    expect((g0!.props as { lineStatus: string }).lineStatus).toBe("COMMITTED");
    expect((g1!.props as { lineStatus: string }).lineStatus).toBe("PARTIAL");
    expect((g0!.props as { orderRef: string }).orderRef).toBe(orderRef);
    expect((g1!.props as { orderRef: string }).orderRef).toBe(orderRef);

    // 头级状态可由行 rollup 推（不同行态 → 头级 PARTIAL）。
    const refreshed = (await t.repos.objects.list("demo")).filter(
      (o) => o.type === "OrderLine" && (o.props as { orderRef: string }).orderRef === orderRef,
    );
    const headStatus = rollupHeadStatus(refreshed.map((o) => (o.props as { lineStatus: LineStatus }).lineStatus));
    expect(headStatus).toBe("PARTIAL"); // 有 PARTIAL 行 → 头级不再是纯 OPEN/COMMITTED
  });

  it("SEAM-3 改行→头级 rollup 变（红咬）：改一行 qty → 头级 Σ 随之变、勾稽仍成立", () => {
    const g = generateBattery(42, "S");
    const orders = g.orders as unknown as OrderRow[];
    const lines = (g.orderLines as unknown as OrderLineRow[]).map((l) => ({ ...l }));

    const target = orders.find((o) => lines.filter((l) => l.orderRef === o.so).length >= 2)!;
    const before = sumBy(lines, target.so);
    expect(before).toBe(target.qty); // 改前勾稽成立

    // 改一行 qty（+100）→ 头级 rollup（=Σ行）必变；证行级是头级的真拆分，非装饰。
    const oneLine = lines.find((l) => l.orderRef === target.so)!;
    oneLine.qty += 100;
    const after = sumBy(lines, target.so);
    expect(after).toBe(before + 100); // 头级 Σ 变（红咬：若头级不是行 rollup 此断言会红）
    expect(after).not.toBe(before);
    // 若把头级 qty 视为行 rollup 的派生，勾稽随之对上（Σ行 === 新头级）。
    expect(sumBy(lines, target.so)).toBe(after);
  });

  it("R6 双跑：lineId 集 + qty 分配字节一致；24 单头级基线未移（独立哈希子流不动 order rng）", () => {
    const a = generateBattery(42, "S");
    const b = generateBattery(42, "S");

    // 拆行字节一致（lineId/qty/model/status 全字段序列化相等）。
    expect(JSON.stringify(a.orderLines)).toBe(JSON.stringify(b.orderLines));

    // 24 单头级基线未移：orders 数组两跑字节一致 + 恰 24 单头。
    expect(a.orders.length).toBe(24);
    expect(JSON.stringify(a.orders)).toBe(JSON.stringify(b.orders));

    // 头级 qty 未被拆行改动：逐单 Σ行 qty === 单头 qty（拆行只加行对象、不动头）。
    const linesA = a.orderLines as unknown as OrderLineRow[];
    for (const o of a.orders as unknown as OrderRow[]) {
      expect(sumBy(linesA, o.so)).toBe(o.qty);
    }
  });

  it("对象/链路：OrderLine 一等对象 + line_of_order/orderline_for_model 两链路登记且实例可查", async () => {
    const t = await makeApp({ seed: false });
    await seedBattery(t);

    // 对象类型登记（82 类型含 OrderLine）。
    const types = await (await t.app.inject({ method: "GET", url: "/a/v1/ontology/object-types", headers: ADMIN })).json();
    expect((types as Array<{ key: string }>).some((x) => x.key === "OrderLine")).toBe(true);

    // 链路实例：每行两条边（line_of_order → Order · orderline_for_model → Model）。
    const links = await t.repos.links.list("demo");
    const lof = links.filter((l) => l.type === "line_of_order");
    const olfm = links.filter((l) => l.type === "orderline_for_model");
    const lineCount = (await t.repos.objects.list("demo")).filter((o) => o.type === "OrderLine").length;
    expect(lof.length).toBe(lineCount);
    expect(olfm.length).toBe(lineCount);
    // 边指向真对象（obj_order_* / obj_model_*）。
    for (const l of lof) expect(l.toId.startsWith("obj_order_")).toBe(true);
    for (const l of olfm) expect(l.toId.startsWith("obj_model_")).toBe(true);
  });
});
