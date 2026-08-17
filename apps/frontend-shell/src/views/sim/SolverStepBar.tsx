import { useState } from "react";
import styles from "./SolverStepBar.module.css";

/**
 * ══ 判据 U2 的那一半：**同一份结果按步展开，每步标 数据·求解器·规则** ══
 *
 * 判据原文（`docs/PRD-harness-ux-adoption.md` §2 U2）：
 *   「页内有推演过程的步骤态（同一份结果按步展开），且每步能看到它的 数据·求解器·规则。
 *    **业务流程步骤（评审→平衡→定稿）与行动计划步骤不算**」。
 * 用户读了能做的决定：**对最终结果存疑时，能停在某一步，只看那一步的数** ——
 * 把「这个结论我不信」变成「第 3 步的评分我不信」。
 *
 * ── 契约判定（WO-U2-STEPWISE-1 · 为什么不给求解器输出加 `steps[]`）──────────────
 * 今天没有任何求解器输出带 `steps[]` 这层结构，两个方向：
 *  · 后端加 steps[] —— 真改 = 求解器改成分步计算、逐步发快照（大改，且超本单边界：
 *    本单不碰后端两包）。只把现有输出在服务端重排成 steps[] 投影 = 同一投影做两遍，
 *    两套并行结构迟早漂移（RL3 单一真相源）。
 *  · 前端按已有分段信息推导 —— **本单走这条**：求解器输出**自带**真实分段字段
 *    （plan_generate：outcome → scores → hardViol/meets → recommend；
 *     optimize_whatif：baseline/perturbedObjective → baselineSolution/perturbedSolution
 *     → feasible/conflictConstraints → explanation），前端按字段分步，**读的每一个数都是真值，零臆造**。
 * 残余风险：求解器内部阶段语义变了，前端按字段名推导的步骤语义可能悄悄漂移。
 * 对冲：本契约**强制每步声明它读的是哪个字段**（`SolverStep.data`）——字段没了/改名了，
 * 引用当场断、屏上当场看得出来（不会静默说谎）。跨页统一的后端 steps[]（带逐段哈希）
 * 记为后续单 WO-U2-SOLVER-STEPS，见交单报告「没做的格」。
 *
 * ── 为什么分段闸集中在 `upto` 一个函数 ─────────────────────────────────────
 * U2 的失败模式是「步骤条渲染出来了，但点它不影响任何数」——屏上分辨不出，
 * 只有真去点的人才发现是装饰。所以验收不是「步骤条在」，是「**点第 N 步 ⇒
 * 结果区的数变了（只显示到第 N 步为止）**」。页面每个结果段都用 `upto(步号)`
 * 决定渲染与否；变异反证 = 把 `upto` 改成恒真，测试必须红在「数没变」。
 */

/** 一步推演 = 求解器输出的一个真实分段。三要素 = U2 判据「每步标 数据·求解器·规则」。 */
export interface SolverStep {
  /** 稳定键（testid 用）。 */
  key: string;
  /** 步骤名（如「路径推演」）。 */
  label: string;
  /** **数据**：这一步读什么（入参面板 / 求解器输出的哪个字段）——写清字段名，漂移即断引用。 */
  data: string;
  /** **求解器**：这一步的数是哪次调用产出的（求解器键，或「页面入参·未求解」）。 */
  solver: string;
  /** **规则**：这一步的判定口径（规则键 / 投影规则原文 / 「无判定·入参回显」）。 */
  rule: string;
}

/**
 * U2 步骤态钩子。`active` = 当前展开到第几步（1-based，**默认末步 = 完整结果**，
 * 与改前屏面逐字节一致 ⇒ 存量测试零回归）。
 *
 * ⚠ `upto(n)` 是**唯一分段闸**：「点第 N 步 ⇒ 屏上的数只显示到第 N 步为止」全靠它。
 * 任何结果段不许绕开它自行判断 `active`（绕开 = 步骤条退化成装饰，且变异反证咬不到）。
 */
export function useSolverStep(stepCount: number): {
  active: number;
  setActive: (n: number) => void;
  upto: (stepNo: number) => boolean;
} {
  const [active, setActive] = useState(stepCount);
  return { active, setActive, upto: (n: number) => active >= n };
}

/**
 * 共享步骤条：横向步骤钮 + 当前步的 数据·求解器·规则 口径行。
 * 本组件只管**步骤态与口径展示**；结果分段由调用方用 `upto` 闸（闸在页面，
 * 因为各页结果区结构不同——但闸的判据只有 `upto` 一个出处）。
 */
export function SolverStepBar({
  steps,
  active,
  onSelect,
  testId = "solver-step-bar",
}: {
  steps: SolverStep[];
  active: number;
  onSelect: (stepNo: number) => void;
  testId?: string;
}) {
  const cur = steps[active - 1];
  return (
    <div className={styles.wrap} data-testid={testId}>
      <div className={styles.track} role="group" aria-label="推演步骤">
        {steps.map((s, i) => {
          const n = i + 1;
          const state = n < active ? "done" : n === active ? "on" : "todo";
          return (
            <button
              key={s.key}
              type="button"
              data-testid={`${testId}-step-${n}`}
              data-step-key={s.key}
              data-state={state}
              className={`${styles.step} ${state === "on" ? styles.on : state === "done" ? styles.done : ""}`}
              onClick={() => onSelect(n)}
            >
              <span className={styles.no}>{n}</span>
              {s.label}
            </button>
          );
        })}
      </div>
      {/* U2 判据第二半：每步能看到它的 数据·求解器·规则（当前步口径行）。 */}
      {cur && (
        <div className={styles.meta} data-testid={`${testId}-meta`}>
          <span className={styles.metaItem} data-testid={`${testId}-meta-data`}>
            <i className={styles.metaKey}>数据</i>
            {cur.data}
          </span>
          <span className={styles.metaItem} data-testid={`${testId}-meta-solver`}>
            <i className={styles.metaKey}>求解器</i>
            <span className="mono">{cur.solver}</span>
          </span>
          <span className={styles.metaItem} data-testid={`${testId}-meta-rule`}>
            <i className={styles.metaKey}>规则</i>
            {cur.rule}
          </span>
        </div>
      )}
    </div>
  );
}
