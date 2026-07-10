import { describe, expect, it } from "vitest";
import { buildScaffold, GENERIC_AGENT_TOOLS } from "../src/pipeline/scaffold.js";
import type { OntologyWorkflow } from "@platform/contracts";

/** P4：从已发布本体生成应用（视图/场景/Agent/场景包/求解器绑定）。 */

const entity = (typeKey: string, over: Record<string, unknown> = {}): OntologyWorkflow["nodes"][number] =>
  ({
    id: `n_${typeKey}`,
    kind: "SUBGRAPH_ENTITY",
    label: typeKey,
    position: { x: 0, y: 0 },
    storageMode: "ONTOLOGY",
    modeling: { typeKey, displayName: typeKey, primaryKey: `${typeKey}_id`, properties: [], stateVariables: [], derived: [] },
    ...over,
  }) as OntologyWorkflow["nodes"][number];

const link = (linkKey: string, from: string, to: string): OntologyWorkflow["nodes"][number] =>
  ({ id: `l_${linkKey}`, kind: "SUBGRAPH_LINK", label: linkKey, position: { x: 0, y: 0 }, storageMode: "ONTOLOGY", spec: { linkKey, fromTypeKey: from, toTypeKey: to, cardinality: "N:N" } }) as OntologyWorkflow["nodes"][number];

const wfOf = (nodes: OntologyWorkflow["nodes"], status: "DRAFT" | "PUBLISHED" = "PUBLISHED"): OntologyWorkflow => ({
  id: "wf1",
  tenantId: "demo",
  name: "w",
  entryMode: "GRAPH_FIRST",
  status,
  nodes,
  edges: [],
});

describe("OntoFlow P4 · scaffold 生成应用", () => {
  it("SC1: 多实体已发布 → 每类型台账 + 全局驾驶舱/图谱", () => {
    const r = buildScaffold(wfOf([entity("Supplier"), entity("Factory"), entity("Order"), link("SUPPLIES", "Supplier", "Factory")]));
    const ledgers = r.views.filter((v) => v.kind === "ledger");
    expect(ledgers.map((v) => v.typeKey)).toEqual(["Supplier", "Factory", "Order"]);
    expect(ledgers.map((v) => v.key)).toEqual(["ledger_Supplier", "ledger_Factory", "ledger_Order"]);
    expect(r.views.filter((v) => v.kind === "dashboard")).toHaveLength(1);
    expect(r.views.filter((v) => v.kind === "graph")).toHaveLength(1);
  });

  it("SC2: 每核心实体一个 AGENT_FIRST 场景 + 默认 Agent（通用工具集）", () => {
    const r = buildScaffold(wfOf([entity("Supplier"), entity("Order", { modeling: { typeKey: "Order", displayName: "订单", primaryKey: "Order_id", description: "行动函数 adjustCapacity 用于推演", properties: [], stateVariables: [], derived: [] } })]));
    expect(r.scenes).toHaveLength(2);
    for (const s of r.scenes) {
      expect(s.mode).toBe("AGENT_FIRST");
      expect(s.agentKey).toBe(`agent_${s.typeKey}`);
    }
    expect(r.agents).toHaveLength(2);
    for (const a of r.agents) expect(a.tools).toEqual([...GENERIC_AGENT_TOOLS]);
    // description → systemPrompt 注入
    const orderAgent = r.agents.find((a) => a.key === "agent_Order")!;
    expect(orderAgent.systemPrompt).toContain("adjustCapacity");
    const supAgent = r.agents.find((a) => a.key === "agent_Supplier")!;
    expect(supAgent.systemPrompt).toBeUndefined();
  });

  it("SC3: 通用场景包 + 通用求解器默认启用", () => {
    const r = buildScaffold(wfOf([entity("Order")]));
    expect(r.scenarioPackages).toEqual(["generic-ontology"]);
    expect(r.solverBindings).toEqual(["generic_whatif"]);
  });

  it("SC4: 无 ONTOLOGY 实体 → 回退全部实体也生成场景", () => {
    const r = buildScaffold(wfOf([entity("A", { storageMode: "STATIC" }), entity("B", { storageMode: "STATIC" })]));
    expect(r.scenes.map((s) => s.typeKey)).toEqual(["A", "B"]);
  });

  it("SC5: 未发布 → 抛 VALIDATION_ERROR", () => {
    expect(() => buildScaffold(wfOf([entity("Order")], "DRAFT"))).toThrow(/未发布/);
  });

  it("SC6: 确定性 —— 同 wf 两次生成 byte 级一致", () => {
    const wf = wfOf([entity("Supplier"), entity("Order")]);
    expect(JSON.stringify(buildScaffold(wf))).toBe(JSON.stringify(buildScaffold(wf)));
  });
});
