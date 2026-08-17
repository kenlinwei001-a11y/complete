import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { LightMyRequestResponse } from "fastify";
import type { Scenario } from "@platform/contracts";
import type { RuleEngineClient } from "../src/tools/clients.js";
import { ADMIN, PKG, TENANT, createTestApp, type TestApp } from "./helpers.js";

/**
 * WO-PUBLISH-REFPROBE · 引用可校验门接上 **plan 发布路**（接缝驱动，SEAM-GATE）
 *
 * ── 病 ──────────────────────────────────────────────────────────────────────
 * `catalog.publishPlan` 确证携带规则引用——它调 `planStepRuleRefs` 并 `reportRefs`
 * 上报 A，A 侧据此反查影响面——**却从不调 `probeMissingRefs`**。
 * 于是「引用一条查无此物 / 仍是 DRAFT 的规则」照样发布成功：运行时才炸，
 * 而发布那一刻屏上说「发布成功」。
 *
 * ── 形态定性（CLAUDE.md 铁律 0.5 三分法）─────────────────────────────────────
 * 不是「没接线」（`probeMissingRefs` 早就存在，且已接 agent / workflow / skill 三路），
 * 是**「接了线接错地方」** —— 少挂一个挂载点。修法 = 补挂载点，不是造门。
 * 曾有人把它错报成「造一道门」，直接歪掉排期。
 *
 * ── 本文件是接缝测试，不是函数测试 ──────────────────────────────────────────
 * 一律从 HTTP 端点打进去（`POST /api/v1/catalog/plans/:planId/publish`），
 * 经真 server → 真 handler → 真 `CatalogService.publishPlan` → 真 `probeMissingRefs`
 * → mock DataCore 注册表；并逐条断言**落库与否**（`repos.plans.get(id).status`）——
 * 「返回 422」和「真没落库」是两个命题。
 *
 * ── 三条发布路一并咬住 ──────────────────────────────────────────────────────
 * `publishPlan` 有三个生产调用方，门挂在扼颈点上，本文件对三条各驱一次：
 *   ① `POST /api/v1/catalog/plans/:planId/publish`
 *   ② `POST /b/v1/scenarios/:key/publish-chain`
 *   ③ `POST /b/v1/plan-builders/:id/publish`（PlanBuilderService.publishCanvas）
 * 只测 ① 会让 ②③ 留在"接了线接错地方"的老状态里而全绿。
 */

const H = { "x-debug-user": ADMIN, "content-type": "application/json" };

/** mock 注册表实况（金丝雀基准）：C03/C08 在已发布规则集里；假 key 一定不在。 */
const REAL_RULE = "C03";
const REAL_RULE_2 = "C08";
const DEAD_RULE = "__no_such_rule_xyz__";
const REAL_SOLVER = "capacity_forecast";
const DEAD_SOLVER = "__no_such_solver_xyz__";

const RENDER = { id: "render", type: "render_answer", params: { blocks: [{ type: "text", markdown: "ok" }] } };

type Step = Record<string, unknown>;

async function createPlan(t: TestApp, key: string, steps: Step[]): Promise<string> {
  const res = await t.app.inject({
    method: "POST",
    url: `/api/v1/catalog/packages/${PKG}/plans`,
    headers: H,
    payload: { key, steps },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

// ⚠️ 别给它写 `ReturnType<TestApp["app"]["inject"]>`：那个重载解析到的是 `Chain`（可链式 builder），
// 不是 `Promise<Response>`，宽面 typecheck（含 test/ 的 tsconfig.typecheck.json）会当场 TS2740。
async function publish(t: TestApp, planId: string): Promise<LightMyRequestResponse> {
  return t.app.inject({ method: "POST", url: `/api/v1/catalog/plans/${planId}/publish`, headers: H });
}

const statusOf = async (t: TestApp, planId: string): Promise<string | undefined> => (await t.repos.plans.get(planId))?.status;

const errOf = (res: { json: () => unknown }): { code: string; message: string; requestId?: string } =>
  (res.json() as { error: { code: string; message: string; requestId?: string } }).error;

/** mock 的 `draftRuleKeys` 旋钮：把某 key 挪出「可被引用集」，模拟 A 侧 DRAFT 规则。 */
const markDraft = (t: TestApp, key: string): void => {
  (t.dataCore.rules as unknown as { draftRuleKeys: Set<string> }).draftRuleKeys.add(key);
};

describe("WO-PUBLISH-REFPROBE · plan 发布路的引用可校验门", () => {
  // ═══════════════════════ ⓪ 金丝雀：先自证注册表不是空的 ═══════════════════════
  // 否则下面每一条「报 422」都可能只是因为注册表本身读不出东西 —— 那测的就不是我要测的东西。
  // 报否定结论（「这个 key 不存在」）必须同时给出金丝雀的命中证据，这是 CLAUDE.md 铁律 0.6 的硬要求。
  it("⓪ 金丝雀：mock 规则库认得 C03/C08、不认得假 key；求解器目录认得 capacity_forecast", async () => {
    const t = await createTestApp();
    const ctx = { tenantId: TENANT, userId: "u", roles: [] };
    const rules: RuleEngineClient = t.dataCore.rules;
    const published = await rules.listPublishedRuleKeys(ctx);
    expect(published).toContain(REAL_RULE);
    expect(published).toContain(REAL_RULE_2);
    expect(published).not.toContain(DEAD_RULE);
    // ⚠️ 金丝雀必须验**探针真读的那张表**。探针的 solver 切面读的是 `solverRegistry`
    // （求解器**全集**注册表 = A 侧 `ALL_SOLVER_CATALOG`，与 `SOLVER_KEYS` 键集相等），
    // **不是** `discover`（给模型看的候选清单：论域缺 `GENERIC_SOLVER_CATALOG` 那 20 条、
    // 带 query 还 ≤20 截断）。验错表 = 金丝雀站错岗，会陪着给出自信的错误答案。
    const solvers = (await t.dataCore.catalog.solverRegistry(ctx as never)).items.map((i: { key: string }) => i.key);
    expect(solvers).toContain(REAL_SOLVER);
    expect(solvers).not.toContain(DEAD_SOLVER);
    // 论域订正的落点证据：`generic_inference` 运行时可调（A 侧 `SOLVER_KEYS` 含它），
    // 出厂计划 `ceo_whatif` 正引用它 —— 它必须在探针视野内，否则这道门会误杀一条跑得通的计划。
    expect(solvers, "generic_inference 不在探针视野 ⇒ 门会误杀出厂计划 ceo_whatif").toContain("generic_inference");
  });

  // ═══════════════════════ ① 正向：死路引用 → 拒绝 + 未落库 ═══════════════════════
  it("① 引用一条**不存在**的规则 → 422 PLAN_REF_UNRESOLVED 且未落库（接线前：200 PUBLISHED）", async () => {
    const t = await createTestApp();
    const id = await createPlan(t, "dead_rule_plan", [
      { id: "s1", type: "evaluate_rules", params: { ruleIds: [DEAD_RULE], payload: {} } },
      RENDER,
    ]);

    const res = await publish(t, id);

    expect(res.statusCode).toBe(422);
    const err = errOf(res);
    // 码要能把「引用死路」与「步骤结构错」分开：后者是 PLAN_VALIDATION_ERROR，
    // 混成一个码，运维拿到告警不知道该去查规则库还是查步骤定义。
    expect(err.code).toBe("PLAN_REF_UNRESOLVED");
    expect(err.code).not.toBe("PLAN_VALIDATION_ERROR");
    expect(err.message).toContain(DEAD_RULE); // 点名到 key，不许笼统「引用有问题」
    expect(err.message).toContain("死路");
    expect(err.requestId).toBeTruthy(); // R7 错误信封 {code,message,requestId}
    // **未落库**：拒发布 ≠ 已落库但返回错误
    expect(await statusOf(t, id)).toBe("DRAFT");
  });

  it("① 引用一条**仍是 DRAFT** 的规则 → 同样 422 且未落库（判据是「可不可以被引用」，不是「库里有没有这条记录」）", async () => {
    const t = await createTestApp();
    markDraft(t, REAL_RULE_2); // C08 从"已发布"挪进"草稿" —— 库里**有**这条记录，但不可被引用
    const id = await createPlan(t, "draft_rule_plan", [
      { id: "s1", type: "evaluate_rules", params: { ruleIds: [REAL_RULE_2], payload: {} } },
      RENDER,
    ]);

    const res = await publish(t, id);

    expect(res.statusCode).toBe(422);
    expect(errOf(res).code).toBe("PLAN_REF_UNRESOLVED");
    expect(errOf(res).message).toContain(REAL_RULE_2);
    // 文案必须点明「或未发布」——否则运维会去查"规则是不是被删了"，而它明明还在库里
    expect(errOf(res).message).toContain("未发布");
    expect(await statusOf(t, id)).toBe("DRAFT");
  });

  it("① 求解器维同守：引用不存在的 solverKey → 422 且未落库", async () => {
    const t = await createTestApp();
    const id = await createPlan(t, "dead_solver_plan", [
      { id: "s1", type: "invoke_solver", params: { solverKey: DEAD_SOLVER, args: {} } },
      RENDER,
    ]);

    const res = await publish(t, id);

    expect(res.statusCode).toBe(422);
    expect(errOf(res).message).toContain(DEAD_SOLVER);
    expect(errOf(res).message).toContain("未注册");
    expect(await statusOf(t, id)).toBe("DRAFT");
  });

  // ═══════════════ ② 反向金丝雀：正常引用 → 发布成功（证明不是把所有发布都拦了）═══════════════
  it("② 引用**正常已发布**的规则 + 已注册的求解器 → 200 PUBLISHED（门真去查了注册表，不是一律拒）", async () => {
    const t = await createTestApp();
    const id = await createPlan(t, "live_ref_plan", [
      { id: "s1", type: "invoke_solver", params: { solverKey: REAL_SOLVER, args: {} } },
      { id: "s2", type: "evaluate_rules", params: { ruleIds: [REAL_RULE, REAL_RULE_2], payload: {} } },
      RENDER,
    ]);

    const res = await publish(t, id);

    expect(res.statusCode).toBe(200);
    expect((res.json() as { status: string }).status).toBe("PUBLISHED");
    expect(await statusOf(t, id)).toBe("PUBLISHED");
    // §2.3 既有语义不受影响：发布响应仍附影响面
    expect(res.json()).toHaveProperty("impact");
  });

  it("② `ruleIds: \"ALL_APPLICABLE\"` 不是具体 key ⇒ 不进探针，照常发布（别把通配当成一条查无此物的规则）", async () => {
    const t = await createTestApp();
    const id = await createPlan(t, "all_applicable_plan", [
      { id: "s1", type: "evaluate_rules", params: { ruleIds: "ALL_APPLICABLE", payload: {} } },
      RENDER,
    ]);
    expect((await publish(t, id)).statusCode).toBe(200);
    expect(await statusOf(t, id)).toBe("PUBLISHED");
  });

  it("② 无跨系统引用的计划完全不打 DataCore（零回归：注册表空也不误伤这类计划）", async () => {
    const t = await createTestApp();
    const id = await createPlan(t, "no_ref_plan", [RENDER]);
    let discoverCalls = 0;
    let ruleCalls = 0;
    t.dataCore.catalog.solverRegistry = async () => { discoverCalls++; return { items: [] }; };
    t.dataCore.catalog.discover = async () => { discoverCalls++; return { items: [] }; };
    (t.dataCore.rules as unknown as { listPublishedRuleKeys: () => Promise<string[]> }).listPublishedRuleKeys = async () => { ruleCalls++; return []; };

    expect((await publish(t, id)).statusCode).toBe(200);
    expect(discoverCalls).toBe(0);
    expect(ruleCalls).toBe(0);
  });

  // ═══════════ ③ fail-closed 的另一半：注册表不可用 ≠ 都合法（「我没找到」≠「它不存在」）═══════════
  it("③ 规则库返回**空集** → 503 REF_PROBE_UNAVAILABLE 且未落库（不是「无法判定→放行」）", async () => {
    const t = await createTestApp();
    const id = await createPlan(t, "empty_registry_plan", [
      { id: "s1", type: "evaluate_rules", params: { ruleIds: [REAL_RULE], payload: {} } },
      RENDER,
    ]);
    (t.dataCore.rules as unknown as { listPublishedRuleKeys: () => Promise<string[]> }).listPublishedRuleKeys = async () => [];

    const res = await publish(t, id);

    expect(res.statusCode).toBe(503);
    expect(errOf(res).code).toBe("REF_PROBE_UNAVAILABLE");
    expect(errOf(res).message).toContain("规则库"); // 说清是哪一步失败，不是笼统"探针失败"
    expect(await statusOf(t, id)).toBe("DRAFT");
  });

  it("③ 求解器全集注册表**抛错** → 503 且带上游原始错因，未落库", async () => {
    const t = await createTestApp();
    const id = await createPlan(t, "broken_registry_plan", [
      { id: "s1", type: "invoke_solver", params: { solverKey: REAL_SOLVER, args: {} } },
      RENDER,
    ]);
    t.dataCore.catalog.solverRegistry = async () => { throw new Error("ECONNREFUSED datacore:4001"); };

    const res = await publish(t, id);

    expect(res.statusCode).toBe(503);
    expect(errOf(res).code).toBe("REF_PROBE_UNAVAILABLE");
    expect(errOf(res).message).toContain("ECONNREFUSED");
    expect(await statusOf(t, id)).toBe("DRAFT");
  });

  // ═════════ ④ 三条发布路都得过这道门（只挂 route 会把另两条留敞而全绿）═════════
  it("④ publish-chain：链里的计划引用死路规则 → 整条链被拒，计划与场景都不落库", async () => {
    const t = await createTestApp();
    await t.deps.catalog.createPlan(PKG, {
      key: "chain_dead_plan",
      steps: [
        { id: "s1", type: "evaluate_rules", params: { ruleIds: [DEAD_RULE], payload: {} } },
        RENDER,
      ] as never,
    });
    await t.deps.catalog.createIntent(PKG, {
      key: "chain_dead_intent", name: "链上死路", description: "x", examples: ["x"], enabledViews: "*",
      slots: [{ name: "n", type: "string", required: false, description: "d" }],
      planRef: { planKey: "chain_dead_plan", version: "latest" }, riskLevel: "COMPUTE", owner: "test",
    });
    const now = new Date().toISOString();
    await t.repos.scenarios.upsert({
      id: "scn_dead", tenantId: TENANT, scenarioKey: "scene_dead", name: "死路场景", domain: "plan",
      targetView: "project", intentKey: "chain_dead_intent", triggerQuestion: "x", rules: [], riskLevel: "COMPUTE",
      summary: "x", mode: "WORKFLOW_FIRST", presetContext: { targetView: "project", selectedObjects: [], slotPresets: {} },
      status: "DRAFT", version: 1, updatedAt: now,
    } as Scenario);

    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/scene_dead/publish-chain", headers: H });

    expect(res.statusCode).toBe(422);
    expect(errOf(res).code).toBe("PLAN_REF_UNRESOLVED");
    const plans = await t.repos.plans.listByPackage(PKG);
    expect(plans.find((p) => p.key === "chain_dead_plan")?.status).toBe("DRAFT");
    expect((await t.repos.scenarios.byKey(TENANT, "scene_dead"))?.status).toBe("DRAFT");
  });

  it("④ publish-chain 正例：引用真实规则的链照常一键发布（证明 ④ 的拒绝是引用门拦的，不是链本身坏了）", async () => {
    const t = await createTestApp();
    await t.deps.catalog.createPlan(PKG, {
      key: "chain_live_plan",
      steps: [
        { id: "s1", type: "evaluate_rules", params: { ruleIds: [REAL_RULE], payload: {} } },
        RENDER,
      ] as never,
    });
    await t.deps.catalog.createIntent(PKG, {
      key: "chain_live_intent", name: "链上正例", description: "x", examples: ["x"], enabledViews: "*",
      slots: [{ name: "n", type: "string", required: false, description: "d" }],
      planRef: { planKey: "chain_live_plan", version: "latest" }, riskLevel: "COMPUTE", owner: "test",
    });
    const now = new Date().toISOString();
    await t.repos.scenarios.upsert({
      id: "scn_live", tenantId: TENANT, scenarioKey: "scene_live", name: "正例场景", domain: "plan",
      targetView: "project", intentKey: "chain_live_intent", triggerQuestion: "x", rules: [], riskLevel: "COMPUTE",
      summary: "x", mode: "WORKFLOW_FIRST", presetContext: { targetView: "project", selectedObjects: [], slotPresets: {} },
      status: "DRAFT", version: 1, updatedAt: now,
    } as Scenario);

    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/scene_live/publish-chain", headers: H });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { publishedChain: { kind: string }[] }).publishedChain.map((c) => c.kind)).toEqual(["plan", "intent", "scenario"]);
  });

  it("④ plan-builder：画布 DSL 里的死路 solver → 发布被拒，画布不落 PUBLISHED", async () => {
    const t = await createTestApp();
    const create = await t.app.inject({
      method: "POST",
      url: `/b/v1/plan-builders?packageId=${PKG}`,
      headers: H,
      payload: {
        key: "pb_dead", name: "死路画布",
        dsl: {
          version: "1",
          nodes: [
            { id: "n1", type: "SOLVER", label: "死路", position: { x: 0, y: 0 }, solverKey: DEAD_SOLVER, args: {} },
            { id: "n2", type: "OUTPUT", label: "出", position: { x: 100, y: 0 }, blocks: [{ type: "text", markdown: "x" }] },
          ],
          edges: [{ id: "e1", from: "n1", to: "n2" }],
        },
      },
    });
    expect(create.statusCode).toBe(201);
    const id = (create.json() as { id: string }).id;

    const res = await t.app.inject({ method: "POST", url: `/b/v1/plan-builders/${id}/publish`, headers: H });

    // plan-builder 有自己的前置 `validateRefs`（探画布 DSL 节点）→ 200 {ok:false, errors}
    // 与本单在 `publishPlan` 里的探针（探编译后 steps）是**纵深**：任一层咬住都算门生效。
    // 判据落在"没发布出去"这个事实上，不写死是哪一层拦的。
    const body = res.json() as { ok?: boolean; errors?: { message: string }[] };
    const rejected = res.statusCode >= 400 || body.ok === false;
    expect(rejected).toBe(true);
    if (body.errors) expect(JSON.stringify(body.errors)).toContain(DEAD_SOLVER);
    expect((await t.repos.planBuilders.get(id))?.status).toBe("DRAFT");
  });

  // ═════════ ⑤ 存量：库里现有的种子计划，放到这道门下会不会当场不可用 ═════════
  // 这一条是**实测**不是推理：种子计划全部经 `repos.plans.insert` 旁路以 PUBLISHED 落库，
  // 从没走过 `publishPlan`。若它们的引用过不了新门，`publish-chain` / 重发布就会当场炸。
  it("⑤ 存量金丝雀：全部种子计划的跨系统引用都能过这道门（过不了即 mock 保真缺口或真死路，两者都必须当场报红）", async () => {
    const t = await createTestApp();
    const ctx = { tenantId: TENANT, userId: "u", roles: ["admin"] };
    const offenders: string[] = [];
    let probed = 0;
    for (const pkg of await t.repos.packages.listByTenant(TENANT)) {
      for (const pl of await t.repos.plans.listByPackage(pkg.id)) {
        const solverKeys: string[] = [];
        const ruleKeys: string[] = [];
        for (const st of pl.steps) {
          const p = st.params as Record<string, unknown>;
          if (st.type === "invoke_solver" && typeof p.solverKey === "string") solverKeys.push(p.solverKey);
          if (st.type === "evaluate_rules" && Array.isArray(p.ruleIds)) {
            for (const r of p.ruleIds as unknown[]) if (typeof r === "string") ruleKeys.push(r);
          }
        }
        if (solverKeys.length === 0 && ruleKeys.length === 0) continue;
        probed++;
        const missing = await t.deps.catalog["probeRefs"](ctx as never, { solverKeys, ruleKeys });
        const dead = [...missing.solvers.map((s) => `solver:${s}`), ...missing.rules.map((r) => `rule:${r}`)];
        if (dead.length > 0) offenders.push(`${pl.key}@v${pl.version} → ${dead.join("、")}`);
      }
    }
    // 金丝雀：真有计划被探过针（若 probed=0，上面的"零违规"只是因为一条都没查）
    expect(probed).toBeGreaterThan(10);
    expect(offenders, `存量种子计划引用过不了引用可校验门：\n${offenders.join("\n")}`).toEqual([]);
  });

  // ═════════ ⑥ 结构绊线：探针调用被摘掉 / 被注释掉时，机器先说话 ═════════
  // 上面①—⑤是行为层的变异反证（摘掉探针 → ①③④ 立刻红在"死路被放行了"）。
  // 本条补的是另一种摘法：**连测试一起删**。它只证明"调用还在源码里"，
  // ⚠️ 不证明"这条链会跑到那里"——那是①—⑤的活。两者缺一不可，不许拿本条冒充接缝驱动。
  it("⑥ 结构绊线：`publishPlan` 体内（剥注释后）必须出现探针调用", () => {
    const src = readFileSync(new URL("../src/catalog/service.ts", import.meta.url), "utf8");
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    // 抽取器自证：先拿一个已知必在 publishPlan 体内的串跑一遍。
    // ⚠️ 起点必须跳过参数表与返回类型 —— `async publishPlan(planId: string, ctx: ToolAuthCtx):
    //    Promise<ExecutionPlan & { impact: PublishImpact }>` 的第一个 `{` 在**返回类型**里，
    //    取它会抽出 25 字符的假体、于是任何探针串都报未命中（本单实测踩过，金丝雀当场抖出）。
    const at = stripped.indexOf("async publishPlan(");
    expect(at, "锚点未命中 ⇒ 抽取器坏了，不是代码没接线").toBeGreaterThan(-1);
    const arrowless = stripped.indexOf("{", stripped.indexOf(">", stripped.indexOf(")", at)));
    let depth = 0;
    let end = arrowless;
    for (; end < stripped.length; end++) {
      if (stripped[end] === "{") depth++;
      else if (stripped[end] === "}" && --depth === 0) break;
    }
    const body = stripped.slice(arrowless, end + 1);
    expect(body).toContain("validatePlanSteps("); // 金丝雀：已知必在体内
    expect(body.length).toBeGreaterThan(400); // 金丝雀：不是抽到了返回类型那个 25 字符的假体
    expect(body, "publishPlan 体内没有探针调用 ⇒ 门被摘了").toContain("this.probeRefs(");
    // 落库之前拦：探针调用必须排在 `repos.plans.update` 之前，否则"拒发布"会变成"已落库再报错"
    expect(body.indexOf("this.probeRefs(")).toBeLessThan(body.indexOf("plans.update("));
  });
});
