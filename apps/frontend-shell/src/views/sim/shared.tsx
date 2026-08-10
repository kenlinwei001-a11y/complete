import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { createActionDraft } from "@/api/endpoints";
import { useWorkspace } from "@/workspace/useWorkspace";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";
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
