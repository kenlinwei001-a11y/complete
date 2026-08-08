import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";
import type { AuthCtx, ObjectTypeDef } from "../src/domain.js";
import { generateBattery } from "../src/synthetic/battery.js";
import type {
  OptimizerClient, OptimizationRequest, OptimizationResult,
  FacilityLocationRequest, FacilityLocationResult,
  MinCostFlowRequest, MinCostFlowResult,
} from "../src/solvers/optimizer-client.js";

/**
 * WO-OPT-WHATIF-CLOSE · **问句 → 结论** 全链接缝（SEAM-GATE·闭 §8 `G-OPT-WHATIF-EMPTY-CANDIDATE`）。
 *
 * 前一单（WO-OPT-WHATIF-DATA）把第一格补上了（`Base.openCost`/`Base.serveCost` 规模+地理派生），
 * 断点随即右移到第二格：`assembleBaselineFromSelection` 拿 `clientCands[0]` 时**不问这个类型有没有实例**。
 * demo 实测赢家 `MaintenanceOrder`（leaf 词库命中 ∧ fanOut=3 ∧ 字典序先于 `WorkOrder`）恰恰**零实例**
 * ⇒ `clients=[]` ⇒ `facility_location` 抛「需 facilities[] + clients[] + assignCosts[]」
 * ⇒ orchestrator（`agentcore/router/orchestrator.ts:1047` 的 `!run.ok` 分支）照发 `routing.degraded`
 * ⇒ 用户拿到的还是 path-B 泛答，**不是**优化结论。
 *
 * 本单两半一起修（判据与理由见 `docs/PRD-opt-whatif-close.md`）：
 *  - **引擎半 A1**（硬过滤）：零实例候选不得中选 —— 绑上去必然产出空数组，装配"成功"而链路照断。
 *  - **引擎半 A2**（软降权）：带 ref 指向决策承载类型的候选（`WorkOrder.baseId→Base`）是**该设施自己的
 *    从属记录**，不是可自由指派的需求点，排最后。只做 A1 会把赢家从 `MaintenanceOrder`(0) 推到
 *    `WorkOrder`(260·生产工单)——**仍是错的**（「每张生产工单一份干线履约成本」讲不通），属自信错答。
 *  - **数据半 B**：`MaintenanceOrder` 补进物化清单（声明/连接器/链路全在、193 行确定性行从没落库）。
 *
 * 判据不是"候选非空"——① 从**问句**出发，断言 orchestrator 的降级判据**为假**，并拿到含
 * **最优设施切换**的结论；②③④⑦⑧ 各自隔离一条判据，撤掉哪条哪条红。
 */

// ── AgentCore 侧实参的**权威镜像**（漂移守护基准；B 侧改了这里也须同改） ─────────────────
/**
 * 用户在对话坞输入的问句原文。AgentCore `resolveOptWhatifRoute`（`router/opt-whatif-route.ts:107`·R6 纯正则）
 * 对它的确定性抽取：
 *   · 双命中门 `isOptWhatifSignal`（:26）——族词「选址/开设」∧ 参数改动词「涨到 150」 ⇒ 命中；
 *   · family（:118）——`RE_FACILITY` 命中「选址」⇒ `facility_location`；
 *   · value（:43 `extractValue`）——「涨到 150」⇒ `150`；
 *   · targetId（:69 `extractTargetId`）——选中对象里 objectId 出现在问句中的那个 ⇒ `changzhou`；
 *   · field/collection（:49/:60）——非容量词 ⇒ `openCost` / `facilities`；
 *   · kind（:36 `perturbKind`）——「涨到」⇒ `data_override`。
 * ⇒ `perturbations = [{kind:"data_override", target:"facilities.changzhou.openCost", value:150}]`。
 */
const NL_QUERY = "如果 changzhou 基地的开设成本涨到 150，最优选址方案怎么变？";

/** 由 `NL_QUERY` 抽取所得，再由 orchestrator `runOptWhatifRoute`（`orchestrator.ts:1037`）逐字段组装的 invoke 实参。 */
const argsFromQuery = (selectionIds: string[]) => ({
  family: "facility_location",
  selection: selectionIds.map((id) => ({ objectType: "Base", objectId: id })),
  autoBind: true,
  perturbations: [{ kind: "data_override", target: "facilities.changzhou.openCost", value: 150 }],
});

/**
 * orchestrator 降级判据的**字面镜像**（`orchestrator.ts:1047`）：
 * `if (!run.ok || !data || data.applicable === false) → emit("routing.degraded", {fallback:"path-B"})`。
 * `run.ok` 在 OBO 通道上 ⟺ `/a/v1/solvers/optimize_whatif/invoke` 返 2xx。
 * 断言「不再 degraded」= 断言本函数为 false —— 只断言 `applicable !== false` 会漏掉抛错那一半（正是本单的病）。
 */
function orchestratorWouldDegrade(statusCode: number, payload: unknown): boolean {
  const runOk = statusCode >= 200 && statusCode < 300;
  const p = (payload ?? {}) as Record<string, unknown>;
  const data = ("data" in p ? p.data : p) as { applicable?: boolean } | null;
  return !runOk || !data || data.applicable === false;
}

/** 答案装配里"最优决策方案切换"的判据镜像（`opt-whatif-route.ts:181-224` `decisionItems`/`switched`）。 */
function decisionItems(sol: Record<string, unknown> | undefined, field = "openFacilities"): string {
  const v = sol?.[field];
  if (Array.isArray(v)) return v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join("、") || "（空）";
  return v === undefined ? "（未返回）" : JSON.stringify(v);
}

// ── 求解器替身：**真 argmin 重解**（不是回放同一方案的桩） ────────────────────────────
class MockFL implements OptimizerClient {
  last?: FacilityLocationRequest;
  lastFlow?: MinCostFlowRequest;
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
  async solveMinCostFlow(req: MinCostFlowRequest): Promise<MinCostFlowResult> {
    this.calls += 1;
    this.lastFlow = req;
    return { status: "OPTIMAL", optimal: true, flows: req.arcs.map((a) => ({ from: a.from, to: a.to, flow: 1 })), objective: req.arcs.reduce((s, a) => s + a.cost, 0) };
  }
}

const ctxOf = (tenantId: string): AuthCtx => ({ tenantId, userId: "u", roles: ["admin"], attributes: {} });

/** 合成租户造型器：只放"名字像"的类型，让排序判据在无业务噪声下可单独证伪。 */
const typeDef = (tenantId: string, key: string, props: ObjectTypeDef["properties"]): ObjectTypeDef => ({
  id: `ot_${tenantId}_${key}`, tenantId, key, displayName: key, domain: "x", version: 1,
  status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: props,
});

describe("WO-OPT-WHATIF-CLOSE · 问句 → optimize_whatif 真结论（SEAM）", () => {
  it("① 头号接缝：问句实参 → REST invoke → **orchestrator 降级判据为假** → 拿到含最优设施切换的结论", async () => {
    const t = await makeApp();
    await seedBattery(t); // ← 生产实况：只跑合成种子，测试侧**不做任何补位落库**
    const mock = new MockFL();
    t.services.solvers.setOptimizer(mock);
    const bases = await t.repos.objects.listByType("demo", "Base");

    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/solvers/optimize_whatif/invoke", // AgentCore OBO 实打的那条路
      headers: ADMIN,
      payload: { args: argsFromQuery(bases.map((b) => b.id)) },
    });
    const payload = res.json() as Record<string, unknown>;

    // 头号判据 A：**不再 routing.degraded**（本单之前这里恒真——invoke 抛「需 facilities[] + clients[]」）。
    expect(orchestratorWouldDegrade(res.statusCode, payload)).toBe(false);
    expect(res.statusCode).toBeLessThan(300);
    expect(JSON.stringify(payload)).not.toContain("需 facilities[]");
    expect(JSON.stringify(payload)).not.toContain("装配报缺");

    const data = payload.data as Record<string, unknown>;
    const baseSol = data.baselineSolution as Record<string, unknown>;
    const pertSol = data.perturbedSolution as Record<string, unknown>;

    // 头号判据 B：**真结论**——最优设施切换（答案装配里那句「最优决策已切换」的来源）。
    expect(decisionItems(baseSol)).toBe("handan");     // 基线最优 = openCost 最低的邯郸（34.1GWh/9 线 → 6432 万元）
    expect(decisionItems(pertSol)).toBe("changzhou");  // changzhou.openCost→150 ⇒ 最优切到常州
    expect(decisionItems(baseSol)).not.toBe(decisionItems(pertSol)); // switched === true
    expect(data.feasible).toBe(true);
    expect(data.deltaObjective).not.toBeNull();
    expect(data.deltaObjective).not.toBe(0);
    expect(mock.calls).toBe(2); // 基线 + 扰动各真解一次

    // 头号判据 C：需求点是**真需求点**——A2 生效，client 不是决策类型的从属记录（否则是自信错答）。
    expect(baseSol.clientType).toBe("OrderLine");
    expect(baseSol.clientType).not.toBe("MaintenanceOrder"); // 撤掉 A2 → 这里回到维修工单
    expect(baseSol.clientType).not.toBe("WorkOrder");        // 只做 A1 → 这里落到生产工单
    const clientDef = (await t.repos.ontologyTypes.list("demo")).find((x) => x.key === String(baseSol.clientType) && x.status === "ACTIVE")!;
    expect(clientDef.properties.some((p) => p.refToTypeKey === "Base")).toBe(false); // 非从属 = 可自由指派
    expect(mock.last!.clients.length).toBeGreaterThan(0);
    expect(mock.last!.clients.length).toBe(38);
  });

  it("② A1 隔离（零实例硬过滤）：排位更高的候选零实例 → 让位给有实例的候选，链路真出结论", async () => {
    const t = await makeApp();
    const mock = new MockFL();
    t.services.solvers.setOptimizer(mock);
    const tid = "a1iso";
    await t.repos.ontologyTypes.put(typeDef(tid, "Site", [
      { propKey: "siteId", dataType: "string", isPrimaryKey: true },
      { propKey: "setupCost", dataType: "number", isPrimaryKey: false },
    ]));
    // 排位更高（fanOut=2 > 0）但**一行都没有**的候选；排位低但有实例的候选在后。
    await t.repos.ontologyTypes.put(typeDef(tid, "GhostOrder", [
      { propKey: "goId", dataType: "string", isPrimaryKey: true },
      { propKey: "aRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Site2" },
      { propKey: "bRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Site3" },
    ]));
    await t.repos.ontologyTypes.put(typeDef(tid, "Customer", [{ propKey: "custId", dataType: "string", isPrimaryKey: true }]));
    await t.repos.objects.put({ id: "s1", tenantId: tid, type: "Site", props: { siteId: "s1", setupCost: 10 } });
    await t.repos.objects.put({ id: "s2", tenantId: tid, type: "Site", props: { siteId: "s2", setupCost: 20 } });
    await t.repos.objects.put({ id: "c1", tenantId: tid, type: "Customer", props: { custId: "c1" } });

    const out = await t.services.solvers.invoke(ctxOf(tid), "optimize_whatif", {
      family: "facility_location", autoBind: true,
      selection: [{ objectType: "Site", objectId: "s1" }, { objectType: "Site", objectId: "s2" }],
      perturbations: [{ kind: "data_override", target: "facilities.s1.openCost", value: 150 }],
    });
    expect((out as { applicable?: boolean }).applicable).not.toBe(false);
    // 撤掉 A1 → 选中零实例的 GhostOrder → clients=[] → 抛「需 facilities[] + clients[]」（本用例转红）。
    expect((out.baselineSolution as { clientType?: string }).clientType).toBe("Customer");
    expect(decisionItems(out.baselineSolution as Record<string, unknown>)).toBe("s1");
    expect(decisionItems(out.perturbedSolution as Record<string, unknown>)).toBe("s2");
    expect(mock.last!.clients.map((c) => c.id)).toEqual(["c1"]);
  });

  it("③ A1 诚实报缺：候选**全部**零实例 → applicable:false 且点名空候选（而不是抛与病因无关的「需 facilities[]」）", async () => {
    const t = await makeApp();
    t.services.solvers.setOptimizer(new MockFL());
    const tid = "a1empty";
    await t.repos.ontologyTypes.put(typeDef(tid, "Site", [
      { propKey: "siteId", dataType: "string", isPrimaryKey: true },
      { propKey: "setupCost", dataType: "number", isPrimaryKey: false },
    ]));
    await t.repos.ontologyTypes.put(typeDef(tid, "Customer", [{ propKey: "custId", dataType: "string", isPrimaryKey: true }]));
    await t.repos.ontologyTypes.put(typeDef(tid, "GhostOrder", [{ propKey: "goId", dataType: "string", isPrimaryKey: true }]));
    await t.repos.objects.put({ id: "s1", tenantId: tid, type: "Site", props: { siteId: "s1", setupCost: 10 } });

    const out = await t.services.solvers.invoke(ctxOf(tid), "optimize_whatif", {
      family: "facility_location", autoBind: true,
      selection: [{ objectType: "Site", objectId: "s1" }],
      perturbations: [{ kind: "data_override", target: "facilities.s1.openCost", value: 150 }],
    });
    expect((out as { applicable?: boolean }).applicable).toBe(false);
    const missing = ((out as { missingRoles?: string[] }).missingRoles ?? []).join("");
    expect(missing).toContain("client");
    expect(missing).toContain("均无实例");
    expect(missing).toContain("Customer");   // 点名到底是哪些类型名字像却一行都没有
    expect(missing).toContain("GhostOrder");
  });

  it("④ A2 隔离（从属降权）：从属候选排位更高且有实例 → 仍让位给非从属的真需求点", async () => {
    const t = await makeApp();
    const mock = new MockFL();
    t.services.solvers.setOptimizer(mock);
    const tid = "a2iso";
    await t.repos.ontologyTypes.put(typeDef(tid, "Site", [
      { propKey: "siteId", dataType: "string", isPrimaryKey: true },
      { propKey: "setupCost", dataType: "number", isPrimaryKey: false },
    ]));
    // 从属候选：fanOut=2（排位更高）+ 有实例，但带 ref 指向决策承载类型 Site（= 已绑死在某设施上）。
    await t.repos.ontologyTypes.put(typeDef(tid, "InternalOrder", [
      { propKey: "ioId", dataType: "string", isPrimaryKey: true },
      { propKey: "siteRef", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Site" },
      { propKey: "other", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Site" },
    ]));
    await t.repos.ontologyTypes.put(typeDef(tid, "Customer", [{ propKey: "custId", dataType: "string", isPrimaryKey: true }]));
    await t.repos.objects.put({ id: "s1", tenantId: tid, type: "Site", props: { siteId: "s1", setupCost: 10 } });
    await t.repos.objects.put({ id: "s2", tenantId: tid, type: "Site", props: { siteId: "s2", setupCost: 20 } });
    await t.repos.objects.put({ id: "io1", tenantId: tid, type: "InternalOrder", props: { ioId: "io1", siteRef: "s1", other: "s2" } });
    await t.repos.objects.put({ id: "c1", tenantId: tid, type: "Customer", props: { custId: "c1" } });

    const out = await t.services.solvers.invoke(ctxOf(tid), "optimize_whatif", {
      family: "facility_location", autoBind: true,
      selection: [{ objectType: "Site", objectId: "s1" }, { objectType: "Site", objectId: "s2" }],
      perturbations: [{ kind: "data_override", target: "facilities.s1.openCost", value: 150 }],
    });
    // 撤掉 A2 → InternalOrder（fanOut 更高）中选 → 本断言转红。
    expect((out.baselineSolution as { clientType?: string }).clientType).toBe("Customer");
    expect(mock.last!.clients.map((c) => c.id)).toEqual(["c1"]);
  });

  it("⑤ 数据半 B：`MaintenanceOrder` 生成器产的 193 行**真落库**（此前声明/连接器/链路全在、唯独零实例）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const generated = (generateBattery(42, "S").maintenanceOrders as unknown[]).length;
    const landed = await t.repos.objects.listByType("demo", "MaintenanceOrder");
    expect(generated).toBe(193);
    expect(landed.length).toBe(generated); // 撤掉物化清单那行 → 0 ≠ 193，本用例转红
    // 落库的是**生成器那批真行**（不是造的）：主键与 props 逐字段同源。
    const first = landed.slice().sort((a, b) => a.id.localeCompare(b.id))[0]!;
    expect(String(first.props.moId)).toMatch(/^MO-/);
    expect(first.props.equipId).toBeTruthy();
    expect(first.props.baseId).toBeTruthy();
  });

  it("⑥ R6：同 seed 同问句实参两跑字节一致（含新落库的 MaintenanceOrder 与新排序判据）", async () => {
    const run = async () => {
      const t = await makeApp();
      await seedBattery(t);
      t.services.solvers.setOptimizer(new MockFL());
      const bases = await t.repos.objects.listByType("demo", "Base");
      return t.services.solvers.invoke(ctxOf("demo"), "optimize_whatif", argsFromQuery(bases.map((b) => b.id)));
    };
    expect(JSON.stringify(await run())).toBe(JSON.stringify(await run()));
  });

  it("⑦ 同族（min_cost_flow）：弧候选零实例 → 诚实报缺点名空候选，不再抛「需 nodes[] + arcs[]」", async () => {
    const t = await makeApp();
    t.services.solvers.setOptimizer(new MockFL());
    const tid = "mcfiso";
    await t.repos.ontologyTypes.put(typeDef(tid, "Node", [
      { propKey: "nodeId", dataType: "string", isPrimaryKey: true },
      { propKey: "demandQty", dataType: "number", isPrimaryKey: false },
    ]));
    await t.repos.ontologyTypes.put(typeDef(tid, "GhostArc", [
      { propKey: "arcId", dataType: "string", isPrimaryKey: true },
      { propKey: "from", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Node" },
      { propKey: "to", dataType: "ref", isPrimaryKey: false, refToTypeKey: "Node" },
      { propKey: "shipCost", dataType: "number", isPrimaryKey: false },
    ]));
    await t.repos.objects.put({ id: "n1", tenantId: tid, type: "Node", props: { nodeId: "n1", demandQty: 5 } });

    const out = await t.services.solvers.invoke(ctxOf(tid), "optimize_whatif", {
      family: "min_cost_flow", autoBind: true,
      selection: [{ objectType: "Node", objectId: "n1" }],
      perturbations: [{ kind: "data_override", target: "arcs.a1.cost", value: 5 }],
    });
    expect((out as { applicable?: boolean }).applicable).toBe(false);
    const missing = ((out as { missingRoles?: string[] }).missingRoles ?? []).join("");
    expect(missing).toContain("arc");
    expect(missing).toContain("均无实例");
    expect(missing).toContain("GhostArc");
  });

  it("⑧ 决策承载类型自身零实例（选中范围收窄后一行没有）→ 诚实报缺 facility，不抛无关错误", async () => {
    const t = await makeApp();
    t.services.solvers.setOptimizer(new MockFL());
    const tid = "facempty";
    await t.repos.ontologyTypes.put(typeDef(tid, "Site", [
      { propKey: "siteId", dataType: "string", isPrimaryKey: true },
      { propKey: "setupCost", dataType: "number", isPrimaryKey: false },
    ]));
    await t.repos.ontologyTypes.put(typeDef(tid, "Customer", [{ propKey: "custId", dataType: "string", isPrimaryKey: true }]));
    await t.repos.objects.put({ id: "c1", tenantId: tid, type: "Customer", props: { custId: "c1" } });
    // Site 类型已发布但**零实例**（选中的 s1 根本不存在）。
    const out = await t.services.solvers.invoke(ctxOf(tid), "optimize_whatif", {
      family: "facility_location", autoBind: true,
      selection: [{ objectType: "Site", objectId: "s1" }],
      perturbations: [{ kind: "data_override", target: "facilities.s1.openCost", value: 150 }],
    });
    expect((out as { applicable?: boolean }).applicable).toBe(false);
    expect(((out as { missingRoles?: string[] }).missingRoles ?? []).join("")).toContain("facility");
  });
});
