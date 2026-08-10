import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_BUDGET, skillBudgetOverride, SkillDefinitionSchema, type EvalCase, type SkillDefinition } from "@platform/contracts";
import { createTestApp, ADMIN, TENANT, PKG, type TestApp } from "./helpers.js";
import { seedRegistry } from "../src/mocks/seed.js";
import { extractRelations } from "../src/dril/resource-projector.js";
import { text, toolUse } from "../src/llm/mock.js";

/**
 * WO-SKILL-PARTIAL-A · 两份「部分实现」PRD 的缺口收口 —— 接缝驱动测（SEAM-GATE）。
 *
 * 三条断言各咬一种「不工作」的形态，修法完全不同，故分开咬：
 *  A. `maxBudgetRounds` **没接线**（调用方集合只有 test）→ 咬「改这个数 → 探索轮次真变」（效果层，非"读出来了"）。
 *  B. `dependsOn` **接了线没数据**（seed 0 条 ⇒ 四个真消费方从不触发）→ 咬「出厂种子真的驱动了消费方」。
 *  C. `POST /b/v1/skills/lint` 干跑 **接了线接错地方**（只摘三字段 + 不传 ctx）→ 咬「干跑与发布同口径」。
 *
 * 纪律：每条都必须能被「掐掉新接的线」变红——变异反证见各 it 的注释。
 */

const H = { "x-debug-user": ADMIN, "content-type": "application/json" };
const AUTH = { tenantId: TENANT, userId: "u-probe", roles: ["catalog_admin"] };

const GOOD_SUMMARY = "当用户问预算探针测试问题时使用。不适用：其他一切问题。";
const GOOD_BODY = `## 目的
预算接线测试。
## 适用边界
适用：测试。不适用：其他。
## 前置检查
无。
## 步骤
1. 先取数再作答。
## 示例
正例：问测试 → 取数后作答。
反例：不取数直接编造。
## 失败处理
无数据即说明缺什么。
## 输出要求
按结论/证据组织。`;

function skillFixture(overrides: Partial<SkillDefinition> & { key: string }): SkillDefinition {
  // `.strict().parse`：fixture 不许自造契约里没有的字段/值（本文件的断言全靠"生产真能出现这种 skill"成立）。
  return SkillDefinitionSchema.strict().parse({
    id: `skl_${overrides.key}`,
    tenantId: TENANT,
    key: overrides.key,
    version: 1,
    name: `Fixture ${overrides.key}`,
    summary: GOOD_SUMMARY,
    body: GOOD_BODY,
    resources: [],
    status: "PUBLISHED",
    sideEffect: "READ",
    ...overrides,
  });
}

function probeCase(skillKey: string): EvalCase {
  return {
    id: `ec_${skillKey}_1`,
    tenantId: TENANT,
    suite: "skill_quality",
    packageId: PKG,
    skillKey,
    input: { query: "预算探针测试问句", context: { view: "dash", selectedObjects: [], filters: {} } },
    expect: { toolSequence: [{ name: "load_skill" }] },
    origin: "MANUAL",
    createdAt: new Date().toISOString(),
  };
}

/**
 * 排两轮：第 1 轮调工具（消耗一个 round-trip），第 2 轮才 final_answer。
 * ⇒ maxRoundTrips=1 时第 2 轮永不发生（下一轮迭代前硬预算降级，`agent/loop.ts:739`）。
 */
function queueTwoRoundTurns(t: TestApp): void {
  t.llm.queueAgentTurn(
    { content: [text("先取数。"), toolUse("query_objects", { objectType: "Base", filter: {}, limit: 5 })] },
    { content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "取数后的答案。" }], provenance: [] })] },
  );
}

// ---------------------------------------------------------------------------
// A · maxBudgetRounds：从「零生产消费方」到「改数→行为真变」
// ---------------------------------------------------------------------------
describe("A · maxBudgetRounds 接线（PRD-skill-contract-dsl §4.6 · Track E 约束 4）", () => {
  it("单源纯函数 skillBudgetOverride：未声明→undefined（字节兼容）；声明→取 min(声明, 平台上界)（只收紧不放宽）", () => {
    expect(skillBudgetOverride([])).toBeUndefined();
    expect(skillBudgetOverride([{}])).toBeUndefined();
    expect(skillBudgetOverride([{ maxBudgetRounds: undefined }])).toBeUndefined();
    // 声明值 < 平台上界 → 收紧生效
    expect(skillBudgetOverride([{ maxBudgetRounds: 3 }])).toEqual({ maxRoundTrips: 3 });
    // 红线：声明值 > 平台上界 → **不得放宽**（否则一个 Skill 就能顶开全局护栏）
    expect(skillBudgetOverride([{ maxBudgetRounds: DEFAULT_AGENT_BUDGET.maxRoundTrips + 100 }])).toEqual({
      maxRoundTrips: DEFAULT_AGENT_BUDGET.maxRoundTrips,
    });
    // 多 skill 在场 → 最保守者说了算
    expect(skillBudgetOverride([{ maxBudgetRounds: 9 }, { maxBudgetRounds: 2 }])).toEqual({ maxRoundTrips: 2 });
    // 非法值（0/负/小数）不参与，等价未声明
    expect(skillBudgetOverride([{ maxBudgetRounds: 0 }, { maxBudgetRounds: -1 }, { maxBudgetRounds: 1.5 }])).toBeUndefined();
  });

  it("SEAM · 声明 maxBudgetRounds=1 → 探针真跑时第二轮 LLM 调用**不再发生**（效果层，非“字段读出来了”）", async () => {
    const t = await createTestApp();
    const skill = skillFixture({ key: "budget_tight", maxBudgetRounds: 1 });
    await t.repos.skills.insert(skill);
    await t.repos.evalCases.upsert(probeCase("budget_tight"));
    queueTwoRoundTurns(t);

    await t.deps.evals.runSkillProbe(AUTH, "budget_tight", { skillId: skill.id });

    // round-trip 上界 1 ⇒ 第 1 轮（工具）跑完 roundTrips=1，第 2 轮迭代前 `roundTripsExceeded()` 触发降级。
    // 变异反证：把 skill-probe.ts 里 `...(budgetOverride ?? {})` 删掉（= 掐掉本单新接的线）→ 这里变成 2，本条红。
    expect(t.llm.agentRequests.length).toBe(1);
  });

  it("SEAM 对照 · 同一 skill 不声明 maxBudgetRounds → 第二轮照跑（证上一条红的是预算，不是别的东西）", async () => {
    const t = await createTestApp();
    const skill = skillFixture({ key: "budget_default" });
    await t.repos.skills.insert(skill);
    await t.repos.evalCases.upsert(probeCase("budget_default"));
    queueTwoRoundTurns(t);

    await t.deps.evals.runSkillProbe(AUTH, "budget_default", { skillId: skill.id });

    expect(t.llm.agentRequests.length).toBe(2);
  });

  it("出厂种子里有活体演练者：seedRegistry 至少一个 skill 声明 maxBudgetRounds 且被单源函数收下", () => {
    // 防「接了线没数据」复发：没有出厂数据时，判定退化成死代码也没有任何真实数据会让它红。
    const declaring = seedRegistry().skills.filter((s) => typeof s.maxBudgetRounds === "number");
    expect(declaring.length).toBeGreaterThanOrEqual(1);
    for (const s of declaring) {
      expect(skillBudgetOverride([s])).toEqual({ maxRoundTrips: Math.min(s.maxBudgetRounds!, DEFAULT_AGENT_BUDGET.maxRoundTrips) });
    }
  });
});

// ---------------------------------------------------------------------------
// B · dependsOn：从「接了线没数据」到「出厂种子真的驱动消费方」
// ---------------------------------------------------------------------------
describe("B · dependsOn 出厂数据（消费方此前从不触发）", () => {
  it("seedRegistry 的 dependsOn 非空，且每条 kind=skill 的依赖都能在同批种子里解析到 PUBLISHED 目标", () => {
    const skills = seedRegistry().skills;
    const withDeps = skills.filter((s) => (s.dependsOn ?? []).length > 0);
    // 变异反证：删掉 seed.ts 里那条 dependsOn → 本条红（此前全仓种子 dependsOn 恒 0 条）。
    expect(withDeps.length).toBeGreaterThanOrEqual(1);
    for (const s of withDeps) {
      for (const dep of s.dependsOn ?? []) {
        if (dep.kind !== "skill") continue;
        const target = skills.find((x) => x.key === dep.key);
        expect(target, `dependsOn 指向的 skill「${dep.key}」不在种子里`).toBeTruthy();
        // 发布门 requirePublishedDeps=true（server.ts:1246）：出厂技能必须能过自己的门。
        expect(target!.status).toBe("PUBLISHED");
      }
    }
  });

  it("WO-SKILL-4 抽取器 + 出厂数据这一对现在成立（extractRelations 对种子真产 dependsOn 边）", () => {
    const { skills, agents, workflows } = seedRegistry();
    const rels = extractRelations({ workflows, agents, skills, rules: [] });
    const depEdges = rels.filter((r) => r.fromKind === "skill" && r.relType === "dependsOn");
    // 变异反证：删掉 seed 那条 dependsOn → depEdges 空 → 本条红。
    expect(depEdges.length).toBeGreaterThanOrEqual(1);
    expect(depEdges.every((r) => r.toKind === "skill")).toBe(true);
  });

  /**
   * ⚠️ 诚实边界（**别把上一条读成"链路通了"**）。本仓有**两个**关系抽取器，名字近、职责重叠：
   *   ① `dril/resource-projector.ts:296 extractRelations`      —— 认 skill.references/dependsOn，**零 src 调用方**
   *      （金丝雀：同文件的 `projectSkills` 有 2 处 src 调用方 `dril/resource-registry.ts:17,188`；
   *        `extractRelations` 只有它自己的定义行 —— 工具是好的，是它真没人调）。
   *   ② `dril/relations.ts:44 extractResourceRelations`        —— **生产真用的那个**（`resource-registry.ts:220`），
   *      只做 workflow→solver/slice/rule 与 agent→skill，**整段不读 skill.references/dependsOn**。
   * 故「补了种子数据」只闭合了 skill-lint 那半（上一个 describe 的第三条：发布门 lint 真吃到了 dependsOn），
   * DRIL 资源图那半仍是 **没接线**（不是「接了线没数据」）—— 本体 §8 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` ①，
   * 且本体 §2.H「Skill 资源投影（WO-SKILL-4）」那句「并写入 resource_relations（…references/dependsOn 关系）」**与代码不符**。
   * 本条把这个诚实状态钉住：谁哪天把 ① 接上生产（或把 dependsOn 搬进 ②），本条会红 —— 那时请一并回写本体 §2.H/§8。
   */
  it("诚实边界 · 生产投影路径今天仍不产 skill→skill 的 dependsOn 边（钉住 G-SKILL-REFGRAPH-DEAD-EXTRACTOR ①）", async () => {
    const t = await createTestApp();
    const { skills, agents, workflows } = seedRegistry();
    for (const w of workflows) await t.repos.workflows.insert(w);
    for (const s of skills) await t.repos.skills.insert(s);
    for (const a of agents) await t.repos.agents.insert(a);

    // 真跑生产投影（GET /b/v1/resources 触发 ResourceRegistryService.projectTenant → 落 resource_relations）。
    const res = await t.app.inject({ method: "GET", url: "/b/v1/resources", headers: H });
    expect(res.statusCode).toBe(200);
    const rels = await t.repos.resourceRelations.listByTenant(TENANT);

    // 正对照：生产抽取器确实在干活（workflow→solver）——证下面那条 0 不是"投影压根没跑"。
    expect(rels.some((r) => r.fromKind === "workflow" && r.toKind === "solver" && r.relType === "invokes")).toBe(true);
    // 诚实事实：skill 的 references/dependsOn 一条都没进资源图。
    expect(rels.filter((r) => r.fromKind === "skill" && (r.relType === "dependsOn" || r.relType === "references"))).toEqual([]);
  });

  it("SEAM · 出厂种子过发布门的 lint（含 requirePublishedDeps 与依赖图环检测两条跨资源规则）", async () => {
    const t = await createTestApp();
    const { skills } = seedRegistry();
    for (const s of skills) await t.repos.skills.insert(s);
    const dependant = skills.find((s) => (s.dependsOn ?? []).length > 0)!;

    // 干跑 lint 走的是本单补好的挂载点（全量输入 + ctx.allSkills）。
    const res = await t.app.inject({ method: "POST", url: "/b/v1/skills/lint", headers: H, payload: { id: dependant.id } });
    expect(res.statusCode).toBe(200);
    const out = res.json() as { ok: boolean; violations: { rule: string }[] };
    expect(out.violations.filter((v) => v.rule.startsWith("dependsOn"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// C · lint 干跑挂载点：编辑器与发布门此前两套输入
// ---------------------------------------------------------------------------
describe("C · POST /b/v1/skills/lint 干跑与发布门同口径", () => {
  it("SEAM · dependsOn 指向不存在的 skill → 干跑 lint 必须红（此前恒绿，发布时才 422 = 两套输入）", async () => {
    const t = await createTestApp();
    const skill = skillFixture({
      key: "dangling_dep",
      status: "DRAFT",
      dependsOn: [{ kind: "skill", key: "__NO_SUCH_SKILL__", role: "context", required: true }],
    });
    await t.repos.skills.insert(skill);

    const res = await t.app.inject({ method: "POST", url: "/b/v1/skills/lint", headers: H, payload: { id: skill.id } });
    expect(res.statusCode).toBe(200);
    const out = res.json() as { ok: boolean; violations: { rule: string; message: string }[] };
    // 变异反证：把 server.ts 的 target 改回只摘 {summary,body,resources}（或去掉第三个实参 ctx）→ ok 变 true，本条红。
    expect(out.ok).toBe(false);
    expect(out.violations.some((v) => v.rule === "dependsOn[0].unresolved")).toBe(true);
  });

  it("SEAM · 干跑与发布门对同一 skill 给出同一批 dependsOn 判定（口径不再分叉）", async () => {
    const t = await createTestApp();
    const dep = skillFixture({ key: "dep_target", status: "PUBLISHED" });
    const skill = skillFixture({
      key: "dep_holder",
      status: "DRAFT",
      dependsOn: [{ kind: "skill", key: "dep_target", role: "context", required: true }],
      outputSchema: { notAJsonSchema: true } as Record<string, unknown>,
    });
    await t.repos.skills.insert(dep);
    await t.repos.skills.insert(skill);

    const dry = await t.app.inject({ method: "POST", url: "/b/v1/skills/lint", headers: H, payload: { id: skill.id } });
    const dryOut = dry.json() as { ok: boolean; violations: { rule: string }[] };
    // outputSchema 缺 type → 工业级契约规则；此前干跑根本不看 outputSchema（字段被摘掉了）。
    expect(dryOut.violations.some((v) => v.rule === "outputSchema.missingType")).toBe(true);

    // 发布门看到的是同一批规则 → 422 且 message 里含同一条 rule。
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${skill.id}/publish`, headers: H });
    expect(pub.statusCode).toBe(422);
    const err = pub.json() as { error: { code: string; message: string } };
    expect(err.error.code).toBe("SKILL_LINT_FAILED");
    expect(err.error.message).toContain("outputSchema.missingType");
  });

  it("干跑 body 直传（无 id）也带上工业级字段 → 非法 references 当场红", async () => {
    const t = await createTestApp();
    const res = await t.app.inject({
      method: "POST",
      url: "/b/v1/skills/lint",
      headers: H,
      payload: {
        summary: GOOD_SUMMARY,
        body: GOOD_BODY,
        resources: [],
        references: [{ kind: "NOT_A_KIND", key: "x", role: "context", required: true }],
      },
    });
    expect(res.statusCode).toBe(200);
    const out = res.json() as { ok: boolean; violations: { rule: string }[] };
    expect(out.violations.some((v) => v.rule === "references[0].kind")).toBe(true);
  });
});
