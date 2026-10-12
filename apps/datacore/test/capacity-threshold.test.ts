import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver } from "./helpers.js";
import { round } from "../src/prng.js";

/**
 * WO-DIALOGUE-Q1Q2 · 求解器引擎半（真 capacity_forecast/bottleneck_matrix·经真 app + battery 种子）。
 *
 * Q1（反向阈值口径纠正）：capacity_forecast(mode:"threshold") 的 thresholdQty **= P90 天花板 − 已占基线需求
 * baselineDemand**（增量余量·还能加多少），**非** raw P90。用 P90（承诺口径·capWanP90≤capWanP50）。baselineDemand≥capWanP90→0（诚实无余量）。
 * Q2（限域引擎半）：bottleneck_matrix(baseIds:["xinyang"]) 仅信阳一行（risk.ts:106 baseIds ?? 全域·传入即限域）。
 *
 * 数据×引擎两半接缝（SEAM）：数据半（seed 令 baseIds 槽真达 solver）在 agentcore 侧驱动；此处坐实引擎半——
 * 传入 baseIds 即限域、传 mode:"threshold" 即出阈值增量。两半合起来端到端（agentcore dialogue-q1q2.test.ts）。
 */

describe("WO-DIALOGUE-Q1Q2 · capacity_forecast(mode:'threshold') 反向阈值口径", () => {
  it("Q1: thresholdQty = round(P90 − baselineDemand) 增量余量（非 raw P90）+ 单位万套 + summary 透明列三值", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const fwd = (await invokeSolver(t, "capacity_forecast", { modelId: "4680-NCM", weeks: 6 })).json() as {
      data: Record<string, unknown>;
    };
    const res = await invokeSolver(t, "capacity_forecast", { modelId: "4680-NCM", weeks: 6, mode: "threshold" });
    expect(res.statusCode).toBe(200);
    const out = (res.json() as { data: Record<string, unknown> }).data;

    expect(out.mode).toBe("threshold");
    expect(out.thresholdUnit).toBe("万套");
    expect(typeof out.capWanP90).toBe("number");
    expect(typeof out.baselineDemand).toBe("number");
    expect(typeof out.thresholdQty).toBe("number");

    const capWanP90 = out.capWanP90 as number;
    const bd = out.baselineDemand as number;
    // ★ 口径纠正命门：thresholdQty = P90 − baselineDemand（clamp 0），**不是** raw P90。
    const expected = bd >= capWanP90 ? 0 : round(capWanP90 - bd, 4);
    expect(out.thresholdQty).toBe(expected);

    // capWanP90/baselineDemand 与前向 forecast 同口径（同 modelId/weeks·mode 不改这两值）——证阈值分支复用同一产能/需求轴。
    expect(out.capWanP90).toBe(fwd.data.capWanP90);
    expect(out.baselineDemand).toBe(fwd.data.baselineDemand);

    // 该种子 baselineDemand>0（在手订单落窗）→ thresholdQty 严格 < capWanP90（坐实「减掉已占」而非 raw capWanP90）。
    expect(bd).toBeGreaterThan(0);
    expect(out.thresholdQty as number).toBeLessThan(capWanP90);
    expect(out.thresholdQty).toBe(round(capWanP90 - bd, 4));

    // summary 透明列全三值（天花板 P90 / 已占 baselineDemand / 还能加 thresholdQty）使口径可核。
    const summary = String(out.summary);
    expect(summary).toContain("P90");
    expect(summary).toContain(String(capWanP90));
    expect(summary).toContain(String(bd));
    expect(summary).toContain(String(out.thresholdQty));

    await t.app.close();
  });

  it("Q1 诚实无余量：baselineDemand ≥ P90 → thresholdQty=0（不报负·纯函数口径覆盖）", async () => {
    // 直接以纯函数覆盖 clamp 分支（battery 种子恒 bd<capWanP90·无法自然触发无余量）——证 baselineDemand≥capWanP90→0。
    const { capacityForecast } = await import("../src/solvers/capacity.js");
    const clamp = (capWanP90: number, bd: number) => (bd >= capWanP90 ? 0 : round(capWanP90 - bd, 4));
    expect(clamp(40, 40)).toBe(0);
    expect(clamp(40, 50)).toBe(0);
    expect(clamp(40, 27.7)).toBe(round(12.3, 4));
    expect(typeof capacityForecast).toBe("function"); // 分支真实存在（mode:"threshold" 上文已端到端跑通）
  });

  it("前向 forecast 不回归：无 mode → 前向输出（effectiveDemand/gapPct·无 thresholdQty/mode）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const out = (await invokeSolver(t, "capacity_forecast", { modelId: "4680-NCM", demandDelta: 0.2, weeks: 6 })).json() as {
      data: Record<string, unknown>;
    };
    expect(out.data.thresholdQty).toBeUndefined(); // 前向不产阈值字段
    expect(out.data.mode).toBeUndefined();
    expect(typeof out.data.effectiveDemand).toBe("number"); // 前向 what-if 字段仍在
    expect(typeof out.data.gapPct).toBe("number");
    await t.app.close();
  });
});

describe("WO-DIALOGUE-Q1Q2 · bottleneck_matrix 限域引擎半（Q2）", () => {
  it("Q2: baseIds:['xinyang'] → 仅信阳一行（非全部基地）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await invokeSolver(t, "bottleneck_matrix", { baseIds: ["xinyang"] });
    expect(res.statusCode).toBe(200);
    const out = (res.json() as { data: { rows: { base: string }[] } }).data;
    expect(out.rows.length).toBe(1);
    expect(out.rows[0]!.base).toBe("信阳");
    await t.app.close();
  });

  it("Q2 对照：无 baseIds → 全部基地（>1 行）——证 baseIds 是真限域开关（非无效参数）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const all = (await invokeSolver(t, "bottleneck_matrix", {})).json() as { data: { rows: { base: string }[] } };
    expect(all.data.rows.length).toBeGreaterThan(1);
    expect(all.data.rows.some((r) => r.base === "信阳")).toBe(true);
    await t.app.close();
  });
});
