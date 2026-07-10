import { describe, expect, it } from "vitest";
import { computeReadiness } from "../src/pipeline/readiness.js";
import type { OntologyWorkflow } from "@platform/contracts";

/** P4：局部仿真准备度评分（纯确定性）。手算校验维度/权重/阈值/缺项引导。 */

const entityNode = (over: Record<string, unknown> = {}): OntologyWorkflow["nodes"][number] =>
  ({
    id: "n1",
    kind: "SUBGRAPH_ENTITY",
    label: "E",
    position: { x: 0, y: 0 },
    storageMode: "STATIC",
    modeling: { typeKey: "E", displayName: "E", primaryKey: "e_id", properties: [], stateVariables: [], derived: [] },
    ...over,
  }) as OntologyWorkflow["nodes"][number];

const wfOf = (nodes: OntologyWorkflow["nodes"]): OntologyWorkflow => ({
  id: "wf1",
  tenantId: "demo",
  name: "w",
  entryMode: "GRAPH_FIRST",
  status: "DRAFT",
  nodes,
  edges: [],
});

describe("OntoFlow P4 · readiness 准备度评分", () => {
  it("R1: 空图 → overall 0 / NASCENT / 无实体", () => {
    const r = computeReadiness(wfOf([]));
    expect(r.overall).toBe(0);
    expect(r.grade).toBe("NASCENT");
    expect(r.entities).toHaveLength(0);
  });

  it("R2: 裸 STATIC 实体（仅主键，无其它）→ 低分 NASCENT + 缺项引导", () => {
    const r = computeReadiness(wfOf([entityNode()]));
    const e = r.entities[0]!;
    // 维度：properties 0, primaryKey 60(定义但未映射), dataSource 0, stateVars 0, actions 0, derived 0, storageMode 0
    // 加权：60*0.20 = 12
    expect(e.score).toBe(12);
    expect(e.grade).toBe("NASCENT");
    const byKey = Object.fromEntries(e.dimensions.map((d) => [d.key, d.score]));
    expect(byKey).toMatchObject({ properties: 0, primaryKey: 60, dataSource: 0, stateVariables: 0, actions: 0, derived: 0, storageMode: 0 });
    // 缺项：properties/dataSource/stateVariables/actions/derived/storageMode（primaryKey=60 不列）
    expect(e.missing).toEqual(
      expect.arrayContaining(["未定义属性", "未配数据源", "无状态变量", "未绑定行动", "无派生属性", "未提升为本体图谱(storageMode=STATIC)"]),
    );
    expect(e.missing).not.toContain("缺主键映射");
    expect(r.overall).toBe(12);
  });

  it("R3: 完整 ONTOLOGY 实体 → 满分 READY，无缺项", () => {
    const full = entityNode({
      storageMode: "ONTOLOGY",
      modeling: {
        typeKey: "Order",
        displayName: "订单",
        primaryKey: "order_id",
        description: "含行动函数 adjustCapacity",
        properties: [{ propKey: "amount" }, { propKey: "status" }, { propKey: "cust" }],
        stateVariables: [
          { propKey: "risk", fromField: "risk", fn: "Max", dataType: "Double" },
          { propKey: "cnt", fromField: "x", fn: "Count", dataType: "Int" },
        ],
        derived: [{ propKey: "d1", formula: "amount * 2" }, { propKey: "d2", formula: "amount + 1" }],
        actions: [{ actionTypeKey: "delayOrder" }],
      },
      dataSource: { rawDatasetId: "ds1", role: "master" },
      processing: { mappings: [{ sourceField: "order_id", targetProp: "order_id", dataType: "String", fn: "Last", isPrimaryKey: true }], mode: "BATCH" },
    });
    const r = computeReadiness(wfOf([full]));
    const e = r.entities[0]!;
    const byKey = Object.fromEntries(e.dimensions.map((d) => [d.key, d.score]));
    expect(byKey).toMatchObject({ properties: 100, primaryKey: 100, dataSource: 100, stateVariables: 100, actions: 100, derived: 100, storageMode: 100 });
    expect(e.score).toBe(100);
    expect(e.grade).toBe("READY");
    expect(e.missing).toHaveLength(0);
    expect(e.storageMode).toBe("ONTOLOGY");
  });

  it("R4: 分级阈值（DEVELOPING 中段）+ overall 为各实体均值", () => {
    // 实体 A：低（R2 = 12），实体 B：完整（100） → overall = round((12+100)/2) = 56 DEVELOPING
    const low = entityNode();
    const high = entityNode({
      id: "n2",
      storageMode: "ONTOLOGY",
      modeling: {
        typeKey: "H",
        displayName: "H",
        primaryKey: "h_id",
        properties: [{ propKey: "a" }, { propKey: "b" }, { propKey: "c" }],
        stateVariables: [{ propKey: "s", fromField: "s", fn: "Max", dataType: "Double" }, { propKey: "s2", fromField: "s2", fn: "Sum", dataType: "Double" }],
        derived: [{ propKey: "d", formula: "a+b" }, { propKey: "d2", formula: "a*c" }],
        actions: [{ actionTypeKey: "x" }],
      },
      dataSource: { rawDatasetId: "ds", role: "master" },
      processing: { mappings: [{ sourceField: "h_id", targetProp: "h_id", dataType: "String", fn: "Last", isPrimaryKey: true }], mode: "BATCH" },
    });
    const r = computeReadiness(wfOf([low, high]));
    expect(r.entities[0]!.score).toBe(12);
    expect(r.entities[1]!.score).toBe(100);
    expect(r.overall).toBe(56);
    expect(r.grade).toBe("DEVELOPING");
  });

  it("R5: 确定性 —— 同 wf 两次调用结果 byte 级一致", () => {
    const wf = wfOf([entityNode({ storageMode: "ONTOLOGY", modeling: { typeKey: "E", displayName: "E", primaryKey: "e_id", properties: [{ propKey: "p" }], stateVariables: [], derived: [] } })]);
    expect(JSON.stringify(computeReadiness(wf))).toBe(JSON.stringify(computeReadiness(wf)));
  });
});
