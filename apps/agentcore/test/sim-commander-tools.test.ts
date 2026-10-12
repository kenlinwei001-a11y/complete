import { describe, expect, it } from "vitest";
import { createTestApp, PLANNER, submitQuery, waitForTask, TENANT, type TestApp } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";
import { createMemoryRepos } from "../src/persistence/memory.js";
import { createMockDataCore } from "../src/mocks/clients.js";
import { Metrics } from "../src/metrics.js";
import { GuardedToolExecutor } from "../src/tools/executor.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { BUILTIN_TOOLS, SIM_COMMANDER_TOOLS } from "../src/tools/registry.js";
import { defaultOnKeys } from "../src/features/registry.js";

/**
 * 增量4 §5 · AI 推演指挥台接 sim.* 工具：让 path B agent 把沙盘当工具驱动
 * （NL「开个沙盘，tick 3 次看风险」→ agent 调 sim_init/sim_tick/sim_world/sim_certify）。
 * - OBO：sim 工具经执行器透传用户 JWT 调 DataCore /a/v1/sim/*。
 * - entitlement：仅租户开通 sim.commander(+sim.sandbox) 时对 agent 可见/可用（关→工具不存在，R3 暗发）。
 * - R4：sim tick/act 模拟态不写真值（DataCore 保证）；回执只含会话态元信息，不绕审批。
 */

const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };

function execFor(dataCore = createMockDataCore()) {
  return {
    dataCore,
    exec: new GuardedToolExecutor(
      { dataCore, repos: createMemoryRepos(), metrics: new Metrics() },
      { taskId: "t_sim", ctx: { tenantId: TENANT, userId: "admin", roles: ["admin"] }, budget: new BudgetTracker() },
    ),
  };
}

describe("增量4 §5 · sim 指挥台工具注册与契约", () => {
  it("四工具已注册进内置目录，sideEffect 正确（init/tick=COMPUTE，world/certify=READ）", () => {
    const expected: Record<string, "READ" | "COMPUTE"> = {
      sim_init: "COMPUTE",
      sim_tick: "COMPUTE",
      sim_world: "READ",
      sim_certify: "READ",
    };
    for (const name of SIM_COMMANDER_TOOLS) {
      const def = BUILTIN_TOOLS.find((t) => t.name === name);
      expect(def, name).toBeTruthy();
      expect(def!.sideEffect, name).toBe(expected[name]);
      // R4 诚实标注：描述里明确"模拟态不写真值"
      expect(def!.descriptionForLLM, name).toMatch(/模拟态|不写真值/);
    }
  });
});

describe("增量4 §5 · sim 工具 OBO 打到 DataCore /a/v1/sim/* + 回执只含会话态元信息", () => {
  it("sim_init → sim_tick → sim_world → sim_certify 经执行器 OBO 透传，会话态连贯", async () => {
    const { dataCore, exec } = execFor();
    // 监视 OBO 出口被调用（断言确实打到 DataCore sim 端点）
    const hits: string[] = [];
    const origInit = dataCore.sim.init.bind(dataCore.sim);
    const origTick = dataCore.sim.tick.bind(dataCore.sim);
    const origWorld = dataCore.sim.world.bind(dataCore.sim);
    const origCertify = dataCore.sim.certify.bind(dataCore.sim);
    dataCore.sim.init = async (ctx, req) => { hits.push("init"); return origInit(ctx, req); };
    dataCore.sim.tick = async (ctx, id, n) => { hits.push(`tick:${n}`); return origTick(ctx, id, n); };
    dataCore.sim.world = async (ctx, id) => { hits.push("world"); return origWorld(ctx, id); };
    dataCore.sim.certify = async (ctx, id, s, t) => { hits.push("certify"); return origCertify(ctx, id, s, t); };

    const init = await exec.run("sim_init", { baseSnapshot: { base_cz: { util: 0.7 } }, scope: { base: "常州" } });
    expect(init.ok).toBe(true);
    const sid = (init.payload as { id: string; status: string; curTick: number }).id;
    expect(sid).toBeTruthy();
    expect((init.payload as { status: string }).status).toBe("READY"); // baseSnapshot 非空 → READY
    // 回执只含会话态元信息（不含真值写出口字段如 draftId）
    expect(init.payload).not.toHaveProperty("draftId");

    const tick = await exec.run("sim_tick", { sessionId: sid, n: 3 });
    expect(tick.ok).toBe(true);
    expect((tick.payload as { curTick: number }).curTick).toBe(3); // 推进 3 个 tick
    expect((tick.payload as { _note?: string })._note).toMatch(/模拟态|不写真值/);

    const world = await exec.run("sim_world", { sessionId: sid });
    expect(world.ok).toBe(true);
    expect((world.payload as { tick: number }).tick).toBe(3); // 与 tick 后状态一致

    const cert = await exec.run("sim_certify", { sessionId: sid, scope: "GLOBAL" });
    expect(cert.ok).toBe(true);
    expect((cert.payload as { scope: string; level: string }).scope).toBe("GLOBAL");

    // 确认 OBO 四端点都被打到
    expect(hits).toEqual(["init", "tick:3", "world", "certify"]);
  });

  it("未知 sessionId → 工具回 ERROR（R2 租户隔离 404 语义），不静默成功", async () => {
    const { exec } = execFor();
    const r = await exec.run("sim_tick", { sessionId: "sims_nope", n: 1 });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe("ERROR");
  });
});

describe("增量4 §5 · entitlement 暗发：sim.commander 关 → 工具对 agent 不存在（R3）", () => {
  // 全开（含 sim.commander/sim.sandbox）→ sim 工具对 path B agent 可见且可被驱动
  it("sim.commander+sim.sandbox 开 → mock LLM 一次 sim_init 工具调用打到 DataCore", async () => {
    const t: TestApp = await createTestApp();
    // 显式开通 sim.commander + sim.sandbox（其余默认开）
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "sim.commander", "sim.sandbox"]);

    let simInitArgs: unknown;
    const orig = t.dataCore.sim.init.bind(t.dataCore.sim);
    t.dataCore.sim.init = async (ctx, req) => { simInitArgs = req; return orig(ctx, req); };

    t.llm.queueClassification(OUT_OF_CATALOG);
    t.llm.queueAgentTurn(
      { content: [text("开个沙盘推演。"), toolUse("sim_init", { scope: { view: "risk" } })] },
      (req) => ({
        content: [
          toolUse("final_answer", {
            blocks: [{ type: "text", markdown: "已开沙盘会话（模拟态）。" }],
            provenance: [{ toolCallId: lastSimToolCallId(req), outputPath: "$.id" }],
          }),
        ],
      }),
    );

    const { taskId } = await submitQuery(t, PLANNER, "开个沙盘，tick 几次看风险", { view: "risk" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.path).toBe("AGENT");

    // sim 工具对 agent 可见（出现在喂给 LLM 的 tools 列表里）
    const toolNames = (t.llm.agentRequests[0]?.tools ?? []).map((x) => x.name);
    for (const n of SIM_COMMANDER_TOOLS) expect(toolNames, `${n} 应对 agent 可见`).toContain(n);
    // sim_init OBO 真打到 DataCore（透传 args）
    expect(simInitArgs).toBeTruthy();
  });

  it("sim.commander 关 → sim 工具完全不在 agent 工具列表（暗发，工具不存在）", async () => {
    const t: TestApp = await createTestApp();
    // 开 qos.agent-fallback 等默认项，但显式不含 sim.commander/sim.sandbox
    t.deps.features.mock.set(TENANT, defaultOnKeys().filter((k) => k !== "sim.commander" && k !== "sim.sandbox"));

    t.llm.queueClassification(OUT_OF_CATALOG);
    t.llm.queueAgentTurn((req) => ({
      content: [
        toolUse("final_answer", {
          blocks: [{ type: "text", markdown: "无沙盘能力。" }],
          provenance: [],
        }),
      ],
      // 无前置工具调用，直接收尾
      _req: req,
    }) as never);

    const { taskId } = await submitQuery(t, PLANNER, "开个沙盘看看", { view: "risk" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.path).toBe("AGENT");

    const toolNames = (t.llm.agentRequests[0]?.tools ?? []).map((x) => x.name);
    for (const n of SIM_COMMANDER_TOOLS) expect(toolNames, `${n} 关→不存在`).not.toContain(n);
  });
});

/** 从 agent 请求 messages 里取最近一次 sim 工具的 tool_use id（供 final_answer provenance 锚点）。 */
function lastSimToolCallId(req: { messages: { content: unknown }[] }): string {
  const text = JSON.stringify(req.messages);
  const matches = [...text.matchAll(/"id":"(toolu_[A-Za-z0-9_]+)"/g)];
  return matches.length ? (matches[matches.length - 1] as RegExpMatchArray)[1]! : "toolu_mock_1";
}
