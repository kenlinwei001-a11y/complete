import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { checkedTree, factHits } from "./factlock";

/**
 * WO-BEFE-A · **本体关系编辑器的接缝门**
 *
 * ── 这道门要证的那**一句话** ──────────────────────────────────────────────────
 *   **「在界面上建一条因果边 ⇒ `GET /a/v1/sim/view-config` 的 `stateVars` / `propagationCount`
 *     真的跟着变；建成『停用』态则一个字都不变。」**
 *
 * 不是「表单能提交」，不是「endpoints.ts 里有这个函数」。那两样都能在缺口仍在的情况下全绿 ——
 * 本仓假绿第 9 形态（`G-SKILL-REFGRAPH-DEAD-EXTRACTOR`：实现有、测试有、且是绿的，零生产调用方）
 * 死的就是这一手：**测试咬的是函数，不是链路**。
 *
 * ── 三条设计决定（每条都是为了不让这道门变成装饰品）────────────────────────────
 *  ① **不 `vi.mock("@/api/endpoints")`**。那会把病灶所在的那一跳一起 mock 掉 ——
 *     桩函数收什么参数都行，URL 模板/query 串/body 序列化根本不参与，断言恒绿而缺口仍在。
 *     本文件走**真 endpoints**，在 MSW 层拦**真实 URL + 真实 body**。
 *  ② **从真渲染出来的可见控件驱动**，路径是真 route `/admin/ontology-relations`
 *     （经 `AdminGuard` 角色闸）。不是隔离挂组件 —— 那证明不了「用户点得到」。
 *  ③ **mock 的派生口径用事实锁钉在后端源码上**（§4）。
 *     `view-config` 的 mock 若自己编一套过滤规则，这道门就退化成「mock 自洽」：
 *     后端哪天把 `listPropagationRules(tenantId, true)` 改成 `false`，屏上一切照旧全绿。
 *     §4 的断言让**机器先说话**：后端一改口径，这里当场红。
 */

/** 真实 URL 命中记录（证明请求真发出去了、发的是那条路、body 是那个形状）。 */
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

/** 读接缝面板上的三个数（`—` = 还没取回来）。 */
async function readViewCfg(): Promise<{ links: number; stateVars: number; propCount: number }> {
  const num = async (testId: string) => {
    const el = await screen.findByTestId(testId);
    const m = /(\d+)/.exec(el.textContent ?? "");
    expect(m, `${testId} 读不到数字（原文「${el.textContent}」）⇒ 断言无从谈起`).not.toBeNull();
    return Number(m![1]);
  };
  return { links: await num("orel-vc-linktypes"), stateVars: await num("orel-vc-statevars"), propCount: await num("orel-vc-propcount") };
}

async function openPage() {
  loginAs("planner");
  renderApp("/admin/ontology-relations");
  await screen.findByTestId("ontology-relations-page");
  // 等三个数都取回来（`—` 状态下比大小是空胜）
  await waitFor(async () => expect((await readViewCfg()).propCount).toBeGreaterThanOrEqual(0));
}

/** 填满因果边表单并提交。`status` 即启停位。 */
async function createCausalEdge(
  user: ReturnType<typeof userEvent.setup>,
  v: { key: string; srcVar: string; tgtVar: string; status: "PUBLISHED" | "DRAFT" },
) {
  await user.clear(screen.getByTestId("orel-rule-key"));
  await user.type(screen.getByTestId("orel-rule-key"), v.key);
  await user.selectOptions(screen.getByTestId("orel-rule-srctype"), "Order");
  await user.clear(screen.getByTestId("orel-rule-srcvar"));
  await user.type(screen.getByTestId("orel-rule-srcvar"), v.srcVar);
  await user.selectOptions(screen.getByTestId("orel-rule-link"), "order_for_model");
  await user.selectOptions(screen.getByTestId("orel-rule-tgttype"), "Model");
  await user.clear(screen.getByTestId("orel-rule-tgtvar"));
  await user.type(screen.getByTestId("orel-rule-tgtvar"), v.tgtVar);
  await user.selectOptions(screen.getByTestId("orel-rule-status"), v.status);
  await user.click(screen.getByTestId("orel-rule-create"));
}

describe("WO-BEFE-A ① 因果边 → 推演口径（接缝：POST /a/v1/sim/propagation-rules × GET /a/v1/sim/view-config）", () => {
  beforeEach(() => loginAs("planner"));
  afterEach(() => cleanup());

  it("建一条【启用】的因果边 ⇒ propagationCount +1 且 stateVars 长出两个新变量", async () => {
    const posts: Hit[] = [];
    spyOn("post", "*/a/v1/sim/propagation-rules", posts);

    const user = userEvent.setup();
    await openPage();
    const before = await readViewCfg();

    await createCausalEdge(user, { key: "seam_on", srcVar: "orderPressure", tgtVar: "modelLoad", status: "PUBLISHED" });

    // ── 载体①：请求真发出去了，且发的是那条真路（不是别的 URL、不是别的 body 形状）
    await waitFor(() => expect(posts.length, "POST /a/v1/sim/propagation-rules 一次都没发出去").toBe(1));
    expect(posts[0]!.url).toContain("/a/v1/sim/propagation-rules");
    expect(posts[0]!.body).toMatchObject({
      key: "seam_on",
      sourceTypeKey: "Order",
      sourceStateVar: "orderPressure",
      viaLinkKey: "order_for_model",
      targetTypeKey: "Model",
      targetStateVar: "modelLoad",
      status: "PUBLISHED",
    });

    // ── 载体②：**推演口径真的跟着变了** —— 这一条才是接缝，上面那条只是「表单能提交」
    await waitFor(async () => {
      const after = await readViewCfg();
      expect(after.propCount, "建了一条启用的因果边，生效条数没变 ⇒ 这条边没进推演，接缝断了").toBe(before.propCount + 1);
      expect(after.stateVars, "两个新状态变量没进 stateVars ⇒ 沙盘看不到这条边的两端").toBe(before.stateVars + 2);
    });

    // 列表里也真出现了（用户看得见自己刚建的东西）
    expect(await screen.findByTestId("orel-rule-seam_on")).toBeTruthy();
    expect((await screen.findByTestId("orel-rule-status-seam_on")).textContent).toBe("启用");
  });

  it("建一条【停用】的因果边 ⇒ 在册可见，但 propagationCount / stateVars 一个字都不变", async () => {
    const user = userEvent.setup();
    await openPage();
    const before = await readViewCfg();

    await createCausalEdge(user, { key: "seam_off", srcVar: "ghostVarA", tgtVar: "ghostVarB", status: "DRAFT" });

    // 在册：列表里有，状态是「停用」
    expect(await screen.findByTestId("orel-rule-seam_off")).toBeTruthy();
    expect((await screen.findByTestId("orel-rule-status-seam_off")).textContent).toBe("停用");

    // 不生效：推演口径一动不动。
    // ⚠ 这条断言是**方向相反**的那一半 —— 只测「建了就变」而不测「停用的不变」，
    //   一个「无论 status 都计数」的实现照样全绿，而那正好是启停功能失效的样子。
    const after = await readViewCfg();
    expect(after.propCount, "停用的边被算进了生效条数 ⇒ 启停开关是装饰品").toBe(before.propCount);
    expect(after.stateVars, "停用边的状态变量混进了 stateVars ⇒ 沙盘把没生效的边画上去了").toBe(before.stateVars);
    expect(
      (await screen.findByTestId("orel-vc-statevars")).textContent,
      "ghostVarA/ghostVarB 不该出现在生效状态变量里",
    ).not.toContain("ghostVar");
  });
});

describe("WO-BEFE-A ② 结构边 CRUD 与启停（POST link-types / links:deprecate / links:retire / references）", () => {
  beforeEach(() => loginAs("planner"));
  afterEach(() => cleanup());

  it("建一条结构边 ⇒ 真 POST /a/v1/ontology/link-types，且 view-config.linkTypes 跟着 +1", async () => {
    const posts: Hit[] = [];
    spyOn("post", "*/a/v1/ontology/link-types", posts);

    const user = userEvent.setup();
    await openPage();
    const before = await readViewCfg();

    await user.type(screen.getByTestId("orel-link-key"), "seam_supplies_to");
    await user.selectOptions(screen.getByTestId("orel-link-from"), "Base");
    await user.selectOptions(screen.getByTestId("orel-link-to"), "Line");
    await user.selectOptions(screen.getByTestId("orel-link-card"), "N:N");
    await user.click(screen.getByTestId("orel-link-create"));

    await waitFor(() => expect(posts.length, "POST /a/v1/ontology/link-types 一次都没发出去").toBe(1));
    expect(posts[0]!.body).toMatchObject({ key: "seam_supplies_to", fromTypeKey: "Base", toTypeKey: "Line", cardinality: "N:N" });

    await waitFor(async () => {
      expect((await readViewCfg()).links, "结构边建了，view-config.linkTypes 没变 ⇒ 图谱骨架没长出这条边").toBe(before.links + 1);
    });
    expect(await screen.findByTestId("orel-link-seam_supplies_to")).toBeTruthy();
  });

  it("停用一条结构边 ⇒ 状态列翻成「已停用」，而推演口径**不受影响**（两种边的启停语义不同）", async () => {
    const posts: Hit[] = [];
    spyOn("post", "*/a/v1/ontology/links/:key/deprecate", posts);

    const user = userEvent.setup();
    await openPage();
    const before = await readViewCfg();

    expect((await screen.findByTestId("orel-link-status-order_for_model")).textContent).toBe("启用");
    await user.click(await screen.findByTestId("orel-link-deprecate-order_for_model"));

    await waitFor(() => expect(posts.length, "POST …/links/order_for_model/deprecate 没发出去").toBe(1));
    expect(posts[0]!.url).toContain("/a/v1/ontology/links/order_for_model/deprecate");
    await waitFor(async () =>
      expect((await screen.findByTestId("orel-link-status-order_for_model")).textContent).toBe("已停用"),
    );

    // ⚠ 这一条是**反向断言**，专治「把两种边的启停糊成一个 active 开关」：
    //   后端 `view-config` 的 linkTypes 取 `links.map(l => l.key)`，**不看 deprecation**
    //   （§4 事实锁钉住这一点）⇒ 停用结构边不会减少这个数。若哪天它变了，是后端改了口径，
    //   不是这里写错了 —— 那时 §4 会先红，指向真正改动的地方。
    const after = await readViewCfg();
    expect(after.links, "停用结构边把 view-config.linkTypes 减少了 ⇒ 与后端口径不一致").toBe(before.links);
    expect(after.propCount, "停用结构边动了因果边计数 ⇒ 两种边的语义被糊在一起了").toBe(before.propCount);
  });

  it("停用一个**对象类型** ⇒ 打的是 `types/*/deprecate` 那条路（不是 links，也不是 interfaces）", async () => {
    /**
     * 为什么要单独咬这条：`deprecateOntologyElement(kind)` 的第一版把路径段写成
     * `${kind === "link" ? "links" : "types"}` —— 归一化后是 `/a/v1/ontology/*​/*​/deprecate`，
     * 会**冒领** `interfaces/*​/…` 这类同形状但根本没接的端点，让接缝门把它们误判成「已修复」。
     * 现在改成两条各自的字面量路径；本条断言真发出去的 URL 里**有 `/types/`、没有 `/links/`**，
     * 把「路径段是字面量」这件事钉在链路上，而不是靠人记得别用三元拼段。
     */
    const posts: Hit[] = [];
    spyOn("post", "*/a/v1/ontology/types/:key/deprecate", posts);

    const user = userEvent.setup();
    await openPage();
    await user.selectOptions(await screen.findByTestId("orel-type-select"), "Order");
    await user.click(screen.getByTestId("orel-type-deprecate"));

    await waitFor(() => expect(posts.length, "POST …/types/Order/deprecate 没发出去").toBe(1));
    expect(posts[0]!.url).toContain("/a/v1/ontology/types/Order/deprecate");
    expect(posts[0]!.url, "打到了 links 那条路 ⇒ kind 分支接反了").not.toContain("/links/");
    expect((await screen.findByTestId("orel-type-status-Order")).textContent).toBe("已停用");
  });

  it("下线一条**仍被因果边引用**的结构边 ⇒ 后端 409 逐条列引用方，界面不假装成功", async () => {
    const user = userEvent.setup();
    await openPage();

    // `line_belongs_to_base` 被种子因果边 `seed_line_to_base` 经 viaLinkKey 引用着。
    await user.click(await screen.findByTestId("orel-link-refs-line_belongs_to_base"));
    const panel = await screen.findByTestId("orel-refs-panel");
    expect(within(panel).getByText(/引用方：1 处/)).toBeTruthy();
    expect(panel.textContent).toContain("seed_line_to_base");

    await user.click(await screen.findByTestId("orel-link-retire-line_belongs_to_base"));
    // 409 原文上屏（toast），状态**不许**翻成「已下线」
    await waitFor(() => expect(document.body.textContent).toContain("无法 RETIRE"));
    expect((await screen.findByTestId("orel-link-status-line_belongs_to_base")).textContent).not.toBe("已下线");
  });
});

describe("WO-BEFE-A ③ 发布会签（R4：本体真值变更经审批链，不给绕开会签的直发口）", () => {
  beforeEach(() => loginAs("planner"));
  afterEach(() => cleanup());

  it("发起会签 → 逐域 APPROVE → 全域通过后已发布版本号真的推进", async () => {
    const opens: Hit[] = [];
    const signs: Hit[] = [];
    spyOn("post", "*/a/v1/ontology/publish-requests", opens);
    spyOn("post", "*/a/v1/ontology/publish-requests/:id/signoff", signs);

    const user = userEvent.setup();
    await openPage();
    await waitFor(() => expect(screen.getByTestId("orel-publish-table")).toBeTruthy());

    await user.click(screen.getByTestId("orel-publish-open"));
    await waitFor(() => expect(opens.length, "POST /a/v1/ontology/publish-requests 没发出去").toBe(1));

    const table = await screen.findByTestId("orel-publish-table");
    const approve = await waitFor(() => {
      const btns = within(table).getAllByText("同意");
      expect(btns.length, "会签请求没上屏 ⇒ 后面点不到「同意」").toBeGreaterThan(0);
      return btns[0]! as HTMLButtonElement;
    });

    // 两个触及域 ⇒ 要签两次才 APPROVED（会签 = 逐域，不是一票通过）
    await user.click(approve);
    await waitFor(() => expect(signs.length).toBe(1));
    await user.click(within(await screen.findByTestId("orel-publish-table")).getAllByText("同意")[0]!);
    await waitFor(() => expect(signs.length).toBe(2));
    expect(signs[0]!.body).toMatchObject({ decision: "APPROVE" });

    await waitFor(() => expect(document.body.textContent).toContain("APPROVED"));
    // 全域通过 → 后端 `app.ts:2891` 自动 publishVersion ⇒ 已发布版本号真的推进（不是只把状态字改了）
    await waitFor(() => expect(screen.getByText(/已发布版本：v2/)).toBeTruthy());
  });

  it("页面**不提供** POST /a/v1/ontology/publish 直发口（那条路会绕开域 owner 会签，违 R4）", async () => {
    const direct: Hit[] = [];
    server.use(
      http.post("*/a/v1/ontology/publish", async ({ request }) => {
        direct.push({ url: request.url, body: null });
        return HttpResponse.json({ version: 99 });
      }),
    );
    const user = userEvent.setup();
    await openPage();
    await user.click(screen.getByTestId("orel-publish-open"));
    await waitFor(() => expect(screen.getByTestId("orel-publish-table")).toBeTruthy());

    // 页面源码里也不该出现这条 URL（"没有按钮" 与 "代码里没这条路" 是两个命题，两个都要）
    expect(direct, "页面直接打了 /a/v1/ontology/publish ⇒ 绕开会签").toEqual([]);
    const pageSrc = factHits(checkedTree("apps/frontend-shell/src", "OntologyRelationsPage", 100), '"/a/v1/ontology/publish"');
    expect(pageSrc, "前端生产代码里出现了 /a/v1/ontology/publish 直发调用 ⇒ R4 会签可被绕过").toEqual([]);
  });
});

describe("WO-BEFE-A ④ 事实锁：mock 的派生口径必须钉在**后端源码**上（不许 mock 自洽）", () => {
  /**
   * 为什么这一组不可省：①②③ 全部跑在 MSW 上。若 `view-config` 的 mock 自己编一套过滤规则，
   * 上面每一条断言都只证明了「mock 和 mock 一致」。后端哪天把 `listPropagationRules(tenantId, true)`
   * 改成 `false`，屏上的数会全错，而这里照样全绿 —— 那就是又一个「绿测试≠能用」。
   *
   * 金丝雀走 `checkedTree`（铁律 0.6）：扫描面塌了 / 已知必中的串零命中 / 注释被当成代码，
   * 三者任一发生时当场红的是「工具坏了」，**不是**「事实没了」。
   */
  const dc = () => checkedTree("apps/datacore/src", "listPropagationRules", 40);

  it("金丝雀：扫描器活着（已知必中命中 + 只在注释里的串不中）", () => {
    const tree = dc();
    expect(factHits(tree, "listPropagationRules").length, "已知必中的符号零命中 ⇒ 扫描器坏了").toBeGreaterThan(0);
    // 下面每条否定/肯定结论都建立在这一条之上（报「0 命中」必须同时给出金丝雀证据）。
  });

  it("`GET /a/v1/sim/view-config` 真的只读**已启用**的因果边（第二实参 = true）", () => {
    expect(
      factHits(dc(), /listPropagationRules\(\s*c\.tenantId\s*,\s*true\s*\)/),
      "view-config 侧的 `listPropagationRules(c.tenantId, true)` 找不到 ⇒ mock 的 propagationCount 口径失去依据",
    ).toContain("apps/datacore/src/app.ts");
  });

  it("`publishedOnly` 的过滤判据真的是 `status === \"PUBLISHED\"`（双仓储实现同口径）", () => {
    const tree = dc();
    const hits = factHits(tree, /publishedOnly\s*\|\|\s*r\.status\s*===\s*"PUBLISHED"/);
    expect(hits, "memory 仓储的过滤判据变了 ⇒ 「DRAFT=停用」这个语义失去依据").toContain("apps/datacore/src/repo/memory.ts");
    expect(
      factHits(tree, /publishedOnly\s*\?\s*all\.filter\(\(x\)\s*=>\s*x\.status\s*===\s*"PUBLISHED"\)/),
      "pg 仓储的过滤判据变了 ⇒ 两套仓储口径可能已漂移",
    ).toContain("apps/datacore/src/repo/pg.ts");
  });

  it("`stateVars` 真的取自已启用边的 source ∪ target（不是别的来源）", () => {
    expect(
      factHits(dc(), /stateVars\s*=\s*\[\.\.\.new Set\(rules\.flatMap\(\(r\)\s*=>\s*\[r\.sourceStateVar,\s*r\.targetStateVar\]\)\)\]/),
      "view-config 的 stateVars 派生式变了 ⇒ mock 的「+2 个变量」断言失去依据",
    ).toContain("apps/datacore/src/app.ts");
  });

  it("`linkTypes` 真的**不看** deprecation（故「停用结构边不减少这个数」是后端事实，不是我编的）", () => {
    expect(
      factHits(dc(), /linkTypes:\s*links\.map\(\(l\)\s*=>\s*l\.key\)\.sort\(\)/),
      "view-config 的 linkTypes 派生式变了 ⇒ ②中「停用结构边 links 不变」的反向断言失去依据",
    ).toContain("apps/datacore/src/app.ts");
  });

  it("诚实位有据：`POST …/propagation-rules` 的 id 确实恒被覆盖（⇒ 只能新建、改不了）", () => {
    // 页面上写着「因果边只能新建改不了」。这句话必须有源码证据，否则就是拿注释当结论。
    expect(
      factHits(dc(), /PropagationRuleSchema\.parse\(\{\s*\.\.\.\(req\.body as object\),\s*id:\s*newId\("simpr"\)/),
      "id 覆盖已不复存在 ⇒ 后端可能已补更新路径，页面上那条诚实位该撤了",
    ).toContain("apps/datacore/src/app.ts");
  });

  it("mock 的两份结构边种子逐 key 一致（`mapping/registries` 字面量 vs `MOCK_LINK_SEED` store）", async () => {
    /**
     * 为什么必须机器盯：`mapping/registries` 里那三条**只能是字面量** ——
     * `apps/datacore/test/mock-linktype-direction.gate.test.ts:40` 按源码文本抽它。
     * 于是 mock 侧不得不留两份（store 一份、字面量一份）。两份就会漂，
     * 漂了之后「建了一条边 → 列表里没有」这种病要靠人肉发现。
     * 这条断言在**运行时**跨两个端点对账，不读源码、不靠人记得同步。
     */
    const [reg, vers] = await Promise.all([
      fetch("http://localhost/a/v1/ontology/mapping/registries").then((r) => r.json() as Promise<{ linkTypes: { key: string }[] }>),
      fetch("http://localhost/a/v1/ontology/versions").then((r) => r.json() as Promise<{ snapshot: { linkTypes: { key: string }[] } }[]>),
    ]);
    const fromRegistries = reg.linkTypes.map((l) => l.key).sort();
    const fromStore = vers[0]!.snapshot.linkTypes.map((l) => l.key).sort();
    expect(fromRegistries.length, "registries 返回 0 条 ⇒ 对账无从谈起（工具坏了，不是一致）").toBeGreaterThan(0);
    expect(fromStore, "两份种子漂了 ⇒ 页面列表与 view-config 会各说各话").toEqual(fromRegistries);
  });

  it("页面真的挂在真 route 上（不是「组件写了、没有路径渲染得到」）", () => {
    const fe = checkedTree("apps/frontend-shell/src", "ADMIN_PAGES", 100);
    expect(factHits(fe, 'admin("ontology-relations"'), "App.tsx 没有这条 route ⇒ 页面不可达").toContain(
      "apps/frontend-shell/src/App.tsx",
    );
    expect(factHits(fe, '{ path: "ontology-relations"'), "adminRegistry 没登记 ⇒ AdminGuard 恒 404").toContain(
      "apps/frontend-shell/src/pages/adminRegistry.ts",
    );
    // 归组：只改 adminRegistry 会让它掉进 ShellLayout 的「其它」兜底桶（plan-builder 就是这么漏的）
    expect(
      factHits(fe, '"ontology-relations"').filter((f) => f.endsWith("ShellLayout.tsx")),
      "ShellLayout.NAV_GROUPS 没登记 ⇒ 真实左导航里落「其它」兜底组，用户找不到",
    ).not.toEqual([]);
  });
});
