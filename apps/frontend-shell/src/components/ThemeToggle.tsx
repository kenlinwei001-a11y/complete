import { useState } from "react";
import { getStoredThemeMode, setThemeMode, type ThemeMode } from "@/workspace/themeMode";

/**
 * WO-THEME-SWITCH-U8 · 顶栏明暗主题开关（轨O）。
 * 暗色（🌙 黑曜石）↔ 浅色（☀ light）；点击翻转、落 localStorage、即时改 <html data-theme>。
 * 默认暗色（无持久化）。
 */
export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>(() => getStoredThemeMode() ?? "dark");
  const next: ThemeMode = mode === "dark" ? "light" : "dark";
  const label = mode === "dark" ? "切换到浅色主题" : "切换到深色主题";
  return (
    <button
      className="btn sm"
      type="button"
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
      data-theme-mode={mode}
      aria-pressed={mode === "light"}
      style={{ fontSize: 15, lineHeight: 1 }}
      onClick={() => {
        setThemeMode(next);
        setMode(next);
      }}
    >
      {mode === "dark" ? "☀" : "🌙"}
    </button>
  );
}
