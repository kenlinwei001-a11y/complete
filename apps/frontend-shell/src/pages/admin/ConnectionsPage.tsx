import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConnectorType } from "@platform/contracts";
import {
  createConnection,
  fetchConnections,
  fetchConnectorCategories,
  fetchConnectorTypes,
  fetchDataHealth,
  fetchSyncJob,
  testConnection,
  triggerSync,
  uploadFile,
} from "@/api/endpoints";
import { DataCategoriesPanel } from "./DataCategoriesPanel";
import { KnowledgeBasePanel } from "./KnowledgeBasePanel";
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
                <div style={{ color: "var(--amber-txt)", fontSize: 12 }} data-testid={`health-degrade-${s.connId}`}>
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
                      <span className="mono" style={{ fontSize: 12, color: "var(--muted2)", marginLeft: 5 }}>
                        {(h.latencyMin / 60).toFixed(1)}h
                      </span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{c.lastSyncAt ?? "—"}</td>
                <td className="zh" style={{ color: "var(--danger-txt)" }}>
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
            <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
              {Object.entries(syncJob.rowCounts)
                .map(([k, v]) => `${k}:${v}`)
                .join(" · ")}
            </span>
          </div>
        )}
      </div>

      {/* WO-BEFE-F · S4 知识库（POST /a/v1/kb/search · /:connId/docs · /:connId/sync）：
          挂在连接页，因为 connId 是这三条端点的路径参数 —— 脱离连接谈 KB 没有主语。
          无 knowledge_base 连接时该组件返回 null（不渲染空壳）。 */}
      <KnowledgeBasePanel connections={connections ?? []} />

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

/** 上传卡：拖拽 + 进度条，完成后跳字段画像页 */
function UploadCard({ onDone }: { onDone: (connId: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // 跳转延时必须可取消：卸载后仍 fire 会在已拆除的路由/环境上跑（残留句柄 → teardown 期报错）
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (doneTimerRef.current !== null) clearTimeout(doneTimerRef.current);
    },
    [],
  );

  const upload = async (file: File) => {
    setProgress(8);
    const timer = setInterval(() => setProgress((p) => (p == null || p >= 90 ? p : p + 12)), 120);
    try {
      const res = await uploadFile(file);
      setProgress(100);
      // 覆盖 ref 前先清：250ms 内连传两个文件会把前一个句柄变成孤儿（#79 同族）
      if (doneTimerRef.current !== null) clearTimeout(doneTimerRef.current);
      doneTimerRef.current = setTimeout(() => {
        doneTimerRef.current = null;
        onDone(res.connId);
      }, 250);
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
