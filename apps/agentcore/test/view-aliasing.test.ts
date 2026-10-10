import { describe, expect, it } from "vitest";
import { defaultOnKeys, viewAllowed } from "../src/features/registry.js";

/**
 * 接缝断点修复（catalog §9 SL2 + S18/S19 落点）：场景短键 sop/quarter/audit/generate/project/scenarios
 * 经 VIEW_ALIAS 解析到规范 feature → 可被 entitlement 关闭（此前未注册 → viewAllowed 恒真不可关）。
 */
describe("视图键别名 + view.scenarios 注册（SL2 可关 + S18/S19 落点）", () => {
  it("view.scenarios 已注册 → 关闭后启动器不可达（SL2 此前恒真）", () => {
    const all = new Set(defaultOnKeys());
    expect(viewAllowed(all, "scenarios")).toBe(true); // 默认开
    const off = new Set([...all].filter((k) => k !== "view.scenarios"));
    expect(viewAllowed(off, "scenarios")).toBe(false); // 关闭 → 启动器消失（SL2）
  });

  it("S18 sop / S19 quarter 短键经别名解析到真 feature → 可被关闭（此前 view.sop 未注册恒真）", () => {
    const all = new Set(defaultOnKeys());
    expect(viewAllowed(all, "sop")).toBe(true);
    expect(viewAllowed(all, "quarter")).toBe(true);
    // 关掉 sop-balance → S18(sop) 不可达；关掉 quarterly-rolling → S19(quarter) 不可达
    const noSop = new Set([...all].filter((k) => k !== "view.sop-balance"));
    expect(viewAllowed(noSop, "sop")).toBe(false);
    const noQuarter = new Set([...all].filter((k) => k !== "view.quarterly-rolling"));
    expect(viewAllowed(noQuarter, "quarter")).toBe(false);
  });

  it("其余 catalog 短键 audit/generate/project 亦解析到真 feature", () => {
    const all = new Set(defaultOnKeys());
    for (const [short, feat] of [["audit", "view.plan-audit"], ["generate", "view.plan-generate"], ["project", "view.project-sim"]] as const) {
      const off = new Set([...all].filter((k) => k !== feat));
      expect(viewAllowed(off, short), `${short} 应被 ${feat} 关闭`).toBe(false);
    }
  });
});
