import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";
import type { AuthCtx, ObjectInstance } from "../src/domain.js";
import { generateBattery, baseOpenCostWan, baseServeCostWan } from "../src/synthetic/battery.js";
import { lexiconHit } from "../src/solvers/field-role-lexicon.js";
import type {
  OptimizerClient, OptimizationRequest, OptimizationResult,
  FacilityLocationRequest, FacilityLocationResult,
} from "../src/solvers/optimizer-client.js";

/**
 * WO-OPT-WHATIF-DATA · **数据侧 × 装配/引擎 真接缝**（SEAM-GATE）。
 *
 * 病根（「接了线没数据」形态②，**不是**「没接线」）：`qos.opt-whatif-route` 点亮后，问句
 * 「把 XX 基地的开设成本涨到 150，选址方案会怎么变」**真命中路由、真 invoke** `optimize_whatif`
 * （family=facility_location），但 DataCore 半的 `assembleBaselineFromSelection`
 * （`solvers/service.ts:3731`）按 `ROLE_LEXICON.cost` 词库（`solvers/field-role-lexicon.ts:15`
 * `/成本|cost|费用|损|料价|原料|开支|支出|耗费/i`）在决策承载类型上找数值字段绑 `open_cost`，
 * 而 demo `Base` 的数值属性只有 util/gwh/formationCapDaily/agingCapDaily/lon/lat —— **零命中**
 * ⇒ `{applicable:false, missingRoles:["open_cost（Base 无命中成本词库的数值字段）"]}`
 * ⇒ orchestrator 发 `routing.degraded{fallback:"path-B"}`（`agentcore/router/orchestrator.ts:1048`）
 * ⇒ 用户永远看不到优化结论。
 *
 * 本单修数据半：`Base.openCost` / `Base.serveCost` 由**已有量派生·零 rng 消耗**（R6·见 battery.ts
 * `baseOpenCostWan` / `baseServeCostWan`）。
 *
 * 判据不是「字段加上了」——下面 ① 从**真 demo 合成数据**驱动**真装配 + 真扰动重解**，头号断言是
 * **最优设施真切换**（handan → changzhou）；只断言「Base 有这个字段」的测试一律不算数。
 */

/** MockFive：按 openCost argmin 真重解（**非返回同一方案的桩**）；objective = 开设成本 + Σ 指派成本。 */
class MockFL implements OptimizerClient {
  last?: FacilityLocationRequest;
  calls = 0;
  async solve(_req: OptimizationRequest): Promise<OptimizationResult> {
    return { status: "INFEASIBLE", optimal: false, selected: [], totalValue: 0, totalWeight: 0 };
  }
  async solveFacilityLocation(req: FacilityLocationRequest): Promise<FacilityLocationResult> {
    this.calls += 1;
    this.last = req;
    const cheapest = [...req.facilities].sort((a, b) => a.openCost - b.openCost || a.id.localeCompare(b.id))[0]!;
    const ac = req.assignCosts.filter((a) => a.facility === cheapest.id);
    const objective = cheapest.openCost + req.clients.reduce((s, c) => s + (ac.find((a) => a.client === c.id)?.cost ?? 0), 0);
    return {
      status: "OPTIMAL", optimal: true,
      openFacilities: [cheapest.id],
      assignments: req.clients.map((c) => ({ client: c.id, facility: cheapest.id })),
      objective,
    };
  }
}

const ctxOf = (tenantId: string): AuthCtx => ({ tenantId, userId: "u", roles: ["admin"], attributes: {} });

/**
 * 需求侧落库补位（**非造假数据**）：`generateBattery` 已确定性产出 `maintenanceOrders`
 * （`battery.ts:4303` 起·hashString 派生·不消耗 rng），但 `synthetic/service.ts` 的物化清单
 * （:802-812 那一段）**漏了这一类** —— 生成了没落库。而 `assembleBaselineFromSelection`
 * （`solvers/service.ts:3734`）的 client 角色赢家恰好就是它（leaf 词库命中 ∧ fanOut=3 ∧ 字典序先于
 * WorkOrder），且**不检查候选类型有没有实例** ⇒ clients=[] ⇒ `facility_location` 抛
 * 「需 facilities[] + clients[] + assignCosts[]」。
 *
 * 本函数把**生成器已产的那批真行**按 `putAll` 同款 id 规则落库（同 seed 同 scale 字节一致），
 * 使本单要证的「数据半 → 装配 → 重解」接缝可被完整驱动。**缺口本身另有 tripwire**：见 ④。
 */
async function materializeGeneratedMaintenanceOrders(t: Awaited<ReturnType<typeof makeApp>>, seed = 42): Promise<number> {
  const g = generateBattery(seed, "S");
  const rows = g.maintenanceOrders as Record<string, unknown>[];
  for (const row of rows) {
    const obj: ObjectInstance = {
      id: `obj_maintenanceorder_${String(row.moId)}`.replace(/[^\p{L}\p{N}_-]/gu, "_"),
      tenantId: "demo",
      type: "MaintenanceOrder",
      props: row,
    };
    await t.repos.objects.put(obj);
  }
  return rows.length;
}

const OPT_ARGS = (baseIds: string[], target: string, value: number) => ({
  // 与 AgentCore 暗发门发出的实参**逐字段同形**（orchestrator.ts:1037
  //   `{ family: route.family, selection: route.selection, autoBind: true, perturbations: route.perturbations }`）。
  family: "facility_location",
  autoBind: true,
  selection: baseIds.map((id) => ({ objectType: "Base", objectId: id })),
  perturbations: [{ kind: "data_override", target, value }],
});

describe("WO-OPT-WHATIF-DATA · Base 选址成本 → optimize_whatif 真装配真重解（SEAM）", () => {
  it("① 头号接缝：真 demo 数据 → 装配不报缺 open_cost → 扰动后**最优设施真切换**（handan→changzhou·Δ≠0）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const moCount = await materializeGeneratedMaintenanceOrders(t);
    expect(moCount).toBeGreaterThan(0); // 生成器确实产了需求侧行（不是空跑）

    const mock = new MockFL();
    t.services.solvers.setOptimizer(mock);
    const bases = await t.repos.objects.listByType("demo", "Base");
    const out = await t.services.solvers.invoke(
      ctxOf("demo"),
      "optimize_whatif",
      OPT_ARGS(bases.map((b) => b.id), "facilities.changzhou.openCost", 150),
    );

    // 头号判据 A：**装配不再报缺**（本单之前这里恒 applicable:false·missingRoles=["open_cost（Base …）"]）。
    // 断言写成 missingRoles 优先，使**变异反证**（把成本字段摘掉）的红字直接打出报缺原文，而非裸 false。
    expect((out as { missingRoles?: string[] }).missingRoles ?? []).toEqual([]);
    expect((out as { applicable?: boolean }).applicable).not.toBe(false);
    expect(String(out.summary ?? "")).not.toContain("装配报缺");
    expect(JSON.stringify(out)).not.toContain("无命中成本词库");

    // 头号判据 B：**最优决策方案真切换**（数据 × 引擎驱动接缝；只测"字段存在"验不到这一条）。
    const baseSol = out.baselineSolution as { openFacilities: string[]; clientType?: string };
    const pertSol = out.perturbedSolution as { openFacilities: string[] };
    expect(baseSol.openFacilities).toEqual(["handan"]); // 基线最优 = openCost 最低的邯郸（34.1GWh/9 线 → 6432 万元）
    expect(pertSol.openFacilities).toEqual(["changzhou"]); // changzhou.openCost→150 ⇒ 最优切到常州
    expect(baseSol.openFacilities).not.toEqual(pertSol.openFacilities);
    expect(out.deltaObjective).not.toBe(0);
    expect(out.deltaObjective).not.toBeNull();
    expect(out.feasible).toBe(true);
    expect(mock.calls).toBe(2); // 基线 + 扰动各真解一次（非同一方案回放）

    // 头号判据 C：**系数真取自 demo Base 的派生成本**（不是 bindToSolverArgs 的 0/1 缺省兜底）。
    const facs = new Map(mock.last!.facilities.map((f) => [f.id, f.openCost]));
    expect(facs.get("handan")).toBe(baseOpenCostWan(34.1, 9)); // 6432
    expect(facs.get("changzhou")).toBe(150); // 被扰动覆盖
    expect(facs.get("xiamen")).toBe(baseOpenCostWan(79.5, 17)); // 13960（未被扰动的旁证）
    // assign_cost 角色也真绑上（第二个命中成本词库的数值字段 = serveCost·地理派生·非缺省 1）
    const assignFromHandan = mock.last!.assignCosts.find((a) => a.facility === "handan")!;
    expect(assignFromHandan.cost).toBe(baseServeCostWan("handan"));
    expect(assignFromHandan.cost).not.toBe(1);
  });

  it("② 变异反证的对偶（诚实报缺仍在）：同一租户抹掉 Base 的成本字段 → 立刻回到 open_cost 报缺", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await materializeGeneratedMaintenanceOrders(t);
    t.services.solvers.setOptimizer(new MockFL());
    // 只从**类型声明**上摘掉两个成本属性（对象上的值留着）——证报缺判据咬的是"本体有没有这个字段"，
    // 也证 ① 的绿不是别处兜底给的。
    const def = (await t.repos.ontologyTypes.list("demo")).find((x) => x.key === "Base" && x.status === "ACTIVE")!;
    await t.repos.ontologyTypes.put({ ...def, properties: def.properties.filter((p) => !lexiconHit(p.propKey, "cost")) });

    const bases = await t.repos.objects.listByType("demo", "Base");
    const out = await t.services.solvers.invoke(
      ctxOf("demo"),
      "optimize_whatif",
      OPT_ARGS(bases.map((b) => b.id), "facilities.changzhou.openCost", 150),
    );
    expect((out as { applicable?: boolean }).applicable).toBe(false);
    expect(String((out as { missingRoles?: string[] }).missingRoles?.join(""))).toContain("open_cost");
  });

  it("③ R6：同 seed 同扰动两跑字节一致（含新加的两个派生成本）", async () => {
    const run = async () => {
      const t = await makeApp();
      await seedBattery(t);
      await materializeGeneratedMaintenanceOrders(t);
      t.services.solvers.setOptimizer(new MockFL());
      const bases = await t.repos.objects.listByType("demo", "Base");
      return t.services.solvers.invoke(
        ctxOf("demo"),
        "optimize_whatif",
        OPT_ARGS(bases.map((b) => b.id), "facilities.changzhou.openCost", 150),
      );
    };
    expect(JSON.stringify(await run())).toBe(JSON.stringify(await run()));
  });

  it("④ 成本值真由已有量派生（规模 + 地理），不是随机数：openCost 随 gwh/lines 单调、serveCost 随网络距离", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const bases = await t.repos.objects.listByType("demo", "Base");
    expect(bases.length).toBe(13);
    for (const b of bases) {
      expect(typeof b.props.openCost, `${String(b.props.baseId)}.openCost`).toBe("number");
      expect(typeof b.props.serveCost, `${String(b.props.baseId)}.serveCost`).toBe("number");
      expect(b.props.openCost as number).toBeGreaterThan(0);
      expect(b.props.serveCost as number).toBeGreaterThan(0);
    }
    const byId = new Map(bases.map((b) => [String(b.props.baseId), b.props as Record<string, number>]));
    // 规模派生：常州(99.4GWh/23线) 是全网最大 → openCost 最高；邯郸(34.1/9) 最小 → 最低。
    const sorted = [...byId.entries()].sort((a, b) => a[1].openCost! - b[1].openCost!);
    expect(sorted[0]![0]).toBe("handan");
    expect(sorted[sorted.length - 1]![0]).toBe("changzhou");
    // 地理派生：西部（成都/眉山/自贡）网络平均干线距离远 → serveCost 高于东部（武汉/合肥）。
    expect(byId.get("chengdu")!.serveCost!).toBeGreaterThan(byId.get("wuhan")!.serveCost!);
    expect(byId.get("meishan")!.serveCost!).toBeGreaterThan(byId.get("hefei")!.serveCost!);
  });

  it("⑤ tripwire（本单之外的残留缺口·引擎半）：client 角色赢家 MaintenanceOrder 在 demo **零实例** → 链路仍断", async () => {
    // 不做 materialize —— 这就是**生产实况**。断点已从「open_cost 报缺」右移到「clients 为空」：
    //   · assembleBaselineFromSelection（solvers/service.ts:3734）取 clientCands[0] 时**不检查候选类型有无实例**；
    //   · 赢家 MaintenanceOrder 由 generateBattery 产出却从未被 synthetic/service.ts 物化（生成了没落库）。
    // **诚实话**：用户今天**仍拿不到结论**——invoke 抛错 ⇒ orchestrator 的 run.ok===false 分支
    // （agentcore/router/orchestrator.ts:1047-1053）照样发 routing.degraded 落 path-B，只是 reason
    // 从「装配报缺」变成「optimize_whatif 未接入/被门」。本单只修得动数据半这一格（工单范围边界）。
    // 任一半被修好（引擎跳过空候选 / 合成把该类落库），本用例即转红 —— 那是好消息，届时删掉它。
    // 修法见 docs/PRD-opt-whatif-data.md §5（两条最小路径，任选其一即闭）。
    const t = await makeApp();
    await seedBattery(t);
    t.services.solvers.setOptimizer(new MockFL());
    expect((await t.repos.objects.listByType("demo", "MaintenanceOrder")).length).toBe(0);
    const bases = await t.repos.objects.listByType("demo", "Base");
    await expect(
      t.services.solvers.invoke(ctxOf("demo"), "optimize_whatif", OPT_ARGS(bases.map((b) => b.id), "facilities.changzhou.openCost", 150)),
    ).rejects.toThrow(/需 facilities\[\] \+ clients\[\]/); // **不再**是 open_cost 报缺 = 本单这半已通
  });

  it("⑥ REST 入口同形（AgentCore OBO 实打的那条路）：/a/v1/solvers/optimize_whatif/invoke 装配不报缺", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await materializeGeneratedMaintenanceOrders(t);
    t.services.solvers.setOptimizer(new MockFL());
    const bases = await t.repos.objects.listByType("demo", "Base");
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/solvers/optimize_whatif/invoke",
      headers: ADMIN,
      payload: { args: OPT_ARGS(bases.map((b) => b.id), "facilities.changzhou.openCost", 150) },
    });
    expect(res.statusCode).toBeLessThan(300);
    const body = res.json() as { result?: Record<string, unknown>; data?: Record<string, unknown> };
    const data = (body.result ?? body.data ?? (body as Record<string, unknown>)) as Record<string, unknown>;
    expect((data as { applicable?: boolean }).applicable).not.toBe(false);
    expect(JSON.stringify(data)).not.toContain("无命中成本词库");
    expect((data.perturbedSolution as { openFacilities: string[] }).openFacilities).toEqual(["changzhou"]);
  });
});
