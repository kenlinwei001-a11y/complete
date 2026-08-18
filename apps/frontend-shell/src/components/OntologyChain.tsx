/**
 * 本体链（U3 / B-2 · WO-R13-ONTOCHAIN-PANEL）：一个结论的「凭什么」最小完整集 ——
 *   数从哪个对象（对象.实例.字段 + 真值）→ 经哪条边（本体派生边 link key）→ 由哪条规则/公式算出。
 *
 * 铁律：三段内容**全部由调用方从后端响应字段透传**，本组件零编造、零换算。
 * 某段后端今天没下发 ⇒ 调用方传 null 并在 `gaps` 里写明缺什么、为什么缺，
 * 这里渲染诚实缺位（「后端未下发」），**绝不**用占位文案冒充有数据
 * （空面板与「一切顺利」在界面上分不开，那是会说谎的诚实位）。
 *
 * 样式：跟随 Provenance 的既有惯例 —— 内联 style + tokens.css 变量，不写死色值。
 */
import type { ReactNode } from "react";

/** 本体链的三段 + 快照。每段 null = 后端没下发（必须在 gaps 里给出说明）。 */
export interface OntologyChainData {
  /** ① 对象：数从哪个对象的哪个字段来（真值随行）。 */
  object?: {
    type: string;
    id?: string;
    label?: string;
    field?: string;
    value?: string | number | null;
    unit?: string;
  } | null;
  /** ② 边：经哪条本体派生边（link key 原样透出）。 */
  edge?: string | null;
  /** ③ 规则/公式：由谁算出（公式原文 + 求解器 + 规则码）。 */
  rule?: {
    formula?: string;
    solverKey?: string;
    ruleKey?: string;
    ruleParamKey?: string;
  } | null;
  /** 复算基线（{ontology_version}.{epoch}）。 */
  snapshotVersion?: string | null;
  /** 缺段/降级的诚实说明（为什么缺、差哪个字段），逐条上屏。 */
  gaps?: string[];
}

function Leg({ label, testId, present, children }: { label: string; testId: string; present: boolean; children: ReactNode }) {
  return (
    <div data-testid={testId} data-present={present ? "1" : "0"} style={{ marginTop: 4 }}>
      <span style={{ color: "var(--muted2)" }}>{label}：</span>
      {present ? (
        children
      ) : (
        <em style={{ color: "var(--amber, #E8B54A)" }} data-testid={`${testId}-missing`}>
          后端未下发
        </em>
      )}
    </div>
  );
}

export function OntologyChainView({
  conclusion,
  chain,
  testId = "ontology-chain",
}: {
  /** 结论名（标题随行，如「✗ 缺口 12 万套」/「P50 累计产能」）。 */
  conclusion: string;
  chain: OntologyChainData;
  testId?: string;
}) {
  const o = chain.object ?? null;
  const r = chain.rule ?? null;
  const objectPresent = Boolean(o && o.type);
  const edgePresent = Boolean(chain.edge);
  const rulePresent = Boolean(r && (r.formula || r.ruleKey || r.solverKey));
  return (
    <section data-testid={testId} style={{ fontSize: 12, textAlign: "left" }}>
      <div style={{ fontWeight: 700 }} data-testid={`${testId}-title`}>
        本体链 · {conclusion}
      </div>
      <Leg label="对象" testId={`${testId}-object`} present={objectPresent}>
        <b className="mono">
          {o!.type}
          {o!.id ? `.${o!.id}` : ""}
          {o!.field ? `.${o!.field}` : ""}
        </b>
        {o!.label ? <span>「{o!.label}」</span> : null}
        {o!.value !== undefined && o!.value !== null ? (
          <span data-testid={`${testId}-object-value`}>
            {" "}
            = <b>{o!.value}</b>
            {o!.unit ? <em style={{ color: "var(--muted2)" }}> {o!.unit}</em> : null}
          </span>
        ) : null}
      </Leg>
      <Leg label="边" testId={`${testId}-edge`} present={edgePresent}>
        <code>{chain.edge}</code>
      </Leg>
      <Leg label="规则/公式" testId={`${testId}-rule`} present={rulePresent}>
        {r!.formula ? <code data-testid={`${testId}-rule-formula`}>{r!.formula}</code> : null}
        {r!.ruleKey ? (
          <span data-testid={`${testId}-rule-key`} style={{ marginLeft: r!.formula ? 6 : 0 }}>
            规则 <b className="mono">{r!.ruleKey}</b>
            {r!.ruleParamKey ? <span style={{ color: "var(--muted2)" }}>（参数 {r!.ruleParamKey}）</span> : null}
          </span>
        ) : null}
        {r!.solverKey ? (
          <span data-testid={`${testId}-rule-solver`} style={{ marginLeft: 6, color: "var(--muted2)" }}>
            求解器 {r!.solverKey}
          </span>
        ) : null}
      </Leg>
      {chain.snapshotVersion ? (
        <div style={{ marginTop: 4, color: "var(--muted2)" }} data-testid={`${testId}-snapshot`}>
          快照：<span className="mono">{chain.snapshotVersion}</span>
        </div>
      ) : null}
      {chain.gaps && chain.gaps.length > 0 ? (
        <ul style={{ margin: "4px 0 0", paddingLeft: 16, color: "var(--muted)" }} data-testid={`${testId}-gaps`}>
          {chain.gaps.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
