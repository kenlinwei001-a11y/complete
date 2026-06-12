import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConnectorType } from "@platform/contracts";
import {
  createConnection,
  fetchConnections,
  fetchConnectorTypes,
  fetchSyncJob,
  testConnection,
  triggerSync,
  uploadFile,
} from "@/api/endpoints";
import { JsonSchemaForm } from "@/components/JsonSchemaForm/JsonSchemaForm";
import { Modal } from "@/components/ui/Modal";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";

const t = zh.admin.connections;

/** 数据接入控制台（PRD §7.4）：连接列表 + 新建向导 + 文件上传卡 + 同步轮询 */
export default function ConnectionsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: connections } = useQuery({ queryKey: ["a", "connections", {}], queryFn: fetchConnections });
  const [wizardOpen, setWizardOpen] = useState(false);
  const [syncJobId, setSyncJobId] = useState<string | null>(null);

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

      <UploadCard onDone={(connId) => navigate(`/admin/connections/${connId}/schema`)} />

      <div className="panel" style={{ marginTop: 14 }}>
        <table className="cmp">
          <thead>
            <tr>
              <th>名称</th>
              <th>类型</th>
              <th>状态</th>
              <th>{t.lastSync}</th>
              <th>错误</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(connections ?? []).map((c) => (
              <tr key={c.id} data-testid={`conn-${c.id}`}>
                <td className="zh">
                  <Link to={`/admin/connections/${c.id}/schema`}>{c.name}</Link>
                </td>
                <td>{c.connectorTypeKey}</td>
                <td>
                  <span className={`badge ${c.status === "ACTIVE" ? "green" : c.status === "ERROR" ? "red" : ""}`}>
                    {c.status}
                  </span>
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
            ))}
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

      {wizardOpen && (
        <ConnectionWizard
          onClose={() => setWizardOpen(false)}
          onCreated={() => {
            setWizardOpen(false);
            void queryClient.invalidateQueries({ queryKey: ["a", "connections"] });
          }}
        />
      )}
    </div>
  );
}

/** 新建向导：选类型 → configSchema 动态表单（secret 不回显）→ 测试连接 → 保存 */
function ConnectionWizard({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { data: types } = useQuery({ queryKey: ["a", "connector-types", {}], queryFn: fetchConnectorTypes });
  const [step, setStep] = useState<0 | 1>(0);
  const [type, setType] = useState<ConnectorType | null>(null);
  const [name, setName] = useState("");
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null);

  const testMut = useMutation({
    mutationFn: () => testConnection({ connectorTypeKey: type!.key, config }),
    onSuccess: setTestResult,
    onError: toastError,
  });

  const saveMut = useMutation({
    mutationFn: () => createConnection({ connectorTypeKey: type!.key, name, config }),
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
