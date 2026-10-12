/**
 * WO-TURN-LOOP · 世界线读取器 —— 把「第 N 回合」这件事变成**求解器读得到的一维**。
 *
 * ══ 这个模块存在的理由（实测得来，不是设计推演）═══════════════════════════════════
 * 兵棋的回合推进在本仓 **早就是完整的**，缺的从来不是它：
 *  · `sim/propagation.ts propagateTick` 有衰减 λ、有 `clamp`、有跨拍 `pending`/`carry`（延迟贡献）；
 *  · 每一拍都经 `putTickState` 落盘，整条世界线由 `listTickStates` 可取回；
 *  · 真后端实测（`docs/evidence/wo-turn-loop-exp.mjs`）：同样三次扰动**换个先后顺序**，
 *    终局逐字节不同（FWD `f0ff60bc66304e73` ≠ REV `0b752dc3bb7e2f9f`）⇒ **顺序确实有意义**。
 *
 * 断的是**下一段接缝**：求解器只读得到**一格**。`solvers/finance-world.ts` 是全仓唯一碰世界态的
 * 求解器，它调的是 `getTickState(tenant, world, curTick)` —— 单点读。于是：
 *
 *   **今天的行为**：求解器拿到第 3 拍那一张快照，对它重算一遍。
 *   **应该的行为**：求解器还应看到第 0/1/2 拍的**同一读数**，才能算出只有回合才有的量 ——
 *                   累积、衰减、拐点在第几拍、峰值落在哪一回合。
 *
 * 三态判定（铁律 0.5）：**不是**「没接线」（`finance-world.ts:183` 是真 src 调用方，不是 test）；
 * 是「**接了线接错地方**」—— 接在单点读上，而序列读（`listTickStates`）就在同一个仓储接口上，
 * 隔一个方法名。
 *
 * ⛔ **本模块不新增任何存储**：一个 `putTickState` 都不调，一张新表都不建。它只是把**已经落盘的**
 * 世界线按窗口取回来。「造第二套存储」正是本仓治过的那类事故（两处输入不同源 = 第二套真相源）。
 *
 * ⛔ **本模块不含任何业务阈值**：一个数字都没有。它只做「同一读数在各拍上的形状」这件纯粹的事，
 * 阈值判定留给调用方从**规则**里读回来（同 `solvers/chain-impediment.ts` 的那条铁律）。
 *
 * R6 确定性：纯读 + 纯函数，无 `Date.now`、无随机；帧按 tick 升序稳定排序。
 */
import type { TickState } from "@platform/contracts";
import type { Repos } from "../repo/repo.js";

/**
 * 缺省回看窗口 = 4 拍（当前 + 前 3）。
 *
 * 为什么是 4 而不是"全部"：`listTickStates` 是一条 `SELECT *`，长会话上把整条世界线拉回来
 * 会把求解器的耗时挂在会话长度上（`sim/seed-world.ts:169` 已经为同一条理由拒绝过它）。
 * 4 拍足以判方向/拐点/相邻增量；要更长由调用方显式给 `window`。
 */
export const WORLD_LINE_DEFAULT_WINDOW = 4;
/** 窗口上限 —— 防止调用方用一个大数把整条世界线拉成全表扫。 */
export const WORLD_LINE_MAX_WINDOW = 32;

/** 世界线上的一帧 = 某一拍的世界态。 */
export interface WorldLineFrame {
  tick: number;
  state: TickState;
}

/** 一段世界线（按 tick 升序，末帧 = 当前拍）。 */
export interface WorldLine {
  sessionId: string;
  /** 会话当前拍号（= 末帧的 tick，除非世界线有洞）。 */
  curTick: number;
  /** 窗口内的帧，**按 tick 升序**（R6：遍历序稳定）。 */
  frames: WorldLineFrame[];
  /** 调用方要的窗口长度。 */
  windowRequested: number;
  /** 实际拿到几拍（`frames.length`）——**回合的可披露量之一**：用了前几拍。 */
  ticksUsed: number;
  /** 世界线比窗口长 ⇒ 被截断（前面还有拍，只是没进这次窗口）。 */
  truncated: boolean;
  /** 诚实缺席：拿不到序列时说清为什么（绝不假装"没有历史"）。 */
  note: string | null;
}

/**
 * 取一段世界线（窗口内的末 N 拍）。
 *
 * ⚠ **诚实缺席**：会话一拍都没推进（`curTick === 0`）时返回**单帧**世界线并写 note ——
 * 那不是"读失败"，是"这个世界还没有历史"。两者混为一谈会让调用方把"新世界"报成"读不到数据"。
 */
export async function readWorldLine(
  repos: Repos,
  tenantId: string,
  sessionId: string,
  curTick: number,
  window: number = WORLD_LINE_DEFAULT_WINDOW,
): Promise<WorldLine> {
  const win = Math.max(1, Math.min(WORLD_LINE_MAX_WINDOW, Math.floor(window)));
  const all = await repos.sim.listTickStates(tenantId, sessionId);
  // R6：仓储不保证顺序（memory 走 Map、pg 走 SELECT），本处**显式**按 tick 升序。
  const sorted = [...all].sort((a, b) => a.tick - b.tick);
  const inRange = sorted.filter((t) => t.tick <= curTick);
  const frames: WorldLineFrame[] = inRange.slice(-win).map((t) => ({ tick: t.tick, state: t.state }));
  const note =
    frames.length === 0
      ? `世界 ${sessionId} 一帧世界线都没落盘（curTick=${curTick}）—— 这是「读不到历史」，不是「历史为空」，回合派生量一律不给。`
      : frames.length === 1
        ? `世界 ${sessionId} 只有 1 帧（curTick=${curTick}）—— 尚未推进过，回合派生量（增量/方向/拐点）**本就不存在**，不是算不出来。`
        : null;
  return {
    sessionId,
    curTick,
    frames,
    windowRequested: win,
    ticksUsed: frames.length,
    truncated: inRange.length > frames.length,
    note,
  };
}

/** 某个读数沿世界线的轨迹点。 */
export interface TurnPoint {
  tick: number;
  value: number;
}

/**
 * 回合派生量 —— **全部是单张快照算不出来的量**。
 *
 * 这一组就是本单要的「让回合对求解器可见」的兑现物：拿掉世界线，这里每一项都变成 `null`。
 */
export interface TurnDynamics {
  /** 同一读数在窗口内各拍的值（按 tick 升序）。 */
  trajectory: TurnPoint[];
  /** 相对**上一拍**的增量。单帧 ⇒ `null`（诚实：没有上一拍可减）。 */
  deltaFromPrev: number | null;
  /** 方向。单帧 ⇒ `UNKNOWN`（不是 `FLAT` —— "看不出来"与"没变"是两个命题）。 */
  direction: "RISING" | "FALLING" | "FLAT" | "UNKNOWN";
  /** 峰值落在哪一回合（并列取**最早**那拍：先到者为峰，R6 稳定）。 */
  peak: TurnPoint | null;
  /** 谷值落在哪一回合（并列取最早）。 */
  trough: TurnPoint | null;
  /** 窗口内各拍值之和（"累积"的直读量；单位同读数×拍）。 */
  accumulated: number;
  /** 窗口内最大单拍跳变的绝对值（拐得最狠的那一拍）。单帧 ⇒ `null`。 */
  maxStep: { fromTick: number; toTick: number; delta: number } | null;
  /** 用了几拍（= `trajectory.length`）。 */
  ticksUsed: number;
}

/** 数值规整：与 `finance-world.ts` 的 `round` 同口径（R6：避免末位漂移）。 */
const r6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/**
 * 由轨迹点派生回合量（**纯函数**·R6）。
 *
 * ⛔ 这里没有任何阈值判定 —— "越过阈值在第几拍"要由调用方把**规则里读回来的**阈值传进
 * `crossingTick()`，本函数绝不自带一个"看起来合理"的默认值。
 */
export function deriveTurnDynamics(points: TurnPoint[]): TurnDynamics {
  const pts = [...points].sort((a, b) => a.tick - b.tick);
  if (pts.length === 0) {
    return { trajectory: [], deltaFromPrev: null, direction: "UNKNOWN", peak: null, trough: null, accumulated: 0, maxStep: null, ticksUsed: 0 };
  }
  const last = pts[pts.length - 1]!;
  const prev = pts.length >= 2 ? pts[pts.length - 2]! : null;
  const deltaFromPrev = prev ? r6(last.value - prev.value) : null;
  const direction: TurnDynamics["direction"] =
    deltaFromPrev === null ? "UNKNOWN" : deltaFromPrev > 0 ? "RISING" : deltaFromPrev < 0 ? "FALLING" : "FLAT";
  let peak = pts[0]!;
  let trough = pts[0]!;
  for (const p of pts) {
    if (p.value > peak.value) peak = p; // 严格大于 ⇒ 并列保留**最早**那拍
    if (p.value < trough.value) trough = p;
  }
  let maxStep: TurnDynamics["maxStep"] = null;
  for (let i = 1; i < pts.length; i++) {
    const d = r6(pts[i]!.value - pts[i - 1]!.value);
    if (maxStep === null || Math.abs(d) > Math.abs(maxStep.delta)) {
      maxStep = { fromTick: pts[i - 1]!.tick, toTick: pts[i]!.tick, delta: d };
    }
  }
  return {
    trajectory: pts.map((p) => ({ tick: p.tick, value: r6(p.value) })),
    deltaFromPrev,
    direction,
    peak: { tick: peak.tick, value: r6(peak.value) },
    trough: { tick: trough.tick, value: r6(trough.value) },
    accumulated: r6(pts.reduce((s, p) => s + p.value, 0)),
    maxStep,
    ticksUsed: pts.length,
  };
}

/**
 * 第几拍**首次**越过阈值（`>=` 上穿 / `<=` 下穿由 `dir` 定）。
 *
 * ⚠ `threshold` 必须由调用方从**规则**里读回来（`rule.params` / `rule.clamp` / 表达式里的字面量）。
 * 传 `null` ⇒ 返回 `null` 并由调用方写诚实缺席，**绝不**替它编一个阈值 ——
 * 「引擎里没有业务阈值」这条铁律在本模块同样成立。
 */
export function crossingTick(points: TurnPoint[], threshold: number | null, dir: "UP" | "DOWN" = "UP"): number | null {
  if (threshold === null || !Number.isFinite(threshold)) return null;
  const pts = [...points].sort((a, b) => a.tick - b.tick);
  for (const p of pts) {
    if (dir === "UP" ? p.value >= threshold : p.value <= threshold) return p.tick;
  }
  return null;
}
