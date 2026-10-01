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
// 上屏标题 / 开发术语禁表 —— 与另两个 reflect 测试**共用单一来源**（各抄一份即装饰品）。
// 判据、反向哨兵、为何单独成文件，全写在 `reflect-jargon.ts` 头注。
import { DEV_JARGON, GAP_HEADER, MODEL_GAP_HEADER } from "./reflect-jargon.js";

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
/**
 * 2.2 反身金丝雀用的**真·排产类**问句：含 `齐套`（`SOLVER_REQUIRED_RE` 成员），
 * 且同样能路由到供应链角色 agent（`ROLE_KEYWORDS` supply-chain 组命中）。两条问句走同一条路、同一份脚本，
 * 差别**只在用户原话** —— 于是「一个咬一个不咬」才归因得到判据的输入面上。
 */
const SOLVER_ASK = "帮我看看物料齐套现在到底怎么样";
/** 干净收尾：非占位（不撞 ①）、带范围内 ⟦ref:0⟧（不撞 ②）、无裸数（不撞红线）。 */
const CLEAN_FINAL = "物料库存目前处于正常水位 ⟦ref:0⟧。";

// 上屏标题 / 开发术语禁表 —— 与另两个 reflect 测试**共用单一来源**（各抄一份即装饰品）。
// 判据、反向哨兵、为何单独成文件，全写在 `reflect-jargon.ts` 头注。
import { DEV_JARGON, GAP_HEADER, MODEL_GAP_HEADER } from "./reflect-jargon.js";

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
    expect(txt, "门关却出现了缺口块 ⇒ 暗发门漏了（既有行为被改变）").not.toContain(GAP_HEADER);
    await t.app.close();
  });

  it("门开（显式 agent.critic）⇒ 同一份脚本的产出**必须**多出残余缺口块（接线真通）", async () => {
    const { t, task } = await runRegisteredAgent(true);
    expect(task.classification?.model, "路由金丝雀：必须真走角色 agent").toBe("agent:role:supply-chain");
    const txt = answerText(task);
    expect(txt, "门开了却没跑复盘 ⇒ engine 没把 reflect 透传到注册 agent 路（本文件要咬的那根线）").toContain(GAP_HEADER);
    // 缺口块里写的必须是 reflectAnswer 给出的**真原因**，不是空的占位块。
    // ⚠ 断言的是 **user 一侧**的文案（上屏只许这一份）；模型一侧的「未真正作答」不许上屏，见 §3。
    expect(txt).toContain("本次没能给出有效回答");
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
   * ⚠ **本组初版有一处推断判反了，照实留在这里当教训**：初版写「`agent.critic` 默认关 ⇒ 这是将来风险」。
   *   `registry.ts` 的 `defaultOn:false` 是 **L1 平台默认**，**不度量 demo 的运行态** ——
   *   demo 经 L3 显式 override（`datacore/src/seed.ts` `DEMO_LIGHTUP` 里 `"agent.critic": true`）早已点亮，
   *   自由问答路**当天就在跑 ④**。形态：
   * > **「我用『注册表里 defaultOn:false』当作『生产上是关的』的证据，而前者并不度量后者。」**
   *   仓里甚至已有一个测试（`demo-lightup-reflect-parity.seam.test.ts` 头注）专门警告这件事，我没读到。
   */
  async function run(ask: string) {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator", "agent.critic"]);
    await seedAgents(t);
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn(
      () => ({ content: [text("先查物料。"), toolUse("query_objects", { objectType: "Material", filter: {} })] }),
      cleanFinalTurn,
      cleanFinalTurn, // 若 ④ 咬住且重规划一轮仍不过关，第二次收尾会走「诚实收尾」支
    );
    const { taskId } = await submitQuery(t, ADMIN, ask, { view: "risk" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    return { t, task };
  }
  /** 路由 + 收尾双金丝雀：没走到角色 agent、或走了某个提前降级出口 ⇒ 下面的断言测的不是本机制。 */
  function canary(task: { classification?: { model?: string }; answer?: unknown }): string {
    expect(task.classification?.model, "路由金丝雀：必须真走角色 agent").toBe("agent:role:supply-chain");
    const txt = answerText(task);
    expect(txt, "收尾金丝雀：模型那句必须原样在（否则走的是提前降级出口）").toContain(CLEAN_FINAL);
    return txt;
  }

  it("2.1 无关问句 + 干净收尾 ⇒ ④ 不许咬（**修前此处会咬**，屏上给用户加一句说他问了排产题的假话）", async () => {
    const { t, task } = await run(CLEAN_ASK);
    const txt = canary(task);
    expect(
      txt,
      "④ 在用户没问排产/优化类问题时也报了 ⇒ 判据又吃回了拼接材料（导航切片/本体语义上下文自带那族词）",
    ).not.toContain(GAP_HEADER);
    await t.app.close();
  });

  it("2.2 **反身金丝雀**：真·排产类问句 + 同样的干净收尾 ⇒ ④ **必须**咬", async () => {
    // 没有这一条，2.1 的「不咬」与「④ 被彻底关掉」在屏上完全一样（那才是把目标判据悄悄废掉）。
    // 问句含 `齐套`（SOLVER_REQUIRED_RE 成员）且能路由到供应链角色 agent。
    const { t, task } = await run(SOLVER_ASK);
    const txt = canary(task);
    expect(txt, "真排产问句却不咬 ⇒ ④ 被关掉了，不是在读用户原话").toContain(GAP_HEADER);
    // ★ 修前此处断言的是 `toContain("求解纪律")` —— 那条断言**把开发术语钉在了用户的屏上**，
    //   它本身就是本单要修的病的一部分。现在改咬 **user 一侧**的文案。
    expect(txt, "缺口块的理由必须是 ④ 求解器那条（用户可读版）").toContain("本次没有走求解器");
    // ★ 本句是 `WO-REFLECT-JARGON-SPLIT` 的**真路径**半边：④ 真咬住的时候（本句之前已证），
    //   上屏的字里**一个开发术语都不许有**。另一半（两个数组确有鉴别力）在
    //   `reflect-loop-seam.test.ts` 的单测里咬 —— 两半缺一，「没术语」与「文案根本没出来」就分不开。
    //
    // ⚠ **只扫平台追加的那一块**（自 `GAP_HEADER` 起），⛔ 不扫全文：
    //   全文里还有**模型自己写的**溯源记号 `⟦ref:N⟧` —— 那是答案正文的引用语法，本条 §1.1 已钉它必须在。
    //   本句初版扫的是全文，被 `⟦ref:0⟧` 当场咬红，形态（铁律 0.6 第 6 条同族）：
    // > 「我用『这个记号在屏上出现了』当作『模型口径的 reasons 上了屏』的证据，
    // >   而前者并不度量后者 —— 它也可能是答案正文里本来就有的溯源记号。」
    const gap = txt.slice(txt.indexOf(GAP_HEADER));
    for (const w of DEV_JARGON) {
      expect(gap, `开发术语「${w}」上了用户屏 ⇒ 模型口径的 reasons 被渲染成了答案正文`).not.toContain(w);
    }
    expect(txt, "模型口径的旧标题又上屏了").not.toContain(MODEL_GAP_HEADER);
    await t.app.close();
  });

  /**
   * ── 本组的来历（写清楚，免得下一个读者把 2.1 当成一条普通断言）────────────────────
   *
   * 2.1 最初钉的是**当时的真实行为：会误报**。根因：`reflectAnswer` 的 `userContent` 参数
   * 一个参数担了两个身份 —— 语义是「用户在问什么」，喂进去的却是 engine 拼给模型看的整段材料
   * （`baseUser + 导航切片 + 本体语义上下文 + DRIL 包`），而那批注入语料**自带** 排产/优化/
   * 产能缺口/可行性 这一族词（④ 的判据词表正是那一族）。
   *
   * ⚠ demo 租户 `agent.critic` 是**点亮的**（`datacore/src/seed.ts` `DEMO_LIGHTUP`）——
   *   故这不是将来风险，是**当时正在发生**的缺陷；`registry.ts` 的 `defaultOn:false`
   *   只是 L1 平台默认，**不度量 demo 的运行态**。
   *
   * 修法（`WO-REFLECT-INPUT-FIX`）：**修判据的输入，不改判据本身**。
   * `AgentLoopOpts.reflectUserContent` / `RunRegisteredAgentOpts.reflectUserContent` 由
   * orchestrator 传 `task.query`；缺省仍退回拼接串（字节兼容，不把「没人传」静默变成「④ 永不生效」）。
   * 调正则是打地鼠：下一个同义词立刻重演。
   *
   * 2.2 是这次修复**必须**同时加的反向金丝雀 —— 证明「不咬」是因为读了原话，不是因为 ④ 没了。
   */
});
