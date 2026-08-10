import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SliceLayer, SliceLayerId } from "@platform/contracts";
import { fetchSliceLayers } from "@/api/endpoints";
import zh from "@/locales/zh";
import styles from "./SliceLayersPanel.module.css";

const t = zh.admin.sliceLayers;

/**
 * WO-SLICE-16-LAYERS · 本体切片的「十六层结构」浏览器。
 *
 * 数据全部来自 `GET /a/v1/ontology/slices/{key}/layers`（真后端投影，见
 * docs/AUDIT-slice-16-layers.md）。**页面不持有任何常数计数** —— 每个数字都是后端返回值，
 * 接缝测试即断言这一点（界面上的层计数 == 响应里的 count，改了响应界面必须跟着变）。
 *
 * 信息分层（docs/CONVENTION-ui-information-layering.md）：
 *   第一层：`12/16 层有数据` 这个数 + 每层「名 + 计数 + 状态」——别的一律不放；
 *   第二层：点层卡展开明细表；
 *   浮层：承载物 / 缺席原因 / 口径（诚实位降层，但第一层留 `?` 记号，不静默删除）。
 *
 * 三态而非二值（审计 §3.3）：把「平台有 372 条但这条切片没纳入」和「平台没有」
 * 混成一个"无"，正是此前把 ⑥事件 误判成"缺失"的来源。
 */

/** 十六层的自然递进分带（§3：结构本身也要表达）。顺序 = 推导方向，箭头即"谁推出谁"。 */
const BANDS: { label: string; ids: SliceLayerId[] }[] = [
  { label: "为什么看", ids: ["business_scenario", "decision_intent"] },
  { label: "是什么", ids: ["object", "property", "relation"] },
  { label: "怎么变", ids: ["event", "state", "metric", "time"] },
  { label: "受什么管", ids: ["rule", "constraint"] },
  { label: "凭什么", ids: ["data_binding", "scenario", "evidence"] },
  { label: "然后做什么", ids: ["action", "governance"] },
];

const STATUS_LABEL: Record<SliceLayer["status"], string> = {
  present: t.statusPresent,
  not_in_slice: t.statusNotInSlice,
  absent: t.statusAbsent,
};
const NUM_CLASS: Record<SliceLayer["status"], string> = {
  present: styles.numPresent!,
  not_in_slice: styles.numNotInSlice!,
  absent: styles.numAbsent!,
};

/**
 * 口径浮层。两个继承来的坑（WO-SANDBOX-DECLUTTER 实测）：
 *  ① onClick 必须幂等 `setOpen(true)`，**不能取反** —— 取反 + 外层点击关闭会互相抵消，点了没反应；
 *  ② 必须戴 `popover-surface` 类，**不自写 background** —— 自写的半透背景会让底下正文透上来（欠账 #104）。
 */
function WhyPopover({ label, marked, children, testId }: { label: string; marked?: boolean; children: React.ReactNode; testId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className={styles.popWrap}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className={`${styles.mark} ${marked ? styles.markWarn : ""}`}
        data-testid={testId}
        aria-label={label}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true); // 幂等，不取反
        }}
      >
        {marked ? "⚠" : "?"}
      </button>
      {open && (
        <span className={`popover-surface ${styles.pop}`} role="tooltip" data-testid={`${testId}-pop`} onClick={(e) => e.stopPropagation()}>
          {children}
        </span>
      )}
    </span>
  );
}

export default function SliceLayersPanel({ sliceKey, args = {} }: { sliceKey: string; args?: Record<string, unknown> }) {
  const argsKey = JSON.stringify(args);
  const q = useQuery({
    queryKey: ["a", "slice-layers", sliceKey, argsKey],
    queryFn: () => fetchSliceLayers(sliceKey, args),
  });
  const [openLayer, setOpenLayer] = useState<SliceLayerId | null>(null);

  const byId = useMemo(() => {
    const m = new Map<SliceLayerId, SliceLayer>();
    for (const l of q.data?.layers ?? []) m.set(l.id, l);
    return m;
  }, [q.data]);

  if (q.isLoading) return <div className="empty-state" data-testid={`slice-layers-loading-${sliceKey}`}>{t.loading}</div>;
  if (q.error || !q.data) return <div className="badge red" data-testid={`slice-layers-error-${sliceKey}`}>{t.error}</div>;

  const { summary, graph, layers } = q.data;
  const active = openLayer ? byId.get(openLayer) : undefined;

  return (
    <div className={styles.wrap} data-testid={`slice-layers-${sliceKey}`}>
      {/* ── 第一层：本页要回答的那个数 ─────────────────────────────────────── */}
      <div className={styles.headline}>
        <span className={styles.headlineNum} data-testid={`slice-layers-headline-${sliceKey}`}>
          {t.headline(summary.present)}
        </span>
        <span className={styles.headlineSub} data-testid={`slice-layers-summary-${sliceKey}`}>
          {t.summaryLine(summary.present, summary.notInSlice, summary.absent)}
        </span>
        <span className={styles.headlineMeta} data-testid={`slice-layers-graph-${sliceKey}`}>
          {t.graphSummary(graph.nodes, graph.edges)}
          {graph.truncated && <span className="badge amber" style={{ marginLeft: 6 }}>{t.truncated}</span>}
        </span>
      </div>
      <div className={styles.honesty}>{t.honesty}</div>

      {/* ── 第一层：十六层按递进带排（不平铺，箭头表达方向） ───────────────── */}
      {BANDS.map((band, bi) => (
        <div key={band.label}>
          {bi > 0 && <div className={styles.bandArrow} aria-hidden="true">↓</div>}
          <div className={styles.band}>
            <div className={styles.bandLabel}>{band.label}</div>
            <div className={styles.cards}>
              {band.ids.map((id) => {
                const l = byId.get(id);
                if (!l) return null;
                const expanded = openLayer === id;
                return (
                  <button
                    key={id}
                    type="button"
                    className={styles.card}
                    aria-expanded={expanded}
                    data-testid={`slice-layer-card-${sliceKey}-${id}`}
                    onClick={() => setOpenLayer((k) => (k === id ? null : id))}
                  >
                    <span className={styles.cardTop}>
                      <span className={styles.ord}>{l.ordinal}</span>
                      <span className={styles.name}>{t.names[id] ?? id}</span>
                      {/* 诚实位记号：说明降到了浮层，但第一层看得见「这里有话要说」。 */}
                      <WhyPopover
                        label={t.whyLabel}
                        marked={l.status !== "present"}
                        testId={`slice-layer-why-${sliceKey}-${id}`}
                      >
                        <span className={styles.popSec}>
                          <span className={styles.popTitle}>{t.carrierLabel}</span>
                          <div className={styles.carrier}>{l.carrier}</div>
                        </span>
                        {l.absentReason && (
                          <span className={styles.popSec}>
                            <span className={styles.popTitle}>{t.reasonLabel}</span>
                            <div>{l.absentReason}</div>
                          </span>
                        )}
                      </WhyPopover>
                    </span>
                    {/* 数值本身 + 单位（裸数会被读成层数/跳数 —— WO-UNIT-MEANING 同口径） */}
                    <span>
                      <span className={`${styles.num} ${NUM_CLASS[l.status]}`} data-testid={`slice-layer-count-${sliceKey}-${id}`}>
                        {l.count}
                      </span>
                      <span className={styles.unit}>{l.unit}</span>
                    </span>
                    <span className={styles.statusLine} data-testid={`slice-layer-status-${sliceKey}-${id}`}>
                      {STATUS_LABEL[l.status]}
                      {l.status === "not_in_slice" && l.platformCount !== undefined && `· ${t.platformHas(l.platformCount, l.unit)}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ))}

      {/* ── 第二层：明细（点开才看） ───────────────────────────────────────── */}
      {active && (
        <div className={styles.detail} data-testid={`slice-layer-detail-${sliceKey}-${active.id}`}>
          <div className={styles.detailHead}>
            <span className={styles.detailTitle}>
              {active.ordinal} · {t.names[active.id] ?? active.id}
            </span>
            <span className="badge" data-testid={`slice-layer-detail-count-${sliceKey}-${active.id}`}>
              {active.count} {active.unit}
            </span>
            <span className={styles.carrier}>
              {t.carrierLabel}：{active.carrier}
            </span>
          </div>

          {/* 缺席态：只说原因，**不渲染任何明细行**（不画占位内容）。 */}
          {active.status !== "present" ? (
            <div className={styles.reason} data-testid={`slice-layer-reason-${sliceKey}-${active.id}`}>
              {active.absentReason}
            </div>
          ) : (
            <div className={styles.scroll}>
              <table className={styles.itemTable}>
                <tbody>
                  {active.items.map((it) => (
                    <tr key={it.key} data-testid={`slice-layer-item-${sliceKey}-${active.id}-${it.key}`}>
                      <td style={{ whiteSpace: "nowrap" }}>{it.label}</td>
                      <td style={{ whiteSpace: "nowrap", color: "var(--muted2)", fontSize: 10.5 }}>{it.group ?? ""}</td>
                      <td className={styles.itemDetail}>{it.detail ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {active.items.length === 0 && <div className="empty-state">{t.emptyItems}</div>}
            </div>
          )}
        </div>
      )}

      {/* 层数守恒的可见证据：后端契约保证恰好 16 层，界面把它显出来（少一层立刻看得见）。 */}
      <div className={styles.honesty} data-testid={`slice-layers-total-${sliceKey}`}>
        共 {layers.length} 层
      </div>
    </div>
  );
}
