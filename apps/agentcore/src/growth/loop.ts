import type { GapFinding, GapReport, GrowthFillResult, GrowthRound, GrowthRunReport } from "@platform/contracts";

/**
 * 自成长发动机 P3 · LOOP：把"客户问句"跑成一个 探针→补齐→重跑→收敛 的有界闭环。
 *  - probe()  : 重新提交问句 → orchestrator 实跑 → GapReport（P1）。
 *  - fill(gap): 据缺口码分派补法（缺数据真人正门 / scaffold / generic-inference 兜底 / 出工单）。
 * 收敛终态（PRD §8）：① CONVERGED（出可验证答案）② BOUNDARY（仅剩缺功能工单——系统已做完它能做的）
 *  ③ MAX_ROUNDS（K 轮内未收敛）。纯函数式编排：probe/fill 注入，便于单测与跨系统接线。
 */
export interface GrowthLoopDeps {
  question: string;
  maxRounds: number;
  probe: () => Promise<GapReport>;
  fill: (gap: GapFinding) => Promise<GrowthFillResult>;
}

export async function runGrowthLoop(deps: GrowthLoopDeps): Promise<GrowthRunReport> {
  const rounds: GrowthRound[] = [];
  const openTickets: { gapCode: GapFinding["gapCode"]; detail: string }[] = [];
  const K = Math.max(1, Math.min(deps.maxRounds, 20)); // K 前端可配，硬上限 20 防失控

  let terminalState: GrowthRunReport["terminalState"] = "MAX_ROUNDS";
  for (let round = 1; round <= K; round++) {
    const gapReport = await deps.probe();

    // ① 收敛：可答
    if (gapReport.verdict === "ANSWERABLE") {
      rounds.push({ round, gapReport });
      terminalState = "CONVERGED";
      break;
    }

    const top = gapReport.findings[0];
    // ② 边界：缺功能（系统自动做不了）→ 出工单收敛
    if (!top || top.gapCode === "NO_CAPABILITY") {
      rounds.push({ round, gapReport });
      if (top) openTickets.push({ gapCode: top.gapCode, detail: top.evidence });
      terminalState = "BOUNDARY";
      break;
    }

    // ③ 可补：分派补法 → 记录 → 下一轮重跑
    const fillApplied = await deps.fill(top);
    rounds.push({ round, gapReport, fillApplied });

    // GROWTH-WORKLIST-HUMAN-FILL：可补项已登记在办看板、**不自动补** → 该轮终态 NEEDS_HUMAN（待人工认领点触发），
    // 非 CONVERGED/BOUNDARY（诚实：系统诊断出可补但把触发权交回人手·G-9 自动补→人工闸控补）。
    if (fillApplied.needsHuman) {
      terminalState = "NEEDS_HUMAN";
      break;
    }
    // 补法产出工单（当前无法自动补、需开发）→ 已做完能做的，收敛到边界
    if (fillApplied.ticket) {
      openTickets.push(fillApplied.ticket);
      terminalState = "BOUNDARY";
      break;
    }
    // 既未推进、也没工单 → 提前停，避免空转到 K
    if (!fillApplied.advanced) {
      terminalState = "MAX_ROUNDS";
      break;
    }
    // advanced=true → 继续下一轮重跑
  }

  return {
    question: deps.question,
    maxRounds: K,
    rounds,
    terminalState,
    openTickets,
    generatedAt: new Date().toISOString(),
  };
}
