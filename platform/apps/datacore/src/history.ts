/** W1 运营态种子引擎：确定性生成"过去 12 个月"的运营史（同 seed 同输出）
 *  原则：生成的是源头事件与记录，跨模块数字互相咬合；真实部署时逐月替换为真历史。*/
import { BASES, MODELS, ORDERS, T0 } from "./seed.js";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rnd = mulberry32(20250612);
const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
const month = (i: number) => { const d = new Date(T0); d.setMonth(d.getMonth() - (11 - i)); return d.toISOString().slice(0, 7); };
const dayAgo = (n: number) => new Date(T0.getTime() - n * 864e5).toISOString().slice(0, 10);

/* ---- 1) 12 个月产出/OEE/利用率（基地×月，检修月有可见下凹） ---- */
const maintMonth = (b: string) => (b.charCodeAt(0) + b.length) % 12;
export const MONTHLY = BASES.flatMap(b => Array.from({ length: 12 }, (_, i) => {
  const ramp = Math.min(1, 0.86 + i * 0.013);                       // 全年缓慢爬坡
  const maint = i === maintMonth(b.name) ? 0.78 : 1;                // 年度检修月
  const noise = 0.97 + rnd() * 0.06;
  const output = +(b.gwh * 0.32 * 4.33 * ramp * maint * noise).toFixed(1);
  return { base: b.name, month: month(i), output, oee: +(0.80 * ramp * maint * noise).toFixed(3), util: +(b.util * ramp * maint * noise).toFixed(1) };
}));

/* ---- 2) 已交付订单（60 单，含 9 单曾延期、其中 7 单挽回） ---- */
const CUSTS = ["头部车企A", "新势力B", "电网公司F", "储能集成商C", "商用车集团G", "海外车企E", "车企D"];
export const DELIVERED = Array.from({ length: 60 }, (_, i) => {
  const m = MODELS[i % MODELS.length];
  const dueOff = 330 - i * 5 - Math.floor(rnd() * 4);
  const late = i % 7 === 3;
  const recovered = late && i % 14 !== 3;
  return {
    so: `SO-${2900 + i * 8}`, cust: pick(CUSTS), model: m.id, qty: +(3 + rnd() * 28).toFixed(1),
    due: dayAgo(dueOff), delivered: dayAgo(dueOff - (late ? (recovered ? 2 : 9) : 0)),
    status: "DELIVERED", lateDays: late ? (recovered ? 2 : 9) : 0,
    note: late ? (recovered ? "曾预警延期，采纳夜班方案后挽回至 +2 天" : "延期 9 天交付（到货危机波及）") : "按期交付",
  };
});

/* ---- 3) 历史风险-处置案例（10 例：越线→采纳→消解闭环） ---- */
const SOLS = ["三班制（加1夜班）", "关键正极提前3周备料", "检修前移错峰", "化成扩2通道", "近端仓+供应商VMI"];
export const RISK_CASES = Array.from({ length: 10 }, (_, i) => {
  const b = BASES[(i * 3) % BASES.length];
  const f = ["物料齐套", "设备OEE", "人力工时", "物流时长"][i % 4];
  const day = 320 - i * 31;
  return {
    id: `rc-${i + 1}`, base: b.name, factor: f, crossedAt: dayAgo(day), peak: 86 + (i * 3) % 10,
    adopted: SOLS[i % SOLS.length], adoptedAt: dayAgo(day - 2), resolvedAt: dayAgo(day - 2 - 4 - (i % 5)),
    effect: `峰值 −${9 + (i % 5)} · ${4 + (i % 5)} 天回落至阈值下`, affectedOrders: 2 + (i % 4),
  };
});

/* ---- 4) Action 审计史（200 条） ---- */
const ACT_TYPES = ["采纳产能保障方案", "调整排产分配", "定稿月度计划版本", "校准参数变更", "预警处置方案"];
export const ACTION_HISTORY = Array.from({ length: 200 }, (_, i) => {
  const r = rnd();
  const status = r < 0.82 ? "EXECUTED" : r < 0.93 ? "REJECTED" : r < 0.97 ? "CANCELLED" : "EXECUTION_FAILED";
  return {
    id: `act_h${String(i).padStart(3, "0")}`, actionType: pick(ACT_TYPES), status,
    initiator: pick(["planner", "czmgr", "sop_host", "supply_planner"]), approver: status === "CANCELLED" ? null : "admin",
    createdAt: dayAgo(360 - Math.floor(i * 1.78)), targetRef: status === "EXECUTED" ? `MO-${2025 + (i > 110 ? 1 : 0)}-${4000 + i * 13}` : null,
    comment: status === "REJECTED" ? pick(["外协比例贴近 C08 红线，改用夜班方案", "现金垫余量不足，推后一季", "证据窗口样本不足，待下月复核"]) : null,
  };
});

/* ---- 5) 校准叙事：52 周 MAPE 12%→7% 收敛 + 8 次参数提案 ---- */
export const MAPE_SERIES = Array.from({ length: 52 }, (_, i) => {
  const base = 12.2 - 5.4 * (1 - Math.exp(-i / 18));                 // 指数收敛
  const bump = i === 21 ? 1.8 : i === 22 ? 1.1 : 0;                  // Q4 到货危机的精度冲击
  return { week: dayAgo((51 - i) * 7), mape: +(base + bump + (rnd() - 0.5) * 0.7).toFixed(2) };
});
export const CALIBRATIONS = [
  { at: dayAgo(330), param: "良率基线·涂布", from: 0.962, to: 0.951, method: "EMA", mapeGain: 0.8, status: "APPLIED" },
  { at: dayAgo(285), param: "OEE基线·常州", from: 0.85, to: 0.828, method: "EMA", mapeGain: 0.6, status: "APPLIED" },
  { at: dayAgo(240), param: "爬坡曲线系数", from: 1.0, to: 0.93, method: "REPLAY_ATTRIBUTION", mapeGain: 1.2, status: "APPLIED" },
  { at: dayAgo(200), param: "P90健康度系数", from: 0.95, to: 0.93, method: "QUANTILE", mapeGain: 0.5, status: "APPLIED" },
  { at: dayAgo(168), param: "节拍基线·化成", from: 36, to: 33, method: "EMA", mapeGain: 0.4, status: "REJECTED", note: "结构性漂移（化成扩通道后），人工重置基线" },
  { at: dayAgo(120), param: "认证系数·爬坡期", from: 0.6, to: 0.66, method: "REPLAY_ATTRIBUTION", mapeGain: 0.7, status: "APPLIED" },
  { at: dayAgo(75), param: "良率基线·卷绕", from: 0.978, to: 0.981, method: "EMA", mapeGain: 0.2, status: "REJECTED", note: "回测改善 <1pct 门槛" },
  { at: dayAgo(30), param: "OEE基线·眉山", from: 0.79, to: 0.802, method: "EMA", mapeGain: 0.3, status: "APPLIED" },
];

/* ---- 6) S&OP 版本史 V1–V12 ---- */
export const SOP_VERSIONS = Array.from({ length: 12 }, (_, i) => ({
  version: `V${i + 1}`, month: month(i), demand: +(118 + i * 1.3 + rnd() * 3).toFixed(1),
  supply: +(116 + i * 1.4 + rnd() * 3).toFixed(1),
  attainment: +(88 + Math.min(6, i * 0.6) + rnd() * 2).toFixed(1),
  decision: pick(["常州夜班 +1.2", "江门加急 200 吨", "枣庄爬坡上调", "外协 4% 过渡", "客户优先级重排", "无增量决议"]),
  finalizedAt: dayAgo((11 - i) * 30 + 3), status: "FINAL",
}));

/* ---- 7) 规则版本史 / 意图孵化记录 ---- */
export const RULE_VERSIONS = [
  { rule: "C08", version: "v1.0", at: dayAgo(360), change: "初始：外协比例 ≤25%" },
  { rule: "C08", version: "v1.1", at: dayAgo(300), change: "收紧至 ≤22%（外协批次质量波动复盘）" },
  { rule: "C08", version: "v1.2", at: dayAgo(210), change: "收紧至 ≤20% · 增加首件鉴定前置" },
  { rule: "C08", version: "v1.3", at: dayAgo(90), change: "口径明确：按月度出货量计" },
  { rule: "C16", version: "v1.1", at: dayAgo(150), change: "关键料覆盖 3天→5天（到货危机复盘）" },
];
export const INCUBATED = [
  { intentKey: "affected_orders", from: "兜底问题「这个基地出问题影响哪些单子」×23 次", at: dayAgo(280) },
  { intentKey: "risk_root_cause", from: "兜底问题「为什么这天会紧张」×17 次", at: dayAgo(210) },
  { intentKey: "plan_audit_q", from: "兜底问题「我这个计划行不行」×31 次", at: dayAgo(140) },
];

/* ---- 8) 历史问答（每场景预置近期任务记录） ---- */
export const TASK_HISTORY = [
  { view: "dash", q: "本月毛利率为什么低于预算？", a: "毛利率 16.0% vs 预算 16.4%（−0.4pct）：储能占比升至 39% 是主因（结构差异），单价与成本侧无异常。", at: dayAgo(3), path: "WORKFLOW" },
  { view: "dash", q: "4680-LFP 下季度能排多少？", a: "P50 约 96 万套（枣庄认证中 ×0.6）；枣庄转量产后 +18%。", at: dayAgo(9), path: "WORKFLOW" },
  { view: "risk", q: "眉山的物料齐套为什么连续预警？", a: "采购批次间隙叠加正极到货延迟 3 天：T+12 越线（峰值 89）。已采纳提前备料方案，T+5 起效。", at: dayAgo(5), path: "WORKFLOW" },
  { view: "risk", q: "影响哪些订单？", a: "受影响 4 批（电网公司F ×2、储能集成商C ×2），合计 41.2 万套，延误估计 2–4 天。", at: dayAgo(5), path: "WORKFLOW" },
  { view: "project", q: "2170-NCM 加 15% 八周能不能接？", a: "可承接：P90 118.3 vs 需求 102.4，富余 15.9 万套；主瓶颈自贡·换型损失（紧张度 81）。", at: dayAgo(12), path: "WORKFLOW" },
  { view: "audit", q: "现金垫 52 亿过得了体检吗？", a: "有条件通过（评分 76）：现金垫余量薄（仅高于红线 2 亿）+ 储能占比偏离基线 → 2 项软风险。", at: dayAgo(7), path: "WORKFLOW" },
  { view: "generate", q: "推荐哪个经营方案？", a: "推荐「均衡·混合型」：综合分 71 为无硬约束违反方案中最高；进取·扩产型触发 CAPEX 上限。", at: dayAgo(15), path: "WORKFLOW" },
  { view: "explore", q: "哪些客户集中度过高？", a: "头部车企A 占在手订单 23%——超过 20% 集中度关注线；建议信用与产能分配双复核。", at: dayAgo(6), path: "AGENT" },
];

/** 汇总包（行级权限：按可见基地过滤基地相关数据） */
export function historyBundle(visibleBaseNames: Set<string>) {
  const f = <T extends { base?: string }>(arr: T[]) => arr.filter(x => !x.base || visibleBaseNames.has(x.base));
  const monthly = f(MONTHLY);
  const byMonth: Record<string, { output: number; util: number[]; }> = {};
  for (const m of monthly) { (byMonth[m.month] ||= { output: 0, util: [] }); byMonth[m.month].output += m.output; byMonth[m.month].util.push(m.util); }
  const trend = Object.entries(byMonth).map(([mo, v]) => ({ month: mo, output: +v.output.toFixed(1), util: +(v.util.reduce((a, b) => a + b, 0) / v.util.length).toFixed(1) }));
  return {
    trend, monthly,
    delivered: DELIVERED, deliveredCount: DELIVERED.length,
    onTimeRate: +((DELIVERED.filter(d => d.lateDays === 0).length / DELIVERED.length) * 100).toFixed(1),
    riskCases: f(RISK_CASES), actionHistory: ACTION_HISTORY,
    mapeSeries: MAPE_SERIES, calibrations: CALIBRATIONS,
    sopVersions: SOP_VERSIONS, ruleVersions: RULE_VERSIONS, incubated: INCUBATED,
    taskHistory: TASK_HISTORY,
    generatedFrom: "deterministic-seed-20250612（真实部署后逐月替换为真历史，管线不变）",
  };
}
