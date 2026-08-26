import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { checkedTree, factHits } from "./factlock";

/**
 * WO-INTERFACE-ADMIN-UI · **对象接口管理台的接缝门**
 *
 * ── 这道门要证的那**一句话** ──────────────────────────────────────────────────
 *   **「在管理台上建/改/发一个 ObjectInterface，走真端点真落 mock store；接口加一条必需属性并发布后，
 *     发布门预览（与 `assertInterfaceConformance` 同一把尺子）当场变红，屏上点名到那个属性。」**
 *
 * 不是「表单能提交」，不是「endpoints.ts 里有这个函数」—— 那两样都能在缺口仍在的情况下全绿
 * （本仓假绿第 9 形态：测试咬的是函数，不是链路）。
 *
 * ── 三条设计决定（照 ontology-relations.seam.test.tsx 同一份模板）──────────────────────
 *  ① **不 `vi.mock("@/api/endpoints")`** —— 那会把病灶所在的那一跳一起 mock 掉。
 *     本文件走真 endpoints，在 MSW 层拦**真实 URL + 真实 body**。
 *  ② **从真渲染出来的可见控件驱动**，路径是真 route `/admin/interfaces`（经 `AdminGuard` 角色闸）。
 *  ③ **mock 的派生口径钉在后端源码上**（§事实锁）：判定走 contracts 同一份
 *     `checkInterfaceConformance`/`checkInterfaceIntegrity`（与后端 `ontology.ts interfaceViolations`
 *     同一个函数），种子逐字镜像 `battery.ts`/`battery-extended.ts`/`ontology-signature.ts`，
 *     后端一改口径，这里当场红。
 *
 * ── 立项行原文（docs/WO-QUEUE-breakpoints-2.md 「中」画像表）──────────────────────────
 *   判据落在「管理台能建/改/发一个 ObjectInterface 且不合规实现被 `assertInterfaceConformance`
 *   拒时屏上点名到属性」；grep 自证：交付后 `ObjectInterface` 前端命中 >0
 */

type Hit = { url: string; body: unknown };

function spyOn(method: "get" | "post", pattern: string, sink: Hit[]) {
  server.use(
    http[method](pattern, async ({ request }) => {
      const body = method === "post" ? await request.clone().json().catch(() => null) : null;
      sink.push({ url: request.url, body });
      return undefined as never; // 落回原 handler（有状态 store 照常推进）
    }),
  );
}

async function openPage() {
  loginAs("planner");
  renderApp("/admin/interfaces");
  await screen.findByTestId("interfaces-page");
  // 等清单与发布门预览都取回来（`—` 状态下断言是空胜）
  await screen.findByTestId("oif-row-Approvable");
  await screen.findByTestId("oif-conformance-badge");
}

describe("WO-INTERFACE-ADMIN-UI ① 建/发链路（POST /a/v1/ontology/interfaces × GET 列表 × publish）", () => {
  beforeEach(() => loginAs("planner"));
  afterEach(() => cleanup());

  it("建一个新接口 ⇒ 真 POST 真落库，列表真的长出来；发布后状态翻成「已发布」", async () => {
    const posts: Hit[] = [];
    const pubs: Hit[] = [];
    spyOn("post", "*/a/v1/ontology/interfaces", posts);
    spyOn("post", "*/a/v1/ontology/interfaces/:key/publish", pubs);

    const user = userEvent.setup();
    await openPage();

    await user.type(screen.getByTestId("oif-key"), "Trackable");
    await user.type(screen.getByTestId("oif-name"), "可追溯物");
    await user.type(screen.getByTestId("oif-statement"), "必须能说清溯源标识的业务记录。");
    await user.click(screen.getByTestId("oif-prop-add"));
    await user.type(screen.getByTestId("oif-prop-key-0"), "traceId");
    await user.selectOptions(screen.getByTestId("oif-prop-type-0"), "string");
    await user.type(screen.getByTestId("oif-actions"), "对象数据变更");
    await user.click(screen.getByTestId("oif-save"));

    // ── 载体①：请求真发出去了，且发的是那条真路、那个形状的 body
    await waitFor(() => expect(posts.length, "POST /a/v1/ontology/interfaces 一次都没发出去").toBe(1));
    expect(posts[0]!.url).toContain("/a/v1/ontology/interfaces");
    expect(posts[0]!.body).toMatchObject({
      key: "Trackable",
      name: "可追溯物",
      businessDefinition: { statement: "必须能说清溯源标识的业务记录。" },
      properties: [{ propKey: "traceId", dataType: "string", required: true }],
      actions: [{ actionTypeKey: "对象数据变更", required: true }],
    });

    // ── 载体②：**列表真的长出来了**（用户看得见自己刚建的东西；DRAFT 态）
    expect(await screen.findByTestId("oif-row-Trackable")).toBeTruthy();
    expect((await screen.findByTestId("oif-status-Trackable")).textContent).toBe("草稿");

    // ── 发：真 POST :key/publish，状态真的翻成「已发布」
    await user.click(await screen.findByTestId("oif-publish-Trackable"));
    await waitFor(() => expect(pubs.length, "POST …/interfaces/Trackable/publish 没发出去").toBe(1));
    expect(pubs[0]!.url).toContain("/a/v1/ontology/interfaces/Trackable/publish");
    await waitFor(async () =>
      expect((await screen.findByTestId("oif-status-Trackable")).textContent).toBe("已发布"),
    );
  });

  it("声明一个不在求解器签名注册表的函数 ⇒ 后端 400 逐条点名，屏上亮出 solverKey，列表不假装建成", async () => {
    const posts: Hit[] = [];
    spyOn("post", "*/a/v1/ontology/interfaces", posts);

    const user = userEvent.setup();
    await openPage();

    await user.type(screen.getByTestId("oif-key"), "Ghost");
    await user.type(screen.getByTestId("oif-name"), "幽灵接口");
    await user.type(screen.getByTestId("oif-functions"), "not_a_solver");
    await user.click(screen.getByTestId("oif-save"));

    await waitFor(() => expect(posts.length).toBe(1));
    // 400 原文上屏（不是 toast 一闪而过）：码 + solverKey 都点名叫得出
    const errBox = await screen.findByTestId("oif-form-error");
    await waitFor(() => {
      expect(errBox.textContent).toContain("INTERFACE_FUNCTION_UNKNOWN");
      expect(errBox.textContent).toContain("not_a_solver");
    });
    // 列表**不许**假装成功
    expect(screen.queryByTestId("oif-row-Ghost")).toBeNull();
  });
});

describe("WO-INTERFACE-ADMIN-UI ② 改/发 ⇒ 发布门预览变红并点名到属性（S7 接缝：upsert × publish × conformance × implementers）", () => {
  beforeEach(() => loginAs("planner"));
  afterEach(() => cleanup());

  it("给 Approvable 加第 4 条必需属性并发布 ⇒ 两个 latest 实现者同时被点名到该属性，迁移清单同现", async () => {
    const posts: Hit[] = [];
    const pubs: Hit[] = [];
    const confs: Hit[] = [];
    spyOn("post", "*/a/v1/ontology/interfaces", posts);
    spyOn("post", "*/a/v1/ontology/interfaces/:key/publish", pubs);
    spyOn("get", "*/a/v1/ontology/interfaces/conformance", confs);

    const user = userEvent.setup();
    await openPage();

    // 前提态：种子世界里两个实现者都合规（§事实锁钉住种子与后端 battery.ts 逐字对齐）
    expect((await screen.findByTestId("oif-conformance-badge")).textContent).toBe("全部实现者合规");
    expect((await screen.findByTestId("oif-status-Approvable")).textContent).toBe("已发布");

    // ── 改：点「改」表单预填三属性，再加第 4 条必需属性 creditRating
    await user.click(screen.getByTestId("oif-edit-Approvable"));
    await user.click(screen.getByTestId("oif-prop-add"));
    await user.type(screen.getByTestId("oif-prop-key-3"), "creditRating");
    await user.selectOptions(screen.getByTestId("oif-prop-type-3"), "string");
    await user.click(screen.getByTestId("oif-save"));

    // 已发布的 key 不原地改 ⇒ POST 落成新 DRAFT 版本（开闭：老版本仍在，pin 住的实现者不受影响）
    await waitFor(() => expect(posts.length, "改接口的 POST 没发出去").toBe(1));
    expect(posts[0]!.body).toMatchObject({
      key: "Approvable",
      properties: [
        { propKey: "approver", dataType: "string", required: true },
        { propKey: "approvedAt", dataType: "date", required: true },
        { propKey: "amount", dataType: "number", required: true },
        { propKey: "creditRating", dataType: "string", required: true },
      ],
    });
    await waitFor(async () =>
      expect((await screen.findByTestId("oif-status-Approvable")).textContent).toBe("草稿"),
    );

    // ── 发：DRAFT v2 → PUBLISHED
    await user.click(await screen.findByTestId("oif-publish-Approvable"));
    await waitFor(() => expect(pubs.length, "POST …/interfaces/Approvable/publish 没发出去").toBe(1));
    await waitFor(async () =>
      expect((await screen.findByTestId("oif-status-Approvable")).textContent).toBe("已发布"),
    );

    // ── 接缝本体：发布门预览真的变红，且**点名到那个新属性**（两个 latest 实现者同时被拦 —— S7）
    //    这就是 `assertInterfaceConformance` 在本体发布时会说的话（同一份 contracts 校验实现，§事实锁钉住）。
    await waitFor(async () =>
      expect((await screen.findByTestId("oif-conformance-badge")).textContent).toBe("2 项不合规"),
    );
    const v1 = await screen.findByTestId("oif-violation-ARInvoice-creditRating");
    expect(v1.textContent).toContain("INTERFACE_PROPERTY_MISSING");
    expect(v1.textContent).toContain("缺少必需属性 'creditRating'");
    expect(await screen.findByTestId("oif-violation-OverdueRecord-creditRating")).toBeTruthy();

    // ── 实现者钻取：不合规标记 + 逐条违规 + 迁移清单，三处都点名到 creditRating
    await user.click(screen.getByTestId("oif-impl-Approvable"));
    await screen.findByTestId("oif-impl-panel");
    expect((await screen.findByTestId("oif-impl-conformant-ARInvoice")).textContent).toBe("不合规");
    expect((await screen.findByTestId("oif-impl-conformant-OverdueRecord")).textContent).toBe("不合规");
    expect((await screen.findByTestId("oif-impl-violation-ARInvoice-creditRating")).textContent).toContain("creditRating");
    expect((await screen.findByTestId("oif-migration-ARInvoice")).textContent).toContain("creditRating");
    expect((await screen.findByTestId("oif-migration-OverdueRecord")).textContent).toContain("creditRating");

    // ── 历史版本真可读（GET :key?version=N）：v1 还是老三属性，不含 creditRating
    await user.click(await screen.findByTestId("oif-ver-1"));
    const hist = await screen.findByTestId("oif-history-panel");
    await waitFor(() => expect(hist.textContent).toContain("Approvable@v1"));
    expect(hist.textContent).toContain("approver:string");
    expect(hist.textContent).not.toContain("creditRating");

    // conformance 端点被真查过（不是缓存造出的红）
    expect(confs.length, "GET …/interfaces/conformance 一次都没发 ⇒ 屏上的红不是真后端口径").toBeGreaterThan(0);
  });

  it("退役一个仍被实现的接口 ⇒ 状态翻「已退役」，发布门预览当场点名（反向证明面板不是装饰品）", async () => {
    const retires: Hit[] = [];
    spyOn("post", "*/a/v1/ontology/interfaces/:key/retire", retires);

    const user = userEvent.setup();
    await openPage();
    expect((await screen.findByTestId("oif-conformance-badge")).textContent).toBe("全部实现者合规");

    await user.click(screen.getByTestId("oif-retire-Approvable"));
    await waitFor(() => expect(retires.length, "POST …/interfaces/Approvable/retire 没发出去").toBe(1));
    await waitFor(async () =>
      expect((await screen.findByTestId("oif-status-Approvable")).textContent).toBe("已退役"),
    );

    // latest 实现者解析不到任何已发布版本 ⇒ 发布门预览点名 INTERFACE_NOT_PUBLISHED（绝不静默失效）
    await waitFor(async () =>
      expect((await screen.findByTestId("oif-conformance-badge")).textContent).not.toBe("全部实现者合规"),
    );
    const v = await screen.findByTestId("oif-violation-ARInvoice-INTERFACE_NOT_PUBLISHED");
    expect(v.textContent).toContain("Approvable");
  });
});

describe("WO-INTERFACE-ADMIN-UI ③ 事实锁：mock 的口径钉在后端源码上（不许 mock 自洽）", () => {
  /**
   * ①② 全部跑在 MSW 上。若 mock 的接口世界自己编一套校验/种子，上面每条断言只证明了「mock 和 mock 一致」。
   * 本组让**机器先说话**：后端哪天改了发布门挂点/种子/签名，这里当场红，指向真正改动的地方。
   * 金丝雀走 `checkedTree`（铁律 0.6）：扫描面塌了 / 已知必中零命中 / 注释被当成代码，任一发生 ⇒ 红的是「工具坏了」。
   */
  const dc = () => checkedTree("apps/datacore/src", "assertInterfaceConformance", 40);

  it("金丝雀：扫描器活着（已知必中命中）", () => {
    expect(factHits(dc(), "assertInterfaceConformance").length, "已知必中的符号零命中 ⇒ 扫描器坏了").toBeGreaterThan(0);
  });

  it("发布门真的挂在发布链路上（publishVersion 调 assertInterfaceConformance），且只读报告与它同一把尺子", () => {
    const tree = dc();
    expect(
      factHits(tree, /await this\.assertInterfaceConformance\(/),
      "publishVersion 里找不到 assertInterfaceConformance 调用 ⇒ 发布门不在链路上，「被拒」一语失去依据",
    ).toContain("apps/datacore/src/ontology.ts");
    // 同一把尺子：发布门与只读 conformance 报告都经 `interfaceViolations` → contracts `checkInterfaceConformance`
    expect(
      factHits(tree, /checkInterfaceConformance\(/),
      "ontology.ts 里找不到 checkInterfaceConformance 调用 ⇒ 「预览=发布门会说的话」失去依据",
    ).toContain("apps/datacore/src/ontology.ts");
  });

  it("mock 的校验走的是 contracts 同一份实现（不是 mock 自抄的 if-else）", () => {
    const mocks = checkedTree("apps/frontend-shell/src/mocks", "checkInterfaceConformance", 3);
    expect(
      factHits(mocks, /checkInterfaceConformance\(/),
      "interfaceFixtures 不调 checkInterfaceConformance ⇒ mock 在自说自话，①②全组结论作废",
    ).toContain("apps/frontend-shell/src/mocks/interfaceFixtures.ts");
    expect(
      factHits(mocks, /checkInterfaceIntegrity\(/),
      "interfaceFixtures 不调 checkInterfaceIntegrity ⇒ upsert/publish 的 400 路径失去依据",
    ).toContain("apps/frontend-shell/src/mocks/interfaceFixtures.ts");
  });

  it("接口种子逐字镜像后端：Approvable 三属性（approver/approvedAt/amount）+ 行动 + 函数", () => {
    const tree = dc();
    expect(factHits(tree, "BATTERY_OBJECT_INTERFACES"), "后端接口种子没了 ⇒ mock 种子失去对齐锚点").toContain(
      "apps/datacore/src/synthetic/battery.ts",
    );
    for (const probe of [
      /propKey: "approver", dataType: "string" as const/,
      /propKey: "approvedAt", dataType: "date" as const/,
      /propKey: "amount", dataType: "number" as const/,
      /actionTypeKey: "对象数据变更", required: true/,
      /solverKey: "credit_exposure", required: true/,
    ]) {
      expect(factHits(tree, probe), `后端种子变了（${probe}）⇒ mock 种子（interfaceFixtures）必须跟着改`).toContain(
        "apps/datacore/src/synthetic/battery.ts",
      );
    }
  });

  it("实现者绑定逐字镜像后端：ARInvoice / OverdueRecord 跟 latest", () => {
    const tree = dc();
    for (const t of ["ARInvoice", "OverdueRecord"]) {
      expect(
        factHits(tree, new RegExp(`${t}: \\{ implements: \\[\\{ interfaceKey: "Approvable", version: "latest" \\}\\]`)),
        `后端 ${t} 的接口绑定变了 ⇒ mock 的类型视图种子必须跟着改`,
      ).toContain("apps/datacore/src/synthetic/battery.ts");
    }
  });

  it("求解器签名镜像后端：credit_exposure 读 ARInvoice.{amount,custName,invoiceId,overdueDays}", () => {
    const tree = dc();
    expect(
      factHits(tree, /\{ typeKey: "ARInvoice", propKeys: \["amount", "custName", "invoiceId", "overdueDays"\] \}/),
      "credit_exposure 的 P2 本体签名变了 ⇒ mock 的签名镜像（interfaceFixtures）必须跟着改",
    ).toContain("apps/datacore/src/solvers/ontology-signature.ts");
  });

  it("页面真的挂在真 route 上（route + registry + 导航分组三处齐全）", () => {
    const fe = checkedTree("apps/frontend-shell/src", "ADMIN_PAGES", 100);
    expect(factHits(fe, 'admin("interfaces"'), "App.tsx 没有这条 route ⇒ 页面不可达").toContain(
      "apps/frontend-shell/src/App.tsx",
    );
    expect(factHits(fe, '{ path: "interfaces"'), "adminRegistry 没登记 ⇒ AdminGuard 恒 404").toContain(
      "apps/frontend-shell/src/pages/adminRegistry.ts",
    );
    expect(
      factHits(fe, '"interfaces"').filter((f) => f.endsWith("ShellLayout.tsx")),
      "ShellLayout.NAV_GROUPS 没登记 ⇒ 真实左导航里落「其它」兜底组，用户找不到",
    ).not.toEqual([]);
  });

  it("grep 自证（立项行验收）：`ObjectInterface` 前端生产代码命中 >0", () => {
    const fe = checkedTree("apps/frontend-shell/src", "ADMIN_PAGES", 100);
    const hits = factHits(fe, "ObjectInterface");
    expect(hits, "ObjectInterface 前端零命中 ⇒ 立项行验收不满足").toContain("apps/frontend-shell/src/pages/admin/InterfacesPage.tsx");
    expect(hits).toContain("apps/frontend-shell/src/api/endpoints.ts");
  });
});
