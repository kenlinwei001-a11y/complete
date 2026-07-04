import { describe, it, expect } from "vitest";
import { SEG_REGISTRY, classifySegment } from "@platform/contracts";
import { segOfCust } from "../src/solvers/risk.js";

/**
 * HARDCODE-BIZ-ENTITY（Hα α1·R14·治本）teeth：
 *  segOfCust 的 EV 关键词判定（商用车/储能/电网→乘用车兜底）已从 risk.ts 内联收口到
 *  `SEG_REGISTRY.keywords`（contracts 单一来源）。本测试证：
 *   1) 迁移后逐值一致（R6 字节复现）——播种 8 客户 + 边界串映射不变；
 *   2) 分类**真由 SEG_REGISTRY.keywords 驱动**（改册 keywords → segOfCust 输出随之变）——
 *      若有人把 segOfCust 退回内联字面（/商用车/ 等），此断言即红（回潮门牙）。
 */
describe("segOfCust · 应用细分分类由 SEG_REGISTRY 驱动（R14 去内联）", () => {
  it("R6 字节一致：播种 8 客户 + 兜底串映射与旧内联逐值不变", () => {
    // 乘用车（无关键词命中→兜底 pas）
    for (const c of ["整车厂A", "整车厂B", "整车厂C", "海外车企E"]) expect(segOfCust(c)).toBe("pas");
    // 商用车（含「商用车」→com）
    expect(segOfCust("商用车集团G")).toBe("com");
    // 储能（含「储能」或「电网」→ess）
    expect(segOfCust("储能集成商D")).toBe("ess");
    expect(segOfCust("储能集成商H")).toBe("ess");
    expect(segOfCust("电网公司F")).toBe("ess");
    // 兜底：完全未命中任何关键词 → pas（原「否则乘用车」）
    expect(segOfCust("某新行业客户X")).toBe("pas");
  });

  it("classifySegment 与 segOfCust 同源（委派而非平行实现）", () => {
    for (const c of ["商用车集团G", "储能集成商D", "电网公司F", "整车厂A", "杂串"]) {
      expect(segOfCust(c)).toBe(classifySegment(c).key);
    }
  });

  it("兜底 seg = keywords 为空者（pas），非写死 key", () => {
    const fallback = SEG_REGISTRY.find((s) => s.keywords.length === 0);
    expect(fallback?.key).toBe("pas");
  });

  it("门牙：改 SEG_REGISTRY.keywords → segOfCust 输出随之变（证真 registry-driven·退回内联即红）", () => {
    const com = SEG_REGISTRY.find((s) => s.key === "com")!;
    const orig = [...com.keywords];
    // 内联字面下「巴士运营商」不含任何旧关键词 → 会落兜底 pas；registry-driven 下加词即归 com。
    expect(segOfCust("巴士运营商")).toBe("pas");
    try {
      com.keywords.push("巴士");
      expect(segOfCust("巴士运营商")).toBe("com"); // 若 segOfCust 仍内联 /商用车/，此处仍为 pas → 红
    } finally {
      com.keywords.length = 0;
      com.keywords.push(...orig);
    }
    // 还原后回到兜底
    expect(segOfCust("巴士运营商")).toBe("pas");
  });
});
