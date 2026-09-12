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

// WO-THEME-SWITCH-U8 + WO-THEME-WARM · 主题开关单测：默认暗（无属性）、切浅置 data-theme=light、暖砂置 data-theme=warm、持久化、语义色不翻。
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

  // WO-THEME-WARM · 第三套（加性）：applyThemeMode/setThemeMode/getStored 全接受 warm，且 warm → data-theme=warm。
  it("warm 第三档：applyThemeMode → data-theme=warm；持久化 + 读回", () => {
    applyThemeMode("warm");
    expect(document.documentElement.getAttribute("data-theme")).toBe("warm");
    setThemeMode("warm");
    expect(localStorage.getItem("ui.theme-mode")).toBe("warm");
    expect(getStoredThemeMode()).toBe("warm");
    // 暗/冷蓝两档仍逐值不变（加性正交）
    applyThemeMode("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    applyThemeMode("dark");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});

describe("WO-THEME-SWITCH-U8 · ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("三档循环：暗 → 冷蓝(light) → 暖砂(warm) → 回暗；每档持久化 + 改 data-theme", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const btn = screen.getByTestId("theme-toggle");
    // 默认暗：data-theme-mode=dark，无 data-theme 属性
    expect(btn).toHaveAttribute("data-theme-mode", "dark");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);

    // 第 1 击 → 冷蓝
    await user.click(btn);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("ui.theme-mode")).toBe("light");
    expect(btn).toHaveAttribute("data-theme-mode", "light");

    // 第 2 击 → 暖砂（第三套）
    await user.click(btn);
    expect(document.documentElement.getAttribute("data-theme")).toBe("warm");
    expect(localStorage.getItem("ui.theme-mode")).toBe("warm");
    expect(btn).toHaveAttribute("data-theme-mode", "warm");

    // 第 3 击 → 回暗（移除属性·默认黑曜石态）
    await user.click(btn);
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(localStorage.getItem("ui.theme-mode")).toBe("dark");
    expect(btn).toHaveAttribute("data-theme-mode", "dark");
  });
});
