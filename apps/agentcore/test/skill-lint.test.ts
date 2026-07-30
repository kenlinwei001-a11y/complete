import { describe, expect, it } from "vitest";
import { createTestApp, debugHeaders, ADMIN } from "./helpers.js";
import { lintSkill } from "../src/skill-lint.js";

/** 出厂正例骨架（PRD §5）——结构 lint 必过。 */
const GOOD_SUMMARY =
  "解读产能数字的口径与可比性。当对比 P50/P90、解释认证系数或爬坡折减、用户追问两个产能数为何对不上时使用。不适用：产能数值计算本身（应调用 capacity_forecast 求解器）。";
const GOOD_BODY = `## 目的
解读已算出的产能数字口径。
## 适用边界
适用：解释口径差异。不适用：重新计算产能。
## 前置检查
确认数字的 snapshotVersion 与求解参数一致。
## 步骤
1. 口径三连查：健康度系数→认证系数→爬坡窗口。
## 示例
正例：用户问"两个产能数为何对不上"→逐口径解释并挂溯源。
反例：直接平均 P50 和 P90 给一个综合值（错：分位数不可平均）。
## 失败处理
求解器返回错误码→转述错误并给下一步，禁止编造。
## 输出要求
每个口径解释必须挂溯源角标。`;

describe("Skill 编写规范 §1-§4 — 结构 lint（SA1/SA4）", () => {
  it("出厂正例通过 lint", () => {
    const r = lintSkill({ summary: GOOD_SUMMARY, body: GOOD_BODY, resources: [] });
    expect(r.ok).toBe(true);
    expect(r.violations).toHaveLength(0);
  });

  it("SA1: 反例技能逐条定位拒绝（禁用词 / 缺不适用句 / 缺触发句 / 骨架缺段 / 叙事体无正反例）", () => {
    const r = lintSkill({
      summary: "本技能介绍产能相关的各种知识，帮助你更好地回答产能问题。",
      body: "本技能介绍产能背景知识。",
      resources: [],
    });
    expect(r.ok).toBe(false);
    const rules = new Set(r.violations.map((v) => v.rule));
    expect(rules.has("summary.forbiddenWord")).toBe(true); // 介绍/各种/帮助你
    expect(rules.has("summary.triggerTemplate")).toBe(true); // 无「当…时使用」
    expect(rules.has("summary.exclusion")).toBe(true); // 无「不适用：」
    expect(rules.has("body.section")).toBe(true); // 缺七段骨架
    expect(rules.has("body.positiveExample")).toBe(true);
    expect(rules.has("body.negativeExample")).toBe(true);
  });

  it("SA4: body 写错工具名 → 反查拒绝并提示", () => {
    const body = GOOD_BODY + "\n调用 `capacity_forcast` 求解产能。"; // 拼错 forecast
    const r = lintSkill({ summary: GOOD_SUMMARY, body, resources: [] });
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.rule === "body.unknownTool" && v.message.includes("capacity_forcast"))).toBe(true);
    // 正确名不报错
    const ok = lintSkill({ summary: GOOD_SUMMARY, body: GOOD_BODY + "\n调用 `invoke_solver` 求解。", resources: [] });
    expect(ok.violations.some((v) => v.rule === "body.unknownTool")).toBe(false);
  });

  it("未声明的 resource 引用被 lint 抓出", () => {
    const r = lintSkill({ summary: GOOD_SUMMARY, body: GOOD_BODY + "\n见 {{resource:table.csv}}", resources: [] });
    expect(r.violations.some((v) => v.rule === "body.resourceRef")).toBe(true);
    const ok = lintSkill({ summary: GOOD_SUMMARY, body: GOOD_BODY + "\n见 {{resource:table.csv}}", resources: [{ name: "table.csv" }] });
    expect(ok.violations.some((v) => v.rule === "body.resourceRef")).toBe(false);
  });
});

describe("Skill 编写规范 §4 — 发布门禁（endpoint）", () => {
  async function createSkill(t: Awaited<ReturnType<typeof createTestApp>>, summary: string, body: string) {
    const res = await t.app.inject({
      method: "POST",
      url: "/b/v1/skills",
      headers: debugHeaders(ADMIN),
      payload: { key: "k_lint", name: "技能", summary, body, resources: [] },
    });
    return (res.json() as { id: string }).id;
  }

  it("结构 lint 不过 → publish 422 SKILL_LINT_FAILED；force=true 审计豁免可发布", async () => {
    const t = await createTestApp();
    const id = await createSkill(t, "随便写写", "没有骨架");
    const blocked = await t.app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish`, headers: debugHeaders(ADMIN) });
    expect(blocked.statusCode).toBe(422);
    expect((blocked.json() as { error: { code: string } }).error.code).toBe("SKILL_LINT_FAILED");
    const forced = await t.app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish?force=true`, headers: debugHeaders(ADMIN) });
    expect(forced.statusCode).toBe(200);
  });

  it("合规技能（lint 过）→ publish 200，响应附 lint 结果（门禁二评测门见 skill-eval-gate，此处 force 豁免）", async () => {
    const t = await createTestApp();
    const id = await createSkill(t, GOOD_SUMMARY, GOOD_BODY);
    // 门禁二（≥3 评测用例）单独在 skill-eval-gate 测；本例验门禁一(lint)，force 豁免评测门。
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish?force=true`, headers: debugHeaders(ADMIN) });
    expect(pub.statusCode).toBe(200);
    expect((pub.json() as { lint: { ok: boolean } }).lint.ok).toBe(true);
  });

  it("编辑器干跑 lint 端点（不改状态）", async () => {
    const t = await createTestApp();
    const res = await t.app.inject({
      method: "POST",
      url: "/b/v1/skills/lint",
      headers: debugHeaders(ADMIN),
      payload: { summary: "随便", body: "无骨架", resources: [] },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ok: boolean }).ok).toBe(false);
  });
});

describe("WO-SKILL-3 · Skill 工业级契约静态 lint 与发布依赖闭合", () => {
  async function postSkill(t: Awaited<ReturnType<typeof createTestApp>>, payload: Record<string, unknown>): Promise<string> {
    const res = await t.app.inject({ method: "POST", url: "/b/v1/skills", headers: debugHeaders(ADMIN), payload });
    expect(res.statusCode).toBe(201);
    return (res.json() as { id: string }).id;
  }

  it("lint：inputSchema/outputSchema 缺 type 或非法 → metadata 违规", () => {
    const base = { summary: GOOD_SUMMARY, body: GOOD_BODY, resources: [] };
    const r1 = lintSkill({ ...base, inputSchema: { properties: {} } } as any);
    expect(r1.violations.some((v) => v.rule === "inputSchema.missingType")).toBe(true);

    const r2 = lintSkill({ ...base, outputSchema: [{ type: "object" }] } as any);
    expect(r2.violations.some((v) => v.rule === "outputSchema.invalid")).toBe(true);

    const ok = lintSkill({ ...base, inputSchema: { type: "object" }, outputSchema: { type: "object" } } as any);
    expect(ok.violations.some((v) => v.rule.startsWith("inputSchema") || v.rule.startsWith("outputSchema"))).toBe(false);
  });

  it("lint：references 非法 kind / role / version / 重复 → metadata 违规", () => {
    const refs = [
      { kind: "solver", key: "S1", role: "precondition" },
      { kind: "bad_kind", key: "X" },
      { kind: "rule", key: "R1", role: "bad_role" },
      { kind: "skill", key: "DUP" },
      { kind: "skill", key: "DUP", version: 0 },
    ];
    const r = lintSkill({ summary: GOOD_SUMMARY, body: GOOD_BODY, resources: [], references: refs } as any);
    const rules = new Set(r.violations.map((v) => v.rule));
    expect(rules.has("references[1].kind")).toBe(true);
    expect(rules.has("references[2].role")).toBe(true);
    expect(rules.has("references[4].duplicate")).toBe(true);
    expect(rules.has("references[4].version")).toBe(true);
  });

  it("lint：dependsOn 指向不存在的 skill → unresolved；提供 allSkills 后可解析", () => {
    const r1 = lintSkill(
      { summary: GOOD_SUMMARY, body: GOOD_BODY, resources: [], dependsOn: [{ kind: "skill", key: "missing" }] } as any,
      {},
      { allSkills: [] },
    );
    expect(r1.violations.some((v) => v.rule === "dependsOn[0].unresolved")).toBe(true);

    const ctxSkill = { id: "skl_ctx", tenantId: "t", key: "exists", version: 1, name: "x", summary: GOOD_SUMMARY, body: GOOD_BODY, resources: [], status: "PUBLISHED" } as any;
    const r2 = lintSkill(
      { summary: GOOD_SUMMARY, body: GOOD_BODY, resources: [], dependsOn: [{ kind: "skill", key: "exists" }] } as any,
      {},
      { allSkills: [ctxSkill] },
    );
    expect(r2.violations.some((v) => v.rule === "dependsOn[0].unresolved")).toBe(false);
  });

  it("lint：dependsOn 成环 → dependencyCycle", () => {
    const a = { id: "skl_a", tenantId: "t", key: "A", version: 1, name: "A", summary: GOOD_SUMMARY, body: GOOD_BODY, resources: [], status: "DRAFT", dependsOn: [{ kind: "skill", key: "B" }] } as any;
    const b = { id: "skl_b", tenantId: "t", key: "B", version: 1, name: "B", summary: GOOD_SUMMARY, body: GOOD_BODY, resources: [], status: "DRAFT", dependsOn: [{ kind: "skill", key: "A" }] } as any;
    const r = lintSkill(a, {}, { allSkills: [a, b] });
    expect(r.violations.some((v) => v.rule === "metadata.dependencyCycle")).toBe(true);
  });

  it("publish：dependsOn 指向 DRAFT skill → 422 SKILL_LINT_FAILED；force 可豁免", async () => {
    const t = await createTestApp();
    const depId = await postSkill(t, { key: "draft_dep", name: "Draft Dep", summary: GOOD_SUMMARY, body: GOOD_BODY, resources: [] });
    const mainId = await postSkill(t, { key: "needs_draft", name: "Needs Draft", summary: GOOD_SUMMARY, body: GOOD_BODY, resources: [], dependsOn: [{ kind: "skill", key: "draft_dep" }] });

    const blocked = await t.app.inject({ method: "POST", url: `/b/v1/skills/${mainId}/publish`, headers: debugHeaders(ADMIN) });
    expect(blocked.statusCode).toBe(422);
    expect((blocked.json() as { error: { code: string } }).error.code).toBe("SKILL_LINT_FAILED");

    const forced = await t.app.inject({ method: "POST", url: `/b/v1/skills/${mainId}/publish?force=true`, headers: debugHeaders(ADMIN) });
    expect(forced.statusCode).toBe(200);
  });

  it("publish：dependsOn 指向 PUBLISHED skill → 可发布", async () => {
    const t = await createTestApp();
    const depId = await postSkill(t, { key: "published_dep", name: "Published Dep", summary: GOOD_SUMMARY, body: GOOD_BODY, resources: [] });
    const pubDep = await t.app.inject({ method: "POST", url: `/b/v1/skills/${depId}/publish?force=true`, headers: debugHeaders(ADMIN) });
    expect(pubDep.statusCode).toBe(200);

    const mainId = await postSkill(t, { key: "needs_published", name: "Needs Published", summary: GOOD_SUMMARY, body: GOOD_BODY, resources: [], dependsOn: [{ kind: "skill", key: "published_dep" }] });
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${mainId}/publish?force=true`, headers: debugHeaders(ADMIN) });
    expect(pub.statusCode).toBe(200);
  });

  it("publish：dependsOn 成环 → 422 SKILL_LINT_FAILED", async () => {
    const t = await createTestApp();
    const idA = await postSkill(t, { key: "cycle_a", name: "Cycle A", summary: GOOD_SUMMARY, body: GOOD_BODY, resources: [], dependsOn: [{ kind: "skill", key: "cycle_b" }] });
    const idB = await postSkill(t, { key: "cycle_b", name: "Cycle B", summary: GOOD_SUMMARY, body: GOOD_BODY, resources: [], dependsOn: [{ kind: "skill", key: "cycle_a" }] });

    const blocked = await t.app.inject({ method: "POST", url: `/b/v1/skills/${idA}/publish`, headers: debugHeaders(ADMIN) });
    expect(blocked.statusCode).toBe(422);
    expect((blocked.json() as { error: { code: string } }).error.code).toBe("SKILL_LINT_FAILED");
    expect(JSON.stringify(blocked.json())).toContain("dependencyCycle");
  });
});
