import { describe, expect, it } from "vitest";
import type { PageContext } from "@platform/contracts";
import { createTestApp, submitQuery, waitForTask, lastToolCallId, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { text, toolUse, type ScriptedTurn } from "../src/llm/mock.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { FALLBACK_SOLVER_CATALOG_KEYS } from "../src/agent/navigation-slice.js";
import { installLiveSolverCatalog, LIVE_SOLVER_CATALOG_FIXTURE } from "./live-solver-catalog.fixture.js";

/**
 * WO-CAPMAP-LIVE · SEAM 头号判据：**能力地图的注入源 = 活资源目录，不是那份手写镜像**。
 *
 * 病根（真起服务实测，非读代码猜）：
 *  · `agent/navigation-slice.ts` 手写 SOLVER_CATALOG = **19 条**；
 *  · 活资源目录 = **59 solver / 94 object_type / 813 field**（`GET /b/v1/resources`·demo 租户）；
 *  · 差集 **40 条**求解器已注册、已开通、检索得到，却**从未出现在给模型的候选里**。
 *
 * 本测试**驱动真实注入链路**（不是"函数能读活目录"那种咬函数不咬链路的假绿）：
 *   A 侧 solverRegistry → DRIL ResourceRegistryService 投影 → 混合检索 top-N
 *   → fetchLiveSolverCatalog → projectNavigationSlice → renderNavigationSlice
 *   → path-B userContent → **真正发给 LLM 的首轮 messages**
 * 断言落在链路末端（`t.llm.agentRequests[0].messages`），任一环断开即红。
 *
 * 反假绿设计：**"镜像里没有"是算出来的**（`FALLBACK_SOLVER_CATALOG_KEYS` 求差集），
 * 不是把 key 抄进断言 —— 抄了就是再造一份镜像，镜像一变断言照样绿。
 */

/** 供需双向块（rich block context → shouldUseFreeLLM=true 落 path-B 真 LLM 深问·导航图注入挂点即在此路径）。 */
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

/** 跑一条真 path-B 深问，回首轮真正发给 LLM 的 prompt 全文。 */
async function firstAgentPrompt(t: TestApp, query: string): Promise<string> {
  t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "ceo.free-llm"]);
  t.llm.queueAgentTurn(...plannedTurns());
  const { taskId } = await submitQuery(t, ADMIN, query, { view: "dashboard", pageContext: supplyDemandBlockPC() });
  await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
  const task = await t.repos.tasks.get(taskId);
  expect(task?.path, "本题必须真落 path-B（否则验的不是 agent 注入链路）").toBe("AGENT");
  return JSON.stringify(t.llm.agentRequests[0]!.messages);
}

/** 活目录里有、降级镜像里**没有**的 key（算出来的差集·非抄写）。 */
const LIVE_ONLY_KEYS = LIVE_SOLVER_CATALOG_FIXTURE.map((s) => s.key).filter(
  (k) => !FALLBACK_SOLVER_CATALOG_KEYS.includes(k),
);

describe("WO-CAPMAP-LIVE · SEAM ① 注入源 = 活资源目录（镜像里没有的求解器进得了候选集）", () => {
  it("金丝雀：差集非空 —— 场景替身里确实有镜像没有的 key（不中即夹具坏了，不许据此报『代码没问题』）", () => {
    expect(FALLBACK_SOLVER_CATALOG_KEYS.length, "降级镜像 key 集为空 ⇒ 差集恒非空 ⇒ 本组断言失去判别力").toBeGreaterThan(0);
    expect(LIVE_ONLY_KEYS.length, "场景替身与镜像完全重合 ⇒ 无法证伪『注入源还是镜像』").toBeGreaterThan(0);
    // 反向金丝雀：镜像**确实**收录了某些 key（证明 FALLBACK_SOLVER_CATALOG_KEYS 不是空壳/坏值）。
    expect(FALLBACK_SOLVER_CATALOG_KEYS).toContain("gap_attribution");
    // 且替身里确有镜像收录的条目 —— 差集不是"全都不在"这种退化情形。
    const overlap = LIVE_SOLVER_CATALOG_FIXTURE.map((s) => s.key).filter((k) => FALLBACK_SOLVER_CATALOG_KEYS.includes(k));
    expect(overlap.length, "替身与镜像零重合 ⇒ 差集断言变成同义反复").toBeGreaterThan(0);
  });

  it("镜像里没有的求解器**真的**进了发给模型的首轮 prompt（活目录接线·非蒙）", async () => {
    const t = await createTestApp();
    installLiveSolverCatalog(t);
    const prompt = await firstAgentPrompt(t, "综合分析这块供需失衡的前因后果和连锁影响");

    const injectedLiveOnly = LIVE_ONLY_KEYS.filter((k) => prompt.includes(k));
    expect(
      injectedLiveOnly.length,
      `候选集里一个"镜像没有"的求解器都没有 ⇒ 注入源仍是那份 19 条手写镜像。` +
        `差集候选=${LIVE_ONLY_KEYS.join(",")}｜注入段=${prompt.slice(prompt.indexOf("本题导航图"), prompt.indexOf("本题导航图") + 900)}`,
    ).toBeGreaterThan(0);

    // 举实名一条（`chain_loss_attribution` 属实测 40 条差集之一·镜像 19 条里根本没有）。
    expect(FALLBACK_SOLVER_CATALOG_KEYS, "前提校验：该 key 必须确实不在镜像里").not.toContain("chain_loss_attribution");
    expect(prompt, "环节级损失归因（活目录有·镜像无）未进候选集").toContain("chain_loss_attribution");

    await t.app.close();
  });

  it("金标问句的期望求解器仍在候选集里（换源没把选型换劣）", async () => {
    const t = await createTestApp();
    installLiveSolverCatalog(t);
    const prompt = await firstAgentPrompt(t, "储能份额为什么没达成目标，逐层拆解根因");
    // 金标：根因深问 → gap_attribution（真起服务实测 Top-1 即此条·score 0.4999）。
    expect(prompt, "金标问句的对口求解器 gap_attribution 不在候选集").toContain("gap_attribution");
    await t.app.close();
  });

  it("候选条目带活目录的输出形状（A 侧 SOLVER_OUTPUT_SHAPES 经 REST 透传·接缝不丢）", async () => {
    const t = await createTestApp();
    installLiveSolverCatalog(t);
    const prompt = await firstAgentPrompt(t, "储能份额为什么没达成目标，逐层拆解根因");
    // gap_attribution 的真实 outputShape 含 atomicLeaves —— 此值只可能来自 A 侧注册表透传，
    // 镜像那份 outputShape 也有 atomicLeaves，故再取一个**只有活目录才有**的字段做判据：
    // 实测 A 侧 gap_attribution.outputShape 含 `reconChecks`/`residualPct`，镜像那份没有。
    expect(prompt).toMatch(/reconChecks|residualPct|severityKind/);
    await t.app.close();
  });
});

describe("WO-CAPMAP-LIVE · SEAM ② 提示词不再封死 discover", () => {
  it("注入段明说『候选不是全集』且鼓励再检索（旧文案『选型已替你做完，不必再 discover』已废）", async () => {
    const t = await createTestApp();
    installLiveSolverCatalog(t);
    const prompt = await firstAgentPrompt(t, "综合分析这块供需失衡的前因后果和连锁影响");
    expect(prompt, "旧劝阻文案仍在（提示词在劝模型别用那个查得到答案的检索）").not.toContain("选型已替你做完");
    expect(prompt).toContain("不是全集");
    expect(prompt).toMatch(/discover|retrieve_knowledge/);
    await t.app.close();
  });
});

describe("WO-CAPMAP-LIVE · SEAM ③ R6 确定性 + fail-open 降级", () => {
  it("同问句两次跑，注入的导航图段**字节一致**（检索确定·无随机）", async () => {
    const q = "储能份额为什么没达成目标，逐层拆解根因";
    const sliceOf = (p: string): string => p.slice(p.indexOf("本题导航图"), p.indexOf("· 链路："));

    const t1 = await createTestApp();
    installLiveSolverCatalog(t1);
    const a = sliceOf(await firstAgentPrompt(t1, q));
    await t1.app.close();

    const t2 = await createTestApp();
    installLiveSolverCatalog(t2);
    const b = sliceOf(await firstAgentPrompt(t2, q));
    await t2.app.close();

    expect(a.length, "导航图段没截到 ⇒ 本断言退化为空串相等（假绿）").toBeGreaterThan(50);
    expect(a).toBe(b);
  });

  it("活目录取不到（A 侧注册表抛错）→ 退降级镜像·查询不阻断（fail-open）", async () => {
    const t = await createTestApp();
    const catalog = t.dataCore.catalog as unknown as { solverRegistry: () => Promise<unknown> };
    catalog.solverRegistry = async () => {
      throw new Error("DataCore 不可达（模拟）");
    };
    const prompt = await firstAgentPrompt(t, "综合分析这块供需失衡的前因后果和连锁影响");
    // 仍有导航图（走降级镜像），且出现的是镜像里的 key —— 证明降级路真的兜住了。
    expect(prompt).toContain("本题导航图");
    const injectedFallback = FALLBACK_SOLVER_CATALOG_KEYS.filter((k) => prompt.includes(k));
    expect(injectedFallback.length, "活目录挂了且降级镜像也没兜住 ⇒ 模型手里一张图都没有").toBeGreaterThan(0);
    await t.app.close();
  });
});
