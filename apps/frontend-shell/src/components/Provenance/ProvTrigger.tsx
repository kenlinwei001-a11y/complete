import type { ReactNode } from "react";
import { useProvenance } from "./ProvenancePopover";
import styles from "./ProvTrigger.module.css";

function rectOf(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, bottom: r.bottom, right: r.right };
}

/** 上标引用角标（text block ⟦ref:provId⟧ → ⟦n⟧） */
export function ProvMark({
  provId,
  taskId,
  index,
  value,
  label,
  resolved = true,
}: {
  provId: string;
  taskId: string;
  index: number;
  value?: string;
  label?: string;
  /**
   * 这个 provId 在 provenance 表里**找得到**吗（调用方拿 `provIndex(provId) > 0` 判）。
   *
   * ⚠ 为什么必须有这一位：`provIndex` 对**找不到**的 id 返回 0，而这里原先无条件印 `[{index}]`
   * ⇒ 一条指不出任何出处的引用，在屏上长得跟真角标**一模一样**（`[0]`）。
   * 实测（2026-10-06 活服务）：答案正文带 `⟦ref:0⟧`…`⟦ref:18⟧` 而 `answer.provenance` 是空数组
   * ⇒ 满屏 `[0]`，每个都点不出东西，读者却当它们各有出处。
   * 形态（铁律 0.6 句式）：「我用『有个角标』当作『这个数字指得出出处』的证据，而前者并不度量后者。」
   */
  resolved?: boolean;
}) {
  const prov = useProvenance();
  const payload = (el: HTMLElement) => ({ provId, taskId, value, label, rect: rectOf(el) });
  if (!resolved) {
    // 未知出处：**不可点**（没有出处可弹）、外观与真角标可分辨、且如实说「未注明出处」。
    return (
      <sup
        className={styles.unresolvedMark}
        data-testid={`prov-mark-unresolved-${provId}`}
        // ⚠ 只用 `aria-label`，**不加原生 `title=`**：原生 title 是浏览器 tooltip，属 R-UI-3
        //   禁止的「用 title 承载口径」——`provenance-popover-legibility` 的原生 title 棘轮
        //   当场 +1（33→34）报红，它给的正解就是「改成可见文字或 aria-label」。
        //   屏上说明已由答案卡顶部的 `unverified-strip` 承担，这里只留一个可分辨的记号。
        aria-label="该数字未注明出处"
      >
        ?
      </sup>
    );
  }
  return (
    <sup
      className={styles.mark}
      data-testid={`prov-mark-${provId}`}
      tabIndex={0}
      role="button"
      aria-label={`溯源 ${provId}`}
      onMouseEnter={(e) => prov.scheduleOpen(payload(e.currentTarget))}
      onMouseLeave={() => prov.cancelScheduled()}
      onClick={(e) => prov.open(payload(e.currentTarget), true)}
      onKeyDown={(e) => e.key === "Enter" && prov.open(payload(e.currentTarget), true)}
    >
      [{index}]
    </sup>
  );
}

/** 整卡/区域悬停溯源（kpi 卡、table 表头角标等） */
export function ProvHoverArea({
  provId,
  taskId,
  value,
  label,
  children,
  className,
  testId,
}: {
  provId: string;
  taskId: string;
  value?: string;
  label?: string;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const prov = useProvenance();
  const payload = (el: HTMLElement) => ({ provId, taskId, value, label, rect: rectOf(el) });
  return (
    <div
      className={className}
      data-testid={testId}
      tabIndex={0}
      onMouseEnter={(e) => prov.scheduleOpen(payload(e.currentTarget))}
      onMouseLeave={() => prov.cancelScheduled()}
      onClick={(e) => prov.open(payload(e.currentTarget), true)}
      onKeyDown={(e) => e.key === "Enter" && prov.open(payload(e.currentTarget), true)}
    >
      {children}
    </div>
  );
}
