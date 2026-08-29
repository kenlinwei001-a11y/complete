import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { McpServerConfig } from "@platform/contracts";
import { fetchMcpConfigs, saveMcpConfig, testMcpConnection } from "@/api/endpoints";
import { toast, toastError } from "@/store/toastStore";
import ReferencesPanel from "@/components/ReferencesPanel";
import zh from "@/locales/zh";

const t = zh.admin.mcp;

/** MCP 服务器（B3）：CRUD + 凭据 secret 处理 + 连接测试（tools/list 发现结果） */
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
          {(configs ?? []).map((c) => (
            <button key={c.id} className="btn" style={{ width: "100%", marginBottom: 6, justifyContent: "flex-start", borderColor: selectedId === c.id ? "var(--accent)" : undefined }} onClick={() => { setSelectedId(c.id); setCreating(false); }}>
              <span className={`badge ${c.status === "ACTIVE" ? "green" : ""}`}>{c.status}</span>
              <span className="zh">{c.name}</span>
            </button>
          ))}
        </div>
        {(selected || creating) && <McpEditor key={selected?.id ?? "new"} config={selected} onChanged={invalidate} />}
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
            {testMut.data.tools.map((tool) => (
              <div key={tool.name} style={{ fontSize: 12, padding: "3px 0" }}>
                <span className="mono">{tool.name}</span>
                <span style={{ color: "var(--muted)", marginLeft: 8 }}>{tool.description}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
