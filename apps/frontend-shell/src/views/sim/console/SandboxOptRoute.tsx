/** 视图渲染器适配层 —— 见 `SandboxHomeRoute.tsx` 的同一条理由（注册表的契约是
 *  `ComponentType<ViewRendererProps>`，而指控台组件的入参是**业务参数**；直接注册靠的是
 *  「所有 props 都可选」这条结构类型巧合，哪天加一个必填 prop 就静默断）。 */
import type { ViewRendererProps } from "@/views/registry";
import type { ParetoRequest } from "@platform/contracts";
import { SandboxOpt } from "./SandboxOpt";

export default function SandboxOptRoute({ view }: ViewRendererProps): JSX.Element {
  const p = (view.options ?? {}) as { sessionId?: string; paretoRequest?: ParetoRequest };
  return (
    <SandboxOpt
      {...(p.sessionId ? { sessionId: p.sessionId } : {})}
      {...(p.paretoRequest ? { paretoRequest: p.paretoRequest } : {})}
    />
  );
}
