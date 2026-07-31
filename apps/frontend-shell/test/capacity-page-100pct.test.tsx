import { describe, expect, it } from "vitest";
import { http, HttpResponse, delay } from "msw";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { useSessionStore } from "@/store/sessionStore";
import { baseObjectId } from "@/views/RiskBoardView";
// ⚠️ 审核方并线注记：本单原有的 `tensionDotColor`（档内 alpha 斜坡）与 `plateauNote`（披露末段贴顶 N 天）
// 在并线时**被更强的机制取代，非删覆盖**：
//   · 点阵表达 → `dotVisual`（同档 alpha ⊕ **柱高**双通道·信息量严格超集），且带一条反向红咬
//     「逐日恒等的行被渲染出起伏 = 伪造」，防止为了好看而造假起伏；
//   · plateauNote → 引擎侧 `saturateTension` 已消除平顶本身（三因子峰值 97.9508/97.9248/97.8399 互不相同），
//     再留"贴顶 N 天"的披露文案将永不触发 = 看着像功能的死代码。
// 对应断言已迁至 `risk-honest-gray-and-daily.test.tsx`（柱高档数 ≥8 / 恒定行恒 1 档）。

/**
 * WO-CAPACITY-PAGE-100PCT · 「产能推演」页 100% 功能实证 LOOP —— 前端半（效果层断言）。
 * 每条对应一个在真浏览器里亲手复现出来的病：
 *   R2  逐日点阵 30 点渲成**同一个色值**（红/黄档是平色常量）+ 三因子终点同为 98（求解器封顶）却无任何披露
 *   R3  loading 与失败共用「根因推演树暂不可用」；灰态文案内联了一段**过期的因果推断**（"仅缺引擎侧作用域"）
 *   R5  点卡写进 selectedObjects 的是 mock 形态 `base-<中文名>`（后端查不到）
 *   ⑨   「⚠ 首要风险」徽章因 peak 被封顶打平而同时挂在 7 张卡上
 */
const CARDS = [
  { base: "江门", baseId: "jiangmen", factor: "物料齐套", peak: 98, crossDay: 1, currentTightness: { value: 96, live: true },
    series: [91, 91, 92, 93, 94, 95, 96, 97, 98, 98, 98, 98], events: [], affectedOrders: [] },
  { base: "信阳", baseId: "xinyang", factor: "物流时长", peak: 98, crossDay: 1, currentTightness: { value: 92, live: true },
    series: [92, 93, 94, 95, 96, 97, 98, 98, 98, 98, 98, 98], events: [], affectedOrders: [] },
  { base: "厦门", baseId: "xiamen", factor: "瓶颈工序", peak: 98, crossDay: 1, currentTightness: { value: 91, live: true },
    series: [91, 92, 93, 94, 95, 96, 97, 98, 98, 98, 98, 98], events: [], affectedOrders: [] },
];
const riskTimeline = { horizon: 30, threshold: 85, cards: CARDS, planRows: [] };

const useRisk = (): void => {
  server.use(
    http.post("*/a/v1/solvers/risk_timeline/invoke", () => HttpResponse.json({ data: riskTimeline, snapshotVersion: "ov-cap" })),
  );
};

describe("WO-CAPACITY-PAGE-100PCT · 产能推演页 前端", () => {

  it("R3-a：gap_attribution 还在飞的时候，绝不出现「暂不可用」（loading≠失败）", async () => {
    useRisk();
    server.use(
      http.post("*/a/v1/solvers/gap_attribution/invoke", async () => {
        // 请求挂着 → 此刻界面必须是"加载中"，不是"暂不可用"。
        // ⚠ 观察窗取 60s 而非 3s（本单实测踩到）：`test/setup.ts` 已把 asyncUtilTimeout 设成 15s，
        //   所以问题不在轮询超时，而在**观察窗本身太短**——整包跑 + 本机并行多套件（实测 load avg > 20）时，
        //   "点卡 → 面板挂载"可能超过 3s，等断言去看时响应早已返回、loading 元素已消失 → **假红**
        //   （单跑该文件恒绿、整包跑偶红，正是这类时序脆弱测试的典型症状）。
        //   观察窗必须远大于最坏渲染耗时；testTimeout=20s < 60s，故这个 timer 在测试内永不触发。
        await delay(60_000);
        return HttpResponse.json({ data: { rootMetric: { key: "k", name: "n", unit: "%", gap: 1 }, levels: [] }, snapshotVersion: "ov" });
      }),
    );
    loginAs("planner");
    renderApp("/v/risk");
    await userEvent.click(await screen.findByTestId("risk-card-信阳", {}, { timeout: 15_000 }));

    const panel = await screen.findByTestId("rootcause-panel-信阳", {}, { timeout: 15_000 });
    await screen.findByTestId("rootcause-loading-信阳", {}, { timeout: 15_000 });
    expect(panel, "loading 态被渲成失败态（把加载中宣告为不可用·本项目前科）").not.toHaveTextContent("暂不可用");
  });

  it("R3-b：诚实灰只陈述可观测事实，不得内联过期的因果推断（G-GAP-SCOPE 早已闭）", async () => {
    useRisk();
    server.use(
      http.post("*/a/v1/solvers/gap_attribution/invoke", () =>
        HttpResponse.json({ data: { rootMetric: { key: "k", name: "n", unit: "%", gap: 1 }, levels: [] }, snapshotVersion: "ov" }),
      ),
    );
    loginAs("planner");
    renderApp("/v/risk");
    await userEvent.click(await screen.findByTestId("risk-card-信阳"));

    const gray = await screen.findByTestId("rootcause-gap-信阳");
    // ⚠️ 审核方复并注记（别把这条读成"放松"）：原断言是 `toHaveTextContent("可观测事实")`——
    //    一条**文案指纹**。并线时诚实灰被整体重写（loading 独立块 / 失败态只报 HTTP 状态码·错误码·requestId /
    //    空态只报"响应里实际有哪些 level-1 节点"），行为严格变强，但"可观测事实"这五个字挪进了代码注释，
    //    于是指纹落空、测试转红。**修法不是把那五个字塞回界面**（那是给文案背书，正是本仓的假绿老路），
    //    而是改咬**结构**：诚实灰必须真的渲出「观测到什么」+「下一步查什么」两个可寻址节点，
    //    且事实节点里说的是**从响应直接读得出的东西**（归因层级字段名 + 本基地不在其中），不是猜的因果。
    const fact = within(gray).getByTestId("rootcause-fact-信阳");
    expect(fact).toHaveTextContent("levels.depth=1"); // 事实的出处 = 响应字段路径本身
    expect(fact).toHaveTextContent("没有「信阳」"); // 陈述的是"本基地不在返回集合里"这个可核查事实
    within(gray).getByTestId("rootcause-next-信阳"); // 下一步必须给，且依据只能是上面那些字段
    // 病因不得再内联"引擎不接受作用域 / 仅缺引擎侧作用域"这类已过期的因果结论（G-GAP-SCOPE 早已闭）。
    expect(gray).not.toHaveTextContent("不接受 base×factor 作用域");
    expect(gray).not.toHaveTextContent("仅缺引擎侧作用域");
  });

  it("R5：点风险卡写进 selectedObjects 的必须是**后端真实对象 id** obj_base_<baseId>", async () => {
    useRisk();
    useSessionStore.getState().setSelectedObjects([]);
    loginAs("planner");
    renderApp("/v/risk");
    await userEvent.click(await screen.findByTestId("risk-card-信阳"));

    await waitFor(() => expect(useSessionStore.getState().selectedObjects.length).toBe(1));
    const sel = useSessionStore.getState().selectedObjects[0]!;
    expect(sel.objectType).toBe("Base");
    // 修前写的是 `base-信阳`（mock 形态·`/a/v1/objects?type=Base` 里根本不存在这个 id）。
    expect(sel.objectId).toBe("obj_base_xinyang");
    expect(sel.objectId).not.toMatch(/^base-/);
    // 单一出处：一切基地引用都走 baseObjectId（缺 baseId 的旧后端才回落基地名·向后兼容）。
    expect(baseObjectId({ base: "信阳", baseId: "xinyang" })).toBe("obj_base_xinyang");
    expect(baseObjectId({ base: "信阳" })).toBe("信阳");
  });

  it("⑪：拖完杠杆点重算后，必须亮出引擎回执 overlay（治「表格一个字没变也不说为什么」的静默降级）", async () => {
    // 求解器回传的 planRows[].overlay 是契约既有字段，修前前端**从来不渲染** → 用户以为杠杆是假的。
    const rows = [
      { act: "工艺路线调整（合肥）", det: "", owner: "o", start: "s", done: "d", eff: "e", rule: "C05", baseId: "hefei", shortfall: 1500.2, residual: 0, overlay: { count: 2, capRatio: 0.980369 } },
      { act: "双线路运输（信阳）", det: "", owner: "o", start: "s", done: "d", eff: "e", rule: "C05", baseId: "xinyang", shortfall: 0, residual: 0, overlay: { count: 2, capRatio: 0.989522 } },
    ];
    // 首屏（基线查询）不带 overlay；点「重算」后的那次 invoke 才带（= 真实链路：有杠杆推演态才有回执）。
    let calls = 0;
    server.use(
      http.post("*/a/v1/solvers/risk_timeline/invoke", () => {
        calls += 1;
        const planRows = calls === 1 ? rows.map(({ overlay: _o, ...r }) => r) : rows;
        return HttpResponse.json({ data: { ...riskTimeline, planRows }, snapshotVersion: "ov-cap" });
      }),
    );
    loginAs("planner");
    renderApp("/v/risk");
    // 基线态（未推演）→ 无回执（不臆造）。
    await screen.findByTestId("risk-plan-table");
    expect(screen.queryByTestId("risk-plan-overlay-note")).toBeNull();

    await userEvent.click(screen.getByTestId("risk-plan-regen"));
    const note = await screen.findByTestId("risk-plan-overlay-note");
    // 效果层：说清楚杠杆落在哪、比值多少、哪些基地有缺口（行动项已重算）、哪些无缺口（理应不变）。
    expect(note).toHaveTextContent("hefei ×0.980");
    expect(note).toHaveTextContent("xinyang ×0.990");
    expect(note).toHaveTextContent("1 个基地窗内有缺口");
    expect(note).toHaveTextContent("1 个窗内无缺口");
  });

  it("⑨：「首要风险」徽章全页只有一个（修前 peak 被封顶打平 → 7 张卡同时挂）", async () => {
    useRisk();
    loginAs("planner");
    renderApp("/v/risk");
    await screen.findByTestId("risk-card-江门");
    const badges = screen.queryAllByTestId(/^risk-primary-/);
    expect(badges.length, `首要风险徽章挂了 ${badges.length} 个`).toBe(1);
    // 且必须挂在求解器排序第一（最严重·当前张力 96）的那张卡上。
    expect(badges[0]!.getAttribute("data-testid")).toBe("risk-primary-江门");
  });

  it("⑬：切 30→60 天窗口，订单聚合表必须真跟着变（修前后端写死 180 天窗·chip 是死的）", async () => {
    // 桩按 **收到的 horizon** 返回不同行集：只有前端把 chip 的新 horizon 真送到后端、
    // 并用新响应重渲，屏幕行数才会变。这是效果层（"表格因此不同"），不是运输层（"参数到达了"）。
    const seen: number[] = [];
    useRisk();
    server.use(
      http.post("*/a/v1/solvers/affected_orders/invoke", async ({ request }) => {
        const body = (await request.json()) as { args?: { horizon?: number } };
        const h = Number(body.args?.horizon ?? 0);
        seen.push(h);
        const n = h >= 60 ? 3 : 1;
        const rows = Array.from({ length: n }, (_, i) => ({
          so: `SO-${h}-${i}`, cust: "长安汽车", seg: "动力电池", model: "4680-NCM",
          qty: 1000, due: "2026-07-02", delay: 2, risks: [{ base: "江门", factor: "物料齐套", crossDay: 1, peak: 98, threshold: 85 }],
        }));
        return HttpResponse.json({ data: { summary: { orderCount: n, totalQty: 1000 * n, custCount: 1, revenue: 1 }, rows, problems: [] }, snapshotVersion: "ov-cap" });
      }),
    );
    loginAs("planner");
    renderApp("/v/risk");
    await screen.findByTestId("risk-card-江门");
    await userEvent.click(screen.getByTestId("risk-tab-order"));

    await waitFor(() => expect(screen.getAllByTestId(/^risk-order-row-/).length).toBe(1));
    // 口径交底必须在屏（R-一致：同屏 KPI 与本表覆盖面不同，得说清楚，不许让用户自己猜）。
    expect(screen.getByTestId("risk-order-agg-caliber")).toHaveTextContent("未来 30 天内交期");

    await userEvent.click(screen.getByTestId("risk-window-60"));
    await waitFor(() => expect(screen.getAllByTestId(/^risk-order-row-/).length).toBe(3));
    expect(screen.getByTestId("risk-order-agg-caliber")).toHaveTextContent("未来 60 天内交期");
    // 后端确实两次都收到了当前 chip 的 horizon（30 与 60 都出现过）。
    expect(seen).toContain(30);
    expect(seen).toContain(60);
  });

  it("⑭：订单聚合「基地筛选」选了一个基地后，下拉里**别的基地还在**（修前选项集塌成只剩自己）", async () => {
    // 桩照真后端行为：传了 base 就只回该基地的单 —— 修前前端拿"已过滤的响应"派生选项集，
    // 于是选中合肥后下拉只剩「全部风险基地(1) + 合肥」，想改选金华必须先点 ✕清除，且那个 (1) 是假总数。
    const mk = (so: string, base: string) => ({
      so, cust: "长安汽车", seg: "动力电池", model: "4680-NCM", qty: 1000, due: "2026-07-02", delay: 2,
      risks: [{ base, factor: "物料齐套", crossDay: 1, peak: 98, threshold: 85 }],
    });
    const ALL = [mk("SO-1", "合肥"), mk("SO-2", "金华"), mk("SO-3", "武汉")];
    useRisk();
    server.use(
      http.post("*/a/v1/solvers/affected_orders/invoke", async ({ request }) => {
        const body = (await request.json()) as { args?: { base?: string } };
        const base = body.args?.base;
        const rows = base ? ALL.filter((r) => r.risks[0]!.base === base) : ALL;
        return HttpResponse.json({ data: { summary: { orderCount: rows.length, totalQty: 1000 * rows.length, custCount: 1, revenue: 1 }, rows, problems: [] }, snapshotVersion: "ov-cap" });
      }),
    );
    loginAs("planner");
    renderApp("/v/risk");
    await screen.findByTestId("risk-card-江门");
    await userEvent.click(screen.getByTestId("risk-tab-order"));

    // ⚠ 每次都**重新取** select：切筛选时 `isLoading` 会把整个 OrderAggView 卸掉重渲，
    //    握着旧引用去断言 = 读一个已经脱离文档的节点（那才是真假绿·本条测试第一版就踩了）。
    const sel = (): HTMLSelectElement => screen.getByTestId("risk-order-basesel") as HTMLSelectElement;
    const optsOf = (): string[] => within(sel()).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    await waitFor(() => expect(optsOf().length).toBe(4)); // 全部 + 3 基地
    await userEvent.selectOptions(sel(), "合肥");

    // 明细真裁剪（筛选确实生效）——
    await waitFor(() => expect(screen.getAllByTestId(/^risk-order-row-/).length).toBe(1));
    expect(screen.getByTestId("risk-order-row-SO-1")).toBeInTheDocument();
    // 效果层头号：选项**不许塌**，金华/武汉必须还能直接选（修前这里只剩「全部(1)+合肥」2 个 option）。
    const opts = optsOf();
    expect(opts, `下拉塌成 ${opts.join("/")} → 无法直接改选别的基地`).toContain("金华");
    expect(opts).toContain("武汉");
    expect(opts.length).toBe(4);
    // 「全部风险基地（N）」的 N 必须仍是全域 3，不许显示成过滤后的 1（假总数）。
    expect(within(sel()).getAllByRole("option")[0]!.textContent).toContain("3");
    // 直接改选金华（不先清除）必须真生效。
    await userEvent.selectOptions(sel(), "金华");
    await waitFor(() => expect(screen.getByTestId("risk-order-row-SO-2")).toBeInTheDocument());
    expect(screen.queryByTestId("risk-order-row-SO-1")).toBeNull();
  });
});
