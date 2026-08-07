import type { ObjectInstance } from "../domain.js";
import { AppError } from "../errors.js";
import { round } from "../prng.js";
// WO-ENGINE-SCOPE-FIX（#116/#117 引擎层作用域维）：base 解析走 `resolveBaseRef` **单一出处**
// （= risk.resolveBaseId / capacity 用的同一份·认 baseId/中文名/obj_base_ 前缀/近指），
// 本文件**不许**再写第二套「中文名 → baseId」匹配（R14·types.ts 已把这条纪律写死）。
import { baseName as baseNameOf, maintWeekOf, num, resolveBaseRef, str, type SolverContext } from "./types.js";
// WO-ENGINE-SCOPE-FIX2（#116 A 档③ mitigation_select 基地维）：紧张度**不另算一份** ——
// 复用 `risk.ts` 里 `bottleneck_matrix` 今天就在用的那一个 `liveTightness`（LIVE 三分支 + 自带 MOCK 回落），
// 保证「处置选型看到的紧张度」与「瓶颈矩阵/风险时间线看到的」**同基地同因素同值**（R14 单一出处·口径不漂移）。
// 无环：risk.ts 不 import 本文件（本文件的唯一 src 消费方是 service.ts）。
import { liveTightness } from "./risk.js";
// DF.13 外协红线单一来源（C08）：外协渠道上限/释放量禁内联裸阈值，一律经 outsourceRedlineCap 派生（R14·R-一致）。
// WO-SANDBOX-D2：采购段四段（按责任方）契约 + 唯一合计实现，见 packages/contracts/src/procurement.ts。
import {
  outsourceRedlineCap,
  PROCUREMENT_LEG_OWNER,
  criticalProcurementLeg,
  makeProcurementLeadTime,
  procurementDaysByOwner,
  type ProcurementLeg,
  type ProcurementPlan,
} from "@platform/contracts";
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
  // WO-ENGINE-SCOPE-FIX2：张力来源披露（LIVE=读到该基地真 OEE/利用率/良率；MOCK=按 (基地,因素) 确定性估算）。
  // 由 `deriveExtendedArgs` 在解析出基地后注入；调用方直传 tightness / 未给基地 → 键不出现（加性）。
  const dataMode = str(args.tightnessDataMode);
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
    ...(dataMode ? { tightness, dataMode } : {}),
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

/**
 * WO-SANDBOX-D2 · 采购段四段凭证（每个物料一份，由 `deriveExtendedArgs` 从真对象装配后随 args 下发）。
 * 引擎侧**只做算术不猜数据**：这里的每一段要么带 `days`+出处，要么带 `status:"EMPTY"`+缺什么。
 */
export interface ProcurementEvidence {
  supplierId: string | null;
  supplierName: string | null;
  minOrderQty: number | null;
  onTimeRate: number | null;
  legs: ProcurementLeg[];
}

/**
 * WO-SANDBOX-D2 · 由四段凭证 + 净缺口 → `ProcurementPlan`（"补这一票要多久、买多少、找谁"）。
 * 纯函数（R6）。总耗时/最早齐套日/补货量一律经 contracts 的唯一实现派生，本函数不另算一份。
 */
export function buildProcurementPlan(ev: ProcurementEvidence, shortage: number, orderPlacedDay: number): ProcurementPlan {
  const leadTime = makeProcurementLeadTime(ev.legs);
  const earliestKitDay = leadTime.totalDays === null ? null : orderPlacedDay + leadTime.totalDays;
  // 期望滑期 = 供应商段天数 × (1 − 准时率)。任一输入缺 → null（**不拿 0 冒充"不会晚"**）。
  const supplierLeg = ev.legs.find((l) => l.leg === "supplier_production");
  const expectedSlipDays =
    ev.onTimeRate === null || supplierLeg === undefined || supplierLeg.days === null
      ? null
      : round(supplierLeg.days * (1 - ev.onTimeRate), 4);
  return {
    supplierId: ev.supplierId,
    supplierName: ev.supplierName,
    leadTime,
    minOrderQty: ev.minOrderQty,
    shortage: round(shortage, 4),
    // MOQ 接线（此前 `minOrderQty` 在 solvers/ 零消费方）：缺 3 但起订 1000 → 就得买 1000。
    replenishQty: ev.minOrderQty === null ? null : round(Math.max(round(shortage, 4), ev.minOrderQty), 4),
    moqApplied: ev.minOrderQty !== null && ev.minOrderQty > round(shortage, 4),
    onTimeRate: ev.onTimeRate,
    expectedSlipDays,
    orderPlacedDay,
    earliestKitDay,
    expectedKitDay: earliestKitDay === null || expectedSlipDays === null ? null : round(earliestKitDay + expectedSlipDays, 4),
  };
}

// S08 kit_readiness：齐套率 = min_物料((现库+ETA≤开工的在途)/(BOM单耗×qty))。
//
// WO-SANDBOX-D2：缺料行不再只给「一个最早补齐日」，而是给**按责任方分解的采购段**——
// 供应商生产 / 在途 / 清关 / 到货检验四段各自的天数、责任方与出处（`procurement`）。
// 之前只能答"晚了"，现在能答"晚在哪一段、该找谁"。四段不全 → `earliestKitDay: null` +
// `earliestKitDayStatus: "EMPTY"`（**绝不用已知几段之和冒充一个日期**）。
export function kitReadiness(args: Record<string, unknown>) {
  const orders =
    (args.orders as {
      orderId: string;
      qty: number;
      startDay: number;
      materials: { material: string; onHand: number; inTransit: { qty: number; etaDay: number }[]; bomUnit: number; procurement?: ProcurementEvidence }[];
    }[]) ?? [];
  // 起采日 = 分析窗起点（缺省 1）。`procurement` 缺席时不参与任何计算。
  const orderPlacedDay = num(args.fromDay, 1);
  const rows = orders.map((o) => {
    const items = o.materials.map((m) => {
      const avail = m.onHand + m.inTransit.filter((t) => t.etaDay <= o.startDay).reduce((s, t) => s + t.qty, 0);
      const need = m.bomUnit * o.qty;
      const ratio = need <= 0 ? 1 : round(avail / need, 4);
      const shortage = round(Math.max(0, need - avail), 4);
      // 缺料时最早补齐日 = 开工日之后最早到货的在途批次 ETA
      const earliest = avail < need ? m.inTransit.filter((it) => it.etaDay > o.startDay).sort((a, b) => a.etaDay - b.etaDay)[0]?.etaDay : undefined;
      // WO-SANDBOX-D2：**在途"最早到一批"≠"够了"**。原 `earliestDay` 只取最早那一批的 ETA，不看它能不能补上缺口
      //（在途 1169 对缺口 68267 也算"顺延到那天"）。这里按 ETA 升序累加，真够了的那一批的 ETA 才是
      // "靠在途就能齐套"的日子；一直不够 → `null`（那就只能重新采购，走下面四段）。`earliestDay` 保留不动（向后兼容）。
      const coveringEtaDay = (() => {
        if (shortage <= 0) return null;
        let cum = 0;
        for (const t of m.inTransit.filter((x) => x.etaDay > o.startDay).sort((a, b) => a.etaDay - b.etaDay)) {
          cum += t.qty;
          if (cum >= shortage) return t.etaDay;
        }
        return null;
      })();
      const base = { material: m.material, ratio, shortage, earliestDay: earliest, coveringEtaDay };
      if (shortage <= 0 || m.procurement === undefined) return base;
      const plan = buildProcurementPlan(m.procurement, shortage, orderPlacedDay);
      const critical = criticalProcurementLeg(plan.leadTime.legs);
      return {
        ...base,
        procurement: plan,
        /** 责任方汇总（"这些天里谁占了多少"）；EMPTY 段计入 unknownOwners，**不摊到任何人头上**。 */
        ownerDays: procurementDaysByOwner(plan.leadTime.legs),
        /** 最该找的那一个（实测段里天数最大的）。四段无一实测 → null。 */
        criticalLeg: critical === null ? null : { leg: critical.leg, owner: critical.owner, ownerRef: critical.ownerRef, days: critical.days },
      };
    });
    const kitRatio = items.length ? Math.min(...items.map((i) => i.ratio)) : 1;
    const shortItems = items.filter((i) => i.ratio < 1).sort((a, b) => (a.earliestDay ?? 1e9) - (b.earliestDay ?? 1e9));
    const advice = kitRatio >= 1 ? "齐套" : shortItems.some((i) => i.earliestDay === undefined) ? "加急采购" : "顺延";
    // 整单最早齐套日 = 各缺料项补齐日取最晚（木桶）。任一项算不出 → 整单 EMPTY（诚实缺席）。
    // 单项补齐日 = 两条路取早者：① 在途真能补上缺口的那一批 ETA ② 现在下单重采（四段合计）。
    const perItemDay = shortItems.map((i) => {
      const p = (i as { procurement?: ProcurementPlan }).procurement;
      const routes: number[] = [];
      if (i.coveringEtaDay !== null && i.coveringEtaDay !== undefined) routes.push(i.coveringEtaDay);
      if (p !== undefined && p.earliestKitDay !== null) routes.push(p.earliestKitDay);
      if (routes.length === 0) return null; // 两条路都算不出 → 不知道就是不知道
      return Math.min(...routes);
    });
    const unresolved = shortItems.filter((_, idx) => perItemDay[idx] === null).map((i) => i.material);
    const earliestKitDay = shortItems.length === 0 ? o.startDay : unresolved.length > 0 ? null : Math.max(...(perItemDay as number[]));
    return {
      orderId: o.orderId,
      kitRatio: round(kitRatio, 4),
      shortItems,
      advice,
      earliestKitDay,
      earliestKitDayStatus: earliestKitDay === null ? "EMPTY" : "MEASURED",
      ...(earliestKitDay === null ? { earliestKitDayReason: `以下物料的采购段四段不全，无法结算最早齐套日（拒绝用已知几段之和冒充日期）：${unresolved.join("、")}` } : {}),
    };
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
  return {
    lineId,
    sequence: seq,
    totalChangeoverMin: total,
    savedVsDueMin: round(dueTotal - total, 4),
    infeasible,
    // WO-ENGINE-SCOPE-FIX2：产线维诚实标注（由 `deriveExtendedArgs` 在用户真给了 `lineId` 时注入·见那里的理由）。
    ...(args.lineScope !== undefined ? { lineScope: args.lineScope } : {}),
    ruleRefs: ["C22", "C29"],
  };
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
  return {
    quarter,
    combo,
    residualGap: round(Math.max(0, gap), 4),
    // WO-ENGINE-SCOPE-FIX2：季度维诚实标注（由 `deriveExtendedArgs` 在"给了季度但没给缺口"时注入·见那里的理由）。
    ...(args.quarterScope !== undefined ? { quarterScope: args.quarterScope } : {}),
    ruleRefs: ["C08", "C29"],
  };
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

/** 进口判据（与合成种子 `battery-extended.ts supplierIsImport` 同口径：`Supplier.sourceMode === "进口"`）。 */
const SOURCE_MODE_IMPORT = "进口";

/**
 * WO-SANDBOX-D2 · **数据半 → 引擎半的接缝**：把真对象装配成采购段四段凭证。
 *
 * 每一段只有两种下场：**读到了**（`MEASURED` + `days` + `source` 指得出是哪个对象哪个字段），
 * 或者**没读到**（`NOT_APPLICABLE` 有据可依的 0 / `EMPTY` 诚实 null）。
 * 一个都不许"看着合理地填个默认值"——那正是本仓「静默错答比跑不通更糟」要堵的形态。
 *
 * 四段的真源：
 *  ① 供应商生产 ← `Supplier.leadTime`（承诺前置期）
 *  ② 在途       ← `Supplier.transitDays` / 责任方 `Supplier.carrierName`
 *  ③ 清关       ← `CustomsClearance.clearedDay − declaredDay` 的历史实测（**仅进口**；
 *                  境内直供 = 结构上没有这个环节 → `NOT_APPLICABLE`，不是 EMPTY 也不是假的 0）
 *  ④ 到货检验   ← `IncomingInspection.releasedDay − arrivedDay` 的历史实测（按物料聚合）
 *
 * 聚合口径：多条记录取**均值并四舍五入到 2 位**（确定性 · R6）。取用到的对象 id 全列进 `source.objectIds`，
 * 便于当场下钻核对（R13）。
 */
export function buildProcurementEvidence(c: SolverContext): (mat: Record<string, unknown>) => ProcurementEvidence {
  const props = (o: ObjectInstance) => o.props as Record<string, unknown>;
  const supplierByIdEntries = (c.suppliers ?? []).map((o) => [str(props(o).supplierId), { id: o.id, p: props(o) }] as const);
  const supplierById = new Map(supplierByIdEntries);
  // 清关记录按供应商归集（清关耗时是"这家供应商这条进口通道"的属性）。
  const customsBySupplier = new Map<string, { id: string; p: Record<string, unknown> }[]>();
  for (const o of c.customsClearances ?? []) {
    const sid = str(props(o).supplierId);
    if (!sid) continue;
    (customsBySupplier.get(sid) ?? customsBySupplier.set(sid, []).get(sid)!).push({ id: o.id, p: props(o) });
  }
  // 检验记录按物料归集（检验耗时是"这个物料的检验项集"的属性）。
  const iqcByMat = new Map<string, { id: string; p: Record<string, unknown> }[]>();
  for (const o of c.incomingInspections ?? []) {
    const mid = str(props(o).matId);
    if (!mid) continue;
    (iqcByMat.get(mid) ?? iqcByMat.set(mid, []).get(mid)!).push({ id: o.id, p: props(o) });
  }
  const meanDays = (rows: { id: string; p: Record<string, unknown> }[], from: string, to: string): number | null => {
    const spans = rows.map((r) => num(r.p[to]) - num(r.p[from])).filter((d) => Number.isFinite(d) && d >= 0);
    if (spans.length === 0) return null;
    return round(spans.reduce((s, d) => s + d, 0) / spans.length, 2);
  };
  const emptyLeg = (leg: ProcurementLeg["leg"], reason: string): ProcurementLeg => ({ leg, owner: PROCUREMENT_LEG_OWNER[leg], ownerRef: null, days: null, status: "EMPTY", reason, source: null });

  return (mat: Record<string, unknown>): ProcurementEvidence => {
    const matId = str(mat.matId);
    const supplierId = str(mat.supplierId);
    const sup = supplierId ? supplierById.get(supplierId) : undefined;

    // ── ① 供应商生产段 ──────────────────────────────────────────────
    const legs: ProcurementLeg[] = [];
    if (sup === undefined) {
      legs.push(emptyLeg("supplier_production", supplierId ? `物料 ${matId} 的主供应商 ${supplierId} 在 Supplier 对象库中查无此人` : `物料 ${matId} 未绑定主供应商（Material.supplierId 缺失）`));
    } else if (typeof sup.p.leadTime !== "number") {
      legs.push(emptyLeg("supplier_production", `供应商 ${supplierId} 无 leadTime（承诺前置期）字段`));
    } else {
      legs.push({ leg: "supplier_production", owner: PROCUREMENT_LEG_OWNER.supplier_production, ownerRef: str(sup.p.name) || supplierId, days: sup.p.leadTime, status: "MEASURED", source: { objectType: "Supplier", objectIds: [sup.id], field: "leadTime" } });
    }

    // ── ② 在途段 ────────────────────────────────────────────────────
    if (sup === undefined) {
      legs.push(emptyLeg("in_transit", `无供应商 ⇒ 取不到在途运输前置期（Supplier.transitDays）`));
    } else if (typeof sup.p.transitDays !== "number") {
      legs.push(emptyLeg("in_transit", `供应商 ${supplierId} 无 transitDays（在途运输天数）字段`));
    } else {
      legs.push({ leg: "in_transit", owner: PROCUREMENT_LEG_OWNER.in_transit, ownerRef: str(sup.p.carrierName) || null, days: sup.p.transitDays, status: "MEASURED", source: { objectType: "Supplier", objectIds: [sup.id], field: "transitDays" } });
    }

    // ── ③ 清关段（三态在这里最关键）──────────────────────────────────
    if (sup === undefined) {
      legs.push(emptyLeg("customs", `无供应商 ⇒ 判定不了是否进口，清关段既不能算 0 也不能算数`));
    } else if (str(sup.p.sourceMode) !== SOURCE_MODE_IMPORT) {
      // 结构上没有这个环节 —— 这是**真值 0**，有据可依，不是"不知道"。
      legs.push({ leg: "customs", owner: PROCUREMENT_LEG_OWNER.customs, ownerRef: null, days: 0, status: "NOT_APPLICABLE", reason: `供应商 ${str(sup.p.name) || supplierId} 为境内直供（Supplier.sourceMode=${str(sup.p.sourceMode) || "未标注"}），无清关环节`, source: null });
    } else {
      const rows = (customsBySupplier.get(supplierId) ?? []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
      const days = meanDays(rows, "declaredDay", "clearedDay");
      if (days === null) {
        legs.push(emptyLeg("customs", `供应商 ${supplierId} 为进口来源但无清关记录（CustomsClearance 0 条）——不拿 0 天冒充`));
      } else {
        const brokers = [...new Set(rows.map((r) => str(r.p.brokerName)).filter(Boolean))];
        legs.push({ leg: "customs", owner: PROCUREMENT_LEG_OWNER.customs, ownerRef: brokers.length === 1 ? brokers[0]! : null, days, status: "MEASURED", ...(brokers.length === 1 ? {} : { reason: `${rows.length} 条清关记录涉及 ${brokers.length} 家清关行，责任方不唯一` }), source: { objectType: "CustomsClearance", objectIds: rows.map((r) => r.id), field: "clearedDay-declaredDay" } });
      }
    }

    // ── ④ 到货检验段 ────────────────────────────────────────────────
    const iqcRows = (iqcByMat.get(matId) ?? []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
    const iqcDays = meanDays(iqcRows, "arrivedDay", "releasedDay");
    if (iqcDays === null) {
      legs.push(emptyLeg("incoming_inspection", `物料 ${matId} 无到货检验记录（IncomingInspection 0 条）——到厂≠可投产，这段不许当 0`));
    } else {
      const teams = [...new Set(iqcRows.map((r) => str(r.p.inspectorTeam)).filter(Boolean))];
      legs.push({ leg: "incoming_inspection", owner: PROCUREMENT_LEG_OWNER.incoming_inspection, ownerRef: teams.length === 1 ? teams[0]! : null, days: iqcDays, status: "MEASURED", ...(teams.length === 1 ? {} : { reason: `${iqcRows.length} 条检验记录涉及 ${teams.length} 个检验班组，责任方不唯一` }), source: { objectType: "IncomingInspection", objectIds: iqcRows.map((r) => r.id), field: "releasedDay-arrivedDay" } });
    }

    return {
      supplierId: sup === undefined ? null : supplierId,
      supplierName: sup === undefined ? null : str(sup.p.name) || null,
      minOrderQty: sup !== undefined && typeof sup.p.minOrderQty === "number" ? sup.p.minOrderQty : null,
      onTimeRate: sup !== undefined && typeof sup.p.onTimeRate === "number" ? sup.p.onTimeRate : null,
      legs,
    };
  };
}

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
      // WO-SANDBOX-D2：每个物料带上**采购段四段凭证**（供应商生产/在途/清关/到货检验），
      // 让齐套判定能按责任方分解，而不是只给 `Material.leadTime` 这一个合成标量。
      const evidenceOf = buildProcurementEvidence(c);
      const orders = (c.orders ?? []).slice(0, 8).map((o, i) => ({
        orderId: str(props(o).so, `O${i}`),
        qty: num(props(o).qty, 100),
        startDay: 7,
        materials: mats.slice(0, 4).map((m) => ({
          material: str(m.matId),
          onHand: num(m.onHand),
          inTransit: [{ qty: num(m.inTransit), etaDay: num(m.leadTime, 10) }],
          bomUnit: num(m.bomUnit, 1),
          procurement: evidenceOf(m),
        })),
      }));
      return { fromDay: 1, toDay: 14, ...args, orders };
    }
    case "lta_gap": {
      if (has("monthDemand")) return args;
      // ── WO-ENGINE-SCOPE-FIX #116 · A 组②「物料维只回显」（G-SOLVER-SCOPE-ECHO）────────────────
      // 修前：`mats.find((x) => str(x.matId) === str(args.material)) ?? mats[0]`
      //   —— 只匹**英文键** `matId`，而场景卡 S09 的 slotPreset 传的是**中文名**「三元正极」
      //   （`Material` 同时有 `matId:"pos_ncm"` 与 `name:"三元正极"` 两列，只匹了前者）
      //   → 恒落 `mats[0]`（按 id 排序首行 = 铝箔 al_foil），而输出把用户说的「三元正极」原样回显。
      //   实测（seed 42）：`{material:"三元正极"}` 与 `{material:"铝箔"}` 逐字节相同（netDemand 21637.68）。
      // 修后两件一起做：
      //   ① 补匹 `Material.name`（matId 精确 → name 精确，两层皆精确·无近指，R6 确定性）；
      //   ② **删掉 `?? mats[0]` 这个静默兜底** —— 它本身就是病，与已闭的 `G-ARG-DROP-SEAM` 同形：
      //      指定了物料却匹不到，诚实答案是**缺席（400）**，不是把首行的数字冠上用户说的名字。
      // 加性：不指定 `material` 时仍取 `mats[0]`（与改前逐字节一致）。
      const wantedMat = str(args.material);
      let m: Record<string, unknown> | undefined;
      if (wantedMat) {
        m = mats.find((x) => str(x.matId) === wantedMat) ?? mats.find((x) => str(x.name) === wantedMat);
        if (!m)
          throw new AppError(
            "AMBIGUOUS_SCOPE",
            `lta_gap：问句指定物料「${wantedMat}」在物料库中无匹配（试过 Material.matId / Material.name·扫 ${mats.length} 行）` +
              `——拒绝静默落首个物料（R-ARG-FIDELITY·G-ARG-DROP-SEAM）`,
            400,
          );
      } else {
        m = mats[0];
      }
      const mm = m ?? {};
      return { material: str(args.material, str(mm.matId, "三元正极")), month: str(args.month, "2026-07"), monthDemand: round(num(mm.dailyUse, 100) * 30, 2), bomUnit: num(mm.bomUnit, 1), inventory: num(mm.onHand), inTransit: num(mm.inTransit), ltaAnnualLock: round(num(mm.dailyUse, 100) * 365 * 0.8, 0), monthQuota: 1 / 12, executedThisMonth: 0, leadDays: num(mm.leadTime, 30), ...args };
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
      // ── WO-ENGINE-SCOPE-FIX2 #116 · A 档①「产线维只回显」→ **裁决 ③：不造假个性化，显性标缺席** ────
      // 为什么这一条不能像 carbon/lta/mitigation 那样"补一行过滤就好"（追一层后三条硬证据）：
      //   ① **换型矩阵没有产线维，而且是生成器写死的**：`synthetic/battery-extended.ts:667`
      //      `lineId: null,  // 无线级实测 → 全局值（诚实回退）` —— 30/30 行恒 null，不是漏灌，是设计如此。
      //      ⇒ 就算把订单按产线筛出来，`minutes` 仍是全局值，"这条线的换型时长"无从谈起。
      //   ② **订单侧没有产线归属**：`Order` 只有 `bases[]`（基地数组），全链没有 `Order→Line` 的边。
      //   ③ 唯一带真 `lineId` 的是 `WorkOrder`（每线 2 单·`battery.ts:4051`），但它的型号取自
      //      `WO_MODELS = [4680-NCM, 4680-LFP, 方形-LFP, 储能-280Ah, 储能-314Ah]`，其中
      //      **`储能-280Ah` / `储能-314Ah` 不在 `MODELS` 六型号里**（`battery.ts:54-60`）⇒ 不在换型矩阵里
      //      ⇒ `matrix[from]?.[to] ?? 0` 会把「不知道换型多久」算成「换型 0 分钟」。
      //      接上去 = 把今天的"回显别人的队列"换成"编造的 0 分钟换型"，**比现状更坏**
      //      （同 `G-YIELD-SERIES-SOURCE-MISMATCH` 那一课：喂不动算法的源，接了比不接更危险）。
      // 故本单只做两件**不撒谎**的事：
      //   ① 用户给的 `lineId` 必须**真存在**（对 `Line.lineId` 精确校验）—— 不存在即 400，
      //      绝不把一个不存在的产线名印在一张排序表上（今天 `LINE-WS-火星-x` 照样回显）；
      //   ② 输出加 `lineScope.dataMode:"EMPTY"` + `missingInputs`（抄 `inventory_optimize.locationAxis`
      //      这个本仓公认的模范），把「这张表不是这条产线的队列」写进答案本身。
      // 加性：**不给 `lineId` → `lineScope` 键不出现**，逐字节同改前（含 `lineId:"L1"` 这个既有缺省）。
      const wantedLine = str(args.lineId);
      let lineScope: Record<string, unknown> | undefined;
      if (wantedLine) {
        const line = (c.lines ?? []).map(props).find((l) => str(l.lineId) === wantedLine);
        if (!line)
          throw new AppError(
            "AMBIGUOUS_SCOPE",
            `changeover_sequence：问句指定产线「${wantedLine}」在产线台账中无匹配（扫 Line ${(c.lines ?? []).length} 行）` +
              `——拒绝把不存在的产线名印在一张排序表上（R-ARG-FIDELITY·G-SOLVER-SCOPE-ECHO）`,
            400,
          );
        lineScope = {
          dataMode: "EMPTY",
          lineId: wantedLine,
          baseId: str(line.baseId),
          reason:
            "本次排序用的是**全局换型矩阵 + 全网前 6 张订单**，不是这条产线自己的队列：" +
            "ChangeoverMatrix 的 lineId 全库恒 null（合成器写死全局值·无线级实测），Order 也没有产线归属字段。" +
            "拒绝把全网排序冠上这条产线的名字冒充线级排产。",
          missingInputs: [
            { objectType: "ChangeoverMatrix", property: "lineId", need: "线级换型分钟（今日 30/30 恒 null → 只有全局矩阵）" },
            { objectType: "Order", property: "lineId", need: "订单→产线归属（今日只有 bases[]，无 Order→Line 边）" },
            { objectType: "WorkOrder", property: "modelId", need: "工单型号需落在 Model 六型号内（今日 5 个取值里 储能-280Ah/储能-314Ah 不在换型矩阵中 → 换型时长无从查）" },
          ],
        };
      }
      return { lineId: str(args.lineId, "L1"), ...args, ...(lineScope ? { lineScope } : {}), orders, matrix, current: orders[0]?.modelId };
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
      // ── WO-ENGINE-SCOPE-FIX #116 · A 组①「基地维只回显」（G-SOLVER-SCOPE-ECHO·最危险也最便宜的一条）──
      // 修前：`const em = (c.energyMeters ?? []).map(props)[0];`
      //   —— **任何基地**问都拿 `EnergyMeter` 排序首行（常州 em_changzhou）的电网因子，
      //   而 `baseName` 被原样回显进输出（`carbonFootprint()` 第 :522 行）→ 用户看见「成都」，
      //   `energyCarbon` 算的却是常州：实测 seed 42 成都/枣庄/江门三问，`total` 全是 349.6151、
      //   `energyCarbon` 全是 1.3041（= 常州 2.371 × 0.55）。真值应各不相同
      //   （成都 1.549×0.78=1.2082 / 枣庄 2.573×0.70=1.8011 / 江门 1.849×0.50=0.9245）——
      //   13 行 EnergyMeter **每基地一行**且早已在 `SolverContext` 里（`withExtended` 十类含 EnergyMeter），
      //   数据一直都在，只是求解器取了 `[0]`。这是「接了线接错地方」，不是「没数据」（铁律 0.5 三态）。
      // 修后：
      //   ① 认 `baseName`（卡片/argHints 用）**与** `base`（路由 baseArgsFrom 用）两个键 —— 键名漂移不该让作用域失效；
      //   ② 解析走 `resolveBaseRef` 单一出处；解析不到 → **AMBIGUOUS_SCOPE 400**（抄 `credit_exposure` 的样板，
      //      拒绝静默落首行）；解析到但该基地无 EnergyMeter → 同样 400，绝不拿别的基地的电表冒充；
      //   ③ 回显位改成**真正被算的那个基地的规范名**（用 baseId 问也回显中文名）—— 印在答案上的名字
      //      与数字出自同一个基地，这正是本单要治的「假个性化」。
      // 加性：不给 `baseName`/`base`（S20 卡片今天正是 `baseName:""` 中性默认）→ 仍取 `[0]`，与改前逐字节一致。
      const meters = (c.energyMeters ?? []).map(props);
      const baseRefRaw = str(args.baseName) !== "" ? args.baseName : args.base;
      const baseRef = str(baseRefRaw) !== "" || (baseRefRaw !== null && typeof baseRefRaw === "object") ? baseRefRaw : undefined;
      let em = meters[0];
      let scopedBaseName = "";
      if (baseRef !== undefined) {
        const r = resolveBaseRef(c.bases, baseRef);
        if (!r.resolved || !r.objectId)
          throw new AppError(
            "AMBIGUOUS_SCOPE",
            `carbon_footprint：问句指定基地「${str(baseRefRaw) || JSON.stringify(baseRefRaw)}」在基地库中无匹配` +
              `${r.ambiguous ? `（歧义·候选 ${(r.candidates ?? []).map((x) => x.objectId).join("、")}）` : `（扫 ${c.bases.length} 行）`}` +
              `——拒绝静默落首块电表（R-ARG-FIDELITY·G-ARG-DROP-SEAM）`,
            400,
          );
        const scopedBaseId = r.objectId;
        scopedBaseName = baseNameOf(c, scopedBaseId);
        const hit = meters.find((x) => str(x.baseId) === scopedBaseId);
        if (!hit)
          throw new AppError(
            "AMBIGUOUS_SCOPE",
            `carbon_footprint：基地「${scopedBaseName}」无 EnergyMeter（单位能耗/电网因子）真源——` +
              `拒绝拿其它基地的电表冒充该基地的能耗碳（R-ARG-FIDELITY·G-SOLVER-SCOPE-ECHO）`,
            400,
          );
        em = hit;
      }
      // ── WO-ENGINE-SCOPE-FIX2 #116 · A 档②「型号维只回显」（同一个求解器的第二处假个性化）────────
      // 修前：物料段恒取 `mats.slice(0,4)` = `Material` 按 id 排序的**前 4 行**（al_foil/cell_case/cu_foil/elyte
      //   —— 连正极都不在里面），与 `modelId` **毫无关系**；实测 `4680-NCM` 与 `方形-LFP` 抹掉 `$.modelId`
      //   后逐字节相同（`materialCarbon` 恒 348.311）。而输出把用户问的型号原样印在 `$.modelId` 上。
      // 三态定性 = **没接线**（不是没数据）：真 BOM 一直在库
      //   （`BOMHeader.modelId` + `BOMDetail.materialId/quantity/lossRate`·`synthetic/battery.ts:3365/3382`），
      //   只是 `BOMHeader`/`BOMDetail` **从没进过 `SolverContext`**（本单已加·见 types.ts 字段注释）。
      // 修后：给了 `modelId` → 取该型号的 BOM（多版本时取 `sortById` 排序首个 BOM —— 同型号各版本
      //   共用同一份 `BOM_ITEM_TEMPLATES`，量值本就相同，选哪版不改数字，只改 `bomId`），
      //   逐行 `unit = quantity × (1 + lossRate)`（损耗率是真列，不吞），`factor` 取该物料 `Material.carbonFactor`。
      //   该型号无 BOM / BOM 明细全部对不上 `Material` → **`AMBIGUOUS_SCOPE` 400**，绝不回落全局前 4 行
      //   （回落正是本单要治的病：把「铝箔+壳体+铜箔+电解液」的碳排印上用户问的型号名）。
      // ⚠ 实事求是：本 seed 里各型号 BOM 只在正极那一行分叉（NCM 用 `pos_ncm` 1.05kg / LFP 用 `pos_lfp` 1.0kg，
      //   其余 6 行完全相同）⇒ **两个 NCM 型号之间碳足迹本就应当相同**，那不是没重算，那是真值如此。
      //   差分门据此只断言「跨化学体系必须不同」，不假装同体系也会不同。
      // 加性：不给 `modelId`（S20 卡片今天给的是 `modelId:"4680-NCM"`，但 `{}` 与规则 payload 路都不给）
      //   → 仍取 `mats.slice(0,4)`，与改前逐字节一致。
      const wantedModel = str(args.modelId);
      let bomMaterials: { material: string; unit: number; factor: number }[] | undefined;
      if (wantedModel) {
        const heads = (c.bomHeaders ?? []).map(props).filter((h) => str(h.modelId) === wantedModel);
        const bomId = heads.length > 0 ? str(heads[0]!.bomId) : "";
        const details = bomId ? (c.bomDetails ?? []).map(props).filter((d) => str(d.bomId) === bomId) : [];
        const byMatId = new Map(mats.map((m) => [str(m.matId), m]));
        const rows = details
          .map((d) => {
            const m = byMatId.get(str(d.materialId));
            return m === undefined ? null : { material: str(d.materialId), unit: round(num(d.quantity, 0) * (1 + num(d.lossRate, 0)), 6), factor: num(m.carbonFactor, 10) };
          })
          .filter((x): x is { material: string; unit: number; factor: number } => x !== null);
        if (rows.length === 0)
          throw new AppError(
            "AMBIGUOUS_SCOPE",
            `carbon_footprint：问句指定型号「${wantedModel}」无可用 BOM（BOMHeader 命中 ${heads.length} 份 / BOMDetail 明细 ${details.length} 行 / 能对上 Material 的 ${rows.length} 行）` +
              `——拒绝拿与型号无关的全局前 4 种物料冒充该型号的物料碳（R-ARG-FIDELITY·G-SOLVER-SCOPE-ECHO）`,
            400,
          );
        bomMaterials = rows;
      }
      return { modelId: str(args.modelId), baseName: str(args.baseName), euThreshold: 70, ...args, ...(scopedBaseName ? { baseName: scopedBaseName } : {}), materials: bomMaterials ?? mats.slice(0, 4).map((m) => ({ material: str(m.matId), unit: num(m.bomUnit, 1), factor: num(m.carbonFactor, 10) })), processes: em ? [{ process: str(em.processKey, "涂布"), energy: num(em.energyPerUnit, 2), gridFactor: num(em.gridFactor, 0.6) }] : [] };
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
    case "quarterly_gap": {
      // ── WO-ENGINE-SCOPE-FIX2 #116 · A 档⑤「季度维只回显」→ **裁决 ③：显性标缺席** ────────────────
      // 危害比取证单 §2.1#8 判的「时间标签·危害低」要高一档，追一层才看得见：S19 卡片的 preset 只有
      // `{quarter:"2026Q2"}`（`scenarios-catalog.ts:114`）—— **不带 `gap`**。于是"Q2 缺口用什么组合补？"
      // 这一问，答案里的缺口数是本行写死的 **50**（一个与任何季度都无关的字面量），却与 `quarter:"2026Q2"`
      // 并排渲染成 KPI。不是"标签不过滤"，是**把一个凭空的数字挂在用户说的那个季度名下**。
      // 为什么不真算（追一层的结论，不是没查）：
      //   · 季度**需求**真源在库 —— `PlanTarget` level="quarter"（`PT-2026-Q1..Q4`·`battery.ts:4510-4527`）；
      //   · 但**缺口 = 需求 − 供给**，季度供给要走 `capex.deriveS0`（周产能×认证系数×周曲线 ×13 周上卷），
      //     它今天只在 `planviews.ts` 那条路上跑，`compute()` 这条路既没有 `PlanTarget`（不在 `SolverContext`）
      //     也没有 `computeRollup/curveMult` 的注入；且 `deriveS0` 的季度索引是**相对预测窗口起点**的，
      //     要映射到日历季 `2026Q2` 还得先解 `forecastStart` —— 属**新数据通道**，非"加个过滤"。
      //   · 硬接的后果与 `G-YIELD-SERIES-SOURCE-MISMATCH` 同形：把"这个数是占位"换成一个**看起来算过的**
      //     错数，更难被发现。故本单不接，只把"这个 50 不是 Q2 的缺口"写进答案。
      // 加性：**调用方给了 `gap` → `quarterScope` 键不出现**（那时数字归调用方所有，不是本行编的），
      //   `{}` 也不出现（没有用户说的季度可冒充）—— 两条路都逐字节同改前。
      const quarterGiven = str(args.quarter) !== "";
      const gapGiven = has("gap");
      const quarterScope =
        quarterGiven && !gapGiven
          ? {
              dataMode: "EMPTY",
              quarter: str(args.quarter),
              reason:
                "未给 gap ⇒ 本次缺口取的是求解器占位缺省值（50 万套），**不是该季度的真实产销缺口**：" +
                "季度需求真源 PlanTarget(level=quarter) 在库，但季度供给需走 capex.deriveS0 的周产能上卷（仅 planviews 路可达，" +
                "且其季度索引相对预测窗口起点、未与日历季对齐）—— 拒绝拿占位数冒充该季度的缺口读数。",
              missingInputs: [
                { objectType: "PlanTarget", property: "value@level=quarter", need: "季度需求（在库·但 PlanTarget 不在 SolverContext）" },
                { objectType: "Line", property: "capacityDaily→季度供给", need: "季度供给上卷（deriveS0 需 computeRollup/curveMult 注入 + 日历季对齐）" },
              ],
            }
          : undefined;
      return { quarter: str(args.quarter, "2026Q2"), gap: num(args.gap, 50), ...args, ...(quarterScope ? { quarterScope } : {}) };
    }
    case "countermeasure_combo": {
      const totalDemand = (c.orders ?? []).reduce((s, o) => s + num(props(o).qty), 0) || 100;
      return { gap: num(args.gap, Math.round(totalDemand * 0.15)), ...args };
    }
    case "mitigation_select": {
      // 注入 canonical 方案库（params.risk.mitigations）→ mitigation_select 对全部 7 个风险因子可用。
      //
      // ── WO-ENGINE-SCOPE-FIX2 #116 · A 档③「基地维只回显」+ #117「卡片键名不对」（一处两病）────────
      // 修前两条并存：
      //   ① 求解器读 `args.baseName`，而 **S06 卡片传的是 `base`**（`scenarios-catalog.ts:66`
      //      `{ base:"常州", factor:"物料齐套", solutionName:"三班制" }`）⇒ 实测 `baseName:""`、
      //      **`draftPayload.base` 是空串** —— 这份草稿是要变成 Action 审批件的，基地字段空着就走完了全程；
      //   ② 就算把 `baseName` 传对，`tightness` 也是这里写死的 **85**（与哪个基地无关）⇒ 常州问、枣庄问，
      //      `urgency`/`plans[].score`/`recommended` 逐字节相同，而输出上印着用户说的那个基地名。
      // 数据一直都在（铁律 0.5 三态 = **接了线接错地方**，不是没数据）：`Base` 13 行齐，
      // 且 `risk.ts liveTightness/mockTightness` **早就**按 (baseId, factor) 算张力、早就被 `bottleneck_matrix`
      // 消费（`risk.ts:241/245`）—— 病是「只挂了 bottleneck_matrix 一个挂载点，处置选型这条路没挂」。
      // 修后：
      //   ① `baseName` **与** `base` 两键都认（键名漂移不该让作用域失效），解析走 `resolveBaseRef` 单一出处；
      //      解析不到 → `AMBIGUOUS_SCOPE` 400（抄 `credit_exposure` 样板·拒绝静默按"没给基地"处理）；
      //   ② `tightness` 缺省改为 **该基地 × 该因素的真张力**（`liveTightness`·读不到真源时它自己回落
      //      `mockTightness`，仍是逐 (基地,因素) 确定性值 —— 两条路都随基地变，R6 无随机/无时钟）；
      //   ③ 回显位（含 `draftPayload.base`）归一成**真正被算的那个基地**的规范名。
      //   ④ 加性透出 `dataMode`（LIVE/MOCK）—— 让"这份紧张度是实测还是估算"在答案里可见。
      // 调用方**直传 `tightness`** 时仍以调用方为准（`...args` 在后·`rules-p3-payload-11solvers.test.ts:159`
      // 传 92 的那条路逐字节不变）。**不给 base/baseName → `tightness:85` 且无 `dataMode` 键 = 改前逐字节一致。**
      const baseRefRaw = str(args.baseName) !== "" ? args.baseName : args.base;
      const hasBaseRef = str(baseRefRaw) !== "" || (baseRefRaw !== null && baseRefRaw !== undefined && typeof baseRefRaw === "object");
      if (!hasBaseRef) return { tightness: 85, mitigations: c.params?.risk?.mitigations, ...args };
      const r = resolveBaseRef(c.bases, baseRefRaw);
      if (!r.resolved || !r.objectId)
        throw new AppError(
          "AMBIGUOUS_SCOPE",
          `mitigation_select：问句指定基地「${str(baseRefRaw) || JSON.stringify(baseRefRaw)}」在基地库中无匹配` +
            `${r.ambiguous ? `（歧义·候选 ${(r.candidates ?? []).map((x) => x.objectId).join("、")}）` : `（扫 ${c.bases.length} 行）`}` +
            `——拒绝拿一份与该基地无关的紧张度选处置方案（R-ARG-FIDELITY·G-SOLVER-SCOPE-ECHO）`,
          400,
        );
      const scopedBaseId = r.objectId;
      const scopedBaseName = baseNameOf(c, scopedBaseId);
      const factor = str(args.factor);
      // 因素缺省时不派生张力（求解器本就会以 `unknown factor` 收场，派生一个没人用的数只会误导）。
      const lt = factor ? liveTightness(c, scopedBaseId, factor) : null;
      // `dataMode` 只描述**本函数派生的那个 tightness**；调用方直传 tightness 时不出现
      // （否则会把调用方的数字冠上"LIVE 实测"的名义 —— 那是另一种假个性化）。
      const derivedTightness = lt !== null && !has("tightness");
      return {
        tightness: lt ? lt.value : 85,
        mitigations: c.params?.risk?.mitigations,
        ...args,
        baseName: scopedBaseName,
        ...(derivedTightness ? { tightnessDataMode: lt!.live ? "LIVE" : "MOCK" } : {}),
      };
    }
    default:
      return args;
  }
}
