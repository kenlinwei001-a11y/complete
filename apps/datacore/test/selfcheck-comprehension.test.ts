import { describe, expect, it } from "vitest";
import { selfCheckGaps } from "../src/databuilder/selfcheck.js";

/**
 * 修 selfCheckGaps 谎报 ANSWERABLE（亲手跑真系统审计发现的 bug）：故事提出推演诉求、却倒推出 0
 * 求解器时,系统此前因"无 MISSING 项"判 ANSWERABLE——"听不懂"没被当成缺口。修复后必须报缺口,
 * 让系统"知道自己不懂"（建域绿 ≠ 能答用户的问题）。
 *
 * 故事脚本（~100 字）：客户问"哪些工序/设备会成为共享瓶颈、哪张单会被降级、后果是什么"。comprehend
 * 听不懂这些业务语言、倒推出 0 求解器,但建域照样 SUCCEEDED。此前自检谎报 ANSWERABLE(无缺口),现在
 * 必须报 NO_INTENT@comprehend(未理解);而真有求解器的策展故事仍 ANSWERABLE;纯数据装载故事(无推演
 * 诉求)不误报。
 */
const NOVEL = "下季度同时吃下 C、D 两个客户的扩产订单，哪些工序/设备会成为共享瓶颈、谁会挤占谁、按当前排产规则哪张单会被降级、后果是什么？";

describe("selfCheckGaps · 理解缺口（不再谎报 ANSWERABLE）", () => {
  it("推演诉求 + 0 求解器 → 报 NO_INTENT@comprehend，verdict=BLOCKED", () => {
    const r = selfCheckGaps(NOVEL, "sbr_x", undefined, undefined, 0);
    expect(r.verdict).toBe("BLOCKED");
    const f = r.findings.find((x) => x.atStep === "comprehend");
    expect(f).toBeDefined();
    expect(f!.gapCode).toBe("NO_INTENT");
    expect(f!.evidence).toContain("未倒推出任何求解器");
  });

  it("有求解器（策展故事）→ 不报理解缺口，verdict=ANSWERABLE", () => {
    const r = selfCheckGaps("常州基地产能紧张，请做风险推演", "sbr_y", undefined, undefined, 2);
    expect(r.verdict).toBe("ANSWERABLE");
    expect(r.findings.some((x) => x.atStep === "comprehend")).toBe(false);
  });

  it("纯数据装载故事（无推演诉求）+ 0 求解器 → 不误报", () => {
    const r = selfCheckGaps("把上季度的销售订单明细导入系统", "sbr_z", undefined, undefined, 0);
    expect(r.verdict).toBe("ANSWERABLE");
    expect(r.findings.length).toBe(0);
  });

  it("向后兼容：未传 solverCount（旧调用）不触发理解缺口", () => {
    const r = selfCheckGaps(NOVEL, "sbr_w");
    expect(r.findings.some((x) => x.atStep === "comprehend")).toBe(false);
  });
});
