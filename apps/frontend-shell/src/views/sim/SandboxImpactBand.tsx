import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FinanceWorldProjectionOutput, ImpactChange } from "@platform/contracts";
import { InfoPopover } from "@/components/InfoPopover";
import { runSolver } from "@/api/endpoints";
import zh from "@/locales/zh";
import { ImpactAnalysisPanel } from "./ImpactAnalysisPanel";
import styles from "./SandboxConsole.module.css";

/**
 * ══ WO-SANDBOX-V3 · ③下区「影响带」——「试了之后，哪里变了、值多少钱」 ══
 * （`docs/PRD-sandbox-v3-three-zone.md` §1③）
 *
 * ── 🔴 「财务指标随扰动的动态变化」的三形态判定（铁律 0.5 · 动手前先定性）──────
 *
 * PRD §1③ 点名这是「本单唯一可能需要新增取数的部分」。实测定性 = **形态③「接了线接错地方」**，
 * **不是**「没接线」，也**不是**「接了线没数据」—— 三者修法完全不同，混了必修错地方。
 *
 * 取证（2026-08-13 实测，`origin/claude/integ-reclaim-batch-r1r2r6@ad897bf4`）：
 *   金丝雀（先自证检索工具没坏）：
 *     `grep -rn 'createSimPerturbation(' apps/frontend-shell/src | grep -v api/endpoints.ts`
 *     → 命中 `views/sim/SandboxView.tsx:641`（一个我确定存在的调用点）。工具是好的。
 *   目标符号：
 *     `grep -rn 'runImpactAnalysis(' apps/frontend-shell/src | grep -v api/endpoints.ts`
 *     → `views/sim/ImpactAnalysisPanel.tsx:367`（**有** src 调用方 ⇒ 排除「没接线」）
 *   再追一层（grep 的结果不是结论）：
 *     `<ImpactAnalysisPanel` → `views/WhatIfView.tsx:266`
 *     `WhatIfView`           → `App.tsx:138`（`/v/what-if`）· `SandboxView.tsx:1481`（模式 `tryone`）
 *   ⇒ 它有**两条真生产渲染路径**，入参也不恒空（`worldId` 来自真会话、`change` 来自用户表单）
 *     ⇒ 也排除「接了线没数据」。
 *   真实缺口是**挂载点**：它挂在「试一手」那个模式的**临时假设表单**上，
 *   而沙盘「现状」屏（`mode === "now"`，也就是仓主截图里那一屏）**零渲染**，
 *   且它的 `change` 来自手填的 `{objectType,objectId,prop,value}`、**不是已经施加的那条扰动**。
 *   修法 = **补挂载点**（本文件），不新增取数链路、不改契约、不动后端。
 *
 * ── 那 `finance_pnl` 呢？它是**错的那个承载物**，本文件刻意不用 ─────────────────
 * `apps/datacore/src/solvers/service.ts:3412` 的签名是 `financePnl(ctx: AuthCtx)` ——
 * **没有 worldId / sessionId / scope 任何一个入参**，它读的是本体真值
 * （`listByType("FinancePlan")` + `listByType("DemandSegment")`）。
 * 也就是说：**同一租户下，施加任何扰动它都返回逐字节相同的一组数**。
 * 把它摆进本带会得到一块"看起来是财务、实际永远不动"的面板 —— 那不是把缺口补上，
 * 那是把「缺记号」的问题当成「值不够像真的」来修，得到一屏更像真的假数据，比留空更坏。
 * 故本带的处置是：**缺金额口径就报缺金额口径**（`financeGap` 浮层，常驻第一层记号）。
 *
 * ── ✅ WO-FINANCE-WORLDSTATE：那个缺口**已经补上了**（上面这段判断因此部分过期）─────
 * 上一版说得对的是**判断**（"别把 `finance_pnl` 摆上来"），说得不完整的是**结论**
 * （"所以这一带只能留记号"）。缺的从来不是记号，是**一个吃 worldId 的求解器**。
 * 现在有了：`finance_world_projection`（`apps/datacore/src/solvers/finance-world.ts`）——
 * 同一份 FinancePlan / ARInvoice 真值做基线，用**这个世界里**的
 * `Order.costPressure` / `Customer.receivablePressure` / `ARInvoice.overduePressure`
 * 沿种子传导规则折算成金额，换算除数与传导链的真系数随回包下发（前端零写死系数）。
 *
 * ⚠ **`finance_pnl` 一个字都没动** —— 上面那段对它的定性今天**仍然成立**，
 *   而且那是它的**正确行为**不是 bug（本体真值口径本来就不该随沙盘世界变）。
 *   两条口径并存、各答各的问题；本带用的是后者。
 *
 * ⚠ **诚实位没有被删，只是换了承载的事实**（规范 §1：允许降层、绝不允许删除）：
 *   `financeGap` 浮层仍常驻第一层，内容改成「这块金额是怎么来的 / 什么时候没有」；
 *   并且第一层**多了一个常驻口径行**（`sandbox-impact-finance-caliber`：**推演投影 · 非实测**）——
 *   一个推演数被读成实测数，比不给这个数更坏，所以这句话不许只待在浮层里。
 *   世界态为空 / 无金额基线 / 该能力未开通 ⇒ **退回诚实缺口记号并给出后端原话**，
 *   绝不显示 0、绝不编一个数。
 *
 * ── 本带的两半（PRD §1③ 原文「两半，左右分列」）──────────────────────────────
 *  ① **逐节点指标影响**：`ImpactAnalysisPanel`，世界固定为沙盘当前会话、扰动一施加就自动跑。
 *     它的 KPI 维（`AffectedKpiItem`：`metricKey` / `unit` / `changedProps[].before→after`）
 *     **就是**平台今天唯一「带单位、且在被隔离世界里随变更重算」的指标出处。
 *  ② **世界态随扰动的变化**：基线快照 → 当前 tick 的逐 stateVar 差分。
 *     数据是现成的（`SimSession.baseSnapshot` 与 `world` 都已在宿主手里），**零新增请求**。
 *
 * ── R4 / R6 ────────────────────────────────────────────────────────────────
 * 本带**只读**：一个写世界态的控件都没有（PRD §4.4 的判据由
 * `sandbox-three-zone.seam.test.tsx` §4 用**等号**咬住，不是 `toContain`）。
 * 无时钟、无随机：差分是两个快照的纯函数。
 */

export interface SandboxImpactBandProps {
  /** 沙盘当前推演会话 id = 影响传播要跑的那个世界。没有会话 ⇒ 传 `null`。 */
  sessionId: string | null;
  /** 已施加扰动折算出的那"一处变更"。没施加过 ⇒ `null`（面板会诚实说"还没有假设"）。 */
  change: ImpactChange | null;
  /** 本世界的基线快照（`SimSession.baseSnapshot`）。取不到 ⇒ `null`，差分整块显示诚实空。 */
  baseWorld: Record<string, Record<string, number>> | null;
  /** 当前世界态（`GET …/:id/world` 或 tick/扰动响应就地落屏的那一份）。 */
  world: Record<string, Record<string, number>>;
  /** 当前 tick（差分是"基线 → 这个 tick"，不写出来读者不知道比的是哪两点）。 */
  curTick: number;
  /** 这个世界承载的状态变量名（`SandboxViewConfig.stateVars`，本体派生 · R14 零业务常数）。 */
  stateVars: string[];
}

/** 全对象均值。口径与顶栏读数**同一条**（`SandboxView` 的 `sandbox-kpi-*`），本文件不另立一套。 */
function avgOf(w: Record<string, Record<string, number>>, v: string): number | null {
  const objs = Object.keys(w);
  if (objs.length === 0) return null;
  return objs.reduce((a, o) => a + (w[o]?.[v] ?? 0), 0) / objs.length;
}

export interface StateVarDelta {
  v: string;
  base: number;
  now: number;
  delta: number;
}

/**
 * 基线 → 当前的逐 stateVar 差分，**按偏离绝对值降序**。
 *
 * ⚠ 比较器必须是**全序**：平手返回 0。写 `a<b?-1:1` 对相等元素恒不返回 0，违反比较器契约，
 *   V8 会给出**任意**顺序。同源取证见 `SandboxView.tsx` 顶栏读数排序处那条注释
 *   （含 2026-08-13 实测记录与复验命令）。本带一屏**全是等值项**（未扰动时 delta 恒 0），
 *   正是最容易踩到那个坑的输入形状。
 *   复验：把下面的 `|| (a.v < b.v ? …)` 换成 `|| -1`，跑
 *   `pnpm --filter frontend-shell exec vitest run test/sandbox-three-zone.seam.test.tsx`。
 */
export function deriveStateVarDeltas(
  baseWorld: Record<string, Record<string, number>> | null,
  world: Record<string, Record<string, number>>,
  stateVars: string[],
): StateVarDelta[] | null {
  if (baseWorld === null) return null;
  const rows: StateVarDelta[] = [];
  for (const v of stateVars) {
    const base = avgOf(baseWorld, v);
    const now = avgOf(world, v);
    if (base === null || now === null) continue;
    rows.push({ v, base, now, delta: now - base });
  }
  return rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || (a.v < b.v ? -1 : a.v > b.v ? 1 : 0));
}

/** 判「动了没有」的容差。浮点减法会给出 1e-15 这种"动了"，那不是动了，是二进制。 */
const EPS = 1e-9;
export const isMoved = (d: StateVarDelta): boolean => Math.abs(d.delta) > EPS;

// ══════════════════════════════════════════════════════════════════════════════
// WO-FINANCE-WORLDSTATE · 金额投影面板（本带右半的第一块）
// ══════════════════════════════════════════════════════════════════════════════

/** 后端错误信封里的原话（拿不到就把整个对象串出来 —— 宁可难看，也不替它编一句解释）。 */
function backendMessage(e: unknown): string {
  const env = e as { error?: { message?: string; code?: string } } | undefined;
  return env?.error?.message ?? env?.error?.code ?? (e instanceof Error ? e.message : JSON.stringify(e));
}

/** 金额格式化：只做**显示**，不做任何换算（换算全在后端，前端零系数）。 */
const fmtMoney = (v: number): string =>
  v.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const signed = (v: number): string => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtMoney(Math.abs(v))}`;
const dirOf = (v: number): "up" | "down" | "flat" => (v > EPS ? "up" : v < -EPS ? "down" : "flat");

/** 一行「基线 → 投影（Δ）」。结构与下面的 `DeltaRow` 同款（同一屏两种数不该长成两个样）。 */
function MoneyRow({ label, baseline, projected, testId }: { label: string; baseline: number; projected: number; testId: string }) {
  const delta = projected - baseline;
  return (
    <li className={styles.deltaRow} data-testid={testId} data-moved={Math.abs(delta) > EPS ? "1" : "0"}>
      <span className={styles.deltaName}>{label}</span>
      <span className={styles.deltaVals} data-testid={`${testId}-vals`}>
        {fmtMoney(baseline)} → <b>{fmtMoney(projected)}</b>
      </span>
      <span className={styles.deltaAmt} data-testid={`${testId}-amt`} data-dir={dirOf(delta)}>
        {signed(delta)}
      </span>
    </li>
  );
}

export interface FinanceProjectionPanelProps {
  /** 要投影哪个世界。`null` ⇒ 还没有会话（诚实空，不发请求）。 */
  worldId: string | null;
  /** 当前 tick —— 进 queryKey：tick 一推进，金额必须跟着重取，否则屏上是上一拍的钱。 */
  curTick: number;
}

/**
 * 金额投影面板。
 *
 * **一个系数都不在前端**：金额、Δ、换算除数、传导链系数全部来自回包。
 * 前端只做三件事：格式化、分层（第一层结论 / 第二层明细）、以及在拿不到数时**据实报缺**。
 */
export function FinanceProjectionPanel({ worldId, curTick }: FinanceProjectionPanelProps) {
  const q = useQuery({
    // tick 进 key：不进的话 tick 推进后 react-query 命中旧缓存 ⇒ 屏上金额停在上一拍（静默错答）。
    queryKey: ["finance-world-projection", worldId, curTick],
    enabled: worldId !== null,
    retry: false,
    queryFn: async () => {
      const res = await runSolver("finance_world_projection", { worldId });
      return res.data as FinanceWorldProjectionOutput;
    },
  });

  const out = q.data;
  const costLine = out?.lines.find((l) => l.role === "COST");
  const marginLine = out?.lines.find((l) => l.role === "MARGIN");
  const usable = out !== undefined && out.available;

  return (
    <div data-testid="sandbox-impact-finance-money">
      <div className={styles.zoneHead}>
        <h2>{zh.sim.sandbox.impact.moneyTitle}</h2>
        <span className={styles.zoneQ}>{zh.sim.sandbox.impact.moneyQuestion}</span>
        {/*
         * 诚实位记号（`?`）：内容在浮层，记号常驻第一层。
         * 规范 §1「允许降层、绝不允许删除」—— 本单改写了它承载的事实，位置一寸没挪。
         */}
        <InfoPopover topic={zh.sim.sandbox.impact.financeGapTitle} testId="impact-finance-gap">
          <span data-testid="sandbox-impact-finance-gap">{zh.sim.sandbox.impact.financeGapBody}</span>
        </InfoPopover>
      </div>

      {/*
       * 🔴 **口径常驻第一层**（不是浮层里的一句话，也不是 hover 才出现的）：
       * 这块是**推演投影**不是实测值。判据取自回包的 `basis.kind === "PROJECTION"` ——
       * 前端不自己声称"这是投影"，而是把后端的口径声明原样立在第一层。
       * 拿不到回包时同样立着（此时它说明的是"这一带本来给的是什么"）。
       */}
      <p className={styles.stateLine} data-testid="sandbox-impact-finance-caliber">
        <b>{zh.sim.sandbox.impact.moneyCaliber}</b>
        {out ? ` · ${zh.sim.sandbox.impact.moneyCaliberDetail(out.basis.divisor)}` : ""}
      </p>

      {worldId === null ? (
        <p className={styles.stateLine} data-testid="sandbox-impact-finance-no-session">
          {zh.sim.sandbox.impact.moneyNoSession}
        </p>
      ) : q.isPending ? (
        <p className={styles.stateLine} data-testid="sandbox-impact-finance-loading">
          {zh.sim.sandbox.impact.moneyLoading}
        </p>
      ) : q.isError ? (
        /* 请求本身失败（能力未开通 / 网络）⇒ 退回诚实缺口记号 + **后端原话**，不显示 0。 */
        <p className={styles.stateLine} data-testid="sandbox-impact-finance-failed">
          {zh.sim.sandbox.impact.moneyFailed(backendMessage(q.error))}
        </p>
      ) : !usable ? (
        /* 求解器说不可用（世界态为空 / 无金额基线）⇒ 同样据实报缺，理由用它自己的原话。 */
        <p className={styles.stateLine} data-testid="sandbox-impact-finance-unavailable">
          {zh.sim.sandbox.impact.moneyUnavailable(out?.unavailableReason ?? "")}
        </p>
      ) : (
        <>
          {/* 第一层：只放结论型的三个数（成本 / 毛利 / 逾期敞口是"钱上差多少"的答案）。 */}
          <ul className={styles.deltaList} data-testid="sandbox-impact-finance-lines">
            {costLine ? (
              <MoneyRow
                label={costLine.subject}
                baseline={costLine.rolling}
                projected={costLine.projected}
                testId="sandbox-impact-finance-line-cost"
              />
            ) : null}
            {marginLine ? (
              <MoneyRow
                label={marginLine.subject}
                baseline={marginLine.rolling}
                projected={marginLine.projected}
                testId="sandbox-impact-finance-line-margin"
              />
            ) : null}
            {out.cash.available ? (
              <MoneyRow
                label={zh.sim.sandbox.impact.moneyArRow}
                baseline={out.cash.arBaseline}
                projected={out.cash.arProjected}
                testId="sandbox-impact-finance-line-ar"
              />
            ) : null}
          </ul>

          {/* 第二层：换算链（真规则真系数）。"凭什么是这个数"降层，但**可点开**，不是没有。 */}
          {out.chain.length > 0 ? (
            <details className={styles.zoneSection} data-testid="sandbox-impact-finance-chain">
              <summary data-testid="sandbox-impact-finance-chain-toggle">
                {zh.sim.sandbox.impact.moneyChain(out.chain.length)}
              </summary>
              <ul className={styles.deltaList} data-testid="sandbox-impact-finance-chain-list">
                {out.chain.map((h) => (
                  <li className={styles.deltaRow} key={h.ruleId} data-testid={`sandbox-impact-finance-hop-${h.ruleKey}`}>
                    <span className={styles.deltaName}>{h.from}</span>
                    <span className={styles.deltaVals}>→ {h.to}</span>
                    <span className={styles.deltaAmt} data-dir="flat">
                      ×{h.coefficient}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {/* 第二层：诚实缺席逐条（后端 `notes`）。降层可以，删掉不行。 */}
          {out.notes.length > 0 ? (
            <details className={styles.zoneSection} data-testid="sandbox-impact-finance-notes">
              <summary data-testid="sandbox-impact-finance-notes-toggle">
                {zh.sim.sandbox.impact.moneyNotes(out.notes.length)}
              </summary>
              <ul className={styles.deltaList} data-testid="sandbox-impact-finance-notes-list">
                {out.notes.map((n) => (
                  <li className={styles.deltaRow} key={n}>
                    <span className={styles.deltaName}>{n}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}

export function SandboxImpactBand({
  sessionId,
  change,
  baseWorld,
  world,
  curTick,
  stateVars,
}: SandboxImpactBandProps) {
  const deltas = useMemo(() => deriveStateVarDeltas(baseWorld, world, stateVars), [baseWorld, world, stateVars]);
  const moved = deltas === null ? [] : deltas.filter(isMoved);
  const flat = deltas === null ? [] : deltas.filter((d) => !isMoved(d));

  return (
    <div className={styles.impactBand} data-testid="sandbox-impact-band">
      {/* ── ① 逐节点指标影响（PRD §1③ 左半）──────────────────────────────── */}
      <section className={styles.impactHalf} data-testid="sandbox-impact-nodes">
        <div className={styles.zoneHead}>
          <h2>逐节点指标影响</h2>
          <span className={styles.zoneQ}>这条扰动波及了哪些对象 / 流程 / 决策 / KPI</span>
        </div>
        {sessionId === null ? (
          <p className={styles.stateLine} data-testid="sandbox-impact-no-session">
            还没有推演世界 —— 沙盘会在配置就绪后自动建一个，建好这里才有世界可跑。
          </p>
        ) : (
          <ImpactAnalysisPanel change={change} worldId={sessionId} autoRun />
        )}
      </section>

      {/* ── ② 财务 / 世界态随扰动的动态变化（PRD §1③ 右半）─────────────────── */}
      <section className={styles.impactHalf} data-testid="sandbox-impact-finance">
        {/*
         * ②-a 金额（WO-FINANCE-WORLDSTATE 补的那一半）。
         * 摆在指数差分**之前**：仓主问的是「财务指标」，钱是结论、指数是过程。
         * 诚实位 `?`（`impact-finance-gap`）随面板一起挪进来 —— 它解释的正是这块金额，
         * 挂在下面那块指数差分的头上属于挂错地方（记号要贴着它说明的那个东西）。
         */}
        <FinanceProjectionPanel worldId={sessionId} curTick={curTick} />

        {/* ②-b 世界态指数差分（原有·一字未改） */}
        <div className={styles.zoneHead}>
          <h2>{zh.sim.sandbox.impact.deltaTitle}</h2>
          <span className={styles.zoneQ}>
            {zh.sim.sandbox.impact.deltaQuestion} · tick {curTick}
          </span>
        </div>

        {deltas === null ? (
          <p className={styles.stateLine} data-testid="sandbox-impact-delta-missing">
            {zh.sim.sandbox.impact.deltaBaselineMissing}
          </p>
        ) : (
          <>
            <p className={styles.stateLine} data-testid="sandbox-impact-delta-head">
              {moved.length === 0
                ? zh.sim.sandbox.impact.deltaNone
                : zh.sim.sandbox.impact.deltaMoved(moved.length, deltas.length)}
            </p>
            {/* 第一层只放**动了的那些**：没动的项在这一区里零信息量（"16 个几乎相同的数"
                正是上一轮顶栏被点名的那个病）。没动的一项不删，降进 `<details>`。 */}
            {moved.length > 0 ? (
              <ul className={styles.deltaList} data-testid="sandbox-impact-delta-list">
                {moved.map((d) => (
                  <DeltaRow key={d.v} d={d} />
                ))}
              </ul>
            ) : null}
            {flat.length > 0 ? (
              <details className={styles.zoneSection} data-testid="sandbox-impact-delta-rest">
                <summary data-testid="sandbox-impact-delta-rest-toggle">
                  {zh.sim.sandbox.impact.deltaRest(flat.length)}
                </summary>
                <ul className={styles.deltaList} data-testid="sandbox-impact-delta-rest-list">
                  {flat.map((d) => (
                    <DeltaRow key={d.v} d={d} />
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

/** 一行差分：名字 · 基线 → 现值 · 变化量。三样都是规范 §1 允许在第一层的（名字 / 数值 / 状态）。 */
function DeltaRow({ d }: { d: StateVarDelta }) {
  const up = d.delta > 0;
  return (
    <li className={styles.deltaRow} data-testid={`sandbox-impact-delta-${d.v}`} data-moved={isMoved(d) ? "1" : "0"}>
      <span className={styles.deltaName}>{d.v}</span>
      <span className={styles.deltaVals} data-testid={`sandbox-impact-delta-${d.v}-vals`}>
        {d.base.toFixed(1)} → <b>{d.now.toFixed(1)}</b>
      </span>
      <span
        className={styles.deltaAmt}
        data-testid={`sandbox-impact-delta-${d.v}-amt`}
        data-dir={isMoved(d) ? (up ? "up" : "down") : "flat"}
      >
        {isMoved(d) ? `${up ? "+" : "−"}${Math.abs(d.delta).toFixed(1)}` : "0.0"}
      </span>
    </li>
  );
}

export default SandboxImpactBand;
