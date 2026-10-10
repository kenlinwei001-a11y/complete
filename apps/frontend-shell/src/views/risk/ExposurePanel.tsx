import type { Exposure } from "@platform/contracts";
import { Provenance } from "@/components/Provenance";
import { InfoPopover } from "@/components/InfoPopover";
import { AbsentNote, SubSection } from "./decisionInfoShared";
import styles from "../RiskBoardView.module.css";

/**
 * WO-DECISION-INFO-FE ① · 影响面（`RiskCard.exposure`）：这条风险**落在谁身上**。
 *
 * 治的病（用户原话）：「风险曲线答得出几号越线，答不出该不该管、管了代价多大」——
 * 后端 `buildExposure` 早已算出「哪些订单 / 哪些客户 / 多少钱 / 排第几」，前端一个字都没渲染。
 *
 * 诚实纪律（本仓红线·违反即退单）：
 *   · `status:"EMPTY"` 是**一等结论**（"本窗确实没有订单敞口"），必须连同 `emptyReason` 与
 *     `nextOutsideWindow`（窗外最近一张单在哪、超出几天）一起渲 —— 留空 = 把"窗外还有 2.18 万套"这条真信息弄丢。
 *   · 单位一律读 `exposure.units`（R14：前端只格式化不内联量纲）。
 *   · 金额/数量不重算：屏幕上每个数都是后端那一份的直投（R-一致：同一屏不出两个口径）。
 */
export function ExposurePanel({ exposure, baseName }: { exposure?: Exposure; baseName: string }) {
  if (!exposure) {
    return (
      <SubSection testId={`exposure-section-${baseName}`} title="① 影响面 · 落在谁身上">
        <AbsentNote
          testId={`exposure-absent-${baseName}`}
          field="cards[].exposure"
          what="影响面"
          hint="（该基地这条风险波及哪些订单/客户/多少钱，本次无从判断。）"
        />
      </SubSection>
    );
  }

  const u = exposure.units;
  const w = exposure.window;
  const windowNote = `窗 D+${w.fromDay}…D+${w.toDay} · 锚 ${w.forecastStart}`;

  if (exposure.status === "EMPTY" || !exposure.hasExposure) {
    const nx = exposure.nextOutsideWindow;
    return (
      <SubSection
        testId={`exposure-section-${baseName}`}
        title="① 影响面 · 落在谁身上"
        sub={<>{windowNote} · 影响面排序 #{exposure.rank}（零敞口沉底）</>}
      >
        <div className="empty-state" data-testid={`exposure-empty-${baseName}`} style={{ fontSize: 12, lineHeight: 1.7, color: "var(--muted)" }}>
          <b style={{ color: "var(--muted2)" }}>本窗无订单敞口（这是结论，不是缺数据）</b>
          <div style={{ marginTop: 4 }} data-testid={`exposure-empty-reason-${baseName}`}>{exposure.emptyReason ?? "后端未给出零敞口原因"}</div>
          {nx ? (
            <div style={{ marginTop: 5 }} data-testid={`exposure-next-outside-${baseName}`}>
              窗外最近一张：<b className="mono">{nx.so}</b> · {nx.cust} · <b className="mono">{nx.qty}</b> {u.qty} ·
              交期 <span className="mono">{nx.due}</span>（D+{nx.dueDay}）· <b>超出本窗 {nx.daysBeyondWindow} 天</b>
              <span style={{ color: "var(--muted2)" }}> —— 风险不是不存在，只是不在这个窗里。</span>
            </div>
          ) : (
            <div style={{ marginTop: 5, color: "var(--muted2)" }} data-testid={`exposure-next-outside-${baseName}`}>
              窗外也没有可查的订单（后端 nextOutsideWindow 为空）—— 不臆造"还有多少在后头"。
            </div>
          )}
        </div>
      </SubSection>
    );
  }

  return (
    <SubSection
      testId={`exposure-section-${baseName}`}
      title="① 影响面 · 落在谁身上"
      sub={<>{windowNote} · 影响面排序 #{exposure.rank}</>}
    >
      <div className={styles.rkKpi} style={{ margin: "0 0 8px" }} data-testid={`exposure-kpi-${baseName}`}>
        <div className={styles.rkK} data-testid={`exposure-ordercount-${baseName}`}>
          <b style={{ color: "var(--c-forecast-txt)" }}>{exposure.orderCount}</b>
          <span>波及订单（张）</span>
        </div>
        <div className={styles.rkK} data-testid={`exposure-qty-${baseName}`}>
          <b style={{ color: "var(--c-capacity-txt)" }}>
            <Provenance
              testId={`exposure-qty-prov-${baseName}`}
              src="risk_timeline · buildExposure（影响面）"
              formula={`Σ 窗内受影响订单 Order.qty（单位 ${u.qty}）`}
              inputs={exposure.provenance.map((p) => `${p.objectType}#${p.objectId}.${p.field}=${p.value}`)}
              note="与卡片 affectedOrders 同一份订单（同一出处·不重算）"
            >
              {exposure.totalQty}
            </Provenance>
          </b>
          <span>波及数量（{u.qty}）</span>
        </div>
        <div className={styles.rkK} data-testid={`exposure-revenue-${baseName}`}>
          <b style={{ color: "var(--ok-txt)" }}>
            <Provenance
              testId={`exposure-revenue-prov-${baseName}`}
              src="risk_timeline · buildExposure × SEG_REGISTRY"
              formula={`金额(${u.revenue}) = Σ 数量(${u.qty}) × 细分参考单价(万元/${u.qty}) ÷ 1e4`}
              inputs={["受影响订单逐单数量", "SEG_REGISTRY 参考单价（合约域单一来源）"]}
              note="估算口径 · 参考单价非逐单实际成交价（与 affected_orders summary.revenue 同价基）"
            >
              {exposure.revenueYi}
            </Provenance>
          </b>
          <span>金额敞口（{u.revenue}）</span>
        </div>
        <div className={styles.rkK} data-testid={`exposure-custcount-${baseName}`}>
          <b style={{ color: "var(--c-solver-txt)" }}>{exposure.customerCount}</b>
          <span>波及客户（家）</span>
        </div>
        {exposure.earliest && (
          <div className={styles.rkK} data-testid={`exposure-earliest-${baseName}`}>
            <b style={{ color: "var(--danger-txt)" }}>D+{exposure.earliest.dueDay}</b>
            <span>最早受影响交期 · {exposure.earliest.so} · {exposure.earliest.cust}</span>
          </div>
        )}
      </div>

      <table className="cmp" data-testid={`exposure-cust-table-${baseName}`} style={{ fontSize: 12, marginBottom: 8 }}>
        <thead>
          <tr>
            <th>受影响客户</th><th>应用细分</th><th>订单(张)</th><th>数量({u.qty})</th><th>金额({u.revenue})</th><th>最早交期</th>
          </tr>
        </thead>
        <tbody>
          {exposure.customers.map((c) => (
            <tr key={c.cust} data-testid={`exposure-cust-row-${c.cust}`}>
              <td className="zh"><b>{c.cust}</b></td>
              <td className="zh">{c.seg}</td>
              <td className="mono">{c.orderCount}</td>
              <td className="mono">{c.qty}</td>
              <td className="mono" style={{ color: "var(--ok-txt)" }}>{c.revenueYi}</td>
              <td className="mono">{c.earliestDue}（D+{c.earliestDueDay}）</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="cmp" data-testid={`exposure-order-table-${baseName}`} style={{ fontSize: 12 }}>
        <thead>
          <tr>
            <th>订单</th><th>客户</th><th>型号</th><th>数量({u.qty})</th><th>交期</th><th>优先级</th><th>金额({u.revenue})</th>
          </tr>
        </thead>
        <tbody>
          {exposure.orders.map((o) => (
            <tr key={o.so} data-testid={`exposure-order-row-${o.so}`}>
              <td className="mono"><b>{o.so}</b></td>
              <td className="zh">{o.cust}</td>
              <td className="zh">{o.model}</td>
              <td className="mono">{o.qty}</td>
              <td className="mono">{o.due}（D+{o.dueDay}）</td>
              {/* Order.pri 后端取不到时回传空串 —— 显式标"未标"，不默认成"中"。 */}
              <td className="zh">{o.pri === "" ? <span style={{ color: "var(--muted2)" }}>未标</span> : o.pri}</td>
              <td className="mono" style={{ color: "var(--ok-txt)" }}>{o.revenueYi}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* WO-R5 收编时降层：原为第一层的一整段口径，被 `check-ui-first-layer` 按
          规范 §2 R-UI-3「口径/公式进 `?` 浮层」点名。降层**不是删除** ——
          `?` 触发器永远可见，就是规范 §1 要求的那个「可见记号」。
          顺手修掉 `**同一份**` 的字面 ** 泄漏到界面（本仓 order-chain 刚踩过同一个坑）。 */}
      <div style={{ fontSize: 12, color: "var(--muted2)", marginTop: 6 }} data-testid={`exposure-caliber-${baseName}`}>
        <InfoPopover topic="影响面口径" testId={`exposure-caliber-${baseName}`}>
          订单 / 客户 / 数量取自与本卡 affectedOrders <b>同一份</b>窗内订单（不重算）；
          金额按细分参考单价折算（估算口径 · 非实际成交价）。
        </InfoPopover>
      </div>
    </SubSection>
  );
}
