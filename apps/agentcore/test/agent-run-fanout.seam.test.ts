import { describe, expect, it } from "vitest";
import { AgentRunRecordSchema } from "@platform/contracts";
import { ADMIN, createTestApp, debugHeaders, PLANNER, submitQuery, TENANT, waitForTask, type TestApp } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { seedRegistry } from "../src/mocks/seed.js";

/**
 * WO-AGENTRUN-FANOUT-PERSIST · SEAM：**多角色会诊扇出的子 agent 运行真正落库**
 * （闭 `G-AGENTRUN-FANOUT-NOT-PERSISTED`；`AUDIT-agent-console-gap.md` §1.5.1 残余缺口③）。
 *
 * **接缝在哪（四段，任一段漏都必须红）**
 *   契约（`AgentRunRecord.origin/stepId`）
 *   × 引擎（`engine.runWorkflowSteps` 的 `runAgentStep` 补 `agentRuns.insert` —— 缺口原本就在这一行不存在）
 *   × 仓储（主键从 task 级改成 run 级 · `listByTask` 双实现 · `getByTask` 只返顶层）
 *   × 读端（`GET /b/v1/agents/:id/runs` 含扇出 · 新增 `GET /b/v1/queries/:taskId/agent-runs`）。
 *
 * **刻意不走的捷径**：全程**不** `repos.agentRuns.insert({...origin:"FANOUT"})` 造记录再读 ——
 * 那只证明「仓储改完键之后能存 N 条」，恰好把本单要验的那一段（引擎到底有没有把子运行交给仓储）跳过去。
 * 这里一律 **真 submitQuery → 真 planCoordination 拆三角 → 真 runCoordinator 扇出 →
 * 每个角色子 agent 真跑 runAgentLoop（真调工具）→ 真 insert → 真 HTTP 读回**。
 * 引擎少插一条、主键没改回 run 级、读端漏掉 FANOUT，都会在这里当场红。
 *
 * ⚠️ 唯一允许直接 `agentRuns.insert` 的地方是用例 ⑤ —— 它复刻的是**本单上线之前**写下的历史数据
 * （无 `origin` 字段），那种记录按定义就不可能由今天的引擎产出，只能手造。
 */

const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };

/** 三角会诊真实开火的问句（`DELIVERY_RISK_RE` 命中 → 供应链/生产/质量三角）。 */
const TRIAD_QUERY = "常州这批订单的交付风险怎么解";

/** 交付三角的三个角色 agent（seed 单一来源；`agentId → agentKey` 是读端聚合用的键）。 */
const TRIAD = [
  { agentId: "agt_supply_chain", agentKey: "supply_chain" },
  { agentId: "agt_capacity_planner", agentKey: "capacity_planner" },
  { agentId: "agt_quality_inspector", agentKey: "quality_inspector" },
] as const;

/** 把 seed 注册表 agents 灌入测试 repos（helpers 默认只种 package/intents/plans）。 */
async function seedAgents(t: TestApp): Promise<void> {
  for (const ag of seedRegistry().agents) {
    if (!(await t.repos.agents.get(ag.id))) await t.repos.agents.insert(ag);
  }
}

/**
 * 真跑一次三角会诊：分类器答不出（域外）→ Coordinator 开火 → 三个角色 agent 各自真跑一轮工具 + 收尾。
 * 每个角色**真调 `query_objects`**（各在自己 scope 内），故落库的 run 里必然有非空 iterations ——
 * 「有记录」与「记录是真的」在下面被分开断言。
 */
async function runTriadConsultation(t: TestApp, query = TRIAD_QUERY): Promise<string> {
  t.llm.queueClassification(OUT_OF_CATALOG);
  // 顺序 = AGENT_ROLE_ORDER（供应链 → 生产 → 质量），与 coordinator-a2a.test.ts 同一套脚本形态。
  t.llm.queueAgentTurn(
    () => ({ content: [text("查物料齐套。"), toolUse("query_objects", { objectType: "Material", filter: {} })] }),
    () => ({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "物料存在缺口：正极粉短缺。" }], provenance: [] })] }),
  );
  t.llm.queueAgentTurn(
    () => ({ content: [text("查产线产能。"), toolUse("query_objects", { objectType: "Line", filter: {} })] }),
    () => ({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "产能可承接，排程可覆盖。" }], provenance: [] })] }),
  );
  t.llm.queueAgentTurn(
    () => ({ content: [text("查工序良率。"), toolUse("query_objects", { objectType: "Process", filter: {} })] }),
    () => ({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "良率稳定达标。" }], provenance: [] })] }),
  );
  const { taskId } = await submitQuery(t, ADMIN, query, { view: "risk" });
  const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15000);
  // 前置自证：确实走了会诊路（否则下面的"扇出落库"断言在验一个根本没发生的事情）。
  expect(task.classification?.model).toBe("coordinator");
  return taskId;
}

/** 开 coordinator 暗发门 + 灌角色 agent 的标准起手式。 */
async function coordinatorApp(): Promise<TestApp> {
  const t = await createTestApp();
  t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]);
  await seedAgents(t);
  return t;
}

async function listAgentRuns(t: TestApp, agentId: string, user = ADMIN) {
  return t.app.inject({ method: "GET", url: `/b/v1/agents/${agentId}/runs`, headers: debugHeaders(user) });
}

async function listTaskRuns(t: TestApp, taskId: string, user = ADMIN) {
  return t.app.inject({ method: "GET", url: `/b/v1/queries/${taskId}/agent-runs`, headers: debugHeaders(user) });
}

describe("WO-AGENTRUN-FANOUT-PERSIST · 会诊扇出落库接缝", () => {
  it("① 头号判据：真会诊 → 三个角色子 agent 各自真跑 → 三条 run 真落库 → 每个 agent 按 key 读回自己那次", async () => {
    const t = await coordinatorApp();
    const taskId = await runTriadConsultation(t);

    // —— 库里：**同一个 taskId 下三条** run。旧主键（task 级）在这里物理上只存得下一条，
    //    所以这一句同时咬死了「引擎有没有插」和「主键改没改成 run 级」两件事。
    const persisted = await t.repos.agentRuns.listByTask(taskId);
    expect(persisted.length).toBe(3);
    expect(persisted.every((r) => r.origin === "FANOUT")).toBe(true);
    expect(new Set(persisted.map((r) => r.agentKey))).toEqual(new Set(TRIAD.map((x) => x.agentKey)));
    // 每条挂在自己那一步上（`dispatch_i`）——三条不是互相不认识的孤儿记录。
    expect(new Set(persisted.map((r) => r.stepId))).toEqual(new Set(["dispatch_0", "dispatch_1", "dispatch_2"]));
    // 归属与位置**正交**：会诊子运行既是 FANOUT，又确确实实解析了 AgentDefinition ⇒ REGISTERED。
    expect(persisted.every((r) => r.attribution === "REGISTERED")).toBe(true);
    expect(persisted.every((r) => r.tenantId === TENANT)).toBe(true);

    // —— HTTP 读端：**每个角色 agent 各自看到自己那一次**（这正是用户在管理台看到的数字）。
    for (const { agentId, agentKey } of TRIAD) {
      const res = await listAgentRuns(t, agentId);
      expect(res.statusCode, agentId).toBe(200);
      const body = res.json() as { agentKey: string; runs: unknown[] };
      expect(body.agentKey, agentId).toBe(agentKey);
      expect(body.runs.length, agentId).toBe(1);
      const run = AgentRunRecordSchema.parse(body.runs[0]);
      expect(run.taskId, agentId).toBe(taskId);
      expect(run.origin, agentId).toBe("FANOUT");
      // **记录是真的，不是空壳**：这个角色真调过工具、真有轮次。少了这一句，
      // 一个只写 id/taskId 的假 insert 也能让上面全绿。
      expect(run.iterations.length, agentId).toBeGreaterThan(0);
      expect(run.iterations.flatMap((i) => i.toolCalls).some((c) => c.toolName === "query_objects"), agentId).toBe(true);
    }

    await t.app.close();
  });

  it("② 次数就是次数：同一个角色 agent 参加两次会诊 → 它的运行数 = 2（一次一条，不互相覆盖）", async () => {
    const t = await coordinatorApp();
    const first = await runTriadConsultation(t);
    const second = await runTriadConsultation(t, "常州这批订单的交付风险到底怎么破");
    expect(second).not.toBe(first);

    // 两次会诊 = 两个 task，各三条子运行。
    expect((await t.repos.agentRuns.listByTask(first)).length).toBe(3);
    expect((await t.repos.agentRuns.listByTask(second)).length).toBe(3);

    // 供应链 agent 被叫去了两次 ⇒ 管理台就该显示 2。
    const res = await listAgentRuns(t, "agt_supply_chain");
    expect(res.statusCode).toBe(200);
    const runs = (res.json() as { runs: unknown[] }).runs.map((r) => AgentRunRecordSchema.parse(r));
    expect(runs.length).toBe(2);
    expect(new Set(runs.map((r) => r.taskId))).toEqual(new Set([first, second]));

    await t.app.close();
  });

  it("③ 向后兼容 · 单数读端语义一字不改：会诊任务上仍 404，绝不拿三条里的某一条冒充「本次运行」", async () => {
    const t = await coordinatorApp();
    const taskId = await runTriadConsultation(t);

    // 顶层压根没跑 agent 循环（runCoordinator 直接进 runWorkflowSteps 扇出）⇒ 没有 ROOT run。
    expect(await t.repos.agentRuns.getByTask(taskId)).toBeUndefined();
    const single = await t.app.inject({
      method: "GET",
      url: `/b/v1/queries/${taskId}/agent-run`,
      headers: debugHeaders(ADMIN),
    });
    expect(single.statusCode).toBe(404);
    expect((single.json() as { error: { code: string } }).error.code).toBe("AGENT_RUN_NOT_FOUND");

    // 而复数读端把这次会诊完整交出来（三条，全在同一个 task 下）。
    const plural = await listTaskRuns(t, taskId);
    expect(plural.statusCode).toBe(200);
    const body = plural.json() as { taskId: string; runs: unknown[] };
    expect(body.taskId).toBe(taskId);
    expect(body.runs.map((r) => AgentRunRecordSchema.parse(r)).length).toBe(3);

    await t.app.close();
  });

  it("④ 向后兼容 · 普通探索路不受影响：顶层那条仍是 ROOT，单数读端照旧读得到它", async () => {
    const t = await createTestApp({ env: { QOS_AGENT_MAX_ROUND_TRIPS: "2" } });
    t.llm.queueClassification(OUT_OF_CATALOG);
    for (let i = 0; i < 12; i++) {
      t.llm.queueAgentTurn({ content: [toolUse("query_objects", { objectType: "Order", filter: {} })] });
    }
    const { taskId } = await submitQuery(t, PLANNER, "把所有能查的都翻一遍并给我一个综合自由结论", { view: "dash" });
    await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15000);

    const root = await t.repos.agentRuns.getByTask(taskId);
    expect(root).toBeDefined();
    expect(root!.origin).toBe("ROOT");
    expect(root!.stepId).toBeUndefined(); // 不是被谁扇出来的
    expect(root!.attribution).toBe("EXPLORATORY"); // 位置与归属正交：ROOT 也可以没有归属对象

    const single = await t.app.inject({
      method: "GET",
      url: `/b/v1/queries/${taskId}/agent-run`,
      headers: debugHeaders(PLANNER),
    });
    expect(single.statusCode).toBe(200);
    expect(AgentRunRecordSchema.parse(single.json()).id).toBe(root!.id);

    await t.app.close();
  });

  it("⑤ 向后兼容 · 本单上线前的旧记录（无 origin 字段）仍读得出，绝不因为改键而消失", async () => {
    const t = await createTestApp();
    // 复刻旧数据：那时 agent_runs.task_id 是 UNIQUE，一个 task 只存得下一条，且没有 origin 字段。
    // 缺失 ≡ ROOT 在这里是**可证的**（旧约束保证它必是顶层那条），所以读端必须照旧把它返回来。
    await t.repos.agentRuns.insert({
      id: "run_legacy_fanout",
      taskId: "task_legacy_fanout",
      model: "m",
      iterations: [],
      budget: { maxIterations: 1, maxToolCalls: 1, maxSolverCalls: 1, maxDurationMs: 1, maxClarifications: 0, maxDiscoverCalls: 1, maxRoundTrips: 1 },
      budgetExhausted: false,
      totalInputTokens: 0,
      totalOutputTokens: 0,
    });

    const root = await t.repos.agentRuns.getByTask("task_legacy_fanout");
    expect(root).toBeDefined(); // ← `origin <> 'FANOUT'`（而非 IS DISTINCT FROM）会在这里把旧记录整批吞掉
    expect(root!.id).toBe("run_legacy_fanout");
    expect(root!.origin).toBeUndefined();
    expect((await t.repos.agentRuns.listByTask("task_legacy_fanout")).length).toBe(1);

    await t.app.close();
  });

  it("⑥ 租户隔离：别家租户的任务问运行清单一律 404（与「不存在」同码，不泄漏存在性）", async () => {
    const t = await coordinatorApp();
    const taskId = await runTriadConsultation(t);

    const cross = await listTaskRuns(t, taskId, "other-tenant:user-x:planner");
    expect(cross.statusCode).toBe(404);
    expect((cross.json() as { error: { code: string } }).error.code).toBe("TASK_NOT_FOUND");

    // 不存在的 task 同码同形（存在性不可探测）。
    const missing = await listTaskRuns(t, "task_does_not_exist");
    expect(missing.statusCode).toBe(404);
    expect((missing.json() as { error: { code: string } }).error.code).toBe("TASK_NOT_FOUND");

    await t.app.close();
  });

  it("⑦ 修的不是「会诊」这一条路：任何工作流里的 invoke_agent 子运行同样落库（证明补在 engine 是对的地方）", async () => {
    const t = await createTestApp();
    await seedAgents(t);
    // 一个与 Coordinator 毫无关系的普通工作流，只有一个 invoke_agent 步。
    await t.repos.workflows.insert({
      id: "wf_fanout_probe",
      tenantId: TENANT,
      key: "fanout_probe",
      version: 1,
      name: "扇出落库探针",
      inputs: { type: "object", properties: {} },
      steps: [
        {
          id: "ag",
          type: "invoke_agent",
          params: { agentId: "agt_supply_chain", version: "latest", prompt: "看一眼物料齐套" },
        },
      ],
      status: "PUBLISHED",
    });
    t.llm.queueAgentTurn(
      () => ({ content: [toolUse("query_objects", { objectType: "Material", filter: {} })] }),
      () => ({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "齐套正常。" }], provenance: [] })] }),
    );

    const res = await t.app.inject({
      method: "POST",
      url: "/b/v1/workflows/wf_fanout_probe/run",
      headers: debugHeaders(ADMIN),
      payload: { inputs: {} },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { status: string }).status).toBe("COMPLETED");

    // 这次运行归到供应链 agent 名下，且标 FANOUT + 它所在的步 id。
    const list = await listAgentRuns(t, "agt_supply_chain");
    expect(list.statusCode).toBe(200);
    const runs = (list.json() as { runs: unknown[] }).runs.map((r) => AgentRunRecordSchema.parse(r));
    expect(runs.length).toBe(1);
    expect(runs[0]!.origin).toBe("FANOUT");
    expect(runs[0]!.stepId).toBe("ag");
    expect(runs[0]!.iterations.flatMap((i) => i.toolCalls).some((c) => c.toolName === "query_objects")).toBe(true);

    await t.app.close();
  });
});
