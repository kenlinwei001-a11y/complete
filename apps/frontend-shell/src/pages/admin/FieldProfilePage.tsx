import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchConnectionSchema } from "@/api/endpoints";
import zh from "@/locales/zh";

const t = zh.admin.connections;

const TYPE_BADGES: Record<string, string> = {
  string: "blue",
  number: "green",
  boolean: "amber",
  date: "amber",
  json: "",
};

/** 字段画像页（PRD §7.4）：数据集表 + FieldProfile 表（类型徽章/枚举候选 chips/空值率条） */
export default function FieldProfilePage() {
  const { connId = "" } = useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["a", "conn-schema", { connId }],
    queryFn: () => fetchConnectionSchema(connId),
    enabled: connId !== "",
  });

  if (isLoading || !data) return <div className="empty-state">{zh.common.loading}</div>;

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Link to="/admin/connections">← {zh.common.back}</Link>
      </div>
      <h2 style={{ fontSize: 16, marginBottom: 14 }}>{t.fieldProfile}</h2>
      {data.datasets.map((ds) => (
        <div className="panel" key={ds.name} style={{ marginBottom: 14 }} data-testid={`dataset-${ds.name}`}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <strong className="mono">{ds.name}</strong>
            {ds.kind === "TIMESERIES" && (
              <>
                <span className="badge amber">TIMESERIES</span>
                {ds.timeField && <span className="badge">time: {ds.timeField}</span>}
                {ds.entityRefField && <span className="badge">entity: {ds.entityRefField}</span>}
              </>
            )}
          </div>
          <table className="cmp">
            <thead>
              <tr>
                <th>字段</th>
                <th>类型</th>
                <th>{t.nullRate}</th>
                <th>{t.uniqueRate}</th>
                <th>{t.enumCandidates}</th>
                <th>样本</th>
              </tr>
            </thead>
            <tbody>
              {ds.fields.map((f) => (
                <tr key={f.name} data-testid={`field-${f.name}`}>
                  <td>{f.name}</td>
                  <td>
                    <span className={`badge ${TYPE_BADGES[f.inferredType] ?? ""}`}>{f.inferredType}</span>
                  </td>
                  <td style={{ minWidth: 120 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ flex: 1, height: 4, background: "var(--bg2)", borderRadius: 2 }}>
                        <div
                          style={{
                            width: `${Math.round(f.nullRate * 100)}%`,
                            height: "100%",
                            background: f.nullRate > 0.3 ? "var(--danger)" : "var(--c-capacity)",
                            borderRadius: 2,
                          }}
                        />
                      </div>
                      <span style={{ fontSize: 10 }}>{(f.nullRate * 100).toFixed(0)}%</span>
                    </div>
                  </td>
                  <td>{(f.uniqueRate * 100).toFixed(0)}%</td>
                  <td className="zh">
                    {(f.enumCandidates ?? []).map((e) => (
                      <span key={e} className="badge" style={{ marginRight: 4 }}>
                        {e}
                      </span>
                    ))}
                  </td>
                  <td style={{ color: "var(--muted2)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.samples.slice(0, 3).map(String).join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
