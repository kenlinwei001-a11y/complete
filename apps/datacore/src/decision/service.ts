// L2 · 决策内核服务（WO-L2-4·PRD-L2 §5）—— apps/datacore/src/decision/service.ts
//
// 把 L2-1/2/3 的纯内核（kernel.ts assembleDecisionPackage）接**真 in-process SolverService**：
// 构建=真调 datacore 求解器（solvers.invoke·非 fixture）+ 沿因果重算（ontologyCore.recompute dryRun）
// → 装配 DecisionPackage → 落库 decisionPackages（咨询派生·可 drop 重生）→ 发域事件。
//
// 暗发：QOS_DECISION_KERNEL≠"1" 时端点短路（不构·pipeline 零变化）；decision.kernel 关=端点 404。
// R6：generatedAt 由端点/调用方注入（服务内不取时钟）；kernel 装配确定性。
// R4/RL4：本服务**只读 + 旁写咨询表**·绝不写业务真值（采纳经 WO-L2-5 正门 Decision/ActionDraft）。
//
// 注（跨 lane·honest）：PRD §2.1 的 agentcore QOS 旁挂（fire-and-forget 自动触发·消费 RequirementGraph）
// 属 Lane A / 待 Dev-1 WO-L1A-3；本服务提供**datacore 侧完整可调面**（build/get 端点），旁挂-call 后接。

import type { DecisionPackage } from "@platform/contracts";
import type { AuthCtx } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import type { OutboxService } from "../outbox.js";
import type { SolverService } from "../solvers/service.js";
import type { OntologyCoreService } from "../ontology-core.js";
import { assembleDecisionPackage, type DecisionKernelDeps, type DecisionKernelRequest } from "./kernel.js";

export interface DecisionKernelBuildInput {
  taskId: string;
  query: string;
  intentKey: string | null;
  slots: Record<string, unknown>;
  requirementGraphId?: string | null; // L1-A 衔接（缺=null·退化不阻断）
  executionPlanId?: string | null; // L1-B 衔接（缺=null）
  generatedAt: string; // R6·调用方注入（内部不取时钟）
}

export class DecisionKernelService {
  constructor(
    private repos: Repos,
    private solvers: SolverService,
    private outbox: OutboxService,
    private ontologyCore?: OntologyCoreService,
  ) {}

  /** 从真 in-process 求解器 + 沿因果重算构造内核依赖（tenantId 闭合在 ctx·R2）。 */
  private deps(ctx: AuthCtx): DecisionKernelDeps {
    return {
      invokeSolver: (key, args) => this.solvers.invoke(ctx, key, args),
      recomputeDryRun: this.ontologyCore
        ? async (apply) => {
            const changes = apply.map((a) => ({ typeKey: a.objectType, prop: a.prop, objectIds: [a.objectId] }));
            const applyArg = apply.map((a) => ({ objectId: a.objectId, prop: a.prop, value: a.value }));
            const r = await this.ontologyCore!.recompute(ctx, changes, { dryRun: true, apply: applyArg });
            return { deltas: r.dryRunDeltas ?? [], affectedObjects: r.updatedObjects };
          }
        : undefined,
    };
  }

  /** 构造并落库决策制品（发 started/built/failed 域事件·失败隔离不吞真错）。 */
  async build(ctx: AuthCtx, input: DecisionKernelBuildInput): Promise<DecisionPackage> {
    await this.outbox.emit(ctx.tenantId, "decision.package_started", { taskId: input.taskId }, input.taskId);
    try {
      const req: DecisionKernelRequest = {
        taskId: input.taskId,
        tenantId: ctx.tenantId,
        query: input.query,
        intentKey: input.intentKey,
        slots: input.slots,
        requirementGraphId: input.requirementGraphId ?? null,
        executionPlanId: input.executionPlanId ?? null,
        generatedAt: input.generatedAt,
        builderVersion: "l2-kernel@1",
      };
      const pkg = await assembleDecisionPackage(this.deps(ctx), req);
      await this.repos.decisionPackages.put({ ...pkg, id: pkg.packageId });
      await this.outbox.emit(
        ctx.tenantId,
        "decision.package_built",
        { packageId: pkg.packageId, taskId: input.taskId, scenarios: pkg.scenarios.length, dataMode: pkg.dataMode },
        input.taskId,
      );
      return pkg;
    } catch (e) {
      await this.outbox.emit(
        ctx.tenantId,
        "decision.package_failed",
        { taskId: input.taskId, error: e instanceof Error ? e.message : String(e) },
        input.taskId,
      );
      throw e;
    }
  }

  /** 取某任务最新决策制品（新→旧·R2 tenant 过滤·跨租户取不到）。 */
  async getByTask(ctx: AuthCtx, taskId: string): Promise<DecisionPackage | undefined> {
    const all = await this.repos.decisionPackages.list(ctx.tenantId, (p) => p.taskId === taskId);
    if (all.length === 0) return undefined;
    return [...all].sort((a, b) =>
      a.generatedAt < b.generatedAt ? 1 : a.generatedAt > b.generatedAt ? -1 : a.packageId < b.packageId ? 1 : -1,
    )[0];
  }
}
