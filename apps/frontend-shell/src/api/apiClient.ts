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
  baseUrl,
};
