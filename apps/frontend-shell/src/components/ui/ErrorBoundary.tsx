import { Component, type ReactNode } from "react";
import zh from "@/locales/zh";

interface Props {
  children: ReactNode;
  /**
   * 崩溃**作用域**的标识（外壳传当前路由 path）。它一变就重置错误态。
   *
   * ── 为什么必须有这个参数（WO-ONTO-CRASH 实测）────────────────────────────
   * 原实现只有 `getDerivedStateFromError` 把 error 存进 state，**没有任何东西会清它**。
   * 而外壳是 `<ErrorBoundary><Outlet/></ErrorBoundary>`：SPA 内换路由时 `Outlet` 换了孩子，
   * 边界组件**自己没被卸载** ⇒ error 还在 state 里 ⇒ **后续每一页都渲染成崩溃页**。
   * 2026-08-30 真浏览器实测：`/admin/quarantine` 崩 → 点左导航去 `/v/quarterly-rolling`
   * → 那一页也是崩溃页。E2E 的第一次扫描就是这么被毁掉的：一页崩，之后每页都报"坏"，
   * **金丝雀因此报假**（把好页读成坏页）。
   * 判据落在「作用域变了没有」，不是「孩子变了没有」——
   * 后者 React 看不见（`children` 每次渲染都是新对象，拿它当判据会让边界永远重置、等于没有边界）。
   */
  resetKey?: string;
  /** 恢复动作：外壳传"回到上一个能用的页面"。不传则只给重载。 */
  onRecover?: () => void;
}
interface State {
  error: Error | null;
  /** 错误被捕获时的作用域快照，用来和新的 `resetKey` 比对。 */
  scope?: string | undefined;
}

/**
 * 页面级 ErrorBoundary（PRD §10）。
 *
 * ⚠ 它**不吞错误**：`componentDidCatch` 仍把原始 error 抛回控制台（`console.error`），
 * 屏上同时给用户一句看得懂的话 + 一个真能点的恢复动作。
 * 「把崩溃变成静默不工作」是本仓明令禁止的形态，所以这里既不 try/catch 兜住，
 * 也不假装页面正常。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // 刚捕获时把当前作用域钉下来（此时 state.scope 还是 undefined）。
    if (state.error && state.scope === undefined) return { scope: props.resetKey ?? "" };
    // 作用域变了 ⇒ 用户已经走到别的页面，上一页的错误与他无关，清掉。
    if (state.error && state.scope !== undefined && state.scope !== (props.resetKey ?? "")) {
      return { error: null, scope: undefined };
    }
    return null;
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // 不吞：原文照样进控制台，排障时 stack 一个字不少。
    console.error("[ErrorBoundary] 页面渲染失败：", error, info?.componentStack ?? "");
  }

  render() {
    if (this.state.error) {
      return (
        <div className="empty-state" data-testid="page-error-boundary">
          <div className="code">⚠</div>
          <h3>{zh.errors.pageError}</h3>
          <p style={{ color: "var(--muted2)", fontSize: 13, maxWidth: 560, margin: "0 auto 10px" }}>
            这一页没能显示出来。<b>其他页面不受影响</b>，可以直接从左边导航继续用；
            这一页要能用，需要修复后端返回的数据或本页代码。
          </p>
          <p
            data-testid="page-error-detail"
            style={{ color: "var(--muted2)", fontFamily: "var(--font-mono)", fontSize: 12 }}
          >
            {this.state.error.message}
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10 }}>
            {/* 恢复动作①：回到上一个能用的页面（外壳给的真跳转，不是 setState 空转）。 */}
            {this.props.onRecover && (
              <button
                className="btn"
                data-testid="page-error-back"
                onClick={() => {
                  this.setState({ error: null, scope: undefined });
                  this.props.onRecover?.();
                }}
              >
                返回上一页
              </button>
            )}
            {/* 恢复动作②：真·重载。
                ⚠ 原实现这里是 `setState({error:null})` —— 它只是把同一个坏页面再渲染一遍，
                崩溃条件没变就当场再崩，用户点一百次也是同一个屏。
                所以「重试」必须是真的重载，且文案要如实说它可能没用。 */}
            <button className="btn" data-testid="page-error-reload" onClick={() => window.location.reload()}>
              {zh.common.refresh}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
