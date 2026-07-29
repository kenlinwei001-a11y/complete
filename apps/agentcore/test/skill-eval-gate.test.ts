import { describe, expect, it } from "vitest";
import { createTestApp, ADMIN, TENANT, PKG, type TestApp } from "./helpers.js";
import type { EvalCase } from "@platform/contracts";

/**
 * Skill 编写规范 §4 门禁二（评测门禁）：发布必附 ≥3 个 skill_quality 评测用例（含行为增益维度）
 * + 评测套件全过。此前 publish 仅 lint，无评测门（审计称本篇最大缺口）。
 */
const H = { "x-debug-user": ADMIN, "content-type": "application/json" };
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

/**
 * 三类用例 fixture（PRD §4）。**修此前假 fixture**：原 mkCase 三次产出除 behaviorGain 外完全相同
 * （都只有 answerMust、无 toolSequence），"应触发/不应触发"只活在注释里——门只数数不判类型即由此被掩盖。
 * 现在三类**形状真不同**，撤掉任一类即触 SKILL_EVAL_COVERAGE（红咬）。
 */
type SkillCaseKind = "trigger" | "noTrigger" | "gain";
const mkCase = (n: number, kind: SkillCaseKind): EvalCase => ({
  id: `ec_skl_${n}`,
  tenantId: TENANT,
  suite: "skill_quality",
  packageId: PKG,
  skillKey: "cap_interp",
  input: { query: `产能口径问题 ${n}`, context: { view: "dash", selectedObjects: [], filters: {} } },
  // answerMust 含不可能 token → 评测套件必不全过（确定性挡发布，与覆盖门分层解耦）。
  expect: {
    answerMust: ["__IMPOSSIBLE_GAIN_TOKEN_XYZ__"],
    // 应触发 = toolSequence 含 load_skill；不应触发 = 已声明 toolSequence 但不含它（"不适用"场景不得加载）。
    ...(kind === "trigger" ? { toolSequence: [{ name: "load_skill" }] } : {}),
    ...(kind === "noTrigger" ? { toolSequence: [{ name: "final_answer" }] } : {}),
    ...(kind === "gain" ? { behaviorGain: true } : {}),
  },
  origin: "MANUAL",
  createdAt: new Date().toISOString(),
});

async function createSkill(t: TestApp): Promise<string> {
  const res = await t.app.inject({ method: "POST", url: "/b/v1/skills", headers: H, payload: { key: "cap_interp", name: "产能口径解读", summary: GOOD_SUMMARY, body: GOOD_BODY, resources: [] } });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

describe("Skill 门禁二 · 评测门禁（≥3 EvalCase 含行为增益 + 套件过）", () => {
  it("lint 过但 0 评测用例 → 发布 422 SKILL_EVAL_INSUFFICIENT（此前只 lint 即放行）", async () => {
    const t = await createTestApp();
    const id = await createSkill(t);
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish`, headers: H });
    expect(pub.statusCode).toBe(422);
    expect((pub.json() as { error: { code: string } }).error.code).toBe("SKILL_EVAL_INSUFFICIENT");
  });

  it("force=true 审计豁免 → 0 用例也可发布（与 lint 门同口径）", async () => {
    const t = await createTestApp();
    const id = await createSkill(t);
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish?force=true`, headers: H });
    expect(pub.statusCode).toBe(200);
    expect((pub.json() as { status: string }).status).toBe("PUBLISHED");
  });

  it("≥3 评测用例（含行为增益维度）→ 过了数量门，跑套件门：未全过 → 422 SKILL_EVAL_FAILED", async () => {
    const t = await createTestApp();
    const id = await createSkill(t);
    // 3 个 skill_quality 用例（关联 cap_interp）· §4 三类各一（形状真不同·非注释冒充）
    await t.repos.evalCases.upsert(mkCase(1, "trigger"));
    await t.repos.evalCases.upsert(mkCase(2, "noTrigger"));
    await t.repos.evalCases.upsert(mkCase(3, "gain"));
    const cases = await t.repos.evalCases.listByTenant(TENANT, "skill_quality");
    expect(cases.filter((c) => c.skillKey === "cap_interp").length).toBe(3);
    expect(cases.some((c) => c.expect.behaviorGain === true)).toBe(true); // 行为增益维度落地

    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish`, headers: H });
    // 数量门 + 类型覆盖门均已过；评测套件未全过 → FAILED（绿测试≠能用：缺真实增益证据则挡发布）
    expect(pub.statusCode).toBe(422);
    expect((pub.json() as { error: { code: string } }).error.code).toBe("SKILL_EVAL_FAILED");
  });

  // ——— 红咬：门必须**判类型**而非只数数（SA2「不应触发」此前完全无人把守）———
  it("红咬 SA2：3 条用例但全是「应触发」（数量够·类型缺）→ 422 SKILL_EVAL_COVERAGE（此前假绿放行）", async () => {
    const t = await createTestApp();
    const id = await createSkill(t);
    // 数量门满足（3 条），但三类只占一类——旧门只看 length 会直接放行到套件门。
    await t.repos.evalCases.upsert(mkCase(1, "trigger"));
    await t.repos.evalCases.upsert(mkCase(2, "trigger"));
    await t.repos.evalCases.upsert(mkCase(3, "trigger"));
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish`, headers: H });
    expect(pub.statusCode).toBe(422);
    const err = (pub.json() as { error: { code: string; message: string } }).error;
    expect(err.code).toBe("SKILL_EVAL_COVERAGE");
    expect(err.message).toContain("不应触发"); // 逐类定位缺哪类（零判断力可据以补齐）
    expect(err.message).toContain("行为增益");
  });

  it("红咬 SA3：缺「行为增益」一类（应触发+不应触发×2）→ 仍 422 COVERAGE（防摆设技能混过）", async () => {
    const t = await createTestApp();
    const id = await createSkill(t);
    await t.repos.evalCases.upsert(mkCase(1, "trigger"));
    await t.repos.evalCases.upsert(mkCase(2, "noTrigger"));
    await t.repos.evalCases.upsert(mkCase(3, "noTrigger"));
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish`, headers: H });
    expect(pub.statusCode).toBe(422);
    const err = (pub.json() as { error: { code: string; message: string } }).error;
    expect(err.code).toBe("SKILL_EVAL_COVERAGE");
    expect(err.message).toContain("行为增益");
  });
});
