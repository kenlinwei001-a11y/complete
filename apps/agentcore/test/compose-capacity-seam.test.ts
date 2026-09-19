import { describe, expect, it, vi } from "vitest";
import { createTestApp, submitQuery, waitForTask, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { defaultOnKeys } from "../src/features/registry.js";
import {
  isCapacityWhatIfQuery,
  parseCapacityWhatIf,
  buildCapacityNavSlice,
  capacityComposeSlots,
} from "../src/agent/sim-planner.js";
import { compileSolverPlan } from "../src/router/compile-plan.js";

/**
 * WO-LIVE-NL · 产能推演页 what-if NL 意图路由 SEAM（真接缝驱动·非各半绿）。
 *
 * 病根：产能页此前只有 QaPanel 正则假 NL（无真编排入口·C5）。本单加真意图识别 → 走 compose 确定性 path：
 * 结构化 what-if 问句（「常州化成良率降到92%产能少多少」）确定性解析出 base×factor 作用域（R6·无 LLM）→ 组合器纳入
 * **gap_attribution（因子级真根因·本单真算主体）** → executePlan 服务端跑 → 一次综合 · **runAgentLoop 零调用**（分水岭）。
 *
 * 诚实边界（KILL-MOCK-RED·亲手真跑实测·2026-07-24）：generic_inference 前向重算需 `Process.yield_baseline` 有下游派生边；
 * 当前种子本体 yield_baseline 是 TS_AGGREGATE 死叶（无 derivationSpec 消费）→ recompute 恒 0 deltas（即便真 objectId）。
 * 这是**数据半（datacore 本体派生边缺失）**、非路由半可补——故本单**不**编 generic_inference.apply 跑空壳（空壳绿=假可用），
 * 由 gap_attribution 出因子级真根因（实测 rootMetric 储能达成率/totalGap 27.8/3 levels/35 atomicLeaves/provenance）。
 * generic_inference 留在 slice 目录（无 apply → 组合器诚实落选），待 datacore 补 yield→产能派生边后自动纳入（fail-safe）。
 *
 * runAgentLoop-未调 判据：`t.llm.agentRequests.length===0`——runAgentLoop 是 llm.agent() 唯一调用者
 * （executePlan 一次综合走 llm.compose·与 agent() 分离），0 agent 往返 ⟺ 组合路径全程未落 runAgentLoop。
 */

const CAP_Q = "常州化成良率降到92%产能少多少";

function armPathB(t: TestApp): void {
  t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "qos.compose-path"]);
  t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
}

describe("WO-LIVE-NL · 产能 what-if NL 意图识别 + 确定性解析（纯函数 R6）", () => {
  it("识别产能 what-if 问句·排除全局推演/单订单重排（不劫持既有路径）", () => {
    expect(isCapacityWhatIfQuery(CAP_Q)).toBe(true);
    expect(isCapacityWhatIfQuery("涂布机 OEE 提到85%还够不够")).toBe(true);
    // 页上下文辅助：产能推演页上「哪个工序物料最卡 4680」（自身无「产能」字·靠页锚命中）。
    expect(isCapacityWhatIfQuery("哪个工序物料最卡 4680", { view: "capacity推演" } as never)).toBe(true);
    // 非 what-if 题不劫持；单订单重排（SO-号+重排/提前/挤占）归 sop_reschedule。
    expect(isCapacityWhatIfQuery("SO-12345 何时能交")).toBe(false);
    expect(isCapacityWhatIfQuery("SO-3402 提前两周交跨基地重排，产能够不够")).toBe(false);
    expect(isCapacityWhatIfQuery("邯郸是什么类型的基地")).toBe(false);
  });

  it("确定性解析 what-if 问句 → gap_attribution.scope（base×factor·真算主体）+ factor 上下文·R6 字节一致", () => {
    const a = parseCapacityWhatIf(CAP_Q);
    const b = parseCapacityWhatIf(CAP_Q);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); // R6 同问句同解析
    // 常州（BASE_REGISTRY）+ 良率（→cf-coating-yield）→ gap_attribution 因子级根因作用域。
    expect(a.scope).toMatchObject({ baseId: "changzhou", factorId: "cf-coating-yield" });
    // factor 上下文供叙述（objectType/prop/value）——**不**编成 generic_inference.apply（诚实边界·见文件头）。
    expect(a.factor).toMatchObject({ objectType: "Process", prop: "yield_baseline", value: 92 });
  });

  it("解析不出基地/因子 → scope 空（gap_attribution 退全域归因·仍真算·不臆造）", () => {
    const p = parseCapacityWhatIf("哪个工序物料最卡");
    expect(p.scope).toBeUndefined();
    expect(p.factor).toBeUndefined();
  });
});

describe("WO-LIVE-NL · compile：产能 what-if → gap_attribution 真编入（generic_inference 无 apply 诚实落选·非空壳）", () => {
  it("R6：同问句两次 compile 字节一致 + gap_attribution 真编入（scope 带 base×factor）", () => {
    const slots = capacityComposeSlots(CAP_Q);
    const a = compileSolverPlan(CAP_Q, buildCapacityNavSlice(CAP_Q), slots);
    const b = compileSolverPlan(CAP_Q, buildCapacityNavSlice(CAP_Q), slots);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.ok).toBe(true);
    if (a.ok) {
      const keys = a.plan.steps.map((s) => s.solverKey);
      expect(keys).toContain("gap_attribution"); // 无必填 → 真编入·因子级真根因（本单真算主体）
      // generic_inference 必填 apply·本单不喂（yield 无下游派生边·跑空壳=假可用）→ 诚实落选（KILL-MOCK-RED）。
      expect(keys).not.toContain("generic_inference");
      // capacity_forecast 必填 modelId·what-if 问句填不满 → 诚实落选（fail-safe）。
      expect(keys).not.toContain("capacity_forecast");
      // gap_attribution 步带 scope（真算依据）。
      const ga = a.plan.steps.find((s) => s.solverKey === "gap_attribution");
      expect(ga!.args.scope).toMatchObject({ baseId: "changzhou", factorId: "cf-coating-yield" });
    }
  });
});

describe("WO-LIVE-NL · SEAM 端到端：产能 what-if NL → compose 跑 gap_attribution 真根因 · 一次综合 · runAgentLoop 未调", () => {
  it("产能 what-if NL → executePlan 跑 gap_attribution（scope 真根因）· 综合一次 · runAgentLoop 零调用（命门·agentRequests==0）", async () => {
    const t = await createTestApp();
    armPathB(t);
    const composeSpy = vi.spyOn(t.llm, "compose");
    const invoked: { key: string; args: Record<string, unknown> }[] = [];
    const orig = t.dataCore.solver.invoke.bind(t.dataCore.solver);
    t.dataCore.solver.invoke = async (ctx, key, args) => {
      invoked.push({ key, args });
      return orig(ctx, key, args);
    };

    const { taskId } = await submitQuery(t, ADMIN, CAP_Q);
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    // ★ 命门：runAgentLoop 零调用（走确定性 compose·不掉回 agent 盲跳多跳）。
    expect(t.llm.agentRequests.length).toBe(0);
    // gap_attribution 服务端真跑·scope 带解析出的 base×factor（常州×良率）。
    const ga = invoked.find((i) => i.key === "gap_attribution");
    expect(ga).toBeTruthy();
    expect(ga!.args.scope).toMatchObject({ baseId: "changzhou", factorId: "cf-coating-yield" });
    // generic_inference 不被跑空壳（诚实落选·KILL-MOCK-RED·yield 无下游派生边）。
    expect(invoked.find((i) => i.key === "generic_inference")).toBeFalsy();
    // 一次综合（compose 单原语·非 agent 循环）。
    expect(composeSpy).toHaveBeenCalledTimes(1);
    // 数字红线：综合指令强制每业务数字 ⟦ref:N⟧ 溯步产物。
    expect(String(composeSpy.mock.calls[0]?.[0]?.instruction ?? "")).toContain("⟦ref:N⟧");
    // 答案不劣化 + 溯源齐（R13·每步 provenance）。
    expect((task.answer?.blocks?.length ?? 0)).toBeGreaterThan(0);
    expect((task.answer?.provenance?.length ?? 0)).toBeGreaterThan(0);
    await t.app.close();
  });

  it("SEAM 不劫持：qos.compose-path 未开 → 产能题照落 path-B（组合分支不存在·既有行为字节兼容）", async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys()]); // 不含 qos.compose-path
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn(() => ({
      content: [{ type: "tool_use", id: "tu1", name: "final_answer", input: { blocks: [{ type: "text", markdown: "path-B 答案" }], provenance: [] } }],
    }));
    const { taskId } = await submitQuery(t, ADMIN, CAP_Q);
    await waitForTask(t, taskId, (x) => ["COMPLETED", "FAILED"].includes(x.status));
    // 组合分支不存在 → 落 runAgentLoop（≥1 agent 往返·既有 path-B 逐字节不变）。
    expect(t.llm.agentRequests.length).toBeGreaterThanOrEqual(1);
    await t.app.close();
  });
});
