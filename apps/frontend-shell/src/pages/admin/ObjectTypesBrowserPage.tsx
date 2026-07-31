import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchObjectTypeStats, fetchBusinessDomains, fetchObjectTypes, queryObjectsPaged, type ObjectTypeStat, type ObjectTypeVM } from "@/api/endpoints";

/**
 * A4 · 对象/类型浏览器（消费 A3 14 域 + 物化计数 + 实例下钻）。闭合用户实测"找不到已发布对象类型在哪看"。
 * 列已发布类型（按 14 域分组）+ 物化对象数 → 点「看实例」→ 实例表 → 点行 → Object360/lineage。
 * R14 零业务常数：类型名/域/列全来自 API（stats + business-domains）。
 */
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

/**
 * WO-63 · 口径面板："这个概念在业务里指什么" + 逐属性中文名/单位/口径。
 *
 * 全部字段来自后端本体（businessDefinition / displayName / unit / unitExempt / description）——
 * 前端零硬编码中文属性名与单位（R14）：后端改一个 unit，这里显示的就跟着变。
 * 缺口径的属性诚实显示「—」，不用套话补位。
 */
function SemanticsPanel({ type, onClose }: { type: ObjectTypeVM; onClose: () => void }) {
  const bd = type.businessDefinition;
  const unitCell = (p: ObjectTypeVM["properties"][number]) => {
    if (p.unit) return <span className="badge" data-testid={`ot-sem-unit-${p.propKey}`}>{p.unit}</span>;
    if (p.unitExempt === "dimensionless") return <span className="muted" title="天然无量纲（比率/系数/序号/计数）——诚实不填单位">无量纲</span>;
    if (p.unitExempt === "per-row") return <span className="muted" title="量纲逐行承载：由同对象的判别字段给出">随行</span>;
    return <span className="muted">—</span>;
  };
  return (
    <div className="panel" style={{ marginTop: 12 }} data-testid="ot-semantics-panel">
      <div className="section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        口径 · <b className="zh">{type.displayName}</b> <code style={{ fontSize: 11 }}>{type.key}</code>
        <button className="btn sm" style={{ marginLeft: "auto" }} onClick={onClose} data-testid="ot-semantics-close">关闭</button>
      </div>
      {bd ? (
        <div style={{ fontSize: 12.5, lineHeight: 1.7, marginBottom: 10 }} data-testid="ot-biz-def">
          <div>{bd.statement}</div>
          {bd.excludes && <div className="muted" data-testid="ot-biz-excludes" style={{ marginTop: 4 }}>边界 · {bd.excludes}</div>}
          {bd.rationale && <div className="muted" style={{ marginTop: 4 }}>取舍 · {bd.rationale}</div>}
          {(bd.decidedBy || bd.decidedAt) && (
            <div className="muted" data-testid="ot-biz-source" style={{ marginTop: 4, fontSize: 11.5 }}>
              定义来源 · {bd.decidedBy ?? "未记录"}{bd.decidedAt ? ` · ${bd.decidedAt}` : ""}
            </div>
          )}
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }} data-testid="ot-biz-def-empty">
          该类型尚未录入业务定义（「是什么 / 谁不算 / 谁定的」）——诚实留空，不以字段名充数。
        </div>
      )}
      <table className="cmp">
        <thead><tr><th>属性</th><th>类型</th><th>单位</th><th>口径</th></tr></thead>
        <tbody>
          {type.properties.map((p) => (
            <tr key={p.propKey} data-testid={`ot-sem-row-${p.propKey}`}>
              <td>
                <b className="zh">{p.displayName ?? p.propKey}</b> <code style={{ fontSize: 11 }}>{p.propKey}</code>
                {p.isPrimaryKey && <span title="主键"> ★</span>}
              </td>
              <td><span className="badge">{p.dataType}</span></td>
              <td>{unitCell(p)}</td>
              <td className="muted" style={{ fontSize: 12 }} title={p.description ?? ""}>{p.description ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
  // WO-63：口径面板的数据源 = 已发布本体全量（含 businessDefinition 与逐属性口径）。
  const typesQ = useQuery({ queryKey: ["a", "object-types"], queryFn: fetchObjectTypes });
  const [semKey, setSemKey] = useState<string | null>(null);
  const semType = (typesQ.data ?? []).find((t) => t.key === semKey) ?? null;

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

      {[...byDomain.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([dom, rows]) => (
        <div key={dom} className="panel" style={{ marginBottom: 10 }} data-testid={`ot-domain-${dom}`}>
          <div className="section-title" style={{ borderLeft: `3px solid ${domColor(dom)}`, paddingLeft: 8 }}>
            {domLabel(dom)} <span className="badge">{rows.length}</span>
          </div>
          <table className="cmp">
            <thead><tr><th>类型</th><th>属性(源/派生)</th><th>主键</th><th>物化数</th><th /><th /></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.key} data-testid={`ot-row-${s.key}`}>
                  <td><b className="zh">{s.displayName}</b> <code style={{ fontSize: 11 }}>{s.key}</code></td>
                  <td>{s.propCount}/{s.derivedCount}</td>
                  <td>{s.pk ?? "—"}</td>
                  <td data-testid={`ot-count-${s.key}`}>
                    {s.count > 0 ? <span className="badge green">{s.count}</span> : <span className="muted">0</span>}
                  </td>
                  <td>
                    <button className="btn sm" data-testid={`ot-semantics-${s.key}`} onClick={() => setSemKey(s.key)}>口径 →</button>
                  </td>
                  <td>
                    <button className="btn sm" data-testid={`ot-instances-${s.key}`} disabled={s.count === 0} onClick={() => setSelected(s)}>看实例 →</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {semType && <SemanticsPanel type={semType} onClose={() => setSemKey(null)} />}
      {selected && <InstancePanel typeKey={selected.key} pk={selected.pk} onClose={() => setSelected(null)} />}
    </div>
  );
}
