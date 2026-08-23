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
 * 实测回 `200 · 13/13 列有数据 · 234 格`，四格全是 `endpoint`。
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
import type { ViewRendererProps } from "@/views/registry";
import EdgeActivePanel from "../EdgeActivePanel";
import { SandboxAttr } from "./SandboxAttr";
import css from "./SandboxAttr.module.css";
import { consoleHostProps, useConsoleSession } from "./useConsoleSession";

export default function SandboxAttrRoute({ view }: ViewRendererProps): JSX.Element {
  const p = (view.options ?? {}) as { sessionId?: string; so?: string };
  const session = useConsoleSession(p);
  return (
    <div {...consoleHostProps(session)}>
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
