import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  applyThemeMode,
  getStoredThemeMode,
  initThemeMode,
  setThemeMode,
} from "@/workspace/themeMode";
import { ThemeToggle } from "@/components/ThemeToggle";

// WO-THEME-SWITCH-U8 · 明暗主题开关（轨O）单测：默认暗（无属性）、切浅置 data-theme=light、持久化、语义色不翻。
describe("WO-THEME-SWITCH-U8 · themeMode", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("默认暗色：无 localStorage → init 不设 data-theme（现有黑曜石外观不变·C3）", () => {
    expect(getStoredThemeMode()).toBeNull();
    const mode = initThemeMode();
    expect(mode).toBe("dark");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("applyThemeMode：light → data-theme=light；dark → 移除属性", () => {
    applyThemeMode("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    applyThemeMode("dark");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("setThemeMode：落 localStorage + 应用；init 读回持久化选择", () => {
    setThemeMode("light");
    expect(localStorage.getItem("ui.theme-mode")).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    // 模拟刷新：清 DOM，init 从 localStorage 恢复
    document.documentElement.removeAttribute("data-theme");
    expect(initThemeMode()).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("getStoredThemeMode 忽略非法值", () => {
    localStorage.setItem("ui.theme-mode", "neon");
    expect(getStoredThemeMode()).toBeNull();
  });
});

describe("WO-THEME-SWITCH-U8 · ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("点击切浅 → <html data-theme=light> + 持久化；再点回暗 → 移除属性", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const btn = screen.getByTestId("theme-toggle");
    // 默认暗：显示 ☀（去浅），aria-pressed=false
    expect(btn).toHaveAttribute("data-theme-mode", "dark");
    expect(btn).toHaveAttribute("aria-pressed", "false");

    await user.click(btn);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("ui.theme-mode")).toBe("light");
    expect(btn).toHaveAttribute("data-theme-mode", "light");
    expect(btn).toHaveAttribute("aria-pressed", "true");

    await user.click(btn);
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(localStorage.getItem("ui.theme-mode")).toBe("dark");
  });
});
