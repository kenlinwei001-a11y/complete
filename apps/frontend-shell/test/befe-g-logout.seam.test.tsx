import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { tokenStore } from "@/api/tokenStore";
import { env } from "@/env";
import { renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-BEFE-G · 接缝门：**「退出登录」必须真的告诉服务端**
 * （门 `befe-seam:check` 载体② · 闭本体 §8 断点 `G-BE-FE-SEAM-DEAD`）。
 *
 * ── 治的是哪一条缺口 ─────────────────────────────────────────────────────────
 * `POST /a/v1/auth/logout` 后端第一天就在（`apps/datacore/src/app.ts:1090`，
 * 且列在 `PUBLIC_PATHS`——`app.ts:945`），**前端零调用方**。
 * 病灶不是"少个功能"，是**安全性**：
 *   · `refresh_token` 是 **httpOnly cookie**（`app.ts:1091` `clearCookie path=/a/v1/auth`），
 *     JS 既读不到也删不掉；
 *   · `apps/frontend-shell/src/api/apiClient.ts:41-62` 的 `silentRefresh()` 带
 *     `credentials:"include"` 打 `POST /a/v1/auth/refresh` 就能用它换回新 accessToken；
 *   · 改动前 `store/authSession.ts:logoutSession()` 只做 `tokenStore.clear()` + `clearAccountState()`
 *     —— 全在浏览器内存里。
 * ⇒ **点完「退出登录」，会话在服务端仍然活着**，任意一次 401 重试即可复活。
 * 分诊全文见 `docs/TRIAGE-befe-seam-longtail.md` §6。
 *
 * ── 为什么**不** `vi.mock("@/api/endpoints")` ──────────────────────────────────
 * 那会把病灶所在的那一跳一起 mock 掉：桩函数收什么都行，URL、method、`credentials` 根本不参与，
 * 断言恒绿而缺口仍在（本仓假绿第 9 形态 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR`）。
 * 本文件走**真 `endpoints.ts` → 真 `apiClient` → 真 fetch**，在 MSW 层拦**真实 URL**，
 * 咬的是链路不是函数。
 *
 * ── 为什么从**真按钮**点起，而不是直接调 `logoutSession()` ─────────────────────
 * 直接调函数只能证明"函数会发请求"，证明不了"用户点得到"。
 * 本文件走 `renderApp("/login")` → 真登录 → 真开用户菜单 → 真点 `logout-btn`
 * （`apps/frontend-shell/src/pages/ShellLayout.tsx:598`）。
 * 谁把那个 onClick 摘了，本文件当场红。
 *
 * ── 变异反证（亲手做过，见本单交回报告）─────────────────────────────────────
 * 把 `store/authSession.ts` 里 `void logoutRequest().catch(...)` 那一行注释掉 ⇒ 用例 ①③ 必红
 * （① 断言"服务端真收到"，③ 断言 `credentials:"include"` —— 后者是本缺口的**载荷**：
 * 没有它 cookie 不随行，服务端 `clearCookie` 清了个寂寞，而 URL 断言看不出这一点）。
 * 还原 ⇒ 全绿。
 */

/** 本文件观察到的登出请求（真 URL / 真 method / 真 credentials）。 */
type Seen = { url: string; method: string; credentials: string };

describe("WO-BEFE-G 接缝 · 退出登录必须吊销服务端 refresh 会话", () => {
  let seen: Seen[] = [];

  beforeEach(() => {
    seen = [];
    // 覆盖默认 handler：记录**真实**请求的三要素后再放行。
    server.use(
      http.post("*/a/v1/auth/logout", ({ request }) => {
        seen.push({ url: request.url, method: request.method, credentials: request.credentials });
        return HttpResponse.json({ ok: true });
      }),
    );
  });

  afterEach(() => {
    tokenStore.clear();
  });

  async function loginThenLogout(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    renderApp("/login");
    await user.type(await screen.findByLabelText("用户名"), "planner");
    await user.type(screen.getByLabelText("密码"), "demo1234");
    await user.click(screen.getByRole("button", { name: "登录" }));
    // 真的进到壳里了（不是"表单提交了"就算数）
    await waitFor(() => expect(screen.getByTestId("left-nav")).toBeInTheDocument());
    expect(tokenStore.get(), "登录后本地应有 accessToken，否则后面的『清空』断言是空胜").toBeTruthy();

    await user.click(screen.getByTestId("user-menu-btn"));
    await user.click(screen.getByTestId("logout-btn"));
  }

  it("① 真按钮 → 真 endpoints → 服务端真收到 POST /a/v1/auth/logout", async () => {
    const user = userEvent.setup();
    await loginThenLogout(user);

    await waitFor(() => expect(seen.length, "服务端一次都没收到登出请求 ⇒ 会话仍在服务端活着").toBe(1));
    const req = seen[0]!;
    // 打到的是 **DataCore** 基址下的那条真路由（不是 AgentCore、不是别的路径）
    expect(req.url).toBe(`${env.datacoreUrl}/a/v1/auth/logout`);
    expect(req.method).toBe("POST");
  });

  it("② 屏上真变：本地 token 清空 + 回到登录页", async () => {
    const user = userEvent.setup();
    await loginThenLogout(user);

    await waitFor(() => expect(tokenStore.get()).toBeNull());
    // 真路由跳转（不是只把 store 清了却还停在壳里）
    expect(await screen.findByLabelText("用户名")).toBeInTheDocument();
    expect(screen.queryByTestId("left-nav")).not.toBeInTheDocument();
  });

  it("③ 载荷判据：必须带 credentials:'include'（否则 httpOnly cookie 不随行，clearCookie 清了个寂寞）", async () => {
    const user = userEvent.setup();
    await loginThenLogout(user);

    await waitFor(() => expect(seen.length).toBe(1));
    expect(
      seen[0]!.credentials,
      "refresh_token 是 httpOnly cookie（Path=/a/v1/auth）；不带 credentials 就等于没登出",
    ).toBe("include");
  });

  it("④ 断网也必须能退出去（服务端 5xx 时本地登出照常完成 —— 否则比不调更糟）", async () => {
    server.use(
      http.post("*/a/v1/auth/logout", ({ request }) => {
        seen.push({ url: request.url, method: request.method, credentials: request.credentials });
        return HttpResponse.json({ error: { code: "UPSTREAM_DOWN", message: "后端不可达", requestId: "t" } }, { status: 503 });
      }),
    );
    const user = userEvent.setup();
    await loginThenLogout(user);

    await waitFor(() => expect(seen.length, "请求应当仍被发出").toBe(1));
    await waitFor(() => expect(tokenStore.get(), "服务端失败不许挡住本地登出").toBeNull());
    expect(await screen.findByLabelText("用户名")).toBeInTheDocument();
  });
});
