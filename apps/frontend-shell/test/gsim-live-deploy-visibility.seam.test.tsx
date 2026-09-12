import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import GlobalSimView from "@/views/sim/GlobalSimView";
import { workspaceQueryKey } from "@/workspace/useWorkspace";
import { FEATURE_REGISTRY as MOCK_FEATURE_REGISTRY } from "@/mocks/fixtures";
import type { Workspace, ViewConfigVM } from "@/api/types";
import { server } from "./setup";
import { loginAs } from "./utils";

/**
 * WO-GSIM-LIVE-FLAG-REASON · 接缝：**A 侧 `features.ts` 的真 workspace 口径 → 前端那两块真的渲染出来**。
 *
 * ── 这道接缝要堵的是哪个事故形态（先读，别把它当普通渲染测试）────────────────────────────
 * `view.global-sim.live` 曾经**两侧反向**：A 侧 `apps/datacore/src/features.ts` 是 `defaultOn:false`，
 * 前端 mock `apps/frontend-shell/src/mocks/fixtures.ts` 是 `defaultOn:true`。
 * `<Feature flag="view.global-sim.live">`（`src/workspace/featureGate.tsx`）是 R3 闸，关 ⇒ 整块不渲染。
 * 于是：
 *   · `VITE_MOCK=1` 的**全部前端测试**走 fixtures（true）⇒ 那两块渲染 ⇒ **全绿**；
 *   · 真部署走 A 侧 workspace（false）⇒ 那两块**看不见**。
 * **「前端绿」证明不了「真部署可见」——这正是本文件存在的唯一理由。**
 * 所以本文件**刻意不使用 MSW/fixtures 那条 workspace 路**：workspace 由**真 datacore 应用**
 * 经 `GET /a/v1/me/workspace` 现产（见 `realWorkspace()`），拿 fixtures 测等于自证。
 *
 * ── 为什么租户必须是「无行业模板」的（这一步漏了，整个文件退化成哑门）──────────────────
 * `features.ts` 的 `layeredSet()` L2：租户**有**行业模板时，模板集合会把 L1 结果整个取代
 * （先按模板求交、再无条件 `on.add` 模板成员）⇒ **`defaultOn` 对有模板的租户毫无作用**。
 * 实测（本单变异反证，2026-08-17）：
 *   | 租户 | defaultOn:true | defaultOn:false |
 *   |---|---|---|
 *   | `plain`（无模板） | 70 项 · **有**本键 · 四端点 201/200/201/200 | 69 项 · **无**本键 · 四端点**全 404** |
 *   | `demo`（battery·L2 全开） | 90 项 · 有本键 | 90 项 · **仍有本键**（**对 defaultOn 完全不敏感**） |
 * ⇒ **拿 `demo` 驱动这条接缝 = 拿一个恒真的输入去测一个开关**，翻回 false 也不会红。
 *   本文件因此固定用 `plain`（`tenants.put` 不带 `industry`）。改这一行前先看懂上表。
 *
 * ── 变异反证（本接缝的有效性判据·必须亲手复现过才算数）────────────────────────────────
 * 把 `apps/datacore/src/features.ts` 里 `view.global-sim.live` 的 `defaultOn` 改回 `false`：
 *   ⇒ 用例①②必须**红在「那两块没渲染出来」**（`global-sim-nl-dock` / `global-sim-scenario-bar` 找不到），
 *     而不是红在「组件不存在 / import 失败 / 应用起不来」。
 * 复验命令：
 *   pnpm --filter frontend-shell exec vitest run test/gsim-live-deploy-visibility.seam.test.tsx
 */

/**
 * ⚠ 下面 import 的是 **datacore 的真源码**（不是 mock、不是副本）。这条 import 就是本接缝的命门：
 * `contracts-only-shared` 约束的是**生产代码**；跨系统接缝测试直连对侧源码是本仓既有做法
 * （先例：`test/global-sim-seam-realsolver.test.tsx` import `../../datacore/src/solvers/portfolio.js`）。
 *
 * ── 为什么必须桩掉 `solvers/sandbox.js`（实测踩出来的，别顺手删）──────────────────────
 * 不桩 ⇒ 整个测试文件**连一条用例都跑不起来**，报
 *   `TypeError: The URL must be of scheme file` @ `apps/datacore/src/solvers/sandbox.ts:7`
 * 表现成 "Failed Suites / no tests"，极易被误读成「这条接缝测不了」。
 *
 * ⚠️ **病因别搞错**（本单第一次判错过，照铁律 0.5 记账）：
 *   初判是「jsdom 的全局 `URL` 忽略 `file:` 基址」，据此去 patch `globalThis.URL` —— **无效**。
 *   亲手加探针实测（临时模块 `import.meta.url` + `new URL(...)` 双打印）才得到真机制：
 *     · `import.meta.url` 本身**是** file: 的（`file:///…/apps/datacore/test/…`）——不是它的错；
 *     · 而 `new URL("./x.mjs", import.meta.url).href` 求值出 `http://localhost:3000/@fs/…/x.mjs`。
 *   ⇒ 真机制是 **Vite 在 transform 期静态改写 `new URL("<字面量>", import.meta.url)`**（资产 URL 处理），
 *     `sandbox.ts` 顶层的 `fileURLToPath(new URL("./sandbox-runner.mjs", import.meta.url))` 因此拿到 http URL。
 *   **既然是编译期改写，任何运行期换 `URL` 全局的做法都够不着** —— 这就是那条修法无效的原因。
 * 本用例只走 `GET /a/v1/me/workspace`，完全不碰自定义求解器沙箱 ⇒ 桩成恒抛是安全且诚实的
 * （真被调到会立刻炸，不会静默给出假结果）。
 */
vi.mock("../../datacore/src/solvers/sandbox.js", () => ({
  runSolverSandbox: () => {
    throw new Error("本接缝用例不应触达自定义求解器沙箱（只走 GET /a/v1/me/workspace 与 <Feature> 闸）");
  },
}));

import { makeApp, debugUser } from "../../datacore/test/helpers.js";

/** 真 datacore 应用现产的 workspace（**唯一**口径源·不经 MSW/fixtures）。 */
async function realWorkspace(opts?: { overrides?: Record<string, boolean> }): Promise<Workspace> {
  const t = await makeApp();
  // 无 industry ⇒ `templateFeatures()` 返回 undefined ⇒ L2 不介入 ⇒ **L1 `defaultOn` 就是判据**。
  await t.repos.tenants.put({ id: "plain", tenantId: "plain", name: "无行业模板租户" });
  const H = debugUser("plain", "u1", "admin");
  if (opts?.overrides) {
    // L3 租户级 override（走真路由，不是直接改内存）——用于「闸真的会关」那一侧的反证。
    const put = await t.app.inject({
      method: "PUT", url: "/a/v1/tenants/plain/features",
      headers: { ...debugUser("plain", "u1", "admin"), "content-type": "application/json" },
      payload: { overrides: opts.overrides },
    });
    if (put.statusCode >= 400) throw new Error(`feature override failed: ${put.statusCode} ${put.body}`);
  }
  const res = await t.app.inject({ method: "GET", url: "/a/v1/me/workspace", headers: H });
  if (res.statusCode !== 200) throw new Error(`workspace failed: ${res.statusCode} ${res.body}`);
  return res.json() as Workspace;
}

/**
 * 用**真 workspace** 驱动渲染。
 *
 * 页面自身的数据（订单 / portfolio 解）照常走 MSW —— 那部分与本门无关，且 `/a/v1/objects` 桩要求
 * 已登录（`auth()` 不过即 401），故必须 `loginAs`。但**workspace 这一路必须封死**，
 * 否则就退回「拿 fixtures 自证」了：
 *  ① 先 `setQueryData` 灌入真 datacore 产物；`useWorkspace` 的 `staleTime` 5 分钟 ⇒ 挂载时不会重取；
 *  ② 再把 MSW 的 `/a/v1/me/workspace` 覆盖成**空 features 的哨兵**（`server.use`，`resetHandlers` 逐例清）。
 *     哨兵的作用是**让「万一真去打了 mock」这件事必然被抓到**：一旦缓存被 mock 结果顶掉，
 *     features 变空 ⇒ 闸关 ⇒ 用例① 立刻红。**这条哨兵就是本文件「没走 fixtures」的机器证据**，
 *     不是靠注释声明的。
 */
function renderGlobalSimWith(ws: Workspace): { queryClient: QueryClient } {
  loginAs("planner"); // 只为让 `/a/v1/objects` 等页面数据桩放行（`auth()` 不过就 401 ⇒ 页面无订单 ⇒ 不求解）
  server.use(
    http.get("*/a/v1/me/workspace", () =>
      HttpResponse.json({ ...ws, tenant: { id: "SENTINEL-mock", name: "哨兵：不该被用到" }, features: [] }),
    ),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(workspaceQueryKey, ws);
  const view = { viewKey: "global-sim", name: "接单组合优选", renderer: "global-sim", layout: {}, options: {} } as unknown as ViewConfigVM;
  const ui: ReactNode = (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><GlobalSimView view={view} /></MemoryRouter>
    </QueryClientProvider>
  );
  render(ui);
  return { queryClient };
}

/** 哨兵复核：屏上那道闸自始至终读的是真 datacore 的 workspace，不是 MSW/fixtures 的。 */
function assertNotServedByMock(queryClient: QueryClient): void {
  const cached = queryClient.getQueryData<Workspace>(workspaceQueryKey);
  expect(cached?.tenant?.id, "workspace 缓存被 MSW 哨兵顶掉了 ⇒ 本用例实际在拿 mock 自证，结论作废").toBe("plain");
}

const KEY = "view.global-sim.live";

describe("WO-GSIM-LIVE-FLAG-REASON · 真部署口径 → 活系统两块真的渲染（跨 A 侧 features.ts 与前端 <Feature> 闸）", () => {
  it("① 真 workspace（无模板租户·L1 defaultOn 决定）下：NL 对话坞 + 方案存比条**都渲染出来**", async () => {
    const ws = await realWorkspace();
    const { queryClient } = renderGlobalSimWith(ws);

    // 活①·NL 对话坞（GlobalSimView.tsx 的 `<Feature flag=…><GlobalSimNlDock/></Feature>` 那一处）。
    expect(
      await screen.findByTestId("global-sim-nl-dock"),
      `那块没渲染出来：A 侧真 workspace 未下发 ${KEY}（= 真部署看不见），或 <Feature> 闸被关`,
    ).toBeInTheDocument();

    // 活③·方案存/分支/横比条（`{d && <Feature flag=…><GlobalSimScenarioBar/></Feature>}`——需 portfolio 解到位后才挂）。
    await waitFor(
      () => expect(
        screen.queryByTestId("global-sim-scenario-bar"),
        `那块没渲染出来：A 侧真 workspace 未下发 ${KEY}（= 真部署看不见），或 <Feature> 闸被关`,
      ).not.toBeNull(),
      { timeout: 15000 },
    );
    assertNotServedByMock(queryClient);
  });

  it("② 口径自证：本用例的 features 确实来自 A 侧真 registry，不是 mock fixtures", async () => {
    const ws = await realWorkspace();
    // 真 workspace 一定带 features 数组（缺了 `featureOn()` 会 fail-open 恒 true ⇒ 用例①退化成恒绿）。
    expect(Array.isArray(ws.features), "workspace 未下发 features ⇒ featureGate fail-open ⇒ 用例① 恒真，是哑门").toBe(true);
    expect(ws.features).toContain(KEY);
    // 租户身份自证：mock fixtures 的 workspace 是 demo；这份是 plain（无 industry）⇒ 不可能来自 fixtures。
    expect(ws.tenant.id).toBe("plain");
    expect((ws.tenant as { industry?: string }).industry ?? null).toBeNull();
    // 前端 mock 侧同键此刻也是 true —— 正因为两侧同值，用 fixtures 测**看不出**任何差别（自证陷阱）。
    expect(MOCK_FEATURE_REGISTRY.find((f) => f.key === KEY)?.defaultOn).toBe(true);
  });

  it("③ 反证：同一条链上把闸关掉（L3 override）⇒ 那两块**都消失**（证明用例① 不是恒真）", async () => {
    const ws = await realWorkspace({ overrides: { [KEY]: false } });
    expect(ws.features, "override 没生效 ⇒ 本反证无效").not.toContain(KEY);
    const { queryClient } = renderGlobalSimWith(ws);
    // 等页面把非门控内容渲染出来（证明「不是整页都没渲染」），再断言那两块确实缺席。
    expect(await screen.findByTestId("global-sim-transfer-chain")).toBeInTheDocument();
    expect(screen.queryByTestId("global-sim-nl-dock")).toBeNull();
    expect(screen.queryByTestId("global-sim-scenario-bar")).toBeNull();
    assertNotServedByMock(queryClient);
  });
});
