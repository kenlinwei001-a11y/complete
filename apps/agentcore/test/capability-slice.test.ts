import { describe, expect, it } from "vitest";
import { CapabilitySliceSchema, type EvalRunReport } from "@platform/contracts";
import { buildEvalCapabilitySlice, unwiredSlice, EVAL_GATE } from "../src/capability/slice.js";

/**
 * WO-5（可信自我账 §3.6·SELF-SURFACES-SLICE）：散落自我面 → 统一 Capability/Gap slice 投影验收。
 *
 * 核心红线（本 PRD 根治的诈账）：
 *  - 齿①：verifiedStatus 恒经 WO-2 派生器产出（禁手打）——MOCK 高分**绝不假 VERIFIED**。
 *  - 齿②：slice 每行携 Capability(verifiedStatus) + actionable Gap 三元（what/where/acceptance）逐值可对。
 *  - 齿③：未接入面诚实占位（wired=false），不假装已归一。
 */

function run(over: Partial<EvalRunReport>): EvalRunReport {
  return {
    id: "erun_x",
    tenantId: "demo",
    suite: "classifier",
    startedAt: "2026-07-01T08:00:00Z",
    finishedAt: "2026-07-01T08:01:00Z",
    total: 20,
    passed: 19,
    passRate: 0.95,
    metrics: { intentAccuracy: 0.95, toolCorrectness: 0.9, avgToolCalls: 2, avgLatencyMs: 300, avgTokenCost: 1000 },
    results: [],
    llmMode: "MOCK",
    parity: { byFailKind: { INTENT: 0, TOOLSEQ: 0, ANSWER: 0, OTHER: 0 }, byCase: [] },
    ...over,
  };
}

describe("WO-5 · eval 面 → Capability/Gap slice 投影", () => {
  it("齿①：MOCK 高分（passRate=0.95）也**诚实 UNVERIFIED**——绝不假 VERIFIED（anti-fake-done 根线）", () => {
    const slice = buildEvalCapabilitySlice([run({ llmMode: "MOCK", passRate: 0.95 })], "2026-07-06T00:00:00Z");
    expect(slice.wired).toBe(true);
    const row = slice.rows.find((r) => r.capability.key === "eval:classifier")!;
    expect(row.capability.verifiedStatus).toBe("UNVERIFIED"); // ← revert 此判据（去掉 llmMode==REAL 要求）即红
    // actionable Gap 三元逐值可对（永不"内部错误/dash"）。
    const llmGap = row.gaps.find((g) => g.gapCode === "LLM_PURPOSE_UNBOUND")!;
    expect(llmGap.what).toContain("真实 LLM 未接入");
    expect(llmGap.where).toContain("LLM Provider 绑定");
    expect(llmGap.acceptance).toContain("llmMode=REAL");
    expect(llmGap.blocking).toBe(true);
    // 证据挂 MOCK 说明（指明真值证在何处）。
    expect(row.capability.evidence.detail).toContain("MOCK 跑分仅证框架");
    expect(slice.note).toContain("MOCK");
  });

  it("齿①：REAL + passRate≥门禁 + parity 全对 → VERIFIED·无 actionable Gap", () => {
    const slice = buildEvalCapabilitySlice(
      [run({ llmMode: "REAL", passRate: 0.95, parity: { byFailKind: { INTENT: 0, TOOLSEQ: 0, ANSWER: 0, OTHER: 0 }, byCase: [] } })],
      "2026-07-06T00:00:00Z",
    );
    const row = slice.rows.find((r) => r.capability.key === "eval:classifier")!;
    expect(row.capability.verifiedStatus).toBe("VERIFIED");
    expect(row.gaps).toHaveLength(0);
    expect(row.capability.evidence.kind).toBe("RUNTIME_PROBE");
  });

  it("REAL 但通过率不足门禁 → UNVERIFIED + 通过率 Gap", () => {
    const slice = buildEvalCapabilitySlice([run({ llmMode: "REAL", passRate: 0.8, passed: 16 })], "2026-07-06T00:00:00Z");
    const row = slice.rows.find((r) => r.capability.key === "eval:classifier")!;
    expect(row.capability.verifiedStatus).toBe("UNVERIFIED");
    const g = row.gaps.find((x) => x.what.includes("通过率"))!;
    expect(g.what).toContain(`低于门禁 ${Math.round(EVAL_GATE * 100)}%`);
    expect(g.acceptance).toContain("passRate");
  });

  it("parity 失因逐类映射为 actionable Gap（意图错分/工具序列偏）", () => {
    const slice = buildEvalCapabilitySlice(
      [run({ llmMode: "REAL", passRate: 0.95, parity: { byFailKind: { INTENT: 2, TOOLSEQ: 1, ANSWER: 0, OTHER: 0 }, byCase: [] } })],
      "2026-07-06T00:00:00Z",
    );
    const row = slice.rows.find((r) => r.capability.key === "eval:classifier")!;
    // VERIFIED（passRate 达门禁）但 parity 有偏 → 非阻塞改进 Gap。
    expect(row.capability.verifiedStatus).toBe("VERIFIED");
    const intentGap = row.gaps.find((g) => g.gapCode === "NO_INTENT")!;
    expect(intentGap.what).toContain("意图错分 2 例");
    expect(intentGap.blocking).toBe(false);
    expect(row.gaps.some((g) => g.what.includes("工具序列偏 1 例"))).toBe(true);
  });

  it("STALE：曾以 REAL 达门禁·最新 REAL 跌破 → 漂移曝光", () => {
    const slice = buildEvalCapabilitySlice(
      [
        run({ id: "erun_old", startedAt: "2026-06-01T08:00:00Z", llmMode: "REAL", passRate: 0.95 }),
        run({ id: "erun_new", startedAt: "2026-07-01T08:00:00Z", llmMode: "REAL", passRate: 0.6, passed: 12 }),
      ],
      "2026-07-06T00:00:00Z",
    );
    const row = slice.rows.find((r) => r.capability.key === "eval:classifier")!;
    expect(row.capability.verifiedStatus).toBe("STALE");
  });

  it("多套件 → 各一行·稳定序（按 key）", () => {
    const slice = buildEvalCapabilitySlice(
      [run({ suite: "regression" }), run({ suite: "classifier" }), run({ suite: "agent_quality" })],
      "2026-07-06T00:00:00Z",
    );
    expect(slice.rows.map((r) => r.capability.key)).toEqual(["eval:agent_quality", "eval:classifier", "eval:regression"]);
    // 每行 kind=feature（统一收编 feature 能力）。
    expect(slice.rows.every((r) => r.capability.kind === "feature")).toBe(true);
  });

  it("无评测运行 → 诚实空 slice（wired=true·rows=[]·note 指明跑一次即出）", () => {
    const slice = buildEvalCapabilitySlice([], "2026-07-06T00:00:00Z");
    expect(CapabilitySliceSchema.parse(slice)).toBeTruthy();
    expect(slice.wired).toBe(true);
    expect(slice.rows).toHaveLength(0);
    expect(slice.note).toContain("跑一次");
  });

  it("齿③：未接入面 → 诚实占位（wired=false）·不假装已归一", () => {
    const s = unwiredSlice("fallback", "2026-07-06T00:00:00Z");
    expect(s.wired).toBe(false);
    expect(s.rows).toHaveLength(0);
    expect(s.note).toContain("后续增量");
  });
});
