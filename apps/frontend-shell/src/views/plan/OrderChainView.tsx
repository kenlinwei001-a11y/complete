import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { OrderProblemGroup } from "@platform/contracts";
import { runSolver } from "@/api/endpoints";
import { useSessionStore } from "@/store/sessionStore";
import { RiskHoverTrigger } from "@/components/Risk/RiskPopover";
import { LayeredDag, type DagEdgeDef, type DagNodeDef } from "@/components/Dag/LayeredDag";
import { Modal } from "@/components/ui/Modal";
import type { AffectedOrdersOutputVM } from "@/api/types";
import type { ViewRendererProps } from "../registry";
import { fmt, SnapshotBadge } from "../sim/shared";
import zh from "@/locales/zh";
import simStyles from "../sim/SimViews.module.css";
import styles from "./PlanViews.module.css";

const SEG_COLOR: Record<string, string> = { 乘用车: "#5E8FE8", 商用车: "#DD9551", 储能: "#36BFA5" };
const CHIP_LIMIT = 4;

/** 问题类别 → 中文（4 类归并：交期/毛利/齐套/信用） */
const CATEGORY_LABEL: Record<OrderProblemGroup["category"], string> = {
  DELIVERY: "交期",
  MARGIN: "毛利",
  KIT: "齐套",
  CREDIT: "信用",
};

/** 根因链四层着色：订单 → 判定 → 根因 → 对策 */
const CHAIN_COLORS = ["#7E8BEE", "#E8B54A", "#DD7E9E", "#62BE77"];
const CHAIN_TITLES = ["订单", "判定", "根因", "对策"];

/** 订单全链聚合（renderer=order-chain，§7.16）：affected_orders 扩展输出消费面 */
export default function OrderChainView(_props: ViewRendererProps) {
  const [baseFilter, setBaseFilter] = useState<string>("");
  const [openProblem, setOpenProblem] = useState<OrderProblemGroup | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["b", "affected-orders", { base: baseFilter }],
    queryFn: async () => {
      const res = await runSolver("affected_orders", baseFilter ? { base: baseFilter } : {});
      return { out: res.data as AffectedOrdersOutputVM, snapshotVersion: res.snapshotVersion };
    },
  });
  // 全量基地清单（筛选器选项固定，不随过滤结果收窄）
  const { data: allData } = useQuery({
    queryKey: ["b", "affected-orders", { base: "" }],
    queryFn: async () => {
      const res = await runSolver("affected_orders", {});
      return { out: res.data as AffectedOrdersOutputVM, snapshotVersion: res.snapshotVersion };
    },
  });

  const riskBases = useMemo(
    () => [...new Set((allData?.out.rows ?? []).flatMap((r) => r.risks.map((k) => k.base)))],
    [allData],
  );

  if (isLoading || !data) return <div className="empty-state">{zh.common.loading}</div>;
  const { out, snapshotVersion } = data;

  return (
    <div data-testid="order-chain-view">
      <div className={simStyles.head}>
        <div>
          <h3>{zh.orderChain.title}</h3>
          <div className={simStyles.sub}>
            交期 + 齐套 + 财务 三关联判：订单分配至风险基地 → 受影响明细与待解决问题归并（affected_orders 求解输出 problems[]）。
            <SnapshotBadge snapshotVersion={snapshotVersion} tool="affected_orders" />
          </div>
        </div>
      </div>

      {/* 基地筛选器（下拉 + 清除 chip） */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <label style={{ fontSize: 11.5, color: "var(--muted)" }}>
          {zh.orderChain.baseFilter}
          <select
            value={baseFilter}
            aria-label={zh.orderChain.baseFilter}
            data-testid="oc-base-filter"
            style={{ marginLeft: 8 }}
            onChange={(e) => setBaseFilter(e.target.value)}
          >
            <option value="">{zh.orderChain.allBases(riskBases.length)}</option>
            {riskBases.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        {baseFilter && (
          <button className={styles.chip} style={{ cursor: "pointer", color: "var(--c-capacity)", borderColor: "var(--c-capacity)" }} data-testid="oc-clear-filter" onClick={() => setBaseFilter("")}>
            {zh.orderChain.clearFilter(baseFilter)}
          </button>
        )}
      </div>

      {/* 财务影响汇总条 */}
      <div className={styles.sumBar} data-testid="oc-summary">
        <div className={simStyles.kpi}>
          <b data-testid="oc-sum-orders">{out.summary.orderCount}</b>
          <span>{zh.orderChain.sumOrders}</span>
        </div>
        <div className={simStyles.kpi}>
          <b data-testid="oc-sum-qty">{fmt(out.summary.totalQty, 2)}</b>
          <span>{zh.orderChain.sumQty}</span>
        </div>
        <div className={simStyles.kpi}>
          <b data-testid="oc-sum-custs">{out.summary.custCount}</b>
          <span>{zh.orderChain.sumCusts}</span>
        </div>
        <div className={simStyles.kpi}>
          <b data-testid="oc-sum-revenue">{fmt(out.summary.revenue, 2)}</b>
          <span>{zh.orderChain.sumRevenue}</span>
        </div>
      </div>

      {/* 受影响订单明细 */}
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="section-title">
          {zh.orderChain.detailSection}（{baseFilter || "全部风险基地"}）
        </div>
        <table className="cmp" data-testid="oc-detail-table">
          <thead>
            <tr>
              <th>{zh.orderChain.colOrder}</th>
              <th>{zh.orderChain.colCust}</th>
              <th>{zh.orderChain.colSeg}</th>
              <th>{zh.orderChain.colModel}</th>
              <th>{zh.orderChain.colQty}</th>
              <th>{zh.orderChain.colDue}</th>
              <th>{zh.orderChain.colRisks}</th>
              <th>{zh.orderChain.colDelay}</th>
            </tr>
          </thead>
          <tbody>
            {out.rows.map((r) => {
              const shown = r.risks.slice(0, CHIP_LIMIT);
              const more = r.risks.length - shown.length;
              return (
                <tr
                  key={r.so}
                  data-testid={`oc-row-${r.so}`}
                  style={{ cursor: "pointer" }}
                  onClick={() =>
                    // 行点击 → 订单写入 selectedObjects（对话上下文）
                    useSessionStore.getState().toggleSelectedObject({ objectType: "Order", objectId: `ord-${r.so}`, label: r.so })
                  }
                >
                  <td>
                    <b>{r.so}</b>
                  </td>
                  <td className="zh">{r.cust}</td>
                  <td>
                    <span className={styles.chip} style={{ color: SEG_COLOR[r.seg], borderColor: `${SEG_COLOR[r.seg]}66` }}>
                      {r.seg}
                    </span>
                  </td>
                  <td>{r.model}</td>
                  <td>{fmt(r.qty, 2)} 万套</td>
                  <td>
                    <b>{r.due.slice(5)}</b>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className={styles.riskChips}>
                      {shown.map((k, i) => (
                        <RiskHoverTrigger
                          key={i}
                          data={k}
                          className={styles.chip}
                          testId={`oc-risk-chip-${r.so}-${k.base}`}
                          style={{ color: k.peak >= (k.threshold ?? 85) ? "var(--danger)" : "var(--amber)", borderColor: "currentcolor", cursor: "default" }}
                        >
                          {k.base}·{k.factor} {k.crossDay != null ? `D+${k.crossDay}` : "未越线"}
                        </RiskHoverTrigger>
                      ))}
                      {more > 0 && (
                        <span className={styles.chip} data-testid={`oc-risk-more-${r.so}`}>
                          +{more}
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ color: "var(--danger)", fontWeight: 700 }}>{zh.orderChain.delayDays(r.delay)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {/* 聚合口径脚注（原样保留） */}
        <div className={simStyles.noteInfo} data-testid="oc-caliber">
          {zh.orderChain.caliber}
        </div>
      </div>

      {/* 待解决问题卡区（4 类归并） */}
      <div className="panel">
        <div className="section-title">{zh.orderChain.problemSection}</div>
        <div className={styles.probGrid} data-testid="oc-problems">
          {out.problems.map((p) => (
            <button key={p.category} className={styles.probCard} data-testid={`oc-problem-${p.category}`} onClick={() => setOpenProblem(p)}>
              <div className={styles.probTitle}>
                <span className="badge red" style={{ marginRight: 6 }}>
                  {CATEGORY_LABEL[p.category]}
                </span>
                {p.title}
              </div>
              <div className={styles.probMeta}>
                {zh.orderChain.problemOrders(p.orderCount)} · {zh.orderChain.problemFinance(p.financeImpact)}
                <div className="zh">{p.rootCauseSummary}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {openProblem && (
        <Modal title={`${openProblem.title} · ${zh.orderChain.dagTitle}`} onClose={() => setOpenProblem(null)} width={860}>
          <ProblemDag group={openProblem} />
        </Modal>
      )}
    </div>
  );
}

/** 逐单根因 DAG（LayeredDag 四层：订单 → 判定 → 根因 → 对策） */
function ProblemDag({ group }: { group: OrderProblemGroup }) {
  const nodes: DagNodeDef[] = [];
  const edges: DagEdgeDef[] = [];
  group.rootChains.forEach((chain, ci) => {
    let prev: string | null = null;
    chain.layers.forEach((layer, li) => {
      const id = `${ci}-${layer.kind}`;
      nodes.push({ id, layer: li, label: layer.label, sub: li > 0 ? chain.orderId : undefined, color: CHAIN_COLORS[li] });
      if (prev) edges.push({ from: prev, to: id });
      prev = id;
    });
  });
  return <LayeredDag nodes={nodes} edges={edges} layerTitles={CHAIN_TITLES} testId="problem-dag" />;
}
