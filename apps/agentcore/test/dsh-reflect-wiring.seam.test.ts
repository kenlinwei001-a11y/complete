/**
 * WO-DSH-REFLECT-PARITY · **接线接缝**（SEAM-GATE：门 × 引擎两半，任一半漏即红）。
 *
 * ══ 本文件回答的问题，与 `dsh-reflect-parity.seam.test.ts` **不是同一个** ═══════════════
 * 那一份直接调 `reassembleDshRun`，证明的是「**重组装侧**拿到 `reflect` 会怎么处置」；
 * **它一个字都没说**「引擎到底有没有把 `reflect` 传下来」——
 * > **「我用『被调函数支持这个开关』当作『这个开关在生产路上被打开』的证据，而前者并不度量后者。」**
 * 本文件补的就是这一格：从 **真 HTTP 查询** 起，走真 orchestrator 求门、真 engine 透传、真 loop 复盘。
 *
 * ══ 接缝 ═══════════════════════════════════════════════════════════════════════════
 * A 侧 `reflectEnabled(enabledFeatures)`（orchestrator·暗发 `agent.critic`·defaultOn:false）
 * × B 侧 `engine.runRegisteredAgent` 把 `reflect` 透传给**注册 agent 路**的臂 →
 * 臂收尾前真跑 `agent/reflect.ts` 的确定性四查 → 不过关且重规划预算尽 ⇒ 按第二支「诚实收尾」追加残余缺口块。
 * 任一半漏即红：门没求值 / 没透传 / 臂没跑复盘。
 *
 * ⚠ 本仓此前的真实现状（本单之前）：`reflectAnswer` 只接在**自由问答**路（`runCeoFreeLLM`），
 *   `engine.ts` 全文 `reflect` 命中 **0 次** —— 注册 agent 路两条臂都没有四查。
 *
 * ══ 触发源为何选 ① 答了吗 ═══════════════════════════════════════════════════════════
 * ① 的判据（`PLACEHOLDER_RE`）**只吃答案正文**，不依赖工具是否报错、也不依赖 `⟦ref:N⟧` 范围校验
 * 会不会被别的层先拦下 ⇒ 在 mock 装置里是确定性的、不受其它机制干扰的那个触发源。
 * （用 ② 越界或 ③ 静默失败当触发源会引入「红线层/工具 mock 行为」这些额外的因，测出来的红难归因。）
 *
 * ══ 本文件**不**覆盖的面（点名，不隐去）═══════════════════════════════════════════════
 * · **dsh 臂**（`DSH_HARNESS=1` 那条）：本文件走原生臂。dsh 臂的开关行为由
 *   `dsh-reflect-parity.seam.test.ts` 在重组装层覆盖；「引擎把 reflect 传进 dsh 分叉段」这一格
 *   由 `engine.ts` 的同一条透传语句承载（与原生臂同一行区域），**未单独端到端驱动**。
 * · 场景入口 `runSceneAgent`、Coordinator 扇出 `runWorkflowSteps`：门控同源（同一个 `reflectEnabled`），
 *   未逐个端到端驱动。
 */
import { describe, expect, it } from "vitest";
import { createTestApp, submitQuery, waitForTask, lastToolCallId, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { seedRegistry } from "../src/mocks/seed.js";

/** 把 seed 注册表 agents 灌入测试 repos（helpers 默认只种 package/intents/plans）。与 coordinator-a2a 同款。 */
async function seedAgents(t: TestApp): Promise<void> {
  for (const ag of seedRegistry().agents) {
    if (!(await t.repos.agents.get(ag.id))) await t.repos.agents.insert(ag);
  }
}

/** ① 答了吗 的触发源：正文命中 `PLACEHOLDER_RE`（非空、无裸数、`⟦ref:0⟧` 在范围内 ⇒ 只可能撞 ①）。 */
const PLACEHOLDER_ANSWER = "未能产出回答 ⟦ref:0⟧";

const badFinalTurn = (req: { messages: { content: unknown }[] }) => ({
  content: [
    toolUse("final_answer", {
      blocks: [{ type: "text", markdown: PLACEHOLDER_ANSWER }],
      provenance: [{ toolCallId: lastToolCallId(req), outputPath: "$" }],
    }),
  ],
});

/**
 * 驱动一次「注册 agent 路」的运行，返回答完的那个 task。
 *
 * 路由（可复现·照 coordinator-a2a「单域物料齐套」那条）：`agent.coordinator` 开 + 分类器 outOfCatalog
 * ⇒ path-B 单域角色选择 ⇒ `runRolePathB` ⇒ `engine.runRegisteredAgent`。
 * `withCritic` 即被测的那一位（`reflectEnabled` 唯一认的键）。
 */
async function runRegisteredAgent(withCritic: boolean) {
  const t = await createTestApp();
  t.deps.features.mock.set(TENANT, [
    ...defaultOnKeys(),
    "agent.coordinator",
    ...(withCritic ? ["agent.critic"] : []),
  ]);
  await seedAgents(t);
  t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
  t.llm.queueAgentTurn(
    () => ({ content: [text("先查物料。"), toolUse("query_objects", { objectType: "Material", filter: {} })] }),
    // 第 1 次收尾：不过关 ⇒ 原生路第一支「回注 reasons + 有界重规划一轮」
    badFinalTurn,
    // 第 2 次收尾：不过关且 replan 预算已尽 ⇒ 第二支「诚实收尾」（追加残余缺口块）
    badFinalTurn,
  );
  const { taskId } = await submitQuery(t, ADMIN, "帮我看看物料齐套现在到底怎么样", { view: "risk" });
  const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
  return { t, task };
}

/** task.answer 里所有 text 块拼起来（正文全文）。 */
function answerText(task: { answer?: unknown }): string {
  const blocks = (task.answer as { blocks?: { type: string; markdown?: string }[] } | undefined)?.blocks ?? [];
  return blocks.filter((b) => b.type === "text").map((b) => b.markdown ?? "").join("\n");
}

describe("WO-DSH-REFLECT-PARITY · 接线 SEAM：orchestrator 求门 × engine 透传 × 注册 agent 路真跑复盘", () => {
  it("门关（无 agent.critic）⇒ 答案逐字节不变：只有模型自己那句，没有平台追加的缺口块", async () => {
    const { t, task } = await runRegisteredAgent(false);
    // 路由金丝雀：没走到注册 agent 路的话，下面的断言测的就是别的路（本条会先红）。
    expect(task.classification?.model, "路由金丝雀：必须真走角色 agent，否则本文件测的不是注册 agent 路").toBe("agent:role:supply-chain");
    const txt = answerText(task);
    expect(txt).toContain(PLACEHOLDER_ANSWER);
    expect(txt, "门关却出现了残余缺口块 ⇒ 暗发门漏了（既有行为被改变）").not.toContain("反思发现的残余缺口");
    await t.app.close();
  });

  it("门开（显式 agent.critic）⇒ 同一份脚本的产出**必须**多出残余缺口块（接线真通）", async () => {
    const { t, task } = await runRegisteredAgent(true);
    expect(task.classification?.model, "路由金丝雀：必须真走角色 agent").toBe("agent:role:supply-chain");
    const txt = answerText(task);
    expect(txt, "门开了却没跑复盘 ⇒ engine 没把 reflect 透传到注册 agent 路（本文件要咬的那根线）").toContain("反思发现的残余缺口");
    // 缺口块里写的必须是 reflectAnswer 给出的**真原因**，不是空的占位块。
    expect(txt).toContain("未真正作答");
    await t.app.close();
  });
});
