import type { OutputViolation, ValidateOutputResult, ValidationPolicy } from "@platform/contracts";
import type { ObjectTypeDef } from "./domain.js";

/**
 * 约束执行层 · 工具/外部/MCP 输出按本体对象类型 schema + 属性值域强制校验（可配置，R14）。
 * 纯函数、确定性（R6）；每条 violation 留痕（R13）。先按 policy.fieldMappings 归一外部字段名，
 * 再按对象类型 PropertyDef（dataType/enumValues/isPrimaryKey）+ policy.domainOverrides（min/max/enum）校验。
 *
 * 不判语义对错（不判 5000 这个额度对不对），只判结构 + 值域合规——信任边界,非真值判断。
 */
export function validateOutputAgainstOntology(
  rows: Record<string, unknown>[],
  typeDef: ObjectTypeDef,
  policy: ValidationPolicy,
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
  });

  return {
    objectType: typeDef.key,
    ok: rejectedRowIdx.size === 0,
    checkedRows: rows.length,
    rejectedRows: rejectedRowIdx.size,
    quarantinedRows: quarantinedRowIdx.size,
    violations,
  };
}
