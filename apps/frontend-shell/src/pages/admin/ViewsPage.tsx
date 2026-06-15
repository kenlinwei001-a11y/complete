import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ADMIN_VIEW_RENDERERS, type AdminViewConfig } from "@platform/contracts";
import { createViewConfig, deleteViewConfig, fetchViewConfigs, updateViewConfig } from "@/api/endpoints";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";

const t = zh.admin.views;

interface WidgetRow {
  key: string;
  type: string;
  title: string;
}

/** 管理平台增量 §3：视图配置 —— 列表（renderer 徽章/导航位置/feature 状态）+ 按 renderer 分支的编辑器。 */
export default function ViewsPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["a", "view-configs", {}], queryFn: fetchViewConfigs });
  const [editing, setEditing] = useState<AdminViewConfig | "new" | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["a", "view-configs"] });
    void queryClient.invalidateQueries({ queryKey: ["a", "feature-registry"] });
  };

  const items = [...(data?.items ?? [])].sort((a, b) => (a.nav.group === b.nav.group ? a.nav.order - b.nav.order : a.nav.group.localeCompare(b.nav.group)));

  const reorderMut = useMutation({
    mutationFn: ({ v, dir }: { v: AdminViewConfig; dir: -1 | 1 }) =>
      updateViewConfig(v.viewKey, { nav: { group: v.nav.group, order: Math.max(0, v.nav.order + dir) } }),
    onSuccess: (r) => {
      toast(t.saved(r.configVersion), "success");
      invalidate();
    },
    onError: toastError,
  });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ fontSize: 16 }}>{t.title}</h2>
        <span className="badge blue" style={{ marginLeft: 10 }}>configVersion {data?.configVersion ?? "—"}</span>
        <button className="btn primary sm" style={{ marginLeft: "auto" }} onClick={() => setEditing("new")} data-testid="view-create">
          {t.create}
        </button>
      </div>
      <div className="panel">
        {items.length === 0 ? (
          <EmptyState message={zh.common.none}>
            <button className="btn primary sm" onClick={() => setEditing("new")}>
              {t.create}
            </button>
          </EmptyState>
        ) : (
          <table className="cmp">
            <thead>
              <tr>
                <th>{t.viewKey}</th>
                <th>{t.titleField}</th>
                <th>{t.renderer}</th>
                <th>{t.navPosition}</th>
                <th>{t.featureState}</th>
                <th>{t.rolesField}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((v) => (
                <tr key={v.viewKey} data-testid={`view-${v.viewKey}`}>
                  <td className="mono">{v.viewKey}</td>
                  <td className="zh">{v.title}</td>
                  <td>
                    <span className="badge blue" data-testid={`renderer-${v.viewKey}`}>{v.renderer}</span>
                  </td>
                  <td>
                    <span className="mono" style={{ fontSize: 11 }}>{v.nav.group} #{v.nav.order}</span>{" "}
                    <button className="btn sm" aria-label={`${t.moveUp} ${v.viewKey}`} onClick={() => reorderMut.mutate({ v, dir: -1 })}>
                      ↑
                    </button>{" "}
                    <button className="btn sm" aria-label={`${t.moveDown} ${v.viewKey}`} onClick={() => reorderMut.mutate({ v, dir: 1 })}>
                      ↓
                    </button>
                  </td>
                  <td>
                    {v.featureKey ? (
                      <span className={`badge ${v.featureOn ? "green" : "red"}`} data-testid={`feature-state-${v.viewKey}`}>
                        {v.featureKey} {v.featureOn ? "ON" : "OFF"}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="zh" style={{ fontSize: 11.5 }}>{v.roles.join(", ")}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn sm" onClick={() => setEditing(v)} data-testid={`view-edit-${v.viewKey}`}>
                      {zh.common.edit}
                    </button>{" "}
                    <button className="btn sm danger" onClick={() => setDeleting(v.viewKey)} data-testid={`view-delete-${v.viewKey}`}>
                      {zh.common.delete}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && (
        <ViewEditor
          view={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            invalidate();
          }}
        />
      )}
      {deleting && (
        <DeleteCascadeModal
          viewKey={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

/** 编辑器：dashboard=widget 表单排序；ontology-graph=GraphOptions 表单；其余=数据范围参数表单。 */
function ViewEditor({ view, onClose, onSaved }: { view: AdminViewConfig | null; onClose: () => void; onSaved: () => void }) {
  const [viewKey, setViewKey] = useState(view?.viewKey ?? "");
  const [title, setTitle] = useState(view?.title ?? "");
  const [renderer, setRenderer] = useState<AdminViewConfig["renderer"]>(view?.renderer ?? "dashboard");
  const [group, setGroup] = useState<"business" | "admin">(view?.nav.group ?? "business");
  const [rolesText, setRolesText] = useState((view?.roles ?? ["admin", "planner"]).join(","));
  const [widgets, setWidgets] = useState<WidgetRow[]>(
    ((view?.layout?.widgets as WidgetRow[] | undefined) ?? []).map((w) => ({ key: w.key, type: w.type, title: w.title })),
  );
  const graphOpts = (view?.options?.graphOptions ?? {}) as { colorBy?: string; dimOthers?: boolean; linkKinds?: string[] };
  const [colorBy, setColorBy] = useState(graphOpts.colorBy ?? "domain");
  const [dimOthers, setDimOthers] = useState(graphOpts.dimOthers ?? false);
  const [linkKinds, setLinkKinds] = useState((graphOpts.linkKinds ?? []).join(","));
  const [paramsText, setParamsText] = useState(JSON.stringify(view?.layout ?? {}, null, 2));
  const [error, setError] = useState<string | null>(null);

  const buildBody = () => {
    const roles = rolesText.split(",").map((s) => s.trim()).filter(Boolean);
    let layout: Record<string, unknown> = {};
    let options: Record<string, unknown> = {};
    if (renderer === "dashboard") {
      layout = { widgets };
    } else if (renderer === "ontology-graph") {
      options = { graphOptions: { colorBy, dimOthers, ...(linkKinds ? { linkKinds: linkKinds.split(",").filter(Boolean) } : {}) } };
    } else {
      try {
        layout = JSON.parse(paramsText || "{}") as Record<string, unknown>;
      } catch {
        setError("参数 JSON 解析失败");
        throw new Error("layout JSON 解析失败");
      }
    }
    setError(null);
    return { viewKey, title, renderer, layout, options, nav: { group, order: view?.nav.order ?? 0 }, roles };
  };

  const mut = useMutation({
    mutationFn: () => {
      const body = buildBody();
      return view ? updateViewConfig(view.viewKey, body) : createViewConfig(body);
    },
    onSuccess: (r) => {
      toast(t.saved(r.configVersion), "success");
      if (!view && r.featureKey) toast(t.featureRegistered(r.featureKey), "info");
      onSaved();
    },
    onError: (e) => {
      if (!(e instanceof Error && e.message.includes("JSON"))) toastError(e);
    },
  });

  const moveWidget = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= widgets.length) return;
    const next = [...widgets];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setWidgets(next);
  };

  return (
    <Modal title={view ? `${zh.common.edit} · ${view.viewKey}` : t.create} onClose={onClose} width={620}>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: "var(--muted)", flex: 1 }}>
          {t.viewKey}
          <input style={{ width: "100%" }} value={viewKey} disabled={!!view} onChange={(e) => setViewKey(e.target.value)} data-testid="view-key-input" />
        </label>
        <label style={{ fontSize: 12, color: "var(--muted)", flex: 1 }}>
          {t.titleField}
          <input style={{ width: "100%" }} value={title} onChange={(e) => setTitle(e.target.value)} data-testid="view-title-input" />
        </label>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          {t.renderer}
          <select value={renderer} aria-label={t.renderer} onChange={(e) => setRenderer(e.target.value as AdminViewConfig["renderer"])} data-testid="renderer-select">
            {ADMIN_VIEW_RENDERERS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          {t.navGroup}
          <select value={group} aria-label={t.navGroup} onChange={(e) => setGroup(e.target.value as "business" | "admin")}>
            <option value="business">business</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <label style={{ fontSize: 12, color: "var(--muted)", flex: 1 }}>
          {t.rolesField}
          <input style={{ width: "100%" }} value={rolesText} onChange={(e) => setRolesText(e.target.value)} />
        </label>
      </div>

      {renderer === "dashboard" && (
        <div data-testid="dashboard-editor">
          <div className="section-title">{t.widgets}</div>
          {widgets.map((w, i) => (
            <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
              <input value={w.key} aria-label={`widget key ${i}`} placeholder="key" style={{ width: 110 }} onChange={(e) => setWidgets(widgets.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
              <select value={w.type} aria-label={`widget type ${i}`} onChange={(e) => setWidgets(widgets.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}>
                {["kpi", "chart", "table"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
              <input value={w.title} aria-label={`widget title ${i}`} placeholder="标题" style={{ flex: 1 }} onChange={(e) => setWidgets(widgets.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
              <button className="btn sm" aria-label={`widget 上移 ${i}`} onClick={() => moveWidget(i, -1)}>
                ↑
              </button>
              <button className="btn sm" aria-label={`widget 下移 ${i}`} onClick={() => moveWidget(i, 1)}>
                ↓
              </button>
              <button className="btn sm danger" aria-label={`widget 删除 ${i}`} onClick={() => setWidgets(widgets.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
          <button className="btn sm" onClick={() => setWidgets([...widgets, { key: `w${widgets.length + 1}`, type: "kpi", title: "" }])} data-testid="widget-add">
            {t.addWidget}
          </button>
        </div>
      )}

      {renderer === "ontology-graph" && (
        <div data-testid="graph-options-editor">
          <div className="section-title">{t.graphOptions}</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>
              colorBy
              <select value={colorBy} aria-label="colorBy" onChange={(e) => setColorBy(e.target.value)}>
                {["domain", "source"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>
              linkKinds
              <input value={linkKinds} aria-label="linkKinds" placeholder="flow,agg" onChange={(e) => setLinkKinds(e.target.value)} />
            </label>
            <label style={{ fontSize: 12, color: "var(--muted)", display: "flex", gap: 4, alignItems: "center" }}>
              <input type="checkbox" checked={dimOthers} aria-label="dimOthers" onChange={(e) => setDimOthers(e.target.checked)} />
              dimOthers
            </label>
          </div>
        </div>
      )}

      {renderer !== "dashboard" && renderer !== "ontology-graph" && (
        <div data-testid="params-editor">
          <div className="section-title">{t.paramsForm}</div>
          <textarea className="mono" style={{ width: "100%", minHeight: 100, fontSize: 11.5 }} value={paramsText} aria-label={t.paramsForm} onChange={(e) => setParamsText(e.target.value)} />
        </div>
      )}

      {error && <div className="badge red" style={{ marginTop: 8 }}>{error}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <button className="btn" onClick={onClose}>
          {zh.common.cancel}
        </button>
        <button className="btn primary" disabled={!viewKey || !title || mut.isPending} onClick={() => mut.mutate()} data-testid="view-save">
          {zh.common.save}
        </button>
      </div>
    </Modal>
  );
}

/** 删除级联确认：先取引用清单（feature/场景入口/意图提示）→ 确认后 confirm=1 真删。 */
function DeleteCascadeModal({ viewKey, onClose, onDeleted }: { viewKey: string; onClose: () => void; onDeleted: () => void }) {
  const { data: prompt } = useQuery({
    queryKey: ["a", "view-delete-prompt", { viewKey }],
    queryFn: () => deleteViewConfig(viewKey, false),
  });
  const mut = useMutation({
    mutationFn: () => deleteViewConfig(viewKey, true),
    onSuccess: () => {
      toast(zh.common.delete + " ✓", "success");
      onDeleted();
    },
    onError: toastError,
  });
  return (
    <Modal title={`${zh.common.delete} · ${viewKey}`} onClose={onClose} width={460}>
      <div style={{ fontSize: 12.5, marginBottom: 10 }}>{t.deleteCascade}</div>
      {prompt ? (
        <ul style={{ fontSize: 12, lineHeight: 1.9, paddingLeft: 18 }} data-testid="delete-references">
          <li>
            feature：<span className="mono">{prompt.references.feature ?? "—"}</span>
          </li>
          <li>
            场景入口：<span className="mono">{prompt.references.sceneEntryViewKey}</span>
          </li>
          <li className="zh">{prompt.references.intentsHint}</li>
          <li className="zh">涉及角色：{prompt.references.roles.join(", ")}</li>
        </ul>
      ) : (
        <div>{zh.common.loading}</div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <button className="btn" onClick={onClose}>
          {zh.common.cancel}
        </button>
        <button className="btn danger" disabled={mut.isPending} onClick={() => mut.mutate()} data-testid="view-delete-confirm">
          {zh.common.confirm}
        </button>
      </div>
    </Modal>
  );
}
