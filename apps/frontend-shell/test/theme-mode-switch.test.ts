import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyThemeMode,
  getThemeMode,
  initThemeMode,
  setThemeMode,
} from "@/workspace/themeMode";

/**
 * WO-THEME-SWITCH-U8 · 齿检（历史欠账 U8·浅色↔黑曜石用户可切主题）：
 * 锁三条真行为 —— ① 无偏好默认「黑曜石(暗)」不改现状(零回归)；② 切换 localStorage 持久化 +
 * documentElement 上 `data-theme="light"` 属性即时切换（驱动 tokens.css 浅色覆盖）；③ 切回暗色移除属性。
 * 纯本地(R6)·无网络/随机。若谁把默认改成 light 或断了持久化/属性切换，本文件立即变红。
 */
describe("themeMode（U8 主题模式·纯本地持久化）", () => {
  beforeEach(() => {
    window.localStorage.removeItem("theme-mode");
    document.documentElement.removeAttribute("data-theme");
  });
  afterEach(() => {
    window.localStorage.removeItem("theme-mode");
    document.documentElement.removeAttribute("data-theme");
  });

  it("无偏好时默认暗色（黑曜石·保留现状零回归）", () => {
    expect(getThemeMode()).toBe("dark");
  });

  it("持久化到 localStorage 且优先读回", () => {
    setThemeMode("light");
    expect(window.localStorage.getItem("theme-mode")).toBe("light");
    expect(getThemeMode()).toBe("light");
    setThemeMode("dark");
    expect(window.localStorage.getItem("theme-mode")).toBe("dark");
    expect(getThemeMode()).toBe("dark");
  });

  it("非法/缺省值回落暗色（只认 light 显式偏好）", () => {
    window.localStorage.setItem("theme-mode", "banana");
    expect(getThemeMode()).toBe("dark");
  });

  it("light 在 documentElement 挂 data-theme='light'，dark 移除属性", () => {
    setThemeMode("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    setThemeMode("dark");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("applyThemeMode 只改属性不动 localStorage（与持久化正交）", () => {
    applyThemeMode("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(window.localStorage.getItem("theme-mode")).toBeNull();
  });

  it("initThemeMode 按持久化偏好套用（启动早期·避首屏闪烁）", () => {
    window.localStorage.setItem("theme-mode", "light");
    initThemeMode();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});
