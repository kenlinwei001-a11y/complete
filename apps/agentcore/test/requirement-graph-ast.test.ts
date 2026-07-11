import { describe, it, expect } from "vitest";
import {
  QuestionAstSchema,
  RequirementGraphSchema,
  type ClassificationResult,
  type ToolPayload,
} from "@platform/contracts";
import type { OntologyClient, ToolAuthCtx } from "../src/tools/clients.js";
import { parseQuestionAst, QUESTION_AST_PARSER_VERSION } from "../src/growth/requirement-graph.js";

// ═══════════════════════════════════════════════════════════════════════════
// WO-L1A-1 · QuestionAST 确定性解析器单测（PRD §7 V1/V4·acceptance ②③④）
//   - 实体解析三阶梯（exact/unique_name/fuzzy/unresolved）逐值对照 mock 本体真值（不造假）。
//   - R6 双跑字节一致（generatedAt 注入固定值·无 LLM/时钟/随机）。
//   - 边界/空态（空问句·无 classification）。
//   - 契约 round-trip（parse→serialize→parse 字节一致）。
// ═══════════════════════════════════════════════════════════════════════════

const ctx: ToolAuthCtx = { tenantId: "demo", userId: "u1", roles: ["planner"] };

/** mock 本体真值源（seeded·确定性）。getObject 按存储 key 命中；queryObjects 支持 name 精确过滤。 */
interface Row {
  id: string;
  type: string;
  props: Record<string, unknown>;
}
const DATASET: Record<string, Row[]> = {
  Base: [{ id: "常州", type: "Base", props: { baseId: "cz", name: "常州基地" } }],
  Line: [{ id: "PACK02", type: "Line", props: { lineId: "PACK02", name: "PACK02 产线" } }],
  Model: [{ id: "4680-NCM", type: "Model", props: { modelId: "4680-NCM", name: "4680 三元圆柱" } }],
  Order: [{ id: "SO-1", type: "Order", props: { so: "SO-1", name: "订单 SO-1" } }],
};
const TYPE_LABELS: Record<string, string> = { Base: "生产基地", Line: "产线", Model: "型号", Order: "订单" };

function makeOntology(): OntologyClient {
  const notImpl = (): never => {
    throw new Error("not implemented in mock");
  };
  return {
    async getObject(_c, objectType, objectId): Promise<ToolPayload> {
      const row = (DATASET[objectType] ?? []).find((r) => r.id === objectId);
      if (!row) throw new Error(`404 ${objectType}/${objectId}`);
      return { data: { id: row.id, type: row.type, props: row.props }, snapshotVersion: "v1" };
    },
    async queryObjects(_c, objectType, filter, _limit): Promise<ToolPayload> {
      let rows = DATASET[objectType] ?? [];
      const name = (filter as { name?: string }).name;
      if (typeof name === "string") rows = rows.filter((r) => r.props.name === name);
      return { data: rows.map((r) => ({ id: r.id, type: r.type, props: r.props })), snapshotVersion: "v1" };
    },
    async listObjectTypeKeys(): Promise<string[]> {
      return Object.keys(DATASET);
    },
    async listObjectTypes() {
      return Object.keys(DATASET).map((k) => ({
        key: k,
        label: TYPE_LABELS[k] ?? k,
        domain: "battery",
        instanceCount: (DATASET[k] ?? []).length,
      }));
    },
    // 解析器不用的方法——mock 抛错即可（真跑该走 WO-L1A-3）。
    resolveSlice: notImpl,
    planSlice: notImpl,
    aggregateObjects: notImpl,
    getSimClock: notImpl,
    getScenarioPack: notImpl,
    crossValidate: notImpl,
    fillData: notImpl,
    provisionWorld: notImpl,
    validateOutput: notImpl,
    queryMetaOntology: notImpl,
    getMetaBreakpoint: notImpl,
    metaImpact: notImpl,
  } as unknown as OntologyClient;
}

const GEN_AT = "2026-07-11T00:00:00.000Z";

function classificationOf(slots: Record<string, unknown>): ClassificationResult {
  return {
    candidates: [{ intentKey: "affected_orders", confidence: 0.92 }],
    outOfCatalog: false,
    extractedSlots: slots,
    latencyMs: 0,
    model: "deterministic:test",
  };
}

describe("QuestionAST 解析器 · 实体三阶梯（逐值对照 mock 真值）", () => {
  it("exact / unique_name / type-mention 各命中并带真 objectId", async () => {
    const ast = await parseQuestionAst({
      taskId: "task1",
      tenantId: "demo",
      rawText: "未来30天常州基地PACK02产线停机20%，影响哪些订单？",
      classification: classificationOf({ base: "常州基地", line: "PACK02", model: "4680-NCM" }),
      ontology: makeOntology(),
      authCtx: ctx,
      generatedAt: GEN_AT,
    });

    // 契约合法
    expect(() => QuestionAstSchema.parse(ast)).not.toThrow();

    const byText = (t: string) => ast.entities.find((e) => e.text === t);

    // ② unique_name：跨类型唯一名 → Base·objectId=props.baseId 真值 "cz"（逐值对照 mock）。
    const cz = byText("常州基地");
    expect(cz).toBeTruthy();
    expect(cz!.ontologyType).toBe("Base");
    expect(cz!.objectId).toBe("cz");
    expect(cz!.source).toBe("unique_name");
    expect(cz!.resolved).toBe(true);

    // ① exact：id/PK 命中 → Line·objectId="PACK02" 真值。
    const pack = byText("PACK02");
    expect(pack).toBeTruthy();
    expect(pack!.ontologyType).toBe("Line");
    expect(pack!.objectId).toBe("PACK02");
    expect(pack!.source).toBe("exact");

    // 型号 exact（不在问句原文·仅 slots·仍解析）。
    const model = byText("4680-NCM");
    expect(model!.ontologyType).toBe("Model");
    expect(model!.source).toBe("exact");

    // 类型级提及 "订单" → Order（objectId=null·resolved=true）。
    const order = ast.entities.find((e) => e.ontologyType === "Order");
    expect(order).toBeTruthy();
    expect(order!.objectId).toBeNull();

    // 动作：SHUTDOWN·量保留原文 "20%"·targetType 取前置已解析实体类型（Line）。
    expect(ast.actions).toHaveLength(1);
    expect(ast.actions[0].type).toBe("SHUTDOWN");
    expect(ast.actions[0].value).toBe("20%");
    expect(ast.actions[0].targetType).toBe("Line");

    // 时间：未来30天 → FUTURE_WINDOW(30, DAY)。
    expect(ast.timeScope).toEqual({ kind: "FUTURE_WINDOW", from: null, to: null, window: 30, granularity: "DAY" });

    // 意图：不重造分类·消费 classification。
    expect(ast.intent.intentKey).toBe("affected_orders");
    expect(ast.intent.problemClass).not.toBe("");
    expect(ast.parserVersion).toBe(QUESTION_AST_PARSER_VERSION);
  });

  it("fuzzy 近邻仅澄清不自动绑（resolved=false·source=fuzzy）", async () => {
    const ast = await parseQuestionAst({
      taskId: "t2",
      tenantId: "demo",
      rawText: "常州基产能如何？",
      classification: classificationOf({ base: "常州基" }), // 子串·非精确名
      ontology: makeOntology(),
      authCtx: ctx,
      generatedAt: GEN_AT,
    });
    const e = ast.entities.find((x) => x.text === "常州基");
    expect(e).toBeTruthy();
    expect(e!.source).toBe("fuzzy");
    expect(e!.resolved).toBe(false);
    expect(e!.ontologyType).toBe("Base");
  });

  it("unresolved 域外诚实不臆造（objectId=null·confidence=0）", async () => {
    const ast = await parseQuestionAst({
      taskId: "t3",
      tenantId: "demo",
      rawText: "火星工厂怎么样？",
      classification: classificationOf({ base: "火星工厂" }),
      ontology: makeOntology(),
      authCtx: ctx,
      generatedAt: GEN_AT,
    });
    const e = ast.entities.find((x) => x.text === "火星工厂");
    expect(e).toBeTruthy();
    expect(e!.source).toBe("unresolved");
    expect(e!.objectId).toBeNull();
    expect(e!.ontologyType).toBeNull();
    expect(e!.confidence).toBe(0);
  });
});

describe("QuestionAST 解析器 · 约束/目标抽取", () => {
  it("成本最低→OBJECTIVE MIN·不能延期→HARD", async () => {
    const ast = await parseQuestionAst({
      taskId: "t4",
      tenantId: "demo",
      rawText: "成本最低，不能延期",
      classification: classificationOf({}),
      ontology: makeOntology(),
      authCtx: ctx,
      generatedAt: GEN_AT,
    });
    const obj = ast.constraints.find((c) => c.kind === "OBJECTIVE");
    expect(obj).toBeTruthy();
    expect(obj!.direction).toBe("MIN");
    expect(ast.objectives.some((o) => o.startsWith("MIN:"))).toBe(true);
    expect(ast.constraints.some((c) => c.kind === "HARD")).toBe(true);
  });
});

describe("QuestionAST 解析器 · R6 双跑字节一致", () => {
  it("同 (query, classification, 快照, generatedAt) → JSON 字节一致", async () => {
    const args = {
      taskId: "t5",
      tenantId: "demo",
      rawText: "未来30天常州基地PACK02产线停机20%，影响哪些订单？",
      classification: classificationOf({ base: "常州基地", line: "PACK02" }),
      authCtx: ctx,
      generatedAt: GEN_AT,
    };
    const a = await parseQuestionAst({ ...args, ontology: makeOntology() });
    const b = await parseQuestionAst({ ...args, ontology: makeOntology() });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("QuestionAST 解析器 · 边界/空态", () => {
  it("空问句 + 无 classification → 合法 AST·空集合·intent 降级", async () => {
    const ast = await parseQuestionAst({
      taskId: "t6",
      tenantId: "demo",
      rawText: "",
      classification: undefined,
      ontology: makeOntology(),
      authCtx: ctx,
      generatedAt: GEN_AT,
    });
    expect(() => QuestionAstSchema.parse(ast)).not.toThrow();
    expect(ast.entities).toEqual([]);
    expect(ast.actions).toEqual([]);
    expect(ast.timeScope).toBeNull();
    expect(ast.intent.intentKey).toBeNull();
    expect(ast.intent.confidence).toBe(0);
  });

  it("本体读全失败（listObjectTypeKeys 抛错）→ 不崩·实体降级 unresolved", async () => {
    const brokenOntology = {
      async listObjectTypeKeys() {
        throw new Error("datacore down");
      },
      async listObjectTypes() {
        throw new Error("datacore down");
      },
      async getObject() {
        throw new Error("datacore down");
      },
      async queryObjects() {
        throw new Error("datacore down");
      },
    } as unknown as OntologyClient;
    const ast = await parseQuestionAst({
      taskId: "t7",
      tenantId: "demo",
      rawText: "常州基地停机",
      classification: classificationOf({ base: "常州基地" }),
      ontology: brokenOntology,
      authCtx: ctx,
      generatedAt: GEN_AT,
    });
    expect(() => QuestionAstSchema.parse(ast)).not.toThrow();
    const e = ast.entities.find((x) => x.text === "常州基地");
    expect(e!.source).toBe("unresolved");
  });
});

describe("RequirementGraph 契约 · round-trip（parse/serialize）", () => {
  it("QuestionAst round-trip 字节一致", async () => {
    const ast = await parseQuestionAst({
      taskId: "t8",
      tenantId: "demo",
      rawText: "未来30天常州基地PACK02产线停机20%，影响哪些订单？",
      classification: classificationOf({ base: "常州基地", line: "PACK02" }),
      ontology: makeOntology(),
      authCtx: ctx,
      generatedAt: GEN_AT,
    });
    const s1 = JSON.stringify(ast);
    const reparsed = QuestionAstSchema.parse(JSON.parse(s1));
    expect(JSON.stringify(reparsed)).toBe(s1);
  });

  it("RequirementGraph schema round-trip（含默认值填充稳定）", () => {
    const ast = QuestionAstSchema.parse({
      astId: "ast_x",
      taskId: "tx",
      tenantId: "demo",
      rawText: "q",
      intent: { problemClass: "forward_projection", intentKey: "fp", confidence: 0.8 },
      entities: [],
      actions: [],
      constraints: [],
      timeScope: null,
      objectives: [],
      outputs: [],
      parserVersion: QUESTION_AST_PARSER_VERSION,
      generatedAt: GEN_AT,
    });
    const graph = {
      graphId: "rg_x",
      taskId: "tx",
      tenantId: "demo",
      questionAst: ast,
      nodes: [
        {
          nodeId: "n1",
          kind: "solver" as const,
          name: "forward_projection",
          ontologyType: null,
          roleType: null,
          solverKey: "forward_projection",
          required: true,
          confidence: 1,
          source: "coverage:forward_projection",
          refKey: "forward_projection",
        },
      ],
      edges: [{ edgeId: "e1", from: "n0", to: "n1", kind: "requires" as const }],
      problemClass: "forward_projection",
      solverCandidates: ["forward_projection"],
      dataRequirements: [{ roleType: "capacity_rollup", minRows: 1 }],
      sliceTargets: { rootType: "Base", targets: ["Line", "Order"] },
      coverageScore: 1,
      builderVersion: "rg-builder/1.0.0",
      generatedAt: GEN_AT,
    };
    const parsed = RequirementGraphSchema.parse(graph);
    expect(JSON.stringify(RequirementGraphSchema.parse(JSON.parse(JSON.stringify(parsed))))).toBe(
      JSON.stringify(parsed),
    );
    expect(parsed.solverCandidates).toEqual(["forward_projection"]);
  });
});
