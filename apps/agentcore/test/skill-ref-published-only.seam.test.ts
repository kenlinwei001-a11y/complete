import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "../src/config.js";
import type { RuleEngineClient } from "../src/tools/clients.js";
import { wireDeps } from "../src/deps.js";
import { ScriptedLlmClient } from "../src/llm/mock.js";
import { MockMcpClient } from "../src/mcp/mock.js";
import { createMockDataCore } from "../src/mocks/clients.js";
import { seedIntentsAndPlans, seedScenarioPackage } from "../src/mocks/seed.js";
import { createMemoryRepos } from "../src/persistence/memory.js";
import type { Repos } from "../src/persistence/repos.js";
import { buildServer } from "../src/server.js";
import { createHttpDataCore } from "../src/tools/datacore-http.js";
import { ADMIN, createTestApp } from "./helpers.js";

/**
 * WO-REFGATE-ENT · N-01 · **可引用性 = 已发布**（接缝驱动，SEAM-GATE）
 *
 * 病（2026-08-09 实测坐实）：`HttpRuleEngineClient` 同一个类里有两条 URL——
 *   `listRuleKeys` → `GET /a/v1/rules`（**不带 status**）
 *   `listRules`    → `GET /a/v1/rules?status=PUBLISHED`
 * 而发布期引用探针 `probeMissingRefs`（`resources.ts`）用的恰是**前者**。
 * 于是「一个 Skill 引用未发布的 DRAFT 规则」在门面前一路绿灯：
 * 门确实在跑，只是它问错了问题——问的是「这个 key 在库里有没有」，
 * 该问的是「这个 key **可不可以被引用**」。两个命题的差别就是这一整条测试文件。
 *
 * 本文件**必须走真 HTTP**（`createHttpDataCore` + 真 node http stub），不能只用 mock 客户端：
 * 缺陷长在**那条 URL 的查询串**上，mock 客户端根本没有 URL——用 mock 测这条，
 * 测的是我自己写的假货，不是生产真走的那条线（假绿的经典形态）。
 *
 * 判据三层，缺一不可：
 *   ① 效果层：引用 DRAFT 规则 → 发布 **422 SKILL_REF_UNRESOLVED** 且**未落库**；
 *   ② 效果层：同一条规则改 PUBLISHED → **同样的发布请求 200 PUBLISHED**（门不是"一律拒"）；
 *   ③ 接线层：stub 记下的请求 URL 必须**真带 `status=PUBLISHED`**——
 *      否则 ①② 有可能是别的原因巧合成立（比如 stub 恰好两次返回不同）。
 */

const H = { "x-debug-user": ADMIN, "content-type": "application/json" };
const TENANT = "demo";

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

/** A 侧规则库实况：一条已发布 + 一条草稿。草稿那条正是本单要拦的引用目标。 */
const PUBLISHED_RULE = "C03";
const DRAFT_RULE = "C99_DRAFT";

interface RuleRow {
  key: string;
  status: "DRAFT" | "PUBLISHED";
}

/**
 * 最小 DataCore stub：**只**实现 `GET /a/v1/rules`，且**真的按 `?status=` 过滤**——
 * 与 `apps/datacore/src/app.ts:3281` 的真实现同语义（`rules.list(ctx(req), status)`）。
 * 这一点是本测试的地基：stub 若不认 status，两条判据就都测不出东西（见文件末尾的变异反证用例）。
 */
function startDataCoreStub(rows: RuleRow[], opts: { honorStatusFilter?: boolean } = {}): Promise<{
  url: string;
  close: () => Promise<void>;
  requestedUrls: string[];
  rows: RuleRow[];
}> {
  const honor = opts.honorStatusFilter !== false;
  const requestedUrls: string[] = [];
  const state = { rows };
  const server: Server = createServer((req, res) => {
    const url = req.url ?? "/";
    requestedUrls.push(url);
    const [path, qs] = url.split("?");
    if (path === "/a/v1/rules" && req.method === "GET") {
      const status = new URLSearchParams(qs ?? "").get("status");
      const out = honor && status ? state.rows.filter((r) => r.status === status) : state.rows;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(out.map((r) => ({ key: r.key, name: r.key, severity: "BLOCK", status: r.status }))));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: path, requestId: "stub" } }));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requestedUrls,
        rows: state.rows,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

/** 与 `helpers.createTestApp` 同构，但把 DataCore 换成**真 HTTP 客户端**（缺陷长在 URL 上，mock 测不到）。 */
async function buildAppAgainst(baseUrl: string): Promise<{ app: FastifyInstance; repos: Repos }> {
  const config = loadConfig({ PORT: "0", LOG_LEVEL: "silent" } as NodeJS.ProcessEnv);
  const repos = createMemoryRepos();
  await repos.packages.insert(seedScenarioPackage());
  const { intents, plans } = seedIntentsAndPlans();
  for (const p of plans) await repos.plans.insert(p);
  for (const i of intents) await repos.intents.insert(i);
  const deps = wireDeps({
    config,
    repos,
    llm: new ScriptedLlmClient(),
    dataCore: createHttpDataCore(baseUrl),
    mcp: new MockMcpClient(),
  });
  const app = await buildServer(deps);
  await app.ready();
  return { app, repos };
}

async function createSkillRefingRule(app: FastifyInstance, key: string, ruleKey: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/b/v1/skills",
    headers: H,
    payload: {
      key,
      name: `技能 ${key}`,
      summary: GOOD_SUMMARY,
      body: GOOD_BODY,
      resources: [],
      references: [{ kind: "rule", key: ruleKey, role: "postcheck", required: true }],
    },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()!();
});

describe("WO-REFGATE-ENT · N-01 · 引用可校验门查的是「可不可以被引用」而非「库里有没有」", () => {
  // ——— 金丝雀：先自证 stub 真的会按 status 过滤，否则下面每一条断言都可能是巧合 ———
  it("金丝雀：stub 的 /a/v1/rules 带 ?status=PUBLISHED 时只返已发布（否则本文件全部断言失去意义）", async () => {
    const stub = await startDataCoreStub([
      { key: PUBLISHED_RULE, status: "PUBLISHED" },
      { key: DRAFT_RULE, status: "DRAFT" },
    ]);
    closers.push(stub.close);
    const all = (await (await fetch(`${stub.url}/a/v1/rules`)).json()) as { key: string }[];
    const pub = (await (await fetch(`${stub.url}/a/v1/rules?status=PUBLISHED`)).json()) as { key: string }[];
    expect(all.map((r) => r.key)).toEqual([PUBLISHED_RULE, DRAFT_RULE]); // 不带过滤 = 两条都在（旧 URL 看到的世界）
    expect(pub.map((r) => r.key)).toEqual([PUBLISHED_RULE]); // 带过滤 = 只剩一条（新 URL 看到的世界）
  });

  it("① 引用 DRAFT 规则 → 422 SKILL_REF_UNRESOLVED 且未落库（修前：200 PUBLISHED）", async () => {
    const stub = await startDataCoreStub([
      { key: PUBLISHED_RULE, status: "PUBLISHED" },
      { key: DRAFT_RULE, status: "DRAFT" },
    ]);
    closers.push(stub.close);
    const { app, repos } = await buildAppAgainst(stub.url);
    closers.push(async () => { await app.close(); });

    const id = await createSkillRefingRule(app, "ref_draft_rule", DRAFT_RULE);
    // force=true 已豁免 lint 门与评测门 ⇒ 还能产出 422 的只剩引用门本身（判据不被别的门冒充）
    const pub = await app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish?force=true`, headers: H });

    expect(pub.statusCode).toBe(422);
    const err = (pub.json() as { error: { code: string; message: string } }).error;
    expect(err.code).toBe("SKILL_REF_UNRESOLVED");
    expect(err.message).toContain(DRAFT_RULE);
    // 「拒发布」和「真没落库」是两个命题
    expect((await repos.skills.get(id))?.status).toBe("DRAFT");

    // ③ 接线层：探针真的问的是"已发布集"，不是"全集"。
    const ruleCalls = stub.requestedUrls.filter((u) => u.startsWith("/a/v1/rules"));
    expect(ruleCalls.length).toBeGreaterThan(0);
    expect(ruleCalls.every((u) => u.includes("status=PUBLISHED"))).toBe(true);
  });

  it("② 同一条规则改 PUBLISHED → 同样的发布请求 200 PUBLISHED（门不是「一律拒」，是真按状态判）", async () => {
    const rows: RuleRow[] = [
      { key: PUBLISHED_RULE, status: "PUBLISHED" },
      { key: DRAFT_RULE, status: "DRAFT" },
    ];
    const stub = await startDataCoreStub(rows);
    closers.push(stub.close);
    const { app, repos } = await buildAppAgainst(stub.url);
    closers.push(async () => { await app.close(); });

    const id = await createSkillRefingRule(app, "ref_then_published", DRAFT_RULE);
    const before = await app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish?force=true`, headers: H });
    expect(before.statusCode).toBe(422);
    expect((await repos.skills.get(id))?.status).toBe("DRAFT");

    // ——— A 侧把该规则发布出去（等价 POST /a/v1/rules/:id/publish）———
    rows[1]!.status = "PUBLISHED";

    const after = await app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish?force=true`, headers: H });
    expect(after.statusCode).toBe(200);
    expect((after.json() as { status: string }).status).toBe("PUBLISHED");
    expect((await repos.skills.get(id))?.status).toBe("PUBLISHED");
  });

  it("② 引用一条本来就已发布的规则不受影响（零回归）", async () => {
    const stub = await startDataCoreStub([
      { key: PUBLISHED_RULE, status: "PUBLISHED" },
      { key: DRAFT_RULE, status: "DRAFT" },
    ]);
    closers.push(stub.close);
    const { app, repos } = await buildAppAgainst(stub.url);
    closers.push(async () => { await app.close(); });

    const id = await createSkillRefingRule(app, "ref_published_rule", PUBLISHED_RULE);
    const pub = await app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish?force=true`, headers: H });
    expect(pub.statusCode).toBe(200);
    expect((await repos.skills.get(id))?.status).toBe("PUBLISHED");
  });

  /**
   * **变异反证**：把 stub 退化成"忽略 status 参数"——这正是**修复前那条裸 URL 看到的世界**
   * （`GET /a/v1/rules` 返全集）。此时 DRAFT 规则被当作合法引用，发布放行。
   *
   * 这条用例的作用不是保护某个行为，而是证明上面 ①② **咬的确实是过滤这条线**：
   * 若不带过滤也能拿到 422，那 ① 的绿就与本单无关。
   */
  it("变异反证：注册表退化成「不认 status」（= 修复前的裸 URL 语义）→ DRAFT 规则被放行 200，缺陷复现", async () => {
    const stub = await startDataCoreStub(
      [
        { key: PUBLISHED_RULE, status: "PUBLISHED" },
        { key: DRAFT_RULE, status: "DRAFT" },
      ],
      { honorStatusFilter: false },
    );
    closers.push(stub.close);
    const { app, repos } = await buildAppAgainst(stub.url);
    closers.push(async () => { await app.close(); });

    const id = await createSkillRefingRule(app, "mutant_ignores_status", DRAFT_RULE);
    const pub = await app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish?force=true`, headers: H });
    expect(pub.statusCode).toBe(200); // ← 缺陷原貌：DRAFT 引用照样发布
    expect((await repos.skills.get(id))?.status).toBe("PUBLISHED");
  });

  /**
   * mock 链路同守：`draftRuleKeys` 旋钮把某 key 挪出"可被引用集"后，纯 mock 的 seam 测试也拦得住。
   * （真 HTTP 那条已在上面咬过 URL；这条保的是 mock 与 HTTP 两个实现**语义一致**，不许一个宽一个严。）
   */
  it("mock 客户端同语义：draftRuleKeys 里的 key 不在已发布集 → 引用它的技能发布 422", async () => {
    const t = await createTestApp();
    const mockDc = createMockDataCore();
    // 上转到接口：mock 的 listPublishedRuleKeys 漏了接口声明的 ctx 形参（src/mocks/clients.ts:706），
    // 直接调具体类型会 TS2554。原来的 `as never` 压不住 arity 错，只是把实参类型糊掉了。
    const mockRules: RuleEngineClient = mockDc.rules;
    expect(await mockRules.listPublishedRuleKeys({ tenantId: TENANT, userId: "u", roles: [] })).toContain("C03");

    (t.dataCore.rules as unknown as { draftRuleKeys: Set<string> }).draftRuleKeys.add("C03");
    const rules: RuleEngineClient = t.dataCore.rules;
    expect(await rules.listPublishedRuleKeys({ tenantId: TENANT, userId: "u", roles: [] })).not.toContain("C03");

    const create = await t.app.inject({
      method: "POST",
      url: "/b/v1/skills",
      headers: H,
      payload: {
        key: "mock_draft_rule",
        name: "引用草稿规则",
        summary: GOOD_SUMMARY,
        body: GOOD_BODY,
        resources: [],
        references: [{ kind: "rule", key: "C03", role: "postcheck", required: true }],
      },
    });
    const id = (create.json() as { id: string }).id;
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish?force=true`, headers: H });
    expect(pub.statusCode).toBe(422);
    expect((pub.json() as { error: { code: string } }).error.code).toBe("SKILL_REF_UNRESOLVED");
    expect((await t.repos.skills.get(id))?.status).toBe("DRAFT");
  });
});
