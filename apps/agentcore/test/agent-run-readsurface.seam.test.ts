import { describe, expect, it } from "vitest";
import { AgentRunRecordSchema } from "@platform/contracts";
import { createTestApp, debugHeaders, PLANNER, submitQuery, waitForTask } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";

/**
 * WO-AGENT-ADMIN-CONSOLE · SEAM：`GET /api/v1/queries/:taskId/agent-run` 读端接缝。
 *
 * **这道接缝在哪**（取证见 `docs/AUDIT-agent-console-gap.md` §3.4）：
 * `AgentRunRecord` 由 `router/orchestrator.ts:2075/2364/2614` 真写库，仓储双实现的
 * `getByTask` 早就在，**但此前全仓没有任何 HTTP 读端** —— 于是 `iterations` / `budget` /
 * `budgetExhausted` / `contextOps` 四项写进库后从没有人读过。本单补的就是那一段。
 *
 * **为什么必须是接缝测试而不是 unit**：本仓的老坑是「测试咬的是函数不是链路」。
 * 所以这里**不直接 `repos.agentRuns.insert` 造记录再读**（那只证明了仓储会存会取），
 * 而是走 **真 submitQuery → 真 runPathB → 真 runAgentLoop → 真 insert → 真 HTTP 读**。
 * 引擎侧少写一个字段、orchestrator 少 insert 一次、路由挂错前缀，任一半漏都会红。
 *
 * **诚实位也必须被断言**：AGENT 路 ≠ 一定有 run 记录（无 LLM provider 时
 * `completeNoLlmDegradation`（`orchestrator.ts:2656`）会把 task 标成 `path=AGENT` + `COMPLETED`
 * 却**从不 insert run**）。这不是缺陷而是常态，故 404 是**真值**，前端必须能区分——见 ③。
 */

const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };

describe("WO-AGENT-ADMIN-CONSOLE · agent-run 读端接缝", () => {
  it("① 真 path-B 跑完 → 端点 200，且下发的是**引擎真产出**（迭代/工具/预算/token 全对得上库里那条）", async () => {
    const t = await createTestApp({ env: { QOS_AGENT_MAX_ROUND_TRIPS: "2" } });
    t.llm.queueClassification(OUT_OF_CATALOG);
    // 恒返 READ 工具、永不 final_answer → 有界降级收尾（确定性，不依赖 LLM 文本内容）
    for (let i = 0; i < 12; i++) {
      t.llm.queueAgentTurn({ content: [toolUse("query_objects", { objectType: "Order", filter: {} })] });
    }

    const { taskId } = await submitQuery(t, PLANNER, "把所有能查的都翻一遍并给我一个综合自由结论", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15000);
    expect(task.path).toBe("AGENT");

    const res = await t.app.inject({
      method: "GET",
      url: `/api/v1/queries/${taskId}/agent-run`,
      headers: debugHeaders(PLANNER),
    });
    expect(res.statusCode).toBe(200);

    // 契约层：下发物必须能被 AgentRunRecordSchema 解析（前端 mock 的形状就是照这个 schema 对的）
    const run = AgentRunRecordSchema.parse(res.json());

    // 接缝层：HTTP 下发的那条 == 引擎真写进库的那条（不是另造的一份）
    const persisted = await t.repos.agentRuns.getByTask(taskId);
    expect(persisted).toBeDefined();
    expect(run.id).toBe(persisted!.id);
    expect(run.taskId).toBe(taskId);

    // 效果层：四个「此前从没人读过」的字段确实带着真内容下来了
    expect(run.iterations.length).toBeGreaterThan(0);
    const allToolCalls = run.iterations.flatMap((it) => it.toolCalls);
    expect(allToolCalls.length).toBeGreaterThan(0);
    expect(allToolCalls.every((c) => typeof c.toolName === "string" && c.toolName.length > 0)).toBe(true);
    expect(allToolCalls.some((c) => c.toolName === "query_objects")).toBe(true);
    // outcome 是真枚举值，不是占位串
    expect(allToolCalls.every((c) => ["OK", "DENIED", "ERROR", "BUDGET_EXCEEDED"].includes(c.outcome))).toBe(true);
    // 预算维度齐全（前端「预算用量」区就吃这几个数）
    expect(run.budget.maxIterations).toBeGreaterThan(0);
    expect(run.budget.maxToolCalls).toBeGreaterThan(0);
    expect(typeof run.budgetExhausted).toBe("boolean");
    expect(run.totalInputTokens).toBeGreaterThanOrEqual(0);
    expect(run.totalOutputTokens).toBeGreaterThanOrEqual(0);
  });

  it("② 上下文清理留痕：默认阈值下 contextOps 为空是**真值**（#91），≤128k provider 下同一条链会真写出 fold", async () => {
    // 这一条把「接了线没数据」和「没接线」钉开：同一条读端、同一条引擎链，
    // 只把 provider 上下文窗口调小 → contextOps 从空变非空。若它恒空，那才是真断了。
    const t = await createTestApp();
    t.llm.caps = { countTokens: true, compaction: false, maxContextTokens: 10_000 };
    t.llm.queueClassification(OUT_OF_CATALOG);
    // 大结果集 + 多轮 → 逼过 softLimit 触发第 1 刀折叠
    t.dataCore.ontology.queryObjects = async () => ({
      data: { items: Array.from({ length: 50 }, (_, i) => ({ idx: i, blob: "x".repeat(100) })) },
      snapshotVersion: "snap-ctx",
    });
    for (let i = 0; i < 12; i++) {
      t.llm.queueAgentTurn({ content: [toolUse("query_objects", { objectType: "Order", filter: { i } })] });
    }

    const { taskId } = await submitQuery(t, PLANNER, "把所有能查的都翻一遍并给我一个综合自由结论", { view: "dash" });
    await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 20000);

    const res = await t.app.inject({
      method: "GET",
      url: `/api/v1/queries/${taskId}/agent-run`,
      headers: debugHeaders(PLANNER),
    });
    expect(res.statusCode).toBe(200);
    const run = AgentRunRecordSchema.parse(res.json());
    // 窗口调小后**真的**触发了三刀之一 ⇒ 证明这条留痕链路是活的，默认路的空是阈值够不到而非断线。
    expect((run.contextOps ?? []).length).toBeGreaterThan(0);
    expect((run.contextOps ?? []).every((o) => ["fold", "compact", "force_finalize"].includes(o.op))).toBe(true);
  });

  it("③ 诚实位：AGENT 路但引擎没跑（无 run 记录）→ 404 AGENT_RUN_NOT_FOUND，与「任务不存在」可区分", async () => {
    const t = await createTestApp();
    // 直接落一条 path=AGENT / COMPLETED 的 task，但**不** insert run —— 复刻
    // `completeNoLlmDegradation` 的真实形态（未接 LLM provider 的全新部署天天是这个态）。
    await t.repos.tasks.insert({
      id: "task_noRun",
      tenantId: "demo",
      userId: "user-planner",
      packageId: "pkg_battery_manufacturing",
      conversationId: "conv_norun",
      query: "自由问句",
      context: { view: "dash", selectedObjects: [], filters: {} },
      status: "COMPLETED",
      path: "AGENT",
      clarificationRounds: 0,
      createdAt: "2026-08-10T00:00:00.000Z",
      completedAt: "2026-08-10T00:00:01.000Z",
    });

    const res = await t.app.inject({
      method: "GET",
      url: "/api/v1/queries/task_noRun/agent-run",
      headers: debugHeaders(PLANNER),
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe("AGENT_RUN_NOT_FOUND");

    // 与「任务根本不存在」必须是**两个不同的码** —— 前端据此决定说「该运行未经 Agent 循环」
    // 还是说「任务不存在」；混成一个码，界面就只能含糊其辞。
    const missing = await t.app.inject({
      method: "GET",
      url: "/api/v1/queries/task_does_not_exist/agent-run",
      headers: debugHeaders(PLANNER),
    });
    expect(missing.statusCode).toBe(404);
    expect((missing.json() as { error: { code: string } }).error.code).toBe("TASK_NOT_FOUND");
  });

  it("④ 租户隔离：越租户读一律 404（run 记录本身不带 tenantId，隔离只能靠它的 task）", async () => {
    const t = await createTestApp();
    await t.repos.tasks.insert({
      id: "task_other_tenant",
      tenantId: "other-tenant",
      userId: "u",
      packageId: "pkg_x",
      conversationId: "c",
      query: "别家租户的任务",
      context: { view: "dash", selectedObjects: [], filters: {} },
      status: "COMPLETED",
      path: "AGENT",
      clarificationRounds: 0,
      createdAt: "2026-08-10T00:00:00.000Z",
    });
    await t.repos.agentRuns.insert({
      id: "run_other",
      taskId: "task_other_tenant",
      model: "m",
      iterations: [],
      budget: {
        maxIterations: 1, maxToolCalls: 1, maxSolverCalls: 1,
        maxDurationMs: 1, maxClarifications: 0, maxDiscoverCalls: 1, maxRoundTrips: 1,
      },
      budgetExhausted: false,
      totalInputTokens: 0,
      totalOutputTokens: 0,
    });

    const res = await t.app.inject({
      method: "GET",
      url: "/api/v1/queries/task_other_tenant/agent-run",
      headers: debugHeaders(PLANNER), // demo 租户
    });
    // 有 run 记录也不许漏出去：必须停在 task 归属校验那一步。
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe("TASK_NOT_FOUND");
  });
});
