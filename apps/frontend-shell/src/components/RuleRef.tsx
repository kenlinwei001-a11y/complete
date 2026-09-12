import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchRules } from "@/api/endpoints";

/**
 * 规则锚点（R13 两跳溯源 · 参考原型 linkRules/showRulePop）：把规则编号（C01–C33，
 * 可 "C01/C02" 多个）渲染为可悬浮锚点，悬浮即弹规则完整定义（表达式/作用域/严重级/版本）。
 * 与 <Provenance> 组合形成两跳："结论数字 → 关联规则 → 规则详情"。
 */
export function RuleRef({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ["a", "rules", {}], queryFn: fetchRules, enabled: open, staleTime: 60_000 });
  const codes = code.split(/[/、,\s]+/).filter(Boolean);
  const rules = (data ?? []).filter((r) => codes.includes(r.key));

  return (
    <span
      style={{ position: "relative", borderBottom: "1px dotted var(--c-solver, #C470B8)", cursor: "help", color: "var(--red, #DD7E9E)" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      data-testid={`ruleref-${code}`}
    >
      <b>{code}</b>
      {open && (
        <span
          /* 欠账 #104：两跳的第二跳同样是浮层（且常盖在第一跳浮层上）→ 不透明 .popover-surface，非磨砂 .panel。 */
          className="popover-surface"
          role="tooltip"
          data-testid="ruleref-pop"
          style={{ position: "absolute", zIndex: 70, top: "130%", left: 0, minWidth: 300, padding: 10, fontSize: 12, textAlign: "left", whiteSpace: "normal" }}
        >
          {!data ? (
            <span style={{ color: "var(--muted2)" }}>加载中…</span>
          ) : rules.length === 0 ? (
            <span style={{ color: "var(--muted2)" }}>规则 {code}（当前库中未找到定义）</span>
          ) : (
            rules.map((r) => (
              <div key={r.id} style={{ marginBottom: 6 }}>
                <div>
                  <b>{r.key}</b> · {r.name} <span className="badge">{r.severity}</span>{" "}
                  <span style={{ color: "var(--muted2)" }}>v{r.version}</span>
                </div>
                <div style={{ marginTop: 2 }}>
                  <code style={{ fontSize: 12 }}>{r.expression}</code>
                </div>
                {r.params && Object.keys(r.params).length > 0 && (
                  <div style={{ marginTop: 2, color: "var(--muted2)" }} data-testid={`ruleref-params-${r.key}`}>
                    阈值：{Object.entries(r.params).map(([k, v]) => `${k}=${v}`).join(" · ")}
                  </div>
                )}
                {r.scopeObjectTypes.length > 0 && (
                  <div style={{ marginTop: 2, color: "var(--muted2)" }}>作用域：{r.scopeObjectTypes.join(" · ")}</div>
                )}
              </div>
            ))
          )}
        </span>
      )}
    </span>
  );
}
