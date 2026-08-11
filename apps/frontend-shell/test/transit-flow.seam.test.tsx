import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { commentOnlyCanary, factHits, srcCode, stripComments } from "./factlock";
import { harvestLeakedTimers } from "./leakGuard";
import { loginAs, renderWithClient as render } from "./utils";

/** 事实锁的扫描面：整棵 datacore 源码树，剥注释后。判据本体在 `./factlock`（含病历）。 */
const datacoreCode = () => srcCode("apps/datacore/src");

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
  deriveCadenceAbsence,
  deriveProcurementBranch,
  parseCadenceRows,
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
  it("采购支线今天仍为空，但**病因必须说准**：是本层没去取，不是本体没有（D2 已并线）", () => {
    render(<TransitFlowLayer sources={{}} />);
    const branch = screen.getByTestId("transit-branch-procurement");
    expect(branch).toHaveAttribute("data-status", "EMPTY");
    // ── 咬的是**屏上那一份**（WO-TRANSIT-WIRE 后图层现算，不再读模块级常量）────
    //    `sources` 给了但没给采购段三类 ⇒ 上层接管取数却一份都没喂 ⇒ 确实是"没拿到"。
    expect(branch).toHaveAttribute("data-cause", "NOT_FETCHED");
    expect(branch).toHaveAttribute("data-fetched", "");
    expect(branch).toHaveAttribute("data-usable", "0");
    // 病因说准：屏上必须写「本层没去取」，且必须点名那三个**已经存在**的承载对象
    expect(branch).toHaveTextContent("本层没去取");
    expect(branch).toHaveTextContent("PurchaseOrder");
    expect(branch).toHaveTextContent("CustomsClearance");
    expect(branch).toHaveTextContent("IncomingInspection");
    // ⛔ 反向锁：D2 并线后这两句已成假话，任何人写回去当场红
    expect(branch).not.toHaveTextContent("本体缺在途承载物");
    expect(branch).not.toHaveTextContent("0 命中");
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

  it("节拍：引擎没下发 cadence ⇒ 界面明说 EMPTY，且病因是「本层没去取」而非「数据层无承载」", () => {
    render(<TransitFlowLayer sources={{ interBaseTransfer: [xfer({ id: "X1", from: "a", to: "b", dispatchDay: 0, etaDay: 5 })] }} />);
    const absence = screen.getByTestId("transit-cadence-absence");
    expect(absence).toHaveAttribute("data-status", "EMPTY");
    expect(absence).toHaveTextContent("Cadence");
    // ── 咬的是**屏上那一份**（WO-TRANSIT-WIRE 后图层现算，不再读模块级常量）────
    expect(absence).toHaveAttribute("data-cause", "NOT_FETCHED");
    expect(absence).toHaveAttribute("data-fetched", "");
    expect(absence).toHaveTextContent("本层没去取");
    // ⛔ 反向锁：D1 并线后这句已成假话（cadence.ts 存在、service.ts:712 真落库）
    expect(absence).not.toHaveTextContent("节拍在数据层无承载");
    expect(absence).not.toHaveTextContent("0 命中");
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
// 3.5 · G-FRONTEND-HARDCODED-ABSENCE：缺席声明必须**由数据派生**，不许写死
//
// 本组咬的是那个真实事故：缺席文案写成 `const` 字面量 ⇒ 它记录的是**写下它那一刻**的
// 仓库状态；上游（D1 节拍 / D2 采购段）并线之后，屏上那句"本体没有"就变成了假话，
// 而没有任何测试会红 —— 旧断言咬的是 `evidence.length >= 3`，咬的是**借口数量**、不是借口真假。
//
// 判据分两层，缺一不可：
//  ① 数据驱动：喂**含**数据的载荷 ⇒ 不出缺席行；喂**不含**的 ⇒ 出缺席行且**病因正确**。
//  ② 事实锁：文案里引用的上游 file:line 事实必须**当场从仓库读出来复验**。
//     上游哪天把承载删了/改了，这里当场红，逼着把文案改回去 —— 反过来也一样。
// ═══════════════════════════════════════════════════════════════════════════════
describe("G-FRONTEND-HARDCODED-ABSENCE · 缺席声明由数据派生，且病因分三档", () => {
  /** `Cadence` 落库行的真实形状（`apps/datacore/src/synthetic/cadence.ts:489 cadenceObjectRows`）。 */
  const cadenceRow = (o: { nodeId: string; everyDays?: number; kind?: string; offsetDays?: number; dataMode?: string; emptyReason?: string }) => ({
    nodeId: o.nodeId,
    label: `${o.nodeId} 站`,
    stage: "DELIVERY",
    dataMode: o.dataMode ?? "SYNTHETIC",
    flowGate: true,
    note: "",
    ...(o.emptyReason === undefined ? {} : { emptyReason: o.emptyReason }),
    ...(o.everyDays === undefined ? {} : { everyDays: o.everyDays, cadenceKind: o.kind ?? "batch", intervalCount: 6 }),
    ...(o.offsetDays === undefined ? {} : { offsetDays: o.offsetDays }),
  });

  // ── ① 接缝：有数据 ⇒ 不出缺席行 ────────────────────────────────────────────
  it("SEAM · 节拍：喂含 cadence 的载荷 ⇒ 缺席行消失、真闸门上屏（同一段代码，只换数据）", () => {
    // (a) 引擎 nodes[] 这一路 —— 走 DOM，咬的是链路不是函数
    const nodes: TransitNodeInput[] = [{ nodeId: "b", label: "闸", cadence: { everyDays: 5, kind: "shipping" } }];
    render(<TransitFlowLayer nodes={nodes} sources={{ interBaseTransfer: [xfer({ id: "X1", from: "a", to: "b", dispatchDay: 0, etaDay: 5 })] }} />);
    expect(screen.queryByTestId("transit-cadence-absence")).toBeNull(); // ← 缺席行**不再出现**
    expect(screen.getByTestId("transit-cadence-live")).toBeInTheDocument();
    expect(screen.getByTestId("transit-cadence-b")).toHaveTextContent("每 5 天开闸");

    // (b) 对象库 Cadence 行这一路 —— 派生层判定
    const present = deriveCadenceAbsence({ cadenceRows: [cadenceRow({ nodeId: "b", everyDays: 5, kind: "shipping" })] });
    expect(present.status).toBe("PRESENT");
    expect(present.cause).toBe("PRESENT");
    expect(present.probe).toEqual({ fetched: 1, usable: 1 });
    expect(present.reason).not.toMatch(/无承载|没有一条数据/);
  });

  it("SEAM · 采购段：喂含四段日戳的载荷 ⇒ 判为 PRESENT，且点名覆盖了哪几条腿", () => {
    const present = deriveProcurementBranch({
      purchaseOrderRows: [{ poId: "po_1", matId: "sep_film", qty: 100, etaDay: 30, orderDay: 2, shipDay: 9, arriveDay: 20 }],
      customsRows: [{ clearanceId: "cc_po_1", poId: "po_1", declaredDay: 20, clearedDay: 24, holdDays: 1 }],
      inspectionRows: [{ inspectionId: "iqc_po_1", poId: "po_1", arrivedDay: 24, releasedDay: 30 }],
    });
    expect(present.status).toBe("PRESENT");
    expect(present.probe.usable).toBe(4); // 四条腿全部算得出来
    for (const leg of ["supplier_production", "in_transit", "customs", "incoming_inspection"]) {
      expect(present.reason).toContain(leg);
    }
    expect(present.reason).not.toMatch(/缺在途承载物/);
  });

  // ── ② 接缝：没数据 ⇒ 出缺席行，且**三档病因各自不同** ──────────────────────
  it("SEAM · 三档病因必须分得开：没去取 / 取回来被契约剔掉 / 本租户真没有", () => {
    // 没去取（= 今天生产的实参）
    const notFetched = deriveCadenceAbsence();
    expect(notFetched.cause).toBe("NOT_FETCHED");
    expect(notFetched.probe.fetched).toBeNull();
    expect(notFetched.reason).toContain("本层没去取");
    expect(notFetched.unblockedBy).toContain("接线");

    // 问了、回 0 条 —— 与"没问过"必须分得开（这正是此前混成一句"没有"的地方）
    const tenantEmpty = deriveCadenceAbsence({ cadenceRows: [] });
    expect(tenantEmpty.cause).toBe("TENANT_EMPTY");
    expect(tenantEmpty.probe).toEqual({ fetched: 0, usable: 0 });
    expect(tenantEmpty.unblockedBy).toContain("种数据");
    expect(tenantEmpty.cause).not.toBe(notFetched.cause);

    // 取回来了但读不成闸门（诚实缺席行：dataMode 非 SYNTHETIC ⇒ 无节拍，**不是 0**）
    const rejected = deriveCadenceAbsence({
      cadenceRows: [cadenceRow({ nodeId: "b", dataMode: "EMPTY", emptyReason: "该环节发生序列不足 2 次，推不出周期" })],
    });
    expect(rejected.cause).toBe("CONTRACT_REJECTED");
    expect(rejected.probe).toEqual({ fetched: 1, usable: 0 });
    expect(rejected.evidence.join("\n")).toContain("推不出周期"); // 原因来自数据本身，不是编的话术
    expect(rejected.unblockedBy).toContain("修数据");

    // 采购段同款三档
    expect(deriveProcurementBranch().cause).toBe("NOT_FETCHED");
    expect(deriveProcurementBranch({ customsRows: [] }).cause).toBe("TENANT_EMPTY");
    const poBroken = deriveProcurementBranch({ purchaseOrderRows: [{ poId: "po_1", matId: "m", qty: 1, etaDay: 30 }] });
    expect(poBroken.cause).toBe("CONTRACT_REJECTED");
    expect(poBroken.evidence.join("\n")).toMatch(/shipDay|arriveDay|orderDay/);
  });

  it("Cadence 读回口逐字镜像 datacore：dataMode 非 SYNTHETIC ⇒ 无节拍（不是 0）；字段名是 cadenceKind", () => {
    // 字段名写成 kind（而不是落库的 cadenceKind）⇒ 读不回来。拼错就恒 0 条，必须当场红。
    const wrongName = parseCadenceRows([{ nodeId: "b", dataMode: "SYNTHETIC", everyDays: 5, kind: "batch" }]);
    expect(wrongName.nodes).toHaveLength(0);
    expect(wrongName.rejectReasons.join("\n")).toContain("CadenceSchema");

    const ok = parseCadenceRows([cadenceRow({ nodeId: "b", everyDays: 5, offsetDays: 2, kind: "batch" })]);
    expect(ok.nodes).toEqual([{ nodeId: "b", label: "b 站", stage: "DELIVERY", cadence: { everyDays: 5, offsetDays: 2, kind: "batch" } }]);

    // 诚实缺席行照样落库、照样读得到，但**不许变成一个 0 节拍**（0 = 随到随办 = 把节拍当不存在）
    const empty = parseCadenceRows([cadenceRow({ nodeId: "b", dataMode: "EMPTY", emptyReason: "样本不足" })]);
    expect(empty.nodes).toHaveLength(0);
    expect(empty.rejectReasons.join("\n")).toContain("样本不足");

    // R6：输入顺序打乱 ⇒ 输出全序一致
    const rows = ["z", "a", "m"].map((n) => cadenceRow({ nodeId: n, everyDays: 4 }));
    expect(parseCadenceRows(rows).nodes.map((n) => n.nodeId)).toEqual(["a", "m", "z"]);
  });

  // ── ③ 事实锁：文案引用的上游事实，当场从仓库读出来复验 ──────────────────────
  it("事实锁 · 节拍承载**确实已在**数据层（上游哪天删了，这里红 ⇒ 逼着把文案改回去）", () => {
    // 锁的是「**数据层**有节拍承载」这个能力 —— 它与承载住在哪个文件无关。
    // 原写法钉死 `synthetic/service.ts` + `synthetic/cadence.ts`（还外加一条 existsSync）：
    // 上游一做无害重构就假红，命中注释又会假绿。见 `./factlock` 顶注的病历。
    const engine = datacoreCode();
    expect(engine.length, "datacore 源码扫不到几个文件 ⇒ 扫描器坏了，不许读作「承载没了」").toBeGreaterThan(50);
    expect(factHits(engine, "putAll("), "金丝雀①：已知必中的 putAll( 一个都找不到 ⇒ 扫描器坏了").not.toEqual([]);
    expect(
      factHits(commentOnlyCanary("putAllCANARY"), "putAllCANARY"),
      "金丝雀②：注释里的散文仍被当成代码 ⇒ stripComments 坏了，本次结论作废",
    ).toEqual([]);

    expect(
      factHits(engine, 'putAll("Cadence"'),
      '数据层不再 putAll("Cadence") —— 节拍又回到"只有契约没有承载"，CADENCE_ABSENCE 文案必须改回去',
    ).not.toEqual([]);
    // 读回口还在，且落库字段名没漂（前端这边是受控镜像，名字一漂就恒 0 条）
    expect(factHits(engine, /export function cadenceFromProps\b/), "合成层不再产出 cadence —— 同上").not.toEqual([]);
    expect(factHits(engine, /\bcadenceKind\b/), "落库字段名 cadenceKind 漂了 —— 前端镜像会恒 0 条").not.toEqual([]);
    // ⇒ 因此"数据层无承载"这句话今天必须是假的
    expect(CADENCE_ABSENCE.evidence.join("\n")).not.toMatch(/0 命中|不存在（D1 未并线）/);
  });

  it("事实锁 · 采购段四段承载**确实已在**（PurchaseOrder 有日戳 · 清关/到货检验是在册对象类型）", () => {
    // 同上：锁「在不在」，不锁「在哪个文件」。`pd("orderDay"` 这种**声明调用**比裸 `orderDay`
    // 更钉得住 —— 裸串在别的求解器里也会撞到，撞上了就是拿一个不度量该事实的数当证据。
    const engine = datacoreCode();
    expect(engine.length, "datacore 源码扫不到几个文件 ⇒ 扫描器坏了，不许读作「承载没了」").toBeGreaterThan(50);
    expect(factHits(engine, "def("), "金丝雀①：已知必中的 def( 一个都找不到 ⇒ 扫描器坏了").not.toEqual([]);
    expect(
      factHits(commentOnlyCanary("orderDayCANARY"), "orderDayCANARY"),
      "金丝雀②：注释里的散文仍被当成代码 ⇒ stripComments 坏了，本次结论作废",
    ).toEqual([]);

    for (const field of ["orderDay", "shipDay", "arriveDay"]) {
      expect(factHits(engine, `pd("${field}"`), `PurchaseOrder 少了 ${field} —— 采购支线文案必须同步改`).not.toEqual([]);
    }
    expect(factHits(engine, 'def("CustomsClearance"'), "CustomsClearance 不再是在册对象类型").not.toEqual([]);
    expect(factHits(engine, 'def("IncomingInspection"'), "IncomingInspection 不再是在册对象类型").not.toEqual([]);
    expect(factHits(engine, 'putAll("CustomsClearance"'), "清关不再落库").not.toEqual([]);
    expect(factHits(engine, 'putAll("IncomingInspection"'), "到货检验不再落库").not.toEqual([]);
    // 契约侧四段腿单源。**这一条锚在文件上是对的**：「单源」这个事实本身就是
    // 「只有 procurement.ts 一份」，位置就是事实（不属于本单要治的位置锚）。
    const proc = readRepo("packages/contracts/src/procurement.ts");
    for (const leg of ["supplier_production", "in_transit", "customs", "incoming_inspection"]) {
      expect(proc).toContain(leg);
    }
    // ⇒ 因此"customs/IQC 0 命中"这句话今天必须是假的
    expect(PROCUREMENT_BRANCH.evidence.join("\n")).not.toMatch(/0 命中/);
  });

  it("源码级门 · 缺席文案不许再退回 `const` 字面量（回归锁）", () => {
    // 注释不参与判定（与本文件既有源码级门同款做法）——
    // 文档里**引用**旧写法是应该的（那是病历），真正要禁的是它重新变成可执行代码。
    // ⚠ 这行剥注释原先只喂了下面那条 not.toMatch，上面两条 toMatch 吃的是**原文** ——
    //   注释里写一句 `export const CADENCE_ABSENCE = deriveCadenceAbsence(` 就能把它们喂绿，
    //   正是「命中注释而误报绿」那半边病。三条现在共用同一份剥注释后的代码。
    const code = stripComments(readRepo("apps/frontend-shell/src/views/sim/transitFlow.ts"));
    // 两个名字必须是**派生调用**的结果，不是手写对象字面量
    expect(code).toMatch(/export const CADENCE_ABSENCE[^\n]*=\s*deriveCadenceAbsence\(/);
    expect(code).toMatch(/export const PROCUREMENT_BRANCH[^\n]*=\s*deriveProcurementBranch\(/);
    expect(code, "缺席声明又被写回 `status: \"EMPTY\" as const` —— 那正是本门要治的病").not.toMatch(/status:\s*"EMPTY"\s+as\s+const/);
  });

  /**
   * ── ④ 零输入基线（`CADENCE_ABSENCE` / `PROCUREMENT_BRANCH` 两个模块级常量）────────
   *
   * ⚠ WO-TRANSIT-WIRE 之后**图层已经不读这两个值了**（它每次渲染现算）。
   *   它们今天唯一的生产消费方是 `SandboxConsole.tsx` 的可算性图例。
   *
   * ⚠⚠ WO-STALE-CLAIMS 收紧了这条断言（原断言只查了两个名字**出现过**，那不够）：
   *   图例当时渲染的是 `.reason` —— 也就是这一档「本层没去取」的原话；
   *   而它**下一行**就渲染会真发四条 `searchObjects` 的 `<TransitFlowView>`。
   *   于是同一屏里两句话互相打脸：图例说没人去取，它下面的图层正在取。
   *   这正是本体 §8 `G-STALE-MEASURED-CLAIM`「过期声明」的又一形态 ——
   *   **这次不是上游变了，是同一屏里的邻居变了**。
   *   故现在咬的是：图例只许读**输入无关**的 `.label`，`.reason` / `.status` / `.unblockedBy`
   *   这三个"随输入变"的字段一个都不许上屏。
   */
  it("零输入基线：不喂任何输入 ⇒ NOT_FETCHED（这一档只对「自己不取数的调用方」成立）", () => {
    expect(CADENCE_ABSENCE.cause).toBe("NOT_FETCHED");
    expect(CADENCE_ABSENCE.probe).toEqual({ fetched: null, usable: 0 });
    expect(PROCUREMENT_BRANCH.cause).toBe("NOT_FETCHED");
    expect(PROCUREMENT_BRANCH.probe).toEqual({ fetched: null, usable: 0 });
  });

  it("控制台图例只读 `.label`（输入无关），**不许**复述零输入那一档的 reason/status/unblockedBy", () => {
    const console_ = readRepo("apps/frontend-shell/src/views/sim/SandboxConsole.tsx");
    // 注释不参与判定（同本文件既有源码级门做法）：注释里讲清病因是应该的，禁的是它是可执行代码。
    const code = console_.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
    // 消费方确实还在（这两个导出不是没人要的死符号 —— 删了会打红构建）
    expect(code).toContain("CADENCE_ABSENCE.label");
    expect(code).toContain("PROCUREMENT_BRANCH.label");
    for (const rec of ["CADENCE_ABSENCE", "PROCUREMENT_BRANCH"]) {
      for (const perishable of ["reason", "status", "unblockedBy"]) {
        expect(code, `${rec}.${perishable} 又上屏了 —— 那是"零输入"那一档，与屏上正在发生的事无关`).not.toContain(`${rec}.${perishable}`);
      }
    }
    // `.label` 之所以能读，是因为它在 deriveXxx 的**四个分支里恒等**（不带保质期）
    const labels = new Set([
      deriveCadenceAbsence().label,
      deriveCadenceAbsence({ cadenceRows: [] }).label,
      deriveCadenceAbsence({ cadenceRows: [cadenceRow({ nodeId: "x", everyDays: 5 })] }).label,
    ]);
    expect(labels.size, "label 随输入变了 —— 那图例就不能只读它").toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3.6 · WO-TRANSIT-WIRE：图层**真的去取**那些已经存在的数据（接线的接缝）
//
// 上一单把病因说准了，但视图侧那条线还没接：图层只发三条 searchObjects、宿主也不传 nodes，
// 于是「缺席」这个判定**根本没有输入可判**，屏上那块面板永远在。本组咬的是接线本身：
//  ① 喂真数据 ⇒ 缺席块从 DOM 消失、实况块上屏（**同一段代码，只换数据**）；
//  ② 喂空数据 ⇒ 仍出缺席块，且**三档病因在 DOM 上就分得开**（此前只在派生层分得开）；
//  ③ 真取数路（MSW）⇒ 屏上的病因**由响应决定**，证明查询真发出去了、不是 props 里自说自话；
//  ④ 源码级回归锁 ⇒ 四条查询与两处派生调用不许被摘掉，也不许退回去读那两个模块级常量。
// ═══════════════════════════════════════════════════════════════════════════════
describe("WO-TRANSIT-WIRE · 图层自取 Cadence / 采购段，缺席由取回来的东西决定", () => {
  /** `Cadence` 落库行（`apps/datacore/src/synthetic/cadence.ts:488 cadenceObjectRows` 的真实形状）。 */
  const cadenceRow = (o: { nodeId: string; everyDays?: number; kind?: string; dataMode?: string; emptyReason?: string }) => ({
    nodeId: o.nodeId,
    label: `${o.nodeId} 站`,
    stage: "DELIVERY",
    dataMode: o.dataMode ?? "SYNTHETIC",
    flowGate: true,
    note: "",
    ...(o.emptyReason === undefined ? {} : { emptyReason: o.emptyReason }),
    ...(o.everyDays === undefined ? {} : { everyDays: o.everyDays, cadenceKind: o.kind ?? "batch", intervalCount: 6 }),
  });
  /** 采购段三类的真实行（`battery-extended.ts:157-192` 字段集）。 */
  const poRow = { poId: "po_1", matId: "sep_film", qty: 100, etaDay: 30, orderDay: 2, shipDay: 9, arriveDay: 20 };
  const customsRow = { clearanceId: "cc_po_1", poId: "po_1", declaredDay: 20, clearedDay: 24, holdDays: 1 };
  const iqcRow = { inspectionId: "iqc_po_1", poId: "po_1", arrivedDay: 24, releasedDay: 30 };

  const oneTransfer = [xfer({ id: "X1", from: "a", to: "b", dispatchDay: 0, etaDay: 5 })];

  // ── ① 有数据 ⇒ 缺席块消失、实况块上屏 ──────────────────────────────────────
  it("SEAM · 对象库 Cadence 行经图层自己的读回口点亮闸门（缺席块从 DOM 消失）", () => {
    render(
      <TransitFlowLayer
        sources={{ interBaseTransfer: oneTransfer, cadence: [cadenceRow({ nodeId: "b", everyDays: 5, kind: "shipping" })] }}
        initialDay={5}
      />,
    );
    // 缺席块**不再出现**（这一条就是「接线即自愈」：同一段 JSX，只换了输入）
    expect(screen.queryByTestId("transit-cadence-absence")).toBeNull();
    const live = screen.getByTestId("transit-cadence-live");
    expect(live).toHaveAttribute("data-count", "1");
    expect(screen.getByTestId("transit-cadence-b")).toHaveTextContent("每 5 天开闸");
    // 而且这个站是**引擎侧**的（Cadence 行 = 引擎侧承载），不是从批次数据行推出来的
    expect(screen.getByTestId("transit-station-b")).toHaveAttribute("data-cadence", "1");
    expect(screen.getByTestId("transit-station-b")).toHaveAttribute("data-origin", "engine");
    expect(screen.getByTestId("transit-flow-layer")).toHaveAttribute("data-station-origin", "engine");
    // 闸门真的在管事：第 5 天到站的批次被扣到第 5 天（everyDays=5 ⇒ 闸门日）——不是只印了个 chip
    expect(screen.getByTestId("transit-queues")).toBeInTheDocument();
  });

  it("SEAM · 采购段三类日戳齐全 ⇒ 缺席块消失、实况块上屏且点名四条腿", () => {
    render(
      <TransitFlowLayer
        sources={{
          interBaseTransfer: oneTransfer,
          purchaseOrder: [poRow],
          customsClearance: [customsRow],
          incomingInspection: [iqcRow],
        }}
      />,
    );
    expect(screen.queryByTestId("transit-branch-procurement")).toBeNull();
    const live = screen.getByTestId("transit-branch-procurement-live");
    expect(live).toHaveAttribute("data-status", "PRESENT");
    expect(live).toHaveAttribute("data-cause", "PRESENT");
    expect(live).toHaveAttribute("data-usable", "4");
    for (const leg of ["supplier_production", "in_transit", "customs", "incoming_inspection"]) {
      expect(live).toHaveTextContent(leg);
    }
    // ⛔ 反向锁：D2 并线后这些说法一律不许再上屏
    expect(live).not.toHaveTextContent("本体缺在途承载物");
    expect(live).not.toHaveTextContent("0 命中");
    expect(live).not.toHaveTextContent("本层没去取");
    // 诚实边界必须同时在屏上：日戳齐全 ≠ 已经画成车（说"能画"却不画，与说"没有"一样骗人）
    expect(screen.getByTestId("transit-branch-procurement-scope")).toHaveTextContent("屏上不会出现采购段的车");
    expect(screen.queryAllByTestId(/^transit-car-/).length).toBe(1); // 只有那条 InterBaseTransfer 的车
  });

  // ── ② 没数据 ⇒ 仍缺席，且三档病因**在 DOM 上**分得开 ────────────────────────
  it("SEAM · 三档病因在 DOM 上分得开：没去取(fetched 空) / 读不成(fetched>0) / 本租户真没有(fetched=0)", () => {
    // (a) 没去取 —— 上层接管了取数但一条 Cadence 都没喂
    const a = render(<TransitFlowLayer sources={{ interBaseTransfer: oneTransfer }} />);
    const notFetched = screen.getByTestId("transit-cadence-absence");
    expect(notFetched).toHaveAttribute("data-cause", "NOT_FETCHED");
    expect(notFetched).toHaveAttribute("data-fetched", ""); // null ⇒ 空串，与 "0" 一眼分得开
    expect(notFetched).toHaveTextContent("本层没去取");
    a.unmount();

    // (b) 本租户真没有 —— 问了，回 0 条
    const b = render(<TransitFlowLayer sources={{ interBaseTransfer: oneTransfer, cadence: [] }} />);
    const tenantEmpty = screen.getByTestId("transit-cadence-absence");
    expect(tenantEmpty).toHaveAttribute("data-cause", "TENANT_EMPTY");
    expect(tenantEmpty).toHaveAttribute("data-fetched", "0");
    expect(tenantEmpty).toHaveTextContent("已经查过了");
    expect(tenantEmpty).toHaveTextContent("种数据");
    expect(tenantEmpty).not.toHaveTextContent("本层没去取"); // 三档不许说同一句话
    b.unmount();

    // (c) 取回来读不成 —— 诚实缺席行（dataMode 非 SYNTHETIC），原因来自数据本身
    const c = render(
      <TransitFlowLayer
        sources={{
          interBaseTransfer: oneTransfer,
          cadence: [cadenceRow({ nodeId: "b", dataMode: "EMPTY", emptyReason: "该环节发生序列不足 2 次，推不出周期" })],
        }}
      />,
    );
    const rejected = screen.getByTestId("transit-cadence-absence");
    expect(rejected).toHaveAttribute("data-cause", "CONTRACT_REJECTED");
    expect(rejected).toHaveAttribute("data-fetched", "1");
    expect(rejected).toHaveAttribute("data-usable", "0");
    expect(rejected).toHaveTextContent("推不出周期"); // 原因来自数据行，不是编的话术
    expect(rejected).toHaveTextContent("修数据");
    c.unmount();
  });

  it("SEAM · 采购段同款三档（且「读不成」时逐条点名缺了哪个日戳）", () => {
    const a = render(<TransitFlowLayer sources={{ customsClearance: [] }} />);
    expect(screen.getByTestId("transit-branch-procurement")).toHaveAttribute("data-cause", "TENANT_EMPTY");
    expect(screen.getByTestId("transit-branch-procurement")).toHaveAttribute("data-fetched", "0");
    a.unmount();

    // 旧形状的 PurchaseOrder（只有 poId/matId/qty/etaDay）⇒ 两条腿都算不出来
    const b = render(<TransitFlowLayer sources={{ purchaseOrder: [{ poId: "po_1", matId: "m", qty: 1, etaDay: 30 }] }} />);
    const rejected = screen.getByTestId("transit-branch-procurement");
    expect(rejected).toHaveAttribute("data-cause", "CONTRACT_REJECTED");
    expect(rejected.textContent ?? "").toMatch(/orderDay|shipDay|arriveDay/);
    b.unmount();
  });

  it("DOM 与派生记录不许打架：缺席块在 ⟺ 没有一个闸门站（usable === 0）", () => {
    const withGate = render(
      <TransitFlowLayer sources={{ interBaseTransfer: oneTransfer, cadence: [cadenceRow({ nodeId: "b", everyDays: 4 })] }} />,
    );
    expect(screen.queryByTestId("transit-cadence-absence")).toBeNull();
    expect(screen.getByTestId("transit-cadence-live")).toHaveAttribute("data-count", "1");
    withGate.unmount();

    const without = render(<TransitFlowLayer sources={{ interBaseTransfer: oneTransfer, cadence: [] }} />);
    expect(screen.getByTestId("transit-cadence-absence")).toHaveAttribute("data-usable", "0");
    expect(screen.queryByTestId("transit-cadence-live")).toBeNull();
    without.unmount();
  });

  // ── ③ 真取数路：病因由**响应**决定（证明查询真的发出去了）──────────────────
  it("接线的活证据 · 真取数（mock 态）：屏上的病因由响应决定，不再是恒为真的 NOT_FETCHED", async () => {
    loginAs("planner");
    render(<TransitFlowLayer />);

    // 查询还在飞的那一刻，屏上说的是「取数中」——**不许**在这一刻宣告"本层没去取"（那是这一刻的假话）
    expect(screen.getByTestId("transit-cadence-fetching")).toBeInTheDocument();
    expect(screen.getByTestId("transit-cadence-absence")).toHaveAttribute("data-loading", "1");

    // 回来之后：MSW 的 /a/v1/objects 对 Cadence 没有分支 ⇒ 落 else 返回订单行 ⇒ 一条都读不成闸门。
    // 于是病因必须是 CONTRACT_REJECTED（问了、拿回来了、用不了），**不是** NOT_FETCHED。
    // ⇒ 这就是「那条查询真的发出去了」的活证据：props 里没喂任何东西，病因却变了。
    await waitFor(() =>
      expect(screen.getByTestId("transit-cadence-absence")).toHaveAttribute("data-cause", "CONTRACT_REJECTED"),
    );
    const absence = screen.getByTestId("transit-cadence-absence");
    expect(absence).toHaveAttribute("data-loading", "0");
    expect(Number(absence.getAttribute("data-fetched"))).toBeGreaterThan(0);
    expect(absence).not.toHaveTextContent("本层没去取");

    await waitFor(() =>
      expect(screen.getByTestId("transit-branch-procurement")).toHaveAttribute("data-cause", "CONTRACT_REJECTED"),
    );
    expect(screen.getByTestId("transit-branch-procurement")).not.toHaveTextContent("本层没去取");
  });

  // ── ④ 源码级回归锁：接上的线不许再被摘掉 ────────────────────────────────────
  it("源码级门 · 四条查询 + 两处现算必须都在，且图层不许退回去读那两个模块级常量", () => {
    const view = readRepo("apps/frontend-shell/src/views/sim/TransitFlowLayer.tsx");
    const code = view.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    for (const type of ["Cadence", "PurchaseOrder", "CustomsClearance", "IncomingInspection"]) {
      expect(code, `图层不再查 ${type} —— 那块面板又变回一句永远为真的话`).toContain(`searchObjects("${type}"`);
    }
    // 现算，而不是读常量
    expect(code, "节拍缺席不是现算的了").toMatch(/deriveCadenceAbsence\(\s*\{/);
    expect(code, "采购缺席不是现算的了").toMatch(/deriveProcurementBranch\(\s*\{/);
    // Cadence 行必须真的并进站点集合（只查不用 = 白查）
    expect(code, "查回来的 Cadence 行没有并进 resolveStations 的引擎侧站点 —— 闸门永远点不亮").toContain("parseCadenceRows(");
    expect(code).toMatch(/resolveStations\(\s*engineNodes/);
    // ⛔ 图层不许再读零输入基线（那是 SandboxConsole 图例的东西）
    expect(code, "图层又去读 CADENCE_ABSENCE 常量了 —— 那个值恒为 NOT_FETCHED，等于把诚实位重新冻住").not.toContain("CADENCE_ABSENCE");
    expect(code, "图层又去读 PROCUREMENT_BRANCH 常量了 —— 同上").not.toContain("PROCUREMENT_BRANCH");
    // 采购面板必须是**有条件**渲染（此前是无条件 <div>，无论有多少数据都在屏上）
    expect(code, "采购面板又变回无条件渲染了").toMatch(/procurementBranch\.status === "EMPTY"\s*\?/);
  });

  // ── ⑤ 事实锁：宿主注释/屏上文案引用的上游事实当场复验 ────────────────────────
  it("事实锁 · 宿主不许再说「节拍一律缺席」（它已经不成立了）", () => {
    const view = readRepo("apps/frontend-shell/src/views/sim/TransitFlowLayer.tsx");
    render(<TransitFlowLayer sources={{ interBaseTransfer: oneTransfer }} />);
    const hostNote = view.slice(view.indexOf("transit-flow-host-nodes"));
    expect(hostNote, "宿主还在说「节拍一律缺席」—— 图层现在自己去取 Cadence 了，这句话已经是假的").not.toMatch(
      /节拍一律缺席|节拍缺席；/,
    );
    // 上游承载还在（删了就该把上面这条改回去）。锚在**事实**上：承载搬去哪个文件都算数。
    expect(
      factHits(datacoreCode(), 'putAll("Cadence"'),
      '数据层不再 putAll("Cadence") —— 宿主那句话又变回真的了，本条文案必须改回去',
    ).not.toEqual([]);
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

  it("播放推进仿真时钟；倍速真的改变推进速率（同样墙钟 1× 走不掉一天、4× 走掉一天）", async () => {
    stubMatchMedia(false);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<TransitFlowLayer sources={{ interBaseTransfer: rows }} />);
      expect(dayNow()).toBe(0);

      await user.click(screen.getByTestId("transit-playpause"));
      expect(screen.getByTestId("transit-playpause")).toHaveAttribute("data-state", "playing");
      for (let i = 0; i < 3; i++) await tick(TRANSIT_TICK_BASE_MS + 5);
      expect(dayNow(), "1× 档三格墙钟应推进三天").toBe(3);

      // ── 倍速 A/B：给同样一小段墙钟（1× 一天的 1/4），看两档结果 ──────────
      await user.click(screen.getByTestId("transit-reset"));
      await user.click(screen.getByTestId("transit-playpause"));
      await tick(TRANSIT_TICK_BASE_MS / 4 + 5);
      expect(dayNow(), "1× 档下这点墙钟不够走一天").toBe(0);

      await user.click(screen.getByTestId("transit-playpause")); // 暂停
      await user.click(screen.getByTestId("transit-speed-4"));
      await user.click(screen.getByTestId("transit-playpause"));
      await tick(TRANSIT_TICK_BASE_MS / 4 + 5);
      expect(dayNow(), "4× 档下同样墙钟真的走掉一天").toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("走到窗口右端自动停，不空转", async () => {
    stubMatchMedia(false);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<TransitFlowLayer sources={{ interBaseTransfer: rows }} initialSpeed={8} />);
      await user.click(screen.getByTestId("transit-playpause"));
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
