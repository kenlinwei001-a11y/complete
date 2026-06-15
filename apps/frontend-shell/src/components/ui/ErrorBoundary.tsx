import { Component, type ReactNode } from "react";
import zh from "@/locales/zh";

interface Props {
  children: ReactNode;
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
