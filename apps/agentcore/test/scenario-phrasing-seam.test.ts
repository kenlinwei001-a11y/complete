import { describe, expect, it } from "vitest";
import { createTestApp, ADMIN, TENANT, submitQuery, waitForTask, type TestApp } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { seedRegistry } from "../src/mocks/seed.js";
import { phrasingGoldset, scenariosMissingVariants, type PhrasingCase } from "./fixtures/scenario-phrasing-goldset.js";

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

/** 生产 demo 租户真实功能集 = 模板默认开 ∪ datacore seed.ts `seedDemoEntitlements` 的 9 条显式点亮。 */
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
    const r = await narrationOn("常州这批订单的交付风险怎么解", "risk", { outOfCatalog: false });
    expect(r.model).toBe("coordinator"); // 证真的走了多角色路径
    expect(r.agentRoundTrips, "实验组角色 agent 没跑起来 → 「0 条旁白」是没跑不是没接线，用例无效").toBeGreaterThan(0);
    expect(r.narrations, "多角色路径上旁白一条都没发（E9）").toBeGreaterThan(0);
  }, 60_000);
});
