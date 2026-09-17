import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
import { PRESSURE_DECAY_PER_TICK, STATE_VAR_DOMAINS } from "../src/synthetic/battery.js";
import { saturateToDomain } from "../src/sim/propagation.js";
import { DEMO_SIM_WORLD_SESSION_ID, DEMO_SIM_WORLD_TICKS, seedDemoSimWorld } from "../src/sim/seed-world.js";

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
    expect(cfg.propagationCount).toBe(50); // WO-P1 13 → 档 1 +6 → 档 2 +15 → 档 3 +1 = 35 → WO-SIM-ROOT-TRIAD +4 = 39 → 补 3 条 = 42 → WO-SLICE-DOMAINS 设备侧出口 +4 = 46 → WO-ADVERSARY-REACTION +1 条**还手边**（对手方反应·默认关闭，但**目录不过滤** —— §3.3「关掉的边要可见地降级，不是从图上消失」，故这四处的口径一致、数也一致）= 47 → WO-SIM-ORDER-REAL-FIELDS +3 条**订单真实字段边**（`Order.qty`/`unitPrice`/`leadDays` → `Model.backlogQtyTop`/`backlogPriceTop`/`backlogHorizonDays`，皆 PUBLISHED·combine max·系数 1.0 原样透传）= 50
    expect(cfg.stateVars.length).toBeGreaterThan(0);
    // stateVars 派生自规则 source/target stateVar。WO-P1 后覆盖六个方向的量纲：
    // 需求(demandPressure/demandLoad/loadIndex/utilPressure) · 产能(queuePressure) ·
    // 供应(deliveryDelay/shortageRisk/supplyRisk) · 交付(expeditePressure/queueDays) ·
    // 成本(priceShock/costPressure) · 现金(receivablePressure/overduePressure)。
    // 档 1 扩面再补 6 个量纲（换型/批次周转/清关排队/检修窗挤压/认证排队/来料催交），
    // 档 2 再补 15 个（执行层 工单/在制/质检/缺陷/异常 · 订单行/承诺/收货地点/催收 ·
    // 替代料/MRP 缺口 · 调拨 · 设备负荷/维修积压 · 成品提货）。
    // 档 3 再补 1 个 `reviewPressure`（供应商绩效复评）——它是 `Supplier` 身上**第一个被写**的量纲，
    // 在此之前 Supplier 只当 source ⇒ P28 屏上标着「随节拍变」而读数恒定（见 seed.ts 档 3 段头）。
    // WO-SIM-ROOT-TRIAD 再补 3 个**根源**量纲（入度 0 = 只能被外部打进来）：
    // `forecastBias`（销售预测偏差·带方向）· `orderChurn`（订单变更压力）· `equipmentFailure`（设备故障率）。
    // WO-SLICE-DOMAINS 再补 1 个量纲 `blockedPressure`（产线**被设备堵住**的受阻压力）——
    // 它是设备侧接回产能主链的落点：此前从 Equipment 出发的可达集只有
    // {Equipment, MaintenanceOrder, Process}，设备故障对订单/毛利的贡献恒为 0。
    // 之所以另起量纲而不复用 `utilPressure`：既有 `demo_line_util_to_process_queue` 已写
    // `Line.utilPressure → Process.queuePressure`，反着写回去就闭成自我放大的二环。
    expect(cfg.stateVars).toEqual([
      // WO-SIM-ORDER-REAL-FIELDS +6：前三个是**订单身上那三个属性本尊**（`Order.qty`/`unitPrice`/
      // `leadDays`，同名直取 ⇒ tick0 读的是真值，`measuredCells` 由 0 变 450），后三个是它们
      // 沿 `order_for_model` 的落点。⚠ 这 6 个**不是压力量纲**，带真实单位（套/元/天），
      // 故刻意不进 `STATE_VAR_DOMAINS`（不夹不衰减，tick 回执 `undeclaredStateVars` 里点名）。
      "backlogHorizonDays", "backlogPriceTop", "backlogQtyTop",
      "blockedPressure", "changeoverPressure", "clearanceQueueDays", "collectionPressure", "costPressure",
      "defectPressure", "deliveryDelay", "deliveryHoldRisk", "demandLoad", "demandPressure",
      "drawdownPressure", "equipmentFailure", "expeditePressure", "feedPressure", "forecastBias",
      "gapPressure", "handlingBacklog", "inboundExpeditePressure", "inspectBacklog", "leadDays", "loadIndex",
      "loadPressure", "orderChurn", "overduePressure", "priceShock", "procurementDelay",
      "promiseRisk", "qty", "qualificationQueue", "queueDays", "queuePressure", "receivablePressure",
      "releasePressure", "repairBacklog", "reviewPressure", "shortageRisk", "splitPressure",
      "supplyRisk", "switchPressure", "transferPressure", "turnoverPressure", "unitPrice", "utilPressure",
      "windowSqueeze",
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
    expect(items.length).toBe(50); // WO-SLICE-DOMAINS：42 + 设备侧出口 4 条 = 46 → WO-ADVERSARY-REACTION +1 条**还手边**（对手方反应·默认关闭，但**目录不过滤** —— §3.3「关掉的边要可见地降级，不是从图上消失」，故这四处的口径一致、数也一致）= 47 → WO-SIM-ORDER-REAL-FIELDS +3 条**订单真实字段边**（`Order.qty`/`unitPrice`/`leadDays` → `Model.backlogQtyTop`/`backlogPriceTop`/`backlogHorizonDays`，皆 PUBLISHED·combine max·系数 1.0 原样透传）= 50
    expect(items.every((r) => r.status === "PUBLISHED")).toBe(true);
    const viaKeys = items.map((r) => r.viaLinkKey).sort();
    // WO-SIM-ROOT-TRIAD 新增 4 条根源边全部挂**已物化**的既有链路（零新 linkType、零新物化）：
    // `model_demanded_by_order` 第 3 条（预测偏差→订单需求压力）· `order_has_line` 第 2 条 +
    // `order_for_model` 第 2 条（订单变更→拆行 / →型号需求负载）· `equip_used_in` 首条（设备故障→工序排队）。
    // WO-SLICE-DOMAINS 再补 4 条（设备侧出口）：`process_belongs_to_line` 首条（**本单新声明+新物化**，
    // 它是 Equipment/Process 走出 {Equipment, MaintenanceOrder, Process} 闭包的唯一出口）·
    // `line_runs_work_order` 第 2 条（产线受阻→工单下达受阻）·
    // `wo_for_model` 两条（**本单新物化**：该 linkType 早已声明却从未落过一条实例，
    // 是制造侧回到产品/订单侧的唯一一跳；两条分别走供给面 supplyRisk 与成本面 costPressure）。
    expect(viaKeys).toEqual([
      "base_dispatches_transfer", "base_has_shipment", "base_maint_plan", "batch_replenishes_material", "customer_has_invoice",
      // WO-ADVERSARY-REACTION 的还手边挂 `customer_places_order`（`order_of_customer` 的影响向逆边）。
      // ⚠ 它**默认关闭但目录不过滤**（§3.3「关掉的边要可见地降级，不是从图上消失」），
      //   故这份清单里有它 —— 这份清单数的是**目录**，不是"默认世界会跑的边"。
      "customer_has_location", "customer_has_overdue_record", "customer_places_order",
      "defect_raises_exception", "equip_used_in", "equipment_has_maintenance_order",
      "line_belongs_to_base", "line_has_process", "line_runs_work_order", "line_runs_work_order", "material_has_alternative",
      "material_has_balance", "material_has_batch", "material_supplied_by_po", "material_used_by_model", "material_used_by_model",
      "model_changeover", "model_demanded_by_order", "model_demanded_by_order", "model_demanded_by_order", "model_has_cert",
      // WO-SIM-ORDER-REAL-FIELDS 三条订单真实字段边**全部挂 `order_for_model`**
      // （已物化的既有链路·零新 linkType·零新物化）⇒ 这一项由 2 条变 5 条。
      "model_producible_at", "model_stocked_as_finished_goods",
      "order_for_model", "order_for_model", "order_for_model", "order_for_model", "order_for_model",
      "order_has_line",
      "order_has_line", "order_has_promise", "order_of_customer", "po_customs_cleared_by", "po_from_supplier",
      "po_inspected_by", "po_replenishes_material", "process_belongs_to_line", "process_uses_equipment", "supplier_supplies_material",
      "supplier_supplies_material", "wip_lot_found_defect", "wo_for_model", "wo_for_model", "work_order_sampled_by_quality_lot",
      "work_order_yields_wip_lot",
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
    expect(rules.length).toBe(50); // WO-SLICE-DOMAINS：42 + 设备侧出口 4 条 = 46 → WO-ADVERSARY-REACTION +1 条**还手边**（对手方反应·默认关闭，但**目录不过滤** —— §3.3「关掉的边要可见地降级，不是从图上消失」，故这四处的口径一致、数也一致）= 47 → WO-SIM-ORDER-REAL-FIELDS +3 条**订单真实字段边**（`Order.qty`/`unitPrice`/`leadDays` → `Model.backlogQtyTop`/`backlogPriceTop`/`backlogHorizonDays`，皆 PUBLISHED·combine max·系数 1.0 原样透传）= 50
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
    expect(items.length).toBe(50); // WO-SLICE-DOMAINS：42 + 设备侧出口 4 条 = 46 → WO-ADVERSARY-REACTION +1 条**还手边**（对手方反应·默认关闭，但**目录不过滤** —— §3.3「关掉的边要可见地降级，不是从图上消失」，故这四处的口径一致、数也一致）= 47 → WO-SIM-ORDER-REAL-FIELDS +3 条**订单真实字段边**（`Order.qty`/`unitPrice`/`leadDays` → `Model.backlogQtyTop`/`backlogPriceTop`/`backlogHorizonDays`，皆 PUBLISHED·combine max·系数 1.0 原样透传）= 50
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
    // `?explain=1`：逐对权重出处默认不下发（实测占回包 99.75%），本用例要拿它来**独立复算**权重，
    // 故显式索取 —— 这同时顺带验了那个开关真的有效（不加就拿不到，下面的 expect 会红）。
    const tick = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick?explain=1`, headers: ADMIN, payload: { n: 1 } });
    expect(tick.statusCode).toBe(200);
    const body = tick.json() as {
      state: Record<string, Record<string, number>>;
      pairWeighting?: {
        report: {
          pairs: { ruleKey: string; coefficient: number }[];
          explain: { ruleKey: string; sourceObjectId: string; targetObjectId: string; weight: number; numerator: number; denominator: number }[];
        };
      };
    };
    // ── 金值改动说明（WO-COEF-FROM-BOM）──────────────────────────────────────
    // 修前：`Order.demandPressure 10 × coeff 0.8 = 8`，**与这张单多大无关** —— 那正是病。
    // 修后：再乘该单的**订单量相对倍率**（`Order.qty ÷ 该型号在手单 qty 均值`，均值=1·保总量）。
    // 这里**不写死新数字**（那就是"跑一遍把期望值贴上去"），而是**从回包自带的出处**里
    // 取出这一对的分子/分母，当场把 `coeff × qty/均值 × 10` 算出来比对 ——
    // 断言与实现各自独立地算一遍同一个式子，两边对上才算数。
    //
    // ── ⚠ 金值再改（WO-SIM-DESAT-3 ②）：那个 `0.8` 从**字面量**换成**回包里的 coefficient** ──
    // 本单把 `coefficient` 的口径从「稳态增益」改成「每拍入流」= `稳态增益 × λ`
    // ⇒ 该边字段值 `0.8 → 0.8 × 0.37 = 0.296`，本行原写死的 `0.8` 当场对不上
    //   （实测 expected 8.50145175064 vs actual 3.145537147737，比值 **2.7027 = 1/λ**）。
    // **改法不是把 0.8 换成 0.296**（那还是第二份字面量，下次重标又漂），
    // 而是从**同一个回包自带的披露**里取该规则真用的 `coefficient` —— 与本用例
    // 「分子/分母也从回包取」那条既有纪律逐字相同：断言与实现各自独立算同一个式子。
    // 并且**下一行仍然把 0.8 这个稳态增益钉死**（`coefficient === 0.8 × λ`）——
    // 所以覆盖面没缩：谁改了这条边的强度，这里照样红。
    const pair = body.pairWeighting?.report.pairs.find((p) => p.ruleKey === "demo_order_demand_pressure");
    expect(pair, "回包里没有这条规则的分摊报告 ⇒ 可披露这条没落地").toBeDefined();
    const DEMAND_GAIN = 0.8; // 该边 description 承诺的稳态增益（本单预算内未缩）
    expect(
      pair!.coefficient,
      "该边的每拍入流系数 ≠ 稳态增益 × λ ⇒ 要么有人绕过了 inflowCoefficient，要么 λ 不再取自 C35",
    ).toBe(Math.round(DEMAND_GAIN * PRESSURE_DECAY_PER_TICK * 1e12) / 1e12);
    const explain = body.pairWeighting?.report.explain.find(
      (e) => e.ruleKey === "demo_order_demand_pressure" && e.sourceObjectId === orderId && e.targetObjectId === modelId,
    );
    expect(explain, "回包里没有这一对的权重出处 ⇒ 可披露这条没落地（仓主硬要求①）").toBeDefined();
    expect(explain!.denominator, "分母（该型号在手单 qty 均值）为 0 ⇒ 出处算错了").toBeGreaterThan(0);
    const expected = Math.round(pair!.coefficient * (explain!.numerator / explain!.denominator) * 10 * 1e12) / 1e12;
    expect(body.state[modelId]!.demandLoad).toBe(expected);
    // 且**必须真的与 8 不同**（除非这张单恰好是均值单）—— 否则这条用例又退回去度量"没分摊"。
    expect(explain!.weight).toBeGreaterThan(0);
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
    /**
     * 读一格世界态，**读不到就当场红**（不是悄悄当 0）。
     * 存在的理由是 `noUncheckedIndexedAccess`：`s[obj]!.v` 里那个 `!` 只消掉**外层**索引，
     * `.v` 仍是 `number | undefined` ⇒ 参与算术时 TS2532。用它替代连写的 `!`，
     * 既让类型收敛，又把"这一格根本没有"从**静默 NaN** 变成**指名道姓的断言失败**。
     */
    const readVar = (s: Record<string, Record<string, number>>, objId: string, v: string): number => {
      const got = s[objId]?.[v];
      expect(typeof got, `世界态里读不到 ${objId}.${v} ⇒ 取数坏了（不是"这条链没通"）`).toBe("number");
      return got as number;
    };

    // ── ⚠ 金值全改（WO-SIM-DESAT-3 ②③）：9 / 6.3 / 5.04 → 由两个乘数现算 ──────────────
    //
    // 原三个数是 `10×0.9`、`9×0.7`、`6.3×0.8` —— 直接把三条边的 `coefficient` 字面量抄进了断言。
    // 本单动了**两个**乘数，两个都会让这三个数变：
    //  ② `coefficient` 口径 = 稳态增益 × λ ⇒ `0.9 → 0.241×0.37 = 0.08917`（该边预算内被缩）；
    //  ③ `demo_supplier_delay_to_material_shortage` 挂上 Σ=1 等份口径 ⇒ 该物料有 N 个供应商时
    //     每个只出 `1/N` 份，而不是**各出一整份**。实测本链上那个物料 N=2 ⇒ 权重 0.5，
    //     于是 tick1 = `10 × 0.08917 × 0.5 = 0.44585`（实测值逐位吻合，比值恰为 0.9/0.08917/2）。
    //
    // **改法不是把三个新数贴上去**：那样下次重标又得贴一遍，且贴上去的数没人能验。
    // 改成从**同一个回包/规则表**取那两个乘数，断言与实现各自独立算同一个式子 ——
    // 与本文件 live-fire 用例、§5 对照实验立下的是同一条纪律。
    //
    // **为什么改后不比改前弱**：
    //  · 三跳的**结构**判据一个没动（Order 在 t1/t2 必须仍是 0、t3 才非 0 ⇒ 真跨了 3 跳）；
    //  · 每一跳仍是精确 `toBe`，不是 `toBeGreaterThan` 之类的放宽；
    //  · **另加了**「每跳必须 > 0」——原断言里没有：若某跳权重被算成 0，
    //    原式 `toBe(9)` 会红，而新式若不加这条会 `toBe(0)` 自洽成绿。这一条是新补的防线。
    const rules = await t.repos.sim.listPropagationRules("demo", true);
    const coefOf = (key: string): number => {
      const r = rules.find((x) => x.key === key);
      expect(r, `规则表里找不到 ${key} ⇒ 取数坏了，不是"这条边不存在"`).toBeDefined();
      return r!.coefficient;
    };
    /**
     * **这一对 (源, 目标) 的权重** —— ⚠ 不是"落到该目标的权重之和"。
     *
     * ── 原版错在哪（实测，本行修前该用例红在 tick1）────────────────────────────────
     * 原版按 `targetObjectId` 一个键聚合再求和：`rows.reduce((s,e)=>s+e.weight,0)`。
     * `equal_share` 是 Σ=1 口径 ⇒ **该和恒为 1**，于是期望值恒等于"全部源都带着满值"那一档。
     * 而本用例只给**一个**源（`SUP-001`）施了扰动，同物料的另一个供应商 `deliveryDelay` 仍是 0、
     * 贡献 0。引擎算的是 `Σ_源 coef × 该对权重 × 该源读数`，只有一项非零 ⇒
     * `10 × 0.08917 × 0.5 = 0.44585`。实测回包：`demo_supplier_delay_to_material_shortage`
     * 落到 `obj_material_pos_ncm` 的 explain 行**恰有 2 条、各 0.5**（和 = 1）。
     * ⇒ 修前期望 0.8917、实测 0.44585，**红的是断言不是引擎**。
     *
     * 佐证：本文件上方那段注释自己写的就是正确答案 ——
     * 「实测本链上那个物料 N=2 ⇒ 权重 0.5，于是 tick1 = `10 × 0.08917 × 0.5 = 0.44585`
     * （实测值逐位吻合）」。**注释是对的，代码没照它写。**
     *
     * 形态（铁律 0.6 句式）：「我用『该目标全部入边的权重和』当作『这条链上那一对的权重』的证据，
     * 而前者并不度量后者 —— 只有被扰动的那个源带着值，其余源乘 0。」
     *
     * **改后不比改前弱**：仍是精确 `toBe`，仍逐跳 `>0` 自证非空；且新版按 (源,目标) 定位，
     * 扇入条数变化时它跟着变，原版恒 1 反而对扇入不敏感。
     */
    const weightOfPair = (body: unknown, ruleKey: string, sourceId: string, targetId: string): number => {
      const ex = (body as { pairWeighting?: { report: { explain: { ruleKey: string; sourceObjectId: string; targetObjectId: string; weight: number }[] } } })
        .pairWeighting?.report.explain ?? [];
      const rows = ex.filter((e) => e.ruleKey === ruleKey && e.targetObjectId === targetId && e.sourceObjectId === sourceId);
      // 该规则没声明口径 ⇒ 回包里没有它的逐对出处 ⇒ 该源出一整份满额 ⇒ 权重 1。
      return rows.length === 0 ? 1 : rows.reduce((s, e) => s + e.weight, 0);
    };
    const tick1 = (await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick?explain=1`, headers: ADMIN, payload: { n: 1 } })).json();
    const t1 = st(tick1);
    // tick1：Supplier(10) × 该边每拍入流系数 × 该对权重 → Material.shortageRisk。Order 还没轮到（一 tick 一跳）。
    const w1 = weightOfPair(tick1, "demo_supplier_delay_to_material_shortage", supplierId, materialId);
    const exp1 = Math.round(10 * coefOf("demo_supplier_delay_to_material_shortage") * w1 * 1e12) / 1e12;
    expect(exp1, "第 1 跳的期望值算成 0 ⇒ 系数或权重取数坏了（0 会让下面三句自洽成绿）").toBeGreaterThan(0);
    expect(t1[materialId]!.shortageRisk).toBe(exp1);
    expect(t1[orderId]?.shortageRisk ?? 0).toBe(0);
    // tick2：Model.supplyRisk = 9 × 0.7 = 6.3。
    //
    // ⚠ **本行原为 12.6，由 `WO-COMPUTED-EDGE-IMPL`（2026-09-07）改为 6.3。原注释把一个数据缺陷
    //   写成了「一处真实的扇入」**，原文是：
    //     「该供应商供两种料（pos_ncm / pos_lfp），两种料都进同一个型号的 BOM ⇒ 6.3 + 6.3」
    //   ——「该供应商供两种料」属实（`SUP-001` 是全表唯一供两种料的供应商，实测），
    //   但「两种料都进同一个型号的 BOM」**不属实**：那是旧捷径边的产物。
    //   旧 `model_uses_material` 的物料集由一句模运算 `matIds[(mi*2+k) % 8]` 算出（每型号 4 种），
    //   与 BOM 表无关，于是会给一个 NCM 型号同时挂上 `pos_ncm` 与 `pos_lfp` ——
    //   **一个三元型号同时吃三元正极和磷酸铁锂正极，物理上不成立。**
    //   捷径边口径归一到 BOM 链之后（每型号 7 种，按化学体系跳掉对侧正极），
    //   同一个型号只可能有一种正极 ⇒ 扇入从 2 回到 1，读数从 12.6 回到 6.3。
    //   **12.6 那个数不是被改小了，是那处「扇入」本来就不该存在。**
    //
    // ⚠ 于是本行**不再**承担「扇入被漏掉时会红」那个职责（这条链上今天没有真实扇入了）。
    //   它原本要防的「正逆两向边只落了一半」由
    //   `linktype-computed-edge.seam.test.ts` §7 直接断言两向严格互逆来守 —— 那是更强的判据：
    //   它咬的是两个集合相等，不是某一个读数恰好翻倍。
    // Order 仍为 0 —— 证明它确实**跨了多跳**，不是某条一跳捷径顺手写到的。
    // tick2：Material(上一跳读数) × 该边每拍入流系数 × 该对权重 → Model.supplyRisk。
    // ⚠ `demo_material_shortage_to_model_supply_risk` 本单也挂了 Σ=1 等份口径（N=7）⇒ 权重不再是 7 份满额。
    const tick2 = (await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick?explain=1`, headers: ADMIN, payload: { n: 1 } })).json();
    const t2 = st(tick2);
    const w2 = weightOfPair(tick2, "demo_material_shortage_to_model_supply_risk", materialId, modelId);
    // ⚠ `readVar` 而不是 `x!.y`：`noUncheckedIndexedAccess` 下 `t1[materialId]!.shortageRisk`
    // 的类型仍是 `number | undefined`（`!` 只消掉外层那一次索引），乘法处 TS2532。
    // 这两行**在 base 上就是红的**（`origin/claude/base-four-items` 实测同样两条，
    // 只是行号 350/359），不是本单引入的。用显式读取兼断言，顺手让 `pnpm -r typecheck` 归零。
    const exp2 = Math.round(readVar(t1, materialId, "shortageRisk") * coefOf("demo_material_shortage_to_model_supply_risk") * w2 * 1e12) / 1e12;
    expect(exp2, "第 2 跳的期望值算成 0 ⇒ 取数坏了").toBeGreaterThan(0);
    expect(t2[modelId]!.supplyRisk).toBe(exp2);
    expect(t2[orderId]?.shortageRisk ?? 0).toBe(0);
    // tick3：Model(上一跳读数) × 该边每拍入流系数 × 该对权重 → Order.shortageRisk。
    // 🔴 这一行就是本单的效果层判据：供应侧的一次扰动，真的落到了订单缺口上。
    const tick3 = (await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick?explain=1`, headers: ADMIN, payload: { n: 1 } })).json();
    const t3 = st(tick3);
    const w3 = weightOfPair(tick3, "demo_model_supply_risk_to_order_shortage", modelId, orderId);
    const exp3 = Math.round(readVar(t2, modelId, "supplyRisk") * coefOf("demo_model_supply_risk_to_order_shortage") * w3 * 1e12) / 1e12;
    expect(exp3, "第 3 跳的期望值算成 0 ⇒ 取数坏了").toBeGreaterThan(0);
    expect(t3[orderId]!.shortageRisk).toBe(exp3);

    // 并且 trace 里能读到这三跳的原文（North Star「断点」维要的溯源承载物）。
    const trace = (await t.repos.sim.getTickState("demo", sid, 3))!.trace!;
    expect(trace.some((x) => x.ruleKey === "demo_model_supply_risk_to_order_shortage" && x.toObjectId === orderId && x.viaLinkKey === "model_demanded_by_order")).toBe(true);
  });

  // 每条边真触发（REQ143 的验收面 + 档 1 扩面）：一次扰动若干源头，逐组核 trace。
  it("🔴 逐条真触发：49 条规则在真 tick 的 trace 里一条不缺（REQ143 + 档 1/2/3 + 采购根源 3 + 三根源 4 + 设备侧出口 4 + 订单真实字段 3）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);

    const links = await t.repos.links.list("demo");
    const head = (type: string) => links.find((l) => l.type === type)!.fromId;
    const orderId = head("order_for_model"), baseId = head("line_belongs_to_base");
    const supplierId = head("supplier_supplies_material"), materialId = head("material_used_by_model");

    // 🔴 清关段要**沿着真实例链**回溯着扰，不能指望"随便扰一个供应商"就能带到它。
    // 实测（本单）：全 demo 只有 **1 条** `po_customs_cleared_by` 边（S 规模下只有高电压电解液
    // 主供 SUP-015 是进口·`battery-extended.ts:271` 有原文），而 `head("supplier_supplies_material")`
    // 取到的是另一家 —— 于是这条规则**结构上可达（方向门绿）却在本用例里恒不触发**。
    // 这正是本仓要分清的两态：「没接线」vs「接了线但这次的源够不着」。修法是**把源接到位**，
    // 不是把断言放宽成 `≥0`（放宽等于让这条链断了也照样绿）。
    const customsLink = links.find((l) => l.type === "po_customs_cleared_by")!;
    const customsPoId = customsLink.fromId;
    const customsMatId = links.find((l) => l.type === "material_supplied_by_po" && l.toId === customsPoId)!.fromId;
    const customsSupplierId = links.find((l) => l.type === "supplier_supplies_material" && l.toId === customsMatId)!.fromId;

    // WO-SIM-ROOT-TRIAD：三个**新根源**同样要各给一个活源 —— 它们入度 0（没有任何规则写它们），
    // 不给源就永远进不了 trace。落点取各自那条边的 from 端（与上面几行同一条取法）。
    const rootModelId = head("model_demanded_by_order"), rootEquipId = head("equip_used_in");
    // WO-SIM-ROOT-PROCUREMENT 的两条新物化逆边（收编时嫁接自 48ebb6ac）。
    const procurePoId = head("po_replenishes_material"), procureBatchId = head("batch_replenishes_material");

    const sid = (await (await t.app.inject({
      method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
      payload: { baseSnapshot: {
        // WO-SIM-ORDER-REAL-FIELDS 三个真实业务字段与 `orderChurn` 一样是**入度 0 的根**
        // （没有任何规则写它们）⇒ 必须自带源，指望被别的源带动是自相矛盾的。
        // 值取真实量级（本租户在手单实测 qty 708–21777 套 / unitPrice 13594–22660 元 /
        // leadDays −14–178 天），⛔ 不能填 0：引擎对 `sourceVal === 0` 直接跳过，
        // 填 0 会让这三条"没触发"，而原因是数据不是接线 —— 那正是本仓最难查的那类假红。
        [orderId]: { demandPressure: 10, costPressure: 8, orderChurn: 10, qty: 5000, unitPrice: 18000, leadDays: 30 },
        [baseId]: { loadIndex: 20 },
        [supplierId]: { deliveryDelay: 10, procurementDelay: 7 },
        [procurePoId]: { procurementDelay: 7 },
        [procureBatchId]: { procurementDelay: 7 },
        [customsSupplierId]: { deliveryDelay: 10 }, // 进口料的主供 —— 清关段唯一的活源
        [materialId]: { priceShock: 5 },
        [rootModelId]: { forecastBias: 10 },
        [rootEquipId]: { equipmentFailure: 10 },
      } },
    })).json()).id as string;
    // 🔴 为什么是 9 拍不是 6 拍：档 2 把执行链接长了 —— 最深的一条是
    //   Base.loadIndex →(delay1) Line →(0) WorkOrder →(0) WIPLot →(delay1) DefectRecord →(0) ExceptionEvent，
    //   算上「产出落在 tick+1」这一格，异常处置积压要到第 7 拍才出现。原来的 6 拍**恰好差一拍** ⇒
    //   `demo_defect_to_exception_backlog` 被判"没触发"。这是本用例自己抖出来的（机器先说话），
    //   修法是把拍数加够，不是把这条从名单里删掉。
    await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 9 } });

    const fired = new Set<string>();
    for (let tk = 1; tk <= 9; tk++) {
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
      // WO-PROCESS-TICK-COVERAGE 档 1：挂在既有正向边上的六条扩面规则。
      // 它们全部由上面四个源头（订单需求 / 基地负载 / 供应商延迟 / 物料涨价）经既有链驱动，
      // 不额外造源 —— 「能不能被现有扰动带动」本身就是这一档要证明的事。
      扩面档1: [
        "demo_model_demand_to_changeover_pressure", "demo_material_shortage_to_batch_turnover",
        "demo_po_expedite_to_customs_queue", "demo_base_load_to_maint_window_squeeze",
        "demo_model_demand_to_cert_queue", "demo_base_load_to_inbound_expedite",
      ],
      // WO-PROCESS-TICK-COVERAGE 档 2：挂在新补的**影响向逆边**上的 15 条。
      // 同样不额外造源 —— 全部由上面那四个源头（订单需求 / 基地负载 / 供应商延迟 / 物料涨价）
      // 沿真链传下来。哪一条没被带到，报错就直接指到它，不用再猜。
      扩面档2: [
        "demo_line_util_to_wo_release", "demo_wo_release_to_wip_feed", "demo_wo_release_to_quality_backlog",
        "demo_wip_feed_to_defect_pressure", "demo_defect_to_exception_backlog",
        "demo_order_demand_to_line_split", "demo_order_shortage_to_promise_risk",
        "demo_customer_receivable_to_location_hold", "demo_customer_receivable_to_collection",
        "demo_material_shortage_to_alt_switch", "demo_material_shortage_to_balance_gap",
        "demo_base_load_to_transfer_pressure",
        "demo_process_queue_to_equipment_load", "demo_equipment_load_to_repair_backlog",
        "demo_model_demand_to_fg_drawdown",
      ],
      // WO-PROCESS-TICK-COVERAGE 档 3：闭掉「标着会动、其实不动」那一条。
      // 它同样不额外造源 —— 由供应商延迟这个源头经 Material→PurchaseOrder 两跳带回 Supplier
      // （`Supplier.deliveryDelay` 出去、`Supplier.reviewPressure` 回来，是两个量纲不是回路）。
      扩面档3: ["demo_po_expedite_to_supplier_review"],
      // WO-SIM-ROOT-TRIAD：三个**根源**扰动因素（入度 0 = 只能被外部打进来）新增的 4 条边。
      // 与上面几档不同，这一档**必须自带源**（见上面 baseSnapshot 里的 forecastBias /
      // orderChurn / equipmentFailure 三格）—— 根源的定义就是"没有任何规则写它"，
      // 指望被别的源带动是自相矛盾的。
      采购根源: [
        "demo_po_procurement_delay_to_material_shortage",
        "demo_batch_procurement_delay_to_material_shortage",
        "demo_supplier_procurement_delay_to_material_shortage",
      ],
      根源: [
        "demo_forecast_bias_to_order_demand",
        "demo_order_churn_to_line_split", "demo_order_churn_to_model_demand_load",
        "demo_equipment_failure_to_process_queue",
      ],
      // WO-SLICE-DOMAINS：设备侧的**出口**四条。本组同样不额外造源 —— 由上面 baseSnapshot 里
      // 已有的 `equipmentFailure` 那一格沿新链带下来：
      //   Equipment.equipmentFailure → Process.queuePressure → Line.blockedPressure
      //   → WorkOrder.releasePressure →(delay1) Model.supplyRisk / Model.costPressure
      //   → （既有链）Order.shortageRisk / Order.costPressure → OrderPromise.promiseRisk / Customer.receivablePressure
      // 补这四条之前，从 Equipment 出发的类型级可达集只有 {Equipment, MaintenanceOrder, Process}
      // ⇒ 设备故障对订单与毛利的贡献**恒为 0**（真跑 8 拍实测：Order/Customer 全程 0 格）。
      设备侧出口: [
        "demo_process_queue_to_line_blocked", "demo_line_blocked_to_wo_release",
        "demo_wo_release_to_model_supply_risk", "demo_wo_release_to_model_cost",
      ],
      // WO-SIM-ORDER-REAL-FIELDS：订单**真实业务字段**的三条出边。
      // 与「根源」那一档同性质（入度 0、必须自带源，见上面 baseSnapshot 里那三格），
      // 不同点是它们的 tick0 值在**真种子世界**里不是外部打进来的，而是
      // `deriveSeedBaseSnapshot` 从对象属性上**直接读到的真值**（实测 measuredCells 450）。
      // 本用例用显式 baseSnapshot 建会话，所以这里仍要自带源。
      订单真实字段: [
        "demo_order_qty_to_model_top_qty",
        "demo_order_price_to_model_top_price",
        "demo_order_leaddays_to_model_horizon",
      ],
    };
    const missing = Object.entries(DIRS).flatMap(([dir, keys]) => keys.filter((k) => !fired.has(k)).map((k) => `${dir}/${k}`));
    expect(missing).toEqual([]);
    // ── 完整性：十二组 49 条 = **默认世界里会跑的**全部规则（没有哪条游离在分组之外）──
    //
    // 🔴 口径修正（WO-ADVERSARY-REACTION）：目录里从此有两类边，**必须分开数**——
    //  · **物理边**（`reaction == null`）：默认世界照跑，逐条都要在上面的 trace 里出现；
    //  · **还手边**（`reaction != null`）：功能键 `sim.propagation.adversary` **默认关闭**
    //    ⇒ 被滤出引擎，本来就**不该**在 trace 里；但它**仍留在目录里**
    //    （§3.3「关掉的边要可见地降级，不是从图上消失」）。
    //  ⇒ **「目录条数」从此不再度量「默认世界会跑几条边」**，拿它当判据就是本仓那个老形态。
    //
    // ⚠ 三条臂都要断言，少一条这道门就退化：
    //    只断言物理边 ⇒ 有人把还手边默认打开也不会红（出厂世界悄悄变了没人知道）；
    //    只断言总数   ⇒ 回到今天这个红，且分不清是"漏分组"还是"漏过滤"；
    //    不断言"没跑" ⇒ §2 反向对照就没有常驻守卫，只剩一次性人工测量。
    const all = await t.repos.sim.listPropagationRules("demo", true);
    const physicalKeys = all.filter((r) => r.reaction == null).map((r) => r.key).sort();
    const reactionKeys = all.filter((r) => r.reaction != null).map((r) => r.key).sort();
    expect(Object.values(DIRS).flat().sort()).toEqual(physicalKeys);
    // 臂 2（可见地降级）：还手边确实**在目录里**，没有从图上消失。
    expect(reactionKeys).toEqual(["demo_customer_reaction_cut_order"]);
    // 臂 3（出厂态守卫）：默认世界里它一拍都没跑过。跑了 = 对抗方没被闸住、既有行为被改坏。
    for (const k of reactionKeys) {
      expect(
        fired.has(k),
        `${k} 在**默认世界**（未开 sim.propagation.adversary）里触发了 ⇒ 出厂态被改坏`,
      ).toBe(false);
    }
  });
});

/**
 * WO-CAUSAL-EDGE-CRUD · **写入口**的引用体检（交付判据 2）。
 *
 * 上面那道「方向可达门」守的是**种子**：种进去的 42 条边方向对不对。
 * 但种子是对的**不度量**运营方经 REST 建出来的边是对的 —— 这一组守的是另一半：
 * `POST/PATCH /a/v1/sim/propagation-rules` 收不收一条端点根本不存在、或方向反了的边。
 *
 * 病灶（2026-09-03 真后端实测）：三个端点都是裸 `z.string()`，只要非空就过。
 * 一条源 `NoSuchType_ZZZ` / 链路 `no_such_link_ZZZ` / 目标 `AlsoMissing_ZZZ` 三者全不存在的边
 * **201 且 status=PUBLISHED**，当场计入「生效因果边」，而引擎 `navOut` 查无此链路 ⇒ 永远贡献 0。
 * 同族事故有前科：`POST /a/v1/ontology/link-types` 曾把 **133 条里的 81 条**端点不存在的结构边全部 201 放行。
 *
 * ⚠ 每条"必须拒绝"的断言都配一条**必须放行**的金丝雀 —— 否则一个把所有请求都判 400 的
 * 坏实现能让整组测试全绿（"门会咬"证明不了"门咬得准"，参照上面那条变异反证的写法）。
 */
describe("WO-CAUSAL-EDGE-CRUD · 因果边写入的引用体检", () => {
  /** 建一个装好本体 + 种子 + 已开 sim 特性的应用，并交出一条**真存在**的链路类型声明。 */
  const setup = async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const linkTypes = await t.repos.ontologyLinks.list("demo");
    // 🐤 金丝雀：链路类型声明表非空，否则下面每条用例都会因"链路不存在"而 400，
    // 整组测试会以**完全正确的理由**全绿，而它其实一个字都没验到（假绿的经典形态）。
    expect(linkTypes.length).toBeGreaterThan(0);
    const via = linkTypes.find((l) => l.key === "model_producible_at") ?? linkTypes[0]!;
    return { t, via };
  };
  const post = (t: TestApp, payload: Record<string, unknown>) =>
    t.app.inject({ method: "POST", url: "/a/v1/sim/propagation-rules", headers: ADMIN, payload });
  /** 一条**除被测那一格外全部合法**的边 —— 每条用例只动一格，故失败必然归因于那一格。 */
  const edge = (via: { key: string; fromTypeKey: string; toTypeKey: string }, over: Record<string, unknown> = {}) => ({
    key: "WRITE_PATH_PROBE", sourceTypeKey: via.fromTypeKey, sourceStateVar: "loadIndex",
    viaLinkKey: via.key, targetTypeKey: via.toTypeKey, targetStateVar: "supplyRisk",
    coefficient: 0.5, delayTicks: 0, combine: "sum", status: "PUBLISHED", ...over,
  });

  it("🐤 金丝雀：端点/链路全合法的边**必须建得出来**（证明这组门不是一律拒绝）", async () => {
    const { t, via } = await setup();
    const r = await post(t, edge(via));
    expect(r.statusCode).toBe(201);
  });

  it("🔴 端点不存在的边必须 400（link-types 那次 81/133 全放行的复发闸）", async () => {
    const { t, via } = await setup();
    const r = await post(t, edge(via, { sourceTypeKey: "NoSuchType_ZZZ", targetTypeKey: "AlsoMissing_ZZZ" }));
    expect(r.statusCode).toBe(400);
    const body = r.json() as { error: { code: string; message: string; requestId: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.requestId).toBeTruthy(); // 统一信封三件套齐全
    // 报文必须**点名是哪个值**不合法：只说"校验失败"的话，调用方唯一能做的就是猜。
    expect(body.error.message).toContain("NoSuchType_ZZZ");
    expect(body.error.message).toContain("AlsoMissing_ZZZ");
  });

  it("🔴 链路类型不存在的边必须 400", async () => {
    const { t, via } = await setup();
    const r = await post(t, edge(via, { viaLinkKey: "no_such_link_ZZZ" }));
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: { message: string } }).error.message).toContain("no_such_link_ZZZ");
  });

  it("🔴 方向写反的边必须 400 —— 引擎只沿 from→to 单向走，反向边语法全对但恒贡献 0", async () => {
    const { t, via } = await setup();
    // 源/目标对调（其余一格不动）⇒ 与链路声明的方向正好相反。
    const r = await post(t, edge(via, { sourceTypeKey: via.toTypeKey, targetTypeKey: via.fromTypeKey }));
    expect(r.statusCode).toBe(400);
    // 报文要说清"反了"并给出修法，不是只说"对不上"。
    expect((r.json() as { error: { message: string } }).error.message).toContain("方向正好反了");
  });

  it("🔴 coefficientRef 解析不到必须 400 —— 否则静默回落内联系数，用户以为改规则生效其实无效", async () => {
    const { t, via } = await setup();
    const r = await post(t, edge(via, { coefficientRef: { ruleKey: "NO_SUCH_RULE_ZZZ", paramKey: "p" } }));
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: { message: string } }).error.message).toContain("NO_SUCH_RULE_ZZZ");
  });

  it("🔴 PATCH 也走同一道体检：塞非法 coefficientRef 必须 400，而合法系数照常放行", async () => {
    const { t, via } = await setup();
    const created = (await post(t, edge(via))).json() as { id: string };
    const patch = (payload: Record<string, unknown>) =>
      t.app.inject({ method: "PATCH", url: `/a/v1/sim/propagation-rules/${created.id}`, headers: ADMIN, payload });

    const bad = await patch({ coefficientRef: { ruleKey: "NOPE_ZZZ", paramKey: "x" } });
    expect(bad.statusCode).toBe(400);
    // 🐤 配对金丝雀：同一条边、同一个 PATCH 口，合法改动必须仍然 200 且真的改到了值。
    const ok = await patch({ coefficient: 0.31 });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { coefficient: number }).coefficient).toBe(0.31);
  });

  it("🔴 体检在 upsert **之前**跑：非法边不许先把同 key 的合法边覆盖掉再报错", async () => {
    const { t, via } = await setup();
    expect((await post(t, edge(via, { coefficient: 0.5 }))).statusCode).toBe(201);
    // 同 key、但链路不存在 ⇒ 必须 400，且既有那条**原封不动**（系数仍是 0.5、版本没涨）。
    expect((await post(t, edge(via, { viaLinkKey: "no_such_link_ZZZ", coefficient: 0.9 }))).statusCode).toBe(400);
    const rows = (await t.repos.sim.listPropagationRules("demo", false)).filter((r) => r.key === "WRITE_PATH_PROBE");
    expect(rows.length).toBe(1);
    expect(rows[0]!.coefficient).toBe(0.5);
    expect(rows[0]!.version).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §5 用量项真的进了公式（WO-COEF-FROM-BOM 的**真种子**回归闸）
// ══════════════════════════════════════════════════════════════════════════════
/**
 * **这一节堵的是一个真实存在过的洞，不是补测试覆盖率。**
 *
 * 病灶（仓主 2026-08-28 亲手揪出，CLAUDE.md 铁律 1.5 的来历）：
 * `amount = coeff × sourceVal × factor` **没有用量项** ⇒ 贵重料与边角料各涨 15%
 * 给出**逐字节相同**的 `Model.costPressure`（实测同为 `15 × 0.65 = 9.75`）。
 * 修法 = 该边声明 `weightRef: { basis: "bom_cost_share" }`，按 BOM 成本占比逐对分摊。
 *
 * ⚠ **为什么非加这一节不可**：修是 2026-09-03 落的，而当时**没有任何东西守着这条边的种子声明**。
 * 2026-09-09 实测复核时把 `seed.ts` 那行改成 `weightRef: null`、重 build、跑服务 ——
 * **四个数当场退回 9.75/9.75（病完全复发），而 datacore 全套测试照样能绿**：
 * 引擎侧 `sim-propagation.test.ts` 那五条用的是**合成 FAN 图 + 手喂权重表**，
 * 它咬的是「引擎给了表会不会用」，**度量不到**「真种子有没有把表接上」。
 * 兄弟边 `demo_order_cost_to_customer_receivable` 早有这道闸
 * （`edge-money-weight.seam.test.ts` §4），本条边**一直漏着**。
 *
 * 形态（照铁律 0.6 句式）：
 * > 「我用『引擎分摊逻辑有测试且全绿』当作『这条边真的在按用量分摊』的证据，
 * >  而前者并不度量后者 —— 中间隔着"种子有没有声明口径"这一步，没有任何断言站在那里。」
 *
 * 判据落在**对照实验**（铁律 1.5 判据一）而不是「跑得起来」：
 * 同一个型号上换两种 BOM 占比不同的物料，读数**必须按占比拉开**；且拉开的倍数
 * 由回包自带的出处**独立复算**，不写死金值 —— 写死就成了"跑一遍把期望贴上去"。
 */
describe("§5 WO-COEF-FROM-BOM · 用量项真的进了公式（真种子）", () => {
  it("种子把 bom_cost_share 接上了（兄弟边 edge-money-weight §4 的同款闸，本条边此前漏着）", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/seed.ts", import.meta.url), "utf8");
    // 🐤 金丝雀：真读到种子了（读空文件时"没找到那行"是句空话）。
    expect(src.length, "seed.ts 读成空 ⇒ 读取坏了，不是『种子里没有』").toBeGreaterThan(10000);
    const at = src.indexOf('key: "demo_material_price_to_model_cost"');
    expect(at, "种子里找不到这条边").toBeGreaterThan(0);
    expect(
      src.slice(at, at + 2000),
      "这条边没声明按 BOM 成本占比分摊 ⇒ 贵重料与边角料又会拿到同一个数（9.75），" +
        "而引擎侧那几条合成图用例照样全绿 —— 那正是本节要堵的假绿",
    ).toContain('weightRef: { basis: "bom_cost_share" }');
  });

  it("🔴 对照实验：同一型号上，BOM 占比不同的两种物料各涨 15 ⇒ 读数必须按占比拉开（修前同为 9.75）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);

    const SHOCK = 15; // 涨价 15 个百分点
    // ── ⚠ 金值改（WO-SIM-DESAT-3 ②）：`COEFF` 从写死的 0.65 换成**规则表里那个真值** ──────
    // 本单把 `coefficient` 的口径改成「每拍入流」= 稳态增益 × λ，且这条边的稳态增益
    // 被增益预算从 0.65 缩到 0.423 ⇒ 字段值 `0.423 × 0.37 = 0.15651`。
    // 原写死的 0.65 当场对不上（实测 expected 0.076563460781 vs actual 0.018435303457，
    // 比值 **4.1531 = 0.65 / 0.15651**）。
    // **改成从规则表读，而不是贴一个新字面量**：贴字面量等于在断言里养第二份系数真相源，
    // 下次重标又漂；读规则表则「断言与实现各自独立算同一个式子」这条纪律仍然成立
    // （本用例判据②的原注释就是这么要求的：占比从回包出处独立复算，不写死金值）。
    // 覆盖面没缩：判据①（两读数必须不同）、判据③（权重被当成 1 的指纹不许出现）都原样保留，
    // 而判据③ 的指纹值现在跟着真系数走 ⇒ 它咬的仍是"权重被当成 1"这件事本身。
    const seededRules = await t.repos.sim.listPropagationRules("demo", true);
    const priceEdge = seededRules.find((r) => r.key === "demo_material_price_to_model_cost");
    expect(priceEdge, "规则表里找不到 demo_material_price_to_model_cost ⇒ 取数坏了").toBeDefined();
    const COEFF = priceEdge!.coefficient; // 该边的整条边强度（每拍入流口径；下面只用它复算，不改它）
    expect(COEFF, "该边系数为 0 ⇒ 下面每一句都会自洽成绿").toBeGreaterThan(0);

    /** 对某个物料施加 priceShock=SHOCK，跑一拍，回读该型号的 costPressure + 这一对的权重出处。 */
    const drive = async (materialId: string, modelId: string) => {
      const sid = (await (await t.app.inject({
        method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
        payload: { baseSnapshot: { [materialId]: { priceShock: SHOCK }, [modelId]: { costPressure: 0 } } },
      })).json()).id as string;
      const tick = await t.app.inject({
        method: "POST", url: `/a/v1/sim/sessions/${sid}/tick?explain=1`, headers: ADMIN, payload: { n: 1 },
      });
      expect(tick.statusCode).toBe(200);
      const body = tick.json() as {
        state: Record<string, Record<string, number>>;
        pairWeighting?: { report: { explain: { ruleKey: string; sourceObjectId: string; targetObjectId: string; weight: number; numerator: number; denominator: number; formula: string }[] } };
      };
      const ex = body.pairWeighting?.report.explain.find(
        (e) => e.ruleKey === "demo_material_price_to_model_cost" && e.sourceObjectId === materialId && e.targetObjectId === modelId,
      );
      return { read: body.state[modelId]?.costPressure ?? 0, ex };
    };

    // 沿**真链路表**挑一个「同一型号、两种物料」的三元组，并要求两者 BOM 占比确实不同。
    // 不写死 obj_material_* —— 种子换料时这条用例应当跟着走，而不是变成假绿。
    const links = await t.repos.links.list("demo", (l) => l.type === "material_used_by_model");
    expect(links.length, "真链路表里没有 material_used_by_model ⇒ 下面测了个寂寞").toBeGreaterThan(0);
    const byModel = new Map<string, string[]>();
    for (const l of links) (byModel.get(l.toId) ?? byModel.set(l.toId, []).get(l.toId)!).push(l.fromId);
    const modelId = [...byModel.keys()].sort().find((m) => (byModel.get(m) ?? []).length >= 2);
    expect(modelId, "没有任何型号同时用到 ≥2 种物料 ⇒ 这条边根本分不了摊").toBeDefined();

    // 逐物料驱动，取占比**最大**与**最小**的那两种（差距最大 ⇒ 病若复发最刺眼）。
    const mats = [...(byModel.get(modelId!) ?? [])].sort();
    const runs = [];
    for (const m of mats) runs.push({ materialId: m, ...(await drive(m, modelId!)) });
    const scored = runs.filter((r) => r.ex !== undefined).sort((a, b) => a.ex!.weight - b.ex!.weight);
    expect(scored.length, "一对权重出处都没拿到 ⇒ 可披露这条没落地，或该边没在分摊").toBeGreaterThanOrEqual(2);
    const lo = scored[0]!, hi = scored[scored.length - 1]!;

    // ── 判据 ①：两个读数**必须不同**。修前它们逐字节相同（同为 9.75），这一条就是病本身。
    expect(
      hi.read,
      `占比最大(${hi.ex!.weight})与最小(${lo.ex!.weight})的两种物料给出同一个读数 ⇒ ` +
        "用量项又从公式里掉了（修前形态复现：amount = coeff × sourceVal，与用多少无关）",
    ).not.toBe(lo.read);
    expect(hi.read).toBeGreaterThan(lo.read); // 占比大的那个必须更疼

    // ── 判据 ②：读数 = 强度 × 占比 × 源态，占比从回包出处**独立复算**（不写死金值）。
    for (const r of [lo, hi]) {
      const expected = Math.round(COEFF * r.ex!.weight * SHOCK * 1e12) / 1e12;
      expect(r.read, `${r.materialId} 的读数与「强度 × BOM 占比 × 涨幅」对不上`).toBe(expected);
      // 出处必须真的来自 BOM 用量，而不是某个凭空的份额。
      expect(r.ex!.formula).toContain("单台用量");
      expect(r.ex!.denominator).toBeGreaterThan(0);
    }

    // ── 判据 ③：「权重被当成 1」那个数**不许**再出现。
    // 它 = 该边系数 × 涨幅，历史上是 `0.65 × 15 = 9.75`（CLAUDE.md 铁律 1.5 的来历那个数）；
    // 系数换口径后它跟着变成 `0.15651 × 15 = 2.34765`。**变的是那个数，不是这条判据**：
    // 它咬的始终是「该对的权重被当成 1 了（"查不到用量"绝不等于"用量为 1"）」这件事。
    const preFix = Math.round(COEFF * SHOCK * 1e12) / 1e12;
    for (const r of runs) {
      expect(r.read, `读数回到 ${preFix} ⇒ 该对的权重被当成 1 了（"查不到用量"绝不等于"用量为 1"）`).not.toBe(preFix);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §6 WO-SIM-DESAT-3 · 去饱和三件的**联立**接缝（种子播种 → 推演结果）
//
// ── 为什么必须是一条**联立**的用例，而不是三条各测一半 ──────────────────────────
// 本单同时改了三处，而三处**互为乘数**，拆开测每一处都能各自绿：
//   ① `Line.blockedPressure` 登记进 `STATE_VAR_DOMAINS`（`synthetic/battery.ts`）
//      —— 不登记 ⇒ 引擎不夹不衰减 = 纯积分器。实测（修前）第 120 拍 **30,831 且每拍 +258，无上界**；
//         它下游那条 c=0.6 的边因此每拍往 `WorkOrder.releasePressure` 灌 18,499，
//         那一格**永久钉死 99.9**。⇒ **系数调多小都救不了一个无界积分器**，只做 ②③ 等于白做。
//   ② `coefficient` 口径 = 稳态增益 × λ（`seed.ts` 的 `inflowCoefficient`）
//      —— 引擎每拍做 `+=`，源恒定时稳态是 `source × c/λ`；不改 ⇒ 每格稳态是 description
//         承诺的 **1/λ ≈ 2.7 倍**。修前 23 个目标组里 **22 组 DC 增益 > 0.75**。
//   ③ 11 条 `weightRef:null` 且扇入 N>1 的边挂 Σ=1 等份口径（契约 + `sim/pair-weights.ts`）
//      —— `null` 不是「不分摊」，是**每源各加一份满额**。实测 43.3 个工单各出一整份
//         ⇒ 同一格上两条系数几乎相同的边（0.5 / 0.65）**入流差 51 倍**。
//      ⚠ 而 `W_e` 正是 ② 的预算分配里那个乘数 ⇒ **先标 ② 再做 ③，② 的分配当场作废**。
//
// ⇒ 判据落在**三者共同的产物**上：播完种的那个世界（= 用户屏上真看到的那个）里，
//    已声明量纲的格**一个都不许**反算出界。任一件缺席，这个数就会从 0 跳回几百上千。
//
// 🐤 **金丝雀内建**（同一支普查函数 · 同一个世界的两个快照，不另抄一份实现）：
//    同一把尺子量 `tick0` 的出厂哈希占位基线，必须量出**数百格**越界（实测 591）——
//    量不出来就是普查器坏了，那时末拍的"0 格"是句空话，不是"世界干净"。
//    ⚠ `tick0` 那批**不在本单范围**：它是 `round(hash01×100)` 占位基线（域表出处②），
//      前一张单已登记为「饱和在 tick0 就已存在，与扰动无关」。本单治的是**入流过量**，
//      入流推不动那些**一开始就在上面**的格 —— 它们靠衰减往下走。
// ══════════════════════════════════════════════════════════════════════════════
describe("§6 WO-SIM-DESAT-3 · 去饱和三件的联立接缝（种子 → 推演结果）", () => {
  /** `saturateToDomain` 的**逆**。下面用往返自证它真的是逆，不靠"看着像"。 */
  const BAND = 0.25;
  const unsaturate = (v: number, min: number, max: number, rest: number): number => {
    const bh = (max - rest) * BAND, kh = max - bh;
    if (bh > 0 && v > kh && v < max) return kh + bh * (bh / (max - v) - 1);
    const bl = (rest - min) * BAND, kl = min + bl;
    if (bl > 0 && v < kl && v > min) return kl - bl * (bl / (v - min) - 1);
    return v;
  };

  /** 一份世界态里「反算 raw 越上界」的格数 + 一个样例（主逻辑与金丝雀**共用这一支**）。 */
  const overDomain = (state: Record<string, Record<string, number>>): { declared: number; over: number; sample: string | null } => {
    let declared = 0, over = 0;
    let sample: string | null = null;
    for (const [oid, row] of Object.entries(state)) {
      for (const [sv, v] of Object.entries(row)) {
        const d = STATE_VAR_DOMAINS[sv];
        if (d === undefined || typeof v !== "number") continue;
        declared += 1;
        const raw = unsaturate(v, d.min, d.max, d.restPoint);
        if (raw > d.max) { over += 1; sample ??= `${oid}.${sv}=${v}(raw ${raw.toFixed(1)})`; }
      }
    }
    return { declared, over, sample };
  };

  it("🔴 联立接缝：播完种的世界 0 格反算越界；同一把尺子在 tick0 必须量出数百格（金丝雀）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    await seedDemoSimWorld(t.repos, t.services.sim, t.adminCtx);

    const session = await t.repos.sim.getSession("demo", DEMO_SIM_WORLD_SESSION_ID);
    expect(session, "种子世界会话不存在 ⇒ 播种没跑，下面全是空话").toBeTruthy();
    expect(session!.curTick, "播种拍数不是 DEMO_SIM_WORLD_TICKS ⇒ ④ 没落地").toBe(DEMO_SIM_WORLD_TICKS);
    const last = await t.repos.sim.getTickState("demo", DEMO_SIM_WORLD_SESSION_ID, DEMO_SIM_WORLD_TICKS);
    expect(last, `tick${DEMO_SIM_WORLD_TICKS} 行不在库里 ⇒ 取数坏了`).not.toBeNull();

    // 🐤 金丝雀①：往返自证 `unsaturate` 真的是 `saturateToDomain` 的逆 ——
    //   逆写错了，下面那个"0 格"就毫无意义（它会把越界的格算成没越界）。
    for (const raw of [10, 74.9, 80, 150, 400, 3600.301]) {
      const back = unsaturate(saturateToDomain(raw, 0, 100, 0), 0, 100, 0);
      expect(Math.abs(back - raw), `unsaturate 不是 saturateToDomain 的逆（raw=${raw}）⇒ 普查器坏了`).toBeLessThan(1e-6);
    }

    // 🐤 金丝雀②：同一支普查函数量 tick0，必须量出**数百格**越界（出厂哈希占位基线）。
    const atT0 = overDomain(session!.baseSnapshot as unknown as Record<string, Record<string, number>>);
    expect(atT0.declared, "tick0 一个已声明量纲的格都没数到 ⇒ 普查器坏了").toBeGreaterThan(1000);
    expect(
      atT0.over,
      "同一把尺子在 tick0 量出 0 格越界 ⇒ **普查器坏了**（出厂哈希占位基线本就有数百格越界），" +
        "此时下面那句『末拍 0 格』证明不了任何事",
    ).toBeGreaterThan(100);

    // ── 主判据：播完种的世界，已声明量纲的格 0 格反算越界 ────────────────────────
    // ⚠ **`getTickState` 回的是 `SimTickState` 包装体**（`{sessionId,tenantId,tick,state,pending,trace}`），
    // 不是裸的态映射 —— 必须取 `.state`。原文写的是 `overDomain(last as unknown as …)`，
    // 那个**双重 as 把类型系统这道唯一会说话的防线关掉了**：`overDomain` 于是把
    // `sessionId/tenantId/tick/state/pending/trace` 当成六个"对象 id"去遍历，
    // 一个已声明量纲的格都数不到 ⇒ `declared` 恒 0。
    // 实测：修前 `atEnd.declared = 0` vs `atT0.declared = 4937`（金丝雀②走的是
    // `session.baseSnapshot`，那**是**裸映射，所以它一直是对的 —— 一对一错正好骗过所有人）。
    // 形态（铁律 0.6 句式）：「我用『这一句 expect 是绿的/红的』当作『它在量末拍的世界』的证据，
    // 而前者并不度量后者 —— 它量的是包装体的六个字段名。」
    // **改后不比改前弱**：改前该行恒 0 ⇒ 后面「末拍 0 格越界」那句在空集上恒真，证明不了任何事；
    // 改后它第一次真的去量末拍的 4937 格。这是把"没测出来"换成"真测"，不是放宽。
    const atEnd = overDomain(last!.state as unknown as Record<string, Record<string, number>>);
    expect(atEnd.declared, "末拍一个已声明量纲的格都没数到 ⇒ 取数坏了").toBe(atT0.declared);
    expect(
      atEnd.over,
      `播完种的世界仍有 ${atEnd.over}/${atEnd.declared} 格反算越界（样例 ${atEnd.sample}）⇒ ` +
        "①②③ 至少缺一件：① 没登记 ⇒ blockedPressure 无界积分；② 没 ×λ ⇒ 每格稳态大 2.7 倍；" +
        "③ 没归一 ⇒ 扇入按条数把入流乘上去",
    ).toBe(0);

    // ── ① 单独点名：`blockedPressure` 在域表里，且世界里它真的被夹住了 ──────────────
    expect(
      STATE_VAR_DOMAINS.blockedPressure,
      "blockedPressure 不在 STATE_VAR_DOMAINS ⇒ 它又成了不夹不衰减的纯积分器（修前实测第 120 拍 30,831 且无上界）",
    ).toBeTruthy();
    // 同上：取 `.state`，不是包装体（原文同样被双重 as 关掉了类型检查 ⇒ 六个字段名上取
    // `row.blockedPressure` 全是 undefined，被 filter 掉 ⇒ `blocked.length` 恒 0，
    // 下一句 `toBeGreaterThan(0)` 本该当场红 —— 它红了，只是被上面那句先红盖住了）。
    const blocked = Object.values(last!.state as unknown as Record<string, Record<string, number>>)
      .map((row) => row.blockedPressure)
      .filter((v): v is number => typeof v === "number");
    expect(blocked.length, "世界里一格 blockedPressure 都没有 ⇒ 设备侧那条链没播上，下面那句是空话").toBeGreaterThan(0);
    expect(Math.max(...blocked), "blockedPressure 冲出量纲上界 ⇒ ① 没生效").toBeLessThanOrEqual(STATE_VAR_DOMAINS.blockedPressure!.max);

    // ── ③ 单独点名：那 11 条边的逐目标权重和必须是 1（Σ=1），不是扇入条数 ────────────
    const tick = await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${DEMO_SIM_WORLD_SESSION_ID}/tick?explain=1`, headers: ADMIN, payload: { n: 1 },
    });
    expect(tick.statusCode).toBe(200);
    const explain = (tick.json() as {
      pairWeighting?: { report: { explain: { ruleKey: string; targetObjectId: string; weight: number }[] } };
    }).pairWeighting?.report.explain ?? [];
    const EQUAL_SHARE_EDGE = "demo_wo_release_to_model_cost"; // 扇入最大的那条（实测 N≈43.33）
    const rows = explain.filter((e) => e.ruleKey === EQUAL_SHARE_EDGE);
    // 🐤 金丝雀③：这条边必须真有逐对出处 —— 一条都没有时「权重和=1」在空集上恒真。
    expect(rows.length, `${EQUAL_SHARE_EDGE} 一条逐对出处都没有 ⇒ ③ 没接上（weightRef 仍是 null），或可披露没落地`).toBeGreaterThan(10);
    const byTarget = new Map<string, number>();
    for (const e of rows) byTarget.set(e.targetObjectId, (byTarget.get(e.targetObjectId) ?? 0) + e.weight);
    for (const [targetId, sum] of byTarget) {
      expect(
        Math.abs(sum - 1),
        `${EQUAL_SHARE_EDGE} 落到 ${targetId} 的权重和是 ${sum}，不是 1 ⇒ 扇入没归一（每源各加一份满额，入流被乘上条数）`,
      ).toBeLessThan(1e-9);
    }

    // ── ② 单独点名：每条边的每拍入流系数都 = 稳态增益 × λ ────────────────────────
    // 判据不是"等于某个字面量"（那会把预算表抄进断言，成为第二份真相源），
    // 而是**口径自洽**：`coefficient / λ` 还原回稳态增益后必须 ≤ 1 ——
    // 超过 1 就意味着"源顶到量纲上界时，单这一条边就把目标顶出上界"，② 的口径即未落地。
    const publishedRules = await t.repos.sim.listPropagationRules("demo", true);
    expect(publishedRules.length, "规则表读成空 ⇒ 取数坏了").toBeGreaterThan(40);
    const hot = publishedRules
      .filter((r) => STATE_VAR_DOMAINS[r.targetStateVar] !== undefined)
      .map((r) => ({ key: r.key, gain: Math.abs(r.coefficient) / PRESSURE_DECAY_PER_TICK }))
      .filter((x) => x.gain > 1 + 1e-9);
    expect(
      hot.map((x) => `${x.key}(稳态增益 ${x.gain.toFixed(3)})`),
      "有边的**稳态增益 > 1** ⇒ 源顶到量纲上界时单这一条就把目标顶出去（② 的口径没落地）",
    ).toEqual([]);
  }, 180_000);
});
