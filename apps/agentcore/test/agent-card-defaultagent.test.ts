import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, ADMIN, debugHeaders, lastToolCallId, type TestApp } from "./helpers.js";
import { seedRegistry, seedSceneEntries } from "../src/mocks/seed.js";
import { materializeIntents } from "../src/intents/materialize.js";
import { intentModeFor } from "../src/intents/intent-mode.js";
import { SCENARIO_CATALOG } from "../src/scenarios-catalog.js";
import { text, toolUse } from "../src/llm/mock.js";

/**
 * AGENT-CARD-DEFAULTAGENT（P2·发育闭环真跑发现·2026-07-05 接 Kimi 真测）齿检。
 *
 * 现象（审核方真跑）：7 张 agent-first 卡（S03/S05/S12/S13/S14/S17/S19）grow 后长不成——
 * agent 模式无可执行的**绑定 defaultAgent** → A10 验证无 agent 出答案。
 *
 * 根因：一等 MaterializedIntent 是 agent-first 卡的 defaultAgent 绑定单一来源（materialize.ts
 * INTENT_AGENT → bindings.agentId；proceedWithIntent 尊重 MaterializedIntent.mode 委派该 agent，
 * 见 MODE-DISPATCH-HONOR）。但一等 Intent 此前只在 boot(main.ts) 为 demo 播种，grow/launch 走
 * ensureScenarios **不**补齐 → 未经 boot 的租户/懒触发路径下 grow 查无一等 Intent → 回落 Path A
 * 工作流（agent 绑定失效、假装 workflow-first）。修：ensureScenarios 随场景包幂等补齐一等 Intent，
 * 使 defaultAgent 绑定在**任何** grow 路径都在位。
 *
 * 牙齿（revert→red）：
 *  ① 结构：7 个 agent-first 意图各有 bindings.agentId（defaultAgent 绑定），且指向已播种 PUBLISHED 场景 agent；
 *  ② grow 自愈 + 路由：只种 agents+scenes（**不**预种一等 Intent），grow 7 卡 → 经绑定 agent 真跑
 *     （task.path=AGENT · agentRun.agentId=该卡绑定 agent）——回退「ensureScenarios 不补齐一等 Intent」或
 *     移除 INTENT_AGENT 绑定即回落 Path A（path=WORKFLOW / agentId≠期望）→ 红；
 *  ③ 诚实边界：无真 LLM 环境 agent 真跑但答案未达承载数据门 → maturity 非 GOVERNED（不假绿）；
 *  ④ 接 Kimi 即能 GOVERNED：喂 dataBearing 的 agent 答案（含 ⟦ref⟧）→ 经同一绑定 agent 出真答案 →
 *     VERIFIED（dataOk）——证结构就位，缺的只是真 LLM；
 *  ⑤ 零回归：workflow-first 卡（S02）即便 agents 已种仍照旧 Path A 工作流 GOVERNED。
 */

/** 7 张 agent-first 卡 → 期望绑定的场景 defaultAgent（materialize.ts INTENT_AGENT 单源）。 */
const AGENT_FIRST_CARDS: { sNo: string; intentKey: string; agentId: string }[] = [
  { sNo: "S03", intentKey: "risk_root_cause", agentId: "agt_risk" },
  { sNo: "S05", intentKey: "plan_recommend", agentId: "agt_plan_generate" },
  { sNo: "S12", intentKey: "yield_diag", agentId: "agt_risk" },
  { sNo: "S13", intentKey: "maint_stagger", agentId: "agt_risk" },
  { sNo: "S14", intentKey: "outsourcing_q", agentId: "agt_plan_generate" },
  { sNo: "S17", intentKey: "capex_review", agentId: "agt_plan_generate" },
  { sNo: "S19", intentKey: "quarterly_gap_q", agentId: "agt_quarterly" },
];

/** 真 boot 口径但**故意不**预种一等 Intent（验证 grow 经 ensureScenarios 自愈补齐）。 */
async function seedRuntimeNoMaterializedIntents(t: TestApp): Promise<void> {
  const { agents, workflows, skills } = seedRegistry();
  for (const s of skills) await t.repos.skills.insert(s);
  for (const w of workflows) await t.repos.workflows.insert(w);
  for (const ag of agents) await t.repos.agents.insert(ag);
  for (const scn of seedSceneEntries()) await t.repos.sceneEntries.upsert(scn);
  // NOTE: 不调 ensureMaterializedIntents —— grow 端点须自愈补齐（否则 agent 绑定失效回落 Path A）。
}

async function growAndInspect(t: TestApp, key: string) {
  const res = await t.app.inject({ method: "POST", url: `/b/v1/scenarios/${key}/grow`, headers: debugHeaders(ADMIN) });
  const run = res.json() as { verification: { status: string; path: string; gapCode: string | null; taskId: string | null }; maturity: string };
  const task = run.verification.taskId ? await t.repos.tasks.get(run.verification.taskId) : null;
  const agentRun = task ? await t.repos.agentRuns.getByTask(task.id) : null;
  return { statusCode: res.statusCode, run, task, agentRun };
}

describe("① 结构：7 张 agent-first 卡各有 defaultAgent 绑定（指向已播种 PUBLISHED 场景 agent）", () => {
  it("materializeIntents 为 7 卡绑定 bindings.agentId = 对口场景 agent", () => {
    const mints = materializeIntents("demo");
    const { agents } = seedRegistry();
    const published = new Map(agents.filter((a) => a.status === "PUBLISHED").map((a) => [a.id, a]));

    // 钉死表口径：正好这 7 张卡是 AGENT_FIRST（与 mode-dispatch-honor 同源）。
    const agentFirstKeys = SCENARIO_CATALOG.filter((c) => intentModeFor(c.intentKey) === "AGENT_FIRST").map((c) => c.intentKey).sort();
    expect(agentFirstKeys).toEqual(AGENT_FIRST_CARDS.map((c) => c.intentKey).sort());

    for (const { intentKey, agentId } of AGENT_FIRST_CARDS) {
      const mi = mints.find((m) => m.key === intentKey)!;
      expect(mi.mode).toBe("AGENT_FIRST");
      expect(mi.bindings.agentId, `${intentKey} 必须有 defaultAgent 绑定`).toBe(agentId);
      // 绑定的 agent 必须真实存在且已发布（非死绑定）。
      expect(published.has(agentId), `${agentId} 必须是已播种 PUBLISHED 场景 agent`).toBe(true);
      // 对口 skill 也在位（挂 solver/skill/rules 之 skill）。
      expect(mi.bindings.skillId).toBeTruthy();
      expect(mi.bindings.ruleKeys.length).toBeGreaterThan(0);
    }
  });
});

describe("② grow 自愈补齐一等 Intent + 经绑定 defaultAgent 真跑（revert→red 主齿）", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
    await seedRuntimeNoMaterializedIntents(t);
  });

  for (const { sNo, intentKey, agentId } of AGENT_FIRST_CARDS) {
    it(`${sNo}(${intentKey}) grow → path=AGENT · agentRun.agentId=${agentId} · 非 GOVERNED（无 LLM 诚实降级）`, async () => {
      const { statusCode, run, task, agentRun } = await growAndInspect(t, sNo);
      expect(statusCode).toBe(200);
      // 主齿：路由经**绑定 defaultAgent**（回退 self-heal / 移除 INTENT_AGENT → Path A → 红）。
      expect(task?.path).toBe("AGENT");
      expect(agentRun?.agentId).toBe(agentId);
      // 诚实边界：无真 LLM → agent 真跑但答案未达承载数据门 → 不冒充 GOVERNED（不假绿）。
      expect(run.maturity).not.toBe("GOVERNED");
    });
  }
});

describe("③ 接 Kimi 即能 GOVERNED：喂 dataBearing agent 答案 → 经绑定 agent 出真答案 → VERIFIED", () => {
  it("S12(yield_diag) 有含 ⟦ref⟧ 的 agent 答案 → dataOk/VERIFIED（结构就位，缺的只是真 LLM）", async () => {
    const t = await createTestApp();
    await seedRuntimeNoMaterializedIntents(t);
    // 经绑定 agent 真跑：先调工具取真值 → 终答带**真溯源**（provenance 指向该工具调用）→ 含 ⟦ref⟧
    // 的承载数据答案（VERIFIED 需真溯源，非裸 ⟦ref⟧；口径同 experience-writeback）。足量对覆盖 verify。
    for (let i = 0; i < 4; i++) {
      t.llm.queueAgentTurn(
        { content: [text("先查基地数据。"), toolUse("query_objects", { objectType: "Base", filter: {}, limit: 10 })] },
        (req) => ({ content: [toolUse("final_answer", {
          blocks: [{ type: "text", markdown: "涂布良率下降主因归因于设备 OEE 波动 ⟦ref:0⟧。" }],
          provenance: [{ toolCallId: lastToolCallId(req), outputPath: "$.data" }],
        })] }),
      );
    }
    const { statusCode, run, task, agentRun } = await growAndInspect(t, "S12");
    expect(statusCode).toBe(200);
    expect(task?.path).toBe("AGENT");
    expect(agentRun?.agentId).toBe("agt_risk"); // 同一绑定 defaultAgent
    // 经绑定 agent 出含承载数据（⟦ref⟧）的答案 → 验证通过（dataOk）。
    expect(run.verification.status).toBe("VERIFIED");
    const dataBearing = (task?.answer?.blocks ?? []).some(
      (b) => b.type === "kpi" || b.type === "table" || (b.type === "text" && /⟦ref:/.test(String((b as { markdown?: string }).markdown ?? ""))),
    );
    expect(dataBearing).toBe(true);
  });
});

describe("④ 零回归：workflow-first 卡即便 agents 已种仍照旧 Path A 工作流 GOVERNED", () => {
  it("S02(affected_orders·WORKFLOW_FIRST) grow → path=WORKFLOW · GOVERNED", async () => {
    const t = await createTestApp();
    await seedRuntimeNoMaterializedIntents(t);
    const { statusCode, run, task } = await growAndInspect(t, "S02");
    expect(statusCode).toBe(200);
    expect(task?.path).toBe("WORKFLOW");
    expect(run.maturity).toBe("GOVERNED");
  });
});
