import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConnectorType } from "@platform/contracts";
import { classifySourceOrigin } from "@platform/contracts";
import {
  createConnection,
  downloadRawDataset,
  fetchConnections,
  fetchConnectorCategories,
  fetchConnectorTypes,
  fetchDataHealth,
  fetchIntakeCoverage,
  fetchRawDatasetRows,
  fetchRawDatasets,
  fetchSyncJob,
  testConnection,
  triggerSync,
  uploadFile,
} from "@/api/endpoints";
import { DataModeBadge } from "@/components/DataModeBadge";
import { DataCategoriesPanel } from "./DataCategoriesPanel";
import { healthStatusLabel, HEALTH_POLL_MS } from "@/components/Health/HealthBadge";
import { JsonSchemaForm } from "@/components/JsonSchemaForm/JsonSchemaForm";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";

const t = zh.admin.connections;

/** 数据接入控制台（PRD §7.4）：连接列表 + 新建向导 + 文件上传卡 + 同步轮询 */
export default function ConnectionsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: connections } = useQuery({ queryKey: ["a", "connections", {}], queryFn: fetchConnections });
  const { data: catData } = useQuery({ queryKey: ["a", "connector-categories"], queryFn: fetchConnectorCategories });
  const [catFilter, setCatFilter] = useState(""); // A11 按归类筛选
  // §7.22 数据健康度（轻量轮询，与顶栏徽章同源）
  const { data: health } = useQuery({
    queryKey: ["a", "data-health", {}],
    queryFn: fetchDataHealth,
    refetchInterval: HEALTH_POLL_MS,
    staleTime: HEALTH_POLL_MS,
  });
  const [wizardOpen, setWizardOpen] = useState(false);
  const [syncJobId, setSyncJobId] = useState<string | null>(null);
  const healthOf = (connId: string) => health?.sources.find((s) => s.connId === connId);
  const degradedSources = (health?.sources ?? []).filter((s) => s.status !== "OK");

  const { data: syncJob } = useQuery({
    queryKey: ["a", "sync-job", { id: syncJobId }],
    queryFn: () => fetchSyncJob(syncJobId!),
    enabled: syncJobId != null,
    refetchInterval: (q) =>
      q.state.data?.status === "SUCCEEDED" || q.state.data?.status === "FAILED" ? false : 800,
  });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ fontSize: 16 }}>{t.title}</h2>
        <button className="btn primary sm" style={{ marginLeft: "auto" }} onClick={() => setWizardOpen(true)}>
          {t.newConnection}
        </button>
      </div>

      <DataCategoriesPanel />

      <UploadCard onDone={(connId) => navigate(`/admin/connections/${connId}/schema`)} />

      {/* §7.22 健康度汇总条：命中 C09 → 降级影响（P90 系数）+ 受影响求解器（文案与推演输出同源） */}
      {degradedSources.length > 0 && (
        <div className="panel" style={{ marginTop: 14, borderColor: "rgba(232,181,74,.5)" }} data-testid="health-summary">
          <div className="section-title">{zh.health.summaryTitle}</div>
          {degradedSources.map((s) => (
            <div key={s.connId} style={{ fontSize: 12, lineHeight: 1.8 }} data-testid={`health-summary-${s.connId}`}>
              <span className={`badge ${s.status === "DELAYED" ? "amber" : "red"}`}>{healthStatusLabel(s.status)}</span>{" "}
              <b className="zh">{s.name}</b>
              <span className="mono" style={{ color: "var(--muted2)", marginLeft: 6 }}>
                {zh.health.freshness} {(s.latencyMin / 60).toFixed(1)}h / {zh.health.threshold} {(s.thresholdMin / 60).toFixed(1)}h
              </span>
              {s.degradeImpact && (
                <div style={{ color: "var(--amber)", fontSize: 11.5 }} data-testid={`health-degrade-${s.connId}`}>
                  ⚠ {zh.health.degradeNote((s.latencyMin / 60).toFixed(1), String(s.degradeImpact.p90From), String(s.degradeImpact.p90To))}
                  <span style={{ color: "var(--muted)", marginLeft: 8 }}>{zh.health.affectedSolvers(s.degradeImpact.affectedSolvers.join("、"))}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="panel" style={{ marginTop: 14 }}>
        {(connections ?? []).length > 0 && (catData?.categories.length ?? 0) > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, fontSize: 12 }}>
            <span className="muted">按归类筛选</span>
            <select data-testid="conn-cat-filter" value={catFilter} onChange={(e) => setCatFilter(e.target.value)} style={{ fontSize: 12 }}>
              <option value="">全部</option>
              {catData!.categories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          </div>
        )}
        {(connections ?? []).length === 0 && (
          // 管理平台增量 §6：无连接器 → 「上传文件或创建连接」
          <EmptyState message={zh.admin.empty.connections}>
            <button className="btn primary sm" onClick={() => setWizardOpen(true)} data-testid="cta-connection">
              {zh.admin.empty.connectionsCta}
            </button>
          </EmptyState>
        )}
        <table className="cmp">
          <thead>
            <tr>
              <th>名称</th>
              <th>类型</th>
              <th>归类</th>
              <th>状态</th>
              <th>{zh.health.column}</th>
              <th>{t.lastSync}</th>
              <th>错误</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(connections ?? []).filter((c) => !catFilter || c.category === catFilter).map((c) => {
              const h = healthOf(c.id);
              return (
              <tr key={c.id} data-testid={`conn-${c.id}`}>
                <td className="zh">
                  <Link to={`/admin/connections/${c.id}/schema`}>{c.name}</Link>
                </td>
                <td>{c.connectorTypeKey}</td>
                <td data-testid={`conn-cat-${c.id}`}>{c.category ? <span className="badge">{c.category}</span> : "—"}</td>
                <td>
                  <span className={`badge ${c.status === "ACTIVE" ? "green" : c.status === "ERROR" ? "red" : ""}`}>
                    {c.status}
                  </span>
                </td>
                <td data-testid={`conn-health-${c.id}`}>
                  {h ? (
                    <>
                      <span className={`badge ${h.status === "OK" ? "green" : h.status === "DELAYED" ? "amber" : "red"}`}>{healthStatusLabel(h.status)}</span>
                      <span className="mono" style={{ fontSize: 10.5, color: "var(--muted2)", marginLeft: 5 }}>
                        {(h.latencyMin / 60).toFixed(1)}h
                      </span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{c.lastSyncAt ?? "—"}</td>
                <td className="zh" style={{ color: "var(--danger)" }}>
                  {c.lastError ?? ""}
                </td>
                <td>
                  <button
                    className="btn sm"
                    onClick={() =>
                      void triggerSync(c.id)
                        .then((r) => setSyncJobId(r.syncJobId))
                        .catch(toastError)
                    }
                  >
                    {t.syncNow}
                  </button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        {syncJobId && syncJob && (
          <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }} data-testid="sync-job-status">
            <span className={`badge ${syncJob.status === "SUCCEEDED" ? "green" : syncJob.status === "FAILED" ? "red" : "blue"}`}>
              {syncJob.status}
            </span>
            {syncJob.status === "RUNNING" && <span>{t.syncRunning}</span>}
            <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
              {Object.entries(syncJob.rowCounts)
                .map(([k, v]) => `${k}:${v}`)
                .join(" · ")}
            </span>
          </div>
        )}
      </div>

      {/* WO-SOURCE-TRANSPARENCY：每个连接的全部源数据集 —— 逐张预览行 + 一键下载 Excel/CSV（合成源亦透明可审计） */}
      {(connections ?? []).filter((c) => !catFilter || c.category === catFilter).map((c) => (
        <div key={c.id}>
          <ConnectionDatasetsPanel connId={c.id} connName={c.name} connectorTypeKey={c.connectorTypeKey} config={c.config} />
          {/* PANORAMA-FIELD-INTAKE：该连接绑定的全景字段全集——已映射(propKey←源字段) + 缺源字段诚实标"未映射"（非隐藏） */}
          <ConnectionFieldMappingPanel connId={c.id} />
        </div>
      ))}

      {wizardOpen && (
        <ConnectionWizard
          onClose={() => setWizardOpen(false)}
          onCreated={() => {
            setWizardOpen(false);
            void queryClient.invalidateQueries({ queryKey: ["a", "connections"] });
            void queryClient.invalidateQueries({ queryKey: ["a", "connector-categories"] }); // A11：新归类并入筛选
          }}
        />
      )}
    </div>
  );
}

/** 新建向导：选类型 → configSchema 动态表单（secret 不回显）→ 测试连接 → 保存 */
function ConnectionWizard({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { data: types } = useQuery({ queryKey: ["a", "connector-types", {}], queryFn: fetchConnectorTypes });
  const { data: catData } = useQuery({ queryKey: ["a", "connector-categories"], queryFn: fetchConnectorCategories });
  const [step, setStep] = useState<0 | 1>(0);
  const [type, setType] = useState<ConnectorType | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState(""); // A11 归类：默认取类型 category，可自由输入覆盖
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null);

  const testMut = useMutation({
    mutationFn: () => testConnection({ connectorTypeKey: type!.key, config }),
    onSuccess: setTestResult,
    onError: toastError,
  });

  const saveMut = useMutation({
    mutationFn: () => createConnection({ connectorTypeKey: type!.key, name, config, category: category.trim() || undefined }),
    onSuccess: () => {
      toast("连接已创建", "success");
      onCreated();
    },
    onError: toastError,
  });

  return (
    <Modal title={t.newConnection} onClose={onClose} width={520}>
      {step === 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {(types ?? []).map((ct) => (
            <button
              key={ct.key}
              className="btn"
              data-testid={`connector-type-${ct.key}`}
              style={{ justifyContent: "flex-start", flexDirection: "column", alignItems: "flex-start", gap: 2 }}
              onClick={() => {
                setType(ct);
                setCategory(ct.category ?? ""); // A11：默认取连接器类型 category
                setStep(1);
              }}
            >
              <strong>{ct.key}</strong>
              <span className="badge">{ct.category}</span>
            </button>
          ))}
        </div>
      )}
      {step === 1 && type && (
        <div>
          <div style={{ marginBottom: 12 }}>
            <label htmlFor="conn-name" style={{ fontSize: 12, color: "var(--muted)" }}>
              名称
            </label>
            <input id="conn-name" style={{ width: "100%" }} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label htmlFor="conn-category" style={{ fontSize: 12, color: "var(--muted)" }}>
              归类（默认取连接器类型，可选既有或自由输入）
            </label>
            <input id="conn-category" list="conn-category-options" data-testid="conn-category-input" style={{ width: "100%" }} value={category} onChange={(e) => setCategory(e.target.value)} />
            <datalist id="conn-category-options">
              {(catData?.categories ?? []).map((cat) => <option key={cat} value={cat} />)}
            </datalist>
          </div>
          <JsonSchemaForm schema={type.configSchema} value={config} onChange={setConfig} />
          {testResult && (
            <div className={`badge ${testResult.ok ? "green" : "red"}`} style={{ marginTop: 10 }} data-testid="test-result">
              {testResult.ok ? t.testOk : `${t.testFail}${testResult.message ? `：${testResult.message}` : ""}`}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <button className="btn" onClick={() => setStep(0)}>
              {zh.common.back}
            </button>
            <button className="btn" disabled={testMut.isPending} onClick={() => testMut.mutate()}>
              {t.testConnection}
            </button>
            <button className="btn primary" disabled={!name || saveMut.isPending} onClick={() => saveMut.mutate()}>
              {zh.common.save}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * WO-SOURCE-TRANSPARENCY · 连接的数据集面板：露该连接**全部** RawDataset（不再只首个），
 * 每张显 行数/字段数 + 「预览」（前 50 行真数据）+「下载 Excel」「下载 CSV」（命中后端导出端点）。
 * 合成源常驻 SYNTHETIC 徽标 + 诚实文案（透明 ≠ 冒充真实）。
 */
function ConnectionDatasetsPanel({
  connId,
  connName,
  connectorTypeKey,
  config,
}: {
  connId: string;
  connName: string;
  connectorTypeKey: string;
  config: Record<string, unknown>;
}) {
  const { data: datasets } = useQuery({
    queryKey: ["a", "raw-datasets", { connId }],
    queryFn: () => fetchRawDatasets(connId),
  });
  const isSynthetic = classifySourceOrigin(connectorTypeKey, config) === "synthetic";
  const list = datasets ?? [];
  return (
    <div className="panel" style={{ marginTop: 14 }} data-testid={`conn-datasets-${connId}`}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div className="section-title" style={{ margin: 0 }}>
          <span className="zh">{connName}</span> · {t.datasetsTitle}
        </div>
        {isSynthetic && <DataModeBadge mode="SYNTHETIC" testId={`conn-synthetic-${connId}`} />}
        <span className="mono" style={{ marginLeft: "auto", fontSize: 10, color: "var(--muted2)" }}>{list.length} 张</span>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8 }}>
        {t.datasetsHint}
        {isSynthetic && <span style={{ color: "var(--warn, #caa23a)", marginLeft: 4 }}>（{t.syntheticNote}）</span>}
      </div>
      {list.length === 0 && <div className="empty-state" data-testid={`conn-datasets-empty-${connId}`}>{t.noDatasets}</div>}
      {list.map((ds) => (
        <RawDatasetRow key={ds.id} dsId={ds.id} name={ds.name} rowCount={ds.rowCount} fieldCount={ds.fields?.length} synthetic={isSynthetic} />
      ))}
    </div>
  );
}

/**
 * PANORAMA-FIELD-INTAKE · 连接的字段映射面板：对绑定到本连接的每个全景对象类型，暴露**全景字段全集**
 * （非派生 props）——已映射显 propKey ← 源字段；缺源字段**诚实标"未映射"**（amber·非隐藏），
 * 深链字段对账/模版下载补供给。数据 = 后端 `GET /a/v1/intake-coverage` 真值（本体派生·非前端自算）。
 */
function ConnectionFieldMappingPanel({ connId }: { connId: string }) {
  const { data: coverage } = useQuery({ queryKey: ["a", "intake-coverage"], queryFn: fetchIntakeCoverage, staleTime: 60_000 });
  const bound = (coverage?.items ?? [])
    .map((i) => ({ item: i, bindings: i.connector.bindings.filter((b) => b.connId === connId) }))
    .filter((x) => x.bindings.length > 0);
  if (bound.length === 0) return null; // 本连接无类型绑定 → 无字段映射可展示（诚实不造）。
  return (
    <div className="panel" style={{ marginTop: 8 }} data-testid={`conn-fieldmap-${connId}`}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div className="section-title" style={{ margin: 0 }}>字段映射（全景字段全集 · 缺源诚实标未映射）</div>
        <Link to="/admin/schema-reconcile" style={{ marginLeft: "auto", fontSize: 11 }}>去字段对账 →</Link>
      </div>
      {bound.map(({ item, bindings }) =>
        bindings.map((b) => (
          <div key={`${item.typeKey}-${b.dataset}`} style={{ fontSize: 12, marginBottom: 8 }} data-testid={`conn-fieldmap-${connId}-${item.typeKey}`}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>
              {item.displayName} <span style={{ color: "var(--muted,#999)" }}>({item.typeKey})</span>
              <span className="mono" style={{ fontSize: 10.5, color: "var(--muted2)", marginLeft: 6 }}>← {b.dataset}</span>
              <span className={`badge ${b.unmapped.length === 0 ? "green" : "amber"}`} style={{ marginLeft: 6, fontSize: 10 }} data-testid={`conn-fieldmap-cov-${connId}-${item.typeKey}`}>
                已映射 {b.mapped.length}/{item.intakeTotal}
              </span>
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {b.mapped.map((m) => (
                <span key={m.propKey} className="chip" style={{ fontSize: 10.5 }} title={`源字段 ${m.sourceField}`}>
                  {m.propKey} <span className="mono" style={{ color: "var(--muted2)" }}>← {m.sourceField}</span>
                </span>
              ))}
              {b.unmapped.map((pk) => (
                <span key={pk} className="badge amber" style={{ fontSize: 10.5 }} data-testid={`conn-unmapped-${connId}-${item.typeKey}-${pk}`}
                  title="该字段在本连接无源字段映射（诚实标·非隐藏）——可经上传模版补数或在建模页补映射">
                  {pk} · 未映射
                </span>
              ))}
            </div>
          </div>
        )),
      )}
    </div>
  );
}

/** 单张数据集：概要行 + 可展开的行预览表 + 下载按钮。 */
function RawDatasetRow({
  dsId,
  name,
  rowCount,
  fieldCount,
  synthetic,
}: {
  dsId: string;
  name: string;
  rowCount?: number;
  fieldCount?: number;
  synthetic: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderTop: "1px solid var(--line)", padding: "6px 2px" }} data-testid={`ds-item-${dsId}`}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <strong className="mono" style={{ fontSize: 12 }}>{name}</strong>
        {typeof rowCount === "number" && <span style={{ fontSize: 10.5, color: "var(--muted2)" }}>{t.rows(rowCount)}</span>}
        {typeof fieldCount === "number" && <span style={{ fontSize: 10.5, color: "var(--muted2)" }}>{t.fieldsCount(fieldCount)}</span>}
        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          <button className="btn sm" data-testid={`ds-preview-${dsId}`} onClick={() => setOpen((v) => !v)}>
            {open ? t.hidePreview : t.preview}
          </button>
          <button
            className="btn sm"
            data-testid={`ds-download-xlsx-${dsId}`}
            onClick={() => void downloadRawDataset(dsId, "xlsx").catch(toastError)}
          >
            {t.downloadXlsx}
          </button>
          <button
            className="btn sm"
            data-testid={`ds-download-csv-${dsId}`}
            onClick={() => void downloadRawDataset(dsId, "csv").catch(toastError)}
          >
            {t.downloadCsv}
          </button>
        </div>
      </div>
      {open && <RawDatasetRowsTable dsId={dsId} synthetic={synthetic} />}
    </div>
  );
}

/** 行预览表（前 50 行真数据）。合成源在表上方常驻 SYNTHETIC 徽标（透明 ≠ 冒充）。 */
function RawDatasetRowsTable({ dsId, synthetic }: { dsId: string; synthetic: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ["a", "raw-rows", dsId],
    queryFn: () => fetchRawDatasetRows(dsId),
  });
  if (isLoading) return <div className="empty-state" style={{ fontSize: 11 }}>{zh.common.loading}</div>;
  const rows = (data?.rows ?? []).slice(0, 50);
  if (rows.length === 0) return <div className="empty-state" style={{ fontSize: 11 }} data-testid={`ds-rows-empty-${dsId}`}>{t.noDatasets}</div>;
  const cols = Object.keys(rows[0]!).filter((k) => k !== "_editedAt");
  return (
    <div style={{ marginTop: 6, overflowX: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        {synthetic && <DataModeBadge mode="SYNTHETIC" testId={`ds-synthetic-${dsId}`} />}
        <span style={{ fontSize: 10.5, color: "var(--muted2)" }}>{t.previewRows(rows.length)}</span>
      </div>
      <table className="cmp" data-testid={`ds-preview-table-${dsId}`}>
        <thead>
          <tr>
            <th>#</th>
            {cols.map((col) => <th key={col}>{col}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} data-testid={`ds-preview-row-${dsId}-${i}`}>
              <td>{i}</td>
              {cols.map((col) => (
                <td key={col} style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {row[col] == null ? "" : typeof row[col] === "object" ? JSON.stringify(row[col]) : String(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 上传卡：拖拽 + 进度条，完成后跳字段画像页 */
function UploadCard({ onDone }: { onDone: (connId: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const upload = async (file: File) => {
    setProgress(8);
    const timer = setInterval(() => setProgress((p) => (p == null || p >= 90 ? p : p + 12)), 120);
    try {
      const res = await uploadFile(file);
      setProgress(100);
      setTimeout(() => onDone(res.connId), 250);
    } catch (e) {
      toastError(e);
      setProgress(null);
    } finally {
      clearInterval(timer);
    }
  };

  return (
    <div
      className="panel"
      style={{
        border: dragOver ? "1px dashed var(--accent)" : "1px dashed var(--line2)",
        textAlign: "center",
        cursor: "pointer",
      }}
      role="button"
      tabIndex={0}
      data-testid="upload-card"
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files[0];
        if (f) void upload(f);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.json"
        hidden
        aria-label={t.upload}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
      <div style={{ color: "var(--muted)", padding: "8px 0" }}>{t.uploadHint}</div>
      {progress != null && (
        <div style={{ height: 5, background: "var(--bg2)", borderRadius: 3, overflow: "hidden", marginTop: 6 }}>
          <div
            data-testid="upload-progress"
            style={{ width: `${progress}%`, height: "100%", background: "var(--accent)", transition: "width .15s" }}
          />
        </div>
      )}
    </div>
  );
}
