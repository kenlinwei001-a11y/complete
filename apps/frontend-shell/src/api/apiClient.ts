import { env } from "@/env";
import { tokenStore } from "./tokenStore";

export class ApiClientError extends Error {
  code: string;
  status: number;
  requestId?: string;
  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

type System = "a" | "b";

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** 原始 FormData 上传 */
  formData?: FormData;
  signal?: AbortSignal;
}

let onAuthFailure: (() => void) | null = null;
export function setAuthFailureHandler(fn: () => void): void {
  onAuthFailure = fn;
}

function baseUrl(system: System): string {
  // 前端是两系统松耦合的汇合点：分别指向 A/B 两个 baseURL
  return system === "a" ? env.datacoreUrl : env.agentcoreUrl;
}

let refreshing: Promise<boolean> | null = null;

/** 401 时静默刷新（单飞）；刷新失败 → 跳登录 */
async function silentRefresh(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${baseUrl("a")}/a/v1/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { accessToken?: string };
      if (!data.accessToken) return false;
      tokenStore.set(data.accessToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/**
 * **冷启动会话恢复**：内存里没有 access token 时，拿 httpOnly 的 refresh cookie 换一个。
 *
 * ── 今天的行为是 X，应该是 Y（这是一条真 bug，不是设计取舍）─────────────────────
 * · X：`silentRefresh` 此前**只在 401 上触发**（见 `doFetch` 的重试分支）。而
 *   `ShellLayout` 的挂载守卫在**任何 API 发出去之前**就把人踢去 `/login` ⇒
 *   整页重载（地址栏敲 URL / F5）时，refresh cookie 明明还有效，却永远轮不到它被用。
 *   四环相扣：token 只在内存（设计如此，PRD §4.1）→ 重载即丢 → 守卫先跑 → 401 永不发生。
 * · Y：守卫落地时**先问一次 refresh**，问不出来再跳登录。
 *
 * ⚠️ PRD §4.1 要的是「access token 不进 localStorage」，**不是**「有 refresh cookie 也不许用」。
 *    本函数一个字节都没往 localStorage 写，只是把已经存在的那条 cookie 用起来。
 *
 * 复用 `silentRefresh` 的**同一个单飞 promise**，不另起一套：若此刻正好有别的请求
 * 在刷新，两边等的是同一个 —— 否则会并发打两次 `/auth/refresh`，第二次拿着已被
 * 轮换掉的 refresh token，反而把会话弄死。
 */
export async function restoreSession(): Promise<boolean> {
  if (tokenStore.get()) return true;
  return silentRefresh();
}

async function doFetch(system: System, path: string, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { ...opts.headers };
  const token = tokenStore.get();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.formData) {
    body = opts.formData;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  return fetch(`${baseUrl(system)}${path}`, {
    method: opts.method ?? (opts.body !== undefined || opts.formData ? "POST" : "GET"),
    headers,
    body,
    signal: opts.signal,
    credentials: "include",
  });
}

/**
 * 打一发请求并把 401 刷新 / 错误信封处理完，**返回还没被 `.json()` 吃掉的 `Response`**。
 *
 * WO-SANDBOX-MEMORY 才需要它：`GET /a/v1/sim/sessions` 单跳 285MB，
 * `res.json()` 会**先建完整对象图再让调用方挑字段** —— 而那一跳里 99.9% 是没人读的
 * `baseSnapshot`。要在解析之前就把它剥掉，就必须拿到未解析的 `Response`（见
 * `simSessionsProjection.ts`）。除此之外一律走 `request<T>()`，别把这个口子当常规路。
 */
async function requestRaw(system: System, path: string, opts: RequestOptions = {}): Promise<Response> {
  let res = await doFetch(system, path, opts);
  if (res.status === 401 && !path.includes("/auth/")) {
    const ok = await silentRefresh();
    if (ok) {
      res = await doFetch(system, path, opts);
    } else {
      tokenStore.clear();
      onAuthFailure?.();
      throw new ApiClientError(401, "UNAUTHORIZED", "登录已过期");
    }
  }
  if (!res.ok) {
    let code = `HTTP_${res.status}`;
    let message = res.statusText;
    let requestId: string | undefined;
    try {
      const data = (await res.json()) as { error?: { code: string; message: string; requestId?: string } };
      if (data.error) {
        code = data.error.code;
        message = data.error.message;
        requestId = data.error.requestId;
      }
    } catch {
      /* non-json error body */
    }
    throw new ApiClientError(res.status, code, message, requestId);
  }
  return res;
}

async function request<T>(system: System, path: string, opts: RequestOptions = {}): Promise<T> {
  let res = await doFetch(system, path, opts);
  if (res.status === 401 && !path.includes("/auth/")) {
    const ok = await silentRefresh();
    if (ok) {
      res = await doFetch(system, path, opts);
    } else {
      tokenStore.clear();
      onAuthFailure?.();
      throw new ApiClientError(401, "UNAUTHORIZED", "登录已过期");
    }
  }
  if (!res.ok) {
    let code = `HTTP_${res.status}`;
    let message = res.statusText;
    let requestId: string | undefined;
    try {
      const data = (await res.json()) as { error?: { code: string; message: string; requestId?: string } };
      if (data.error) {
        code = data.error.code;
        message = data.error.message;
        requestId = data.error.requestId;
      }
    } catch {
      /* non-json error body */
    }
    throw new ApiClientError(res.status, code, message, requestId);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** 统一 apiClient：a = DataCore，b = AgentCore（禁止经任一后端中转另一后端） */
export const api = {
  a: <T>(path: string, opts?: RequestOptions) => request<T>("a", path, opts),
  b: <T>(path: string, opts?: RequestOptions) => request<T>("b", path, opts),
  /** 未解析的 `Response`（鉴权/刷新/错误信封已处理）。**只给需要流式投影的那一跳用**，见 `requestRaw` 头注。 */
  aRaw: (path: string, opts?: RequestOptions) => requestRaw("a", path, opts),
  baseUrl,
};
