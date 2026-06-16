import { describe, expect, it } from "vitest";
import { ADMIN, createTestApp, debugHeaders, PLANNER, type TestApp } from "./helpers.js";

/** 管理平台增量 §4：五类资源统一资源模式（M4/M5）。 */

const agentPayload = (key: string, overrides: Record<string, unknown> = {}) => ({
  key,
  name: `agent ${key}`,
  description: "d",
  model: "claude-opus-4-8",
  systemPrompt: "你是产能分析助手",
  tools: [{ kind: "BUILTIN", name: "query_objects" }],
  ruleBindings: { ruleKeys: "ALL_APPLICABLE", mode: "PRE_CHECK" },
  skills: [],
  mcpServers: [],
  scopeDeclaration: { objectTypes: ["Order"], toolNames: ["query_objects"] },
  budget: { maxIterations: 4 },
  ...overrides,
});

async function createAgent(t: TestApp, key: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const res = await t.app.inject({ method: "POST", url: "/b/v1/agents", headers: debugHeaders(ADMIN), payload: agentPayload(key, overrides) });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

describe("M4 · 统一资源模式（agents）", () => {
  it("写操作要求 catalog_admin：planner 创建 → 403", async () => {
    const t = await createTestApp();
    const res = await t.app.inject({ method: "POST", url: "/b/v1/agents", headers: debugHeaders(PLANNER), payload: agentPayload("nope") });
    expect(res.statusCode).toBe(403);
  });

  it("publish 后 PUT → 409 IMMUTABLE_VERSION；new-version 派生 DRAFT 可改；详情含版本列表", async () => {
    const t = await createTestApp();
    const id = await createAgent(t, "uni_agent");
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/agents/${id}/publish`, headers: debugHeaders(ADMIN) });
    expect((pub.json() as { ok: boolean }).ok).toBe(true);
    const put = await t.app.inject({ method: "PUT", url: `/b/v1/agents/${id}`, headers: debugHeaders(ADMIN), payload: { name: "改名" } });
    expect(put.statusCode).toBe(409);
    expect((put.json() as { error: { code: string } }).error.code).toBe("IMMUTABLE_VERSION");
    // new-version：从任意版本派生新 DRAFT
    const nv = await t.app.inject({ method: "POST", url: `/b/v1/agents/${id}/new-version`, headers: debugHeaders(ADMIN) });
    expect(nv.statusCode).toBe(201);
    const draft = nv.json() as { id: string; version: number; status: string };
    expect(draft.status).toBe("DRAFT");
    expect(draft.version).toBe(2);
    const put2 = await t.app.inject({ method: "PUT", url: `/b/v1/agents/${draft.id}`, headers: debugHeaders(ADMIN), payload: { name: "v2 改名" } });
    expect(put2.statusCode).toBe(200);
    const detail = await t.app.inject({ method: "GET", url: `/b/v1/agents/${id}`, headers: debugHeaders(ADMIN) });
    const versions = (detail.json() as { versions: { version: number; status: string }[] }).versions;
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
  });

  it("发布校验：模型 ID 非法 + 工具引用不存在 → ok:false errors 指明字段", async () => {
    const t = await createTestApp();
    const id = await createAgent(t, "uni_bad", {
      model: "",
      tools: [
        { kind: "BUILTIN", name: "no_such_tool" },
        { kind: "WORKFLOW", workflowId: "wf_missing", version: "latest" },
      ],
    });
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/agents/${id}/publish`, headers: debugHeaders(ADMIN) });
    expect(pub.statusCode).toBe(200);
    const body = pub.json() as { ok: boolean; errors: { field: string; message: string }[] };
    expect(body.ok).toBe(false);
    expect(body.errors.some((e) => e.field === "model")).toBe(true);
    expect(body.errors.some((e) => e.field === "tools" && e.message.includes("no_such_tool"))).toBe(true);
    expect(body.errors.some((e) => e.field === "tools" && e.message.includes("wf_missing"))).toBe(true);
  });

  it("B→A 存在性探针：scopeDeclaration 含 DataCore 不存在的对象类型 → 死路，发布被拒", async () => {
    const t = await createTestApp();
    const id = await createAgent(t, "uni_scope_bad", { scopeDeclaration: { objectTypes: ["Order", "GhostType"], toolNames: ["query_objects"] } });
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/agents/${id}/publish`, headers: debugHeaders(ADMIN) });
    const body = pub.json() as { ok: boolean; errors: { field: string; message: string }[] };
    expect(body.ok).toBe(false);
    expect(body.errors.some((e) => e.field === "scopeDeclaration.objectTypes" && e.message.includes("GhostType") && e.message.includes("死路"))).toBe(true);
    // 合法对象类型不报死路（Order 存在）
    expect(body.errors.some((e) => e.message.includes("Order") && e.message.includes("死路"))).toBe(false);
  });

  it("references 非空时 retire 需 confirm、delete 被拒；解除引用后 delete → 204", async () => {
    const t = await createTestApp();
    const id = await createAgent(t, "uni_ref");
    await t.app.inject({ method: "POST", url: `/b/v1/agents/${id}/publish`, headers: debugHeaders(ADMIN) });
    // 场景入口引用此 agent
    const scn = await t.app.inject({
      method: "PUT",
      url: "/b/v1/scene-entries/uni-view",
      headers: debugHeaders(ADMIN),
      payload: { mode: "AGENT_FIRST", defaultAgentId: id, uiHints: { placeholder: "p", suggestedQuestions: [] } },
    });
    expect(scn.statusCode).toBe(200);
    const refs = await t.app.inject({ method: "GET", url: `/b/v1/agents/${id}/references`, headers: debugHeaders(ADMIN) });
    const refBody = refs.json() as { references: { kind: string; name: string }[]; count: number };
    expect(refBody.count).toBe(1);
    expect(refBody.references[0]).toMatchObject({ kind: "scene-entry", name: "uni-view" });
    // retire：有引用必须 confirm
    const retire1 = await t.app.inject({ method: "POST", url: `/b/v1/agents/${id}/retire`, headers: debugHeaders(ADMIN), payload: {} });
    expect(retire1.statusCode).toBe(409);
    expect((retire1.json() as { error: { code: string } }).error.code).toBe("RETIRE_REQUIRES_CONFIRM");
    const retire2 = await t.app.inject({
      method: "POST",
      url: `/b/v1/agents/${id}/retire`,
      headers: debugHeaders(ADMIN),
      payload: { confirm: true },
    });
    expect(retire2.statusCode).toBe(200);
    expect((retire2.json() as { status: string }).status).toBe("RETIRED");
    // delete：有引用一律拒绝
    const del1 = await t.app.inject({ method: "DELETE", url: `/b/v1/agents/${id}`, headers: debugHeaders(ADMIN) });
    expect(del1.statusCode).toBe(409);
    expect((del1.json() as { error: { code: string } }).error.code).toBe("REFERENCED");
    // 解除场景入口引用 → 删除成功
    const scnDel = await t.app.inject({ method: "DELETE", url: "/b/v1/scene-entries/uni-view", headers: debugHeaders(ADMIN) });
    expect(scnDel.statusCode).toBe(204);
    const del2 = await t.app.inject({ method: "DELETE", url: `/b/v1/agents/${id}`, headers: debugHeaders(ADMIN) });
    expect(del2.statusCode).toBe(204);
  });

  it("列表 ?status=&q= 过滤 + x-total-count", async () => {
    const t = await createTestApp();
    const id = await createAgent(t, "uni_list_a");
    await createAgent(t, "uni_list_b");
    await t.app.inject({ method: "POST", url: `/b/v1/agents/${id}/publish`, headers: debugHeaders(ADMIN) });
    const drafts = await t.app.inject({ method: "GET", url: "/b/v1/agents?status=DRAFT&q=uni_list", headers: debugHeaders(ADMIN) });
    const items = drafts.json() as { key: string; status: string }[];
    expect(items).toHaveLength(1);
    expect(items[0]!.key).toBe("uni_list_b");
    expect(drafts.headers["x-total-count"]).toBe("1");
  });
});

describe("M4 · workflows / skills / mcp-configs", () => {
  const wfPayload = (key: string) => ({
    key,
    name: `流程 ${key}`,
    inputs: { type: "object", properties: {} },
    steps: [
      { id: "s1", type: "query_objects", params: { objectType: "Order", filter: {} } },
      { id: "s2", type: "render_answer", params: { blocks: [] } },
    ],
  });

  it("workflow：publish → PUT 409 → new-version → 被 agent 引用时 delete 拒绝", async () => {
    const t = await createTestApp();
    const created = await t.app.inject({ method: "POST", url: "/b/v1/workflows", headers: debugHeaders(ADMIN), payload: wfPayload("uni_wf") });
    const wfId = (created.json() as { id: string }).id;
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/workflows/${wfId}/publish`, headers: debugHeaders(ADMIN) });
    expect((pub.json() as { ok: boolean }).ok).toBe(true);
    const put = await t.app.inject({ method: "PUT", url: `/b/v1/workflows/${wfId}`, headers: debugHeaders(ADMIN), payload: { name: "x" } });
    expect(put.statusCode).toBe(409);
    expect((put.json() as { error: { code: string } }).error.code).toBe("IMMUTABLE_VERSION");
    const nv = await t.app.inject({ method: "POST", url: `/b/v1/workflows/${wfId}/new-version`, headers: debugHeaders(ADMIN) });
    expect(nv.statusCode).toBe(201);
    expect((nv.json() as { version: number; status: string }).version).toBe(2);
    // agent 引用 workflow → references 非空 + delete 被拒
    await createAgent(t, "uni_wf_user", { tools: [{ kind: "WORKFLOW", workflowId: wfId, version: "latest" }] });
    const refs = await t.app.inject({ method: "GET", url: `/b/v1/workflows/${wfId}/references`, headers: debugHeaders(ADMIN) });
    expect((refs.json() as { count: number }).count).toBe(1);
    const del = await t.app.inject({ method: "DELETE", url: `/b/v1/workflows/${wfId}`, headers: debugHeaders(ADMIN) });
    expect(del.statusCode).toBe(409);
  });

  it("skill：publish → PUT 409 IMMUTABLE_VERSION → new-version 可改；被 agent 引用 → delete 拒绝", async () => {
    const t = await createTestApp();
    const created = await t.app.inject({
      method: "POST",
      url: "/b/v1/skills",
      headers: debugHeaders(ADMIN),
      payload: { key: "uni_skill", name: "技能", summary: "s", body: "# md", resources: [] },
    });
    const skillId = (created.json() as { id: string }).id;
    await t.app.inject({ method: "POST", url: `/b/v1/skills/${skillId}/publish?force=true`, headers: debugHeaders(ADMIN) });
    const put = await t.app.inject({ method: "PUT", url: `/b/v1/skills/${skillId}`, headers: debugHeaders(ADMIN), payload: { name: "x" } });
    expect(put.statusCode).toBe(409);
    expect((put.json() as { error: { code: string } }).error.code).toBe("IMMUTABLE_VERSION");
    const nv = await t.app.inject({ method: "POST", url: `/b/v1/skills/${skillId}/new-version`, headers: debugHeaders(ADMIN) });
    expect((nv.json() as { version: number }).version).toBe(2);
    await createAgent(t, "uni_skill_user", { skills: [{ skillId, version: "latest" }] });
    const del = await t.app.inject({ method: "DELETE", url: `/b/v1/skills/${skillId}`, headers: debugHeaders(ADMIN) });
    expect(del.statusCode).toBe(409);
    const detail = await t.app.inject({ method: "GET", url: `/b/v1/skills/${skillId}`, headers: debugHeaders(ADMIN) });
    expect((detail.json() as { versions: unknown[] }).versions).toHaveLength(2);
  });

  it("mcp-config：创建即 DRAFT v1；publish 连接测试通过 → PUBLISHED → PUT 409 → new-version", async () => {
    const t = await createTestApp();
    const created = await t.app.inject({
      method: "POST",
      url: "/b/v1/mcp-configs",
      headers: debugHeaders(ADMIN),
      payload: { name: "uni_mcp", transport: { type: "streamable_http", url: "http://x/mcp" }, status: "ACTIVE" },
    });
    expect(created.statusCode).toBe(201);
    const cfg = created.json() as { id: string; version: number; lifecycle: string };
    expect(cfg.lifecycle).toBe("DRAFT");
    expect(cfg.version).toBe(1);
    // publish：MockMcpClient tools/list 通过 → PUBLISHED
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/mcp-configs/${cfg.id}/publish`, headers: debugHeaders(ADMIN) });
    expect((pub.json() as { ok: boolean; lifecycle: string }).ok).toBe(true);
    const put = await t.app.inject({
      method: "PUT",
      url: `/b/v1/mcp-configs/${cfg.id}`,
      headers: debugHeaders(ADMIN),
      payload: { status: "DISABLED" },
    });
    expect(put.statusCode).toBe(409);
    expect((put.json() as { error: { code: string } }).error.code).toBe("IMMUTABLE_VERSION");
    const nv = await t.app.inject({ method: "POST", url: `/b/v1/mcp-configs/${cfg.id}/new-version`, headers: debugHeaders(ADMIN) });
    expect(nv.statusCode).toBe(201);
    expect((nv.json() as { version: number; lifecycle: string }).version).toBe(2);
    expect((nv.json() as { lifecycle: string }).lifecycle).toBe("DRAFT");
    // 详情含版本列表
    const detail = await t.app.inject({ method: "GET", url: `/b/v1/mcp-configs/${cfg.id}`, headers: debugHeaders(ADMIN) });
    expect((detail.json() as { versions: unknown[] }).versions).toHaveLength(2);
  });
});

describe("M5 · scene-entries（无版本化 + updatedAt 乐观锁 + defaultAgent 已发布校验）", () => {
  it("AGENT_FIRST 且 defaultAgent 未发布 → 发布失败信息明确", async () => {
    const t = await createTestApp();
    const id = await createAgent(t, "uni_draft_agent"); // DRAFT 未发布
    const res = await t.app.inject({
      method: "PUT",
      url: "/b/v1/scene-entries/m5-view",
      headers: debugHeaders(ADMIN),
      payload: { mode: "AGENT_FIRST", defaultAgentId: id, uiHints: { placeholder: "p", suggestedQuestions: [] } },
    });
    expect(res.statusCode).toBe(400);
    const msg = (res.json() as { error: { message: string } }).error.message;
    expect(msg).toContain("已发布");
    expect(msg).toContain("DRAFT");
    // 发布后可保存
    await t.app.inject({ method: "POST", url: `/b/v1/agents/${id}/publish`, headers: debugHeaders(ADMIN) });
    const ok = await t.app.inject({
      method: "PUT",
      url: "/b/v1/scene-entries/m5-view",
      headers: debugHeaders(ADMIN),
      payload: { mode: "AGENT_FIRST", defaultAgentId: id, uiHints: { placeholder: "p", suggestedQuestions: [] } },
    });
    expect(ok.statusCode).toBe(200);
    expect(typeof (ok.json() as { updatedAt: string }).updatedAt).toBe("string");
  });

  it("updatedAt 乐观锁：携带过期 updatedAt 的 PUT → 409 STALE_WRITE；不带则向后兼容", async () => {
    const t = await createTestApp();
    const first = await t.app.inject({
      method: "PUT",
      url: "/b/v1/scene-entries/lock-view",
      headers: debugHeaders(ADMIN),
      payload: { mode: "WORKFLOW_FIRST", uiHints: { placeholder: "a", suggestedQuestions: [] } },
    });
    const v1 = first.json() as { updatedAt: string };
    // 第二次保存（不带 updatedAt → 兼容旧客户端）
    const second = await t.app.inject({
      method: "PUT",
      url: "/b/v1/scene-entries/lock-view",
      headers: debugHeaders(ADMIN),
      payload: { mode: "WORKFLOW_ONLY", uiHints: { placeholder: "b", suggestedQuestions: [] } },
    });
    expect(second.statusCode).toBe(200);
    // 用 v1 的 updatedAt 写 → 409
    const stale = await t.app.inject({
      method: "PUT",
      url: "/b/v1/scene-entries/lock-view",
      headers: debugHeaders(ADMIN),
      payload: { mode: "WORKFLOW_FIRST", updatedAt: v1.updatedAt, uiHints: { placeholder: "c", suggestedQuestions: [] } },
    });
    expect(stale.statusCode).toBe(409);
    expect((stale.json() as { error: { code: string } }).error.code).toBe("STALE_WRITE");
    // 携带最新 updatedAt → 成功
    const fresh = (second.json() as { updatedAt: string }).updatedAt;
    const ok = await t.app.inject({
      method: "PUT",
      url: "/b/v1/scene-entries/lock-view",
      headers: debugHeaders(ADMIN),
      payload: { mode: "WORKFLOW_FIRST", updatedAt: fresh, uiHints: { placeholder: "c", suggestedQuestions: [] } },
    });
    expect(ok.statusCode).toBe(200);
    // 引用清单统一形态（入口为叶子 → 空）
    const refs = await t.app.inject({ method: "GET", url: "/b/v1/scene-entries/lock-view/references", headers: debugHeaders(ADMIN) });
    expect((refs.json() as { count: number }).count).toBe(0);
  });
});
