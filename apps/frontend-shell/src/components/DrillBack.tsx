import { useNavigate } from "react-router-dom";
import zh from "@/locales/zh";

/** 面包屑一节：to 省略 = 纯文本当前页（末项通常无 to）。 */
export interface Crumb {
  label: string;
  to?: string;
}

/**
 * 统一下钻回退（R17：整页下钻必可回）。范式承 OrderChainView 的手搓 inline 面包屑，
 * 抽成共享组件替代各页重复实现，逐页补齐死路页。
 *
 * back 默认走 navigate(-1)（真历史回退，与浏览器物理后退一致）；当本页是历史栈首
 * （直链粘贴/刷新落地，window.history.state.idx==0）时，navigate(-1) 会退出应用，故走
 * fallbackTo 兜底目的地，保证「进得去也回得来」不走进死路。
 */
export function DrillBack({
  trail = [],
  fallbackTo,
  testId = "drill-back",
}: {
  trail?: Crumb[]; // 面包屑（末项通常为当前页，无 to）
  fallbackTo?: string; // 直达/刷新落地（history 无前一页）时的兜底目的地
  testId?: string;
}) {
  const navigate = useNavigate();
  const onBack = () => {
    // window.history.state.idx（react-router 维护）==0 → 本页是历史栈首（直链进入），
    // navigate(-1) 会退出站点，故走 fallback；>0 才真历史回退。
    const idx = (window.history.state && (window.history.state as { idx?: number }).idx) ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallbackTo ?? "/");
  };
  return (
    <div
      data-testid={`${testId}-bar`}
      style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 12, color: "var(--muted)" }}
    >
      <button className="badge" data-testid={testId} style={{ cursor: "pointer" }} onClick={onBack}>
        ‹ {zh.common.back}
      </button>
      {trail.map((c, i) => (
        <span key={i} style={{ display: "contents" }}>
          {c.to ? (
            <span style={{ cursor: "pointer" }} onClick={() => navigate(c.to!)}>
              {c.label}
            </span>
          ) : (
            <b>{c.label}</b>
          )}
          {i < trail.length - 1 && <span style={{ color: "var(--muted2)" }}>›</span>}
        </span>
      ))}
    </div>
  );
}

export default DrillBack;
