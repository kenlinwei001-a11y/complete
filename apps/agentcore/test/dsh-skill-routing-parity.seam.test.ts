/**
 * WO-P2B-SKILL-ROUTING · **技能选择面的双跑对照**（native 臂 ⊕ DSH 臂）。
 *
 * 本单要回答的不是「两臂都跑得通」，而是：**同一个问句、同一批 skills，两臂各自让模型看见什么。**
 * 逐条只用三个桶（三处口径必须一致，缺一个桶就没法逐条对比）：
 *
 *   · **全文化**   —— 模型在这一臂里不调任何工具就能读到的技能内容（native = summary 整句；
 *                    DSH = 目录行的 description 整句）
 *   · **仅列名**   —— 只出现 id/名字，正文要再调一次加载器（native = `其余 N 个…` 那行；
 *                    DSH 目录行恒带 description，故本桶在 DSH 侧**结构上为空**）
 *   · **不可见**   —— 该技能在这条臂的模型面字节里一次都不出现（连名字都没有）
 *
 * 两臂的真实接线（本文件按它比对，不按想象）：
 *   native：`buildSkillSection(skills, { query })`（`agent/prompts.ts`）——
 *           两个调用点：`engine.ts:742`（注册 agent 路，skills = 该 agent 绑定的技能）、
 *           `router/orchestrator.ts:2103`（free-QA 路，skills = `selectTenantSkills(...)`）。
 *   DSH   ：`buildSessionSetup({ skills: skills.map((s) => mapSkill(s)) })`（`dsh-runtime/setup-spec.ts`）
 *           → wire → `applySetupSpec` → 平台自有 SkillProvider → dsh-tool-skill 的
 *           `agent/pre-step` 目录消息 + `skill` 工具。**该臂 persona 里不写技能段**
 *           （setup-spec.ts 的注释原文：「旧 native 路的 buildSkillSection 是另一条臂，本函数不 import」）。
 *
 * ⚠ 两臂的**同一批 skills** 是同一个入参：`engine.ts:994` 用的就是 `engine.ts:742` 那一份 `skills`。
 *
 * ── 交付级判据（铁律 1.5）────────────────────────────────────────────────────
 * ① 值校验：每条断言的那个数都从**两条独立来源**各算一遍再对上 ——
 *    一个来源是**渲染后的模型面字节**（正则从字节里数），另一个来源是**入参数组/算术**
 *    （`min(N, topK)` / 入参 `skills` 本身），两者对不上即红。
 * ② 对照实验：`query` 由 X 改成 X′ ⇒ native 的全化集**按可预言的方式**换人
 *    （预言值由本文件手算的评分独立给出，不是回读生产 `rankSkills`），
 *    而 DSH 目录字节**逐字节不动**（装配期不吃 query）。见 §3。
 * ③ 否定结论（「DSH 侧结构上无 `仅列名` 桶」「附件名 0 次出现」）都配了金丝雀 —— 见 §0/§4。
 * ④ NOT-MEASURED 一处也不藏：本文件**不驱动 native 的 `load_skill` 工具**
 *    （那需要真起 ExecutionEngine + 脚本化 LLM，属 `engine.ts` 的 P5 范围），
 *    故 L3 附件面的 native 半边只给 **file:line 静态读数**，不算实测。见 §4 尾注。
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import type { SkillDefinition } from "@platform/contracts";
import { buildSkillSection } from "../src/agent/prompts.js";
import { rankSkills, lexTokens } from "../src/agent/skill-router.js";
import { selectTenantSkills } from "../src/router/orchestrator.js";
import { buildSessionSetup, mapSkill } from "../src/dsh-runtime/index.js";
import { seedRegistry } from "../src/mocks/seed.js";
import { pseudoEmbed } from "../src/util/embedding.js";

const HARNESS_DIR = fileURLToPath(new URL("../../../packages/dsh-harness", import.meta.url));
const DRIVER = `${HARNESS_DIR}/test/skill-seam-driver.mjs`;

type Driver = {
  CATALOG_DESCRIPTION_MAX_LENGTH: number;
  makeSkillWorld(): Promise<unknown>;
  makeSkillAgent(app: unknown, tenantId: string, id: string): { agent: unknown; ctx: unknown };
  mountSetupSpec(agentCtx: unknown, spec: unknown): Promise<void>;
  prestepTexts(app: unknown, agent: unknown): Promise<string[]>;
  catalogOf(app: unknown, agent: unknown): Promise<{ complete: boolean; skills: { name: string; description: string }[] }>;
  callSkillTool(app: unknown, agent: unknown, name: string, callId?: string): Promise<{ text: string; isError: boolean }>;
};

const driver = (await import(DRIVER)) as unknown as Driver;

/** 最小 AgentDefinition（只喂 buildSessionSetup 真读的字段）。 */
const agentDef = (over: Record<string, unknown> = {}) => ({
  id: "agt_p2b",
  tenantId: "t1",
  key: "p2b_agent",
  version: 1,
  name: "P2B",
  description: "",
  model: "",
  systemPrompt: "You are a capacity planner.",
  tools: [],
  ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" as const },
  skills: [],
  mcpServers: [],
  scopeDeclaration: { objectTypes: [], toolNames: [] },
  status: "PUBLISHED" as const,
  ...over,
});

const skillDef = (key: string, summary: string, body: string, over: Partial<SkillDefinition> = {}): SkillDefinition => ({
  id: `skl_${key}`,
  tenantId: "t1",
  key,
  version: 1,
  name: `名-${key}`,
  summary,
  body,
  resources: [],
  status: "PUBLISHED",
  ...over,
});

// ---------------------------------------------------------------------------
// 面抽取器：两臂**只从渲染后的模型面字节**里数（不读中间对象，避免自证）
// ---------------------------------------------------------------------------

type Bucket = "full" | "nameOnly" | "invisible";
type NativeFace = { text: string; full: string[]; nameOnly: string[]; invisible: string[]; bucketOf: (id: string) => Bucket };

/** native 臂：从 `buildSkillSection` 的返回字节里抽三桶。 */
function nativeFace(skills: SkillDefinition[], query?: string): NativeFace {
  const text = buildSkillSection(skills, { query });
  const full = [...text.matchAll(/^- \[([^\]]+)\] /gm)].map((m) => m[1]!);
  const deferLine = text.split("\n").find((l) => l.startsWith("其余 ")) ?? "";
  const nameOnly = [...deferLine.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]!);
  const seen = new Set([...full, ...nameOnly]);
  const invisible = skills.map((s) => s.id).filter((id) => !seen.has(id));
  const bucketOf = (id: string): Bucket => (full.includes(id) ? "full" : nameOnly.includes(id) ? "nameOnly" : "invisible");
  return { text, full, nameOnly, invisible, bucketOf };
}

type DshFace = {
  catalogText: string;
  /** 目录行：`- \`dshName\`: description`（正则只吃 `- \`` 开头的行） */
  entries: { name: string; description: string }[];
  /** 逐条真调 `skill` 工具；命中且正文逐字节落地才算 `loadable` */
  loadable: string[];
  toolText: Record<string, string>;
  bucketOf(dshName: string): Bucket;
};

async function dshFace(skills: SkillDefinition[], opts: { app?: unknown; agentId?: string } = {}): Promise<DshFace> {
  const setup = buildSessionSetup({
    agent: agentDef() as never,
    agentSystemCore: "CORE",
    grantedToolNames: [],
    skills: skills.map((s) => mapSkill(s)),
  });
  const app = opts.app ?? (await driver.makeSkillWorld());
  const world = driver.makeSkillAgent(app, "t1", opts.agentId ?? "p2b-a");
  await driver.mountSetupSpec(world.ctx, setup);
  const catalogText = (await driver.prestepTexts(app, world.agent)).join("\n");
  // 目录行形状由 dsh-tool-skill 渲染（见其 renderCatalogMessage）：`- \`name\`: description`
  const entries = [...catalogText.matchAll(/^- `([^`]+)`: (.*)$/gm)].map((m) => ({ name: m[1]!, description: m[2]! }));
  const loadable: string[] = [];
  const toolText: Record<string, string> = {};
  for (const e of entries) {
    const r = await driver.callSkillTool(app, world.agent, e.name, `p2b-${e.name}`);
    toolText[e.name] = r.text;
    if (!r.isError) loadable.push(e.name);
  }
  return {
    catalogText,
    entries,
    loadable,
    toolText,
    bucketOf: (dshName: string) => (entries.some((e) => e.name === dshName) ? "full" : "invisible"),
  };
}

/** 一个技能在两臂里的落点（逐条对比表的一行）。 */
type Row = {
  key: string;
  native: Bucket;
  dsh: Bucket;
  /** DSH 目录描述 == summary 逐字节？（`full` 桶的内容校验，不是存在性校验） */
  descExact: boolean;
  /** 两臂各自一次工具调用能否拿到正文（native 侧本文件不驱动 ⇒ null = NOT-MEASURED） */
  nativeBodyViaOneCall: boolean | null;
  dshBodyViaOneCall: boolean;
};

async function compareRows(skills: SkillDefinition[], query: string, app?: unknown): Promise<{ rows: Row[]; nf: NativeFace; df: DshFace }> {
  const nf = nativeFace(skills, query);
  const df = await dshFace(skills, { app, agentId: `p2b-${skills.length}-${query.length}` });
  const rows = skills.map((s) => {
    const dshName = mapSkill(s).dshName;
    return {
      key: s.key,
      native: nf.bucketOf(s.id),
      dsh: df.bucketOf(dshName),
      descExact: df.entries.find((e) => e.name === dshName)?.description === s.summary,
      nativeBodyViaOneCall: null, // NOT-MEASURED（见文件头 ④）
      dshBodyViaOneCall: df.toolText[dshName] !== undefined && df.toolText[dshName]!.includes(`<skill_instructions>\n${s.body}\n</skill_instructions>`),
    };
  });
  return { rows, nf, df };
}

// ---------------------------------------------------------------------------
// §0 金丝雀：这套「三桶」量法必须先自证能分辨三种状态
//   铁律 0.6 —— 报「不可见」这类否定结论之前，必须证明量法在**已知为真**的样例上会报出它。
// ---------------------------------------------------------------------------

describe("P2B 金丝雀 · 三桶量法有鉴别力", () => {
  it("同一量法：在场的报 full、缺席的报 invisible（不是恒报同一桶）", async () => {
    const a = skillDef("canary_alpha", "阿尔法触发器短句", "BODY-ALPHA");
    const b = skillDef("canary_beta", "贝塔触发器短句", "BODY-BETA");

    // native：只注入 a ⇒ a=full、b=invisible（b 的 id 在字节里一次都不出现）
    const nf = nativeFace([a], "随便问一句");
    expect(nf.bucketOf(a.id)).toBe("full");
    expect(nf.bucketOf(b.id)).toBe("invisible");
    expect(nf.text).not.toContain(b.id);

    // DSH：注入 a+b ⇒ 两条都 full（反向证明上一条的 invisible 不是量法恒真）
    const df = await dshFace([a, b]);
    expect(df.entries.map((e) => e.name).sort()).toEqual(["canary-alpha", "canary-beta"]);
    expect(df.bucketOf("canary-alpha")).toBe("full");
    expect(df.bucketOf("nope-nope")).toBe("invisible");
  });

  it("`仅列名` 桶在 native 侧真的会出现（N>topK 时那行就是它）；DSH 侧对应行仍带描述", async () => {
    const batch = synthSkills(7);
    const nf = nativeFace(batch, batch[0]!.summary);
    expect(nf.nameOnly.length).toBe(1); // 有 1 条落进这个桶 —— 否则本套件的第三桶是死的
    const deferred = nf.nameOnly[0]!;
    const dshName = mapSkill(batch.find((s) => s.id === deferred)!).dshName;
    const df = await dshFace(batch);
    // 同一条技能：native 只给 id/名，DSH 给整句 description —— 这就是「落在不同桶」的实证
    expect(nf.text).not.toContain(batch.find((s) => s.id === deferred)!.summary);
    expect(df.entries.find((e) => e.name === dshName)!.description).toBe(batch.find((s) => s.id === deferred)!.summary);
  });
});

// ---------------------------------------------------------------------------
// §1 真实租户集（seed 原样）：free-QA 路今天真的会喂给 native 的那一批
// ---------------------------------------------------------------------------

describe("P2B · 真实种子集双跑", () => {
  const { skills: seedSkills } = seedRegistry("2026-01-01T00:00:00.000Z");
  const tenantSkills = selectTenantSkills(seedSkills);

  it("前置事实（独立来源 ① 真 selector，② 手工过滤 status/version 后按 key 排序）", () => {
    // 来源 ①：真 selectTenantSkills。来源 ②：本文件自己按契约手工重算。
    const manual = [...seedSkills.filter((s) => s.status === "PUBLISHED").reduce((m, s) => {
      const cur = m.get(s.key);
      if (!cur || s.version > cur.version) m.set(s.key, s);
      return m;
    }, new Map<string, SkillDefinition>()).values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    expect(tenantSkills.map((s) => `${s.key}@${s.version}`)).toEqual(manual.map((s) => `${s.key}@${s.version}`));
    expect(tenantSkills).toHaveLength(5); // 种子 7 条里 2 条 DRAFT 被 selector 挡掉（5 = 7 − 2，算术独立可核）
    expect(seedSkills).toHaveLength(7);
    expect(tenantSkills.every((s) => s.summary.length > 0 && s.summary.length <= 200)).toBe(true);
  });

  it("逐条：N=5 ≤ topK=6 ⇒ 两臂**全化集都是全集**（无 `仅列名`、无 `不可见`）", async () => {
    const { rows, nf, df } = await compareRows(tenantSkills, "4680-NCM 还能接多少量？");

    // 值校验：桶计数由**字节**数出，另由**入参算术**再算一遍
    expect(nf.full).toHaveLength(Math.min(tenantSkills.length, 6));
    expect(nf.nameOnly).toHaveLength(Math.max(0, tenantSkills.length - 6));
    expect(nf.invisible).toHaveLength(0);
    expect(df.entries).toHaveLength(tenantSkills.length);
    expect(rows.filter((r) => r.native === "full" && r.dsh === "full")).toHaveLength(5);

    // 逐条对上：每个 native 全化的 id 都能在 DSH 目录里找到**同一条**（key→dshName 映射后）
    for (const r of rows) {
      expect(r.native).toBe("full");
      expect(r.dsh).toBe("full");
      expect(r.descExact).toBe(true); // 描述 == summary 逐字节（不是"有条目就行"）
      expect(r.dshBodyViaOneCall).toBe(true); // 一次工具调用拿到正文，且 <skill_instructions> 包裹逐字节
    }
    // 负向对照：篡改一个字就不该判 true（证明 descExact 不是恒真）
    const tampered = df.entries.map((e) => ({ ...e, description: e.description + "。" }));
    expect(tampered[0]!.description).not.toBe(tenantSkills[0]!.summary);
  });

  it("同一批、同一问句：两臂的**可见技能集合**逐 id 相等（native id ↔ dshName 是同一个 key 折出来的）", async () => {
    const { rows } = await compareRows(tenantSkills, "帮我看看风险根因");
    const nativeFullKeys = rows.filter((r) => r.native === "full").map((r) => r.key).sort();
    const dshFullKeys = rows.filter((r) => r.dsh === "full").map((r) => r.key).sort();
    expect(dshFullKeys).toEqual(nativeFullKeys);
    expect(nativeFullKeys).toEqual(tenantSkills.map((s) => s.key).sort());
  });
});

// ---------------------------------------------------------------------------
// §2 N=7 > topK=6：两臂**第一处分歧**（native 会砍，DSH 不砍）—— 有数、有名字
// ---------------------------------------------------------------------------

describe("P2B · N>topK 时的分歧", () => {
  it("native 6 全化 / 1 仅列名 / 0 不可见；DSH 7 全化 —— 差的正是那 1 条的 description", async () => {
    const batch = synthSkills(7);
    const query = batch[0]!.summary;
    const { nf, df, rows } = await compareRows(batch, query);

    expect([nf.full.length, nf.nameOnly.length, nf.invisible.length]).toEqual([6, 1, 0]);
    expect(df.entries).toHaveLength(7);
    expect(rows.filter((r) => r.dsh === "full")).toHaveLength(7);

    // 被 native 降级的那条：DSH 目录里**有它的 description 整句**（模型不调工具就能读到）
    const degradedKey = rows.find((r) => r.native === "nameOnly")!.key;
    const degraded = batch.find((s) => s.key === degradedKey)!;
    expect(rows.find((r) => r.key === degradedKey)!.dsh).toBe("full");
    expect(df.catalogText).toContain(degraded.summary); // 整句在字节里
    expect(nf.text).not.toContain(degraded.summary); // native 字节里没有它

    // 值校验（另一来源）：被降级的那条 = rankSkills 的第 7 名；6/1 的切分 = min(N,6)/max(0,N−6)
    const ranked = rankSkills(query, batch);
    expect(ranked).toHaveLength(7);
    expect(ranked.map((r) => r.skill.id).slice(6)).toEqual([degraded.id]);
    expect(nf.full).toEqual(ranked.slice(0, 6).map((r) => r.skill.id));

    // 两臂差异的**净量**：native 少给 1 条 summary（= 该条 summary 的字节数），其余 6 条逐字节相同
    const lostBytes = degraded.summary.length;
    expect(lostBytes).toBeGreaterThan(0);
    for (const r of rows.filter((x) => x.native === "full")) {
      expect(df.catalogText).toContain(batch.find((s) => s.key === r.key)!.summary);
    }
  });

  it("被降级的具体是哪一个：换 topK 会把它换回来（同一量法下的对照）", async () => {
    const batch = synthSkills(7);
    const query = batch[0]!.summary;
    // buildSkillSection 的 topK 只影响 native 臂
    const text6 = buildSkillSection(batch, { query, topK: 6 });
    const text7 = buildSkillSection(batch, { query, topK: 7 });
    const defLine6 = text6.split("\n").find((l) => l.startsWith("其余 "))!;
    expect(defLine6).toMatch(/^其余 1 个技能/);
    expect(text7.includes("其余 ")).toBe(false); // topK=N ⇒ 无降级行（第三桶在 native 侧同时消失）
    const id6 = /\[([^\]]+)\]/.exec(defLine6)![1]!;
    expect(text7).toContain(`- [${id6}] `); // 同一条，在 topK=7 下变成全化
  });
});

// ---------------------------------------------------------------------------
// §3 对照实验：把 query 由 X 改成 X′ ⇒ native 全化集按可预言方式换人；DSH 目录字节不动
// ---------------------------------------------------------------------------

describe("P2B · 对照实验（query X → X′）", () => {
  /** 手算评分（**独立实现**：本文件自己写点积/模长，不调生产 rankSkills/scoreSkill 的组合）。 */
  const handScore = (query: string, s: SkillDefinition): number => {
    const dot = (a: number[], b: number[]) => a.reduce((acc, v, i) => acc + v * b[i]!, 0);
    const norm = (a: number[]) => Math.sqrt(dot(a, a));
    const q = pseudoEmbed(query);
    const d = pseudoEmbed(`${s.name ?? ""} ${s.capability ?? ""} ${s.summary ?? ""}`);
    const sim = dot(q, d) / (norm(q) * norm(d));
    let lex = 0;
    const qt = lexTokens(query);
    const nameTok = lexTokens(s.name ?? "");
    const capTok = lexTokens(`${s.capability ?? ""}`);
    const sumTok = lexTokens(`${s.summary ?? ""}`);
    for (const t of qt) lex += nameTok.has(t) || capTok.has(t) ? 2 : sumTok.has(t) ? 1 : 0;
    return Math.round((sim + lex * 1e-3) * 1e6) / 1e6;
  };
  // pseudoEmbed 是纯函数（util/embedding.ts），手算与生产共用它 —— 手算的差异只在**组合方式**
  const handRank = (query: string, batch: SkillDefinition[]) =>
    [...batch].sort((a, b) => handScore(query, b) - handScore(query, a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  it("预言：query = 某条的 summary ⇒ 它必须是 native 全化集的第一条（两条不同技能各验一次）", async () => {
    const batch = synthSkills(7);
    const A = batch[2]!;
    const B = batch[5]!;

    const handA = handRank(A.summary, batch);
    const handB = handRank(B.summary, batch);
    // 预言值本身要够硬：第一名与第二名评分必须拉开（否则"可预言"是空话）
    expect(handScore(A.summary, handA[0]!) - handScore(A.summary, handA[1]!)).toBeGreaterThan(0.05);
    expect(handScore(B.summary, handB[0]!) - handScore(B.summary, handB[1]!)).toBeGreaterThan(0.05);
    expect(handA[0]!.id).toBe(A.id);
    expect(handB[0]!.id).toBe(B.id);
    expect(handA[0]!.id).not.toBe(handB[0]!.id); // 两个问句指向不同赢家 —— 这才有"变化"可测

    // 生产臂必须按预言变：X=A.summary 时首条是 A；换成 B.summary 时首条变 B
    const nfA = nativeFace(batch, A.summary);
    const nfB = nativeFace(batch, B.summary);
    expect(nfA.full[0]).toBe(A.id);
    expect(nfB.full[0]).toBe(B.id);
    // 而且被降级的那条也跟着换（第 7 名 = 手算第 7 名）
    expect(nfA.nameOnly).toEqual([handA[6]!.id]);
    expect(nfB.nameOnly).toEqual([handB[6]!.id]);
    // 手算排名与生产排名整体一致（不是只看第一名）
    expect(nfA.full).toEqual(handA.slice(0, 6).map((s) => s.id));
    expect(nfB.full).toEqual(handB.slice(0, 6).map((s) => s.id));
  });

  it("同一实验：DSH 目录字节对 query 逐字节无关（装配期不吃 query ⇒ Y 不变）", async () => {
    const batch = synthSkills(7);
    const app = await driver.makeSkillWorld();
    const fA = await dshFace(batch, { app, agentId: "p2b-qA" });
    const fB = await dshFace(batch, { app, agentId: "p2b-qB" });
    // 目录消息逐字节相同（同一 root 上两个 agent，差异只可能来自 query —— 而它没进来）
    expect(fA.catalogText).toBe(fB.catalogText);
    expect(fA.entries.map((e) => e.name)).toEqual(fB.entries.map((e) => e.name));
    // 反证：换 **spec** 时目录确实会变（否则上面那条可能是"目录根本没渲染"）
    const fSmall = await dshFace([batch[0]!], { app, agentId: "p2b-small" });
    expect(fSmall.catalogText).not.toBe(fA.catalogText);
  });
});

// ---------------------------------------------------------------------------
// §4 L3 附件面：**已声明**的附件在两臂模型面里的可见性（今天数据为空，故为潜在不对称）
// ---------------------------------------------------------------------------

describe("P2B · L3 附件面", () => {
  const withRes = skillDef("attach_demo", "附件演示：当需要读操作指南时使用", "BODY-WITH-ATTACH", {
    resources: [
      { name: "操作指南.md", blobKey: "blob-1", mime: "text/markdown", description: "分步操作说明" },
      { name: "参数表.xlsx", blobKey: "blob-2" },
    ],
  });

  it("DSH 侧：2 个附件名在模型面字节里出现 0 次（目录 + 正文工具结果两处都数）", async () => {
    const df = await dshFace([withRes]);
    const bodyText = df.toolText["attach-demo"]!;
    const both = `${df.catalogText}\n${bodyText}`;
    // 值校验：分母来自**入参**（2 个附件），分子来自**渲染字节**
    expect(withRes.resources).toHaveLength(2);
    for (const r of withRes.resources) expect(both).not.toContain(r.name);
    expect(both).not.toContain("blob-1");
    // 金丝雀（证明上面的 0 不是"工具结果根本没渲染"）：正文与技能名都真的在字节里
    expect(bodyText).toContain(withRes.body);
    expect(bodyText).toContain('name="attach-demo"');
    // 模型实际看到的替代句（resourceBase 未设 ⇒ 提示词归 provider 管）
    expect(bodyText).toContain("managed by provider");
    // 数据面侧证：spec 里 resources **在**（所以丢的不是数据是消费）
    expect(mapSkill(withRes).resources).toEqual([
      { name: "操作指南.md", blobKey: "blob-1", mime: "text/markdown", description: "分步操作说明" },
      { name: "参数表.xlsx", blobKey: "blob-2" },
    ]);
  });

  it("种子事实：今天 7 条种子技能 resources 全为空 ⇒ 上面那条不对称**用户不可见**", () => {
    const { skills } = seedRegistry("2026-01-01T00:00:00.000Z");
    expect(skills.filter((s) => s.resources.length > 0)).toHaveLength(0);
    // 金丝雀：同一条断言在**有附件**的样例上会红（证明它不是恒真）
    expect([withRes].filter((s) => s.resources.length > 0)).toHaveLength(1);
  });

  // ⚠ NOT-MEASURED：native 臂的 L3 半边（`load_skill` 的 tool_result 里带不带附件清单）
  //   需要真起 ExecutionEngine + 脚本化 LLM 才测得到，属 engine.ts 的 P5 范围，本单不驱动。
  //   静态读数（未经运行验证，只作线索不作结论）：engine.ts 的 native `loadSkill` 把
  //   `skill.resources` 逐条映射成 `{name,url,mime,description}` 放进返回值；
  //   DSH 侧 harness 全仓无 `resources` → `resourceBase` 的映射（platform-world.mjs 的
  //   provider `get()` 只回 `{name,description,invocation,source,provider,content}`）。
});

// ---------------------------------------------------------------------------
// §5 逐条对比表（人可读，`P2B_DUMP=1` 时打印；默认静默，不给常规跑加噪声）
//   `P2B_DUMP=1 pnpm exec vitest run test/dsh-skill-routing-parity.seam.test.ts -t 逐条对比表`
// ---------------------------------------------------------------------------

describe("P2B · 逐条对比表", () => {
  it.runIf(process.env.P2B_DUMP === "1")("打印两臂技能可见面（真实租户集 + N=7 合成集）", async () => {
    const { skills: seedSkills } = seedRegistry("2026-01-01T00:00:00.000Z");
    for (const [title, batch, query] of [
      ["真实租户集（seed 5 条 PUBLISHED）", selectTenantSkills(seedSkills), "4680-NCM 还能接多少量？"],
      ["合成集 N=7 > topK=6", synthSkills(7), synthSkills(7)[2]!.summary],
    ] as const) {
      const { rows, nf, df } = await compareRows(batch as SkillDefinition[], query as string);
      console.log(`\n=== ${title} · query="${query}" ===`);
      console.log(`native 字节长=${nf.text.length}  full=${nf.full.length} nameOnly=${nf.nameOnly.length} invisible=${nf.invisible.length}`);
      console.log(`DSH    目录字节长=${df.catalogText.length}  条目=${df.entries.length}  可加载=${df.loadable.length}`);
      for (const r of rows) console.log(`  ${r.key.padEnd(24)} native=${r.native.padEnd(10)} dsh=${r.dsh.padEnd(10)} descExact=${r.descExact} 一次调用取正文=${r.dshBodyViaOneCall}`);
    }
  });
});

// ---------------------------------------------------------------------------
// 合成批次：7 条、key 合规、summary 短且互不重复
// ---------------------------------------------------------------------------

function synthSkills(n: number): SkillDefinition[] {
  const topics = ["产能", "订单", "风险", "供应", "质量", "集成", "成本"];
  return Array.from({ length: n }, (_, i) =>
    skillDef(
      `synth_${i}`,
      `第${i}号触发器：当用户问${topics[i % topics.length]}相关口径时使用`,
      `BODY-${i}`,
      { id: `skl_synth_${i}`, name: `合成技能${i}`, capability: ["analysis", "planning", "quality"][i % 3] },
    ),
  );
}
