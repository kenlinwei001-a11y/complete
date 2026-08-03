import { useEffect, useMemo, useRef, useState } from "react";

/**
 * C11 · DSL 输入辅助（addendum §7 · D-28）：表达式输入框带对象-属性/操作符/命名阈值自动补全。
 * 触发：① 输入 `Type.` → 联想该对象类型的属性（数据源=本体元模型）；② 输入裸标识符前缀 → 联想对象类型 + 命名阈值键；
 *      ③ 空格后 → 联想操作符。纯前端词法补全（确定性，无 LLM），降低裸写门槛；语法校验/dry-run 仍由既有机制兜底。
 *
 * 复用为受控 textarea：value/onChange 与原生一致，额外注入补全候选数据源。
 */
export interface DslSchema {
  /** 对象类型 → 属性键列表（来自 fetchObjectTypes）。 */
  objectTypes: { key: string; props: string[] }[];
  /** 命名阈值键（编辑器 paramRows 的 key），可作裸标识符引用。 */
  paramKeys: string[];
  /** 已发布规则码（规则绑定/引用场景提示）。 */
  ruleCodes?: string[];
}

const OPERATORS = ["&&", "||", "==", "!=", ">=", "<=", ">", "<", "+", "-", "*", "/", "IMPLIES", "true", "false"];

/** 取光标前的当前 token（标识符/带点路径），用于补全匹配。 */
function tokenBefore(text: string, caret: number): { token: string; start: number } {
  const before = text.slice(0, caret);
  const m = /([A-Za-z_][\w.]*)$/.exec(before);
  if (!m) return { token: "", start: caret };
  return { token: m[1] ?? "", start: caret - (m[1]?.length ?? 0) };
}

export function dslSuggestions(schema: DslSchema, token: string): { label: string; insert: string; kind: string }[] {
  const out: { label: string; insert: string; kind: string }[] = [];
  // `Type.` → 该类型属性
  const dot = token.lastIndexOf(".");
  if (dot >= 0) {
    const typeKey = token.slice(0, dot);
    const propPrefix = token.slice(dot + 1).toLowerCase();
    const ot = schema.objectTypes.find((t) => t.key === typeKey);
    if (ot) {
      for (const p of ot.props) {
        if (p.toLowerCase().startsWith(propPrefix)) out.push({ label: `${typeKey}.${p}`, insert: `${typeKey}.${p}`, kind: "属性" });
      }
      return out.slice(0, 12);
    }
  }
  // 裸前缀 → 对象类型 / 命名阈值键 / 操作符关键字 / 规则码
  const pfx = token.toLowerCase();
  for (const t of schema.objectTypes) if (t.key.toLowerCase().startsWith(pfx)) out.push({ label: `${t.key}.`, insert: `${t.key}.`, kind: "对象类型" });
  for (const k of schema.paramKeys) if (k.toLowerCase().startsWith(pfx) && k) out.push({ label: k, insert: k, kind: "阈值" });
  for (const op of OPERATORS) if (op.toLowerCase().startsWith(pfx) && /^[a-z]/i.test(op)) out.push({ label: op, insert: op, kind: "关键字" });
  for (const rc of schema.ruleCodes ?? []) if (rc.toLowerCase().startsWith(pfx)) out.push({ label: rc, insert: rc, kind: "规则码" });
  return out.slice(0, 12);
}

export function DslTextarea({
  value,
  onChange,
  schema,
  testid,
  ariaLabel,
  invalid,
  style,
  minHeight = 64,
}: {
  value: string;
  onChange: (v: string) => void;
  schema: DslSchema;
  testid: string;
  ariaLabel: string;
  invalid?: boolean;
  style?: React.CSSProperties;
  minHeight?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [active, setActive] = useState(0);
  // 失焦收起的延时（让 mousedown 先落地）必须可取消：卸载后再 setState 就是残留句柄
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (blurTimerRef.current !== null) clearTimeout(blurTimerRef.current);
    },
    [],
  );

  const suggestions = useMemo(() => dslSuggestions(schema, token), [schema, token]);

  const refresh = (text: string) => {
    const caret = ref.current?.selectionStart ?? text.length;
    const { token: tk } = tokenBefore(text, caret);
    setToken(tk);
    setActive(0);
    setOpen(tk.length > 0);
  };

  const pick = (insert: string) => {
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const { start } = tokenBefore(value, caret);
    const next = value.slice(0, start) + insert + value.slice(caret);
    onChange(next);
    setOpen(false);
    // 还原光标到插入末尾
    requestAnimationFrame(() => {
      if (el) {
        const pos = start + insert.length;
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
  };

  return (
    <div style={{ position: "relative" }}>
      <textarea
        ref={ref}
        className="mono"
        style={{ width: "100%", minHeight, fontSize: 12, borderColor: invalid ? "var(--danger)" : undefined, ...style }}
        value={value}
        aria-label={ariaLabel}
        data-testid={testid}
        onChange={(e) => {
          onChange(e.target.value);
          refresh(e.target.value);
        }}
        onKeyDown={(e) => {
          if (!open || suggestions.length === 0) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % suggestions.length); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + suggestions.length) % suggestions.length); }
          else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(suggestions[active]!.insert); }
          else if (e.key === "Escape") setOpen(false);
        }}
        onBlur={() => {
          blurTimerRef.current = setTimeout(() => {
            blurTimerRef.current = null;
            setOpen(false);
          }, 150);
        }}
      />
      {open && suggestions.length > 0 && (
        <ul
          data-testid={`${testid}-suggest`}
          role="listbox"
          style={{ position: "absolute", zIndex: 20, background: "var(--panel,#1b1d22)", border: "1px solid var(--border,#3334)", borderRadius: 4, margin: 0, padding: 4, listStyle: "none", maxHeight: 200, overflow: "auto", minWidth: 200, fontSize: 12 }}
        >
          {suggestions.map((s, i) => (
            <li key={s.label}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                data-testid={`${testid}-opt-${s.label}`}
                style={{ display: "flex", width: "100%", gap: 8, justifyContent: "space-between", background: i === active ? "var(--accent,#36507a)" : "transparent", border: "none", color: "inherit", padding: "3px 6px", cursor: "pointer", textAlign: "left" }}
                onMouseDown={(e) => { e.preventDefault(); pick(s.insert); }}
              >
                <span className="mono">{s.label}</span>
                <span className="muted" style={{ fontSize: 10 }}>{s.kind}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
