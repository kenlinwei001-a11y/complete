import { describe, expect, it } from "vitest";
import {
  ACTION_TYPE_DEFAULT_VERSION,
  ActionDraftSchema,
  ActionTypeSchema,
  actionTypeVersionOf,
} from "@platform/contracts";
import { makeApp } from "./helpers.js";
import { createMemoryRepos } from "../src/repo/memory.js";
import { GlobalSimPlanExecutor, MockActionExecutor, describeActionImpact } from "../src/actions.js";
import { ACTION_METRIC_NAMES } from "../src/metrics.js";
import { BATTERY_ACTION_TYPES } from "../src/synthetic/battery.js";
import type { ActionDraft, ActionTypeRecord, AuthCtx, ObjectInstance, Rule } from "../src/domain.js";

/**
 * ActionType 七要素补全（可演进 · 副作用声明 · 三段埋点）。
 *
 * 三条硬判据，全部是**效果层**断言（不是"函数被调用了"）：
 *  ① 向后兼容：不带任何新字段的旧 ActionType / ActionDraft 仍 parse 通过（additive 硬门）。
 *  ② 回写声明可被程序读取并回答「这个 Action 会写什么」，且**与真执行器逐属性对拍**（SEAM：
 *     声明 × `GlobalSimPlanExecutor` 实写；任一半漂即红）。
 *  ③ 跑一批 Action（成功若干 + 各类失败若干）后 metric 计数**逐格等于预期值**。
 */

// ---------------------------------------------------------------------------
// ① 向后兼容（additive 硬断言）
// ---------------------------------------------------------------------------

/** 本字段出现之前的 ActionType 形状（逐字照抄 v1 契约，禁止后补字段）。 */
const LEGACY_ACTION_TYPE = {
  key: "legacy_type",
  name: "旧动作类型",
  paramsSchema: { type: "object", required: ["reason"], properties: { reason: { type: "string" } } },
  checkRules: [] as string[],
  approvalChain: [{ role: "admin" }],
};

/** 本字段出现之前的 ActionDraft 形状。 */
const LEGACY_ACTION_DRAFT = {
  id: "act_legacy",
  tenantId: "demo",
  actionTypeKey: "legacy_type",
  payload: { reason: "历史记录" },
  origin: { userId: "usr_demo_admin" },
  status: "EXECUTED",
  approvalSteps: [{ seq: 1, role: "admin", decision: "APPROVE", approverId: "usr_demo_approver" }],
  executionResult: { ok: true, targetRef: "MO-2026-1234", attempts: 1 },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("ActionType 可演进 · 向后兼容（additive 硬门）", () => {
  it("旧 ActionType（无 version / 无 effects）仍 parse 通过，且缺省版本 = 1", () => {
    const parsed = ActionTypeSchema.parse(LEGACY_ACTION_TYPE);
    expect(parsed.key).toBe("legacy_type");
    // 新字段确实缺席（不是被 default 悄悄填成必填 → 那会让"旧对象原样存回去"变形）
    expect(parsed.version).toBeUndefined();
    expect(parsed.effects).toBeUndefined();
    // 缺省语义：未标版本 ≡ 第 1 版
    expect(actionTypeVersionOf(parsed)).toBe(1);
    expect(ACTION_TYPE_DEFAULT_VERSION).toBe(1);
    expect(actionTypeVersionOf(undefined)).toBe(1);
  });

  it("平台现存 12 个内置 ActionType（真注册数据）全部 parse 通过——现存数据不被收紧打死", () => {
    expect(BATTERY_ACTION_TYPES.length).toBe(12);
    for (const t of BATTERY_ACTION_TYPES) {
      const parsed = ActionTypeSchema.parse(t);
      expect(parsed.key).toBe(t.key);
      expect(parsed.version).toBeUndefined(); // 内置类型尚未标版 → 一律解释为 v1
      expect(actionTypeVersionOf(parsed)).toBe(1);
    }
  });

  it("旧 ActionDraft（无 actionTypeVersion）仍 parse 通过", () => {
    const parsed = ActionDraftSchema.parse(LEGACY_ACTION_DRAFT);
    expect(parsed.id).toBe("act_legacy");
    expect(parsed.actionTypeVersion).toBeUndefined();
    expect(actionTypeVersionOf({ version: parsed.actionTypeVersion })).toBe(1);
  });

  it("带新字段的 ActionType 也 parse 通过（新旧并存）", () => {
    const parsed = ActionTypeSchema.parse({
      ...LEGACY_ACTION_TYPE,
      version: 2,
      effects: { writes: [{ objectType: "Order", op: "UPDATE", properties: ["status"] }], coverage: "COMPLETE" },
    });
    expect(parsed.version).toBe(2);
    expect(actionTypeVersionOf(parsed)).toBe(2);
    expect(parsed.effects?.coverage).toBe("COMPLETE");
    expect(parsed.effects?.undeclared).toEqual([]); // 未给 → default []
  });
});

// ---------------------------------------------------------------------------
// ② 回写声明：可被程序读取 · 与真执行器对拍
// ---------------------------------------------------------------------------

describe("ActionType 回写声明 · 可读且能回答「这个 Action 会写什么」", () => {
  it("注册在类型上的 effects 被读出为结构化写目标（不是自由文本）", async () => {
    const t = await makeApp();
    const ctx = t.adminCtx;
    await t.services.actions.registerType(ctx, {
      key: "fx_declared",
      name: "带回写声明的动作",
      version: 4,
      paramsSchema: { type: "object" },
      checkRules: [],
      approvalChain: [{ role: "admin" }],
      effects: {
        coverage: "COMPLETE",
        writes: [
          { objectType: "Order", op: "UPDATE", properties: ["status", "qty"], cardinality: "ONE" },
          {
            objectType: "WorkOrder",
            op: "CREATE",
            properties: ["woId", "baseId"],
            cardinality: "MANY",
            condition: { payloadPath: "source", equals: "global-sim" },
          },
        ],
        undeclared: [],
      },
    } as Omit<ActionTypeRecord, "id" | "tenantId">);

    const impact = await t.services.actions.describeImpact(ctx, "fx_declared");
    expect(impact.version).toBe(4);
    expect(impact.coverage).toBe("COMPLETE");
    // 确定性排序 + 逐字段可读（Agent/影响分析据此回答"批准会动到什么"）
    expect(impact.writes).toEqual([
      { objectType: "Order", op: "UPDATE", properties: ["qty", "status"], conditional: false },
      { objectType: "WorkOrder", op: "CREATE", properties: ["baseId", "woId"], conditional: true },
    ]);
  });

  it("未声明 effects 的类型诚实返回 coverage=NONE + 空写目标（不知道 ≠ 无副作用）", async () => {
    const t = await makeApp();
    const ctx = t.adminCtx;
    await t.services.actions.registerType(ctx, {
      key: "fx_silent",
      name: "未声明回写的动作",
      paramsSchema: { type: "object" },
      checkRules: [],
      approvalChain: [{ role: "admin" }],
    } as Omit<ActionTypeRecord, "id" | "tenantId">);
    const impact = await t.services.actions.describeImpact(ctx, "fx_silent");
    expect(impact.coverage).toBe("NONE");
    expect(impact.writes).toEqual([]);
    expect(impact.version).toBe(ACTION_TYPE_DEFAULT_VERSION);
  });

  it("SEAM：`plan_change`(global-sim) 的声明 × 真执行器实写 —— 逐对象类型逐属性对拍", async () => {
    const repos = createMemoryRepos();
    const tenantId = "demo";
    const seedOrder = async (so: string, homeBase: string): Promise<void> => {
      await repos.objects.put({
        id: `obj_order_${so}`,
        tenantId,
        type: "Order",
        props: { so, status: "OPEN", qty: 100, model: "M1", bases: [homeBase] },
        origin: { type: "SYNTHETIC", jobId: "job_seed" },
      } satisfies ObjectInstance);
    };
    await seedOrder("SO-1", "changzhou"); // home == served base → 不产生调运 leg
    await seedOrder("SO-2", "chengdu"); // home != served base → 产生调运 leg

    const before = new Map<string, string>();
    for (const o of await repos.objects.listByType(tenantId, "Order")) before.set(o.id, JSON.stringify(o.props));

    const draft: ActionDraft = {
      id: "act_seam",
      tenantId,
      actionTypeKey: "plan_change",
      payload: {
        source: "global-sim",
        objective: "max_ontime",
        served: [
          { orderId: "SO-1", base: "changzhou", window: 0, windowStartDay: 0, qty: 40, model: "M1" },
          { orderId: "SO-2", base: "changzhou", window: 1, windowStartDay: 14, qty: 60, model: "M1" },
        ],
        summary: "SEAM",
      },
      origin: { userId: "usr_demo_admin" },
      status: "APPROVED",
      approvalSteps: [],
      createdAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:00.000Z",
    };

    const executor = new GlobalSimPlanExecutor(
      { repos, forecastStart: async () => "2026-06-10" },
      new MockActionExecutor(),
    );
    const res = await executor.execute(draft);
    expect(res.ok).toBe(true);

    // 真执行器实际写了什么：新建对象取全部 props 键，既有对象取"变化的"键。
    const writtenProps = new Map<string, Set<string>>();
    const add = (type: string, keys: string[]): void => {
      const s = writtenProps.get(type) ?? new Set<string>();
      for (const k of keys) s.add(k);
      writtenProps.set(type, s);
    };
    for (const type of ["WorkOrder", "InterBaseTransfer", "Order"]) {
      for (const o of await repos.objects.listByType(tenantId, type)) {
        const prev = before.get(o.id);
        if (prev === undefined) {
          add(type, Object.keys(o.props));
          continue;
        }
        const prevProps = JSON.parse(prev) as Record<string, unknown>;
        const changed = Object.keys(o.props).filter(
          (k) => JSON.stringify(o.props[k]) !== JSON.stringify(prevProps[k]),
        );
        if (changed.length) add(type, changed);
      }
    }
    // 执行器确实动了三类对象（否则下面的"对拍"会变成空对空的假绿）
    expect([...writtenProps.keys()].sort()).toEqual(["InterBaseTransfer", "Order", "WorkOrder"]);
    expect((await repos.objects.listByType(tenantId, "WorkOrder")).length).toBe(2);
    expect((await repos.objects.listByType(tenantId, "InterBaseTransfer")).length).toBe(1);

    // 声明侧（内置登记表，经 describeActionImpact 读出）
    const impact = describeActionImpact("plan_change");
    expect(impact.coverage).toBe("PARTIAL"); // 诚实：runDerivations 二阶写入声明不了
    expect(impact.undeclared.length).toBeGreaterThan(0);
    const declared = new Map(impact.writes.map((w) => [w.objectType, [...w.properties].sort()]));
    expect([...declared.keys()].sort()).toEqual(["InterBaseTransfer", "Order", "WorkOrder"]);
    for (const [type, actualKeys] of writtenProps) {
      expect({ type, props: [...actualKeys].sort() }).toEqual({ type, props: declared.get(type) });
    }
  });
});

// ---------------------------------------------------------------------------
// ③ 三段埋点：计数逐格等于预期
// ---------------------------------------------------------------------------

const asType = (t: Record<string, unknown>): Omit<ActionTypeRecord, "id" | "tenantId"> =>
  t as unknown as Omit<ActionTypeRecord, "id" | "tenantId">;

describe("Action 三段埋点 · 提交/审批/执行 × 成功与分型失败", () => {
  it("跑一批 Action 后，metric 计数逐格等于预期值", async () => {
    const t = await makeApp();
    const actions = t.services.actions;
    const admin: AuthCtx = t.adminCtx; // usr_demo_admin（发起人）
    const planner: AuthCtx = { tenantId: "demo", userId: "usr_demo_planner", roles: ["planner"], attributes: {} };
    const approver: AuthCtx = { tenantId: "demo", userId: "usr_demo_approver", roles: ["admin"], attributes: {} };

    // 一条 BLOCK 规则（payload.risk > 100 即违反）供规则预检拦截用。
    await t.repos.rules.put({
      id: "rule_ctest",
      tenantId: "demo",
      key: "CTEST",
      name: "测试拦截",
      expression: "Test.risk > 100",
      scopeObjectTypes: [],
      severity: "BLOCK",
      origin: { kind: "MANUAL" },
      version: 1,
      status: "PUBLISHED",
    } as unknown as Rule);

    await actions.registerType(admin, asType({
      key: "mx_ok", name: "单步动作", version: 3,
      paramsSchema: { type: "object", required: ["a"], properties: { a: { type: "string" } } },
      checkRules: [], approvalChain: [{ role: "admin" }],
    }));
    await actions.registerType(admin, asType({
      key: "mx_two", name: "两步动作",
      paramsSchema: { type: "object" }, checkRules: [],
      approvalChain: [{ role: "planner" }, { role: "admin" }],
    }));
    await actions.registerType(admin, asType({
      key: "mx_block", name: "规则拦截动作",
      paramsSchema: { type: "object" }, checkRules: ["CTEST"], approvalChain: [{ role: "admin" }],
    }));
    await actions.registerType(admin, asType({
      key: "mx_noapp", name: "无审批人动作",
      paramsSchema: { type: "object" }, checkRules: [], approvalChain: [{ role: "auditor_x" }],
    }));

    const m = actions.metrics;
    const submit = (action_type: string, outcome: string) =>
      m.get(ACTION_METRIC_NAMES.submit, { action_type, outcome });
    const approval = (action_type: string, outcome: string) =>
      m.get(ACTION_METRIC_NAMES.approval, { action_type, outcome });
    const exec = (action_type: string, outcome: string) =>
      m.get(ACTION_METRIC_NAMES.execute, { action_type, outcome });
    const attempt = (action_type: string, outcome: string) =>
      m.get(ACTION_METRIC_NAMES.executeAttempts, { action_type, outcome });

    // ---- 提交段：5 成功 + 4 类失败各 1 ---------------------------------------
    const ok: ActionDraft[] = [];
    for (let i = 0; i < 5; i++) ok.push(await actions.create(admin, { actionTypeKey: "mx_ok", payload: { a: `v${i}` } }));
    const two = await actions.create(admin, { actionTypeKey: "mx_two", payload: {} });

    await expect(actions.create(admin, { actionTypeKey: "mx_ok", payload: {} })).rejects.toThrow(); // 校验失败
    await expect(actions.create(admin, { actionTypeKey: "mx_block", payload: { risk: 999 } })).rejects.toThrow(); // 规则拦截
    await expect(actions.create(admin, { actionTypeKey: "mx_noapp", payload: {} })).rejects.toThrow(); // 无审批人
    await expect(actions.submit(admin, ok[0]!.id)).rejects.toThrow(); // 状态机非法（已 PENDING_APPROVAL）

    expect(submit("mx_ok", "success")).toBe(5);
    expect(submit("mx_two", "success")).toBe(1);
    expect(submit("mx_ok", "validation_failed")).toBe(1);
    expect(submit("mx_block", "rule_blocked")).toBe(1);
    expect(submit("mx_noapp", "no_approver")).toBe(1);
    expect(submit("mx_ok", "invalid_state")).toBe(1);
    // 分型不许糊成一坨：规则拦截绝不计入 validation_failed，反之亦然
    expect(submit("mx_block", "validation_failed")).toBe(0);
    expect(submit("mx_ok", "rule_blocked")).toBe(0);
    expect(submit("mx_ok", "unexpected")).toBe(0);

    // ---- 审批段 --------------------------------------------------------------
    await actions.approve(approver, ok[0]!.id); // 单步 → approved（并自动执行）
    await actions.approve(planner, two.id); // 两步第 1 步 → step_advanced
    await actions.approve(approver, two.id); // 两步第 2 步 → approved（并自动执行）
    await actions.reject(approver, ok[1]!.id, "不批"); // → rejected
    await expect(actions.approve(planner, ok[2]!.id)).rejects.toThrow(); // 角色不符 → denied
    await expect(actions.reject(approver, ok[2]!.id, "  ")).rejects.toThrow(); // 缺意见 → invalid_request

    expect(approval("mx_ok", "approved")).toBe(1);
    expect(approval("mx_two", "step_advanced")).toBe(1);
    expect(approval("mx_two", "approved")).toBe(1);
    expect(approval("mx_ok", "rejected")).toBe(1);
    expect(approval("mx_ok", "denied")).toBe(1);
    expect(approval("unknown", "invalid_request")).toBe(1);
    // 审批拒绝是人的决定，绝不混进 denied（否则"失败率"把业务结论算成系统故障）
    expect(approval("mx_ok", "step_advanced")).toBe(0);
    expect(approval("mx_two", "denied")).toBe(0);
    expect(approval("mx_ok", "unexpected")).toBe(0);

    // ---- 执行段：2 成功（上面两次 approve 触发）+ 2 类失败 -------------------
    expect(exec("mx_ok", "success")).toBe(1);
    expect(exec("mx_two", "success")).toBe(1);
    expect(attempt("mx_ok", "success")).toBe(1);
    expect(attempt("mx_two", "success")).toBe(1);

    // 执行器抛异常 → 3 次尝试全 executor_error，终态 failed
    actions.setExecutor({ execute: async () => { throw new Error("boom"); } }, [1, 1, 1]);
    await actions.approve(approver, ok[3]!.id);
    expect(attempt("mx_ok", "executor_error")).toBe(3);
    expect(attempt("mx_ok", "executor_rejected")).toBe(0);
    expect(exec("mx_ok", "failed")).toBe(1);

    // 执行器有序拒绝（ok:false）→ 3 次尝试全 executor_rejected，终态 failed
    actions.setExecutor({ execute: async () => ({ ok: false, error: "nope" }) }, [1, 1, 1]);
    await actions.approve(approver, ok[4]!.id);
    expect(attempt("mx_ok", "executor_rejected")).toBe(3);
    expect(attempt("mx_ok", "executor_error")).toBe(3); // 未被后一轮污染
    expect(exec("mx_ok", "failed")).toBe(2);
    expect(exec("mx_ok", "success")).toBe(1);

    // 验收判据「跑 N 次同 Action 失败率」现在真的算得出来
    const okN = exec("mx_ok", "success");
    const failN = exec("mx_ok", "failed");
    expect(okN + failN).toBe(3);
    expect(failN / (okN + failN)).toBeCloseTo(2 / 3, 10);

    // 埋点确实进了 Prometheus 文本输出
    const rendered = m.render();
    expect(rendered).toContain(`# TYPE ${ACTION_METRIC_NAMES.submit} counter`);
    expect(rendered).toContain(`${ACTION_METRIC_NAMES.submit}{action_type="mx_ok",outcome="success"} 5`);
  });

  it("提交即快照 ActionType 版本：标了版本记该版，没标版本记缺省 1", async () => {
    const t = await makeApp();
    const actions = t.services.actions;
    const admin = t.adminCtx;
    await actions.registerType(admin, asType({
      key: "ver_3", name: "第三版", version: 3,
      paramsSchema: { type: "object" }, checkRules: [], approvalChain: [{ role: "admin" }],
    }));
    await actions.registerType(admin, asType({
      key: "ver_none", name: "未标版",
      paramsSchema: { type: "object" }, checkRules: [], approvalChain: [{ role: "admin" }],
    }));

    const d3 = await actions.create(admin, { actionTypeKey: "ver_3", payload: {} });
    const dn = await actions.create(admin, { actionTypeKey: "ver_none", payload: {} });

    // 落库后再读（证明真持久化了，不是内存里那份对象的残影）
    const read = async (id: string) =>
      (await t.repos.actionDrafts.get("demo", id)) as (ActionDraft & { actionTypeVersion?: number }) | undefined;
    expect((await read(d3.id))?.actionTypeVersion).toBe(3);
    expect((await read(dn.id))?.actionTypeVersion).toBe(ACTION_TYPE_DEFAULT_VERSION);

    // 类型改版（paramsSchema 变形 + version 升到 4）后，旧草稿仍指向它当时那一版 —— 历史可解释
    await actions.registerType(admin, asType({
      key: "ver_3", name: "第四版", version: 4,
      paramsSchema: { type: "object", required: ["brandNew"], properties: { brandNew: { type: "string" } } },
      checkRules: [], approvalChain: [{ role: "admin" }],
    }));
    expect((await read(d3.id))?.actionTypeVersion).toBe(3);
    const fresh = await actions.create(admin, { actionTypeKey: "ver_3", payload: { brandNew: "x" } });
    expect((await read(fresh.id))?.actionTypeVersion).toBe(4);
  });
});
