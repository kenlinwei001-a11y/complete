import { describe, expect, it } from "vitest";
import { createTestApp, submitQuery, waitForTask, ADMIN, PLANNER, TENANT, type TestApp } from "./helpers.js";
import { toolUse, text } from "../src/llm/mock.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { seedRegistry } from "../src/mocks/seed.js";

/**
 * WO-LOOP-CONTROL-P2.5 · Escalation Ladder rung② SEAM（收口 P2 诚实延后的 rung②·经**真** submitQuery→runPathB→runAgentLoop）。
 *
 * 背景：叶子 agent 在 runAgentLoop 造不出扇出（"升级重路由"属 orchestrator/runPathB 层）。P2 交了 rung①（换策略再试一轮）
 * + rung③（degrade），rung②（升级 Coordinator 多角色扇出）诚实延后。后果：单 agent 自由多跳题若**没命中** proactive
 * Coordinator 跨域关键词、却在 runAgentLoop 停滞 → 现只能 rung①→rung③ 直接 degrade·从不尝试拆多角色重解。
 * 本单补 rung②：停滞单 agent → orchestrator **反应式重路由**到 Coordinator 扇出 → 再不行才 degrade。
 *
 * 接缝（A 侧 entitlement agent.escalation × B 侧 runPathB→runAgentLoop 停滞上抛 result.stalled × Coordinator 扇出）：
 *  ① rung② 先于 degrade：escalation 开 → agent_escalated(REROUTE_COORDINATOR) → Coordinator 反应式扇出(多角色 invoke_agent)
 *     → **在 degrade 之前**（无 agent_degraded）→ 最终返回扇出综合答案（非 degrade）。
 *  ② 红咬对照：escalation 关 → 同题单 agent 停滞 → **无** reroute → **直接** degrade（byte-compat 同 P2·round3 早停）。
 *  ③ 防双 Coordinator：已命中 proactive Coordinator 的跨域题 → proactive 扇出（一次）→ **不**反应式重入（无 REROUTE_COORDINATOR）。
 *  ④ 一次性：rung② 至多一次（无无限重路由·coordinator.planned 一次）。
 *  ⑤ R6：rung② 路径两跑路由决策一致。
 */

const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };

function stepSeqOf(events: { seq: number; event: string; payload: unknown }[], type: string, outcome?: string): number {
  return (
    events.find(
      (e) =>
        e.event === "step.completed" &&
        (e.payload as { type?: string })?.type === type &&
        (outcome === undefined || (e.payload as { outcome?: string })?.outcome === outcome),
    )?.seq ?? -1
  );
}
function seqOf(events: { seq: number; event: string }[], event: string): number {
  return events.find((e) => e.event === event)?.seq ?? -1;
}
function countStep(events: { event: string; payload: unknown }[], type: string, outcome?: string): number {
  return events.filter(
    (e) =>
      e.event === "step.completed" &&
      (e.payload as { type?: string })?.type === type &&
      (outcome === undefined || (e.payload as { outcome?: string })?.outcome === outcome),
  ).length;
}

/** 停滞病态：反复调不存在的切片（确定性 ERROR）→ S01 连续失败停滞（复用 P2 停滞夹具）。 */
function queueStallTurns(t: TestApp, rounds: number): void {
  for (let i = 0; i < rounds; i++) {
    t.llm.queueAgentTurn({ content: [toolUse("resolve_slice", { sliceKey: "__nope__", args: {} })] });
  }
}

/** 把 seed 注册表 agents 灌入测试 repos（helpers 默认只种 package/intents/plans）。 */
async function seedAgents(t: TestApp): Promise<void> {
  for (const ag of seedRegistry().agents) {
    if (!(await t.repos.agents.get(ag.id))) await t.repos.agents.insert(ag);
  }
}

/** 监视 engine.runRegisteredAgent → 记录真被调的 agentId 列表（证扇出真调 ≥2 不同角色 agent·非伪装）。 */
function spyInvokedAgents(t: TestApp): { ids: string[] } {
  const rec = { ids: [] as string[] };
  const orig = t.deps.engine.runRegisteredAgent.bind(t.deps.engine);
  t.deps.engine.runRegisteredAgent = async (opts) => {
    rec.ids.push(opts.agentId);
    return orig(opts);
  };
  return rec;
}

/** 单 agent 停滞（escalation 开·6 轮：round3 rung① → round6 rung① 用尽）后，3 角色扇出各给一个 final_answer。 */
function queueRoleFinals(t: TestApp): void {
  t.llm.queueAgentTurn(() => ({
    content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "物料存在缺口：正极粉短缺，齐套受阻。" }], provenance: [] })],
  }));
  t.llm.queueAgentTurn(() => ({
    content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "产能可承接，化成工序有瓶颈但排程可覆盖。" }], provenance: [] })],
  }));
  t.llm.queueAgentTurn(() => ({
    content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "良率稳定达标，无异常波动。" }], provenance: [] })],
  }));
}

describe("WO-LOOP-CONTROL-P2.5 · Escalation Ladder rung②（反应式重路由到 Coordinator·SEAM 头号）", () => {
  it("① rung② 先于 degrade：escalation 开 → agent_escalated(REROUTE)→Coordinator 扇出(多角色)→非 degrade 综合答案", async () => {
    const t: TestApp = await createTestApp();
    // escalation 开、coordinator **关**（proactive 不接手·题落单 agent path-B → 停滞 → 反应式 rung②）。
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.escalation"]);
    await seedAgents(t);
    const spy = spyInvokedAgents(t);
    t.llm.queueClassification(OUT_OF_CATALOG);
    queueStallTurns(t, 6); // 单 agent：round3 rung① 换策略 → round6 rung① 用尽仍停滞 → 上抛 result.stalled
    queueRoleFinals(t); // rung② 反应式扇出 3 角色各 final_answer

    // 无域关键词题（不命中 proactive Coordinator）：单 agent 停滞 → rung② stalled-mode 兜底三角会诊。
    const { taskId } = await submitQuery(t, PLANNER, "反复取一个不存在的切片直到卡住", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15000);
    expect(task.status).toBe("COMPLETED");
    expect(task.path).toBe("AGENT");

    const events = await t.repos.events.listAfter(taskId, 0);
    const rerouteSeq = stepSeqOf(events, "agent_escalated", "REROUTE_COORDINATOR");
    const plannedSeq = seqOf(events, "coordinator.planned");
    const finalSeq = seqOf(events, "answer.final");
    const degSeq = stepSeqOf(events, "agent_degraded");

    // rung② 升级信号（REROUTE_COORDINATOR）出现 → 早于 Coordinator 反应式扇出 → 早于 final。
    expect(rerouteSeq).toBeGreaterThan(0);
    expect(plannedSeq).toBeGreaterThan(0);
    expect(rerouteSeq).toBeLessThan(plannedSeq);
    expect(plannedSeq).toBeLessThan(finalSeq);
    // **在 degrade 之前** = 根本不发 agent_degraded（rung② 成功 → runPathB 早 return·不落 degrade 兜底）。
    expect(degSeq).toBe(-1);

    // Coordinator 反应式扇出真调 ≥2 个不同角色 agent（spy·非单 agent 换 prompt 伪装）。
    expect(spy.ids).toContain("agt_supply_chain");
    expect(new Set(spy.ids).size).toBeGreaterThanOrEqual(2);

    // 最终返回扇出**综合答案**（非 degrade 的"未能完全解答"）：每角色一栏 + 各自答进汇总。
    const md = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("供应链");
    expect(md).toContain("生产");
    expect(md).toContain("正极粉短缺"); // 供应链角色答真进汇总
    expect(md).not.toContain("未能完全解答"); // 非 degrade 收尾
    expect(task.classification?.model).toBe("coordinator"); // runCoordinator 收尾（rung② 真走 Coordinator）

    // ④ 一次性：rung② 至多一次（无无限重路由）。
    expect(countStep(events, "agent_escalated", "REROUTE_COORDINATOR")).toBe(1);
    expect(events.filter((e) => e.event === "coordinator.planned").length).toBe(1);
    await t.app.close();
  });

  it("② 红咬对照：escalation 关 → 同题单 agent 停滞 → 无 reroute → 直接 degrade（byte-compat 同 P2·round3 早停）", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys()]); // 显式不含 agent.escalation
    await seedAgents(t);
    const spy = spyInvokedAgents(t);
    t.llm.queueClassification(OUT_OF_CATALOG);
    queueStallTurns(t, 6);

    const { taskId } = await submitQuery(t, PLANNER, "反复取一个不存在的切片直到卡住", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15000);
    expect(task.status).toBe("COMPLETED");

    const events = await t.repos.events.listAfter(taskId, 0);
    // escalation 关 → result.stalled undefined → rung② 短路 → 无 REROUTE·无反应式扇出 → 直接 degrade。
    expect(stepSeqOf(events, "agent_escalated", "REROUTE_COORDINATOR")).toBe(-1);
    expect(seqOf(events, "coordinator.planned")).toBe(-1);
    expect(spy.ids.length).toBe(0);
    expect(stepSeqOf(events, "agent_degraded")).toBeGreaterThan(0); // 停滞直接降级
    expect(task.classification?.model).not.toBe("coordinator");
    // byte-compat：与既有 S01 一样 round3 早停（无 rung① 换策略轮·无 rung② 扇出）。
    expect(t.llm.agentRequests.length).toBe(3);
    await t.app.close();
  });

  it("③ 防双 Coordinator：跨域题命中 proactive Coordinator → proactive 扇出一次 → 不反应式重入（无 REROUTE）", async () => {
    const t: TestApp = await createTestApp();
    // coordinator + escalation **都开**：跨域关键词题命中 proactive Coordinator(:531·runCoordinator)·**不**再到 runPathB rung②。
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator", "agent.escalation"]);
    await seedAgents(t);
    const spy = spyInvokedAgents(t);
    // proactive Coordinator 先于 classify → 不 queueClassification；扇出 3 角色各 final_answer。
    queueRoleFinals(t);

    const { taskId } = await submitQuery(t, ADMIN, "常州这批订单的交付风险怎么解", { view: "risk" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15000);
    expect(task.status).toBe("COMPLETED");

    const events = await t.repos.events.listAfter(taskId, 0);
    // proactive Coordinator 接手（classification.model=coordinator）·**唯一**一次扇出。
    expect(task.classification?.model).toBe("coordinator");
    expect(events.filter((e) => e.event === "coordinator.planned").length).toBe(1);
    // **无** rung② 反应式重入（REROUTE_COORDINATOR 不出现·防双 Coordinator·不第二次扇出）。
    expect(stepSeqOf(events, "agent_escalated", "REROUTE_COORDINATOR")).toBe(-1);
    // 扇出真调 ≥2 角色（proactive 那一次·非两次叠加）。
    expect(new Set(spy.ids).size).toBeGreaterThanOrEqual(2);
    await t.app.close();
  });

  it("⑤ R6：rung② 路径两跑路由决策一致（reroute/coordinator/扇出角色数 全同）", async () => {
    const runOnce = async () => {
      const t: TestApp = await createTestApp();
      t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.escalation"]);
      await seedAgents(t);
      const spy = spyInvokedAgents(t);
      t.llm.queueClassification(OUT_OF_CATALOG);
      queueStallTurns(t, 6);
      queueRoleFinals(t);
      const { taskId } = await submitQuery(t, PLANNER, "反复取一个不存在的切片直到卡住", { view: "dash" });
      const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15000);
      const events = await t.repos.events.listAfter(taskId, 0);
      const out = {
        reroute: stepSeqOf(events, "agent_escalated", "REROUTE_COORDINATOR") > 0,
        model: task.classification?.model,
        roles: new Set(spy.ids).size,
        planned: events.filter((e) => e.event === "coordinator.planned").length,
        degraded: stepSeqOf(events, "agent_degraded") > 0,
      };
      await t.app.close();
      return out;
    };
    const a = await runOnce();
    const b = await runOnce();
    expect(a.reroute).toBe(true);
    expect(a.model).toBe("coordinator");
    expect(a.roles).toBeGreaterThanOrEqual(2);
    expect(a.planned).toBe(1);
    expect(a.degraded).toBe(false); // rung② 成功 → 不落 degrade
    expect(b).toEqual(a);
  });
});
