import { useCallback, useMemo, useState } from "react";
import { GOAL_REGISTRY } from "@platform/contracts";
import {
  createSimPerturbation,
  fetchSimCompare,
  invokeSolver,
  simBranch,
  simCheckpoint,
  type SimCompareSeries,
} from "@/api/endpoints";
import { toast, toastError } from "@/store/toastStore";
import { InfoPopover } from "@/components/InfoPopover";
import zh from "@/locales/zh";
import { useActionDraft } from "./shared";
import styles from "./SimViews.module.css";

/**
 * ══ WO-V4-PLAYS · 推演沙盘「方案环」（`docs/PRD-sandbox-v4-backward-derivation.md` §3.3）══
 *
 * 闭环一句话：**拨扰动 → 指标越线 → `decision_play` 出 N 个方案 → 每个方案开一个平行世界 →
 * 并排比对 → 采纳走 Action 审批**。
 *
 * ── 这一整块是「接线」，不是「造能力」（PRD §1 已逐条确认承载物为真，本单逐个复验过）──
 *  · N 个方案      = `POST /a/v1/solvers/decision_play/invoke` 的 `options[]`（真求解器真跑真算）
 *  · 平行世界      = `POST …/sim/sessions/:id/checkpoint` + `POST …/:id/branch`（真端点）
 *  · 世界里的差异  = `POST …/sim/sessions/:child/perturbations`（真端点·契约唯一施加实现）
 *  · 并排比对      = `GET /a/v1/sim/compare?a=&b=`（真端点）
 *  · 采纳          = `POST /a/v1/action-drafts`（R4 正门）
 * 本文件**不新增任何真值源、不新增任何端点、不新增任何事件**。
 *
 * 上面六条**逐条连真后端跑过**（2026-08-13 · `SEED_DEMO=1` 内存态 · 非 `VITE_MOCK` 桩）：
 * `decision_play` 回 3 个 option（根因 `seg_attain_ess` 缺口 27.8%）；三次 `branch` 各出一个子会话；
 * `compare` 两列在落点上差 0.6098；`POST /a/v1/action-drafts` 回 `status: "PENDING_APPROVAL"`
 * （**不是** EXECUTED）。复验：起 `node apps/datacore/dist/server.js`（`SEED_DEMO=1`）后按上列端点顺打，
 * 或跑 `pnpm --filter frontend-shell exec vitest run test/sandbox-plays.seam.test.tsx`。
 *
 * ── ⛔ R4 红线（本块最容易被写错的一处）────────────────────────────────────────
 * 采纳**只**创建 `ActionDraft` 并进审批流。沙盘改的是 `SimSession` 的世界态，**不是本体真值**；
 * 「比对做得顺手」不构成直写真值的理由。本文件里没有任何一处调用对象写入端点 ——
 * 判据在 `sandbox-plays.seam.test.tsx`：它把本块发出的**全部**请求 URL 收集起来与白名单做**等号**
 * 比较（不是 `toContain` —— 后者在未裁的超集上恒真）。
 *
 * ── ⚠ 平行世界之间的差异从哪来：**口径必须写在脸上**（PRD §2.3 末段的同一个病）──────
 * `simBranch` 从同一个检查点派生出的子世界**逐字节相同** —— 不给它们各自一处差异，
 * 「并排比对」就只会显示两列一模一样的数，那是一块看着在工作、实则永远为零的面板。
 * 差异的来源是**一处显式的确定性投影**（不是新真值）：
 *
 *     回补比例 frac = clamp01(option.closesGap / rootCause.gap)      ← 两者同量纲，比值无量纲
 *     本次扰动在该状态变量上的实测效应 Δ = 扰动后值 − 扰动前值        ← 取自后端两次回包，不是前端重算
 *     方案世界 = 分支世界 + 一条 `delta: −Δ × frac` 的扰动           ← 走真端点，引擎照常规整/传导
 *
 * 读作：「这个方案按 `decision_play` 自己给的 `closesGap` 能补掉根因缺口的 frac，
 * 于是在沙盘里把本次扰动在这条状态变量上造成的效应回补 frac」。
 * 它是**推演值**，不是实测值 —— 故屏上常驻 `sandbox-play-caliber` 一行把上面三行原样写出来。
 * 用 Δ（实测效应）而不是用用户填的 magnitude：`set`/`scale`/`delta` 三种模式各算一遍就是第二套真相源，
 * 且引擎还会做上下限规整，前端自己算的那个数会与世界里的数悄悄不相等。
 *
 * ── R6 确定性 ──────────────────────────────────────────────────────────────────
 * 无 `Date.now()`、无 `Math.random()`、无 `crypto.randomUUID()`：检查点标签用 `curTick`，
 * 方案世界的顺序 = `options[]` 的顺序（求解器已定序）。同输入同输出。
 *
 * ── R14 零写死 ─────────────────────────────────────────────────────────────────
 * 方案数 / 方案名 / 六维名 / 根因指标名一律取自 `decision_play` 回包；
 * 指标下拉的候选取自契约 `GOAL_REGISTRY`（跨包唯一允许的共享出处）。
 * 本文件里没有一个行业实体名、没有一个业务阈值。
 */

// ── decision_play 回包形状（= `solvers/service.ts:358` 的 SOLVER_OUTPUT_SHAPE 那一行）──────
// 与 `DecisionPlayView.tsx` 的同名接口逐字段一致：那是另一张**页**的投影，这是沙盘里的**环**，
// 两处都只读同一份回包。刻意不把类型抽到第三个文件去共享：契约包里没有它，
// 而在 app 之间共享类型要走 `@platform/contracts`（contracts-only-shared），
// 为一个前端内部投影往契约包里塞类型是更坏的耦合。
interface PlayDims {
  closesGap: number;
  cost: number;
  cycleDays: number;
  risk: number;
  exposure: number;
  reversibility: number;
}
interface PlayOption extends PlayDims {
  optionId: string;
  factorId: string;
  label: string;
  sourceKind: "solver" | "agent";
  provenance: { kind: string; basis: string; drillType: string; drillId: string; drillValue: number };
}
interface PlayMatrixRow {
  optionId: string;
  label: string;
  dims: PlayDims;
}
interface DecisionPlayOut {
  rootCause: { factorId: string; label: string; metricKey: string; gap: number; unit: string } | null;
  options: PlayOption[];
  matrix: PlayMatrixRow[];
  recommendedPlan: { planId: string; optionIds: string[]; totalClosesGap: number; totalCost: number };
  sandboxNarrowing: { beforeGap: number; afterGap: number; narrowedPct: number; ticks: number };
  summary: string;
}

/**
 * 比对矩阵的六维**显示元数据**。
 *
 * `key` 一律取自回包 `matrix[].dims` 的真实键（下面 `dimsOf` 现读，不写死键集）；
 * 本表只补「这一维叫什么、越大越好还是越小越好」——`better` 是**方向语义**，
 * 不是阈值，也不是业务常数：它决定「最优列」标在哪一格。
 * 回包里出现本表没有的维 ⇒ 按原键名显示、不判最优（诚实降级，绝不悄悄丢一列）。
 */
const DIM_META: Record<string, { label: string; better: "high" | "low" }> = {
  closesGap: { label: "补缺口", better: "high" },
  cost: { label: "代价", better: "low" },
  cycleDays: { label: "周期", better: "low" },
  risk: { label: "风险", better: "low" },
  exposure: { label: "敞口", better: "low" },
  reversibility: { label: "可逆", better: "high" },
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const fmt = (n: number): string => (Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : "—");
/** 比较器全序：平手返回 0（`a<b?-1:1` 对相等元素恒不返回 0，违反契约，V8 给任意顺序）。 */
const byStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** 一个方案的平行世界（分支会话 + 它拿到的那一处回补）。 */
export interface PlayWorld {
  optionId: string;
  label: string;
  /** 分支子会话 id（`SimSession.id`）。 */
  worldId: string;
  /** 回补比例 = clamp01(closesGap / gap)。 */
  frac: number;
  /** 真施加的 delta（= −Δ×frac）。 */
  delta: number;
  /** 回补后，该对象该状态变量在**后端回包**里的值（不是前端算的）。 */
  value: number;
}

/** 本次扰动的落点与实测效应 —— 由 `SandboxView` 从**后端两次回包**折算，本组件只消费。 */
export interface PlayAnchor {
  objectId: string;
  stateVar: string;
  /** 扰动前该变量的值（施加前屏上世界态）。 */
  before: number;
  /** 扰动后该变量的值（**后端回包**里的新值）。 */
  after: number;
  label: string;
}

export interface SandboxPlaysPanelProps {
  sessionId: string | null;
  curTick: number;
  /** 没施加过扰动 ⇒ `null` ⇒ 本块诚实说「先拨一条扰动」，不给一个点了没反应的按钮。 */
  anchor: PlayAnchor | null;
}

/**
 * 方案环面板。**左区**一等位置（左区是沙盘唯一输入区，PRD-v3 §1①）——
 * 本块带 `<select>`/`<button>`，摆进主区/下区会被 `sandbox-three-zone.seam` §3 的等号断言当场判红，
 * 那条门是对的：输入与结果混排正是这一屏此前难读的根因。
 */
export default function SandboxPlaysPanel({ sessionId, curTick, anchor }: SandboxPlaysPanelProps) {
  /** 指标候选 = 契约 `GOAL_REGISTRY`（跨包唯一共享出处）；空串 = 不传 metricKey，引擎自选最严重越线者。 */
  const goals = useMemo(
    () => Object.values(GOAL_REGISTRY).slice().sort((a, b) => byStr(a.key, b.key)),
    [],
  );
  const [metricKey, setMetricKey] = useState<string>("");
  const [out, setOut] = useState<DecisionPlayOut | null>(null);
  const [solving, setSolving] = useState(false);
  /** 求方案失败时，把**后端原话**摆上屏（不自己编一句"暂无数据"把原因盖掉）。 */
  const [solveError, setSolveError] = useState<string | null>(null);
  const [worlds, setWorlds] = useState<PlayWorld[]>([]);
  const [branching, setBranching] = useState(false);
  const [pickA, setPickA] = useState<string>("");
  const [pickB, setPickB] = useState<string>("");
  const [compare, setCompare] = useState<{ a: SimCompareSeries; b: SimCompareSeries } | null>(null);
  const [comparing, setComparing] = useState(false);
  const adopt = useActionDraft(); // 采纳 → R4 Action 草稿（沙盘模拟态**不直写真值**）

  const rc = out?.rootCause ?? null;
  /** 扰动在该状态变量上的**实测效应**（后端回包相减，不是前端按 mode 重算）。 */
  const effect = anchor === null ? 0 : anchor.after - anchor.before;

  // ── ① 求方案（真求解器）────────────────────────────────────────────────────
  const onSolve = useCallback(async () => {
    if (solving) return;
    setSolving(true);
    setSolveError(null);
    try {
      const args: Record<string, unknown> = {};
      if (metricKey) args.metricKey = metricKey;
      const res = await invokeSolver("decision_play", args);
      const data = res.data as DecisionPlayOut;
      setOut(data);
      // 换了一批方案 ⇒ 旧的平行世界与旧的比对**必须作废**：留着就是拿上一个根因的世界
      // 冒充这一个根因的世界（"看着合理的假差值"，与 `baseWorld` 那处同一个病）。
      setWorlds([]);
      setCompare(null);
      setPickA("");
      setPickB("");
      toast(`已取回 ${data.options.length} 个方案（根因 ${data.rootCause?.metricKey ?? "—"}）`, "success");
    } catch (e) {
      setOut(null);
      setWorlds([]);
      setCompare(null);
      setSolveError((e as { message?: string } | undefined)?.message ?? String(e));
      toastError(e);
    } finally {
      setSolving(false);
    }
  }, [metricKey, solving]);

  // ── ② 每个方案 → 一个平行世界（同一检查点派生 ⇒ 同逻辑时刻可比）─────────────
  const onOpenWorlds = useCallback(async () => {
    if (!sessionId || out === null || rc === null || anchor === null || branching) return;
    setBranching(true);
    try {
      // 一个检查点，全部方案共用 —— 各branch 各存一个检查点会让它们**起点不同**，
      // 那样比出来的差异里混着"起点就不一样"，不是方案差异。
      const cp = await simCheckpoint(sessionId, `plays@tick${curTick}`);
      const next: PlayWorld[] = [];
      for (const o of out.options) {
        const child = await simBranch(sessionId, cp.id);
        const frac = clamp01(rc.gap > 0 ? o.closesGap / rc.gap : 0);
        const delta = -effect * frac;
        const applied = await createSimPerturbation(child.id, {
          // kind 只管展示分类（契约注释：不进传导规则），沿用本次扰动的语义域；
          // 真正决定世界怎么变的是 mode/magnitude/落点三项。
          kind: "capacity_loss",
          targetObjectId: anchor.objectId,
          targetStateVar: anchor.stateVar,
          magnitude: delta,
          mode: "delta",
          durationTicks: null,
          label: `${o.optionId} · 回补 ${(frac * 100).toFixed(1)}%（closesGap ${fmt(o.closesGap)}${rc.unit} / 缺口 ${fmt(rc.gap)}${rc.unit}）`,
        });
        next.push({
          optionId: o.optionId,
          label: o.label,
          worldId: child.id,
          frac,
          delta,
          // 取**后端回包**里的值：前端按 delta 自己加一遍就是第二套真相源（引擎还会规整）。
          value: applied.state[anchor.objectId]?.[anchor.stateVar] ?? Number.NaN,
        });
      }
      setWorlds(next);
      setPickA(next[0]?.worldId ?? "");
      setPickB(next[1]?.worldId ?? next[0]?.worldId ?? "");
      setCompare(null);
      toast(`已开 ${next.length} 个平行世界（各自一条回补扰动）`, "success");
    } catch (e) {
      toastError(e);
    } finally {
      setBranching(false);
    }
  }, [sessionId, out, rc, anchor, branching, curTick, effect]);

  // ── ③ 并排比对（真端点）────────────────────────────────────────────────────
  const onCompare = useCallback(async () => {
    if (!pickA || !pickB || comparing) return;
    setComparing(true);
    try {
      setCompare(await fetchSimCompare(pickA, pickB));
    } catch (e) {
      toastError(e);
    } finally {
      setComparing(false);
    }
  }, [pickA, pickB, comparing]);

  // ── ④ 采纳（R4 正门：只落 ActionDraft，绝不写本体真值）──────────────────────
  const onAdopt = useCallback(
    (w: PlayWorld) => {
      if (!sessionId || rc === null || anchor === null) return;
      const o = out?.options.find((x) => x.optionId === w.optionId);
      adopt.mutate({
        actionTypeKey: "plan_change",
        payload: {
          versionId: `sim:${sessionId}@tick${curTick}`,
          reason: `采纳推演沙盘方案「${w.label}」（根因 ${rc.metricKey} 缺口 ${fmt(rc.gap)}${rc.unit} · 该方案补 ${fmt(o?.closesGap ?? 0)}${rc.unit}）`,
          patch: {
            source: "sim_sandbox_play",
            simulated: true, // 诚实标：模拟态结论，采纳才经 Action 正门写真值（R4）
            sessionId,
            tick: curTick,
            optionId: w.optionId,
            optionLabel: w.label,
            worldId: w.worldId,
            metricKey: rc.metricKey,
            factorId: rc.factorId,
            gap: rc.gap,
            unit: rc.unit,
            closesGap: o?.closesGap ?? null,
            cost: o?.cost ?? null,
            cycleDays: o?.cycleDays ?? null,
            // 口径随行（R13 溯源）：审批人必须看得见「这个世界的差异是怎么造出来的」。
            caliber: {
              anchorObjectId: anchor.objectId,
              anchorStateVar: anchor.stateVar,
              perturbationEffect: effect,
              recoveredFraction: w.frac,
              appliedDelta: w.delta,
            },
          },
        },
      });
    },
    [sessionId, rc, anchor, out, curTick, adopt, effect],
  );

  // ── 渲染 ───────────────────────────────────────────────────────────────────
  const options = out?.options ?? [];
  const matrix = out?.matrix ?? [];
  const recommended = useMemo(() => new Set(out?.recommendedPlan.optionIds ?? []), [out]);
  /** 六维键**现读回包**（不写死键集）：多一维少一维都照回包渲染。 */
  const dimKeys = useMemo(() => {
    const row = matrix[0];
    return row ? Object.keys(row.dims).sort(byStr) : [];
  }, [matrix]);
  /** 逐维最优（方向语义来自 `DIM_META`，值全部来自回包·非写死）。 */
  const bestByDim = useMemo(() => {
    const m: Record<string, string> = {};
    for (const k of dimKeys) {
      const meta = DIM_META[k];
      if (!meta) continue; // 未知维不判最优（诚实降级）
      let best: PlayMatrixRow | undefined;
      for (const row of matrix) {
        if (!best) { best = row; continue; }
        const v = (row.dims as unknown as Record<string, number>)[k] ?? 0;
        const bv = (best.dims as unknown as Record<string, number>)[k] ?? 0;
        if (meta.better === "high" ? v > bv : v < bv) best = row;
      }
      if (best) m[k] = best.optionId;
    }
    return m;
  }, [dimKeys, matrix]);

  const worldById = useMemo(() => new Map(worlds.map((w) => [w.worldId, w])), [worlds]);
  /** 比对的两列 —— 只取 tick0（两个世界都由同一检查点派生，tick0 就是"同一逻辑时刻"）。 */
  const compareRows = useMemo(() => {
    if (compare === null || anchor === null) return null;
    const pick = (s: SimCompareSeries): { tick: number; value: number } | null => {
      const t0 = s[0];
      if (!t0) return null;
      const v = t0.state[anchor.objectId]?.[anchor.stateVar];
      return v === undefined ? null : { tick: t0.tick, value: v };
    };
    return { a: pick(compare.a), b: pick(compare.b) };
  }, [compare, anchor]);

  return (
    // 全局 `panel` 是 `styles/*.css` 里的真类；`SimViews.module.css` **没有** `.panel`
    // （`styles.panel` 在那里恒 undefined —— 现读该文件确认过，不照抄同屏那处写法）。
    <div className="panel" data-testid="sandbox-plays" style={{ padding: 12, marginTop: 12 }}>
      <div className={styles.secHead}>{zh.sim.sandbox.plays.title}</div>
      <div className={styles.sub} style={{ marginBottom: 8, lineHeight: 1.6 }} data-testid="sandbox-plays-intro">
        {zh.sim.sandbox.plays.intro}
      </div>

      {/* ── ① 指标 + 求方案 ─────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <span className={styles.sub}>{zh.sim.sandbox.plays.metricLabel}</span>
        <select
          data-testid="sandbox-plays-metric"
          aria-label={zh.sim.sandbox.plays.metricLabel}
          value={metricKey}
          onChange={(e) => setMetricKey(e.target.value)}
        >
          {/* 空值档 = 不传 metricKey ⇒ 引擎按「缺口最大的越线指标」自选（`gapAttribution` 的缺省分支）。 */}
          <option value="">{zh.sim.sandbox.plays.metricAuto}</option>
          {goals.map((g) => (
            <option key={g.key} value={g.key}>
              {g.name}（{g.key} · {g.unit}）
            </option>
          ))}
        </select>
        <button
          className="btn sm primary"
          data-testid="sandbox-plays-solve-btn"
          disabled={solving}
          onClick={() => void onSolve()}
        >
          {solving ? zh.sim.sandbox.plays.solving : zh.sim.sandbox.plays.solve}
        </button>
      </div>

      {solveError !== null && (
        <div className={styles.sub} data-testid="sandbox-plays-solve-error" style={{ lineHeight: 1.6, color: "var(--warn-txt)" }}>
          {zh.sim.sandbox.plays.solveFailed}
          <br />
          <span className="mono">{solveError}</span>
        </div>
      )}

      {rc !== null && (
        <div className={styles.sub} data-testid="sandbox-plays-root" style={{ lineHeight: 1.6, marginBottom: 6 }}>
          {zh.sim.sandbox.plays.rootPrefix}
          <b data-testid="sandbox-plays-root-label">{rc.label}</b>
          {" · "}
          <span className="mono" data-testid="sandbox-plays-root-metric">{rc.metricKey}</span>
          {" "}
          {zh.sim.sandbox.plays.gapWord}{" "}
          <b className="mono" data-testid="sandbox-plays-root-gap">{fmt(rc.gap)}{rc.unit}</b>
          {out !== null && (
            <>
              {" · "}
              <span data-testid="sandbox-plays-narrowing">
                {zh.sim.sandbox.plays.narrowing(out.sandboxNarrowing.narrowedPct, out.recommendedPlan.optionIds.length)}
              </span>
            </>
          )}
        </div>
      )}

      {/* ── ② 方案卡（数量/名字/六维全部来自回包 · R14 零写死）───────────────── */}
      {options.length > 0 && (
        <div data-testid="sandbox-plays-options" data-count={options.length} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {options.map((o) => (
            <div
              key={o.optionId}
              data-testid={`sandbox-play-option-${o.optionId}`}
              data-recommended={recommended.has(o.optionId) ? "1" : "0"}
              className={styles.sub}
              style={{ lineHeight: 1.6, borderLeft: "2px solid var(--muted2)", paddingLeft: 6 }}
            >
              <b>{o.label}</b>
              {recommended.has(o.optionId) ? <span data-testid={`sandbox-play-rec-${o.optionId}`}> ★{zh.sim.sandbox.plays.recommended}</span> : null}
              <br />
              {dimKeys.map((k) => {
                // 「这一维上最优的是谁」全部由回包真值算出（方向语义见 `DIM_META`）——
                // 未知维不判最优（`data-best="0"`），绝不悄悄按某个默认方向猜一个。
                const best = bestByDim[k] === o.optionId;
                return (
                  <span
                    key={k}
                    data-testid={`sandbox-play-dim-${o.optionId}-${k}`}
                    data-best={best ? "1" : "0"}
                    style={{ marginRight: 8, color: best ? "var(--ok-txt)" : undefined }}
                  >
                    {DIM_META[k]?.label ?? k} <b className="mono">{fmt((o as unknown as Record<string, number>)[k] ?? 0)}</b>
                    {best ? "✓" : ""}
                  </span>
                );
              })}
              <br />
              <span className={styles.sub} data-testid={`sandbox-play-prov-${o.optionId}`}>
                {zh.sim.sandbox.plays.basis}
                {o.provenance.kind} · {o.provenance.basis} = {fmt(o.provenance.drillValue)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── ③ 开平行世界 ────────────────────────────────────────────────── */}
      {options.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {anchor === null ? (
            <div className={styles.sub} data-testid="sandbox-plays-need-perturbation" style={{ lineHeight: 1.6 }}>
              {zh.sim.sandbox.plays.needPerturbation}
            </div>
          ) : effect === 0 ? (
            <div className={styles.sub} data-testid="sandbox-plays-zero-effect" style={{ lineHeight: 1.6 }}>
              {zh.sim.sandbox.plays.zeroEffect(anchor.objectId, anchor.stateVar)}
            </div>
          ) : (
            <>
              <button
                className="btn sm"
                data-testid="sandbox-plays-branch-btn"
                disabled={!sessionId || branching}
                onClick={() => void onOpenWorlds()}
              >
                {branching ? zh.sim.sandbox.plays.branching : zh.sim.sandbox.plays.branch(options.length)}
              </button>
              {/* 口径常驻第一层（不是免责声明，是这块数字的出处）—— 静默降层 = 删除。 */}
              <div className={styles.sub} data-testid="sandbox-play-caliber" style={{ marginTop: 6, lineHeight: 1.7 }}>
                {zh.sim.sandbox.plays.caliber(anchor.objectId, anchor.stateVar, effect)}
                <InfoPopover topic={zh.sim.sandbox.info.playCaliber} testId="play-caliber">
                  <span data-testid="sandbox-play-caliber-note">{zh.sim.sandbox.info.playCaliberBody}</span>
                </InfoPopover>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── ④ 平行世界清单 + 并排比对 + 采纳 ─────────────────────────────── */}
      {worlds.length > 0 && (
        <div style={{ marginTop: 8 }} data-testid="sandbox-plays-worlds" data-count={worlds.length}>
          <div className={styles.secHead}>{zh.sim.sandbox.plays.worldsTitle}</div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            {worlds.map((w) => (
              <li
                key={w.worldId}
                data-testid={`sandbox-play-world-${w.optionId}`}
                data-world-id={w.worldId}
                className={styles.sub}
                style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", lineHeight: 1.6 }}
              >
                <b>{w.label}</b>
                <span className="mono">{w.worldId}</span>
                <span data-testid={`sandbox-play-world-frac-${w.optionId}`}>
                  {zh.sim.sandbox.plays.recovered((w.frac * 100).toFixed(1))}
                </span>
                <span className="mono" data-testid={`sandbox-play-world-value-${w.optionId}`}>
                  {anchor?.stateVar ?? ""} = {fmt(w.value)}
                </span>
                <button
                  className="btn sm primary"
                  data-testid={`sandbox-play-adopt-${w.optionId}`}
                  disabled={adopt.isPending}
                  onClick={() => onAdopt(w)}
                >
                  {adopt.isPending ? zh.sim.sandbox.plays.adopting : zh.sim.sandbox.plays.adopt}
                </button>
              </li>
            ))}
          </ul>

          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
            <span className={styles.sub}>{zh.sim.sandbox.plays.compareLabel}</span>
            <select data-testid="sandbox-plays-pick-a" aria-label={zh.sim.sandbox.plays.pickA} value={pickA} onChange={(e) => setPickA(e.target.value)}>
              {worlds.map((w) => (
                <option key={w.worldId} value={w.worldId}>{w.label}</option>
              ))}
            </select>
            <select data-testid="sandbox-plays-pick-b" aria-label={zh.sim.sandbox.plays.pickB} value={pickB} onChange={(e) => setPickB(e.target.value)}>
              {worlds.map((w) => (
                <option key={w.worldId} value={w.worldId}>{w.label}</option>
              ))}
            </select>
            <button className="btn sm" data-testid="sandbox-plays-compare-btn" disabled={!pickA || !pickB || comparing} onClick={() => void onCompare()}>
              {comparing ? zh.sim.sandbox.plays.comparing : zh.sim.sandbox.plays.compare}
            </button>
          </div>

          {compareRows !== null && (
            <div className={styles.sub} data-testid="sandbox-plays-compare" style={{ marginTop: 6, lineHeight: 1.7 }}>
              {compareRows.a === null || compareRows.b === null ? (
                <span data-testid="sandbox-plays-compare-empty">{zh.sim.sandbox.plays.compareEmpty}</span>
              ) : (
                <>
                  <div data-testid="sandbox-plays-compare-a">
                    A · {worldById.get(pickA)?.label ?? pickA} · tick {compareRows.a.tick} ·{" "}
                    <b className="mono">{anchor?.stateVar}={fmt(compareRows.a.value)}</b>
                  </div>
                  <div data-testid="sandbox-plays-compare-b">
                    B · {worldById.get(pickB)?.label ?? pickB} · tick {compareRows.b.tick} ·{" "}
                    <b className="mono">{anchor?.stateVar}={fmt(compareRows.b.value)}</b>
                  </div>
                  <div data-testid="sandbox-plays-compare-diff" data-diff={String(compareRows.b.value - compareRows.a.value)}>
                    {zh.sim.sandbox.plays.diff(fmt(compareRows.b.value - compareRows.a.value))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* R4 红线常驻第一层：这一块能做什么、绝不做什么。 */}
      <div className={styles.sub} data-testid="sandbox-plays-r4" style={{ marginTop: 8, lineHeight: 1.7 }}>
        {zh.sim.sandbox.plays.r4}
      </div>
    </div>
  );
}
