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

  return (
    <div data-testid="knowledge-page">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>知识库（S4）</h2>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>建 knowledge_base 连接 + 灌文档 → 此处看文档并语义搜索（前端所见=后端真值）</span>
      </div>

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
            {kbConns.map((c) => (
              <button
                key={c.id}
                data-testid={`kb-conn-${c.id}`}
                onClick={() => setSelected(c.id)}
                className="btn sm"
                style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 4, ...(c.id === activeConnId ? { borderLeft: "3px solid var(--accent)", fontWeight: 600 } : {}) }}
              >
                {c.name}
              </button>
            ))}
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
