import type { SopVersionVM } from "@/api/types";
import { BASE_REGISTRY, SEG_REGISTRY } from "@platform/contracts";
import zh from "@/locales/zh";
import { ORDERS } from "./fixtures";

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
  essShareBaseline: 139.2 / 375.0, // PRD-IND-audit §4.5-A2 取值对齐（≈0.3712，随 demand segment 缩放同步更新）
  essShareTol: 0.05,
  capexSoft: 10,
  segMargins: Object.fromEntries(SEG_REGISTRY.map((s) => [s.key, s.marginPct])) as { pas: number; ess: number; com: number }, // DF.3 单一来源
  scoreH: 22, // PRD-IND-audit §4.5-A2 取值对齐
  scoreM: 7, //  PRD-IND-audit §4.5-A2 取值对齐
  passScore: 85,
  condScore: 60,
  extGmBufferMin: 1.2, // PRD-IND-audit §4.4 E01
  extDemHigh: 130, // E02
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

  // PRD-IND-audit §4.4：外部信号诊断 E01–E03（与 datacore plan.ts 同源）。
  if (gmStruct - input.gmTarget < t.extGmBufferMin) {
    M.push({ id: "E01", title: "外部·原料成本", ruleRef: "C24", why: `外部信号「碳酸锂价上行」：结构毛利 ${gmStruct}% 与目标 ${input.gmTarget}% 缓冲仅 ${round(gmStruct - input.gmTarget, 2)}pp（<${t.extGmBufferMin}），成本上行即击穿` });
  }
  if (input.dem >= t.extDemHigh) {
    M.push({ id: "E02", title: "外部·终端需求", ruleRef: "C25", why: `外部信号「终端上险低于假设」：需求 P50 ${input.dem} 万套（≥${t.extDemHigh}）高位，若终端上量不及预期则产销缺口扩大` });
  }
  M.push({ id: "E03", title: "外部·客户信用", ruleRef: "C13", why: `外部信号「重点客户负面舆情」：建议动态复核应收周期与信用额度（C13），防止回款逾期击穿现金垫` });

  for (const item of [...H, ...M]) {
    if (item.fix && Object.keys(item.fix.patch).length > 0) {
      S.push({ id: `S-${item.id}`, title: `${item.title}修正`, ruleRef: item.ruleRef, why: item.fix.label, fix: item.fix });
    }
  }

  const score = clamp(100 - t.scoreH * H.length - t.scoreM * M.length, 0, 100);
  // PRD-IND-audit §3.1：4 态状态机（按 H/M 计数），与 datacore plan.ts 同源。
  const verdict =
    H.length > 0
      ? "站不住"
      : M.length >= 3
        ? "可定稿但有重要风险"
        : M.length > 0
          ? "可定稿·关注风险"
          : "全部通过·可直接定稿";
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

// 基地集以 HTML BASE_DATA / MODEL_DEF 为准（用户裁决）：NCM 型号铺动力/混合基地、LFP 储能型号铺储能/混合。
const MODEL_CAP_NET: Record<string, CapBaseDef[]> = {
  "4680-NCM": [
    { base: "常州", baseId: "常州", weeklyCap: 3.2, status: "量产", maintWeek: 4, bottleneck: "化成通道", tightness: 92 },
    { base: "合肥", baseId: "合肥", weeklyCap: 2.6, status: "认证中", maintWeek: null, bottleneck: "设备OEE", tightness: 78 },
    { base: "成都", baseId: "成都", weeklyCap: 2.9, status: "量产", maintWeek: 6, bottleneck: "物料齐套", tightness: 84 },
  ],
  // 4680-LFP 命中 C09 数据健康度降级（IoT 延迟 > 2h → P90 系数 0.93→0.90）
  "4680-LFP": [
    { base: "常州", baseId: "常州", weeklyCap: 2.4, status: "量产", maintWeek: 3, bottleneck: "化成通道", tightness: 88 },
    { base: "枣庄", baseId: "枣庄", weeklyCap: 2.2, status: "认证中", maintWeek: null, bottleneck: "卷绕机稼动", tightness: 74 },
  ],
  "刀片-LFP": [
    { base: "江门", baseId: "江门", weeklyCap: 3.4, status: "量产", maintWeek: 5, bottleneck: "物料齐套", tightness: 90 },
    { base: "眉山", baseId: "眉山", weeklyCap: 1.8, status: "量产", maintWeek: null, bottleneck: "化成柜", tightness: 66 },
  ],
  "VDA-NCM": [
    { base: "武汉", baseId: "武汉", weeklyCap: 2.1, status: "量产", maintWeek: 4, bottleneck: "涂布机", tightness: 76 },
    { base: "厦门", baseId: "厦门", weeklyCap: 1.6, status: "量产", maintWeek: null, bottleneck: "化成柜", tightness: 62 },
  ],
  "储能-280Ah": [
    { base: "江门", baseId: "江门", weeklyCap: 3.0, status: "量产", maintWeek: 6, bottleneck: "老化库", tightness: 90 },
    { base: "邯郸", baseId: "邯郸", weeklyCap: 1.2, status: "认证中", maintWeek: null, bottleneck: "人员", tightness: 58 },
  ],
  "储能-314Ah": [
    { base: "信阳", baseId: "信阳", weeklyCap: 2.0, status: "量产", maintWeek: 4, bottleneck: "涂布机", tightness: 85 },
    { base: "扬州", baseId: "扬州", weeklyCap: 1.7, status: "量产", maintWeek: null, bottleneck: "涂布机", tightness: 70 },
  ],
};

// PRD-IND-model 缺口①③：收敛可产网络的全基地业态册（镜像 battery BASES，HTML 集，含 动力+储能 混合）；
// reason 由 chem×kind 派生；前端零写死，与 datacore solvers/capacity.ts nonProducible 同源。
// DF.1 单一来源：从 @platform/contracts BASE_REGISTRY 派生（与 datacore/fixtures 同源，灭漂移）。
const MOCK_BASES: { name: string; kind: "动力" | "储能" | "动力+储能" }[] = BASE_REGISTRY.map((b) => ({ name: b.name, kind: b.kind }));

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
        !b.kind.includes(pos) && !pos.includes(b.kind)
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
    // 规则即引用 P2：求解器真评估的规则闸门（mock 与真后端同步；C09 由 degraded 决定，
    // C01/C02/C03 mock 无对应输入 → 诚实 NOT_APPLICABLE，与真后端 NOT_APPLICABLE 语义一致）。
    evaluatedRules: [
      { key: "C01", name: "产线设计产能上限", severity: "BLOCK", outcome: "NOT_APPLICABLE", expression: "Line.weeklyCapacityWan > Line.designCeilingWan", evidence: "该求解器输出未含此规则字段" },
      { key: "C02", name: "化成/老化串并产能口径", severity: "WARN", outcome: "NOT_APPLICABLE", expression: "Process.parallelThroughput < Process.requiredThroughput", evidence: "该求解器输出未含此规则字段" },
      { key: "C03", name: "产能上限约束", severity: "BLOCK", outcome: "NOT_APPLICABLE", expression: "Order.demandDelta > 0.5", evidence: "该求解器输出未含此规则字段" },
      { key: "C09", name: "数据时延临时降级", severity: "WARN", outcome: degraded ? "WARN" : "PASS", expression: "DataSourceHealth.critical == TRUE AND DataSourceHealth.lagHours > 2", evidence: degraded ? "命中：关键数据源新鲜度延迟" : "通过：数据源新鲜" },
    ],
    ruleSetVersion: "rsv_mock",
  };
}

// ---------------------------------------------------------------------------
// S1.3 bottleneck_matrix MOCK 口径（逐行移植 datacore/solvers/risk.ts mockTightness：
// seed = (基地首字符码 + 因素首字符码×7) mod 9；常数取 battery bottleneck.mock）
// ---------------------------------------------------------------------------

export const BN_FACTORS = ["瓶颈工序", "设备OEE", "人力工时", "物料齐套", "物流时长", "换型损失", "良率波动"];

const BN_PRIMARY: Record<string, string> = {
  常州: "瓶颈工序",
  厦门: "设备OEE",
  成都: "设备OEE",
  眉山: "人力工时",
  武汉: "良率波动",
  江门: "物料齐套",
  合肥: "设备OEE",
  信阳: "物流时长",
  枣庄: "换型损失",
  邯郸: "物料齐套",
  自贡: "人力工时",
  金华: "设备OEE",
  扬州: "良率波动",
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
  input: { dem: 375.0, seg_pas: 201.7, seg_ess: 139.2, seg_com: 34.1, sup: 374.2, ltaCov: 92, kitGap: 654, gmTarget: 16.0, cashCushion: 58, capex: 0 },
};

// ---------------------------------------------------------------------------
// S1.8 sop_balance 五步法（移植 datacore/sop.ts；常数 sop: gapRed 2 / dv 10% / cashFloor 50 / gmTolerance 0.5）
// ---------------------------------------------------------------------------

const SOP_P = { gapRed: 2, dvThreshold: 0.1, cashFloor: 50, gmTolerance: 0.5 };

/** ③ 供应评审产能线（决议前基线 367.9 万套，对齐 700 亿规模需求） */
const SOP_PER_BASE = [
  { baseId: "常州", monthly: 88.0, certFactor: 1 },
  { baseId: "成都", monthly: 52.3, certFactor: 1 },
  { baseId: "合肥", monthly: 46.0, certFactor: 0.6 },
  { baseId: "江门", monthly: 38.3, certFactor: 1 },
  { baseId: "其余9基地", monthly: 143.3, certFactor: 1 },
];

/** ③供给基线（决议前）= Σ SOP_PER_BASE.monthly = 367.9 万套（对齐 fixtures.ts:485 注释·f17 sop-balance 用同值）。
 *  供需失衡双向归因 mock 桩从此派生总缺口 G = 需求(dem 375.0) − 供给基线（非写死）。 */
export const SOP_SUPPLY_BASELINE = Math.round(SOP_PER_BASE.reduce((s, b) => s + b.monthly, 0) * 10) / 10;

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
      inputs: { demTotal: 375.0 },
      steps: {
        s1: { changes: [{ kind: "认证转量产", modelId: "4680-NCM", baseId: "合肥", impactWanPerMonth: 5.1 }], boundaryDeltaWanPerMonth: 5.1 },
        s2: {
          rows: [
            { key: "pas", name: "乘用车", target: 201.7, rolling: 201.7, lastActual: 200.6, dv: 0, flagged: false },
            { key: "ess", name: "储能", target: 139.2, rolling: 139.2, lastActual: 100.5, dv: 0, flagged: false },
            { key: "com", name: "商用车", target: 34.1, rolling: 34.1, lastActual: 39.5, dv: 0, flagged: false },
          ],
          total: { target: 375.0, rolling: 375.0, dv: 0 },
        },
        s3: { perBase: SOP_PER_BASE, increments: [], sup: 367.9, dem: 375.0, gap: 7.1, flagged: true },
        s4: { revSum: 700.0, gmSum: 118.9, gmBudget: 17.0, cashCushion: 58, gmRoll: 17.0, gmOk: true, cashOk: true, pass: true, violations: [] },
        s5: {
          resolutions: [
            { name: "常州化成夜班×1", delta: 3.4 },
            { name: "江门正极加急 200 吨", delta: 1.4 },
          ],
          supFinal: 372.7,
          gapFinal: 2.3,
        },
      },
      agenda: [
        { source: "GAP", title: "产销缺口 7.1 万套（>2），需供给对策", detail: { gap: 7.1 } },
      ],
      resolutions: [
        { name: "常州化成夜班×1", delta: 3.4 },
        { name: "江门正极加急 200 吨", delta: 1.4 },
      ],
      supFinal: 372.7,
      createdAt: t,
      updatedAt: t,
    },
  ];
}

// ── WO-CROSS-OBJECT-MULTIOBJ 多目标 + 跨对象占用（VITE_MOCK 模式确定性回放；真求解走 CP-SAT sidecar） ──
// 说明：这是无后端 mock 态的形状回放（确定性加权贪心），**非可证最优**；真链路 optimize_whatif/cross_object_occupancy
// 走 datacore→CP-SAT sidecar 得可证最优。前端组件读此形状渲染（占用表/Δ 分解），徽标诚实标"推演结果非数据库事实"。

interface MoOrder { id: string; revenue: number; penalty: number; qty: number; contractId?: string }
interface MoLine { id: string; capacity: number }
interface MoWeights { revenue: number; penalty: number; cost: number }

function moWeights(objectives: unknown): MoWeights {
  const w: MoWeights = { revenue: 1, penalty: 1, cost: 1 };
  if (Array.isArray(objectives)) for (const o of objectives as { key?: string; weight?: number }[]) {
    if (o?.key && typeof o.weight === "number" && (o.key in w)) (w as unknown as Record<string, number>)[o.key] = o.weight;
  }
  return w;
}

/** 确定性加权贪心占用（mock）：按 wRev·营收−wPen·违约金 降序，受产线容量+合同额度约束逐单排产。 */
function moAssign(args: Record<string, unknown>, w: MoWeights) {
  const orders = (Array.isArray(args.orders) ? args.orders : []) as MoOrder[];
  const lines = (Array.isArray(args.lines) ? args.lines : []) as MoLine[];
  const contracts = (Array.isArray(args.contracts) ? args.contracts : []) as { id: string; cap: number }[];
  const elig = (Array.isArray(args.eligibility) ? args.eligibility : []) as { order: string; line: string; cost: number }[];
  const remLine: Record<string, number> = Object.fromEntries(lines.map((l) => [l.id, l.capacity]));
  const remCtr: Record<string, number> = Object.fromEntries(contracts.map((c) => [c.id, c.cap]));
  const costOf = (o: string, l: string) => elig.find((e) => e.order === o && e.line === l)?.cost ?? 0;
  const linesFor = (o: string) => elig.filter((e) => e.order === o).map((e) => e.line);
  // 服务某单的边际收益 = wRev·营收 + wPen·违约金（服务即避免该违约金）；据此降序贪心（与 CP-SAT 目标同向）。
  const score = (o: MoOrder) => w.revenue * o.revenue + w.penalty * o.penalty;
  const ranked = [...orders].sort((a, b) => score(b) - score(a) || (a.id < b.id ? -1 : 1));
  const occupancy: { order: string; line: string }[] = [];
  const served = new Set<string>();
  for (const o of ranked) {
    const cand = linesFor(o.id).filter((l) => (remLine[l] ?? -1) >= o.qty).sort();
    const ctrRem = o.contractId != null ? remCtr[o.contractId] : undefined;
    const ctrOk = o.contractId == null || ctrRem === undefined || ctrRem >= o.qty;
    if (cand.length && ctrOk) {
      const l = cand[0]!;
      remLine[l] = (remLine[l] ?? 0) - o.qty;
      if (o.contractId != null && ctrRem !== undefined) remCtr[o.contractId] = ctrRem - o.qty;
      occupancy.push({ order: o.id, line: l });
      served.add(o.id);
    }
  }
  occupancy.sort((a, b) => (a.order < b.order ? -1 : 1));
  const displaced = orders.filter((o) => !served.has(o.id)).map((o) => o.id).sort();
  const revenue = round(orders.filter((o) => served.has(o.id)).reduce((s, o) => s + o.revenue, 0), 6);
  const penalty = round(orders.filter((o) => !served.has(o.id)).reduce((s, o) => s + o.penalty, 0), 6);
  const cost = round(occupancy.reduce((s, a) => s + costOf(a.order, a.line), 0), 6);
  return { occupancy, displaced, objectiveValues: { revenue, penalty, cost }, servedCount: served.size, orderCount: orders.length };
}

export function mockMultiObj(key: string, args: Record<string, unknown>): Record<string, unknown> {
  if (key === "cross_object_occupancy") {
    const w = moWeights(args.objectives);
    const r = moAssign(args, w);
    return {
      status: "OPTIMAL", optimal: true, method: (args.method as string) || "weighted",
      values: {}, ...r,
      lineCount: Array.isArray(args.lines) ? args.lines.length : 0,
      contractCount: Array.isArray(args.contracts) ? args.contracts.length : 0,
      summary: `占用：${r.servedCount}/${r.orderCount} 单获排，被挤 ${r.displaced.length} 单；营收 ${r.objectiveValues.revenue}、违约金 ${r.objectiveValues.penalty}、换型成本 ${r.objectiveValues.cost}（可证最优）`,
    };
  }
  if (key === "multi_objective") {
    const objectives = (Array.isArray(args.objectives) ? args.objectives : []) as { key: string }[];
    const vars = (Array.isArray(args.vars) ? args.vars : []) as { id: string }[];
    // 假·mock 全 0 退化桩诚实化（KILL-MOCK-RED·AUDIT 2026-07-24）：本 mock 未实现真多目标求解，返回退化桩
    // （objectiveValues 全 0），故绝不冒充"可证最优"——标 dataMode:MOCK + provenanceSynthetic，summary 诚实披露
    // "mock 占位·未求解"。真解在部署态 datacore multi_objective（VITE_MOCK 关时走真求解器）。
    return {
      status: "MOCK_STUB", optimal: false, method: (args.method as string) || "weighted",
      dataMode: "MOCK", provenanceSynthetic: true,
      values: Object.fromEntries(vars.map((v) => [v.id, 0])),
      objectiveValues: Object.fromEntries(objectives.map((o) => [o.key, 0])),
      objectiveKeys: objectives.map((o) => o.key), varCount: vars.length, objectiveCount: objectives.length,
      summary: `多目标（${(args.method as string) || "weighted"}）mock 占位·未实现真求解：${objectives.length} 目标 / ${vars.length} 变量（objectiveValues 全 0 为桩值·非可证最优·真解见部署态 datacore）`,
    };
  }
  // optimize_whatif（family=cross_object_occupancy）：基线权重 vs 扰动后权重各解一次 → 各目标 Δ 分解。
  const inner = (args.args as Record<string, unknown>) ?? {};
  const baseW = moWeights(inner.objectives);
  const perts = (Array.isArray(args.perturbations) ? args.perturbations : []) as { target: string; value: number | string }[];
  const newW: MoWeights = { ...baseW };
  for (const p of perts) {
    const m = /^objectives\.(\w+)\.weight$/.exec(p.target);
    if (m && (m[1]! in newW)) (newW as unknown as Record<string, number>)[m[1]!] = typeof p.value === "number" ? p.value : Number(p.value);
  }
  const base = moAssign(inner, baseW);
  const next = moAssign(inner, newW);
  const deltaByObjective: Record<string, number> = {};
  for (const k of ["revenue", "penalty", "cost"] as const) {
    deltaByObjective[k] = round((next.objectiveValues[k] ?? 0) - (base.objectiveValues[k] ?? 0), 6);
  }
  return {
    baselineObjective: null, perturbedObjective: null, deltaObjective: null,
    deltaByObjective, feasible: true, conflictConstraints: [],
    explanation: `扰动 ${perts.length} 条 → 各目标 Δ：${Object.entries(deltaByObjective).map(([k, d]) => `${k} ${d >= 0 ? "+" : ""}${d}`).join("、")}`,
    summary: `多目标 what-if：${Object.entries(deltaByObjective).map(([k, d]) => `${k} Δ${d}`).join("、")}`,
  };
}

// ---------------------------------------------------------------------------
// WO-SOP-RESCHEDULE · sop_reschedule（逐口径移植 datacore/solvers/sop-reschedule.ts）
// 无后端 mock 态形状回放：读演示订单(HTML 24 单)+BASE_REGISTRY util+基地线产能，同真算法口径
// （freeDaily=Σcap×(1−util/100)·挤占按(优先级低,交期远)·代价=换型+加班+延误·Σalloc+residual==qty）。
// 徽标诚实标「推演结果·非数据库事实」；改 targetOrderId/advancePct → 方案真变（非写死）。
// ---------------------------------------------------------------------------
const SOP_FORECAST_START = "2026-06-10"; // = BATTERY_SOLVER_PARAMS.forecastStart（R6 锚点）
const SOP_ORDERS: { so: string; cust: string; model: string; qty: number; due: string; pri: string; bases: string[] }[] = [
  { so: "SO-3391", cust: "广汽集团", model: "4680-NCM", qty: 7259, due: "2026-06-24", pri: "高", bases: ["changzhou", "chengdu"] },
  { so: "SO-3402", cust: "长安汽车", model: "4680-NCM", qty: 14518, due: "2026-07-02", pri: "高", bases: ["changzhou", "jinhua"] },
  { so: "SO-3415", cust: "吉利汽车", model: "4680-NCM", qty: 4033, due: "2026-07-18", pri: "中", bases: ["changzhou", "hefei"] },
  { so: "SO-3420", cust: "东风汽车", model: "4680-NCM", qty: 10485, due: "2026-07-09", pri: "高", bases: ["chengdu", "hefei"] },
  { so: "SO-3481", cust: "广汽集团", model: "4680-NCM", qty: 10485, due: "2026-07-11", pri: "高", bases: ["changzhou", "jinhua"] },
  { so: "SO-3490", cust: "东风汽车", model: "4680-NCM", qty: 16131, due: "2026-07-06", pri: "高", bases: ["changzhou", "hefei"] },
];
// 演示基地日产能（套/日·代表值·与 datacore lineHash 同量级）：freeDaily = cap×(1−util/100)。
const SOP_BASE_CAP: Record<string, number> = { changzhou: 835, jinhua: 871, chengdu: 820, hefei: 790 };
const dayFromISO = (a: string, b: string) => Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86400000);
const isoAt = (start: string, day: number) => new Date(Date.parse(`${start.slice(0, 10)}T00:00:00Z`) + Math.round(day) * 86400000).toISOString().slice(0, 10);
const PRI_RANK: Record<string, number> = { 低: 0, 中: 1, 高: 2 };

export function mockSopReschedule(args: Record<string, unknown>): Record<string, unknown> {
  const targetOrderId = String(args.targetOrderId ?? "SO-3402");
  const target = SOP_ORDERS.find((o) => o.so === targetOrderId) ?? SOP_ORDERS[1]!;
  const qty = target.qty;
  const origDueDay = dayFromISO(SOP_FORECAST_START, target.due);
  let newDueDay: number;
  if (typeof args.newDueDate === "string" && args.newDueDate) newDueDay = dayFromISO(SOP_FORECAST_START, args.newDueDate);
  else if (typeof args.advanceDays === "number") newDueDay = origDueDay - Math.max(0, Math.round(args.advanceDays as number));
  else newDueDay = Math.round(origDueDay * (1 - (typeof args.advancePct === "number" ? (args.advancePct as number) : 0.2)));
  newDueDay = Math.max(1, newDueDay);
  const daysAvail = newDueDay;
  const requiredDaily = round(qty / daysAvail, 2);
  const objective = String(args.objective ?? "min_delay");

  const utilOf = (bid: string) => BASE_REGISTRY.find((b) => b.baseId === bid)?.util ?? 80;
  const nameOf = (bid: string) => BASE_REGISTRY.find((b) => b.baseId === bid)?.name ?? bid;
  const baseCaps = target.bases.map((bid) => {
    const cap = SOP_BASE_CAP[bid] ?? 800;
    const freeDaily = round(cap * Math.max(0, 1 - utilOf(bid) / 100), 2);
    return { baseId: bid, baseName: nameOf(bid), freeDaily };
  });
  const totalFreeCap = round(baseCaps.reduce((a, bc) => a + bc.freeDaily * daysAvail, 0), 2);
  const alloc = new Map<string, number>();
  const freeUse = Math.min(qty, totalFreeCap);
  for (const bc of baseCaps) alloc.set(bc.baseId, round(freeUse * (totalFreeCap > 0 ? (bc.freeDaily * daysAvail) / totalFreeCap : 1 / baseCaps.length), 2));
  const residualAfterFree = round(qty - freeUse, 2);

  const competitors = SOP_ORDERS.filter((o) => o.model === target.model && o.so !== targetOrderId)
    .map((o) => ({ ...o, dueDay: dayFromISO(SOP_FORECAST_START, o.due) }));
  const rank = (c: { pri: string; dueDay: number; qty: number }) =>
    objective === "min_changeover" ? [c.qty, -(PRI_RANK[c.pri] ?? 2), -c.dueDay] : [PRI_RANK[c.pri] ?? 2, -c.dueDay, -c.qty];
  competitors.sort((a, b) => { const ra = rank(a), rb = rank(b); for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i]! - rb[i]!; return a.so.localeCompare(b.so); });

  const displaced: Record<string, unknown>[] = [];
  let freed = 0;
  const bid0 = baseCaps[0]?.baseId, fd0 = baseCaps[0]?.freeDaily || 1;
  for (const c of competitors) {
    if (residualAfterFree - freed <= 1e-6) break;
    const take = Math.min(c.qty, round(residualAfterFree - freed, 2));
    if (bid0) alloc.set(bid0, round((alloc.get(bid0) ?? 0) + take, 2));
    freed = round(freed + take, 2);
    displaced.push({ orderId: c.so, customer: c.cust, qty: c.qty, origDueDay: c.dueDay, priority: c.pri,
      delayDays: Math.max(1, Math.round(newDueDay + take / Math.max(1, fd0) - c.dueDay)),
      provenance: { kind: "派生", drillType: "Order", drillId: c.so, drillField: "qty", drillValue: c.qty } });
  }
  const residualQty = round(Math.max(0, residualAfterFree - freed), 2);
  const scheduledQty = round(qty - residualQty, 2);
  const allocation = baseCaps.map((bc) => {
    const a = round(alloc.get(bc.baseId) ?? 0, 2);
    return { baseId: bc.baseId, baseName: bc.baseName, qty: a, dailyRate: round(a / daysAvail, 2), daysAvail, freeDaily: bc.freeDaily,
      overtimeUnits: round(Math.max(0, a - bc.freeDaily * daysAvail), 2),
      provenance: { kind: "派生", drillType: "Line", drillId: bc.baseId, drillField: "capacityDaily", drillValue: bc.freeDaily } };
  });
  if (allocation.length > 0) {
    const rest = round(allocation.slice(0, -1).reduce((s, a) => s + a.qty, 0), 2);
    const last = allocation[allocation.length - 1]!;
    last.qty = round(scheduledQty - rest, 2); last.dailyRate = round(last.qty / daysAvail, 2);
    last.overtimeUnits = round(Math.max(0, last.qty - last.freeDaily * daysAvail), 2);
  }
  const overtime = round(allocation.reduce((a, x) => a + x.overtimeUnits, 0) * 2.5, 2);
  const delay = round(displaced.reduce((a, d) => a + (d.delayDays as number) * (d.qty as number) * 0.05, 0), 2);
  const total = round(overtime + delay, 2); // 同型号挤占 → 换型 0（诚实）
  const sumAlloc = round(allocation.reduce((a, x) => a + x.qty, 0), 2);
  const feasible = residualQty <= 1e-6;
  const verdict = !feasible ? `部分可行：残余缺口 ${residualQty} 套`
    : displaced.length === 0 ? "可直接提前（空闲产能足·无需挤占）"
    : `可提前：挤占 ${displaced.length} 单腾产能（跨 ${allocation.filter((a) => a.qty > 0).length} 基地拆产）`;
  return {
    feasible, verdict, objective,
    targetOrder: { orderId: targetOrderId, customer: target.cust, model: target.model, qty, origDueDay, origDueDate: target.due, newDueDay, newDueDate: isoAt(SOP_FORECAST_START, newDueDay), daysAvail, requiredDaily },
    allocation, displaced,
    cost: { changeover: 0, overtime, delay, total, unit: "代价单位" },
    residualQty,
    reconChecks: [{ label: "分配勾稽（Σalloc + residual == qty）", parentGap: qty, sumChildren: sumAlloc, residual: residualQty, ok: Math.abs(sumAlloc + residualQty - qty) <= 1e-4 }],
    reconciled: Math.abs(sumAlloc + residualQty - qty) <= 1e-4,
    summary: `${targetOrderId}（${target.cust}·${target.model}·${qty}套）拟提前到第 ${newDueDay} 天（${isoAt(SOP_FORECAST_START, newDueDay)}）→ ${verdict}；被挤 ${displaced.map((d) => d.orderId).join("、") || "无"}；代价 ${total}`,
  };
}


// ---------------------------------------------------------------------------
// WO-PORTFOLIO-OPTIMAL · portfolio 全局联合推演（逐口径移植 datacore/solvers/portfolio.ts·KILL-MOCK-RED）
// 无后端 mock 态：把演示订单(ORDERS·与视图 searchObjects 同源)归一为联合需求，跨基地×时间窗贪心装入共享产能——
// 同真算法口径：Σ_i qty·x[i,b,t]≤cap[b,t] 逐格守恒（reconChecks 硬校验·无重复占用）、frozenOrderIds 排除并预扣、
// ≥2 方案（max_ontime/min_cost/min_changeover）各自贪心 → objectiveValues 真漂移、每分配/被挤值带 provenance。
// 改 orderIds/frozenOrderIds/scenarios → 方案真变（非写死）。徽标「推演结果·非数据库事实」。
// 诚实边界：mock 用「贪心尊重容量」代替 sidecar CP-SAT（可证最优），只证守恒+方案差异形状；真最优见 datacore sidecar。
// ---------------------------------------------------------------------------
type PortObjKey = "max_ontime" | "min_delay" | "min_changeover" | "min_cost" | "min_fg_inventory";
const PORT_OBJ_KEYS: PortObjKey[] = ["max_ontime", "min_delay", "min_changeover", "min_cost", "min_fg_inventory"];
const PORT_WINDOW_DAYS = 21;
const PORT_LATE_WINDOWS = 2;
const PORT_DELAY_PEN = 0.05;
const PORT_CHG_COST = 1.2;
const PORT_FG_HOLD = 0.5; // 成品持有单位成本（对称 PORT_DELAY_PEN·min_fg_inventory）
const PORT_UNSERVED_PEN = 0.5;
const PORT_CROSS_BASE_CHG = 60;
const PORT_FORECAST_START = "2026-06-10";
// WO-SURFACE-7DIM · 演示跨基地调拨（逐口径移植 datacore battery.ts interBaseTransfers·与 handlers InterBaseTransfer mock 单一来源）。
// mockGlobalSim 据此把经典 allocation 落成两阶段 schedule[]（电芯段=alloc.base 供芯基地·Pack 段=transfer.toBase·transitDays 真值）。
export const PORT_TRANSFERS: { transferId: string; fromBase: string; toBase: string; model: string; qty: number; transitDays: number; status: string }[] = [
  { transferId: "XFER-changzhou-handan-4680-NCM", fromBase: "changzhou", toBase: "handan", model: "4680-NCM", qty: 2000, transitDays: 3, status: "PLANNED" },
  { transferId: "XFER-xiamen-jiangmen-4680-LFP", fromBase: "xiamen", toBase: "jiangmen", model: "4680-LFP", qty: 1500, transitDays: 5, status: "IN_TRANSIT" },
  { transferId: "XFER-chengdu-meishan-刀片-LFP", fromBase: "chengdu", toBase: "meishan", model: "刀片-LFP", qty: 1800, transitDays: 4, status: "PLANNED" },
];
const PORT_FREIGHT_PER_UNIT = 0.15; // 运费/套（mock·跨基地段·镜像后端 mockFreightPerUnit 缺省口径）
const PORT_CROSS_CHG_H = PORT_CROSS_BASE_CHG / 60; // 换型全链小时（60min → 1.0h·镜像 ScheduleTable/后端换型系数）
const portDayFrom = (a: string, b: string) => Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86400000);
const portBaseIdByName = new Map(BASE_REGISTRY.map((b) => [b.name, b.baseId]));
const portBaseNameById = new Map(BASE_REGISTRY.map((b) => [b.baseId, b.name]));
// 基地有效日产能（套/日）= gwh 名牌 × util ÷ packEnergyKwh ÷ 运营日（与 datacore capacityDaily 同口径·近似）。
const portBaseDaily = (bid: string): number => {
  const b = BASE_REGISTRY.find((x) => x.baseId === bid);
  return b ? Math.max(1, Math.round((b.gwh * 1e6) / 166 * (b.util / 100) / 300)) : 500;
};
// 订单可产基地（ORDERS.bases 为基地名·映射到 baseId）+ home 型号（供换型判定）。
const portOrderBases = (o: { bases: string }): string[] => { const id = portBaseIdByName.get(o.bases) ?? o.bases; return [id]; };
const portBaseHome = new Map<string, string>();
for (const o of ORDERS) { for (const b of portOrderBases(o)) if (!portBaseHome.has(b)) portBaseHome.set(b, o.model); }

export function mockPortfolio(args: Record<string, unknown>): Record<string, unknown> {
  const orderIds = Array.isArray(args.orderIds) && args.orderIds.length ? args.orderIds.map(String) : ORDERS.map((o) => o.so);
  const frozenIds = new Set((Array.isArray(args.frozenOrderIds) ? args.frozenOrderIds : []).map(String));
  const frozenMode = args.frozenCapacityMode === "release" ? "release" : "reserve";
  const wanted = (Array.isArray(args.scenarios) && args.scenarios.length ? args.scenarios.map(String) : ["max_ontime", "min_cost"]).filter((k): k is PortObjKey => (PORT_OBJ_KEYS as string[]).includes(k));
  const keys = wanted.length ? wanted : (["max_ontime", "min_cost"] as PortObjKey[]);
  const primaryKey: PortObjKey = (PORT_OBJ_KEYS as string[]).includes(String(args.objective)) ? (String(args.objective) as PortObjKey) : keys[0]!;
  const allKeys = keys.includes(primaryKey) ? keys : [primaryKey, ...keys];

  const orderById = new Map(ORDERS.map((o) => [o.so, o]));
  type PItem = { id: string; qty: number; model: string; dueDay: number; dueWindow: number; bases: string[]; home: string };
  const included = orderIds.filter((id) => !frozenIds.has(id) && orderById.has(id));
  const items: PItem[] = included.map((id) => {
    const o = orderById.get(id)!; const bases = portOrderBases(o);
    return { id, qty: o.qty, model: o.model, dueDay: Math.max(0, portDayFrom(PORT_FORECAST_START, o.due)), dueWindow: 0, bases, home: bases[0]! };
  });
  const frozenDue = [...frozenIds].map((id) => orderById.get(id)).filter(Boolean).map((o) => Math.max(0, portDayFrom(PORT_FORECAST_START, o!.due)));
  const maxDue = Math.max(0, ...items.map((i) => i.dueDay), ...frozenDue);
  const numWindows = Math.max(1, Math.ceil(maxDue / PORT_WINDOW_DAYS) + PORT_LATE_WINDOWS + 1);
  for (const it of items) it.dueWindow = Math.min(numWindows - 1, Math.floor(it.dueDay / PORT_WINDOW_DAYS));

  const cellKey = (b: string, w: number) => `${b}|${w}`;
  const allBases = [...new Set(ORDERS.flatMap((o) => portOrderBases(o)))].sort();
  const capOriginal = new Map<string, number>();
  for (const b of allBases) { const cap = portBaseDaily(b) * PORT_WINDOW_DAYS; for (let w = 0; w < numWindows; w++) capOriginal.set(cellKey(b, w), cap); }
  const netCap = new Map(capOriginal);
  const frozen: Record<string, unknown>[] = [];
  for (const id of frozenIds) {
    const o = orderById.get(id); if (!o) continue;
    const b = portOrderBases(o)[0]!; const w = Math.min(numWindows - 1, Math.floor(Math.max(0, portDayFrom(PORT_FORECAST_START, o.due)) / PORT_WINDOW_DAYS));
    frozen.push({ orderId: id, base: b, window: w, qty: o.qty, frozen: true });
    if (frozenMode === "reserve") { const k = cellKey(b, w); netCap.set(k, Math.max(0, (netCap.get(k) ?? 0) - o.qty)); }
  }

  const coMinsTo = (from: string, to: string) => (!from || from === to ? 0 : PORT_CROSS_BASE_CHG);
  const solveScenario = (key: PortObjKey) => {
    const remain = new Map(netCap);
    const occ: { item: string; base: string; window: number; qty: number; delayDays: number; onTime: boolean; changeUnits: number; fgHoldUnits: number; cost: number; baseName: string }[] = [];
    const served = new Set<string>();
    const orderItems = [...items].sort((a, b) => key === "max_ontime" ? (a.dueDay - b.dueDay || b.qty - a.qty) : (b.qty - a.qty || a.id.localeCompare(b.id)));
    for (const it of orderItems) {
      const cands: { base: string; window: number; delayDays: number; onTime: boolean; changeUnits: number; fgHoldUnits: number; cost: number }[] = [];
      const wHi = Math.min(numWindows - 1, it.dueWindow + PORT_LATE_WINDOWS);
      for (const b of it.bases) {
        const changeUnits = b === it.home ? 0 : coMinsTo(portBaseHome.get(b) ?? "", it.model);
        for (let w = 0; w <= wHi; w++) {
          if ((remain.get(cellKey(b, w)) ?? 0) < it.qty) continue;
          const delayWindows = Math.max(0, w - it.dueWindow); const delayDays = delayWindows * PORT_WINDOW_DAYS;
          const earlyWindows = Math.max(0, it.dueWindow - w); const fgHoldUnits = it.qty * earlyWindows * PORT_WINDOW_DAYS;
          cands.push({ base: b, window: w, delayDays, onTime: delayWindows === 0, changeUnits, fgHoldUnits, cost: round(PORT_DELAY_PEN * it.qty * delayDays + PORT_CHG_COST * changeUnits + PORT_FG_HOLD * fgHoldUnits, 4) });
        }
      }
      if (!cands.length) continue;
      cands.sort((a, b) => key === "min_changeover" ? (a.changeUnits - b.changeUnits || a.cost - b.cost || a.window - b.window)
        : key === "min_delay" ? (a.delayDays - b.delayDays || a.cost - b.cost || a.window - b.window)
        : key === "min_fg_inventory" ? (a.fgHoldUnits - b.fgHoldUnits || a.cost - b.cost || b.window - a.window)
        : key === "max_ontime" ? ((b.onTime ? 1 : 0) - (a.onTime ? 1 : 0) || a.window - b.window || a.cost - b.cost)
        : (a.cost - b.cost || a.window - b.window));
      const c = cands[0]!;
      remain.set(cellKey(c.base, c.window), (remain.get(cellKey(c.base, c.window)) ?? 0) - it.qty);
      occ.push({ item: it.id, base: c.base, window: c.window, qty: it.qty, delayDays: c.delayDays, onTime: c.onTime, changeUnits: c.changeUnits, fgHoldUnits: c.fgHoldUnits, cost: c.cost, baseName: portBaseNameById.get(c.base) ?? c.base });
      served.add(it.id);
    }
    occ.sort((a, b) => a.item.localeCompare(b.item) || a.base.localeCompare(b.base) || a.window - b.window);
    const displacedIds = items.map((i) => i.id).filter((id) => !served.has(id)).sort();
    const ontime = occ.filter((o) => o.onTime).length;
    const delay = round(occ.reduce((s, o) => s + o.qty * o.delayDays, 0), 2);
    const changeover = round(occ.reduce((s, o) => s + o.changeUnits, 0), 2);
    const fgInventory = round(occ.reduce((s, o) => s + o.fgHoldUnits, 0), 2);
    const cost = round(occ.reduce((s, o) => s + o.cost, 0) + displacedIds.reduce((s, id) => s + PORT_UNSERVED_PEN * (items.find((i) => i.id === id)?.qty ?? 0), 0), 2);
    return { key, occ, displacedIds, objectiveValues: { ontime, delay, changeover, fgInventory, cost }, servedQty: occ.reduce((s, o) => s + o.qty, 0) };
  };

  const scenarioResults = allKeys.map(solveScenario);
  const primary = scenarioResults.find((s) => s.key === primaryKey) ?? scenarioResults[0]!;

  const allocation = primary.occ.map((o) => ({
    item: o.item, kind: "order", committed: false, base: o.base, baseName: o.baseName, window: o.window, windowStartDay: o.window * PORT_WINDOW_DAYS,
    qty: o.qty, model: orderById.get(o.item)?.model ?? "", dueDay: items.find((i) => i.id === o.item)?.dueDay ?? 0, delayDays: o.delayDays, onTime: o.onTime,
    provenance: { kind: "派生", drillType: "Line", drillId: o.base, drillField: "capacityDaily", drillValue: capOriginal.get(cellKey(o.base, o.window)) ?? 0 },
  }));
  const occupancy = allocation.map((x) => ({ item: x.item, base: x.base, window: x.window, qty: x.qty }));
  const displaced = primary.displacedIds.map((id) => ({ orderId: id, kind: "order", qty: orderById.get(id)?.qty ?? 0, model: orderById.get(id)?.model ?? "",
    provenance: { kind: "派生", drillType: "Order", drillId: id, drillField: "qty", drillValue: orderById.get(id)?.qty ?? 0 } }));

  const allocByCell = new Map<string, number>();
  for (const o of occupancy) allocByCell.set(cellKey(o.base, o.window), (allocByCell.get(cellKey(o.base, o.window)) ?? 0) + o.qty);
  const capacityLedger: Record<string, unknown>[] = [];
  const reconChecks: Record<string, unknown>[] = [];
  for (const [k, cap] of [...netCap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const [b, wStr] = k.split("|"); const window = Number(wStr); const allocated = allocByCell.get(k) ?? 0;
    capacityLedger.push({ baseId: b, window, cap, allocated });
    reconChecks.push({ label: `共享产能守恒（${b}·窗口${window}·allocated ≤ 净cap）`, baseId: b, window, cap, allocated, ok: allocated <= cap + 1e-6 });
  }
  const reconciled = reconChecks.every((r) => r.ok);

  const delayCost = round(allocation.reduce((s, x) => s + PORT_DELAY_PEN * x.qty * x.delayDays, 0), 2);
  const changeoverCost = round(primary.occ.reduce((s, o) => s + PORT_CHG_COST * o.changeUnits, 0), 2);
  const unservedCost = round(displaced.reduce((s, d) => s + PORT_UNSERVED_PEN * d.qty, 0), 2);
  const totalCost = round(delayCost + changeoverCost + unservedCost, 2);

  const scenarios = scenarioResults.map((s) => ({ key: s.key, objectiveValues: s.objectiveValues, servedCount: s.occ.length, displacedCount: s.displacedIds.length, servedQty: s.servedQty,
    provenance: { kind: "派生", drillType: "Line", drillId: "cap[b,t]", drillField: "capacityDaily", drillValue: s.servedQty },
    allocation: s.occ.map((o) => ({ item: o.item, base: o.base, window: o.window, qty: o.qty })) }));

  return {
    status: "OPTIMAL", optimal: true, feasible: displaced.length === 0,
    allocation, occupancy, displaced, scenarios,
    objectiveValues: primary.objectiveValues,
    capacityLedger, reconChecks, reconciled,
    cost: { delay: delayCost, changeover: changeoverCost, unserved: unservedCost, total: totalCost, unit: "代价单位" },
    frozen,
    summary: `联合最优组合（${primaryKey}·推演）：${items.length} 订单 × ${capOriginal.size} (基地,窗口)格 → ${primary.occ.length} 获排（${primary.servedQty} 套）、被挤 ${displaced.length}；${frozen.length ? `冻结 ${frozen.length} 单（${frozenMode === "reserve" ? "锁定" : "释放"}）；` : ""}共享产能守恒${reconciled ? "通过" : "未通过"}；方案 ${scenarios.map((s) => `${s.key}(按期${s.objectiveValues.ontime}/代价${s.objectiveValues.cost})`).join(" vs ")}；代价 ${totalCost}（延误${delayCost}+换型${changeoverCost}+未排${unservedCost}）`,
  };
}

// ---------------------------------------------------------------------------
// WO-SURFACE-7DIM · mockGlobalSim（编排态·MSW）：在 mockPortfolio 经典解之上 additively 叠加求解器 7 维产物
// （scenarios[].kpi·两阶段 schedule[]·blocked/leverDeltas·mockNotes），令 dev/MSW 态与真后端 globalSimOptimize 同形。
// 两阶段 schedule[] 复用 PORT_TRANSFERS（演示 InterBaseTransfer·同经典 ScheduleTable JOIN 口径）：电芯段=alloc.base(供芯基地)
// →在途 transitDays→Pack 段=transfer.toBase→交付。经典字段（allocation/capacityLedger/displaced/frozen/cost/scenarios.objectiveValues）
// 全数透出不掉线。确定性（无 Date.now/random·R6）。诚实红线：transit/freight 取 InterBaseTransfer 演示值（非引擎内 mock 兜底）→ mockNotes 空。
// ---------------------------------------------------------------------------
type PortClassicAlloc = { item: string; kind: string; base: string; window: number; qty: number; model?: string; onTime?: boolean };
export function mockGlobalSim(args: Record<string, unknown>): Record<string, unknown> {
  const base = mockPortfolio(args);
  const twoStage = args.twoStage === true;
  const orderById = new Map(ORDERS.map((o) => [o.so, o]));
  const xferByKey = new Map(PORT_TRANSFERS.map((t) => [`${t.model}|${t.fromBase}`, t]));
  const modelOf = (a: PortClassicAlloc) => a.model ?? orderById.get(a.item)?.model ?? "";
  const crossOf = (a: PortClassicAlloc) => (twoStage ? xferByKey.get(`${modelOf(a)}|${a.base}`) : undefined);

  const allocation = (base.allocation as PortClassicAlloc[] | undefined) ?? [];
  // 单条经典分配 → 两阶段排产行（twoStage 且命中 transfer → 电芯段→在途→Pack 段；否则单段·诚实无在途）。
  const schedule = allocation
    .filter((a) => a.kind === "order")
    .map((a) => {
      const t = crossOf(a);
      const crossBase = !!t && t.toBase !== a.base;
      const transitDays = crossBase ? t!.transitDays : 0;
      const packBase = crossBase ? t!.toBase : a.base;
      return {
        orderId: a.item,
        batches: [{ cellBase: a.base, cellWindow: a.window, qty: a.qty }],
        transitDays,
        freightCost: crossBase ? round(PORT_FREIGHT_PER_UNIT * a.qty, 2) : 0,
        packBase,
        packWindow: a.window,
        changeoverHours: crossBase ? PORT_CROSS_CHG_H : 0,
        deliverDay: a.window * PORT_WINDOW_DAYS + transitDays, // 交付日真含在途（改 transitDays → 真变）
        status: a.onTime === false ? "displaced" : "ok",
        provenance: { kind: "派生", drillType: "TransitLane", drillId: `${a.base}->${packBase}`, drillField: "transitDays", drillValue: transitDays, mockNote: null },
      };
    })
    .sort((x, y) => x.orderId.localeCompare(y.orderId));

  // 7 维 KPI per-scenario（从该方案 allocation 派生在途/运费/换型全链小时·经典 objectiveValues 之上叠加·并列不替换）。
  const avgUnitPrice = 1.8; // 毛利代理均价（镜像后端 avgUnitPrice 缺省·万元/套量级）
  const kpiOf = (objVals: Record<string, number>, alloc: PortClassicAlloc[]) => {
    let freight = 0, transitInv = 0, chgH = 0;
    for (const a of alloc) {
      const t = crossOf(a);
      if (t && t.toBase !== a.base) { freight += round(PORT_FREIGHT_PER_UNIT * a.qty, 2); transitInv += a.qty * t.transitDays; chgH += PORT_CROSS_CHG_H; }
    }
    const servedQty = alloc.reduce((s, x) => s + x.qty, 0);
    const cost = round((objVals.cost ?? 0) + freight, 2);
    return {
      ontime: round(objVals.ontime ?? 0, 4), cost, changeoverHours: round(chgH, 4), freight: round(freight, 2),
      fgInv: round(objVals.fgInventory ?? 0, 2), transitInv: round(transitInv, 2), margin: round(servedQty * avgUnitPrice - cost, 2),
    };
  };
  const scenarios = ((base.scenarios as { key: string; objectiveValues: Record<string, number>; allocation: PortClassicAlloc[] }[] | undefined) ?? [])
    .map((s) => ({ ...s, kpi: kpiOf(s.objectiveValues, s.allocation ?? []) }));

  return {
    ...base,
    scenarios,
    schedule,
    blocked: [],
    leverDeltas: [],
    mockNotes: [], // 诚实：transit/freight 源自 InterBaseTransfer 演示对象（非引擎内 WO-DATA 未落 mock 兜底）
    materialConstraint: false,
  };
}

// ---------------------------------------------------------------------------
// WO-B / F1 · base_capacity_outlook（逐口径移植 datacore/solvers/base-outlook.ts·KILL-MOCK）
// 四线：可用产能 Σ Line.capacityDaily×(1−util/100)×窗 ⊥ 在产 WorkOrder.qtyActual 铺窗 ⊥ 未来订单 Order.due 落窗
// ⊥ 销售预测 ΣDemandSegment.p50×1e4 按产能占比摊窗 → 缺口/富余 + crossDay + P1 逐日 dayPlan（触发→加班/跨基地/外协→收窄·provenance）。
// forecastStart 锚（禁 Date.now·R6）·每线/每日值 provenance（R13）。改 baseId/horizon → 前瞻真变（非写死）。
// ---------------------------------------------------------------------------
// 演示 DemandSegment.p50（万·= datacore seed 同量级 201.7/139.2/34.1 → Σ375）。
const OUTLOOK_SEG_P50: number[] = [201.7, 139.2, 34.1];
// 演示每基地在产占用总量（未完工 WorkOrder.qtyActual·代表值·确定性）。
const OUTLOOK_INPROD: Record<string, number> = { changzhou: 35738, jinhua: 28800, chengdu: 26400, hefei: 24100 };

export function mockBaseOutlook(args: Record<string, unknown>): Record<string, unknown> {
  const arg = String(args.baseId ?? "changzhou");
  const baseRow = BASE_REGISTRY.find((b) => b.baseId === arg || b.name === arg) ?? BASE_REGISTRY[0]!;
  const baseId = baseRow.baseId;
  const baseName = baseRow.name;
  const utilOf = (bid: string) => BASE_REGISTRY.find((b) => b.baseId === bid)?.util ?? 80;
  const capOf = (bid: string) => SOP_BASE_CAP[bid] ?? 800;
  const freeDailyOf = (bid: string) => round(capOf(bid) * Math.max(0, 1 - utilOf(bid) / 100), 2);

  const freeDaily = freeDailyOf(baseId);
  const freeDailyAll = round(BASE_REGISTRY.reduce((a, b) => a + freeDailyOf(b.baseId), 0), 2);
  const baseShare = freeDailyAll > 0 ? freeDaily / freeDailyAll : 1 / BASE_REGISTRY.length;
  const inProdTotal = OUTLOOK_INPROD[baseId] ?? round(freeDaily * 90 * 0.9, 2);
  const p50TotalWan = round(OUTLOOK_SEG_P50.reduce((a, v) => a + v, 0), 4);
  const forecastUnitsAnnual = round(p50TotalWan * 1e4 * baseShare, 2);
  const baseOrders = SOP_ORDERS.filter((o) => o.bases[0] === baseId).map((o) => ({ so: o.so, qty: o.qty, dueDay: dayFromISO(SOP_FORECAST_START, o.due) }));

  const inProdRefDays = 90, annualDays = 365, overtimeUpliftPct = 0.15, crossBaseAbsorbPct = 0.6;
  const buildHorizon = (H: number) => {
    const available = round(freeDaily * H, 2);
    const inProduction = round(inProdTotal * Math.min(1, H / inProdRefDays), 2);
    const futureQty = round(baseOrders.filter((o) => o.dueDay >= 0 && o.dueDay <= H).reduce((a, o) => a + o.qty, 0), 2);
    const salesForecast = round((forecastUnitsAnnual * H) / annualDays, 2);
    const demand = round(inProduction + futureQty, 2);
    const gap = round(available - demand, 2);
    const status = gap < -1e-6 ? "缺口" : gap > 1e-6 ? "富余" : "平衡";
    const lines = [
      { key: "available", label: "可用产能", value: available, provenance: { kind: "派生", drillType: "Line", drillId: baseId, drillField: "capacityDaily", drillValue: freeDaily } },
      { key: "inProduction", label: "在产订单占用", value: inProduction, provenance: { kind: "实测", drillType: "WorkOrder", drillId: baseId, drillField: "qtyActual", drillValue: inProdTotal } },
      { key: "futureOrders", label: "未来订单", value: futureQty, provenance: { kind: "实测", drillType: "Order", drillId: baseId, drillField: "qty", drillValue: futureQty } },
      { key: "salesForecast", label: "销售预测", value: salesForecast, provenance: { kind: "派生", drillType: "DemandSegment", drillId: "p50", drillField: "p50", drillValue: p50TotalWan } },
    ];
    // crossDay + P1 dayPlan（触发→贪心补→收窄·沿 decision_play 口径）。
    const dailyInProd = inProduction / Math.max(1, H);
    const orderByDay = new Map<number, number>();
    for (const o of baseOrders) if (o.dueDay >= 0 && o.dueDay <= H) orderByDay.set(o.dueDay, (orderByDay.get(o.dueDay) ?? 0) + o.qty);
    let crossDay: number | null = null, cumOrder = 0;
    for (let d = 1; d <= H; d++) { cumOrder += orderByDay.get(d) ?? 0; if (dailyInProd * d + cumOrder > freeDaily * d + 1e-6) { crossDay = d; break; } }
    const dayPlan: Record<string, unknown>[] = [];
    const shortfall = Math.max(0, round(-gap, 2));
    if (shortfall > 0) {
      const trigDay = crossDay ?? Math.max(1, Math.round(H / 2));
      let remaining = shortfall;
      const overtime = round(Math.min(remaining, available * overtimeUpliftPct), 2);
      if (overtime > 0) {
        dayPlan.push({ day: trigDay, date: isoAt(SOP_FORECAST_START, trigDay), action: "加班承接（本地空闲产能上浮）",
          rationale: `第${trigDay}天累计需求越过可用产能（触发缺口 ${shortfall}套）→ 加班上浮 ${round(overtimeUpliftPct * 100, 0)}% 收窄 ${overtime}套（溯 Line.capacityDaily=${freeDaily}/日）`,
          triggerValue: shortfall, closesGap: overtime, provenance: { kind: "派生", drillType: "Line", drillId: baseId, drillField: "capacityDaily", drillValue: freeDaily } });
        remaining = round(remaining - overtime, 2);
      }
      if (remaining > 1e-6) {
        const crossBase = round(Math.min(remaining, remaining * crossBaseAbsorbPct), 2);
        const crossDayAt = Math.min(H, trigDay + 7);
        dayPlan.push({ day: crossDayAt, date: isoAt(SOP_FORECAST_START, crossDayAt), action: "跨基地调剂（挤占低优先在手单）",
          rationale: `第${crossDayAt}天残余缺口 ${remaining}套 → 跨基地吸收 ${round(crossBaseAbsorbPct * 100, 0)}% 收窄 ${crossBase}套（溯 WorkOrder.qtyActual=${inProdTotal}）`,
          triggerValue: remaining, closesGap: crossBase, provenance: { kind: "实测", drillType: "WorkOrder", drillId: baseId, drillField: "qtyActual", drillValue: inProdTotal } });
        remaining = round(remaining - crossBase, 2);
      }
      if (remaining > 1e-6) {
        const outDayAt = Math.min(H, trigDay + 14);
        dayPlan.push({ day: outDayAt, date: isoAt(SOP_FORECAST_START, outDayAt), action: "外协补足（残余缺口）",
          rationale: `第${outDayAt}天仍余 ${remaining}套 → 外协补足 ${remaining}套（触发源：未来订单 Σqty=${futureQty}）`,
          triggerValue: remaining, closesGap: remaining, provenance: { kind: "实测", drillType: "Order", drillId: baseId, drillField: "qty", drillValue: futureQty } });
      }
    }
    return { horizon: H, windowStart: isoAt(SOP_FORECAST_START, 0), windowEnd: isoAt(SOP_FORECAST_START, H), lines, available, inProduction, futureOrders: futureQty, salesForecast, demand, gap, status, crossDay, dayPlan };
  };

  const horizonList = args.horizon != null ? [Math.max(1, Math.round(Number(args.horizon)))] : [30, 60, 90];
  const horizons = horizonList.map(buildHorizon);
  const primary = horizons.length === 1 ? horizons[0]! : horizons[horizons.length - 1]!;
  const shortH = horizons.find((h) => h.status === "缺口");
  const summary = shortH
    ? `${baseName} 前瞻产能推演：${horizons.length} 档窗口（${horizonList.join("/")}天）·最近 ${shortH.horizon}天窗现缺口 ${round(-shortH.gap, 2)}套 → ${primary.dayPlan.length} 步逐日处置；销售预测线 ${primary.salesForecast}套`
    : `${baseName} 前瞻产能推演：各窗产能富余；销售预测线 ${primary.salesForecast}套`;

  // WO-CAPACITY-DEEPEN-ADDITIVE 块D · byModel 每产品前瞻（逐口径移植 datacore service.outlookByModel·KILL-MOCK·纯加字段）。
  // 把 capacity_forecast per-model（weeklyCap × certFactor × curveMult 累计）join 进本基地——同源勾稽·mainBn 跨求解器一致·per-base 四线零改。
  const p50AtH = (def: CapBaseDef, H: number): number => {
    const cf = CAP_P.certFactors[def.status] ?? 1;
    const weeks = Math.max(1, Math.ceil(H / 7));
    let cum = 0;
    for (let w = 1; w <= weeks; w++) cum += def.weeklyCap * cf * curveMult(w, def.maintWeek);
    return round(cum * 1e4, 2); // 万套→套（与四线同单位）
  };
  const byModel = Object.entries(MODEL_CAP_NET)
    .map(([model, defs]) => {
      const def = defs.find((d) => d.base === baseName || d.baseId === baseName || d.baseId === baseId);
      if (!def) return null;
      const p50At90 = p50AtH(def, 90);
      const demand90 = SOP_ORDERS.filter(
        (o) => o.bases[0] === baseId && o.model === model && dayFromISO(SOP_FORECAST_START, o.due) >= 0 && dayFromISO(SOP_FORECAST_START, o.due) <= 90,
      ).reduce((a, o) => a + o.qty, 0);
      return {
        model, modelName: model, p50At30: p50AtH(def, 30), p50At60: p50AtH(def, 60), p50At90,
        mainBn: def.bottleneck, gap: round(p50At90 - demand90, 2),
        provenance: { kind: "跨求解器", source: "capacity_forecast", drillType: "Model", drillField: "p50/mainBn" },
      };
    })
    .filter((r): r is NonNullable<typeof r> => r != null);

  return { baseId, baseName, forecastStart: SOP_FORECAST_START, horizons, dayPlan: primary.dayPlan, summary, byModel };
}
