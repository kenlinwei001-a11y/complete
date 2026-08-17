import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { useSessionStore } from "@/store/sessionStore";

/**
 * ══ WO-GSIM-COCKPIT-NL · 接单组合优选页（`global-sim`）的同屏问答**接缝** ══════════
 *
 * ── 这一份为什么存在（断点 `G-GSIM-DEAD-COCKPIT` 的原始描述是错的，证据在下面）──────
 *
 * 原断点写「`GlobalSimView` 无 NL 框接线」，判据是在 `GlobalSimView.tsx` 里 grep
 * `QueryDock` = 0 / `submitQuery` = 0，并拿 `SandboxView.tsx`（`QueryDock` = 1）当金丝雀。
 * **这个判据不度量它要度量的东西**（铁律 0.6 的句式：「我用 X 当作 Y 的证据，而 X 并不度量 Y」）：
 *
 *  ① 全仓渲染 `<QueryDock />` 的地方**只有一处** —— `pages/ShellLayout.tsx` 的
 *     `{onViewPage && dockOn && <QueryDock />}`（`onViewPage = pathname.startsWith("/v/")`）。
 *     **任何页面都不会 import 它**，所以「某页 QueryDock 命中 0」对**全仓每一页**都成立，
 *     区分不出「有问答」和「没问答」。
 *  ② 金丝雀 `SandboxView.tsx` 的那 1 次命中是
 *     `import { TaskRun } from "@/components/QueryDock/TaskRun";` —— 命中的是**目录名**，
 *     不是那个组件。沙盘页同样没有、也不需要自己挂 Dock。
 *     ⇒ 金丝雀本身就没在度量「这页有没有问答」，拿它做对照只会把结论坐实。
 *
 * ── 那这页到底属于哪一种「不工作」（铁律 0.5 判据 #1）──────────────────────────
 * **三种都不是 —— 它本来就是通的。** 定性论据是**路由形态**，不是文件内容：
 *   · `App.tsx` 的六个专用 route（`v/what-if` / `v/optimize-whatif` / `v/cleanroom-attr` /
 *     `v/disruption-radius` / `v/decision-play` / `v/sim-sandbox`）绕开 `ViewPage`
 *     ⇒ 那六页必须自己调 `usePageView` 报到，否则 `pageContext.view` 是**上一页残值**；
 *   · 而 `global-sim` **没有**专用 route，它落 `v/:viewKey` → `pages/ViewPage.tsx` →
 *     `useEffect(() => setView(viewKey))`（`ViewPage.tsx:26`）⇒ **报到由 ViewPage 代劳，本来就对**。
 * 所以这页不需要 `usePageView`：给它加一行反而是**重复报到**（`shared.tsx` 的头注明令
 * 「经 ViewPage 分发的页**不要**调它」）。本单因此**一行生产代码都没改**。
 *
 * ── 那还缺什么（这份测试真正补的那一格）────────────────────────────────────
 * 既有断言停在**store**：`harness-ux-u7-u9.test.tsx` 断言渲染 `/v/global-sim` 后
 * `sessionStore.view === "global-sim"`；`f56.ceo-pagecontext.test.ts` 则是**手动** `setView(...)`
 * 之后直接调 `buildContext()`（咬函数不咬链路）。
 * 但从 store 到「编排侧真收到的那个字段」中间还有两跳没人咬：
 *     `QueryDock.submit()` → `store.buildContext()` → `derivePageContext(s)` → **HTTP 请求体**
 *                                                     `POST /b/v1/queries` 的 `context.pageContext.view`
 * 这两跳断了的话，上面两份测试**照样全绿**，而用户在这页问出去的问题**答的仍是别的页**。
 * 故本文件的断言一律落在**真实请求体**上，不看渲染、不看 store。
 *
 * ── 观测方式：只旁听，不改行为 ─────────────────────────────────────────────
 * 用 `server.events.on("request:start")` 旁听并 `clone()` 出请求体，**不**用 `server.use()` 覆盖
 * handler —— 覆盖会把被测的那条链换成我自己写的桩，等于测我自己的桩。
 */

/** 绝不可能是任何真视图键的哨兵：`view` 恰好等于目标值时用例照样绿，那是恒真不是通过。 */
const SENTINEL = "__sentinel-not-a-real-view__";
/** 残值来源：一个**真**的别的页（走专用 route + `usePageView`，与本页不同源，更接近真实串味）。 */
const PREV_PAGE = { path: "/v/what-if", viewKey: "what-if", ready: "export-report-what-if" };

type SubmittedQuery = { packageId: string; query: string; context: { pageContext?: { view?: string } } };

/** 旁听 `POST /b/v1/queries`（只此一条；`/queries/:id/cancel` 等子路径不算）。 */
function listenQuerySubmits(): SubmittedQuery[] {
  const seen: SubmittedQuery[] = [];
  server.events.on("request:start", async ({ request }) => {
    if (request.method !== "POST") return;
    if (!new URL(request.url).pathname.endsWith("/b/v1/queries")) return;
    seen.push((await request.clone().json()) as SubmittedQuery);
  });
  return seen;
}

/** 在当前屏的问答坞里问一句，返回它**实际发出去**的那个请求体。 */
async function askOnScreen(seen: SubmittedQuery[], question: string): Promise<SubmittedQuery> {
  const user = userEvent.setup();
  await screen.findByTestId("query-dock-bar");
  await user.type(screen.getByLabelText("查询输入"), `${question}{Enter}`);
  await waitFor(() => expect(seen.length).toBeGreaterThan(0));
  return seen[seen.length - 1]!;
}

/** what-if 页要一份 object-types 才渲染得出来（与 harness-ux-u7-u9 同款最小 handler）。 */
const typesHandler = () => http.get("*/a/v1/ontology/object-types", () => HttpResponse.json([]));

describe("WO-GSIM-COCKPIT-NL · 接单组合优选页问一句 ⇒ 请求带的是**本页**上下文", () => {
  let seen: SubmittedQuery[];

  beforeEach(() => {
    seen = listenQuerySubmits();
  });
  afterEach(() => {
    server.events.removeAllListeners("request:start");
  });

  it("① 主接缝：在本页提问 ⇒ POST /b/v1/queries 的 context.pageContext.view === 'global-sim'", async () => {
    loginAs("planner");
    // 前置哨兵：先污染。没有这一步，`view` 初值恰好对时用例恒绿。
    useSessionStore.getState().setView(SENTINEL);
    expect(useSessionStore.getState().view).toBe(SENTINEL);

    renderApp("/v/global-sim");
    await screen.findByTestId("global-sim");

    const body = await askOnScreen(seen, "为什么是这个组合？");

    // 头号判据：咬**请求体**，不是咬「问答坞渲染出来了」。
    expect(body.context.pageContext?.view).toBe("global-sim");
    expect(body.context.pageContext?.view).not.toBe(SENTINEL);
    // 链路确实走通到了编排侧认的那个包（不是发了个空壳）。
    expect(body.query).toBe("为什么是这个组合？");
    expect(body.packageId).toBeTruthy();
  }, 60_000);

  it("② 反向金丝雀（专咬残值）：先真访问 what-if 再进本页 ⇒ 请求里仍是 global-sim，不是 what-if", async () => {
    loginAs("planner");
    server.use(typesHandler());

    // —— 先把残值**真种下去**：真渲染另一页，让它自己调 setView（不是手写 setView 假装）。
    renderApp(PREV_PAGE.path);
    await screen.findByTestId(PREV_PAGE.ready);
    expect(useSessionStore.getState().view).toBe(PREV_PAGE.viewKey);

    // `cleanup()` 只卸载组件，**不**重置 session store（重置在 setup.ts 的 afterEach）
    // ⇒ 这里的 `view` 是货真价实的残值，正是本条要咬的病。
    cleanup();
    expect(useSessionStore.getState().view).toBe(PREV_PAGE.viewKey);

    renderApp("/v/global-sim");
    await screen.findByTestId("global-sim");

    const body = await askOnScreen(seen, "这个组合把谁挤掉了？");

    expect(body.context.pageContext?.view).toBe("global-sim");
    expect(body.context.pageContext?.view).not.toBe(PREV_PAGE.viewKey);
  }, 60_000);

  /**
   * ③ 变异反证 —— 证上面两条**红得对地方**。
   *
   * 变异手法：把 store 的 `setView` 换成 no-op，等价于「`ViewPage` 那一行报到被拆掉」。
   * 必须同时看到两件事，缺一条这份测试就是装饰品：
   *   · 问答坞**照样渲染得出来** ⇒ 主断言失败时不会是「组件找不到」这种假红；
   *   · 请求体带的是**残值** ⇒ 主断言确实红在「view 不对」这一个点上。
   */
  it("③ 变异反证：拆掉 setView ⇒ 坞还在、但请求带的是残值（证断言红在 view 不对，不是红在组件找不到）", async () => {
    loginAs("planner");
    useSessionStore.getState().setView(PREV_PAGE.viewKey); // 残值
    const realSetView = useSessionStore.getState().setView;
    try {
      useSessionStore.setState({ setView: () => undefined }); // ← 变异：报到被拆掉

      renderApp("/v/global-sim");
      // 变异后页面与坞**都还在**（失败模式不是「找不到组件」）。
      await screen.findByTestId("global-sim");
      await screen.findByTestId("query-dock-bar");

      const body = await askOnScreen(seen, "为什么是这个组合？");

      // 主断言在变异下**确实会红**，且红在 view 这一个字段上。
      expect(body.context.pageContext?.view).toBe(PREV_PAGE.viewKey);
      expect(body.context.pageContext?.view).not.toBe("global-sim");
    } finally {
      // `reset()` 只还原数据字段、**不**还原被替换的 action，必须自己收拾干净。
      useSessionStore.setState({ setView: realSetView });
    }
  }, 60_000);

  /**
   * ④ 工具自证（铁律 0.6：报否定结论前先跑金丝雀）。
   * 上面三条全靠 `listenQuerySubmits` 抓得到请求。若它其实一条都抓不到，
   * `waitFor` 会超时报「没提交」，容易被读成「链路断了」。这一条把**旁听器本身**验一遍。
   */
  it("④ 旁听器金丝雀：换一页问同一句，同一个旁听器照样抓得到（证抓不到时是链路问题，不是工具问题）", async () => {
    loginAs("planner");
    renderApp("/v/dash");
    await screen.findByTestId("query-dock-bar");

    const body = await askOnScreen(seen, "本月达成率怎么样？");
    expect(body.context.pageContext?.view).toBe("dash");
  }, 60_000);
});
