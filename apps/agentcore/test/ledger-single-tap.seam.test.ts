/**
 * WO-LEDGER-SINGLE-TAP · **记账接缝**（SEAM-GATE：编排出口 × 账本端口）。
 *
 * ══ 守的不变量（一句话）═══════════════════════════════════════════════════════════
 * > **每一条 ROOT run 的出口，落库的同时必须记一次账 —— 不漏、不重。**
 *
 * ══ 病灶（2026-10-03 live 实测，不是推理）════════════════════════════════════════
 * `llmBudget.record` 全仓**只有一处**调用点（`runPathB` 出口），而 ROOT run 的落库出口有**三处**
 * （`runPathB` / `runRolePathB` / `runSceneAgent`）。后两处从来没记过账，而 `runPathB` 在
 * `coordinatorEnabled` 且单域角色命中时**转投 `runRolePathB` 后直接 return** ——
 * 于是本租户的**实际主路径**（`classification.model = agent:role:*`）一次都没记过账。
 *
 * live 实证：连跑两次 path-B 任务后 `GET /a/v1/llm-budgets` 的 `usedTokens` **仍为 0**；
 * 而用服务令牌直接投 `POST /a/v1/llm-budgets/record` 返 **200 且读回立刻 +1**
 * ⇒ **路由本身是健康的，是调用方漏挂**（不是账本坏了，也不是 dsh 退化 —— 两臂等受害）。
 *
 * 形态（照铁律 0.6 句式）：
 * > **「我用『记账有唯一真实写入方』当作『每一次跑都记了账』的证据，而前者并不度量后者
 * >   —— 那个『唯一』说的是写入方只有一个，不是出口只有一个。」**
 * 与本仓已登记的 `arm-indexed-disposition`（同一规则写在 N 个出口 ⇒ 谁漏写谁分裂）**同源**。
 *
 * ══ 为什么三条出口全驱动（而不是只测出问题的那一条）═════════════════════════════════
 * 只测 `runRolePathB` 的话，「收口点」这个修法本身没被验证 —— 换个出口照旧可能漏。
 * 故 §1/§2/§3 三条各自从**真 HTTP 查询**起跑到终态，逐条断言「恰记一次」。
 * 「恰」是刻意的：`≥1` 会把**重复记账**放过去，而重复记账 = 配额双扣，与漏记同样是坏东西。
 *
 * ══ 本文件**不**覆盖的面（点名，不隐去）═══════════════════════════════════════════
 * · **扇出子 run**（`engine.ts` 的 FANOUT 出口）不记账 —— ROOT 的 `total*` 不含子 run，
 *   这是**另一个问题**（是否独立记账待裁决），本单不改、登记在案，别读成「已全覆盖」。
 * · **记账失败路径**（`recordFailures`）本文件不驱动 —— 那是 `/api/v1/ops/llm-budget-stats`
 *   这个读出口要量的事，见 §4 只验它通、不验它计数（计数由 `llm-budget-seam.test.ts` 咬）。
 */
import { describe, expect, it } from "vitest";
import type { SceneEntryConfig } from "@platform/contracts";
import { ADMIN, createTestApp, lastToolCallId, submitQuery, TENANT, waitForTask, type TestApp } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { GENERAL_AGENT_KEY, seedRegistry } from "../src/mocks/seed.js";
import type { LlmBudgetPort } from "../src/ops/llm-budget.js";

/** 可观测的假账本：每次 `record` 都留痕（真账本走 HTTP，会掩盖「调用方漏挂」这一类缺陷）。 */
function fakeLedger(): LlmBudgetPort & { records: { tenantId: string; tokens: number }[] } {
  const records: { tenantId: string; tokens: number }[] = [];
  return {
    records,
    stats: { recorded: 0, recordFailures: 0, statusFailures: 0 },
    async status() {
      return undefined;
    },
    async record(tenantId: string, tokens: number) {
      records.push({ tenantId, tokens });
    },
  };
}

async function seedAgents(t: TestApp): Promise<void> {
  for (const ag of seedRegistry().agents) {
    // WO-GENERAL-AGENT-DSH：出厂通用 agent 带 `kernel:"EXTERNAL"`，而本测试环境没有 dsh harness/
    // stub provider（本文件验的是**记账**，不是内核）⇒ 不播它，走旧探索路（正是本单保留的降级支）。
    // 通用 agent 的落点/内核/目录面由 `general-agent-dsh.seam.test.ts` 覆盖。
    if (ag.key === GENERAL_AGENT_KEY) continue;
    // WO-ALL-AGENTS-DSH：出厂内核缺省自本单起对**所有** agent = `"EXTERNAL"` ⇒ 同理由钉回 `"NATIVE"`
    // （本文件验的是记账出口，内核面由本单的验收覆盖）。
    if (!(await t.repos.agents.get(ag.id))) await t.repos.agents.insert({ ...ag, kernel: "NATIVE" });
  }
}

/** 干净收尾：非占位、带范围内 ⟦ref:N⟧、无裸数（不撞别的治理层，测出来的红只可能归因到记账）。 */
function cleanFinalTurn(req: { messages: { content: unknown }[] }) {
  return {
    content: [
      toolUse("final_answer", {
        blocks: [{ type: "text", markdown: "物料库存目前处于正常水位 ⟦ref:0⟧。" }],
        provenance: [{ toolCallId: lastToolCallId(req), outputPath: "$" }],
      }),
    ],
  };
}

/** 首轮：一次真工具调用（让 run 有非零迭代），再干净收尾。 */
function scriptOnce(t: TestApp): void {
  t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
  t.llm.queueAgentTurn(
    () => ({ content: [text("先查库存。"), toolUse("query_objects", { objectType: "Material", filter: {} })] }),
    cleanFinalTurn,
  );
}

/** 任务终态 + 它唯一那条 run 记录 + 账本留痕 —— 三样一起取，避免各断言各读一次。 */
async function outcome(t: TestApp, taskId: string, ledger: ReturnType<typeof fakeLedger>) {
  const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED" || x.status === "FAILED");
  const runs = await t.repos.agentRuns.listByTask(taskId);
  return { task, runs, records: ledger.records };
}

// ===========================================================================
// §0 金丝雀 —— 报「没漏记」之前先自证这条测量接得通
// ===========================================================================
describe("§0 金丝雀 · 探针必须有鉴别力", () => {
  it("0.1 正对照：走通用 path-B（coordinator 关）⇒ 账本必须收到**非零** token", async () => {
    const ledger = fakeLedger();
    const t = await createTestApp({ llmBudget: ledger });
    await seedAgents(t);
    scriptOnce(t);
    // 不设 `agent.coordinator` ⇒ `coordinatorEnabled` 为假 ⇒ 落在通用 runPathB。
    const { taskId } = await submitQuery(t, ADMIN, "帮我看看物料库存现在什么情况", { view: "risk" });
    const { task, records } = await outcome(t, taskId, ledger);

    expect(task.status, "任务没跑到终态 ⇒ 下面读不到记账").toBe("COMPLETED");
    expect(
      ledger.records.length,
      "金丝雀不中 ⇒ 【探针没接通】（不是『没漏记』）：收口点若压根没被调用，本文件所有『恰一次』结论一律作废",
    ).toBeGreaterThan(0);
    // ★ 反向半边：记的必须是**真 token 数**，不是 0/常量 —— 否则「记了」也不度量「记对了」。
    expect(
      records[0]!.tokens,
      "记账值为 0 ⇒ 收口点取错了字段（total* 没读到），配额账本仍会恒空",
    ).toBeGreaterThan(0);
    expect(ledger.records[0]!.tenantId).toBe(TENANT);
    await t.app.close();
  });
});

// ===========================================================================
// §1 主判据 · 角色路（出问题的那条）：本次修复的对象
// ===========================================================================
describe("§1 角色路出口必须记账（本单之前：落库了但一次账都没记）", () => {
  it("1.1 单域问句 ⇒ 真走 runRolePathB ⇒ 恰记一次，且账 == 该 run 的 total* 之和", async () => {
    const ledger = fakeLedger();
    const t = await createTestApp({ llmBudget: ledger });
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]);
    await seedAgents(t);
    scriptOnce(t);
    const { taskId } = await submitQuery(t, ADMIN, "帮我看看物料库存现在什么情况", { view: "risk" });
    const { task, runs, records } = await outcome(t, taskId, ledger);

    // ★ 路由金丝雀：没走到角色路的话，本节的『恰一次』测的是**别的出口**，结论不指向本单的病。
    expect(
      task.classification?.model,
      "路由金丝雀：必须真走角色 agent（agent:role:*），否则本节测的不是 runRolePathB",
    ).toMatch(/^agent:role:/);

    expect(records.length, "角色路漏记账（本单的病灶）或重复记账（配额双扣），两者都不许").toBe(1);
    const run = runs[0]!;
    expect(
      records[0]!.tokens,
      "账 != 该 run 的 totalInput+totalOutput ⇒ 记的不是这次跑的账",
    ).toBe((run.totalInputTokens ?? 0) + (run.totalOutputTokens ?? 0));
    expect(records[0]!.tenantId).toBe(TENANT);
    await t.app.close();
  });
});

// ===========================================================================
// §2 场景入口出口（第三条 ROOT 出口）
// ===========================================================================
describe("§2 场景入口出口必须记账", () => {
  it("2.1 AGENT_ONLY 场景 ⇒ 真走 runSceneAgent ⇒ 恰记一次", async () => {
    const ledger = fakeLedger();
    const t = await createTestApp({ llmBudget: ledger });
    await seedAgents(t);
    const scene: SceneEntryConfig = {
      id: "scn_ledger_tap",
      tenantId: TENANT,
      viewKey: "risk",
      mode: "AGENT_ONLY",
      defaultAgentId: "agt_seed_analyst",
      uiHints: { placeholder: "问点什么", suggestedQuestions: [] },
    };
    await t.repos.sceneEntries.upsert(scene);
    scriptOnce(t);
    const { taskId } = await submitQuery(t, ADMIN, "帮我看看物料库存现在什么情况", { view: "risk" });
    const { task, runs, records } = await outcome(t, taskId, ledger);

    // 路由金丝雀：场景入口模式优先于阈值路由；没进这条就测不到 runSceneAgent。
    expect(
      runs.length,
      "没有 run 记录 ⇒ 场景入口路没跑起来，下面的『恰一次』不指向本节的出口",
    ).toBe(1);
    expect(task.status).toBe("COMPLETED");
    expect(records.length, "场景入口路漏记账或重复记账").toBe(1);
    expect(records[0]!.tokens).toBe(
      (runs[0]!.totalInputTokens ?? 0) + (runs[0]!.totalOutputTokens ?? 0),
    );
    await t.app.close();
  });
});

// ===========================================================================
// §3 读出口（ROLLOUT §1-a① 的观察面）
// ===========================================================================
describe("§3 记账通路健康度的读出口", () => {
  it("3.1 无令牌 401（fail-closed）· 带令牌 200 且回三个计数器原值", async () => {
    const ledger = fakeLedger();
    ledger.stats.recorded = 7;
    ledger.stats.recordFailures = 1;
    const t = await createTestApp({ llmBudget: ledger, env: { SERVICE_TOKEN: "svc-test-token" } });

    const noTok = await t.app.inject({ method: "GET", url: "/api/v1/ops/llm-budget-stats" });
    expect(noTok.statusCode, "读出口没被服务令牌守住 ⇒ 记账健康度对普通用户敞开").toBe(401);

    const ok = await t.app.inject({
      method: "GET",
      url: "/api/v1/ops/llm-budget-stats",
      headers: { "x-service-token": "svc-test-token" },
    });
    expect(ok.statusCode).toBe(200);
    // 只报原值不算比值：§1-d 的阈值随裁决变，接口里算死会把判据钉进代码。
    expect(ok.json()).toEqual({ recorded: 7, recordFailures: 1, statusFailures: 0 });
    await t.app.close();
  });
});
