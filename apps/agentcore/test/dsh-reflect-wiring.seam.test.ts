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

/**
 * ④ 过度触发的**真实路径探针**参数（见下方 §2）。
 *
 * 问句选「物料库存」：`ROLE_KEYWORDS` 的 supply-chain 组命中（能路由到角色 agent），
 * 而它**一个 `SOLVER_REQUIRED_RE` 触发词都不含**（该正则收的是 排产/排程/优化/最优/齐套/承诺/接单/
 * 产能…可行·缺口·穿仓/可行性 这一族）。故 ④ 若在这条上咬了，咬的只能是**引擎注入的语料**，不是用户问的话。
 */
const CLEAN_ASK = "帮我看看物料库存现在什么情况";
/** 干净收尾：非占位（不撞 ①）、带范围内 ⟦ref:0⟧（不撞 ②）、无裸数（不撞红线）。 */
const CLEAN_FINAL = "物料库存目前处于正常水位 ⟦ref:0⟧。";

function cleanFinalTurn(req: { messages: { content: unknown }[] }) {
  return {
    content: [
      toolUse("final_answer", {
        blocks: [{ type: "text", markdown: CLEAN_FINAL }],
        provenance: [{ toolCallId: lastToolCallId(req), outputPath: "$" }],
      }),
    ],
  };
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

// ===========================================================================
// §2 ④ 过度触发的真实路径探针（把「推理出来的担心」换成「测出来的事实」）
// ===========================================================================
describe("WO-DSH-REFLECT-PARITY · §2 ④ 在真实注入语料下会不会误报", () => {
  /**
   * 由来：`dsh-reflect-parity.seam.test.ts` §3 钉住的那个过度触发面，当时用的是**手搓的**导航切片样例。
   * 手搓样例只能证明「若注入语料含触发词则会咬」——**它不度量真实渲染体含不含**。
   * > **「我用『我编的样例里命中』当作『生产注入的语料里命中』的证据，而前者并不度量后者。」**
   * 本组把它换成**真路径实测**：真 HTTP → 真 orchestrator → 真 engine（真 `renderNavigationSlice`
   * + 真本体语义上下文）→ 四查，问句本身一个触发词都没有。
   *
   * 这一步是**决策输入**：`agent.critic` 默认关、开不开属产品裁决，而「开了会不会给用户屏上灌噪声」
   * 只有这条能答。
   */
  async function runClean() {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator", "agent.critic"]);
    await seedAgents(t);
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn(
      () => ({ content: [text("先查物料。"), toolUse("query_objects", { objectType: "Material", filter: {} })] }),
      cleanFinalTurn,
      cleanFinalTurn, // 若 ④ 误报且重规划一轮仍不过关，第二次收尾会走「诚实收尾」支
    );
    const { taskId } = await submitQuery(t, ADMIN, CLEAN_ASK, { view: "risk" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    return { t, task };
  }

  it("2.1 **实测：④ 在真实路径上会误报** —— 用户没问排产/优化类问题，屏上却多出一条说他在问的缺口块", async () => {
    const { t, task } = await runClean();
    // 路由金丝雀：没走到角色 agent，测的就不是注册 agent 路。
    expect(task.classification?.model, "路由金丝雀：必须真走角色 agent").toBe("agent:role:supply-chain");
    const txt = answerText(task);
    // 收尾金丝雀：模型那句必须原样在（证明走的不是某个提前降级出口）。
    expect(txt).toContain(CLEAN_FINAL);

    // ── 实测到的**真实行为**（2026-10-01 亲手跑·非推理）────────────────────────────
    // 问句 `CLEAN_ASK` 一个 SOLVER_REQUIRED_RE 触发词都没有、收尾干净利落，
    // 而答案末尾**确实**被追加了缺口块。故此处**钉住现状**而不是钉住期望：
    expect(
      txt,
      "若此处变红：④ 的判据输入已收紧（改吃用户原话），或注入语料已不含该族词 —— 属行为变更，"
        + "正是本组要逼人来看的那种变化。届时请连同 native 臂 `reflectWithCritic` 一起核。",
    ).toContain("反思发现的残余缺口");
    // 钉住的是**误报的内容**：它把用户没问过的问题当成"他在问"——
    expect(txt, "缺口块的理由说的必须是求解纪律（即 ④），不是 ①②③ 里别的查").toContain("求解纪律");
    await t.app.close();
  });

  /**
   * ⚠ 这条事实的**处置含义**（写给下一个读到它的人，省得重新推一遍）：
   *
   * `agent.critic` **默认关**，开不开是产品裁决。而本条实测给出一份**否决性输入**：
   * **以今天的 ④ 判据，开门会让正常答案的屏上多出一段说用户"在问排产/优化题"的错误陈述** ——
   * 不是"噪声/多报"那么轻：它是一句**关于用户自己所问内容的事实性错误**。
   *
   * ⇒ 建议顺序：**先让 ④ 吃「用户原话」而非拼接串，再谈开门**。
   * ⚠ 而收紧 ④ 的输入面 = 动**原生臂**既有语义（`runAgentLoop` 收的 `userContent` 是同一个拼接串）
   *   ⇒ 仍是产品裁决，不是实现细节。本单把它从"推理出来的担心"变成"测出来的两个数"，
   *   正是为了把这个裁决从"要不要"推进到"先修哪个"。
   */
});
