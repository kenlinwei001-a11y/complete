import { describe, expect, it } from "vitest";
import { solverMcpToolName, type AgentDefinition } from "@platform/contracts";
import { createTestApp, TENANT, type TestApp } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";
import { seedMcpConfigs, seedRegistry } from "../src/mocks/seed.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { enterNesting } from "../src/runtime.js";

/**
 * WO-MCP-TOP8-VS-ROSTER · 最小实验（探针）：提示词目录段 vs 运行时真授予面。
 *
 * 背景（上一单 NOT-MEASURED 留下的同族缺口）：原生臂对 MCP 工具按相关性截 top-8
 * （`selectMcpTools`），目录段的成员资格只过 `toolFilter ∩ 对象域`，**不看** top-8 截断
 * ⇒ 对 MCP 工具 >8 个的 agent，目录段可能点名一条模型**拿不到**的工具。
 *
 * 本探针走**引擎真链路**（真 agent 定义 → 真 runRegisteredAgent → 真发给 LLM 的首轮请求），
 * 量三个数：
 *   · N_prompt —— 首轮 prompt 目录段点名的求解器键（抽取器同 roster-toolfilter.seam 的量具）；
 *   · N_grant  —— 同一份 LLM 请求里 `tools[]` 实际带上的 `mcp__solvers__*`（= selectMcpTools 的产出）；
 *   · 差集 N_prompt − N_grant。
 */

const CTX = { tenantId: TENANT, userId: "user-planner", roles: ["planner"] };
/** 与 `arm-failure-visible.seam.test.ts` ⑦ / `roster-toolfilter.seam.test.ts` 同一句（活服务实测问句）。 */
const QUERY = "常州基地当前的产能利用率是多少？瓶颈在哪道工序？";

/** 种子里 agt_seed_analyst 的授予面（16 个求解器，真数组）。 */
const ANALYST_KEYS = [
  "gap_attribution", "decision_play", "metric_rollup", "credit_exposure", "finance_pnl",
  "supply_demand_gap_attribution", "atp_check", "bottleneck_matrix", "base_capacity_outlook",
  "generic_inference", "capacity_forecast", "affected_orders", "kit_readiness",
  "risk_timeline", "mrp_netting", "yield_diagnosis",
];

/** 目录段里被列出的键（同 `roster-toolfilter.seam.test.ts` 的量具：只在目录段标题之后取 `  · key：` 行）。 */
function rosterSection(text: string): string[] {
  const lines = text.replace(/\\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => l.includes("全部可调用的求解器目录"));
  if (start < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    const m = /^ {2}· ([A-Za-z0-9_]+)：/.exec(l);
    if (!m) break;
    out.push(m[1]!);
  }
  return out;
}

/** 同一份请求里真正带上的工具名（tools[]）= 模型面可调用面。 */
function requestToolNames(req: { tools: { name: string }[] }): string[] {
  return req.tools.map((t) => t.name);
}

/** 活目录替身：16 条授予面求解器（描述与本题检索词命中，reads 落在 analyst 对象域内）。 */
function stubAnalystRegistry(t: TestApp): void {
  const READS = ["Base", "Order", "Model", "Line", "Process"];
  (t.dataCore.catalog as unknown as { solverRegistry: (ctx: unknown) => Promise<{ items: unknown[] }> }).solverRegistry = async () => ({
    items: ANALYST_KEYS.map((key) => ({
      key,
      name: key,
      description: `${key}：产能利用率与瓶颈测算（常州基地）`,
      domain: "capacity",
      argHints: {} as Record<string, string>,
      answersQuestions: ["产能利用率是多少", "瓶颈在哪道工序", `${key} 相关问句`],
      tags: ["产能", "利用率", "瓶颈", key],
      ontologySignature: { reads: READS.map((typeKey) => ({ typeKey })) },
    })),
  });
}

/** 真链路：真 agent 定义 → 真引擎 → 首轮发给 LLM 的请求原文。 */
async function firstRequest(agentId: string, t: TestApp, extra?: (a: AgentDefinition) => AgentDefinition) {
  await t.repos.agents.insert({ ...(extra ? extra(seedRegistry().agents.find((a) => a.id === agentId)!) : seedRegistry().agents.find((a) => a.id === agentId)!), tenantId: TENANT });
  for (const c of seedMcpConfigs()) if (!(await t.repos.mcpConfigs.get(c.id))) await t.repos.mcpConfigs.insert(c);
  stubAnalystRegistry(t);
  t.llm.queueAgentTurn(() => ({
    content: [
      text("结论如下。"),
      toolUse("final_answer", { blocks: [{ type: "text", markdown: "产能利用率见 KPI ⟦ref:0⟧。" }], provenance: [] }),
    ],
  }));
  const before = t.llm.agentRequests.length;
  await t.deps.engine.runRegisteredAgent({
    taskId: `task_top8_${agentId}`,
    agentId,
    version: 1,
    prompt: QUERY,
    ctx: CTX as never,
    nesting: enterNesting({ callChain: [], budget: new BudgetTracker() }, "agent", agentId),
    emit: async () => {},
  });
  const req = t.llm.agentRequests[before];
  expect(req, "引擎一次都没请求 LLM ⇒ 没走到注入点").toBeDefined();
  return req!;
}

describe("WO-MCP-TOP8-VS-ROSTER · 最小实验（改前实测）", () => {
  it("agt_seed_analyst（16 求解器）：目录段 N_prompt vs 运行时 N_grant，差集必须非空（这就是病）", async () => {
    const t = await createTestApp();
    try {
      const analyst = seedRegistry().agents.find((a) => a.id === "agt_seed_analyst")!;
      const filter = (analyst.tools.find((r) => r.kind === "MCP") as { toolFilter?: string[] } | undefined)?.toolFilter ?? [];
      const req = await firstRequest("agt_seed_analyst", t);
      const prompt = JSON.stringify(req.messages);
      const roster = rosterSection(prompt);
      const toolNames = requestToolNames(req);
      const grantedSolverKeys = toolNames.filter((n) => n.startsWith("mcp__solvers__")).map((n) => n.replace(/^mcp__solvers__/, ""));
      const allMcp = toolNames.filter((n) => n.startsWith("mcp__"));

      // eslint-disable-next-line no-console
      console.log(JSON.stringify({
        toolFilterCount: filter.length,
        N_prompt_roster: roster.length,
        N_grant_solvers: grantedSolverKeys.length,
        N_grant_all_mcp: allMcp.length,
        granted: grantedSolverKeys,
        diff_prompt_minus_grant: roster.filter((k) => !grantedSolverKeys.includes(k)),
      }, null, 2));

      // 金丝雀：抽取器在真链路上抽得到（否则下面的差集是空集同义反复）。
      expect(roster.length, "目录段一行都没抽到 ⇒ 量具没内容可量").toBeGreaterThan(0);
      expect(grantedSolverKeys.length, "工具面一个求解器都没授予 ⇒ 前提不成立").toBeGreaterThan(0);
      const diff = roster.filter((k) => !grantedSolverKeys.includes(k));
      expect(diff, `目录段点名了运行时未授予的求解器：${diff.join(",")}`).not.toEqual([]);
    } finally {
      await t.app.close();
    }
  }, 30000);
});
