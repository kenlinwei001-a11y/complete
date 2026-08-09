import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";

/**
 * 沙盘消"空世界"（审计 §3.5）：SEED_DEMO 给 demo 租户播 sim PropagationRule 种子。
 * 验：种了规则后 view-config 返 propagationCount≥2 + stateVars 非空；确定性重跑一致；
 * 沿 demo 真链路（Order/Model/Base + order_for_model/model_producible_at）传导真生效。
 *
 * WO-P1（§3.1.4 · REQ143）：补齐六方向共 13 条边 + 修 #158（第 ③ 条方向反了、从不触发）。
 * 本文件新增两道**机器先说话**的门（铁律 0.6：同一个错第二次必须建机制）：
 *  · 「方向可达门」——逐条规则去**真链路表**核对 source─via→target 三元组真的存在，
 *    #158 那种「种子写了但方向反、规则恒不触发」的形态会被它当场咬红，不必等人去发现；
 *  · 「效果层 SEAM」——供应侧扰动跨 3 跳真的把值送到 Order（断言的是**传导能力**，
 *    不是"规则条数变多了"——后者度量的是种子数量，不是这条链通不通）。
 *
 * 边界：PropagationRule 是独立 sim 表，正交于电池合成字节一致基线（不碰 battery 数值）。
 */
const enableSim = async (t: Awaited<ReturnType<typeof makeApp>>) =>
  t.app.inject({
    method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN,
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

describe("SEED_DEMO · 沙盘传导规则种子", () => {
  it("种子后 view-config：propagationCount≥2 + stateVars 非空（消空世界）", async () => {
    const t = await makeApp();
    await seedBattery(t); // 本体 + 真对象/链路
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const cfg = (await (await t.app.inject({ method: "GET", url: "/a/v1/sim/view-config", headers: ADMIN })).json()) as {
      nodeTypes: string[]; stateVars: string[]; propagationCount: number;
    };
    expect(cfg.propagationCount).toBe(13); // WO-P1：六方向补齐后 3 → 13
    expect(cfg.stateVars.length).toBeGreaterThan(0);
    // stateVars 派生自规则 source/target stateVar。WO-P1 后覆盖六个方向的量纲：
    // 需求(demandPressure/demandLoad/loadIndex/utilPressure) · 产能(queuePressure) ·
    // 供应(deliveryDelay/shortageRisk/supplyRisk) · 交付(expeditePressure/queueDays) ·
    // 成本(priceShock/costPressure) · 现金(receivablePressure/overduePressure)。
    expect(cfg.stateVars).toEqual([
      "costPressure", "deliveryDelay", "demandLoad", "demandPressure", "expeditePressure",
      "loadIndex", "overduePressure", "priceShock", "queueDays", "queuePressure",
      "receivablePressure", "shortageRisk", "supplyRisk", "utilPressure",
    ]);
    // 节点类型派生自本体（含 demo 真类型）。
    expect(cfg.nodeTypes).toContain("Order");
    expect(cfg.nodeTypes).toContain("Model");
    expect(cfg.nodeTypes).toContain("Base");
  });

  it("种的规则沿真链路（Order/Model/Base）：发布且 viaLinkKey 是 demo 真链路", async () => {
    const t = await makeApp();
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const items = (await (await t.app.inject({ method: "GET", url: "/a/v1/sim/propagation-rules", headers: ADMIN })).json()).items as Array<{
      key: string; status: string; viaLinkKey: string; sourceTypeKey: string; targetTypeKey: string;
    }>;
    expect(items.length).toBe(13);
    expect(items.every((r) => r.status === "PUBLISHED")).toBe(true);
    const viaKeys = items.map((r) => r.viaLinkKey).sort();
    expect(viaKeys).toEqual([
      "customer_has_invoice", "line_belongs_to_base", "line_has_process",
      "material_supplied_by_po", "material_used_by_model", "material_used_by_model",
      "model_demanded_by_order", "model_demanded_by_order", "model_producible_at",
      "order_for_model", "order_of_customer", "po_inspected_by", "supplier_supplies_material",
    ]);
  });

  // ── 🔴 方向可达门（#158 的复发闸）────────────────────────────────────────────────
  // #158 的形态：`demo_line_util_to_base_load` 声明 Line --line_belongs_to_base--> Base，
  // 而真链路落的是 **Base→Line**（`service.ts` / `battery.ts:2321` 1:N）。`propagateTick` 的
  // navOut 只沿 `fromId→toId` 走 ⇒ 规则**永远取不到 target**、恒不触发，且全绿了很久没人发现
  // （"规则条数"这个数字不度量"这条边通不通"）。
  // 这道门逐条把规则的 (sourceTypeKey, viaLinkKey, targetTypeKey) 拿到**真链路表**上核对：
  // 必须真存在一条 type=viaLinkKey 且 from 端是 sourceTypeKey 实例、to 端是 targetTypeKey 实例的边。
  // 任何一条边被写反 / 写了不存在的 linkKey / 两端类型没实例 —— 机器当场红，不必等人去追。
  it("🔴 方向可达门：每条种子规则的 source─via→target 在**真链路表**上真的走得通（#158 复发闸）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);

    const links = await t.repos.links.list("demo");
    const typeOf = new Map<string, string>();
    for (const ot of await t.repos.ontologyTypes.list("demo")) {
      for (const o of await t.repos.objects.listByType("demo", ot.key)) typeOf.set(o.id, o.type);
    }
    // 🐤 金丝雀：这套索引本身得是对的 —— 拿一条**已知必中**的边先自证工具，
    // 否则「零命中」到底是"边不通"还是"索引坏了"分不清（铁律 0.6：报否定结论前先自证工具）。
    const canary = links.filter(
      (l) => l.type === "order_for_model" && typeOf.get(l.fromId) === "Order" && typeOf.get(l.toId) === "Model",
    );
    expect(canary.length).toBeGreaterThan(0);

    const rules = await t.repos.sim.listPropagationRules("demo", true);
    expect(rules.length).toBe(13);
    const dead: string[] = [];
    for (const r of rules) {
      const ok = links.some(
        (l) => l.type === r.viaLinkKey && typeOf.get(l.fromId) === r.sourceTypeKey && typeOf.get(l.toId) === r.targetTypeKey,
      );
      if (!ok) dead.push(`${r.key}: ${r.sourceTypeKey} --${r.viaLinkKey}--> ${r.targetTypeKey} 在真链路表上零命中`);
    }
    expect(dead).toEqual([]);
  });

  // 变异反证：把上面那道门的判据反过来喂一条**方向写反**的规则，它必须报红——
  // 否则这道门就是装饰品（"有测试"证明不了"这道门真的会咬"）。
  it("🔴 方向可达门的变异反证：喂一条方向写反的规则（#158 原文），门必须判它死", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const links = await t.repos.links.list("demo");
    const typeOf = new Map<string, string>();
    for (const ot of await t.repos.ontologyTypes.list("demo")) {
      for (const o of await t.repos.objects.listByType("demo", ot.key)) typeOf.set(o.id, o.type);
    }
    const reachable = (sourceTypeKey: string, viaLinkKey: string, targetTypeKey: string) =>
      links.some((l) => l.type === viaLinkKey && typeOf.get(l.fromId) === sourceTypeKey && typeOf.get(l.toId) === targetTypeKey);

    // #158 原文（Line --line_belongs_to_base--> Base）：真链路是 Base→Line ⇒ 必须不可达。
    expect(reachable("Line", "line_belongs_to_base", "Base")).toBe(false);
    // 修正后的方向（Base→Line）：必须可达。两条一起才说明门分得清方向，不是恒真/恒假。
    expect(reachable("Base", "line_belongs_to_base", "Line")).toBe(true);
  });

  it("确定性 R6：同 SEED_DEMO 重跑规则字节一致（固定 id/系数）", async () => {
    const snapshot = async () => {
      const t = await makeApp();
      await seedDemoPropagationRules(t.repos);
      const items = await t.repos.sim.listPropagationRules("demo", true);
      return JSON.stringify([...items].sort((a, b) => a.id.localeCompare(b.id)));
    };
    expect(await snapshot()).toBe(await snapshot());
  });

  it("幂等：重复播种不增项（固定 id 覆盖）", async () => {
    const t = await makeApp();
    await seedDemoPropagationRules(t.repos);
    await seedDemoPropagationRules(t.repos);
    const items = await t.repos.sim.listPropagationRules("demo", true);
    expect(items.length).toBe(13);
  });

  it("live-fire：种子规则 + 真 Order→Model 链路 → tick 真跨对象传导", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    // 取一条真 order_for_model 链路（demo 真对象实例），在其 source 订单上置初始压力。
    const links = await t.repos.links.list("demo", (l) => l.type === "order_for_model");
    expect(links.length).toBeGreaterThan(0);
    const { fromId: orderId, toId: modelId } = links[0]!;
    const sid = (await (await t.app.inject({
      method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
      payload: { baseSnapshot: { [orderId]: { demandPressure: 10 }, [modelId]: { demandLoad: 0 } } },
    })).json()).id as string;
    const tick = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });
    expect(tick.statusCode).toBe(200);
    // Order.demandPressure=10 × coeff 0.8 → Model.demandLoad += 8（沿 order_for_model 即时传导）。
    expect((tick.json().state as Record<string, Record<string, number>>)[modelId]!.demandLoad).toBe(8);
  });

  // ── 🔴 效果层 SEAM（WO-P1 §4）：供应侧扰动 → 跨 3 跳真的传导到 Order ──────────────
  // 断言的是**传导能力**，不是"规则条数变多了"——后者度量的是种子数量，不是这条链通不通。
  // 接缝在这里：WO-P0 的「扰动一等公民」（写端）× WO-P1 的「六方向传导边」（图端），
  // 任一半漏都红：扰动没落到 state ⇒ 源恒 0 不传导；边写反/缺失 ⇒ 值走不到 Order。
  it("🔴 效果层 SEAM：供应侧扰动（Supplier.deliveryDelay）跨 3 跳真的传导到 Order.shortageRisk", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);

    // 沿真链路取 Supplier → Material → Model → Order 一条完整实例链（全部来自真链路表）。
    const links = await t.repos.links.list("demo");
    const ssm = links.find((l) => l.type === "supplier_supplies_material")!;
    const supplierId = ssm.fromId, materialId = ssm.toId;
    const mubm = links.find((l) => l.type === "material_used_by_model" && l.fromId === materialId)!;
    const modelId = mubm.toId;
    const mdbo = links.find((l) => l.type === "model_demanded_by_order" && l.fromId === modelId)!;
    const orderId = mdbo.toId;
    // 前置事实：这条链真的是 3 跳、四个不同对象（否则下面测了个寂寞）。
    expect(new Set([supplierId, materialId, modelId, orderId]).size).toBe(4);

    const sid = (await (await t.app.inject({
      method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
      payload: { baseSnapshot: { [supplierId]: { deliveryDelay: 0 } } },
    })).json()).id as string;

    // 经**真扰动路由**施加供应侧扰动（不是直接写 baseSnapshot —— 那样测不到写端接缝）。
    const created = await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${sid}/perturbations`, headers: ADMIN,
      payload: { kind: "supply_disruption", targetObjectId: supplierId, targetStateVar: "deliveryDelay", magnitude: 10, mode: "set", label: "供应商交付延迟 10 天" },
    });
    expect(created.statusCode).toBe(201);

    const st = (r: unknown) => (r as { state: Record<string, Record<string, number>> }).state;
    // tick1：Supplier(10) ×0.9 → Material.shortageRisk = 9。Order 还没轮到（一 tick 一跳）。
    const t1 = st((await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } })).json());
    expect(t1[materialId]!.shortageRisk).toBe(9);
    expect(t1[orderId]?.shortageRisk ?? 0).toBe(0);
    // tick2：Model.supplyRisk = 12.6。**不是** 9×0.7=6.3 —— 这条链上有一处真实的**扇入**：
    // 该供应商供两种料（pos_ncm / pos_lfp），两种料都进同一个型号的 BOM ⇒ 6.3 + 6.3（combine:"sum"）。
    // 这里刻意钉 12.6 而不是 ≥0：扇入被漏掉时（比如逆边只落了一半）这行会红，而 ≥0 照样绿。
    // Order 仍为 0 —— 证明它确实**跨了多跳**，不是某条一跳捷径顺手写到的。
    const t2 = st((await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } })).json());
    expect(t2[modelId]!.supplyRisk).toBe(12.6);
    expect(t2[orderId]?.shortageRisk ?? 0).toBe(0);
    // tick3：Model(12.6) ×0.8 → Order.shortageRisk = 10.08。
    // 🔴 这一行就是本单的效果层判据：供应侧的一次扰动，真的落到了订单缺口上。
    const t3 = st((await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } })).json());
    expect(t3[orderId]!.shortageRisk).toBe(10.08);

    // 并且 trace 里能读到这三跳的原文（North Star「断点」维要的溯源承载物）。
    const trace = (await t.repos.sim.getTickState("demo", sid, 3))!.trace!;
    expect(trace.some((x) => x.ruleKey === "demo_model_supply_risk_to_order_shortage" && x.toObjectId === orderId && x.viaLinkKey === "model_demanded_by_order")).toBe(true);
  });

  // 六方向各有一条边真触发（REQ143 的验收面）：一次扰动六个源头，逐方向核 trace。
  it("🔴 六方向逐条真触发：13 条规则在真 tick 的 trace 里一条不缺（REQ143）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);

    const links = await t.repos.links.list("demo");
    const head = (type: string) => links.find((l) => l.type === type)!.fromId;
    const orderId = head("order_for_model"), baseId = head("line_belongs_to_base");
    const supplierId = head("supplier_supplies_material"), materialId = head("material_used_by_model");

    const sid = (await (await t.app.inject({
      method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
      payload: { baseSnapshot: {
        [orderId]: { demandPressure: 10, costPressure: 8 },
        [baseId]: { loadIndex: 20 },
        [supplierId]: { deliveryDelay: 10 },
        [materialId]: { priceShock: 5 },
      } },
    })).json()).id as string;
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 6 } });

    const fired = new Set<string>();
    for (let tk = 1; tk <= 6; tk++) {
      for (const x of (await t.repos.sim.getTickState("demo", sid, tk))?.trace ?? []) fired.add(x.ruleKey);
    }
    // 逐方向列出来 —— 哪个方向断了，报错信息直接指到那个方向，不用再去猜。
    const DIRS: Record<string, string[]> = {
      需求: ["demo_order_demand_pressure", "demo_model_demand_to_base_load"],
      产能: ["demo_base_load_to_line_util", "demo_line_util_to_process_queue"],
      供应: ["demo_supplier_delay_to_material_shortage", "demo_material_shortage_to_model_supply_risk", "demo_model_supply_risk_to_order_shortage"],
      交付: ["demo_material_shortage_to_po_expedite", "demo_po_expedite_to_inspection_queue"],
      成本: ["demo_material_price_to_model_cost", "demo_model_cost_to_order_cost"],
      现金: ["demo_order_cost_to_customer_receivable", "demo_customer_receivable_to_invoice_overdue"],
    };
    const missing = Object.entries(DIRS).flatMap(([dir, keys]) => keys.filter((k) => !fired.has(k)).map((k) => `${dir}/${k}`));
    expect(missing).toEqual([]);
    // 六方向合计 13 条 = 全部种子规则（没有哪条规则游离在六方向之外）。
    expect(Object.values(DIRS).flat().sort()).toEqual(
      (await t.repos.sim.listPropagationRules("demo", true)).map((r) => r.key).sort(),
    );
  });
});
