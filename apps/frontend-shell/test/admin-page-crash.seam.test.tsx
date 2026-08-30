import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-ONTO-CRASH · **三处后台页永久崩溃**的接缝门。
 *
 * ── 这道门要证的那**一句话** ──────────────────────────────────────────────────
 *   **「后端按它真实的形状回包时，这三页照样渲染得出来；而且任何一页崩了，
 *     换到别的页就不该还是崩溃页。」**
 *
 * 不是「组件能挂载」，也不是「endpoints.ts 里有那个函数」—— 病灶恰恰是
 * **前端声明的形状与后端真实回包不一致**，而 `api.a<T>()` 的泛型只是断言、不做运行时校验：
 * 类型系统全绿、`pnpm -r typecheck` 全绿，页面照崩。
 * 所以本文件的 mock **一律照抄后端真实回包形状**（每条都在注释里点名出处），
 * 不照前端 `interface` 抄 —— 照 interface 抄就是让 mock 和 bug 用同一个错误假设，
 * 这道门会变成装饰品：形状错还全绿。
 *
 * ── 三处的原始症状（2026-08-30 真浏览器 + 真后端 SEED_DEMO=1，各 2/2 稳定复现）──
 *  ① `/admin/quarantine`          TypeError: (data ?? []).filter is not a function
 *  ② `/admin/validation`          TypeError: runs.map is not a function
 *  ③ `/admin/ontology-relations`  TypeError: Cannot read properties of undefined (reading 'join')
 *
 * ③ 最要紧：它是**全平台唯一能建边的入口**，且「发起发布会签」的按钮就在这一页 ——
 * 用户自己点一次，这页此后**每次打开都崩，F5 救不回**（崩溃条件在服务端那条记录上）。
 *
 * ⚠ 角色不是小事：`quarantine` 与 `ontology-relations` 要 `admin|data_admin`
 *   （`pages/adminRegistry.ts`），而 mock 账号 `padmin` 只有 `platform_admin` ⇒
 *   用 padmin 进这两页会被 AdminGuard 挡在门外，**屏上没有崩溃页，也没有页面** ——
 *   那种「什么都没有」极易被读成「没崩，通过了」。本文件一律用 `planner`
 *   （它的角色里含 `admin`，见 `mocks/fixtures.ts` 的 ACCOUNTS）。
 */

afterEach(() => cleanup());

/**
 * 等这一页**落定**，然后回答「它崩了没有」。
 *
 * 判据落在两个**具体记号**上（页面自己的 testId ／ 崩溃页的 testId），
 * 不用「body 文字够不够长」这类启发式 —— 外壳导航本身就有几百字，
 * 拿它当「页面渲染好了」的证据，会在页面还没挂上时就先回答「没崩」。
 * （这正是本仓反复吃亏的那个形态：我用 X 当作 Y 的证据，而 X 并不度量 Y。）
 */
async function settled(pageTestId: string): Promise<boolean> {
  await waitFor(
    () => {
      const ok = screen.queryByTestId(pageTestId) ?? screen.queryByTestId("page-error-boundary");
      expect(ok, `既没等到 ${pageTestId}，也没等到崩溃页 ⇒ 多半是被 AdminGuard 挡住了，本条什么都没证明`).toBeTruthy();
    },
    { timeout: 5000 },
  );
  /*
   * ⚠ **页面挂上了 ≠ 数据到齐了**，而本单这三处崩溃**全都发生在数据回来之后的那一次重渲染**
   * （首帧 `data` 还是 undefined，各处 `?? []` 兜住了，看着好好的）。
   * 第一版就是在这里收工的，于是金丝雀报「没崩」—— 探针在崩溃发生之前就下了结论。
   * 形态照旧：我用「首帧没崩」当作「这一页不崩」的证据，而前者并不度量后者。
   * 故再留一个沉淀窗口，期间崩溃页出现过就算崩。
   */
  for (let i = 0; i < 40; i++) {
    if (screen.queryByTestId("page-error-boundary") !== null) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return screen.queryByTestId("page-error-boundary") !== null;
}

/**
 * 制造一次**必崩**（金丝雀与边界用例共用的诱因）。
 *
 * 手法：让 `GET /a/v1/ontology/publish-requests` 回一个**对象**而不是数组
 * ⇒ 本体关系页 `(pubReqs.data ?? []).map(...)` 当场 `.map is not a function`。
 * 选它是因为：① 与本单三处 bug 同一族（形状错）；② 后端此路真实回的是数组
 * （实测 `ARRAY len=0`），所以这是**人为诱发**、不是在掩盖一个真缺陷。
 */
function induceCrash() {
  server.use(http.get("*/a/v1/ontology/publish-requests", () => HttpResponse.json({})));
}

describe("WO-ONTO-CRASH · 三处后台页在后端真实回包形状下不许崩", () => {
  /**
   * §0 金丝雀 —— 先证明这道门**咬得动**。
   *
   * 报「三页都没崩」这种**否定结论**之前，必须先证明「崩了的话我看得见」。
   * 否则「断言写歪了 / 被角色闸挡住」与「页面真的好了」在屏上一模一样。
   */
  it("§0 金丝雀：人为制造一次崩溃 ⇒ 崩溃页确实出现（证明本门咬得动）", async () => {
    induceCrash();
    loginAs("planner");
    renderApp("/admin/ontology-relations");
    expect(
      await settled("ontology-relations-page"),
      "金丝雀不中 ⇒ 是这道门坏了（探针失灵），不是页面好了",
    ).toBe(true);
  });

  /**
   * §1 隔离区。
   * 后端真实回包：`quarantine.list()` → `{ items, byReason, total }`
   * （`apps/datacore/src/quarantine.ts` 的 `async list(...)`，返回类型就写在签名上）。
   * 前端此前声明成 `QuarantineRowView[]` 并 `(data ?? []).filter(...)` ⇒ 拿对象当数组。
   */
  it("§1 /admin/quarantine：后端回 {items,byReason,total} ⇒ 不崩，且行渲染得出来", async () => {
    server.use(
      http.get("*/a/v1/quarantine", () =>
        HttpResponse.json({
          items: [
            {
              id: "q1",
              connId: "c1",
              dataset: "orders",
              raw: { a: 1 },
              reason: "DUP_KEY",
              detail: "主键重复",
              status: "PENDING",
              createdAt: "2026-08-30T00:00:00.000Z",
            },
          ],
          byReason: { DUP_KEY: 1 },
          total: 1,
        }),
      ),
    );
    loginAs("planner");
    renderApp("/admin/quarantine");
    expect(await settled("quarantine-page")).toBe(false);
    // 不止「没崩」——那一行真的上屏了。空表也不崩，但那证明不了消费的是 `items`。
    expect(await screen.findByTestId("q-row-q1")).toBeTruthy();
  });

  /**
   * §2 闭环验证。
   * 后端真实回包：`GET /a/v1/validation/runs` → `{ items: runs.sort(...) }`
   * （`apps/datacore/src/app.ts`，该路由 return 的就是这个对象字面量）。
   */
  it("§2 /admin/validation：后端回 {items} ⇒ 不崩，且运行行渲染得出来", async () => {
    server.use(
      http.get("*/a/v1/validation/runs", () =>
        HttpResponse.json({
          items: [
            {
              id: "vr1",
              profile: "SMOKE",
              seed: 42,
              startedAt: "2026-08-30T00:00:00.000Z",
              finishedAt: "2026-08-30T00:01:00.000Z",
              report: {
                profile: "SMOKE",
                seed: 42,
                pass: true,
                assertions: [],
                coverage: { module: 1, assertion: 1, loop: 1 },
                engineeringVerificationScore: 1,
              },
            },
          ],
        }),
      ),
    );
    loginAs("planner");
    renderApp("/admin/validation");
    expect(await settled("validation-page")).toBe(false);
    expect(await screen.findByTestId("vle-run-vr1")).toBeTruthy();
  });

  /**
   * §3 本体关系 —— 本单最要紧的一处。
   *
   * 后端真实回包：`PublishRequestRecord`（`apps/datacore/src/domain.ts`）历史上**没有
   * `touchedDomains`**，只有 `signoffs[{domainKey, ownerUserId, decision}]`。
   * 而前端契约声明了 `touchedDomains: string[]` 并 `.join(" · ")`。
   *
   * ⚠ 本用例**故意不给** `touchedDomains` —— 它模拟的是**修这道门之前就已经落库**的老记录。
   * 只把后端改成「以后会下发」是修一半：老记录照样把这一页打崩，而且 F5 救不回。
   * 这一条钉住的就是另一半（前端从 `signoffs` 现推）。
   */
  it("§3 /admin/ontology-relations：老会签记录没有 touchedDomains ⇒ 不崩，触及域从 signoffs 现推", async () => {
    server.use(
      http.get("*/a/v1/ontology/publish-requests", () =>
        HttpResponse.json([
          {
            id: "preq_demo_1",
            tenantId: "demo",
            ontologyVersion: 7,
            requestedBy: "usr_demo_admin",
            status: "PENDING_SIGNOFF",
            // ← touchedDomains 故意缺席：这正是线上老记录的形状
            signoffs: [
              { domainKey: "capacity", ownerUserId: "usr_demo_admin", decision: null },
              { domainKey: "commercial", ownerUserId: null, decision: null },
            ],
            createdAt: "2026-08-30T00:00:00.000Z",
          },
        ]),
      ),
    );
    loginAs("planner");
    renderApp("/admin/ontology-relations");
    expect(await settled("ontology-relations-page")).toBe(false);

    const row = await screen.findByTestId("orel-pubreq-preq_demo_1");
    // 触及域这一格必须**真的有内容**，不是靠渲染成空字符串糊过去 ——
    // 「不崩但那一列永远是 —」等于把崩溃换成静默不工作，本仓明令禁止的形态。
    expect(row.textContent).toContain("capacity");
    expect(row.textContent).toContain("commercial");
  });

  /**
   * §4 **崩溃必须有边界**（这条是前三处的放大器，单独钉）。
   *
   * 外壳是 `<ErrorBoundary><Outlet/></ErrorBoundary>`。原实现没有任何东西会清 error 态，
   * 而 SPA 内换路由时 `Outlet` 只是换孩子、边界组件**自己不卸载** ⇒
   * 一页崩了之后**每一页都是崩溃页**，只有 F5 能救。
   * 2026-08-30 真浏览器实测：`/admin/quarantine` 崩 → 点左导航去 `/v/quarterly-rolling` → 仍是崩溃页。
   * E2E 的第一次全站扫描就是这么被毁掉的：一页崩，后面每页都被读成「坏」，**金丝雀因此报假**。
   */
  it("§4 一页崩了，SPA 内换到别的页不许还是崩溃页（边界）", async () => {
    induceCrash();
    loginAs("planner");
    const { router } = renderApp("/admin/ontology-relations");
    expect(
      await settled("ontology-relations-page"),
      "前置没成立：这一页压根没崩，则本条什么都没证明",
    ).toBe(true);

    // 关键动作：**SPA 内导航**（不是 F5）——这正是 E2E 扫描器和真人点导航走的路。
    await router.navigate("/admin/validation");
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/validation"));

    expect(
      await settled("validation-page"),
      "换页之后仍是崩溃页 ⇒ 边界没起作用，一页崩把整个后台钉死",
    ).toBe(false);
  });

  /**
   * §5 崩溃页必须给**可点的恢复动作**，不许只是一个空转按钮。
   *
   * 原实现那颗「刷新」按钮做的是 `setState({error:null})` —— 把同一个坏页面再渲染一遍，
   * 崩溃条件没变就当场再崩，用户点一百次也是同一屏。
   * 这里钉的是：崩溃页上确实有恢复入口，且错误原文照样给（**不吞**）。
   */
  it("§5 崩溃页给出错误原文 + 可点的恢复动作（不吞错误、不空转）", async () => {
    induceCrash();
    loginAs("planner");
    renderApp("/admin/ontology-relations");
    expect(await settled("ontology-relations-page")).toBe(true);

    const detail = await screen.findByTestId("page-error-detail");
    expect(detail.textContent?.trim(), "错误原文被吞了 —— 崩溃变成了看不见的静默").toBeTruthy();

    const back = await screen.findByTestId("page-error-back");
    const reload = await screen.findByTestId("page-error-reload");
    expect(back).toBeTruthy();
    expect(reload).toBeTruthy();
    // 恢复按钮真的可点（不是 disabled 的摆设）。
    await userEvent.click(back);
  });
});
