/**
 * WO-DSH-P2A-SKILL-SEAM · 技能目录/加载走 dsh 原生缝 —— **接缝套件**。
 *
 * 四段链路一次驱动，任一段断即红：
 *   ① agentcore 造 spec：真 `buildSessionSetup` + 真 `mapSkill`（src/dsh-runtime/setup-spec.ts）
 *   ② wire 形态：真 `validateSetupSpec`（畸形 spec 创建期抛）
 *   ③ harness 注册：真 `applySetupSpec` → `ctx.skills.registerProvider`（平台自有 provider，
 *      来源 = 本 run 的 spec.skills，不是文件系统）
 *   ④ 模型面：真 dsh-tool-skill 的 `skill` 工具 + `ctx.skills.snapshot({scope})`
 *      （目录与全文都只从 ctx.skills 现取 —— 就是 model face 的那两个字节面）
 *
 * 世界搭建在 packages/dsh-harness/test/skill-seam-driver.mjs（@deepseek-ai/* 只在那边解析得到）；
 * spec 由本文件从真 agentcore 函数取了传进去 —— 不各半自证。
 *
 * ⚠ 本套件不覆盖 `<system-reminder>` 目录消息的**字面包装**：那段由 dsh-tool-skill 的
 * `agent/pre-step` 监听在真 dsh agent 会话里拼（读 agent.session.surface/events），
 * 本套件没有真 session 可挂 ⇒ 只断言到「监听器读的那份目录数据」为止（见报告 NOT-MEASURED）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SkillDefinition } from "@platform/contracts";
import { buildSessionSetup, mapSkill } from "../src/dsh-runtime/index.js";

const HARNESS_DIR = fileURLToPath(new URL("../../../packages/dsh-harness", import.meta.url));
const DRIVER = `${HARNESS_DIR}/test/skill-seam-driver.mjs`;

type Driver = {
  CATALOG_DESCRIPTION_MAX_LENGTH: number;
  makeSkillWorld(): Promise<unknown>;
  makeSkillAgent(app: unknown, tenantId: string, id: string): {
    agent: unknown;
    scope: { dispose(): Promise<void> };
    ctx: unknown;
  };
  mountSetupSpec(agentCtx: unknown, spec: unknown): Promise<void>;
  catalogOf(app: unknown, agent: unknown): Promise<{ complete: boolean; skills: { name: string; description: string }[] }>;
  callSkillTool(app: unknown, agent: unknown, name: string, callId?: string): Promise<{ text: string; isError: boolean }>;
  hasSkillTool(app: unknown, agent: unknown): boolean;
};

const driver = (await import(DRIVER)) as unknown as Driver;

/** 最小 AgentDefinition（只喂 buildSessionSetup 真读的字段）。 */
const agentDef = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "agt_p2a",
  tenantId: "t1",
  key: "p2a_agent",
  version: 1,
  name: "P2A",
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

const skillDef = (key: string, summary: string, body: string, version = 1): SkillDefinition => ({
  id: `skl_${key}`,
  tenantId: "t1",
  key,
  version,
  name: `名-${key}`,
  summary,
  body,
  resources: [],
  status: "PUBLISHED",
});

/**
 * 从真 agentcore 映射出 wire spec（① + ②），再挂进真 harness 世界（③）。
 * `app` 可传入复用（同一 root 上多 agent 做对照）。
 */
async function seam(
  skills: SkillDefinition[],
  opts: { app?: unknown; tenantId?: string; agentId?: string; toolNames?: string[] } = {},
) {
  const agent = agentDef({ skills: [] });
  const setup = buildSessionSetup({
    agent,
    agentSystemCore: "CORE",
    grantedToolNames: opts.toolNames ?? [],
    skills: skills.map((s) => mapSkill(s)),
  });
  const app = opts.app ?? (await driver.makeSkillWorld());
  const world = driver.makeSkillAgent(app, opts.tenantId ?? "t1", opts.agentId ?? "agent-a");
  await driver.mountSetupSpec(world.ctx, setup);
  return { app, world, setup };
}

// ---------------------------------------------------------------------------
// ① 目录：spec.skills 由 N → N'，模型面目录按可预言方式变
// ---------------------------------------------------------------------------

describe("P2A 接缝 · 模型面目录", () => {
  it("同一 root 三个 agent：N=2 / N=1 / N=0 ⇒ 目录逐条跟着 spec 变", async () => {
    const two = [
      skillDef("capacity_check", "产能校验：当用户问某型号能否按时交付时使用", "BODY-A"),
      skillDef("order_tracking", "订单跟踪：当用户问订单当前状态时使用", "BODY-B"),
    ];
    // 同一个 root（世界固定），差异只来自各自那份 spec —— 三档一次对照。
    const app = await driver.makeSkillWorld();
    const a2 = await seam(two, { app, agentId: "agent-two" });
    const a1 = await seam([two[1]!], { app, agentId: "agent-one" });
    const a0 = await seam([], { app, agentId: "agent-zero" });

    // 目录按名字码点升序（dsh-skill compareSkillSummary）——顺序可预言，不是插入序。
    expect(await driver.catalogOf(app, a2.world.agent)).toEqual({
      complete: true,
      skills: [
        { name: "capacity-check", description: two[0]!.summary },
        { name: "order-tracking", description: two[1]!.summary },
      ],
    });
    // N=2 → N=1：少的那条必须消失（不是只看条数），留下那条的字节逐字不变。
    expect(await driver.catalogOf(app, a1.world.agent)).toEqual({
      complete: true,
      skills: [{ name: "order-tracking", description: two[1]!.summary }],
    });
    // N=1 → N=0：空目录。
    expect(await driver.catalogOf(app, a0.world.agent)).toEqual({ complete: true, skills: [] });
  });

  it("同一条技能换个 summary ⇒ 目录那一行逐字节跟着换（读的是本次 spec，不是缓存）", async () => {
    const app = await driver.makeSkillWorld();
    const before = await seam([skillDef("capacity_check", "旧的触发器短句", "BODY-A")], { app, agentId: "ag-1" });
    const after = await seam([skillDef("capacity_check", "改后的触发器短句", "BODY-A")], { app, agentId: "ag-2" });
    expect((await driver.catalogOf(app, before.world.agent)).skills[0]!.description).toBe("旧的触发器短句");
    expect((await driver.catalogOf(app, after.world.agent)).skills[0]!.description).toBe("改后的触发器短句");
  });

  it("空技能 ⇒ 目录空且 spec 不带 skills 键；非空 ⇒ 键在（setup 帧逐字节旧行为边界）", async () => {
    const empty = await seam([]);
    expect(empty.setup.skills).toBeUndefined();
    expect((await driver.catalogOf(empty.app, empty.world.agent)).skills).toEqual([]);

    const nonEmpty = await seam([skillDef("a_b", "s", "b")]);
    expect(nonEmpty.setup.skills).toHaveLength(1);
  });

  it("scope 隔离：A 的技能不进 B 的目录（同 tenant 同 root）", async () => {
    const { app, world } = await seam([skillDef("capacity_check", "s", "b")]);
    const other = driver.makeSkillAgent(app, "t1", "agent-b");
    expect((await driver.catalogOf(app, world.agent)).skills).toHaveLength(1);
    expect((await driver.catalogOf(app, other.agent)).skills).toEqual([]);
    // B 看不到 → 连技能全文也取不到（fail-closed，不是"看得到但取不到"）。
    const miss = await driver.callSkillTool(app, other.agent, "capacity-check", "p2a-b");
    expect(miss.isError).toBe(true);
    expect(miss.text).toContain("is unknown or no longer available");
  });
});

// ---------------------------------------------------------------------------
// ② 全文加载：模型调 `skill`，拿到的是 <skill_content> 包裹的 body 逐字节
// ---------------------------------------------------------------------------

describe("P2A 接缝 · 模型面全文加载", () => {
  it("命中：tool_result = renderSkillContent(body 逐字节 + 名字在属性位)", async () => {
    const body = "第一行\n第二行 <b>不转义正文</b>\n";
    const { app, world } = await seam([skillDef("capacity_check", "s", body)]);
    const hit = await driver.callSkillTool(app, world.agent, "capacity-check");
    expect(hit.isError).toBe(false);
    // 正文逐字节落在 <skill_instructions> 里（正文不转义；只有名字走 escapeAttr）。
    expect(hit.text).toContain(`<skill_instructions>\n${body}\n</skill_instructions>`);
    expect(hit.text).toContain('<skill_content name="capacity-check">');
  });

  it("fail-closed：合式名但目录里没有 ⇒ 明确否定 + isError，绝不编造正文", async () => {
    const { app, world } = await seam([skillDef("capacity_check", "s", "BODY-A")]);
    for (const name of ["order-tracking", "capacity-check-x", "final-answer"]) {
      const miss = await driver.callSkillTool(app, world.agent, name, `p2a-miss-${name}`);
      expect(miss.isError).toBe(true);
      expect(miss.text).toContain("is unknown or no longer available");
      expect(miss.text).not.toContain("BODY-A");
    }
    // 负向对照：名字对了就取得到（证明上面那批不是"工具整体坏了"）。
    expect((await driver.callSkillTool(app, world.agent, "capacity-check")).text).toContain("BODY-A");
  });

  it("不合式名（下划线/空串）⇒ 更早一道就拒（我方 key 不经映射直接喂 = 取不到）", async () => {
    const { app, world } = await seam([skillDef("capacity_check", "s", "BODY-A")]);
    for (const name of ["capacity_check", "capacity--check", ""]) {
      const bad = await driver.callSkillTool(app, world.agent, name, `p2a-bad-${name}`);
      expect(bad.isError).toBe(true);
      expect(bad.text).toContain("invalid skill name");
      expect(bad.text).not.toContain("BODY-A");
    }
  });
});

// ---------------------------------------------------------------------------
// ③ 治理闸对齐：`skill` 必须在 spec.tools 允许表里，否则 platform-world 白名单 deny
// ---------------------------------------------------------------------------

describe("P2A 接缝 · 允许表", () => {
  it("有技能 ⇒ 允许表含 `skill`（且不再含已摘除的 load_skill）", () => {
    const setup = buildSessionSetup({
      agent: agentDef() as never,
      agentSystemCore: "CORE",
      grantedToolNames: [],
      skills: [mapSkill(skillDef("capacity_check", "s", "b"))],
    });
    const names = setup.tools!.map((t) => t.name);
    expect(names).toContain("skill");
    expect(names).toContain("final_answer");
    expect(names).not.toContain("load_skill");
  });

  it("无技能 ⇒ 允许表不含 `skill`（键不出：空技能 agent 的模型面零技能字节）", () => {
    const setup = buildSessionSetup({ agent: agentDef() as never, agentSystemCore: "CORE", grantedToolNames: [] });
    expect(setup.tools!.map((t) => t.name)).not.toContain("skill");
  });
});

// ---------------------------------------------------------------------------
// ④ 映射期 fail-closed：违规技能名/空描述不许静默变成"目录少一条"
// ---------------------------------------------------------------------------

describe("P2A 映射期 fail-closed", () => {
  it("key 折出的 dsh 名不合 SKILL_NAME ⇒ mapSkill 抛（不是目录静默少一条）", () => {
    expect(() => mapSkill(skillDef("Capacity_Check", "s", "b"))).toThrow(/SKILL_NAME/);
    expect(() => mapSkill(skillDef("a__b", "s", "b"))).toThrow(/SKILL_NAME/);
    // 金丝雀：合法 key 不抛（否则上两条可能是"函数整体坏了"）。
    expect(mapSkill(skillDef("capacity_check", "s", "b")).dshName).toBe("capacity-check");
  });

  it("空 summary ⇒ mapSkill 抛（dsh 要求非空 description）", () => {
    expect(() => mapSkill(skillDef("capacity_check", "", "b"))).toThrow(/empty summary/);
  });

  it("两个 key 折成同一个 dsh 名 ⇒ buildSessionSetup 抛（不是静默少一条）", () => {
    const collide = [mapSkill(skillDef("a_b", "s", "b1")), mapSkill(skillDef("a-b", "s", "b2"))];
    expect(() =>
      buildSessionSetup({ agent: agentDef() as never, agentSystemCore: "CORE", grantedToolNames: [], skills: collide }),
    ).toThrow(/duplicate dsh skill name/);
  });

  it("wire 校验：畸形 spec 创建期抛（不给 harness 静默跳过 provider 的机会）", async () => {
    const { validateSetupSpec } = (await import(`${HARNESS_DIR}/plugins/platform-world.mjs`)) as {
      validateSetupSpec: (s: unknown) => unknown;
    };
    const ok = { key: "k", dshName: "a-b", description: "d", content: "c" };
    expect(() => validateSetupSpec({ skills: [ok] })).not.toThrow();
    for (const bad of [
      { ...ok, dshName: "A_B" },
      { ...ok, description: "" },
      { ...ok, content: undefined },
      { ...ok, key: undefined },
      { key: "k", dshName: "a-b", description: "d", body: "c" }, // 旧形状（换成 content 后旧键不再够用）
    ]) {
      expect(() => validateSetupSpec({ skills: [bad] })).toThrow(/setup\.skills/);
    }
    // 金丝雀：同一 validate 对合法 spec 放行（否则上面是"函数恒抛"）。
    expect(() => validateSetupSpec({ skills: [ok] })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// ⑤ 部署档：三份 cordis 档都挂了消费方，且目录上限钉在 200（= 我方 summary 契约上限）
// ---------------------------------------------------------------------------

describe("P2A 部署档", () => {
  for (const file of ["cordis.yml", "cordis.l2.yml", "cordis.poc.yml"]) {
    it(`${file} 挂 @deepseek-ai/dsh-tool-skill 且 catalogDescriptionMaxLength=200`, () => {
      const yml = readFileSync(`${HARNESS_DIR}/${file}`, "utf8");
      expect(yml).toContain("'@deepseek-ai/dsh-tool-skill'");
      expect(yml).toMatch(/catalogDescriptionMaxLength:\s*200/);
    });
  }

  it("驱动件钉的上限与部署档同值（两处各写一份，改了任一处即红）", () => {
    expect(driver.CATALOG_DESCRIPTION_MAX_LENGTH).toBe(200);
  });
});
