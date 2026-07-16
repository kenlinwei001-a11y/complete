import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConnectorType } from "@platform/contracts";
import { classifySourceOrigin } from "@platform/contracts";
import {
  createConnection,
  downloadAllRawDatasets,
  downloadRawDataset,
  fetchConnections,
  fetchConnectorCategories,
  fetchConnectorTypes,
  fetchDataHealth,
  fetchIntakeCoverage,
  fetchQuarantine,
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

/** 数据接入控制台（PRD §7.4）：双 Tab 行模式（连接维度 / 数据集维度）+ 新建向导 + 文件上传卡 + 同步轮询 */
export default function ConnectionsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"connection" | "dataset">("connection");

  const { data: connections } = useQuery({ queryKey: ["a", "connections", {}], queryFn: fetchConnections });
  const { data: catData } = useQuery({ queryKey: ["a", "connector-categories"], queryFn: fetchConnectorCategories });

  // 页面级统一查询：供两个 Tab 摊平使用（替代原先每个连接各自发请求）
  const dsQ = useQuery({ queryKey: ["a", "raw-datasets"], queryFn: () => fetchRawDatasets() });
  const qQ = useQuery({ queryKey: ["a", "quarantine"], queryFn: fetchQuarantine });
  const covQ = useQuery({ queryKey: ["a", "intake-coverage"], queryFn: fetchIntakeCoverage, staleTime: 60_000 });

  // 连接维度筛选状态
  const [catFilter, setCatFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [nameFilter, setNameFilter] = useState<string>("");
  const [sortBy, setSortBy] = useState<"createdAt" | "lastSyncAt" | "name">("createdAt");
  const [sortDesc, setSortDesc] = useState(true);

  // 数据集维度筛选状态
  const [dsNameFilter, setDsNameFilter] = useState("");
  const [dsTypeFilter, setDsTypeFilter] = useState("");
  const [dsOriginFilter, setDsOriginFilter] = useState("");
  const [dsSortBy, setDsSortBy] = useState<"name" | "rowCount" | "syncedAt">("name");
  const [dsSortDesc, setDsSortDesc] = useState(true);

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

  // 提取所有连接类型用于筛选下拉
  const connectorTypes = Array.from(new Set((connections ?? []).map((c) => c.connectorTypeKey))).sort();

  // 连接维度：筛选+排序
  const filteredConnections = (connections ?? [])
    .filter((c) => {
      if (catFilter && c.category !== catFilter) return false;
      if (statusFilter && c.status !== statusFilter) return false;
      if (typeFilter && c.connectorTypeKey !== typeFilter) return false;
      if (nameFilter && !c.name.toLowerCase().includes(nameFilter.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      let valA: string | number = "";
      let valB: string | number = "";
      if (sortBy === "name") { valA = a.name; valB = b.name; }
      else if (sortBy === "lastSyncAt") { valA = a.lastSyncAt ?? ""; valB = b.lastSyncAt ?? ""; }
      else { valA = a.createdAt ?? a.lastSyncAt ?? ""; valB = b.createdAt ?? b.lastSyncAt ?? ""; }
      if (valA < valB) return sortDesc ? 1 : -1;
      if (valA > valB) return sortDesc ? -1 : 1;
      return 0;
    });

  // 数据集维度：筛选+排序
  const allDatasets = dsQ.data ?? [];
  const connMap = Object.fromEntries((connections ?? []).map((c) => [c.id, c]));
  const filteredDatasets = allDatasets
    .filter((d) => {
      const conn = d.sourceConnId ? connMap[d.sourceConnId] : undefined;
      if (dsNameFilter && !d.name.toLowerCase().includes(dsNameFilter.toLowerCase())) return false;
      if (dsTypeFilter && conn?.connectorTypeKey !== dsTypeFilter) return false;
      if (dsOriginFilter) {
        const origin = conn ? classifySourceOrigin(conn.connectorTypeKey, conn.config as Record<string, unknown>) : "real-sourced";
        if (origin !== dsOriginFilter) return false;
      }
      return true;
    })
    .sort((a, b) => {
      let valA: string | number = "";
      let valB: string | number = "";
      if (dsSortBy === "name") { valA = a.name; valB = b.name; }
      else if (dsSortBy === "rowCount") { valA = a.rowCount ?? 0; valB = b.rowCount ?? 0; }
      else { valA = a.syncedAt ?? ""; valB = b.syncedAt ?? ""; }
      if (valA < valB) return dsSortDesc ? 1 : -1;
      if (valA > valB) return dsSortDesc ? -1 : 1;
      return 0;
    });

  // 按 connId 预计算聚合（连接维度表格用）
  const dsByConn = new Map<string, typeof allDatasets>();
  for (const d of allDatasets) {
    const cid = d.sourceConnId ?? "";
    if (!dsByConn.has(cid)) dsByConn.set(cid, []);
    dsByConn.get(cid)!.push(d);
  }
  const qRows = qQ.data ?? [];
  const qByConn = new Map<string, number>();
  for (const q of qRows) {
    qByConn.set(q.connId, (qByConn.get(q.connId) ?? 0) + 1);
  }
  // 字段映射进度：按 connId 统计 mapped / total
  const covItems = covQ.data?.items ?? [];
  const covByConn = new Map<string, { mapped: number; total: number }>();
  for (const item of covItems) {
    for (const b of item.connector.bindings) {
      const prev = covByConn.get(b.connId) ?? { mapped: 0, total: 0 };
      prev.mapped += b.mapped.length;
      prev.total += item.intakeTotal;
      covByConn.set(b.connId, prev);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <h2 style={{ fontSize: 16 }}>{t.title}</h2>
        <button
          className="btn sm"
          style={{ marginLeft: "auto" }}
          data-testid="export-all-source-xlsx"
          title={t.exportAllHint}
          onClick={() => void downloadAllRawDatasets().catch(toastError)}
        >
          {t.exportAllXlsx}
        </button>
        <button className="btn primary sm" onClick={() => setWizardOpen(true)}>
          {t.newConnection}
        </button>
      </div>

      <DataCategoriesPanel />

      <UploadCard onDone={(connId) => navigate(`/admin/connections/${connId}/schema`)} />

      {/* §7.22 健康度汇总条 */}
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

      {/* Tab 切换 */}
      <div style={{ display: "flex", gap: 4, marginTop: 14, marginBottom: 10 }}>
        <button className={`btn sm ${tab === "connection" ? "primary" : ""}`} onClick={() => setTab("connection")}>连接维度</button>
        <button className={`btn sm ${tab === "dataset" ? "primary" : ""}`} onClick={() => setTab("dataset")}>数据集维度</button>
      </div>

      {/* 筛选+排序工具栏（按 Tab 切换内容） */}
      <div className="panel" style={{ padding: "10px 12px" }}>
        {tab === "connection" ? (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 12px", alignItems: "center" }}>
              <span className="section-title" style={{ margin: 0, fontSize: 12 }}>筛选</span>
              <div style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                <span className="muted">名称</span>
                <input data-testid="conn-filter-name" value={nameFilter} onChange={(e) => setNameFilter(e.target.value)} placeholder="搜索名称" style={{ width: 120, fontSize: 12 }} />
              </div>
              {(catData?.categories.length ?? 0) > 0 && (
                <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                  <span className="muted">归类</span>
                  <select data-testid="conn-cat-filter" value={catFilter} onChange={(e) => setCatFilter(e.target.value)} style={{ fontSize: 12 }}>
                    <option value="">全部</option>
                    {catData!.categories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </label>
              )}
              <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                <span className="muted">状态</span>
                <select data-testid="conn-status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ fontSize: 12 }}>
                  <option value="">全部</option>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="ERROR">ERROR</option>
                  <option value="DISABLED">DISABLED</option>
                </select>
              </label>
              {connectorTypes.length > 0 && (
                <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                  <span className="muted">类型</span>
                  <select data-testid="conn-type-filter" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ fontSize: 12 }}>
                    <option value="">全部</option>
                    {connectorTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
              )}
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                <span className="muted" style={{ fontSize: 12 }}>排序</span>
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} style={{ fontSize: 12 }}>
                  <option value="createdAt">创建时间</option>
                  <option value="lastSyncAt">最后同步</option>
                  <option value="name">名称</option>
                </select>
                <button className="btn sm" onClick={() => setSortDesc((v) => !v)} title={sortDesc ? "降序" : "升序"}>{sortDesc ? "↓" : "↑"}</button>
              </div>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
              共 {(connections ?? []).length} 个连接 · 命中 {filteredConnections.length} 个
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 12px", alignItems: "center" }}>
              <span className="section-title" style={{ margin: 0, fontSize: 12 }}>筛选</span>
              <div style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                <span className="muted">数据集名</span>
                <input data-testid="ds-filter-name" value={dsNameFilter} onChange={(e) => setDsNameFilter(e.target.value)} placeholder="搜索数据集" style={{ width: 120, fontSize: 12 }} />
              </div>
              {connectorTypes.length > 0 && (
                <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                  <span className="muted">连接类型</span>
                  <select data-testid="ds-type-filter" value={dsTypeFilter} onChange={(e) => setDsTypeFilter(e.target.value)} style={{ fontSize: 12 }}>
                    <option value="">全部</option>
                    {connectorTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
              )}
              <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                <span className="muted">来源</span>
                <select data-testid="ds-origin-filter" value={dsOriginFilter} onChange={(e) => setDsOriginFilter(e.target.value)} style={{ fontSize: 12 }}>
                  <option value="">全部</option>
                  <option value="real-sourced">真实接入</option>
                  <option value="synthetic">合成</option>
                </select>
              </label>
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                <span className="muted" style={{ fontSize: 12 }}>排序</span>
                <select value={dsSortBy} onChange={(e) => setDsSortBy(e.target.value as typeof dsSortBy)} style={{ fontSize: 12 }}>
                  <option value="name">名称</option>
                  <option value="rowCount">行数</option>
                  <option value="syncedAt">最后同步</option>
                </select>
                <button className="btn sm" onClick={() => setDsSortDesc((v) => !v)} title={dsSortDesc ? "降序" : "升序"}>{dsSortDesc ? "↓" : "↑"}</button>
              </div>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
              共 {allDatasets.length} 张数据集 · 命中 {filteredDatasets.length} 张
            </div>
          </>
        )}
      </div>

      {/* Tab 内容区 */}
      {tab === "connection" ? (
        <ConnectionDimensionTable
          connections={filteredConnections}
          healthOf={healthOf}
          dsByConn={dsByConn}
          qByConn={qByConn}
          covByConn={covByConn}
          onSync={(connId) =>
            void triggerSync(connId)
              .then((r) => setSyncJobId(r.syncJobId))
              .catch(toastError)
          }
        />
      ) : (
        <DatasetDimensionTable
          datasets={filteredDatasets}
          connMap={connMap}
        />
      )}

      {syncJobId && syncJob && (
        <div className="panel" style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }} data-testid="sync-job-status">
          <span className={`badge ${syncJob.status === "SUCCEEDED" ? "green" : syncJob.status === "FAILED" ? "red" : "blue"}`}>
            {syncJob.status}
          </span>
          {syncJob.status === "RUNNING" && <span>{t.syncRunning}</span>}
          <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
            {Object.entries(syncJob.rowCounts).map(([k, v]) => `${k}:${v}`).join(" · ")}
          </span>
        </div>
      )}

      {wizardOpen && (
        <ConnectionWizard
          onClose={() => setWizardOpen(false)}
          onCreated={() => {
            setWizardOpen(false);
            void queryClient.invalidateQueries({ queryKey: ["a", "connections"] });
            void queryClient.invalidateQueries({ queryKey: ["a", "connector-categories"] });
            void queryClient.invalidateQueries({ queryKey: ["a", "raw-datasets"] });
            void queryClient.invalidateQueries({ queryKey: ["a", "quarantine"] });
            void queryClient.invalidateQueries({ queryKey: ["a", "intake-coverage"] });
          }}
        />
      )}
    </div>
  );
}

/** 连接维度表格：一行一个连接，摊平连接本体 + 数据集汇总 + 隔离区 + 字段映射进度 */
function ConnectionDimensionTable({
  connections,
  healthOf,
  dsByConn,
  qByConn,
  covByConn,
  onSync,
}: {
  connections: Array<{ id: string; name: string; connectorTypeKey: string; category?: string; status: string; lastSyncAt?: string; lastError?: string; createdAt?: string; config?: Record<string, unknown> }>;
  healthOf: (connId: string) => { status: "OK" | "DOWN" | "DELAYED"; latencyMin: number } | undefined;
  dsByConn: Map<string, Array<{ id: string; name: string; rowCount?: number; fields?: { name: string; inferredType: string }[]; watermark?: string; syncedAt?: string }>>;
  qByConn: Map<string, number>;
  covByConn: Map<string, { mapped: number; total: number }>;
  onSync: (connId: string) => void;
}) {
  if (connections.length === 0) {
    return (
      <EmptyState message={zh.admin.empty.connections}>
        <button className="btn primary sm" onClick={() => {}} data-testid="cta-connection">{zh.admin.empty.connectionsCta}</button>
      </EmptyState>
    );
  }
  return (
    <div style={{ marginTop: 12 }}>
      <table className="cmp" data-testid="conn-dim-table" style={{ fontSize: 11.5 }}>
        <thead>
          <tr>
            <th>名称</th><th>类型</th><th>归类</th><th>来源</th><th>状态</th><th>健康度</th><th>最后同步</th><th>数据集</th><th>行数</th><th>增量(CDC)</th><th>隔离</th><th>映射进度</th><th></th>
          </tr>
        </thead>
        <tbody>
          {connections.map((c) => {
            const ds = dsByConn.get(c.id) ?? [];
            const qCount = qByConn.get(c.id) ?? 0;
            const cov = covByConn.get(c.id);
            const h = healthOf(c.id);
            const origin = classifySourceOrigin(c.connectorTypeKey, c.config as Record<string, unknown> | undefined);
            const statusColor = c.status === "ACTIVE" ? "var(--c-capacity,#36BFA5)" : c.status === "ERROR" ? "var(--danger,#E5484D)" : "var(--muted)";
            return (
              <tr key={c.id} data-testid={`conn-dim-row-${c.id}`}>
                <td><Link to={`/admin/connections/${c.id}/schema`} style={{ fontWeight: 600 }}>{c.name}</Link></td>
                <td className="mono" style={{ fontSize: 10.5, color: "var(--muted2)" }}>{c.connectorTypeKey}</td>
                <td>{c.category ? <span className="badge">{c.category}</span> : "—"}</td>
                <td>
                  <span className="badge" style={{ color: origin === "synthetic" ? "var(--amber,#DD9551)" : "var(--c-capacity,#36BFA5)", borderColor: origin === "synthetic" ? "var(--amber,#DD9551)" : "var(--c-capacity,#36BFA5)" }}>
                    {origin === "synthetic" ? "synthetic" : "real"}
                  </span>
                </td>
                <td><span style={{ color: statusColor }}>{c.status}</span></td>
                <td>
                  {h ? (
                    <span>
                      <span className={`badge ${h.status === "OK" ? "green" : h.status === "DELAYED" ? "amber" : "red"}`}>{healthStatusLabel(h.status)}</span>
                      <span className="mono" style={{ color: "var(--muted2)", marginLeft: 4, fontSize: 10.5 }}>{(h.latencyMin / 60).toFixed(1)}h</span>
                    </span>
                  ) : "—"}
                </td>
                <td className="mono" style={{ fontSize: 10.5 }}>{c.lastSyncAt ? c.lastSyncAt.slice(0, 16).replace("T", " ") : "—"}</td>
                <td>{ds.length}</td>
                <td>{ds.reduce((a, d) => a + (d.rowCount ?? 0), 0).toLocaleString()}</td>
                <td style={{ color: ds.filter((d) => !!d.watermark).length > 0 ? "var(--c-capacity,#36BFA5)" : "var(--muted)" }}>
                  {ds.filter((d) => !!d.watermark).length > 0 ? `${ds.filter((d) => !!d.watermark).length} 增量` : "全量"}
                </td>
                <td style={{ color: qCount > 0 ? "var(--danger,#E5484D)" : "var(--muted)" }}>{qCount > 0 ? `${qCount} 行` : "0"}</td>
                <td>
                  {cov ? (
                    <span className={`badge ${cov.mapped >= cov.total ? "green" : "amber"}`} style={{ fontSize: 10.5 }}>
                      {cov.mapped}/{cov.total}
                    </span>
                  ) : "—"}
                </td>
                <td>
                  <button className="btn sm" data-testid={`conn-sync-${c.id}`} onClick={() => onSync(c.id)}>↻ 同步</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 数据集维度表格：一行一个数据集，摊平数据集本体 + 所属连接信息 */
function DatasetDimensionTable({
  datasets,
  connMap,
}: {
  datasets: Array<{ id: string; name: string; sourceConnId?: string; rowCount?: number; fields?: { name: string; inferredType: string }[]; watermark?: string; syncedAt?: string }>;
  connMap: Record<string, { id: string; name: string; connectorTypeKey: string; config?: Record<string, unknown> }>;
}) {
  if (datasets.length === 0) {
    return <div className="empty-state" style={{ padding: "24px 12px" }}>暂无数据集</div>;
  }
  return (
    <div style={{ marginTop: 12 }}>
      <table className="cmp" data-testid="ds-dim-table" style={{ fontSize: 11.5 }}>
        <thead>
          <tr>
            <th>数据集名</th><th>所属连接</th><th>连接类型</th><th>来源</th><th>行数</th><th>字段数</th><th>水位</th><th>最后同步</th><th></th>
          </tr>
        </thead>
        <tbody>
          {datasets.map((d) => {
            const conn = d.sourceConnId ? connMap[d.sourceConnId] : undefined;
            const origin = conn ? classifySourceOrigin(conn.connectorTypeKey, conn.config as Record<string, unknown> | undefined) : "real-sourced";
            return (
              <tr key={d.id} data-testid={`ds-dim-row-${d.id}`}>
                <td className="mono" style={{ fontWeight: 600, fontSize: 12 }}>{d.name}</td>
                <td>{conn ? <Link to={`/admin/connections/${conn.id}/schema`}>{conn.name}</Link> : "—"}</td>
                <td className="mono" style={{ fontSize: 10.5, color: "var(--muted2)" }}>{conn?.connectorTypeKey ?? "—"}</td>
                <td>
                  <span className="badge" style={{ color: origin === "synthetic" ? "var(--amber,#DD9551)" : "var(--c-capacity,#36BFA5)", borderColor: origin === "synthetic" ? "var(--amber,#DD9551)" : "var(--c-capacity,#36BFA5)" }}>
                    {origin === "synthetic" ? "synthetic" : "real"}
                  </span>
                </td>
                <td>{typeof d.rowCount === "number" ? d.rowCount.toLocaleString() : "—"}</td>
                <td>{d.fields?.length ?? "—"}</td>
                <td style={{ color: d.watermark ? "var(--c-capacity,#36BFA5)" : "var(--muted)" }}>{d.watermark ? "有" : "无"}</td>
                <td className="mono" style={{ fontSize: 10.5 }}>{d.syncedAt ? d.syncedAt.slice(0, 16).replace("T", " ") : "—"}</td>
                <td>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button className="btn sm" onClick={() => void downloadRawDataset(d.id, "xlsx").catch(toastError)}>Excel</button>
                    <button className="btn sm" onClick={() => void downloadRawDataset(d.id, "csv").catch(toastError)}>CSV</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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

/** 单行连接卡片：展示核心字段 + 操作按钮 */
function ConnectionRow({
  conn,
  health,
  onSync,
}: {
  conn: { id: string; name: string; connectorTypeKey: string; category?: string; status: string; lastSyncAt?: string; lastError?: string; createdAt?: string };
  health?: { status: "OK" | "DOWN" | "DELAYED"; latencyMin: number };
  onSync: () => void;
}) {
  return (
    <div
      className="panel"
      style={{
        marginBottom: 8,
        padding: "10px 12px",
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 12,
        alignItems: "center",
      }}
      data-testid={`conn-row-${conn.id}`}
    >
      <div style={{ display: "grid", gap: 6 }}>
        {/* 第一行：名称 + 类型 + 归类 */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Link to={`/admin/connections/${conn.id}/schema`} style={{ fontWeight: 600 }}>
            {conn.name}
          </Link>
          <span className="mono" style={{ fontSize: 11, color: "var(--muted2)" }}>
            {conn.connectorTypeKey}
          </span>
          {conn.category && <span className="badge">{conn.category}</span>}
        </div>

        {/* 第二行：状态 + 健康度 + 时间 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 11.5 }}>
          <span
            className={`badge ${conn.status === "ACTIVE" ? "green" : conn.status === "ERROR" ? "red" : ""}`}
            data-testid={`conn-status-${conn.id}`}
          >
            {conn.status}
          </span>

          {health ? (
            <span data-testid={`conn-health-${conn.id}`}>
              <span className={`badge ${health.status === "OK" ? "green" : health.status === "DELAYED" ? "amber" : "red"}`}>
                {healthStatusLabel(health.status)}
              </span>
              <span className="mono" style={{ color: "var(--muted2)", marginLeft: 4 }}>
                {(health.latencyMin / 60).toFixed(1)}h
              </span>
            </span>
          ) : (
            <span className="muted">—</span>
          )}

          <span className="muted">
            最后同步: {conn.lastSyncAt ? conn.lastSyncAt.slice(0, 16).replace("T", " ") : "—"}
          </span>

          {conn.createdAt && (
            <span className="muted" style={{ fontSize: 11 }}>
              创建: {conn.createdAt.slice(0, 16).replace("T", " ")}
            </span>
          )}
        </div>

        {/* 错误信息 */}
        {conn.lastError && (
          <div style={{ fontSize: 11.5, color: "var(--danger)" }} data-testid={`conn-error-${conn.id}`}>
            {conn.lastError}
          </div>
        )}
      </div>

      {/* 操作按钮 */}
      <div style={{ display: "flex", gap: 6 }}>
        <button className="btn sm" onClick={onSync} data-testid={`conn-sync-${conn.id}`}>
          {t.syncNow}
        </button>
      </div>
    </div>
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
        {/* INTAKE-XLSX-EXPORT：仅本连接的全部数据集导出一张多 sheet Excel（?connId=）。 */}
        {list.length > 0 && (
          <button
            className="btn sm"
            data-testid={`conn-export-xlsx-${connId}`}
            title={t.exportAllHint}
            onClick={() => void downloadAllRawDatasets(connId).catch(toastError)}
          >
            {t.exportConnXlsx}
          </button>
        )}
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
