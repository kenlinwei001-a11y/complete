/** 视图渲染器适配层 —— 见 `SandboxHomeRoute.tsx` 的同一条理由。 */
import type { ViewRendererProps } from "@/views/registry";
import { SandboxDetail } from "./SandboxDetail";

export default function SandboxDetailRoute({ view }: ViewRendererProps): JSX.Element {
  const p = (view.options ?? {}) as { sessionId?: string; nodeId?: string };
  return <SandboxDetail {...(p.sessionId ? { sessionId: p.sessionId } : {})} {...(p.nodeId ? { nodeId: p.nodeId } : {})} />;
}
