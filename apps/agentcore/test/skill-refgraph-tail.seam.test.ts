import { describe, expect, it } from "vitest";
import type { SkillDefinition } from "@platform/contracts";
import { createTestApp, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { seedRegistry } from "../src/mocks/seed.js";
import { extractRelations, type DerivedRelation } from "../src/dril/resource-projector.js";
import { extractResourceRelations } from "../src/dril/relations.js";
import { auditSeededSkills } from "../src/skill-publish-gate.js";

/**
 * WO-SKILL-REFGRAPH-TAIL · `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 的**残口收尾**（接缝驱动·SEAM-GATE）。
 *
 * 本体 §8 把这条断点拆成三处**分别定性**（混为一谈就会修错地方）：
 *   ① 死抽取器 `extractRelations` 零 src 调用方   —— ✅ 2026-08-18 WO-SKILL-REFGRAPH-WIRE 接线
 *   ② `dependsOn` 的消费方（环检测）覆盖不足      —— 本单实测：**处方已过期**，见 §D
 *   ③ skill 发布路没接 `probeMissingRefs` + fail-open —— ✅ 2026-08-09 WO-SKILL-REFCLOSURE-A
 *
 * 本文件**不重抄**已有断言（`skill-ref-closure.seam.test.ts` 13 条咬 ③ 的 HTTP 面、
 * `skill-partial-a-seam.test.ts` 咬 ① 的种子面）。它补的是全仓**一条都没有**的两维，
 * 以及把三处焊在同一条链路上的对照：
 *
 *   §A T1/T2  ③ 还活着：死路引用被拒且未落库 / 完整引用能发 —— 这两条同时是本单的**变异反证靶点**
 *   §B T3     ① 还活着：用户新建（非种子）技能的 references/dependsOn 边真的进了 resource_relations
 *   §C T4/T5  **本仓此前零断言**：基础边单源（没复制第二份）+ 去重与确定性序
 *   §D T6     ② 的真相：环检测分支**进得去**（生产路由驱动），而「补种子成环」与 F14 出厂审计门直接冲突
 *
 * 纪律：
 *  · 一律从**生产入口**打进去（HTTP 端点 / 生产函数），不测「函数被调了」而测「链路产出变了」；
 *  · 报任何否定结论（「没有第二份抽取逻辑」「种子无环」）之前先跑金丝雀自证工具没瞎（铁律 0.6）；
 *  · 抽取器的输入**取自生产实物** `seedRegistry()`，不手写单行样例
 *    —— 手写样例的形状可能与真实的多段拼接交集为空，那样断言全绿也证明不了生产那条路。
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

/** mock DataCore 注册表实况：出厂含 capacity_forecast / C03，不含下面这两个假 key。 */
const REAL_SOLVER = "capacity_forecast";
const DEAD_SOLVER = "__no_such_solver_refgraph_tail__";
const REAL_RULE = "C03";

type Ref = { kind: string; key: string; role?: string; required?: boolean };

async function createSkill(t: TestApp, key: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await t.app.inject({
    method: "POST",
    url: "/b/v1/skills",
    headers: H,
    payload: { key, name: `技能 ${key}`, summary: GOOD_SUMMARY, body: GOOD_BODY, resources: [], ...extra },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

const statusOf = async (t: TestApp, id: string): Promise<string | undefined> => (await t.repos.skills.get(id))?.status;

/** 关系边的稳定主键（与两个抽取器内部去重口径同构）。 */
const pk = (r: DerivedRelation): string => `${r.fromKind}|${r.fromKey}|${r.relType}|${r.toKind}|${r.toKey}`;

/** 出厂真数据（= 抽取器的生产实参）。 */
const seedInput = (): { workflows: never[]; agents: never[]; skills: never[]; rules: never[] } => {
  const { workflows, agents, skills } = seedRegistry();
  return { workflows, agents, skills, rules: [] } as never;
};

describe("WO-SKILL-REFGRAPH-TAIL · §A 引用可校验门（③）在 skill 发布路上还活着", () => {
  it("金丝雀：mock 求解器目录含真 key、不含假 key（否则本节每条 422 都可能只是注册表空）", async () => {
    const t = await createTestApp();
    const { items } = await t.dataCore.catalog.discover({ tenantId: TENANT, userId: "u", roles: [] } as never, "solvers");
    const keys = items.map((i: { key: string }) => i.key);
    expect(keys).toContain(REAL_SOLVER);
    expect(keys).not.toContain(DEAD_SOLVER);
  });

  /**
   * T1 · **本单变异反证的靶点**。
   *
   * ⚠️ 这里刻意走 `?force=true`：force 豁免的是**质量门**（lint / 评测用例数与覆盖），
   * 于是这条路上**唯一还能产出 422 的就是引用门本身** —— 判据不被别的门冒充。
   * 不加 force 会踩本仓的老坑：把 fail-open 改回去之后，请求被**下游评测门**接手拦下，
   * 红的原文变成 `expected 'SKILL_EVAL_INSUFFICIENT' to be 'SKILL_REF_UNRESOLVED'`
   * —— 那句话证明的是"另一道门顺手挡了一下"，而不是"这道门放行了"（实测原文见交单报告）。
   *
   * 变异方式：把 `apps/agentcore/src/server.ts` skills.publish 里
   * `if (blocking) throw new HttpError(422, blocking.code, blocking.message)`
   * 改回 fail-open（`SKILL_REF_UNRESOLVED` 只 `req.log.warn` 然后继续往下走）。
   * 期望的红：`expected 200 to be 422` + `expected 'PUBLISHED' to be 'DRAFT'`
   * —— 红在「**放行了**」（状态码 + 真落了库），**不是**红在「函数不存在 / 抛异常」。
   */
  it("T1 · 引用不存在的资源 → 422 SKILL_REF_UNRESOLVED，报文点名缺的那个 key，且未落库", async () => {
    const t = await createTestApp();
    const id = await createSkill(t, "tail_dead_ref", {
      references: [{ kind: "solver", key: DEAD_SOLVER, role: "context", required: true }] satisfies Ref[],
    });

    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish?force=true`, headers: H });

    // ① 放行与否（fail-open 回潮时这一条先红）
    expect(pub.statusCode).toBe(422);
    // ② 「返回 422」与「真没落库」是两个命题（fail-open 回潮时这一条同样红）
    expect(await statusOf(t, id)).toBe("DRAFT");
    const err = (pub.json() as { error: { code: string; message: string } }).error;
    // ③ 是引用门拦的（force 已吃掉 lint/评测两道，冒充不了）
    expect(err.code).toBe("SKILL_REF_UNRESOLVED");
    // ④ 点名缺哪个引用 —— 「记个日志放行」与「拒绝并说清缺什么」是两个命题
    expect(err.message).toContain(DEAD_SOLVER);
  });

  it("T1' · 不加 force 的常规发布路同守（force 只是把判据隔离出来，不是唯一入口）", async () => {
    const t = await createTestApp();
    const id = await createSkill(t, "tail_dead_ref_noforce", {
      references: [{ kind: "solver", key: DEAD_SOLVER, role: "context", required: true }] satisfies Ref[],
    });
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish`, headers: H });
    expect(pub.statusCode).toBe(422);
    expect((pub.json() as { error: { code: string } }).error.code).toBe("SKILL_REF_UNRESOLVED");
    expect(await statusOf(t, id)).toBe("DRAFT");
  });

  it("T2 · 引用完整（真求解器 + 真规则）→ 200 PUBLISHED（门不是「一律拒」，是真查了注册表）", async () => {
    const t = await createTestApp();
    const id = await createSkill(t, "tail_live_ref", {
      references: [
        { kind: "solver", key: REAL_SOLVER, role: "context", required: true },
        { kind: "rule", key: REAL_RULE, role: "postcheck", required: true },
      ] satisfies Ref[],
    });

    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${id}/publish?force=true`, headers: H });

    expect(pub.statusCode).toBe(200);
    expect(await statusOf(t, id)).toBe("PUBLISHED");
  });
});

describe("WO-SKILL-REFGRAPH-TAIL · §B 抽取器（①）真的接在生产投影链路上", () => {
  /**
   * T3 · 断言的是**具体的边**，不是「函数被调了」。
   * 与 `skill-partial-a-seam.test.ts` 的分工：那条咬**出厂种子**的边，
   * 本条咬**用户经 HTTP 新建**的技能 —— 两者走的投影入口相同，但数据来源不同，
   * 只咬种子会漏掉「新建资源要等下一次全量重投影才进图」这类回归。
   */
  it("T3 · 新建技能的 references / dependsOn 边真的落进 resource_relations（逐字段断言具体边）", async () => {
    const t = await createTestApp();
    // 依赖目标必须在册：先建一个被依赖的技能（DRAFT/PUBLISHED 都会被投影）。
    await createSkill(t, "tail_dep_target");
    await createSkill(t, "tail_graph_src", {
      references: [{ kind: "solver", key: REAL_SOLVER, role: "context", required: true }] satisfies Ref[],
      dependsOn: [{ kind: "skill", key: "tail_dep_target", role: "context", required: true }] satisfies Ref[],
    });

    // 真跑生产投影：GET /b/v1/resources → ResourceRegistryService.projectTenant → 落 resource_relations。
    const res = await t.app.inject({ method: "GET", url: "/b/v1/resources", headers: H });
    expect(res.statusCode).toBe(200);
    const rels = await t.repos.resourceRelations.listByTenant(TENANT);

    // 正对照：投影确实跑了（有边落表），否则下面两条"没找到"会被误读成"抽取器没接线"。
    expect(rels.length).toBeGreaterThan(0);

    expect(
      rels.some(
        (r) => r.fromKind === "skill" && r.fromKey === "tail_graph_src" &&
          r.relType === "references" && r.toKind === "solver" && r.toKey === REAL_SOLVER,
      ),
      "references 边 tail_graph_src→solver:capacity_forecast 未落 resource_relations",
    ).toBe(true);

    expect(
      rels.some(
        (r) => r.fromKind === "skill" && r.fromKey === "tail_graph_src" &&
          r.relType === "dependsOn" && r.toKind === "skill" && r.toKey === "tail_dep_target",
      ),
      "dependsOn 边 tail_graph_src→tail_dep_target 未落 resource_relations",
    ).toBe(true);
  });
});

describe("WO-SKILL-REFGRAPH-TAIL · §C 基础边单源 + 确定性（本仓此前零断言）", () => {
  /**
   * T4 · **没复制第二份抽取逻辑**的机器判据。
   *
   * 病史：`extractRelations` 旧版是**复抄**的 workflow/agent 抽取，抄漏了
   * `evaluate_rules → rule` 与去重排序。两份并存必然漂移，而「两份都有测试且都绿」
   * 恰恰是本仓最贵的那种假绿。故本条断言的不是"两个函数各自对"，
   * 而是"组合式抽取器的**非 skill 出边** ≡ 基础抽取器的**全部输出**"，逐条 deep equal。
   */
  it("T4 · extractRelations 的基础边与 extractResourceRelations 逐条一致（同一份生产实参）", () => {
    const input = seedInput();
    const base = extractResourceRelations(input);
    const combined = extractRelations(input);

    // 金丝雀 ①：基础边非空 —— 否则 `toEqual([])` 会平凡通过，本条变成装饰品。
    expect(base.length).toBeGreaterThan(0);
    // 金丝雀 ②：**扫描面选对了** —— 旧复抄版漏掉的正是 evaluate_rules→rule 这一类边，
    //   若生产种子里根本没有这类边，本条就证明不了"漏字段会被逮住"。
    expect(
      base.some((r) => r.fromKind === "workflow" && r.relType === "invokes" && r.toKind === "rule"),
      "生产种子里没有 workflow--invokes-->rule 边 —— 本条对『旧版漏抄 evaluate_rules』这一维失去意义",
    ).toBe(true);
    // 金丝雀 ③：组合式确实**多**出了 skill 出边（否则"一致"可能只是因为两个函数返回了同一个东西）。
    expect(combined.some((r) => r.fromKind === "skill")).toBe(true);

    // 主判据：非 skill 出边逐条 deep equal（顺序也要一致 —— 两者共用同一个比较器）。
    expect(combined.filter((r) => r.fromKind !== "skill")).toEqual(base);
  });

  it("T5 · 去重与确定性序：同输入字节一致 · 重复输入被折叠 · 全局有序（R6）", () => {
    const input = seedInput();
    const once = extractRelations(input);

    // ① 同输入同输出（纯函数·R6）
    expect(extractRelations(input)).toEqual(once);

    // ② 去重：把每一份定义都喂两遍，产出必须与喂一遍**完全相同**
    const doubled = extractRelations({
      workflows: [...input.workflows, ...input.workflows],
      agents: [...input.agents, ...input.agents],
      skills: [...input.skills, ...input.skills],
      rules: [...input.rules, ...input.rules],
    } as never);
    expect(doubled).toEqual(once);
    // 金丝雀：主键集合真的无重复（上一条只证"两次一样"，证不了"里面没重复项"）
    expect(new Set(once.map(pk)).size).toBe(once.length);

    // ③ 全局有序：与按同一主键元组重排后逐条相同
    const sorted = [...once].sort((a, b) => (pk(a) < pk(b) ? -1 : pk(a) > pk(b) ? 1 : 0));
    expect(once).toEqual(sorted);
  });
});

describe("WO-SKILL-REFGRAPH-TAIL · §D dependsOn 环检测（②）的真实态", () => {
  /**
   * 本体 §8 ② 当时写的是：「`detectSkillDependencyCycle` 的环检测分支仍从未进入过
   * ⇒ 修法从『补第一条数据』变成『补到能构出环、并断言环真被拒』」。
   * 本单实测**两半都已过期**，且后一半照做**有害**：
   *
   *   · 「断言环真被拒」自 2026-07-30（提交 fef59a23 · WO-SKILL-3）起就存在于
   *     `apps/agentcore/test/skill-lint.test.ts:191`，且驱动的是真生产路由 —— 早于该条订正三周；
   *   · 「补种子成环」会与 F14 的启动期出厂审计门**直接冲突**：`auditSeededSkills`
   *     （`apps/agentcore/src/main.ts:79`）对同一批出厂技能跑**同一份判据**，
   *     成环的种子 = 出厂即 `VIOLATIONS`。下面两条就是这句话的机器证据（正反对拍）。
   *
   * ⇒ 环检测的正确覆盖方式是**构造用例驱动生产路由**（T6a），
   *    而不是把环写进出厂数据（T6c 证明那是自伤）。
   */
  it("T6a · 经真发布路由构造环 → 422 SKILL_LINT_FAILED 且报文点名 dependencyCycle（环检测分支进得去）", async () => {
    const t = await createTestApp();
    const idA = await createSkill(t, "tail_cycle_a", {
      dependsOn: [{ kind: "skill", key: "tail_cycle_b", required: true }] satisfies Ref[],
    });
    await createSkill(t, "tail_cycle_b", {
      dependsOn: [{ kind: "skill", key: "tail_cycle_a", required: true }] satisfies Ref[],
    });

    const pub = await t.app.inject({ method: "POST", url: `/b/v1/skills/${idA}/publish`, headers: H });

    expect(pub.statusCode).toBe(422);
    expect((pub.json() as { error: { code: string } }).error.code).toBe("SKILL_LINT_FAILED");
    expect(JSON.stringify(pub.json())).toContain("dependencyCycle");
    expect(await statusOf(t, idA)).toBe("DRAFT");
  });

  it("T6b · 出厂种子无环：F14 启动期审计对出厂技能零 dependencyCycle 发现（正对照）", async () => {
    const t = await createTestApp();
    for (const s of seedRegistry().skills) await t.repos.skills.insert(s);

    const report = await auditSeededSkills({ repos: t.repos, dataCore: t.dataCore, tenantId: TENANT });

    // 诚实位：门必须真跑过（NOT_RUN / 三种不可用态都不许读成"干净"）。
    expect(["CLEAN", "VIOLATIONS"]).toContain(report.status);
    expect(report.checked).toBeGreaterThan(0);
    expect(JSON.stringify(report.findings)).not.toContain("dependencyCycle");
  });

  it("T6c · 把环写进出厂技能集 → 同一道门当场判 VIOLATIONS（「补种子成环」这个处方是自伤）", async () => {
    const t = await createTestApp();
    for (const s of seedRegistry().skills) await t.repos.skills.insert(s);
    // 出厂态 = 直接以 PUBLISHED 落库、绕过发布路由（F14 病灶的形态），刻意照此复现。
    const cyclic = (key: string, dep: string): SkillDefinition =>
      ({
        ...seedRegistry().skills[0]!,
        id: `skl_seed_cycle_${key}`,
        key,
        status: "PUBLISHED",
        dependsOn: [{ kind: "skill", key: dep, role: "context", required: true }],
      }) as SkillDefinition;
    await t.repos.skills.insert(cyclic("seed_cycle_x", "seed_cycle_y"));
    await t.repos.skills.insert(cyclic("seed_cycle_y", "seed_cycle_x"));

    const report = await auditSeededSkills({ repos: t.repos, dataCore: t.dataCore, tenantId: TENANT });

    expect(report.status).toBe("VIOLATIONS");
    expect(JSON.stringify(report.findings)).toContain("dependencyCycle");
  });
});
