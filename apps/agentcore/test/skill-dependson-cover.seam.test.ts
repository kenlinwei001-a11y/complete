import { describe, expect, it } from "vitest";
import { SkillDefinitionSchema, type SkillDefinition } from "@platform/contracts";
import { createTestApp, ADMIN, TENANT } from "./helpers.js";
import { seedRegistry } from "../src/mocks/seed.js";

/**
 * WO-SKILL-DEPENDSON-COVER · 本体 §8 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 缺口②的收口（SEAM 接缝门）。
 *
 * 缺口②定性（2026-08-17 复核）：`dependsOn` 的消费方（`skill-lint.ts` 的 `detectSkillDependencyCycle`
 * 依赖图环检测与 `validateRefResolution` 引用可解析校验）**线接好了、数据不够**——7 个种子技能只有
 * 1 条 dependsOn 边，环检测分支（要 ≥2 条边才成环）从未进入过。本单补数据，**不改检测逻辑**。
 *
 * 本文件咬三件事：
 *  ① **头号判据 · 环真被拒**：测试里构造真环（cyc_dep_a ⇄ cyc_dep_b）从 HTTP 发布路打进去，
 *     必须 422 被拒且未落库；干跑 lint 必须报出**环路径文本**（不是「函数返回了某值」）。
 *     ⚠️ 环**不许**种进生产 seed——那会炸启动期种子审计与正常发布流，故环只在本文件里构造。
 *  ② **种子覆盖真被消费**：出厂种子的每条 dependsOn 边在干跑 lint（与发布门同口径、同一份
 *     `lintSkill` 实现）下零违规——变异反证②（把一条新补的边指向不存在技能）就打红这条。
 *  ③ 金丝雀在与本文同批的 `skill-compiler.seam.test.ts`（计数 1 → 5），两边缺一即红。
 *
 * 纪律：每条都必须能被「掐掉被测的那根线」变红——变异反证写在各 it 注释里，且本单交付前**亲手跑过**。
 */

const H = { "x-debug-user": ADMIN, "content-type": "application/json" };

const GOOD_SUMMARY = "当用户问依赖环探针测试问题时使用。不适用：其他一切问题。";
const GOOD_BODY = `## 目的
依赖环探针测试。
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
  // `.strict().parse`：fixture 不许自造契约里没有的字段/值（断言全靠"生产真能出现这种 skill"成立）。
  return SkillDefinitionSchema.strict().parse({
    id: `skl_${overrides.key}`,
    tenantId: TENANT,
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

describe("WO-SKILL-DEPENDSON-COVER · ① 头号判据：真环必须被发布门拒掉且报出环路径", () => {
  it("SEAM · cyc_dep_a ⇄ cyc_dep_b 真环 → 发布 422 SKILL_LINT_FAILED（未落库）+ 干跑报出环路径文本", async () => {
    const t = await createTestApp();
    // fixture 用 DRAFT：这样「发布被拒 ⇒ 未落库」可查（status 必须停在 DRAFT）。
    // （代价：发布门 requirePublishedDeps=true 会连带报 dependsOn[*].notPublished——断言用
    // toContain("metadata.dependencyCycle") 咬环这条，不受影响；干跑 lint 不传该开关，只剩环违规。）
    const a = skillFixture({
      key: "cyc_dep_a",
      status: "DRAFT",
      dependsOn: [{ kind: "skill", key: "cyc_dep_b", role: "context", required: true }],
    });
    const b = skillFixture({
      key: "cyc_dep_b",
      status: "DRAFT",
      dependsOn: [{ kind: "skill", key: "cyc_dep_a", role: "context", required: true }],
    });
    await t.repos.skills.insert(a);
    await t.repos.skills.insert(b);

    // —— 发布路：必须被拒 ——
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${a.id}/publish`, headers: H });
    expect(pub.statusCode, `带环发布必须 422，实得 ${pub.statusCode}：${pub.body}`).toBe(422);
    const err = pub.json() as { error: { code: string; message: string } };
    expect(err.error.code).toBe("SKILL_LINT_FAILED");
    expect(err.error.message).toContain("metadata.dependencyCycle");
    // 拒发布 = 未落库（门在 repos.skills.update 之前）：status 必须停在 DRAFT
    expect((await t.repos.skills.get(a.id))?.status).toBe("DRAFT");
    // —— 干跑校验：必须报出**环路径文本**（lint 违规 message，不是只有 rule 名）——
    const dry = await t.app.inject({ method: "POST", url: "/b/v1/skills/lint", headers: H, payload: { id: a.id } });
    expect(dry.statusCode).toBe(200);
    const out = dry.json() as { ok: boolean; violations: { rule: string; message: string }[] };
    expect(out.ok).toBe(false);
    const cycleViolation = out.violations.find((v) => v.rule === "metadata.dependencyCycle");
    expect(cycleViolation, "干跑 lint 必须报出依赖环违规").toBeDefined();
    // 环路径文本：`Skill 依赖图存在环：<key> -> ... -> <key>`（起点是检测时先访问到的环上节点，两键皆有可能）
    expect(cycleViolation!.message).toMatch(/Skill 依赖图存在环：cyc_dep_[ab] -> \.\.\. -> cyc_dep_[ab]/);

    // 对侧也一样被拒（环不挑入口：从 b 发布同样 422）
    const pubB = await t.app.inject({ method: "POST", url: `/b/v1/skills/${b.id}/publish`, headers: H });
    expect(pubB.statusCode).toBe(422);
    expect((pubB.json() as { error: { message: string } }).error.message).toContain("metadata.dependencyCycle");

    // 变异反证①（本单交付前亲手跑过）：把 `skill-lint.ts` 里 `detectSkillDependencyCycle` 的违规 push
    // 临时摘掉（或让 cyc_dep_b 的 dependsOn 退化成 undefined = 环退化为无环）→ 上面 pub 变成
    // 422 SKILL_EVAL_INSUFFICIENT（lint 全过、撞评测门）⇒ `err.error.code` 断言红；干跑侧 cycleViolation 变 undefined ⇒ 红。
  });

  it("SEAM 对照 · 无环的链式依赖（a→b→c）发布**不因环被拒**（证上面的 422 来自环，不是『有 dependsOn 就拒』）", async () => {
    const t = await createTestApp();
    const c = skillFixture({ key: "chain_dep_c" });
    const b = skillFixture({
      key: "chain_dep_b",
      dependsOn: [{ kind: "skill", key: "chain_dep_c", role: "context", required: true }],
    });
    const a = skillFixture({
      key: "chain_dep_a",
      dependsOn: [{ kind: "skill", key: "chain_dep_b", role: "context", required: true }],
    });
    for (const s of [a, b, c]) await t.repos.skills.insert(s);

    // 干跑：无环 ⇒ 不得出现环违规（若环检测误报，这条当场红）
    const dry = await t.app.inject({ method: "POST", url: "/b/v1/skills/lint", headers: H, payload: { id: a.id } });
    const out = dry.json() as { ok: boolean; violations: { rule: string }[] };
    expect(out.violations.filter((v) => v.rule === "metadata.dependencyCycle")).toEqual([]);
    expect(out.ok).toBe(true);

    // 发布：lint 全过 ⇒ 若 422 也只能是评测门（SKILL_EVAL_*），绝不可以是环
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${a.id}/publish`, headers: H });
    if (pub.statusCode === 422) {
      const err = pub.json() as { error: { code: string; message: string } };
      expect(err.error.code).not.toBe("SKILL_LINT_FAILED");
      expect(err.error.message).not.toContain("metadata.dependencyCycle");
    }
  });
});

describe("WO-SKILL-DEPENDSON-COVER · ② 出厂种子的 dependsOn 覆盖真被消费方吃下", () => {
  it("SEAM · 每个持有 dependsOn 的出厂技能：干跑 lint（与发布门同一份实现）零 dependsOn/环违规", async () => {
    const t = await createTestApp();
    const { skills } = seedRegistry();
    for (const s of skills) await t.repos.skills.insert(s);

    const dependants = skills.filter((s) => (s.dependsOn ?? []).length > 0);
    // 金丝雀口径与 skill-compiler.seam.test.ts 同数：4 个持有者、共 6 条边（2026-08-18 扩覆后）。
    // 数变了先查提交再改，不许直接改数压红。
    expect(dependants.length).toBe(4);
    expect(dependants.reduce((n, s) => n + (s.dependsOn ?? []).length, 0)).toBe(6);

    for (const s of dependants) {
      const dry = await t.app.inject({ method: "POST", url: "/b/v1/skills/lint", headers: H, payload: { id: s.id } });
      expect(dry.statusCode).toBe(200);
      const out = dry.json() as { ok: boolean; violations: { rule: string; message: string }[] };
      const depViolations = out.violations.filter(
        (v) => v.rule.startsWith("dependsOn") || v.rule === "metadata.dependencyCycle",
      );
      expect(depViolations, `出厂技能 ${s.key} 的 dependsOn 必须全部可解析且无环：${JSON.stringify(depViolations)}`).toEqual([]);
    }
    // 变异反证②（本单交付前亲手跑过）：把 seed.ts 任一条新补边的 key 改成不存在的技能
    // （如 risk_analysis → `__no_such_skill__`）→ 上面 `dependsOn[0].unresolved` 出现 ⇒ 本条红。
  });

  it("出厂依赖图是 DAG：环检测对种子全量不报环（防把环误种进生产 seed——那会炸启动审计与发布流）", async () => {
    const t = await createTestApp();
    const { skills } = seedRegistry();
    for (const s of skills) await t.repos.skills.insert(s);

    // 逐个技能干跑：任何一个技能视角下都不得报环
    for (const s of skills) {
      const dry = await t.app.inject({ method: "POST", url: "/b/v1/skills/lint", headers: H, payload: { id: s.id } });
      const out = dry.json() as { violations: { rule: string }[] };
      expect(
        out.violations.filter((v) => v.rule === "metadata.dependencyCycle"),
        `出厂种子依赖图必须无环（${s.key} 视角报环了）`,
      ).toEqual([]);
    }
  });
});
