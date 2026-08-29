import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { AgentRunRecordSchema } from "@platform/contracts";
import { server } from "./setup";
import { loginAs, renderApp } from "./utils";

/**
 * WO-BEFE-C · **两条「后端注册了、前端零调用方」端点的接缝门**
 * （门 `befe-seam:check` 载体② · 断点 `G-BE-FE-SEAM-DEAD`）。
 *
 * 本文件只咬本体 §8 白纸黑字点名的那两条 —— 它们不是"猜出来的缺口"，
 * 是本体里已经把断点位置写死、只等前端接上的两条：
 *
 *   ① `GET /b/v1/agents/:id/runs`（`apps/agentcore/src/server.ts:766`）
 *      → `G-AGENTRUN-NO-AGENT-ATTRIBUTION`：「读端 HTTP 已在，但前端消费方本次未收编」
 *   ② `GET /b/v1/queries/:taskId/agent-runs`（`apps/agentcore/src/server.ts:552`，
 *      前端走 `/b/v1` 别名，后端注册在 `/api/v1`，`server.ts rewriteUrl` 单源重写）
 *      → `G-AGENTRUN-FANOUT-NOT-PERSISTED`：「⛔ 断在此处：前端 AgentsPage「来源列」未接线」
 *
 * ── 本文件要证的那**一句话** ────────────────────────────────────────────────
 * 「**这个 Agent 跑过几次、其中几次是被会诊叫去的**」必须在屏上真看得见。
 * 这句话需要两个读端合起来才答得完整，缺任一条都答不了：
 *   · ① 按 **Agent** 聚合 → 回答"几次"（跨版本，含被扇出的那些）
 *   · ② 按 **任务** 聚合 → 回答"哪一次是被会诊叫去的、被哪个步骤叫的"
 *
 * ── 为什么**不** `vi.mock("@/api/endpoints")` ────────────────────────────────
 * 那会把病灶所在的那一跳一起 mock 掉：URL 模板、别名前缀、响应解构全都不参与，
 * 于是断言恒绿而缺口仍在（本仓假绿第 9 形态 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 就死在这上面）。
 * 本文件走**真 endpoints**、真路由渲染，在 MSW 层拦**真实 URL**——咬的是链路，不是函数。
 *
 * ── 契约同源 ────────────────────────────────────────────────────────────────
 * 覆写用的 fixture 一律先 `AgentRunRecordSchema.parse(...)` 再交给 MSW。真后端也是
 * `AgentRunRecordSchema.parse(...)` 之后才下发（`agentcore/src/server.ts:776`），
 * 故「mock 能过 schema」⇒「mock 形状 = 真后端形状」。
 */

/** 会诊那条任务：**顶层 0 条 + 扇出 1 条**（`mocks/handlers.ts` 的 `run-fanout-1`）。 */
const CONSULT_TASK = "task-consult-1";

/**
 * `AgentBudgetSchema` 的五个必填项（`packages/contracts/src/qos.ts:657`）。
 * ⚠️ 不许写 `budget: {}` —— 那样 `AgentRunRecordSchema.parse` 会抛 ZodError，
 * 而 MSW 里抛出的异常表现成「handler 查找失败」→ 界面永远停在"加载中…"，
 * 报错长得像**组件没接线**，其实是**测试夹具形状不对**。本单实测踩过，故钉在这里。
 */
const BUDGET = { maxIterations: 8, maxToolCalls: 10, maxSolverCalls: 8, maxDurationMs: 600_000, maxClarifications: 0 };

async function openConsole() {
  loginAs("planner");
  renderApp("/admin/agents");
  return screen.findByTestId("agent-console");
}

/** 展开运行列表里 query 文案含 `needle` 的那一行，返回它的明细区。 */
async function openRunByQuery(needle: string) {
  const user = userEvent.setup();
  await openConsole();
  const rows = await screen.findAllByTestId("agent-run-row");
  const row = rows.find((r) => (r.textContent ?? "").includes(needle));
  expect(row, `运行列表里找不到含「${needle}」的任务行`).toBeTruthy();
  await user.click(row!);
  return { user, detail: await screen.findByTestId("agent-run-detail") };
}

describe("WO-BEFE-C · 接缝① GET /b/v1/agents/:id/runs（这个 Agent 跑过几次）", () => {
  it("选中 Agent → 屏上出现**这个 Agent** 的运行数，且其中被会诊叫去的那次可辨", async () => {
    const user = userEvent.setup();
    await openConsole();
    await user.click(await screen.findByText("探索分析 Agent"));

    const own = await screen.findByTestId("agent-own-runs");
    // 3 = 直接运行 v2 + 直接运行 v1 + 被会诊扇出的 1 次（后者此前根本不落库）
    expect(within(own).getByTestId("kpi-own-runs").textContent).toContain("3");
    const origins = within(own).getAllByTestId("own-run-origin").map((e) => e.textContent);
    expect(origins.filter((x) => x === "会诊扇出").length).toBe(1);
    expect(origins.filter((x) => x === "直接运行").length).toBe(2);
  });

  it("变异反证：后端把那条会诊扇出的运行拿掉 → 屏上数字必须从 3 掉到 2 且「会诊扇出」消失", async () => {
    server.use(
      http.get("*/b/v1/agents/:id/runs", () =>
        HttpResponse.json({
          agentId: "agt-explore",
          agentKey: "explore_agent",
          runs: [
            AgentRunRecordSchema.parse({
              id: "run-explore-2", taskId: "task-explore-2", model: "m", iterations: [],
              budget: BUDGET, budgetExhausted: false, totalInputTokens: 1, totalOutputTokens: 1,
              agentKey: "explore_agent", agentVersion: 2, attribution: "REGISTERED", origin: "ROOT",
            }),
            AgentRunRecordSchema.parse({
              id: "run-explore-1", taskId: "task-explore-1", model: "m", iterations: [],
              budget: BUDGET, budgetExhausted: false, totalInputTokens: 1, totalOutputTokens: 1,
              agentKey: "explore_agent", agentVersion: 1, attribution: "REGISTERED", origin: "ROOT",
            }),
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    await openConsole();
    await user.click(await screen.findByText("探索分析 Agent"));

    const own = await screen.findByTestId("agent-own-runs");
    expect(within(own).getByTestId("kpi-own-runs").textContent).toContain("2");
    expect(within(own).getAllByTestId("own-run-origin").map((e) => e.textContent)).not.toContain("会诊扇出");
  });
});

describe("WO-BEFE-C · 接缝② GET /b/v1/queries/:taskId/agent-runs（这一次会诊叫了谁）", () => {
  it("展开会诊任务 → 屏上出现本次全部运行：条数 · 来源 · 扇出步骤 · 执行 Agent 全部来自后端", async () => {
    const { detail } = await openRunByQuery("多角色会诊");
    const panel = within(detail).getByTestId("task-agent-runs");

    expect(within(panel).getByTestId("kpi-task-runs").textContent).toContain("1");
    expect(within(panel).getByTestId("kpi-task-runs-fanout").textContent).toContain("1");

    const rows = within(panel).getAllByTestId("task-agent-run-row");
    expect(rows.length).toBe(1);
    // 三个字段逐个对得上 mock 里那条 `run-fanout-1`，不是示意值
    expect(within(panel).getByTestId("task-run-origin").textContent).toBe("会诊扇出");
    expect(within(panel).getByTestId("task-run-step").textContent).toBe("dispatch_0");
    expect(within(panel).getByTestId("task-run-agent").textContent).toContain("explore_agent");
    expect(within(panel).getByTestId("task-run-agent").textContent).toContain("v2");
  });

  it("诚实位 · **顶层 0 条 + 扇出 1 条**两句同时为真：单数端点如实 404，复数端点仍列出子运行", async () => {
    const { detail } = await openRunByQuery("多角色会诊");
    // 单数读端（既有）：这个任务自己没跑循环 → 诚实说「未进入 Agent 循环」
    expect(within(detail).getByTestId("agent-run-absent")).toBeTruthy();
    // 复数读端（本单新接）：可是它真叫了一个角色去跑 —— 不接这条，用户只会看到上面那句
    const panel = within(detail).getByTestId("task-agent-runs");
    expect(within(panel).getAllByTestId("task-agent-run-row").length).toBe(1);
    // 并且必须把「这两句不矛盾」明说出来，而不是让用户自己猜。
    // ⚠ 2026-08-17 WO-SCREEN-PLAINSPEAK-ADMIN 把文案从「**同时为真**」（未渲染的 md 星号 +
    //   逻辑学腔）改成「两句都是真的 …… 不是自相矛盾」。断言随之改咬**这句话的意思**
    //   （明说了两句不矛盾），而不是某个特定措辞 —— 但仍然是硬断言：
    //   把这句解释删掉或改成不解释，这里照样红。
    expect(within(panel).getByTestId("task-agent-runs-rootless").textContent).toContain("不是自相矛盾");
  });

  it("变异反证：后端多返一条顶层运行 → 条数、扇出数、rootless 说明必须同时跟着变", async () => {
    server.use(
      http.get("*/b/v1/queries/:taskId/agent-runs", ({ params }) =>
        HttpResponse.json({
          taskId: String(params.taskId),
          runs: [
            AgentRunRecordSchema.parse({
              id: "run-root-x", taskId: CONSULT_TASK, model: "m", iterations: [],
              budget: BUDGET, budgetExhausted: false, totalInputTokens: 1, totalOutputTokens: 1,
              agentKey: "coordinator", agentVersion: 1, attribution: "REGISTERED", origin: "ROOT",
            }),
            AgentRunRecordSchema.parse({
              id: "run-fanout-1", taskId: CONSULT_TASK, model: "m", iterations: [],
              budget: BUDGET, budgetExhausted: false, totalInputTokens: 1, totalOutputTokens: 1,
              agentKey: "explore_agent", agentVersion: 2, attribution: "REGISTERED",
              origin: "FANOUT", stepId: "dispatch_0",
            }),
          ],
        }),
      ),
    );
    const { detail } = await openRunByQuery("多角色会诊");
    const panel = within(detail).getByTestId("task-agent-runs");
    expect(within(panel).getByTestId("kpi-task-runs").textContent).toContain("2"); // 1 → 2
    expect(within(panel).getByTestId("kpi-task-runs-fanout").textContent).toContain("1"); // 扇出仍是 1
    expect(within(panel).getAllByTestId("task-agent-run-row").length).toBe(2);
    // 有了顶层那条就不再是 rootless ⇒ 那条说明必须消失（不是恒显的装饰）
    expect(within(panel).queryByTestId("task-agent-runs-rootless")).toBeNull();
  });

  it("诚实位 · 本次一条运行都没有 → 说清何时才会有，**不许**摆 0 值 KPI 充数", async () => {
    server.use(
      http.get("*/b/v1/queries/:taskId/agent-runs", ({ params }) =>
        HttpResponse.json({ taskId: String(params.taskId), runs: [] }),
      ),
    );
    const { detail } = await openRunByQuery("多角色会诊");
    const panel = within(detail).getByTestId("task-agent-runs");
    expect(within(panel).getByTestId("task-agent-runs-empty").textContent).toContain("真值，不是加载失败");
    expect(within(panel).queryByTestId("kpi-task-runs")).toBeNull();
    expect(within(panel).queryByTestId("task-agent-run-row")).toBeNull();
  });

  it("诚实位 · 缺 `origin` 的旧记录显示「—」，**不冒充**「直接运行」", async () => {
    server.use(
      http.get("*/b/v1/queries/:taskId/agent-runs", ({ params }) =>
        HttpResponse.json({
          taskId: String(params.taskId),
          // 无 origin / 无 stepId / 无 agentKey：本字段上线前写下的旧记录
          runs: [
            AgentRunRecordSchema.parse({
              id: "run-legacy-x", taskId: CONSULT_TASK, model: "m", iterations: [],
              budget: BUDGET, budgetExhausted: false, totalInputTokens: 1, totalOutputTokens: 1,
            }),
          ],
        }),
      ),
    );
    const { detail } = await openRunByQuery("多角色会诊");
    const panel = within(detail).getByTestId("task-agent-runs");
    expect(within(panel).getByTestId("task-run-origin").textContent).toBe("—");
    expect(within(panel).getByTestId("task-run-step").textContent).toBe("—");
    expect(within(panel).getByTestId("task-run-agent").textContent).toBe("—");
    // 「我没找到」≠「它不存在」：旧记录既不许被读成 ROOT，也不许被读成 FANOUT
    expect(within(panel).getByTestId("task-run-origin").textContent).not.toBe("直接运行");
    expect(within(panel).getByTestId("task-run-origin").textContent).not.toBe("会诊扇出");
  });
});
