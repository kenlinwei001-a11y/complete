import { describe, expect, it } from "vitest";
import { createTestApp, submitQuery, waitForTask, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { planCoordination, detectSingleRole, synthesize } from "../src/router/coordinator.js";
import { seedRegistry, roleProfile } from "../src/mocks/seed.js";

/**
 * WO-FIVE-ROLE-AI-EMPLOYEE P1 · SEAM（跨域 Coordinator 编排·**mock LLM 证接线非蒙**）。
 *
 * 头号判据（SEAM-P1·非单 agent 伪装多角色）：一个跨域问题「常州这批订单的交付风险怎么解」→
 *  ① planCoordination 确定性拆 ≥2 角色子问（供应链[物料齐套] + 生产[产能瓶颈] + 质量[良率]）；
 *  ② 经 invoke_agent **真调 ≥2 个不同角色 agent**（agt_supply_chain + agt_capacity_planner…·spy 记 agentId 列表·非一个 agent 换 prompt）；
 *  ③ 各角色 agent 用**自己 scopeDeclaration** 取证——供应链只能 query Material（Line 越界拒）、生产只能 query Line（Material 越界拒）·scope 真隔离；
 *  ④ 汇总真合并多角色（每角色一栏 + 综合结论）。
 *
 * 暗发默认关（C4）：feature 用**显式 Set**（含 agent.coordinator）触发；"ALL"（mock 默认）不触发 → 既有单 agent path-B 逐字节不变。
 */

/** 把 seed 注册表 agents 灌入测试 repos（helpers 默认只种 package/intents/plans）。 */
async function seedAgents(t: TestApp): Promise<void> {
  for (const ag of seedRegistry().agents) {
    if (!(await t.repos.agents.get(ag.id))) await t.repos.agents.insert(ag);
  }
}

/** 监视 engine.runRegisteredAgent → 记录真被调的 agentId 列表（证 ≥2 不同·非伪装）。 */
function spyInvokedAgents(t: TestApp): { ids: string[] } {
  const rec = { ids: [] as string[] };
  const orig = t.deps.engine.runRegisteredAgent.bind(t.deps.engine);
  t.deps.engine.runRegisteredAgent = async (opts) => {
    rec.ids.push(opts.agentId);
    return orig(opts);
  };
  return rec;
}

describe("WO-FIVE-ROLE P1 · 契约与确定性拆解（planCoordination·R6 无 LLM）", () => {
  it("跨域「交付风险」→ 拆 ≥2 角色子问（供应链+生产+质量三角）·单一来源角色画像绑 agentId", () => {
    const plan = planCoordination("常州这批订单的交付风险怎么解", undefined, []);
    expect(plan).toBeDefined();
    const roles = plan!.dispatches.map((d) => d.role);
    expect(roles).toContain("supply-chain");
    expect(roles).toContain("production");
    expect(roles).toContain("quality");
    // 每 dispatch 绑到 seed 角色 agent（真跨 agent·非同一 agent）。
    expect(plan!.dispatches.find((d) => d.role === "supply-chain")!.agentId).toBe("agt_supply_chain");
    expect(plan!.dispatches.find((d) => d.role === "production")!.agentId).toBe("agt_capacity_planner");
    // agentId 集合 ≥2 不同。
    expect(new Set(plan!.dispatches.map((d) => d.agentId)).size).toBeGreaterThanOrEqual(2);
  });

  it("单域问题（仅物料）→ undefined（不召集 Coordinator·不劫持）；detectSingleRole 命中该域", () => {
    expect(planCoordination("物料齐套现在怎么样", undefined, [])).toBeUndefined();
    expect(detectSingleRole("物料齐套现在怎么样")).toBe("supply-chain");
    expect(detectSingleRole("这条产线产能瓶颈在哪")).toBe("production");
    // 无域关键词 → 无单域（走通用 path-B）。
    expect(detectSingleRole("你好")).toBeUndefined();
  });

  it("角色画像单一来源 ROLE_PROFILES 五角色齐备（激活 CeoAgentProfile·向后兼容 ceo/base-planner）", () => {
    for (const r of ["ceo", "supply-chain", "production", "quality", "base-planner"]) {
      const p = roleProfile(r);
      expect(p, r).toBeDefined();
      expect(p!.agentId).toBeTruthy();
    }
    expect(roleProfile("supply-chain")!.objectTypes).toContain("Material");
    expect(roleProfile("production")!.objectTypes).toContain("Line");
  });

  it("synthesize 真合并多角色（每角色一栏 + 冲突/综合结论）", () => {
    const plan = planCoordination("交付风险怎么解", undefined, [])!;
    const ans = synthesize(plan, [
      { role: "supply-chain", agentId: "agt_supply_chain", subQuestion: "物料", answerText: "物料存在缺口，正极粉短缺。", scope: { allBases: true, baseIds: [] }, objectTypes: ["Material"] },
      { role: "production", agentId: "agt_capacity_planner", subQuestion: "产能", answerText: "产能可承接，无瓶颈。", scope: { allBases: true, baseIds: [] }, objectTypes: ["Line"] },
    ]);
    const md = ans.blocks.map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("供应链");
    expect(md).toContain("生产");
    expect(md).toContain("正极粉短缺"); // 供应链答真进汇总
    expect(md).toContain("产能可承接"); // 生产答真进汇总
    expect(md).toMatch(/存在分歧|一致判断|综合结论/); // 一致/冲突判定（三态之一）
  });
});

describe("WO-FIVE-ROLE P1 · SEAM 跨域真拆→invoke_agent 真调 ≥2 角色→scope 真隔离越界拒→汇总", () => {
  it("头号判据：常州交付风险 → 真调 supply_chain+capacity_planner 两不同 agent·各受自身 scope 约束·汇总合并", async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]); // 显式暗发开
    await seedAgents(t);
    const spy = spyInvokedAgents(t);

    // ★ WO-COORD-YIELD-AND-TERMINAL D1（门序变更·**断言本体不动，只改进入方式**）：
    //   Coordinator 已从 classify **之前**移到之后，降级为「分类器答不出」时的兜底。故本用例改为
    //   显式喂一份**域外**分类结果（= 分类器确实答不出这题）来合法进入 Coordinator——
    //   下面那些"真调 ≥2 角色 / scope 真隔离 / 汇总合并"的判据一个字没改，仍是本文件的头号判据。
    //   为什么不是删掉它：这些断言咬的是**扇出与隔离机制本身**（Coordinator 该做什么），
    //   不是"关键词命中即扇出"（Coordinator 何时该被叫来）——前者依然是对的，被改掉的只有后者。
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });

    // routed mock：三角顺序 supply-chain → production → quality（AGENT_ROLE_ORDER 固定序）。
    // 供应链 agent：query Material（其 scope 内·OK）→ query Line（越界·被拒）→ final_answer。
    t.llm.queueAgentTurn(
      () => ({ content: [text("查物料齐套。"), toolUse("query_objects", { objectType: "Material", filter: {} })] }),
      () => ({ content: [text("越权探生产线。"), toolUse("query_objects", { objectType: "Line", filter: {} })] }),
      () => ({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "物料存在缺口：正极粉短缺，齐套受阻。" }], provenance: [] })] }),
    );
    // 生产 agent：query Line（其 scope 内·OK）→ query Material（越界·被拒）→ final_answer。
    t.llm.queueAgentTurn(
      () => ({ content: [text("查产线产能。"), toolUse("query_objects", { objectType: "Line", filter: {} })] }),
      () => ({ content: [text("越权探物料。"), toolUse("query_objects", { objectType: "Material", filter: {} })] }),
      () => ({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "产能可承接，化成工序有瓶颈但排程可覆盖。" }], provenance: [] })] }),
    );
    // 质量 agent：query Process（其 scope 内·OK）→ final_answer。
    t.llm.queueAgentTurn(
      () => ({ content: [text("查工序良率。"), toolUse("query_objects", { objectType: "Process", filter: {} })] }),
      () => ({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "良率稳定达标，无异常波动。" }], provenance: [] })] }),
    );

    const { taskId } = await submitQuery(t, ADMIN, "常州这批订单的交付风险怎么解", { view: "risk" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    // ① path=AGENT·classification.model=coordinator（跨域编排·非单 agent/classifier 偶然）。
    expect(task.path).toBe("AGENT");
    expect(task.classification?.model).toBe("coordinator");

    // ② 真调 ≥2 个不同角色 agent（spy·非一个 agent 换 prompt 假装多角色）。
    expect(spy.ids).toContain("agt_supply_chain");
    expect(spy.ids).toContain("agt_capacity_planner");
    expect(new Set(spy.ids).size).toBeGreaterThanOrEqual(2);

    // ③ scope 真隔离越界拒：供应链 query Material=OK / query Line=DENIED；生产反之。
    const calls = await t.repos.toolCalls.listByTask(taskId);
    const qo = calls.filter((c) => c.toolName === "query_objects");
    const byType = (ot: string) => qo.filter((c) => (c.input as { objectType?: string }).objectType === ot);
    // Material：至少一次 OK（供应链）+ 至少一次 DENIED（生产越界）。
    const matOutcomes = byType("Material").map((c) => c.outcome);
    const lineOutcomes = byType("Line").map((c) => c.outcome);
    expect(matOutcomes).toContain("OK");
    expect(matOutcomes).toContain("DENIED"); // 生产越界读 Material 被拒
    expect(lineOutcomes).toContain("OK");
    expect(lineOutcomes).toContain("DENIED"); // 供应链越界读 Line 被拒

    // ④ 汇总真合并多角色（每角色一栏 + 各自答进汇总）。
    const md = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md).toContain("供应链");
    expect(md).toContain("生产");
    expect(md).toContain("正极粉短缺"); // 供应链 agent 答
    expect(md).toContain("产能可承接"); // 生产 agent 答
    expect(task.answer?.trustLevel).toBe("AGENT_EXPLORATORY"); // agent 输出·非 VERIFIED

    await t.app.close();
  });

  it("SEAM 有牙：改一角色 scope（供应链去掉 Material）→ 其 Material 取证被拒（scope 真约束·非装饰）", async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]);
    // 篡改供应链 agent scope：移除 Material → 它再读 Material 应被拒（证 scope 真进执行器·改 scope 取证范围变）。
    for (const ag of seedRegistry().agents) {
      const copy = ag.id === "agt_supply_chain"
        ? { ...ag, scopeDeclaration: { ...ag.scopeDeclaration, objectTypes: ["Supplier", "PurchaseOrder"] } }
        : ag;
      if (!(await t.repos.agents.get(copy.id))) await t.repos.agents.insert(copy);
    }
    // WO-COORD-YIELD-AND-TERMINAL D1：同上——经「分类器域外」合法进入 Coordinator（scope 断言本体不动）。
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn(
      () => ({ content: [text("查物料。"), toolUse("query_objects", { objectType: "Material", filter: {} })] }),
      () => ({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "无法取物料，scope 受限。" }], provenance: [] })] }),
    );
    t.llm.queueAgentTurn(
      () => ({ content: [text("查产线。"), toolUse("query_objects", { objectType: "Line", filter: {} })] }),
      () => ({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "产能正常。" }], provenance: [] })] }),
    );
    t.llm.queueAgentTurn(
      () => ({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "良率达标。" }], provenance: [] })] }),
    );

    const { taskId } = await submitQuery(t, ADMIN, "交付风险怎么解", { view: "risk" });
    await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    const calls = await t.repos.toolCalls.listByTask(taskId);
    const mat = calls.filter((c) => c.toolName === "query_objects" && (c.input as { objectType?: string }).objectType === "Material");
    // 改 scope 后：供应链读 Material 现全部 DENIED（无 OK）——scope 真约束（改一角色 scope→取证范围变）。
    expect(mat.length).toBeGreaterThan(0);
    expect(mat.every((c) => c.outcome === "DENIED")).toBe(true);
    await t.app.close();
  });
});

describe("WO-FIVE-ROLE P1 · C4 不劫持：feature 关（默认 ALL）→ 跨域问题走既有 path（Coordinator 不触发）", () => {
  it("默认 ALL + 跨域问句 → classification.model≠coordinator（暗发默认关·字节兼容）", async () => {
    const t = await createTestApp(); // 默认 ALL（coordinatorEnabled=false）
    await seedAgents(t);
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn(() => ({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "通用探索答复。" }], provenance: [] })] }));
    const { taskId } = await submitQuery(t, ADMIN, "常州这批订单的交付风险怎么解", { view: "risk" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.classification?.model).not.toBe("coordinator"); // 未开 → 不召集 Coordinator
    await t.app.close();
  });
});

describe("WO-FIVE-ROLE P1 · C2 path-B 按 role 选对应 agent（单域·非永远 universal）", () => {
  it("单域「物料齐套」问句 + coordinator 开 → 走供应链角色 agent（agent:role:supply-chain）", async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]);
    await seedAgents(t);
    const spy = spyInvokedAgents(t);
    // 无候选意图命中（触发 path-B）——物料齐套问句非既有意图，classifier 落 outOfCatalog → path-B → 角色选择。
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn(
      () => ({ content: [text("查物料。"), toolUse("query_objects", { objectType: "Material", filter: {} })] }),
      () => ({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "物料齐套分析完成。" }], provenance: [] })] }),
    );
    const { taskId } = await submitQuery(t, ADMIN, "帮我看看物料齐套现在到底怎么样", { view: "risk" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.classification?.model).toBe("agent:role:supply-chain"); // 按 role 选 agent·非通用
    expect(spy.ids).toContain("agt_supply_chain"); // 真调供应链 agent
    await t.app.close();
  });
});
