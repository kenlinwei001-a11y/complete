import { describe, expect, it } from "vitest";
import { createTestApp, submitQuery, waitForTask, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { QOS_20Q_GOLDSET } from "./fixtures/qos-20q-goldset.js";
import { domainResolve, preferDeterministicSolver, DETERMINISTIC_PREFERENCE_THRESHOLD } from "../src/router/domain-resolver.js";

/**
 * WO-QOS-1 · A 确定性优先门 SEAM（真 20 题·治本 path-B 延迟·闭 G-AGENT-BLIND-REACT 路由侧一半）。
 *
 * 头号判据（SEAM-GATE·非各半绿）：
 *  ① Q5「储能份额逐层拆根因」→ 活系统真跑 → `classification.model = deterministic:ceo-route`（**非** `agent:ceo-free-llm`）·
 *     落 path-A gap_attribution（含"逐层"下钻词但仍被拉回 path-A·避免 LLM 盲选·秒级）——即便 ceo.free-llm 开也不劫持。
 *  ② #20「综合分析连锁影响」（真开放）→ **仍走 path-B**（agent:ceo-free-llm·不误降级给窄 solver）。
 *  ③ precision：跑全 20 题金标 → **误降级 = 0**（本该 path-B 的一个都没被拉去 path-A）——硬门。
 */

describe("WO-QOS-1 · 确定性优先门 precision（20 题金标·误降级=0·R6 确定性）", () => {
  it("③ 硬门：跑全 20 题 → class① 高置信命中对口 solver·class②③ 一律低置信照落 path-B（误降级=0）", () => {
    let misdowngrade = 0; // 本该 path-B 却被拉去 path-A
    let missA = 0; // 本该 path-A 却没被拉回
    const detail: string[] = [];
    for (const g of QOS_20Q_GOLDSET) {
      const det = preferDeterministicSolver(domainResolve(g.query, g.pageContext));
      const pulledToA = det.confidence >= DETERMINISTIC_PREFERENCE_THRESHOLD && Boolean(det.solverKey);
      if (!g.expectPathA && pulledToA) {
        misdowngrade++;
        detail.push(`#${g.no}[${g.cls}] 误降级→path-A(${det.solverKey}·conf=${det.confidence})`);
      }
      if (g.expectPathA) {
        if (!pulledToA) {
          missA++;
          detail.push(`#${g.no}[①] 漏拉回(conf=${det.confidence}·solver=${det.solverKey ?? "无"})`);
        } else if (g.expectSolver && det.solverKey !== g.expectSolver) {
          detail.push(`#${g.no}[①] solver 错配 期望 ${g.expectSolver} 得 ${det.solverKey}`);
        }
      }
    }
    expect(misdowngrade, `误降级 must be 0 · ${detail.join(" | ")}`).toBe(0); // 硬门
    expect(missA, `class① recall · ${detail.join(" | ")}`).toBe(0); // 头号例召回
    // class① 落对口求解器 key（路由对齐）。
    for (const g of QOS_20Q_GOLDSET.filter((x) => x.expectPathA)) {
      const det = preferDeterministicSolver(domainResolve(g.query, g.pageContext));
      expect(det.solverKey).toBe(g.expectSolver);
    }
  });

  it("R6 确定性：同问句同上下文重跑 → 字节一致（无 LLM/时钟/随机）", () => {
    for (const g of QOS_20Q_GOLDSET) {
      const a = JSON.stringify(preferDeterministicSolver(domainResolve(g.query, g.pageContext)));
      const b = JSON.stringify(preferDeterministicSolver(domainResolve(g.query, g.pageContext)));
      expect(a).toBe(b);
    }
  });

  it("Q5 vs #20 判定对比（标尺有牙）：Q5 高置信 path-A·#20 无对口 solver 照落 path-B", () => {
    const q5 = QOS_20Q_GOLDSET.find((g) => g.no === 5)!;
    const q20 = QOS_20Q_GOLDSET.find((g) => g.no === 20)!;
    const d5 = preferDeterministicSolver(domainResolve(q5.query, q5.pageContext));
    const d20 = preferDeterministicSolver(domainResolve(q20.query, q20.pageContext));
    expect(d5.confidence).toBeGreaterThanOrEqual(DETERMINISTIC_PREFERENCE_THRESHOLD);
    expect(d5.solverKey).toBe("gap_attribution");
    expect(d20.confidence).toBeLessThan(DETERMINISTIC_PREFERENCE_THRESHOLD);
  });
});

describe("WO-QOS-1 · 确定性优先门 SEAM（活系统真跑·ceo.free-llm 开·证不被 LLM 盲选劫持）", () => {
  it("① Q5「储能份额逐层拆根因」→ path-A deterministic:ceo-route·落 ceo_root_cause/gap_attribution（非 agent:ceo-free-llm）", async () => {
    const t: TestApp = await createTestApp();
    // ceo.free-llm **开**：无本门则 Q5（含"逐层"→shouldUseFreeLLM=true）会被 free-LLM 劫持进慢 agent。本门把它拉回 path-A。
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "ceo.free-llm"]);
    const q5 = QOS_20Q_GOLDSET.find((g) => g.no === 5)!;
    const { taskId } = await submitQuery(t, ADMIN, q5.query, { view: q5.pageContext.view, pageContext: q5.pageContext });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.path).toBe("WORKFLOW"); // path-A（非 path-B agent）
    expect(task.classification?.model).toBe("deterministic:ceo-route"); // 确定性路由（非 agent:ceo-free-llm 盲选）
    expect(task.matchedIntent?.intentKey).toBe("ceo_root_cause"); // 落对口意图
    expect(task.slots?.metricKey).toBe("seg_attain_ess"); // args 真达 gap_attribution 求解器
    expect((task.answer?.blocks?.length ?? 0)).toBeGreaterThan(0); // 出答（27.8% 数值由真 datacore gap_attribution 产出·见亲验）
    await t.app.close();
  });

  it("② #20「综合分析连锁影响」（真开放）→ 仍走 path-B agent:ceo-free-llm（不误降级给窄 solver）", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "ceo.free-llm"]);
    // path-B 真 LLM 自由多跳（mock 一轮 final_answer 收尾）。
    t.llm.queueAgentTurn((_req) => ({
      content: [text("综合多域连锁影响分析（探索模式）。"), toolUse("final_answer", { blocks: [{ type: "text", markdown: "连锁影响综合结论（path-B）。" }], provenance: [] })],
    }));
    const q20 = QOS_20Q_GOLDSET.find((g) => g.no === 20)!;
    const { taskId } = await submitQuery(t, ADMIN, q20.query, { view: q20.pageContext.view, pageContext: q20.pageContext });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.path).toBe("AGENT"); // 仍 path-B（未被确定性门拉走）
    expect(task.classification?.model).toBe("agent:ceo-free-llm"); // 真 LLM 自由多跳（非确定性窄 solver）
    await t.app.close();
  });

  it("字节兼容：ceo.free-llm **关**（默认 ALL）下 Q5 行为不变——仍 deterministic:ceo-route path-A（既有确定性路径零回归）", async () => {
    const t: TestApp = await createTestApp(); // 默认 ALL（freeLlm off）
    const q5 = QOS_20Q_GOLDSET.find((g) => g.no === 5)!;
    const { taskId } = await submitQuery(t, ADMIN, q5.query, { view: q5.pageContext.view, pageContext: q5.pageContext });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.classification?.model).toBe("deterministic:ceo-route");
    expect(task.path).toBe("WORKFLOW");
    await t.app.close();
  });
});
