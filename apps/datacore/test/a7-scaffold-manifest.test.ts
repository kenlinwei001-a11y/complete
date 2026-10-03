import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";
import { BuildPlanSchema, type ScaffoldManifest, type ScaffoldReceipt } from "@platform/contracts";
import { buildScaffoldManifestRecord } from "../src/databuilder/scaffold-manifest.js";

const SCRIPT = "常州基地产能紧张，影响订单交期与客户信用，请做风险推演";

/** 把 A→B 下发的 manifest 全部回执为 SCAFFOLDED（模拟 B 在线幂等对账）。 */
function scaffoldAll(m: ScaffoldManifest): ScaffoldReceipt {
  const items: ScaffoldReceipt["items"] = [];
  for (const n of m.intentNeeds) items.push({ kind: "intent", key: n.intentKey, status: "SCAFFOLDED" });
  for (const n of m.planNeeds) items.push({ kind: "plan", key: n.planKey, status: "SCAFFOLDED" });
  for (const n of m.workflowNeeds) items.push({ kind: "workflow", key: n.workflowKey, status: "SCAFFOLDED" });
  for (const n of m.skillNeeds) items.push({ kind: "skill", key: n.skillKey, status: "SCAFFOLDED" });
  for (const n of m.agentNeeds) items.push({ kind: "agent", key: n.agentKey, status: "REUSED" });
  for (const n of m.sceneNeeds) items.push({ kind: "scene", key: n.scenarioKey, status: "SCAFFOLDED" });
  return { items, fullChainOk: true };
}

describe("A7 · buildScaffoldManifestRecord 确定性（L0）", () => {
  const plan = BuildPlanSchema.parse({
    id: "bpl_a7", tenantId: "demo", builderKey: "test", scriptHash: "h", seed: 1, script: "",
    dataSources: [], objectTypes: [], rules: [], kbDocs: [], createdAt: "2026-01-01",
    solverNeeds: [{ solverKey: "affected_orders", inputFields: [] }],
    agentNeeds: [{ agentKey: "agt_affected_orders", systemPrompt: "瓶颈诊断", tools: ["affected_orders"], skills: [], ruleBindings: [], scopeObjectTypes: ["Order"] }],
    planNeeds: [{ planKey: "plan_affected_orders", steps: ["invoke_solver"], solverKey: "affected_orders", args: {}, renderBindings: [] }],
    intentNeeds: [{ intentKey: "intent_affected_orders", triggers: [], slots: [], riskLevel: "LOW" }],
  });

  it("无 receipt（单机/未配 B）→ 每项 PENDING_BSTACK，pendingBstack=true，fullChainOk=false（SOFT）", () => {
    const m = buildScaffoldManifestRecord("sbr_1", plan)!;
    expect(m.items.length).toBe(3); // agent + plan + intent
    expect(m.items.every((i) => i.status === "PENDING_BSTACK")).toBe(true);
    expect(m.pendingBstack).toBe(true);
    expect(m.fullChainOk).toBe(false);
    // 定义可看（"看得到这个 agent 是什么"）
    const agent = m.items.find((i) => i.module === "agent")!;
    expect(agent.definition.systemPrompt).toBe("瓶颈诊断");
    expect(agent.definition.tools).toEqual(["affected_orders"]);
  });

  it("receipt 在线 → 按 (kind,key) 覆盖 SCAFFOLDED/REUSED，pendingBstack=false，fullChainOk=true（HARD）", () => {
    const receipt: ScaffoldReceipt = {
      items: [
        { kind: "agent", key: "agt_affected_orders", status: "REUSED" },
        { kind: "plan", key: "plan_affected_orders", status: "SCAFFOLDED" },
        { kind: "intent", key: "intent_affected_orders", status: "SCAFFOLDED" },
      ],
      fullChainOk: true,
    };
    const m = buildScaffoldManifestRecord("sbr_1", plan, receipt)!;
    expect(m.pendingBstack).toBe(false);
    expect(m.fullChainOk).toBe(true);
    expect(m.items.find((i) => i.module === "agent")!.status).toBe("REUSED");
    expect(m.reconciledAt).toBeTruthy();
  });

  it("无 B 栈需求 → undefined（无清单可记）", () => {
    const bare = BuildPlanSchema.parse({ id: "b", tenantId: "demo", builderKey: "t", scriptHash: "h", seed: 1, script: "", dataSources: [], objectTypes: [], rules: [], kbDocs: [], createdAt: "2026-01-01", solverNeeds: [] });
    expect(buildScaffoldManifestRecord("sbr_1", bare)).toBeUndefined();
  });

  it("R6：同 plan 重建结构一致（忽略时间戳）", () => {
    const a = buildScaffoldManifestRecord("sbr_1", plan)!;
    const b = buildScaffoldManifestRecord("sbr_1", plan)!;
    expect(a.items).toEqual(b.items);
  });
});

describe("A7 · 单机可见 + B 上线幂等对账（L1，真服务）", () => {
  it("不配 AGENTCORE_BASE_URL 建域：scaffoldManifest 落库（全 PENDING_BSTACK）+ /scaffold-manifest 可浏览 + 事件", async () => {
    const t: TestApp = await makeApp();
    const run = (await (await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: SCRIPT, seed: 31 } })).json()) as { id: string; status: string; scaffoldManifest?: { items: { status: string }[]; pendingBstack: boolean } };
    expect(run.status).toBe("SUCCEEDED");
    // 单机也看得到倒推出的 B 栈制品（不依赖 B 在线）
    expect(run.scaffoldManifest).toBeTruthy();
    expect(run.scaffoldManifest!.items.length).toBeGreaterThan(0);
    expect(run.scaffoldManifest!.pendingBstack).toBe(true);
    expect(run.scaffoldManifest!.items.every((i) => i.status === "PENDING_BSTACK")).toBe(true);

    // 浏览端点
    const mf = await t.app.inject({ method: "GET", url: `/a/v1/databuilder/runs/${run.id}/scaffold-manifest`, headers: ADMIN });
    expect(mf.statusCode).toBe(200);
    expect((mf.json() as { items: unknown[] }).items.length).toBeGreaterThan(0);

    // 事件 scaffold.manifest_recorded 入 outbox
    const events = await t.repos.outboxEvents.list("demo", (e) => e.event === "scaffold.manifest_recorded");
    expect(events.length).toBeGreaterThan(0);

    // 未配 B → reconcile 显式报错（不静默）
    const noClient = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/reconcile-scaffold", headers: ADMIN });
    expect(noClient.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("B 上线幂等对账：注入 scaffold client → reconcile 升 SCAFFOLDED/REUSED + fullChainOk HARD；二次对账幂等空", async () => {
    const t: TestApp = await makeApp();
    await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: SCRIPT, seed: 33 } });

    // 模拟 B 上线：注入 scaffold client（全 SCAFFOLDED/REUSED）
    t.services.databuilder.setScaffoldClient(async (m) => scaffoldAll(m));

    const r1 = (await (await t.app.inject({ method: "POST", url: "/a/v1/databuilder/reconcile-scaffold", headers: ADMIN })).json()) as { reconciled: string[]; stillPending: string[] };
    expect(r1.reconciled.length).toBe(1);
    expect(r1.stillPending.length).toBe(0);

    // 对账后 manifest 升级
    const runs = (await (await t.app.inject({ method: "GET", url: "/a/v1/databuilder/runs", headers: ADMIN })).json()) as { id: string; scaffoldManifest?: { pendingBstack: boolean; fullChainOk: boolean } }[];
    const reconciledRun = runs.find((x) => x.scaffoldManifest);
    expect(reconciledRun!.scaffoldManifest!.pendingBstack).toBe(false);
    expect(reconciledRun!.scaffoldManifest!.fullChainOk).toBe(true);

    // 幂等：再对账 → 无 pending → reconciled 空
    const r2 = (await (await t.app.inject({ method: "POST", url: "/a/v1/databuilder/reconcile-scaffold", headers: ADMIN })).json()) as { reconciled: string[] };
    expect(r2.reconciled.length).toBe(0);

    // 对账事件
    const events = await t.repos.outboxEvents.list("demo", (e) => e.event === "scaffold.reconciled");
    expect(events.length).toBe(1);
  });
});
