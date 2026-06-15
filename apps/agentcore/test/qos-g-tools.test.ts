import { beforeEach, describe, expect, it } from "vitest";
import { text, toolUse } from "../src/llm/mock.js";
import { normalizeQuery } from "../src/router/orchestrator.js";
import { fallbackStats } from "../src/ops/fallback.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { pseudoEmbed } from "../src/util/embedding.js";
import {
  ADMIN,
  createTestApp,
  CZ_MANAGER,
  debugHeaders,
  lastToolCallId,
  PLANNER,
  submitQuery,
  TENANT,
  waitForTask,
  type TestApp,
} from "./helpers.js";

const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});

/** T10 structural assertion: payload must not contain raw ts point rows. */
function assertNoRawTsRows(v: unknown, path = "$"): void {
  if (Array.isArray(v)) {
    v.forEach((item, i) => assertNoRawTsRows(item, `${path}[${i}]`));
    return;
  }
  if (v !== null && typeof v === "object") {
    const keys = Object.keys(v as Record<string, unknown>);
    // raw ts_points rows look like { ts|timestamp, value(s) } — forbidden in LLM context
    expect(keys, `raw ts row shape at ${path}`).not.toContain("ts");
    expect(keys, `raw ts row shape at ${path}`).not.toContain("timestamp");
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) assertNoRawTsRows(val, `${path}.${k}`);
  }
}

describe("New builtin tools (QOS-PRD §7.1 additions: search_knowledge / query_timeseries_agg)", () => {
  it("search_knowledge (mock, 3 seeded chunks): topK respected; path B provenance → KB_CHUNK with kb meta", async () => {
    t.llm.queueClassification(OUT_OF_CATALOG);
    t.llm.queueAgentTurn(
      { content: [text("查一下知识库。"), toolUse("search_knowledge", { query: "化成 扩通道 需要什么审批", topK: 2 })] },
      (req) => {
        const tc = lastToolCallId(req);
        return {
          content: [
            toolUse("final_answer", {
              blocks: [{ type: "text", markdown: "扩通道需设备部审批 ⟦ref:0⟧。" }],
              provenance: [{ toolCallId: tc, outputPath: "$.data.hits[0]" }],
            }),
          ],
        };
      },
    );

    const { taskId } = await submitQuery(t, PLANNER, "扩化成通道需要什么流程", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    const calls = await t.repos.toolCalls.listByTask(taskId);
    const kbCall = calls.find((c) => c.toolName === "search_knowledge" && c.outcome === "OK");
    expect(kbCall).toBeDefined();
    const hits = (kbCall?.output as { data: { hits: { docId: string; span: unknown; score: number; source: string }[] } })
      .data.hits;
    expect(hits.length).toBe(2); // topK respected (3 chunks seeded)
    expect(hits[0]?.docId).toBeDefined();
    expect(hits[0]?.span).toBeDefined();
    expect(typeof hits[0]?.score).toBe("number");

    // provenance enriched from the AUDITED tool output (S4.1)
    const prov = task.answer?.provenance[0];
    expect(prov?.source).toBe("KB_CHUNK");
    expect(prov?.toolName).toBe("search_knowledge");
    expect(prov?.kb?.docId).toBe(hits[0]?.docId);
    expect(prov?.kb?.span).toEqual(hits[0]?.span);
    expect(prov?.kb?.sourceName).toBe(hits[0]?.source);
  });

  it("G8: aggregate_objects (path B) returns grouped rows; audit asserts agent did NOT pull full object rows", async () => {
    t.llm.queueClassification(OUT_OF_CATALOG);
    t.llm.queueAgentTurn(
      {
        content: [
          text("用聚合下推对比基地平均利用率。"),
          toolUse("aggregate_objects", {
            typeKey: "Base",
            groupBy: ["kind"],
            metrics: [{ prop: "util", fn: "avg" }, { prop: "baseId", fn: "count" }],
          }),
        ],
      },
      (req) => {
        const tc = lastToolCallId(req);
        return {
          content: [
            toolUse("final_answer", {
              blocks: [{ type: "text", markdown: "储能与动力基地平均利用率对比已完成 ⟦ref:0⟧。" }],
              provenance: [{ toolCallId: tc, outputPath: "$.data.rows" }],
            }),
          ],
        };
      },
    );

    const { taskId } = await submitQuery(t, PLANNER, "对比储能与动力基地的平均利用率", { view: "dash" });
    await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    const calls = await t.repos.toolCalls.listByTask(taskId);
    const aggCall = calls.find((c) => c.toolName === "aggregate_objects" && c.outcome === "OK");
    expect(aggCall).toBeDefined();
    const data = (aggCall?.output as { data: { rows: { group: Record<string, string>; metrics: Record<string, number> }[]; rowCount: number } }).data;
    expect(data.rows.length).toBeGreaterThan(0);
    expect(data.rows.every((r) => typeof r.metrics.avg_util === "number" || r.metrics.avg_util === null)).toBe(true);
    expect(data.rows.every((r) => typeof r.metrics.count_baseId === "number")).toBe(true);
    // G8 审计断言：agent 走聚合下推，未用 query_objects 拉全量行。
    const fullPull = calls.find((c) => c.toolName === "query_objects");
    expect(fullPull).toBeUndefined();
    // 聚合输出是行集（分组数 ≤ 全量基地数），不含逐对象原始行
    for (const r of data.rows) expect("metrics" in r && "group" in r).toBe(true);
  });

  it("query_timeseries_agg (mock): deterministic buckets; path B provenance → TS_AGGREGATE; T10 LLM isolation", async () => {
    t.llm.queueClassification(OUT_OF_CATALOG);
    t.llm.queueAgentTurn(
      {
        content: [
          toolUse("query_timeseries_agg", {
            seriesKey: "oee:base",
            entityIds: ["base_changzhou", "base_hefei"],
            window: { from: "2026-06-01", to: "2026-06-07", grain: "day" },
            agg: "avg",
          }),
        ],
      },
      (req) => {
        const tc = lastToolCallId(req);
        return {
          content: [
            toolUse("final_answer", {
              blocks: [{ type: "text", markdown: "常州近 7 日 OEE 走势平稳 ⟦ref:0⟧。" }],
              provenance: [{ toolCallId: tc, outputPath: "$.data.points" }],
            }),
          ],
        };
      },
    );

    const { taskId } = await submitQuery(t, PLANNER, "常州最近一周 OEE 怎么样", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    const calls = await t.repos.toolCalls.listByTask(taskId);
    const tsCall = calls.find((c) => c.toolName === "query_timeseries_agg" && c.outcome === "OK");
    const data = (tsCall?.output as { data: { points: unknown[]; tsAgg: { aggRunId: string; rowsIn: number } } }).data;
    expect(data.points.length).toBe(14); // 2 entities × 7 day-buckets, aggregates only

    const prov = task.answer?.provenance[0];
    expect(prov?.source).toBe("TS_AGGREGATE");
    expect(prov?.tsAgg?.aggRunId).toBe(data.tsAgg.aggRunId);
    expect(prov?.tsAgg?.specKey).toBe("oee:base@v1");
    expect(prov?.tsAgg?.window).toEqual({ start: "2026-06-01", end: "2026-06-07" });
    expect(prov?.tsAgg?.rowsIn).toBe(data.tsAgg.rowsIn);

    // T10: no tool result entering LLM context contains raw ts point arrays (structural)
    let scanned = 0;
    for (const req of t.llm.agentRequests) {
      for (const m of req.messages) {
        if (typeof m.content === "string") continue;
        for (const b of m.content) {
          if (b.type !== "tool_result" || b.isError) continue;
          const match = /<tool_data[^>]*>([\s\S]*)<\/tool_data>/.exec(b.content);
          if (!match) continue;
          scanned += 1;
          assertNoRawTsRows(JSON.parse(match[1] as string));
        }
      }
    }
    expect(scanned).toBeGreaterThan(0);
  });

  it("query_timeseries_agg mock: ≤120 buckets enforced; base_manager row filtering (常州 only)", async () => {
    // 180 days at grain=day → 400-style rejection asking for a coarser grain
    await expect(
      t.dataCore.timeseries.aggQuery(
        { tenantId: TENANT, userId: "u", roles: ["planner"] },
        {
          seriesKey: "oee:base",
          entityIds: ["base_changzhou"],
          window: { from: "2026-01-01", to: "2026-06-30", grain: "day" },
          agg: "avg",
        },
      ),
    ).rejects.toThrow(/BUCKET_LIMIT_EXCEEDED/);

    // same window at grain=week is fine
    const weekly = await t.dataCore.timeseries.aggQuery(
      { tenantId: TENANT, userId: "u", roles: ["planner"] },
      {
        seriesKey: "oee:base",
        entityIds: ["base_changzhou"],
        window: { from: "2026-01-01", to: "2026-06-30", grain: "week" },
        agg: "avg",
      },
    );
    const weeklyPoints = (weekly.data as { points: { entityId: string }[] }).points;
    expect(weeklyPoints.length).toBeLessThanOrEqual(120);

    // 常州 base_manager only receives 常州 entities (row filtering in the data layer)
    const filtered = await t.dataCore.timeseries.aggQuery(
      { tenantId: TENANT, userId: "u-cz", roles: ["base_manager:常州"] },
      {
        seriesKey: "oee:base",
        entityIds: ["base_changzhou", "base_hefei", "base_yibin"],
        window: { from: "2026-06-01", to: "2026-06-03", grain: "day" },
        agg: "avg",
      },
    );
    const pts = (filtered.data as { points: { entityId: string }[] }).points;
    expect(pts.length).toBe(3);
    expect(new Set(pts.map((p) => p.entityId))).toEqual(new Set(["base_changzhou"]));
  });

  it("base_manager via path B: ts tool results in audit contain only 常州 entities", async () => {
    t.llm.queueClassification(OUT_OF_CATALOG);
    t.llm.queueAgentTurn(
      {
        content: [
          toolUse("query_timeseries_agg", {
            seriesKey: "oee:base",
            entityIds: ["base_changzhou", "base_hefei"],
            window: { from: "2026-06-01", to: "2026-06-02", grain: "day" },
            agg: "avg",
          }),
        ],
      },
      (req) => ({
        content: [
          toolUse("final_answer", {
            blocks: [{ type: "text", markdown: "仅常州可见 ⟦ref:0⟧。" }],
            provenance: [{ toolCallId: lastToolCallId(req), outputPath: "$.data.points" }],
          }),
        ],
      }),
    );
    const { taskId } = await submitQuery(t, CZ_MANAGER, "对比常州和合肥的 OEE", { view: "dash" });
    await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    const calls = await t.repos.toolCalls.listByTask(taskId);
    const tsCall = calls.find((c) => c.toolName === "query_timeseries_agg" && c.outcome === "OK");
    const pts = (tsCall?.output as { data: { points: { entityId: string }[] } }).data.points;
    expect(pts.length).toBeGreaterThan(0);
    expect(pts.every((p) => p.entityId === "base_changzhou")).toBe(true);
  });
});

describe("Provenance passthrough in path A + additive workflow step types (A8.4/S4.1)", () => {
  it("render_answer fromStep on ts-agg / kb steps picks TS_AGGREGATE / KB_CHUNK sources", async () => {
    const result = await t.deps.engine.runWorkflowSteps({
      taskId: "task_prov_a",
      steps: [
        {
          id: "s1",
          type: "query_timeseries_agg",
          params: {
            seriesKey: "oee:base",
            entityIds: ["base_changzhou"],
            window: { from: "2026-06-01", to: "2026-06-03", grain: "day" },
            agg: "avg",
          },
        },
        { id: "s2", type: "search_knowledge", params: { query: "良率波动 8D", topK: 1 } },
        {
          id: "render",
          type: "render_answer",
          params: {
            blocks: [
              { type: "kpi", label: "OEE", value: "{{steps.s1.output.data.points[0].value}}", unit: "%", fromStep: "s1" },
              { type: "text", markdown: "处置依据见知识库 ⟦ref:0⟧⟦ref:1⟧", fromStep: "s2" },
            ],
          },
        },
      ],
      slots: {},
      context: {},
      ctx: { tenantId: TENANT, userId: "u1", roles: ["planner"] },
      nesting: { callChain: [], budget: new BudgetTracker() },
      emit: async () => undefined,
    });

    expect(result.status).toBe("COMPLETED");
    if (result.status !== "COMPLETED") return;
    expect(result.answer.provenance.length).toBe(2);
    const tsProv = result.answer.provenance[0];
    expect(tsProv?.source).toBe("TS_AGGREGATE");
    expect(tsProv?.toolName).toBe("query_timeseries_agg");
    expect(tsProv?.tsAgg?.specKey).toBe("oee:base@v1");
    expect(tsProv?.tsAgg?.rowsIn).toBeGreaterThan(0);
    const kbProv = result.answer.provenance[1];
    expect(kbProv?.source).toBe("KB_CHUNK");
    expect(kbProv?.kb?.docId).toBeDefined();
  });

  it("catalog accepts query_timeseries_agg as a plan step (additive ExtendedPlanStep, contract-gap workaround)", async () => {
    const create = await t.app.inject({
      method: "POST",
      url: "/api/v1/catalog/packages/pkg_battery_manufacturing/plans",
      headers: debugHeaders(ADMIN),
      payload: {
        key: "oee_trend",
        steps: [
          {
            id: "s1",
            type: "query_timeseries_agg",
            params: {
              seriesKey: "oee:base",
              entityIds: ["{{slots.baseId}}"],
              window: { from: "{{slots.from}}", to: "{{slots.to}}", grain: "day" },
              agg: "avg",
            },
          },
          {
            id: "render",
            type: "render_answer",
            params: { blocks: [{ type: "text", markdown: "OEE 趋势 ⟦ref:0⟧", fromStep: "s1" }] },
          },
        ],
      },
    });
    expect(create.statusCode).toBe(201);
    const planId = (create.json() as { id: string }).id;
    const publish = await t.app.inject({
      method: "POST",
      url: `/api/v1/catalog/plans/${planId}/publish`,
      headers: debugHeaders(ADMIN),
    });
    expect(publish.statusCode).toBe(200);
  });
});

describe("S4.2 fallback semantic clustering (string normalization + vector neighbor merge)", () => {
  it("two paraphrases cluster together; unrelated query stays separate", async () => {
    const mk = (id: string, query: string, createdAt: string) => ({
      id,
      taskId: `task_${id}`,
      tenantId: TENANT,
      packageId: "pkg_battery_manufacturing",
      query,
      view: "dash",
      executedPlanSketch: [{ toolName: "query_objects", inputSummary: "{}" }],
      outcome: "ANSWERED" as const,
      createdAt,
      normalizedQuery: normalizeQuery(query),
      embedding: pseudoEmbed(normalizeQuery(query)),
    });
    await t.repos.fallbackTraces.insert(mk("fbt_1", "对比一下储能基地和动力基地的平均利用率", "2026-06-10T00:00:00Z"));
    await t.repos.fallbackTraces.insert(mk("fbt_2", "对比储能基地和动力基地的平均利用率", "2026-06-11T00:00:00Z"));
    await t.repos.fallbackTraces.insert(mk("fbt_3", "帮我看看明天的天气怎么样", "2026-06-11T01:00:00Z"));

    const stats = await fallbackStats(t.repos, { tenantId: TENANT });
    expect(stats.items.length).toBe(2);
    expect(stats.items[0]?.count).toBe(2); // the two paraphrases merged via cosine > 0.9
    expect(stats.items[0]?.querySample).toContain("储能基地");
    expect(stats.items[1]?.count).toBe(1);
  });
});
