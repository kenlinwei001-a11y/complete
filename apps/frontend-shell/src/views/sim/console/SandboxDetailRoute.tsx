/**
 * 视图渲染器适配层 —— 见 `SandboxHomeRoute.tsx` 的同一条理由。
 *
 * ── WO-SIM-FE-HOST 改了两处 ─────────────────────────────────────────────────
 * ① `sessionId` 不再只从 `view.options` 取（那里恒空，见 `useConsoleSession` 文件头），
 *    没显式指定就自己查最近一条 RUNNING 会话。本页的诚实位是根节点
 *    `[data-testid="sandbox-detail"]` 上的 `data-source` —— 它由 `useNodeDetail(sessionId, nodeId)`
 *    驱动，**只要有 sessionId 就发请求**（`nodeId` 只是可选查询串），故宿主透一个会话下来
 *    就足以让它翻 `"endpoint"`。
 * ② 补透 `impactChange` / `mitigation`。这两个是 `SandboxDetailProps` 签名里**本来就有**、
 *    而本层此前**一个都没接**的入参 —— 于是影响半径扇区（`sandbox-detail-cone`）与
 *    应对策略栈（`sandbox-detail-strategies`）无论宿主怎么配都翻不动。
 *    形态与 `sessionId` 同族：**页面开了口，宿主没往里送值。**
 *    ⚠ 这两个**只从宿主取，不在这里兜底造**：`impactChange` 是"改了什么"、`mitigation` 是
 *    "在哪个基地防哪类风险"，前端凭空拼一份就是在客户端另造一套推演口径（与 `paretoRequest`
 *    在 `SandboxOptRoute` 里立的同一条纪律）。
 */
import type { ImpactChange } from "@platform/contracts";
import type { ViewRendererProps } from "@/views/registry";
import { SandboxDetail } from "./SandboxDetail";
import type { MitigationArgs } from "./StrategyCards";
import { consoleHostProps, useConsoleSession } from "./useConsoleSession";

export default function SandboxDetailRoute({ view }: ViewRendererProps): JSX.Element {
  const p = (view.options ?? {}) as {
    sessionId?: string;
    nodeId?: string;
    impactChange?: ImpactChange;
    mitigation?: MitigationArgs;
  };
  const session = useConsoleSession(p);
  return (
    <div {...consoleHostProps(session)}>
      <SandboxDetail
        {...(session.sessionId ? { sessionId: session.sessionId } : {})}
        {...(p.nodeId ? { nodeId: p.nodeId } : {})}
        {...(p.impactChange ? { impactChange: p.impactChange } : {})}
        {...(p.mitigation ? { mitigation: p.mitigation } : {})}
      />
    </div>
  );
}
