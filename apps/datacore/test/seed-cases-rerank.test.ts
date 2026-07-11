import { describe, expect, it } from "vitest";
import { createMemoryRepos } from "../src/repo/memory.js";
import { seedDemoDecisionCases } from "../src/seed.js";
import {
  projectCase,
  retrieveSimilarCases,
  IDENTITY_RERANKER,
  DEFAULT_EMBEDDING_PROVIDER,
  type CaseReranker,
  type DecisionArtifact,
} from "../src/memory/decision-case.js";
import type { DecisionCase, SimilarityHit } from "@platform/contracts";

/**
 * WO-L1.5-5 齿（出厂 SEED 案例 + RL/GNN 离线可插拔占位·§4.5/§10·KILL-MOCK-RED）：
 *  ① seedDemoDecisionCases 播 5 例·**全 origin:SEED**（诚实底料·非冒充真实累积）·幂等·R6;
 *  ② SEED 诚实：source:SEED → origin 恒 SEED（opts 洗不成 LEARNED·冒充被堵·V7);
 *  ③ RL 占位：默认 IDENTITY_RERANKER → 命中序 = 纯 §4.2 确定式（R6 兜底·CI 不变）·换 reranker 生效;
 *  ④ DEFAULT_EMBEDDING_PROVIDER = pseudoEmbed（占位默认·确定性）。
 */
describe("WO-L1.5-5 · 出厂 SEED 案例 + RL/GNN 离线占位", () => {
  it("① seedDemoDecisionCases 播 5 例·全 origin:SEED·幂等·R6", async () => {
    const repos = createMemoryRepos();
    await seedDemoDecisionCases(repos);
    const cases = await repos.decisionCases.list("demo");
    expect(cases.length).toBe(5);
    expect(cases.every((c) => c.origin === "SEED")).toBe(true); // 全 SEED·非冒充
    expect(cases.every((c) => c.source === "SEED")).toBe(true);
    expect(cases.every((c) => c.disclaimer.length > 0)).toBe(true); // 随行免责
    // 幂等 + R6：重播 → 仍 5·字节一致（固定 now·upsert-by-caseId）。
    const snap1 = JSON.stringify([...cases].sort((a, b) => (a.caseId < b.caseId ? -1 : 1)));
    await seedDemoDecisionCases(repos);
    const cases2 = await repos.decisionCases.list("demo");
    expect(cases2.length).toBe(5);
    expect(JSON.stringify([...cases2].sort((a, b) => (a.caseId < b.caseId ? -1 : 1)))).toBe(snap1);
  });

  it("② SEED 诚实：source:SEED → origin 恒 SEED（opts 洗不成 LEARNED·V7）", () => {
    const a: DecisionArtifact = { source: "SEED", refId: "s", title: "t", context: "c", options: [{ key: "a", label: "A" }], chosen: "a", ctx: { intentKey: "affected_orders" } };
    const kase = projectCase(a, { tenantId: "demo", now: "2026-01-01T00:00:00.000Z", origin: "LEARNED" }); // 故意试洗
    expect(kase.origin).toBe("SEED"); // 恒 SEED·冒充被堵
    // 对照：真 Decision 源 → LEARNED（真实积累）。
    const learned = projectCase({ ...a, source: "DECISION", refId: "dec_x" }, { tenantId: "demo", now: "2026-01-01T00:00:00.000Z" });
    expect(learned.origin).toBe("LEARNED");
  });

  it("③ RL 占位：IDENTITY_RERANKER 兜底 = 纯确定命中序（R6）·换 reranker 生效", async () => {
    const repos = createMemoryRepos();
    await seedDemoDecisionCases(repos);
    const cases = (await repos.decisionCases.list("demo")) as DecisionCase[];
    const q = { tenantId: "demo", text: "产能缺口延期外协", problemClass: "gap_closure_synthesis", entities: [], metrics: [], topK: 5, weightsVersion: "v1" };
    // 默认（identity）与显式 identity → 同（R6 兜底·CI 不变）。
    const def = retrieveSimilarCases(cases, q);
    const idn = retrieveSimilarCases(cases, q, IDENTITY_RERANKER);
    expect(JSON.stringify(def)).toBe(JSON.stringify(idn));
    // 换离线 reranker（逆序·占位证可插拔）→ 命中序变（证装配位生效·非死板）。
    const reverse: CaseReranker = { rerank: (hits: SimilarityHit[]) => [...hits].reverse() };
    const rev = retrieveSimilarCases(cases, q, reverse);
    if (def.hits.length >= 2) expect(rev.hits[0].caseId).not.toBe(def.hits[0].caseId);
  });

  it("④ DEFAULT_EMBEDDING_PROVIDER = pseudoEmbed（确定性占位默认）", () => {
    const e1 = DEFAULT_EMBEDDING_PROVIDER.embed("常州基地产能缺口");
    const e2 = DEFAULT_EMBEDDING_PROVIDER.embed("常州基地产能缺口");
    expect(e1).toEqual(e2); // R6
    expect(e1.length).toBeGreaterThan(0);
  });
});
