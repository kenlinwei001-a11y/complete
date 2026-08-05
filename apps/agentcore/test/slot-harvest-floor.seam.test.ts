import { describe, expect, it } from "vitest";
import type { ObjectRef, QueryTask } from "@platform/contracts";
import { OpenAICompatAdapter } from "@platform/llm-adapters";
import type { LlmAgentRequest, LlmAgentResponse, LlmCapabilities, RawClassification } from "@platform/llm-adapters";
import { createTestApp, ADMIN, TENANT, submitQuery, waitForTask, type TestApp } from "./helpers.js";
import { ScriptedLlmClient, toolUse } from "../src/llm/mock.js";
import type { LlmClient } from "../src/llm/types.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { deterministicSlotFloor, mergeSlotFloor } from "../src/router/l2-decompose.js";

/**
 * ★ WO-SLOT-HARVEST §3.2 · **接线半 SEAM-GATE**：槽位从问句到 fillSlots 的完整通路。
 *
 * 治的病（真 Kimi k2.5 端到端 10 题只过 3 题）——两条根因，本门两半都咬：
 *  A（解析层）：Kimi 把槽写进 `candidates[0].extractedSlots`，被窄 zod schema 删掉、再被 `?? {}`
 *    报成「模型没给槽」→ `extractedSlots={}`。同一道题连跑 5 次，5 次全抽对了，只有 2 次进得了系统。
 *  B（架构层·铁律 0.5 第三形态「接了线接错地方」）：确定性抽取器 `buildSlotBag` **早就有**，
 *    但唯一 src 调用方是 `tryL2Decompose`；主链路 `classify → fillSlots` **没有任何东西在看问句文本**。
 *    于是一次 LLM 格式抖动就能决定用户拿不拿得到答案 —— 而那句话里明明白白写着「常州」，
 *    `risk_root_cause` 的必填槽也只有 `base` 一个。
 *
 * ⚠ 断言落点（刻意）：**终态 `COMPLETED` + `clarificationRounds===0`**，**不是 routedIntent**。
 *    上一轮 10 题里 7 个失败**全部 routed 正确** —— 断言落在路由 = 假绿（本仓已经栽过一次）。
 *
 * 变异反证（须真跑·两条都必红）：
 *  ① `packages/llm-adapters/src/slot-harvest.ts` 的收割器改回只读顶层 → ② 全链条转红（这是解析半）。
 *  ② `deterministicSlotFloor` 拆掉（直接 `return {}`）→ ①③ 转 AWAITING_CLARIFICATION（这是接线半）。
 */

const DEMO_PROD_FEATURES = [...defaultOnKeys(), "qos.dril-routing", "agent.critic", "agent.coordinator", "qos.compose-path"];

/** 仓主实测原句（10 题里失败最多的一条）。`risk_root_cause` 必填槽只有 base，问句里写着「常州」。 */
const QUERY = "常州物料齐套 D+5 为什么越线？";

/**
 * §3.3 · **mock 必须有失败模式**：本桩把**原始报文**喂进真 OpenAI 兼容适配器，
 * 于是能返回「candidate 内嵌形态」「空槽形态」「顶层 JSON 串形态」等真实坏骰子 ——
 *「mock 只会成功」正是这个病躲过全部 2600+ 条测试的原因之一。
 */
function rawBodyStub(body: string) {
  return {
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content: body } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
      },
    },
  };
}

/** 真适配器（classify 走 raw → 收割器）× 脚本 mock（agent/compose）——全链条 SEAM 的 LLM 端。 */
class RawBodyLlmClient implements LlmClient {
  readonly scripted = new ScriptedLlmClient();
  private readonly adapter: OpenAICompatAdapter;
  constructor(body: string) {
    this.adapter = new OpenAICompatAdapter({ client: rawBodyStub(body) as never });
  }
  classify(req: { model: string; system: string; user: string }): Promise<RawClassification> {
    return this.adapter.classify(req);
  }
  agent(req: LlmAgentRequest): Promise<LlmAgentResponse> {
    return this.scripted.agent(req);
  }
  compose(req: { model: string; instruction: string; inputs: unknown[] }): Promise<string> {
    return this.scripted.compose(req);
  }
  capabilities(): Promise<LlmCapabilities> {
    return this.scripted.capabilities();
  }
  countTokens(req: LlmAgentRequest): Promise<number> {
    return this.scripted.countTokens(req);
  }
}

function queueAnswers(scripted: ScriptedLlmClient): void {
  for (let i = 0; i < 8; i++) {
    scripted.queueAgentTurn({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "结论。" }], provenance: [] })] });
  }
}

interface Outcome {
  status: string;
  rounds: number;
  slots: Record<string, unknown>;
  extractedSlots: Record<string, unknown>;
  pending: QueryTask["pendingClarification"];
}

async function outcomeOf(t: TestApp, taskId: string): Promise<Outcome> {
  let task: QueryTask | undefined;
  try {
    task = await waitForTask(t, taskId, (x) => ["COMPLETED", "FAILED", "AWAITING_CLARIFICATION", "CANCELLED"].includes(x.status), 25000);
  } catch {
    /* 超时 → status 留 TIMEOUT，断言会红并打出来 */
  }
  return {
    status: task?.status ?? "TIMEOUT",
    rounds: task?.clarificationRounds ?? -1,
    slots: task?.slots ?? {},
    extractedSlots: task?.classification?.extractedSlots ?? {},
    pending: task?.pendingClarification,
  };
}

/** ① 坏骰子：分类器把槽全丢了（extractedSlots={}）+ 无任何上下文兜底 → 底座必须接住。 */
describe("WO-SLOT-HARVEST §3.2① · 分类器交白卷（extractedSlots={}）+ selectedObjects=[] → 仍 COMPLETED 且零反问", () => {
  it("终态 COMPLETED · clarificationRounds=0 · base 槽由**问句文本**确定性抽出并解析成对象引用", async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, DEMO_PROD_FEATURES);
    // 空槽形态（真 Kimi 的坏骰子：路由对了，槽位一个都没交出来）
    t.llm.queueClassification({
      candidates: [{ intentKey: "risk_root_cause", confidence: 0.95 }],
      outOfCatalog: false,
      extractedSlots: {},
    });
    queueAnswers(t.llm);

    const r = await submitQuery(t, ADMIN, QUERY, { view: "risk", selectedObjects: [] });
    const o = await outcomeOf(t, r.taskId);
    await t.app.close();

    console.log(
      `\n  ── §3.2① 确定性底座（LLM 交白卷）──\n  status=${o.status} rounds=${o.rounds} ` +
        `extractedSlots=${JSON.stringify(o.extractedSlots)} slots.base=${JSON.stringify(o.slots.base)}` +
        (o.pending ? ` pending=${JSON.stringify(o.pending.slots?.map((s) => s.name))}` : ""),
    );

    // ★ 断在终态，不在 routedIntent（路由对了但反问 = 用户拿不到答案）
    expect(`${o.status}/rounds=${o.rounds}`).toBe("COMPLETED/rounds=0");
    const base = o.slots.base as ObjectRef | undefined;
    expect(typeof base, `base 槽应是解析后的对象引用（实得 ${JSON.stringify(base)}）`).toBe("object");
    expect(base?.objectType).toBe("Base");
    expect(String(base?.objectId)).toContain("changzhou");
  }, 120_000);
});

/**
 * ② 全链条（解析半 × 接线半同一条链）：**真 Kimi 原样报文**（run2 形态：```json 围栏 + candidate 内嵌
 * extractedSlots + 额外 reason 字段）→ 真 OpenAI 兼容适配器 → 收割器 → 底座 → fillSlots → 终态。
 * 这条同时咬两半：收割器坏 → extractedSlots 断言红；底座坏 → 终态断言红。
 */
describe("WO-SLOT-HARVEST §3.2② · 真 Kimi 报文（candidate 内嵌形态）穿过真适配器 → COMPLETED 且零反问", () => {
  it("classification.extractedSlots 拿到 base=常州/day=D+5（收割器交的货）且终态 COMPLETED·rounds=0", async () => {
    const body =
      "```json\n" +
      `{"outOfCatalog":false,"candidates":[{"intentKey":"risk_root_cause","confidence":0.9,"extractedSlots":{"base":"常州","day":"D+5"},"reason":"用户询问特定基地（常州）在指定日期（D+5）风险越线的根因，完全匹配 risk_root_cause 意图的触发场景"}]}` +
      "\n```";
    const llm = new RawBodyLlmClient(body);
    queueAnswers(llm.scripted);
    const t = await createTestApp({ llm });
    t.deps.features.mock.set(TENANT, DEMO_PROD_FEATURES);

    const r = await submitQuery(t, ADMIN, QUERY, { view: "risk", selectedObjects: [] });
    const o = await outcomeOf(t, r.taskId);
    await t.app.close();

    console.log(
      `\n  ── §3.2② 全链条（真报文 → 收割器 → 底座 → fillSlots）──\n  status=${o.status} rounds=${o.rounds} ` +
        `extractedSlots=${JSON.stringify(o.extractedSlots)} slots.base=${JSON.stringify(o.slots.base)}`,
    );

    // 收割器真跑过（不是底座代劳）：槽位是从 candidate 内嵌位置收上来的
    expect(o.extractedSlots.base, "candidate 内嵌槽位必须被收割到 classification 上").toBe("常州");
    expect(o.extractedSlots.day).toBe("D+5");
    expect(`${o.status}/rounds=${o.rounds}`).toBe("COMPLETED/rounds=0");
  }, 120_000);
});

/** ③ 冲突时 LLM 赢（底座只填空白·不是覆盖）：问句写常州、LLM 说厦门 → 槽位必须是厦门。 */
describe("WO-SLOT-HARVEST §3.2③ · 底座只填空白，冲突时 LLM 赢（它有语义）", () => {
  it("问句含「常州」但 LLM 抽出 base=厦门 → slots.base 解析成厦门（底座不许覆盖 LLM）", async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, DEMO_PROD_FEATURES);
    t.llm.queueClassification({
      candidates: [{ intentKey: "risk_root_cause", confidence: 0.95 }],
      outOfCatalog: false,
      extractedSlots: { base: "厦门" },
    });
    queueAnswers(t.llm);

    const r = await submitQuery(t, ADMIN, QUERY, { view: "risk", selectedObjects: [] });
    const o = await outcomeOf(t, r.taskId);
    await t.app.close();

    expect(`${o.status}/rounds=${o.rounds}`).toBe("COMPLETED/rounds=0");
    expect(String((o.slots.base as ObjectRef | undefined)?.objectId)).toContain("xiamen");
  }, 120_000);
});

/** ④ 诚实：问句里**没有**基地 + LLM 交白卷 → 底座不许推断/默认，照旧反问。 */
describe("WO-SLOT-HARVEST §3.2④ · 底座只抽问句里真有的：抽不到就诚实反问（不推断·不默认）", () => {
  it("「为什么越线？」无基地无上下文 → 仍 AWAITING_CLARIFICATION（底座不许凭空造一个基地）", async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, DEMO_PROD_FEATURES);
    t.llm.queueClassification({
      candidates: [{ intentKey: "risk_root_cause", confidence: 0.95 }],
      outOfCatalog: false,
      extractedSlots: {},
    });
    queueAnswers(t.llm);

    const r = await submitQuery(t, ADMIN, "为什么越线？", { view: "risk", selectedObjects: [] });
    const o = await outcomeOf(t, r.taskId);
    await t.app.close();

    expect(o.status).toBe("AWAITING_CLARIFICATION");
    expect(o.pending?.slots?.map((s) => s.name)).toContain("base");
  }, 120_000);
});

/** ⑤ 底座本体的纯函数直测（R6：确定性·由意图声明的槽位驱动·不读时钟/随机/LLM）。 */
describe("WO-SLOT-HARVEST §3.2⑤ · 确定性底座纯函数直测（零数据依赖·不许靠数据巧合变绿）", () => {
  const riskIntent = {
    slots: [
      { name: "base", type: "objectRef" as const, required: true, refType: "Base", description: "基地" },
      { name: "day", type: "date" as const, required: false, description: "日期" },
    ],
  };
  const capacityIntent = {
    slots: [
      { name: "model", type: "objectRef" as const, required: true, refType: "Model", description: "型号" },
      { name: "demandDelta", type: "number" as const, required: false, description: "需求增量" },
      { name: "weeks", type: "number" as const, required: false, description: "周数" },
    ],
  };

  it("由**意图声明的槽位**驱动（不是固定键袋）：同一句话，两个意图抽出不同的槽", () => {
    expect(deterministicSlotFloor(QUERY, riskIntent)).toEqual({ base: "changzhou", day: "D+5" });
    expect(deterministicSlotFloor("4680-NCM 加 20% 六周能不能交付？", capacityIntent)).toEqual({
      model: "4680-NCM",
      demandDelta: 0.2,
      weeks: 6,
    });
    // 意图没声明的槽一律不抽（底座不越权）
    expect(deterministicSlotFloor(QUERY, capacityIntent)).toEqual({});
  });

  it("只抽问句里真有的：抽不到就不出现（不是填 null·不推断·不默认）", () => {
    expect(deterministicSlotFloor("为什么越线？", riskIntent)).toEqual({});
    expect(deterministicSlotFloor("", riskIntent)).toEqual({});
  });

  it("日期只取**字面**形态（D±N / 相对时间词），归结交给 fillSlots 的 resolveRelativeDate", () => {
    expect(deterministicSlotFloor("常州 D+5 越线", riskIntent).day).toBe("D+5");
    expect(deterministicSlotFloor("常州 D-3 越线", riskIntent).day).toBe("D-3");
    expect(deterministicSlotFloor("常州下周越线吗", riskIntent).day).toBe("下周");
    expect(deterministicSlotFloor("常州为什么越线", riskIntent).day).toBeUndefined();
  });

  it("R6 确定性：同输入重跑逐字节一致（无时钟/随机）", () => {
    expect(JSON.stringify(deterministicSlotFloor(QUERY, riskIntent))).toBe(JSON.stringify(deterministicSlotFloor(QUERY, riskIntent)));
  });

  it("mergeSlotFloor：底座填空白 · LLM 非空值赢 · LLM 的空值不许把底座顶掉", () => {
    expect(mergeSlotFloor({ base: "changzhou", day: "D+5" }, {})).toEqual({ base: "changzhou", day: "D+5" });
    expect(mergeSlotFloor({ base: "changzhou" }, { base: "厦门" })).toEqual({ base: "厦门" });
    expect(mergeSlotFloor({ base: "changzhou" }, { base: null })).toEqual({ base: "changzhou" });
    expect(mergeSlotFloor({ base: "changzhou" }, { base: "" })).toEqual({ base: "changzhou" });
    // LLM 独有的键原样透传（含 _ 开头的诊断元数据）
    expect(mergeSlotFloor({ base: "changzhou" }, { _normalizedSlots: { a: 1 } })).toEqual({
      base: "changzhou",
      _normalizedSlots: { a: 1 },
    });
  });
});
