import { describe, expect, it } from "vitest";
import { http, HttpResponse, delay } from "msw";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { useSessionStore } from "@/store/sessionStore";
import { tensionDotColor, plateauNote, baseObjectId } from "@/views/RiskBoardView";

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
  it("R2-a：同一档内不同张力必须渲出不同色值（修前红档是平色常量 → 30 点一色）", () => {
    // 信阳 瓶颈工序真序列 91→98 全在红档内：修前 heatColor 一律 `rgba(224,98,108,.85)` → 30 个点色值完全相同。
    const reds = [91, 93, 95, 98].map((v) => tensionDotColor(v, 85));
    expect(new Set(reds).size, `红档内 91/93/95/98 仍渲成同色：${reds.join(" ")}`).toBeGreaterThan(1);
    // 黄档同理（关注区内也要有深浅）。
    const ambers = [70, 76, 84].map((v) => tensionDotColor(v, 85));
    expect(new Set(ambers).size).toBeGreaterThan(1);
    // 档位口径不变：≥阈值 红 / [阈值−15,阈值) 黄 / 其余 青 / 无实测 灰（诚实·不伪造分档）。
    expect(tensionDotColor(90, 85)).toContain("224,98,108");
    expect(tensionDotColor(75, 85)).toContain("232,181,74");
    expect(tensionDotColor(40, 85)).toContain("67,183,215");
    expect(tensionDotColor(null, 85)).toContain("138,148,166");
  });

  it("R2-b：末段贴顶必须据实标注（三因子终点同为 98 = 求解器量表上界·非逐日恶化）", () => {
    expect(plateauNote([91, 93, 95, 98, 98, 98, 98])).toContain("末段贴顶");
    expect(plateauNote([91, 93, 95, 98, 98, 98, 98])).toContain("4 天");
    // 未贴顶 / 只贴 1–2 天 → 不标（避免噪声·不臆造）。
    expect(plateauNote([60, 62, 64, 66])).toBe("");
    expect(plateauNote([60, 62, 66, 66])).toBe("");
    expect(plateauNote(undefined)).toBe("");
  });

  it("R2-c：屏幕上瓶颈行的 30 个逐日点不得只有一个色值 + 行标带贴顶说明", async () => {
    useRisk();
    loginAs("planner");
    renderApp("/v/risk");
    const card = await screen.findByTestId("risk-card-信阳");
    await userEvent.click(card);

    const row = await screen.findByTestId("risk-frow-物流时长");
    const dots = within(row).getAllByRole("button");
    const colors = new Set(dots.map((d) => (d as HTMLElement).style.background || (d as HTMLElement).style.backgroundColor));
    expect(colors.size, `逐日点仍一色（${[...colors].join(" ")}）`).toBeGreaterThan(1);
    expect(row).toHaveTextContent("末段贴顶");
  });

  it("R3-a：gap_attribution 还在飞的时候，绝不出现「暂不可用」（loading≠失败）", async () => {
    useRisk();
    server.use(
      http.post("*/a/v1/solvers/gap_attribution/invoke", async () => {
        await delay(3000); // 请求挂着 → 此刻界面必须是"加载中"，不是"暂不可用"
        return HttpResponse.json({ data: { rootMetric: { key: "k", name: "n", unit: "%", gap: 1 }, levels: [] }, snapshotVersion: "ov" });
      }),
    );
    loginAs("planner");
    renderApp("/v/risk");
    await userEvent.click(await screen.findByTestId("risk-card-信阳"));

    const panel = await screen.findByTestId("rootcause-panel-信阳");
    await screen.findByTestId("rootcause-loading-信阳");
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
    expect(gray).toHaveTextContent("可观测事实");
    // 病因不得再内联"引擎不接受作用域 / 仅缺引擎侧作用域"这类已过期的因果结论。
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
});
