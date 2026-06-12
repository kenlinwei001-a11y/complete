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

export function logoutSession(): void {
  tokenStore.clear();
  clearAccountState();
}
