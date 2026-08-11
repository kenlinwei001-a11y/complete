import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";
import { BuildWorkflowEngine, RetryableStepError, type WorkflowStepDef } from "../src/databuilder/workflow-engine.js";
import { FACTORY_STORY_BUILD_NODES, factoryPipeline, orderPipelineNodes, resolvePipelineSteps } from "../src/databuilder/pipeline-defs.js";
import type { BuildPipeline, BuildWorkflowRun } from "@platform/contracts";
import type { Repos, Store } from "../src/repo/repo.js";

/**
 * WO-DATABUILDER-PIPELINE · 接缝门（SEAM-GATE）。
 *
 * 本单的接缝是两半：
 *   ① **配置这一半**：持久化的 BuildPipeline 定义（节点序列 + 每节点 SOP）；
 *   ② **接入口那一半**：/a/v1/databuilder/intake 与 /intake/import 的实际处理行为。
 * 只测「pipeline CRUD 能存能取」= 只测了 ①；只测「引擎能按数组跑」= 只测了 ②。
 * 下面每条**变异反证**都是：改 ① ⇒ ② 的产出语义反转 ⇒ 还原 ⇒ 复绿。任一半漏即红。
 */

const PROTOTYPE = `
<html><body>
<script>
  const ORDERS = [
    { so: "SO-1", qty: 1200, baseRef: "changzhou", pri: "HIGH" },
    { so: "SO-2", qty: 800, baseRef: "hefei", pri: "LOW" },
  ];
  const BASES = [
    { base: "changzhou", name: '常州' },
    { base: "hefei", name: '合肥' },
  ];
  L("ORDERS", "BASES", "PRODUCED_AT");
</script>
</body></html>`;

interface IntakeBody {
  intake: { dataSources: { name: string }[]; links: unknown[]; unparsed: unknown[] };
  reconcile: { autoMapped: unknown[]; candidates: { id?: string }[] };
  pipeline: { kind: string; factory: boolean; steps: { stepKey: string; status: string }[] };
}

const postIntake = async (t: TestApp): Promise<IntakeBody> => {
  const res = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/intake", headers: ADMIN, payload: { html: PROTOTYPE } });
  expect(res.statusCode).toBe(200);
  return res.json() as IntakeBody;
};

const getPipeline = async (t: TestApp, kind: string): Promise<BuildPipeline> =>
  (await t.app.inject({ method: "GET", url: `/a/v1/databuilder/pipelines/${kind}`, headers: ADMIN })).json() as BuildPipeline;

/** 覆盖某 kind 的 pipeline（配置这一半的写入动作）。 */
const putPipeline = async (t: TestApp, kind: string, doc: BuildPipeline): Promise<number> => {
  const res = await t.app.inject({
    method: "PUT",
    url: `/a/v1/databuilder/pipelines/${kind}`,
    headers: ADMIN,
    payload: { kind: doc.kind, name: doc.name, nodes: doc.nodes, edges: doc.edges },
  });
  return res.statusCode;
};

const queueSize = async (t: TestApp): Promise<number> =>
  ((await (await t.app.inject({ method: "GET", url: "/a/v1/databuilder/reconcile-candidates", headers: ADMIN })).json()) as { items: unknown[] }).items.length;

describe("WO-DATABUILDER-PIPELINE · 接缝：改 pipeline 定义 ⇒ intake 实际处理行为跟着变", () => {
  it("变异反证①：停用 intake_reconcile 节点 ⇒ intake 的对账产出由『非空』反转为『全空』；还原后复绿", async () => {
    const t = await makeApp();

    // —— 基线（出厂默认）：对账真的跑了，autoMapped + candidates 非空 ——
    const before = await postIntake(t);
    expect(before.pipeline.factory).toBe(true);
    expect(before.pipeline.steps.map((s) => s.stepKey)).toEqual(["intake_parse", "intake_reconcile", "intake_persist_candidates", "intake_emit"]);
    const baseTotal = before.reconcile.autoMapped.length + before.reconcile.candidates.length;
    expect(baseTotal).toBeGreaterThan(0);
    expect(before.intake.dataSources.length).toBe(2);

    // —— 变异：把 intake_reconcile 停用（只改**配置这一半**，一行都不碰接入口代码）——
    const def = await getPipeline(t, "intake");
    const mutated: BuildPipeline = { ...def, nodes: def.nodes.map((n) => (n.stepKey === "intake_reconcile" ? { ...n, enabled: false } : n)) };
    expect(await putPipeline(t, "intake", mutated)).toBe(200);
    // 读回确认变异真的落库生效（sed/PUT 没匹配上是常态，必须回读）
    const readBack = await getPipeline(t, "intake");
    expect(readBack.factory).toBe(false);
    expect(readBack.nodes.find((n) => n.stepKey === "intake_reconcile")!.enabled).toBe(false);

    // —— 语义反转：同一个 HTML、同一个端点，对账产出全空（不是微调，是从有到无）——
    const after = await postIntake(t);
    expect(after.pipeline.steps.map((s) => s.stepKey)).toEqual(["intake_parse", "intake_persist_candidates", "intake_emit"]);
    expect(after.reconcile.autoMapped.length + after.reconcile.candidates.length).toBe(0);
    // 解析那一步没被动 ⇒ 仍然抽出 2 张表（证明反转来自被停用的那个节点，不是整条链塌了）
    expect(after.intake.dataSources.length).toBe(2);

    // —— 还原：撤销覆盖回出厂默认 ⇒ 复绿 ——
    const del = await t.app.inject({ method: "DELETE", url: "/a/v1/databuilder/pipelines/intake", headers: ADMIN });
    expect(del.statusCode).toBe(200);
    const restored = await postIntake(t);
    expect(restored.pipeline.factory).toBe(true);
    expect(restored.reconcile.autoMapped.length + restored.reconcile.candidates.length).toBe(baseTotal);
  });

  it("变异反证②：停用 intake_persist_candidates ⇒ HITL 队列由『入队』反转为『不入队』（preview 仍在）", async () => {
    const t = await makeApp();

    const before = await postIntake(t);
    const baseCandidates = before.reconcile.candidates.length;
    expect(baseCandidates).toBeGreaterThan(0);
    expect(before.reconcile.candidates.every((c) => typeof c.id === "string")).toBe(true); // 入队 ⇒ 有 id
    expect(await queueSize(t)).toBe(baseCandidates);

    const def = await getPipeline(t, "intake");
    await putPipeline(t, "intake", { ...def, nodes: def.nodes.map((n) => (n.stepKey === "intake_persist_candidates" ? { ...n, enabled: false } : n)) });
    expect((await getPipeline(t, "intake")).nodes.find((n) => n.stepKey === "intake_persist_candidates")!.enabled).toBe(false);

    const t2 = await makeApp(); // 干净租户看「不入队」这一态（避免上一次的残留干扰计数）
    const d2 = await getPipeline(t2, "intake");
    await putPipeline(t2, "intake", { ...d2, nodes: d2.nodes.map((n) => (n.stepKey === "intake_persist_candidates" ? { ...n, enabled: false } : n)) });
    const after = await postIntake(t2);
    // 语义反转：候选**没有入队**（队列 0），但 preview 仍诚实返回候选（无 id = 未入队）
    expect(await queueSize(t2)).toBe(0);
    expect(after.reconcile.candidates.length).toBeGreaterThan(0);
    expect(after.reconcile.candidates.every((c) => c.id === undefined)).toBe(true);
  });

  it("变异反证③：改**边**（顺序）⇒ 对账排在解析之前 ⇒ 对账拿不到数据表，产出反转为空", async () => {
    const t = await makeApp();
    const baseline = await postIntake(t);
    expect(baseline.reconcile.autoMapped.length + baseline.reconcile.candidates.length).toBeGreaterThan(0);

    // 只改边：reconcile → parse（把对账挪到解析之前），节点一个没删
    const def = await getPipeline(t, "intake");
    const parse = def.nodes.find((n) => n.stepKey === "intake_parse")!;
    const rec = def.nodes.find((n) => n.stepKey === "intake_reconcile")!;
    const persist = def.nodes.find((n) => n.stepKey === "intake_persist_candidates")!;
    const emit = def.nodes.find((n) => n.stepKey === "intake_emit")!;
    expect(await putPipeline(t, "intake", {
      ...def,
      edges: [{ from: rec.id, to: parse.id }, { from: parse.id, to: persist.id }, { from: persist.id, to: emit.id }],
    })).toBe(200);

    const after = await postIntake(t);
    // 执行顺序真的跟着边变了（序列从数据读出来的证据）
    expect(after.pipeline.steps.map((s) => s.stepKey)).toEqual(["intake_reconcile", "intake_parse", "intake_persist_candidates", "intake_emit"]);
    // 语义反转：对账先跑 ⇒ 上游还没有数据表 ⇒ 对账结果全空；而解析仍然抽出 2 张表
    expect(after.reconcile.autoMapped.length + after.reconcile.candidates.length).toBe(0);
    expect(after.intake.dataSources.length).toBe(2);
  });

  it("变异反证④：导入口同样受 pipeline 支配 —— 停用 import_project_datasets ⇒ datasets 由 2 张反转为 0 张", async () => {
    const t = await makeApp();
    const imp = async (): Promise<{ datasets: unknown[]; connection: { id: string } | null; pipeline: { steps: { stepKey: string }[] } }> => {
      const res = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/intake/import", headers: ADMIN, payload: { html: PROTOTYPE, filename: "demo.html" } });
      expect(res.statusCode).toBe(200);
      return res.json() as { datasets: unknown[]; connection: { id: string } | null; pipeline: { steps: { stepKey: string }[] } };
    };

    const before = await imp();
    expect(before.datasets.length).toBe(2);
    expect(before.pipeline.steps.map((s) => s.stepKey)).toEqual(["import_materialize", "import_project_datasets", "import_emit"]);

    const def = await getPipeline(t, "intake_import");
    expect(await putPipeline(t, "intake_import", { ...def, nodes: def.nodes.map((n) => (n.stepKey === "import_project_datasets" ? { ...n, enabled: false } : n)) })).toBe(200);
    expect((await getPipeline(t, "intake_import")).nodes.find((n) => n.stepKey === "import_project_datasets")!.enabled).toBe(false);

    const after = await imp();
    // 语义反转：不再投影表清单（0 张）；但物化那步仍跑了 ⇒ 连接仍建出来（证明是节点级反转）
    expect(after.datasets.length).toBe(0);
    expect(after.connection).not.toBeNull();
    expect(after.pipeline.steps.map((s) => s.stepKey)).toEqual(["import_materialize", "import_emit"]);
  });

  it("R2 租户隔离：A 租户改 pipeline 不影响 B 租户（B 仍走出厂默认）", async () => {
    const t = await makeApp();
    const def = await getPipeline(t, "intake");
    await putPipeline(t, "intake", { ...def, nodes: def.nodes.map((n) => (n.stepKey === "intake_reconcile" ? { ...n, enabled: false } : n)) });

    const otherHeaders = { "x-debug-user": "acme:admin:admin" };
    const otherDef = (await (await t.app.inject({ method: "GET", url: "/a/v1/databuilder/pipelines/intake", headers: otherHeaders })).json()) as BuildPipeline;
    expect(otherDef.factory).toBe(true); // 未被 demo 的覆盖污染
    expect(otherDef.nodes.every((n) => n.enabled)).toBe(true);
  });
});

describe("WO-DATABUILDER-PIPELINE · 出厂默认行为不变性（不配置任何东西 ⇒ 与写死时代一致）", () => {
  it("金值：出厂 story_build pipeline 解析出的步骤 = 改造前写死的 7 步（stepKey/顺序/title/maxAttempts 全钉死）", () => {
    const p = factoryPipeline("demo", "story_build");
    // 步骤实现注册表用桩（本条只验「序列与 SOP 从出厂定义读出来的结果」，不碰业务实现）
    const registry = Object.fromEntries(
      FACTORY_STORY_BUILD_NODES.map((n) => [n.stepKey, { title: n.label, run: async () => ({}) }]),
    );
    const steps = resolvePipelineSteps(p, registry);

    // ① stepKey 与顺序：与改造前 service.ts 的常量数组逐字一致
    expect(steps.map((s) => s.stepKey)).toEqual([
      "dry_build", "cross_scaffold", "gap_analysis", "publish_build", "validation", "inference", "record",
    ]);
    // ② maxAttempts：只有 cross_scaffold 是 3（跨系统 HTTP 有界重试），其余 1
    expect(steps.map((s) => s.maxAttempts)).toEqual([1, 3, 1, 1, 1, 1, 1]);
    // ③ 失败策略：出厂一律 ABORT（止于该步保留现场）——**不是** RETRY，
    //    改成 RETRY 会让致命错也重试 = 行为变化，故此处钉死。
    expect(steps.map((s) => s.onFailure)).toEqual(new Array(7).fill("ABORT"));
    // ④ 人工介入：出厂一律不需要（否则同步链路会当场停住）
    expect(steps.every((s) => s.requiresApproval === false)).toBe(true);
    // ⑤ title：逐字沿用写死时代 → 落库的 BuildWorkflowStep.title 不变
    expect(steps[0]!.title).toBe("试建：出 BuildPlan + A 三向闭包（不发布）");
    expect(steps[6]!.title).toBe("记账：装配 StoryBuildRun 落库 + 发 storybuild.run_recorded");
  });

  it("金值：出厂 intake / intake_import pipeline 的节点序列钉死", () => {
    expect(orderPipelineNodes(factoryPipeline("demo", "intake")).map((n) => n.stepKey))
      .toEqual(["intake_parse", "intake_reconcile", "intake_persist_candidates", "intake_emit"]);
    expect(orderPipelineNodes(factoryPipeline("demo", "intake_import")).map((n) => n.stepKey))
      .toEqual(["import_materialize", "import_project_datasets", "import_emit"]);
  });

  it("端到端不变性：未配置任何 pipeline ⇒ 建域跑出的 7 步记录与出厂定义逐条对齐（含 maxAttempts）", async () => {
    const t = await makeApp();
    const res = await t.app.inject({
      method: "POST", url: "/a/v1/databuilder/workflow-runs", headers: ADMIN,
      payload: { script: "常州基地产能不足，评估把部分订单调到合肥基地的影响", seed: 42 },
    });
    expect([200, 201]).toContain(res.statusCode);
    const wf = res.json() as BuildWorkflowRun;
    expect(wf.steps.map((s) => s.stepKey)).toEqual([
      "dry_build", "cross_scaffold", "gap_analysis", "publish_build", "validation", "inference", "record",
    ]);
    expect(wf.steps.map((s) => s.maxAttempts)).toEqual([1, 3, 1, 1, 1, 1, 1]);
    expect(wf.steps[0]!.title).toBe("试建：出 BuildPlan + A 三向闭包（不发布）");
  });

  it("接缝：改 story_build pipeline（停用 inference 节点）⇒ 建域执行的步骤序列跟着变", async () => {
    const t = await makeApp();
    const def = (await (await t.app.inject({ method: "GET", url: "/a/v1/databuilder/pipelines/story_build", headers: ADMIN })).json()) as BuildPipeline;
    const put = await t.app.inject({
      method: "PUT", url: "/a/v1/databuilder/pipelines/story_build", headers: ADMIN,
      payload: { kind: "story_build", name: def.name, nodes: def.nodes.map((n) => (n.stepKey === "inference" ? { ...n, enabled: false } : n)), edges: def.edges },
    });
    expect(put.statusCode).toBe(200);

    const res = await t.app.inject({
      method: "POST", url: "/a/v1/databuilder/workflow-runs", headers: ADMIN,
      payload: { script: "常州基地产能不足，评估把部分订单调到合肥基地的影响", seed: 42 },
    });
    const wf = res.json() as BuildWorkflowRun;
    // 语义反转：inference 步整个从执行序列里消失（不是"跑了但跳过"）
    expect(wf.steps.map((s) => s.stepKey)).toEqual([
      "dry_build", "cross_scaffold", "gap_analysis", "publish_build", "validation", "record",
    ]);
    expect(wf.steps.some((s) => s.stepKey === "inference")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 节点 SOP 的执行语义（失败怎么办 / 人要不要介入）——引擎层直测
// ---------------------------------------------------------------------------

function memStore<T extends { id: string; tenantId: string }>(): Store<T> {
  const m = new Map<string, T>();
  const k = (t: string, id: string): string => `${t}/${id}`;
  return {
    async get(t, id) { const v = m.get(k(t, id)); return v ? structuredClone(v) : undefined; },
    async put(item) { m.set(k(item.tenantId, item.id), structuredClone(item)); },
    async remove(t, id) { m.delete(k(t, id)); },
    async list(t, pred) { return [...m.values()].filter((v) => v.tenantId === t && (!pred || pred(v))).map((v) => structuredClone(v)); },
  };
}

function harness(): { store: Store<BuildWorkflowRun>; events: { event: string; payload: Record<string, unknown> }[]; engine: BuildWorkflowEngine; init: (id?: string) => { id: string; tenantId: string; script: string; scriptHash: string; seed: number; inference: boolean } } {
  const store = memStore<BuildWorkflowRun>();
  const events: { event: string; payload: Record<string, unknown> }[] = [];
  const outbox = { emit: async (_t: string, event: string, payload: Record<string, unknown>) => { events.push({ event, payload }); } };
  const engine = new BuildWorkflowEngine({ buildWorkflowRuns: store } as unknown as Repos, outbox as never, () => 0);
  return { store, events, engine, init: (id = "bwf_1") => ({ id, tenantId: "demo", script: "s", scriptHash: "h", seed: 42, inference: false }) };
}

describe("WO-DATABUILDER-PIPELINE · 节点 SOP 执行语义", () => {
  it("SOP onFailure=SKIP：该步失败 → 标 SKIPPED 继续跑完，run 仍 SUCCEEDED（错误记在 detail 不静默吞）", async () => {
    const { engine, events, init } = harness();
    const calls: string[] = [];
    const steps: WorkflowStepDef[] = [
      { stepKey: "a", title: "A", onFailure: "ABORT", run: async () => { calls.push("a"); return {}; } },
      { stepKey: "boom", title: "B", onFailure: "SKIP", run: async () => { calls.push("boom"); throw new Error("外部依赖挂了"); } },
      { stepKey: "c", title: "C", onFailure: "ABORT", run: async () => { calls.push("c"); return {}; } },
    ];
    const wf = await engine.start(init(), steps);
    expect(wf.status).toBe("SUCCEEDED"); // 反证：默认 ABORT 时这里是 FAILED
    expect(wf.steps.map((s) => s.status)).toEqual(["SUCCEEDED", "SKIPPED", "SUCCEEDED"]);
    expect(calls).toEqual(["a", "boom", "c"]); // c 真的跑了
    expect(wf.steps[1]!.detail).toContain("外部依赖挂了"); // 不静默吞
    expect(events.some((e) => e.event === "buildworkflow.step_skipped" && e.payload.reason === "SOP_SKIP")).toBe(true);
  });

  it("对照组：同样的失败，SOP onFailure=ABORT（出厂默认）⇒ 止于该步、run FAILED、后续不跑", async () => {
    const { engine, init } = harness();
    const calls: string[] = [];
    const steps: WorkflowStepDef[] = [
      { stepKey: "a", title: "A", run: async () => { calls.push("a"); return {}; } },
      { stepKey: "boom", title: "B", run: async () => { calls.push("boom"); throw new Error("外部依赖挂了"); } },
      { stepKey: "c", title: "C", run: async () => { calls.push("c"); return {}; } },
    ];
    const wf = await engine.start(init(), steps);
    expect(wf.status).toBe("FAILED");
    expect(wf.steps.map((s) => s.status)).toEqual(["SUCCEEDED", "FAILED", "PENDING"]);
    expect(calls).toEqual(["a", "boom"]); // c 没跑
  });

  it("SOP onFailure=RETRY：不抛 RetryableStepError 也按 maxAttempts 重试（策略本身即声明可重试）", async () => {
    const { engine, events, init } = harness();
    let n = 0;
    const steps: WorkflowStepDef[] = [
      { stepKey: "flaky", title: "F", onFailure: "RETRY", maxAttempts: 3, run: async () => { n += 1; if (n < 3) throw new Error("普通错误"); return { detail: "ok" }; } },
    ];
    const wf = await engine.start(init(), steps);
    expect(wf.status).toBe("SUCCEEDED");
    expect(wf.steps[0]!.attempts).toBe(3);
    expect(events.filter((e) => e.event === "buildworkflow.step_retry")).toHaveLength(2);
  });

  it("向后兼容：未配 onFailure 时，仍只有 RetryableStepError 触发重试（写死时代的判据没被改掉）", async () => {
    const { engine, init } = harness();
    let n = 0;
    const steps: WorkflowStepDef[] = [
      { stepKey: "x", title: "X", maxAttempts: 3, run: async () => { n += 1; throw new Error("普通错误"); } },
    ];
    const wf = await engine.start(init(), steps);
    expect(wf.status).toBe("FAILED");
    expect(n).toBe(1); // 普通错误不重试
    const { engine: e2, init: i2 } = harness();
    let m = 0;
    const wf2 = await e2.start(i2("bwf_2"), [
      { stepKey: "y", title: "Y", maxAttempts: 3, run: async () => { m += 1; if (m < 3) throw new RetryableStepError("瞬时"); return {}; } },
    ]);
    expect(wf2.status).toBe("SUCCEEDED");
    expect(m).toBe(3);
  });

  it("SOP requiresHumanApproval：执行到该节点前 run 置 PAUSED 停住；approve 放行后 resume 续跑至终态", async () => {
    const { engine, events, init, store } = harness();
    const calls: string[] = [];
    const steps: WorkflowStepDef[] = [
      { stepKey: "a", title: "A", run: async () => { calls.push("a"); return {}; } },
      { stepKey: "gate", title: "G", requiresApproval: true, run: async () => { calls.push("gate"); return {}; } },
      { stepKey: "c", title: "C", run: async () => { calls.push("c"); return {}; } },
    ];
    const wf = await engine.start(init(), steps);
    expect(wf.status).toBe("PAUSED");
    expect(calls).toEqual(["a"]); // gate 本体没执行
    expect(events.some((e) => e.event === "buildworkflow.run_paused" && e.payload.reason === "AWAITING_APPROVAL")).toBe(true);

    // 放行：把 stepKey 记进 context 放行名单（approve 端点做的就是这件事）→ resume
    const stored = (await store.get("demo", "bwf_1"))!;
    stored.context = { ...stored.context, __approvedSteps: ["gate"] };
    await store.put(stored);
    const resumed = await engine.resume("demo", "bwf_1", steps);
    expect(resumed.status).toBe("SUCCEEDED");
    expect(calls).toEqual(["a", "gate", "c"]);
  });
});
