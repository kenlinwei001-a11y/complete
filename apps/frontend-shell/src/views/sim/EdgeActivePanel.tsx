import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SimCounterfactualResult } from "@platform/contracts";
import { createSimSession, fetchPropagationRules, fetchSimSessions, fetchSimViewConfig, patchSimDisabledRules, simCounterfactual } from "@/api/endpoints";
import { toastError } from "@/store/toastStore";
import { HintDot } from "./shared";
import { buildDiffRows, buildEdgeRows, buildVerdict, deriveBaseSnapshot, pickProbeSession, toggleEdge } from "./edgeActiveModel";

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
 * 本组件新增文字**正文最小 12px**；弱化色不低于 `#b6c3d4`（≈6.6:1）这一档。
 * 关掉的边用**虚线 + 降低不透明度到 0.72（不是 0.4）+ 显式"已关闭"文字标记**表达降级——
 * 只靠颜色/透明度表达状态在低对比下等于没表达，故文字标记是必须的那一路。
 */

/** 关掉的边"可见地降级"而不是消失（§3.3）：三路编码（虚线 + 不透明度 + 文字标记），缺一路都不够。 */
const DIM_OPACITY = 0.72;
/** 弱化文字色下限（≈6.6:1）。比这更淡的灰在小字 CJK 上实测不可读，已被仓主截图点名过一次。 */
const MUTED = "#b6c3d4";
const TEXT = "#e8eef7";

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

  const rulesQuery = useQuery({
    queryKey: ["a", "sim-propagation-rules"],
    queryFn: () => fetchPropagationRules(true),
    staleTime: 60_000,
  });
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
  const rows = useMemo(() => buildEdgeRows(rules, disabled), [rules, disabled]);
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
      <section data-testid={tid("loading")} style={{ padding: 12, fontSize: 12, color: MUTED }}>
        传导边加载中…
      </section>
    );
  }
  // 本租户一条传导边都没有 ⇒ **无边可关**。据实说明并**不渲染空开关列表**：
  // 空面板比没有更糟——它让人以为这页支持而其实无边可关（WO §3.2）。
  if (rules.length === 0) {
    return (
      <section data-testid={tid("no-edges")} style={{ padding: 12, fontSize: 12, color: MUTED, lineHeight: 1.6 }}>
        本租户尚未发布任何传导边（<code>PropagationRule</code> · status=PUBLISHED 为 0 条），因此没有边可以关。
        建边入口：<code>POST /a/v1/sim/propagation-rules</code>。
      </section>
    );
  }

  return (
    <section data-testid={tid("panel")} style={{ padding: 12, fontSize: 12, color: TEXT, lineHeight: 1.6 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>传导边 · 关掉看变化</strong>
        <HintDot label="传导边开关" testId={tid("hint")}>
          <div style={{ fontSize: 12, lineHeight: 1.7, maxWidth: 420 }}>
            <p>
              每一行是一条<b>传导边</b>：<code>源类型.状态变量 —(链路)→ 目标类型.状态变量</code>，
              带系数与延迟（tick）。数据源 <code>GET /a/v1/sim/propagation-rules</code>，前端零加工。
            </p>
            <p>
              关掉一条边 = <b>本次推演假装它不存在</b>，落在会话的 <code>disabledRuleKeys</code> 上。
              它与规则的发布态 <code>status</code> <b>正交</b>：<code>status</code> 决定"这条边在不在世界里"
              （改它是本体真值写入，须经 Action 审批 R4），本开关只决定"这次推演假装它不在"，
              随时可拨回，且不影响同租户其他人。
            </p>
            <p>
              差值来自 <code>POST /a/v1/sim/sessions/:id/counterfactual</code>：同一起点、开/关两版各跑
              {" "}{ticks} 个 tick，逐格相减。<b>这一趟不写世界态</b>——会话的 tick 一格不动。
            </p>
          </div>
        </HintDot>
        <span style={{ marginLeft: "auto", color: MUTED }} data-testid={tid("count")}>
          {rules.length} 条边 · 已关 {disabled.length}
        </span>
      </header>

      {/* 还没拨过开关时说明差值从哪来：本页自带世界 / 租户已有世界 / 拨了才就地开一个探针世界。 */}
      {!effectiveSessionId && (
        <p data-testid={tid("no-session")} style={{ color: MUTED, margin: "0 0 8px" }}>
          本页不持有推演世界，本租户当前也没有可推演的会话（<code>SimSession</code> 为 0 条）。
          拨动任一开关时会**就地开一个探针世界**（tick0 由本体配置派生的占位值）来算差值。
        </p>
      )}
      {/* R13 出处：拿占位世界算出来的差值只反映**边的结构影响**，不是实测量级 —— 必须标，不许含糊。 */}
      {probeIsSynthetic && (
        <p data-testid={tid("probe-origin")} style={{ color: MUTED, margin: "0 0 8px" }}>
          出处：本页就地开的**探针世界**，其 tick0 世界态是由本体配置派生的<b>占位值</b>（非实测）。
          下方差值反映的是<b>这条边的结构影响</b>（系数 × 延迟 × 链路扇出），量级不可当实测读。
          要在实测世界上对照，请在「推演沙盘」里建世界后再回到本页。
        </p>
      )}

      <ul style={{ listStyle: "none", margin: 0, padding: 0 }} data-testid={tid("edges")}>
        {rows.map((r) => (
          <li
            key={r.key}
            data-testid={tid(`edge-${r.key}`)}
            data-active={r.active ? "true" : "false"}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 4px",
              // 三路降级编码：虚线边框 + 不透明度 + 下方显式"已关闭"文字（只靠色/透明度在低对比下等于没表达）
              borderBottom: r.dimmed ? "1px dashed #6c7a8c" : "1px solid #2b3648",
              opacity: r.dimmed ? DIM_OPACITY : 1,
            }}
          >
            <input
              type="checkbox"
              checked={r.active}
              disabled={busy}
              aria-label={`传导边 ${r.from} → ${r.to} 是否参与本次推演`}
              data-testid={tid(`toggle-${r.key}`)}
              onChange={(e) => void onToggle(r.key, e.target.checked)}
            />
            <span style={{ flex: 1, minWidth: 0 }}>
              <code style={{ fontSize: 12 }}>{r.from}</code>
              <span style={{ color: MUTED }}> —{r.viaLinkKey}→ </span>
              <code style={{ fontSize: 12 }}>{r.to}</code>
            </span>
            <span style={{ color: MUTED, whiteSpace: "nowrap" }}>
              ×{r.coefficient} · 延迟 {r.delayTicks}
            </span>
            {r.dimmed && (
              <span data-testid={tid(`off-${r.key}`)} style={{ color: "#f0b7bd", whiteSpace: "nowrap" }}>
                已关闭
              </span>
            )}
          </li>
        ))}
      </ul>

      {failure && (
        <p data-testid={tid("error")} style={{ color: "#f0b7bd", marginTop: 8 }}>
          对照跑失败：{failure}
        </p>
      )}

      {verdict && (
        <div data-testid={tid("verdict")} style={{ marginTop: 10, color: verdict.kind === "CHANGED" ? TEXT : MUTED }}>
          {verdict.text}
        </div>
      )}

      {diffRows.length > 0 && (
        <div style={{ marginTop: 8, overflowX: "auto" }}>
          <table data-testid={tid("diff")} style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
            <thead>
              <tr style={{ color: MUTED, textAlign: "left" }}>
                <th style={{ padding: "2px 8px 2px 0" }}>对象 · 状态变量</th>
                <th style={{ padding: "2px 8px" }}>边开着</th>
                <th style={{ padding: "2px 8px" }}>边关掉</th>
                <th style={{ padding: "2px 8px" }}>变化</th>
              </tr>
            </thead>
            <tbody>
              {diffRows.map((d) => (
                <tr key={`${d.objectId}|${d.stateVar}`} data-testid={tid(`diff-${d.objectId}-${d.stateVar}`)}>
                  <td style={{ padding: "2px 8px 2px 0" }}>
                    <code style={{ fontSize: 12 }}>{d.objectId}</code>
                    <span style={{ color: MUTED }}>.{d.stateVar}</span>
                  </td>
                  {/* `null` = 这一格在那一版世界里**根本没有**（≠ 值为 0）。两句话不同，屏上必须分得开；
                      而 `delta` 仍按引擎 `readVar` 的缺格读 0 约定算，所以变化量照样看得见。 */}
                  <td style={{ padding: "2px 8px" }}>
                    {d.baseline ?? <span style={{ color: MUTED }} title="该世界里没有这一格">无此格</span>}
                  </td>
                  <td style={{ padding: "2px 8px" }}>
                    {d.counterfactual ?? <span style={{ color: MUTED }} title="该世界里没有这一格">无此格</span>}
                  </td>
                  <td
                    style={{ padding: "2px 8px", color: d.direction === "up" ? "#f0b7bd" : d.direction === "down" ? "#8fd6c4" : MUTED }}
                  >
                    {d.arrow} {d.deltaText}
                    {d.relative !== null && <span style={{ color: MUTED }}> （{(d.relative * 100).toFixed(1)}%）</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {effectiveSessionId && (
        <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" className="btn" disabled={busy} data-testid={tid("apply")} onClick={() => void onApply()}>
            应用到本会话
          </button>
          <span style={{ color: MUTED }}>
            「应用」把当前开关落到会话上（此后这个世界按"关掉"跑 tick）。本体里的规则发布态一个字节不动。
          </span>
        </div>
      )}
    </section>
  );
}
