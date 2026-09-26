import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { login } from "@/api/endpoints";
import { loginSession } from "@/store/authSession";
import zh from "@/locales/zh";
import styles from "./LoginPage.module.css";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  // 默认租户对齐真实部署种子租户 demo（此前默认 tenant-battery 仅匹配 mock，导致真连登录失败）
  const [tenantId, setTenantId] = useState("demo");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await login(tenantId, username, password);
      // 登录即清空上一账号的缓存（切换账号必须清空 Query 缓存与 zustand store）
      loginSession(res.accessToken);
      // 回跳用户本来要去的地方。改前这里写死 `navigate("/")` —— 与 ShellLayout 守卫
      // 那条 bug 合起来，深链接/刷新的用户即使重新登录也回不到原页面，只能再点一遍。
      // ⚠️ 只认**站内相对路径**（`/` 开头且不是 `//` 开头）：`from` 来自 router state，
      //    而 state 是可被构造的 —— 收下一个 `//evil.com` 就成了开放重定向，
      //    钓鱼页只要能让人点一次链接就能借本站的登录页把人甩去外站。
      const from = (location.state as { from?: unknown } | null)?.from;
      const back = typeof from === "string" && from.startsWith("/") && !from.startsWith("//") ? from : "/";
      navigate(back, { replace: true });
    } catch {
      setError(zh.login.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={(e) => void submit(e)}>
        <div className={styles.logo} />
        <h1>{zh.common.appName}</h1>
        <label htmlFor="login-tenant">{zh.login.tenant}</label>
        <input id="login-tenant" value={tenantId} onChange={(e) => setTenantId(e.target.value)} />
        <label htmlFor="login-username">{zh.login.username}</label>
        <input id="login-username" value={username} autoComplete="username" onChange={(e) => setUsername(e.target.value)} />
        <label htmlFor="login-password">{zh.login.password}</label>
        <input
          id="login-password"
          type="password"
          value={password}
          autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="badge red">{error}</div>}
        <button type="submit" className="btn primary" disabled={busy}>
          {zh.login.submit}
        </button>
      </form>
    </div>
  );
}
