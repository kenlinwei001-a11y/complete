import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SEG_REGISTRY, formatTightness } from "@platform/contracts";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { useSessionStore } from "@/store/sessionStore";
import { AFFECTED_ROWS, ORDER_PROBLEMS } from "@/mocks/planFixtures";
import { fmt } from "@/views/sim/shared";

/**
 * WO-ORDER-ROW-DETAIL 接缝驱动测试（SEAM-GATE）。
 *
 * 现场：仓主实测「受影响订单 · 明细」表点任一行**屏上毫无变化**。根因是两件事，修法不同、不许合成一句：
 *   ① 「接了线接错地方」—— 点击其实**有**行为（写 selectedObjects 对话上下文），但零视觉反馈；
 *   ② 「功能缺失」—— 用户要的展开详情**压根不存在**。
 * 追加需求同理：问题卡点开只有一张图，没有能读的归因叙述。
 *
 * ⚠ 本文件的断言一律咬**相对位置 / 逐字节值 / 前提存在性**，不咬「有东西出现」——
 *   「详情存在」在挂到浮层、挂到表尾、挂到另一个 panel 时统统成立，那种断言是装饰品。
 *   每组断言前先证明「被截断/未选中/尚未展开」这个**前提真的存在**，否则断言可能恒真。
 */

/** 表体的直接子行（数据行与展开行是兄弟）——相对位置断言的唯一依据。 */
const bodyRows = (tableTestId: string): HTMLElement[] => {
  const tbody = screen.getByTestId(tableTestId).querySelector("tbody")!;
  return Array.from(tbody.children) as HTMLElement[];
};
const tid = (el: Element | undefined): string | null => el?.getAttribute("data-testid") ?? null;

describe("WO-ORDER-ROW-DETAIL ① · 订单行内联展开详情", () => {
  it("点第 k 行 ⇒ 详情渲染在第 k 行之后、第 k+1 行之前（相对位置，不是「存在」）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/order-chain");
    await screen.findByTestId("oc-detail-table");
    await waitFor(() => expect(screen.getByTestId("oc-sum-orders")).toHaveTextContent("8"));

    // 取一行**中间**的订单：k+1 行必须真实存在，否则「在 k+1 之前」这个条件恒真（= 假绿）。
    const K_SO = "SO-10004";
    const before = bodyRows("oc-detail-table");
    const k = before.findIndex((el) => tid(el) === `oc-row-${K_SO}`);
    expect(k).toBeGreaterThanOrEqual(0);
    const nextSo = tid(before[k + 1]);
    expect(nextSo).toBe("oc-row-SO-10008"); // 前提①：第 k+1 行确实存在且是数据行
    // 前提②：展开前该行下方**没有**详情节点（否则下面的位置断言可能咬到一个本来就在的节点）
    expect(screen.queryByTestId(`oc-detail-row-${K_SO}`)).not.toBeInTheDocument();

    await user.click(screen.getByTestId(`oc-row-${K_SO}`));

    const after = bodyRows("oc-detail-table");
    // 核心判据：详情是第 k 行的**紧邻下一个兄弟**，且第 k+1 行数据行被顺推到它之后。
    expect(tid(after[k])).toBe(`oc-row-${K_SO}`);
    expect(tid(after[k + 1])).toBe(`oc-detail-row-${K_SO}`);
    expect(tid(after[k + 2])).toBe(nextSo);
    // 冗余交叉验证：DOM 文档序上 详情 在 k 行之后、k+1 行之前（挂到表尾/浮层则此条红）
    const detail = screen.getByTestId(`oc-detail-row-${K_SO}`);
    expect(screen.getByTestId(`oc-row-${K_SO}`).compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(detail.compareDocumentPosition(screen.getByTestId(nextSo!)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // 再点一次收起（展开态是可逆的，不是一次性写死）
    await user.click(screen.getByTestId(`oc-row-${K_SO}`));
    expect(screen.queryByTestId(`oc-detail-row-${K_SO}`)).not.toBeInTheDocument();
  });

  it("colSpan 从表头列定义现算（非写死）：展开单元格 colSpan === thead 列数", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/order-chain");
    await screen.findByTestId("oc-detail-table");

    const thCount = screen.getByTestId("oc-detail-table").querySelectorAll("thead th").length;
    expect(thCount).toBeGreaterThan(0); // 金丝雀：列数抽取器本身没坏（抽出 0 就是工具坏了，不是没列）
    await user.click(screen.getByTestId("oc-row-SO-10001"));
    const cell = screen.getByTestId("oc-detail-row-SO-10001").querySelector("td")!;
    expect(cell.colSpan).toBe(thCount);
  });

  it("详情逐字段逐字节等于响应；risks 给全（条数 === 响应条数，不受 CHIP_LIMIT 截断）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/order-chain");
    await screen.findByTestId("oc-detail-table");
    await waitFor(() => expect(screen.getByTestId("oc-sum-orders")).toHaveTextContent("8"));

    const K_SO = "SO-10004";
    const row = AFFECTED_ROWS.find((r) => r.so === K_SO)!;

    // 前提①：列上**真的**被 CHIP_LIMIT 截断了（chip 数 < 响应条数）。
    // 不先证这一条，「详情有 N 条」可能只是因为压根没截断 —— 断言恒真、证不了任何事。
    const chipsOnRow = within(screen.getByTestId(`oc-row-${K_SO}`)).getAllByTestId(new RegExp(`^oc-risk-chip-${K_SO}-`));
    expect(chipsOnRow.length).toBeLessThan(row.risks.length);
    expect(screen.getByTestId(`oc-risk-more-${K_SO}`)).toHaveTextContent(`+${row.risks.length - chipsOnRow.length}`);
    // 前提②：列上的交期是被 slice(5) 截短的，详情给完整日期才算"比列多"
    expect(row.due).not.toBe(row.due.slice(5));

    await user.click(screen.getByTestId(`oc-row-${K_SO}`));
    const detail = screen.getByTestId(`oc-detail-row-${K_SO}`);

    // —— 逐字节：完整交期 / 延误 ——
    expect(within(detail).getByTestId(`oc-detail-due-${K_SO}`).textContent).toBe(row.due);
    expect(within(detail).getByTestId(`oc-detail-delay-${K_SO}`).textContent).toBe(`${row.delay} 天`);

    // —— 逐字节：本单营收暴露 = qty × SEG 参考单价 ÷ 1e4（估算口径·公式在测试里独立写一遍）——
    const priceWan = SEG_REGISTRY.find((s) => s.seg === row.seg)!.priceWan;
    expect(within(detail).getByTestId(`oc-detail-rev-${K_SO}`).textContent).toBe(fmt((row.qty * priceWan) / 1e4, 2));

    // —— risks 全量：条数 === 响应条数 ——
    const riskRows = within(screen.getByTestId(`oc-detail-risks-${K_SO}`)).getAllByTestId(new RegExp(`^oc-detail-risk-${K_SO}-`));
    expect(riskRows).toHaveLength(row.risks.length);
    expect(within(detail).getByTestId(`oc-detail-risks-title-${K_SO}`).textContent).toContain(String(row.risks.length));

    // —— 每条风险点逐格逐字节等于响应字段 ——
    // 基数下限：上面的 toHaveLength(row.risks.length) 在 risks 为空时是 `toHaveLength(0)`——照样绿，
    // 而下面这个 forEach 会跑 0 圈、一条逐格断言都不执行（假绿第 12 形态：0/N 与 N/N 同色）。
    // 故先咬住「真有得可循环」，且要多于 1 条才验得出「不受 CHIP_LIMIT 截断」这件事。
    // ⚠ 必须写成单参 `expect(x.length)`：本门的 hasCardinalityAnchor 要求 `)` 紧跟 .length，
    //   双参 `expect(value, message)` 它一律识别不到（已实测，见 docs/WO-FOLLOWUP-2026-08-13.md §3）。
    expect(row.risks.length).toBeGreaterThanOrEqual(2);
    row.risks.forEach((k, i) => {
      const cells = Array.from(screen.getByTestId(`oc-detail-risk-${K_SO}-${i}`).querySelectorAll("td")).map((td) => td.textContent);
      expect(cells[0]).toBe(k.base);
      expect(cells[1]).toBe(k.factor);
      expect(cells[2]).toBe(k.crossDay != null ? `D+${k.crossDay}` : "窗口内不越线");
      // WO-UNIT-MEANING：峰值是张力 0–100 指数，必须带量纲（退回裸数即红）
      expect(cells[3]).toBe(formatTightness(k.peak));
      expect(cells[4]).toBe(k.threshold != null ? formatTightness(k.threshold) : "响应未带回该字段");
      expect(cells[5]).toBe(k.series ? `${k.series.length} 天` : "响应未带回该字段");
    });

    // 缺数诚实披露：说清 rows[] 没带回什么，而不是拿别处的数补齐
    expect(within(detail).getByTestId(`oc-detail-gap-${K_SO}`).textContent).toContain("affected_orders.rows[]");
  });

  it("② 对话上下文：显式入口写入 selectedObjects（原链保留）且屏上看得见", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/order-chain");
    await screen.findByTestId("oc-detail-table");

    const K_SO = "SO-10006";
    // 前提：初始未选中 —— 徽章不在、store 为空（不先证，"点完有徽章"可能是它一直都在）
    expect(useSessionStore.getState().selectedObjects).toHaveLength(0);
    expect(screen.queryByTestId(`oc-ctx-badge-${K_SO}`)).not.toBeInTheDocument();

    // 整行点击现在只负责展开详情：**不再**偷偷改对话上下文
    await user.click(screen.getByTestId(`oc-row-${K_SO}`));
    expect(screen.getByTestId(`oc-detail-row-${K_SO}`)).toBeInTheDocument();
    expect(useSessionStore.getState().selectedObjects).toHaveLength(0);

    // 显式入口 → toggleSelectedObject 原链（三字段一字未改）
    await user.click(screen.getByTestId(`oc-ctx-btn-${K_SO}`));
    expect(useSessionStore.getState().selectedObjects).toEqual([
      expect.objectContaining({ objectType: "Order", objectId: `ord-${K_SO}`, label: K_SO }),
    ]);
    // 「已进入对话上下文」这件事必须在屏上（行上徽章 + 展开详情里的标记），不能只活在 store 里
    expect(screen.getByTestId(`oc-ctx-badge-${K_SO}`)).toHaveTextContent("已进入对话上下文");
    expect(screen.getByTestId(`oc-detail-ctx-${K_SO}`)).toHaveTextContent("已进入对话上下文");

    // 再点 → 移出，徽章同步消失（选中态是订阅式读取，不是一次性渲染）
    await user.click(screen.getByTestId(`oc-ctx-btn-${K_SO}`));
    expect(useSessionStore.getState().selectedObjects).toHaveLength(0);
    expect(screen.queryByTestId(`oc-ctx-badge-${K_SO}`)).not.toBeInTheDocument();
  });
});

describe("追加需求 · 问题卡归因叙述（派生·不编）", () => {
  it("点问题卡 ⇒ 叙述渲染在那张卡之后、下一张卡之前；数字逐字节等于响应字段", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/v/order-chain");
    const grid = await screen.findByTestId("oc-problems");
    await waitFor(() => expect(screen.getByTestId("oc-problem-DELIVERY")).toBeInTheDocument());

    const kids = () => Array.from(grid.children) as HTMLElement[];
    const CAT = "DELIVERY";
    const k = kids().findIndex((el) => tid(el) === `oc-problem-${CAT}`);
    expect(k).toBeGreaterThanOrEqual(0);
    const nextCard = tid(kids()[k + 1]);
    expect(nextCard).toBe("oc-problem-MARGIN"); // 前提：下一张卡确实存在
    expect(screen.queryByTestId(`oc-problem-detail-${CAT}`)).not.toBeInTheDocument();

    await user.click(screen.getByTestId(`oc-problem-${CAT}`));

    // 相对位置：叙述在被点卡的紧邻下一个兄弟（弹浮层 / 挂到网格末尾 → 此条红）
    const after = kids();
    expect(tid(after[k])).toBe(`oc-problem-${CAT}`);
    expect(tid(after[k + 1])).toBe(`oc-problem-detail-${CAT}`);
    expect(tid(after[k + 2])).toBe(nextCard);

    const g = ORDER_PROBLEMS.find((p) => p.category === CAT)!;
    const panel = screen.getByTestId(`oc-problem-detail-${CAT}`);

    // —— 规模句逐字节：类别标签取自 ViewConfig.layout.categoryLabels（mock 特意写成"交期·配置X"），
    //    orderCount / financeImpact 取自响应。写死模板串 → 此条红。
    expect(within(panel).getByTestId(`oc-narr-line-${CAT}-scale`).textContent).toBe(
      `【交期·配置X】${g.title}：归并 ${g.orderCount} 单受影响，财务贡献 ${g.financeImpact.toFixed(1)} 亿。`,
    );
    // —— 共性根因句逐字节 = rootCauseSummary 原文 ——
    expect(within(panel).getByTestId(`oc-narr-line-${CAT}-common`).textContent).toBe(`共性根因：${g.rootCauseSummary}`);
    // —— 覆盖度句逐字节 = rootChains.length / orderCount ——
    expect(within(panel).getByTestId(`oc-narr-line-${CAT}-coverage`).textContent).toBe(
      `逐单因果链覆盖 ${g.rootChains.length}/${g.orderCount} 单。`,
    );

    // —— 逐单因果句：**按 kind 取层**，逐字节等于 layers[].label ——
    for (const c of g.rootChains) {
      const judge = c.layers.find((l) => l.kind === "judgement")!.label;
      const cause = c.layers.find((l) => l.kind === "rootCause")!.label;
      const remedy = c.layers.find((l) => l.kind === "remedy")!.label;
      expect(within(panel).getByTestId(`oc-narr-line-${CAT}-chain-${c.orderId}`).textContent).toBe(
        `${c.orderId}：判定「${judge}」← 根因「${cause}」→ 对策「${remedy}」。`,
      );
    }

    // —— 覆盖不全时必须**明说推不出**，不许拿共性根因顶替 ——
    expect(g.rootChains.length).toBeLessThan(g.orderCount); // 前提：这组确实覆盖不全
    expect(within(panel).getByTestId(`oc-narr-gaps-${CAT}`).textContent).toContain(
      `另 ${g.orderCount - g.rootChains.length}/${g.orderCount} 单未随响应带回 rootChains`,
    );
    // 作用域诚实：problems[] 无基地维 → 叙述不假装有
    expect(within(panel).getByTestId(`oc-narr-scope-${CAT}`).textContent).toContain("不带基地/因素维");
    // 同一份 rootChains 既讲话又画图（不另调接口、不造第二套因果）
    expect(within(panel).getByTestId("problem-dag")).toHaveAttribute("data-layers", "4");
  });

  it("反向用例：因果树取不出的响应 ⇒ 屏上是「推不出/缺什么」的诚实态，而非一段通顺空话", async () => {
    const user = userEvent.setup();
    // 构造：① rootChains 全空 + rootCauseSummary 空；② 有链但缺"根因"层（半截因果）
    const probe = {
      summary: { orderCount: 2, totalQty: 100, custCount: 1, revenue: 1.5 },
      rows: [{ so: "SO-PROBE", cust: "C", seg: "储能", model: "M", qty: 100, due: "2026-06-30", delay: 1, risks: [] }],
      problems: [
        { category: "DELIVERY", title: "无链组", orderCount: 4, financeImpact: 2.5, rootCauseSummary: "", rootChains: [] },
        {
          category: "MARGIN",
          title: "半截链组",
          orderCount: 1,
          financeImpact: 1.25,
          rootCauseSummary: "有共性结论",
          rootChains: [
            { orderId: "SO-HALF", layers: [{ kind: "order", label: "SO-HALF" }, { kind: "judgement", label: "判了" }, { kind: "remedy", label: "对策有" }] },
          ],
        },
      ],
    };
    server.use(http.post("*/b/v1/solvers/affected_orders/run", () => HttpResponse.json({ data: probe, snapshotVersion: "ov-probe" })));

    loginAs("planner");
    renderApp("/v/order-chain");
    await screen.findByTestId("oc-problems");

    // ① 全空链：明说 rootChains 为空 + rootCauseSummary 为空，且**一句逐单因果都不出**
    await user.click(await screen.findByTestId("oc-problem-DELIVERY"));
    const p1 = screen.getByTestId("oc-problem-detail-DELIVERY");
    const gaps1 = within(p1).getByTestId("oc-narr-gaps-DELIVERY").textContent ?? "";
    expect(gaps1).toContain("problems[].rootChains 为空");
    expect(gaps1).toContain("problems[].rootCauseSummary 为空");
    expect(within(p1).queryByTestId("oc-narr-line-DELIVERY-common")).not.toBeInTheDocument();
    expect(within(p1).queryAllByTestId(/^oc-narr-line-DELIVERY-chain-/)).toHaveLength(0);
    // 但规模句仍据实给出（响应真有的字段照说），逐字节：
    expect(within(p1).getByTestId("oc-narr-line-DELIVERY-scale").textContent).toBe("【交期·配置X】无链组：归并 4 单受影响，财务贡献 2.5 亿。");

    // ② 半截链：缺哪一层就点名哪一层，且该单**不出**因果句（不拿判定+对策拼一个假因果）
    await user.click(screen.getByTestId("oc-problem-MARGIN"));
    const p2 = screen.getByTestId("oc-problem-detail-MARGIN");
    expect(within(p2).getByTestId("oc-narr-gaps-MARGIN").textContent).toContain("SO-HALF：layers 缺「根因」层");
    expect(within(p2).queryByTestId("oc-narr-line-MARGIN-chain-SO-HALF")).not.toBeInTheDocument();
    // 共性根因这句有真值就照出（诚实态不等于全盘不说话）
    expect(within(p2).getByTestId("oc-narr-line-MARGIN-common").textContent).toBe("共性根因：有共性结论");
  });
});
