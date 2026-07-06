import { describe, expect, it } from "vitest";
import type { SkillDefinition } from "@platform/contracts";
import { seedRegistry, seedIntentsAndPlans } from "../src/mocks/seed.js";
import { materializeIntents } from "../src/intents/materialize.js";
import { INTENT_MODE } from "../src/intents/intent-mode.js";
import { SCENARIO_CATALOG } from "../src/scenarios-catalog.js";
import { skillMethodologyBlock } from "../src/workflow/executor.js";

/**
 * SKILL-LIBRARY-EVERYWHERE 齿（用户亲定·独立 skill 库·全预设）：
 *  ① 引用完整性门——agent/workflow/plan/intent 引用的每个 skillId 必存在且 PUBLISHED（孤儿引用红）。
 *  ② 20 卡 skill 配置覆盖——每张场景卡（13 workflow-first / 7 agent-first）都逐一挂对口方法论 + 承载体（plan/agent）在位。
 *  ③ workflow-skill 确定性消费——skillMethodologyBlock 字节稳定 + 随 skill 模板变化（非 LLM 注入·R6）。
 * revert 任一机制（删 skill / 去 skillRefs / methodology 置空）→ 本测试红（亲验）。
 */
describe("SKILL-LIBRARY-EVERYWHERE 齿", () => {
  const { agents, workflows, skills } = seedRegistry();
  const { plans } = seedIntentsAndPlans();
  const intents = materializeIntents();

  const publishedById = new Map<string, SkillDefinition>();
  for (const s of skills) if (s.status === "PUBLISHED") publishedById.set(s.id, s);

  const isValid = (skillId: string): boolean => publishedById.has(skillId);

  it("① skill 库已具广度（≥10 条方法论·各带 description/summary·发布态）", () => {
    const published = skills.filter((s) => s.status === "PUBLISHED");
    expect(published.length).toBeGreaterThanOrEqual(10);
    for (const s of published) {
      expect(s.summary.trim().length).toBeGreaterThan(0); // 发现纪律：能力句必填
      expect(s.name.trim().length).toBeGreaterThan(0);
    }
  });

  it("① 引用完整性门：agent.skills 引用的 skillId 全部存在且 PUBLISHED（孤儿红）", () => {
    const orphans: string[] = [];
    for (const a of agents) {
      for (const ref of a.skills) if (!isValid(ref.skillId)) orphans.push(`agent ${a.id} → ${ref.skillId}`);
    }
    expect(orphans).toEqual([]);
  });

  it("① 引用完整性门：workflow.skillRefs 引用的 skillId 全部存在且 PUBLISHED（孤儿红）", () => {
    const orphans: string[] = [];
    for (const w of workflows) {
      for (const ref of w.skillRefs ?? []) if (!isValid(ref.skillId)) orphans.push(`workflow ${w.id} → ${ref.skillId}`);
    }
    expect(orphans).toEqual([]);
    // 每条 seed workflow 都必须挂方法论（组装口方法论绑定·§3）
    for (const w of workflows) expect((w.skillRefs ?? []).length).toBeGreaterThan(0);
  });

  it("① 引用完整性门：plan.skillRefs 引用的 skillId 全部存在且 PUBLISHED（孤儿红）", () => {
    const orphans: string[] = [];
    for (const p of plans) {
      for (const ref of p.skillRefs ?? []) if (!isValid(ref.skillId)) orphans.push(`plan ${p.id} → ${ref.skillId}`);
    }
    expect(orphans).toEqual([]);
    for (const p of plans) expect((p.skillRefs ?? []).length).toBeGreaterThan(0); // Path A 计划逐一挂方法论
  });

  it("① 引用完整性门：materializedIntent.bindings.skillId 全部存在且 PUBLISHED（孤儿红）", () => {
    const orphans: string[] = [];
    for (const mi of intents) if (!isValid(mi.bindings.skillId)) orphans.push(`intent ${mi.key} → ${mi.bindings.skillId}`);
    expect(orphans).toEqual([]);
  });

  it("② 20 卡 skill 配置覆盖：每张卡挂对口方法论（13 workflow-first / 7 agent-first 分组齐）", () => {
    // 单源派生·禁再硬编码计数（SYSFIX-SOLVER-COUNT-DRIFT）
    expect(SCENARIO_CATALOG.length).toBe(Object.keys(INTENT_MODE).length); // 场景卡目录 == mode 钉死表键数（两独立注册表互校）
    const intentByKey = new Map(intents.map((i) => [i.key, i]));
    let workflowFirst = 0;
    let agentFirst = 0;
    for (const card of SCENARIO_CATALOG) {
      const mi = intentByKey.get(card.intentKey);
      expect(mi, `卡 ${card.sNo}/${card.intentKey} 应有物化意图`).toBeTruthy();
      // 逐卡挂对口方法论（覆盖）
      expect(isValid(mi!.bindings.skillId), `卡 ${card.sNo} 方法论 ${mi!.bindings.skillId} 应有效发布`).toBe(true);
      const mode = INTENT_MODE[card.intentKey] ?? "WORKFLOW_FIRST";
      if (mode === "AGENT_FIRST") {
        agentFirst++;
        // 承载体在位：agent-first 卡绑定 agent，且该 agent 自身挂 ≥1 有效方法论
        const agentId = (mi!.bindings as { agentId?: string }).agentId;
        expect(agentId, `卡 ${card.sNo} agent-first 应绑 agentId`).toBeTruthy();
        const agent = agents.find((a) => a.id === agentId);
        expect(agent, `卡 ${card.sNo} 绑定 agent ${agentId} 应存在`).toBeTruthy();
        expect(agent!.skills.some((s) => isValid(s.skillId)), `agent ${agentId} 应挂 ≥1 有效方法论`).toBe(true);
      } else {
        workflowFirst++;
        // 承载体在位：workflow-first 卡绑定执行计划（workflowId）
        expect((mi!.bindings as { workflowId?: string }).workflowId, `卡 ${card.sNo} workflow-first 应绑 workflowId`).toBeTruthy();
      }
    }
    // 单源派生·禁再硬编码计数（SYSFIX-SOLVER-COUNT-DRIFT）
    expect(workflowFirst).toBe(Object.values(INTENT_MODE).filter((m) => m === "WORKFLOW_FIRST").length); // 卡遍历 WF 计数 == 钉死表 WF 计数（产出 vs 源）
    // 单源派生·禁再硬编码计数（SYSFIX-SOLVER-COUNT-DRIFT）
    expect(agentFirst).toBe(Object.values(INTENT_MODE).filter((m) => m === "AGENT_FIRST").length); // 卡遍历 AGENT 计数 == 钉死表 AGENT 计数（产出 vs 源）
  });

  it("② 库存量广度：20 卡至少覆盖 6 种不同方法论（不再一律指向少数几条）", () => {
    const distinct = new Set(intents.map((i) => i.bindings.skillId));
    expect(distinct.size).toBeGreaterThanOrEqual(6);
  });

  it("③ workflow-skill 确定性消费：skillMethodologyBlock 字节稳定 + 随 skill 模板变化（非 LLM·R6）", () => {
    const capacity = publishedById.get("skl_seed_capacity")!;
    const risk = publishedById.get("skl_risk_diagnosis")!;
    expect(capacity).toBeTruthy();
    expect(risk).toBeTruthy();

    const b1 = skillMethodologyBlock([capacity]);
    const b2 = skillMethodologyBlock([capacity]);
    expect(b1).toBeTruthy();
    expect(b1).toEqual(b2); // 字节一致（R6）

    // 结论叙事体现该方法论 conclusionTemplate（结构模板确定性消费·非装饰）
    expect((b1 as { markdown: string }).markdown).toContain(capacity.methodology!.conclusionTemplate);
    expect((b1 as { markdown: string }).markdown).toContain("方法论口径");

    // 换 skill → 叙事随模板变化（防"挂名不消费"）
    const bRisk = skillMethodologyBlock([risk]);
    expect((bRisk as { markdown: string }).markdown).not.toEqual((b1 as { markdown: string }).markdown);
    expect((bRisk as { markdown: string }).markdown).toContain(risk.methodology!.conclusionTemplate);

    // 无绑定 → 不追加块（保持既有答案不变）
    expect(skillMethodologyBlock([])).toBeUndefined();
  });

  it("③ 每条方法论 skill 都带 methodology 结构模板（工作流确定性消费的结构承载）", () => {
    for (const s of skills.filter((x) => x.status === "PUBLISHED")) {
      expect(s.methodology, `skill ${s.id} 应带 methodology`).toBeTruthy();
      expect(s.methodology!.conclusionTemplate.trim().length).toBeGreaterThan(0);
      expect(s.methodology!.criteria.length).toBeGreaterThan(0);
    }
  });
});
