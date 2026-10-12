import { describe, expect, it } from "vitest";
import { http, HttpResponse, delay } from "msw";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";
import { useSessionStore } from "@/store/sessionStore";

/**
 * 产能推演看板三条**效果层**纪律（都是"绿测试≠能用"踩出来的坑，故一律断言用户看得见的效果，不是运输层）：
 *
 * ① **诚实灰不许伪造病因**（RootCausePanel）——"诚实灰"诚实的只是"我没有数据"；
 *    **病因不是前端能看出来的**。修前这里把 `loading` 与 error/空数据塞进同一个「暂不可用」块，
 *    并**无条件**渲染一行「补齐路径：gap_attribution 支持 base×factor 入参作用域后本树即活
 *    （仅缺引擎侧作用域）」——不分支、斩钉截铁，且该结论早已过期（本体 §8 G-GAP-SCOPE 已闭），
 *    把用户引去查一个好的引擎。
 * ② **逐日轴不许只表达 1 个 bit**（FactorRow）——后端逐日值是真变的（信阳瓶颈工序 30 天 15 个不同值），
 *    旧渲染 `heatColor` 对 ≥阈值一律同一个红 → 30 个点同色、零信息量。
 * ③ **选中态必须是真 objectId**——`base-${中文名}` 只存在于前端 mock fixture，后端解析不出，
 *    导致"看板点了基地、对话坞仍反问请提供基地"。
 */

const THRESHOLD = 85;

/** 信阳卡·主因素瓶颈工序：**全程 ≥ 阈值但逐日真变**（= 用户截图里"30 个点全红"那一行的真实数据形状）。 */
const XINYANG_SERIES = [
  91, 91, 92, 92, 92, 92, 93, 93, 93, 93, 94, 94, 94, 94, 94, 95, 95, 95, 95, 96,
  96, 97, 97.7179, 97.8543, 97.9508, 97.9377, 97.9212, 97.9002, 97.7042, 97.5476,
];
/** 对照行：无逐日源 → 逐日恒等（诚实持平·不该被伪造成起伏）。 */
const FLAT_SERIES = new Array(30).fill(88);

function riskTimelineMock() {
  return http.post("*/a/v1/solvers/risk_timeline/invoke", () =>
    HttpResponse.json({
      data: {
        horizon: 30,
        threshold: THRESHOLD,
        cards: [
          {
            base: "信阳",
            baseId: "xinyang",
            factor: "瓶颈工序",
            peak: 97.9508,
            crossDay: 1,
            series: XINYANG_SERIES,
            factorSeries: { 瓶颈工序: XINYANG_SERIES, 换型损失: FLAT_SERIES },
            currentTightness: { value: 91, live: true },
            events: [],
            provenanceSynthetic: false,
            affectedOrders: [],
          },
        ],
        planRows: [],
      },
      snapshotVersion: "ov-honest",
    }),
  );
}

/** bottleneck_matrix：详情面板「其余因素」行来源（换型损失 = 无 factorSeries 差异的对照行）。 */
function bottleneckMock() {
  return http.post("*/a/v1/solvers/bottleneck_matrix/invoke", () =>
    HttpResponse.json({
      data: {
        dataMode: "LIVE",
        factors: ["瓶颈工序", "换型损失"],
        rows: [{ base: "信阳", tightness: { 瓶颈工序: 91, 换型损失: 88 }, primary: "瓶颈工序", provenanceSynthetic: false }],
      },
      snapshotVersion: "ov-honest",
    }),
  );
}

async function openXinyangCard() {
  loginAs("planner");
  renderApp("/v/risk");
  const card = await screen.findByTestId("risk-card-信阳");
  fireEvent.click(card);
  return card;
}

/** 过期/伪造的因果断言词表——这些话前端**没有依据**可以说，出现任何一条即红。 */
const FORBIDDEN_CAUSAL = [
  "仅缺引擎侧作用域",
  "补齐路径",
  "不接受 base×factor 作用域",
  "前端已就绪",
];

describe("① 诚实灰只陈述可观测事实（不伪造病因）", () => {
  it("loading 态独立渲染加载态，绝不出现「暂不可用」，也不出现任何因果断言", async () => {
    server.use(
      riskTimelineMock(),
      bottleneckMock(),
      // 请求挂住不返回 → 界面处于真正的 loading 态。
      http.post("*/a/v1/solvers/gap_attribution/invoke", async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );
    await openXinyangCard();

    const panel = await screen.findByTestId("rootcause-panel-信阳");
    // 加载态自己的块（与失败/空态**不共用**）。
    expect(await screen.findByTestId("rootcause-loading-信阳")).toBeInTheDocument();
    // 请求还在飞 → 不许宣告失败。
    expect(panel).not.toHaveTextContent("暂不可用");
    // 也不许提前给病因。
    for (const s of FORBIDDEN_CAUSAL) expect(panel).not.toHaveTextContent(s);
    // 失败/空态块此刻不应存在。
    expect(screen.queryByTestId("rootcause-gap-信阳")).toBeNull();
  });

  it("error 态：文案含真实 HTTP 状态码 + 错误码 + requestId，且不含因果断言", async () => {
    server.use(
      riskTimelineMock(),
      bottleneckMock(),
      http.post("*/a/v1/solvers/gap_attribution/invoke", () =>
        HttpResponse.json(
          { error: { code: "SOLVER_TIMEOUT", message: "attribution exceeded budget", requestId: "req-xyz-42" } },
          { status: 503 },
        ),
      ),
    );
    await openXinyangCard();

    const gap = await screen.findByTestId("rootcause-gap-信阳");
    const fact = screen.getByTestId("rootcause-fact-信阳");
    // 可观测事实：状态码 / 错误码 / requestId / 后端 message —— 全部能从响应直接读出。
    expect(fact).toHaveTextContent("HTTP 503");
    expect(fact).toHaveTextContent("SOLVER_TIMEOUT");
    expect(fact).toHaveTextContent("req-xyz-42");
    expect(fact).toHaveTextContent("attribution exceeded budget");
    // 下一步建议按分支给且带依据（错误码），不是一句放之四海的结论。
    expect(screen.getByTestId("rootcause-next-信阳")).toHaveTextContent("错误码");
    // 绝不因果断言。
    for (const s of FORBIDDEN_CAUSAL) expect(gap).not.toHaveTextContent(s);
    // 加载态块不应还在。
    expect(screen.queryByTestId("rootcause-loading-信阳")).toBeNull();
  });

  it("空树态（响应成功但归因基地集里没有本基地）：只报响应里实际返回了哪些基地，不推断原因", async () => {
    server.use(
      riskTimelineMock(),
      bottleneckMock(),
      http.post("*/a/v1/solvers/gap_attribution/invoke", () =>
        HttpResponse.json({
          data: {
            rootMetric: { key: "seg_attain_ess", name: "储能达成率", unit: "%", target: 100, actual: 72.2, gap: 27.8 },
            levels: [{ depth: 1, label: "基地", nodes: [{ id: "base:南京", factor: "基地 南京", contribution: 9.2, unit: "%", share: 0.33 }] }],
          },
          snapshotVersion: "ov-honest",
        }),
      ),
    );
    await openXinyangCard();

    const gap = await screen.findByTestId("rootcause-gap-信阳");
    const fact = screen.getByTestId("rootcause-fact-信阳");
    // 事实来自响应字段本身（rootMetric.key + levels[depth=1] 的实际节点）。
    expect(fact).toHaveTextContent("seg_attain_ess");
    expect(fact).toHaveTextContent("基地 南京");
    // 不伪造根因树。
    expect(screen.queryByTestId("provenance-dag")).toBeNull();
    for (const s of FORBIDDEN_CAUSAL) expect(gap).not.toHaveTextContent(s);
  });
});

describe("② 逐日轴表达真值（30 个点 ≠ 1 个 bit）", () => {
  it("整行全部 ≥ 阈值（全红）时，逐日点仍逐日**可区分**——颜色与柱高都随真值变", async () => {
    server.use(riskTimelineMock(), bottleneckMock());
    await openXinyangCard();

    await screen.findByTestId("risk-timeline");
    const dots = await waitFor(() => {
      const found = Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="risk-dot-"]')).filter((el) =>
        /^risk-dot-\d+$/.test(el.dataset.testid ?? ""),
      );
      expect(found.length).toBe(XINYANG_SERIES.length);
      return found;
    });

    // 前提校验：这一行确实**全部**越线（= 用户截图里"全红"的那种行）。
    for (const v of XINYANG_SERIES) expect(v).toBeGreaterThanOrEqual(THRESHOLD);

    // 每日点带真值（不是被压成一个色阶就丢了）。
    expect(dots.map((d) => Number(d.dataset.value))).toEqual(XINYANG_SERIES);

    // 效果层齿①：柱高（非颜色通道）随真值分层——30 个点不得只有 1 个高度。
    const fills = new Set(dots.map((d) => d.dataset.fill));
    expect(fills.size, "全红行的柱高只有一档 = 30 个点仍只表达 1 个 bit").toBeGreaterThanOrEqual(8);

    // 效果层齿②：颜色也随真值连续变化（旧 heatColor 对 ≥阈值恒返回同一个 rgba → 此处只有 1 种色）。
    const colors = new Set(dots.map((d) => (d.firstElementChild as HTMLElement | null)?.style.background ?? ""));
    expect(colors.size, "全红行的点色只有 1 种 = 阈值分桶没治").toBeGreaterThanOrEqual(8);

    // 效果层齿③：单调爬坡的行，末日必须比首日"更满"（"哪天开始恶化"这件事读得出来）。
    expect(Number(dots[dots.length - 1]!.dataset.fill)).toBeGreaterThan(Number(dots[0]!.dataset.fill));

    // 效果层齿④：顶端压缩带里 tooltip 给未取整真值（97.95 与 97.55 都显示"张力98"，靠精确值区分）。
    expect(dots[24]).toHaveAttribute("title", expect.stringContaining("97.95"));
    expect(dots[29]).toHaveAttribute("title", expect.stringContaining("97.55"));
  });

  it("对照（诚实性红咬）：无逐日变化的行**不许**被伪造成起伏——恒定值行只有 1 档柱高", async () => {
    server.use(riskTimelineMock(), bottleneckMock());
    await openXinyangCard();

    const flatRow = await screen.findByTestId("risk-frow-换型损失");
    const bars = Array.from(flatRow.querySelectorAll<HTMLElement>("button"));
    expect(bars.length).toBe(FLAT_SERIES.length);
    const fills = new Set(bars.map((b) => b.dataset.fill));
    expect(fills.size, "逐日恒等的行被渲染出了起伏 = 伪造").toBe(1);
  });
});

describe("③ 选中态携真 objectId（不是 mock 形态）", () => {
  it("点风险卡 → selectedObjects 是 obj_base_<baseId>，不是 base-<中文名>", async () => {
    server.use(riskTimelineMock(), bottleneckMock());
    await openXinyangCard();

    await waitFor(() => expect(useSessionStore.getState().selectedObjects.length).toBe(1));
    const sel = useSessionStore.getState().selectedObjects[0]!;
    expect(sel.objectType).toBe("Base");
    // 真对象 id 形态（后端 synthetic/service.ts 的 `obj_${type}_${pk}`）。
    expect(sel.objectId).toBe("obj_base_xinyang");
    // mock fixture 形态一律不许出现（它在后端解析不出 → 对话坞会反问"请提供基地"）。
    expect(sel.objectId).not.toBe("base-信阳");
    expect(sel.objectId.startsWith("base-")).toBe(false);
    expect(sel.label).toBe("信阳");
  });
});
