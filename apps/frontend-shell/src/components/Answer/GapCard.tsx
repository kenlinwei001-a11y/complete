import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { GapReport, GapCode, GrowthRunReport, TriggerBoundaryDecision } from "@platform/contracts";
import { growthTrigger, fetchPreAnalysis, type GrowthTriggerResponse } from "@/api/endpoints";
import { SlotFillingForm } from "@/components/QueryDock/Clarification";
import { toastError } from "@/store/toastStore";
import zh from "@/locales/zh";
import { CoverageRing } from "./CoverageRing";
import styles from "./AnswerBlocks.module.css";

/**
 * UPG-L0-PREANALYSIS（PRD §7.2）：GapCard 顶部**只读**预分析全景条（融合式·零新页·主体不动）。
 * 复用 report.taskId 拉 `GET /b/v1/growth/pre-analysis/:taskId`——feature 关时后端 404 → query error → 不渲染
 * （回退演练 C3：逐像素同改造前）。四状态（§7.2）：RUNNING/DONE(有缺口/无缺口)/FAILED；无 taskId/404 → null。
 * 咨询信号非判决（§10）：即便 coverageScore<0.5 也只显色，不阻断下方既有三闸（reactive 权威判决 classifyGap）。
 */
function GapPanorama({ taskId }: { taskId?: string }) {
  const pre = useQuery({
    queryKey: ["b", "growth", "pre-analysis", taskId],
    queryFn: () => fetchPreAnalysis(taskId as string),
    enabled: !!taskId,
    retry: false,
    refetchInterval: (q) => (q.state.data?.status === "RUNNING" ? 5000 : false),
  });
  if (!taskId || pre.isError || !pre.data) return null; // 404（暗发关）/未就绪 → 不渲染（改造前形态）
  const r = pre.data;
  if (r.status === "RUNNING") {
    return (
      <div className={styles.gapPanorama} data-testid="gap-panorama" data-status="RUNNING">
        <span className={styles.panoramaSummary}>{zh.dock.panoramaRunning}</span>
      </div>
    );
  }
  if (r.status === "FAILED") {
    return (
      <div className={styles.gapPanorama} data-testid="gap-panorama" data-status="FAILED">
        <span className={styles.panoramaSummary}>{zh.dock.panoramaFailed}</span>
        <button type="button" className="btn sm" onClick={() => pre.refetch()}>{zh.dock.panoramaRetry}</button>
      </div>
    );
  }
  const total = r.summary?.totalGaps ?? 0;
  const auto = r.summary?.autoFixable ?? 0;
  const score = r.summary?.coverageScore ?? 1;
  if (total === 0) {
    return (
      <div className={styles.gapPanorama} data-testid="gap-panorama" data-status="DONE" data-total="0">
        <CoverageRing score={score} />
        <span className={styles.panoramaSummary}>{zh.dock.panoramaClear}</span>
        <span className={styles.panoramaBadges}><span className={styles.panoramaBadge} data-sev="OK">{zh.dock.panoramaClear}</span></span>
      </div>
    );
  }
  // 按 severity 计数（预分析永不 BLOCKER/ERROR·§10；计数 0 的档不渲染）。
  const sevCount: Record<string, number> = {};
  for (const e of r.gapAnalysis?.entries ?? []) for (const it of e.items) if (it.severity && it.status !== "EXISTS") sevCount[it.severity] = (sevCount[it.severity] ?? 0) + 1;
  const sevLabel: Record<string, string> = { BLOCKER: zh.dock.sevBlocker, ERROR: zh.dock.sevError, WARNING: zh.dock.sevWarning, INFO: zh.dock.sevInfo };
  return (
    <div className={styles.gapPanorama} data-testid="gap-panorama" data-status="DONE" data-total={total}>
      <CoverageRing score={score} />
      <span className={styles.panoramaSummary}>{zh.dock.panoramaSummary(total, auto)}</span>
      <span className={styles.panoramaBadges}>
        {(["BLOCKER", "ERROR", "WARNING", "INFO"] as const).filter((s) => sevCount[s]).map((s) => (
          <span key={s} className={styles.panoramaBadge} data-sev={s} data-testid={`gap-panorama-sev-${s}`}>{sevLabel[s]} {sevCount[s]}</span>
        ))}
      </span>
      <Link to={`/admin/tickets?taskId=${encodeURIComponent(taskId)}`} className="btn sm" data-testid="gap-panorama-tickets">{zh.dock.panoramaTickets}</Link>
    </div>
  );
}

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
  // GAP-ACTIONABLE（PRD §3.4）：LLM 用途未绑定/密钥无效——真人到 设置→LLM 用途绑定 补，系统不能凭空造密钥（不可即时触发）。
  LLM_PURPOSE_UNBOUND: { label: "LLM 用途未绑定（去设置→LLM 用途绑定）", triggerable: false },
  // WO-DB-LLM-REQUIRED-NO-FLOOR：建域 comprehend 硬依赖 LLM（不静默落地板造错语义域）——需真人补业务描述/换 provider。
  COMPREHEND_NOT_UNDERSTOOD: { label: "LLM 未理解故事（补具体描述/数据后重建）", triggerable: false },
  LLM_UNAVAILABLE: { label: "LLM 暂不可用（稍后重试/换 provider）", triggerable: false },
  // OTHER（含路径 B agent 中断）：触发自成长 LOOP 做真实 classifyGap 诊断+补，再续推。
  OTHER: { label: "未定位缺口（触发诊断）", triggerable: true },
};

/** ONTO-SCEN-LAUNCH-DET §2.5：缺口来自场景卡启动时的发育态（契约 gap 块 additive scenario 字段）。 */
export interface GapScenarioInfo {
  scenarioKey: string;
  name?: string;
  maturity: string;
  ticketId: string | null;
}

export function GapCard({ report, scenario, onRetry }: { report: GapReport; scenario?: GapScenarioInfo; onRetry?: () => void }) {
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
      {/* UPG-L0-PREANALYSIS §7.2：顶部只读预分析全景条（暗发关/无 taskId → 不渲染·主体逐像素不变）。 */}
      <GapPanorama taskId={report.taskId} />
      {/* ONTO-SCEN-LAUNCH-DET §2.5：场景卡诚实发育卡——「此卡发育中：缺 X · 已建工单 #N」+ 深链（替代死答） */}
      {scenario && (
        <div className={styles.gapHead} data-testid="gap-scenario">
          <span className="badge amber">{zh.dock.scenarioDeveloping}</span>
          <span className="zh">{zh.dock.scenarioDevelopingDetail(scenario.name ?? scenario.scenarioKey, disp.label)}</span>
          {scenario.ticketId && (
            <Link
              to={`/admin/tickets?ticket=${encodeURIComponent(scenario.ticketId)}`}
              className="btn sm"
              data-testid="gap-scenario-ticket"
            >
              {zh.dock.scenarioTicket(scenario.ticketId)}
            </Link>
          )}
        </div>
      )}
      <div className={styles.gapHead}>
        <span className="badge amber" data-testid="gap-code">{zh.dock.gapTitle} · {code}</span>
        <span className={styles.gapVerdict}>{disp.label}</span>
      </div>
      {primary && (
        <div className={styles.gapBody}>
          {/* GAP-ACTIONABLE（PRD §3.4）：优先渲染「缺什么·补在哪·验收」三元（永不「人工核实内部错误/dash」）；缺三元时回落 suggestedFill/evidence。 */}
          {primary.what || primary.where || primary.acceptance ? (
            <ul className="zh" data-testid="gap-actionable" style={{ margin: 0, paddingLeft: 18 }}>
              {primary.what && <li data-testid="gap-what">缺什么：{primary.what}</li>}
              {primary.where && <li data-testid="gap-where">补在哪：{primary.where}</li>}
              {primary.acceptance && <li data-testid="gap-acceptance">{primary.acceptance}</li>}
            </ul>
          ) : (
            <div className="zh">{primary.suggestedFill || primary.evidence}</div>
          )}
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
          <Link to="/admin/tickets" className="btn sm" style={{ marginLeft: 8 }} data-testid="gap-ticket-link">
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
              <Link to="/admin/tickets" className="btn sm" style={{ marginLeft: 8 }} data-testid="gap-ticket-link">
                {zh.dock.gapTicket}
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
