import { describe, expect, it } from "vitest";
import type { ComposePlan } from "@platform/contracts";
import { createTestApp, submitQuery, waitForTask, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { executePlan } from "../src/router/execute-plan.js";

/**
 * WO-PROMPT-KEYS-WIRE（闭 G-PROMPT-KEYS-CONFIG-ONLY · B 侧 answer_compose 键）· 接缝测：
 * 断言落在「这个键真的到达了 LLM 请求体」——admin 配 TENANT_OVERRIDE 后，组合路径综合步
 * 真实 compose 请求体的 instruction 以 override 模板为指令头；无 override → 硬编码默认
 * （与改造前逐字节一致·R6）。⟦ref:N⟧ 数字红线硬约束恒定追加，不被模板替换吞掉。
 *
 * 变异反证口径：拆掉 orchestrator.executePlanPath 的 resolvePromptOverride 取值（或
 * execute-plan 里的指令头替换）→ 本文件红在「请求体 instruction 没变成 override」，
 * 不是「配置读不到」（配置读写通路由 datacore prompt-template.test.ts 守）。
 *
 * 挂载点判定（为什么只接 execute-plan 综合步）：answer_compose 的语义消费方是「答案合成器
 * （求解器输出→可溯源答案）」——仓内 8 处 llm.compose 里唯一语义匹配的是 execute-plan.ts 的
 * 组合路径综合器；其余为滚动摘要（context.ts / production-cognition.ts / orchestrator 折叠压缩）、
 * L2 分解（orchestrator.tryL2Decompose）、工作流租户自定义 llm_compose 步（executor.ts）、
 * 适配层透传（providers.ts×2），语义均非「答案合成」，硬接会把答案合成器指令错塞进摘要/分解器。
 */

/** answer_compose 租户 override（含独特标记·断言「确实流入了请求体」）。 */
const COMPOSE_OVERRIDE = "【接管·租户自定义】本租户专属答案合成指令——ANSWER-COMPOSE-OVERRIDE-标记-5。";
const COMPOSE_MARK = "ANSWER-COMPOSE-OVERRIDE-标记-5";
/** 硬编码默认综合指令头（兜底在场的证据）。 */
const DEFAULT_HEAD = "你是组合路径综合器。";
/** 数字红线硬约束特征串（恒定追加·模板替换吞不掉的证据）。 */
const HARD_CONSTRAINT_MARK = "硬约束：综合步**不得自行编造任何数字**";

/** SEAM-1b 同款二步 serial 计划（真 executor × 真 mock solver）。 */
function twoStepPlan(): ComposePlan {
  return {
    planId: "compose_prompt_keys",
    steps: [
      { stepId: "s1", solverKey: "affected_orders", parallelGroup: 0, args: { baseId: "b-changzhou" }, argsFrom: [], reads: [] },
      { stepId: "s2", solverKey: "capacity_forecast", parallelGroup: 1, args: { modelId: "4680-NCM" }, argsFrom: [{ fromStep: "s1", outputPath: "count", toArg: "qty" }], reads: [] },
    ],
    synthesizeBlocks: ["根因", "台账"],
  };
}

const EXECUTOR_AUTH = { tenantId: TENANT, userId: "user-admin", roles: ["catalog_admin", "planner"] };

describe("WO-PROMPT-KEYS-WIRE · answer_compose 真进 compose 请求体（executePlan 直驱）", () => {
  it("给 composeInstructionOverride → 请求体 instruction 以 override 为头·硬约束恒在·硬编码头被替换", async () => {
    const t = await createTestApp();
    const executor = t.deps.engine.makeExecutor("task_pk_ov", EXECUTOR_AUTH);
    const result = await executePlan(twoStepPlan(), {
      executor,
      llm: t.llm,
      model: "test-model",
      tenantId: TENANT,
      composeInstructionOverride: COMPOSE_OVERRIDE,
    });
    expect(result.synthCount).toBe(1);
    expect(t.llm.composeRequests.length).toBe(1);
    const instr = t.llm.composeRequests[0]!.instruction;
    // ★ 断言点 = 请求体：override 逐字节在请求体 instruction 里。
    expect(instr).toContain(COMPOSE_MARK);
    expect(instr.startsWith(`${COMPOSE_OVERRIDE}\n综合以下 2 个求解器步骤的产物`)).toBe(true);
    expect(instr).not.toContain(DEFAULT_HEAD); // 灭漂移：硬编码头被替换
    expect(instr).toContain(HARD_CONSTRAINT_MARK); // 数字红线不被模板吞掉
    await t.app.close();
  });

  it("无 override → 请求体 instruction 与改造前逐字节一致（R6 字节兼容·零回归）", async () => {
    const t = await createTestApp();
    const executor = t.deps.engine.makeExecutor("task_pk_default", EXECUTOR_AUTH);
    await executePlan(twoStepPlan(), { executor, llm: t.llm, model: "test-model", tenantId: TENANT });
    expect(t.llm.composeRequests.length).toBe(1);
    expect(t.llm.composeRequests[0]!.instruction).toBe(
      `你是组合路径综合器。综合以下 2 个求解器步骤的产物，产出【根因】【台账】结论。` +
        `硬约束：综合步**不得自行编造任何数字**；每个业务数字必须以 ⟦ref:N⟧ 标注其来自第 N 步产物（N 从 0 起，对应输入 inputs[N]）。`,
    );
    await t.app.close();
  });

  it("override 空白 → 回落硬编码默认（防塞空指令头）", async () => {
    const t = await createTestApp();
    const executor = t.deps.engine.makeExecutor("task_pk_blank", EXECUTOR_AUTH);
    await executePlan(twoStepPlan(), {
      executor,
      llm: t.llm,
      model: "test-model",
      tenantId: TENANT,
      composeInstructionOverride: "   ",
    });
    expect(t.llm.composeRequests[0]!.instruction.startsWith(DEFAULT_HEAD)).toBe(true);
    await t.app.close();
  });
});

/** 落 classifier → path-B 并显式开暗发门 qos.compose-path（与 compose-plan-seam SEAM-1 同款布防）。 */
function armComposePath(t: TestApp): void {
  t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "qos.compose-path"]);
  t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
}

describe("WO-PROMPT-KEYS-WIRE · SEAM：orchestrator 组合路径真消费 DataCore answer_compose 模板", () => {
  const Q = "SO-3402 提前两周交怎么排，被挤的单根因归因到哪个环节短板拖累达成";

  it("admin 配 TENANT_OVERRIDE → 综合步请求体 instruction 带 override 标记（真路径驱动）", async () => {
    const t = await createTestApp();
    t.dataCore.prompts.setOverride(TENANT, "answer_compose", COMPOSE_OVERRIDE);
    armComposePath(t);
    const { taskId } = await submitQuery(t, ADMIN, Q);
    await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    // ★ 断言点 = 请求体：orchestrator 真路径的综合 compose 请求 instruction 含 override。
    const synth = t.llm.composeRequests.find((r) => r.instruction.includes("综合以下") || r.instruction.includes(COMPOSE_MARK));
    expect(synth).toBeDefined();
    expect(synth!.instruction).toContain(COMPOSE_MARK);
    expect(synth!.instruction).not.toContain(DEFAULT_HEAD);
    expect(synth!.instruction).toContain(HARD_CONSTRAINT_MARK);
    await t.app.close();
  });

  it("无 override → 综合步请求体 instruction = 硬编码默认（R6 字节兼容·零回归）", async () => {
    const t = await createTestApp();
    armComposePath(t);
    const { taskId } = await submitQuery(t, ADMIN, Q);
    await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    const synth = t.llm.composeRequests.find((r) => r.instruction.includes("综合以下"));
    expect(synth).toBeDefined();
    expect(synth!.instruction.startsWith(DEFAULT_HEAD)).toBe(true);
    expect(synth!.instruction).not.toContain(COMPOSE_MARK);
    await t.app.close();
  });
});
