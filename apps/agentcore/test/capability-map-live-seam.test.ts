import { describe, expect, it } from "vitest";
import type { PageContext } from "@platform/contracts";
import { createTestApp, submitQuery, waitForTask, lastToolCallId, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { text, toolUse, type ScriptedTurn } from "../src/llm/mock.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { FALLBACK_SOLVER_CATALOG_KEYS } from "../src/agent/navigation-slice.js";
import { installLiveSolverCatalog, LIVE_SOLVER_CATALOG_FIXTURE } from "./live-solver-catalog.fixture.js";

/**
 * WO-CAPMAP-LIVE · SEAM 头号判据：**能力地图的注入源 = 活资源目录，不是那份手写镜像**。
 *
 * 病根（真起服务实测，非读代码猜）：
 *  · `agent/navigation-slice.ts` 手写目录 = **19 条**；
 *  · 活资源目录 = **59 solver / 94 object_type / 813 field**（`GET /b/v1/resources`·demo 租户）；
 *  · 差集 **40 条**求解器已注册、已开通、检索得到，却**从未出现在给模型的候选里**
 *    （portfolio / multi_objective / cross_object_occupancy / plan_rootcause / chain_loss_attribution …）。
 *
 * 本测试**驱动真实注入链路**（不是"函数能读活目录"那种咬函数不咬链路的假绿）：
 *   A 侧 solverRegistry → DRIL ResourceRegistryService 投影 → 混合检索排序
 *   → fetchLiveSolverCatalog（门槛+topN 裁剪）→ projectNavigationSlice → renderNavigationSlice
 *   → path-B userContent → **真正发给 LLM 的首轮 messages**
 * 断言全部落在链路末端（`t.llm.agentRequests[0].messages`），任一环断开即红。
 *
 * 反假绿设计：**"镜像里没有"是算出来的**（`FALLBACK_SOLVER_CATALOG_KEYS` 求差集），
 * 不是把 key 抄进断言 —— 抄了就是再造一份镜像，镜像一变断言照样绿。
 */

/** 供需双向块（rich block context → 落 path-B 真 LLM 深问·导航图注入挂点即在此路径）。 */
function supplyDemandBlockPC(): PageContext {
  return {
    view: "dashboard",
    entities: [],
    selection: [],
    drillPath: [],
    actions: [],
    block: {
      blockId: "dash-supply-demand",
      blockType: "supply-demand",
      blockTitle: "供需失衡双向归因",
      blockData: { metricKey: "seg_attain_ess", totalGap: 27.8, unit: "万套", demandPct: 28.5, supplyPct: 63.2, reconciled: true },
      selection: [],
      provenanceRef: "supply_demand_gap_attribution",
    },
  };
}

/**
 * 真开放深问（多域串联）——刻意选**落 path-B** 的题：带对口单一 solver 的定向问句会被
 * QOS-1 在 path-B 入口前拉回 path-A（path=WORKFLOW），那条路没有 agent 注入链路可验。
 */
const OPEN_DEEP_Q = "这块供需失衡背后还有哪些连锁影响？全链环节损失、毛利倒挂、KPI 根因都综合看看";

function plannedTurns(): ScriptedTurn[] {
  return [
    () => ({
      content: [
        text("导航图已给出候选求解器，直接一步到位。"),
        toolUse("invoke_solver", { solverKey: "gap_attribution", args: { metricKey: "seg_attain_ess" } }),
      ],
    }),
    (req) => ({
      content: [
        toolUse("final_answer", {
          blocks: [{ type: "text", markdown: "供需缺口归因：需求端为主 ⟦ref:0⟧。" }],
          provenance: [{ toolCallId: lastToolCallId(req), outputPath: "$.totalGap" }],
        }),
      ],
    }),
  ];
}

/** 跑一条真 path-B 深问，回**首轮真正发给 LLM** 的 prompt 全文。 */
async function firstAgentPrompt(t: TestApp, query: string): Promise<string> {
  t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "ceo.free-llm"]);
  t.llm.queueAgentTurn(...plannedTurns());
  const { taskId } = await submitQuery(t, ADMIN, query, { view: "dashboard", pageContext: supplyDemandBlockPC() });
  await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
  const task = await t.repos.tasks.get(taskId);
  expect(task?.path, "本题必须真落 path-B（否则验的不是 agent 注入链路）").toBe("AGENT");
  return JSON.stringify(t.llm.agentRequests[0]!.messages);
}

/** 候选段里真正被列出的求解器 key（按渲染格式 `key：能力` 认，避免把正文里偶然出现的字串算进来）。 */
function injectedSolverKeys(prompt: string): string[] {
  return LIVE_SOLVER_CATALOG_FIXTURE.map((s) => s.key).filter((k) => prompt.includes(`${k}：`));
}

describe("WO-CAPMAP-LIVE · SEAM ① 注入源 = 活资源目录（镜像里没有的求解器进得了候选集）", () => {
  it("金丝雀：判据本身有判别力（差集非空 · 镜像非空 · 两者有交集）", () => {
    expect(FALLBACK_SOLVER_CATALOG_KEYS.length, "镜像 key 集为空 ⇒ 差集恒非空 ⇒ 断言失去判别力").toBe(19);
    expect(FALLBACK_SOLVER_CATALOG_KEYS, "金丝雀：镜像确实收录了这条（不中 ⇒ 是取镜像的工具坏了，不是代码没问题）").toContain("gap_attribution");
    const fixtureKeys = LIVE_SOLVER_CATALOG_FIXTURE.map((s) => s.key);
    const liveOnly = fixtureKeys.filter((k) => !FALLBACK_SOLVER_CATALOG_KEYS.includes(k));
    const overlap = fixtureKeys.filter((k) => FALLBACK_SOLVER_CATALOG_KEYS.includes(k));
    expect(liveOnly.length, "替身与镜像完全重合 ⇒ 无法证伪『注入源还是镜像』").toBeGreaterThan(0);
    expect(overlap.length, "替身与镜像零重合 ⇒ 差集断言退化成同义反复").toBeGreaterThan(0);
  });

  it("★ 镜像里没有的求解器**真的**进了发给模型的首轮 prompt（活目录接线·非蒙）", async () => {
    const t = await createTestApp();
    installLiveSolverCatalog(t);
    const prompt = await firstAgentPrompt(t, OPEN_DEEP_Q);

    const injected = injectedSolverKeys(prompt);
    expect(injected.length, "候选段一条求解器都没有 ⇒ 注入链路断了").toBeGreaterThan(0);

    // "镜像没有"是**算出来的**：注入集 ∖ 镜像 key 集。
    const liveOnlyInjected = injected.filter((k) => !FALLBACK_SOLVER_CATALOG_KEYS.includes(k));
    expect(
      liveOnlyInjected.length,
      `候选集里一个"镜像没有"的求解器都没有 ⇒ 注入源仍是那份 19 条手写镜像。实际注入=${injected.join(",")}`,
    ).toBeGreaterThan(0);

    // 举实名一条：`chain_loss_attribution`（环节级损失归因）属实测 40 条差集之一。
    expect(FALLBACK_SOLVER_CATALOG_KEYS, "前提校验：该 key 必须确实不在镜像里，否则本断言没意义").not.toContain("chain_loss_attribution");
    expect(prompt, "环节级损失归因（活目录有·镜像无）未进候选集").toContain("chain_loss_attribution：");

    await t.app.close();
  });

  it("金标问句的期望求解器仍是首选（换源没把选型换劣·★ 标在 gap_attribution 上）", async () => {
    const t = await createTestApp();
    installLiveSolverCatalog(t);
    const prompt = await firstAgentPrompt(t, OPEN_DEEP_Q);
    expect(prompt, "金标对口求解器 gap_attribution 不在候选集").toContain("gap_attribution：");
    // ★ = primarySolver（确定性路由选出的对口 solver）——它必须仍被置顶，而不是被检索序冲掉。
    expect(prompt).toContain("★ gap_attribution：");
    await t.app.close();
  });

  it("候选条目带**活目录的**输出形状（A 侧 SOLVER_OUTPUT_SHAPES 经 REST 透传·接缝不丢）", async () => {
    const t = await createTestApp();
    installLiveSolverCatalog(t);
    const prompt = await firstAgentPrompt(t, OPEN_DEEP_Q);
    // 判据取**只有活目录才有**的字段：镜像那份 gap_attribution.outputShape 是
    // [rootMetric,totalGap,levels,atomicLeaves,causalEdges,reconciled,summary]，
    // 而 A 侧真值另有 reconChecks/residualPct/severityKind —— 出现即证明形状来自活目录而非镜像。
    expect(prompt, "输出形状仍是镜像那份（接缝把 outputShape 丢了）").toMatch(/reconChecks|residualPct|severityKind/);
    await t.app.close();
  });
});

/**
 * 第二条生产注入路径：`engine.runRegisteredAgent`（7 角色 agent / coordinator 扇出 / 场景 agent）。
 * 与 path-B 是**两个独立挂点**——只验一条会漏掉另一条（本单两处都改了，就必须两处都咬）。
 */
describe("WO-CAPMAP-LIVE · SEAM ①b 注册 agent 路径（engine.runRegisteredAgent）同样吃活目录", () => {
  it("注册 agent 的首轮 prompt 里也出现镜像没有的求解器", async () => {
    const t = await createTestApp();
    installLiveSolverCatalog(t);
    await t.repos.agents.insert({
      tenantId: TENANT,
      id: "agt_capmap",
      key: "capmap_agent",
      version: 1,
      name: "capmap_agent",
      description: "能力地图接线验证 agent",
      model: "claude-opus-4-8",
      systemPrompt: "你是测试 agent。",
      tools: [{ kind: "BUILTIN", name: "invoke_solver" }],
      ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
      skills: [],
      mcpServers: [],
      // 不声明 objectTypes → 不做对象域收窄；toolNames 含 invoke_solver → 图会列 solver。
      scopeDeclaration: { objectTypes: [], toolNames: ["invoke_solver"] },
      status: "PUBLISHED",
    } as never);

    t.llm.queueAgentTurn(() => ({
      content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "ok" }], provenance: [] })],
    }));
    await t.deps.engine.runRegisteredAgent({
      taskId: "task_capmap",
      agentId: "agt_capmap",
      version: "latest",
      prompt: OPEN_DEEP_Q,
      ctx: { tenantId: TENANT, userId: "user-planner", roles: ["planner"] },
      nesting: { callChain: [], budget: new BudgetTracker() },
      emit: async () => undefined,
    });

    const prompt = JSON.stringify(t.llm.agentRequests[0]!.messages);
    const injected = injectedSolverKeys(prompt);
    const liveOnly = injected.filter((k) => !FALLBACK_SOLVER_CATALOG_KEYS.includes(k));
    expect(
      liveOnly.length,
      `注册 agent 路径的候选集里没有任何"镜像没有"的求解器 ⇒ engine.ts 那个挂点还连在镜像上。实际注入=${injected.join(",")}`,
    ).toBeGreaterThan(0);
    await t.app.close();
  });
});

describe("WO-CAPMAP-LIVE · SEAM ② 提示词不再封死 discover", () => {
  it("注入段明说『候选不是全集』并鼓励再检索（旧文案『选型已替你做完』已废）", async () => {
    const t = await createTestApp();
    installLiveSolverCatalog(t);
    const prompt = await firstAgentPrompt(t, OPEN_DEEP_Q);
    expect(prompt, "旧劝阻文案仍在 —— 提示词还在劝模型别用那个查得到答案的检索").not.toContain("选型已替你做完");
    expect(prompt).toContain("不是全集");
    expect(prompt).toMatch(/discover|retrieve_knowledge/);
    await t.app.close();
  });
});

describe("WO-CAPMAP-LIVE · SEAM ③ R6 确定性 + fail-open 降级", () => {
  it("同问句两次跑，注入的候选段**字节一致**（检索确定·无随机）", async () => {
    const sliceOf = (p: string): string => {
      const i = p.indexOf("本题导航图");
      const j = p.indexOf("· 链路：");
      return i >= 0 && j > i ? p.slice(i, j) : "";
    };
    const t1 = await createTestApp();
    installLiveSolverCatalog(t1);
    const a = sliceOf(await firstAgentPrompt(t1, OPEN_DEEP_Q));
    await t1.app.close();

    const t2 = await createTestApp();
    installLiveSolverCatalog(t2);
    const b = sliceOf(await firstAgentPrompt(t2, OPEN_DEEP_Q));
    await t2.app.close();

    expect(a.length, "导航图段没截到 ⇒ 本断言退化为空串相等（假绿）").toBeGreaterThan(200);
    expect(a).toBe(b);
  });

  it("活目录取不到（A 侧注册表抛错）→ 退降级镜像·查询不阻断（fail-open）", async () => {
    const t = await createTestApp();
    const catalog = t.dataCore.catalog as unknown as { solverRegistry: () => Promise<unknown> };
    catalog.solverRegistry = async () => {
      throw new Error("DataCore 不可达（模拟）");
    };
    const prompt = await firstAgentPrompt(t, OPEN_DEEP_Q);
    expect(prompt, "活目录挂了就连图都不注入了 ⇒ 降级路没兜住").toContain("本题导航图");
    const injectedFallback = FALLBACK_SOLVER_CATALOG_KEYS.filter((k) => prompt.includes(`${k}：`));
    expect(injectedFallback.length, "活目录挂了且降级镜像也没兜住 ⇒ 模型手里一张图都没有").toBeGreaterThan(0);
    await t.app.close();
  });

  it("无关问句不被灌噪声：相关性全在门槛下 → 不注入求解器候选（同改造前『无族信号不注入』）", async () => {
    const t = await createTestApp();
    installLiveSolverCatalog(t);
    // 「你好」实测最高分 0.245 < 门槛 0.30 ⇒ 活目录返 undefined ⇒ 降级镜像也无族信号 ⇒ 图里无 solver。
    const { fetchLiveSolverCatalog } = await import("../src/agent/live-capability-map.js");
    const src = t.deps.engine.capabilityMapSource();
    const cat = await fetchLiveSolverCatalog(src, { tenantId: TENANT, userId: "u", roles: [] } as never, "你好");
    expect(cat, "无关问句仍取回候选 ⇒ 门槛失效，模型每题都会被灌 6 条不相干求解器").toBeUndefined();
    await t.app.close();
  });
});
