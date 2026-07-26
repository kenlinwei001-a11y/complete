import { describe, expect, it } from "vitest";
import type { PageContext } from "@platform/contracts";
import { createTestApp, submitQuery, waitForTask, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { domainResolveMulti } from "../src/router/domain-resolver.js";
import { selectDeterministicMultiRoute, detectCoupledPairs, assembleMultiDomainAnswer } from "../src/router/multi-route.js";

/**
 * WO-DETERMINISTIC-CROSS-DOMAIN · 确定性跨域分路 SEAM（把跨域题留在确定性层·零 LLM 拉回 path-A）。
 *
 * 头号判据（SEAM-2·根治证·亲手真跑）：同一跨域题——`qos.deterministic-multi-domain` **关** → 落 LLM（free-LLM/单域）；
 * **开** → 确定性接住（`deterministic:multi-domain`·classify 耗时=0·agentRequests=0）。直接证明「跨域题从落 LLM 变成留确定性层」。
 *
 * R6 命门：domainResolveMulti + selectDeterministicMultiRoute + 块装配全纯函数·零 LLM/随机/时钟·同问句同解字节一致。
 */

/** 风控员例（PRD §5·SEAM-1 旗舰）：一因（良率掉 2%）多果（交期↔atp_check / 毛利↔finance_pnl）·果与果独立。 */
const RISK_Q = "常州基地良率掉了2%，交期和毛利分别受多大影响？";
function riskPc(): PageContext {
  return { view: "risk", entities: [], selection: [], drillPath: [], actions: [], focus: { base: "常州" } };
}

describe("WO-DETERMINISTIC-CROSS-DOMAIN · 纯函数判定（R6·零 LLM）", () => {
  it("R6：同问句同 PageContext → domainResolveMulti 字节一致·风控员例枚举出 [margin→finance_pnl, atp→atp_check]", () => {
    const a = domainResolveMulti(RISK_Q, riskPc());
    const b = domainResolveMulti(RISK_Q, riskPc());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); // R6 命门
    expect(a.map((r) => r.solverKey)).toEqual(["finance_pnl", "atp_check"]);
    expect(a.every((r) => r.perDomainScore >= 0.6)).toBe(true); // 逐域去 −0.4 跨域惩罚后各够格
    const sel = selectDeterministicMultiRoute(a);
    expect(sel).not.toBeNull();
    expect(sel!.length).toBe(2);
  });

  it("无 PageContext → perDomainScore=0 → 判定 null（不冒进·上游照落单域/LLM）", () => {
    const routes = domainResolveMulti(RISK_Q, undefined);
    expect(routes.every((r) => r.perDomainScore === 0)).toBe(true);
    expect(selectDeterministicMultiRoute(routes)).toBeNull();
  });

  it("诚实边界：任一域被 open/orchestration 惩罚压到阈下 → 整体回落 null（不硬凑·不出假组合方案）", () => {
    const openQ = "如果常州毛利掉了，交期会不会受影响？"; // 含"如果/会不会"→ open → 各域 −0.6
    const routes = domainResolveMulti(openQ, riskPc());
    expect(routes.every((r) => r.perDomainScore < 0.6)).toBe(true);
    expect(selectDeterministicMultiRoute(routes)).toBeNull(); // whole-fallback（诚实·非强行多域错答）
  });

  it("单域族 → <2 → null（只对≥2 独立域启用·不劫持单域）", () => {
    expect(selectDeterministicMultiRoute(domainResolveMulti("常州毛利为什么下滑？", riskPc()))).toBeNull();
  });

  it("R13 耦合诚实标：供需↔交期检出耦合对·装配顶部标「独立测算·未链式传导·见 L3」·装配不造跨域新数字", () => {
    const routes = domainResolveMulti("常州供需对不上，交期分别受多大影响？", riskPc());
    const coupled = detectCoupledPairs(routes);
    expect(coupled.length).toBeGreaterThan(0);
    // 装配（用真 provenance 桩驱动纯装配器）：诚实标 + 每域独立 ⟦ref⟧ + 无裸业务数字。
    const products = routes.map((r, i) => ({
      route: r,
      toolCallId: `tc_${i}`,
      ok: true,
      outcome: "OK",
      durationMs: 1,
      data: { solverKey: r.solverKey, ok: true },
    }));
    const answer = assembleMultiDomainAnswer(products, coupled);
    const md = answer.blocks.map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("独立测算");
    expect(md).toContain("未链式传导");
    expect(md).toContain("⟦ref:0⟧");
    expect(md).toContain("⟦ref:1⟧");
    expect(answer.unverifiedNumerics).toBe(false); // 装配无裸业务数字（一律 ⟦ref⟧ 溯源·R13）
    expect(answer.provenance.length).toBe(2); // 每域一条独立溯源
  });
});

describe("WO-DETERMINISTIC-CROSS-DOMAIN · 活系统 SEAM（真跑 orchestrator）", () => {
  it("SEAM-1：flag 开 → 风控员跨域题被确定性接住·model=deterministic:multi-domain·agentRequests=0·无 classify·并行 2 solver·各 ⟦ref⟧", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "qos.deterministic-multi-domain"]);
    const { taskId } = await submitQuery(t, ADMIN, RISK_Q, { view: "risk", pageContext: riskPc() });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    expect(task.classification?.model).toBe("deterministic:multi-domain");
    expect(task.classification?.latencyMs).toBe(0); // 零 classify
    expect(t.llm.classifyRequests.length).toBe(0); // 无 LLM classify
    expect(t.llm.agentRequests.length).toBe(0); // 无 path-B agent（不落 LLM 推理路径）
    expect(task.path).toBe("WORKFLOW");

    const plan = task.multiIntentPlan!;
    expect(plan.routeSource).toBe("deterministic-multi-domain");
    expect(plan.synthesisMode).toBe("deterministic");
    expect(plan.selectedIntents.map((s) => s.solverKey)).toEqual(["finance_pnl", "atp_check"]); // 并行 2 solver
    expect(Object.keys(plan.parallelResults).length).toBe(2);

    const md = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("⟦ref:0⟧"); // 每域独立溯源
    expect(md).toContain("⟦ref:1⟧");
    await t.app.close();
  });

  it("SEAM-2（头号·根治证）：同一跨域题 flag 关→落 LLM（agent 被调）· flag 开→确定性接住（agentRequests=0·classify 耗时=0）", async () => {
    // —— flag 关（+ceo.free-llm 开：跨域被 −0.4 压下 → 落 path-B free-LLM agent = 落 LLM 推理路径）——
    const off: TestApp = await createTestApp();
    off.deps.features.mock.set(TENANT, [...defaultOnKeys(), "ceo.free-llm"]); // 多域门**关**
    off.llm.queueAgentTurn((_req) => ({
      content: [text("跨域连锁分析（探索模式）。"), toolUse("final_answer", { blocks: [{ type: "text", markdown: "跨域结论（path-B·LLM）。" }], provenance: [] })],
    }));
    const rOff = await submitQuery(off, ADMIN, RISK_Q, { view: "risk", pageContext: riskPc() });
    const tOff = await waitForTask(off, rOff.taskId, (x) => x.status === "COMPLETED");
    expect(tOff.classification?.model).not.toBe("deterministic:multi-domain"); // 未被确定性多路接住
    expect(off.llm.agentRequests.length).toBeGreaterThanOrEqual(1); // 落 LLM（path-B agent 真被调）
    expect(tOff.path).toBe("AGENT");
    await off.app.close();

    // —— flag 开（多域门开·ceo.free-llm 仍开）：确定性多路在 free-LLM 之前接住 → 零 LLM ——
    const on: TestApp = await createTestApp();
    on.deps.features.mock.set(TENANT, [...defaultOnKeys(), "ceo.free-llm", "qos.deterministic-multi-domain"]);
    const rOn = await submitQuery(on, ADMIN, RISK_Q, { view: "risk", pageContext: riskPc() });
    const tOn = await waitForTask(on, rOn.taskId, (x) => x.status === "COMPLETED");
    expect(tOn.classification?.model).toBe("deterministic:multi-domain"); // 确定性接住
    expect(tOn.classification?.latencyMs).toBe(0); // classify 耗时=0
    expect(on.llm.agentRequests.length).toBe(0); // 零 agentRequests（不再落 LLM）
    expect(on.llm.classifyRequests.length).toBe(0);
    await on.app.close();
  });

  it("SEAM-4：耦合跨域题 flag 开 → 确定性接住但综合顶部**诚实标**耦合（未链式传导·见 L3）·coupledPairs 非空", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "qos.deterministic-multi-domain"]);
    const { taskId } = await submitQuery(t, ADMIN, "常州供需对不上，交期分别受多大影响？", { view: "risk", pageContext: riskPc() });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.classification?.model).toBe("deterministic:multi-domain");
    expect(task.multiIntentPlan?.coupledPairs.length).toBeGreaterThan(0); // 检出耦合对
    const md = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("未链式传导"); // 诚实标·不假装联合方案
    expect(md).not.toContain("已给出联合"); // 防假综合（不出"看着全数字不勾稽"的组合方案）
    await t.app.close();
  });

  it("SEAM-5（零回归）：flag 关（默认 ALL）→ 跨域题**不**被多路劫持（沿用现单域 deterministic:ceo-route·非 multi-domain）", async () => {
    const t: TestApp = await createTestApp(); // 默认 ALL（deterministicMultiEnabled("ALL")=false）
    const { taskId } = await submitQuery(t, ADMIN, RISK_Q, { view: "risk", pageContext: riskPc() });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.classification?.model).not.toBe("deterministic:multi-domain"); // 关=不触发本 WO
    expect(task.multiIntentPlan).toBeUndefined();
    await t.app.close();
  });
});
