/**
 * RESOURCE-REF-NAV（P1 · item ④）：统一资源引用控件 —— 以 <select> 呈现某类资源的 id 引用，
 * 当前值若不在候选列表中（如指向已删除资源）诚实标注「未找到」而非静默丢弃，避免看似正常实则悬空引用。
 */
export interface ReferenceOption {
  id: string;
  label: string;
}

export function ReferenceSelect({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
  emptyLabel = "（暂无可选资源）",
}: {
  value: string;
  options: ReferenceOption[];
  onChange: (id: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  emptyLabel?: string;
}) {
  const known = options.some((o) => o.id === value);
  return (
    <select value={value} disabled={disabled || options.length === 0} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)}>
      {options.length === 0 && <option value="">{emptyLabel}</option>}
      {value && !known && (
        <option value={value}>
          {value}（未找到，可能已被删除）
        </option>
      )}
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
