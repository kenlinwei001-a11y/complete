import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { ACCOUNTS } from "@/mocks/fixtures";
import { tokenFor } from "@/mocks/db";
import { tokenStore } from "@/api/tokenStore";

/**
 * WO-11 · UX/语义裂缝合集。本文件覆盖两条需真渲染的子项：
 *  ①徽章自相矛盾（非关键源超阈不告警）·④深链 F5 不掉登录（启动先静默续期）。
 *  ②schema 优雅降级 / ③绑定替换语义 由 datacore 测试覆盖；⑤孤儿页入口由 f61 覆盖。
 */
describe("WO-11.1 · 来源系统总览徽章一致（非关键源超阈不告警）", () => {
  function healthWith(sources: unknown[]) {
    server.use(
      http.get("*/a/v1/data-health", () => HttpResponse.json({ sources, overall: "DELAYED" })),
    );
  }

  it("关键源超阈 → ⚠超阈；非关键源(critical:false)超阈 → 仅「（非关键源·参考）」不告警", async () => {
    loginAs("planner"); // 含 admin 角色 → 可见 /admin/source-overview
    healthWith([
      { connId: "c-erp", name: "ERP 主数据", system: "ERP/SAP", latencyMin: 20, thresholdMin: 1440, status: "OK" },
      { connId: "c-iot", name: "IoT 时序通道", system: "IoT/SCADA", latencyMin: 300, thresholdMin: 120, status: "DELAYED", critical: true },
      { connId: "c-ext", name: "外部行情源", system: "外部信号", latencyMin: 300, thresholdMin: 120, status: "OK", critical: false },
    ]);
    renderApp("/admin/source-overview");

    const iot = await screen.findByTestId("source-system-IoT/SCADA");
    expect(iot.textContent).toContain("⚠超阈"); // 关键源超阈 → 告警

    const ext = screen.getByTestId("source-system-外部信号");
    expect(ext.textContent).toContain("（非关键源·参考）"); // 非关键源超阈 → 参考，不告警
    expect(ext.textContent).not.toContain("⚠超阈"); // 矛盾消除：不再「⚠超阈 + 正常徽章」并存
    // 状态徽章仍为「正常」（status OK），与文案口径一致
    expect(within(ext).getByTestId("source-status-外部信号").textContent).toBe("正常");
  });
});

describe("WO-11.4 · 深链 F5 不掉登录（启动守卫先静默续期）", () => {
  it("内存 token=null 但 refresh cookie 有效 → 续期成功 → 深链正常加载，不跳登录", async () => {
    tokenStore.clear(); // 模拟 F5：内存 access token 丢失
    const planner = ACCOUNTS.find((a) => a.username === "planner")!;
    // refresh httpOnly cookie 仍有效 → 静默续期返回新 access token
    server.use(
      http.post("*/a/v1/auth/refresh", () => HttpResponse.json({ accessToken: tokenFor(planner) })),
    );
    renderApp("/admin/source-overview");
    // 页面真加载（续期后 workspace 拉取成功），未被踢回 /login
    expect(await screen.findByTestId("source-overview-page")).toBeInTheDocument();
    expect(screen.queryByLabelText("租户")).not.toBeInTheDocument(); // 非登录页
  });

  it("内存 token=null 且 refresh 失效 → 续期失败 → 跳登录（守卫不误放行）", async () => {
    tokenStore.clear();
    // 默认 mock /auth/refresh 返回 401（REFRESH_FAILED）
    renderApp("/admin/source-overview");
    expect(await screen.findByLabelText("租户")).toBeInTheDocument(); // 落到登录页
  });
});
