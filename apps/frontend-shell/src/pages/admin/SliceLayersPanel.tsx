import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SliceEmptyGraph, SliceLayer, SliceLayerId, SliceLayersResponse } from "@platform/contracts";
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
 * 实测日期 **2026-08-10**（租户 demo · seed 42 · 起本地 datacore 内存模式）。
 * 复验：`GET /a/v1/ontology/slices` 取全表，逐条打
 * `GET /a/v1/ontology/slices/{key}/layers`（**不带 args**）看 `graph.empty.reason`；
 * 判定实现单源在 `apps/datacore/src/ontology/slice-layers.ts (diagnoseEmptyGraph)`，
 * 占位符正则与 `apps/datacore/src/ontology-core.ts (resolveTemplate)` 一字不差。
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

/**
 * WO-SLICE-DEFAULT-ARGS · **首屏默认实参**（本单要治的那件事）。
 *
 * 病灶（真后端实测 2026-08-10 · demo · seed 42 · 端口 4093 亲手跑）：
 * 本体切片页首屏默认只列 4 条多跳业务切片（`SlicesPage.tsx:39-41` scope="multihop"），
 * 而这 4 条的 root selector 全部写着占位符 ——
 *   `order_fulfillment_360` / `order_to_cash_720` / `enterprise_360` → `{{args.so}}`（battery.ts:2447/2492/2560）
 *   `aop_scenario_chain` → `{{args.key}}`（battery.ts:2601）
 * 而调用侧传的是 **`{}`**（`SliceInspector.tsx` 渲染本面板时不给 args）⇒
 * 「要求的实参集」∩「实际传的实参集」= **空** ⇒ root 过滤恒不匹配 ⇒ 十六层全取不到东西。
 * 实测原文：无参 `nodes=0 edges=0 summary.present=3/16`；给 `{"so":"SO-3391"}` 立刻
 * `nodes=531 edges=570 present=12/16`。**形态是「接了线没数据」，不是「没接线」** ——
 * 所以修的不是接线，是「生产实参」。
 *
 * 修法 **B（默认注入真实实参）**：第一次无参请求拿回后端从**真对象**上读出的候选值
 * （`app.ts:4813-4824` → `slice-layers.ts:107-119`，按 objectKey 字典序去重，R6 确定性），
 * 取第一个作默认实参**立刻重取一次**，并把「当前用的是哪个实参」显式摆在屏上。
 *
 * **零写死（R14）**：本文件不含任何行业实体名。默认值 100% 来自后端候选；
 * 候选取不到（`values` 空 / 非 missing_args）⇒ **不猜、不编**，退回诚实态（修法 C）
 * 让用户自己选/自己填。
 */
export interface LayersWithDefaults {
  data: SliceLayersResponse;
  /** 自动注入的默认实参；null = 没注入（无需 / 取不到真值 / 用户要求看原始态）。 */
  autoArgs: Record<string, string> | null;
  /** 首次（无参）响应里后端给的真实候选值 —— 解出子图后仍要能换 root，故留存。 */
  candidates: SliceEmptyGraph["argCandidates"];
}

export async function fetchLayersWithAutoDefault(
  sliceKey: string,
  baseArgs: Record<string, unknown>,
  autoOff: boolean,
): Promise<LayersWithDefaults> {
  const first = await fetchSliceLayers(sliceKey, baseArgs);
  const empty = first.graph.empty;
  // 只有「缺参数」这一种空才补得上；`no_root_objects`（缺数据）/`no_match`（过滤不中）
  // 补参数没用，硬补就是拿假动作盖住真问题 ⇒ 原样交给诚实态。
  if (!empty || empty.reason !== "missing_args" || autoOff) {
    return { data: first, autoArgs: null, candidates: empty?.argCandidates ?? [] };
  }
  const picks: Record<string, string> = {};
  for (const arg of empty.missingArgs) {
    const v = empty.argCandidates.find((c) => c.arg === arg)?.values[0];
    if (v === undefined) return { data: first, autoArgs: null, candidates: empty.argCandidates }; // 取不到真值 ⇒ 诚实态
    picks[arg] = v;
  }
  const second = await fetchSliceLayers(sliceKey, { ...baseArgs, ...picks });
  // 第二次仍空 ⇒ 照实显示第二次的 empty 原因（可能翻成 no_match），但仍公示用了哪个默认值。
  return { data: second, autoArgs: picks, candidates: empty.argCandidates };
}

export default function SliceLayersPanel({
  sliceKey,
  args = {},
  onRootArgsChange,
}: {
  sliceKey: string;
  args?: Record<string, unknown>;
  /** 把「本面板最终用的那组实参 + 还缺哪些」上报给宿主（内联子图要用同一组，否则两块会互相打脸）。 */
  onRootArgsChange?: (state: { args: Record<string, unknown>; missingArgs: string[] }) => void;
}) {
  // 页内试切参数：多跳切片的 root selector 要参数，不给就恒空子图（见 EmptyGraphBar 注释）。
  // 外部传入的 args 是基线，页内选的覆盖它——不改调用方，纯加性。
  const [pickedArgs, setPickedArgs] = useState<Record<string, unknown>>({});
  // 用户显式「清空参数」= 要看原始诚实态 ⇒ 关掉默认实参，否则清空按钮会被自动默认当场撤销（点了没反应）。
  const [autoOff, setAutoOff] = useState(false);
  const baseArgs = useMemo(() => ({ ...args, ...pickedArgs }), [args, pickedArgs]);
  const baseArgsKey = JSON.stringify(baseArgs);
  const q = useQuery({
    queryKey: ["a", "slice-layers", sliceKey, baseArgsKey, autoOff],
    queryFn: () => fetchLayersWithAutoDefault(sliceKey, baseArgs, autoOff),
  });
  const [openLayer, setOpenLayer] = useState<SliceLayerId | null>(null);

  const byId = useMemo(() => {
    const m = new Map<SliceLayerId, SliceLayer>();
    for (const l of q.data?.data.layers ?? []) m.set(l.id, l);
    return m;
  }, [q.data]);

  // 生效实参（含自动默认）+ 仍缺的参数 —— 上报宿主，让内联子图与十六层看同一个 root。
  const effectiveArgs = useMemo(
    () => ({ ...baseArgs, ...(q.data?.autoArgs ?? {}) }),
    [baseArgs, q.data],
  );
  /**
   * 候选值只在「子图为空」的响应里带回来。解出子图之后后端就不再给了 —— 若不留存，
   * 换过一次 root 之后切换器就消失（等于「只能看默认那一个」）。故在组件里记住见过的那份。
   */
  const [knownCandidates, setKnownCandidates] = useState<SliceEmptyGraph["argCandidates"]>([]);
  const candidatesKey = JSON.stringify(q.data?.candidates ?? []);
  useEffect(() => {
    const c = JSON.parse(candidatesKey) as SliceEmptyGraph["argCandidates"];
    if (c.length > 0) setKnownCandidates(c);
  }, [candidatesKey]);

  const effectiveArgsKey = JSON.stringify(effectiveArgs);
  const missingArgsKey = JSON.stringify(q.data?.data.graph.empty?.missingArgs ?? []);
  useEffect(() => {
    onRootArgsChange?.({
      args: JSON.parse(effectiveArgsKey) as Record<string, unknown>,
      missingArgs: JSON.parse(missingArgsKey) as string[],
    });
  }, [effectiveArgsKey, missingArgsKey, onRootArgsChange]);

  if (q.isLoading) return <div className="empty-state" data-testid={`slice-layers-loading-${sliceKey}`}>{t.loading}</div>;
  if (q.error || !q.data) return <div className="badge red" data-testid={`slice-layers-error-${sliceKey}`}>{t.error}</div>;

  const { summary, graph, layers } = q.data.data;
  const active = openLayer ? byId.get(openLayer) : undefined;
  /**
   * **未判定 ≠ 缺席**（本单硬性纪律：「算不了」「查了确实为空」「后端出错」屏上必须分得开）。
   * 子图没解出来时，十六层根本没被算过 —— 此时把 `0 · 缺席` 摆在第一层就是静默错答：
   * 它说的是「查过了，平台没有」，而真相是「压根没查成」。故整块切到未判定态：
   * 数字位显 `—`（不显 0）、状态位显「未判定」、原因照旧在浮层给全。
   */
  const pending = graph.empty !== undefined;
  const autoArgs = q.data.autoArgs;
  const candidates = q.data.candidates.length > 0 ? q.data.candidates : knownCandidates;
  const effectivePairs = Object.entries(effectiveArgs).map(([k, v]) => `${k}=${String(v)}`);

  return (
    <div className={styles.wrap} data-testid={`slice-layers-${sliceKey}`}>
      {/* ── 第一层：本页要回答的那个数 ─────────────────────────────────────── */}
      <div className={styles.headline}>
        <span className={styles.headlineNum} data-testid={`slice-layers-headline-${sliceKey}`}>
          {pending ? t.pendingHeadline : t.headline(summary.present)}
        </span>
        <span className={styles.headlineSub} data-testid={`slice-layers-summary-${sliceKey}`}>
          {pending ? t.pendingSummary : t.summaryLine(summary.present, summary.notInSlice, summary.absent)}
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
          rootType={q.data.data.rootType}
          onPick={(arg, value) => {
            setPickedArgs((a) => ({ ...a, [arg]: value }));
            setOpenLayer(null);
          }}
        />
      )}
      {/* 当前生效实参**必须显式摆在第一层**：不显示 = 用户不知道自己在看哪个 root 的切片
          （自动默认尤其如此 —— 悄悄替用户选了一个还不说，比空卡更坏）。 */}
      {effectivePairs.length > 0 && (
        <div className={styles.appliedBar} data-testid={`slice-layers-applied-${sliceKey}`}>
          <span>{t.empty.applied(effectivePairs.join(" · "))}</span>
          {autoArgs && Object.keys(pickedArgs).length === 0 && (
            <span className="badge" data-testid={`slice-layers-autodefault-${sliceKey}`}>{t.empty.autoDefaultBadge}</span>
          )}
          <WhyPopover label={t.empty.autoDefaultWhyLabel} testId={`slice-layers-autodefault-why-${sliceKey}`}>
            <span className={styles.popSec}>
              <span className={styles.popTitle}>{t.empty.autoDefaultWhyLabel}</span>
              <span>{t.empty.autoDefaultWhy}</span>
            </span>
          </WhyPopover>
          <button
            type="button"
            className="btn sm"
            data-testid={`slice-layers-clearargs-${sliceKey}`}
            onClick={() => {
              setPickedArgs({});
              setAutoOff(true); // 清空 = 要看原始诚实态；不关自动默认的话这个按钮就是摆设
            }}
          >
            {t.empty.clear}
          </button>
        </div>
      )}
      {/* 换 root：候选值仍来自后端（首次响应留存的那份），解出子图后照样能切 —— 否则默认实参
          就成了「只能看这一个」。空子图时不渲染（那时 EmptyGraphBar 已在给同一批候选，
          两处同时渲染会撞 testid）。 */}
      {!pending && candidates.length > 0 && (
        <div className={styles.appliedBar} data-testid={`slice-layers-switch-${sliceKey}`}>
          {candidates.map((c) => (
            <span key={c.arg} className={styles.emptyPick}>
              <span className={styles.emptyPickLabel}>{t.empty.switchLabel(c.arg)}</span>
              {c.values.map((v) => (
                <button
                  key={v}
                  type="button"
                  className={styles.candBtn}
                  data-active={String(effectiveArgs[c.arg]) === v ? "true" : "false"}
                  data-testid={`slice-layers-cand-${sliceKey}-${c.arg}-${v}`}
                  onClick={() => {
                    setPickedArgs((a) => ({ ...a, [c.arg]: v }));
                    setOpenLayer(null);
                  }}
                >
                  {v}
                </button>
              ))}
            </span>
          ))}
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
                      {/* 数值本身 + 单位（裸数会被读成层数/跳数 —— WO-UNIT-MEANING 同口径）。
                          未判定态显 `—`：这时 0 不是量出来的 0，是「没量」（WO-SLICE-DEFAULT-ARGS）。 */}
                      <span>
                        <span
                          className={`${styles.num} ${pending ? styles.numPending : NUM_CLASS[l.status]}`}
                          data-testid={`slice-layer-count-${sliceKey}-${id}`}
                        >
                          {pending ? t.pendingNum : l.count}
                        </span>
                        {!pending && <span className={styles.unit}>{l.unit}</span>}
                      </span>
                      <span className={styles.statusLine} data-testid={`slice-layer-status-${sliceKey}-${id}`}>
                        {pending ? t.statusPending : STATUS_LABEL[l.status]}
                        {!pending && l.status === "not_in_slice" && l.platformCount !== undefined && ` · ${t.platformHas(l.platformCount, l.unit)}`}
                      </span>
                    </button>
                    {/* 诚实位记号：口径/缺席原因降到了浮层，但第一层看得见「这里有话要说」
                        （规范 §1：静默降层等于删除）。 */}
                    <span className={styles.cardMarkSlot}>
                      <WhyPopover
                        label={t.whyLabel}
                        marked={pending || l.status !== "present"}
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
              {pending ? t.statusPending : `${active.count} ${active.unit}`}
            </span>
            <span className={styles.carrier}>
              {t.carrierLabel}：{active.carrier}
            </span>
          </div>

          {/* 缺席态 / 未判定态：只说原因，**不渲染任何明细行**（不画占位内容）。 */}
          {pending || active.status !== "present" ? (
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
