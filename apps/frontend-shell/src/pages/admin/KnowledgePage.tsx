import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { KbHit } from "@platform/contracts";
import { fetchConnections, fetchKbDocs, searchKb } from "@/api/endpoints";

/**
 * WO-KB-UI（G-VIS-1 · S4 知识库前端落地）：补 IPO 断层——后端 kb.ts + 路由齐备（/kb/:connId/docs 列表、
 * /kb/search 语义检索），但此前前端零页零绑定，灌进去的文档完全看不到。本页只读消费：
 * 左侧知识库（knowledge_base 连接）列表 → 选中见其文档表 + 页内语义搜索（前端所见=后端真值·R13 可溯源）。
 */
export default function KnowledgePage() {
  const { data: conns, isLoading: connLoading } = useQuery({ queryKey: ["a", "connections", { view: "kb" }], queryFn: fetchConnections });
  const kbConns = useMemo(() => (conns ?? []).filter((c) => c.connectorTypeKey === "knowledge_base"), [conns]);
  const [selected, setSelected] = useState<string | null>(null);
  const activeConnId = selected ?? kbConns[0]?.id ?? null;

  // 筛选 + 排序
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortBy, setSortBy] = useState<"createdAt" | "name" | "status">("createdAt");
  const [sortDesc, setSortDesc] = useState(true);

  const filteredConns = kbConns
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
    <div data-testid="knowledge-page">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>知识库（S4）</h2>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>建 knowledge_base 连接 + 灌文档 → 此处看文档并语义搜索（前端所见=后端真值）</span>
      </div>

      {/* 筛选 + 排序工具栏 */}
      {kbConns.length > 0 && (
        <div className="panel" style={{ marginBottom: 14, padding: "10px 12px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 12px", alignItems: "center" }}>
            <span className="section-title" style={{ margin: 0, fontSize: 12 }}>筛选</span>
            <div style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
              <span className="muted">名称</span>
              <input
                data-testid="kb-filter-name"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="搜索名称"
                style={{ width: 120, fontSize: 12 }}
              />
            </div>
            <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
              <span className="muted">状态</span>
              <select data-testid="kb-filter-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ fontSize: 12 }}>
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
            共 {kbConns.length} 个知识库连接 · 命中 {filteredConns.length} 个
          </div>
        </div>
      )}

      {connLoading && <div style={{ color: "var(--muted2)" }}>加载中…</div>}
      {!connLoading && kbConns.length === 0 && (
        <div className="empty-state" data-testid="kb-empty">
          暂无知识库连接——在「连接器与上传」建一个 knowledge_base 连接并灌入文档（md/txt/pdf/docx）后，此处显文档并可语义搜索。
        </div>
      )}

      {kbConns.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 14 }}>
          <div className="panel" data-testid="kb-conn-list">
            <div className="section-title">知识库</div>
            {filteredConns.map((c) => (
              <div
                key={c.id}
                data-testid={`kb-conn-${c.id}`}
                onClick={() => setSelected(c.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  borderBottom: "1px solid var(--line, #333)",
                  cursor: "pointer",
                  flexWrap: "wrap",
                  borderLeft: c.id === activeConnId ? "3px solid var(--accent)" : undefined,
                  fontWeight: c.id === activeConnId ? 600 : undefined,
                }}
              >
                <span className="zh" style={{ fontWeight: 500, minWidth: 100, flex: 1 }}>{c.name}</span>
                <span className={`badge ${c.status === "ACTIVE" ? "green" : c.status === "ERROR" ? "red" : ""}`}>{c.status}</span>
                <span className={`badge ${c.createdBy === "system" ? "" : "blue"}`}>{c.createdBy === "system" ? "模拟" : "实际"}</span>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>{c.createdAt?.slice(0, 10) ?? "-"}</span>
                <span style={{ fontSize: 11, color: "var(--muted2)" }}>{c.createdBy ?? "-"}</span>
              </div>
            ))}
            {filteredConns.length === 0 && kbConns.length > 0 && (
              <div className="empty-state" style={{ padding: "24px 12px" }}>
                无匹配知识库连接——请调整筛选条件
              </div>
            )}
          </div>
          {activeConnId && <KbDetail connId={activeConnId} key={activeConnId} />}
        </div>
      )}
    </div>
  );
}

function KbDetail({ connId }: { connId: string }) {
  const { data: docs, isLoading } = useQuery({ queryKey: ["a", "kb-docs", connId], queryFn: () => fetchKbDocs(connId), retry: false });
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<KbHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);

  const runSearch = async () => {
    if (!q.trim()) { setHits(null); return; }
    setSearching(true); setSearchErr(null);
    try {
      const res = await searchKb(connId, q.trim());
      setHits(res.hits);
    } catch (e) {
      setSearchErr((e as Error).message);
    } finally {
      setSearching(false);
    }
  };
  const docTitle = (docId: string) => (docs ?? []).find((d) => d.docId === docId)?.filename ?? docId;

  return (
    <div>
      <div className="panel" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            data-testid="kb-search-input"
            aria-label="语义搜索"
            value={q}
            placeholder="语义搜索（输入关键词，如：换型损失）"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void runSearch(); }}
            style={{ flex: 1 }}
          />
          <button className="btn sm primary" data-testid="kb-search-btn" disabled={searching} onClick={() => void runSearch()}>{searching ? "搜索中…" : "搜索"}</button>
        </div>
        {searchErr && <div className="empty-state" data-testid="kb-search-error" style={{ marginTop: 8 }}>搜索失败：{searchErr}</div>}
        {hits && (
          <div style={{ marginTop: 10 }} data-testid="kb-search-results">
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>命中 {hits.length} 段（按相似度）</div>
            {hits.length === 0 && <div className="empty-state" data-testid="kb-search-empty">无命中——换个关键词。</div>}
            {hits.map((h, i) => (
              <div key={i} className="card" data-testid={`kb-hit-${i}`} style={{ padding: 8, marginBottom: 6 }}>
                <div style={{ display: "flex", gap: 8, fontSize: 11, color: "var(--muted2)" }}>
                  <span className="badge">{docTitle(h.docId)}</span>
                  <span>相似度 {(h.score * 100).toFixed(1)}%</span>
                </div>
                <div style={{ fontSize: 12.5, marginTop: 4, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{h.text}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="section-title">文档（{docs?.length ?? 0}）</div>
        {isLoading && <div style={{ color: "var(--muted2)" }}>加载中…</div>}
        {!isLoading && (docs?.length ?? 0) === 0 && <div className="empty-state" data-testid="kb-docs-empty">该知识库暂无文档——去连接器页给它灌文档。</div>}
        {(docs?.length ?? 0) > 0 && (
          <table className="cmp" data-testid="kb-docs-table">
            <thead><tr><th>文档</th><th>分块数</th><th>灌入时间</th></tr></thead>
            <tbody>
              {docs!.map((d) => (
                <tr key={d.docId} data-testid={`kb-doc-${d.docId}`}>
                  <td className="zh">{d.filename}</td>
                  <td>{d.chunkCount}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{d.createdAt.replace("T", " ").slice(0, 19)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
