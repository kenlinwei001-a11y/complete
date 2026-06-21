import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";
import type { LlmComprehendOutput } from "../src/databuilder/comprehend.js";
import { projectFdeNodes, summarizeFdeNodes, FDE_NODES } from "../src/databuilder/fde-graph.js";
import { FDE_NODE_KEYS, type BuildWorkflowStep } from "@platform/contracts";

/**
 * A5 · FDE 编排工作流节点状态图（PRD-A5）。
 * L0：projectFdeNodes 确定性投影（7 执行步 + context → 8 语义节点）；
 * L1：真服务建域一遍 → StoryBuildRun.nodes 落 8 节点 + /fde-graph 端点实时投影 + fde.node_advanced 入 outbox。
 */

const step = (stepKey: string, status: BuildWorkflowStep["status"], extra: Partial<BuildWorkflowStep> = {}): BuildWorkflowStep => ({
  stepKey, title: stepKey, status, attempts: 1, maxAttempts: 1, ...extra,
});

describe("A5 · projectFdeNodes 确定性投影（L0）", () => {
  it("8 节点固定序，与 FDE_NODES/FDE_NODE_KEYS 对齐", () => {
    const nodes = projectFdeNodes({ context: {} });
    expect(nodes.map((n) => n.key)).toEqual([...FDE_NODE_KEYS]);
    expect(nodes.length).toBe(8);
    expect(FDE_NODES.map((d) => d.key)).toEqual([...FDE_NODE_KEYS]);
  });

  it("空 context：story DONE（输入燃料），其余 PENDING", () => {
    const nodes = projectFdeNodes({ context: {} });
    const byKey = Object.fromEntries(nodes.map((n) => [n.key, n.status]));
    expect(byKey.story).toBe("DONE");
    expect(byKey.comprehend).toBe("PENDING");
    expect(byKey.closure).toBe("PENDING");
    expect(byKey.launcher).toBe("PENDING");
  });

  it("成功建域 context：8 节点全 DONE（含 launcher 出 answer）", () => {
    const ctx = {
      planId: "bpl_1", aOk: true, bOk: true,
      gapAnalysis: { summary: { need: 5 } },
      built: true, producedConnections: ["c1"], producedDatasets: ["d1"],
      closureReport: { gatePassed: true, findings: [], objectsBound: 3, dataOrphans: 0, forwardMissing: 0, chainBroken: 0, shapeBroken: 0 },
      answer: "常州 7 月缺口 12%",
    };
    const nodes = projectFdeNodes({ context: ctx });
    expect(nodes.every((n) => n.status === "DONE")).toBe(true);
    expect(summarizeFdeNodes(nodes).done).toBe(8);
    // IO best-effort：生成节点出 = 连接器+数据集数
    expect(nodes.find((n) => n.key === "generate")!.io?.out).toBe(2);
  });

  it("闭包断（CHAIN）：closure FAILED + gapCode=CHAIN_BROKEN，生成/publish/launcher SKIPPED（拒发布）", () => {
    const ctx = {
      planId: "bpl_2", aOk: false,
      closureReport: { gatePassed: false, findings: [{ kind: "CHAIN", ref: "solver:ghost", status: "FAILED" }], objectsBound: 1, dataOrphans: 0, forwardMissing: 0, chainBroken: 1, shapeBroken: 0 },
    };
    const nodes = projectFdeNodes({ context: ctx });
    const byKey = Object.fromEntries(nodes.map((n) => [n.key, n]));
    expect(byKey.comprehend.status).toBe("DONE"); // 倒推出了 plan
    expect(byKey.closure.status).toBe("FAILED");
    expect(byKey.closure.gapCode).toBe("CHAIN_BROKEN");
    expect(byKey.generate.status).toBe("SKIPPED");
    expect(byKey.publish.status).toBe("SKIPPED");
    expect(byKey.launcher.status).toBe("SKIPPED");
    expect(summarizeFdeNodes(nodes).failedAt).toBe("closure");
  });

  it("步状态叠加：dry_build RUNNING → comprehend/capability RUNNING；计时取步 durationMs", () => {
    const steps = [step("dry_build", "RUNNING", { startedAt: "2026-01-01T00:00:00Z" })];
    const nodes = projectFdeNodes({ steps, context: {} });
    expect(nodes.find((n) => n.key === "comprehend")!.status).toBe("RUNNING");
    const done = projectFdeNodes({ steps: [step("dry_build", "SUCCEEDED", { durationMs: 42 })], context: { planId: "p" } });
    expect(done.find((n) => n.key === "comprehend")!.durationMs).toBe(42);
  });

  it("R6 确定性：同 context 重投影字节级一致", () => {
    const ctx = { planId: "p", aOk: true, bOk: true, built: true, answer: "x" };
    expect(JSON.stringify(projectFdeNodes({ context: ctx }))).toBe(JSON.stringify(projectFdeNodes({ context: ctx })));
  });
});

const KIMI: LlmComprehendOutput = {
  objectTypes: [
    { typeKey: "Proc", displayName: "工序", domain: "process", fields: [{ name: "procId", dataType: "string", isPrimaryKey: true }, { name: "capacity", dataType: "number" }] },
    { typeKey: "Ord", displayName: "订单", domain: "sales", fields: [{ name: "so", dataType: "string", isPrimaryKey: true }, { name: "procRef", dataType: "ref", refToTypeKey: "Proc" }, { name: "qty", dataType: "number" }] },
  ],
  rules: [],
  solverNeeds: [],
  scenarioTopology: {
    sharedResources: [{ resourceType: "Proc", sharedByType: "Ord", viaField: "procRef", count: 1 }],
    plantedValues: [{ typeKey: "Proc", field: "capacity", value: 10, everyN: 1 }],
  },
};

describe("A5 · 真服务建域 → 节点图落库 + 实时投影端点 + 事件（L1）", () => {
  it("建域一遍：StoryBuildRun.nodes 落 8 节点 + /fde-graph 端点 8 节点 + fde.node_advanced 入 outbox", async () => {
    const t: TestApp = await makeApp();
    t.llm.enqueue(KIMI as unknown as Record<string, unknown>);
    const res = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/workflow-runs", headers: ADMIN, payload: { script: "C、D 两客户扩产订单的共享工序瓶颈与降级", seed: 42 } });
    expect([200, 201]).toContain(res.statusCode);
    const wf = res.json() as { id: string; storyRunId?: string; status: string };
    expect(wf.status).toBe("SUCCEEDED");

    // /fde-graph 端点：8 节点，story DONE
    const fg = await t.app.inject({ method: "GET", url: `/a/v1/databuilder/workflow-runs/${wf.id}/fde-graph`, headers: ADMIN });
    const graph = fg.json() as { nodes: { key: string; status: string }[]; summary: { total: number } };
    expect(graph.nodes.length).toBe(8);
    expect(graph.summary.total).toBe(8);
    expect(graph.nodes.find((n) => n.key === "story")!.status).toBe("DONE");
    expect(graph.nodes.find((n) => n.key === "comprehend")!.status).toBe("DONE");

    // StoryBuildRun.nodes 持久化快照
    const storyId = wf.storyRunId!;
    const sr = await t.app.inject({ method: "GET", url: `/a/v1/databuilder/runs/${storyId}`, headers: ADMIN });
    const story = sr.json() as { nodes: { key: string; status: string }[] };
    expect(story.nodes.length).toBe(8);
    expect(story.nodes.map((n) => n.key)).toEqual([...FDE_NODE_KEYS]);

    // fde.node_advanced 实时事件入 outbox（R10）
    const events = await t.repos.outboxEvents.list("demo", (e) => e.event === "fde.node_advanced");
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => (e.payload as { nodeKey?: string }).nodeKey === "comprehend")).toBe(true);
  });

  it("R2：跨租户取 /fde-graph → 404（仅本租户工作流）", async () => {
    const t: TestApp = await makeApp();
    t.llm.enqueue(KIMI as unknown as Record<string, unknown>);
    const res = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/workflow-runs", headers: ADMIN, payload: { script: "共享瓶颈", seed: 42 } });
    const wf = res.json() as { id: string };
    const other = await t.app.inject({ method: "GET", url: `/a/v1/databuilder/workflow-runs/${wf.id}/fde-graph`, headers: { "x-debug-user": "acme:admin:admin" } });
    expect(other.statusCode).toBe(404);
  });
});
