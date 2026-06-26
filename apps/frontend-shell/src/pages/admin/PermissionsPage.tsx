import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authzExplain, fetchPolicies, createPolicy, fetchObjectTypes } from "@/api/endpoints";
import { toastError } from "@/store/toastStore";
import zh from "@/locales/zh";
import { DslTextarea, type DslSchema } from "./DslTextarea";

const t = zh.admin.permissions;

const RESOURCE_KINDS = ["OBJECT_TYPE", "CONNECTION", "RULE_SET", "ACTION_TYPE"] as const;
const OPS = ["READ", "WRITE", "EXECUTE"] as const;

/** 权限策略 + 策略↔role 编辑器（C6/C11 评审返工） + authz explain 调试器（PRD §7.9） */
export default function PermissionsPage() {
  const { data: policies } = useQuery({ queryKey: ["a", "policies", {}], queryFn: fetchPolicies });

  return (
    <div>
      <h2 style={{ fontSize: 16, marginBottom: 14 }}>{t.title}</h2>
      <PolicyEditor />
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

/** C6/C11 评审返工：策略↔role 编辑器——资源 + role↔ops 授权 + rowFilter DSL（去裸缺/裸输入，POST /a/v1/policies）。 */
function PolicyEditor() {
  const qc = useQueryClient();
  const { data: objectTypes } = useQuery({ queryKey: ["a", "object-types"], queryFn: fetchObjectTypes });
  const [kind, setKind] = useState<string>("OBJECT_TYPE");
  const [resKey, setResKey] = useState("Base");
  const [grants, setGrants] = useState<{ role: string; ops: string[] }[]>([{ role: "", ops: ["READ"] }]);
  const [rowFilter, setRowFilter] = useState("");

  const dslSchema = useMemo<DslSchema>(
    () => ({ objectTypes: (objectTypes ?? []).map((t2) => ({ key: t2.key, props: t2.properties.map((p) => p.propKey) })), paramKeys: [], ruleCodes: [] }),
    [objectTypes],
  );

  const saveMut = useMutation({
    mutationFn: () =>
      createPolicy({ resource: { kind, key: resKey }, grants: grants.filter((g) => g.role.trim() && g.ops.length > 0), rowFilter: rowFilter.trim() || undefined }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["a", "policies", {}] }),
    onError: toastError,
  });

  const setGrant = (i: number, g: { role: string; ops: string[] }) => setGrants(grants.map((x, j) => (j === i ? g : x)));
  const toggleOp = (i: number, op: string) => {
    const g = grants[i]!;
    setGrant(i, { ...g, ops: g.ops.includes(op) ? g.ops.filter((o) => o !== op) : [...g.ops, op] });
  };

  return (
    <div className="panel" data-testid="policy-editor" style={{ marginBottom: 14 }}>
      <div className="section-title">新建权限策略（策略↔role 编辑）</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
        <label>资源类型
          <select value={kind} aria-label="资源类型" data-testid="policy-kind" onChange={(e) => setKind(e.target.value)} style={{ marginLeft: 4 }}>
            {RESOURCE_KINDS.map((k) => (<option key={k}>{k}</option>))}
          </select>
        </label>
        {kind === "OBJECT_TYPE" && (objectTypes ?? []).length > 0 ? (
          <label>资源 key
            <select value={resKey} aria-label="资源 key" data-testid="policy-reskey" onChange={(e) => setResKey(e.target.value)} style={{ marginLeft: 4 }}>
              {(objectTypes ?? []).map((o) => (<option key={o.key} value={o.key}>{o.key}</option>))}
            </select>
          </label>
        ) : (
          <input value={resKey} aria-label="资源 key" data-testid="policy-reskey" onChange={(e) => setResKey(e.target.value)} placeholder="资源 key" style={{ width: 160 }} />
        )}
      </div>
      <div className="section-title" style={{ fontSize: 12 }}>授权（role ↔ ops）</div>
      {grants.map((g, i) => (
        <div key={i} data-testid={`policy-grant-${i}`} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
          <input value={g.role} aria-label={`role-${i}`} data-testid={`policy-role-${i}`} onChange={(e) => setGrant(i, { ...g, role: e.target.value })} placeholder="role 键（如 viewer / base_manager:<范围>）" style={{ width: 200 }} />
          {OPS.map((op) => (
            <label key={op} className="badge" style={{ display: "flex", gap: 3, alignItems: "center" }}>
              <input type="checkbox" data-testid={`policy-op-${i}-${op}`} checked={g.ops.includes(op)} onChange={() => toggleOp(i, op)} />
              {op}
            </label>
          ))}
          {grants.length > 1 && (
            <button className="btn sm" data-testid={`policy-grant-del-${i}`} onClick={() => setGrants(grants.filter((_, j) => j !== i))}>删</button>
          )}
        </div>
      ))}
      <button className="btn sm" data-testid="policy-grant-add" onClick={() => setGrants([...grants, { role: "", ops: ["READ"] }])} style={{ marginBottom: 10 }}>＋ 加一行授权</button>
      <div className="section-title" style={{ fontSize: 12 }}>行级过滤 rowFilter（DSL · C11 补全辅助）</div>
      <DslTextarea
        value={rowFilter}
        onChange={setRowFilter}
        schema={dslSchema}
        testid="policy-rowfilter-dsl"
        ariaLabel="rowFilter DSL"
        style={{ marginBottom: 10 }}
      />
      <div>
        <button className="btn primary sm" data-testid="policy-save" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
          {saveMut.isPending ? "保存中…" : "保存策略"}
        </button>
        {saveMut.isSuccess && <span className="badge green" style={{ marginLeft: 8 }} data-testid="policy-saved">已保存</span>}
      </div>
    </div>
  );
}

function ExplainDebugger() {
  const [roles, setRoles] = useState("base_manager:常州"); // debattery-allow：角色输入框 demo 占位（参数化角色示例，用户自行覆写）
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
