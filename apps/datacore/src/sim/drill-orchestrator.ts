/**
 * WO-SIM-DRILL-P12 · G-DRILL-4 **演习编排器**（PRD-sim-drill-parallel-world §4.3 / §4.6）。
 *
 * ══ 今天的行为是 X，应该是 Y（开工前起真 datacore 4071 实测）═══════════════════
 * **X（今天）**：62 个求解器里 22 个直接对口产销推演，**沙盘一个都没调**。
 *   实测 `grep -c "invokeSolver\|solvers\." apps/datacore/src/sim/propagation.ts` = **0**
 *   （金丝雀：同文件 `PropagationRule` = 10 命中 ⇒ 工具没坏）。
 *   于是「把 SO-3391 交期提前 10 天会挤占谁」这个问题，**后端算得出、前端问不到**：
 *   `sop_reschedule` 实测 200 且当场给出 `displaced:[SO-3415, SO-3534]` + `cost.total=15653.05`，
 *   但沙盘上没有任何一条路能把这个事件送进去。
 * **Y（应该）**：事件 → 数据驱动路由表 → 真调求解器 → 异构输出归一成一张卡点清单。
 *
 * ══ 三条不许违反的红线（每条都有对应的变异反证靶）═══════════════════════════
 * ① **路由表数据驱动**：本文件**没有** `if (kind === "ORDER_RESCHEDULE")` 这种分支。
 *    事件→求解器的映射全部来自契约 `DRILL_EVENT_SPECS`，编排器只做解释。
 *    靶①：路由表改空 ⇒「求解器被调用」当场红。
 * ② **诚实位不许丢**：`dataMode` 缺失一律 `UNDECLARED`，**绝不默认 LIVE**。
 *    靶②：归一处强制 LIVE ⇒ 诚实位断言当场红。
 * ③ **失败不许静默吞**：求解器抛错 ⇒ 记 `kind:"未能评估"` 留在清单里。
 *    靶③：改成 catch 后 `continue` ⇒「未能评估仍在清单里」当场红。
 *
 * ══ 为什么不拆微服务（PRD §4.6 的结论，实测后仍成立）═══════════════════════
 * 三个「推演系统」（项目/全局/产能）本来就是**同一个注册表里的 key**
 * （`solvers/service.ts` 的 `switch (solverKey)` 分发）。一次演习串 3–5 个求解器，
 * 同进程零 RTT 且 R6 确定性天然满足；拆出去要处理超时/重试/部分失败，确定性变脆。
 * 复用不需要改造它们 —— 本文件**一行都没碰** `apps/datacore/src/solvers/**`。
 */
import {
  DRILL_FINDINGS_PER_KIND_DEFAULT,
  DRILL_FINDINGS_PER_KIND_MAX,
  aggregateDrillDataMode,
  compareDrillFindings,
  drillEventSpec,
  drillRoutesFor,
  normalizeDrillDataMode,
  resolveDrillArgs,
  ticksForDays,
  validateDrillEvent,
  type DrillDataMode,
  type DrillEvent,
  type DrillFinding,
  type DrillReport,
  type DrillRoute,
} from "@platform/contracts";

// ══════════════════════════════════════════════════════════════════════════
// § 0 · 依赖注入（编排器不认识 repo，也不认识 fastify）
// ══════════════════════════════════════════════════════════════════════════

/** 真调一个求解器。生产传 `ontology.invokeSolver` 的偏应用，测试传桩（靶①靶③就换它）。 */
export type DrillSolverInvoker = (solverKey: string, args: Record<string, unknown>) => Promise<unknown>;

export interface DrillOrchestrateInput {
  events: readonly DrillEvent[];
  horizonDays: number;
  tickDays: number;
  worldId: string;
  forkedFromStateId: string | null;
  invokeSolver: DrillSolverInvoker;
  /** 传导引擎扫出来的那批（G-DRILL-2 的产物），与求解器那批合并成一张清单。 */
  scanFindings?: readonly DrillFinding[];
  /** 每类结论上限（规模闸）。不传落契约默认 —— **绝不回全量**。 */
  limitPerKind?: number;
  /**
   * 世界态冲击回执（WO-MATERIAL-REPRICE）——**由调用方从传导引擎的 `appliedPerturbations` 现取**，
   * 编排器只原样透传。放在调用方是因为只有它拿得到引擎回执；
   * 编排器自己"根据事件推断打上了没有"就是第二套真相源，而那正是本单栽过的那一跤。
   */
  appliedStateEffects?: DrillReport["appliedStateEffects"];
  /**
   * 「这一批事件实测改动了世界态多少格 / 一共多少格」（WO-EVENTS-WRITE-STATE）——
   * 同 `appliedStateEffects` 的纪律：**只有调用方跑得出对照推进**，编排器只原样透传，
   * 绝不自己"根据事件推断动了多少格"（那就是第二套真相源）。
   */
  worldCellsMoved?: number;
  worldCellsTotal?: number;
  /**
   * 「这批事件改变了多少条结论 / 对照世界一共多少条」（WO-EVENTS-WRITE-STATE）。
   * 同上：只有调用方跑得出对照推进并扫得出对照清单，编排器只原样透传。
   */
  findingsChanged?: number;
  findingsBaseline?: number;
}

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 小工具
// ══════════════════════════════════════════════════════════════════════════

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const clamp100 = (n: number): number => Math.min(100, Math.max(0, n));
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown, dflt = ""): string {
  return typeof v === "string" ? v : dflt;
}
function rec(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}
function arr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.map((x) => rec(x)) : [];
}

/**
 * 求解器回包的**数据模式** —— 唯一读取口。
 *
 * ⛔ 这一行是靶②的落点：缺字段 ⇒ `UNDECLARED`，**不是** `LIVE`。
 * 实测四个求解器里只有 `capacity_forecast` 回 `LIVE`、`bottleneck_matrix` 回 `MOCK`、
 * `risk_timeline` 回 `PARTIAL`，而 `sop_reschedule` **根本没有这个字段** ——
 * 若在这里默认成 LIVE，屏上就会把一条没人担保的结论画成实测值。
 */
function readDataMode(out: Record<string, unknown>): DrillDataMode {
  return normalizeDrillDataMode(out.dataMode);
}

/** 归一上下文（每个 normalizer 都拿得到，用于拼 key 与溯源）。 */
interface NormalizeCtx {
  solverKey: string;
  eventKind: string | null;
  targetObjectId: string;
  horizonDays: number;
}

type DrillNormalizer = (out: Record<string, unknown>, ctx: NormalizeCtx) => DrillFinding[];

/** 统一的溯源块（R13：这条结论谁算的、按什么口径）。 */
function prov(ctx: NormalizeCtx, extra: Record<string, unknown>): Record<string, unknown> {
  return { solverKey: ctx.solverKey, eventKind: ctx.eventKind, target: ctx.targetObjectId, ...extra };
}

// ══════════════════════════════════════════════════════════════════════════
// § 2 · 归一规则表（**注册表查表，不是 if 链** —— 加一个求解器 = 加一个表项）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 每个 normalizer 只回答一句：「这个求解器说的话，翻成卡点语义是什么」。
 *
 * ⚠ 每一条的字段名都**对着真求解器实测过**（不是照 PRD 抄）。PRD §4.4 的输出字段表
 * 有两处与实测不符，已在各 normalizer 头注点名，照实测写。
 */
const NORMALIZERS: Record<string, DrillNormalizer> = {
  /**
   * `sop_reschedule` —— 本单验收线的主角。
   *
   * 实测回包顶层键（4071 · `{"targetOrderId":"SO-3391","advanceDays":10}`）：
   *   `feasible,verdict,targetOrder,allocation,displaced,cost,residualQty,reconChecks,reconciled,objective,summary`
   * ⚠ **没有 `dataMode`** —— PRD §4.4「四个全带」在这一条上不成立，故它的诚实位恒 `UNDECLARED`。
   *
   * 两类结论：
   *  · `feasible === false` ⇒ 一条 severity=100 的卡点（这次演习的目标压根做不到）；
   *  · `displaced[]` 每一单 ⇒ 一条卡点，**带具体订单号与代价数字**（= 仓主的验收线原文）。
   *
   * severity 口径：`delayDays / 本次最大 delayDays × 100`。
   * 为什么用「本次最大」当分母而不是拿天数直接当分数：`delayDays` 是**天**，
   * 与 `tightness` 的 0–100 不同量纲，直接混排就是拿不同量纲的数比大小。
   * 用本次结果内的相对份额 ⇒ 无量纲、零常数、被挤得最惨的那单是 100。
   */
  sop_reschedule: (out, ctx) => {
    const findings: DrillFinding[] = [];
    const reconciled = typeof out.reconciled === "boolean" ? out.reconciled : null;
    const dataMode = readDataMode(out);
    const cost = rec(out.cost);
    const costTotal = num(cost.total);
    const target = rec(out.targetOrder);
    const verdict = str(out.verdict) || str(out.summary);

    if (out.feasible === false) {
      findings.push({
        key: `sop_reschedule::infeasible::${ctx.targetObjectId}`,
        kind: "卡点",
        severity: 100, // PRD §4.4：不可行 ⇒ 100
        where: { objectType: "Order", objectId: ctx.targetObjectId, label: ctx.targetObjectId },
        when: num(target.newDueDay),
        why: verdict || `${ctx.targetObjectId} 无法按要求改期（求解器判不可行）`,
        source: { solverKey: ctx.solverKey, dataMode, provenance: prov(ctx, { feasible: false, residualQty: num(out.residualQty) }) },
        reconciled,
        evidence: { targetOrder: target, cost, residualQty: out.residualQty },
      });
    }

    const displaced = arr(out.displaced);
    const maxDelay = displaced.reduce((m, d) => Math.max(m, num(d.delayDays) ?? 0), 0);
    for (const d of displaced) {
      const orderId = str(d.orderId);
      if (orderId === "") continue; // 没有订单号的行拿不出「被挤占的是谁」，不编一个
      const delayDays = num(d.delayDays) ?? 0;
      findings.push({
        key: `sop_reschedule::displaced::${orderId}`,
        kind: "卡点",
        severity: round6(clamp100(maxDelay > 0 ? (delayDays / maxDelay) * 100 : 0)),
        where: { objectType: "Order", objectId: orderId, label: `${orderId}·${str(d.customer)}` },
        when: num(d.origDueDay),
        why:
          `为让 ${ctx.targetObjectId} 提前交付，${orderId}（${str(d.customer)}·${num(d.qty) ?? "?"}套）` +
          `被挤占、延后 ${delayDays} 天` +
          (costTotal === null ? "" : `；本次改期总代价 ${costTotal}${str(cost.unit)}`),
        source: {
          solverKey: ctx.solverKey,
          dataMode,
          provenance: prov(ctx, {
            delayDays,
            priority: str(d.priority),
            costTotal,
            costBreakdown: cost,
            // 求解器自带的下钻三元组（R13 可回仓储对拍）
            drill: d.provenance ?? null,
          }),
        },
        reconciled,
        evidence: d,
      });
    }
    return findings;
  },

  /**
   * `bottleneck_matrix` —— 瓶颈矩阵。
   *
   * ⚠ **PRD §4.4 说 `tightness` 是顶层 0–100 标量，实测不是**。
   * 实测顶层键只有 `dataMode,factors,rows,ruleSetVersion`；`tightness` 在
   * `rows[].tightness`，且是一张 **factor → number 的表**（实测 7 个因素），
   * 另有一个 `rows[].hardCapacity.tightness` 是标量。两者形状不同，
   * 「归一成一个数」会把 7 个因素压成 1 个 —— 那正是「一个数字盖住多个事实」那个病。
   * 故此处**逐 (基地, 因素) 各出一条**，不做压缩。
   *
   * 阈值同样走 **A 方案**：在本次结果的 tightness 分布里取 P90/P95，零配置 ——
   * 与传导引擎那半用的是同一条规矩，不另立一套。
   */
  bottleneck_matrix: (out, ctx) => {
    const dataMode = readDataMode(out);
    const rows = arr(out.rows);
    const cells: { base: string; factor: string; v: number; primary: string }[] = [];
    for (const r of rows) {
      const base = str(r.base);
      const primary = str(r.primary);
      const t = rec(r.tightness);
      for (const factor of Object.keys(t).sort()) {
        const v = num(t[factor]);
        if (v === null) continue;
        cells.push({ base, factor, v, primary });
      }
    }
    if (cells.length === 0) return [];
    const sorted = [...cells.map((c) => c.v)].sort((a, b) => a - b);
    const q = (p: number): number => {
      const pos = p * (sorted.length - 1);
      const lo = Math.floor(pos);
      const hi = Math.ceil(pos);
      return lo === hi ? sorted[lo]! : sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
    };
    const p90 = q(0.9);
    const p95 = q(0.95);
    const findings: DrillFinding[] = [];
    for (const c of [...cells].sort((a, b) => (a.base + a.factor < b.base + b.factor ? -1 : 1))) {
      const isChoke = c.v > p95;
      const isFragile = !isChoke && c.v > p90;
      if (!isChoke && !isFragile) continue;
      findings.push({
        key: `bottleneck_matrix::${isChoke ? "choke" : "fragile"}::${c.base}::${c.factor}`,
        kind: isChoke ? "卡点" : "脆弱点",
        // tightness 本来就是 0–100 口径，直接用（不必转百分位秩）
        severity: round6(clamp100(c.v)),
        where: { objectType: "Base", objectId: c.base, label: `${c.base}·${c.factor}` },
        when: null, // 瓶颈矩阵是**当下截面**，不含时间维；越线日由 risk_timeline 给
        why: `${c.base} 的「${c.factor}」紧张度 ${c.v}${isChoke ? `，越过本次结果的 P95(${round6(p95)})` : `，落在 P90(${round6(p90)})~P95(${round6(p95)}) 警戒带`}${c.primary ? `；该基地主瓶颈=${c.primary}` : ""}`,
        source: {
          solverKey: ctx.solverKey,
          dataMode,
          provenance: prov(ctx, { base: c.base, factor: c.factor, tightness: c.v, p90: round6(p90), p95: round6(p95), basis: "A 方案·阈值取本次结果的分位数" }),
        },
        reconciled: null,
        evidence: { base: c.base, factor: c.factor, tightness: c.v },
      });
    }
    return findings;
  },

  /**
   * `risk_timeline` —— 逐日推演，**唯一能回答「第几天越线」的那个**。
   *
   * 实测（`{"horizon":30}`）：顶层 `dataMode:"PARTIAL"`（PRD 未列的第三个值）、`threshold:85`、
   * `cards` 8 张，每张形如
   *   `{base,baseId,factor,dataMode:"MOCK",currentTightness:{value,live},peak,crossDay,series[30],factorSeries{}}`
   *
   * ⚠ **诚实位取每张卡自己的 `cards[].dataMode`，不取顶层那个** ——
   * 顶层是 `PARTIAL`（= 混合），拿它盖到每一条结论上，就把「这条是 MOCK」和
   * 「这条是 LIVE」抹成同一个词。粒度细的那个才是真话。
   *
   * 越线判据 `threshold` **读自求解器回包**（85），不写死在这里 —— 写死即业务常数（破 R14）。
   */
  risk_timeline: (out, ctx) => {
    const topMode = readDataMode(out);
    const threshold = num(out.threshold);
    const cards = arr(out.cards);
    const findings: DrillFinding[] = [];
    for (const c of [...cards].sort((a, b) => (str(a.baseId) + str(a.factor) < str(b.baseId) + str(b.factor) ? -1 : 1))) {
      const base = str(c.base) || str(c.baseId);
      const factor = str(c.factor);
      const peak = num(c.peak);
      const crossDay = num(c.crossDay);
      const cur = rec(c.currentTightness);
      const curV = num(cur.value);
      // 每卡自己的诚实位优先；卡上没有才回落到顶层（回落也仍然不会变成 LIVE）
      const dataMode = c.dataMode === undefined ? topMode : normalizeDrillDataMode(c.dataMode);
      const crossed = threshold !== null && peak !== null && peak > threshold;
      if (!crossed && (curV === null || threshold === null || curV <= threshold * 0.9)) continue;
      findings.push({
        key: `risk_timeline::${crossed ? "choke" : "fragile"}::${str(c.baseId)}::${factor}`,
        kind: crossed ? "卡点" : "脆弱点",
        severity: round6(clamp100(peak ?? curV ?? 0)),
        where: { objectType: "Base", objectId: str(c.baseId) || base, label: `${base}·${factor}` },
        // ⭐ 这就是 PRD 要的「第几天越线」——**真的来自求解器**，不是本文件算的
        when: crossed ? crossDay : null,
        why: crossed
          ? `${base} 的「${factor}」在第 ${crossDay ?? "?"} 天越过阈值 ${threshold}（峰值 ${peak}）`
          : `${base} 的「${factor}」现值 ${curV}，逼近阈值 ${threshold} 但窗口内未越线`,
        source: {
          solverKey: ctx.solverKey,
          dataMode,
          provenance: prov(ctx, {
            baseId: str(c.baseId),
            factor,
            threshold,
            peak,
            crossDay,
            currentTightness: curV,
            // `currentTightness.live` 是求解器自己的第二个诚实位，原样带上不丢
            currentTightnessLive: cur.live ?? null,
            horizon: num(out.horizon) ?? ctx.horizonDays,
            topLevelDataMode: topMode,
          }),
        },
        reconciled: null,
        evidence: c,
      });
    }
    return findings;
  },

  /**
   * `capacity_forecast` —— 产能缺口。
   * 实测**必须带 `modelId`**，否则 `400 VALIDATION_ERROR: modelId required`
   * （故路由表里它的 `modelId` 标 `required:true`，取不到就记「未能评估」不硬调）。
   * 实测带 `modelId` 后 `dataMode:"LIVE"`。
   */
  capacity_forecast: (out, ctx) => {
    const dataMode = readDataMode(out);
    const gap = num(out.gap);
    const cap = num(out.capWanP90) ?? num(out.capWanP50);
    if (gap === null || gap <= 0) return [];
    return [
      {
        key: `capacity_forecast::gap::${ctx.targetObjectId}`,
        kind: "卡点",
        // PRD §4.4：无 tightness 时按 `gap / capacity × 100`
        severity: round6(clamp100(cap !== null && cap > 0 ? (gap / cap) * 100 : 100)),
        where: { objectType: "Model", objectId: ctx.targetObjectId, label: `${ctx.targetObjectId}·产能缺口` },
        when: null,
        why: `窗口内产能缺口 ${gap}${str(out.unit)}${cap === null ? "" : `（承诺产能 ${cap}）`}`,
        source: { solverKey: ctx.solverKey, dataMode, provenance: prov(ctx, { gap, capWanP90: cap, ok: out.ok ?? null, unit: str(out.unit) }) },
        reconciled: null,
        evidence: { gap, capWanP90: out.capWanP90, ok: out.ok, nonProducible: out.nonProducible },
      },
    ];
  },

  /**
   * `portfolio` —— 全局最优重排。实测顶层含 `feasible`/`displaced`/`reconciled`/`cost`，**无 `dataMode`**。
   * 与 `sop_reschedule` 同族但**不共用实现**：两者的 `displaced` 行字段不同
   * （portfolio 的行没有 `delayDays`），共用会静默取到 `undefined`。
   */
  portfolio: (out, ctx) => {
    const dataMode = readDataMode(out);
    const reconciled = typeof out.reconciled === "boolean" ? out.reconciled : null;
    const findings: DrillFinding[] = [];
    if (out.feasible === false) {
      findings.push({
        key: `portfolio::infeasible::${ctx.targetObjectId}`,
        kind: "卡点",
        severity: 100,
        where: { objectType: "Order", objectId: ctx.targetObjectId, label: ctx.targetObjectId },
        when: null,
        why: str(out.summary) || "全局重排判不可行",
        source: { solverKey: ctx.solverKey, dataMode, provenance: prov(ctx, { status: str(out.status), cost: out.cost ?? null }) },
        reconciled,
        evidence: { status: out.status, cost: out.cost },
      });
    }
    const displaced = arr(out.displaced);
    for (const d of [...displaced].sort((a, b) => (str(a.orderId) < str(b.orderId) ? -1 : 1))) {
      const orderId = str(d.orderId);
      if (orderId === "") continue;
      findings.push({
        key: `portfolio::displaced::${orderId}`,
        kind: "卡点",
        severity: 100, // 被挤出全局最优 = 已发生的事实，不是概率
        where: { objectType: "Order", objectId: orderId, label: orderId },
        when: null,
        why: `${orderId} 在全局最优重排中被挤占`,
        source: { solverKey: ctx.solverKey, dataMode, provenance: prov(ctx, { row: d }) },
        reconciled,
        evidence: d,
      });
    }
    return findings;
  },

  /** `supply_demand_gap_attribution` —— 供需缺口归因。实测含 `totalGap`/`reconciled`，无 `dataMode`。 */
  supply_demand_gap_attribution: (out, ctx) => {
    const dataMode = readDataMode(out);
    const totalGap = num(out.totalGap);
    if (totalGap === null || totalGap === 0) return [];
    const reconciled = typeof out.reconciled === "boolean" ? out.reconciled : null;
    return [
      {
        key: `supply_demand_gap_attribution::gap::${str(out.rootMetric) || ctx.targetObjectId}`,
        kind: "卡点",
        severity: 100,
        where: { objectType: "Metric", objectId: str(out.rootMetric), label: `供需缺口·${str(out.rootMetric)}` },
        when: null,
        why: str(out.summary) || `供需总缺口 ${totalGap}${str(out.unit)}`,
        source: {
          solverKey: ctx.solverKey,
          dataMode,
          provenance: prov(ctx, { totalGap, unit: str(out.unit), residualPct: num(out.residualPct) }),
        },
        reconciled,
        evidence: { totalGap, demandSide: out.demandSide, supplySide: out.supplySide },
      },
    ];
  },

  /** `order_fullchain` —— 单链全判。实测含 `verdict`/`judges`，无 `dataMode`。 */
  order_fullchain: (out, ctx) => {
    const dataMode = readDataMode(out);
    const judges = arr(out.judges);
    const failed = judges.filter((j) => j.pass === false || str(j.verdict).includes("不"));
    if (failed.length === 0) return [];
    return failed.map((j, i) => ({
      key: `order_fullchain::judge::${ctx.targetObjectId}::${str(j.key) || str(j.name) || String(i)}`,
      kind: "卡点" as const,
      severity: 100,
      where: { objectType: "Order", objectId: ctx.targetObjectId, label: `${ctx.targetObjectId}·${str(j.name) || str(j.key)}` },
      when: null,
      why: `${ctx.targetObjectId} 卡在「${str(j.name) || str(j.key)}」这一判：${str(j.verdict) || str(j.reason)}`,
      source: { solverKey: ctx.solverKey, dataMode, provenance: prov(ctx, { judge: j, chainVerdict: str(out.verdict) }) },
      reconciled: null,
      evidence: j,
    }));
  },

  /**
   * `quote_margin` —— **WO-MATERIAL-REPRICE 的主答者**：接单毛利的真 BOM 口径。
   *
   * 实测回包顶层键（4091 · `{"args":{}}`）：
   *   `margin,floor,diff,verdict,breakdown{bomCost,mfg,logistics,price},scope,ruleRefs,evaluatedRules,ruleSetVersion`
   * ⚠ **没有 `dataMode`** ⇒ 诚实位恒 `UNDECLARED`（同 `sop_reschedule`）。
   *
   * ── 三条不许省的诚实位（省掉任何一条，屏上那个数就会被读成它不是的东西）────────────
   * ① **它读本体真值、不读世界态** —— 故它给的是**基线毛利**，不是「涨价之后的毛利」。
   *    料价冲击走的是另一条路（`stateEffect` → `Material.priceShock` → 传导 → `Order.costPressure`），
   *    两条路今天在**不同的量纲上**（毛利率 vs 压力指数），**不许在这里把它们相减**。
   * ② **`scope.dataMode`** 是求解器自己的取数诚实位（`OK` = 真 BOM · `EMPTY` = 回落通用物料），
   *    `EMPTY` 时这条结论不该被当成该型号的成本。
   * ③ **`scope.unitBasis.coherent === false`** 是已登记的量纲欠账 `G-QUOTE-BOM-PRICE-UNIT-SCALE`
   *    （价按套 / BOM 按台，缺换算常数 ⇒ margin 绝对值偏高）。把它原样带进 `why`，
   *    而不是替它造一个常数把数压到「看着合理」—— 那是把金值改成想要的值。
   *
   * 结论分档：低于底线 ⇒ 卡点（severity 100）；触线 ⇒ 脆弱点；过线 ⇒ 脆弱点但严重度按余量算。
   */
  quote_margin: (out, ctx) => {
    const dataMode = readDataMode(out);
    const margin = num(out.margin);
    const floor = num(out.floor);
    if (margin === null || floor === null) return [];
    const bd = rec(out.breakdown);
    const scope = rec(out.scope);
    const unitBasis = rec(scope.unitBasis);
    const modelId = str(scope.modelId) || "（未定位型号）";
    const verdict = str(out.verdict);
    const belowFloor = margin < floor;
    // 余量 = margin − floor。**用余量占底线的比例定严重度**（无量纲），不拿毛利率直接当 0–100：
    // 毛利率 0.87 与 tightness 87 长得一样，混排就是拿两个不同口径的数比大小。
    const headroomPct = floor === 0 ? 0 : ((margin - floor) / floor) * 100;
    const severity = belowFloor ? 100 : clamp100(100 - headroomPct);
    const honesty =
      (str(scope.dataMode) === "OK" ? "" : `⚠ 取数 ${str(scope.dataMode) || "未声明"}：${str(scope.reason) || "未拿到该型号真 BOM"}；`) +
      (unitBasis.coherent === false ? `⚠ 量纲欠账 ${str(unitBasis.gap)}：${str(unitBasis.note)}；` : "");
    return [
      {
        key: `quote_margin::margin::${modelId}`,
        kind: belowFloor ? "卡点" : "脆弱点",
        severity: round6(severity),
        where: { objectType: "Model", objectId: modelId, label: `${modelId}·接单毛利` },
        when: null,
        why:
          `${modelId} 接单毛利率 ${margin}（底线 ${floor}，${verdict || (belowFloor ? "低于底线" : "过线")}）；` +
          `BOM 成本 ${num(bd.bomCost) ?? "?"} / 售价 ${num(bd.price) ?? "?"}（真 BOM ${num(scope.bomRows) ?? 0} 行·${str(scope.bomId) || "无 BOM 号"}）。` +
          `${honesty}` +
          `⚠ 本数取**本体真值**，是料价变动前的**基线**——冲击后的成本压力见 Order.costPressure 那批结论，两者量纲不同不可相减。`,
        source: {
          solverKey: ctx.solverKey,
          dataMode,
          provenance: prov(ctx, {
            margin,
            floor,
            diff: num(out.diff),
            bomCost: num(bd.bomCost),
            price: num(bd.price),
            bomId: str(scope.bomId),
            bomRows: num(scope.bomRows),
            scopeMode: str(scope.mode),
            scopeDataMode: str(scope.dataMode),
            unitCoherent: unitBasis.coherent === true,
            unitGap: str(unitBasis.gap),
            basis: "本体真值（Material.unitPrice × BOMDetail.quantity），**不读世界态**",
          }),
        },
        reconciled: null,
        evidence: { margin, floor, breakdown: bd, scope },
      },
    ];
  },

  /** `affected_orders` —— 受影响订单清单。实测含 `rows`/`problems`，无 `dataMode`。 */
  affected_orders: (out, ctx) => {
    const dataMode = readDataMode(out);
    const rows = arr(out.rows);
    if (rows.length === 0) return [];
    return [
      {
        key: `affected_orders::count::${ctx.targetObjectId}`,
        kind: "脆弱点",
        // 受影响不等于已越线；条数无上界，用「有多少单被牵动」的相对量不合适，
        // 故给一个**保守**的固定档并把真实条数放进 why/provenance（不拿条数硬当 0–100）。
        severity: 50,
        where: { objectType: "Order", objectId: ctx.targetObjectId, label: `受本次事件牵动的订单` },
        when: null,
        why: `本次事件牵动 ${rows.length} 张订单${str(out.summary) ? `：${str(out.summary)}` : ""}`,
        source: { solverKey: ctx.solverKey, dataMode, provenance: prov(ctx, { affectedCount: rows.length, problems: out.problems ?? null }) },
        reconciled: null,
        evidence: { count: rows.length, sample: rows.slice(0, 5) },
      },
    ];
  },
};

// ══════════════════════════════════════════════════════════════════════════
// § 3 · 编排主流程
// ══════════════════════════════════════════════════════════════════════════

/** 一条「未能评估」——**它不是错误处理的副产品，它是一等结论**（PRD §4.6）。 */
function unevaluated(
  solverKey: string,
  eventKind: string | null,
  targetObjectId: string,
  why: string,
): DrillFinding {
  return {
    key: `${solverKey}::unevaluated::${eventKind ?? "-"}::${targetObjectId}`,
    kind: "未能评估",
    severity: 0, // 不是「不严重」，是「没有严重度这个量」——排序上沉底，但**不消失**
    where: { objectType: "", objectId: targetObjectId, label: `${solverKey} 未能评估` },
    when: null,
    why,
    source: { solverKey, dataMode: "UNDECLARED", provenance: { unevaluated: true, reason: why } },
    reconciled: null,
    evidence: null,
  };
}

/**
 * 跑一次演习。
 *
 * 时序（PRD §4.6）：事件分派 → 并行调用 → 归一 → 排序 → 产出。
 * 传导引擎那一半（`scanFindings`）由调用方先跑好注入 —— 两半在这里合流。
 */
export async function orchestrateDrill(input: DrillOrchestrateInput): Promise<DrillReport> {
  const { events, horizonDays, tickDays, worldId, forkedFromStateId, invokeSolver } = input;
  const findings: DrillFinding[] = [...(input.scanFindings ?? [])];
  const solverRuns: DrillReport["solverRuns"] = [];

  for (const ev of events) {
    // ── 事件自校验（规则来自契约规格表，不是这里的 if）──────────────────────
    const errs = validateDrillEvent(ev);
    if (errs.length > 0) {
      findings.push(unevaluated("(event)", ev.kind, ev.targetObjectId, `事件校验未通过：${errs.join("；")}`));
      solverRuns.push({ solverKey: "(event)", eventKind: ev.kind, ok: false, dataMode: "UNDECLARED", error: errs.join("；"), findingCount: 1 });
      continue;
    }

    // ── 路由分派：**唯一来源是契约里的路由表**（靶① 就是把它改空）───────────
    const routes: DrillRoute[] = drillRoutesFor(ev.kind);
    if (routes.length === 0) {
      findings.push(unevaluated("(routing)", ev.kind, ev.targetObjectId, `事件 ${ev.kind} 没有登记任何求解器路由 ⇒ 本次未能评估（不是「没有风险」）`));
      solverRuns.push({ solverKey: "(routing)", eventKind: ev.kind, ok: false, dataMode: "UNDECLARED", error: "no route", findingCount: 1 });
      continue;
    }

    // 并行调用（同进程，无 RTT）。`allSettled` ⇒ 一个塌了不影响别的，且**每一条都有回执**。
    const calls = routes.map(async (route) => {
      const resolved = resolveDrillArgs(route, ev, horizonDays);
      if (resolved === null || resolved.missing.length > 0) {
        const why = `${route.solverKey} 缺必填入参 ${(resolved?.missing ?? []).join("、")}（本次事件没给）⇒ 未能评估`;
        return { route, ok: false as const, error: why, out: null };
      }
      try {
        const raw = await invokeSolver(route.solverKey, resolved.args);
        return { route, ok: true as const, error: null, out: raw };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { route, ok: false as const, error: msg, out: null };
      }
    });
    const settled = await Promise.all(calls);

    for (const s of settled) {
      const ctxN: NormalizeCtx = {
        solverKey: s.route.solverKey,
        eventKind: ev.kind,
        targetObjectId: ev.targetObjectId,
        horizonDays,
      };
      if (!s.ok) {
        // ⛔ 靶③ 的落点：**记一条留在清单里**，不是 `continue`。
        const f = unevaluated(s.route.solverKey, ev.kind, ev.targetObjectId, s.error);
        findings.push(f);
        solverRuns.push({ solverKey: s.route.solverKey, eventKind: ev.kind, ok: false, dataMode: "UNDECLARED", error: s.error, findingCount: 1 });
        continue;
      }
      // 求解器可能把结果包在 `{data}` 里（`invokeSolver` 的信封），也可能直接给
      const envelope = rec(s.out);
      const body = envelope.data !== undefined ? rec(envelope.data) : envelope;
      const normalize = NORMALIZERS[s.route.solverKey];
      if (!normalize) {
        // 调通了但没登记归一规则 —— 同样**不许静默丢**（丢了屏上就是「没有风险」）
        const f = unevaluated(s.route.solverKey, ev.kind, ev.targetObjectId, `${s.route.solverKey} 调用成功，但尚未登记归一规则 ⇒ 本次结果未纳入清单`);
        findings.push(f);
        solverRuns.push({ solverKey: s.route.solverKey, eventKind: ev.kind, ok: true, dataMode: readDataMode(body), error: null, findingCount: 1 });
        continue;
      }
      const produced = normalize(body, ctxN);
      findings.push(...produced);
      solverRuns.push({
        solverKey: s.route.solverKey,
        eventKind: ev.kind,
        ok: true,
        dataMode: readDataMode(body),
        error: null,
        findingCount: produced.length,
      });
    }
  }

  // ── 降级区：守恒未通过的结论**不删掉**，但不混进主清单（PRD §4.6）──────────
  const degraded = findings.filter((f) => f.reconciled === false).sort(compareDrillFindings);
  const allMain = findings.filter((f) => f.reconciled !== false).sort(compareDrillFindings);

  // ── 规模闸：**逐类**取前 N（实测 1,567 对象的世界会产出 5,593 条 / 4.6MB）────────
  // 逐类而不是全局取 Top-N：全局会把整类堵点（severity ~47）挤出榜外，
  // 屏上显示成「没有堵点」—— 把截断伪装成结论。理由全文见契约 `DRILL_FINDINGS_PER_KIND_DEFAULT`。
  const limitPerKind = Math.max(
    1,
    Math.min(input.limitPerKind ?? DRILL_FINDINGS_PER_KIND_DEFAULT, DRILL_FINDINGS_PER_KIND_MAX),
  );
  const totalByKind: Record<string, number> = {};
  for (const f of allMain) totalByKind[f.kind] = (totalByKind[f.kind] ?? 0) + 1;
  const perKindCount = new Map<string, number>();
  const main: DrillFinding[] = [];
  for (const f of allMain) {
    const n = perKindCount.get(f.kind) ?? 0;
    if (n >= limitPerKind) continue;
    perKindCount.set(f.kind, n + 1);
    main.push(f);
  }
  const truncated = main.length < allMain.length;

  // ── 汇总诚实位 ────────────────────────────────────────────────────────────
  // ⚠ 汇总一律基于 **`allMain`（截断前）**，不是回包里那份被裁过的 `main`：
  //   拿截断后的数去算「一共几条」，就是用自己的显示上限冒充世界的真实规模。
  const realRuns = solverRuns.filter((r) => r.solverKey !== "(event)" && r.solverKey !== "(routing)");
  const allFailed = realRuns.length > 0 && realRuns.every((r) => !r.ok);
  const modes = allMain.filter((f) => f.kind !== "未能评估").map((f) => f.source.dataMode);
  const aggMode = aggregateDrillDataMode(modes);
  const unevaluatedCount = allMain.filter((f) => f.kind === "未能评估").length;
  const realFindings = allMain.filter((f) => f.kind !== "未能评估");

  // ⚠ 这段文案是「无卡点」与「没算出来」两个状态的分叉点（PRD §4.6 的红线）。
  let text: string;
  if (allFailed) {
    text = `本次演习未能评估：${realRuns.length} 个求解器全部失败（${realRuns.map((r) => `${r.solverKey}=${r.error ?? "?"}`).join("；")}）。这不是「没有风险」。`;
  } else if (realFindings.length === 0) {
    text =
      unevaluatedCount > 0
        ? `本次演习未扫出卡点，但有 ${unevaluatedCount} 条未能评估 —— 未评估部分不构成「没有风险」。`
        : "本次演习未扫出卡点、堵点或脆弱点。";
  } else {
    text =
      `本次演习扫出 ${realFindings.length} 条结论（卡点 ${realFindings.filter((f) => f.kind === "卡点").length}·` +
      `堵点 ${realFindings.filter((f) => f.kind === "堵点").length}·脆弱点 ${realFindings.filter((f) => f.kind === "脆弱点").length}）` +
      (unevaluatedCount > 0 ? `，另有 ${unevaluatedCount} 条未能评估` : "") +
      (degraded.length > 0 ? `；${degraded.length} 条守恒未通过已降级` : "") +
      // 截断这件事必须**出现在人读的那句话里**，不能只藏在 `truncated` 字段里 ——
      // 屏上第一眼看到的是这句话。
      (truncated ? `；本次每类只回前 ${limitPerKind} 条（共 ${allMain.length} 条）` : "") +
      `。数据模式=${aggMode}。`;
  }

  return {
    worldId,
    forkedFromStateId,
    horizonDays,
    tickDays,
    ticks: ticksForDays(horizonDays, tickDays),
    events: [...events],
    findings: main,
    totalByKind,
    truncated,
    appliedLimitPerKind: limitPerKind,
    degraded,
    appliedStateEffects: [...(input.appliedStateEffects ?? [])],
    worldCellsMoved: input.worldCellsMoved ?? 0,
    worldCellsTotal: input.worldCellsTotal ?? 0,
    findingsChanged: input.findingsChanged ?? 0,
    findingsBaseline: input.findingsBaseline ?? 0,
    solverRuns,
    summary: {
      allFailed,
      trustworthy: modes.length > 0 && modes.every((m) => m === "LIVE"),
      dataMode: aggMode,
      text,
    },
  };
}

/** 事件目录（前端建表单用）。放这里而不是前端硬编码 —— 标签与校验规则后端单源。 */
export function drillEventLabel(kind: string): string {
  const spec = drillEventSpec(kind as never);
  return spec?.label ?? kind;
}
