/**
 * WO-THEME-SWITCH-U8（历史欠账 U8·浅色↔黑曜石用户可切主题·功能本体从无到有）：
 * 用户级主题模式（明/暗）——与 `theme.ts applyTheme`（后端下发设计 token）正交：本模块只在
 * documentElement 上切 `data-theme` 属性，驱动 `tokens.css :root[data-theme="light"]` 结构色覆盖。
 *
 * 默认「黑曜石（暗）」保留现有观感（无 localStorage 偏好时不改现状·零回归）；用户显式切换后 localStorage 持久化。
 * R6：纯本地·无网络/随机。SSR-safe 守卫（typeof window）。
 */
export type ThemeMode = "dark" | "light";
const KEY = "theme-mode";

export function getThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  const saved = window.localStorage.getItem(KEY);
  return saved === "light" ? "light" : "dark"; // 默认暗（黑曜石·保留现状）
}

/** 应用到 documentElement：light→data-theme="light"（触发 tokens.css 浅色覆盖）；dark→移除属性（回默认 :root 暗色）。 */
export function applyThemeMode(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (mode === "light") root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme");
}

/** 持久化 + 立即应用（用户点切换时调）。 */
export function setThemeMode(mode: ThemeMode): void {
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, mode);
  applyThemeMode(mode);
}

/** 启动早期调用（main.tsx）——避免首屏闪烁（先套用持久化偏好再渲染）。 */
export function initThemeMode(): void {
  applyThemeMode(getThemeMode());
}
