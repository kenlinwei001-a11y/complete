import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
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
