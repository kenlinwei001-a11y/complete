import type { ObjectInstance } from "../domain.js";
import { AppError } from "../errors.js";
import { round } from "../prng.js";
import { maintWeekOf, num, str, type SolverContext } from "./types.js";
// DF.13 外协红线单一来源（C08）：外协渠道上限/释放量禁内联裸阈值，一律经 outsourceRedlineCap 派生（R14·R-一致）。
import { outsourceRedlineCap } from "@platform/contracts";
// WO-SANDBOX-D4 ② · 库存「地点 × 时间序列」聚合层 + 水位带常数单一来源（超储/欠储倍数与本文件共用一份）。
// WO-SANDBOX-D4 ③ · 全链经营现金流「不可相加」登记（credit_exposure 端与 capex_scenario 端共用同一实现）。
import { INVENTORY_BAND, chainOperatingCashflow, inventoryLocationSeries, materialLocationRefs, purchaseOrderInbound, type InventoryInboundInput, type InventoryLocationRef } from "./aggregates.js";

/**
 * 锂电 20 场景目录 §2 —— 13 个新增求解器（成熟度 E6a）。
 *
 * 全部**确定性、args 驱动**（同输入同输出），公式逐条遵循目录 §2。设计为参照实现可双算
 * （进 VLE ⑤段）。本批让 /a/v1/solvers/:key/invoke 对 13 个 key 返回真实计算结果；
 * 把这些 args 从对象数据自动填充（GenSpec 扩展）是 E6b 后续。
 */

const COST_RANK: Record<string, number> = { 低: 1, 中: 2, 高: 3, 极高: 4 };

// S06 mitigation_select：方案库（7 因素 × 3 案，与合成 RISK_SOL 同源）。
const MITIGATION_LIB: Record<string, { key: string; name: string; eff: number; tn: number; cost: string }[]> = {
  物料齐套: [
    { key: "early_stock", name: "提前备料", eff: 12, tn: 2, cost: "中" },
    { key: "alt_supplier", name: "备选供应商切换", eff: 9, tn: 5, cost: "高" },
    { key: "air_freight", name: "空运补料", eff: 15, tn: 1, cost: "极高" },
  ],
  设备OEE: [
    { key: "preventive", name: "预防性维护前置", eff: 10, tn: 3, cost: "中" },
    { key: "spare_line", name: "备用产线切换", eff: 14, tn: 4, cost: "高" },
    { key: "vendor_support", name: "厂商驻场支持", eff: 8, tn: 2, cost: "中" },
  ],
  人力工时: [
    { key: "night_shift", name: "增开夜班", eff: 11, tn: 2, cost: "中" },
    { key: "temp_labor", name: "临时用工", eff: 8, tn: 3, cost: "中" },
    { key: "cross_train", name: "跨基地借调", eff: 9, tn: 5, cost: "低" },
  ],
  瓶颈工序: [
    { key: "debottleneck", name: "瓶颈工序扩容", eff: 13, tn: 6, cost: "高" },
    { key: "reroute", name: "工艺路线调整", eff: 9, tn: 3, cost: "中" },
    { key: "outsource_step", name: "工序外协", eff: 10, tn: 4, cost: "高" },
  ],
  物流: [
    { key: "pre_position", name: "前置仓备货", eff: 10, tn: 3, cost: "中" },
    { key: "dual_route", name: "双线路运输", eff: 8, tn: 2, cost: "中" },
    { key: "expedite", name: "加急运输", eff: 12, tn: 1, cost: "高" },
  ],
  换型: [
    { key: "smed", name: "快速换型改善", eff: 9, tn: 7, cost: "低" },
    { key: "batch_merge", name: "批次合并排产", eff: 7, tn: 2, cost: "低" },
    { key: "freeze_window", name: "冻结排产窗口", eff: 8, tn: 3, cost: "低" },
  ],
  良率: [
    { key: "spc_tighten", name: "SPC 管控收紧", eff: 8, tn: 4, cost: "低" },
    { key: "golden_batch", name: "黄金批次参数回滚", eff: 11, tn: 2, cost: "中" },
  ],
};

export function mitigationSelect(args: Record<string, unknown>) {
  const factor = str(args.factor);
  const baseName = str(args.baseName);
  const tightness = num(args.tightness, 85);
  // 优先用注入的 canonical 方案库（params.risk.mitigations，全因子名 + risk 字段，R14 单一来源）；
  // 直接单测无 context 时回落内置 MITIGATION_LIB（消除"风险卡全因子名 vs 方案库短名"接缝 G）。
  const injected = args.mitigations as Record<string, { key: string; name: string; eff: number; tn: number; cost: string; risk?: string }[]> | undefined;
  const lib = injected?.[factor] ?? MITIGATION_LIB[factor];
  if (!lib) {
    const factors = [...new Set([...Object.keys(injected ?? {}), ...Object.keys(MITIGATION_LIB)])];
    return { error: `unknown factor: ${factor}`, factors };
  }
  const urgency = Math.max(0, (tightness - 70) / 30);
  const scored = lib
    .map((p) => ({ ...p, costRank: COST_RANK[p.cost] ?? 2, score: round((p.eff * urgency) / ((COST_RANK[p.cost] ?? 2) * p.tn), 4) }))
    .sort((a, b) => b.score - a.score);
  const top = scored[0]!;
  return {
    factor,
    baseName,
    urgency: round(urgency, 4),
    plans: scored,
    recommended: top.key,
    draftPayload: { base: baseName, factor, planKey: top.key },
  };
}

// S07 cert_schedule：priority = 缺口贡献/认证工时；C26 并行 ≤ 工程师组数 贪心装箱到周。
export function certSchedule(args: Record<string, unknown>) {
  const items = (args.items as { model: string; line: string; status: string; certHours: number; gapContribution: number }[]) ?? [];
  const groups = num(args.engineerGroups, 3);
  const pending = items.filter((i) => i.status === "认证中" || i.status === "待认证");
  const ranked = pending
    .map((i) => ({ ...i, priority: round(i.gapContribution / Math.max(0.1, i.certHours), 4), weeks: Math.max(1, Math.ceil(i.certHours / 40)) }))
    .sort((a, b) => b.priority - a.priority);
  // 贪心装箱：每周并行 ≤ groups（C26）
  const weekLoad: number[] = [];
  const schedule = ranked.map((r) => {
    let w = 0;
    while ((weekLoad[w] ?? 0) >= groups) w++;
    const start = w + 1;
    for (let k = 0; k < r.weeks; k++) weekLoad[w + k] = (weekLoad[w + k] ?? 0) + 1;
    return { model: r.model, line: r.line, startWeek: start, finishWeek: start + r.weeks - 1, unlockCapacity: r.gapContribution, priority: r.priority };
  });
  return { schedule, engineerGroups: groups, ruleRefs: ["C26"] };
}

// S08 kit_readiness：齐套率 = min_物料((现库+ETA≤开工的在途)/(BOM单耗×qty))。
export function kitReadiness(args: Record<string, unknown>) {
  const orders = (args.orders as { orderId: string; qty: number; startDay: number; materials: { material: string; onHand: number; inTransit: { qty: number; etaDay: number }[]; bomUnit: number }[] }[]) ?? [];
  const rows = orders.map((o) => {
    const items = o.materials.map((m) => {
      const avail = m.onHand + m.inTransit.filter((t) => t.etaDay <= o.startDay).reduce((s, t) => s + t.qty, 0);
      const need = m.bomUnit * o.qty;
      const ratio = need <= 0 ? 1 : round(avail / need, 4);
      // 缺料时最早补齐日 = 开工日之后最早到货的在途批次 ETA
      const earliest = avail < need ? m.inTransit.filter((it) => it.etaDay > o.startDay).sort((a, b) => a.etaDay - b.etaDay)[0]?.etaDay : undefined;
      return { material: m.material, ratio, shortage: round(Math.max(0, need - avail), 4), earliestDay: earliest };
    });
    const kitRatio = items.length ? Math.min(...items.map((i) => i.ratio)) : 1;
    const shortItems = items.filter((i) => i.ratio < 1).sort((a, b) => (a.earliestDay ?? 1e9) - (b.earliestDay ?? 1e9));
    const advice = kitRatio >= 1 ? "齐套" : shortItems.some((i) => i.earliestDay === undefined) ? "加急采购" : "顺延";
    return { orderId: o.orderId, kitRatio: round(kitRatio, 4), shortItems, advice };
  });
  return { rows, shortageCount: rows.filter((r) => r.kitRatio < 1).length, ruleRefs: ["C06", "C16"] };
}

// S09 lta_gap：净需求 = 月需求×BOM − 库存 − 在途；现货缺口 = max(0, 净需求 − 长协可用)。
export function ltaGap(args: Record<string, unknown>) {
  const material = str(args.material);
  const month = str(args.month);
  const netDemand = round(num(args.monthDemand) * num(args.bomUnit, 1) - num(args.inventory) - num(args.inTransit), 4);
  const ltaAvailable = round(num(args.ltaAnnualLock) * num(args.monthQuota, 1 / 12) - num(args.executedThisMonth), 4);
  const gap = round(Math.max(0, netDemand - ltaAvailable), 4);
  const coverage = netDemand <= 0 ? 1 : round(Math.min(1, ltaAvailable / netDemand), 4);
  const leadDays = num(args.leadDays, 30);
  const po = gap > 0
    ? [
        { batch: round(gap / 2, 4), latestOrderLeadDays: leadDays },
        { batch: round(gap / 2, 4), latestOrderLeadDays: leadDays },
      ]
    : [];
  return { material, month, netDemand, coverage, gap, po, ruleRefs: ["C16", "C27"] };
}

// S10 inventory_optimize：目标水位 = 日均耗用×(交期+安全天5)；超储/欠储/呆滞/释放资金。
// WO-SANDBOX-D4 ②（加性）：+ locationSeries —— 快照之外补「地点 × 时间」两根轴，各自诚实标 dataMode
//   （时间轴由真 dailyUse/onHand/PurchaseOrder.etaDay 逐日投影 = OK；地点轴今日无真源 = EMPTY，见契约）。
//   水位带倍数（1.5/0.8）改走 INVENTORY_BAND 单一来源 —— 值逐字节不变，只是不再两处各写一份。
export function inventoryOptimize(args: Record<string, unknown>) {
  const materials = (args.materials as { matId: string; dailyUse: number; leadTime: number; onHand: number; unitPrice: number; idleDays: number }[]) ?? [];
  const safety = num(args.safetyDays, 5);
  const over: unknown[] = [];
  const under: unknown[] = [];
  const idle: unknown[] = [];
  let releasable = 0;
  for (const m of materials) {
    const target = m.dailyUse * (m.leadTime + safety);
    const overQty = Math.max(0, m.onHand - INVENTORY_BAND.overMult * target);
    const underQty = Math.max(0, INVENTORY_BAND.underMult * target - m.onHand);
    if (overQty > 0) {
      over.push({ matId: m.matId, overQty: round(overQty, 4), value: round(overQty * m.unitPrice, 2) });
      releasable += overQty * m.unitPrice;
    }
    if (underQty > 0) under.push({ matId: m.matId, underQty: round(underQty, 4) });
    if (m.idleDays > 90) idle.push({ matId: m.matId, idleDays: m.idleDays }); // C28
  }
  const locationSeries = inventoryLocationSeries({
    materials: materials.map((m) => ({ matId: m.matId, dailyUse: num(m.dailyUse), leadTime: num(m.leadTime), onHand: num(m.onHand) })),
    safetyDays: safety,
    horizonDays: Math.max(0, Math.floor(num(args.horizonDays, 30))),
    inbound: (args.inbound as InventoryInboundInput[] | undefined) ?? [],
    locations: (args.locations as InventoryLocationRef[] | undefined) ?? [],
  });
  return { over, under, idle, releasableCash: round(releasable, 2), locationSeries, ruleRefs: ["C16", "C28"] };
}

// S11 changeover_sequence：最近邻贪心，从当前在产型号起每步选换型时长最小的未排单。
export function changeoverSequence(args: Record<string, unknown>) {
  const lineId = str(args.lineId);
  const orders = (args.orders as { orderId: string; modelId: string; dueDay?: number }[]) ?? [];
  const matrix = (args.matrix as Record<string, Record<string, number>>) ?? {};
  let current = str(args.current, orders[0]?.modelId ?? "");
  const remaining = [...orders];
  const seq: { orderId: string; modelId: string; changeoverMin: number }[] = [];
  let total = 0;
  const ctOf = (from: string, to: string) => (from === to ? 0 : matrix[from]?.[to] ?? 999);
  while (remaining.length) {
    remaining.sort((a, b) => ctOf(current, a.modelId) - ctOf(current, b.modelId));
    const next = remaining.shift()!;
    const ct = current === next.modelId ? 0 : matrix[current]?.[next.modelId] ?? 0;
    total += ct;
    seq.push({ orderId: next.orderId, modelId: next.modelId, changeoverMin: ct });
    current = next.modelId;
  }
  // vs 交期序（按 dueDay 排）换型总时长
  const dueSeq = [...orders].sort((a, b) => (a.dueDay ?? 0) - (b.dueDay ?? 0));
  let dueTotal = 0;
  let cur2 = str(args.current, orders[0]?.modelId ?? "");
  for (const o of dueSeq) {
    dueTotal += cur2 === o.modelId ? 0 : matrix[cur2]?.[o.modelId] ?? 0;
    cur2 = o.modelId;
  }
  const infeasible = seq.filter((s) => {
    const o = orders.find((x) => x.orderId === s.orderId);
    return o?.dueDay !== undefined && o.dueDay < 0;
  });
  return { lineId, sequence: seq, totalChangeoverMin: total, savedVsDueMin: round(dueTotal - total, 4), infeasible, ruleRefs: ["C22", "C29"] };
}

// S12 yield_diagnosis：滑窗突变 = 首个 |后7日均 − 前7日均| > 2σ(前30日) 的日。
export function yieldDiagnosis(args: Record<string, unknown>) {
  const series = (args.series as { day: number; yield: number }[]) ?? [];
  const events = (args.events as { day: number; kind: string; source: string }[]) ?? [];
  // 诚实边界（假6·KILL-MOCK-RED·抄 capex 缺数不造假）：无逐日良率时序输入 → 不以写死序列冒充"找到 day33 突变"，
  // 返 dataMode:EMPTY + provenanceSynthetic 披露（SolverContext 无良率时序源）。接入真时序后喂真 series 才诊断。
  if (series.length === 0) {
    return { breakpoint: undefined, candidates: [], dataMode: "EMPTY", provenanceSynthetic: true, note: "无逐日良率时序输入（series 空）·无法诊断突变——不以写死序列冒充真算", ruleRefs: ["C30"] };
  }
  const sorted = [...series].sort((a, b) => a.day - b.day);
  let breakpoint: { day: number; drop: number } | undefined;
  for (let i = 30; i + 7 <= sorted.length; i++) {
    const prev30 = sorted.slice(i - 30, i).map((p) => p.yield);
    const prev7 = sorted.slice(i - 7, i).map((p) => p.yield);
    const post7 = sorted.slice(i, i + 7).map((p) => p.yield);
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const m30 = mean(prev30);
    const sd = Math.sqrt(prev30.reduce((s, x) => s + (x - m30) ** 2, 0) / prev30.length);
    const delta = Math.abs(mean(post7) - mean(prev7));
    if (delta > 2 * sd && sd > 0) {
      breakpoint = { day: sorted[i]!.day, drop: round(mean(prev7) - mean(post7), 4) };
      break;
    }
  }
  const candidates = breakpoint
    ? events
        .filter((e) => Math.abs(e.day - breakpoint!.day) <= 2)
        .map((e) => ({ ...e, distance: Math.abs(e.day - breakpoint!.day) }))
        .sort((a, b) => a.distance - b.distance)
    : [];
  return { breakpoint, candidates, dataMode: "LIVE", ruleRefs: ["C30"] };
}

// S13 maintenance_stagger：冲突=检修周∈交付高峰top3；±4 周内选负荷最低周；间隔≥26、同组同周≤3。
export function maintenanceStagger(args: Record<string, unknown>) {
  const bases = (args.bases as { base: string; group?: string; maintWeek: number; lastMaintWeek?: number; loadByWeek: Record<string, number> }[]) ?? [];
  const peakWeeks = (args.peakWeeks as number[]) ?? [];
  const peakSet = new Set(peakWeeks);
  const groupWeekCount: Record<string, number> = {};
  const adjustments: unknown[] = [];
  const unresolved: unknown[] = [];
  for (const b of bases) {
    if (!peakSet.has(b.maintWeek)) continue; // 无冲突
    let best: number | undefined;
    let bestLoad = Infinity;
    for (let w = b.maintWeek - 4; w <= b.maintWeek + 4; w++) {
      if (w < 1 || peakSet.has(w)) continue;
      if (b.lastMaintWeek !== undefined && w - b.lastMaintWeek < 26) continue; // 间隔约束
      if ((groupWeekCount[`${b.group}|${w}`] ?? 0) >= 3) continue; // 同组同周≤3
      const load = b.loadByWeek[String(w)] ?? 0;
      if (load < bestLoad) {
        bestLoad = load;
        best = w;
      }
    }
    if (best === undefined) unresolved.push({ base: b.base, maintWeek: b.maintWeek, reason: "±4 周内无满足约束的可行周" });
    else {
      groupWeekCount[`${b.group}|${best}`] = (groupWeekCount[`${b.group}|${best}`] ?? 0) + 1;
      adjustments.push({ base: b.base, fromWeek: b.maintWeek, toWeek: best, loadDrop: round((b.loadByWeek[String(b.maintWeek)] ?? 0) - bestLoad, 4) });
    }
  }
  // 诚实边界（假6·KILL-MOCK-RED）：自动派生输入（无真实逐周负荷/交付高峰时序源）时标 provenanceSynthetic —— 错峰建议为占位估算，不冒充真排程。
  const synthetic = args.provenanceSynthetic === true;
  return { adjustments, unresolved, ...(synthetic ? { dataMode: "MOCK", provenanceSynthetic: true, note: "无真实逐周负荷/交付高峰源（loadByWeek/peakWeeks 缺真时序）·错峰建议为占位估算" } : {}), ruleRefs: ["C11"] };
}

// S14 outsourcing_split：三渠道 加班c1=1.0(上限gap×0.4)/外协c2=1.4(上限总需求×C08 红线)/延期c3=2.5。
// DF.13：外协上限 = 总需求 × OUTSOURCE_REDLINE.maxRatio —— 求解器分配天然贴着红线封顶，改红线即改分配。
export function outsourcingSplit(args: Record<string, unknown>) {
  const gap = num(args.gap);
  const totalDemand = num(args.totalDemand, gap);
  const channels = [
    { key: "overtime", name: "自产加班", unitCost: 1.0, cap: gap * 0.4 },
    { key: "outsource", name: "外协", unitCost: 1.4, cap: outsourceRedlineCap(totalDemand) }, // C08 红线（DF.13 单一来源）
    { key: "delay", name: "延期", unitCost: 2.5, cap: Infinity },
  ];
  let remaining = gap;
  let totalCost = 0;
  const allocation = channels.map((c) => {
    const qty = Math.max(0, Math.min(remaining, c.cap));
    remaining = round(remaining - qty, 4);
    totalCost += qty * c.unitCost;
    return { channel: c.key, name: c.name, qty: round(qty, 4), cost: round(qty * c.unitCost, 4) };
  });
  return {
    allocation,
    totalCost: round(totalCost, 4),
    savedVsAllDelay: round(gap * 2.5 - totalCost, 4),
    outsourceQualityGate: "C31：外协厂良率 ≥ 自产 −0.02",
    ruleRefs: ["C08", "C31"],
  };
}

// S15 quote_margin：BOM成本=Σ(单耗×现价×(1+加工费率))；毛利率=(价−BOM−制造费率×价−物流)/价。
export function quoteMargin(args: Record<string, unknown>) {
  const price = num(args.price);
  const bom = (args.bom as { unit: number; spotPrice: number; processRate?: number }[]) ?? [];
  const bomCost = round(bom.reduce((s, b) => s + b.unit * b.spotPrice * (1 + (b.processRate ?? 0)), 0), 4);
  const mfg = num(args.mfgRate) * price;
  const logistics = num(args.logistics);
  const margin = price <= 0 ? 0 : round((price - bomCost - mfg - logistics) / price, 4);
  const floor = num(args.segmentFloor, 0.1);
  return {
    margin,
    floor,
    diff: round(margin - floor, 4),
    verdict: margin >= floor + 0.01 ? "过线" : margin >= floor ? "触线" : "低于底线",
    breakdown: { bomCost, mfg: round(mfg, 4), logistics, price },
    ruleRefs: ["C15", "C24"],
  };
}

// S16 credit_exposure：敞口=应收+在产未开票；可用=额度−敞口；逾期 dueDate+30 未回（C32）。
// WO-SEAM-ARG-DROP（引擎半·诚实化）：透出 `scope`（客户维作用域）——CUSTOMER=定位到具体客户 / ALL=未指定客户的全域合计 /
//   EXPLICIT=调用方直传数值（无客户上下文）。让前端可见"这答案算的是谁"（R-ARG-FIDELITY），杜绝首客户静默冒充。
export function creditExposure(args: Record<string, unknown>) {
  const limit = num(args.creditLimit);
  const receivables = num(args.receivables);
  const wip = num(args.wipUnbilled);
  const exposure = round(receivables + wip, 2);
  const available = round(limit - exposure, 2);
  const overdue = (args.overdue as { invoiceId: string; overdueDays: number; amount: number }[]) ?? [];
  const hasOverdue = overdue.some((o) => o.overdueDays > 30); // C32
  const newOrder = num(args.newOrderAmount, 0);
  const verdict = hasOverdue ? "冻结（存在逾期>30天）" : newOrder <= available ? "可接" : "超出可用额度";
  const scope = (args.scope as Record<string, unknown> | undefined) ?? { mode: "EXPLICIT" };
  // WO-SANDBOX-D4 ③（加性）：敞口这一端也挂同一份「不可相加」登记 —— 与 capex_scenario 端**共用同一实现**
  // （`chainOperatingCashflow`），两侧结论逐字节一致，杜绝「投资侧说不能加、敞口侧没说」的半边真相。
  const chainCashflow = chainOperatingCashflow({
    capex: { available: false }, // 投资分量本次没取（capex_scenario 是另一个求解器）——不取到 ≠ 不存在
    credit: { available: true }, // 本次真算出了敞口存量
  });
  return { limit, exposure, available, exposureBreakdown: { receivables, wipUnbilled: wip }, overdue, newOrderVerdict: verdict, scope, chainCashflow, ruleRefs: ["C13", "C32"] };
}

// S19 quarterly_gap：对策按成本升序贪心覆盖季度缺口；残余缺口明示。
export function quarterlyGap(args: Record<string, unknown>) {
  const quarter = str(args.quarter);
  let gap = num(args.gap);
  const options = ((args.options as { key: string; name: string; release: number; costRank: number; scene?: string }[]) ?? [
    { key: "ramp", name: "提前爬坡", release: 0, costRank: 1, scene: "S07" },
    { key: "changeover", name: "换型优化", release: 0, costRank: 1, scene: "S11" },
    { key: "stagger", name: "错峰检修", release: 0, costRank: 1, scene: "S13" },
    { key: "outsource", name: "外协", release: 0, costRank: 2, scene: "S14" },
    { key: "defer", name: "顺延非战略单", release: 0, costRank: 3 },
  ]).sort((a, b) => a.costRank - b.costRank);
  const combo: unknown[] = [];
  for (const o of options) {
    if (gap <= 0) break;
    const use = Math.min(gap, o.release);
    if (use > 0) {
      combo.push({ key: o.key, name: o.name, release: round(use, 4), scene: o.scene });
      gap = round(gap - use, 4);
    }
  }
  return { quarter, combo, residualGap: round(Math.max(0, gap), 4), ruleRefs: ["C08", "C29"] };
}

/**
 * Phase6B 跨求解器编排器（meta-solver）：把多个求解器提供的「杠杆」按 成本档→单位成本 排序，
 * 贪心最小成本闭合产销缺口；每段产出标注来源求解器(solver/scene)，返回组合/残差/总成本/可行性。
 * 各杠杆可释放量(release)缺省按 gap 比例派生（编排时由对应求解器回填实算值）。确定性。
 */
type ComboLever = { key: string; solver: string; scene?: string; release: number; unitCost: number; costRank: number };
export function countermeasureCombo(args: Record<string, unknown>) {
  const gap = round(num(args.gap, 10), 4);
  const levers: ComboLever[] = (args.levers as ComboLever[]) ?? [
    { key: "cert_unlock", solver: "cert_schedule", scene: "S07", release: round(gap * 0.3, 4), unitCost: 0.5, costRank: 1 },
    { key: "changeover", solver: "changeover_sequence", scene: "S11", release: round(gap * 0.15, 4), unitCost: 0.6, costRank: 1 },
    { key: "stagger", solver: "maintenance_stagger", scene: "S13", release: round(gap * 0.1, 4), unitCost: 0.7, costRank: 2 },
    { key: "outsource", solver: "outsourcing_split", scene: "S14", release: round(outsourceRedlineCap(gap), 4), unitCost: 1.4, costRank: 2 }, // C08 外协上限（DF.13 单一来源）
    { key: "capex", solver: "capex_scenario", scene: "S17", release: round(gap * 0.5, 4), unitCost: 2.2, costRank: 3 },
  ];
  const sorted = [...levers].sort((a, b) => a.costRank - b.costRank || a.unitCost - b.unitCost);
  let remaining = gap;
  let totalCost = 0;
  const combo: Record<string, unknown>[] = [];
  for (const l of sorted) {
    if (remaining <= 0) break;
    const use = round(Math.min(remaining, l.release), 4);
    if (use > 0) {
      combo.push({ key: l.key, solver: l.solver, scene: l.scene, release: use, cost: round(use * l.unitCost, 4) });
      totalCost = round(totalCost + use * l.unitCost, 4);
      remaining = round(remaining - use, 4);
    }
  }
  return { gap, combo, residualGap: round(Math.max(0, remaining), 4), totalCost, feasible: remaining <= 0, ruleRefs: ["C08", "C23", "C29"] };
}

// S20 carbon_footprint：碳足迹 = Σ(物料单耗×碳因子) + Σ工序(单位能耗×电网因子(省))；对比欧盟阈值。
export function carbonFootprint(args: Record<string, unknown>) {
  const modelId = str(args.modelId);
  const baseName = str(args.baseName);
  const materials = (args.materials as { material: string; unit: number; factor: number }[]) ?? [];
  const processes = (args.processes as { process: string; energy: number; gridFactor: number }[]) ?? [];
  const matCarbon = round(materials.reduce((s, m) => s + m.unit * m.factor, 0), 4);
  const energyCarbon = round(processes.reduce((s, p) => s + p.energy * p.gridFactor, 0), 4);
  const total = round(matCarbon + energyCarbon, 4);
  const threshold = num(args.euThreshold, 70);
  const contributions = [
    ...materials.map((m) => ({ source: `物料:${m.material}`, value: round(m.unit * m.factor, 4) })),
    ...processes.map((p) => ({ source: `能耗:${p.process}`, value: round(p.energy * p.gridFactor, 4) })),
  ].sort((a, b) => b.value - a.value);
  return {
    modelId,
    baseName,
    total,
    breakdown: { materialCarbon: matCarbon, energyCarbon },
    threshold,
    verdict: total <= threshold ? "达标" : "超标",
    maxLever: contributions[0]?.source,
    ruleRefs: ["C33"],
  };
}

/** 13 新增求解器分发（service.compute 的扩展分支）。 */
export const EXTENDED_SOLVERS: Record<string, (args: Record<string, unknown>) => Record<string, unknown>> = {
  mitigation_select: mitigationSelect,
  cert_schedule: certSchedule,
  kit_readiness: kitReadiness,
  lta_gap: ltaGap,
  inventory_optimize: inventoryOptimize,
  changeover_sequence: changeoverSequence,
  yield_diagnosis: yieldDiagnosis,
  maintenance_stagger: maintenanceStagger,
  outsourcing_split: outsourcingSplit,
  quote_margin: quoteMargin,
  credit_exposure: creditExposure,
  quarterly_gap: quarterlyGap,
  carbon_footprint: carbonFootprint,
  countermeasure_combo: countermeasureCombo,
};

/**
 * E6b：当场景仅给 presetContext 槽位、未显式传齐 args 时，从对象数据（SolverContext §7 扩展）
 * 推导各求解器的输入 args（已传的 args 优先保留）。让 20 场景从 presetContext 端到端出结果。
 */
export function deriveExtendedArgs(c: SolverContext, solverKey: string, args: Record<string, unknown>): Record<string, unknown> {
  const props = (o: ObjectInstance) => o.props as Record<string, unknown>;
  const mats = (c.materials ?? []).map(props);
  const has = (k: string) => args[k] !== undefined;
  switch (solverKey) {
    case "cert_schedule":
      if (has("items")) return args;
      return { engineerGroups: 3, ...args, items: (c.certifications ?? []).map(props).map((x) => ({ model: str(x.modelId), line: str(x.lineId), status: str(x.status), certHours: num(x.certHours, 80), gapContribution: num(x.gapContribution) })) };
    case "kit_readiness": {
      if (has("orders")) return args;
      const orders = (c.orders ?? []).slice(0, 8).map((o, i) => ({
        orderId: str(props(o).so, `O${i}`),
        qty: num(props(o).qty, 100),
        startDay: 7,
        materials: mats.slice(0, 4).map((m) => ({ material: str(m.matId), onHand: num(m.onHand), inTransit: [{ qty: num(m.inTransit), etaDay: num(m.leadTime, 10) }], bomUnit: num(m.bomUnit, 1) })),
      }));
      return { fromDay: 1, toDay: 14, ...args, orders };
    }
    case "lta_gap": {
      if (has("monthDemand")) return args;
      const m = mats.find((x) => str(x.matId) === str(args.material)) ?? mats[0] ?? {};
      return { material: str(args.material, str(m.matId, "三元正极")), month: str(args.month, "2026-07"), monthDemand: round(num(m.dailyUse, 100) * 30, 2), bomUnit: num(m.bomUnit, 1), inventory: num(m.onHand), inTransit: num(m.inTransit), ltaAnnualLock: round(num(m.dailyUse, 100) * 365 * 0.8, 0), monthQuota: 1 / 12, executedThisMonth: 0, leadDays: num(m.leadTime, 30), ...args };
    }
    case "inventory_optimize": {
      // WO-SANDBOX-D4 ②：inbound（真 PurchaseOrder 到货）与 locations（物料侧地点维·今日恒空）与 materials 是否
      // 由调用方直传**无关**，故在 early-return 之前先补 —— 否则 rules/测试直传 materials 的路会静默丢掉时间轴。
      const d4 = {
        inbound: purchaseOrderInbound(c),
        locations: materialLocationRefs(c), // 恒 [] 直到 Material 补上 warehouseId（EMPTY 自愈）
      };
      if (has("materials")) return { ...d4, ...args };
      const idleByMat = new Map<string, number>();
      for (const b of (c.materialBatches ?? []).map(props)) idleByMat.set(str(b.matId), Math.max(idleByMat.get(str(b.matId)) ?? 0, num(b.idleDays)));
      return { ...d4, ...args, materials: mats.map((m) => ({ matId: str(m.matId), dailyUse: num(m.dailyUse, 100), leadTime: num(m.leadTime, 10), onHand: num(m.onHand), unitPrice: num(m.unitPrice, 1), idleDays: idleByMat.get(str(m.matId)) ?? 0 })) };
    }
    case "changeover_sequence": {
      if (has("orders")) return args;
      const matrix: Record<string, Record<string, number>> = {};
      for (const e of (c.changeoverMatrix ?? []).map(props)) {
        (matrix[str(e.fromModel)] ??= {})[str(e.toModel)] = num(e.minutes);
      }
      const orders = (c.orders ?? []).slice(0, 6).map((o, i) => ({ orderId: str(props(o).so, `o${i}`), modelId: str(props(o).model), dueDay: num(props(o).dueDay, i) }));
      return { lineId: str(args.lineId, "L1"), ...args, orders, matrix, current: orders[0]?.modelId };
    }
    case "outsourcing_split": {
      const totalDemand = (c.orders ?? []).reduce((s, o) => s + num(props(o).qty), 0) || 100;
      return { gap: num(args.gap, Math.round(totalDemand * 0.15)), totalDemand, ...args };
    }
    case "quote_margin": {
      if (has("bom")) return args;
      return { price: num(args.price, 500), mfgRate: 0.1, logistics: 8, segmentFloor: 0.12, ...args, bom: mats.slice(0, 4).map((m) => ({ unit: num(m.bomUnit, 1), spotPrice: num(m.unitPrice, 1), processRate: 0.05 })) };
    }
    case "credit_exposure": {
      // 调用方直传数值（测试/规则 payload·rules-p3/solvers-extended）→ 原样（无客户维推导，creditExposure 标 scope:EXPLICIT）。
      if (has("creditLimit")) return args;
      // WO-SEAM-ARG-DROP（引擎半·诚实化默认·闭 G-ARG-DROP-SEAM 求解器侧）：客户维过滤**不静默落首客户**。
      const custObjs = (c.customers ?? []).map(props);
      const arRows = (c.arInvoices ?? []).map(props);
      const overdueFor = (name: string) =>
        arRows.filter((iv) => str(iv.custName) === name && num(iv.overdueDays) > 30).map((iv) => ({ invoiceId: str(iv.invoiceId), overdueDays: num(iv.overdueDays), amount: num(iv.amount) }));
      const wanted = str(args.custName);
      if (wanted) {
        // 稳健匹配：精确 → 双向子串（路由 creditArgsFrom /XX公司/ 正则会截掉尾部拉丁字符·如「电网公司」需匹配真实「电网公司F」）。
        const cust =
          custObjs.find((x) => str(x.custName) === wanted) ??
          custObjs.find((x) => str(x.custName).includes(wanted) || wanted.includes(str(x.custName)));
        // 指定了客户却匹配不到 → 报 AMBIGUOUS_SCOPE（错误信封·不静默落首个客户冒充答案）。
        if (!cust)
          throw new AppError(
            "AMBIGUOUS_SCOPE",
            `credit_exposure：问句指定客户「${wanted}」在客户库中无匹配——拒绝静默落首个客户（R-ARG-FIDELITY·G-ARG-DROP-SEAM）`,
            400,
          );
        const name = str(cust.custName);
        return { ...args, custName: name, creditLimit: num(cust.creditLimit, 5000), receivables: num(cust.receivables), wipUnbilled: num(cust.wipUnbilled), overdue: overdueFor(name), scope: { mode: "CUSTOMER", custName: name } };
      }
      // 未指定客户 → **显式全域合计**（scope:ALL·前端可见"未指定客户→全部客户合计敞口"），而非静默取首个客户。
      const totalLimit = round(custObjs.reduce((s, x) => s + num(x.creditLimit, 5000), 0), 2);
      const totalRecv = round(custObjs.reduce((s, x) => s + num(x.receivables), 0), 2);
      const totalWip = round(custObjs.reduce((s, x) => s + num(x.wipUnbilled), 0), 2);
      const overdueAll = arRows.filter((iv) => num(iv.overdueDays) > 30).map((iv) => ({ invoiceId: str(iv.invoiceId), overdueDays: num(iv.overdueDays), amount: num(iv.amount) }));
      return { ...args, custName: "全部客户合计", creditLimit: totalLimit, receivables: totalRecv, wipUnbilled: totalWip, overdue: overdueAll, scope: { mode: "ALL", customerCount: custObjs.length, note: "未指定客户→全部客户合计敞口（非首客户）" } };
    }
    case "carbon_footprint": {
      if (has("materials")) return args;
      const em = (c.energyMeters ?? []).map(props)[0];
      return { modelId: str(args.modelId), baseName: str(args.baseName), euThreshold: 70, ...args, materials: mats.slice(0, 4).map((m) => ({ material: str(m.matId), unit: num(m.bomUnit, 1), factor: num(m.carbonFactor, 10) })), processes: em ? [{ process: str(em.processKey, "涂布"), energy: num(em.energyPerUnit, 2), gridFactor: num(em.gridFactor, 0.6) }] : [] };
    }
    case "maintenance_stagger": {
      if (has("bases")) return args;
      // 诚实边界（假6·KILL-MOCK-RED）：删写死 loadByWeek/maintWeek/peakWeeks——SolverContext 无逐周负荷/交付高峰时序源。
      // 真派生可得：真实基地 + 真实检修周（maintWeekOf 读 MaintenancePlan.week）；逐周负荷/高峰周缺真源 → 空 + 标合成（provenanceSynthetic）。
      const bases = (c.bases ?? [])
        .map((b, i) => ({ base: str(props(b).name, `B${i}`), group: str(props(b).group, "g1"), maintWeek: maintWeekOf(c, str(props(b).baseId)) ?? 0, loadByWeek: {} as Record<string, number> }))
        .filter((x) => x.maintWeek > 0);
      return { peakWeeks: [], provenanceSynthetic: true, ...args, bases };
    }
    case "yield_diagnosis": {
      if (has("series")) return args;
      // 诚实边界（假6·KILL-MOCK-RED）：删写死 40 天 day-33 突变 series——SolverContext 无逐日良率时序源，
      // 不伪造序列冒充"恒找到 day33"。无 series → yieldDiagnosis 返 EMPTY + 披露（标合成）。真时序接入后再喂真 series。
      return { processKey: str(args.processKey, "涂布"), baseName: str(args.baseName), provenanceSynthetic: true, ...args };
    }
    case "quarterly_gap":
      return { quarter: str(args.quarter, "2026Q2"), gap: num(args.gap, 50), ...args };
    case "countermeasure_combo": {
      const totalDemand = (c.orders ?? []).reduce((s, o) => s + num(props(o).qty), 0) || 100;
      return { gap: num(args.gap, Math.round(totalDemand * 0.15)), ...args };
    }
    case "mitigation_select":
      // 注入 canonical 方案库（params.risk.mitigations）→ mitigation_select 对全部 7 个风险因子可用。
      return { tightness: 85, mitigations: c.params?.risk?.mitigations, ...args };
    default:
      return args;
  }
}
