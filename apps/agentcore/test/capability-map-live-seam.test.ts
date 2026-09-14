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

// ───────────────────────────────────────────────────────────────────────────
// WO-TOOLS-LIST · 两段式（阶段① 全量目录 ⊥ 阶段② 按需详情）的判据工具
//
// ⚠ 两段必须**分开数**：改造前"可见"与"被展开"是同一个数（都被 MAX_SOLVERS=6 绑死），
//   于是断言随便咬哪个都一样；改造后它们是两个数，混着数就验不出本单到底做了什么。
//   行首前缀是唯一可靠的区分：详情段 `  ★ `/`  - `，目录段 `  · `。
// ───────────────────────────────────────────────────────────────────────────

/** prompt 是 JSON.stringify 过的 —— 换行是字面 `\n`，先还原再按行认。 */
function sliceLines(prompt: string): string[] {
  return prompt.replace(/\\n/g, "\n").split("\n");
}
/** 阶段②「详情段」里被完整展开的 key。 */
function detailKeys(prompt: string): string[] {
  return sliceLines(prompt)
    .map((l) => /^ {2}[★-] ([a-z0-9_]+)：/.exec(l)?.[1])
    .filter((k): k is string => Boolean(k));
}
/** 阶段①「全量目录段」里被列出的 key。 */
function rosterKeys(prompt: string): string[] {
  return sliceLines(prompt)
    .map((l) => /^ {2}· ([a-z0-9_]+)：/.exec(l)?.[1])
    .filter((k): k is string => Boolean(k));
}
/** 模型**能看见**的求解器 = 两段并集（这才是"发现面"，不是"展开面"）。 */
function visibleKeys(prompt: string): string[] {
  return [...new Set([...detailKeys(prompt), ...rosterKeys(prompt)])];
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

/**
 * WO-TOOLS-LIST · SEAM ①c **发现面 = 全量目录，不是相关性前 6**（本单头号判据）。
 *
 * 病根（本单实测，真数组非 grep）：`ALL_SOLVER_CATALOG` = **63 条**，而模型每题只被喂
 * 相关性 top-6 ⇒ **57 条从未被告知存在**；权限上它们全都调得动（`tools/executor.ts` 的
 * `invoke_solver` 不按候选集限制）⇒ **卡点是发现面，不是鉴权**。
 * 且检索按问句相关性排序 ⇒ 冷门求解器天然排不进前 6 ⇒ 没有使用记录 ⇒ 更排不进：**自锁**。
 *
 * ⚠ 本组断言**刻意不咬 `MAX_SOLVERS` 那个常数**。把 6 调成 63 能让"可见数"这一条变绿，
 *   但 80 个求解器时原样复发 —— 那不是本单要的东西。真正被咬死的是**结构**：
 *   「目录段列全 ∧ 详情段仍然收窄 ∧ 目录行比详情行短」三条同时成立，
 *   单纯调大常数会让第 2、3 条**当场变红**。
 */
describe("WO-TOOLS-LIST · SEAM ①c 两段式：目录段列全 · 详情段仍收窄", () => {
  it("金丝雀：两段的量法各自有判别力（详情段数得出来 · 目录段数得出来 · 两段不是同一批）", async () => {
    const t = await createTestApp();
    installLiveSolverCatalog(t);
    const prompt = await firstAgentPrompt(t, OPEN_DEEP_Q);
    const detail = detailKeys(prompt);
    const roster = rosterKeys(prompt);
    expect(detail.length, "详情段一条都数不出来 ⇒ **量法坏了**（行前缀正则不匹配），不是『没注入』").toBeGreaterThan(0);
    expect(roster.length, "目录段一条都数不出来 ⇒ **量法坏了**，不是『目录为空』").toBeGreaterThan(0);
    expect(
      roster.length - detail.length,
      "目录段与详情段条数相同 ⇒ 两段退化成一段，后面所有『目录列全』的断言都失去判别力",
    ).toBeGreaterThan(0);
    await t.app.close();
  });

  it("★ 活目录里**每一条**求解器都进了发给模型的目录段（不是前 6·差集算出来·不抄 key）", async () => {
    const t = await createTestApp();
    installLiveSolverCatalog(t);
    const prompt = await firstAgentPrompt(t, OPEN_DEEP_Q);

    const all = LIVE_SOLVER_CATALOG_FIXTURE.map((s) => s.key);
    const missing = all.filter((k) => !visibleKeys(prompt).includes(k));
    expect(
      missing,
      `活目录有 ${all.length} 条，模型只看见 ${visibleKeys(prompt).length} 条 —— 看不见的这些它永远选不到：${missing.join(",")}`,
    ).toEqual([]);
    await t.app.close();
  });

  it("★ 排在相关性窗口外的『冷门』求解器：**可见但不展开**（两段式的命门·差集算出来）", async () => {
    const t = await createTestApp();
    installLiveSolverCatalog(t);
    const prompt = await firstAgentPrompt(t, OPEN_DEEP_Q);

    const detail = detailKeys(prompt);
    // "冷门" = 本题相关性没进详情段的那批，**算出来的**，不是我判断哪条冷门。
    const cold = LIVE_SOLVER_CATALOG_FIXTURE.map((s) => s.key).filter((k) => !detail.includes(k));
    expect(cold.length, "所有求解器都进了详情段 ⇒ 本条退化成同义反复（替身太小或截断失效）").toBeGreaterThan(0);

    const coldInvisible = cold.filter((k) => !rosterKeys(prompt).includes(k));
    expect(
      coldInvisible,
      `这些求解器既没进详情段、也没进目录段 ⇒ 模型无从知道它们存在（本单要治的正是这个）：${coldInvisible.join(",")}`,
    ).toEqual([]);
    await t.app.close();
  });

  it("★ 目录**轻**、详情**重**：同一条求解器的目录行显著短于它的详情行（证明不是把全文抄了两遍）", async () => {
    const t = await createTestApp();
    installLiveSolverCatalog(t);
    const prompt = await firstAgentPrompt(t, OPEN_DEEP_Q);
    const lines = sliceLines(prompt);
    const detailLineOf = (k: string): string | undefined => lines.find((l) => new RegExp(`^ {2}[★-] ${k}：`).test(l));
    const rosterLineOf = (k: string): string | undefined => lines.find((l) => new RegExp(`^ {2}· ${k}：`).test(l));

    const both = detailKeys(prompt).filter((k) => rosterLineOf(k) !== undefined);
    expect(both.length, "没有任何一条求解器同时出现在两段 ⇒ 本条没东西可比（目录段应含详情那几条）").toBeGreaterThan(0);
    for (const k of both) {
      const d = detailLineOf(k)!.length;
      const r = rosterLineOf(k)!.length;
      expect(r, `目录行(${r}) 不短于详情行(${d}) —— ${k} 的目录段没做"一句话"压缩，全量目录就喂不起`).toBeLessThan(d);
    }
    await t.app.close();
  });

  it("目录段**与问句无关**（R6·按 key 字典序不按热度）—— 两道完全不同的题渲染出同一份目录", async () => {
    const rosterSectionOf = (p: string): string =>
      sliceLines(p).filter((l) => /^ {2}· [a-z0-9_]+：/.test(l)).join("\n");

    const t1 = await createTestApp();
    installLiveSolverCatalog(t1);
    const a = rosterSectionOf(await firstAgentPrompt(t1, OPEN_DEEP_Q));
    await t1.app.close();

    const t2 = await createTestApp();
    installLiveSolverCatalog(t2);
    const b = rosterSectionOf(
      await firstAgentPrompt(t2, "这个季度毛利为什么倒挂？顺便把全链损失和各环节 KPI 都综合看一遍"),
    );
    await t2.app.close();

    expect(a.length, "目录段没截到 ⇒ 本断言退化为空串相等（假绿）").toBeGreaterThan(100);
    expect(
      b,
      "两道不同的题得到不同的目录段 ⇒ 目录在按相关性/热度排 —— 那正是『冷门排后面→更少被选→更冷』这个自锁循环的来源",
    ).toBe(a);
  });

  it("目录段提示模型**怎么取详情**（阶段②）—— 否则『看见名字』仍然等于选不动", async () => {
    const t = await createTestApp();
    installLiveSolverCatalog(t);
    const prompt = await firstAgentPrompt(t, OPEN_DEEP_Q);
    expect(prompt, "目录段没告诉模型怎么取参数说明 ⇒ 它只能照名字盲猜 args").toMatch(/discover.*solvers/);
    expect(prompt).toContain("全部可调用的求解器目录");
    await t.app.close();
  });

  it("全集条数必须留在取回上限之内 —— 越线目录会**静默**退化成『前 100 名』（机器先说话）", async () => {
    const { SEARCH_FETCH_LIMIT } = await import("../src/agent/live-capability-map.js");
    const t = await createTestApp();
    installLiveSolverCatalog(t);
    const prompt = await firstAgentPrompt(t, OPEN_DEEP_Q);
    expect(
      rosterKeys(prompt).length,
      `目录段条数已顶到取回上限 ${SEARCH_FETCH_LIMIT} —— "全部可调用"这句话已经不成立，` +
        "而它不会报错、只会少列几条：正是本单要治的病换个数字复发。",
    ).toBeLessThan(SEARCH_FETCH_LIMIT);
    await t.app.close();
  });
});

/**
 * WO-TOOLS-LIST · SEAM ①d **发现面变宽，隔离语义一格不松**。
 * 「让模型看见全部」最容易顺手做坏的就是这一条：把 scope 过滤跳过去，目录就成了越权清单。
 */
describe("WO-TOOLS-LIST · SEAM ①d 目录段仍走同一套 scope 隔离", () => {
  it("窄 scope 的注册 agent：越界求解器**既不进详情段、也不进目录段**", async () => {
    const t = await createTestApp();
    installLiveSolverCatalog(t);
    // 只声明 Material 域 —— fixture 里 kit_readiness 读 Material，gap_attribution 读 Metric 族。
    await t.repos.agents.insert({
      tenantId: TENANT,
      id: "agt_scoped",
      key: "scoped_agent",
      version: 1,
      name: "scoped_agent",
      description: "窄 scope 隔离验证 agent",
      model: "claude-opus-4-8",
      systemPrompt: "你是测试 agent。",
      tools: [{ kind: "BUILTIN", name: "invoke_solver" }],
      ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" },
      skills: [],
      mcpServers: [],
      scopeDeclaration: { objectTypes: ["Material"], toolNames: ["invoke_solver"] },
      status: "PUBLISHED",
    } as never);

    t.llm.queueAgentTurn(() => ({
      content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "ok" }], provenance: [] })],
    }));
    await t.deps.engine.runRegisteredAgent({
      taskId: "task_scoped",
      agentId: "agt_scoped",
      version: "latest",
      prompt: OPEN_DEEP_Q,
      ctx: { tenantId: TENANT, userId: "user-planner", roles: ["planner"] },
      nesting: { callChain: [], budget: new BudgetTracker() },
      emit: async () => undefined,
    });
    const prompt = JSON.stringify(t.llm.agentRequests[0]!.messages);
    const visible = visibleKeys(prompt);

    // 金丝雀：窄 scope 下**确实还看得见东西**（全空 ⇒ 下面的"越界不可见"退化成同义反复）。
    expect(visible.length, "窄 scope 把图筛空了 ⇒ 本条没有判别力（不是隔离对了，是量法没内容可量）").toBeGreaterThan(0);
    // 全可见集必须是「读 Material 的 ∪ 无对象域声明的」子集 —— 判据**算出来**，不抄 key。
    const inScope = new Set(
      LIVE_SOLVER_CATALOG_FIXTURE.filter((s) => {
        const reads = ((s as { scopeObjectTypes?: string[] }).scopeObjectTypes ?? []) as string[];
        return reads.length === 0 || reads.includes("Material");
      }).map((s) => s.key),
    );
    const leaked = visible.filter((k) => !inScope.has(k));
    expect(leaked, `目录段把越界求解器列给了窄 scope agent（隔离语义被"让它看见全部"顺手做坏了）：${leaked.join(",")}`).toEqual([]);
    await t.app.close();
  });

  it("调不了 solver 的 agent：目录段也不出现（不吊模型胃口·同详情段语义）", async () => {
    const { projectNavigationSlice, renderNavigationSlice } = await import("../src/agent/navigation-slice.js");
    const { fetchLiveSolverCatalog } = await import("../src/agent/live-capability-map.js");
    const t = await createTestApp();
    installLiveSolverCatalog(t);
    const cat = await fetchLiveSolverCatalog(
      t.deps.engine.capabilityMapSource(),
      { tenantId: TENANT, userId: "u", roles: [] } as never,
      OPEN_DEEP_Q,
    );
    expect(cat, "前提：活目录取得到（取不到则本条验的是降级路，不是工具白名单）").toBeDefined();
    const slice = projectNavigationSlice(OPEN_DEEP_Q, undefined, { toolNames: ["query_objects"] }, cat);
    expect(slice.solvers, "无 invoke_solver 能力却列出了详情段").toEqual([]);
    expect(slice.roster ?? [], "无 invoke_solver 能力却列出了全量目录 —— 列一堆它调不动的东西是纯噪声").toEqual([]);
    expect(renderNavigationSlice(slice)).not.toContain("全部可调用的求解器目录");
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
    // WO-TOOLS-LIST：降级态手上只有 19 条残本，**不许**渲染"全部可调用的求解器目录" ——
    // 那句话会让模型判定"目录都给我了，不用再 discover"，比不给目录更坏（诚实优先于完整）。
    expect(
      prompt,
      "降级镜像把 19 条残本宣称成了全集 —— 模型会据此**停止** discover，比没有目录段更坏",
    ).not.toContain("全部可调用的求解器目录");
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
