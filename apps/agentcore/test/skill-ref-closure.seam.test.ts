import { describe, expect, it } from "vitest";
import { createTestApp, ADMIN, type TestApp } from "./helpers.js";
import type { RuleEngineClient } from "../src/tools/clients.js";

/**
 * WO-SKILL-REFCLOSURE-A · 引用可校验门接上 skill 发布路（接缝驱动，SEAM-GATE）
 *
 * 病（本体 §8 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 第三处）：`probeMissingRefs` 早已存在、
 * 且早已接在 **agent 发布**（server.ts）与 **workflow 发布**（server.ts）两路上，
 * **唯独 skill 发布路没接** —— 一个技能可以 `references:[{kind:"solver",key:"根本不存在"}]`
 * 照样发布成功。这是三种"不工作"里的**接了线接错地方**，不是"没造门"。
 *
 * 且探针自身有**两层 fail-open**（本单一并关死）：
 *   第一层 `catch` 静默放行——注册表读不出来就当作"都合法"；
 *   第二层 `if (known.size > 0)`——注册表返回**空集**也放行。第二层更毒：门整体失效且**无任何信号**。
 *
 * 本文件是**接缝测试不是函数测试**：一律从 HTTP 发布端点 `POST /b/v1/skills/:id/publish` 打进去，
 * 经真 server → 真 handler → 真 `probeMissingRefs` → mock DataCore 注册表，
 * 并逐条断言**落库与否**（`repos.skills.get(id).status`）——「返回 422」和「真没落库」是两个命题。
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

/** mock DataCore 注册表实况（金丝雀基准）：discover("solvers") 出厂含 capacity_forecast，不含下面这个假 key。 */
const REAL_SOLVER = "capacity_forecast";
const DEAD_SOLVER = "__no_such_solver_xyz__";
const REAL_RULE = "C03";
const DEAD_RULE = "__no_such_rule_xyz__";

type Ref = { kind: string; key: string; role?: string; required?: boolean };

async function createSkill(t: TestApp, key: string, references: Ref[]): Promise<string> {
  const res = await t.app.inject({
    method: "POST",
    url: "/b/v1/skills",
    headers: H,
    payload: { key, name: `技能 ${key}`, summary: GOOD_SUMMARY, body: GOOD_BODY, resources: [], references },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

const statusOf = async (t: TestApp, id: string): Promise<string | undefined> => (await t.repos.skills.get(id))?.status;

describe("WO-SKILL-REFCLOSURE-A · skill 发布路的引用可校验门（接缝：HTTP → 探针 → DataCore 注册表）", () => {
  // ——— 金丝雀：先自证 mock 注册表确实认得真 key、确实不认得假 key ———
  // 否则下面每一条"报 422"都可能只是因为注册表本身是空的（那测的就不是我要测的东西）。
  it("金丝雀：mock 求解器目录含 capacity_forecast、不含假 key（否则本文件全部断言失去意义）", async () => {
    const t = await createTestApp();
    const { items } = await t.dataCore.catalog.discover({ tenantId: "demo", userId: "u", roles: [] } as never, "solvers");
    const keys = items.map((i: { key: string }) => i.key);
    expect(keys).toContain(REAL_SOLVER);
    expect(keys).not.toContain(DEAD_SOLVER);
    // 上转到接口（WO-MOCKDC-PARAMS 已把 mock 的 `listPublishedRuleKeys` 形参补齐到契约；上转保留 = 咬接口不咬实现）。
    const rules: RuleEngineClient = t.dataCore.rules;
    expect(await rules.listPublishedRuleKeys({ tenantId: "demo", userId: "u", roles: [] })).toContain(REAL_RULE);
  });

  // ——————————————————— ① 死路引用 → 422 且未落库 ———————————————————
  it("① 引用不存在的求解器 key → 422 SKILL_REF_UNRESOLVED 且未落库（接线前：200 PUBLISHED）", async () => {
    const t = await createTestApp();
    const id = await createSkill(t, "dead_ref", [{ kind: "solver", key: DEAD_SOLVER, role: "context", required: true }]);

    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish`, headers: H });

    expect(pub.statusCode).toBe(422);
    const err = (pub.json() as { error: { code: string; message: string; requestId: string } }).error;
    expect(err.code).toBe("SKILL_REF_UNRESOLVED"); // 不是 SKILL_EVAL_* —— 证明是引用门拦的，不是评测门顺手拦的
    expect(err.message).toContain(DEAD_SOLVER);
    expect(err.requestId).toBeTruthy(); // R7 错误信封 {code,message,requestId}
    // **未落库**：拒发布 ≠ 已落库但返回错误
    expect(await statusOf(t, id)).toBe("DRAFT");
  });

  it("① force=true 不豁免引用门（force 豁免的是质量门；死路是事实错误，审计签字不能让不存在的求解器存在）", async () => {
    const t = await createTestApp();
    const id = await createSkill(t, "dead_ref_forced", [{ kind: "solver", key: DEAD_SOLVER, required: true }]);

    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish?force=true`, headers: H });

    // force=true 已豁免 lint 门与评测门 ⇒ 此处唯一还能产出 422 的就是引用门本身（判据不被别的门冒充）
    expect(pub.statusCode).toBe(422);
    expect((pub.json() as { error: { code: string } }).error.code).toBe("SKILL_REF_UNRESOLVED");
    expect(await statusOf(t, id)).toBe("DRAFT");
  });

  it("① 规则维同守：引用不存在的规则 key → 422 且未落库", async () => {
    const t = await createTestApp();
    const id = await createSkill(t, "dead_rule", [{ kind: "rule", key: DEAD_RULE, role: "postcheck", required: true }]);
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish?force=true`, headers: H });
    expect(pub.statusCode).toBe(422);
    expect((pub.json() as { error: { code: string; message: string } }).error.message).toContain(DEAD_RULE);
    expect(await statusOf(t, id)).toBe("DRAFT");
  });

  it("① dependsOn 与 references 同守（两个字段是两条数据通道，别只接一条）", async () => {
    const t = await createTestApp();
    const res = await t.app.inject({
      method: "POST",
      url: "/b/v1/skills",
      headers: H,
      payload: {
        key: "dead_dep",
        name: "dependsOn 死路",
        summary: GOOD_SUMMARY,
        body: GOOD_BODY,
        resources: [],
        dependsOn: [{ kind: "solver", key: DEAD_SOLVER, required: true }],
      },
    });
    expect(res.statusCode).toBe(201);
    const id = (res.json() as { id: string }).id;
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish?force=true`, headers: H });
    expect(pub.statusCode).toBe(422);
    expect((pub.json() as { error: { code: string } }).error.code).toBe("SKILL_REF_UNRESOLVED");
    expect(await statusOf(t, id)).toBe("DRAFT");
  });

  // ——————————————————— ② 真实引用 → 200 ———————————————————
  it("② 引用真实存在的求解器 + 规则 → 200 PUBLISHED（门不是「一律拒」，是真去查了注册表）", async () => {
    const t = await createTestApp();
    const id = await createSkill(t, "live_ref", [
      { kind: "solver", key: REAL_SOLVER, role: "context", required: true },
      { kind: "rule", key: REAL_RULE, role: "postcheck", required: true },
    ]);

    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish?force=true`, headers: H });

    expect(pub.statusCode).toBe(200);
    expect((pub.json() as { status: string }).status).toBe("PUBLISHED");
    expect(await statusOf(t, id)).toBe("PUBLISHED");
  });

  it("② required:false 的引用不挡发布（与 lint 的 unresolved 口径一致：可选引用是可选的）", async () => {
    const t = await createTestApp();
    const id = await createSkill(t, "optional_ref", [{ kind: "solver", key: DEAD_SOLVER, required: false }]);
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish?force=true`, headers: H });
    expect(pub.statusCode).toBe(200);
    expect(await statusOf(t, id)).toBe("PUBLISHED");
  });

  it("② 无跨系统引用的技能完全不受影响（不去打 DataCore，零回归）", async () => {
    const t = await createTestApp();
    const id = await createSkill(t, "no_ref", []);
    let called = 0;
    t.dataCore.catalog.discover = async () => { called++; return { items: [] }; };
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish?force=true`, headers: H });
    expect(pub.statusCode).toBe(200);
    expect(called).toBe(0); // 没有引用就不查注册表 ⇒ 空注册表也不会误伤这类技能
  });

  // ——————————— ③ 两层 fail-open 各自的红咬（关键：空集 ≠ 都合法）———————————
  it("③ 第二层 fail-open：注册表返回**空集** → 503 REF_PROBE_UNAVAILABLE 且未落库（旧实现在此静默放行）", async () => {
    const t = await createTestApp();
    const id = await createSkill(t, "empty_registry", [{ kind: "solver", key: REAL_SOLVER, required: true }]);
    // 把注册表打成空集：旧 `if (known.size > 0)` 会跳过整段比对 ⇒ missing 恒空 ⇒ 发布成功。
    t.dataCore.catalog.discover = async () => ({ items: [] });

    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish?force=true`, headers: H });

    expect(pub.statusCode).toBe(503);
    const err = (pub.json() as { error: { code: string; message: string } }).error;
    expect(err.code).toBe("REF_PROBE_UNAVAILABLE");
    expect(err.message).toContain("求解器目录"); // 说清是哪一步失败，不是笼统"探针失败"
    expect(await statusOf(t, id)).toBe("DRAFT"); // 「我没找到」≠「它不存在」⇒ 不得放行
  });

  it("③ 第一层 fail-open：注册表**抛错** → 503 REF_PROBE_UNAVAILABLE 且带原始错因，未落库", async () => {
    const t = await createTestApp();
    const id = await createSkill(t, "broken_registry", [{ kind: "solver", key: REAL_SOLVER, required: true }]);
    t.dataCore.catalog.discover = async () => { throw new Error("ECONNREFUSED datacore:4001"); };

    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish?force=true`, headers: H });

    expect(pub.statusCode).toBe(503);
    const err = (pub.json() as { error: { code: string; message: string } }).error;
    expect(err.code).toBe("REF_PROBE_UNAVAILABLE");
    expect(err.message).toContain("ECONNREFUSED"); // 探针出错要说清哪一步失败，不许静默
    expect(await statusOf(t, id)).toBe("DRAFT");
  });

  it("③ 规则注册表空集同守（三个 scope 不许只关一个的 fail-open）", async () => {
    const t = await createTestApp();
    const id = await createSkill(t, "empty_rules", [{ kind: "rule", key: REAL_RULE, required: true }]);
    t.dataCore.rules.listPublishedRuleKeys = async () => [];
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish?force=true`, headers: H });
    expect(pub.statusCode).toBe(503);
    expect((pub.json() as { error: { message: string } }).error.message).toContain("规则库");
    expect(await statusOf(t, id)).toBe("DRAFT");
  });

  it("③ 对象类型注册表空集同守", async () => {
    const t = await createTestApp();
    const id = await createSkill(t, "empty_types", [{ kind: "ontologyType", key: "Base", required: true }]);
    t.dataCore.ontology.listObjectTypeKeys = async () => [];
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish?force=true`, headers: H });
    expect(pub.statusCode).toBe(503);
    expect((pub.json() as { error: { message: string } }).error.message).toContain("本体对象类型");
    expect(await statusOf(t, id)).toBe("DRAFT");
  });

  // ——— fail-open 关死是**全路生效**的，不是只给 skill 一条路开小灶 ———
  it("③ agent 发布路同享 fail-closed（探针是共用实现，不许只在 skill 路关 fail-open）", async () => {
    const t = await createTestApp();
    const create = await t.app.inject({
      method: "POST",
      url: "/b/v1/agents",
      headers: H,
      payload: {
        key: "probe_agent", name: "探针 agent", description: "d", model: "claude-opus-4-8",
        systemPrompt: "你是产能分析助手",
        tools: [{ kind: "BUILTIN", name: "query_objects" }],
        ruleBindings: { ruleKeys: "ALL_APPLICABLE", mode: "PRE_CHECK" },
        skills: [], mcpServers: [],
        scopeDeclaration: { objectTypes: ["Order"], toolNames: ["query_objects"] },
        budget: { maxIterations: 4 },
      },
    });
    expect(create.statusCode).toBe(201);
    const agentId = (create.json() as { id: string }).id;
    t.dataCore.ontology.listObjectTypeKeys = async () => [];
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/agents/${agentId}/publish`, headers: H });
    expect(pub.statusCode).toBe(503);
    expect((pub.json() as { error: { code: string } }).error.code).toBe("REF_PROBE_UNAVAILABLE");
  });
});
