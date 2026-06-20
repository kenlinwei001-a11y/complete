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

const mkCase = (n: number, behaviorGain: boolean): EvalCase => ({
  id: `ec_skl_${n}`,
  tenantId: TENANT,
  suite: "skill_quality",
  packageId: PKG,
  skillKey: "cap_interp",
  input: { query: `产能口径问题 ${n}`, context: { view: "dash", selectedObjects: [], filters: {} } },
  // answerMust 含不可能 token → 评测必不全过（确定性挡发布；行为增益维度独立标注）。
  expect: { answerMust: ["__IMPOSSIBLE_GAIN_TOKEN_XYZ__"], behaviorGain },
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
    // 3 个 skill_quality 用例（关联 cap_interp），含一个行为增益维度（§4 评测三类之三）
    await t.repos.evalCases.upsert(mkCase(1, false)); // 应触发
    await t.repos.evalCases.upsert(mkCase(2, false)); // 不应触发（answerMustNot）
    await t.repos.evalCases.upsert(mkCase(3, true)); // 行为增益（挂载 vs 不挂载）
    const cases = await t.repos.evalCases.listByTenant(TENANT, "skill_quality");
    expect(cases.filter((c) => c.skillKey === "cap_interp").length).toBe(3);
    expect(cases.some((c) => c.expect.behaviorGain === true)).toBe(true); // 行为增益维度落地

    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish`, headers: H });
    // 数量门已过（不再 INSUFFICIENT）；评测套件未全过 → FAILED（绿测试≠能用：缺真实增益证据则挡发布）
    expect(pub.statusCode).toBe(422);
    expect((pub.json() as { error: { code: string } }).error.code).toBe("SKILL_EVAL_FAILED");
  });
});
