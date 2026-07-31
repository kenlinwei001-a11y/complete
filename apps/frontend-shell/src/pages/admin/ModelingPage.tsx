import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deriveModeling,
  fetchBusinessDomains,
  fetchModelingCoverage,
  fetchModelingDrafts,
  fetchObjectTypes,
  fetchRawDatasets,
  fetchSyncJob,
  materializeDraft,
  patchModelingDraft,
  publishModelingDraft,
  suggestModeling,
  type ModelingDraftVM,
} from "@/api/endpoints";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { DataSourcePanel } from "@/components/DataSourcePanel";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";
import styles from "./ModelingPage.module.css";

const t = zh.admin.modeling;

/** 本体建模工作台（PRD §7.6）：AI 建议草案（A3 suggest）+ 三栏 = 源字段 | 映射画布 | 操作面板；PATCH 乐观更新+回滚 */
export default function ModelingPage() {
  const queryClient = useQueryClient();
  const { data: drafts } = useQuery({ queryKey: ["a", "modeling-drafts", {}], queryFn: fetchModelingDrafts });
  // 轨L 增量3：已发布本体（中心真值闭合权威源）——本体已存在则中心绝不显"暂无本体"（非只看草案）。
  const { data: publishedTypes } = useQuery({ queryKey: ["a", "object-types"], queryFn: fetchObjectTypes });
  const [draftId, setDraftId] = useState<string | null>(null);
  // 原型 intake「建模为新类型」深链：?datasets=id1,id2 → 自动开新建草案弹窗并预选这些数据集。
  const [params, setParams] = useSearchParams();
  const preselect = (params.get("datasets") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  // 建模弹窗预选数据集：URL 深链初值 / 新建草案(空) / 点击左栏"未建模"数据集([该集])。
  const [suggestSeed, setSuggestSeed] = useState<string[]>(preselect);
  const [suggestOpen, setSuggestOpen] = useState(preselect.length > 0);
  const openSuggest = (datasets: string[] = []) => { setSuggestSeed(datasets); setSuggestOpen(true); };
  const draft = drafts?.find((d) => d.id === draftId) ?? drafts?.[0];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <h2 style={{ fontSize: 16 }}>{t.title}</h2>
        <select value={draft?.id ?? ""} onChange={(e) => setDraftId(e.target.value)} aria-label="选择草案">
          {(drafts ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.id} · {d.status}
            </option>
          ))}
        </select>
        <button className="btn primary sm" style={{ marginLeft: "auto" }} data-testid="modeling-new-draft" onClick={() => openSuggest()}>
          {t.newDraft}
        </button>
      </div>
      {/* additive（RL9 可回退）：左侧数据源面板 + 右侧既有工作台/空态，原有区块零删改 */}
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <div style={{ width: 248, flexShrink: 0 }}>
          {/* 点击左栏"未建模"数据集 → 打开建模弹窗并预选该数据集（接 A3 半自动建模 flow）。 */}
          <DataSourcePanel drafts={drafts} onModel={(id) => openSuggest([id])} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {draft ? (
            <DraftWorkbench draft={draft} />
          ) : publishedTypes && publishedTypes.length > 0 ? (
            // 轨L 增量3：有已发布本体但无活动草案 → 显已发布本体（绝不"暂无本体"），可溯各自 sourceDataset。
            <PublishedOntologyView types={publishedTypes} />
          ) : (
            // 管理平台增量 §6：真无本体（无草案且无已发布类型）→ 「从数据建模」或「一键合成」
            <EmptyState message={zh.admin.empty.ontology}>
              <button className="btn primary sm" onClick={() => openSuggest()} data-testid="cta-modeling">
                {zh.admin.empty.modelingCta}
              </button>
              <Link className="btn sm" to="/admin/synthetic" data-testid="cta-synthetic">
                {zh.admin.empty.syntheticCta}
              </Link>
            </EmptyState>
          )}
        </div>
      </div>
      {suggestOpen && (
        <SuggestModal
          initialSelected={suggestSeed}
          onClose={() => { setSuggestOpen(false); if (params.has("datasets")) { params.delete("datasets"); setParams(params, { replace: true }); } }}
          onCreated={async (newDraftId) => {
            setSuggestOpen(false);
            if (params.has("datasets")) { params.delete("datasets"); setParams(params, { replace: true }); }
            await queryClient.invalidateQueries({ queryKey: ["a", "modeling-drafts"] });
            setDraftId(newDraftId);
          }}
        />
      )}
    </div>
  );
}

/**
 * 轨L 增量3：已发布本体视图（中心真值闭合）。无活动草案但本体已存在时显此——逐类型显
 * 名称/域/属性数/派生属性数 + **可溯到各自 sourceDataset**（provenance 真实，R13），绝不"暂无本体"。
 */
function PublishedOntologyView({ types }: { types: Awaited<ReturnType<typeof fetchObjectTypes>> }) {
  const sorted = [...types].sort((a, b) => a.key.localeCompare(b.key));
  return (
    <div data-testid="published-ontology">
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
        <strong style={{ fontSize: 14 }}>已发布本体</strong>
        <span style={{ color: "var(--muted, #888)", fontSize: 12 }} data-testid="published-ontology-count">
          {sorted.length} 个对象类型（经建模链发布 · 可溯数据源）
        </span>
      </div>
      <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--muted, #888)" }}>
            <th style={{ padding: "4px 8px" }}>类型</th>
            <th style={{ padding: "4px 8px" }}>域</th>
            <th style={{ padding: "4px 8px" }}>属性</th>
            <th style={{ padding: "4px 8px" }}>派生</th>
            <th style={{ padding: "4px 8px" }}>来源数据集（provenance）</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((ty) => (
            <tr key={ty.key} style={{ borderTop: "1px solid var(--border, #2a2a2a)" }} data-testid={`pub-type-${ty.key}`}>
              <td style={{ padding: "4px 8px" }}>
                <span style={{ fontWeight: 600 }}>{ty.displayName}</span>{" "}
                <span style={{ color: "var(--muted, #888)" }}>{ty.key}</span>
              </td>
              <td style={{ padding: "4px 8px" }}>{ty.domain ?? "—"}</td>
              <td style={{ padding: "4px 8px" }}>{ty.properties.length}</td>
              <td style={{ padding: "4px 8px" }}>{ty.derivedProperties?.length ?? 0}</td>
              <td style={{ padding: "4px 8px" }} data-testid={`pub-type-src-${ty.key}`}>
                {(ty.sourceBindings ?? []).map((b) => b.dataset).join(", ") || <span style={{ color: "var(--danger, #e55)" }}>无来源</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 新建草案：选原始数据集 → POST /a/v1/modeling/suggest（A3 半自动建模入口） */
function SuggestModal({ onClose, onCreated, initialSelected = [] }: { onClose: () => void; onCreated: (draftId: string) => void; initialSelected?: string[] }) {
  const { data: rawDatasets } = useQuery({ queryKey: ["a", "raw-datasets", {}], queryFn: () => fetchRawDatasets() });
  const [selected, setSelected] = useState<string[]>(initialSelected);

  const suggestMut = useMutation({
    mutationFn: () => suggestModeling(selected),
    onSuccess: (r) => {
      toast(t.suggestDone, "success");
      onCreated(r.draftId);
    },
    onError: toastError,
  });
  // 确定性建模（无 LLM·字段全建模 100% 覆盖；nano-ontoprompt 融入）
  const deriveMut = useMutation({
    mutationFn: () => deriveModeling(selected),
    onSuccess: (r) => {
      toast("确定性建模完成：每个字段已建模（100% 覆盖）", "success");
      onCreated(r.draftId);
    },
    onError: toastError,
  });

  return (
    <Modal title={t.newDraft} onClose={onClose} width={460}>
      <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>{t.newDraftHint}</p>
      {(rawDatasets ?? []).length === 0 && <div className="empty-state">{t.newDraftEmpty}</div>}
      {(rawDatasets ?? []).map((ds) => (
        <label key={ds.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", fontSize: 12.5 }}>
          <input
            type="checkbox"
            checked={selected.includes(ds.id)}
            onChange={(e) => setSelected((s) => (e.target.checked ? [...s, ds.id] : s.filter((x) => x !== ds.id)))}
          />
          <span className="mono">{ds.name}</span>
          <span style={{ color: "var(--muted2)", fontSize: 10.5 }}>{ds.id}</span>
        </label>
      ))}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <button className="btn" onClick={onClose}>
          {zh.common.back}
        </button>
        {/* 确定性建模：无 LLM、每个字段必建模（R12 字段全建模门保底基线） */}
        <button
          className="btn"
          disabled={selected.length === 0 || deriveMut.isPending}
          data-testid="modeling-derive-run"
          title="基于数据的确定性映射：dataset→对象·column→属性·FK→链接，构造上 100% 字段覆盖"
          onClick={() => deriveMut.mutate()}
        >
          确定性建模（全字段）
        </button>
        <button
          className="btn primary"
          disabled={selected.length === 0 || suggestMut.isPending}
          data-testid="modeling-suggest-run"
          onClick={() => suggestMut.mutate()}
        >
          {t.suggestRun}
        </button>
      </div>
    </Modal>
  );
}

function DraftWorkbench({ draft }: { draft: ModelingDraftVM }) {
  const queryClient = useQueryClient();
  const key = ["a", "modeling-drafts", {}];
  const [publishErrors, setPublishErrors] = useState<{ typeKey: string; message: string }[]>(draft.publishErrors ?? []);
  const [materializeJobId, setMaterializeJobId] = useState<string | null>(null);
  // 字段全建模门（R12）：默认 HARD（升级默认 = 每个导入字段都必须建模），可取消勾选放宽。
  const [requireFullCoverage, setRequireFullCoverage] = useState(true);
  const { data: coverage } = useQuery({
    queryKey: ["a", "modeling-coverage", draft.id, draft.suggestion.objectTypes.length],
    queryFn: () => fetchModelingCoverage(draft.id),
  });
  // 新类型发布前必须人工归域（A4 治理门）；下拉来源 = 业务域注册表（R14 非内联）。
  const { data: domainsData } = useQuery({ queryKey: ["a", "business-domains"], queryFn: fetchBusinessDomains });
  const domains = domainsData?.domains ?? [];
  // WO-63 可读性：已发布本体是属性中文名/单位/口径的唯一出处（R14 前端零硬编码）。
  // 映射到既有类型的属性即可读到真口径；新建类型本体里还没有 → 返回 undefined，界面诚实回落 propKey。
  const { data: publishedForSemantics } = useQuery({ queryKey: ["a", "object-types"], queryFn: fetchObjectTypes });
  const semanticsOf = (existingTypeKey: string | null | undefined, propKey: string) =>
    existingTypeKey
      ? (publishedForSemantics ?? []).find((t) => t.key === existingTypeKey)?.properties.find((p) => p.propKey === propKey)
      : undefined;

  // PATCH 操作：即时调端点，乐观更新 + 失败回滚（PRD §7.6）
  const patchMut = useMutation({
    mutationFn: (operation: Record<string, unknown>) => patchModelingDraft(draft.id, operation),
    onMutate: async (operation) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<ModelingDraftVM[]>(key);
      queryClient.setQueryData<ModelingDraftVM[]>(key, (old) =>
        (old ?? []).map((d) => (d.id === draft.id ? applyOperationLocally(d, operation) : d)),
      );
      return { prev };
    },
    onError: (e, _op, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(key, ctx.prev);
      toast(t.patchFailed, "error");
      toastError(e);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: key }),
  });

  const publishMut = useMutation({
    mutationFn: () => publishModelingDraft(draft.id, requireFullCoverage),
    onSuccess: (res) => {
      if (res.ok) {
        setPublishErrors([]);
        toast("发布成功，可触发对象化", "success");
      } else {
        setPublishErrors(res.errors ?? []);
      }
    },
    onError: toastError,
  });

  const materializeMut = useMutation({
    mutationFn: () => materializeDraft(draft.id),
    onSuccess: (r) => setMaterializeJobId(r.jobId),
    onError: toastError,
  });

  const { data: matJob } = useQuery({
    queryKey: ["a", "sync-job", { id: materializeJobId }],
    queryFn: () => fetchSyncJob(materializeJobId!),
    enabled: materializeJobId != null,
    refetchInterval: (q) => (q.state.data?.status === "SUCCEEDED" || q.state.data?.status === "FAILED" ? false : 800),
  });

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn primary sm" disabled={publishMut.isPending} onClick={() => publishMut.mutate()} data-testid="publish-draft">
          {zh.common.publish}
        </button>
        {/* 字段全建模门（R12）：默认 HARD（勾选）；取消勾选放宽，未建模字段不阻断 */}
        <label style={{ fontSize: 11.5, color: "var(--muted)", display: "flex", alignItems: "center", gap: 4 }} title="R12 字段全建模：默认要求每个导入字段都被建模，取消勾选可放宽">
          <input type="checkbox" data-testid="require-full-coverage" checked={requireFullCoverage} onChange={(e) => setRequireFullCoverage(e.target.checked)} />
          字段全建模门（R12 默认）
        </label>
        <button className="btn sm" disabled={materializeMut.isPending} onClick={() => materializeMut.mutate()}>
          {t.materialize}
        </button>
        {matJob && (
          <span className={`badge ${matJob.status === "SUCCEEDED" ? "green" : "blue"}`} data-testid="materialize-status">
            {t.materializeProgress}: {matJob.status}
          </span>
        )}
        {/* 字段全建模覆盖徽章（R12）：每个导入字段是否被建模 */}
        {coverage && (
          <span
            className={`badge ${coverage.fullyCovered ? "green" : "amber"}`}
            data-testid="modeling-coverage-badge"
            style={{ marginLeft: "auto" }}
            title={coverage.fullyCovered ? "全部导入字段已建模" : `未建模：${coverage.datasets.flatMap((d) => d.unmodeled.map((u) => `${d.name}.${u}`)).join("、")}`}
          >
            字段全建模 {coverage.modeledFields}/{coverage.totalFields}（{Math.round(coverage.coverage * 100)}%）{coverage.fullyCovered ? " ✓" : ""}
          </span>
        )}
      </div>
      <div className={styles.threeCol}>
        {/* 栏1：源字段（按数据集分组） */}
        <div className={`panel ${styles.col}`}>
          <div className="section-title">{t.sourceFields}</div>
          {draft.datasets.map((ds) => (
            <div key={ds.name} style={{ marginBottom: 12 }}>
              <div className="mono" style={{ fontSize: 11.5, marginBottom: 4 }}>
                {ds.name}
              </div>
              {ds.fields.map((f) => (
                <div key={f.name} className={styles.fieldRow}>
                  <span>{f.name}</span>
                  <span className="badge">{f.inferredType}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* 栏2：映射画布 */}
        <div className={`${styles.col} ${styles.canvas}`}>
          <div className="section-title">{t.canvas}</div>
          {draft.suggestion.objectTypes.map((ot) => {
            const errors = publishErrors.filter((e) => e.typeKey === ot.typeKey);
            return (
              <div key={ot.typeKey} className={`panel ${styles.typeCard} ${errors.length > 0 ? styles.typeCardError : ""}`} data-testid={`type-card-${ot.typeKey}`}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                  <strong>{ot.displayName}</strong>
                  <span className="mono" style={{ fontSize: 10.5, color: "var(--muted2)" }}>{ot.typeKey}</span>
                  {ot.action === "MAP_TO_EXISTING" && <span className="badge green" data-testid="map-existing-badge">{t.mapToExisting} → {ot.existingTypeKey}</span>}
                  {/* 新类型归域（发布门）：映射既有类型沿用既有域、无需此控件 */}
                  {ot.action !== "MAP_TO_EXISTING" && (
                    <select
                      data-testid={`type-domain-${ot.typeKey}`}
                      value={ot.domain && ot.domain !== "unassigned" ? ot.domain : ""}
                      onChange={(e) => patchMut.mutate({ op: "setDomain", typeKey: ot.typeKey, domain: e.target.value })}
                      style={{ fontSize: 11, padding: "1px 4px" }}
                      title="发布前必须人工归域（A4 治理门）"
                    >
                      <option value="">{t.assignDomain}</option>
                      {domains.map((d) => <option key={d.key} value={d.key}>{d.displayName}</option>)}
                    </select>
                  )}
                  <span className="mono" style={{ marginLeft: "auto", fontSize: 10, color: "var(--muted2)" }}>conf {(ot.confidence * 100).toFixed(0)}%</span>
                </div>
                {ot.properties.map((p) => {
                  // WO-63：映射到已发布类型时，属性列显示本体里的中文名/单位/口径（真值来自后端，前端零硬编码）。
                  // 新建类型尚未发布、本体里还没有口径 → 诚实回落显示 propKey，不编造中文名。
                  const sem = semanticsOf(ot.action === "MAP_TO_EXISTING" ? ot.existingTypeKey : null, p.propKey);
                  return (
                  <div key={p.propKey} className={styles.propRow} data-testid={`prop-${ot.typeKey}-${p.propKey}`} title={sem?.description ?? ""}>
                    <span>
                      {p.isPrimaryKey && <span title="主键" style={{ color: "var(--c-forecast)" }}>★ </span>}
                      <span data-testid={`prop-label-${ot.typeKey}-${p.propKey}`}>{sem?.displayName ?? p.propKey}</span>
                    </span>
                    <span className={styles.arrow}>←</span>
                    <span className="mono" style={{ color: "var(--muted)" }}>{ot.sourceDataset}.{p.sourceField}</span>
                    <span className="badge">{p.dataType}</span>
                    {sem?.unit && <span className="badge" data-testid={`prop-unit-${ot.typeKey}-${p.propKey}`}>{sem.unit}</span>}
                    {p.refToTypeKey && <span className="badge blue">ref → {p.refToTypeKey}</span>}
                  </div>
                  );
                })}
                {errors.map((e, i) => (
                  <div key={i} className="badge red" style={{ marginTop: 6 }} data-testid={`publish-error-${ot.typeKey}`}>
                    {e.message}
                  </div>
                ))}
              </div>
            );
          })}
          {draft.suggestion.linkTypes.length > 0 && (
            <div className="panel" style={{ marginTop: 4 }}>
              <div className="section-title">关系建议</div>
              {draft.suggestion.linkTypes.map((lt, i) => (
                <div key={i} className="mono" style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 3 }}>
                  {lt.fromTypeKey} —{lt.cardinality}→ {lt.toTypeKey}
                  <span style={{ color: "var(--muted2)" }}> via {lt.viaFields.fromField}={lt.viaFields.toField}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 栏3：操作面板 */}
        <div className={`panel ${styles.col}`}>
          <div className="section-title">{t.operations}</div>
          <OperationPanel draft={draft} onApply={(op) => patchMut.mutate(op)} pending={patchMut.isPending} />
        </div>
      </div>
    </div>
  );
}

function OperationPanel({
  draft,
  onApply,
  pending,
}: {
  draft: ModelingDraftVM;
  onApply: (op: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const typeKeys = draft.suggestion.objectTypes.map((o) => o.typeKey);
  const [typeKey, setTypeKey] = useState(typeKeys[0] ?? "");
  const selected = draft.suggestion.objectTypes.find((o) => o.typeKey === typeKey);
  const [renameTo, setRenameTo] = useState("");
  const [propKey, setPropKey] = useState("");
  const [newProp, setNewProp] = useState({ propKey: "", sourceField: "", dataType: "string" });
  const [refTo, setRefTo] = useState("");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 12 }}>
      <label>
        对象类型
        <select style={{ width: "100%" }} value={typeKey} onChange={(e) => setTypeKey(e.target.value)} aria-label="操作对象类型">
          {typeKeys.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.opGroup}>
        <div className="section-title">改名</div>
        <input placeholder="新 typeKey" value={renameTo} aria-label="新 typeKey" onChange={(e) => setRenameTo(e.target.value)} />
        <button className="btn sm" disabled={!renameTo || pending} data-testid="op-rename" onClick={() => onApply({ op: "renameType", typeKey, newTypeKey: renameTo })}>
          应用
        </button>
      </div>

      <div className={styles.opGroup}>
        <div className="section-title">加属性</div>
        <input placeholder="propKey" value={newProp.propKey} aria-label="新属性 propKey" onChange={(e) => setNewProp({ ...newProp, propKey: e.target.value })} />
        <input placeholder="sourceField" value={newProp.sourceField} aria-label="新属性 sourceField" onChange={(e) => setNewProp({ ...newProp, sourceField: e.target.value })} />
        <select value={newProp.dataType} aria-label="新属性类型" onChange={(e) => setNewProp({ ...newProp, dataType: e.target.value })}>
          {["string", "number", "boolean", "date", "enum", "ref"].map((dt) => (
            <option key={dt}>{dt}</option>
          ))}
        </select>
        <button
          className="btn sm"
          disabled={!newProp.propKey || pending}
          data-testid="op-add-prop"
          onClick={() =>
            onApply({
              op: "addProperty",
              typeKey,
              property: { ...newProp, isPrimaryKey: false, refToTypeKey: null },
            })
          }
        >
          应用
        </button>
      </div>

      <div className={styles.opGroup}>
        <div className="section-title">删属性 / 改类型 / 设引用</div>
        <select value={propKey} aria-label="属性" onChange={(e) => setPropKey(e.target.value)}>
          <option value="">选择属性</option>
          {(selected?.properties ?? []).map((p) => (
            <option key={p.propKey}>{p.propKey}</option>
          ))}
        </select>
        <button className="btn sm danger" disabled={!propKey || pending} data-testid="op-remove-prop" onClick={() => onApply({ op: "removeProperty", typeKey, propKey })}>
          删除属性
        </button>
        <input placeholder="ref → typeKey" value={refTo} aria-label="引用类型" onChange={(e) => setRefTo(e.target.value)} />
        <button className="btn sm" disabled={!propKey || !refTo || pending} data-testid="op-set-ref" onClick={() => onApply({ op: "setRef", typeKey, propKey, refToTypeKey: refTo })}>
          设引用
        </button>
      </div>
    </div>
  );
}

/** 本地应用 PATCH 操作（乐观更新视图） */
export function applyOperationLocally(draft: ModelingDraftVM, op: Record<string, unknown>): ModelingDraftVM {
  const next: ModelingDraftVM = JSON.parse(JSON.stringify(draft)) as ModelingDraftVM;
  const ot = next.suggestion.objectTypes.find((o) => o.typeKey === op.typeKey);
  switch (op.op) {
    case "renameType":
      if (ot) ot.typeKey = String(op.newTypeKey);
      break;
    case "addProperty":
      ot?.properties.push(op.property as (typeof ot.properties)[number]);
      break;
    case "removeProperty":
      if (ot) ot.properties = ot.properties.filter((p) => p.propKey !== op.propKey);
      break;
    case "setRef": {
      const p = ot?.properties.find((x) => x.propKey === op.propKey);
      if (p) {
        p.refToTypeKey = String(op.refToTypeKey);
        p.dataType = "ref";
      }
      break;
    }
    case "setDomain":
      if (ot) ot.domain = String(op.domain);
      break;
    default:
      break;
  }
  return next;
}
