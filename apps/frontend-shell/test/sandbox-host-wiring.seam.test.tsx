import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { ComponentType } from "react";
import { SIM_METRIC_SERIES_DEFAULT_LIMIT, type ChainLossMatrixResult, type ChainNodeDetail, type SimMetricSeriesResponse, type SimSession } from "@platform/contracts";
import { server } from "./setup";
import type { ViewConfigVM } from "@/api/types";
import type { ViewRendererProps } from "@/views/registry";
import SandboxHomeRoute from "@/views/sim/console/SandboxHomeRoute";
import SandboxDetailRoute from "@/views/sim/console/SandboxDetailRoute";
import SandboxAttrRoute from "@/views/sim/console/SandboxAttrRoute";
import SandboxOptRoute from "@/views/sim/console/SandboxOptRoute";
import { pickLatestRunningSession } from "@/views/sim/console/useConsoleSession";

/**
 * ══ WO-SIM-FE-HOST · 推演沙盘四页**宿主接线**的接缝门 ═══════════════════════════
 *
 * ── 病灶：今天的行为是 X，应该是 Y ─────────────────────────────────────────────
 *
 * **X（改造前实测）**：四个适配层 `Sandbox{Home,Detail,Attr,Opt}Route.tsx` 各自读
 * `view.options.sessionId` 并往下透 —— 线是接了的。但**全仓没有任何地方往 `view.options`
 * 里放这个值**：`grep -rn "sim-console\|sim-conduction\|sim-attribution\|sim-optimize"`
 * 在 `apps/datacore/src` · `apps/agentcore/src` · `packages/contracts/src` **零命中**
 * （金丝雀：同一条命令对确定存在的 `sim-sandbox` 有命中 ⇒ 工具没坏、是真没有），
 * 即后端 workspace 从不下发这四个 viewKey ⇒ `view.options` 恒 `undefined`
 * ⇒ 四页的取数 hook 全部 `enabled:false` ⇒ 一律落占位。
 * 这是本仓三态里的第二态：**接了线，线上没值**（不是"没接线"，修法完全不同）。
 *
 * **Y（应该）**：宿主没拿到显式指定时自己去查最近一条 RUNNING 会话，查到就透下去；
 * 查不到就**如实说"没有会话"**并保留占位 —— 而不是顺手建一个世界。
 *
 * ── 这道门咬的是**链路**不是函数 ───────────────────────────────────────────────
 * 每一条用例都**真渲染适配层**（`SandboxXxxRoute`，即 `registry.ts` 里注册的那个默认导出），
 * 让它自己发请求、自己落回，再读屏上的诚实位。**不测 `useConsoleSession` 的返回值** ——
 * 那是"测函数"，本仓记过的假绿第 9 形态（实现有、测试有、全绿、零链路证据）。
 *
 * ── ⚠ 各页的诚实位不是同一个属性，也不是同一条数据线（本门最容易被读错的地方）──
 *
 *   | 页 | 本单驱动的诚实位 | 由谁驱动 | 端点 |
 *   |---|---|---|---|
 *   | Home   | `[data-hot-source]`                     | `PerturbTree` 的扰动清单   | `GET …/:id/perturbations` |
 *   | Detail | `[data-testid=sandbox-detail]` `data-source`     | `useNodeDetail`      | `GET …/:id/node-detail`   |
 *
 * ⚠ **Detail 那一行自 WO-SIM-DETAIL-WIRE 起要两个入参，不是一个**：该端点的 `nodeId` 必填，
 *   宿主除了会话还得解析出落点节点（来自 `chain-loss-matrix`）才发得出这一跳。
 *   本文件的矩阵桩因此从 404 换成真形状 —— 见 `CHAIN_LOSS_MATRIX` 上的注释。
 *   「宿主组装参数 → 发请求 → 诚实位翻真」整条缝由 `sandbox-detail-args.seam.test.tsx` 咬。
 *   | Attr   | `[data-testid=sandbox-attr-series]` `data-source` | `useContributionSeries` | `GET …/:id/metric-series` |
 *   | Opt    | `[data-testid=sandbox-opt-grid]` `data-source`   | `useExecutionCompare`   | `GET …/:id/metric-series` |
 *
 * **Home 咬的是 `data-hot-source` 而不是甘特上的 `data-source`。**
 *
 * ⚠ **此处原来给的理由今天已过期，照实回写（`WO-SIM-STALE-3`）**。原文是：
 * 「甘特走 `useMetricSeries(sessionId)`，而该 hook 的函数体今天是
 * `void sessionId; return PLACEHOLDER` —— 它丢掉入参，`source` 是编译期常量 `"placeholder"`，
 * 宿主透任何值下去都翻不动它；若把断言写成『甘特的 data-source 变 endpoint』，
 * 这道门永远红且没人能修」。那是本单（`WO-SIM-FE-HOST`）交单当时的实测，**不再成立**：
 * `WO-SIM-FE-SERIES-WIRE` 已把该 hook 接到真端点 ——
 * `useMetricSeries()` → `api.a(metricSeriesPath(sessionId))`
 * → `GET /a/v1/sim/sessions/:id/metric-series`（后端 `apps/datacore/src/app.ts` 的该路由），
 * 入参真被读，那一位**今天真会翻 `endpoint`**。
 *
 * **今天仍咬 `data-hot-source` 的理由换成了「两门各咬一截、不叠」**：甘特那一位已有自己的
 * 专门接缝门 —— `metric-series-wire.seam.test.tsx` 用例 ①，同样真渲染 `SandboxHomeRoute`、
 * 同样咬到 `"endpoint"`。本门管的是**宿主选会话**这一段（`pickLatestRunningSession` →
 * 透 `sessionId`），左栏扰动清单是它最直接的下游，故探针留在 `data-hot-source`。
 * 下面 §1 表格里 Home 一行的「由谁驱动 / 端点」照旧准确，未改。
 *
 * 同理，Attr 的热矩阵 / 根因树 / 瀑布三格由 `so`（锚点订单号）驱动、Opt 的前沿图由
 * `paretoRequest` 驱动，**都与会话无关**，本单不负责送这两个值，故它们保持占位是**正常态**。
 *
 * R6 确定性：网络全桩、时间戳固定、无随机数、无真实时钟。
 */

// ══════════════════════════════════════════════════════════════════════════
// § 0 · 证物与桩
// ══════════════════════════════════════════════════════════════════════════

/** 每一条真发出去的请求（`method url`）。断言"没发 POST""打的是哪个 id"全靠它。 */
let seen: { method: string; url: string }[] = [];
const record = ({ request }: { request: Request }): void => {
  seen.push({ method: request.method, url: request.url });
};

const urlsMatching = (re: RegExp): string[] => seen.filter((r) => re.test(r.url)).map((r) => `${r.method} ${r.url}`);

const SESSION_LIST_RE = /\/a\/v1\/sim\/sessions(\?|$)/;

/**
 * 三条会话，刻意这样配：
 *  · `sims_ended` 是**最新**的一条，但状态 `ENDED` ⇒ 挑中它就说明「只认 RUNNING」这条没生效；
 *  · `sims_old` 与 `sims_running` 都是 RUNNING，后者更新 ⇒ 挑中前者说明「取最近」没生效。
 * 两个陷阱各堵一个方向；只放一条 RUNNING 的话，这两条规则一条都证明不了。
 */
const SESSION_OLD: SimSession = {
  id: "sims_old",
  tenantId: "demo",
  baseSnapshot: {},
  scope: {},
  status: "RUNNING",
  curTick: 1,
  parentCheckpointId: null,
  createdAt: "2026-08-01T00:00:00.000Z",
};
const SESSION_RUNNING: SimSession = { ...SESSION_OLD, id: "sims_running", curTick: 4, createdAt: "2026-08-20T00:00:00.000Z" };
const SESSION_ENDED: SimSession = { ...SESSION_OLD, id: "sims_ended", status: "ENDED", createdAt: "2026-08-21T00:00:00.000Z" };
const ALL_SESSIONS: SimSession[] = [SESSION_OLD, SESSION_RUNNING, SESSION_ENDED];

/** `GET …/:id/metric-series` 的回包。一条指标就够 —— 两个消费方都只要 `metrics.length > 0`。 */
const metricSeries = (sessionId: string): SimMetricSeriesResponse => ({
  sessionId,
  fromTick: 0,
  toTick: 2,
  ticks: [0, 1, 2],
  metrics: [
    {
      key: "obj_a1.loadIndex",
      objectId: "obj_a1",
      stateVar: "loadIndex",
      label: "负荷指数",
      labelIsFallback: false,
      unit: null,
      baseline: [10, 11, 12],
      actual: [10, 14, 19],
      segments: [{ fromTick: 0, toTick: 2, nodeId: "D06", label: "计划域", source: "domain", ruleKeys: ["r1"] }],
    },
  ],
  baselineOrigin: { sessionId, seedTick: 0, excludedPerturbationIds: [] },
  clamped: false,
  // 规模闸的诚实位（WO-SIM-SERIES-SCALE）：这个桩只有 1 条指标、且没被裁过 ⇒ 一共就这么多。
  totalMetrics: 1,
  truncated: false,
  appliedLimit: SIM_METRIC_SERIES_DEFAULT_LIMIT,
  appliedOrder: "magnitude",
});

/**
 * `GET …/:id/node-detail` 的回包 = 契约 `ChainNodeDetailSchema`。
 *
 * ⚠ **WO-SIM-DETAIL-WIRE 换掉了这份证物，换的是形状不是数值。**
 * 旧版这里放的是前端自己那份 `NodeDetailPayload`（clock/directions/filters/…），
 * 而端点真回的是 `{node, lots, route, missing, visibility}` —— **两者零个同名字段**。
 * 于是这道门三周来验的是「前端把自己编的形状喂给自己」，端点真接通时页面会在
 * `d.directions.map()` 上炸成白屏，而门照样绿。
 * 判据落在**契约**上（本对象逐字节满足 `ChainNodeDetailSchema`），不落在前端的私有接口上。
 */
const NODE_DETAIL: ChainNodeDetail = {
  node: {
    nodeId: "capacity.aging",
    label: "老化静置",
    stage: "CAPACITY",
    station: "老化站",
    nodeDays: 4,
    nodePct: 34,
    steps: [],
  },
  lots: [
    {
      lotNo: "LOT-SEAM-1",
      station: "老化站",
      batch: 3000,
      wip: 1200,
      takt: 30,
      yieldPct: 98,
      evidence: {
        lot: { objectType: "WIPLot", objectId: "LOT-SEAM-1", prop: "qty", value: 1200 },
        batch: null,
        takt: null,
        yield: null,
      },
    },
  ],
  route: { fromStation: "齐套站", toStation: "质检站", basis: "接缝桩：Operation.operationSeq 相邻工序" },
  missing: [],
  visibility: { visibleLineCount: 1, totalLineCount: 1, rowFilters: [] },
};

/**
 * 环节 × 基地 损失矩阵的回包。
 *
 * ⚠ **WO-SIM-DETAIL-WIRE 把这条桩从 `err(404)` 换成了真形状** —— 换的理由不是"为了让测试变绿"：
 * 传导识别页的落点节点（`nodeId`）现在由宿主从**这张矩阵**解析（口径同损失归因台
 * `SandboxAttr.tsx:74` 的 `heat.nodes[0]`），而 `GET …/:id/node-detail` 的 `nodeId` 是**必填**
 * （后端 `app.ts` 手写守卫，缺它必 400）。矩阵恒 404 ⇒ 解析不出落点 ⇒ 该页**按设计不发请求**
 * ⇒ 用例 ①④ 断言的 `data-source="endpoint"` 永远到不了。
 * 换句话说：旧桩连同旧断言一起，描述的是一个**请求发出去也只会 400** 的世界。
 *
 * 只放**一个**环节 / **一列**基地：本门咬的是"宿主把参数组装出来了没有"，不是矩阵的算术。
 */
const CHAIN_LOSS_MATRIX: ChainLossMatrixResult = {
  nodes: [{ nodeId: "capacity.aging", stage: "CAPACITY", label: "老化静置" }],
  bases: [{ baseId: "base_a", name: "甲基地" }],
  cells: [{ nodeId: "capacity.aging", baseId: "base_a", pct: 100, days: 4 }],
  rowTotals: [{ nodeId: "capacity.aging", days: 4, pctOfGrandLoss: 100, baseCount: 1 }],
  colTotals: [
    {
      baseId: "base_a",
      anchorSo: "SO-SEAM-1",
      anchorBaseId: "base_a",
      anchorAgingProcessId: "proc_seam_1",
      days: 4,
      sumPct: 100,
      cellCount: 1,
      missingNodeIds: [],
      reason: null,
      probe: null,
    },
  ],
  residual: { byBase: [{ baseId: "base_a", residualPct: 0, ok: true, reason: null }], rows: 0, rowsOk: true, tolerancePct: 0.5 },
  summary: "接缝桩：一环节 × 一基地",
};

/** 统一的错误信封（两系统同一份形状）。 */
const err = (status: number, code: string) =>
  HttpResponse.json({ error: { code, message: code, requestId: "req_seam" } }, { status });

/**
 * 会话表的**真状态**。`POST /a/v1/sim/sessions` 会把它推长 ——
 * 用例 ② 的「表没变长」因此是一句**可被证伪**的话，而不是对着一个恒空的数组自说自话。
 */
let sessionTable: SimSession[] = [];

function installHandlers(opts: { sessions?: SimSession[]; fail?: "list" | "data" } = {}): void {
  sessionTable = [...(opts.sessions ?? [])];
  server.use(
    // 建会话：本单**永远不该走到这里**。留着它是为了让"没建"这件事有可观测的反面。
    http.post("*/a/v1/sim/sessions", async () => {
      const s: SimSession = { ...SESSION_OLD, id: `sims_created_${sessionTable.length}`, status: "DRAFT" };
      sessionTable.push(s);
      return HttpResponse.json(s, { status: 201 });
    }),
    http.get("*/a/v1/sim/sessions", () =>
      opts.fail === "list" ? err(500, "INTERNAL") : HttpResponse.json({ items: sessionTable }),
    ),
    http.get("*/a/v1/sim/sessions/:id/metric-series", ({ params }) =>
      opts.fail === "data" ? err(500, "INTERNAL") : HttpResponse.json(metricSeries(String((params as { id: string }).id))),
    ),
    http.get("*/a/v1/sim/sessions/:id/node-detail", () =>
      opts.fail === "data" ? err(500, "INTERNAL") : HttpResponse.json(NODE_DETAIL),
    ),
    http.get("*/a/v1/sim/sessions/:id/perturbations", () =>
      opts.fail === "data" ? err(500, "INTERNAL") : HttpResponse.json({ items: [] }),
    ),
    // 环节 × 基地 损失矩阵：传导识别页的落点节点由它解析（理由见 `CHAIN_LOSS_MATRIX` 上的注释）。
    // `fail:"data"` 时连它一起挂掉 —— 用例 ③b 要的是"有会话但这一格没数据"，
    // 落点解析不出与端点 500 都归入同一句结论：屏上落占位、不白屏。
    http.post("*/a/v1/sim/chain-loss-matrix", () =>
      opts.fail === "data" ? err(500, "INTERNAL") : HttpResponse.json(CHAIN_LOSS_MATRIX),
    ),
    // 矩阵一旦是真数据，归因页的根因树就会去下钻（`useChainLossDrill`）。本门不咬子因，
    // 显式桩成 404 让它**确定性**落空，而不是靠 MSW 的未处理请求告警把整条用例打断。
    http.post("*/a/v1/sim/chain-loss-drill", () => err(404, "NOT_FOUND")),
  );
}

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 被测的四页（逐页断言，不抽查）
// ══════════════════════════════════════════════════════════════════════════

interface PageUnderTest {
  name: string;
  viewKey: string;
  Route: ComponentType<ViewRendererProps>;
  /** 页面主容器 —— 用例 ③ 断言它在 DOM 里（在 = 没白屏）。 */
  root: string;
  /** 本单接线驱动的诚实位所在元素。 */
  probe: string;
  /** 该元素上诚实位的属性名（Home 是 `data-hot-source`，理由见文件头）。 */
  attr: string;
  /** 该页拿到 sessionId 后会打的那条端点（用例 ④ 据此断言"打的是显式那个 id"）。 */
  endpoint: RegExp;
}

const PAGES: readonly PageUnderTest[] = [
  {
    name: "① 推演沙盘首页 sim-console",
    viewKey: "sim-console",
    Route: SandboxHomeRoute,
    root: '[data-testid="sandbox-home"]',
    probe: "[data-hot-source]",
    attr: "data-hot-source",
    endpoint: /\/perturbations$/,
  },
  {
    name: "② 传导识别页 sim-conduction",
    viewKey: "sim-conduction",
    Route: SandboxDetailRoute,
    root: '[data-testid="sandbox-detail"]',
    probe: '[data-testid="sandbox-detail"]',
    attr: "data-source",
    endpoint: /\/node-detail/,
  },
  {
    name: "③ 损失归因台 sim-attribution",
    viewKey: "sim-attribution",
    Route: SandboxAttrRoute,
    root: '[data-testid="sandbox-attr"]',
    probe: '[data-testid="sandbox-attr-series"]',
    attr: "data-source",
    endpoint: /\/metric-series$/,
  },
  {
    name: "④ 方案寻优台 sim-optimize",
    viewKey: "sim-optimize",
    Route: SandboxOptRoute,
    root: '[data-testid="sandbox-opt"]',
    probe: '[data-testid="sandbox-opt-grid"]',
    attr: "data-source",
    endpoint: /\/metric-series$/,
  },
];

const viewOf = (key: string, options?: Record<string, unknown>): ViewConfigVM => ({
  key,
  title: key,
  renderer: key,
  layout: undefined,
  options,
});

function mount(page: PageUnderTest, options?: Record<string, unknown>): HTMLElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={qc}>
      <page.Route view={viewOf(page.viewKey, options)} />
    </QueryClientProvider>,
  );
  return container;
}

const honestyBit = (root: HTMLElement, page: PageUnderTest): string | null =>
  root.querySelector(page.probe)?.getAttribute(page.attr) ?? null;

const hostReason = (root: HTMLElement): string | null =>
  root.querySelector('[data-testid="sandbox-console-host"]')?.getAttribute("data-session-reason") ?? null;

const hostSessionId = (root: HTMLElement): string | null =>
  root.querySelector('[data-testid="sandbox-console-host"]')?.getAttribute("data-session-id") ?? null;

// ══════════════════════════════════════════════════════════════════════════
// § 2 · 用例
// ══════════════════════════════════════════════════════════════════════════

describe("WO-SIM-FE-HOST · 沙盘四页宿主接线（接缝）", () => {
  beforeEach(() => {
    seen = [];
    server.events.on("request:start", record);
  });
  afterEach(() => {
    server.events.removeListener("request:start", record);
    cleanup();
  });

  it("⓪ 金丝雀：探针与选会话规则先自证（不中 ⇒ 报「工具坏了」，不许读作「接线对了」）", async () => {
    // (a) 选会话规则：两个陷阱各堵一个方向 —— 最新那条是 ENDED，最老那条也是 RUNNING。
    expect(pickLatestRunningSession(ALL_SESSIONS)?.id, "「取最近一条 RUNNING」这条规则本身就是错的").toBe(
      "sims_running",
    );
    expect(pickLatestRunningSession([SESSION_ENDED]), "一条 RUNNING 都没有时必须给 undefined").toBeUndefined();
    expect(pickLatestRunningSession([]), "空列表必须给 undefined").toBeUndefined();

    // (b) 请求记录器：先证明它**真的会记到东西**，否则下面每一条「没发 POST」都是空转。
    installHandlers({ sessions: [] });
    expect(seen, "记录器起点必须干净").toHaveLength(0);
    await fetch("http://a.test/a/v1/sim/sessions", { method: "POST", body: "{}" });
    expect(urlsMatching(SESSION_LIST_RE), "记录器一条都没记到 ⇒ 记录器坏了，不是「没发请求」").toHaveLength(1);
    expect(sessionTable, "POST 桩没把会话表推长 ⇒ 用例②的「表没变长」将恒真、等于没测").toHaveLength(1);

    // (c) 屏上探针：四页的探针选择器必须真能选到元素（选不到 ⇒ 下面读出来的恒 null，恒不等于
    //     "endpoint"，于是用例②会**因为错误的原因**变绿）。
    installHandlers({ sessions: ALL_SESSIONS });
    for (const page of PAGES) {
      const root = mount(page);
      await waitFor(() => expect(honestyBit(root, page), `${page.name} 的探针 ${page.probe} 选不到元素`).not.toBeNull());
      cleanup();
    }
  });

  it("① MSW 里有一条 RUNNING 会话 ⇒ 四页各自的诚实位翻 endpoint（逐页断言）", async () => {
    for (const page of PAGES) {
      installHandlers({ sessions: ALL_SESSIONS });
      seen = [];
      const root = mount(page);

      // 先等宿主定态再读诚实位：**顺序反过来会把「还没查完」读成「查完了」**。
      // （变异反证时实测：把 `data-source` 写死成 `"endpoint"` 后，诚实位在列表回来之前
      //   就已经是 `"endpoint"`，此刻 `hostReason` 还停在 `"loading"` —— 若先等诚实位，
      //   断言到的就是那个中间态。这一行的顺序是被那次变异逼出来的，别调回去。）
      await waitFor(() => expect(hostReason(root), `${page.name} 宿主没报 auto`).toBe("auto"));
      await waitFor(() => expect(honestyBit(root, page)).toBe("endpoint"));
      // 宿主透下去的正是最近那条 RUNNING（不是最新的 ENDED，也不是最老那条 RUNNING）。
      expect(hostSessionId(root), `${page.name} 透下去的不是最近那条 RUNNING`).toBe("sims_running");
      // 反向证据：这一位是**真发了请求**换来的，不是把常量改成了 "endpoint"。
      expect(urlsMatching(page.endpoint), `${page.name} 一条数据请求都没发出去`).not.toHaveLength(0);
      for (const u of urlsMatching(page.endpoint)) expect(u).toContain("sims_running");
      cleanup();
    }
  });

  it("② MSW 里零会话 ⇒ 四页仍是 placeholder，且**一个 POST 都没发**（会话表没变长）", async () => {
    for (const page of PAGES) {
      installHandlers({ sessions: [] });
      seen = [];
      const root = mount(page);

      // 先等宿主把列表查回来（否则可能停在 loading 上，断言到的是"还没查完"而不是"查完了没有"）。
      await waitFor(() => expect(hostReason(root)).toBe("no-running-session"));
      expect(honestyBit(root, page), `${page.name} 零会话时还报 endpoint`).toBe("placeholder");
      expect(hostSessionId(root), "零会话时不许透任何 id 下去").toBe("");

      // 硬约束①：打开页面**不许**建世界。两向都咬：会话集合上一个 POST 都没发 + 会话表长度没变。
      //
      // ⚠ 判据框在 `/a/v1/sim/sessions` 这个**集合**上，不是"所有 POST"——
      //    实测第一版写成 `/a\/v1\/sim\//` 当场被自己咬红（原文：
      //    `expected [ "POST http://a.test/a/v1/sim/chain-loss-matrix" ] to deeply equal []`）。
      //    `chain-loss-matrix` / `optimize-pareto` 是**求解器读**，用 POST 只因为要带 body，
      //    它们一个字节都不写库。把它们算进"写"里，本用例会因为一个与本单无关的读请求恒红 ——
      //    那是"我用『发了 POST』当作『写了库』的证据，而前者并不度量后者"。
      //    真正的写在 `/sim/sessions` 与 `/sim/sessions/:id/*`（建会话 / tick / act / 扰动 /
      //    存档 / 分叉），全部落在这个前缀里，一条不漏。
      const posts = seen.filter((r) => r.method === "POST" && /\/a\/v1\/sim\/sessions/.test(r.url));
      expect(posts.map((p) => `${p.method} ${p.url}`), `${page.name} 打开页面就往会话上写了东西`).toEqual([]);
      expect(sessionTable, `${page.name} 会话表变长了 ⇒ 有人偷偷建了会话`).toHaveLength(0);
      cleanup();
    }
  });

  it("③ 端点返 500 ⇒ 落占位不白屏，且分得出「没有会话」与「有会话但没数据」", async () => {
    // ③a 列表这一跳自己挂了 ⇒ 宿主报 unavailable（**不知道**有没有会话），四页落占位。
    for (const page of PAGES) {
      installHandlers({ sessions: ALL_SESSIONS, fail: "list" });
      const root = mount(page);
      await waitFor(() => expect(hostReason(root)).toBe("unavailable"));
      expect(root.querySelector(page.root), `${page.name} 主容器不在 DOM 里 = 白屏`).not.toBeNull();
      expect(honestyBit(root, page)).toBe("placeholder");
      cleanup();
    }

    // ③b 会话查得到、但数据端点 500 ⇒ 宿主仍报 auto（有会话），页面落占位（这一格没数据）。
    //    这两态**必须分得出** —— 只看 data-source 的话它们长得一模一样，那正是本单要消除的歧义。
    for (const page of PAGES) {
      installHandlers({ sessions: ALL_SESSIONS, fail: "data" });
      const root = mount(page);
      await waitFor(() => expect(hostReason(root)).toBe("auto"));
      await waitFor(() => expect(honestyBit(root, page)).toBe("placeholder"));
      expect(root.querySelector(page.root), `${page.name} 主容器不在 DOM 里 = 白屏`).not.toBeNull();
      expect(hostSessionId(root)).toBe("sims_running");
      cleanup();
    }
  });

  it("④ view.options.sessionId 显式给值 ⇒ 优先于自动查找，且**不发列表请求**", async () => {
    for (const page of PAGES) {
      installHandlers({ sessions: ALL_SESSIONS });
      seen = [];
      const root = mount(page, { sessionId: "sims_explicit" });

      await waitFor(() => expect(honestyBit(root, page)).toBe("endpoint"));
      expect(hostReason(root), `${page.name} 显式指定时宿主没报 explicit`).toBe("explicit");
      expect(hostSessionId(root)).toBe("sims_explicit");

      // 打的是显式那个 id，不是 MSW 里那条 RUNNING。
      const hits = urlsMatching(page.endpoint);
      expect(hits, `${page.name} 一条数据请求都没发`).not.toHaveLength(0);
      for (const u of hits) {
        expect(u, `${page.name} 请求打到了自动查找的那个 id`).toContain("sims_explicit");
        expect(u).not.toContain("sims_running");
      }
      // 显式给了就没必要再查列表 —— 一条列表请求都不该有。
      expect(urlsMatching(SESSION_LIST_RE), `${page.name} 显式给了 id 还去查会话列表`).toEqual([]);
      cleanup();
    }
  });
});
