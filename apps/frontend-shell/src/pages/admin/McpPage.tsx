import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { McpServerConfig } from "@platform/contracts";
import { fetchMcpConfigReferences, fetchMcpConfigs, fetchSolverMcpServer, saveMcpConfig, testMcpConnection, type SolverMcpServerResponse } from "@/api/endpoints";
import { ReferencesPanel } from "@/components/ReferencesPanel";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";

const t = zh.admin.mcp;

/** RESOURCE-REF-NAV item⑤：status 三态着色（ACTIVE 绿 / DISABLED 中性 / ERROR 红）。 */
const mcpStatusBadge = (status: McpServerConfig["status"]) =>
  status === "ACTIVE" ? "green" : status === "ERROR" ? "red" : "";

/** MCP 服务器（B3）：CRUD + 凭据 secret 处理 + 连接测试（tools/list 发现结果） */
export default function McpPage() {
  const queryClient = useQueryClient();
  const { data: configs } = useQuery({ queryKey: ["b", "mcp-configs", {}], queryFn: fetchMcpConfigs });
  // WO-RESOURCE-REF §2.4：内置求解器 MCP server（平台内置·只读，非用户自建）。
  const { data: solverServer } = useQuery({ queryKey: ["b", "mcp-solvers-server"], queryFn: fetchSolverMcpServer });
  // RESOURCE-REF-NAV：?id= 深链
  const [params] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(params.get("id"));
  const [creating, setCreating] = useState(false);
  const [showBuiltin, setShowBuiltin] = useState(false);
  const selected = configs?.find((c) => c.id === selectedId) ?? null;
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["b", "mcp-configs"] });

  // 筛选 + 排序
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortBy, setSortBy] = useState<"createdAt" | "name" | "status">("createdAt");
  const [sortDesc, setSortDesc] = useState(true);

  const filteredConfigs = (configs ?? [])
    .filter((c) => {
      if (searchText && !c.name.toLowerCase().includes(searchText.toLowerCase())) return false;
      if (statusFilter && c.status !== statusFilter) return false;
      return true;
    })
    .sort((a, b) => {
      let cmp = 0;
      if (sortBy === "createdAt") cmp = (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
      else if (sortBy === "name") cmp = a.name.localeCompare(b.name);
      else if (sortBy === "status") cmp = a.status.localeCompare(b.status);
      return sortDesc ? -cmp : cmp;
    });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ fontSize: 16 }}>{t.title}</h2>
        <button className="btn primary sm" style={{ marginLeft: "auto" }} onClick={() => { setCreating(true); setSelectedId(null); }}>
          {zh.common.create}
        </button>
      </div>

      {/* 筛选 + 排序工具栏 */}
      <div className="panel" style={{ marginBottom: 14, padding: "10px 12px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 12px", alignItems: "center" }}>
          <span className="section-title" style={{ margin: 0, fontSize: 12 }}>筛选</span>
          <div style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
            <span className="muted">名称</span>
            <input
              data-testid="mcp-filter-name"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="搜索名称"
              style={{ width: 120, fontSize: 12 }}
            />
          </div>
          <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
            <span className="muted">状态</span>
            <select data-testid="mcp-filter-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ fontSize: 12 }}>
              <option value="">全部</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="DISABLED">DISABLED</option>
              <option value="ERROR">ERROR</option>
            </select>
          </label>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <span className="muted" style={{ fontSize: 12 }}>排序</span>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} style={{ fontSize: 12 }}>
              <option value="createdAt">创建时间</option>
              <option value="name">名称</option>
              <option value="status">状态</option>
            </select>
            <button className="btn sm" onClick={() => setSortDesc((v) => !v)} title={sortDesc ? "降序" : "升序"}>
              {sortDesc ? "↓" : "↑"}
            </button>
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
          共 {(configs ?? []).length} 个 MCP 配置 · 命中 {filteredConfigs.length} 个
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 14, alignItems: "start" }}>
        <div className="panel">
          {(configs ?? []).length === 0 && !solverServer && (
            <div className="empty-state" style={{ padding: "24px 12px" }}>
              暂无 MCP 配置——点击右上角「{zh.common.create}」新建
            </div>
          )}
          {filteredConfigs.map((c) => (
            <div
              key={c.id}
              onClick={() => { setSelectedId(c.id); setCreating(false); setShowBuiltin(false); }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                borderBottom: "1px solid var(--line, #333)",
                cursor: "pointer",
                flexWrap: "wrap",
                background: selectedId === c.id ? "var(--panel2, #1a1a2e)" : undefined,
              }}
            >
              <span className="zh" style={{ fontWeight: 500, minWidth: 100, flex: 1 }}>{c.name}</span>
              <span className={`badge ${mcpStatusBadge(c.status)}`} data-testid={`mcp-status-${c.id}`}>
                {c.status}
              </span>
              {c.credentialRef != null && (
                <span className="badge blue" data-testid={`mcp-cred-${c.id}`}>
                  已配凭据
                </span>
              )}
              <span className={`badge ${c.createdBy === "system" ? "" : "blue"}`}>{c.createdBy === "system" ? "模拟" : "实际"}</span>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>{c.createdAt?.slice(0, 10) ?? "-"}</span>
              <span style={{ fontSize: 11, color: "var(--muted2)" }}>{c.createdBy ?? "-"}</span>
            </div>
          ))}
          {filteredConfigs.length === 0 && (configs ?? []).length > 0 && (
            <div className="empty-state" style={{ padding: "24px 12px" }}>
              无匹配 MCP 配置——请调整筛选条件
            </div>
          )}
          {/* WO-RESOURCE-REF §2.4：用户自建 MCP 之下增「内置服务」分区（求解器·平台内置·READ，只读展示）。 */}
          {solverServer && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dotted var(--line, #333)" }} data-testid="mcp-builtin-section">
              <div className="section-title" style={{ fontSize: 12 }}>内置服务</div>
              <button
                className="btn"
                style={{ width: "100%", justifyContent: "flex-start", borderColor: showBuiltin ? "var(--accent)" : undefined }}
                data-testid="mcp-builtin-solvers"
                onClick={() => { setShowBuiltin(true); setSelectedId(null); setCreating(false); }}
              >
                <span className="badge">内置·READ</span>
                <span className="zh">{solverServer.server.displayName}</span>
                <span className="mono" style={{ marginLeft: "auto", fontSize: 10 }}>{solverServer.count}</span>
              </button>
            </div>
          )}
        </div>
        {showBuiltin && solverServer ? (
          <BuiltinSolverServer server={solverServer} />
        ) : (
          (selected || creating) && <McpEditor key={selected?.id ?? "new"} config={selected} onChanged={invalidate} />
        )}
      </div>
    </div>
  );
}

function McpEditor({ config, onChanged }: { config: McpServerConfig | null; onChanged: () => void }) {
  const [name, setName] = useState(config?.name ?? "");
  const [transportType, setTransportType] = useState<"streamable_http" | "stdio">(config?.transport.type ?? "streamable_http");
  const [url, setUrl] = useState(config?.transport.type === "streamable_http" ? config.transport.url : "");
  const [command, setCommand] = useState(config?.transport.type === "stdio" ? config.transport.command : "");
  const [credential, setCredential] = useState("");
  const hasSavedCredential = config?.credentialRef != null;

  const saveMut = useMutation({
    mutationFn: () =>
      saveMcpConfig(config?.id ?? null, {
        name,
        transport: transportType === "streamable_http" ? { type: "streamable_http", url } : { type: "stdio", command, args: [] },
        // secret：留空 = 不修改；填写 = 更新（API 永不回显）
        ...(credential ? { credential } : {}),
        status: config?.status ?? "ACTIVE",
      }),
    onSuccess: () => {
      toast("已保存", "success");
      setCredential("");
      onChanged();
    },
    onError: toastError,
  });

  const testMut = useMutation({
    mutationFn: () => testMcpConnection(config!.id),
    onError: toastError,
  });

  // RESOURCE-REF-NAV：被引用只读区（哪些 agent/workflow 用了本 MCP 服务器）
  const refsQuery = useQuery({
    queryKey: ["b", "mcp-references", config?.id],
    queryFn: () => fetchMcpConfigReferences(config!.id),
    enabled: config != null,
  });

  return (
    <div className="panel">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label>
          名称
          <input style={{ width: "100%" }} value={name} aria-label="MCP 名称" onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          transport
          <select value={transportType} aria-label="transport" onChange={(e) => setTransportType(e.target.value as typeof transportType)}>
            <option value="streamable_http">streamable_http</option>
            <option value="stdio">stdio</option>
          </select>
        </label>
        {transportType === "streamable_http" ? (
          <label>
            url
            <input style={{ width: "100%" }} value={url} aria-label="url" onChange={(e) => setUrl(e.target.value)} />
          </label>
        ) : (
          <label>
            command
            <input style={{ width: "100%" }} value={command} aria-label="command" onChange={(e) => setCommand(e.target.value)} />
          </label>
        )}
        <label>
          凭据 <span className="badge amber">secret</span>
          <input
            type="password"
            autoComplete="new-password"
            style={{ width: "100%" }}
            placeholder={hasSavedCredential ? "******（已保存，不回显）" : ""}
            value={credential}
            aria-label="凭据"
            onChange={(e) => setCredential(e.target.value)}
          />
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn primary sm" disabled={!name || saveMut.isPending} onClick={() => saveMut.mutate()}>
            {zh.common.save}
          </button>
          {config && (
            <button className="btn sm" disabled={testMut.isPending} onClick={() => testMut.mutate()} data-testid="mcp-test">
              {t.test}
            </button>
          )}
        </div>
        {testMut.data && (
          <div data-testid="mcp-tools">
            <div className="section-title">{t.discoveredTools}</div>
            {testMut.data.tools.map((tool) => (
              <div key={tool.name} style={{ fontSize: 12, padding: "3px 0" }}>
                <span className="mono">{tool.name}</span>
                <span style={{ color: "var(--muted)", marginLeft: 8 }}>{tool.description}</span>
              </div>
            ))}
          </div>
        )}
        {config && <ReferencesPanel testId="mcp-references" loading={refsQuery.isLoading} references={refsQuery.data?.references} />}
      </div>
    </div>
  );
}

/** WO-RESOURCE-REF §2.4：内置求解器 MCP server 只读视图——列 mcp__solvers__* 工具（不给编辑/删除，内置）。 */
function BuiltinSolverServer({ server }: { server: SolverMcpServerResponse }) {
  return (
    <div className="panel" data-testid="mcp-builtin-detail">
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <span className="badge">内置·READ</span>
        <strong className="zh">{server.server.displayName}</strong>
        <span className="mono" style={{ fontSize: 11, color: "var(--muted2)" }}>{server.server.name}</span>
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 10 }}>
        平台内置服务，只读（求解器目录经 entitlement 过滤自动派生；关求解器功能 → 工具消失）。求解器即 MCP 的一种，被 agent/skill/workflow 引用。
      </div>
      <div className="section-title">工具（mcp__solvers__*）· {server.count}</div>
      <div data-testid="mcp-builtin-tools">
        {server.tools.map((tool) => (
          <div key={tool.name} style={{ fontSize: 12, padding: "3px 0" }}>
            <span className="mono">{tool.name}</span>
            <span style={{ color: "var(--muted)", marginLeft: 8 }}>{tool.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
