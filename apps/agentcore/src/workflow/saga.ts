import { createHash } from "node:crypto";
import type {
  ExternalSystem,
  OutboundSagaStep,
  ReconciliationOutcome,
  SagaCompensationOutcome,
  SagaRunState,
  SagaStepOutcome,
} from "@platform/contracts";
import type { CompensateHook } from "./dag-executor.js";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WO-L1B-SAGA · 跨系统 Saga 一致性（MES/ERP/WMS 出站步·外部幂等键 + 对账补偿 + 部分失败重放）
 * PRD: docs/PRD-L1B-execution-planner-workflow-runtime.md §8 WO-L1B-SAGA · NG2 · R4
 *
 * 治簇① V2-7-142/V3-1-039（跨系统事务一致性·"外部幂等/对账最难"）。承 WO-L1B-3 补偿反向序（本系统
 * 内可逆步）之上，为**出站到外部系统的步**加跨系统一致性三件套：
 *
 * · **外部幂等键**（`deriveIdempotencyKey`·R6 纯派生·tenantId+taskId+nodeId+净荷哈希）——同键重放
 *   绝不二次出站。真去重由外部系统账本按键裁决（第二次同键 submit 返首次回执·不二次落地）。
 * · **对账补偿**（`reconcileAndCompensate`）——部分失败后查外部系统按键的**真实落地态**，只补偿**确证
 *   落地**的步（never blind-reverse）；反向动作**必经 S2 Action 审批**（`compensate` 钩子·R4·绝不静默
 *   反转真实世界）；不可逆/对账不确定步**诚实记 `compensated=false` / RECONCILIATION_PENDING**（不伪装）。
 * · **部分失败重放**（`runOutboundSaga` resumeFrom）——中途失败的多步出站 saga 可从落库态重放；已落地步
 *   （对账证实）**跳过不二次出站**（`SKIPPED_ALREADY_APPLIED`），未落地步续跑。
 *
 * **真外部沙盘**（`ExternalSystemSandbox`）：非 mock 回显——真有状态账本，按键真去重、可驱真部分失败、
 * 支持真对账查询。测试驱真 saga 过真部分失败→真幂等重放→真对账补偿，断言外部账本一致（无双落地/无
 * 伪补偿·KILL-MOCK-RED）。这就是 WO-ACTUATE 的"真 ERP stub·诚实 NOT_CONFIGURED"范式。
 *
 * **暗发**（`qos.workflow_saga`·defaultOn:false·env `QOS_WORKFLOW_SAGA`）：关闸 = saga path 不启用 =
 * 现行行为字节一致（NG6·回退演练）。additive 新模块，缺省不接热路径。
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** 规范化 JSON（键稳定排序·R6 确定性·排除时钟/随机）。 */
function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, norm((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(norm(value)) ?? "null";
}

/**
 * deriveIdempotencyKey：确定性外部幂等键（R6·tenantId+taskId+nodeId+净荷哈希·无时钟/随机）。
 * 同 (tenantId, taskId, nodeId, payload) 双跑字节一致 → 崩溃重放派生同键 → 外部账本去重生效。
 */
export function deriveIdempotencyKey(input: {
  tenantId: string;
  taskId: string;
  nodeId: string;
  externalSystem: ExternalSystem;
  operation: string;
  payload: unknown;
}): string {
  const digest = createHash("sha256")
    .update(
      canonicalJson({
        t: input.tenantId,
        k: input.taskId,
        n: input.nodeId,
        s: input.externalSystem,
        o: input.operation,
        p: input.payload ?? {},
      }),
    )
    .digest("hex");
  return `idem_${input.externalSystem}_${digest.slice(0, 20)}`;
}

/** 外部系统账本条目（真落地态·净荷不外泄·仅回执引用·no-secrets）。 */
interface LedgerEntry {
  key: string;
  system: ExternalSystem;
  operation: string;
  externalRef: string; // 外部系统回执引用（真去重返此）
  reversed: boolean; // 是否已被反转（补偿经 S2 确认后置真）
  appliedSeq: number; // 落地次序（对账/审计·R6 内部计数非时钟）
}

export interface SandboxSubmitResult {
  applied: boolean; // 是否落地（含去重命中·外部态为已落地）
  deduped: boolean; // 是否命中去重（第二次同键·未二次落地）
  externalRef: string | null;
  detail?: string;
}

/**
 * ExternalSystemSandbox — **真实有状态在进程外部系统沙盘**（MES/ERP/WMS 统一账本·非 mock）。
 *
 * 真去重：账本按幂等键持有落地记录；第二次同键 `submit` 返首次回执且**不二次落地**（`applied` 计数
 * 不增）。真部分失败：`injectFault(key)` 令该键 submit **真失败且不落地**（外部账本不含该键）。真对账：
 * `reconcile(key)` 返账本按键的**真实落地态**（存在→APPLIED；缺→NOT_FOUND；反转→REVERSED；故障对账
 * 查询本身注入不可达→UNCERTAIN）。真反转：`applyReversal` 仅当键确证落地才标 reversed（幂等·经 S2 后调）。
 */
export class ExternalSystemSandbox {
  private readonly ledger = new Map<string, LedgerEntry>();
  private readonly submitFaults = new Set<string>(); // 令该键 submit 真失败（未落地）
  private readonly reconcileFaults = new Set<string>(); // 令该键对账查询不可达（UNCERTAIN）
  private seq = 0;
  private applyCount = 0; // 真落地累计（去重命中不增·断言无双落地）
  private dedupHits = 0; // 去重命中累计

  /** 驱动真部分失败：该键的 submit 将真失败且不落地（外部账本不含该键）。 */
  injectSubmitFault(key: string): void {
    this.submitFaults.add(key);
  }
  clearSubmitFault(key: string): void {
    this.submitFaults.delete(key);
  }
  /** 驱动对账不可达：该键的对账查询返回 UNCERTAIN（诚实挂起·不伪装）。 */
  injectReconcileFault(key: string): void {
    this.reconcileFaults.add(key);
  }
  clearReconcileFault(key: string): void {
    this.reconcileFaults.delete(key);
  }

  /**
   * submit：向外部系统按幂等键提交出站操作（真去重·真故障）。
   * - 该键已落地 → 返首次回执·`deduped=true`·**不二次落地**（真幂等）。
   * - 该键注入了故障 → 真失败·`applied=false`·**账本不含该键**（真部分失败点·可安全重放）。
   * - 否则 → 落地（账本新增条目）·返回新回执。
   */
  submit(system: ExternalSystem, key: string, operation: string, _payload: unknown): SandboxSubmitResult {
    const existing = this.ledger.get(key);
    if (existing) {
      this.dedupHits += 1;
      return { applied: true, deduped: true, externalRef: existing.externalRef, detail: "idempotent dedup: prior receipt returned" };
    }
    if (this.submitFaults.has(key)) {
      return { applied: false, deduped: false, externalRef: null, detail: "external system rejected/unreachable (not applied)" };
    }
    this.seq += 1;
    this.applyCount += 1;
    const externalRef = `${system}-${operation}-${this.seq}`;
    this.ledger.set(key, { key, system, operation, externalRef, reversed: false, appliedSeq: this.seq });
    return { applied: true, deduped: false, externalRef, detail: "applied to external ledger" };
  }

  /** reconcile：查外部系统按幂等键的真实落地态（对账源真值·补偿据此·绝不盲反转）。 */
  reconcile(key: string): ReconciliationOutcome {
    if (this.reconcileFaults.has(key)) {
      return { key, landed: false, status: "UNCERTAIN", externalRef: null, detail: "reconciliation query unreachable" };
    }
    const entry = this.ledger.get(key);
    if (!entry) return { key, landed: false, status: "NOT_FOUND", externalRef: null };
    if (entry.reversed) return { key, landed: false, status: "REVERSED", externalRef: entry.externalRef };
    return { key, landed: true, status: "APPLIED", externalRef: entry.externalRef };
  }

  /**
   * applyReversal：反转外部落地效果（**仅在经 S2 审批确认后调**·幂等）。
   * 仅当该键确证落地且未反转才置 reversed（对账 REVERSED）；否则 no-op（诚实·不制造幽灵反转）。
   */
  applyReversal(key: string): boolean {
    const entry = this.ledger.get(key);
    if (!entry || entry.reversed) return false;
    entry.reversed = true;
    return true;
  }

  // ── 断言辅助（测试对外部账本一致性取真值·无双落地/无伪补偿）──────────────
  /** 真落地累计（去重命中不计·断言"同键重放绝不双落地"）。 */
  appliedCount(): number {
    return this.applyCount;
  }
  dedupHitCount(): number {
    return this.dedupHits;
  }
  /** 当前有效落地键（未反转）——断言对账补偿后账本一致。 */
  activeKeys(): string[] {
    return [...this.ledger.values()].filter((e) => !e.reversed).map((e) => e.key).sort();
  }
  reversedKeys(): string[] {
    return [...this.ledger.values()].filter((e) => e.reversed).map((e) => e.key).sort();
  }
  isApplied(key: string): boolean {
    const e = this.ledger.get(key);
    return !!e && !e.reversed;
  }
}

// ── Saga 执行 ──────────────────────────────────────────────────────────────

export interface RunOutboundSagaInput {
  sagaId: string;
  tenantId: string;
  taskId: string;
  steps: OutboundSagaStep[];
  sandbox: ExternalSystemSandbox;
  /** R6 可注入时钟（内部不取 Date.now·续跑与首跑时间戳不入一致性判定）。 */
  now?: () => string;
  /** 部分失败重放：上次落库的 saga 态（已落地步跳过·从失败点后续跑）。 */
  resumeFrom?: SagaRunState;
  /** 内部域事件（非 SSE·审计/可观测）。 */
  emit?: (event: string, payload: unknown) => void;
}

/**
 * runOutboundSaga：顺序执行出站 saga 步（外部幂等键 + 部分失败停 + 重放跳过已落地）。
 * 每步：派生/取幂等键 → **先对账**（已落地→SKIPPED_ALREADY_APPLIED·不二次出站）→ 否则 submit；
 * 真失败即停（PARTIAL_FAILURE·记 failedAtNode）·后续步不出站（保留可补偿/可重放）。
 */
export function runOutboundSaga(input: RunOutboundSagaInput): SagaRunState {
  const now = input.now ?? (() => new Date().toISOString());
  const emit = input.emit ?? (() => undefined);
  const prior = input.resumeFrom;
  const startedAt = prior?.startedAt ?? now();
  const resumedCount = prior ? prior.resumedCount + 1 : 0;
  // 重放：已 SUBMITTED/SKIPPED 的节点集（对账二次确认后跳过·不信任落库态盲跳）。
  const priorDone = new Set(
    (prior?.steps ?? []).filter((s) => s.action !== "FAILED").map((s) => s.nodeId),
  );

  const outcomes: SagaStepOutcome[] = [];
  let failedAtNode: string | null = null;

  for (const step of input.steps) {
    const key =
      step.idempotencyKey ??
      deriveIdempotencyKey({
        tenantId: input.tenantId,
        taskId: input.taskId,
        nodeId: step.nodeId,
        externalSystem: step.externalSystem,
        operation: step.operation,
        payload: step.payload,
      });

    // 部分失败停：一旦有失败点，后续步不出站（保留一致性窗口·可补偿/可重放）。
    if (failedAtNode !== null) break;

    // 对账优先（重放跳过已落地·防二次出站·R4·真幂等）。落库态提示 + 外部对账双证。
    const recon = input.sandbox.reconcile(key);
    if (recon.landed || (priorDone.has(step.nodeId) && recon.status === "APPLIED")) {
      outcomes.push({
        nodeId: step.nodeId,
        key,
        externalSystem: step.externalSystem,
        operation: step.operation,
        action: "SKIPPED_ALREADY_APPLIED",
        externalRef: recon.externalRef,
        detail: "reconciliation confirms already applied — skipped (no double-submit)",
      });
      emit("saga.step_skipped", { sagaId: input.sagaId, nodeId: step.nodeId, key });
      continue;
    }

    const res = input.sandbox.submit(step.externalSystem, key, step.operation, step.payload);
    if (res.applied) {
      outcomes.push({
        nodeId: step.nodeId,
        key,
        externalSystem: step.externalSystem,
        operation: step.operation,
        action: "SUBMITTED",
        externalRef: res.externalRef,
        detail: res.detail,
      });
      emit("saga.step_submitted", { sagaId: input.sagaId, nodeId: step.nodeId, key, deduped: res.deduped });
    } else {
      failedAtNode = step.nodeId;
      outcomes.push({
        nodeId: step.nodeId,
        key,
        externalSystem: step.externalSystem,
        operation: step.operation,
        action: "FAILED",
        externalRef: null,
        detail: res.detail,
      });
      emit("saga.step_failed", { sagaId: input.sagaId, nodeId: step.nodeId, key });
    }
  }

  const status: SagaRunState["status"] = failedAtNode !== null ? "PARTIAL_FAILURE" : "COMPLETED";
  const state: SagaRunState = {
    sagaId: input.sagaId,
    tenantId: input.tenantId,
    taskId: input.taskId,
    status,
    steps: outcomes,
    compensations: prior?.compensations ?? [],
    failedAtNode,
    resumedCount,
    startedAt,
    updatedAt: now(),
  };
  emit("saga.run_settled", { sagaId: input.sagaId, status, failedAtNode });
  return state;
}

export interface ReconcileAndCompensateInput {
  sagaState: SagaRunState;
  steps: OutboundSagaStep[];
  sandbox: ExternalSystemSandbox;
  /**
   * 反向动作经 S2 Action 审批（R4·EXECUTED 才落·绝不静默反转）。缺省=无钩子→不可逆→诚实 false。
   * 复用 DAG 补偿钩子契约（同一 S2 通路·反向 create_action_draft 提交审批流）。
   */
  compensate?: CompensateHook;
  now?: () => string;
  emit?: (event: string, payload: unknown) => void;
}

/**
 * reconcileAndCompensate：部分失败后对账补偿（反向拓扑序·只补偿确证落地步·经 S2·诚实不伪装）。
 * 对已 SUBMITTED 步**反向序**逐个：查外部真实落地态 →
 *   - APPLIED（真落地）→ 反向动作经 S2 钩子 → 成功则 `applyReversal` 标 REVERSED·`compensated=true`；
 *   - NOT_FOUND / REVERSED（未落地/已反转）→ 无需补偿（never blind-reverse）·`compensated=true`（一致）；
 *   - UNCERTAIN（对账不可达）/ 无钩子（不可逆）→ **诚实 `compensated=false`·RECONCILIATION_PENDING**（不伪装）。
 * 全部一致（可逆步反转 + 未落地步无需动）→ COMPENSATED；有不确定/不可逆 → RECONCILIATION_PENDING。
 */
export async function reconcileAndCompensate(input: ReconcileAndCompensateInput): Promise<SagaRunState> {
  const now = input.now ?? (() => new Date().toISOString());
  const emit = input.emit ?? (() => undefined);
  const stepByNode = new Map(input.steps.map((s) => [s.nodeId, s]));
  // 已 SUBMITTED 的步（真落地过·需对账补偿）·反向拓扑序（后落地先补偿）。
  const submitted = input.sagaState.steps.filter((s) => s.action === "SUBMITTED");
  const reversed = [...submitted].reverse();

  const comps: SagaCompensationOutcome[] = [];
  let allConsistent = true;

  for (const s of reversed) {
    const recon = input.sandbox.reconcile(s.key);

    // 未落地 / 已反转 → 无需补偿（对账证实·绝不盲反转·一致）。
    if (recon.status === "NOT_FOUND" || recon.status === "REVERSED") {
      comps.push({ nodeId: s.nodeId, key: s.key, compensated: true, reconciliation: recon, reason: "not landed / already reversed — nothing to reverse" });
      emit("saga.compensated", { sagaId: input.sagaState.sagaId, nodeId: s.nodeId, compensated: true, status: recon.status });
      continue;
    }

    // 对账不可达 → 诚实挂起（不伪装已补偿·KILL-MOCK）。
    if (recon.status === "UNCERTAIN") {
      allConsistent = false;
      comps.push({ nodeId: s.nodeId, key: s.key, compensated: false, reconciliation: recon, reason: "reconciliation uncertain — pending (not faked)" });
      emit("saga.compensated", { sagaId: input.sagaState.sagaId, nodeId: s.nodeId, compensated: false, status: "UNCERTAIN" });
      continue;
    }

    // APPLIED（真落地）→ 反向动作经 S2 审批（无钩子=不可逆·诚实 false）。
    const declared = stepByNode.get(s.nodeId);
    if (!input.compensate) {
      allConsistent = false;
      comps.push({ nodeId: s.nodeId, key: s.key, compensated: false, reconciliation: recon, reason: "irreversible outbound effect (no S2 reversing hook)" });
      emit("saga.compensated", { sagaId: input.sagaState.sagaId, nodeId: s.nodeId, compensated: false, status: "APPLIED" });
      continue;
    }
    const hookRes = await input.compensate({
      nodeId: s.nodeId,
      action: {
        forNode: s.nodeId,
        kind: "REVERSING_ACTION",
        ...(declared ? { reason: `reverse ${declared.externalSystem}:${declared.operation}` } : {}),
      },
      stepOutputs: { [s.nodeId]: { key: s.key, externalRef: s.externalRef } },
    });
    if (hookRes.compensated) {
      // S2 确认反转 → 外部账本标 REVERSED（真反转·非静默）。
      input.sandbox.applyReversal(s.key);
      const after = input.sandbox.reconcile(s.key);
      comps.push({ nodeId: s.nodeId, key: s.key, compensated: true, reconciliation: after, reason: hookRes.detail ?? "reversing action approved via S2" });
      emit("saga.compensated", { sagaId: input.sagaState.sagaId, nodeId: s.nodeId, compensated: true, status: "REVERSED" });
    } else {
      allConsistent = false;
      comps.push({ nodeId: s.nodeId, key: s.key, compensated: false, reconciliation: recon, reason: hookRes.detail ?? "reversing action not approved/failed" });
      emit("saga.compensated", { sagaId: input.sagaState.sagaId, nodeId: s.nodeId, compensated: false, status: "APPLIED" });
    }
  }

  const status: SagaRunState["status"] = allConsistent ? "COMPENSATED" : "RECONCILIATION_PENDING";
  return {
    ...input.sagaState,
    status,
    compensations: comps,
    updatedAt: now(),
  };
}
