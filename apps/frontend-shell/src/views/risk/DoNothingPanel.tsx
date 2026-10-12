import type { DoNothing } from "@platform/contracts";
import { InfoPopover } from "@/components/InfoPopover";
import { Provenance } from "@/components/Provenance";
import { AbsentNote, MissingEvidenceNote, SubSection } from "./decisionInfoShared";

/**
 * WO-DECISION-INFO-FE ② · 不作为后果（`RiskCard.doNothing`）：**不处置的话会怎样**。
 *
 * 四个子块各自独立标状态（后端刻意不合成一个"总状态"，前端也绝不合并——合并即抹平 EMPTY）：
 *   catchUp  缺口自然消化天数（真派生：缺口 ÷ 空闲日产能）
 *   delay    逐单延误（后端标 `basis:"ESTIMATED"` —— 前端必须显示「估算」，不许当实测裸渲染）
 *   penalty  违约金 —— **本仓恒 EMPTY**（C01–C33 逐条核过无承载）→ 显式「未承载」，
 *            **不显示 0、不留空、不编一个数**（死映射比算不出更糟：唯一带罚金的
 *            `LongTermAgreement.breachPenaltyWan` 是供应商长协欠交，不是我方晚交客户单）
 *   atRiskCustomers  受影响客户；其 `customerObject` 连不上 Customer 对象时同样诚实标 EMPTY
 *            （order_of_customer 边是按订单序轮转绑定的，拿它回答账期 = 张冠李戴）
 */
export function DoNothingPanel({ doNothing, baseName }: { doNothing?: DoNothing; baseName: string }) {
  if (!doNothing) {
    return (
      <SubSection testId={`donothing-section-${baseName}`} title="② 不作为后果 · 不管会怎样">
        <AbsentNote
          testId={`donothing-absent-${baseName}`}
          field="cards[].doNothing"
          what="不作为后果"
          hint="（缺口几天能自然消化、逐单晚交几天、波及哪些客户，本次无从判断。）"
        />
      </SubSection>
    );
  }

  const u = doNothing.units;
  const { catchUp, delay, penalty } = doNothing;

  return (
    <SubSection
      testId={`donothing-section-${baseName}`}
      title="② 不作为后果 · 不管会怎样"
      sub={
        <>
          三块状态 <b data-testid={`donothing-status-${baseName}`}>{doNothing.status}</b>
          （OK=三块都算得出 / PARTIAL=部分算得出 / EMPTY=都算不出）· 逾期营收敞口 {doNothing.revenueAtRiskYi} {u.revenue}
        </>
      }
    >
      <div style={{ fontSize: 12, lineHeight: 1.7, color: "var(--muted)", marginBottom: 8 }} data-testid={`donothing-summary-${baseName}`}>
        {doNothing.summary}
      </div>

      {/* ── ②a 缺口自然消化天数 ──────────────────────────────────────────── */}
      <div style={{ marginBottom: 8 }} data-testid={`donothing-catchup-${baseName}`}>
        {catchUp.status === "OK" ? (
          <div style={{ fontSize: 12 }}>
            <b>缺口自然消化</b>：
            <Provenance
              testId={`donothing-catchup-prov-${baseName}`}
              src="risk_timeline · buildDoNothing（真派生）"
              formula={catchUp.formula}
              inputs={catchUp.provenance.map((p) => `${p.objectType}#${p.objectId}.${p.field}=${p.value}`)}
              note="真派生（非估算）：缺口与空闲日产能都来自真对象"
            >
              <b className="mono" style={{ color: "var(--danger-txt)" }}>{catchUp.days} {catchUp.unit}</b>
            </Provenance>
            {/*
             * 分层（规范 §1 / R-UI-3）：算式是**解释**不是**结论** —— 降进 `?` 浮层，
             * 第一层只留天数与那个 `?` 记号。原文一字未删，只换了层。
             */}
            <InfoPopover topic="这个天数怎么来的" testId={`donothing-catchup-caliber-${baseName}`}>
              缺口 {catchUp.shortfall} {u.qty} ÷ 空闲日产能 {catchUp.freeDaily} {u.qty}/日
            </InfoPopover>
          </div>
        ) : (
          <MissingEvidenceNote testId={`donothing-catchup-empty-${baseName}`} title="缺口自然消化天数：算不出" ev={catchUp} />
        )}
      </div>

      {/* ── ②b 逐单延误（后端标 ESTIMATED → 前端必须显示「估算」） ─────────── */}
      <div style={{ marginBottom: 8 }} data-testid={`donothing-delay-${baseName}`}>
        {delay.status === "OK" ? (
          <>
            <div style={{ fontSize: 12, marginBottom: 4 }}>
              <b>逐单延误</b>：最坏 <b className="mono" style={{ color: "var(--danger-txt)" }}>{delay.worstDays}</b> 天
              <span className="badge" data-testid={`donothing-delay-basis-${baseName}`} style={{ marginLeft: 6 }}>估算 · 非实测</span>
            </div>
            <table className="cmp" data-testid={`donothing-delay-table-${baseName}`} style={{ fontSize: 12 }}>
              <thead>
                {/* 列名说的是这一列**装的是什么**（派生 / 估算 的出身标），不是口径本身；口径在该列的 `?` 里。 */}
                <tr><th>订单</th><th>客户</th><th>数量({u.qty})</th><th>交期</th><th>延误(天)</th><th>数据出身</th></tr>
              </thead>
              <tbody>
                {delay.orders.map((o) => (
                  <tr key={o.so} data-testid={`donothing-delay-row-${o.so}`}>
                    <td className="mono"><b>{o.so}</b></td>
                    <td className="zh">{o.cust}</td>
                    <td className="mono">{o.qty}</td>
                    <td className="mono">{o.due}（D+{o.dueDay}）</td>
                    <td className="mono" style={{ color: "var(--danger-txt)" }}>{o.delayDays}</td>
                    <td>
                      {/* 后端 basis：DERIVED=真派生 / ESTIMATED=确定性估算。裸渲染当实测 = 本仓 KILL-MOCK-RED 红线。 */}
                      <Provenance
                        testId={`donothing-delay-basis-${o.so}`}
                        src={o.basis === "DERIVED" ? "真派生" : "确定性估算（非实测）"}
                        formula={o.basisNote}
                        inputs={[`SO ${o.so}`, `交期 ${o.due}`]}
                        note={o.basis === "ESTIMATED" ? "要变成实测需接 Shipment 实际交付日 / 排产完工日回写" : undefined}
                      >
                        <span className="badge" data-basis={o.basis}>{o.basis === "DERIVED" ? "派生" : "估算"}</span>
                      </Provenance>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 12, color: "var(--muted2)", marginTop: 4 }} data-testid={`donothing-delay-note-${baseName}`}>
              {delay.note}
            </div>
          </>
        ) : (
          <MissingEvidenceNote testId={`donothing-delay-empty-${baseName}`} title="逐单延误：算不出" ev={delay} />
        )}
      </div>

      {/* ── ②c 违约金 —— 本仓恒 EMPTY（诚实位·不显 0、不留空） ─────────────── */}
      <div style={{ marginBottom: 8 }} data-testid={`donothing-penalty-${baseName}`}>
        {penalty.status === "OK" ? (
          // 契约允许 OK（数据侧补 Order.latePenaltyRatePerDay + 罚则规则后即点亮）；本仓当前无承载 → 此分支尚不可达。
          <div style={{ fontSize: 12 }} data-testid={`donothing-penalty-ok-${baseName}`}>
            <b>违约金</b>：
            <Provenance
              testId={`donothing-penalty-prov-${baseName}`}
              src="risk_timeline · buildDoNothing"
              formula={penalty.formula}
              rule={penalty.ruleKey}
              inputs={penalty.provenance.map((p) => `${p.objectType}#${p.objectId}.${p.field}=${p.value}`)}
            >
              <b className="mono" style={{ color: "var(--danger-txt)" }}>{penalty.amountYuan} 元</b>
            </Provenance>
          </div>
        ) : (
          <>
            <MissingEvidenceNote testId={`donothing-penalty-empty-${baseName}`} title="违约金 / 罚则：本平台未承载" ev={penalty} />
            <div style={{ fontSize: 12, color: "var(--muted2)", marginTop: 3 }} data-testid={`donothing-penalty-nozero-${baseName}`}>
              此处<b>刻意不显示金额</b>（不是 0）：显示 0 等于断言「不赔钱」，而本仓没有任何规则/字段支持该断言。
              {/*
               * 分层（规范 §1）：诚实位**允许降到浮层、绝不允许删除** ——
               * 「本平台未承载违约金口径」这句原文原封不动搬进浮层，第一层留「未承载」徽标 + `?` 记号。
               */}
              <InfoPopover topic="为什么这里空着" testId={`donothing-penalty-caliber-${baseName}`}>
                本平台未承载违约金口径：唯一带罚金的字段是供应商长协的欠交罚金，
                说的是<b>供应商欠我方</b>，不是<b>我方晚交客户</b> —— 拿它回答这里等于张冠李戴。
                要点亮此块，需数据侧补齐订单的逐日违约金率与对应罚则规则。
              </InfoPopover>
            </div>
          </>
        )}
      </div>

      {/* ── ②d 受影响客户 ───────────────────────────────────────────────── */}
      {doNothing.atRiskCustomers.length > 0 ? (
        <table className="cmp" data-testid={`donothing-cust-table-${baseName}`} style={{ fontSize: 12 }}>
          <thead>
            <tr><th>受影响客户</th><th>订单(张)</th><th>数量({u.qty})</th><th>金额({u.revenue})</th><th>最坏延误(天)</th><th>客户档案（账期/信用额度）</th></tr>
          </thead>
          <tbody>
            {doNothing.atRiskCustomers.map((c) => (
              <tr key={c.cust} data-testid={`donothing-cust-row-${c.cust}`}>
                <td className="zh"><b>{c.cust}</b></td>
                <td className="mono">{c.orderCount}</td>
                <td className="mono">{c.qty}</td>
                <td className="mono" style={{ color: "var(--ok-txt)" }}>{c.revenueYi}</td>
                <td className="mono" style={{ color: "var(--danger-txt)" }}>{c.worstDelayDays}</td>
                <td>
                  {c.customerObject.status === "OK" ? (
                    <span className="mono" data-testid={`donothing-custobj-ok-${c.cust}`}>
                      {c.customerObject.custId} · 账期 {c.customerObject.termDays} 天 · 额度 {c.customerObject.creditLimit}
                    </span>
                  ) : (
                    <span data-testid={`donothing-custobj-empty-${c.cust}`} style={{ color: "var(--muted2)", fontSize: 12 }} title={c.customerObject.reason}>
                      连不到 Customer 对象（缺 <span className="mono">{c.customerObject.missingFields[0] ?? "?"}</span>）—— 拒绝给一个张冠李戴的账期
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ fontSize: 12, color: "var(--muted2)" }} data-testid={`donothing-cust-empty-${baseName}`}>
          受影响客户名单为空（与影响面同一出处：本窗无订单敞口 → 没有客户可列，不臆造）。
        </div>
      )}
    </SubSection>
  );
}
