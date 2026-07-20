import { describe, expect, it } from "vitest";
import { OntologyWorkflowSchema, ProcessingSpecSchema, EntityNodeSchema, WfNodeSchema } from "../src/pipeline.js";

describe("OntoFlow 契约 pipeline.ts", () => {
  it("EntityNode 默认值：storageMode=STATIC，modeling 数组缺省", () => {
    const r = EntityNodeSchema.parse({ id: "n1", kind: "SUBGRAPH_ENTITY", modeling: { typeKey: "Order", primaryKey: "order_id" } });
    expect(r.storageMode).toBe("STATIC");
    expect(r.modeling.properties).toEqual([]);
    expect(r.modeling.stateVariables).toEqual([]);
  });

  it("ProcessingSpec：聚合函数缺省 Last、mode 缺省 BATCH", () => {
    const r = ProcessingSpecSchema.parse({ mappings: [{ sourceField: "amount", targetProp: "amount", dataType: "Double", fn: "Sum" }] });
    expect(r.mode).toBe("BATCH");
    expect(r.mappings[0]!.fn).toBe("Sum");
    const dflt = ProcessingSpecSchema.parse({ mappings: [{ sourceField: "s", targetProp: "t", dataType: "String" }] });
    expect(dflt.mappings[0]!.fn).toBe("Last");
  });

  it("WfNode discriminated union 接受六种 kind", () => {
    for (const kind of ["SOURCE_SELECT", "SOURCE_TABLE", "PROCESS", "SUBGRAPH_ENTITY", "SUBGRAPH_LINK", "ONTOLOGY_SINK"]) {
      const node: Record<string, unknown> = { id: "x", kind };
      if (kind === "SOURCE_SELECT") node.spec = {};
      if (kind === "SOURCE_TABLE") node.spec = { rawDatasetId: "rd1" };
      if (kind === "PROCESS") node.spec = { mappings: [] };
      if (kind === "SUBGRAPH_ENTITY") node.modeling = { typeKey: "T", primaryKey: "id" };
      if (kind === "SUBGRAPH_LINK") node.spec = { linkKey: "REL", fromTypeKey: "A", toTypeKey: "B" };
      if (kind === "ONTOLOGY_SINK") node.spec = {};
      expect(WfNodeSchema.safeParse(node).success, kind).toBe(true);
    }
  });

  it("OntologyWorkflow 整体解析 + 缺省 entryMode/status", () => {
    const wf = OntologyWorkflowSchema.parse({ id: "wf1", tenantId: "demo", name: "w", nodes: [], edges: [] });
    expect(wf.entryMode).toBe("DATA_FIRST");
    expect(wf.status).toBe("DRAFT");
  });
});
