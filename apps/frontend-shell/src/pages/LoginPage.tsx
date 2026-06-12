import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "@/api/endpoints";
import { loginSession } from "@/store/authSession";
import zh from "@/locales/zh";
import styles from "./LoginPage.module.css";

export default function LoginPage() {
  const navigate = useNavigate();
  const [tenantId, setTenantId] = useState("tenant-battery");
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
      navigate("/", { replace: true });
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
