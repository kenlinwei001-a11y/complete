import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchReferences, type ReferenceTargetKind } from "@/api/endpoints";

/**
 * WO-REFERENCES-FAMILY · **引用反查的唯一可见面**（`<ReferencesPanel>`）。
 *
 * ── 为什么必须是一块，不是每页一块 ──────────────────────────────────────────
 * 后端的 `/references` 家族回答的是同一句话：**「改这个东西，会波及谁」**。
 * B 侧 7 条端点甚至是同一个函数在答（`apps/agentcore/src/resources.ts:186` `computeReferences`）。
 * 若按「域」各接各的，会长出 5+ 份形态不同的引用面板 —— 同一概念多套实现，本仓的老形态。
 * 判据（可证伪）：**改本文件一处文案，两个以上挂载点的断言必须同时红**。
 * 这条判据由 `test/references-family.seam.test.tsx` 的「同一份实现」用例咬住。
 *
 * ── 三条不许塌的诚实位 ──────────────────────────────────────────────────────
 * ① **「查不出来」≠「没人引用」**：请求失败时**不渲染任何计数**。渲染一个 0 出来，
 *    等于把「我不知道」说成「没风险」——这正是本仓要防的那种把风险藏起来的写法。
 * ② **第一层只留一个记号**（`docs/CONVENTION-ui-information-layering.md` §1）：
 *    不点开只有「引用 N 处 ▸」。逐条明细是第二层，点了才出。
 * ③ **`count: 0` 要说出口**：「今天没有引用方」是一条真结论，值得写在屏上，
 *    而不是渲染一片空白让人猜是没查还是没有。
 *
 * ── 挂载点 ─────────────────────────────────────────────────────────────────
 * 见 `docs/SYSTEM-ONTOLOGY.md` §7 与本单交回报告的「逐挂载点」表。
 */
export interface ReferencesPanelProps {
  kind: ReferenceTargetKind;
  /** 后端路由的 `:id` / `:key` —— 各 kind 用哪个由 `fetchReferences` 单点决定，调用方不必知道。 */
  id: string;
}

/**
 * 本面板全部文案的**唯一**出处。改这里 ⇒ 所有挂载点同时变（这就是「同一份实现」的可证伪判据）。
 *
 * ⚠ 记号文案刻意**不做成 prop**（两个原因，都实测过）：
 *  ① 做成 `title="…"` 传进来，各页就能各写各的措辞 —— 「同一份实现」当场破功；
 *  ② `scripts/check-ui-first-layer.mjs` 把**文案型属性**（`title`/`label`/`desc`…）计作
 *     一条第一层信息块。实测：8 个挂载点各传一个 `title` ⇒ 5 个页面的 `first` 各 +1，
 *     棘轮当场变红。措辞收在这里，挂载处只剩 `kind`/`id` 两个机器参数，页面不长
 *
 * 📅 复验（2026-08-14 实测）：`node scripts/check-ui-first-layer.mjs --explain`（看 8 个挂载页的 first 有没有涨）；
 *    把任一处改回 `title="…"` prop 即可复现那 5 页各 +1。信息块。
 */
export const REFERENCES_COPY = {
  countSuffix: "处引用",
  unknown: "引用未查出",
  none: "今天没有引用方（可以放心改）。",
  error: "这次没查出来（后端不可达）——不等于没人引用，别据此放心改。",
  loading: "查询中…",
  via: "经",
} as const;

/** 每族问的那一句话（措辞随族不同，实现只有一份）。 */
const KIND_LABEL: Record<ReferenceTargetKind, string> = {
  agent: "被谁引用",
  workflow: "被谁引用",
  skill: "被谁引用",
  "mcp-config": "被谁引用",
  rule: "被上报引用",
  "rule-orchestration": "被编排资源引用",
  solver: "改它会波及谁",
  slice: "被谁引用",
  "external-signal": "被哪些因果因子引用",
};

export default function ReferencesPanel({ kind, id }: ReferencesPanelProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["references", kind, id],
    queryFn: () => fetchReferences(kind, id),
    retry: false,
  });
  const testKey = `${kind}-${id}`;

  // 第一层的那一个记号：三态互斥，且**失败态不给数字**（诚实位①）。
  const marker = q.isError
    ? REFERENCES_COPY.unknown
    : q.isLoading
      ? REFERENCES_COPY.loading
      : `${q.data!.count} ${REFERENCES_COPY.countSuffix}`;

  return (
    <div style={{ fontSize: 12 }} data-testid={`references-panel-${testKey}`}>
      <button
        type="button"
        className="btn sm"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid={`references-toggle-${testKey}`}
      >
        {KIND_LABEL[kind]}
        <span
          className={`badge ${q.isError ? "amber" : q.isLoading ? "" : q.data!.count > 0 ? "amber" : "green"}`}
          style={{ marginLeft: 6 }}
          {...(q.isError ? {} : q.isLoading ? {} : { "data-testid": `references-count-${testKey}` })}
        >
          {marker}
        </span>
        <span style={{ marginLeft: 4, color: "var(--muted)" }}>{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div style={{ padding: "6px 2px" }} data-testid={`references-body-${testKey}`}>
          {q.isError ? (
            <div style={{ color: "var(--amber-txt)" }} data-testid={`references-error-${testKey}`}>
              {REFERENCES_COPY.error}
            </div>
          ) : q.isLoading ? (
            <div style={{ color: "var(--muted)" }}>{REFERENCES_COPY.loading}</div>
          ) : (
            <>
              {q.data!.items.map((r) => (
                <div key={`${r.kind}:${r.ref}:${r.via}`} data-testid={`references-item-${testKey}-${r.kind}-${r.ref}`}>
                  <span className="badge mono">{r.kind}</span>
                  <span className="mono" style={{ marginLeft: 4 }}>{r.ref}</span>
                  {r.name && <span className="zh" style={{ marginLeft: 4 }}>{r.name}</span>}
                  <span style={{ marginLeft: 4, color: "var(--muted)" }}>
                    {REFERENCES_COPY.via} {r.via}
                  </span>
                </div>
              ))}
              {q.data!.count === 0 && (
                <div style={{ color: "var(--muted)" }} data-testid={`references-none-${testKey}`}>
                  {REFERENCES_COPY.none}
                </div>
              )}
              {q.data!.note && (
                <div style={{ color: "var(--muted)" }} data-testid={`references-note-${testKey}`}>
                  {q.data!.note}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
