/**
 * ══ WO-SIM-UNIFIED-SHELL · 统一推演控制台（五区外壳 + 指标卡墙 + 右栏检视 + 底部抽屉）══
 *
 * 三张单里的第 ①：**外壳 + 卡墙 + 右栏 + 抽屉**。
 * 左栏本单只做**收合行为 + 摘要条**（扰动表单属第 ③ 张单）。
 *
 * ══ WO-SIM-SHELL-TABS（第 ②）· 四个独立页降成本壳的模式页签 ═════════════════════
 *
 * 本单**没有写一行页面代码**：四页原样挂载，经 `views/registry.ts` 的 `getRenderer`
 * ——与 `ViewPage` 逐字同构的同一条分发路径（理由见 `unifiedModes.ts` 文件头）。
 *
 * ── 开工前实测的四条前提（铁律 0.5：派单给的是线索不是结论）───────────────────
 *
 * ① **页签占位用的是「另一屏」的模式表**
 *    · 今天的行为是 X：第 ① 单把 `../sandboxModes.ts` 的 `SANDBOX_MODES`
 *      （现状/归因/试一手/求最优/影响半径）搬来当占位，而那五档指向的是
 *      `cleanroom-attr` / `what-if` / `optimize-whatif` / `disruption-radius`——
 *      **旧沙盘控制台 `SandboxConsole` 的四个通用页**，与本单要挂的四页零重叠。
 *    · 应该是 Y：本屏有自己的模式表（`unifiedModes.ts`），成员逐字取自已批准的 UX 规格。
 *      旧表不动（`SandboxConsole` 还在用它），本壳不再引用它。
 *
 * ② **左栏今天「施加不了扰动」——能丢的上下文是选择态，不是扰动本身**
 *    · 今天的行为是 X：左栏 `PerturbTree` 的「＋添加扰动」在
 *      `targetObjectId === undefined` 时**直接 return**（它自己的注释写着「缺了就什么都不做，
 *      不去编一个 objectId 顶上」），而本壳只透 `sessionId` ⇒ 那条 POST 分支**从未进入**。
 *      所以「施加扰动」这个动作今天在本壳里做不到；已施加清单是**后端态**（`GET …/perturbations`），
 *      它天然不随组件卸载消失。
 *    · 应该是 Y：本单要保住的上下文是**左栏的选择态**（落点范围下拉 / 选中因子）
 *      与**卡墙的选中卡**——这两样才是「切页签就没了」的那部分。
 *      故左栏与选中态**提到壳级、跨模式不卸载**（结构保证，不是复制一份状态副本）。
 *      接缝门第 ② 臂咬的就是这个；变异反证 ① 给左栏加 `key={mode}` 强制重挂即当场红。
 *
 * ③ **「四页的像素门会红」这条前提不成立**
 *    · 今天的行为是 X：`sandbox-detail-pixel` / `sandbox-attr-pixel` / `sandbox-opt-pixel`
 *      三门读的是**各页自己的 CSS Module + 规格 HTML**，`renderWithClient` 渲染的也是
 *      各页自己的组件，**从不渲染本壳**。本单不碰那三份 CSS、不碰四页实现
 *      ⇒ 它们的输入一个字节没变。
 *    · 应该是 Y：那批断言**不该改**（改了才是把防线拆了）。逐条判定与实跑 RC 见交付报告。
 *
 * ④ **左栏第 ③ 单的 `rail/PerturbRail.tsx` 尚未落地**
 *    · 今天的行为是 X：`views/sim/unified/rail/` 目录不存在（实测 `ls` 报 No such file）。
 *    · 应该是 Y：本单保留现有左栏（`PerturbTree`）不等它；挂载那一行归本单，
 *      待 ③ 并线后只需把 `<PerturbTree>` 换成 `<PerturbRail>`，本壳其余一行不动。
 *
 * ══ 本单开工前实测的三条前提（铁律 0.5：派单给的是线索不是结论）════════════════
 *
 * ① **层级不该在前端算**（派单原文要求前端按入度/出度现算 —— 照做就是第二套真相源）
 *    · 今天的行为是 X：后端 `apps/datacore/src/sim/drill-scan.ts:290 layerOfStateVars`
 *      已按入度/出度现算层级，经 `GET /a/v1/sim/drill/state-var-layers`（`app.ts:2901`）下发；
 *      前端 `api/endpoints.ts:838 fetchDrillStateVarLayers` 也早就在，
 *      且 `views/sim/DrillPanel.tsx:125` 明文写着「前端再算一份，度数口径一漂两边就各说各话」。
 *    · 应该是 Y：本页**消费**后端算好的层级，前端零度数计算。
 *      「层级不是手工登记的」由门咬**改边集 ⇒ 屏上层级跟着变**来证明。
 *
 * ② **出处记号后端早就有、前端一个消费方都没有**
 *    · 今天的行为是 X：`SeedWorldSnapshotOrigin`（`sim/seed-world.ts:190`）把 tick0 是
 *      `round(hash01(objectId|stateVar)×100)` **结构派生**这件事写进了 `scope.baseSnapshotOrigin`，
 *      随 `GET /a/v1/sim/sessions` 原样下发；而 `grep -rn baseSnapshotOrigin apps/frontend-shell/`
 *      **零命中**（金丝雀：同目录 `fetchDrillStateVarLayers` 同法命中 3 处 ⇒ 检索工具是好的）。
 *      于是屏上把这批占位一律当实测读（`SandboxView.tsx:595` 给任何后端回包盖 `MEASURED` 章）。
 *    · 应该是 Y：把这个记号读出来，**逐卡**标「推演投影·非实测」，标注跟着数字走。
 *
 * ③ **`unit` 恒 `null` 是诚实缺席，不是没做**
 *    · 今天的行为是 X：契约 `SimMetricSeriesItem.unit` 注释实测记账「全仓没有任何
 *      『状态变量 → 单位』的登记册」，17 条真回包全 `null`。
 *    · 应该是 Y：屏上**不带单位**并说明为什么，而不是补一个「%」或「指数」（那是造口径）。
 *
 * ══ 取数口（五条，全部既有，本单一个新端点都没造）════════════════════════════
 *   `fetchSimViewConfig`        → 卡片的**名字与个数**（`stateVars` / `stateVarNames`）
 *   `fetchDrillStateVarLayers`  → 层级（后端现算）
 *   `fetchPropagationRules`     → 传导边（右栏「谁推的 / 推坏谁」）
 *   `metricSeriesPath` + `api.a`→ 指标时序（路径取 `console/useParetoFrontier.ts` 的**单源**，
 *                                 不在本文件再写一遍路径字面量）
 *   `fetchSimSessions`          → 会话 `scope.baseSnapshotOrigin`（缓存键与 `useConsoleSession`
 *                                 共用 `["a","sim-sessions"]` ⇒ 同一份缓存、同一条事件失效链）
 */
import { Suspense, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PropagationRulesResponse, SandboxViewConfig, SimMetricSeriesResponse } from "@platform/contracts";
import { api } from "@/api/apiClient";
import type { ViewConfigVM } from "@/api/types";
import {
  fetchDrillStateVarLayers,
  fetchPropagationRules,
  fetchSimPerturbations,
  fetchSimSessions,
  fetchSimViewConfig,
} from "@/api/endpoints";
import { getRenderer } from "@/views/registry";
import { UNIFIED_MODES, UNIFIED_MODE_SPEC, type UnifiedMode } from "./unifiedModes";
import { stateVarLabel } from "../stateVarLabel";
import { useConsoleSession, type ConsoleSessionReason } from "../console/useConsoleSession";
import { metricSeriesPath } from "../console/useParetoFrontier";
import { PerturbTree } from "../console/PerturbTree";
import {
  buildInspectorView,
  buildMetricWall,
  buildRailSummary,
  readSnapshotOrigin,
  type PerturbationBrief,
} from "./metricWallModel";
import { MetricWall } from "./MetricWall";
import { InspectorPane } from "./InspectorPane";
import { BottomDrawer } from "./BottomDrawer";
import styles from "./UnifiedSimShell.module.css";

/** 会话五态各自的屏上措辞。**不合并** —— 三种"没有会话"处置完全不同（见 `useConsoleSession`）。 */
const SESSION_REASON_TEXT: Record<ConsoleSessionReason, string> = {
  explicit: "宿主指定了会话",
  auto: "自动选中最近一条 RUNNING 会话",
  loading: "会话列表还在路上",
  "no-running-session": "本租户没有 RUNNING 会话 —— 没有世界可推演（不是算不出来）",
  unavailable: "会话列表这一跳失败 —— **不知道**有没有会话（不是没有）",
};

/**
 * 一个模式档的内容区。
 *
 * **懒加载在这里成立**：`getRenderer()` 取回的是 `registry.ts` 里 `lazy(() => import(...))`
 * 造出来的那个组件 —— React 只在**它真被渲染**的那一刻才去跑 `import()`。
 * 本函数只渲染当前选中那一档 ⇒ 其余三页的 chunk 首屏不下载、DOM 里也没有它们。
 * （变异反证 ③：把这里改成把四档一起渲染出来，接缝门第 ③ 臂当场红。）
 *
 * 键解析不中时**照实说**并把键名打出来，不落一个空白区 ——
 * 「屏上什么都没有」与「这一档没注册」在用户眼里一模一样，正是本仓最恨的那种静默。
 */
function ModePanel({ mode, view }: { mode: UnifiedMode; view: ViewConfigVM }): JSX.Element {
  const key = UNIFIED_MODE_SPEC[mode].renderer;
  const Renderer = getRenderer(key ?? undefined);
  if (key === null || Renderer === undefined) {
    return (
      <div className={styles.modeFallback} data-testid="usim-mode-unresolved">
        这一档挂的渲染器 <code>{key ?? "（本表未填）"}</code> 在 <code>views/registry.ts</code> 里没注册
        —— 这是接线缺口，不是「没有数据」。
      </div>
    );
  }
  return (
    <Suspense fallback={<div className={styles.modeFallback}>{UNIFIED_MODE_SPEC[mode].label} 载入中…</div>}>
      <Renderer view={view} />
    </Suspense>
  );
}

export default function UnifiedSimShell({ view }: { view?: ViewConfigVM }): JSX.Element {
  const session = useConsoleSession(view?.options);
  const sessionId = session.sessionId;
  const enabled = sessionId !== undefined && sessionId !== "";

  const [mode, setMode] = useState<UnifiedMode>("now");
  const [selected, setSelected] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [log, setLog] = useState<readonly string[]>([]);
  const say = (line: string): void => setLog((p) => [...p, line].slice(-50));

  const cfgQ = useQuery({
    queryKey: ["a", "sim-view-config"],
    queryFn: fetchSimViewConfig,
    staleTime: Infinity,
    retry: false,
  });
  const layersQ = useQuery({
    queryKey: ["a", "sim-statevar-layers"],
    queryFn: fetchDrillStateVarLayers,
    staleTime: Infinity,
    retry: false,
  });
  const rulesQ = useQuery({
    queryKey: ["a", "sim-propagation-rules", true],
    queryFn: () => fetchPropagationRules(true),
    staleTime: Infinity,
    retry: false,
  });
  const seriesQ = useQuery({
    queryKey: ["a", "sim-metric-series", sessionId ?? ""],
    queryFn: () => api.a<SimMetricSeriesResponse>(metricSeriesPath(sessionId as string)),
    enabled,
    staleTime: Infinity,
    retry: false,
  });
  // 与 `useConsoleSession` **同一个缓存键** ⇒ 不多发一次请求，也不另立一套"当前会话"判定。
  const sessionsQ = useQuery({
    queryKey: ["a", "sim-sessions"],
    queryFn: fetchSimSessions,
    staleTime: Infinity,
    retry: false,
  });
  const perturbQ = useQuery({
    queryKey: ["a", "sim-perturbations", sessionId ?? ""],
    queryFn: () => fetchSimPerturbations(sessionId as string),
    enabled,
    staleTime: Infinity,
    retry: false,
  });

  const cfg = cfgQ.data as SandboxViewConfig | undefined;
  const rules = (rulesQ.data as PropagationRulesResponse | undefined)?.items ?? [];
  /**
   * 名字字典**两条端点同形状**（契约明文：「两个端点用同一种形状前端才能共用一条消费路径」）。
   * view-config 那份优先；它没下发时回落到 propagation-rules 那份。两份同源同投影函数，不会打架。
   */
  const names = cfg?.stateVarNames ?? (rulesQ.data as PropagationRulesResponse | undefined)?.stateVarNames;

  const origin = useMemo(() => {
    const items = sessionsQ.data?.items ?? [];
    const s = items.find((x) => x.id === sessionId);
    return s === undefined ? null : readSnapshotOrigin(s.scope);
  }, [sessionsQ.data, sessionId]);

  const wall = useMemo(
    () =>
      buildMetricWall({
        stateVars: cfg?.stateVars ?? [],
        stateVarNames: names,
        layers: layersQ.data?.layers ?? null,
        series: seriesQ.data ?? null,
        seriesAbsenceReason: enabled
          ? seriesQ.isLoading
            ? "指标时序还在路上"
            : "指标时序这一跳失败了 —— 不知道这些变量变了没有"
          : SESSION_REASON_TEXT[session.reason],
        origin,
      }),
    [cfg, names, layersQ.data, seriesQ.data, seriesQ.isLoading, enabled, session.reason, origin],
  );

  const inspector = useMemo(() => {
    if (selected === null) return null;
    const card = wall.cards.find((c) => c.stateVar === selected);
    if (card === undefined) return null;
    return buildInspectorView({ card, wall, rules, stateVarNames: names });
  }, [selected, wall, rules, names]);

  const applied: PerturbationBrief[] = useMemo(
    () =>
      (perturbQ.data?.items ?? []).map((p) => ({
        id: p.id,
        label: p.label,
        targetStateVar: p.targetStateVar,
        targetLabel: stateVarLabel(p.targetStateVar, names),
        magnitude: p.magnitude,
        mode: p.mode,
      })),
    [perturbQ.data, names],
  );
  const summary = useMemo(() => buildRailSummary(applied, wall), [applied, wall]);

  const windowDays =
    seriesQ.data === undefined ? null : seriesQ.data.ticks.length * (seriesQ.data.tickDays ?? 1);

  /**
   * 透给被挂载那一页的 `view`。**上下文就是从这里过去的**，三件事各有出处：
   *
   *  · `sessionId` —— 壳已经解析好的那个会话。透下去 ⇒ 各页 `useConsoleSession` 走
   *    `reason:"explicit"` 分支，**不再各自去查一遍**「最近一条 RUNNING」。
   *    这是「切页签不换世界」的结构保证：四页与卡墙看的是**同一个** sessionId，
   *    而不是四次独立查询碰巧查到同一条（那种一致性经不起一次会话变更）。
   *    壳自己都没解析出会话时**不透**（不传空串下去让它发 404）——
   *    此时各页回落到自己那条同 `queryKey` 的查询，同缓存同答案。
   *
   *  · 宿主自己的 `view.options` —— 原样带过去（如损失归因的 `so` 锚点订单号、
   *    方案寻优的 `paretoRequest`、线路图的 `baseIds`）。深链进本壳的参数因此仍然到得了页面；
   *    **壳不在这里编任何默认值**（编一个就是造假锚点，见 `SandboxAttrRoute` 文件头）。
   *
   *  · `key` / `renderer` —— 填这一档的 renderer key，与 `ViewPage` 下发的形状一致。
   *
   * ⚠ `useMemo` 不是优化，是**必需**：`ChainLineMapView` 的 `argsFromView(view)` 按引用做
   *   `useMemo` 依赖，每渲染新造一个对象会让它反复重取。
   */
  const modeViews = useMemo(() => {
    const inherited = view?.options ?? {};
    const out: Partial<Record<UnifiedMode, ViewConfigVM>> = {};
    for (const m of UNIFIED_MODES) {
      const key = UNIFIED_MODE_SPEC[m].renderer;
      if (key === null) continue;
      out[m] = {
        key,
        title: UNIFIED_MODE_SPEC[m].label,
        renderer: key,
        layout: undefined,
        options: { ...inherited, ...(sessionId === undefined ? {} : { sessionId }) },
      };
    }
    return out;
  }, [view?.options, sessionId]);

  const modeView = modeViews[mode];

  return (
    <div className={styles.shell} data-testid="usim-shell">
      {/* ── 区① 顶部模式页签（顺序与分组 = `unifiedModes.ts`，本处不另排一套）──
          `role="tablist"` + `aria-selected`：这排按钮换的是**同一屏的哪一面**，不是导航到别处，
          故用 tab 语义而不是链接（与规格 `.modes[role=tablist]` 一致）。 */}
      <nav className={styles.tabs} data-testid="usim-tabs" role="tablist" aria-label="推演模式">
        {UNIFIED_MODES.map((m) => {
          const spec = UNIFIED_MODE_SPEC[m];
          const on = m === mode;
          const disabled = spec.pending !== null;
          return (
            <span key={m} className={styles.tabSlot}>
              {spec.group === null ? null : (
                <span className={styles.tabGroup} data-testid={`usim-tab-group-${m}`} aria-hidden>
                  {spec.group}
                </span>
              )}
              <button
                type="button"
                role="tab"
                className={`${styles.tab} ${on ? styles.tabOn : ""}`}
                data-testid={`usim-tab-${m}`}
                data-active={on ? "1" : "0"}
                disabled={disabled}
                title={disabled ? `${spec.question} —— ${spec.pending}` : spec.question}
                aria-selected={on}
                onClick={() => {
                  setMode(m);
                  say(`切到「${spec.label}」`);
                }}
              >
                {spec.label}
              </button>
            </span>
          );
        })}
      </nav>

      {/* ── 区② 状态条：会话出处 + 世界态出处（诚实位，两件事分开说）── */}
      <div className={styles.status} data-testid="usim-status" data-session-reason={session.reason}>
        <span>
          <span className={styles.statusKey}>会话 </span>
          {sessionId ?? "—"}
        </span>
        <span className={styles.calibre}>{SESSION_REASON_TEXT[session.reason]}</span>
        <span data-testid="usim-origin" data-origin-kind={origin?.kind ?? "unknown"} className={styles.calibre}>
          {origin === null
            ? "世界态出处：会话未下发 `scope.baseSnapshotOrigin` ⇒ 出处不明，屏上一律按「非实测」读"
            : `世界态出处：${origin.kind}${origin.note === null ? "" : ` · ${origin.note}`}${
                origin.measuredCells === null || origin.cells === null
                  ? ""
                  : ` · 实测格 ${origin.measuredCells}/${origin.cells}`
              }`}
        </span>
      </div>

      {/* 左栏收起后的常驻摘要条（仓主明确要的那条） */}
      {!railOpen ? (
        <div className={styles.summaryBar} data-testid="usim-rail-summary">
          <span data-testid="usim-rail-summary-applied">已施加：{summary.appliedText}</span>
          <span data-testid="usim-rail-summary-result">{summary.resultText}</span>
          <button type="button" data-testid="usim-rail-reopen" onClick={() => setRailOpen(true)}>
            改扰动
          </button>
        </div>
      ) : null}

      {/* ── 区③ 三栏主体 ──────────────────────────────────────────────────────
          **左栏是壳的一部分，不属于任何一档** —— 切页签只换中/右两栏。
          这不是版面偏好，是本单的**功能判据**：左栏一旦挂在某一档之下，切页签就等于
          卸载它，用户正在挑的落点/范围当场清零 —— 那正是「今天跨页会丢上下文」这件事
          换个地方复发。规格原型把左栏只画在首档，是因为静态 HTML 没有"卸载"这回事；
          真做出来必须提到壳级。要整版宽度时按「收起」（收起态摘要条常驻，规格里那条）。 */}
      <div
        className={[
          styles.body,
          mode === "now" ? "" : styles.bodyMode,
          railOpen ? "" : mode === "now" ? styles.bodyRailOff : styles.bodyModeRailOff,
        ]
          .filter(Boolean)
          .join(" ")}
        data-testid="usim-body"
        data-mode={mode}
      >
        {railOpen ? (
          <aside className={styles.col} data-testid="usim-rail">
            <div className={styles.railHead}>
              <strong>扰动</strong>
              <button type="button" data-testid="usim-rail-collapse" onClick={() => setRailOpen(false)}>
                收起
              </button>
            </div>
            {/* 复用既有 `PerturbTree`（`console/PerturbTree.tsx`）**一行未改**：
                它自带取数与 20 条因子目录，props 只有 `{sessionId, targetObjectId}`。
                本单不动它的表单形态 —— 那是第 ③ 张单。 */}
            <PerturbTree sessionId={sessionId} />
          </aside>
        ) : null}

        {/* 「指标态势」= 本壳自带的卡墙 + 右栏检视；其余档 = 挂现成页面，占中右整块。
            **任何时刻只有一档在 DOM 里**（`sandboxModes.ts` 那条硬约束的同一条：
            不是 `hidden`/`display:none` —— 那只是让人看不见，请求照发、屏幕阅读器照读）。 */}
        {mode === "now" ? (
          <>
            <main className={styles.col} data-testid="usim-center">
              <MetricWall
                wall={wall}
                selected={selected}
                onSelect={(sv) => {
                  setSelected(sv);
                  say(`选中 ${sv}`);
                }}
              />
            </main>

            <aside className={styles.col} data-testid="usim-right">
              <InspectorPane
                view={inspector}
                onExpand={() => {
                  setDrawerOpen(true);
                  say(`展开抽屉 ${inspector?.card.stateVar ?? ""}`);
                }}
                onAction={(a) => say(`动作 ${a}（本单不落写操作）`)}
              />
            </aside>
          </>
        ) : (
          <section
            className={styles.col}
            data-testid="usim-mode-panel"
            data-mode={mode}
            data-renderer={UNIFIED_MODE_SPEC[mode].renderer ?? ""}
            role="tabpanel"
            aria-label={UNIFIED_MODE_SPEC[mode].label}
          >
            {modeView === undefined ? (
              <div className={styles.modeFallback} data-testid="usim-mode-unresolved">
                这一档在 <code>unifiedModes.ts</code> 里没填 renderer —— 接线缺口，不是「没有数据」。
              </div>
            ) : (
              <ModePanel mode={mode} view={modeView} />
            )}
          </section>
        )}
      </div>

      {/* ── 区④ 底部抽屉 ──────────────────────────────────────────────────────
          抽屉装的是**选中那张指标卡**的详情（链路/落点/时序），只有「指标态势」有卡可选。
          其余档下不渲染开关：摆一个点开永远是空的开关，就是本仓最恨的假旋钮。 */}
      {mode === "now" ? (
        <div>
          <button
            type="button"
            data-testid="usim-drawer-toggle"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((v) => !v)}
          >
            {drawerOpen ? "收起抽屉" : "展开抽屉"}
          </button>
          {drawerOpen ? <BottomDrawer view={inspector} windowDays={windowDays} /> : null}
        </div>
      ) : null}

      {/* ── 区⑤ 底部日志 ── */}
      <div className={styles.log} data-testid="usim-log">
        {log.length === 0 ? "（无操作）" : log.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  );
}
