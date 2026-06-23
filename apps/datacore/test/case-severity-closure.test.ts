import { describe, expect, it } from "vitest";
import { caseSeverityFromData } from "../src/solvers/risk.js";

/**
 * cockpit P4 真闭环（PRD §2.3「riskCases 由实时算而非写死」）：历史处置案例 severity
 * 由基地真实利用率 + 是否主瓶颈因子 + 危机事件确定性派生（替代 CASE_SPECS 写死字面量）。
 * R13 可溯源（severity 有出处）· R6 确定（同输入同判）。
 * 注：完整 risk_timeline 历史快照回算需对象时光机（高风险 replay），本期为有界真闭环——
 * severity 不再凭空写死，而由真实基地数据派生可溯源。
 */
describe("cockpit P4 · 历史案例 severity 真闭环（caseSeverityFromData）", () => {
  it("危机事件恒高危（结构性到货断供）", () => {
    expect(caseSeverityFromData(60, false, true)).toBe("HIGH");
    expect(caseSeverityFromData(95, true, true)).toBe("HIGH");
  });

  it("主瓶颈因子 + 高利用率 → HIGH（util 83 + 主瓶颈加成 12 = 95 ≥ 92）", () => {
    expect(caseSeverityFromData(83, true, false)).toBe("HIGH");
    expect(caseSeverityFromData(80, true, false)).toBe("HIGH"); // 80+12=92
  });

  it("中利用率 / 非主瓶颈 → MEDIUM（78 ≤ score < 92）", () => {
    expect(caseSeverityFromData(85, false, false)).toBe("MEDIUM"); // 85
    expect(caseSeverityFromData(78, false, false)).toBe("MEDIUM"); // 78 边界
    expect(caseSeverityFromData(70, true, false)).toBe("MEDIUM"); // 70+12=82
  });

  it("低利用率非主瓶颈 → LOW（暴露原写死值与数据不符，如枣庄 73 非主瓶颈）", () => {
    expect(caseSeverityFromData(73, false, false)).toBe("LOW"); // 73 < 78
    expect(caseSeverityFromData(68, false, false)).toBe("LOW"); // 洛阳 68
  });

  it("确定性（R6）：同输入恒同输出", () => {
    expect(caseSeverityFromData(88, true, false)).toBe(caseSeverityFromData(88, true, false));
  });
});
