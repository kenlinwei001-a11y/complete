import { round, rngFromInput } from "../prng.js";
import { validationError } from "../errors.js";
import { baseName, dayFrom, maintWeekOf, num, str, type SolverContext } from "./types.js";
import { liveTightness, primaryFactor } from "./risk.js";
import { BUILTIN_CAPACITY_MC, mcConfigFor, monteCarlo, resolveMcParams, type McUnit } from "./method-mc.js";

// ---------------------------------------------------------------------------
// S1.1 capacity_rollup — equipment → process → line → base, with per-level
// {formula, inputs[]} intermediates (rules C01/C02 referenced).
// ---------------------------------------------------------------------------

export interface RollupNode {
  key: string;
  name: string;
  capacityPerDay: number;
  formula: string;
  inputs: { name: string; value: number | string }[];
}

export interface BaseRollup {
  baseId: string;
  base: string;
  dailyCells: number;
  weeklyWan: number; // 周产能(万套)
  lines: RollupNode[];
  processes: RollupNode[];
  equipment: RollupNode[];
  formula: string;
  inputs: { name: string; value: number | string }[];
}

export function equipmentOee(props: Record<string, unknown>): number {
  const snap = props.oee_current;
  if (typeof snap === "number" && Number.isFinite(snap) && snap > 0) return snap;
  return num(props.oeeA, 1) * num(props.oeeP, 1) * num(props.oeeQ, 1);
}

export function computeRollup(c: SolverContext): { bases: BaseRollup[]; ruleRefs: string[] } {
  const p = c.params;
  const out: BaseRollup[] = [];
  for (const b of c.bases) {
    const baseId = str(b.props.baseId);
    const lines = c.lines.filter((l) => l.props.baseId === baseId);
    const lineNodes: RollupNode[] = [];
    const processNodes: RollupNode[] = [];
    const equipNodes: RollupNode[] = [];
    for (const line of lines) {
      const lineId = str(line.props.lineId);
      const procs = c.processes.filter((pr) => pr.props.lineId === lineId);
      const serialCaps: number[] = [];
      let formationCap = Infinity;
      let agingCap = Infinity;
      for (const proc of procs) {
        const kind = str(proc.props.kind);
        let daily: number;
        let formula: string;
        const inputs: { name: string; value: number | string }[] = [];
        if (kind === "formation") {
          daily = num(proc.props.channels) * num(proc.props.channelOutputDaily) * num(proc.props.yield, 1);
          formula = "化成产能 = 通道数 × 单通道产出 × 良率";
          inputs.push(
            { name: "channels", value: num(proc.props.channels) },
            { name: "channelOutputDaily", value: num(proc.props.channelOutputDaily) },
            { name: "yield", value: num(proc.props.yield, 1) },
          );
          formationCap = Math.min(formationCap, daily);
        } else if (kind === "aging") {
          daily = num(proc.props.agingSlots) / Math.max(1, num(proc.props.agingDays, 1));
          formula = "老化产能 = 库位数 / 老化天数";
          inputs.push(
            { name: "agingSlots", value: num(proc.props.agingSlots) },
            { name: "agingDays", value: num(proc.props.agingDays, 1) },
          );
          agingCap = Math.min(agingCap, daily);
        } else {
          const equips = c.equipment.filter((e) => e.props.processId === proc.props.processId);
          let hourlySum = 0;
          for (const e of equips) {
            const oee = equipmentOee(e.props);
            const hourly = (3600 / Math.max(0.01, num(e.props.ctSeconds, 1))) * num(e.props.availFactor, 1) * oee;
            hourlySum += hourly;
            equipNodes.push({
              key: str(e.props.equipId),
              name: str(e.props.equipId),
              capacityPerDay: round(hourly * num(proc.props.shiftHours, 24) * num(proc.props.shifts, 1), 2),
              formula: "设备产能/h = (3600 / 节拍CT_s) × 可用时间系数 × OEE",
              inputs: [
                { name: "ctSeconds", value: num(e.props.ctSeconds, 1) },
                { name: "availFactor", value: num(e.props.availFactor, 1) },
                { name: "oee", value: round(oee, 4) },
              ],
            });
          }
          const labor = num(proc.props.shiftHours, 24) * num(proc.props.shifts, 1);
          daily =
            hourlySum * labor * num(proc.props.yield, 1) * num(proc.props.attendance, 1) * num(proc.props.utilization, 1);
          formula = "工序产能 = Σ设备产能/h × 班次时长×班次数 × 良率 × 出勤率 × 利用率";
          inputs.push(
            { name: "equipHourlySum", value: round(hourlySum, 2) },
            { name: "laborHours", value: labor },
            { name: "yield", value: num(proc.props.yield, 1) },
            { name: "attendance", value: num(proc.props.attendance, 1) },
            { name: "utilization", value: num(proc.props.utilization, 1) },
          );
          serialCaps.push(daily);
        }
        processNodes.push({
          key: str(proc.props.processId),
          name: str(proc.props.name),
          capacityPerDay: round(daily, 2),
          formula,
          inputs,
        });
      }
      const serialMin = serialCaps.length > 0 ? Math.min(...serialCaps) : 0;
      const lineDaily = Math.min(serialMin, formationCap, agingCap);
      lineNodes.push({
        key: lineId,
        name: str(line.props.name, lineId),
        capacityPerDay: round(lineDaily, 2),
        formula: "产线产能 = min(串行段) ⊕ 并行段汇合（化成/老化）—— C02 串/并口径",
        inputs: [
          { name: "serialMin", value: round(serialMin, 2) },
          { name: "formationCap", value: Number.isFinite(formationCap) ? round(formationCap, 2) : 0 },
          { name: "agingCap", value: Number.isFinite(agingCap) ? round(agingCap, 2) : 0 },
        ],
      });
    }
    const lineSum = lineNodes.reduce((a, l) => a + l.capacityPerDay, 0);
    const sharedFormation = num(b.props.formationCapDaily, Infinity) || Infinity;
    const sharedAging = num(b.props.agingCapDaily, Infinity) || Infinity;
    const dailyCells = round(Math.min(lineSum, sharedFormation, sharedAging), 2);
    const weeklyWan = round((dailyCells * 7) / Math.max(1, c.params.packCellCount) / 10000, 4);
    out.push({
      baseId,
      base: str(b.props.name, baseId),
      dailyCells,
      weeklyWan,
      lines: lineNodes,
      processes: processNodes,
      equipment: equipNodes,
      formula:
        "基地产能 = Σ产线（受共享资源封顶：化成柜/老化库总量，C01 ≤ 设计上限）；周产能(万套) = 基地日产能(电芯) × 7 ÷ 单PACK电芯数 ÷ 10000",
      inputs: [
        { name: "lineSum", value: round(lineSum, 2) },
        { name: "sharedFormationCap", value: Number.isFinite(sharedFormation) ? sharedFormation : 0 },
        { name: "sharedAgingCap", value: Number.isFinite(sharedAging) ? sharedAging : 0 },
        { name: "packCellCount", value: p.packCellCount },
      ],
    });
  }
  return { bases: out, ruleRefs: ["C01", "C02"] };
}

// ---------------------------------------------------------------------------
// S1.2 capacity_forecast
// ---------------------------------------------------------------------------

/** 周曲线系数 curveMult(b, w): ramp 0.88+0.03(w−1) (w≤4), 1.0 (w≥5); maint week ×0.72. */
export function curveMult(
  p: { ramp: { base: number; step: number; fullWeek: number }; maintMult: number },
  w: number,
  maintWeek: number | null,
): number {
  let m = w >= p.ramp.fullWeek ? 1 : p.ramp.base + p.ramp.step * (w - 1);
  if (maintWeek !== null && w === maintWeek) m *= p.maintMult;
  return m;
}

export interface ForecastArgs {
  modelId: string;
  qty?: number;
  weeks?: number;
  batches?: { qty: number; dueDate: string; address?: string }[];
  whatIf?: { nightShifts?: number; extraChannels?: number; outsourceRatio?: number };
  // legacy alias (AgentCore QOS seed plans)
  demandDelta?: number;
  // METHOD-MC-STOCHASTIC：蒙特卡洛种子（缺省 42·R6 同 seed 同分位）。
  seed?: number;
}

export function capacityForecast(c: SolverContext, args: ForecastArgs): Record<string, unknown> {
  const p = c.params;
  const modelId = str(args.modelId);
  if (!modelId) throw validationError("modelId required");
  const cert = c.certByModel.get(modelId);
  if (!cert || cert.size === 0) throw validationError(`model ${modelId} has no certified lines`);

  const rollup = computeRollup(c);
  const weeklyByBase = new Map(rollup.bases.map((b) => [b.baseId, b.weeklyWan]));

  // data health (C09): any critical source freshness lag > staleHours → degraded P90 factor.
  const staleSources = c.dataHealth.filter(
    (h) => h.props.critical === true && num(h.props.lagHours) > p.health.staleHours,
  );
  const healthFactor = staleSources.length > 0 ? p.health.degraded : p.health.normal;
  const degradeNote =
    staleSources.length > 0
      ? `C09 数据健康度降级：关键数据源 ${staleSources.map((s) => str(s.props.name, str(s.props.sourceId))).join("、")} 新鲜度延迟 ${staleSources.map((s) => num(s.props.lagHours)).join("/")}h（>${p.health.staleHours}h），蒙特卡洛离散度 cv 放大（分布变宽 → P90 保守下探·C09 诚实建模）`
      : undefined;

  const batches = Array.isArray(args.batches) && args.batches.length > 0 ? [...args.batches] : undefined;
  const qty = batches ? batches.reduce((a, b) => a + num(b.qty), 0) : num(args.qty, 0);
  const weeks = Math.max(
    1,
    Math.floor(
      num(
        args.weeks,
        batches
          ? Math.max(
              ...batches.map((b) => Math.max(1, Math.floor((dayFrom(p.forecastStart, b.dueDate) - logisticsDays(p, b.address)) / 7))),
            )
          : 6,
      ),
    ),
  );

  // P50 accumulation + per-base drilldown rows.
  const perBaseRows: Record<string, unknown>[] = [];
  const cumP50ByWeek: number[] = new Array(weeks).fill(0); // cumulative P50 at end of week w (1-based index w-1)
  let p50 = 0;
  const pendingCertList: string[] = [];
  let mainBn = "";
  let mainTightness = -1;
  // 轨M 增量1（假2 真推演红线）：紧张度改用 risk.ts 的 LIVE/MOCK 判别（liveTightness 读真 OEE/利用率/良率），
  // 不再裸 import mockTightness 绕开真数据；逐基地透 live 标 + 顶层 dataMode → 前端红/橙诚实标"估算"。
  let anyLive = false;
  for (const [baseId, status] of [...cert.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const certFactor = p.certFactors[status] ?? 1;
    if (status === "认证中") pendingCertList.push(`${baseName(c, baseId)}·LINE-${baseId}`);
    const weekly = weeklyByBase.get(baseId) ?? 0;
    const mw = maintWeekOf(c, baseId);
    let cumTotal = 0;
    for (let w = 1; w <= weeks; w++) {
      const add = weekly * certFactor * curveMult(p, w, mw);
      cumTotal += add;
      for (let i = w - 1; i < weeks; i++) cumP50ByWeek[i] = (cumP50ByWeek[i] as number) + add;
    }
    p50 += cumTotal;
    // S1.3 tightness for the per-base bottleneck column + global mainBn —— LIVE 优先（真数据），无真数据源回落 MOCK。
    const bn = primaryFactor(c, baseId);
    const lt = liveTightness(c, baseId, bn);
    // WO-KILL-MOCK-RED：无真源 → tight=null（不伪造）；仅真值参与全局 mainBn/mainTightness（不被假红拉高）。
    const tight = lt.value;
    anyLive = anyLive || lt.live;
    // WO-DATAMODE-UNIFY-PROVENANCE（provenance 维·加性·裁决两正交维·不动 measurement）：本基地对象是否合成物化。
    // `live` 保持 measurement 语义（读真值即 LIVE），**另加** provenanceSynthetic 位——前端逐行决策红 gate
    // 收窄为 provenance(!provenanceSynthetic) AND measurement(live) 双维（demo 合成基地不冒充实测决策红·Dev-3 落）。
    const baseObj = c.bases.find((b) => str(b.props.baseId) === baseId);
    const rowProvenanceSynthetic = baseObj && c.isSynthProvenance ? c.isSynthProvenance(baseObj) : false;
    if (tight !== null && tight > mainTightness) {
      mainTightness = tight;
      mainBn = bn;
    }
    perBaseRows.push({
      base: baseName(c, baseId),
      baseId,
      weeklyCap: round(weekly, 4),
      certFactor,
      maintWeek: mw,
      bottleneck: bn,
      tightness: tight,
      live: lt.live, // measurement 维：该基地主瓶颈紧张度是否来自真数据（读真值即 LIVE·CAP-01/measurement 不动）
      provenanceSynthetic: rowProvenanceSynthetic, // provenance 维（加性）：底层基地对象合成物化 → true（前端双维 gate 消费）
      cumTotal: round(cumTotal, 4),
    });
  }
  p50 = round(p50, 4);
  // METHOD-MC-STOCHASTIC：P90 由「点估计 × 常数(0.93)」→「种子化蒙特卡洛真实经验分位」（根因解·不作假）。
  // 单元=各基地累计 P50 贡献；不确定因子（yield/oee/… 抽象角色·cv 取自 SolverParam mc.dispersion.*）逐迭代采样
  // （seeded mulberry32·R6）→ 经验分布 → type-7 分位。陈旧关键源 → cv×staleDispersionMult（分布变宽 → p90 下探·C09 诚实）。
  const mcParams = resolveMcParams(p.mc);
  const mcUnits: McUnit[] = perBaseRows.map((r) => ({ point: num(r.cumTotal), stale: staleSources.length > 0 }));
  const seed = num(args.seed, 42);
  const mcRng = rngFromInput({ solver: "capacity_forecast", tenantId: c.tenantId, modelId, qty, weeks, batches: batches ?? null, whatIf: args.whatIf ?? null, seed, mc: mcParams });
  const mcRes = mcUnits.length > 0 ? monteCarlo(mcUnits, mcConfigFor(BUILTIN_CAPACITY_MC, mcParams), mcRng) : { p10: p50, p50, p90: p50, samplesSorted: [p50] };
  const p90 = round(mcRes.p90, 4);
  const p10 = round(mcRes.p10, 4);
  // 离散度比值（真实 MC 派生·非固定 haircut）——供批次/what-if/校准记录复用相对分位口径（乘法误差模型近似尺度不变）。
  const dispRatio = p50 > 0 ? mcRes.p90 / p50 : 1;
  const mcMeta = {
    method: "monte_carlo" as const,
    iterations: mcParams.iterations,
    seed,
    dispersionSource: `SolverParam(mc.dispersion.*)·staleMult=${mcParams.staleDispersionMult}${staleSources.length > 0 ? "（关键源陈旧·cv 已放大）" : ""}`,
    percentiles: { p10, p50, p90 },
  };

  // Whole-order vs batch verdict.
  let gap: number;
  let ok: boolean;
  let batchRows: Record<string, unknown>[] | undefined;
  if (batches) {
    batches.sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    let cumDemand = 0;
    let worst = 0;
    batchRows = [];
    for (const b of batches) {
      const dueDay = dayFrom(p.forecastStart, b.dueDate);
      const wkEff = Math.max(1, Math.floor((dueDay - logisticsDays(p, b.address)) / 7));
      cumDemand += num(b.qty);
      // METHOD-MC-STOCHASTIC：批次累计 P90 用 MC 派生离散度比值（真实分位口径·非固定 0.93·乘法误差模型近似尺度不变）。
      const cumP90 = round((cumP50ByWeek[Math.min(wkEff, weeks) - 1] as number) * dispRatio, 4);
      const rowOk = cumDemand <= cumP90;
      if (!rowOk) worst = Math.max(worst, cumDemand - cumP90);
      batchRows.push({ qty: num(b.qty), dueDate: b.dueDate, address: b.address, wkEff, cumDemand: round(cumDemand, 4), cumP90, ok: rowOk });
    }
    gap = round(Math.max(worst, 0), 4);
    ok = batchRows.every((r) => r.ok === true);
  } else {
    gap = round(qty - p90, 4);
    ok = gap <= 0;
  }

  // What-if (S1.2-7): 调整后P50 = P50×(1+0.06×夜班+0.05×扩通道)+qty×外协比例; C03 physical cap; C08 reject.
  let whatIf: Record<string, unknown> | undefined;
  if (args.whatIf) {
    const n = num(args.whatIf.nightShifts);
    const ch = num(args.whatIf.extraChannels);
    const ratio = num(args.whatIf.outsourceRatio);
    if (ratio > p.whatIf.outsourceMax) {
      whatIf = {
        rejected: true,
        ruleRef: "C08",
        reason: `外协比例 ${round(ratio * 100, 1)}% 超过红线 ${round(p.whatIf.outsourceMax * 100, 0)}%（C08），拒绝该参数组合`,
      };
    } else {
      let adjusted = p50 * (1 + p.whatIf.nightShiftCoef * n + p.whatIf.channelCoef * ch) + qty * ratio;
      // C03 physical ceiling: full-cert, no-ramp weekly capacity over the window.
      let physicalCap = 0;
      for (const baseId of cert.keys()) physicalCap += (weeklyByBase.get(baseId) ?? 0) * weeks;
      physicalCap = round(physicalCap, 4);
      let capped = false;
      if (adjusted > physicalCap) {
        adjusted = physicalCap;
        capped = true;
      }
      adjusted = round(adjusted, 4);
      // METHOD-MC-STOCHASTIC：what-if 调整后 P90 同走 MC 离散度比值（非固定 haircut）。
      const adjP90 = round(adjusted * dispRatio, 4);
      whatIf = {
        rejected: false,
        nightShifts: n,
        extraChannels: ch,
        outsourceRatio: ratio,
        adjustedP50: adjusted,
        adjustedP90: adjP90,
        physicalCap,
        capped,
        ...(capped ? { capNote: `调整后产能触及物理上限 ${physicalCap}（C03），按上限封顶` } : {}),
        gap: round(qty - adjP90, 4),
        ok: qty - adjP90 <= 0,
      };
    }
  }

  // PRD-IND-model 缺口①：收敛可产网络——不可产基地清单 + N/总数 收敛注解（reason 由 chem×kind 派生，R13/R14）。
  const model = c.models.find((m) => str(m.props.modelId) === modelId);
  const chem = str(model?.props.chem);
  const pos = str(model?.props.pos);
  const totalBases = c.bases.length;
  const producibleCount = cert.size;
  const nonProducible = c.bases
    .filter((b) => !cert.has(str(b.props.baseId)))
    .map((b) => {
      const kind = str(b.props.kind);
      // 三档原因：业态不符（动力↔储能）/ 化学体系产线未铺 / 未认证产线。
      const reason = pos && kind && !kind.includes(pos.replace("动力+储能", "动力")) && !pos.includes(kind)
        ? `基地业态「${kind}」与型号「${pos}」不匹配`
        : `${chem} 体系产线未在该基地铺设 / 认证`;
      return { base: baseName(c, str(b.props.baseId)), reason };
    })
    .sort((a, b) => (a.base < b.base ? -1 : 1));

  return {
    p50,
    p90,
    p10,
    // METHOD-MC-STOCHASTIC（R13）：P90/P10 为种子化蒙特卡洛真实经验分位（非 p50×0.93 伪分位）——前端悬浮出方法/迭代/seed/离散度源。
    ...mcMeta,
    // dispRatio：MC 派生离散度比值（供 QOS/校准复用；非固定常数，随 cv/租户变化）。
    mcDispRatio: round(dispRatio, 6),
    healthFactor,
    gap,
    ok,
    perBaseRows,
    nonProducible,
    totalBases,
    producibleCount,
    ...(batchRows ? { batchRows } : {}),
    mainBn,
    pendingCertList,
    ...(degradeNote ? { degradeNote } : {}),
    ...(whatIf ? { whatIf } : {}),
    weeks,
    qty,
    // 轨M 增量1（假2）：紧张度数据模式——LIVE=任一基地主瓶颈来自真 OEE/利用率/良率；MOCK=全回落 → 前端红/橙显"估算"。
    dataMode: anyLive ? "LIVE" : "MOCK",
    // WO-FAKE-10（阈值后端下发·前端不硬编码）：紧张度越线阈值 = risk.threshold（SolverParam 三层真值源·可校准）。
    tightnessThreshold: p.risk.threshold,
    // legacy aliases consumed by AgentCore QOS seed plans
    gapPct: qty > 0 ? round(Math.max(0, gap) / qty, 4) : 0,
    mainBottleneck: mainBn,
  };
}

export function logisticsDays(
  p: { logistics: { byAddress: Record<string, number>; defaultDays: number } },
  address?: string,
): number {
  if (!address) return 0;
  return p.logistics.byAddress[address] ?? p.logistics.defaultDays;
}
