import type { SopVersionVM } from "@/api/types";
import zh from "@/locales/zh";

/**
 * 推演类求解器的 Mock 实现 —— 逐行移植 DataCore 真实算法
 * （apps/datacore/src/solvers/plan.ts / capacity.ts、sop.ts），常数取电池行业
 * 默认 solverParams（synthetic/battery.ts），保证 Mock 响应与契约/真实后端同形同值。
 */

const round = (v: number, precision: number): number => {
  const f = 10 ** precision;
  return Math.round(v * f) / f;
};
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------
// S1.6 plan_audit（battery audit 默认参数）
// ---------------------------------------------------------------------------

const AUDIT_T = {
  segTolerance: 0.5,
  gapHard: 2,
  gapSoft: 0.3,
  gmHardOver: 0.3,
  gmSoftUnder: 0.5,
  kitHard: 800,
  kitFixTons: 200,
  cashHard: 50,
  cashSoft: 55,
  essShareBaseline: 49 / 132, // PRD-IND-audit §4.5-A2 取值对齐（≈0.3712）
  essShareTol: 0.05,
  capexSoft: 10,
  segMargins: { pas: 18, ess: 13, com: 15 },
  scoreH: 22, // PRD-IND-audit §4.5-A2 取值对齐
  scoreM: 7, //  PRD-IND-audit §4.5-A2 取值对齐
  passScore: 85,
  condScore: 60,
};

export interface MockAuditInput {
  dem: number;
  seg_pas: number;
  seg_ess: number;
  seg_com: number;
  sup: number;
  ltaCov: number;
  kitGap: number;
  gmTarget: number;
  cashCushion: number;
  capex: number;
}

interface AuditItem {
  id: string;
  title: string;
  ruleRef?: string;
  why: string;
  fix?: { label: string; patch: Record<string, number> };
}

export function mockPlanAudit(input: MockAuditInput): Record<string, unknown> {
  const t = AUDIT_T;
  const H: AuditItem[] = [];
  const M: AuditItem[] = [];
  const S: AuditItem[] = [];

  const segSum = round(input.seg_pas + input.seg_ess + input.seg_com, 4);
  const segDiff = round(Math.abs(segSum - input.dem), 4);
  if (segDiff > t.segTolerance) {
    const scale = input.dem / Math.max(0.0001, segSum);
    H.push({
      id: "X01",
      title: "细分自洽",
      why: `三细分合计 ${segSum} 万套与总需求 ${input.dem} 万套偏差 ${segDiff} 万套，超过容差 ${t.segTolerance} 万套`,
      fix: {
        label: "按总需求比例缩放细分",
        patch: {
          seg_pas: round(input.seg_pas * scale, 2),
          seg_ess: round(input.seg_ess * scale, 2),
          seg_com: round(input.seg_com * scale, 2),
        },
      },
    });
  }

  const gap = round(input.dem - input.sup, 4);
  if (gap > t.gapHard) {
    H.push({
      id: "X02",
      title: "产销缺口",
      why: `需求 ${input.dem} − 供给 ${input.sup} = 缺口 ${gap} 万套，超过硬阈值 ${t.gapHard} 万套`,
      fix: { label: "夜班+加急采购供给增量包", patch: { sup: round(input.sup + gap, 2) } },
    });
  } else if (gap > t.gapSoft) {
    M.push({
      id: "X02",
      title: "产销缺口",
      why: `需求 ${input.dem} − 供给 ${input.sup} = 缺口 ${gap} 万套，处于关注区间 (${t.gapSoft}, ${t.gapHard}]`,
      fix: { label: "夜班+加急采购供给增量包", patch: { sup: round(input.sup + gap, 2) } },
    });
  }

  const m = t.segMargins;
  // PRD-IND-audit §4.5-A1：结构毛利权重分母用 segTot（与 datacore/HTML 一致）。
  const segTot = Math.max(0.0001, input.seg_pas + input.seg_ess + input.seg_com);
  const wPas = input.seg_pas / segTot;
  const wEss = input.seg_ess / segTot;
  const wCom = input.seg_com / segTot;
  const gmStruct = round(wPas * m.pas + wEss * m.ess + wCom * m.com, 4);
  if (input.gmTarget > gmStruct + t.gmHardOver) {
    H.push({
      id: "X03",
      title: "毛利结构",
      ruleRef: "C15",
      why: `毛利目标 ${input.gmTarget}% 超出结构毛利 ${gmStruct}%（${round(wPas, 3)}×${m.pas}% + ${round(wEss, 3)}×${m.ess}% + ${round(wCom, 3)}×${m.com}%）上限 +${t.gmHardOver}pp`,
      fix: { label: "毛利目标回归结构毛利", patch: { gmTarget: round(gmStruct, 2) } },
    });
  } else if (input.gmTarget > gmStruct - t.gmSoftUnder) {
    M.push({
      id: "X03",
      title: "毛利结构",
      ruleRef: "C15",
      why: `毛利目标 ${input.gmTarget}% 贴近结构毛利上限（结构毛利 ${gmStruct}%）`,
      fix: { label: "毛利目标回归结构毛利", patch: { gmTarget: round(gmStruct, 2) } },
    });
  }

  if (input.kitGap > t.kitHard) {
    H.push({
      id: "X04",
      title: "物料齐套",
      ruleRef: "C06/C16",
      why: `关键材料缺口 ${input.kitGap} 吨，超过硬阈值 ${t.kitHard} 吨`,
      fix: { label: `加急采购 ${t.kitFixTons} 吨`, patch: { kitGap: Math.max(0, round(input.kitGap - t.kitFixTons, 2)) } },
    });
  } else if (input.kitGap > 0) {
    M.push({
      id: "X04",
      title: "物料齐套",
      ruleRef: "C06/C16",
      why: `关键材料缺口 ${input.kitGap} 吨（>0），需关注`,
      fix: { label: `加急采购 ${t.kitFixTons} 吨`, patch: { kitGap: Math.max(0, round(input.kitGap - t.kitFixTons, 2)) } },
    });
  }

  if (input.cashCushion < t.cashHard) {
    // 与 DataCore plan.ts 同步：fix 同时回补现金垫至底线（应用后降级为软风险，F14）
    H.push({
      id: "X05",
      title: "现金垫",
      ruleRef: "C18",
      why: `现金垫 ${input.cashCushion} 亿低于底线 ${t.cashHard} 亿`,
      fix: {
        label: "CAPEX 缩减/推后",
        patch: { capex: Math.max(0, round(input.capex - (t.cashHard - input.cashCushion), 2)), cashCushion: t.cashHard },
      },
    });
  } else if (input.cashCushion < t.cashSoft) {
    M.push({
      id: "X05",
      title: "现金垫",
      ruleRef: "C18",
      why: `现金垫 ${input.cashCushion} 亿处于警戒区间 [${t.cashHard}, ${t.cashSoft}) 亿`,
      fix: {
        label: "CAPEX 缩减/推后",
        patch: { capex: Math.max(0, round(input.capex - (t.cashSoft - input.cashCushion), 2)), cashCushion: t.cashSoft },
      },
    });
  }

  const essDev = round(Math.abs(wEss - t.essShareBaseline), 4);
  if (essDev > t.essShareTol) {
    M.push({
      id: "R01",
      title: "结构偏离",
      ruleRef: "C21",
      why: `储能占比 ${round(wEss, 3)} 偏离基线 ${t.essShareBaseline} 达 ${essDev}，超过 ${t.essShareTol}`,
    });
  }

  if (input.capex >= t.capexSoft) {
    M.push({
      id: "R02",
      title: "CAPEX 门槛",
      ruleRef: "C23",
      why: `CAPEX ${input.capex} 亿 ≥ ${t.capexSoft} 亿门槛，建议进入年度情景测算`,
      fix: { label: "引导年度情景测算", patch: {} },
    });
  }

  for (const item of [...H, ...M]) {
    if (item.fix && Object.keys(item.fix.patch).length > 0) {
      S.push({ id: `S-${item.id}`, title: `${item.title}修正`, ruleRef: item.ruleRef, why: item.fix.label, fix: item.fix });
    }
  }

  const score = clamp(100 - t.scoreH * H.length - t.scoreM * M.length, 0, 100);
  const verdict = score >= t.passScore ? "通过" : score >= t.condScore ? "有条件通过" : "不通过";
  return { H, M, S, score, verdict, gmStruct };
}

// ---------------------------------------------------------------------------
// S1.7 plan_generate（battery planGenerate 默认参数）
// ---------------------------------------------------------------------------

const GEN = {
  // PRD-IND-plan-generate §4.5 取值对齐（同 datacore battery planGenerate）。
  base: { rev: 100, gm: 0.16, share: 18, turns: 5.6, cash: 58 },
  targets: { gmFloor: 0.155, cashFloor: 50, capexCap: 20, revGrowthPct: 18, sharePts: 12, turnsFloor: 6.0 },
  paths: {
    A: { name: "保毛利型", rev: 1.12, gm: 0.014, share: 6, capex: 0, turns: 0.6, cash: 6 },
    B: { name: "保规模型", rev: 1.22, gm: -0.008, share: 16, capex: 2, turns: -0.4, cash: -4 },
    C: { name: "扩产型", rev: 1.2, gm: 0.002, share: 22, capex: 27, turns: -0.2, cash: -12 },
    D: { name: "外协型", rev: 1.16, gm: -0.005, share: 12, capex: 0, turns: 0.2, cash: 2 },
    E: { name: "混合型", rev: 1.18, gm: 0.004, share: 14, capex: 14, turns: 0.3, cash: -2 },
  } as Record<string, { name: string; rev: number; gm: number; share: number; capex: number; turns: number; cash: number }>,
  scores: { profitBase: 50, profitK: 22, scaleBase: 40, scaleK: 3, cashBase: 50, cashK: 4, growthBase: 30, growthK: 2.5, stabBase: 90, stabK: 2.2, hardPenalty: 15 },
  schemeNames: { steady: "稳健", balanced: "均衡", aggressive: "进取" },
  gains: {
    A: ["毛利率提升", "现金垫加厚"],
    B: ["市场份额大幅提升", "营收增长最高"],
    C: ["产能规模扩张", "份额提升最大"],
    D: ["轻资产扩张", "弹性供给"],
    E: ["增长与盈利平衡", "风险分散"],
  } as Record<string, string[]>,
  gives: {
    A: ["份额增长有限"],
    B: ["毛利率下滑", "现金消耗"],
    C: ["CAPEX 高企", "现金垫变薄"],
    D: ["外协质量风险"],
    E: ["中等 CAPEX 投入"],
  } as Record<string, string[]>,
};

// PRD-IND-plan-generate §4.6（mock 侧代表性数据；datacore 种子为 HTML 逐字全集）。
const GEN_EXT_SENS: Record<string, [string, string, string][]> = {
  A: [["碳酸锂 +9.8%", "守价空间被成本上移部分抵消：毛利 +1.4pct→约 +0.9pct", "#E8B54A"], ["竞对储能报价 −6%", "挑单退出份额更快被承接，挽留窗口收窄", "#E8B54A"], ["终端上险 +11% < 假设", "需求走弱反而有利守价路径", "#62BE77"]],
  B: [["碳酸锂 +9.8%", "低毛利储能单被成本挤压，更易击穿底线", "#DD7E9E"], ["客户舆情（集成商D）", "冲量应收风险被放大：C13 复核或拒量", "#DD7E9E"], ["终端上险背离", "冲量建立在偏乐观需求上，份额或不及预期", "#E8B54A"]],
  C: [["四川限电预案", "化成 7–8 月折减 5–8%：扩产叠加限电 Q3 更紧", "#DD7E9E"], ["欧盟电池法", "新线供海外需碳足迹护照同步规划", "#E8B54A"], ["利率/汇率环境", "CAPEX 融资 + 海外回款双重敏感", "#E8B54A"]],
  D: [["竞争动态（利用率 71%）", "产能宽松利好外协议价：可再压 3–5%", "#62BE77"], ["舆情（供应商负面）", "外协伙伴经营异常需动态复核", "#E8B54A"], ["碳酸锂 +9.8%", "外协报价随行就市，毛利侵蚀略增", "#E8B54A"]],
  E: [["四川限电预案", "枣庄扩高端不受川区限电影响；川区量走外协对冲", "#62BE77"], ["碳酸锂 +9.8%", "高端守价+长尾外协组合对成本上行缓冲最好", "#62BE77"], ["欧盟电池法", "枣庄一线同步预留碳足迹采集，合规成本最优", "#62BE77"]],
};
const GEN_FOCUS: Record<string, { keys: string; probs: { n: string; kind: string; rule: string | null; why: string; chain: [string, string, string][] }[] }> = {
  A: { keys: "严守 C15 接单毛利线上浮 1pct；主动收缩储能长尾单；乘用车与高端储能守价。", probs: [{ n: "储能客户份额流失", kind: "share", rule: "C21", why: "拒掉低毛利储能单后客户转向竞对，次年框架议价反转，守价被瓦解。", chain: [["拒低毛利储能单", "C15 上浮执行", "#E8B54A"], ["电网F/集成商D 转单", "储能客户·框架协议", "#54B5C4"], ["次年框架议价权弱化", "长协锁量/价格条款", "#5E8FE8"], ["份额不达 · 守价基础动摇", "C21 结构监测", "#DD7E9E"]] }] },
  B: { keys: "照单全收冲市场份额；信用额度从严（C13）；应收账期按周管控。", probs: [{ n: "毛利率击穿底线", kind: "margin", rule: "C15", why: "储能低毛利放量使结构毛利下滑直逼底线，C15 将阻断接单。", chain: [["低毛利储能单放量", "储能占比 ↑", "#E8B54A"], ["结构毛利 −0.8pct", "细分结构反推", "#54B5C4"], ["逼近 15.5% 底线", "毛利率预算线", "#5E8FE8"], ["击穿即 C15 阻断", "规则 C15", "#DD7E9E"]] }] },
  C: { keys: "枣庄+江门新线动工；C23 门槛测算前置；爬坡曲线保守化。", probs: [{ n: "CAPEX 挤占现金垫", kind: "cash", rule: "C18/C23", why: "27 亿 CAPEX 集中支付击穿现金红线，须分期/融资并先过 C23。", chain: [["CAPEX 27 亿集中支付", "枣庄+江门建设", "#E8B54A"], ["现金垫 58→46 亿", "13周现金最低点", "#54B5C4"], ["击穿红线 50 亿", "现金安全垫", "#5E8FE8"], ["C18 阻断 · C23 未过", "规则 C18/C23", "#DD7E9E"]] }] },
  D: { keys: "CAPEX 不动；外协补量走资质名录；质量管控与放量同步。", probs: [{ n: "外协比例触红线", kind: "outsource", rule: "C08", why: "缺口全靠外协逼近 20% 红线，超出无法承接，须组合使用。", chain: [["缺口全量外协", "外协占比 ↗", "#E8B54A"], ["比例逼近 20%", "外协比例监测", "#54B5C4"], ["承接能力封顶", "超出无法承接", "#5E8FE8"], ["C08 红线触线即拒", "规则 C08", "#DD7E9E"]] }] },
  E: { keys: "乘用车守价 + 枣庄扩高端 + 长尾外协；三对策 S&OP 第⑤步统一编排时序。", probs: [{ n: "三对策时序错配", kind: "gap", rule: null, why: "扩产/外协/守价脱节则缺口回弹，时序编排是方案成立前提。", chain: [["任一对策延期", "三线编排", "#E8B54A"], ["爬坡空窗×外协未就位", "供给缺口回弹", "#54B5C4"], ["交付违约+客户流失", "订单交期/客户关系", "#5E8FE8"], ["规模毛利双失", "综合评分坍塌", "#DD7E9E"]] }] },
};

export function mockPlanGenerate(args: {
  targets?: { gmFloor?: number; cashFloor?: number; capexCap?: number; revGrowthPct?: number; sharePts?: number; turnsFloor?: number };
  base?: Partial<typeof GEN.base>;
  hard?: { gm?: boolean; cash?: boolean; capex?: boolean };
}): Record<string, unknown> {
  const base = { ...GEN.base, ...(args.base ?? {}) };
  const targets = { ...GEN.targets, ...(args.targets ?? {}) };
  const hard = { gm: true, cash: true, capex: true, ...(args.hard ?? {}) };
  const sc = GEN.scores;

  const evals = Object.entries(GEN.paths).map(([pathKey, eff]) => {
    const outcome = {
      rev: round(base.rev * eff.rev, 4),
      gm: round(base.gm + eff.gm, 4),
      share: round(base.share + eff.share, 4),
      turns: round(base.turns + eff.turns, 4),
      cash: round(base.cash + eff.cash, 4),
      capex: eff.capex,
    };
    const hardViol: string[] = [];
    if (hard.gm && outcome.gm < targets.gmFloor) hardViol.push("C15");
    if (hard.cash && outcome.cash < targets.cashFloor) hardViol.push("C18");
    if (hard.capex && outcome.capex > targets.capexCap) hardViol.push("CAPEX");
    const meets = {
      meetRevenue: round((outcome.rev / Math.max(0.0001, base.rev) - 1) * 100, 4) >= targets.revGrowthPct,
      meetGm: outcome.gm >= targets.gmFloor,
      meetShare: round(outcome.share - base.share, 4) >= targets.sharePts,
      meetCapex: outcome.capex <= targets.capexCap,
      meetCash: outcome.cash >= targets.cashFloor,
      meetTurns: outcome.turns >= targets.turnsFloor,
    };
    const profit = clamp(round(sc.profitBase + (outcome.gm - targets.gmFloor) * sc.profitK, 4), 0, 100);
    const scale = clamp(round(sc.scaleBase + eff.share * sc.scaleK, 4), 0, 100);
    const cash = clamp(round(sc.cashBase + (outcome.cash - targets.cashFloor) * sc.cashK, 4), 0, 100);
    const growth = clamp(round(sc.growthBase + (outcome.rev - base.rev) * sc.growthK, 4), 0, 100);
    const stability = clamp(round(sc.stabBase - outcome.capex * sc.stabK, 4), 0, 100);
    const total = Math.max(
      0,
      Math.round((profit + scale + cash + growth + stability) / 5) - sc.hardPenalty * hardViol.length,
    );
    return { pathKey, name: eff.name, outcome, scores: { profit, scale, cash, growth, stability, total }, hardViol, meets };
  });

  // §4.4 / HTML gen3Plans：稳健(盈利+现金+稳健 max,可行优先) / 进取(规模+增长 max,全集) / 均衡(total max)；去重。
  const pickMax = (pool: typeof evals, fn: (e: (typeof evals)[number]) => number, used: Set<string>) =>
    pool.filter((e) => !used.has(e.pathKey)).sort((a, b) => fn(b) - fn(a) || (a.pathKey < b.pathKey ? -1 : 1))[0] ??
    [...pool].sort((a, b) => fn(b) - fn(a) || (a.pathKey < b.pathKey ? -1 : 1))[0]!;
  const feas = evals.filter((e) => e.hardViol.length === 0);
  const used = new Set<string>();
  const std = pickMax(feas.length ? feas : evals, (e) => e.scores.profit + e.scores.cash + e.scores.stability, used); used.add(std.pathKey);
  const agg = pickMax(evals, (e) => e.scores.scale + e.scores.growth, used); used.add(agg.pathKey);
  const bal = pickMax(feas.length ? feas : evals, (e) => e.scores.total, used); used.add(bal.pathKey);
  const schemeOf = (no: string, name: string, ev: (typeof evals)[number]) => ({
    no,
    name,
    pathKey: ev.pathKey,
    outcome: ev.outcome,
    scores: ev.scores,
    hardViol: ev.hardViol,
    meets: ev.meets,
    gain: GEN.gains[ev.pathKey] ?? [],
    give: GEN.gives[ev.pathKey] ?? [],
    extSensitivity: (GEN_EXT_SENS[ev.pathKey] ?? []).map((e) => ({ signal: e[0], impact: e[1], color: e[2] })),
    focusKeys: GEN_FOCUS[ev.pathKey]?.keys ?? "",
    problems: [
      ...(GEN_FOCUS[ev.pathKey]?.probs ?? []).map((q) => ({ n: q.n, kind: q.kind, rule: q.rule, why: q.why, chain: q.chain.map((c) => ({ label: c[0], object: c[1], color: c[2] })) })),
      ...ev.hardViol.map((v) => ({
        ruleRef: v,
        title: v === "C15" ? `毛利 ${ev.outcome.gm} 低于底线 ${targets.gmFloor}` : v === "C18" ? `现金垫 ${ev.outcome.cash} 低于底线 ${targets.cashFloor}` : `CAPEX ${ev.outcome.capex} 超过上限 ${targets.capexCap}`,
        why: `路径 ${ev.pathKey} ${v} 硬约束`,
        unlock: v === "CAPEX" ? `提高 CAPEX 上限至 ≥${ev.outcome.capex} 可解锁` : "调整目标面板对应底线可解锁",
      })),
    ],
  });
  const schemes = [
    schemeOf("壹", `${GEN.schemeNames.steady}方案 · 守盈利`, std),
    schemeOf("贰", `${GEN.schemeNames.balanced}方案`, bal),
    schemeOf("叁", `${GEN.schemeNames.aggressive}方案 · 冲规模`, agg),
  ];
  const eligible = schemes.filter((s) => s.hardViol.length === 0);
  const pool = eligible.length > 0 ? eligible : schemes;
  const recommend = [...pool].sort((x, y) => y.scores.total - x.scores.total || (x.pathKey < y.pathKey ? -1 : 1))[0]!.pathKey;
  return { schemes, recommend, paths: evals, targets, base };
}

// ---------------------------------------------------------------------------
// S1.2 capacity_forecast（电池种子：型号→可产基地网络）
// ---------------------------------------------------------------------------

const CAP_P = {
  forecastStart: "2026-06-15",
  certFactors: { 量产: 1, 认证中: 0.6 } as Record<string, number>,
  ramp: { base: 0.88, step: 0.03, fullWeek: 5 },
  maintMult: 0.72,
  health: { normal: 0.93, degraded: 0.9 },
  whatIf: { nightShiftCoef: 0.06, channelCoef: 0.05, outsourceMax: 0.2 },
  logistics: { byAddress: { 上海: 3, 广州: 5, 北京: 4, 成都: 6, 海外: 14 } as Record<string, number>, defaultDays: 7 },
};

interface CapBaseDef {
  base: string;
  baseId: string;
  weeklyCap: number;
  status: "量产" | "认证中";
  maintWeek: number | null;
  bottleneck: string;
  tightness: number;
}

const MODEL_CAP_NET: Record<string, CapBaseDef[]> = {
  "4680-NCM": [
    { base: "常州", baseId: "常州", weeklyCap: 3.2, status: "量产", maintWeek: 4, bottleneck: "化成通道", tightness: 92 },
    { base: "合肥", baseId: "合肥", weeklyCap: 2.6, status: "认证中", maintWeek: null, bottleneck: "设备OEE", tightness: 78 },
    { base: "宜宾", baseId: "宜宾", weeklyCap: 2.9, status: "量产", maintWeek: 6, bottleneck: "物料齐套", tightness: 84 },
  ],
  // 4680-LFP 命中 C09 数据健康度降级（IoT 延迟 > 2h → P90 系数 0.93→0.90）
  "4680-LFP": [
    { base: "常州", baseId: "常州", weeklyCap: 2.4, status: "量产", maintWeek: 3, bottleneck: "化成通道", tightness: 88 },
    { base: "成都", baseId: "成都", weeklyCap: 2.2, status: "认证中", maintWeek: null, bottleneck: "卷绕机稼动", tightness: 74 },
  ],
  "刀片-LFP": [
    { base: "宜宾", baseId: "宜宾", weeklyCap: 3.4, status: "量产", maintWeek: 5, bottleneck: "物料齐套", tightness: 86 },
    { base: "西安", baseId: "西安", weeklyCap: 1.8, status: "量产", maintWeek: null, bottleneck: "注液机", tightness: 66 },
  ],
  "VDA-NCM": [
    { base: "溧阳", baseId: "溧阳", weeklyCap: 2.1, status: "量产", maintWeek: 4, bottleneck: "分容柜", tightness: 76 },
    { base: "南京", baseId: "南京", weeklyCap: 1.6, status: "量产", maintWeek: null, bottleneck: "涂布机", tightness: 62 },
  ],
  "储能-280Ah": [
    { base: "宜宾", baseId: "宜宾", weeklyCap: 3.0, status: "量产", maintWeek: 6, bottleneck: "化成柜", tightness: 90 },
    { base: "青岛", baseId: "青岛", weeklyCap: 1.2, status: "认证中", maintWeek: null, bottleneck: "人员", tightness: 58 },
  ],
  "储能-314Ah": [
    { base: "常州", baseId: "常州", weeklyCap: 2.0, status: "量产", maintWeek: 4, bottleneck: "化成柜", tightness: 85 },
    { base: "合肥", baseId: "合肥", weeklyCap: 1.7, status: "量产", maintWeek: null, bottleneck: "卷绕机", tightness: 70 },
  ],
};

// PRD-IND-model 缺口①③：收敛可产网络的全基地业态册 + 型号化学/业态元信息（镜像 battery BASES/MODELS 种子，
// reason 由 chem×kind 派生；前端零写死，与 datacore solvers/capacity.ts nonProducible 同源）。
const MOCK_BASES: { name: string; kind: "动力" | "储能" }[] = [
  { name: "常州", kind: "动力" },
  { name: "合肥", kind: "动力" },
  { name: "西安", kind: "动力" },
  { name: "宜宾", kind: "储能" },
  { name: "溧阳", kind: "动力" },
  { name: "青岛", kind: "储能" },
  { name: "南京", kind: "动力" },
  { name: "成都", kind: "储能" },
  { name: "福州", kind: "储能" },
  { name: "长沙", kind: "动力" },
  { name: "惠州", kind: "储能" },
  { name: "盐城", kind: "动力" },
];

function modelMeta(modelId: string): { chem: string; pos: "动力" | "储能" } {
  const chem = modelId.includes("NCM") ? "NCM" : modelId.includes("LFP") ? "LFP" : modelId.includes("储能") ? "LFP" : "NCM";
  const pos: "动力" | "储能" = modelId.includes("储能") ? "储能" : "动力";
  return { chem, pos };
}

function curveMult(w: number, maintWeek: number | null): number {
  let m = w >= CAP_P.ramp.fullWeek ? 1 : CAP_P.ramp.base + CAP_P.ramp.step * (w - 1);
  if (maintWeek !== null && w === maintWeek) m *= CAP_P.maintMult;
  return m;
}

function dayFrom(startIso: string, dateIso: string): number {
  return Math.round(
    (Date.parse(`${dateIso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${startIso.slice(0, 10)}T00:00:00Z`)) / 86400000,
  );
}

function logisticsDays(address?: string): number {
  if (!address) return 0;
  return CAP_P.logistics.byAddress[address] ?? CAP_P.logistics.defaultDays;
}

export interface MockForecastArgs {
  modelId: string;
  qty?: number;
  weeks?: number;
  batches?: { qty: number; dueDate: string; address?: string }[];
  whatIf?: { nightShifts?: number; extraChannels?: number; outsourceRatio?: number };
}

export function mockCapacityForecast(args: MockForecastArgs): Record<string, unknown> | { error: string } {
  const net = MODEL_CAP_NET[args.modelId];
  if (!net) return { error: `model ${args.modelId} has no certified lines` };

  const degraded = args.modelId === "4680-LFP";
  const healthFactor = degraded ? CAP_P.health.degraded : CAP_P.health.normal;
  // F29 文案同源：与连接器页/顶栏健康度共用 zh.health.degradeNote
  const degradeNote = degraded
    ? zh.health.degradeNote("4.2", String(CAP_P.health.normal), String(CAP_P.health.degraded))
    : undefined;

  const batches = Array.isArray(args.batches) && args.batches.length > 0 ? [...args.batches] : undefined;
  const qty = batches ? batches.reduce((a, b) => a + (b.qty || 0), 0) : (args.qty ?? 0);
  const weeks = Math.max(
    1,
    Math.floor(
      args.weeks ??
        (batches
          ? Math.max(
              ...batches.map((b) => Math.max(1, Math.floor((dayFrom(CAP_P.forecastStart, b.dueDate) - logisticsDays(b.address)) / 7))),
            )
          : 6),
    ),
  );

  const perBaseRows: Record<string, unknown>[] = [];
  const cumP50ByWeek: number[] = new Array(weeks).fill(0);
  let p50 = 0;
  const pendingCertList: string[] = [];
  let mainBn = "";
  let mainTightness = -1;
  for (const b of net) {
    const certFactor = CAP_P.certFactors[b.status] ?? 1;
    if (b.status === "认证中") pendingCertList.push(`${b.base}·LINE-${b.baseId}-B`);
    let cumTotal = 0;
    for (let w = 1; w <= weeks; w++) {
      const add = b.weeklyCap * certFactor * curveMult(w, b.maintWeek);
      cumTotal += add;
      for (let i = w - 1; i < weeks; i++) cumP50ByWeek[i] = (cumP50ByWeek[i] as number) + add;
    }
    p50 += cumTotal;
    if (b.tightness > mainTightness) {
      mainTightness = b.tightness;
      mainBn = b.bottleneck;
    }
    perBaseRows.push({
      base: b.base,
      baseId: b.baseId,
      weeklyCap: round(b.weeklyCap, 4),
      certFactor,
      maintWeek: b.maintWeek,
      bottleneck: b.bottleneck,
      tightness: b.tightness,
      cumTotal: round(cumTotal, 4),
    });
  }
  p50 = round(p50, 4);
  const p90 = round(p50 * healthFactor, 4);

  let gap: number;
  let ok: boolean;
  let batchRows: Record<string, unknown>[] | undefined;
  if (batches) {
    batches.sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    let cumDemand = 0;
    let worst = 0;
    batchRows = [];
    for (const b of batches) {
      const dueDay = dayFrom(CAP_P.forecastStart, b.dueDate);
      const wkEff = Math.max(1, Math.floor((dueDay - logisticsDays(b.address)) / 7));
      cumDemand += b.qty || 0;
      const cumP90 = round((cumP50ByWeek[Math.min(wkEff, weeks) - 1] as number) * healthFactor, 4);
      const rowOk = cumDemand <= cumP90;
      if (!rowOk) worst = Math.max(worst, cumDemand - cumP90);
      batchRows.push({ qty: b.qty, dueDate: b.dueDate, address: b.address, wkEff, cumDemand: round(cumDemand, 4), cumP90, ok: rowOk });
    }
    gap = round(Math.max(worst, 0), 4);
    ok = batchRows.every((r) => r.ok === true);
  } else {
    gap = round(qty - p90, 4);
    ok = gap <= 0;
  }

  let whatIf: Record<string, unknown> | undefined;
  if (args.whatIf) {
    const n = args.whatIf.nightShifts ?? 0;
    const ch = args.whatIf.extraChannels ?? 0;
    const ratio = args.whatIf.outsourceRatio ?? 0;
    if (ratio > CAP_P.whatIf.outsourceMax) {
      whatIf = {
        rejected: true,
        ruleRef: "C08",
        reason: `外协比例 ${round(ratio * 100, 1)}% 超过红线 ${round(CAP_P.whatIf.outsourceMax * 100, 0)}%（C08），拒绝该参数组合`,
      };
    } else {
      let adjusted = p50 * (1 + CAP_P.whatIf.nightShiftCoef * n + CAP_P.whatIf.channelCoef * ch) + qty * ratio;
      let physicalCap = 0;
      for (const b of net) physicalCap += b.weeklyCap * weeks;
      physicalCap = round(physicalCap, 4);
      let capped = false;
      if (adjusted > physicalCap) {
        adjusted = physicalCap;
        capped = true;
      }
      adjusted = round(adjusted, 4);
      const adjP90 = round(adjusted * healthFactor, 4);
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

  // PRD-IND-model 缺口①③：收敛可产网络——不可产基地清单 + N/总数 注解（reason 由 chem×kind 派生，R13/R14）。
  const { chem, pos } = modelMeta(args.modelId);
  const producibleNames = new Set(perBaseRows.map((r) => r.base as string));
  const totalBases = MOCK_BASES.length;
  const producibleCount = producibleNames.size;
  const nonProducible = MOCK_BASES
    .filter((b) => !producibleNames.has(b.name))
    .map((b) => ({
      base: b.name,
      reason:
        b.kind !== pos
          ? `基地业态「${b.kind}」与型号「${pos}」不匹配`
          : `${chem} 体系产线未在该基地铺设 / 认证`,
    }))
    .sort((a, b) => (a.base < b.base ? -1 : 1));

  return {
    p50,
    p90,
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
  };
}

// ---------------------------------------------------------------------------
// S1.3 bottleneck_matrix MOCK 口径（逐行移植 datacore/solvers/risk.ts mockTightness：
// seed = (基地首字符码 + 因素首字符码×7) mod 9；常数取 battery bottleneck.mock）
// ---------------------------------------------------------------------------

export const BN_FACTORS = ["瓶颈工序", "设备OEE", "人力工时", "物料齐套", "物流时长", "换型损失", "良率波动"];

const BN_PRIMARY: Record<string, string> = {
  常州: "瓶颈工序",
  合肥: "设备OEE",
  西安: "人力工时",
  宜宾: "物料齐套",
  溧阳: "换型损失",
  青岛: "物流时长",
  南京: "良率波动",
  成都: "设备OEE",
  福州: "物料齐套",
  长沙: "瓶颈工序",
  惠州: "物流时长",
  盐城: "人力工时",
};

const BN_MOCK = { mod: 9, factorMult: 7, primaryBase: 88, primaryCap: 97, secondaryBase: 55, secondaryCap: 83, utilLowAdd: 2 };

function bnTightness(base: string, factor: string): number {
  const seed = ((base.charCodeAt(0) || 0) + (factor.charCodeAt(0) || 0) * BN_MOCK.factorMult) % BN_MOCK.mod;
  const primary = BN_PRIMARY[base] ?? "瓶颈工序";
  if (factor === primary) return Math.min(BN_MOCK.primaryCap, BN_MOCK.primaryBase + (seed % BN_MOCK.mod));
  return Math.min(BN_MOCK.secondaryCap, BN_MOCK.secondaryBase + seed + BN_MOCK.utilLowAdd);
}

export function mockBottleneckMatrix(args: { baseIds?: string[] }): Record<string, unknown> {
  const baseIds = (args.baseIds ?? Object.keys(BN_PRIMARY)).slice().sort();
  return {
    dataMode: "MOCK",
    factors: BN_FACTORS,
    rows: baseIds.map((base) => ({
      base,
      tightness: Object.fromEntries(BN_FACTORS.map((f) => [f, bnTightness(base, f)])),
      primary: BN_PRIMARY[base] ?? "瓶颈工序",
    })),
  };
}

// ---------------------------------------------------------------------------
// 增量 §7.10：GET /a/v1/plan-versions/current（与 V7 定稿基线同值 —— 原型 AUDIT_PRESETS.V7）
// ---------------------------------------------------------------------------

export const PLAN_VERSION_CURRENT = {
  versionId: "sop-202606-final",
  versionLabel: "2026-06 V1",
  month: "2026-06",
  status: "FINAL",
  input: { dem: 132, seg_pas: 71, seg_ess: 49, seg_com: 12, sup: 131.2, ltaCov: 92, kitGap: 654, gmTarget: 16.0, cashCushion: 58, capex: 0 },
};

// ---------------------------------------------------------------------------
// S1.8 sop_balance 五步法（移植 datacore/sop.ts；常数 sop: gapRed 2 / dv 10% / cashFloor 50 / gmTolerance 0.5）
// ---------------------------------------------------------------------------

const SOP_P = { gapRed: 2, dvThreshold: 0.1, cashFloor: 50, gmTolerance: 0.5 };

/** ③ 供应评审产能线（决议前基线 129.5 万套，对齐原型 V5） */
const SOP_PER_BASE = [
  { baseId: "常州", monthly: 31.0, certFactor: 1 },
  { baseId: "成都", monthly: 18.4, certFactor: 1 },
  { baseId: "合肥", monthly: 16.2, certFactor: 0.6 },
  { baseId: "江门", monthly: 13.5, certFactor: 1 },
  { baseId: "其余8基地", monthly: 50.4, certFactor: 1 },
];

const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);

export class SopMockError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const sopPlanLocked = () =>
  new SopMockError(409, "PLAN_LOCKED", "S&OP 版本已定稿（C22 锁定），任何字段变更必须走计划变更 Action");

export function mockSopAdvance(v: SopVersionVM, step: number, payload: Record<string, unknown>): SopVersionVM {
  if (v.status === "FINAL") throw sopPlanLocked();
  const touch = () => {
    v.updatedAt = new Date().toISOString();
  };
  if (step === 1) {
    v.steps.s1 = {
      changes: [
        { kind: "认证转量产", modelId: "4680-NCM", baseId: "合肥", impactWanPerMonth: 1.8 },
        { kind: "爬坡中", modelId: "4680-NCM", baseId: "常州", impactWanPerMonth: 0 },
        { kind: "退役评审", modelId: "2170-NCM", baseId: "眉山", impactWanPerMonth: -0.9 },
      ],
      boundaryDeltaWanPerMonth: 1.8,
    };
    if (v.status === "DRAFT") v.status = "IN_REVIEW";
    touch();
    return v;
  }
  if (step === 2) {
    if (!v.steps.s1) throw new SopMockError(409, "INVALID_STATE", "run step 1 first");
    const segments = Array.isArray(payload.segments) ? (payload.segments as Record<string, unknown>[]) : [];
    if (segments.length === 0) throw new SopMockError(422, "VALIDATION_ERROR", "step 2 payload.segments required");
    const rows = segments.map((s) => {
      const target = num(s.target);
      const rolling = num(s.rolling);
      const dv = target === 0 ? 0 : round((rolling - target) / target, 4);
      return { key: str(s.key), name: str(s.name, str(s.key)), target, rolling, lastActual: num(s.lastActual), dv, flagged: Math.abs(dv) > SOP_P.dvThreshold };
    });
    const totalTarget = rows.reduce((a, r) => a + r.target, 0);
    const totalRolling = rows.reduce((a, r) => a + r.rolling, 0);
    for (const r of rows) {
      if (!r.flagged) continue;
      if (!v.agenda.some((a) => a.source === "C21" && a.detail?.segment === r.key)) {
        v.agenda.push({
          source: "C21",
          title: `${r.name} 滚动预测偏差 ${round(r.dv * 100, 1)}%（>±${SOP_P.dvThreshold * 100}%），自动提报高管决策会`,
          detail: { segment: r.key, dv: r.dv },
        });
      }
    }
    v.steps.s2 = {
      rows,
      total: { target: totalTarget, rolling: totalRolling, dv: totalTarget === 0 ? 0 : round((totalRolling - totalTarget) / totalTarget, 4) },
    };
    touch();
    return v;
  }
  if (step === 3) {
    if (!v.steps.s2) throw new SopMockError(409, "INVALID_STATE", "run step 2 first");
    const increments = Array.isArray(payload.increments) ? (payload.increments as { name: string; delta: number }[]) : [];
    let sup = SOP_PER_BASE.reduce((a, b) => a + b.monthly, 0);
    for (const inc of increments) sup += num(inc.delta);
    sup = round(sup, 4);
    const dem = num((v.steps.s2 as { total?: { rolling?: number } }).total?.rolling, num(v.inputs.demTotal));
    const gap = round(dem - sup, 4);
    const flagged = gap > SOP_P.gapRed;
    if (flagged && !v.agenda.some((a) => a.source === "GAP")) {
      v.agenda.push({ source: "GAP", title: `产销缺口 ${gap} 万套（>${SOP_P.gapRed}），需供给对策`, detail: { gap } });
    }
    v.steps.s3 = { perBase: SOP_PER_BASE, increments, sup, dem, gap, flagged };
    touch();
    return v;
  }
  if (step === 4) {
    if (!v.steps.s3) throw new SopMockError(409, "INVALID_STATE", "run step 3 first");
    const revSum = num(payload.revSum);
    const gmSum = num(payload.gmSum);
    const gmBudget = num(payload.gmBudget);
    const cashCushion = num(payload.cashCushion);
    const gmRoll = revSum === 0 ? 0 : round((gmSum / revSum) * 100, 4);
    const gmOk = gmRoll >= gmBudget - SOP_P.gmTolerance;
    const cashOk = cashCushion >= SOP_P.cashFloor;
    const pass = gmOk && cashOk;
    const violations: string[] = [];
    if (!gmOk) violations.push(`毛利率_roll ${gmRoll}% 低于预算 ${gmBudget}%（容差 ${SOP_P.gmTolerance}pp）`);
    if (!cashOk) violations.push(`现金垫 ${cashCushion} 亿低于 C18 底线 ${SOP_P.cashFloor} 亿`);
    for (const viol of violations) {
      if (!v.agenda.some((a) => a.source === "C18/财务" && a.title === viol)) v.agenda.push({ source: "C18/财务", title: viol });
    }
    v.steps.s4 = { revSum, gmSum, gmBudget, cashCushion, gmRoll, gmOk, cashOk, pass, violations };
    touch();
    return v;
  }
  if (step === 5) {
    const s4 = v.steps.s4 as { pass?: boolean } | undefined;
    if (!s4) throw new SopMockError(409, "INVALID_STATE", "run step 4 first");
    if (s4.pass !== true) {
      throw new SopMockError(409, "INVALID_STATE", "④ 财务整合未通过，阻断进入⑤（先修正财务输入并重跑第④步）");
    }
    const resolutions = Array.isArray(payload.resolutions) ? (payload.resolutions as { name: string; delta: number }[]) : [];
    v.resolutions = resolutions.map((r) => ({ name: str(r.name), delta: num(r.delta) }));
    const s3 = v.steps.s3 as { sup?: number; dem?: number };
    const supFinal = round(num(s3.sup) + v.resolutions.reduce((a, r) => a + r.delta, 0), 4);
    v.supFinal = supFinal;
    v.steps.s5 = { agenda: v.agenda, resolutions: v.resolutions, supFinal, gapFinal: round(num(s3.dem) - supFinal, 4) };
    v.status = "EXEC_MEETING";
    touch();
    return v;
  }
  throw new SopMockError(422, "VALIDATION_ERROR", "step must be 1–5");
}

/** 种子：上月（2026-06）已定稿版本 —— 演示 C22 锁定与 409 */
export function seedSopVersions(): SopVersionVM[] {
  const t = "2026-06-10T08:00:00Z";
  return [
    {
      id: "sop-202606-final",
      month: "2026-06",
      status: "FINAL",
      inputs: { demTotal: 132 },
      steps: {
        s1: { changes: [{ kind: "认证转量产", modelId: "4680-NCM", baseId: "合肥", impactWanPerMonth: 1.8 }], boundaryDeltaWanPerMonth: 1.8 },
        s2: {
          rows: [
            { key: "pas", name: "乘用车", target: 69, rolling: 71, lastActual: 66.8, dv: 0.029, flagged: false },
            { key: "ess", name: "储能", target: 45, rolling: 49, lastActual: 41.9, dv: 0.0889, flagged: false },
            { key: "com", name: "商用车", target: 13.6, rolling: 12, lastActual: 12.9, dv: -0.1176, flagged: true },
          ],
          total: { target: 127.6, rolling: 132, dv: 0.0345 },
        },
        s3: { perBase: SOP_PER_BASE, increments: [], sup: 129.5, dem: 132, gap: 2.5, flagged: true },
        s4: { revSum: 248, gmSum: 39.7, gmBudget: 16.4, cashCushion: 58, gmRoll: 16.0081, gmOk: true, cashOk: true, pass: true, violations: [] },
        s5: {
          resolutions: [
            { name: "常州化成夜班×1", delta: 1.2 },
            { name: "江门正极加急 200 吨", delta: 0.5 },
          ],
          supFinal: 131.2,
          gapFinal: 0.8,
        },
      },
      agenda: [
        { source: "C21", title: "商用车 滚动预测偏差 -11.8%（>±10%），自动提报高管决策会", detail: { segment: "com", dv: -0.1176 } },
        { source: "GAP", title: "产销缺口 2.5 万套（>2），需供给对策", detail: { gap: 2.5 } },
      ],
      resolutions: [
        { name: "常州化成夜班×1", delta: 1.2 },
        { name: "江门正极加急 200 吨", delta: 0.5 },
      ],
      supFinal: 131.2,
      createdAt: t,
      updatedAt: t,
    },
  ];
}
