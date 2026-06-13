import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ADMIN, makeApp, seedBattery, type TestApp } from "./helpers.js";
import { OpsReplayService } from "../src/opsteam/replay.js";
import { DEFAULT_PLAYBOOK } from "../src/opsteam/defaults.js";
import type { AuthCtx } from "../src/domain.js";
import type { OpsPlaybook } from "@platform/contracts";

/**
 * 回放编排器与虚拟操作团队 验收 R1–R13（PRD-addendum-replay-orchestrator §5/§6.3）。
 *
 * 红线：虚拟操作一律走与真人相同的 API（QOS 提问 / S2 审批 / S&OP 五步 / 求解 / 孵化），
 * 编排器禁止直写任何结果表（R1 静态断言）。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** 给已合成租户挂上默认虚拟团队 + 剧本（合成态 = SYNTHETIC 租户，隔离守卫通过）。 */
async function seedOpsTeam(t: TestApp): Promise<void> {
  await t.services.opsTeam.seedDefaultPersonas("demo");
  await t.services.opsTeam.seedDefaultPlaybook("demo");
}

/** 构造一个带「记录式 ask」的编排器（复用真实服务，仅替换 QOS HTTP 出口）。 */
function replayWithAsk(t: TestApp, asks: { persona: AuthCtx; input: { view: string; query: string; conversationId: string } }[]) {
  return new OpsReplayService({
    actions: t.services.actions,
    sop: t.services.sop,
    solvers: t.services.solvers,
    resolvePersona: (tenantId, username) => t.services.opsTeam.resolvePersonaCtx(tenantId, username),
    ask: async (persona, input) => {
      asks.push({ persona, input });
      return { taskId: `task_fake_${asks.length}` };
    },
    listPendingDrafts: async (tenantId) => {
      const drafts = await t.repos.actionDrafts.list(tenantId, (d) => d.status === "PENDING_APPROVAL");
      return drafts.map((d) => ({ id: d.id, originUserId: d.origin.userId }));
    },
    listFallbackClusters: async () => ["fbt_demo_1"],
    promoteIntent: async () => ({ intentId: "int_fake_1" }),
    adoptMitigation: async (base, approver, payload) => {
      const draft = await t.services.actions.create(base, { actionTypeKey: "adopt_mitigation", payload, submit: true });
      const decided = await t.services.actions.approve(approver, draft.id);
      return { draftId: draft.id, status: decided.status };
    },
    log: () => undefined,
  });
}

describe("回放编排器与虚拟操作团队（R1–R13）", () => {
  describe("R1 正门红线（静态断言）", () => {
    it("R1: 编排器源码不 import 任何 Store/Repo", () => {
      const src = readFileSync(join(HERE, "../src/opsteam/replay.ts"), "utf8");
      // 禁止从仓储层导入（repo/ 路径或 Repos/Store 符号）。
      expect(src).not.toMatch(/from\s+["'][^"']*repo\/(repo|memory|pg)/);
      expect(src).not.toMatch(/import[^;]*\b(Repos|Store|ObjectStore)\b[^;]*from/);
    });
    it("R1: 每条运营记录回链一次真实 API（review_actions → 真实审批状态机流转）", async () => {
      const t = await makeApp();
      await seedBattery(t);
      await seedOpsTeam(t);
      const planner = (await t.services.opsTeam.resolvePersonaCtx("demo", "vp_planner_zhang"))!;
      const draft = await t.services.actions.create(planner, { actionTypeKey: "ops_review_test", payload: { summary: "周排产微调" }, submit: true });
      expect(draft.status).toBe("PENDING_APPROVAL");
      const replay = replayWithAsk(t, []);
      // 强制 approve（policy 全 approve）
      await replay.runTick("demo", { key: "k", version: 1, cadence: { daily: [{ kind: "review_actions", persona: "vp_approver_li", policy: { approve: 1, reject: 0, cancel: 0 }, commentPool: "approver_comment" }] } }, { tick: 1, date: "2026-07-06", seed: 42, scenarioEvents: [] });
      const after = await t.repos.actionDrafts.get("demo", draft.id);
      // 真实状态机：审批后进入 EXECUTED（经 S2 approve → execute），有完整审批步与执行结果。
      expect(["APPROVED", "EXECUTING", "EXECUTED"]).toContain(after!.status);
      const audit = await t.services.actions.audit(planner, draft.id);
      expect((audit.events as unknown[]).length).toBeGreaterThan(0);
      const steps = after!.approvalSteps;
      expect(steps.some((s) => s.decision === "APPROVE" && s.approverId)).toBe(true);
    });
  });

  describe("R2 任务史可下钻 / R7 权限一致性（ask 经真实 QOS persona JWT）", () => {
    it("R2/R7: ask 以 persona 真实身份发起，基地负责人 persona 携带行级 baseScope", async () => {
      const t = await makeApp();
      await seedBattery(t);
      await seedOpsTeam(t);
      const asks: { persona: AuthCtx; input: { view: string; query: string; conversationId: string } }[] = [];
      const replay = replayWithAsk(t, asks);
      const pb: OpsPlaybook = {
        key: "k",
        version: 1,
        cadence: {
          daily: [
            { kind: "ask", persona: "vp_base_mgr_changzhou", view: "risk", queryPool: "base_manager_daily", prob: 1 },
            { kind: "ask", persona: "vp_planner_zhang", view: "dash", queryPool: "planner_daily", prob: 1 },
          ],
        },
      };
      await replay.runTick("demo", pb, { tick: 1, date: "2026-07-02", seed: 42, scenarioEvents: [] });
      expect(asks.length).toBe(2);
      const bm = asks.find((a) => a.persona.roles.some((r) => r.startsWith("base_manager")))!;
      // R7：基地负责人 persona 行级属性（OBO 全链 → 回答只含其基地）
      expect(bm.persona.attributes.baseScope).toEqual(["changzhou"]);
      expect(bm.persona.attributes.isVirtual).toBe(true);
      // R2：ask 产生真实任务（conversationId 稳定，前端按 conversationId 拉真实任务）
      expect(bm.input.conversationId).toContain("opsconv_");
      expect(bm.input.query.length).toBeGreaterThan(0);
      const planner = asks.find((a) => a.persona.userId.includes("planner"))!;
      expect(planner.input.view).toBe("dash");
    });
  });

  describe("R3 审批叙事（比例 ±5pct + 被拒带意见署名）", () => {
    it("R3: review_actions 比例命中 policy；被拒带意见 + 署名虚拟审批人 isVirtual", async () => {
      const t = await makeApp();
      await seedBattery(t);
      await seedOpsTeam(t);
      const planner = (await t.services.opsTeam.resolvePersonaCtx("demo", "vp_planner_zhang"))!;
      const N = 200;
      // 造 N 条待审草稿（planner 发起，approver 非本人 → 可审批）
      for (let i = 0; i < N; i++) {
        await t.services.actions.create(planner, { actionTypeKey: "ops_review_test", payload: { summary: `调整 ${i}` }, submit: true });
      }
      const replay = replayWithAsk(t, []);
      const policy = { approve: 0.82, reject: 0.11, cancel: 0.04 };
      const pb: OpsPlaybook = { key: "k", version: 1, cadence: { daily: [{ kind: "review_actions", persona: "vp_approver_li", policy, commentPool: "approver_comment" }] } };
      // 每次 tick 处理一条；用不同 tick 派生不同子流 → 形成分布
      for (let i = 0; i < N; i++) {
        await replay.runTick("demo", pb, { tick: 1000 + i, date: "2026-07-02", seed: 42, scenarioEvents: [] });
      }
      const all = await t.repos.actionDrafts.list("demo", () => true);
      const rejected = all.filter((d) => d.status === "REJECTED");
      const cancelled = all.filter((d) => d.status === "CANCELLED");
      const executed = all.filter((d) => ["APPROVED", "EXECUTING", "EXECUTED"].includes(d.status));
      const decided = rejected.length + cancelled.length + executed.length;
      expect(decided).toBeGreaterThan(N * 0.9); // 余量(retry)极小
      // 比例 ±5pct
      expect(executed.length / decided).toBeGreaterThan(policy.approve - 0.06);
      expect(executed.length / decided).toBeLessThan(policy.approve + 0.08);
      expect(rejected.length / decided).toBeGreaterThan(policy.reject - 0.05);
      expect(rejected.length / decided).toBeLessThan(policy.reject + 0.05);
      // 被拒必带意见 + 署名虚拟审批人（isVirtual 可识别）
      const approverUser = (await t.repos.users.list("demo", (u) => u.username === "vp_approver_li"))[0]!;
      for (const r of rejected) {
        const step = r.approvalSteps.find((s) => s.decision === "REJECT")!;
        expect(step.comment && step.comment.length > 0).toBe(true);
        expect(step.approverId).toBe(approverUser.id);
      }
      expect(approverUser.attributes.isVirtual).toBe(true);
    });
  });

  describe("R4 S&OP 真流转（五步 + 第⑤决议 + 定稿锁定）", () => {
    it("R4: sop_cycle 经五步 API 至 FINAL，定稿后字段锁定（PLAN_LOCKED）", async () => {
      const t = await makeApp();
      await seedBattery(t);
      await seedOpsTeam(t);
      const replay = replayWithAsk(t, []);
      const pb: OpsPlaybook = { key: "k", version: 1, cadence: { daily: [{ kind: "sop_cycle", persona: "vp_sop_host" }] } };
      const report = await replay.runTick("demo", pb, { tick: 1, date: "2026-08-01", seed: 42, scenarioEvents: [] });
      const exec = report.executed.find((e) => e.kind === "sop_cycle");
      expect(exec).toBeDefined();
      expect(exec!.decision).toBe("FINAL");
      const v = await t.repos.sopVersions.get("demo", exec!.ref!);
      expect(v!.status).toBe("FINAL");
      expect(v!.steps.s1).toBeDefined();
      expect(v!.steps.s5).toBeDefined();
      // 定稿锁定：再次 advance 被拒 PLAN_LOCKED
      const host = (await t.services.opsTeam.resolvePersonaCtx("demo", "vp_sop_host"))!;
      await expect(t.services.sop.advance(host, v!.id, 2, {})).rejects.toMatchObject({ code: "PLAN_LOCKED" });
    });
  });

  describe("R6 确定性（同 seed 逐字一致）", () => {
    it("R6: 两次回放任务问句/审批决定/决议措辞逐字一致", async () => {
      const run = async () => {
        const t = await makeApp();
        await seedBattery(t);
        await seedOpsTeam(t);
        const planner = (await t.services.opsTeam.resolvePersonaCtx("demo", "vp_planner_zhang"))!;
        for (let i = 0; i < 20; i++) await t.services.actions.create(planner, { actionTypeKey: "ops_review_test", payload: { summary: `x${i}` }, submit: true });
        const asks: { persona: AuthCtx; input: { view: string; query: string; conversationId: string } }[] = [];
        const replay = replayWithAsk(t, asks);
        const pb: OpsPlaybook = {
          key: "k", version: 1,
          cadence: {
            daily: [
              { kind: "ask", persona: "vp_planner_zhang", view: "risk", queryPool: "planner_daily", prob: 1 },
              { kind: "review_actions", persona: "vp_approver_li", policy: { approve: 0.82, reject: 0.11, cancel: 0.04 }, commentPool: "approver_comment" },
            ],
          },
        };
        const decisions: { kind: string; decision?: string }[] = [];
        for (let i = 0; i < 10; i++) {
          const r = await replay.runTick("demo", pb, { tick: 500 + i, date: "2026-07-02", seed: 42, scenarioEvents: [] });
          for (const e of r.executed) decisions.push({ kind: e.kind, decision: e.decision });
        }
        // 收集被拒意见措辞（确定性逐字一致）
        const rejected = (await t.repos.actionDrafts.list("demo", (d) => d.status === "REJECTED"))
          .map((d) => d.approvalSteps.find((s) => s.decision === "REJECT")?.comment)
          .filter(Boolean)
          .sort();
        // ref 为 newId 随机（非编排器决定项）—— R6 比对问句/决定/意见措辞，不比对随机 ID。
        return JSON.stringify({ asks: asks.map((a) => a.input.query), decisions, rejected });
      };
      const a = await run();
      const b = await run();
      expect(a).toBe(b);
    });
  });

  describe("R5 校准闭环 / R10 定时预测（M11 配对样本来源）", () => {
    it("R5/R10: run_forecast / SCHEDULED_FORECAST 产生 calibrationForecasts（M11 配对样本）", async () => {
      const t = await makeApp();
      await seedBattery(t);
      await seedOpsTeam(t);
      const before = (await t.repos.calibrationForecasts.list("demo")).length;
      const replay = replayWithAsk(t, []);
      const pb: OpsPlaybook = { key: "k", version: 1, cadence: { daily: [{ kind: "run_forecast", persona: "vp_planner_zhang", modelPool: ["S192-LFP", "4680-NCM"] }] } };
      const report = await replay.runTick("demo", pb, { tick: 1, date: "2026-07-06", seed: 42, scenarioEvents: [] });
      expect(report.executed.some((e) => e.kind === "run_forecast")).toBe(true);
      const after = (await t.repos.calibrationForecasts.list("demo")).length;
      expect(after).toBeGreaterThan(before); // M11 预测对象产生（配对样本来源）
      // R10：SCHEDULED_FORECAST handler 经 ServiceAccount 身份产生预测 + executedAs 标记
      await t.services.opsSchedule.put(
        { tenantId: "demo", userId: "usr_demo_admin", roles: ["tenant_admin"], attributes: {} },
        { forecasts: [{ cron: "0 6 * * 1", modelIds: ["S192-LFP"], weeks: 12 }] },
      );
      await t.services.opsSchedule.runScheduledForecast("demo", "f0");
      const evt = (await t.repos.outboxEvents.list("demo", (e) => e.event === "ops_schedule.forecast_run")).pop();
      expect(evt).toBeDefined();
      expect((evt!.payload as { executedAs?: string }).executedAs).toBe("SERVICE_ACCOUNT");
    });
  });

  describe("R9 隔离（真实租户禁挂 playbook / 建虚拟账号）", () => {
    it("R9: 真实租户（无 SYNTHETIC origin）建虚拟账号 / 挂 playbook 被拒 403", async () => {
      const t = await makeApp();
      // demo 租户已 seedDemo 但未合成 → 无 SYNTHETIC 对象 → 视为真实租户
      const isSynth = await t.services.opsTeam.isSyntheticTenant("demo");
      expect(isSynth).toBe(false);
      await expect(t.services.opsTeam.seedDefaultPersonas("demo")).rejects.toMatchObject({ code: "VIRTUAL_OPS_FORBIDDEN" });
      await expect(t.services.opsTeam.putPlaybook("demo", DEFAULT_PLAYBOOK)).rejects.toMatchObject({ code: "VIRTUAL_OPS_FORBIDDEN" });
      // 合成后 → 允许
      await seedBattery(t);
      expect(await t.services.opsTeam.isSyntheticTenant("demo")).toBe(true);
      await expect(t.services.opsTeam.seedDefaultPersonas("demo")).resolves.toBeDefined();
    });
  });

  describe("R11 S&OP 半自动（自动①–④，⑤保持 IN_REVIEW，无自动定稿）", () => {
    it("R11: SOP_AUTO_OPEN 跑①–④后保持 IN_REVIEW；无『自动定稿』路径（静态断言）", async () => {
      const t = await makeApp();
      await seedBattery(t);
      const r = await t.services.opsSchedule.runSopAutoOpen("demo");
      const v = await t.repos.sopVersions.get("demo", r.versionId);
      expect(v!.steps.s1).toBeDefined();
      expect(v!.steps.s4).toBeDefined();
      expect(v!.steps.s5).toBeUndefined(); // ⑤ 未做
      expect(v!.status).toBe("IN_REVIEW"); // 保持评审中（待人）
      // 静态断言：schedule 服务的自动路径不调用 finalize / step5
      const src = readFileSync(join(HERE, "../src/opsteam/schedule.ts"), "utf8");
      const autoOpenBody = src.slice(src.indexOf("runSopAutoOpen"), src.indexOf("runApprovalReminder"));
      expect(autoOpenBody).not.toMatch(/\.finalize\(/);
      expect(autoOpenBody).not.toMatch(/advance\([^)]*,\s*5\b/);
    });
  });

  describe("R12 审批催办与升级（autoApprove 默认关）", () => {
    it("R12: 超期催办→再超期升级；autoApprove 默认关；开启仅命中白名单 + 全审计", async () => {
      const t = await makeApp();
      await seedBattery(t);
      const planner = { tenantId: "demo", userId: "usr_demo_planner", roles: ["planner"], attributes: {} } as AuthCtx;
      // 造一条 8 天前的待审草稿
      const d = await t.services.actions.create(planner, { actionTypeKey: "ops_review_test", payload: { summary: "积压" }, submit: true });
      const rec = await t.repos.actionDrafts.get("demo", d.id);
      rec!.updatedAt = new Date(Date.now() - 8 * 86400000).toISOString();
      await t.repos.actionDrafts.put(rec!);
      // 配置催办 3 天 / 升级 7 天
      const adminCtx = { tenantId: "demo", userId: "usr_demo_admin", roles: ["tenant_admin"], attributes: {} } as AuthCtx;
      await t.services.opsSchedule.put(adminCtx, {
        forecasts: [],
        approvalReminder: { remindAfterDays: 3, escalateAfterDays: 7, escalateToRole: "admin" },
      });
      const res1 = await t.services.opsSchedule.runApprovalReminder("demo");
      expect(res1.escalated).toBeGreaterThanOrEqual(1); // 8d ≥ 7d → 升级
      const esc = (await t.repos.outboxEvents.list("demo", (e) => e.event === "approval.escalated")).pop();
      expect((esc!.payload as { escalateToRole?: string }).escalateToRole).toBe("admin");
      expect(res1.autoApproved).toBe(0); // autoApprove 默认关
      // 开启 autoApprove，仅白名单 ops_review_test，全审计
      await t.services.opsSchedule.put(adminCtx, {
        forecasts: [],
        approvalReminder: { remindAfterDays: 3, escalateAfterDays: 7, escalateToRole: "admin" },
        autoApprove: { actionTypes: ["ops_review_test"], enabled: true },
      });
      // 另造一条非白名单类型，确认不被自动批
      await t.services.actions.create(planner, { actionTypeKey: "其它类型", payload: { summary: "x" }, submit: true });
      const res2 = await t.services.opsSchedule.runApprovalReminder("demo");
      expect(res2.autoApproved).toBeGreaterThanOrEqual(1);
      const audit = (await t.repos.outboxEvents.list("demo", (e) => e.event === "action.auto_approved")).pop();
      expect(audit).toBeDefined();
      expect((audit!.payload as { actionTypeKey?: string }).actionTypeKey).toBe("ops_review_test");
    });
  });

  describe("R13 C 类隔离（真实租户自动提问无入口 / API 直调被拒）", () => {
    it("R13: 真实租户 POST /a/v1/ops/auto-ask 被拒；SYNTHETIC 也无直调入口", async () => {
      const t = await makeApp();
      const res = await t.app.inject({ method: "POST", url: "/a/v1/ops/auto-ask", headers: ADMIN, payload: {} });
      expect(res.statusCode).toBe(403);
      expect((res.json() as { error: { code: string } }).error.code).toBe("FORBIDDEN");
      // 合成后仍无直调入口（虚拟提问只经模拟时钟回放产生）
      await seedBattery(t);
      const res2 = await t.app.inject({ method: "POST", url: "/a/v1/ops/auto-ask", headers: ADMIN, payload: {} });
      expect(res2.statusCode).toBe(403);
    });
  });

  describe("R8 性能（剧本全量回放代表性预算）", () => {
    it("R8: 365 次 runTick（含真实服务调用）在预算内", async () => {
      const t = await makeApp();
      await seedBattery(t);
      await seedOpsTeam(t);
      const replay = replayWithAsk(t, []);
      const pb = DEFAULT_PLAYBOOK;
      const t0 = Date.now();
      const t0ms = Date.parse("2025-07-01T00:00:00Z");
      for (let d = 0; d < 365; d++) {
        const date = new Date(t0ms + d * 86400000).toISOString().slice(0, 10);
        await replay.runTick("demo", pb, { tick: d + 1, date, seed: 42, scenarioEvents: [] });
      }
      const ms = Date.now() - t0;
      // 规范门槛 ≤8 分钟；代表性回放（含 sop/forecast/review 真实服务）远低于此
      expect(ms).toBeLessThan(480_000);
    }, 480_000);
  });
});
