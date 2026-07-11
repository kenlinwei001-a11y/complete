import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AnswerBlock } from "@platform/contracts";
import { createTestApp, PLANNER, submitQuery, waitForTask, type TestApp } from "./helpers.js";

/**
 * WO-SANDBOX-SHOCK-NO-FLOOR（用户 2026-07-11 亲定扩红线：绝不无 LLM 起推演）· G-SANDBOX-DET-SHOCK。
 * 收紧 `maybeRenderSandbox`：只有真 LLM 语义分类的 shock 才起沙盘推演；classification.model 以
 * `deterministic:` 开头（关键词级 bigram 匹配·无 LLM 语义）的 shock → 走 DEFERRED、不装配 sandbox_render
 * （诚实缩范围·KILL-MOCK-RED 不假跑）。LLM 一律 mock（不打真网络）。
 *
 * 齿①：deterministic 分类的 shock（不 queueClassification → LLM classify 失败 → deterministicClassify 兜底·
 *       model="deterministic:example-match"）→ 无 sandbox_render·DEFERRED 诚实文本。若改回（让 deterministic
 *       shock 起）即红。
 * 齿②：真 LLM 分类的 shock（queueClassification → model=claude-* 非 deterministic:*）→ 仍产 sandbox_render（不回归）。
 */

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.app.close();
});

const blocksOf = (task: { answer?: { blocks: AnswerBlock[] } }): AnswerBlock[] => task.answer?.blocks ?? [];
// sim.shock_whatif 的种子 example（seed.ts）——确定性 bigram 全覆盖 → deterministicClassify 强命中该意图。
const SHOCK_EXAMPLE = "常州二线停3周，交付缺口多大？";

describe("沙盘 shock 无 LLM 不起推演（G-SANDBOX-DET-SHOCK·绝不无 LLM 起推演）", () => {
  it("齿①：deterministic 分类的 shock → DEFERRED 诚实文本·绝不装配 sandbox_render（无关键词级推演）", async () => {
    // 不 queueClassification → orchestrator.classify 重试后 undefined → deterministicClassify 兜底
    //（model="deterministic:example-match"·无 LLM 语义）。查询用 shock example 原文 → 确定性强命中 sim.shock_whatif。
    const { taskId } = await submitQuery(t, PLANNER, SHOCK_EXAMPLE, {
      view: "risk",
      selectedObjects: [{ objectType: "Base", objectId: "常州二线" }],
    });
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    // 确认确实走了 deterministic 分类路径（前置条件·非 LLM/非 short-circuit），否则本齿失去意义。
    expect(task.classification?.model ?? "").toMatch(/^deterministic:/);

    const blocks = blocksOf(task);
    // 命门：deterministic shock 绝不装配 sandbox_render 推演（关键词级选取对象/stateVar = 无 LLM 起推演 → 禁止）。
    expect(blocks.some((b) => b.type === "sandbox_render")).toBe(false);
    // 诚实 DEFERRED 文本：说明无 LLM 语义下不做关键词级推演对象选取。
    const txt = blocks.find((b) => b.type === "text");
    expect(txt?.type === "text" && /无 LLM|关键词级|诚实缩范围|推演对象/.test(txt.markdown)).toBe(true);
  });

  it("齿②：真 LLM 分类的 shock（model 非 deterministic:*）→ 仍产 sandbox_render（不回归）", async () => {
    t.llm.queueClassification({
      candidates: [{ intentKey: "sim.shock_whatif", confidence: 0.95 }],
      outOfCatalog: false,
      extractedSlots: { stateVar: "load", delta: 20, weeks: 3 },
    });
    const { taskId } = await submitQuery(t, PLANNER, SHOCK_EXAMPLE, {
      view: "risk",
      selectedObjects: [{ objectType: "Base", objectId: "常州二线" }],
    });
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    // 真 LLM 分类 → model 非 deterministic:*（默认 QOS_CLASSIFIER_MODEL=claude-haiku-4-5）。
    expect(task.classification?.model ?? "").not.toMatch(/^deterministic:/);

    const sr = blocksOf(task).find((b) => b.type === "sandbox_render");
    expect(sr, "真 LLM 分类的 shock 应仍装配 sandbox_render").toBeTruthy();
    if (sr?.type !== "sandbox_render") return;
    expect(sr.request.source).toBe("dialogue");
    const act = sr.request.scenario[0]!;
    expect(act.kind).toBe("shock");
    if (act.kind === "shock") {
      expect(act.delta).toBe(20);
      expect(act.target.stateVar).toBe("load");
    }
  });
});
