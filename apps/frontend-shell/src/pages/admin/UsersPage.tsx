import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminUser } from "@platform/contracts";
import { createTenantUser, fetchRoles, fetchTenantUsers, patchTenantUser, resetUserPassword } from "@/api/endpoints";
import { useWorkspace } from "@/workspace/useWorkspace";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";

const t = zh.admin.users;

/** 参数化角色基（base_manager:常州 形态）。 */
const PARAM_ROLE_BASES = ["base_manager"];

/** 管理平台增量 §2：用户管理（tenant_admin）—— 邮箱/角色 chips/属性编辑/状态开关/重置密码。 */
export default function UsersPage() {
  const queryClient = useQueryClient();
  const { data: workspace } = useWorkspace();
  const tenantId = workspace?.tenant.id ?? "";
  const { data: users } = useQuery({
    queryKey: ["a", "tenant-users", { tenantId }],
    queryFn: () => fetchTenantUsers(tenantId),
    enabled: tenantId !== "",
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["a", "tenant-users"] });

  const statusMut = useMutation({
    mutationFn: (u: AdminUser) => patchTenantUser(tenantId, u.id, { status: u.status === "ACTIVE" ? "DISABLED" : "ACTIVE" }),
    onSuccess: () => {
      toast(t.saved, "success");
      invalidate();
    },
    onError: toastError,
  });

  const resetMut = useMutation({
    mutationFn: (id: string) => resetUserPassword(id),
    onSuccess: (r) => toast(t.resetDone(r.password), "success"),
    onError: toastError,
  });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ fontSize: 16 }}>{t.title}</h2>
        <button className="btn primary sm" style={{ marginLeft: "auto" }} onClick={() => setCreateOpen(true)} data-testid="user-create">
          {t.create}
        </button>
      </div>
      <div className="panel">
        {(users ?? []).length === 0 ? (
          <EmptyState message={zh.common.none}>
            <button className="btn primary sm" onClick={() => setCreateOpen(true)}>
              {t.create}
            </button>
          </EmptyState>
        ) : (
          <table className="cmp">
            <thead>
              <tr>
                <th>{t.email}</th>
                <th>{t.displayName}</th>
                <th>{t.roles}</th>
                <th>{t.status}</th>
                <th>{t.lastLoginAt}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(users ?? []).map((u) => (
                <tr key={u.id} data-testid={`user-${u.username}`}>
                  <td className="mono" style={{ fontSize: 12 }}>{u.email}</td>
                  <td className="zh">{u.displayName}</td>
                  <td>
                    {u.roles.map((r) => (
                      <span key={r} className="badge blue" style={{ marginRight: 4 }} data-testid={`role-chip-${u.username}-${r}`}>
                        {r}
                      </span>
                    ))}
                  </td>
                  <td>
                    <button
                      className={`btn sm ${u.status === "ACTIVE" ? "" : "danger"}`}
                      onClick={() => statusMut.mutate(u)}
                      data-testid={`user-status-${u.username}`}
                      title={u.status === "ACTIVE" ? t.disable : t.enable}
                    >
                      {u.status === "ACTIVE" ? "ACTIVE" : "DISABLED"}
                    </button>
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>{u.lastLoginAt?.slice(0, 16).replace("T", " ") ?? "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn sm" onClick={() => setEditing(u)} data-testid={`user-edit-${u.username}`}>
                      {zh.common.edit}
                    </button>{" "}
                    <button className="btn sm" onClick={() => resetMut.mutate(u.id)} data-testid={`user-reset-${u.username}`}>
                      {t.resetPassword}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {createOpen && (
        <UserModal
          tenantId={tenantId}
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            invalidate();
          }}
        />
      )}
      {editing && (
        <UserModal
          tenantId={tenantId}
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

/** 创建/编辑共用：角色选择器带参数化角色的参数输入 + 属性 JSON 编辑器。 */
function UserModal({ tenantId, user, onClose, onSaved }: { tenantId: string; user?: AdminUser; onClose: () => void; onSaved: () => void }) {
  const { data: roleInfo } = useQuery({ queryKey: ["a", "roles", {}], queryFn: fetchRoles });
  const [email, setEmail] = useState(user?.email ?? "");
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [roles, setRoles] = useState<string[]>(user?.roles ?? []);
  const [attrText, setAttrText] = useState(JSON.stringify(user?.attributes ?? {}, null, 2));
  const [roleToAdd, setRoleToAdd] = useState("");
  const [roleParam, setRoleParam] = useState("");
  const [attrError, setAttrError] = useState<string | null>(null);

  const options = [...new Set([...(roleInfo?.builtIn ?? []), ...PARAM_ROLE_BASES, ...(roleInfo?.inUse ?? []).map((r) => r.split(":")[0]!)])].filter(
    (r) => r !== "platform_admin",
  );
  const needsParam = PARAM_ROLE_BASES.includes(roleToAdd);

  const addRole = () => {
    const full = needsParam && roleParam ? `${roleToAdd}:${roleParam}` : roleToAdd;
    if (full && !roles.includes(full)) setRoles([...roles, full]);
    setRoleToAdd("");
    setRoleParam("");
  };

  const mut = useMutation({
    mutationFn: () => {
      let attributes: Record<string, unknown>;
      try {
        attributes = JSON.parse(attrText || "{}") as Record<string, unknown>;
      } catch {
        setAttrError("JSON 解析失败");
        throw new Error("attributes JSON 解析失败");
      }
      setAttrError(null);
      return user
        ? patchTenantUser(tenantId, user.id, { displayName, roles, attributes })
        : createTenantUser(tenantId, { email, displayName: displayName || undefined, roles, attributes });
    },
    onSuccess: (r) => {
      const pw = (r as { initialPassword?: string }).initialPassword;
      toast(pw ? `${t.saved} · 初始密码：${pw}` : t.saved, "success");
      onSaved();
    },
    onError: (e) => {
      if (!(e instanceof Error && e.message.includes("JSON"))) toastError(e);
    },
  });

  return (
    <Modal title={user ? `${zh.common.edit} · ${user.email}` : t.create} onClose={onClose} width={520}>
      {!user && (
        <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 8 }}>
          {t.email}
          <input style={{ width: "100%" }} value={email} onChange={(e) => setEmail(e.target.value)} data-testid="user-email" />
        </label>
      )}
      <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 8 }}>
        {t.displayName}
        <input style={{ width: "100%" }} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </label>

      <div className="section-title">{t.roles}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
        {roles.map((r) => (
          <span key={r} className="badge blue" data-testid={`edit-role-${r}`}>
            {r}{" "}
            <button className="btn sm" style={{ padding: "0 4px" }} aria-label={`移除 ${r}`} onClick={() => setRoles(roles.filter((x) => x !== r))}>
              ✕
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <select value={roleToAdd} aria-label="选择角色" onChange={(e) => setRoleToAdd(e.target.value)} data-testid="role-select">
          <option value="">{t.addRole}</option>
          {options.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        {needsParam && (
          <input
            placeholder={t.roleParam}
            value={roleParam}
            aria-label={t.roleParam}
            onChange={(e) => setRoleParam(e.target.value)}
            data-testid="role-param"
          />
        )}
        <button className="btn sm" disabled={!roleToAdd || (needsParam && !roleParam)} onClick={addRole} data-testid="role-add">
          +
        </button>
      </div>

      <div className="section-title">{t.attributesEditor}</div>
      <textarea
        className="mono"
        style={{ width: "100%", minHeight: 80, fontSize: 12 }}
        value={attrText}
        aria-label={t.attributesEditor}
        onChange={(e) => setAttrText(e.target.value)}
        data-testid="user-attributes"
      />
      {attrError && <div className="badge red">{attrError}</div>}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <button className="btn" onClick={onClose}>
          {zh.common.cancel}
        </button>
        <button
          className="btn primary"
          disabled={mut.isPending || roles.length === 0 || (!user && !email.includes("@"))}
          onClick={() => mut.mutate()}
          data-testid="user-save"
        >
          {zh.common.save}
        </button>
      </div>
    </Modal>
  );
}
