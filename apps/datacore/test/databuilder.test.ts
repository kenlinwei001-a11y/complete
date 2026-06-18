import { describe, expect, it } from "vitest";
import { ClosurePolicySchema, type BuildPlan } from "@platform/contracts";
import { validateClosure } from "../src/databuilder/closure.js";
import { SOLVER_KEYS, SOLVER_OUTPUT_SHAPES } from "../src/solvers/service.js";
import { makeApp, ADMIN, debugUser } from "./helpers.js";

const SCRIPT = "常州基地产能紧张，影响订单交期与客户信用，请做风险推演";

describe("R11 全链闭包门 · CHAIN 维（求解器注册焊进 ClosureReport）", () => {
  const policy = ClosurePolicySchema.parse({ object: {}, data: {}, forward: {} });
  const base: Omit<BuildPlan, "solverNeeds"> = {
    id: "bpl_t", tenantId: "demo", builderKey: "test", scriptHash: "h", seed: 1, script: "",
    dataSources: [], objectTypes: [], rules: [], kbDocs: [], createdAt: "2026-01-01",
  };

  it("已注册求解器 → CHAIN BOUND，gate 通过", () => {
    const r = validateClosure({ ...base, solverNeeds: [{ solverKey: "affected_orders", inputFields: [] }] }, policy);
    expect(r.chainBroken).toBe(0);
    expect(r.gatePassed).toBe(true);
    expect(r.findings.some((f) => f.kind === "CHAIN" && f.ref === "solver:affected_orders" && f.status === "BOUND")).toBe(true);
  });

  it("未注册求解器 → CHAIN FAILED，gate 不通过（路径A 全链断 SOLVER_NOT_FOUND）", () => {
    const r = validateClosure({ ...base, solverNeeds: [{ solverKey: "ghost_solver", inputFields: [] }] }, policy);
    expect(r.chainBroken).toBe(1);
    expect(r.gatePassed).toBe(false);
    expect(r.findings.some((f) => f.kind === "CHAIN" && f.status === "FAILED")).toBe(true);
  });

  it("工作流求解器 sop_balance 豁免（与 chain:check 口径一致）", () => {
    const r = validateClosure({ ...base, solverNeeds: [{ solverKey: "sop_balance", inputFields: [] }] }, policy);
    expect(r.chainBroken).toBe(0);
  });
});

describe("R11-SHAPE · 渲染契约（求解器输出形状 ↔ 渲染绑定，BuildPlan 扩 AgentCore 渲染栈）", () => {
  const policy = ClosurePolicySchema.parse({ object: {}, data: {}, forward: {} });
  const base: Omit<BuildPlan, "solverNeeds"> = {
    id: "bpl_s", tenantId: "demo", builderKey: "test", scriptHash: "h", seed: 1, script: "",
    dataSources: [], objectTypes: [], rules: [], kbDocs: [], createdAt: "2026-01-01",
  };

  it("渲染绑定字段全在求解器输出形状 → SHAPE BOUND，gate 通过", () => {
    const r = validateClosure({ ...base, solverNeeds: [{ solverKey: "capacity_forecast", inputFields: [], renderBindings: ["p50", "p90", "perBaseRows", "gap"] }] }, policy);
    expect(r.shapeBroken).toBe(0);
    expect(r.gatePassed).toBe(true);
    expect(r.findings.some((f) => f.kind === "SHAPE" && f.ref === "capacity_forecast.output.p50" && f.status === "BOUND")).toBe(true);
  });

  it("渲染绑定引用求解器不产出的字段 → SHAPE FAILED，gate 不通过（G-2 跨服务形状断）", () => {
    const r = validateClosure({ ...base, solverNeeds: [{ solverKey: "capacity_forecast", inputFields: [], renderBindings: ["p50", "ghostField"] }] }, policy);
    expect(r.shapeBroken).toBe(1);
    expect(r.gatePassed).toBe(false);
    expect(r.findings.some((f) => f.kind === "SHAPE" && f.status === "FAILED" && f.detail?.includes("ghostField"))).toBe(true);
  });

  it("嵌套路径取顶层 key 校验（perBaseRows.base 命中 perBaseRows）", () => {
    const r = validateClosure({ ...base, solverNeeds: [{ solverKey: "capacity_forecast", inputFields: [], renderBindings: ["perBaseRows.base", "perBaseRows.weeklyCap"] }] }, policy);
    expect(r.shapeBroken).toBe(0);
  });

  it("未声明输出形状的求解器（工作流求解器 sop_balance）→ SHAPE 跳过（ORPHAN_PASSED，不阻塞）", () => {
    // 所有注册求解器已全覆盖输出形状；SHAPE 跳过路径由无形状声明的工作流求解器触发。
    const r = validateClosure({ ...base, solverNeeds: [{ solverKey: "sop_balance", inputFields: [], renderBindings: ["anyField"] }] }, policy);
    expect(r.shapeBroken).toBe(0);
    expect(r.gatePassed).toBe(true);
    expect(r.findings.some((f) => f.kind === "SHAPE" && f.status === "ORPHAN_PASSED")).toBe(true);
  });

  it("无 renderBindings → 不产生 SHAPE 校验（向后兼容）", () => {
    const r = validateClosure({ ...base, solverNeeds: [{ solverKey: "capacity_forecast", inputFields: [] }] }, policy);
    expect(r.findings.some((f) => f.kind === "SHAPE")).toBe(false);
    expect(r.shapeBroken).toBe(0);
  });

  it("SHAPE 全覆盖：每个注册求解器都声明了输出形状（与 chain:check 门一致）", () => {
    for (const k of SOLVER_KEYS) {
      expect(SOLVER_OUTPUT_SHAPES[k], `求解器 ${k} 缺输出形状声明`).toBeTruthy();
      expect(SOLVER_OUTPUT_SHAPES[k]!.length).toBeGreaterThan(0);
    }
  });
});

interface JobResp {
  jobId: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  replayed: boolean;
  planId?: string;
  phases: { name: string; status: string }[];
  closure?: { gatePassed: boolean; objectsBound: number; forwardMissing: number; findings: { kind: string; status: string }[] };
  preview?: Record<string, unknown>;
}

async function run(t: Awaited<ReturnType<typeof makeApp>>, body: Record<string, unknown>): Promise<JobResp> {
  const res = await t.app.inject({ method: "POST", url: "/a/v1/data-builders/run", headers: ADMIN, payload: body });
  return res.json() as JobResp;
}

describe("A7 Foundry-Grade Data Builder", () => {
  it("DB1: 预设 builder 幂等可见", async () => {
    const t = await makeApp();
    const res = await t.app.inject({ method: "GET", url: "/a/v1/data-builders", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const list = res.json() as { key: string; status: string; version: number }[];
    const preset = list.find((b) => b.key === "foundry-grade-data-builder");
    expect(preset?.status).toBe("PUBLISHED");
  });

  it("DB2: 七阶段全跑通 + 闭包门禁通过 + 物化对象落库", async () => {
    const t = await makeApp();
    const job = await run(t, { script: SCRIPT, seed: 7 });
    expect(job.status).toBe("SUCCEEDED");
    expect(job.phases.map((p) => p.status)).toEqual(["DONE", "DONE", "DONE", "DONE", "DONE", "DONE", "DONE"]);
    expect(job.closure?.gatePassed).toBe(true);
    expect(job.closure?.forwardMissing).toBe(0);
    expect(job.closure!.objectsBound).toBeGreaterThan(0);
    // 物化对象进入对象库（经连接器上传→RawDataset→物化，而非直写）
    const objs = await t.app.inject({ method: "GET", url: "/a/v1/objects?type=Order", headers: ADMIN });
    const rows = (objs.json() as { rows?: unknown[] }).rows ?? (objs.json() as { data?: unknown[] }).data ?? [];
    expect(Array.isArray(rows) ? rows.length : 0).toBeGreaterThan(0);
  });

  it("DB3: dry-run 只预览不落库", async () => {
    const t = await makeApp();
    const job = await run(t, { script: SCRIPT, seed: 5, dryRun: true });
    expect(job.preview).toBeTruthy();
    expect((job.preview as { objectTypes: string[] }).objectTypes.length).toBeGreaterThan(0);
    const phaseByName = Object.fromEntries(job.phases.map((p) => [p.name, p.status]));
    expect(phaseByName.publish).toBe("SKIPPED");
    expect(phaseByName.rawin).toBe("SKIPPED");
  });

  it("DB4: 确定性 —— 同 (script, seed) 重跑命中封存 plan 重放且字节级一致", async () => {
    const t = await makeApp();
    const first = await run(t, { script: SCRIPT, seed: 42 });
    expect(first.replayed).toBe(false);
    const second = await run(t, { script: SCRIPT, seed: 42 });
    expect(second.replayed).toBe(true);
    expect(second.planId).toBe(first.planId);
    const p1 = await t.app.inject({ method: "GET", url: `/a/v1/data-builders/plans/${first.planId}`, headers: ADMIN });
    const p2 = await t.app.inject({ method: "GET", url: `/a/v1/data-builders/plans/${second.planId}`, headers: ADMIN });
    expect(p1.body).toBe(p2.body);
  });

  it("DB6: 数据源节点在线编辑 —— PATCH 上传数据行并留痕", async () => {
    const t = await makeApp();
    await run(t, { script: SCRIPT, seed: 3 });
    // build 经连接器上传产生 RawDataset
    const raws = (await (await t.app.inject({ method: "GET", url: "/a/v1/raw-datasets", headers: ADMIN })).json()) as { id: string; rowCount: number }[];
    expect(raws.length).toBeGreaterThan(0);
    const dsId = raws[0]!.id;
    const before = (await (await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets/${dsId}/rows`, headers: ADMIN })).json()) as { rows: Record<string, unknown>[] };
    expect(before.rows.length).toBeGreaterThan(0);
    const field = Object.keys(before.rows[0]!)[0]!;
    const res = await t.app.inject({ method: "PATCH", url: `/a/v1/raw-datasets/${dsId}/rows/0`, headers: ADMIN, payload: { [field]: "EDITED-VALUE" } });
    expect(res.statusCode).toBe(200);
    const after = (await (await t.app.inject({ method: "GET", url: `/a/v1/raw-datasets/${dsId}/rows`, headers: ADMIN })).json()) as { rows: Record<string, unknown>[] };
    expect(after.rows[0]![field]).toBe("EDITED-VALUE");
    expect(after.rows[0]!._editedAt).toBeTruthy();
  });

  it("DB5: 二次配置 —— new-version 派生 DRAFT 可改，PUBLISHED 不可改", async () => {
    const t = await makeApp();
    const list = (await (await t.app.inject({ method: "GET", url: "/a/v1/data-builders", headers: ADMIN })).json()) as { id: string; status: string }[];
    const preset = list.find((b) => b.status === "PUBLISHED")!;
    // PUBLISHED 直接改 → 409
    const bad = await t.app.inject({ method: "PUT", url: `/a/v1/data-builders/${preset.id}`, headers: ADMIN, payload: { name: "x" } });
    expect(bad.statusCode).toBe(409);
    // new-version → DRAFT 可改
    const nv = await t.app.inject({ method: "POST", url: `/a/v1/data-builders/${preset.id}/new-version`, headers: ADMIN });
    expect(nv.statusCode).toBe(201);
    const draft = nv.json() as { id: string; status: string };
    expect(draft.status).toBe("DRAFT");
    const upd = await t.app.inject({ method: "PUT", url: `/a/v1/data-builders/${draft.id}`, headers: ADMIN, payload: { name: "定制版" } });
    expect(upd.statusCode).toBe(200);
  });
});

interface StoryRunResp {
  id: string;
  script: string;
  status: "PENDING_INPUT" | "RUNNING" | "SUCCEEDED" | "FAILED";
  buildPlan?: { id: string; objectTypes: unknown[]; intentNeeds: unknown[]; planNeeds: unknown[]; sceneNeeds: unknown[]; solverNeeds: unknown[] };
  closureReport?: { gatePassed: boolean };
  producedConnections: string[];
  producedDatasets: string[];
}

describe("g8 故事驱动全栈倒推 · P1 · StoryBuildRun 端点（构建期历史推演记录）", () => {
  it("SBR1: 提交故事脚本 → 建 StoryBuildRun（含 buildPlan/闭包/产出连接器+数据集）+ 历史列表/详情", async () => {
    const t = await makeApp();
    const res = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: SCRIPT, seed: 11 } });
    expect(res.statusCode).toBe(201);
    const run = res.json() as StoryRunResp;
    expect(run.id).toMatch(/^sbr_/);
    expect(run.status).toBe("SUCCEEDED");
    expect(run.buildPlan?.objectTypes.length).toBeGreaterThan(0);
    // g8-P3 倒推：每个求解器 → 计划+意图+场景（全栈倒推脊柱）
    const bp = run.buildPlan!;
    expect(bp.intentNeeds.length).toBe(bp.solverNeeds.length);
    expect(bp.planNeeds.length).toBe(bp.solverNeeds.length);
    expect(bp.sceneNeeds.length).toBe(bp.solverNeeds.length);
    expect(run.closureReport?.gatePassed).toBe(true);
    // 真人正门产物：build 经连接器上传产生连接器 + RawDataset，记入历史（连接器页可下钻）
    expect(run.producedConnections.length).toBeGreaterThan(0);
    expect(run.producedDatasets.length).toBeGreaterThan(0);

    // 历史推演记录列表
    const list = (await (await t.app.inject({ method: "GET", url: "/a/v1/databuilder/runs", headers: ADMIN })).json()) as StoryRunResp[];
    expect(list.some((r) => r.id === run.id)).toBe(true);
    // 详情可回放
    const detail = (await (await t.app.inject({ method: "GET", url: `/a/v1/databuilder/runs/${run.id}`, headers: ADMIN })).json()) as StoryRunResp;
    expect(detail.script).toBe(SCRIPT);
  });

  it("SBR2: R2 租户隔离 —— 他租户读不到本租户的历史推演记录", async () => {
    const t = await makeApp();
    const created = (await (await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: SCRIPT, seed: 13 } })).json()) as StoryRunResp;
    const OTHER = debugUser("acme", "admin", "admin");
    const otherList = (await (await t.app.inject({ method: "GET", url: "/a/v1/databuilder/runs", headers: OTHER })).json()) as StoryRunResp[];
    expect(otherList.some((r) => r.id === created.id)).toBe(false);
    const otherGet = await t.app.inject({ method: "GET", url: `/a/v1/databuilder/runs/${created.id}`, headers: OTHER });
    expect(otherGet.statusCode).toBe(404);
  });

  it("SBR4 (g8-P3): closure 后跨系统 scaffold（A→B）→ 回执并入 StoryBuildRun；fullChainOk 决定终态（R11 跨系统）", async () => {
    let chainOk = true;
    let sawServiceToken = "";
    const fetchImpl = (async (url: string | URL, init?: { headers?: Record<string, string>; body?: string }) => {
      if (String(url).includes("/b/v1/internal/scaffold")) {
        sawServiceToken = init?.headers?.["x-service-token"] ?? "";
        const m = JSON.parse(init?.body ?? "{}") as { sceneNeeds: { scenarioKey: string }[] };
        return new Response(JSON.stringify({
          items: m.sceneNeeds.map((s) => ({ kind: "scene", key: s.scenarioKey, status: chainOk ? "SCAFFOLDED" : "MISSING" })),
          fullChainOk: chainOk,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const t = await makeApp({ env: { AGENTCORE_BASE_URL: "http://agent.test", SERVICE_TOKEN: "svc-tok" }, fetchImpl });

    // 全链闭合 → 回执并入 + SUCCEEDED
    const ok = (await (await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: SCRIPT, seed: 31 } })).json()) as StoryRunResp & { scaffoldReceipt?: { fullChainOk: boolean; items: unknown[] } };
    expect(sawServiceToken).toBe("svc-tok"); // SERVICE_TOKEN 透传（R8）
    expect(ok.scaffoldReceipt?.fullChainOk).toBe(true);
    expect((ok.scaffoldReceipt?.items.length ?? 0)).toBeGreaterThan(0);
    expect(ok.status).toBe("SUCCEEDED");

    // B 栈断链 → fullChainOk=false → StoryBuildRun 终态 FAILED（A 数据虽建，全链未闭 = 跨系统 HARD 门）
    chainOk = false;
    const broken = (await (await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: SCRIPT, seed: 32 } })).json()) as StoryRunResp & { scaffoldReceipt?: { fullChainOk: boolean } };
    expect(broken.scaffoldReceipt?.fullChainOk).toBe(false);
    expect(broken.status).toBe("FAILED");
  });

  it("SBR5 (g8-P6): 存量回填 —— 逆向导出推演能力为故事脚本 → 逐条建域补血缘 + 压测报告", async () => {
    const t = await makeApp();
    const res = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/backfill", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const report = res.json() as { total: number; succeeded: number; failed: number; runs: { key: string; runId: string; status: string }[] };
    // 覆盖既有推演能力（风险推演 affected_orders + 产能推演 capacity_forecast = 推演与风险 + 规划与平衡）
    expect(report.total).toBeGreaterThanOrEqual(2);
    expect(report.runs.map((r) => r.key)).toContain("affected_orders");
    expect(report.runs.map((r) => r.key)).toContain("capacity_forecast");
    // 压测：全部建域成功（覆盖率 = succeeded/total）
    expect(report.succeeded).toBe(report.total);
    // 每个存量推演能力获得 StoryBuildRun 血缘（可从历史推演记录下钻）
    const runs = (await (await t.app.inject({ method: "GET", url: "/a/v1/databuilder/runs", headers: ADMIN })).json()) as { id: string; buildPlan?: { objectTypes: unknown[] } }[];
    for (const r of report.runs) {
      const sbr = runs.find((x) => x.id === r.runId);
      expect(sbr?.buildPlan?.objectTypes.length).toBeGreaterThan(0); // 有图谱血缘
    }
  });

  it("SBR6 (g8-P4): 功能缺失自检 GapReport（干净建域 → ANSWERABLE 0 缺口）+ 压测覆盖率", async () => {
    const t = await makeApp();
    // 干净建域 → 自检 ANSWERABLE、零缺口
    const ok = (await (await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: SCRIPT, seed: 41 } })).json()) as StoryRunResp & { gapReport?: { verdict: string; findings: unknown[] } };
    expect(ok.gapReport?.verdict).toBe("ANSWERABLE");
    expect(ok.gapReport?.findings.length).toBe(0);

    // 压测：跑一组脚本 → 覆盖率/失败率统计
    const stress = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/stress", headers: ADMIN, payload: { scripts: ["针对订单做风险推演分析", "针对基地做产能推演分析"], seed: 7 } });
    expect(stress.statusCode).toBe(200);
    const report = stress.json() as { total: number; succeeded: number; failed: number };
    expect(report.total).toBe(2);
    expect(report.succeeded + report.failed).toBe(2);
  });

  it("SBR7 (g8-P5): 故事脚本自动生成器 + 推演回填（inference → answer）", async () => {
    const t = await makeApp();
    // 自动生成器：从能力目录派生候选脚本（求解器覆盖 + 规则覆盖）
    const gen = (await (await t.app.inject({ method: "GET", url: "/a/v1/databuilder/generate-scripts", headers: ADMIN })).json()) as { key: string; script: string }[];
    expect(gen.length).toBeGreaterThanOrEqual(2);
    expect(gen.map((g) => g.key)).toContain("affected_orders");
    expect(gen.every((g) => typeof g.script === "string" && g.script.length > 0)).toBe(true);

    // 推演回填：inference=true → 建域后跑求解器 → answer 摘要
    const run = (await (await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: SCRIPT, seed: 51, inference: true } })).json()) as StoryRunResp & { answer?: string };
    expect(run.status).toBe("SUCCEEDED");
    expect(typeof run.answer).toBe("string");
    expect(run.answer!.length).toBeGreaterThan(0); // 含求解器推演摘要

    // 不带 inference → 无 answer（默认快路径）
    const noInf = (await (await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: SCRIPT, seed: 52 } })).json()) as StoryRunResp & { answer?: string };
    expect(noInf.answer).toBeUndefined();
  });

  it("SBR3 (g8-P2): stage=manifest → 倒推补录表单（PENDING_INPUT，未建域）→ PATCH inputs 续跑建域", async () => {
    const t = await makeApp();
    // ① 倒推：返回 InputManifest（STORY 抽取 + ASK_USER seed + REUSE_EXISTING 连接器），状态 PENDING_INPUT
    const m = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: SCRIPT, stage: "manifest" } });
    expect(m.statusCode).toBe(201);
    const pending = m.json() as StoryRunResp & { inputManifest?: { fields: { key: string; source: string }[] } };
    expect(pending.status).toBe("PENDING_INPUT");
    const fields = pending.inputManifest?.fields ?? [];
    expect(fields.some((f) => f.key === "seed" && f.source === "ASK_USER")).toBe(true);
    expect(fields.some((f) => f.source === "STORY")).toBe(true); // 脚本抽取的对象类型
    expect(fields.some((f) => f.key === "reuseConnectors" && f.source === "REUSE_EXISTING")).toBe(true);
    // 未建域：此刻还没有产物
    expect(pending.producedDatasets.length).toBe(0);

    // ② 补录 seed → 续跑建域，同一条记录转 SUCCEEDED 且产出源数据
    const patched = await t.app.inject({ method: "PATCH", url: `/a/v1/databuilder/runs/${pending.id}/inputs`, headers: ADMIN, payload: { inputs: { seed: 21 } } });
    expect(patched.statusCode).toBe(201);
    const done = patched.json() as StoryRunResp;
    expect(done.id).toBe(pending.id);
    expect(done.status).toBe("SUCCEEDED");
    expect(done.closureReport?.gatePassed).toBe(true);
    expect(done.producedDatasets.length).toBeGreaterThan(0);
  });
});
