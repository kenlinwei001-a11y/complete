import { describe, expect, it } from "vitest";
import { DecisionSchema, type Decision } from "@platform/contracts";
import { makeApp, ADMIN, debugUser, type TestApp } from "./helpers.js";
import type { AuthCtx, LinkTypeDef, ObjectTypeDef, PropertyDef } from "../src/domain.js";
import { seedDemoProcessLayer } from "../src/seed.js";

/**
 * WO-IMPACT-PROPAGATION · `POST /a/v1/simulation/impact-analysis` **接缝驱动**测试。
 *
 * ── 为什么这是接缝测试而不是两个 unit ──────────────────────────────────────
 * 本端点按 PRD `docs/PRD-enterprise-decision-twin.md:357` 拼的是**两个栈**：
 *   栈 B（`ontology-core.recompute` 的变更驱动传播） × 栈 A（`SimSession` 的世界隔离）。
 * 各测各半都能绿：栈 B 的传播早有测试（`ontology-core.test.ts`），栈 A 的世界也早有测试
 * （`sim-session.test.ts`）。**两边分开绿、缝上不通**正是本仓反复栽的那个坑。
 *
 * 故本文件的头号断言（§1）是一条**只有接缝真通才会绿**的判据：
 *   **同一处变更 · 两个只有世界态不同的世界 → 一个把 KPI 打穿底线、另一个安全。**
 * 若世界覆盖层没接上（栈 B 仍在真本体值上算），两个世界会返回**逐字节相同**的结果 ⇒ 当场红。
 * 这条断言同时咬住四个维度里最深的一条链：
 *   `Equipment.oee_current`（变更）→ `capacity_h` → `Line.capacity` → `Metric.actual` → breach 判定
 *   → 命中流程 P38(carrier=Line) / P63(carrier=Metric) → 命中锚在该指标上的 Decision。
 *
 * §2 咬的是本单的另一半交付：**四个「0」不是同一个 0**（诚实标记）。
 */

const ADMIN_CTX: AuthCtx = { tenantId: "demo", userId: "usr_demo_admin", roles: ["admin"], attributes: {} };

const enableSim = (t: TestApp, tenant = "demo") =>
  t.app.inject({
    method: "PUT",
    url: `/a/v1/tenants/${tenant}/features`,
    headers: debugUser(tenant, "admin", "admin"),
    payload: { overrides: { "sim.sandbox": true, "sim.propagation": true } },
  });

const prop = (propKey: string, opts: Partial<PropertyDef> = {}): PropertyDef => ({
  propKey,
  dataType: "number",
  isPrimaryKey: false,
  ...opts,
});

/**
 * 三层真派生链本体。**类型 key 必须是 `Line` / `Metric`** —— 它们是 65 条真流程种子里
 * P38「产能与瓶颈复核(RCCP)」/ P63「经营指标越线监控」声明的 `carrierTypeKey`
 * （`src/seed.ts:632` / `:671`）。这就是流程维的连接键：拿真种子对，不自造流程行。
 */
async function seedImpactOntology(t: TestApp, ctx = ADMIN_CTX): Promise<void> {
  const types: Omit<ObjectTypeDef, "id" | "tenantId" | "version" | "status">[] = [
    {
      key: "Equipment",
      displayName: "设备",
      properties: [prop("equipId", { dataType: "string", isPrimaryKey: true }), prop("oee_current"), prop("capacity_h")],
      derivedProperties: [],
      sourceBindings: [],
    },
    {
      key: "Line",
      displayName: "产线",
      properties: [prop("lineId", { dataType: "string", isPrimaryKey: true }), prop("capacity")],
      derivedProperties: [],
      sourceBindings: [],
    },
    {
      // KPI 承载类型。判据是**结构**（同时有 target/actual），不是这个名字——引擎侧不写死 "Metric"（R14）。
      key: "Metric",
      displayName: "经营指标",
      properties: [
        prop("metricId", { dataType: "string", isPrimaryKey: true }),
        prop("key", { dataType: "string" }),
        prop("name", { dataType: "string" }),
        prop("unit", { dataType: "string" }),
        prop("target"),
        prop("actual"),
        prop("floorVal"),
      ],
      derivedProperties: [],
      sourceBindings: [],
    },
  ];
  for (const ty of types) await t.services.ontology.upsertType(ctx, ty);
  const links: Omit<LinkTypeDef, "id" | "tenantId" | "version">[] = [
    { key: "使用于", fromTypeKey: "Equipment", toTypeKey: "Line", cardinality: "N:N" },
    { key: "指标来源", fromTypeKey: "Line", toTypeKey: "Metric", cardinality: "1:N" },
  ];
  for (const lt of links) await t.services.ontology.upsertLinkType(ctx, lt);
  await t.services.ontology.publishVersion(ctx);
}

const SPECS = [
  { specKey: "equip_capacity_h", targetType: "Equipment", targetProp: "capacity_h", formula: "this.oee_current * 1000" },
  { specKey: "line_capacity", targetType: "Line", targetProp: "capacity", formula: "SUM(in(使用于).capacity_h)" },
  { specKey: "metric_actual", targetType: "Metric", targetProp: "actual", formula: "SUM(in(指标来源).capacity)" },
];

const link = (t: TestApp, type: string, fromId: string, toId: string) =>
  t.repos.links.put({
    id: `lnk_${type}_${fromId}_${toId}`.replace(/[^\w-]/g, "_"),
    tenantId: "demo",
    type,
    fromId,
    toId,
    origin: { type: "MANUAL" },
  });

/**
 * 真物化 + 真跑一遍非 dryRun recompute 落基线值。
 * 基线：E1.capacity_h=800 · E2.capacity_h=500 · L1.capacity=1300 · M1.actual=1300（floorVal=1200 ⇒ SAFE）。
 */
async function buildObjects(t: TestApp): Promise<void> {
  const epoch = await t.services.ontologyCore.beginEpoch("demo");
  const up = (type: string, key: string, props: Record<string, unknown>) =>
    t.services.ontologyCore.upsertObject(ADMIN_CTX, type, key, props, { epoch });
  await up("Equipment", "E1", { equipId: "E1", oee_current: 0.8 });
  await up("Equipment", "E2", { equipId: "E2", oee_current: 0.5 });
  await up("Line", "L1", { lineId: "L1" });
  await up("Metric", "M1", { metricId: "M1", key: "capacity_attain", name: "产能达成", unit: "台/时", target: 2000, floorVal: 1200 });
  await link(t, "使用于", "obj_Equipment_E1", "obj_Line_L1");
  await link(t, "使用于", "obj_Equipment_E2", "obj_Line_L1");
  await link(t, "指标来源", "obj_Line_L1", "obj_Metric_M1");
  await t.services.ontologyCore.compileSpecs(ADMIN_CTX, 1, SPECS);
  // 非 dryRun：把基线派生值真正落到对象上（否则 before 全是 undefined，测的就不是「变更前后」）。
  await t.services.ontologyCore.recompute(ADMIN_CTX, [
    { typeKey: "Equipment", prop: "oee_current", objectIds: ["obj_Equipment_E1", "obj_Equipment_E2"] },
  ]);
}

/** 建一个世界（栈 A），态由入参给定。 */
async function makeWorld(t: TestApp, baseSnapshot: Record<string, Record<string, number>>): Promise<string> {
  const r = await t.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: ADMIN, payload: { baseSnapshot } });
  expect(r.statusCode).toBe(201);
  return r.json().id as string;
}

const analyze = (t: TestApp, worldId: string, change: Record<string, unknown>, headers = ADMIN) =>
  t.app.inject({ method: "POST", url: "/a/v1/simulation/impact-analysis", headers, payload: { worldId, change } });

/** 把 E1 的 oee 从 0.8 打到 0.2 ⇒ capacity_h 800→200。 */
const CHANGE = { objectType: "Equipment", objectId: "obj_Equipment_E1", prop: "oee_current", value: 0.2 };

/** 台账里放一条锚在 `capacity_attain` 上的真形状决策（经 DecisionSchema.parse，不是裸对象）。 */
async function seedDecision(t: TestApp, metricKey: string): Promise<string> {
  const d: Decision = DecisionSchema.parse({
    id: "dec_test_capacity",
    tenantId: "demo",
    metricKey,
    factorId: "cf-equip-oee",
    rootRef: {
      solverKey: "gap_attribution",
      metricKey,
      factorId: "cf-equip-oee",
      rootMetric: { key: metricKey, name: "产能达成", unit: "台/时", gap: -700 },
      residualPct: 0.05,
      topBase: "B1",
      summary: "设备 OEE 下滑主导产能缺口",
    },
    optionsRef: {
      solverKey: "decision_play",
      options: [
        {
          optionId: "opt-maint",
          factorId: "cf-equip-oee",
          label: "提前检修 E1",
          sourceKind: "solver", // DecisionSourceKindSchema = ["solver","agent"]（英文枚举，与 provenance.kind 的中文枚举不同源）
          closesGap: 400,
          cost: 120,
          cycleDays: 14,
          risk: 0.2,
          exposure: 0.1,
          reversibility: 0.8,
          provenance: { kind: "求解器", basis: "decision_play" },
        },
      ],
      recommendedPlan: {
        planId: "plan-1",
        optionIds: ["opt-maint"],
        steps: [{ phase: "即刻", action: "提前检修 E1", optionRef: "opt-maint" }],
        totalClosesGap: 400,
        totalCost: 120,
      },
    },
    chosenOptionIds: ["opt-maint"],
    actionDraftIds: ["adraft_1"],
    status: "COMMITTED",
    outcome: null,
    trace: [{ step: "root_cause", refId: "cf-equip-oee", label: "设备 OEE", provId: null }],
    decidedBy: "usr_demo_admin",
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
  });
  await t.repos.decisions.put(d);
  return d.id;
}

/** 完整装配：本体 + 对象 + 65 条真流程种子 + 一条决策 + entitlement。 */
async function fullFixture(t: TestApp): Promise<void> {
  await enableSim(t);
  await seedImpactOntology(t);
  await buildObjects(t);
  await seedDemoProcessLayer(t.repos); // 真种子（13 域 × 65 流程），不自造流程行
  await seedDecision(t, "capacity_attain");
}

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 头号接缝断言：栈 B 的传播真的跑在栈 A 的世界里
// ══════════════════════════════════════════════════════════════════════════

describe("WO-IMPACT-PROPAGATION · 接缝：栈B传播 × 栈A世界隔离", () => {
  it("🔴 同一变更 · 两个只差世界态的世界 → 一个打穿 KPI 底线、另一个安全（世界覆盖层没接上则两者字节相同 ⇒ 红）", async () => {
    const t = await makeApp();
    await fullFixture(t);

    // 两个世界只差一处：E2 这台设备在世界里的 capacity_h。
    // 世界「弱」：E2 只有 100 ⇒ E1 掉到 200 后 Line=300、Metric.actual=300 < floor 1200 ⇒ 打穿。
    // 世界「强」：E2 有 3000 ⇒ E1 掉到 200 后 Line=3200、Metric.actual=3200 > floor 1200 ⇒ 安全。
    const weak = await makeWorld(t, { obj_Equipment_E2: { capacity_h: 100 } });
    const strong = await makeWorld(t, { obj_Equipment_E2: { capacity_h: 3000 } });

    const rw = await analyze(t, weak, CHANGE);
    const rs = await analyze(t, strong, CHANGE);
    expect(rw.statusCode).toBe(200);
    expect(rs.statusCode).toBe(200);
    const W = rw.json();
    const S = rs.json();

    // 世界真的叠上去了（各 1 条覆盖）——不是默默退化成「在真本体上算」。
    expect(W.basis.worldOverlayApplied).toBe(1);
    expect(S.basis.worldOverlayApplied).toBe(1);
    expect(W.basis.worldId).toBe(weak);
    expect(S.basis.worldId).toBe(strong);

    // ★ 接缝判据：同一变更，两个世界的 KPI 结论**相反**。
    const kpiW = W.affectedKpis.items.find((k: { objectId: string }) => k.objectId === "obj_Metric_M1");
    const kpiS = S.affectedKpis.items.find((k: { objectId: string }) => k.objectId === "obj_Metric_M1");
    expect(kpiW, "弱世界应命中 Metric").toBeTruthy();
    expect(kpiS, "强世界应命中 Metric").toBeTruthy();
    expect(kpiW.breach).toBe("BREACHED"); // 300 < 1200
    expect(kpiS.breach).toBe("SAFE"); // 3200 > 1200
    // 真值也必须不同（不是只有标签不同）
    const afterOf = (kpi: { changedProps: { prop: string; after: unknown }[] }) =>
      kpi.changedProps.find((p) => p.prop === "actual")?.after;
    expect(afterOf(kpiW)).toBe(300);
    expect(afterOf(kpiS)).toBe(3200);
    // 若世界覆盖层没接线，下面这条会相等 ⇒ 整测红（这就是「只有接缝真通才会绿」的那一行）
    expect(JSON.stringify(W.affectedKpis)).not.toBe(JSON.stringify(S.affectedKpis));
  });

  it("四维一次返齐：objects/kpis/processes/decisions 全部由同一次传播派生，且带全域基数 universe", async () => {
    const t = await makeApp();
    await fullFixture(t);
    const world = await makeWorld(t, { obj_Equipment_E2: { capacity_h: 100 } });
    const res = await analyze(t, world, CHANGE);
    expect(res.statusCode).toBe(200);
    const b = res.json();

    // 口径与引擎单源声明（防第三套口径）
    expect(b.basis.engine).toBe("ontology-core.recompute");
    expect(b.basis.countBasis).toBe("DISTINCT_OBJECTS");
    expect(b.basis.derivationSpecCount).toBe(3);
    expect(b.basis.kpiTypeKeys).toEqual(["Metric"]); // 结构判定（target+actual）恰好只选中 Metric

    // ① 对象：E1 → L1 → M1 三层闭包全在
    const objIds = b.affectedObjects.items.map((x: { objectId: string }) => x.objectId);
    expect(objIds).toContain("obj_Equipment_E1");
    expect(objIds).toContain("obj_Line_L1");
    expect(objIds).toContain("obj_Metric_M1");
    expect(b.affectedObjects.count).toBe(objIds.length);
    expect(b.affectedObjects.universe).toBe(4); // E1/E2/L1/M1

    // ④ KPI：1 个，且 universe=1（本体里一共就 1 个 Metric 对象）
    expect(b.affectedKpis.available).toBe(true);
    expect(b.affectedKpis.count).toBe(1);
    expect(b.affectedKpis.universe).toBe(1);
    expect(b.affectedKpis.items[0].metricKey).toBe("capacity_attain");

    // ② 流程：命中 P38(carrier=Line) 与 P63(carrier=Metric)，全域 65 条真种子
    expect(b.affectedProcesses.available).toBe(true);
    expect(b.affectedProcesses.universe).toBe(65);
    const pkeys = b.affectedProcesses.items.map((x: { processKey: string }) => x.processKey);
    expect(pkeys).toContain("P38"); // 产能与瓶颈复核（RCCP）· carrierTypeKey=Line
    expect(pkeys).toContain("P63"); // 经营指标越线监控 · carrierTypeKey=Metric
    expect(b.affectedProcesses.items.find((x: { processKey: string }) => x.processKey === "P63").viaObjectIds).toEqual([
      "obj_Metric_M1",
    ]);

    // ③ 决策：锚在 capacity_attain 上的那条被命中，且能下钻到具体 KPI 对象
    expect(b.affectedDecisions.available).toBe(true);
    expect(b.affectedDecisions.count).toBe(1);
    expect(b.affectedDecisions.universe).toBe(1);
    expect(b.affectedDecisions.items[0].decisionId).toBe("dec_test_capacity");
    expect(b.affectedDecisions.items[0].viaKpiObjectIds).toEqual(["obj_Metric_M1"]);
    expect(b.affectedDecisions.items[0].actionDraftCount).toBe(1); // 已派行动 ⇒ 变更波及在执行的决策
  });

  // ── 🔴 那个「不可用维」的诚实标记（工单 §3/§4 点名要断言的那条）────────────
  it("🔴 流程维：definition 粒度可用，**instance 粒度诚实报不可用**（绝不用 count:0 冒充「没有实例受阻」）", async () => {
    const t = await makeApp();
    await fullFixture(t);
    const world = await makeWorld(t, { obj_Equipment_E2: { capacity_h: 100 } });
    const b = (await analyze(t, world, CHANGE)).json();

    expect(b.affectedProcesses.available).toBe(true); // 定义粒度真能算
    expect(b.affectedProcesses.count).toBeGreaterThan(0);
    // 实例粒度：显式 available:false + 原因 + 缺的承载物名（可 grep 验证，不是「信我」）
    expect(b.affectedProcesses.instanceLevel.available).toBe(false);
    expect(b.affectedProcesses.instanceLevel.missingCarrier).toBe("ProcessInstance");
    expect(b.affectedProcesses.instanceLevel.reason).toMatch(/ProcessInstance/);
    expect(b.affectedProcesses.instanceLevel.reason).toMatch(/WAITING|owner|assignee/);
    // 反向锁死：不许有 instanceCount 这类字段悄悄回来冒充实例数
    expect(b.affectedProcesses.instanceLevel.count).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// § 2 · 诚实性：四个「0」不是同一个 0
// ══════════════════════════════════════════════════════════════════════════

describe("WO-IMPACT-PROPAGATION · 诚实标记（禁止用 0 冒充「查过了没影响」）", () => {
  it("台账为空 ≠ 已有决策都不受影响：count=0 必须同时给 universe=0 + 明说「一条都还没建」的 warning", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedImpactOntology(t);
    await buildObjects(t);
    await seedDemoProcessLayer(t.repos);
    // 故意不建任何 Decision
    const world = await makeWorld(t, { obj_Equipment_E2: { capacity_h: 100 } });
    const b = (await analyze(t, world, CHANGE)).json();

    expect(b.affectedDecisions.available).toBe(true); // 承载物在（Decision 台账存在）
    expect(b.affectedDecisions.count).toBe(0);
    expect(b.affectedDecisions.universe).toBe(0); // ← 靠它把「台账空」与「有 N 条一条没中」分开
    expect(b.warnings.some((w: string) => w.includes("决策台账为空"))).toBe(true);
  });

  it("无 KPI 承载物 → affectedKpis 报 available:false，且决策维**诚实传染**（连接键没了就别假装能算）", async () => {
    const t = await makeApp();
    await enableSim(t);
    // 只建 Equipment（无任何同时具备 target/actual 的类型）
    await t.services.ontology.upsertType(ADMIN_CTX, {
      key: "Equipment",
      displayName: "设备",
      properties: [prop("equipId", { dataType: "string", isPrimaryKey: true }), prop("oee_current"), prop("capacity_h")],
      derivedProperties: [],
      sourceBindings: [],
    });
    await t.services.ontology.publishVersion(ADMIN_CTX);
    const epoch = await t.services.ontologyCore.beginEpoch("demo");
    await t.services.ontologyCore.upsertObject(ADMIN_CTX, "Equipment", "E1", { equipId: "E1", oee_current: 0.8 }, { epoch });
    await t.services.ontologyCore.compileSpecs(ADMIN_CTX, 1, [SPECS[0]!]);

    const world = await makeWorld(t, {});
    const b = (await analyze(t, world, CHANGE)).json();

    expect(b.basis.kpiTypeKeys).toEqual([]);
    expect(b.affectedKpis.available).toBe(false);
    expect(b.affectedKpis.missingCarrier).toBe("ObjectType(target+actual)");
    expect(b.affectedKpis.count).toBeUndefined(); // 不可用维不许带 count
    // 决策的连接键来自 KPI ⇒ KPI 算不了，决策也必须报算不了，而不是返 0
    expect(b.affectedDecisions.available).toBe(false);
    expect(b.affectedDecisions.count).toBeUndefined();
  });

  it("未播种流程层 → affectedProcesses 报 available:false + missingCarrier=ProcessDefinition（不返 count:0）", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedImpactOntology(t);
    await buildObjects(t);
    // 故意不跑 seedDemoProcessLayer
    const world = await makeWorld(t, {});
    const b = (await analyze(t, world, CHANGE)).json();
    expect(b.affectedProcesses.available).toBe(false);
    expect(b.affectedProcesses.missingCarrier).toBe("ProcessDefinition");
    expect(b.affectedProcesses.count).toBeUndefined();
  });

  it("世界态为空 / 本体无派生边 → 各出一条 warning 说明是「算不了」而非「没影响」", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedImpactOntology(t);
    await buildObjects(t);
    const emptyWorld = await makeWorld(t, {}); // baseSnapshot 为空
    const b = (await analyze(t, emptyWorld, CHANGE)).json();
    expect(b.basis.worldOverlayApplied).toBe(0);
    expect(b.warnings.some((w: string) => w.includes("未发生世界隔离"))).toBe(true);

    // 另起一个租户：有世界但零派生规格 ⇒ 闭包必空，必须说明是算不了
    const t2 = await makeApp();
    await enableSim(t2, "nospec");
    const H = debugUser("nospec", "admin", "admin");
    const w2 = (
      await t2.app.inject({ method: "POST", url: "/a/v1/sim/sessions", headers: H, payload: { baseSnapshot: { x: { v: 1 } } } })
    ).json().id as string;
    const r2 = await t2.app.inject({
      method: "POST",
      url: "/a/v1/simulation/impact-analysis",
      headers: H,
      payload: { worldId: w2, change: CHANGE },
    });
    const b2 = r2.json();
    expect(b2.basis.derivationSpecCount).toBe(0);
    expect(b2.warnings.some((w: string) => w.includes("derivationSpecs=0"))).toBe(true);
    expect(b2.affectedObjects.count).toBe(0);
  });

  it("变更目标对象不存在 → warning 明说是「找不到起点」而非「没影响」", async () => {
    const t = await makeApp();
    await fullFixture(t);
    const world = await makeWorld(t, {});
    const b = (
      await analyze(t, world, { objectType: "Equipment", objectId: "obj_Equipment_GHOST", prop: "oee_current", value: 0.1 })
    ).json();
    expect(b.warnings.some((w: string) => w.includes("找不到起点"))).toBe(true);
    expect(b.affectedObjects.count).toBe(0);
  });

  it("KPI 缺 floorVal → breach 报 UNKNOWN，不许当成 SAFE", async () => {
    const t = await makeApp();
    await enableSim(t);
    await seedImpactOntology(t);
    const epoch = await t.services.ontologyCore.beginEpoch("demo");
    const up = (type: string, key: string, props: Record<string, unknown>) =>
      t.services.ontologyCore.upsertObject(ADMIN_CTX, type, key, props, { epoch });
    await up("Equipment", "E1", { equipId: "E1", oee_current: 0.8 });
    await up("Line", "L1", { lineId: "L1" });
    await up("Metric", "M1", { metricId: "M1", key: "no_floor", name: "无底线指标", unit: "台", target: 2000 }); // ← 无 floorVal
    await link(t, "使用于", "obj_Equipment_E1", "obj_Line_L1");
    await link(t, "指标来源", "obj_Line_L1", "obj_Metric_M1");
    await t.services.ontologyCore.compileSpecs(ADMIN_CTX, 1, SPECS);
    await t.services.ontologyCore.recompute(ADMIN_CTX, [
      { typeKey: "Equipment", prop: "oee_current", objectIds: ["obj_Equipment_E1"] },
    ]);
    const world = await makeWorld(t, {});
    const b = (await analyze(t, world, CHANGE)).json();
    expect(b.affectedKpis.items[0].breach).toBe("UNKNOWN");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// § 3 · 不变量（R2 / R3 / R4 / R6）
// ══════════════════════════════════════════════════════════════════════════

describe("WO-IMPACT-PROPAGATION · 不变量", () => {
  it("R2 跨租户：拿别租户的 worldId → 404（暗发语义，不是 403）+ 统一错误信封", async () => {
    const t = await makeApp();
    await fullFixture(t);
    const world = await makeWorld(t, { obj_Equipment_E2: { capacity_h: 100 } });
    await enableSim(t, "otherco");
    const r = await analyze(t, world, CHANGE, debugUser("otherco", "admin", "admin"));
    expect(r.statusCode).toBe(404);
    const e = r.json().error;
    expect(e.code).toBe("NOT_FOUND");
    expect(typeof e.message).toBe("string");
    expect(typeof e.requestId).toBe("string"); // { error: { code, message, requestId } }
  });

  it("R3 entitlement 先于 authz：sim.sandbox 关 → 404 FEATURE_NOT_FOUND", async () => {
    const t = await makeApp();
    const r = await t.app.inject({
      method: "POST",
      url: "/a/v1/simulation/impact-analysis",
      headers: debugUser("freshco", "admin", "admin"),
      payload: { worldId: "whatever", change: CHANGE },
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe("FEATURE_NOT_FOUND");
  });

  it("R4 无副作用：跑完后全量对象快照字节级一致（dryRun 不落库）", async () => {
    const t = await makeApp();
    await fullFixture(t);
    const world = await makeWorld(t, { obj_Equipment_E2: { capacity_h: 100 } });
    const before = JSON.stringify(await t.repos.objects.list("demo"));
    await analyze(t, world, CHANGE);
    expect(JSON.stringify(await t.repos.objects.list("demo"))).toBe(before);
  });

  it("R6 确定性：同 (worldId, change) 连跑两次 → 响应体字节级一致", async () => {
    const t = await makeApp();
    await fullFixture(t);
    const world = await makeWorld(t, { obj_Equipment_E2: { capacity_h: 100 } });
    const a = (await analyze(t, world, CHANGE)).body;
    const b = (await analyze(t, world, CHANGE)).body;
    expect(a).toBe(b);
  });

  it("oldValue 只回显不参与计算：报错的旧值不改结果，只翻 oldValueMismatch", async () => {
    const t = await makeApp();
    await fullFixture(t);
    const world = await makeWorld(t, { obj_Equipment_E2: { capacity_h: 100 } });
    const truthful = (await analyze(t, world, { ...CHANGE, oldValue: 0.8 })).json();
    const lying = (await analyze(t, world, { ...CHANGE, oldValue: 0.123 })).json();
    expect(truthful.basis.oldValueMismatch).toBe(false);
    expect(truthful.basis.observedOldValue).toBe(0.8);
    expect(lying.basis.oldValueMismatch).toBe(true); // 如实标注不一致
    expect(lying.basis.observedOldValue).toBe(0.8); // 世界里的真旧值不被调用方改写
    // 结果不受 oldValue 影响（否则调用方就能伪造基线）
    expect(JSON.stringify(truthful.affectedKpis)).toBe(JSON.stringify(lying.affectedKpis));
  });
});
