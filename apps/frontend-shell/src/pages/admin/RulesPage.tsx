import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchRules } from "@/api/endpoints";
import zh from "@/locales/zh";

/** 规则库（A5） */
export default function RulesPage() {
  const { data: rules } = useQuery({ queryKey: ["a", "rules", {}], queryFn: fetchRules });
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div>
      <h2 style={{ fontSize: 16, marginBottom: 14 }}>{zh.nav.rules}</h2>
      <div className="panel">
        <table className="cmp">
          <thead>
            <tr>
              <th>key</th>
              <th>名称</th>
              <th>severity</th>
              <th>作用域</th>
              <th>来源</th>
              <th>状态</th>
              <th>v</th>
            </tr>
          </thead>
          <tbody>
            {(rules ?? []).map((r) => (
              <Fragment key={r.id}>
                <tr style={{ cursor: "pointer" }} onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <td>
                    <span className="badge blue">{r.key}</span>
                  </td>
                  <td className="zh">{r.name}</td>
                  <td>
                    <span className={`badge ${r.severity === "BLOCK" ? "red" : r.severity === "WARN" ? "amber" : ""}`}>{r.severity}</span>
                  </td>
                  <td className="zh">{r.scopeObjectTypes.join(", ")}</td>
                  <td>{r.origin.type}</td>
                  <td>
                    <span className={`badge ${r.status === "PUBLISHED" ? "green" : ""}`}>{r.status}</span>
                  </td>
                  <td>{r.version}</td>
                </tr>
                {open === r.id && (
                  <tr>
                    <td colSpan={7}>
                      <div className="mono" style={{ fontSize: 11.5, padding: "6px 8px", background: "var(--bg2)", borderRadius: 6 }}>
                        {r.expression}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
