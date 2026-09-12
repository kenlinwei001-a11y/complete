import { useQuery } from "@tanstack/react-query";
import { CAUSAL_SEGMENTS, type CausalGapReason, type CausalSegment, type DecisionGraph } from "@platform/contracts";
import { fetchDecisionCausalGraph, fetchSimCausalGraph } from "@/api/endpoints";

/**
 * WO-BEFE-D · **决策因果图**面板（`GET /a/v1/causal-graphs/{sim|decision}/*` 此前前端零调用方）。
 *
 * 回答的是「**为什么这个决策被触发**」，五段显式：Cause → Impact → Decision → Action → Result。
 *
 * ── 为什么一个组件、两个 source，而不是两个页面 ────────────────────────────────
 * 后端刻意把两个数据源分成**两条路由**（沙盘按 tick 记时、台账按 ISO 记时，今天没有任何字段互指，
 * 合成一条就得现编一个统一的"时间"—— app.ts:3930 顶注）。前端照此**分两个 api 函数**，
 * 但**渲染同一个契约** `DecisionGraph` ⇒ 组件共用、请求不共用。把两条路由包成"统一入口"才是错的。
 *
 * ── 空段必须画成"诚实灰"，不是画成"没问题" ───────────────────────────────────
 * `segmentGaps` 是契约用 superRefine 硬锁的：空段**必有**条目写明 `missing`/`needs`。
 * 前端若拿 `nodes.filter(...).length === 0` 反推空段，就得自己知道五段全集 = 第二套真相源；
 * 故本组件一律读 `segmentCounts` + `segmentGaps`，不反推。
 * 三种缺席原因（`NO_SOURCE_WIRED` 没接线 / `SOURCE_EMPTY` 接了线没数据 / `NOT_YET_REALIZED` 时点未到）
 * **分开显示**——修法完全不同，压成一句「暂无数据」正是铁律 0.5 点名的病。
 */

export type CausalGraphSourceRef = { kind: "sim"; refId: string } | { kind: "decision"; refId: string };

const SEGMENT_LABEL: Record<CausalSegment, string> = {
  CAUSE: "起因",
  IMPACT: "影响",
  DECISION: "决策",
  ACTION: "动作",
  RESULT: "结果",
};

const GAP_LABEL: Record<CausalGapReason, { text: string; cls: string }> = {
  NO_SOURCE_WIRED: { text: "没接线", cls: "red" },
  SOURCE_EMPTY: { text: "接了线没数据", cls: "amber" },
  NOT_YET_REALIZED: { text: "时点未到", cls: "blue" },
};

export function CausalGraphPanel({ source, testid = "causal-graph" }: { source: CausalGraphSourceRef; testid?: string }) {
  const q = useQuery<DecisionGraph>({
    // refId 进 key —— 换一条决策/一个沙盘会话就是**另一张图**，共用缓存会把上一张留在屏上。
    queryKey: ["a", "causal-graph", source.kind, source.refId],
    queryFn: () => (source.kind === "sim" ? fetchSimCausalGraph(source.refId) : fetchDecisionCausalGraph(source.refId)),
    enabled: !!source.refId,
    retry: false,
  });

  if (q.isLoading) return <div className="empty-state" data-testid={`${testid}-loading`}>因果图加载中…</div>;
  if (q.isError) {
    // `decision.causal-graph` 关闭时后端 404 FEATURE_NOT_FOUND —— 这是**预期行为**（R3），
    // 与"请求失败"要分开说，否则运维会去查一个不存在的故障。
    return (
      <div className="empty-state" data-testid={`${testid}-error`}>
        因果图不可用：{(q.error as Error)?.message ?? "未知错误"}
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          若为 FEATURE_NOT_FOUND：entitlement <span className="mono">decision.causal-graph</span> 未开通（功能关闭 = 不存在，非故障）。
        </div>
      </div>
    );
  }
  const g = q.data;
  if (!g) return null;

  const gapBySeg = new Map(g.segmentGaps.map((x) => [x.segment, x]));

  return (
    <div data-testid={testid} data-source-kind={g.source.kind} data-graph-id={g.graphId}>
      <div className="muted" style={{ fontSize: 12, marginBottom: 6 }} data-testid={`${testid}-source`}>
        来源 <span className="mono">{g.source.kind}</span> · <span className="mono">{g.source.refId}</span> ·
        节点 {g.nodes.length} 个 · 边 {g.edges.length} 条
      </div>

      {/* 五段轨道：每段要么列节点，要么列"缺什么/要接什么"，没有第三种状态（契约 superRefine 锁死）。 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
        {CAUSAL_SEGMENTS.map((seg) => {
          const nodes = g.nodes.filter((n) => n.segment === seg);
          const gap = gapBySeg.get(seg);
          return (
            <div key={seg} className="panel" style={{ padding: 8 }} data-testid={`${testid}-seg-${seg}`}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                {SEGMENT_LABEL[seg]}
                {/* 计数读 segmentCounts（契约冗余但必需的那个字段），不由 nodes 反推。 */}
                <span className="mono muted" style={{ marginLeft: 4, fontSize: 12 }} data-testid={`${testid}-count-${seg}`}>
                  {g.segmentCounts[seg] ?? 0}
                </span>
              </div>
              {gap ? (
                <div data-testid={`${testid}-gap-${seg}`} data-gap-reason={gap.reason} style={{ fontSize: 12 }}>
                  <span className={`badge ${GAP_LABEL[gap.reason].cls}`}>{GAP_LABEL[gap.reason].text}</span>
                  <div style={{ marginTop: 3 }}>缺：{gap.missing}</div>
                  <div className="muted">补：{gap.needs}</div>
                </div>
              ) : (
                nodes.map((n) => (
                  <div key={n.nodeId} data-testid={`${testid}-node-${n.nodeId}`} style={{ fontSize: 12, borderTop: "1px solid var(--line)", padding: "3px 0" }}>
                    <div>{n.label}</div>
                    <div className="muted mono" style={{ fontSize: 12 }}>
                      {n.value === null ? "—" : n.value}
                      {n.unit ? ` ${n.unit}` : ""}
                      {n.tick === null ? "" : ` · t${n.tick}`}
                    </div>
                    {/* R13 溯源：每个节点指得回它是从哪条既有真值抽出来的（零现编的可核对面）。 */}
                    <div className="muted" style={{ fontSize: 12 }} data-testid={`${testid}-prov-${n.nodeId}`}>
                      源 <span className="mono">{n.provenance.kind}</span>
                      {n.provenance.producedBy ? ` · 由 ${n.provenance.producedBy}` : " · 非算出（人建/外部回填）"}
                    </div>
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>

      {g.caveats.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12 }} data-testid={`${testid}-caveats`}>
          <b>边级诚实缺席</b>（真值在、但接上游那条边所需字段不存在 ⇒ 出节点不出边）：
          <ul style={{ margin: "3px 0 0 16px" }}>
            {g.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default CausalGraphPanel;
