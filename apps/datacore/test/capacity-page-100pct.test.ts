import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";

/**
 * WO-CAPACITY-PAGE-100PCT · 「产能推演」页 100% 功能实证 LOOP —— 后端半接缝驱动组合测（SEAM-GATE）。
 *
 * 每条断言都是**效果层**（"结果因此不同" / "屏幕上那个数字会变"），不是运输层（"参数到达了"）。
 * 四条红咬对应四个亲手在真浏览器里复现出来的病：
 *   ① R1  8/8 基地卡「首要风险因子」全同 `瓶颈工序`（本基地真正的主瓶颈被排除 + 封顶值 tie-break 退化为数组序）
 *   ② R4  `base_capacity_outlook` 不认真实对象 id `obj_base_<id>` → 前瞻四线整块硬 404
 *   ③ 杠杆 `scopeObjectIds` 被 `discoverCapacityLevers` 整个丢弃 → 任何基地卡都返回常州的杠杆（逐字节相同）
 *   ④ `gap_attribution` 传 factorId 时把 baseId 一起丢掉 + 未知因子静默退化 → 点任一因子 chip 根因树整棵消失
 */
const ADMIN: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };

type Card = { base: string; baseId?: string; factor: string; peak: number; currentTightness?: { value: number; live: boolean } };
type RiskOut = { threshold: number; cards: Card[] };
type BnOut = { factors: string[]; rows: { base: string; tightness: Record<string, number> }[] };
type Lever = { objectType: string; objectId: string; prop: string; currentValue: number; sensitivity: number };
type LeverOut = { levers: Lever[]; count: number };
type GaScope = { baseId?: string; displayName?: string; factorId?: string; factorApplied?: boolean; factorNote?: string };
type GaOut = { scope?: GaScope; levels?: { depth: number; nodes: { id: string; factor: string }[] }[] };

const inv = async (t: TestApp, key: string, args: Record<string, unknown>): Promise<unknown> =>
  t.services.solvers.invoke(ADMIN, key, args);

describe("WO-CAPACITY-PAGE-100PCT · 产能推演页 后端接缝", () => {
  it("① R1：每基地卡的首要风险因子 = 该基地**实测张力最高**的因子（不再全站同一个 瓶颈工序）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const risk = (await inv(t, "risk_timeline", { horizon: 30 })) as RiskOut;
    const bn = (await inv(t, "bottleneck_matrix", { dataMode: "LIVE" })) as BnOut;

    expect(risk.cards.length).toBeGreaterThan(1);

    // 效果层 A：卡面因子必须就是该基地 LIVE 张力最高的因子。
    // （修前 8/8 卡恒为 `瓶颈工序`，而信阳的 `物流时长`(92) / 江门的 `物料齐套`(96) 明明更高 →
    //   同一张卡"首要风险=瓶颈工序 91"却挂着"物流时长 92"的 chip，自相矛盾。）
    for (const card of risk.cards) {
      const row = bn.rows.find((r) => r.base === card.base);
      expect(row, `bottleneck_matrix 缺基地 ${card.base}`).toBeTruthy();
      const maxTightness = Math.max(...bn.factors.map((f) => row!.tightness[f] ?? -1));
      expect(row!.tightness[card.factor] ?? -1, `${card.base} 卡面因子=${card.factor} 不是本基地张力最高的因子`).toBe(maxTightness);
    }

    // 效果层 B：不同基地不得**全部**是同一个因子（R1 用户亲报症状的直接断言）。
    const distinct = new Set(risk.cards.map((c) => c.factor));
    expect(distinct.size, `所有基地首要因子仍全同：${[...distinct].join("/")}`).toBeGreaterThan(1);
  });

  it("① R1b：峰值被封顶打平时，tie-break 走实测当前张力（不再退化为 bottleneck.factors 数组序）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const risk = (await inv(t, "risk_timeline", { horizon: 30 })) as RiskOut;
    // 看板按 越线日↑ → 实测当前张力↓ 排序：第一张卡的当前张力必须 ≥ 其后每一张（否则最严重的基地会被挤出 maxCards）。
    const curs = risk.cards.map((c) => c.currentTightness?.value ?? -1);
    for (let i = 1; i < curs.length; i++) expect(curs[0]!).toBeGreaterThanOrEqual(curs[i]!);
  });

  it("② R4：base_capacity_outlook 三形态 baseId（obj_base_xinyang / xinyang / 信阳）返回同一份前瞻", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const byObjId = await inv(t, "base_capacity_outlook", { baseId: "obj_base_xinyang", horizon: 30 });
    const byId = await inv(t, "base_capacity_outlook", { baseId: "xinyang", horizon: 30 });
    const byName = await inv(t, "base_capacity_outlook", { baseId: "信阳", horizon: 30 });
    // 修前 `obj_base_xinyang` 直接 404 NOT_FOUND（地图页/看板写进 selectedObjects 的恰是这个形态）。
    expect(JSON.stringify(byObjId)).toBe(JSON.stringify(byId));
    expect(JSON.stringify(byName)).toBe(JSON.stringify(byId));
  });

  it("③ 杠杆作用域：不同基地的 scopeObjectIds 必须给出**不同**杠杆，且对象归属该基地（不再一律返回常州）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const factors = ["瓶颈工序", "设备OEE", "人力工时", "物料齐套", "物流时长", "换型损失", "良率波动"];
    const ask = async (baseId: string): Promise<LeverOut> =>
      (await inv(t, "generic_inference", {
        mode: "levers", grain: "process-model", targetType: "Base", targetProp: "weeklyCap",
        factors, scopeObjectIds: [`obj_base_${baseId}`], topK: 8,
      })) as LeverOut;

    const cz = await ask("changzhou");
    const hf = await ask("hefei");
    expect(cz.count).toBeGreaterThan(0);
    expect(hf.count).toBeGreaterThan(0);

    // 效果层 A：作用域内的可写对象必须真属于该基地（对象 id 带基地键）。
    const belongs = (levers: Lever[], baseId: string) =>
      levers.filter((l) => l.objectType === "Process" || l.objectType === "Equipment" || l.objectType === "Line")
        .every((l) => l.objectId.includes(baseId));
    expect(belongs(cz.levers, "changzhou"), `常州作用域返回了非常州对象：${cz.levers.map((l) => l.objectId).join(",")}`).toBe(true);
    expect(belongs(hf.levers, "hefei"), `合肥作用域返回了非合肥对象：${hf.levers.map((l) => l.objectId).join(",")}`).toBe(true);

    // 效果层 B：两个基地的杠杆集不得逐字节相同（修前 curl 对拍两边一模一样 = 作用域根本没接上）。
    expect(JSON.stringify(cz.levers)).not.toBe(JSON.stringify(hf.levers));
  });

  it("③b 杠杆作用域：作用域与认证基地无交集 → 诚实空（绝不回落全域冒充本基地）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const out = (await inv(t, "generic_inference", {
      mode: "levers", grain: "process-model", targetType: "Base", targetProp: "weeklyCap",
      scopeObjectIds: ["obj_base_不存在的基地"], topK: 8,
    })) as LeverOut;
    expect(out.count).toBe(0);
    expect(out.levers).toEqual([]);
  });

  it("⑫ R7：风险卡的受影响订单与「订单聚合」tab 同口径（整个推演窗口·不再 21 天小窗恒空）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    type CardWithOrders = Card & { affectedOrders?: { so: string; dueDay: number }[] };
    const risk = (await inv(t, "risk_timeline", { horizon: 30 })) as { cards: CardWithOrders[] };
    const agg = (await inv(t, "affected_orders", { horizon: 30 })) as { rows: { so: string; risks: { base?: string }[] }[] };

    // 效果层 A：修前只有 1/8 张卡有订单（窗 [crossDay−7, crossDay+14] 几乎不含任何交期）→ 页面 7 张卡恒显「0 批」。
    const withOrders = risk.cards.filter((c) => (c.affectedOrders?.length ?? 0) > 0);
    expect(withOrders.length, "绝大多数风险卡仍然恒空（R7 未修）").toBeGreaterThan(1);

    // 效果层 B：卡上出现的每一单，必须落在推演窗口内（0..horizon），且在订单聚合 tab 的同基地清单里查得到
    //          —— 同一事实一个出处（R-一致），杜绝"卡片说 1 批 / 聚合表说 24 批"这种同屏打架。
    for (const card of risk.cards) {
      for (const o of card.affectedOrders ?? []) {
        expect(o.dueDay).toBeGreaterThanOrEqual(0);
        expect(o.dueDay).toBeLessThanOrEqual(30);
        const inAgg = agg.rows.find((r) => r.so === o.so);
        expect(inAgg, `卡片 ${card.base} 的 ${o.so} 在订单聚合里查不到（两处口径不一致）`).toBeTruthy();
        expect((inAgg!.risks ?? []).some((k) => k.base === card.base), `${o.so} 未关联到 ${card.base}`).toBe(true);
      }
    }
  });

  it("④ gap_attribution：传 BN 因子名（非 CausalFactor）时保住 base 作用域树 + 诚实标 factorApplied=false", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const base = (await inv(t, "gap_attribution", { scope: { baseId: "信阳" } })) as GaOut;
    const baseNodes = base.levels?.find((l) => l.depth === 1)?.nodes ?? [];
    expect(baseNodes.some((n) => n.factor.includes("信阳"))).toBe(true);

    const scoped = (await inv(t, "gap_attribution", { scope: { baseId: "信阳", factorId: "瓶颈工序" } })) as GaOut;
    // 效果层：树**不消失**（修前退化成单节点「储能达成率 缺口」，前端匹配不到基地节点 → 整棵树变诚实灰）。
    const scopedNodes = scoped.levels?.find((l) => l.depth === 1)?.nodes ?? [];
    expect(scopedNodes.some((n) => n.factor.includes("信阳")), "传因子后基地树消失了（修前病灶复发）").toBe(true);
    // 效果层：作用域回执必须保住 baseId，并诚实说明该因子未生效（不静默假装细分了）。
    expect(scoped.scope?.baseId).toBe("xinyang");
    expect(scoped.scope?.factorApplied).toBe(false);
    expect(String(scoped.scope?.factorNote ?? "")).toContain("瓶颈工序");
  });

  it("④b gap_attribution：传**真** CausalFactor id 时才走因果域并标 factorApplied=true", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const cfs = await t.repos.objects.listByType("demo", "CausalFactor");
    const realFactorId = String(cfs[0]?.props.factorId ?? "");
    expect(realFactorId, "种子里应有 CausalFactor").not.toBe("");
    const out = (await inv(t, "gap_attribution", { scope: { baseId: "信阳", factorId: realFactorId } })) as GaOut;
    expect(out.scope?.factorApplied).toBe(true);
    expect(out.scope?.factorId).toBe(realFactorId);
  });
});
