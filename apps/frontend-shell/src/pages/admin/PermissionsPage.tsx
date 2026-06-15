import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { authzExplain, fetchPolicies } from "@/api/endpoints";
import { toastError } from "@/store/toastStore";
import zh from "@/locales/zh";

const t = zh.admin.permissions;

/** 权限策略 + authz explain 调试器（PRD §7.9） */
export default function PermissionsPage() {
  const { data: policies } = useQuery({ queryKey: ["a", "policies", {}], queryFn: fetchPolicies });

  return (
    <div>
      <h2 style={{ fontSize: 16, marginBottom: 14 }}>{t.title}</h2>
      <div className="panel" style={{ marginBottom: 14 }}>
        <table className="cmp">
          <thead>
            <tr>
              <th>资源</th>
              <th>授权矩阵</th>
              <th>rowFilter</th>
            </tr>
          </thead>
          <tbody>
            {(policies ?? []).map((p) => (
              <tr key={p.id}>
                <td>
                  <span className="badge">{p.resource.kind}</span> <span className="zh">{p.resource.key}</span>
                </td>
                <td className="zh">
                  {p.grants.map((g) => (
                    <div key={g.role}>
                      <span className="badge blue">{g.role}</span> {g.ops.join("/")}
                    </div>
                  ))}
                </td>
                <td>{p.rowFilter ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ExplainDebugger />
    </div>
  );
}

function ExplainDebugger() {
  const [roles, setRoles] = useState("base_manager:常州");
  const [kind, setKind] = useState("OBJECT_TYPE");
  const [key, setKey] = useState("Base");
  const [op, setOp] = useState("READ");

  const explainMut = useMutation({
    mutationFn: () =>
      authzExplain({
        user: { roles: roles.split(",").map((r) => r.trim()), attributes: {} },
        resource: { kind, key },
        op,
      }),
    onError: toastError,
  });

  return (
    <div className="panel" data-testid="authz-explain">
      <div className="section-title">{t.explain}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <input value={roles} aria-label="角色" onChange={(e) => setRoles(e.target.value)} style={{ width: 220 }} />
        <select value={kind} aria-label="资源类型" onChange={(e) => setKind(e.target.value)}>
          {["OBJECT_TYPE", "CONNECTION", "RULE_SET", "ACTION_TYPE"].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <input value={key} aria-label="资源 key" onChange={(e) => setKey(e.target.value)} style={{ width: 140 }} />
        <select value={op} aria-label="操作" onChange={(e) => setOp(e.target.value)}>
          {["READ", "WRITE", "EXECUTE"].map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
        <button className="btn primary sm" onClick={() => explainMut.mutate()} disabled={explainMut.isPending}>
          {t.explainRun}
        </button>
      </div>
      {explainMut.data && (
        <div data-testid="explain-result">
          <div style={{ marginBottom: 8 }}>
            <span className={`badge ${explainMut.data.allowed ? "green" : "red"}`}>{explainMut.data.allowed ? "ALLOW" : "DENY"}</span>
          </div>
          <div className="section-title">{t.matchedPolicies}</div>
          {explainMut.data.matched.map((m) => (
            <div key={m.policyId} className="mono" style={{ fontSize: 11.5, color: "var(--muted)" }}>
              {m.policyId} · {m.resource} · {m.grants}
            </div>
          ))}
          <div className="section-title" style={{ marginTop: 8 }}>
            {t.rowFilter}
          </div>
          <div className="mono" style={{ fontSize: 11.5 }}>{explainMut.data.rowFilter ?? "—"}</div>
        </div>
      )}
    </div>
  );
}
