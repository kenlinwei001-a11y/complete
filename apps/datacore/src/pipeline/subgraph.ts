import type { OntologyWorkflow } from "@platform/contracts";
import type { DerivedPropertyDef, LinkTypeDef, ObjectTypeDef, PropertyDef, SliceSpecRecord } from "../domain.js";

/**
 * OntoFlow（PRD v2）P3：把工作流的实体/链路节点转成本体类型/链路 + 子图切片。
 * 纯函数（无 IO）；由 WorkflowService.publish 调 ontology.upsert* 落库。
 * 主线适配：主线 ObjectTypeDef 精简（无 storageMode/stateVariables/functions/actions/… 顶层字段）——
 *   状态变量折叠进 properties；storageMode 不入类型（由 entityStorageModes 单独供推演消费）。
 */

type TypeInput = Omit<ObjectTypeDef, "id" | "tenantId" | "version" | "status">;
type LinkInput = Omit<LinkTypeDef, "id" | "tenantId" | "version">;

const dt = (t: string): PropertyDef["dataType"] => {
  switch (t) {
    case "Double": case "Int": return "number";
    case "Boolean": return "boolean";
    case "Date": return "date";
    case "Json": return "json";
    default: return "string";
  }
};

export function buildTypeDefs(wf: OntologyWorkflow): TypeInput[] {
  const out: TypeInput[] = [];
  for (const n of wf.nodes) {
    if (n.kind !== "SUBGRAPH_ENTITY") continue;
    const m = n.modeling;
    const props = new Map<string, PropertyDef>();
    props.set(m.primaryKey, { propKey: m.primaryKey, dataType: "string", isPrimaryKey: true });
    for (const p of m.properties ?? []) {
      const key = String((p as { propKey?: unknown }).propKey ?? "");
      if (!key || props.has(key)) continue;
      props.set(key, {
        propKey: key,
        dataType: dt(String((p as { dataType?: unknown }).dataType ?? "String")),
        isPrimaryKey: !!(p as { isPrimaryKey?: unknown }).isPrimaryKey,
      });
    }
    for (const sv of m.stateVariables ?? []) {
      if (props.has(sv.propKey)) continue;
      props.set(sv.propKey, { propKey: sv.propKey, dataType: dt(sv.dataType), isPrimaryKey: false });
    }
    const derived: DerivedPropertyDef[] = (m.derived ?? [])
      .map((d) => ({ propKey: String((d as { propKey?: unknown }).propKey ?? ""), formula: String((d as { formula?: unknown }).formula ?? "") }))
      .filter((d) => d.propKey && d.formula);
    out.push({
      key: m.typeKey,
      displayName: m.displayName || m.typeKey,
      domain: m.domain,
      properties: [...props.values()],
      derivedProperties: derived,
      sourceBindings: [],
    });
  }
  return out;
}

/** 实体 typeKey → storageMode（STATIC|ONTOLOGY），供通用推演筛选可推演（ONTOLOGY）类型。 */
export function entityStorageModes(wf: OntologyWorkflow): Map<string, "STATIC" | "ONTOLOGY"> {
  const modes = new Map<string, "STATIC" | "ONTOLOGY">();
  for (const n of wf.nodes) {
    if (n.kind !== "SUBGRAPH_ENTITY") continue;
    modes.set(n.modeling.typeKey, n.storageMode === "ONTOLOGY" ? "ONTOLOGY" : "STATIC");
  }
  return modes;
}

export function buildLinkDefs(wf: OntologyWorkflow): LinkInput[] {
  const out: LinkInput[] = [];
  for (const n of wf.nodes) {
    if (n.kind !== "SUBGRAPH_LINK") continue;
    out.push({ key: n.spec.linkKey, fromTypeKey: n.spec.fromTypeKey, toTypeKey: n.spec.toTypeKey, cardinality: n.spec.cardinality });
  }
  return out;
}

/** 子图切片：root = 第一个实体；每条链路一跳 out 路径。 */
export function buildSliceSpec(wf: OntologyWorkflow): { sliceKey: string; spec: SliceSpecRecord["spec"] } | undefined {
  const firstEntity = wf.nodes.find((n) => n.kind === "SUBGRAPH_ENTITY");
  if (!firstEntity || firstEntity.kind !== "SUBGRAPH_ENTITY") return undefined;
  const rootType = firstEntity.modeling.typeKey;
  const paths = wf.nodes
    .filter((n): n is Extract<typeof n, { kind: "SUBGRAPH_LINK" }> => n.kind === "SUBGRAPH_LINK" && n.spec.fromTypeKey === rootType)
    .map((n) => [{ linkKey: n.spec.linkKey, direction: "out" as const }]);
  return {
    sliceKey: `wf_${wf.id}`.replace(/[^\w-]/g, "_"),
    spec: { root: { typeKey: rootType, selector: {} }, paths, maxNodes: 500 },
  };
}
