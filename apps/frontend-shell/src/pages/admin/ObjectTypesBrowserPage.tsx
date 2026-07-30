import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchObjectTypeStats, fetchBusinessDomains, queryObjectsPaged, type ObjectTypeStat } from "@/api/endpoints";

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
        {/* WO-UNIT-MEANING：徽章此前只有裸数「20」——是实例数还是页码看不出。计数无 unit 契约，就近点明"个实例"。 */}
        实例 · <code>{typeKey}</code> <span className="badge" data-testid="ot-instance-total">共 {q.data?.total ?? rows.length} 个实例</span>
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
            {domLabel(dom)} <span className="badge" data-testid={`ot-domain-count-${dom}`}>{rows.length} 个类型</span>
          </div>
          {/* WO-UNIT-MEANING：「物化数」的格子是**已物化对象条数**，列头点明单位（个），避免与"属性数"混读。 */}
          <table className="cmp">
            <thead><tr><th>类型</th><th>属性数(源/派生·个)</th><th>主键</th><th>物化对象数(个)</th><th /></tr></thead>
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
                    <button className="btn sm" data-testid={`ot-instances-${s.key}`} disabled={s.count === 0} onClick={() => setSelected(s)}>看实例 →</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {selected && <InstancePanel typeKey={selected.key} pk={selected.pk} onClose={() => setSelected(null)} />}
    </div>
  );
}
