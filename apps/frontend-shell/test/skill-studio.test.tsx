import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { db } from "@/mocks/db";

/**
 * WO-FE-SKILL-STUDIO · `/admin/skills` 的 Skill 工业级结构可见面。
 *
 * 本套断言咬的是**效果层**（界面上到底能不能看见这条引用 / 这个治理属性 / 这条死路），
 * 不是运输层（"有没有写这个组件"）。判据：把 `SkillsPage.tsx` 里对应的展示块删掉，
 * 相应用例必须变红——变异反证结果见 `docs/WO-FE-SKILL-STUDIO-delivery.md` §3。
 *
 * 数据口径：mock `SKILLS` fixture 已逐条对齐真后端种子 `apps/agentcore/src/mocks/seed.ts`
 * （改造前 fixture 只有 9 个老字段，比真契约瘦一圈——本仓吃过的「mock 与真后端口径分家」）。
 */

/** 选中左栏某个技能（列表按钮以技能名呈现）。 */
async function selectSkill(user: ReturnType<typeof userEvent.setup>, name: string) {
  const item = await screen.findByRole("button", { name: new RegExp(name) });
  await user.click(item);
  return await screen.findByTestId("skill-editor");
}

describe("WO-FE-SKILL-STUDIO · 引用与依赖可见", () => {
  it("references 非空 → 逐条列出它引用的资产 key（含类型/角色/必需）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/skills");
    const editor = await selectSkill(user, "产能分析方法论");

    // 该技能绑了两样业务资产：求解器 capacity_forecast（上下文）+ 规则 C03（后置校验）。
    const refs = within(editor).getByTestId("skill-references");
    expect(refs).toHaveTextContent("引用资产（2）");

    const rows = within(refs).getAllByTestId("skill-references-row");
    expect(rows).toHaveLength(2);
    // 逐条：资产 key 必须真的印在界面上——这是 Skill「绑了哪些业务资产」的唯一可见面。
    const keys = rows.map((r) => r.getAttribute("data-ref-key"));
    expect(keys).toEqual(["capacity_forecast", "C03"]);
    expect(refs).toHaveTextContent("capacity_forecast");
    expect(refs).toHaveTextContent("C03");
    // kind / role 译成可读中文，且与契约枚举一一对应
    expect(refs).toHaveTextContent("求解器");
    expect(refs).toHaveTextContent("规则");
    expect(refs).toHaveTextContent("上下文");
    expect(refs).toHaveTextContent("后置校验");
    expect(refs).toHaveTextContent("必需");
  });

  it("dependsOn 非空 → 单独成块列出所依赖的技能", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/skills");
    const editor = await selectSkill(user, "产能处置行动拟稿");

    const dep = within(editor).getByTestId("skill-depends-on");
    expect(dep).toHaveTextContent("依赖技能（1）");
    expect(dep).toHaveTextContent("capacity_analysis");
    expect(dep).toHaveTextContent("前置条件");
    // 引用与依赖是两块不同的东西，不许合并渲染（口径不同：references=绑资产 / dependsOn=依赖图）
    expect(within(editor).getByTestId("skill-references")).toHaveTextContent("capacity_forecast");
  });

  it("references 为空 → 不显示该块、不崩、不出现假值", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/skills");
    const editor = await selectSkill(user, "MCP 集成指南");

    // 空则整块不渲染（不是渲染一张空表，更不是「暂无数据」）
    expect(within(editor).queryByTestId("skill-references")).toBeNull();
    expect(within(editor).queryByTestId("skill-depends-on")).toBeNull();
    // 不崩：编辑器其余部分照常工作（名称在受控 input 的 value 上，不在 textContent 里）
    expect(within(editor).getByLabelText("skill 名称")).toHaveValue("MCP 集成指南");
    expect(within(editor).getByLabelText("summary")).toBeTruthy();
    expect(within(editor).getByTestId("skill-input-schema")).toBeTruthy();
    // 诚实位：整页不许出现这些占位假值（本仓有「诚实位在说谎」的事故记录）
    for (const fake of ["未知", "暂无数据", "无数据", "N/A"]) {
      expect(editor.textContent ?? "").not.toContain(fake);
    }
  });
});

describe("WO-FE-SKILL-STUDIO · 治理属性可见", () => {
  it("写回型技能：capability / sideEffect / approvalGate / provenancePolicy / 预算 全部可见", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/skills");
    const editor = await selectSkill(user, "产能处置行动拟稿");

    const gov = within(editor).getByTestId("skill-governance");
    expect(within(gov).getByTestId("skill-gov-capability")).toHaveTextContent("处置建议");
    expect(within(gov).getByTestId("skill-gov-side-effect")).toHaveTextContent("写真值");
    expect(within(gov).getByTestId("skill-gov-approval-gate")).toHaveTextContent("人工审批");
    expect(within(gov).getByTestId("skill-gov-provenance")).toHaveTextContent("必须溯源");
    expect(within(gov).getByTestId("skill-gov-budget")).toHaveTextContent("6");
    expect(within(gov).getByTestId("skill-gov-status")).toHaveTextContent("DRAFT");
    expect(within(gov).getByTestId("skill-gov-version")).toHaveTextContent("v1");

    // 写模式：判定单一出处在契约 isWriteModeSkill（会改真值 或 需审批），前端不另判一次。
    expect(within(gov).getByTestId("skill-gov-write-mode")).toBeTruthy();
    // 列表里也要看得见「哪个技能会写」
    expect(screen.getAllByTestId("skill-list-write-mode").length).toBeGreaterThan(0);
  });

  it("只读技能：不打写模式标（缺省不冒充声明值）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/skills");
    const editor = await selectSkill(user, "产能分析方法论");

    const gov = within(editor).getByTestId("skill-governance");
    expect(within(gov).getByTestId("skill-gov-side-effect")).toHaveTextContent("只读");
    expect(within(gov).queryByTestId("skill-gov-write-mode")).toBeNull();
    // maxBudgetRounds 后端没给 ⇒ 该徽标不渲染（不补默认轮数）
    expect(within(gov).queryByTestId("skill-gov-budget")).toBeNull();
  });

  it("字段缺失 → 该徽标整个不渲染，不填假值", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    // 亲手抽掉治理字段，模拟"后端没给"的真实形态（老数据 / 未升级租户）
    const s = db.skills.find((x) => x.id === "skl-capacity")!;
    delete s.capability;
    delete s.sideEffect;
    delete s.approvalGate;
    delete s.provenancePolicy;

    loginAs("planner");
    renderApp("/admin/skills");
    const editor = await selectSkill(user, "产能分析方法论");
    const gov = within(editor).getByTestId("skill-governance");

    expect(within(gov).queryByTestId("skill-gov-capability")).toBeNull();
    expect(within(gov).queryByTestId("skill-gov-side-effect")).toBeNull();
    expect(within(gov).queryByTestId("skill-gov-approval-gate")).toBeNull();
    expect(within(gov).queryByTestId("skill-gov-provenance")).toBeNull();
    // ⚠️ 关键：sideEffect 缺省在**运行时**兜底为 READ，但那是后端行为，不是"这个技能声明了 READ"。
    //    界面若替它显示「只读」，就是替后端签了一个它没签的字。
    expect(gov.textContent ?? "").not.toContain("只读");
    // 必填字段照常在（status/version/key 契约无 optional）
    expect(within(gov).getByTestId("skill-gov-status")).toHaveTextContent("PUBLISHED");
  });
});

describe("WO-FE-SKILL-STUDIO · 契约可见（结构化，不是一坨 JSON 串）", () => {
  it("inputSchema / outputSchema → 字段名/类型/必填/说明 逐行成表", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/skills");
    const editor = await selectSkill(user, "产能分析方法论");

    const input = within(editor).getByTestId("skill-input-schema");
    expect(input).toHaveTextContent("输入契约（2 字段）");
    const fields = within(input).getAllByTestId("skill-input-schema-field");
    expect(fields.map((f) => f.getAttribute("data-field-name"))).toEqual(["modelId", "weeks"]);
    // 类型与说明来自 schema 真值
    expect(input).toHaveTextContent("string");
    expect(input).toHaveTextContent("number");
    expect(input).toHaveTextContent("型号键");
    // required 列表命中的字段才标必填
    expect(within(fields[0]!).getByText("必填")).toBeTruthy();
    expect(within(fields[1]!).queryByText("必填")).toBeNull();
    // 结构化 = 不是把整坨 JSON 摊出来
    expect(within(input).queryByTestId("skill-input-schema-raw")).toBeNull();

    const output = within(editor).getByTestId("skill-output-schema");
    // WO-P50-REMAINING-3 基线红修复（本族第 3 例·前两例 xservice-smoke / base-outlook-card）：
    // `fixtures.ts` 的 skill 输出契约早已改名 `capWanP50/capWanP90`（WO-P50-RENAME），
    // 而这两条断言还写着裸 `p50`/`p90` ⇒ **自那次改名起一直红**，红在 canonical 上而非本单引入。
    expect(output).toHaveTextContent("capWanP50");
    expect(output).toHaveTextContent("capWanP90");
    expect(output).toHaveTextContent("gapPct");
  });

  it("enum 取值可见；schema 未给 → 整块不渲染", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/skills");
    const editor = await selectSkill(user, "MCP 集成指南");

    const input = within(editor).getByTestId("skill-input-schema");
    expect(input).toHaveTextContent("streamable_http");
    expect(input).toHaveTextContent("stdio");
    // 这条技能没有 outputSchema ⇒ 不渲染输出契约块（不显示空表）
    expect(within(editor).queryByTestId("skill-output-schema")).toBeNull();
  });

  it("schema 结构不可解析（无 properties）→ 原样摊 JSON，不假装成一张空结构表", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    db.skills.find((x) => x.id === "skl-capacity")!.inputSchema = { $ref: "#/components/schemas/CapacityArgs" };

    renderApp("/admin/skills");
    const editor = await selectSkill(user, "产能分析方法论");
    const input = within(editor).getByTestId("skill-input-schema");
    expect(within(input).getByTestId("skill-input-schema-raw")).toHaveTextContent("#/components/schemas/CapacityArgs");
    expect(within(input).queryAllByTestId("skill-input-schema-field")).toHaveLength(0);
  });
});

describe("WO-FE-SKILL-STUDIO · 发布门反馈可见（422 SKILL_REF_UNRESOLVED）", () => {
  it("发布被拒 → 显示具体是哪条引用死了，并标到那一行；技能未落库", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    // 让这条 DRAFT 技能引用一个 DataCore 里根本不存在的求解器 → 触发真后端同款引用存在性门。
    const target = db.skills.find((x) => x.id === "skl-action")!;
    target.references = [
      { kind: "solver", key: "capacity_forecast", role: "precondition", required: true },
      { kind: "solver", key: "ghost_solver_不存在", role: "context", required: true },
    ];
    target.dependsOn = [];

    renderApp("/admin/skills");
    const editor = await selectSkill(user, "产能处置行动拟稿");
    await user.click(within(editor).getByTestId("skill-publish"));

    // 常驻面板（不是三秒就没的 toast）：错误码 + 后端原文
    const panel = await within(editor).findByTestId("skill-publish-rejection");
    expect(within(panel).getByTestId("skill-publish-rejection-code")).toHaveTextContent("SKILL_REF_UNRESOLVED");
    const msg = within(panel).getByTestId("skill-publish-rejection-message");
    // 不是一句「发布失败」——具体是哪条引用死了必须写在界面上
    expect(msg).toHaveTextContent("ghost_solver_不存在");
    expect(msg).toHaveTextContent("未注册");
    expect(msg.textContent ?? "").not.toBe("发布失败");

    // 死路精确落到那一行：坏的那条标红，好的那条不标
    const rows = within(editor).getAllByTestId("skill-references-row");
    const ghostRow = rows.find((r) => r.getAttribute("data-ref-key") === "ghost_solver_不存在")!;
    const okRow = rows.find((r) => r.getAttribute("data-ref-key") === "capacity_forecast")!;
    expect(within(ghostRow).getByTestId("skill-ref-dead")).toBeTruthy();
    expect(within(okRow).queryByTestId("skill-ref-dead")).toBeNull();

    // 未落库：发布被拒，状态仍是 DRAFT（与真后端「拒发布 = 未落库」同口径）
    expect(db.skills.find((x) => x.id === "skl-action")!.status).toBe("DRAFT");
    expect(within(editor).getByTestId("skill-gov-status")).toHaveTextContent("DRAFT");
  });

  it("引用全部可解析 → 发布成功，不出现被拒面板", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/skills");
    const editor = await selectSkill(user, "产能处置行动拟稿");
    await user.click(within(editor).getByTestId("skill-publish"));

    await waitFor(() => expect(db.skills.find((x) => x.id === "skl-action")!.status).toBe("PUBLISHED"));
    expect(within(editor).queryByTestId("skill-publish-rejection")).toBeNull();
  });
});
