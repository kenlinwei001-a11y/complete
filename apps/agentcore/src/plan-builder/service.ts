import type {
  AuthCtx,
  CreatePlanBuilderBody,
  ExecutionPlan,
  PlanBuilderCanvas,
  PlanBuilderCompileResult,
  PlanBuilderPublishResult,
  UpdatePlanBuilderBody,
} from "@platform/contracts";
import { ErrorCodes } from "@platform/contracts";
import type { DataCoreClient } from "../tools/clients.js";
import type { ExecutionEngine } from "../engine.js";
import type { Repos } from "../persistence/repos.js";
import { newId } from "../ids.js";
import { HttpError } from "../router/orchestrator.js";
import { CatalogService } from "../catalog/service.js";
import { TaskEvents } from "../events.js";
import { compilePlanDSL } from "./compiler.js";
import { probeMissingRefs } from "../resources.js";
import { BudgetTracker } from "../tools/budget.js";

/**
 * WO-A · No-code Plan Builder 后端服务：Canvas 生命周期 + DSL 编译 + 发布治理 + 设计期运行。
 */
export class PlanBuilderService {
  constructor(
    private readonly repos: Repos,
    private readonly catalog: CatalogService,
    private readonly dataCore: DataCoreClient,
    private readonly engine: ExecutionEngine,
    private readonly events: TaskEvents,
  ) {}

  private async getOwnedCanvas(a: AuthCtx, id: string): Promise<PlanBuilderCanvas> {
    const c = await this.repos.planBuilders.get(id);
    if (!c || c.tenantId !== a.tenantId) throw new HttpError(404, "CANVAS_NOT_FOUND", `canvas not found: ${id}`);
    return c;
  }

  private async requirePackage(a: AuthCtx, packageId: string): Promise<void> {
    const pkg = await this.repos.packages.get(packageId);
    if (!pkg || pkg.tenantId !== a.tenantId) {
      throw new HttpError(404, ErrorCodes.PACKAGE_NOT_FOUND, `package not found: ${packageId}`);
    }
  }

  async createCanvas(a: AuthCtx, packageId: string, body: CreatePlanBuilderBody): Promise<PlanBuilderCanvas> {
    await this.requirePackage(a, packageId);
    const latest = await this.repos.planBuilders.latestByKey(a.tenantId, packageId, body.key);
    const version = (latest?.version ?? 0) + 1;
    const now = new Date().toISOString();
    const canvas: PlanBuilderCanvas = {
      ...body,
      id: newId("pbc"),
      tenantId: a.tenantId,
      packageId,
      version,
      status: "DRAFT",
      compiledPlanId: undefined,
      createdBy: a.userId,
      createdAt: now,
      updatedAt: now,
    };
    await this.repos.planBuilders.insert(canvas);
    return canvas;
  }

  async updateCanvas(a: AuthCtx, id: string, patch: UpdatePlanBuilderBody): Promise<PlanBuilderCanvas> {
    const canvas = await this.getOwnedCanvas(a, id);
    if (canvas.status !== "DRAFT") {
      throw new HttpError(409, ErrorCodes.IMMUTABLE_VERSION, "仅 DRAFT 状态的画布可编辑（请用 new-version 派生）");
    }
    const updated: PlanBuilderCanvas = {
      ...canvas,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.key !== undefined ? { key: patch.key } : {}),
      ...(patch.dsl !== undefined ? { dsl: patch.dsl } : {}),
      updatedAt: new Date().toISOString(),
    };
    await this.repos.planBuilders.update(updated);
    return updated;
  }

  async getCanvas(a: AuthCtx, id: string): Promise<PlanBuilderCanvas | undefined> {
    return this.getOwnedCanvas(a, id);
  }

  async listCanvases(a: AuthCtx, packageId: string): Promise<PlanBuilderCanvas[]> {
    await this.requirePackage(a, packageId);
    return this.repos.planBuilders.listByPackage(packageId);
  }

  async compileCanvas(a: AuthCtx, id: string): Promise<PlanBuilderCompileResult> {
    const canvas = await this.getOwnedCanvas(a, id);
    const result = compilePlanDSL(canvas.dsl);
    return {
      ok: result.ok,
      plan: result.plan as Record<string, unknown> | undefined,
      errors: result.errors,
    };
  }

  async publishCanvas(a: AuthCtx, id: string, _opts?: { force?: boolean }): Promise<PlanBuilderPublishResult> {
    const canvas = await this.getOwnedCanvas(a, id);
    if (canvas.status !== "DRAFT") {
      throw new HttpError(409, ErrorCodes.INVALID_STATE, "仅 DRAFT 状态的画布可发布");
    }

    const compiled = compilePlanDSL(canvas.dsl);
    if (!compiled.ok || !compiled.plan) {
      return { ok: false, canvas, errors: compiled.errors, impact: { agents: 0, plans: 0, intents: 0 } };
    }

    const errors = await this.validateRefs(a, canvas, compiled.plan.steps);
    if (errors.length > 0) {
      return { ok: false, canvas, errors, impact: { agents: 0, plans: 0, intents: 0 } };
    }

    const plan = await this.catalog.createPlan(canvas.packageId, {
      key: canvas.key,
      steps: compiled.plan.steps,
    });
    // WO-PUBLISH-REFPROBE：`publishPlan` 内部还会对**编译后的 steps** 再探一次针。
    // 与上面 `validateRefs`（探**画布 DSL 节点**）不是重复：编译器若产出 DSL 里没有的引用，
    // 只有里面那一次能咬住 —— 纵深，不是抄两遍。
    const published = await this.catalog.publishPlan(plan.id, a);

    // 同 key 旧 PUBLISHED canvas 自动退役
    const siblings = await this.repos.planBuilders.listByPackage(canvas.packageId);
    for (const sib of siblings) {
      if (sib.key === canvas.key && sib.id !== canvas.id && sib.status === "PUBLISHED") {
        await this.repos.planBuilders.update({ ...sib, status: "RETIRED", updatedAt: new Date().toISOString() });
      }
    }

    const updated: PlanBuilderCanvas = {
      ...canvas,
      status: "PUBLISHED",
      compiledPlanId: plan.id,
      updatedAt: new Date().toISOString(),
    };
    await this.repos.planBuilders.update(updated);

    return {
      ok: true,
      canvas: updated,
      plan: published as unknown as Record<string, unknown>,
      errors: [],
      impact: published.impact,
    };
  }

  private async validateRefs(
    a: AuthCtx,
    canvas: PlanBuilderCanvas,
    _steps: ExecutionPlan["steps"],
  ): Promise<{ code: string; message: string; nodeId?: string }[]> {
    const solverKeys: string[] = [];
    const ruleKeys: string[] = [];
    for (const node of canvas.dsl.nodes) {
      if (node.type === "SOLVER") solverKeys.push(node.solverKey);
      if (node.type === "TRANSFORM" && node.stepType === "evaluate_rules") {
        const ruleIds = node.params.ruleIds;
        if (Array.isArray(ruleIds)) {
          for (const r of ruleIds) {
            if (typeof r === "string") ruleKeys.push(r);
          }
        }
      }
    }
    const missing = await probeMissingRefs(this.dataCore, a, { solverKeys, ruleKeys });
    const errors: { code: string; message: string; nodeId?: string }[] = [];
    for (const s of missing.solvers) {
      const nodeId = canvas.dsl.nodes.find((n) => n.type === "SOLVER" && n.solverKey === s)?.id;
      errors.push({ code: ErrorCodes.VALIDATION_ERROR, message: `求解器「${s}」在 DataCore 未注册（死路）`, nodeId });
    }
    for (const r of missing.rules) {
      const nodeId = canvas.dsl.nodes.find(
        (n) =>
          n.type === "TRANSFORM" &&
          n.stepType === "evaluate_rules" &&
          Array.isArray(n.params.ruleIds) &&
          n.params.ruleIds.includes(r),
      )?.id;
      errors.push({ code: ErrorCodes.VALIDATION_ERROR, message: `规则「${r}」在 DataCore 规则库不存在（死路）`, nodeId });
    }
    return errors;
  }

  async newVersion(a: AuthCtx, id: string): Promise<PlanBuilderCanvas> {
    const canvas = await this.getOwnedCanvas(a, id);
    const latest = await this.repos.planBuilders.latestByKey(a.tenantId, canvas.packageId, canvas.key);
    const now = new Date().toISOString();
    const copy: PlanBuilderCanvas = {
      ...canvas,
      id: newId("pbc"),
      version: (latest?.version ?? canvas.version) + 1,
      status: "DRAFT",
      compiledPlanId: undefined,
      createdAt: now,
      updatedAt: now,
    };
    await this.repos.planBuilders.insert(copy);
    return copy;
  }

  async retireCanvas(a: AuthCtx, id: string): Promise<PlanBuilderCanvas> {
    const canvas = await this.getOwnedCanvas(a, id);
    const retired: PlanBuilderCanvas = { ...canvas, status: "RETIRED", updatedAt: new Date().toISOString() };
    await this.repos.planBuilders.update(retired);
    return retired;
  }

  async runCanvas(
    a: AuthCtx,
    id: string,
    inputs: Record<string, unknown>,
  ): Promise<
    | { ok: false; errors: { code: string; message: string; nodeId?: string }[] }
    | { ok: true; runId: string; status: string; answer?: unknown; error?: unknown; stepOutputs?: Record<string, unknown> }
  > {
    const canvas = await this.getOwnedCanvas(a, id);
    const compiled = compilePlanDSL(canvas.dsl);
    if (!compiled.ok || !compiled.plan) return { ok: false, errors: compiled.errors };

    const runId = newId("pbcr");
    await this.events.emit(runId, "task.accepted", { taskId: runId });
    const budget = new BudgetTracker();
    const result = await this.engine.runWorkflowSteps({
      taskId: runId,
      steps: compiled.plan.steps,
      slots: inputs,
      context: {},
      ctx: a,
      nesting: { callChain: [], budget },
      emit: (e, p) => this.events.emit(runId, e, p).then(() => undefined),
    });
    // WO-D1 并线：canonical 的 runWorkflowSteps 自本单分叉后多了 **CANCELLED** 终态
    // （请求被取消 / 上游 abort）。它既不是 COMPLETED 也不是 FAILED —— 折进任何一边都在撒谎：
    // 折进 COMPLETED = 把「没跑完」当答案发出去；折进 FAILED = 把「用户主动取消」报成故障。
    // 故显式第三分支，事件用全仓既有的 `task.cancelled`（见 router/orchestrator.ts）。
    if (result.status === "CANCELLED") {
      await this.events.emit(runId, "task.cancelled", { reason: result.reason });
      return { ok: true, runId, status: "CANCELLED", error: { reason: result.reason }, stepOutputs: result.stepOutputs };
    }
    if (result.status === "FAILED") {
      await this.events.emit(runId, "task.failed", result.error);
      return { ok: true, runId, status: "FAILED", error: result.error, stepOutputs: result.stepOutputs };
    }
    await this.events.emit(runId, "answer.final", result.answer);
    return { ok: true, runId, status: "COMPLETED", answer: result.answer, stepOutputs: result.stepOutputs };
  }
}
