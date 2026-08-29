/**
 * ══ WO-SIM-RAIL-FORMS · 左栏「扰动因素」子页（下拉逐级收窄 → 选量 → 定幅度与时长 → 施加）══
 *
 * 三张单里的第 ③。**本单不负责把它挂进外壳** —— `UnifiedSimShell.tsx` 归第 ② 张单，
 * 本文件一行都不碰它。挂载契约就是本文件的默认导出 + 下面那个 `PerturbRailProps`。
 *
 * 四条前提的实测结论、以及「为什么子页是域分片而不是六个写死的名字」，
 * 全部写在 `perturbRailModel.ts` 的头注里（那里是模型层，判据该住在判据自己家）。
 *
 * ── 本文件只做三件事 ─────────────────────────────────────────────────────────
 *  ① 取数（五条既有端点，缓存键与 `UnifiedSimShell` **逐字相同** ⇒ 挂进去不多发一次请求）；
 *  ② 把模型算好的东西渲染成 `<select>`（**一个业务判断都不做**：分片、根源、扰不动、
 *     能不能提交，全部问 `perturbRailModel`）；
 *  ③ 把「已施加什么」经 `onAppliedChange` 交出去 —— 收起态那条常驻摘要条在外壳里（归 ②），
 *     本组件不去画它，也不去改外壳。
 *
 * ── ⚠ 为什么可以在渲染期 `useQuery`（这条踩过，别自作主张改）────────────────────
 * `views/sim/DrillPanel.tsx:130` 记着一条硬教训：给**共享**面板在渲染期新增 endpoint 依赖，
 * 会被全仓那批整体替换式 `vi.mock("@/api/endpoints", () => ({...}))` 打成 `undefined` 而当场抛，
 * 把别的单的门整片打红。本组件安全，是因为它依赖的四条读端
 * （`fetchSimViewConfig` / `fetchDrillStateVarLayers` / `fetchPropagationRules` / `fetchSimPerturbations`）
 * **恰好就是 `UnifiedSimShell` 今天已经在渲染期依赖的那四条**（`UnifiedSimShell.tsx:92-130`）——
 * 它挂进去以后，宿主的 mock 面一个字都不用加。第五条 `createSimPerturbation` 只在**点击事件里**调用，
 * 渲染期不碰（同 `DrillPanel` 的 `simDrill`）。
 * 加第六条读端之前请先回来读这一段。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PerturbationKind, PropagationRulesResponse, SandboxViewConfig } from "@platform/contracts";
import {
  createSimPerturbation,
  simTick,
  fetchDrillStateVarLayers,
  fetchPropagationRules,
  fetchSimPerturbations,
  fetchSimViewConfig,
} from "@/api/endpoints";
import { toastError } from "@/store/toastStore";
import { stateVarLabel } from "../../stateVarLabel";
import { PERTURBATION_KINDS } from "../../PerturbationTimeline";
import type { PerturbationBrief } from "../metricWallModel";
import {
  BLOCKED_REASON_TEXT,
  BLOCK_REASON_TEXT,
  DOWNSTREAM_NOTE,
  buildBlockedFactors,
  buildPerturbBody,
  buildSubpages,
  durationText,
  livenessOf,
  magnitudeText,
  objectChoices,
  type PerturbDraft,
  type RailSubpage,
  type RailVarOption,
} from "./perturbRailModel";
import styles from "./PerturbRail.module.css";

/**
 * 挂载契约（给第 ② 张单）。**三个 props，越简单越好**。
 *
 * `onAppliedChange` 交出去的就是 `metricWallModel.PerturbationBrief[]` ——
 * 外壳拿它直接喂 `buildRailSummary(applied, wall)`（那是①已经写好的摘要条文案唯一出处），
 * 不需要在外壳里再拼一次字符串，也不需要第二种形状。
 */
export interface PerturbRailProps {
  /** 当前世界。`undefined`/空串 = 没有会话 ⇒ 表单只读并说明原因（不是隐藏）。 */
  readonly sessionId?: string;
  /** 「已施加什么」变化时回调（收起态摘要条的数据源；外壳自行决定怎么渲染）。 */
  readonly onAppliedChange?: (applied: readonly PerturbationBrief[]) => void;
  /** 一条扰动施加成功后（外壳可据此刷新卡墙 / 记一行日志）。 */
  readonly onApplied?: (label: string) => void;
}

const MODES: readonly { key: PerturbDraft["mode"]; label: string }[] = [
  // 三种模式的语义来自契约 `PerturbationSchema.mode` 的原文注释（「设为 / 增减 / 乘以」），
  // 不是本文件发明的说法。
  { key: "set", label: "设为" },
  { key: "delta", label: "增减" },
  { key: "scale", label: "乘以" },
];

const FIRST_KIND: PerturbationKind = "demand_shift";

export default function PerturbRail({ sessionId, onAppliedChange, onApplied }: PerturbRailProps): JSX.Element {
  const qc = useQueryClient();
  const enabled = sessionId !== undefined && sessionId !== "";

  // ── 取数：缓存键与 `UnifiedSimShell` 逐字相同（同一份缓存、同一条事件失效链）──
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
  const perturbQ = useQuery({
    queryKey: ["a", "sim-perturbations", sessionId ?? ""],
    queryFn: () => fetchSimPerturbations(sessionId as string),
    enabled,
    staleTime: Infinity,
    retry: false,
  });

  const cfg = cfgQ.data as SandboxViewConfig | undefined;
  const rules = (rulesQ.data as PropagationRulesResponse | undefined)?.items ?? [];
  /** 名字字典两条端点同形状（契约明文）：view-config 那份优先，缺席回落 propagation-rules 那份。 */
  const names = cfg?.stateVarNames ?? (rulesQ.data as PropagationRulesResponse | undefined)?.stateVarNames;

  const pages = useMemo(
    () => buildSubpages(rules, layersQ.data?.layers ?? null, names),
    [rules, layersQ.data, names],
  );
  /**
   * 这个世界今天真有的状态变量（**唯一判据**）。
   * `null` = view-config 还没回来 / 这一跳失败了 ⇒ 「不知道」，不许读作「没有」。
   */
  const liveStateVars = useMemo(
    () => (cfg === undefined ? null : new Set(cfg.stateVars)),
    [cfg],
  );
  const blocked = useMemo(() => buildBlockedFactors(cfg?.stateVars ?? []), [cfg?.stateVars]);

  // ── 受控选中：切片没了就回落到第一片（同 `edgeActiveModel.resolveSelectedSlice` 的理由：
  //    「一个都没选中 ⇒ 一行都不显示」看起来和"这页坏了"一模一样）──
  const [sliceId, setSliceId] = useState<string | null>(null);
  const page: RailSubpage | null = useMemo(() => {
    if (pages.length === 0) return null;
    return pages.find((p) => p.sliceId === sliceId) ?? pages[0] ?? null;
  }, [pages, sliceId]);

  const [stateVar, setStateVar] = useState("");
  const [typeKey, setTypeKey] = useState("");
  const [objectId, setObjectId] = useState("");
  const [kind, setKind] = useState<PerturbationKind>(FIRST_KIND);
  const [mode, setMode] = useState<PerturbDraft["mode"]>("delta");
  const [magnitudeRaw, setMagnitudeRaw] = useState("10");
  const [startTickRaw, setStartTickRaw] = useState("0");
  const [durationRaw, setDurationRaw] = useState("");
  const [busy, setBusy] = useState(false);

  /** 当前片的可选项：根源在前（默认选中第一个根源），枢纽/末端在后。 */
  const options: readonly RailVarOption[] = useMemo(
    () => (page === null ? [] : [...page.roots, ...page.downstream]),
    [page],
  );
  const selectedVar = useMemo(
    () => options.find((o) => o.stateVar === stateVar) ?? options[0] ?? null,
    [options, stateVar],
  );
  /** 落点类型：跟着选中的量走（承载它的类型由后端规则给，前端不猜）。 */
  const typeKeys = selectedVar?.typeKeys ?? [];
  const selectedType = typeKeys.includes(typeKey) ? typeKey : (typeKeys[0] ?? null);
  const choice = useMemo(
    () => objectChoices(cfg?.nodeObjectIds, selectedType),
    [cfg?.nodeObjectIds, selectedType],
  );
  const selectedObjectId = choice.ids.includes(objectId) ? objectId : (choice.ids[0] ?? "");

  const draft: PerturbDraft = useMemo(
    () => ({
      kind,
      targetObjectId: selectedObjectId,
      targetStateVar: selectedVar?.stateVar ?? "",
      magnitude: magnitudeRaw.trim() === "" ? Number.NaN : Number(magnitudeRaw),
      mode,
      startTick: Number.isInteger(Number(startTickRaw)) ? Number(startTickRaw) : Number.NaN,
      durationTicks: durationRaw.trim() === "" ? null : Number(durationRaw),
    }),
    [kind, selectedObjectId, selectedVar, magnitudeRaw, mode, startTickRaw, durationRaw],
  );
  const built = useMemo(
    () =>
      buildPerturbBody(draft, stateVarLabel(draft.targetStateVar, names), {
        hasSession: enabled,
        liveStateVars,
      }),
    [draft, names, enabled, liveStateVars],
  );
  /** 选中那个量今天扰不扰得动（三态；屏上作 `data-` 记号，让"不知道"与"不行"分得开）。 */
  const liveness = livenessOf(selectedVar?.stateVar ?? "", liveStateVars);

  // ── 收起态摘要数据：交出去，不自己画（那条常驻条在外壳里，归第 ② 张单）──
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
  useEffect(() => {
    onAppliedChange?.(applied);
  }, [applied, onAppliedChange]);

  const onApply = useCallback(async () => {
    if (!built.ok || !enabled) return;
    setBusy(true);
    try {
      await createSimPerturbation(sessionId as string, built.body);
      // ⛔ 改前到这里就收工了 —— 而按钮上写的是「施加**并推演**」。
      //    只建一条扰动、不推 tick，世界就没往前走一格 ⇒ 中栏指标一个数都不会变，
      //    用户点完只看到左栏「已施加」多一行，然后合理地问「结果在哪看」（仓主 2026-08-26 原话）。
      //    **按钮承诺了两件事只做了一件，这是屏上在说谎**，不是「还没做完」。
      //    推一格（n=1）与 `startTick: 0`（立即生效）配套：扰动在第 0 拍施加，
      //    推完第 1 拍才有「施加后 vs 施加前」的差值可看。要看累积效应再点几次。
      await simTick(sessionId as string, 1);
      // 失效**这个世界**的扰动清单：摘要条与时间轴都读这一份缓存。
      await qc.invalidateQueries({ queryKey: ["a", "sim-perturbations", sessionId ?? ""] });
      // 推过 tick 之后**世界态变了**，指标序列/会话/传导快照全部过期。
      //   ⚠ 刻意用**前缀**失效而不是逐个列 key：本壳中栏、右栏、底部抽屉读好几条
      //     `["a", "sim-*"]` 查询，逐个列迟早漏一条 —— 而漏掉的那条会在屏上显示**旧世界的数**，
      //     与新数并排放着，比整块不刷新更能骗人。
      await qc.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) && q.queryKey[0] === "a" && String(q.queryKey[1] ?? "").startsWith("sim"),
      });
      onApplied?.(built.body.label);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }, [built, enabled, sessionId, qc, onApplied]);

  /**
   * 一个下拉项。**扰不动的量照样列出来**（隐藏 = 假装没这个量，用户会以为自己没找对地方），
   * 但屏上写明它扰不动，选中后「施加」会被 `buildPerturbBody` 拦住并给出原因。
   */
  const varOption = (o: RailVarOption): JSX.Element => {
    const live = livenessOf(o.stateVar, liveStateVars);
    return (
      <option key={o.stateVar} value={o.stateVar} data-liveness={live}>
        {o.label.text}
        {o.label.named ? ` · ${o.stateVar}` : ""}
        {live === "not-in-world-state" ? "（今天扰不动）" : ""}
      </option>
    );
  };

  return (
    <div className={styles.rail} data-testid="rail-root" data-pages={pages.length}>
      {/* ── 子页签：一片 = 一个后端下发的业务域（未归域垫底并说明原因）── */}
      <div className={styles.tabs} role="tablist" aria-label="扰动子页" data-testid="rail-tablist">
        {pages.map((p) => (
          <button
            key={p.sliceId}
            type="button"
            role="tab"
            aria-selected={page?.sliceId === p.sliceId}
            data-testid={`rail-tab-${p.sliceId}`}
            data-slice={p.sliceId}
            data-rules={p.ruleCount}
            className={`${styles.tab} ${page?.sliceId === p.sliceId ? styles.tabOn : ""}`}
            onClick={() => {
              setSliceId(p.sliceId);
              setStateVar("");
              setTypeKey("");
              setObjectId("");
            }}
          >
            {p.name}
            <span className={styles.count}>{p.ruleCount}</span>
          </button>
        ))}
      </div>

      {page === null ? (
        <p className={styles.absent} data-testid="rail-no-pages">
          {rulesQ.isLoading
            ? "传导规则还在路上 —— 还不知道有哪些扰动因素"
            : "这个租户一条已发布的传导规则都没有 ⇒ 没有可扰的量（不是取不到）"}
        </p>
      ) : (
        <div className={styles.body} role="tabpanel" data-testid={`rail-panel-${page.sliceId}`}>
          {page.detail === null ? null : (
            <p className={styles.absent} data-testid="rail-slice-detail">
              {page.detail}
            </p>
          )}

          {/* ① 扰什么 —— 根源排前且默认可选；枢纽/末端归到第二组并标明「半路插入」 */}
          <label className={styles.fld}>
            <span className={styles.lbl}>扰什么 · 根源优先</span>
            <select
              data-testid="rail-statevar"
              value={selectedVar?.stateVar ?? ""}
              onChange={(e) => {
                setStateVar(e.target.value);
                setTypeKey("");
                setObjectId("");
              }}
            >
              {page.roots.length === 0 ? null : (
                <optgroup label={`根源（${page.roots.length}）· 没人喂它，扰它才是从源头扰`} data-testid="rail-group-root">
                  {page.roots.map(varOption)}
                </optgroup>
              )}
              {page.downstream.length === 0 ? null : (
                <optgroup label={`枢纽 / 末端（${page.downstream.length}）· 半路插入`} data-testid="rail-group-downstream">
                  {page.downstream.map(varOption)}
                </optgroup>
              )}
            </select>
          </label>
          <p
            className={styles.hint}
            data-testid="rail-layer-note"
            data-layer={selectedVar?.layer ?? ""}
            data-root={selectedVar?.isRoot === true ? "1" : "0"}
            data-liveness={liveness}
          >
            {selectedVar === null
              ? "这一片里一个量都没有"
              : selectedVar.isRoot
                ? `层级「${selectedVar.layer ?? "未下发"}」 —— 由后端按传导图入度/出度现算`
                : `层级「${selectedVar.layer ?? "未下发"}」 —— ${DOWNSTREAM_NOTE}`}
          </p>

          {/* ② 落点：类型 → 实例。两级都来自后端，缺格说得出为什么缺 */}
          <label className={styles.fld}>
            <span className={styles.lbl}>落点对象类型</span>
            <select
              data-testid="rail-typekey"
              value={selectedType ?? ""}
              onChange={(e) => {
                setTypeKey(e.target.value);
                setObjectId("");
              }}
            >
              {typeKeys.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.fld}>
            <span className={styles.lbl}>落点对象</span>
            <select
              data-testid="rail-objectid"
              value={selectedObjectId}
              disabled={choice.ids.length === 0}
              onChange={(e) => setObjectId(e.target.value)}
            >
              {choice.ids.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          {choice.absenceReason === null ? null : (
            <p className={styles.absent} data-testid="rail-object-absent">
              {choice.absenceReason}
            </p>
          )}

          {/* ③ 幅度与时长 */}
          <label className={styles.fld}>
            <span className={styles.lbl}>怎么扰</span>
            <select
              data-testid="rail-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as PerturbDraft["mode"])}
            >
              {MODES.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.fld}>
            <span className={styles.lbl}>幅度</span>
            <input
              data-testid="rail-magnitude"
              type="number"
              value={magnitudeRaw}
              onChange={(e) => setMagnitudeRaw(e.target.value)}
            />
          </label>
          <label className={styles.fld}>
            <span className={styles.lbl}>起始拍</span>
            <input
              data-testid="rail-starttick"
              type="number"
              min={0}
              value={startTickRaw}
              onChange={(e) => setStartTickRaw(e.target.value)}
            />
          </label>
          <label className={styles.fld}>
            <span className={styles.lbl}>持续拍数（留空 = 永久）</span>
            <input
              data-testid="rail-duration"
              type="number"
              min={1}
              value={durationRaw}
              onChange={(e) => setDurationRaw(e.target.value)}
            />
          </label>
          <label className={styles.fld}>
            <span className={styles.lbl}>事情的类别</span>
            <select
              data-testid="rail-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as PerturbationKind)}
            >
              {/* 词表 = 契约 `PerturbationKindSchema` 的 5 类（`PERTURBATION_KINDS` 单源） */}
              {PERTURBATION_KINDS.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>

          <p className={styles.hint} data-testid="rail-preview">
            {selectedVar === null
              ? ""
              : `${selectedVar.label.text} ${magnitudeText(mode, draft.magnitude)} · ${durationText(draft.startTick, draft.durationTicks)}`}
          </p>

          <button
            type="button"
            className={styles.apply}
            data-testid="rail-apply"
            data-blocked={built.ok ? "" : built.reason}
            disabled={!built.ok || busy}
            onClick={() => {
              void onApply();
            }}
          >
            {busy ? "施加中…" : "施加并推演"}
          </button>
          {built.ok ? null : (
            <p className={styles.absent} data-testid="rail-apply-blocked">
              {BLOCK_REASON_TEXT[built.reason]}
            </p>
          )}
        </div>
      )}

      {/* ── 今天扰不动的量：列出来 + 标原因 + 不可选（名单由差集现算，不是手写的）── */}
      <details className={styles.blocked} data-testid="rail-blocked" data-count={blocked.length}>
        <summary>今天扰不动的量（{blocked.length}）</summary>
        <p className={styles.absent} data-testid="rail-blocked-reason">
          {BLOCKED_REASON_TEXT}
        </p>
        <ul>
          {blocked.map((b) => (
            <li
              key={b.key}
              data-testid={`rail-blocked-${b.prop}`}
              data-reason={b.reason}
              aria-disabled="true"
            >
              {b.factorName} <span className={styles.mono}>{b.key}</span>
            </li>
          ))}
        </ul>
      </details>

      <p className={styles.hint} data-testid="rail-scope-note">
        沙盘改的只是这个推演世界，不写真实数据。结论要落地须走 Action 审批。
      </p>
    </div>
  );
}
