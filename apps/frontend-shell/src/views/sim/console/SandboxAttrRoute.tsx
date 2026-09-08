/**
 * 视图渲染器适配层 —— 把 `ViewRendererProps` 转成 `SandboxAttrProps`。
 *
 * 为什么要这一层而不是直接注册 `SandboxAttr`（与 `SandboxHomeRoute.tsx` 同一条理由）：
 * 注册表的契约是 `ComponentType<ViewRendererProps>`，而归因台组件的入参是**业务参数**
 * （会话 id / 锚点订单号），两者不是一回事。直接注册靠的是「所有 props 都可选」这条
 * 结构类型巧合 —— 哪天加一个必填 prop 就静默断。显式适配把「视图配置 → 业务参数」
 * 这一步摆在明面上，改的时候看得见。
 *
 * WO-SIM-FE-HOST：`sessionId` 不再只从 `view.options` 取（那里恒空，见 `useConsoleSession`
 * 文件头），没显式指定就自己查最近一条 RUNNING 会话。
 *
 * ⚠ **本页有两个互不相干的入参，各驱动一半屏，不许混为一谈**：
 *  · `sessionId` → `useContributionSeries` → 底部序列 `[data-testid="sandbox-attr-series"]`
 *    的 `data-source`（接 `GET …/:id/metric-series`）；
 *  · `so`        → `useChainLossMatrix` → 热矩阵 / 根因树 / 明细 / 瀑布四格的 `data-source`
 *    （接链路损耗求解器，**与会话无关**）。
 * 本单只负责送 `sessionId`；`so` 照旧只从宿主取（前端凭空编一个订单号就是造假锚点）。
 * 故本页会出现"序列格 `endpoint`、其余四格 `placeholder`"的**正常**中间态 —— 这不是漏接。
 *
 * ⚠ **WO-SIM-PARAM-WIRE ② 复核后订正上面那句的后半**：`so` 缺席时**四格不落占位**——
 * `useChainLossMatrix` 的 `useQuery` 根本没有 `enabled` 判据，`so` 缺席照发 body `{}`，
 * **2026-08-22 实测**回 `200 · 13/13 列有数据 · 234 格`，四格全是 `endpoint`。
 * 复验（一条 curl 把这三个数一起打出来，命令与回包字段名见
 * `useLossAttribution.ts` 的 `useChainLossMatrix` 头注「复验这一行」那段）；
 * 不起后端的那一半：`pnpm --filter frontend-shell exec vitest run test/sandbox-attr-pixel.test.tsx`。
 * 而「宿主自己挑一张单」这条缺省规则实测会把矩阵砍到 `2/13 列 · 36 格`（收窄语义），
 * 且与后端**逐列**已有的「`so` 字典序首张」口径撞成两份实现。
 * 逐格对拍表与全部证据在 `useLossAttribution.ts` 的 `useChainLossMatrix` 头注，此处不复述。
 * ⇒ **`so` 维持只从宿主取，本单对 ② 不改代码。**
 *
 * ── WO-EDGE-PANEL-4PAGES：今天的行为是 X，应该是 Y（四页同一笔账）─────────────
 * **X**：本页（`sim-attribution`）在现算名册里（R3 nav-sim-group），却零个 `EdgeActivePanel`
 * 挂载点 ⇒ 在损失归因台上做不了「关掉这条传导边看看」，要退回旧沙盘页才行。
 * （注释里指代该组件一律写**裸名**、不写尖括号形态 —— 理由见 `SandboxHomeRoute.tsx` 的同段 ⚠。）
 * **Y**：挂上，且挂在默认导出的主组件里。取舍与版面理由见 `SandboxHomeRoute.tsx`
 * 的同名段（四页同一套：画布外 · 紧贴其下 · 默认折叠 ⇒ 画布内逐像素不动）。
 *
 * ⚠ **本页的诚实边界，写在这里而不是屏上**（屏上由面板自己的 `?` 说全）：面板算的是
 * **会话级反事实**（`SimSession.disabledRuleKeys` × counterfactual 对照跑），它**不改**
 * 上方热矩阵/根因树/瀑布三格的数 —— 那三格走链路损耗求解器（`useChainLossMatrix`），
 * 与会话、与传导边**不同源**（见本文件头 `so` 那段）。两个问题相邻但不同源，故各自成块。
 */
import { useQuery } from "@tanstack/react-query";
import type { ViewRendererProps } from "@/views/registry";
import { fetchSimViewConfig } from "@/api/endpoints";
import EdgeActivePanel from "../EdgeActivePanel";
import { stateVarText } from "../stateVarLabel";
import { SandboxAttr } from "./SandboxAttr";
import css from "./SandboxAttr.module.css";
import { consoleHostProps, useConsoleSession } from "./useConsoleSession";
import { useChainLossMatrix } from "./useLossAttribution";

/**
 * WO-SIM-VERDICT-FRONTEND · 「这一屏的数是在哪一次推演里算的」——**推演上下文披露条**。
 *
 * ══ 今天的行为是 X，应该是 Y ═══════════════════════════════════════════════
 * **X**：会话 id 接上之后，屏上四格的数会跟着这一次推演变了 —— 但**屏上没有任何一处说它变了**。
 * 用户看到的是一组新数字，无从判断这是「真实世界本来就这样」还是「这一次推演叠上去的」。
 * 铁律 1.5 判据二原话：凡对外宣称「推演」的结果，必须能逐项列出引用的数据与走过的规则；
 * **一个看不到代码的人，读完这一层应当能自己判断这是真推演还是查表。**
 * **Y**：把端点已经给出的那一块（`simContext`）如实印在第一层。
 *
 * ── 三态必须分得开（不许塌成一句「无影响」）─────────────────────────────────
 *  · **整块缺席** ⇒ 不在任何一次推演里，读的是真实世界那条链；
 *  · **块在 · 合计 0 天** ⇒ 在推演里，但这一拍没有以天计的影响；
 *  · **块在 · 合计 N 天** ⇒ 逐段点名叠了谁、叠了几天。
 * 后两者在屏上长成一样，等于把「算过了、结果是零」伪装成「没算」。
 *
 * ⚠ 本条**不发第二次请求**：`useChainLossMatrix` 与页内组件同一个缓存键，命中同一份回包；
 *   状态变量的人话名走 `stateVarText`（后端单源字典），前端一个中文名都不写。
 * ⚠ R-UI-4：屏上不出现源码文件名/行号，也不出现「工单」这类排期语汇；
 *   而**拍数 / 天数 / 段数 / 状态变量名**是业务事实，必须给。
 */
function SimContextStrip({ so, sessionId }: { so?: string; sessionId?: string }): JSX.Element {
  const heat = useChainLossMatrix(so, sessionId);
  // 与统一推演控制台同一个缓存键 ⇒ 宿主已经取过就直接命中，不多打一跳。
  const cfg = useQuery({ queryKey: ["a", "sim-view-config"], queryFn: fetchSimViewConfig, retry: false });
  const names = cfg.data?.stateVarNames;
  const ctx = heat.simContext;
  const day = (n: number): string => n.toFixed(1);

  if (ctx === undefined) {
    return (
      <div className={css.simctx} data-testid="sandbox-attr-simctx" data-in-session="0">
        <b>真实世界</b>
        <span>不在任何一次推演里</span>
        <span>下面的数按当前主数据算</span>
      </div>
    );
  }
  // 排除项按理由分两堆：两种「没算」的成因不同，合成一个数就没法据此行动。
  const notDay = ctx.excluded.filter((e) => e.reason === "NOT_DAY_UNIT").length;
  const other = ctx.excluded.filter((e) => e.reason === "OTHER_CARRIER").length;
  return (
    <div className={css.simctx} data-testid="sandbox-attr-simctx" data-in-session="1" data-applied-days={ctx.appliedDays}>
      <b>这一次推演</b>
      <span data-testid="sandbox-attr-simctx-tick">第 {ctx.tick} 拍</span>
      <span data-testid="sandbox-attr-simctx-days">
        叠加 {day(ctx.appliedDays)} 天 · {ctx.appliedSteps.length} 段
      </span>
      {ctx.appliedSteps.map((s) => (
        <span key={s.stepId} className={css.simctxStep} data-testid={`sandbox-attr-simctx-step-${s.stepId}`}>
          {stateVarText(s.stateVar, names)} +{day(s.deltaDays)} 天
        </span>
      ))}
      {ctx.appliedSteps.length === 0 && <span data-testid="sandbox-attr-simctx-zero">这一拍没有按天算的影响</span>}
      {notDay > 0 && <span data-testid="sandbox-attr-simctx-notday">{notDay} 项不按天计，未计入</span>}
      {other > 0 && <span data-testid="sandbox-attr-simctx-other">{other} 项已在别段计过</span>}
    </div>
  );
}

export default function SandboxAttrRoute({ view }: ViewRendererProps): JSX.Element {
  const p = (view.options ?? {}) as { sessionId?: string; so?: string };
  const session = useConsoleSession(p);
  return (
    <div {...consoleHostProps(session)}>
      {/* WO-SIM-VERDICT-FRONTEND 挂载点：**在归因台之上**、不在任何折叠之下 ——
          「这组数是哪一次推演算的」必须先于数本身被读到。
          刻意挂在 `.app` **外面**：`SandboxAttr` 那一盒是像素级 1:1 的验收线，
          往盒子里塞一行会当场破坏它（`sandbox-attr-pixel.test.tsx` 逐条断言 .app/.row1/.bot 高度）。 */}
      <SimContextStrip {...(p.so ? { so: p.so } : {})} {...(session.sessionId ? { sessionId: session.sessionId } : {})} />
      <SandboxAttr
        {...(session.sessionId ? { sessionId: session.sessionId } : {})}
        {...(p.so ? { so: p.so } : {})}
      />
      {/* WO-EDGE-PANEL-4PAGES 挂载点：**主组件里**、不在任何条件渲染之下。 */}
      <details className={css.dock} data-testid="sim-attribution-edge-dock">
        <summary className={css.dockSum} data-testid="sim-attribution-edge-summary">
          关掉一条传导边，看这次推演的数怎么变 ▸
        </summary>
        <EdgeActivePanel pageKey="sim-attribution" sessionId={session.sessionId} />
      </details>
    </div>
  );
}
