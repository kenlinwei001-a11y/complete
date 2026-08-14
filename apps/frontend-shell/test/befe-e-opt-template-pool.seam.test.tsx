import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { fetchOptTemplates } from "@/api/endpoints";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-BEFE-E ④ · **优化模板池 `/a/v1/opt/*` 三条端点的接缝门**
 * （门 `befe-seam:check` 载体②；断点 `G-BE-FE-SEAM-DEAD`）：
 *
 *     `GET  /a/v1/opt/templates`  datacore `app.ts:3682`
 *     `GET  /a/v1/opt/retrieve`   datacore `app.ts:3689`
 *     `POST /a/v1/opt/solve`      datacore `app.ts:3664`
 *
 * ── 分诊结论（追到了路由处理函数，不是按端点名猜）───────────────────────────────
 * · `POST /a/v1/opt/whatif` **不在**本门射程：优化推演页早已经
 *   `invokeSolver("optimize_whatif", …)` 打通同一条链（`OptimizeWhatifView.tsx:193`），
 *   且两条路由被**同一个 feature** `opt.whatif` 门着（`features.ts:100` 同时绑
 *   `apiTags:["opt-whatif"]` 与 `solverKeys:["optimize_whatif"]`）⇒ 能力可达，属「已有等价前端入口」。
 * · 另三条是真缺口，且各有具体症状：
 *   ① `templates`：页面手抄了一份 5 个 family 的字面量清单（`OptimizeWhatifView.tsx:19`，
 *      注释还写着「= app.ts OPT_FAMILIES」）⇒ **同一概念两套词表**，后端加/减一个 family
 *      界面不会知道，两边都能跑、谁也不报错。
 *   ② `retrieve`：「我要解什么」→ 找模板，这个问法在界面上根本没有入口。
 *   ③ `solve`：页面**必须先加一条扰动才肯求解**（「推演」按钮 `disabled={perturbs.length===0}`）⇒
 *      「就现在，最优怎么排」这个最朴素的问法问不出来。
 *
 * ── R4 ────────────────────────────────────────────────────────────────────────
 * 三条都不写业务真值（`opt/solve` 走 `ontology.invokeSolver` 纯返回结果），故不经 Action 审批链。
 *
 * ── 暗发（R3）────────────────────────────────────────────────────────────────
 * 三条都过 `apiTags:"opt"` → feature `opt.solver-pool`（**defaultOn:false**）。
 * 关着时后端回 404 `FEATURE_NOT_FOUND`，那是「本租户没开通」不是「后端坏了」——
 * 第 ④-D 组专咬这一支：回退清单必须**明说自己是回退**，不许冒充权威。
 */

const readRepoFile = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("WO-BEFE-E ④ 优化模板池（GET opt/templates · GET opt/retrieve · POST opt/solve）", () => {
  beforeEach(() => {
    loginAs("planner");
  });
  afterEach(() => cleanup());

  it("④-A 清单权威在后端：family 按钮逐个来自 `GET /a/v1/opt/templates`，不是页面自带那份", async () => {
    renderApp("/v/optimize-whatif");
    await screen.findByTestId("optimize-whatif");

    const truth = await fetchOptTemplates();
    // 金丝雀：后端清单非空，否则下面「逐条相等」是空胜。
    expect(truth.families.length, "后端模板族清单为空 ⇒ 这条用例证明不了任何事").toBeGreaterThan(0);

    await waitFor(() =>
      expect(screen.getByTestId("ow-family-source").getAttribute("data-authoritative"), "清单没标成权威 ⇒ 还在用页面自带那份").toBe("1"),
    );
    for (const key of truth.families) expect(screen.getByTestId(`ow-family-${key}`)).toBeInTheDocument();
    expect(within(screen.getByTestId("ow-family-list")).getAllByRole("button").length).toBe(truth.families.length);
  });

  it("④-B 后端多一个 family，界面当场多一个按钮（这就是「两套词表」被消掉的证据）", async () => {
    // 刻意给一个页面**根本不认识**的 key：旧实现（手抄清单）绝无可能显示它。
    server.use(
      http.get("*/a/v1/opt/templates", () =>
        HttpResponse.json({ families: ["facility_location", "probe_new_family"] }),
      ),
    );
    renderApp("/v/optimize-whatif");
    await screen.findByTestId("optimize-whatif");

    const btn = await screen.findByTestId("ow-family-probe_new_family");
    // 无中文文案就用 key 兜底并标注 —— **不许静默隐藏**（隐藏 = 把新模板藏起来，正是本单要治的病）。
    expect(btn.textContent).toBe("probe_new_family");
    expect(btn.getAttribute("title")).toContain("本页暂无中文示例");
    // 且后端没给的那几个不再出现（页面自带清单不再越权补齐）。
    expect(screen.queryByTestId("ow-family-set_cover"), "后端没给的 family 还在屏上 ⇒ 页面仍在用自带清单").toBeNull();
  });

  it("④-C 检索：输一句需求 → 真 GET /a/v1/opt/retrieve，档位（embedding/comprehend）原样显示", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    server.use(
      http.get("*/a/v1/opt/retrieve", ({ request }) => {
        calls.push(request.url);
        return HttpResponse.json({
          mode: "comprehend",
          embeddingEnabled: false,
          candidates: [{ key: "set_cover" }],
          note: "opt.embedding-retrieval 未开 → 退回 comprehend 关键词列表（不静默）",
        });
      }),
    );
    renderApp("/v/optimize-whatif");
    await screen.findByTestId("optimize-whatif");

    await user.type(screen.getByTestId("ow-need-input"), "最少布点覆盖全域");
    await user.click(screen.getByTestId("ow-need-search"));

    await waitFor(() => expect(calls.length, "点了「找模板」一个请求都没发 ⇒ 入口仍是死的").toBe(1));
    // ★ 真 URL + 真 query（`need` 就是输入框里那句）。
    const url = new URL(calls[0]!);
    expect(url.pathname).toContain("/a/v1/opt/retrieve");
    expect(url.searchParams.get("need")).toBe("最少布点覆盖全域");
    // ★ 档位必须原样显示：用户有权知道这次是向量检索还是关键词回退（后端明写"不静默"）。
    const result = await screen.findByTestId("ow-retrieve-result");
    expect(result.getAttribute("data-mode")).toBe("comprehend");
    expect(screen.getByTestId("ow-retrieve-mode").textContent).toContain("关键词回退");
    expect(screen.getByTestId("ow-retrieve-note").textContent).toContain("不静默");
    // ★ 点候选真的切到那个 family（检索与选型接上了，不是两张互不相干的表）。
    await user.click(screen.getByTestId("ow-retrieve-pick-set_cover"));
    await waitFor(() => expect(screen.getByTestId("ow-family-set_cover").className).toContain("primary"));
  });

  it("④-D 基线求解：不加任何扰动也能问「现在最优怎么排」→ POST /a/v1/opt/solve，屏上目标值来自响应", async () => {
    const user = userEvent.setup();
    const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
    renderApp("/v/optimize-whatif");
    await screen.findByTestId("optimize-whatif");

    server.use(
      http.post("*/a/v1/opt/solve", async ({ request }) => {
        calls.push({ url: request.url, method: request.method, body: (await request.json()) as Record<string, unknown> });
        // 刻意一个**不可能是默认值**的目标值：屏上若不是它，说明这个数不是来自响应。
        return HttpResponse.json({ openFacilities: ["f2"], assignments: [], objective: 424242, optimal: true, status: "OPTIMAL" });
      }),
    );

    await user.click(screen.getByTestId("ow-solve-baseline"));
    await waitFor(() => expect(calls.length, "点了「只求基线最优」一个请求都没发 ⇒ 入口仍是死的").toBe(1));
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url, `打错端点：${calls[0]!.url}`).toContain("/a/v1/opt/solve");
    // ★ body 的 family 是当前选中那个，args 是屏上那份局面（不是空对象）。
    expect(calls[0]!.body.family).toBe("facility_location");
    expect(Array.isArray((calls[0]!.body.args as Record<string, unknown>).facilities)).toBe(true);

    expect((await screen.findByTestId("ow-baseline-objective")).textContent).toBe("424242");
    expect(screen.getByTestId("ow-baseline-optimal").textContent).toContain("可证最优");
  });

  it("④-E 暗发关着不许冒充权威：templates 回 404 FEATURE_NOT_FOUND → 明说这是回退清单", async () => {
    server.use(
      http.get("*/a/v1/opt/templates", () =>
        HttpResponse.json({ error: { code: "FEATURE_NOT_FOUND", message: "opt.solver-pool 未开通", requestId: "req_o" } }, { status: 404 }),
      ),
    );
    renderApp("/v/optimize-whatif");
    await screen.findByTestId("optimize-whatif");

    await waitFor(() => expect(screen.getByTestId("ow-family-source").getAttribute("data-authoritative")).toBe("0"));
    const note = screen.getByTestId("ow-family-source");
    // 「没开通」与「后端坏了」是两回事，且**必须**说明下面这份可能与后端不一致。
    expect(note.textContent).toContain("未开通");
    expect(note.textContent).toContain("回退");
    // 回退态页面仍可用（不塌成白屏）——内置那 5 个按钮还在。
    expect(screen.getByTestId("ow-family-facility_location")).toBeInTheDocument();
  });

  it("④-F 不是死组件：三条 URL 真在 endpoints.ts 里，且页面不再自带 family 清单当权威", () => {
    const view = readRepoFile("../src/views/OptimizeWhatifView.tsx");
    expect(view.length, "OptimizeWhatifView.tsx 读到了空内容——路径漂了，先修路径再看结论").toBeGreaterThan(1000);
    expect(view).toContain("fetchOptTemplates");
    expect(view).toContain("retrieveOptTemplates");
    expect(view).toContain("solveOptTemplate");
    // 旧的「清单本身」标识符不许回潮（回潮 = 两套词表复发）。
    expect(view).not.toContain("const FAMILIES:");
    expect(view).toContain("const FAMILY_COPY:");

    const eps = readRepoFile("../src/api/endpoints.ts");
    // 金丝雀：先抓一个**已知必在**的同族 URL；抓不到说明读法坏了，而不是端点没接。
    expect(eps, "金丝雀未中 ⇒ 读法坏了，下面的「不存在」全部不可信").toContain("/a/v1/solvers/${solverKey}/invoke");
    expect(eps).toContain('"/a/v1/opt/templates"');
    expect(eps).toContain("/a/v1/opt/retrieve?need=");
    expect(eps).toContain('"/a/v1/opt/solve"');
  });
});
