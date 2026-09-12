import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "./setup";
import { ACCOUNTS, workspaceForAccount } from "@/mocks/fixtures";
import { loginAs, renderApp } from "./utils";

/**
 * 欠账 #127 · 推演沙盘路由守卫零测试覆盖（175 个前端测试文件里 0 命中）。
 *
 * 守卫的核心行为是 **entitlement 先于权限（R3）**：`workspace.features` 里没有 `sim.sandbox`
 * ⇒ 渲染 `NotFoundPage`（404 语义，**不泄露功能存在性**）；`features` 为 undefined ⇒ 向后兼容放行。
 *
 * ── 为什么必须走真路由 ────────────────────────────────────────────────────────
 * 既有 `test/sim-init-wizard.test.tsx`（本单已随向导一并删除）的毛病是拿 `MemoryRouter` 直接
 * render 组件——那**绕过了守卫**，测的是组件不是链路：守卫是不是真的挂在那条 route 上、
 * 静态段有没有被 `v/:viewKey` 抢先匹配，一概测不出来。
 * 本文件用 `renderApp(path)`（= `createMemoryRouter(routes, {initialEntries})`，routes 直接来自 `@/App`），
 * 从 URL 出发经真路由表解析，守卫想漏挂都漏不掉。
 */

const PLANNER = ACCOUNTS.find((a) => a.username === "planner")!;

/** 以指定 entitlement 覆盖下发 workspace（其余字段仍走真 fixture，保证 ShellLayout 能正常渲染）。 */
function serveWorkspace(overrides: Record<string, boolean>) {
  server.use(
    http.get("*/a/v1/me/workspace", () => HttpResponse.json(workspaceForAccount(PLANNER, overrides, 1))),
  );
}

beforeEach(() => loginAs("planner"));
afterEach(() => cleanup());

describe("欠账#127 · 推演沙盘路由守卫（真路由 createMemoryRouter + 真 routes）", () => {
  it("sim.sandbox 开 → /v/sim-sandbox 解析到沙盘控制台（不是 404）", async () => {
    serveWorkspace({}); // mock FEATURE_REGISTRY 里 sim.sandbox 默认 on
    renderApp("/v/sim-sandbox");
    // 守卫放行 → 懒加载沙盘主屏真上屏。
    await waitFor(() => expect(screen.getByTestId("sandbox-view")).toBeTruthy(), { timeout: 15000 });
    expect(screen.queryByTestId("page-404")).toBeNull();
  });

  it("sim.sandbox 关 → /v/sim-sandbox 渲染 404（R3 entitlement 先于权限·不泄露功能存在性）", async () => {
    serveWorkspace({ "sim.sandbox": false });
    renderApp("/v/sim-sandbox");
    await waitFor(() => expect(screen.getByTestId("page-404")).toBeTruthy(), { timeout: 15000 });
    // 关键：不是 403（那会承认"有这个功能但你没权限"），也不能把沙盘漏出来。
    expect(screen.queryByTestId("page-403")).toBeNull();
    expect(screen.queryByTestId("sandbox-view")).toBeNull();
    expect(screen.queryByTestId("sandbox-console")).toBeNull();
  });

  it("sim.sandbox 关 → 侧栏「推演沙盘」入口一并消失（暗发：关 = 不存在，不是灰掉）", async () => {
    serveWorkspace({ "sim.sandbox": false });
    renderApp("/");
    await waitFor(() => expect(screen.queryByTestId("nav-sim-sandbox")).toBeNull(), { timeout: 15000 });
  });

  it("sim.sandbox 开 → 侧栏「推演沙盘」入口在", async () => {
    serveWorkspace({});
    renderApp("/");
    await waitFor(() => expect(screen.getByTestId("nav-sim-sandbox")).toBeTruthy(), { timeout: 15000 });
  });
});

describe("WO-SIM-SCOPE-LOCAL ③ · 向导退役后 /v/sim-init 不再解析", () => {
  it("sim.sandbox **开**着也一样：/v/sim-init 落通用 :viewKey 守卫 → 404，且绝不渲染向导", async () => {
    serveWorkspace({});
    renderApp("/v/sim-init");
    // 曾经这里是 SimInitGuard → SimInitWizard（sim.sandbox 开就放行）。向导退役后该静态段已删，
    // URL 落到 `v/:viewKey` 通用守卫，租户没有名为 sim-init 的 view ⇒ 404。
    await waitFor(() => expect(screen.getByTestId("page-404")).toBeTruthy(), { timeout: 15000 });
    // 向导的任一残留 DOM 都不许再出现（组件文件已删，这里咬的是"链路上真的没有它了"）。
    expect(screen.queryByTestId("siminit-view")).toBeNull();
    expect(screen.queryByTestId("siminit-stepper")).toBeNull();
    expect(screen.queryByTestId("siminit-pane-baseline")).toBeNull();
  });

  it("侧栏不再有「推演初始化向导」入口（第二个建会话的屏没了 = 会话错配不可能再发生）", async () => {
    serveWorkspace({});
    renderApp("/");
    await waitFor(() => expect(screen.getByTestId("nav-sim-sandbox")).toBeTruthy(), { timeout: 15000 });
    expect(screen.queryByTestId("nav-sim-init")).toBeNull();
  });
});
