import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchObjectTypeStats, fetchBusinessDomains, queryObjectsPaged, type ObjectTypeStat } from "@/api/endpoints";

/**
 * A4 · 对象/类型浏览器（消费 A3 14 域 + 物化计数 + 实例下钻）。闭合用户实测"找不到已发布对象类型在哪看"。
 * 列已发布类型（按 14 域分组）+ 物化对象数 → 点「看实例」→ 实例表 → 点行 → Object360/lineage。
 * R14 零业务常数：类型名/域/列全来自 API（stats + business-domains）。
 * 轨A P1 逐对象就绪%：每类型显示 readiness（真后端三维算：绑定覆盖 R12 / provenance 锚 / 已物化）+ 展开见分解证据；
 *   缺数（无源绑定）诚实标"估算"，不裸渲染 0%。零写死 R14 / 确定性 R6。
 */

/** 就绪%色阶（仅展示语义，非业务常数）：高绿 / 中橙 / 低红 / 估算灰。 */
function readinessColor(s: ObjectTypeStat): string {
  if (s.estimated) return "#888";
  if (s.readiness >= 80) return "#2e9e5b";
  if (s.readiness >= 50) return "#d08700";
  return "#c0392b";
}

/** 逐对象就绪%单元格：进度条 + 百分比 + 估算标记。 */
function ReadinessCell({ s }: { s: ObjectTypeStat }) {
  const color = readinessColor(s);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 140 }} data-testid={`ot-readiness-${s.key}`}>
      <div style={{ flex: 1, height: 8, background: "#e6e6e6", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${s.readiness}%`, height: "100%", background: color, transition: "width .2s" }} />
      </div>
      <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 12, color, minWidth: 56, textAlign: "right" }}>
        {s.readiness}%{s.estimated && <span className="muted" style={{ fontSize: 10 }}> 估算</span>}
      </span>
    </div>
  );
}

/** 就绪%三维分解证据行（真后端字段，展开可见）。 */
function ReadinessEvidence({ s }: { s: ObjectTypeStat }) {
  const pct = s.sourceProps > 0 ? Math.round((100 * s.boundCount) / s.sourceProps) : 0;
  return (
    <div className="muted" style={{ fontSize: 12, padding: "4px 0", lineHeight: 1.7 }} data-testid={`ot-readiness-evidence-${s.key}`}>
      <div>· 字段绑定覆盖（R12 provenance）：<b>{s.boundCount}/{s.sourceProps}</b>（{pct}%）{s.sourceProps === 0 && "（无源属性）"}</div>
      <div>· 有源绑定锚（sourceBindings）：<b>{s.hasBindings ? "是" : "否（无 provenance）"}</b></div>
      <div>· 已物化对象：<b>{s.materialized ? `是（${s.count}）` : "否（0）"}</b></div>
      {s.estimated && <div style={{ color: "#888" }}>· 该类型无源绑定 → 绑定覆盖维无数据，就绪%为<b>估算</b>（仅按 provenance/物化两维）。</div>}
      <div style={{ marginTop: 2 }}>就绪% = 60%×绑定覆盖 + 20%×有源绑定 + 20%×已物化（真后端确定性算）。</div>
    </div>
  );
}
function InstancePanel({ typeKey, pk, onClose }: { typeKey: string; pk: string | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ["a", "ot-instances", typeKey], queryFn: () => queryObjectsPaged(typeKey, 1, 20, {}) });
  const rows = q.data?.items ?? [];
  return (
    <div className="panel" style={{ marginTop: 12 }} data-testid="ot-instance-panel">
      <div className="section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        实例 · <code>{typeKey}</code> <span className="badge">{q.data?.total ?? rows.length}</span>
        <button className="btn sm" style={{ marginLeft: "auto" }} onClick={onClose} data-testid="ot-instance-close">关闭</button>
      </div>
      {rows.length === 0 && <div className="muted" style={{ fontSize: 13 }}>无物化实例。</div>}
      {rows.length > 0 && (
        <table className="cmp">
          <thead><tr><th>{pk ?? "id"}</th><th>属性预览</th><th /></tr></thead>
          <tbody>
            {rows.map((o) => {
              const keyVal = pk && o.props[pk] != null ? String(o.props[pk]) : o.id;
              const preview = Object.entries(o.props).filter(([k]) => k !== pk).slice(0, 3).map(([k, v]) => `${k}=${String(v)}`).join(" · ");
              return (
                <tr key={o.id} data-testid={`ot-inst-${o.id}`}>
                  <td><Link to={`/o/${encodeURIComponent(o.type)}/${encodeURIComponent(keyVal)}`} data-testid={`ot-inst-link-${o.id}`}>{keyVal}</Link></td>
                  <td className="muted" style={{ fontSize: 12 }}>{preview}</td>
                  <td><Link className="btn sm" to={`/o/${encodeURIComponent(o.type)}/${encodeURIComponent(keyVal)}`}>360 →</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function ObjectTypesBrowserPage() {
  const statsQ = useQuery({ queryKey: ["a", "object-type-stats"], queryFn: fetchObjectTypeStats });
  const domQ = useQuery({ queryKey: ["a", "business-domains"], queryFn: fetchBusinessDomains });
  const [domainFilter, setDomainFilter] = useState("");
  const [kw, setKw] = useState("");
  const [onlyMaterialized, setOnlyMaterialized] = useState(false);
  const [selected, setSelected] = useState<ObjectTypeStat | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const stats = statsQ.data?.stats ?? [];
  const domains = domQ.data?.domains ?? [];
  const domLabel = (k: string) => domains.find((d) => d.key === k)?.displayName ?? k;
  const domColor = (k: string) => domains.find((d) => d.key === k)?.color ?? "#888";

  const filtered = stats.filter(
    (s) =>
      (!domainFilter || s.domain === domainFilter) &&
      (!kw || s.key.toLowerCase().includes(kw.toLowerCase()) || s.displayName.includes(kw)) &&
      (!onlyMaterialized || s.count > 0),
  );
  const byDomain = new Map<string, ObjectTypeStat[]>();
  for (const s of filtered) {
    if (!byDomain.has(s.domain)) byDomain.set(s.domain, []);
    byDomain.get(s.domain)!.push(s);
  }

  return (
    <div data-testid="object-types-page">
      <h2 style={{ fontSize: 16, marginBottom: 12 }}>对象/类型浏览器</h2>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, fontSize: 12, flexWrap: "wrap" }}>
        <select data-testid="ot-domain-filter" value={domainFilter} onChange={(e) => setDomainFilter(e.target.value)}>
          <option value="">全部域（{domains.length}）</option>
          {domains.map((d) => <option key={d.key} value={d.key}>{d.displayName}</option>)}
        </select>
        <input data-testid="ot-keyword" value={kw} onChange={(e) => setKw(e.target.value)} placeholder="搜索类型/键" style={{ fontSize: 12 }} />
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" data-testid="ot-only-mat" checked={onlyMaterialized} onChange={(e) => setOnlyMaterialized(e.target.checked)} />
          仅有物化
        </label>
        <span className="muted" data-testid="ot-count">{filtered.length} / {stats.length} 类型</span>
      </div>

      {stats.length === 0 && <div className="muted" style={{ fontSize: 13 }} data-testid="ot-empty">尚无已发布对象类型。先经数据构建发动机/合成建域。</div>}

      {[...byDomain.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([dom, rows]) => {
        // 域内平均就绪%（估算类型不计入分母，避免拉低误导）。
        const measured = rows.filter((r) => !r.estimated);
        const domAvg = measured.length > 0 ? Math.round(measured.reduce((a, r) => a + r.readiness, 0) / measured.length) : null;
        return (
        <div key={dom} className="panel" style={{ marginBottom: 10 }} data-testid={`ot-domain-${dom}`}>
          <div className="section-title" style={{ borderLeft: `3px solid ${domColor(dom)}`, paddingLeft: 8, display: "flex", alignItems: "center", gap: 8 }}>
            {domLabel(dom)} <span className="badge">{rows.length}</span>
            {domAvg != null && (
              <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }} data-testid={`ot-domain-avg-${dom}`}>
                域均就绪 {domAvg}%（{measured.length} 已测{measured.length < rows.length ? ` · ${rows.length - measured.length} 估算` : ""}）
              </span>
            )}
          </div>
          <table className="cmp">
            <thead><tr><th /><th>类型</th><th>就绪%</th><th>属性(源/派生)</th><th>主键</th><th>物化数</th><th /></tr></thead>
            <tbody>
              {rows.map((s) => {
                const isOpen = expanded.has(s.key);
                return (
                <Fragment key={s.key}>
                <tr data-testid={`ot-row-${s.key}`}>
                  <td style={{ width: 24 }}>
                    <button className="btn sm" style={{ padding: "0 6px" }} aria-expanded={isOpen} data-testid={`ot-expand-${s.key}`} onClick={() => toggleExpand(s.key)}>{isOpen ? "▾" : "▸"}</button>
                  </td>
                  <td><b className="zh">{s.displayName}</b> <code style={{ fontSize: 11 }}>{s.key}</code></td>
                  <td><ReadinessCell s={s} /></td>
                  <td>{s.propCount}/{s.derivedCount}</td>
                  <td>{s.pk ?? "—"}</td>
                  <td data-testid={`ot-count-${s.key}`}>
                    {s.count > 0 ? <span className="badge green">{s.count}</span> : <span className="muted">0</span>}
                  </td>
                  <td>
                    <button className="btn sm" data-testid={`ot-instances-${s.key}`} disabled={s.count === 0} onClick={() => setSelected(s)}>看实例 →</button>
                  </td>
                </tr>
                {isOpen && (
                  <tr>
                    <td />
                    <td colSpan={6}><ReadinessEvidence s={s} /></td>
                  </tr>
                )}
                </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        );
      })}

      {selected && <InstancePanel typeKey={selected.key} pk={selected.pk} onClose={() => setSelected(null)} />}
    </div>
  );
}
