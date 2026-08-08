import { describe, expect, it } from "vitest";
import { createTestApp, ADMIN, TENANT, submitQuery, waitForTask, type TestApp } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { seedRegistry } from "../src/mocks/seed.js";
import { exploratoryGoldset, phrasingGoldset, scenariosMissingVariants, type PhrasingCase } from "./fixtures/scenario-phrasing-goldset.js";

/**
 * WO-ROUTING-RETRIEVAL-FIRST · 场景启动器**措辞鲁棒性**接缝门。
 *
 * 治的病：出厂 20 场景的注册例句只覆盖了一种措辞。用户换个说法（多说一个基地、把「接」说成
 * 「交付」、把「常州」说成「常州工厂」）就被分类器**之前**的 10 道正则门抢答，掉出确定性通道 →
 * 多角色会诊/自由探索烧几分钟无答案（仓主实测 203 s）。
 *
 * 判据（刻意最严）：**落到的意图 key 必须等于该场景注册的 intentKey**。
 * 「没被 coordinator 接走」不够 —— 绑到另一个能跑完的意图同样是错答，只是错得不显眼。
 *
 * 语义层设为**理想态**：分类器 mock 恒返回该场景的正确意图 @0.95。故本门只检一件事——
 * **确定性前置路由有没有在语义层开口之前就把题抢走并抢错**。这正是仓主那句话的病灶。
 */

/**
 * 生产 demo 租户真实功能集 = 模板默认开 ∪ datacore seed.ts `DEMO_LIGHTUP` 的 14 条显式点亮
 * （WO-DEMO-LIGHTUP-2 从 9 → 14；`dc.lazy-solver-context` 是 DataCore 侧性能门·AgentCore 不注册，
 * 故此镜像只列 13 条 QOS 侧的键）。**镜像一改，本门就换了考卷** —— 这正是它的用途：
 * 新点亮的路由门若会抢答，必须在这里当场露出来，而不是等部署态。
 */
const DEMO_PROD_FEATURES = [
  ...defaultOnKeys(),
  "qos.dril-routing",
  "agent.critic",
  "ceo.free-llm",
  "agent.coordinator",
  "qos.compose-path",
  "qos.reasoning-trace",
  "agent.escalation",
  "qos.deterministic-multi-domain",
  "qos.multi-intent-l3-coupled",
  // WO-DEMO-LIGHTUP-2 新点亮（qos.llm-budget-enforce 刻意不列·见 seed.ts 旁注）
  "agent.skill-on-free-qa",
  "qos.multi-intent-l2-decompose",
  "qos.multi-intent-orchestration",
  "qos.opt-whatif-route",
];

interface Outcome {
  c: PhrasingCase;
  routedIntent: string;
  model: string;
  status: string;
  ok: boolean;
}

async function routeOne(c: PhrasingCase): Promise<Outcome> {
  const t: TestApp = await createTestApp();
  t.deps.features.mock.set(TENANT, DEMO_PROD_FEATURES);
  for (const ag of seedRegistry().agents) if (!(await t.repos.agents.get(ag.id))) await t.repos.agents.insert(ag);
  // 语义层理想态：分类器恒判对（本门不考核 LLM，只考核它前面那 10 道门有没有抢答抢错）。
  t.llm.queueClassification({
    candidates: [{ intentKey: c.expectIntent, confidence: 0.95 }],
    outOfCatalog: false,
    extractedSlots: {},
  });
  for (let i = 0; i < 10; i++) {
    t.llm.queueAgentTurn({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "结论。" }], provenance: [] })] });
  }
  const r = await submitQuery(t, ADMIN, c.query, { view: c.view });
  let routedIntent = "(未绑定)";
  let model = "(无)";
  let status = "(无)";
  try {
    const task = await waitForTask(
      t,
      r.taskId,
      (x) => ["COMPLETED", "FAILED", "AWAITING_CLARIFICATION", "CANCELLED"].includes(x.status),
      20000,
    );
    routedIntent = task.classification?.candidates?.[0]?.intentKey ?? "(未绑定)";
    model = task.classification?.model ?? "(无)";
    status = task.status;
  } catch {
    status = "TIMEOUT";
  }
  await t.app.close();
  return { c, routedIntent, model, status, ok: routedIntent === c.expectIntent };
}

describe("场景启动器 · 措辞鲁棒性接缝门（20 场景 × 4 种说法）", () => {
  it("① 金标集完备：每个出厂场景都必须配齐 3 条变体（新增场景漏配 → 红）", () => {
    expect(scenariosMissingVariants()).toEqual([]);
    expect(phrasingGoldset().length).toBe(80);
  });

  it("② 效果层：80 条说法**全部**落到各自注册的 intentKey", async () => {
    const results: Outcome[] = [];
    for (const c of phrasingGoldset()) results.push(await routeOne(c));

    const bad = results.filter((r) => !r.ok);
    const byKind = (k: string) => results.filter((r) => r.c.kind === k);
    const rate = (k: string) => {
      const g = byKind(k);
      return `${g.filter((r) => r.ok).length}/${g.length}`;
    };
    // eslint-disable-next-line no-console
    console.log(
      `\n  ── 措辞鲁棒性基线 ──\n` +
        `  原句            ${rate("ORIGINAL")}\n` +
        `  V1 加实体词     ${rate("V1_ENTITY")}\n` +
        `  V2 实体词变形   ${rate("V2_ENTITY_VARIANT")}\n` +
        `  V3 句式动词变形 ${rate("V3_PHRASING")}\n` +
        `  合计            ${results.filter((r) => r.ok).length}/${results.length}\n` +
        (bad.length
          ? `\n  ── 未落到注册意图的 ${bad.length} 条 ──\n` +
            bad
              .map((r) => `  ${r.c.sNo} ${r.c.kind.padEnd(18)} 期望=${r.c.expectIntent.padEnd(22)} 实到=${r.routedIntent.padEnd(22)} model=${r.model} status=${r.status}\n    「${r.c.query}」`)
              .join("\n")
          : ""),
    );

    expect(bad.map((r) => `${r.sNo ?? r.c.sNo}/${r.c.kind}: ${r.c.query} → ${r.routedIntent}`)).toEqual([]);
  }, 600_000);
});

/**
 * 第三类 · **过程可见（流式旁白）** —— 仓主追问「前端流模式展示是否被遗漏」。
 *
 * 是，此前遗漏了：E9（多角色路径旁白结构性不可达）是用一次性探针证的，探针跑完即删，
 * **没有留下常驻的门** → 等于把刚查实的病放回野外。本节把它固化。
 *
 * 判据（工单里的通用门）：**凡经 feature flag 点亮的能力，须断言它在「每条会走到它的路径上」
 * 都真生效**，而非只在主路径上测一次。#90（Skill 对默认路径不可达）、#92（配额账本零调用方）、
 * E9（旁白对多角色路径不可达）是同一族——声明了 → 点亮了 → 这条路径上没接线。
 *
 * 两组用同一份 LLM 脚本（每轮自由文本 + 非 final_answer 工具调用 → 三个发送条件全满足），
 * 唯一差别是走哪条路。**前置断言：两组都必须真的跑起了 agent 往返**——否则「0 条旁白」
 * 是"没跑"而不是"没接线"（我第一版探针正是栽在这里，结论作废）。
 */
describe("场景启动器 · 过程可见接缝门（旁白须在每条 agent 路径上都到达）", () => {
  const NARRATION_FEATURES = [...DEMO_PROD_FEATURES];

  async function narrationOn(
    query: string,
    view: string,
    opts: { outOfCatalog: boolean },
  ): Promise<{ narrations: number; agentRoundTrips: number; model: string }> {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, NARRATION_FEATURES);
    for (const ag of seedRegistry().agents) if (!(await t.repos.agents.get(ag.id))) await t.repos.agents.insert(ag);
    if (opts.outOfCatalog) t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    for (let i = 0; i < 12; i++) {
      t.llm.queueAgentTurn({ content: [text(`第${i + 1}轮：先查一下再说。`), toolUse("discover", { kind: "solvers" })] });
      t.llm.queueAgentTurn({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "结论。" }], provenance: [] })] });
    }
    const r = await submitQuery(t, ADMIN, query, { view });
    const task = await waitForTask(t, r.taskId, (x) => ["COMPLETED", "FAILED", "AWAITING_CLARIFICATION"].includes(x.status), 25000);
    const events = await t.repos.events.listAfter(r.taskId, 0);
    const out = {
      narrations: events.filter((e) => (e.payload as { type?: string } | undefined)?.type === "agent_narration").length,
      agentRoundTrips: t.llm.agentRequests.length,
      model: task.classification?.model ?? "(无)",
    };
    await t.app.close();
    return out;
  }

  it("① 单 agent 探索路径（path-B）：旁白到达（对照组·证机制本身是通的）", async () => {
    const r = await narrationOn("给我一个自由的深度结论", "dash", { outOfCatalog: true });
    expect(r.agentRoundTrips, "对照组 agent 没跑起来 → 本用例无效").toBeGreaterThan(0);
    expect(r.narrations).toBeGreaterThan(0);
  }, 60_000);

  it("② 多角色 Coordinator 扇出：旁白**同样**必须到达（E9·今天红）", async () => {
    // ★ WO-COORD-YIELD-AND-TERMINAL D1（门序变更）：Coordinator 已从 classify **之前**移到之后，
    //   只在「分类器答不出」时兜底 → 此处由 `outOfCatalog:false`（不喂分类响应）改为 `true`（喂一份域外分类），
    //   让本用例仍能合法走到多角色路径。本用例咬的是「旁白在多角色路径上到不到得了」（E9），
    //   与"Coordinator 何时被叫来"无关 —— 下面三条断言一字未动。
    const r = await narrationOn("常州这批订单的交付风险怎么解", "risk", { outOfCatalog: true });
    expect(r.model).toBe("coordinator"); // 证真的走了多角色路径
    expect(r.agentRoundTrips, "实验组角色 agent 没跑起来 → 「0 条旁白」是没跑不是没接线，用例无效").toBeGreaterThan(0);
    expect(r.narrations, "多角色路径上旁白一条都没发（E9）").toBeGreaterThan(0);
  }, 60_000);
});

/**
 * 第二类 · **探索型推演**（仓主指正：不能只测意图命中型）。
 *
 * 为什么必须有：仓主实测出事的那 203 s 走的正是**探索**路径。只断言「落到注册意图」的门
 * 永远不会跑到探索路径上去 —— 于是探索段的病在全绿测试集下依然存在。
 *
 * 这些题本体内**确实没有对口意图**（真开放）。期望行为不是"命中"，而是四条同时成立：
 *   ① 进得去探索：path=AGENT —— **没被正则门劫持成某个窄意图**（那是自信错答，比慢更糟）
 *   ② 出得来：COMPLETED 且 **未降级**（无 agent_degraded / TIMEOUT）
 *   ③ 真探索了：**至少调过一个非 final_answer 的工具** —— 零工具直接作答 = 从无到有编
 *   ④ 有出处：answer 非占位（不含"未能产出回答/探索模式未能"）且 provenance 非空
 *
 * **门自证（本门自己被验过·诚实边界）**：把脚本的取证轮拿掉（agent 零工具直接作答）→ 本门 16/16 掉到
 * **12/16**，红的恰好是 E01 那 4 条。即：④ 的牙**只对 agent-loop 那条路有效**；E02–E04 走零 LLM
 * 组合路径（qos.compose-path），provenance 由引擎从真实求解器结果自建，与 agent 有没有引用无关，
 * 那 12 条恒真。**别把本门当成"全域可测出无出处作答"** —— 它只覆盖 agent 自由多跳这一半。
 *
 * 建门过程五版才成（如实留档，供后来者少走）：v1 三条断言错两条（把零 LLM 组合路径误判成"零工具调用"）；
 * v2 脚本 3 轮/循环撞 maxRoundTrips；v3 压到 2 轮仍红；v4 查出真因是我手塞的 provenance 形状非法
 * （契约要 {toolCallId,outputPath}）→ final_answer 被拒 → 循环烧到 maxDiscoverCalls；
 * v5 改函数式 turn 从请求取真 toolCallId 才通。**前四版的红全是门自己的病，一条都不是系统的。**
 */
describe("场景启动器 · 探索型推演接缝门（16 条真开放题）", () => {
  it("四条判据同时成立：进得去 · 出得来 · 真探索 · 有出处", async () => {
    const bad: string[] = [];
    for (const c of exploratoryGoldset()) {
      const t: TestApp = await createTestApp();
      t.deps.features.mock.set(TENANT, DEMO_PROD_FEATURES);
      for (const ag of seedRegistry().agents) if (!(await t.repos.agents.get(ag.id))) await t.repos.agents.insert(ag);
      // 真开放题：分类器诚实报 outOfCatalog（本体内无对口意图）。
      t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
      // agent 脚本：先真取证两轮（非 final_answer 工具），再带 provenance 收尾。
      // v3：脚本压到**最小可能开销**（1 次工具 → 立即收尾），把「我的脚本烧掉几轮」这个变量摘出去。
      // v2 用 3 轮/循环，撞上 maxRoundTrips=3 → 分不清是系统答不出还是我的脚本太贵。
      // 现在每个 agent 最少 2 轮即可收尾；若仍报"预算耗尽"，那就是**系统在生产功能集下真的探不动**。
      for (let i = 0; i < 12; i++) {
        t.llm.queueAgentTurn({ content: [text("查一下对口能力。"), toolUse("discover", { kind: "solvers" })] });
        // final_answer 的 provenance 契约（registry.ts:467-473）必填 {toolCallId, outputPath}，
        // 而 toolCallId 是运行时生成的 —— 故用**函数式 turn**（mock.ts:27 支持 (req)=>TurnBody）
        // 从请求里取上一次真实的 tool_use id。这样脚本模拟的是一个**规矩引用出处的 agent**，
        // 断言 ④ 才是在考核「工具结果→答案 provenance」这条链是否真通，而不是考核我自己填了什么。
        t.llm.queueAgentTurn((req) => {
          let lastToolCallId = "";
          for (const m of (req as unknown as { messages?: { content?: unknown }[] }).messages ?? []) {
            const blocks = Array.isArray(m.content) ? (m.content as { type?: string; id?: string }[]) : [];
            for (const b of blocks) if (b.type === "tool_use" && b.id) lastToolCallId = b.id;
          }
          return {
            content: [
              toolUse("final_answer", {
                blocks: [{ type: "text", markdown: "综合结论 ⟦ref:0⟧。" }],
                provenance: lastToolCallId ? [{ toolCallId: lastToolCallId, outputPath: "$" }] : [],
              }),
            ],
          };
        });
      }
      const r = await submitQuery(t, ADMIN, c.query, { view: c.view });
      const task = await waitForTask(t, r.taskId, (x) => ["COMPLETED", "FAILED", "AWAITING_CLARIFICATION"].includes(x.status), 25000);
      const events = await t.repos.events.listAfter(r.taskId, 0);
      const md = JSON.stringify(task.answer ?? {});
      // 判据修正（首版三条里两条是我自己的断言错，已按真相重写）：
      //  · 「真探索了」不能靠数 agent 往返或扫事件名——零 LLM 组合路径（qos.compose-path）
      //    同样真调求解器、只是不产生 agent 轮次。**provenance 非空即是"真取过证"的充要证据**，
      //    故 ③④ 合并为一条：provenance 有条目 ⇒ 数字有出处且确实调过工具。
      //  · 「降级」不扫全部事件载荷（会误命中），只认答案里的诚实降级前缀 —— 那是引擎自己的定式措辞。
      const prov = ((task.answer ?? {}) as { provenance?: unknown[] }).provenance ?? [];
      const fail: string[] = [];
      if (task.path !== "AGENT") fail.push(`①未进探索 path=${task.path} model=${task.classification?.model}`);
      if (task.status !== "COMPLETED") fail.push(`②未完成 status=${task.status}`);
      if (/预算耗尽|已达最大探索轮次|单次调用超出有界时限|探索超时/.test(md)) fail.push("②有界终止降级");
      if (/未能产出回答|探索模式未能|未形成最终结论|未能完全解答/.test(md)) fail.push("③占位/未解答");
      if (prov.length === 0) fail.push("④provenance 空（数字无出处·未真取证）");
      if (fail.length) bad.push(`  ${c.eNo} ${c.kind.padEnd(18)} ${fail.join(" · ")}\n    「${c.query}」`);
      await t.app.close();
    }
    // eslint-disable-next-line no-console
    console.log(`\n  ── 探索型基线 ${16 - bad.length}/16 ──\n${bad.join("\n") || "  （全绿）"}\n`);
    expect(bad).toEqual([]);
  }, 600_000);
});
