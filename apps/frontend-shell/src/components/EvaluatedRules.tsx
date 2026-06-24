/**
 * 规则即引用 P2（PRD-rules-as-references §8-#2）：把求解器透出的 evaluatedRules 渲染为
 * 「规则闸门」面板——每条显**真评估结果** PASS/WARN/BLOCK（非装饰标签），NOT_APPLICABLE 诚实标。
 * 改规则即改此处结论（全 7 入口经 /a/v1/solvers/:key/invoke 汇聚点一次生效）。
 */
export interface EvaluatedRuleVM {
  key: string;
  name: string;
  outcome: "PASS" | "WARN" | "BLOCK" | "NOT_APPLICABLE";
  expression: string;
  evidence?: string;
}

const OUTCOME: Record<EvaluatedRuleVM["outcome"], { label: string; cls: string }> = {
  PASS: { label: "通过", cls: "green" },
  WARN: { label: "预警", cls: "amber" },
  BLOCK: { label: "拦截", cls: "red" },
  NOT_APPLICABLE: { label: "不适用", cls: "" },
};

export function EvaluatedRules({ rules, ruleSetVersion }: { rules?: EvaluatedRuleVM[]; ruleSetVersion?: string }) {
  if (!rules || rules.length === 0) return null;
  return (
    <div className="panel" data-testid="evaluated-rules" style={{ marginTop: 10, padding: 10 }}>
      <div style={{ fontSize: 12, color: "var(--muted2)", marginBottom: 6 }}>
        规则闸门（真评估·改规则即改推演）{ruleSetVersion ? ` · 规则集 ${ruleSetVersion}` : ""}
      </div>
      <table className="cmp" style={{ width: "100%" }}>
        <tbody>
          {rules.map((r) => {
            const o = OUTCOME[r.outcome] ?? OUTCOME.NOT_APPLICABLE;
            return (
              <tr key={r.key} data-testid={`evalrule-${r.key}`}>
                <td className="mono" style={{ whiteSpace: "nowrap" }}><b>{r.key}</b></td>
                <td className="zh">{r.name}</td>
                <td><span className={`badge ${o.cls}`} data-testid={`evalrule-outcome-${r.key}`}>{o.label}</span></td>
                <td style={{ fontSize: 10, color: "var(--muted2)" }}>{r.evidence}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
