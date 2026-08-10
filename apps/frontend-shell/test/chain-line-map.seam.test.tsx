import { Suspense } from "react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { computeLossAttribution, type ChainNode, type ChainStep, type LossAttribution } from "@platform/contracts";

/**
 * WO-SANDBOX-F1 · 全链线路图 —— SEAM + 图元区分 + 三色系 + 半径映射 + 诚实缺席。
 *
 * ── SEAM 的咬点（"是数据驱动，不是渲染写死"）─────────────────────────────────
 *  ① **咬链路不咬组件**：一律经 `getRenderer("chain-line-map")` 取到 lazy renderer 再渲染。
 *     直接 `import` 组件只能证明"函数能跑"，证明不了"接线了" —— 本仓有过
 *     `F3 物理拓扑组件零生产调用方`（实现有、测试有、全绿、零路由渲染得到）的假绿。
 *  ② **改引擎返回的 `LossAttribution` → 站圈半径与百分比必须跟着变**。
 *     手法是把两条真行的 `pctOfChainLoss` **对调**（仍是合法载荷、Σ 仍 == 100），
 *     然后断言两个站的半径与文案**互换**。半径若写死成常量，两者相等 → 本组当场红。
 *
 * ── 载荷来源：**真引擎**，不是我编的 ────────────────────────────────────────
 * `fixtures/chain-loss-real.json` = 2026-08-05 在 E1 分支起内存态 datacore（SEED_DEMO=1·seed 42）
 * 真调 `POST /a/v1/solvers/chain_loss_attribution/invoke` 的返回体。
 * 所以本测试里**没有一个我发明的 nodeId/stepId**（审核方补充约束③：S0 没有节点 ID 单源注册表，
 * D1 与 E1 已各发明一套；前端再发明第三套就彻底断链）。变体载荷也一律从这份真值派生。
 */

// ── 网络桩：唯一数据源是引擎求解器，这里把它替换成可编排的返回 ──────────────────
const net = vi.hoisted(() => ({
  payload: null as unknown,
  fail: null as unknown,
  calls: [] as { key: string; args: Record<string, unknown> }[],
}));

vi.mock("@/api/endpoints", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/endpoints")>();
  return {
    ...actual,
    runSolver: vi.fn(async (key: string, args: Record<string, unknown>) => {
      net.calls.push({ key, args });
      if (net.fail !== null) throw net.fail;
      return { data: net.payload, snapshotVersion: "sv-test" };
    }),
  };
});

import { getRenderer } from "@/views/registry";
import { __timing } from "@/views/sim/ChainLineMapView";
import {
  buildChainLineMap,
  ChainLossPayloadSchema,
  CHAIN_LOSS_SOLVER_KEY,
  formatPct,
  LAYOUT,
  stationRadius,
  STATION_RADIUS,
  type ChainLossPayload,
} from "@/views/sim/chainLineMap";

// ── 仓根 / 真实载荷 ───────────────────────────────────────────────────────────
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = (() => {
  let dir = TEST_DIR;
  for (let i = 0; i < 8; i++) {
    try {
      readFileSync(join(dir, "pnpm-workspace.yaml"));
      return dir;
    } catch {
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  throw new Error(`[chain-line-map.seam] 找不到仓根（自 ${TEST_DIR} 向上未见 pnpm-workspace.yaml）`);
})();
const readRepo = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

const REAL: ChainLossPayload = ChainLossPayloadSchema.parse(
  JSON.parse(readFileSync(join(TEST_DIR, "fixtures/chain-loss-real.json"), "utf8")),
);

/** 真载荷里占比最大 / 最小的两条归因行（不写死 stepId —— 从数据里挑）。 */
const sortedAttr = [...REAL.attribution].sort((a, b) => b.pctOfChainLoss - a.pctOfChainLoss);
const TOP = sortedAttr[0]!;
const BOTTOM = sortedAttr.at(-1)!;
/** 一条中位归因行，避免只用极值证明。 */
const MID = sortedAttr[Math.floor(sortedAttr.length / 2)]!;

/** 深拷贝一份真载荷（每个用例互不污染）。 */
const cloneReal = (): ChainLossPayload => JSON.parse(JSON.stringify(REAL)) as ChainLossPayload;

/** 把两条归因行的 `pctOfChainLoss` 对调 —— 仍是合法载荷（Σ 不变），模拟"引擎算出来的分布变了"。 */
function withSwappedPct(a: string, b: string): ChainLossPayload {
  const p = cloneReal();
  const ra = p.attribution.find((r) => r.stepId === a)!;
  const rb = p.attribution.find((r) => r.stepId === b)!;
  [ra.pctOfChainLoss, rb.pctOfChainLoss] = [rb.pctOfChainLoss, ra.pctOfChainLoss];
  [ra.nonValueDays, rb.nonValueDays] = [rb.nonValueDays, ra.nonValueDays];
  delete p.conservation;
  return p;
}

/**
 * 把引擎标为 EMPTY 的返工段"补上承载"——即 D 单把返工天数落地后，
 * 引擎会把这一段从 `empty[]` 挪进 `nodes[]`。**stepId / nodeId 全取自引擎真值**，我不发明。
 */
function withReworkStep(days: number): ChainLossPayload {
  const p = cloneReal();
  const row = (p.empty ?? []).find((e) => e.kind === "rework")!;
  const targetStage = row.stage;
  const step: ChainStep = { stepId: row.stepId, nodeId: row.nodeId, label: row.label, kind: "rework", days, valueAdd: false };
  const node: ChainNode = { nodeId: row.nodeId, label: row.label, stage: targetStage, steps: [step] };
  p.nodes = [...p.nodes, node];
  p.empty = (p.empty ?? []).filter((e) => e.stepId !== row.stepId);
  // 归因用契约里的**唯一实现**重算（前端不自己写分母）——Σ 仍 == 100。
  p.attribution = computeLossAttribution(p.nodes.flatMap((n) => n.steps)) as LossAttribution[];
  delete p.conservation;
  return p;
}

async function mount() {
  const View = getRenderer("chain-line-map");
  expect(View, "registry 里没有 chain-line-map —— 组件再绿也没有任何路由渲染得到它").toBeDefined();
  const Lazy = View!;
  const utils = render(
    <Suspense fallback={<div data-testid="clm-suspense" />}>
      <Lazy view={{ key: "chain-line-map", title: "线路图" } as never} />
    </Suspense>,
  );
  await screen.findByTestId("clm-root");
  return utils;
}

/** 从 DOM 上读某个站的半径（渲染出来的真值，不是我算的）。 */
function domRadius(stepId: string): number {
  const g = screen.getByTestId(`clm-station-${stepId}`);
  const circle = g.querySelector("circle");
  return Number(circle!.getAttribute("r"));
}

beforeEach(() => {
  net.payload = cloneReal();
  net.fail = null;
  net.calls.length = 0;
});

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. SEAM ①：链路可达 —— 经 registry 的字符串键拿到组件并真渲染
// ═══════════════════════════════════════════════════════════════════════════════
describe("SEAM ① · 渲染器可达（咬链路，不咬组件）", () => {
  it("getRenderer('chain-line-map') 取得到，且真渲染出画布与站点", async () => {
    await mount();
    expect(await screen.findByTestId("clm-canvas")).toBeInTheDocument();
    expect(screen.getByTestId(`clm-station-${TOP.stepId}`)).toBeInTheDocument();
  });

  it("数据只来自引擎求解器 chain_loss_attribution（没有第二条取数路径）", async () => {
    await mount();
    await screen.findByTestId("clm-canvas");
    expect(net.calls.length).toBeGreaterThan(0);
    expect(net.calls.every((c) => c.key === CHAIN_LOSS_SOLVER_KEY)).toBe(true);
  });

  it("view.options 的范围真透传给求解器（未给 = 未限定，前端不编默认范围）", async () => {
    const View = getRenderer("chain-line-map")!;
    render(
      <Suspense fallback={<div />}>
        <View view={{ key: "chain-line-map", title: "线路图", options: { so: REAL.anchor?.so, modelIds: ["m-x", "m-y"] } } as never} />
      </Suspense>,
    );
    await screen.findByTestId("clm-canvas");
    await waitFor(() => expect(net.calls.length).toBeGreaterThan(0));
    expect(net.calls[0]!.args).toEqual({ so: REAL.anchor?.so, modelIds: ["m-x", "m-y"] });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. SEAM ②（本单头号判据）：引擎 LossAttribution 变 → 站圈大小与百分比跟着变
// ═══════════════════════════════════════════════════════════════════════════════
describe("SEAM ② · LossAttribution 变化 → 站圈大小与百分比真的跟着变", () => {
  it("基线：站圈半径 == stationRadius(引擎 pct)，且大占比的圈严格大于小占比的圈", async () => {
    await mount();
    await screen.findByTestId("clm-canvas");
    expect(domRadius(TOP.stepId)).toBeCloseTo(stationRadius(TOP.pctOfChainLoss), 9);
    expect(domRadius(MID.stepId)).toBeCloseTo(stationRadius(MID.pctOfChainLoss), 9);
    expect(domRadius(BOTTOM.stepId)).toBeCloseTo(stationRadius(BOTTOM.pctOfChainLoss), 9);
    expect(domRadius(TOP.stepId)).toBeGreaterThan(domRadius(MID.stepId));
    expect(domRadius(MID.stepId)).toBeGreaterThan(domRadius(BOTTOM.stepId));
    // 百分比文案同样来自引擎
    expect(screen.getByTestId(`clm-pct-${TOP.stepId}`)).toHaveTextContent(formatPct(TOP.pctOfChainLoss));
  });

  it("把两条归因行的 pct 对调（同一次挂载内点『重新扫描』）→ 两站的半径与文案互换", async () => {
    const user = userEvent.setup();
    await mount();
    await screen.findByTestId("clm-canvas");
    const rTopBefore = domRadius(TOP.stepId);
    const rMidBefore = domRadius(MID.stepId);
    expect(rTopBefore).not.toBeCloseTo(rMidBefore, 6);

    // 引擎"重算"出了不同的分布
    net.payload = withSwappedPct(TOP.stepId, MID.stepId);
    await user.click(screen.getByTestId("clm-reload"));

    await waitFor(() => expect(domRadius(TOP.stepId)).toBeCloseTo(rMidBefore, 9));
    expect(domRadius(MID.stepId)).toBeCloseTo(rTopBefore, 9);
    expect(screen.getByTestId(`clm-pct-${TOP.stepId}`)).toHaveTextContent(formatPct(MID.pctOfChainLoss));
    expect(screen.getByTestId(`clm-pct-${MID.stepId}`)).toHaveTextContent(formatPct(TOP.pctOfChainLoss));
  });

  it("整表按比例重分配（不是换一个站，是换一组数）→ 每个站的半径逐个跟着重算", async () => {
    await mount();
    await screen.findByTestId("clm-canvas");
    const before = new Map(REAL.attribution.map((r) => [r.stepId, domRadius(r.stepId)]));

    // 把归因整表倒序重排（第 i 条拿第 n-1-i 条的占比）——仍是合法载荷，Σ 不变。
    const p = cloneReal();
    const pcts = REAL.attribution.map((r) => r.pctOfChainLoss);
    p.attribution.forEach((r, i) => {
      r.pctOfChainLoss = pcts[pcts.length - 1 - i]!;
    });
    delete p.conservation;
    net.payload = p;

    const user = userEvent.setup();
    await user.click(screen.getByTestId("clm-reload"));

    const topIdx = REAL.attribution.findIndex((r) => r.stepId === TOP.stepId);
    const topPctAfter = pcts[pcts.length - 1 - topIdx]!;
    await waitFor(() => expect(domRadius(TOP.stepId)).toBeCloseTo(stationRadius(topPctAfter), 9));
    let changed = 0;
    for (const r of p.attribution) {
      expect(domRadius(r.stepId)).toBeCloseTo(stationRadius(r.pctOfChainLoss), 9);
      if (Math.abs(domRadius(r.stepId) - before.get(r.stepId)!) > 1e-9) changed++;
    }
    expect(changed, "整表换了一组占比，居然没有一个站圈变 —— 半径不是数据驱动的").toBeGreaterThan(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. 半径映射：非线性 + 上下夹取（审核方实测：最大 85.5% vs 最小 0.0049%）
// ═══════════════════════════════════════════════════════════════════════════════
describe("半径映射 · 极端不均下最小站圈仍可见、最大站圈不溢出画布", () => {
  it("真载荷的占比确实极端不均（比值 > 1000×）", () => {
    expect(TOP.pctOfChainLoss / BOTTOM.pctOfChainLoss).toBeGreaterThan(1000);
  });

  it("半径非线性：占比差 >1000× 时半径差被压到 <5×，且最小圈 >= 可见阈值", async () => {
    await mount();
    await screen.findByTestId("clm-canvas");
    const rTop = domRadius(TOP.stepId);
    const rBottom = domRadius(BOTTOM.stepId);
    expect(rBottom).toBeGreaterThanOrEqual(STATION_RADIUS.min);
    expect(rBottom, "最小站圈必须仍然看得见（线性映射下它是 0.001px）").toBeGreaterThanOrEqual(6);
    expect(rTop / rBottom, "半径若线性映射，这里会是 >1000×").toBeLessThan(5);
    expect(rTop).toBeLessThanOrEqual(STATION_RADIUS.max);
    // 压缩 ≠ 抹平：夹取之后大小仍须**严格可分**，否则就是把「站圈 ∝ 占比」做没了
    // （变异反证：半径改常量 → 本行红）。
    expect(rTop, "夹取把区分度压没了 = 站圈不再随数据变").toBeGreaterThan(rBottom);
  });

  it("几何自洽：最大半径不溢出画布、相邻站不重叠、每个站圈都在 bounds 内", () => {
    const map = buildChainLineMap(REAL);
    expect(STATION_RADIUS.max, "最大站圈会撞上下边界").toBeLessThan(LAYOUT.padY);
    expect(STATION_RADIUS.max * 2, "最大的两个相邻站会叠在一起").toBeLessThan(LAYOUT.gapX);
    for (const s of map.stations) {
      expect(s.x - s.r).toBeGreaterThan(0);
      expect(s.x + s.r).toBeLessThan(map.bounds.width);
      expect(s.y - s.r).toBeGreaterThan(0);
      expect(s.y + s.r).toBeLessThan(map.bounds.height);
    }
  });

  it("stationRadius 是 √占比 单调映射（不是常量、不是线性）", () => {
    expect(stationRadius(0)).toBe(STATION_RADIUS.min);
    expect(stationRadius(100)).toBe(STATION_RADIUS.max);
    expect(stationRadius(25)).toBeGreaterThan(stationRadius(10));
    // 面积 ∝ 占比 ⇒ 半径增量 ∝ √占比：25% 处的增量恰好是 100% 处的一半
    const span = STATION_RADIUS.max - STATION_RADIUS.min;
    expect(stationRadius(25) - STATION_RADIUS.min).toBeCloseTo(span * 0.5, 9);
    // 增值段无归因行 ⇒ 基准尺寸（不是 0%）
    expect(stationRadius(null)).toBe(STATION_RADIUS.min);
  });

  it("极小占比不显示成 0.00%（把「极小」与「没有」分开）", () => {
    // 格式化契约本身：拿一个**确实落在该分支里**的值去咬，不依赖 fixture 恰好有多小。
    // ⚠ WO-LEADTIME-SPLIT 改法记账：本行原来写的是 `formatPct(BOTTOM.pctOfChainLoss) === "<0.01%"`，
    //   依赖的是「真实数据里最小那条恰好 < 0.01%」。拆分把归因分母从 84.19 天（含账期 60 天）
    //   收窄到 24.19 天（交付段），最小那条于是从 0.0041% 升到 0.0143% —— **数据变了，格式化没坏**。
    //   若照旧断言就会得出「格式化坏了」这个恰好相反的结论，故把两件事拆开断：
    expect(formatPct(0.004), "极小值必须走 <0.01% 分支，不许四舍五入成 0.00%").toBe("<0.01%");
    expect(formatPct(null), "「没有归因行」与「占比极小」是两件事").toBe("—");
    expect(formatPct(0), "真 0 就该显示 0.00%（它是结论，不是缺席）").toBe("0.00%");
    // 真实数据侧：最小那条无论多小，都**不许**被显示成 0.00%（把「极小」说成「没有」）。
    expect(BOTTOM.pctOfChainLoss, "前置：最小归因行必须真的 > 0，否则这条断言空转").toBeGreaterThan(0);
    expect(formatPct(BOTTOM.pctOfChainLoss), "真实最小归因行被显示成 0.00% = 把「极小」说成「没有」").not.toBe("0.00%");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. 图元：换乘站(OR 语义) 与 合流站(齐套 AND) 必须用**不同**图元
// ═══════════════════════════════════════════════════════════════════════════════
describe("图元 · 齐套 AND 与换乘站分得开（隐喻唯一撑不住的地方）", () => {
  it("合流站画的是 AND 闸门 + 汇流母线，不是圆、不是普通合并", async () => {
    await mount();
    await screen.findByTestId("clm-canvas");
    const join = screen.getByTestId("clm-and-join");
    expect(join).toHaveAttribute("data-join-semantics", "AND");
    const gate = within(join).getByTestId("clm-and-gate");
    expect(gate).toHaveAttribute("data-glyph", "and-gate");
    // 闸门是 path（D 形），**没有 circle** —— 与换乘站的双环圆在图元层就分开
    expect(gate.querySelector("path")).not.toBeNull();
    expect(gate.querySelector("circle"), "合流站画成了圆 = 与换乘站同图元 = 把 AND 冒充成 OR").toBeNull();
    expect(screen.getByTestId("clm-and-bus")).toBeInTheDocument();
  });

  it("换乘站是双环圆（共用工序 = 共享瓶颈），且标注了判据强度", async () => {
    await mount();
    await screen.findByTestId("clm-canvas");
    const map = buildChainLineMap(REAL);
    const inter = map.stations.filter((s) => s.glyph === "interchange");
    expect(inter.length, "真载荷里应至少有一个共用（scope 未限定 = 全域）的环节").toBeGreaterThan(0);
    for (const s of inter) {
      const g = screen.getByTestId(`clm-station-${s.stepId}`);
      expect(g).toHaveAttribute("data-station-kind", "interchange");
      expect(g.querySelectorAll("circle")).toHaveLength(2); // 外环 + 内心
      expect(["explicit", "unscoped"]).toContain(g.getAttribute("data-shared-basis"));
    }
  });

  it("图例常驻说明「地铁并线是 OR / 齐套是 AND」，不靠读者自己悟", async () => {
    await mount();
    const warn = screen.getByTestId("clm-and-or-warning");
    expect(warn).toHaveTextContent("OR");
    expect(warn).toHaveTextContent("AND");
    expect(warn).toHaveTextContent("全部");
  });

  it("无物料支线的载荷 → 不画合流站，并显式说明原因（不静默省略）", async () => {
    const p = cloneReal();
    const map0 = buildChainLineMap(p);
    p.nodes = p.nodes.filter((n) => n.stage !== "MATERIAL");
    p.empty = (p.empty ?? []).filter((e) => e.stage !== "MATERIAL");
    p.attribution = p.attribution.filter((a) => p.nodes.some((n) => n.steps.some((s) => s.stepId === a.stepId)));
    delete p.conservation; // 归因表变了，旧守恒读数不再对应 —— 不许拿它冒充
    net.payload = p;
    expect(map0.andJoin).not.toBeNull();

    await mount();
    await screen.findByTestId("clm-canvas");
    expect(screen.queryByTestId("clm-and-join")).toBeNull();
    expect(screen.getByTestId("clm-notes")).toHaveTextContent("无支线");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. 停运区间 = 断点 · 红弧 = 返工逆行（都必须由数据驱动）
// ═══════════════════════════════════════════════════════════════════════════════
describe("停运区间（断点）与红弧（返工逆行）", () => {
  it("引擎 empty[] 的每一行都落成停运站位，相邻区间标 suspended", async () => {
    await mount();
    await screen.findByTestId("clm-canvas");
    const rows = REAL.empty ?? [];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const el = screen.getByTestId(`clm-suspended-${row.stepId}`);
      expect(el).toHaveAttribute("data-station-kind", "suspended");
      expect(el).toHaveAttribute("data-empty-kind", row.emptyKind);
    }
    const map = buildChainLineMap(REAL);
    expect(map.segments.some((s) => s.state === "suspended")).toBe(true);
    for (const seg of map.segments.filter((s) => s.state === "suspended")) {
      expect(screen.getByTestId(`clm-seg-${seg.segmentId}`)).toHaveAttribute("data-segment-state", "suspended");
    }
  });

  it("停运站位给出「为什么算不出来」+ 取证方式（EMPTY 不是 0）", async () => {
    const user = userEvent.setup();
    await mount();
    await screen.findByTestId("clm-canvas");
    const row = (REAL.empty ?? [])[0]!;
    await user.hover(screen.getByTestId(`clm-suspended-${row.stepId}`));
    expect(await screen.findByTestId("clm-detail-reason")).toHaveTextContent(row.reason.slice(0, 12));
    expect(screen.getByTestId("clm-detail-probe")).toBeInTheDocument();
  });

  it("真载荷 0 条返工段 → 不画红弧，且在诚实边界里明说（不画示意弧）", async () => {
    await mount();
    await screen.findByTestId("clm-canvas");
    expect(document.querySelectorAll('[data-arc="rework"]')).toHaveLength(0);
    expect(screen.getByTestId("clm-notes")).toHaveTextContent("无红弧");
  });

  it("引擎一旦返回 rework 段 → 红弧自动出现并回指本线上一站（数据驱动，非写死）", async () => {
    const variant = withReworkStep(2.5);
    const row = (REAL.empty ?? []).find((e) => e.kind === "rework")!;
    net.payload = variant;
    await mount();
    await screen.findByTestId("clm-canvas");
    const arc = await screen.findByTestId(`clm-rework-${row.stepId}`);
    expect(arc).toHaveAttribute("data-arc", "rework");
    const map = buildChainLineMap(variant);
    const a = map.reworkArcs[0]!;
    expect(arc).toHaveAttribute("data-to", a.toStepId);
    expect(a.toStepId).not.toBe(a.fromStepId);
    // 逆行：终点在起点**左边**（回到上一站）
    const from = map.stations.find((s) => s.stepId === a.fromStepId)!;
    const to = map.stations.find((s) => s.stepId === a.toStepId)!;
    expect(to.x).toBeLessThan(from.x);
    expect(screen.queryByTestId(`clm-suspended-${row.stepId}`), "这一段已有承载，不该同时还挂着停运站位").toBeNull();
  });

  it("增值段不进损失分母：图元与文案都与「占比≈0」分开", async () => {
    await mount();
    await screen.findByTestId("clm-canvas");
    const map = buildChainLineMap(REAL);
    const va = map.stations.filter((s) => s.valueAdd);
    expect(va.length).toBeGreaterThan(0);
    for (const s of va) {
      expect(s.pctOfChainLoss).toBeNull();
      expect(screen.getByTestId(`clm-station-${s.stepId}`)).toHaveAttribute("data-station-kind", "value-add");
      expect(screen.getByTestId(`clm-pct-${s.stepId}`)).toHaveTextContent("增值·不进分母");
    }
  });

  it("守恒读数来自引擎（Σ 非增值 pct == 100%）", async () => {
    await mount();
    await screen.findByTestId("clm-canvas");
    const cons = screen.getByTestId("clm-conservation");
    expect(cons).toHaveAttribute("data-ok", "1");
    expect(cons).toHaveTextContent("100.000%");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. 诚实：引擎取不到数就说取不到，不拿示例数据顶上
// ═══════════════════════════════════════════════════════════════════════════════
describe("诚实缺席 · 引擎不通时不画替代数据", () => {
  it("求解器 404 → 显示错误码 + 零站点（不 fallback 到内置数据集）", async () => {
    net.fail = { error: { code: "FEATURE_NOT_FOUND", message: "求解器不存在或未开通" } };
    await mount();
    expect(await screen.findByTestId("clm-engine-error")).toBeInTheDocument();
    expect(screen.getByTestId("clm-error-code")).toHaveTextContent("FEATURE_NOT_FOUND");
    expect(screen.queryByTestId("clm-stage")).toBeNull();
    expect(document.querySelectorAll('[data-station-kind="stop"]')).toHaveLength(0);
  });

  it("载荷形状不合 S0 契约 → 报形状错，不猜、不补字段", async () => {
    net.payload = { nodes: [{ nodeId: "n", label: "l", stage: "NOPE", steps: [] }], attribution: [] };
    await mount();
    expect(await screen.findByTestId("clm-error-code")).toHaveTextContent("PAYLOAD_SHAPE");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. 审核方补充约束：前端不许写死任何节点清单 / 节点 ID / 站点列表
// ═══════════════════════════════════════════════════════════════════════════════
describe("零写死节点清单（S0 无节点 ID 单源注册表 → 前端一律当不透明 key）", () => {
  const derivePath = "apps/frontend-shell/src/views/sim/chainLineMap.ts";
  const viewPath = "apps/frontend-shell/src/views/sim/ChainLineMapView.tsx";
  const src = `${readRepo(derivePath)}\n${readRepo(viewPath)}`;

  it("源码里不出现引擎载荷中的任何 nodeId / stepId 字面量", () => {
    const ids = new Set<string>();
    for (const n of REAL.nodes) {
      ids.add(n.nodeId);
      for (const s of n.steps) ids.add(s.stepId);
    }
    for (const e of REAL.empty ?? []) {
      ids.add(e.nodeId);
      ids.add(e.stepId);
    }
    const leaked = [...ids].filter((id) => src.includes(id));
    expect(leaked, `源码写死了节点/环节 ID（前端就此发明了第三套 ID）：${leaked.join(", ")}`).toEqual([]);
  });

  it("派生层对 nodeId 零字符串解析（不 split / 不前缀判断）", () => {
    const derive = readRepo(derivePath).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const banned of ["split(", "startsWith(", "endsWith(", "indexOf("]) {
      expect(derive.includes(banned), `派生层出现 ${banned} —— 疑似在解析 nodeId 的字符串结构`).toBe(false);
    }
  });

  it("分组只用契约 stage 枚举，且主线段是从 CHAIN_STAGES 派生（不是抄一份清单）", async () => {
    const { TRUNK_STAGES, BRANCH_STAGE } = await import("@/views/sim/chainLineMap");
    const { CHAIN_STAGES } = await import("@platform/contracts");
    expect([...TRUNK_STAGES, BRANCH_STAGE].sort()).toEqual([...CHAIN_STAGES].sort());
    expect(readRepo(derivePath)).toContain("CHAIN_STAGES.filter");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. 三色系：dark / light / warm 全过 · 零硬编码颜色
// ═══════════════════════════════════════════════════════════════════════════════
describe("三色系 · dark / light / warm 全过", () => {
  const cssPath = "apps/frontend-shell/src/views/sim/ChainLineMapView.module.css";
  const css = readRepo(cssPath);
  const tsx = readRepo("apps/frontend-shell/src/views/sim/ChainLineMapView.tsx");
  const ts = readRepo("apps/frontend-shell/src/views/sim/chainLineMap.ts");
  const tokens = readRepo("apps/frontend-shell/src/styles/tokens.css");
  /** tokens.css 的 `:root { … }` 首块 = 三套主题共同继承的基座。 */
  const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(tokens)![1]!;
  const rootTokens = new Set([...rootBlock.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!));

  it("样式与组件里零硬编码颜色（hex / rgb / hsl）", () => {
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], "样式里出现硬编码 hex").toEqual([]);
    expect(css.match(/\b(rgba?|hsla?)\s*\(/g) ?? [], "样式里出现硬编码 rgb/hsl").toEqual([]);
    for (const [name, s] of [["tsx", tsx], ["ts", ts]] as const) {
      expect(s.match(/#[0-9a-fA-F]{6}\b/g) ?? [], `${name} 里出现硬编码 hex`).toEqual([]);
      expect(s.match(/\b(rgba?|hsla?)\s*\(/g) ?? [], `${name} 里出现硬编码 rgb/hsl`).toEqual([]);
    }
  });

  it("用到的每个 CSS 变量都定义在 tokens.css 的 :root（否则某套皮下取不到值）", () => {
    const cssNoComment = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const used = new Set([...cssNoComment.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!));
    expect(used.size).toBeGreaterThan(8);
    const missing = [...used].filter((t) => !rootTokens.has(t));
    expect(missing, `这些 token 不在 :root（只在某个 data-theme 分支里定义 → 其它主题下失效）：${missing.join(", ")}`).toEqual([]);
  });

  it("三套主题下都渲染出完整线路图，且站圈半径逐档不变（配色换皮，几何是数据）", async () => {
    for (const theme of [null, "light", "warm"] as const) {
      if (theme === null) document.documentElement.removeAttribute("data-theme");
      else document.documentElement.setAttribute("data-theme", theme);
      const { unmount } = await mount();
      await screen.findByTestId("clm-canvas");
      expect(document.documentElement.getAttribute("data-theme")).toBe(theme);
      expect(screen.getByTestId("clm-and-join")).toBeInTheDocument();
      expect(screen.getByTestId("clm-legend")).toBeInTheDocument();
      expect(domRadius(TOP.stepId)).toBeCloseTo(stationRadius(TOP.pctOfChainLoss), 9);
      unmount();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. 缩放 / 平移 + 定时器纪律
// ═══════════════════════════════════════════════════════════════════════════════
describe("缩放 / 平移 / 定时器纪律", () => {
  it("放大缩小按钮改变缩放读数，快捷键 0 触发适应画布", async () => {
    const user = userEvent.setup();
    await mount();
    await screen.findByTestId("clm-canvas");
    expect(screen.getByTestId("clm-zoom-readout")).toHaveTextContent("1.00×");
    await user.click(screen.getByTestId("clm-zoom-in"));
    expect(screen.getByTestId("clm-zoom-readout")).not.toHaveTextContent("1.00×");
    await user.click(screen.getByTestId("clm-zoom-out"));
    expect(screen.getByTestId("clm-zoom-readout")).toHaveTextContent("1.00×");
  });

  it("拖拽平移改变画布位移", async () => {
    await mount();
    const canvas = await screen.findByTestId("clm-canvas");
    expect(canvas).toHaveAttribute("data-pan-x", "0");
    await userEvent.pointer([
      { target: canvas, keys: "[MouseLeft>]", coords: { clientX: 100, clientY: 100 } },
      { target: canvas, coords: { clientX: 160, clientY: 130 } },
      { keys: "[/MouseLeft]" },
    ]);
    expect(canvas).toHaveAttribute("data-pan-x", "60");
    expect(canvas).toHaveAttribute("data-pan-y", "30");
  });

  /**
   * 定时器纪律：**覆盖 ref 前必须先 clear**。
   * 断言咬的是**句柄本身**（前两个 handle 有没有被 clearTimeout 掉），不是"有没有写 cleanup"——
   * 本仓刚修过 4 处「ref 只存得下最后一个 handle → 前一个成孤儿 → 整包随机红」。
   */
  it("连点三次：前两个提示条句柄被显式 clear，不留孤儿", async () => {
    const user = userEvent.setup();
    const setSpy = vi.spyOn(globalThis, "setTimeout");
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    try {
      await mount();
      await screen.findByTestId("clm-canvas");
      setSpy.mockClear();
      clearSpy.mockClear();
      await user.click(screen.getByTestId("clm-fit"));
      await user.click(screen.getByTestId("clm-fit"));
      await user.click(screen.getByTestId("clm-fit"));

      const handles = setSpy.mock.calls
        .map((call, i) => ({ delay: call[1], handle: setSpy.mock.results[i]!.value as unknown }))
        .filter((x) => x.delay === __timing.HINT_MS)
        .map((x) => x.handle);
      expect(handles, "三次点击应各排一个提示条定时器").toHaveLength(3);
      const cleared = new Set(clearSpy.mock.calls.map((c) => c[0] as unknown));
      expect(cleared.has(handles[0]), "第 1 个 handle 没被 clear —— 覆盖 ref 前漏清 = 孤儿定时器").toBe(true);
      expect(cleared.has(handles[1]), "第 2 个 handle 没被 clear —— 覆盖 ref 前漏清 = 孤儿定时器").toBe(true);
      expect(screen.getByTestId("clm-hint")).toBeInTheDocument();
    } finally {
      setSpy.mockRestore();
      clearSpy.mockRestore();
    }
  });

  it("提示条到时自动消隐（真实计时，不靠假时钟糊过去）", async () => {
    const user = userEvent.setup();
    await mount();
    await screen.findByTestId("clm-canvas");
    await user.click(screen.getByTestId("clm-fit"));
    expect(screen.getByTestId("clm-hint")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("clm-hint")).toBeNull(), { timeout: __timing.HINT_MS + 4000 });
  });
});
