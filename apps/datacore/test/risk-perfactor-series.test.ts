import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver } from "./helpers.js";
import { liveTightness, riskEvents, tensionSeries } from "../src/solvers/risk.js";

/**
 * WO-risk-perfactor-series（治 #1/#3「时序推演全灰/无梯度」）：产能推演详情面板此前只有**瓶颈因素**（card.series）
 * 有真逐日 series，其余因素（物流时长/设备OEE/人力工时/物料齐套/换型损失/良率波动）只拿到单点当前张力 → 前端持平线。
 * 现在 risk_timeline 每卡新增 factorSeries（factor → 逐日 series），**每个**因素都走与瓶颈**同一** tensionSeries
 * 机制：由该因素自身 liveTightness（实测当前张力·有真源=LIVE 锚实测/无真源=回落 mock）起锚 + 确定性前瞻。
 *
 * 接缝门（SEAM-GATE·数据 risk.ts × 契约 solvers.ts × 前端消费）：本测经**真求解器路由**取 card.factorSeries、
 * 再**独立复算** tensionSeries（由 liveTightness 起锚）逐字节比对——证明 series 是**真派生非写死**（KILL-MOCK-RED·铁律0.4）。
 *
 * 齿：① 每因素都有 horizon 长真 series；② factorSeries[card.factor] === card.series（同机制恒等）；③ 真派生（复算字节一致）；
 * ④ day-0/current reconcile：series 每日 ≥ min(cap, 该因素当前张力)（锚在当前·只前瞻恶化·从不低于当前·与 bottleneck_matrix 同源）；
 * ⑤ 非持平（真蓝→黄→红梯度·非单值持平）；⑥ R6 确定性（同 seed 两跑字节一致）。
 */
describe("WO-risk-perfactor-series · 逐因素真逐日序列（reuse tensionSeries·由实测当前张力起锚）", () => {
  const HORIZON = 30;
  const CAP = 98; // params.risk.cap（battery §）

  it("每因素有真逐日 series + 恒等锚 + 真派生 + day-0 reconcile 当前张力 + 非持平", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const risk = (await invokeSolver(t, "risk_timeline", { horizon: HORIZON })).json() as {
      data: {
        horizon: number;
        threshold: number;
        cards: Array<{
          base: string;
          baseId: string;
          factor: string;
          series: number[];
          currentTightness?: { value: number; live: boolean };
          factorSeries?: Record<string, number[]>;
        }>;
      };
    };
    const cards = risk.data.cards;
    expect(cards.length).toBeGreaterThan(0);

    // bottleneck_matrix LIVE：每因素当前张力（curF）——与 factorSeries 起锚**同源**（都过 liveTightness）。
    const bn = (await invokeSolver(t, "bottleneck_matrix", { dataMode: "LIVE" })).json() as {
      data: { factors: string[]; rows: Array<{ base: string; tightness: Record<string, number> }> };
    };
    const factors = bn.data.factors;
    expect(factors.length).toBeGreaterThan(1);

    // 真上下文（复算锚点·证明 series 由 tensionSeries 从 liveTightness 派生·非写死轨迹）。
    const ctx = await t.services.solvers.loadContext("demo");

    for (const card of cards) {
      expect(card.factorSeries, `card ${card.base} 缺 factorSeries`).toBeTruthy();
      const fs = card.factorSeries!;

      // ① 覆盖全因素 + 长度 = horizon
      for (const f of factors) {
        expect(Array.isArray(fs[f]), `${card.base}·${f} 无 series`).toBe(true);
        expect(fs[f]!.length).toBe(HORIZON);
      }

      // ② 瓶颈因素 factorSeries 与 card.series 恒等（同 baseline 同 events 同机制）
      expect(fs[card.factor]).toEqual(card.series);

      const bnRow = bn.data.rows.find((r) => r.base === card.base);
      expect(bnRow, `bottleneck_matrix 缺 ${card.base} 行`).toBeTruthy();

      let nonFlat = 0;
      for (const f of factors) {
        const series = fs[f]!;

        // ③ 真派生（非写死）：与独立复算的 tensionSeries（由 liveTightness 起锚）逐字节一致。
        const ltf = liveTightness(ctx, card.baseId, f);
        const events = riskEvents(ctx, card.baseId, HORIZON);
        const expected = tensionSeries(ctx, card.baseId, f, HORIZON, events, undefined, ltf.live ? ltf.value : undefined);
        expect(series, `${card.base}·${f} series 非 tensionSeries 派生`).toEqual(expected);

        // ④ day-0/current reconcile：curF = bottleneck_matrix LIVE tightness（同 liveTightness 口径）。
        //    series 每日 ≥ min(cap, curF) —— 锚在当前张力·只向前恶化·从不低于当前（cap-safe·非任意起点）。
        const curF = bnRow!.tightness[f]!;
        expect(ltf.value, `${card.base}·${f} 当前张力两求解器口径不一致`).toBe(curF);
        expect(Math.min(...series)).toBeGreaterThanOrEqual(Math.min(CAP, curF));

        // ⑤ 非持平计数（真梯度·蓝→黄→红演进）。
        if (new Set(series).size > 1) nonFlat++;
      }
      // ⑤ 绝大多数因素有真梯度（此前全持平·现在只有极端封顶因素可能持平）——严格证明"无梯度"已治。
      expect(nonFlat, `${card.base} 非持平因素过少（治 #3 未生效）`).toBeGreaterThanOrEqual(factors.length - 1);
    }
  });

  it("R6 确定性：同 seed 两跑 factorSeries 字节一致（无随机/时钟）", async () => {
    const run = async (): Promise<string> => {
      const t = await makeApp();
      await seedBattery(t);
      const risk = (await invokeSolver(t, "risk_timeline", { horizon: HORIZON })).json() as {
        data: { cards: Array<{ base: string; factorSeries?: Record<string, number[]> }> };
      };
      return JSON.stringify(risk.data.cards.map((c) => [c.base, c.factorSeries]));
    };
    const a = await run();
    const b = await run();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(2);
  });
});
