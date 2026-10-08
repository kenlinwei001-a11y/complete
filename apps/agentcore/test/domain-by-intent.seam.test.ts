import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ClassificationResult } from "@platform/contracts";
import { createTestApp, PLANNER, submitQuery, TENANT, waitForTask, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";
import { GENERAL_AGENT_ID, GENERAL_AGENT_KEY, seedRegistry } from "../src/mocks/seed.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { buildClassifierDomainCatalog, detectSingleRole, planCoordination } from "../src/router/coordinator.js";

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

/** 分类器回一份**意图目录无对口意图、但域归属明确**的结果（域目录与意图目录相互独立·见 prompt 指令）。 */
function classified(domainRole: string | null | undefined): ClassificationResult & Record<string, unknown> {
  return {
    candidates: [],
    outOfCatalog: true,
    extractedSlots: {},
    latencyMs: 1,
    model: "dcp:llmp_test:deepseek-flash",
    ...(domainRole === undefined ? {} : { domainRole }),
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

    t.llm.queueClassification(classified("quality"));
    t.llm.queueAgentTurn(FINAL);
    const { agentKey, taskId } = await ask(t, Q_NO_KEYWORD_QUALITY);
    const task = await t.repos.tasks.get(taskId);
    say(
      `[WO-DOMAIN-BY-INTENT ①] q=「${Q_NO_KEYWORD_QUALITY}」\n` +
        `  · 关键词表（无分析时）detectSingleRole=${String(before)}\n` +
        `  · 分析 domainRole=${String(task?.classification?.domainRole)} · classification.model=${task?.classification?.model}\n` +
        `  · 落点 agentKey=${String(agentKey)}（task.classification.model=${task?.classification?.model}）`,
    );
    expect(agentKey).toBe("quality_inspector");
    expect(task?.classification?.model).toBe("agent:role:quality");
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
    t.llm.queueClassification(classified(null));
    t.llm.queueAgentTurn(FINAL);
    const { agentKey } = await ask(t, Q_NO_DOMAIN);
    say(`[WO-DOMAIN-BY-INTENT ③] q=「${Q_NO_DOMAIN}」· domainRole=null ⇒ 落点 agentKey=${String(agentKey)}`);
    expect(agentKey).toBe(GENERAL_AGENT_KEY);
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
  it("quality 角色 agent（经 ① 的路由落点）真跑一次读域外对象 ⇒ AGENT_SCOPE_VIOLATION", { timeout: SEAM_TIMEOUT }, async () => {
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
// 接缝的另一半：域目录**真的进了分类器 prompt**（否则分类器无从回 domainRole）
// ─────────────────────────────────────────────────────────────────────────────
describe("WO-DOMAIN-BY-INTENT 接缝：域目录随分类器 prompt 下发", () => {
  it("分类器 system 含域目录段（三域 · 投影自角色画像目录）", { timeout: SEAM_TIMEOUT }, async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys()]);
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn(FINAL);
    await ask(t, Q_NO_DOMAIN);

    const system = t.llm.classifyRequests[0]?.system ?? "";
    const catalog = buildClassifierDomainCatalog();
    say(`[WO-DOMAIN-BY-INTENT 接缝] 分类器 system 含域目录段=${system.includes(catalog)} · 含 domainRole 指令=${system.includes("意图所属域（domainRole）")}`);
    expect(system).toContain(catalog);
    expect(system).toContain("意图所属域（domainRole）");
    // 域目录投影自角色画像目录（单一来源·非手抄）：三条角色域各一行，且与 ROLE_PROFILES 的对口对象域同源。
    expect(catalog.split("\n")).toHaveLength(3);
    expect(catalog).toContain("Material/Supplier/PurchaseOrder/Shipment");
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
