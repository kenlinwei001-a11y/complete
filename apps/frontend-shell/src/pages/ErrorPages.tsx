import { Link } from "react-router-dom";
import zh from "@/locales/zh";

/** 404：功能不存在或未开通（FEATURE_NOT_FOUND，不泄露功能存在性） */
export function NotFoundPage() {
  return (
    <div className="empty-state" data-testid="page-404">
      <div className="code">404</div>
      <h3>{zh.errors.notFoundTitle}</h3>
      <p>{zh.errors.notFoundDesc}</p>
      <Link to="/" className="btn">
        {zh.common.back}
      </Link>
    </div>
  );
}

/** 403：权限不足 */
export function ForbiddenPage() {
  return (
    <div className="empty-state" data-testid="page-403">
      <div className="code">403</div>
      <h3>{zh.errors.forbiddenTitle}</h3>
      <p>{zh.errors.forbiddenDesc}</p>
      <Link to="/" className="btn">
        {zh.common.back}
      </Link>
    </div>
  );
}

/** 未知 renderer 显式空态卡（不白屏） */
export function UnsupportedViewCard({ renderer }: { renderer?: string }) {
  return (
    <div className="empty-state" data-testid="unsupported-view">
      <div className="code">▦</div>
      <h3>{zh.errors.unsupportedView}</h3>
      {renderer && <p className="mono">renderer: {renderer}</p>}
    </div>
  );
}
