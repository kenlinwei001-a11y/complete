/**
 * 引用模式增量 §2.3 兼容性门禁：workflow 新版本 inputs（JSON Schema）与上一发布版
 * 不兼容（字段删除 / 类型变更）时，若存在 latest 引用方 → 发布被拒
 * BREAKING_CHANGE_WITH_LATEST_REFS（force=true + catalog_admin 可越过，全审计）。
 *
 * WorkflowDefinition 仅声明 inputs schema（输出为运行期 Answer 结构，无声明 schema），
 * 故门禁覆盖 inputs；新增可选字段 / 描述变更视为兼容。
 */

interface LooseSchema {
  properties?: Record<string, { type?: unknown }>;
  required?: string[];
}

export function detectBreakingSchemaChange(
  oldSchema: Record<string, unknown> | undefined,
  newSchema: Record<string, unknown> | undefined,
): string[] {
  const breaks: string[] = [];
  const o = (oldSchema ?? {}) as LooseSchema;
  const n = (newSchema ?? {}) as LooseSchema;
  const oldProps = o.properties ?? {};
  const newProps = n.properties ?? {};
  for (const [name, def] of Object.entries(oldProps)) {
    const next = newProps[name];
    if (!next) {
      breaks.push(`inputs 字段被删除：${name}`);
      continue;
    }
    const oldType = JSON.stringify(def?.type ?? null);
    const newType = JSON.stringify(next?.type ?? null);
    if (oldType !== newType) {
      breaks.push(`inputs 字段类型变更：${name}（${oldType} → ${newType}）`);
    }
  }
  // 新增必填字段：旧调用方不带该字段 → 同样破坏
  const oldRequired = new Set(o.required ?? []);
  for (const r of n.required ?? []) {
    if (!oldRequired.has(r) && oldProps[r] === undefined) {
      breaks.push(`inputs 新增必填字段：${r}`);
    }
  }
  return breaks;
}
