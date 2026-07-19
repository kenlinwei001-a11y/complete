import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/apiClient";
import { invokeSolver } from "@/api/endpoints";
import type { ViewConfigVM } from "@/api/types";
import zh from "@/locales/zh";
import {
  bottleneckCandidates,
  concentrationCandidates,
  marginCandidates,
  type CrType,
  type BottleneckCandidate,
  type ConcentrationCandidate,
  type MarginCandidate,
} from "./deriveArgs";

/**
 * 净室归因投影页（renderer=cleanroom-attr）——把三个**通用净室求解器**（此前引擎已建、前端 0 文件调用）
 * 首次落成一张可下钻的投影页：
 *   ① 共享瓶颈 shared_bottleneck   —— 上游按共享资源分组·需求和>产能即瓶颈·判哪张单被降级
 *   ② 隐性集中度 concentration_risk —— 多跳反向聚合找"多个分散起点隐性依赖同一根"的暗线单点
 *   ③ 毛利倒挂 margin_attribution   —— 逐目标拆成本项、标记倒挂、跨群聚合根因主驱动成本项
 *
 * KILL-MOCK 铁律：三块全部 `invokeSolver()` 真调、零写死数字；求解器**参数由真对象类型倒推**
 * （deriveArgs.ts 与后端 solver-args.ts 同源）——绝不写死 resourceType/startType/targetType/viaField/costFields。
 * 主类型下拉从真类型列表取，切换 → 换 args → 重调 → 投影随之变（接缝的前端半）。
 * 空态诚实：无可倒推参数 / 空结果 → 如实报，不编瓶颈/集中/倒挂。
 */

type TabKey = "bottleneck" | "concentration" | "margin";
const TABS: { key: TabKey; label: string; solver: string }[] = [
  { key: "bottleneck", label: "共享瓶颈", solver: "shared_bottleneck" },
  { key: "concentration", label: "隐性集中度", solver: "concentration_risk" },
  { key: "margin", label: "毛利倒挂", solver: "margin_attribution" },
];

const fmt = (n: unknown): string => {
  const v = Number(n);
  return Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : "—";
};

async function fetchCrTypes(): Promise<CrType[]> {
  const raw = await api.a<CrType[]>("/a/v1/ontology/object-types");
  return (raw ?? []).filter((t) => t.status === undefined || t.status === "ACTIVE");
}

export default function CleanroomAttrView(_props: { view?: ViewConfigVM }) {
  const [tab, setTab] = useState<TabKey>("bottleneck");
  const { data: types, isLoading, isError } = useQuery({ queryKey: ["a", "object-types", "cleanroom"], queryFn: fetchCrTypes, retry: false });

  if (isLoading) return <div className="empty-state">{zh.common.loading}</div>;
  if (isError || !types) {
    return (
      <div className="empty-state" data-testid="cr-types-error">
        <div className="code">🧪</div>
        <div style={{ fontWeight: 600, color: "var(--txt)" }}>无法读取对象类型</div>
        <div style={{ fontSize: 12, color: "var(--muted2)" }}>净室归因需先有已发布对象类型才能倒推求解器参数——诚实空态。</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-testid="cleanroom-attr">
      <div className="panel" style={{ padding: "10px 14px" }}>
        <div className="section-title">净室归因投影 · 三通用求解器接地</div>
        <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.7 }}>
          共享瓶颈 / 隐性集中度 / 毛利倒挂——参数从真对象类型倒推（非写死），结果全为求解器真值投影。
        </div>
        <div role="tablist" style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              data-testid={`cr-tab-${t.key}`}
              className={`btn sm ${tab === t.key ? "primary" : ""}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "bottleneck" && <BottleneckBlock types={types} />}
      {tab === "concentration" && <ConcentrationBlock types={types} />}
      {tab === "margin" && <MarginBlock types={types} />}
    </div>
  );
}

/** 主类型下拉（候选来自真对象类型倒推）+ 倒推参数透明展示（chips）。 */
function PrimaryPicker({
  testid,
  label,
  options,
  value,
  onChange,
  args,
}: {
  testid: string;
  label: string;
  options: { key: string; label: string }[];
  value: string;
  onChange: (k: string) => void;
  args: Record<string, unknown>;
}) {
  return (
    <div className="panel" style={{ padding: "10px 12px", background: "var(--panel2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{label}</span>
        <select data-testid={testid} value={value} onChange={(e) => onChange(e.target.value)} style={{ minWidth: 160, fontSize: 12 }}>
          {options.map((o) => (
            <option key={o.key} value={o.key}>{o.label}（{o.key}）</option>
          ))}
        </select>
      </div>
      <div data-testid={`${testid}-args`} style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
        {Object.entries(args).map(([k, v]) => (
          <span key={k} className="badge" style={{ fontSize: 9 }} title="倒推参数（真对象结构·非写死）">
            {k}=<b className="mono">{typeof v === "object" ? JSON.stringify(v) : String(v)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function SolverError({ testid, error }: { testid: string; error: unknown }) {
  const msg = (error as { message?: string } | undefined)?.message;
  return (
    <div className="empty-state" data-testid={testid}>
      <div className="code">🧪</div>
      <div style={{ fontWeight: 600, color: "var(--txt)" }}>求解器未返回结果</div>
      <div style={{ fontSize: 12, color: "var(--muted2)", maxWidth: 440, textAlign: "center", lineHeight: 1.7 }}>
        该求解器可能未开通或当前对象数据不足——诚实空态，不编造结果。
        {msg ? <div style={{ marginTop: 6, fontFamily: "var(--font-mono)", fontSize: 11 }}>{msg}</div> : null}
      </div>
    </div>
  );
}

// ══════════════════ ① 共享瓶颈 ══════════════════
interface BottleneckRow { resourceType: string; resourceId: string; capacity: number; demand: number; sharerCount: number }
interface DowngradedRow { resourceId: string; sharedByType: string; objectId: string; reason: string }
interface BottleneckOut { bottlenecks: BottleneckRow[]; contention: { resourceId: string; sharers: string[] }[]; downgraded: DowngradedRow[]; summary: string }

function BottleneckBlock({ types }: { types: CrType[] }) {
  const cands = useMemo(() => bottleneckCandidates(types), [types]);
  const [sel, setSel] = useState<string>(cands[0]?.primary ?? "");
  const cand: BottleneckCandidate | undefined = cands.find((c) => c.primary === sel) ?? cands[0];

  if (!cand) {
    return (
      <div className="empty-state" data-testid="cr-bn-nocandidate">
        <div className="code">🧩</div>
        <div style={{ fontWeight: 600, color: "var(--txt)" }}>无可分析的共享瓶颈结构</div>
        <div style={{ fontSize: 12, color: "var(--muted2)", maxWidth: 440, textAlign: "center", lineHeight: 1.7 }}>
          需存在"资源类型（有产能/数值字段）被另一类型 ref 共享（有需求字段）"——当前对象类型倒推不出，诚实留空。
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="cr-bn">
      <PrimaryPicker
        testid="cr-bn-type"
        label="共享资源类型"
        options={cands.map((c) => ({ key: c.primary, label: c.primaryLabel }))}
        value={cand.primary}
        onChange={setSel}
        args={cand.args}
      />
      <BottleneckResult key={JSON.stringify(cand.args)} cand={cand} />
    </div>
  );
}

function BottleneckResult({ cand }: { cand: BottleneckCandidate }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["a", "shared_bottleneck", cand.args],
    queryFn: async () => (await invokeSolver("shared_bottleneck", cand.args)).data as BottleneckOut,
    retry: false,
  });
  if (isLoading) return <div className="empty-state">{zh.common.loading}</div>;
  if (isError || !data) return <SolverError testid="cr-bn-error" error={error} />;

  const downMap = new Map(data.downgraded.map((d) => [d.resourceId, d]));
  return (
    <div className="panel" data-testid="cr-bn-result">
      <div className="section-title">
        共享瓶颈 · <span className="mono">{cand.args.sharedByType}</span> 争用 <span className="mono">{cand.args.resourceType}</span>
      </div>
      <div data-testid="cr-bn-summary" style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>{data.summary}</div>
      {data.bottlenecks.length === 0 ? (
        <div className="empty-state" data-testid="cr-bn-empty" style={{ padding: 20, fontSize: 12 }}>
          无瓶颈：所选资源上"需求和 ≤ 产能"或无 ≥2 争用者（真值·非编造）。
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {data.bottlenecks.map((b) => {
            const over = b.demand - b.capacity;
            const pct = b.capacity > 0 ? Math.min(200, Math.round((b.demand / b.capacity) * 100)) : 100;
            const dg = downMap.get(b.resourceId);
            return (
              <div key={b.resourceId} data-testid={`cr-bn-row-${b.resourceId}`} className="panel" style={{ padding: "8px 10px", borderLeft: "3px solid var(--danger)" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
                  <b className="mono">{b.resourceId}</b>
                  <span>需求 <b className="mono" style={{ color: "var(--danger)" }}>{fmt(b.demand)}</b> / 产能 <b className="mono">{fmt(b.capacity)}</b></span>
                  <span className="badge red" style={{ fontSize: 9 }}>超 {fmt(over)}</span>
                  <span style={{ color: "var(--muted2)" }}>{b.sharerCount} 方争用</span>
                </div>
                <div style={{ height: 8, borderRadius: 5, background: "var(--line2)", overflow: "hidden", marginTop: 6 }}>
                  <div style={{ height: "100%", width: `${Math.min(100, pct)}%`, background: pct > 100 ? "var(--danger)" : "var(--amber)" }} />
                </div>
                {dg && (
                  <div data-testid={`cr-bn-downgraded-${b.resourceId}`} style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
                    降级：<b className="mono">{dg.objectId}</b>（{dg.sharedByType}）· {dg.reason}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ══════════════════ ② 隐性集中度 ══════════════════
interface ConcRow { rootType: string; rootId: string; dependents: string[]; count: number }
interface ConcOut { concentrations: ConcRow[]; topExposure: ConcRow | null; summary: string }

function ConcentrationBlock({ types }: { types: CrType[] }) {
  const cands = useMemo(() => concentrationCandidates(types), [types]);
  const [sel, setSel] = useState<string>(cands[0]?.primary ?? "");
  const cand: ConcentrationCandidate | undefined = cands.find((c) => c.primary === sel) ?? cands[0];

  if (!cand) {
    return (
      <div className="empty-state" data-testid="cr-cc-nocandidate">
        <div className="code">🧩</div>
        <div style={{ fontWeight: 600, color: "var(--txt)" }}>无可追溯的多跳依赖链</div>
        <div style={{ fontSize: 12, color: "var(--muted2)", maxWidth: 440, textAlign: "center", lineHeight: 1.7 }}>
          隐性集中度需 ≥1 跳 ref 链（起点→…→终端根）——当前对象类型无 ref 链，诚实留空。
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="cr-cc">
      <PrimaryPicker
        testid="cr-cc-type"
        label="起点类型"
        options={cands.map((c) => ({ key: c.primary, label: c.primaryLabel }))}
        value={cand.primary}
        onChange={setSel}
        args={cand.args}
      />
      <div className="panel" style={{ padding: "8px 12px", fontSize: 12, color: "var(--muted)" }} data-testid="cr-cc-path">
        路径：<b className="mono">{cand.primary}</b>
        {cand.args.path.map((h, i) => (
          <span key={i}> —<span className="mono" style={{ color: "var(--accent)" }}>{h.viaField}</span>→ <b className="mono">{h.toType}</b></span>
        ))}
        <span style={{ marginLeft: 8, color: "var(--muted2)" }}>（根 = {cand.rootLabel}）</span>
      </div>
      <ConcentrationResult key={JSON.stringify(cand.args)} cand={cand} />
    </div>
  );
}

function ConcentrationResult({ cand }: { cand: ConcentrationCandidate }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["a", "concentration_risk", cand.args],
    queryFn: async () => (await invokeSolver("concentration_risk", cand.args)).data as ConcOut,
    retry: false,
  });
  if (isLoading) return <div className="empty-state">{zh.common.loading}</div>;
  if (isError || !data) return <SolverError testid="cr-cc-error" error={error} />;

  const top = data.topExposure;
  return (
    <div className="panel" data-testid="cr-cc-result">
      <div className="section-title">隐性集中单点 · 终端根 <span className="mono">{cand.rootType}</span></div>
      <div data-testid="cr-cc-summary" style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>{data.summary}</div>
      {!top || data.concentrations.length === 0 ? (
        <div className="empty-state" data-testid="cr-cc-empty" style={{ padding: 20, fontSize: 12 }}>
          无隐性集中：无根被 ≥2 个起点隐性依赖（真值·非编造）。
        </div>
      ) : (
        <>
          <div data-testid="cr-cc-top" className="panel" style={{ padding: "10px 12px", borderLeft: "3px solid var(--danger)", marginBottom: 10 }}>
            <div style={{ fontSize: 13 }}>
              最大敞口根 <b className="mono" style={{ color: "var(--danger)" }}>{top.rootId}</b>
              {" · 被 "}<b className="mono" data-testid="cr-cc-top-count">{top.count}</b>{" 个依赖方隐性依赖"}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>依赖方：{top.dependents.join("、")}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {data.concentrations.map((c) => {
              const w = top.count > 0 ? Math.round((c.count / top.count) * 100) : 0;
              return (
                <div key={c.rootId} data-testid={`cr-cc-row-${c.rootId}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                  <span className="mono" style={{ width: 120, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{c.rootId}</span>
                  <div style={{ flex: 1, height: 8, borderRadius: 5, background: "var(--line2)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${w}%`, background: "var(--accent)" }} />
                  </div>
                  <b className="mono" style={{ width: 28, textAlign: "right", flexShrink: 0 }}>{c.count}</b>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ══════════════════ ③ 毛利倒挂 ══════════════════
interface InvertedRow {
  id: string; revenue: number; totalCost: number; margin: number; marginRate: number;
  topDriver: { label: string; value: number; share: number } | null;
  attribution: { label: string; value: number; share: number }[];
}
interface RootDriver { label: string; invertedCount: number; totalValue: number }
interface MarginOut { inverted: InvertedRow[]; rootDrivers: RootDriver[]; invertedCount: number; summary: string }

function MarginBlock({ types }: { types: CrType[] }) {
  const cands = useMemo(() => marginCandidates(types), [types]);
  const [sel, setSel] = useState<string>(cands[0]?.primary ?? "");
  const cand: MarginCandidate | undefined = cands.find((c) => c.primary === sel) ?? cands[0];

  if (!cand) {
    return (
      <div className="empty-state" data-testid="cr-ma-nocandidate">
        <div className="code">🧩</div>
        <div style={{ fontWeight: 600, color: "var(--txt)" }}>无可归因的毛利结构</div>
        <div style={{ fontSize: 12, color: "var(--muted2)", maxWidth: 440, textAlign: "center", lineHeight: 1.7 }}>
          毛利倒挂需目标类型有营收字段 + ≥1 成本字段——当前对象类型倒推不出，诚实留空。
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="cr-ma">
      <PrimaryPicker
        testid="cr-ma-type"
        label="目标类型"
        options={cands.map((c) => ({ key: c.primary, label: c.primaryLabel }))}
        value={cand.primary}
        onChange={setSel}
        args={cand.args}
      />
      <MarginResult key={JSON.stringify(cand.args)} cand={cand} />
    </div>
  );
}

function MarginResult({ cand }: { cand: MarginCandidate }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["a", "margin_attribution", cand.args],
    queryFn: async () => (await invokeSolver("margin_attribution", cand.args)).data as MarginOut,
    retry: false,
  });
  if (isLoading) return <div className="empty-state">{zh.common.loading}</div>;
  if (isError || !data) return <SolverError testid="cr-ma-error" error={error} />;

  return (
    <div className="panel" data-testid="cr-ma-result">
      <div className="section-title">毛利倒挂根因 · 目标 <span className="mono">{cand.args.targetType}</span></div>
      <div data-testid="cr-ma-summary" style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>{data.summary}</div>
      {data.invertedCount === 0 ? (
        <div className="empty-state" data-testid="cr-ma-empty" style={{ padding: 20, fontSize: 12 }}>
          无倒挂：所选目标毛利率均达阈值（真值·非编造）。
        </div>
      ) : (
        <>
          <div className="section-title" style={{ fontSize: 12, marginTop: 4 }}>根因主驱动成本项（跨 {data.invertedCount} 个倒挂目标聚合）</div>
          <div style={{ overflowX: "auto" }}>
            <table className="cmp" data-testid="cr-ma-drivers" style={{ minWidth: 380 }}>
              <thead>
                <tr><th>主驱动成本项</th><th>拉穿目标数</th><th>累计金额</th></tr>
              </thead>
              <tbody>
                {data.rootDrivers.map((d) => (
                  <tr key={d.label} data-testid={`cr-ma-driver-${d.label}`}>
                    <td className="zh"><b>{d.label}</b></td>
                    <td className="mono" data-testid={`cr-ma-driver-count-${d.label}`}>{d.invertedCount}</td>
                    <td className="mono">{fmt(d.totalValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="section-title" style={{ fontSize: 12, marginTop: 12 }}>倒挂目标明细</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {data.inverted.map((r) => (
              <div key={r.id} data-testid={`cr-ma-inv-${r.id}`} className="panel" style={{ padding: "8px 10px", borderLeft: "3px solid var(--danger)" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
                  <b className="mono">{r.id}</b>
                  <span>营收 <b className="mono">{fmt(r.revenue)}</b> − 成本 <b className="mono">{fmt(r.totalCost)}</b></span>
                  <span>毛利 <b className="mono" style={{ color: "var(--danger)" }}>{fmt(r.margin)}</b>（{fmt(r.marginRate * 100)}%）</span>
                  {r.topDriver && <span className="badge red" style={{ fontSize: 9 }}>主驱动 {r.topDriver.label}</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
