import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithClient as render } from "./utils";

/**
 * WO-TRANSIT-GEOMETRY · **在途图层几何与线路图站点对齐** SEAM 门。
 *
 * ── 这道门咬什么（不是"存在一个元素"）─────────────────────────────────────────
 * ① **可算区间位置的批次，屏上坐标必须真落在该区间的弧上** —— 拿椭圆参数方程逐点验，
 *    并且验的是**弧长参数**：`progress` 在弧长上的比例，不是角度比例、更不是弦的线性插值。
 * ② **只有到站日的批次，图元不许落进任何区间** —— 拿"到每条弧的最近距离"验，不是看颜色。
 *    它只能挂在站上（沿半径离开环）。这是本层最值钱那条判据（时序可算性三级）的**几何化**：
 *    "不画一辆匀速前进的车"从此不是靠自觉，是画法本身做不到。
 * ③ **三类图元形状互不相同** —— `data-glyph` / `data-glyph-shape` 三值互异，
 *    且底层图形结构不同（三角 3 顶点 path / 菱形 4 顶点 path / 横条 rect）。
 *    只靠颜色深浅区分会被读成"同一种东西弱一点"，而它们是三种**位置精度**。
 * ④ **坐标单源** —— DOM 上的坐标与 `chainLineMap.ts` 的导出**逐字节相同**，
 *    且在途层源码里不存在第二份"极坐标→画布坐标"的推导。
 *
 * ── 变异反证（交付报告里逐条给了红的原文）────────────────────────────────────
 * · 给 `Shipment` 编一个起运地 + 发运日让它能沿区间滑 ⇒ §2 全组红（本门的头号咬点）。
 * · 把 `ringArcPointAt` 换成弦的线性插值 ⇒ §1「落在弧上」当场红（弦中点离弧 85px）。
 * · 把弧长参数换成角度线性插值 ⇒ §1「等时步 = 等弧长步」红（角度步差 21%）。
 */

// ── 与线路图**同一套**几何单源（测试也不自己写一份三角函数）────────────────────
import {
  RING_ARC_TOLERANCE_PX,
  RING_LAYOUT,
  ringArcLength,
  ringArcPointAt,
  ringPoint,
  ringSegmentArc,
  ringStationAnchors,
} from "@/views/sim/chainLineMap";
import { TransitFlowLayer, TRANSIT_GLYPHS } from "@/views/sim/TransitFlowLayer";
import { TRANSIT_SOURCE_SPECS, resolveStations, parseInterBaseTransferRows } from "@/views/sim/transitFlow";
import type { TransitNodeInput } from "@/views/sim/transitFlow";

const TEST_FILE = import.meta.url.startsWith("file:") ? fileURLToPath(import.meta.url) : import.meta.url;
const REPO_ROOT = (() => {
  let dir = dirname(TEST_FILE);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(`[transit-geometry.seam] 找不到仓根（自 ${TEST_FILE} 向上未见 pnpm-workspace.yaml）`);
})();
const readRepo = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

// ── 造数据：形状照三个对象的**实测字段**（与 transit-flow.seam 同一套，不另发明）──
function xfer(o: { id: string; from: string; to: string; dispatchDay: number; etaDay: number }) {
  return {
    transferId: o.id,
    fromBase: o.from,
    toBase: o.to,
    model: "4680-NCM",
    qty: 1000,
    transitDays: o.etaDay - o.dispatchDay,
    status: "IN_TRANSIT" as const,
    dispatchDate: "2026-06-11",
    dispatchDay: o.dispatchDay,
    etaDay: o.etaDay,
    etaDate: "2026-06-20",
    reason: "产能调剂",
  };
}
/** `Shipment` 实测字段：**没有发运日、没有起运地**。 */
const shipment = (o: { id: string; baseId: string; etaDay: number }) => ({
  shipId: o.id,
  baseId: o.baseId,
  etaDay: o.etaDay,
  status: "IN_TRANSIT",
  qtyTons: 200,
  coverageDays: 5,
});
/** `WIPLot` 实测字段：**没有任何 eta**。 */
const wipLot = (o: { id: string; currentProcess: string }) => ({
  lotId: o.id,
  woId: "WO-1",
  modelId: "4680-NCM",
  lineId: "LINE-1",
  currentProcess: o.currentProcess,
  qty: 500,
  status: "在制",
  startTime: "2026-06-10",
  lastMoveTime: "2026-06-12",
});

/**
 * 混合三源的一份场景（**必须三源同时在场**：本单要证的正是"同一个环上三类图元互不冒充"，
 * 只喂一源等于把接缝绕开）。站点 = 数据行自带 key 的并集，字典序 ⇒
 * `base-a`(0) `base-b`(1) `base-c`(2) `proc-x`(3)，四站均分整圈。
 */
const SOURCES = {
  interBaseTransfer: [xfer({ id: "IT-1", from: "base-a", to: "base-b", dispatchDay: 0, etaDay: 8 })],
  shipment: [
    shipment({ id: "SH-far", baseId: "base-c", etaDay: 9 }),
    // 目的地**恰好是区间的终点站** —— 最坏情形：徽标离那条弧最近的时候也必须离得开
    shipment({ id: "SH-onseg", baseId: "base-b", etaDay: 5 }),
  ],
  wipLot: [wipLot({ id: "LOT-1", currentProcess: "proc-x" })],
};
const STATION_KEYS = ["base-a", "base-b", "base-c", "proc-x"] as const;
const ANCHORS = ringStationAnchors([...STATION_KEYS]);
const ARC = ringSegmentArc(ANCHORS[0]!, ANCHORS[1]!, "base-a→base-b");

const num = (el: Element | null, attr: string): number => Number(el?.getAttribute(attr) ?? Number.NaN);

/** 椭圆残差：1 = 恰好在环上，<1 = 在环内，>1 = 在环外。 */
function ellipseResidual(x: number, y: number, k = 1): number {
  return Math.hypot((x - RING_LAYOUT.cx) / (RING_LAYOUT.rx * k), (y - RING_LAYOUT.cy) / (RING_LAYOUT.ry * k));
}

/** 点到一条弧的最近距离（密采样 —— 弧无闭式最近点，采样够密即可作下界判据）。 */
function distanceToArc(x: number, y: number, a0: number, a1: number, k: number, samples = 2000): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= samples; i++) {
    const p = ringPoint(a0 + ((a1 - a0) * i) / samples, k);
    best = Math.min(best, Math.hypot(p.x - x, p.y - y));
  }
  return best;
}

/** 站上图元离开环的最小间距（px）—— 低于它就该被读成"在区间上"，本门据此判"没落进区间"。 */
const OFF_RING_MIN_PX = 12;

// ══════════════════════════════════════════════════════════════════════════════
describe("§1 · 可算区间位置的批次：屏上坐标真落在该区间的**弧**上（弧长参数化）", () => {
  it("坐标逐字节 == chainLineMap 的 ringArcPointAt（坐标只有一处实现，图层没有算第二遍）", () => {
    render(<TransitFlowLayer sources={SOURCES} initialDay={4} />);
    const car = screen.getByTestId("transit-car-IT-1");
    expect(car.getAttribute("data-progress"), "第 4 天 / 0→8 天行程 ⇒ 50%").toBe("0.5000");
    expect(car.getAttribute("data-segment-id")).toBe("base-a→base-b");

    const p = ringArcPointAt(ARC.a0, ARC.a1, ARC.k, 0.5);
    expect(car.getAttribute("data-x"), "车的 x 不是单源算出来的").toBe(p.x.toFixed(2));
    expect(car.getAttribute("data-y"), "车的 y 不是单源算出来的").toBe(p.y.toFixed(2));
  });

  it("落在椭圆弧上：椭圆方程残差 == 1，且角度严格落在该区间的 [a0, a1] 内", () => {
    render(<TransitFlowLayer sources={SOURCES} initialDay={4} />);
    const car = screen.getByTestId("transit-car-IT-1");
    const x = num(car, "data-x");
    const y = num(car, "data-y");
    // DOM 上坐标是 toFixed(2)，量化噪声 ≤0.005px ⇒ 残差误差 ~2e-5，故取 4 位
    expect(ellipseResidual(x, y, ARC.k), `车不在环上（残差 ${ellipseResidual(x, y, ARC.k)}）`).toBeCloseTo(1, 4);

    const ang = num(car, "data-angle");
    expect(ang).toBeGreaterThan(ARC.a0);
    expect(ang).toBeLessThan(ARC.a1);
    // 到该弧的距离 ~0（它就在弧上）
    expect(distanceToArc(x, y, ARC.a0, ARC.a1, ARC.k)).toBeLessThan(0.5);
  });

  it("★ 是**弧长**参数不是角度参数：走过的弧长比例 == progress（容差 = RING_ARC_TOLERANCE_PX）", () => {
    render(<TransitFlowLayer sources={SOURCES} initialDay={4} />);
    const ang = num(screen.getByTestId("transit-car-IT-1"), "data-angle");
    const travelled = ringArcLength(ARC.a0, ang, ARC.k);
    expect(
      Math.abs(travelled - 0.5 * ARC.lengthPx),
      `走过弧长 ${travelled.toFixed(4)}px ≠ 半程 ${(ARC.lengthPx / 2).toFixed(4)}px`,
    ).toBeLessThanOrEqual(RING_ARC_TOLERANCE_PX);
  });

  it("★ **不是弦**：车点离弦中点 >20px，且弦中点根本不在环上（弦会从环内穿过去）", () => {
    render(<TransitFlowLayer sources={SOURCES} initialDay={4} />);
    const car = screen.getByTestId("transit-car-IT-1");
    const x = num(car, "data-x");
    const y = num(car, "data-y");
    const p0 = ringPoint(ARC.a0, ARC.k);
    const p1 = ringPoint(ARC.a1, ARC.k);
    const chordMid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    expect(Math.hypot(x - chordMid.x, y - chordMid.y), "车画在了弦上（= 从环内抄近路）").toBeGreaterThan(20);
    expect(Math.abs(ellipseResidual(chordMid.x, chordMid.y, ARC.k) - 1), "弦中点竟在环上？几何前提变了，本门失效").toBeGreaterThan(0.05);
  });

  it("★ **不是角度线性插值**：等时步 ⇒ **等弧长步**，而角度步长本身并不相等", async () => {
    const user = userEvent.setup();
    render(<TransitFlowLayer sources={SOURCES} initialDay={0} />);
    const angles: number[] = [];
    for (let i = 0; i < 3; i++) {
      await user.click(screen.getByTestId("transit-step-fwd"));
      await user.click(screen.getByTestId("transit-step-fwd"));
      angles.push(num(screen.getByTestId("transit-car-IT-1"), "data-angle"));
    }
    // 每两天走 1/4 行程 ⇒ 三个采样点的**弧长增量必须相等**
    const arcs = angles.map((a) => ringArcLength(ARC.a0, a, ARC.k));
    const dArc = [arcs[0]!, arcs[1]! - arcs[0]!, arcs[2]! - arcs[1]!];
    for (const d of dArc) {
      expect(Math.abs(d - ARC.lengthPx / 4), `等时步没走出等弧长步：${dArc.map((v) => v.toFixed(3)).join(" / ")}`).toBeLessThanOrEqual(
        RING_ARC_TOLERANCE_PX,
      );
    }
    // 而**角度**增量明显不等（椭圆短轴附近走得慢）—— 若实现是角度插值，上面那条会红、这条也会红
    const dAng = [angles[0]! - ARC.a0, angles[1]! - angles[0]!, angles[2]! - angles[1]!];
    expect(
      Math.max(...dAng) / Math.min(...dAng),
      "角度增量竟然均匀 ⇒ 说明走的是角度参数（椭圆上那等于速度忽快忽慢）",
    ).toBeGreaterThan(1.1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("§2 · 只有到站日 / 只知在哪站的批次：图元**不落进任何区间**，只挂在站上", () => {
  it("★ Shipment（含目的地就是区间终点站的最坏情形）：离每条弧都 >12px，且不在环上", () => {
    render(<TransitFlowLayer sources={SOURCES} initialDay={4} />);
    for (const id of ["SH-far", "SH-onseg"]) {
      const badge = screen.getByTestId(`transit-arrival-${id}`);
      const x = num(badge, "data-x");
      const y = num(badge, "data-y");
      const d = distanceToArc(x, y, ARC.a0, ARC.a1, ARC.k);
      expect(d, `${id} 的徽标落进了区间弧（最近距离 ${d.toFixed(2)}px）—— 只有到货日却被画成"在路上"`).toBeGreaterThan(
        OFF_RING_MIN_PX,
      );
      // 连环本身都不在（沿半径推开），更谈不上"在某个区间的某个位置"
      expect(Math.abs(ellipseResidual(x, y) - 1), `${id} 的徽标贴在环上，会被读成一个区间位置`).toBeGreaterThan(0.02);
    }
  });

  it("★ Shipment 只挂在站上：角度 == 目的站角度，且 progress / segmentId 一律空", () => {
    render(<TransitFlowLayer sources={SOURCES} initialDay={4} />);
    const cases: [string, string][] = [
      ["SH-far", "base-c"],
      ["SH-onseg", "base-b"],
    ];
    for (const [id, node] of cases) {
      const badge = screen.getByTestId(`transit-arrival-${id}`);
      expect(badge.getAttribute("data-station")).toBe(node);
      expect(badge.getAttribute("data-progress"), "只有到货日却给了区间位置").toBe("");
      expect(badge.getAttribute("data-segment-id"), "没有起运地却给了一个区间 id").toBe("");
      const anchor = ANCHORS.find((a) => a.nodeId === node)!;
      expect(num(badge, "data-angle"), "徽标没有挂在它那一站的角度上").toBeCloseTo(anchor.angle, 6);
      // 也不许存在一辆车
      expect(screen.queryByTestId(`transit-car-${id}`), "Shipment 长出了一辆车 ⇒ 那条进度条是纯发明的").toBeNull();
    }
  });

  it("★ WIPLot：堆叠挂在工序站上（朝环内），同样离弧远、progress/segmentId 空、无车", () => {
    render(<TransitFlowLayer sources={SOURCES} initialDay={4} />);
    const bar = screen.getByTestId("transit-resident-LOT-1");
    const x = num(bar, "data-x");
    const y = num(bar, "data-y");
    expect(bar.getAttribute("data-station")).toBe("proc-x");
    expect(bar.getAttribute("data-progress")).toBe("");
    expect(bar.getAttribute("data-segment-id")).toBe("");
    expect(distanceToArc(x, y, ARC.a0, ARC.a1, ARC.k)).toBeGreaterThan(OFF_RING_MIN_PX);
    // 朝**环内**（与到站徽标朝环外分家）：残差 < 1
    expect(ellipseResidual(x, y), "驻留堆叠没有朝环内让开").toBeLessThan(1 - 0.02);
    expect(screen.queryByTestId("transit-car-LOT-1")).toBeNull();
  });

  it("到站徽标朝环外、驻留堆叠朝环内：两者**在环的两侧**，不会互相冒充", () => {
    render(<TransitFlowLayer sources={SOURCES} initialDay={4} />);
    const badge = screen.getByTestId("transit-arrival-SH-far");
    const bar = screen.getByTestId("transit-resident-LOT-1");
    expect(ellipseResidual(num(badge, "data-x"), num(badge, "data-y"))).toBeGreaterThan(1);
    expect(ellipseResidual(num(bar, "data-x"), num(bar, "data-y"))).toBeLessThan(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("§3 · 三类图元的形状标识互不相同（不许只差个颜色深浅）", () => {
  it("★ data-glyph / data-glyph-shape 三值互异，且底层图形结构不同", () => {
    render(<TransitFlowLayer sources={SOURCES} initialDay={4} />);
    const car = screen.getByTestId("transit-car-IT-1");
    const badge = screen.getByTestId("transit-arrival-SH-far");
    const bar = screen.getByTestId("transit-resident-LOT-1");

    const glyphs = [car, badge, bar].map((e) => e.getAttribute("data-glyph"));
    expect(new Set(glyphs).size, `三类图元的 data-glyph 撞了：${glyphs.join(" / ")}`).toBe(3);
    const shapes = [car, badge, bar].map((e) => e.getAttribute("data-glyph-shape"));
    expect(new Set(shapes).size, `三类图元的形状标识撞了：${shapes.join(" / ")}`).toBe(3);
    expect(glyphs).toEqual([
      TRANSIT_GLYPHS.interpolated.glyph,
      TRANSIT_GLYPHS["arrival-only"].glyph,
      TRANSIT_GLYPHS["station-resident"].glyph,
    ]);

    // 形状真的不同：三角 3 顶点 / 菱形 4 顶点 / 横条是 rect（连 path 都没有）
    const verts = (el: Element) => (el.querySelector("path")?.getAttribute("d")?.match(/[ML]/g) ?? []).length;
    expect(verts(car), "车不是三角形").toBe(3);
    expect(verts(badge), "到站徽标不是菱形").toBe(4);
    expect(bar.querySelector("rect"), "驻留堆叠不是横条").toBeTruthy();
    expect(bar.querySelector("path"), "驻留堆叠混用了 path ⇒ 与另两类形状不再天然分家").toBeNull();
  });

  it("图例把三种形状与三档位置精度对上（用户不用猜哪个形状是哪档）", () => {
    render(<TransitFlowLayer sources={SOURCES} initialDay={4} />);
    for (const spec of TRANSIT_SOURCE_SPECS) {
      const chip = screen.getByTestId(`transit-glyph-legend-${spec.key}`);
      expect(chip.getAttribute("data-glyph")).toBe(TRANSIT_GLYPHS[spec.mode].glyph);
      expect(chip.textContent ?? "").toContain(spec.label);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("§4 · 时序可算性三级判据：一个字都不许丢（几何改法不许顺手改判据）", () => {
  it("三档 modeReason 在图层上**逐字**等于 transitFlow 单一来源", () => {
    render(<TransitFlowLayer sources={SOURCES} initialDay={4} />);
    for (const spec of TRANSIT_SOURCE_SPECS) {
      expect(screen.getByTestId(`transit-source-${spec.key}-mode`).textContent, `${spec.key} 的 modeReason 被改写了`).toBe(
        spec.modeReason,
      );
      expect(screen.getByTestId(`transit-source-${spec.key}`).getAttribute("data-mode")).toBe(spec.mode);
    }
  });

  it("节拍与采购两条 EMPTY 原样还在（几何重做不许把诚实缺席块弄丢）", () => {
    render(<TransitFlowLayer sources={SOURCES} initialDay={4} />);
    expect(screen.getByTestId("transit-cadence-absence")).toHaveAttribute("data-status", "EMPTY");
    expect(screen.getByTestId("transit-branch-procurement")).toHaveAttribute("data-status", "EMPTY");
  });

  it("屏上明写「同一个环 ≠ 同一套站」（几何同源了但 key 宇宙仍不同，不许被『看着对齐』盖过去）", () => {
    render(<TransitFlowLayer sources={SOURCES} initialDay={4} />);
    const note = screen.getByTestId("transit-geometry-source");
    expect(note.getAttribute("data-source")).toBe("chain-line-map");
    const txt = note.textContent ?? "";
    expect(txt).toContain("chainLineMap.ts");
    expect(txt).toContain("弧长参数");
    expect(txt, "没有说清两图站点 key 不是同一套 ⇒ 用户会以为同角度就是同一个站").toContain("没有共同的 id 维度");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("§5 · 坐标单源（源码级）+ 站点并集（区间两端必须都有站）", () => {
  it("在途层源码里没有第二份「极坐标 → 画布坐标」推导", () => {
    const src = readRepo("apps/frontend-shell/src/views/sim/TransitFlowLayer.tsx");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(
      /RING_LAYOUT\.(cx|cy|rx|ry)\s*[+\-*/]/.test(code),
      "在途层自己拿 RING_LAYOUT 的 cx/cy/rx/ry 做了算术 ⇒ 坐标出现了第二处实现",
    ).toBe(false);
    for (const fn of ["ringStationAnchors", "ringSegmentArc", "ringArcPointAt", "ringRadialOffsetPoint"]) {
      expect(code.includes(fn), `没有用单源的 ${fn}`).toBe(true);
    }
  });

  it("区间两端**必须都有站**：引擎只登记了终点站时，起运地从数据行补进来（不许把它抹掉）", () => {
    const nodes: TransitNodeInput[] = [{ nodeId: "engine-dest", label: "引擎登记的站" }];
    const { batches } = parseInterBaseTransferRows([xfer({ id: "IT-9", from: "row-origin", to: "engine-dest", dispatchDay: 0, etaDay: 4 })]);
    const stations = resolveStations(nodes, batches);
    expect(stations.map((s) => s.nodeId), "引擎站排前、数据行补的站排后").toEqual(["engine-dest", "row-origin"]);
    expect(stations[0]!.origin).toBe("engine");
    expect(stations[1]!.origin, "补进来的站不许冒充引擎下发").toBe("data-row");
    expect(stations[1]!.cadence, "补进来的站永远没有节拍（限流站只认引擎）").toBeUndefined();

    render(<TransitFlowLayer nodes={nodes} sources={{ interBaseTransfer: [xfer({ id: "IT-9", from: "row-origin", to: "engine-dest", dispatchDay: 0, etaDay: 4 })] }} initialDay={2} />);
    // 两端都有站 ⇒ 弧画得出来，车也就有地方落
    expect(screen.getByTestId("transit-station-row-origin")).toBeTruthy();
    expect(screen.getByTestId("transit-station-engine-dest")).toBeTruthy();
    expect(screen.getByTestId("transit-segment-row-origin→engine-dest")).toBeTruthy();
    const car = screen.getByTestId("transit-car-IT-9");
    expect(ellipseResidual(num(car, "data-x"), num(car, "data-y"))).toBeCloseTo(1, 4);
  });

  it("R6：同 props 两次渲染，环上几何逐字节一致（浮点也不许漂）", () => {
    const first = render(<TransitFlowLayer sources={SOURCES} initialDay={4} />);
    const a = screen.getByTestId("transit-ring").innerHTML;
    first.unmount();
    render(<TransitFlowLayer sources={SOURCES} initialDay={4} />);
    expect(screen.getByTestId("transit-ring").innerHTML).toBe(a);
  });
});
