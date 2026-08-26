import { useEffect, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { createActionDraft } from "@/api/endpoints";
import { useWorkspace } from "@/workspace/useWorkspace";
import { useSessionStore } from "@/store/sessionStore";
import { toast, toastError } from "@/store/toastStore";
import { InfoPopover } from "@/components/InfoPopover";
import zh from "@/locales/zh";
import { downloadProvenanceReport, type ProvenanceReport } from "./exportProvenance";
import styles from "./SimViews.module.css";

/** 数字一律 --font-mono */
export const fmt = (v: number, d = 1): string => v.toLocaleString("zh-CN", { minimumFractionDigits: d, maximumFractionDigits: d });

/** 溯源角标：求解器结果带 snapshotVersion（一个事实一个出处） */
export function SnapshotBadge({ snapshotVersion, tool }: { snapshotVersion?: string; tool: string }) {
  if (!snapshotVersion) return null;
  return (
    <span className="badge" title={`invoke_solver:${tool} · snapshot ${snapshotVersion}`} data-testid="snapshot-badge">
      ⓘ {zh.sim.snapshotBadge(snapshotVersion)}
    </span>
  );
}

/**
 * `?` 口径浮层（`docs/CONVENTION-ui-information-layering.md` §2 R-UI-3 的统一实现）。
 *
 * 规范原文的三条硬要求，逐条对应到下面的实现：
 *  · **禁止用 HTML `title` 属性 / SVG `<title>` 充当浮层** —— 那是浏览器原生 tooltip，
 *    由操作系统绘制、不受组件控制、永远画在最上层、移开后会滞留
 *    （2026-08-10 实测事故：`ChainLineMapView.tsx` 的两个 SVG `<title>` 在环形图上滞留遮挡图形）。
 *    所以这里是一个**受控 DOM 节点**：`open` 由 React state 决定，移开即卸载，不可能滞留。
 *  · **键盘可达**：focus 显示 / blur 消失 / `Esc` 关闭（`Esc` 同时 `blur()`，
 *    否则焦点还在按钮上、`onFocus` 不会再触发，用户会以为浮层坏了）。
 *  · **`max-width` ≈ 380px、超长内可滚动** —— 见 `SimViews.module.css` 的 `.hintPop`。
 *
 * ⚠ 本组件只放「口径 / 公式 / 为什么这么算 / 诚实位说明 / 数据来源」。
 * **结论性数字不许只藏在浮层里**（规范 §1 表：数字属于第一层）。
 */
export function HintDot({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className={styles.hintWrap}>
      <button
        type="button"
        className={styles.hintBtn}
        aria-label={`${label}·口径说明`}
        aria-expanded={open}
        data-testid={testId}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            e.currentTarget.blur();
          }
        }}
      >
        ?
      </button>
      {open && (
        <span role="tooltip" className={styles.hintPop} data-testid={`${testId}-pop`}>
          {children}
        </span>
      )}
    </span>
  );
}

/**
 * ══ 判据 U7 的那一半：**把「我是哪一页」告诉同屏问答** ══
 *
 * 同屏问答（`components/QueryDock`）由 `ShellLayout` 在**所有** `/v/` 路径上常驻挂载
 * （`ShellLayout.tsx` 的 `onViewPage && dockOn && <QueryDock />`），所以「AI 在不在同屏」
 * 这半从来不是问题。真问题在**另一半**，而它 grep 一次看不见：
 *
 *   `setView()` 的生产调用方只有两个 —— `pages/ViewPage.tsx` 与
 *   `components/ScenarioLauncher/useScenarioLaunch.ts`。
 *   而 `App.tsx` 里六个页面是**专用 route 直挂**（`v/what-if` / `v/optimize-whatif` /
 *   `v/cleanroom-attr` / `v/disruption-radius` / `v/decision-play` / `v/sim-sandbox`），
 *   **不经过 `ViewPage`** ⇒ 这六页上 `setView` 一次都不会被调到。
 *
 * 后果是静默的、屏上看不出来的：问答框照常显示，但
 *   ① `QueryDock` 的 `fetchScene(view)` 带 `enabled: view !== ""`，view 空则**不取本页场景**
 *      ⇒ 建议问句退化成通用兜底；
 *   ② `sessionStore.derivePageContext()` 把 `view` 塞进 `pageContext.view` 随查询搭车
 *      ⇒ 编排侧收到的「用户在哪一页」是**上一页的残值或空串**。
 * 也就是说：问答是在的，但它答的不是「本页」。判据 U9 的措辞「基于**本页**实时数据」
 * 卡的正是这一步。
 *
 * 专用 route 的存在有它的理由（免依赖后端下发即可达），所以修法不是把它们塞回 `ViewPage`，
 * 而是让这些页**自己报到**。一行 hook，与 `ViewPage` 走同一个 `setView`（不另开一条路）。
 *
 * ⚠ 经 `ViewPage` 分发的页**不要**调它：`ViewPage` 已经报过一次，再报一次只是重复。
 */
export function usePageView(viewKey: string): void {
  const setView = useSessionStore((s) => s.setView);
  useEffect(() => {
    setView(viewKey);
  }, [setView, viewKey]);
}

/**
 * ══ 判据 U9 的渲染半 · 「导出」按钮 ══
 *
 * 参考件把「导出」与「同屏问答」并成一条 chip 条（`reference-prototype-decision-platform.html`
 * 第 3587 行 `aiBar()`），五个挂载点共用一个 `exportPage()`。本组件是它的对位实现：
 * **一份实现、多页挂载**，导出物的口径措辞因此只有一处，不会各页分家。
 *
 * 分层（`docs/CONVENTION-ui-information-layering.md` §1/§2 R-UI-3）：
 *  · 第一层只留**动作本身**（一个按钮 + 一个 `?` 记号）——它是「名字」，不是说明；
 *  · 「导出物里到底有什么、凭什么能复算」是口径，属浮层，故进 `InfoPopover`。
 *    静默降层等于删除，所以第一层必须留下那个 `?`（`InfoPopover` 的触发器就是它）。
 * 颜色一律走既有的 `btn sm` 类（应用内零字面色值，暗/亮两套主题都成立）；
 * 导出物自己那套浅色排版在 `exportProvenance.ts`，理由见该文件头注释。
 *
 * `build` 做成**函数**而不是现成对象：导出要的是「点下去那一刻屏上的数」，
 * 提前算好会在用户改了输入之后导出一份过期的表 —— 那正是 U9 想防的失败模式。
 */
export function ExportReportButton({ pageKey, build }: { pageKey: string; build: () => ProvenanceReport }) {
  return (
    <span className={styles.exportWrap} data-testid={`export-wrap-${pageKey}`}>
      <button
        type="button"
        className="btn sm"
        data-testid={`export-report-${pageKey}`}
        onClick={() => {
          try {
            downloadProvenanceReport(build());
          } catch (e) {
            toastError(e);
          }
        }}
      >
        ⬇ 导出
      </button>
      <InfoPopover topic="导出内容" testId={`export-${pageKey}`}>
        <span data-testid={`export-basis-${pageKey}`}>
          导出的是一份可离线打开的独立文档：抬头带生成时间，正文首段逐条列出这一屏的数由哪个求解器、
          算在哪一版数据上得出，然后才是表格本身。拿到文档的人可以照着这段出处把同样的数再算一遍，
          所以它能直接进决议附件；只有截图或裸表格做不到这件事。
        </span>
      </InfoPopover>
    </span>
  );
}

/** 逐日张力 heat strip（与推演看板 MiniStrip 同视觉语言；risk-board 未导出 → 此处独立实现） */
export function HeatStrip({ series, threshold }: { series: number[]; threshold: number }) {
  return (
    <div className={styles.heatStrip} data-testid="sim-heat-strip">
      {series.map((v, i) => (
        <span
          key={i}
          title={`D+${i} · ${v.toFixed(0)}`}
          style={{
            background:
              v >= threshold
                ? "rgba(224,98,108,.85)"
                : v >= threshold - 15
                  ? "rgba(232,181,74,.7)"
                  : `rgba(67,183,215,${0.15 + (v / 100) * 0.55})`,
          }}
        />
      ))}
    </div>
  );
}

/** 采纳 → Action 草稿（C10 审批留痕，统一 actionTypeKey=plan_change —— 体检页旧链路保留） */
export function useAdoptToDraft() {
  const { data: workspace } = useWorkspace();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      createActionDraft({
        actionTypeKey: "plan_change",
        payload,
        origin: { userId: workspace?.user?.id ?? "usr-unknown" },
        submit: true,
      }),
    onSuccess: () => toast(`${zh.sim.adoptDone}（${zh.sim.gotoActions}：/admin/actions）`, "success"),
    onError: toastError,
  });
}

/**
 * 采纳类按钮统一行为（增量 §0-4）：POST /a/v1/action-drafts（actionType 按各节）
 * → toast「草稿已创建，待审批」+ 链接 /admin/actions。任何视图不得直改计划/排产数据。
 */
export function useActionDraft() {
  const { data: workspace } = useWorkspace();
  return useMutation({
    mutationFn: (input: { actionTypeKey: string; payload: Record<string, unknown> }) =>
      createActionDraft({
        actionTypeKey: input.actionTypeKey,
        payload: input.payload,
        origin: { userId: workspace?.user?.id ?? "usr-unknown" },
        submit: true,
      }),
    onSuccess: () => toast(`草稿已创建，待审批（${zh.sim.gotoActions}：/admin/actions）`, "success"),
    onError: toastError,
  });
}
