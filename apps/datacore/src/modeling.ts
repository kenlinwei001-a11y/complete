import { ModelingSuggestionSchema, type FieldCoverageReport, type FieldProfile, type ModelingSuggestion } from "@platform/contracts";
import type { AuthCtx, DraftOperation, FkCandidate, OntologyDraft, RawDataset } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import type { LlmClient } from "./llm.js";
import { validateOutputAgainstOntology } from "./ontology-validate.js";
import type { Metrics } from "./metrics.js";
import type { OntologyService } from "./ontology.js";
import { newId } from "./ids.js";
import { invalidState, notFound, validationError } from "./errors.js";
import { reconcileIntake, type ExistingTypeField } from "./databuilder/prototype-intake.js";
import { BUSINESS_DOMAIN_KEYS } from "./graphmeta.js";

/** WO-4：归域门——域须取自 14 合法业务域（或 unassigned 暂存）。非成员 → 拒（杜绝 conn_xxx 幽灵域）。 */
function assertValidDomain(domain: string): void {
  if (domain === "unassigned" || BUSINESS_DOMAIN_KEYS.includes(domain)) return;
  throw validationError(`域 '${domain}' 非法：须为 14 合法业务域之一（${BUSINESS_DOMAIN_KEYS.join("/")}）或 unassigned`);
}

const SUGGEST_SYSTEM = `你是本体建模助手。输入为数据集字段画像、跨数据集外键候选与该租户已发布的本体摘要。
原则：已有本体能映射的不新建（MAP_TO_EXISTING 优先，existingTypeKey 必填）；每个建议必须可追溯到具体字段（sourceField）；
为每个对象类型选择主键（isPrimaryKey）；外键字段 dataType=ref 且 refToTypeKey 指向目标类型。`;

/** Cross-dataset FK candidate detection: value-set containment >= 90% (PRD §5.1). */
export function detectFkCandidates(
  datasets: { dataset: RawDataset; rows: Record<string, unknown>[] }[],
): FkCandidate[] {
  const out: FkCandidate[] = [];
  const fieldValues = datasets.map(({ dataset, rows }) => {
    const map = new Map<string, Set<string>>();
    for (const field of dataset.fields) {
      const set = new Set<string>();
      for (const row of rows) {
        const v = row[field.name];
        if (v !== null && v !== undefined && v !== "") set.add(String(v));
      }
      map.set(field.name, set);
    }
    return { name: dataset.name, fields: map, profile: dataset.fields };
  });
  for (const from of fieldValues) {
    for (const to of fieldValues) {
      if (from.name === to.name) continue;
      for (const [fromField, fromSet] of from.fields) {
        if (fromSet.size === 0) continue;
        for (const [toField, toSet] of to.fields) {
          // Target should look like a key (high uniqueness).
          const toProfile = to.profile.find((p) => p.name === toField);
          if (!toProfile || toProfile.uniqueRate < 0.95) continue;
          let contained = 0;
          for (const v of fromSet) if (toSet.has(v)) contained++;
          const containment = contained / fromSet.size;
          if (containment >= 0.9) {
            out.push({ fromDataset: from.name, fromField, toDataset: to.name, toField, containment: Math.round(containment * 1000) / 1000 });
          }
        }
      }
    }
  }
  return out;
}

/** dataset/field 名 → PascalCase typeKey（确定性，无外部产品名）。 */
function toPascal(name: string): string {
  const s = name.replace(/(^|[_\-\s]+)(\w)/g, (_m, _sep, c: string) => c.toUpperCase()).replace(/[^\w一-龥]/g, "");
  return s || name;
}

function inferDataType(p: FieldProfile, isRef: boolean): ModelingSuggestion["objectTypes"][number]["properties"][number]["dataType"] {
  if (isRef) return "ref";
  if (p.enumCandidates && p.enumCandidates.length > 0) return "enum";
  switch (p.inferredType) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "date":
      return "date";
    default:
      return "string";
  }
}

/**
 * 确定性本体映射管线（参考 nano-ontoprompt 的"基于数据的确定性映射"；融进 A3）：
 *  dataset → ObjectType（CREATE）· column → PropertyDef（类型按字段画像推断）·
 *  FK 候选 → ref 属性 + LinkType · 主键 = 唯一率最高(≥0.95)字段。
 * 关键不变量 R12：每个字段都映射成一个属性 → 构造上 100% 字段全建模覆盖（与 LLM 路径互补）。
 */
export function deriveModelingSuggestion(
  datasets: { dataset: RawDataset }[],
  fkCandidates: FkCandidate[],
): ModelingSuggestion {
  const typeKeyByDataset = new Map<string, string>();
  for (const { dataset } of datasets) typeKeyByDataset.set(dataset.name, toPascal(dataset.name));

  const objectTypes: ModelingSuggestion["objectTypes"] = datasets.map(({ dataset }) => {
    const typeKey = typeKeyByDataset.get(dataset.name)!;
    const pkField = [...dataset.fields].sort((a, b) => b.uniqueRate - a.uniqueRate).find((f) => f.uniqueRate >= 0.95)?.name ?? dataset.fields[0]?.name;
    const fksFrom = fkCandidates.filter((fk) => fk.fromDataset === dataset.name);
    const properties = dataset.fields.map((f) => {
      const fk = fksFrom.find((x) => x.fromField === f.name);
      const refType = fk ? typeKeyByDataset.get(fk.toDataset) ?? null : null;
      return {
        propKey: f.name,
        sourceField: f.name,
        dataType: inferDataType(f, !!refType),
        isPrimaryKey: f.name === pkField,
        refToTypeKey: refType,
      };
    });
    return { action: "CREATE" as const, existingTypeKey: null, typeKey, displayName: dataset.name, domain: "unassigned", sourceDataset: dataset.name, properties, derivedProperties: [], confidence: 1 };
  });

  const linkTypes: ModelingSuggestion["linkTypes"] = [];
  for (const fk of fkCandidates) {
    const fromType = typeKeyByDataset.get(fk.fromDataset);
    const toType = typeKeyByDataset.get(fk.toDataset);
    if (!fromType || !toType) continue;
    linkTypes.push({
      fromTypeKey: fromType,
      toTypeKey: toType,
      viaFields: { fromField: fk.fromField, toField: fk.toField },
      cardinality: "1:N",
      nameSuggestion: `${fk.fromDataset}_to_${fk.toDataset}`,
      confidence: fk.containment,
    });
  }
  return { objectTypes, linkTypes };
}

/**
 * 字段全建模覆盖（R12 字段全建模门）：每个数据集字段是否被某个对象属性 sourceField 消费。
 * fullyCovered=false → 该数据源仍有字段未建模（违反"导入的每个字段都需被建模"）。
 */
export function computeFieldCoverage(
  suggestion: ModelingSuggestion,
  datasets: { name: string; fields: { name: string }[] }[],
): FieldCoverageReport {
  const rows = datasets.map((ds) => {
    const mapped = new Set<string>();
    for (const t of suggestion.objectTypes) {
      if (t.sourceDataset !== ds.name) continue;
      for (const p of t.properties) mapped.add(p.sourceField);
    }
    const unmodeled = ds.fields.map((f) => f.name).filter((n) => !mapped.has(n));
    return { name: ds.name, total: ds.fields.length, modeled: ds.fields.length - unmodeled.length, unmodeled };
  });
  const totalFields = rows.reduce((a, d) => a + d.total, 0);
  const modeledFields = rows.reduce((a, d) => a + d.modeled, 0);
  return { datasets: rows, totalFields, modeledFields, coverage: totalFields ? modeledFields / totalFields : 1, fullyCovered: modeledFields === totalFields };
}

/** A3 semi-automatic modeling: suggest → draft → human PATCH → validate → publish → materialize. */
export class ModelingService {
  constructor(
    private repos: Repos,
    private llm: LlmClient,
    private ontology: OntologyService,
    private metrics: Metrics,
    private model: string,
    private quarantine?: import("./quarantine.js").QuarantineService,
  ) {}

  private async loadDatasets(ctx: AuthCtx, rawDatasetIds: string[]): Promise<{ dataset: RawDataset; rows: Record<string, unknown>[] }[]> {
    const datasets: { dataset: RawDataset; rows: Record<string, unknown>[] }[] = [];
    for (const id of rawDatasetIds) {
      const ds = await this.repos.rawDatasets.get(ctx.tenantId, id);
      if (!ds) throw notFound(`raw dataset ${id}`);
      datasets.push({ dataset: ds, rows: await this.repos.rawRows.list(ctx.tenantId, ds.id) });
    }
    return datasets;
  }

  /**
   * 确定性建模（无 LLM）：确定性映射管线直接产出草稿，构造上字段全建模 100% 覆盖。
   * 与 suggest（LLM 语义增强）互补；可作为字段全建模门的"保底基线"。
   */
  async derive(ctx: AuthCtx, rawDatasetIds: string[]): Promise<OntologyDraft> {
    const datasets = await this.loadDatasets(ctx, rawDatasetIds);
    const fkCandidates = detectFkCandidates(datasets);
    const suggestion = deriveModelingSuggestion(datasets, fkCandidates);
    const draft: OntologyDraft = {
      id: newId("draft"),
      tenantId: ctx.tenantId,
      status: "DRAFT",
      rawDatasetIds,
      fkCandidates,
      suggestion,
      operationLog: [],
      createdAt: new Date().toISOString(),
    };
    await this.repos.ontologyDrafts.put(draft);
    return draft;
  }

  /** 字段全建模覆盖报告（R12）：草稿当前映射对导入数据源字段的覆盖率 + 未建模清单。 */
  async coverage(ctx: AuthCtx, draftId: string): Promise<FieldCoverageReport> {
    const draft = await this.getDraft(ctx, draftId);
    const datasets = await Promise.all(
      draft.rawDatasetIds.map(async (id) => {
        const ds = await this.repos.rawDatasets.get(ctx.tenantId, id);
        return ds ? { name: ds.name, fields: ds.fields } : { name: id, fields: [] };
      }),
    );
    return computeFieldCoverage(draft.suggestion, datasets);
  }

  async suggest(ctx: AuthCtx, rawDatasetIds: string[]): Promise<OntologyDraft> {
    const datasets = await this.loadDatasets(ctx, rawDatasetIds);
    const fkCandidates = detectFkCandidates(datasets);
    const existingTypes = await this.ontology.listTypes(ctx);
    const existingSummary = existingTypes.map((t) => ({
      typeKey: t.key,
      displayName: t.displayName,
      properties: t.properties.map((p) => p.propKey),
    }));
    const suggestion = await this.llm.parseStructured({
      model: this.model,
      maxTokens: 8192,
      // LLM Provider 增量 §1.3：A3 建模建议走用途绑定（modeling）
      tenantId: ctx.tenantId,
      purpose: "modeling",
      // WO-4：domain 必须取自 14 合法业务域（防幽灵域）；connId 不入建模输入（属 provenance/sourceBindings，非 domain）。
      system: `${SUGGEST_SYSTEM}\ndomain 字段必须取自以下 14 合法业务域之一（按对象语义选最贴切的；拿不准填 unassigned）：${BUSINESS_DOMAIN_KEYS.join("/")}。`,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            // WO-4：移除 connId —— 连接器 id 属溯源（sourceBindings），不得灌入 domain 推断。
            datasets: datasets.map((d) => ({
              name: d.dataset.name,
              fields: d.dataset.fields,
            })),
            fkCandidates,
            existingOntology: existingSummary,
          }),
        },
      ],
      schema: ModelingSuggestionSchema,
    });
    // WO-4：LLM 偶返 14 域外的 domain（含误把 connId/数据集名当域）→ coerce 到 unassigned（人工再归真域），
    // 杜绝幽灵域进草案；R6 确定性（纯校验，无随机）。
    for (const t of suggestion.objectTypes) {
      if (t.domain && t.domain !== "unassigned" && !BUSINESS_DOMAIN_KEYS.includes(t.domain)) t.domain = "unassigned";
    }
    const draft: OntologyDraft = {
      id: newId("draft"),
      tenantId: ctx.tenantId,
      status: "DRAFT",
      rawDatasetIds,
      fkCandidates,
      suggestion,
      operationLog: [],
      createdAt: new Date().toISOString(),
    };
    await this.repos.ontologyDrafts.put(draft);
    return draft;
  }

  async getDraft(ctx: AuthCtx, id: string): Promise<OntologyDraft> {
    const draft = await this.repos.ontologyDrafts.get(ctx.tenantId, id);
    if (!draft) throw notFound("ontology draft");
    return draft;
  }

  /** PATCH semantics with an operation log (PRD §5.1-3). */
  async patchDraft(ctx: AuthCtx, id: string, operations: DraftOperation[]): Promise<OntologyDraft> {
    const draft = await this.getDraft(ctx, id);
    if (draft.status === "PUBLISHED") throw invalidState("draft already published");
    for (const op of operations) {
      this.applyOperation(draft.suggestion, op);
      draft.operationLog.push({ at: new Date().toISOString(), operation: op });
    }
    draft.status = "REVIEWED";
    await this.repos.ontologyDrafts.put(draft);
    return draft;
  }

  private applyOperation(suggestion: ModelingSuggestion, op: DraftOperation): void {
    const findType = (typeKey: string) => {
      const t = suggestion.objectTypes.find((x) => x.typeKey === typeKey);
      if (!t) throw validationError(`typeKey ${typeKey} not in draft`);
      return t;
    };
    switch (op.op) {
      case "renameType": {
        const t = findType(op.typeKey);
        for (const lt of suggestion.linkTypes) {
          if (lt.fromTypeKey === op.typeKey) lt.fromTypeKey = op.newTypeKey;
          if (lt.toTypeKey === op.typeKey) lt.toTypeKey = op.newTypeKey;
        }
        for (const ot of suggestion.objectTypes) {
          for (const p of ot.properties) {
            if (p.refToTypeKey === op.typeKey) p.refToTypeKey = op.newTypeKey;
          }
        }
        t.typeKey = op.newTypeKey;
        if (op.newDisplayName) t.displayName = op.newDisplayName;
        break;
      }
      case "addProperty": {
        const t = findType(op.typeKey);
        if (t.properties.some((p) => p.propKey === op.property.propKey)) {
          throw validationError(`property ${op.property.propKey} already exists`);
        }
        t.properties.push(op.property);
        break;
      }
      case "removeProperty": {
        const t = findType(op.typeKey);
        t.properties = t.properties.filter((p) => p.propKey !== op.propKey);
        break;
      }
      case "renameProperty": {
        const t = findType(op.typeKey);
        const p = t.properties.find((x) => x.propKey === op.propKey);
        if (!p) throw validationError(`property ${op.propKey} not found`);
        p.propKey = op.newPropKey;
        break;
      }
      case "setRef": {
        const t = findType(op.typeKey);
        const p = t.properties.find((x) => x.propKey === op.propKey);
        if (!p) throw validationError(`property ${op.propKey} not found`);
        p.refToTypeKey = op.refToTypeKey;
        p.dataType = op.refToTypeKey ? "ref" : p.dataType;
        break;
      }
      case "setPrimaryKey": {
        const t = findType(op.typeKey);
        for (const p of t.properties) p.isPrimaryKey = p.propKey === op.propKey;
        break;
      }
      case "setDomain": {
        // 治理增量 §1：人工归域（解除 unassigned 阻断）。WO-4：归域门约束 14 合法业务域（杜绝 conn_xxx 幽灵域）。
        const t = findType(op.typeKey);
        assertValidDomain(op.domain);
        t.domain = op.domain;
        break;
      }
      case "removeObjectType": {
        findType(op.typeKey);
        suggestion.objectTypes = suggestion.objectTypes.filter((t) => t.typeKey !== op.typeKey);
        suggestion.linkTypes = suggestion.linkTypes.filter(
          (l) => l.fromTypeKey !== op.typeKey && l.toTypeKey !== op.typeKey,
        );
        break;
      }
    }
  }

  /**
   * Publish validation: PK required, refs exist, typeKey conflicts (PRD §5.1-4).
   * opts.requireFullCoverage（R12 字段全建模门）：导入数据源每个字段都必须建模，否则阻断发布。
   */
  async publishDraft(ctx: AuthCtx, id: string, opts?: { requireFullCoverage?: boolean }): Promise<{ draft: OntologyDraft; ontologyVersion: number }> {
    const draft = await this.getDraft(ctx, id);
    if (draft.status === "PUBLISHED") throw invalidState("draft already published");
    const suggestion = draft.suggestion;
    const existingTypes = await this.ontology.listTypes(ctx);
    const existingKeys = new Set(existingTypes.map((t) => t.key));
    const draftKeys = new Set(suggestion.objectTypes.map((t) => t.typeKey));

    const errors: string[] = [];
    for (const t of suggestion.objectTypes) {
      if (t.action === "MAP_TO_EXISTING") {
        if (!t.existingTypeKey || !existingKeys.has(t.existingTypeKey)) {
          errors.push(`${t.typeKey}: MAP_TO_EXISTING but existingTypeKey '${t.existingTypeKey}' not published`);
        }
        continue;
      }
      if (!t.properties.some((p) => p.isPrimaryKey)) errors.push(`${t.typeKey}: primary key required`);
      if (existingKeys.has(t.typeKey)) errors.push(`${t.typeKey}: conflicts with published typeKey`);
      // 治理增量 §1：归域强制 —— unassigned 阻断发布（必须人工归域）。
      if (!t.domain || t.domain === "unassigned") {
        errors.push(`${t.typeKey}: 未归域（domain=unassigned），发布前必须人工归域`);
      } else if (!BUSINESS_DOMAIN_KEYS.includes(t.domain)) {
        // WO-4：归域门收紧——域须为 14 合法业务域成员（防 LLM/手工灌入 conn_xxx 幽灵域）。
        errors.push(`${t.typeKey}: 域 '${t.domain}' 非法（须为 14 合法业务域之一：${BUSINESS_DOMAIN_KEYS.join("/")}）`);
      }
      for (const p of t.properties) {
        if (p.refToTypeKey && !draftKeys.has(p.refToTypeKey) && !existingKeys.has(p.refToTypeKey)) {
          errors.push(`${t.typeKey}.${p.propKey}: ref to unknown type '${p.refToTypeKey}'`);
        }
      }
    }
    for (const lt of suggestion.linkTypes) {
      for (const k of [lt.fromTypeKey, lt.toTypeKey]) {
        if (!draftKeys.has(k) && !existingKeys.has(k)) errors.push(`link ${lt.nameSuggestion}: unknown type '${k}'`);
      }
    }

    // R12 字段全建模门（opt-in）：导入数据源每个字段都必须建模，未建模字段阻断发布。
    if (opts?.requireFullCoverage) {
      const datasets = await Promise.all(
        draft.rawDatasetIds.map(async (dsId) => {
          const ds = await this.repos.rawDatasets.get(ctx.tenantId, dsId);
          return ds ? { name: ds.name, fields: ds.fields } : { name: dsId, fields: [] };
        }),
      );
      const cov = computeFieldCoverage(suggestion, datasets);
      const typeKeyByDataset = new Map(suggestion.objectTypes.map((t) => [t.sourceDataset, t.typeKey]));
      for (const d of cov.datasets) {
        for (const f of d.unmodeled) {
          errors.push(`${typeKeyByDataset.get(d.name) ?? d.name}: 字段 '${d.name}.${f}' 未建模（字段全建模门 R12 — 每个导入字段都需被建模）`);
        }
      }
    }

    if (errors.length > 0) throw validationError(`publish validation failed: ${errors.join("; ")}`);

    // Resolve dataset -> connId for sourceBindings.
    const datasetByName = new Map<string, RawDataset>();
    for (const dsId of draft.rawDatasetIds) {
      const ds = await this.repos.rawDatasets.get(ctx.tenantId, dsId);
      if (ds) datasetByName.set(ds.name, ds);
    }

    let accepted = 0;
    const createdTypeKeys: string[] = []; // WO-9：本次新 CREATE 的类型 → 自动建 coverage 切片
    for (const t of suggestion.objectTypes) {
      accepted++;
      const ds = datasetByName.get(t.sourceDataset);
      const fieldMappings: Record<string, string> = {};
      for (const p of t.properties) fieldMappings[p.propKey] = p.sourceField;
      const binding = ds
        ? [{ connId: ds.sourceConnId, dataset: ds.name, fieldMappings }]
        : [];
      if (t.action === "MAP_TO_EXISTING" && t.existingTypeKey) {
        const existing = existingTypes.find((x) => x.key === t.existingTypeKey);
        if (!existing) continue;
        // Merge: add missing properties + append sourceBinding (field-level lineage).
        for (const p of t.properties) {
          if (!existing.properties.some((ep) => ep.propKey === p.propKey)) {
            existing.properties.push({
              propKey: p.propKey,
              dataType: p.dataType,
              isPrimaryKey: false,
              refToTypeKey: p.refToTypeKey,
            });
          }
        }
        await this.ontology.upsertType(ctx, {
          key: existing.key,
          displayName: existing.displayName,
          properties: existing.properties,
          derivedProperties: existing.derivedProperties,
          sourceBindings: [...existing.sourceBindings, ...binding],
        });
      } else {
        await this.ontology.upsertType(ctx, {
          key: t.typeKey,
          displayName: t.displayName,
          domain: t.domain,
          properties: t.properties.map((p) => ({
            propKey: p.propKey,
            dataType: p.dataType,
            isPrimaryKey: p.isPrimaryKey,
            refToTypeKey: p.refToTypeKey,
            // 治理增量 §3：A3 对名称类/主键字段建议 searchable。
            searchable: p.isPrimaryKey || p.propKey === "name" || p.propKey === "displayName" || undefined,
          })),
          // 轨L 增量2：携带草案派生属性（半自动建模人工 PATCH 填入的 R14 KPI 派生图叶子）。
          derivedProperties: (t.derivedProperties ?? []).map((d) => ({ propKey: d.propKey, formula: d.formula })),
          sourceBindings: binding,
        });
        createdTypeKeys.push(t.typeKey);
      }
    }
    // WO-9：A3 发布新类型自动建 coverage 切片（字段覆盖铁律自维护·零写死 R14）——每个新 CREATE 的
    // 类型补一个单实体全字段覆盖切片（coverage_${type}：root=该类型/selector 全/无 hop），缺则建、
    // 有则不覆盖。使「所有字段必被≥1 切片覆盖」对 A3 自助建模的类型自动成立（此前仅出厂电池类型有，
    // 用户上传 → A3 建新类型 → 无 coverage 切片 → 字段覆盖检查露空、新类型不可全字段浏览/导出）。
    {
      const existingSliceKeys = new Set((await this.repos.sliceSpecs.list(ctx.tenantId)).map((s) => s.sliceKey));
      for (const tk of createdTypeKeys) {
        const sliceKey = `coverage_${tk.toLowerCase()}`;
        if (existingSliceKeys.has(sliceKey)) continue;
        await this.repos.sliceSpecs.put({
          id: `slice_${sliceKey}`.replace(/[^\p{L}\p{N}_-]/gu, "_"),
          tenantId: ctx.tenantId,
          sliceKey,
          version: 1,
          spec: { root: { typeKey: tk, selector: {} }, paths: [], maxNodes: 2000 },
        });
      }
    }
    for (const lt of suggestion.linkTypes) {
      await this.ontology.upsertLinkType(ctx, {
        key: lt.nameSuggestion.replace(/\s+/g, "_"),
        fromTypeKey: lt.fromTypeKey,
        toTypeKey: lt.toTypeKey,
        cardinality: lt.cardinality,
      });
    }
    const version = await this.ontology.publishVersion(ctx);
    draft.status = "PUBLISHED";
    draft.publishedVersion = version.version;
    await this.repos.ontologyDrafts.put(draft);
    this.metrics.set("dc_modeling_suggestion_accept_ratio", {}, accepted / Math.max(1, suggestion.objectTypes.length));
    return { draft, ontologyVersion: version.version };
  }

  /** Materialize: RawDataset rows → object instances, then run derivations. */
  async materialize(ctx: AuthCtx, draftId: string): Promise<{ jobId: string; created: number; quarantined: number }> {
    const draft = await this.getDraft(ctx, draftId);
    if (draft.status !== "PUBLISHED") throw invalidState("draft must be published before materialize");
    const jobId = newId("job");
    const startedAt = new Date().toISOString();
    const rowCounts: Record<string, number> = {};
    let created = 0;
    let quarantined = 0;
    for (const t of draft.suggestion.objectTypes) {
      const targetKey = t.action === "MAP_TO_EXISTING" && t.existingTypeKey ? t.existingTypeKey : t.typeKey;
      const ds = (
        await this.repos.rawDatasets.list(ctx.tenantId, (d) => d.name === t.sourceDataset)
      )[0];
      if (!ds) continue;
      const rows = await this.repos.rawRows.list(ctx.tenantId, ds.id);
      // Idempotent per dataset: clear previous materialization of this dataset+type.
      await this.repos.objects.removeWhere(
        ctx.tenantId,
        (o) => o.type === targetKey && o.origin.type === "MATERIALIZED" && o.origin.datasetId === ds.id,
      );
      const pk = t.properties.find((p) => p.isPrimaryKey)?.propKey;
      const mapping = t.properties.map((p) => ({ propKey: p.propKey, sourceField: p.sourceField }));
      // stage3①：来源连接器若配了本体校验策略,导入时按策略校验值域/类型/枚举（适配不同源；按租户）。
      const conn = await this.repos.connections.get(ctx.tenantId, ds.sourceConnId);
      const policy = conn?.validationPolicy;
      const typeDef = policy ? (await this.ontology.listTypes(ctx)).find((x) => x.key === targetKey) : undefined;
      const seenPk = new Set<string>();
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] as Record<string, unknown>;
        const props: Record<string, unknown> = {};
        for (const p of t.properties) props[p.propKey] = row[p.sourceField];
        // 运营完备性 §4：行级校验失败 → 隔离区（不使批次失败）。
        if (this.quarantine) {
          const pkVal = pk ? props[pk] : undefined;
          if (pk && (pkVal == null || pkVal === "")) {
            await this.quarantine.record(ctx.tenantId, { connId: ds.id, dataset: ds.name, raw: row, reason: "SCHEMA_MISMATCH", detail: `主键 '${pk}' 缺失`, reprocess: { targetKey, mapping, pk } });
            quarantined++;
            continue;
          }
          if (pk && pkVal != null && seenPk.has(String(pkVal))) {
            await this.quarantine.record(ctx.tenantId, { connId: ds.id, dataset: ds.name, raw: row, reason: "DUP_KEY", detail: `主键 '${pk}'='${String(pkVal)}' 重复`, reprocess: { targetKey, mapping, pk } });
            quarantined++;
            continue;
          }
          if (pk && pkVal != null) seenPk.add(String(pkVal));
        }
        // stage3①：本体类/值域强制校验（连接器 policy）→ 值域/类型/枚举/野字段不符 → 隔离区。
        if (this.quarantine && policy && typeDef) {
          const vr = validateOutputAgainstOntology([props], typeDef, policy);
          if (vr.rejectedRows > 0 || vr.quarantinedRows > 0) {
            const v0 = vr.violations[0];
            const reason = v0?.kind === "TYPE" ? "TYPE_ERROR" : "SCHEMA_MISMATCH";
            await this.quarantine.record(ctx.tenantId, { connId: ds.id, dataset: ds.name, raw: row, reason, detail: vr.violations.map((x) => `${x.field}:${x.detail}`).join("; "), reprocess: { targetKey, mapping, pk } });
            quarantined++;
            continue;
          }
        }
        const idSuffix = pk && props[pk] != null ? String(props[pk]) : String(i);
        await this.repos.objects.put({
          // 轨L 增量1：对象身份统一 = obj_${type}_${pk}（业务主键，非来源行）——去 ds.id 段，与 synthetic A 路一致。
          // 同 type+pk 重物化 → 同 id 覆盖（幂等·正确合并：同业务键即同对象）。provenance 仍在 origin.datasetId。
          id: `obj_${targetKey.toLowerCase()}_${idSuffix}`.replace(/[^\p{L}\p{N}_-]/gu, "_"),
          tenantId: ctx.tenantId,
          type: targetKey,
          props,
          origin: { type: "MATERIALIZED", datasetId: ds.id, jobId },
        });
        created++;
        rowCounts[targetKey] = (rowCounts[targetKey] ?? 0) + 1;
      }
    }
    await this.ontology.runDerivations(ctx);
    // 前端 PRD §7.6：对象化进度沿用同步作业轮询端点（GET /a/v1/sync-jobs/:id）——
    // 落一条终态 SyncJob 记录，否则页面轮询 404 永不终止。
    await this.repos.syncJobs.put({
      id: jobId,
      tenantId: ctx.tenantId,
      connId: draft.id,
      status: "SUCCEEDED",
      startedAt,
      finishedAt: new Date().toISOString(),
      rowCounts,
    });
    return { jobId, created, quarantined };
  }

  /**
   * prototype-intake P3 闭环末步：把已落库的 RawDataset（如原型导入表）按**确定性 schema 对账**
   * 物化进既有对象库——不新建/不发布类型（"对账后的列" → 既有 type.field），让导入数据成为可查询
   * ObjectInstance（/admin/object-types 计数可见），喂派生/求解器。映射不上的列/无映射的表诚实跳过并报告。
   * 幂等：按 (datasetId, targetType, origin=MATERIALIZED) 清旧再写（R6 同输入同结果）。
   */
  async materializeFromReconcile(
    ctx: AuthCtx,
    rawDatasetIds: string[],
  ): Promise<{ jobId: string; materialized: { dataset: string; type: string; count: number }[]; skipped: { dataset: string; reason: string }[] }> {
    const jobId = newId("job");
    const startedAt = new Date().toISOString();
    const types = await this.ontology.listTypes(ctx);
    const existing: ExistingTypeField[] = types.flatMap((t) => t.properties.map((p) => ({ typeKey: t.key, propKey: p.propKey })));
    const pkByType = new Map(types.map((t) => [t.key, t.properties.find((p) => p.isPrimaryKey)?.propKey]));
    const materialized: { dataset: string; type: string; count: number }[] = [];
    const skipped: { dataset: string; reason: string }[] = [];
    const rowCounts: Record<string, number> = {};

    for (const dsId of rawDatasetIds) {
      const ds = await this.repos.rawDatasets.get(ctx.tenantId, dsId);
      if (!ds) { skipped.push({ dataset: dsId, reason: "原始表不存在" }); continue; }
      const rows = await this.repos.rawRows.list(ctx.tenantId, ds.id);
      // 确定性对账：列 → 既有 type.field（仅 autoMapped 精确命中入物化，候选/未命中交人，诚实不猜）。
      const recon = reconcileIntake([{ name: ds.name, columns: ds.fields.map((f) => f.name), rowCount: ds.rowCount, sampleRows: [] }], existing);
      if (recon.autoMapped.length === 0) { skipped.push({ dataset: ds.name, reason: "无可确定映射的列（全部待人确认/未命中）" }); continue; }
      // 按目标类型分组该表的 autoMapped 列。
      const byType = new Map<string, { column: string; targetField: string }[]>();
      for (const a of recon.autoMapped) {
        if (!byType.has(a.targetType)) byType.set(a.targetType, []);
        byType.get(a.targetType)!.push({ column: a.column, targetField: a.targetField });
      }
      for (const [targetKey, cols] of byType) {
        // 幂等：清掉本表+本类型上一次物化。
        await this.repos.objects.removeWhere(
          ctx.tenantId,
          (o) => o.type === targetKey && o.origin.type === "MATERIALIZED" && o.origin.datasetId === ds.id,
        );
        const pkField = pkByType.get(targetKey);
        const pkCol = pkField ? cols.find((c) => c.targetField === pkField)?.column : undefined;
        let count = 0;
        const seenPk = new Set<string>();
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i] as Record<string, unknown>;
          const props: Record<string, unknown> = {};
          for (const c of cols) props[c.targetField] = row[c.column];
          const pkVal = pkCol ? row[pkCol] : undefined;
          // 有 PK 映射则去重去空（同既有物化纪律）；无 PK 用行序兜底（仍幂等于本表）。
          if (pkCol) {
            if (pkVal == null || pkVal === "" || seenPk.has(String(pkVal))) continue;
            seenPk.add(String(pkVal));
          }
          const idSuffix = pkVal != null && pkVal !== "" ? String(pkVal) : String(i);
          await this.repos.objects.put({
            // 轨L 增量1：对象身份统一 = obj_${type}_${pk}（去 ds.id 段，与 A 路/另一物化点一致，单一身份约定）。
            id: `obj_${targetKey.toLowerCase()}_${idSuffix}`.replace(/[^\p{L}\p{N}_-]/gu, "_"),
            tenantId: ctx.tenantId,
            type: targetKey,
            props,
            origin: { type: "MATERIALIZED", datasetId: ds.id, jobId },
          });
          count++;
        }
        if (count > 0) {
          materialized.push({ dataset: ds.name, type: targetKey, count });
          rowCounts[targetKey] = (rowCounts[targetKey] ?? 0) + count;
        }
      }
    }
    await this.ontology.runDerivations(ctx);
    await this.repos.syncJobs.put({
      id: jobId,
      tenantId: ctx.tenantId,
      connId: rawDatasetIds[0] ?? jobId,
      status: "SUCCEEDED",
      startedAt,
      finishedAt: new Date().toISOString(),
      rowCounts,
    });
    return { jobId, materialized, skipped };
  }
}
