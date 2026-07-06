import { describe, expect, it, vi } from "vitest";
import { deriveVerifiedStatus } from "@platform/contracts";
import { classifyGap } from "../src/growth/probe.js";
import { verifyCapability } from "../src/capability/verify.js";
import {
  GENERIC_SOLVER_INTENT_KEYS,
  genericSolverCapabilitySpecs,
  buildGenericSolverCapabilitySlice,
} from "../src/capability/generic-solvers.js";
import { SCENARIO_CATALOG } from "../src/scenarios-catalog.js";
import { createTestApp, PLANNER, submitQuery, waitForTask, TENANT } from "./helpers.js";
import type { RequestAuth } from "../src/auth.js";

/**
 * CORE-NL-SOLVER-ROUTING（本体 §8 MULTISRC-FUSION/QUERY30-ORCH/GAP-SCENE-C 共性根）验收：
 *  C1：5 个通用多跳求解器场景卡的代表问经 QOS **NL 真路由**（submitQuery·分类→路径A 工作流→invoke_solver）
 *      → verdict=ANSWERABLE、path=WORKFLOW、matchedIntent 命中、答案 dataBearing（非 OTHER 非缺口）。
 *  C3：每个新接能力经 verifyCapability（同一 NL 路径·**非直调 /solvers/invoke**）→ verifiedStatus=VERIFIED
 *      + evidence.kind=RUNTIME_PROBE（deriveVerifiedStatus 唯一产出·禁手打）。
 *
 * LLM 一律 mock（确定性·分类经 queueClassification 脚本化，其余全链真跑：意图绑定→计划→求解器→渲染投影→诚实门）。
 */

const AUTH: RequestAuth = { tenantId: TENANT, userId: "user-planner", roles: ["planner"] };
const CARDS = SCENARIO_CATALOG.filter((c) => (GENERIC_SOLVER_INTENT_KEYS as readonly string[]).includes(c.intentKey));
const DATA_BEARING = (blocks: { type?: string; markdown?: string }[]) =>
  blocks.some((b) => b.type === "kpi" || b.type === "table" || b.type === "rule_violation" || b.type === "action_draft" ||
    (b.type === "text" && /⟦ref:/.test(String(b.markdown ?? ""))));

describe("CORE-NL-SOLVER-ROUTING · C1 代表问经 NL 真路由→路径A 求解器作答（非缺口）", () => {
  it("目录含 5 个通用求解器卡（S21–S25），各指向真实注册的 graph 求解器", () => {
    expect(CARDS).toHaveLength(5);
    expect(CARDS.map((c) => c.solver).sort()).toEqual(
      ["concentration_risk", "margin_attribution", "multisource_fusion", "shared_bottleneck", "supplier_disruption_radius"],
    );
  });

  for (const card of CARDS) {
    it(`「${card.triggerQuestion}」→ ${card.solver}：ANSWERABLE + path=WORKFLOW + matchedIntent 命中 + dataBearing`, async () => {
      const t = await createTestApp();
      // NL 路径：分类器把代表问路由到该意图（其余全链真跑：路径A 工作流→invoke_solver→solver_summary 投影）。
      t.llm.queueClassification({ candidates: [{ intentKey: card.intentKey, confidence: 0.95 }], outOfCatalog: false, extractedSlots: {} });

      const { taskId, statusCode } = await submitQuery(t, PLANNER, card.triggerQuestion, { view: card.view });
      expect(statusCode).toBe(202);
      const task = await waitForTask(t, taskId);

      // 路由证据：走 NL 分类→路径A 工作流→命中意图（非手搓 args 直调求解器）。
      expect(task.status).toBe("COMPLETED");
      expect(task.path).toBe("WORKFLOW");
      expect(task.matchedIntent?.intentKey).toBe(card.intentKey);
      // 答案投影求解器真实输出字段（kpi/table 承载数据块）——非 OTHER 非空投影。
      const blocks = task.answer?.blocks ?? [];
      expect(DATA_BEARING(blocks), `答案无承载数据块：${JSON.stringify(blocks).slice(0, 200)}`).toBe(true);
      // 诚实门：classifyGap 视之为 ANSWERABLE（内含 dataBearing 门）。
      expect(classifyGap(task).verdict).toBe("ANSWERABLE");
    });
  }
});

describe("CORE-NL-SOLVER-ROUTING · C3 Capability harness（VERIFIED·RUNTIME_PROBE·非直调 solver）", () => {
  it("5 项 CapabilitySpec 从目录派生（kind=solver·representativeQuery=代表问）", () => {
    const specs = genericSolverCapabilitySpecs();
    expect(specs).toHaveLength(5);
    for (const s of specs) {
      expect(s.kind).toBe("solver");
      expect(s.representativeQuery.length).toBeGreaterThan(0);
    }
  });

  for (const card of CARDS) {
    it(`能力「${card.solver}」代表问经 NL 真答出 → VERIFIED + RUNTIME_PROBE（走 submitQuery 非直调 solver）`, async () => {
      const t = await createTestApp();
      t.llm.queueClassification({ candidates: [{ intentKey: card.intentKey, confidence: 0.95 }], outOfCatalog: false, extractedSlots: {} });
      // 齿②：harness 唯一入口是 orchestrator.submitQuery（NL 问句）——无 solver invoke 直调。
      const spy = vi.spyOn(t.deps.orchestrator, "submitQuery");

      const { capability, probe } = await verifyCapability(
        { orchestrator: t.deps.orchestrator, repos: t.repos },
        AUTH,
        { key: card.solver, kind: "solver", claim: card.summary, representativeQuery: card.triggerQuestion },
        { artifactExists: true, context: { view: card.view } },
      );

      expect(probe.answered).toBe(true);
      expect(probe.task?.path).toBe("WORKFLOW");
      expect(spy).toHaveBeenCalledTimes(1);
      expect((spy.mock.calls[0]![1] as { query: string }).query).toBe(card.triggerQuestion);
      // 齿①：verifiedStatus 派生（三真为唯一 VERIFIED 路径），VERIFIED 必挂 RUNTIME_PROBE 活证据。
      expect(capability.verifiedStatus).toBe("VERIFIED");
      expect(capability.evidence.kind).toBe("RUNTIME_PROBE");
    });
  }

  it("buildGenericSolverCapabilitySlice：surface=solvers·wired·5 行全 VERIFIED（RUNTIME_PROBE）", async () => {
    const t = await createTestApp();
    for (const _card of CARDS) t.llm.queueClassification({ candidates: [{ intentKey: _card.intentKey, confidence: 0.95 }], outOfCatalog: false, extractedSlots: {} });
    const slice = await buildGenericSolverCapabilitySlice({ orchestrator: t.deps.orchestrator, repos: t.repos }, AUTH);
    expect(slice.surface).toBe("solvers");
    expect(slice.wired).toBe(true);
    expect(slice.rows).toHaveLength(5);
    for (const row of slice.rows) {
      expect(row.capability.verifiedStatus).toBe("VERIFIED");
      expect(row.capability.evidence.kind).toBe("RUNTIME_PROBE");
      expect(row.gaps).toHaveLength(0);
    }
  });

  it("齿③：制品不在/代表问答不出 → 诚实 UNVERIFIED（deriveVerifiedStatus 唯一路径·绝不假 VERIFIED）", () => {
    // 三真为唯一 VERIFIED；缺任一即不可 VERIFIED（revert 派生逻辑成"总 VERIFIED"这几条即红）。
    expect(deriveVerifiedStatus({ artifactExists: true, acceptanceRan: true, representativeAnswered: true }).verifiedStatus).toBe("VERIFIED");
    expect(deriveVerifiedStatus({ artifactExists: true, acceptanceRan: true, representativeAnswered: false }).verifiedStatus).toBe("UNVERIFIED");
  });
});
