import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchModelingDrafts,
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
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";
import styles from "./ModelingPage.module.css";

const t = zh.admin.modeling;

/** 本体建模工作台（PRD §7.6）：AI 建议草案（A3 suggest）+ 三栏 = 源字段 | 映射画布 | 操作面板；PATCH 乐观更新+回滚 */
export default function ModelingPage() {
  const queryClient = useQueryClient();
  const { data: drafts } = useQuery({ queryKey: ["a", "modeling-drafts", {}], queryFn: fetchModelingDrafts });
  const [draftId, setDraftId] = useState<string | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
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
        <button className="btn primary sm" style={{ marginLeft: "auto" }} data-testid="modeling-new-draft" onClick={() => setSuggestOpen(true)}>
          {t.newDraft}
        </button>
      </div>
      {draft ? (
        <DraftWorkbench draft={draft} />
      ) : (
        // 管理平台增量 §6：无本体 → 「从数据建模」或「一键合成」
        <EmptyState message={zh.admin.empty.ontology}>
          <button className="btn primary sm" onClick={() => setSuggestOpen(true)} data-testid="cta-modeling">
            {zh.admin.empty.modelingCta}
          </button>
          <Link className="btn sm" to="/admin/synthetic" data-testid="cta-synthetic">
            {zh.admin.empty.syntheticCta}
          </Link>
        </EmptyState>
      )}
      {suggestOpen && (
        <SuggestModal
          onClose={() => setSuggestOpen(false)}
          onCreated={async (newDraftId) => {
            setSuggestOpen(false);
            await queryClient.invalidateQueries({ queryKey: ["a", "modeling-drafts"] });
            setDraftId(newDraftId);
          }}
        />
      )}
    </div>
  );
}

/** 新建草案：选原始数据集 → POST /a/v1/modeling/suggest（A3 半自动建模入口） */
function SuggestModal({ onClose, onCreated }: { onClose: () => void; onCreated: (draftId: string) => void }) {
  const { data: rawDatasets } = useQuery({ queryKey: ["a", "raw-datasets", {}], queryFn: fetchRawDatasets });
  const [selected, setSelected] = useState<string[]>([]);

  const suggestMut = useMutation({
    mutationFn: () => suggestModeling(selected),
    onSuccess: (r) => {
      toast(t.suggestDone, "success");
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
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <button className="btn" onClick={onClose}>
          {zh.common.back}
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
    mutationFn: () => publishModelingDraft(draft.id),
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
      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
        <button className="btn primary sm" disabled={publishMut.isPending} onClick={() => publishMut.mutate()} data-testid="publish-draft">
          {zh.common.publish}
        </button>
        <button className="btn sm" disabled={materializeMut.isPending} onClick={() => materializeMut.mutate()}>
          {t.materialize}
        </button>
        {matJob && (
          <span className={`badge ${matJob.status === "SUCCEEDED" ? "green" : "blue"}`} data-testid="materialize-status">
            {t.materializeProgress}: {matJob.status}
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
                  <span className="mono" style={{ marginLeft: "auto", fontSize: 10, color: "var(--muted2)" }}>conf {(ot.confidence * 100).toFixed(0)}%</span>
                </div>
                {ot.properties.map((p) => (
                  <div key={p.propKey} className={styles.propRow} data-testid={`prop-${ot.typeKey}-${p.propKey}`}>
                    <span>
                      {p.isPrimaryKey && <span title="主键" style={{ color: "var(--c-forecast)" }}>★ </span>}
                      {p.propKey}
                    </span>
                    <span className={styles.arrow}>←</span>
                    <span className="mono" style={{ color: "var(--muted)" }}>{ot.sourceDataset}.{p.sourceField}</span>
                    <span className="badge">{p.dataType}</span>
                    {p.refToTypeKey && <span className="badge blue">ref → {p.refToTypeKey}</span>}
                  </div>
                ))}
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
    default:
      break;
  }
  return next;
}
