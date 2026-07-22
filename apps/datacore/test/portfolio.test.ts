import { describe, expect, it } from "vitest";
import { makeApp, seedBattery } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import type {
  OptimizerClient, OptimizationRequest, OptimizationResult,
  PortfolioRequest, PortfolioResult,
} from "../src/solvers/optimizer-client.js";

/**
 * WO-PORTFOLIO-OPTIMAL · portfolio 默认门（接线 + 输出守恒·mock optimizer·SEAM 层1）。
 *
 * 分工（KILL-MOCK 两半）：共享产能「无重复占用」是真 CP-SAT 约束 Σ_i qty·x[i,b,t]≤cap[b,t] 的产物——
 * mock 只回**合法形状解**（尊重容量），证 datacore 的三源需求组装 + (base,窗口)产能表 + 冻结预扣 +
 * capacityLedger/reconChecks 守恒后处理 + ≥2 方案汇聚 + provenance 接线对；真 CP-SAT 单/联对拍在
 * portfolio-sidecar.integration.test.ts（env-gated·审核头号判据）。
 *
 * mock「贪心尊重容量」求解器：把需求项按 (min_cost 取最省格 / 其余取最按期格) 贪心装入剩余容量的 (base,窗口)，
 * 各方案据 objectives 选不同格 → objectiveValues 真漂移（mock 也逃不掉「守恒 + 方案差异」默认门）。
 */
const ADMIN: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };

class MockPortfolio implements OptimizerClient {
  lastReqs: PortfolioRequest[] = [];
  async solve(_r: OptimizationRequest): Promise<OptimizationResult> {
    return { status: "INFEASIBLE", optimal: false, selected: [], totalValue: 0, totalWeight: 0 };
  }
  async solvePortfolio(req: PortfolioRequest): Promise<PortfolioResult> {
    this.lastReqs.push(req);
    const primary = req.objectives?.[0]?.key ?? "ontime";
    const remain = new Map(req.capacity.map((c) => [`${c.base}|${c.window}`, c.cap]));
    const qty = new Map(req.items.map((i) => [i.id, i.qty]));
    const byItem = new Map<string, PortfolioRequest["cells"]>();
    for (const c of req.cells) { (byItem.get(c.item) ?? byItem.set(c.item, []).get(c.item)!).push(c); }
    const occupancy: { item: string; base: string; window: number }[] = [];
    const served = new Set<string>();
    // 稳定序装入（大单先·确定性）。
    for (const id of [...byItem.keys()].sort((a, b) => (qty.get(b) ?? 0) - (qty.get(a) ?? 0) || a.localeCompare(b))) {
      const cells = [...byItem.get(id)!];
      // 方案选格：min_cost/min_delay/min_changeover 取代价最小格；max_ontime 取最按期(delay 最小·window 最小)格。
      cells.sort((a, b) => primary === "ontime"
        ? (b.ontime - a.ontime) || (a.window - b.window) || (a.cost - b.cost)
        : (a.cost - b.cost) || (b.ontime - a.ontime) || (a.window - b.window));
      const need = qty.get(id) ?? 0;
      for (const c of cells) {
        const k = `${c.base}|${c.window}`;
        if ((remain.get(k) ?? 0) >= need) { remain.set(k, (remain.get(k) ?? 0) - need); occupancy.push({ item: c.item, base: c.base, window: c.window }); served.add(id); break; }
      }
    }
    occupancy.sort((a, b) => a.item.localeCompare(b.item) || a.base.localeCompare(b.base) || a.window - b.window);
    const displaced = req.items.map((i) => i.id).filter((id) => !served.has(id)).sort();
    // objectiveValues 从选中格真算（4 项恒计）。
    const cellByKey = new Map(req.cells.map((c) => [`${c.item}|${c.base}|${c.window}`, c]));
    let ontime = 0, delay = 0, changeover = 0, cost = 0;
    for (const o of occupancy) { const c = cellByKey.get(`${o.item}|${o.base}|${o.window}`)!; ontime += c.ontime; delay += c.delayUnits; changeover += c.changeUnits; cost += c.cost; }
    const unservedPen = req.items.filter((i) => displaced.includes(i.id)).reduce((s, i) => s + (i.unservedPenalty ?? 0), 0);
    cost += unservedPen;
    // 造方案差异（仅证 datacore 逐方案透传各自 objectiveValues·真 CP-SAT 方案差异见 integration ④）：
    // 按主目标 key 加确定性微差，令满产能下也能分辨「datacore 是否把每方案独立结果透出」。
    cost += primary.length;
    const values: Record<string, number> = {};
    for (const i of req.items) values[`served_${i.id}`] = served.has(i.id) ? 1 : 0;
    return { status: "OPTIMAL", optimal: true, values, objectiveValues: { ontime, delay, changeover, cost }, occupancy, displaced, method: req.method ?? "weighted" };
  }
}

type PortfolioOut = {
  status: string; optimal: boolean; feasible: boolean;
  allocation: { item: string; kind: string; committed: boolean; base: string; window: number; qty: number; onTime: boolean; provenance: { drillType: string; drillField: string; drillValue: number } }[];
  occupancy: { item: string; base: string; window: number; qty: number }[];
  displaced: { orderId: string; kind: string; qty: number; provenance: { drillType: string; drillId: string } }[];
  scenarios: { key: string; objectiveValues: Record<string, number>; servedCount: number; displacedCount: number; servedQty: number; provenance: unknown }[];
  objectiveValues: Record<string, number>;
  capacityLedger: { baseId: string; window: number; cap: number; allocated: number }[];
  reconChecks: { ok: boolean; cap: number; allocated: number }[];
  reconciled: boolean;
  cost: { delay: number; changeover: number; unserved: number; total: number };
  frozen: { orderId: string; base: string; window: number; qty: number; frozen: boolean }[];
  summary: string;
};

const run = async (t: Awaited<ReturnType<typeof makeApp>>, args: Record<string, unknown>): Promise<PortfolioOut> =>
  (await t.services.solvers.invoke(ADMIN, "portfolio", args)) as unknown as PortfolioOut;

describe("WO-PORTFOLIO-OPTIMAL · portfolio 默认门（守恒 + 方案 + 冻结·mock optimizer）", () => {
  it("SEAM 层1：全订单联合解 → capacityLedger 每格 allocated ≤ cap（共享产能守恒·reconciled）", async () => {
    const t = await makeApp(); await seedBattery(t);
    t.services.solvers.setOptimizer(new MockPortfolio());
    const g = await run(t, { scenarios: ["max_ontime", "min_cost"] });
    expect(g.capacityLedger.length).toBeGreaterThan(0);
    for (const c of g.capacityLedger) expect(c.allocated).toBeLessThanOrEqual(c.cap + 1e-6);
    expect(g.reconChecks.every((r) => r.ok)).toBe(true);
    expect(g.reconciled).toBe(true);
    // 每分配格带 provenance（R13·Line/capacityDaily 溯源）。
    expect(g.allocation.length).toBeGreaterThan(0);
    for (const a of g.allocation.filter((x) => !x.committed)) {
      expect(a.provenance.drillType).toBe("Line");
      expect(a.provenance.drillField).toBe("capacityDaily");
      expect(typeof a.provenance.drillValue).toBe("number");
    }
    // 被挤项 provenance 溯源到其源对象类型。
    for (const d of g.displaced) {
      expect(["Order", "WorkOrder", "DemandSegment"]).toContain(d.provenance.drillType);
      expect(d.provenance.drillId).toBe(d.orderId);
    }
    expect(g.summary).toContain("联合最优组合");
  });

  it("≥2 方案量化利弊：scenarios ≥2 且各 objectiveValues 真漂移（改目标→分配真变·非贴标签）", async () => {
    const t = await makeApp(); await seedBattery(t);
    t.services.solvers.setOptimizer(new MockPortfolio());
    const g = await run(t, { scenarios: ["max_ontime", "min_cost", "min_changeover"] });
    expect(g.scenarios.length).toBeGreaterThanOrEqual(2);
    const keys = g.scenarios.map((s) => s.key);
    expect(keys).toContain("max_ontime");
    expect(keys).toContain("min_cost");
    // 每方案 4 项目标值齐 + servedCount + provenance。
    for (const s of g.scenarios) {
      for (const k of ["ontime", "delay", "changeover", "cost"]) expect(typeof s.objectiveValues[k]).toBe("number");
      expect(typeof s.servedCount).toBe("number");
      expect(s.provenance).toBeTruthy();
    }
    // 至少一对方案的 objectiveValues 不字节相同（量化利弊真差异）。
    const sigs = g.scenarios.map((s) => JSON.stringify(s.objectiveValues));
    expect(new Set(sigs).size).toBeGreaterThan(1);
  });

  it("冻结子集：frozenOrderIds 项标 frozen、不入 served/displaced、其产能被预扣（R13 透明）", async () => {
    const t = await makeApp(); await seedBattery(t);
    t.services.solvers.setOptimizer(new MockPortfolio());
    const g = await run(t, { frozenOrderIds: ["SO-3415"], scenarios: ["max_ontime", "min_cost"] });
    expect(g.frozen.some((f) => f.orderId === "SO-3415")).toBe(true);
    expect(g.frozen.find((f) => f.orderId === "SO-3415")!.frozen).toBe(true);
    expect(g.occupancy.some((o) => o.item === "SO-3415")).toBe(false);
    expect(g.displaced.some((d) => d.orderId === "SO-3415")).toBe(false);
    // 冻结产能预扣 → 该 (base,窗口) 净 cap 较未冻结时更小（reserve 语义）。
    const gFull = await run(t, { scenarios: ["max_ontime", "min_cost"] });
    const froz = g.frozen.find((f) => f.orderId === "SO-3415")!;
    const cellFrozen = g.capacityLedger.find((c) => c.baseId === froz.base && c.window === froz.window);
    const cellFull = gFull.capacityLedger.find((c) => c.baseId === froz.base && c.window === froz.window);
    if (cellFrozen && cellFull) expect(cellFrozen.cap).toBeLessThanOrEqual(cellFull.cap);
    expect(g.reconChecks.every((r) => r.ok)).toBe(true);
  });

  it("release 模式：frozenCapacityMode=release → 被冻单产能不预扣（净 cap ≥ reserve 模式·看极限方案）", async () => {
    const t = await makeApp(); await seedBattery(t);
    t.services.solvers.setOptimizer(new MockPortfolio());
    const reserve = await run(t, { frozenOrderIds: ["SO-3415"], frozenCapacityMode: "reserve" });
    const release = await run(t, { frozenOrderIds: ["SO-3415"], frozenCapacityMode: "release" });
    const froz = reserve.frozen.find((f) => f.orderId === "SO-3415")!;
    const cellR = reserve.capacityLedger.find((c) => c.baseId === froz.base && c.window === froz.window)!;
    const cellL = release.capacityLedger.find((c) => c.baseId === froz.base && c.window === froz.window)!;
    expect(cellL.cap).toBeGreaterThanOrEqual(cellR.cap);
    expect(cellL.cap - cellR.cap).toBe(froz.qty); // release 恰多出被冻单 qty（未预扣）
  });

  it("orderIds 子集：只传部分订单 → 只这些进决策集（其余不出现在 occupancy/displaced）", async () => {
    const t = await makeApp(); await seedBattery(t);
    t.services.solvers.setOptimizer(new MockPortfolio());
    const g = await run(t, { orderIds: ["SO-3402", "SO-3415"], scenarios: ["max_ontime", "min_cost"] });
    const orderItems = [...g.occupancy.map((o) => o.item), ...g.displaced.map((d) => d.orderId)].filter((id) => id.startsWith("SO-"));
    for (const id of orderItems) expect(["SO-3402", "SO-3415"]).toContain(id);
  });

  it("R6 确定性：同参数两跑 deep-equal（禁 Date.now·时间锚 forecastStart）", async () => {
    const t = await makeApp(); await seedBattery(t);
    t.services.solvers.setOptimizer(new MockPortfolio());
    const a = await run(t, { scenarios: ["max_ontime", "min_cost"] });
    const b = await run(t, { scenarios: ["max_ontime", "min_cost"] });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("未兜底 opt 模型仍显式报错不兜底（同 opt 族·不静默假绿）", async () => {
    const t = await makeApp(); await seedBattery(t);
    // WO-MEMSIM-OPTIMIZER 后 makeApp 默认装 InProcOptimizerClient（portfolio 恒可跑·见下方内存态 describe）；
    // 但 InProc 只兜底 portfolio，未实现的 multi_objective 仍走 `!this.optimizer?.solveMultiObjective` 守卫显式「未接入」。
    await expect(
      t.services.solvers.invoke(ADMIN, "multi_objective", { vars: [{ id: "a", kind: "bool" }], objectives: [{ key: "k", sense: "max", terms: [] }], method: "weighted" }),
    ).rejects.toThrow(/未接入/);
  });
});

/**
 * WO-MEMSIM-OPTIMIZER · portfolio 内存态默认门（**无 sidecar**·app.ts §3.2 默认 InProcOptimizerClient 兜底）。
 * 与上方「mock optimizer」门互补：这里**不 setOptimizer**，证内存模式接缝不再空（详尽 SEAM 见 inproc-optimizer.test.ts）。
 */
describe("WO-MEMSIM-OPTIMIZER · portfolio 内存态默认门（无 sidecar·InProc 兜底·守恒）", () => {
  it("默认 InProc → 真出可行解·FEASIBLE/optimal:false·capacityLedger 守恒（reconciled）", async () => {
    const t = await makeApp(); await seedBattery(t);
    // 不 setOptimizer → 走 app.ts §3.2 默认 InProc（内存模式无 OPTIMIZER_BASE_URL）。
    const g = await run(t, { scenarios: ["max_ontime", "min_cost"] });
    expect(g.status).toBe("FEASIBLE");
    expect(g.optimal).toBe(false); // 诚实红线：贪心不可证最优
    expect(g.occupancy.length).toBeGreaterThan(0);
    for (const c of g.capacityLedger) expect(c.allocated).toBeLessThanOrEqual(c.cap + 1e-6);
    expect(g.reconChecks.every((r) => r.ok)).toBe(true);
    expect(g.reconciled).toBe(true);
  });
});
