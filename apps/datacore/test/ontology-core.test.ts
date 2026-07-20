import { describe, expect, it } from "vitest";
import { makeApp, invokeSolver, type TestApp } from "./helpers.js";
import type { AuthCtx, LinkTypeDef, ObjectInstance, ObjectTypeDef, PropertyDef } from "../src/domain.js";
import { CyclicDerivationError } from "../src/ontology-core.js";
import { SOLVER_KEYS, SOLVER_OUTPUT_SHAPES } from "../src/solvers/service.js";
import { parseFormula, extractDeps, evaluate, decimalRound } from "../src/ontology-dsl.js";

const ADMIN_CTX: AuthCtx = { tenantId: "demo", userId: "usr_demo_admin", roles: ["admin"], attributes: {} };
const BM_CTX: AuthCtx = {
  tenantId: "demo",
  userId: "usr_bm",
  roles: ["base_manager:常州"],
  attributes: { baseScope: ["B1"] },
};

/**
 * Capacity-pyramid fixture (§2.2): Factory ← (归属基地) Process; Line → (包含工序) Process;
 * Process ← (使用于) Equipment. We model:
 *   Equipment.capacity_h = IF(this.takt>0, 3600/this.takt*this.availFactor*this.oee_current, 0)
 *   Process.capacity     = SUM(in(使用于).capacity_h) * this.yield_baseline
 *   Line.capacity        = SUM(out(包含工序).capacity)
 *   Factory.capacity     = SUM(in(归属基地).capacity)   (Line 归属 Factory)
 */
async function seedPyramid(t: TestApp, ctx = ADMIN_CTX): Promise<void> {
  const prop = (propKey: string, opts: Partial<PropertyDef> = {}): PropertyDef => ({
    propKey,
    dataType: "number",
    isPrimaryKey: false,
    ...opts,
  });
  const types: Omit<ObjectTypeDef, "id" | "tenantId" | "version" | "status">[] = [
    {
      key: "Equipment",
      displayName: "设备",
      properties: [
        prop("equipId", { dataType: "string", isPrimaryKey: true }),
        prop("takt"),
        prop("availFactor"),
        prop("oee_current", { temporal: true }),
        prop("capacity_h"),
      ],
      derivedProperties: [],
      sourceBindings: [],
    },
    {
      key: "Process",
      displayName: "工序",
      properties: [prop("processId", { dataType: "string", isPrimaryKey: true }), prop("yield_baseline"), prop("capacity")],
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
      key: "Factory",
      displayName: "工厂",
      properties: [prop("factoryId", { dataType: "string", isPrimaryKey: true }), prop("capacity")],
      derivedProperties: [],
      sourceBindings: [],
    },
  ];
  for (const ty of types) await t.services.ontology.upsertType(ctx, ty);
  const links: Omit<LinkTypeDef, "id" | "tenantId" | "version">[] = [
    // 设备「使用于」工序：from=Equipment to=Process ⇒ Process 用 in(使用于) 解到 Equipment（fromType）
    { key: "使用于", fromTypeKey: "Equipment", toTypeKey: "Process", cardinality: "N:N" },
    // 产线「包含工序」：from=Line to=Process ⇒ Line 用 out(包含工序) 解到 Process（toType）
    { key: "包含工序", fromTypeKey: "Line", toTypeKey: "Process", cardinality: "1:N" },
    // 产线「归属基地」工厂：from=Line to=Factory ⇒ Factory 用 in(归属基地) 解到 Line（fromType）
    { key: "归属基地", fromTypeKey: "Line", toTypeKey: "Factory", cardinality: "1:N" },
  ];
  for (const lt of links) await t.services.ontology.upsertLinkType(ctx, lt);
  await t.services.ontology.publishVersion(ctx);
}

async function putObj(
  t: TestApp,
  type: string,
  key: string,
  props: Record<string, unknown>,
  epoch: number,
): Promise<ObjectInstance> {
  return t.services.ontologyCore.upsertObject(ADMIN_CTX, type, key, props, { epoch });
}

async function link(t: TestApp, type: string, fromId: string, toId: string): Promise<void> {
  await t.repos.links.put({
    id: `lnk_${type}_${fromId}_${toId}`.replace(/[^\w-]/g, "_"),
    tenantId: "demo",
    type,
    fromId,
    toId,
    origin: { type: "MANUAL" },
  });
}

async function buildPyramidObjects(t: TestApp): Promise<void> {
  const epoch = await t.services.ontologyCore.beginEpoch("demo");
  // 1 factory, 1 line, 2 processes, 2 equipment per process
  await putObj(t, "Factory", "F1", { factoryId: "F1" }, epoch);
  await putObj(t, "Line", "L1", { lineId: "L1" }, epoch);
  await putObj(t, "Process", "P1", { processId: "P1", yield_baseline: 0.95 }, epoch);
  await putObj(t, "Process", "P2", { processId: "P2", yield_baseline: 0.9 }, epoch);
  await putObj(t, "Equipment", "E1", { equipId: "E1", takt: 2, availFactor: 0.9, oee_current: 0.8 }, epoch);
  await putObj(t, "Equipment", "E2", { equipId: "E2", takt: 3, availFactor: 0.85, oee_current: 0.75 }, epoch);
  await putObj(t, "Equipment", "E3", { equipId: "E3", takt: 2.5, availFactor: 0.88, oee_current: 0.82 }, epoch);
  // links (from→to per link type direction)
  await link(t, "归属基地", "obj_Line_L1", "obj_Factory_F1"); // Line 归属基地 Factory
  await link(t, "包含工序", "obj_Line_L1", "obj_Process_P1"); // Line 包含工序 Process
  await link(t, "包含工序", "obj_Line_L1", "obj_Process_P2");
  await link(t, "使用于", "obj_Equipment_E1", "obj_Process_P1"); // Equipment 使用于 Process
  await link(t, "使用于", "obj_Equipment_E2", "obj_Process_P1");
  await link(t, "使用于", "obj_Equipment_E3", "obj_Process_P2");
}

const PYRAMID_SPECS = [
  {
    specKey: "equip_capacity_h",
    targetType: "Equipment",
    targetProp: "capacity_h",
    formula: "IF(this.takt > 0, 3600 / this.takt * this.availFactor * this.oee_current, 0)",
  },
  {
    specKey: "process_capacity",
    targetType: "Process",
    targetProp: "capacity",
    formula: "SUM(in(使用于).capacity_h) * this.yield_baseline",
  },
  { specKey: "line_capacity", targetType: "Line", targetProp: "capacity", formula: "SUM(out(包含工序).capacity)" },
  { specKey: "factory_capacity", targetType: "Factory", targetProp: "capacity", formula: "SUM(in(归属基地).capacity)" },
];

describe("O1–O10 本体原子规格", () => {
  it("O1 DDL: (tenant,type,object_key) upsert 语义 + epoch 批内一致单调", async () => {
    const t = await makeApp();
    await seedPyramid(t);
    const e1 = await t.services.ontologyCore.beginEpoch("demo");
    const a = await putObj(t, "Equipment", "E1", { equipId: "E1", takt: 2 }, e1);
    const b = await putObj(t, "Equipment", "E1", { equipId: "E1", availFactor: 0.9 }, e1);
    // same business key → same id → upsert (merge), not a new row
    expect(b.id).toBe(a.id);
    const all = await t.repos.objects.listByType("demo", "Equipment");
    expect(all).toHaveLength(1);
    expect(all[0]!.props.takt).toBe(2); // preserved
    expect(all[0]!.props.availFactor).toBe(0.9); // merged
    expect(all[0]!.epoch).toBe(e1); // batch epoch
    // epoch monotonic across batches
    const e2 = await t.services.ontologyCore.beginEpoch("demo");
    expect(e2).toBe(e1 + 1);
  });

  it("O2 DSL 解析 + deps 提取（§2.2 公式 AST 与人工标注一致）", async () => {
    const t = await makeApp();
    await seedPyramid(t);
    const out = await t.services.ontologyCore.compileSpecs(ADMIN_CTX, 1, PYRAMID_SPECS);
    const byKey = new Map(out.specs.map((s) => [s.specKey, s]));
    // equip: only own props
    expect(byKey.get("equip_capacity_h")!.deps.sort((a, b) => a.prop.localeCompare(b.prop))).toEqual(
      [
        { typeKey: "Equipment", prop: "availFactor" },
        { typeKey: "Equipment", prop: "oee_current" },
        { typeKey: "Equipment", prop: "takt" },
      ].sort((a, b) => a.prop.localeCompare(b.prop)),
    );
    // process: own yield + navigated equipment.capacity_h via 使用于/in
    expect(byKey.get("process_capacity")!.deps).toEqual(
      expect.arrayContaining([
        { typeKey: "Process", prop: "yield_baseline" },
        { typeKey: "Equipment", prop: "capacity_h", via: "使用于", direction: "in" },
      ]),
    );
    // line: navigated process.capacity via 包含工序/out
    expect(byKey.get("line_capacity")!.deps).toEqual([
      { typeKey: "Process", prop: "capacity", via: "包含工序", direction: "out" },
    ]);
    // direct unit test of extractDeps with explicit link resolver
    const ast = parseFormula("SUM(in(使用于).capacity_h, WHERE kind == \"serial\")");
    const deps = extractDeps(ast, "Process", () => "Equipment");
    expect(deps).toEqual(
      expect.arrayContaining([
        { typeKey: "Equipment", prop: "capacity_h", via: "使用于", direction: "in" },
        { typeKey: "Equipment", prop: "kind", via: "使用于", direction: "in" },
      ]),
    );
  });

  it("O3 环拒绝：A.x→B.y→A.x → CYCLIC_DERIVATION + 环路径", async () => {
    const t = await makeApp();
    await seedPyramid(t);
    const cyclic = [
      { specKey: "p_cap", targetType: "Process", targetProp: "capacity", formula: "SUM(in(使用于).capacity_h)" },
      { specKey: "e_cap", targetType: "Equipment", targetProp: "capacity_h", formula: "AVG(out(使用于).capacity)" },
    ];
    // 使用于 from=Process to=Equipment: out(使用于) from Equipment side resolves to Process via fromType
    // Build the cycle explicitly: Equipment.capacity_h depends on Process.capacity (via out=Process? no).
    // We instead test the generic graph: two specs referencing each other.
    let err: unknown;
    try {
      await t.services.ontologyCore.compileSpecs(ADMIN_CTX, 1, cyclic);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CyclicDerivationError);
    const ce = err as CyclicDerivationError;
    expect(ce.code).toBe("CYCLIC_DERIVATION");
    expect(ce.cycle.length).toBeGreaterThan(0);
    expect(ce.cycle.join("→")).toContain("Process.capacity");
    expect(ce.cycle.join("→")).toContain("Equipment.capacity_h");
  });

  it("O4 增量重算最小集：改 1 设备 OEE → 仅其工序/产线/工厂链重算 + inputs 可回链", async () => {
    const t = await makeApp();
    await seedPyramid(t);
    await buildPyramidObjects(t);
    await t.services.ontologyCore.compileSpecs(ADMIN_CTX, 1, PYRAMID_SPECS);
    // full initial compute
    const seedChange: { typeKey: string; prop: string; objectIds: string[] }[] = [
      { typeKey: "Equipment", prop: "oee_current", objectIds: ["obj_Equipment_E1", "obj_Equipment_E2", "obj_Equipment_E3"] },
    ];
    await t.services.ontologyCore.recompute(ADMIN_CTX, seedChange);
    // perturb a single equipment's OEE and recompute its delta only
    const e1 = (await t.repos.objects.get("demo", "obj_Equipment_E1"))!;
    e1.props.oee_current = 0.5;
    await t.repos.objects.put(e1);
    const res = await t.services.ontologyCore.recompute(ADMIN_CTX, [
      { typeKey: "Equipment", prop: "oee_current", objectIds: ["obj_Equipment_E1"] },
    ]);
    // E1 (capacity_h), P1 (uses E1+E2), L1, F1 → 4 objects. E2/E3/P2 NOT recomputed.
    expect(new Set(res.affectedObjectIds)).toEqual(
      new Set(["obj_Equipment_E1", "obj_Process_P1", "obj_Line_L1", "obj_Factory_F1"]),
    );
    expect(res.affectedObjectIds).not.toContain("obj_Equipment_E2");
    expect(res.affectedObjectIds).not.toContain("obj_Process_P2");
    // derivation_value_runs inputs are traceable back to the source objects
    const runs = await t.repos.derivationValueRuns.list("demo", (r) => r.objectId === "obj_Process_P1");
    const last = runs.sort((a, b) => (a.ranAt < b.ranAt ? 1 : -1))[0]!;
    expect(last.inputs.some((i) => i.objectId === "obj_Equipment_E1" && i.prop === "capacity_h")).toBe(true);
    expect(last.epoch).toBe(res.epoch);
  });

  it("O4b generic-inference 通用 what-if：dryRun 前向重算派生链 before/after，无副作用（G-5 8e）", async () => {
    const t = await makeApp();
    await seedPyramid(t);
    await buildPyramidObjects(t);
    await t.services.ontologyCore.compileSpecs(ADMIN_CTX, 1, PYRAMID_SPECS);
    await t.services.ontologyCore.recompute(ADMIN_CTX, [
      { typeKey: "Equipment", prop: "oee_current", objectIds: ["obj_Equipment_E1", "obj_Equipment_E2", "obj_Equipment_E3"] },
    ]); // 全量初算，派生值落库

    const oeeBefore = (await t.repos.objects.get("demo", "obj_Equipment_E1"))!.props.oee_current;
    const capHBefore = (await t.repos.objects.get("demo", "obj_Equipment_E1"))!.props.capacity_h;
    const factoryBefore = (await t.repos.objects.get("demo", "obj_Factory_F1"))!.props.capacity;

    // what-if：假设 E1 的 OEE = 0.5 → 用本体派生规格前向重算 capacity_h→Process→Line→Factory（不落真值）
    const res = await t.services.ontologyCore.recompute(
      ADMIN_CTX,
      [{ typeKey: "Equipment", prop: "oee_current", objectIds: ["obj_Equipment_E1"] }],
      { dryRun: true, apply: [{ objectId: "obj_Equipment_E1", prop: "oee_current", value: 0.5 }] },
    );
    expect(res.dryRunDeltas, "返回 dryRunDeltas").toBeTruthy();
    const capH = res.dryRunDeltas!.find((d) => d.objId === "obj_Equipment_E1" && d.prop === "capacity_h");
    expect(capH, "E1 capacity_h 前向重算").toBeTruthy();
    expect(capH!.before).toBe(capHBefore);
    expect(capH!.after).not.toBe(capHBefore);
    // 级联到工厂（行业无关：纯靠派生规格 + 链路导航）
    expect(res.dryRunDeltas!.some((d) => d.objId === "obj_Factory_F1" && d.prop === "capacity")).toBe(true);

    // 无副作用（R4，dryRun 不落真值）：对象库真值不变
    expect((await t.repos.objects.get("demo", "obj_Equipment_E1"))!.props.oee_current).toBe(oeeBefore);
    expect((await t.repos.objects.get("demo", "obj_Equipment_E1"))!.props.capacity_h).toBe(capHBefore);
    expect((await t.repos.objects.get("demo", "obj_Factory_F1"))!.props.capacity).toBe(factoryBefore);
  });

  it("O5 求值语义：null 传播 / COALESCE / 除零→null+warning / decimal 0.1+0.2==0.3", async () => {
    // decimal fixed-point
    const sum = evaluate(parseFormula("0.1 + 0.2"), { self: {}, navigate: () => [], warn: () => {} });
    expect(sum).toBe(0.3);
    expect(decimalRound(0.1 + 0.2)).toBe(0.3);
    // null propagation: missing prop → null
    const np = evaluate(parseFormula("this.a * this.b"), { self: { a: 5 }, navigate: () => [], warn: () => {} });
    expect(np).toBeNull();
    // COALESCE bottoms out a null
    const co = evaluate(parseFormula("COALESCE(this.a, 7)"), { self: {}, navigate: () => [], warn: () => {} });
    expect(co).toBe(7);
    // divide by zero → null + warning
    const warns: string[] = [];
    const dz = evaluate(parseFormula("this.a / this.b"), {
      self: { a: 10, b: 0 },
      navigate: () => [],
      warn: (m) => warns.push(m),
    });
    expect(dz).toBeNull();
    expect(warns.length).toBe(1);
    // CLAMP + IF + comparison
    const clamp = evaluate(parseFormula("CLAMP(this.x, 0, 100)"), { self: { x: 150 }, navigate: () => [], warn: () => {} });
    expect(clamp).toBe(100);
  });

  it("O6 temporal：变更落 history，当前值读路径不查 history", async () => {
    const t = await makeApp();
    await seedPyramid(t);
    const e1 = await t.services.ontologyCore.beginEpoch("demo");
    await putObj(t, "Equipment", "E1", { equipId: "E1", oee_current: 0.8, takt: 2 }, e1);
    const e2 = await t.services.ontologyCore.beginEpoch("demo");
    await putObj(t, "Equipment", "E1", { equipId: "E1", oee_current: 0.6 }, e2);
    const e3 = await t.services.ontologyCore.beginEpoch("demo");
    await putObj(t, "Equipment", "E1", { equipId: "E1", oee_current: 0.7 }, e3);
    // current value lives on the object (read path = objects.props, no history scan)
    const cur = (await t.repos.objects.get("demo", "obj_Equipment_E1"))!;
    expect(cur.props.oee_current).toBe(0.7);
    // history holds the temporal changes (initial + 2 changes)
    const hist = await t.repos.objectPropHistory.list("demo", (h) => h.objectId === "obj_Equipment_E1" && h.prop === "oee_current");
    expect(hist.map((h) => h.value).sort()).toEqual([0.6, 0.7, 0.8]);
    // non-temporal prop (takt) is NOT recorded in history
    const taktHist = await t.repos.objectPropHistory.list("demo", (h) => h.prop === "takt");
    expect(taktHist).toHaveLength(0);
  });

  it("O7 版本演进：删有数据属性无迁移声明拒绝；新版本旧实例新属性 null", async () => {
    const t = await makeApp();
    await seedPyramid(t);
    const e = await t.services.ontologyCore.beginEpoch("demo");
    await putObj(t, "Equipment", "E1", { equipId: "E1", takt: 2, oee_current: 0.8 }, e);
    // propose next version dropping Equipment.takt (which has data) with no migration → error
    const next: ObjectTypeDef[] = (await t.services.ontology.listTypes(ADMIN_CTX)).map((ty) =>
      ty.key === "Equipment"
        ? { ...ty, properties: ty.properties.filter((p) => p.propKey !== "takt") }
        : ty,
    );
    const errs = await t.services.ontologyCore.validateEvolution(ADMIN_CTX, next);
    expect(errs.some((x) => x.typeKey === "Equipment" && x.prop === "takt")).toBe(true);
    // with a migration declaration → allowed
    const ok = await t.services.ontologyCore.validateEvolution(ADMIN_CTX, next, {
      migrations: [{ typeKey: "Equipment", prop: "takt", dropData: true }],
    });
    expect(ok).toHaveLength(0);
    // new property on old instance reads as null (not present)
    const e2 = await t.services.ontologyCore.beginEpoch("demo");
    await putObj(t, "Equipment", "E2", { equipId: "E2" }, e2);
    const e2obj = (await t.repos.objects.get("demo", "obj_Equipment_E2"))!;
    expect(e2obj.props.takt ?? null).toBeNull();
  });

  it("O8 slice 执行：limitPerNode 生效；maxNodes 截断置 truncated", async () => {
    const t = await makeApp();
    await seedPyramid(t);
    await buildPyramidObjects(t);
    await t.services.ontologyCore.putSliceSpec(ADMIN_CTX, "factory_net", 1, {
      root: { typeKey: "Factory", selector: { byKey: "{{args.factoryId}}" } },
      paths: [
        [
          { linkKey: "归属基地", direction: "in" }, // Factory ← Line
          { linkKey: "包含工序", direction: "out" }, // Line → Process
          { linkKey: "使用于", direction: "in", limitPerNode: 1 }, // Process ← Equipment
        ],
      ],
      maxNodes: 500,
    });
    const spec = (await t.services.ontologyCore.getSliceSpec(ADMIN_CTX, "factory_net"))!;
    const full = await t.services.ontologyCore.executeSlice(ADMIN_CTX, spec.spec, { factoryId: "F1" });
    // F1, L1, P1, P2, + 1 equipment per process (limitPerNode 1) = 5 nodes
    expect(full.nodes.find((n) => n.id === "obj_Factory_F1")).toBeTruthy();
    const equipNodes = full.nodes.filter((n) => n.typeKey === "Equipment");
    expect(equipNodes.length).toBe(2); // 1 per process due to limitPerNode
    expect(full.truncated).toBe(false);
    expect(full.snapshotVersion).toMatch(/^\d+\.\d+$/);
    // maxNodes truncation
    const truncSpec = { ...spec.spec, maxNodes: 2 };
    const trunc = await t.services.ontologyCore.executeSlice(ADMIN_CTX, truncSpec, { factoryId: "F1" });
    expect(trunc.truncated).toBe(true);
    expect(trunc.nodes.length).toBeLessThanOrEqual(2);
  });

  it("O9 slice 权限剪枝：base_manager 不可见基地的整条下游子树不出现", async () => {
    const t = await makeApp();
    await seedPyramid(t);
    // two factories; row filter ties Factory visibility to baseScope
    const e = await t.services.ontologyCore.beginEpoch("demo");
    await putObj(t, "Factory", "B1", { factoryId: "B1" }, e);
    await putObj(t, "Factory", "B2", { factoryId: "B2" }, e);
    await putObj(t, "Line", "L1", { lineId: "L1" }, e);
    await putObj(t, "Line", "L2", { lineId: "L2" }, e);
    await putObj(t, "Process", "P1", { processId: "P1" }, e);
    await putObj(t, "Process", "P2", { processId: "P2" }, e);
    await link(t, "归属基地", "obj_Line_L1", "obj_Factory_B1"); // Line 归属基地 Factory
    await link(t, "归属基地", "obj_Line_L2", "obj_Factory_B2");
    await link(t, "包含工序", "obj_Line_L1", "obj_Process_P1");
    await link(t, "包含工序", "obj_Line_L2", "obj_Process_P2");
    // policy: base_manager only sees Factory matching baseScope
    await t.repos.policies.put({
      id: "pol_demo_factory_bm",
      tenantId: "demo",
      resource: { kind: "OBJECT_TYPE", key: "Factory" },
      grants: [{ role: "base_manager", ops: ["READ"] }, { role: "admin", ops: ["READ"] }],
      rowFilter: "Object.factoryId IN ${user.attributes.baseScope}",
    } as never);
    const spec = {
      root: { typeKey: "Factory", selector: {} },
      paths: [
        [
          { linkKey: "归属基地", direction: "in" as const }, // Factory ← Line
          { linkKey: "包含工序", direction: "out" as const }, // Line → Process
        ],
      ],
    };
    const bm = await t.services.ontologyCore.executeSlice(BM_CTX, spec, {});
    const ids = new Set(bm.nodes.map((n) => n.id));
    // B1 visible (baseScope B1) with its subtree; B2 and its entire subtree pruned
    expect(ids.has("obj_Factory_B1")).toBe(true);
    expect(ids.has("obj_Line_L1")).toBe(true);
    expect(ids.has("obj_Process_P1")).toBe(true);
    expect(ids.has("obj_Factory_B2")).toBe(false);
    expect(ids.has("obj_Line_L2")).toBe(false);
    expect(ids.has("obj_Process_P2")).toBe(false);
    // edges into the invisible subtree are not leaked either
    expect(bm.edges.some((ed) => ed.from === "obj_Factory_B2" || ed.to === "obj_Factory_B2")).toBe(false);
  });

  it("O10 参数化：{{args.x}} 恶意字符串只作字面量参数（无注入面）", async () => {
    const t = await makeApp();
    await seedPyramid(t);
    const e = await t.services.ontologyCore.beginEpoch("demo");
    await putObj(t, "Factory", "F1", { factoryId: "F1" }, e);
    const spec = {
      root: { typeKey: "Factory", selector: { byKey: "{{args.factoryId}}" } },
      paths: [],
    };
    const malicious = "F1' OR '1'='1";
    const res = await t.services.ontologyCore.executeSlice(ADMIN_CTX, spec, { factoryId: malicious });
    // the injection string matches nothing literally → empty root selection, never "all rows"
    expect(res.nodes).toHaveLength(0);
    // exact literal still works
    const okRes = await t.services.ontologyCore.executeSlice(ADMIN_CTX, spec, { factoryId: "F1" });
    expect(okRes.nodes.map((n) => n.id)).toEqual(["obj_Factory_F1"]);
    // filter values also flow in as literals, not expressions
    const fspec = {
      root: { typeKey: "Factory", selector: { filter: { factoryId: "{{args.factoryId}}" } } },
      paths: [],
    };
    const injF = await t.services.ontologyCore.executeSlice(ADMIN_CTX, fspec, { factoryId: malicious });
    expect(injF.nodes).toHaveLength(0);
  });
});

// ---- H: generic_inference 通用 what-if 求解器（注册 + 经求解器路径走本体 recompute，工业级）----

/** 规模化派生金字塔：1 工厂 × N 产线 × M 工序 × K 设备，4 层派生链（复用 PYRAMID_SPECS 公式）。 */
async function buildScaledPyramid(
  t: TestApp,
  lines: number,
  procPerLine: number,
  equipPerProc: number,
): Promise<{ equipIds: string[]; firstProcessKey: string; siblingProcessKey: string }> {
  const epoch = await t.services.ontologyCore.beginEpoch("demo");
  await putObj(t, "Factory", "F1", { factoryId: "F1" }, epoch);
  const equipIds: string[] = [];
  let pIdx = 0;
  let eIdx = 0;
  let firstProcessKey = "";
  let siblingProcessKey = "";
  for (let l = 0; l < lines; l++) {
    const lk = `L${l}`;
    await putObj(t, "Line", lk, { lineId: lk }, epoch);
    await link(t, "归属基地", `obj_Line_${lk}`, "obj_Factory_F1");
    for (let p = 0; p < procPerLine; p++) {
      const pk = `P${pIdx++}`;
      if (!firstProcessKey) firstProcessKey = pk;
      else if (!siblingProcessKey) siblingProcessKey = pk;
      await putObj(t, "Process", pk, { processId: pk, yield_baseline: 0.9 + (p % 5) * 0.01 }, epoch);
      await link(t, "包含工序", `obj_Line_${lk}`, `obj_Process_${pk}`);
      for (let e = 0; e < equipPerProc; e++) {
        const ek = `E${eIdx++}`;
        await putObj(t, "Equipment", ek, { equipId: ek, takt: 2 + (e % 3) * 0.5, availFactor: 0.85 + (e % 4) * 0.02, oee_current: 0.7 + (e % 5) * 0.03 }, epoch);
        await link(t, "使用于", `obj_Equipment_${ek}`, `obj_Process_${pk}`);
        equipIds.push(`obj_Equipment_${ek}`);
      }
    }
  }
  return { equipIds, firstProcessKey, siblingProcessKey };
}

describe("generic_inference 通用 what-if 求解器（H · G-5 通用 what-if，工业级）", () => {
  it("注册：SOLVER_KEYS 含通用求解器（=46，含 DS.2 cockpit_kpi + 轨B·增量1 优化模板池 5 核心 + 增量3 optimize_whatif）+ 输出形状已声明（chain:check/SHAPE 覆盖）", () => {
    expect(SOLVER_KEYS.includes("generic_inference" as (typeof SOLVER_KEYS)[number])).toBe(true);
    // 轨B：40 → 45（5 核心）→ 46（optimize_whatif 增量3）→ 48（WO-CEO-2 gap_attribution + WO-CEO-3 decision_play）。
    // 双占 reconcile：WO-PORTFOLIO-OPTIMAL portfolio + WO-B base_capacity_outlook 两条 handoff 各自 54→55·合两条 → 56。
    expect(SOLVER_KEYS.length).toBe(56); // WO-CEO-Q7 supply_demand_gap_attribution + WO-ATP-PROMISE atp_check + integ-wave-11 +4 + WO-PORTFOLIO-OPTIMAL portfolio + WO-B base_capacity_outlook（前瞻产能推演 F1/P1）
    expect(SOLVER_OUTPUT_SHAPES.generic_inference?.length ?? 0).toBeGreaterThan(0);
  });

  it("规模化派生图（73 对象/4 层）× 10 源假设变更 → 经 /a/v1/solvers/generic_inference/invoke 前向重算 before/after；无副作用 + 确定性 + R2", async () => {
    const t = await makeApp();
    await seedPyramid(t);
    const { equipIds } = await buildScaledPyramid(t, 2, 5, 6); // 60 设备 + 10 工序 + 2 产线 + 1 工厂 = 73 对象
    await t.services.ontologyCore.compileSpecs(ADMIN_CTX, 1, PYRAMID_SPECS);
    await t.services.ontologyCore.recompute(ADMIN_CTX, [{ typeKey: "Equipment", prop: "oee_current", objectIds: equipIds }]); // 初算落 before 基线

    const targets = equipIds.slice(0, 10);
    const apply = targets.map((id) => ({ objectType: "Equipment", objectId: id, prop: "oee_current", value: 0.5 }));
    const snapshotBefore = JSON.stringify(await t.repos.objects.list("demo"));

    const res = await invokeSolver(t, "generic_inference", { apply });
    expect(res.statusCode).toBe(200);
    const out = (res.json() as { data: { deltas: { objId: string; prop: string; before: number; after: number }[]; count: number; affectedObjects: number; rows: unknown[] } }).data;
    // 10 台设备 capacity_h + 上游工序/产线/工厂 capacity 全被重算
    expect(out.count).toBeGreaterThan(10);
    expect(out.rows.length).toBe(out.count);
    for (const id of targets) {
      const d = out.deltas.find((x) => x.objId === id && x.prop === "capacity_h");
      expect(d, `${id} capacity_h delta`).toBeTruthy();
      expect(Number(d!.after)).toBeLessThan(Number(d!.before)); // oee 降→产能降
    }
    expect(out.deltas.some((d) => d.objId === "obj_Factory_F1" && d.prop === "capacity")).toBe(true); // 顶层聚合受影响

    // 无副作用：全量对象快照字节级一致（dryRun 不落库）
    expect(JSON.stringify(await t.repos.objects.list("demo"))).toBe(snapshotBefore);
    // 确定性 R6：同 apply 再跑 → deltas 字节级一致
    const res2 = await invokeSolver(t, "generic_inference", { apply });
    expect(JSON.stringify((res2.json() as { data: { deltas: unknown } }).data.deltas)).toBe(JSON.stringify(out.deltas));
    // R2：他租户（无这些对象/未编译派生）→ 不泄漏本租户对象
    const resOther = await invokeSolver(t, "generic_inference", { apply }, { "X-Debug-User": "acme:u:admin" });
    expect((resOther.json() as { data: { deltas: { objId: string }[] } }).data.deltas.every((d) => !targets.includes(d.objId))).toBe(true);
  });

  it("选择性最小集：只改 1 台设备 → 仅其工序/产线/工厂链入 deltas，无关兄弟工序不在", async () => {
    const t = await makeApp();
    await seedPyramid(t);
    const { equipIds, firstProcessKey, siblingProcessKey } = await buildScaledPyramid(t, 1, 4, 5);
    await t.services.ontologyCore.compileSpecs(ADMIN_CTX, 1, PYRAMID_SPECS);
    await t.services.ontologyCore.recompute(ADMIN_CTX, [{ typeKey: "Equipment", prop: "oee_current", objectIds: equipIds }]);

    const one = equipIds[0]!; // 属 firstProcess
    const res = await invokeSolver(t, "generic_inference", { apply: [{ objectType: "Equipment", objectId: one, prop: "oee_current", value: 0.4 }] });
    const out = (res.json() as { data: { deltas: { objId: string; prop: string }[] } }).data;
    expect(out.deltas.some((d) => d.objId === `obj_Process_${firstProcessKey}`)).toBe(true); // 直属工序重算
    expect(out.deltas.some((d) => d.objId === `obj_Process_${siblingProcessKey}`)).toBe(false); // 兄弟工序不重算
  });

  it("边界：空 apply → 400（need 假设值），不静默返回空", async () => {
    const t = await makeApp();
    const res = await invokeSolver(t, "generic_inference", { apply: [] });
    expect(res.statusCode).toBe(400);
  });

  // WO-PROJECT-SIM-WHATIF · 杠杆发现 mode:"levers"（G-WHATIF-HARDCODED-LEVERS）：反向 walk 派生 DAG →
  // 叶输入候选杠杆 + 服务端 ±ε recompute 算敏感度 + 排序（引擎半·SEAM 之杠杆随瓶颈变/真敏感度）。
  it("mode:levers 反向 walk 派生 DAG → 叶输入候选杠杆，服务端算 |敏感度| 排序 + 确定性 R6", async () => {
    const t = await makeApp();
    await seedPyramid(t);
    const { equipIds } = await buildScaledPyramid(t, 1, 3, 4); // 12 设备 3 工序 1 线 1 厂
    await t.services.ontologyCore.compileSpecs(ADMIN_CTX, 1, PYRAMID_SPECS);
    await t.services.ontologyCore.recompute(ADMIN_CTX, [{ typeKey: "Equipment", prop: "oee_current", objectIds: equipIds }]);

    const res = await invokeSolver(t, "generic_inference", { mode: "levers", targetType: "Factory", targetProp: "capacity", topK: 8 });
    expect(res.statusCode).toBe(200);
    const out = (res.json() as { data: { levers: { objectType: string; objectId: string; prop: string; sensitivity: number; provenance: unknown }[]; count: number; deltas: unknown[] } }).data;
    // 反推到叶输入（Equipment 的 oee_current/takt/availFactor + Process.yield_baseline），非派生 capacity_h/capacity
    const props = new Set(out.levers.map((l) => `${l.objectType}.${l.prop}`));
    expect(props.has("Equipment.oee_current")).toBe(true);
    expect(props.has("Process.yield_baseline")).toBe(true);
    expect(props.has("Equipment.capacity_h")).toBe(false); // 派生属性不作杠杆（只反推到叶）
    // 每根杠杆指向真对象实例 + provenance + 非零敏感度
    for (const l of out.levers) {
      expect(equipIds.includes(l.objectId) || l.objectId.startsWith("obj_Process_")).toBe(true);
      expect(l.sensitivity).not.toBe(0);
      expect(l.provenance).toBeTruthy();
    }
    // 按 |敏感度| 降序（tornado 排序 = 真敏感度）
    for (let i = 1; i < out.levers.length; i++) expect(Math.abs(out.levers[i - 1]!.sensitivity)).toBeGreaterThanOrEqual(Math.abs(out.levers[i]!.sensitivity));
    // 确定性 R6：同输入字节级一致
    const res2 = await invokeSolver(t, "generic_inference", { mode: "levers", targetType: "Factory", targetProp: "capacity", topK: 8 });
    expect(JSON.stringify((res2.json() as { data: unknown }).data)).toBe(JSON.stringify(out));
    // 默认路径输出形状键保留（deltas 存在·SHAPE 不破）
    expect(Array.isArray(out.deltas)).toBe(true);
  });

  it("mode:levers · factors 过滤 → 杠杆随瓶颈变（设备OEE 瓶颈只出 Equipment.oee_current 杠杆，不含无关杠杆）", async () => {
    const t = await makeApp();
    await seedPyramid(t);
    const { equipIds } = await buildScaledPyramid(t, 1, 2, 3);
    await t.services.ontologyCore.compileSpecs(ADMIN_CTX, 1, PYRAMID_SPECS);
    await t.services.ontologyCore.recompute(ADMIN_CTX, [{ typeKey: "Equipment", prop: "oee_current", objectIds: equipIds }]);

    const oee = (await invokeSolver(t, "generic_inference", { mode: "levers", targetType: "Factory", targetProp: "capacity", factors: ["设备OEE"] })).json() as { data: { levers: { objectType: string; prop: string }[] } };
    const yieldF = (await invokeSolver(t, "generic_inference", { mode: "levers", targetType: "Factory", targetProp: "capacity", factors: ["良率波动"] })).json() as { data: { levers: { objectType: string; prop: string }[] } };
    // 设备OEE 瓶颈 → 只出 OEE 杠杆；良率波动瓶颈 → 只出良率杠杆；两瓶颈杠杆集不同（证非写死）
    expect(oee.data.levers.every((l) => `${l.objectType}.${l.prop}` === "Equipment.oee_current")).toBe(true);
    expect(oee.data.levers.length).toBeGreaterThan(0);
    expect(yieldF.data.levers.every((l) => `${l.objectType}.${l.prop}` === "Process.yield_baseline")).toBe(true);
    expect(JSON.stringify(oee.data.levers)).not.toBe(JSON.stringify(yieldF.data.levers));
  });
});
