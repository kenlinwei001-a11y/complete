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

/**
 * 旁观请求 —— 走 MSW 的**事件**，**不注册 handler**。
 *
 * ⚠ 原写法是 `server.use(http[method](pattern, …))` 记一笔然后 `return undefined`，
 * 注释写着「落回原 handler（有状态 store 照常推进）」——**实测并不会回落**：
 * 那个同路径 handler 把请求**吃掉**了，`mockPropRules` 这个有状态 store 整条被旁路
 * （金丝雀：在 mock 的 PATCH handler 里打日志，spy 一挂就再也不打 ⇒ 它根本没跑）。
 * 后果是「PATCH 记到了、store 一个字没改 ⇒ view-config 恒不变」，
 * 于是「停用后生效条数没降」这类断言**永远不可能绿** —— 而病根不在产品，在这个 spy。
 *
 * 形态（照 CLAUDE.md 铁律 0.6 句式）：
 * **「我用『请求发出去了』当作『后端处理了』的证据，而前者并不度量后者。」**
 *
 * `request:start` 是纯旁观：既记得到真实 URL / body，又完全不影响 handler 链。
 */
function spyOn(method: "get" | "post" | "patch" | "delete", pattern: string, sink: Hit[]) {
  // 把 MSW 的路径写法翻成正则：`*` 跨段通配，`:param` 只吃**一段**（与 MSW 语义一致），
  // 末尾允许 query 串。⚠ 少翻 `:param` 这一支会让带路径参数的模式（`links/:key/deprecate`）
  // 永远匹配不上 ⇒ 判据读到"这一跳没发出去"，而它其实发了 —— 又一次"尺子错了当结论"。
  const re = new RegExp(
    `^${pattern
      .split("*")
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:[A-Za-z_]\w*/g, "[^/]+"))
      .join(".*")}(\\?.*)?$`,
  );
  server.events.on("request:start", ({ request }) => {
    if (request.method.toLowerCase() !== method) return;
    if (!re.test(request.url)) return;
    // ⚠ **同步**入列：条数是很多判据的主语（"这一跳发出去了没有"），
    // 若等 body 解析完再 push，`expect(sink.length).toBe(1)` 会在请求已经发出的情况下读到 0。
    // 故先把这一笔记上，body 随后回填（读 body 的判据都排在 `waitFor(条数)` 之后）。
    const hit: Hit = { url: request.url, body: null };
    sink.push(hit);
    // `delete` 没有 body；`patch`/`post` 有（WO-CAUSAL-EDGE-CRUD 之后本文件要咬 body 形状）。
    if (method === "post" || method === "patch") {
      void request.clone().json().then((b) => { hit.body = b; }).catch(() => { hit.body = null; });
    }
  });
}

// `server.use` 的 handler 由 setup.ts 的 `server.resetHandlers()` 清；**事件监听器不在其列**，
// 必须自己摘，否则上一条用例的监听器会一直往它那个已经没人看的 sink 里推。
afterEach(() => server.events.removeAllListeners());

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
    // WO-ONTOLOGY-EDGE-EDIT：启停位由**文本**改成了**勾选框**（那一列现在可写，不只是可读），
    // 故判据从 `textContent === "启用"` 改成勾选框的 `checked`。
    // ⚠ 两个都断：`data-status` 咬「后端真值是什么」，`checked` 咬「屏上画成什么」——
    //   只断后者的话，一个恒 `checked` 的实现照样绿。
    expect((await screen.findByTestId("orel-rule-status-seam_on")).getAttribute("data-status")).toBe("PUBLISHED");
    expect((await screen.findByTestId<HTMLInputElement>("orel-rule-toggle-seam_on")).checked).toBe(true);
  });

  it("建一条【停用】的因果边 ⇒ 在册可见，但 propagationCount / stateVars 一个字都不变", async () => {
    const user = userEvent.setup();
    await openPage();
    const before = await readViewCfg();

    await createCausalEdge(user, { key: "seam_off", srcVar: "ghostVarA", tgtVar: "ghostVarB", status: "DRAFT" });

    // 在册：列表里有，状态是「停用」（同上：启停位现在是勾选框，判据落在 data-status + checked）
    expect(await screen.findByTestId("orel-rule-seam_off")).toBeTruthy();
    expect((await screen.findByTestId("orel-rule-status-seam_off")).getAttribute("data-status")).toBe("DRAFT");
    expect((await screen.findByTestId<HTMLInputElement>("orel-rule-toggle-seam_off")).checked).toBe(false);

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

/**
 * WO-CAUSAL-EDGE-CRUD · **因果边「改 / 停 / 删」的接缝门**
 *
 * ── 这一组要证的那句话 ────────────────────────────────────────────────────
 *   **「行内那三个控件真的改到了那一条边，而不是又追加一条；且改完之后推演口径跟着变。」**
 *
 * 修前实测（真后端 4561 · SEED_DEMO=1）：同 key POST 两次得**两行**（系数 0.5 与 0.9 并存、
 * 都 PUBLISHED），而 `propagateTick` 逐规则累加 ⇒ 两条都算 —— 「把系数改成 0.9」的真实
 * 效果是 `0.5+0.9=1.4`；且当时 PUT/PATCH/DELETE 一个都没注册，多出来那条**删不掉**。
 *
 * ⚠ 三条断言都落在 **`propagationCount`** 上而不是「行数好看不好看」：
 *   行数只证明列表渲染，`propagationCount` 才是**推演真的吃进去几条**。
 *   只咬行数的话，一个「列表去重但引擎仍吃两条」的实现照样全绿 —— 那正是修前的样子。
 */
describe("WO-CAUSAL-EDGE-CRUD ①' 因果边改/停/删（接缝：PATCH·DELETE /a/v1/sim/propagation-rules/:id × GET /sim/view-config）", () => {
  beforeEach(() => loginAs("planner"));
  afterEach(() => cleanup());

  it("同 key 再建一次 ⇒ 仍是 1 行、propagationCount 不涨（修前会变 2 行且两条都算）", async () => {
    const user = userEvent.setup();
    await openPage();
    const before = await readViewCfg();

    await createCausalEdge(user, { key: "dup_key", srcVar: "dupSrc", tgtVar: "dupTgt", status: "PUBLISHED" });
    await waitFor(async () => expect((await readViewCfg()).propCount).toBe(before.propCount + 1));

    // 同一个 key 再存一次（屏上就是用户「改一下再保存」的动作）
    await createCausalEdge(user, { key: "dup_key", srcVar: "dupSrc", tgtVar: "dupTgt", status: "PUBLISHED" });

    // ── 载体①：列表里**只有一行** dup_key
    await waitFor(() => {
      expect(
        screen.getAllByTestId("orel-rule-dup_key").length,
        "同 key 写两次得到两行 ⇒ 又退回追加语义（本单修的正是这个）",
      ).toBe(1);
    });
    // ── 载体②：**推演真的只吃一条** —— 这条才是接缝
    const after = await readViewCfg();
    expect(
      after.propCount,
      "同 key 写两次让生效条数涨了 2 ⇒ 两条边都进了推演，读数会静默偏离（修前实测就是这样）",
    ).toBe(before.propCount + 1);
  });

  it("停用可逆：点『停用』propagationCount −1，再点『启用』原样回来（结构边那个单向闸不许复制）", async () => {
    const patches: Hit[] = [];
    spyOn("patch", "*/a/v1/sim/propagation-rules/*", patches);

    const user = userEvent.setup();
    await openPage();
    const before = await readViewCfg();

    await createCausalEdge(user, { key: "tog_key", srcVar: "togSrc", tgtVar: "togTgt", status: "PUBLISHED" });
    await waitFor(async () => expect((await readViewCfg()).propCount).toBe(before.propCount + 1));
    const on = await readViewCfg();

    // ① 停用 —— 先过**波及面闸**。
    // 「关掉是减少能力：先给波及面再落；开回来只是恢复，直接落」（`OntologyRelationsPage` 原话）
    // ⇒ 勾掉勾选框只是**开闸**，PATCH 要等 `orel-impact-confirm` 才发。
    // 判据没放宽：仍然是「点一下停用 ⇒ 恰好一发 PATCH 且 body 是 status:DRAFT」，
    // 只是把「点一下」按今天真实的动线走完（少走这一步就会把有闸误判成没接线）。
    await user.click(await screen.findByTestId("orel-rule-toggle-tog_key"));
    expect(patches.length, "闸还没确认就把 PATCH 发出去了 ⇒ 波及面闸是装饰品").toBe(0);
    await user.click(await screen.findByTestId("orel-impact-confirm"));
    await waitFor(() => expect(patches.length, "PATCH 一次都没发出去 ⇒ 停用按钮没接线").toBe(1));
    expect(patches[0]!.body, "停用发的不是 status:DRAFT").toMatchObject({ status: "DRAFT" });
    await waitFor(async () => {
      expect((await readViewCfg()).propCount, "停用后生效条数没降 ⇒ 停用是装饰品").toBe(on.propCount - 1);
    });
    // 启停位是**勾选框**（那一格自己没有文字）⇒ 判据落在 `data-status` + `checked`，
    // 与同文件「建一条【停用】的因果边」那条用的是同一套判据（此处原先还停在读 textContent 的年代）。
    await waitFor(async () =>
      expect((await screen.findByTestId("orel-rule-status-tog_key")).getAttribute("data-status")).toBe("DRAFT"),
    );
    expect((await screen.findByTestId<HTMLInputElement>("orel-rule-toggle-tog_key")).checked).toBe(false);

    // ② 再启用 —— **这一半是本仓已知坑的反面**：结构边的停用/下线点了回不来。
    await user.click(await screen.findByTestId("orel-rule-toggle-tog_key"));
    await waitFor(() => expect(patches.length).toBe(2));
    expect(patches[1]!.body, "再启用发的不是 status:PUBLISHED").toMatchObject({ status: "PUBLISHED" });
    await waitFor(async () => {
      expect(
        (await readViewCfg()).propCount,
        "再启用之后生效条数没回到停用前 ⇒ 启停不可逆，复制了结构边那个坑",
      ).toBe(on.propCount);
    });
    await waitFor(async () =>
      expect((await screen.findByTestId("orel-rule-status-tog_key")).getAttribute("data-status")).toBe("PUBLISHED"),
    );
    expect((await screen.findByTestId<HTMLInputElement>("orel-rule-toggle-tog_key")).checked).toBe(true);
  });

  it("改系数：行内改那一格 ⇒ PATCH 只递 coefficient（身份格一个都不递）", async () => {
    const patches: Hit[] = [];
    spyOn("patch", "*/a/v1/sim/propagation-rules/*", patches);

    const user = userEvent.setup();
    await openPage();
    await createCausalEdge(user, { key: "coef_key", srcVar: "coefSrc", tgtVar: "coefTgt", status: "PUBLISHED" });

    const cell = await screen.findByTestId("orel-rule-coef-coef_key");
    await user.clear(cell);
    await user.type(cell, "0.42");
    await user.tab(); // 落点是 onBlur，不是 onChange —— 每敲一个字符发一次会把 0.42 拆成四次真写入

    await waitFor(() => expect(patches.length, "改系数没发出 PATCH ⇒ 这一格还是死文本").toBe(1));
    expect(patches[0]!.body).toEqual({ coefficient: 0.42 });
    // 身份格不许出现在 body 里（后端 strictObject 会 400，前端不该先递过去）
    for (const k of ["key", "sourceTypeKey", "sourceStateVar", "viaLinkKey", "targetTypeKey", "targetStateVar"]) {
      expect(
        Object.keys(patches[0]!.body as object),
        `PATCH body 里出现了身份格 ${k} ⇒ 允许原地掉包一条边，历史 trace 会指向语义已变的边`,
      ).not.toContain(k);
    }
  });

  it("删：启用中拒删（409 原文上屏），先停用再删才真的消失", async () => {
    const dels: Hit[] = [];
    spyOn("delete", "*/a/v1/sim/propagation-rules/*", dels);

    const user = userEvent.setup();
    await openPage();
    const before = await readViewCfg();
    await createCausalEdge(user, { key: "del_key", srcVar: "delSrc", tgtVar: "delTgt", status: "PUBLISHED" });
    await waitFor(async () => expect((await readViewCfg()).propCount).toBe(before.propCount + 1));

    // ① 还启用着就删 ⇒ 后端 409，行**仍在**（不许前端自己先拦，理由见页面注释）
    // 删与停用一样先过**波及面闸**（`askImpact(r0, "delete")`）：点 ✕ 只开闸，
    // DELETE 要等 `orel-impact-confirm` 才发。这一步不走完会把有闸误判成「删除按钮没接线」。
    await user.click(await screen.findByTestId("orel-rule-delete-del_key"));
    expect(dels.length, "闸还没确认就把 DELETE 发出去了 ⇒ 波及面闸是装饰品").toBe(0);
    await user.click(await screen.findByTestId("orel-impact-confirm"));
    await waitFor(() => expect(dels.length, "DELETE 没发出去 ⇒ 删除按钮没接线").toBe(1));
    expect(
      await screen.findByTestId("orel-rule-del_key"),
      "启用中的边被删掉了 ⇒ 在跑会话的读数会静默改变，那道闸没起作用",
    ).toBeTruthy();
    expect((await readViewCfg()).propCount).toBe(before.propCount + 1);

    // ② 先停用，再删 ⇒ 真的消失，且生效条数回到建之前（两步各自过一次波及面闸）
    await user.click(await screen.findByTestId("orel-rule-toggle-del_key"));
    await user.click(await screen.findByTestId("orel-impact-confirm"));
    await waitFor(async () => expect((await readViewCfg()).propCount).toBe(before.propCount));
    await user.click(await screen.findByTestId("orel-rule-delete-del_key"));
    await user.click(await screen.findByTestId("orel-impact-confirm"));
    await waitFor(() => expect(dels.length).toBe(2));
    await waitFor(() => expect(screen.queryByTestId("orel-rule-del_key"), "停用后删了，行还在 ⇒ 没真删掉").toBeNull());
    expect((await readViewCfg()).propCount).toBe(before.propCount);
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
     * `${kind === "link" ? "links" : "types"}` —— 归一化后是 `/a/v1/ontology/<*>/<*>/deprecate`，
     * 会**冒领** `interfaces/<*>/…` 这类同形状但根本没接的端点，让接缝门把它们误判成「已修复」。
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

  it("`POST …/propagation-rules` 仍为**新边** mint 草稿 id（改/删/启停三个更新口同时在册）", () => {
    // ⚠ 收编批次4 订正**用例名与本注释，断言一个字符没动**：本行原名断言「id 恒被覆盖 ⇒ POST 只能新建」。
    //   合并 WO-CAUSAL-EDGE-CRUD 后 POST 已改成**按 key upsert**（`app.ts` 紧邻的下一行把 id 换回
    //   `existing?.id ?? draft.id`）⇒ 「恒被覆盖」不再成立，`newId("simpr")` 只剩「没有既有边时的草稿 id」这一个作用。
    //   下面那条 `it()`（同为本批并入）钉的正是 upsert 那一行，两条各钉一半、都为真。
    //   形态（铁律 0.6）：**「我用『那行文本还在』当作『那个行为还在』的证据，而前者并不度量后者。」**
    const tree = dc();
    /**
     * ⚠ 这条探针**曾经把校验器的写法一起钉死**，于是长期红在一次与本事实无关的重构上：
     *   原文是 `/PropagationRuleSchema\.parse\(\{ …/`，而 `dfa7cc28`
     *   （WO-DC-ERRORENVELOPE-11，2026-08-22）把 4 处 `req.body` 派生的裸 `parse` 统一换成
     *   `parseBody(Schema, …)` —— 换的理由是错误信封（裸 `parse` 抛的 ZodError 没有
     *   `statusCode` ⇒ 兜底判 500 并回显 zod 内部结构），**与 id 覆不覆盖毫无关系**。
     *   行为一天没变过：`app.ts` 那一行至今是 `{ ...(req.body as object), id: newId("simpr"), … }`。
     * 形态（铁律 0.6 句式）：**「我用『校验器叫什么名字』当作『id 恒被覆盖』的证据，而前者并不度量后者。」**
     * 故探针改成只钉**事实本身**：客户端 body 被摊开后，`id` 被服务端新 id 盖掉 ——
     * 换哪个校验器包都不该红，把这行覆盖删掉才该红。
     */
    expect(
      factHits(tree, /\{\s*\.\.\.\(req\.body as object\),\s*id:\s*newId\("simpr"\)/),
      "id 覆盖已不复存在 ⇒ 客户端传的 id 可能被采信，页面上那条诚实位该撤了",
    ).toContain("apps/datacore/src/app.ts");

    expect(
      factHits(tree, 'app.post("/a/v1/sim/propagation-rules"'),
      "正向对照落空 ⇒ 路由写法变了，本条结论作废",
    ).toContain("apps/datacore/src/app.ts");
  });

  /**
   * ══ WO-ONTOLOGY-EDGE-EDIT · 这条断言**是反过来的那一半**（原文已作废，照实反转）══
   *
   * 原文断言的是 `factHits(tree, /app\.(put|patch)\(\s*"\/a\/v1\/sim\/propagation-rules"/)`
   * **等于空数组**，注释写着「后端补了更新口 ⇒『只能新建、改不了』这句诚实位已成谎话，该撤」。
   * 后端现在补上了，诚实位也撤了 —— 故该断言按它自己写好的剧本反转。
   *
   * ⚠ **顺带修掉那条探针自己的一个洞**（不修就是留一个永远不会红的哨兵）：
   *   原正则要求 `propagation-rules` 后面紧跟**闭合引号**，而更新口的路径是
   *   `"/a/v1/sim/propagation-rules/:id"` —— 后面跟的是 `/`。实测（本单开工时亲手跑过）：
   *   `/app\.(put|patch)\(\s*"\/a\/v1\/sim\/propagation-rules"/.test('app.put("/a/v1/sim/propagation-rules/:id", …)')`
   *   → **false**。即：后端就算补了更新口，那条 `toEqual([])` **照样绿**。
   * 形态（铁律 0.6 句式）：**「我用『集合路径上没有 put/patch』当作『没有更新口』的证据，
   *   而前者并不度量后者 —— 更新口天生挂在 `/:id` 上，不在集合路径上。」**
   *   故新探针一律匹配到 `propagation-rules/` 那个斜杠为止，item 路径才咬得住。
   */
  it("后端**已有**改/删/启停三个更新口（诚实位「只能新建」因此撤得有据）", () => {
    const tree = dc();
    // 正向对照：金丝雀已在本 describe 顶部跑过；这里再加一条同族的必中串，
    // 命不中就是路径写法变了 ⇒ 报「探针失准」，不许报「后端把更新口删了」。
    expect(
      factHits(tree, 'app.post("/a/v1/sim/propagation-rules"'),
      "正向对照落空 ⇒ 这条路径的写法变了，下面三条结论作废",
    ).toContain("apps/datacore/src/app.ts");

    expect(
      factHits(tree, /app\.put\(\s*"\/a\/v1\/sim\/propagation-rules\/:id"/),
      "改口没了 ⇒ 页面上那张可编辑的表会 404，诚实位该改回「只能新建」",
    ).toContain("apps/datacore/src/app.ts");
    expect(
      factHits(tree, /app\.delete\(\s*"\/a\/v1\/sim\/propagation-rules\/:id"/),
      "删口没了 ⇒ 表里那个 ✕ 会 404",
    ).toContain("apps/datacore/src/app.ts");
    expect(
      factHits(tree, /app\.patch\(\s*"\/a\/v1\/sim\/propagation-rules\/:id\/status"/),
      "启停口没了 ⇒ 表里那个勾选框会 404",
    ).toContain("apps/datacore/src/app.ts");

    /**
     * **租户闸必须落在「写之前的一次读」上**，这条不是洁癖：`putPropagationRule` 按 id 幂等覆盖、
     * 不看 tenantId（memory 侧 `this.rules.set(r.id, …)`；pg 侧 `ON CONFLICT (id) DO UPDATE`），
     * 而 `:id` 是客户端给的 ⇒ 少了这次读，A 租户就能覆盖 B 租户的边。
     * 删掉那两行 `getPropagationRule(...)` 时**没有任何类型错误**，只有这条会红。
     */
    expect(
      factHits(tree, /getPropagationRule\(c\.tenantId,\s*id\)/),
      "改/启停口不再先按 tenantId 读一次 ⇒ 跨租户可覆盖（R2 破了，且类型系统看不见）",
    ).toContain("apps/datacore/src/app.ts");
    expect(
      factHits(tree, /deletePropagationRule\(c\.tenantId,/),
      "删口不再带 tenantId ⇒ 跨租户可删",
    ).toContain("apps/datacore/src/app.ts");
  });

  /**
   * ⚠ **本组断言 2026-09-03 整体反转（WO-CAUSAL-EDGE-CRUD）**，原用例名是
   * 「诚实位有据：`POST …/propagation-rules` 的 id 确实恒被覆盖（⇒ 只能新建、改不了）」。
   * 它当年钉的是一个**真缺陷**：同 key POST 两次得两行、两条都进推演（2026-09-03 真后端
   * 复现过：系数 0.5 与 0.9 并存且都 PUBLISHED）。缺陷已修，故这组从「钉住缺陷还在」
   * 翻成「钉住修复还在」—— 事实锁的作用没变，钉的事实换了。
   *
   * ⚠ 顺手修掉原文里一个**假绿**：原否定断言的正则是
   *   `/app\.(put|patch)\(\s*"\/a\/v1\/sim\/propagation-rules"/`
   * ——**末尾没有 `/:id`**，而更新口真实的注册路径是 `"/a/v1/sim/propagation-rules/:id"`。
   * 于是后端就算补上了 `app.patch(".../:id")`，这条断言**照样绿**，
   * 它宣称在守的那件事其实一次都守不住。形态（铁律 0.6 句式）：
   * **「我用『带 `:id` 的路径匹配不上不带 `:id` 的正则』当作『更新口不存在』的证据。」**
   */
  it("修复有据：`POST …/propagation-rules` 已是按 key upsert，且 PATCH/DELETE 更新口真的注册了", () => {
    const tree = dc();
    /**
     * ① **正向对照先跑**：路由写法没变。命不中 ⇒ 报「探针失准」，不许报「后端没这条路由」
     *    （报否定/肯定结论前先自证工具，铁律 0.6）。
     */
    expect(
      factHits(tree, 'app.post("/a/v1/sim/propagation-rules"'),
      "正向对照落空 ⇒ 这条路由的写法变了，本组结论一律作废（是探针失准，不是后端没接）",
    ).toContain("apps/datacore/src/app.ts");

    /**
     * ② **upsert 的事实本身**：按 `key` 找既有 → 复用既有 `id` → `version` 递增。
     *    这三件缺一件，同 key 写两次就会重新变回两行、两条都被 `combine:"sum"` 算进去。
     *    ⚠ 钉的是**行为**不是校验器名字 —— 原探针曾把 `PropagationRuleSchema.parse` 钉死，
     *    结果被一次与本事实无关的 `parseBody` 重构打红（形态：「我用『校验器叫什么名字』
     *    当作『id 恒被覆盖』的证据，而前者并不度量后者」）。这里只钉 id 与 version 的取值式。
     */
    expect(
      factHits(tree, /id:\s*existing\?\.id\s*\?\?\s*draft\.id,\s*version:\s*\(existing\?\.version\s*\?\?\s*0\)\s*\+\s*1/),
      "upsert 的取值式没了 ⇒ 同 key 可能又变回两行、两条都进推演（本单修的正是这个）",
    ).toContain("apps/datacore/src/app.ts");

    /**
     * ③ **两个更新口真的注册了**。正则末尾**必须带 `/:id`** —— 这正是原断言漏掉、
     *    导致它守不住任何东西的那一段。
     */
    expect(
      factHits(tree, /app\.patch\(\s*"\/a\/v1\/sim\/propagation-rules\/:id"/),
      "PATCH 更新口没了 ⇒ 改系数/启停在屏上又会变成做不到的事",
    ).toContain("apps/datacore/src/app.ts");
    expect(
      factHits(tree, /app\.delete\(\s*"\/a\/v1\/sim\/propagation-rules\/:id"/),
      "DELETE 口没了 ⇒ 多出来的边又删不掉了",
    ).toContain("apps/datacore/src/app.ts");

    /**
     * ④ **「删之前必须先停用」这道闸还在**。它是屏上那段说明文字的唯一依据：
     *    闸没了而说明还挂着，就是拿注释当结论。
     */
    expect(
      factHits(tree, /if \(cur\.status === "PUBLISHED"\) \{/),
      "「启用中拒删」这道闸没了 ⇒ 删一条启用中的边会让在跑会话读数静默改变，屏上那段说明随之作废",
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
