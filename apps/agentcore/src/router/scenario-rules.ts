import type { PlanStep } from "@platform/contracts";
import { SOLVER_RULE_REFS } from "@platform/contracts";

/**
 * 轨 F · G-9 收尾 · O10：场景卡 rules[] 自动接 evaluate_rules。
 *
 * 当场景卡声明了 rules[] 但其计划既无覆盖这些规则的 evaluate_rules 步、其求解器也未在 SOLVER_RULE_REFS
 * 声明这些规则（=求解器 evaluatedRules 不透出它们）时，**自动插入一个 evaluate_rules 步**，使卡声明的规则
 * 在路径 A 发育/推演时真被评估、透出 PASS/WARN/BLOCK（承接轨E 规则即引用口径）。
 *
 * 覆盖判定（单源，不重复评估）：
 *  - 已有 evaluate_rules 步的 ruleIds（计划内显式评估）；
 *  - ⊕ 计划内 invoke_solver 的 solverKey 在 SOLVER_RULE_REFS 声明的规则（求解器 evaluatedRules 已透出，轨E）。
 * 二者并集即"已覆盖"；卡 rules[] 减去已覆盖 = 待自动补评估的规则。
 *
 * payload：引用计划内 invoke_solver 步输出整对象（{{steps.<id>.output.data}}），使可映射规则真评估
 * （字段路径直接对求解器输出解析）；无求解器步则用 {{slots}}。注入步引用确定存在的步输出，避免
 * TEMPLATE_RESOLUTION_ERROR（契约 evaluate_rules 步无 onError 兜底）。
 * 诚实口径（承接轨E）：可映射字段 → 真 PASS/WARN/BLOCK；字段不在求解器输出 → 工作流规则引擎按表达式
 * 语义求值（本注入只补"被卡声明但求解器 evaluatedRules 未覆盖"的规则，求解器已覆盖的仍走轨E 的 NOT_APPLICABLE 诚实标）。
 */
export function injectScenarioRuleStep(steps: PlanStep[], cardRules: string[]): PlanStep[] {
  if (!cardRules || cardRules.length === 0) return steps;

  const covered = new Set<string>();
  let lastSolverStepId: string | undefined;
  let solverKey: string | undefined;
  for (const st of steps) {
    if (st.type === "evaluate_rules") {
      const ids = (st.params as { ruleIds?: unknown }).ruleIds;
      if (Array.isArray(ids)) for (const r of ids) if (typeof r === "string") covered.add(r);
    }
    if (st.type === "invoke_solver") {
      const sk = (st.params as { solverKey?: unknown }).solverKey;
      if (typeof sk === "string") {
        lastSolverStepId = st.id;
        solverKey = sk;
        for (const r of SOLVER_RULE_REFS[sk] ?? []) covered.add(r);
      }
    }
  }

  const uncovered = cardRules.filter((r) => !covered.has(r));
  if (uncovered.length === 0) return steps; // 全被既有 evaluate_rules 步 / 求解器 evaluatedRules 覆盖，不重复评估

  // payload：求解器输出 data 整对象（exact `{{steps.<id>.output.data}}` → 解析为该对象，规则字段路径直接对其解析）；
  // 无求解器步则用 slots 整对象。注入步引用确定存在的步输出，避免 TEMPLATE_RESOLUTION_ERROR。
  const payload: unknown = lastSolverStepId ? `{{steps.${lastSolverStepId}.output.data}}` : "{{slots}}";

  const injected: PlanStep = {
    id: `o10_eval_rules_${solverKey ?? "card"}`,
    type: "evaluate_rules",
    params: { ruleIds: uncovered, payload },
  } as PlanStep;

  // 插在最后一个 render_answer 之前（让规则违规可在渲染前终止/并入答案）；无 render 步则追加末尾。
  const renderIdx = steps.findIndex((s) => s.type === "render_answer");
  if (renderIdx < 0) return [...steps, injected];
  return [...steps.slice(0, renderIdx), injected, ...steps.slice(renderIdx)];
}
