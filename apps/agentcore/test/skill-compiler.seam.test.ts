import { describe, expect, it } from "vitest";
import {
  SkillCompileResultSchema,
  skillDeclaredRefKeys,
  skillGraphRefKeys,
  type SkillCompileResult,
  type SkillDefinition,
} from "@platform/contracts";
import { createTestApp, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { seedRegistry } from "../src/mocks/seed.js";

/**
 * WO-SKILL-COMPILER-S1 · **SEAM 接缝门**（审核方复验头号判据）。
 *
 * 接的是哪条缝：**契约层纯函数（Parser + 图派生·contracts）× 引擎层 Validator（lintSkill + 工具注册表·agentcore）
 * × HTTP 路由（鉴权/租户/错误信封·server.ts）× 真实种子数据（seed.ts）** —— 任一半漏即红。
 * 故本文件**不测函数、只从 HTTP 打进去**：`compileSkill` 一次都不直接调用。
 * （「只有 test 引用 = 已排练不是已实现」的反面：这里咬的是链路，不是函数。）
 *
 * 数据依据（实测，非推测）：`apps/agentcore/src/mocks/seed.ts` 的出厂 skill
 *   - `references` 7 条种子、其中 6 条非空 → **可用作断言依据**
 *   - `dependsOn`  6 条边 / 4 个技能持有（2026-08-18 WO-SKILL-DEPENDSON-COVER 自 1 条扩覆，4/7 = 多数）
 *     → 环检测与引用解析分支有真数据驱动；环的**拒绝**断言在 `skill-dependson-cover.seam.test.ts`
 *     （环不许种进生产 seed——那会炸启动审计与正常发布流，故环只在测试里构造）。
 */

const H = { "x-debug-user": ADMIN, "content-type": "application/json" };

/** 测试 app 只播种 package/intents/plans，不播种注册表 —— skill 要自己种（同 dril-registry.test.ts 的做法）。 */
async function seedSkills(t: TestApp): Promise<SkillDefinition[]> {
  const { skills } = seedRegistry();
  for (const s of skills) await t.repos.skills.insert(s);
  return skills;
}

async function compile(t: TestApp, id: string, headers = H): Promise<{ status: number; body: SkillCompileResult }> {
  const res = await t.app.inject({ method: "POST", url: `/b/v1/skills/${id}/compile`, headers, payload: {} });
  return { status: res.statusCode, body: res.json() as SkillCompileResult };
}

describe("WO-SKILL-COMPILER-S1 · SEAM：真实种子技能 → HTTP compile → 推理图与声明的引用对账", () => {
  it("金丝雀：种子里 references 确有数据（否则下面的对账断言只是在断言空集）", async () => {
    const { skills } = seedRegistry();
    expect(skills.length).toBeGreaterThan(0);
    const withRefs = skills.filter((s) => (s.references ?? []).length > 0);
    // 实测口径：7 个出厂技能、6 个 references 非空。数量变了要么种子变了、要么金丝雀坏了 —— 都得先查再改断言。
    expect(skills.length).toBe(7);
    expect(withRefs.length).toBe(6);
    // `dependsOn`：本单写这条断言时全仓 **0 条**（「接了线没数据」，见 CLAUDE.md 铁律 0.5）。
    // 2026-08-09 收编 WO-SKILL-PARTIAL-A 后变成 **1 条**（`mocks/seed.ts`
    // capacity_action_draft --dependsOn--> capacity_analysis）——本金丝雀当场报红，审核方逐层追到
    // 那个提交（`0b49b75a`）确认是**有意补的种子**、不是回归，才改的这个数。
    // 2026-08-18 WO-SKILL-DEPENDSON-COVER 扩覆：**4 个**技能持有 dependsOn（共 6 条边，全部指向
    // PUBLISHED 目标、图无环；4/7 = 多数技能有边）——同样是有意补数据（本体 §8 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` ②），
    // 逐条业务语义见 seed.ts 各边的注释。
    // ⚠️ 下次这个数再变，同样先查提交再改断言，不许直接改数把红压掉。
    expect(skills.filter((s) => (s.dependsOn ?? []).length > 0).length).toBe(4);
  });

  it("① 每个出厂技能：graph 的节点集合 === 它 references[] 声明的资源（逐个技能对账，一条都不许漏或多）", async () => {
    const t = await createTestApp();
    const skills = await seedSkills(t);

    let checkedNonEmpty = 0;
    for (const s of skills) {
      const { status, body } = await compile(t, s.id);
      expect(status, `技能 ${s.key} 编译失败：${JSON.stringify(body)}`).toBe(200);
      expect(SkillCompileResultSchema.safeParse(body).success, `技能 ${s.key} 响应不合契约`).toBe(true);

      const declared = skillDeclaredRefKeys(s);
      const inGraph = skillGraphRefKeys(body.graph);
      // 头号断言：图节点集合与声明的引用**逐条一致**
      expect(inGraph, `技能 ${s.key} 的图节点集合与 references[] 不一致`).toEqual(declared);
      // 且真的长出了节点，不是两边同为空的假一致
      if (declared.length > 0) {
        checkedNonEmpty++;
        expect(body.graph.nodes.filter((n) => n.ref !== null).length).toBe(declared.length);
      }
      // 引擎侧不得自报「图与引用不一致」
      expect(body.diagnostics.filter((d) => d.code === "GR-REACH")).toEqual([]);
    }
    expect(checkedNonEmpty, "6 个非空 references 的技能都要真的被对账过").toBe(6);
  });

  it("② 具体到一条真实技能（capacity_threshold）：solver + rule 各自长出对口节点类型与工具", async () => {
    const t = await createTestApp();
    const skills = await seedSkills(t);
    const target = skills.find((s) => (s.references ?? []).some((r) => r.kind === "solver") && (s.references ?? []).some((r) => r.kind === "rule"))!;
    expect(target, "种子里应有一个同时引用 solver 与 rule 的技能").toBeDefined();

    const { body } = await compile(t, target.id);
    expect(skillGraphRefKeys(body.graph)).toEqual(skillDeclaredRefKeys(target));

    const solverRef = (target.references ?? []).find((r) => r.kind === "solver")!;
    const ruleRef = (target.references ?? []).find((r) => r.kind === "rule")!;
    const solverNode = body.graph.nodes.find((n) => n.ref?.kind === "solver" && n.ref.key === solverRef.key)!;
    const ruleNode = body.graph.nodes.find((n) => n.ref?.kind === "rule" && n.ref.key === ruleRef.key)!;
    // 节点类型复用既有 PlanStep 词表，不是新造的字符串
    expect(solverNode.type).toBe("invoke_solver");
    expect(ruleNode.type).toBe("evaluate_rules");
    // AST 的 solver 单数位指向真实 solver key
    expect(body.ast.solver?.key).toBe(solverRef.key);
    // 派生工具集经过注册表反查，无 RG-TOOL 报错（工具名漂移即红）
    expect(body.ast.tools.map((x) => x.name).sort()).toEqual(["evaluate_rules", "invoke_solver"]);
    expect(body.diagnostics.filter((d) => d.code === "RG-TOOL")).toEqual([]);
  });

  it("③ 变异反证锚点 · Validator 真的接了 lintSkill：坏 summary 的技能必出 GV-LINT 错误诊断", async () => {
    const t = await createTestApp();
    // 用 HTTP 建一个 lint 必挂的技能（summary 缺「当…时使用」触发句与「不适用：」排除句）
    const create = await t.app.inject({
      method: "POST",
      url: "/b/v1/skills",
      headers: H,
      payload: {
        key: "compiler_seam_bad_lint",
        name: "变异反证锚点",
        summary: "这个技能很强大很全面",
        body: "没有七段骨架",
        resources: [],
        references: [{ kind: "solver", key: "capacity_forecast", role: "context", required: true }],
      },
    });
    expect(create.statusCode).toBe(201);
    const id = (create.json() as { id: string }).id;

    const { status, body } = await compile(t, id);
    expect(status).toBe(200);

    // —— 这三条就是变异反证要打红的断言：掐掉 validateSkillAst 里的 lintSkill 调用 → 三条全红 ——
    const lintDiags = body.diagnostics.filter((d) => d.code === "GV-LINT");
    expect(lintDiags.length).toBeGreaterThan(0);
    expect(lintDiags.map((d) => d.evidence).join(" ")).toContain("lintSkill rule=summary.triggerTemplate");
    expect(body.ok).toBe(false);
    expect(body.stages.find((s) => s.stage === "validate")?.status).toBe("FAILED");

    // 但图仍然照常派生（Validator 挂了不代表 Parser/图段没跑）——诊断与产物分开报
    expect(skillGraphRefKeys(body.graph)).toEqual(["solver:capacity_forecast"]);
  });

  it("④ R6 确定性：同一技能编译两次，ast 与 graph 逐字节一致", async () => {
    const t = await createTestApp();
    const skills = await seedSkills(t);
    const target = skills.find((s) => (s.references ?? []).length > 0)!;

    const first = await compile(t, target.id);
    const second = await compile(t, target.id);
    expect(JSON.stringify(first.body.ast)).toBe(JSON.stringify(second.body.ast));
    expect(JSON.stringify(first.body.graph)).toBe(JSON.stringify(second.body.graph));
    expect(JSON.stringify(first.body.diagnostics)).toBe(JSON.stringify(second.body.diagnostics));
    // 逐字节一致必须是「非空产物一致」，不是「两次都返回空」
    expect(first.body.graph.nodes.length).toBeGreaterThan(3);
  });

  it("⑤ 诚实边界：未实现的段显式标 NOT_IMPLEMENTED 并写明归谁，不返回空对象", async () => {
    const t = await createTestApp();
    const skills = await seedSkills(t);
    const { body } = await compile(t, skills[0]!.id);

    const optimize = body.stages.find((s) => s.stage === "optimize")!;
    const pkg = body.stages.find((s) => s.stage === "package")!;
    expect(optimize.status).toBe("NOT_IMPLEMENTED");
    expect(pkg.status).toBe("NOT_IMPLEMENTED");
    expect(pkg.note).toContain("WO-SKILL-PACKAGE");
    // AST 里的运行时包字段位也必须自陈未实现，而不是一个看着能用的空对象
    expect(body.ast.runtimePackage.status).toBe("NOT_IMPLEMENTED");
    expect(body.ast).not.toHaveProperty("digest");
    // 跨系统引用探针今天没接 skill 发布路 —— 这条也必须说出来，不静默略过
    expect(body.diagnostics.some((d) => d.code === "RG-NOT-WIRED")).toBe(true);
  });

  /**
   * 审核方 2026-08-09 补裁：元素形状以 `validatePlanSteps` 实际接受的集合为准
   * （`ExtendedPlanStep = PlanStep | ExtraToolStep`），不是 `PlanStep` 闭合联合。
   * 从 HTTP 打进去咬同一条：谁把元素钉回 `PlanStep`，本例当场红。
   */
  it("⑨ 元素形状以 validatePlanSteps 接受的集合为准：带 query_timeseries_agg 的技能必须编译成功", async () => {
    const t = await createTestApp();
    // 直接落库：POST /b/v1/skills 的 zod 会剥掉契约上还不存在的 execution 字段，
    // 故用仓储插入模拟「迁移线已把该字段落地」的那一天。
    const withExtraTool = {
      id: "skl_extra_tool_steps",
      tenantId: TENANT,
      key: "extra_tool_steps",
      version: 1,
      name: "含 ExtraToolStep 的技能",
      summary: "当需要验证步骤集合单一来源时使用。不适用：生产。",
      body: "# body",
      resources: [],
      status: "DRAFT",
      references: [{ kind: "solver", key: "capacity_forecast", role: "context", required: true }],
      execution: {
        steps: [
          { id: "s1", type: "query_timeseries_agg", params: { metric: "oee", grain: "day" } },
          { id: "s2", type: "render_answer", params: { blocks: [] } },
        ],
      },
    } as unknown as SkillDefinition;
    await t.repos.skills.insert(withExtraTool);

    const { status, body } = await compile(t, "skl_extra_tool_steps");
    expect(status).toBe(200);
    // 头号断言：整个编译响应必须过契约（元素被钉回 PlanStep 时，ast.execution.steps 校验失败 → 这里红）
    expect(
      SkillCompileResultSchema.safeParse(body).success,
      "带 query_timeseries_agg 的技能编译产物不合契约 —— 元素形状被错钉成 PlanStep 了",
    ).toBe(true);
    expect(body.ast.execution.declared).toBe(true);
    expect(body.ast.execution.stepTypes).toEqual(["query_timeseries_agg", "render_answer"]);
    // 有数据时报的是 GR-STEPS（未跑 validatePlanSteps），不是 GR-STEPS-NO-DATA —— 两态不许混
    expect(body.diagnostics.some((d) => d.code === "GR-STEPS")).toBe(true);
    expect(body.diagnostics.some((d) => d.code === "GR-STEPS-NO-DATA")).toBe(false);
  });

  it("⑧ 对名裁决：AST 只按 execution.steps 读，且今天恒「接了线没数据」并在诊断里说出来", async () => {
    const t = await createTestApp();
    const skills = await seedSkills(t);
    const { body } = await compile(t, skills[0]!.id);

    expect(body.ast.execution.declared).toBe(false);
    expect(body.ast.execution.steps).toEqual([]);
    const d = body.diagnostics.find((x) => x.code === "GR-STEPS-NO-DATA")!;
    expect(d, "execution.steps 恒空这件事必须出现在诊断里，不许静默").toBeDefined();
    expect(d.path).toBe("/execution/steps");
    expect(d.message).toContain("接了线没数据");
    // 别名不得被静默认领：真种子里既没有 execution 也没有 plan/steps 顶层字段
    expect(body.ast).not.toHaveProperty("plan");
  });

  it("⑥ tenant_id everywhere：跨租户编译一律 404 且错误信封统一（不泄漏存在性）", async () => {
    const t = await createTestApp();
    const skills = await seedSkills(t);
    const other = { "x-debug-user": "other-tenant:user-x:catalog_admin", "content-type": "application/json" };

    const res = await t.app.inject({
      method: "POST",
      url: `/b/v1/skills/${skills[0]!.id}/compile`,
      headers: other,
      payload: {},
    });
    expect(res.statusCode).toBe(404);
    const err = res.json() as { error: { code: string; message: string; requestId: string } };
    expect(err.error.code).toBe("SKILL_NOT_FOUND");
    expect(typeof err.error.requestId).toBe("string");
    // 本租户同一个 id 是 200 —— 证明 404 来自租户隔离，不是路由不存在
    expect((await compile(t, skills[0]!.id)).status).toBe(200);
    expect(TENANT).not.toBe("other-tenant");
  });

  it("⑦ 不存在的技能 404，且编译端点不改任何状态（只读）", async () => {
    const t = await createTestApp();
    const skills = await seedSkills(t);
    const before = await t.repos.skills.get(skills[0]!.id);

    const missing = await t.app.inject({ method: "POST", url: "/b/v1/skills/skl_nope/compile", headers: H, payload: {} });
    expect(missing.statusCode).toBe(404);

    await compile(t, skills[0]!.id);
    expect(await t.repos.skills.get(skills[0]!.id)).toEqual(before);
  });
});
