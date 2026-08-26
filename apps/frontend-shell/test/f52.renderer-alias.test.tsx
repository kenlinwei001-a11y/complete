import { describe, expect, it } from "vitest";
import { getRenderer } from "@/views/registry";

/**
 * F52 · 接缝断点修复：场景目录短键 sop/quarter/audit/generate/project 经 VIEW_ALIAS 解析到规范渲染器，
 * 不再落"视图不支持"兜底卡（S18 sop / S19 quarter 此前 getRenderer 直查不中 → undefined）。
 */
describe("F52 · 渲染器视图键别名（S18/S19 落点不再兜底）", () => {
  it("sop/quarter/audit/generate/project 短键解析到渲染器（非 undefined）", () => {
    for (const key of ["sop", "quarter", "audit", "generate", "project"]) {
      expect(getRenderer(key), `${key} 应解析到渲染器`).toBeTruthy();
    }
  });

  it("规范键仍直查命中；真正未知键仍 undefined（不误吞）", () => {
    expect(getRenderer("sop-balance")).toBeTruthy();
    expect(getRenderer("quarterly-rolling")).toBeTruthy();
    expect(getRenderer("totally-unknown-view")).toBeUndefined();
    expect(getRenderer(undefined)).toBeUndefined();
  });
});
