import { describe, expect, it } from "vitest";
import {
  IdempotencyRecordSchema,
  SagaRunStateSchema,
  type OutboundSagaStep,
} from "@platform/contracts";
import type { CompensateHook } from "../src/workflow/dag-executor.js";
import {
  ExternalSystemSandbox,
  deriveIdempotencyKey,
  reconcileAndCompensate,
  runOutboundSaga,
} from "../src/workflow/saga.js";

/**
 * WO-L1B-SAGA · 跨系统 Saga 一致性齿检（铁律 0.4 真跑·KILL-MOCK-RED·R4·R6）。
 * **真外部有状态沙盘**（ExternalSystemSandbox·非 mock 回显）——真去重、真部分失败、真对账查询。
 * 驱真 saga 过真部分失败 → 真幂等重放 → 真对账补偿，断言外部账本一致（无双落地/无伪补偿）。
 * now 注入固定值（R6·时间戳不入一致性判定）；反向动作经 S2 钩子（CompensateHook·R4）。
 */

const FIXED_NOW = () => "2020-01-01T00:00:00.000Z";
const TENANT = "demo";
const TASK = "task_saga_1";

// 三步跨系统出站 saga：MES 建工单 → ERP 记成本 → WMS 出库。
const sagaSteps = (): OutboundSagaStep[] => [
  { nodeId: "mes", externalSystem: "MES", operation: "create_work_order", payload: { orderId: "O-1", qty: 100 } },
  { nodeId: "erp", externalSystem: "ERP", operation: "post_cost", payload: { orderId: "O-1", cost: 5000 } },
  { nodeId: "wms", externalSystem: "WMS", operation: "goods_issue", payload: { orderId: "O-1", sku: "S-9", qty: 100 } },
];

describe("R6 · 外部幂等键确定性派生（tenantId+taskId+nodeId+净荷哈希·无时钟/随机·双跑字节一致）", () => {
  it("同输入双跑派生同键；净荷变→键变；节点变→键变", () => {
    const base = { tenantId: TENANT, taskId: TASK, nodeId: "mes", externalSystem: "MES" as const, operation: "create_work_order", payload: { a: 1, b: 2 } };
    const k1 = deriveIdempotencyKey(base);
    const k2 = deriveIdempotencyKey({ ...base, payload: { b: 2, a: 1 } }); // 键序无关（canonical）
    expect(k1).toBe(k2);
    expect(k1.startsWith("idem_MES_")).toBe(true);
    expect(deriveIdempotencyKey({ ...base, payload: { a: 1, b: 3 } })).not.toBe(k1);
    expect(deriveIdempotencyKey({ ...base, nodeId: "erp" })).not.toBe(k1);
  });
});

describe("C1 · 真部分失败 → 幂等重放 → 已落地步跳过不二次出站（外部账本零双落地）", () => {
  it("ERP 步真失败（沙盘注入故障）→ PARTIAL_FAILURE；修复后重放：MES 跳过、ERP 补出、WMS 续跑；账本每键恰一次落地", () => {
    const sandbox = new ExternalSystemSandbox();
    const steps = sagaSteps();
    // ERP 步的确定性键，注入真故障（外部系统真拒绝·不落地）。
    const erpKey = deriveIdempotencyKey({ tenantId: TENANT, taskId: TASK, nodeId: "erp", externalSystem: "ERP", operation: "post_cost", payload: { orderId: "O-1", cost: 5000 } });
    sandbox.injectSubmitFault(erpKey);

    // ① 首跑：MES 落地 → ERP 真失败 → 停（WMS 未出站）。
    const first = runOutboundSaga({ sagaId: "saga_1", tenantId: TENANT, taskId: TASK, steps, sandbox, now: FIXED_NOW });
    expect(first.status).toBe("PARTIAL_FAILURE");
    expect(first.failedAtNode).toBe("erp");
    expect(first.steps.map((s) => `${s.nodeId}:${s.action}`)).toEqual(["mes:SUBMITTED", "erp:FAILED"]);
    // 外部账本真值：仅 MES 落地（ERP 故障未落·WMS 未触及）。
    expect(sandbox.appliedCount()).toBe(1);
    expect(sandbox.activeKeys()).toEqual([deriveIdempotencyKey({ tenantId: TENANT, taskId: TASK, nodeId: "mes", externalSystem: "MES", operation: "create_work_order", payload: { orderId: "O-1", qty: 100 } })]);

    // ② 修复外部系统（故障清除）后**从落库态重放**（同确定性键）。
    sandbox.clearSubmitFault(erpKey);
    const replay = runOutboundSaga({ sagaId: "saga_1", tenantId: TENANT, taskId: TASK, steps, sandbox, now: FIXED_NOW, resumeFrom: first });
    expect(replay.status).toBe("COMPLETED");
    expect(replay.resumedCount).toBe(1);
    // MES 已落地 → 对账证实 → 跳过不二次出站；ERP 补出；WMS 续跑。
    expect(replay.steps.map((s) => `${s.nodeId}:${s.action}`)).toEqual([
      "mes:SKIPPED_ALREADY_APPLIED",
      "erp:SUBMITTED",
      "wms:SUBMITTED",
    ]);
    // **无双落地铁证**：三键各恰一次落地（MES 未因重放二次出站·appliedCount==3 非 4）。
    expect(sandbox.appliedCount()).toBe(3);
    expect(sandbox.activeKeys().length).toBe(3);
  });

  it("真幂等去重：直接对已落地键二次 submit → deduped 命中·外部态不二次落地", () => {
    const sandbox = new ExternalSystemSandbox();
    const key = deriveIdempotencyKey({ tenantId: TENANT, taskId: TASK, nodeId: "mes", externalSystem: "MES", operation: "create_work_order", payload: { orderId: "O-1", qty: 100 } });
    const r1 = sandbox.submit("MES", key, "create_work_order", { orderId: "O-1", qty: 100 });
    const r2 = sandbox.submit("MES", key, "create_work_order", { orderId: "O-1", qty: 100 });
    expect(r1.deduped).toBe(false);
    expect(r2.deduped).toBe(true);
    expect(r2.externalRef).toBe(r1.externalRef); // 返首次回执
    expect(sandbox.appliedCount()).toBe(1); // 仅一次真落地
    expect(sandbox.dedupHitCount()).toBe(1);
  });
});

describe("C2 · 对账补偿：只补偿确证落地步·经 S2·反向序·未落地步不盲反转（账本一致）", () => {
  it("MES/ERP 落地后 WMS 失败 → 对账补偿反向序（ERP→MES 经 S2 REVERSED）·WMS 无需补偿·run→COMPENSATED", async () => {
    const sandbox = new ExternalSystemSandbox();
    const steps = sagaSteps();
    const wmsKey = deriveIdempotencyKey({ tenantId: TENANT, taskId: TASK, nodeId: "wms", externalSystem: "WMS", operation: "goods_issue", payload: { orderId: "O-1", sku: "S-9", qty: 100 } });
    sandbox.injectSubmitFault(wmsKey); // WMS 真失败（未落地）

    const run = runOutboundSaga({ sagaId: "saga_2", tenantId: TENANT, taskId: TASK, steps, sandbox, now: FIXED_NOW });
    expect(run.status).toBe("PARTIAL_FAILURE");
    expect(run.failedAtNode).toBe("wms");
    expect(sandbox.appliedCount()).toBe(2); // MES + ERP 真落地·WMS 未落

    // S2 补偿钩子（反向 create_action_draft 提交审批流·EXECUTED 才落·R4·非静默）。
    const s2Order: string[] = [];
    const compensate: CompensateHook = async ({ nodeId, action }) => {
      s2Order.push(nodeId);
      expect(action.kind).toBe("REVERSING_ACTION");
      return { compensated: true, detail: "reversing draft submitted to S2 approval" };
    };
    const events: { nodeId?: string; compensated?: boolean; status?: string }[] = [];
    const compensated = await reconcileAndCompensate({
      sagaState: run,
      steps,
      sandbox,
      compensate,
      now: FIXED_NOW,
      emit: (_e, p) => events.push(p as { nodeId?: string; compensated?: boolean; status?: string }),
    });

    expect(compensated.status).toBe("COMPENSATED");
    // 反向拓扑序：ERP 后落地先补偿，MES 次之（WMS 未落地不在补偿集）。
    expect(s2Order).toEqual(["erp", "mes"]);
    expect(compensated.compensations.map((c) => `${c.nodeId}:${c.compensated}`)).toEqual(["erp:true", "mes:true"]);
    // 外部账本真反转：MES/ERP 键均 REVERSED（无有效落地·无幽灵反转）。
    expect(sandbox.activeKeys()).toEqual([]);
    expect(sandbox.reversedKeys().length).toBe(2);
    // 对账后态确为 REVERSED（真值·非伪装）。
    for (const c of compensated.compensations) expect(c.reconciliation.status).toBe("REVERSED");
  });

  it("不可逆步诚实记录 compensated=false（无 S2 钩子）·run→RECONCILIATION_PENDING（不伪装已补偿）", async () => {
    const sandbox = new ExternalSystemSandbox();
    const steps = sagaSteps();
    const wmsKey = deriveIdempotencyKey({ tenantId: TENANT, taskId: TASK, nodeId: "wms", externalSystem: "WMS", operation: "goods_issue", payload: { orderId: "O-1", sku: "S-9", qty: 100 } });
    sandbox.injectSubmitFault(wmsKey);
    const run = runOutboundSaga({ sagaId: "saga_3", tenantId: TENANT, taskId: TASK, steps, sandbox, now: FIXED_NOW });

    // 不提供 compensate 钩子 → 落地的出站步不可逆 → 诚实 false。
    const result = await reconcileAndCompensate({ sagaState: run, steps, sandbox, now: FIXED_NOW });
    expect(result.status).toBe("RECONCILIATION_PENDING");
    expect(result.compensations.every((c) => c.compensated === false)).toBe(true);
    // 账本未被反转（真值·未伪装补偿）——MES/ERP 仍有效落地。
    expect(sandbox.activeKeys().length).toBe(2);
    expect(sandbox.reversedKeys().length).toBe(0);
  });

  it("对账不可达（UNCERTAIN）→ 诚实挂起 RECONCILIATION_PENDING（不盲反转·不伪装）", async () => {
    const sandbox = new ExternalSystemSandbox();
    const steps = sagaSteps();
    const wmsKey = deriveIdempotencyKey({ tenantId: TENANT, taskId: TASK, nodeId: "wms", externalSystem: "WMS", operation: "goods_issue", payload: { orderId: "O-1", sku: "S-9", qty: 100 } });
    sandbox.injectSubmitFault(wmsKey);
    const run = runOutboundSaga({ sagaId: "saga_4", tenantId: TENANT, taskId: TASK, steps, sandbox, now: FIXED_NOW });

    // MES 键对账查询注入不可达 → UNCERTAIN。
    const mesKey = deriveIdempotencyKey({ tenantId: TENANT, taskId: TASK, nodeId: "mes", externalSystem: "MES", operation: "create_work_order", payload: { orderId: "O-1", qty: 100 } });
    sandbox.injectReconcileFault(mesKey);
    const compensate: CompensateHook = async () => ({ compensated: true });
    const result = await reconcileAndCompensate({ sagaState: run, steps, sandbox, compensate, now: FIXED_NOW });
    expect(result.status).toBe("RECONCILIATION_PENDING");
    const mesComp = result.compensations.find((c) => c.nodeId === "mes");
    expect(mesComp?.compensated).toBe(false);
    expect(mesComp?.reconciliation.status).toBe("UNCERTAIN");
    // MES 未被盲反转（对账不确定 → 账本保持落地·诚实挂起）。
    expect(sandbox.isApplied(mesKey)).toBe(true);
  });
});

describe("C3 · 契约对账：saga 态经 SagaRunStateSchema·幂等记录经 IdempotencyRecordSchema（形一致）", () => {
  it("落态经 zod 解析（status/steps/compensations/failedAtNode/resumedCount 齐）", () => {
    const sandbox = new ExternalSystemSandbox();
    const state = runOutboundSaga({ sagaId: "saga_5", tenantId: TENANT, taskId: TASK, steps: sagaSteps(), sandbox, now: FIXED_NOW });
    const parsed = SagaRunStateSchema.parse(state);
    expect(parsed.status).toBe("COMPLETED");
    expect(parsed.steps.length).toBe(3);
    // 幂等记录形对账（saga 侧 durable 审计基线）。
    const rec = IdempotencyRecordSchema.parse({
      key: parsed.steps[0]!.key,
      tenantId: TENANT,
      taskId: TASK,
      nodeId: parsed.steps[0]!.nodeId,
      externalSystem: parsed.steps[0]!.externalSystem,
      operation: parsed.steps[0]!.operation,
      status: "APPLIED",
      externalRef: parsed.steps[0]!.externalRef,
      submittedAt: FIXED_NOW(),
    });
    expect(rec.status).toBe("APPLIED");
  });
});
