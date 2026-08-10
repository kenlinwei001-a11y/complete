import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { db } from "@/mocks/db";

/**
 * WO-UNBLOCK-SKILL-FE · 三个「后端注册了·前端零调用」端点接上前端后的**效果层**断言。
 *
 * 本套咬的是「用户在界面上到底能不能看见这个东西」，不是「有没有写这个组件」。
 * 判据：把 `SkillsPage.tsx` / `SolversPage.tsx` 里对应的调用删掉，相应用例必须变红。
 *
 * ⚠️ 为什么这套必须存在：`befe-seam` 门只度量「前端源码里有没有这个 URL 字面量」。
 * 光加一个 `export const compileSkill = …` 就能让门变绿，而界面上什么都没多——
 * 那正是本仓的「接了线没数据」。**门绿 ≠ 能用**，故这套测试驱动的是真按钮 → 真渲染。
 */

async function selectSkill(user: ReturnType<typeof userEvent.setup>, name: string) {
  const item = await screen.findByRole("button", { name: new RegExp(name) });
  await user.click(item);
  return await screen.findByTestId("skill-editor");
}

describe("WO-UNBLOCK-SKILL-FE · Skill 编译报告可见（POST /b/v1/skills/:id/compile）", () => {
  it("点「编译」→ 七段管线状态、诊断、推理图 全部落在界面上", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/skills");
    const editor = await selectSkill(user, "产能分析方法论");

    // 编译前不渲染报告（不许先画一个空报告占位）
    expect(within(editor).queryByTestId("skill-compile-report")).toBeNull();

    await user.click(within(editor).getByTestId("skill-compile"));
    const report = await within(editor).findByTestId("skill-compile-report");

    // ① 五段全在，且 optimize / package 的 NOT_IMPLEMENTED 必须显式可见 ——
    //    这是后端的诚实位，界面滤掉它就等于替后端宣布"七段管线跑完了"。
    const rows = within(report).getAllByTestId("skill-compile-stage-row");
    expect(rows.map((r) => r.getAttribute("data-stage"))).toEqual(["parse", "validate", "graph", "optimize", "package"]);
    const statusOf = (stage: string) =>
      rows.find((r) => r.getAttribute("data-stage") === stage)?.getAttribute("data-stage-status");
    expect(statusOf("parse")).toBe("OK");
    expect(statusOf("graph")).toBe("OK");
    expect(statusOf("optimize")).toBe("NOT_IMPLEMENTED");
    expect(statusOf("package")).toBe("NOT_IMPLEMENTED");
    // 枚举值原样印在界面上（不译成"未完成"这类模糊话）
    expect(report).toHaveTextContent("NOT_IMPLEMENTED");
    expect(within(report).getByTestId("skill-compile-not-implemented-note")).toHaveTextContent("不含");

    // ② 推理图：这条技能跑起来会依次碰哪些平台能力（节点由契约纯函数派生）
    const graph = within(report).getByTestId("skill-compile-graph");
    const nodeKeys = within(graph).getAllByTestId("skill-compile-graph-node").map((n) => n.getAttribute("data-node-id"));
    expect(nodeKeys).toContain("entry");
    // 该技能引用了求解器 capacity_forecast + 规则 C03 ⇒ 图里必须真的长出这两个节点
    expect(nodeKeys).toContain("ref:references:solver:capacity_forecast");
    expect(nodeKeys).toContain("ref:references:rule:C03");

    // ③ 派生工具：由引用 kind 推出，标明推它的依据（derived ≠ 作者声明）
    const tools = within(report).getByTestId("skill-compile-tools");
    expect(tools).toHaveTextContent("invoke_solver");
    expect(tools).toHaveTextContent("evaluate_rules");
    expect(tools).toHaveTextContent("solver:capacity_forecast");
  });

  it("ok 为真时**照样**列出 warning / info 诊断（ok 只等于「无 error 级」，不等于「没问题」）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/skills");
    const editor = await selectSkill(user, "产能分析方法论");
    await user.click(within(editor).getByTestId("skill-compile"));
    const report = await within(editor).findByTestId("skill-compile-report");

    expect(report.getAttribute("data-compile-ok")).toBe("true");
    // ——关键：ok=true 时诊断表仍在。若实现写成 `{!ok && <诊断表/>}`，这条当场红。
    const diagRows = within(report).getAllByTestId("skill-compile-diagnostic-row");
    const codes = diagRows.map((r) => r.getAttribute("data-diag-code"));
    expect(codes).toContain("RG-NOT-WIRED"); // info：跨系统引用可达性今天不校验
    expect(codes).toContain("GR-STEPS-NO-DATA"); // info：execution.steps 契约上尚不存在
    expect(codes).toContain("IO-OUTPUT-CONSUMER"); // warning：outputSchema 无人消费
    // 严重度分级真的落到 DOM 上（不是全都画成一个色）
    const sev = new Set(diagRows.map((r) => r.getAttribute("data-diag-severity")));
    expect(sev.has("info")).toBe(true);
    expect(sev.has("warning")).toBe(true);

    // R13：证据原样亮出 —— 没有它，诊断退回成"有问题"这种没法照着修的话
    const ev = within(report).getAllByTestId("skill-compile-diagnostic-evidence");
    expect(ev.length).toBeGreaterThan(0);
    expect(report).toHaveTextContent("solver:capacity_forecast");
  });

  it("PUBLISHED 技能也能编译（只读干跑），且编译**不改**技能状态", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/skills");
    // 「产能分析方法论」在 fixture 里是 PUBLISHED —— 发布态技能恰恰最该复查（它已在被 agent 加载）
    const before = db.skills.find((x) => x.id === "skl-capacity")!;
    expect(before.status).toBe("PUBLISHED");

    const editor = await selectSkill(user, "产能分析方法论");
    // PUBLISHED ⇒ 保存/发布按钮不渲染，但编译按钮必须在
    expect(within(editor).queryByTestId("skill-publish")).toBeNull();
    await user.click(within(editor).getByTestId("skill-compile"));
    await within(editor).findByTestId("skill-compile-report");

    // 只读：不落库、不改状态（与真后端 server.ts:1430 同口径）
    expect(db.skills.find((x) => x.id === "skl-capacity")!.status).toBe("PUBLISHED");
  });

  it("execution.steps 恒空 → 说成「接了线没数据」，不说成「这个技能没有步骤」", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/skills");
    const editor = await selectSkill(user, "MCP 集成指南");
    await user.click(within(editor).getByTestId("skill-compile"));
    const report = await within(editor).findByTestId("skill-compile-report");

    const note = within(report).getByTestId("skill-compile-execution-note");
    // 后端原文把三种定性**分开说**：是「接了线没数据」，不是「没有步骤」，更不是「已实现」。
    // 断言咬的是"这句否定真的印在界面上"——原样透传，不许被前端摘要成一句「暂无步骤」。
    expect(note).toHaveTextContent("接了线没数据");
    expect(note).toHaveTextContent("不是「这个技能没有步骤」");
    expect(note.textContent ?? "").not.toContain("暂无");
  });
});

describe("WO-UNBLOCK-SKILL-FE · 出厂技能门审计诚实位（GET /b/v1/ops/skill-seed-gate）", () => {
  it("四态各有各的措辞：CLEAN 才是「通过」，且点明已审几个", async () => {
    loginAs("planner");
    renderApp("/admin/skills");
    const strip = await screen.findByTestId("skill-seed-gate");

    expect(strip.getAttribute("data-seed-gate-status")).toBe("CLEAN");
    expect(within(strip).getByTestId("skill-seed-gate-status")).toHaveTextContent("通过");
    // 计数点明所数何物（"已审 N 个技能"，不是裸数）
    expect(within(strip).getByTestId("skill-seed-gate-checked")).toHaveTextContent("已审");
    // 出厂技能旁路落库这件事必须说出来 —— 「门装上了」不等于「库里的东西都过了门」
    expect(strip).toHaveTextContent("出厂技能");
  });
});

describe("WO-UNBLOCK-SKILL-FE · 求解器决策问题类目（GET /a/v1/solvers/categories）", () => {
  it("按「我在做什么决策」找求解器：类目 + 决策问句 + 成员 key 全在界面上", async () => {
    loginAs("planner");
    renderApp("/admin/solvers");
    const reg = await screen.findByTestId("solver-category-registry");

    // 决策问句是本端点独有、registry 给不了的东西 —— 它就是「按类找求解器」这个动作的判据
    const questions = within(reg).getAllByTestId("solver-category-question");
    expect(questions.length).toBeGreaterThan(0);
    expect(reg).toHaveTextContent("产能与瓶颈");
    expect(reg).toHaveTextContent("产能够不够");
    // 成员 key 真的列出来（不是只画一个类目名）
    expect(within(reg).getByTestId("solver-category-key-capacity_forecast")).toBeTruthy();
    expect(within(reg).getByTestId("solver-category-key-order_fullchain")).toBeTruthy();

    // 空类目不铺：mock 论域只覆盖 3 类，10 类里其余 7 类 count=0 ⇒ 不渲染
    const rows = within(reg).getAllByTestId("solver-category-row");
    expect(rows.length).toBe(3);
    expect(rows.map((r) => r.getAttribute("data-category"))).toEqual(
      ["capacity_bottleneck", "order_commitment", "combinatorial_allocation"].sort((a, b) =>
        // 类目顺序 = 契约 SOLVER_CATEGORIES 声明序，不是字典序
        ["capacity_bottleneck", "planning_scheduling", "material_inventory", "risk_propagation", "root_cause_attribution", "countermeasure_closure", "order_commitment", "performance_finance", "combinatorial_allocation", "whatif_exploration"].indexOf(a) -
        ["capacity_bottleneck", "planning_scheduling", "material_inventory", "risk_propagation", "root_cause_attribution", "countermeasure_closure", "order_commitment", "performance_finance", "combinatorial_allocation", "whatif_exploration"].indexOf(b),
      ),
    );
  });

  it("category 与 domain 是两个维，各自成块——不许合并", async () => {
    loginAs("planner");
    renderApp("/admin/solvers");
    // 决策问题类目块（10 类词表） 与 domain 筛选块（4 值词表）同页并存
    expect(await screen.findByTestId("solver-category-registry")).toBeTruthy();
    expect(screen.getByTestId("solver-domain-filter")).toBeTruthy();
  });

  it("点类目成员 key → 下方目录检索框被填上，类目维与检索维真接上了", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/solvers");
    const reg = await screen.findByTestId("solver-category-registry");

    await user.click(within(reg).getByTestId("solver-category-key-bottleneck_matrix"));
    expect(screen.getByTestId("solver-search")).toHaveValue("bottleneck_matrix");
    // 效果层：检索真的收窄了（不是只把字填进去）
    expect(screen.getByTestId("solver-count-meta")).toHaveTextContent("命中 1 个");
  });
});
