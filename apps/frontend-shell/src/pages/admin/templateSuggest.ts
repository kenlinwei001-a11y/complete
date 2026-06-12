import type { PlanStep } from "@platform/contracts";

/**
 * TemplateValue 自动补全（PRD §7.8 workflows）：
 * 来源 = 已声明 slots（workflow.inputs properties）+ 前序步骤（只提示 j < i 的 steps）。
 */
export function templateSuggestions(
  inputs: Record<string, unknown> | undefined,
  steps: PlanStep[],
  currentIndex: number,
): string[] {
  const out: string[] = [];
  const props = (inputs?.properties ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(props)) out.push(`{{slots.${key}}}`);
  for (let j = 0; j < currentIndex; j++) {
    const s = steps[j];
    if (s) out.push(`{{steps.${s.id}.output}}`);
  }
  return out;
}

/** 过滤：按用户已输入的 token（"{{" 之后的部分）前缀匹配 */
export function filterSuggestions(all: string[], token: string): string[] {
  if (!token) return all;
  return all.filter((s) => s.slice(2).startsWith(token) || s.includes(token));
}
