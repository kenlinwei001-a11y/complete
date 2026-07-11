import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { SandboxRunHistory } from "@/views/sim/SandboxRunHistory";
import { loginAs } from "./utils";
import { server } from "./setup";

/**
 * WO-SANDBOX-RUN-HISTORY（G-VIS-1）：历史推演记录面板消费门。
 * 后端 sim_session 每次推演留痕（curTick/status/parentCheckpointId/scope/createdAt）——
 * 面板列出会话 + 点开看逐 tick 全局态轨迹（前端所见=后端真值·不伪造）。牙齿：置空 sessions → 空态；置空 tick → 详情空。
 */

function renderPanel(refreshKey = "s1:3") {
  loginAs("planner");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SandboxRunHistory refreshKey={refreshKey} />
    </QueryClientProvider>,
  );
}

const SESSIONS = [
  { id: "sess-root", tenantId: "demo", baseSnapshot: {}, scope: { presetContext: { label: "4680-NCM 六周需求高企" } }, status: "ENDED", curTick: 6, parentCheckpointId: null, createdAt: "2026-07-01T10:00:00.000Z" },
  { id: "sess-branch", tenantId: "demo", baseSnapshot: {}, scope: {}, status: "RUNNING", curTick: 4, parentCheckpointId: "cp-1", createdAt: "2026-07-01T11:00:00.000Z" },
];
const COMPARE_A = { a: [
  { tick: 0, state: { 常州: { util: 50.2 } } },
  { tick: 3, state: { 常州: { util: 67.4 } } },
  { tick: 6, state: { 常州: { util: 96.0 } } },
], b: [] };

function mock(sessions = SESSIONS) {
  server.use(
    http.get("*/a/v1/sim/sessions", () => HttpResponse.json({ items: sessions })),
    http.get("*/a/v1/sim/compare", () => HttpResponse.json(COMPARE_A)),
  );
}

describe("WO-SANDBOX-RUN-HISTORY · 历史推演记录面板", () => {
  it("列出会话（时间/状态/推进步数/分支标记）· 倒序 · 场景标签来自 scope.presetContext.label", async () => {
    mock();
    renderPanel();
    await screen.findByTestId("sandbox-history-row-sess-branch"); // 倒序 → branch(11:00) 在前
    expect(screen.getByTestId("sandbox-history-row-sess-root")).toBeTruthy();
    expect(screen.getByTestId("sandbox-history-curtick-sess-root")).toHaveTextContent("6 tick");
    expect(screen.getByTestId("sandbox-history-branch-sess-branch")).toHaveTextContent("分支"); // parentCheckpointId 非空
    expect(screen.getByTestId("sandbox-history-table")).toHaveTextContent("4680-NCM 六周需求高企"); // 场景标签
  });

  it("点会话行 → 详情展开：逐 tick 全局态轨迹 spark + 终值（=compare 后端真值 96.0）", async () => {
    mock();
    renderPanel();
    fireEvent.click(await screen.findByTestId("sandbox-history-row-sess-root"));
    await screen.findByTestId("sandbox-history-detail-sess-root");
    expect(screen.getByTestId("sandbox-history-spark-sess-root")).toBeTruthy();
    // 终值 = 末 tick 全局态均值 = 96.0（后端 compare.a 末点 util 96.0·前端所见=后端真值）
    expect(screen.getByTestId("sandbox-history-terminal-sess-root")).toHaveTextContent("96.0");
  });

  it("牙齿·分维归一口径（WO-FAKE-08 堵扁平均）：多 stateVar+无界计数变量 → 全局态=有界变量归一均值·非跨维扁平均", async () => {
    // 末 tick 携两变量：util(0-100 有界) + totalDemand(32 万量级·无界计数)。
    // 分维归一口径：util 携带者[常州90,无锡80]均值=85，totalDemand 归一后 >100 剔除 → 全局态终值=85.0。
    // 若回潮到跨维扁平均（Σ 全对象×全 stateVar ÷ cnt = (90+320000+80+300000)/4 ≈ 155042.5）则本断言红。
    server.use(
      http.get("*/a/v1/sim/sessions", () => HttpResponse.json({ items: [SESSIONS[0]!] })),
      http.get("*/a/v1/sim/compare", () => HttpResponse.json({ a: [
        { tick: 0, state: { 常州: { util: 30, totalDemand: 320000 }, 无锡: { util: 20, totalDemand: 300000 } } },
        { tick: 6, state: { 常州: { util: 90, totalDemand: 320000 }, 无锡: { util: 80, totalDemand: 300000 } } },
      ], b: [] })),
    );
    renderPanel();
    fireEvent.click(await screen.findByTestId("sandbox-history-row-sess-root"));
    await screen.findByTestId("sandbox-history-detail-sess-root");
    // 终值 = 有界变量(util)归一均值 85.0（非扁平 155042.5），且必落 0-100（无界计数变量被剔除）。
    expect(screen.getByTestId("sandbox-history-terminal-sess-root")).toHaveTextContent("85.0");
  });

  it("牙齿·诚实空态：无会话 → 引导空态（不伪造记录）", async () => {
    mock([]);
    renderPanel();
    expect(await screen.findByTestId("sandbox-history-empty")).toHaveTextContent("暂无推演记录");
    expect(screen.queryByTestId("sandbox-history-table")).toBeNull();
  });

  it("refreshKey 变更（推进/分支）→ 列表重取（C4 事件失效·新推演落即现）", async () => {
    mock([SESSIONS[0]!]);
    const { rerender } = renderPanel("s1:3");
    await screen.findByTestId("sandbox-history-row-sess-root");
    expect(screen.queryByTestId("sandbox-history-row-sess-branch")).toBeNull();
    // 推进后 refreshKey 变 + 后端多一条 → 重取见新会话
    mock(SESSIONS);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(<QueryClientProvider client={qc}><SandboxRunHistory refreshKey="s1:4" /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByTestId("sandbox-history-row-sess-branch")).toBeTruthy());
  });
});
