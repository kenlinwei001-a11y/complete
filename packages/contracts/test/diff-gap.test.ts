import { describe, expect, it } from "vitest";
import {
  GapAnalysisSchema,
  buildExecutionPlan,
  computeCoverageScore,
  diffGap,
  type DiffGapMeta,
  type GapSide,
} from "../src/index.js";

// C1（UPG-L0-GAPCORE §5）：diffGap 纯核——无 IO/时钟/随机，generatedAt 经 meta 注入 →
// 同输入字节级一致（R6）。三态判定 + 执行计划四层拓扑序 + 覆盖率咨询信号。

const SIDE: Record<string, GapSide> = {
  dataset: "content", kb_doc: "content",
  ontology_type: "structure", rule: "structure", slice: "structure",
  solver: "code",
  intent: "cross_system", plan: "cross_system", workflow: "cross_system", skill: "cross_system",
  agent: "cross_system", scene: "cross_system", mcp: "cross_system",
};
const AUTO: Record<string, boolean> = {
  dataset: true, kb_doc: true, ontology_type: true, rule: true, slice: true,
  solver: false, // 代码态：缺则 MISSING
  intent: true, plan: true, workflow: true, skill: true, agent: true, scene: true, mcp: true,
};
const META = (over: Partial<DiffGapMeta> = {}): DiffGapMeta => ({
  side: SIDE, autoCreatable: AUTO, generatedAt: "2026-07-09T00:00:00.000Z", ...over,
});

describe("diffGap 纯核（R6·无 IO/时钟/随机·byte 确定）", () => {
  it("三态判定：EXISTS(已有) / TO_CREATE(可自动建) / MISSING(不能自动建 solver)", () => {
    const g = diffGap(
      { ontology_type: ["A", "B"], solver: ["s1", "s2"] },
      { ontology_type: new Set(["A"]), solver: new Set(["s1"]) },
      META(),
    );
    const ot = g.entries.find((e) => e.kind === "ontology_type")!;
    expect(ot.items).toEqual([{ key: "A", status: "EXISTS" }, { key: "B", status: "TO_CREATE" }]);
    const solver = g.entries.find((e) => e.kind === "solver")!;
    expect(solver.items).toEqual([{ key: "s1", status: "EXISTS" }, { key: "s2", status: "MISSING" }]);
    expect(solver).toMatchObject({ needed: 2, existing: 1, toCreate: 0, missing: 1 });
  });

  it("meta.missing 覆盖 autoCreatable（cross_system scaffold 判 MISSING 忠实复现）", () => {
    const g = diffGap(
      { intent: ["i_reuse", "i_new", "i_missing"] },
      { intent: new Set(["i_reuse"]) },
      META({ missing: { intent: new Set(["i_missing"]) } }),
    );
    const it2 = g.entries.find((e) => e.kind === "intent")!;
    expect(it2.items).toEqual([
      { key: "i_reuse", status: "EXISTS" },
      { key: "i_new", status: "TO_CREATE" }, // autoCreatable=true 且不在 missing 集
      { key: "i_missing", status: "MISSING" }, // missing 集覆盖
    ]);
  });

  it("R6：同输入 → 字节级一致（JSON.stringify 相等），无隐藏时钟", () => {
    const req = { ontology_type: ["A", "B"], solver: ["s1"] };
    const ex = { ontology_type: new Set(["A"]) };
    const a = JSON.stringify(diffGap(req, ex, META()));
    const b = JSON.stringify(diffGap(req, ex, META()));
    expect(a).toBe(b);
    expect(JSON.parse(a).generatedAt).toBe("2026-07-09T00:00:00.000Z"); // 注入非内部取
  });

  it("uniq：required 去重", () => {
    const g = diffGap({ rule: ["R", "R", "R2"] }, {}, META());
    expect(g.entries.find((e) => e.kind === "rule")!.items.map((i) => i.key)).toEqual(["R", "R2"]);
  });

  it("需求为空的 kind 不产 entry；totals 汇总正确", () => {
    const g = diffGap({ ontology_type: ["A"], rule: [] }, { ontology_type: new Set() }, META());
    expect(g.entries.map((e) => e.kind)).toEqual(["ontology_type"]);
    expect(g.totals).toMatchObject({ needed: 1, existing: 0, toCreate: 1, missing: 0 });
    expect(GapAnalysisSchema.safeParse(g).success).toBe(true);
  });

  it("非 enrich（DataCore 默认）：无 executionPlan / coverageScore / target（保 byte 等价）", () => {
    const g = diffGap({ ontology_type: ["A"] }, {}, META());
    expect(g.executionPlan).toBeUndefined();
    expect((g.totals as { coverageScore?: number }).coverageScore).toBeUndefined();
    expect(g.target).toBeUndefined();
    expect(Object.keys(g)).toEqual(["entries", "totals", "generatedAt"]);
  });

  it("enrich：executionPlan 四层拓扑序（无缺口层跳过·不造空步）+ coverageScore + target", () => {
    const g = diffGap(
      { dataset: ["d1"], ontology_type: ["A", "B"], solver: ["s1"] },
      { ontology_type: new Set(["A"]), dataset: new Set(["d1"]) }, // content 层全 EXISTS → 跳过
      META({ enrich: true, target: { kind: "query", query: "问句" } }),
    );
    // content 无缺口 → 不出步；structure(B TO_CREATE) → step1；code(s1 MISSING) → step2
    expect(g.executionPlan!.map((s) => s.side)).toEqual(["structure", "code"]);
    expect(g.executionPlan!.map((s) => s.step)).toEqual([1, 2]);
    expect(g.executionPlan![0]!.keys).toEqual(["B"]);
    expect(g.totals.coverageScore).toBeTypeOf("number");
    expect(g.target).toEqual({ kind: "query", query: "问句" });
    expect(GapAnalysisSchema.safeParse(g).success).toBe(true);
  });

  it("computeCoverageScore：加权且仅计有需求侧·3 位定点确定", () => {
    // structure: existing/needed = 1/2 = 0.5, weight .3；code: 0/1=0, weight .4
    // score = (.3*0.5 + .4*0) / (.3+.4) = 0.15/0.7 = 0.2142857 → 0.214
    const entries = diffGap(
      { ontology_type: ["A", "B"], solver: ["s1"] },
      { ontology_type: new Set(["A"]) },
      META(),
    ).entries;
    expect(computeCoverageScore(entries)).toBe(0.214);
    expect(buildExecutionPlan(entries).map((s) => s.side)).toEqual(["structure", "code"]);
  });
});
