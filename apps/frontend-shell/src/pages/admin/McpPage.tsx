import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MCP_CONFIG_NOTES, MCP_SERVER_NAME_RE, mcpServerNameSlug, type McpServerConfig } from "@platform/contracts";
import { fetchMcpConfigs, saveMcpConfig, testMcpConnection } from "@/api/endpoints";
import { MCP_ORIGIN_BASIS, MCP_ORIGIN_LABEL, mcpNamespaceOf, mcpNamespaceWildcard, mcpOriginOf } from "@/api/mcpNamespace";
import { toast, toastError } from "@/store/toastStore";
import ReferencesPanel from "@/components/ReferencesPanel";
import zh from "@/locales/zh";

const t = zh.admin.mcp;

/**
 * MCP 服务器（B3）：CRUD + 凭据 secret 处理 + 连接测试（tools/list 发现结果）。
 *
 * WO-DSH-CONFIG-SURFACE：本页同时是 **DSH 原生 MCP 面**的管理口 —— 模型真正看见的名字是
 * `mcp__{serverName}__{toolName}`（scopeDeclaration 与审计同用全名），而此前屏上只有「名称 + 凭据」，
 * 于是「这条配置占用哪个命名空间」「它是平台内置还是租户自建」两个问题在屏上都答不出来。
 * 本页把这两件事显式化；判据/回落规则一律取自契约（`mcpToolFullName` / `mcpServerNameSlug`），
 * 契约里取不到的（如「是不是平台内置」没有字段）如实标注判据，不发明字段。
 */
export default function McpPage() {
  const queryClient = useQueryClient();
  const { data: configs } = useQuery({ queryKey: ["b", "mcp-configs", {}], queryFn: fetchMcpConfigs });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const selected = configs?.find((c) => c.id === selectedId) ?? null;
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["b", "mcp-configs"] });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ fontSize: 16 }}>{t.title}</h2>
        <button className="btn primary sm" style={{ marginLeft: "auto" }} onClick={() => { setCreating(true); setSelectedId(null); }}>
          {zh.common.create}
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 14, alignItems: "start" }}>
        <div className="panel">
          {(configs ?? []).map((c) => {
            const ns = mcpNamespaceOf(c);
            return (
              <button
                key={c.id}
                data-testid={`mcp-row-${c.id}`}
                className="btn"
                style={{ width: "100%", marginBottom: 6, display: "block", textAlign: "left", borderColor: selectedId === c.id ? "var(--accent)" : undefined }}
                onClick={() => { setSelectedId(c.id); setCreating(false); }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className={`badge ${c.status === "ACTIVE" ? "green" : ""}`} data-testid={`mcp-row-status-${c.id}`}>{c.status}</span>
                  <span className="zh">{c.name}</span>
                </span>
                {/* 命名空间前缀：模型/scopeDeclaration/审计三处共用的全名形态 */}
                <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                  <span className="mono" data-testid={`mcp-row-namespace-${c.id}`}>{ns.wildcard}</span>
                  <span className="badge" data-testid={`mcp-row-origin-${c.id}`} title={MCP_ORIGIN_BASIS}>{MCP_ORIGIN_LABEL[mcpOriginOf(c)]}</span>
                </span>
              </button>
            );
          })}
        </div>
        {(selected || creating) && <McpEditor key={selected?.id ?? "new"} config={selected} onChanged={invalidate} />}
      </div>
    </div>
  );
}

/**
 * DSH 原生面只读区：命名空间标识 / 前缀 / 来源 / 状态。
 * 值全部来自下发数据 + 契约函数，**没有任何前端自造的字段**；取不到的显式标「未下发」。
 */
function DshSurface({ config, draftName }: { config: McpServerConfig | null; draftName: string }) {
  // 新建态没有配置行：服务端在创建时按展示名推导并校验（租户内唯一），故这里只做同规则的**预览**。
  const draftSlug = config ? "" : mcpServerNameSlug(draftName);
  const ns = config ? mcpNamespaceOf(config) : null;
  const wildcard = config ? ns!.wildcard : draftName ? mcpNamespaceWildcard(draftSlug) : "—";
  const origin = config ? mcpOriginOf(config) : null;
  const draftValid = MCP_SERVER_NAME_RE.test(draftSlug);

  return (
    <div className="panel" style={{ marginBottom: 10 }} data-testid="mcp-dsh-surface">
      <div className="section-title">DSH 原生面（命名空间）</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color: "var(--muted)", minWidth: 132 }}>命名空间标识 serverName</span>
          {config ? (
            <>
              <span className="mono" data-testid="mcp-server-name">{ns!.serverName}</span>
              {/* 契约上 serverName 是可选字段：旧记录缺席。缺席时屏上给出的值是**按服务端同一条回落
                  规则**算的，必须标出来，不许画成「后端下发了」。 */}
              <span className={`badge ${ns!.downlinked ? "green" : "amber"}`} data-testid="mcp-server-name-source">
                {ns!.downlinked ? "后端已下发" : "未下发·运行时按展示名推导"}
              </span>
            </>
          ) : (
            <span style={{ color: "var(--muted)" }} data-testid="mcp-server-name">保存时由服务端推导（租户内唯一）</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color: "var(--muted)", minWidth: 132 }}>工具全名前缀</span>
          <span className="mono" data-testid="mcp-namespace-wildcard">{wildcard}</span>
          {!config && draftName && !draftValid && (
            <span className="badge amber" data-testid="mcp-draft-namespace-invalid">展示名推不出合法标识（只允许小写字母、数字、下划线，2–24 字符）</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color: "var(--muted)", minWidth: 132 }}>来源</span>
          <span className="badge" data-testid="mcp-origin">{origin ? MCP_ORIGIN_LABEL[origin] : "保存后按配置行 id 判定"}</span>
          <span style={{ color: "var(--muted)" }} data-testid="mcp-origin-basis">{MCP_ORIGIN_BASIS}</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color: "var(--muted)", minWidth: 132 }}>状态</span>
          <span className="badge" data-testid="mcp-status">{config ? config.status : "—"}</span>
          {config && (
            <span style={{ color: "var(--muted)" }} data-testid="mcp-lifecycle">
              {config.lifecycle ?? "（未下发）"} · v{config.version ?? "—"}
            </span>
          )}
        </div>
        {/* §4.4 边界声明：本期 tools-only / 静态 bearer —— 由后端下发（GET /b/v1/mcp-configs/notes） */}
        <div style={{ color: "var(--muted)", borderTop: "1px solid var(--border)", paddingTop: 6 }}>
          {MCP_CONFIG_NOTES.capabilities} {MCP_CONFIG_NOTES.credentials}
        </div>
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

  return (
    <div className="panel">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <DshSurface config={config} draftName={name} />
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
        {/* WO-REFERENCES-FAMILY（`GET /b/v1/mcp-configs/:id/references`）：
            改/停一个 MCP 配置，会打断哪些 Agent 与流程。新建态（config==null）没有 id 可查，故不渲染。 */}
        {config && <ReferencesPanel kind="mcp-config" id={config.id} />}
        {testMut.data && (
          <div data-testid="mcp-tools">
            <div className="section-title">{t.discoveredTools}</div>
            {/* 发现结果给的是 server 上的**裸工具名**；模型看见的是加了命名空间的全名，故并排给出。 */}
            {testMut.data.tools.map((tool) => (
              <div key={tool.name} style={{ fontSize: 12, padding: "3px 0" }}>
                <span className="mono" data-testid={`mcp-tool-full-${tool.name}`}>
                  {config ? `mcp__${mcpNamespaceOf(config).serverName}__${tool.name}` : tool.name}
                </span>
                <span style={{ color: "var(--muted)", marginLeft: 8 }}>{tool.description}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
