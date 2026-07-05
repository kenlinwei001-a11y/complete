import type { DataCategory, IntakeCoverageResponse, IntakeTypeCoverage } from "@platform/contracts";
import type { ObjectTypeDef } from "./domain.js";
import { buildDataTemplates } from "./synthetic/data-template.js";

/**
 * PANORAMA-FIELD-INTAKE（G-6 邻域收口）：全景类型 × 字段供给覆盖矩阵——纯派生（R14 零手焙 / R6 确定性）。
 * 基准 = 图谱全景对象节点全集（`ontology.listTypes` = ACTIVE 已发布类型，与 `GET /a/v1/ontology/graph` 同源）。
 * 逐类型盘点：非派生 props（需外部供给的字段全集 M）vs
 *  ① 上传路径：数据模版列（`buildDataTemplates`，列 = 非派生 props 含 FK/ref 列·G-6）；
 *  ② 连接器路径：`sourceBindings.fieldMappings`（propKey → 源字段）已映射字段。
 * 缺口**字段级清单化**（非模糊）；连接器缺源字段诚实进 `unmapped`（非隐藏）。
 */
export function buildIntakeCoverage(types: ObjectTypeDef[], categories: DataCategory[]): IntakeCoverageResponse {
  const active = types.filter((t) => t.status === "ACTIVE");
  const tplByType = new Map(buildDataTemplates(active).map((t) => [t.typeKey, t]));
  const categoryOfType = new Map<string, string>();
  for (const cat of categories) for (const tk of cat.typeKeys) if (!categoryOfType.has(tk)) categoryOfType.set(tk, cat.key);

  const items: IntakeTypeCoverage[] = active.map((t) => {
    const derived = new Set(t.derivedProperties.map((d) => d.propKey));
    const intakeProps = t.properties.filter((p) => !derived.has(p.propKey));
    const tpl = tplByType.get(t.key);
    const tplCols = new Set(tpl?.columns ?? []);

    // 连接器路径：每个绑定 mapped/unmapped 逐字段列出（诚实·非隐藏）。
    const bindings = (t.sourceBindings ?? []).map((b) => {
      const fm = b.fieldMappings ?? {};
      const mapped = intakeProps
        .filter((p) => typeof fm[p.propKey] === "string" && fm[p.propKey]!.length > 0)
        .map((p) => ({ propKey: p.propKey, sourceField: fm[p.propKey]! }));
      const mappedSet = new Set(mapped.map((m) => m.propKey));
      return {
        connId: b.connId,
        dataset: b.dataset,
        mapped,
        unmapped: intakeProps.filter((p) => !mappedSet.has(p.propKey)).map((p) => p.propKey),
      };
    });
    const connectorMapped = new Set(bindings.flatMap((b) => b.mapped.map((m) => m.propKey)));

    const fields = intakeProps.map((p) => ({
      propKey: p.propKey,
      dataType: p.dataType,
      isPrimaryKey: p.isPrimaryKey,
      refToTypeKey: p.dataType === "ref" ? (p.refToTypeKey ?? null) : null,
      template: tplCols.has(p.propKey),
      connector: connectorMapped.has(p.propKey),
    }));

    const templateMissing = fields.filter((f) => !f.template).map((f) => f.propKey);
    const suppliable = fields.filter((f) => f.template || f.connector).length;
    return {
      typeKey: t.key,
      displayName: t.displayName,
      intakeTotal: intakeProps.length,
      derivedCount: t.derivedProperties.length,
      suppliable,
      template: {
        available: !!tpl,
        columns: tpl?.columns ?? [],
        primaryKey: tpl?.primaryKey ?? null,
        refColumns: tpl?.refColumns ?? [],
        covered: fields.filter((f) => f.template).length,
        missing: templateMissing,
        downloadPath: `/a/v1/data-templates/${t.key}`,
      },
      connector: {
        bindings,
        mapped: fields.filter((f) => f.connector).map((f) => f.propKey),
        unmapped: fields.filter((f) => !f.connector).map((f) => f.propKey),
      },
      fields,
      gaps: fields.filter((f) => !f.template && !f.connector).map((f) => f.propKey),
      categoryKey: categoryOfType.get(t.key) ?? null,
    };
  });

  return {
    items,
    summary: {
      types: items.length,
      templateComplete: items.filter((i) => i.template.available && i.template.missing.length === 0).length,
      typesWithTemplateGap: items.filter((i) => !i.template.available || i.template.missing.length > 0).map((i) => i.typeKey),
      typesWithConnectorUnmapped: items.filter((i) => i.connector.bindings.length > 0 && i.connector.unmapped.length > 0).map((i) => i.typeKey),
      uncategorized: items.filter((i) => i.categoryKey === null).map((i) => i.typeKey),
    },
  };
}
