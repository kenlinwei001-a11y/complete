import { describe, expect, it } from "vitest";
import { ClosurePolicySchema, type BuildPlan } from "@platform/contracts";
import { validateClosure } from "../src/databuilder/closure.js";
import { makeApp, ADMIN } from "./helpers.js";

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

  it("未声明输出形状的求解器 → SHAPE 跳过（ORPHAN_PASSED，不阻塞，渐进补齐）", () => {
    const r = validateClosure({ ...base, solverNeeds: [{ solverKey: "affected_orders", inputFields: [], renderBindings: ["rows", "summary"] }] }, policy);
    expect(r.shapeBroken).toBe(0);
    expect(r.gatePassed).toBe(true);
    expect(r.findings.some((f) => f.kind === "SHAPE" && f.status === "ORPHAN_PASSED")).toBe(true);
  });

  it("无 renderBindings → 不产生 SHAPE 校验（向后兼容）", () => {
    const r = validateClosure({ ...base, solverNeeds: [{ solverKey: "capacity_forecast", inputFields: [] }] }, policy);
    expect(r.findings.some((f) => f.kind === "SHAPE")).toBe(false);
    expect(r.shapeBroken).toBe(0);
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
