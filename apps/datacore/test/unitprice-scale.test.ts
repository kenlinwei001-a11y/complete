import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, type TestApp } from "./helpers.js";
import { InProcOptimizerClient } from "../src/solvers/inproc-optimizer.js";
import { globalSimOptimize, type PortfolioInput } from "../src/solvers/portfolio.js";
import { generateBattery, MODEL_BASE_MAP, BATTERY_SOLVER_PARAMS } from "../src/synthetic/battery.js";
import type { PortfolioRequest } from "../src/solvers/optimizer-client.js";
import { SEG_REGISTRY } from "@platform/contracts";

/**
 * WO-UNITPRICE-SCALE · 订单单价「同价不同单位」口径锚 + 禁止静默兜底（R18 尺度/量纲 · G-UNIT-NORMALIZE）。
 *
 * 取证结论（详见两处紧邻注释）：
 *   · `Order.unitPrice` 单位 = **元/套**（battery.ts propDef `unit:"元"`·种子 `seg.priceWan×1e4`·实测 13902~22022）；
 *   · `solvers/service.ts orderVal` 的 `/1e4` 是 元→万元 的**正确**换算；
 *   · `solvers/portfolio.ts avgUnitPrice`(缺省 1.8) 单位 = **万元/套**，与 SEG_REGISTRY.priceWan 同口径。
 *   ⇒ 两处相差 ~30× 是 **元 ↔ 万元 的单位差**，不是量纲冲突；**真病灶**是 service.ts 那侧的兜底常数 `600`——
 *     WO-SCALE-COHERENCE **之前**的 `randInt(380,980)` 残留，正是当年被消灭的病灶值本身。
 *
 * 本测是**接缝驱动**（数据半：battery 种子 unitPrice 元/套 × 引擎半：portfolio 万元/套 KPI + gap_attribution 万元 driver），
 * 不是各半 unit：任一半被"对齐"或兜底常数被改回业务数，立即红。
 */

const inproc = new InProcOptimizerClient();
const solve = (req: PortfolioRequest) => inproc.solvePortfolio!(req);
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b));

/** 元/套 与 万元/套 的量级隔离带：任何一侧越界 = 有人把两处当同一单位。 */
const YUAN_SCALE_MIN = 1_000; // 元/套 下界（真实 13902~22022）
const WAN_SCALE_MAX = 10; // 万元/套 上界（真实 1.4~2.2）

describe("WO-UNITPRICE-SCALE · 单价口径锚（元/套 ↔ 万元/套）+ 禁止静默兜底 SEAM", () => {
  it("口径锚：Order.unitPrice=元/套 · portfolio avgUnitPrice=万元/套 · ×1e4 后同一业务价（ε≤15%）·两侧量级隔离", async () => {
    // ── 数据半：真 battery 种子（非 toy 世界）──
    const g = generateBattery(42, "S");
    const orders = g.orders as Record<string, unknown>[];
    expect(orders.length).toBeGreaterThan(0);

    // 兜底触发率取证：真种子下 Order.unitPrice **恒有值**（缺一个即说明兜底会真触发 → 本单降级为真 bug）。
    const missing = orders.filter((o) => o.unitPrice == null || Number.isNaN(Number(o.unitPrice)));
    expect(missing.length, "真种子下 Order.unitPrice 必须恒有值（兜底不应触发）").toBe(0);

    const sumQty = orders.reduce((s, o) => s + Number(o.qty), 0);
    const meanUnitPriceYuan = orders.reduce((s, o) => s + Number(o.qty) * Number(o.unitPrice), 0) / sumQty;

    // ① Order.unitPrice 落在 **元/套** 带（SEG_REGISTRY.priceWan×1e4 ±20%）——它若掉到 1.x 就是被误改成万元。
    const segMinYuan = Math.min(...SEG_REGISTRY.map((s) => s.priceWan)) * 1e4;
    const segMaxYuan = Math.max(...SEG_REGISTRY.map((s) => s.priceWan)) * 1e4;
    expect(meanUnitPriceYuan, "Order.unitPrice 均值须在元/套带内（下界）").toBeGreaterThan(segMinYuan * 0.8);
    expect(meanUnitPriceYuan, "Order.unitPrice 均值须在元/套带内（上界）").toBeLessThan(segMaxYuan * 1.2);
    expect(meanUnitPriceYuan, "Order.unitPrice 必须是元/套量级（非万元）").toBeGreaterThan(YUAN_SCALE_MIN);

    // ── 引擎半：真 globalSimOptimize 反解出引擎实际在用的 avgUnitPrice（coeff 回缺省 → 锚住 portfolio.ts 那行）──
    const input: PortfolioInput = {
      forecastStart: BATTERY_SOLVER_PARAMS.forecastStart as string,
      orders: g.orders, workOrders: g.workOrders, demandSegments: g.demandSegments,
      bases: g.bases, lines: g.lines, changeover: [],
      modelBaseMap: MODEL_BASE_MAP, seed: 42, coeff: (_k: string, d: number) => d,
      businessTypeRegime: BATTERY_SOLVER_PARAMS.businessTypeRegime as PortfolioInput["businessTypeRegime"],
      operatingDaysPerYear: BATTERY_SOLVER_PARAMS.operatingDaysPerYear as number,
      twoStage: true, scenarios: ["max_ontime"],
    };
    const r = await globalSimOptimize(input, solve);
    const sc = r.scenarios[0]!;
    const servedQty = sc.allocation.reduce((s, a) => s + a.qty, 0);
    expect(servedQty, "须真排产（否则反解无意义）").toBeGreaterThan(0);
    // margin = servedQty × avgUnitPrice − baseCost(=kpi.cost) ⇒ 反解引擎实用均价（万元/套）
    const impliedAvgWan = (sc.kpi.margin + sc.kpi.cost) / servedQty;

    console.log("[UNITPRICE-SCALE] Order.unitPrice 量加权均值=%s 元/套 | portfolio 反解 avgUnitPrice=%s 万元/套 | ×1e4=%s 元/套 | rel=%s",
      meanUnitPriceYuan.toFixed(0), impliedAvgWan.toFixed(4), (impliedAvgWan * 1e4).toFixed(0), rel(impliedAvgWan * 1e4, meanUnitPriceYuan).toFixed(4));

    // ② portfolio 侧必须留在 **万元/套** 带（有人误写 18000「元」即红）。
    expect(impliedAvgWan, "portfolio avgUnitPrice 必须是万元/套量级").toBeLessThan(WAN_SCALE_MAX);
    expect(impliedAvgWan, "portfolio avgUnitPrice 须在 SEG priceWan 带内（下界）").toBeGreaterThan(Math.min(...SEG_REGISTRY.map((s) => s.priceWan)) * 0.8);

    // ③ **同一业务价**：万元/套 ×1e4 与 元/套 均值 ε≤15%。任一侧被单独改动（对齐成同一个数 / 抹掉 ÷1e4）即红。
    expect(rel(impliedAvgWan * 1e4, meanUnitPriceYuan), "两处须是同一业务价·仅单位不同（元 vs 万元）").toBeLessThanOrEqual(0.15);
  });

  it("禁止静默兜底（效果层）：缺 unitPrice 的订单在 gap_attribution 中为 0 权重·绝不冒充旧口径 600 元/套", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t, 42);

    // 注入一张**缺 unitPrice** 的储能订单（非种子路径可产生：连接器接入 / 建模发布 / 手工建对象）。
    // qty 取到与全量订单额同量级，令「若走 600 兜底」的份额显著非 0 —— 断言才有咬合力。
    const GHOST_QTY = 200_000; // 套；旧兜底下 driver = 200000×600/1e4 = 12000 万元（非 0·可观份额）
    const GHOST_SO = "SO-NOPRICE";
    // hefei 在「储能」业态下无种子订单 → 该基地的 L1 份额将**全部**来自这张缺价单（信号不被稀释）。
    const GHOST_BASE = "hefei";
    await t.repos.objects.put({
      id: "obj_order_SO-NOPRICE",
      tenantId: "demo",
      type: "Order",
      objectKey: GHOST_SO,
      props: {
        so: GHOST_SO, cust: "缺价客户", model: "4680-NCM", qty: GHOST_QTY,
        due: "2026-06-24", pri: "高", bases: [GHOST_BASE], status: "OPEN",
        businessType: "storage", early: false,
        // ★ 故意无 unitPrice
      },
      origin: { type: "MANUAL" },
      epoch: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    // ── 前置守卫：证明该单**通过了 gap_attribution 的全部前置过滤**（OPEN ∩ storage ∩ 有 bases[0]），
    //    否则下面的「不出现」断言就是空转（被别的条件挡掉，而非被兜底修好）。──
    const allOrders = await t.repos.objects.listByType("demo", "Order");
    const ghostRow = allOrders.find((o) => o.props.so === GHOST_SO)!;
    expect(ghostRow, "注入订单须真落库").toBeDefined();
    expect(ghostRow.props.status, "须 OPEN（过前置过滤）").toBe("OPEN");
    expect(ghostRow.props.businessType, "须 storage（过 seg_attain_ess 业态过滤）").toBe("storage");
    expect(ghostRow.props.unitPrice, "★ 前提：该单确实无 unitPrice").toBeUndefined();
    // 同基地（hefei）在该业态下**只有**这一张订单 → 该基地的全部 driver 都来自缺价单，信号不被稀释。
    const hefeiStorage = allOrders.filter((o) => o.props.status === "OPEN" && o.props.businessType === "storage"
      && (o.props.bases as string[] | undefined)?.[0] === GHOST_BASE);
    expect(hefeiStorage.map((o) => o.props.so), `${GHOST_BASE} 该业态下须只有缺价单（信号不稀释）`).toEqual([GHOST_SO]);

    const res = await invokeSolver(t, "gap_attribution", { metricKey: "seg_attain_ess" });
    expect(res.statusCode).toBe(200);
    const out = res.json() as { data: { levels: { depth: number; nodes: { id: string; contribution: number; share: number }[] }[] } };
    const l1 = out.data.levels.find((l) => l.depth === 1)!;
    const l2 = out.data.levels.find((l) => l.depth === 2)!;

    // ── 效果层断言（"结果因此不同"·非运输层）──
    // 旧兜底 600 下：缺价单 driver = 200000×600/1e4 = 12000 万元（≫0）→ `base:hefei` 会带着一个**凭空捏造**的
    // 份额出现在 L1、`order:SO-NOPRICE` 出现在 L2，把 gap 分摊走一块。
    // 修后：缺 unitPrice ⇒ 0 权重 ⇒ 该基地/该叶不带任何伪造份额。任一处冒出非 0 即说明静默兜底被改回来了。
    const ghostBaseNode = l1.nodes.find((n) => n.id === `base:${GHOST_BASE}`);
    expect(ghostBaseNode?.share ?? 0, `base:${GHOST_BASE} 不得因缺价单被静默兜底出非 0 份额`).toBe(0);
    const ghostLeaf = l2.nodes.find((n) => n.id === `order:${GHOST_SO}`);
    expect(ghostLeaf?.share ?? 0, "缺价订单叶不得被静默兜底出非 0 权重").toBe(0);
    expect(ghostLeaf?.contribution ?? 0, "缺价订单叶不得被静默兜底出非 0 贡献").toBe(0);

    // 量级留档（非断言·防后人误以为「本来就该是 0」）：旧兜底 600 元/套 下该叶 driver = 12000 万元，
    // 实测会凭空占走 base:hefei ≈ 6.86% 的 ess gap 份额（变异反证输出）。

    // ── 不误伤：有价订单仍正常参与（0 权重只针对缺价单，不是一刀切归零）──
    const priced = l2.nodes.filter((n) => n.id.startsWith("order:") && n.id !== `order:${GHOST_SO}`);
    expect(priced.length, "有价储能订单仍在树中").toBeGreaterThan(0);
    expect(priced.some((n) => n.share > 0), "有价订单权重须 > 0").toBe(true);
    expect(l1.nodes.length, "其余基地仍正常出树").toBeGreaterThan(0);
  });
});
