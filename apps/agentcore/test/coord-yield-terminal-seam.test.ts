import { afterEach, describe, expect, it } from "vitest";
import type { QueryTask } from "@platform/contracts";
import { createTestApp, PLANNER, submitQuery, waitForTask, TENANT, type TestApp } from "./helpers.js";
import { HANG, text, toolUse } from "../src/llm/mock.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { seedRegistry } from "../src/mocks/seed.js";

/**
 * ★ WO-COORD-YIELD-AND-TERMINAL · SEAM-GATE（本单**头号**验收判据·§3.1 + §3.2）
 *
 * 由来（真 Kimi 10 题验收实测，不是推导）：
 *   #5「常州工厂 交期风险波及哪些在手单」→ 提交 19 分钟后仍 `EXECUTING_AGENT`、无 `completedAt`、
 *      token 计数早已冻结、进程 CPU 0.5% —— **它不是在慢慢算，是已经不算了，只是没人给它落终态。**
 *   #6「常州这边有哪些单要被拖累」（**同一个意思**）→ 12 秒答完（affected_orders·确定性路径）。
 *   用户视角：**换个说法就死机。**
 *
 * 两条病各对应一道门：
 *   §3.1 措辞对照门（D1 · `G-COORD-PHRASE-HIJACK`）——同一份 mock、同一个上下文，两个**同义**问句必须
 *        路由到**同一条路径**且都 COMPLETED。
 *        为什么必须是**对照测**而不是单测 A：单测 A 只能证"A 现在通了"，证不了"A 和 B 被同一套判据对待"。
 *        这个病的本质就是**同义问句被不同对待**，测不出这一点 = 没测到病。
 *   §3.2 终态门（D2 · `G-TASK-NO-TERMINAL`）——让 Coordinator 路径**永不返回**（HANG mock），越过超时阈值后
 *        任务必须**到达终态**、`completedAt` 非空、答案**说真话**（未收敛/已中止 + 已完成到哪一步）。
 *
 * §3.3 mock 失败模式：本文件同时驱动 mock 的**两种**失败形态 —— `HANG`（永不返回·§3.2）与
 *      **函数 turn 里抛异常**（中途抛异常·§3.4）。只有 happy shape 的 mock 正是这个病躲过全量测试的原因之一。
 */

/** 同义问句对（真 Kimi 验收 #5 / #6 原句·**一字不改**）。 */
const Q_A = "常州工厂 交期风险波及哪些在手单";
const Q_B = "常州这边有哪些单要被拖累";

/** 同一个上下文（对照测的另一半前提：只有措辞不同，其余全等）。 */
const CTX = { view: "risk", selectedObjects: [{ objectType: "Base", objectId: "base_changzhou", label: "常州" }] };

/** 同一份分类器 mock 响应（"同一份 mock"的字面含义：两问句拿到**逐字节相同**的分类结果）。 */
const SAME_CLASSIFICATION = {
  candidates: [{ intentKey: "affected_orders", confidence: 0.95 }],
  outOfCatalog: false,
  extractedSlots: {},
};

/** 域外分类（分类器答不出）——Coordinator 兜底门的**唯一**合法入口。 */
const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };

async function seedAgents(t: TestApp): Promise<void> {
  for (const ag of seedRegistry().agents) {
    if (!(await t.repos.agents.get(ag.id))) await t.repos.agents.insert(ag);
  }
}

/** 该任务是否进过 Coordinator 扇出（`coordinator.planned` 事件是唯一权威痕迹）。 */
async function wentThroughCoordinator(t: TestApp, taskId: string): Promise<boolean> {
  const events = await t.repos.events.listAfter(taskId, 0);
  return events.some((e) => e.event === "coordinator.planned");
}

/** 路由指纹：对照测比的就是这个三元组 —— 同义问句必须拿到**完全相同**的指纹。 */
function routeFingerprint(task: QueryTask, viaCoordinator: boolean): Record<string, unknown> {
  return {
    path: task.path,
    classifierModel: task.classification?.model,
    intentKey: task.matchedIntent?.intentKey ?? task.classification?.candidates?.[0]?.intentKey,
    viaCoordinator,
  };
}

function answerText(task: QueryTask): string {
  return (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// §3.1 · 措辞对照门（D1）
// ─────────────────────────────────────────────────────────────────────────────
describe("WO-COORD-YIELD-AND-TERMINAL §3.1 · 措辞对照门（同义问句必须被同一套判据对待）", () => {
  it("头号判据：A「交期风险波及哪些在手单」与 B「有哪些单要被拖累」→ 同一路由指纹·都 COMPLETED·都不进 Coordinator", async () => {
    const t = await createTestApp();
    // ★ 关键：把 `agent.coordinator` **打开**——病要在"开关是开的"条件下才复现（demo 租户实测两个开关都是开的）。
    //   关着测等于没测：coordinatorEnabled("ALL")=false 时这道门根本不开火。
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]);
    await seedAgents(t);

    // 同一份 mock：两问句各拿一份**逐字节相同**的分类响应。
    t.llm.queueClassification({ ...SAME_CLASSIFICATION }, { ...SAME_CLASSIFICATION });
    // 三角色 final_answer —— **修好后一条都不该被消费**；只有当 Coordinator 抢跑（= 病复发）时才会用到。
    // 备着它们是为了让变异反证的红是"路由指纹不同"这一条干净的红，而不是"A 挂死"的噪声红。
    for (let i = 0; i < 3; i++) {
      t.llm.queueAgentTurn(() => ({
        content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "角色作答（仅劫持路径会用到）。" }], provenance: [] })],
      }));
    }

    const a = await submitQuery(t, PLANNER, Q_A, CTX);
    const taskA = await waitForTask(t, a.taskId);
    const viaCoordA = await wentThroughCoordinator(t, a.taskId);

    const b = await submitQuery(t, PLANNER, Q_B, CTX);
    const taskB = await waitForTask(t, b.taskId);
    const viaCoordB = await wentThroughCoordinator(t, b.taskId);

    // ① 都到达 COMPLETED（"换个说法就死机"必须消失）。
    expect(taskA.status, `A 未 COMPLETED：${taskA.status}`).toBe("COMPLETED");
    expect(taskB.status, `B 未 COMPLETED：${taskB.status}`).toBe("COMPLETED");

    // ② **同一条路径**——本门的命门。指纹整体比对（不是逐字段分别断言），差一处就红且 diff 直接指出差在哪。
    expect(routeFingerprint(taskA, viaCoordA)).toEqual(routeFingerprint(taskB, viaCoordB));

    // ③ 两条都没被 Coordinator 抢走（分类器给得出够格意图 → Coordinator 一步都插不进来）。
    expect(viaCoordA, "A 被 Coordinator 劫持（G-COORD-PHRASE-HIJACK 复发）").toBe(false);
    expect(viaCoordB).toBe(false);
    expect(taskA.classification?.model).not.toBe("coordinator");

    // ④ 有牙：两条都真落到确定性 path-A 的 affected_orders（不是"都同样地烂"——同样进 path-B 也会让 ② 绿）。
    expect(taskA.path).toBe("WORKFLOW");
    expect(taskA.matchedIntent?.intentKey).toBe("affected_orders");
    expect(taskB.matchedIntent?.intentKey).toBe("affected_orders");

    // ⑤ 两条都**真经过了分类器**（门序证据：Coordinator 在 classify 之后 → 谁也别想绕开分类器）。
    expect(t.llm.classifyRequests.length).toBe(2);

    await t.app.close();
  });

  it("Coordinator 没被删掉·只是降级为兜底：同一问句 A + 分类器域外 → 仍会诊（关键词判据 = 必要不充分）", async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]);
    await seedAgents(t);
    // 分类器答不出（域外）→ 兜底门开 → planCoordination 命中 → 三角会诊。
    t.llm.queueClassification({ ...OUT_OF_CATALOG });
    for (let i = 0; i < 3; i++) {
      t.llm.queueAgentTurn(() => ({
        content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: `第 ${i} 个角色的结论。` }], provenance: [] })],
      }));
    }
    const { taskId } = await submitQuery(t, PLANNER, Q_A, CTX);
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.classification?.model).toBe("coordinator");
    expect(await wentThroughCoordinator(t, taskId)).toBe(true);
    // 门序仍成立：**先**问过分类器，**再**兜底会诊（不是绕开）。
    expect(t.llm.classifyRequests.length).toBe(1);
    await t.app.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3.2 · 终态门（D2）
// ─────────────────────────────────────────────────────────────────────────────
describe("WO-COORD-YIELD-AND-TERMINAL §3.2 · 终态门（EXECUTING_AGENT 必须有终态责任人）", () => {
  const ORIGINAL = process.env.QOS_TASK_TERMINAL_TIMEOUT_MS;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.QOS_TASK_TERMINAL_TIMEOUT_MS;
    else process.env.QOS_TASK_TERMINAL_TIMEOUT_MS = ORIGINAL;
  });

  it("Coordinator 扇出永不返回（HANG）→ 越过阈值后落终态·completedAt 非空·答案说真话（未收敛/已中止 + 已完成到哪一步）", async () => {
    // 把作答上限压到 300ms 越线（等价于"推进假时钟越过阈值"，但不与 waitForTask 的真定时器打架）。
    // 注意 `QOS_AGENT_LLM_TIMEOUT_MS` 保持默认 60s —— 证的是**看门狗**在兜底，不是 per-call deadline 顺手救了场。
    process.env.QOS_TASK_TERMINAL_TIMEOUT_MS = "300";
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]);
    await seedAgents(t);
    t.llm.queueClassification({ ...OUT_OF_CATALOG }); // 域外 → 兜底门开 → 三角会诊

    // 第一个角色先真答完（好让中止答案有"已完成的角色"可写·证它说的是真话不是模板），第二个角色 HANG 死。
    t.llm.queueAgentTurn(() => ({
      content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "物料存在缺口：正极粉短缺。" }], provenance: [] })],
    }));
    t.llm.queueAgentTurn(HANG, HANG, HANG, HANG);

    const started = Date.now();
    const { taskId } = await submitQuery(t, PLANNER, Q_A, CTX);
    // 修前：永久 EXECUTING_AGENT → 此处 waitForTask 超时红（正是实测那 19 分钟的缩尺复现）。
    const task = await waitForTask(t, taskId, (x) => ["COMPLETED", "FAILED", "CANCELLED"].includes(x.status), 12_000);
    const elapsed = Date.now() - started;

    // ① 到达终态 + 有界（远早于任何"等 3 分钟"的体感）。
    expect(["FAILED", "CANCELLED", "COMPLETED"]).toContain(task.status);
    expect(elapsed).toBeLessThan(10_000);

    // ② `completedAt` 非空 —— 事故现场最刺眼的那一栏。
    expect(task.completedAt, "completedAt 仍为空 = 任务没有终态责任人").toBeTruthy();

    // ③ 答案**说真话**：讲清"未收敛/已中止"，不是空串、不是笼统 INTERNAL_ERROR。
    const md = answerText(task);
    expect(md.length, "中止答案是空的").toBeGreaterThan(0);
    expect(md).toMatch(/未收敛/);
    expect(md).toMatch(/已中止/);
    expect(md).not.toMatch(/^INTERNAL_ERROR$/);

    // ④ 附上**已完成的角色/步骤**（有牙：第一个角色确实答完了，中止答案必须承认这一点）。
    expect(md).toMatch(/已完成/);
    expect(md).toContain("供应链"); // AGENT_ROLE_ORDER 首个 dispatch 已 step.completed

    // ⑤ 成因码可诊断（不是把四种失败说成同一句）。
    expect(task.error?.code).toBe("TASK_TERMINAL_TIMEOUT");

    await t.app.close();
  });

  it("看门狗是**状态机层**的，不是 Coordinator 专属：单 agent path-B 永不返回 → 同样落终态", async () => {
    process.env.QOS_TASK_TERMINAL_TIMEOUT_MS = "300";
    const t = await createTestApp(); // 默认 ALL → coordinator 关 → 走通用 path-B
    t.llm.queueClassification({ ...OUT_OF_CATALOG });
    t.llm.queueAgentTurn(HANG, HANG, HANG);

    const { taskId } = await submitQuery(t, PLANNER, "帮我把所有能查的都翻一遍再给个自由结论", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => ["COMPLETED", "FAILED", "CANCELLED"].includes(x.status), 12_000);

    expect(["FAILED", "CANCELLED", "COMPLETED"]).toContain(task.status);
    expect(task.completedAt).toBeTruthy();
    expect(answerText(task)).toMatch(/未收敛|已中止/);
    await t.app.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3.3/§3.4 · mock 的第二种失败模式：中途抛异常
// ─────────────────────────────────────────────────────────────────────────────
describe("WO-COORD-YIELD-AND-TERMINAL §3.3 · mock 失败模式②：扇出中途抛异常 → 仍到终态（不吞成永久悬挂）", () => {
  it("角色 agent 第二轮抛异常 → 任务到达终态 + completedAt 非空（异常不许把任务留在 EXECUTING_AGENT）", async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]);
    await seedAgents(t);
    t.llm.queueClassification({ ...OUT_OF_CATALOG });
    // 角色① 正常取证一轮 → 第二轮**抛异常**（mock 的函数 turn 直接 throw·非 HANG·非 happy shape）。
    t.llm.queueAgentTurn(
      () => ({ content: [text("查物料。"), toolUse("query_objects", { objectType: "Material", filter: {} })] }),
      () => {
        throw new Error("上游模型 500：中途抛异常（mock 失败模式②）");
      },
    );
    // 其余角色照常答完 —— 证"一个角色炸了"不会让整任务悬挂。
    for (let i = 0; i < 4; i++) {
      t.llm.queueAgentTurn(() => ({
        content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: `角色 ${i} 结论。` }], provenance: [] })],
      }));
    }

    const { taskId } = await submitQuery(t, PLANNER, Q_A, CTX);
    const task = await waitForTask(t, taskId, (x) => ["COMPLETED", "FAILED", "CANCELLED"].includes(x.status), 12_000);
    expect(["COMPLETED", "FAILED", "CANCELLED"]).toContain(task.status);
    expect(task.completedAt).toBeTruthy();
    await t.app.close();
  });
});
