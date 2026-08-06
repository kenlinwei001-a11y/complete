import { useQuery } from "@tanstack/react-query";
import type { ConnectionInstance } from "@platform/contracts";
import {
  fetchConnections,
  fetchObjectTypes,
  fetchRawDatasets,
  type ModelingDraftVM,
  type RawDatasetVM,
} from "@/api/endpoints";

/**
 * 建模工作台 · 数据源面板（左侧 additive · RL9 可回退）。
 * 把「连接器与上传」产出的 RawDataset 按来源系统分组，并对每个数据集亮出：
 *   - provenance：来源系统（连接名 / 连接器类型 / 来源类）+ 新鲜度（最后同步/上传相对时间）。
 *   - 覆盖度：被多少对象类型消费（跨所有建模草案，按 dataset 名匹配 objectType.sourceDataset）。
 * 零业务常数：分组键/标签全部从数据派生（连接 name/connectorTypeKey/sourceCategory），不内联行业名。
 */

/** 新鲜度：最后同步/上传时间 → 人类可读相对时间 + 是否陈旧（>2h 视为延迟，呼应 C09/R13）。 */
export function freshness(at?: string | null): { label: string; stale: boolean } | null {
  if (!at) return null;
  const ms = Date.now() - new Date(at).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const h = ms / 3_600_000;
  const label =
    h < 1 ? `${Math.max(1, Math.round(ms / 60_000))} 分钟前` : h < 48 ? `${h.toFixed(1)}h 前` : `${Math.round(h / 24)} 天前`;
  return { label, stale: h > 2 };
}

/** 已发布对象类型（coverage 权威来源）：sourceBindings[].dataset = 该类型消费的真 rawDataset。 */
export type PublishedTypeForCoverage = { key: string; sourceBindings?: { dataset: string }[] };

/**
 * 统计每个数据集被多少对象类型消费（去重），用于"已建模/未建模"徽章。
 * 轨L 增量3（真值闭合·解决根本问题）：**权威来源 = 已发布对象类型的 `sourceBindings.dataset`**
 * （demo 经真建模链后 provenance 真实，34 类型各绑其 rawDataset）——不再仅认草案，本体已存在的数据集
 * 不得显"未建模"。草案仍并入（建模中的 in-progress 草案也计覆盖），二者按 (dataset→typeKey) 去重合并。
 */
export function coverageByDatasetName(
  drafts: ModelingDraftVM[] | undefined,
  publishedTypes?: PublishedTypeForCoverage[],
): Map<string, number> {
  const m = new Map<string, Set<string>>();
  const add = (dataset: string | undefined, typeKey: string) => {
    if (!dataset) return;
    const set = m.get(dataset) ?? new Set<string>();
    set.add(typeKey);
    m.set(dataset, set);
  };
  // ① 权威：已发布类型的真 sourceBindings（provenance 因果真实）。
  for (const ty of publishedTypes ?? []) {
    for (const b of ty.sourceBindings ?? []) add(b.dataset, ty.key);
  }
  // ② 补充：建模中草案（in-progress，未发布也显"建模中"覆盖）。
  for (const d of drafts ?? []) {
    for (const ot of d.suggestion.objectTypes) add(ot.sourceDataset, ot.typeKey);
  }
  const out = new Map<string, number>();
  for (const [name, set] of m) out.set(name, set.size);
  return out;
}

/** 分组键：优先连接名（来源系统实例），回退到来源类 / 连接 id / 「未关联来源」。 */
function groupKeyOf(ds: RawDatasetVM, connById: Map<string, ConnectionInstance>): string {
  const conn = ds.sourceConnId ? connById.get(ds.sourceConnId) : undefined;
  if (conn) return conn.name;
  if (ds.sourceCategory) return ds.sourceCategory;
  if (ds.sourceConnId) return ds.sourceConnId;
  return "未关联来源";
}

export function DataSourcePanel({ drafts, onModel }: { drafts?: ModelingDraftVM[]; onModel?: (datasetId: string) => void }) {
  const { data: datasets } = useQuery({ queryKey: ["a", "raw-datasets", {}], queryFn: () => fetchRawDatasets() });
  const { data: connections } = useQuery({ queryKey: ["a", "connections"], queryFn: fetchConnections });
  // 轨L 增量3：已发布类型为 coverage 权威来源（provenance 真实后 sourceBindings 指向真 rawDataset）。
  const { data: publishedTypes } = useQuery({ queryKey: ["a", "object-types"], queryFn: fetchObjectTypes });

  const connById = new Map((connections ?? []).map((c) => [c.id, c]));
  const coverage = coverageByDatasetName(drafts, publishedTypes);

  // 按来源系统分组（键从数据派生）。分组内按数据集名排序，分组按名排序 → 渲染确定。
  const groups = new Map<string, RawDatasetVM[]>();
  for (const ds of datasets ?? []) {
    const k = groupKeyOf(ds, connById);
    const bucket = groups.get(k) ?? [];
    bucket.push(ds);
    groups.set(k, bucket);
  }
  const sortedGroups = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div className="panel" data-testid="data-source-panel">
      <div className="section-title">数据源（连接器与上传）</div>
      {sortedGroups.length === 0 && (
        <div className="empty-state" data-testid="data-source-empty">
          暂无数据源（先在「连接器」同步或上传）
        </div>
      )}
      {sortedGroups.map(([groupName, list]) => {
        const conn = list[0]?.sourceConnId ? connById.get(list[0]!.sourceConnId!) : undefined;
        return (
          <div key={groupName} style={{ marginBottom: 12 }} data-testid={`ds-group-${groupName}`}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <strong style={{ fontSize: 12 }}>{groupName}</strong>
              {/* provenance：来源系统类（连接器类型 / sourceCategory），从数据派生 */}
              {conn?.connectorTypeKey && (
                <span className="badge" data-testid="ds-source-system" style={{ fontSize: 10 }}>
                  {conn.connectorTypeKey}
                </span>
              )}
              {conn?.category && (
                <span className="badge" style={{ fontSize: 10 }}>
                  {conn.category}
                </span>
              )}
              <span className="mono" style={{ marginLeft: "auto", fontSize: 10, color: "var(--muted2)" }}>
                {list.length} 个数据集
              </span>
            </div>
            {[...list]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((ds) => {
                // 新鲜度：数据集自身 syncedAt 优先，回退连接 lastSyncAt（provenance 链路 RawDataset←Connection）。
                const fresh = freshness(ds.syncedAt ?? conn?.lastSyncAt ?? null);
                const consumers = coverage.get(ds.name) ?? 0;
                return (
                  <div
                    key={ds.id}
                    data-testid={`ds-row-${ds.id}`}
                    style={{ padding: "4px 2px", borderTop: "1px solid var(--line)" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="mono" style={{ fontSize: 11.5 }}>
                        {ds.name}
                      </span>
                      {typeof ds.rowCount === "number" && (
                        <span style={{ fontSize: 10, color: "var(--muted2)" }}>{ds.rowCount} 行</span>
                      )}
                      {/* 覆盖度：被多少对象类型消费（0 = 尚未建模）。未建模且可建模 → 可点击按钮，
                          点击进 A3 半自动建模 flow（该数据集 schema → 对象类型草案 → 发布为本体）。 */}
                      {consumers > 0 ? (
                        <span
                          className="badge green"
                          data-testid={`ds-coverage-${ds.id}`}
                          style={{ marginLeft: "auto", fontSize: 10 }}
                          title={`被 ${consumers} 个对象类型消费`}
                        >
                          {consumers} 个对象类型
                        </span>
                      ) : onModel ? (
                        <button
                          type="button"
                          className="badge amber"
                          data-testid={`ds-coverage-${ds.id}`}
                          onClick={() => onModel(ds.id)}
                          title="点击完成建模：从该数据集 schema 出对象类型草案 → 一键发布为本体（A3 半自动建模）"
                          style={{ marginLeft: "auto", fontSize: 10, cursor: "pointer", border: "none", fontFamily: "inherit" }}
                        >
                          未建模 · 点击建模
                        </button>
                      ) : (
                        <span
                          className="badge amber"
                          data-testid={`ds-coverage-${ds.id}`}
                          style={{ marginLeft: "auto", fontSize: 10 }}
                          title="尚未被任何对象类型消费"
                        >
                          未建模
                        </span>
                      )}
                    </div>
                    {/* 新鲜度（provenance 第二要素）：陈旧标降级 */}
                    {fresh && (
                      <div style={{ fontSize: 10, color: fresh.stale ? "var(--c-risk, #e0626c)" : "var(--muted2)" }} data-testid={`ds-freshness-${ds.id}`}>
                        {fresh.label}同步{fresh.stale ? "（已延迟）" : ""}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}
