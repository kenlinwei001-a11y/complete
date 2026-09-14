import { afterEach, describe, expect, it } from "vitest";
import { makeApp, seedBattery } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import type {
  OptimizerClient, OptimizationRequest, OptimizationResult,
  PortfolioRequest, PortfolioResult,
} from "../src/solvers/optimizer-client.js";

/**
 * WO-D2 · DataCore 自有求解预算 → **超时前先把可行解（incumbent）交出去**（效果层断言）。
 *
 * 为什么预算必须落在 DataCore：调用方 AgentCore `/b/v1/solvers/{key}/run` 超时后会 **abort 那条 OBO fetch**
 * （WO-D1 的真取消）——连接一断，DataCore 就算下一毫秒求出解也**没有回程通道**。所以「超时前先回可行解」
 * 只有一种做法：DataCore 自己盯着预算，在调用方放弃**之前**把已求到的可行解交出去（配置纪律：
 * `SOLVER_INCUMBENT_BUDGET_MS` < AgentCore `SOLVER_RUN_TIMEOUT_MS`）。B 侧那一半在
 * `apps/agentcore/test/solver-timeout-incumbent-seam.test.ts` ⑦ 对接。
 *
 * 本文件驱动的是**真接缝**：env → `solvers/service.ts` 派生 deadline → `portfolio.ts` 提前收手 → 返回体自述。
 * 每条断言都配对照组，防「本来就那样」的假绿：
 *   ① 预算到点 → incumbent:true / optimal:false / 漏了哪些方案全列 / **真解还在**；对照：不设预算 → 逐字节旧行为
 *   ② 预算充裕 → **不误报** incumbent（旋钮不是常开）
 *   ③ 预算早已过期，但主方案还没解出来 → **继续解到主方案为止**，绝不交一个没有可行解的空 incumbent
 */

const ADMIN: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
const ENV_KEY = "SOLVER_INCUMBENT_BUDGET_MS";

/** 尊重容量的贪心 mock（形状合法解）+ 每次求解**可控耗时**（让预算到点是确定事件，不靠机器快慢碰运气）。 */
class SlowMockPortfolio implements OptimizerClient {
  solveCount = 0;
  constructor(private readonly perSolveMs: number) {}
  async solve(_r: OptimizationRequest): Promise<OptimizationResult> {
    return { status: "INFEASIBLE", optimal: false, selected: [], totalValue: 0, totalWeight: 0 };
  }
  async solvePortfolio(req: PortfolioRequest): Promise<PortfolioResult> {
    this.solveCount += 1;
    await new Promise((r) => setTimeout(r, this.perSolveMs));
    const remain = new Map(req.capacity.map((c) => [`${c.base}|${c.window}`, c.cap]));
    const qty = new Map(req.items.map((i) => [i.id, i.qty]));
    const byItem = new Map<string, PortfolioRequest["cells"]>();
    for (const c of req.cells) (byItem.get(c.item) ?? byItem.set(c.item, []).get(c.item)!).push(c);
    const occupancy: { item: string; base: string; window: number }[] = [];
    const served = new Set<string>();
    for (const id of [...byItem.keys()].sort((a, b) => (qty.get(b) ?? 0) - (qty.get(a) ?? 0) || a.localeCompare(b))) {
      const cells = [...byItem.get(id)!].sort((a, b) => (b.ontime - a.ontime) || (a.window - b.window) || (a.cost - b.cost));
      const need = qty.get(id) ?? 0;
      for (const c of cells) {
        const k = `${c.base}|${c.window}`;
        if ((remain.get(k) ?? 0) >= need) {
          remain.set(k, (remain.get(k) ?? 0) - need);
          occupancy.push({ item: c.item, base: c.base, window: c.window });
          served.add(id);
          break;
        }
      }
    }
    occupancy.sort((a, b) => a.item.localeCompare(b.item) || a.base.localeCompare(b.base) || a.window - b.window);
    const displaced = req.items.map((i) => i.id).filter((id) => !served.has(id)).sort();
    const values: Record<string, number> = {};
    for (const i of req.items) values[`served_${i.id}`] = served.has(i.id) ? 1 : 0;
    // 自报可证最优 —— 于是「optimal:false」只可能来自 portfolio 层的 incumbent 降级（判据不被 mock 顶掉）。
    return { status: "OPTIMAL", optimal: true, values, objectiveValues: { ontime: occupancy.length, delay: 0, changeover: 0, fgInventory: 0, cost: 0 }, occupancy, displaced, method: req.method ?? "weighted" };
  }
}

interface PortOut {
  status: string;
  optimal: boolean;
  allocation: { item: string; base: string; window: number; qty: number }[];
  occupancy: { item: string; base: string; window: number; qty: number }[];
  scenarios: { key: string }[];
  summary: string;
  incumbent?: boolean;
  incumbentReason?: string;
  solvedScenarios?: string[];
  plannedScenarios?: string[];
}

const SCENARIOS = ["max_ontime", "min_cost", "min_delay"];

async function boot(perSolveMs: number): Promise<{ t: Awaited<ReturnType<typeof makeApp>>; opt: SlowMockPortfolio }> {
  const t = await makeApp();
  await seedBattery(t);
  const opt = new SlowMockPortfolio(perSolveMs);
  t.services.solvers.setOptimizer(opt);
  return { t, opt };
}

const invoke = async (t: Awaited<ReturnType<typeof makeApp>>, args: Record<string, unknown>): Promise<PortOut> =>
  (await t.services.solvers.invoke(ADMIN, "portfolio", args)) as unknown as PortOut;

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe("WO-D2 · DataCore 求解预算 → 超时前交出可行解（incumbent）", () => {
  it("① 预算到点 → incumbent 诚实自述（非最优 + 漏了哪些方案）且**真解还在**；对照：不设预算 → 旧行为字节不变", async () => {
    const { t, opt } = await boot(40);

    // —— 对照组先跑（证明同一入参在不设预算时是完整最优解）——
    delete process.env[ENV_KEY];
    const full = await invoke(t, { scenarios: SCENARIOS });
    expect(full.incumbent).toBeUndefined(); // 加性字段不出现 → 既有消费方字节不变
    expect(full.incumbentReason).toBeUndefined();
    expect(full.solvedScenarios).toBeUndefined();
    expect(full.optimal).toBe(true);
    expect(full.scenarios.map((s) => s.key)).toEqual(SCENARIOS);
    expect(full.summary.startsWith("【非最优")).toBe(false);
    const fullSolves = opt.solveCount;
    expect(fullSolves).toBe(SCENARIOS.length); // 三个方案都真解了

    // —— 实验组：预算 1ms（第一次求解一返回就已过期）——
    process.env[ENV_KEY] = "1";
    opt.solveCount = 0;
    const inc = await invoke(t, { scenarios: SCENARIOS });

    // 诚实自述：这是可行解不是最优解
    expect(inc.incumbent).toBe(true);
    expect(inc.optimal).toBe(false); // mock 自报 OPTIMAL 也被降级 —— 方案集没算全就谈不上最优
    expect(String(inc.incumbentReason)).toContain("预算耗尽");
    expect(inc.summary.startsWith("【非最优·可行解 incumbent】")).toBe(true);
    // 漏了哪些方案，逐个说清楚（真值·非占位）
    expect(inc.solvedScenarios).toEqual(["max_ontime"]);
    expect(inc.plannedScenarios).toEqual(SCENARIOS);
    expect(opt.solveCount).toBe(1); // 真的没再往下烧（提前收手，不是算完再标）
    expect(opt.solveCount).toBeLessThan(fullSolves);
    // **可行解真的在**（不是只给一句"超时了"）
    expect(inc.allocation.length).toBeGreaterThan(0);
    expect(inc.occupancy.length).toBeGreaterThan(0);
    expect(inc.scenarios.length).toBe(1);
  }, 60_000);

  it("② 预算充裕 → 不误报 incumbent（旋钮不是常开）", async () => {
    const { t, opt } = await boot(1);
    process.env[ENV_KEY] = "60000";
    const out = await invoke(t, { scenarios: SCENARIOS });
    expect(out.incumbent).toBeUndefined();
    expect(out.optimal).toBe(true);
    expect(out.scenarios.map((s) => s.key)).toEqual(SCENARIOS);
    expect(opt.solveCount).toBe(SCENARIOS.length);
  }, 60_000);

  it("③ 预算早已过期但主方案未解出 → 继续解到主方案为止，绝不交没有可行解的空 incumbent", async () => {
    const { t, opt } = await boot(20);
    process.env[ENV_KEY] = "1"; // 一开局就过期
    // objective 指向方案集的**第二个** → 第一轮解的不是主方案，此时 primaryResult 还没有 ⇒ 不许收手
    const out = await invoke(t, { scenarios: SCENARIOS, objective: "min_cost" });
    expect(out.incumbent).toBe(true);
    expect(out.solvedScenarios).toEqual(["max_ontime", "min_cost"]); // 一直解到主方案拿到可行解才停
    expect(opt.solveCount).toBe(2);
    expect(out.occupancy.length).toBeGreaterThan(0); // 主方案的真可行解
    expect(out.optimal).toBe(false);
  }, 60_000);
});
