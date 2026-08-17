import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { AgentRunRecordSchema } from "@platform/contracts";
import { server } from "./setup";
import { loginAs, renderApp } from "./utils";

/**
 * WO-DSH-P2-UX（N5）· AgentsPage 内核徽标（`AgentRunRecord.kernel`，additive optional）。
 *
 * 断言面 A1-A5（A8 = agent-admin-console.test.tsx 既有全例绿，不在此文件）：
 *  A1 两态·原生：默认 fixture（run 记录无 kernel 字段）⇒ 列表每行与 RunDetail 都显示「原生」；
 *  A2 两态·外部：契约同源 fixture 带 `kernel:"EXTERNAL"` ⇒ 徽标「外部运行时」；
 *  A3 tooltip 未销账期文案：外部态浮层含「环检测护栏待补」逐字，原生态浮层**不含**（防串态）；
 *  A4 缺失≡原生：显式无 kernel 字段记录 ⇒ 显示「原生」且绝不显示「未知」（与归属三态**不同案**——
 *     归属缺失不可证只能未知；内核缺失由休眠门+出货 compose 可证 ≡ 原生）；
 *  A5 契约同源：fixture 一律 schema.parse；负向臂 `kernel:"dsh"`（非法枚举）被 schema 当场拒，
 *     证明前端读的是契约字段不是自由文本。
 *
 * ⚠️ 契约同源纪律同 agent-admin-console.test.tsx 头注：mock 形状经 `AgentRunRecordSchema.parse`
 * 当场过一遍再交 MSW —— 「mock 能过 schema」⇒「mock 形状 = 真后端形状」。
 *
 * 变异反证（M1/M1′/M4/M5）：KernelBadge 恒取 "EXTERNAL" ⇒ A1 红；恒取 "NATIVE" ⇒ A2 红；
 * locale 外部浮层删「环检测护栏待补」⇒ A3 红；缺失态改显示「未知」⇒ A4 红。
 */

/** 契约同源的 run 记录骨架（**刻意无 kernel 字段** = 字段上线前的旧记录形态）。 */
const BASE_RUN = {
  id: "run-kernel-1",
  taskId: "task-kernel-1",
  model: "claude-opus-4-8",
  iterations: [
    { index: 0, toolCalls: [{ toolCallId: "toolu_k1", toolName: "query_objects", input: { objectType: "Base" }, outcome: "OK", durationMs: 210 }] },
  ],
  budget: { maxIterations: 8, maxToolCalls: 10, maxSolverCalls: 8, maxDurationMs: 600000, maxClarifications: 0, maxDiscoverCalls: 8, maxRoundTrips: 24 },
  budgetExhausted: false,
  totalInputTokens: 9120,
  totalOutputTokens: 1340,
  contextOps: [],
  tenantId: "tenant-battery", // 与 src/mocks/ids.ts TENANT_ID 同值（契约同源纪律）
  agentId: "agt-explore",
  agentKey: "explore_agent",
  agentVersion: 2,
  attribution: "REGISTERED",
  origin: "ROOT",
  createdAt: "2026-06-16T14:02:10Z",
} as const;

async function openConsole() {
  loginAs("planner");
  renderApp("/admin/agents");
  return screen.findByTestId("agent-console");
}

/** 选中「探索分析 Agent」并等到「本 Agent 的运行」区块就绪。 */
async function openExploreAgentOwnRuns(user: ReturnType<typeof userEvent.setup>) {
  await openConsole();
  await user.click(await screen.findByText("探索分析 Agent"));
  return screen.findByTestId("agent-own-runs");
}

/** msw override：`GET /b/v1/agents/:id/runs` 返给定 run 记录（一律 schema.parse 过契约）。 */
function useAgentRuns(runs: unknown[]) {
  server.use(
    http.get("*/b/v1/agents/:id/runs", ({ params }) =>
      HttpResponse.json({ agentId: String(params.id), agentKey: "explore_agent", runs }),
    ),
  );
}

describe("WO-DSH-P2-UX · AgentsPage 内核徽标", () => {
  it("A1 两态·原生：默认 fixture（无 kernel 字段）⇒ 列表每行与 RunDetail 都显示「原生」", async () => {
    const user = userEvent.setup();
    const own = await openExploreAgentOwnRuns(user);
    // 默认 mock 的三条 explore_agent 运行（v2 直接 + v1 直接 + 会诊扇出）全是字段上线前形态。
    const cells = within(own).getAllByTestId("own-run-kernel");
    expect(cells.length).toBe(3);
    for (const cell of cells) {
      expect(cell.textContent).toContain("原生");
      expect(cell.textContent).not.toContain("外部运行时");
    }

    // RunDetail 同判：任务清单第一条（task-agent-1，默认 fixture 同样无 kernel）。
    const rows = await screen.findAllByTestId("agent-run-row");
    await user.click(rows[0]!);
    const detail = await screen.findByTestId("agent-run-detail");
    expect(within(detail).getByTestId("agent-run-kernel").textContent).toContain("原生");
  });

  it("A2 两态·外部：契约同源 fixture 带 kernel:EXTERNAL ⇒ 徽标「外部运行时」", async () => {
    const user = userEvent.setup();
    useAgentRuns([AgentRunRecordSchema.parse({ ...BASE_RUN, id: "run-kernel-ext", kernel: "EXTERNAL" })]);
    const own = await openExploreAgentOwnRuns(user);
    const cells = within(own).getAllByTestId("own-run-kernel");
    expect(cells.length).toBe(1);
    expect(cells[0]!.textContent).toContain("外部运行时");
    expect(cells[0]!.textContent).not.toContain("原生");
  });

  it("A3 外部态浮层：含「环检测护栏待补」逐字（未销账期文案，N3 销账尾差登记在案）", async () => {
    const user = userEvent.setup();
    useAgentRuns([AgentRunRecordSchema.parse({ ...BASE_RUN, id: "run-kernel-ext", kernel: "EXTERNAL" })]);
    const own = await openExploreAgentOwnRuns(user);
    await user.click(within(own).getByTestId("info-own-run-kernel-run-kernel-ext-tip"));
    const body = await screen.findByTestId("info-body-own-run-kernel-run-kernel-ext-tip");
    expect(body.textContent).toContain("环检测护栏待补");
    expect(body.className).toContain("popover-surface"); // 规范 §2：受控 DOM 浮层，非原生 title
  });

  it("A3 原生臂：原生态浮层**不含**「环检测护栏待补」（防文案串态）", async () => {
    const user = userEvent.setup();
    await openConsole();
    const rows = await screen.findAllByTestId("agent-run-row");
    await user.click(rows[0]!);
    const detail = await screen.findByTestId("agent-run-detail");
    await user.click(within(detail).getByTestId("info-agent-run-kernel-tip"));
    const body = await screen.findByTestId("info-body-agent-run-kernel-tip");
    // 浮层真的开了、说的是原生口径（不是空层）
    expect(body.textContent).toContain("内置");
    expect(body.textContent).not.toContain("环检测护栏待补");
  });

  it("A4 缺失≡原生：显式无 kernel 字段记录 ⇒ 显示「原生」，绝不显示「未知」（与归属三态不同案）", async () => {
    const user = userEvent.setup();
    // BASE_RUN 刻意无 kernel —— schema.parse 证明这是契约允许的合法形态（optional additive）。
    useAgentRuns([AgentRunRecordSchema.parse({ ...BASE_RUN })]);
    const own = await openExploreAgentOwnRuns(user);
    const cells = within(own).getAllByTestId("own-run-kernel");
    expect(cells.length).toBe(1);
    expect(cells[0]!.textContent).toContain("原生");
    expect(cells[0]!.textContent).not.toContain("未知");
    // 整个区块都不许出「未知」字样 —— 内核缺失可证 ≡ 原生（休眠门 + 出货 compose 显式 0），
    // 显示「未知」就是把可证事实说成不可知（M5 反咬点）。
    expect(own.textContent).not.toContain("未知");
  });

  it("A5 契约同源 · 负向臂：kernel:\"dsh\"（非法枚举值）被 schema 当场拒", () => {
    expect(() => AgentRunRecordSchema.parse({ ...BASE_RUN, kernel: "dsh" })).toThrow();
    // 正向对拍：两个合法枚举值都过得去 —— 证明上面拒的是「值非法」，不是「任何 kernel 字段」。
    expect(AgentRunRecordSchema.parse({ ...BASE_RUN, kernel: "EXTERNAL" }).kernel).toBe("EXTERNAL");
    expect(AgentRunRecordSchema.parse({ ...BASE_RUN, kernel: "NATIVE" }).kernel).toBe("NATIVE");
    // 缺失同样合法（optional additive，旧记录形态）。
    expect(AgentRunRecordSchema.parse({ ...BASE_RUN }).kernel).toBeUndefined();
  });
});
