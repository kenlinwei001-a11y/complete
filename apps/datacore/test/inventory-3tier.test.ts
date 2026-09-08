import { describe, expect, it } from "vitest";
import { makeApp, seedBattery } from "./helpers.js";
import { deriveFinishedGoodsIntake, generateBattery } from "../src/synthetic/battery.js";

/**
 * WO-INVENTORY-3TIER · 库存三层闭环 SEAM 组合测（头号判据·数据整半一 dev 做）。
 *
 * 三层闭环：WIP(WIPLot) → 完工入库事务(InventoryTxn RECEIPT) → 成品库存(FinishedGoodsInventory)。
 * 断言驱动三接缝端到端：完工源 WorkOrder → RECEIPT 流水 → FG 聚合，改颗粒 qtyActual 红咬。
 */
describe("WO-INVENTORY-3TIER · 库存三层闭环（完工入库 WIP→事务→成品库存）", () => {
  // ---- 纯派生（KILL-MOCK-RED·改颗粒→FG 必变，最紧红咬）----
  const WH = new Map([["changzhou", "WH-changzhou-FINISHED"]]);
  const mkWo = (qtyActual: number, extra: Record<string, unknown> = {}) => ({
    woId: "WO-T1", moNo: "MO-T1", modelId: "4680-LFP", baseId: "changzhou", qtyActual, status: "已完成", endDate: "2026-06-20", ...extra,
  });

  it("SEAM-1 完工入库真增：完工 WorkOrder(qtyActual=Q) → RECEIPT qty=+Q woRef=WO 且 FG.qtyOnHand 恰增 Q", () => {
    const Q = 1234;
    const { finishedGoodsInv, inventoryTxns } = deriveFinishedGoodsIntake([mkWo(Q)], WH, "2026-06-10");
    // 事务：一条 RECEIPT，qty=+Q，woRef 溯源该工单
    expect(inventoryTxns.length).toBe(1);
    const tx = inventoryTxns[0]!;
    expect(tx.txnType).toBe("RECEIPT");
    expect(tx.qty).toBe(Q); // 入库为正
    expect(tx.woRef).toBe("WO-T1");
    expect(tx.toWarehouse).toBe("WH-changzhou-FINISHED");
    // FG：该 model×warehouse 一行，qtyOnHand 恰 = Q（端到端跨"完工源→事务→FG聚合"三接缝）
    expect(finishedGoodsInv.length).toBe(1);
    const fg = finishedGoodsInv[0]!;
    expect(fg.fgId).toBe(tx.fgRef);
    expect(fg.model).toBe("4680-LFP");
    expect(fg.warehouseId).toBe("WH-changzhou-FINISHED");
    expect(fg.qtyOnHand).toBe(Q);
  });

  it("SEAM-2 改颗粒→FG 必变（红咬·KILL-MOCK-RED）：qtyActual Q→Q' 重跑 → FG.qtyOnHand 与 RECEIPT.qty 同步变 Q'", () => {
    const a = deriveFinishedGoodsIntake([mkWo(1000)], WH, "2026-06-10");
    const b = deriveFinishedGoodsIntake([mkWo(1750)], WH, "2026-06-10");
    expect(a.finishedGoodsInv[0]!.qtyOnHand).toBe(1000);
    expect(a.inventoryTxns[0]!.qty).toBe(1000);
    // 改颗粒 → 两者同步变（若派生忽略 qtyActual/伪造常数即红）
    expect(b.finishedGoodsInv[0]!.qtyOnHand).toBe(1750);
    expect(b.inventoryTxns[0]!.qty).toBe(1750);
    expect(b.finishedGoodsInv[0]!.qtyOnHand).not.toBe(a.finishedGoodsInv[0]!.qtyOnHand);
  });

  it("未完工工单不入库（status 非完工 或 qtyActual<=0 → 无 RECEIPT/无 FG·诚实空）", () => {
    const notDone = deriveFinishedGoodsIntake([mkWo(1000, { status: "生产中" })], WH, "2026-06-10");
    expect(notDone.inventoryTxns.length).toBe(0);
    expect(notDone.finishedGoodsInv.length).toBe(0);
    const zeroQty = deriveFinishedGoodsIntake([mkWo(0)], WH, "2026-06-10");
    expect(zeroQty.inventoryTxns.length).toBe(0);
  });

  it("勾稽（纯派生）：同 model×warehouse 多完工单聚合 FG.qtyOnHand === ΣRECEIPT − ΣISSUE（本切片 ISSUE=0）", () => {
    const wos = [mkWo(500, { woId: "WO-A" }), mkWo(300, { woId: "WO-B" }), mkWo(200, { woId: "WO-C" })];
    const { finishedGoodsInv, inventoryTxns } = deriveFinishedGoodsIntake(wos, WH, "2026-06-10");
    expect(finishedGoodsInv.length).toBe(1); // 同 model×wh → 一行聚合
    const fg = finishedGoodsInv[0]!;
    const sumReceipt = inventoryTxns.filter((t) => t.txnType === "RECEIPT" && t.fgRef === fg.fgId).reduce((a, t) => a + Number(t.qty), 0);
    const sumIssue = inventoryTxns.filter((t) => t.txnType === "ISSUE" && t.fgRef === fg.fgId).reduce((a, t) => a + Number(t.qty), 0);
    expect(fg.qtyOnHand).toBe(sumReceipt - sumIssue);
    expect(fg.qtyOnHand).toBe(1000);
  });

  // ---- 端到端物化（真链路·SEAM-GATE：数据种绑定 × 材料化 × 派生 × 仓位解析）----
  it("SEAM 端到端·真物化：完工 WorkOrder → RECEIPT 流水 → FG 聚合 + FG 挂真成品仓（SEAM-3）+ 勾稽 + qtyAvailable 派生", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const workOrders = await t.repos.objects.listByType("demo", "WorkOrder");
    const fgs = await t.repos.objects.listByType("demo", "FinishedGoodsInventory");
    const txns = await t.repos.objects.listByType("demo", "InventoryTxn");
    // 病根闭合：Phase3 MES 层此前从不物化 → 现完工源 WorkOrder + FG + Txn 均落库
    expect(workOrders.length).toBeGreaterThan(0);
    expect(fgs.length).toBeGreaterThan(0);
    expect(txns.length).toBeGreaterThan(0);

    // SEAM-1 真：取一物化完工 WorkOrder → 其 RECEIPT 流水 qty===qtyActual、woRef 溯源
    const completed = workOrders.filter((w) => ["已完成", "已关闭"].includes(String(w.props.status)) && Number(w.props.qtyActual) > 0);
    expect(completed.length).toBeGreaterThan(0);
    const wo = completed[0]!;
    const woId = String(wo.props.woId);
    const receipt = txns.find((x) => x.props.txnType === "RECEIPT" && x.props.woRef === woId);
    expect(receipt).toBeTruthy();
    expect(Number(receipt!.props.qty)).toBe(Number(wo.props.qtyActual)); // 完工源→事务真增
    const fg = fgs.find((f) => f.props.fgId === receipt!.props.fgRef);
    expect(fg).toBeTruthy();

    // SEAM-3 FG 挂真仓位：FG.warehouseId 解析到 WO-WAREHOUSE 真 Warehouse（成品仓·不悬空）
    const wh = await t.repos.objects.get("demo", `obj_warehouse_${String(fg!.props.warehouseId)}`);
    expect(wh).toBeTruthy();
    expect(wh!.type).toBe("Warehouse");
    expect(wh!.props.whType).toBe("FINISHED");

    // 勾稽：每 FG 的 qtyOnHand === Σ其 RECEIPT − Σ其 ISSUE（精确）
    for (const f of fgs) {
      const fgId = f.props.fgId;
      const rc = txns.filter((x) => x.props.fgRef === fgId && x.props.txnType === "RECEIPT").reduce((a, x) => a + Number(x.props.qty), 0);
      const is = txns.filter((x) => x.props.fgRef === fgId && x.props.txnType === "ISSUE").reduce((a, x) => a + Number(x.props.qty), 0);
      expect(Number(f.props.qtyOnHand)).toBe(rc - is);
    }

    // qtyAvailable 派生（可用量口径 = qtyOnHand − qtyReserved）经 A4 派生管线物化进 props
    expect(Number(fg!.props.qtyAvailable)).toBe(Number(fg!.props.qtyOnHand) - Number(fg!.props.qtyReserved));

    // txn_from_wo 链路：完工入库溯源边存在（Txn → WorkOrder）
    const links = await t.repos.links.list("demo", (l) => l.type === "txn_from_wo");
    expect(links.length).toBe(txns.filter((x) => x.props.woRef).length);
  });

  it("R6 双跑：同 seed 两次 → FG/Txn id 集与 qty 字节一致", () => {
    const snap = (seed: number) => {
      const g = generateBattery(seed, "S");
      return {
        fg: g.finishedGoodsInv.map((f) => `${f.fgId}|${f.qtyOnHand}`).sort(),
        txn: g.inventoryTxns.map((tx) => `${tx.txnId}|${tx.qty}|${tx.woRef}`).sort(),
      };
    };
    const a = snap(42);
    const b = snap(42);
    expect(a.fg).toEqual(b.fg);
    expect(a.txn).toEqual(b.txn);
    expect(a.fg.length).toBeGreaterThan(0);
    expect(a.txn.length).toBeGreaterThan(0);
  });
});
