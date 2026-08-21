/** 视图渲染器适配层 —— 见 `SandboxHomeRoute.tsx` 的同一条理由（注册表的契约是
 *  `ComponentType<ViewRendererProps>`，而指控台组件的入参是**业务参数**；直接注册靠的是
 *  「所有 props 都可选」这条结构类型巧合，哪天加一个必填 prop 就静默断）。
 *
 *  WO-SIM-FE-HOST：`sessionId` 不再只从 `view.options` 取（那里恒空，见 `useConsoleSession`
 *  文件头），没显式指定就自己查最近一条 RUNNING 会话。
 *
 *  ⚠ **本页两个入参各驱动一半屏，诚实位也是两个，不许拿一个盖另一个**：
 *   · `paretoRequest` → `useParetoFrontier` → 根节点 `[data-testid="sandbox-opt"]` 的 `data-source`
 *     （帕累托前沿解集，**与会话无关**）；
 *   · `sessionId`     → `useExecutionCompare` → 底部执行对比 `[data-testid="sandbox-opt-grid"]`
 *     的 `data-source`（接 `GET …/:id/metric-series`）。
 *  本单只负责送 `sessionId`；`paretoRequest` 照旧只从宿主取 —— `family` + `args` + 杠杆网格
 *  是建模产物，前端凭空拼一份就是在客户端另造一套求解口径（`SandboxOptProps` 原注释立的纪律）。
 *  故本页会出现"执行对比 `endpoint`、前沿图 `placeholder`"的**正常**中间态，这不是漏接。
 */
import type { ViewRendererProps } from "@/views/registry";
import type { ParetoRequest } from "@platform/contracts";
import { SandboxOpt } from "./SandboxOpt";
import { consoleHostProps, useConsoleSession } from "./useConsoleSession";

export default function SandboxOptRoute({ view }: ViewRendererProps): JSX.Element {
  const p = (view.options ?? {}) as { sessionId?: string; paretoRequest?: ParetoRequest };
  const session = useConsoleSession(p);
  return (
    <div {...consoleHostProps(session)}>
      <SandboxOpt
        {...(session.sessionId ? { sessionId: session.sessionId } : {})}
        {...(p.paretoRequest ? { paretoRequest: p.paretoRequest } : {})}
      />
    </div>
  );
}
