import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";

/**
 * WO-RESOURCE-REF-NAV（P1）：资源反向引用图 + 导航透出。
 * 真值来源：后端 apps/agentcore/src/resources.ts computeReferences（真起服务已用 curl 核对，见交付说明）；
 * 这里用 MSW mock 镜像同一 kind/id/name/via 形态（apps/frontend-shell/src/mocks/handlers.ts resourceReferences），
 * 断言前端「被引用」区所见与该真值形态逐值一致 —— 不是随手编的 happy-path 断言。
 *
 * 引用图基线（apps/frontend-shell/src/mocks/fixtures.ts）：
 *   skl-capacity（技能）  ← 被 agt-explore.skills 引用
 *   wf-cap（workflow）    ← 被 agt-explore.tools[kind=WORKFLOW] 引用
 *   mcp-demo（MCP）       ← 被 agt-explore.mcpServers 引用
 *   agt-explore（agent）  ← 被 scn-graph.defaultAgentId 引用（scene-entry）+ 被 wf-draft 步骤 s3 invoke_agent 引用（workflow）
 *   skl-draft（技能）     ← 无引用（诚实空态对照组）
 */
describe("F41 · RESOURCE-REF-NAV 资源反向引用图 + 导航透出", () => {
  it("Agent 编辑器：被引用区列出引用它的 workflow，可点跳到该 workflow", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/agents?id=agt-explore");

    await screen.findByTestId("agent-editor");
    const panel = await screen.findByTestId("agent-references");
    // 真值：agt-explore 被引用 2 处 —— scn-graph.defaultAgentId（scene-entry）+ wf-draft s3 invoke_agent（workflow）
    const item1 = await within(panel).findByTestId("agent-references-item-1");
    expect(within(panel).getByText("被引用（2）")).toBeInTheDocument();
    const item0 = within(panel).getByTestId("agent-references-item-0");
    expect(item0).toHaveTextContent("scene-entry");
    expect(item0).toHaveTextContent("via defaultAgentId");
    expect(item1).toHaveTextContent("workflow");
    expect(item1).toHaveTextContent("风险日报（草稿）");
    expect(item1).toHaveTextContent("via steps.invoke_agent");

    await user.click(within(panel).getByTestId("agent-references-link-1"));
    // 点跳落地 WorkflowsPage 且自动选中 wf-draft
    await screen.findByTestId("workflow-editor");
    expect(screen.getByText("风险日报（草稿）")).toBeInTheDocument();
  });

  it("Skill 编辑器：被 agent 引用的技能列出引用方；未被引用的技能诚实显示「未被引用」", async () => {
    loginAs("planner");
    renderApp("/admin/skills?id=skl-capacity");

    const panel = await screen.findByTestId("skill-references");
    const item0 = await within(panel).findByTestId("skill-references-item-0");
    expect(within(panel).getByText("被引用（1）")).toBeInTheDocument();
    expect(item0).toHaveTextContent("agent");
    expect(item0).toHaveTextContent("探索分析 Agent");
    expect(item0).toHaveTextContent("via skills");
  });

  it("Skill 编辑器：无引用 → 诚实空态「未被引用」（不编造引用方）", async () => {
    loginAs("planner");
    renderApp("/admin/skills?id=skl-draft");

    const panel = await screen.findByTestId("skill-references");
    expect(await within(panel).findByTestId("skill-references-empty")).toHaveTextContent("未被引用");
  });

  it("Workflow 编辑器：被引用区 + invoke_mcp_tool 步骤 mcpConfigId 用统一资源引用控件（下拉，非裸文本）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/workflows?id=wf-cap");

    await screen.findByTestId("workflow-editor");
    const panel = await screen.findByTestId("workflow-references");
    // 真值：wf-cap 被 agt-explore.tools[kind=WORKFLOW] 引用 1 次
    expect(within(panel).getByText("被引用（1）")).toBeInTheDocument();
    const item0 = within(panel).getByTestId("workflow-references-item-0");
    expect(item0).toHaveTextContent("agent");
    expect(item0).toHaveTextContent("探索分析 Agent");
    expect(item0).toHaveTextContent("via tools[kind=WORKFLOW]");

    // 切到可编辑草稿 workflow，添加 invoke_mcp_tool 步骤，验证 ReferenceSelect 落地
    await user.selectOptions(screen.getByLabelText("选择 workflow"), "wf-draft");
    await screen.findByTestId("wf-step-s3");
    await user.selectOptions(screen.getByLabelText("步骤类型"), "invoke_mcp_tool");
    await user.click(screen.getByTestId("wf-add-step"));

    const mcpSelect = await screen.findByRole("combobox", { name: /-mcpConfigId$/ });
    expect(within(mcpSelect).getByRole("option", { name: "示例 MCP 服务器" })).toBeInTheDocument();
    await user.selectOptions(mcpSelect, "mcp-demo");
    expect(mcpSelect).toHaveValue("mcp-demo");
  });

  it("McpPage：三态徽章按 status 着色（ERROR→红）+ 已配凭据徽章 + 被引用区", async () => {
    loginAs("planner");
    renderApp("/admin/mcp");

    // 列表徽章：mcp-demo=ACTIVE(green)+已配凭据；mcp-broken=ERROR(red)+无凭据徽章
    const activeBadge = await screen.findByTestId("mcp-status-mcp-demo");
    expect(activeBadge).toHaveTextContent("ACTIVE");
    expect(activeBadge.className).toContain("green");
    expect(screen.getByTestId("mcp-cred-mcp-demo")).toHaveTextContent("已配凭据");

    const errorBadge = screen.getByTestId("mcp-status-mcp-broken");
    expect(errorBadge).toHaveTextContent("ERROR");
    expect(errorBadge.className).toContain("red");
    expect(screen.queryByTestId("mcp-cred-mcp-broken")).not.toBeInTheDocument();

    // 打开 mcp-demo：被引用区显示引用它的 agent
    const user = userEvent.setup();
    await user.click(screen.getByText("示例 MCP 服务器"));
    const panel = await screen.findByTestId("mcp-references");
    expect(within(panel).getByText("被引用（1）")).toBeInTheDocument();
    expect(within(panel).getByTestId("mcp-references-item-0")).toHaveTextContent("mcpServers/tools[kind=MCP]");
  });

  it("RuleDocs 审核台：APPROVE 候选后回填 publishedRuleId，「→查看规则」点跳到规则库并可见该规则", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/rule-docs");

    const card = await screen.findByTestId("candidate-cand-2");
    await user.click(within(card).getByText("通过"));

    const link = await within(card).findByTestId("candidate-view-rule-cand-2");
    expect(link).toHaveTextContent("→查看规则");
    await user.click(link);

    // 落地 RulesPage：新发布的规则（源自 cand-2「外协红线」，key=C_cand-2）出现在表中
    const newRuleRow = await screen.findByTestId("rule-C_cand-2");
    expect(newRuleRow).toHaveTextContent("外协红线");
    expect(newRuleRow).toHaveTextContent("PUBLISHED");
  });

  it("规则库：DOCUMENT 来源行「源文档」点跳到规则文档审核台并定位到对应文档", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/rules");

    // rule-c03 origin=DOCUMENT，docId=doc-policy（fixtures.ts RULES[0]）
    const row = await screen.findByTestId("rule-C03");
    const link = within(row).getByTestId("rule-source-doc-C03");
    await user.click(link);

    // 落地 RuleDocsPage 且自动选中 doc-policy（产销协同管理制度）
    await screen.findByTestId("doc-segments");
    expect(screen.getByText(/产销协同管理制度/)).toBeInTheDocument();
  });

  it("场景入口：agent 列点跳到 /admin/agents 打开该 agent", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/scenes");

    // scn-graph：defaultAgentId=agt-explore（fixtures.ts SCENES）
    const sceneRow = await screen.findByTestId("scene-graph");
    const agentLink = within(sceneRow).getByTestId("scene-agent-link-graph");
    expect(agentLink).toHaveTextContent("探索分析 Agent");
    await user.click(agentLink);
    await screen.findByTestId("agent-editor");
    expect(screen.getByDisplayValue("探索分析 Agent")).toBeInTheDocument();
  });

  it("场景入口：发布态场景显示「在启动器打开→」直达真实视图，未开通场景标「功能未开通」而非硬链", async () => {
    loginAs("planner");
    renderApp("/admin/scenes");

    // scn-graph → view.ontology-graph 默认开通
    const sceneRow = await screen.findByTestId("scene-graph");
    const launcherLink = within(sceneRow).getByTestId("scene-launcher-link-graph");
    expect(launcherLink).toHaveTextContent("在启动器打开→");
    expect(launcherLink.getAttribute("href")).toBe("/v/graph");
  });
});
