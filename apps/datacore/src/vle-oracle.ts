import type { Repos } from "./repo/repo.js";
import { BATTERY_SOLVER_PARAMS } from "./synthetic/battery.js";
import { rngFromInput } from "./prng.js";
// METHOD-MC-STOCHASTIC：参照与被测同口径——P90 由种子化蒙特卡洛真实经验分位（method-mc 纯引擎，
// 非被测求解器 solvers/service·solvers/capacity·ruledsl，V9 门不禁）。P50 仍从零独立推导（双算真独立）。
import { BUILTIN_CAPACITY_MC, mcConfigFor, monteCarlo, resolveMcParams, type McUnit } from "./solvers/method-mc.js";

/**
 * VLE 参照实现预言机（PRD-addendum-validation-loop §2「参照实现」类）。
 *
 * 这是 capacity_forecast 关键产出 P50/P90 的**第二套独立代码**——用于 ⑤求解器执行段的「求解值 vs 参照值」
 * 双算比对（VL2）。设计红线（继承 VLE 正门铁律 + §4-2 静态检查）：
 *   - **禁止 import 被测求解器**（`solvers/service` / `solvers/capacity`）：那是 SUT(被测系统)，
 *     用它产期望值 = 双算形同虚设。本文件只 import `Repos` 类型（断言比对允许直读 DB）与
 *     `BATTERY_SOLVER_PARAMS`（GenSpec 配置常数 = 构造真值的来源，非被测计算路径）。
 *   - 全部公式在此从零独立推导（设备产能/h → 工序 → 产线 min → 基地封顶 → 周产能 → 周曲线累计 → P50/P90），
 *     刻意用与被测不同的代码组织（局部具名、显式循环），保证「双算」是真独立而非拷贝。
 *
 * 静态门 `scripts/check-validation.mjs`（V9）强制守上述零 import 红线。
 */

type Obj = { id: string; type: string; props: Record<string, unknown> };
type Lnk = { id: string; type: string; fromId: string; toId: string; props?: Record<string, unknown> };

/** 周曲线参数（爬坡 + 检修），独立读自 GenSpec 配置常数。 */
interface CurveCfg {
  rampBase: number;
  rampStep: number;
  rampFullWeek: number;
  maintMult: number;
}

export interface ReferenceForecast {
  modelId: string;
  weeks: number;
  /** 参照独立算出的 P50（万套，4 位小数）。 */
  p50: number;
  /** 参照独立算出的 P90 = P50 × 健康系数。 */
  p90: number;
  healthFactor: number;
  /** 逐基地中间量（用于 diff 下钻：定位首个偏离对象）。 */
  perBase: { baseId: string; weeklyWan: number; certFactor: number; maintWeek: number | null; cumTotal: number }[];
}

const n = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const s = (v: unknown, d = ""): string => (typeof v === "string" ? v : v == null ? d : String(v));
/** 4 位定点取整（与被测同精度，使比对在确定性容差内可逐字段对齐）。 */
const r4 = (x: number): number => Math.round(x * 1e4) / 1e4;
const r2 = (x: number): number => Math.round(x * 1e2) / 1e2;

/** 独立读取本租户求解参数：repo 覆盖 ⊕ GenSpec 默认（与系统 getParams 同口径，但不经被测服务）。 */
async function loadParams(repos: Repos, tenantId: string): Promise<Record<string, unknown>> {
  const rec = await repos.solverParams.get(tenantId, `spar_${tenantId}`);
  const override = (rec?.params ?? {}) as Record<string, unknown>;
  return { ...BATTERY_SOLVER_PARAMS, ...override };
}

/**
 * 第二套独立产能链：设备→工序→产线→基地→周产能(万套)。
 * 与被测 computeRollup 形状一致但逐行独立重写（不 import 它）。
 */
function weeklyWanByBase(
  bases: Obj[],
  lines: Obj[],
  processes: Obj[],
  equipment: Obj[],
  packCellCount: number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const base of bases) {
    const baseId = s(base.props.baseId);
    const baseLines = lines.filter((l) => s(l.props.baseId) === baseId);
    let lineSum = 0;
    for (const line of baseLines) {
      const lineId = s(line.props.lineId);
      const procs = processes.filter((p) => s(p.props.lineId) === lineId);
      const serialCaps: number[] = [];
      let formationCap = Number.POSITIVE_INFINITY;
      let agingCap = Number.POSITIVE_INFINITY;
      for (const proc of procs) {
        const kind = s(proc.props.kind);
        if (kind === "formation") {
          const cap = n(proc.props.channels) * n(proc.props.channelOutputDaily) * n(proc.props.yield, 1);
          formationCap = Math.min(formationCap, cap);
        } else if (kind === "aging") {
          const cap = n(proc.props.agingSlots) / Math.max(1, n(proc.props.agingDays, 1));
          agingCap = Math.min(agingCap, cap);
        } else {
          // 通用工序：Σ设备产能/h × 工时 × 良率 × 出勤 × 利用率。
          const equips = equipment.filter((e) => s(e.props.processId) === s(proc.props.processId));
          let hourly = 0;
          for (const e of equips) {
            const oeeSnap = e.props.oee_current;
            const oee =
              typeof oeeSnap === "number" && Number.isFinite(oeeSnap) && oeeSnap > 0
                ? oeeSnap
                : n(e.props.oeeA, 1) * n(e.props.oeeP, 1) * n(e.props.oeeQ, 1);
            hourly += (3600 / Math.max(0.01, n(e.props.ctSeconds, 1))) * n(e.props.availFactor, 1) * oee;
          }
          const laborHours = n(proc.props.shiftHours, 24) * n(proc.props.shifts, 1);
          const cap =
            hourly * laborHours * n(proc.props.yield, 1) * n(proc.props.attendance, 1) * n(proc.props.utilization, 1);
          serialCaps.push(cap);
        }
      }
      const serialMin = serialCaps.length > 0 ? Math.min(...serialCaps) : 0;
      const lineDaily = Math.min(serialMin, formationCap, agingCap);
      lineSum += r2(lineDaily);
    }
    const sharedFormation = n(base.props.formationCapDaily, Number.POSITIVE_INFINITY) || Number.POSITIVE_INFINITY;
    const sharedAging = n(base.props.agingCapDaily, Number.POSITIVE_INFINITY) || Number.POSITIVE_INFINITY;
    const dailyCells = r2(Math.min(lineSum, sharedFormation, sharedAging));
    const weeklyWan = r4((dailyCells * 7) / Math.max(1, packCellCount) / 10000);
    out.set(baseId, weeklyWan);
  }
  return out;
}

/** 周曲线系数（独立第二套）：ramp 段线性爬坡，第 fullWeek 周起达产 1.0，检修周再 ×maintMult。 */
function weekCurve(cfg: CurveCfg, week: number, maintWeek: number | null): number {
  let m = week >= cfg.rampFullWeek ? 1 : cfg.rampBase + cfg.rampStep * (week - 1);
  if (maintWeek !== null && week === maintWeek) m *= cfg.maintMult;
  return m;
}

/**
 * 独立参照预测 capacity_forecast 的 P50/P90（整单口径，无 batches/whatIf——VLE SMOKE 注入即此口径）。
 * 全程读对象图 + GenSpec 参数，零被测 import。供 ⑤段双算比对。
 */
export async function referenceCapacityForecast(
  repos: Repos,
  tenantId: string,
  modelId: string,
  weeks: number,
  // 被测整单口径缺省 args：qty=0（num(args.qty,0)）·seed=42（num(args.seed,42)）——参照复现同种子流以逐位双算 P90。
  qty = 0,
  seed = 42,
): Promise<ReferenceForecast> {
  const params = await loadParams(repos, tenantId);
  const packCellCount = n(params.packCellCount, 96);
  const certFactors = (params.certFactors ?? {}) as Record<string, number>;
  const rampCfg = (params.ramp ?? {}) as { base: number; step: number; fullWeek: number };
  const health = (params.health ?? {}) as { normal: number; degraded: number; staleHours: number };
  const curve: CurveCfg = {
    rampBase: n(rampCfg.base, 0.88),
    rampStep: n(rampCfg.step, 0.03),
    rampFullWeek: n(rampCfg.fullWeek, 5),
    maintMult: n(params.maintMult, 0.72),
  };

  const [bases, lines, processes, equipment, maintPlans, models] = (await Promise.all([
    repos.objects.listByType(tenantId, "Base"),
    repos.objects.listByType(tenantId, "Line"),
    repos.objects.listByType(tenantId, "Process"),
    repos.objects.listByType(tenantId, "Equipment"),
    repos.objects.listByType(tenantId, "MaintPlan"),
    repos.objects.listByType(tenantId, "Model"),
  ])) as unknown as [Obj[], Obj[], Obj[], Obj[], Obj[], Obj[]];

  // 认证关系（model_certified_on）：model→line→base，独立重建 certByModel。
  const certLinks = (await repos.links.list(tenantId, (l) => l.type === "model_certified_on")) as unknown as Lnk[];
  const lineBase = new Map(lines.map((l) => [l.id, s(l.props.baseId)]));
  const modelById = new Map(models.map((m) => [m.id, s(m.props.modelId)]));
  const certByBase = new Map<string, string>();
  for (const link of certLinks.sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const mId = modelById.get(link.fromId) ?? s(link.props?.modelId);
    const bId = lineBase.get(link.toId) ?? s(link.props?.baseId);
    if (mId !== modelId || !bId) continue;
    certByBase.set(bId, s(link.props?.status, "量产"));
  }

  const weeklyByBase = weeklyWanByBase(bases, lines, processes, equipment, packCellCount);
  const maintWeekByBase = new Map<string, number | null>();
  for (const base of bases) {
    const baseId = s(base.props.baseId);
    const mp = maintPlans.find((m) => s(m.props.baseId) === baseId);
    maintWeekByBase.set(baseId, mp ? n(mp.props.week) : null);
  }

  // 数据健康降级（C09）：任一关键源新鲜度延迟 > staleHours → P90 系数降级。
  // SMOKE 注入无 stale 源，但参照仍独立判定（不读被测 healthFactor）。
  const dataHealth = (await repos.objects.listByType(tenantId, "DataSourceHealth")) as unknown as Obj[];
  const stale = dataHealth.some((h) => h.props.critical === true && n(h.props.lagHours) > n(health.staleHours, 2));
  const healthFactor = stale ? n(health.degraded, 0.9) : n(health.normal, 0.93);

  let p50 = 0;
  const perBase: ReferenceForecast["perBase"] = [];
  for (const [baseId, status] of [...certByBase.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const certFactor = certFactors[status] ?? 1;
    const weekly = weeklyByBase.get(baseId) ?? 0;
    const maintWeek = maintWeekByBase.get(baseId) ?? null;
    let cumTotal = 0;
    for (let w = 1; w <= weeks; w++) cumTotal += weekly * certFactor * weekCurve(curve, w, maintWeek);
    p50 += cumTotal;
    perBase.push({ baseId, weeklyWan: weekly, certFactor, maintWeek, cumTotal: r4(cumTotal) });
  }
  p50 = r4(p50);
  // METHOD-MC-STOCHASTIC：P90 = 种子化蒙特卡洛真实经验分位（与被测 capacity.ts 同口径·同种子流 → 逐位双算）。
  // 单元=各基地累计 P50 贡献；陈旧关键源 → cv 放大（method-mc 内部按 stale 处理）。
  const mcParams = resolveMcParams(params.mc as Partial<Parameters<typeof resolveMcParams>[0]>);
  const mcUnits: McUnit[] = perBase.map((pb) => ({ point: pb.cumTotal, stale }));
  const mcRng = rngFromInput({ solver: "capacity_forecast", tenantId, modelId, qty, weeks, batches: null, whatIf: null, seed, mc: mcParams });
  const mcRes = mcUnits.length > 0 ? monteCarlo(mcUnits, mcConfigFor(BUILTIN_CAPACITY_MC, mcParams), mcRng) : { p10: p50, p50, p90: p50, samplesSorted: [p50] };
  const p90 = r4(mcRes.p90);
  return { modelId, weeks, p50, p90, healthFactor, perBase };
}
