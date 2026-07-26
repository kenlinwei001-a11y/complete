import { useState } from "react";
import { getStoredThemeMode, setThemeMode, type ThemeMode } from "@/workspace/themeMode";

/**
 * WO-THEME-SWITCH-U8 + WO-THEME-WARM · 顶栏主题开关（三档循环·轨O）。
 * 暗色（🌙 黑曜石·默认）→ 冷蓝（☀ light）→ 亮橙（🎨 warm）→ 循环。
 * 点击前进一档、落 localStorage、即时改 <html data-theme>。默认暗色（无持久化）。
 * 加档纯加性：暗/冷蓝两档行为逐值不变，仅在其后追加暖砂第三档。
 */
const ORDER: ThemeMode[] = ["dark", "light", "warm"];
const GLYPH: Record<ThemeMode, string> = { dark: "🌙", light: "☀", warm: "🎨" };
const NAME: Record<ThemeMode, string> = { dark: "暗色", light: "冷蓝", warm: "亮橙" };

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>(() => getStoredThemeMode() ?? "dark");
  const next: ThemeMode = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]!;
  const label = `切换主题（当前 ${NAME[mode]} → ${NAME[next]}）`;
  return (
    <button
      className="btn sm"
      type="button"
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
      data-theme-mode={mode}
      style={{ fontSize: 15, lineHeight: 1 }}
      onClick={() => {
        setThemeMode(next);
        setMode(next);
      }}
    >
      {GLYPH[mode]}
    </button>
  );
}
