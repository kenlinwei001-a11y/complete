import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FeatureDef } from "@platform/contracts";
import {
  fetchFeaturePreview,
  fetchFeatureRegistry,
  fetchResolvedFeatures,
  putRoleFeatures,
  putTenantFeatures,
} from "@/api/endpoints";
import { useWorkspace, workspaceQueryKey } from "@/workspace/useWorkspace";
import { Modal } from "@/components/ui/Modal";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";
import styles from "./FeaturesPage.module.css";

const t = zh.admin.features;
const ROLES = ["planner", "base_manager", "approver"];

/** 功能开通配置（Entitlement §6）：三层树开关 + 角色覆盖 + 预览 + configVersion 生效 */
export default function FeaturesPage() {
  const queryClient = useQueryClient();
  const { data: workspace } = useWorkspace();
  const tenantId = workspace?.tenant.id ?? "";
  const { data: registry } = useQuery({ queryKey: ["a", "feature-registry", {}], queryFn: fetchFeatureRegistry });
  const { data: resolved } = useQuery({
    queryKey: ["a", "tenant-features", { tenantId }],
    queryFn: () => fetchResolvedFeatures(tenantId),
    enabled: tenantId !== "",
  });

  const [tab, setTab] = useState<"tenant" | "role">("tenant");
  const [role, setRole] = useState(ROLES[0]!);
  const [previewRole, setPreviewRole] = useState<string | null>(null);

  // 本地编辑态：key → on/off（从 resolved 初始化）
  const [state, setState] = useState<Record<string, boolean> | null>(null);
  const effective = useMemo(() => {
    if (state) return state;
    if (!registry || !resolved) return null;
    return Object.fromEntries(registry.map((f) => [f.key, resolved.features.includes(f.key)]));
  }, [state, registry, resolved]);

  // 角色覆盖 Tab 的本地态（只能在租户开通集合内收窄）
  const [roleState, setRoleState] = useState<Record<string, boolean>>({});
  useEffect(() => setRoleState({}), [role]);

  const saveMut = useMutation({
    mutationFn: () =>
      tab === "tenant"
        ? putTenantFeatures(tenantId, state ?? {})
        : putRoleFeatures(tenantId, role, roleState),
    onSuccess: async (r) => {
      toast(`${t.saved}（v${r.configVersion}）`, "success");
      setState(null);
      await queryClient.invalidateQueries({ queryKey: ["a", "tenant-features"] });
      // 立即静默重拉 workspace（本会话生效）
      await queryClient.invalidateQueries({ queryKey: workspaceQueryKey });
    },
    onError: toastError,
  });

  if (!registry || !effective) return <div className="empty-state">{zh.common.loading}</div>;

  const tree = buildTree(registry);

  return (
    <div style={{ maxWidth: 880 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ fontSize: 16 }}>{t.title}</h2>
        <span className="badge blue">configVersion {resolved?.configVersion ?? "—"}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="btn sm" onClick={() => setPreviewRole(role)}>
            {t.preview}
          </button>
          <button className="btn primary sm" disabled={saveMut.isPending} onClick={() => saveMut.mutate()} data-testid="features-save">
            {zh.common.save}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <button className={`btn sm ${tab === "tenant" ? "primary" : ""}`} onClick={() => setTab("tenant")} data-testid="tab-tenant">
          {t.tenantTab}
        </button>
        <button className={`btn sm ${tab === "role" ? "primary" : ""}`} onClick={() => setTab("role")} data-testid="tab-role">
          {t.roleTab}
        </button>
        {tab === "role" && (
          <select value={role} aria-label="选择角色" onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        )}
      </div>

      <div className="panel">
        {tree.map(({ node, children }) => (
          <FeatureNode
            key={node.key}
            def={node}
            childrenDefs={children}
            mode={tab}
            tenantOn={effective}
            roleState={roleState}
            onToggleTenant={(key, on) => {
              const next = { ...effective, [key]: on };
              if (!on) {
                // 父关子自动关（级联）
                for (const f of registry) {
                  if (f.requires?.includes(key)) next[f.key] = false;
                }
              }
              setState(next);
            }}
            onToggleRole={(key, on) => setRoleState((s) => ({ ...s, [key]: on }))}
          />
        ))}
      </div>

      {previewRole && tenantId && <PreviewModal tenantId={tenantId} role={previewRole} onClose={() => setPreviewRole(null)} />}
    </div>
  );
}

interface TreeEntry {
  node: FeatureDef;
  children: FeatureDef[];
}

/** VIEW → 子 BLOCK/ACTION（requires 声明）；无父的 BLOCK/ACTION 作顶层 */
function buildTree(registry: FeatureDef[]): TreeEntry[] {
  const views = registry.filter((f) => f.level === "VIEW");
  const rest = registry.filter((f) => f.level !== "VIEW");
  const out: TreeEntry[] = views.map((v) => ({
    node: v,
    children: rest.filter((f) => f.requires?.includes(v.key)),
  }));
  const orphan = rest.filter((f) => !views.some((v) => f.requires?.includes(v.key)));
  for (const o of orphan) out.push({ node: o, children: [] });
  return out;
}

function FeatureNode({
  def,
  childrenDefs,
  mode,
  tenantOn,
  roleState,
  onToggleTenant,
  onToggleRole,
}: {
  def: FeatureDef;
  childrenDefs: FeatureDef[];
  mode: "tenant" | "role";
  tenantOn: Record<string, boolean>;
  roleState: Record<string, boolean>;
  onToggleTenant: (key: string, on: boolean) => void;
  onToggleRole: (key: string, on: boolean) => void;
}) {
  return (
    <div className={styles.group}>
      <FeatureRow
        def={def}
        mode={mode}
        tenantOn={tenantOn}
        roleState={roleState}
        parentOff={false}
        onToggleTenant={onToggleTenant}
        onToggleRole={onToggleRole}
      />
      {childrenDefs.length > 0 && (
        <div className={styles.children}>
          {childrenDefs.map((c) => (
            <FeatureRow
              key={c.key}
              def={c}
              mode={mode}
              tenantOn={tenantOn}
              roleState={roleState}
              parentOff={!(tenantOn[def.key] ?? true)}
              onToggleTenant={onToggleTenant}
              onToggleRole={onToggleRole}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FeatureRow({
  def,
  mode,
  tenantOn,
  roleState,
  parentOff,
  onToggleTenant,
  onToggleRole,
}: {
  def: FeatureDef;
  mode: "tenant" | "role";
  tenantOn: Record<string, boolean>;
  roleState: Record<string, boolean>;
  parentOff: boolean;
  onToggleTenant: (key: string, on: boolean) => void;
  onToggleRole: (key: string, on: boolean) => void;
}) {
  const tenantEnabled = tenantOn[def.key] ?? def.defaultOn;
  const intents = def.bindings?.intents?.length ?? 0;
  const solvers = def.bindings?.solverKeys?.length ?? 0;

  // 租户 Tab：父关 → 子项置灰；角色 Tab：租户未开通 → 控件禁用 + tooltip
  const disabled = mode === "tenant" ? parentOff : !tenantEnabled || parentOff;
  const checked = mode === "tenant" ? tenantEnabled && !parentOff : (roleState[def.key] ?? tenantEnabled) && tenantEnabled;
  const tooltip = mode === "role" && !tenantEnabled ? t.tenantOff : parentOff ? t.parentOff : undefined;

  return (
    <div className={`${styles.row} ${disabled ? styles.rowDisabled : ""}`} data-testid={`feature-${def.key}`} title={tooltip}>
      <label className={styles.switch} title={tooltip}>
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          aria-label={def.key}
          onChange={(e) => (mode === "tenant" ? onToggleTenant(def.key, e.target.checked) : onToggleRole(def.key, e.target.checked))}
        />
      </label>
      <span className={`badge ${def.level === "VIEW" ? "blue" : def.level === "BLOCK" ? "amber" : "green"}`}>{def.level}</span>
      <span className="zh">{def.name}</span>
      <span className="mono" style={{ fontSize: 12, color: "var(--muted2)" }}>
        {def.key}
      </span>
      {(intents > 0 || solvers > 0) && (
        <span className={styles.bindings} data-testid={`bindings-${def.key}`}>
          {t.bindingSummary(intents, solvers)}
        </span>
      )}
    </div>
  );
}

/** 以角色预览：弹层模拟该角色的导航与视图列表（preview 参数，不切换会话） */
function PreviewModal({ tenantId, role, onClose }: { tenantId: string; role: string; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ["a", "feature-preview", { tenantId, role }],
    queryFn: () => fetchFeaturePreview(tenantId, role),
  });
  return (
    <Modal title={`${t.preview} · ${role}`} onClose={onClose} width={480}>
      {!data ? (
        <div>{zh.common.loading}</div>
      ) : (
        <div data-testid="feature-preview">
          <div className="section-title">导航</div>
          {data.navigation.map((n) => (
            <div key={n.key} style={{ fontSize: 12.5, padding: "3px 0" }}>
              {n.label} <span className="mono" style={{ color: "var(--muted2)", fontSize: 12 }}>{n.key}</span>
            </div>
          ))}
          <div className="section-title" style={{ marginTop: 10 }}>
            视图
          </div>
          {data.views.map((v) => (
            <span key={v.key} className="badge" style={{ marginRight: 6 }}>
              {v.title}
            </span>
          ))}
        </div>
      )}
    </Modal>
  );
}
