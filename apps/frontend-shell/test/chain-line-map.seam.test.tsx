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
import { checkedTree, factHits } from "./factlock";
import { __timing } from "@/views/sim/ChainLineMapView";
import {
  buildChainLineMap,
  ChainLossPayloadSchema,
  CHAIN_LOSS_SOLVER_KEY,
  formatPct,
  labelBoxesOverlap,
  METRO_LAYOUT,
  metroLabelBandPx,
  RING_LAYOUT,
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

/**
 * 从 DOM 上读某个站的**读数文案**。
 *
 * ⚠ 咬的是 `<g>` 上的 `data-pct-text`，**不是** `clm-pct-<stepId>` 那个 `<text>` ——
 * 后者只有「被标名的前 N 个站」才画得出来（密度纪律），而本文件要验的 TOP/MID/BOTTOM
 * 与增值段大多在 N 名之外。此前它们能被 `getByTestId` 找到，靠的是一个挂在 SVG `<title>`
 * 上的兜底节点；那个 `<title>` 是**浏览器原生 tooltip**（鼠标移开后滞留、遮挡图形，
 * 2026-08-10 实测事故），已按 `docs/CONVENTION-ui-information-layering.md` §2 删除。
 * 读数的受控出口从此是 `data-pct-text` / `aria-label` / 右栏面板三条。
 */
function domPctText(stepId: string): string {
  return screen.getByTestId(`clm-station-${stepId}`).getAttribute("data-pct-text") ?? "";
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
    expect(domPctText(TOP.stepId)).toBe(formatPct(TOP.pctOfChainLoss));
    // TOP 一定在「按占比标名的前 N 个」里，所以图上那行读数 <text> 也必须在
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
    expect(domPctText(TOP.stepId)).toBe(formatPct(MID.pctOfChainLoss));
    expect(domPctText(MID.stepId)).toBe(formatPct(TOP.pctOfChainLoss));
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
    expect(STATION_RADIUS.max, "最大站圈会撞上下边界").toBeLessThan(METRO_LAYOUT.padTop);
    expect(STATION_RADIUS.max * 2, "最大的两个相邻站会叠在一起").toBeLessThan(METRO_LAYOUT.gapX);
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
    expect(formatPct(BOTTOM.pctOfChainLoss)).toBe("<0.01%");
    expect(formatPct(null)).toBe("—");
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
      expect(domPctText(s.stepId)).toBe("增值·不进分母");
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
    expect(factHits(checkedTree("apps/frontend-shell/src", 'from "@platform/contracts"', 100), /CHAIN_STAGES\.filter\(/), "TRUNK_STAGES 不再从 CHAIN_STAGES 派生 —— 又抄了一份清单").not.toEqual([]);
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

// ═══════════════════════════════════════════════════════════════════════════════
// 10. WO-CHAIN-MAP-LAYOUT · **形是横向线路图，不是圆**
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * 仓主实测环形版的三处代价：① 标签互相压字（放射式布局的固有毛病）② 没有阅读起点
 * ③ 圆心整片浪费。本组逐条咬住新形态，且**每一条都能被"改回圆"这个变异打红**。
 */
describe("横向线路图 · 主线一条横线（起点在左 → 终点在右）", () => {
  const map = buildChainLineMap(REAL);
  const trunkSlots = [...map.stations, ...map.suspended]
    .filter((s) => s.lineId === "trunk")
    .sort((a, b) => a.index - b.index);

  it("① 阅读序（行号, x）严格递增：行内一律左 → 右，行与行自上而下", () => {
    expect(trunkSlots.length).toBeGreaterThan(3);
    for (let i = 1; i < trunkSlots.length; i++) {
      const prev = trunkSlots[i - 1]!;
      const cur = trunkSlots[i]!;
      if (cur.row === prev.row) {
        expect(cur.x, `同一行内 x 没有递增：${prev.label} → ${cur.label}`).toBeGreaterThan(prev.x);
        expect(cur.y, "同一行的站必须共用同一条基线（y 必须相等）").toBe(prev.y);
      } else {
        expect(cur.row, "行号必须自上而下递增（不许蛇形回折 —— 那会让人反向读）").toBe(prev.row + 1);
        expect(cur.y, "下一行必须更靠下").toBeGreaterThan(prev.y);
        expect(cur.col, "折行后必须从这一行的**左端**重新起步").toBe(0);
      }
    }
  });

  it("① 不折行的线上 x 全局单调递增（本次载荷的支线就是一条不折行的线）", () => {
    expect(map.lines.find((l) => l.lineId === "branch")!.plan.rowCount, "支线本次载荷只需一行").toBe(1);
    const branch = [...map.stations, ...map.suspended].filter((s) => s.lineId === "branch").sort((a, b) => a.index - b.index);
    expect(branch.length).toBeGreaterThan(3);
    for (let i = 1; i < branch.length; i++) expect(branch[i]!.x).toBeGreaterThan(branch[i - 1]!.x);
    expect(new Set(branch.map((s) => s.y)).size, "支线是一条横线 ⇒ 全部同一个 y").toBe(1);
  });

  /**
   * ⚠ **这条断言换过一次判据，换的理由要留下来（否则下一个人会以为我在调数字凑绿）。**
   *
   * 工单举例可以用「y 的方差远小于 x 的方差」。我一开始就是这么写的（`var(y)×20 < var(x)`），
   * 它在主线折 2 行时成立；2026-08-10 把每行站位数从 18 调到 12（折 3 行，理由见
   * `METRO_LAYOUT.maxSlotsPerRow` 的实测表）之后，`var(y)` 从一档变三档，实测比值只剩
   * **4.55×**（`var(y)=37177 / var(x)=169204`）—— 断言当场红。
   *
   * **正确处置不是把 20 改成 4**（那就是拿阈值迁就实现，门从此不再证明任何事），
   * 而是换成一条**精确的结构性质**：折行横向图的不变量是
   *   ① 每一行的 y **完全相同**（行内 y 只有一个取值）；
   *   ② 全图的 y 取值个数 **恰好等于行数**；
   *   ③ 全图的 x 取值个数 **恰好等于每行站位数**（列是对齐的）。
   * 环形布局三条全不满足（35 个站会有 ~35 个不同的 y 和 ~35 个不同的 x），
   * 所以这组判据比方差比更强、也更抗折行数变化。方差那句作为**辅助**保留，但阈值改为
   * 「行内 y 方差恒为 0」这个不含魔数的形式。
   */
  it("① 形不再是圆：y 只取「行数」个值、x 只取「每行站位数」个值，且**没有一个站落在旧椭圆上**", () => {
    const plan = map.lines.find((l) => l.lineId === "trunk")!.plan;
    const ys = new Set(trunkSlots.map((s) => s.y));
    const xs = new Set(trunkSlots.map((s) => s.x));
    expect(trunkSlots.length, "站位太少，下面的『取值个数』判据分辨不出圆和横线").toBeGreaterThan(3 * plan.rowCount);
    expect(ys.size, `y 有 ${ys.size} 个不同取值，而主线只有 ${plan.rowCount} 行 ⇒ 这不是横向折行布局`).toBe(plan.rowCount);
    expect(xs.size, `x 有 ${xs.size} 个不同取值，而每行 ${plan.perRow} 个站位 ⇒ 列没有对齐`).toBe(plan.perRow);
    // 行内 y 方差恒为 0（不含魔数的「横」判据）
    for (const row of new Set(trunkSlots.map((s) => s.row))) {
      const rowYs = trunkSlots.filter((s) => s.row === row).map((s) => s.y);
      const m = rowYs.reduce((a, v) => a + v, 0) / rowYs.length;
      expect(rowYs.reduce((a, v) => a + (v - m) ** 2, 0), `第 ${row} 行的 y 有离散 ⇒ 这一行不是水平的`).toBe(0);
    }
    // 变异反证的锚：环形版的不变量是「每个站都在椭圆上」。现在必须**一个都不在**。
    const onEllipse = trunkSlots.filter((s) => {
      const dx = (s.x - RING_LAYOUT.cx) / RING_LAYOUT.rx;
      const dy = (s.y - RING_LAYOUT.cy) / RING_LAYOUT.ry;
      return Math.abs(Math.hypot(dx, dy) - 1) < 1e-6;
    });
    expect(onEllipse.map((s) => s.label), "还有站落在旧椭圆上 ⇒ 布局没真的换").toEqual([]);
  });

  it("① 派生层不再用极坐标摆主干站（源码级：`buildChainLineMap` 里没有 ringAngle/ringPoint 调用）", () => {
    // buildChainLineMap 住在哪个文件不是事实（WO-C 修法）：全树定位**唯一定义处**，搬家不红；没了才红。
    const homes = factHits(
      checkedTree("apps/frontend-shell/src", 'from "@platform/contracts"', 100),
      /export function buildChainLineMap(?![\w])/,
    );
    expect(homes, "buildChainLineMap 必须全树唯一定义").toHaveLength(1);
    const mapSrc = readRepo(homes[0]!);
    const build = mapSrc.slice(mapSrc.indexOf("export function buildChainLineMap"));
    // 金丝雀：先证明这个切法真的切到了函数体（切错了会得出"里面什么都没有"这种恰好相反的结论）。
    expect(build, "切片没取到函数体 —— 工具坏了，不是代码干净").toContain("metroSlotPoint");
    for (const banned of ["ringAngle(", "ringPoint(", "ringArcPath("]) {
      expect(build.includes(banned), `主干布局仍在调用极坐标原语 ${banned}`).toBe(false);
    }
  });

  it("② 有阅读起点：每条线的左端画出「▶ 起点」标记", async () => {
    await mount();
    await screen.findByTestId("clm-canvas");
    for (const l of map.lines.filter((x) => x.slotCount > 0)) {
      const el = screen.getByTestId(`clm-start-${l.lineId}`);
      expect(el.textContent).toContain("起点");
      expect(Number(el.getAttribute("x")), "起点标记必须贴在画布最左侧").toBeLessThan(METRO_LAYOUT.padX);
    }
  });

  it("③ 不再有整片浪费的图心：闭环注记落在**底部回流走线沟**，不在画布中央", () => {
    expect(map.closureReturn).not.toBeNull();
    expect(map.closureReturn!.labelY, "闭环注记又跑回画布中部 = 图心又被占着").toBeGreaterThan(map.bounds.height * 0.7);
  });

  it("闭环 = 右端一条**回流箭头**（语义没丢：仍是 closure 段 + 结构推定原文）", async () => {
    const closure = map.segments.filter((s) => s.state === "closure");
    expect(closure).toHaveLength(1);
    expect(map.closureBasis!).toContain("结构推定");
    expect(map.closureReturn!.fromStepId).toBe(trunkSlots.at(-1)!.stepId);
    expect(map.closureReturn!.toStepId).toBe(trunkSlots[0]!.stepId);
    await mount();
    await screen.findByTestId("clm-canvas");
    const path = screen.getByTestId(`clm-seg-${closure[0]!.segmentId}`);
    expect(path.getAttribute("marker-end"), "闭环段没有箭头 ⇒ 看不出方向是「回到起点」").toContain("clm-closure-arrow");
    expect(screen.getByTestId("clm-closure-label").textContent).toContain("回款");
  });

  it("物料支线是**下方一条平行横线**（不是画在主线里的嵌套），经 AND 闸门汇入", () => {
    const branch = map.stations.filter((s) => s.lineId === "branch");
    const trunk = map.stations.filter((s) => s.lineId === "trunk");
    expect(branch.length).toBeGreaterThan(0);
    const branchY = new Set(branch.map((s) => s.y));
    expect(branchY.size, "支线不是一条横线").toBe(1);
    const bY = [...branchY][0]!;
    expect(bY, "支线必须在主线**下方**（平行的另一条线，不是下挂）").toBeGreaterThan(Math.max(...trunk.map((s) => s.y)));
    expect(map.andJoin).not.toBeNull();
    expect(map.andJoin!.busPath, "汇流母线必须是真几何，不是两点连线").toContain("Q");
  });

  it("折行处有明确的转折标记（不许让人以为线断了）", async () => {
    expect(map.lines[0]!.plan.rowCount, "本次载荷的主线必须真的折了行，否则本用例咬不到东西").toBeGreaterThan(1);
    expect(map.folds.length).toBe(map.lines[0]!.plan.rowCount - 1);
    const foldSegs = map.segments.filter((s) => s.fold === true);
    expect(foldSegs.length).toBe(map.folds.length);
    await mount();
    await screen.findByTestId("clm-canvas");
    for (const f of map.folds) {
      const el = screen.getByTestId(`clm-fold-${f.foldId}`);
      expect(el.textContent, "转折标记必须说清「同一条线，接下一行」").toContain("同一条线");
    }
    // 折行也要在诚实边界里明说，别让读者自己去数
    expect(map.notes.join(" ")).toContain("这条线没有断");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. WO-CHAIN-MAP-LAYOUT · **相邻站名不许压字**（仓主实拍到的那个毛病）
// ═══════════════════════════════════════════════════════════════════════════════
describe("站名摆位 · 上下交替 + 同侧分层 ⇒ 包围盒两两不重叠", () => {
  const map = buildChainLineMap(REAL);
  const drawn = [...map.stations, ...map.suspended].filter((s) => s.labelPos !== null);

  it("画出来的标签够多，本组才咬得到东西（金丝雀）", () => {
    expect(drawn.length, "一个标签都没画 ⇒ 下面的『不重叠』是恒真的废门").toBeGreaterThan(12);
    // 环形版实拍压字的那三条（清关 / 入厂在途 / 供应商到货周期）都在支线上，必须都在被检之列
    expect(drawn.filter((s) => s.lineId === "branch").length).toBeGreaterThan(3);
  });

  it("★ 任意两个标签的包围盒都不重叠（这就是仓主看到的那个毛病，门在这里）", () => {
    const bad: string[] = [];
    for (let i = 0; i < drawn.length; i++) {
      for (let j = i + 1; j < drawn.length; j++) {
        const a = drawn[i]!;
        const b = drawn[j]!;
        if (labelBoxesOverlap(a.labelPos!.box, b.labelPos!.box)) bad.push(`${a.label} × ${b.label}`);
      }
    }
    expect(bad, `站名压字（${bad.length} 对）：${bad.slice(0, 6).join(" | ")}`).toEqual([]);
  });

  it("确实是**上下交替**：同一行里相邻两个标签落在不同侧", () => {
    const byRow = new Map<string, typeof drawn>();
    for (const s of drawn) {
      const k = `${s.lineId}#${s.row}`;
      byRow.set(k, [...(byRow.get(k) ?? []), s]);
    }
    let checked = 0;
    for (const list of byRow.values()) {
      const seq = [...list].sort((a, b) => a.x - b.x);
      for (let i = 1; i < seq.length; i++) {
        expect(seq[i]!.labelPos!.side, `${seq[i - 1]!.label} 与 ${seq[i]!.label} 摆在同一侧 = 没有交替`).not.toBe(
          seq[i - 1]!.labelPos!.side,
        );
        checked++;
      }
    }
    expect(checked, "一对都没比到 ⇒ 恒真的废门").toBeGreaterThan(8);
  });

  /**
   * ★ **真正保证「不压字」的那条不等式** —— 本组最该咬的是它，不是"有没有交替"。
   *
   * 2026-08-10 实测（变异反证时量出来的，写在这里免得下一个人重走一遍）：
   * 把 `side` 强行改成恒 `"above"`（取消上下交替）之后，25 个标签落成 tier0×23 + tier1×2，
   * **重叠数仍是 0**。也就是说在当前站位密度下，**分层才是承重墙，交替是余量**。
   * 工单原本预期「同侧排列 ⇒ 不重叠测试必须红」，实测**不红** —— 该预期基于错误的机制假设。
   *
   * 所以这里补上真正的判据：同侧同层的两个标签相距 `gapX × 车道数`
   * （车道数 = 2 侧 × `maxLabelTiers` 层），它必须容得下**本次载荷里最宽的那个标签**。
   * 这条不等式一旦不成立，压字就是必然的 —— 而它是可算的，不靠"看着没撞上"。
   */
  it("★ 不压字的承重条件：`gapX × 车道数` ≥ 最宽标签 + 间隙（车道 = 2 侧 × 层数）", () => {
    const widest = Math.max(...drawn.map((s) => s.labelPos!.box.w));
    expect(widest, "最宽标签量出来是 0 ⇒ 估宽函数坏了，下面的不等式是恒真的废门").toBeGreaterThan(80);
    const lanes = 2 * METRO_LAYOUT.maxLabelTiers;
    expect(
      METRO_LAYOUT.gapX * lanes,
      `站位间距 ${METRO_LAYOUT.gapX}px × ${lanes} 条车道装不下最宽的标签（${widest.toFixed(0)}px）⇒ 必然压字`,
    ).toBeGreaterThanOrEqual(widest + METRO_LAYOUT.labelGapX);
    // 余量也报出来：低于 1.5× 就该在扩标签数/缩间距之前先加一层或加宽 gapX
    const margin = (METRO_LAYOUT.gapX * lanes) / (widest + METRO_LAYOUT.labelGapX);
    expect(margin, `余量只剩 ${margin.toFixed(2)}× —— 再加标签就要压字了`).toBeGreaterThan(1.5);
  });

  it("行距 / 支线距是从标签带**推出来**的，不是拍脑袋的数（改小即压字）", () => {
    const band = metroLabelBandPx();
    expect(METRO_LAYOUT.rowGap, "行距装不下上下两条标签带 + 走线沟 ⇒ 跨行压字").toBeGreaterThanOrEqual(band * 2 + METRO_LAYOUT.gutterH);
    expect(METRO_LAYOUT.branchGap, "支线距装不下两条标签带 ⇒ 主线与支线的标签会压上").toBeGreaterThanOrEqual(
      band * 2 + METRO_LAYOUT.gutterH,
    );
    expect(METRO_LAYOUT.labelTierGap, "同侧层距小于标签高 ⇒ 分层本身就在压字").toBeGreaterThanOrEqual(METRO_LAYOUT.labelBoxH);
  });

  it("标签整块留在画布内（左右两条竖向走线之内），一个字都不出血", () => {
    for (const s of drawn) {
      const b = s.labelPos!.box;
      expect(b.x, `${s.label} 的标签左出血`).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w, `${s.label} 的标签右出血`).toBeLessThanOrEqual(map.bounds.width);
      expect(b.y, `${s.label} 的标签上出血`).toBeGreaterThanOrEqual(0);
      expect(b.y + b.h, `${s.label} 的标签下出血`).toBeLessThanOrEqual(map.bounds.height);
    }
  });

  it("摆不下就**如实说**（不删标签、不假装不挤）：本次载荷 0 个 overflow", () => {
    const over = drawn.filter((s) => s.labelPos!.overflow);
    expect(over.map((s) => s.label)).toEqual([]);
    expect(
      map.notes.some((n) => n.includes("仍摆不开")),
      "0 个 overflow 时不该无中生有地报挤",
    ).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11.5 WO-CHAIN-MAP-LAYOUT 件二 · **换布局不许弄丢的八项**（一处集中断言，便于复审逐项对）
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * 这张图的价值不在"是圆还是横线"，在下面这八项编码。**换布局时最容易顺手丢掉它们**，
 * 而且丢了以后测试往往照样绿（丢的是表达，不是函数）。故集中咬一遍，删一项即红。
 */
describe("件二 · 换布局不许弄丢的八项", () => {
  it("① 站圈大小 ∝ 该环节吃掉的全链损失占比（半径是引擎 pct 的纯函数）", async () => {
    await mount();
    await screen.findByTestId("clm-canvas");
    expect(domRadius(TOP.stepId)).toBeCloseTo(stationRadius(TOP.pctOfChainLoss), 9);
    expect(domRadius(BOTTOM.stepId)).toBeCloseTo(stationRadius(BOTTOM.pctOfChainLoss), 9);
    expect(domRadius(TOP.stepId)).toBeGreaterThan(domRadius(BOTTOM.stepId));
  });

  /**
   * ①b WO-UI-BURNDOWN-21 · **读图法降浮层，但一个字都没少**
   * （`docs/CONVENTION-ui-information-layering.md` §1 / R-UI-3）
   *
   * 「站 = 环节 · 站圈大小 ∝ 损失占比」是**图例**，属浮层；「范围」是**值**，留第一层。
   * 上面 ① 咬的是半径这个**编码**在不在，它证明不了**图例文字**还在 ——
   * 图例整段删掉，① 照样绿（半径函数没动）。故这里三判据 + 反向断言配一对。
   * ⚠ `InfoPopover` 在 `open===false` 时**不渲染**，故写 `toBeNull()`；
   *   写 `not.toBeVisible()` 是**测试自己抛错**，不是判据成立。
   */
  it("①b 读图法在 `?` 浮层里（默认不在 DOM · hover 后原文一字不少），而「范围」这个值仍在第一层", async () => {
    const user = userEvent.setup();
    await mount();
    await screen.findByTestId("clm-canvas");
    const head = screen.getByTestId("clm-root").querySelector("header")!;

    // 「范围」是值 ⇒ 留第一层（不许跟着图例一起被藏起来）
    expect(head.textContent).toContain("范围");
    expect(screen.getByTestId("clm-scope")).toBeVisible();

    // ① 记号可见 ② 正文默认不在 DOM ④ 反向：图例不许还摆在第一层
    const trigger = screen.getByTestId("info-clm-legend");
    expect(trigger).toBeVisible();
    expect(screen.queryByTestId("clm-legend-body")).toBeNull();
    expect(head.textContent, "图例还留在第一层 ⇒ 没降层").not.toContain("站圈大小");

    // ③ hover 后原文一字不少
    await user.hover(trigger);
    const body = await screen.findByTestId("clm-legend-body");
    expect(body).toBeVisible();
    expect(body.textContent).toContain("站 = 环节");
    expect(body.textContent).toContain("站圈大小 ∝ 该环节吃掉的");
    expect(body.textContent).toContain("全链损失占比");
    // 求解器 key 是**可复验的抓手**，撤掉契约类型名时它必须留着
    expect(body.textContent).toContain(CHAIN_LOSS_SOLVER_KEY);
  });

  it("② 停运站画成**虚线方框 + ✕**（不是一个小一点的圆）", async () => {
    await mount();
    await screen.findByTestId("clm-canvas");
    const map = buildChainLineMap(REAL);
    expect(map.suspended.length).toBeGreaterThan(0);
    const css = readRepo("apps/frontend-shell/src/views/sim/ChainLineMapView.module.css");
    expect(css, "停运方框不再是虚线 ⇒ 与在运站的形状差别没了").toMatch(/\.suspendedBox\s*\{[^}]*stroke-dasharray/);
    for (const s of map.suspended) {
      const g = screen.getByTestId(`clm-suspended-${s.stepId}`);
      expect(g.querySelector("rect"), `停运站 ${s.stepId} 没有方框`).not.toBeNull();
      expect(g.querySelector("path"), `停运站 ${s.stepId} 没有 ✕`).not.toBeNull();
      expect(g.querySelector("circle"), "停运站画成了圆 ⇒ 与「有值的站」混同").toBeNull();
    }
  });

  it("③ 换乘站的**同心圆**标记（外环 + 内心，两个 circle）", async () => {
    await mount();
    await screen.findByTestId("clm-canvas");
    const inter = buildChainLineMap(REAL).stations.filter((s) => s.glyph === "interchange");
    expect(inter.length).toBeGreaterThan(0);
    for (const s of inter) expect(screen.getByTestId(`clm-station-${s.stepId}`).querySelectorAll("circle")).toHaveLength(2);
  });

  it("④ 共线族的**外环 halo**（多条族线共用该环节时出现；单条时一个都没有）", async () => {
    await mount();
    await screen.findByTestId("clm-canvas");
    expect(document.querySelectorAll('[data-testid^="clm-shared-halo-"]'), "单条族线不该有共线标记").toHaveLength(0);
    expect(document.querySelectorAll('[data-shared-families]').length, "共线标记的挂点没了 ⇒ 多族时也不会出现").toBeGreaterThan(0);
    const css = readRepo("apps/frontend-shell/src/views/sim/ChainLineMapView.module.css");
    expect(css, "halo 的样式被删了").toContain(".sharedFamilyHalo");
  });

  it("⑤ 增值段用**不同图元/颜色**，与「占比≈0 的普通站」分得开", async () => {
    await mount();
    await screen.findByTestId("clm-canvas");
    const va = buildChainLineMap(REAL).stations.filter((s) => s.valueAdd);
    expect(va.length).toBeGreaterThan(3);
    for (const s of va) {
      expect(screen.getByTestId(`clm-station-${s.stepId}`)).toHaveAttribute("data-station-kind", "value-add");
      expect(domPctText(s.stepId)).toBe("增值·不进分母");
    }
    const css = readRepo("apps/frontend-shell/src/views/sim/ChainLineMapView.module.css");
    expect(/\.stationValueAdd\s*\{[^}]*fill:\s*var\(--ok\)/.test(css), "增值站不再用正向语义色 ⇒ 与普通站看不出差别").toBe(true);
  });

  it("⑥ 头行的守恒自证（锚点 · Σ · 残差 · 容差 · 站/停运/换乘/增值/返工 计数）", async () => {
    await mount();
    await screen.findByTestId("clm-canvas");
    expect(screen.getByTestId("clm-anchor").textContent).toContain("锚点");
    const cons = screen.getByTestId("clm-conservation");
    expect(cons).toHaveAttribute("data-ok", "1");
    for (const frag of ["损失守恒", "100.000%", "残差", "容差"]) expect(cons.textContent).toContain(frag);
    const stats = screen.getByTestId("clm-stats").textContent ?? "";
    for (const frag of ["站", "停运", "换乘", "增值", "返工"]) expect(stats).toContain(frag);
  });

  it("⑦ 底部「本次载荷的诚实边界（不画没有的东西）」", async () => {
    await mount();
    await screen.findByTestId("clm-canvas");
    const notes = screen.getByTestId("clm-notes");
    expect(notes.textContent).toContain("本次载荷的诚实边界");
    expect(notes.textContent).toContain("不画没有的东西");
    expect(notes.querySelectorAll("li").length).toBeGreaterThan(0);
  });

  it("⑧ AND 门符号 + 「齐套 AND · 全到齐才放行」+ 图例里的 AND ≠ OR 警示", async () => {
    await mount();
    await screen.findByTestId("clm-canvas");
    const join = screen.getByTestId("clm-and-join");
    expect(join).toHaveAttribute("data-join-semantics", "AND");
    expect(within(join).getByTestId("clm-and-gate")).toHaveAttribute("data-glyph", "and-gate");
    expect(join.textContent, "画布上「齐套 AND · 全到齐才放行」这句话没了").toContain("齐套 AND · 全到齐才放行");
    const warn = screen.getByTestId("clm-and-or-warning").textContent ?? "";
    for (const frag of ["OR", "AND", "全部"]) expect(warn).toContain(frag);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. WO-CHAIN-MAP-LAYOUT 件三 · **SVG <title> 已删**（原生 tooltip 滞留遮挡图形）
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * 仓主实拍：「鼠标移走后弹窗没有消失，遮挡了环形图」。
 * 根因 = SVG `<title>` 被浏览器渲染成**原生 tooltip**：操作系统绘制、不受 React 控制、
 * 永远画在最上层、移开后滞留。规范 `docs/CONVENTION-ui-information-layering.md` §2 R-UI-3
 * 因此**禁止**用 HTML `title` 属性 / SVG `<title>` 做任何浮层。
 *
 * 删它的前提是两条**不许退化**：读屏取得到读数、测试取得到读数。本组两条都亲手断言。
 */
describe("件三 · 悬浮层纪律：图上零 <title>，且可达性/测试都不退化", () => {
  it("★ 舞台 SVG 内不存在任何 <title> 元素（变异反证：加回去即红）", async () => {
    await mount();
    const stage = await screen.findByTestId("clm-stage");
    const titles = stage.querySelectorAll("title");
    expect(
      [...titles].map((t) => t.textContent),
      "SVG <title> 又回来了 —— 它是原生 tooltip，移开后会滞留并遮挡图形",
    ).toEqual([]);
  });

  it("整个组件（含图例）里也没有 HTML title 属性充当浮层", async () => {
    await mount();
    const root = await screen.findByTestId("clm-root");
    expect([...root.querySelectorAll("[title]")].map((e) => e.getAttribute("title"))).toEqual([]);
    expect(root.querySelectorAll("title")).toHaveLength(0);
  });

  it("源码级：本组件文件里既无 <title> 也无 title= 属性", () => {
    const raw = readRepo("apps/frontend-shell/src/views/sim/ChainLineMapView.tsx");
    // ⚠ 注释里**必须**能提 `<title>`（文件头那段浮层纪律正是在讲为什么禁它）。
    //   直接扫原文会把「禁令的说明文字」当成「违反禁令」——扫描类结论先自证工具（铁律 0.6）。
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    const code = strip(raw);
    const probe = /<title[\s>]/;
    // 金丝雀 ①：正则本身咬得住真的 <title>
    expect(probe.test('<title data-testid="x">a</title>'), "正则连样例都咬不住 ⇒ 工具坏了，不许报『代码干净』").toBe(true);
    // 金丝雀 ②：去注释之后代码还在（strip 若把全文吃掉，下面的否定结论就是假的）
    expect(code, "去注释把代码也删了 ⇒ 工具坏了").toContain("clm-station-");
    // 金丝雀 ③：strip 不会把**代码里**的 <title> 一并抹掉
    expect(probe.test(strip('/* 注释里提 <title> */\nconst a = <title>x</title>;')), "strip 连代码里的 <title> 都吃了").toBe(true);
    expect(probe.test(code), "组件代码里仍有 <title> 元素").toBe(false);
    expect(/\stitle=\{/.test(code) || /\stitle="/.test(code), "组件代码里仍有 HTML title 属性").toBe(false);
  });

  it("★ 可达性不退化：**每一个**站（含无名站）的 accessible name 都还在，且带读数", async () => {
    await mount();
    await screen.findByTestId("clm-canvas");
    const map = buildChainLineMap(REAL);
    const unnamed = map.stations.filter((s) => !s.labelled);
    expect(unnamed.length, "全都标了名 ⇒ 本用例咬不到「无名站」这个真正的风险点").toBeGreaterThan(3);
    for (const s of map.stations) {
      const g = screen.getByTestId(`clm-station-${s.stepId}`);
      // role="img" 下 aria-label 就是 accessible name（<title> 只有在没有 aria-label 时才顶上）
      expect(g).toHaveAttribute("role", "img");
      const name = g.getAttribute("aria-label") ?? "";
      expect(name, `站 ${s.stepId} 的可达名丢了`).toContain(s.label);
      // 读数必须与屏上那一行**同义**：增值段读「不进分母」，其余读百分比。
      // 增值段若读成「占全链损失 —」，听起来是"取不到数"，而事实是"根本不进这个分母"——
      // 屏上分得开、可达名却糊成一样，就是拿可达性换省事。
      expect(name, `站 ${s.stepId} 的可达名里没有读数`).toContain(
        s.valueAdd ? "增值·不进分母" : formatPct(s.pctOfChainLoss),
      );
    }
    // 增值段逐个再咬一次：可达名里**不许**出现「占全链损失」这个措辞
    const va = map.stations.filter((s) => s.valueAdd);
    expect(va.length, "载荷里没有增值段 ⇒ 上面那条分支是恒真的废门").toBeGreaterThan(3);
    for (const s of va) {
      const name = screen.getByTestId(`clm-station-${s.stepId}`).getAttribute("aria-label") ?? "";
      expect(name, `增值站 ${s.stepId} 的可达名把「不进分母」读成了「占全链损失 —」`).not.toContain("占全链损失");
    }
    for (const s of map.suspended) {
      const name = screen.getByTestId(`clm-suspended-${s.stepId}`).getAttribute("aria-label") ?? "";
      expect(name).toContain(s.label);
      expect(name, "停运站位的可达名必须说清它是断点").toContain("停运");
    }
    // 读屏可枚举：按 role 查得到全部站（不是只有标了名的那几个）
    expect(screen.getAllByRole("img").length).toBeGreaterThanOrEqual(map.stations.length + map.suspended.length);
  });

  it("★ 测试不退化：每一个站的读数都能从 data-pct / data-pct-text 取到（含无名站）", async () => {
    await mount();
    await screen.findByTestId("clm-canvas");
    const map = buildChainLineMap(REAL);
    for (const s of map.stations) {
      const g = screen.getByTestId(`clm-station-${s.stepId}`);
      expect(g.getAttribute("data-pct")).toBe(s.pctOfChainLoss === null ? "" : String(s.pctOfChainLoss));
      expect(g.getAttribute("data-pct-text")).toBe(s.valueAdd ? "增值·不进分母" : formatPct(s.pctOfChainLoss));
    }
  });

  it("悬浮面板是**受控**的：移开即消失（不是原生 tooltip 那种滞留）", async () => {
    const user = userEvent.setup();
    await mount();
    await screen.findByTestId("clm-canvas");
    const g = screen.getByTestId(`clm-station-${TOP.stepId}`);
    await user.hover(g);
    expect(screen.getByTestId("clm-detail-title")).toHaveTextContent(
      buildChainLineMap(REAL).stations.find((s) => s.stepId === TOP.stepId)!.label,
    );
    await user.unhover(g);
    // 移开 ⇒ 面板立刻回到空闲态；DOM 里不留任何残影节点
    expect(screen.getByTestId("clm-detail-idle")).toBeInTheDocument();
    expect(screen.queryByTestId("clm-detail-title")).toBeNull();
  });
});
