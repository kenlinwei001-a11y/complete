import type { RiskTimelineOutput } from "@platform/contracts";
import { Provenance } from "@/components/Provenance";

/**
 * WO-DECISION-INFO 前端半 · 「决策三块」的消费方（治假绿第 9 形态同族：**数据发得出、用户看不见**）。
 *
 * ## 病
 * 引擎半已并线（SEAM 9 例绿）：`risk_timeline` 输出里 `cards[].exposure`（影响面）、
 * `cards[].doNothing`（不作为后果）、`planRows[].options`（A/B/C 多方案 + 逐杠杆代价）、
 * 顶层 `exposureOrder`（影响面序）、`steps[].leadTime`（前置期出处·R13）**全部零前端消费方** ——
 * 实测（本单 dev 在基线 704da3d7 上 `grep -rn "\.exposure\|exposureOrder\|doNothing" apps/frontend-shell/src`）：
 * 命中的只有 `DecisionPlayView.tsx:187` 的 `o.exposure`（那是 decision-engine 的 `DecisionOption.exposure`，
 * 同名不同物），以及各处 `view.options`（ViewConfig 的渲染器配置，同名不同物）。真消费方 **0 个**。
 * 于是本体 §8 `G-RISK-NO-DECISION-INFO` 此前只能诚实标 ◐（引擎半闭、前端半未接）；
 * 本文件 + `test/decision-info-reachable.test.tsx` 是它推向 ✅ 所缺的那一段。
 *
 * ## 本文件的纪律（逐条对应契约里那些"诚实缺席"的设计）
 * 1. **EMPTY 不许渲染成 0 或空白** —— 那是把「不知道」说成「不用等 / 不用赔」，是本仓一直在治的病。
 *    · `doNothing.penalty` 恒 EMPTY（C01–C33 无交付罚则承载）→ 必须显式说"算不出"+缺哪个字段+查过哪些承载物；
 *    · `leadTime.status==="EMPTY"` → 显示「前置期取不到（缺 X）」，**不显示 0 天**；
 *    · `option.readyInDays===null` → 显示 `readyInDaysReason`，**不显示 0 天到位**；
 *    · `cost.status!=="OK"` → 逐条列出算不出的杠杆与缺失字段，**不显示 ¥0**。
 * 2. **`delay.basis==="ESTIMATED"` 要当面标出**（确定性估算 ≠ 真派生），并把 `basisNote` 的公式亮出来。
 * 3. **单位只格式化不内联**（R14）：`套 / 亿元 / 元 / 天` 一律取自 `units` / `unit` 字段。
 * 4. **不重算任何数**：本文件是纯展示层，`rank` / `readyInDays` / `closedTotal` 全部直读引擎值。
 *
 * ## 生产调用方（可达性）
 * 本文件是 `views/` 下的**子面板**（同 `DispositionDetailPanel.tsx` / `BaseOutlookPanel.tsx` 的形态），
 * 不是独立 renderer —— 它需要一张 `RiskCard` / `PlanRow` 才有意义，注册成顶层视图等于造一条没人走的路。
 * 生产调用方：`views/RiskBoardView.tsx`（卡面 + 详情面板）与 `views/DispositionDetailPanel.tsx`（处置行钻取），
 * 而那两处经 `views/registry.ts` 的字符串键 `risk-board` 被 `pages/ViewPage.tsx` 渲染得到。
 * 可达门测试 `test/decision-info-reachable.test.tsx` 咬的正是这条链（从字符串键出发真渲染，不直接 import 组件）。
 */

type RiskCard = RiskTimelineOutput["cards"][number];
export type Exposure = NonNullable<RiskCard["exposure"]>;
export type DoNothing = NonNullable<RiskCard["doNothing"]>;
type PlanRow = NonNullable<RiskTimelineOutput["planRows"]>[number];
export type DispositionOptionsVM = NonNullable<PlanRow["options"]>;
type DispositionOptionVM = DispositionOptionsVM["options"][number];
type LeverVM = DispositionOptionVM["levers"][number];
type LeadTimeVM = LeverVM["leadTime"];
type SideEffectVM = DispositionOptionVM["sideEffects"][number];
/** 契约里 union 的 EMPTY 分支（`MissingEvidenceSchema`）—— 缺什么字段 / 查过哪些承载物。 */
type MissingEvidenceVM = Extract<DoNothing["penalty"], { status: "EMPTY" }>;

const muted = "var(--muted2)";
const line = "1px solid var(--line, rgba(140,170,200,.24))";

/** 数字格式化（**只格式化不换算**：亿元/套/天/元 的量纲由引擎给定·R14）。 */
const n = (v: number | null | undefined, digits = 0): string =>
  v == null || !Number.isFinite(v) ? "—" : v.toFixed(digits);

/**
 * 「算不出」的统一渲染（`MissingEvidence`）。**这一块存在本身就是产品语义**：
 * 它回答的是"为什么这里是空的、补哪个字段能点亮、已经查过哪些承载物"，
 * 而不是留一个 0 让人以为"不用赔 / 不用等"。
 */
export function MissingEvidenceBlock({ ev, testId, label }: { ev: MissingEvidenceVM; testId: string; label: string }) {
  return (
    <div data-testid={testId} data-status="EMPTY" style={{ fontSize: 10.5, color: muted, lineHeight: 1.6 }}>
      <b style={{ color: "var(--muted)" }}>{label}：算不出</b>
      <div data-testid={`${testId}-reason`}>{ev.reason}</div>
      {ev.missingFields.length > 0 && (
        <div data-testid={`${testId}-missing`}>
          补齐即可点亮：{ev.missingFields.map((f) => <span key={f} className="badge" style={{ marginRight: 4 }}>{f}</span>)}
        </div>
      )}
      {ev.checked.length > 0 && (
        <div data-testid={`${testId}-checked`}>已逐条核过：{ev.checked.join("、")}（= 查过确实没有，不是没查）</div>
      )}
    </div>
  );
}

/**
 * 前置期读数（R13）。OK → 天数 + 出处三元组；EMPTY → **「前置期取不到」+ 缺哪个字段**。
 * ⚠ EMPTY 绝不渲染成 `0 天`：0 天是一个断言（"当天就能到"），而本体里并没有对象支持这个断言。
 */
export function LeadTimeTag({ lead, testId }: { lead: LeadTimeVM; testId: string }) {
  if (lead.status === "OK" && lead.source && lead.days != null) {
    return (
      <Provenance
        testId={`${testId}-prov`}
        src="真对象前置期"
        formula={`${lead.source.objectType}.${lead.source.field} = ${lead.source.value}`}
        inputs={[`${lead.source.objectType}#${lead.source.objectId}`]}>
        <span data-testid={testId} data-lead-status="OK" data-lead-days={String(lead.days)} className="mono" style={{ fontSize: 10 }}>
          前置期 {lead.days} 天
        </span>
      </Provenance>
    );
  }
  return (
    <span data-testid={testId} data-lead-status="EMPTY" style={{ fontSize: 10, color: muted }}>
      前置期取不到（缺 {lead.missingField ?? "?"}）· 日期未叠加任何假设前置期
    </span>
  );
}

/**
 * ① 影响面（Exposure）：这条风险**落在谁身上**。
 * EMPTY 是一等结论 —— 交代 `emptyReason` 与 `nextOutsideWindow`（窗外最近一张在多远），
 * 而不是留白让人以为"这个基地没事"。
 */
export function ExposurePanel({ exposure, testId = "decision-exposure" }: { exposure: Exposure; testId?: string }) {
  const u = exposure.units;
  const hasExp = exposure.status === "OK";
  return (
    <div data-testid={testId} data-status={exposure.status} data-rank={String(exposure.rank)} style={{ borderTop: line, paddingTop: 8, marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <b style={{ fontSize: 12 }}>① 影响面 · 这事落在谁身上</b>
        <span style={{ fontSize: 10, color: muted }}>
          窗 D+{exposure.window.fromDay}–D+{exposure.window.toDay}（起算 {exposure.window.forecastStart}）· 影响面序第 {exposure.rank} 位
          {exposure.hasExposure ? "" : "（零敞口·已沉底）"}
        </span>
      </div>

      {hasExp ? (
        <>
          <div data-testid={`${testId}-summary`} style={{ display: "flex", gap: 14, flexWrap: "wrap", margin: "6px 0 8px", fontSize: 11 }}>
            <span><b className="mono" data-testid={`${testId}-ordercount`}>{exposure.orderCount}</b> 张订单</span>
            <span><b className="mono" data-testid={`${testId}-qty`}>{n(exposure.totalQty)}</b> {u.qty}</span>
            <span style={{ color: "var(--c-forecast)" }}><b className="mono" data-testid={`${testId}-revenue`}>{n(exposure.revenueYi, 2)}</b> {u.revenue}</span>
            <span><b className="mono" data-testid={`${testId}-custcount`}>{exposure.customerCount}</b> 家客户</span>
            {exposure.earliest && (
              <span data-testid={`${testId}-earliest`} style={{ color: "var(--danger)" }}>
                最早受影响：{exposure.earliest.so}·{exposure.earliest.cust} {exposure.earliest.due}（D+{exposure.earliest.dueDay}）
              </span>
            )}
          </div>
          {exposure.customers.length > 0 && (
            <table className="cmp" data-testid={`${testId}-customers`}>
              <thead>
                <tr><th>客户</th><th>细分</th><th>单数</th><th>数量({u.qty})</th><th>金额({u.revenue})</th><th>最早交期</th></tr>
              </thead>
              <tbody>
                {exposure.customers.map((c) => (
                  <tr key={c.cust} data-testid={`${testId}-cust-${c.cust}`}>
                    <td className="zh"><b>{c.cust}</b></td>
                    <td className="zh">{c.seg}</td>
                    <td className="mono">{c.orderCount}</td>
                    <td className="mono">{n(c.qty)}</td>
                    <td className="mono">{n(c.revenueYi, 2)}</td>
                    <td className="mono">{c.earliestDue}（D+{c.earliestDueDay}）</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {exposure.orders.length > 0 && (
            <table className="cmp" data-testid={`${testId}-orders`} style={{ marginTop: 6 }}>
              <thead>
                <tr><th>订单</th><th>客户</th><th>型号</th><th>数量({u.qty})</th><th>金额({u.revenue})</th><th>交期</th><th>优先级</th></tr>
              </thead>
              <tbody>
                {exposure.orders.map((o) => (
                  <tr key={o.so} data-testid={`${testId}-order-${o.so}`}>
                    <td className="mono"><b>{o.so}</b></td>
                    <td className="zh">{o.cust}</td>
                    <td className="zh">{o.model}</td>
                    <td className="mono">{n(o.qty)}</td>
                    <td className="mono">{n(o.revenueYi, 2)}</td>
                    <td className="mono">{o.due}（D+{o.dueDay}）</td>
                    <td><span className="badge">{o.pri}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : (
        // 零敞口：**说清为什么**，并交出窗外最近一张 —— 风险不是不存在，只是不在这个窗里。
        <div data-testid={`${testId}-empty`} style={{ fontSize: 10.5, color: muted, lineHeight: 1.6, marginTop: 5 }}>
          <b style={{ color: "var(--muted)" }}>本窗零订单敞口</b>
          <div data-testid={`${testId}-emptyreason`}>{exposure.emptyReason ?? "引擎未给出零敞口原因"}</div>
          {exposure.nextOutsideWindow ? (
            <div data-testid={`${testId}-nextoutside`}>
              窗外最近一张：{exposure.nextOutsideWindow.so}·{exposure.nextOutsideWindow.cust}{" "}
              {n(exposure.nextOutsideWindow.qty)}
              {u.qty} · 交期 {exposure.nextOutsideWindow.due}（D+{exposure.nextOutsideWindow.dueDay}·超出本窗{" "}
              {exposure.nextOutsideWindow.daysBeyondWindow} 天）—— 换更长的推演窗即可看见。
            </div>
          ) : (
            <div data-testid={`${testId}-nextoutside-none`}>窗外也没有更近的一张（引擎未回传 nextOutsideWindow）。</div>
          )}
        </div>
      )}
      {exposure.provenance.length > 0 && (
        <div data-testid={`${testId}-prov`} style={{ fontSize: 9.5, color: muted, marginTop: 5 }}>
          出处（R13·可回仓储逐位对拍）：
          {exposure.provenance.slice(0, 4).map((p, i) => (
            <span key={i} className="mono" style={{ marginLeft: 5 }}>{p.objectType}#{p.objectId}.{p.field}={String(p.value)}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * ③ 不作为后果（DoNothing）：不处置会怎样。
 * 三个子块（缺口消化 / 逐单延误 / 违约金）**各自独立标状态** —— 一块算得出不代表另一块算得出，
 * 混成一个"总状态"就会让 EMPTY 被顺手抹平。
 */
export function DoNothingPanel({ doNothing, testId = "decision-donothing" }: { doNothing: DoNothing; testId?: string }) {
  const u = doNothing.units;
  const { catchUp, delay, penalty } = doNothing;
  return (
    <div data-testid={testId} data-status={doNothing.status} style={{ borderTop: line, paddingTop: 8, marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <b style={{ fontSize: 12 }}>③ 不作为后果 · 不管会怎样</b>
        <span style={{ fontSize: 10, color: muted }} data-testid={`${testId}-summary`}>{doNothing.summary}</span>
      </div>
      <div style={{ fontSize: 11, margin: "5px 0 7px" }} data-testid={`${testId}-revenue`}>
        逾期营收敞口 <b className="mono" style={{ color: "var(--danger)" }}>{n(doNothing.revenueAtRiskYi, 2)}</b> {u.revenue}
      </div>

      {/* ③-1 缺口自然消化天数（真派生·可溯 Line.capacityDaily / Order.qty）。 */}
      <div style={{ margin: "6px 0" }}>
        {catchUp.status === "OK" ? (
          <Provenance testId={`${testId}-catchup-prov`} src="真派生" formula={catchUp.formula}
            inputs={catchUp.provenance.map((p) => `${p.objectType}#${p.objectId}.${p.field}=${String(p.value)}`)}>
            <span data-testid={`${testId}-catchup`} data-status="OK" style={{ fontSize: 11 }}>
              缺口自然消化需 <b className="mono">{n(catchUp.days, 1)}</b> {catchUp.unit}
              <span style={{ color: muted, fontSize: 10 }}>（缺口 {n(catchUp.shortfall)} · 空闲日产能 {n(catchUp.freeDaily)}）</span>
            </span>
          </Provenance>
        ) : (
          <MissingEvidenceBlock ev={catchUp} testId={`${testId}-catchup`} label="缺口自然消化天数" />
        )}
      </div>

      {/* ③-2 逐单延误。basis 必须诚实区分 DERIVED（真派生）与 ESTIMATED（确定性估算）。 */}
      <div style={{ margin: "6px 0" }}>
        {delay.status === "OK" ? (
          <div data-testid={`${testId}-delay`} data-status="OK">
            <div style={{ fontSize: 11 }}>
              最坏延误 <b className="mono" style={{ color: "var(--danger)" }}>{delay.worstDays}</b> 天
              <span style={{ color: muted, fontSize: 10, marginLeft: 6 }} data-testid={`${testId}-delay-note`}>{delay.note}</span>
            </div>
            <table className="cmp" data-testid={`${testId}-delay-orders`} style={{ marginTop: 5 }}>
              <thead>
                <tr><th>订单</th><th>客户</th><th>数量({u.qty})</th><th>交期</th><th>延误(天)</th><th>判据</th></tr>
              </thead>
              <tbody>
                {delay.orders.map((o) => (
                  <tr key={o.so} data-testid={`${testId}-delay-${o.so}`} data-basis={o.basis}>
                    <td className="mono"><b>{o.so}</b></td>
                    <td className="zh">{o.cust}</td>
                    <td className="mono">{n(o.qty)}</td>
                    <td className="mono">{o.due}（D+{o.dueDay}）</td>
                    <td className="mono" style={{ color: "var(--danger)", fontWeight: 700 }}>{o.delayDays}</td>
                    <td>
                      {/* ESTIMATED **必须**当面标出并给出它为什么不是实测 —— 不标 = 把估算当实测卖。 */}
                      <span className="badge" data-testid={`${testId}-basis-${o.so}`}
                        style={o.basis === "ESTIMATED" ? { background: "var(--warn, #E8B54A)", color: "#1b2733" } : undefined}>
                        {o.basis === "ESTIMATED" ? "确定性估算" : "真派生"}
                      </span>
                      <div style={{ fontSize: 9.5, color: muted, marginTop: 2 }} data-testid={`${testId}-basisnote-${o.so}`}>{o.basisNote}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <MissingEvidenceBlock ev={delay} testId={`${testId}-delay`} label="逐单延误" />
        )}
      </div>

      {/* ③-3 违约金：本仓恒 EMPTY（C01–C33 无交付罚则承载）。渲染成 0 就是把「不知道」说成「不用赔」。 */}
      <div style={{ margin: "6px 0" }}>
        {penalty.status === "OK" ? (
          <Provenance testId={`${testId}-penalty-prov`} src="真派生" formula={penalty.formula}
            inputs={penalty.provenance.map((p) => `${p.objectType}#${p.objectId}.${p.field}=${String(p.value)}`)}>
            <span data-testid={`${testId}-penalty`} data-status="OK" style={{ fontSize: 11 }}>
              违约金 <b className="mono">{n(penalty.amountYuan, 2)}</b> 元（规则 {penalty.ruleKey}）
            </span>
          </Provenance>
        ) : (
          <MissingEvidenceBlock ev={penalty} testId={`${testId}-penalty`} label="违约金 / 罚则" />
        )}
      </div>

      {/* ③-4 受影响客户名单（"落在谁身上"的主语）。customerObject 连不上就诚实说连不上。 */}
      {doNothing.atRiskCustomers.length > 0 && (
        <table className="cmp" data-testid={`${testId}-customers`} style={{ marginTop: 6 }}>
          <thead>
            <tr><th>客户</th><th>单数</th><th>数量({u.qty})</th><th>金额({u.revenue})</th><th>最坏延误(天)</th><th>客户对象（账期/信用）</th></tr>
          </thead>
          <tbody>
            {doNothing.atRiskCustomers.map((c) => (
              <tr key={c.cust} data-testid={`${testId}-cust-${c.cust}`}>
                <td className="zh"><b>{c.cust}</b></td>
                <td className="mono">{c.orderCount}</td>
                <td className="mono">{n(c.qty)}</td>
                <td className="mono">{n(c.revenueYi, 2)}</td>
                <td className="mono" style={{ color: "var(--danger)" }}>{c.worstDelayDays}</td>
                <td style={{ fontSize: 10 }} data-testid={`${testId}-custobj-${c.cust}`}
                  data-status={c.customerObject.status}>
                  {c.customerObject.status === "OK"
                    ? `${c.customerObject.custId} · 账期 ${c.customerObject.termDays} 天 · 信用额度 ${n(c.customerObject.creditLimit)}`
                    : `连不上（缺 ${c.customerObject.missingFields.join("、") || "?"}）`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** 副作用一条（点名到单 / 点名到规则 / 诚实 UNKNOWN）。 */
function SideEffectRow({ e, testId }: { e: SideEffectVM; testId: string }) {
  return (
    <div data-testid={testId} data-kind={e.kind} style={{ fontSize: 10.5, marginTop: 4, lineHeight: 1.55 }}>
      <b style={{ color: e.kind === "NONE" ? "var(--ok)" : e.kind === "UNKNOWN" ? muted : "var(--danger)" }}>{e.title}</b>
      <div style={{ color: muted }}>{e.detail}</div>
      {e.kind === "UNKNOWN" && e.missingField && (
        <div style={{ color: muted }} data-testid={`${testId}-missing`}>算不出：缺 {e.missingField}（不拿 0 冒充"没有副作用"）</div>
      )}
      {e.rule && (
        <div data-testid={`${testId}-rule`} data-breached={e.rule.breached ? "1" : "0"} style={{ color: e.rule.breached ? "var(--danger)" : muted }}>
          规则 {e.rule.ruleKey}（参数 {e.rule.paramKey}）：阈值 {n(e.rule.threshold, 2)} · 实际 {n(e.rule.actual, 2)} ·{" "}
          {e.rule.breached ? "已越线" : "未越线"}
        </div>
      )}
      {e.displacedOrders && e.displacedOrders.length > 0 && (
        <table className="cmp" data-testid={`${testId}-displaced`} style={{ marginTop: 3 }}>
          <thead>
            <tr><th>被挤占的单</th><th>客户</th><th>基地</th><th>被挤占量</th><th>优先级</th><th>交期</th><th>延后(天)</th></tr>
          </thead>
          <tbody>
            {e.displacedOrders.map((d) => (
              <tr key={`${d.so}-${d.baseId}`} data-testid={`${testId}-displaced-${d.so}`}>
                <td className="mono"><b>{d.so}</b></td>
                <td className="zh">{d.cust}</td>
                <td className="zh">{d.baseName}</td>
                <td className="mono">{n(d.displacedQty)} / {n(d.qty)}</td>
                <td><span className="badge">{d.pri}</span></td>
                <td className="mono">{d.due}（D+{d.dueDay}）</td>
                {/* 延后天数算不出 → 给 delayReason，**不给 0**。 */}
                <td className="mono" data-testid={`${testId}-displaced-${d.so}-delay`} data-status={d.delayDays == null ? "EMPTY" : "OK"}
                  style={{ color: d.delayDays == null ? muted : "var(--danger)" }}>
                  {d.delayDays == null ? `算不出（${d.delayReason ?? "未给原因"}）` : d.delayDays}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** 单个方案（A/B/C）。 */
function OptionCard({ opt, unit, testId }: { opt: DispositionOptionVM; unit: string; testId: string }) {
  return (
    <div data-testid={testId} data-option={opt.optionId}
      style={{ flex: "1 1 320px", minWidth: 300, border: line, borderRadius: 6, padding: "8px 10px", background: "var(--panel2, rgba(120,160,200,.05))" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span className="badge" style={{ background: "var(--c-solver)", color: "#fff" }}>{opt.optionId}</span>
        <b style={{ fontSize: 11.5 }}>{opt.label}</b>
      </div>
      <div style={{ fontSize: 10, color: muted, margin: "4px 0 6px", lineHeight: 1.55 }} data-testid={`${testId}-strategy`}>{opt.strategy}</div>

      <div style={{ fontSize: 11, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <span style={{ color: "var(--ok)" }}>收窄 <b className="mono" data-testid={`${testId}-closed`}>{n(opt.closedTotal)}</b> {unit}</span>
        <span style={{ color: opt.residual > 0 ? "var(--danger)" : muted }}>残留 <b className="mono" data-testid={`${testId}-residual`}>{n(opt.residual)}</b> {unit}</span>
      </div>

      {/* 「几天到位」：任一杠杆前置期 EMPTY → null，**必须显示原因而不是 0 天**。 */}
      <div style={{ fontSize: 10.5, marginTop: 5 }} data-testid={`${testId}-ready`} data-status={opt.readyInDays == null ? "EMPTY" : "OK"}>
        {opt.readyInDays == null ? (
          <span style={{ color: muted }}>几天到位：算不出 —— {opt.readyInDaysReason ?? "引擎未给出原因"}</span>
        ) : (
          <span>几天到位：<b className="mono">{opt.readyInDays}</b> 天</span>
        )}
      </div>

      {/* 成本：OK / PARTIAL / EMPTY 三态分明，算不出的逐条列缺什么，**绝不显示 ¥0**。 */}
      <div style={{ fontSize: 10.5, marginTop: 5 }} data-testid={`${testId}-cost`} data-status={opt.cost.status}>
        {opt.cost.status === "OK" && opt.cost.totalYuan != null ? (
          <span>合计成本 <b className="mono">{n(opt.cost.totalYuan, 2)}</b> {opt.cost.unit}</span>
        ) : (
          <span style={{ color: muted }}>
            合计成本{opt.cost.status === "PARTIAL" && opt.cost.totalYuan != null
              ? <> <b className="mono">{n(opt.cost.totalYuan, 2)}</b> {opt.cost.unit}（**不完整**，下列杠杆未计入）</>
              : "：算不出（无一杠杆可计价）"}
          </span>
        )}
        {opt.cost.missing.length > 0 && (
          <ul style={{ margin: "3px 0 0", paddingLeft: 16, color: muted }} data-testid={`${testId}-cost-missing`}>
            {opt.cost.missing.map((m) => (
              <li key={m.leverKey}>{m.leverKey}：{m.reason}（缺 {m.missingField}）</li>
            ))}
          </ul>
        )}
      </div>

      {/* 逐杠杆：收窄多少 · 何时起效（前置期出处）· 各自成本。 */}
      <ol style={{ margin: "6px 0 0", paddingLeft: 0, listStyle: "none" }}>
        {opt.levers.map((lv, i) => (
          <li key={lv.leverKey} data-testid={`${testId}-lever-${lv.leverKey}`} style={{ padding: "4px 0", borderTop: i === 0 ? undefined : "1px dashed var(--line, rgba(140,170,200,.2))" }}>
            <div style={{ fontSize: 10.5 }}>
              <b>{lv.action}</b>
              <span style={{ color: muted, marginLeft: 6 }}>D+{lv.day} · {lv.date}</span>
              <span style={{ color: "var(--ok)", marginLeft: 6 }}>收窄 {n(lv.closesGap)} {unit}</span>
            </div>
            <div style={{ marginTop: 2 }}>
              <LeadTimeTag lead={lv.leadTime} testId={`${testId}-lever-${lv.leverKey}-lead`} />
            </div>
            {lv.cost && (
              <div style={{ fontSize: 10, color: muted, marginTop: 2 }} data-testid={`${testId}-lever-${lv.leverKey}-cost`} data-status={lv.cost.status}>
                {lv.cost.status === "OK" && lv.cost.amountYuan != null
                  ? `成本 ${n(lv.cost.amountYuan, 2)} ${lv.cost.unit}${lv.cost.source ? `（${lv.cost.source.formula}）` : ""}`
                  : `成本算不出（缺 ${lv.cost.missingField ?? "?"}）${lv.cost.reason ? ` · ${lv.cost.reason}` : ""}`}
              </div>
            )}
          </li>
        ))}
      </ol>

      {/* 副作用（要付的代价）：点名到单 / 点名到规则。 */}
      <div style={{ marginTop: 6 }} data-testid={`${testId}-sideeffects`} data-count={String(opt.sideEffects.length)}>
        {opt.sideEffects.length === 0 ? (
          <span style={{ fontSize: 10, color: muted }}>引擎未回传副作用条目</span>
        ) : (
          opt.sideEffects.map((e, i) => <SideEffectRow key={i} e={e} testId={`${testId}-se-${i}`} />)
        )}
      </div>
    </div>
  );
}

/**
 * ④ 能怎么办、各要付什么代价（`planRows[].options`）。
 * A/B/C 三个**可并排比较**的方案 —— 决策者要的是"有哪几种办法、各要付什么代价"，
 * 而不是系统单方面告诉他"该这么办"。
 */
export function DispositionOptionsPanel({ options, testId = "decision-options" }: { options: DispositionOptionsVM; testId?: string }) {
  if (options.status === "EMPTY") {
    return (
      <div data-testid={testId} data-status="EMPTY" style={{ borderTop: line, paddingTop: 8, marginTop: 10, fontSize: 10.5, color: muted }}>
        <b style={{ fontSize: 12, color: "var(--muted)" }}>④ 方案对比 · 无方案</b>
        <div data-testid={`${testId}-emptyreason`}>{options.emptyReason ?? options.summary}</div>
      </div>
    );
  }
  return (
    <div data-testid={testId} data-status="OK" data-count={String(options.options.length)} style={{ borderTop: line, paddingTop: 8, marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <b style={{ fontSize: 12 }}>④ 能怎么办 · 方案对比与代价</b>
        <span style={{ fontSize: 10, color: muted }} data-testid={`${testId}-summary`}>{options.summary}</span>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 7 }}>
        {options.options.map((o) => (
          <OptionCard key={o.optionId} opt={o} unit={options.unit} testId={`${testId}-opt-${o.optionId}`} />
        ))}
      </div>
      {/* 系数出处披露（R13）：不披露就等于让人把代码兜底默认当成治理过的数。 */}
      {options.coefficients.length > 0 && (
        <div style={{ fontSize: 9.5, color: muted, marginTop: 7 }} data-testid={`${testId}-coefficients`}>
          系数出处：
          {options.coefficients.map((c) => (
            <span key={c.key} data-testid={`${testId}-coeff-${c.key}`} data-basis={c.basis} style={{ marginLeft: 6 }}>
              <span className="mono">{c.key}={c.value}</span>
              <span className="badge" style={{ marginLeft: 3, background: c.basis === "RULE_PARAMS" ? undefined : "var(--warn, #E8B54A)", color: c.basis === "RULE_PARAMS" ? undefined : "#1b2733" }}>
                {c.basis === "RULE_PARAMS" ? `规则口径 ${c.ruleKey}` : "代码兜底默认"}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 卡面上的影响面一行（看板栅格里那张小卡 —— 「这事有多大」必须在**不点开**时就看得见，
 * 否则用户还是"看到某基地全线飘红、却不知道落在谁身上"）。
 */
export function ExposureCardLine({ exposure, testId }: { exposure: Exposure | undefined; testId: string }) {
  if (!exposure) {
    // 引擎没回传（旧后端 / 该卡无 exposure）——诚实说没有，不编一个 0。
    return <span data-testid={testId} data-status="ABSENT" style={{ fontSize: 9.5, color: muted }}>影响面：引擎未回传</span>;
  }
  if (exposure.status === "EMPTY") {
    const next = exposure.nextOutsideWindow;
    return (
      <span data-testid={testId} data-status="EMPTY" data-rank={String(exposure.rank)} style={{ fontSize: 9.5, color: muted }}>
        本窗零敞口{next ? ` · 窗外 D+${next.dueDay} 还有 ${n(next.qty)}${exposure.units.qty}` : ""}
      </span>
    );
  }
  return (
    <span data-testid={testId} data-status="OK" data-rank={String(exposure.rank)} style={{ fontSize: 9.5, color: "var(--c-forecast)" }}>
      影响面 {exposure.orderCount} 单 · {n(exposure.totalQty)}{exposure.units.qty} · {n(exposure.revenueYi, 2)}
      {exposure.units.revenue} · {exposure.customerCount} 家客户
    </span>
  );
}

/**
 * 按引擎给的 `exposureOrder` 给卡片**查表排序** —— 注意这不是第二套排序算法：
 * `cards[]` 的数组序是既有排序契约（越线日↑ → 实测当前张力↓ → peak↓ → 基地名·被两条测试咬死，引擎刻意不动它），
 * 引擎另给显式排序键 `exposureOrder`（= `cards[].exposure.rank` 的同一次计算投影），前端**照它查表**即可。
 * 这里只做 `indexOf` 查表 + 稳定排序，不比较任何影响面指标 —— 一旦在前端比 revenue/qty 就会造出第二套算法并漂移。
 *
 * · `exposureOrder` 缺席（旧后端）→ 原样返回（向后兼容·R6）。
 * · 卡在 order 里查不到（引擎没给它 exposure）→ 排在全部有序卡之后，且彼此保持原数组相对序（sort 稳定）。
 */
export function orderCardsByExposure<T extends { baseId?: string }>(cards: readonly T[], exposureOrder?: readonly string[]): T[] {
  if (!exposureOrder || exposureOrder.length === 0) return [...cards];
  const rank = new Map(exposureOrder.map((b, i) => [b, i]));
  return [...cards].sort((a, b) => {
    const ra = rank.get(a.baseId ?? "") ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b.baseId ?? "") ?? Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });
}
