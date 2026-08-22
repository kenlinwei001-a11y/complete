import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import {
  chainNodeDef,
  SIM_METRIC_SERIES_DEFAULT_LIMIT,
  SIM_METRIC_SERIES_MAX_LIMIT,
  type SimMetricSeriesResponse,
  type SimSession,
} from "@platform/contracts";
import { server } from "./setup";
import type { ViewConfigVM } from "@/api/types";
import SandboxHomeRoute from "@/views/sim/console/SandboxHomeRoute";
import { HOUR_TICKS, METRIC_GANTT_ROWS, projectMetricSeries } from "@/views/sim/console/useMetricSeries";
import styles from "@/views/sim/console/SandboxHome.module.css";

/**
 * ══ WO-SIM-FE-SERIES-WIRE · 指标甘特**真取数**的接缝门 ═══════════════════════════
 *
 * ── 病灶：今天的行为是 X，应该是 Y ─────────────────────────────────────────────
 *
 * **X（改造前实测原文，`useMetricSeries.ts:156-159`）**：
 * ```ts
 * export function useMetricSeries(sessionId?: string): MetricSeries {
 *   void sessionId;
 *   return PLACEHOLDER;
 * }
 * ```
 * 函数体**丢掉入参**，`PLACEHOLDER.source` 是**编译期常量** `"placeholder"`。
 * 上一张单（`WO-SIM-FE-HOST`）已把 `sessionId` 一路送到 `MetricGantt` 的门口，
 * 宿主透什么下来都翻不动这一位 —— 三态里的**第一态：没接线**。
 * 那张单的交单报告因此把「甘特的 `data-source` 翻 `endpoint`」明写成**做不到的那一格**，
 * 并改咬 `data-hot-source`（`sandbox-host-wiring.seam.test.tsx` 文件头原文）。
 *
 * **Y（本单落地）**：真调 `GET /a/v1/sim/sessions/:id/metric-series`，把回包投影成
 * `MetricSeries`，`source` 反映真实出身。**本门就是来收那一格的**。
 *
 * ── 这道门咬的是**链路**不是函数 ───────────────────────────────────────────────
 * 每一条用例都真渲染 `SandboxHomeRoute`（`registry.ts` 里注册的那个默认导出），
 * 让整条链自己跑：Route → `useConsoleSession` → `SandboxHome` → `MetricGantt`
 * → `useMetricSeries` → `api.a` → MSW，再**从屏上读**结果。
 * **不去断言 `useMetricSeries()` 的返回值** —— 那是"测函数"，本仓记过的假绿第 9 形态
 * （实现有、测试有、全绿、零链路证据）。
 *
 * ⚠ 唯一一处**直接调函数**的断言在用例 ④c，且理由写在那里：`MetricRow` 的签名本单冻结、
 *   它**没有逐格读数这一格**，所以"缺格没被就地插值补掉"这件事在屏上不可观测。
 *   把它写成链路断言只会得到一句证明不了任何事的空话。
 *
 * ── 尺子先自证（铁律 0.6）─────────────────────────────────────────────────────
 * 本文件用到三把可能骗人的尺子：① 列读取器（按 `MetricGantt` 的 5 列 grid 结构取列）·
 * ② 请求记录器 · ③ CSS Module 类名映射。用例 ⓪ 逐个先跑金丝雀 ——
 * 金丝雀不中就报「尺子坏了」，**不许**读作「接线对了」或「没发请求」。
 *
 * R6 确定性：网络全桩、时间戳固定、无随机数、无真实时钟。
 */

// ══════════════════════════════════════════════════════════════════════════
// § 0 · 证物与桩
// ══════════════════════════════════════════════════════════════════════════

/** 每一条真发出去的请求（`method url`）。用例 ② 的「一个请求都没发」全靠它。 */
let seen: { method: string; url: string }[] = [];
const record = ({ request }: { request: Request }): void => {
  seen.push({ method: request.method, url: request.url });
};
const urlsMatching = (re: RegExp): string[] => seen.filter((r) => re.test(r.url)).map((r) => `${r.method} ${r.url}`);

const SERIES_RE = /\/metric-series/;
const SESSION_LIST_RE = /\/a\/v1\/sim\/sessions(\?|$)/;

const SESSION_ID = "sims_wire";

/**
 * 一条 RUNNING 会话。宿主没拿到显式 id 时会挑它 —— 但本门**几乎全部走显式 id**
 * （`view.options.sessionId`），因为要断言的是甘特这一格，不是宿主怎么挑会话
 * （那是 `sandbox-host-wiring.seam.test.tsx` 的地盘，两道门不许互抄职责）。
 */
const SESSION: SimSession = {
  id: SESSION_ID,
  tenantId: "demo",
  baseSnapshot: {},
  scope: {},
  status: "RUNNING",
  curTick: 3,
  parentCheckpointId: null,
  createdAt: "2026-08-20T00:00:00.000Z",
};

type Metric = SimMetricSeriesResponse["metrics"][number];

/** 一条指标的骨架。各用例只覆盖自己关心的那几格，其余保持契约要求的完整形状。 */
const metric = (over: Partial<Metric> & Pick<Metric, "key" | "objectId" | "stateVar" | "label">): Metric => ({
  labelIsFallback: false,
  // 契约明写 `unit` **恒 `null`**（全仓没有"状态变量 → 单位"登记册）。
  // 桩里也写 `null`，否则测的就不是端点真会给的那个形状。
  unit: null,
  baseline: [null, null, null, null],
  actual: [null, null, null, null],
  segments: [],
  ...over,
});

/**
 * 在册链路环节 id（`source:"cadence"` 的取值域）。
 * 桩里**故意**给它一个错的 `label`（`"这不是站名"`），用来证明前端取的是**注册表**、
 * 不是回包那一份 —— 契约 §2.5「前端不另维护中文映射表，一律取注册表」的反向证据。
 */
const CADENCE_NODE = "material.kitting";
const CADENCE_LABEL = chainNodeDef(CADENCE_NODE)?.label ?? CADENCE_NODE;

/** 业务域键（`source:"domain"` 的取值域）不在链路册里 ⇒ 站名必须回落到回包的 `label`。 */
const DOMAIN_NODE = "D06";
const DOMAIN_LABEL = "计划域";

const response = (metrics: Metric[], over: Partial<SimMetricSeriesResponse> = {}): SimMetricSeriesResponse => ({
  sessionId: SESSION_ID,
  fromTick: 0,
  toTick: 3,
  ticks: [0, 1, 2, 3],
  metrics,
  baselineOrigin: { sessionId: SESSION_ID, seedTick: 0, excludedPerturbationIds: [] },
  clamped: false,
  // 规模闸的诚实位（WO-SIM-SERIES-SCALE）。默认桩 = 「一共就这么多、没裁过」；
  // 要测「回包超量」的用例自己在 `over` 里把 `totalMetrics`/`truncated` 翻过去。
  totalMetrics: metrics.length,
  truncated: false,
  appliedLimit: SIM_METRIC_SERIES_DEFAULT_LIMIT,
  appliedOrder: "magnitude",
  ...over,
});

/** 用例 ① 的三条指标：段的两种出身各一条 + 一条无段。 */
const THREE_METRICS: Metric[] = [
  metric({
    key: "obj_a.loadIndex",
    objectId: "obj_a",
    stateVar: "loadIndex",
    label: "负荷指数",
    baseline: [10, 11, 12, 13],
    actual: [10, 14, 17, 19],
    segments: [{ fromTick: 0, toTick: 1, nodeId: CADENCE_NODE, label: "这不是站名", source: "cadence", ruleKeys: ["r1"] }],
  }),
  metric({
    key: "obj_b.demandPressure",
    objectId: "obj_b",
    stateVar: "demandPressure",
    label: "需求压力",
    baseline: [8, 8, 8, 8],
    actual: [8, 7, 6, 5],
    segments: [{ fromTick: 2, toTick: 3, nodeId: DOMAIN_NODE, label: DOMAIN_LABEL, source: "domain", ruleKeys: ["r2"] }],
  }),
  metric({
    key: "obj_c.bufferDays",
    objectId: "obj_c",
    stateVar: "bufferDays",
    label: "缓冲天数",
    baseline: [4, 4, 4, 4],
    actual: [4, 4, 4, 4],
  }),
];

/** 统一错误信封（两系统同一份形状）。 */
const err = (status: number, code: string) =>
  HttpResponse.json({ error: { code, message: code, requestId: "req_seam" } }, { status });

interface StubOpts {
  /** 指标端点的回包；不给则按 `fail` 处理。 */
  body?: SimMetricSeriesResponse;
  /** 指标端点这一跳的失败码（404 / 500）。 */
  fail?: number;
  /** 会话列表里的会话（用例 ② 用空表把 `sessionId` 逼成 undefined）。 */
  sessions?: SimSession[];
}

function installHandlers(opts: StubOpts = {}): void {
  server.use(
    http.get("*/a/v1/sim/sessions", () => HttpResponse.json({ items: opts.sessions ?? [SESSION] })),
    http.get("*/a/v1/sim/sessions/:id/metric-series", () =>
      opts.body === undefined ? err(opts.fail ?? 500, "INTERNAL") : HttpResponse.json(opts.body),
    ),
    // 左栏 `PerturbTree` 的清单 —— 与本门无关，显式桩掉只为让它**确定性**落占位，
    // 而不是靠 MSW 的未处理请求告警（那会让噪声混进请求记录器）。
    http.get("*/a/v1/sim/sessions/:id/perturbations", () => HttpResponse.json({ items: [] })),
  );
}

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 屏上读数的尺子（列读取器）
// ══════════════════════════════════════════════════════════════════════════

const cls = (k: string): string => (styles as Record<string, string>)[k] as string;

const viewOf = (options?: Record<string, unknown>): ViewConfigVM => ({
  key: "sim-console",
  title: "sim-console",
  renderer: "sim-console",
  layout: undefined,
  options,
});

function mount(options?: Record<string, unknown>): HTMLElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={qc}>
      <SandboxHomeRoute view={viewOf(options)} />
    </QueryClientProvider>,
  );
  return container;
}

function ganttOf(root: HTMLElement): HTMLElement {
  const g = root.querySelector('[data-testid="sandbox-home-gantt"]');
  if (g === null) throw new Error("甘特不在 DOM 里 —— 尺子坏了（或页面白屏），不是数据不对");
  return g as HTMLElement;
}

const sourceOf = (root: HTMLElement): string | null => ganttOf(root).getAttribute("data-source");

/**
 * 甘特是 5 列 grid，列序照 `MetricGantt.tsx`：竖排域名 / 指标名称 / 基线 / 扰动后 / 轨道。
 * ⚠ 这是**结构耦合**，故用例 ⓪ 拿表头文字给它当金丝雀：列序一改，那里当场喊「尺子坏了」，
 *   而不是让下面每一条断言读到隔壁列还照样绿。
 */
const COL = { group: 0, name: 1, baseline: 2, after: 3, lane: 4 } as const;

const columnsOf = (g: HTMLElement): HTMLElement[] => Array.from(g.children) as HTMLElement[];

/** 某一列除表头（第 0 个子元素 `.gcap`）外的格子文本。 */
function cellTexts(g: HTMLElement, col: number): string[] {
  const c = columnsOf(g)[col];
  if (c === undefined) throw new Error(`甘特第 ${col} 列不存在 —— 尺子坏了`);
  return Array.from(c.children)
    .slice(1)
    .map((e) => (e.textContent ?? "").trim());
}

/** 轨道头的刻度文字（`laneHead` 是轨道列的第 0 个子元素）。 */
function laneTicks(g: HTMLElement): string[] {
  const head = columnsOf(g)[COL.lane]?.children[0];
  if (head === undefined) throw new Error("轨道头不在 DOM 里 —— 尺子坏了");
  return Array.from(head.children).map((e) => (e.textContent ?? "").trim());
}

/** 某一行轨道上的段（`data-testid=sandbox-home-gantt-row-<行名>`）。 */
function segmentsOf(root: HTMLElement, rowName: string): HTMLElement[] {
  const row = root.querySelector(`[data-testid="sandbox-home-gantt-row-${rowName}"]`);
  if (row === null) throw new Error(`轨道行「${rowName}」不在 DOM 里 —— 尺子坏了`);
  return Array.from(row.children) as HTMLElement[];
}

/** 等甘特把诚实位翻到某个值（真数据要过一个 RTT，同步读会读到中间态）。 */
const waitSource = (root: HTMLElement, want: string): Promise<void> =>
  waitFor(() => expect(sourceOf(root)).toBe(want));

// ══════════════════════════════════════════════════════════════════════════
// § 2 · 用例
// ══════════════════════════════════════════════════════════════════════════

describe("WO-SIM-FE-SERIES-WIRE · 指标甘特真取数（接缝）", () => {
  beforeEach(() => {
    seen = [];
    server.events.on("request:start", record);
  });
  afterEach(() => {
    server.events.removeListener("request:start", record);
    cleanup();
  });

  it("⓪ 金丝雀：三把尺子先自证（不中 ⇒ 报「尺子坏了」，不许读作「接线对了 / 没发请求」）", async () => {
    // (a) 请求记录器 —— 先证明它**真的会记到东西**，否则用例 ② 的「一条都没发」是空转。
    installHandlers({ body: response(THREE_METRICS) });
    expect(seen, "记录器起点必须干净").toHaveLength(0);
    await fetch(`http://a.test/a/v1/sim/sessions/${SESSION_ID}/metric-series`);
    expect(urlsMatching(SERIES_RE), "记录器一条都没记到 ⇒ 记录器坏了，不是「没发请求」").toHaveLength(1);

    // (b) 列读取器 —— 列序与表头必须对得上（`MetricGantt.tsx` 的 5 列 grid）。
    //     没有这一条，下面每一条读数断言都可能在读隔壁那一列，而且照样绿。
    seen = [];
    const root = mount({ sessionId: SESSION_ID });
    await waitSource(root, "endpoint");
    const g = ganttOf(root);
    expect(columnsOf(g), "甘特不是 5 列 ⇒ 列读取器坏了").toHaveLength(5);
    const caps = columnsOf(g).map((c) => (c.children[0]?.textContent ?? "").trim());
    expect([caps[COL.name], caps[COL.baseline], caps[COL.after]], "列序变了 ⇒ 列读取器坏了").toEqual([
      "指标名称",
      "基线",
      "扰动后",
    ]);

    // (c) CSS Module 类名映射 —— `styles.b` 这类取值必须真解析得出（vitest `css:false` 下是代理）。
    //     取不到时 `cls("b")` 是 undefined，段色断言会退化成「undefined === undefined」恒绿。
    for (const tone of ["b", "a", "o"]) expect(cls(tone), `类名映射取不到 .${tone} ⇒ 尺子坏了`).toBeTruthy();
  });

  it("① 有 sessionId + 正常回包 ⇒ source=endpoint，行数=指标数，ticks 逐格等于回包", async () => {
    const body = response(THREE_METRICS);
    installHandlers({ body });
    const root = mount({ sessionId: SESSION_ID });

    await waitSource(root, "endpoint");
    const g = ganttOf(root);

    // 反向证据：这一位是**真发了请求**换来的，不是把常量从 placeholder 改成了 endpoint。
    const hits = urlsMatching(SERIES_RE);
    expect(hits, "一条指标请求都没发出去").not.toHaveLength(0);
    for (const u of hits) expect(u).toContain(SESSION_ID);

    // 行数 = 指标数：**版面装得下的一条都不许砍**（无故切片会让屏上少几行而没有任何东西报错）。
    // ⚠ 这里 3 条 < 版面 12 行 ⇒ 全画。「装不下时怎么办」是另一条判据，见用例 ⑧。
    expect(body.metrics.length).toBeLessThanOrEqual(METRIC_GANTT_ROWS); // 金丝雀：本例确实在"装得下"这一侧
    expect(cellTexts(g, COL.name)).toHaveLength(body.metrics.length);
    expect(cellTexts(g, COL.name)).toEqual(body.metrics.map((m) => m.label));

    // 刻度逐格等于回包（后端给整型 tick ⇒ 屏上是它的字面量）。
    expect(laneTicks(g)).toEqual(body.ticks.map((t) => String(t)));
    // 且**确实不是**占位那套墙钟时刻 —— 否则上一条可能只是"两边恰好都是 4 条"。
    expect(laneTicks(g)).not.toEqual([...HOUR_TICKS]);

    // 读数取首末**有效**值，且**不带单位**（契约 `unit` 恒 null ⇒ 屏上不许出现「%」「天」）。
    expect(cellTexts(g, COL.baseline)).toEqual(["10", "8", "4"]);
    expect(cellTexts(g, COL.after)).toEqual(["19", "5", "4"]);
    for (const t of [...cellTexts(g, COL.baseline), ...cellTexts(g, COL.after)]) {
      expect(t, `读数「${t}」带上了编出来的单位`).toMatch(/^-?[\d.]+$/);
    }

    // 域名列**整列不给**（回包里没有"状态变量 → 业务域"的登记册，编一套就是新造口径）。
    expect(cellTexts(g, COL.group), "真数据模式下竖排域名列必须留空，不许硬派一套域名").toEqual([]);

    // 段色由回包的 `source` 决定，**不按数值大小自己分档**：
    //   cadence（建模方显式绑定）⇒ b · domain（按落域回落）⇒ a。两者不许合并。
    const cadenceSeg = segmentsOf(root, "负荷指数")[0];
    const domainSeg = segmentsOf(root, "需求压力")[0];
    expect(cadenceSeg?.className, "cadence 段没拿到蓝片").toContain(cls("b"));
    expect(domainSeg?.className, "domain 段没拿到琥珀片").toContain(cls("a"));
    expect(domainSeg?.className, "domain 与「出身不明」被合并成同一档了").not.toContain(cls("o"));

    // 段上的站名：在册环节取**注册表**（桩里那个错 label 必须被丢掉），非在册取回包 label。
    expect(cadenceSeg?.textContent).toContain(CADENCE_LABEL);
    expect(cadenceSeg?.textContent, "站名取了回包那一份 ⇒ 前端又维护了第二套映射").not.toContain("这不是站名");
    expect(domainSeg?.textContent).toContain(DOMAIN_LABEL);
  });

  it("② 没有 sessionId ⇒ 一条指标请求都不发，且 source 保持 placeholder", async () => {
    // 会话表空 ⇒ 宿主报 `no-running-session` ⇒ 透下去的 id 是 undefined。
    installHandlers({ body: response(THREE_METRICS), sessions: [] });
    const root = mount();

    // 先等宿主把列表查回来定态，再读诚实位 —— 顺序反过来会把「还没查完」读成「查完了」。
    await waitFor(() =>
      expect(root.querySelector('[data-testid="sandbox-console-host"]')?.getAttribute("data-session-reason")).toBe(
        "no-running-session",
      ),
    );
    expect(sourceOf(root), "没会话时甘特还报 endpoint").toBe("placeholder");

    // 硬约束：没有 id 就**不发那一跳**（不是发一个必然 404 的请求去换同一个结论）。
    expect(urlsMatching(SERIES_RE), "没有 sessionId 还是把指标请求发出去了").toEqual([]);
    // 反向证据：这一轮**确实在发请求**（列表那一跳发了），所以上一条不是"整个 MSW 没工作"。
    expect(urlsMatching(SESSION_LIST_RE), "这一轮一个请求都没发 ⇒ 记录器/渲染坏了").not.toHaveLength(0);

    // 落的是规格占位那 12 行 + 墙钟刻度。
    expect(laneTicks(ganttOf(root))).toEqual([...HOUR_TICKS]);
  });

  for (const status of [404, 500]) {
    it(`③ 端点返 ${status} ⇒ 落占位不抛异常，source=placeholder，页面不白屏`, async () => {
      installHandlers({ fail: status });
      const root = mount({ sessionId: SESSION_ID });

      await waitFor(() => expect(urlsMatching(SERIES_RE)).not.toHaveLength(0));
      await waitSource(root, "placeholder");
      // 不白屏：主容器与甘特都还在 DOM 里（抛出去的话这两个都不在）。
      expect(root.querySelector('[data-testid="sandbox-home"]'), "页面白屏了").not.toBeNull();
      expect(cellTexts(ganttOf(root), COL.name), "占位那 12 行没上屏").toHaveLength(12);
    });
  }

  it("④ 缺格不插值：首末有效值照取、整列全 null 显示「—」不是「0」", async () => {
    const GAP = metric({
      key: "obj_gap.loadIndex",
      objectId: "obj_gap",
      stateVar: "loadIndex",
      label: "缺格指标",
      baseline: [2, null, null, null],
      // 派单原文的构造：中间两格缺，末格是 4。
      actual: [1, null, null, 4],
    });
    const ALL_NULL = metric({
      key: "obj_null.demandPressure",
      objectId: "obj_null",
      stateVar: "demandPressure",
      label: "全空指标",
    });
    const SINGLE = metric({
      key: "obj_one.bufferDays",
      objectId: "obj_one",
      stateVar: "bufferDays",
      label: "单锚指标",
      baseline: [null, 2.5, null, null],
      actual: [null, null, 7, null],
    });
    const body = response([GAP, ALL_NULL, SINGLE]);
    installHandlers({ body });
    const root = mount({ sessionId: SESSION_ID });

    await waitSource(root, "endpoint");
    const g = ganttOf(root);
    expect(cellTexts(g, COL.name)).toEqual(["缺格指标", "全空指标", "单锚指标"]);

    // ④a 首末**有效**值：`after` 取到回包里真有的那个 4，不是从 [1,…,4] 插出来的中间值；
    //     `baseline` 取到 2（首格），尾部三格全缺**不外推**。
    expect(cellTexts(g, COL.baseline)[0]).toBe("2");
    expect(cellTexts(g, COL.after)[0]).toBe("4");

    // ④b 整列全 `null` ⇒ 两格都显示 `—`。**不是 `0`** ——
    //     「这个世界里没有这一格」与「这一格是 0」是两件事（契约 `SimStateDiffCell` 已为此立过账）。
    expect(cellTexts(g, COL.baseline)[1]).toBe("—");
    expect(cellTexts(g, COL.after)[1]).toBe("—");
    expect(cellTexts(g, COL.baseline)[1], "整列全 null 被读成 0").not.toBe("0");
    expect(cellTexts(g, COL.after)[1], "整列全 null 被读成 0").not.toBe("0");

    // ④c 单锚：唯一那一格有效值就是答案，两端缺格**不外推**（外推出来的数与实测长得一模一样）。
    expect(cellTexts(g, COL.baseline)[2]).toBe("2.5");
    expect(cellTexts(g, COL.after)[2]).toBe("7");

    // ④d 中间那两格**仍然是 `null`** —— 投影不许把缺格就地补掉。
    //     ⚠ 这一条是本文件**唯一**直接调函数的断言，理由：`MetricRow` 只有首末两格读数、
    //       没有逐格序列（签名本单冻结），所以"中间两格还在不在"在屏上**不可观测**。
    //       写成链路断言只会得到一句证明不了任何事的空话，那比直说做不到更糟。
    const probe = response([
      metric({
        key: "obj_gap.loadIndex",
        objectId: "obj_gap",
        stateVar: "loadIndex",
        label: "缺格指标",
        baseline: [2, null, null, null],
        actual: [1, null, null, 4],
      }),
    ]);
    const before = JSON.stringify(probe);
    projectMetricSeries(probe);
    expect(probe.metrics[0]?.actual, "缺格被就地插值补掉了").toEqual([1, null, null, 4]);
    expect(probe.metrics[0]?.baseline, "缺格被就地插值补掉了").toEqual([2, null, null, null]);
    expect(JSON.stringify(probe), "投影把回包改了 —— 它必须是纯函数").toBe(before);
  });

  // ⑤ = **变异反证**，是收工前手跑的一道工序（把 ④ 的缺格改成线性插值，确认 ④ 当场红），
  //    不是一条常驻用例 —— 常驻的话它要么恒绿（没变异）、要么恒红（留着变异），两头都没意义。
  //    红的原文贴在交单报告里。下面这条是本单第五条硬约束（播放头）的常驻门。
  it("⑥ 播放头由 ticks 里当前格的位置算，不是墙钟；当前格不在窗口里 ⇒ 置 0", async () => {
    // 本 hook 不发 `from`/`to` ⇒ 后端 `to` 默认取 `curTick` ⇒ `toTick` 就是末格 ⇒ 播放头贴右。
    installHandlers({ body: response(THREE_METRICS) });
    const root = mount({ sessionId: SESSION_ID });
    await waitSource(root, "endpoint");
    const play = columnsOf(ganttOf(root))[COL.lane]?.lastElementChild as HTMLElement | null;
    expect(play?.style.left, "播放头没落在当前格上").toBe("100%");

    // `toTick` 落在窗口之外（回包自相矛盾）⇒ **置 0**，不猜一个位置出来。
    const odd = response(THREE_METRICS, { toTick: 99 });
    expect(projectMetricSeries(odd).playheadPct, "当前格找不到时不许猜位置").toBe(0);
    // 且与墙钟无关：同一个回包投两次，逐字节相同（拿 Date.now() 算的话这里会漂）。
    expect(projectMetricSeries(odd)).toEqual(projectMetricSeries(odd));
  });

  // ══════════════════════════════════════════════════════════════════════════
  // WO-SIM-SERIES-SCALE · 规模闸的前端这一半
  // ══════════════════════════════════════════════════════════════════════════
  /**
   * ── 病灶（真浏览器实测，非 mock）─────────────────────────────────────────────
   * 本 hook 原先**不带任何裁剪入参**地打 `GET …/metric-series`。生产量级世界
   * （`deriveBaseSnapshot(view-config)` = 11,348 对象 × 36 状态变量）下端点回
   * **408,528 条 / 116,859,540 字节**：
   * ```
   * REQ +5609ms GET /a/v1/sim/sessions/<sid>/metric-series
   * （等到 +20000ms 仍无 response）
   * data-testid=sandbox-home-gantt 的 data-source = "placeholder"
   * ```
   * ⇒ 首页甘特**永远**是规格占位数，**且屏上不报错** —— 静默错答。
   *
   * ⚠ **为什么 mock 测不出那个病，这两条却仍然值得写**：MSW 桩里回 3 条还是 40 万条，
   *   屏上都是瞬间的，**规模本身在这一层不可观测**。所以这两条咬的不是"快不快"，
   *   而是那个病的**两个可观测因**：① 请求到底带没带 `limit`（带了，服务器才不会去算全量）；
   *   ② 万一回包仍然超量（缓存共用 / 别的调用方先进场），屏上会不会被撑爆。
   *   "回包规模真的降下来了"那一半由 datacore 侧的生产量级用例咬（`metric-series.seam.test.ts`
   *   的 WO-SIM-SERIES-SCALE 组），两半合起来才是完整判据 —— 各半单独看都不够。
   */
  it("⑦ 请求必须带 limit（= 版面行数，不是硬写的数字）与 order；且**不带** from/to（否则播放头那条推理失效）", async () => {
    installHandlers({ body: response(THREE_METRICS) });
    const root = mount({ sessionId: SESSION_ID });
    await waitSource(root, "endpoint");

    const hits = urlsMatching(SERIES_RE);
    expect(hits, "一条指标请求都没发出去 ⇒ 下面每一条都是空转").not.toHaveLength(0);
    for (const u of hits) {
      const q = new URL(u.slice(u.indexOf("http"))).searchParams;
      // 🔴 核心：带 `limit`，且它**等于版面行数**（`SPEC_ROWS.length` 单一出处派生）。
      expect(q.get("limit"), `请求没带 limit：${u}`).toBe(String(METRIC_GANTT_ROWS));
      expect(q.get("order"), `请求没带 order：${u}`).toBe("magnitude");
      // 不带窗口参数 —— `playheadPctOf` 的「toTick === curTick」推理只在这个前提下成立。
      expect(q.get("from"), "带上了 from ⇒ 播放头那条推理当场失效").toBeNull();
      expect(q.get("to"), "带上了 to ⇒ 播放头那条推理当场失效").toBeNull();
    }

    // 金丝雀：版面行数与服务端默认值**必须相等** —— 三个消费方共用一个 React Query 缓存键，
    // 只有本 hook 带参数，两者不等的话谁先进场谁定这份缓存，屏上行数会随进场顺序变。
    expect(METRIC_GANTT_ROWS, "版面行数与服务端默认 limit 脱钩了 ⇒ 共用缓存不再自洽").toBe(
      SIM_METRIC_SERIES_DEFAULT_LIMIT,
    );
    // 且版面行数必须落在硬上限之内（否则前端要的那批服务端根本给不全）。
    expect(METRIC_GANTT_ROWS).toBeLessThanOrEqual(SIM_METRIC_SERIES_MAX_LIMIT);
  });

  it("⑧ 回包超量（版面 12 行、回 17 条）⇒ 屏上只画 12 行，画的是**前 12 条**（服务端已排过序），且屏上不新增任何提示文字", async () => {
    const OVER = METRIC_GANTT_ROWS + 5;
    const many = Array.from({ length: OVER }, (_, i) =>
      metric({
        key: `obj_${i}.loadIndex`,
        objectId: `obj_${i}`,
        stateVar: "loadIndex",
        // 每行一个**不同**的 label：撞名会走 `rowNames` 的消歧分支，那时断言读的就不是本条要验的东西。
        label: `指标${String(i).padStart(2, "0")}`,
        baseline: [i, i, i, i],
        actual: [i * 2, i * 2, i * 2, i * 2],
      }),
    );
    // 回包如实声明「一共 17 条、被裁过」—— 前端不因这两位改变渲染，但它们必须在回包里。
    installHandlers({ body: response(many, { totalMetrics: 999, truncated: true }) });
    const root = mount({ sessionId: SESSION_ID });
    await waitSource(root, "endpoint");
    const g = ganttOf(root);

    // 金丝雀：桩确实超量了（`OVER > METRIC_GANTT_ROWS`），否则这条在"没超量"上空转全绿。
    expect(OVER).toBeGreaterThan(METRIC_GANTT_ROWS);

    // 🔴 判据：**屏上不渲染超量行**。多出来的 5 行不许把版面撑破。
    const names = cellTexts(g, COL.name);
    expect(names, `屏上画了 ${names.length} 行，版面只有 ${METRIC_GANTT_ROWS} 行`).toHaveLength(METRIC_GANTT_ROWS);
    // 且留下的是**前 12 条**（服务端已按 order 排过序，前端不许自己再挑一遍）。
    expect(names).toEqual(many.slice(0, METRIC_GANTT_ROWS).map((m) => m.label));
    // 反向证据：被裁掉的那几条**真的没上屏**（否则上一条可能只是"恰好前 12 个名字对上"）。
    for (const m of many.slice(METRIC_GANTT_ROWS)) {
      expect(names, `被裁掉的 ${m.label} 仍然出现在屏上`).not.toContain(m.label);
    }
    // 三列等长 —— 只砍名字列而读数列没砍的话，行与读数会整体错位（比少几行更糟）。
    expect(cellTexts(g, COL.baseline)).toHaveLength(METRIC_GANTT_ROWS);
    expect(cellTexts(g, COL.after)).toHaveLength(METRIC_GANTT_ROWS);

    // ⛔ 像素级约束：**屏上不许新增任何描述性文字**（四页与规格逐像素 1:1）。
    //    「被裁了多少」这件事诚实地记在**回包**的 totalMetrics/truncated 上，不上屏。
    const shown = g.textContent ?? "";
    for (const word of ["截断", "已裁", "更多", "省略", "共 999", "truncated"]) {
      expect(shown, `屏上出现了本单不许加的提示文字「${word}」`).not.toContain(word);
    }
    // 诚实位仍然只走既有的 `data-source` 属性族（真数据 ⇒ endpoint，不是新造第三态）。
    expect(sourceOf(root)).toBe("endpoint");
  });
});
