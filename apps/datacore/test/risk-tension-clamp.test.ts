import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver } from "./helpers.js";
import { saturateTension } from "../src/solvers/risk.js";

/**
 * WO · 逐日张力**保序饱和**（治「不同因子 / 不同日同落一个 98」·硬截断压平）。
 *
 * ── 病灶（用户实测截图·信阳 30 天）──
 * 瓶颈工序 91→98、物流时长 92→98、设备OEE 84→98，三个起点不同的因子终点全是 98，30 个点全同色。
 * 后端直调取证：`tensionSeries` 末段的**原始驱动值**是
 *   98.65 / 99.97 / 101.29 / 99.97 / 98.65 / 100.72 / 98.55 / 97.70
 * ——里面清楚地含两个真事件脉冲峰（D+25 检修窗 amp14、D+28 交付高峰 amp9），
 * 却被 `Math.min(cap=98, round(...))` 硬截断压成同一个 98：8/30 天零信息量，
 * 且三因子在顶部完全不可区分（面板的全部价值「哪天开始恶化 / 哪天最该干预」正好丢在这里）。
 *
 * ── 本测的牙（效果层·非运输层）──
 * ① 同一因子在不同日不得恒等（真逐日演化，不是阈值分桶）；
 * ② 三个不同因子不得同落一个值（上限可以有，但不能吃掉区分度）；
 * ③ 顶端饱和段仍**严格保序**（原始驱动更高的那天，显示值必须更高）——直接咬硬截断；
 * ④ 上限仍在（恒 ≤ cap·不越界）；
 * ⑤ R6：同入参两跑字节一致。
 */
describe("risk_timeline · 顶端饱和保序（不同因子/不同日不得同落一个值）", () => {
  const HORIZON = 30;
  const CAP = 98; // params.risk.cap（battery §）

  it("① 逐日不恒等 · ② 三因子不同值 · ④ 不越上限（真求解器·信阳）", async () => {
    const t = await makeApp();
    await seedBattery(t);

    const out = (await invokeSolver(t, "risk_timeline", { horizon: HORIZON })).json() as {
      data: { threshold: number; cards: Array<{ base: string; baseId: string; factor: string; series: number[]; factorSeries?: Record<string, number[]> }> };
    };
    const card = out.data.cards.find((c) => c.base.includes("信阳"));
    expect(card, "种子里应有信阳风险卡").toBeTruthy();
    const fs = card!.factorSeries!;
    expect(Object.keys(fs).length).toBeGreaterThanOrEqual(3);

    // ① 同一因子在不同日不得恒等。
    //    唯一豁免：该因子逐日**全部**回落到同一个常量（无逐日源）——本卡不存在这种因子，
    //    故此处不给豁免口子；若将来出现，必须在此处写下可核查的理由，而不是把断言放松。
    for (const [f, s] of Object.entries(fs)) {
      expect(s.length).toBe(HORIZON);
      expect(new Set(s).size, `因子 ${f} 的 30 天张力恒等（阈值分桶而非逐日推演）`).toBeGreaterThan(1);
      // ④ 上限仍在。
      for (const v of s) expect(v).toBeLessThanOrEqual(CAP);
    }

    // ② 三个**不同**因子不得同落一个值：取全部因子的峰值，去重后必须仍是多个。
    //    修前：瓶颈工序 / 物流时长 / 设备OEE 峰值全是 98（硬截断）→ 去重后塌成 1 个。
    const peaks = Object.values(fs).map((s) => Math.max(...s));
    const topPeaks = [...peaks].sort((a, b) => b - a).slice(0, 3);
    expect(new Set(topPeaks).size, `张力最高的三个因子峰值同落一个数：${JSON.stringify(topPeaks)}`).toBe(3);

    // ② 补强：本卡内**全部**触顶因子（峰值落在饱和带 (cap−0.5, cap]）两两不同值。
    const saturatedPeaks = peaks.filter((p) => p > CAP - 0.5);
    expect(saturatedPeaks.length, "取证前提：信阳确有多个因子触顶").toBeGreaterThanOrEqual(2);
    expect(new Set(saturatedPeaks).size, "触顶因子彼此不可区分（硬截断未治）").toBe(saturatedPeaks.length);
  }, 120000);

  it("③ 饱和段严格保序（纯函数直咬·硬截断在此必红）", () => {
    // 取证里真实出现过的原始驱动值（信阳·瓶颈工序 D+23…D+30）。
    const raws = [97.7042, 98.5476, 98.6512, 99.9686, 100.7233, 101.2884];
    const outs = raws.map((r) => saturateTension(r, CAP));

    // 严格单调：原始驱动更高的那天，显示值必须更高（硬截断会让它们全等 → 红）。
    for (let i = 1; i < outs.length; i++) {
      expect(outs[i]!, `saturateTension 在 ${raws[i - 1]}→${raws[i]} 上不保序：${outs[i - 1]}→${outs[i]}`).toBeGreaterThan(outs[i - 1]!);
    }
    // 全部互不相同（区分度真的留住了，不是只有首尾不同）。
    expect(new Set(outs).size).toBe(raws.length);
    // 上限仍在：恒 < cap（开区间·永不越界）。
    for (const v of outs) expect(v).toBeLessThan(CAP);

    // 未触顶区间**逐字节不变**（与旧口径 Math.round 相同）——本改动不动任何原本没被压平的数据。
    for (const raw of [12, 55.4, 84.6, 90, 96.49, 97.2, 97.5]) {
      expect(saturateTension(raw, CAP)).toBe(Math.round(raw));
    }
  });

  it("⑤ R6 确定性：同入参两跑字节一致（无随机 / 无时钟）", async () => {
    const run = async (): Promise<string> => {
      const t = await makeApp();
      await seedBattery(t);
      const out = (await invokeSolver(t, "risk_timeline", { horizon: HORIZON })).json() as {
        data: { cards: Array<{ base: string; series: number[]; factorSeries?: Record<string, number[]> }> };
      };
      return JSON.stringify(out.data.cards.map((c) => [c.base, c.series, c.factorSeries]));
    };
    const a = await run();
    const b = await run();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(100);
  }, 180000);
});
