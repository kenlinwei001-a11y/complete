import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ConnectionInstance } from "@platform/contracts";
import { addKbDoc, searchKb, syncKb } from "@/api/endpoints";
import { toast, toastError } from "@/store/toastStore";

/**
 * WO-BEFE-F · S4 知识库面板（`/admin/connections` 内嵌·断点 `G-BE-FE-SEAM-DEAD`）。
 *
 * ── 治的缺口 ─────────────────────────────────────────────────────────────────
 * `apps/datacore/src/app.ts:5186/5193/5211` 三条 KB 端点（search / docs / sync）**全是用户鉴权**
 * （`ctx(req)` + `authz.require(ctx, "CONNECTION", connId, "WRITE")`），不是服务间路由，
 * 也不是内部钩子 —— 属「本该有前端、一个字都没接」。门 `befe-seam:check` 载体② 把三条一起点名。
 *
 * ── 为什么落在连接页而不是新开一页 ───────────────────────────────────────────
 * KB 的真实语义就是「某个 `knowledge_base` 连接里的内容」：`connId` 是 docs/sync 的**路径参数**，
 * 检索也按可 READ 的 CONNECTION 过滤（`apps/datacore/src/kb.ts:127-131`）。脱离连接谈 KB 是没有主语的。
 * 新开导航项则会动信息架构（属仓主决策），这里刻意不动。
 *
 * ── 诚实位 ──────────────────────────────────────────────────────────────────
 * 租户没有 `knowledge_base` 连接时，本面板**整块不渲染**（而不是渲染一个永远空的壳）——
 * 「没有知识库」和「知识库是空的」是两件事，屏上不许混。
 */
export function KnowledgeBasePanel({ connections }: { connections: ConnectionInstance[] }) {
  const kbConns = connections.filter((c) => c.connectorTypeKey === "knowledge_base");
  const [connId, setConnId] = useState("");
  const active = kbConns.find((c) => c.id === connId) ?? kbConns[0];
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [scopeAll, setScopeAll] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [lastIngest, setLastIngest] = useState<{ filename: string; chunkCount: number } | null>(null);
  const [lastSync, setLastSync] = useState<{ docs: number; chunks: number } | null>(null);

  const search = useQuery({
    queryKey: ["a", "kb-search", query, scopeAll ? "*" : (active?.id ?? "")],
    queryFn: () => searchKb({ query, topK: 5, ...(scopeAll || !active ? {} : { connId: active.id }) }),
    enabled: query.trim().length > 0,
  });

  const ingest = useMutation({
    mutationFn: async (file: File) => {
      if (!active) throw new Error("请先选择一个知识库连接");
      // FileReader → dataURL → 取逗号后的 base64 段（走后端 JSON 分支 RuleDocJsonSchema）。
      const base64 = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onerror = () => reject(new Error("读取文件失败"));
        fr.onload = () => {
          const s = String(fr.result ?? "");
          const comma = s.indexOf(",");
          resolve(comma >= 0 ? s.slice(comma + 1) : s);
        };
        fr.readAsDataURL(file);
      });
      const r = await addKbDoc(active.id, file.name, base64);
      return { filename: file.name, ...r };
    },
    onSuccess: (r) => {
      setLastIngest({ filename: r.filename, chunkCount: r.chunkCount });
      toast(`已入库：${r.filename} · ${r.chunkCount} 个切块`, "success");
      if (query.trim()) void search.refetch();
    },
    onError: (e) => toastError(e instanceof Error ? e.message : String(e)),
  });

  const sync = useMutation({
    mutationFn: () => {
      if (!active) throw new Error("请先选择一个知识库连接");
      return syncKb(active.id);
    },
    onSuccess: (r) => {
      setLastSync(r);
      toast(`已重嵌 ${r.docs} 篇文档 · ${r.chunks} 个切块`, "success");
      if (query.trim()) void search.refetch();
    },
    onError: (e) => toastError(e instanceof Error ? e.message : String(e)),
  });

  // 无 knowledge_base 连接 ⇒ 整块不渲染（见头注「诚实位」）。
  if (kbConns.length === 0 || !active) return null;

  return (
    <div className="panel" style={{ marginTop: 14 }} data-testid="kb-panel">
      <div className="section-title">知识库（S4 · 语义检索）</div>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 10 }}>
        文档入库后按 ~512 token 切块并嵌入；检索只会命中你有权读取的知识库连接。
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <label style={{ fontSize: 12 }}>
          知识库{" "}
          <select
            data-testid="kb-conn-select"
            aria-label="知识库连接"
            value={active.id}
            onChange={(e) => setConnId(e.target.value)}
            style={{ fontSize: 12 }}
          >
            {kbConns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <input
          ref={fileRef}
          data-testid="kb-file-input"
          aria-label="上传知识库文档"
          type="file"
          accept=".md,.txt,.pdf,.docx"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) ingest.mutate(f);
            e.target.value = "";
          }}
        />
        <button
          className="btn sm"
          data-testid="kb-upload-btn"
          disabled={ingest.isPending}
          onClick={() => fileRef.current?.click()}
        >
          {ingest.isPending ? "入库中…" : "上传文档"}
        </button>
        <button className="btn sm" data-testid="kb-sync-btn" disabled={sync.isPending} onClick={() => sync.mutate()}>
          {sync.isPending ? "重嵌中…" : "全量重嵌"}
        </button>

        {lastIngest && (
          <span className="muted" style={{ fontSize: 11.5 }} data-testid="kb-ingest-result">
            已入库 <b className="zh">{lastIngest.filename}</b> · {lastIngest.chunkCount} 切块
          </span>
        )}
        {lastSync && (
          <span className="muted" style={{ fontSize: 11.5 }} data-testid="kb-sync-result">
            重嵌 {lastSync.docs} 篇 / {lastSync.chunks} 切块
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <input
          data-testid="kb-search-input"
          aria-label="知识库检索"
          placeholder="语义检索（如：换型时间怎么算）"
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setQuery(queryInput);
          }}
          style={{ flex: 1 }}
        />
        <label style={{ fontSize: 11.5 }} className="muted">
          <input
            type="checkbox"
            data-testid="kb-scope-all"
            checked={scopeAll}
            onChange={(e) => setScopeAll(e.target.checked)}
          />{" "}
          搜全部知识库
        </label>
        <button type="button" className="btn sm" data-testid="kb-search-btn" onClick={() => setQuery(queryInput)}>
          检索
        </button>
      </div>

      {query.trim().length > 0 && (
        <div data-testid="kb-search-results">
          {search.isLoading ? (
            <span className="muted">检索中…</span>
          ) : (search.data?.hits.length ?? 0) === 0 ? (
            <span className="muted" data-testid="kb-search-empty">
              无命中。
            </span>
          ) : (
            <table className="cmp" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ width: 60 }}>得分</th>
                  <th>片段</th>
                  <th style={{ width: 150 }}>文档</th>
                </tr>
              </thead>
              <tbody>
                {(search.data?.hits ?? []).map((h) => (
                  <tr key={`${h.docId}-${h.span.start}`} data-testid={`kb-hit-${h.docId}`}>
                    <td className="mono">{h.score.toFixed(3)}</td>
                    <td className="zh" style={{ fontSize: 11.5 }}>
                      {h.text}
                    </td>
                    <td className="mono" style={{ fontSize: 10.5 }}>
                      {h.docId}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
