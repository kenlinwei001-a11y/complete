import type { ObjectInstance } from "../domain.js";
import { round } from "../prng.js";
import { num, str, type SolverContext } from "./types.js";
import { liveTightness } from "./risk.js";
import { currentMonth, currentQuarter } from "../clockderive.js";

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
  // WO-KILL-MOCK-RED（治本）：无真紧迫度（args.tightness 缺）→ 不伪造 85；urgency=null，按方案性价比排序并诚实标。
  const hasTight = args.tightness !== undefined && args.tightness !== null;
  const tightness = hasTight ? num(args.tightness) : null;
  // 优先用注入的 canonical 方案库（params.risk.mitigations，全因子名 + risk 字段，R14 单一来源）；
  // 直接单测无 context 时回落内置 MITIGATION_LIB（消除"风险卡全因子名 vs 方案库短名"接缝 G）。
  const injected = args.mitigations as Record<string, { key: string; name: string; eff: number; tn: number; cost: string; risk?: string }[]> | undefined;
  const lib = injected?.[factor] ?? MITIGATION_LIB[factor];
  if (!lib) {
    const factors = [...new Set([...Object.keys(injected ?? {}), ...Object.keys(MITIGATION_LIB)])];
    return { error: `unknown factor: ${factor}`, factors };
  }
  // HARDCODE-SOLVER-PARAMS（ε4）：urgency 映射系数入 params.mitigation（deriveArgs 注入；默认 70/30 == 原内联·R6）。
  const urgencyPivot = num(args.urgencyPivot, 70);
  const urgencySpan = num(args.urgencySpan, 30);
  const urgency = tightness === null ? null : Math.max(0, (tightness - urgencyPivot) / urgencySpan);
  // 无真紧迫度：按方案性价比（eff/(cost×tn)）排序，不含紧迫度加权（不伪造紧迫度）；有真值则乘 urgency 权重。
  const scored = lib
    .map((p) => {
      const roi = round(p.eff / ((COST_RANK[p.cost] ?? 2) * p.tn), 4);
      return { ...p, costRank: COST_RANK[p.cost] ?? 2, score: urgency === null ? roi : round((p.eff * urgency) / ((COST_RANK[p.cost] ?? 2) * p.tn), 4) };
    })
    .sort((a, b) => b.score - a.score);
  const top = scored[0]!;
  return {
    factor,
    baseName,
    urgency: urgency === null ? null : round(urgency, 4),
    ...(urgency === null
      ? { urgencyDataMode: "MOCK", noData: "无实测紧迫度数据（真风险张力缺失·未接真设备/需求数据）——按方案性价比排序，不含紧迫度加权，不作决策级紧迫度结论" }
      : {}),
    plans: scored,
    recommended: top.key,
    draftPayload: { base: baseName, factor, planKey: top.key },
  };
}

// S07 cert_schedule：priority = 缺口贡献/认证工时；C26 并行 ≤ 工程师组数 贪心装箱到周。
export function certSchedule(args: Record<string, unknown>) {
  const items = (args.items as { model: string; line: string; status: string; certHours: number; gapContribution: number }[]) ?? [];
  const groups = num(args.engineerGroups, 3);
  // HARDCODE-SOLVER-PARAMS（ε4）：认证工时→周换算系数入 params.cert.hoursPerWeek（默认 40 == 原内联·R6）。
  const hoursPerWeek = num(args.certHoursPerWeek, 40);
  const pending = items.filter((i) => i.status === "认证中" || i.status === "待认证");
  const ranked = pending
    .map((i) => ({ ...i, priority: round(i.gapContribution / Math.max(0.1, i.certHours), 4), weeks: Math.max(1, Math.ceil(i.certHours / hoursPerWeek)) }))
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
  // HARDCODE-SOLVER-PARAMS（ε4）：现货补单最迟提前期缺省入 params.lta.leadDays（默认 30 == 原内联·R6）。
  // monthQuota 1/12 为「月/年」单位换算（物理常数·非业务阈值·丙档诚实项）→ 不迁。
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
export function inventoryOptimize(args: Record<string, unknown>) {
  const materials = (args.materials as { matId: string; dailyUse: number; leadTime: number; onHand: number; unitPrice: number; idleDays: number }[]) ?? [];
  const safety = num(args.safetyDays, 5);
  // HARDCODE-SOLVER-PARAMS（ε4）：超/欠储乘数 + C28 呆滞天阈入 params.inventory（默认 1.5/0.8/90 == 原内联·R6）。
  const overMult = num(args.overMult, 1.5);
  const underMult = num(args.underMult, 0.8);
  const idleThreshold = num(args.idleThreshold, 90);
  const over: unknown[] = [];
  const under: unknown[] = [];
  const idle: unknown[] = [];
  let releasable = 0;
  for (const m of materials) {
    const target = m.dailyUse * (m.leadTime + safety);
    const overQty = Math.max(0, m.onHand - overMult * target);
    const underQty = Math.max(0, underMult * target - m.onHand);
    if (overQty > 0) {
      over.push({ matId: m.matId, overQty: round(overQty, 4), value: round(overQty * m.unitPrice, 2) });
      releasable += overQty * m.unitPrice;
    }
    if (underQty > 0) under.push({ matId: m.matId, underQty: round(underQty, 4) });
    if (m.idleDays > idleThreshold) idle.push({ matId: m.matId, idleDays: m.idleDays }); // C28
  }
  return { over, under, idle, releasableCash: round(releasable, 2), ruleRefs: ["C16", "C28"] };
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
  return { breakpoint, candidates, ruleRefs: ["C30"] };
}

// S13 maintenance_stagger：冲突=检修周∈交付高峰top3；±4 周内选负荷最低周；间隔≥26、同组同周≤3。
export function maintenanceStagger(args: Record<string, unknown>) {
  const bases = (args.bases as { base: string; group?: string; maintWeek: number; lastMaintWeek?: number; loadByWeek: Record<string, number> }[]) ?? [];
  const peakWeeks = (args.peakWeeks as number[]) ?? [];
  const peakSet = new Set(peakWeeks);
  // HARDCODE-SOLVER-PARAMS（ε4）：C11 错峰窗/最小间隔/同组同周上限入 params.maintenance（默认 4/26/3 == 原内联·R6）。
  const window = num(args.staggerWindow, 4);
  const minInterval = num(args.minInterval, 26);
  const groupWeekCap = num(args.groupWeekCap, 3);
  const groupWeekCount: Record<string, number> = {};
  const adjustments: unknown[] = [];
  const unresolved: unknown[] = [];
  for (const b of bases) {
    if (!peakSet.has(b.maintWeek)) continue; // 无冲突
    let best: number | undefined;
    let bestLoad = Infinity;
    for (let w = b.maintWeek - window; w <= b.maintWeek + window; w++) {
      if (w < 1 || peakSet.has(w)) continue;
      if (b.lastMaintWeek !== undefined && w - b.lastMaintWeek < minInterval) continue; // 间隔约束
      if ((groupWeekCount[`${b.group}|${w}`] ?? 0) >= groupWeekCap) continue; // 同组同周≤cap
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
  return { adjustments, unresolved, ruleRefs: ["C11"] };
}

// S14 outsourcing_split：三渠道 加班c1=1.0(上限gap×0.4)/外协c2=1.4(上限总需求×20% C08)/延期c3=2.5。
export function outsourcingSplit(args: Record<string, unknown>) {
  const gap = num(args.gap);
  const totalDemand = num(args.totalDemand, gap);
  // HARDCODE-SOLVER-PARAMS（ε4）：三渠道单位成本 + 加班/外协上限比入 params.outsourcing（默认 1.0/1.4/2.5·0.4·0.2 == 原内联·R6）。
  const overtimeCost = num(args.overtimeCost, 1.0);
  const outsourceCost = num(args.outsourceCost, 1.4);
  const delayCost = num(args.delayCost, 2.5);
  const overtimeCapPct = num(args.overtimeCapPct, 0.4);
  const outsourceCapPct = num(args.outsourceCapPct, 0.2);
  const channels = [
    { key: "overtime", name: "自产加班", unitCost: overtimeCost, cap: gap * overtimeCapPct },
    { key: "outsource", name: "外协", unitCost: outsourceCost, cap: totalDemand * outsourceCapPct }, // C08
    { key: "delay", name: "延期", unitCost: delayCost, cap: Infinity },
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
    savedVsAllDelay: round(gap * delayCost - totalCost, 4),
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
  // HARDCODE-SOLVER-PARAMS（ε4）：C15/C24 毛利底线缺省 + 过线缓冲带入 params.quote（默认 0.1/0.01 == 原内联·R6）。
  const floor = num(args.segmentFloor, num(args.quoteFloorDefault, 0.1));
  const band = num(args.quoteBand, 0.01);
  return {
    margin,
    floor,
    diff: round(margin - floor, 4),
    verdict: margin >= floor + band ? "过线" : margin >= floor ? "触线" : "低于底线",
    breakdown: { bomCost, mfg: round(mfg, 4), logistics, price },
    ruleRefs: ["C15", "C24"],
  };
}

// S16 credit_exposure：敞口=应收+在产未开票；可用=额度−敞口；逾期 dueDate+30 未回（C32）。
export function creditExposure(args: Record<string, unknown>) {
  const limit = num(args.creditLimit);
  const receivables = num(args.receivables);
  const wip = num(args.wipUnbilled);
  const exposure = round(receivables + wip, 2);
  const available = round(limit - exposure, 2);
  const overdue = (args.overdue as { invoiceId: string; overdueDays: number; amount: number }[]) ?? [];
  // HARDCODE-SOLVER-PARAMS（ε4）：C32 逾期天阈入 params.credit.overdueDays（默认 30 == 原内联·R6）。
  const overdueDaysThreshold = num(args.overdueDays, 30);
  const hasOverdue = overdue.some((o) => o.overdueDays > overdueDaysThreshold); // C32
  const newOrder = num(args.newOrderAmount, 0);
  const verdict = hasOverdue ? `冻结（存在逾期>${overdueDaysThreshold}天）` : newOrder <= available ? "可接" : "超出可用额度";
  return { limit, exposure, available, exposureBreakdown: { receivables, wipUnbilled: wip }, overdue, newOrderVerdict: verdict, ruleRefs: ["C13", "C32"] };
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
 *
 * ⚠ QUERY30-ORCH 回炉治本（KILL-MOCK-RED·决策级绝不用写死系数冒充真实）：
 * 各杠杆的可释放量 `release` **必须由调用方（编排层）真调对应子求解器算出后回填**（cert_schedule/
 * changeover_sequence/… 的真实产出映射到 gap 释放量）。此前默认杠杆用 `gap×{0.3,0.15,0.1,0.2,0.5}`
 * **启发系数冒充各求解器释放量**——是决策级魔数假值（一个"cert 能解 30% 缺口"是编造的决策断言）。
 * 现改为**诚实降级**：未提供真实 `levers` → 不编造 → 返回空组合 + `needsRealLevers:true` + 诚实说明
 * （指明须先跑各子求解器得真实释放量再编排）。真实 `levers`（携真算 release）在场 → 真贪心背包（不变）。
 * 真正的「跨求解器编排」（把异构子求解器产出归一到统一 gap 释放账本）属 QUERY30 §2.5/2.6 核心设计，
 * 待编排层落地（本单只除假·不以魔数冒充）。确定性（R6）。
 */
type ComboLever = { key: string; solver: string; scene?: string; release: number; unitCost: number; costRank: number };
export function countermeasureCombo(args: Record<string, unknown>) {
  const gap = round(num(args.gap, 10), 4);
  const rawLevers = args.levers as ComboLever[] | undefined;
  // 诚实降级：无真实杠杆（各子求解器真算释放量）→ 不以启发系数编造决策级组合。
  if (!Array.isArray(rawLevers) || rawLevers.length === 0) {
    return {
      gap,
      combo: [],
      residualGap: gap,
      totalCost: 0,
      feasible: false,
      needsRealLevers: true,
      note: "未提供真实杠杆：跨求解器编排须先真调各子求解器（cert_schedule/changeover_sequence/maintenance_stagger/outsourcing_split/capex_scenario）得各自真实释放量再编排——绝不以启发系数冒充决策级释放量（KILL-MOCK-RED）。",
      ruleRefs: ["C08", "C23", "C29"],
    };
  }
  const sorted = [...rawLevers].sort((a, b) => a.costRank - b.costRank || a.unitCost - b.unitCost);
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
  return { gap, combo, residualGap: round(Math.max(0, remaining), 4), totalCost, feasible: remaining <= 0, needsRealLevers: false, ruleRefs: ["C08", "C23", "C29"] };
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

/**
 * QUERY30 缺口③ Q01 样板求解器 · `what_if_displacement`（DESIGN-query30 §2.5）——
 * **接单挤占推演**：某急单（model/qty/提前 advancePct/weeks）插进来能不能接、会挤占哪些在手订单、
 * 有哪些处置方案（四型确定性枚举）、被挤订单各自的再方案。全程 **args 驱动 · 确定性（R6·禁 random/时钟）**，
 * 逐值可溯自真实 Order（so/cust/pri/qty/marginPct/penaltyClause/substitutable，QUERY30-ONTOLOGY-EXT 五件套）
 * 与真实 Line（capacityDaily/certifiedModels，同批新增）。
 *
 * 挤占级联（Q01「会挤占哪些订单」）= 直接影响集：为腾出急单日产能缺口，按 **优先级升序·交期最晚优先** 位移在手单，
 * 每单位移天数 displaceDays ∝ 单量。C34（挤占优先级不变量）读 canonical 级联的 `highPriDisplaceDays`；
 * C35（重大变更须 ≥2 方案）读 `schemeCount`（可行方案数）。二者经 service.ts ruleEvalPayload 映射进 evaluate_rules 真裁决。
 *
 * 四型方案（Q01「输出多个方案和方案量化比较」）：延期 delay / 外协 outsource / 拆单 split / 降级 downgrade，
 * 各自 feasible 判定 + 五维量化（交期影响/毛利率/挤占单数/外协比/现金占用）；推荐案确定性择优。
 */
const PRI_RANK: Record<string, number> = { 低: 0, 中: 1, 高: 2 };
const priRank = (v: unknown) => PRI_RANK[str(v)] ?? 1;

interface DispOrder {
  so: string; cust: string; pri: string; qty: number; marginPct: number;
  penaltyClause: number; substitutable: boolean; unitPrice: number;
}

export function whatIfDisplacement(args: Record<string, unknown>) {
  const model = str(args.model);
  const qty = num(args.qty, 0);
  const advancePct = num(args.advancePct, 0);
  const weeks = Math.max(1, num(args.weeks, 6));
  const baseId = str(args.baseId);
  const horizonDays = weeks * 7;
  // 参数化阈值（改 param 改果·R14）：违约/毛利系数默认 == 内联（R6 字节一致）。
  const advanceErosion = num(args.advanceErosion, 0.5);   // 提前交付对毛利的侵蚀系数（Q01「毛利率是否因提前而变化」）
  const outsourceMarginHit = num(args.outsourceMarginHit, 2); // 外协方案毛利折让（pp）
  const outsourceUnitCost = num(args.outsourceUnitCost, 0.15);  // 外协溢价（占货值比）
  const baseMargin = num(args.baseMargin, 15);            // 急单基准毛利率（无 Segment 锚时）

  const lines = (Array.isArray(args.lines) ? args.lines : []) as { lineId?: unknown; capacityDaily?: unknown; certifiedModels?: unknown }[];
  const orders = (Array.isArray(args.orders) ? args.orders : []) as Record<string, unknown>[];

  // 认证可产该型号的线（Q01 认证线约束）；无匹配 → 回落全部线并标注（诚实·非静默兜底）。
  const certOf = (l: { certifiedModels?: unknown }) => (Array.isArray(l.certifiedModels) ? (l.certifiedModels as string[]) : []);
  const certLinesRaw = lines.filter((l) => certOf(l).includes(model));
  const certFallback = certLinesRaw.length === 0;
  const certLines = certFallback ? lines : certLinesRaw;
  const totalCap = round(certLines.reduce((s, l) => s + num(l.capacityDaily), 0), 2);
  const certModelSet = new Set(certLines.flatMap(certOf));

  // 与急单争同一批线的在手单（其型号被这些线认证）。
  const contending: DispOrder[] = orders
    .filter((o) => certModelSet.size === 0 || certModelSet.has(str(o.model)))
    .map((o) => ({
      so: str(o.so), cust: str(o.cust), pri: str(o.pri, "中"), qty: num(o.qty),
      marginPct: num(o.marginPct), penaltyClause: num(o.penaltyClause),
      substitutable: o.substitutable === true, unitPrice: num(o.unitPrice, 600),
    }));

  const dailyDemand = Math.ceil(qty / horizonDays);
  const committedDaily = round(contending.reduce((s, o) => s + o.qty, 0) / horizonDays, 2);
  const freeDaily = round(Math.max(0, totalCap - committedDaily), 2);
  const shortfallDaily = round(Math.max(0, dailyDemand - freeDaily), 2);
  const feasibleWithoutDisplacement = shortfallDaily <= 0;
  const unitsToFree = Math.round(shortfallDaily * horizonDays);
  const totalExistingUnits = contending.reduce((s, o) => s + o.qty, 0) || 1;
  const goodsWan = round((qty * num(args.newUnitPrice, 600)) / 10000, 2); // 急单货值（万·现金占用基）

  // 位移候选序：优先级升序（先挤低 pri）·同级交期最晚优先（无 dueDay 则按 so 稳定）。
  const displaceOrder = (a: DispOrder, b: DispOrder) => priRank(a.pri) - priRank(b.pri) || (a.so < b.so ? -1 : 1);
  // 贪心腾容：按候选序累计 qty 至 ≥ unitsToFree；每单 displaceDays ∝ 单量（clamp[1,horizon]）。
  const freeBy = (pool: DispOrder[]) => {
    const disp: (DispOrder & { displaceDays: number; penaltyWan: number; reScheme: string; reSchemes: string[] })[] = [];
    let freed = 0;
    for (const o of [...pool].sort(displaceOrder)) {
      if (freed >= unitsToFree) break;
      const displaceDays = Math.min(horizonDays, Math.max(1, Math.ceil(o.qty / Math.max(1, dailyDemand))));
      const penaltyWan = round((o.qty * o.unitPrice * o.penaltyClause) / 10000, 2);
      // 逐单再方案（Q01「被影响订单是否也有多方案」·C4 每被挤单须 ≥2 备选）：全部**确定性派生自本单真值**
      // （qty/unitPrice/penaltyClause/substitutable/displaceDays），非填充。三型口径：
      //   ① 延期 delay：整单顺延 displaceDays 天，计违约金 penaltyWan 万（交期换产能）；
      //   ② 外协/拆单：可外协单→外协消化（不延期·外协溢价 outsourceWan 万）；不可外协单→拆单并行
      //      （半量转认证副线·缓 splitDays 天·仅半量违约 splitPenaltyWan 万）；
      //   ③ 降级协商 downgrade：与客户协商缩量交付（承接可覆盖部分·免违约），末位保底方案。
      // 主推方案 reScheme = 可外协取外协、否则取延期（与既有 canonical 口径一致·R6 字节兼容）。
      const outsourceWan = round((o.qty * o.unitPrice * outsourceUnitCost) / 10000, 2);
      const splitDays = Math.max(1, Math.ceil(displaceDays / 2));
      const splitPenaltyWan = round(penaltyWan / 2, 2);
      const delayScheme = `延期 ${displaceDays} 天（违约金 ${penaltyWan} 万）`;
      const altScheme = o.substitutable
        ? `外协消化（不延期·外协溢价 ${outsourceWan} 万）`
        : `拆单并行（半量转副线·缓 ${splitDays} 天·违约金 ${splitPenaltyWan} 万）`;
      const negotiateScheme = "降级协商（缩量交付·免违约）";
      // 可外协单主推外协（不延期最优）；否则主推延期。reSchemes 恒 ≥2（C4 不变量·各口径互异非重复）。
      const reSchemes = o.substitutable
        ? [altScheme, delayScheme, negotiateScheme]
        : [delayScheme, altScheme, negotiateScheme];
      const reScheme = reSchemes[0]!;
      disp.push({ ...o, displaceDays, penaltyWan, reScheme, reSchemes });
      freed += o.qty;
    }
    return { disp, freed, enough: freed >= unitsToFree };
  };

  // canonical 挤占级联（Q01「会挤占哪些订单」）= 延期口径直接影响集。
  const cascade = feasibleWithoutDisplacement ? { disp: [], freed: 0, enough: true } : freeBy(contending);
  const highPriDisplaceDays = cascade.disp.filter((d) => d.pri === "高").reduce((m, d) => Math.max(m, d.displaceDays), 0);
  const rushMargin = round(baseMargin * (1 - advancePct * advanceErosion), 1); // 提前 → 毛利侵蚀

  // 四型方案确定性枚举。
  type Scheme = { key: string; name: string; feasible: boolean; displacedCount: number; promiseDeltaDays: number; marginPct: number; outsourceRatio: number; penaltyTotalWan: number; cashOccupiedWan: number; note: string };
  const schemes: Scheme[] = [];

  // ① 延期 delay：位移低 pri 在手单。
  {
    const r = feasibleWithoutDisplacement ? { disp: [], enough: true } : freeBy(contending);
    const penalty = round(r.disp.reduce((s, d) => s + d.penaltyWan, 0), 2);
    const maxDelay = r.disp.reduce((m, d) => Math.max(m, d.displaceDays), 0);
    schemes.push({ key: "delay", name: "延期在手单", feasible: feasibleWithoutDisplacement || r.enough, displacedCount: r.disp.length, promiseDeltaDays: maxDelay, marginPct: rushMargin, outsourceRatio: 0, penaltyTotalWan: penalty, cashOccupiedWan: goodsWan, note: feasibleWithoutDisplacement ? "免挤占直接承接" : `位移 ${r.disp.length} 单` });
  }
  // ② 外协 outsource：仅位移可外协单（不延期·计外协溢价）。
  {
    const pool = contending.filter((o) => o.substitutable);
    const r = feasibleWithoutDisplacement ? { disp: [], freed: 0, enough: true } : freeBy(pool);
    const outsourcedUnits = r.disp.reduce((s, d) => s + d.qty, 0);
    const outsourceRatio = round(outsourcedUnits / totalExistingUnits, 3);
    const outsourceCostWan = round((outsourcedUnits * (contending[0]?.unitPrice ?? 600) * outsourceUnitCost) / 10000, 2);
    schemes.push({ key: "outsource", name: "外协消化", feasible: feasibleWithoutDisplacement || r.enough, displacedCount: r.disp.length, promiseDeltaDays: 0, marginPct: round(rushMargin - outsourceMarginHit, 1), outsourceRatio, penaltyTotalWan: 0, cashOccupiedWan: round(goodsWan + outsourceCostWan, 2), note: r.enough ? `外协 ${r.disp.length} 单腾容` : "可外协单不足" });
  }
  // ③ 拆单 split：急单跨 ≥2 认证线分摊（避免单线越限）。
  {
    const feasible = certLines.length >= 2 && dailyDemand <= totalCap && !certFallback;
    // 分摊后仍需位移的残量（低 pri）。
    const residualUnits = Math.max(0, unitsToFree - Math.round(freeDaily * horizonDays));
    const r = residualUnits > 0 ? freeBy(contending) : { disp: [], enough: true };
    schemes.push({ key: "split", name: "拆单分线", feasible: feasible, displacedCount: feasibleWithoutDisplacement ? 0 : r.disp.length, promiseDeltaDays: 0, marginPct: round(rushMargin - 0.5, 1), outsourceRatio: 0, penaltyTotalWan: 0, cashOccupiedWan: goodsWan, note: feasible ? `跨 ${certLines.length} 线分摊` : (certFallback ? "无认证线" : "认证线不足 2 条") });
  }
  // ④ 降级 downgrade：只承接自由产能可覆盖的部分（部分接·不挤占）。
  {
    const acceptedQty = Math.min(qty, Math.round(freeDaily * horizonDays));
    const unmet = qty - acceptedQty;
    const promiseDelta = unmet > 0 ? Math.min(horizonDays, Math.ceil(unmet / Math.max(1, dailyDemand))) : 0;
    schemes.push({ key: "downgrade", name: "降级部分承接", feasible: true, displacedCount: 0, promiseDeltaDays: promiseDelta, marginPct: rushMargin, outsourceRatio: 0, penaltyTotalWan: 0, cashOccupiedWan: round((acceptedQty * num(args.newUnitPrice, 600)) / 10000, 2), note: unmet > 0 ? `仅接 ${acceptedQty}/${qty} 套` : "自由产能足量承接" });
  }

  const feasibleSchemes = schemes.filter((s) => s.feasible);
  const schemeCount = feasibleSchemes.length;
  // 推荐案确定性择优：挤占少 > 违约低 > 毛利高 > 现金省 > key 字典序。
  const recommended = [...feasibleSchemes].sort((a, b) =>
    a.displacedCount - b.displacedCount || a.penaltyTotalWan - b.penaltyTotalWan ||
    b.marginPct - a.marginPct || a.cashOccupiedWan - b.cashOccupiedWan || (a.key < b.key ? -1 : 1),
  )[0]?.key ?? null;

  const comparison = {
    columns: ["方案", "交期影响(天)", "毛利率(%)", "挤占单数", "外协比", "现金占用(万)"],
    rows: schemes.map((s) => [s.name, s.promiseDeltaDays, s.marginPct, s.displacedCount, s.outsourceRatio, s.cashOccupiedWan]),
  };

  const summary = feasibleWithoutDisplacement
    ? `急单 ${model} ×${qty}（${weeks} 周）自由产能足量承接、无需挤占；${schemeCount} 个可行方案，推荐「${schemes.find((s) => s.key === recommended)?.name ?? "-"}」。`
    : `急单 ${model} ×${qty}（提前 ${Math.round(advancePct * 100)}%·${weeks} 周）日产能缺口 ${shortfallDaily}，需挤占 ${cascade.disp.length} 单（高优先级最长位移 ${highPriDisplaceDays} 天）；${schemeCount} 个可行方案，推荐「${schemes.find((s) => s.key === recommended)?.name ?? "-"}」。`;

  return {
    newOrder: { model, qty, advancePct, weeks, dailyDemand },
    base: baseId,
    feasibleWithoutDisplacement,
    freeDaily,
    shortfallDaily,
    displacedOrders: cascade.disp,
    highPriDisplaceDays,
    totalDisplaced: cascade.disp.length,
    schemes,
    schemeCount,
    recommended,
    comparison,
    ruleRefs: ["C34", "C35"],
    summary,
  };
}

/**
 * QUERY30 缺口③ Q01 样板 · `multi_plan_compare`（DESIGN-query30 §2.5）——**多方案五维比较矩阵**（纯聚合层）。
 *
 * 输入 `args.schemes`（= `what_if_displacement` 输出的四型方案数组，或经 registry deriveArgs 自动装配急单推演后喂入）。
 * 输出对每个方案一行的**五维比较矩阵**（每维逐值溯自方案字段·**零系数·纯投影 R13**）：
 *   交期Δ=promiseDeltaDays · 毛利=marginPct · 挤占数=displacedCount · 外协比=outsourceRatio · 现金占用=cashOccupiedWan。
 *
 * 推荐案（`recommendedKey`）**确定性择优**（R6）——文档化 tiebreak 序（保毛利导向·与 what_if_displacement 自身
 * 「挤占最少」导向的 recommended 正交，二者服务不同决策口径）：
 *   ① 仅在**可行**方案中择（feasible 前置）；② 毛利率高优先（marginPct 降序）；③ 挤占少（displacedCount 升序）；
 *   ④ 现金占用省（cashOccupiedWan 升序）；⑤ key 字典序（末位稳定断结）。
 *
 * **≥2 可比方案门（C35 口径·纯本层判定不落规则裁决）**：可行方案 <2 → **诚实标「可比方案不足2·不强推」**、
 * `recommendedKey=null`（不硬推单一方案·G「诚实边界」）。可行 ≥2 → 给推荐案 + 说明。
 */
export function multiPlanCompare(args: Record<string, unknown>) {
  const raw = Array.isArray(args.schemes) ? (args.schemes as Record<string, unknown>[]) : [];
  // 五维比较维度声明（label 仅字段语义·无业务数字·R14）。
  const dims = [
    { key: "promiseDeltaDays", label: "交期Δ(天)" },
    { key: "marginPct", label: "毛利(%)" },
    { key: "displacedCount", label: "挤占数" },
    { key: "outsourceRatio", label: "外协比" },
    { key: "cashOccupiedWan", label: "现金占用(万)" },
  ];
  // 每行 = 方案标识 + 五维（逐值投影自方案字段·无新真值）。
  const matrix = raw.map((s) => ({
    key: str(s.key),
    name: str(s.name),
    feasible: s.feasible === true,
    promiseDeltaDays: num(s.promiseDeltaDays),
    marginPct: num(s.marginPct),
    displacedCount: num(s.displacedCount),
    outsourceRatio: num(s.outsourceRatio),
    cashOccupiedWan: num(s.cashOccupiedWan),
  }));
  const feasible = matrix.filter((r) => r.feasible);
  const comparedCount = feasible.length;
  // 确定性择优（文档化 tiebreak·毛利优先）。
  const best = [...feasible].sort((a, b) =>
    b.marginPct - a.marginPct || a.displacedCount - b.displacedCount ||
    a.cashOccupiedWan - b.cashOccupiedWan || (a.key < b.key ? -1 : 1),
  )[0];
  // C35 口径 ≥2 可比方案门：不足 2 → 不强推（recommendedKey=null·诚实标）。
  const enough = comparedCount >= 2;
  const recommendedKey = enough ? (best?.key ?? null) : null;
  const note = enough
    ? `${comparedCount} 个可行方案可比·推荐「${best?.name ?? "-"}」（毛利优先·可行前置）`
    : `可比方案不足2·不强推（可行方案 ${comparedCount} 个）`;
  return { matrix, recommendedKey, dims, comparedCount, note };
}

/**
 * RISK-TRAJECTORY-DEFAKE（G2/G3·治本·命名而非匿名内联）：**合成默认输入**的命名常量。
 * 仅当调用方未显式传 args 时用于兜底演示；对应 dataMode 分别标 PARTIAL（估算缺口）/ MOCK（合成良率序列），
 * **不冒充真源**。此前 `totalDemand*0.15` 匿名内联、良率断点标 `source:"MES"` 谎称来自制造执行系统（假源归因）。
 */
const DEFAULT_GAP_FRACTION = 0.15; // 合成默认缺口 = 需求总量 × 该分数（PARTIAL·明标估算·非真实缺口测量）
const SYNTHETIC_YIELD = { len: 40, before: 0.95, after: 0.85, stepDay: 33 } as const; // 合成良率演示序列（MOCK）

/** descriptor 内公用小工具（消除原三 switch 各自重复的 has/ne/props 局部）。 */
const props = (o: ObjectInstance) => o.props as Record<string, unknown>;
const argHas = (args: Record<string, unknown>, k: string) => args[k] !== undefined;
const nonEmpty = (arr?: unknown[]) => Array.isArray(arr) && arr.length > 0;

/**
 * HARDCODE-DISPATCH-REGISTRY 治本（审计 γ2）· 扩展求解器**单一登记**（每 solver 一条 {fn, dataMode, deriveArgs}）。
 *
 * 此前 13+1 扩展求解器由**三张同键平行结构**驱动（`EXTENDED_SOLVERS` 分派 map + `extendedDataMode` switch +
 * `deriveExtendedArgs` switch）——加一个扩展求解器要同改三处、易漂移。改为 registry-of-descriptors 后，
 * 三个导出（`EXTENDED_SOLVERS`/`extendedDataMode`/`deriveExtendedArgs`）**从本登记派生**（迭代而非查平行表）。
 * 语义零变（R6）：每条 dataMode/deriveArgs 即原 switch 对应 case 的逐字迁移；drift 由 solvers-extended 测 + solver-registry 测守。
 *
 *  - `fn`：确定性求解体（args→输出，见上方 S06–S20 各函数）。
 *  - `dataMode`：诚实位判定（据「真对象 vs 魔数/硬编码兜底」置 LIVE/MOCK/PARTIAL；未登记 key → MOCK）。
 *  - `deriveArgs`：E6b 从对象数据补全 args（presetContext 端到端；已传 args 优先；未登记 key → 原样 args）。
 */
export interface ExtendedSolverDescriptor {
  readonly fn: (args: Record<string, unknown>) => Record<string, unknown>;
  readonly dataMode: (c: SolverContext, args: Record<string, unknown>) => "LIVE" | "MOCK" | "PARTIAL";
  readonly deriveArgs: (c: SolverContext, args: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * HARDCODE-SOLVER-PARAMS（ε4·治本）：把 SolverParams 里的求解器业务阈值/系数注入 args——求解体读
 * `num(args.<key>, 内联默认)`（默认==原内联值→R6 字节一致）；此处从 `c.params.<domain>` 注入使**真调用路径
 * param 驱动**（租户可配·可校准·改 param 改果·非死值）。param 缺省（undefined）→ 不注入 → 求解体回落内联默认
 * （向后兼容·直接单测无 context 时亦字节一致）。注入放在 return 对象最前·`...args` 仍后置（调用方显式值优先）。
 */
function injectThresholds(map: Record<string, number | undefined>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(map)) if (v !== undefined) out[k] = v;
  return out;
}

export const EXTENDED_REGISTRY: Record<string, ExtendedSolverDescriptor> = {
  mitigation_select: {
    fn: mitigationSelect,
    dataMode: (c) => (c.params?.risk?.mitigations ? "LIVE" : "MOCK"), // canonical 方案库（真）
    deriveArgs: (c, args) => {
      // WO-KILL-MOCK-RED（治本）：紧迫度从**真**风险张力（liveTightness）取，无真源则**不注入**（不再硬编码 85）。
      const factor = str(args.factor);
      const bName = str(args.baseName);
      const base = (c.bases ?? []).find((b) => str(b.props.name) === bName || str(b.props.baseId) === bName);
      const rt = base ? liveTightness(c, str(base.props.baseId), factor) : null;
      const tightInj = rt && rt.live && rt.value !== null ? { tightness: rt.value } : {};
      const th = injectThresholds({ urgencyPivot: c.params?.mitigation?.urgencyPivot, urgencySpan: c.params?.mitigation?.urgencySpan });
      // canonical 方案库（params.risk.mitigations）→ 对全部 7 个风险因子可用；args 最后 spread（调用方显式紧迫度仍优先）。
      return { ...th, ...tightInj, mitigations: c.params?.risk?.mitigations, ...args };
    },
  },
  cert_schedule: {
    fn: certSchedule,
    dataMode: (c, args) => (argHas(args, "items") || nonEmpty(c.certifications) ? "LIVE" : "MOCK"),
    deriveArgs: (c, args) => {
      const th = injectThresholds({ certHoursPerWeek: c.params?.cert?.hoursPerWeek });
      if (argHas(args, "items")) return { ...th, ...args };
      return { engineerGroups: c.params?.cert?.engineerGroups ?? 3, certHoursPerWeek: c.params?.cert?.hoursPerWeek, ...args, items: (c.certifications ?? []).map(props).map((x) => ({ model: str(x.modelId), line: str(x.lineId), status: str(x.status), certHours: num(x.certHours, 80), gapContribution: num(x.gapContribution) })) };
    },
  },
  kit_readiness: {
    fn: kitReadiness,
    dataMode: (c, args) => (argHas(args, "orders") || (nonEmpty(c.orders) && nonEmpty(c.materials)) ? "LIVE" : "MOCK"),
    deriveArgs: (c, args) => {
      if (argHas(args, "orders")) return args;
      const mats = (c.materials ?? []).map(props);
      const orders = (c.orders ?? []).slice(0, 8).map((o, i) => ({
        orderId: str(props(o).so, `O${i}`),
        qty: num(props(o).qty, 100),
        startDay: 7,
        materials: mats.slice(0, 4).map((m) => ({ material: str(m.matId), onHand: num(m.onHand), inTransit: [{ qty: num(m.inTransit), etaDay: num(m.leadTime, 10) }], bomUnit: num(m.bomUnit, 1) })),
      }));
      return { fromDay: 1, toDay: 14, ...args, orders };
    },
  },
  lta_gap: {
    fn: ltaGap,
    dataMode: (c, args) => (argHas(args, "monthDemand") || nonEmpty(c.materials) ? "LIVE" : "MOCK"),
    deriveArgs: (c, args) => {
      const lockRate = c.params?.lta?.lockRate ?? 0.8; // audit「lock 0.8」→ params.lta.lockRate
      const leadDaysDefault = c.params?.lta?.leadDays ?? 30;
      const th = injectThresholds({ leadDays: c.params?.lta?.leadDays });
      if (argHas(args, "monthDemand")) return { ...th, ...args };
      const mats = (c.materials ?? []).map(props);
      const m = mats.find((x) => str(x.matId) === str(args.material)) ?? mats[0] ?? {};
      return { material: str(args.material, str(m.matId, "三元正极")), month: str(args.month, currentMonth(c.params.forecastStart)), monthDemand: round(num(m.dailyUse, 100) * 30, 2), bomUnit: num(m.bomUnit, 1), inventory: num(m.onHand), inTransit: num(m.inTransit), ltaAnnualLock: round(num(m.dailyUse, 100) * 365 * lockRate, 0), monthQuota: 1 / 12, executedThisMonth: 0, leadDays: num(m.leadTime, leadDaysDefault), ...args };
    },
  },
  inventory_optimize: {
    fn: inventoryOptimize,
    dataMode: (c, args) => (argHas(args, "materials") || nonEmpty(c.materials) ? "LIVE" : "MOCK"),
    deriveArgs: (c, args) => {
      const th = injectThresholds({ safetyDays: c.params?.inventory?.safetyDays, overMult: c.params?.inventory?.overMult, underMult: c.params?.inventory?.underMult, idleThreshold: c.params?.inventory?.idleThreshold });
      if (argHas(args, "materials")) return { ...th, ...args };
      const mats = (c.materials ?? []).map(props);
      const idleByMat = new Map<string, number>();
      for (const b of (c.materialBatches ?? []).map(props)) idleByMat.set(str(b.matId), Math.max(idleByMat.get(str(b.matId)) ?? 0, num(b.idleDays)));
      return { ...th, ...args, materials: mats.map((m) => ({ matId: str(m.matId), dailyUse: num(m.dailyUse, 100), leadTime: num(m.leadTime, 10), onHand: num(m.onHand), unitPrice: num(m.unitPrice, 1), idleDays: idleByMat.get(str(m.matId)) ?? 0 })) };
    },
  },
  changeover_sequence: {
    fn: changeoverSequence,
    dataMode: (c, args) => (argHas(args, "orders") || (nonEmpty(c.orders) && nonEmpty(c.changeoverMatrix)) ? "LIVE" : "MOCK"),
    deriveArgs: (c, args) => {
      if (argHas(args, "orders")) return args;
      const matrix: Record<string, Record<string, number>> = {};
      for (const e of (c.changeoverMatrix ?? []).map(props)) {
        (matrix[str(e.fromModel)] ??= {})[str(e.toModel)] = num(e.minutes);
      }
      const orders = (c.orders ?? []).slice(0, 6).map((o, i) => ({ orderId: str(props(o).so, `o${i}`), modelId: str(props(o).model), dueDay: num(props(o).dueDay, i) }));
      return { lineId: str(args.lineId, "L1"), ...args, orders, matrix, current: orders[0]?.modelId };
    },
  },
  yield_diagnosis: {
    fn: yieldDiagnosis,
    dataMode: (c, args) => (argHas(args, "series") ? "LIVE" : "MOCK"), // 默认 series 写死 0.95/0.85（A2）
    deriveArgs: (c, args) => {
      if (argHas(args, "series")) return args;
      // G3（治本·删假源归因）：无真实良率序列 → 合成演示序列（dataMode=MOCK·前端合成徽章）。断点事件此前标
      // `source:"MES"` 谎称来自制造执行系统实测（假源）→ 改标 `source:"SYNTHETIC"` + synthetic:true（诚实合成）。
      const sy = SYNTHETIC_YIELD;
      const series = Array.from({ length: sy.len }, (_, d) => ({ day: d + 1, yield: d < sy.stepDay ? sy.before : sy.after }));
      return { processKey: str(args.processKey, "涂布"), baseName: str(args.baseName), ...args, series, synthetic: true, events: [{ day: sy.stepDay, kind: "换批", source: "SYNTHETIC", synthetic: true }] };
    },
  },
  maintenance_stagger: {
    fn: maintenanceStagger,
    dataMode: (c, args) => (argHas(args, "bases") ? "LIVE" : nonEmpty(c.bases) ? "PARTIAL" : "MOCK"), // bases 真、loadByWeek 写死（A4）
    deriveArgs: (c, args) => {
      const th = injectThresholds({ staggerWindow: c.params?.maintenance?.window, minInterval: c.params?.maintenance?.minInterval, groupWeekCap: c.params?.maintenance?.groupWeekCap });
      if (argHas(args, "bases")) return { ...th, ...args };
      const bases = (c.bases ?? []).map((b, i) => ({ base: str(props(b).name, `B${i}`), group: "g1", maintWeek: 10 + (i % 3), loadByWeek: { "6": 20, "7": 5, "10": 80, "11": 8, "12": 12 } }));
      return { ...th, peakWeeks: [10, 11, 12], ...args, bases };
    },
  },
  outsourcing_split: {
    fn: outsourcingSplit,
    // RISK-TRAJECTORY-DEFAKE（G2·治本）：显式传 gap=LIVE；仅有真订单但 gap 由默认分数估算=PARTIAL（诚实标估算·
    // 非 LIVE 冒充真缺口）；无订单=MOCK。
    dataMode: (c, args) => (argHas(args, "gap") ? "LIVE" : nonEmpty(c.orders) ? "PARTIAL" : "MOCK"),
    deriveArgs: (c, args) => {
      const totalDemand = (c.orders ?? []).reduce((s, o) => s + num(props(o).qty), 0) || 100;
      const o = c.params?.outsourcing;
      const th = injectThresholds({ overtimeCost: o?.overtimeCost, outsourceCost: o?.outsourceCost, delayCost: o?.delayCost, overtimeCapPct: o?.overtimeCapPct, outsourceCapPct: o?.outsourceCapPct });
      // G2：gap 未显式传 → 按 DEFAULT_GAP_FRACTION 估算（dataMode=PARTIAL·诚实标估算，非真实缺口测量）。
      return { ...th, gap: num(args.gap, Math.round(totalDemand * DEFAULT_GAP_FRACTION)), totalDemand, ...args };
    },
  },
  quote_margin: {
    fn: quoteMargin,
    dataMode: (c, args) => (argHas(args, "bom") ? "LIVE" : nonEmpty(c.materials) ? "PARTIAL" : "MOCK"), // bom 真、price/mfgRate/logistics/floor 魔数
    deriveArgs: (c, args) => {
      const th = injectThresholds({ quoteFloorDefault: c.params?.quote?.floorDefault, quoteBand: c.params?.quote?.band });
      if (argHas(args, "bom")) return { ...th, ...args };
      const mats = (c.materials ?? []).map(props);
      return { ...th, price: num(args.price, 500), mfgRate: 0.1, logistics: 8, segmentFloor: 0.12, ...args, bom: mats.slice(0, 4).map((m) => ({ unit: num(m.bomUnit, 1), spotPrice: num(m.unitPrice, 1), processRate: 0.05 })) };
    },
  },
  credit_exposure: {
    fn: creditExposure,
    dataMode: (c, args) => (argHas(args, "creditLimit") ? "LIVE" : nonEmpty(c.customers) ? "PARTIAL" : "MOCK"), // creditLimit 可兜底 5000
    deriveArgs: (c, args) => {
      const overdueThreshold = c.params?.credit?.overdueDays ?? 30; // C32 逾期天阈 → params.credit.overdueDays
      const th = injectThresholds({ overdueDays: c.params?.credit?.overdueDays });
      if (argHas(args, "creditLimit")) return { ...th, ...args };
      const cust = (c.customers ?? []).map(props).find((x) => str(x.custName) === str(args.custName)) ?? (c.customers ?? []).map(props)[0] ?? {};
      const overdue = (c.arInvoices ?? []).map(props).filter((iv) => str(iv.custName) === str(cust.custName) && num(iv.overdueDays) > overdueThreshold).map((iv) => ({ invoiceId: str(iv.invoiceId), overdueDays: num(iv.overdueDays), amount: num(iv.amount) }));
      return { ...th, custName: str(cust.custName, str(args.custName)), creditLimit: num(cust.creditLimit, 5000), receivables: num(cust.receivables), wipUnbilled: num(cust.wipUnbilled), overdue, ...args };
    },
  },
  quarterly_gap: {
    fn: quarterlyGap,
    dataMode: (c, args) => (argHas(args, "gap") || argHas(args, "options") ? "LIVE" : "MOCK"), // 默认纯参数/默认 options
    deriveArgs: (c, args) => ({ quarter: str(args.quarter, currentQuarter(c.params.forecastStart)), gap: num(args.gap, 50), ...args }),
  },
  carbon_footprint: {
    fn: carbonFootprint,
    dataMode: (c, args) => {
      if (argHas(args, "materials")) return "LIVE";
      return nonEmpty(c.materials) ? (nonEmpty(c.energyMeters) ? "LIVE" : "PARTIAL") : "MOCK";
    },
    deriveArgs: (c, args) => {
      const euThreshold = c.params?.carbon?.euThreshold ?? 70; // C33 碳达标阈 → params.carbon.euThreshold
      const th = injectThresholds({ euThreshold: c.params?.carbon?.euThreshold });
      if (argHas(args, "materials")) return { ...th, ...args };
      const mats = (c.materials ?? []).map(props);
      const em = (c.energyMeters ?? []).map(props)[0];
      return { modelId: str(args.modelId), baseName: str(args.baseName), euThreshold, ...args, materials: mats.slice(0, 4).map((m) => ({ material: str(m.matId), unit: num(m.bomUnit, 1), factor: num(m.carbonFactor, 10) })), processes: em ? [{ process: str(em.processKey, "涂布"), energy: num(em.energyPerUnit, 2), gridFactor: num(em.gridFactor, 0.6) }] : [] };
    },
  },
  countermeasure_combo: {
    fn: countermeasureCombo,
    dataMode: (c, args) => (argHas(args, "levers") ? "LIVE" : "MOCK"), // 无真实杠杆→诚实降级(空组合)·非启发系数假值
    deriveArgs: (c, args) => {
      const totalDemand = (c.orders ?? []).reduce((s, o) => s + num(props(o).qty), 0) || 100;
      // G2：默认 gap 同口径估算（dataMode 无 levers 时已标 PARTIAL）。
      return { gap: num(args.gap, Math.round(totalDemand * DEFAULT_GAP_FRACTION)), ...args };
    },
  },
  // QUERY30 缺口③ Q01 样板：接单挤占推演。orders/lines 真对象在场（QUERY30-ONTOLOGY-EXT 五件套 + 线级 capacityDaily/certifiedModels）→ LIVE；否则 MOCK。
  what_if_displacement: {
    fn: whatIfDisplacement,
    dataMode: (c, args) => (argHas(args, "orders") || (nonEmpty(c.orders) && nonEmpty(c.lines)) ? "LIVE" : "MOCK"),
    deriveArgs: (c, args) => {
      // 显式 orders 优先（直接单测/编排显式喂）；否则从本体对象图装配（按 baseId 过滤在手单 + 线级产能/认证型号）。
      const baseId = str(args.baseId);
      const th = injectThresholds({ advanceErosion: c.params?.displacement?.advanceErosion, outsourceMarginHit: c.params?.displacement?.outsourceMarginHit, outsourceUnitCost: c.params?.displacement?.outsourceUnitCost, baseMargin: c.params?.displacement?.baseMargin });
      if (argHas(args, "orders")) return { ...th, ...args };
      const lines = (c.lines ?? []).map(props)
        .filter((l) => baseId === "" || str(l.baseId) === baseId)
        .map((l) => ({ lineId: str(l.lineId), capacityDaily: num(l.capacityDaily), certifiedModels: Array.isArray(l.certifiedModels) ? l.certifiedModels : [] }));
      const orders = (c.orders ?? []).map(props)
        .filter((o) => baseId === "" || (Array.isArray(o.bases) && (o.bases as string[]).includes(baseId)))
        .map((o) => ({ so: str(o.so), cust: str(o.cust), model: str(o.model), qty: num(o.qty), pri: str(o.pri, "中"), marginPct: num(o.marginPct), penaltyClause: num(o.penaltyClause), substitutable: o.substitutable === true, unitPrice: num(o.unitPrice, 600) }));
      // 急单单价：取同型号在手单单价（真值锚）或型号目录价，均缺则内联默认。
      const modelUnit = orders.find((o) => o.model === str(args.model))?.unitPrice
        ?? num((c.models ?? []).map(props).find((m) => str(m.modelId) === str(args.model))?.unitPrice, 600);
      return { ...th, newUnitPrice: modelUnit, ...args, lines, orders };
    },
  },
  // QUERY30 缺口③ Q01 样板：多方案五维比较矩阵（纯聚合层）。显式 schemes → LIVE；否则复用 what_if_displacement
  // 装配急单推演产出四型方案再喂入（dataMode 随 what_if_displacement 诚实位·非本层新真值）。
  multi_plan_compare: {
    fn: multiPlanCompare,
    dataMode: (c, args) => (argHas(args, "schemes") ? "LIVE" : EXTENDED_REGISTRY.what_if_displacement!.dataMode(c, args)),
    deriveArgs: (c, args) => {
      if (argHas(args, "schemes")) return args;
      // 无显式方案集 → 经 what_if_displacement 的 deriveArgs 装配急单推演入参、跑出四型方案，投入比较层（纯派生·R6）。
      const wdArgs = EXTENDED_REGISTRY.what_if_displacement!.deriveArgs(c, args);
      const wd = whatIfDisplacement(wdArgs);
      return { ...args, schemes: wd.schemes };
    },
  },
};

/** 13+1 新增求解器分派 map（service.compute 扩展分支）——从 EXTENDED_REGISTRY 派生（单一来源·防漂移）。 */
export const EXTENDED_SOLVERS: Record<string, (args: Record<string, unknown>) => Record<string, unknown>> =
  Object.fromEntries(Object.entries(EXTENDED_REGISTRY).map(([k, d]) => [k, d.fn]));

/**
 * A0（空洞数据冰山结构性根因修）· 扩展求解器诚实位——**派生自** `EXTENDED_REGISTRY[key].dataMode`
 * （原 switch 各 case 已逐字迁入各 descriptor）。据「真对象 vs 魔数/硬编码兜底」确定性判 LIVE/MOCK/PARTIAL；
 * 未登记 key → MOCK（诚实兜底）。前端据此标徽章；与产能/风险已有 dataMode 范式同口径。
 */
export function extendedDataMode(
  c: SolverContext,
  solverKey: string,
  args: Record<string, unknown>,
): "LIVE" | "MOCK" | "PARTIAL" {
  return EXTENDED_REGISTRY[solverKey]?.dataMode(c, args) ?? "MOCK";
}

/**
 * E6b：当场景仅给 presetContext 槽位、未显式传齐 args 时，从对象数据（SolverContext §7 扩展）推导各求解器
 * 输入 args（已传 args 优先保留）。**派生自** `EXTENDED_REGISTRY[key].deriveArgs`（原 switch 各 case 已逐字迁入）；
 * 未登记 key → 原样返回 args。让 20 场景从 presetContext 端到端出结果。
 */
export function deriveExtendedArgs(c: SolverContext, solverKey: string, args: Record<string, unknown>): Record<string, unknown> {
  return EXTENDED_REGISTRY[solverKey]?.deriveArgs(c, args) ?? args;
}
