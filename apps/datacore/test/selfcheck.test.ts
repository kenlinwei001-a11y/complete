import { describe, expect, it } from "vitest";
import type { ClosureReport, ScaffoldReceipt } from "@platform/contracts";
import { selfCheckGaps } from "../src/databuilder/selfcheck.js";

/**
 * g8-P4 功能缺失自检：A 栈闭包 + B 栈 scaffold 的 MISSING/FAILED → 7 码 GapReport
 * （复用自成长发动机分类法，g8 §9 归一）。
 */
describe("g8-P4 · selfCheckGaps", () => {
  it("干净建域（无缺口）→ ANSWERABLE、零 findings", () => {
    const r = selfCheckGaps("s", "sbr_1", { gatePassed: true, findings: [], objectsBound: 3, dataOrphans: 0, forwardMissing: 0, chainBroken: 0, shapeBroken: 0 });
    expect(r.verdict).toBe("ANSWERABLE");
    expect(r.findings).toHaveLength(0);
  });

  it("A 栈闭包 CHAIN/SHAPE 断 → SOLVER_NOT_FOUND / SHAPE_MISMATCH", () => {
    const closure: ClosureReport = {
      gatePassed: false, objectsBound: 1, dataOrphans: 0, forwardMissing: 0, chainBroken: 1, shapeBroken: 1,
      findings: [
        { kind: "CHAIN", ref: "solver:ghost", status: "FAILED", detail: "未注册" },
        { kind: "SHAPE", ref: "capacity_forecast.output.x", status: "FAILED", detail: "ghost 字段" },
      ],
    };
    const r = selfCheckGaps("s", "sbr_2", closure);
    expect(r.verdict).toBe("BLOCKED");
    expect(r.findings.map((f) => f.gapCode).sort()).toEqual(["SHAPE_MISMATCH", "SOLVER_NOT_FOUND"]);
  });

  it("B 栈 scaffold MISSING → NO_INTENT / NO_PLAN（按 missingRefs 归类）", () => {
    const receipt: ScaffoldReceipt = {
      fullChainOk: false,
      items: [
        { kind: "scene", key: "scene_a", status: "MISSING", missingRefs: ["意图「x」未配置（死路）"] },
        { kind: "scene", key: "scene_b", status: "MISSING", missingRefs: ["意图「y」未绑定执行计划"] },
        { kind: "scene", key: "scene_c", status: "SCAFFOLDED" },
      ],
    };
    const r = selfCheckGaps("s", "sbr_3", undefined, receipt);
    expect(r.findings.map((f) => f.gapCode).sort()).toEqual(["NO_INTENT", "NO_PLAN"]);
  });
});
