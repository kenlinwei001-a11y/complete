import { describe, expect, it } from "vitest";
import { InProcOptimizerClient } from "../src/solvers/inproc-optimizer.js";
import { globalSimOptimize, type PortfolioInput } from "../src/solvers/portfolio.js";
import type { PortfolioRequest } from "../src/solvers/optimizer-client.js";

/**
 * PRD-multi-intent-L2L3 P2 · **SEAM-L3-守恒（头号判据·真求解驱动）**：L3 的「耦合链 → 一次 portfolio 请求」映射
 * 落到真引擎后必须是**真传导**——改转拨量（committedBatches 预占）→ 延误/被挤残差**联动变**，且每次解的
 * 联合守恒（Σ qty·x[i,b,t] ≤ cap[b,t]）成立。L1 独立并行下这不可能发生（各 solver 互不知情）——
 * 本测是「真联合 vs 假综合」的唯一真门（PRD §5.1/5.2·InProc 优化器·确定性 R6·非 mock）。
 */

const FORECAST_START = "2026-06-10";
const inproc = new InProcOptimizerClient();
const solve = (req: PortfolioRequest) => inproc.solvePortfolio!(req);
const mkCoeff = (over: Record<string, number> = {}) => (k: string, d: number): number => (k in over ? over[k]! : d);
const base = (baseId: string, factory_type: string) => ({ baseId, name: baseId, util: 0, factory_type });
const line = (baseId: string, lineId: string, capacityDaily: number) => ({ baseId, lineId, capacityDaily });
const ord = (so: string, cust: string, model: string, qty: number, due: string) => ({ so, cust, model, qty, due, pri: "高", status: "OPEN" });

/** L3 映射产物同款输入（globalSim 编排路）：唯一基地 base1·单线 100/日·窗 7 日 → 700/窗；两单各 400。 */
const world = (committed: { base: string; qty: number; window?: number }[]): PortfolioInput => ({
  forecastStart: FORECAST_START,
  orders: [ord("SO-1", "广汽集团", "M1", 400, "2026-06-17"), ord("SO-2", "长安汽车", "M1", 400, "2026-06-24")],
  workOrders: [], demandSegments: [],
  bases: [base("base1", "CELL+PACK")],
  lines: [line("base1", "b1-l1", 100)],
  changeover: [],
  modelBaseMap: { M1: ["base1"] },
  scenarios: ["max_ontime"],
  seed: 42,
  coeff: mkCoeff({ windowDays: 7 }),
  // L3 转拨映射：committedBatches 预占 base1 净产能（转拨走量 = 固定背景·非自由决策变量·同 WIP 机制）。
  ...(committed.length > 0 ? { committedBatches: committed } : {}),
});

/** 持续转拨：逐窗预占（numWindows ≤ ceil(14/7)+late+1·占满 0..5 必覆盖全视界）。 */
const fullTransfer = (qtyPerWindow: number): { base: string; qty: number; window: number }[] =>
  Array.from({ length: 6 }, (_, w) => ({ base: "base1", qty: qtyPerWindow, window: w }));

describe("SEAM-L3-守恒 · 改转拨量 → 延误/残差联动变（真传导·非独立估）", () => {
  it("转拨 0：700/窗 · 两单(400+400)跨两窗均可排 → 无被挤基线", async () => {
    const r = await globalSimOptimize(world([]), solve);
    expect(r.blocked.filter((b) => b.reason === "capacity").length).toBe(0);
    const so1 = r.schedule.filter((s) => s.orderId.startsWith("SO-1"));
    expect(so1.length).toBeGreaterThan(0); // SO-1 获排
  });

  it("命门①·延误传导：转拨 350 首窗预占 → 净产能 350/首窗 → 排产/交付日**联动变**（同一问题只改转拨量）+ 守恒不破", async () => {
    const a = await globalSimOptimize(world([]), solve);
    const b = await globalSimOptimize(world([{ base: "base1", qty: 350 }]), solve);

    // 延误传导：转拨挤占首窗后排产格局必变（L1 独立测算下延误对转拨不敏感——这正是 L3 的分水岭）。
    const delaysOf = (r: typeof a): string =>
      JSON.stringify({
        blocked: r.blocked.map((x) => ({ o: x.orderId, reason: x.reason, qty: x.qty })).sort((x, y) => x.o.localeCompare(y.o)),
        deliver: r.schedule.map((s) => ({ o: s.orderId, d: s.deliverDay })).sort((x, y) => x.o.localeCompare(y.o)),
      });
    expect(delaysOf(b)).not.toBe(delaysOf(a)); // ★ 改转拨量 → 延误/排产联动变（真传导铁证）

    // 守恒硬校验：两次解 reconciled 均不为 false（capacityLedger 逐格 Σ占用 ≤ cap）。
    expect(a.reconciled).not.toBe(false);
    expect(b.reconciled).not.toBe(false);
  });

  it("命门②·残差为真：持续转拨占满全视界（700×窗0..5）→ 两单全被挤 → 外协残差 = 联合结算真产物（>基线 0）", async () => {
    const a = await globalSimOptimize(world([]), solve);
    const b = await globalSimOptimize(world(fullTransfer(700)), solve);
    const residual = (r: typeof a): number => r.blocked.reduce((s, x) => s + (x.qty ?? 0), 0);
    expect(residual(a)).toBe(0); // 基线无残差
    expect(residual(b)).toBeGreaterThan(0); // 转拨占满 → 真残差（外协吃的就是它）
    expect(b.reconciled).not.toBe(false); // 挤占下守恒仍硬校验通过（不超容·被挤不是超排）
  });

  it("R6：同转拨量两跑字节一致（确定性·seed 42·无时钟随机）", async () => {
    const a = await globalSimOptimize(world([{ base: "base1", qty: 350 }]), solve);
    const b = await globalSimOptimize(world([{ base: "base1", qty: 350 }]), solve);
    expect(JSON.stringify(a.schedule)).toBe(JSON.stringify(b.schedule));
    expect(JSON.stringify(a.blocked)).toBe(JSON.stringify(b.blocked));
  });
});
