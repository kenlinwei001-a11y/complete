import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import {
  SIM_METRIC_SERIES_DEFAULT_LIMIT,
  daysForTicks,
  ticksForDays,
  type SimMetricSeriesResponse,
  type SimSession,
} from "@platform/contracts";
import { server } from "./setup";
import type { ViewConfigVM } from "@/api/types";
import SandboxHomeRoute from "@/views/sim/console/SandboxHomeRoute";
import SandboxAttrRoute from "@/views/sim/console/SandboxAttrRoute";
import SandboxOptRoute from "@/views/sim/console/SandboxOptRoute";
import { HOUR_TICKS } from "@/views/sim/console/useMetricSeries";

/**
 * ══ WO-SIM-CONSOLE-DAYS · 「会话的 `tickDays` → 屏上标签」的接缝门 ═══════════════
 *
 * ── 病灶：今天的行为是 X，应该是 Y（本单开工前实测）───────────────────────────
 *
 * **X（改造前实测原文，三处逐字节相同）**：
 * ```ts
 * ticks: ticks.map((t) => String(t))       // useMetricSeries.ts:412   （首页·指标甘特）
 * ticks: ticks.map((t) => String(t))       // useLossAttribution.ts:699（归因台·环节序列）
 * ticks: res.ticks.map((t) => String(t))   // useParetoFrontier.ts:738 （寻优台·执行对比）
 * ```
 * 用户在沙盘输「推演 30 天」，屏上写的是 tick 序号 `0 1 2 …`。
 * `tickDays > 1` 时更错：5 个 tick 其实是 35 天，屏上写着 `0..4`。
 *
 * **Y（本单落地）**：三处统一经 `tickAxis.ts` 换算（它再往下转调契约的 `daysForTicks`），
 * 屏上按**天**说话；会话拿不到 `tickDays` 时退回「第 N 拍」并**不猜天数**。
 *
 * ── 这道门咬的是**链路**不是函数 ───────────────────────────────────────────────
 * 每条用例都**真渲染适配层**（`SandboxXxxRoute`，`registry.ts` 注册的那个默认导出），
 * 让它自己去查会话列表、自己发 `metric-series`、再读**屏上的刻度文字**。
 * **不测 `tickAxisLabels()` 的返回值** —— 那是"测函数"，本仓记过的假绿第 9 形态
 * （实现有、测试有、全绿、零链路证据）。本门要的是这一整条：
 *
 *   `GET /a/v1/sim/sessions` 的 `tickDays`
 *     → `pickLatestRunningSession` → `ConsoleSession.tickDays`
 *     → `Sandbox{Home,Attr,Opt}` → 三个 hook → `tickAxisLabels`
 *     → 轨道头 `<span>` 的 `textContent`
 *
 * 任何一环断掉（宿主不透、hook 不收、组件不传），末端文字就回到裸序号 ⇒ 本门红。
 *
 * ── ⚠ 为什么 `tickDays=7` 那一臂才是本单的标的 ─────────────────────────────────
 * `tickDays=1` 时「第 N 天」与「第 N 拍」的**数字部分恰好相同** ⇒ 一个完全无视 `tickDays`、
 * 只把序号套进「第 _ 天」模板的实现，在那一臂上照样绿。
 * 只测 `tickDays=1` 等于什么都没测。故 §2 的每一页都跑**两臂**，并额外咬一句
 * 「同一份回包、两个不同 `tickDays` ⇒ 屏上必须不同」——
 * 这一句是**对实现无知**的：它不认标签长什么样，只认「口径真的进了换算」。
 *
 * R6 确定性：网络全桩、无随机数、无真实时钟。
 */

// ══════════════════════════════════════════════════════════════════════════
// § 0 · 证物与桩
// ══════════════════════════════════════════════════════════════════════════

/** 用户在沙盘里输的那个数。本单的整条链路就是为它服务的。 */
const HORIZON_DAYS = 30;

const SESSION_ID = "sims_days";

/**
 * 会话桩。`tickDays` 由各用例给 —— 它就是本门唯一的自变量。
 *
 * ⚠ `status` 必须是 `RUNNING`：`useConsoleSession` 只认 RUNNING（`DRAFT`/`ENDED` 会被跳过），
 * 挑不中就没有会话对象 ⇒ `tickDays` 恒 `undefined` ⇒ 两臂都落「第 N 拍」、**两臂同样红**，
 * 而红的原因与本单无关。用例 ⓪ 的金丝雀先把这一条钉死。
 */
const sessionWith = (tickDays?: number): SimSession => ({
  id: SESSION_ID,
  tenantId: "demo",
  baseSnapshot: {},
  scope: {},
  status: "RUNNING",
  curTick: 0,
  parentCheckpointId: null,
  ...(tickDays === undefined ? {} : { tickDays }),
  createdAt: "2026-08-25T00:00:00.000Z",
});

/**
 * `GET …/:id/metric-series` 的回包。
 *
 * **`ticks` 由 `ticksForDays` 现算，不手写** —— 手写就是在测试里另立一套「30 天等于几拍」的
 * 口径，而那正是本单要消灭的第二套真相源。回包形状同后端：走 N 拍之后 `ticks = [0..N]`
 * （出处见 `useMetricSeries.ts` 头注的真后端实测：走两拍 ⇒ `ticks=[0,1,2]`、`toTick=2`）。
 */
function seriesFor(tickDays: number): SimMetricSeriesResponse {
  const n = ticksForDays(HORIZON_DAYS, tickDays);
  const ticks = Array.from({ length: n + 1 }, (_, i) => i);
  return {
    sessionId: SESSION_ID,
    fromTick: 0,
    toTick: n,
    ticks,
    metrics: [
      {
        key: "obj_a.loadIndex",
        objectId: "obj_a",
        stateVar: "loadIndex",
        label: "负荷指数",
        labelIsFallback: false,
        unit: null,
        baseline: ticks.map(() => 10),
        actual: ticks.map((t) => 10 + t),
        segments: [
          { fromTick: 0, toTick: n, nodeId: "D06", label: "计划域", source: "domain", ruleKeys: ["r1"] },
        ],
      },
    ],
    baselineOrigin: { sessionId: SESSION_ID, seedTick: 0, excludedPerturbationIds: [] },
    clamped: false,
    totalMetrics: 1,
    truncated: false,
    appliedLimit: SIM_METRIC_SERIES_DEFAULT_LIMIT,
    appliedOrder: "magnitude",
  };
}

const err = (status: number, code: string) =>
  HttpResponse.json({ error: { code, message: code, requestId: "req_days" } }, { status });

/**
 * 装桩。`sessions` 为空数组时列表回空 ⇒ 宿主报 `no-running-session`（用例 ⓪ 的反面样例用）。
 *
 * 归因台 / 寻优台还会打各自的旁路端点；它们与本门无关，**显式桩掉**让它们确定性落空，
 * 而不是靠 MSW 的未处理请求告警把用例打断。
 */
function installHandlers(sessions: SimSession[], tickDays: number): void {
  server.use(
    http.get("*/a/v1/sim/sessions", () => HttpResponse.json({ items: sessions })),
    http.get("*/a/v1/sim/sessions/:id/metric-series", () => HttpResponse.json(seriesFor(tickDays))),
    http.get("*/a/v1/sim/sessions/:id/perturbations", () => HttpResponse.json({ items: [] })),
    http.post("*/a/v1/sim/chain-loss-matrix", () => err(404, "NOT_FOUND")),
    http.post("*/a/v1/sim/chain-loss-drill", () => err(404, "NOT_FOUND")),
    http.post("*/a/v1/simulation/impact-analysis", () => err(404, "NOT_FOUND")),
  );
}

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 被测的三页（逐页断言，不抽查）
// ══════════════════════════════════════════════════════════════════════════

/**
 * ⚠ **`SandboxDetail`（传导识别页）不在本门里，这是实测结论不是遗漏。**
 * 它屏上那条时间带的刻度 `["01:20","01:30",…]`（`SandboxDetail.tsx:138`）在
 * `PLACEHOLDER_NODE_DETAIL` 里写死，**没有任何端点会替换它**
 * （复验：`grep -n "strip" SandboxDetailRoute.tsx` 零命中 ⇒ 宿主一个字都没往里塞）。
 * 且它是**墙钟时刻**口径（同一条带上并排的是 `76.86KM` 与 `阻滞时间 24:42`），
 * 压根不是 tick 序号 —— 拿天去换算等于把规格占位改成假数据。
 * 同理 `ImpactCone.tsx:51` 的 `["400","300","200","100"]` 是扇区图的**纵轴量级刻度**，
 * 与时间无关（`projectImpactCone` 只覆盖 `impacts` 与 `provenance` 两格，`ticks` 原样带过）。
 */
interface PageUnderTest {
  name: string;
  viewKey: string;
  Route: typeof SandboxHomeRoute;
  /** 轨道头容器（刻度 `<span>` 的父元素）。 */
  lane: string;
  /** 该页的数据出身诚实位所在元素 —— 先等它翻 `endpoint` 再读刻度。 */
  probe: string;
}

const PAGES: readonly PageUnderTest[] = [
  {
    name: "① 推演沙盘首页 sim-console · 指标甘特",
    viewKey: "sim-console",
    Route: SandboxHomeRoute,
    lane: '[data-testid="sandbox-home-gantt"] > div:last-of-type > div:first-child',
    probe: '[data-testid="sandbox-home-gantt"]',
  },
  {
    name: "② 损失归因台 sim-attribution · 环节序列",
    viewKey: "sim-attribution",
    Route: SandboxAttrRoute,
    lane: '[data-testid="sandbox-attr-series"] > div:last-of-type > div:first-child',
    probe: '[data-testid="sandbox-attr-series"]',
  },
  {
    name: "③ 方案寻优台 sim-optimize · 执行对比",
    viewKey: "sim-optimize",
    Route: SandboxOptRoute,
    lane: '[data-testid="sandbox-opt-grid"] > div:last-of-type > div:first-child',
    probe: '[data-testid="sandbox-opt-grid"]',
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

/** 轨道头上每一格刻度的**屏上文字**。本门读的就是这一列，不读任何中间变量。 */
function laneTicks(root: HTMLElement, page: PageUnderTest): string[] {
  const head = root.querySelector(page.lane);
  if (head === null) throw new Error(`${page.name} 的轨道头选不到（${page.lane}）—— 尺子坏了`);
  return Array.from(head.children).map((e) => (e.textContent ?? "").trim());
}

const probeAttr = (root: HTMLElement, page: PageUnderTest, name: string): string | null =>
  root.querySelector(page.probe)?.getAttribute(name) ?? null;

/** 等这一页真拿到端点数据再读刻度（顺序反过来会把「还没查完」读成「查完了」）。 */
async function waitEndpoint(root: HTMLElement, page: PageUnderTest): Promise<void> {
  await waitFor(() => expect(probeAttr(root, page, "data-source"), `${page.name} 没翻到 endpoint`).toBe("endpoint"));
}

// ══════════════════════════════════════════════════════════════════════════
// § 2 · 用例
// ══════════════════════════════════════════════════════════════════════════

describe("WO-SIM-CONSOLE-DAYS · 会话 tickDays → 屏上按天的轴标签（接缝）", () => {
  afterEach(() => cleanup());
  beforeEach(() => installHandlers([sessionWith(1)], 1));

  it("⓪ 金丝雀：三把尺子先自证（不中 ⇒ 报「尺子坏了」，不许读作「组件没渲染」）", async () => {
    // (a) 换算这一头：契约的两个函数在本门用的那组实参上确实是这个答案。
    //     它们若不成立，下面每一条期望值都建立在一个错的算术上。
    expect(ticksForDays(30, 1), "30 天 / 一拍一天 = 30 拍").toBe(30);
    expect(ticksForDays(30, 7), "30 天 / 一拍七天 = ceil(30/7) = 5 拍").toBe(5);
    expect(daysForTicks(30, 1), "第 30 拍 · 一拍一天 = 第 30 天").toBe(30);
    expect(daysForTicks(5, 7), "第 5 拍 · 一拍七天 = 第 35 天（ceil 天然过冲，不许在屏上抹平）").toBe(35);

    // (b) 桩这一头：回包的刻度条数真的随 tickDays 变。
    //     两臂若拿到同样长的 ticks，第二臂就退化成第一臂的复读。
    expect(seriesFor(1).ticks).toHaveLength(31);
    expect(seriesFor(7).ticks).toHaveLength(6);

    // (c) 屏上探针：三页的轨道头选择器必须**真能选到东西**，且选到的是刻度不是空壳。
    //     选不到 ⇒ 下面读出来恒 `[]`，恒不等于期望值 —— 那是尺子坏了，不是接线错了。
    for (const page of PAGES) {
      installHandlers([sessionWith(1)], 1);
      const root = mount(page);
      await waitEndpoint(root, page);
      expect(laneTicks(root, page), `${page.name} 的轨道头一格刻度都没有 ⇒ 尺子坏了`).not.toHaveLength(0);
      cleanup();
    }

    // (d) 反面样例：一条 RUNNING 都没有时，宿主拿不到会话 ⇒ 三页落**规格占位**那套墙钟刻度。
    //     这一条同时钉死「占位模式一格都不走换算」：`HOUR_TICKS` 必须原样在屏上。
    installHandlers([], 1);
    const home = PAGES[0] as PageUnderTest;
    const root = mount(home);
    await waitFor(() =>
      expect(root.querySelector('[data-testid="sandbox-console-host"]')?.getAttribute("data-session-reason")).toBe(
        "no-running-session",
      ),
    );
    expect(probeAttr(root, home, "data-source"), "没有会话时不该是 endpoint").toBe("placeholder");
    expect(laneTicks(root, home), "占位模式的墙钟刻度被换算动过了 —— 那是规格占位，不是 tick").toEqual([
      ...HOUR_TICKS,
    ]);
  });

  it("① tickDays=1 · 推演 30 天 ⇒ 三页轨道头都按天说话，末格是「第 30 天」", async () => {
    for (const page of PAGES) {
      installHandlers([sessionWith(1)], 1);
      const root = mount(page);
      await waitEndpoint(root, page);

      const ticks = laneTicks(root, page);
      // 宿主真把口径透下去了（诚实位 `day`，不是「没问过」的 `tick`）。
      expect(probeAttr(root, page, "data-tick-unit"), `${page.name} 的轴口径没翻到 day`).toBe("day");
      expect(
        root.querySelector('[data-testid="sandbox-console-host"]')?.getAttribute("data-tick-days"),
        `${page.name} 宿主没把 tickDays 透下去`,
      ).toBe("1");

      // 末格 = 用户输的那个数。**这是本单要的那句话**。
      expect(ticks[ticks.length - 1], `${page.name} 末格不是第 ${HORIZON_DAYS} 天`).toBe(`第 ${HORIZON_DAYS} 天`);
      // 且**每一格**都说人话 —— 不许只把末格做对、中间还是裸序号。
      for (const t of ticks) expect(t, `${page.name} 刻度「${t}」不说人话`).toMatch(/^第 \d+ 天$/);
      // 反面：**确实不是**裸 tick 序号（否则上一条可能只是"恰好都是 31 格"）。
      expect(ticks, `${page.name} 屏上还是 tick 序号`).not.toEqual(seriesFor(1).ticks.map(String));
      cleanup();
    }
  });

  it("② tickDays=7 · 推演 30 天（= 5 拍）⇒ 屏上仍以天为单位，不是 0..5", async () => {
    // 本单的标的。`tickDays=1` 那一臂上「第 N 天」与「第 N 拍」数字部分相同 ⇒
    // 一个无视 tickDays 的实现在那里照样绿；只有这一臂能把它抖出来。
    const body = seriesFor(7);
    const lastDay = daysForTicks(body.ticks[body.ticks.length - 1] as number, 7);

    for (const page of PAGES) {
      installHandlers([sessionWith(7)], 7);
      const root = mount(page);
      await waitEndpoint(root, page);

      const ticks = laneTicks(root, page);
      expect(probeAttr(root, page, "data-tick-unit"), `${page.name} 的轴口径没翻到 day`).toBe("day");
      expect(
        root.querySelector('[data-testid="sandbox-console-host"]')?.getAttribute("data-tick-days"),
        `${page.name} 宿主透的 tickDays 不是 7`,
      ).toBe("7");

      // 单位仍是天（**不是**「第 4 拍」，更不是裸 `4`）。
      for (const t of ticks) expect(t, `${page.name} 刻度「${t}」不是按天`).toMatch(/^第 \d+ 天$/);
      // 末格按契约换算 = 第 35 天（5 拍 × 7 天）。`ceil` 的过冲是真相，不许在屏上抹成 30。
      expect(ticks[ticks.length - 1], `${page.name} 末格的天数不是按 tickDays 算的`).toBe(`第 ${lastDay} 天`);

      // ⚠ 最硬的一条：**屏上一格都不许等于 tick 序号本身**。
      //   `ticks.map(String)` 是 `["0",…,"5"]`，任何"把序号原样上屏"的实现在这里必红。
      expect(ticks, `${page.name} 屏上还是 tick 序号`).not.toEqual(body.ticks.map(String));
      // 且刻度条数就是回包给的拍数（6 格），不是 31 格 —— 证明读的确实是这一臂的回包。
      expect(ticks, `${page.name} 读到的不是 tickDays=7 那一份回包`).toHaveLength(body.ticks.length);
      cleanup();
    }
  });

  it("③ 同一序号、两个 tickDays ⇒ 屏上必须不同（对实现无知的那一条）", async () => {
    // 这一条不认标签长什么样，只认「口径真的进了换算」：
    // 两臂的第 5 格（tick=5）在 1 天/拍下是第 5 天、在 7 天/拍下是第 35 天。
    // 任何忽略 `tickDays` 的实现（包括把序号套进「第 _ 天」模板的那种）在这里必红。
    const at = 5;
    for (const page of PAGES) {
      installHandlers([sessionWith(1)], 1);
      const a = mount(page);
      await waitEndpoint(a, page);
      const one = laneTicks(a, page)[at];
      cleanup();

      installHandlers([sessionWith(7)], 7);
      const b = mount(page);
      await waitEndpoint(b, page);
      const seven = laneTicks(b, page)[at];
      cleanup();

      expect(one, `${page.name} 第 ${at} 格（tickDays=1）读不到`).toBeDefined();
      expect(seven, `${page.name} 第 ${at} 格（tickDays=7）读不到`).toBeDefined();
      expect(seven, `${page.name} 换了 tickDays 屏上却一个字没变 ⇒ 口径根本没进换算`).not.toBe(one);
      expect(one).toBe(`第 ${daysForTicks(at, 1)} 天`);
      expect(seven).toBe(`第 ${daysForTicks(at, 7)} 天`);
    }
  });

  it("④ 会话缺 tickDays（本字段引入前建的旧世界）⇒ 按 1 处理，仍按天说话", async () => {
    // 契约明写「缺失与 1 同义」，且 DataCore 侧恒填 —— 这一支覆盖的是旧世界。
    // ⚠ 它与用例 ⑤ 的「没有会话对象」**是两件不同的事**，处置也不同，别合并。
    const page = PAGES[0] as PageUnderTest;
    installHandlers([sessionWith(undefined)], 1);
    const root = mount(page);
    await waitEndpoint(root, page);

    expect(
      root.querySelector('[data-testid="sandbox-console-host"]')?.getAttribute("data-tick-days"),
      "会话在手、字段缺失 ⇒ 应按契约的「缺失与 1 同义」落 1",
    ).toBe("1");
    expect(probeAttr(root, page, "data-tick-unit")).toBe("day");
    const ticks = laneTicks(root, page);
    expect(ticks[ticks.length - 1]).toBe(`第 ${HORIZON_DAYS} 天`);
  });

  it("⑤ 宿主只给 id、一条会话都没查过 ⇒ **不猜天数**，屏上按「拍」说话并标 tick", async () => {
    // 这是 `explicit` 那条路：`useConsoleSession` 刻意不发列表请求 ⇒ 没有会话对象可问。
    // 此时落 `?? 1` 会在真实 tickDays=7 的世界上把「第 35 天」写成「第 5 天」——
    // 差 7 倍且不会有任何东西报错。故这一支必须**说得出自己不知道**。
    const page = PAGES[0] as PageUnderTest;
    installHandlers([sessionWith(7)], 7);
    const root = mount(page, { sessionId: SESSION_ID });
    await waitEndpoint(root, page);

    const host = root.querySelector('[data-testid="sandbox-console-host"]');
    expect(host?.getAttribute("data-session-reason"), "这一支必须走 explicit").toBe("explicit");
    expect(host?.getAttribute("data-tick-days"), "没问过就不许给一个数（空串 ≠ \"1\"）").toBe("");
    expect(probeAttr(root, page, "data-tick-unit"), "口径未知时必须标 tick，不许冒充 day").toBe("tick");

    const ticks = laneTicks(root, page);
    // 说得出的那一半照说（这确实是第 N 拍），说不出的那一半不编（一格「天」都不许出现）。
    for (const t of ticks) expect(t, `刻度「${t}」在口径未知时冒充了天`).toMatch(/^第 \d+ 拍$/);
    expect(ticks.join(""), "口径未知却在屏上写了「天」").not.toContain("天");
  });
});
