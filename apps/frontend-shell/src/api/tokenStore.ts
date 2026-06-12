/**
 * Access token 仅存内存（PRD §4.1：access 不进 localStorage）。
 * refresh token 由后端 Set-Cookie（httpOnly）管理，前端只调 refresh 端点。
 */

let accessToken: string | null = null;
const listeners = new Set<() => void>();

export const tokenStore = {
  get(): string | null {
    return accessToken;
  },
  set(token: string | null): void {
    accessToken = token;
    listeners.forEach((l) => l());
  },
  clear(): void {
    tokenStore.set(null);
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
