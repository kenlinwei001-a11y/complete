import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";
import { seedDemoPropagationRules } from "../src/seed.js";
// §6 每格增益预算现算所需：装配走**生产同一处**（`buildPropagationInputs`），
// 权重键走引擎同一支（`pairWeightKey`），λ 走 C35 同一个记号 —— 三者都不许在测里另抄一份。
import { buildPropagationInputs } from "../src/sim/propagation-inputs.js";
import { pairWeightKey } from "../src/sim/propagation.js";
// WO-GAIN-REACH · 实际拉力列所需，三者都走**生产同一支**：
//  · `deriveSeedBaseSnapshot` —— tick0 世界态 + 逐格出处（真读数 / 哈希占位），⛔ 测里不另抄两档判定；
//  · 播种期两步 —— `server.ts` 的 seed:derivation-specs / seed:derivation-recompute，
//    少了它们本测的世界与生产不同源（实测「实测格」4189 → 450），理由见 `measureBudget` 内注释。
// M0-A11 另需 `listSimWorldObjects`：「谁算推演世界的成员」的**唯一物化入口**。
// 稀疏世界必须只从它回的那批单里挑 —— 详见 A11 段头注（已完成订单不进世界）。
import { deriveSeedBaseSnapshot, listSimWorldObjects } from "../src/sim/seed-world.js";
import { seedDemoDerivationSpecs, recomputeDemoDerivationsAtSeed } from "../src/seed-derivation-specs.js";
// ⛔ 刻意**不再** import `PRESSURE_DECAY_PER_TICK`：§6 的 λ 一律逐格从 `decayRef` 现读。
// 把那个记号留在手边，下一个人顺手拿它当默认值就又回到「全表一个 λ」那个病（WO-COEF-LAMBDA）。
// §7 WO-WEIGHT-BASIS-FIELD 另需 `PropagationRuleSchema`：契约层那两个方向的拒收要**真跑 zod**
// （⛔ 不许在测里另写一个"我认为契约会拒"的判断 —— 那验的是我的想法不是契约）。
import { resolveSimScope, PropagationRuleSchema } from "@platform/contracts";

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
// §7 WO-WEIGHT-BASIS-FIELD · **按声明字段分摊**真的按量值走，且字段读不到会当场失败
//
// ── 今天的行为 X / 应该的 Y（改前实测）─────────────────────────────────────────────
// **X**：10 条扇入边全落 `equal_share` ⇒ 计量值恒 1 ⇒ **平摊**。实测 `obj_supplier_SUP-001`
//   名下 4 张采购单 qty = 965 / 2752 / 2968 / 3951（极差 4.094×），各自单独加急 15
//   ⇒ `Supplier.reviewPressure` **逐字节相同的 0.555**。按它排"先查哪家供应商"= 按单数排。
// **Y**：3951 那张单的份额该是 965 那张的 4.094 倍。实测改后 0.824672809327 vs 0.201419706657，
//   **比值 4.094301 与 qty 比值 4.094301 逐位相同**。
//
// ── 本段守两件事，缺一件这个口径就会退化 ─────────────────────────────────────────────
//  ① **Σw 必须 = 1**（`IN_EDGES`）。换成 `IN_EDGES_MEAN`（Σ=N）会把入流整体放大 N 倍 ——
//     §6 判据③b 注释里记的那次实测就是：同一个字段、只改归一方向，
//     `Material.shortageRisk` 从 1.249998 变 1.571426。**字段对了不等于口径对了。**
//  ② **字段读不到必须报缺**。这是本口径与 `source_qty_relative`（写死 `props.qty`）的**唯一**
//     实质区别：那一支读不到时整表权重量出 0 ⇒ 引擎 `amount === 0 ⇒ continue`
//     ⇒ 该边**静默停摆**，只体现为 `zeroPairs`、**永不进 `unresolved`**。
//     形态：「我用『这条边声明了分摊口径』当作『它在按份额传导』的证据，而前者并不度量后者。」
// ══════════════════════════════════════════════════════════════════════════════════
describe("§7 WO-WEIGHT-BASIS-FIELD · 按声明字段分摊（真种子）", () => {
  /** 本单改到的 9 条边 + 它们各自声明的字段（⛔ 与 seed.ts 手写一致，改了种子这里必须跟着改）。 */
  const CHANGED: [string, string][] = [
    ["demo_wo_release_to_model_cost", "qtyPlanned"],
    ["demo_wo_release_to_model_supply_risk", "qtyPlanned"],
    ["demo_po_expedite_to_supplier_review", "qty"],
    ["demo_po_procurement_delay_to_material_shortage", "qty"],
    ["demo_batch_procurement_delay_to_material_shortage", "qty"],
    ["demo_fg_cover_days_to_model_demand", "qtyAvailable"],
    ["demo_fg_drawdown_relieves_model_demand", "qtyAvailable"],
    ["demo_supplier_delay_to_material_shortage", "contractedSupplyTon"],
    ["demo_supplier_procurement_delay_to_material_shortage", "contractedSupplyTon"],
  ];
  /**
   * **审过之后裁定不改**的那一条，连同理由钉在这里（不是遗漏）。
   * `demo_model_demand_to_base_load`：候选字段 `Model.unitPrice` 与目标 `Base.loadIndex`
   * （产能量）不对题；而 `capacity`/`orderCount`/`totalDemand` 已经在源态 `demandLoad`
   * （定义式 `orderCount × 100 ÷ capacity`）里算过一遍，再乘份额就是同一个体量因子记两遍账。
   * ⇒ 它**必须仍是 `equal_share`**。哪天有人顺手把它也改了，这一条会红，并读到这段理由。
   */
  const DELIBERATELY_EQUAL = "demo_model_demand_to_base_load";
  /**
   * `po_from_supplier` 上**名下有 ≥2 张采购单**的供应商组数（实测 demo·seed 42）。
   * 存在的理由是 `coverage-blind` 的 D2：只断言"至少有一组"等于拿 ∃ 冒充 ∀ ——
   * 样本缩到 1 组时那种断言照样绿，而对照实验的鉴别力已经没了。
   * ⚠ 全 30 条边 / 10 个供应商，其中扇入=1 的组不进本数（它们任何口径下权重恒 1）。
   */
  const MULTI_PO_SUPPLIER_GROUPS = 8;

  const boot = async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    return t;
  };
  const inputs = async (t: TestApp) => {
    const rules = await t.repos.sim.listPropagationRules("demo", true);
    const inp = await buildPropagationInputs(
      t.repos,
      { tenantId: "demo", userId: "admin", roles: ["admin"] } as never,
      resolveSimScope(null),
      rules,
    );
    return { rules, inp };
  };

  it("种子把 9 条边接到 source_field_share 上了，且各自声明了字段（裁定不改的那条仍是 equal_share）", async () => {
    const t = await boot();
    const { rules } = await inputs(t);
    for (const [key, field] of CHANGED) {
      const r = rules.find((x) => x.key === key);
      expect(r, `规则 ${key} 不在种子里 ⇒ 下面每条断言都成空绿`).toBeDefined();
      expect(r!.weightRef?.basis, `${key} 的口径变了`).toBe("source_field_share");
      expect(
        r!.weightRef?.field,
        `${key} 没声明计量字段 —— 契约 superRefine 本该拦住它，能走到这里说明写入路绕过了 zod`,
      ).toBe(field);
    }
    const eq = rules.find((x) => x.key === DELIBERATELY_EQUAL);
    expect(
      eq!.weightRef?.basis,
      `${DELIBERATELY_EQUAL} 被改成了按字段分摊 —— 见本段 DELIBERATELY_EQUAL 上方那三行理由：` +
        `unitPrice 与"基地有多忙"不对题，capacity/orderCount 会把已在源态里算过的体量再算一遍。`,
    ).toBe("equal_share");
    expect(eq!.weightRef?.field ?? null, `${DELIBERATELY_EQUAL} 不该有 field（equal_share 不读它）`).toBeNull();
  }, 300000);

  it("🔴 Σw 逐目标恒 = 1（归一方向被改成 Σ=N 即红 —— §6 判据③b 那次 1.249998→1.571426 的复发闸）", async () => {
    const t = await boot();
    const { rules, inp } = await inputs(t);
    const typeOf = new Map(inp.graph.objects.map((o) => [o.id, o.typeKey]));
    let checkedTargets = 0;
    for (const [key] of CHANGED) {
      const r = rules.find((x) => x.key === key)!;
      const w = inp.pairWeights[r.key];
      expect(w, `${key} 算不出权重表 ⇒ 该边不传导（看 pairWeightReport.unresolved 的原因）`).toBeDefined();
      const byTarget = new Map<string, number>();
      for (const l of inp.graph.links) {
        if (l.linkKey !== r.viaLinkKey) continue;
        if (typeOf.get(l.fromId) !== r.sourceTypeKey || typeOf.get(l.toId) !== r.targetTypeKey) continue;
        byTarget.set(l.toId, (byTarget.get(l.toId) ?? 0) + (w![pairWeightKey(l.fromId, l.toId)] ?? 0));
      }
      // 🐤 金丝雀：这条边真的有目标。0 个目标时下面的 for 一次不进，"Σw 全对"是空绿。
      expect(byTarget.size, `${key} 一个目标都没量到 ⇒ 量法坏了，不许读成『Σw 全对』`).toBeGreaterThan(0);
      for (const [tid, sum] of byTarget) {
        expect(
          sum,
          `${key} 目标 ${tid} 的 Σw = ${sum} ≠ 1 ⇒ 归一方向不再是 IN_EDGES。` +
            `Σ=N 会把这一格的入流整体放大 N 倍（实测 Material.shortageRisk 1.249998 → 1.571426）。`,
        ).toBeCloseTo(1, 12);
        checkedTargets += 1;
      }
    }
    expect(checkedTargets, "🐤 一个目标都没核到 ⇒ 本条是空绿").toBeGreaterThanOrEqual(60);
  }, 300000);

  it("🔴 对照实验：同一供应商名下 qty 差 4.09× 的两张采购单各加急 15 ⇒ 读数按 qty 拉开（修前同为 0.555）", async () => {
    const t = await boot();
    const RULE = "demo_po_expedite_to_supplier_review";
    const { rules, inp } = await inputs(t);
    const r = rules.find((x) => x.key === RULE)!;
    const typeOf = new Map(inp.graph.objects.map((o) => [o.id, o.typeKey]));
    const qtyOf = new Map<string, number>();
    for (const o of await t.repos.objects.listByType("demo", "PurchaseOrder")) {
      if (!o.mergedInto) qtyOf.set(o.id, Number(o.props.qty ?? 0));
    }
    // 沿**真链路表**挑组（不写死 obj_supplier_*：种子换单时本用例应当跟着走，而不是变成假绿）
    const bySupplier = new Map<string, string[]>();
    for (const l of inp.graph.links) {
      if (l.linkKey !== r.viaLinkKey) continue;
      if (typeOf.get(l.fromId) !== r.sourceTypeKey || typeOf.get(l.toId) !== r.targetTypeKey) continue;
      (bySupplier.get(l.toId) ?? bySupplier.set(l.toId, []).get(l.toId)!).push(l.fromId);
    }
    const ranked = [...bySupplier.entries()]
      .filter(([, pos]) => pos.length >= 2)
      .map(([sup, pos]) => {
        const qs = pos
          .map((p) => ({ id: p, q: qtyOf.get(p) ?? 0 }))
          .sort((a, b) => a.q - b.q || a.id.localeCompare(b.id)); // R6：平手按 id
        return { sup, qs, spread: qs[qs.length - 1]!.q / Math.max(1, qs[0]!.q) };
      })
      .sort((a, b) => b.spread - a.spread || a.sup.localeCompare(b.sup));
    // ── 🐤 基数断言（不是存在性）—— `coverage-blind` 的 D2「拿 ∃ 冒充 ∀」当场咬出来的 ────────
    // 上一版这里只有 `expect(ranked.length).toBeGreaterThan(0)`，然后只用 `ranked[0]`。
    // 那是**存在性**断言：只要还剩一个多单供应商，它就绿，而"另外 N−1 组是不是也按 qty 分摊"
    // 一个字都没验。判据落在**基数**上，并在下面补一条真正的 ∀ 臂。
    expect(
      ranked.length,
      "名下有 ≥2 张采购单的供应商组数变了 —— 变少 ⇒ 样本在缩（这个实验的鉴别力在下降）；" +
        "变多 ⇒ 种子加单了。两种都先解释再改这个数。",
    ).toBe(MULTI_PO_SUPPLIER_GROUPS);
    const pick = ranked[0]!;
    expect(pick.spread, "组内 qty 极差 ≈1 ⇒ 按量值与平摊读数本就相同，这个实验没有鉴别力").toBeGreaterThan(1.5);
    const lo = pick.qs[0]!, hi = pick.qs[pick.qs.length - 1]!;

    // ── ∀ 臂：**每一个**多单组都必须满足 w = qty ÷ 组内 Σqty 且 Σw = 1 ────────────────
    // ⚠ 这一条不是"再验一遍"：下面那个 API 对照实验只驱动 `ranked[0]` 一组（真起服务、两拍），
    //   逐组跑 API 太贵；而"份额是不是真按声明字段算的"这件事必须对**全部**组成立，
    //   否则就是「一组对了」冒充「这个口径对了」。故这里用同一张生产权重表逐组核到 12 位。
    const wTable = inp.pairWeights[RULE];
    expect(wTable, `${RULE} 算不出权重表 ⇒ 下面逐组核对是空绿`).toBeDefined();
    let checkedGroups = 0;
    for (const g of ranked) {
      // 🐤 组基数下限：`ranked` 是用 `pos.length >= 2` 滤出来的，但那个不变量在**上游**，
      //    本 `it()` 里看不见 ⇒ 空组时下面这层 for 会一次不进、恒绿零断言（`coverage-blind` 的 D1）。
      //    故在这里把它显式写出来：份额的前提就是"这一组至少有两个源要分"。
      expect(g.qs.length, `${g.sup} 组内只有 ${g.qs.length} 个源 ⇒ 没有份额可分，它不该进 ranked`).toBeGreaterThanOrEqual(2);
      const sq = g.qs.reduce((s, x) => s + x.q, 0);
      expect(sq, `${g.sup} 组内 Σqty = 0 ⇒ 份额分母非正，本该进 unresolved`).toBeGreaterThan(0);
      let sw = 0;
      for (const row of g.qs) {
        const w = wTable![pairWeightKey(row.id, g.sup)];
        expect(w, `${g.sup} ← ${row.id} 这一对在权重表里查不到 ⇒ 该对不传导`).toBeDefined();
        expect(
          w,
          `${g.sup} ← ${row.id}：权重 ${w} ≠ qty ${row.q} ÷ Σqty ${sq} ⇒ 这一组没有按声明字段分摊`,
        ).toBeCloseTo(row.q / sq, 12);
        sw += w!;
      }
      expect(sw, `${g.sup} 的 Σw = ${sw} ≠ 1 ⇒ 归一方向不再是 IN_EDGES`).toBeCloseTo(1, 12);
      checkedGroups += 1;
    }
    expect(checkedGroups, "🐤 一组都没核到 ⇒ 上面那个 for 在空集上恒绿").toBe(MULTI_PO_SUPPLIER_GROUPS);

    const drive = async (poId: string) => {
      const mk = await t.app.inject({
        method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
        payload: { baseSnapshot: { [poId]: { expeditePressure: 15 }, [pick.sup]: { reviewPressure: 0 } } },
      });
      expect(mk.statusCode, mk.body.slice(0, 200)).toBeLessThan(400);
      const tk = await t.app.inject({
        method: "POST", url: `/a/v1/sim/sessions/${(mk.json() as { id: string }).id}/tick?explain=1`,
        headers: ADMIN, payload: { n: 2 }, // delayTicks=1 ⇒ 要两拍才落到 Supplier 上
      });
      expect(tk.statusCode, tk.body.slice(0, 300)).toBeLessThan(400);
      const body = tk.json() as {
        state: Record<string, Record<string, number>>;
        pairWeighting?: { report: { explain: { ruleKey: string; sourceObjectId: string; targetObjectId: string; weight: number }[]; unresolved: { ruleKey: string; reason: string }[] } };
      };
      // 口径算不出来时引擎诚实报缺、本条流不传导 ⇒ 下面每个读数都成 0、逐句自洽成绿。
      const bad = (body.pairWeighting?.report.unresolved ?? []).filter((u) => u.ruleKey === RULE);
      expect(bad, `本规则被判"算不出权重"：${bad[0]?.reason ?? ""}`).toHaveLength(0);
      const ex = body.pairWeighting?.report.explain.find(
        (e) => e.ruleKey === RULE && e.sourceObjectId === poId && e.targetObjectId === pick.sup,
      );
      return { read: body.state[pick.sup]?.reviewPressure ?? 0, w: ex?.weight };
    };
    const rLo = await drive(lo.id), rHi = await drive(hi.id);

    // ── 判据①：两个读数**必须不同**（修前逐字节相同的 0.555，那就是平摊的指纹）────────
    expect(rLo.read, "小单读数为 0 ⇒ 这条边没传导，下面的比值是 0/0").toBeGreaterThan(0);
    expect(
      rHi.read,
      `qty ${hi.q} 与 qty ${lo.q} 的两张单给出**逐字节相同**的 ${rHi.read} ⇒ 仍在平摊。` +
        `这正是本口径要治的病（修前两者同为 0.555）。`,
    ).not.toBe(rLo.read);
    // ── 判据②：比值必须**等于 qty 比值**（这是"按量值成比例"的定义，不是"拉开就行"）──────
    // ⚠ 只断言"不同"是不够的：任何一个瞎编的权重都能让两数不同。必须咬住那个**可预言的**比值。
    expect(
      rHi.read / rLo.read,
      `读数比 ${rHi.read / rLo.read} ≠ qty 比 ${hi.q / lo.q} ⇒ 份额不是按声明字段成比例算的`,
    ).toBeCloseTo(hi.q / lo.q, 9);
    // ── 判据③：权重本身 = 该单 qty ÷ 组内 Σqty（分子分母都可被审计独立复算）──────────
    const sumQ = pick.qs.reduce((s, x) => s + x.q, 0);
    expect(rHi.w, "大单权重 ≠ qty ÷ Σqty ⇒ 分母不是该组总量").toBeCloseTo(hi.q / sumQ, 12);
    expect(rLo.w, "小单权重 ≠ qty ÷ Σqty ⇒ 分母不是该组总量").toBeCloseTo(lo.q / sumQ, 12);
  }, 300000);

  it("🔴 field 读不到必须报缺 + 引擎不传导（双向金丝雀；⛔ 不许静默归零或回落等份）", async () => {
    const t = await boot();
    const RULE = "demo_po_expedite_to_supplier_review";
    const probe = async () => {
      const { inp } = await inputs(t);
      return {
        tbl: inp.pairWeights[RULE],
        u: inp.pairWeightReport.unresolved.filter((x) => x.ruleKey === RULE),
      };
    };
    // 🐤 正向金丝雀：**正确字段**必须算得出表且不报缺。
    //    少了它，「什么都报缺」与「该报缺时才报缺」在屏上一模一样。
    const ok = await probe();
    expect(ok.tbl, "正确字段都算不出表 ⇒ 判据本身坏了，下面那条『报缺』不构成证据").toBeDefined();
    expect(ok.u, "正确字段却报缺 ⇒ 实现把好的也拦了").toHaveLength(0);
    expect(Object.values(ok.tbl!).filter((v) => v !== 0).length, "正确字段算出的表全是 0 ⇒ 没在分摊").toBeGreaterThan(0);

    // ⚠ 仓储直写（绕过 zod）**是刻意的**：`repo/pg.ts` 读回是 `row.doc as PropagationRule` 裸 cast，
    //   契约 refine 只在写入路生效 ⇒ 生产上真的可能出现一条 field 不对的规则。这里模拟那条路。
    const cur = (await t.repos.sim.listPropagationRules("demo", true)).find((r) => r.key === RULE)!;
    await t.repos.sim.putPropagationRule({
      ...cur,
      weightRef: { basis: "source_field_share", field: "qtyThisFieldDoesNotExist" },
    });
    const bad = await probe();
    expect(
      bad.tbl,
      "❌ 字段读不到却**算出了一张表** ⇒ 静默归零：引擎会因 amount===0 跳过，该边一声不响地停摆，" +
        "只体现为 zeroPairs、永不进 unresolved。这正是本口径存在的全部理由。",
    ).toBeUndefined();
    expect(bad.u, "字段读不到却没进 unresolved ⇒ 缺口没亮出来").toHaveLength(1);
    expect(bad.u[0]!.reason, "报缺原因必须点名那个读不到的字段").toContain("qtyThisFieldDoesNotExist");
    // 🐤 报否定结论必须带金丝雀证据：原因里要列出该类型上**实有**的数值字段，
    //    否则读者分不清「字段名拼错了」还是「这个类型真的没有量值字段」—— 两者修法相反。
    expect(bad.u[0]!.reason, "报缺时没给金丝雀（该类型实有字段清单）").toContain("qty");

    // 端到端：引擎必须把它判进 `pairWeighting.unresolved`，且该边**一行 trace 都没有**。
    // ⚠ 路径是 `pairWeighting.unresolved`（`app.ts` 的 `pairWeighting: { report, unresolved }`），
    //   **不在顶层** —— 读顶层会拿到空数组，然后错报「引擎没把缺口亮出来」。
    const poLinks = await t.repos.links.list("demo", (l) => l.type === cur.viaLinkKey);
    expect(poLinks.length, `${cur.viaLinkKey} 一条链路都没有 ⇒ 本实验前提不成立`).toBeGreaterThan(0);
    const mk = await t.app.inject({
      method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
      payload: { baseSnapshot: { [poLinks[0]!.fromId]: { expeditePressure: 15 } } },
    });
    expect(mk.statusCode, mk.body.slice(0, 200)).toBeLessThan(400);
    const tk = await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${(mk.json() as { id: string }).id}/tick?explain=1`,
      headers: ADMIN, payload: { n: 2 },
    });
    expect(tk.statusCode, tk.body.slice(0, 300)).toBeLessThan(400);
    const body = tk.json() as {
      trace?: { ruleKey: string }[];
      pairWeighting?: { unresolved?: { ruleKey: string }[] };
    };
    expect(
      (body.pairWeighting?.unresolved ?? []).filter((x) => x.ruleKey === RULE),
      "引擎没把它判进 unresolvedWeights ⇒ 缺口在 API 上看不见",
    ).toHaveLength(1);
    expect(
      (body.trace ?? []).filter((x) => x.ruleKey === RULE),
      "字段读不到却还在传导 ⇒ 退回了「逐目标同额」，而那正是本字段要治的错行为",
    ).toHaveLength(0);

    // 还原，免得同文件后续用例吃到脏规则（seed.ts 一行未改）
    await t.repos.sim.putPropagationRule(cur);
    const back = await probe();
    expect(back.tbl, "还原后仍算不出表 ⇒ 还原没生效").toBeDefined();
    expect(back.u, "还原后仍报缺").toHaveLength(0);
  }, 300000);

  it("🔴 契约层 requiresField 两个方向都拒收（真跑 zod·带双向金丝雀）", () => {
    const base = {
      id: "x", key: "k", tenantId: "demo",
      sourceTypeKey: "A", sourceStateVar: "a", viaLinkKey: "l",
      targetTypeKey: "B", targetStateVar: "b",
      coefficient: 1, delayTicks: 0, status: "PUBLISHED" as const,
    };
    // ① `requiresField:true` 却不给 field ⇒ 必须拒收。
    //    不拦的话运行期得到一张全零表，表现只是"这条边今天没动"。
    expect(
      PropagationRuleSchema.safeParse({ ...base, weightRef: { basis: "source_field_share" } }).success,
      "缺 field 却被收下 ⇒ 运行期会得到一张全零权重表，该边静默停摆",
    ).toBe(false);
    // ② `requiresField:false` 却给了 field ⇒ 必须拒收。
    //    它会被实现静默忽略 ⇒ 台账写着"按 qty 分摊"、跑的是等份（声明与行为不一致的假绿）。
    expect(
      PropagationRuleSchema.safeParse({ ...base, weightRef: { basis: "equal_share", field: "qty" } }).success,
      "equal_share 带 field 被收下 ⇒ 台账写着按 qty 分摊、实际跑等份",
    ).toBe(false);
    // 🐤 双向金丝雀：两个**合法**组合必须收下，否则上面两条只证明了"全都拒收"。
    expect(
      PropagationRuleSchema.safeParse({ ...base, weightRef: { basis: "source_field_share", field: "qty" } }).success,
      "合法组合被拒 ⇒ 校验写反了",
    ).toBe(true);
    expect(
      PropagationRuleSchema.safeParse({ ...base, weightRef: { basis: "equal_share" } }).success,
      "既有 equal_share（不带 field）被拒 ⇒ 破了 additive·可回退 RL9 承诺",
    ).toBe(true);
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
// ── 🔴 WO-COEF-LAMBDA 订正：**两个装置不是同一个谓词**（此前三处各写了一个，且都不全对）──────
// 旧原文：「预乘 λ 与受预算约束由同一个谓词开关，一起开一起关」。那句话在
// **每个已声明域都有有限 max** 的年代是对的；WO-PROP-REVIEW-V2 形态② 引入 `max: null`
// 的积压族之后**就不对了**。引擎里这是两处互不相干的判断（逐行读的，不是推断）：
//   · `propagation.ts` `resolveDecayRate(d, ruleParams)` —— **只看 `d.decayRef`**，与 `max` 无关
//     ⇒ 会不会衰减 ⇒ 稳态里有没有 `1/λ` 要约 ⇒ **该不该预乘 λ**；
//   · `propagation.ts` `saturateToDomain(raw, min, max, rest)` —— `max === null` 那一支
//     **没有上拐点**（只有下带）⇒ `kneeHi = 0.75 × max` 根本不存在 ⇒ **不受 0.75 预算约束**。
// ⇒ 判据拆成两条，**各管各的**：
//   | 装置 | 谓词 | 本仓命中 |
//   | 预乘 λ | `decayRef` 能解析出 λ∈[0,1) | 37 个量纲（含 5 个 `max:null` 积压族）|
//   | 0.75 预算 | `max` 有限（上拐点存在） | 32 个量纲（积压族 5 个**不在内**）|
// ⚠ 且 **λ 逐格不同**：压力族 0.37，而 `repairBacklog`/`handlingBacklog` = **0.75**、
//   `qualificationQueue` = **0.22**（C35 各自的 paramKey）。旧代码全表除以 `PRESSURE_DECAY_PER_TICK`
//   ⇒ 对这 3 个量纲，算出来的"稳态增益"分别错 2.03× / 2.03× / 0.59×。
//   形态：「我用『压力族的那个 λ』当作『这一格的 λ』的证据，而前者并不度量后者。」
// ══════════════════════════════════════════════════════════════════════════════════
describe("§6 WO-DEMANDLOAD-BUDGET · 每格增益预算现算", () => {
  /**
   * 这一格真正生效的 λ —— 照 `propagation.ts` `resolveDecayRate` **同一条路**：
   * 只走 `decayRef`，从 `ruleParams` 现读，拒 NaN / <0 / ≥1。
   * ⛔ 不回落 `PRESSURE_DECAY_PER_TICK`：回落会让「这一格的 λ 是 0.75」与「没配 decayRef」
   * 在算式里一模一样，而两者的稳态增益差 2 倍。解析不到就报红，不许静默替一个默认值。
   */
  const lambdaOf = (stateVar: string, inp: Awaited<ReturnType<typeof buildPropagationInputs>>): number => {
    const ref = inp.stateVarDomains[stateVar]?.decayRef;
    expect(ref, `${stateVar} 受预算约束却没有 decayRef ⇒ 稳态增益算不出来（不许拿 0.37 顶）`).toBeTruthy();
    const raw: unknown = inp.ruleParams[ref!.ruleKey]?.[ref!.paramKey];
    const n = typeof raw === "number" ? raw : Number(raw);
    expect(
      Number.isFinite(n) && n > 0 && n < 1,
      `${stateVar} 的 λ 引用 ${ref!.ruleKey}.${ref!.paramKey} 解析成 ${String(raw)} ⇒ 不是可用衰减率`,
    ).toBe(true);
    return n;
  };

  /** 每格现算 `Σ_e |稳态增益_e| × Σw_e`。Σw 取各 target 的**均值**（与在册口径同源）。 */
  const measureBudget = async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    // ── WO-GAIN-REACH：补齐**生产播种序列**里缺的两步（`server.ts` seed:derivation-specs / :recompute）──
    //
    // 🔴 为什么必须补：`deriveSeedBaseSnapshot` 铺 tick0 世界态时**一次性**取 `o.props[v]`，
    //    取到有限数走「真读数档」、取不到才走 `round(hash01(...)×100)` 占位档。派生值晚了不回填。
    //    ⇒ 不跑这两步，本测里的世界与生产**不是同一个世界**：实测 6381 格里的「实测格」
    //    从 **4189 → 450**，`Order.demandPressure` 这类格子整批从真读数掉回哈希占位。
    //    形态（照铁律 0.6 句式）：**「我用『测试助手 seedBattery 播完了』当作『世界与生产同源』
    //    的证据，而前者并不度量后者 —— 生产播种序列比它多两步，而那两步恰好决定每格是真值还是占位。」**
    // ⚠ 这两步**不改 §6 既有的 A 列读数**（A 列只吃系数/λ/权重，不吃源读数）——
    //   判据⓪①①b②③ 的期望值一个没动，就是这件事的实测证据。
    const seedCtx = { tenantId: "demo", userId: "usr_demo_admin", roles: ["admin"], attributes: {} };
    await seedDemoDerivationSpecs(t.repos, t.services.ontologyCore, t.services.governance, seedCtx as never);
    const materialized = await recomputeDemoDerivationsAtSeed(t.repos, t.services.ontologyCore, seedCtx as never);
    expect(materialized, "播种期全量初算一个对象都没物化 ⇒ 下面的「实测源」全是假的").toBeGreaterThan(0);
    await enableSim(t);
    const rules = await t.repos.sim.listPropagationRules("demo", true);
    const inp = await buildPropagationInputs(
      t.repos,
      { tenantId: "demo", userId: "admin", roles: ["admin"] } as never,
      resolveSimScope(null),
      rules,
    );
    const typeOf = new Map(inp.graph.objects.map((o) => [o.id, o.typeKey]));
    // tick0 世界态 + **逐格出处**，走生产同一支（不在测里另抄一份两档判定 —— 那就是第二套真相源）。
    const { state: t0, provenance } = await deriveSeedBaseSnapshot(t.repos, "demo");
    const cells = new Map<
      string,
      {
        sum: number;
        knee: boolean;
        edges: {
          key: string; gain: number; sw: number;
          /** 实际拉力（带符号）= 逐目标真入流 ÷ λ 再对目标取均值。⛔ 不是 `g×W×Ē`，见下方注释。 */
          pull: number;
          /** 该边的源格今天是真读数还是哈希占位 —— 问生产自己的 `provenance` 表，⛔ 不手维护名单。 */
          prov: "实测" | "哈希" | "混" | "缺席";
          /** 引擎单拍 trace 应当记的传导量合计（本测的自证锚点）。 */
          inflow: number;
        }[];
      }
    >();
    for (const r of rules) {
      const dom = inp.stateVarDomains[r.targetStateVar];
      // **谓词①（本循环的入场券）= 会不会衰减** ⇒ 有没有 `1/λ` 可约 ⇒ 稳态增益算不算得出来。
      // 无域 ⇒ 纯积分器，没有稳态，`gain` 这个量对它不成立 ⇒ 跳过（今天全表只有 `clearanceQueueDays`）。
      if (dom == null) continue;
      // **谓词②（受不受 0.75 约束）= 上拐点存不存在** = `max` 有限。两条谓词各管各的，见段头。
      const knee = typeof dom.max === "number";
      const ref = r.coefficientRef;
      // 引擎真读的那个值：`coefficientRef` 解析优先，解析不到才回落内联（G-10 P1 同一条路）。
      // ⚠ `RuleParamLookup` 的值是 `unknown` ⇒ 必须**显式收窄**，且收不到就报红：
      //   悄悄 `as number` 会让「params 里塞了个字符串」变成 `NaN`，而 `NaN > 0.75` 恒 false
      //   ⇒ 那一格从此永远"达标"。**把红吞成绿，比没有这道门更坏。**
      const raw: unknown = ref ? (inp.ruleParams[ref.ruleKey]?.[ref.paramKey] ?? r.coefficient) : r.coefficient;
      expect(typeof raw, `${r.key} 的生效系数不是数 ⇒ 预算算不出来（不许当 0 跳过）`).toBe("number");
      const eff = raw as number;
      const w = inp.pairWeights[r.key] ?? null;
      const byTarget = new Map<string, number>();
      /** 逐目标记下**喂到它的那些源实例**——必须与 `byTarget` 在同一个循环里取：
       *  两处各遍历一次链路表，「W 的分母」与「拉力的分母」就会来自不同的对象集合（第二套真相源）。 */
      const srcOf = new Map<string, string[]>();
      for (const l of inp.graph.links) {
        if (l.linkKey !== r.viaLinkKey) continue;
        if (typeOf.get(l.fromId) !== r.sourceTypeKey || typeOf.get(l.toId) !== r.targetTypeKey) continue;
        byTarget.set(l.toId, (byTarget.get(l.toId) ?? 0) + (w === null ? 1 : (w[pairWeightKey(l.fromId, l.toId)] ?? 0)));
        (srcOf.get(l.toId) ?? srcOf.set(l.toId, []).get(l.toId)!).push(l.fromId);
      }
      if (byTarget.size === 0) continue;
      const sw = [...byTarget.values()].reduce((s, x) => s + x, 0) / byTarget.size;
      const cellKey = `${r.targetTypeKey}.${r.targetStateVar}`;
      const c = cells.get(cellKey) ?? { sum: 0, knee, edges: [] };
      // 稳态增益 = 每拍入流 ÷ λ。λ 走**这一格自己的** `decayRef`，⛔ 不许全表用 `PRESSURE_DECAY_PER_TICK`：
      // 本仓 C35 下挂 6 个 paramKey，实测值 0.37/0.37/0.75/0.75/0.22 三档不同。
      const lam = lambdaOf(r.targetStateVar, inp);
      const gain = eff / lam;

      // ── WO-GAIN-REACH · **实际拉力**：把各源的真实读数算进去 ──────────────────────
      //
      // ⛔ **不写成 `|g| × W̄ × Ē`**（均值之积）：那要求「权重」与「源读数」在组内独立，
      //    而 `source_value_relative` 的权重**就是**源金额 ⇒ 两者完全相关 ⇒ 系统性偏。
      //    实测偏差最大的一条 `demo_customer_reaction_cut_order` 精确/近似 = **0.7216**。
      //    形态：「我用『均值之积』当作『积之均值』的证据，而前者并不度量后者。」
      // ⇒ 逐对算真入流（与 `propagation.ts` 同一支：`reaction` hinge → `decay` factor → 逐对权重），
      //   合计再 ÷λ 得稳态贡献，最后对目标取均值。`inflow` 单独留着当**自证锚点**：
      //   它必须逐字节等于引擎单拍 trace 里这条边的 `amount` 合计（判据④）。
      let inflow = 0;
      let meas = 0;
      let deriv = 0;
      const seenSrc = new Set<string>();
      for (const [tid, sids] of srcOf) {
        for (const sid of sids) {
          if (!seenSrc.has(sid)) {
            seenSrc.add(sid);
            const o = provenance[sid]?.[r.sourceStateVar];
            if (o === "measured") meas += 1;
            else if (o === "derived") deriv += 1;
          }
          const v0 = t0[sid]?.[r.sourceStateVar];
          if (typeof v0 !== "number") continue;
          // `propagation.ts` 还手边只把**超出容忍线**的那部分当驱动量（hinge，不是阶跃）。
          const drive = r.reaction == null ? v0 : Math.max(0, v0 - r.reaction.tolerance);
          const factor = r.decay ? (1 > r.decay.window ? 0 : 1 - 1 / r.decay.den) : 1;
          inflow += eff * drive * factor * (w === null ? 1 : (w[pairWeightKey(sid, tid)] ?? 0));
        }
      }
      const prov = meas > 0 && deriv === 0 ? "实测" : deriv > 0 && meas === 0 ? "哈希" : meas + deriv === 0 ? "缺席" : "混";
      c.sum += Math.abs(gain) * sw;
      c.edges.push({ key: r.key, gain, sw, pull: inflow / byTarget.size / lam, prov, inflow });
      cells.set(cellKey, c);
    }
    return { cells, t };
  };

  it("🔴 超预算格子集合 + `Model.demandLoad` 读数必须与在册一致（加边/抬系数即红）", async () => {
    const { cells, t } = await measureBudget();

    // 🐤 金丝雀①（非空 + 有鉴别力）：本仓真发生过"空绿"——权重没喂进去、一条边没触发，
    //    于是「没有格子超预算」被读成通过。故先证明量法**量到了东西**，且**分得出两档**。
    // ⚠ 36 与改造前**同一个数**，这是对的：旧谓词「在不在域表里」与本条谓词①「会不会衰减」
    //   在本仓恰好等价（每个已声明域都配了 decayRef）。变的不是入场的格子数，是**这 36 格里
    //   哪几格受 0.75 约束**（谓词②）以及**每格的 λ 取哪个数**。
    expect(cells.size, "一个会衰减的格子都没量到 ⇒ 量法坏了（不许读成『全部达标』）").toBe(36);
    const inBudget = cells.get("Base.loadIndex");
    expect(inBudget, "`Base.loadIndex` 没量到 ⇒ 量法坏了").toBeDefined();
    expect(inBudget!.sum, "已知达标的格子被判成超预算 ⇒ 判据本身坏了").toBeCloseTo(0.6, 6);

    // 🐤 金丝雀②（**这一条是 WO-COEF-LAMBDA 新加的，它证明量法分得出两个谓词**）：
    //    `max: null` 的积压族必须**被量到**（会衰减 ⇒ 有稳态增益）但**不带上拐点**（不受 0.75）。
    //    只证「量到了」不够 —— 那与"把它们当普通格子"在屏上一模一样；必须证 `knee === false`。
    const kneeless = [...cells.entries()].filter(([, v]) => !v.knee).map(([k]) => k).sort();
    expect(
      kneeless,
      "无上拐点（`max: null`）的格子集合变了 —— 它们会衰减故有稳态增益，但 `0.75 × max` 在它们身上不存在",
    ).toEqual([
      "Certification.qualificationQueue",
      "ExceptionEvent.handlingBacklog",
      "IncomingInspection.queueDays",
      "MaintenanceOrder.repairBacklog",
      "QualityLot.inspectBacklog",
    ]);

    // ── 判据⓪：这 5 格的**稳态增益** = 在册意图增益（WO-COEF-LAMBDA 方向②）────────────────
    // 它们没有拐点 ⇒ 0.75 咬不住它们 ⇒ **必须另有一条机器**，否则「域补登记了、系数没回头改」
    // 这个形态会再犯一次（上一次就是这么漏的：5 个量纲补进域表，5 条边的系数没人动）。
    // 判据 = `c/λ` 必须等于 description / 在册注释承诺的那个稳态增益。λ 逐格不同（0.37/0.75/0.22），
    // 故这一条**同时**咬住「系数改了没重算」与「λ 改了没重算」两个方向。
    for (const [cell, intent] of [
      ["IncomingInspection.queueDays", 0.6],
      ["QualityLot.inspectBacklog", 0.5],
      ["MaintenanceOrder.repairBacklog", 0.6],
      ["ExceptionEvent.handlingBacklog", 0.8],
      ["Certification.qualificationQueue", 0.3],
    ] as const) {
      const c = cells.get(cell)!;
      expect(c.edges.length, `${cell} 入边条数变了 ⇒ 下面那个增益不再是单边增益`).toBe(1);
      expect(
        c.edges[0]!.gain,
        `${cell} 的稳态增益 ≠ 在册意图 ${intent}。两种成因都要查：` +
          `① C36 里那条边的系数被改了没跟着乘 λ；② C35 里这一格的 λ 被改了没跟着重算系数。` +
          `⛔ 不许改这个期望值来让它绿 —— 该改的是系数。`,
      ).toBeCloseTo(intent, 9);
    }

    // ── 判据①：`Model.demandLoad` 的现值（本单的落点）──────────────────────────────
    // 3.0550（4.07×）→ 1.8550（2.47×，归一 Σw）→ **0.749961（1.00×，本单整格重跑 f_g）**。
    const demand = cells.get("Model.demandLoad")!;
    expect(demand.edges.length, "入边条数变了 ⇒ 预算得重新分配，先解释再改这个数").toBe(4);
    expect(
      demand.sum,
      "`Model.demandLoad` 的 Σ|增益|×Σw 变了。变大 ⇒ 又有人往这格加边/抬系数；" +
        "变小 ⇒ 若是靠缩系数达标，退回（缩系数不改相对动态，只让缺口看起来没了）",
    ).toBeCloseTo(0.749961, 6);

    // ── 判据①b：**带符号**净增益必须 > 0（WO-COEF-LAMBDA 件B 的业务判据）──────────────
    // ⚠ 上面判据① 量的是 **Σ|增益|**，它**不度量方向** —— 一格可以又达标又恒为 0。
    //   实测就是这么发生的：整格达标（1.00×）而四条边净和 −0.92575 ⇒ `Model.demandLoad`
    //   被夹死在域下界 0，`sim-root-triad` 的 G-ROOT-1 逐拍 Δ 全 0.0000。
    // **业务判据**：`demandLoad`「型号需求负载」的定义是 `orderCount × 100 / capacity`
    //   （`seed-derivation-specs.ts` `model_demand_load`，真值实测 21.7–232）。
    //   订单簿 **500 张单 / 454.64 亿**是已签成交 —— 一个型号的需求负载恒等于 0 不成立。
    //   ⇒ 该格对「需求」的**净**响应必须为正；负则说明修正项（变更折扣 / 库存吸收）压过了一阶驱动。
    // ⛔ 这一条**不许**靠缩某条边的系数来满足：f_g 是全格同一个乘数，缩它不改符号
    //   （实测：只重跑 f_g、量级全不动 ⇒ 净增益 −0.0316，仍为负）。改的必须是某条边的**意图增益**。
    //
    // ⚠⚠ **这条判据是必要不充分，别拿它当「这一格活了」的证据**（WO-COEF-LAMBDA 如实记）：
    //   它算的是 `Σ 增益×Σw`，**没有算进各个源的实际量程**。实测本格改后净增益 **+0.194589 > 0**，
    //   而零扰动基准世界里 `Model.demandLoad` **仍在 tick6 落到 0 并停住**
    //   （对照组 `Base.loadIndex` / `Line.utilPressure` / `Order.demandPressure` /
    //    `WorkOrder.releasePressure` 同一条轨迹上 tick8 **都不为 0** ⇒ 这不是"零扰动世界都会松弛到静息点"）。
    //   病因（实测两数）：`Order.demandPressure` 是真值派生（`demandDelta×100`），
    //   种子里 **150 张单合计 876.0 ⇒ 均值 5.84**；而 `Order.orderChurn` **无诚实源**
    //   （`seed-derivation-specs.ts` 明写「停笔」），走 tick0 生成式 `round(hash01(...)×100)` ⇒ **均值 ≈ 50**。
    //   ⇒ 折扣项以 **8.56×** 的量程优势抵消掉了「增益只有一半」这件事：
    //      实际拉力 0.018891×5.84 = **0.110** vs 0.009445×50 = **0.472**，churn 仍胜 **4.28×**。
    //   形态：「我用『带符号净增益 > 0』当作『这一格会被需求推起来』的证据，而前者并不度量后者
    //          —— 净增益没有算进各源的实际量程。」
    //   ⛔ **不在本单靠改系数去补这 8.56×**：那等于拿一个哈希分布去标定业务模型（`orderChurn`
    //     今天就是哈希），是铁律 1.5 判据四点名的那类「信注释/信占位当真值」。
    //     真正的修法是给 `orderChurn` 一个诚实数据源（仓主已明令停笔）或由仓主定折扣档位 —— 两条都不在本单范围。
    const net = demand.edges.reduce((s, e) => s + e.gain * e.sw, 0);
    expect(
      net,
      `\`Model.demandLoad\` 的**带符号**净增益 = ${net.toFixed(6)} ≤ 0 ⇒ 该格会被夹死在域下界 0，` +
        `屏上每个型号的「需求负载」都读 0，而真值派生式给的是 21.7–232。` +
        `逐边：${demand.edges.map((e) => `${e.key}=${(e.gain * e.sw).toFixed(6)}`).join(" ")}`,
    ).toBeGreaterThan(0);

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
    const over = [...cells.entries()]
      .filter(([, v]) => v.knee && v.sum > 0.75 + 1e-9)
      .map(([k]) => k)
      .sort();
    // 红了的时候把**全表**打出来：只报集合差不报数值，下一个人还得自己再跑一遍才知道差多少。
    const table = [...cells.entries()]
      .sort((a, b) => b[1].sum - a[1].sum)
      .map(([k, v]) => `${k} ${v.sum.toFixed(4)} (${(v.sum / 0.75).toFixed(2)}×)${v.knee ? "" : " [无拐点·不受预算]"}`)
      .join("\n  ");
    expect(
      over,
      `超预算格子集合变了 —— 新增即回归，减少即有人改了标定，两种都必须先解释。\n  全表现值：\n  ${table}`,
    ).toEqual([
      // ── WO-GAIN-REACH 逐格判定（真起数据实测，逐边读数见 `docs/evidence/wo-gain-reach/`）────
      // ⚠ 派单原文「**全是** λ=0.37 的压力族，且**都不是单边超标、是多边合计**」——
      //   λ 那半对（5 格都是 0.37），**「多边合计」那半错**：下面 5 格里 **2 格是单边**。
      //   两者修法完全不同：多边合计要重分配 `f_g`；单边超的是 `Σw`，`f_g` 动它等于直接改那条边的意图增益。
      //
      // 【判据不适用·②】单边 + `actor_exposure_relative`。更要紧的是：这一格今天**在引擎眼里没有入边** ——
      //   唯一入边 `demo_customer_reaction_cut_order` 带 `reaction`，被 `sim.propagation.adversary`
      //   闸掉（demo 租户在 `features.ts` `WORLD_DARK_LAUNCH_FEATURES` 里 ⇒ 关）。
      //   ⇒ 引擎按「入度 0 = 外生输入」处理它：**不衰减**，`decayApplied` 里查无此项（回执实测）。
      //   没有入边就没有稳态增益，0.75 这把尺子量的是一条**不参与推演**的边。
      //   开关打开后它才成立，届时 1.12× 是真的（W=2.3995 × 意图 0.35）。
      "Customer.receivablePressure",        // 1.15x · 【真超标·口径】单边 `source_value_relative`，
      // W=10.1327 是**金额加权的扇入数**（150 单 / 17 客户 ≈ 8.8，按金额加权到 10.13）。
      // 意图增益 0.085 显然是**按某个假设的扇入数**反算的（0.085 × 8.82 ≈ 0.75 恰好配满）——
      // 真实扇入 10.13 ⇒ 超 15%。成因是「标定时假设的 W ≠ 实测 W」，属**口径错**这一类，
      // 合格修法 = 按实测 W 重算这一条的意图增益，⛔ 不是全表缩系数。
      "Material.shortageRisk",              // 1.67x · 【真超标】6 条边**全是 `equal_share`(Σw=1)**
      // ⇒ W 恒 1 ⇒ ΣA = Σ|g| = 1.25 是个**有意义的和**，预算对它成立，就是没人算总账。
      // 业务理由（指向正确的修法，而不是一律缩小）：这 6 个源是**同一件事的六种测法**
      // （替代料切换压力 / 供应商交付延迟 / PO 到货延迟 / 来料检验排队 / 批次库龄 / 供应商处理天数），
      // 高度相关 ⇒ 相加是**重复计数**。该合并口径或按相关性降权，不是把 6 条一起乘 0.6。
      // ⚠ 且其中 2 条的源是**哈希占位**（`alt_switch` / `inspection_queue`，判据⑤ 名单里）
      // ⇒ 这 1.67× 有一部分建立在编出来的源读数上。
      "Order.orderChurn",                   // 1.12x · 见上方【判据不适用·②】
      "Process.queuePressure",              // 1.67x · 【真超标】同 `Material.shortageRisk` 一型：
      // 3 条边 W 全 = 1（2 条 `equal_share`；`line_util` 那条 `weightRef: null` 但每个 Process 只有
      // 1 条 Line 入边 ⇒ N=1 ⇒ W 也是 1。⚠ 别照 seed 头注「null ⇒ W=N」直接读成 N>1）。
      // 业务理由：设备负荷 / 产线利用率 / 设备故障率三者同源共动，相加重复计数。
      "PurchaseOrder.expeditePressure",     // 1.33x · 【判据不适用·①】**符号被 `|·|` 吃掉了**：
      // `demo_material_shortage_to_po_expedite` 的源 `Material.shortageRisk` 实测均值 **−20.405**
      // （缺料风险为负 = 超储），这条边今天在**缓解**这一格（实际拉力 **−9.92**）。
      // 而 A 列取 `|g|` ⇒ 把它记成 +0.5 的负担 ⇒ 凑出 1.33×。
      // 全格带符号实际拉力 = **−7.36**：这一格净受缓解，不是超载。
      // ⇒ 作为「这一格会不会被推过拐点」的判据**不成立**；作为回路增益上界仍然成立（两列各管各的）。
    ].sort());

    // ── 判据③b（WO-WEIGHT-FROM-GRAPH 新增）：超预算格子的**数值**也钉死，不只钉集合 ──────
    //
    // **为什么必须加这一条**（实测逼出来的，不是补充说明）：判据③ 比的是**集合**，
    // 而集合是二值的 —— 它度量不了「**已经在集合里**的那一格又坏了几倍」。
    // 实测：把 `demo_batch_procurement_delay_to_material_shortage` 从 `equal_share`
    // 换成 `source_qty_relative`（唯一读 `MaterialBatch.qty` 的既有口径），
    // 该边 Σw 从 **1.000000000000 → 3.000000000000**（8 个 Material 目标逐个 3.0000×，
    // 全体 Σw 8 → 24），而 `Material.shortageRisk` 本来就在超预算集合里（1.67×）
    // ⇒ **集合一个字没变** ⇒ 判据③ 绿、四包 42/42 全绿，一个 3 倍的量级错就这么进了正线。
    //
    // 形态（照铁律 0.6 句式）：
    // **「我用『超预算格子集合没变』当作『没有格子变坏』的证据，而前者并不度量后者。」**
    //
    // 判据落在**每格的数**上（6 位小数），任何一条入边的 basis / 归一方向 / 系数被改动，
    // 只要挪动了这几格的合计就当场红。⛔ 别用「都变了」这种一锅断言 —— 那读不出是哪一格。
    const overValues = Object.fromEntries(
      over.map((k) => [k, Number((cells.get(k)!.sum).toFixed(6))]),
    );
    expect(
      overValues,
      "超预算格子的**合计值**变了。集合没变不代表没变坏：已在集合里的格子再坏 N 倍，集合是看不出来的。\n" +
        `  全表现值：\n  ${table}`,
    ).toEqual({
      "Customer.receivablePressure": 0.86127,
      "Material.shortageRisk": 1.249998,
      "Order.orderChurn": 0.839823,
      "Process.queuePressure": 1.249999,
      "PurchaseOrder.expeditePressure": 1,
    });

    // ══════════════════════════════════════════════════════════════════════════════
    // WO-GAIN-REACH · 判据④⑤⑥ —— **这把尺子没有算进各源的实际量程**
    //
    // ── 今天的行为 X / 应该的 Y ──────────────────────────────────────────────────
    // **X**：上面判据③ 的 `Σ|g|×W ≤ 0.75` 被当成「这一格不会被某一条边主导」的依据。
    //   但 `seed.ts` 增益预算段自己写着它的前提：「落在它以下，**全部源顶到量纲上界**时
    //   目标仍不进饱和段」—— 即它**假设 E[源] = max = 100**。
    //   真实 tick0 源读数实测跨度 **0.000 – 220.580**，还有 4 条边的源**均值为负**
    //   （`Material.shortageRisk` −20.405 = 超储，`PurchaseOrder.procurementDelay` −2.800 = 提前到货）。
    //   而 A 列取 `|g|`（绝对值）⇒ 一条**在缓解**这一格的边，被记成和加压边一样的负担。
    // **Y**：「谁主导这一格」必须**可被机器说出来**，且与「回路稳不稳」分开记。
    //
    // 🔴 **两列各有各的用处，⛔ 不许拿本段去替换判据③**：
    //   · A 列 `Σ|g|×W`  —— 与量程无关，约束的是**回路增益/稳定性**（满量程最坏情形）。
    //   · B 列 实际拉力   —— 吃今天的源读数，回答**「今天谁在推这一格」**。
    //   删掉任一列都会瞎掉一半：只看 A 会把「今天没人推」的格子报成欠账；
    //   只看 B 会在源读数恰好很小的那天，把一条真会失稳的边放过去。
    // ══════════════════════════════════════════════════════════════════════════════

    // ── 判据④（🐤 工具自证 · 缺了下面两条就都是空话）────────────────────────────────
    // 本测自己算的 `inflow` 必须**逐字节**等于引擎单拍 trace 里那条边的 `amount` 合计。
    // ⛔ 不许拿「我又算了一遍」当旁证 —— 那是同一个脑子算两次；锚点必须来自**引擎**。
    const mk = await t.app.inject({
      method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
      payload: { baseSnapshot: (await deriveSeedBaseSnapshot(t.repos, "demo")).state, scope: {} },
    });
    expect(mk.statusCode, `建会话失败：${mk.body.slice(0, 300)}`).toBeLessThan(400);
    const tickRes = await t.app.inject({
      method: "POST", url: `/a/v1/sim/sessions/${(mk.json() as { id: string }).id}/tick`,
      headers: ADMIN, payload: { n: 1 },
    });
    expect(tickRes.statusCode, `tick 失败：${tickRes.body.slice(0, 300)}`).toBeLessThan(400);
    const traceRows = (tickRes.json() as { trace?: { ruleKey: string; amount: number }[] }).trace ?? [];
    expect(traceRows.length, "🐤 单拍 trace 为空 ⇒ 一条边都没传导，下面的拉力对账是空话").toBeGreaterThan(0);
    const traceByRule = new Map<string, number>();
    for (const row of traceRows) traceByRule.set(row.ruleKey, (traceByRule.get(row.ruleKey) ?? 0) + row.amount);
    const allEdges = [...cells.values()].flatMap((v) => v.edges);
    let anchored = 0;
    for (const e of allEdges) {
      const got = traceByRule.get(e.key);
      if (got === undefined) continue; // `delayTicks>0` / 本拍没开闸 ⇒ 不是"对不上"，是"还在路上"
      expect(
        got,
        `${e.key} 的单拍传导量：引擎 trace 记 ${got}，本测算 ${e.inflow} ⇒ ` +
          `本测的拉力算法与引擎不同源（漏了 reaction hinge / decay factor / 逐对权重中的某一项），` +
          `⛔ 不许改这个期望值，该改的是上面那段算法。`,
      ).toBeCloseTo(e.inflow, 9);
      anchored += 1;
    }
    expect(anchored, "🐤 一条边都没能拿引擎 trace 锚住 ⇒ 自证失败，不许读成『算法是对的』").toBeGreaterThanOrEqual(25);

    // 🐤 出处表必须**分得出两档**：只证「标了章」不够，全盖同一个章在屏上一模一样。
    const provCount = { 实测: 0, 哈希: 0, 混: 0, 缺席: 0 };
    for (const e of allEdges) provCount[e.prov] += 1;
    expect(
      provCount.实测 > 0 && provCount.哈希 > 0,
      `源出处只有一档（${JSON.stringify(provCount)}）⇒ 它分不出真读数与哈希占位，下面的标注是装饰品`,
    ).toBe(true);

    // ── 判据⑤：**源无诚实数据源**的边，名单钉死 ─────────────────────────────────────
    // 这些边的「实际拉力」只是**当前哈希基线**，不是业务事实 —— 不许悄悄混进一个看起来同质的数里。
    // ⚠ 名单缩短 = 有人给某个源接上了诚实数据源（**好事**，改这里并在 WO 里说明）；
    //   名单变长 = **两种成因，定性相反，必须先分清再改名单**：
    //     (a) 有诚实源的格子**退回**了占位 ⇒ **回归**，先查 `recomputeDemoDerivationsAtSeed`；
    //     (b) 某个源原本盖着 "measured" 章、而那个"实测值"**根本不是实测** ⇒ 退役它是**好事**，
    //         名单变长恰恰是**病被记上账**（哈希占位至少诚实地说自己是占位）。
    //   ⚠ (b) 这一档是 2026-09-20 WO-FORECASTBIAS-RETIRE 补的 —— 原文只写了 (a)，
    //     于是「一个假的实测值」被退役时，这道门会把它误判成回归。
    //     **形态**：「我用『这一格从 measured 掉到 derived』当作『它丢了一个诚实源』的证据，
    //     而前者并不度量后者 —— 它原本那个 measured 可能就是假的。」
    // ⚠ `orderChurn` 在列：`seed-derivation-specs.ts` 段尾「⛔ orderChurn 停笔」是**仓主的裁决**，
    //   不是漏做 —— Order 上 ratio 族三个字段已各归其主，再复用就是与 `demandPressure` 字节级复制。
    const hashSourced = allEdges.filter((e) => e.prov === "哈希").map((e) => e.key).sort();
    expect(
      hashSourced,
      "「源走哈希占位」的边集合变了 —— 见上方三种成因，三种都必须先解释再改这个名单。",
    ).toEqual([
      "demo_alt_switch_to_material_shortage",       // 源 MaterialAlternative.switchPressure 无派生规格
      "demo_fg_drawdown_relieves_model_demand",     // 源 FinishedGoodsInventory.drawdownPressure 无派生规格
      // 源 Model.forecastBias —— 2026-09-20 走 (b)：原规格 `model_forecast_bias` 的分子是
      // `totalDemand − SUM(in(order_for_model).qty)`，两项同源 ⇒ **恒 0**，却盖着 "measured" 章。
      // 退役后回哈希占位（实测 6 型号 1/88/50/88/8/79）⇒ 这条全图唯一的负系数边**首次真正传导**
      // （单拍 trace 0 行 → 150 行 / −1705.848）。⛔ 别把它读成回归。
      "demo_forecast_bias_to_order_demand",
      "demo_inspection_queue_to_material_shortage", // 源 IncomingInspection.queueDays 无派生规格
      "demo_order_churn_to_line_split",             // 源 Order.orderChurn —— 仓主 2026-09-16 明令停笔
      "demo_order_churn_to_model_demand_load",      // 同上（本格就是 `Model.demandLoad`）
    ]);

    // ── 判据⑥：**A 列的头名 ≠ B 列的头名** 的格子集合钉死 ────────────────────────────
    // 这一条就是本段全部的价值：它让「今天这一格被谁主导」变成**机器说得出来**的事。
    // 实测 8 个多入边格子里 **6 个**两列头名不同 ⇒ 判据③ 回答不了「谁主导」这个问题。
    // ⚠ 集合变了不一定是坏事（源读数本就会随种子演进），但**必须先解释再改**：
    //   它同时会咬住「有人改了系数却没想到改变了主导权」这一类。
    const flipped = [...cells.entries()]
      .filter(([, v]) => v.edges.length >= 2)
      .filter(([, v]) => {
        const topA = [...v.edges].sort((a, b) => Math.abs(b.gain) * b.sw - Math.abs(a.gain) * a.sw)[0]!;
        const topB = [...v.edges].sort((a, b) => Math.abs(b.pull) - Math.abs(a.pull))[0]!;
        return topA.key !== topB.key;
      })
      .map(([k]) => k)
      .sort();
    const flipTable = [...cells.entries()]
      .filter(([, v]) => v.edges.length >= 2)
      .map(([k, v]) => {
        const topA = [...v.edges].sort((a, b) => Math.abs(b.gain) * b.sw - Math.abs(a.gain) * a.sw)[0]!;
        const topB = [...v.edges].sort((a, b) => Math.abs(b.pull) - Math.abs(a.pull))[0]!;
        return `${k}  A头名=${topA.key}(${(Math.abs(topA.gain) * topA.sw).toFixed(5)})  B头名=${topB.key}(${topB.pull.toFixed(4)}·源${topB.prov})`;
      })
      .join("\n  ");
    expect(
      flipped,
      `「A 列头名 ≠ B 列头名」的格子集合变了。\n  8 个多入边格子现值：\n  ${flipTable}`,
    ).toEqual([
      "Model.costPressure",            // A: material_price(0.42391) / B: wo_release(源 E=7.758 但 |g| 0.326)
      "Model.demandLoad",              // A: order_demand(+) / B: order_churn(哈希源 E=53.58)
      "OrderLine.splitPressure",       // A: order_demand / B: order_churn（同因）
      "Process.queuePressure",         // A: equipment_load(E=17.5) / B: line_util(E=92.0)
      "PurchaseOrder.expeditePressure",// A: balance_gap / B: material_shortage（源均值 **−20.405**，实为缓解）
      "WorkOrder.releasePressure",     // A: line_blocked(E=90.6) / B: line_util(E=92.0)，仅差 0.8%
    ]);

    // ── 判据⑦：`Model.demandLoad` 的**带符号实际拉力**今天是负的 ────────────────────
    // 上面判据①b 断言「带符号净增益 > 0」并自注「必要不充分」。本条把那个缺口量出来：
    //   净增益 **+0.194589 > 0**（判据①b 绿），而带符号实际拉力 **−1.8978 < 0**。
    // ⇒ 同一格，两把尺子给出**相反**的答案；屏上 `Model.demandLoad` 真跑 6 拍即落到域下界 0
    //   并停住（真起数据实测，6/6 个型号读 0.000）。
    // ⚠ **这一条钉的是缺口不是目标**：它转正才是修好了。⛔ 不许靠缩系数让它转正 ——
    //   `f_g` 是全格同一个乘数，缩它不改符号（上面判据①b 已记过这次实测）。
    // 🔴 病因**不是**派单里写的「两源量程差 8.56 倍」（实测 26.287 vs 53.580 = **2.038 倍**，
    //   拉力 12.3511 vs 12.5527，churn 只赢 **1.63%**）。逐跳实测的真因有两层：
    //   ① ~~`Model.forecastBias` **结构性恒 0**~~ —— ✅ **2026-09-20 已闭**（WO-FORECASTBIAS-RETIRE）。
    //      原病：`model_forecast_bias` 式子是 `(totalDemand − Σin(order_for_model).qty)/totalDemand`，
    //      而合成器里 `totalDemand` **就是**那个 Σ（6/6 个型号逐字节相等，如 4680-NCM 490412 = 490412）
    //      ⇒ 恒 0，且盖着 "measured" 章。该规格注释写的「实测 49–77」从来就是假的。
    //      处置：**退役该规格**（连同 `battery.ts` 的 `STATE_VAR_VALUE_REFS["Model|forecastBias"]`
    //      —— 两处必须同生共死，只删一处播种当场抛错）。退役后该格回哈希占位
    //      （6 型号实测 1/88/50/88/8/79），那条**全图唯一的负系数边**首次真正传导：
    //      单拍 trace **0 行 → 150 行 / −1705.848**。
    //      ⚠ **本判据⑦ 的数不因此变**：`Order.demandPressure` 的 **tick0 基线**由它自己的规格
    //      `order_demand_pressure`（demandDelta×100，实测均值 26.287）给，不由这条负边给；
    //      负边影响的是**后续拍**。别把「①已闭」读成「拉力该转正了」。
    //      ⚠ **遗留缺口（未闭）**：哈希占位 ∈ [0,100] **恒非负** ⇒ 唯一入流 `−0.6 × forecastBias`
    //      恒 ≤ 0，而 `demandPressure` 是压力族（min = restPoint = 0 硬地板）⇒ 24 拍后 6/6 读 0.000000。
    //      边注释写的「低估(−) ⇒ 需求压力上冲」那一支**仍然进不去**。要闭得给 forecastBias
    //      一个带负区间的诚实来源（改 `sim/seed-world.ts` 种子生成器），另单。
    //   ② `Order.orderChurn` 的唯一入边 `demo_customer_reaction_cut_order` 带 `reaction`，
    //      被 `sim.propagation.adversary` 闸掉（demo 租户在 `WORLD_DARK_LAUNCH_FEATURES` 里 ⇒ **关**）
    //      ⇒ 引擎眼里没有任何规则写 `orderChurn` ⇒ 按「入度 0 = 外生输入」**不衰减**
    //      ⇒ 折扣项恒为出厂值。对照实验（唯一变量 = 该开关，系数一个没动）：
    //      关臂 12 拍后 53.58→50.99（−4.8%），开臂 53.58→**14.67**（−72.6%），
    //      引擎回执 `decayApplied.orderChurn` 关臂**不在表里**、开臂 **0.37**。
    //      复跑：`node docs/evidence/wo-gain-reach/churn-exogenous.mjs`
    const demandPull = cells.get("Model.demandLoad")!.edges.reduce((s, e) => s + e.pull, 0);
    expect(
      demandPull,
      `\`Model.demandLoad\` 的带符号实际拉力 = ${demandPull.toFixed(6)}。` +
        `转正 ⇒ 缺口已修，请连同本段注释一起更新（并说明修的是①还是②）；` +
        `变得更负 ⇒ 回归。逐边：${cells.get("Model.demandLoad")!.edges.map((e) => `${e.key}=${e.pull.toFixed(4)}(源${e.prov})`).join(" ")}`,
    //
    // ── ⚠️ WO-WEIGHT-BASIS-FIELD 订正（本条数从 −1.8977932307 改成 −2.0427078656）────────
    // 上面那句「**变得更负 ⇒ 回归**」在本次**不成立**，理由是实测出来的，不是辩解：
    //
    // **改了什么**：`Model.demandLoad` 的 4 条入边里，两条库存边的分摊口径从 `equal_share`
    //   换成 `source_field_share`(field=`qtyAvailable`)。⛔ 系数一个没动、边一条没加、
    //   **Σw 仍逐目标 = 1.000000000000**（§7 那条 Σw 门在守）。变的只有"同一个型号的几行仓位之间怎么分"。
    //
    // **逐边解释（两条都能独立复算）**：`pull = 系数 × Σ_目标(组内均值) ÷ 目标数 ÷ λ`，
    //   换口径把"组内**算术**平均"换成"按 `qtyAvailable` **加权**平均"：
    //   · `demo_fg_cover_days_to_model_demand`：−0.378870 → **−0.423222**。
    //     🔴 这一条是**结构性必然**，不是标定漂移：实测 `coverDays ÷ qtyAvailable` 在**每个型号组内
    //     逐行相同到 8 位有效数字**（如 4680-NCM 四行全是 0.0005893），且组内 `dailyDemand` 取值数 = **1**
    //     ⇒ `coverDays ≡ qtyAvailable ÷ dailyDemand`，即 **coverDays 就是 qtyAvailable 换了个刻度**。
    //     拿 `qtyAvailable` 给 `coverDays` 加权 = 拿它**给自己**加权 ⇒ 加权均值 = E[X²]/E[X] ≥ E[X]，
    //     **数学上只可能变大，等号仅在各行相等时成立**。旁证（独立于上式）：加权/平均之比**随组内离散度
    //     单调**——圆柱-LFP 两行几乎相等(26177/26555) ⇒ 比值 **1.000051**；
    //     4680-NCM 离散最大(3278/40535, 12.4×) ⇒ 比值 **1.485816**。
    //     ⇒ 修前那个算术平均在**系统性低估库存缓冲**：它让一行 3278 件的仓位与一行 40535 件的
    //     **投同样一票**。修后 |pull| 变大，是缓冲项**不再被低估**，不是缺口变大。
    //   · `demo_fg_drawdown_relieves_model_demand`：−1.317379 → **−1.417941**。
    //     ⚠ 这一条**不是结构性的**，必须如实说：`drawdownPressure ÷ qtyAvailable` 组内**不恒定**
    //     （2170-NCM 三行 0.00026 / 0.00018 / 0.00146）⇒ 它与仓位大小无固定关系。
    //     实测 6 个型号里 **2 个反而变小**（4680-LFP ×0.972、圆柱-LFP ×0.995），4 个变大，净 +7.6%。
    //     成因：该边的源在**判据⑤ 的哈希占位名单**里（`drawdownPressure` 无派生规格）
    //     ⇒ 它的加权值与它的平均值**一样是建立在哈希上的**。换口径在原则上更对
    //     （大仓位该主导），但这 0.1006 的具体大小骑在一个哈希上 —— 别把它当业务事实引用。
    //
    // **独立复算**（不经本测的算法，纯手算核对）：
    //   两条不动的边合计 = −12.5527 + 12.3511；
    //   cover:  −0.00698967 × 134.420244 ÷ 6 ÷ 0.37 = −0.423222（修前用 120.333342 得 −0.378870）
    //   drawdn: −0.0083879  × 375.282112 ÷ 6 ÷ 0.37 = −1.417941（修前用 348.666667 得 −1.317379）
    //   ⇒ 修前合计 −1.897848（在册 −1.8977932307 ✓）、修后合计 −2.042763（实测 −2.0427078656 ✓）。
    //
    // **🐤 变异反证（这一条才是"新值是对的"的证据，缺了它上面全是说辞）**：
    //   把两条边的 `field` 从 `qtyAvailable` 换成 `dailyDemand`（实测**组内取值数 = 1**，即组内恒定
    //   ⇒ 按它加权等价于等份），本条断言**恢复原值 −1.8977932307 并当场转绿（实测 RC=0）**。
    //   ⇒ 这 0.1449 的差**全部**来自"按量值加权"这一件事，不来自新口径的管路、不来自任何漂移；
    //   同时它反证了 `source_field_share` 在各源等值时与 `equal_share` **逐字节等价**（RL9 可回退）。
    //
    // ⚠ **本条钉的那个缺口没有被修，也没有变性**：`Model.demandLoad` 仍被负拉力压在域下界 0，
    //   病因仍是注释里记的 ① / ②（forecastBias 哈希占位恒非负 · orderChurn 被 adversary 开关闸掉）。
    //   本单只是把**库存缓冲那两项的算法**改对了。它转正仍然是"修好了"的判据。
    ).toBeCloseTo(-2.0427078656, 6);
  }, 300000);
});

// ── M0-A11 · 解释切片（PRD-ai-sim-rev2-ground-truth §2.1 A11）────────────────────
// 只读投影：`GET /a/v1/sim/sessions/:id/explain-slice` 从**已算完**的 trace 收敛 ≤20 节点小图。
// ⛔ 与「计算范围」无关：传导引擎照走全图，切片只是事后投影，大小只影响看得懂多少。
// 判据（派单 T1+T3）：
//  ① 真推演 trace ⇒ 节点 ≤20 且 amountCoveredPct 与**手算**一致（手算 = 按文档取舍规则
//     从原始 trace 独立复算，不经过 buildExplainSlice —— 断言与实现各自算一遍，同源病见
//     本文件 live-fire 用例的「断言与实现各自独立地算同一个式子」）。
//  ② 🐤 反向金丝雀：maxNodes 超过全链节点数 ⇒ truncated:false · amountCoveredPct:100
//     （若 ① 的截断账本是假的——比如恒报截断——这里当场红）。
//  ③ 🐤 存在性金丝雀：trace 行数必须 >0（否则 ① 验的是空图，绿得毫无意义）。
//  ④ 🐤 空格金丝雀（2026-09-21 加）：问一个**没有入边**的量纲 ⇒ `targetInEdges: 0`。
//     没有这条基数，`amountCoveredPct: 100` 同时是「解释完整」和「压根没动」两句话。
// ⚠ 本用例 2026-09-21 随契约改口：`targetStateVar` **必填**（一格 = 对象 + 量纲）。
//   起因是真机实测：磷酸铁锂正极涨价后问「解释 方形-LFP」，保留的 92 条边里**成本链 0 条** ——
//   件(~2.2e4)/元(~1.4e4) 按 |amount| 恒压过压力点(~3e-3)，压力族传导必然被整条截掉。
//   修法是排序判据换成**占本格入流的比例**（无量纲），并只收写目标那一格的边。
// 实验设计：稀疏世界 = 同一型号 25 张订单各置 demandPressure:10，其余一切为零
//  ⇒ 型号的入边**恰好** 25 条（零额边不落 trace：propagation.ts `amount === 0 ⇒ continue`），
//  maxNodes=20 时父位只有 19 个 ⇒ 必然截掉 6 个，coverage 四个数全部能手算到分毫不差。
//
// ⚠ **25 张单必须从「进得了推演世界」的那批里挑** —— 2026-09-20 实测，代价是一条红。
//   原版从**原始链路表**挑（`links.list` 回的 500 条 `order_for_model` 全在里面），
//   而链路表里有大量**已完成订单**：`sim/seed-world.ts::entersSimWorld` 明令
//   `Order.status === "COMPLETED"` **不进推演世界**（已完成的单不可能被扰动），
//   于是它们既不在 `graph.objects` 里、也不在 `pairWeights` 表里，一条边都不产生。
//   实测（demo·seed 42）：`Order` 500 张 = COMPLETED 350 · IN_PRODUCTION 100 · OPEN 50
//   ⇒ 进世界 150 张；`obj_model_4680-LFP` 名下 116 张单里只有 **37** 张进得去。
//   按原版挑法，前 25 张里 13 张是 COMPLETED ⇒ 入边只有 12 条，金丝雀当场报红。
//   **那条红是对的**：它说的正是「稀疏世界的前提破了」—— 只不过破的原因是**选样**，
//   不是"有第二个写入源"。⛔ 所以修法**不是**把 25 改成 12（12 没有任何独立出处，
//   且把断言钉死在观测值上等于让这条金丝雀从此不再守任何前提）；
//   修法是**让前提重新成立**：只从真能参与传导的单里挑，25 这个数继续由我们自己播种决定。
//   成员判据走**生产唯一物化入口** `listSimWorldObjects`，⛔ 测里不另抄一份
//   `status !== "COMPLETED"` —— 那正是该函数头注点名要消灭的「第 6 份手抄」。
describe("M0-A11 解释切片（≤20 节点只读投影 + 覆盖账本）", () => {
  it("真推演 trace ⇒ 截断账本与手算一致；maxNodes 放大 ⇒ 完整（T1+T3）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await seedDemoPropagationRules(t.repos);
    await enableSim(t);

    // 取 order_for_model 链路最多的型号 + 它的 25 张订单（稀疏世界只打这 25 张）。
    const links = await t.repos.links.list("demo", (l) => l.type === "order_for_model");
    expect(links.length, "order_for_model 链路为 0 ⇒ 实验前提不成立").toBeGreaterThan(0);
    // 推演世界成员集合 —— 生产同一个入口，测里不重新判定「谁进得了世界」。
    const inWorld = new Set((await listSimWorldObjects(t.repos, "demo")).map((r) => r.obj.id));
    const byModel = new Map<string, string[]>();
    for (const l of links) {
      if (!inWorld.has(l.fromId)) continue; // 进不了世界的单不产生边，挑了也是零额
      const arr = byModel.get(l.toId);
      if (arr) arr.push(l.fromId);
      else byModel.set(l.toId, [l.fromId]);
    }
    const [modelId, orderIds] = [...byModel.entries()].sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]), // 平手按型号 id，R6 确定性
    )[0]!;
    expect(orderIds.length, `最多订单的型号只有 ${orderIds.length} 张**进得了世界的**单 < 25 ⇒ 截断实验搭不起来`).toBeGreaterThanOrEqual(25);
    const picked = orderIds.slice(0, 25);

    // 🐤 筛子非空金丝雀：这个型号名下的**原始**链路数必须**严格大于**进世界的数 ——
    //    两者相等 ⇒ `entersSimWorld` 这道筛子没生效（多半是 `status` 字段改了名），
    //    此时上面的"只从进世界的单里挑"是句空话，⛔ 不许把它读成"筛子没删东西"。
    //    实测基线：116 张原始链路 → 37 张进世界（`entersSimWorld` 头注同一条金丝雀纪律）。
    const rawForModel = links.filter((l) => l.toId === modelId).length;
    expect(
      rawForModel,
      `型号 ${modelId} 原始链路 ${rawForModel} 条 = 进世界 ${orderIds.length} 张 ⇒ ` +
        `entersSimWorld 这道筛子一张都没剔掉（字段改名？），本用例的选样前提无从谈起`,
    ).toBeGreaterThan(orderIds.length);

    // 稀疏世界：25 张订单各 10 点需求压力 + 型号清零；其余对象/变量一律不进世界（=0）。
    const baseSnapshot: Record<string, Record<string, number>> = { [modelId]: { demandLoad: 0 } };
    for (const o of picked) baseSnapshot[o] = { demandPressure: 10 };
    const sid = (await (await t.app.inject({
      method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN,
      payload: { baseSnapshot },
    })).json()).id as string;
    const tick = await t.app.inject({ method: "POST", url: `/a/v1/sim/sessions/${sid}/tick`, headers: ADMIN, payload: { n: 1 } });
    expect(tick.statusCode).toBe(200);

    // 🐤 ③ 存在性金丝雀：tick1 的持久化 trace 非空，且型号的入边恰好 = 25（多一条少一条
    //    都说明稀疏世界前提被打破了——比如又有别的规则往型号写——手算随即作废）。
    const row = await t.repos.sim.getTickState("demo", sid, 1);
    const trace = row?.trace ?? [];
    expect(trace.length, "tick1 trace 为空 ⇒ 切片验的是空图（假绿形态）").toBeGreaterThan(0);
    const inEdges = trace.filter((e) => e.toObjectId === modelId);
    expect(
      inEdges.length,
      `型号入边 ${inEdges.length} 条 ≠ 25 ⇒ 稀疏世界前提破了，手算作废。` +
        `**多**出来 ⇒ 有第二个写入源（又一条规则往 ${modelId} 写）；` +
        `**少**了 ⇒ 被打的单里有人没参与传导 —— 先查它进没进推演世界` +
        `（\`entersSimWorld\`：已完成订单不进；2026-09-20 就是这一条让入边从 25 掉到 12），` +
        `再查它的 pairWeight 是不是 0（\`source_qty_relative\` 读 Order.qty）。` +
        `⛔ 不许把这个 25 改成当天观测到的数字 —— 那等于让本金丝雀从此不再守任何前提。`,
    ).toBe(25);
    expect(inEdges.every((e) => e.ruleKey === "demo_order_demand_pressure" && Math.abs(e.amount) > 0)).toBe(true);

    // ── 手算（独立于 buildExplainSlice 的第二份实现，照文档取舍规则）────────────────
    // 同跳按 |amount| 降序、平手按 fromObjectId 字典序；目标占 1 位，父位 = maxNodes−1 = 19。
    //
    // ⚠ 2026-09-21：实现改成按**占本格入流的比例**（share = |amount| / 本格入流合计）排序，
    //   本手算仍按 |amount| —— **在本用例里两者等价且必须等价**：稀疏世界的 25 条入边
    //   全部出自同一条规则、写同一格 ⇒ 分母是同一个正数 ⇒ share 是 |amount| 的正单调变换，
    //   名次逐位相同。这正是本用例还能当"第二份实现"的前提；⛔ 哪天它不再是单格单规则，
    //   这段手算就必须一起改成 share，否则它验的是另一套取舍规则。
    const sorted = [...inEdges].sort(
      (a, b) => Math.abs(b.amount) - Math.abs(a.amount) || a.fromObjectId.localeCompare(b.fromObjectId),
    );
    const kept = sorted.slice(0, 19);
    const total = sorted.reduce((s, e) => s + Math.abs(e.amount), 0);
    const keptSum = kept.reduce((s, e) => s + Math.abs(e.amount), 0);
    expect(total, "型号入边总额 0 ⇒ 手算分母为 0，覆盖率读数无意义").toBeGreaterThan(0);
    const expectedPct = Math.round((keptSum / total) * 100 * 100) / 100;

    // ── ① 正向：maxNodes=20 ⇒ 25 父 > 19 父位 ⇒ 截断账本四个数逐一咬死 ──────────────
    // ⚠ `targetStateVar` 2026-09-21 起必填：一格 = (对象, 量纲)。本用例的 25 条入边全部
    //   出自 `demo_order_demand_pressure`，它写的是 `demandLoad` —— 问的就是这一格。
    const CELL = "demandLoad";
    const r20 = await t.app.inject({
      method: "GET", url: `/a/v1/sim/sessions/${sid}/explain-slice?targetObjectId=${encodeURIComponent(modelId)}&targetStateVar=${CELL}&tick=1&maxNodes=20`, headers: ADMIN,
    });
    expect(r20.statusCode).toBe(200);
    const s20 = r20.json() as {
      target: { objectId: string; stateVar: string };
      nodes: { objectId: string; hop: number }[];
      edges: { fromObjectId: string; toObjectId: string; amount: number }[];
      coverage: { maxNodes: number; truncated: boolean; droppedNodes: number; droppedEdges: number; targetInEdges: number; amountCoveredPct: number };
    };
    expect(s20.target).toEqual({ objectId: modelId, stateVar: CELL });
    expect(s20.nodes.length, "切片超过 20 节点 ⇒ 上限没咬住").toBeLessThanOrEqual(20);
    expect(s20.nodes.length).toBe(20); // 目标 1 + 父 19（25 个候选挤 19 个位，必然满）
    expect(s20.nodes.filter((n) => n.hop === 0).map((n) => n.objectId)).toEqual([modelId]);
    // 留下的 19 个父必须与手算的 19 个**逐一同名**（取舍规则确定性：同输入同输出）。
    expect(new Set(s20.nodes.filter((n) => n.hop === 1).map((n) => n.objectId)))
      .toEqual(new Set(kept.map((e) => e.fromObjectId)));
    expect(s20.edges.length).toBe(19);
    expect(s20.coverage).toEqual({
      maxNodes: 20,
      truncated: true,
      droppedNodes: 6,   // 25 − 19，挤不下的 6 个父
      droppedEdges: 6,   // 每个被挤掉的父带走它那条入边
      targetInEdges: 25, // 覆盖率的分母基数 —— 没有它，0/0 也报 100%（见下 ③ 空格金丝雀）
      amountCoveredPct: expectedPct, // 与手算分毫不差
    });
    // 诚实性硬判据：25 父丢 6，覆盖率**必须**明显小于 100 —— 恒报 100 就是拿残图冒充全图。
    expect(s20.coverage.amountCoveredPct).toBeLessThan(100);

    // ── ② 🐤 反向金丝雀：maxNodes=1000 > 全链节点数 ⇒ 不截断、覆盖率 100 ────────────
    const rFull = await t.app.inject({
      method: "GET", url: `/a/v1/sim/sessions/${sid}/explain-slice?targetObjectId=${encodeURIComponent(modelId)}&targetStateVar=${CELL}&tick=1&maxNodes=1000`, headers: ADMIN,
    });
    expect(rFull.statusCode).toBe(200);
    const sFull = rFull.json() as typeof s20;
    expect(sFull.nodes.length).toBe(26); // 目标 + 25 父（hop2 候选全部零额 ⇒ 链到此为止）
    expect(sFull.edges.length).toBe(25);
    expect(sFull.coverage.truncated).toBe(false);
    expect(sFull.coverage.droppedNodes).toBe(0);
    expect(sFull.coverage.droppedEdges).toBe(0);
    expect(sFull.coverage.targetInEdges).toBe(25);
    expect(sFull.coverage.amountCoveredPct).toBe(100);

    // ── ④ 🐤 空格金丝雀：`100%` 必须靠 `targetInEdges` 才读得出真假 ────────────────
    // 病（2026-09-21 真机实测，本用例是它的机器）：分母为 0 时百分比只能取 100，
    // 于是「这一格这拍根本没动」与「这一格被完整解释了」**在回包里逐字节相同**。
    // ⇒ 拿一个该型号身上**没有任何入边**的量纲来问：必须是 `targetInEdges: 0`，
    //   而不是只回一个孤零零的 `amountCoveredPct: 100`。
    // ⛔ 这条金丝雀咬的是**基数字段在不在**，不是百分比等于几 ——
    //   把它写成 `expect(pct).not.toBe(100)` 就错了：0/0 取 100 是对的，撒谎的是"只给百分比"。
    const rEmptyCell = await t.app.inject({
      method: "GET", url: `/a/v1/sim/sessions/${sid}/explain-slice?targetObjectId=${encodeURIComponent(modelId)}&targetStateVar=supplyRisk&tick=1&maxNodes=20`, headers: ADMIN,
    });
    expect(rEmptyCell.statusCode).toBe(200);
    const sEmpty = rEmptyCell.json() as typeof s20;
    expect(
      sEmpty.coverage.targetInEdges,
      "稀疏世界里只有 demandLoad 有入边；supplyRisk 这一格入边应为 0 —— " +
        "若 >0 说明切片把**别的量纲**的边算进了这一格（跨量纲混答，正是本次要修的那个病）",
    ).toBe(0);
    expect(sEmpty.edges.length).toBe(0);
    // 🐤 正样例对照：同一个回包结构，有边的那一格基数必须 >0（否则是"基数恒 0"的坏实现）。
    expect(s20.coverage.targetInEdges).toBeGreaterThan(0);

    // ── 边界：缺 targetObjectId / 缺 targetStateVar ⇒ 400 点名；空 trace ⇒ 404 不出空切片冒充 ──
    const rBad = await t.app.inject({
      method: "GET", url: `/a/v1/sim/sessions/${sid}/explain-slice?tick=1`, headers: ADMIN,
    });
    expect(rBad.statusCode).toBe(400);
    expect(JSON.stringify(rBad.json())).toContain("targetObjectId");
    // 只给对象、不给量纲 ⇒ 必须 400。这一条就是本次修复的**契约面**：
    // 旧行为（回 200 混排所有量纲）实测让「成本压力为什么变了」被答成「因为订单有数量」。
    const rNoVar = await t.app.inject({
      method: "GET", url: `/a/v1/sim/sessions/${sid}/explain-slice?targetObjectId=${encodeURIComponent(modelId)}&tick=1`, headers: ADMIN,
    });
    expect(rNoVar.statusCode, "只给对象不给量纲仍回 200 ⇒ 又在跨量纲混排").toBe(400);
    expect(JSON.stringify(rNoVar.json())).toContain("targetStateVar");
    const rEmpty = await t.app.inject({
      method: "GET", url: `/a/v1/sim/sessions/${sid}/explain-slice?targetObjectId=${encodeURIComponent(modelId)}&targetStateVar=${CELL}&tick=99&maxNodes=20`, headers: ADMIN,
    });
    expect(rEmpty.statusCode).toBe(404);
    expect(JSON.stringify(rEmpty.json())).toContain("空 trace");
  });
});
