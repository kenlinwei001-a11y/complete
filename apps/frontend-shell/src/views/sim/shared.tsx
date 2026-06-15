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
