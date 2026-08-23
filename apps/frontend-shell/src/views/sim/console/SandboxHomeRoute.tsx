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
 * ── ⚠ 上一段附带的那条注记已被后一张单推翻，照实回写（`WO-SIM-STALE-3`）──────────
 * 此处原文写「本页的诚实位是 `data-hot-source`，**不是**甘特上的 `data-source`：
 * 甘特走 `useMetricSeries(sessionId)`，而那个 hook 的函数体今天是
 * `void sessionId; return PLACEHOLDER` —— 它丢掉入参、`source` 是编译期常量，
 * 宿主透什么下去都翻不动它」。那是 `WO-SIM-FE-HOST` 交单当时的实测，**今天已不成立**：
 * `WO-SIM-FE-SERIES-WIRE` 已把该 hook 接到真端点 ——
 * `useMetricSeries()` → `api.a(metricSeriesPath(sessionId))`
 * → `GET /a/v1/sim/sessions/:id/metric-series`（后端 `apps/datacore/src/app.ts` 的该路由），
 * 入参真被读，`source` 拿到回包就翻 `"endpoint"`。
 *
 * ⇒ **本层透下去的 `sessionId` 同时驱动两个诚实位**：左栏 `PerturbTree` 的 `data-hot-source`
 * 与甘特的 `data-source`。两者各有专门的接缝门（前者 `sandbox-host-wiring.seam.test.tsx`，
 * 后者 `metric-series-wire.seam.test.tsx` 用例 ①），都真渲染本组件、不测 hook 返回值。
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WO-EDGE-PANEL-4PAGES · 今天的行为是 X，应该是 Y
 * ══════════════════════════════════════════════════════════════════════════
 *
 * **X（改造前实测，`node scripts/check-edge-active-mounts.mjs` RC=1）**：本页（`sim-console`）
 * 与同族三页在现算名册里**都在**（R3 nav-sim-group：左导航「推演」组成员），却**一个
 * `EdgeActivePanel` 挂载点都没有**。屏上的净效果是：用户在这四页做不了「关掉这条边看看」——
 *
 * ⚠ 上一句刻意**不写成 JSX 尖括号形态**：门 `check-edge-active-mounts.mjs` 的 `analyze()` 判挂载点
 * 用的是「左尖括号 + 组件名」的 **`includes` 子串**匹配、且**不剥注释** —— 写在文件头注里的
 * 那半个标签会被它当成**一处真挂载**，而它落在默认导出的行段之外 ⇒ 当场判
 * `MOUNTED_IN_SUBCOMPONENT`。本单实测连撞两次：第一次四页同时红（原因全在头注里的举例），
 * 第二次只剩本页红 —— 红在**这段警告自己**（它当时把那个子串原样写了出来）。
 * 故纪律是：**在本目录的注释里指代该组件，一律写裸名，连引号里的正则/子串也不许还原它**。
 * 要退回旧沙盘页（`sim-sandbox` / `what-if` …）才能操作，而「先关一条边、再看结果」
 * 恰恰是推演最常见的用法。**而那道能拦住这件事的门建好了却没接进 `pnpm gates`**
 * （门账 `binding=NONE` · `disposition=WIRE`），所以没有任何东西告诉过任何人。
 *
 * **Y（现在）**：四页都挂上，**且挂在默认导出的主组件里**（不是"跑出结果才渲染"的子组件），
 * 同批把那道门接进 `pnpm gates` 真跑。
 *
 * ── 面板放哪 · 取舍（版面）─────────────────────────────────────────────────
 * 画布 `.app` 是**定死的 1440×897 且 `overflow:hidden`**（规格 `docs/ux-spec/sandbox/*.html`），
 * 塞进画布里的任何东西都必须挤掉既有内容。故面板挂在画布**外**、紧贴其下，**默认折叠**：
 * 收起态只占一条 26px 的标题条 ⇒ 画布内的信息密度**逐像素不动**；展开才向下顶开页面。
 * `<details>` 而不是条件渲染 —— 它**任何时候都在 DOM 里、任何时候都能展开**，
 * 不以"已经跑过推演"为前提，这正是 `check-edge-active-mounts` 那道门存在的全部理由。
 * 同款先例：`views/plan/OrderChainView.tsx` 的 `oc-edge-details`（已过同一道门）。
 * ⚠ 规格 HTML 与基准 PNG **同批已改**（`sandbox-home.html` 的 `.dock` 段）——
 * 改页面不改规格，「1:1」就成了谎话，下一个人会照旧规格把这块当缺陷改回去。
 */
import type { ViewRendererProps } from "@/views/registry";
import EdgeActivePanel from "../EdgeActivePanel";
import { SandboxHome } from "./SandboxHome";
import css from "./SandboxHome.module.css";
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
      {/* WO-EDGE-PANEL-4PAGES 挂载点：**主组件里**、不在任何 `xxx.data &&` 之下。
          `sessionId` 透的是本页正在推演的那个世界（`useConsoleSession` 的五态产出）——
          面板据此在**真世界**上算开/关两版对照；宿主没查到会话时它自己回落探针世界，
          并在屏上标出处（`edge-active-*-probe-origin`），不冒充实测量级。 */}
      <details className={css.dock} data-testid="sim-console-edge-dock">
        <summary className={css.dockSum} data-testid="sim-console-edge-summary">
          <i>▤</i>关掉一条传导边，看这次推演的数怎么变
        </summary>
        <EdgeActivePanel pageKey="sim-console" sessionId={session.sessionId} />
      </details>
    </div>
  );
}
