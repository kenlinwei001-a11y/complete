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
 */
import type { ViewRendererProps } from "@/views/registry";
import { SandboxAttr } from "./SandboxAttr";
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
    </div>
  );
}
