import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SimCounterfactualResult } from "@platform/contracts";
import { createSimSession, fetchPropagationRules, fetchSimSessions, fetchSimViewConfig, patchSimDisabledRules, simCounterfactual } from "@/api/endpoints";
import { toastError } from "@/store/toastStore";
import { HintDot } from "./shared";
import {
  buildDiffRows,
  buildDomainSlices,
  buildEdgeRows,
  buildVerdict,
  deriveBaseSnapshot,
  pickProbeSession,
  PROBE_WORLD_PROVENANCE,
  PROBE_WORLD_PROVENANCE_DETAIL,
  resolveActiveSlice,
  toggleEdge,
  UNASSIGNED_DOMAIN_DETAIL,
  UNASSIGNED_SLICE_ID,
} from "./edgeActiveModel";
// 命名成 `css` 而不是惯用的 `s`：本文件已有 `const tid = (s: string) => …`，
// 用 `s` 会被那个形参遮蔽 —— 遮蔽后类名读作 `undefined`，样式**静默全丢**（不报错）。
import css from "./EdgeActivePanel.module.css";

/**
 * ══ WO-ACTIVE-EDGE-UX · 推演边的 active 开关 + 关掉后的结果对照 ══
 *
 * 仓主原话（一字不改）：「所有推演的功能，包括"推演沙盘"就需要借鉴这个设计UX」
 * —— 指参考件里那个能力：**关系边上有 active 开关，关掉这条边，就能看到推演结果怎么变**。
 * 关键在「**所有**推演的功能」：这不是"给沙盘加个 checkbox"，是一条**横向**要求，
 * 所以本组件是一个**共享件**，八个推演页各挂一处（挂载点见各页 `EdgeActivePanel` 的引用）。
 *
 * ── 病灶定性（铁律 0.5 三形态，先定性再动手）─────────────────────────────────
 * **形态①「没接线」**，不是"接了线没数据"、也不是"接了线接错地方"——三者修法不同。
 * 实测日期 2026-08-14，基线 `origin/claude/verify-reclaim-6@a069c976`：
 *   `grep -rn "disabledRule|excludeRule|ruleOverride|mutedRule|disabledEdge|edgeOverride|suppressRule" -E`
 *   扫描面 `apps/datacore/src apps/agentcore/src apps/frontend-shell/src packages/contracts/src`  →  **0 命中**
 *   （⚠ 别写成含通配的 pathspec `apps/<星>/src` —— 本仓实测它恒 0 命中，会把"工具坏了"读成"代码干净"）
 *   金丝雀（同一条命令、同一个工具，只换符号）：`propagateTick` → 命中（引擎/路由/测试多处）
 *   ⇒ 工具是好的，0 是真的 0：「本次推演里屏蔽某条传导边」这个概念此前全仓不存在。
 * 前端侧同样是零：`grep -rln "propagationRule\|/sim/propagation-rules" apps/frontend-shell/src`
 * 当日只命中 `SimReadinessPanel.tsx`（只数了个 `propagationCount`）与 `mocks/handlers.ts`
 * —— **没有任何一页把传导边画出来给人看**。本组件就是那条缺失的链路。
 * ⚠ 保质期：本文件落地后上述检索**必然命中本文件**；要复验"接线前什么样"请在基线提交上跑。
 *
 * ── ⛔ 为什么不用现成的 `PropagationRule.status`（本单最容易做错的地方）───────────
 * `status: DRAFT|PUBLISHED|RETIRED` 是**这条边在不在世界里**的持久发布态，对全租户生效。
 * 拿它当"关掉看看"的开关会同时炸三头：
 *   ① 顶 R4 —— 改它是**本体真值写入**，须经 Action 审批；用户点一下就永久改了全租户的本体 = 事故；
 *   ② 顶 R2 的精神 —— 一个人的假设推演污染同租户所有人的推演结果；
 *   ③ **不可对照** —— `status` 一改，"改之前"就没了，而用户要的恰恰是对照。
 * 本组件写的是 `SimSession.disabledRuleKeys`（**会话级反事实**），与 `status` **正交**：
 * `status` 决定"这条边在不在世界里"，本开关决定"这次推演假装它不在"。两个字段都要，不许合并。
 * 写它**不需要 Action 审批**，依据是 R4-sim（本体 §5）：仿真世界自己那一行的写入不是真值写入。
 *
 * ── 屏上每个字段的出处（"不许编造"）─────────────────────────────────────────
 *   边行：`GET /a/v1/sim/propagation-rules` → `PropagationRule`
 *         源/目标/链路/系数/延迟 逐字段直取，**前端零加工**
 *   差值：`POST /a/v1/sim/sessions/:id/counterfactual` → `SimCounterfactualResult.diffs`
 *         差值本身由**契约** `diffTickStates` 算（前后端同一支），本组件只排版不做算术
 *   结论：`buildVerdict`（edgeActiveModel.ts）——「没变」的两种成因显式分开，见该函数注释
 * **后端没有的一律不画**：没有任何端点回答"这条边贡献了多少百分比"，故本组件不显示归因占比。
 *
 * ── 对比度（WO-R9-CONTRAST 刚测出小字 CJK 在 4.52:1 下不可读）──────────────────
 * ⚠ **本段口径已被 WO-DISRUPTION-CARDS 改写，别照旧文读**：原文是「正文最小 12px；
 *   弱化色不低于 `#b6c3d4`（≈6.6:1）」，那是**内联样式时代**的写法。现在颜色全部走
 *   `EdgeActivePanel.module.css` 的语义 token（`--muted` / `--txt` / `--danger-txt` …），
 *   对比度由主题的 token 定义负责，本组件不再自己钉死色值 —— 钉死的那一版在暗/亮/暖
 *   三套主题里只有一套是对的。字号档位见该 CSS 文件顶注（现行最小 11px，用于 tag 徽标）。
 * 关掉的边用**虚线 + 降低不透明度到 0.72（不是 0.4）+ 显式"已关闭"文字标记**表达降级——
 * 只靠颜色/透明度表达状态在低对比下等于没表达，故文字标记是必须的那一路。
 */

/**
 * ══ WO-DISRUPTION-CARDS · 按业务域切片的卡片版面 ══════════════════════════════════
 *
 * 仓主看了推演页截图后的原话：「**按照卡片，建立不同扰动因素的分类展示**」。
 * 改前病灶三条叠在一起：**35 条边一次全倒**（demo 租户实测）· **无栅格**（标签长短不一，
 * 勾选框不在一条竖线上）· **字号过小**。三条各自的对策：
 *   ① 分类切片 —— 每个业务域一个 chip（带条数），点一个只显示该域的行；
 *   ② 固定三段栅格 `18px | 1fr | max-content`（见 `.row`），控件左边缘在同一条竖线上；
 *   ③ 一行两级 —— 人话名 13.5px 在上、系统键 11.5px mono 在下（改前全屏最小 12px）。
 *
 * ── ⛔ 分组依据只有一个：边自己带的 `domainKey`（后端算好随边下发）───────────────
 * 本文件**没有、也不许有**任何「哪条规则属于哪个域」的对照表。理由是本体 §8
 * `G-GATE-ROSTER-HANDCOPIED`：手抄名单里没有的对象**永远绿、永远漏** —— 新增一条边
 * 忘了加进表里，它就从分类里消失，而没有任何东西会报错。
 * 域在 `apps/datacore/src/seed.ts` 的 `resolveRuleDomain` 里从**流程承载物登记册现算**
 * （`carrierTypeKey → domainKey`），那是种子作者选边时本来就在用的关系。
 *
 * ── 人话名的出处（"不许编造"）─────────────────────────────────────────────────
 * 对象类型的中文名取自本体 `ObjectType.displayName`（`GET /a/v1/ontology/object-types`），
 * 查不到就**显裸键**。⚠ **状态变量（`loadIndex` / `demandLoad` …）在全仓没有任何中文名**
 * —— 它们只作为字符串存在于传导规则里，本体的 `properties`/`derivedProperties` 都不含它们。
 * 所以状态变量**只出现在第二级的系统键那一行**，第一级不给它编一个名字（R14 零业务常数）。
 * 这是**诚实缺席**，补法见本单交单报告"没做的部分"。
 */

/** 未选中任何 chip 时的初始值：`null` ⇒ `resolveActiveSlice` 回落到第一片（不是"什么都不显示"）。 */
const NO_SLICE_PICKED = null;

export interface EdgeActivePanelProps {
  /**
   * 本页正在推演的那个会话。沙盘传自己的；其余推演页不持有会话 ⇒ 传 `undefined`，
   * 本组件回落到"本租户最近一个可推演会话"（`pickProbeSession`，判据见该函数）。
   */
  sessionId?: string | null;
  /** 挂载页标识，只用于 testid 前缀（让八处挂载在测试里彼此可分辨），不参与任何业务判断。 */
  pageKey: string;
  /** 对照跑几个 tick。缺省 1 —— 一格就够看出方向；要看累积效应再调。 */
  ticks?: number;
}

export default function EdgeActivePanel({ sessionId, pageKey, ticks = 1 }: EdgeActivePanelProps) {
  const qc = useQueryClient();
  const [pendingDisabled, setPendingDisabled] = useState<string[] | null>(null);
  const [result, setResult] = useState<SimCounterfactualResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  /** 当前选中的域切片（`DomainSliceVM.sliceId`）。`null` = 用户还没选过 ⇒ 回落到第一片。 */
  const [pickedSlice, setPickedSlice] = useState<string | null>(NO_SLICE_PICKED);

  const rulesQuery = useQuery({
    queryKey: ["a", "sim-propagation-rules"],
    queryFn: () => fetchPropagationRules(true),
    staleTime: 60_000,
  });
  /**
   * 对象类型的中文名（`ObjectType.displayName`）**随边一起下发**，本面板不另打一次请求。
   *
   * ⚠ 这不是省一次请求那么简单 —— 初稿在这里加了 `useQuery(fetchObjectTypes)`，实测当场炸：
   * 本组件挂在 8 个推演页上，而**全仓 29 个前端测试文件 `vi.mock("@/api/endpoints")` 做部分 mock**，
   * 新增一个 endpoint 导入 ⇒ 它们全部报 `No "fetchObjectTypes" export is defined on the mock`。
   * 挨个去补那 29 份 mock 是治标：下一个往共享面板加依赖的人还会再炸一次。
   * 治本是**让这个面板只依赖一个响应** —— 类型名由 `GET /a/v1/sim/propagation-rules`
   * 在**读时投影**（`app.ts` 那条路由 join 本租户本体），前端零加工、零额外依赖。
   */
  const typeDisplayNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rulesQuery.data?.items ?? []) {
      if (r.sourceTypeName) m.set(r.sourceTypeKey, r.sourceTypeName);
      if (r.targetTypeName) m.set(r.targetTypeKey, r.targetTypeName);
    }
    return m;
  }, [rulesQuery.data]);
  // 只有在本页没有自带会话时才去要会话列表——沙盘不该为了这个面板多发一次请求。
  const sessionsQuery = useQuery({
    queryKey: ["a", "sim-sessions"],
    queryFn: fetchSimSessions,
    enabled: !sessionId,
    staleTime: 60_000,
  });

  const probeSession = useMemo(
    () => (sessionId ? { id: sessionId } : pickProbeSession(sessionsQuery.data?.items ?? [])),
    [sessionId, sessionsQuery.data],
  );
  /** 本页没有会话、租户也一个都没有时，就地开出来的**探针世界**（懒建：只在第一次拨开关时才建）。 */
  const [probeCreated, setProbeCreated] = useState<string | null>(null);
  const effectiveSessionId = probeSession?.id ?? probeCreated;
  /** 差值算在哪个世界上：自带会话/租户已有会话 = 真世界；探针世界 = tick0 为 DERIVED 占位。 */
  const probeIsSynthetic = !sessionId && !probeSession && probeCreated !== null;

  /**
   * 拿一个能算对照的世界。顺序：本页自带 → 租户已有 → **就地开一个探针世界**。
   *
   * ⚠ 为什么允许"就地开"：`SimSession` 是仿真世界，不是真值（R4-sim），建它不经 Action 审批；
   * 而且 tick0 走的是**沙盘自己那一份** `deriveBaseSnapshot` —— 不是本单新发明的世界。
   * ⚠ 为什么必须**懒建**：页面一挂载就建会话 = 每打开一次推演页就多一行世界，属于无声副作用。
   *   只在用户真的拨了开关（= 明确表达"我想看关掉之后怎么样"）时才建。
   * ⚠ 为什么必须**标出处**：tick0 是 `hash01` 占位值（沙盘自己也把它盖章 `DERIVED`），
   *   拿它算出来的差值只反映**边的结构影响**，不是实测量级。不标 = 拿占位值冒充实测（顶 R13）。
   */
  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (effectiveSessionId) return effectiveSessionId;
    const cfg = await fetchSimViewConfig();
    const s = await createSimSession({ baseSnapshot: deriveBaseSnapshot(cfg), scope: { kind: "GLOBAL", target: null } });
    setProbeCreated(s.id);
    void qc.invalidateQueries({ queryKey: ["a", "sim-sessions"] });
    return s.id;
  }, [effectiveSessionId, qc]);

  const rules = rulesQuery.data?.items ?? [];
  /** 屏上的屏蔽集：拨过开关就用本地候选集，否则用会话上持久的那一份。 */
  const sessionDisabled = useMemo(() => {
    if (sessionId) return null; // 沙盘自带会话时，持久集合由 counterfactual 回包带回
    const s = sessionsQuery.data?.items.find((x) => x.id === effectiveSessionId);
    return s?.disabledRuleKeys ?? [];
  }, [sessionId, sessionsQuery.data, effectiveSessionId]);
  const disabled = pendingDisabled ?? result?.disabledRuleKeys ?? sessionDisabled ?? [];
  const rows = useMemo(() => buildEdgeRows(rules, disabled, typeDisplayNames), [rules, disabled, typeDisplayNames]);
  /** 按业务域切片。**条数从 `rows` 现算**（`buildDomainSlices` 里 count = rows.length），不另存一个数。 */
  const slices = useMemo(() => buildDomainSlices(rows), [rows]);
  const activeSliceId = resolveActiveSlice(slices, pickedSlice);
  const activeSlice = slices.find((x) => x.sliceId === activeSliceId) ?? null;
  const diffRows = useMemo(() => (result ? buildDiffRows(result.diffs) : []), [result]);
  const verdict = result ? buildVerdict(result) : null;

  /**
   * 拨开关 ⇒ **立刻**要一次对照（§3.3「不是再点一次运行」）。
   * 发的是候选屏蔽集，**不落库** —— 用户还在试，试的过程不该改会话。
   */
  const onToggle = useCallback(
    async (key: string, nextActive: boolean) => {
      const next = toggleEdge(disabled, key, nextActive);
      setPendingDisabled(next);
      setFailure(null);
      setBusy(true);
      try {
        const sid = await ensureSession();
        if (sid === null) return; // 拿不到世界：开关状态照记，差值诚实缺（下方已写明原因）
        setResult(await simCounterfactual(sid, { n: ticks, disabledRuleKeys: next }));
      } catch (e) {
        // 失败只报**能从响应直接读出**的事实，不写任何内联因果断言（诚实灰纪律）。
        setResult(null);
        setFailure(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [disabled, ensureSession, ticks],
  );

  /** 把当前候选集**落到会话上**（此后这个世界真的按"关掉"跑 tick）。仍不碰本体真值。 */
  const onApply = useCallback(async () => {
    if (!effectiveSessionId) return;
    setBusy(true);
    try {
      await patchSimDisabledRules(effectiveSessionId, disabled);
      await qc.invalidateQueries({ queryKey: ["a", "sim-sessions"] });
      await qc.invalidateQueries({ queryKey: ["a", "sim-world", effectiveSessionId] });
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [effectiveSessionId, disabled, qc]);

  const tid = (s: string) => `edge-active-${pageKey}-${s}`;

  if (rulesQuery.isLoading) {
    return (
      <section data-testid={tid("loading")} className={css.panel}>
        传导边加载中…
      </section>
    );
  }
  // 本租户一条传导边都没有 ⇒ **无边可关**。据实说明并**不渲染空开关列表**：
  // 空面板比没有更糟——它让人以为这页支持而其实无边可关（WO §3.2）。
  if (rules.length === 0) {
    return (
      <section data-testid={tid("no-edges")} className={css.panel}>
        本租户尚未发布任何传导边，因此没有边可以关。要先在传导规则里建一条并发布。

      </section>
    );
  }

  return (
    <section data-testid={tid("panel")} className={css.panel}>
      <header className={css.header}>
        <strong className={css.title}>扰动因素 · 关掉看变化</strong>
        <HintDot label="传导边开关" testId={tid("hint")}>
          <div style={{ fontSize: 12, lineHeight: 1.7, maxWidth: 420 }}>
            <p>
              每一行是一条<b>传导边</b>：<code>源类型.状态变量 —(链路)→ 目标类型.状态变量</code>，
              带系数与延迟（多少拍之后才传到）。这些边逐条来自已发布的传导规则，界面不做任何加工。
            </p>
            <p>
              上面那排按钮按<b>业务域</b>分片，点一个只看那个域的边。每条边归哪个域由后端随边一起给出，
              界面不另存一份对照表 —— 存了它，新增一条边忘了登记就会从分类里悄悄消失。
            </p>
            <p>
              第一行是<b>对象类型的业务名</b>（本体里登记的中文名，没登记就显原始键）；
              第二行是<b>系统里的键名</b>。状态变量在本体里<b>没有中文名可取</b>，
              故只出现在系统键那一行 —— 界面不替它编一个。
            </p>
            <p>
              关掉一条边 = <b>本次推演假装它不存在</b>，只记在这次会话上。
              它与「这条边有没有发布」是两回事：后者决定这条边在不在真实世界里（改它要走审批），
              本开关只决定这一次推演假装它不在 —— 随时可拨回，也不影响同租户其他人。

            </p>
            <p>
              差值的算法：同一个起点，开、关两版各推
              {" "}{ticks} 拍，然后逐格相减。<b>这一趟不写世界态</b>——会话的拍号一格不动。
            </p>
          </div>
        </HintDot>
        <span className={css.headerRight} data-testid={tid("count")}>
          {rules.length} 条边 · 已关 {disabled.length}
        </span>
      </header>

      {/*
        ① 分类切片：每个业务域一个 chip（带**现算**的条数），点一个只显示该域的行。
        ⛔ chip 的条数与下方真渲染的行数是**同一个数组的长度**（`slice.rows`）——
           不是两个各自维护的数字，所以不可能出现"chip 写 7 条、点开只有 5 行"。
      */}
      <div className={css.chipbar} role="tablist" aria-label="按业务域筛选扰动因素" data-testid={tid("domains")}>
        {slices.map((sl) => (
          <button
            key={sl.sliceId}
            type="button"
            role="tab"
            aria-selected={sl.sliceId === activeSliceId}
            className={sl.sliceId === activeSliceId ? `${css.chip} ${css.chipOn}` : css.chip}
            data-testid={tid(`domain-${sl.sliceId}`)}
            data-count={sl.count}
            onClick={() => setPickedSlice(sl.sliceId)}
          >
            {sl.name}
            <span className={css.chipCount}>{sl.count}</span>
          </button>
        ))}
      </div>

      {/* 未归域不是"漏了"，是数据的实情 —— 不说清就会被读成系统出错。 */}
      {activeSlice?.sliceId === UNASSIGNED_SLICE_ID && (
        <p className={css.sliceNote} data-testid={tid("unassigned-note")}>
          {UNASSIGNED_DOMAIN_DETAIL}
        </p>
      )}

      {/* 还没拨过开关时说明差值从哪来：本页自带世界 / 租户已有世界 / 拨了才就地开一个探针世界。 */}
      {!effectiveSessionId && (
        <p data-testid={tid("no-session")} className={css.note}>
          本页不持有推演世界，本租户当前也没有可推演的会话。
          拨动任一开关时会<b>就地开一个探针世界</b>（起始值由配置派生的占位值）来算差值。

        </p>
      )}
      {/* R13 出处：拿占位世界算出来的差值只反映**边的结构影响**，不是实测量级 —— 必须标，不许含糊。
          记号文案取自 `edgeActiveModel` 的导出常量（**与产生这批数的那个函数同一个文件**），
          免得再出现"迁了实现、记号留在原文件"那种事（本单迁 `deriveBaseSnapshot` 时被门当场抓到过）。 */}
      {probeIsSynthetic && (
        <p data-testid={tid("probe-origin")} className={css.note}>
          <b>{PROBE_WORLD_PROVENANCE}</b>：{PROBE_WORLD_PROVENANCE_DETAIL}
          要在实测世界上对照，请在「推演沙盘」里建世界后再回到本页。
        </p>
      )}

      {/*
        ⚠ **只渲染选中那一片的行**（条件渲染，不是 CSS 隐藏、也不是 `<details>` 折叠）。
        本仓已有 dev 在这条上栽过：`<details>` 折叠时子节点**照样在 DOM 里**，
        于是"切片有效"的测试拿 DOM 存在性去判就永远是绿的。条件渲染让"不在这一片"
        与"不在 DOM 里"变成同一件事 —— 判据与实现对齐，测试咬得住。
      */}
      <ul className={css.rows} data-testid={tid("edges")}>
        {(activeSlice?.rows ?? []).map((r) => (
          <li
            key={r.key}
            data-testid={tid(`edge-${r.key}`)}
            data-active={r.active ? "true" : "false"}
            data-domain={r.domainKey ?? UNASSIGNED_SLICE_ID}
            className={r.dimmed ? `${css.row} ${css.rowOff}` : css.row}
          >
            {/* ② 三段栅格第 1 列：勾选框。所有行同列 ⇒ 左边缘落在同一条竖线上。 */}
            <input
              type="checkbox"
              id={tid(`toggle-${r.key}`)}
              checked={r.active}
              disabled={busy}
              aria-label={`传导边 ${r.from} → ${r.to} 是否参与本次推演`}
              data-testid={tid(`toggle-${r.key}`)}
              onChange={(e) => void onToggle(r.key, e.target.checked)}
            />
            {/* 第 2 列：③ 一行两级 —— 人话名在上（13.5px），系统键在下（11.5px mono）。 */}
            <label className={css.rowMain} htmlFor={tid(`toggle-${r.key}`)}>
              {r.sourceTypeName}
              <span className={css.rowArrow}>→</span>
              {r.targetTypeName}
              <small className={css.rowKeys} data-testid={tid(`keys-${r.key}`)}>
                {r.from} —{r.viaLinkKey}→ {r.to}
              </small>
            </label>
            {/*
             * 第 3 列：系数/延迟 —— 这两个数是**边的声明值**（"算出来的"），
             * 与第 1 列那个"你能拨的"开关在视觉上分开：等宽 + 弱化 + `声明值` tag。
             * 分层（R-UI-3）：原写作 `×0.5` —— 一个乘号是**算式**，规范点名要降浮层。
             * 但这两个数是这条边的身份（改哪条边就看它们），属第一层的「数值」。
             * 故把乘号换成它本来的名字「系数」：算式记号降层，数值与名字留在第一层。
             */}
            <span className={css.rowMeta}>
              系数 {r.coefficient} · 延迟 {r.delayTicks}
              <span className={css.derivedTag}>声明值</span>
              {r.dimmed && (
                <span data-testid={tid(`off-${r.key}`)} className={css.offMark}>
                  {" "}已关闭
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {failure && (
        <p data-testid={tid("error")} className={css.error}>
          对照跑失败：{failure}
        </p>
      )}

      {verdict && (
        <div
          data-testid={tid("verdict")}
          className={verdict.kind === "CHANGED" ? css.verdict : `${css.verdict} ${css.verdictMuted}`}
        >
          {verdict.text}
        </div>
      )}

      {diffRows.length > 0 && (
        <div className={css.diffWrap}>
          <table data-testid={tid("diff")} className={css.diff}>
            <thead>
              <tr>
                <th>对象 · 状态变量</th>
                <th>边开着</th>
                <th>边关掉</th>
                <th>变化</th>
              </tr>
            </thead>
            <tbody>
              {diffRows.map((d) => (
                <tr key={`${d.objectId}|${d.stateVar}`} data-testid={tid(`diff-${d.objectId}-${d.stateVar}`)}>
                  <td>
                    <code>{d.objectId}</code>
                    <span className={css.flat}>.{d.stateVar}</span>
                  </td>
                  {/* `null` = 这一格在那一版世界里**根本没有**（≠ 值为 0）。两句话不同，屏上必须分得开；
                      而 `delta` 仍按引擎 `readVar` 的缺格读 0 约定算，所以变化量照样看得见。 */}
                  <td>{d.baseline ?? <span className={css.flat} title="该世界里没有这一格">无此格</span>}</td>
                  <td>{d.counterfactual ?? <span className={css.flat} title="该世界里没有这一格">无此格</span>}</td>
                  <td className={d.direction === "up" ? css.up : d.direction === "down" ? css.down : css.flat}>
                    {d.arrow} {d.deltaText}
                    {d.relative !== null && <span className={css.flat}> （{(d.relative * 100).toFixed(1)}%）</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {effectiveSessionId && (
        <div className={css.apply}>
          <button type="button" className="btn" disabled={busy} data-testid={tid("apply")} onClick={() => void onApply()}>
            应用到本会话
          </button>
          <span className={css.note}>
            「应用」把当前开关落到会话上（此后这个世界按"关掉"跑 tick）。本体里的规则发布态一个字节不动。
          </span>
        </div>
      )}
    </section>
  );
}
