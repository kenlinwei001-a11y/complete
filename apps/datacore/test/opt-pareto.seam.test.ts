import { describe, expect, it } from "vitest";
import { makeApp, ADMIN } from "./helpers.js";
import type { OptimizerClient, OptimizationRequest, OptimizationResult, MultiObjectiveRequest, MultiObjectiveResult } from "../src/solvers/optimizer-client.js";
import type { ParetoObjective, ParetoRequest, ParetoResult, ParetoSolution } from "@platform/contracts";
import { ParetoResultSchema } from "@platform/contracts";
import { runOptimizePareto, PARETO_TIGHT_EPS, paretoSolutionId } from "../src/solvers/opt-pareto.js";
import type { SolveArgsFn } from "../src/solvers/opt-whatif.js";

/**
 * WO-SIM-BE-PARETO · **帕累托解集接缝门**。
 *
 * ══ 为什么这条测试不是"各半 unit" ═══════════════════════════════════════════════
 *
 * 解集这件事有三个半：契约（方向声明 + 解形状）、引擎（支配剔除）、路由（沙盘打得到）。
 * 三半各自绿是没用的 —— 前沿算对了但路由没挂上、或方向字段没透出去让前端自己猜方向，
 * 用户看到的都是"一条画错了的曲线"。所以本门两层都驱动：
 *   · 纯函数层：用 stub `solve` 喂一张**手算过的 9 点表**，逐对验支配剔除（①②③）与确定性（④）；
 *   · 路由层：`POST /a/v1/sim/optimize-pareto` 真打，经真 `solvers.invoke("multi_objective")`
 *     → mock 优化器按**扰动后的权重**回放读数 ⇒ 路由/契约/扰动施加/求解/剔除任一半退化即红。
 *
 * ══ ⚠️ 本文件为什么自带一份 `oracleDominates`（"抄一份"在这里是对的）═══════════════
 *
 * CLAUDE.md 铁律 0.6 说门里的**金丝雀**必须与主逻辑共用同一份实现，抄一份就是装饰品。
 * 但**变异反证的判官（oracle）恰恰相反**：若这里 import 生产的 `dominates`，
 * 那么把生产判据从 `<=` 改成 `<` 时，判官也跟着变 —— 断言两边同时位移，**测试照样绿**，
 * 变异反证就成了摆设。所以判官必须独立成立：下面这份按**数学定义**手写，
 * 且刻意只用 `>` / `<` 两个算符（不含 `<=`），使得针对生产 `<=` 的变异**碰不到它**。
 */

// ── 独立判官（不 import 生产实现，理由见文件头）────────────────────────────────
const oracleDominates = (a: ParetoSolution, b: ParetoSolution, objs: readonly ParetoObjective[]): boolean => {
  const nv = (s: ParetoSolution, o: ParetoObjective): number => (o.dir === "max" ? -s.metrics[o.key]! : s.metrics[o.key]!);
  let noWorse = true;
  let someBetter = false;
  for (const o of objs) {
    if (nv(a, o) > nv(b, o)) noWorse = false;
    if (nv(a, o) < nv(b, o)) someBetter = true;
  }
  return noWorse && someBetter;
};

// ── 固定装置：两根杠杆 × 三档 = 9 个候选，读数手算过 ────────────────────────────
//
//   days = 30 − 0.5·OT − 2·OS      （OT = 加班档 0/8/16，OS = 外协档 0/2/4）
//   cost = 3·OS                     （**只依赖 OS** ⇒ 同 OS 的三个候选在 cost 上必然打平）
//
// 「cost 打平」是刻意设计的：**弱支配与强支配的差别只在打平时才显形**。
// 若九个点两两都不打平，把 `<=` 改成 `<` 结果一模一样，变异反证就抓不到东西。
//
//   (OT,OS) → (days, cost)                     判定（两目标皆 min）
//   (16, 0) → (22,  0)   前沿
//   (16, 2) → (18,  6)   前沿
//   (16, 4) → (14, 12)   前沿
//   ( 0, 0) → (30,  0)   被 (16,0) 支配 —— cost 打平、days 更差 ⇒ **仅弱支配**
//   ( 8, 0) → (26,  0)   被 (16,0) 支配 —— 同上，**仅弱支配**
//   ( 8, 2) → (22,  6)   被 (16,0) 支配 —— days 打平(22)、cost 更差 ⇒ **仅弱支配**
//   ( 8, 4) → (18, 12)   被 (16,2) 支配 —— days 打平(18)、cost 更差 ⇒ **仅弱支配**
//   ( 0, 2) → (26,  6)   被 (16,0) 严格支配（22<26 且 0<6）
//   ( 0, 4) → (22, 12)   被 (16,2) 严格支配（18<22 且 6<12）
//
// ⇒ 正确前沿 3 个 · 被支配 6 个（其中 **4 个仅弱支配**）。
//   把判据改成强支配后，那 4 个不再被判被支配 ⇒ 混进前沿 ⇒ ①② 当场红。
const DAYS = "chainNonValueDays";
const COST = "outsourceCostWan";
const OBJECTIVES: ParetoObjective[] = [
  { key: DAYS, dir: "min", label: "全链非增值天数", unit: "天" },
  { key: COST, dir: "min", label: "外协成本", unit: "万元" },
];
const OT_TARGET = "facilities.OT.openCost";
const OS_TARGET = "facilities.OS.openCost";
const BASE_ARGS = {
  facilities: [{ id: "OT", openCost: 0 }, { id: "OS", openCost: 0 }],
  clients: [{ id: "C1" }],
  assignCosts: [{ client: "C1", facility: "OT", cost: 1 }],
};
const metricsOfLevers = (ot: number, os: number) => ({ [DAYS]: 30 - 0.5 * ot - 2 * os, [COST]: 3 * os });

/** stub solve：从**扰动后的 args** 读回两个档位 → 回放读数（证扰动真施加了，不是回放常数）。 */
const stubSolve: SolveArgsFn = async (_fam, a) => {
  const facs = a.facilities as { id: string; openCost: number }[];
  const ot = facs.find((f) => f.id === "OT")!.openCost;
  const os = facs.find((f) => f.id === "OS")!.openCost;
  return { status: "OPTIMAL", optimal: true, objectiveValues: metricsOfLevers(ot, os) };
};

const REQ: ParetoRequest = {
  sessionId: "sess-pareto-1",
  family: "facility_location",
  args: BASE_ARGS,
  objectives: OBJECTIVES,
  levers: [
    { key: OT_TARGET, label: "加班", values: [16, 0, 8] }, // 刻意乱序：内部去重+升序 ⇒ 结果与书写序无关（R6）
    { key: OS_TARGET, label: "外协", values: [4, 2, 0] },
  ],
  constraints: [{ key: COST, limit: 12 }],
};

const idOf = (ot: number, os: number) => paretoSolutionId([{ key: OT_TARGET, value: ot }, { key: OS_TARGET, value: os }]);
const EXPECTED_FRONTIER_IDS = [idOf(16, 4), idOf(16, 2), idOf(16, 0)]; // compareSolutions：days 升序
const EXPECTED_DOMINATED_IDS = [idOf(0, 0), idOf(0, 2), idOf(0, 4), idOf(8, 0), idOf(8, 2), idOf(8, 4)];

describe("WO-SIM-BE-PARETO · 帕累托解集（支配剔除 · 确定性 · 绑定裕度）", () => {
  it("① frontier[] 两两互不支配（逐对，不是抽查）", async () => {
    const r = await runOptimizePareto(stubSolve, REQ);
    // 金丝雀（铁律 0.6）：先证判官会说话 —— 一对**已知必然成立**的支配关系必须被它判为真。
    // 判官恒 false 的话，「两两互不支配」会无条件通过，本条就成了装饰品。
    const canaryA: ParetoSolution = { id: "a", label: "a", levers: [{ key: "k", value: 1 }], metrics: { [DAYS]: 22, [COST]: 0 }, bindings: [], feasible: true };
    const canaryB: ParetoSolution = { id: "b", label: "b", levers: [{ key: "k", value: 2 }], metrics: { [DAYS]: 30, [COST]: 0 }, bindings: [], feasible: true };
    expect(oracleDominates(canaryA, canaryB, OBJECTIVES)).toBe(true); // 金丝雀命中 ⇒ 判官可用
    expect(oracleDominates(canaryB, canaryA, OBJECTIVES)).toBe(false);

    expect(r.frontier.length).toBeGreaterThan(1); // 非空非单点，否则"两两"是空循环
    const offenders: string[] = [];
    for (const a of r.frontier) {
      for (const b of r.frontier) {
        if (a.id === b.id) continue;
        if (oracleDominates(a, b, OBJECTIVES)) offenders.push(`${a.id}(${a.metrics[DAYS]}/${a.metrics[COST]}) 支配 ${b.id}(${b.metrics[DAYS]}/${b.metrics[COST]})`);
      }
    }
    expect(offenders).toEqual([]);
    expect(r.frontier.map((s) => s.id)).toEqual(EXPECTED_FRONTIER_IDS);
  });

  it("② dominated[] 每一个都被 frontier[] 中至少一个支配（且**反向也成立**：一个都不许漏）", async () => {
    const r = await runOptimizePareto(stubSolve, REQ);
    // 非空断言在先：`dominated` 为空时"每一个都被支配"恒真，那是空转不是通过。
    expect(r.dominated.length).toBe(6);

    // 正向：dominated 里没有冒名顶替的。
    const unjustified = r.dominated.filter((d) => !r.frontier.some((f) => oracleDominates(f, d, OBJECTIVES)));
    expect(unjustified.map((s) => s.id)).toEqual([]);

    // 反向（**变异反证要红的就是这一半**）：判官认定被支配的解，一个都不许留在 frontier 里。
    // 只写正向会漏掉「判据变松 ⇒ dominated 缩水」这种退化 —— 缩水后的每一个仍然"确实被支配"，正向照样绿。
    const all = [...r.frontier, ...r.dominated];
    const oracleDominatedIds = all.filter((s) => all.some((o) => o.id !== s.id && oracleDominates(o, s, OBJECTIVES))).map((s) => s.id).sort();
    expect([...r.dominated.map((s) => s.id)].sort()).toEqual(oracleDominatedIds);
    expect(oracleDominatedIds).toEqual([...EXPECTED_DOMINATED_IDS].sort());
  });

  it("③ frontier ∩ dominated == ∅，且账是平的（iterations = frontier + dominated + residual）", async () => {
    const r = await runOptimizePareto(stubSolve, REQ);
    const fIds = new Set(r.frontier.map((s) => s.id));
    expect(r.dominated.filter((s) => fIds.has(s.id)).map((s) => s.id)).toEqual([]);
    expect(r.iterations).toBe(9); // 3 档 × 3 档
    expect(r.frontier.length + r.dominated.length + r.residual).toBe(r.iterations);
    expect(r.residual).toBe(0); // 本装置下 9 个候选全可行

    // 绑定裕度：`tight` 判据（slack ≤ PARETO_TIGHT_EPS）写在代码里，前端不猜阈值。
    const os4 = [...r.frontier, ...r.dominated].filter((s) => s.levers.some((l) => l.key === OS_TARGET && l.value === 4));
    expect(os4.length).toBe(3);
    for (const s of os4) {
      const b = s.bindings.find((x) => x.key === COST)!;
      expect(b.limit).toBe(12);
      expect(b.value).toBe(12);
      expect(b.slack).toBe(0);
      expect(b.tight).toBe(true); // 顶到边
      expect(b.slack).toBeLessThanOrEqual(PARETO_TIGHT_EPS);
    }
    const os0 = r.frontier.find((s) => s.id === idOf(16, 0))!;
    expect(os0.bindings.find((x) => x.key === COST)!.tight).toBe(false); // 还有 12 的裕度

    // 越界 ⇒ 不可行 ⇒ 既不进 frontier 也不进 dominated，而是记进 residual（账仍然要平）。
    const tightened = await runOptimizePareto(stubSolve, { ...REQ, constraints: [{ key: COST, limit: 12 }, { key: DAYS, limit: 20 }] });
    expect(tightened.iterations).toBe(9);
    expect(tightened.residual).toBe(6); // 只有 days ≤ 20 的三个候选还可行
    expect(tightened.frontier.length + tightened.dominated.length + tightened.residual).toBe(tightened.iterations);
    expect([...tightened.frontier, ...tightened.dominated].every((s) => s.feasible)).toBe(true);
  });

  it("④ 确定性 R6：同 (session, 杠杆集, 参数版本) 重跑两次 → JSON.stringify 逐字节相等", async () => {
    const a = await runOptimizePareto(stubSolve, REQ);
    const b = await runOptimizePareto(stubSolve, REQ);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));

    // 书写顺序无关（内部去重 + 升序 + 按 key 字典序）：把杠杆与档位都打乱，字节仍须一致。
    const shuffled: ParetoRequest = {
      ...REQ,
      levers: [
        { key: OS_TARGET, label: "外协", values: [2, 0, 4, 2] }, // 含重复档位 ⇒ 去重
        { key: OT_TARGET, label: "加班", values: [8, 16, 0] },
      ],
    };
    expect(JSON.stringify(await runOptimizePareto(stubSolve, shuffled))).toBe(JSON.stringify(a));
  });

  it("接缝：POST /a/v1/sim/optimize-pareto 真打 → 真 solvers.invoke → 同一条前沿（路由/契约/扰动/求解任一半退化即红）", async () => {
    const t = await makeApp();
    await t.app.inject({
      method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
      payload: { overrides: { "sim.sandbox": true, "opt.solver-pool": true, "opt.multiobj": true } },
    });
    // mock 优化器：按**扰动后的目标权重**回放读数 —— 与纯函数装置同一套算术，
    // 故经路由算出的前沿必须与 ① 的期望**逐 id 相同**。权重没被真施加 ⇒ 读数不动 ⇒ 九个点重合 ⇒ 红。
    class MockMulti implements OptimizerClient {
      async solve(_r: OptimizationRequest): Promise<OptimizationResult> {
        return { status: "INFEASIBLE", optimal: false, selected: [], totalValue: 0, totalWeight: 0 };
      }
      async solveMultiObjective(req: MultiObjectiveRequest): Promise<MultiObjectiveResult> {
        const w = Object.fromEntries((req.objectives ?? []).map((o) => [o.key, o.weight ?? 0]));
        return { status: "OPTIMAL", optimal: true, values: {}, objectiveValues: metricsOfLevers(w.ot ?? 0, w.os ?? 0), method: req.method };
      }
    }
    t.services.solvers.setOptimizer(new MockMulti());

    const body: ParetoRequest = {
      sessionId: "sess-pareto-http",
      family: "multi_objective",
      args: {
        vars: [{ id: "x", kind: "bool" }],
        constraints: [{ terms: [{ var: "x", coef: 1 }], op: "<=", rhs: 1 }],
        objectives: [{ key: "ot", sense: "min", terms: [{ var: "x", coef: 1 }], weight: 0 }, { key: "os", sense: "min", terms: [{ var: "x", coef: 1 }], weight: 0 }],
        method: "weighted",
      },
      objectives: OBJECTIVES,
      levers: [
        { key: "objectives.ot.weight", label: "加班", values: [0, 8, 16] },
        { key: "objectives.os.weight", label: "外协", values: [0, 2, 4] },
      ],
      constraints: [{ key: COST, limit: 12 }],
    };
    const res = await t.app.inject({ method: "POST", url: "/a/v1/sim/optimize-pareto", headers: ADMIN, payload: body });
    expect(res.statusCode).toBe(200);
    const r = ParetoResultSchema.parse(res.json()) as ParetoResult; // 契约真校验（形状漂了即红）

    expect(r.iterations).toBe(9);
    expect(r.residual).toBe(0);
    expect(r.objectives).toEqual(OBJECTIVES); // 方向显式回显 —— 前端不许自己猜 min/max
    // 经路由的前沿读数与手算表逐点相同（id 因杠杆 target 不同而不同，故比读数对）。
    expect(r.frontier.map((s) => `${s.metrics[DAYS]}/${s.metrics[COST]}`)).toEqual(["14/12", "18/6", "22/0"]);
    // 6 个被支配点（(0,0)30/0 · (8,0)26/0 · (0,2)26/6 · (8,2)22/6 · (0,4)22/12 · (8,4)18/12）。
    expect(r.dominated.map((s) => `${s.metrics[DAYS]}/${s.metrics[COST]}`).sort()).toEqual(["18/12", "22/12", "22/6", "26/0", "26/6", "30/0"]);
    // 逐对互不支配（判官仍是独立那份）。
    for (const a of r.frontier) for (const b of r.frontier) if (a.id !== b.id) expect(oracleDominates(a, b, OBJECTIVES)).toBe(false);

    // entitlement 先于 authz（R3）：功能关掉 = 不存在。
    await t.app.inject({ method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN, payload: { overrides: { "sim.sandbox": false } } });
    const off = await t.app.inject({ method: "POST", url: "/a/v1/sim/optimize-pareto", headers: ADMIN, payload: body });
    expect(off.statusCode).toBe(404);
  });
});
