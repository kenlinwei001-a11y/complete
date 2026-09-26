import { describe, expect, it, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { TypeSemantics, TypeSemanticsResponse } from "@platform/contracts";
import {
  buildOntologySemanticContext,
  renderOntologySemanticContext,
  selectSemanticTypeKeys,
} from "../src/agent/ontology-context.js";
import { projectNavigationSlice } from "../src/agent/navigation-slice.js";
import { createHttpDataCore } from "../src/tools/datacore-http.js";
import type { ToolAuthCtx } from "../src/tools/clients.js";

/**
 * WO-QOS-ONTOLOGY-CONTEXT · 口径语义组装器（缺口③·文档三层投喂第二层 B-半 + 驱动接缝组合测）。
 *
 * B-半：renderOntologySemanticContext 纯函数忠实渲染 A 的 type-semantics（无硬编码 mirror）·确定性·只列涉及项。
 * 驱动接缝：真 HttpOntologyClient（createHttpDataCore）经真 HTTP 打一个可变 type-semantics 源 →
 *   buildOntologySemanticContext 端到端 → 断言注入块含口径 + 规则 expression；改源的 description/expression
 *   + 失效缓存 → B 注入块同步变（证口径来自 A 单一真值·非 B 手写 mirror·灭漂移）。数字红线：块只解释口径·标「非数据源」。
 * A-半（datacore type-semantics.test）证端点从真本体+规则派生并随改动同步——两半合闭。
 */

const CTX: ToolAuthCtx = { tenantId: "demo", userId: "u1", roles: ["admin"], debugUser: "demo:u1:admin" };

/** 一份"毛利为什么下滑"的 type-semantics（margin 口径 formula/unit + C-规则 expression）。 */
const marginSemantics = (marginFormula: string, ruleExpr: string): TypeSemantics[] => [
  {
    typeKey: "Metric",
    displayName: "经营指标",
    props: [
      { propKey: "metricKey", description: "指标键", dataType: "string" },
      { propKey: "actual", description: "实际值", unit: "%", dataType: "number" },
      { propKey: "target", description: "目标值", unit: "%", dataType: "number" },
      { propKey: "gap", description: "缺口", dataType: "number" },
    ],
    derived: [{ propKey: "gap", formula: "actual - target" }],
    rules: [],
  },
  {
    typeKey: "FinancePlan",
    displayName: "财务计划",
    props: [
      { propKey: "metricKey", description: "科目键", dataType: "string" },
      { propKey: "marginPct", description: "毛利率", unit: "%", dataType: "number" },
      { propKey: "budget", description: "预算", unit: "万元", dataType: "number" },
    ],
    derived: [{ propKey: "marginPct", formula: marginFormula }],
    rules: [{ key: "C07", name: "毛利地板约束", expression: ruleExpr, severity: "BLOCK" }],
  },
];

describe("WO-QOS-ONTOLOGY-CONTEXT · ontology-context 组装器（B-半·纯渲染）", () => {
  it("selectSemanticTypeKeys = 导航图涉及对象类型（膨胀防护·只涉及项）", () => {
    const slice = {
      domain: "finance",
      objectTypes: [
        { type: "FinancePlan", keyProps: ["marginPct", "budget"] },
        { type: "Metric", keyProps: ["metricKey", "gap"] },
      ],
      solvers: [],
      chain: "",
      rules: [],
      nonEmpty: true,
    };
    expect(selectSemanticTypeKeys(slice)).toEqual(["FinancePlan", "Metric"]);
  });

  it("渲染含指标口径(formula/unit) + 规则 expression·标『供解释·非数据源』·无裸业务数字", () => {
    const slice = {
      domain: "finance",
      objectTypes: [
        { type: "FinancePlan", keyProps: ["marginPct", "budget"] },
        { type: "Metric", keyProps: ["metricKey", "gap"] },
      ],
      solvers: [],
      chain: "",
      rules: [],
      nonEmpty: true,
    };
    const block = renderOntologySemanticContext(slice, marginSemantics("(revenue - cost) / revenue", "FinancePlan.marginPct < 0.15"));
    // 指标口径：毛利率派生公式 + 单位
    expect(block).toContain("marginPct");
    expect(block).toContain("(revenue - cost) / revenue");
    expect(block).toContain("单位:%");
    // 派生 gap 公式
    expect(block).toContain("actual - target");
    // 规则 expression（C-规则）
    expect(block).toContain("C07");
    expect(block).toContain("FinancePlan.marginPct < 0.15");
    expect(block).toContain("[BLOCK]");
    // 数字红线：明确标注供解释·非数据源·仍标 ⟦ref:N⟧
    expect(block).toContain("非数据源");
    expect(block).toContain("⟦ref:N⟧");
  });

  it("只列 slice 涉及项（膨胀防护）：未涉及类型不进块", () => {
    const slice = {
      domain: "finance",
      objectTypes: [{ type: "FinancePlan", keyProps: ["marginPct"] }],
      solvers: [],
      chain: "",
      rules: [],
      nonEmpty: true,
    };
    // semantics 含 Metric，但 slice 只涉及 FinancePlan → Metric 不进块
    const block = renderOntologySemanticContext(slice, marginSemantics("(revenue - cost) / revenue", "FinancePlan.marginPct < 0.15"));
    expect(block).toContain("FinancePlan");
    expect(block).not.toContain("经营指标"); // Metric.displayName 不出现
  });

  it("确定性 R6：同 slice 同 semantics 字节一致", () => {
    const slice = {
      domain: "finance",
      objectTypes: [
        { type: "FinancePlan", keyProps: ["marginPct", "budget"] },
        { type: "Metric", keyProps: ["metricKey", "gap"] },
      ],
      solvers: [],
      chain: "",
      rules: [],
      nonEmpty: true,
    };
    const a = renderOntologySemanticContext(slice, marginSemantics("f1", "e1"));
    const b = renderOntologySemanticContext(slice, marginSemantics("f1", "e1"));
    expect(a).toBe(b);
  });

  it("空 semantics / 无口径 → 返空串（不加噪声）", () => {
    const slice = { domain: "x", objectTypes: [{ type: "T", keyProps: ["k"] }], solvers: [], chain: "", rules: [], nonEmpty: true };
    expect(renderOntologySemanticContext(slice, [])).toBe("");
    // 有类型但无任何口径（description/unit/formula 皆空）→ 空块
    const barren: TypeSemantics[] = [{ typeKey: "T", displayName: "T", props: [{ propKey: "k", dataType: "string" }], derived: [], rules: [] }];
    expect(renderOntologySemanticContext(slice, barren)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 驱动接缝组合测：真 HTTP 客户端 → 可变 A 源 → 端到端注入块随 A 口径改动同步变
// ---------------------------------------------------------------------------

describe("WO-QOS-ONTOLOGY-CONTEXT · SEAM 驱动：改 A 口径/规则 → B 注入块同步变（灭 mirror 漂移）", () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.close();
    server = undefined;
  });

  /** 起一个可变 type-semantics 源（模拟 A 的 GET /a/v1/ontology/type-semantics 契约），返回 baseUrl + store。 */
  async function startMutableSource(store: Map<string, TypeSemantics>): Promise<string> {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? "", "http://localhost");
      if (url.pathname === "/a/v1/ontology/type-semantics") {
        const wanted = (url.searchParams.get("types") ?? "").split(",").filter(Boolean);
        const types = wanted.map((k) => store.get(k)).filter((x): x is TypeSemantics => Boolean(x));
        const body: TypeSemanticsResponse = { types };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
        return;
      }
      res.writeHead(404);
      res.end("{}");
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const port = (server!.address() as AddressInfo).port;
    return `http://127.0.0.1:${port}`;
  }

  it("真深问『毛利为什么下滑』→ 注入块含 A 口径；改 A rule.expression/formula + 失效 → B 块同步变", async () => {
    // 真投影导航图（复用 domainResolve·非手搓 slice）
    const slice = projectNavigationSlice("毛利为什么下滑？各环节拆解归因", undefined, { toolNames: ["invoke_solver"] });
    expect(slice.nonEmpty).toBe(true);

    // 可变源：为 slice 涉及的每个对象类型都备一份口径（含 FinancePlan marginPct 公式 + C 规则）
    const store = new Map<string, TypeSemantics>();
    for (const ot of slice.objectTypes) {
      store.set(ot.type, {
        typeKey: ot.type,
        displayName: `${ot.type}显示名`,
        props: ot.keyProps.map((k) => ({ propKey: k, description: `${k}口径`, unit: "%", dataType: "number" })),
        derived: [{ propKey: ot.keyProps[0] ?? "v", formula: "SUM(x BY y)" }],
        rules: [{ key: "C07", name: "毛利地板约束", expression: "FinancePlan.marginPct < 0.15", severity: "BLOCK" }],
      });
    }
    const baseUrl = await startMutableSource(store);
    const dc = createHttpDataCore(baseUrl);

    const before = await buildOntologySemanticContext(slice, CTX, dc.ontology);
    expect(before).toContain("C07");
    expect(before).toContain("FinancePlan.marginPct < 0.15");
    expect(before).toContain("SUM(x BY y)");
    expect(before).toContain("非数据源");
    expect(before).toContain("⟦ref:N⟧");

    // 改 A 口径真值：规则表达式 + 派生公式
    for (const [, sem] of store) {
      sem.rules = sem.rules.map((r) => ({ ...r, expression: "FinancePlan.marginPct < 0.20", severity: "WARN" as const }));
      sem.derived = sem.derived.map((d) => ({ ...d, formula: "AVG(z BY w)" }));
    }
    // 未失效 → 缓存命中，仍见旧值（证 TTL 缓存生效·不 per-question 打 A）
    const cached = await buildOntologySemanticContext(slice, CTX, dc.ontology);
    expect(cached).toContain("FinancePlan.marginPct < 0.15");

    // 失效（模拟 {kind}.updated 钩子）→ B 块同步取 A 最新真值
    dc.ontology.invalidateTypeSemantics?.(CTX.tenantId);
    const after = await buildOntologySemanticContext(slice, CTX, dc.ontology);
    expect(after).toContain("FinancePlan.marginPct < 0.20");
    expect(after).toContain("AVG(z BY w)");
    expect(after).not.toContain("< 0.15");
  });

  it("fail-open：客户端无 getTypeSemantics（mock）→ 返空块（不阻断查询）", async () => {
    const slice = projectNavigationSlice("毛利为什么下滑", undefined, { toolNames: ["invoke_solver"] });
    const block = await buildOntologySemanticContext(slice, CTX, {});
    expect(block).toBe("");
  });
});
