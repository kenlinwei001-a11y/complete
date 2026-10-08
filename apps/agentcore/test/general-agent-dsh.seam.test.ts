import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentDefinition } from "@platform/contracts";
import { createTestApp, debugHeaders, PLANNER, submitQuery, TENANT, waitForTask, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";
import {
  GENERAL_AGENT_ID,
  GENERAL_AGENT_KEY,
  seedMcpConfigs,
  seedRegistry,
} from "../src/mocks/seed.js";
import { BUILTIN_TOOLS } from "../src/tools/registry.js";
import { ONTOLOGY_MCP_TOOL_NAMES } from "../src/tools/ontology-mcp.js";
import { detectSingleRole } from "../src/router/coordinator.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { STUB_DCP_SPEC, STUB_FAKE_KEY, startStubOpenAi, stubDirectory, stubProvider } from "./helpers-dsh-stub.js";

/**
 * WO-GENERAL-AGENT-DSH · SEAM：**探索路的落点**换成出厂通用 agent。
 *
 * 接缝在哪（四段，任一段漏都必须红）：
 *   种子（`seedRegistry` 的通用 agent：全部对象域 + 全部工具/技能，目录现算）
 *   × 路由（`runPathB` 无角色关键词 ⇒ 落点换成 `engine.runRegisteredAgent` 既有分叉）
 *   × 引擎（`agent.kernel` 配置面 ⇒ DSH 内核；`allObjectTypes`/`allTools` ⇒ 目录现算）
 *   × 读端（`GET /b/v1/agents/:id/runs`）。
 *
 * **诚实位（本单改动的关键后果）**：这条 run 的归属从 `EXPLORATORY`（无归属）翻成
 * `REGISTERED`（通用 agent 自己）——本 run 真的解析并执行了一版 AgentDefinition。
 * 旧语义（"确知没有 Agent 定义"）在**通用 agent 不在场**时仍然成立，见 ② -b 臂。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const HARNESS_DIR = join(ROOT, "packages/dsh-harness");
const ENV_KEYS = ["DSH_HARNESS", "DSH_HARNESS_DIR", "MOCK_SCENARIO"] as const;
const SEAM_TIMEOUT = 60_000;

/** 无角色关键词的开放问句（WO 判据 ① 的原句）。 */
const OPEN_QUERY = "把所有能查的都翻一遍并给我一个综合自由结论";
const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };
const FINAL_ANSWER = {
  toolCall: {
    name: "final_answer",
    arguments: JSON.stringify({ blocks: [{ type: "text", markdown: "通用 agent 综合结论。" }], provenance: [] }),
  },
  usage: { prompt_tokens: 60, completion_tokens: 12, total_tokens: 72 },
};
const PLAIN = { text: "stub", usage: { prompt_tokens: 60, completion_tokens: 12, total_tokens: 72 } };

async function seedMcp(t: TestApp): Promise<void> {
  for (const c of seedMcpConfigs()) {
    if (!(await t.repos.mcpConfigs.get(c.id))) await t.repos.mcpConfigs.insert(c);
  }
}

/** 通信用的 stub provider 目录（DSH 臂经 `resolveConnectionFacts` 解析 provider/model）。 */
function stubOpts(url: string) {
  return {
    providerDirectory: stubDirectory(stubProvider(url), STUB_FAKE_KEY) as never,
    env: { DSH_HARNESS_CORDIS_FILE: "cordis.poc.yml" },
  };
}

/** 出厂通用 agent。`model` 在本测试里指向 stub provider 的 dcp spec（出厂值为空 = 继承绑定矩阵）。 */
function generalFromSeed(): AgentDefinition {
  const g = seedRegistry().agents.find((a) => a.id === GENERAL_AGENT_ID);
  if (!g) throw new Error("seedRegistry 里没有通用 agent —— 种子没接上，本文件其余断言全部无意义");
  return g;
}

async function seedGeneral(t: TestApp, overrides: Partial<AgentDefinition> = {}): Promise<AgentDefinition> {
  await seedMcp(t);
  const g: AgentDefinition = { ...generalFromSeed(), model: STUB_DCP_SPEC, ...overrides };
  await t.repos.agents.insert(g);
  return g;
}

describe("WO-GENERAL-AGENT-DSH · 探索路落点 = 通用 agent（DSH 内核）", () => {
  let savedEnv: Record<string, string | undefined>;
  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    delete process.env.DSH_HARNESS; // 部署面 flag 全程休眠：内核只能来自 agent 配置
    process.env.DSH_HARNESS_DIR = HARNESS_DIR;
    delete process.env.MOCK_SCENARIO;
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it("① 无角色关键词 ⇒ agentKey=通用 agent · kernel=EXTERNAL · 归属 REGISTERED", { timeout: SEAM_TIMEOUT }, async () => {
    const stub = await startStubOpenAi([FINAL_ANSWER, PLAIN]);
    try {
      const t = await createTestApp(stubOpts(stub.url));
      const g = await seedGeneral(t);
      // 出厂态：模型留空（继承绑定矩阵，⛔ 不写死）——本测试把它换成 stub dcp spec 才跑得动。
      expect(generalFromSeed().model).toBe("");
      expect(process.env.DSH_HARNESS).toBeUndefined();

      t.llm.queueClassification(OUT_OF_CATALOG);
      const { taskId } = await submitQuery(t, PLANNER, OPEN_QUERY, { view: "dash" });
      const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 30_000);
      expect(task.path).toBe("AGENT");

      const run = await t.repos.agentRuns.getByTask(taskId);
      expect(run, "通用 agent 落点必须留下 run 记录").toBeDefined();
      // —— 判据 ① 三个字段（原始 JSON 见下）——
      expect(run!.agentKey).toBe(GENERAL_AGENT_KEY);
      expect(run!.agentId).toBe(GENERAL_AGENT_ID);
      expect(run!.kernel).toBe("EXTERNAL");
      expect(run!.attribution).toBe("REGISTERED");

      // 读端：这条 run 挂在通用 agent 名下（而**不再**是"谁都不挂"的 EXPLORATORY）
      const res = await t.app.inject({ method: "GET", url: `/b/v1/agents/${GENERAL_AGENT_ID}/runs`, headers: debugHeaders(PLANNER) });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { runs: unknown[] }).runs.length).toBe(1);

      // eslint-disable-next-line no-console
      console.log(`[WO-GENERAL-AGENT-DSH ①] run=${JSON.stringify({
        agentId: run!.agentId, agentKey: run!.agentKey, agentVersion: run!.agentVersion,
        attribution: run!.attribution, kernel: run!.kernel, origin: run!.origin, tenantId: run!.tenantId,
      })}`);
    } finally {
      await stub.close();
    }
  });

  it("②-a 对照：把该 agent 的 kernel 设回 NATIVE ⇒ 同问句落原生内核（证明是配置起的作用）", { timeout: SEAM_TIMEOUT }, async () => {
    const stub = await startStubOpenAi([FINAL_ANSWER, PLAIN], { jsonWhenNotStreaming: true });
    try {
      const t = await createTestApp(stubOpts(stub.url));
      await seedGeneral(t, { kernel: "NATIVE" });
      t.llm.queueClassification(OUT_OF_CATALOG);
      // 原生臂吃 mock 剧本（ScriptedLlmClient），DSH 臂吃 stub —— 两条都排上，谁被走到都不会因缺剧本而红。
      t.llm.queueAgentTurn({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "原生答复。" }], provenance: [] })] });
      t.llm.queueAgentTurn({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "原生答复。" }], provenance: [] })] });

      const { taskId } = await submitQuery(t, PLANNER, OPEN_QUERY, { view: "dash" });
      await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 30_000);
      const run = await t.repos.agentRuns.getByTask(taskId);
      expect(run!.kernel).toBe("NATIVE");
      expect(run!.agentKey).toBe(GENERAL_AGENT_KEY); // 落点不变，只有内核跟着配置变
      // eslint-disable-next-line no-console
      console.log(`[WO-GENERAL-AGENT-DSH ②-a] run=${JSON.stringify({ agentKey: run!.agentKey, kernel: run!.kernel, attribution: run!.attribution })}`);
    } finally {
      await stub.close();
    }
  });

  it("②-b 对照：通用 agent 不在场 ⇒ 逐字节落回旧探索路（EXPLORATORY + NATIVE）", async () => {
    const t = await createTestApp();
    // ⛔ 不播通用 agent、不播 MCP 配置 —— 与改造前的测试环境完全一致。
    t.llm.queueClassification(OUT_OF_CATALOG);
    for (let i = 0; i < 4; i++) {
      t.llm.queueAgentTurn({ content: [toolUse("query_objects", { objectType: "Order", filter: {} })] });
    }
    t.llm.queueAgentTurn({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "探索结论。" }], provenance: [] })] });
    const { taskId } = await submitQuery(t, PLANNER, OPEN_QUERY, { view: "dash" });
    await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15_000);

    const run = await t.repos.agentRuns.getByTask(taskId);
    expect(run!.attribution).toBe("EXPLORATORY"); // 旧诚实位：确知没有 Agent 定义
    expect(run!.agentId).toBeUndefined();
    expect(run!.agentKey).toBeUndefined();
    expect(run!.kernel).toBe("NATIVE");
    // eslint-disable-next-line no-console
    console.log(`[WO-GENERAL-AGENT-DSH ②-b] run=${JSON.stringify({ attribution: run!.attribution, kernel: run!.kernel, agentId: run!.agentId ?? null })}`);
  });

  it("③ 目录驱动自证：工具清单 / 对象类型清单都是目录现算（贴三个数 + 差集解释）", async () => {
    const t = await createTestApp();
    await seedMcp(t);
    const g = await seedGeneral(t);
    // 工作流目录也是「租户数据目录」的一支：把出厂工作流播上，否则这一支恒空、量不到东西。
    for (const wf of seedRegistry().workflows) await t.repos.workflows.insert(wf);
    const ctx = { tenantId: TENANT, userId: "user-planner", roles: ["planner"] };

    // ── 工具面：三张目录 + 内置注册表 ────────────────────────────────────────
    const expanded = await t.deps.engine.expandAgentTools(g, ctx);
    const solverItems = await t.dataCore.catalog.solverRegistry(ctx);
    const wfCatalog = await t.repos.workflows.listByTenant(TENANT);
    const wfPublished = wfCatalog.filter((w) => w.status === "PUBLISHED");
    // 目录 = 内置注册表（**扣掉走 MCP 面的两件切片，避免重复计数**）+ 本体 MCP + 求解器 MCP + 已发布工作流 MCP
    const catalogTools = {
      builtinFace: BUILTIN_TOOLS.length - ONTOLOGY_MCP_TOOL_NAMES.length,
      ontologyMcp: ONTOLOGY_MCP_TOOL_NAMES.length,
      solvers: solverItems.items.length,
      workflowsPublished: wfPublished.length,
    };
    const catalogTotal = catalogTools.builtinFace + catalogTools.ontologyMcp + catalogTools.solvers + catalogTools.workflowsPublished;
    const diff = catalogTotal - expanded.length;
    // eslint-disable-next-line no-console
    console.log(
      `[WO-GENERAL-AGENT-DSH ③·tools] 目录=${JSON.stringify(catalogTools)} 合计=${catalogTotal} agent清单=${expanded.length} 差集=${diff}` +
        ` ｜未进清单的目录项=${wfCatalog.length - wfPublished.length}（DRAFT 工作流：未发布定义不是可调用工具）`,
    );
    expect(diff).toBe(0);

    // 反向金丝雀：同一把量具量**另一个** agent 必须量得出「窄」——否则上面那个"相等"不度量任何东西。
    const narrow = expanded.filter((x) => x.name === "mcp__solvers__gap_attribution");
    expect(narrow.length).toBe(1); // 量具看得见具体条目（不是恒真比较）

    // ── 对象域：目录现算 vs 声明面 ───────────────────────────────────────────
    const typeKeys = await t.dataCore.ontology.listObjectTypeKeys(ctx);
    expect(g.scopeDeclaration.allObjectTypes).toBe(true);
    expect(g.scopeDeclaration.objectTypes).toEqual([]); // 声明面留空：全量的判据是字段不是空底
    // eslint-disable-next-line no-console
    console.log(`[WO-GENERAL-AGENT-DSH ③·objectTypes] 目录=${typeKeys.length} agent声明=${g.scopeDeclaration.objectTypes.length} 差集=${typeKeys.length - g.scopeDeclaration.objectTypes.length}`);
    expect(typeKeys.length).toBeGreaterThan(0); // 金丝雀：目录非空，否则"差集=N"毫无意义
  });

  it("③-b 对象域「目录现算」真生效：读**声明面之外**的类型不被 scope 门拒（对照臂必须 DENIED）", async () => {
    const t = await createTestApp();
    const ctx = { tenantId: TENANT, userId: "user-planner", roles: ["planner"] };
    await seedGeneral(t, { kernel: "NATIVE" });
    // 金丝雀：探针读的那个类型必须真的在**目录**里（否则"没被拒"可能只是因为压根没这个类型）。
    const typeKeys = await t.dataCore.ontology.listObjectTypeKeys(ctx);
    const probeType = typeKeys.includes("Material") ? "Material" : typeKeys[0]!;
    expect(probeType).toBeTruthy();

    /** engine 级真跑一次（native 内核），读一个对象类型，返回该次工具调用的审计输出。 */
    const readOnce = async (agentId: string, taskId: string, type = probeType): Promise<string> => {
      t.llm.queueAgentTurn({ content: [toolUse("query_objects", { objectType: type, filter: {} })] });
      t.llm.queueAgentTurn({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "读毕。" }], provenance: [] })] });
      await t.deps.engine.runRegisteredAgent({
        taskId,
        agentId,
        version: "latest",
        prompt: `读一下 ${probeType}`,
        ctx,
        nesting: { callChain: [], budget: new BudgetTracker({}) },
        emit: async () => {},
        enforceObjectScope: true, // 角色/扇出路的真实形态：对象域门开着
      });
      const calls = await t.repos.toolCalls.listByTask(taskId);
      return JSON.stringify(calls.find((c) => c.toolName === "query_objects")?.output ?? {});
    };

    // 臂 A：通用 agent（声明面为空 + allObjectTypes）⇒ 目录里的类型应当**读得到**。
    const a = await readOnce(GENERAL_AGENT_ID, "task_scope_general");
    // 臂 B（对照）：声明面窄的既有 agent 读**不在其声明面**的类型 ⇒ 必须被门拒。
    const explore = seedRegistry().agents.find((x) => x.id === "agt_seed_explore")!;
    expect(explore.scopeDeclaration.objectTypes).not.toContain(probeType);
    await t.repos.agents.insert(explore);
    const b = await readOnce("agt_seed_explore", "task_scope_control");
    // 臂 C：拿一个**目录里也没有**的类型名 ⇒ 通用 agent 的门必须报出它真正放行的名单
    //（DENY payload 的 `allowed` 就是**运行期有效对象域**的原文读数 —— 判据 ③ 的"清单条数"由它给出）。
    const c = await readOnce(GENERAL_AGENT_ID, "task_scope_general_bogus", "NoSuchType_Probe");

    // eslint-disable-next-line no-console
    console.log(`[WO-GENERAL-AGENT-DSH ③-b] 通用 agent 读 ${probeType} ⇒ ${a.slice(0, 200)}`);
    // eslint-disable-next-line no-console
    console.log(`[WO-GENERAL-AGENT-DSH ③-b·对照] agt_seed_explore 读 ${probeType} ⇒ ${b.slice(0, 200)}`);
    // eslint-disable-next-line no-console
    console.log(`[WO-GENERAL-AGENT-DSH ③-b·有效域] 通用 agent 读目录外类型 ⇒ ${c.slice(0, 400)}`);
    expect(a).not.toContain("AGENT_SCOPE_VIOLATION");
    expect(b).toContain("AGENT_SCOPE_VIOLATION"); // 量具有鉴别力：同一探针对窄 scope 的 agent 报得出拒
    // 有效对象域 = 目录全集（逐条来自 catalog，不是手抄）：目录 14 条 ⇔ allowed 14 条。
    const allowed = (JSON.parse(c) as { allowed?: string[] }).allowed ?? [];
    expect([...allowed].sort()).toEqual([...typeKeys].sort());
  });

  it("⑤ 真有角色关键词的问句不受影响：仍落到角色 agent（agent.coordinator 开时）", { timeout: SEAM_TIMEOUT }, async () => {
    const t = await createTestApp();
    // 角色分派门是暗发件（缺省关）—— 本臂显式点亮，测的是**角色分支本身没被本单改动**。
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]);
    for (const ag of seedRegistry().agents) {
      if (!(await t.repos.agents.get(ag.id))) await t.repos.agents.insert(ag);
    }
    await seedGeneral(t);

    const roleQuery = "常州基地的物料齐套情况如何";
    // 金丝雀：这个问句真的唯一命中一个角色域（否则本臂测的不是角色分支）。
    expect(detectSingleRole(roleQuery)).toBe("supply-chain");

    t.llm.queueClassification(OUT_OF_CATALOG);
    t.llm.queueAgentTurn({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "供应角色答复。" }], provenance: [] })] });
    t.llm.queueAgentTurn({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "供应角色答复。" }], provenance: [] })] });
    const { taskId } = await submitQuery(t, PLANNER, roleQuery, { view: "risk" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15_000);
    const run = await t.repos.agentRuns.getByTask(taskId);
    // eslint-disable-next-line no-console
    console.log(`[WO-GENERAL-AGENT-DSH ⑤] classification.model=${task.classification?.model} runKey=${run?.agentKey}`);
    expect(run!.agentKey).toBe("supply_chain");
    expect(run!.attribution).toBe("REGISTERED");
  });
});
