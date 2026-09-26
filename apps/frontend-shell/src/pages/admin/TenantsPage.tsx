import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createTenant, createTenantUser, fetchTenants } from "@/api/endpoints";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";

const t = zh.admin.tenants;

/** 管理平台增量 §2：租户管理（仅 platform_admin）—— 列表 + 创建 + 首管理员创建。 */
export default function TenantsPage() {
  const queryClient = useQueryClient();
  const { data: tenants } = useQuery({ queryKey: ["a", "tenants", {}], queryFn: fetchTenants });
  const [createOpen, setCreateOpen] = useState(false);
  const [adminFor, setAdminFor] = useState<string | null>(null);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["a", "tenants"] });

  return (
    <div style={{ maxWidth: 880 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ fontSize: 16 }}>{t.title}</h2>
        <button className="btn primary sm" style={{ marginLeft: "auto" }} onClick={() => setCreateOpen(true)} data-testid="tenant-create">
          {t.create}
        </button>
      </div>
      <div className="panel">
        {(tenants ?? []).length === 0 ? (
          <EmptyState message={zh.common.none}>
            <button className="btn primary sm" onClick={() => setCreateOpen(true)}>
              {t.create}
            </button>
          </EmptyState>
        ) : (
          <table className="cmp">
            <thead>
              <tr>
                <th>{t.key}</th>
                <th>{t.name}</th>
                <th>{t.industry}</th>
                <th>{t.status}</th>
                <th>{t.createdAt}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(tenants ?? []).map((x) => (
                <tr key={x.id} data-testid={`tenant-${x.id}`}>
                  <td className="mono">{x.key}</td>
                  <td className="zh">{x.name}</td>
                  <td>{x.industry ?? "—"}</td>
                  <td>
                    <span className={`badge ${x.status === "ACTIVE" ? "green" : "red"}`}>{x.status}</span>
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>{x.createdAt?.slice(0, 10) ?? "—"}</td>
                  <td>
                    <button className="btn sm" onClick={() => setAdminFor(x.id)} data-testid={`tenant-first-admin-${x.id}`}>
                      {t.firstAdmin}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {createOpen && (
        <CreateTenantModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            invalidate();
          }}
        />
      )}
      {adminFor && <FirstAdminModal tenantId={adminFor} onClose={() => setAdminFor(null)} />}
    </div>
  );
}

function CreateTenantModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const mut = useMutation({
    mutationFn: () => createTenant({ key, name, industry: industry || undefined }),
    onSuccess: () => {
      toast(t.created, "success");
      onCreated();
    },
    onError: toastError,
  });
  return (
    <Modal title={t.create} onClose={onClose} width={420}>
      <label style={{ fontSize: 12, color: "var(--muted)" }}>
        {t.key}
        <input style={{ width: "100%" }} value={key} onChange={(e) => setKey(e.target.value)} data-testid="tenant-key-input" />
      </label>
      <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginTop: 8 }}>
        {t.name}
        <input style={{ width: "100%" }} value={name} onChange={(e) => setName(e.target.value)} data-testid="tenant-name-input" />
      </label>
      <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginTop: 8 }}>
        {t.industry}
        <input style={{ width: "100%" }} value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="battery-manufacturing" />
      </label>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <button className="btn" onClick={onClose}>
          {zh.common.cancel}
        </button>
        <button className="btn primary" disabled={!key || !name || mut.isPending} onClick={() => mut.mutate()} data-testid="tenant-save">
          {zh.common.save}
        </button>
      </div>
    </Modal>
  );
}

/** 新租户最小可用路径第一步：创建首个 tenant_admin（初始密码一次性展示）。 */
function FirstAdminModal({ tenantId, onClose }: { tenantId: string; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: () => createTenantUser(tenantId, { email, roles: ["tenant_admin"] }),
    onSuccess: (r) => {
      setPassword(r.initialPassword ?? "");
      toast(t.adminCreated(r.initialPassword ?? "（自定义）"), "success");
    },
    onError: toastError,
  });
  return (
    <Modal title={`${t.firstAdmin} · ${tenantId}`} onClose={onClose} width={420}>
      {password == null ? (
        <>
          <label style={{ fontSize: 12, color: "var(--muted)" }}>
            {t.firstAdminEmail}
            <input style={{ width: "100%" }} value={email} onChange={(e) => setEmail(e.target.value)} data-testid="first-admin-email" />
          </label>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <button className="btn" onClick={onClose}>
              {zh.common.cancel}
            </button>
            <button className="btn primary" disabled={!email.includes("@") || mut.isPending} onClick={() => mut.mutate()} data-testid="first-admin-save">
              {zh.common.create}
            </button>
          </div>
        </>
      ) : (
        <div data-testid="first-admin-password">
          <div className="mono" style={{ fontSize: 13, padding: "8px 0" }}>
            {t.adminCreated(password)}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn primary" onClick={onClose}>
              {zh.common.close}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
