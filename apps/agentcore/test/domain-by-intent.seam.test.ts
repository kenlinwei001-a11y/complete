import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PLATFORM_PROMPT_DEFAULTS, type ClassificationResult } from "@platform/contracts";
import { createTestApp, PLANNER, submitQuery, TENANT, waitForTask, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";
import { AnthropicLlmClient } from "../src/llm/anthropic.js";
import { OpenAiLlmClient, type OpenAiChatCompletion, type OpenAiChatPort } from "../src/llm/openai.js";
import { GENERAL_AGENT_ID, GENERAL_AGENT_KEY, seedRegistry } from "../src/mocks/seed.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { BudgetTracker } from "../src/tools/budget.js";
import { detectSingleRole, domainDescriptionLine, planCoordination } from "../src/router/coordinator.js";

/**
 * ★ WO-DOMAIN-BY-INTENT · SEAM-GATE：**域归属 = 对 query 意图的分析**（关键词正则降为兜底/金丝雀）。
 *
 * 病灶（审核方活服务实测·派单 §3）：域归属纯靠词面命中，一个 token 就定生死 ——
 *   「把 EquipmentOEE 的前 3 条记录列出来」命中 `OEE` ⇒ 判生产域 ⇒ 落生产角色 agent（对象域被限权）；
 *   「把 QualityLot 的前 3 条记录列出来」一个中文域关键词都不含 ⇒ 判不出域 ⇒ 落通用 agent。
 *   同一个"列记录"的意图，只因表名里有没有那三个字母，落点天差地别。
 *
 * 本文件咬的是**链路**（不是函数）：种子（角色 agent + 通用 agent）× 分类器（域目录进 prompt + 回 domainRole）
 * × 路由（runPathB 按 domainRole 选角色）× 读端（`agentRuns.getByTask().agentKey` 说落在谁身上）。
 * 每臂都自带**改前对照读数**（`detectSingleRole(q)` 无分析时的关键词判定结果 = 本单之前的行为）。
 *
 * ⚠ 三态语义是命门（判据的设计就建在它上面）：
 *   `"quality"`=分析判定属质量域 · `null`=分析判定**判不出域** · **缺省**=没有这份分析（老任务/确定性桩）。
 *   `null` 与"缺省"必须走**不同**分支 —— 合并二者 = 让"分析说判不出域"的题被关键词重新判一遍，那正是本单要消灭的路。
 */

const CTX = { view: "risk" };
const SEAM_TIMEOUT = 30_000;

/** 无任何域关键词、但意图明显属**质量**域的问句（金丝雀：关键词表一个都不命中）。 */
const Q_NO_KEYWORD_QUALITY = "这批电芯自放电偏高，帮我定位问题出在哪儿";
/** 含域关键词（`OEE`→生产域）、但意图只是**数据罗列**（借词说别的事）的问句 —— 派单 §3 实测原句的族。 */
const Q_KEYWORD_OEE_LISTING = "把 EquipmentOEE 的前 3 条记录列出来";
/** 真判不出域：泛问（无关键词、无对口域）。 */
const Q_NO_DOMAIN = "帮我把能查的都翻一遍，给个综合的自由结论";

const FINAL = { content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "已作答。" }], provenance: [] })] };

/**
 * 分类器回一份**意图目录无对口意图、但域归属明确**的结果（域目录与意图目录相互独立·见 prompt 指令）。
 * `undefined` = **模型没吐该字段**（=没有这份分析）；`null` = 明确判"判不出域"—— 两者语义不同（见三态臂）。
 */
function classified(domainRole: string | null | undefined, reason?: string): ClassificationResult & Record<string, unknown> {
  return {
    candidates: [],
    outOfCatalog: true,
    extractedSlots: {},
    latencyMs: 1,
    model: "dcp:llmp_test:deepseek-flash",
    ...(domainRole === undefined ? {} : { domainRole }),
    ...(reason === undefined ? {} : { domainReason: reason }),
  };
}

async function seedAgents(t: TestApp): Promise<void> {
  for (const ag of seedRegistry().agents) {
    if (!(await t.repos.agents.get(ag.id))) await t.repos.agents.insert(ag);
  }
}

/** 出厂通用 agent（内核钉 NATIVE：EXTERNAL 走 DSH 子进程，与"落在谁身上"这一读数无关）。 */
async function seedGeneralNative(t: TestApp): Promise<void> {
  const g = seedRegistry().agents.find((a) => a.id === GENERAL_AGENT_ID);
  if (!g) throw new Error("seedRegistry 里没有通用 agent —— 种子没接上，本文件其余断言全部无意义");
  await t.repos.agents.insert({ ...g, kernel: "NATIVE" });
}

/** 提交一问 + 等终态 + 取「落在哪个 agent 身上」的原始读数。 */
async function ask(t: TestApp, query: string): Promise<{ agentKey: string | undefined; taskId: string }> {
  const { taskId } = await submitQuery(t, PLANNER, query, CTX);
  await waitForTask(t, taskId, (x) => x.status === "COMPLETED", 15_000);
  const run = await t.repos.agentRuns.getByTask(taskId);
  return { agentKey: run?.agentKey, taskId };
}

let logs: string[] = [];
const say = (s: string): void => {
  logs.push(s);
  // eslint-disable-next-line no-console
  console.log(s);
};

/** Stubbed openai SDK shape（无网络·与 `llm-providers.test.ts` 同一手法）。 */
class StubOpenAi implements OpenAiChatPort {
  readonly requests: Record<string, unknown>[] = [];
  readonly script: ((params: Record<string, unknown>) => OpenAiChatCompletion)[] = [];
  chat = {
    completions: {
      create: async (params: Record<string, unknown>): Promise<OpenAiChatCompletion> => {
        this.requests.push(params);
        const next = this.script.shift();
        if (!next) throw new Error("StubOpenAi: no scripted completion");
        return next(params);
      },
    },
  };
}

function assistant(msg: { content: string | null }, finish = "stop"): OpenAiChatCompletion {
  return {
    choices: [{ message: { role: "assistant", ...msg }, finish_reason: finish }],
    usage: { prompt_tokens: 100, completion_tokens: 20 },
  };
}

const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ["DSH_HARNESS", "DSH_HARNESS_DIR", "QOS_ROLLING_SUMMARY_LLM"]) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  logs = [];
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 判据 ① · 不含任何域关键词、但意图明显属于某域 ⇒ 落**该域**的角色 agent（改前：通用 agent）
// ─────────────────────────────────────────────────────────────────────────────
describe("WO-DOMAIN-BY-INTENT ① 无域关键词、意图属某域 ⇒ 该域角色 agent", () => {
  it("「这批电芯自放电偏高…」（零域关键词）→ 分析判质量域 ⇒ quality 角色 agent", { timeout: SEAM_TIMEOUT }, async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]);
    await seedAgents(t);
    await seedGeneralNative(t);

    // 改前对照（金丝雀·双向）：关键词表在这句话上一个域都不命中 ⇒ 本单之前必然落通用 agent。
    const before = detectSingleRole(Q_NO_KEYWORD_QUALITY);
    expect(before).toBeUndefined(); // 金丝雀不中 ⇒ 本臂测的确实是"词面判不出域"这一类

    t.llm.queueClassification(classified("quality", "问的是质量异常定位（自放电偏高），属质量域；与供应保障、产能排产无关。"));
    t.llm.queueAgentTurn(FINAL);
    const { agentKey, taskId } = await ask(t, Q_NO_KEYWORD_QUALITY);
    const task = await t.repos.tasks.get(taskId);
    say(
      `[WO-DOMAIN-BY-INTENT ①/⑤] q=「${Q_NO_KEYWORD_QUALITY}」\n` +
        `  · 关键词表（无分析时）detectSingleRole=${String(before)}\n` +
        `  · 分析 domainRole=${String(task?.classification?.domainRole)} · classification.model=${task?.classification?.model}\n` +
        `  · 依据（哪份域目录/哪版/哪行）=${JSON.stringify(task?.classification?.domainBasis)}\n` +
        `  · 理由=${JSON.stringify(task?.classification?.domainReason)}\n` +
        `  · 落点 agentKey=${String(agentKey)}`,
    );
    expect(agentKey).toBe("quality_inspector");
    expect(task?.classification?.model).toBe("agent:role:quality");
    // ⑤ 的留痕判据：能看出「依据的是哪条描述」—— 哪份域目录、哪一版、命中哪一行原文。
    const basis = task?.classification?.domainBasis;
    expect(basis?.catalog).toBe("PLATFORM_DEFAULT");
    expect(basis?.line).toBe(domainDescriptionLine(PLATFORM_PROMPT_DEFAULTS.classifier_domains, "quality"));
    expect(basis?.line).toContain("quality");
    expect(task?.classification?.domainReason).toContain("质量");
  });

  it("同族反面：域目录里没有的域 key（模型编造）⇒ 不采信，落通用 agent（不回落关键词）", { timeout: SEAM_TIMEOUT }, async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]);
    await seedAgents(t);
    await seedGeneralNative(t);

    t.llm.queueClassification(classified("weather"));
    t.llm.queueAgentTurn(FINAL);
    const { agentKey } = await ask(t, Q_KEYWORD_OEE_LISTING); // 这句话关键词命中 production（见 ② 的对照读数）
    say(`[WO-DOMAIN-BY-INTENT ①·反面] domainRole="weather"（目录外）⇒ 落点 agentKey=${String(agentKey)}`);
    expect(agentKey).toBe(GENERAL_AGENT_KEY);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 判据 ② · 含域关键词、但意图不属于该域 ⇒ **不落**该域（改前：落该域）
// ─────────────────────────────────────────────────────────────────────────────
describe("WO-DOMAIN-BY-INTENT ② 含域关键词、意图不属该域 ⇒ 不落该域", () => {
  it("「把 EquipmentOEE 的前 3 条记录列出来」（命中 OEE⇒生产域）→ 分析判不出域 ⇒ 通用 agent", { timeout: SEAM_TIMEOUT }, async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]);
    await seedAgents(t);
    await seedGeneralNative(t);

    // 改前对照（金丝雀·双向）：这句话关键词**确实**命中生产域 ⇒ 本单之前必然落生产角色 agent（被对象域限权）。
    const before = detectSingleRole(Q_KEYWORD_OEE_LISTING);
    expect(before).toBe("production"); // 金丝雀必中 ⇒ 本臂有鉴别力（不是"反正都落通用 agent"）

    t.llm.queueClassification(classified(null));
    t.llm.queueAgentTurn(FINAL);
    const { agentKey, taskId } = await ask(t, Q_KEYWORD_OEE_LISTING);
    const task = await t.repos.tasks.get(taskId);
    say(
      `[WO-DOMAIN-BY-INTENT ②] q=「${Q_KEYWORD_OEE_LISTING}」\n` +
        `  · 关键词表（无分析时）detectSingleRole=${String(before)}\n` +
        `  · 分析 domainRole=${JSON.stringify(task?.classification?.domainRole)}（null=分析判定判不出域）\n` +
        `  · 落点 agentKey=${String(agentKey)}`,
    );
    expect(agentKey).toBe(GENERAL_AGENT_KEY);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 判据 ③ · 真判不出域 ⇒ 仍落通用 agent（兜底不许弄丢）
// ─────────────────────────────────────────────────────────────────────────────
describe("WO-DOMAIN-BY-INTENT ③ 判不出域 ⇒ 通用 agent（兜底在位）", () => {
  it("泛问 + 分析判 null ⇒ 通用 agent（且不经关键词二次判定）", { timeout: SEAM_TIMEOUT }, async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]);
    await seedAgents(t);
    await seedGeneralNative(t);

    expect(detectSingleRole(Q_NO_DOMAIN)).toBeUndefined(); // 金丝雀：关键词本就不命中
    t.llm.queueClassification(classified(null, "既非供应保障也非产能/质量判定，属泛问。"));
    t.llm.queueAgentTurn(FINAL);
    const { agentKey, taskId } = await ask(t, Q_NO_DOMAIN);
    const task = await t.repos.tasks.get(taskId);
    say(
      `[WO-DOMAIN-BY-INTENT ③] q=「${Q_NO_DOMAIN}」· domainRole=null ⇒ 落点 agentKey=${String(agentKey)}\n` +
        `  · 依据=${JSON.stringify(task?.classification?.domainBasis)} · 理由=${JSON.stringify(task?.classification?.domainReason)}`,
    );
    expect(agentKey).toBe(GENERAL_AGENT_KEY);
    // 判"判不出域"同样要留下依据（catalog/version 有值、line=null：没有命中哪条描述）+ 一句理由。
    expect(task?.classification?.domainBasis?.catalog).toBe("PLATFORM_DEFAULT");
    expect(task?.classification?.domainBasis?.line).toBeNull();
    expect(task?.classification?.domainReason).toBeTruthy();
  });

  // ── 判据 ⑥ · 两个域的描述都能套上 ⇒ 不许静默任选（要么说清为什么取其一，要么落兜底） ──
  it("⑥-a 两域都沾边但能判主域 ⇒ 选它 + 理由里写明另一个域为何不适用", { timeout: SEAM_TIMEOUT }, async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]);
    await seedAgents(t);
    await seedGeneralNative(t);

    // 无任何域关键词（金丝雀：本单之前必然落通用 agent），但语义上供应/质量两域都贴得住。
    const q = "这批货到底是来料有问题还是我们工艺上出的岔子";
    expect(detectSingleRole(q)).toBeUndefined();
    t.llm.queueClassification(
      classified("quality", "两域都沾边（来料→供应保障，工艺自放电→质量判定）；用户要定的是这批货本身合不合格 ⇒ 归质量域。"),
    );
    t.llm.queueAgentTurn(FINAL);
    const { agentKey, taskId } = await ask(t, q);
    const task = await t.repos.tasks.get(taskId);
    say(
      `[WO-DOMAIN-BY-INTENT ⑥-a] q=「${q}」⇒ domainRole=${JSON.stringify(task?.classification?.domainRole)} · ` +
        `落点=${String(agentKey)}\n  · 理由=${JSON.stringify(task?.classification?.domainReason)}`,
    );
    expect(agentKey).toBe("quality_inspector");
    // 不是静默任选：留痕里一定带着"为什么"，且点明了撞上的另一个域（否则事后看不出这是次取舍）。
    expect(task?.classification?.domainReason).toMatch(/供应|supply-chain/);
  });

  it("⑥-b 判不出唯一主域 ⇒ 落兜底（通用 agent），理由里说明是哪两域撞上了", { timeout: SEAM_TIMEOUT }, async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]);
    await seedAgents(t);
    await seedGeneralNative(t);

    const q = "这条线的供应和产出到底哪个先出问题，我该先救哪头";
    t.llm.queueClassification(classified(null, "供应保障与产能瓶颈两域都贴得住，无法唯一归域。"));
    t.llm.queueAgentTurn(FINAL);
    const { agentKey, taskId } = await ask(t, q);
    const task = await t.repos.tasks.get(taskId);
    say(
      `[WO-DOMAIN-BY-INTENT ⑥-b] q=「${q}」⇒ domainRole=${JSON.stringify(task?.classification?.domainRole)} · ` +
        `落点=${String(agentKey)}\n  · 理由=${JSON.stringify(task?.classification?.domainReason)}`,
    );
    expect(agentKey).toBe(GENERAL_AGENT_KEY);
    expect(task?.classification?.domainReason).toContain("域");
  });

  it("兜底臂（回归）：**没有这份分析**（老分类结果·无 domainRole 字段）⇒ 关键词表照旧生效", { timeout: SEAM_TIMEOUT }, async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]);
    await seedAgents(t);
    await seedGeneralNative(t);

    const q = "常州基地的物料齐套情况如何";
    expect(detectSingleRole(q)).toBe("supply-chain"); // 金丝雀：这句话确实唯一命中供应链域
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} }); // ⚠ 无 domainRole = 没有分析
    t.llm.queueAgentTurn(FINAL);
    const { agentKey, taskId } = await ask(t, q);
    const task = await t.repos.tasks.get(taskId);
    say(
      `[WO-DOMAIN-BY-INTENT 兜底臂] domainRole 字段缺省（=没有分析）⇒ 关键词兜底 · 落点 agentKey=${String(agentKey)}` +
        ` · task.classification.domainRole=${JSON.stringify(task?.classification?.domainRole)}`,
    );
    expect(agentKey).toBe("supply_chain");
  });

  it("会诊臂：分析在场 ⇒ 不按关键词拉多角色会诊（domainRole=null 时落通用 agent，不给关键词机会）", { timeout: SEAM_TIMEOUT }, async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]);
    await seedAgents(t);
    await seedGeneralNative(t);

    // 这句话关键词命中多域 + 交付风险 → 本单之前会按关键词召集"交付风险三角"（3 角色会诊）。
    const q = "常州工厂 交期风险波及哪些在手单，物料齐套和良率也要一起看";
    // 金丝雀（双向）：关键词判据在这句话上**确实**会出计划 ⇒ 下面的 false 不是"反正都不开会诊"。
    expect(planCoordination(q, undefined, [], false)).toBeDefined();
    t.llm.queueClassification(classified(null));
    t.llm.queueAgentTurn(FINAL);
    const { taskId } = await ask(t, q);
    const events = await t.repos.events.listAfter(taskId, 0);
    const planned = events.some((e) => e.event === "coordinator.planned");
    say(`[WO-DOMAIN-BY-INTENT 会诊臂] domainRole=null ⇒ coordinator.planned=${planned}（false=未按词面会诊）`);
    expect(planned).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 判据 ④ · 角色 agent 的 scope **一个字未放宽**（域内 agent 读域外类型仍被拒）
// ─────────────────────────────────────────────────────────────────────────────
describe("WO-DOMAIN-BY-INTENT ④ 落点变了，围栏没变（角色 agent 读域外类型仍被拒）", () => {
  it("④-1 围栏本身（不经路由·两版代码同读数）：DENY payload 的 allowed 与声明面逐条相同", { timeout: SEAM_TIMEOUT }, async () => {
    const t = await createTestApp();
    await seedAgents(t);
    const ctx = { tenantId: TENANT, userId: "user-planner", roles: ["planner"] };
    const typeKeys = await t.dataCore.ontology.listObjectTypeKeys(ctx);
    const probeType = typeKeys.includes("Material") ? "Material" : typeKeys[0]!;
    const quality = seedRegistry().agents.find((a) => a.id === "agt_quality_inspector")!;
    const declared = [...quality.scopeDeclaration.objectTypes];
    expect(declared).not.toContain(probeType); // 金丝雀：探针类型真在声明面之外

    t.llm.queueAgentTurn({ content: [toolUse("query_objects", { objectType: probeType, filter: {} })] });
    t.llm.queueAgentTurn(FINAL);
    await t.deps.engine.runRegisteredAgent({
      taskId: "task_scope_quality",
      agentId: "agt_quality_inspector",
      version: "latest",
      prompt: `读一下 ${probeType}`,
      ctx,
      nesting: { callChain: [], budget: new BudgetTracker({}) },
      emit: async () => {},
      enforceObjectScope: true, // 角色路（runRolePathB）的真实形态：对象域门开着
    });
    const calls = await t.repos.toolCalls.listByTask("task_scope_quality");
    const payload = JSON.parse(
      JSON.stringify(calls.find((c) => c.toolName === "query_objects")?.output ?? {}),
    ) as { allowed?: string[] };
    say(
      `[WO-DOMAIN-BY-INTENT ④-1] quality 角色 agent 读域外类型 ${probeType} ⇒ allowed=[${(payload.allowed ?? []).join(",")}]（声明面=${JSON.stringify(declared)}）`,
    );
    expect(payload.allowed).toEqual(declared); // 运行期有效对象域 == 声明面（一个字没放宽）
  });

  it("④-2 quality 角色 agent（经 ① 的新落点）真跑一次读域外对象 ⇒ AGENT_SCOPE_VIOLATION", { timeout: SEAM_TIMEOUT }, async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]);
    await seedAgents(t);
    await seedGeneralNative(t);

    // 金丝雀：探针读的那个类型必须**真不在** quality 角色 agent 的声明面里（否则"被拒"无从谈起）。
    const ctx = { tenantId: TENANT, userId: "user-planner", roles: ["planner"] };
    const typeKeys = await t.dataCore.ontology.listObjectTypeKeys(ctx);
    const probeType = typeKeys.includes("Material") ? "Material" : typeKeys[0]!;
    const quality = seedRegistry().agents.find((a) => a.id === "agt_quality_inspector")!;
    expect(quality.scopeDeclaration.objectTypes).not.toContain(probeType);
    // 声明面（围栏本身）逐条读数 —— 本单不改它，贴出来备对照。
    const declared = [...quality.scopeDeclaration.objectTypes];

    t.llm.queueClassification(classified("quality"));
    t.llm.queueAgentTurn({ content: [toolUse("query_objects", { objectType: probeType, filter: {} })] });
    t.llm.queueAgentTurn(FINAL);
    const { agentKey, taskId } = await ask(t, Q_NO_KEYWORD_QUALITY);

    const calls = await t.repos.toolCalls.listByTask(taskId);
    const out = JSON.stringify(calls.find((c) => c.toolName === "query_objects")?.output ?? {});
    say(
      `[WO-DOMAIN-BY-INTENT ④] quality 角色 agent（落点 agentKey=${String(agentKey)}）读域外类型 ${probeType}\n` +
        `  · 声明面（未改·逐条）=${JSON.stringify(declared)}\n` +
        `  · 工具回执=${out.slice(0, 220)}`,
    );
    expect(agentKey).toBe("quality_inspector");
    expect(out).toContain("AGENT_SCOPE_VIOLATION");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 接缝的另一半：域目录**真的进了分类器 prompt**，且它来自**配置面**（改描述不改代码）
// ─────────────────────────────────────────────────────────────────────────────
describe("WO-DOMAIN-BY-INTENT 接缝：域目录 = 配置面（每域一条描述·覆盖/不覆盖）", () => {
  it("平台默认那份域目录进 prompt：三域各一条、都写清『不覆盖』、且与角色目录不漂", { timeout: SEAM_TIMEOUT }, async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys()]);
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn(FINAL);
    await ask(t, Q_NO_DOMAIN);

    const system = t.llm.classifyRequests[0]?.system ?? "";
    const catalog = PLATFORM_PROMPT_DEFAULTS.classifier_domains;
    expect(system).toContain(catalog); // 域目录真的下发（否则模型无从回 domainRole）
    expect(system).toContain("意图所属域（domainRole + domainReason）");
    // 每域一条描述，且**覆盖 / 不覆盖都写了**（只写覆盖 ⇒ 两个域都套得上 ⇒ 判据退化）。
    for (const role of ["supply-chain", "production", "quality"]) {
      expect(domainDescriptionLine(catalog, role)).toContain("覆盖");
      expect(domainDescriptionLine(catalog, role)).toContain("不覆盖");
    }
    // 漂移金丝雀：域目录里描述的域 == 角色目录里的域（改一处漏一处 → 这里红）。
    const { ROLE_PROFILES } = await import("../src/mocks/seed.js");
    const roleDomains = ROLE_PROFILES.map((p) => p.role).filter((r) => ["supply-chain", "production", "quality"].includes(r));
    for (const r of roleDomains) expect(domainDescriptionLine(catalog, r)).not.toBeNull();
    say(`[WO-DOMAIN-BY-INTENT 接缝·默认] 三域描述行齐备=${roleDomains.map((r) => domainDescriptionLine(catalog, r) !== null).join(",")}`);
  });

  it("租户 override 域目录（改描述不改代码）⇒ 进 prompt 且依据留痕标 TENANT_OVERRIDE@vN", { timeout: SEAM_TIMEOUT }, async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "agent.coordinator"]);
    await seedAgents(t);
    await seedGeneralNative(t);

    const CUSTOM = [
      "- quality（质量）：覆盖 一切与电芯一致性/自放电有关的判定；不覆盖 供应与产能。",
      "- supply-chain（供应链）：覆盖 来料与在途；不覆盖 质量判定。",
      "- production（生产）：覆盖 节拍与瓶颈；不覆盖 质量判定。",
    ].join("\n");
    t.dataCore.prompts.setOverride(TENANT, "classifier_domains", CUSTOM);

    t.llm.queueClassification(classified("quality", "按租户自定义描述：自放电属质量域。"));
    t.llm.queueAgentTurn(FINAL);
    const { agentKey, taskId } = await ask(t, Q_NO_KEYWORD_QUALITY);
    const task = await t.repos.tasks.get(taskId);
    const system = t.llm.classifyRequests[0]?.system ?? "";
    say(
      `[WO-DOMAIN-BY-INTENT 接缝·override] prompt 含租户自定义行=${system.includes(CUSTOM.split("\n")[0]!)} · ` +
        `落点=${String(agentKey)} · 依据=${JSON.stringify(task?.classification?.domainBasis)}`,
    );
    expect(system).toContain(CUSTOM.split("\n")[0]!); // 改一处配置 → 分类器看到的描述随之变
    expect(agentKey).toBe("quality_inspector");
    expect(task?.classification?.domainBasis?.catalog).toBe("TENANT_OVERRIDE");
    expect(task?.classification?.domainBasis?.version).toBeGreaterThan(0);
    expect(task?.classification?.domainBasis?.line).toBe(domainDescriptionLine(CUSTOM, "quality"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 纯函数三态（判据本身的最小读数）
// ─────────────────────────────────────────────────────────────────────────────
describe("WO-DOMAIN-BY-INTENT · detectSingleRole 三态", () => {
  it("string ⇒ 该域 · null ⇒ undefined（与「缺省」不同路）· 缺省 ⇒ 关键词兜底", () => {
    const q = Q_KEYWORD_OEE_LISTING; // 关键词命中 production
    expect(detectSingleRole(q)).toBe("production"); // 缺省 = 没有分析 ⇒ 兜底
    expect(detectSingleRole(q, { domainRole: "production" })).toBe("production");
    expect(detectSingleRole(q, { domainRole: "quality" })).toBe("quality"); // 分析改判 ⇒ 词面不作数
    expect(detectSingleRole(q, { domainRole: null })).toBeUndefined(); // 判不出域 ⇒ 通用 agent
    expect(detectSingleRole(q, { domainRole: undefined })).toBe("production"); // 显式缺省 = 未分析 ⇒ 兜底
    expect(detectSingleRole(q, { domainRole: "weather" })).toBeUndefined(); // 目录外 ⇒ 不采信
    // 定式让位仍前置（与词面/分析均无关的结构判据·两版判据下一致）
    expect(detectSingleRole("4680-NCM 上浮10%，8周还能接吗", { domainRole: "production" })).toBeUndefined();
    expect(logs.length).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 适配器层（⇐ 上面几臂走的是 scripted mock，**绕过适配器**）：真适配器必须让 domainRole 穿过去
// —— 三条适配器的窄 schema 历史上就是「证据在自己这一层被删掉」的地方（WO-SLOT-HARVEST 的 slot 同款病）。
// anthropic 是 live 部署用的那条路（provider kind=anthropic），故它必须有一条。
// ─────────────────────────────────────────────────────────────────────────────
describe("WO-DOMAIN-BY-INTENT · 适配器层透传（openai / anthropic）", () => {
  it("openai：raw 里的 domainRole 穿到 RawClassification（空串 ⇒ null；缺字段 ⇒ undefined）", async () => {
    const run = async (payload: Record<string, unknown>) => {
      const stub = new StubOpenAi();
      stub.script.push(() => assistant({ content: JSON.stringify(payload) }));
      const llm = new OpenAiLlmClient({ client: stub });
      const r = await llm.classify({ model: "m", system: "sys", user: "u" });
      return { r, stub };
    };
    const a = await run({ candidates: [{ intentKey: "x", confidence: 0.9 }], outOfCatalog: false, domainRole: "quality" });
    const b = await run({ candidates: [], outOfCatalog: true, domainRole: "" });
    const c = await run({ candidates: [], outOfCatalog: true });
    say(
      `[WO-DOMAIN-BY-INTENT 适配器·openai] domainRole="quality" ⇒ ${JSON.stringify(a.r.domainRole)} · ` +
        `"" ⇒ ${JSON.stringify(b.r.domainRole)} · 缺字段 ⇒ ${JSON.stringify(c.r.domainRole)}`,
    );
    expect(a.r.domainRole).toBe("quality");
    expect(b.r.domainRole).toBeNull();
    expect(c.r.domainRole).toBeUndefined();
    // 模型侧提示（json_schema）里也必须带这个字段，否则模型根本不知道要回它。
    const schema = (a.stub.requests[0] as { response_format: { json_schema: { schema: { properties: Record<string, unknown> } } } })
      .response_format.json_schema.schema;
    expect(Object.keys(schema.properties)).toContain("domainRole");
  });

  it("anthropic（live 部署那条路）：parsed_output 里的 domainRole 穿到 RawClassification", async () => {
    const seen: Record<string, unknown>[] = [];
    const stubClient = {
      messages: {
        parse: async (params: Record<string, unknown>) => {
          seen.push(params);
          return {
            parsed_output: { candidates: [], outOfCatalog: true, extractedSlots: {}, domainRole: "production" },
            usage: { input_tokens: 12, output_tokens: 3 },
          };
        },
      },
    };
    const llm = new AnthropicLlmClient(undefined, { client: stubClient as never });
    const r = await llm.classify({ model: "deepseek-flash", system: "sys", user: "u" });
    say(`[WO-DOMAIN-BY-INTENT 适配器·anthropic] domainRole=${JSON.stringify(r.domainRole)}`);
    expect(r.domainRole).toBe("production");
    // 结构化输出 schema（发给模型的那一份）也必须声明该字段。
    const fmt = (seen[0] as { output_config: { format: { schema: { properties: Record<string, unknown> } } } }).output_config.format;
    expect(Object.keys(fmt.schema.properties)).toContain("domainRole");
  });
});
