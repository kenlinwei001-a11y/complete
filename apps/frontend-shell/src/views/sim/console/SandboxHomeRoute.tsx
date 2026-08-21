/**
 * 视图渲染器适配层 —— 把 `ViewRendererProps` 转成 `SandboxHomeProps`。
 *
 * 为什么要这一层而不是直接注册 `SandboxHome`：注册表的契约是 `ComponentType<ViewRendererProps>`，
 * 而指控台组件的入参是**业务参数**（会话 id / 落点对象 id），两者不是一回事。
 * 直接注册靠的是「所有 props 都可选」这条结构类型巧合 —— 哪天加一个必填 prop 就静默断。
 * 显式适配把「视图配置 → 业务参数」这一步摆在明面上，改的时候看得见。
 *
 * ── WO-SIM-FE-HOST：这一层此前**透了一个永远为空的值** ────────────────────────
 * 本层一直在读 `view.options.sessionId`，但没有任何后端 workspace 下发过 `sim-console`
 * 这个 viewKey ⇒ `view.options` 恒 `undefined` ⇒ 透下去的 `sessionId` 恒 `undefined`
 * ⇒ 左栏 `PerturbTree` 的 `listQuery` 恒 `enabled:false` ⇒ `data-hot-source` 恒 `"placeholder"`。
 * 「接了线」与「线上有值」是两件事（CLAUDE.md 铁律 0.5 的三态之二）。
 * 补 `useConsoleSession()` 之后，没有显式指定时本层自己去查最近一条 RUNNING 会话。
 *
 * ⚠ **本页的诚实位是 `data-hot-source`，不是甘特上的 `data-source`**：
 * 甘特走 `useMetricSeries(sessionId)`，而那个 hook 的函数体今天是 `void sessionId; return PLACEHOLDER`
 * —— 它**丢掉**入参、`source` 是编译期常量。宿主透什么下去都翻不动它，
 * 要翻得改 `useMetricSeries` 本体（本单范围外，见交单报告「没做的格」）。
 */
import type { ViewRendererProps } from "@/views/registry";
import { SandboxHome } from "./SandboxHome";
import { consoleHostProps, useConsoleSession } from "./useConsoleSession";

export default function SandboxHomeRoute({ view }: ViewRendererProps): JSX.Element {
  const p = (view.options ?? {}) as { sessionId?: string; targetObjectId?: string };
  const session = useConsoleSession(p);
  return (
    <div {...consoleHostProps(session)}>
      <SandboxHome
        {...(session.sessionId ? { sessionId: session.sessionId } : {})}
        {...(p.targetObjectId ? { targetObjectId: p.targetObjectId } : {})}
      />
    </div>
  );
}
