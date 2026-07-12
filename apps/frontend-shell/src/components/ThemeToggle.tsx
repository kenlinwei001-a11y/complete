import { useState } from "react";
import { getThemeMode, setThemeMode, type ThemeMode } from "@/workspace/themeMode";

/**
 * WO-THEME-SWITCH-U8：顶栏主题切换（黑曜石 ↔ 浅色）。用户可切·localStorage 持久化（themeMode.ts）。
 * 图标即态：暗态显 ☀️（点切浅色）· 浅态显 🌙（点切暗色）。零业务常数·R14 文案在此。
 */
export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>(getThemeMode());
  const toggle = () => {
    const next: ThemeMode = mode === "light" ? "dark" : "light";
    setThemeMode(next);
    setMode(next);
  };
  const toLight = mode !== "light";
  return (
    <button
      className="btn sm"
      data-testid="theme-toggle"
      data-theme-mode={mode}
      aria-label={toLight ? "切换到浅色主题" : "切换到黑曜石主题"}
      title={toLight ? "切换到浅色主题" : "切换到黑曜石（暗）主题"}
      style={{ fontSize: 15, lineHeight: 1 }}
      onClick={toggle}
    >
      {toLight ? "☀️" : "🌙"}
    </button>
  );
}
