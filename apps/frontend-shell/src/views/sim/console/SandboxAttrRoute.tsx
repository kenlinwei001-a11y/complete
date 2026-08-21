/**
 * 视图渲染器适配层 —— 把 `ViewRendererProps` 转成 `SandboxAttrProps`。
 *
 * 为什么要这一层而不是直接注册 `SandboxAttr`（与 `SandboxHomeRoute.tsx` 同一条理由）：
 * 注册表的契约是 `ComponentType<ViewRendererProps>`，而归因台组件的入参是**业务参数**
 * （会话 id / 锚点订单号），两者不是一回事。直接注册靠的是「所有 props 都可选」这条
 * 结构类型巧合 —— 哪天加一个必填 prop 就静默断。显式适配把「视图配置 → 业务参数」
 * 这一步摆在明面上，改的时候看得见。
 */
import type { ViewRendererProps } from "@/views/registry";
import { SandboxAttr } from "./SandboxAttr";

export default function SandboxAttrRoute({ view }: ViewRendererProps): JSX.Element {
  const p = (view.options ?? {}) as { sessionId?: string; so?: string };
  return <SandboxAttr {...(p.sessionId ? { sessionId: p.sessionId } : {})} {...(p.so ? { so: p.so } : {})} />;
}
