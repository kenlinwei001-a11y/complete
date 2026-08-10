import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { AgentRunRecordSchema, DecisionTraceSchema } from "@platform/contracts";
import { server } from "./setup";
import { loginAs, renderApp } from "./utils";

/**
 * WO-AGENT-ADMIN-CONSOLE · Agent 运行观测台。
 *
 * **本套件专门盯两件事**（WO §4 的红线）：
 *  ① 界面上的数字必须来自**真实运行数据**，不是 mock 常量或写死的示意值；
 *  ② 后端没有数据时必须变成**诚实态**，既不空白也不画假内容。
 *
 * 所以每条断言都配一条**变异反证**：把后端数据改掉 → 界面必须跟着变。
 * 若改了后端界面纹丝不动，那说明界面根本没在读后端 —— 那才是本仓最怕的假绿。
 *
 * ⚠️ **契约同源**：mock 返回的形状用 `AgentRunRecordSchema` / `DecisionTraceSchema`
 * **当场 parse 一遍**再交给 MSW。真后端也是 `Schema.parse(...)` 之后才下发的
 * （`agentcore/src/server.ts`），故「mock 能过 schema」⇒「mock 形状 = 真后端形状」。
 * 这一步是防「mock 与真后端各写各的」那类接缝坑（本单已在 handlers.ts 里逮到一例真的：
 * `path` 写成 `PATH_A`，而契约枚举只有 `WORKFLOW|AGENT`）。
 */

const RUN_FIXTURE = AgentRunRecordSchema.parse({
  id: "run-seam-1",
  taskId: "task-agent-1",
  model: "claude-opus-4-8",
  iterations: [
    {
      index: 0,
      toolCalls: [
        { toolCallId: "t1", toolName: "discover", input: {}, outcome: "OK", durationMs: 120 },
        { toolCallId: "t2", toolName: "query_objects", input: {}, outcome: "OK", durationMs: 310 },
      ],
    },
    { index: 1, toolCalls: [{ toolCallId: "t3", toolName: "invoke_solver", input: {}, outcome: "OK", durationMs: 1840 }] },
    { index: 2, toolCalls: [{ toolCallId: "t4", toolName: "evaluate_rules", input: {}, outcome: "ERROR", durationMs: 95 }] },
  ],
  budget: { maxIterations: 24, maxToolCalls: 40, maxSolverCalls: 8, maxDurationMs: 600000, maxClarifications: 0, maxDiscoverCalls: 8, maxRoundTrips: 24 },
  budgetExhausted: false,
  totalInputTokens: 18432,
  totalOutputTokens: 2106,
  contextOps: [],
});

async function openConsole() {
  loginAs("planner");
  renderApp("/admin/agents");
  return screen.findByTestId("agent-console");
}

async function openFirstAgentRun() {
  const user = userEvent.setup();
  await openConsole();
  const rows = await screen.findAllByTestId("agent-run-row");
  // 第一条是引擎真跑过的那次（mock 里 task-agent-1）
  await user.click(rows[0]!);
  return { user, detail: await screen.findByTestId("agent-run-detail") };
}

describe("WO-AGENT-ADMIN-CONSOLE · 运行观测台", () => {
  it("① 第一层：KPI 数字由**真实运行列表**算出（不是常量）", async () => {
    await openConsole();
    // mock 的 /b/v1/queries 里 AGENT 路共 4 条、均 COMPLETED；WORKFLOW 路 3 条必须被排除。
    expect((await screen.findByTestId("kpi-total")).textContent).toContain("4");
    expect((await screen.findByTestId("kpi-completed")).textContent).toContain("4");
    expect((await screen.findByTestId("kpi-failed")).textContent).toContain("0");
    const rows = await screen.findAllByTestId("agent-run-row");
    expect(rows.length).toBe(4);
  });

  it("① 变异反证：后端多返一条 FAILED 的 AGENT 运行 → KPI 必须跟着变（证明不是写死的）", async () => {
    server.use(
      http.get("*/b/v1/queries", () =>
        HttpResponse.json({
          items: [
            { taskId: "task-agent-1", query: "真运行", path: "AGENT", status: "COMPLETED", view: "dash", conversationId: "c1", classification: null, answerSummary: "", createdAt: "2026-06-16T10:20:00Z", completedAt: "2026-06-16T10:20:31Z" },
            { taskId: "task-agent-9", query: "炸掉的那次", path: "AGENT", status: "FAILED", view: "dash", conversationId: "c9", classification: null, answerSummary: "", createdAt: "2026-06-16T11:00:00Z", completedAt: null },
            { taskId: "task-wf-1", query: "工作流路（必须被排除）", path: "WORKFLOW", status: "COMPLETED", view: "dash", conversationId: "cw", classification: null, answerSummary: "", createdAt: "2026-06-16T08:00:00Z", completedAt: null },
          ],
          total: 3,
        }),
      ),
    );
    await openConsole();
    expect((await screen.findByTestId("kpi-total")).textContent).toContain("2"); // WORKFLOW 那条被排除
    expect((await screen.findByTestId("kpi-failed")).textContent).toContain("1"); // 从 0 变 1
    expect((await screen.findByTestId("kpi-completed")).textContent).toContain("1");
  });

  it("② 第二层：展开一次运行 → 状态机高亮**这次真实到达**的那一态", async () => {
    const { detail } = await openFirstAgentRun();
    const machine = within(detail).getByTestId("agent-state-machine");
    const on = Array.from(machine.querySelectorAll('[data-on="1"]'));
    // 有且只有一个高亮态，且是该运行的真实状态（COMPLETED → 已完成）
    expect(on.length).toBe(1);
    expect(on[0]!.textContent).toContain("已完成");
  });

  it("② 变异反证：同一条运行改成 FAILED → 高亮必须换到「失败」", async () => {
    server.use(
      http.get("*/b/v1/queries", () =>
        HttpResponse.json({
          items: [
            { taskId: "task-agent-1", query: "真运行", path: "AGENT", status: "FAILED", view: "dash", conversationId: "c1", classification: null, answerSummary: "", createdAt: "2026-06-16T10:20:00Z", completedAt: null },
          ],
          total: 1,
        }),
      ),
    );
    const { detail } = await openFirstAgentRun();
    const on = Array.from(within(detail).getByTestId("agent-state-machine").querySelectorAll('[data-on="1"]'));
    expect(on.length).toBe(1);
    expect(on[0]!.textContent).toContain("失败");
  });

  it("③ 上下文工程：迭代/工具/token 全部来自 run 记录（逐个对得上，不是示意值）", async () => {
    server.use(http.get("*/b/v1/queries/:taskId/agent-run", () => HttpResponse.json(RUN_FIXTURE)));
    const { detail } = await openFirstAgentRun();
    const q = (id: string) => within(detail).getByTestId(id).textContent ?? "";
    expect(q("stat-iterations")).toContain("3"); // 3 轮
    expect(q("stat-toolcalls")).toContain("4"); // 2 + 1 + 1
    expect(q("stat-tokens-in")).toContain("18432");
    expect(q("stat-tokens-out")).toContain("2106");
    expect(q("stat-budget")).toContain("否"); // budgetExhausted:false
  });

  it("③ 变异反证：run 记录改数 → 界面数字必须跟着改（证明没读死值）", async () => {
    server.use(
      http.get("*/b/v1/queries/:taskId/agent-run", () =>
        HttpResponse.json(
          AgentRunRecordSchema.parse({
            ...RUN_FIXTURE,
            iterations: [{ index: 0, toolCalls: [{ toolCallId: "x", toolName: "discover", input: {}, outcome: "OK", durationMs: 1 }] }],
            totalInputTokens: 77,
            totalOutputTokens: 88,
            budgetExhausted: true,
          }),
        ),
      ),
    );
    const { detail } = await openFirstAgentRun();
    const q = (id: string) => within(detail).getByTestId(id).textContent ?? "";
    expect(q("stat-iterations")).toContain("1");
    expect(q("stat-toolcalls")).toContain("1");
    expect(q("stat-tokens-in")).toContain("77");
    expect(q("stat-tokens-out")).toContain("88");
    expect(q("stat-budget")).toContain("是");
  });

  it("④ 诚实位 · 上下文清理 0 次 → 显示真数 0 **且**说明为什么，不是留白", async () => {
    server.use(http.get("*/b/v1/queries/:taskId/agent-run", () => HttpResponse.json(RUN_FIXTURE)));
    const { detail } = await openFirstAgentRun();
    expect(within(detail).getByTestId("stat-context-ops").textContent).toContain("0");
    // 记号必须留在第一层（规范 §1：静默降层等于删除）
    expect(within(detail).getByTestId("agent-ctx-zero-note")).toBeTruthy();
    // 口径进浮层：? 触发器可达
    expect(within(detail).getByTestId("info-ctx-task-agent-1")).toBeTruthy();
  });

  it("④ 变异反证：后端真给出 contextOps → 计数变、诚实说明消失（不是恒显的装饰）", async () => {
    server.use(
      http.get("*/b/v1/queries/:taskId/agent-run", () =>
        HttpResponse.json(
          AgentRunRecordSchema.parse({
            ...RUN_FIXTURE,
            contextOps: [
              { op: "fold", iteration: 2, detail: "folded iteration 0" },
              { op: "force_finalize", iteration: 5, detail: "hard threshold" },
            ],
          }),
        ),
      ),
    );
    const { detail } = await openFirstAgentRun();
    expect(within(detail).getByTestId("stat-context-ops").textContent).toContain("2");
    expect(within(detail).queryByTestId("agent-ctx-zero-note")).toBeNull();
  });

  it("⑤ 诚实位 · AGENT 路但引擎没进循环（404 AGENT_RUN_NOT_FOUND）→ 说清楚 + 给路，且**不渲染任何假数字**", async () => {
    const user = userEvent.setup();
    await openConsole();
    const rows = await screen.findAllByTestId("agent-run-row");
    // 第二条是 mock 里走「未接 LLM 诚实降级」的那次
    await user.click(rows[1]!);
    const detail = await screen.findByTestId("agent-run-detail");
    expect(within(detail).getByTestId("agent-run-absent")).toBeTruthy();
    expect(within(detail).getByTestId("agent-run-absent").textContent).toContain("未进入 Agent 循环");
    // 关键：不许因为「要有东西看」就把统计块渲染成 0/0/0 —— 那是编造的运行数据
    expect(within(detail).queryByTestId("agent-run-stats")).toBeNull();
    expect(within(detail).queryByTestId("stat-iterations")).toBeNull();
    // 工具调用也必须是诚实空态而不是假行
    expect(within(detail).queryByTestId("agent-toolcall-row")).toBeNull();
    expect(within(detail).getByTestId("agent-toolcalls-empty")).toBeTruthy();
  });

  it("⑥ 工具调用轨迹来自 decision-trace 真数据（含失败调用，不许只显示成功的）", async () => {
    server.use(
      http.get("*/b/v1/queries/:taskId/decision-trace", () =>
        HttpResponse.json(
          DecisionTraceSchema.parse({
            decisionId: "task-agent-1",
            tenantId: "t-demo",
            question: "q",
            status: "COMPLETED",
            path: "AGENT",
            resolvedRefs: [],
            unverifiedNumerics: false,
            provenanceCount: 1,
            ontologyValidation: "NONE",
            humanReviewRequired: false,
            toolCalls: [
              { tool: "query_timeseries_agg", outcome: "OK", durationMs: 42 },
              { tool: "invoke_solver", outcome: "DENIED", durationMs: 7 },
            ],
            createdAt: "2026-06-16T10:20:00Z",
          }),
        ),
      ),
    );
    const { detail } = await openFirstAgentRun();
    const rows = within(detail).getAllByTestId("agent-toolcall-row");
    expect(rows.length).toBe(2);
    expect(rows[0]!.textContent).toContain("query_timeseries_agg");
    expect(rows[1]!.textContent).toContain("DENIED"); // 失败的那条没被藏起来
  });

  it("⑦ 诚实位 · 残余缺口横幅常驻（WO-AGENTRUN-ATTRIBUTION 后**降层不删除**），且口径在 ? 浮层里可读", async () => {
    const user = userEvent.setup();
    await openConsole();
    const banner = await screen.findByTestId("agent-console-attribution");
    // 归属上线后原文「这些运行无法归属」已不成立，继续挂着就是另一种说假话；
    // 但缺口没消失，只是缩小了 —— 横幅必须**逐条**说出还剩哪几类归不上。
    expect(banner.textContent).toContain("不是每一次运行都归得上");
    expect(banner.textContent).toContain("探索");
    expect(banner.textContent).toContain("旧记录");
    expect(banner.textContent).toContain("会诊"); // 多角色扇出的子运行今天根本没落库
    // 浮层：点击必须能打开（onClick 幂等 setOpen(true) —— 取反会被 focus 抢先关回去）
    await user.click(within(banner).getByTestId("info-agent-attribution"));
    const body = await screen.findByTestId("info-body-agent-attribution");
    expect(body.textContent).toContain("agentId");
    expect(body.textContent).toContain("EXPLORATORY");
    // 规范 §2：必须是受控 DOM 浮层 + 全局 popover-surface，不许自写背景
    expect(body.className).toContain("popover-surface");
  });

  it("⑧ Context Manager 五段**一个字都不许出现**（取证结论：无承载物 → 不放占位）", async () => {
    const { detail } = await openFirstAgentRun();
    const page = detail.ownerDocument.body.textContent ?? "";
    for (const word of ["Retriever", "Ranker", "Compressor", "Assembler", "检索器", "重排", "组装器"]) {
      expect(page).not.toContain(word);
    }
  });

  it("⑨ 真空态：后端一条 AGENT 运行都没有 → 说明怎么才会有，而不是空白/假清单", async () => {
    server.use(http.get("*/b/v1/queries", () => HttpResponse.json({ items: [], total: 0 })));
    await openConsole();
    expect((await screen.findByTestId("agent-console-empty")).textContent).toContain("还没有");
    expect(screen.queryByTestId("agent-run-row")).toBeNull();
    expect(screen.queryByTestId("kpi-total")).toBeNull(); // 没有运行就不摆 0 值 KPI 充数
  });

  // -------------------------------------------------------------------------
  // WO-AGENTRUN-ATTRIBUTION · 「本 Agent 的运行」—— 归属已可得的那一半
  //
  // 这几条盯的是本单的命门：**选中哪个 Agent，数字必须跟着变**。
  // 若换一个 Agent 数字纹丝不动，那说明界面根本没按 agentId 取数，只是把租户级清单
  // 换了个标题挂上去 —— 那正是本单要消灭的那种假象（比不做更糟，因为它看起来做了）。
  // -------------------------------------------------------------------------

  it("⑩ 未选中 Agent → 只给引导语，**一个数字都不摆**（没有对象就没有归属可言）", async () => {
    await openConsole();
    expect((await screen.findByTestId("agent-own-runs-none")).textContent).toContain("选中一个 Agent");
    expect(screen.queryByTestId("kpi-own-runs")).toBeNull();
    expect(screen.queryByTestId("agent-own-run-row")).toBeNull();
  });

  it("⑪ 选中 Agent → 列出**这个 Agent** 的历次运行，且跨版本聚合（v1/v2 都在）", async () => {
    const user = userEvent.setup();
    await openConsole();
    await user.click(await screen.findByText("探索分析 Agent"));

    const own = await screen.findByTestId("agent-own-runs");
    expect(within(own).getByTestId("kpi-own-runs").textContent).toContain("2");
    const rows = within(own).getAllByTestId("agent-own-run-row");
    expect(rows.length).toBe(2);
    // 跨版本：同一个 Agent 的 v1 与 v2 各一次（按 id 过滤会当场少一条）
    const versions = within(own).getAllByTestId("own-run-version").map((e) => e.textContent);
    expect(new Set(versions)).toEqual(new Set(["v2", "v1"]));
    // 数字取自 run 记录本身（不是从任务清单猜的）
    expect(within(own).getAllByTestId("own-run-tokens")[0]!.textContent).toContain("9120");
    // 归属不上的那条（EXPLORATORY 的 task-agent-1）**绝不能**混进来
    expect(own.textContent).not.toContain("18432");
  });

  it("⑪ 变异反证：换选另一个 Agent → 数字必须跟着变（证明真按 agentId 取数，不是租户级清单换标题）", async () => {
    const user = userEvent.setup();
    await openConsole();
    await user.click(await screen.findByText("探索分析 Agent"));
    expect(within(await screen.findByTestId("agent-own-runs")).getByTestId("kpi-own-runs").textContent).toContain("2");

    // 周报生成 Agent 一次都没跑过 → 必须变成诚实空态，而不是继续显示上一个 Agent 的 2
    await user.click(screen.getByText("周报生成 Agent（草稿）"));
    const empty = await screen.findByTestId("agent-own-runs-empty");
    expect(empty.textContent).toContain("还没有运行记录");
    expect(screen.queryByTestId("kpi-own-runs")).toBeNull(); // 0 也不摆 KPI 充数
  });

  it("⑫ 诚实位 · 单次运行的归属形态三态可辨（REGISTERED / EXPLORATORY / 上线前未知）", async () => {
    const user = userEvent.setup();
    await openConsole();
    const rows = await screen.findAllByTestId("agent-run-row");

    // rows[0] = task-agent-1：dash 视图自由问句 → 真走探索路，引擎正面标 EXPLORATORY
    await user.click(rows[0]!);
    const d1 = await screen.findByTestId("agent-run-detail");
    expect(within(d1).getByTestId("agent-run-attribution-text").textContent).toContain("没有任何 Agent 定义");
    await user.click(rows[0]!); // 收起

    // rows[2] = task-explore-2：真绑到 explore_agent v2
    await user.click(rows[2]!);
    const d2 = await screen.findByTestId("agent-run-detail");
    const text = within(d2).getByTestId("agent-run-attribution-text").textContent ?? "";
    expect(text).toContain("explore_agent");
    expect(text).toContain("v2");
  });

  it("⑫ 变异反证：后端把归属字段整个拿掉（上线前的旧记录形态）→ 必须说「未知」，**不许**降成「没有 Agent 定义」", async () => {
    server.use(
      http.get("*/b/v1/queries/:taskId/agent-run", () =>
        HttpResponse.json(AgentRunRecordSchema.parse({ ...RUN_FIXTURE })), // 无 attribution / agentId
      ),
    );
    const { detail } = await openFirstAgentRun();
    const text = within(detail).getByTestId("agent-run-attribution-text").textContent ?? "";
    expect(text).toContain("未知");
    // 「我没找到」≠「它不存在」：旧记录不许被当成"确知没有 Agent 定义"
    expect(text).not.toContain("没有任何 Agent 定义");
  });
});
