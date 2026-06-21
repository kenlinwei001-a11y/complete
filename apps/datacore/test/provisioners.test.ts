import { describe, expect, it } from "vitest";
import { MODULE_KINDS, type BuildPlan } from "@platform/contracts";
import { MODULE_PROVISIONERS, NEED_ARRAY_TO_KIND, analyzeGap, summarizeGap, type ProvisionerDeps } from "../src/databuilder/provisioners.js";
import { assemblePlanBody, type LlmComprehendOutput } from "../src/databuilder/comprehend.js";
import type { AuthCtx } from "../src/domain.js";

const CTX: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };

describe("ModuleProvisioner 注册表 · 无遗漏保证（倒序管线：新模块强制纳入统一机制）", () => {
  it("注册表覆盖全部 MODULE_KINDS，且一一对应（无重复、无缺漏）", () => {
    const registered = MODULE_PROVISIONERS.map((p) => p.kind).sort();
    expect(registered).toEqual([...MODULE_KINDS].sort());
    expect(new Set(registered).size).toBe(MODULE_PROVISIONERS.length); // 无重复
  });

  it("BuildPlan 每个根级 need 数组都已登记到 NEED_ARRAY_TO_KIND（新增 need 数组未登记即红）", () => {
    // 用真实装配出的 plan 抽根级数组字段——若有人给 BuildPlan 加了新 need 数组却没登记，这条断言会失败。
    const core: LlmComprehendOutput = {
      objectTypes: [{ typeKey: "T", displayName: "T", domain: "sales", fields: [{ name: "k", dataType: "string", isPrimaryKey: true }] }],
      rules: [],
      solverNeeds: [{ solverKey: "shared_bottleneck", inputFields: [{ typeKey: "T", propKey: "k" }] }],
    };
    const plan = assemblePlanBody(core, "测试脚本", 42) as unknown as Record<string, unknown>;
    const rootArrayFields = Object.entries(plan).filter(([, v]) => Array.isArray(v)).map(([k]) => k).sort();
    const registeredArrays = Object.keys(NEED_ARRAY_TO_KIND).sort();
    // 每个根级数组字段必须已登记；登记的字段也都应是真实存在的 need 数组
    for (const f of rootArrayFields) expect(registeredArrays, `BuildPlan 根级数组字段 ${f} 未登记到 NEED_ARRAY_TO_KIND（新增模块必须注册 provisioner）`).toContain(f);
    expect(rootArrayFields).toEqual(registeredArrays);
  });

  it("NEED_ARRAY_TO_KIND 的目标 kind 全在 MODULE_KINDS 内（映射不指向幽灵 kind）", () => {
    for (const kind of Object.values(NEED_ARRAY_TO_KIND)) expect(MODULE_KINDS).toContain(kind);
    expect(new Set(Object.values(NEED_ARRAY_TO_KIND)).size).toBe(MODULE_KINDS.length); // 13 个字段一一映射 13 个 kind
  });
});

describe("比对现状 analyzeGap · 跨模块统一 diff（EXISTS 复用 / TO_CREATE 新建 / MISSING 不能自动建）", () => {
  // 最小 deps：仅 analyzeGap 触及的几处现状查询（结构/内容类）。
  const deps = (opts: { types?: string[]; rules?: string[]; slices?: string[]; datasets?: string[]; kb?: string[] }): ProvisionerDeps => ({
    ontology: { listTypes: async () => (opts.types ?? []).map((key) => ({ key })) } as unknown as ProvisionerDeps["ontology"],
    repos: {
      rules: { list: async () => (opts.rules ?? []).map((key) => ({ key })) },
      sliceSpecs: { list: async () => (opts.slices ?? []).map((sliceKey) => ({ sliceKey })) },
      rawDatasets: { list: async () => (opts.datasets ?? []).map((name) => ({ name })) },
      kbDocs: { list: async () => (opts.kb ?? []).map((filename) => ({ filename })) },
    } as unknown as ProvisionerDeps["repos"],
  });

  const plan = {
    dataSources: [{ datasetKey: "order" }],
    kbDocs: [],
    objectTypes: [{ typeKey: "Existing" }, { typeKey: "NewType" }],
    rules: [{ key: "R1" }, { key: "R2" }],
    solverNeeds: [{ solverKey: "capacity_forecast" }, { solverKey: "ghost_solver" }],
    sliceNeeds: [{ sliceKey: "slice_existing" }, { sliceKey: "slice_new" }],
    intentNeeds: [{ intentKey: "intent_a" }],
    planNeeds: [], workflowNeeds: [], skillNeeds: [], agentNeeds: [], sceneNeeds: [], mcpNeeds: [],
  } as unknown as BuildPlan;

  it("结构类：已有→EXISTS，未有→TO_CREATE；代码类求解器：已注册→EXISTS，未注册→MISSING（不能自动建）", async () => {
    const g = await analyzeGap(deps({ types: ["Existing"], rules: ["R1"], slices: ["slice_existing"], datasets: [] }), CTX, plan);
    const by = (k: string) => g.entries.find((e) => e.kind === k)!;
    expect(by("ontology_type").items).toEqual([{ key: "Existing", status: "EXISTS" }, { key: "NewType", status: "TO_CREATE" }]);
    expect(by("rule")).toMatchObject({ existing: 1, toCreate: 1 });
    expect(by("slice")).toMatchObject({ existing: 1, toCreate: 1 });
    // 求解器：capacity_forecast 已注册=EXISTS；ghost_solver 未注册=MISSING（autoCreatable=false）
    const solver = by("solver");
    expect(solver.items.find((i) => i.key === "capacity_forecast")!.status).toBe("EXISTS");
    expect(solver.items.find((i) => i.key === "ghost_solver")!.status).toBe("MISSING");
    expect(by("dataset").items[0]).toEqual({ key: "order", status: "TO_CREATE" });
  });

  it("跨系统类（B 栈）现状由 scaffold 回执判定：REUSED→EXISTS / MISSING→MISSING / SCAFFOLDED→TO_CREATE", async () => {
    const receipt = { items: [{ kind: "intent" as const, key: "intent_a", status: "REUSED" as const }], fullChainOk: true };
    const g = await analyzeGap(deps({}), CTX, plan, receipt);
    expect(g.entries.find((e) => e.kind === "intent")!.items[0]).toEqual({ key: "intent_a", status: "EXISTS" });
    // 无回执时 → TO_CREATE（默认会被 scaffold 新建）
    const g2 = await analyzeGap(deps({}), CTX, plan);
    expect(g2.entries.find((e) => e.kind === "intent")!.items[0]).toEqual({ key: "intent_a", status: "TO_CREATE" });
  });

  it("totals 汇总正确 + summarizeGap 一行摘要", async () => {
    const g = await analyzeGap(deps({ types: ["Existing"], rules: ["R1"] }), CTX, plan);
    const sum = g.entries.reduce((a, e) => a + e.needed, 0);
    expect(g.totals.needed).toBe(sum);
    expect(g.totals.missing).toBeGreaterThanOrEqual(1); // ghost_solver
    expect(summarizeGap(g)).toMatch(/需 \d+ · 复用 \d+ · 新建 \d+ · 缺 \d+/);
  });
});
