import { describe, expect, it } from "vitest";
import { PLATFORM_PROMPT_DEFAULTS, SkillSummaryReviewSchema } from "@platform/contracts";
import { resolvePromptOverride, resolvePromptTemplate } from "../src/agent/prompts.js";
import { runSkillSummaryReview, type SkillSummaryReviewDeps } from "../src/skill-summary-review.js";
import { MockPromptClient } from "../src/mocks/clients.js";
import { ScriptedLlmClient } from "../src/llm/mock.js";
import type { PromptClient, ToolAuthCtx } from "../src/tools/clients.js";
import { createTestApp, ADMIN, TENANT, type TestApp } from "./helpers.js";

/**
 * WO-PROMPT-KEY-LINT · 门禁一·语义补「LLM 摘要语义审查」（建议式·不阻断发布）。
 *
 * 病灶：`skill_summary_lint` 提示词键此前只活在 contracts 配置表里，src 零消费方。
 * 裁决①（门排序）：结构 lint → 引用闭合 → **本审查** → 评测门；实际执行点在全部阻断判据
 * 通过后、`repos.skills.update` 之前 —— 被 422 拒掉的发布**不跑**审查（composeRequests 为零
 * 即排序的机器证据）。
 * 裁决②（R6 不破）：verdict **不进 422 阻断判据**（阻断路径 100% 确定性），只落三处留痕
 * （发布响应 + skill 行 additive 字段 summaryReview + DRAFT 干跑 opt-in）；fail-open 但诚实
 * —— LLM 抛错 = UNAVAILABLE、输出不可解析 = UNPARSEABLE，两档都不许读成「通过」。
 *
 * 本文件照规格 B 节逐条落断言；mock 掉 LLM 后剩下的判据 = 请求构造判据（键真进 compose
 * 请求体 instruction、摘要原文真进 inputs）+ 响应处理判据（PASS/ISSUES/UNPARSEABLE/UNAVAILABLE）
 * + R6 机器判据（固定时钟注入跑两遍 JSON.stringify 逐字节相同）。
 */

const CTX: ToolAuthCtx = { tenantId: "demo", userId: "u1", roles: ["admin"], debugUser: "demo:u1:admin" };
/** 租户 override 模板文本（含独特标记·便于断言"确实流入了请求体"且与平台默认互斥）。 */
const OVERRIDE = "【接管·租户自定义】摘要审查租户指令头——SUMMARY-LINT-OVERRIDE-标记-77。";
const MODEL = "test-summary-review-model";
/** 固定时钟（R6：留痕里的 reviewedAt 由注入时钟钉死，不吃真实时间）。 */
const NOW = "2026-08-17T00:00:00.000Z";

const H = { "x-debug-user": ADMIN, "content-type": "application/json" };
/** 过结构 lint 的好摘要（与 skill-eval-gate.test.ts 同一 fixture：触发句 + 排除句齐备）。 */
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

const SKILL = { name: "产能口径解读", summary: GOOD_SUMMARY };

/** 单测 deps 工厂：ScriptedLlmClient + 固定时钟 + 固定模型名（签名以规格 A3 为准）。 */
function mkDeps(prompts?: PromptClient): { llm: ScriptedLlmClient; deps: SkillSummaryReviewDeps } {
  const llm = new ScriptedLlmClient();
  return { llm, deps: { llm, ...(prompts ? { prompts } : {}), ctx: CTX, model: MODEL, now: () => NOW } };
}

// ---------------------------------------------------------------------------
// 单元①：resolvePromptTemplate —— 只在 TENANT_OVERRIDE 且非空白时返回**完整** ResolvedPrompt
// ---------------------------------------------------------------------------
describe("resolvePromptTemplate · 只在 TENANT_OVERRIDE 非空白时返回完整 ResolvedPrompt（含 source/version）", () => {
  it("租户 override → 返回完整对象（template/source/version/key 逐项对·version 来自 mock 递增）", async () => {
    const prompts = new MockPromptClient();
    prompts.setOverride(CTX.tenantId, "skill_summary_lint", OVERRIDE);
    const r = await resolvePromptTemplate(prompts, CTX, "skill_summary_lint");
    expect(r).toBeDefined();
    expect(r?.template).toBe(OVERRIDE);
    expect(r?.source).toBe("TENANT_OVERRIDE");
    expect(r?.version).toBe(1); // MockPromptClient 首次 setOverride 版本号 = 1
    expect(r?.key).toBe("skill_summary_lint");
  });

  it("无 override（PLATFORM_DEFAULT）→ undefined（fail-open·平台默认不冒充租户配置）", async () => {
    const prompts = new MockPromptClient();
    const raw = await prompts.getPromptTemplate(CTX, "skill_summary_lint");
    expect(raw?.source).toBe("PLATFORM_DEFAULT"); // 直读证 mock 返的是平台默认
    expect(await resolvePromptTemplate(prompts, CTX, "skill_summary_lint")).toBeUndefined();
  });

  it("prompts 客户端缺失（undefined）→ undefined（无客户端不炸）", async () => {
    expect(await resolvePromptTemplate(undefined, CTX, "skill_summary_lint")).toBeUndefined();
  });

  it("getPromptTemplate 抛错 → undefined（fail-open·A 不可达 / 非 admin 403 语义）", async () => {
    const throwing: PromptClient = {
      async getPromptTemplate() {
        throw new Error("DATACORE_UNAVAILABLE");
      },
      invalidatePromptTemplate() {},
    };
    expect(await resolvePromptTemplate(throwing, CTX, "skill_summary_lint")).toBeUndefined();
  });

  it("TENANT_OVERRIDE 但模板空白 → undefined（不塞空指令头·与既有语义逐字一致）", async () => {
    const blank: PromptClient = {
      async getPromptTemplate(_ctx, key) {
        return { key, template: "   ", source: "TENANT_OVERRIDE", version: 3 };
      },
      invalidatePromptTemplate() {},
    };
    expect(await resolvePromptTemplate(blank, CTX, "skill_summary_lint")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 单元②：resolvePromptOverride 改薄包装后既有语义不回归
//   （规格 A2：判据只有一份，resolvePromptOverride = (await resolvePromptTemplate(...))?.template）
// ---------------------------------------------------------------------------
describe("resolvePromptOverride · 薄包装后行为与改造前逐字一致（回归四分支 + 无客户端 + 租户隔离）", () => {
  it("客户端缺失（undefined）→ undefined（消费方兜底·绝不阻断）", async () => {
    expect(await resolvePromptOverride(undefined, CTX, "classifier")).toBeUndefined();
  });

  it("无 override（PLATFORM_DEFAULT）→ undefined（平台默认不流入）", async () => {
    expect(await resolvePromptOverride(new MockPromptClient(), CTX, "classifier")).toBeUndefined();
  });

  it("租户 override → 返回模板文本（与 resolvePromptTemplate(...).template 同一取值）", async () => {
    const prompts = new MockPromptClient();
    prompts.setOverride(CTX.tenantId, "classifier", OVERRIDE);
    expect(await resolvePromptOverride(prompts, CTX, "classifier")).toBe(OVERRIDE);
    prompts.clearOverride(CTX.tenantId, "classifier");
    expect(await resolvePromptOverride(prompts, CTX, "classifier")).toBeUndefined();
  });

  it("getPromptTemplate 抛错 → undefined（fail-open 语义经包装后不回归）", async () => {
    const throwing: PromptClient = {
      async getPromptTemplate() {
        throw new Error("DATACORE_UNAVAILABLE");
      },
      invalidatePromptTemplate() {},
    };
    expect(await resolvePromptOverride(throwing, CTX, "classifier")).toBeUndefined();
  });

  it("TENANT_OVERRIDE 但模板空白 → undefined（空白判据仍在·没被包装吞掉）", async () => {
    const blank: PromptClient = {
      async getPromptTemplate(_ctx, key) {
        return { key, template: "  ", source: "TENANT_OVERRIDE", version: 1 };
      },
      invalidatePromptTemplate() {},
    };
    expect(await resolvePromptOverride(blank, CTX, "classifier")).toBeUndefined();
  });

  it("租户隔离：override 按 tenantId 键控（别的租户看不到）", async () => {
    const prompts = new MockPromptClient();
    prompts.setOverride("tenant-A", "classifier", OVERRIDE);
    expect(await resolvePromptOverride(prompts, { ...CTX, tenantId: "tenant-A" }, "classifier")).toBe(OVERRIDE);
    expect(await resolvePromptOverride(prompts, { ...CTX, tenantId: "tenant-B" }, "classifier")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 单元③：runSkillSummaryReview —— 请求构造判据 + 响应处理判据 + R6 机器判据
// ---------------------------------------------------------------------------
describe("runSkillSummaryReview · 键真到达请求体 + verdict 四档 + R6 逐字节", () => {
  it("无 override → instruction 含平台默认模板全文（键真到达 LLM 请求体·不是配置表里有键），templateSource=PLATFORM_DEFAULT", async () => {
    const { llm, deps } = mkDeps(new MockPromptClient());
    llm.composeResults.push('{"ok":true,"issues":[]}');
    const r = await runSkillSummaryReview(SKILL, deps);
    expect(r.verdict).toBe("PASS");
    expect(r.issues).toEqual([]);
    expect(r.templateSource).toBe("PLATFORM_DEFAULT");
    expect(r.templateVersion).toBe(0); // 平台默认无版本
    expect(r.model).toBe(MODEL);
    expect(r.reviewedAt).toBe(NOW); // 注入时钟钉死（R6）
    // 请求构造判据：skill_summary_lint 键解出的模板真进 compose 请求体
    expect(llm.composeRequests.length).toBe(1);
    const req = llm.composeRequests[0]!;
    expect(req.model).toBe(MODEL);
    expect(req.instruction).toContain(PLATFORM_PROMPT_DEFAULTS.skill_summary_lint);
    expect(req.instruction).toContain("【输出契约】"); // 固定输出契约尾（确定性拼接）
    // 摘要原文真进 inputs（按规格 A3 形状 {name, summary}）
    const inputs = req.inputs as { name: string; summary: string }[];
    expect(inputs[0]?.name).toBe(SKILL.name);
    expect(inputs[0]?.summary).toBe(GOOD_SUMMARY);
    // 留痕结构过契约 schema（additive 字段形状锁死）
    expect(() => SkillSummaryReviewSchema.parse(r)).not.toThrow();
  });

  it("无 prompts 客户端（undefined）→ 同样回落平台默认模板（fail-open·无客户端不炸）", async () => {
    const { llm, deps } = mkDeps(undefined);
    llm.composeResults.push('{"ok":true,"issues":[]}');
    const r = await runSkillSummaryReview(SKILL, deps);
    expect(r.templateSource).toBe("PLATFORM_DEFAULT");
    expect(llm.composeRequests[0]!.instruction).toContain(PLATFORM_PROMPT_DEFAULTS.skill_summary_lint);
  });

  it("租户 override → instruction 含 override 文本且**不含**平台默认（变异反证正向形态），source/version 对", async () => {
    const prompts = new MockPromptClient();
    prompts.setOverride(CTX.tenantId, "skill_summary_lint", OVERRIDE);
    const { llm, deps } = mkDeps(prompts);
    llm.composeResults.push('{"ok":true,"issues":[]}');
    const r = await runSkillSummaryReview(SKILL, deps);
    expect(r.templateSource).toBe("TENANT_OVERRIDE");
    expect(r.templateVersion).toBe(1);
    const instruction = llm.composeRequests[0]!.instruction;
    expect(instruction).toContain(OVERRIDE);
    expect(instruction).not.toContain(PLATFORM_PROMPT_DEFAULTS.skill_summary_lint);
  });

  it("键隔离：只给 classifier 设 override → 本审查 instruction 不受影响（仍用 skill_summary_lint 平台默认）", async () => {
    const prompts = new MockPromptClient();
    prompts.setOverride(CTX.tenantId, "classifier", OVERRIDE);
    const { llm, deps } = mkDeps(prompts);
    llm.composeResults.push('{"ok":true,"issues":[]}');
    const r = await runSkillSummaryReview(SKILL, deps);
    expect(r.templateSource).toBe("PLATFORM_DEFAULT");
    const instruction = llm.composeRequests[0]!.instruction;
    expect(instruction).not.toContain(OVERRIDE); // 别键的 override 不串味
    expect(instruction).toContain(PLATFORM_PROMPT_DEFAULTS.skill_summary_lint);
  });

  it('mock {"ok":false,"issues":["触发句空泛"]} → ISSUES 且 issues 逐字透传（响应处理判据·负向）', async () => {
    const { llm, deps } = mkDeps(new MockPromptClient());
    llm.composeResults.push('{"ok":false,"issues":["触发句空泛"]}');
    const r = await runSkillSummaryReview(SKILL, deps);
    expect(r.verdict).toBe("ISSUES");
    expect(r.issues).toEqual(["触发句空泛"]);
  });

  it("mock 带 ```json 围栏的 verdict → 剥围栏后正常解析（PASS·输出契约的围栏容错）", async () => {
    const { llm, deps } = mkDeps(new MockPromptClient());
    llm.composeResults.push('```json\n{"ok":true,"issues":[]}\n```');
    const r = await runSkillSummaryReview(SKILL, deps);
    expect(r.verdict).toBe("PASS");
    expect(r.issues).toEqual([]);
  });

  it("mock 默认串（非 JSON）→ UNPARSEABLE 且 issues 含原文前 120 字（诚实档·不许读成通过）", async () => {
    const { llm, deps } = mkDeps(new MockPromptClient());
    // 不 queue：mock 默认返回串 "根据材料分析如上 ⟦ref:0⟧。"（非 JSON）
    const raw = "根据材料分析如上 ⟦ref:0⟧。";
    const r = await runSkillSummaryReview(SKILL, deps);
    expect(r.verdict).toBe("UNPARSEABLE");
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.issues.some((i) => i.includes(raw.slice(0, 120)))).toBe(true);
  });

  it("compose 抛错 → UNAVAILABLE 且 issues 含错误 message（fail-open 不抛·不阻断发布）", async () => {
    const { llm, deps } = mkDeps(new MockPromptClient());
    llm.compose = async (req) => {
      llm.composeRequests.push(req);
      throw new Error("LLM_DOWN_BOOM");
    };
    const r = await runSkillSummaryReview(SKILL, deps);
    expect(r.verdict).toBe("UNAVAILABLE");
    expect(r.issues.some((i) => i.includes("LLM_DOWN_BOOM"))).toBe(true);
    expect(r.reviewedAt).toBe(NOW); // 抛错档留痕同样走注入时钟
  });

  it("R6：固定 now 注入 + 同输入同 mock 跑两遍 → JSON.stringify 逐字节相同（机器判据）", async () => {
    const { llm, deps } = mkDeps(new MockPromptClient());
    llm.composeResults.push('{"ok":false,"issues":["触发句空泛"]}', '{"ok":false,"issues":["触发句空泛"]}');
    const r1 = await runSkillSummaryReview(SKILL, deps);
    const r2 = await runSkillSummaryReview(SKILL, deps);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    expect(r1.reviewedAt).toBe(NOW);
    expect(r2.reviewedAt).toBe(NOW);
  });
});

// ---------------------------------------------------------------------------
// SEAM①：真 HTTP 发布端点 —— 阻断判据全过后、update 前跑审查；留痕落库 + 响应带出
// ---------------------------------------------------------------------------
async function createSkill(t: TestApp, summary = GOOD_SUMMARY): Promise<string> {
  const res = await t.app.inject({
    method: "POST",
    url: "/b/v1/skills",
    headers: H,
    payload: { key: "cap_interp", name: "产能口径解读", summary, body: GOOD_BODY, resources: [] },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

describe("SEAM · 发布路：全部阻断判据通过后跑审查，verdict 落库 + 响应带出（建议式·不阻断）", () => {
  it("发布成功（force=true 豁免评测门）→ 200；summaryReview 落库 verdict=PASS；请求体含平台默认模板 + 摘要原文", async () => {
    const t = await createTestApp();
    const id = await createSkill(t);
    t.llm.composeResults.push('{"ok":true,"issues":[]}');
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish?force=true`, headers: H });
    expect(pub.statusCode).toBe(200);
    // 响应 additive 带出 summaryReview
    const body = pub.json() as { status: string; summaryReview?: { verdict: string } };
    expect(body.status).toBe("PUBLISHED");
    expect(body.summaryReview?.verdict).toBe("PASS");
    // 留痕落库（skill 行 additive 字段）
    const stored = await t.repos.skills.get(id);
    expect(stored?.summaryReview?.verdict).toBe("PASS");
    expect(stored?.summaryReview?.templateSource).toBe("PLATFORM_DEFAULT");
    expect(() => SkillSummaryReviewSchema.parse(stored?.summaryReview)).not.toThrow();
    // 键真到达 LLM 请求体（不是「配置表里有键」）
    expect(t.llm.composeRequests.length).toBe(1);
    expect(t.llm.composeRequests[0]!.instruction).toContain(PLATFORM_PROMPT_DEFAULTS.skill_summary_lint);
    const inputs = t.llm.composeRequests[0]!.inputs as { name: string; summary: string }[];
    expect(inputs[0]?.summary).toBe(GOOD_SUMMARY);
  });

  it("租户 override 经真发布路流入 → instruction 含 override 不含平台默认，落库 source=TENANT_OVERRIDE", async () => {
    const t = await createTestApp();
    t.dataCore.prompts.setOverride(TENANT, "skill_summary_lint", OVERRIDE);
    const id = await createSkill(t);
    t.llm.composeResults.push('{"ok":false,"issues":["排除句缺失"]}');
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish?force=true`, headers: H });
    expect(pub.statusCode).toBe(200);
    const instruction = t.llm.composeRequests[0]!.instruction;
    expect(instruction).toContain(OVERRIDE);
    expect(instruction).not.toContain(PLATFORM_PROMPT_DEFAULTS.skill_summary_lint);
    const stored = await t.repos.skills.get(id);
    expect(stored?.summaryReview?.verdict).toBe("ISSUES");
    expect(stored?.summaryReview?.issues).toEqual(["排除句缺失"]);
    expect(stored?.summaryReview?.templateSource).toBe("TENANT_OVERRIDE");
  });

  it("lint 必失败的发布（summary 空）→ 422 SKILL_LINT_FAILED 且 composeRequests.length === 0（被拒发布不跑审查·排序裁决的机器证据）", async () => {
    const t = await createTestApp();
    const id = await createSkill(t, ""); // 空 summary：缺触发句/排除句，结构 lint 必红
    t.llm.composeResults.push('{"ok":true,"issues":[]}'); // 即便备好 verdict 也不许被消费
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish`, headers: H });
    expect(pub.statusCode).toBe(422);
    expect((pub.json() as { error: { code: string } }).error.code).toBe("SKILL_LINT_FAILED");
    expect(t.llm.composeRequests.length).toBe(0); // 审查排在全部阻断判据之后：被拒发布不打 LLM
    expect((await t.repos.skills.get(id))?.status).not.toBe("PUBLISHED"); // 拒发布 = 未落库
  });

  it("compose 抛错 → 发布仍 200 且 verdict=UNAVAILABLE（建议式不阻断坐实·fail-open 诚实档）", async () => {
    const t = await createTestApp();
    const id = await createSkill(t);
    t.llm.compose = async (req) => {
      t.llm.composeRequests.push(req);
      throw new Error("LLM_DOWN_BOOM");
    };
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish?force=true`, headers: H });
    expect(pub.statusCode).toBe(200); // verdict 不进 422 阻断判据（R6：阻断路径纯确定性）
    const stored = await t.repos.skills.get(id);
    expect(stored?.status).toBe("PUBLISHED");
    expect(stored?.summaryReview?.verdict).toBe("UNAVAILABLE");
    expect(stored?.summaryReview?.issues?.some((i) => i.includes("LLM_DOWN_BOOM"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SEAM②：DRAFT 干跑端点 ?review=1 opt-in —— 不带参数响应零回归（无 summaryReview 键）
// ---------------------------------------------------------------------------
describe("SEAM · 干跑路：POST /b/v1/skills/lint?review=1 opt-in 可见，不带参数零回归", () => {
  const LINT_BODY = { name: "产能口径解读", summary: GOOD_SUMMARY, body: GOOD_BODY, resources: [] };

  it("?review=1 → 响应含 summaryReview（verdict 对·instruction 含平台默认模板·inputs 含摘要原文）", async () => {
    const t = await createTestApp();
    t.llm.composeResults.push('{"ok":true,"issues":[]}');
    const res = await t.app.inject({ method: "POST", url: "/b/v1/skills/lint?review=1", headers: H, payload: LINT_BODY });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect("summaryReview" in body).toBe(true);
    const review = body.summaryReview as { verdict: string; templateSource: string };
    expect(review.verdict).toBe("PASS");
    expect(review.templateSource).toBe("PLATFORM_DEFAULT");
    expect(() => SkillSummaryReviewSchema.parse(review)).not.toThrow();
    expect(t.llm.composeRequests.length).toBe(1);
    expect(t.llm.composeRequests[0]!.instruction).toContain(PLATFORM_PROMPT_DEFAULTS.skill_summary_lint);
    const inputs = t.llm.composeRequests[0]!.inputs as { name: string; summary: string }[];
    expect(inputs[0]?.name).toBe("产能口径解读"); // 直传路径 name 取 body.name
    expect(inputs[0]?.summary).toBe(GOOD_SUMMARY);
  });

  it("不带 review 参数 → 响应**无** summaryReview 键且零 compose 调用（零回归·逐字节不变语义的机器判据）", async () => {
    const t = await createTestApp();
    const res = await t.app.inject({ method: "POST", url: "/b/v1/skills/lint", headers: H, payload: LINT_BODY });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect("summaryReview" in body).toBe(false);
    expect(t.llm.composeRequests.length).toBe(0); // 干跑默认路径不打 LLM
  });
});
