import { describe, expect, it, vi } from "vitest";
import { deriveVerifiedStatus } from "@platform/contracts";
import { createTestApp, TENANT } from "./helpers.js";
import { verifyCapability, probeRepresentativeNL } from "../src/capability/verify.js";
import type { RequestAuth } from "../src/auth.js";

/**
 * WO-2（可信自我账 §3.1）：Capability 代表问 **NL 路径** E2E harness 验收（齿①②③）。
 *
 * 核心：verifiedStatus 恒经 deriveVerifiedStatus 派生（禁手写·齿①）；harness 走 orchestrator.submitQuery
 * （问句→QOS→答案）**非**直调 /a/v1/solvers/{key}/invoke（齿②）；代表问答不出→诚实 UNVERIFIED（齿③）。
 */

const CZ = { objectType: "Base", objectId: "base_changzhou", label: "常州" };
const AUTH: RequestAuth = { tenantId: TENANT, userId: "user-planner", roles: ["planner"] };

describe("Capability 代表问 NL E2E harness（复用 GrowthTicket.verify 同机制）", () => {
  it("齿③(A)+齿②：制品在 + 代表问经 NL 路由答出 ANSWERABLE+dataBearing → VERIFIED（走 submitQuery 非直调 solver）", async () => {
    const t = await createTestApp();
    // NL 路径：分类器把问句路由到真实意图（affected_orders 走确定性工作流出 table = dataBearing）。
    t.llm.queueClassification({ candidates: [{ intentKey: "affected_orders", confidence: 0.95 }], outOfCatalog: false, extractedSlots: {} });

    // ★齿②监视：harness 唯一入口是 orchestrator.submitQuery（NL 问句）——绝无 solver invoke 直调。
    const spy = vi.spyOn(t.deps.orchestrator, "submitQuery");

    const { capability, probe } = await verifyCapability(
      { orchestrator: t.deps.orchestrator, repos: t.repos },
      AUTH,
      { key: "affected_orders", kind: "scenario_answer", claim: "回答受断供影响的订单", representativeQuery: "影响哪些订单？", acceptance: "本问句经 QOS NL 答出 dataBearing table" },
      { artifactExists: true, context: { view: "risk", selectedObjects: [CZ] } },
    );

    // 代表问经 NL 真跑答出。
    expect(probe.answered).toBe(true);
    expect(probe.task?.status).toBe("COMPLETED");
    // 齿②证据①：走的是问句提交（NL），query 即代表问。
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0]![1] as { query: string }).query).toBe("影响哪些订单？");
    // 齿②证据②：任务经 NL 路由（分类→WORKFLOW→意图命中），非手搓 args 直调求解器（那样 path/matchedIntent 皆空）。
    expect(probe.task?.path).toBe("WORKFLOW");
    expect(probe.task?.matchedIntent?.intentKey).toBe("affected_orders");
    // 齿①：verifiedStatus 出自派生器，VERIFIED 必挂 RUNTIME_PROBE 活证据。
    expect(capability.verifiedStatus).toBe("VERIFIED");
    expect(capability.evidence.kind).toBe("RUNTIME_PROBE");
    expect(capability.evidence.detail).toContain("ANSWERABLE");
  });

  it("齿③(B)：代表问无意图覆盖（无 LLM/缺能力）→ 代表问答不出 → 诚实 UNVERIFIED（绝不假 VERIFIED）", async () => {
    const t = await createTestApp();
    // 无候选意图（outOfCatalog）——模拟"无 LLM 真路由 / 缺该能力"：NL 路径答不出 ANSWERABLE。
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    // 路径 B agent 兜底：给个非 dataBearing 文本（探索级，非验证）。
    t.llm.queueAgentTurn({ content: [{ type: "text", text: "参考" }, { type: "tool_use", id: "tu0", name: "final_answer", input: { blocks: [{ type: "text", markdown: "本体外参考（无承载数据）。" }], provenance: [] } }] } as never);

    const { capability, probe } = await verifyCapability(
      { orchestrator: t.deps.orchestrator, repos: t.repos },
      AUTH,
      { key: "phantom_capability", kind: "solver", claim: "回答某不存在能力", representativeQuery: "本平台不覆盖的问题？" },
      { artifactExists: false, context: { view: "risk", selectedObjects: [] } },
    );

    expect(probe.answered).toBe(false); // NL 路由未答出 ANSWERABLE+dataBearing
    expect(capability.verifiedStatus).toBe("UNVERIFIED"); // 诚实空态·非假 VERIFIED
    expect(capability.verifiedStatus).not.toBe("VERIFIED");
    expect(capability.evidence.kind).not.toBe("ACCEPTANCE_PASS");
  });

  it("probeRepresentativeNL 只经 orchestrator.submitQuery 驱动（结构性：harness 无 solver-invoke 依赖）", async () => {
    const t = await createTestApp();
    t.llm.queueClassification({ candidates: [{ intentKey: "affected_orders", confidence: 0.95 }], outOfCatalog: false, extractedSlots: {} });
    const spy = vi.spyOn(t.deps.orchestrator, "submitQuery");
    const probe = await probeRepresentativeNL(
      { orchestrator: t.deps.orchestrator, repos: t.repos },
      AUTH,
      "影响哪些订单？",
      { context: { view: "risk", selectedObjects: [CZ] } },
    );
    // submitQuery 被调用一次（NL 问句），且 internal 标记（内部回归不受并发限流）。
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0]![3] as { internal?: boolean })?.internal).toBe(true);
    expect(probe.acceptanceRan).toBe(true);
    expect(probe.gap.question).toBe("影响哪些订单？");
  });

  it("齿①：deriveVerifiedStatus 是 verifiedStatus 唯一产出——三真为唯一 VERIFIED 路径（revert 派生逻辑→红）", () => {
    // 唯一为真：制品在 ∧ acceptance 跑 ∧ 代表问 NL 答出。
    expect(deriveVerifiedStatus({ artifactExists: true, acceptanceRan: true, representativeAnswered: true }).verifiedStatus).toBe("VERIFIED");
    // 缺任一现实信号即不可 VERIFIED（若 revert 成"总是 VERIFIED"，这几条即红）。
    for (const bad of [
      { artifactExists: false, acceptanceRan: true, representativeAnswered: true },
      { artifactExists: true, acceptanceRan: false, representativeAnswered: true },
      { artifactExists: true, acceptanceRan: true, representativeAnswered: false },
    ]) {
      expect(deriveVerifiedStatus(bad).verifiedStatus).not.toBe("VERIFIED");
    }
    // 曾验证过 + 现重跑失败 → STALE（漂移）。
    expect(deriveVerifiedStatus({ artifactExists: true, acceptanceRan: true, representativeAnswered: false, priorVerified: true }).verifiedStatus).toBe("STALE");
  });
});
