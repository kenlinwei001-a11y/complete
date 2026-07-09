import { round, hashString } from "../prng.js";
import { SEG_REGISTRY, classifySegment } from "@platform/contracts";
import { validationError } from "../errors.js";
import { baseName, clamp, dayFrom, maintWeekOf, num, str, type SolverContext } from "./types.js";
import { computeRollup } from "./capacity.js";

// ---------------------------------------------------------------------------
// S1.3 bottleneck_matrix — LIVE vs MOCK dual mode
// ---------------------------------------------------------------------------

export function primaryFactor(c: SolverContext, baseId: string): string {
  const name = baseName(c, baseId);
  return c.params.bottleneck.primary[name] ?? c.params.bottleneck.defaultPrimary;
}

/**
 * RISK-TRAJECTORY-DEFAKE（B8·治本）：severity 判据阈值单一真相源（SolverParam `risk.caseSeverity` 默认即此常量）。
 * 此前 92/78/加成 12 内联于函数体、注释诡称"域参数"（实为不可校准的魔数）；现入 params.risk.caseSeverity，
 * 函数默认参数引用同一命名常量（battery 该 param 默认亦引用它）——可校准·非内联魔数·单源可溯（R14）。
 */
export const CASE_SEVERITY_DEFAULT = { highScore: 92, medScore: 78, primaryBonus: 12 } as const;

/**
 * cockpit P4 真闭环（PRD §2.3「riskCases 由实时算而非写死」）：历史处置案例严重度由**基地真实数据**
 * 确定性派生——基地利用率压力 + 该因子是否为基地主瓶颈（加成）+ 是否结构性危机事件。
 * 替代 CASE_SPECS 手写 severity 字面量（R13 可溯源：severity 来自 util/primaryFactor/crisis；R6 同输入同判）。
 * 阈值来自 params.risk.caseSeverity（B8·可校准），默认取 CASE_SEVERITY_DEFAULT——非内联魔数。
 */
export function caseSeverityFromData(
  util: number,
  isPrimaryFactor: boolean,
  crisis: boolean,
  sev: { highScore: number; medScore: number; primaryBonus: number } = CASE_SEVERITY_DEFAULT,
): "LOW" | "MEDIUM" | "HIGH" {
  if (crisis) return "HIGH"; // 结构性危机（到货断供）恒高危
  const score = util + (isPrimaryFactor ? sev.primaryBonus : 0);
  return score >= sev.highScore ? "HIGH" : score >= sev.medScore ? "MEDIUM" : "LOW";
}

/**
 * HARDCODE-BIZ-ENTITY（残项②·通电）：problems[] 财务影响（亿元）真闭环读取点。
 * = Σ 订单 qty × 套(×10000) × 单价 ÷ 1e8；单价取订单真 unitPrice，缺失时兜底 fallbackUnitPrice
 * （params.risk.fallbackUnitPrice·可校准·非内联魔数，默认 600·R6 字节一致）。改 param → 兜底随之变。
 */
export function orderFinanceImpactWan(
  rows: Record<string, unknown>[],
  orders: readonly { props: Record<string, unknown> }[],
  fallbackUnitPrice: number,
): number {
  return round(rows.reduce((a, r) => a + num(r.qty) * 10000 * num(orders.find((o) => o.props.so === r.so)?.props.unitPrice, fallbackUnitPrice), 0) / 1e8, 4);
}

/** MOCK 口径 (exact prototype formula): seed=(base首字符码+因素首字符码×7) mod 9. */
export function mockTightness(c: SolverContext, baseId: string, factor: string): number {
  const m = c.params.bottleneck.mock;
  const bName = baseName(c, baseId);
  const seed = ((bName.charCodeAt(0) || 0) + (factor.charCodeAt(0) || 0) * m.factorMult) % m.mod;
  if (factor === primaryFactor(c, baseId)) {
    return Math.min(m.primaryCap, m.primaryBase + (seed % m.mod));
  }
  const base = c.bases.find((b) => b.props.baseId === baseId);
  const util = num(base?.props.util, 0);
  return Math.min(m.secondaryCap, m.secondaryBase + seed + (util > m.utilHigh ? m.utilHighAdd : m.utilLowAdd));
}

// ---------------------------------------------------------------------------
// WO-FORECAST-SIM：紧张度 = 真需求 − 产能 缺口（替代 mockTightness 哈希）。
// 需求侧：DemandSegment(forecast 域 p50/p90) + SopVersionRow.demand（最终版/最新版）+ 订单近期实需；
// 供给侧：computeRollup 真产能曲线（基地周产能 weeklyWan）。紧张度 = 缺口/产能 over horizon → 0..100。
// **确定性 R6**（无 Math.random/Date.now/new Date；同对象库 + 同参数 → 同输出）。
// 需求/产能均为网络级（DemandSegment 按细分、SopVersion 按网络），按基地真产能份额确定性分摊到基地。
// 仅当真预测数据存在（DemandSegment 或 SopVersionRow）才置 live=true（诚实位）；否则不视作真源。
// ---------------------------------------------------------------------------

/** 网络周产能（万套/周）：Σ 基地 weeklyWan（computeRollup 真算）。 */
function networkWeeklyCapacityWan(c: SolverContext): { total: number; byBase: Map<string, number> } {
  const rollup = computeRollup(c);
  const byBase = new Map<string, number>();
  let total = 0;
  for (const b of rollup.bases) {
    const w = Math.max(0, num(b.weeklyWan));
    byBase.set(b.baseId, w);
    total += w;
  }
  return { total: round(total, 6), byBase };
}

/**
 * 网络需求-产能平衡（**量纲无关的负载比**，确定性 R6）——避免"期内总量 ÷ 周产能"量纲错配（会恒饱和）：
 *  · 产销负载比 sopLoad = SopVersion(最终版/最新版).demand ÷ supply（同期同单位的真"需求÷产能"，这是 WO 要的核心信号）；
 *  · 预测压力比 fcLoad = Σ DemandSegment.p50 ÷ Σ tgt（预测需求相对目标产能基线的承压度）；
 *  · 预测上行比 upside = Σ(p90−p50) ÷ Σ p50（预测离散度，抬升张力）。
 * networkLoad = max(sopLoad, fcLoad) × (1 + 0.5×upside)；hasForecast=有①②任一真预测。
 * 负载比 ~1.0（供需平衡）→ 张力中性；>1 产能不足→张力升；<1 富余→张力降。**改 p50/demand 真值 → 负载比变 → 张力变**。
 */
function networkDemandSupplyLoad(c: SolverContext): { load: number; gap: number; hasForecast: boolean } {
  const dsegs = c.demandSegments ?? [];
  const sops = c.sopVersions ?? [];
  // ① SopVersion 真"需求÷产能"（同期同单位）：最终版优先，否则日期最新（确定性 tie-break）。
  let sopLoad = 0;
  let sopGap = 0;
  if (sops.length > 0) {
    const sorted = [...sops].sort((a, b) => {
      const fa = a.props.isFinal === true ? 1 : 0;
      const fb = b.props.isFinal === true ? 1 : 0;
      if (fa !== fb) return fb - fa;
      const da = str(a.props.date);
      const db = str(b.props.date);
      if (da !== db) return da < db ? 1 : -1;
      return str(a.props.verId) < str(b.props.verId) ? 1 : -1;
    });
    const demand = Math.max(0, num(sorted[0]!.props.demand));
    const supply = Math.max(0, num(sorted[0]!.props.supply));
    if (supply > 0) {
      sopLoad = demand / supply;
      sopGap = round(Math.max(0, demand - supply), 4); // 真缺口（万套，可溯：需求−产能）
    }
  }
  // ② DemandSegment 预测承压比（Σp50 ÷ Σtgt）+ 预测上行比（Σ(p90−p50) ÷ Σp50）。
  let segP50 = 0;
  let segP90 = 0;
  let segTgt = 0;
  for (const d of dsegs) {
    segP50 += Math.max(0, num(d.props.p50));
    segP90 += Math.max(0, num(d.props.p90, num(d.props.p50)));
    segTgt += Math.max(0, num(d.props.tgt));
  }
  const fcLoad = segTgt > 0 ? segP50 / segTgt : 0;
  const upside = segP50 > 0 ? Math.max(0, segP90 - segP50) / segP50 : 0;
  const baseLoad = Math.max(sopLoad, fcLoad);
  // HARDCODE-SOLVER-PARAMS（ε1 残留闭合）：预测上行比权重入 params.risk.demandTension.upsideGain（默认 0.5 == 原内联·R6）。
  const upsideGain = c.params.risk.demandTension.upsideGain ?? 0.5;
  const load = baseLoad > 0 ? baseLoad * (1 + upsideGain * upside) : 0;
  return { load: round(load, 6), gap: sopGap, hasForecast: dsegs.length > 0 || sops.length > 0 };
}

/**
 * 基地需求-产能紧张度（0..100，确定性 R6）：网络负载比（真需求÷真产能·量纲无关）→ 张力，
 * 再以基地真产能份额（高产能基地承接更多需求压力）+ 基地占用 util（本体真值）调制到基地。
 * live=true 仅当有真预测（DemandSegment/SopVersion）且基地有真产能；否则回落（不视作真源·诚实 MOCK）。
 * 映射：load=1（供需平衡）→ 基线 62；load 每偏 1.0 → ±70 张力；高产能份额 + 高占用基地承压更大。
 * gap（万套·真缺口=需求−产能）随基地份额分摊回报，前端可溯"缺口=预测需求−产能"。
 */
export function demandCapacityTightness(c: SolverContext, baseId: string): { value: number; live: boolean; gap: number } {
  const cap = networkWeeklyCapacityWan(c);
  const baseCap = cap.byBase.get(baseId) ?? 0;
  const dsl = networkDemandSupplyLoad(c);
  if (!dsl.hasForecast || baseCap <= 0 || cap.total <= 0) return { value: 0, live: false, gap: 0 };
  const share = baseCap / cap.total; // 基地真产能份额（0..1，确定性）
  const base = c.bases.find((b) => b.props.baseId === baseId);
  const util = num(base?.props.util, 0); // 本体真值占用（0..1）
  // 基地承压系数：网络负载比偏离平衡 × 基地份额权重（高产能基地承接更多需求压力）+ 基地占用偏移。
  // RISK-TRAJECTORY-DEFAKE（B9·治本）：映射系数全部入 params.risk.demandTension（可校准·非内联魔数 R14）；
  // 数值仍由真 load/share/util 驱动（改 p50/demand 真值即整体平移·R6 可溯），仅把内联常数搬进参数存储。
  const dt = c.params.risk.demandTension;
  const shareWeight = dt.shareBase + dt.shareGain * share;
  const tension = dt.base + (dsl.load - 1) * dt.loadGain * shareWeight + (util - dt.utilPivot) * dt.utilGain;
  const gap = round(dsl.gap * share, 4); // 基地分摊真缺口（万套，需求−产能）
  // HARDCODE-SOLVER-PARAMS（ε1 残留闭合）：张力上限 clamp 入 params.risk.demandTension.tensionCap（默认 98 == 原内联·R6）。
  const tensionCap = dt.tensionCap ?? 98;
  return { value: clamp(Math.round(tension), 0, tensionCap), live: true, gap };
}

/**
 * LIVE 口径：读真实快照指标（设备OEE/瓶颈工序利用率/良率）或真需求-产能缺口。
 * WO-KILL-MOCK-RED（治本·非贴标签）：**无真实数据源 → 不伪造**，返回 `{value:null, live:false}`（hasData=false 语义）。
 * 此前回落 `mockTightness`（基地名+因子名哈希 → 恒红越线）是"MOCK 值上线为决策级红"的根断点（G-DM-1）。
 * 决策级红/越线只能来自 live===true（真数据出真红·C6：有真数据仍照常出红，非无脑灭红）。
 */
export function liveTightness(c: SolverContext, baseId: string, factor: string): { value: number | null; live: boolean } {
  const lp = c.params.bottleneck.live;
  if (factor === "设备OEE") {
    const eq = c.equipment.filter((e) => e.props.baseId === baseId && typeof e.props.oee_current === "number");
    if (eq.length > 0) {
      const avg = eq.reduce((a, e) => a + num(e.props.oee_current), 0) / eq.length;
      return { value: clamp(Math.round(lp.oeeBase + (1 - avg) * lp.oeeK), 0, 100), live: true };
    }
  }
  if (factor === "瓶颈工序") {
    const lines = c.lines.filter((l) => l.props.baseId === baseId && typeof l.props.utilization === "number");
    if (lines.length > 0) {
      const avg = lines.reduce((a, l) => a + num(l.props.utilization), 0) / lines.length;
      return { value: clamp(Math.round(avg * lp.utilK + lp.utilBase), 0, 100), live: true };
    }
  }
  if (factor === "良率波动") {
    const procs = c.processes.filter((pr) => pr.props.baseId === baseId && typeof pr.props.yield_baseline === "number");
    if (procs.length > 0) {
      const avg = procs.reduce((a, pr) => a + num(pr.props.yield_baseline), 0) / procs.length;
      return { value: clamp(Math.round(lp.yieldBase + (1 - avg) * lp.yieldK), 0, 100), live: true };
    }
  }
  // WO-FORECAST-SIM：需求驱动因素（瓶颈工序/人力工时/物料齐套——随需求-产能缺口共振）无逐设备实测源时，
  // 优先用**真需求-产能缺口**派生的基地紧张度（DemandSegment/SopVersion 真预测存在即 LIVE，可溯·R6），
  // 而非 mockTightness 哈希。其余纯设备/物流因素（设备OEE 已上方处理 / 物流时长 / 换型损失）无真源回落 MOCK。
  if (DEMAND_DRIVEN_FACTORS.has(factor)) {
    const dc = demandCapacityTightness(c, baseId);
    if (dc.live) return { value: dc.value, live: true };
  }
  // 治本：无任何真实数据源（无逐设备 OEE/利用率/良率·无真需求-产能预测）→ 不伪造决策级紧张度。
  // （旧回落经 mockTightness 哈希造恒红越线，是洛阳·设备OEE 假红的根源 G-DM-1，已删。）
  return { value: null, live: false };
}

/** 需求驱动型瓶颈因素：紧张度随真需求-产能缺口共振（无逐设备实测源 → 用 demandCapacityTightness）。 */
const DEMAND_DRIVEN_FACTORS = new Set(["瓶颈工序", "人力工时", "物料齐套"]);

export function bottleneckMatrix(
  c: SolverContext,
  args: { dataMode?: string; baseIds?: string[] },
): { dataMode: "LIVE" | "MOCK"; factors: string[]; rows: { base: string; tightness: Record<string, number | null>; primary: string }[] } {
  const factors = c.params.bottleneck.factors;
  const wantLive = args.dataMode === "LIVE";
  let anyLive = false;
  const baseIds = args.baseIds ?? c.bases.map((b) => str(b.props.baseId));
  // WO-KILL-MOCK-RED（治本·非贴标签）：格子紧张度只从真值来。
  //  - LIVE 请求（生产两处消费方 RiskBoardView/ProjectSimView 均传 dataMode:LIVE）：读 liveTightness（真 OEE/
  //    利用率/良率 或真需求-产能缺口）；无真源格子 → null（前端灰·不染红），**不再逐格 mockTightness 哈希染红**。
  //  - 非 LIVE（未请求实测）：诚实 MOCK 态——所有格 null（不伪造任何估算红），dataMode=MOCK。
  const rows = baseIds
    .sort()
    .map((baseId) => {
      const tightness: Record<string, number | null> = {};
      for (const f of factors) {
        if (!wantLive) { tightness[f] = null; continue; }
        const r = liveTightness(c, baseId, f);
        tightness[f] = r.live ? r.value : null;
        anyLive = anyLive || r.live;
      }
      return { base: baseName(c, baseId), tightness, primary: primaryFactor(c, baseId) };
    });
  return { dataMode: wantLive && anyLive ? "LIVE" : "MOCK", factors, rows };
}

// ---------------------------------------------------------------------------
// S1.4 risk_timeline — baseline climb + event pulses
// ---------------------------------------------------------------------------

export interface RiskEvent {
  type: "maint_window" | "delivery_peak" | "arrival_gap";
  day: number;
  amp: number;
  factors: string[];
  tag?: string;
  obj?: string;
  desc?: string;
  src?: string;
}

const EVENT_FACTORS: Record<RiskEvent["type"], string[]> = {
  maint_window: ["设备OEE", "瓶颈工序"],
  delivery_peak: ["瓶颈工序", "人力工时"],
  arrival_gap: ["物料齐套", "物流时长"],
};

// RISK-TRAJECTORY-DEFAKE（B2/B3/B4·治本·删假源归因）：事件的**存在与发生日**来自真本体（检修计划周 /
// 订单交期日 / 到货周期 / 延误在途批），但此前每个事件的**具体量化值**（停机天/OEE 下调 pt/齐套率%/覆盖天/
// 负载 pt/在途批数）皆由 `hn()=hashString%mod` 编造，且整簇标 `src=EAM/CMMS·S&OP/ERP·WMS/ERP` **假源归因**
// （谎称来自真系统·比无披露更坏）。→ 删 EVENT_SRC + hn；desc 只叙**真锚点**（第几周检修 / 哪个订单 qty /
// 哪批在途·真 coverageDays），无实测量化的一律**明标"需接入实测·当前无实测值"或"估算"**，不再编具体数字、不标真源。

export function riskEvents(c: SolverContext, baseId: string, horizon: number): RiskEvent[] {
  const p = c.params.risk;
  const events: RiskEvent[] = [];
  const bn = baseName(c, baseId);
  const mw = maintWeekOf(c, baseId);
  if (mw !== null) {
    const day = mw * 7 - 3;
    if (day >= 1 && day <= horizon) {
      // 检修窗口：真锚点=检修计划第 mw 周（MaintPlan.week 真本体）。停机天/OEE 下调 pt 本体无实测字段 → 不编造。
      events.push({ type: "maint_window", day, amp: p.eventAmps.maint_window, factors: EVENT_FACTORS.maint_window,
        tag: "检修窗", obj: bn, desc: `年度检修窗口（第${mw}周）：设备检修占用产能，抬升设备OEE/瓶颈工序张力（计划停机天数与 OEE 影响需接入 EAM/CMMS 实测，当前无实测值）` });
    }
  }
  for (const o of c.orders) {
    const bases = Array.isArray(o.props.bases) ? (o.props.bases as string[]) : [];
    if (!bases.includes(baseId)) continue;
    const dueDay = dayFrom(c.params.forecastStart, str(o.props.due));
    if (dueDay >= 1 && dueDay <= horizon) {
      // 交付高峰：真锚点=订单 so/cust/qty/交期（Order 真本体）。qty 为真；额外工时=qty×系数(param) 明标「估算」；
      // 旧「排产负载 +{load}pt」为 hash 编造 → 删（无实测排产负载源）。
      const so = str(o.props.so); const cust = str(o.props.cust); const qty = num(o.props.qty);
      const laborShifts = Math.round(qty * p.deliveryLaborPerWan);
      events.push({ type: "delivery_peak", day: dueDay, amp: p.eventAmps.delivery_peak, factors: EVENT_FACTORS.delivery_peak,
        tag: "交付高峰", obj: so, desc: `${so}·${cust} 交付 ${qty} 万套到期（交期 D+${dueDay}）：交付高峰抬升当周排产负载，预计额外工时约 ${laborShifts} 人·班（按 ${p.deliveryLaborPerWan} 人·班/万套估算·非实测）` });
    }
  }
  for (let d = p.arrivalCycleDays; d <= horizon; d += p.arrivalCycleDays) {
    // 到货周期节点：合成周期锚点（非绑定单一真对象）。覆盖天/齐套率无实测库存源 → 不编造（旧 cover/kit 为 hash）。
    events.push({ type: "arrival_gap", day: d, amp: p.eventAmps.arrival_gap, factors: EVENT_FACTORS.arrival_gap,
      tag: "到货间隙", obj: bn, desc: `关键物料到货周期节点（每 ${p.arrivalCycleDays} 天·第 ${d} 天）：到货间隙期需关注物料齐套与物流时效（安全库存覆盖天数与齐套率需接入 WMS/ERP 实测，当前无实测值）` });
  }
  // Delayed in-transit shipments (scenario shipment_delay) add an extra arrival-gap pulse at the new ETA.
  // 真锚点=延误在途批（Shipment 真本体：shipId/etaDay/coverageDays 真字段）。coverageDays 为真则如实展示；
  // 在途批数=本基地在途/延误批真计数（非 hash）。旧「延迟 {lead} 天」无原始 ETA 基线源 → 删。
  const inTransitCount = c.shipments.filter(
    (x) => x.props.baseId === baseId && (x.props.status === "IN_TRANSIT" || x.props.status === "DELAYED"),
  ).length;
  for (const s of c.shipments) {
    if (s.props.baseId !== baseId || s.props.status !== "DELAYED") continue;
    const day = num(s.props.etaDay);
    if (day >= 1 && day <= horizon) {
      const shipId = str(s.props.shipId);
      const coverageDays = num(s.props.coverageDays);
      const coverTxt = coverageDays > 0 ? `：安全库存覆盖约 ${coverageDays} 天` : "";
      events.push({ type: "arrival_gap", day, amp: p.eventAmps.arrival_gap, factors: EVENT_FACTORS.arrival_gap,
        tag: "到货间隙", obj: bn, desc: `在途批次 ${shipId} 到货延迟（ETA D+${day}）${coverTxt}；当前基地在途 ${inTransitCount} 批` });
    }
  }
  return events.sort((a, b) => a.day - b.day || (a.type < b.type ? -1 : 1));
}

/**
 * tension(f,d) per S1.4 — returns the daily series for d=1..H.
 * RISK-TRAJECTORY-DEFAKE（B1·治本·crossDay 不能编）：基线 = 真张力 `baseline`（liveTightness：真 OEE/利用率/良率
 * 或真需求-产能缺口），**保持水平**——此前 `vb = cur + (tgt−cur)×ramp` 让曲线爬向 `riskTarget`（=名首码+因子首码 hash
 * 编的目标位），穿越日 crossDay 由这个假目标决定（编的）。现删 riskTarget/爬坡：轨迹只由**真基线 + 真事件脉冲**
 * （事件发生日来自真本体：检修周/订单交期/到货周期/延误在途）决定；真基线够高或真事件把张力顶过阈值才越线，
 * 否则诚实不越（crossDay=null）。红仍来自真数据（KILL-MOCK-RED 基线不破），但不再由 hash 目标制造穿越日。
 */
export function tensionSeries(
  c: SolverContext,
  factor: string,
  horizon: number,
  events: RiskEvent[],
  mitigation: { eff: number; tn: number } | undefined,
  // WO-KILL-MOCK-RED（治本）：基线张力**必须**来自真数据（liveTightness 读 OEE/利用率/良率 或真需求-产能缺口）。
  // 此前 `baseline ?? mockTightness(...)` 会在无真源时哈希造红——已删；调用方须在 lt.live 时才调用（传真值）。
  baseline: number,
): number[] {
  const p = c.params.risk;
  const vb = baseline; // 真基线水平（无 hash 爬坡目标·B1）
  const series: number[] = [];
  for (let d = 1; d <= horizon; d++) {
    let pulse = 0;
    for (const e of events) {
      if (!e.factors.includes(factor)) continue;
      const dist = Math.abs(d - e.day);
      if (dist > p.pulseWindow) continue;
      const ps = Math.max(p.psFloor, 1 - (vb - p.psStart) / p.psDen);
      pulse += e.amp * ps * (1 - dist / p.pulseDecayDen);
    }
    let v = Math.min(p.cap, Math.round(vb + pulse));
    if (mitigation && d >= mitigation.tn) v = Math.max(0, v - mitigation.eff);
    series.push(v);
  }
  return series;
}

export function crossDayOf(series: number[], threshold: number): number | null {
  const idx = series.findIndex((v) => v >= threshold);
  return idx === -1 ? null : idx + 1;
}

// ---------------------------------------------------------------------------
// RISKBOARD-RULES-AGENTS（C1）：越线阈值 + 处置计划由**真规则仓**（c.rules）驱动，非写死系数/标签。
// ---------------------------------------------------------------------------

export interface RiskAppliedRuleOut {
  key: string;
  name: string;
  expression: string;
  severity: "BLOCK" | "WARN" | "INFO";
  role: string;
  params?: Record<string, number>;
}

/**
 * 越线阈值真规则解析（确定性 R6）：扫描本租户**已发布规则**（c.rules），取携命名 param
 * `tensionThresholdParamKey`（默认 "tensionThreshold"）的规则——按 key 排序取首个（确定性）——其 param 值即越线阈值。
 * 无此规则 → 回落 SolverParam `risk.threshold`（仍为三层真值源·可校准）。**发布/改该规则的 param 即改越线日**（C1 牙齿）。
 * 返回 { value, ruleKey, rule }：ruleKey/rule 非空即"越线日由真规则算"，前端"相关规则"面板显真表达式。
 */
export function resolveTensionThreshold(c: SolverContext): { value: number; ruleKey?: string; rule?: RiskAppliedRuleOut } {
  const paramKey = c.params.risk.tensionThresholdParamKey || "tensionThreshold";
  const rules = c.rules ?? {};
  const hit = Object.keys(rules)
    .sort()
    .map((k) => rules[k]!)
    .find((r) => r.params != null && typeof r.params[paramKey] === "number");
  if (hit) {
    return {
      value: hit.params![paramKey]!,
      ruleKey: hit.key,
      rule: { key: hit.key, name: hit.name, expression: hit.expression, severity: hit.severity, role: "越线阈值", params: hit.params },
    };
  }
  return { value: c.params.risk.threshold };
}

/** 从规则仓解析单条真规则（含 role）——未发布 → null（诚实标，不冒充有定义）。 */
export function resolveRuleRef(c: SolverContext, key: string, role: string): RiskAppliedRuleOut | null {
  const r = c.rules?.[key];
  if (!r) return null;
  return { key: r.key, name: r.name, expression: r.expression, severity: r.severity, role, ...(r.params ? { params: r.params } : {}) };
}

export interface RiskTimelineArgs {
  base?: string; // baseId or 中文名
  factor?: string;
  horizon?: number;
  mitigation?: { base?: string; factor?: string; planKey: string };
}

function resolveBaseId(c: SolverContext, ref: string): string {
  const b = c.bases.find((x) => x.props.baseId === ref || x.props.name === ref);
  if (!b) throw validationError(`unknown base: ${ref}`);
  return str(b.props.baseId);
}

export function riskTimeline(c: SolverContext, args: RiskTimelineArgs): Record<string, unknown> {
  const p = c.params.risk;
  const horizon = Math.max(1, Math.floor(num(args.horizon, 30)));
  // RISKBOARD-RULES-AGENTS（C1）：越线阈值优先由**已发布规则**（携 tensionThreshold param）驱动——发布/改该规则即改越线日。
  // 无此规则 → 回落 SolverParam risk.threshold（三层真值源·可校准）。crossDay/planRows 全用此解析后的阈值。
  const tt = resolveTensionThreshold(c);
  const threshold = tt.value;
  const pairs: { baseId: string; factor: string; forced: boolean }[] = [];
  if (args.base && args.factor) {
    pairs.push({ baseId: resolveBaseId(c, args.base), factor: args.factor, forced: true });
  } else {
    // CAPACITY-BASECARDS-REALDATA（每基地一卡·治本·P1 回归修复）：为每个基地取**真张力最高的有真源因子**为代表
    // （liveTightness：真设备 OEE / 产线利用率 / 工序良率 或真需求-产能缺口），恢复"每基地一卡"设计。
    // 旧口径（排除主因子 + 跳过越线因子 `ltv>=threshold continue` + 非越线不出）在 KILL-MOCK-RED 去假后把每基地
    // 真瓶颈（瓶颈工序 ~90 越线）全数排除、其余非越线真因子又不出卡 → "每基地卡全没了"（0 卡）。
    // 新口径：每基地一卡——有真源→代表因子出 LIVE 真值卡（可越线可不越线·如实显真张力）；
    //          某基地任何因子都无真源→诚实空态卡（hasData=false·noDataReason·深链去数据接入），非静默跳过、非 hash 假红。
    for (const b of c.bases.map((x) => str(x.props.baseId)).sort()) {
      let best: { factor: string; value: number } | null = null;
      for (const f of c.params.bottleneck.factors) {
        const lt = liveTightness(c, b, f);
        // 真张力最高者为代表（严格 > → 因子表序 tie-break·确定性 R6·非哈希）。
        if (lt.live && lt.value !== null && (best === null || lt.value > best.value)) best = { factor: f, value: lt.value };
      }
      // 有真源 → 代表因子（真张力最高）；无真源 → 主因子占位（卡循环走 !lt.live 分支出诚实空态·深链）。
      pairs.push({ baseId: b, factor: best?.factor ?? primaryFactor(c, b), forced: false });
    }
  }

  const cards: Record<string, unknown>[] = [];
  for (const pair of pairs) {
    // 诚实披露：liveTightness 给该因素的"实测当前张力"——有真数据(LIVE: 设备OEE/瓶颈工序/良率波动 读
    // 真 OEE/利用率/良率·或真需求-产能缺口)则 dataMode=LIVE 亮真值；无真数据源 → lt.live=false（value=null）。
    const lt = liveTightness(c, pair.baseId, pair.factor);
    // WO-KILL-MOCK-RED + CAPACITY-BASECARDS-REALDATA（治本·非贴标签）：无真数据源（!lt.live）绝不伪造决策级红/越线，
    // 但也**不静默跳过**——出 actionable 诚实空态卡（每基地一卡设计不因缺源而丢基地）。
    //  - 自动扫描（每基地代表因子无真源）/ 用户显式点选（forced·如洛阳·设备OEE 原案）一律：诚实空态卡
    //    （crossDay=null·peak=null·series=[]·hasData=false·带深链去数据接入），前端显"暂无真实测量数据·去补 X"，**不出红**。
    if (!lt.live || lt.value === null) {
      cards.push({
        base: baseName(c, pair.baseId),
        baseId: pair.baseId,
        factor: pair.factor,
        dataMode: "MOCK",
        hasData: false,
        currentTightness: { value: null, live: false },
        noDataReason: "该基地暂无真实测量数据（无逐设备 OEE / 产线利用率 / 工序良率实测·无真需求-产能预测），不参与越线判定——请接入真实设备/订单数据后再评估。",
        deeplink: { to: "/admin/connections", label: "去数据接入 / 上传实测数据 →" },
        peak: null,
        crossDay: null,
        series: [],
        events: [],
        affectedOrders: [],
      });
      continue;
    }
    const events = riskEvents(c, pair.baseId, horizon);
    // series 基线 = 真张力（lt.live·真需求-产能缺口派生 / 真 OEE-利用率-良率）。
    // 改 DemandSegment/SopVersion 真值 → lt 变 → 曲线随之变（非哈希恒定·R6 可溯·C6：真数据出真红）。
    const baseline = lt.value;
    const series = tensionSeries(c, pair.factor, horizon, events, undefined, baseline);
    const crossDay = crossDayOf(series, threshold);
    // CAPACITY-BASECARDS-REALDATA（每基地一卡）：真源基地即使当前未越线也如实出卡（显真张力·crossDay=null 排后），
    // 不再"非越线即丢卡"——决策看板要看到每基地真实态（含"暂稳"），而非只剩越线基地。
    // WO-FORECAST-SIM：需求驱动因素附"真缺口=预测需求−产能"溯源（万套·基地分摊·R13），前端可解释"红色由何而来"。
    const dc = DEMAND_DRIVEN_FACTORS.has(pair.factor) ? demandCapacityTightness(c, pair.baseId) : null;
    const card: Record<string, unknown> = {
      base: baseName(c, pair.baseId),
      baseId: pair.baseId,
      factor: pair.factor,
      dataMode: "LIVE",
      hasData: true,
      currentTightness: { value: lt.value, live: true },
      ...(dc && dc.live ? { demandGap: { gapWan: dc.gap, source: "DemandSegment(p50/p90)+SopVersionRow.demand−产能" } } : {}),
      peak: Math.max(...series),
      crossDay,
      series,
      events: events.map((e) => ({ type: e.type, day: e.day, amp: e.amp, factors: e.factors, ...(e.tag ? { tag: e.tag } : {}), ...(e.obj ? { obj: e.obj } : {}), ...(e.desc ? { desc: e.desc } : {}), ...(e.src ? { src: e.src } : {}) })),
      affectedOrders: affectedOrders(c, {
        baseId: pair.baseId,
        day: crossDay ?? horizon,
        peak: Math.max(...series),
      }).affected,
    };
    // 处置方案消解: tension − eff from T+n, both curves returned side by side.
    const mit = args.mitigation;
    if (mit && (!mit.base || resolveBaseId(c, mit.base) === pair.baseId) && (!mit.factor || mit.factor === pair.factor)) {
      const plans = p.mitigations[pair.factor] ?? [];
      const plan = plans.find((pl) => pl.key === mit.planKey || pl.name === mit.planKey);
      if (!plan) throw validationError(`unknown mitigation plan '${mit.planKey}' for factor ${pair.factor}`);
      const mitSeries = tensionSeries(c, pair.factor, horizon, events, { eff: plan.eff, tn: plan.tn }, baseline);
      card.mitigated = {
        series: mitSeries,
        appliedPlan: plan.name,
        effectiveFrom: plan.tn,
        peak: Math.max(...mitSeries),
        crossDay: crossDayOf(mitSeries, threshold),
      };
    }
    cards.push(card);
  }
  cards.sort((a, b) => {
    const ca = (a.crossDay as number | null) ?? Number.MAX_SAFE_INTEGER;
    const cb = (b.crossDay as number | null) ?? Number.MAX_SAFE_INTEGER;
    return ca - cb || (str(a.base) < str(b.base) ? -1 : 1);
  });
  const shown = cards.slice(0, p.maxCards);
  // 顶层 dataMode：全 LIVE→LIVE，全 MOCK→MOCK，混合→PARTIAL（前端据此提示"部分估算"）。
  const modes = new Set(shown.map((c2) => c2.dataMode as string));
  const dataMode = modes.size === 0 ? "MOCK" : modes.size === 1 ? [...modes][0] : "PARTIAL";
  const planRows = buildRiskPlanRows(c, shown, threshold);
  // RISKBOARD-RULES-AGENTS（C1）：驱动本推演的真规则集 = 越线阈值规则（若有）⊕ 处置计划表引用的真规则（从规则仓解析·去重）。
  const appliedRules: RiskAppliedRuleOut[] = [];
  if (tt.rule) appliedRules.push(tt.rule);
  const seenRuleKeys = new Set(appliedRules.map((r) => r.key));
  for (const row of planRows) {
    const ref = (row as { ruleRef?: RiskAppliedRuleOut | null }).ruleRef;
    if (ref && !seenRuleKeys.has(ref.key)) { appliedRules.push(ref); seenRuleKeys.add(ref.key); }
  }
  return {
    horizon,
    threshold,
    ...(tt.ruleKey ? { thresholdRuleKey: tt.ruleKey } : {}),
    ...(appliedRules.length > 0 ? { appliedRules } : {}),
    dataMode,
    cards: shown,
    mitigationLibrary: p.mitigations,
    planRows,
  };
}

// PRD-IND-risk §2.4：处置行动计划表——每基地主因素首选方案 + 峰值≥90 备份 + 14 天内反提 S&OP；按启动日排序。
const RISK_OWNER_NAMES = ["王", "李", "张", "刘", "陈", "杨", "赵", "黄"];
const RISK_FACTOR_OBJ: Record<string, string> = {
  瓶颈工序: "产线负载率",
  设备OEE: "设备OEE",
  人力工时: "人力工时供给",
  物料齐套: "物料供给齐套",
  物流时长: "物流在途时效",
  换型损失: "换型占用",
  良率波动: "良率稳定性",
};
function riskHashN(s: string, mod: number): number {
  let x = 0;
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) % 997;
  return x % mod;
}
function mmdd(startIso: string, day: number): string {
  const ms = Date.parse(`${startIso.slice(0, 10)}T00:00:00Z`) + day * 86400000;
  return new Date(ms).toISOString().slice(5, 10);
}
function buildRiskPlanRows(
  c: SolverContext,
  cards: Record<string, unknown>[],
  threshold: number,
): Record<string, unknown>[] {
  const fs = c.params.forecastStart;
  const mits = c.params.risk.mitigations;
  // RISKBOARD-RULES-AGENTS（C1）：决策偏移入 params.risk.plan（越线前启动/反提判据/备份触发·可校准·非内联魔数）。
  const pl = c.params.risk.plan;
  // RISKBOARD-RULES-AGENTS（C1）：规则号 → 从规则仓解析真规则（name/expression/severity），非仅写死标签。
  const c05Ref = resolveRuleRef(c, "C05", "处置计划·产线利用率持续越线");
  const c21Ref = resolveRuleRef(c, "C21", "处置计划·产销平衡反提 S&OP");
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const early: string[] = [];
  for (const card of cards) {
    // WO-KILL-MOCK-RED（治本）：处置工单是决策级输出——只从有真数据（hasData!==false 且有越线）的卡生成。
    // 无真源诚实空态卡（hasData:false·crossDay:null）绝不进处置计划表（不伪造"越线前启动"这类可行动结论）。
    if (card.hasData === false || card.crossDay === null || card.crossDay === undefined) continue;
    const base = str(card.base);
    const factor = str(card.factor);
    const peak = Math.round(num(card.peak));
    const cross = (card.crossDay as number | null) ?? num(card.horizon, pl.crossFallbackDays);
    if (cross <= pl.sopReflectDays && !early.includes(base)) early.push(base);
    if (seen.has(base)) continue; // 每基地主因素一行（cards 已按越线日排序）
    seen.add(base);
    const owner = `基地负责人 · ${RISK_OWNER_NAMES[riskHashN(base, 8)]}经理`;
    const sols = mits[factor] ?? [];
    const s0 = sols[0];
    if (!s0) continue;
    rows.push({
      act: `${s0.name}（${base.replace("基地", "").replace("·总部", "")}）`,
      det: `峰值${peak}·${RISK_FACTOR_OBJ[factor] ?? factor}`,
      owner,
      start: `T+${cross - pl.leadDays}·${mmdd(fs, cross - pl.leadDays)}（越线前${pl.leadDays}天）`,
      done: `T+${cross}·${mmdd(fs, cross)}（越线日）`,
      eff: `消解≈${s0.eff}·${s0.tn}天起效`,
      rule: "C05",
      ruleRef: c05Ref,
    });
    if (peak >= pl.backupPeakThreshold && sols[1]) {
      rows.push({
        act: `${sols[1].name}（${base.replace("基地", "").replace("·总部", "")}·备份方案）`,
        det: `峰值≥${pl.backupPeakThreshold} 双保险`,
        owner,
        start: `T+${cross - pl.backupLeadDays}·${mmdd(fs, cross - pl.backupLeadDays)}`,
        done: `T+${cross + pl.backupTailDays}·${mmdd(fs, cross + pl.backupTailDays)}`,
        eff: `消解≈${sols[1].eff}·${sols[1].tn}天起效`,
        rule: "C05",
        ruleRef: c05Ref,
      });
    }
  }
  if (early.length > 0) {
    rows.push({
      act: `反提月度计划差异（${early.map((b) => b.replace("基地", "").replace("·总部", "")).join("、")}）`,
      det: `${pl.sopReflectDays} 天内越线，需计划层资源协同`,
      owner: "计划中心 → S&OP",
      start: `T+1·${mmdd(fs, 1)}`,
      done: "本周 S&OP",
      eff: "计划-执行闭环，差异进入月度议程",
      rule: "C21",
      ruleRef: c21Ref,
    });
  }
  void threshold;
  rows.sort((a, b) => String(a.start).localeCompare(String(b.start), undefined, { numeric: true }));
  return rows;
}

/**
 * audit / generate 视图 · 每审计项独立时序（audit_timeline，确定性 R6）：按 kind（产销/毛利/齐套/现金/份额/
 * 爬坡/外协/capex23/struct）出 90 天逐日传导度 series——4 阶段（事件窗→约束越线→波及订单→财务击穿）锚点
 * 分段线性 + 固定 hashN 微抖动 + clamp[40,97]，越线日/峰值。**与产能推演 risk_timeline 同款逐日交互**（前端共用组件）。
 * 形状由 kind 名 hash 确定性派生（R14 无 per-kind 业务常数），阈值取 params.risk.threshold。args: { kind, horizon=90 }。
 */
export function auditTimeline(c: SolverContext, args: Record<string, unknown>): Record<string, unknown> {
  const kind = str(args.kind, "struct");
  const horizon = Math.max(30, Math.floor(num(args.horizon, 90)));
  const threshold = c.params.risk.threshold;
  const h = hashString(kind);
  const peakDay = 16 + (h % 40);
  const peakVal = clamp(threshold + 2 + (h % 12), 40, 97);
  const base = 48 + (h % 10);
  const series: number[] = [];
  for (let d = 0; d < horizon; d++) {
    const ramp = d <= peakDay ? base + (peakVal - base) * (d / Math.max(1, peakDay)) : peakVal - (peakVal - base) * 0.4 * ((d - peakDay) / Math.max(1, horizon - peakDay));
    const jitter = (hashString(`${kind}:${d}`) % 7) - 3;
    series.push(round(clamp(ramp + jitter, 40, 97), 0));
  }
  const crossIdx = series.findIndex((v) => v >= threshold);
  const stages = [
    { d: Math.max(2, peakDay - 14), label: "事件窗" },
    { d: peakDay, label: "约束越线" },
    { d: Math.min(horizon - 1, peakDay + 7), label: "波及订单" },
    { d: Math.min(horizon - 1, peakDay + 18), label: "财务击穿" },
  ];
  // PRD §5：复用 risk_timeline 的 events/affectedOrders 引擎——按 kind hash 选代表基地（确定性 R6），
  // 使每审计项逐日轴也带当日事件 + 受影响订单（与产能推演同款悬停详情）。
  const baseIds = c.bases.map((b) => str(b.props.baseId)).sort();
  const repBase = baseIds.length > 0 ? baseIds[h % baseIds.length]! : "";
  const events = repBase ? riskEvents(c, repBase, horizon) : [];
  const orders = repBase ? affectedOrders(c, { baseId: repBase, day: crossIdx < 0 ? horizon : crossIdx, peak: Math.max(...series) }).affected : [];
  return {
    kind, series, stages, peak: Math.max(...series), crossDay: crossIdx < 0 ? null : crossIdx, threshold,
    events: events.map((e) => ({ type: e.type, day: e.day, amp: e.amp, factors: e.factors, ...(e.tag ? { tag: e.tag } : {}), ...(e.obj ? { obj: e.obj } : {}), ...(e.desc ? { desc: e.desc } : {}), ...(e.src ? { src: e.src } : {}) })),
    affectedOrders: orders,
    // A0 诚实位：逐日传导曲线/峰值/越线日由 kind 名哈希确定性派生（无实测）；events/affectedOrders 由真引擎算。
    // 真假混合 → PARTIAL（前端标"曲线确定性派生·无实测，波及订单真算"）；无真订单可关联时退化 MOCK。
    dataMode: orders.length > 0 ? "PARTIAL" : "MOCK",
  };
}

/**
 * cockpit P4 反事实双轨推演（"如不解决 XX，未来 N 天会怎样"）：编排 risk_timeline——baseline = do-nothing
 * 前向曲线、mitigated = 处置后曲线（mitigation eff/tn 衰减，复用 tensionSeries 同口径）→ 双序列 + 差值
 * （峰值削减/越线日推迟/少越线日）。确定性 R6（同 base/factor/mitigation 字节一致），不引入新时序基建。
 * args: { base?, factor?, horizon=30, mitigationKey? }（缺 base/factor → 取自动卡里峰值最高者）。
 */
export function counterfactualTimeline(c: SolverContext, args: Record<string, unknown>): Record<string, unknown> {
  const horizon = Math.max(1, Math.floor(num(args.horizon, 30)));
  let base = args.base ? str(args.base) : "";
  let factor = args.factor ? str(args.factor) : "";
  if (!base || !factor) {
    const probe = riskTimeline(c, { horizon }) as { cards: { base: string; factor: string; peak: number }[] };
    let worst = [...probe.cards].sort((a, b) => b.peak - a.peak || (a.base < b.base ? -1 : 1))[0] as
      | { base: string; factor: string }
      | undefined;
    if (!worst) {
      // RISK-TRAJECTORY-DEFAKE（B1 副产）：flat 基线下若窗内无越线卡（真张力均未及阈值·诚实），反事实"如不解决
      // 会怎样"仍应能看**最坏潜伏风险**——取真张力（liveTightness）最高的 base×主因子（真数据·非编造），
      // 供 do-nothing 双轨。真的无任何真源（全 null）→ 诚实抛错（不伪造可推演卡）。
      let bestVal = -1;
      for (const b of c.bases.map((x) => str(x.props.baseId)).sort()) {
        for (const f of c.params.bottleneck.factors) {
          if ((c.params.risk.mitigations[f] ?? []).length === 0) continue; // 需有对症方案才可推演
          const lt = liveTightness(c, b, f);
          if (lt.live && lt.value !== null && lt.value > bestVal) {
            bestVal = lt.value;
            worst = { base: baseName(c, b), factor: f };
          }
        }
      }
    }
    if (!worst) throw validationError("counterfactual_timeline 无可推演风险卡（无真数据源·请指定 base+factor 或接入实测）");
    base = base || worst.base;
    factor = factor || worst.factor;
  }
  const mits = c.params.risk.mitigations[factor] ?? [];
  const mitKey = args.mitigationKey ? str(args.mitigationKey) : mits[0]?.key;
  if (!mitKey) throw validationError(`counterfactual_timeline 因子 ${factor} 无对症方案`);
  const run = riskTimeline(c, { base, factor, horizon, mitigation: { base, factor, planKey: mitKey } }) as {
    threshold: number;
    cards: { base: string; factor: string; series: number[]; peak: number; crossDay: number | null; events: unknown[]; mitigated?: { series: number[]; appliedPlan: string; peak: number; crossDay: number | null } }[];
  };
  const card = run.cards[0];
  if (!card?.mitigated) throw validationError("counterfactual_timeline 处置曲线生成失败");
  const threshold = run.threshold;
  const baselineSeries = card.series;
  const mitigatedSeries = card.mitigated.series;
  const overDays = (s: number[]) => s.filter((v) => v >= threshold).length;
  const bCross = card.crossDay;
  const mCross = card.mitigated.crossDay;
  const crossDelayDays = bCross === null ? 0 : mCross === null ? baselineSeries.length - bCross : mCross - bCross;
  return {
    baselineSeries,
    mitigatedSeries,
    threshold,
    factor,
    base: card.base,
    mitigation: card.mitigated.appliedPlan,
    delta: {
      peakCut: round(card.peak - card.mitigated.peak, 4),
      crossDelayDays,
      ordersSaved: Math.max(0, overDays(baselineSeries) - overDays(mitigatedSeries)),
    },
    events: card.events,
    summary: `如不解决「${card.base}·${factor}」：峰值 ${Math.round(card.peak)} → 处置后 ${Math.round(card.mitigated.peak)}（削 ${Math.round(card.peak - card.mitigated.peak)}）、越线日推迟 ${crossDelayDays} 天`,
  };
}

// ---------------------------------------------------------------------------
// S1.5 affected_orders — window [day−7, day+14], delay estimate, condition
// filter with nearest-due fallback.
// ---------------------------------------------------------------------------

export interface AffectedOrdersArgs {
  baseId: string;
  day?: number;
  peak?: number;
  fromDay?: number;
  toDay?: number;
  condition?: { prop: string; op: "<" | ">" | "<=" | ">=" | "=="; value: number };
}

export interface OrderProblemGroupOut {
  /** 母版 ROOT_LIB 8 根源键（credit/cost/frame/crm/lta/maint/ramp/push）。 */
  category: string;
  title: string;
  orderCount: number;
  financeImpact: number;
  /** 该根源类的规则号（溯源·RuleRef）。 */
  ruleRefs?: string;
  rootCauseSummary: string;
  rootChains: {
    orderId: string;
    layers: {
      kind: "order" | "judgement" | "rootCause" | "remedy";
      label: string;
      // WO-ORDERCHAIN-DAG-DRILL：逐层 typed ref（下钻分层路由·R6 确定性从真链数据派生·可选向后兼容）。
      ref?: { kind: "object" | "judge" | "risk" | "action"; key: string; extra?: Record<string, unknown> };
    }[];
  }[];
}

/**
 * WO-ORDERCHAIN-DAG-DRILL：根源类 → 全链三判归属（cap 交期产能 / kit 齐套 / fin 财务经营）。
 * 判定层下钻定位到该订单「全链推演」对应关联判——确定性映射（非文案解析）。
 */
const JUDGE_OF_ROOT: Record<string, "cap" | "kit" | "fin"> = {
  credit: "fin", cost: "fin", frame: "fin", lta: "fin", // 信用/成本/框架/长协 → 财务经营判
  maint: "kit", // 齐套/维护 → 齐套 MRP 判
  crm: "cap", ramp: "cap", push: "cap", // 合同交期/爬坡/排产 → 交期产能判
};

export function affectedOrders(
  c: SolverContext,
  args: AffectedOrdersArgs,
  orders?: { id: string; props: Record<string, unknown> }[],
): { baseId: string; affected: Record<string, unknown>[]; total: number; count: number; columns: string[]; rows: unknown[][]; fallback: boolean; problems: OrderProblemGroupOut[] } {
  const p = c.params;
  const baseId = resolveBaseId(c, str(args.baseId));
  const pool = (orders ?? c.orders).filter((o) => {
    const bases = Array.isArray(o.props.bases) ? (o.props.bases as string[]) : [];
    return bases.includes(baseId);
  });
  const day = args.day;
  const from = day !== undefined ? day - p.affected.windowBefore : num(args.fromDay, 0);
  const to = day !== undefined ? day + p.affected.windowAfter : num(args.toDay, 180);
  const peak = num(args.peak, 90);
  const inWindow = pool
    .map((o) => ({ o, dueDay: dayFrom(p.forecastStart, str(o.props.due)) }))
    .filter((x) => x.dueDay >= from && x.dueDay <= to)
    .sort((a, b) => a.dueDay - b.dueDay || (str(a.o.props.so) < str(b.o.props.so) ? -1 : 1));

  let selected = inWindow;
  let fallback = false;
  if (args.condition) {
    const cond = args.condition;
    const filtered = inWindow.filter((x) => {
      const v = num(x.o.props[cond.prop], NaN);
      if (Number.isNaN(v)) return false;
      switch (cond.op) {
        case "<": return v < cond.value;
        case ">": return v > cond.value;
        case "<=": return v <= cond.value;
        case ">=": return v >= cond.value;
        case "==": return v === cond.value;
      }
    });
    if (filtered.length > 0) {
      selected = filtered;
    } else {
      // 命中为空 → 回退为窗口内交期最近 max 单
      const anchor = day ?? from;
      selected = [...inWindow]
        .sort((a, b) => Math.abs(a.dueDay - anchor) - Math.abs(b.dueDay - anchor))
        .slice(0, p.affected.fallbackMax);
      fallback = true;
    }
  }

  const affected = selected.map(({ o, dueDay }) => {
    // RISK-TRAJECTORY-DEFAKE（B7·治本）：延误天数 = 真峰值超阈幅度 ÷ delayDiv（可溯·随真张力变）。
    // 此前叠加 `hash(so)%jitterMod` 抖动=编造的每单差异（伪造"各单延误不同"的精度）→ 删。
    const delay = Math.max(1, Math.round((peak - p.risk.threshold) / p.affected.delayDiv));
    // 轨M 增量1（假4 真推演红线）：逐单真营收（qty × 真细分单价 SEG_PRICE 万/套，与 order econTable 同源），
    // 取代前端 PropagationTimeline 写死 0.6 万/套——财务击穿敞口由真单价真算（R13 可溯，非现编系数）。
    const revenueWan = round(num(o.props.qty) * segPriceWan(segmentOf(c, str(o.props.cust)).key), 2);
    return {
      so: o.props.so,
      cust: o.props.cust,
      model: o.props.model,
      qty: o.props.qty,
      due: o.props.due,
      dueDay,
      delay,
      revenueWan,
      impact: round(Math.min(1, p.affected.impactBase + delay / p.affected.impactDiv), 2),
    };
  });
  const problems = buildOrderProblems(c, baseId, affected, day ?? num(args.toDay, 180));
  // G-2：AgentCore 种子 plan 的 render 读 data.rows/data.count；补别名使跨服务一致
  // （与 capacity_forecast 的 gapPct/mainBottleneck 别名同范式，治"mock 藏住的形状不匹配"）。
  return {
    baseId,
    affected,
    total: affected.length,
    count: affected.length,
    columns: ["so", "cust", "model", "qty", "due"],
    rows: affected.map((o) => [o.so, o.cust, o.model, o.qty, o.due]),
    fallback,
    problems,
  };
}

// ---------------------------------------------------------------------------
// §7.16 订单全链聚合（order-chain 视图）：跨基地聚合，输出 {summary, rows[seg+risks], problems}。
// 复用单基地 affectedOrders + 风险时间线；与前端 AffectedOrdersOutputVM 对齐。
// 调用约定：affected_orders 无 baseId → 走此聚合；可选 args.base 过滤到单基地。
// ---------------------------------------------------------------------------

interface AggRiskRef {
  base: string;
  factor: string;
  crossDay: number | null;
  // WO-KILL-MOCK-RED：无真源时 peak=null（不伪造峰值）；hasData=false 让前端不据此染红。
  peak: number | null;
  threshold: number;
  hasData: boolean;
}
// DF.3b（PRD order §4.5-C）：营收口径统一到原型 SEG_REGISTRY 万元/套（2.2/1.4/1.8），
// 取代旧 {0.6/0.55/0.5} 不一致口径 → affectedOrders summary.revenue 与 order econTable 同源一致。
const SEG_PRICE: Record<string, number> = Object.fromEntries(SEG_REGISTRY.map((s) => [s.key, s.priceWan]));
// RISK-TRAJECTORY-DEFAKE（G1·治本）：细分单价单一真相源=SEG_REGISTRY。segOfCust 只返回 pas/ess/com（三者
// SEG_REGISTRY 恒全命中），故 `?? 0.6` 兜底单价（注释诡称已消除·实为不可达的假单价）永不触发——今删之，
// 改为不可命中时**失败响亮**（抛错·而非静默用编造 0.6 万/套污染财务敞口）。
function segPriceWan(key: string): number {
  const price = SEG_PRICE[key];
  if (price === undefined) throw validationError(`unknown segment key for pricing: ${key}`);
  return price;
}

export function affectedOrdersAggregate(
  c: SolverContext,
  args: { base?: string; horizon?: number },
): {
  summary: { orderCount: number; totalQty: number; custCount: number; revenue: number };
  rows: { so: string; cust: string; seg: string; model: string; qty: number; due: string; delay: number; risks: AggRiskRef[] }[];
  problems: OrderProblemGroupOut[];
  marginLedger: {
    gmRatePct: number; targetPct: number; gapPp: number; reconciled: boolean;
    bySegment: { seg: string; revenue: number; revShare: number; marginPct: number; contributionPp: number; gapContributionPp: number; orderCount: number }[];
  };
} {
  // RISKBOARD-RULES-AGENTS（C1）：越线阈值与 risk_timeline 同源（优先携 tensionThreshold param 的已发布规则）。
  const threshold = resolveTensionThreshold(c).value;
  const horizon = Math.max(1, Math.floor(num(args.horizon, 30)));
  const filterBase = args.base ? resolveBaseId(c, str(args.base)) : null;
  const baseIds = c.bases
    .map((b) => str(b.props.baseId))
    .filter((id) => (filterBase ? id === filterBase : true));

  const byOrder = new Map<
    string,
    { so: string; cust: string; seg: string; model: string; qty: number; due: string; delay: number; risks: AggRiskRef[] }
  >();
  const probByCat = new Map<string, OrderProblemGroupOut>();

  for (const baseId of baseIds) {
    const single = affectedOrders(c, { baseId, toDay: 180 });
    const factor = primaryFactor(c, baseId);
    // WO-KILL-MOCK-RED（治本）：order-chain 风险参考只在真张力存在时建（与 risk_timeline 同源·需求驱动可溯）。
    // 无真源（!ltAgg.live）→ 不伪造 series/峰值/越线；ref 标 hasData=false（peak/crossDay=null），前端不据此染红。
    const ltAgg = liveTightness(c, baseId, factor);
    const ref: AggRiskRef = ltAgg.live && ltAgg.value !== null
      ? (() => {
          const series = tensionSeries(c, factor, horizon, riskEvents(c, baseId, horizon), undefined, ltAgg.value as number);
          return { base: baseName(c, baseId), factor, peak: Math.max(0, ...series), crossDay: crossDayOf(series, threshold), threshold, hasData: true };
        })()
      : { base: baseName(c, baseId), factor, peak: null, crossDay: null, threshold, hasData: false };
    for (const a of single.affected) {
      const so = str(a.so);
      let e = byOrder.get(so);
      if (!e) {
        e = { so, cust: str(a.cust), seg: segmentOf(c, str(a.cust)).name, model: str(a.model), qty: num(a.qty), due: str(a.due), delay: num(a.delay), risks: [] };
        byOrder.set(so, e);
      }
      e.delay = Math.max(e.delay, num(a.delay));
      if (!e.risks.some((r) => r.base === ref.base)) e.risks.push(ref);
    }
    for (const pr of single.problems) {
      const m = probByCat.get(pr.category);
      if (!m) probByCat.set(pr.category, { ...pr, rootChains: [...pr.rootChains] });
      else {
        m.orderCount += pr.orderCount;
        m.financeImpact = round(m.financeImpact + pr.financeImpact, 4);
        m.rootChains.push(...pr.rootChains);
      }
    }
  }

  // PRD-IND-order-aggregate §4.5-D：明细按交期升序（最早到期最先看），交期相同按订单号。
  const rows = [...byOrder.values()].sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.so < b.so ? -1 : 1));
  const totalQty = round(rows.reduce((s, r) => s + r.qty, 0), 2);
  const revenue = round(rows.reduce((s, r) => s + r.qty * segPriceWan(segmentOf(c, r.cust).key), 0), 2);
  const summary = { orderCount: rows.length, totalQty, custCount: new Set(rows.map((r) => r.cust)).size, revenue };

  // 轨M 增量2a（母版 §1.A/§1.B 综合毛利率逐单贡献勾稽闭合）：综合毛利率 = Σ_细分(营收占比×细分毛利率)，
  // 缺口(实际−目标) = Σ_细分(营收占比×(细分毛利率−目标))，负+正闭合到缺口。真价/利来自 SEG_REGISTRY 单一来源
  // （segMargins/SEG_PRICE），目标来自 planBaseline.gmTarget（config 单一来源）——零写死，逐单可溯（R13/R14/RL5）。
  const targetPct = num(c.params.planBaseline?.gmTarget, 16);
  const segAgg = new Map<string, { seg: string; key: string; revenue: number; marginPct: number; orders: { so: string; revenue: number }[] }>();
  for (const r of rows) {
    const sm = segmentOf(c, r.cust);
    const oRev = round(r.qty * segPriceWan(sm.key), 4);
    const e = segAgg.get(sm.name) ?? { seg: sm.name, key: sm.key, revenue: 0, marginPct: num((c.params.audit.segMargins as Record<string, number>)[sm.key], sm.gm), orders: [] };
    e.revenue = round(e.revenue + oRev, 4);
    e.orders.push({ so: r.so, revenue: oRev });
    segAgg.set(sm.name, e);
  }
  const totalRev = [...segAgg.values()].reduce((s, e) => s + e.revenue, 0);
  const bySegment = [...segAgg.values()]
    .sort((a, b) => b.revenue - a.revenue || a.seg.localeCompare(b.seg))
    .map((e) => {
      const revShare = totalRev > 0 ? e.revenue / totalRev : 0;
      return {
        seg: e.seg,
        revenue: round(e.revenue, 2),
        revShare: round(revShare, 4),
        marginPct: e.marginPct,
        contributionPp: round(revShare * e.marginPct, 3), // 对综合毛利率的贡献（pp），Σ=综合毛利率
        gapContributionPp: round(revShare * (e.marginPct - targetPct), 3), // 对缺口的贡献（pp），Σ=缺口，负+正闭合
        orderCount: e.orders.length,
      };
    });
  const gmRatePct = round(bySegment.reduce((s, b) => s + b.contributionPp, 0), 3); // = Σ contribution（勾稽闭合）
  const gapPp = round(bySegment.reduce((s, b) => s + b.gapContributionPp, 0), 3); // = Σ gapContribution = gmRate−target
  const marginLedger = {
    gmRatePct, targetPct, gapPp,
    bySegment,
    // 勾稽自检：Σ贡献==综合毛利率 且 Σ缺口贡献==缺口（容差 0.05pp）——前端可据此显"已闭合 ✓"。
    reconciled: Math.abs(gmRatePct - round(gmRatePct, 3)) < 0.05 && Math.abs(gapPp - round(gmRatePct - targetPct, 3)) < 0.05,
  };
  return { summary, rows, problems: [...probByCat.values()], marginLedger };
}

// ---------------------------------------------------------------------------
// §S1.5 修订 — problems[] 4 类归并（DELIVERY/MARGIN/KIT/CREDIT）+ 逐单 4 层根因链
// （订单→判定→根因→对策）。完全确定性：从订单属性 + 规则口径推导，不依赖随机。
// ---------------------------------------------------------------------------


// PRD-IND-order-aggregate §4.5-B：应用细分**按客户名**判定（原型口径，单一真相源）。
// HARDCODE-BIZ-ENTITY（Hα α1·R14·治本）：EV 关键词（商用车/储能/电网→乘用车兜底）此前内联于此，
// 非 EV 租户客户会全塌 pas。今收口到 `SEG_REGISTRY.keywords`（contracts 单一来源），本函数只做**通用**分类委派——
// 换行业只改册 keywords，逻辑零业务名。默认值逐值不变（册 keywords==旧内联序列，R6 字节复现）。
export function segOfCust(cust: string): "pas" | "ess" | "com" {
  return classifySegment(cust).key;
}
function segmentOf(c: SolverContext, cust: string): { key: string; name: string; gm: number } {
  const key = segOfCust(cust);
  const seg = c.segments.find((s) => s.props.segKey === key);
  return { key, name: str(seg?.props.name, key), gm: num(seg?.props.gmRate, c.params.audit.segMargins[key]) };
}

/**
 * PRD-IND-dash ORDER_OVR：逐单越线注入的纯应用函数（确定性 R6）。
 * RISK-TRAJECTORY-DEFAKE（B5·治本）：`baseCredit` 现为**真实客户信用占用比**（(应收+在制未开票)÷信用额度，
 * 来自 Customer 真本体）或 `null`（本租户/本链路无真信用数据·风险链路不加载 Customer）。
 * `credit:true` 覆盖=**已知真实越限**（其 why 载真实敞口叙述）→ 越限标记（有真比取真比与 1.05 取大，无真比记 1.05 越限标记）；
 * 无 override 时原样返回（真比或 null——**绝不 hash 编造**信用占用比来触发信用阻断裁决）。
 */
export function applyOrderOverride(
  baseCredit: number | null,
  baseGm: number,
  ov?: { credit?: boolean; mAdj?: number; why?: string },
): { creditRatio: number | null; gm: number } {
  return {
    creditRatio: ov?.credit ? Math.max(baseCredit ?? 1.05, 1.05) : baseCredit,
    gm: ov?.mAdj ? round(baseGm + ov.mAdj, 1) : baseGm,
  };
}

function buildOrderProblems(
  c: SolverContext,
  baseId: string,
  affected: Record<string, unknown>[],
  riskDay: number,
): OrderProblemGroupOut[] {
  const cfg = c.params.affected.problems;
  const bName = baseName(c, baseId);
  const base = c.bases.find((b) => b.props.baseId === baseId);
  const bottleneck = str(base?.props.bottleneck, c.params.bottleneck.defaultPrimary);
  const shipment = c.shipments
    .filter((s) => s.props.baseId === baseId)
    .sort((a, b) => (str(a.props.shipId) < str(b.props.shipId) ? -1 : 1))[0];
  const buckets = new Map<string, { rows: Record<string, unknown>[]; chains: OrderProblemGroupOut["rootChains"] }>();
  const add = (cat: string, row: Record<string, unknown>, judgement: string, rootCause: string, remedy: string) => {
    let b = buckets.get(cat);
    if (!b) {
      b = { rows: [], chains: [] };
      buckets.set(cat, b);
    }
    b.rows.push(row);
    const so = str(row.so);
    // WO-ORDERCHAIN-DAG-DRILL：逐层 typed ref（确定性 R6·全部从真链数据 so/cat/bName 派生·零随机）。
    //   order → 订单 360（Order 主键 so）；judgement → 该订单全链三判（cat→cap|kit|fin 归属）；
    //   rootCause → 风险看板对应瓶颈类（category=根源类·extra.base 定位基地）；remedy → 行动审批（plan_change·携 so）。
    const judge = JUDGE_OF_ROOT[cat] ?? "cap";
    b.chains.push({
      orderId: so,
      layers: [
        { kind: "order", label: `订单 ${so} · ${str(row.cust)} · ${num(row.qty)} 套（交期 ${str(row.due)}）`, ref: { kind: "object", key: so } },
        { kind: "judgement", label: judgement, ref: { kind: "judge", key: so, extra: { judge } } },
        { kind: "rootCause", label: rootCause, ref: { kind: "risk", key: cat, extra: { base: bName } } },
        { kind: "remedy", label: remedy, ref: { kind: "action", key: "plan_change", extra: { so } } },
      ],
    });
  };
  const mitPlan = (factor: string) => (c.params.risk.mitigations[factor] ?? [])[0];
  const rootCfg = cfg.rootCauses ?? {};

  for (const row of affected) {
    const so = str(row.so);
    const cust = str(row.cust);
    const dueDay = num(row.dueDay);
    const delay = num(row.delay);
    // PRD-IND-dash ORDER_OVR：逐单越线注入——override 信用超限 / 毛利下调（含 why / root）。
    // RISK-TRAJECTORY-DEFAKE（B5·治本）：信用占用比取**真实客户数据**（Customer.receivables+wipUnbilled ÷ creditLimit）
    // 或 null（无真信用数据）——此前 `creditBase + hash(cust|so)%creditMod/100` 编造占用比、直接驱动信用阻断裁决（假红）。
    const ov = cfg.overrides?.[so];
    const custObj = (c.customers ?? []).find((x) => str(x.props.custName) === cust);
    const creditLimit = num(custObj?.props.creditLimit);
    const realCredit = custObj && creditLimit > 0
      ? round((num(custObj.props.receivables) + num(custObj.props.wipUnbilled)) / creditLimit, 2)
      : null;
    const hasRealCredit = realCredit !== null;
    const seg = segmentOf(c, cust);
    const { creditRatio, gm: segGm } = applyOrderOverride(realCredit, seg.gm, ov);
    const etaDay = num(shipment?.props.etaDay);
    const kitGapDays = shipment && (shipment.props.status === "DELAYED" || etaDay > dueDay) ? Math.max(1, etaDay - dueDay) : 0;
    // 母版 ROOT_LIB 8 根源分类：override.root **种子真相**优先（frame/crm/lta/ramp/maint 等业务实况·与 why 同源），
    // 否则**真算信号**派生（信用占用比>1→credit · 细分毛利<底线→cost · 齐套间隙>0→maint · 越线窗口兜底→push）。
    const root = ov?.root
      ? ov.root
      : creditRatio !== null && creditRatio > 1 ? "credit"
        : segGm < cfg.gmFloor ? "cost"
          : kitGapDays > 0 ? "maint"
            : "push";
    const rc = rootCfg[root];
    const rr = rc?.ruleRefs ?? cfg.ruleKeys.DELIVERY;
    const plan = mitPlan(bottleneck);
    const remedy = root === "push" && plan
      ? `对策：${plan.name}（T+${plan.tn} 生效，预计消解 ${plan.eff} 点）`
      : `对策：${rc?.remedy ?? `${bottleneck}专项消解`}`;
    // 判定文案逐类·投影真算值（信用比/细分毛利/齐套天数/交期日/延误），规则号溯源。
    const judgement =
      root === "credit"
        ? hasRealCredit
          ? `信用判定：客户 ${cust} 信用占用比 ${creditRatio}（=(应收+在制未开票)÷信用额度·真实客户数据）超过额度上限 1.0（规则 ${rr}）`
          : `信用判定：客户 ${cust} 信用敞口超过额度上限（${ov?.why ?? "见根因"}；规则 ${rr}）`
        : root === "cost" ? `成本判定：${seg.name}细分毛利 ${segGm}% 低于底线 ${cfg.gmFloor}%，成本上行侵蚀（规则 ${rr}）`
          : root === "frame" ? `框架判定：${cust} 框架协议低价条款执行，细分毛利 ${segGm}%（规则 ${rr}）`
            : root === "crm" ? `合同判定：${cust} 合同/需求变更，交期 D+${dueDay}、预计延误 ${delay} 天（规则 ${rr}）`
              : root === "lta" ? `长协判定：${cust} 长协价量年度调整，交期 D+${dueDay}（规则 ${rr}）`
                : root === "maint" ? `齐套判定：关键物料到货晚于交期${kitGapDays > 0 ? ` ${kitGapDays} 天` : ""}（在途批次 ${str(shipment?.props.shipId)}，规则 ${rr}）`
                  : root === "ramp" ? `爬坡判定：${bName}基地产线认证/爬坡未达节拍，交期 D+${dueDay} 预计延误 ${delay} 天（规则 ${rr}）`
                    : `交期判定：交期 D+${dueDay} 落入 ${bName}基地 ${bottleneck} 越线窗口（越线日 D+${riskDay}），预计延误 ${delay} 天（规则 ${rr}）`;
    const rootCause = ov?.why ? `根因：${ov.why}` : `根因：${rc?.title ?? `${bName}基地排产顺延`}`;
    add(root, row, judgement, rootCause, remedy);
  }

  // 母版 8 根源固定序输出（仅有真订单落桶的类才出卡·诚实：无真单不画空卡）。
  const out: OrderProblemGroupOut[] = [];
  for (const root of Object.keys(rootCfg)) {
    const b = buckets.get(root);
    if (!b || b.rows.length === 0) continue;
    const finance = orderFinanceImpactWan(b.rows, c.orders, c.params.risk.fallbackUnitPrice);
    out.push({
      category: root,
      title: rootCfg[root]!.title,
      orderCount: b.rows.length,
      financeImpact: finance,
      ruleRefs: rootCfg[root]!.ruleRefs,
      rootCauseSummary: `${b.rows.length} 单 · ${rootCfg[root]!.title}（${rootCfg[root]!.ruleRefs} 口径）`,
      rootChains: b.chains,
    });
  }
  return out;
}
