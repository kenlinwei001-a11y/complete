import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SliceLayer, SliceLayerId, SliceLayersResponse } from "@platform/contracts";
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

/**
 * 「子图没解出来」的诚实条 —— 复核补的一块（真后端实测驱动）。
 *
 * 病根：98 条切片里 12 条无参调用即空子图，而这 12 条里**恰好包含首屏默认只显示的
 * 那 4 条多跳业务切片**（它们的 root selector 写着 `{{args.so}}` / `{{args.key}}`）。
 * 不给参数 ⇒ 十六层全空。若不先说清楚，十六张空卡会被读成「平台没有这些层」——
 * 与审计 §1.2 那个误判一模一样，只是换了个位置复发。
 *
 * 第一层放：短结论（缺什么）+ 状态徽标 + **真实候选值**（后端从真对象上读出来的，
 * 点一下即试切）。长因由降到 ⚠ 浮层，但第一层留记号（规范 §1：静默降层等于删除）。
 */
function EmptyGraphBar({
  sliceKey,
  empty,
  rootType,
  onPick,
}: {
  sliceKey: string;
  empty: NonNullable<SliceLayersResponse["graph"]["empty"]>;
  rootType: string;
  onPick: (arg: string, value: string) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const title =
    empty.reason === "missing_args"
      ? t.empty.titleMissingArgs
      : empty.reason === "no_root_objects"
        ? t.empty.titleNoRootObjects
        : t.empty.titleNoMatch;
  return (
    <div className={styles.emptyBar} data-testid={`slice-layers-empty-${sliceKey}`}>
      <div className={styles.emptyHead}>
        <span className={styles.emptyTitle} data-testid={`slice-layers-empty-title-${sliceKey}`}>
          {title}
        </span>
        <span className="badge amber">{t.empty.badge}</span>
        {empty.requiredArgs.length > 0 && (
          <span className={styles.emptyMeta}>{t.empty.needArgs(empty.requiredArgs.join("、"))}</span>
        )}
        <span className={styles.emptyMeta}>{t.empty.rootTotal(rootType, empty.rootObjectTotal)}</span>
        {/* 诚实位记号：完整因由在浮层，第一层看得见「这里有话要说」。 */}
        <WhyPopover label={t.empty.whyLabel} marked testId={`slice-layers-empty-why-${sliceKey}`}>
          <span className={styles.popSec}>
            <span className={styles.popTitle}>{t.empty.whyLabel}</span>
            <span data-testid={`slice-layers-empty-message-${sliceKey}`}>{empty.message}</span>
          </span>
        </WhyPopover>
      </div>

      {/* 候选值：**值来自真 root 对象**（后端 argCandidates），不是编的示例。
          取不到就明说取不到 —— 宁可留白也不拿假值凑。 */}
      {empty.argCandidates.map((c) => (
        <div key={c.arg} className={styles.emptyPick}>
          <span className={styles.emptyPickLabel}>{t.empty.pickLabel(c.arg)}</span>
          {c.values.length === 0 ? (
            <span className={styles.emptyPickLabel} data-testid={`slice-layers-nocand-${sliceKey}-${c.arg}`}>
              {t.empty.noCandidates}
            </span>
          ) : (
            c.values.map((v) => (
              <button
                key={v}
                type="button"
                className={styles.candBtn}
                data-testid={`slice-layers-cand-${sliceKey}-${c.arg}-${v}`}
                onClick={() => onPick(c.arg, v)}
              >
                {v}
              </button>
            ))
          )}
          <label className={styles.emptyPickLabel}>
            {t.empty.inputLabel(c.arg)}
            <input
              className={styles.candInput}
              data-testid={`slice-layers-arginput-${sliceKey}-${c.arg}`}
              value={draft[c.arg] ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, [c.arg]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (draft[c.arg] ?? "") !== "") onPick(c.arg, draft[c.arg]!);
              }}
              style={{ marginLeft: 4 }}
            />
          </label>
          <button
            type="button"
            className="btn sm"
            data-testid={`slice-layers-argapply-${sliceKey}-${c.arg}`}
            disabled={(draft[c.arg] ?? "") === ""}
            onClick={() => onPick(c.arg, draft[c.arg] ?? "")}
          >
            {t.empty.apply}
          </button>
        </div>
      ))}
    </div>
  );
}

export default function SliceLayersPanel({ sliceKey, args = {} }: { sliceKey: string; args?: Record<string, unknown> }) {
  // 页内试切参数：多跳切片的 root selector 要参数，不给就恒空子图（见 EmptyGraphBar 注释）。
  // 外部传入的 args 是基线，页内选的覆盖它——不改调用方，纯加性。
  const [pickedArgs, setPickedArgs] = useState<Record<string, unknown>>({});
  const effectiveArgs = useMemo(() => ({ ...args, ...pickedArgs }), [args, pickedArgs]);
  const argsKey = JSON.stringify(effectiveArgs);
  const q = useQuery({
    queryKey: ["a", "slice-layers", sliceKey, argsKey],
    queryFn: () => fetchSliceLayers(sliceKey, effectiveArgs),
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

      {/* 子图没解出来时，**先说这件事**：否则下面十六张空卡会被读成「平台没有这些层」。 */}
      {graph.empty && (
        <EmptyGraphBar
          sliceKey={sliceKey}
          empty={graph.empty}
          rootType={q.data.rootType}
          onPick={(arg, value) => {
            setPickedArgs((a) => ({ ...a, [arg]: value }));
            setOpenLayer(null);
          }}
        />
      )}
      {/* 已试切：把当前生效参数显式摆在第一层（不显示 = 用户不知道自己在看哪个 root 的切片）。 */}
      {Object.keys(pickedArgs).length > 0 && (
        <div className={styles.appliedBar} data-testid={`slice-layers-applied-${sliceKey}`}>
          <span>{t.empty.applied(Object.entries(pickedArgs).map(([k, v]) => `${k}=${String(v)}`).join(" · "))}</span>
          <button type="button" className="btn sm" data-testid={`slice-layers-clearargs-${sliceKey}`} onClick={() => setPickedArgs({})}>
            {t.empty.clear}
          </button>
        </div>
      )}

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
                  // 卡片是 div 而非 button —— 浮层触发器本身是 <button>，button 套 button 是非法 DOM
                  // 嵌套（React validateDOMNesting 会警告，且键盘可达性会坏）。故卡片主体一个 button，
                  // 浮层记号是它的兄弟节点，绝对定位到右上角。
                  <div key={id} className={styles.card} data-expanded={expanded ? "true" : "false"}>
                    <button
                      type="button"
                      className={styles.cardMain}
                      aria-expanded={expanded}
                      data-testid={`slice-layer-card-${sliceKey}-${id}`}
                      onClick={() => setOpenLayer((k) => (k === id ? null : id))}
                    >
                      <span className={styles.cardTop}>
                        <span className={styles.ord}>{l.ordinal}</span>
                        <span className={styles.name}>{t.names[id] ?? id}</span>
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
                        {l.status === "not_in_slice" && l.platformCount !== undefined && ` · ${t.platformHas(l.platformCount, l.unit)}`}
                      </span>
                    </button>
                    {/* 诚实位记号：口径/缺席原因降到了浮层，但第一层看得见「这里有话要说」
                        （规范 §1：静默降层等于删除）。 */}
                    <span className={styles.cardMarkSlot}>
                      <WhyPopover
                        label={t.whyLabel}
                        marked={l.status !== "present"}
                        testId={`slice-layer-why-${sliceKey}-${id}`}
                      >
                        <span className={styles.popSec}>
                          <span className={styles.popTitle}>{t.carrierLabel}</span>
                          <span className={styles.carrier}>{l.carrier}</span>
                        </span>
                        {l.absentReason && (
                          <span className={styles.popSec}>
                            <span className={styles.popTitle}>{t.reasonLabel}</span>
                            <span>{l.absentReason}</span>
                          </span>
                        )}
                      </WhyPopover>
                    </span>
                  </div>
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
