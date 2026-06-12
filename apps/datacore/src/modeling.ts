import { ModelingSuggestionSchema, type ModelingSuggestion } from "@platform/contracts";
import type { AuthCtx, DraftOperation, FkCandidate, OntologyDraft, RawDataset } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import type { LlmClient } from "./llm.js";
import type { Metrics } from "./metrics.js";
import type { OntologyService } from "./ontology.js";
import { newId } from "./ids.js";
import { invalidState, notFound, validationError } from "./errors.js";

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

/** A3 semi-automatic modeling: suggest → draft → human PATCH → validate → publish → materialize. */
export class ModelingService {
  constructor(
    private repos: Repos,
    private llm: LlmClient,
    private ontology: OntologyService,
    private metrics: Metrics,
    private model: string,
  ) {}

  async suggest(ctx: AuthCtx, rawDatasetIds: string[]): Promise<OntologyDraft> {
    const datasets: { dataset: RawDataset; rows: Record<string, unknown>[] }[] = [];
    for (const id of rawDatasetIds) {
      const ds = await this.repos.rawDatasets.get(ctx.tenantId, id);
      if (!ds) throw notFound(`raw dataset ${id}`);
      datasets.push({ dataset: ds, rows: await this.repos.rawRows.list(ctx.tenantId, ds.id) });
    }
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
      system: SUGGEST_SYSTEM,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            datasets: datasets.map((d) => ({
              name: d.dataset.name,
              connId: d.dataset.sourceConnId,
              fields: d.dataset.fields,
            })),
            fkCandidates,
            existingOntology: existingSummary,
          }),
        },
      ],
      schema: ModelingSuggestionSchema,
    });
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

  /** Publish validation: PK required, refs exist, typeKey conflicts (PRD §5.1-4). */
  async publishDraft(ctx: AuthCtx, id: string): Promise<{ draft: OntologyDraft; ontologyVersion: number }> {
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
    if (errors.length > 0) throw validationError(`publish validation failed: ${errors.join("; ")}`);

    // Resolve dataset -> connId for sourceBindings.
    const datasetByName = new Map<string, RawDataset>();
    for (const dsId of draft.rawDatasetIds) {
      const ds = await this.repos.rawDatasets.get(ctx.tenantId, dsId);
      if (ds) datasetByName.set(ds.name, ds);
    }

    let accepted = 0;
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
          properties: t.properties.map((p) => ({
            propKey: p.propKey,
            dataType: p.dataType,
            isPrimaryKey: p.isPrimaryKey,
            refToTypeKey: p.refToTypeKey,
          })),
          derivedProperties: [],
          sourceBindings: binding,
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
  async materialize(ctx: AuthCtx, draftId: string): Promise<{ jobId: string; created: number }> {
    const draft = await this.getDraft(ctx, draftId);
    if (draft.status !== "PUBLISHED") throw invalidState("draft must be published before materialize");
    const jobId = newId("job");
    const startedAt = new Date().toISOString();
    const rowCounts: Record<string, number> = {};
    let created = 0;
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
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] as Record<string, unknown>;
        const props: Record<string, unknown> = {};
        for (const p of t.properties) props[p.propKey] = row[p.sourceField];
        const idSuffix = pk && props[pk] != null ? String(props[pk]) : String(i);
        await this.repos.objects.put({
          id: `obj_${targetKey.toLowerCase()}_${ds.id}_${idSuffix}`.replace(/[^\w-]/g, "_"),
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
    return { jobId, created };
  }
}
