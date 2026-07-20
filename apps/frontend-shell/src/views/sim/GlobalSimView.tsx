import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchObjects } from "@/api/endpoints";
import type { ViewRendererProps } from "../registry";
import { fmt } from "./shared";
import { useLiveSolver } from "./useLiveSolver";
import styles from "./SimViews.module.css";

/**
 * WO-PORTFOLIO-OPTIMAL · 全局联合推演视图（闭 G-PORTFOLIO-LOCAL-ONLY 前端半）。
 *
 * 补「读所有订单联合求解」那根缺线：订单多选 + 冻结/排除勾选 → 订单集真传进 args（orderIds/frozenOrderIds）→
 * portfolio 求解器（datacore 经 CP-SAT sidecar·mock 态逐口径移植）跨基地×时间窗联合最优 → 方案对比矩阵
 * （方案×指标：按期/延误/换型/代价/获排/被挤）+ 分配台账（基地×窗口×量·provenance 悬浮）+ 被挤单卡 +
 * capacityLedger 逐格守恒（allocated≤cap·无重复占用）+ 冻结单卡。改订单集/冻结/方案 → 联合最优真变。
 * 徽标诚实标「推演结果·非数据库事实」；每分配/被挤值 title 悬浮显 provenance（R13）。
 */

interface Prov { kind: string; drillType: string; drillId: string; drillField: string; drillValue: number }
interface Scenario { key: string; objectiveValues: { ontime: number; delay: number; changeover: number; cost: number }; servedCount: number; displacedCount: number; servedQty: number }
interface PortResult {
  status: string; optimal: boolean; feasible: boolean; reconciled: boolean;
  allocation: { item: string; kind: string; committed: boolean; base: string; baseName: string; window: number; qty: number; delayDays: number; onTime: boolean; provenance: Prov }[];
  displaced: { orderId: string; kind: string; qty: number; model: string; provenance: Prov }[];
  scenarios: Scenario[];
  objectiveValues: { ontime: number; delay: number; changeover: number; cost: number };
  capacityLedger: { baseId: string; window: number; cap: number; allocated: number }[];
  reconChecks: { ok: boolean }[];
  cost: { delay: number; changeover: number; unserved: number; total: number };
  frozen: { orderId: string; base: string; window: number; qty: number }[];
  summary: string;
}

const ALL_SCENARIOS = ["max_ontime", "min_cost", "min_changeover"] as const;
const SCEN_LABEL: Record<string, string> = { max_ontime: "最多按期", min_cost: "最低代价", min_changeover: "最少换型", min_delay: "最小延误" };
const provTitle = (p: Prov) => `溯源 ${p.kind}：${p.drillType}.${p.drillField}[${p.drillId}] = ${p.drillValue}`;

export default function GlobalSimView(_props: ViewRendererProps) {
  const orders = useQuery({ queryKey: ["a", "objects", { type: "Order", view: "global-sim" }], queryFn: () => searchObjects("Order", "") });
  const orderList = useMemo(() => (orders.data?.items ?? []).map((o) => ({ id: String(o.props.so ?? o.id), cust: String(o.props.cust ?? "—"), model: String(o.props.model ?? "—"), qty: Number(o.props.qty ?? 0), due: String(o.props.due ?? "—") })), [orders.data]);

  const [selected, setSelected] = useState<Set<string> | null>(null); // null = 全选（尚未交互）
  const [frozen, setFrozen] = useState<Set<string>>(new Set());
  const [scenarios, setScenarios] = useState<string[]>(["max_ontime", "min_cost"]);

  const effectiveSelected = selected ?? new Set(orderList.map((o) => o.id));
  const orderIds = orderList.filter((o) => effectiveSelected.has(o.id)).map((o) => o.id);
  const frozenOrderIds = orderList.filter((o) => frozen.has(o.id)).map((o) => o.id);

  const args = useMemo<Record<string, unknown> | null>(
    () => (orderList.length ? { orderIds, frozenOrderIds, scenarios } : null),
    [orderList.length, orderIds.join(","), frozenOrderIds.join(","), scenarios.join(",")],
  );
  const res = useLiveSolver<PortResult>("portfolio", args, (raw) => raw as PortResult);
  const d = res.data;

  const toggleSel = (id: string) => setSelected((prev) => {
    const next = new Set(prev ?? new Set(orderList.map((o) => o.id)));
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleFrozen = (id: string) => setFrozen((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleScen = (k: string) => setScenarios((prev) => prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]);

  return (
    <div className={styles.audCard} data-testid="global-sim" style={{ marginTop: 12 }}>
      <div className={styles.audHead}>
        <strong>全局联合推演（全订单 × 全基地 × 时间 · 共享产能不重复占用 · 多方案量化利弊）</strong>
        <span className={styles.chip} title="联合最优在求解器上求可行方案，非数据库既有事实" data-testid="global-sim-badge">推演结果 · 非数据库事实</span>
      </div>

      {/* 方案选择 */}
      <div className={styles.formRow} style={{ display: "flex", gap: 12, alignItems: "center", margin: "8px 0", flexWrap: "wrap" }}>
        <span style={{ opacity: 0.75 }}>对比方案：</span>
        {ALL_SCENARIOS.map((k) => (
          <label key={k} style={{ display: "flex", gap: 4, alignItems: "center" }} data-testid={`global-sim-scen-${k}`}>
            <input type="checkbox" checked={scenarios.includes(k)} onChange={() => toggleScen(k)} /> {SCEN_LABEL[k]}
          </label>
        ))}
        <span style={{ marginLeft: "auto", opacity: 0.7 }} data-testid="global-sim-verdict">
          {d ? `${d.optimal ? "✓ 可证最优" : d.status} · 守恒${d.reconciled ? "通过" : "未通过"}` : res.isFetching ? "求解中…" : "—"}
        </span>
      </div>

      {/* 订单多选 + 冻结勾选 */}
      <table className={styles.abCompare} data-testid="global-sim-orders" style={{ width: "100%", marginTop: 6 }}>
        <thead><tr><th>纳入</th><th>冻结</th><th>订单</th><th>客户</th><th>型号</th><th>数量(套)</th><th>交期</th></tr></thead>
        <tbody>
          {orderList.map((o) => (
            <tr key={o.id} data-testid={`global-sim-order-${o.id}`}>
              <td><input type="checkbox" checked={effectiveSelected.has(o.id)} onChange={() => toggleSel(o.id)} data-testid={`global-sim-include-${o.id}`} /></td>
              <td><input type="checkbox" checked={frozen.has(o.id)} onChange={() => toggleFrozen(o.id)} data-testid={`global-sim-freeze-${o.id}`} /></td>
              <td className="mono">{o.id}</td><td>{o.cust}</td><td className="mono">{o.model}</td><td>{fmt(o.qty, 0)}</td><td className="mono">{o.due}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {d && (
        <>
          {/* 方案对比矩阵（方案 × 指标·量化利弊真算） */}
          <div className={styles.secHead} style={{ marginTop: 12 }}>方案对比矩阵（改目标 → 分配与各目标值真漂移）</div>
          <table className={styles.abCompare} data-testid="global-sim-matrix" style={{ width: "100%" }}>
            <thead><tr><th>方案</th><th>获排</th><th>被挤</th><th>获排量(套)</th><th>按期</th><th>延误量</th><th>换型</th><th>代价</th></tr></thead>
            <tbody>
              {d.scenarios.map((s) => (
                <tr key={s.key} data-testid={`global-sim-scen-row-${s.key}`}>
                  <td><strong>{SCEN_LABEL[s.key] ?? s.key}</strong></td>
                  <td>{s.servedCount}</td><td>{s.displacedCount}</td><td>{fmt(s.servedQty, 0)}</td>
                  <td>{fmt(s.objectiveValues.ontime, 0)}</td><td>{fmt(s.objectiveValues.delay, 0)}</td>
                  <td>{fmt(s.objectiveValues.changeover, 0)}</td><td>{fmt(s.objectiveValues.cost, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* 主方案分配台账（基地×窗口×量·provenance 悬浮） */}
          <div className={styles.secHead} style={{ marginTop: 12 }}>联合分配台账（主方案·基地×时间窗）</div>
          <table className={styles.abCompare} data-testid="global-sim-alloc" style={{ width: "100%" }}>
            <thead><tr><th>需求项</th><th>来源</th><th>基地</th><th>窗口</th><th>量(套)</th><th>延误(天)</th></tr></thead>
            <tbody>
              {d.allocation.map((a) => (
                <tr key={`${a.item}-${a.base}-${a.window}`} data-testid={`global-sim-alloc-${a.item}`} title={provTitle(a.provenance)}>
                  <td className="mono">{a.item}</td>
                  <td>{a.committed ? "在产承诺" : a.kind === "forecast" ? "预测" : "订单"}</td>
                  <td>{a.baseName}</td><td>{a.window}</td><td>{fmt(a.qty, 0)}</td>
                  <td style={a.onTime ? undefined : { color: "#c0392b" }}>{a.onTime ? "按期" : fmt(a.delayDays, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* 被挤单卡 */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0" }} data-testid="global-sim-displaced">
            {d.displaced.length ? d.displaced.map((x) => (
              <div key={x.orderId} className={styles.noteAmber} style={{ minWidth: 150 }} data-testid={`global-sim-displaced-${x.orderId}`} title={provTitle(x.provenance)}>
                <strong>{x.orderId}</strong>（{x.kind === "forecast" ? "预测" : x.model}）<br />{fmt(x.qty, 0)} 套 · 未获排
              </div>
            )) : <span style={{ opacity: 0.6 }}>全部需求项获排（无被挤）</span>}
          </div>

          {/* 冻结单卡 */}
          {d.frozen.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0" }} data-testid="global-sim-frozen">
              {d.frozen.map((f) => (
                <div key={f.orderId} className={styles.noteInfo} style={{ minWidth: 150 }} data-testid={`global-sim-frozen-${f.orderId}`}>
                  <strong>{f.orderId}</strong>（冻结·产能预扣）<br />{f.base} · 窗口{f.window} · {fmt(f.qty, 0)} 套
                </div>
              ))}
            </div>
          )}

          {/* 共享产能守恒台账（逐格 allocated ≤ 净cap·无重复占用） */}
          <div className={styles.secHead} style={{ marginTop: 12 }}>共享产能守恒台账（逐格 allocated ≤ 净cap · 无重复占用）</div>
          <table className={styles.abCompare} data-testid="global-sim-ledger" style={{ width: "100%" }}>
            <thead><tr><th>基地</th><th>窗口</th><th>净产能</th><th>已分配</th><th>守恒</th></tr></thead>
            <tbody>
              {d.capacityLedger.filter((c) => c.allocated > 0).map((c) => (
                <tr key={`${c.baseId}-${c.window}`} data-testid={`global-sim-ledger-${c.baseId}-${c.window}`}>
                  <td>{c.baseId}</td><td>{c.window}</td><td>{fmt(c.cap, 0)}</td><td>{fmt(c.allocated, 0)}</td>
                  <td style={c.allocated <= c.cap ? { color: "#2e7d32" } : { color: "#c0392b" }}>{c.allocated <= c.cap ? "✓" : "✗"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 8 }} data-testid="global-sim-summary">{d.summary}</div>
          {res.error ? <div className={styles.noteRed}>求解失败：{String(res.error?.message ?? "")}</div> : null}
        </>
      )}
    </div>
  );
}
