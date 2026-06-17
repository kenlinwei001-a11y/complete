import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchDomains } from "@/api/endpoints";
import { api } from "@/api/apiClient";
import { toastError, toast } from "@/store/toastStore";

/**
 * 域管理（本体治理增量 §1：域升为一等治理单元）：列出域 + 新建域（归域、颜色、负责人）。
 * 后端 `GET/POST /a/v1/ontology/domains` 已就绪，本页补前端治理面。
 */
export default function DomainsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["a", "ontology-domains"], queryFn: fetchDomains });
  const domains = data ?? [];
  const [domainKey, setDomainKey] = useState("");
  const [displayName, setDisplayName] = useState("");

  const create = useMutation({
    mutationFn: () => api.a<{ domainKey: string }>("/a/v1/ontology/domains", { method: "POST", body: { domainKey, displayName } }),
    onSuccess: () => {
      toast("域已创建", "success");
      setDomainKey(""); setDisplayName("");
      void qc.invalidateQueries({ queryKey: ["a", "ontology-domains"] });
    },
    onError: toastError,
  });

  return (
    <div data-testid="domains-page">
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>域管理</h2>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>
        域是一等治理单元——对象类型归域、按域分组图谱、域 owner 会签发布。
      </div>
      <div className="panel" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
        <input data-testid="domain-key" placeholder="domainKey（如 supplier）" value={domainKey} onChange={(e) => setDomainKey(e.target.value)} style={{ width: 180 }} />
        <input data-testid="domain-name" placeholder="显示名（如 供应商域）" value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={{ width: 180 }} />
        <button className="btn primary sm" data-testid="domain-create" disabled={create.isPending || !domainKey.trim()} onClick={() => create.mutate()}>新建域</button>
      </div>
      <table className="cmp" data-testid="domains-table" style={{ width: "100%" }}>
        <thead><tr><th>域键</th><th>显示名</th><th>颜色</th></tr></thead>
        <tbody>
          {domains.map((d) => (
            <tr key={d.domainKey} data-testid={`domain-${d.domainKey}`}>
              <td className="mono">{d.domainKey}</td>
              <td>{d.displayName}</td>
              <td>{d.color ? <span style={{ display: "inline-block", width: 14, height: 14, borderRadius: 3, background: d.color, verticalAlign: "middle" }} /> : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {domains.length === 0 && <div className="empty-state">暂无域</div>}
    </div>
  );
}
