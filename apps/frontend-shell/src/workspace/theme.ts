/**
 * workspace.theme 仅覆盖设计 token 值，不改结构（PRD §5）。
 * 形如 { "--accent": "#36BFA5", "accent": "#.." } 均接受（无 -- 前缀的自动补全）。
 */
export function applyTheme(theme: Record<string, unknown> | undefined): void {
  const root = document.documentElement;
  // 先清掉上一账号的覆盖
  const applied = root.dataset.themeKeys ? root.dataset.themeKeys.split(",") : [];
  for (const k of applied) root.style.removeProperty(k);
  const keys: string[] = [];
  if (theme) {
    for (const [k, v] of Object.entries(theme)) {
      if (typeof v !== "string") continue;
      const prop = k.startsWith("--") ? k : `--${k}`;
      root.style.setProperty(prop, v);
      keys.push(prop);
    }
  }
  root.dataset.themeKeys = keys.join(",");
}
