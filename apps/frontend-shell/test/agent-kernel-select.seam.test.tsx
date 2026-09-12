import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { db } from "@/mocks/db";
import { server } from "./setup";
import { loginAs, renderApp } from "./utils";

/**
 * WO-AGENT-KERNEL-SELECT · Agent 编辑器「运行内核」选择器接缝。
 *
 * **接缝在哪**：契约 `AgentDefinition.kernel`（additive 可选）× 编辑器表单（初值/回显）
 * × 保存通道（`PUT /b/v1/agents/:id` body 必须带上 kernel——**静默丢字段同族病**第五例
 * 防线：本单前面已有 MCP-FORWARD/TOOLSETTLE 四例，全是「映射层少抄一个字段」）。
 *
 * **语义钉（与引擎层2 同源）**：两态选择器——「原生内核」/「DSH（外部运行时）」。
 * 缺省（字段缺失）≡ 原生：可证（内核标识上线前外部运行时开关恒关闭——休眠门机器守 +
 * 出货 compose 显式 0，见 zh.ts kernelNativeTip 同一可证链），故缺省 agent 回显「原生内核」，
 * 不画第三态「未设置」充数。
 *
 * **变异反证内建**：③ 把后端数据改掉（kernel=EXTERNAL）⇒ 选择器必须跟着变；
 * 纹丝不动 = 控件写死，那才是假绿。
 */
describe("WO-AGENT-KERNEL-SELECT · 编辑器运行内核选择器", () => {
  async function openDraftEditor() {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/agents");
    await user.click(await screen.findByText("周报生成 Agent（草稿）"));
    await screen.findByTestId("agent-editor");
    return user;
  }

  it("① 缺省 agent（无 kernel 字段）⇒ 选择器回显「原生内核」（缺失 ≡ 原生可证，不画第三态）", async () => {
    expect(db.agents.find((a) => a.id === "agt-draft")!.kernel, "夹具被改动：agt-draft 应无 kernel 字段").toBeUndefined();
    await openDraftEditor();
    const select = await screen.findByLabelText("运行内核");
    expect(select).toHaveValue("NATIVE");
  });

  it("② 选 DSH → 保存 ⇒ PUT body 带 kernel=\"EXTERNAL\" 且落 mock 库（不静默丢字段）", async () => {
    const user = await openDraftEditor();
    const captured: Record<string, unknown>[] = [];
    server.use(
      http.put("*/b/v1/agents/:id", async ({ params, request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        captured.push(body);
        const agent = db.agents.find((a) => a.id === params.id);
        if (!agent) return HttpResponse.json({ error: "NOT_FOUND" }, { status: 404 });
        Object.assign(agent, body);
        return HttpResponse.json(agent);
      }),
    );

    const select = await screen.findByLabelText("运行内核");
    await user.selectOptions(select, "EXTERNAL");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await screen.findByText("已保存");
    expect(captured.length, "保存没有发出 PUT ⇒ 通道是死的").toBe(1);
    expect(captured[0]!.kernel, "PUT body 丢 kernel 字段 = 静默丢字段同族病").toBe("EXTERNAL");
    expect(db.agents.find((a) => a.id === "agt-draft")!.kernel).toBe("EXTERNAL");
  });

  it("③ 变异反证：后端 agent 带 kernel=\"EXTERNAL\" ⇒ 选择器回显 DSH（控件不写死）", async () => {
    db.agents.find((a) => a.id === "agt-draft")!.kernel = "EXTERNAL";
    await openDraftEditor();
    const select = await screen.findByLabelText("运行内核");
    expect(select).toHaveValue("EXTERNAL");
  });
});

/**
 * WO-AGENT-KERNEL-FORK-UI · 既有（PUBLISHED）Agent 的内核选择正路。
 *
 * **病灶**：编辑器 `editable = agent.status === "DRAFT"` 锁整表单（不可变发布语义，正确），
 * 但后端配套的 `POST /b/v1/agents/:id/new-version`（派生 DRAFT v+1）**前端没有任何入口调用它**
 * ⇒ PUBLISHED agent 在 UI 上是死胡同：不能改，也不告诉你怎么变成能改。
 * 仓主原话：「既有的无法选择，新建的可以选择」。
 *
 * **正路**（后端语义自带）：派生 DRAFT → 改（内核/任何字段）→ 发布。
 * 本单只补这条路的前端入口，**不动**不可变发布语义（PUBLISHED 表单保持锁定）。
 */
describe("WO-AGENT-KERNEL-FORK-UI · PUBLISHED agent 派生正路", () => {
  async function openPublishedEditor() {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/agents");
    await user.click(await screen.findByText("探索分析 Agent"));
    await screen.findByTestId("agent-editor");
    return user;
  }

  it("① PUBLISHED ⇒ 表单仍锁（不可变语义不动）+ 画出「派生新版本」入口（死胡同变正路）", async () => {
    await openPublishedEditor();
    const select = await screen.findByLabelText("运行内核");
    expect(select, "PUBLISHED 内核选择器必须保持锁定——派生不是绕过不可变语义的后门").toBeDisabled();
    expect(screen.getByTestId("agent-new-version"), "PUBLISHED agent 必须有派生入口，否则 UI 是死胡同").toBeEnabled();
  });

  it("② 派生 ⇒ 新 DRAFT v+1 落库且编辑器切换过去 ⇒ 内核选 DSH 保存进派生品（源版本不动）", async () => {
    const user = await openPublishedEditor();
    await user.click(screen.getByTestId("agent-new-version"));

    // 编辑器切到派生 DRAFT：内核选择器从锁定变可选（这是本单的标的）
    const select = await screen.findByLabelText("运行内核");
    await waitFor(() => expect(select).toBeEnabled(), { timeout: 15000 });

    const forked = db.agents.find((a) => a.key === "explore_agent" && a.status === "DRAFT");
    expect(forked, "派生后库里必须多一份 DRAFT（new-version 真落库，不是假动作）").toBeDefined();
    expect(forked!.version, "派生品版本 = 该 key 最新版 + 1（agt-explore 是 v2 ⇒ v3）").toBe(3);

    // 正路走通：选 DSH → 保存 → 内核落进派生品
    await user.selectOptions(select, "EXTERNAL");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("已保存");
    expect(db.agents.find((a) => a.id === forked!.id)!.kernel, "内核改动必须落进派生 DRAFT").toBe("EXTERNAL");
    expect(
      db.agents.find((a) => a.id === "agt-explore")!.kernel,
      "源 PUBLISHED 版本一个字节都不能被顺手改写（不可变发布语义）",
    ).toBeUndefined();
    expect(db.agents.find((a) => a.id === "agt-explore")!.status).toBe("PUBLISHED");
  });
});
