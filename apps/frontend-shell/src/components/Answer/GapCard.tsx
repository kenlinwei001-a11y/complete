import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import type { GapReport, GapCode, GrowthRunReport, TriggerBoundaryDecision } from "@platform/contracts";
import { growthTrigger, type GrowthTriggerResponse } from "@/api/endpoints";
import { SlotFillingForm } from "@/components/QueryDock/Clarification";
import { toastError } from "@/store/toastStore";
import zh from "@/locales/zh";
import styles from "./AnswerBlocks.module.css";

/**
 * CL.7（PRD-in-dialog-gap-fill-loop）：对话坞内缺口卡——答案命中缺口时，给出可点的
 * 「▶ 触发生成缺失数据」（复用自成长 LOOP /b/v1/growth/run，按码内部分派 fill-data/合成/建域），
 * 流程完成后出「继续推演」重跑原问句；补不出（需开发/边界）→ 诚实"不可达：断在 <码>" + 工单深链。
 * 闭 G-3 对话侧（绿测试≠能用：补不出就如实显示断点，不假装成功）。
 *
 * FILL-BOUNDARY-GUARDRAIL（用户钉「触发补须有边界」）：触发不再直接跑，先经后端三闸——
 *  - **B1 CLARIFY**：泛问题缺必需槽位（对象域/实体/时间窗）→ 复用 Clarification SLOT_FILLING「第 n/2 次确认」先澄清；
 *  - **B2 PREVIEW**：槽位齐 → 出生成计划预览（将建类型/行数/值域来源/有界枚举取值）人确认才跑；
 *  - **B3 HARD_BLOCK**：词表外新实体 → 拒自动合成，出 DataRequest 要求人工输入数据描述 → R4 审批正门。
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
  const [gate, setGate] = useState<TriggerBoundaryDecision | null>(null);
  const [slotValues, setSlotValues] = useState<Record<string, unknown>>({});
  const [dataReqDone, setDataReqDone] = useState(false);
  const blocking = report.findings.filter((f) => f.blocking);
  const primary = blocking[0] ?? report.findings[0];
  const code = (primary?.gapCode ?? "OTHER") as GapCode;
  const disp = GAP_DISPOSITION[code];

  const applyResponse = (r: GrowthTriggerResponse) => {
    if ("boundaryGate" in r) {
      setGate(r.boundaryGate);
      if (r.worklistItem) setDataReqDone(true);
    } else {
      setDone(r);
    }
  };

  // 单一 mutation 驱动三闸：初触发/澄清回填/确认生成/提交数据描述，均命中同一带边界端点。
  const trigger = useMutation({
    mutationFn: (args: { slotValues?: Record<string, unknown>; confirmed?: boolean; dataRequestDescription?: string }) =>
      growthTrigger({ query: report.question, slotValues: args.slotValues ?? slotValues, confirmed: args.confirmed, dataRequestDescription: args.dataRequestDescription }),
    onSuccess: applyResponse,
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

      {/* 触发产数据（可即时补）→ 先经边界判定（不直接跑）；不可即时补 → 诚实断点 + 工单深链 */}
      {!done && !gate && disp.triggerable && (
        <button
          className="btn sm"
          data-testid="gap-trigger"
          disabled={trigger.isPending}
          onClick={() => trigger.mutate({ confirmed: false })}
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

      {/* B1 CLARIFY：先澄清（复用 Clarification SLOT_FILLING 表单·第 n/2 次确认）——非直接触发 */}
      {!done && gate?.outcome === "CLARIFY" && (
        <div className={styles.gapBody} data-testid="gap-clarify">
          <div className="zh" style={{ marginBottom: 6 }}>
            <strong>{zh.dock.gapClarifyTitle}</strong>
            <div style={{ color: "var(--muted2)", fontSize: 12 }}>{gate.reason || zh.dock.gapClarifyHint}</div>
          </div>
          <SlotFillingForm
            testid="gap-clarify-form"
            slots={gate.missingSlots ?? []}
            round={gate.round}
            onSubmit={(values) => {
              const merged = { ...slotValues, ...values };
              setSlotValues(merged);
              setGate(null);
              trigger.mutate({ slotValues: merged, confirmed: false });
            }}
          />
        </div>
      )}

      {/* B2 PREVIEW：生成计划预览（人确认才跑）——不盲补 */}
      {!done && gate?.outcome === "PREVIEW" && gate.plan && (
        <div className={styles.gapBody} data-testid="gap-preview">
          <div className="zh"><strong>{zh.dock.gapPreviewTitle}</strong></div>
          <ul style={{ fontSize: 12, margin: "6px 0", paddingLeft: 18 }}>
            <li data-testid="gap-preview-type">{zh.dock.gapPreviewType(gate.plan.typeKey)}</li>
            <li>{zh.dock.gapPreviewRows(gate.plan.rows)}</li>
            <li>{zh.dock.gapPreviewSource(gate.plan.valueDomainSource)}</li>
            {gate.plan.boundedEnums.length > 0 && (
              <li>
                {zh.dock.gapPreviewEnums}
                {gate.plan.boundedEnums.map((e) => `${e.field}=${e.values.join("/")}`).join("；")}
              </li>
            )}
          </ul>
          <button
            className="btn primary sm"
            data-testid="gap-preview-confirm"
            disabled={trigger.isPending}
            onClick={() => { setGate(null); trigger.mutate({ slotValues, confirmed: true }); }}
          >
            {trigger.isPending ? zh.dock.gapTriggering : zh.dock.gapPreviewConfirm}
          </button>
        </div>
      )}

      {/* B3 HARD_BLOCK：越界新实体 → 拒自动合成，人工输入数据描述 → R4 正门 */}
      {!done && gate?.outcome === "HARD_BLOCK" && gate.dataRequest && (
        <div className={styles.gapBoundary} data-testid="gap-hardblock">
          <div className="zh"><strong>{zh.dock.gapHardTitle}</strong></div>
          <div style={{ color: "var(--muted2)", fontSize: 12, margin: "4px 0" }}>{gate.dataRequest.reason}</div>
          {dataReqDone ? (
            <div data-testid="gap-hardblock-done">
              <span className="badge amber">{zh.dock.gapHardDone}</span>
              <Link to="/connections" className="btn sm" style={{ marginLeft: 8 }} data-testid="gap-hardblock-deeplink">
                {zh.dock.gapHardDeeplink}
              </Link>
            </div>
          ) : (
            <form
              data-testid="gap-hardblock-form"
              onSubmit={(e) => {
                e.preventDefault();
                const desc = String(new FormData(e.currentTarget).get("desc") ?? "").trim();
                if (desc) trigger.mutate({ slotValues, dataRequestDescription: desc });
              }}
            >
              <textarea
                name="desc"
                data-testid="gap-hardblock-desc"
                placeholder={(gate.dataRequest.descriptionSchema ?? []).map((d) => `${d.field}：${d.hint}`).join("\n")}
                rows={3}
                style={{ width: "100%", fontSize: 12, margin: "4px 0" }}
              />
              <button type="submit" className="btn sm" disabled={trigger.isPending}>
                {zh.dock.gapHardSubmit}
              </button>
            </form>
          )}
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
