import { round } from "../prng.js";
import { clamp, num, str, type SolverContext } from "./types.js";

// ---------------------------------------------------------------------------
// S1.6 plan_audit — deterministic rule diagnosis (X01–X05 / R01–R02), NOT LLM.
// ---------------------------------------------------------------------------

export interface PlanAuditInput {
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

/** Segment margins come from 应用细分 objects when present, else solverParams. */
function segMargins(c: SolverContext): { pas: number; ess: number; com: number } {
  const fromObjects: Partial<Record<string, number>> = {};
  for (const s of c.segments) fromObjects[str(s.props.segKey)] = num(s.props.gmRate);
  const d = c.params.audit.segMargins;
  return {
    pas: fromObjects.pas ?? d.pas,
    ess: fromObjects.ess ?? d.ess,
    com: fromObjects.com ?? d.com,
  };
}

export function planAudit(c: SolverContext, input: PlanAuditInput): Record<string, unknown> {
  const t = c.params.audit;
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

  const m = segMargins(c);
  const wPas = input.seg_pas / Math.max(0.0001, input.dem);
  const wEss = input.seg_ess / Math.max(0.0001, input.dem);
  const wCom = input.seg_com / Math.max(0.0001, input.dem);
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
    H.push({
      id: "X05",
      title: "现金垫",
      ruleRef: "C18",
      why: `现金垫 ${input.cashCushion} 亿低于底线 ${t.cashHard} 亿`,
      fix: {
        label: "CAPEX 缩减/推后",
        patch: { capex: Math.max(0, round(input.capex - (t.cashHard - input.cashCushion), 2)) },
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
        patch: { capex: Math.max(0, round(input.capex - (t.cashSoft - input.cashCushion), 2)) },
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

  // 建议修正 S[] — one suggestion per fix-able finding.
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
// S1.7 plan_generate — 5-path library → 3 schemes (稳健/均衡/进取)
// ---------------------------------------------------------------------------

export interface PlanGenerateArgs {
  targets?: { gmFloor?: number; cashFloor?: number; capexCap?: number };
  base?: { rev?: number; gm?: number; share?: number; turns?: number; cash?: number };
}

interface PathEval {
  pathKey: string;
  name: string;
  outcome: { rev: number; gm: number; share: number; turns: number; cash: number; capex: number };
  scores: { profit: number; scale: number; cash: number; growth: number; stability: number; total: number };
  hardViol: string[];
}

export function planGenerate(c: SolverContext, args: PlanGenerateArgs): Record<string, unknown> {
  const cfg = c.params.planGenerate;
  const base = { ...cfg.base, ...(args.base ?? {}) };
  const targets = { ...cfg.targets, ...(args.targets ?? {}) };
  const sc = cfg.scores;

  const evals: PathEval[] = Object.entries(cfg.paths).map(([pathKey, eff]) => {
    const outcome = {
      rev: round(base.rev * eff.rev, 4),
      gm: round(base.gm + eff.gm, 4),
      share: round(base.share + eff.share, 4),
      turns: round(base.turns + eff.turns, 4),
      cash: round(base.cash + eff.cash, 4),
      capex: eff.capex,
    };
    const hardViol: string[] = [];
    if (outcome.gm < targets.gmFloor) hardViol.push("C15");
    if (outcome.cash < targets.cashFloor) hardViol.push("C18");
    if (outcome.capex > targets.capexCap) hardViol.push("CAPEX");
    const profit = clamp(round(sc.profitBase + (outcome.gm - targets.gmFloor) * sc.profitK, 4), 0, 100);
    const scale = clamp(round(sc.scaleBase + eff.share * sc.scaleK, 4), 0, 100);
    const cash = clamp(round(sc.cashBase + (outcome.cash - targets.cashFloor) * sc.cashK, 4), 0, 100);
    const growth = clamp(round(sc.growthBase + (outcome.rev - base.rev) * sc.growthK, 4), 0, 100);
    const stability = clamp(round(sc.stabBase - outcome.capex * sc.stabK, 4), 0, 100);
    const total = Math.max(
      0,
      Math.round((profit + scale + cash + growth + stability) / 5) - sc.hardPenalty * hardViol.length,
    );
    return { pathKey, name: eff.name, outcome, scores: { profit, scale, cash, growth, stability, total }, hardViol };
  });

  const byKey = new Map(evals.map((e) => [e.pathKey, e]));
  const pick = (k: string): PathEval => byKey.get(k) as PathEval;
  const cEval = pick("C");
  const bEval = pick("B");
  const aggressive = cEval.scores.total >= bEval.scores.total ? cEval : bEval;
  const schemeOf = (no: string, name: string, ev: PathEval): Record<string, unknown> => ({
    no,
    name,
    pathKey: ev.pathKey,
    outcome: ev.outcome,
    scores: ev.scores,
    hardViol: ev.hardViol,
    gain: cfg.gains[ev.pathKey] ?? [],
    give: cfg.gives[ev.pathKey] ?? [],
    problems: ev.hardViol.map((v) => ({
      ruleRef: v,
      title:
        v === "C15"
          ? `毛利 ${ev.outcome.gm} 低于底线 ${targets.gmFloor}`
          : v === "C18"
            ? `现金垫 ${ev.outcome.cash} 低于底线 ${targets.cashFloor}`
            : `CAPEX ${ev.outcome.capex} 超过上限 ${targets.capexCap}`,
      unlock:
        v === "CAPEX" ? `提高 CAPEX 上限至 ≥${ev.outcome.capex} 可解锁` : "调整目标面板对应底线可解锁",
    })),
  });
  const schemes = [
    schemeOf("S1", cfg.schemeNames.steady, pick("A")),
    schemeOf("S2", cfg.schemeNames.balanced, pick("E")),
    schemeOf("S3", cfg.schemeNames.aggressive, aggressive),
  ];
  const eligible = schemes.filter((s) => (s.hardViol as string[]).length === 0);
  // recommend = 无违规方案中 total 最高（以路径键标识，如默认数据下为 E）
  const recommend =
    eligible.length > 0
      ? str(
          [...eligible].sort(
            (x, y) =>
              ((y.scores as { total: number }).total - (x.scores as { total: number }).total) ||
              (str(x.no) < str(y.no) ? -1 : 1),
          )[0]?.pathKey,
        )
      : "";

  return {
    schemes,
    recommend,
    // Per-path drilldown (all 5 paths incl. ⛔-marked violators per S1.7 "仍展示").
    paths: evals,
    targets,
    base,
  };
}
