import { Component, type ReactNode } from "react";
import zh from "@/locales/zh";

interface Props {
  children: ReactNode;
  /**
   * WO-20：导航复位键（传当前路由 pathname）。变化即清除已捕获错误 → 崩页后跳别页自动恢复，
   * 不再卡在错误页直到手动刷新（此前唯一出路是点"刷新"按钮·切路由不复位）。
   */
  resetKey?: string;
}
interface State {
  error: Error | null;
}

/** 页面级 ErrorBoundary（PRD §10） */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    // 导航到别页（resetKey 变）且当前处于错误态 → 复位，渲染新页（WO-20 崩页导航自愈）。
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="empty-state">
          <div className="code">⚠</div>
          <h3>{zh.errors.pageError}</h3>
          <p style={{ color: "var(--muted2)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
            {this.state.error.message}
          </p>
          <button className="btn" onClick={() => this.setState({ error: null })}>
            {zh.common.refresh}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
