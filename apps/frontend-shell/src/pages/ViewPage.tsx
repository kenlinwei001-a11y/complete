import { Suspense, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useWorkspace } from "@/workspace/useWorkspace";
import { useSessionStore } from "@/store/sessionStore";
import { getRenderer } from "@/views/registry";
import { ForbiddenPage, NotFoundPage, UnsupportedViewCard } from "./ErrorPages";
import zh from "@/locales/zh";

/**
 * 业务视图分发器（PRD §7.1）+ 路由守卫：
 * Entitlement §7：先查 feature（关闭 → 404，FEATURE_NOT_FOUND 语义），后判权限（403）。
 */
export default function ViewPage() {
  const { viewKey = "" } = useParams();
  const { data: workspace } = useWorkspace();
  const setView = useSessionStore((s) => s.setView);

  useEffect(() => {
    setView(viewKey);
  }, [viewKey]);

  if (!workspace) return <div className="empty-state">{zh.common.loading}</div>;

  // ① feature 检查（404 优先于 403，不泄露功能存在性）
  const features = workspace.features;
  if (features && !features.includes(`view.${viewKey}`)) {
    return <NotFoundPage />;
  }

  // ② 视图存在性/权限：workspace.views 由服务端按角色解析下发
  const view = workspace.views.find((v) => v.key === viewKey);
  if (!view) return <ForbiddenPage />;

  const renderer = (view.renderer ?? (view.layout?.renderer as string | undefined)) || undefined;
  const Renderer = getRenderer(renderer);
  if (!Renderer) return <UnsupportedViewCard renderer={renderer} />;

  return (
    <Suspense fallback={<div className="empty-state">{zh.common.loading}</div>}>
      <Renderer view={{ ...view, renderer }} />
    </Suspense>
  );
}
