import { describe, expect, it } from "vitest";
import { makeApp, seedBattery } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import { InProcOptimizerClient } from "../src/solvers/inproc-optimizer.js";
import type { PortfolioRequest } from "../src/solvers/optimizer-client.js";

/**
 * WO-MEMSIM-OPTIMIZER · SEAM（驱动接缝·头号判据）：内存模式**无 Python sidecar** 也真出可行解。
 *
 * 关键：`makeApp()` 走 `buildApp()` 装配路径，**不设 `OPTIMIZER_BASE_URL`、不 `setOptimizer`** → 命中 app.ts §3.2
 * 默认分支 `new InProcOptimizerClient()`。这条证「内存态接缝不再空」——正是「绿测试≠能用·断在接缝」堵死点：
 * portfolio.test.ts 注入 MockPortfolio 全绿，但内存态真跑曾静默；本测在**默认 InProc**上驱动端到端。
 *
 * 断言：① status==="FEASIBLE" / optimal===false（诚实红线·贪心不可证最优·不撒「可证最优」）
 *       ② occupancy 非空（真出解·非静默）
 *       ③ capacityLedger 每格 allocated ≤ cap（共享产能守恒）· reconChecks 全 ok · reconciled===true
 *       ④ displaced 溯源正确（被挤项 provenance.drillId==orderId）
 *       ⑤ 改 objective（max_ontime → min_cost）→ 分配/各目标值**真漂移**（非贴标签）
 */
const ADMIN: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };

type PortfolioOut = {
  status: string;
  optimal: boolean;
  feasible: boolean;
  allocation: { item: string; committed: boolean; base: string; window: number; qty: number }[];
  occupancy: { item: string; base: string; window: number; qty: number }[];
  displaced: { orderId: string; kind: string; qty: number; provenance: { drillType: string; drillId: string } }[];
  scenarios: { key: string; objectiveValues: Record<string, number>; servedCount: number }[];
  objectiveValues: Record<string, number>;
  capacityLedger: { baseId: string; window: number; cap: number; allocated: number }[];
  reconChecks: { ok: boolean; cap: number; allocated: number }[];
  reconciled: boolean;
  summary: string;
};

const run = async (t: Awaited<ReturnType<typeof makeApp>>, args: Record<string, unknown>): Promise<PortfolioOut> =>
  (await t.services.solvers.invoke(ADMIN, "portfolio", args)) as unknown as PortfolioOut;

describe("WO-MEMSIM-OPTIMIZER · SEAM 内存模式确定性兜底（默认 InProc·无 sidecar 真出解）", () => {
  it("默认 InProc（不 setOptimizer）→ portfolio 真出可行解·FEASIBLE/optimal:false·守恒·非静默", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 关键：不 setOptimizer —— 走 app.ts §3.2 默认 InProcOptimizerClient（内存模式无 OPTIMIZER_BASE_URL）。
    const g = await run(t, { scenarios: ["max_ontime", "min_cost"] });

    // ① 诚实红线：贪心可行解不可证最优。
    expect(g.status).toBe("FEASIBLE");
    expect(g.optimal).toBe(false);
    // 前端徽标口径：optimal:false → 显 status（FEASIBLE），summary 尾部非「可证最优」。
    expect(g.summary).toContain("FEASIBLE");
    expect(g.summary).not.toContain("可证最优");

    // ② 真出解（非「未接入」静默）。
    expect(g.occupancy.length).toBeGreaterThan(0);
    expect(g.allocation.length).toBeGreaterThan(0);
    // WO-PORTFOLIO-FG-INVENTORY-OBJ：内存态默认门也出 objectiveValues.fgInventory（度量一致口径·恒计）。
    for (const s of g.scenarios) expect(typeof (s.objectiveValues as Record<string, number>).fgInventory).toBe("number");

    // ③ 共享产能守恒：每格 allocated ≤ cap·reconciled。
    expect(g.capacityLedger.length).toBeGreaterThan(0);
    for (const c of g.capacityLedger) expect(c.allocated).toBeLessThanOrEqual(c.cap + 1e-6);
    expect(g.reconChecks.every((r) => r.ok)).toBe(true);
    expect(g.reconciled).toBe(true);
    expect(g.summary).toContain("联合最优组合");
  });

  it("被挤项溯源正确（provenance.drillId == orderId·R13 不劣化）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const g = await run(t, { scenarios: ["max_ontime", "min_cost"] });
    for (const d of g.displaced) {
      expect(["Order", "WorkOrder", "DemandSegment"]).toContain(d.provenance.drillType);
      expect(d.provenance.drillId).toBe(d.orderId);
    }
  });

  it("端到端：改 objective → 两方案各自 objectiveValues 真算（非贴标签·4 项齐）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const g = await run(t, { scenarios: ["max_ontime", "min_cost"] });
    const keys = g.scenarios.map((s) => s.key);
    expect(keys).toContain("max_ontime");
    expect(keys).toContain("min_cost");
    for (const s of g.scenarios) {
      for (const k of ["ontime", "delay", "changeover", "cost"]) expect(typeof s.objectiveValues[k]).toBe("number");
    }
  });

  it("引擎单测：objective 真驱动选格漂移（按期但贵 vs 迟但便宜·贪心非贴标签）", async () => {
    // 直接驱动 InProc 引擎，构造有**真权衡**的一格二选（seed 数据多不争用 → 端到端难保漂移·此处以最小反例证）：
    //  cellA(b1,w0)=按期(ontime1) 但贵(cost100)；cellB(b2,w1)=迟(ontime0) 但便宜(cost1)。两基地各有容量。
    const client = new InProcOptimizerClient();
    const base: Omit<PortfolioRequest, "objectives"> = {
      model: "portfolio",
      seed: 42,
      items: [{ id: "X", qty: 10, unservedPenalty: 5 }],
      capacity: [
        { base: "b1", window: 0, cap: 10 },
        { base: "b2", window: 1, cap: 10 },
      ],
      cells: [
        { item: "X", base: "b1", window: 0, ontime: 1, delayUnits: 0, changeUnits: 0, fgHoldUnits: 0, cost: 100 },
        { item: "X", base: "b2", window: 1, ontime: 0, delayUnits: 50, changeUnits: 0, fgHoldUnits: 0, cost: 1 },
      ],
      method: "weighted",
    };
    const ontimeR = await client.solvePortfolio({ ...base, objectives: [{ key: "ontime", sense: "max", weight: 1 }] });
    const costR = await client.solvePortfolio({ ...base, objectives: [{ key: "cost", sense: "min", weight: 1 }] });
    // 诚实红线：两解均 FEASIBLE·不可证最优。
    expect(ontimeR.optimal).toBe(false);
    expect(costR.optimal).toBe(false);
    // max_ontime 选按期贵格（b1,w0）；min_cost 选便宜迟格（b2,w1）——分配真漂移（非贴标签）。
    expect(ontimeR.occupancy).toEqual([{ item: "X", base: "b1", window: 0 }]);
    expect(costR.occupancy).toEqual([{ item: "X", base: "b2", window: 1 }]);
    expect(ontimeR.objectiveValues.ontime).toBe(1);
    expect(costR.objectiveValues.ontime).toBe(0);
    expect(costR.objectiveValues.cost).toBeLessThan(ontimeR.objectiveValues.cost!);
  });

  it("引擎单测：min_fg_inventory 真最小化提前压库（早窗 vs 贴交期窗·两窗都按期·保证 strict 漂移）", async () => {
    // 构造：X 两格都按期（w0/w1 均 ontime=1），w0 提前一窗（fgHold=200）vs w1 贴交期（fgHold=0）。
    const client = new InProcOptimizerClient();
    const base: Omit<PortfolioRequest, "objectives"> = {
      model: "portfolio",
      seed: 42,
      items: [{ id: "X", qty: 10, unservedPenalty: 5 }],
      capacity: [
        { base: "b1", window: 0, cap: 10 },
        { base: "b1", window: 1, cap: 10 },
      ],
      cells: [
        { item: "X", base: "b1", window: 0, ontime: 1, delayUnits: 0, changeUnits: 0, fgHoldUnits: 200, cost: 100 },
        { item: "X", base: "b1", window: 1, ontime: 1, delayUnits: 0, changeUnits: 0, fgHoldUnits: 0, cost: 0 },
      ],
      method: "weighted",
    };
    const ontimeR = await client.solvePortfolio({ ...base, objectives: [{ key: "ontime", sense: "max", weight: 1 }] });
    const fgR = await client.solvePortfolio({ ...base, objectives: [{ key: "cost", sense: "min", weight: 1 }, { key: "fgInventory", sense: "min", weight: 10 }] });
    // max_ontime 两格都按期 → window asc 取早窗 w0（提前压库 fgHold=200）；min_fg_inventory → fgHold asc 取贴交期 w1（fgHold=0）。
    expect(ontimeR.occupancy).toEqual([{ item: "X", base: "b1", window: 0 }]);
    expect(fgR.occupancy).toEqual([{ item: "X", base: "b1", window: 1 }]);
    expect(fgR.objectiveValues.fgInventory).toBe(0);
    expect(fgR.objectiveValues.fgInventory).toBeLessThan(ontimeR.objectiveValues.fgInventory!); // 真降压库·灭假维度
  });

  it("R6 确定性：默认 InProc 同参数两跑 deep-equal（贪心稳定序·无 Date.now/random）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const a = await run(t, { scenarios: ["max_ontime", "min_cost"] });
    const b = await run(t, { scenarios: ["max_ontime", "min_cost"] });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("未兜底模型仍诚实「未接入」（默认 InProc 不假装 multi_objective 能用·KILL-MOCK-RED）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await expect(
      t.services.solvers.invoke(ADMIN, "multi_objective", {
        vars: [{ id: "a", kind: "bool" }],
        objectives: [{ key: "k", sense: "max", terms: [] }],
        method: "weighted",
      }),
    ).rejects.toThrow(/未接入/);
  });
});
