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
 * 把别的单的门整片打红。本组件安全，是因为它依赖的**五条渲染期读端**
 * （`fetchSimViewConfig` / `fetchDrillStateVarLayers` / `fetchPropagationRules` /
 *  `fetchSimPerturbations` / `fetchSimSessions`）
 * **恰好就是 `UnifiedSimShell` 今天已经在渲染期依赖的那五条**（`cfgQ`/`layersQ`/`rulesQ`/
 * `perturbQ`/`sessionsQ`）—— 它挂进去以后，宿主的 mock 面一个字都不用加。
 * 写口 `createSimPerturbation` 与 `simWorld`/`simTick` 只在**点击事件里**调用，
 * 渲染期不碰（同 `DrillPanel` 的 `simDrill`）。
 * 加第六条**渲染期**读端之前请先回来读这一段。
 *
 * ══ WO-SIM-TICK-GATE（2026-08-29）· 本轮改了三处，三处都是「屏上在说谎」而非「还没做完」══
 *
 *  ① **起始拍不再写死 `0`**。改前是 `useState("0")`，而种子世界建好时就已经在**第 3 拍**。
 *     `startTick: 0` 的扰动 POST 回 201、tick 回包的 `appliedPerturbations` 里**还带着它的 id**，
 *     而卡墙一个数都不动 —— 本轮 CEO 据此判「引擎不读输入」，判错了三次。
 *     现在默认值由**当前拍现算**（`defaultStartTick(curTick)`），过去的拍**提交时拦住**。
 *     机制与实测取值域表见 `perturbRailModel.ts` 头注（那里是判据自己家）。
 *
 *  ② **当前拍显式打在表单里**。改前屏上从来没写过「世界现在在第几拍」——
 *     而那正是「我填的起始拍对不对」唯一的参照物。没有它，起始拍这个输入框
 *     等于让用户在没有坐标系的情况下填坐标。
 *
 *  ③ **施加后给回执**。改前点完只多一行「已施加」，生效没生效一个字都没有 ⇒
 *     「引擎没读我的输入」与「这条扰动排在未来还没轮到它」在屏上一模一样。
 *     现在说清：落在第几拍 · 目标那一格从多少变到多少 · 全世界变了几个格 ·
 *     没动时**为什么**（还没轮到 / 幅度偏小 / 落点无出边 / 同一次推演里就到期回退了）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PerturbationKind, PropagationRulesResponse, SandboxViewConfig } from "@platform/contracts";
import {
  createSimPerturbation,
  simTick,
  simWorld,
  fetchDrillStateVarLayers,
  fetchPropagationRules,
  fetchSimPerturbations,
  fetchSimSessions,
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
  buildApplyReceipt,
  buildBlockedFactors,
  buildPerturbBody,
  buildSubpages,
  defaultStartTick,
  durationText,
  livenessOf,
  magnitudeText,
  objectChoices,
  receiptCellText,
  receiptCellsText,
  startTickPhaseOf,
  type ApplyReceipt,
  type CurTick,
  type PerturbDraft,
  type RailSubpage,
  type RailVarOption,
  type WorldCells,
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
  /**
   * 世界现在在第几拍 —— 起始拍那个输入框的**唯一参照物**（WO-SIM-TICK-GATE）。
   *
   * 缓存键 `["a","sim-sessions"]` 与 `UnifiedSimShell` 的 `sessionsQ` **逐字相同** ⇒
   * 挂进外壳后不多发一次请求；而 `onApply` 里那条前缀失效（`sim*`）也覆盖它，
   * 于是推完一拍以后这里的当前拍**自动跟着往前走**，不需要第二套刷新机制。
   */
  const sessionsQ = useQuery({
    queryKey: ["a", "sim-sessions"],
    queryFn: fetchSimSessions,
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

  /**
   * 这个世界现在在第几拍。**`null` = 不知道**（清单没回来 / 失败了 / 清单里没有这一条），
   * 不是「第 0 拍」—— 拿 `0` 兜底正是本单要修的那个静默坑（`buildPerturbBody` 会据此拦住提交）。
   */
  const curTick: CurTick = useMemo(() => {
    if (!enabled || sessionsQ.data === undefined) return null;
    const row = sessionsQ.data.items.find((x) => x.id === sessionId);
    return row === undefined ? null : row.curTick;
  }, [enabled, sessionsQ.data, sessionId]);

  const [stateVar, setStateVar] = useState("");
  const [typeKey, setTypeKey] = useState("");
  const [objectId, setObjectId] = useState("");
  const [kind, setKind] = useState<PerturbationKind>(FIRST_KIND);
  const [mode, setMode] = useState<PerturbDraft["mode"]>("delta");
  const [magnitudeRaw, setMagnitudeRaw] = useState("10");
  /**
   * 起始拍。**初值是空串而不是 `"0"`** —— 空串代表「还没有基准，填不出来」，
   * 而 `"0"` 是一个**看起来像已填好、实际永远不生效**的值（改前那一版就死在这里）。
   * 真值由下面那个 effect 从 `curTick` 现算灌进来。
   */
  const [startTickRaw, setStartTickRaw] = useState("");
  /** 用户有没有亲手改过起始拍 —— 改过就再也不许自动覆盖他填的数。 */
  const [startTickTouched, setStartTickTouched] = useState(false);
  const [durationRaw, setDurationRaw] = useState("");
  const [busy, setBusy] = useState(false);
  /** 上一次「施加并推演」的回执（`null` = 这一屏还没施加过；不是「施加了但没结果」）。 */
  const [receipt, setReceipt] = useState<ApplyReceipt | null>(null);

  /**
   * 当前拍一到手就把起始拍灌成**下一拍**（判据见 `defaultStartTick` 的注释）。
   *
   * 两条约束缺一不可：
   *  · **用户改过就不再覆盖**（`startTickTouched`）—— 否则他填的数会被下一次刷新吃掉；
   *  · 推完一拍后 `curTick` 会 +1，此时**继续跟着走**（只要用户没手动改过），
   *    于是连点两次「施加并推演」，第二次的默认值仍然是「下一拍」而不是已经过去的那一拍。
   */
  useEffect(() => {
    if (curTick === null || startTickTouched) return;
    setStartTickRaw(String(defaultStartTick(curTick)));
  }, [curTick, startTickTouched]);

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
        curTick,
      }),
    [draft, names, enabled, liveStateVars, curTick],
  );
  /** 起始拍落在哪一档（屏上 `data-phase` + 那句预告文案都读它）。 */
  const phase = curTick === null ? null : startTickPhaseOf(draft.startTick, curTick);
  /**
   * 选中那个量在**已发布**的传导规则里有没有出边 —— 回执里「没动」的一条真原因。
   * `null` = 规则清单还没回来 ⇒ 这一条不许说（同本文件其余「不知道 ≠ 没有」的纪律）。
   *
   * ⚠ 口径必须是 `status === "PUBLISHED"`：本组件取的是 `fetchPropagationRules(true)`（含草稿），
   * 而引擎只吃已发布的那一批 —— 拿含草稿的集合去判「有没有出边」，会把一条只活在草稿上的边
   * 当成真出边，然后回执少说一条真原因。
   */
  const hasOutEdge = useMemo(() => {
    if (rulesQ.data === undefined) return null;
    const sv = selectedVar?.stateVar ?? "";
    if (sv === "") return null;
    return rules.some((r) => r.status === "PUBLISHED" && r.sourceStateVar === sv);
  }, [rulesQ.data, rules, selectedVar]);
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
    setReceipt(null); // 上一条回执立刻作废：留着它会让用户把上次的结果读成这次的
    try {
      /**
       * 「施加前」那一份世界态 —— 回执里 `X → Y` 的左端（WO-SIM-TICK-GATE 缺陷 ③）。
       *
       * ⚠ 必须在 POST **之前**读：`POST …/perturbations` 对「建单时已生效」的扰动会
       * 在路由里**当场施加**（`app.ts` 的 `simApplyAtCurrentTick`），它回包里那份 `state`
       * 已经是施加**之后**的了 —— 拿它当左端，`X → Y` 会变成 `Y → Y`，回执当场说谎。
       * ⚠ 拿不到也照走（`null`）：回执会如实说「没法比」，**不许**因此把「变了 0 个格」印上屏。
       */
      let worldBefore: WorldCells | null = null;
      let tickBefore: number | null = null;
      try {
        const w = await simWorld(sessionId as string);
        worldBefore = w.state as WorldCells;
        tickBefore = w.tick;
      } catch {
        worldBefore = null;
      }

      await createSimPerturbation(sessionId as string, built.body);
      // ⛔ 改前到这里就收工了 —— 而按钮上写的是「施加**并推演**」。
      //    只建一条扰动、不推 tick，世界就没往前走一格 ⇒ 中栏指标一个数都不会变，
      //    用户点完只看到左栏「已施加」多一行，然后合理地问「结果在哪看」（仓主 2026-08-26 原话）。
      //    **按钮承诺了两件事只做了一件，这是屏上在说谎**，不是「还没做完」。
      //    推一格（n=1）与默认起始拍「下一拍」配套：扰动落在即将产出的那一拍上，
      //    推完正好有「施加后 vs 施加前」的差值可看。要看累积效应再点几次。
      const ticked = await simTick(sessionId as string, 1);
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
      // ── 回执：屏上要说清「生效没生效 / 在第几拍 / 动了几个格」（缺陷 ③）──
      //    `tickBefore` 优先用 `GET …/world` 回的那一格（它与 `worldBefore` 是同一次读、必然自洽）；
      //    那一跳失败时回落到渲染态的 `curTick`；两个都没有就回落成「推完那一格减一」。
      //    ⚠ 三级回落**必须按这个顺序** —— 拿一个与 `worldBefore` 不同源的拍数去算相位，
      //    回执会在边界上说错一拍。
      const tb = tickBefore ?? curTick ?? ticked.curTick - 1;
      setReceipt(
        buildApplyReceipt({
          body: built.body,
          targetText: stateVarLabel(built.body.targetStateVar, names).text,
          tickBefore: tb,
          tickAfter: ticked.curTick,
          worldBefore,
          worldAfter: (ticked.state ?? null) as WorldCells | null,
          hasOutEdge,
        }),
      );
      onApplied?.(built.body.label);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }, [built, enabled, sessionId, qc, onApplied, curTick, names, hasOutEdge]);

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

      {/* ── 缺陷 ②：世界现在在第几拍。**这是起始拍那个输入框唯一的参照物** ──
          改前屏上一个字都没有 ⇒ 用户在没有坐标系的情况下填坐标，
          而默认值恰好又是一个永远不生效的 0。「不知道」与「第 0 拍」在这里必须分开说。 */}
      <p className={styles.tick} data-testid="rail-curtick" data-curtick={curTick ?? ""}>
        {curTick === null ? (
          <>世界现在在第几拍：<b>还不知道</b> —— 会话清单这一跳没回来（不是第 0 拍）</>
        ) : (
          <>
            世界现在在 <b>第 {curTick} 拍</b> · 点「施加并推演」会推到 <b>第 {curTick + 1} 拍</b>
          </>
        )}
      </p>

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
          {/* ── 缺陷 ①：起始拍。默认由当前拍现算（`defaultStartTick`），过去的拍提交时拦住。
                 `min` 也跟着当前拍走 —— 让浏览器的原生上下箭头也踩不进那个静默坑。 */}
          <label className={styles.fld}>
            <span className={styles.lbl}>起始拍{curTick === null ? "" : `（不早于第 ${curTick} 拍）`}</span>
            <input
              data-testid="rail-starttick"
              type="number"
              min={curTick ?? 0}
              value={startTickRaw}
              onChange={(e) => {
                setStartTickTouched(true);
                setStartTickRaw(e.target.value);
              }}
            />
          </label>
          <p className={styles.hint} data-testid="rail-starttick-note" data-phase={phase ?? ""}>
            {curTick === null
              ? "还不知道世界在第几拍 —— 起始拍没有基准，先不填（这一档不许提交，猜一个 0 就是那个「请求成功、屏上不动」的坑）"
              : phase === "past"
                ? `第 ${draft.startTick} 拍已经推过去了 —— 这一档不许提交（改成 ${curTick} 或更大）`
                : phase === "now"
                  ? `第 ${curTick} 拍 = 现在就发生（后端「不填起始拍」的默认语义）。` +
                    `⚠ 这一档从本拍起就生效，而这次「施加并推演」还要再走一拍 ⇒ 下游会比默认档多吃一拍传导；` +
                    `想让下游读数正好等于屏上公示系数的那一次传导，用第 ${curTick + 1} 拍。`
                  : phase === "next"
                    ? `第 ${curTick + 1} 拍 = 下一拍 —— 正是这次「施加并推演」要推的那一拍（默认值）`
                    : `第 ${draft.startTick} 拍在将来 —— 本次只推到第 ${curTick + 1} 拍，还要再推 ${draft.startTick - curTick - 1} 拍它才落地`}
          </p>
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

          {/* ── 缺陷 ③：施加回执。**没有它，「引擎没读我的输入」与「排在未来还没轮到它」
                 在屏上长得一模一样** —— 本轮就是这样被判成「引擎是死的」。
                 `data-moved` 三态（`yes`/`no`/`unknown`）：「没动」与「没法比」不许合并。 */}
          {receipt === null ? null : (
            <div
              className={styles.receipt}
              data-testid="rail-receipt"
              data-phase={receipt.phase}
              data-reached={receipt.reached ? "1" : "0"}
              data-moved={receipt.moved === null ? "unknown" : receipt.moved ? "yes" : "no"}
              data-changed-cells={receipt.changedCells ?? ""}
            >
              <p className={styles.receiptHead} data-testid="rail-receipt-headline">
                {receipt.headline}
              </p>
              <p className={styles.hint} data-testid="rail-receipt-cell">
                {receiptCellText(receipt)}
              </p>
              <p className={styles.hint} data-testid="rail-receipt-cells">
                {receiptCellsText(receipt)}
              </p>
              {receipt.notes.length === 0 ? null : (
                <ul className={styles.receiptNotes} data-testid="rail-receipt-notes">
                  {receipt.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </div>
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
