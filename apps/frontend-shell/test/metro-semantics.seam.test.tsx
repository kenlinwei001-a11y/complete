import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BUSINESS_TYPE_LABEL, BusinessTypeSchema } from "@platform/contracts";

/**
 * WO-SANDBOX-METRO-SEMANTICS · 线路图**环形化** + **产品族同心环** + **在途时序可算性分级** SEAM 门。
 *
 * ── 头号判据 ──────────────────────────────────────────────────────────────────
 * **① 形要真是环**：站位必须落在椭圆上（用椭圆方程逐点验，不是"看着像"）；区间必须是弧不是弦。
 * **② 三圈必须是三条真链**：三个锚点 → 三次求解器 → 三份不同载荷。
 *    画三个颜色一样的环冒充三条族线 = 退单，故断言「同一 stepId 在三圈上坐标必须不同」。
 * **③ 共线换乘是可算的，不是装饰**：只有「在每一圈上都出现」的环节才带共线标记；单圈恒零。
 * **④ 闭环段必须与实测边分得开**：`state="closure"` + 独立 class + `closureBasis` 原文
 *    （引擎给的是有序链不是环，这条边是结构推定）。
 * **⑤ 时序可算性分级不许被抹平**：只有到货日、没有发运日的批次，**渲染结果不得包含区间位置**
 *    —— 这是设计稿那个「匀速滑块」被拒绝的唯一理由，也是本单的 SEAM 咬点。
 */

const net = vi.hoisted(() => ({
  byAnchor: new Map<string, unknown>(),
  base: null as unknown,
  imp: null as unknown,
  orders: [] as { props: Record<string, unknown> }[],
  calls: [] as { key: string; args: Record<string, unknown> }[],
  failFamily: false,
}));

vi.mock("@/api/endpoints", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/endpoints")>();
  return {
    ...actual,
    runSolver: vi.fn(async (key: string, args: Record<string, unknown>) => {
      net.calls.push({ key, args });
      if (key === "chain_impediments") return { data: net.imp, snapshotVersion: "sv" };
      const so = typeof args.so === "string" ? args.so : null;
      if (so !== null) {
        if (net.failFamily) throw { error: { code: "BOOM", message: "族线求解器炸了", requestId: "req_f" } };
        return { data: net.byAnchor.get(so) ?? net.base, snapshotVersion: "sv" };
      }
      return { data: net.base, snapshotVersion: "sv" };
    }),
    searchObjects: vi.fn(async () => ({ items: net.orders, total: net.orders.length })),
    createSimSession: vi.fn(async (b: { baseSnapshot: unknown }) => ({
      id: "s1", tenantId: "t", baseSnapshot: b.baseSnapshot, scope: {}, status: "READY",
      curTick: 0, parentCheckpointId: null, createdAt: "2026-06-25T00:00:00.000Z",
    })),
    simTick: vi.fn(async (_i: string, n: number) => ({ curTick: n, state: {} })),
    fetchSimCertification: vi.fn(async () => { throw new Error("cert off"); }),
  };
});

import SandboxView from "@/views/sim/SandboxView";
import { ChainLineMapView, labelledStepIds, MAX_LABELS_PER_RING } from "@/views/sim/ChainLineMapView";
import {
  buildChainLineMap,
  ChainLossPayloadSchema,
  RING_LAYOUT,
  ringAngle,
  ringOffsets,
  MAX_FAMILY_RINGS,
  type ChainLossPayload,
} from "@/views/sim/chainLineMap";
import { deriveFamilyAnchors, familyIdentityOf } from "@/views/sim/chainFamilyLines";
import { TRANSIT_SOURCE_SPECS, parseShipmentRows, parseInterBaseTransferRows, simulateTransit } from "@/views/sim/transitFlow";

// ── fixture ───────────────────────────────────────────────────────────────────
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = (() => {
  let d = TEST_DIR;
  for (let i = 0; i < 8; i++) {
    try { readFileSync(join(d, "pnpm-workspace.yaml")); return d; } catch { const u = dirname(d); if (u === d) break; d = u; }
  }
  throw new Error("找不到仓根");
})();
const FIX = join(REPO_ROOT, "apps/frontend-shell/test/fixtures");
const loadLoss = (): ChainLossPayload =>
  ChainLossPayloadSchema.parse(JSON.parse(readFileSync(join(FIX, "chain-loss-real.json"), "utf8")));
const loadImp = () => {
  const raw = JSON.parse(readFileSync(join(FIX, "chain-impediment-baseline.json"), "utf8")) as Record<string, unknown>;
  delete raw.__fixture_provenance;
  return raw;
};

/** 造一份「与基线不同」的载荷（族线必须真的不一样，否则三圈就是同一条画三遍）。 */
function variantOf(base: ChainLossPayload, factor: number): ChainLossPayload {
  return {
    ...base,
    anchor: { ...(base.anchor ?? {}), so: `SO-VAR-${factor}` },
    // WO-LEADTIME-SPLIT：前置期已拆成两个指标，这里造差异用**交付前置期**（默认展示的那个）。
    // 现金周转期同步 +factor 以保住恒等式 `现金周转期 = 交付前置期 + 结算段`（结算段不动）。
    totals:
      base.totals === undefined
        ? undefined
        : {
            ...base.totals,
            deliveryLeadTimeDays: base.totals.deliveryLeadTimeDays + factor,
            cashConversionDays: base.totals.cashConversionDays + factor,
          },
  };
}

const CFG = {
  tenantId: "t", nodeTypes: ["A"], linkTypes: [], stateVars: ["v"],
  radarDims: [{ key: "structure", label: "结构" }],
  screens: ["sandbox"], propagationCount: 0,
} as never;

function mountConsole() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SandboxView injectedConfig={CFG} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  const base = loadLoss();
  net.base = base;
  net.imp = loadImp();
  net.byAnchor = new Map<string, unknown>([
    ["SO-A", variantOf(base, 1)],
    ["SO-B", variantOf(base, 2)],
    ["SO-C", variantOf(base, 3)],
  ]);
  // 三个业务类型各两张单，锚点应取 so 字典序最小那张
  net.orders = [
    { props: { so: "SO-B", businessType: "commercial" } },
    { props: { so: "SO-B9", businessType: "commercial" } },
    { props: { so: "SO-A", businessType: "passenger" } },
    { props: { so: "SO-A9", businessType: "passenger" } },
    { props: { so: "SO-C", businessType: "storage" } },
    { props: { so: "SO-Z", businessType: "not-a-real-type" } },
  ];
  net.calls.length = 0;
  net.failFamily = false;
});
afterEach(() => cleanup());

// ══════════════════════════════════════════════════════════════════════════════
describe("§1 · 形：站真的落在环上（几何自证，不是「看着像」）", () => {
  it("每个主干站满足椭圆方程 ((x−cx)/(rx·k))² + ((y−cy)/(ry·k))² == 1", () => {
    const map = buildChainLineMap(loadLoss());
    const trunk = map.stations.filter((s) => s.lineId === "trunk");
    expect(trunk.length).toBeGreaterThan(3);
    for (const s of trunk) {
      const dx = (s.x - RING_LAYOUT.cx) / RING_LAYOUT.rx;
      const dy = (s.y - RING_LAYOUT.cy) / RING_LAYOUT.ry;
      expect(Math.hypot(dx, dy), `站 ${s.stepId} 不在环上（半径 ${Math.hypot(dx, dy).toFixed(4)}）`).toBeCloseTo(1, 6);
    }
  });

  it("站沿环**均分整圈**：角度 == ringAngle(index, 站位总数)（不是把直线弯一下）", () => {
    const map = buildChainLineMap(loadLoss());
    const total = map.lines.find((l) => l.lineId === "trunk")!.slotCount;
    // ⚠ 站位序列里**混着停运站位**（它们也占一个位置），所以不能拿"相邻 station 的角差"当步长——
    //   那会在跨过一个停运站位时读到 2 倍步长。判据必须是「角度 == index 的函数」。
    const onRing = [...map.stations, ...map.suspended].filter((s) => s.lineId === "trunk");
    expect(onRing.length).toBe(total);
    for (const s of onRing) expect(s.angle, `站位 ${s.stepId} 的角度不等于 ringAngle(${s.index})`).toBeCloseTo(ringAngle(s.index, total), 9);
    // 整圈确实被均分掉了：最大 index 的角度 = 起点 + 2π·(N−1)/N
    const last = onRing.reduce((a, b) => (a.index > b.index ? a : b));
    expect(last.angle - RING_LAYOUT.startAngle).toBeCloseTo((Math.PI * 2 * (total - 1)) / total, 9);
  });

  it("区间是**椭圆弧**（path 带 A 命令），不是两点之间的弦", () => {
    const map = buildChainLineMap(loadLoss());
    const live = map.segments.filter((s) => s.state !== "closure");
    expect(live.length).toBeGreaterThan(0);
    for (const seg of live) {
      expect(seg.path, `区间 ${seg.segmentId} 没有弧 path`).toBeTruthy();
      expect(seg.path!, `区间 ${seg.segmentId} 画成了直线（弦会从环内穿过去）`).toContain(" A ");
    }
  });

  it("闭环段：存在、state=closure、且 closureBasis 明说是**结构推定**（不是引擎给的边）", () => {
    const map = buildChainLineMap(loadLoss());
    const closure = map.segments.filter((s) => s.state === "closure");
    expect(closure).toHaveLength(1);
    expect(map.closureBasis).toBeTruthy();
    expect(map.closureBasis!).toContain("结构推定");
    expect(map.closureBasis!, "必须说清引擎给的是有序链、载荷里没有这条边").toContain("有序链");
  });

  it("标签减密：**减的是标签不是站** —— 站与读数一个不少，只是名字改为悬浮出", async () => {
    const map = buildChainLineMap(loadLoss());
    expect(map.stats.stationCount, "fixture 站数应超过标签上限，否则本用例咬不到东西").toBeGreaterThan(MAX_LABELS_PER_RING);

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ChainLineMapView />
      </QueryClientProvider>,
    );
    await screen.findByTestId("clm-summary");

    // ① 站一个不少
    expect(document.querySelectorAll('[data-testid^="clm-station-"]')).toHaveLength(map.stats.stationCount);
    // ② 每个站的读数节点都在（有名的画成 text，无名的画成 title —— 读屏与测试都取得到）
    for (const s of map.stations) expect(screen.getByTestId(`clm-pct-${s.stepId}`), `站 ${s.stepId} 的读数丢了`).toBeTruthy();
    // ③ 真正被标名字的只有前 N 个（按引擎 pct 降序），不是随手截断
    const labelled = labelledStepIds(map, true);
    expect(labelled.size).toBe(MAX_LABELS_PER_RING);
    const topByPct = [...map.stations]
      .sort((a, b) => (b.pctOfChainLoss ?? -1) - (a.pctOfChainLoss ?? -1) || (a.stepId < b.stepId ? -1 : 1))
      .slice(0, MAX_LABELS_PER_RING)
      .map((s) => s.stepId);
    expect([...labelled].sort()).toEqual(topByPct.sort());
    // ④ 屏上必须说清楚"减的是标签不是站"
    expect(screen.getByTestId("clm-label-thinning").textContent ?? "").toContain("减的是标签不是站");
  });

  it("停运站位（断点）**不参与减标**：算不出来这件事必须一直看得见", async () => {
    const map = buildChainLineMap(loadLoss());
    expect(map.suspended.length).toBeGreaterThan(0);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ChainLineMapView />
      </QueryClientProvider>,
    );
    await screen.findByTestId("clm-summary");
    // 单圈 = 标签圈，故每个停运站位都应带可见的「停运」文案
    const txt = screen.getByTestId("clm-stage").textContent ?? "";
    for (const s of map.suspended) expect(txt, `停运站位 ${s.stepId} 的名字被减掉了`).toContain(s.label);
  });

  it("环形化后 AND ≠ OR 那条诚实位一个字没丢（重组不许弄丢既有诚实标记）", () => {
    const map = buildChainLineMap(loadLoss());
    expect(map.andJoin?.basis ?? "").toContain("结构推定");
    expect(map.andJoin?.semantics).toBe("AND");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("§2 · 三圈同心环 = 三条真链（不是同一条画三遍）", () => {
  it("锚点派生：每族取 so 字典序最小的真实单；族序 = 契约枚举序；不合枚举的丢掉且计数", () => {
    const { anchors, unknownTypeCount } = deriveFamilyAnchors(net.orders);
    expect(anchors.map((a) => a.key)).toEqual(BusinessTypeSchema.options.filter((k) => ["passenger", "commercial", "storage"].includes(k)));
    expect(anchors.find((a) => a.key === "passenger")!.so).toBe("SO-A");
    expect(anchors.find((a) => a.key === "commercial")!.so).toBe("SO-B");
    expect(anchors.map((a) => a.label)).toEqual(anchors.map((a) => BUSINESS_TYPE_LABEL[a.key]));
    expect(unknownTypeCount, "businessType 不合契约枚举的那张单必须被计数而不是静默塞进某一族").toBe(1);
  });

  it("三圈的**半径系数互不相同** ⇒ 同一环节在三圈上坐标必然不同（画三个同心圆才有意义）", () => {
    const offs = ringOffsets(3);
    expect(new Set(offs).size).toBe(3);
    const base = loadLoss();
    const maps = offs.map((_, i) =>
      buildChainLineMap(base, { family: familyIdentityOf({ key: "passenger", label: "乘用车", so: "SO-A" }, i, 3) }),
    );
    const sid = maps[0]!.stations[0]!.stepId;
    const pts = maps.map((m) => m.stations.find((s) => s.stepId === sid)!);
    expect(new Set(pts.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`)).size, "三圈把同一个站画在了同一个点上 = 三个环重合").toBe(3);
    expect(pts.map((p) => p.ringIndex)).toEqual([0, 1, 2]);
  });

  it("传 familyAnchors → **每族各发一次** chain_loss_attribution（args.so 逐个匹配）", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ChainLineMapView
          familyAnchors={[
            { key: "passenger", label: "乘用车", so: "SO-A" },
            { key: "commercial", label: "商用车", so: "SO-B" },
            { key: "storage", label: "储能", so: "SO-C" },
          ]}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("clm-family-status").getAttribute("data-family-state")).toBe("ready"));
    const sos = net.calls.filter((c) => typeof c.args.so === "string").map((c) => c.args.so);
    expect(sos.sort()).toEqual(["SO-A", "SO-B", "SO-C"]);
    // 三圈都在 DOM 里，各自带族键与锚点单号
    for (const k of ["passenger", "commercial", "storage"]) {
      expect(screen.getByTestId(`clm-ring-layer-${k}`)).toBeTruthy();
    }
  });

  it("共线换乘可算：**每圈都出现**的环节才带共线标记；单圈时一个都没有", async () => {
    // 单圈：零共线标记（一条线谈不上"共线"）
    const single = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ChainLineMapView />
      </QueryClientProvider>,
    );
    await screen.findByTestId("clm-summary");
    expect(document.querySelectorAll('[data-shared-families="1"]')).toHaveLength(0);
    single.unmount();

    // 三圈：三份载荷 stepId 集合相同 ⇒ 每个站都是共线换乘
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ChainLineMapView
          familyAnchors={[
            { key: "passenger", label: "乘用车", so: "SO-A" },
            { key: "commercial", label: "商用车", so: "SO-B" },
            { key: "storage", label: "储能", so: "SO-C" },
          ]}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("clm-family-status").getAttribute("data-family-state")).toBe("ready"));
    expect(document.querySelectorAll('[data-shared-families="1"]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-testid^="clm-shared-halo-"]').length).toBeGreaterThan(0);
  });

  it("族线取数失败 → 主链那一圈**照常画**，只在状态条说明（不因族线失败打成空态）", async () => {
    net.failFamily = true;
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ChainLineMapView familyAnchors={[{ key: "passenger", label: "乘用车", so: "SO-A" }]} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("clm-family-status").getAttribute("data-family-state")).toBe("error"));
    expect(screen.getByTestId("clm-stage")).toBeTruthy();
    expect(document.querySelectorAll('[data-testid^="clm-station-"]').length).toBeGreaterThan(0);
    expect(screen.getByTestId("clm-family-status").textContent ?? "").toContain("主链那一圈照常画");
  });

  it("环圈数有上限：族数超过 MAX_FAMILY_RINGS 时截断并**明说**，不静默丢", () => {
    const many = Array.from({ length: MAX_FAMILY_RINGS + 2 }, (_, i) => ({ props: { so: `SO-${i}`, businessType: BusinessTypeSchema.options[i % 3] } }));
    const { anchors } = deriveFamilyAnchors(many);
    expect(anchors.length).toBeLessThanOrEqual(MAX_FAMILY_RINGS);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("§3 · 在途/在制 时序可算性分级（替代设计稿那个假时钟）", () => {
  it("SEAM 咬点 · 只有 etaDay、没有 dispatchDay 的批次 ⇒ 渲染结果**不得包含区间位置**", () => {
    // Shipment：对象只有 etaDay + baseId（实测字段），没有发运日、没有起运地
    const parsed = parseShipmentRows([{ props: { shipId: "SH-1", baseId: "b1", etaDay: 9, qtyTons: 3 } }]);
    expect(parsed.accepted).toBe(1);
    const b = parsed.batches[0]!;
    expect(b.dispatchDay, "Shipment 不该被补一个发运日").toBeNull();
    expect(b.originNodeId, "Shipment 不该被编一个起运地").toBeNull();

    const frame = simulateTransit({ batches: parsed.batches, stations: [{ nodeId: "b1", label: "b1", labelSource: "raw-id", origin: "data-row" }] }, 4);
    const v = frame.vehicles.find((x) => x.batchId === b.batchId)!;
    expect(v.progress, "只有到货日却算出了 0–1 区间位置 ⇒ 那条进度条是纯发明的").toBeNull();
    expect(v.segmentId, "没有起运地却给了一个区间 id").toBeNull();
    expect(v.mode).toBe("arrival-only");

    // 对照组：三件套齐全的 InterBaseTransfer 必须真的能算出区间位置（否则这道门就是恒真的废门）。
    // 字段按 contracts `InterBaseTransferSchema` 补齐 —— 该解析器直接走契约 schema，不手写第二套守卫。
    const ok = parseInterBaseTransferRows([
      {
        props: {
          transferId: "IT-1", fromBase: "b1", toBase: "b2", model: "M1", qty: 5, transitDays: 6,
          status: "IN_TRANSIT", dispatchDate: "2026-06-01", dispatchDay: 2, etaDay: 8, etaDate: "2026-06-07", reason: "调剂",
        },
      },
    ]);
    expect(ok.accepted, `对照组被判不可用 ⇒ 这道门会变成恒真的废门：${ok.rejectReasons.join(" | ")}`).toBe(1);
    const okFrame = simulateTransit(
      { batches: ok.batches, stations: [
        { nodeId: "b1", label: "b1", labelSource: "raw-id", origin: "data-row" },
        { nodeId: "b2", label: "b2", labelSource: "raw-id", origin: "data-row" },
      ] },
      5,
    );
    const okV = okFrame.vehicles.find((x) => x.batchId === ok.batches[0]!.batchId)!;
    expect(okV.progress, "三件套齐全的批次必须能算出区间位置").toBeCloseTo(0.5, 6);
    expect(okV.segmentId).toBe("b1→b2");
  });

  it("三档判据上屏，且 modeReason **逐字**等于 transitFlow 单一来源（前端不许改写一个字）", async () => {
    mountConsole();
    await screen.findByTestId("sandbox-console");
    // 图层默认关 → 分级说明不在 DOM（关着不该有东西）
    expect(screen.queryByTestId("sc-transit-tiers")).toBeNull();
    (screen.getByTestId("sc-transit-toggle").querySelector("input") as HTMLInputElement).click();
    const box = await screen.findByTestId("sc-transit-tiers");
    expect(box).toBeTruthy();
    for (const spec of TRANSIT_SOURCE_SPECS) {
      const el = screen.getByTestId(`sc-transit-reason-${spec.key}`);
      expect(el.textContent, `${spec.key} 的 modeReason 被前端改写了`).toBe(spec.modeReason);
      expect(screen.getByTestId(`sc-transit-tier-${spec.key}`).getAttribute("data-mode")).toBe(spec.mode);
    }
    // 节拍与采购两条也要在（它们是分级表的第 ④⑤ 档，读者得知道这两档存在且**不画**）
    expect(screen.getByTestId("sc-transit-tier-cadence")).toBeTruthy();
    expect(screen.getByTestId("sc-transit-tier-procurement")).toBeTruthy();
    // ⚠ WO-STALE-CLAIMS：但这两档**不许复述状态**。
    //   它们此前渲染的是 `CADENCE_ABSENCE.reason` —— `deriveXxx()` **零输入**那一档的原话
    //   （恒 `NOT_FETCHED`：「本层没去取 / 没人问」）。而紧挨着本图例渲染的 `<TransitFlowView>`
    //   自己发四条 `searchObjects` 真去取了。于是同一屏两句话互相打脸：图例说没人去取，
    //   它下面的图层正在取。本体 §8 `G-STALE-MEASURED-CLAIM` 的又一形态 ——
    //   这次过期的不是上游事实，是**同一屏里的邻居**。
    for (const key of ["cadence", "procurement"]) {
      const t = screen.getByTestId(`sc-transit-reason-${key}`).textContent ?? "";
      for (const stale of ["没去取", "没人问", "一条都没查过", "一份都没给"]) {
        expect(t, `图例 ④⑤ 又在复述零输入基线的原话「${stale}」—— 而它下面的图层正在真取数`).not.toContain(stale);
      }
      expect(t, "图例得指明现时状态归谁说").toMatch(/图层/);
    }
    // 明说"设计稿那个时钟被拒绝"，别让下一个人再照着画一遍
    expect(screen.getByTestId("sc-transit-tier-intro").textContent ?? "").toContain("被明确拒绝的画法");
  });

  it("控制台**不另造时钟**：画布工具条里没有 D+ 读数 / 倍速档（播控只由图层提供）", async () => {
    mountConsole();
    await screen.findByTestId("sandbox-console");
    const bar = screen.getByTestId("sc-canvas-pane").textContent ?? "";
    expect(bar).not.toContain("D+");
    for (const sp of ["1×", "4×", "16×"]) expect(bar).not.toContain(sp);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("§4 · 控制台里的族线开关（代价必须明写）", () => {
  it("默认关 = 零额外请求；打开后才发族线请求，且屏上写明多发了几次", async () => {
    mountConsole();
    await screen.findByTestId("sandbox-console");
    await waitFor(() => expect(screen.getByTestId("clm-summary")).toBeTruthy());
    expect(net.calls.filter((c) => typeof c.args.so === "string"), "族线开关关着却发了族线请求").toHaveLength(0);

    (screen.getByTestId("sc-family-toggle").querySelector("input") as HTMLInputElement).click();
    await waitFor(() => expect(screen.getByTestId("clm-family-status").getAttribute("data-family-state")).toBe("ready"));
    const txt = screen.getByTestId("clm-family-status").textContent ?? "";
    expect(txt).toContain("额外");
    expect(txt).toContain("次求解器调用");
    expect(net.calls.filter((c) => typeof c.args.so === "string").length).toBe(3);
  });
});
