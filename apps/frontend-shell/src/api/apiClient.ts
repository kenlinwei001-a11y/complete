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
