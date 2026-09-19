import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
// §6 每格增益预算现算所需：装配走**生产同一处**（`buildPropagationInputs`），
// 权重键走引擎同一支（`pairWeightKey`），λ 走 C35 同一个记号 —— 三者都不许在测里另抄一份。
import { buildPropagationInputs } from "../src/sim/propagation-inputs.js";
import { pairWeightKey } from "../src/sim/propagation.js";
import { PRESSURE_DECAY_PER_TICK } from "../src/synthetic/battery.js";
import { resolveSimScope } from "@platform/contracts";

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
    expect(cfg.propagationCount).toBe(55); // 55 = canonical 51 − 1（WO-PROP-REVIEW-V2 ㉜ 方向反向：`demo_process_queue_to_equipment_load` 被 `demo_equipment_load_to_process_queue` **取代** —— 是换不是增）+ 5（反向替代边 1 · 库存环 `demo_fg_cover_days_to_model_demand` 1 · 物料环 3：替代料负反馈/检验放行/缺口催货）。canonical 的 51 = 47 + WO-SIM-DAMPING 阻尼边 1 + WO-SIM-REAL-DATA Order 真值边 3。⚠ Order 真值三条**两边各自落地过**（本分支 WO-SIM-ORDER-REAL-FIELDS / canonical WO-SIM-REAL-DATA），收编时已去重、留 canonical 那一份 —— 它带 `coefficient: 1` **不过 λ** 的修复，本分支那份没有。
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
    // WO-SIM-REAL-DATA 再补 6 个，**它们与上面 41 个不是同一类，别混着读**：
    //  · 源侧 `qty` / `unitPrice` / `leadDays` —— 这三个**本来就是 `Order` 上的真实业务属性**
    //    （套 / 元 / 天）。让它们直接当状态变量名，`deriveSeedBaseSnapshot` 的同名探测才撞得上
    //    ⇒ 那三格走**真读数档**而不是 `round(hash01(...)×100)`。这就是 `measuredCells` 从 0 变正的机制。
    //  · 目标侧 `backlogQtyTop` / `backlogPriceTop` / `backlogHorizonDays` —— 在手订单簿的三个极值。
    //  ⛔ 这 6 个**刻意不进 `STATE_VAR_DOMAINS`**（与天数族/件数族同一条纪律）：
    //    它们带真实单位，拍一个 0–100 的上界会把 21777 套夹成 100。未登记 ⇒ 引擎不夹不衰减，
    //    并在 tick 回执 `undeclaredStateVars` 里被逐个点名（缺口留在屏上，不留在注释里）。
    expect(cfg.stateVars).toEqual([
      "backlogHorizonDays", "backlogPriceTop", "backlogQtyTop",
      "blockedPressure", "changeoverPressure", "clearanceQueueDays", "collectionPressure", "costPressure",
      // WO-PROP-REVIEW-V2 库存环 +1 个量纲 `coverDays`（成品覆盖天数·天）——库存侧**第一个被读**
      // 的量纲（此前 FinishedGoodsInventory 只当 target）；带真实单位，与天数族同纪律不进 STATE_VAR_DOMAINS。
      "coverDays",
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
    expect(items.length).toBe(55); // 55 = canonical 51 − 1（WO-PROP-REVIEW-V2 ㉜ 方向反向：`demo_process_queue_to_equipment_load` 被 `demo_equipment_load_to_process_queue` **取代** —— 是换不是增）+ 5（反向替代边 1 · 库存环 `demo_fg_cover_days_to_model_demand` 1 · 物料环 3：替代料负反馈/检验放行/缺口催货）。canonical 的 51 = 47 + WO-SIM-DAMPING 阻尼边 1 + WO-SIM-REAL-DATA Order 真值边 3。⚠ Order 真值三条**两边各自落地过**（本分支 WO-SIM-ORDER-REAL-FIELDS / canonical WO-SIM-REAL-DATA），收编时已去重、留 canonical 那一份 —— 它带 `coefficient: 1` **不过 λ** 的修复，本分支那份没有。
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
      // WO-PROP-REVIEW-V2 物料环三条：替代料负反馈挂**已物化**的 `alt_for_material`（5 条·零新物化）；
      // 检验放行 / 缺口催货各挂**本单新声明+新物化**的影响向链 `inspection_for_material`（30 条）/
      // `balance_drives_po`（30 条）—— 没有这两条链，IncomingInspection 只有入边、MaterialBalance 的缺口算出来也到不了采购单。
      "alt_for_material", "balance_drives_po",
      "base_dispatches_transfer", "base_has_shipment", "base_maint_plan", "batch_replenishes_material", "customer_has_invoice",
      // WO-ADVERSARY-REACTION 的还手边挂 `customer_places_order`（`order_of_customer` 的影响向逆边）。
      // ⚠ 它**默认关闭但目录不过滤**（§3.3「关掉的边要可见地降级，不是从图上消失」），
      //   故这份清单里有它 —— 这份清单数的是**目录**，不是"默认世界会跑的边"。
      "customer_has_location", "customer_has_overdue_record", "customer_places_order",
      "defect_raises_exception",
      // WO-PROP-REVIEW-V2 ㉜ 反向：`equip_used_in` 由 1 条变 2 条（㊷ + 反向后的 ㉜）；
      // `process_uses_equipment` 相应从本清单退出（链路类型本身保留在结构层）。
      "equip_used_in", "equip_used_in", "equipment_has_maintenance_order",
      // WO-PROP-REVIEW-V2 库存环两条 FGI 出边**全部挂 `fg_of_model`**（已物化的既有链路 18 条·
      // 零新 linkType·零新物化）⇒ 本清单新增 2 项（目录 50→52 的构成，见上方计数注释）。
      "fg_of_model", "fg_of_model",
      "inspection_for_material",
      "line_belongs_to_base", "line_has_process", "line_runs_work_order", "line_runs_work_order", "material_has_alternative",
      "material_has_balance", "material_has_batch", "material_supplied_by_po", "material_used_by_model", "material_used_by_model",
      "model_changeover", "model_demanded_by_order", "model_demanded_by_order", "model_demanded_by_order", "model_has_cert",
      // WO-SIM-REAL-DATA 的三条 Order 真值边同样挂 `order_for_model`（⛔ 不新造链路 ——
      // 它是本仓已物化且被方向可达门当金丝雀用的那条边），故这里从 2 条变 5 条。
      "model_producible_at", "model_stocked_as_finished_goods",
      "order_for_model", "order_for_model", "order_for_model", "order_for_model", "order_for_model",
      "order_has_line",
      "order_has_line", "order_has_promise", "order_of_customer", "po_customs_cleared_by", "po_from_supplier",
      "po_inspected_by", "po_replenishes_material", "process_belongs_to_line", "supplier_supplies_material",
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
    expect(rules.length).toBe(55); // 55 = canonical 51 − 1（WO-PROP-REVIEW-V2 ㉜ 方向反向：`demo_process_queue_to_equipment_load` 被 `demo_equipment_load_to_process_queue` **取代** —— 是换不是增）+ 5（反向替代边 1 · 库存环 `demo_fg_cover_days_to_model_demand` 1 · 物料环 3：替代料负反馈/检验放行/缺口催货）。canonical 的 51 = 47 + WO-SIM-DAMPING 阻尼边 1 + WO-SIM-REAL-DATA Order 真值边 3。⚠ Order 真值三条**两边各自落地过**（本分支 WO-SIM-ORDER-REAL-FIELDS / canonical WO-SIM-REAL-DATA），收编时已去重、留 canonical 那一份 —— 它带 `coefficient: 1` **不过 λ** 的修复，本分支那份没有。
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
    expect(items.length).toBe(55); // 55 = canonical 51 − 1（WO-PROP-REVIEW-V2 ㉜ 方向反向：`demo_process_queue_to_equipment_load` 被 `demo_equipment_load_to_process_queue` **取代** —— 是换不是增）+ 5（反向替代边 1 · 库存环 `demo_fg_cover_days_to_model_demand` 1 · 物料环 3：替代料负反馈/检验放行/缺口催货）。canonical 的 51 = 47 + WO-SIM-DAMPING 阻尼边 1 + WO-SIM-REAL-DATA Order 真值边 3。⚠ Order 真值三条**两边各自落地过**（本分支 WO-SIM-ORDER-REAL-FIELDS / canonical WO-SIM-REAL-DATA），收编时已去重、留 canonical 那一份 —— 它带 `coefficient: 1` **不过 λ** 的修复，本分支那份没有。
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
      pairWeighting?: { report: { explain: { ruleKey: string; sourceObjectId: string; targetObjectId: string; weight: number; numerator: number; denominator: number }[] } };
    };
    // ── 金值改动说明（WO-COEF-FROM-BOM）──────────────────────────────────────
    // 修前：`Order.demandPressure 10 × coeff 0.8 = 8`，**与这张单多大无关** —— 那正是病。
    // 修后：再乘该单的**订单量相对倍率**（`Order.qty ÷ 该型号在手单 qty 均值`，均值=1·保总量）。
    // 这里**不写死新数字**（那就是"跑一遍把期望值贴上去"），而是**从回包自带的出处**里
    // 取出这一对的分子/分母，当场把 `0.8 × qty/均值 × 10` 算出来比对 ——
    // 断言与实现各自独立地算一遍同一个式子，两边对上才算数。
    const explain = body.pairWeighting?.report.explain.find(
      (e) => e.ruleKey === "demo_order_demand_pressure" && e.sourceObjectId === orderId && e.targetObjectId === modelId,
    );
    expect(explain, "回包里没有这一对的权重出处 ⇒ 可披露这条没落地（仓主硬要求①）").toBeDefined();
    expect(explain!.denominator, "分母（该型号在手单 qty 均值）为 0 ⇒ 出处算错了").toBeGreaterThan(0);
    // ⚠ **系数同样不许写死**（WO-SIM-CALIBRATION）：原文写死 `0.8`，而标定后该边的每拍入流系数是
    //   `稳态增益 × λ`。写死就等于把断言钉在某一次标定上 —— 改标定即红，而红的不是行为、是这个字面量。
    //   判据与上面那句同源：**断言与实现各自独立地算一遍同一个式子**，系数就该从规则表这个唯一真源取。
    const ruleList = (await t.app.inject({ method: "GET", url: "/a/v1/sim/propagation-rules", headers: ADMIN })).json() as {
      items: { key: string; coefficient: number }[];
    };
    const coeff = ruleList.items.find((r) => r.key === "demo_order_demand_pressure")?.coefficient;
    expect(coeff, "取不到该边系数 ⇒ 下面那句会拿 undefined 去算，NaN 比对必红但红错地方").toBeDefined();
    expect(coeff, "该边系数为 0 ⇒ 期望值恒 0，下面那句会自洽成绿").toBeGreaterThan(0);
    const expected = Math.round(coeff! * (explain!.numerator / explain!.denominator) * 10 * 1e12) / 1e12;
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
    // ── WO-SIM-CALIBRATION：三跳的期望值**不再写死** ─────────────────────────────────
    // 原文写死 `9 / 6.3 / 5.04`，那是「系数 = 稳态增益」且「每源各加一份满额」时代的数。
    // 标定后每拍入流系数是 `稳态增益 × λ`，且 11 条边按 `equal_share` 归一（Σw=1）⇒ 三个数全变。
    // **但变的是标定，不是这条链通不通** —— 本用例的职责是后者，所以期望值改为
    // 从**规则表（系数唯一真源）× 回包自带的权重出处**现算，逐跳比对。
    // ⚠ 每个派生期望都配一条反空绿守卫：取数坏了会让期望变成 0，而 `toBe(0)` 会自洽成绿。
    const rl = (await t.app.inject({ method: "GET", url: "/a/v1/sim/propagation-rules", headers: ADMIN })).json() as {
      items: { key: string; coefficient: number }[];
    };
    const cOf = (k: string) => {
      const c = rl.items.find((r) => r.key === k)?.coefficient;
      expect(c, `取不到边 ${k} 的系数 ⇒ 下面的期望值算不出来`).toBeDefined();
      expect(c, `边 ${k} 系数为 0 ⇒ 期望值恒 0，下面那句会自洽成绿`).toBeGreaterThan(0);
      return c!;
    };
    type Explain = { ruleKey: string; sourceObjectId: string; targetObjectId: string; weight: number };
    // 有 `weightRef` 的边：权重从回包的出处取；`weightRef: null` 的边：每源各加一份满额 ⇒ 1。
    const wOf = (body: unknown, ruleKey: string, src: string, dst: string) =>
      ((body as { pairWeighting?: { report: { explain: Explain[] } } }).pairWeighting?.report.explain ?? [])
        .find((e) => e.ruleKey === ruleKey && e.sourceObjectId === src && e.targetObjectId === dst)?.weight ?? 1;
    const r12 = (x: number) => Math.round(x * 1e12) / 1e12;
    const tickOnce = async () => (await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick?explain=1`, headers: ADMIN, payload: { n: 1 } })).json();

    // tick1：Supplier(10) × 系数 × 权重 → Material.shortageRisk。Order 还没轮到（一 tick 一跳）。
    const b1 = await tickOnce();
    const t1 = st(b1);
    const exp1 = r12(10 * cOf("demo_supplier_delay_to_material_shortage") * wOf(b1, "demo_supplier_delay_to_material_shortage", supplierId, materialId));
    expect(exp1, "第 1 跳期望值算成 0 ⇒ 系数或权重取数坏了").toBeGreaterThan(0);
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
    const b2 = await tickOnce();
    const t2 = st(b2);
    // ⚠ 源读数取**上一拍实测值**而不是再写一个字面量：本跳验的是「这一跳的算术」，
    //   上一跳对不对已由上面那句负责 —— 两件事分开咬，红了才知道红在哪一跳。
    const exp2 = r12(t1[materialId]!.shortageRisk! * cOf("demo_material_shortage_to_model_supply_risk") * wOf(b2, "demo_material_shortage_to_model_supply_risk", materialId, modelId));
    expect(exp2, "第 2 跳期望值算成 0 ⇒ 取数坏了").toBeGreaterThan(0);
    expect(t2[modelId]!.supplyRisk).toBe(exp2);
    expect(t2[orderId]?.shortageRisk ?? 0).toBe(0);
    // tick3：Model × 系数 → Order.shortageRisk。
    // 🔴 这一行就是本单的效果层判据：供应侧的一次扰动，真的落到了订单缺口上。
    const b3 = await tickOnce();
    const t3 = st(b3);
    const exp3 = r12(t2[modelId]!.supplyRisk! * cOf("demo_model_supply_risk_to_order_shortage") * wOf(b3, "demo_model_supply_risk_to_order_shortage", modelId, orderId));
    expect(exp3, "第 3 跳期望值算成 0 ⇒ 取数坏了").toBeGreaterThan(0);
    expect(t3[orderId]!.shortageRisk).toBe(exp3);
    // 🔴 并且**必须真的传到了**（不是三跳都算出 0 然后逐句自洽成绿）——
    //    这条链通不通才是本用例的职责，标定怎么改都不该让它变成 0。
    expect(t3[orderId]!.shortageRisk, "扰动跨 3 跳后落到订单上的读数为 0 ⇒ 这条链断了").toBeGreaterThan(0);

    // 并且 trace 里能读到这三跳的原文（North Star「断点」维要的溯源承载物）。
    const trace = (await t.repos.sim.getTickState("demo", sid, 3))!.trace!;
    expect(trace.some((x) => x.ruleKey === "demo_model_supply_risk_to_order_shortage" && x.toObjectId === orderId && x.viaLinkKey === "model_demanded_by_order")).toBe(true);
  });

  // 每条边真触发（REQ143 的验收面 + 档 1 扩面）：一次扰动若干源头，逐组核 trace。
  it("🔴 逐条真触发：54 条规则在真 tick 的 trace 里一条不缺（REQ143 + 档 1/2/3 + 采购根源 3 + 三根源 4 + 设备侧出口 4 + 订单真实字段 3 + 库存环 2 + 物料环 3）", async () => {
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
    // WO-PROP-REVIEW-V2 库存环：`coverDays` 是**入度 0 的根**（没有任何规则写它），
    // 与 forecastBias/orderChurn 同性质 ⇒ 必须自带源，指望被带动是自相矛盾的。
    // 落点取 `fg_of_model` 的 from 端（一行真成品库存）；`drawdownPressure` 同格带上，
    // 让回补边也在第 1 拍就触发、不依赖「需求负载 → 提货压力」那两拍链先走通。
    const fgRowId = head("fg_of_model");
    // WO-PROP-REVIEW-V2 ㉜ 反向：`loadPressure` 升格**根源**（入度 0 —— 原来唯一写它的
    // ㉜ 已掉头改成由它出发）⇒ 两条出边都要自带源，且**一台设备喂不饱两条边**：
    // 实测（/tmp/t5-probe4.txt）`head("equip_used_in")` 那台
    // （obj_equipment_LINE-WS-changzhou-slurry-coating-E1）**没有**
    // `equipment_has_maintenance_order` 链 ⇒ 单格方案维修积压边 0 次、总触发 53；
    // 加第二格（`head("equipment_has_maintenance_order")` 那台，
    // obj_equipment_LINE-WS-changzhou-coating-coating-E1，与第一台不同线）后
    // 两条边 18/8 次、总触发 54 = 54 整。
    const maintEquipId = head("equipment_has_maintenance_order");

    const sid = (await (await t.app.inject({
      method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
      payload: { baseSnapshot: {
        // WO-SIM-REAL-DATA 三条 Order 真值边（qty/unitPrice/leadDays）与「根源」组同一条纪律：
        // 它们**入度 0**（没有任何规则写 `Order.qty`），不自带源就永远进不了 trace。
        // ⛔ 这里给的是**世界态的格子**，不是对象属性 —— 真实播种路上这三格由
        //    `deriveSeedBaseSnapshot` 的同名探测从 `Order.props` 直取（那条链由
        //    `sim-order-real-fields.seam.test.ts` 专门咬），本用例只负责证明「边会触发」。
        [orderId]: { demandPressure: 10, costPressure: 8, orderChurn: 10, qty: 1200, unitPrice: 18000, leadDays: 45 },
        [baseId]: { loadIndex: 20 },
        [supplierId]: { deliveryDelay: 10, procurementDelay: 7 },
        [procurePoId]: { procurementDelay: 7 },
        [procureBatchId]: { procurementDelay: 7 },
        [customsSupplierId]: { deliveryDelay: 10 }, // 进口料的主供 —— 清关段唯一的活源
        [materialId]: { priceShock: 5 },
        [rootModelId]: { forecastBias: 10 },
        // ㉜ 反向后 equipmentFailure 与 loadPressure 都是**根源**，同格自带（见上方 maintEquipId 注释）；
        // 这一格喂两条同链边：故障边（equipmentFailure→Process.queuePressure）与
        // ㉜ 反向边（loadPressure→Process.queuePressure），都经 equip_used_in。
        [rootEquipId]: { equipmentFailure: 10, loadPressure: 10 },
        // 第二格专门喂维修积压边（→MaintenanceOrder.repairBacklogPressure 经
        // equipment_has_maintenance_order）——rootEquipId 没有那条链，实测单格 0 次。
        [maintEquipId]: { loadPressure: 10 },
        // 库存环的活源（见上方 fgRowId 注释）：coverDays 20 天 = 真种子实测均值量级
        // （/tmp/t3-precheck.txt：1.93–42.34 天，均值 19.78）；drawdownPressure 10 同理给真量级。
        [fgRowId]: { coverDays: 20, drawdownPressure: 10 },
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
      // WO-PROCESS-TICK-COVERAGE 档 2：挂在新补的**影响向逆边**上的 13 条（原 15 条 ——
      // WO-PROP-REVIEW-V2 ㉜ 反向后，`demo_equipment_load_to_process_queue` 与
      // `demo_equipment_load_to_repair_backlog` 的共享源 `loadPressure` 升格根源、
      // 不再有上游链可带，移去下方「设备负荷根源」组自带源）。
      // 同样不额外造源 —— 全部由上面那四个源头（订单需求 / 基地负载 / 供应商延迟 / 物料涨价）
      // 沿真链传下来。哪一条没被带到，报错就直接指到它，不用再猜。
      扩面档2: [
        "demo_line_util_to_wo_release", "demo_wo_release_to_wip_feed", "demo_wo_release_to_quality_backlog",
        "demo_wip_feed_to_defect_pressure", "demo_defect_to_exception_backlog",
        "demo_order_demand_to_line_split", "demo_order_shortage_to_promise_risk",
        "demo_customer_receivable_to_location_hold", "demo_customer_receivable_to_collection",
        "demo_material_shortage_to_alt_switch", "demo_material_shortage_to_balance_gap",
        "demo_base_load_to_transfer_pressure",
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
      // WO-PROP-REVIEW-V2 ㉜ 反向：`loadPressure` 升格**根源**（入度 0 —— 原来唯一写它的
      // ㉜ 已掉头）⇒ 本组与「根源」档同性质，**必须自带源**（baseSnapshot 里
      // rootEquipId / maintEquipId 两格；一台设备喂不饱两条边，实测 /tmp/t5-probe4.txt：
      // 单格维修积压 0 次 / 总数 53，两格 18/8 次 / 总数 54）。
      设备负荷根源: [
        "demo_equipment_load_to_process_queue", "demo_equipment_load_to_repair_backlog",
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
      // 🔴 它们**必须出现在这里**（收编 canonical WO-SIM-REAL-DATA 时并入的理由，比原注更强）：
      //    这三条是全表唯一「读数能对上某一张真单」的通路 —— 一旦恒不触发，
      //    屏上那句「该型号在手订单最大的一张是多少套」就是纯哈希编的数，
      //    而**不会有任何东西变红**（它们刻意不进 `STATE_VAR_DOMAINS`，不夹不衰减）。
      订单真实字段: [
        "demo_order_qty_to_model_top_qty",
        "demo_order_price_to_model_top_price",
        "demo_order_leaddays_to_model_horizon",
      ],
      // WO-PROP-REVIEW-V2 库存环：FGI 的出边。coverDays 与「根源」档同性质
      // （入度 0、必须自带源，见上面 baseSnapshot 里 fgRowId 那一格），第 1 拍就进 trace。
      库存环: [
        "demo_fg_cover_days_to_model_demand",
      ],
      // ── WO-SIM-DAMPING **阻尼边**（canonical 交付；WO-PROP-V2-REBASE 收编时裁决保留）──
      // 🔴 裁决记账（⛔ 不许取并集，取并集会留下**同一条槽位上符号相反的两份**）：
      //   本分支曾另建 `demo_fg_drawdown_to_model_demand`（**+0.5**），与本条
      //   `demo_fg_drawdown_relieves_model_demand`（意图增益 **−0.6**；⚠ 2026-09-19 仓主裁决后
      //   其 `C36` 值为 **−0.222 = −0.6 × λ**，预乘了 λ —— 镜像的是意图增益不是入流系数）**源类型/源量纲/链路/目标全同**
      //   （`FinishedGoodsInventory.drawdownPressure --fg_of_model--> Model.demandLoad`）
      //   ⇒ 同一条物理边的两个相反符号，二者只能留一。**留 canonical 这条负的**，两条理由：
      //   ① 它已在集成线上交付（WO-SIM-DAMPING），删它是回退；
      //   ② 分支那条 +0.5 的自证写着「环增益 = 0.6(入) × 0.5(出) = 0.3 < 1 ⇒ 阻尼振荡收敛」——
      //      **对正环不成立**：入边 `demo_model_demand_to_fg_drawdown` 是 +0.6，回边再取正
      //      就是**正反馈**，闭环增益 1/(1−0.3) = 1.43 倍放大，不是阻尼。
      //      它自己想要的那个「阻尼」，恰恰只有负号那条给得出。
      //   「库存吸收需求」这层语义没丢：由同组 `demo_fg_cover_days_to_model_demand`（−0.5）承担，
      //   源量纲是 coverDays、与本条不同槽位，两条并存不冲突。
      // 本组不额外造源 —— 源恰是「扩面档 2」里 `demo_model_demand_to_fg_drawdown` 的目标；
      // 留 1 拍，故最早在第 3 拍进 trace。
      // 🔴 它**必须出现在这里**：一条阻尼边若恒不触发，屏上看不出任何区别 ——
      //    「图里有一条负边」不度量「压力真的会回来」，正是本仓反复栽的那个形态。
      阻尼: ["demo_fg_drawdown_relieves_model_demand"],
      // WO-PROP-REVIEW-V2 物料环：替代料负反馈 + 检验放行 + 缺口催货三条。
      // 本组**不额外造源**——三个源量纲都**不是入度 0 的根**：switchPressure 由
      // `demo_material_shortage_to_alt_switch`（扩面档2）写入、queueDays 由
      // `demo_po_expedite_to_inspection_queue`（交付）写入、gapPressure 由
      // `demo_material_shortage_to_balance_gap`（扩面档2）写入，全部从供应商延迟源头沿既有链带到。
      // 实测（/tmp/t4-probe3.txt）：被扰供应商短掉 三元正极/磷酸铁锂正极/电解液，
      // 三者都有平衡行且各带 4 条 balance_drives_po、前两者带替代料 ⇒
      // 三条新边在 9 拍内各触发 12/60/72 次，总触发 54 = 51 + 3 一条不缺。
      物料环: [
        "demo_alt_switch_to_material_shortage",
        "demo_inspection_queue_to_material_shortage",
        "demo_balance_gap_to_po_expedite",
      ],
    };
    const missing = Object.entries(DIRS).flatMap(([dir, keys]) => keys.filter((k) => !fired.has(k)).map((k) => `${dir}/${k}`));
    expect(missing).toEqual([]);
    // ── 完整性：十七组 54 条 = **默认世界里会跑的**全部规则（没有哪条游离在分组之外）──
    // （组数是 prose、无机器守卫，以本对象实际键数为准：业务 6 + 扩面 3 档 + 采购根源/根源/
    //  设备负荷根源 3 + 设备侧出口/订单真实字段/库存环/阻尼/物料环 5 = 17。
    //  T4 旧注「十四组」当时实已 15 组、后又写成「十六组」——**这行字一路都在漂**，
    //  正因为它没有机器守；机器守的是下面 physicalKeys 那条逐字节比对，不是这行字。
    //  WO-PROP-V2-REBASE：库存环 2→1 条（FGI 同槽位符号冲突裁决），新增「阻尼」组 1 条，总数不变。）
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
 * 上面那道「方向可达门」守的是**种子**：种进去的 55 条边方向对不对。
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
    // ⚠ **系数从规则表现取，不写死**（WO-SIM-CALIBRATION）：原文写死 `0.65`，
    //   而标定后该边的每拍入流系数是 `稳态增益 0.423913 × λ = 0.15684781`。
    //   写死就把本用例钉在某一次标定上 —— 而它要守的是「**按 BOM 占比拉开**」这件事，
    //   那是**比值**性质，与系数取多少无关（同格统一缩放，比值逐位不变：实测仍是 19.3658×）。
    const COEFF = ((await t.app.inject({ method: "GET", url: "/a/v1/sim/propagation-rules", headers: ADMIN })).json() as {
      items: { key: string; coefficient: number }[];
    }).items.find((r) => r.key === "demo_material_price_to_model_cost")?.coefficient;
    expect(COEFF, "取不到 demo_material_price_to_model_cost 的系数").toBeDefined();
    expect(COEFF, "该边系数为 0 ⇒ 下面每一句期望值都成 0、逐句自洽成绿").toBeGreaterThan(0);

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
      const expected = Math.round(COEFF! * r.ex!.weight * SHOCK * 1e12) / 1e12;
      expect(r.read, `${r.materialId} 的读数与「强度 × BOM 占比 × 涨幅」对不上`).toBe(expected);
      // 出处必须真的来自 BOM 用量，而不是某个凭空的份额。
      expect(r.ex!.formula).toContain("单台用量");
      expect(r.ex!.denominator).toBeGreaterThan(0);
    }

    // ── 判据 ③：修前那个数**不许**再出现。9.75 = 0.65 × 15，是"没有用量项"的指纹。
    const preFix = Math.round(COEFF! * SHOCK * 1e12) / 1e12;
    for (const r of runs) {
      expect(r.read, `读数回到 ${preFix} ⇒ 该对的权重被当成 1 了（"查不到用量"绝不等于"用量为 1"）`).not.toBe(preFix);
    }
  });

  // ────────────────────────────────────────────────────────────────────────────
  // §5b 同一批边上的**第二条**：缺料 → 型号供应风险（WO-WEIGHT-BASIS-FILL）
  // ────────────────────────────────────────────────────────────────────────────
  /**
   * **这一节堵的是「兄弟边漏网」这个形态，不是补覆盖率。**
   *
   * `demo_material_shortage_to_model_supply_risk` 与上面那条 `demo_material_price_to_model_cost`
   * **源类型 / 目标类型 / 链路 key 完全相同**（实测拓扑逐项相同：42 边 / 6 目标 / 扇入 7），
   * 而它到 2026-09-18 之前一直挂着 `equal_share`，注释还写着
   * 「本边无可审计的差异化计量值 ⇒ 等份」——**这句话被它自己的邻居证伪**：
   * 同一批边上，BOM 成本占比从 2026-09-03 起就一直取得到。
   *
   * 修前实测（真后端 seed 42 ·`2170 三元圆柱`· 各料 shortageRisk +15）：
   * 七种物料权重**全为 1/7**，`supplyRisk` **逐字节同为 0.346875** ——
   * 占 BOM 大头的三元正极与边角料铝箔**完全同权**。与 `9.75/9.75` 是同一个病的同一个指纹。
   * 修后：七个读数全不同，三元正极/铝箔 = **38.01×**、隔膜/铝箔 = **73.69×**。
   *
   * 形态（照铁律 0.6 句式）：
   * > 「我用『这条边声明了一个在册口径』当作『它按用量分摊了』的证据，而前者并不度量后者
   * >  —— `equal_share` 也是在册口径，它恰恰是"不按用量"的那一个。」
   *
   * ⚠ 本节额外咬一条上面那节**没有**的判据：**Σ权重 ≡ 1 且世界总量不跳**。
   * 它区分的是「按用量分摊」与「把量纲从加权平均改成随条数膨胀」——
   * 后者同样能让四个数"拉开"，却是契约明令禁止的改量纲（`IN_EDGES` vs `IN_EDGES_MEAN`）。
   * 只断言"拉开了"会把这两者一起放行。
   */
  it("种子把 bom_cost_share 接到**缺料→供应风险**这条边上了（此前挂 equal_share·注释被邻居证伪）", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/seed.ts", import.meta.url), "utf8");
    // 🐤 金丝雀：真读到种子了（读空文件时"没找到那行"是句空话）。
    expect(src.length, "seed.ts 读成空 ⇒ 读取坏了，不是『种子里没有』").toBeGreaterThan(10000);
    const at = src.indexOf('key: "demo_material_shortage_to_model_supply_risk"');
    expect(at, "种子里找不到这条边").toBeGreaterThan(0);

    // ⚠ **必须剥注释后再断言，且要咬"赋值行"而不是"这段文字里出现过那个串"。**
    // 这一条是**变异反证当场逼出来的**，不是设计时想到的：本条边的注释里
    // 正文引用了 `weightRef: { basis: "bom_cost_share" }` 这个字面量（用来解释邻居边），
    // 于是把种子改回 `equal_share` 之后 `toContain` **照样绿** —— 门成了装饰品。
    // 形态（照铁律 0.6 句式）：
    // > 「我用『这段源码里出现过这个串』当作『这个赋值存在』的证据，而前者并不度量后者
    // >  —— 注释里引用一个赋值，和那个赋值真的存在，是两个命题。」
    // 同源前车：本仓 `weightRef` 计数也栽在这里（3 行注释被数成赋值，51 vs 48）。
    const block = src.slice(at, at + 2500);
    const codeOnly = block.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    // 🐤 金丝雀：剥注释别把整块剥没了（剥空时"没找到那行"同样是句空话）。
    expect(codeOnly, "剥注释后连 key 行都没了 ⇒ 剥注释坏了，不是『种子里没有』").toContain(
      'key: "demo_material_shortage_to_model_supply_risk"',
    );
    // 🐤 金丝雀（反向）：证明本块的注释里**确实**有那个字面量 —— 即上面那层剥离不是多余的。
    expect(
      block.split("\n").filter((l) => /^\s*\/\//.test(l) && l.includes("bom_cost_share")).length,
      "本块注释里已不含该字面量 ⇒ 上面的剥注释失去意义，可简化；但**先确认**再简化",
    ).toBeGreaterThan(0);

    const assign = codeOnly.split("\n").find((l) => /^\s*weightRef:/.test(l))?.trim();
    expect(
      assign,
      "这条边退回了不带用量的口径 ⇒ 七种物料又会同权（修前实测 supplyRisk 逐字节同为 0.346875）",
    ).toBe('weightRef: { basis: "bom_cost_share" },');
  });

  it("🔴 对照实验：缺料→供应风险 —— BOM 占比不同的物料各涨 15 ⇒ 读数按占比拉开，且 Σ权重≡1 总量不跳", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);

    const RULE = "demo_material_shortage_to_model_supply_risk";
    const SHOCK = 15;
    // 系数从规则表现取，不写死（同上节理由：本用例守的是**比值**，与标定无关）。
    const COEFF = ((await t.app.inject({ method: "GET", url: "/a/v1/sim/propagation-rules", headers: ADMIN })).json() as {
      items: { key: string; coefficient: number }[];
    }).items.find((r) => r.key === RULE)?.coefficient;
    expect(COEFF, `取不到 ${RULE} 的系数`).toBeDefined();
    expect(COEFF, "该边系数为 0 ⇒ 下面每一句期望值都成 0、逐句自洽成绿").toBeGreaterThan(0);

    const drive = async (materialId: string, modelId: string) => {
      const sid = (await (await t.app.inject({
        method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
        payload: { baseSnapshot: { [materialId]: { shortageRisk: SHOCK }, [modelId]: { supplyRisk: 0 } } },
      })).json()).id as string;
      const tick = await t.app.inject({
        method: "POST", url: `/a/v1/sim/sessions/${sid}/tick?explain=1`, headers: ADMIN, payload: { n: 1 },
      });
      expect(tick.statusCode).toBe(200);
      const body = tick.json() as {
        state: Record<string, Record<string, number>>;
        pairWeighting?: { report: {
          explain: { ruleKey: string; sourceObjectId: string; targetObjectId: string; weight: number; denominator: number; formula: string }[];
          unresolved: { ruleKey: string; reason: string }[];
        } };
      };
      // 口径算不出来时引擎会**诚实报缺**并让本条流不传导 —— 那会让下面每个读数都成 0、逐句自洽成绿。
      const bad = (body.pairWeighting?.report.unresolved ?? []).filter((u) => u.ruleKey === RULE);
      expect(bad, `本规则被判"算不出权重"：${bad[0]?.reason ?? ""}`).toHaveLength(0);
      const ex = body.pairWeighting?.report.explain.find(
        (e) => e.ruleKey === RULE && e.sourceObjectId === materialId && e.targetObjectId === modelId,
      );
      return { read: body.state[modelId]?.supplyRisk ?? 0, ex };
    };

    // 沿**真链路表**挑型号，不写死 obj_material_*（种子换料时本用例应当跟着走，而不是变成假绿）。
    const links = await t.repos.links.list("demo", (l) => l.type === "material_used_by_model");
    expect(links.length, "真链路表里没有 material_used_by_model ⇒ 这条边根本不触发").toBeGreaterThan(0);
    const byModel = new Map<string, string[]>();
    for (const l of links) (byModel.get(l.toId) ?? byModel.set(l.toId, []).get(l.toId)!).push(l.fromId);
    const modelId = [...byModel.keys()].sort().find((m) => (byModel.get(m) ?? []).length >= 2);
    expect(modelId, "没有任何型号同时用到 ≥2 种物料 ⇒ 这条边根本分不了摊").toBeDefined();

    const runs = [];
    for (const m of [...(byModel.get(modelId!) ?? [])].sort()) runs.push({ materialId: m, ...(await drive(m, modelId!)) });
    const scored = runs.filter((r) => r.ex !== undefined).sort((a, b) => a.ex!.weight - b.ex!.weight);
    expect(scored.length, "一对权重出处都没拿到 ⇒ 该边没在分摊").toBeGreaterThanOrEqual(2);
    const lo = scored[0]!, hi = scored[scored.length - 1]!;

    // ── 判据 ①：占比最大与最小的两种物料**读数必须不同**（修前逐字节相同，这就是病本身）。
    expect(
      hi.read,
      `占比最大(${hi.ex!.weight})与最小(${lo.ex!.weight})的两种物料给出同一个读数 ⇒ ` +
        "又退回等份（修前形态复现：七种料各 1/7，贵重料与边角料同权)",
    ).not.toBe(lo.read);
    expect(hi.read).toBeGreaterThan(lo.read);

    // ── 判据 ②：读数 = 系数 × BOM 占比 × 源态，占比从回包出处**独立复算**（不写死金值）。
    for (const r of [lo, hi]) {
      const expected = Math.round(COEFF! * r.ex!.weight * SHOCK * 1e12) / 1e12;
      expect(r.read, `${r.materialId} 的读数与「系数 × BOM 占比 × 缺料幅度」对不上`).toBe(expected);
      expect(r.ex!.formula, "出处不是来自 BOM 用量 ⇒ 份额是凭空来的").toContain("单台用量");
      expect(r.ex!.denominator, "分母 ≤ 0 ⇒ 占比无意义").toBeGreaterThan(0);
    }

    // ── 判据 ③：等份那个数**不许**再出现。1/N 是"不带用量"的指纹（修前实测 0.346875）。
    const equalShare = Math.round((COEFF! * SHOCK / scored.length) * 1e12) / 1e12;
    for (const r of runs) {
      expect(r.read, `读数回到等份值 ${equalShare} ⇒ 该对的权重又被当成 1/N 了`).not.toBe(equalShare);
    }

    // ── 判据 ④：Σ权重 ≡ 1 且**世界总量不跳**（这一条上一节没有，见本节头注）。
    //   它拦的是「用 IN_EDGES_MEAN 之类把量纲改掉」——那也会让读数"拉开"，却是契约明令禁止的改量纲。
    const sumW = scored.reduce((s, r) => s + r.ex!.weight, 0);
    expect(sumW, `Σ权重 = ${sumW} ≠ 1 ⇒ 归一方向被改掉了（强度型目标必须 IN_EDGES·Σ=1）`).toBeCloseTo(1, 9);
    const sumRead = runs.reduce((s, r) => s + r.read, 0);
    expect(
      sumRead,
      `逐料驱动的读数合计 ${sumRead} ≠ 系数 × ${SHOCK} ⇒ 换口径把世界总量改了（应当只是重新分配）`,
    ).toBeCloseTo(COEFF! * SHOCK, 9);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════
// §6 每格增益预算 —— **现算，不查表**（WO-DEMANDLOAD-BUDGET）
//
// ── 今天的行为 X / 应该的 Y ──────────────────────────────────────────────────────
// **X**：`seed.ts` 头注声明了每格预算 `Σ_e |稳态增益_e| × W_e ≤ 0.75`（0.75 = `[0,100]` 域
//   软饱和曲线的拐点 `kneeHi = 0.75 × max`），且给了闭式分配法 `f_g = min(1, 0.75/S_g)`。
//   但那次分配**只在 WO-SIM-CALIBRATION 当时跑过一次**，之后每加一条入边都没有重跑 ——
//   **没有任何东西在守它**。实测：`Model.demandLoad` 当时按两条 Order 边恰好配满 0.75，
//   后来又进来三条边（coverDays / 阻尼 / 真值边），**合计 4.07 倍**而四包全绿。
// **Y**：预算是**现算**出来的，不是记在注释里的。本段把它变成机器。
//
// ── ⚠ 为什么 `W_e` 必须**真起数据量**，不许从 `weightRef` 的口径名推 ────────────────
// `seed.ts` 头注那张「口径 → W」对照表（`equal_share ⇒ W=1`、`null ⇒ W=N`…）**是对的**，
// 但「N 是多少」只有真图知道，而**同一个口径在不同边上的 W 天差地别**：
// 实测 `demo_model_demand_to_fg_drawdown`（`null`）的 Σw = **1**（`fg_of_model` 是 N:1，
// 组内只有一行），而同一个 `null` 在反向的 `demo_fg_drawdown_relieves_model_demand` 上是 **3**。
// **形态**：「我用『这条边的 weightRef 是 null』当作『它占 N 份』的证据，而前者并不度量后者
// —— N 由链路基数决定，可以恰好是 1。」⇒ 本段一律从 `buildPairWeights` 的**真权重表**求和。
//
// ── ⚠ 受不受预算约束，判据只有一条：`targetStateVar` 在不在 `STATE_VAR_DOMAINS` 里 ──────
// 没有域就没有拐点，`0.75` 在无域格上不度量任何东西（`seed.ts` 的 `inflowCoefficient` 段头
// 立的同一条判据：预乘 λ 与受预算约束**由同一个谓词开关，一起开一起关**）。
// ══════════════════════════════════════════════════════════════════════════════════
describe("§6 WO-DEMANDLOAD-BUDGET · 每格增益预算现算", () => {
  /** 每格现算 `Σ_e |稳态增益_e| × Σw_e`。Σw 取各 target 的**均值**（与在册口径同源）。 */
  const measureBudget = async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);
    const rules = await t.repos.sim.listPropagationRules("demo", true);
    const inp = await buildPropagationInputs(
      t.repos,
      { tenantId: "demo", userId: "admin", roles: ["admin"] } as never,
      resolveSimScope(null),
      rules,
    );
    const typeOf = new Map(inp.graph.objects.map((o) => [o.id, o.typeKey]));
    const cells = new Map<string, { sum: number; edges: { key: string; gain: number; sw: number }[] }>();
    for (const r of rules) {
      // 无域 ⇒ 纯积分器，没有拐点也没有 1/λ 可约 ⇒ 不受预算（与预乘 λ 同一个谓词）。
      if (!Object.prototype.hasOwnProperty.call(inp.stateVarDomains, r.targetStateVar)) continue;
      const ref = r.coefficientRef;
      // 引擎真读的那个值：`coefficientRef` 解析优先，解析不到才回落内联（G-10 P1 同一条路）。
      const eff = ref ? (inp.ruleParams[ref.ruleKey]?.[ref.paramKey] ?? r.coefficient) : r.coefficient;
      const w = inp.pairWeights[r.key] ?? null;
      const byTarget = new Map<string, number>();
      for (const l of inp.graph.links) {
        if (l.linkKey !== r.viaLinkKey) continue;
        if (typeOf.get(l.fromId) !== r.sourceTypeKey || typeOf.get(l.toId) !== r.targetTypeKey) continue;
        byTarget.set(l.toId, (byTarget.get(l.toId) ?? 0) + (w === null ? 1 : (w[pairWeightKey(l.fromId, l.toId)] ?? 0)));
      }
      if (byTarget.size === 0) continue;
      const sw = [...byTarget.values()].reduce((s, x) => s + x, 0) / byTarget.size;
      const cellKey = `${r.targetTypeKey}.${r.targetStateVar}`;
      const c = cells.get(cellKey) ?? { sum: 0, edges: [] };
      // 稳态增益 = 每拍入流 ÷ λ（`inflowCoefficient` 的逆）。λ 从 C35 现读，不内联 0.37。
      const gain = eff / PRESSURE_DECAY_PER_TICK;
      c.sum += Math.abs(gain) * sw;
      c.edges.push({ key: r.key, gain, sw });
      cells.set(cellKey, c);
    }
    return cells;
  };

  it("🔴 超预算格子集合 + `Model.demandLoad` 读数必须与在册一致（加边/抬系数即红）", async () => {
    const cells = await measureBudget();

    // 🐤 金丝雀①（非空 + 有鉴别力）：本仓真发生过"空绿"——权重没喂进去、一条边没触发，
    //    于是「没有格子超预算」被读成通过。故先证明量法**量到了东西**，且**分得出两档**。
    expect(cells.size, "一个受预算约束的格子都没量到 ⇒ 量法坏了（不许读成『全部达标』）").toBe(36);
    const inBudget = cells.get("Base.loadIndex");
    expect(inBudget, "`Base.loadIndex` 没量到 ⇒ 量法坏了").toBeDefined();
    expect(inBudget!.sum, "已知达标的格子被判成超预算 ⇒ 判据本身坏了").toBeCloseTo(0.6, 6);

    // ── 判据①：`Model.demandLoad` 的现值（本单的落点）──────────────────────────────
    // 改前 3.0550（4.07×）—— 其中 `demo_fg_drawdown_relieves_model_demand` 独占 **1.8000**
    // （`weightRef: null` ⇒ Σw = N = 3），占全格 59%。
    // 本单把它归一到 Σw=1 后 ⇒ 1.8550（2.47×）。**仍然超预算，如实钉在这里，不许拿系数去凑。**
    const demand = cells.get("Model.demandLoad")!;
    expect(demand.edges.length, "入边条数变了 ⇒ 预算得重新分配，先解释再改这个数").toBe(4);
    expect(
      demand.sum,
      "`Model.demandLoad` 的 Σ|增益|×Σw 变了。变大 ⇒ 又有人往这格加边/抬系数；" +
        "变小 ⇒ 若是靠缩系数达标，退回（缩系数不改相对动态，只让缺口看起来没了）",
    ).toBeCloseTo(1.855, 4);

    // ── 判据②：目标边真的归一到 Σw=1（这是本单改的那一件事）─────────────────────────
    const relieve = demand.edges.find((e) => e.key === "demo_fg_drawdown_relieves_model_demand")!;
    expect(
      relieve.sw,
      "库存缓冲边的 Σw 又回到 N ⇒ `weightRef` 被改回 null。" +
        "后果两条，都能实测：① 去程 `demo_model_demand_to_fg_drawdown` 记 0.6、回程记 0.6×N，" +
        "种子自己写的「来回两次一样大」不成立；② 环增益从 0.36 变成 0.6×0.6×N > 1 ⇒ 振荡冲过头",
    ).toBeCloseTo(1, 9);

    // ── 判据③：**分母** —— 超预算的不止这一格，集合钉死，少一个多一个都要先解释 ──────────
    // ⚠ 这一条守的是「别人家的格子悄悄变坏/变好没人知道」。
    //   ⛔ 它不是允许超预算的许可证：这 11 个格子每一个都是**真欠账**，来历见 WO 报告。
    // ⚠ 另有 4 格 **恰好压在线上**（Σ = 0.75000，1.00×）：`Order.costPressure` /
    //   `Order.shortageRisk` / `OrderPromise.promiseRisk` / `WorkOrder.releasePressure` ——
    //   它们是 `f_g` 当年**配满**的痕迹（`f_g = 0.75/S_g` 取等号），不是巧合，故不在本集合里。
    //   给这四格任一条边再抬一点系数，它们就会掉进本集合 ⇒ 这道门会红。
    const over = [...cells.entries()].filter(([, v]) => v.sum > 0.75 + 1e-9).map(([k]) => k).sort();
    expect(over, "超预算格子集合变了 —— 新增即回归，减少即有人改了标定，两种都必须先解释").toEqual([
      "Certification.qualificationQueue",   // 1.08x · 单边 0.3 未预乘 λ
      "Customer.receivablePressure",        // 1.15x · source_value_relative，Σw 随客户金额敞口走
      "ExceptionEvent.handlingBacklog",     // 2.88x · 单边 0.8 未预乘 λ（全表最高）
      "IncomingInspection.queueDays",       // 2.16x · 单边 0.6 未预乘 λ
      "MaintenanceOrder.repairBacklog",     // 2.16x · 单边 0.6 未预乘 λ
      "Material.shortageRisk",              // 1.67x · 6 条边各自小，合计超（没人算总账）
      "Model.demandLoad",                   // 2.47x · 本单落点
      "Order.orderChurn",                   // 1.12x · actor_exposure_relative
      "Process.queuePressure",              // 1.67x · 3 条边合计超
      "PurchaseOrder.expeditePressure",     // 1.33x · 2 条边合计超
      "QualityLot.inspectBacklog",          // 1.80x · 单边 0.5 未预乘 λ
    ].sort());
  }, 300000);
});
