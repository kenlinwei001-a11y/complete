/**
 * WO-THEME-SWITCH-U8 · 明暗主题模式（轨O 主题/配色开关）。
 *
 * 与 workspace.theme（theme.ts·后端下发的按账号 token 覆盖·inline style）正交：
 * 本模块只切 <html data-theme>，驱动 tokens.css 的 `[data-theme=light]` 覆盖块。
 *
 * 契约：
 * - 暗色（obsidian）= 默认 = **不设** data-theme 属性（无 localStorage / 功能关 → 现有黑曜石外观逐值不变·C3 additive）。
 * - 浅色 = document.documentElement[data-theme=light]（CSS 覆盖表面/文本 token；语义域色不翻）。
 * - 选择持久化于 localStorage（key `ui.theme-mode`）；刷新记住。
 */
export type ThemeMode = "dark" | "light";

const STORAGE_KEY = "ui.theme-mode";

/** 读持久化选择；无 / 非法 → null（调用方回落 dark 默认）。 */
export function getStoredThemeMode(): ThemeMode | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

/** 只作用于 DOM（不落库）：light → 置 data-theme=light；dark → 移除属性（默认态）。 */
export function applyThemeMode(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === "light") root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme");
}

/** 落库 + 应用。 */
export function setThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore（隐私模式等） */
  }
  applyThemeMode(mode);
}

/**
 * 启动初始化：读持久化选择（无则 dark 默认），应用并返回。
 * 应在 React 渲染前调用（main.tsx），避免明暗闪烁。
 */
export function initThemeMode(): ThemeMode {
  const mode = getStoredThemeMode() ?? "dark";
  applyThemeMode(mode);
  return mode;
}
