import { LIVED_IN_INCUBATED, LIVED_IN_SCENE_HISTORY, type HistoryBundle, type HistoryWatermark } from "@platform/contracts";

/**
 * 运营态出厂配置增量（mock 模式）：GET /a/v1/history/bundle / watermark 的确定性 fixture。
 * 形态与 DataCore HistoryService 一致（contracts HistoryBundleSchema）；行级权限语义
 * 与 mock 其它端点一致 —— base_manager:常州 仅常州的月度/案例/订单，聚合按可见范围重算。
 */

const MONTHS = ["2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];

const LIVED_BASES = [
  { baseId: "changzhou", name: "常州", monthlyWan: 5.2, maintMonth: "2026-04" },
  { baseId: "hefei", name: "合肥", monthlyWan: 4.1, maintMonth: "2026-05" },
  { baseId: "xian", name: "西安", monthlyWan: 2.6, maintMonth: "2026-03" },
  { baseId: "yibin", name: "宜宾", monthlyWan: 6.0, maintMonth: "2026-06" },
];

const round2 = (v: number) => Math.round(v * 100) / 100;

function monthlyOutput(b: (typeof LIVED_BASES)[number], mIdx: number): number {
  const ramp = 0.86 + (0.14 * mIdx) / 11; // 全年爬坡 0.86 → 1.0
  let v = b.monthlyWan * ramp;
  if (MONTHS[mIdx] === b.maintMonth) v *= 0.72; // 检修月下凹
  if (b.baseId === "changzhou" && MONTHS[mIdx] === "2025-11") v *= 0.8; // Q4 到货危机
  return round2(v);
}

export const LIVED_RISK_CASES: HistoryBundle["riskCases"] = [
  {
    id: "case_lh_demo_3", caseNo: "CASE-003", title: "合肥·设备OEE风险处置", baseId: "hefei", baseName: "合肥",
    factor: "设备OEE", severity: "MEDIUM", windowFrom: "2025-09-09", windowTo: "2025-09-22",
    crossedAt: "2025-09-09", adoptedAt: "2025-09-12", resolvedAt: "2025-09-22",
    mitigation: { name: "预防性维护提前", planKey: "preventive" }, actionId: "act_lh_demo_003",
    affectedOrders: ["SO-20011"],
    timeline: [
      { date: "2025-09-05", event: "设备OEE指标连续走弱" },
      { date: "2025-09-09", event: "风险越线（设备OEE），生成告警" },
      { date: "2025-09-12", event: "采纳「预防性维护提前」处置方案（Action act_lh_demo_003 审批执行）" },
      { date: "2025-09-22", event: "曲线消解，恢复正常运行" },
    ],
    tags: [], curve: { seriesKey: "output:line", entityId: "LINE-hefei", from: "2025-08-30", to: "2025-09-29" },
  },
  {
    id: "case_lh_demo_7", caseNo: "CASE-007", title: "常州·正极到货危机处置", baseId: "changzhou", baseName: "常州",
    factor: "物料齐套", severity: "HIGH", windowFrom: "2025-11-18", windowTo: "2025-12-01",
    crossedAt: "2025-11-18", adoptedAt: "2025-11-21", resolvedAt: "2025-12-01",
    mitigation: { name: "提前备料", planKey: "early_stock" }, actionId: "act_lh_demo_007",
    affectedOrders: ["SO-20025", "SO-20026", "SO-20027", "SO-20028"],
    timeline: [
      { date: "2025-11-14", event: "正极材料到货延迟 5 天，齐套覆盖跌破 3 天" },
      { date: "2025-11-18", event: "风险越线（物料齐套），生成告警" },
      { date: "2025-11-21", event: "采纳「提前备料」处置方案（Action act_lh_demo_007 审批执行）" },
      { date: "2025-12-01", event: "曲线消解，恢复正常运行" },
    ],
    tags: ["到货危机"], curve: { seriesKey: "output:line", entityId: "LINE-changzhou", from: "2025-11-08", to: "2025-12-08" },
  },
  {
    id: "case_lh_demo_9", caseNo: "CASE-009", title: "西安·物流时长风险处置", baseId: "xian", baseName: "西安",
    factor: "物流时长", severity: "MEDIUM", windowFrom: "2026-03-10", windowTo: "2026-03-23",
    crossedAt: "2026-03-10", adoptedAt: "2026-03-13", resolvedAt: "2026-03-23",
    mitigation: { name: "双路由切换", planKey: "dual_route" }, actionId: "act_lh_demo_009",
    affectedOrders: ["SO-20047"],
    timeline: [
      { date: "2026-03-06", event: "物流时长指标连续走弱" },
      { date: "2026-03-10", event: "风险越线（物流时长），生成告警" },
      { date: "2026-03-13", event: "采纳「双路由切换」处置方案（Action act_lh_demo_009 审批执行）" },
      { date: "2026-03-23", event: "曲线消解，恢复正常运行" },
    ],
    tags: [], curve: { seriesKey: "output:line", entityId: "LINE-xian", from: "2026-02-28", to: "2026-03-30" },
  },
];

const CUSTS = ["星辰汽车", "蓝海储能", "极光电动", "云岭新能源"];
const MODELS = ["4680-NCM", "S192-LFP", "VDA-NCM"];

function deliveredOrders(): HistoryBundle["delivered"] {
  const out: HistoryBundle["delivered"] = [];
  for (let i = 1; i <= 12; i++) {
    const b = LIVED_BASES[(i - 1) % LIVED_BASES.length]!;
    const due = `2025-${String(7 + ((i - 1) % 6)).padStart(2, "0")}-1${i % 9}`;
    // 3 单延期：2 单挽回（≤2 天，rescue 关联案例+Action）、1 单未挽回
    const delayDays = i === 5 ? 2 : i === 9 ? 1 : i === 11 ? 6 : 0;
    const rescue =
      i === 5
        ? { caseId: "case_lh_demo_7", actionId: "act_lh_demo_007", note: "原计划延期 7 天，采纳「提前备料」处置（CASE-007 / act_lh_demo_007）后挽回至 2 天交付" }
        : i === 9
          ? { caseId: "case_lh_demo_3", actionId: "act_lh_demo_003", note: "原计划延期 5 天，采纳「预防性维护提前」处置（CASE-003 / act_lh_demo_003）后挽回至 1 天交付" }
          : undefined;
    const deliveredAt = due; // 简化：±delay 已编码在 delayDays
    out.push({
      so: `SO-2${String(i).padStart(4, "0")}`,
      cust: CUSTS[i % CUSTS.length]!,
      model: MODELS[i % MODELS.length]!,
      qty: 400 + i * 90,
      bases: [b.name],
      due,
      deliveredAt,
      delayDays,
      onTime: delayDays <= 0,
      lifecycle: { createdAt: "2025-06-01", scheduledAt: "2025-06-08", producedAt: due, deliveredAt },
      ...(rescue ? { rescue } : {}),
    });
  }
  return out;
}

const REJECT_COMMENTS = [
  "外协贴近 C08 红线，改用夜班方案",
  "现金垫低于 C18 底线，本月不批增产投入",
  "该基地检修窗口未结束，方案时点不可行，驳回",
  "风险评估缺少受影响订单清单，补充后再报",
];

function actionItems(): { id: string; actionTypeKey: string; summary: string; status: "EXECUTED" | "REJECTED" | "CANCELLED" | "EXECUTION_FAILED"; requestedBy: string; decidedBy: string; comment?: string; createdAt: string; targetRef?: string }[] {
  const out: ReturnType<typeof actionItems> = [];
  for (let i = 1; i <= 60; i++) {
    const status: "EXECUTED" | "REJECTED" | "CANCELLED" | "EXECUTION_FAILED" =
      i % 9 === 0 ? "REJECTED" : i % 25 === 0 ? "CANCELLED" : i % 29 === 0 ? "EXECUTION_FAILED" : "EXECUTED";
    const month = MONTHS[Math.floor(((i - 1) * 12) / 60)]!;
    out.push({
      id: `act_lh_demo_${String(i).padStart(3, "0")}`,
      actionTypeKey: i % 3 === 0 ? "adopt_mitigation" : "plan_change",
      summary: i % 3 === 0 ? `处置方案执行 #${i}` : `周排产计划微调（B${100 + i}）`,
      status,
      requestedBy: "usr-planner",
      decidedBy: "usr-admin",
      ...(status === "REJECTED" ? { comment: REJECT_COMMENTS[(i / 9 - 1) % REJECT_COMMENTS.length] } : {}),
      createdAt: `${month}-15T09:00:00.000Z`,
      ...(status === "EXECUTED" ? { targetRef: `MO-2025-${1000 + i}` } : {}),
    });
  }
  // 倒序（createdAt desc），与后端稳定序一致
  return out.reverse();
}

function mapeSeries(): HistoryBundle["mapeSeries"] {
  const rebound: Record<number, number> = { 21: 1.8, 22: 1.4, 23: 0.7, 24: 0.3 };
  const events: Record<number, string> = {
    4: "首轮参数校准生效（良率基线 EMA）",
    21: "Q4 到货危机：精度回弹 +1.8pct（正极到货延迟）",
    23: "提前备料处置生效，恢复收敛",
  };
  const out: HistoryBundle["mapeSeries"] = [];
  for (let w = 1; w <= 52; w++) {
    const ms = Date.parse("2025-07-01T00:00:00Z") + (w - 1) * 7 * 86400000;
    out.push({
      week: w,
      weekStart: new Date(ms).toISOString().slice(0, 10),
      mape: round2(7 + 5 * Math.exp(-(w - 1) / 16) + (rebound[w] ?? 0)),
      ...(events[w] ? { event: events[w] } : {}),
    });
  }
  return out;
}

const CAL_PROPOSALS: HistoryBundle["calibrations"]["proposals"] = [
  { id: "cal_lh_demo_1", parameter: "工序良率基线（化成）", paramPath: "Process.yield", method: "EMA", trigger: "C12", status: "APPLIED", currentValue: 0.952, proposedValue: 0.958, createdAt: "2025-07-26T07:00:00.000Z", appliedAt: "2025-07-28T08:00:00.000Z", realizedMape: 9.5, evidence: { windowFrom: "2025-07-12", windowTo: "2025-07-26", nPairs: 147, mapeBefore: 11.3, simulatedMapeAfter: 9.2, bias: 0.022, flags: [] } },
  { id: "cal_lh_demo_2", parameter: "产能预测·爬坡系数基线", paramPath: "ramp.base", method: "REPLAY_ATTRIBUTION", trigger: "C12", status: "APPLIED", currentValue: 0.88, proposedValue: 0.9, createdAt: "2025-08-30T07:00:00.000Z", appliedAt: "2025-09-01T08:00:00.000Z", realizedMape: 8.4, evidence: { windowFrom: "2025-08-16", windowTo: "2025-08-30", nPairs: 154, mapeBefore: 9.9, simulatedMapeAfter: 8.1, bias: -0.024, flags: ["ATTRIBUTION_SHARE:0.79"] } },
  { id: "cal_lh_demo_3", parameter: "P90 健康度系数", paramPath: "health.normal", method: "QUANTILE", trigger: "CALIBRATION_RUN", status: "APPLIED", currentValue: 0.93, proposedValue: 0.94, createdAt: "2025-10-04T07:00:00.000Z", appliedAt: "2025-10-06T08:00:00.000Z", realizedMape: 8.0, evidence: { windowFrom: "2025-09-20", windowTo: "2025-10-04", nPairs: 161, mapeBefore: 8.9, simulatedMapeAfter: 7.7, bias: 0.026, flags: [] } },
  { id: "cal_lh_demo_4", parameter: "检修产能系数（OEE 基线）", paramPath: "maintMult", method: "EMA", trigger: "C12", status: "REJECTED", currentValue: 0.72, proposedValue: 0.55, createdAt: "2025-11-29T07:00:00.000Z", evidence: { windowFrom: "2025-11-15", windowTo: "2025-11-29", nPairs: 168, mapeBefore: 10.2, simulatedMapeAfter: 10.2, bias: -0.028, flags: ["STRUCTURAL_SHIFT"] } },
  { id: "cal_lh_demo_5", parameter: "产能预测·爬坡系数基线", paramPath: "ramp.base", method: "REPLAY_ATTRIBUTION", trigger: "CALIBRATION_RUN", status: "APPLIED", currentValue: 0.9, proposedValue: 0.92, createdAt: "2026-01-17T07:00:00.000Z", appliedAt: "2026-01-19T08:00:00.000Z", realizedMape: 6.9, evidence: { windowFrom: "2026-01-03", windowTo: "2026-01-17", nPairs: 175, mapeBefore: 8.2, simulatedMapeAfter: 6.6, bias: 0.03, flags: ["ATTRIBUTION_SHARE:0.84"] } },
  { id: "cal_lh_demo_6", parameter: "工序良率基线（卷绕）", paramPath: "Process.yield", method: "EMA", trigger: "CALIBRATION_RUN", status: "REJECTED", currentValue: 0.957, proposedValue: 0.958, createdAt: "2026-02-21T07:00:00.000Z", evidence: { windowFrom: "2026-02-07", windowTo: "2026-02-21", nPairs: 182, mapeBefore: 7.7, simulatedMapeAfter: 7.1, bias: -0.032, flags: ["NO_IMPROVEMENT"] } },
  { id: "cal_lh_demo_7", parameter: "P90 健康度系数", paramPath: "health.normal", method: "QUANTILE", trigger: "CALIBRATION_RUN", status: "APPLIED", currentValue: 0.94, proposedValue: 0.95, createdAt: "2026-04-11T07:00:00.000Z", appliedAt: "2026-04-13T08:00:00.000Z", realizedMape: 6.5, evidence: { windowFrom: "2026-03-28", windowTo: "2026-04-11", nPairs: 189, mapeBefore: 7.3, simulatedMapeAfter: 6.2, bias: 0.034, flags: [] } },
  { id: "cal_lh_demo_8", parameter: "工序良率基线（涂布）", paramPath: "Process.yield", method: "EMA", trigger: "C12", status: "APPLIED", currentValue: 0.96, proposedValue: 0.963, createdAt: "2026-06-06T07:00:00.000Z", appliedAt: "2026-06-08T08:00:00.000Z", realizedMape: 6.3, evidence: { windowFrom: "2026-05-23", windowTo: "2026-06-06", nPairs: 196, mapeBefore: 7.1, simulatedMapeAfter: 6.0, bias: -0.036, flags: [] } },
];

const RULE_VERSIONS: HistoryBundle["ruleVersions"] = [
  { key: "C08", name: "外协比例红线", version: 1, label: "v1.0", expression: "Order.outsourceRatio > 0.3", reason: "场景包出厂基线（上限 30%）", changedAt: "2025-07-01", status: "RETIRED", tags: [] },
  { key: "C08", name: "外协比例红线", version: 2, label: "v1.1", expression: "Order.outsourceRatio > 0.25", reason: "Q1 外协质量事件复盘：上限 30%→25%", changedAt: "2025-09-12", status: "RETIRED", tags: [] },
  { key: "C08", name: "外协比例红线", version: 3, label: "v1.2", expression: "Order.outsourceRatio > 0.22", reason: "连续两月外协毛利侵蚀复盘：25%→22%", changedAt: "2026-01-09", status: "RETIRED", tags: [] },
  { key: "C08", name: "外协比例红线", version: 4, label: "v1.3", expression: "Order.outsourceRatio > 0.2", reason: "年度复盘：外协质量+毛利双重约束，收紧至 20%", changedAt: "2026-04-03", status: "PUBLISHED", tags: [] },
  { key: "C16", name: "齐套覆盖天数下限", version: 1, label: "v1.0", expression: "Shipment.coverageDays < 3", reason: "出厂基线：关键材料齐套覆盖 ≥3 天", changedAt: "2025-07-01", status: "RETIRED", tags: [] },
  { key: "C16", name: "齐套覆盖天数下限", version: 2, label: "v2.0", expression: "Shipment.coverageDays < 5", reason: "到货危机复盘（2025-11-18~2025-12-01）：正极到货延迟导致齐套断档，覆盖天数 3→5 天", changedAt: "2025-12-03", status: "PUBLISHED", tags: ["到货危机复盘"] },
];

export const LIVED_WATERMARK: HistoryWatermark = {
  synthetic: true,
  industry: "battery-manufacturing",
  scale: "S",
  seed: 42,
  replayFrom: "2025-07-01",
  replayTo: "2026-07-01",
  liveMonths: [],
  liveRatio: 0,
};

/** 行级权限 + 分页后的 bundle（mock 形态与 DataCore HistoryService 对齐）。 */
export function historyBundleFor(baseScope: string[] | null, page: number, pageSize: number): HistoryBundle {
  const bases = LIVED_BASES.filter((b) => !baseScope || baseScope.includes(b.name));
  const monthly: HistoryBundle["monthly"] = [];
  const trend: HistoryBundle["trend"] = [];
  MONTHS.forEach((month, mIdx) => {
    let total = 0;
    const maintBaseIds: string[] = [];
    for (const b of bases) {
      const output = monthlyOutput(b, mIdx);
      const maint = b.maintMonth === month;
      if (maint) maintBaseIds.push(b.baseId);
      total += output;
      monthly.push({ baseId: b.baseId, baseName: b.name, month, output, maint });
    }
    trend.push({ month, output: round2(total), maintBaseIds });
  });

  const delivered = deliveredOrders().filter((d) => !baseScope || d.bases.some((bn) => baseScope.includes(bn)));
  const onTime = delivered.filter((d) => d.onTime).length;
  const allActions = actionItems();
  const items = allActions.slice((page - 1) * pageSize, page * pageSize);
  const countBy = (s: string) => allActions.filter((a) => a.status === s).length;

  // 三线偏差（#5）：供给=trend 产出；需求=供给×需求系数（危机窗口拉高 → 缺口可见）；缺口=需求−供给。
  const deviation = trend.map((t) => {
    const crisis = t.month.startsWith("2025-11") || t.month.startsWith("2025-12");
    const demand = round2(t.output * (crisis ? 1.22 : 1.06));
    return { month: t.month, demand, supply: t.output, gap: round2(demand - t.output) };
  });

  return {
    generatedFrom: {
      industry: "battery-manufacturing", scale: "S", seed: 42, jobId: "synthetic-battery-manufacturing-S-42",
      replayFrom: "2025-07-01", replayTo: "2026-07-01", replayDays: 365, liveMonths: [], liveRatio: 0,
    },
    crisisWindow: { from: "2025-11-18", to: "2025-12-01" },
    trend,
    deviation,
    monthly,
    delivered,
    deliveredCount: delivered.length,
    onTimeRate: delivered.length > 0 ? Math.round((onTime / delivered.length) * 1000) / 10 : 0,
    riskCases: LIVED_RISK_CASES.filter((c) => !baseScope || baseScope.includes(c.baseName)),
    actionHistory: { items, total: allActions.length, page, pageSize },
    actionStats: {
      executed: countBy("EXECUTED"),
      rejected: countBy("REJECTED"),
      cancelled: countBy("CANCELLED"),
      failed: countBy("EXECUTION_FAILED"),
      total: allActions.length,
    },
    mapeSeries: mapeSeries(),
    calibrations: {
      proposals: CAL_PROPOSALS,
      history: CAL_PROPOSALS.filter((p) => p.status === "APPLIED").map((p) => ({
        at: p.appliedAt!,
        trigger: p.trigger,
        changedParams: [p.parameter],
        mapeBefore: p.evidence!.mapeBefore,
        mapeAfter: p.evidence!.simulatedMapeAfter,
        method: p.method,
        simulatedMapeAfter: p.evidence!.simulatedMapeAfter,
        realizedMape: p.realizedMape,
      })),
    },
    sopVersions: MONTHS.map((month, i) => {
      const actual = trend[i]!.output;
      const attainment = Math.round((88 + (i * 6) / 11) * 10) / 10;
      const demand = round2(actual / (attainment / 100));
      const supply = round2((actual + demand) / 2);
      return {
        month, label: `V${i + 1}`, status: "FINAL", demand, supply, gap: round2(demand - supply),
        attainment, actualOutput: actual,
        resolutions:
          i === 4
            ? [{ name: "正极提前备料专项（到货危机对策，CASE-007）", delta: 0.8 }]
            : i === 2
              ? [{ name: "宜宾二线提前爬坡（C21 储能需求上修决议）", delta: 1.2 }]
              : [],
      };
    }),
    ruleVersions: RULE_VERSIONS,
    incubated: LIVED_IN_INCUBATED.map((x) => ({ ...x })),
    taskHistory: Object.entries(LIVED_IN_SCENE_HISTORY).flatMap(([scene, entries]) => entries.map((e) => ({ scene, ...e }))),
  };
}
