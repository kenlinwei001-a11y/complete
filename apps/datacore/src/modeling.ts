import { ModelingSuggestionSchema, classifySourceOrigin, type FieldCoverageReport, type FieldProfile, type ModelingSuggestion, type SchemaReconcileCandidate } from "@platform/contracts";
import type { AuthCtx, DraftOperation, FkCandidate, ImportedScenarioRecord, OntologyDraft, PropertyDef, RawDataset } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import type { LlmClient } from "./llm.js";
import { validateOutputAgainstOntology } from "./ontology-validate.js";
import type { Metrics } from "./metrics.js";
import type { OntologyService } from "./ontology.js";
import { newId } from "./ids.js";
import { AppError, invalidState, notFound, validationError } from "./errors.js";
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

/**
 * INTAKE-MATERIALIZE-KEY：主键未精确映射到数据源列而被跳过物化的对象类型（结构化诚实标记，
 * 前端/运维可据此定位需人工补映射的类型；对应行已入隔离区候选队列，见 quarantine.ts）。
 */
export interface MaterializeSkipped {
  typeKey: string;
  targetKey: string;
  dataset: string;
  reason: string;
}

/**
 * WO-IMPORT-MULTITABLE (G1)：把 publishDraft 的 `code:VALIDATION_ERROR` 拼接串还原成结构化 {typeKey,message}[]。
 * 与 app.ts publish 端点的内联展示同源（诚实边界：发布校验失败逐条可读·不静默物化空壳）。
 */
function parsePublishErrors(message: string): { typeKey: string; message: string }[] {
  const msgs = message.replace(/^publish validation failed: /, "").split("; ");
  return msgs.map((m) => {
    const i = m.indexOf(":");
    return i > 0 ? { typeKey: m.slice(0, i).trim(), message: m.slice(i + 1).trim() } : { typeKey: "", message: m };
  });
}

/** WO-IMPORT-MULTITABLE (G1) · derive-batch 服务结果（草稿 + 可选发布/物化/校验错误）。 */
export interface DeriveBatchResult {
  draft: OntologyDraft;
  published?: { ontologyVersion: number };
  materialize?: { jobId: string; created: number; quarantined: number; skipped: MaterializeSkipped[] };
  publishErrors?: { typeKey: string; message: string }[];
}

/** WO-IMPORT-ONTOLOGY (G2) · 客户本体直导入参（= Stage 3.15 objects.json/relations.json 形态）。 */
export interface OntologyImportBundleInput {
  objects: { name: string; displayName?: string; domain?: string; properties?: { name: string; dataType?: "string" | "number" | "boolean" | "date" | "enum" | "ref" | "json"; isPrimaryKey?: boolean; refTo?: string }[] }[];
  relations: { name: string; from: string; to: string; cardinality?: "1:1" | "1:N" | "N:N" }[];
  bindDatasets?: boolean;
  strict?: boolean;
  publish?: boolean;
}

/** WO-IMPORT-SCENARIO (G3) · 场景导入入参（= Stage 3.15 场景 JSON 映射前）。 */
interface ScenarioImportAnswerInput {
  kind: "objects-aggregate" | "objects" | "solver";
  objectType?: string;
  agg?: "sum" | "avg" | "count" | "min" | "max";
  prop?: string;
  columns?: string[];
  limit?: number;
  solverKey?: string;
  args?: Record<string, unknown>;
  unit?: string;
}
export interface ScenarioImportInput {
  scenarios: {
    key?: string;
    title?: string;
    type?: string;
    question?: string;
    targetView?: string;
    objectRefs?: { objectType: string; objectId: string; label?: string }[];
    slotPresets?: Record<string, unknown>;
    answer?: ScenarioImportAnswerInput;
  }[];
}

/** WO-IMPORT-SCENARIO (G3) · 场景导入结果（含诚实缺口）。 */
export interface ScenarioImportResultOut {
  imported: { key: string; title: string; question: string; targetView: string; resolvedObjects: { objectType: string; objectId: string; label: string }[]; answerKind: "objects-aggregate" | "objects" | "solver"; answerDeclared: boolean }[];
  gaps: { kind: "MISSING_OBJECT" | "MISSING_ANSWER"; scenarioKey: string; detail: string }[];
}

/** WO-IMPORT-ONTOLOGY (G2) · 本体直导结果（含诚实覆盖缺口）。 */
export interface OntologyImportResult {
  createdTypes: string[];
  createdLinks: string[];
  bound: { typeKey: string; dataset: string; mappedFields: string[]; unmappedProps: string[]; undeclaredFields: string[] }[];
  gaps: { kind: "MISSING_TABLE" | "MISSING_FIELD" | "UNKNOWN_REF" | "DANGLING_RELATION"; object: string | null; relation: string | null; detail: string }[];
  ontologyVersion: number | null;
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

  /**
   * WO-IMPORT-MULTITABLE (G1)：多表 FK 批量导入一步到位——**complete 复用**既有确定性链，不新增行业逻辑（R14）：
   *   1) derive：跨**全部** rawDatasetIds 一次 detectFkCandidates + deriveModelingSuggestion（无 LLM·R6·同数据同结果）→
   *      一张 draft 含全类型 + 全跨表链路（如 production_line.factory_id→factory ⇒ ProductionLine→Factory）。
   *   2) 归域（可选）：按 typeKey 或 sourceDataset 名匹配调用方给的 domains 映射；非 14 合法业务域即拒（归域门）。
   *      ⛔ 平台不猜行业域——域由导入方显式提供，平台代码零业务常数。
   *   3) autoPublish（可选）：发布本体版本；校验失败 → 结构化 publishErrors 诚实返回（不静默物化空壳）。
   *   4) autoMaterialize（可选·仅发布成功后）：物化对象，每对象挂真 rawDatasetId（origin.datasetId·R-NO-ORPHAN-SOURCE）。
   * 全程确定性、不经 comprehend/LLM。
   */
  async deriveBatch(
    ctx: AuthCtx,
    opts: {
      rawDatasetIds: string[];
      domains?: Record<string, string>;
      autoPublish?: boolean;
      autoMaterialize?: boolean;
      requireFullCoverage?: boolean;
    },
  ): Promise<DeriveBatchResult> {
    const draft = await this.derive(ctx, opts.rawDatasetIds);
    // 归域（确定性·纯校验无随机）：typeKey 优先，回落 sourceDataset 名；非法域即拒（14 域门·防幽灵域）。
    if (opts.domains && Object.keys(opts.domains).length > 0) {
      for (const t of draft.suggestion.objectTypes) {
        const d = opts.domains[t.typeKey] ?? opts.domains[t.sourceDataset];
        if (d !== undefined) {
          assertValidDomain(d);
          t.domain = d;
        }
      }
      draft.status = "REVIEWED";
      await this.repos.ontologyDrafts.put(draft);
    }
    if (!opts.autoPublish) return { draft };

    let published: { ontologyVersion: number } | undefined;
    try {
      const r = await this.publishDraft(ctx, draft.id, { requireFullCoverage: opts.requireFullCoverage });
      published = { ontologyVersion: r.ontologyVersion };
    } catch (err) {
      // 诚实边界：发布校验失败（未归域/缺主键/字段未全建模）→ 结构化返回·不物化空壳（KILL-MOCK-RED）。
      if (err instanceof AppError && err.code === "VALIDATION_ERROR") {
        return { draft: await this.getDraft(ctx, draft.id), publishErrors: parsePublishErrors(err.message) };
      }
      throw err;
    }

    const materialize = opts.autoMaterialize ? await this.materialize(ctx, draft.id) : undefined;
    return { draft: await this.getDraft(ctx, draft.id), published, materialize };
  }

  /**
   * WO-IMPORT-ONTOLOGY (G2)：客户本体直导（= Stage 3.15 objects.json/relations.json）——复用 `upsertType`/`upsertLinkType`
   * 把一份自带本体一次搬进平台（此前只能逐类/逐链手拼）。⛔ R14：只搬结构、按名绑已上传数据（可选），零行业常数。
   * **诚实边界（不静默建空/断链·KILL-MOCK-RED）**：
   *   · 关系端点/ref 目标解析不到（bundle 对象 ∪ 已发布类型）→ 报 `DANGLING_RELATION`/`UNKNOWN_REF`，**该链不建**（不造断链）。
   *   · bindDatasets 时对象无匹配表 → `MISSING_TABLE`；属性在表里无对应列 → `MISSING_FIELD`（字段缺·可见覆盖）。
   *   · strict：有任一缺口 → **不建不发布**，结构化返回缺口（同 derive-batch publishErrors 精神）。
   * 全程确定性、不经 LLM。
   */
  async importOntologyBundle(ctx: AuthCtx, bundle: OntologyImportBundleInput): Promise<OntologyImportResult> {
    const gaps: OntologyImportResult["gaps"] = [];
    // 名→typeKey（PascalCase 确定性）。关系/ref 端点可解析到 bundle 对象或已发布类型。
    const nameToKey = new Map<string, string>();
    for (const o of bundle.objects) nameToKey.set(o.name, toPascal(o.name));
    const publishedKeys = new Set((await this.ontology.listTypes(ctx)).map((t) => t.key));
    const resolveKey = (name: string): string | undefined => {
      if (nameToKey.has(name)) return nameToKey.get(name);
      const k = toPascal(name);
      if (publishedKeys.has(k)) return k;
      if (publishedKeys.has(name)) return name;
      return undefined;
    };
    // 归域校验（提供了 domain 必须是 14 合法业务域·防幽灵域 R14）。
    for (const o of bundle.objects) {
      if (o.domain !== undefined && o.domain !== "unassigned" && !BUSINESS_DOMAIN_KEYS.includes(o.domain)) {
        throw validationError(`对象 '${o.name}' 域 '${o.domain}' 非法（须为 14 合法业务域之一：${BUSINESS_DOMAIN_KEYS.join("/")}）`);
      }
    }
    // 按名匹配已上传 RawDataset（供 bindDatasets 建 sourceBindings + 覆盖缺口探测）。
    const datasetByName = new Map<string, RawDataset>();
    for (const o of bundle.objects) {
      const ds = (await this.repos.rawDatasets.list(ctx.tenantId, (d) => d.name === o.name))[0];
      if (ds) datasetByName.set(o.name, ds);
    }

    const bound: OntologyImportResult["bound"] = [];
    const typeInputs = bundle.objects.map((o) => {
      const typeKey = nameToKey.get(o.name)!;
      const props = (o.properties ?? []).map((p) => {
        const refKey = p.refTo ? resolveKey(p.refTo) : undefined;
        if (p.refTo && !refKey) gaps.push({ kind: "UNKNOWN_REF", object: o.name, relation: null, detail: `属性 '${p.name}' 引用未知类型 '${p.refTo}'（未建 ref）` });
        return {
          propKey: p.name,
          dataType: (p.refTo ? "ref" : (p.dataType ?? "string")) as PropertyDef["dataType"],
          isPrimaryKey: p.isPrimaryKey ?? false,
          refToTypeKey: refKey ?? null,
        };
      });
      let sourceBindings: { connId: string; dataset: string; fieldMappings: Record<string, string> }[] = [];
      if (bundle.bindDatasets) {
        const ds = datasetByName.get(o.name);
        if (!ds) {
          gaps.push({ kind: "MISSING_TABLE", object: o.name, relation: null, detail: `本体类型 '${o.name}' 无匹配已上传数据表（表缺·未绑数据）` });
        } else {
          const dsFields = new Set(ds.fields.map((f) => f.name));
          const fieldMappings: Record<string, string> = {};
          const unmappedProps: string[] = [];
          for (const p of o.properties ?? []) {
            if (dsFields.has(p.name)) fieldMappings[p.name] = p.name;
            else unmappedProps.push(p.name);
          }
          for (const f of unmappedProps) gaps.push({ kind: "MISSING_FIELD", object: o.name, relation: null, detail: `属性 '${f}' 在数据表 '${ds.name}' 无对应列（字段缺）` });
          const undeclaredFields = ds.fields.map((f) => f.name).filter((fn) => !(o.properties ?? []).some((p) => p.name === fn));
          if (Object.keys(fieldMappings).length > 0) sourceBindings = [{ connId: ds.sourceConnId, dataset: ds.name, fieldMappings }];
          bound.push({ typeKey, dataset: ds.name, mappedFields: Object.keys(fieldMappings), unmappedProps, undeclaredFields });
        }
      }
      return { key: typeKey, displayName: o.displayName ?? o.name, domain: o.domain, properties: props, derivedProperties: [], sourceBindings };
    });

    // 关系：端点解析不到 → DANGLING（不建断链）。link key = `${rel}_${from}_${to}`（同名关系多端点不冲突）。
    const linkInputs: { key: string; fromTypeKey: string; toTypeKey: string; cardinality: "1:1" | "1:N" | "N:N" }[] = [];
    for (const r of bundle.relations) {
      const fromKey = resolveKey(r.from);
      const toKey = resolveKey(r.to);
      if (!fromKey || !toKey) {
        gaps.push({ kind: "DANGLING_RELATION", object: null, relation: r.name, detail: `关系 '${r.name}' 端点未解析（from='${r.from}'${fromKey ? "" : "✗"} to='${r.to}'${toKey ? "" : "✗"}）→ 未建断链` });
        continue;
      }
      linkInputs.push({ key: `${r.name}_${fromKey}_${toKey}`.replace(/[^\p{L}\p{N}_-]/gu, "_"), fromTypeKey: fromKey, toTypeKey: toKey, cardinality: r.cardinality ?? "1:N" });
    }

    // strict：有缺口即不落库（诚实拒绝·不静默建）。
    if (bundle.strict && gaps.length > 0) {
      return { createdTypes: [], createdLinks: [], bound, gaps, ontologyVersion: null };
    }

    const createdTypes: string[] = [];
    for (const t of typeInputs) {
      await this.ontology.upsertType(ctx, t);
      createdTypes.push(t.key);
    }
    const createdLinks: string[] = [];
    for (const l of linkInputs) {
      await this.ontology.upsertLinkType(ctx, l);
      createdLinks.push(l.key);
    }
    const ontologyVersion = bundle.publish === false ? null : (await this.ontology.publishVersion(ctx)).version;
    return { createdTypes, createdLinks, bound, gaps, ontologyVersion };
  }

  /**
   * WO-IMPORT-SCENARIO (G3)：Stage 3.15 场景 JSON → 平台场景卡（IndustryScenario）落库（PRD §3.3）。
   * 经 `GET /a/v1/scenarios/pack` 合入本租户场景包 → AgentCore 启动器目录消费（既有 datacore→agentcore seam·零 agentcore 改）。
   * ⛔ R14：平台**不含** Stage 3.15 业务语义——场景的 `answer` 声明式 query 由调用方给；缺省退化为对 objectRefs 的
   * objects 直列（真数据·确定性），既不写死 type→求解器、也不静默造答案。
   * **诚实边界（KILL-MOCK-RED）**：objectRefs 对**已物化对象库**解析，对不上 → `MISSING_OBJECT`（不放入 selectedObjects·不造幽灵引用）；
   * 既无 answer 又无 objectRefs → `MISSING_ANSWER`（无法确定推演内容·该场景**不落库**·诚实缺）。
   */
  async importScenarios(ctx: AuthCtx, req: ScenarioImportInput): Promise<ScenarioImportResultOut> {
    const imported: ScenarioImportResultOut["imported"] = [];
    const gaps: ScenarioImportResultOut["gaps"] = [];
    const sanitize = (s: string) => s.replace(/[^\p{L}\p{N}_-]/gu, "_");
    for (const s of req.scenarios) {
      const key = sanitize((s.key ?? s.title ?? s.type ?? "scenario").toLowerCase());
      const title = s.title ?? s.type ?? key;
      const question = s.question ?? `关于「${title}」的决策场景`;
      const targetView = s.targetView ?? "sim-sandbox";
      // presetContext.selectedObjects：对真对象库解析（id = obj_${type}_${pk}·与物化身份约定同源）。
      const resolvedObjects: { objectType: string; objectId: string; label: string }[] = [];
      for (const r of s.objectRefs ?? []) {
        const objId = sanitize(`obj_${r.objectType.toLowerCase()}_${r.objectId}`);
        const obj = await this.repos.objects.get(ctx.tenantId, objId);
        if (obj) resolvedObjects.push({ objectType: r.objectType, objectId: r.objectId, label: r.label ?? r.objectId });
        else gaps.push({ kind: "MISSING_OBJECT", scenarioKey: key, detail: `对象 ${r.objectType}/${r.objectId}（id=${objId}）不在对象库 → 未放入 selectedObjects（诚实·不造幽灵引用）` });
      }
      // answer：调用方声明优先；缺省退化为 objects 直列首个 objectRef 的类型（真数据·R14 平台不猜业务语义）。
      let answer: ScenarioImportAnswerInput;
      let answerDeclared: boolean;
      if (s.answer) {
        answer = s.answer;
        answerDeclared = true;
      } else {
        const objType = s.objectRefs?.[0]?.objectType;
        if (!objType) {
          gaps.push({ kind: "MISSING_ANSWER", scenarioKey: key, detail: `场景「${title}」未声明 answer query 且无 objectRefs → 无法确定推演内容（诚实缺·该场景未落库）` });
          continue;
        }
        answer = { kind: "objects", objectType: objType, limit: 50 };
        answerDeclared = false;
      }
      const rec: ImportedScenarioRecord = {
        id: `${ctx.tenantId}:${key}`,
        tenantId: ctx.tenantId,
        scenarioKey: key,
        scenario: { key, title, question, answer: answer as unknown as Record<string, unknown> },
        targetView,
        resolvedObjects,
        slotPresets: s.slotPresets ?? {},
        answerDeclared,
      };
      await this.repos.importedScenarios.put(rec);
      imported.push({ key, title, question, targetView, resolvedObjects, answerKind: answer.kind, answerDeclared });
    }
    return { imported, gaps };
  }

  /**
   * WO-IMPORT-REPLACE-SYNTHETIC (G4·复验返工·KILL-MOCK-RED 命门)：按 **provenance** 数世界态对象——
   * 区分「真导入」(origin=MATERIALIZED 且其 rawDataset 源连接 `classifySourceOrigin=real-sourced`·即真上传/真连接器)
   * 与「合成物化」(源连接为 mock/synthetic·如 SEED_DEMO 的 mock_erp+config.synthetic=true)。
   * imported 世界态**只有真导入对象才是可读真值**；合成物化不得在 imported 下自报 LIVE 决策红（防合成冒充真值）。
   */
  async countWorldObjectsByProvenance(ctx: AuthCtx): Promise<{ realImported: number; syntheticMaterialized: number }> {
    const realDatasetIds = new Set<string>();
    for (const ds of await this.repos.rawDatasets.list(ctx.tenantId)) {
      const conn = ds.sourceConnId ? await this.repos.connections.get(ctx.tenantId, ds.sourceConnId) : undefined;
      if (classifySourceOrigin(conn?.connectorTypeKey, conn?.config) === "real-sourced") realDatasetIds.add(ds.id);
    }
    let realImported = 0;
    let syntheticMaterialized = 0;
    for (const t of await this.ontology.listTypes(ctx)) {
      for (const o of await this.repos.objects.listByType(ctx.tenantId, t.key)) {
        if (o.origin?.type !== "MATERIALIZED") continue;
        if (realDatasetIds.has(o.origin.datasetId)) realImported++;
        else syntheticMaterialized++;
      }
    }
    return { realImported, syntheticMaterialized };
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
  async materialize(
    ctx: AuthCtx,
    draftId: string,
  ): Promise<{ jobId: string; created: number; quarantined: number; skipped: MaterializeSkipped[] }> {
    const draft = await this.getDraft(ctx, draftId);
    if (draft.status !== "PUBLISHED") throw invalidState("draft must be published before materialize");
    const jobId = newId("job");
    const startedAt = new Date().toISOString();
    const rowCounts: Record<string, number> = {};
    let created = 0;
    let quarantined = 0;
    const skipped: MaterializeSkipped[] = [];
    // INTAKE-MATERIALIZE-KEY（治本）：物化前校验对象类型的「真实主键」是否已精确映射到数据源列。
    // 真实主键取自已发布本体类型（ontology.listTypes），不取草稿本地 t.properties——后者对
    // MAP_TO_EXISTING（合并入既有类型）场景常常不重复声明 isPrimaryKey（PK 已在既有类型上定义），
    // 若此时仍按"draft-local pk 未找到→不做行级校验"物化，会产出 props 缺主键的畸形对象
    // （如缺 baseId 的 Base，id 退化为行号 obj_base_0/1），下游遍历命中空 key → 400 unknown ...。
    const publishedTypes = await this.ontology.listTypes(ctx);
    for (const t of draft.suggestion.objectTypes) {
      const targetKey = t.action === "MAP_TO_EXISTING" && t.existingTypeKey ? t.existingTypeKey : t.typeKey;
      const ds = (
        await this.repos.rawDatasets.list(ctx.tenantId, (d) => d.name === t.sourceDataset)
      )[0];
      if (!ds) continue;

      const publishedType = publishedTypes.find((x) => x.key === targetKey);
      const realPk = publishedType?.properties.find((p) => p.isPrimaryKey)?.propKey;
      const pkMapping = realPk ? t.properties.find((p) => p.propKey === realPk) : undefined;
      const datasetFieldNames = new Set(ds.fields.map((f) => f.name));
      const keyResolved = !!realPk && !!pkMapping?.sourceField && datasetFieldNames.has(pkMapping.sourceField);

      if (!keyResolved) {
        // 未解析：诚实报「缺 key，不产畸形对象」——跳过物化该类型，行入隔离区候选队列（可编辑映射后重投）。
        const reason = !realPk
          ? `目标类型 '${targetKey}' 未找到已发布主键字段`
          : `主键 '${realPk}' 未精确命中数据源列（映射 sourceField='${pkMapping?.sourceField ?? "(未映射)"}' 不在 '${ds.name}' 字段中）`;
        skipped.push({ typeKey: t.typeKey, targetKey, dataset: ds.name, reason });
        if (this.quarantine) {
          const rows = await this.repos.rawRows.list(ctx.tenantId, ds.id);
          const mapping = t.properties.map((p) => ({ propKey: p.propKey, sourceField: p.sourceField }));
          for (const row of rows) {
            await this.quarantine.record(ctx.tenantId, {
              connId: ds.id,
              dataset: ds.name,
              raw: row as Record<string, unknown>,
              reason: "SCHEMA_MISMATCH",
              detail: reason,
              reprocess: { targetKey, mapping, pk: realPk },
            });
            quarantined++;
          }
        }
        continue;
      }

      const rows = await this.repos.rawRows.list(ctx.tenantId, ds.id);
      // Idempotent per dataset: clear previous materialization of this dataset+type.
      await this.repos.objects.removeWhere(
        ctx.tenantId,
        (o) => o.type === targetKey && o.origin.type === "MATERIALIZED" && o.origin.datasetId === ds.id,
      );
      const pk = realPk;
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
    return { jobId, created, quarantined, skipped };
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
  ): Promise<{ jobId: string; materialized: { dataset: string; type: string; count: number }[]; skipped: { dataset: string; reason: string }[]; reconcileCandidates: SchemaReconcileCandidate[] }> {
    const jobId = newId("job");
    const startedAt = new Date().toISOString();
    const types = await this.ontology.listTypes(ctx);
    const existing: ExistingTypeField[] = types.flatMap((t) => t.properties.map((p) => ({ typeKey: t.key, propKey: p.propKey })));
    const pkByType = new Map(types.map((t) => [t.key, t.properties.find((p) => p.isPrimaryKey)?.propKey]));
    const materialized: { dataset: string; type: string; count: number }[] = [];
    const skipped: { dataset: string; reason: string }[] = [];
    // WO-INTAKE-VISIBILITY（G-VIS-1）：列名未精确命中的列不再静默丢——收集成 HITL 待确认候选（带样本值）返回，
    // 由调用方落 reconcile-candidates 队列，前端 SchemaReconcile 页逐列确认（治本：skip 列可见可处置，非空态死路）。
    const reconcileCandidates: SchemaReconcileCandidate[] = [];
    const rowCounts: Record<string, number> = {};
    // 采样某列前 ≤3 个非空值（供前端确认时看上下文·纯确定性取前几行）。
    const sampleOf = (rows: Record<string, unknown>[], column: string): unknown[] => {
      const out: unknown[] = [];
      for (const r of rows) { const v = r[column]; if (v != null && v !== "" && !out.includes(v)) { out.push(v); if (out.length >= 3) break; } }
      return out;
    };
    // WO-INTAKE-VISIBILITY（G-VIS-1·C6 闭环）：人在 SchemaReconcile 页确认过的候选（USE/RENAME→目标字段）
    // 喂回物化——之前"跳过"的列，resolve 后重跑 objectify 即真物化进对象（前端确认真生效·非装饰）。
    // 目标类型延后到数据集循环内定夺（优先归入该表已被 autoMapped 指认的主类型，避免误落同名字段的旁类型）。
    const resolvedByDataset = new Map<string, { column: string; targetField: string; candidateTypes: string[] }[]>();
    for (const rc of await this.repos.reconcileCandidates.list(ctx.tenantId)) {
      if (rc.status !== "RESOLVED" || !rc.resolvedAction || rc.resolvedAction === "DISCARD" || rc.resolvedAction === "NEW") continue;
      const target = rc.resolvedTarget;
      if (!target) continue;
      const candidateTypes = rc.candidates.filter((x) => x.targetField === target).map((x) => x.targetType);
      const list = resolvedByDataset.get(rc.datasetName) ?? [];
      list.push({ column: rc.column ?? rc.prototypeColumn, targetField: target, candidateTypes });
      resolvedByDataset.set(rc.datasetName, list);
    }

    for (const dsId of rawDatasetIds) {
      const ds = await this.repos.rawDatasets.get(ctx.tenantId, dsId);
      if (!ds) { skipped.push({ dataset: dsId, reason: "原始表不存在" }); continue; }
      const rows = await this.repos.rawRows.list(ctx.tenantId, ds.id) as Record<string, unknown>[];
      // 确定性对账：列 → 既有 type.field（仅 autoMapped 精确命中入物化，候选/未命中交人，诚实不猜）。
      const recon = reconcileIntake([{ name: ds.name, columns: ds.fields.map((f) => f.name), rowCount: ds.rowCount, sampleRows: [] }], existing);
      const resolvedCols = resolvedByDataset.get(ds.name) ?? [];
      if (recon.autoMapped.length === 0 && resolvedCols.length === 0) {
        skipped.push({ dataset: ds.name, reason: "无可确定映射的列（全部待人确认/未命中）" });
        // 全表未命中且无人确认：把每列作为候选交人（否则 fresh 租户上传后无处确认→空态死路）。
        for (const cand of recon.candidates) {
          if (cand.datasetName !== ds.name) continue;
          reconcileCandidates.push({ ...cand, column: cand.prototypeColumn, sampleValues: sampleOf(rows, cand.prototypeColumn) });
        }
        continue;
      }
      // 按目标类型分组该表的 autoMapped 列 + 人已确认(RESOLVED USE/RENAME)的列（C6 闭环：确认后真物化）。
      const byType = new Map<string, { column: string; targetField: string }[]>();
      const resolvedColSet = new Set(resolvedCols.map((r) => r.column));
      for (const a of recon.autoMapped) {
        if (!byType.has(a.targetType)) byType.set(a.targetType, []);
        byType.get(a.targetType)!.push({ column: a.column, targetField: a.targetField });
      }
      // 主类型：该表 autoMapped 列最多的类型（人确认列优先归入它，避免误落同名字段的旁类型）。
      let resolvedDominant: string | undefined;
      let resolvedMax = 0;
      for (const [tt, cc] of byType) if (cc.length > resolvedMax) { resolvedMax = cc.length; resolvedDominant = tt; }
      for (const r of resolvedCols) {
        // 目标类型：优先主类型（若它在候选类型里或该表已确定主类型）；否则取第一个候选类型。
        const targetType = (resolvedDominant && (r.candidateTypes.length === 0 || r.candidateTypes.includes(resolvedDominant))) ? resolvedDominant : r.candidateTypes[0];
        if (!targetType) continue;
        if (!byType.has(targetType)) byType.set(targetType, []);
        const arr = byType.get(targetType)!;
        if (!arr.some((c) => c.targetField === r.targetField)) arr.push({ column: r.column, targetField: r.targetField });
      }
      // 根因修（真实业务数据真走真实管道）：reconcileIntake 是**列级**判歧义——常见业务列名
      // （qty/status/unitPrice）在多个对象类型都有同名字段 → exact>1 → 判为歧义 → 落 candidates →
      // 物化时被丢，导致上传订单的对象沦为空壳（qty/价/态缺失、value=0、求解器算不出真值）。
      // 但本数据集已被**无歧义列**唯一指认了主类型（如 5/8 列均 →Order）。故做**数据集级消歧**：
      // 取 autoMapped 最多列的主类型（≥2 列方confident），把"列名精确命中该主类型字段(score=1)"的
      // 歧义列归入主类型。纯确定性·不调 LLM·不猜——歧义仅靠"该数据集是什么表"这一既有事实化解。
      let dominantType: string | undefined;
      let maxCols = 0;
      for (const [t, cols] of byType) if (cols.length > maxCols) { maxCols = cols.length; dominantType = t; }
      const consumedCols = new Set<string>(); // 被数据集级消歧吸收的列（不再作为待确认候选）。
      if (dominantType && maxCols >= 2) {
        const domCols = byType.get(dominantType)!;
        const claimed = new Set(domCols.map((c) => c.targetField));
        for (const cand of recon.candidates) {
          if (cand.datasetName !== ds.name) continue;
          const hit = cand.candidates.find((x) => x.targetType === dominantType && x.score === 1);
          if (hit && !claimed.has(hit.targetField)) {
            domCols.push({ column: cand.prototypeColumn, targetField: hit.targetField });
            claimed.add(hit.targetField);
            consumedCols.add(cand.prototypeColumn);
          }
        }
      }
      // 未被自动映射、未被消歧吸收、也未被人确认的列 → 真·待人确认候选（带样本值·逐列 USE/RENAME/NEW/MERGE/DISCARD）。
      for (const cand of recon.candidates) {
        if (cand.datasetName !== ds.name || consumedCols.has(cand.prototypeColumn) || resolvedColSet.has(cand.prototypeColumn)) continue;
        reconcileCandidates.push({ ...cand, column: cand.prototypeColumn, sampleValues: sampleOf(rows, cand.prototypeColumn) });
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
    return { jobId, materialized, skipped, reconcileCandidates };
  }
}
