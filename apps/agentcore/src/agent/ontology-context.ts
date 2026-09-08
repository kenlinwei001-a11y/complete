import type { TypeSemantics } from "@platform/contracts";
import type { ToolAuthCtx } from "../tools/clients.js";
import type { OntologyClient } from "../tools/clients.js";
import type { NavigationSlice } from "./navigation-slice.js";

/**
 * WO-QOS-ONTOLOGY-CONTEXT · 口径语义上下文组装器（缺口③·文档三层投喂第二层）。
 *
 * 病根：本题导航图（navigation-slice.ts）给了综合 LLM「对象类型 + 字段名(KEY_PROPS) + solver 输出形状
 * + 一句话规则提示」，但**没给每个数字的口径**——Metric 的 formula/unit、derivedProperties 的 formula
 *（gap = actual - target、SUM(Order.qty BY model)）、RuleEntry 的 expression（C03「Order.demandDelta>0.5」）
 * 都在 DataCore 本体里，B 侧只 mirror 了名字没 mirror 口径。综合 LLM 因此看的是"带字段名的数据"而非
 *"带口径标注的数据"。本模块补这层：从本题导航 slice 涉及的对象类型 → 取相关 type-semantics 子集
 *（**只列涉及项**·膨胀防护）→ 格式化成「实体口径 / 派生公式 / 规则表达式」块，紧随导航图注入综合步。
 *
 * **诚实边界**：口径全部来自 DataCore 既有 description/formula/expression（getTypeSemantics·单一真值在 A·
 * R1 只读投影不 import 源）；缺口径文本 → 诚实缺省不编造。**数字红线**：此块只解释口径·不产数字·
 * 明确标注「供解释·非数据源」；业务数字仍全部来自工具结果并标 ⟦ref:N⟧。
 *
 * **确定性 R6**：`renderOntologySemanticContext` 是纯函数——按导航图对象类型顺序 + keyProps 顺序 + 规则字典序
 * 排列，同 slice 同 semantics 字节一致（无 LLM/无时钟/无随机）。
 */

/** 本题涉及的对象类型键（= 导航图列出的对象类型·膨胀防护：只取涉及项，不全量倒）。 */
export function selectSemanticTypeKeys(slice: NavigationSlice): string[] {
  return slice.objectTypes.map((o) => o.type);
}

/** 单类型的口径块（实体 + 属性口径 + 派生公式）；无任何口径可标 → 返 null（不加噪声）。 */
function renderTypeBlock(sem: TypeSemantics, keyProps: string[]): string | null {
  // 只投影导航图暴露的关键字段（keyProps）——语义压缩；keyProps 空则退回该类型全部属性（少见）。
  const wanted = keyProps.length > 0 ? new Set(keyProps) : undefined;
  const propByKey = new Map(sem.props.map((p) => [p.propKey, p]));
  const derivedByKey = new Map(sem.derived.map((d) => [d.propKey, d]));
  const order = keyProps.length > 0 ? keyProps : sem.props.map((p) => p.propKey);
  const lines: string[] = [];
  for (const pk of order) {
    if (wanted && !wanted.has(pk)) continue;
    const p = propByKey.get(pk);
    const d = derivedByKey.get(pk);
    const parts: string[] = [];
    if (p?.description) parts.push(p.description);
    if (p?.unit) parts.push(`单位:${p.unit}`);
    if (d?.formula) parts.push(`派生 ${d.formula}`);
    // 只有有口径信息（描述/单位/公式）才列——纯字段名无口径不重复导航图（膨胀防护 + 诚实缺省）。
    if (parts.length === 0) continue;
    lines.push(`    · ${pk}＝${parts.join("｜")}`);
  }
  // 兜底：keyProps 落空但存在派生公式（导航图未暴露的派生），仍列涉及项内的派生。
  if (wanted) {
    for (const d of sem.derived) {
      if (!wanted.has(d.propKey) || !d.formula) continue;
      if (order.includes(d.propKey)) continue;
      lines.push(`    · ${d.propKey}＝派生 ${d.formula}`);
    }
  }
  if (lines.length === 0) return null;
  return [`  - ${sem.typeKey}（${sem.displayName}）：`, ...lines].join("\n");
}

/**
 * 纯渲染（R6）：本题导航 slice + 已取的 type-semantics 子集 → 口径语义块（空则返 ""）。
 * B 侧无任何硬编码口径——全部字段值来自入参 semantics（=A 的 getTypeSemantics 输出）；改 A 的
 * description/formula/expression → 入参变 → 本块同步变（灭 mirror 漂移·证口径来自 A 单一真值）。
 */
export function renderOntologySemanticContext(slice: NavigationSlice, semantics: TypeSemantics[]): string {
  if (semantics.length === 0) return "";
  // 按导航图对象类型顺序遍历（确定性）——只列 slice 涉及的类型（膨胀防护）。
  const semByType = new Map(semantics.map((s) => [s.typeKey, s]));
  const entityBlocks: string[] = [];
  const ruleLines: string[] = [];
  const seenRule = new Set<string>();
  for (const ot of slice.objectTypes) {
    const sem = semByType.get(ot.type);
    if (!sem) continue;
    const block = renderTypeBlock(sem, ot.keyProps);
    if (block) entityBlocks.push(block);
    // 规则：该类型相关已发布规则的表达式（去重·按 key 字典序·涉及项内）。
    for (const r of [...sem.rules].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
      if (seenRule.has(r.key)) continue;
      seenRule.add(r.key);
      const expr = r.expression ? `：${r.expression}` : "";
      const sev = r.severity ? ` [${r.severity}]` : "";
      ruleLines.push(`  - ${r.key} ${r.name}${expr}${sev}`);
    }
  }
  if (entityBlocks.length === 0 && ruleLines.length === 0) return "";
  const out: string[] = [];
  out.push(
    "【口径与规则锚定（以下是上面导航图各字段/规则的口径定义·供你解释数字之义·非数据源；业务数字仍全部来自工具结果并标 ⟦ref:N⟧）】",
  );
  if (entityBlocks.length > 0) {
    out.push("· 实体/指标口径：");
    out.push(...entityBlocks);
  }
  if (ruleLines.length > 0) {
    out.push("· 相关规则（违规条件为真=不通过）：");
    out.push(...ruleLines);
  }
  return out.join("\n");
}

/**
 * 组装口径语义块（缺口③注入体）：slice 涉及对象类型 → getTypeSemantics 取相关子集 → 渲染。
 * fail-open：A 不可达 / 客户端不支持 getTypeSemantics（mock）→ 返 ""（不阻断查询·仅少这层锚定）。
 * 不 per-question 打 A：getTypeSemantics 复用 B→A 资源缓存 TTL60s + {kind}.updated 失效。
 */
export async function buildOntologySemanticContext(
  slice: NavigationSlice,
  ctx: ToolAuthCtx,
  ontology: Pick<OntologyClient, "getTypeSemantics">,
): Promise<string> {
  if (!slice.nonEmpty || !ontology.getTypeSemantics) return "";
  const keys = selectSemanticTypeKeys(slice);
  if (keys.length === 0) return "";
  try {
    const res = await ontology.getTypeSemantics(ctx, keys);
    return renderOntologySemanticContext(slice, res.types);
  } catch {
    return ""; // fail-open：口径锚定是增益·缺失不破查询
  }
}
