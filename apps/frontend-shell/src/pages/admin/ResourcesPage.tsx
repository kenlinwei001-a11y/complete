import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { IntelligenceResource, TieredTags } from "@platform/contracts";
import {
  fetchResources,
  searchResources,
  fetchResourceRelations,
  fetchResourceQuality,
} from "@/api/endpoints";

/**
 * WO-DRIL-P4 · 智能资源治理台（/admin/resources · Decision Resource Intelligence Layer §6.4 消费端）。
 *
 * 一屏发现全量智能资源（solver/slice/rule/skill/workflow/agent/intent/mcp_tool/field 9 类统一 IntelligenceResource）：
 *  · 左：资源列表（按 kind 分组·五级标签 tieredTags 展示·kind 筛选）
 *  · 顶：NL 混合检索（POST /b/v1/resources/search → 排序 + scoreBreakdown + explanation）
 *  · 右：选中资源详情 —— 运行时质量分（EWMA·GET …/quality）+ 1-hop 关系图（出边/入边·GET …/relations）
 *
 * 契约一律 import 自 @platform/contracts（R1·前端不重定义）。entitlement 由 AdminGuard featureKey=qos.dril-routing 前置门控。
 */

const KIND_LABEL: Record<string, string> = {
  solver: "求解器",
  slice: "本体切片",
  rule: "规则",
  skill: "技能",
  workflow: "工作流",
  agent: "Agent",
  intent: "意图",
  mcp_tool: "MCP 工具",
  field: "字段",
};

function tierChips(tt?: TieredTags): { layer: string; values: string[] }[] {
  if (!tt) return [];
  return [
    { layer: "业务域", values: tt.l1_domain ?? [] },
    { layer: "决策型", values: tt.l2_decisionType ?? [] },
    { layer: "场景", values: tt.l3_scenario ?? [] },
    { layer: "对象", values: tt.l4_object ?? [] },
    { layer: "算法", values: tt.l5_algorithm ?? [] },
  ].filter((r) => r.values.length > 0);
}

function ResourceDetail({ resource }: { resource: IntelligenceResource }) {
  const { kind, key } = resource;
  const relations = useQuery({
    queryKey: ["b", "resource-relations", kind, key],
    queryFn: () => fetchResourceRelations(kind, key),
  });
  const quality = useQuery({
    queryKey: ["b", "resource-quality", kind, key],
    queryFn: () => fetchResourceQuality(kind, key),
  });
  const q = quality.data?.quality;

  return (
    <div className="panel" data-testid="resource-detail">
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>
        {resource.label} <span className="badge">{KIND_LABEL[kind] ?? kind}</span>
      </div>
      <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>{kind}/{key}</div>
      <div style={{ fontSize: 12, marginBottom: 10 }}>{resource.description}</div>

      {/* 五级标签 */}
      {tierChips(resource.tieredTags).length > 0 && (
        <div style={{ marginBottom: 10 }} data-testid="resource-tiered-tags">
          {tierChips(resource.tieredTags).map((r) => (
            <div key={r.layer} style={{ fontSize: 11.5, marginBottom: 2 }}>
              <span style={{ color: "var(--muted)" }}>{r.layer}：</span>
              {r.values.map((v) => (
                <span key={v} className="badge blue" style={{ marginRight: 4 }}>{v}</span>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* 运行时质量分（EWMA） */}
      <div className="section-title">质量分（运行时 EWMA）</div>
      <div data-testid="resource-quality" style={{ fontSize: 11.5, marginBottom: 10 }}>
        {quality.isLoading ? (
          <span className="muted">加载中…</span>
        ) : q ? (
          <table className="cmp" style={{ width: "100%" }}>
            <tbody>
              <tr><td>成功率</td><td>{q.successRate !== undefined ? `${(q.successRate * 100).toFixed(1)}%` : "—"}</td></tr>
              <tr><td>调用次数</td><td>{q.usageCount ?? "—"}</td></tr>
              <tr><td>平均时延</td><td>{q.avgLatencyMs !== undefined ? `${Math.round(q.avgLatencyMs)}ms` : "—"}</td></tr>
              <tr><td>最近探针</td><td className="mono" style={{ fontSize: 10.5 }}>{q.lastProbeAt ?? "—"}</td></tr>
            </tbody>
          </table>
        ) : (
          <span className="muted" data-testid="resource-quality-empty">尚无运行时观测（调用后经 EWMA 累积）。</span>
        )}
      </div>

      {/* 1-hop 关系图 */}
      <div className="section-title">关系图（1-hop）</div>
      <div data-testid="resource-relations" style={{ fontSize: 11.5 }}>
        {relations.isLoading ? (
          <span className="muted">加载中…</span>
        ) : (
          <>
            <div style={{ marginBottom: 4 }}>
              <span style={{ color: "var(--muted)" }}>出边：</span>
              {(relations.data?.relations ?? []).length === 0 ? (
                <span className="muted">无</span>
              ) : (
                (relations.data?.relations ?? []).map((r, i) => (
                  <span key={`${r.relType}-${r.toKind}-${r.toKey}-${i}`} className="badge" style={{ marginRight: 4 }}>
                    {r.relType} → {r.toKind}/{r.toKey}
                  </span>
                ))
              )}
            </div>
            <div>
              <span style={{ color: "var(--muted)" }}>入边：</span>
              {(relations.data?.inbound ?? []).length === 0 ? (
                <span className="muted">无</span>
              ) : (
                (relations.data?.inbound ?? []).map((r, i) => (
                  <span key={`${r.fromKind}-${r.fromKey}-${i}`} className="badge" style={{ marginRight: 4 }}>
                    {r.fromKind}/{r.fromKey} ({r.relType})
                  </span>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function ResourcesPage() {
  const [kindFilter, setKindFilter] = useState<string>("");
  const [selected, setSelected] = useState<IntelligenceResource | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const list = useQuery({
    queryKey: ["b", "resources", kindFilter],
    queryFn: () => fetchResources(kindFilter ? { kind: kindFilter } : {}),
  });
  const search = useQuery({
    queryKey: ["b", "resources-search", searchQuery],
    queryFn: () => searchResources({ query: searchQuery, minScore: 0, maxResults: 20 }),
    enabled: searchQuery.trim().length > 0,
  });

  const resources = list.data?.items ?? [];
  const kindOptions = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of resources) m.set(r.kind, (m.get(r.kind) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [resources]);

  const byKind = useMemo(() => {
    const m = new Map<string, IntelligenceResource[]>();
    for (const r of resources) (m.get(r.kind) ?? m.set(r.kind, []).get(r.kind)!).push(r);
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [resources]);

  return (
    <div data-testid="resources-page">
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>智能资源治理台（DRIL）</h2>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 10 }}>
        一屏发现全量智能资源（求解器/切片/规则/技能/工作流/Agent/意图/MCP/字段），派生投影自各模块真值（非新真值源）。
        支持五级标签检索、运行时质量分、1-hop 关系图 —— QOS 路由层组包的可解释视图。
      </div>

      {/* NL 混合检索 */}
      <div className="panel" style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
        <input
          data-testid="resource-search-input"
          placeholder="自然语言检索（如：产能缺口满足度怎么算）"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") setSearchQuery(searchInput); }}
          style={{ flex: 1 }}
        />
        <button type="button" className="btn sm" data-testid="resource-search-btn" onClick={() => setSearchQuery(searchInput)}>
          检索
        </button>
      </div>

      {searchQuery.trim().length > 0 && (
        <div className="panel" style={{ marginBottom: 12 }} data-testid="resource-search-results">
          <div className="section-title">检索结果（混合检索排序）</div>
          {search.isLoading ? (
            <span className="muted">检索中…</span>
          ) : (search.data?.results.length ?? 0) === 0 ? (
            <span className="muted">无命中。</span>
          ) : (
            <>
              <table className="cmp" style={{ width: "100%" }}>
                <thead>
                  <tr><th style={{ width: 70 }}>类别</th><th style={{ width: 180 }}>key</th><th>标签</th><th style={{ width: 70 }}>得分</th></tr>
                </thead>
                <tbody>
                  {(search.data?.results ?? []).map((r) => (
                    <tr
                      key={`${r.resource.kind}/${r.resource.key}`}
                      data-testid={`resource-search-row-${r.resource.key}`}
                      style={{ cursor: "pointer" }}
                      onClick={() => setSelected(r.resource)}
                    >
                      <td>{KIND_LABEL[r.resource.kind] ?? r.resource.kind}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{r.resource.key}</td>
                      <td>{r.resource.label}</td>
                      <td>{r.score.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {search.data?.explanation && (
                <div className="muted" style={{ fontSize: 11, marginTop: 6 }} data-testid="resource-search-explanation">
                  {search.data.explanation}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* kind 筛选 */}
      {kindOptions.length > 0 && (
        <div className="panel" style={{ marginBottom: 12, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }} data-testid="resource-kind-filter">
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>按类别：</span>
          <button
            type="button"
            className={`badge ${kindFilter === "" ? "blue" : ""}`}
            style={{ cursor: "pointer" }}
            onClick={() => setKindFilter("")}
            aria-pressed={kindFilter === ""}
          >
            全部（{resources.length}）
          </button>
          {kindOptions.map(([k, n]) => (
            <button
              key={k}
              type="button"
              className={`badge ${kindFilter === k ? "blue" : ""}`}
              style={{ cursor: "pointer" }}
              onClick={() => setKindFilter(k)}
              data-testid={`resource-kind-chip-${k}`}
              aria-pressed={kindFilter === k}
            >
              {KIND_LABEL[k] ?? k}（{n}）
            </button>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        {/* 资源列表 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {list.isLoading ? (
            <div className="empty-state">加载中…</div>
          ) : resources.length === 0 ? (
            <div className="empty-state" data-testid="resources-empty">暂无可见智能资源。</div>
          ) : (
            byKind.map(([kind, items]) => (
              <div key={kind} style={{ marginBottom: 14 }}>
                <div className="section-title">{KIND_LABEL[kind] ?? kind}（{items.length}）</div>
                <table className="cmp" style={{ width: "100%" }}>
                  <thead>
                    <tr><th style={{ width: 180 }}>key</th><th style={{ width: 150 }}>名称</th><th>描述</th></tr>
                  </thead>
                  <tbody>
                    {items.map((r) => (
                      <tr
                        key={r.key}
                        data-testid={`resource-row-${r.key}`}
                        /* WO-HOVER-LAYER：`--accent-soft` 是幽灵令牌，兜底 #eef2ff 是**浅紫白** ⇒ 暗色皮下
                           选中行变成浅色块 + 近白字，选中即读不了。改吃 --hover-tint-strong（逐主题定义）。 */
                        style={{ cursor: "pointer", background: selected?.kind === r.kind && selected?.key === r.key ? "var(--hover-tint-strong)" : undefined }}
                        onClick={() => setSelected(r)}
                      >
                        <td className="mono" style={{ fontSize: 11 }}>{r.key}</td>
                        <td>{r.label}</td>
                        <td style={{ fontSize: 11.5, color: "var(--muted)" }}>{r.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </div>

        {/* 详情面板 */}
        <div style={{ width: 340, flexShrink: 0 }}>
          {selected ? (
            <ResourceDetail resource={selected} />
          ) : (
            <div className="panel muted" style={{ fontSize: 11.5 }} data-testid="resource-detail-empty">
              选择左侧资源查看质量分与关系图。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
