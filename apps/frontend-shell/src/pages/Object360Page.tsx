import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchDomains, fetchNeighbors, fetchObjectByKey, fetchObjectTypes } from "@/api/endpoints";
import zh from "@/locales/zh";

/**
 * 治理增量 §5 对象 360 页（路由 /o/:typeKey/:objectKey）——溯源链的终点页。
 * 头部（display + 域色徽章 + objectKey）｜属性区（按元模型，带单位）｜
 * 关系区（按 linkKey 分组邻接，来源 = 检索 #4，可展开）。
 */
export default function Object360Page() {
  const { typeKey = "", objectKey = "" } = useParams();

  const objQuery = useQuery({
    queryKey: ["a", "object360", typeKey, objectKey],
    queryFn: () => fetchObjectByKey(typeKey, objectKey),
    enabled: !!typeKey && !!objectKey,
  });
  const typesQuery = useQuery({ queryKey: ["a", "object-types"], queryFn: fetchObjectTypes });
  const domainsQuery = useQuery({ queryKey: ["a", "domains"], queryFn: fetchDomains });

  const obj = objQuery.data?.data;
  const objectId = obj?.id ?? objectKey;
  const neighborsQuery = useQuery({
    queryKey: ["a", "object360-neighbors", objectId],
    queryFn: () => fetchNeighbors(objectId),
    enabled: !!obj,
  });

  if (objQuery.isLoading) return <div className="empty-state">{zh.common.loading}</div>;
  if (objQuery.isError || !obj) return <div className="empty-state" data-testid="o360-notfound">{zh.common.none}</div>;

  const typeDef = typesQuery.data?.find((t) => t.key === typeKey);
  const domain = domainsQuery.data?.find((d) => d.domainKey === typeDef?.domain);
  const display = String(obj.props.name ?? obj.props.displayName ?? objectKey);

  return (
    <div data-testid="object-360">
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>{display}</h2>
        {domain && (
          <span
            data-testid="o360-domain-badge"
            style={{ background: domain.color ?? "#888", color: "#fff", borderRadius: 4, padding: "2px 8px", fontSize: 12 }}
          >
            {domain.displayName}
          </span>
        )}
        <code data-testid="o360-objectkey" style={{ color: "#666" }}>{objectKey}</code>
      </header>

      <section data-testid="o360-properties">
        <h3>{zh.object360?.properties ?? "属性"}</h3>
        <table>
          <tbody>
            {(typeDef?.properties ?? Object.keys(obj.props).map((k) => ({ propKey: k, dataType: "string", isPrimaryKey: false, unit: undefined }))).map((p) => (
              <tr key={p.propKey} data-testid={`o360-prop-${p.propKey}`}>
                <th style={{ textAlign: "left", paddingRight: 16 }}>{p.propKey}</th>
                <td>
                  {String(obj.props[p.propKey] ?? "—")}
                  {p.unit ? <span style={{ color: "#999", marginLeft: 4 }}>{p.unit}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section data-testid="o360-relations">
        <h3>{zh.object360?.relations ?? "关系"}</h3>
        {neighborsQuery.isLoading && <div className="empty-state">{zh.common.loading}</div>}
        {(neighborsQuery.data?.groups ?? []).length === 0 && !neighborsQuery.isLoading && (
          <div className="empty-state">{zh.common.none}</div>
        )}
        {(neighborsQuery.data?.groups ?? []).map((g) => (
          <details key={`${g.linkKey}|${g.direction}`} data-testid={`o360-rel-${g.linkKey}`} open>
            <summary>
              {g.linkKey} · {g.direction === "out" ? "→" : "←"} · {g.total}
            </summary>
            <ul>
              {g.items.map((it) => (
                <li key={it.id}>
                  <a href={`/o/${encodeURIComponent(it.typeKey)}/${encodeURIComponent(it.objectKey)}`}>{it.display}</a>
                  <span style={{ color: "#999", marginLeft: 6 }}>({it.typeKey})</span>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </section>
    </div>
  );
}
