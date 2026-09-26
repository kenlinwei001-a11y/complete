import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import type { GapReport, GapCode, GrowthRunReport } from "@platform/contracts";
import { runGrowth } from "@/api/endpoints";
import { toastError } from "@/store/toastStore";
import zh from "@/locales/zh";
import styles from "./AnswerBlocks.module.css";

/**
 * CL.7（PRD-in-dialog-gap-fill-loop）：对话坞内缺口卡——答案命中缺口时，给出可点的
 * 「▶ 触发生成缺失数据」（复用自成长 LOOP /b/v1/growth/run，按码内部分派 fill-data/合成/建域），
 * 流程完成后出「继续推演」重跑原问句；补不出（需开发/边界）→ 诚实"不可达：断在 <码>" + 工单深链。
 * 闭 G-3 对话侧（绿测试≠能用：补不出就如实显示断点，不假装成功）。
 */

/** 缺口码 → 处置配置（R14 配置化，前端零业务常数）。triggerable=可即时触发产数据；否则深链开发/工单。 */
const GAP_DISPOSITION: Record<GapCode, { label: string; triggerable: boolean }> = {
  ANSWERABLE: { label: "无缺口", triggerable: false },
  NO_INTENT: { label: "无意图覆盖", triggerable: false },
  NO_PLAN: { label: "无执行计划（需建域）", triggerable: true },
  NO_SLICE: { label: "缺切片", triggerable: true },
  EMPTY_DATA: { label: "数据为空（需补数据）", triggerable: true },
  NO_RULE: { label: "缺规则", triggerable: false },
  SOLVER_NOT_FOUND: { label: "缺求解器（需开发/骨架）", triggerable: false },
  SHAPE_MISMATCH: { label: "渲染形状不匹配", triggerable: false },
  NO_CAPABILITY: { label: "缺领域能力（需开发）", triggerable: false },
  // OTHER（含路径 B agent 中断）：触发自成长 LOOP 做真实 classifyGap 诊断+补，再续推。
  OTHER: { label: "未定位缺口（触发诊断）", triggerable: true },
};

export function GapCard({ report, onRetry }: { report: GapReport; onRetry?: () => void }) {
  const [done, setDone] = useState<GrowthRunReport | null>(null);
  const blocking = report.findings.filter((f) => f.blocking);
  const primary = blocking[0] ?? report.findings[0];
  const code = (primary?.gapCode ?? "OTHER") as GapCode;
  const disp = GAP_DISPOSITION[code];

  const trigger = useMutation({
    mutationFn: () => runGrowth(report.question),
    onSuccess: (r) => setDone(r),
    onError: toastError,
  });

  const converged = done?.terminalState === "CONVERGED";
  const stuckCode = done?.openTickets?.[0]?.gapCode ?? done?.rounds?.[done.rounds.length - 1]?.gapReport?.findings?.[0]?.gapCode ?? code;

  return (
    <div className={styles.gapCard} data-testid="gap-card" data-gapcode={code}>
      <div className={styles.gapHead}>
        <span className="badge amber" data-testid="gap-code">{zh.dock.gapTitle} · {code}</span>
        <span className={styles.gapVerdict}>{disp.label}</span>
      </div>
      {primary && (
        <div className={styles.gapBody}>
          <div className="zh">{primary.suggestedFill || primary.evidence}</div>
        </div>
      )}

      {/* 触发产数据（可即时补）→ 完成后续推；不可即时补 → 诚实断点 + 工单深链 */}
      {!done && disp.triggerable && (
        <button
          className="btn sm"
          data-testid="gap-trigger"
          disabled={trigger.isPending}
          onClick={() => trigger.mutate()}
        >
          {trigger.isPending ? zh.dock.gapTriggering : zh.dock.gapTrigger}
        </button>
      )}
      {!done && !disp.triggerable && (
        <div className={styles.gapBoundary} data-testid="gap-boundary">
          {zh.dock.gapUnreachable(code)}
          <Link to="/admin/growth" className="btn sm" style={{ marginLeft: 8 }} data-testid="gap-ticket-link">
            {zh.dock.gapTicket}
          </Link>
        </div>
      )}

      {done && (
        <div className={styles.gapResult} data-testid="gap-result">
          {converged ? (
            <>
              <span className="badge green">{zh.dock.gapFilled}</span>
              {onRetry && (
                <button className="btn sm" style={{ marginLeft: 8 }} data-testid="gap-continue" onClick={onRetry}>
                  {zh.dock.gapContinue}
                </button>
              )}
            </>
          ) : (
            <div className={styles.gapBoundary} data-testid="gap-still-blocked">
              {zh.dock.gapUnreachable(stuckCode)}
              <Link to="/admin/growth" className="btn sm" style={{ marginLeft: 8 }} data-testid="gap-ticket-link">
                {zh.dock.gapTicket}
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
