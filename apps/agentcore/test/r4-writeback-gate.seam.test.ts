import { describe, expect, it } from "vitest";
import { isWriteModeSkill, type AgentDefinition, type SkillDefinition } from "@platform/contracts";
import { createTestApp, PLANNER, TENANT, submitQuery, waitForTask, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";
import { runAgentLoop } from "../src/agent/loop.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { checkedTree, factHits, readRepo, stripComments } from "./factlock.js";
import { seedRegistry } from "../src/mocks/seed.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { enterNesting } from "../src/runtime.js";

/**
 * WO-R4-FREEQA-GATE · SEAM：**同一个**写回型技能，两条 loadSkill 路径**都**必须被人工批复闸闸住。
 *
 * ── 病灶（判据落在「两条路径的参数集差集」，不是「有没有 approvalGate 字段」）─────────────
 * 本仓只有两处 `runAgentLoop({...})`：
 *   · 注册 agent 路 `engine.ts:437`      —— 传 `provenancePolicy`(:458) + `writeMode`(:459)
 *   · free-QA 路   `orchestrator.ts:2002` —— 这两个键**一个都没有**（修前 `grep -c writeMode` = 0）
 * 于是执行点 `loop.ts acceptFinalAnswer` 的 `if (opts.writeMode)` 在 free-QA 上恒收到 `undefined`
 * → falsy → 分支根本不进 → 一个 `approvalGate:"human"` 的写回型技能走那条路时，
 * **R4「真值写入经 Action 审批」的闸门完全不生效**。字段在、传不到 —— 这是实打实的不变量豁口。
 *
 * ── 本文件的断言纪律 ────────────────────────────────────────────────────────────
 * ① 断言一律落在**效果层**：「模型那次『直接宣布已改真值』的收尾有没有被打回」+「交付出去的答案
 *    到底是可审批草案还是既成事实」+「R4 交接事件有没有真的发」。
 *    只断言「参数传了 / 某函数会读 approvalGate」= 假绿第 9 形态（咬函数不咬链路），不算数。
 * ② 两条路径都走**真实入口**：对照组走 `engine.runRegisteredAgent`，被修组走
 *    `POST /api/v1/queries → runPipeline → runPathB`。不直接捅 `acceptFinalAnswer`。
 * ③ 技能用**出厂那一条**（`seedRegistry()` 的 `capacity_action_draft`），不是测试现编的对象——
 *    否则就是「生产实参与测试实参交集为空」那类假绿（CLAUDE.md 铁律 0.5 判据 6）。
 */

const CTX = { tenantId: TENANT, userId: "u", roles: ["planner"] };
const ON = [...defaultOnKeys(), "agent.skill-on-free-qa"];
const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };

/**
 * 落 path-B 的问句：沿用 #90 SEAM 已验证的那一句（`skill-free-qa-seam.test.ts`）。
 * 刻意**不用**产能类措辞——那会被 `parseCapacityWhatIf`/`compileSolverPlan` 接走成组合路径，
 * 全程不落 `runAgentLoop`，本单要验的那条线一步都走不到。
 */
const FREE_QA_QUERY = "给我个自由结论";

/** 闸门原文的指纹（`loop.ts acceptFinalAnswer` 写模式分支）。闸没响 ⇒ 这串在对话历史里根本不存在。 */
const GATE_MARK = "final_answer 必须包含 action_draft 块";
/** provenance 闸的指纹——用来**排除**另一个拒绝理由，把本用例钉死在「人工批复闸」上。 */
const PROVENANCE_GATE_MARK = "final_answer 必须包含 provenance";
/** 只在技能**正文**里出现的指纹（summary 里没有）：模型收到它 = 正文真下发了 = 闸门的前提成立。 */
const BODY_MARK = "把产能推演结论转成";
/** 模型试图「跳过审批、直接宣布真值已改」的那句话。它若出现在交付答案里 = 闸被绕过。 */
const WRITE_CLAIM = "已直接调整常州基地 4680-NCM 产线排程，真值已更新";

/** 出厂唯一的写回型技能：`sideEffect:"WRITE"` + `approvalGate:"human"` + `provenancePolicy:"required"`。 */
function gatedSkill(): SkillDefinition {
  const s = seedRegistry().skills.find((x) => x.key === "capacity_action_draft");
  if (!s) throw new Error("seed skill not found: capacity_action_draft");
  return s;
}

/** 出厂只读技能（`sideEffect:"READ"` + `approvalGate:"none"`）：负对照，证明闸门**认技能**不是「free-QA 一律拦」。 */
function readOnlySkill(): SkillDefinition {
  const s = seedRegistry().skills.find((x) => x.key === "capacity_analysis");
  if (!s) throw new Error("seed skill not found: capacity_analysis");
  return s;
}

async function mountAgentWithSkill(t: TestApp, skill: SkillDefinition): Promise<AgentDefinition> {
  const agent: AgentDefinition = {
    id: "agt_r4_gate",
    tenantId: TENANT,
    key: "r4_gate_agent",
    version: 1,
    name: "R4 Gate Agent",
    description: "test",
    model: "",
    systemPrompt: "你是测试助手。",
    tools: [],
    ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
    skills: [{ skillId: skill.id, version: skill.version }],
    mcpServers: [],
    scopeDeclaration: { objectTypes: [], toolNames: [] },
    status: "PUBLISHED",
  };
  await t.repos.agents.insert(agent);
  return agent;
}

/** 模型「跳过审批直接交卷」的那一轮（带 provenance ⇒ 唯一可能的拒绝理由只剩人工批复闸）。 */
const bypassAttempt = () => ({
  content: [
    toolUse("final_answer", {
      blocks: [{ type: "text", markdown: WRITE_CLAIM }],
      provenance: [{ toolCallId: "tc_001", outputPath: "$" }],
    }),
  ],
});

/** 模型改走审批链的那一轮：交可审批草案。 */
const compliantAttempt = () => ({
  content: [
    toolUse("final_answer", {
      blocks: [{ type: "action_draft", draftId: "d_r4", actionType: "adjust", summary: "加开 1 个班次（待审批）" }],
      provenance: [{ toolCallId: "tc_001", outputPath: "$" }],
    }),
  ],
});

/** 全部 agent 往返的对话历史（最后一轮请求即全量历史，顺序即发生顺序）。 */
function conversation(t: TestApp): string {
  const last = t.llm.agentRequests[t.llm.agentRequests.length - 1];
  return last ? JSON.stringify(last.messages) : "";
}

describe("WO-R4-FREEQA-GATE · 写回型技能的人工批复闸：两条路径同一把锁", () => {
  it("前提自证：出厂技能确实是写回型（approvalGate:human + sideEffect:WRITE + provenance:required）", () => {
    const s = gatedSkill();
    expect(s.approvalGate).toBe("human");
    expect(s.sideEffect).toBe("WRITE");
    expect(s.provenancePolicy).toBe("required");
    expect(isWriteModeSkill(s)).toBe(true);
    // 负对照那条必须**不是**写回型，否则下面「读技能不被闸」的用例是恒真的假绿。
    expect(isWriteModeSkill(readOnlySkill())).toBe(false);
    // 正文指纹只在 body 里、不在 summary 里（否则「正文真下发」的判据会被 system 段冒充）。
    expect(s.body).toContain(BODY_MARK);
    expect(s.summary).not.toContain(BODY_MARK);
  });

  it("【对照组·注册 agent 路】写回型技能挂在 agent 上 → 直接宣布真值已改的收尾被闸住，只能改交草案", async () => {
    const t = await createTestApp();
    const skill = gatedSkill();
    await t.repos.skills.insert(skill);
    const agent = await mountAgentWithSkill(t, skill);

    t.llm.queueAgentTurn(bypassAttempt);
    t.llm.queueAgentTurn(compliantAttempt);

    const result = await t.deps.engine.runRegisteredAgent({
      taskId: "task_r4_engine",
      agentId: agent.id,
      version: 1,
      prompt: "按这个方案生成行动计划",
      ctx: CTX,
      nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", agent.id),
      emit: async () => {},
    });

    const hist = conversation(t);
    // 效果层①：那次「跳过审批」的收尾被打回，闸门原文回到了模型手里。
    expect(hist).toContain(GATE_MARK);
    // 钉死拒绝理由：不是 provenance 闸误伤（那一轮带了 provenance）。
    expect(hist).not.toContain(PROVENANCE_GATE_MARK);
    // 效果层②：交付出去的是可审批草案，不是既成事实。
    expect(result.outcome).toBe("ANSWERED");
    expect(result.answer.blocks.some((b) => b.type === "action_draft")).toBe(true);
    expect(JSON.stringify(result.answer.blocks)).not.toContain(WRITE_CLAIM);
  });

  it("【被修组·free-QA 路】同一个技能经 load_skill 现取 → 同样被闸住，且草案真的进了审批链", async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, ON);
    const skill = gatedSkill();
    await t.repos.skills.insert(skill);

    t.llm.queueClassification(OUT_OF_CATALOG);
    // 第 1 轮：模型现取技能正文（free-QA 路没有 agent，技能只能这样进来）。
    t.llm.queueAgentTurn({ content: [toolUse("load_skill", { skillId: skill.id })] });
    // 第 2 轮：跳过审批直接交卷 —— 修前这一轮会被**原样接受**（豁口）。
    t.llm.queueAgentTurn(bypassAttempt);
    // 第 3 轮：改交可审批草案。
    t.llm.queueAgentTurn(compliantAttempt);

    const { taskId } = await submitQuery(t, PLANNER, FREE_QA_QUERY, { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15000);
    expect(task.path).toBe("AGENT"); // 前提自证：确实落了 path-B，不是被组合路径接走

    const hist = conversation(t);
    // 前提自证：技能**正文**真下发给了模型（闸门要闸的正是「拿到写回正文之后的收尾」）。
    expect(hist).toContain(BODY_MARK);

    // 🔴 本单核心（修前必红）：free-QA 路上那次「跳过审批」的收尾**也**被打回。
    expect(hist).toContain(GATE_MARK);
    expect(hist).not.toContain(PROVENANCE_GATE_MARK);

    // 效果层：交付的是草案，不是既成事实。
    expect(task.answer?.blocks.some((b) => b.type === "action_draft")).toBe(true);
    expect(JSON.stringify(task.answer?.blocks)).not.toContain(WRITE_CLAIM);

    // R4 交接：草案真的移交给了审批链（不是只在答案里画了个块）。
    const events = await t.repos.events.listAfter(taskId, 0);
    expect(events.some((e) => e.event === "action_draft.created")).toBe(true);
  });

  it("【负对照·free-QA 路】只读技能经同一条路现取 → 纯文本收尾照常放行（闸门认技能，不是「一律拦」）", async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, ON);
    const skill = readOnlySkill();
    await t.repos.skills.insert(skill);

    t.llm.queueClassification(OUT_OF_CATALOG);
    t.llm.queueAgentTurn({ content: [toolUse("load_skill", { skillId: skill.id })] });
    t.llm.queueAgentTurn({
      content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "口径解释如下。" }], provenance: [] })],
    });

    const { taskId } = await submitQuery(t, PLANNER, FREE_QA_QUERY, { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15000);

    // 闸门没响：既没要 action_draft，也没要 provenance（该技能 best_effort）。
    expect(conversation(t)).not.toContain(GATE_MARK);
    expect(conversation(t)).not.toContain(PROVENANCE_GATE_MARK);
    expect(task.answer?.blocks.some((b) => b.type === "text")).toBe(true);
    expect(t.llm.agentRequests.length).toBe(2); // 没有被打回重来
  });

  it("【负对照·free-QA 路】一个技能都没取 → 既有 path-B 行为不变（纯文本 + 零 provenance 照常收尾）", async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, ON);
    await t.repos.skills.insert(gatedSkill()); // 写回型技能就在租户池里，但模型这题没取它

    t.llm.queueClassification(OUT_OF_CATALOG);
    t.llm.queueAgentTurn({
      content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "随手一答。" }], provenance: [] })],
    });

    const { taskId } = await submitQuery(t, PLANNER, FREE_QA_QUERY, { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15000);

    // 关键：闸门按「谁的正文真下发」收紧，**不是**按租户已发布集静态聚合——
    // 否则租户里只要有一个写回技能，每一道自由问答都得交 action_draft，闸门就失去指向性。
    expect(conversation(t)).not.toContain(GATE_MARK);
    expect(task.answer?.blocks.some((b) => b.type === "text")).toBe(true);
    expect(t.llm.agentRequests.length).toBe(1);
  });

  it("【fail-closed 缺省】loadSkill 下发了正文却没回报治理位 → 按「需要批复」处理，不许默认放行", async () => {
    // 覆盖的是「将来出现第三个 loadSkill 调用方、又忘了回报治理位」这一形态。
    // 病史就是这么来的：free-QA 路当年也只是「忘了传」，而缺省值选的是放行 ⇒ 整道闸变装饰品。
    // 「没判定 ≠ 判定为好」——缺省必须站在闸门这一边，让忘记回报的人被**闸住**而不是被放行。
    const t = await createTestApp();
    const budget = new BudgetTracker();
    const executor = t.deps.engine.makeExecutor("task_failclosed", CTX, budget);

    t.llm.queueAgentTurn({ content: [toolUse("load_skill", { skillId: "skl_unreported" })] });
    t.llm.queueAgentTurn(bypassAttempt);
    t.llm.queueAgentTurn(compliantAttempt);

    const result = await runAgentLoop({
      taskId: "task_failclosed",
      model: "mock",
      tenantId: TENANT,
      system: "你是测试助手。",
      userContent: "把结论落地",
      tools: [],
      llm: t.llm,
      executor,
      budget,
      repos: t.repos,
      metrics: t.metrics,
      emit: async () => {},
      loadSkillEnabled: true,
      // ⚠️ 故意只给正文/资源 —— 不回报 writeMode / provenancePolicy。
      loadSkill: async () => ({ body: "写回型正文（但调用方忘了回报治理位）", resources: [] }),
    });

    expect(conversation(t)).toContain(GATE_MARK);
    expect(result.outcome).toBe("ANSWERED");
    expect(result.answer.blocks.some((b) => b.type === "action_draft")).toBe(true);
    expect(JSON.stringify(result.answer.blocks)).not.toContain(WRITE_CLAIM);
  });

  it("【防回潮】两条 loadSkill 路径必须回报同一份治理口径（差集为空）", () => {
    // 病根是**参数集差集**，不是某个字段缺失。这条门盯着差集本身：
    // 谁再往其中一条路加治理位而不加另一条，这里立刻红（机器先说话，不靠人想起来）。
    // 事实锚（WO-C 修法）：loadSkill 的两处实现**住在哪两个文件**不是事实 —— 全树定位
    // （搬家不红；将来出现第三条路径也会被纳入同一份对账，漏报治理位同样当场红）。
    const tree = checkedTree("apps/agentcore/src", "runRegisteredAgent", 100);
    const homes = factHits(tree, /loadSkill:\s*async\s*\(skillId:\s*string\)\s*=>/);
    expect(homes.length, "loadSkill 实现少于两处 ⇒ 双路径之一被删/改名，治理口径差集无人对账").toBeGreaterThanOrEqual(2);
    for (const home of homes) {
      const src = stripComments(readRepo(home));
      // 治理位回报的唯一构造器必须在每条路径上各出现至少一次（谁漏报/内联抄第二份口径，这里红）。
      // 必须 stripComments：注释里提一嘴 skillGovernance(skill) 不算「回报了治理位」。
      expect(
        src.match(/skillGovernance\(skill\)/g)?.length ?? 0,
        `${home} 的 loadSkill 没走 skillGovernance(skill) 单源构造器`,
      ).toBeGreaterThanOrEqual(1);
    }
  });
});
