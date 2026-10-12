import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SEG_REGISTRY } from "@platform/contracts";
import { fmt, useActionDraft } from "./shared";
import { toast } from "@/store/toastStore";
import styles from "./GlobalSimView.module.css";

/**
 * WO-GSIM-3 · 区⑦ 底栏客户级影响——被挤单 → **真客户名 + 应用细分 + 交付地 + 产线 + 影响额**（R13/R14·零杜撰）。
 *
 * 真源：被挤单 orderId 反查 portfolio.displaced（真联合解产物）× 视图已加载的真 Order 对象
 *   （cust/model/qty/bases 全读 o.props·真客户名如广汽/长安/国家电网…来自真 order·非内联）。
 * 应用细分按客户名判定（PRD §4.5-B segOfCust）：含"商用车"→com·含"储能/电网"→ess·否则 pas；
 * 影响额(亿) = qty(套) × SEG_REGISTRY.priceWan(万元/套) ÷ 1e4（G-UNIT-NORMALIZE 统一口径·SEG 价单一来源）。
 *
 * ⑥ G-UI-3 · 去死按钮（客户卡 click → 真项目详情 + 死按钮改真动作）：
 *   ① 整卡 click → 跳该客户项目详情 `/v/project-sim?order=<orderId>`（真路由·真数据一致·ProjectSimView 按 ?order= 反查真 Order）；
 *   ② 原「协调加产」占位死按钮 → 改「预览 → 确认 → plan_change 草稿」真动作（预览 Modal 显 订单/客户/数量/影响额/意图，
 *      确认才创建草稿·走 S2 审批·R4 不静默写真值）。plan_change 非 global-sim payload **必带 versionId + reason**
 *      （否则后端 VALIDATION_ERROR·真 bug 修）；确定性 versionId 含 sessionId + orderId。
 * ② G-UI-2 · 每单显示交付基地 + 产线（真 Line 对象·经 lineNameOf 派生·非占位）。
 */

export interface OrderVM { id: string; cust: string; model: string; qty: number; due: string; base?: string; homeBase?: string; objId?: string }
export interface DisplacedVM { orderId: string; kind: string; qty: number; model?: string }

/** 应用细分标签取自 SEG_REGISTRY（单一来源·非内联·R14）。 */
const segLabelOf = (segKey: string): string => SEG_REGISTRY.find((s) => s.key === segKey)?.seg ?? segKey;
const priceWanOf = (segKey: string): number => SEG_REGISTRY.find((s) => s.key === segKey)?.priceWan ?? 0;
/** 客户名→应用细分关键词（PRD §4.5-B·按客户名判定·替代按型号）。判定关键词是业务规则兜底。 */
const COM_KW = ["商用车", "客车", "重工", "Leyland"]; // debattery-allow：segOfCust 商用车判定关键词（业务规则·非展示常数）
const ESS_KW = ["储能", "电网", "电力", "电投"]; // debattery-allow：segOfCust 储能判定关键词（业务规则·非展示常数）
function segKeyOfCust(cust: string): "pas" | "ess" | "com" {
  if (COM_KW.some((k) => cust.includes(k))) return "com";
  if (ESS_KW.some((k) => cust.includes(k))) return "ess";
  return "pas";
}

interface ImpactRow {
  orderId: string; cust: string; model: string; qty: number;
  segLabel: string; segColor: string; deliverTo: string; deliverLine: string; impactYi: number; traceable: boolean;
  /** 被挤单的本体对象 id（`repos.objects` 主键·非 so）与整单量——协调加产杠杆映射的两个输入。 */
  objId?: string; totalQty: number;
}

/**
 * WO-PLAN-CHANGE-LEVER-MAP · 协调加产的**真域映射**（G-PLAN-CHANGE-NO-LEVER 收编①）。
 *
 * 「协调产能承接以消减被挤影响」此前只是 payload 里的 `intent` 字符串——不是任何对象的属性，
 * 审批通过后零落点（诚实失败）。真映射 = `Order.outsourceRatio`（注册杠杆·LEVER_PROP_META 在册·
 * C08 红线/vle 扫描真消费）：**联合解挤不出的那部分量转外协**，外协占比 = 被挤套数 ÷ 整单套数
 * （0–1 比率·与 LEVER_PROP_META `kind:"ratio"` 同轴·封顶 1 = 整单外协）。
 * 两个输入都来自真数据：被挤量 = portfolio 联合解 displaced.qty，整单量 = 真 Order 对象 qty。
 *
 * 诚实边界：反查不到真 Order 对象（objId/totalQty 缺）或被挤量为 0 ⇒ **不发 levers**，
 * 落回既有的诚实失败（EXECUTOR_NOT_IMPLEMENTED·列出收到的键）——绝不猜一个值写下去。
 */
function coordLevers(r: ImpactRow): { objectType: string; objectId: string; prop: string; value: number }[] {
  if (!r.objId || !(r.totalQty > 0) || !(r.qty > 0)) return [];
  const ratio = Math.min(1, Math.round((r.qty / r.totalQty) * 1e4) / 1e4);
  if (!(ratio > 0)) return [];
  return [{ objectType: "Order", objectId: r.objId, prop: "outsourceRatio", value: ratio }];
}

export function CustomerImpactBar({ displaced, orders, lineNameOf, sessionId }: { displaced: DisplacedVM[]; orders: OrderVM[]; lineNameOf?: (baseId: string) => string; sessionId?: string }) {
  const navigate = useNavigate();
  const adopt = useActionDraft();
  // ⑥ 协调加产预览 Modal（预览 → 确认 → 草稿·非点了即提交的鲁莽/死按钮）。
  const [preview, setPreview] = useState<ImpactRow | null>(null);
  const confirmCoordinate = (r: ImpactRow) => {
    // plan_change 非 global-sim payload → **必带 versionId + reason**（后端 paramsSchema required·缺则 VALIDATION_ERROR）。
    // WO-PLAN-CHANGE-LEVER-MAP：带上真杠杆映射（见 coordLevers 头注）→ 审批通过后走 applyLeverWrites 真落库，
    // 不再诚实失败。判据在 payload **形状**（{objectId,prop,value}），不在 source/intent 串。
    const levers = coordLevers(r);
    adopt.mutate({
      actionTypeKey: "plan_change",
      payload: {
        intent: "coordinate_capacity", orderId: r.orderId, cust: r.cust, seg: r.segLabel, qty: r.qty, impactYi: r.impactYi,
        versionId: `global-sim-impact:${sessionId ?? "anon"}:${r.orderId}`,
        reason: `协调加产：为 ${r.orderId}（${r.cust}）协调产能以消减被挤单影响`,
        ...(levers.length ? { levers } : {}),
      },
    });
    setPreview(null);
    toast("已生成协调加产草稿 → S2 审批", "success");
  };
  const rows = useMemo<ImpactRow[]>(() => {
    const orderById = new Map(orders.map((o) => [o.id, o]));
    return displaced
      .filter((d) => d.kind === "order") // 只对销售订单归因客户（WIP/预测无客户主体·诚实不编）
      .map((d) => {
        const o = orderById.get(d.orderId);
        const cust = o?.cust ?? "";
        const segKey = segKeyOfCust(cust);
        const qty = d.qty || o?.qty || 0;
        const segMeta = SEG_REGISTRY.find((s) => s.key === segKey);
        const homeBase = o?.homeBase ?? o?.base ?? "";
        return {
          orderId: d.orderId,
          cust: cust || "（未匹配到订单·客户未知）",
          model: o?.model ?? d.model ?? "—",
          qty,
          segLabel: segLabelOf(segKey),
          segColor: segMeta?.color ?? "var(--muted)",
          deliverTo: o?.base ?? "—",
          // ② 产线（真 Line 对象·经 lineNameOf 派生·非占位）。
          deliverLine: lineNameOf && homeBase ? lineNameOf(homeBase) : "—",
          impactYi: Math.round((qty * priceWanOf(segKey)) / 1e4 * 1000) / 1000,
          traceable: !!o, // 可溯真 order（反查命中）
          // 协调加产杠杆映射输入：本体对象 id（非 so）+ 整单量（分母）。
          objId: o?.objId,
          totalQty: Number(o?.qty ?? 0),
        };
      })
      .sort((a, b) => b.impactYi - a.impactYi || a.orderId.localeCompare(b.orderId));
  }, [displaced, orders, lineNameOf]);

  const totalYi = Math.round(rows.reduce((s, r) => s + r.impactYi, 0) * 1000) / 1000;

  return (
    <div className={styles.glass} data-testid="global-sim-customer-impact">
      <span className={styles.grpLabel}>[ 客户级影响 · 被挤单 → 真客户 / 应用细分 / 交付地 / 影响额 ]</span>
      {rows.length === 0 ? (
        <div className={styles.empty} data-testid="global-sim-impact-empty">当前联合解无被挤订单（全部订单获排·无客户受影响）</div>
      ) : (
        <>
          <div className={styles.cardGrid} data-testid="global-sim-impact-list">
            {rows.map((r) => {
              const to = `/v/project-sim?order=${encodeURIComponent(r.orderId)}`;
              return (
                // ⑥ G-UI-3 · 整卡 click → 该客户项目详情（真路由·ProjectSimView 按 ?order= 反查真 Order·数据一致）。
                <div
                  key={r.orderId}
                  className={`${styles.orderCard} ${styles.displaced}`}
                  data-testid={`global-sim-impact-${r.orderId}`}
                  data-impact-link={to}
                  role="link"
                  tabIndex={0}
                  style={{ cursor: "pointer" }}
                  title={`进 ${r.cust} 项目详情（${r.orderId}）→ 逐单细排·真数据一致`}
                  onClick={() => navigate(to)}
                  onKeyDown={(e) => { if (e.key === "Enter") navigate(to); }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <strong data-testid={`global-sim-impact-cust-${r.orderId}`}>{r.cust}</strong>
                    <span className={styles.segChip} style={{ borderColor: r.segColor, color: r.segColor }}>{r.segLabel}</span>
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12, color: "var(--muted)" }}>
                    {r.orderId} · {r.model} · <span className="amt">{fmt(r.qty, 0)}</span> 套未获排
                  </div>
                  <div style={{ marginTop: 3, fontSize: 12 }}>
                    {/* ② 交付基地 + 产线（真数据·非占位） */}
                    交付地 {r.deliverTo} · 产线 <span className="mono" data-testid={`global-sim-impact-line-${r.orderId}`}>{r.deliverLine}</span> · 影响额 <b className={styles.textPrimary} data-testid={`global-sim-impact-yi-${r.orderId}`}>{r.impactYi.toFixed(2)}</b> 亿
                    {!r.traceable && <span className={styles.textMuted}> · 未溯到订单</span>}
                  </div>
                  <div style={{ marginTop: 6, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: "var(--accent-txt)", fontWeight: 600 }} data-testid={`global-sim-impact-goto-${r.orderId}`}>进 {r.cust} 项目详情 →</span>
                    {/* ⑥ 死按钮改真动作：预览 → 确认 → plan_change 草稿（stopPropagation 不触发整卡跳转）。 */}
                    <button
                      className={styles.btnGhost}
                      data-testid={`global-sim-impact-coord-${r.orderId}`}
                      style={{ fontSize: 12, padding: "2px 8px" }}
                      title="预览 → 确认 → 生成协调加产 plan_change 草稿（S2 审批·不直接写真值）"
                      onClick={(e) => { e.stopPropagation(); setPreview(r); }}
                    >
                      协调加产…
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className={styles.summary} data-testid="global-sim-impact-summary">
            被挤订单合计影响额 <b className={styles.textPrimary}>{totalYi.toFixed(2)}</b> 亿（Σqty×SEG 价÷1e4·真客户名来自订单对象·可溯真 order·R13）·
            点客户卡 → 跳该客户项目详情（真路由 /v/project-sim?order=·数据一致）；「协调加产」预览 → 确认 → plan_change 草稿（S2 审批·R4）。
          </div>
          {/* ⑥ 协调加产预览 Modal（预览 → 确认 → 草稿·非鲁莽死按钮·带 versionId/reason） */}
          {preview && (
            <div
              data-testid="global-sim-coord-preview"
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }}
              onClick={() => setPreview(null)}
            >
              <div className={styles.glass} style={{ maxWidth: 420, width: "90%" }} onClick={(e) => e.stopPropagation()}>
                <span className={styles.grpLabel}>[ 协调加产 · 预览确认（生成 plan_change 草稿 → S2 审批） ]</span>
                <table className={styles.gtable} style={{ marginTop: 8 }}>
                  <tbody>
                    <tr><td>订单</td><td className="mono" data-testid="global-sim-coord-order">{preview.orderId}</td></tr>
                    <tr><td>客户</td><td data-testid="global-sim-coord-cust">{preview.cust}</td></tr>
                    <tr><td>应用细分</td><td>{preview.segLabel}</td></tr>
                    <tr><td>数量(套)</td><td className="num">{fmt(preview.qty, 0)}</td></tr>
                    <tr><td>影响额(亿)</td><td className="num">{preview.impactYi.toFixed(2)}</td></tr>
                    <tr><td>协调意图</td><td>协调产能承接以消减该单被挤影响</td></tr>
                  </tbody>
                </table>
                <div className={styles.actions} style={{ marginTop: 10 }}>
                  <button className={styles.btnPrimary} data-testid="global-sim-coord-confirm" disabled={adopt.isPending} onClick={() => confirmCoordinate(preview)}>
                    {adopt.isPending ? "生成草稿中…" : "确认 → 生成草稿"}
                  </button>
                  <button className={styles.btnGhost} data-testid="global-sim-coord-cancel" onClick={() => setPreview(null)}>取消</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
