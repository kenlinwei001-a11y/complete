import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import { baseOpenCostWan, baseServeCostWan } from "../src/synthetic/battery.js";
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
 * **WO-OPT-WHATIF-CLOSE 已收编**：本文件此前有个 `materializeGeneratedMaintenanceOrders` 测试侧补位函数——
 * 因为 `generateBattery` 确定性产的 193 行 `maintenanceOrders`（`battery.ts:4303` 起·hashString 派生·不消耗 rng）
 * **从没被 `synthetic/service.ts` 物化**，而 `assembleBaselineFromSelection` 的 client 角色赢家恰好是它。
 * 该缺口本单已在**生产路径**闭合（物化清单补 `MaintenanceOrder` + 装配器加"零实例不中选/从属降权"两道判据），
 * 于是下面全部用例改为**只跑 `seedBattery` 的生产实况**，补位函数随之删除（留着就是死代码）。
 * 闭合证据见 `test/opt-whatif-close.seam.test.ts`。
 */

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
    await seedBattery(t); // 生产实况（WO-OPT-WHATIF-CLOSE 后无需任何测试侧补位）
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

  it("⑤ 原 tripwire 已转正（缺口闭合·WO-OPT-WHATIF-CLOSE 收编）：生产实况下 client 角色不再落到零实例类型", async () => {
    // 本用例的**前身**是一条 tripwire：它断言 `MaintenanceOrder` 在 demo 零实例、且同链路必抛
    // 「需 facilities[] + clients[]」——那是"数据半修好了、引擎半还没"的中间态诚实记账。
    // WO-OPT-WHATIF-CLOSE 把两半都修了，于是它按设计转红并在此**转正为闭合断言**：
    //   · 数据半：`MaintenanceOrder` 进物化清单 ⇒ 不再零实例；
    //   · 引擎半：装配器「零实例不中选（A1）+ 从属降权（A2）」⇒ client 落到真需求点，且**不抛错**。
    const t = await makeApp();
    await seedBattery(t);
    t.services.solvers.setOptimizer(new MockFL());
    expect((await t.repos.objects.listByType("demo", "MaintenanceOrder")).length).toBeGreaterThan(0);
    const bases = await t.repos.objects.listByType("demo", "Base");
    const out = await t.services.solvers.invoke(ctxOf("demo"), "optimize_whatif", OPT_ARGS(bases.map((b) => b.id), "facilities.changzhou.openCost", 150));
    expect((out as { applicable?: boolean }).applicable).not.toBe(false);
    const clientType = String((out.baselineSolution as { clientType?: string }).clientType ?? "");
    const clientRows = await t.repos.objects.listByType("demo", clientType);
    expect(clientRows.length).toBeGreaterThan(0); // 中选的 client 类型**有真实例**（原病灶：恒 0）
  });

  it("⑥ REST 入口同形（AgentCore OBO 实打的那条路）：/a/v1/solvers/optimize_whatif/invoke 装配不报缺", async () => {
    const t = await makeApp();
    await seedBattery(t);
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
