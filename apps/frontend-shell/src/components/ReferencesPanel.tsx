import { Link } from "react-router-dom";
import type { ResourceReferenceVM } from "@/api/endpoints";

/**
 * RESOURCE-REF-NAV（P1）：资源被引用只读区 —— agents/workflows/skills/mcp-configs 编辑器统一挂载。
 * 接对应 `/b/v1/{kind}s/:id/references`（computeReferences 真值形态：{kind,id,name,via}[]），
 * 列 kind/name/via，name 可点跳到引用方（已知 kind 才生成链接；未知 kind 诚实降级为纯文本，不造假链接）。
 */
export function referenceHref(ref: Pick<ResourceReferenceVM, "kind" | "id" | "name">): string | null {
  switch (ref.kind) {
    case "agent":
      return `/admin/agents?id=${encodeURIComponent(ref.id)}`;
    case "workflow":
      return `/admin/workflows?id=${encodeURIComponent(ref.id)}`;
    case "skill":
      return `/admin/skills?id=${encodeURIComponent(ref.id)}`;
    case "mcp-config":
      return `/admin/mcp?id=${encodeURIComponent(ref.id)}`;
    // scene-entry 无独立详情页/id 选择态：ScenesPage 按 viewKey 铺平展示，锚点跳转到对应行。
    case "scene-entry":
      return `/admin/scenes#scene-${encodeURIComponent(ref.name)}`;
    default:
      return null;
  }
}

export function ReferencesPanel({
  testId,
  loading,
  references,
  title = "被引用",
}: {
  testId: string;
  loading: boolean;
  references: ResourceReferenceVM[] | undefined;
  title?: string;
}) {
  const list = references ?? [];
  return (
    <div style={{ marginTop: 14 }} data-testid={testId}>
      <div className="section-title">
        {title}（{loading ? "…" : list.length}）
      </div>
      {loading ? (
        <div style={{ fontSize: 12, color: "var(--muted)" }}>加载中…</div>
      ) : list.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--muted)" }} data-testid={`${testId}-empty`}>
          未被引用
        </div>
      ) : (
        <ul style={{ fontSize: 12, listStyle: "none", padding: 0, margin: 0 }}>
          {list.map((r, i) => {
            const href = referenceHref(r);
            return (
              <li key={`${r.kind}:${r.id}:${i}`} style={{ padding: "4px 0", borderBottom: "1px solid var(--line)" }} data-testid={`${testId}-item-${i}`}>
                <span className="badge blue" style={{ marginRight: 6 }}>
                  {r.kind}
                </span>
                {href ? (
                  <Link to={href} data-testid={`${testId}-link-${i}`}>
                    {r.name}
                  </Link>
                ) : (
                  <span>{r.name}</span>
                )}
                <span style={{ color: "var(--muted2)", marginLeft: 6 }}>via {r.via}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
