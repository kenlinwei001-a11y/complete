import type {
  FieldSemanticAnnotation,
  OutputViolation,
  ScopeRuleViolation,
  TypeSemantics,
  ValidateOutputResult,
  ValidationPolicy,
} from "@platform/contracts";
import type { ObjectTypeDef } from "./domain.js";
import { collectFieldPaths, evaluateAst, parseExpression, type AstNode } from "./ruledsl.js";

/**
 * 约束执行层 · 工具/外部/MCP 输出按本体对象类型 schema + 属性值域强制校验（可配置，R14）。
 * 纯函数、确定性（R6）；每条 violation 留痕（R13）。先按 policy.fieldMappings 归一外部字段名，
 * 再按对象类型 PropertyDef（dataType/enumValues/isPrimaryKey）+ policy.domainOverrides（min/max/enum）校验。
 *
 * 不判语义对错（不判 5000 这个额度对不对），只判结构 + 值域合规——信任边界,非真值判断。
 *
 * WO-ONTOLOGY-CONTEXT-A（缺口③·A-半）：可选传入 `semantics`（= OntologyService.getTypeSemantics 的单一真值口径），
 * 则 additive 附上两样此前 A 侧从不用的口径产物——
 *   (a) `fieldSemantics`：逐字段 unit/formula/描述/dataType 溯源注解（口径不再仅喂 B 的 LLM prompt）；
 *   (b) `ruleViolations`：值越过 scope 规则口径线（表达式为真=命中违规条件）的行标记。
 * 二者纯 additive：`ok`/`violations`/rejected/quarantined 语义与结构逐字节不变（不传 semantics 时整段省略，
 * modeling.ts 隔离区校验等既有调用零影响；agentcore 执行器仅读 ok/violations，行为不变）。
 * 口径真值一改（本体 upsertType / 规则 publish），A 输出的注解与规则判定即随之变——非快照（本 WO 的接缝断言）。
 */
export function validateOutputAgainstOntology(
  rows: Record<string, unknown>[],
  typeDef: ObjectTypeDef,
  policy: ValidationPolicy,
  semantics?: TypeSemantics,
): ValidateOutputResult {
  const props = new Map(typeDef.properties.map((p) => [p.propKey, p]));
  const pkKeys = typeDef.properties.filter((p) => p.isPrimaryKey).map((p) => p.propKey);
  const violations: OutputViolation[] = [];
  const rejectedRowIdx = new Set<number>();
  const quarantinedRowIdx = new Set<number>();

  const note = (rowIndex: number, field: string, kind: OutputViolation["kind"], detail: string, action: OutputViolation["action"]) => {
    violations.push({ rowIndex, field, kind, detail, action });
    if (action === "REJECT") rejectedRowIdx.add(rowIndex);
    else if (action === "QUARANTINE") quarantinedRowIdx.add(rowIndex);
  };

  // WO-ONTOLOGY-CONTEXT-A · 预解析该类型 scope 命中的已发布规则表达式（一次解析，逐行复用）。
  // 表达式语法不可解析 → 诚实剔除（不参与，不冒充命中/通过；同 RulesService.evaluate 的健壮性）。
  const scopeRules = (semantics?.rules ?? [])
    .filter((r) => (r.expression ?? "").trim().length > 0)
    .map((r) => {
      try {
        const ast = parseExpression(r.expression as string);
        return { rule: r, ast, fields: ruleFieldKeys(collectFieldPaths(ast), typeDef.key) };
      } catch {
        return null;
      }
    })
    .filter((x): x is { rule: TypeSemantics["rules"][number]; ast: AstNode; fields: string[] } => x !== null);
  const ruleViolations: ScopeRuleViolation[] = [];

  rows.forEach((raw, i) => {
    // ① 字段映射归一：外部字段名 → 本体属性键
    const row: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      row[policy.fieldMappings[k] ?? k] = v;
    }

    // ② 主键/必填存在
    for (const pk of pkKeys) {
      if (row[pk] === undefined || row[pk] === null || row[pk] === "") {
        note(i, pk, "MISSING_REQUIRED", `缺主键 ${pk}`, policy.missingRequired);
      }
    }

    // ③ 野字段（本体未声明）
    for (const field of Object.keys(row)) {
      if (!props.has(field)) note(i, field, "UNKNOWN_FIELD", `本体未声明属性 ${field}`, policy.unknownFields);
    }

    // ④ 逐属性 dataType + 值域
    for (const [propKey, p] of props) {
      const v = row[propKey];
      if (v === undefined || v === null) continue; // 缺值已由 PK/必填覆盖；非 PK 允许空
      const ov = policy.domainOverrides[propKey];
      switch (p.dataType) {
        case "number": {
          const n = typeof v === "number" ? v : Number(v);
          if (!Number.isFinite(n)) { note(i, propKey, "TYPE", `期望 number，得 ${JSON.stringify(v)}`, policy.typeMismatch); break; }
          if (ov?.min !== undefined && n < ov.min) note(i, propKey, "DOMAIN", `${n} < min ${ov.min}`, policy.valueDomain);
          if (ov?.max !== undefined && n > ov.max) note(i, propKey, "DOMAIN", `${n} > max ${ov.max}`, policy.valueDomain);
          break;
        }
        case "boolean":
          if (typeof v !== "boolean" && v !== "true" && v !== "false") note(i, propKey, "TYPE", `期望 boolean，得 ${JSON.stringify(v)}`, policy.typeMismatch);
          break;
        case "date":
          if (Number.isNaN(Date.parse(String(v)))) note(i, propKey, "TYPE", `期望 date，得 ${JSON.stringify(v)}`, policy.typeMismatch);
          break;
        case "enum": {
          const allowed = ov?.enum ?? p.enumValues ?? [];
          if (allowed.length > 0 && !allowed.includes(String(v))) note(i, propKey, "DOMAIN", `enum 非法 ${JSON.stringify(v)}（允许 ${allowed.join("/")}）`, policy.valueDomain);
          break;
        }
        case "ref":
          if (typeof v !== "string" || v === "") note(i, propKey, "TYPE", `ref 应为非空键，得 ${JSON.stringify(v)}`, policy.typeMismatch);
          break;
        default: // string / json：非空性已由 PK 覆盖，结构不强约束
          break;
      }
    }

    // ⑤ WO-ONTOLOGY-CONTEXT-A · 口径 scope 规则：值命中违规条件表达式（表达式为真）→ 标记（不改 ok/violations）。
    // 表达式经 Metric.actual 解析到 row.actual（resolveField 允许省略 typeKey 前缀）。求值异常按不命中处理（诚实不误报）。
    for (const sr of scopeRules) {
      let violated = false;
      try {
        // WO-RULE-EXPR-PARAMS：喂该规则的命名阈值，否则 `params.<名>` 求值即抛 → 被下面 catch 成
        // "不命中"，规则静悄悄变哑弹（C08/C09/C18/C21 都引用命名阈值）。
        violated = evaluateAst(sr.ast, { payload: row, params: sr.rule.params });
      } catch {
        violated = false;
      }
      if (violated) {
        ruleViolations.push({
          rowIndex: i,
          ruleKey: sr.rule.key,
          ruleName: sr.rule.name,
          expression: sr.rule.expression as string,
          severity: sr.rule.severity ?? "WARN",
          fields: sr.fields,
        });
      }
    }
  });

  const result: ValidateOutputResult = {
    objectType: typeDef.key,
    ok: rejectedRowIdx.size === 0,
    checkedRows: rows.length,
    rejectedRows: rejectedRowIdx.size,
    quarantinedRows: quarantinedRowIdx.size,
    violations,
  };
  // WO-ONTOLOGY-CONTEXT-A · additive：仅当拿到 semantics 才附口径注解/规则命中（省略时逐字节兼容旧响应）。
  if (semantics) {
    result.fieldSemantics = buildFieldSemantics(semantics);
    result.ruleViolations = ruleViolations;
  }
  return result;
}

/**
 * WO-ONTOLOGY-CONTEXT-A · 逐字段口径注解：props(unit/description/dataType) ⊕ derived(formula)，键=propKey。
 * 确定性（R6）：props/derived 已由 getTypeSemantics 按 propKey 字典序，故键插入序确定。
 */
function buildFieldSemantics(semantics: TypeSemantics): Record<string, FieldSemanticAnnotation> {
  const out: Record<string, FieldSemanticAnnotation> = {};
  for (const p of semantics.props) {
    const ann: FieldSemanticAnnotation = {};
    if (p.description !== undefined) ann.description = p.description;
    if (p.unit !== undefined) ann.unit = p.unit;
    if (p.dataType !== undefined) ann.dataType = p.dataType;
    out[p.propKey] = ann;
  }
  for (const d of semantics.derived) {
    if (d.formula === undefined) continue;
    out[d.propKey] = { ...(out[d.propKey] ?? {}), formula: d.formula };
  }
  return out;
}

/**
 * WO-ONTOLOGY-CONTEXT-A · 从 collectFieldPaths 的路径集抽出属于本类型的 propKey（去 typeKey 前缀、去重、保序）。
 * 路径可能带 typeKey 前缀（Metric.actual → actual）或裸字段（actual）；用于把规则命中标注到具体字段。
 */
function ruleFieldKeys(paths: string[][], typeKey: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const propKey = path.length > 1 && path[0] === typeKey ? path[1] : path[0];
    if (!propKey || seen.has(propKey)) continue;
    seen.add(propKey);
    out.push(propKey);
  }
  return out;
}
