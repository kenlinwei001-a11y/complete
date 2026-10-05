/**
 * WO-DSH-SOLVER-GATE · wire 面：声明怎么上 wire、畸形怎么被拒、桥没 arm 时会话能不能出生。
 *
 * 与 `dsh-solver-precondition.seam.test.ts` 的分工：那条咬**效果层**（模型真收到什么，真 fork 真子进程）；
 * 本条咬**声明面**的三个边界，都是「绿测试 ≠ 能用」里最容易漏的一侧：
 *   ① 零扰动锚：没声明的技能，wire 上**不许**多出 `solverPreconditions` 键（setup 帧逐字节旧行为）；
 *   ② 畸形拒绝：键存在但空数组/非串/空串 ⇒ 创建期抛（⛔ 不静默当"没声明"——那会让门悄悄消失）；
 *   ③ **未 armed 的桥 + 声明了 preconditions ⇒ 会话不许出生**。这条是本单「门不许恒关」的机器：
 *      若允许它在无桥状态下出生，门会恒关（每次都拿不到正文），而**恒关在验收里会被读成"门生效"**。
 *      ⛔ 反向金丝雀 ④ 咬它：同一个未 armed 的世界，**没声明**的技能照常挂载并取到正文 ——
 *      证明 ③ 的抛错归因于「声明了却没桥」，不是「这个世界本来就坏」。
 *
 * 世界在 packages/dsh-harness/test/skill-seam-driver.mjs（@deepseek-ai/* 只在那边解析得到）；
 * 该世界的 tool-bridge 插件**没挂**（`getSkillPrecondProbe()` 恒 null）—— 正是 ③④ 要的那个状态。
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import type { SkillDefinition } from "@platform/contracts";
import { buildSessionSetup, mapSkill } from "../src/dsh-runtime/index.js";
import { seedRegistry } from "../src/mocks/seed.js";

const HARNESS_DIR = fileURLToPath(new URL("../../../packages/dsh-harness", import.meta.url));
const DRIVER = `${HARNESS_DIR}/test/skill-seam-driver.mjs`;

type Driver = {
  makeSkillWorld(): Promise<unknown>;
  makeSkillAgent(app: unknown, tenantId: string, id: string): { agent: unknown; ctx: unknown };
  mountSetupSpec(agentCtx: unknown, spec: unknown): Promise<void>;
  callSkillTool(app: unknown, agent: unknown, name: string, callId?: string): Promise<{ text: string; isError: boolean }>;
};

const driver = (await import(DRIVER)) as unknown as Driver;

/** 门探针单例（tool-bridge 无裸依赖，可直接取；与驱动世界共用同一份模块实例）。 */
const toolBridge = (await import(`${HARNESS_DIR}/plugins/tool-bridge.mjs`)) as unknown as {
  setSkillPrecondProbe(fn: unknown): void;
};

const agentDef = () => ({
  id: "agt_gate_wire",
  tenantId: "t1",
  key: "gate_wire_agent",
  version: 1,
  name: "Gate Wire",
  description: "",
  model: "",
  systemPrompt: "You are a capacity planner.",
  tools: [],
  ruleBindings: { ruleKeys: [], mode: "PRE_CHECK" as const },
  skills: [],
  mcpServers: [],
  scopeDeclaration: { objectTypes: [], toolNames: [] },
  status: "PUBLISHED" as const,
});

function specFor(skills: SkillDefinition[]) {
  return buildSessionSetup({
    agent: agentDef(),
    agentSystemCore: "CORE",
    grantedToolNames: [],
    skills,
  });
}

const skillDef = (key: string, body = "BODY"): SkillDefinition => ({
  id: `skl_${key}`,
  tenantId: "t1",
  key,
  version: 1,
  name: `名-${key}`,
  summary: `${key} 的触发短句`,
  body,
  resources: [],
  status: "PUBLISHED",
});

/** 真实断言对象：wire 上那条技能项（不是 mapSkill 的中间值）。 */
function skillWire(spec: unknown, i = 0): Record<string, unknown> {
  const list = (spec as { skills?: unknown[] }).skills;
  if (!Array.isArray(list) || list[i] === undefined) throw new Error("[探针坏了] spec.skills 里没有该项");
  return list[i] as Record<string, unknown>;
}

describe("WO-DSH-SOLVER-GATE · wire 面（声明上 wire / 畸形拒绝 / 无桥不许出生）", () => {
  it("① 零扰动锚：未声明（含显式空数组）⇒ wire 上不出现 solverPreconditions 键", () => {
    const s = skillDef("capacity_check");
    // 引擎分叉的调用形态 = 第三个位置参数；两条路径都要保证「没声明 = 键不存在」（setup 帧逐字节旧行为）。
    for (const [where, spec] of [
      ["mapSkill 不传第三参（既有调用方）", mapSkill(s)],
      ["mapSkill 传空数组（本单新路径）", mapSkill(s, undefined, [])],
    ] as const) {
      expect("solverPreconditions" in spec, `${where}：键不许出现`).toBe(false);
      expect(JSON.stringify(spec)).not.toContain("solverPreconditions");
    }
  });

  it("② 声明面：真种子的那条技能经 mapSkill 后，键与值逐字上 wire", () => {
    const specimen = seedRegistry().skills.find((x) => x.key === "capacity_action_draft");
    expect(specimen, "种子技能必须在（本单试验品）").toBeDefined();
    const spec = mapSkill(specimen!, undefined, ["capacity_forecast"]);
    expect(spec.dshName).toBe("capacity-action-draft"); // 下划线换横线（模型面用的是这个名字）
    expect(skillWire({ skills: [spec] }).solverPreconditions).toEqual(["capacity_forecast"]);
  });

  it("③ 畸形拒绝：空数组 / 非串 / 空串 ⇒ 创建期抛（⛔ 不许静默当「没声明」，那会让门悄悄消失）", async () => {
    const app = await driver.makeSkillWorld();
    const base = specFor([mapSkill(skillDef("capacity_check"), undefined, ["capacity_forecast"])]);

    for (const bad of [[], ["ok", 7], [""], [null]] as unknown[][]) {
      const spec = { ...base, skills: [{ ...skillWire(base), solverPreconditions: bad }] };
      const world = driver.makeSkillAgent(app, "t1", `ag-bad-${JSON.stringify(bad)}`);
      await expect(
        driver.mountSetupSpec(world.ctx, spec),
        `solverPreconditions=${JSON.stringify(bad)} 必须在创建期被拒`,
      ).rejects.toThrow(/solverPreconditions/);
    }

    // 金丝雀（控制组）：**值合式**的那一条（同一个世界、同一份 spec 形状、桥同样 armed）挂得上去 ——
    // 否则上面四条可能只是「这个 spec 形状本来就挂不上」，而不是「因为它们畸形」。
    // 桥在本世界缺省是空的，这里显式 arm 一个恒「无未满足项」的探针，只为把变量收敛到"值"这一个；
    // finally 归零 —— 下面 ④ 要的正是**未 arm** 的世界，共用同一份单例，不许串味。
    try {
      toolBridge.setSkillPrecondProbe(async () => ({ missing: [] }));
      await expect(driver.mountSetupSpec(driver.makeSkillAgent(app, "t1", "ag-ok").ctx, base)).resolves.toBeUndefined();
    } finally {
      toolBridge.setSkillPrecondProbe(null);
    }
  });

  it("④ 桥没 arm 而技能声明了 precondition ⇒ 会话不许出生（门恒关不许冒充门生效）", async () => {
    const app = await driver.makeSkillWorld();
    const world = driver.makeSkillAgent(app, "t1", "ag-unarmed");
    const spec = specFor([mapSkill(skillDef("capacity_check"), undefined, ["capacity_forecast"])]);
    await expect(driver.mountSetupSpec(world.ctx, spec)).rejects.toThrow(/platform-tool-bridge/);
  });

  it("④-反向金丝雀：同一个未 arm 的世界，没声明的技能照常可用（咬「世界本来就坏」这个替代解释）", async () => {
    const app = await driver.makeSkillWorld();
    const world = driver.makeSkillAgent(app, "t1", "ag-plain");
    await expect(driver.mountSetupSpec(world.ctx, specFor([mapSkill(skillDef("capacity_check"))]))).resolves.toBeUndefined();
    const hit = await driver.callSkillTool(app, world.agent, "capacity-check");
    expect(hit.isError).toBe(false);
    expect(hit.text).toContain("BODY");
  });
});
