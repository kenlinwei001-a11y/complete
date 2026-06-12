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
});
