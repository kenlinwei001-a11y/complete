import { describe, expect, it } from "vitest";
import type { WorkflowDefinition } from "@platform/contracts";
import { createTestApp, TENANT } from "./helpers.js";

/**
 * WO-L1B-3 · durable DAG 运行态读端点 + 手动续跑 + entitlement 门 真起服务齿检（铁律 0.4·真 inject）。
 * 真 buildServer + 真 memory 仓储 + 真 DAG 执行器（QOS_WORKFLOW_DAG=1）·真 durable checkpoint 落库。
 * 覆盖：feature 门 404（暗发关=不存在·C3）· R2 跨租户 404 · GET run 进度 · POST 手动续跑（resumedCount++）。
 */

const ADMIN = `${TENANT}:user-admin:admin|catalog_admin|planner`;
const OTHER = `other:bob:admin`;
const dbg = (u: string) => ({ "x-debug-user": encodeURIComponent(u) });

function seedWorkflow(): WorkflowDefinition {
  return {
    id: "wf_dag_test",
    tenantId: TENANT,
    key: "dag_test",
    version: 1,
    name: "DAG 续跑测试流程",
    kind: "ORCHESTRATION",
    steps: [
      { id: "q", type: "query_objects", params: { objectType: "Model", filter: {} } },
      { id: "render", type: "render_answer", params: { blocks: [{ type: "text", markdown: "完成。" }] } },
    ],
    status: "PUBLISHED",
  } as unknown as WorkflowDefinition;
}

describe("WO-L1B-3 endpoints · durable DAG run 读/续跑 + entitlement 门（真 inject）", () => {
  it("QOS_WORKFLOW_DAG=1 真跑 workflow → durable run 落库 → GET/resume/404 门/R2 全绿", async () => {
    const t = await createTestApp({ env: { QOS_WORKFLOW_DAG: "1" } });
    await t.repos.workflows.insert(seedWorkflow());

    // ① 真跑 workflow（经 runWorkflowSteps → DAG 执行器 → durable checkpoint 落 workflow_dag_runs）。
    const runRes = await t.app.inject({
      method: "POST",
      url: "/b/v1/workflows/wf_dag_test/run",
      headers: { ...dbg(ADMIN), "content-type": "application/json" },
      payload: { inputs: {} },
    });
    expect(runRes.statusCode).toBe(200);
    const runId = (runRes.json() as { runId: string }).runId;
    expect(runId).toMatch(/^wfr_/);

    // ② GET durable DAG run（feature ON·mock ALL）→ 200·真持久化态（node/status/checkpoint）。
    const getOn = await t.app.inject({ method: "GET", url: `/b/v1/workflow-dag/runs/${runId}`, headers: dbg(ADMIN) });
    expect(getOn.statusCode).toBe(200);
    const run = (getOn.json() as { run: { status: string; nodes: { nodeId: string; status: string; checkpoint?: unknown }[] } }).run;
    expect(run.status).toBe("COMPLETED");
    expect(run.nodes.find((n) => n.nodeId === "q")?.status).toBe("DONE");
    expect(run.nodes.find((n) => n.nodeId === "q")?.checkpoint).toBeDefined(); // 步产出快照落库

    // ③ 暗发关闸（qos.workflow_dag off）→ 端点 404 FEATURE_NOT_FOUND（entitlement 先于 authz·C3·R3）。
    t.deps.features.mock.disable(TENANT, "qos.workflow_dag");
    const getOff = await t.app.inject({ method: "GET", url: `/b/v1/workflow-dag/runs/${runId}`, headers: dbg(ADMIN) });
    expect(getOff.statusCode).toBe(404);
    expect((getOff.json() as { error: { code: string } }).error.code).toBe("FEATURE_NOT_FOUND");
    t.deps.features.mock.set(TENANT, "ALL"); // 复位

    // ④ R2 跨租户：other 租户读 demo 的 run → 404（不泄露资源存在性）。
    const cross = await t.app.inject({ method: "GET", url: `/b/v1/workflow-dag/runs/${runId}`, headers: dbg(OTHER) });
    expect(cross.statusCode).toBe(404);

    // ⑤ 综合执行图（纯线性 lift·无一等 graphId）→ 诚实 404（未综合·规划器归 WO-L1B-4/5·不伪造图）。
    const eg = await t.app.inject({ method: "GET", url: `/b/v1/queries/${runId}/execution-graph`, headers: dbg(ADMIN) });
    expect(eg.statusCode).toBe(404);

    // ⑥ 手动续跑（admin·R-AUDIT）：COMPLETED run 无 PENDING 节点 → 幂等完成·resumedCount++。
    const resume = await t.app.inject({ method: "POST", url: `/b/v1/workflow-dag/runs/${runId}/resume`, headers: { ...dbg(ADMIN), "content-type": "application/json" }, payload: {} });
    expect(resume.statusCode).toBe(200);
    expect((resume.json() as { status: string; resumedCount: number }).status).toBe("COMPLETED");
    expect((resume.json() as { resumedCount: number }).resumedCount).toBe(1);

    // ⑦ 续跑 entitlement 门：关闸 → resume 端点亦 404（关=不存在）。
    t.deps.features.mock.disable(TENANT, "qos.workflow_dag");
    const resumeOff = await t.app.inject({ method: "POST", url: `/b/v1/workflow-dag/runs/${runId}/resume`, headers: { ...dbg(ADMIN), "content-type": "application/json" }, payload: {} });
    expect(resumeOff.statusCode).toBe(404);

    await t.app.close();
  });
});
