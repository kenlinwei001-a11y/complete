import type { DispositionOption, DispositionSideEffect, RiskTimelineOutput } from "@platform/contracts";
import { RuleRef } from "@/components/RuleRef";
import { AbsentNote, LeadTimeReading, SubSection } from "./decisionInfoShared";
import styles from "../RiskBoardView.module.css";

type PlanRow = NonNullable<RiskTimelineOutput["planRows"]>[number];

/**
 * WO-DECISION-INFO-FE ③ · 方案代价（`planRows[].options`）：**能怎么办、各要付什么代价**。
 *
 * 后端 `deriveDispositionOptions`（契约纯函数·同一套杠杆算子的三次求值）+ `attachOptionEvidence`
 * （datacore 按真对象装配成本/副作用）已经把 A/B/C 三个可比方案连同代价算好了，前端此前零消费。
 *   A 本地优先（现行口径·= steps 同解）· B 零挤占（不动在手单）· C 最快收口（按真前置期排）
 *
 * 诚实纪律：
 *   · `cost.status` 三态照实渲（OK / PARTIAL 只报**已算出的那部分** / EMPTY 完全不显金额），
 *     并把 `missing[]`（缺哪个字段）逐条列出 —— 绝不把算不出的杠杆按 0 元并进总额。
 *   · `readyInDays === null` → 显示「未知」+ 后端给的 reason，**不拿 0 天冒充"马上到位"**。
 *   · `leadTime.status==="EMPTY"` → 「取不到 + 缺哪个字段 + 日期未叠加偏移」（R13·见 LeadTimeReading）。
 *   · `coefficients[].basis==="DEFAULT_FALLBACK"` → 明标**代码兜底默认·非被治理过的口径**
 *     （`base_outlook_coeffs` 规则全仓只有读方没有写方 —— "接了线没数据"，不披露就等于让人把兜底当治理值）。
 *   · `options` 只挂每基地**主行**：备份行/C21 反提行没有该字段 → 走缺席分支，说清"为什么这行没有"。
 */
export function DispositionOptionsPanel({ row }: { row: PlanRow }) {
  const opts = row.options;

  if (!opts) {
    return (
      <div data-testid="disposition-options-panel" className={styles.rkOptPanel}>
        <SubSection testId="disposition-options-section" title="③ 方案与代价 · 能怎么办、各要付什么">
          <AbsentNote
            testId="disposition-options-absent"
            field="planRows[].options"
            what="多方案对比"
            hint="（多方案只挂每基地的**主行**：备份方案行与「反提月度差异」行不重复挂同一份大对象 —— 点主行即可看到。）"
          />
          {/* 前置期读数在 steps 上仍然存在（第二消费面）：即使本行没有 options，也要把"这一步为什么落在第 N 天"交出去。 */}
          <StepLeadTimes row={row} />
        </SubSection>
      </div>
    );
  }

  if (opts.status === "EMPTY") {
    return (
      <div data-testid="disposition-options-panel" className={styles.rkOptPanel}>
        <SubSection testId="disposition-options-section" title="③ 方案与代价 · 能怎么办、各要付什么">
          <div className="empty-state" data-testid="disposition-options-empty" style={{ fontSize: 11, lineHeight: 1.7, color: "var(--muted)" }}>
            <b style={{ color: "var(--muted2)" }}>无需处置，故不出方案（这是结论，不是缺数据）</b>
            <div style={{ marginTop: 4 }} data-testid="disposition-options-empty-reason">{opts.emptyReason ?? opts.summary}</div>
          </div>
          <StepLeadTimes row={row} />
          <Coefficients opts={opts} />
        </SubSection>
      </div>
    );
  }

  return (
    <div data-testid="disposition-options-panel" className={styles.rkOptPanel}>
      <SubSection
        testId="disposition-options-section"
        title="③ 方案与代价 · 能怎么办、各要付什么"
        sub={<>触发缺口 {opts.shortfall} {opts.unit} · 触发日 D+{opts.trigDay} · {opts.options.length} 个可比方案</>}
      >
        <div style={{ fontSize: 10.5, color: "var(--muted)", marginBottom: 6 }} data-testid="disposition-options-summary">{opts.summary}</div>

        <table className="cmp" data-testid="disposition-options-table" style={{ fontSize: 11, marginBottom: 8 }}>
          <thead>
            <tr>
              <th>方案</th><th>策略（在赌什么·放弃了什么）</th><th>收窄({opts.unit})</th><th>残留({opts.unit})</th><th>几天到位</th><th>成本</th><th>副作用</th>
            </tr>
          </thead>
          <tbody>
            {opts.options.map((o) => (
              <tr key={o.optionId} data-testid={`disposition-option-row-${o.optionId}`}>
                <td className="zh"><b>{o.optionId} · {o.label}</b></td>
                <td className="zh" style={{ fontSize: 10, maxWidth: 320 }}>{o.strategy}</td>
                <td className="mono" style={{ color: "var(--ok)" }}>{o.closedTotal}</td>
                <td className="mono" style={{ color: o.residual > 0 ? "var(--danger)" : undefined }}>{o.residual}</td>
                <td className="mono" data-testid={`disposition-option-ready-${o.optionId}`}>
                  {o.readyInDays != null ? (
                    <b>{o.readyInDays} 天</b>
                  ) : (
                    // null ≠ 0：拿 0 天冒充"马上到位"正是本仓反复堵的坑。
                    // WO-R5 收编时去掉了这里承载 `readyInDaysReason` 的原生 `title=`
                    // （规范 §2 R-UI-3 禁止 title 充当浮层，hover-layer 那道棘轮门当场拦下）：
                    // 该理由**本来就已经**以可见文字渲染在展开后的方案详情里
                    // （见下方 `disposition-option-readyreason-*`），故这里是纯冗余，删掉不丢信息。
                    <span style={{ color: "var(--muted2)" }}>未知（前置期取不到）</span>
                  )}
                </td>
                <td data-testid={`disposition-option-cost-${o.optionId}`}>
                  <CostCell option={o} />
                </td>
                <td className="mono" data-testid={`disposition-option-sfx-${o.optionId}`}>{o.sideEffects.length}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {opts.options.map((o) => (
          <OptionDetail key={o.optionId} option={o} unit={opts.unit} />
        ))}

        <StepLeadTimes row={row} />
        <Coefficients opts={opts} />
      </SubSection>
    </div>
  );
}


/** 成本单元格：OK 显总额 · PARTIAL 只报**已算出的那部分**并列缺项 · EMPTY 完全不显金额（绝不按 0 并入）。 */
function CostCell({ option }: { option: DispositionOption }) {
  const c = option.cost;
  if (c.status === "OK" && c.totalYuan != null) {
    return <span className="mono" data-cost="OK"><b>{c.totalYuan}</b> {c.unit}</span>;
  }
  if (c.status === "PARTIAL" && c.totalYuan != null) {
    return (
      <span data-cost="PARTIAL" style={{ fontSize: 10 }}>
        <b className="mono">{c.totalYuan}</b> {c.unit}
        <span style={{ color: "var(--muted2)" }}>（部分：{c.missing.length} 项杠杆成本算不出，未计入）</span>
      </span>
    );
  }
  return (
    <span data-cost="EMPTY" style={{ fontSize: 10, color: "var(--muted2)" }}>
      算不出（{c.missing.length} 项杠杆无成本承载）—— 不填 0
    </span>
  );
}

/** 逐方案详情：杠杆 → 收窄/日期/前置期(R13) → 成本 → 副作用（点名到单 / C08 红线）。 */
function OptionDetail({ option, unit }: { option: DispositionOption; unit: string }) {
  return (
    <div className={styles.rkSol} data-testid={`disposition-option-detail-${option.optionId}`}>
      <div className={styles.rkSolH}>
        <b>{option.optionId} · {option.label}</b>
        <span style={{ fontSize: 10, color: "var(--muted2)" }}>收窄 {option.closedTotal} / 残留 {option.residual} {unit}</span>
      </div>
      <div className={styles.rkSolM} style={{ display: "grid", gap: 4 }}>
        {option.readyInDays == null && option.readyInDaysReason && (
          <div data-testid={`disposition-option-readyreason-${option.optionId}`} style={{ color: "var(--muted2)" }}>
            「几天到位」未知：{option.readyInDaysReason}
          </div>
        )}
        {option.levers.length === 0 ? (
          <div data-testid={`disposition-option-nolever-${option.optionId}`} style={{ color: "var(--muted2)" }}>
            本方案未取用任何杠杆（后端未产出 levers）——不臆造动作。
          </div>
        ) : (
          option.levers.map((lv, i) => (
            <div key={`${lv.leverKey}-${i}`} data-testid={`disposition-lever-${option.optionId}-${lv.leverKey}`} style={{ borderTop: i === 0 ? undefined : "1px dashed var(--line, rgba(140,170,200,.22))", paddingTop: i === 0 ? 0 : 4 }}>
              <div>
                <span className="badge" style={{ marginRight: 5 }}>{i + 1}</span>
                <b>{lv.action}</b>
                <span style={{ marginLeft: 6, color: "var(--muted2)" }}>D+{lv.day} · {lv.date}</span>
                <span style={{ marginLeft: 8, color: "var(--ok)" }}>收窄 <b className="mono">{lv.closesGap}</b> {unit}</span>
              </div>
              <div style={{ marginTop: 2 }}>
                {/* R13 前置期溯源：这一步为什么落在第 N 天（OK 溯到真记录 · EMPTY 明说未叠加偏移）。 */}
                <LeadTimeReading testId={`disposition-lead-${option.optionId}-${lv.leverKey}`} lead={lv.leadTime} label="前置期：" />
              </div>
              <div style={{ marginTop: 2 }} data-testid={`disposition-lever-cost-${option.optionId}-${lv.leverKey}`}>
                成本：{lv.cost == null ? (
                  <span style={{ color: "var(--muted2)" }}>后端未装配该杠杆成本（字段缺席）</span>
                ) : lv.cost.status === "OK" && lv.cost.amountYuan != null ? (
                  <span className="mono"><b>{lv.cost.amountYuan}</b> {lv.cost.unit}{lv.cost.source ? <span style={{ color: "var(--muted2)" }}>（{lv.cost.source.formula}）</span> : null}</span>
                ) : (
                  <span style={{ color: "var(--muted2)" }}>算不出（缺 <span className="mono">{lv.cost.missingField ?? "?"}</span>）· {lv.cost.reason ?? ""}</span>
                )}
              </div>
            </div>
          ))
        )}
        <div style={{ marginTop: 2 }}>
          <b>副作用（要付的代价）</b>
          {option.sideEffects.length === 0 ? (
            <div style={{ color: "var(--muted2)" }} data-testid={`disposition-sfx-none-${option.optionId}`}>后端未回传副作用条目 —— 不代表"没有副作用"，只代表本次没算。</div>
          ) : (
            option.sideEffects.map((se, i) => (
              <SideEffect key={`${se.kind}-${se.leverKey}-${i}`} se={se} testId={`disposition-sfx-${option.optionId}-${i}`} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function SideEffect({ se, testId }: { se: DispositionSideEffect; testId: string }) {
  return (
    <div data-testid={testId} data-sfx-kind={se.kind} style={{ marginTop: 3 }}>
      <span className="badge" style={{ marginRight: 5 }}>{KIND_LABEL[se.kind]}</span>
      <b>{se.title}</b>
      <div style={{ color: "var(--muted2)", marginTop: 1 }}>{se.detail}</div>
      {se.rule && (
        <div style={{ marginTop: 2 }} data-testid={`${testId}-rule`}>
          规则 <RuleRef code={se.rule.ruleKey} />：阈值 <span className="mono">{se.rule.threshold}</span> · 实际 <span className="mono">{se.rule.actual}</span> ·{" "}
          <b style={{ color: se.rule.breached ? "var(--danger)" : "var(--ok)" }}>{se.rule.breached ? "已越线" : "未越线"}</b>
          <span style={{ color: "var(--muted2)" }}>（阈值取 {se.rule.ruleKey}.params.{se.rule.paramKey}·规则口径非代码内联）</span>
        </div>
      )}
      {se.displacedOrders && se.displacedOrders.length > 0 && (
        <table className="cmp" data-testid={`${testId}-displaced`} style={{ fontSize: 10.5, marginTop: 3 }}>
          <thead>
            <tr><th>被挤占订单</th><th>客户</th><th>所属基地</th><th>优先级</th><th>被挤占量</th><th>延后(天)</th></tr>
          </thead>
          <tbody>
            {se.displacedOrders.map((d) => (
              <tr key={d.so} data-testid={`${testId}-displaced-${d.so}`}>
                <td className="mono"><b>{d.so}</b></td>
                <td className="zh">{d.cust}</td>
                <td className="zh">{d.baseName}</td>
                <td className="zh">{d.pri}</td>
                <td className="mono">{d.displacedQty} / {d.qty}</td>
                <td className="mono" style={{ color: "var(--danger)" }}>
                  {d.delayDays != null ? d.delayDays : <span style={{ color: "var(--muted2)" }} title={d.delayReason ?? ""}>算不出</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {se.kind === "UNKNOWN" && se.missingField && (
        <div style={{ color: "var(--muted2)", marginTop: 1 }} data-testid={`${testId}-missing`}>
          补齐需要：<span className="mono">{se.missingField}</span>
        </div>
      )}
    </div>
  );
}

const KIND_LABEL: Record<DispositionSideEffect["kind"], string> = {
  DISPLACE_ORDERS: "挤占在手单",
  RULE_BREACH: "规则红线",
  NONE: "无副作用",
  UNKNOWN: "算不出",
};

/**
 * 处置步骤的前置期读数（`planRows[].steps[].leadTime`）—— 「这一步为什么落在第 N 天」。
 * 修前 `day` 由 `trigDay+7` / `trigDay+14` 两个魔数决定，读者无从判断 7/14 哪来的；
 * 现在 OK 可一路溯到 `InterBaseTransfer.transitDays` / `Supplier.leadTime` 的具体那条记录。
 */
function StepLeadTimes({ row }: { row: PlanRow }) {
  const steps = row.steps ?? [];
  const withLead = steps.filter((s) => s.leadTime != null);
  if (steps.length === 0) return null;
  return (
    <div style={{ marginTop: 8, fontSize: 10.5 }} data-testid="disposition-step-leadtimes">
      <b>本行处置步骤的前置期读数（R13）</b>
      {withLead.length === 0 ? (
        <div style={{ color: "var(--muted2)", marginTop: 2 }} data-testid="disposition-step-leadtimes-absent">
          本次响应的 steps 未带 <span className="mono">leadTime</span> 字段（契约中为 optional）—— 故不解释各步日期由来，不臆造前置期。
        </div>
      ) : (
        <ul style={{ margin: "2px 0 0", paddingLeft: 16 }}>
          {steps.map((s, i) =>
            s.leadTime ? (
              <li key={i} style={{ marginTop: 2 }}>
                <span style={{ color: "var(--muted2)" }}>D+{s.day}</span> · {s.action} ·{" "}
                <LeadTimeReading testId={`disposition-step-lead-${i}`} lead={s.leadTime} label="" />
              </li>
            ) : null,
          )}
        </ul>
      )}
    </div>
  );
}

/** 系数出处披露（R13）：兜底默认 vs 规则口径 —— 不披露就等于让人把代码兜底当成被治理过的数。 */
function Coefficients({ opts }: { opts: NonNullable<PlanRow["options"]> }) {
  if (opts.coefficients.length === 0) return null;
  return (
    <div style={{ marginTop: 8, fontSize: 10.5 }} data-testid="disposition-coefficients">
      <b>推演系数出处</b>
      <ul style={{ margin: "2px 0 0", paddingLeft: 16 }}>
        {opts.coefficients.map((c) => (
          <li key={c.key} data-testid={`disposition-coeff-${c.key}`} data-basis={c.basis} style={{ marginTop: 2 }}>
            <span className="mono">{c.key} = {c.value}</span>{" "}
            <span className="badge" style={{ marginLeft: 4 }}>{c.basis === "RULE_PARAMS" ? "规则口径" : "代码兜底默认"}</span>
            <span style={{ color: "var(--muted2)", marginLeft: 4 }}>{c.note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
