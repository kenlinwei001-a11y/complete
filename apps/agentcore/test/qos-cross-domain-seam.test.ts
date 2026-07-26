import { describe, expect, it, vi } from "vitest";
import { createTestApp, submitQuery, waitForTask, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { selectMultiIntent } from "../src/router/multi-intent.js";

/**
 * WO-QOS-CROSS-DOMAIN-UNIFIED · 跨域编排统一 SEAM（②确定性多路 + ⑤LLM 多意图兜底 + Coordinator 让位·真接缝驱动）。
 *
 * 头号判据 = SEAM-Q2：Q2 型跨域复杂问句（良率↓·产出↓·长协覆盖·延误·外协）在 **agent.coordinator 与
 * qos.deterministic-multi-domain 同开**时——不进 Coordinator（治 5 分钟黑洞）、零 classify LLM、并行 ≥3 对口
 * solver、秒级分节答案带 ⟦ref⟧ + 耦合诚实标。对照：det 关 → 同题老路进 Coordinator（证明修的就是这条）。
 */

const Q2 =
  "常州 4680-NCM 涂布良率下降2%，未来4周有效产出下降5%，7月三元长协覆盖70%，哪些订单会延误，外协还是加班补缺口？";

/** 富 PageContext（riskPc 同款·contextRich 门要求 focus/entities/selection 至少其一）。 */
const richPc = () => ({ view: "risk", entities: [], selection: [], drillPath: [], actions: [], focus: { base: "常州" } });

describe("统一单 · SEAM-Q2（头号·治 Coordinator 5 分钟黑洞）", () => {
  it("Q2 · coordinator+det 同开 → ② 先于 Coordinator 接住：零 LLM·并行 ≥3 solver·耦合诚实标·无 coordinator.planned", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator", "qos.deterministic-multi-domain"]);

    const invoked: string[] = [];
    const orig = t.dataCore.solver.invoke.bind(t.dataCore.solver);
    t.dataCore.solver.invoke = async (ctx, key, args) => {
      invoked.push(key);
      return orig(ctx, key, args);
    };

    const { taskId } = await submitQuery(t, ADMIN, Q2, { view: "risk", pageContext: richPc() });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    // ── 命门：确定性接住·不进 Coordinator·零 LLM ──
    expect(task.classification?.model).toBe("deterministic:multi-domain");
    expect(task.classification?.model).not.toBe("coordinator");
    expect(task.classification?.latencyMs).toBe(0);
    expect(t.llm.classifyRequests.length).toBe(0); // 零 classify LLM
    expect(t.llm.agentRequests.length).toBe(0); // 零 agent 往返（不落 runAgentLoop/Coordinator 扇出）
    const events = await t.repos.events.listAfter(taskId, 0);
    expect(events.find((e) => e.event === "coordinator.planned")).toBeFalsy();
    expect(task.path).toBe("WORKFLOW");

    // 并行 ≥3 个 Q2 对口 solver（5 域全枚举·统一单 SEAM-Q2 底线 ≥3）。
    const q2Solvers = ["yield_diagnosis", "capacity_forecast", "lta_gap", "affected_orders", "outsourcing_split"];
    const hit = q2Solvers.filter((s) => invoked.includes(s));
    expect(hit.length).toBeGreaterThanOrEqual(3);
    // capacity_forecast 的 modelId 从问句 token 确定性抽出（槽可填硬门·非硬凑）。
    expect(task.multiIntentPlan?.selectedIntents.find((s) => s.solverKey === "capacity_forecast")?.slots).toMatchObject({ modelId: "4680-NCM" });

    // 耦合诚实标（SEAM-4 语义并入）：coupledPairs 非空 + 未链式传导 + 见 L3 + 不假称联合方案。
    expect((task.multiIntentPlan?.coupledPairs.length ?? 0)).toBeGreaterThan(0);
    const md = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("独立测算");
    expect(md).toContain("未链式传导");
    expect(md).toContain("L3");
    expect(md).not.toContain("已给出联合");
    expect(md).not.toContain("精确实测组合方案");
    // 每域独立溯源（≥3 域 → ⟦ref:0..2⟧ 至少在）。
    expect(md).toContain("⟦ref:0⟧");
    expect(md).toContain("⟦ref:2⟧");
    expect((task.answer?.provenance.length ?? 0)).toBeGreaterThanOrEqual(3);
    await t.app.close();
  });

  it("对照（证明修的就是这条）：det 关·仅 coordinator 开 → Q2 走老路进 Coordinator（coordinator.planned 发出）", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]); // 不含 qos.deterministic-multi-domain
    // Coordinator 扇出的角色 agent 需 LLM——排空脚本让子 agent 快速终结（本测只证"进了 Coordinator"·非其答案质量）。
    for (let i = 0; i < 8; i++) t.llm.queueAgentTurn({ content: [{ type: "text", text: "（子 agent 结束）" }] });
    const { taskId } = await submitQuery(t, ADMIN, Q2, { view: "risk", pageContext: richPc() });
    await waitForTask(t, taskId, (x) => ["COMPLETED", "FAILED"].includes(x.status), 15000);
    const events = await t.repos.events.listAfter(taskId, 0);
    expect(events.find((e) => e.event === "coordinator.planned")).toBeTruthy(); // 老路：Coordinator 抢走跨域题
    await t.app.close();
  });
});

describe("统一单 步4 · ⑤ LLM 多意图兜底（classify 后·澄清前·共享确定性后半）", () => {
  it("selectMultiIntent 纯函数：≥2 高置信+槽可填 → 命中；同 solver 去重；<2 幸存 → null；耦合对检出", () => {
    const base = { requiredSlots: [], filledSlots: [], sectionTitle: "t" };
    // 命中 + 耦合检出（outsourcing_split↔capacity_forecast 在 SOLVER_DEP_GRAPH）。
    const hit = selectMultiIntent(
      [
        { ...base, intentKey: "a", confidence: 0.9, solverKey: "outsourcing_split" },
        { ...base, intentKey: "b", confidence: 0.85, solverKey: "capacity_forecast" },
      ],
      { tauMid: 0.8, maxIntents: 4 },
    );
    expect(hit).not.toBeNull();
    expect(hit!.coupledPairs).toEqual([["outsourcing_split", "capacity_forecast"]]);
    // 低置信淘汰 + 同 solver 去重 → <2 → null。
    expect(
      selectMultiIntent(
        [
          { ...base, intentKey: "a", confidence: 0.9, solverKey: "x" },
          { ...base, intentKey: "b", confidence: 0.7, solverKey: "y" },
          { ...base, intentKey: "c", confidence: 0.88, solverKey: "x" },
        ],
        { tauMid: 0.8, maxIntents: 4 },
      ),
    ).toBeNull();
    // 必填槽不可填 → 淘汰。
    expect(
      selectMultiIntent(
        [
          { ...base, intentKey: "a", confidence: 0.9, solverKey: "x", requiredSlots: ["m"], filledSlots: [] },
          { ...base, intentKey: "b", confidence: 0.9, solverKey: "y" },
        ],
        { tauMid: 0.8, maxIntents: 4 },
      ),
    ).toBeNull();
  });

  it("⑤ 端到端：classify 出 2 高置信候选 → 同一共享后半并行 2 solver·routeSource=llm-multi-intent·零 agent 往返·不落澄清", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "qos.multi-intent-orchestration"]);
    // 复合问句（确定性 ② 未开）→ classify 出 2 高置信候选 + 抽好双意图必填槽（base/model/demandDelta）——
    // ⑤ 用 fillSlots 真探针校验可填·plan 的 invoke_solver args 模板经 resolveTemplate 用这些槽渲染成具体 solver args。
    t.llm.queueClassification({
      candidates: [
        { intentKey: "affected_orders", confidence: 0.9 },
        { intentKey: "capacity_feasibility", confidence: 0.85 },
      ],
      outOfCatalog: false,
      extractedSlots: {
        base: { objectType: "Base", objectId: "base_changzhou", label: "常州" },
        model: { objectType: "Model", objectId: "model_4680_ncm", label: "4680-NCM" },
        demandDelta: 0.2,
      },
    });
    const composeSpy = vi.spyOn(t.llm, "compose");
    const invoked: string[] = [];
    const orig = t.dataCore.solver.invoke.bind(t.dataCore.solver);
    t.dataCore.solver.invoke = async (ctx, key, args) => {
      invoked.push(key);
      return orig(ctx, key, args);
    };

    const { taskId } = await submitQuery(t, ADMIN, "常州基地影响哪些订单，同时 4680-NCM 需求增量接不接得住？");
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    expect(task.multiIntentPlan?.routeSource).toBe("llm-multi-intent"); // ⑤ 兜底路·不冒充确定性
    expect(task.classification?.model).not.toBe("deterministic:multi-domain"); // classify 真产物保留
    expect(invoked).toContain("affected_orders");
    expect(invoked).toContain("capacity_forecast");
    expect(t.llm.agentRequests.length).toBe(0); // 并行 solver + 确定性装配·零 agent 往返
    expect(composeSpy).toHaveBeenCalledTimes(0); // 零 LLM 综合（synthesisMode=deterministic）
    expect(task.status).toBe("COMPLETED"); // 命中即并行·未落 AWAITING_CLARIFICATION（排在澄清前）
    expect((task.answer?.provenance.length ?? 0)).toBe(2);
    await t.app.close();
  });

  it("⑤ 不劫持（零回归）：flag 默认关 → 同样的双候选 classify 照走单意图 top-1 路径（multiIntentPlan 无）", async () => {
    const t: TestApp = await createTestApp();
    t.llm.queueClassification({
      candidates: [
        { intentKey: "affected_orders", confidence: 0.9 },
        { intentKey: "capacity_feasibility", confidence: 0.85 },
      ],
      outOfCatalog: false,
      extractedSlots: {},
    });
    const { taskId } = await submitQuery(t, ADMIN, "常州基地影响哪些订单，同时 4680-NCM 需求增量接不接得住？");
    const task = await waitForTask(t, taskId, (x) => ["COMPLETED", "AWAITING_CLARIFICATION", "FAILED"].includes(x.status));
    expect(task.multiIntentPlan).toBeUndefined(); // ⑤ 未介入（"ALL" 降级 → false）
    await t.app.close();
  });
});

describe("统一单 · SEAM-partial（R7 单 solver 失败不塌）", () => {
  it("Q2 · lta_gap 抛错 → 该节诚实标「未计算+原因」·其余域正常·不臆造", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "qos.deterministic-multi-domain"]);
    const orig = t.dataCore.solver.invoke.bind(t.dataCore.solver);
    t.dataCore.solver.invoke = async (ctx, key, args) => {
      if (key === "lta_gap") throw new Error("长协数据源不可达（测试注入）");
      return orig(ctx, key, args);
    };
    const { taskId } = await submitQuery(t, ADMIN, Q2, { view: "risk", pageContext: richPc() });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    const plan = task.multiIntentPlan!;
    const ltaResult = Object.entries(plan.parallelResults).find(([k]) => k === "lta");
    expect(ltaResult?.[1].ok).toBe(false); // 该域失败留痕
    const md = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("未计算"); // 诚实标
    expect(md).toContain("⟦ref:0⟧"); // 其余域正常出节
    await t.app.close();
  });
});
