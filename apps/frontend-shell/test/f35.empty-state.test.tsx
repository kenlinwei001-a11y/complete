import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

describe("F35 · 空态引导规范（管理平台 §6，抽查）", () => {
  it("无 agent → 空态给「创建 Agent（模板预填）」下一步入口", async () => {
    server.use(http.get("*/b/v1/agents", () => HttpResponse.json([])));
    loginAs("planner");
    renderApp("/admin/agents");
    const cta = await screen.findByTestId("cta-agent");
    expect(cta).toHaveTextContent("创建 Agent（模板预填）");
    expect(screen.getByTestId("empty-cta")).toBeInTheDocument();
  });

  it("无连接器 → 空态给「上传文件或创建连接」入口", async () => {
    server.use(http.get("*/a/v1/connections", () => HttpResponse.json([])));
    loginAs("planner");
    renderApp("/admin/connections");
    expect(await screen.findByTestId("cta-connection")).toHaveTextContent("上传文件或创建连接");
  });

  // UI-POLISH（裸表头无空态）：LLM Provider 表空数据 → 诚实空态行（非裸表头），指引新建。
  it("无 LLM Provider → 表格给诚实空态行（非裸表头）", async () => {
    server.use(http.get("*/a/v1/llm-providers", () => HttpResponse.json([])));
    loginAs("planner");
    renderApp("/admin/llm-providers");
    const emptyRow = await screen.findByTestId("providers-empty");
    expect(emptyRow).toHaveTextContent("暂无 LLM Provider");
    // 无 provider 行（裸表头下不再空空如也）
    expect(screen.queryByTestId(/^provider-llmp-/)).not.toBeInTheDocument();
  });

  // UI-POLISH（裸表头无空态）：兜底统计无聚类 → 不渲染裸表头，仅显空态说明。
  it("无兜底聚类 → 隐藏裸表头，仅显诚实空态说明", async () => {
    server.use(http.get("*/b/v1/ops/fallback-stats", () => HttpResponse.json({ items: [] })));
    loginAs("planner");
    renderApp("/admin/ops/fallback");
    expect(await screen.findByTestId("fallback-empty")).toHaveTextContent("暂无兜底聚类");
    // 裸表头（querySample 列头）不再出现
    expect(screen.queryByText("querySample")).not.toBeInTheDocument();
  });
});
