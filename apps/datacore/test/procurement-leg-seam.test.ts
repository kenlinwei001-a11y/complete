import { describe, expect, it } from "vitest";
import {
  PROCUREMENT_LEGS,
  ProcurementPlanSchema,
  procurementTotalDays,
  type ProcurementLeg,
  type ProcurementPlan,
} from "@platform/contracts";
import { invokeSolver, makeApp, seedBattery, type TestApp } from "./helpers.js";

/**
 * WO-SANDBOX-D2 · 采购段按责任方可分解 —— **接缝驱动组合测试**（SEAM-GATE）。
 *
 * 这个文件咬的**不是**函数，是链路：
 *
 *     合成种子（数据半）                        齐套判定（引擎半）
 *     Supplier.leadTime/transitDays/MOQ/准时率  ─┐
 *     CustomsClearance（仅进口单）              ─┼─▶ loadContext(withExtended)
 *     IncomingInspection（每单必检）            ─┘        │
 *                                                        ▼
 *                                      deriveExtendedArgs(kit_readiness)
 *                                                        │  四段凭证随 args 下发
 *                                                        ▼
 *                                            kitReadiness → 按责任方分解的最早齐套日
 *
 * 两半各自绿是没用的（"绿测试≠能用·断在接缝"）：本文件一律经真 HTTP 端点
 * `POST /a/v1/solvers/kit_readiness/invoke` 打**真种子数据**，args 传 `{}` 逼引擎自己去对象库取数。
 * 每一段的天数都反查回**真对象**核对（不是和一个写死的期望值比），所以引擎若改成"自己编一个数"，
 * 对不上就当场红。
 *
 * 本单要治的原病（实测复验结论见文件末尾注）：
 *  ① `Supplier.minOrderQty` / `onTimeRate` 在 `solvers/` **零消费方**（复验属实）→ 现真接线。
 *  ② 清关 / 到货检验 **全仓 0 承载**（复验属实：`grep -rni "customs|清关"` 与 `grep -rn "IQC|到货检验|来料检"`
 *     在 `apps/<app>/src packages/<pkg>/src` 各 0 命中）→ 现有一等对象承载。
 *  ③ 采购段耗时是**一个合成数字**（`Material.leadTime` 一个标量当 ETA 用）→ 现拆四段、每段有责任方。
 */

const ORDER_SHORT_ID = "obj_order_SO-0001";

/** 造一张**缺料订单**（数量大到必然缺料）——WO 交付判据的起点。 */
async function seedShortageOrder(t: TestApp, qty: number): Promise<void> {
  await t.repos.objects.put({
    id: ORDER_SHORT_ID, // id 排序靠前 → 落在 deriveExtendedArgs 取的前 8 单里
    tenantId: "demo",
    type: "Order",
    props: { so: "SO-0001", cust: "缺料压测客户", model: "4680-NCM", qty, due: "2026-09-01", status: "OPEN" },
    origin: { type: "SYNTHETIC" },
  });
}

interface ShortItem {
  material: string;
  shortage: number;
  coveringEtaDay: number | null;
  procurement?: ProcurementPlan;
  ownerDays?: { days: Record<string, number>; unknownOwners: string[] };
  criticalLeg?: { leg: string; owner: string; ownerRef: string | null; days: number | null } | null;
}
interface KitRow {
  orderId: string;
  kitRatio: number;
  shortItems: ShortItem[];
  earliestKitDay: number | null;
  earliestKitDayStatus: string;
  earliestKitDayReason?: string;
}

const runKit = async (t: TestApp): Promise<KitRow[]> => {
  const res = await invokeSolver(t, "kit_readiness", {});
  expect(res.statusCode).toBe(200);
  return (res.json().data as { rows: KitRow[] }).rows;
};

const legOf = (p: ProcurementPlan, leg: (typeof PROCUREMENT_LEGS)[number]): ProcurementLeg => {
  const l = p.leadTime.legs.find((x) => x.leg === leg);
  expect(l, `采购段缺 leg=${leg}`).toBeDefined();
  return l!;
};

/** 从对象库读回真值（断言不跟写死的期望值比，跟**数据半的真对象**比 → 接缝真被驱动）。 */
const propsOfType = async (t: TestApp, type: string): Promise<Record<string, unknown>[]> =>
  (await t.repos.objects.listByType("demo", type)).map((o) => o.props as Record<string, unknown>);

describe("WO-SANDBOX-D2 · SEAM：缺料订单 → 按责任方分解的最早齐套日（数据半 × 引擎半）", () => {
  it("① 四段齐全、四个不同责任方、每段天数反查真对象对得上；总耗时==四段之和", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedShortageOrder(t, 90000);

    const rows = await runKit(t);
    const row = rows.find((r) => r.orderId === "SO-0001");
    expect(row, "缺料订单没进齐套判定 → 接缝断了").toBeDefined();
    expect(row!.kitRatio).toBeLessThan(1); // 确实缺料
    expect(row!.shortItems.length).toBeGreaterThan(0);

    // 取进口物料那一项（清关段唯一能走到实测分支的路）
    const imported = row!.shortItems.find((s) => s.material === "elyte");
    expect(imported?.procurement, "缺料项没有采购段分解 → 又退回'一个合成数字'").toBeDefined();
    const plan = imported!.procurement!;

    // —— 契约层硬校验：四段齐全 + totalDays 硬绑四段之和（"合成一个数"在这里就过不去）——
    expect(() => ProcurementPlanSchema.parse(plan)).not.toThrow();
    expect(plan.leadTime.legs.length).toBe(4);
    expect(plan.leadTime.legs.map((l) => l.leg).sort()).toEqual([...PROCUREMENT_LEGS].sort());

    // —— 责任方四个各不相同（"不知道该找谁"的正面答案）——
    const owners = plan.leadTime.legs.map((l) => l.owner);
    expect(new Set(owners).size).toBe(4);
    expect(owners.sort()).toEqual(["CARRIER", "CUSTOMS_BROKER", "QUALITY_IQC", "SUPPLIER"]);

    // —— 每段反查真对象 ——
    const suppliers = await propsOfType(t, "Supplier");
    const sup = suppliers.find((s) => s.supplierId === plan.supplierId)!;
    expect(sup, "采购计划指的供应商在对象库里不存在").toBeTruthy();

    const prod = legOf(plan, "supplier_production");
    expect(prod.status).toBe("MEASURED");
    expect(prod.days).toBe(sup.leadTime); // ← 真读 Supplier.leadTime，不是引擎自造
    expect(prod.ownerRef).toBe(sup.name);
    expect(prod.source?.objectType).toBe("Supplier");

    const transit = legOf(plan, "in_transit");
    expect(transit.status).toBe("MEASURED");
    expect(transit.days).toBe(sup.transitDays);
    expect(transit.ownerRef).toBe(sup.carrierName); // 承运方 = 在途段的责任方

    const customs = legOf(plan, "customs");
    expect(sup.sourceMode).toBe("进口");
    expect(customs.status).toBe("MEASURED");
    const ccRows = (await propsOfType(t, "CustomsClearance")).filter((c) => c.supplierId === plan.supplierId);
    expect(ccRows.length).toBeGreaterThan(0);
    const ccMean = ccRows.reduce((s, c) => s + (Number(c.clearedDay) - Number(c.declaredDay)), 0) / ccRows.length;
    expect(customs.days).toBeCloseTo(ccMean, 6); // ← 真读 CustomsClearance 记录
    expect(customs.ownerRef).toBe(ccRows[0]!.brokerName); // 清关行 = 清关段的责任方
    expect(customs.source?.objectType).toBe("CustomsClearance");
    expect(customs.source!.objectIds.length).toBe(ccRows.length);

    const iqc = legOf(plan, "incoming_inspection");
    expect(iqc.status).toBe("MEASURED");
    const iqcRows = (await propsOfType(t, "IncomingInspection")).filter((x) => x.matId === "elyte");
    expect(iqcRows.length).toBeGreaterThan(0);
    const iqcMean = iqcRows.reduce((s, x) => s + (Number(x.releasedDay) - Number(x.arrivedDay)), 0) / iqcRows.length;
    expect(iqc.days).toBeCloseTo(iqcMean, 1); // 引擎侧 round(...,2)
    expect(iqc.ownerRef).toBe(iqcRows[0]!.inspectorTeam); // 检验班组 = 检验段的责任方

    // —— 四段之和 == 总耗时；最早齐套日 == 起采日 + 总耗时（不是另编一个数）——
    const sum = plan.leadTime.legs.reduce((s, l) => s + (l.days ?? 0), 0);
    expect(plan.leadTime.totalDays).toBeCloseTo(sum, 6);
    expect(procurementTotalDays(plan.leadTime.legs)).toBeCloseTo(sum, 6);
    expect(plan.earliestKitDay).toBeCloseTo(plan.orderPlacedDay + sum, 6);

    // —— 责任方分解可用：谁占多少 + 最该找谁 ——
    expect(imported!.ownerDays!.unknownOwners).toEqual([]);
    expect(Object.keys(imported!.ownerDays!.days).sort()).toEqual(["CARRIER", "CUSTOMS_BROKER", "QUALITY_IQC", "SUPPLIER"]);
    const maxLeg = plan.leadTime.legs.reduce((a, b) => ((b.days ?? -1) > (a.days ?? -1) ? b : a));
    expect(imported!.criticalLeg!.owner).toBe(maxLeg.owner);
    expect(imported!.criticalLeg!.days).toBe(maxLeg.days);

    // —— 整单最早齐套日是**真的分解出来的**，不是一个合成数字 ——
    expect(row!.earliestKitDayStatus).toBe("MEASURED");
    expect(typeof row!.earliestKitDay).toBe("number");
  });

  it("② 三态诚实：境内直供 → 清关 NOT_APPLICABLE（真值 0，有据可依），不是 EMPTY 也不是假的 0", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedShortageOrder(t, 90000);
    const rows = await runKit(t);
    const row = rows.find((r) => r.orderId === "SO-0001")!;

    const suppliers = await propsOfType(t, "Supplier");
    const domestic = row.shortItems.filter((s) => {
      const sup = suppliers.find((x) => x.supplierId === s.procurement?.supplierId);
      return sup !== undefined && sup.sourceMode !== "进口";
    });
    expect(domestic.length, "样本里没有境内直供物料 → 三态分不出来").toBeGreaterThan(0);

    for (const item of domestic) {
      const customs = legOf(item.procurement!, "customs");
      expect(customs.status).toBe("NOT_APPLICABLE");
      expect(customs.days).toBe(0); // 结构上没有这个环节 = 真值 0
      expect(customs.source).toBeNull(); // 没读到任何凭证就别装作读到了
      expect(customs.reason).toMatch(/境内直供/);
      // 其余三段仍必须实测（境内不等于没有采购段）
      expect(legOf(item.procurement!, "supplier_production").status).toBe("MEASURED");
      expect(legOf(item.procurement!, "in_transit").status).toBe("MEASURED");
      expect(legOf(item.procurement!, "incoming_inspection").status).toBe("MEASURED");
      // NOT_APPLICABLE 计 0 是合法的 → 总数仍可结算
      expect(item.procurement!.leadTime.complete).toBe(true);
    }

    // 同一张单里既有 NOT_APPLICABLE 又有 MEASURED 的清关段 → 证明是**逐路由真判**，不是全局开关
    const measuredCustoms = row.shortItems.filter((s) => s.procurement !== undefined && legOf(s.procurement, "customs").status === "MEASURED");
    expect(measuredCustoms.length).toBeGreaterThan(0);
  });

  it("③ 取不到真值一律 EMPTY：无据物料 → 四段全 null，整单最早齐套日诚实缺席（不拿已知段之和冒充）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedShortageOrder(t, 90000);
    // 一个"什么凭证都没有"的物料：主供指向不存在的供应商、无任何到货检验记录。
    // id 排序最靠前 → 必进 deriveExtendedArgs 取的物料集。
    await t.repos.objects.put({
      id: "obj_material_aa_orphan",
      tenantId: "demo",
      type: "Material",
      props: { matId: "aa_orphan", name: "无凭证物料", bomUnit: 1, onHand: 0, inTransit: 0, leadTime: 10, supplierId: "SUP-999" },
      origin: { type: "SYNTHETIC" },
    });

    const rows = await runKit(t);
    const row = rows.find((r) => r.orderId === "SO-0001")!;
    const orphan = row.shortItems.find((s) => s.material === "aa_orphan");
    expect(orphan?.procurement, "无凭证物料没进缺料项 → 造不出 EMPTY 场景").toBeDefined();
    const plan = orphan!.procurement!;

    // 四段全 EMPTY：days 全 null（**一个 0 都不许出现**），每段都说清缺什么
    for (const leg of PROCUREMENT_LEGS) {
      const l = legOf(plan, leg);
      expect(l.status, `${leg} 应为 EMPTY`).toBe("EMPTY");
      expect(l.days, `${leg} 的 days 必须为 null，出现 0 即"假默认值"`).toBeNull();
      expect(l.source).toBeNull();
      expect(l.reason).toBeTruthy();
    }
    expect(plan.leadTime.totalDays).toBeNull();
    expect(plan.leadTime.complete).toBe(false);
    expect(plan.earliestKitDay).toBeNull();
    expect(plan.expectedKitDay).toBeNull();
    // MOQ/准时率取不到 → 也一律 null，不给缺口当采购量
    expect(plan.minOrderQty).toBeNull();
    expect(plan.replenishQty).toBeNull();
    expect(plan.onTimeRate).toBeNull();
    expect(plan.expectedSlipDays).toBeNull();
    // 契约层同样接受"诚实缺席"（EMPTY 不是校验失败，是合法状态）
    expect(() => ProcurementPlanSchema.parse(plan)).not.toThrow();

    // 整单：有一项算不出 → 整单诚实 EMPTY + 说清是哪个物料，**不拿其余物料的日子冒充**
    expect(row.earliestKitDayStatus).toBe("EMPTY");
    expect(row.earliestKitDay).toBeNull();
    expect(row.earliestKitDayReason).toMatch(/aa_orphan/);
  });

  it("④ minOrderQty / onTimeRate 真接线（此前 solvers/ 零消费方）：MOQ 抬高采购量、准时率产出期望滑期", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 缺口小于起订量的场景（用种子自带订单即可：elyte 缺口 ~750 < MOQ 2500）
    const rows = await runKit(t);
    const suppliers = await propsOfType(t, "Supplier");

    let moqCases = 0;
    let slipCases = 0;
    for (const row of rows) {
      for (const item of row.shortItems) {
        const plan = item.procurement;
        if (plan === undefined || plan.supplierId === null) continue;
        const sup = suppliers.find((s) => s.supplierId === plan.supplierId)!;

        // MOQ：值必须**等于对象库里那家供应商的 minOrderQty**（不是某个常数）
        expect(plan.minOrderQty).toBe(sup.minOrderQty);
        expect(plan.replenishQty).toBe(Math.max(plan.shortage, Number(sup.minOrderQty)));
        expect(plan.moqApplied).toBe(Number(sup.minOrderQty) > plan.shortage);
        if (plan.moqApplied) {
          moqCases++;
          // 起订量真抬高了采购量：只缺这么点，却得买这么多
          expect(plan.replenishQty).toBe(sup.minOrderQty);
          expect(plan.replenishQty!).toBeGreaterThan(plan.shortage);
        }

        // 准时率：值必须等于对象库里的 onTimeRate，且期望滑期 = 供应商段 × (1−准时率)
        expect(plan.onTimeRate).toBe(sup.onTimeRate);
        const prodDays = legOf(plan, "supplier_production").days!;
        expect(plan.expectedSlipDays).toBeCloseTo(prodDays * (1 - Number(sup.onTimeRate)), 4);
        expect(plan.expectedKitDay).toBeCloseTo(plan.earliestKitDay! + plan.expectedSlipDays!, 4);
        if (Number(sup.onTimeRate) < 1) {
          slipCases++;
          // 不准时的供应商 → 期望齐套日必须晚于承诺齐套日（不是把风险偷偷揉进一个数）
          expect(plan.expectedKitDay!).toBeGreaterThan(plan.earliestKitDay!);
        }
      }
    }
    expect(moqCases, "没有任何一项触发 MOQ → 起订量接线没被真驱动").toBeGreaterThan(0);
    expect(slipCases, "没有任何一项触发准时率滑期 → 准时率接线没被真驱动").toBeGreaterThan(0);
  });

  it("⑤ R6 确定性：同 seed 重跑，采购段四段分解逐字节一致", async () => {
    const run = async () => {
      const t = await makeApp();
      await seedBattery(t, 42);
      await seedShortageOrder(t, 90000);
      const rows = await runKit(t);
      return JSON.stringify(rows.find((r) => r.orderId === "SO-0001")!.shortItems.map((s) => s.procurement));
    };
    expect(await run()).toBe(await run());
  });
});

/**
 * ── 与 WO 文档不符 / 已复验的实测事实（铁律 0.5：grep 只是线索）──────────────────
 *
 * ① 「`minOrderQty` 与 `onTimeRate` 在 `solvers/` 今天 0 消费方」→ **属实，但不是"死代码"**。
 *    追一层后：两者**在合成数据侧有真消费方**（`synthetic/battery-extended.ts:600/604`
 *    `contracted = CATHODE_CONTRACT[id] ?? minOrderQty*4`、`actualSupplyTon = contracted*onTimeRate`），
 *    另有 `decision/record-materialize.ts:80` 的字段映射。所以形态是**"接了线接错地方"**
 *    （只喂了数据生成，没喂决策引擎），不是"没接线"。
 *    **结构性原因**（本单一并修掉）：`SolverContext` 里**压根没有 `suppliers` 字段** ——
 *    引擎不是"不想读"，是拿不到这张表。故本单先补 `SolverContext.suppliers` + `loadContext` 加载。
 *    另注：`livedin/bundle.ts:114` 也有一个 `onTimeRate`，但那是**按已交付订单算的另一个指标**
 *    （同名不同物），与 `Supplier.onTimeRate` 无关，不算消费方。
 *
 * ② 「清关 / 到货检验全仓为 0、无任何承载」→ **属实**。改动前实测：
 *      grep -rni "customs|清关"        apps/<app>/src packages/<pkg>/src  → 0
 *      grep -rn  "IQC|到货检验|来料检" apps/<app>/src packages/<pkg>/src  → 0
 *    （`InspectionCharacteristic`/`InspectionResult` 是**产品质检**，不是来料检验，口径不同。）
 *
 * ③ 「采购段总耗时是一个合成数字」→ **属实且更糟**：`deriveExtendedArgs` 把
 *    `Material.leadTime`（`7 + rng()*21` 的标量）直接当在途批次 ETA 用
 *    （`inTransit: [{ qty, etaDay: num(m.leadTime, 10) }]`），即"物料前置期"被当成"这批货到货天"。
 *    顺带发现并修掉一处同族问题：原 `earliestDay` 取"最早到的那一批 ETA"而**不看它能不能补上缺口**
 *    （在途 1169 对缺口 68267 也报"顺延到那天"）→ 现按 ETA 累加，真够了才算（`coveringEtaDay`）。
 */
