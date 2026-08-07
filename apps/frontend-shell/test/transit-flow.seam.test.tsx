import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { harvestLeakedTimers } from "./leakGuard";
import { loginAs, renderWithClient as render } from "./utils";

/**
 * WO-SANDBOX-F2 · 在途 / 在制层 —— SEAM + 诚实缺席 + 前端零清单 + 三色系 + 定时器纪律。
 *
 * ── 接缝咬在哪（不是喂 fixture 断言渲染）───────────────────────────────────
 *  ① **时钟 × `etaDay` → 位置**：推进仿真时钟，断言车的位置**真的按 `etaDay` 算**——
 *     同一天、只改 `etaDay`，位置必须跟着变（位置是算出来的，不是画上去的）。
 *  ② **节拍点批量放行**：到站日**散在多天**的批次，在限流站被闸门扣住，
 *     到闸门日**一批同时走**。断言的是**涌现现象**（放行日只落在闸门日 + 单次放行 ≥2 批 +
 *     放行日数 < 到站日数），不是某个函数的返回值。
 *     ⚠ 变异注入点：`transitFlow.ts` 的 `releaseDayOf` 换成 `arrivalDay + everyDays/2`
 *       （＝把节拍当匀速/固定时长处理）→ 本组三条断言全红（红的原文见交付说明）。
 *  ③ **诚实缺席**：采购支线恒空且逐条给证；`Shipment` 只有到货日 ⇒ **不画车**；
 *     mock 态 `InterBaseTransfer` 缺 `dispatchDay/etaDay` ⇒ 守卫当场判空并说出缺哪个字段。
 *  ④ **前端零清单**：`nodeId` 是不透明 key（带 `.` `/` `#` 也不许被解析）；
 *     限流站只认引擎下发的 `node.cadence`；站名跟着 `BASE_REGISTRY` 走（改册 → 屏上真变）。
 */

// vi.mock 工厂在 import 之前执行 —— 用 vi.hoisted 提这只可变盒子（同 physical-topology.seam 的做法）。
const holder = vi.hoisted(() => ({ bases: [] as Record<string, unknown>[], real: [] as Record<string, unknown>[] }));

vi.mock("@platform/contracts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@platform/contracts")>();
  if (holder.real.length === 0) {
    holder.real = actual.BASE_REGISTRY as unknown as Record<string, unknown>[];
    holder.bases.push(...holder.real);
  }
  return { ...actual, BASE_REGISTRY: holder.bases };
});

import { TransitFlowLayer, TRANSIT_TICK_BASE_MS } from "@/views/sim/TransitFlowLayer";
import {
  CADENCE_ABSENCE,
  PROCUREMENT_BRANCH,
  isCadenceGateDay,
  meanReleaseWaitDays,
  nextGateDayOnOrAfter,
  parseInterBaseTransferRows,
  parseShipmentRows,
  parseWipLotRows,
  resolveSegments,
  resolveStations,
  simulateTransit,
  transitHorizonDays,
  type TransitBatch,
  type TransitNodeInput,
  type TransitStation,
} from "@/views/sim/transitFlow";
import type { Cadence } from "@platform/contracts";

function injectBases(rows: Record<string, unknown>[]): void {
  holder.bases.splice(0, holder.bases.length, ...rows);
}
function restoreBases(): void {
  holder.bases.splice(0, holder.bases.length, ...holder.real);
}

/** 仓根：自**本测试文件**向上找 pnpm-workspace.yaml（不用 process.cwd —— 隔离 worktree 里它指向主 checkout）。 */
const TEST_FILE = import.meta.url.startsWith("file:") ? fileURLToPath(import.meta.url) : import.meta.url;
const REPO_ROOT = (() => {
  let dir = dirname(TEST_FILE);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(`[transit-flow.seam] 找不到仓根（自 ${TEST_FILE} 向上未见 pnpm-workspace.yaml）`);
})();
const readRepo = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

// ── 造数据（形状严格照三个对象的**实测字段**，不是我编的形状）──────────────
/** `InterBaseTransfer` 行（字段集 = battery.ts:1130 实测 + contracts InterBaseTransferSchema）。 */
function xfer(o: { id: string; from: string; to: string; dispatchDay: number; etaDay: number; qty?: number; model?: string }) {
  const transitDays = o.etaDay - o.dispatchDay;
  return {
    transferId: o.id,
    fromBase: o.from,
    toBase: o.to,
    model: o.model ?? "4680-NCM",
    qty: o.qty ?? 1000,
    transitDays,
    status: "IN_TRANSIT" as const,
    dispatchDate: "2026-06-11",
    dispatchDay: o.dispatchDay,
    etaDay: o.etaDay,
    etaDate: "2026-06-20",
    reason: "产能调剂",
  };
}
/** `Shipment` 行（battery.ts:1108 实测字段：**没有发运日**）。 */
const shipment = (o: { id: string; baseId: string; etaDay: number; qtyTons?: number }) => ({
  shipId: o.id,
  baseId: o.baseId,
  etaDay: o.etaDay,
  status: "IN_TRANSIT",
  qtyTons: o.qtyTons ?? 200,
  coverageDays: 5,
});
/** `WIPLot` 行（battery.ts:1243 实测字段：**没有任何 eta**）。 */
const wipLot = (o: { id: string; currentProcess: string; qty?: number }) => ({
  lotId: o.id,
  woId: "WO-1",
  modelId: "4680-NCM",
  lineId: "LINE-1",
  currentProcess: o.currentProcess,
  qty: o.qty ?? 500,
  status: "在制",
  startTime: "2026-06-10",
  lastMoveTime: "2026-06-12",
});

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** jsdom 不实现 matchMedia —— 造一只可控的（含 addEventListener/addListener 两代 API）。 */
function stubMatchMedia(matches: boolean): void {
  const mq: MediaQueryList = {
    matches,
    media: REDUCED_MOTION_QUERY,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: () => mq });
}

afterEach(() => {
  restoreBases();
  document.documentElement.removeAttribute("data-theme");
  Reflect.deleteProperty(window, "matchMedia");
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. SEAM ① · 仿真时钟推进 → 在途位置**真的按 etaDay 变化**
// ═══════════════════════════════════════════════════════════════════════════════
describe("SEAM ① · 时钟 × etaDay → 区间位置（位置是算出来的，不是画上去的）", () => {
  const rows = [xfer({ id: "X1", from: "changzhou", to: "handan", dispatchDay: 2, etaDay: 10 })];

  function frameAt(day: number, batches: TransitBatch[]) {
    const stations = resolveStations(undefined, batches);
    return simulateTransit({ stations, batches }, day);
  }

  it("整条轨迹按 (day − dispatchDay)/(etaDay − dispatchDay) 走，且端点严格", () => {
    const { batches } = parseInterBaseTransferRows(rows);
    expect(batches).toHaveLength(1);

    expect(frameAt(1, batches).vehicles[0]!.state).toBe("pending");
    expect(frameAt(2, batches).vehicles[0]!.progress).toBeCloseTo(0, 6);
    expect(frameAt(6, batches).vehicles[0]!.progress).toBeCloseTo(0.5, 6);
    expect(frameAt(8, batches).vehicles[0]!.progress).toBeCloseTo(0.75, 6);
    // 到 etaDay 当天即到站（无节拍 ⇒ 随到随走）
    expect(frameAt(10, batches).vehicles[0]!.state).toBe("released");
    expect(frameAt(10, batches).vehicles[0]!.progress).toBeCloseTo(1, 6);
    // 每推进一天，位置严格单调增（"时钟推进→位置真的变"）
    const seq = [3, 4, 5, 6, 7, 8, 9].map((d) => frameAt(d, batches).vehicles[0]!.progress ?? -1);
    for (let i = 1; i < seq.length; i++) expect(seq[i]!).toBeGreaterThan(seq[i - 1]!);
  });

  it("只改 etaDay（同一天、同一 dispatchDay）→ 位置必须跟着变（证明读的是 etaDay 不是常量）", () => {
    const slow = parseInterBaseTransferRows([xfer({ id: "X1", from: "a", to: "b", dispatchDay: 2, etaDay: 10 })]).batches;
    const fast = parseInterBaseTransferRows([xfer({ id: "X1", from: "a", to: "b", dispatchDay: 2, etaDay: 6 })]).batches;
    expect(frameAt(4, slow).vehicles[0]!.progress).toBeCloseTo(0.25, 6);
    expect(frameAt(4, fast).vehicles[0]!.progress).toBeCloseTo(0.5, 6);
    // 快的那条第 6 天已到站，慢的还在路上
    expect(frameAt(6, fast).vehicles[0]!.state).toBe("released");
    expect(frameAt(6, slow).vehicles[0]!.state).toBe("moving");
  });

  it("组件层同一条接缝：点「步进」→ DOM 上 data-progress 真的按 etaDay 前进", async () => {
    const user = userEvent.setup();
    render(<TransitFlowLayer sources={{ interBaseTransfer: [xfer({ id: "X1", from: "changzhou", to: "handan", dispatchDay: 0, etaDay: 4 })] }} />);

    const car = screen.getByTestId("transit-car-X1");
    expect(car).toHaveAttribute("data-progress", "0.0000");
    await user.click(screen.getByTestId("transit-step-fwd"));
    expect(screen.getByTestId("transit-car-X1")).toHaveAttribute("data-progress", "0.2500");
    await user.click(screen.getByTestId("transit-step-fwd"));
    expect(screen.getByTestId("transit-car-X1")).toHaveAttribute("data-progress", "0.5000");
    await user.click(screen.getByTestId("transit-step-back"));
    expect(screen.getByTestId("transit-car-X1")).toHaveAttribute("data-progress", "0.2500");
    expect(screen.getByTestId("transit-day-readout")).toHaveTextContent("第 1 / 4 天");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. SEAM ② · 到限流站排队堆积 → 到节拍点**批量放行**（本单最值钱的一条）
// ═══════════════════════════════════════════════════════════════════════════════
describe("SEAM ② · 节拍点批量放行（一批同时走，不是匀速流）", () => {
  const GATE_NODE = "gate-node";
  const cadence: Cadence = { everyDays: 5, offsetDays: 0, kind: "shipping" };
  const nodes: TransitNodeInput[] = [{ nodeId: GATE_NODE, label: "限流站", cadence }];

  /** 到站日**散在 5 个不同的天**（6/7/8/11/12）—— 匀速处理会把放行也摊成 5 天。 */
  const arrivals = [6, 7, 8, 11, 12];
  const rows = arrivals.map((eta, i) => xfer({ id: `X${i}`, from: "origin", to: GATE_NODE, dispatchDay: 0, etaDay: eta }));

  function sim(day: number) {
    const { batches } = parseInterBaseTransferRows(rows);
    const stations = resolveStations(nodes, batches);
    return { frame: simulateTransit({ stations, batches }, day), batches, stations };
  }

  it("放行只发生在闸门日；放行日数 < 到站日数（批次被闸门聚在一起）", () => {
    const { frame } = sim(30);
    const arrivalDays = new Set(arrivals);
    const releaseDays = [...new Set(frame.releases.map((r) => r.day))];

    expect(releaseDays.length, "放行日数必须少于到站日数 —— 匀速处理时两者相等").toBeLessThan(arrivalDays.size);
    for (const d of releaseDays) {
      expect(isCadenceGateDay(cadence, d), `放行日 ${d} 不是闸门日 —— 说明不是「到点才放行」`).toBe(true);
    }
    // 6/7/8 → 第 10 天；11/12 → 第 15 天
    expect(releaseDays.sort((a, b) => a - b)).toEqual([10, 15]);
  });

  it("单次放行 ≥2 批（一批同时走）—— 匀速处理下每次最多 1 批", () => {
    const { frame } = sim(30);
    const maxSize = Math.max(...frame.releases.map((r) => r.size));
    expect(maxSize, "没有任何一次放行是「多批同时」—— 批量释放现象消失").toBeGreaterThanOrEqual(2);
    expect(frame.releases.find((r) => r.day === 10)!.size).toBe(3);
    expect(frame.releases.find((r) => r.day === 15)!.size).toBe(2);
    expect(frame.releases.find((r) => r.day === 10)!.batchIds).toEqual(["X0", "X1", "X2"]);
  });

  it("闸门前一天堆 3 批、闸门当天一次清空（排队堆积 → 批量放行的完整相变）", () => {
    expect(sim(9).frame.heldCount, "第 9 天应有 3 批被闸门扣住").toBe(3);
    expect(sim(9).frame.queues[0]!.batchIds).toEqual(["X0", "X1", "X2"]);
    expect(sim(9).frame.queues[0]!.nextGateDay).toBe(10);
    // 闸门当天：队列清空，且这一天的放行事件是「3 批同时」
    const at10 = sim(10).frame;
    expect(at10.heldCount).toBe(0);
    expect(at10.releases.find((r) => r.day === 10)!.size).toBe(3);
    expect(at10.events.filter((e) => e.kind === "release" && e.day === 10)).toHaveLength(1);
  });

  it("无节拍的同一批数据 = 随到随走：放行日 == 到站日，5 天各走各的（对照组）", () => {
    const { batches } = parseInterBaseTransferRows(rows);
    const stations = resolveStations([{ nodeId: GATE_NODE, label: "无闸门" }], batches);
    const frame = simulateTransit({ stations, batches }, 30);
    expect([...new Set(frame.releases.map((r) => r.day))].sort((a, b) => a - b)).toEqual(arrivals);
    expect(Math.max(...frame.releases.map((r) => r.size))).toBe(1);
  });

  it("等待期望与 S0 冻结公式一致：均匀到达下平均等待 → everyDays/2", () => {
    const every = 10;
    const c: Cadence = { everyDays: every, offsetDays: 0, kind: "batch" };
    // 一个完整周期上均匀到达（1..10），闸门在 0/10/20…
    const uniform = Array.from({ length: every }, (_, i) =>
      xfer({ id: `U${String(i).padStart(2, "0")}`, from: "o", to: GATE_NODE, dispatchDay: 0, etaDay: i + 1 }),
    );
    const { batches } = parseInterBaseTransferRows(uniform);
    const stations = resolveStations([{ nodeId: GATE_NODE, label: "闸", cadence: c }], batches);
    const frame = simulateTransit({ stations, batches }, 40);
    const mean = meanReleaseWaitDays(frame.releases);
    expect(mean).not.toBeNull();
    // 离散均匀到达（1..10）在 everyDays=10 下平均等待 = 4.5，与连续期望 5 相差半天（离散化偏差）
    expect(Math.abs(mean! - every / 2)).toBeLessThanOrEqual(0.5);
    // 全部 10 批在同一个闸门日一次放完
    expect(frame.releases).toHaveLength(1);
    expect(frame.releases[0]!.size).toBe(10);
  });

  it("闸门数学：nextGateDayOnOrAfter 含相位、落在闸门上等待 0", () => {
    const c: Cadence = { everyDays: 7, offsetDays: 3, kind: "meeting" };
    expect(nextGateDayOnOrAfter(c, 0)).toBe(3);
    expect(nextGateDayOnOrAfter(c, 3)).toBe(3);
    expect(nextGateDayOnOrAfter(c, 4)).toBe(10);
    expect(nextGateDayOnOrAfter(c, 10)).toBe(10);
    expect(nextGateDayOnOrAfter(c, 11)).toBe(17);
    expect(isCadenceGateDay(c, 17)).toBe(true);
    expect(isCadenceGateDay(c, 16)).toBe(false);
  });

  it("组件层：闸门站上真的出现堆积 chip，闸门日一次清空", async () => {
    const user = userEvent.setup();
    render(<TransitFlowLayer nodes={nodes} sources={{ interBaseTransfer: rows }} initialDay={9} />);
    expect(screen.getByTestId(`transit-queue-${GATE_NODE}`)).toHaveAttribute("data-size", "3");
    expect(screen.getByTestId("transit-counts")).toHaveTextContent("排队 3");
    await user.click(screen.getByTestId("transit-step-fwd"));
    expect(screen.queryByTestId(`transit-queue-${GATE_NODE}`)).toBeNull();
    expect(screen.getByTestId("transit-events")).toHaveTextContent("节拍放行 3 批（同时）");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. 诚实缺席：看不见的东西不许画出来
// ═══════════════════════════════════════════════════════════════════════════════
describe("诚实缺席 · 拿不到真值的区间显示为空 + 一行原因", () => {
  it("采购支线恒空，且逐条给出可复验的取证（D2 前不许画假车）", () => {
    render(<TransitFlowLayer sources={{}} />);
    const branch = screen.getByTestId("transit-branch-procurement");
    expect(branch).toHaveAttribute("data-status", "EMPTY");
    expect(branch).toHaveTextContent("本体缺在途承载物");
    expect(branch).toHaveTextContent("PurchaseOrder");
    expect(branch).toHaveTextContent("ASN");
    expect(branch).toHaveTextContent("customs");
    expect(branch).toHaveTextContent("IQC");
    expect(PROCUREMENT_BRANCH.evidence.length).toBeGreaterThanOrEqual(3);
    // 采购支线不产生任何车 / 任何站
    expect(screen.queryAllByTestId(/^transit-car-/)).toHaveLength(0);
  });

  it("Shipment 只有到货日 ⇒ **不画车**，只给到站倒计时（progress 必须是 null）", () => {
    const { batches } = parseShipmentRows([shipment({ id: "SHIP-changzhou", baseId: "changzhou", etaDay: 6 })]);
    expect(batches[0]!.mode).toBe("arrival-only");
    expect(batches[0]!.dispatchDay).toBeNull();
    expect(batches[0]!.originNodeId).toBeNull();
    const stations = resolveStations(undefined, batches);
    const frame = simulateTransit({ stations, batches }, 3);
    expect(frame.vehicles[0]!.progress).toBeNull();
    // 无起点 ⇒ 不产生区间 ⇒ 屏上不会有一条"从哪到哪"的假轨道
    expect(resolveSegments(batches)).toHaveLength(0);

    render(<TransitFlowLayer sources={{ shipment: [shipment({ id: "SHIP-changzhou", baseId: "changzhou", etaDay: 6 })] }} />);
    expect(screen.queryByTestId("transit-car-SHIP-changzhou")).toBeNull();
    const marker = screen.getByTestId("transit-arrival-SHIP-changzhou");
    expect(marker).toHaveAttribute("data-days-to-arrival", "6");
    expect(marker).toHaveAttribute("data-progress", "");
    expect(screen.getByTestId("transit-segments-empty")).toHaveTextContent("不画区间，也不画车");
    expect(screen.getByTestId("transit-source-shipment-mode")).toHaveTextContent("没有发运日");
  });

  it("WIPLot 无 eta ⇒ 站驻留，不画工序间行进过程", () => {
    const { batches } = parseWipLotRows([wipLot({ id: "LOT-1", currentProcess: "化成" })]);
    expect(batches[0]!.mode).toBe("station-resident");
    expect(batches[0]!.dispatchDay).toBeNull();
    expect(batches[0]!.destNodeId).toBe("化成");
    render(<TransitFlowLayer sources={{ wipLot: [wipLot({ id: "LOT-1", currentProcess: "化成" })] }} />);
    expect(screen.getByTestId("transit-resident-LOT-1")).toHaveTextContent("化成");
    expect(screen.queryByTestId("transit-car-LOT-1")).toBeNull();
    // 站上没有闸门 ⇒ 不许报一句说不出"放行到哪"的假放行（工序间流转耗时无数据源）
    expect(screen.getByTestId("transit-events-empty")).toBeInTheDocument();
  });

  it("在制批次在**有闸门**的工序上 → 真的排队堆积 + 到节拍点批量放行（WIPLot 走同一套机制）", () => {
    const lots = ["LOT-A", "LOT-B", "LOT-C"].map((id) => wipLot({ id, currentProcess: "化成" }));
    const { batches } = parseWipLotRows(lots);
    const stations = resolveStations([{ nodeId: "化成", label: "化成", cadence: { everyDays: 3, offsetDays: 2, kind: "batch" } }], batches);
    // 第 1 天：三批都被闸门扣住（闸门在第 2 天）
    expect(simulateTransit({ stations, batches }, 1).heldCount).toBe(3);
    // 第 2 天：一次全放
    const at2 = simulateTransit({ stations, batches }, 2);
    expect(at2.heldCount).toBe(0);
    expect(at2.releases).toHaveLength(1);
    expect(at2.releases[0]!.size).toBe(3);
    expect(at2.releases[0]!.day).toBe(2);
  });

  it("字段缺失的行被守卫拒掉，并说出缺哪个字段（不静默丢、不补默认值）", () => {
    // 缺 dispatchDay / etaDay（= 前端 mock PORT_TRANSFERS 的真实形状）
    const partial = { transferId: "X9", fromBase: "a", toBase: "b", model: "m", qty: 100, transitDays: 3, status: "IN_TRANSIT" };
    const r = parseInterBaseTransferRows([partial]);
    expect(r.accepted).toBe(0);
    expect(r.rejected).toBe(1);
    expect(r.rejectReasons.join("\n")).toMatch(/dispatchDay/);
    expect(r.rejectReasons.join("\n")).toMatch(/etaDay/);

    const s = parseShipmentRows([{ shipId: "S1" }]);
    expect(s.accepted).toBe(0);
    expect(s.rejectReasons.join("\n")).toMatch(/baseId/);
    expect(s.rejectReasons.join("\n")).toMatch(/etaDay/);

    // etaDay ≤ dispatchDay（行程 ≤0）也是"算不出来"，不许兜成 0 长度区间
    expect(parseInterBaseTransferRows([xfer({ id: "X8", from: "a", to: "b", dispatchDay: 5, etaDay: 5 })]).accepted).toBe(0);
  });

  it("节拍：引擎没下发 cadence ⇒ 界面明说 EMPTY，不画任何「这里有节拍」的假象", () => {
    render(<TransitFlowLayer sources={{ interBaseTransfer: [xfer({ id: "X1", from: "a", to: "b", dispatchDay: 0, etaDay: 5 })] }} />);
    const absence = screen.getByTestId("transit-cadence-absence");
    expect(absence).toHaveAttribute("data-status", "EMPTY");
    expect(absence).toHaveTextContent("节拍在数据层无承载");
    expect(absence).toHaveTextContent("Cadence");
    expect(screen.queryByTestId("transit-cadence-live")).toBeNull();
    expect(CADENCE_ABSENCE.evidence.length).toBeGreaterThanOrEqual(3);
    // 无节拍 ⇒ 不会凭空冒出一个限流站
    expect(screen.queryAllByTestId(/^transit-queue-/)).toHaveLength(0);
  });

  it("真取数（mock 态）：三条支线都被守卫判空，且原因指名道姓 —— 这就是「不画假车」的活证据", async () => {
    loginAs("planner");
    render(<TransitFlowLayer />);

    await waitFor(() => expect(screen.getByTestId("transit-source-interBaseTransfer")).toHaveAttribute("data-status", "EMPTY"));
    await waitFor(() => expect(screen.getByTestId("transit-source-shipment")).toHaveAttribute("data-status", "EMPTY"));
    await waitFor(() => expect(screen.getByTestId("transit-source-wipLot")).toHaveAttribute("data-status", "EMPTY"));

    // InterBaseTransfer：mock 的 PORT_TRANSFERS 确实没有 dispatchDay/etaDay → 契约校验说出来
    expect(screen.getByTestId("transit-source-interBaseTransfer-reason")).toHaveTextContent("dispatchDay");
    // Shipment / WIPLot：mock 的 /a/v1/objects 对这两个 type 没有分支（回落到订单行）→ 字段守卫当场拒掉，
    // 不会把订单画成在途批次（本仓刚坐实过一条死映射静默标错业务线，这里就是那条教训的正面应用）。
    expect(screen.getByTestId("transit-source-shipment-reason")).toHaveTextContent("shipId");
    expect(screen.getByTestId("transit-source-wipLot-reason")).toHaveTextContent("lotId");

    expect(screen.queryAllByTestId(/^transit-car-/)).toHaveLength(0);
    expect(screen.getByTestId("transit-events-empty")).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. 前端零清单：nodeId 不透明 · 限流站只认引擎 · 站名跟着单源走
// ═══════════════════════════════════════════════════════════════════════════════
describe("前端零清单 · nodeId 当不透明 key，站点/节拍全部来自引擎或数据行", () => {
  it("nodeId 含 . / # 也照样工作（任何字符串解析都会在这里崩）", () => {
    const weird = "demand.consensus/base#01";
    const nodes: TransitNodeInput[] = [{ nodeId: weird, label: "共识会", cadence: { everyDays: 4, kind: "meeting" } }];
    const rows = [xfer({ id: "X1", from: "up.stream/01", to: weird, dispatchDay: 0, etaDay: 3 })];
    render(<TransitFlowLayer nodes={nodes} sources={{ interBaseTransfer: rows }} initialDay={3} />);
    expect(screen.getByTestId(`transit-station-${weird}`)).toHaveTextContent("共识会");
    expect(screen.getByTestId(`transit-queue-${weird}`)).toHaveAttribute("data-size", "1");
    expect(screen.getByTestId(`transit-cadence-${weird}`)).toHaveAttribute("data-every", "4");
  });

  it("限流站只认引擎下发的 node.cadence —— 同一份数据换成不带 cadence 的 node，闸门就没了", () => {
    const rows = [xfer({ id: "X1", from: "a", to: "b", dispatchDay: 0, etaDay: 3 })];
    const { batches } = parseInterBaseTransferRows(rows);

    const withGate: TransitStation[] = resolveStations([{ nodeId: "b", cadence: { everyDays: 6, kind: "batch" } }], batches);
    const noGate: TransitStation[] = resolveStations([{ nodeId: "b" }], batches);
    expect(simulateTransit({ stations: withGate, batches }, 4).heldCount).toBe(1);
    expect(simulateTransit({ stations: noGate, batches }, 4).heldCount).toBe(0);
    // 引擎的 node 里没有 cadence，本层不会自己补一个
    expect(noGate[0]!.cadence).toBeUndefined();
  });

  it("引擎没给 nodes ⇒ 站点从数据行自带字段现场发现（不是前端清单），且标明 origin", () => {
    const { batches } = parseInterBaseTransferRows([xfer({ id: "X1", from: "zzz", to: "aaa", dispatchDay: 0, etaDay: 3 })]);
    const stations = resolveStations(undefined, batches);
    expect(stations.map((s) => s.nodeId)).toEqual(["aaa", "zzz"]); // 字典序 ⇒ R6 全序
    expect(stations.every((s) => s.origin === "data-row")).toBe(true);
    render(<TransitFlowLayer sources={{ interBaseTransfer: [xfer({ id: "X1", from: "zzz", to: "aaa", dispatchDay: 0, etaDay: 3 })] }} />);
    expect(screen.getByTestId("transit-flow-layer")).toHaveAttribute("data-station-origin", "data-row");
  });

  it("站名跟着 BASE_REGISTRY 单源走：改册 → 屏上真变；册里没有的 key 原样显示 id（不编名字）", () => {
    injectBases([{ baseId: "changzhou", name: "接缝改名基地", kind: "动力", position: "动力", lon: 0, lat: 0, util: 61, gwh: 12.5, bottleneck: "化成柜", lines: 4, prodYear: 2024, mainProduct: "T" }]);
    render(<TransitFlowLayer sources={{ interBaseTransfer: [xfer({ id: "X1", from: "changzhou", to: "not-in-registry", dispatchDay: 0, etaDay: 3 })] }} />);
    const from = screen.getByTestId("transit-station-changzhou");
    expect(from).toHaveTextContent("接缝改名基地");
    expect(from).toHaveAttribute("data-label-source", "base-registry");
    const to = screen.getByTestId("transit-station-not-in-registry");
    expect(to).toHaveTextContent("not-in-registry"); // 宁可显示原始 id，也不编一个好看的中文名
    expect(to).toHaveAttribute("data-label-source", "raw-id");
  });

  it("引擎给了 label ⇒ 引擎优先（前端不维护中文名映射表）", () => {
    render(
      <TransitFlowLayer
        nodes={[{ nodeId: "changzhou", label: "引擎给的站名" }]}
        sources={{ interBaseTransfer: [xfer({ id: "X1", from: "changzhou", to: "changzhou", dispatchDay: 0, etaDay: 3 })] }}
      />,
    );
    const st = screen.getAllByTestId("transit-station-changzhou")[0]!;
    expect(st).toHaveTextContent("引擎给的站名");
    expect(st).toHaveAttribute("data-label-source", "engine");
  });

  it("组件源码里没有写死的节点/限流站清单（源码级门）", () => {
    const model = readRepo("apps/frontend-shell/src/views/sim/transitFlow.ts");
    const view = readRepo("apps/frontend-shell/src/views/sim/TransitFlowLayer.tsx");
    for (const [name, src] of [["transitFlow.ts", model], ["TransitFlowLayer.tsx", view]] as const) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); // 注释不参与判定
      // nodeId 当不透明 key：不许对它做任何字符串解析
      expect(/nodeId[^\n]*\.(split|startsWith|endsWith|match|slice|indexOf)\s*\(/.test(code), `${name} 对 nodeId 做了字符串解析`).toBe(false);
      // 不许出现"限流站名单"式的常量数组
      expect(/const\s+\w*(GATE|CADENCE|BOTTLENECK|LIMIT)\w*_?(NODES|STATIONS|IDS)\s*=/.test(code), `${name} 出现了写死的限流站名单`).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. R6 确定性
// ═══════════════════════════════════════════════════════════════════════════════
describe("R6 · 同 (输入, 时钟位置) 重跑视觉状态一致（不依赖真实时钟/随机）", () => {
  const rows = [6, 7, 8, 11, 12].map((eta, i) => xfer({ id: `X${i}`, from: "o", to: "g", dispatchDay: 0, etaDay: eta }));
  const nodes: TransitNodeInput[] = [{ nodeId: "g", label: "闸", cadence: { everyDays: 5, kind: "shipping" } }];

  it("纯模型：同输入同日 → JSON 字节一致；换一天必不同", () => {
    const { batches } = parseInterBaseTransferRows(rows);
    const stations = resolveStations(nodes, batches);
    const a = JSON.stringify(simulateTransit({ stations, batches }, 9));
    const b = JSON.stringify(simulateTransit({ stations, batches }, 9));
    const c = JSON.stringify(simulateTransit({ stations, batches }, 10));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("输入行顺序打乱 → 输出仍字节一致（排序是全序，不靠遍历顺序）", () => {
    const s1 = resolveStations(nodes, parseInterBaseTransferRows(rows).batches);
    const s2 = resolveStations(nodes, parseInterBaseTransferRows([...rows].reverse()).batches);
    const f1 = simulateTransit({ stations: s1, batches: parseInterBaseTransferRows(rows).batches }, 12);
    const f2 = simulateTransit({ stations: s2, batches: parseInterBaseTransferRows([...rows].reverse()).batches }, 12);
    expect(JSON.stringify(f1)).toBe(JSON.stringify(f2));
  });

  it("组件：同 props 两次渲染 DOM 一致（无 Date.now / 无随机）", () => {
    const props = { nodes, sources: { interBaseTransfer: rows }, initialDay: 9 } as const;
    const first = render(<TransitFlowLayer {...props} />);
    const htmlA = first.container.innerHTML;
    first.unmount();
    const second = render(<TransitFlowLayer {...props} />);
    expect(second.container.innerHTML).toBe(htmlA);
  });

  it("窗口右端由数据算出（无批次 ⇒ 0，不给一个好看的默认 30 天）", () => {
    expect(transitHorizonDays({ stations: [], batches: [] })).toBe(0);
    const { batches } = parseInterBaseTransferRows(rows);
    expect(transitHorizonDays({ stations: resolveStations(nodes, batches), batches })).toBe(15);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. prefers-reduced-motion
// ═══════════════════════════════════════════════════════════════════════════════
describe("prefers-reduced-motion · 开启时不跑动画，改静态标注", () => {
  const rows = [xfer({ id: "X1", from: "a", to: "b", dispatchDay: 0, etaDay: 4 })];

  it("开启 ⇒ data-reduced-motion=1 · 自动播放停用 · 每辆车带静态标注", async () => {
    stubMatchMedia(true);
    render(<TransitFlowLayer sources={{ interBaseTransfer: rows }} initialDay={2} />);
    await waitFor(() => expect(screen.getByTestId("transit-flow-layer")).toHaveAttribute("data-reduced-motion", "1"));
    expect(screen.getByTestId("transit-playpause")).toBeDisabled();
    expect(screen.getByTestId("transit-reduced-motion-note")).toHaveTextContent("不跑动画");
    const annot = screen.getByTestId("transit-car-annot-X1");
    expect(annot).toHaveTextContent("第 2 天");
    expect(annot).toHaveTextContent("行程 50%");
    // 步进仍可用（静态查看不等于不能看）
    const user = userEvent.setup();
    await user.click(screen.getByTestId("transit-step-fwd"));
    expect(screen.getByTestId("transit-car-annot-X1")).toHaveTextContent("行程 75%");
  });

  it("关闭 ⇒ 无静态标注、播放可用", async () => {
    stubMatchMedia(false);
    render(<TransitFlowLayer sources={{ interBaseTransfer: rows }} initialDay={2} />);
    await waitFor(() => expect(screen.getByTestId("transit-flow-layer")).toHaveAttribute("data-reduced-motion", "0"));
    expect(screen.queryByTestId("transit-car-annot-X1")).toBeNull();
    expect(screen.getByTestId("transit-playpause")).not.toBeDisabled();
  });

  it("样式里动效被 prefers-reduced-motion 与 data-reduced-motion 双保险关停", () => {
    const css = readRepo("apps/frontend-shell/src/views/sim/TransitFlowLayer.module.css");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/\[data-reduced-motion="1"\][^{]*\.car\s*\{[^}]*transition:\s*none/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. 播控 + 定时器纪律 + 泄漏门
// ═══════════════════════════════════════════════════════════════════════════════
describe("播控 · 仿真时钟 · 定时器纪律", () => {
  const rows = [xfer({ id: "X1", from: "a", to: "b", dispatchDay: 0, etaDay: 6 })];

  /**
   * 时钟是"自排下一格"的 setTimeout（每推进一天，effect 重新排一格）。
   * 因此推进必须**一格一个 `act`** —— 把 N 格塞进一个 act 里，React 的 effect 要到 act 退出才 flush，
   * 下一格根本没被排出来，只会走 1 天。这不是测试写法洁癖，是这类时钟的真实语义。
   */
  const tick = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };
  const dayNow = () => Number(screen.getByTestId("transit-flow-layer").getAttribute("data-day"));

  /**
   * ⚠ 本组两例原用 `vi.useFakeTimers({ shouldAdvanceTime: true })`，与欠账 #120 同族同病 —— 一并去挂钟化。
   * `shouldAdvanceTime: true` 会在测试之外挂一条**真实 20ms `setInterval`** 同步 tick 假时钟
   * （实测：真实等 2500ms，假时钟自走 2420ms）。本组时钟 8× 档一格只要 `900/8 = 112.5ms`，
   * 于是**语句之间随便卡一下，仿真日就会自己往前跳**，`toBe(6)` 这种精确断言随机变成 7 ——
   * 而这正是本组最核心的判据（"同样墙钟 1× 走不掉一天、4× 走掉一天"）：
   * 它要求假时钟**只由本用例推**，多一条真实时钟就把 A/B 对照污染掉了。
   * 交互改用 `fireEvent`（同步 + RTL 自带 act 包装）：`userEvent` 的 `wait()` 走 `globalThis.setTimeout`，
   * 纯假时钟下推不动（实测会挂到 20s 超时），用它就必须把 `shouldAdvanceTime` 请回来。
   * `tick()` 保持 `act` 包裹不变 —— 那条纪律（一格一个 act）本来就是对的。
   */
  it("播放推进仿真时钟；倍速真的改变推进速率（同样墙钟 1× 走不掉一天、4× 走掉一天）", async () => {
    stubMatchMedia(false);
    vi.useFakeTimers();
    try {
      render(<TransitFlowLayer sources={{ interBaseTransfer: rows }} />);
      expect(dayNow()).toBe(0);

      fireEvent.click(screen.getByTestId("transit-playpause"));
      expect(screen.getByTestId("transit-playpause")).toHaveAttribute("data-state", "playing");
      for (let i = 0; i < 3; i++) await tick(TRANSIT_TICK_BASE_MS + 5);
      expect(dayNow(), "1× 档三格墙钟应推进三天").toBe(3);

      // ── 倍速 A/B：给同样一小段墙钟（1× 一天的 1/4），看两档结果 ──────────
      fireEvent.click(screen.getByTestId("transit-reset"));
      fireEvent.click(screen.getByTestId("transit-playpause"));
      await tick(TRANSIT_TICK_BASE_MS / 4 + 5);
      expect(dayNow(), "1× 档下这点墙钟不够走一天").toBe(0);

      fireEvent.click(screen.getByTestId("transit-playpause")); // 暂停
      fireEvent.click(screen.getByTestId("transit-speed-4"));
      fireEvent.click(screen.getByTestId("transit-playpause"));
      await tick(TRANSIT_TICK_BASE_MS / 4 + 5);
      expect(dayNow(), "4× 档下同样墙钟真的走掉一天").toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("走到窗口右端自动停，不空转", async () => {
    stubMatchMedia(false);
    vi.useFakeTimers();
    try {
      render(<TransitFlowLayer sources={{ interBaseTransfer: rows }} initialSpeed={8} />);
      fireEvent.click(screen.getByTestId("transit-playpause"));
      for (let i = 0; i < 8; i++) await tick(TRANSIT_TICK_BASE_MS / 8 + 5);
      expect(dayNow()).toBe(6); // horizon = etaDay 6
      expect(screen.getByTestId("transit-playpause")).toHaveAttribute("data-state", "paused");
      expect(vi.getTimerCount(), "到窗口右端后不许还有定时器空转").toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("连点播放/暂停/倍速：ref 覆盖前先清，不留孤儿句柄", async () => {
    stubMatchMedia(false);
    const user = userEvent.setup();
    render(<TransitFlowLayer sources={{ interBaseTransfer: rows }} />);
    const btn = screen.getByTestId("transit-playpause");
    for (let i = 0; i < 6; i++) await user.click(btn);
    await user.click(screen.getByTestId("transit-speed-2"));
    await user.click(screen.getByTestId("transit-speed-8"));
    await user.click(screen.getByTestId("transit-playpause"));
    // afterEach 的 leakGuard 会收割；这里再直接咬一次（见下条泄漏门）
  });

  /** 泄漏门：卸载后进程里不许还有本层排的定时器 / rAF（rAF 在本套件被 polyfill 成 setTimeout，同样被收割）。 */
  it("泄漏门 · unmount 后无残留定时器 / rAF", async () => {
    stubMatchMedia(false);
    const user = userEvent.setup();
    const nodes: TransitNodeInput[] = [{ nodeId: "b", label: "闸", cadence: { everyDays: 3, kind: "batch" } }];
    const many = [3, 4, 5].map((eta, i) => xfer({ id: `X${i}`, from: "a", to: "b", dispatchDay: 0, etaDay: eta }));
    const { unmount } = render(<TransitFlowLayer nodes={nodes} sources={{ interBaseTransfer: many }} initialDay={6} />);
    // 播放中（定时器活着）+ 批量放行脉冲（rAF 活着）时直接卸载 —— 最坏情况
    await user.click(screen.getByTestId("transit-playpause"));
    unmount();
    expect(harvestLeakedTimers(), "卸载后仍有本层排的定时器/rAF 存活 —— 会在环境拆除后 fire，整包随机红").toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. 三色系（dark / light / warm）
// ═══════════════════════════════════════════════════════════════════════════════
describe("三色系 · dark / light / warm 全过（零硬编码颜色）", () => {
  const cssPath = "apps/frontend-shell/src/views/sim/TransitFlowLayer.module.css";
  const css = readRepo(cssPath);
  const tsx = readRepo("apps/frontend-shell/src/views/sim/TransitFlowLayer.tsx");
  const ts = readRepo("apps/frontend-shell/src/views/sim/transitFlow.ts");
  const tokens = readRepo("apps/frontend-shell/src/styles/tokens.css");
  const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(tokens)![1]!;
  const rootTokens = new Set([...rootBlock.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!));

  it("样式与组件里零硬编码颜色", () => {
    const hex = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex, `样式里出现硬编码 hex：${hex.join(", ")}`).toEqual([]);
    const fn = css.match(/\b(rgba?|hsla?)\s*\(/g) ?? [];
    expect(fn, `样式里出现硬编码 ${fn.join(", ")}`).toEqual([]);
    for (const [name, src] of [["tsx", tsx], ["ts", ts]] as const) {
      expect(src.match(/#[0-9a-fA-F]{6}\b/g) ?? [], `${name} 里出现硬编码 hex`).toEqual([]);
      expect(src.match(/\b(rgba?|hsla?)\s*\(/g) ?? [], `${name} 里出现硬编码 rgb/hsl`).toEqual([]);
    }
  });

  it("样式用到的每个 CSS 变量都定义在 tokens.css 的 :root（否则某套主题下取不到值）", () => {
    const cssNoComment = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const used = new Set([...cssNoComment.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!));
    expect(used.size).toBeGreaterThan(8);
    const missing = [...used].filter((t) => !rootTokens.has(t));
    expect(missing, `这些 token 不在 :root（只在某个 data-theme 分支里定义 → 其它主题下失效）：${missing.join(", ")}`).toEqual([]);
  });

  it("三套主题下都渲染出完整图层与诚实缺席块", () => {
    const nodes: TransitNodeInput[] = [{ nodeId: "b", label: "闸", cadence: { everyDays: 5, kind: "shipping" } }];
    const rows = [6, 7].map((eta, i) => xfer({ id: `X${i}`, from: "a", to: "b", dispatchDay: 0, etaDay: eta }));
    for (const theme of [null, "light", "warm"] as const) {
      if (theme === null) document.documentElement.removeAttribute("data-theme");
      else document.documentElement.setAttribute("data-theme", theme);
      const { unmount } = render(<TransitFlowLayer nodes={nodes} sources={{ interBaseTransfer: rows }} initialDay={9} />);
      const layer = screen.getByTestId("transit-flow-layer");
      expect(layer).toBeInTheDocument();
      expect(within(layer).getByTestId("transit-branch-procurement")).toHaveAttribute("data-status", "EMPTY");
      expect(within(layer).getByTestId("transit-cadence-b")).toBeInTheDocument();
      expect(within(layer).getAllByTestId(/^transit-car-/)).toHaveLength(2);
      unmount();
    }
  });
});
