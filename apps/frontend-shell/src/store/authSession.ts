import { logout as logoutRequest } from "@/api/endpoints";
import { tokenStore } from "@/api/tokenStore";
import { queryClient } from "./queryClient";
import { useSessionStore } from "./sessionStore";

/**
 * 切换账号必须清空 Query 缓存与 zustand store（PRD §8 数据级规范）。
 */
export function clearAccountState(): void {
  queryClient.clear();
  useSessionStore.getState().reset();
}

export function loginSession(accessToken: string): void {
  clearAccountState();
  tokenStore.set(accessToken);
}

/**
 * 登出 = **服务端吊销 + 本地清空**，缺一不可（WO-BEFE-G · `G-BE-FE-SEAM-DEAD`）。
 *
 * ── 病灶（本函数改动前的形态）─────────────────────────────────────────────
 * 原实现只有 `tokenStore.clear()` + `clearAccountState()` —— 全在浏览器内存里。
 * 而 `refresh_token` 是 **httpOnly cookie**（datacore `app.ts:1091`，`Path=/a/v1/auth`），
 * JS 既读不到也删不掉；`api/apiClient.ts:41-62` 的 `silentRefresh()` 带 `credentials:"include"`
 * 打 `POST /a/v1/auth/refresh` 就能用它换回新 accessToken。
 * ⇒ 「退出登录」之后会话在**服务端仍然活着**，任意一次 401 重试即可复活。
 * 后端 `POST /a/v1/auth/logout` 从第一天就在（`app.ts:1090`），前端零调用方 —— 这正是本门要治的那一类。
 *
 * ── 两条不可颠倒的次序约束 ────────────────────────────────────────────────
 * ① **先发请求再清本地**：清本地不影响本请求（该路由在 `PUBLIC_PATHS` 里，认 cookie 不认 Bearer），
 *    但先清了会让「请求」与「清理」的因果在时间线上倒过来，调试时读不出是谁触发的。
 * ② **本地清理绝不能被网络失败挡住**：断网/后端挂了也必须能退出去，否则比不调更糟。
 *    故用 `.catch(() => {})` 吞掉失败 —— 这里吞异常是**故意**的，不是漏处理：
 *    服务端吊销失败时最坏退化回改动前的行为（本地登出），不会更差。
 *
 * ── 为什么不 await ────────────────────────────────────────────────────────
 * 调用方（`pages/ShellLayout.tsx:600`）在同一个事件里紧接着 `navigate("/login")`。
 * await 会让退出按钮在慢网络下"点了没反应"。请求已经发出（fetch 不因组件卸载而取消），
 * 服务端该收到的照样收到。
 */
export function logoutSession(): void {
  // ① 服务端吊销 refresh 会话（httpOnly cookie 只能由服务端 clearCookie 删）
  void logoutRequest().catch(() => {
    /* 断网/后端不可达 → 至少完成本地登出（见顶注约束②） */
  });
  // ② 本地清空
  tokenStore.clear();
  clearAccountState();
}
