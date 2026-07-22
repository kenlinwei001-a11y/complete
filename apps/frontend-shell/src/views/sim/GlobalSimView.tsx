import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { searchObjects } from "@/api/endpoints";
import type { ViewRendererProps } from "../registry";
import { fmt, useActionDraft } from "./shared";
import { useLiveSolver } from "./useLiveSolver";
import { MultiObjWhatifPanel } from "./MultiObjWhatifPanel";
import styles from "./GlobalSimView.module.css";

/**
 * WO-GLOBALSIM-GLASS-REDESIGN · 全局联合推演（磨砂玻璃重设计 + 全局在先 + 从项目推演去重）。
 *
 * 定位：全局推演 = 规划起点（全局最优在先），项目推演 = 框架内细排。
 * 视觉：committed 深空蓝 + 右侧磨砂玻璃卡（像素 token 见 GlobalSimView.module.css，严格照基准图）。
 * 结构：Hero（左·产能占用矩阵 基地×窗口热力 + 挤压点 pin + 目标 segmented + 守恒 ✓）·
 *       磨砂卡①联合求解配置（订单/冻结集 → 求解结果 + 方案对比矩阵 + 发起联合求解/采纳方案）·
 *       磨砂卡②被挤单/冻结单卡（每卡「进项目推演细排 →」双向下钻）· 迁入 MultiObjWhatifPanel（联合 what-if 本是全局能力）。
 *
 * 接线不变（只改壳与位置·不改算什么）：portfolio 求解器（datacore CP-SAT sidecar·mock 逐口径移植）
 * 消费其输出；改订单集/冻结/目标 → 联合最优真变；徽标诚实标「推演结果·非数据库事实」；每分配/被挤值 provenance（R13）。
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

/**
 * WO-GLOBALSIM-DRILL-SEAM · 下钻语义按 item.kind 分流（口径不一致接缝·消除 WIP:/FC: 静默空跳）。
 *
 * 病根：GlobalSim 需求项池 = 三源并集（portfolio.ts）——销售订单 `SO-xxxx`(kind order) ∪ 在产工单
 * `WIP:${woId}`(kind wip·预扣产能) ∪ 销售预测 `FC:${segId}`(kind forecast·未落订单)；ProjectSim 池仅 Order。
 * 旧下钻对所有 item 一刀切 `?order=<item>`，把 WIP:/FC: 前缀 id 也塞进去 → ProjectSim 只认 Order.props.so，
 * 命中才 pickOrder → WIP/预测永远 hit=undefined → **silent no-op（点了没反应）**。
 *
 * 分流：只有 kind=order（SO-xxxx）在 ProjectSim 1:1 命中可细排 → 保留指向 project-sim 的链接；
 * wip/forecast 非 Order，指向 project-sim 必空跳 → 不给该链接，改诚实静态标注（悬浮复用 provTitle）。
 * 差异化下钻（指向 WorkOrder/DemandSegment 详情视图）视有无对应视图而定：现 registry 未注册此类视图，
 * 故退化为标注而非硬造映射（不瞎猜）。台账「来源」列已区分 committed/forecast/order，下钻 affordance 与之一致。
 */
const NON_DRILLABLE_NOTE: Record<string, string> = {
  wip: "在产承诺 · 预扣产能（非可细排订单）",
  forecast: "销售预测需求（未落订单 · 不可细排）",
};
function DrillAffordance({ kind, id, label, testId, prov }: { kind: string; id: string; label: string; testId: string; prov?: Prov }) {
  // order(SO-xxxx)：1:1 命中 ProjectSim → 保留细排链接（现状有效·不回归）。
  if (kind === "order") {
    return (
      <Link className={styles.drillLink} to={`/v/project-sim?order=${encodeURIComponent(id)}`} data-testid={testId}>
        {label}
      </Link>
    );
  }
  // wip / forecast：非 Order → 不给指向 project-sim 的链接（否则空跳），改诚实标注 + provenance 悬浮。
  const note = NON_DRILLABLE_NOTE[kind] ?? "非可细排项（非销售订单）";
  return (
    <span
      data-testid={testId}
      data-drill-blocked="true"
      title={prov ? provTitle(prov) : note}
      style={{ fontSize: 11, fontStyle: "italic", color: "var(--muted2, #8a94a6)", whiteSpace: "nowrap" }}
    >
      {note}
    </span>
  );
}

/** 占用率 → 冷暖热力色（低=冷蓝，满=暖红·committed 深空底上可读）。 */
function heatColor(util: number): string {
  const u = Math.max(0, Math.min(1, util));
  if (u >= 0.95) return "rgba(224,98,108,0.55)";
  if (u >= 0.8) return "rgba(221,149,81,0.45)";
  if (u >= 0.5) return "rgba(210,176,76,0.32)";
  if (u > 0) return `rgba(84,181,196,${0.16 + u * 0.28})`;
  return "rgba(255,255,255,0.03)";
}

export default function GlobalSimView(_props: ViewRendererProps) {
  const orders = useQuery({ queryKey: ["a", "objects", { type: "Order", view: "global-sim" }], queryFn: () => searchObjects("Order", "") });
  const orderList = useMemo(() => (orders.data?.items ?? []).map((o) => ({ id: String(o.props.so ?? o.id), cust: String(o.props.cust ?? "—"), model: String(o.props.model ?? "—"), qty: Number(o.props.qty ?? 0), due: String(o.props.due ?? "—") })), [orders.data]);

  const [selected, setSelected] = useState<Set<string> | null>(null); // null = 全选（尚未交互）
  const [frozen, setFrozen] = useState<Set<string>>(new Set());
  const [scenarios, setScenarios] = useState<string[]>(["max_ontime", "min_cost"]);
  const [primary, setPrimary] = useState<string>("max_ontime"); // Hero 目标 segmented（主方案）
  const [nonce, setNonce] = useState(0);

  const effectiveSelected = selected ?? new Set(orderList.map((o) => o.id));
  const orderIds = orderList.filter((o) => effectiveSelected.has(o.id)).map((o) => o.id);
  const frozenOrderIds = orderList.filter((o) => frozen.has(o.id)).map((o) => o.id);
  // 主方案必在对比集中（目标切换=多方案对比·吸收 decision-play 方案对比职能）。
  const scenSet = useMemo(() => (scenarios.includes(primary) ? scenarios : [primary, ...scenarios]), [scenarios, primary]);

  const args = useMemo<Record<string, unknown> | null>(
    () => (orderList.length ? { orderIds, frozenOrderIds, scenarios: scenSet, objective: primary, nonce } : null),
    [orderList.length, orderIds.join(","), frozenOrderIds.join(","), scenSet.join(","), primary, nonce],
  );
  const res = useLiveSolver<PortResult>("portfolio", args, (raw) => raw as PortResult);
  const d = res.data;
  const adopt = useActionDraft();

  const toggleSel = (id: string) => setSelected((prev) => {
    const next = new Set(prev ?? new Set(orderList.map((o) => o.id)));
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleFrozen = (id: string) => setFrozen((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleScen = (k: string) => setScenarios((prev) => prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]);

  // Hero 产能占用矩阵（基地 × 窗口·从 capacityLedger 派生）。
  const matrix = useMemo(() => {
    if (!d) return null;
    const baseName = new Map<string, string>();
    for (const a of d.allocation) baseName.set(a.base, a.baseName);
    const bases = [...new Set(d.capacityLedger.map((c) => c.baseId))].sort();
    const windows = [...new Set(d.capacityLedger.map((c) => c.window))].sort((a, b) => a - b);
    const cell = new Map<string, { cap: number; allocated: number }>();
    for (const c of d.capacityLedger) cell.set(`${c.baseId}|${c.window}`, { cap: c.cap, allocated: c.allocated });
    return { bases: bases.filter((b) => d.capacityLedger.some((c) => c.baseId === b && c.allocated > 0)), windows, cell, baseName };
  }, [d]);

  const onAdopt = () => {
    if (!d) return;
    adopt.mutate({ actionTypeKey: "plan_change", payload: { source: "global-sim", objective: primary, servedQty: d.scenarios.find((s) => s.key === primary)?.servedQty ?? 0, displaced: d.displaced.map((x) => x.orderId), summary: d.summary } });
  };

  const primaryScen = d?.scenarios.find((s) => s.key === primary) ?? d?.scenarios[0];
  const ontimeRate = primaryScen && primaryScen.servedCount + primaryScen.displacedCount > 0
    ? (primaryScen.objectiveValues.ontime / (primaryScen.servedCount + primaryScen.displacedCount)) * 100 : 0;

  return (
    <div className={styles.root} data-testid="global-sim">
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <h2>全局联合推演 · 规划起点（全局最优在先）</h2>
          <p>全订单 × 全基地 × 时间共享产能不重复占用 → 一次联合最优；项目推演是本框架内的单项目细排。改目标 / 冻结 / 订单集 → 联合最优真变。</p>
        </div>
        <span className={styles.badge} title="联合最优在求解器上求可行方案，非数据库既有事实" data-testid="global-sim-badge">推演结果 · 非数据库事实</span>
      </div>

      <div className={styles.layout}>
        {/* ————— Hero（左）：产能占用矩阵 + 目标 segmented + 守恒 ✓ ————— */}
        <div className={styles.glass}>
          <span className={styles.grpLabel}>[ 产能占用矩阵 · 基地 × 时间窗 ]</span>
          <div className={styles.heroTools}>
            <div className={styles.segmented} data-testid="global-sim-objective">
              {ALL_SCENARIOS.map((k) => (
                <button
                  key={k}
                  className={`${styles.segBtn} ${primary === k ? styles.segOn : ""}`}
                  data-testid={`global-sim-obj-${k}`}
                  onClick={() => setPrimary(k)}
                >
                  {SCEN_LABEL[k]}
                </button>
              ))}
            </div>
            <span className={`${styles.miniConserve} ${d && !d.reconciled ? styles.bad : ""}`} data-testid="global-sim-verdict">
              {d ? `${d.optimal ? "✓ 可证最优" : d.status} · 产能台账守恒${d.reconciled ? "通过" : "未通过"}` : res.isFetching ? "求解中…" : "—"}
            </span>
          </div>

          {matrix ? (
            <div className={styles.matrixWrap} data-testid="global-sim-heatmatrix">
              <table className={styles.heatMatrix}>
                <thead>
                  <tr>
                    <th />
                    {matrix.windows.map((w) => <th key={w}>窗{w}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {matrix.bases.map((b) => (
                    <tr key={b}>
                      <td className={styles.rowHead}>{matrix.baseName.get(b) ?? b}</td>
                      {matrix.windows.map((w) => {
                        const c = matrix.cell.get(`${b}|${w}`);
                        const util = c && c.cap > 0 ? c.allocated / c.cap : 0;
                        const full = util >= 0.95;
                        return (
                          <td key={w} className={styles.heatCell} style={{ background: heatColor(util) }}
                            title={c ? `${matrix.baseName.get(b) ?? b}·窗口${w}：已分配 ${fmt(c.allocated, 0)} / 净产能 ${fmt(c.cap, 0)}（占用 ${(util * 100).toFixed(0)}%）` : "—"}
                            data-testid={`global-sim-heat-${b}-${w}`}>
                            {c && c.allocated > 0 ? (util * 100).toFixed(0) : ""}
                            {full && <span className={styles.pin} title="满载 · 挤压点（联合求解在此产生被挤单）">满</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className={styles.summary}>
                色阶 冷蓝→暖红 按占用率（&lt;50% / &lt;80% / &lt;95% / 满载）· 「满」= 挤压点，联合求解在此产生被挤单（下方卡②逐单可溯）。
              </div>
            </div>
          ) : (
            <div className={styles.empty}>{res.isFetching ? "求解中…" : "加载订单与产能中…"}</div>
          )}
        </div>

        {/* ————— 右侧：磨砂卡① 联合求解配置 ————— */}
        <div>
          <div className={styles.glass}>
            <span className={styles.grpLabel}>[ 联合求解配置 ]</span>

            {/* 对比方案（目标切换 = 多方案对比） */}
            <div className={styles.scenPicks} data-testid="global-sim-scens">
              <span className={styles.textMuted} style={{ fontSize: 11 }}>对比方案：</span>
              {ALL_SCENARIOS.map((k) => (
                <label key={k} className={styles.scenChk} data-testid={`global-sim-scen-${k}`}>
                  <input type="checkbox" checked={scenSet.includes(k)} onChange={() => toggleScen(k)} /> {SCEN_LABEL[k]}
                </label>
              ))}
            </div>

            {/* 订单集 + 冻结集 */}
            <div style={{ marginTop: 12, maxHeight: 220, overflow: "auto" }}>
              <table className={styles.gtable} data-testid="global-sim-orders">
                <thead><tr><th>纳入</th><th>冻结</th><th>订单</th><th>客户</th><th>型号</th><th style={{ textAlign: "right" }}>数量(套)</th><th>交期</th></tr></thead>
                <tbody>
                  {orderList.map((o) => (
                    <tr key={o.id} data-testid={`global-sim-order-${o.id}`}>
                      <td><input type="checkbox" checked={effectiveSelected.has(o.id)} onChange={() => toggleSel(o.id)} data-testid={`global-sim-include-${o.id}`} /></td>
                      <td><input type="checkbox" checked={frozen.has(o.id)} onChange={() => toggleFrozen(o.id)} data-testid={`global-sim-freeze-${o.id}`} /></td>
                      <td className="mono">{o.id}</td><td>{o.cust}</td><td className="mono">{o.model}</td><td className="num">{fmt(o.qty, 0)}</td><td className="mono">{o.due}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 求解结果读数 */}
            {d && primaryScen && (
              <>
                <div className={styles.readoutRow} data-testid="global-sim-readout">
                  <div className={styles.readout}><b>{ontimeRate.toFixed(0)}%</b><span>按期率（{SCEN_LABEL[primary]}）</span></div>
                  <div className={styles.readout}><b>{fmt(d.cost.total, 0)}</b><span>总代价</span></div>
                  <div className={styles.readout}><b>{fmt(primaryScen.objectiveValues.changeover, 0)}</b><span>换型次数</span></div>
                  <div className={styles.readout}><b>{primaryScen.displacedCount}</b><span>被挤单</span></div>
                  <div className={styles.readout}><b>{d.frozen.length}</b><span>冻结单</span></div>
                </div>

                {/* 方案对比矩阵（改目标 → 分配与各目标值真漂移·吸收方案对比） */}
                <span className={styles.grpLabel} style={{ marginTop: 8 }}>[ 方案对比矩阵 ]</span>
                <table className={styles.gtable} data-testid="global-sim-matrix">
                  <thead><tr><th>方案</th><th>获排</th><th>被挤</th><th style={{ textAlign: "right" }}>获排量</th><th style={{ textAlign: "right" }}>按期</th><th style={{ textAlign: "right" }}>延误量</th><th style={{ textAlign: "right" }}>换型</th><th style={{ textAlign: "right" }}>代价</th></tr></thead>
                  <tbody>
                    {d.scenarios.map((s) => (
                      <tr key={s.key} data-testid={`global-sim-scen-row-${s.key}`} style={s.key === primary ? { background: "rgba(108,123,246,0.1)" } : undefined}>
                        <td><strong className={styles.textPrimary}>{SCEN_LABEL[s.key] ?? s.key}</strong></td>
                        <td className="num">{s.servedCount}</td><td className="num">{s.displacedCount}</td><td className="num">{fmt(s.servedQty, 0)}</td>
                        <td className="num">{fmt(s.objectiveValues.ontime, 0)}</td><td className="num">{fmt(s.objectiveValues.delay, 0)}</td>
                        <td className="num">{fmt(s.objectiveValues.changeover, 0)}</td><td className="num">{fmt(s.objectiveValues.cost, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className={styles.actions}>
                  <button className={styles.btnPrimary} data-testid="global-sim-solve" disabled={res.isFetching} onClick={() => setNonce((n) => n + 1)}>
                    {res.isFetching ? "求解中…" : "发起联合求解"}
                  </button>
                  <button className={styles.btnGhost} data-testid="global-sim-adopt" disabled={adopt.isPending} onClick={onAdopt} title="采纳 → 生成 plan_change Action 草稿（走 S2 审批·不直改排产真值 R4）">
                    {adopt.isPending ? "生成草稿中…" : "采纳方案（→ Action 审批）"}
                  </button>
                </div>
              </>
            )}
            {res.error ? <div className={styles.noteRed}>求解失败：{String(res.error?.message ?? "")}</div> : null}
          </div>

          {/* ————— 磨砂卡② 被挤单 / 冻结单卡（双向下钻） ————— */}
          {d && (
            <div className={styles.glass}>
              <span className={styles.grpLabel}>[ 被挤单 / 冻结单 · 进项目推演细排 ]</span>
              <div className={styles.cardGrid} data-testid="global-sim-displaced">
                {d.displaced.length ? d.displaced.map((x) => (
                  <div key={x.orderId} className={`${styles.orderCard} ${styles.displaced}`} data-testid={`global-sim-displaced-${x.orderId}`} title={provTitle(x.provenance)}>
                    <strong>{x.orderId}</strong>（{x.kind === "forecast" ? "预测" : x.kind === "wip" ? "在产" : x.model}）<br />
                    <span className="amt">{fmt(x.qty, 0)}</span> 套 · 未获排
                    <DrillAffordance kind={x.kind} id={x.orderId} label="进项目推演细排 →" testId={`global-sim-drill-${x.orderId}`} prov={x.provenance} />
                  </div>
                )) : <span className={styles.empty}>全部需求项获排（无被挤）</span>}
              </div>

              {d.frozen.length > 0 && (
                <div className={styles.cardGrid} data-testid="global-sim-frozen" style={{ marginTop: 10 }}>
                  {d.frozen.map((f) => (
                    <div key={f.orderId} className={`${styles.orderCard} ${styles.frozen}`} data-testid={`global-sim-frozen-${f.orderId}`}>
                      <strong>{f.orderId}</strong>（冻结·产能预扣）<br />{f.base} · 窗口{f.window} · <span className="amt">{fmt(f.qty, 0)}</span> 套
                      <Link className={styles.drillLink} to={`/v/project-sim?order=${encodeURIComponent(f.orderId)}`} data-testid={`global-sim-drill-${f.orderId}`}>进项目推演细排 →</Link>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ————— 联合分配台账 + 共享产能守恒台账（全宽磨砂卡） ————— */}
      {d && (
        <div className={styles.glass}>
          <span className={styles.grpLabel}>[ 联合分配台账 · 主方案 {SCEN_LABEL[primary]}（基地 × 时间窗 · provenance 悬浮） ]</span>
          <table className={styles.gtable} data-testid="global-sim-alloc">
            <thead><tr><th>需求项</th><th>来源</th><th>基地</th><th>窗口</th><th style={{ textAlign: "right" }}>量(套)</th><th style={{ textAlign: "right" }}>延误(天)</th><th /></tr></thead>
            <tbody>
              {d.allocation.map((a) => (
                <tr key={`${a.item}-${a.base}-${a.window}`} data-testid={`global-sim-alloc-${a.item}`} title={provTitle(a.provenance)}>
                  <td className="mono">{a.item}</td>
                  <td>{a.committed ? "在产承诺" : a.kind === "forecast" ? "预测" : "订单"}</td>
                  <td>{a.baseName}</td><td className="num">{a.window}</td><td className="num">{fmt(a.qty, 0)}</td>
                  <td className={`num ${a.onTime ? styles.ok : styles.bad}`}>{a.onTime ? "按期" : fmt(a.delayDays, 0)}</td>
                  <td><DrillAffordance kind={a.kind} id={a.item} label="细排 →" testId={`global-sim-alloc-drill-${a.item}`} prov={a.provenance} /></td>
                </tr>
              ))}
            </tbody>
          </table>

          <span className={styles.grpLabel} style={{ marginTop: 14 }}>[ 共享产能守恒台账 · 逐格 allocated ≤ 净cap · 无重复占用 ]</span>
          <table className={styles.gtable} data-testid="global-sim-ledger">
            <thead><tr><th>基地</th><th>窗口</th><th style={{ textAlign: "right" }}>净产能</th><th style={{ textAlign: "right" }}>已分配</th><th>守恒</th></tr></thead>
            <tbody>
              {d.capacityLedger.filter((c) => c.allocated > 0).map((c) => (
                <tr key={`${c.baseId}-${c.window}`} data-testid={`global-sim-ledger-${c.baseId}-${c.window}`}>
                  <td>{matrix?.baseName.get(c.baseId) ?? c.baseId}</td><td className="num">{c.window}</td><td className="num">{fmt(c.cap, 0)}</td><td className="num">{fmt(c.allocated, 0)}</td>
                  <td className={c.allocated <= c.cap ? styles.ok : styles.bad}>{c.allocated <= c.cap ? "✓" : "✗"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className={styles.summary} data-testid="global-sim-summary">{d.summary}</div>
        </div>
      )}

      {/* ————— 迁入：多目标 + 跨对象占用联合 what-if（本是全局能力·从项目推演去重迁此） ————— */}
      <div className={`${styles.glass} ${styles.migrated}`}>
        <span className={styles.grpLabel}>[ 多目标联合 what-if · 跨对象占用（opt.multiobj） ]</span>
        <MultiObjWhatifPanel />
      </div>
    </div>
  );
}
