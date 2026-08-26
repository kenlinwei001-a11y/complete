/**
 * ══ WO-SIM-UNIFIED-SHELL · 统一推演控制台（五区外壳 + 指标卡墙 + 右栏检视 + 底部抽屉）══
 *
 * 三张单里的第 ①：**外壳 + 卡墙 + 右栏 + 抽屉**。
 * 顶部模式页签只有「现状」是活的，其余四档占位禁用（属第 ② 张单）；
 * 左栏本单只做**收合行为 + 摘要条**（扰动表单属第 ③ 张单）。
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
import { useMemo, useState } from "react";
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
import { SANDBOX_MODES, SANDBOX_MODE_LABEL, SANDBOX_MODE_QUESTION, type SandboxMode } from "../sandboxModes";
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

/** 本单只点亮「现状」；其余四档是第 ② 张单的事，占位**禁用**而不是隐藏（隐藏 = 假装没这功能）。 */
const ACTIVE_MODE: SandboxMode = "now";

/** 会话五态各自的屏上措辞。**不合并** —— 三种"没有会话"处置完全不同（见 `useConsoleSession`）。 */
const SESSION_REASON_TEXT: Record<ConsoleSessionReason, string> = {
  explicit: "宿主指定了会话",
  auto: "自动选中最近一条 RUNNING 会话",
  loading: "会话列表还在路上",
  "no-running-session": "本租户没有 RUNNING 会话 —— 没有世界可推演（不是算不出来）",
  unavailable: "会话列表这一跳失败 —— **不知道**有没有会话（不是没有）",
};

export default function UnifiedSimShell({ view }: { view?: ViewConfigVM }): JSX.Element {
  const session = useConsoleSession(view?.options);
  const sessionId = session.sessionId;
  const enabled = sessionId !== undefined && sessionId !== "";

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

  return (
    <div className={styles.shell} data-testid="usim-shell">
      {/* ── 区① 顶部模式页签（顺序 = `sandboxModes.ts` 的决策链，本页不另排一套）── */}
      <nav className={styles.tabs} data-testid="usim-tabs" aria-label="推演模式">
        {SANDBOX_MODES.map((m) => (
          <button
            key={m}
            type="button"
            className={`${styles.tab} ${m === ACTIVE_MODE ? styles.tabOn : ""}`}
            data-testid={`usim-tab-${m}`}
            data-active={m === ACTIVE_MODE ? "1" : "0"}
            disabled={m !== ACTIVE_MODE}
            title={
              m === ACTIVE_MODE
                ? SANDBOX_MODE_QUESTION[m]
                : `${SANDBOX_MODE_QUESTION[m]} —— 本单只交付「${SANDBOX_MODE_LABEL[ACTIVE_MODE]}」，此档待后续工单`
            }
            aria-current={m === ACTIVE_MODE ? "page" : undefined}
          >
            {SANDBOX_MODE_LABEL[m]}
          </button>
        ))}
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

      {/* ── 区③ 三栏主体 ── */}
      <div className={`${styles.body} ${railOpen ? "" : styles.bodyRailOff}`}>
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
      </div>

      {/* ── 区④ 底部抽屉 ── */}
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

      {/* ── 区⑤ 底部日志 ── */}
      <div className={styles.log} data-testid="usim-log">
        {log.length === 0 ? "（无操作）" : log.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  );
}
