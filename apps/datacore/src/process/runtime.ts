import {
  PROCESS_OWNER_FUNCTIONS,
  PROCESS_TASK_WAIT_STATES,
  evaluateGate,
  isWaitState,
  type AdvanceProcessInstanceRequest,
  type CreateProcessInstanceRequest,
  type ProcessGateContext,
  type ProcessInstance,
  type ProcessInstanceDetail,
  type ProcessStuckReason,
  type ProcessStuckResponse,
  type ProcessTask,
  type ProcessTaskWaitState,
} from "@platform/contracts";
import type { Repos } from "../repo/repo.js";
import { notFound, validationError } from "../errors.js";

/**
 * WO-PROCESS-INSTANCE · 流程运行时引擎 —— 「为什么这个流程现在卡住了」的服务端半边。
 *
 * ══ 这个引擎存在的理由（别把它读成 workflow executor 的重复）═══════════════
 *
 * 平台已有 `agentcore` 的 workflow executor，那是**编排引擎**：它跑的是我们自己定义的
 * DAG，节点是技能调用。本引擎跑的是**业务现实**：节点是人和部门在做的事，
 * 它的停顿不是「执行失败」而是「在等一个外部事实」（数据没到、供应商没回、审批没批）。
 *
 * 判据上的差别很实：编排引擎的停顿要**报警**，本引擎的停顿是**常态**——
 * 一条 45 天的产能立项流程，绝大多数时间都停在某个等待态里。
 * 把这两件事塞进一个引擎，会得出「全公司的流程 90% 处于故障」这种荒谬结论。
 *
 * ══ 时钟注入（R6 · 欠账 #141）══════════════════════════════════════════════
 * 全部「现在几点」经构造函数的 `clock` 进来，与 `SchedulerService`（`scheduler.ts:36`）
 * 同一形态。欠账 #141 的原话是「挂在墙钟上的断言并发时必假红」——
 * 本引擎的输出里有「等了多久」，是最容易犯那个错的地方，故时钟从一开始就是参数。
 */
export interface ProcessRuntimeOpts {
  clock?: () => Date;
}

/** 责任职能 key → 中文名。查不到 ⇒ `undefined`（不是 "未知"：见 contracts 里的诚实缺席纪律）。 */
const OWNER_DISPLAY: Record<string, string> = Object.fromEntries(
  PROCESS_OWNER_FUNCTIONS.map((f) => [f.key, f.displayName]),
);

export class ProcessRuntimeService {
  private clock: () => Date;

  constructor(
    private repos: Repos,
    opts?: ProcessRuntimeOpts,
  ) {
    this.clock = opts?.clock ?? (() => new Date());
  }

  // ────────────────────────────────────────────────────────────────────────
  // 建实例
  // ────────────────────────────────────────────────────────────────────────

  /**
   * 按模板建一条实例。
   *
   * 🔴 **定义必须存在**：`definitionKey` 查不到 `ProcessDefinition` 就 404，不许凭空建。
   * 允许「实例引用一个不存在的流程」等于让运行时层自己发明流程，
   * 那正是模板层红线 3（每条流程必须有承载物）在本层的对偶失守。
   */
  async create(tenantId: string, body: CreateProcessInstanceRequest): Promise<ProcessInstanceDetail> {
    const defs = await this.repos.processDefinitions.list(tenantId, (d) => d.key === body.definitionKey);
    const def = defs[0];
    if (!def) {
      throw notFound(
        `ProcessDefinition ${body.definitionKey} 不存在（租户 ${tenantId}）—— 实例必须挂在已定义的流程上，不许凭空建`,
      );
    }
    // 承载物一致性：实例作用的对象类型应与定义声明的承载物类型一致。
    // 不一致时**拒绝**而非纠正 —— 静默纠正会让「这条流程在处理什么」这个问题的答案取决于代码而非数据。
    if (body.subjectRef.typeKey !== def.carrierTypeKey) {
      throw validationError(
        `subjectRef.typeKey=${body.subjectRef.typeKey} 与 ProcessDefinition ${def.key} 的 carrierTypeKey=${def.carrierTypeKey} 不一致`,
      );
    }

    const now = this.clock().toISOString();
    const instanceId = `pinst_${tenantId}_${def.key}_${body.subjectRef.objectId}`.replace(/[^\w-]/g, "_");

    const tasks: ProcessTask[] = body.tasks.map((t, i) => ({
      id: `ptask_${instanceId}_${i + 1}`,
      tenantId,
      instanceId,
      seq: i + 1,
      name: t.name,
      ownerFunctionKey: t.ownerFunctionKey,
      status: "PENDING" as const,
      ...(t.gate ? { gate: t.gate } : {}),
      ...(t.input ? { input: t.input } : {}),
    }));

    const instance: ProcessInstance = {
      id: instanceId,
      tenantId,
      definitionKey: def.key,
      subjectRef: body.subjectRef,
      status: "RUNNING",
      startedAt: now,
      currentTaskId: tasks[0]!.id,
    };

    await this.repos.processInstances.put(instance);
    await this.repos.processTasks.putMany(tasks);

    // 建完立刻判一次首步 gate：**不判的话，一条一建出来就该卡住的流程会先谎报 RUNNING**，
    // 直到有人调 advance 才纠正 —— 那个窗口期里前端显示的是假的。
    return this.advance(tenantId, instanceId, {});
  }

  // ────────────────────────────────────────────────────────────────────────
  // 推进
  // ────────────────────────────────────────────────────────────────────────

  /**
   * 推进实例：用调用方给的**外部事实**重判当前步的 gate。
   *
   * 三种结局：
   *  · gate 未满足 → 当前步落成对应的 `WAITING_*`，实例 `WAITING`（**这是常态，不是失败**）；
   *  · gate 满足且还有后续步 → 当前步 `DONE`（落 endedAt/durationMs/output/decision），推进到下一步并**递归判下一步的 gate**；
   *  · gate 满足且是末步 → 实例 `DONE`。
   *
   * ⚠ 调用方**不能直接指定状态**（契约里 body 只有事实、没有 status 字段）。
   * 给了 status 字段，五个等待态就退化成五个可以被随便写的字符串，
   * 「为什么卡住」的答案就变成「因为有人这么写的」——那不是孪生。
   */
  async advance(
    tenantId: string,
    instanceId: string,
    body: AdvanceProcessInstanceRequest,
  ): Promise<ProcessInstanceDetail> {
    const instance = await this.repos.processInstances.get(tenantId, instanceId);
    if (!instance) throw notFound(`ProcessInstance ${instanceId} 不存在`);

    const tasks = (await this.repos.processTasks.list(tenantId, (t) => t.instanceId === instanceId)).sort(
      (a, b) => a.seq - b.seq,
    );
    if (tasks.length === 0) throw validationError(`ProcessInstance ${instanceId} 没有任何步骤`);

    if (instance.status === "DONE" || instance.status === "CANCELLED") {
      return this.detailOf(instance, tasks);
    }

    const now = this.clock();
    const nowIso = now.toISOString();
    const ctx: ProcessGateContext = {
      now,
      availableDataKeys: body.availableDataKeys,
      externalAcks: body.externalAcks,
      approvals: body.approvals,
      userActionsDone: body.userActionsDone,
    };

    const dirty = new Map<string, ProcessTask>();
    const touch = (t: ProcessTask) => {
      dirty.set(t.id, t);
      return t;
    };

    let cursor = tasks.findIndex((t) => t.id === instance.currentTaskId);
    if (cursor < 0) cursor = tasks.findIndex((t) => t.status !== "DONE" && t.status !== "CANCELLED");
    if (cursor < 0) cursor = tasks.length; // 全做完了

    // 进来时停在哪一步。`output`/`decision` **只落在这一步**上 ——
    // 一次 advance 可能连过好几步（补齐数据后，后面几步本就无 gate），
    // 把调用方给的产出往每一步上抄，等于伪造它没做过的记录。
    const startCursor = cursor;

    let next: ProcessInstance = { ...instance };
    // 依次推进。循环上界 = 步数，防止任何情况下的死循环。
    for (let guard = 0; guard <= tasks.length && cursor < tasks.length; guard += 1) {
      const task = tasks[cursor]!;
      const verdict = evaluateGate(task.gate, ctx);

      if (verdict.waitState) {
        // ── 卡住 ──
        // `waitingSince` 只在**刚进入或换了等待成因**时重置。同一个态继续等，起点不动 ——
        // 否则每次刷新页面（每次 advance）都把「等了多久」清零，那个数字就永远是 0，
        // 前端显示的「已等 3 天」会变成「已等 0 秒」。这是本层最容易犯的静默错误。
        const sameWait = task.status === verdict.waitState && task.waitRef === verdict.waitRef;
        const blocked: ProcessTask = {
          ...task,
          status: verdict.waitState,
          startedAt: task.startedAt ?? nowIso,
          waitingSince: sameWait ? (task.waitingSince ?? nowIso) : nowIso,
          ...(verdict.waitRef ? { waitRef: verdict.waitRef } : {}),
        };
        if (!verdict.waitRef) delete (blocked as Partial<ProcessTask>).waitRef;
        tasks[cursor] = touch(blocked);
        next = { ...next, status: "WAITING", currentTaskId: task.id };
        break;
      }

      // ── 通过 ── 当前步收工。
      const startedAt = task.startedAt ?? nowIso;
      const durationMs = Math.max(0, now.getTime() - Date.parse(startedAt));
      const isEntryStep = cursor === startCursor;
      const done: ProcessTask = {
        ...task,
        status: "DONE",
        startedAt,
        endedAt: nowIso,
        durationMs,
        ...(isEntryStep && body.output ? { output: body.output } : {}),
        ...(isEntryStep && body.decision ? { decision: body.decision } : {}),
      };
      // 收工即清等待痕迹：留着 waitingSince 会让一个已完成的步看起来还在等。
      delete (done as Partial<ProcessTask>).waitingSince;
      delete (done as Partial<ProcessTask>).waitRef;
      tasks[cursor] = touch(done);

      cursor += 1;
      if (cursor >= tasks.length) {
        next = { ...next, status: "DONE", endedAt: nowIso };
        delete (next as Partial<ProcessInstance>).currentTaskId;
        break;
      }
      // 下一步开工（RUNNING），下一轮循环判它的 gate。
      const upcoming = tasks[cursor]!;
      tasks[cursor] = touch({ ...upcoming, status: "RUNNING", startedAt: upcoming.startedAt ?? nowIso });
      next = { ...next, status: "RUNNING", currentTaskId: upcoming.id };
    }

    if (dirty.size > 0) await this.repos.processTasks.putMany([...dirty.values()]);
    await this.repos.processInstances.put(next);

    return this.detailOf(next, tasks);
  }

  // ────────────────────────────────────────────────────────────────────────
  // 读侧：「为什么卡住」
  // ────────────────────────────────────────────────────────────────────────

  async detail(tenantId: string, instanceId: string): Promise<ProcessInstanceDetail> {
    const instance = await this.repos.processInstances.get(tenantId, instanceId);
    if (!instance) throw notFound(`ProcessInstance ${instanceId} 不存在`);
    const tasks = (await this.repos.processTasks.list(tenantId, (t) => t.instanceId === instanceId)).sort(
      (a, b) => a.seq - b.seq,
    );
    return this.detailOf(instance, tasks);
  }

  private async detailOf(instance: ProcessInstance, tasks: ProcessTask[]): Promise<ProcessInstanceDetail> {
    const current = tasks.find((t) => t.id === instance.currentTaskId);
    const stuck = current && isWaitState(current.status) ? await this.reasonOf(instance, current) : undefined;
    return { instance, tasks, ...(stuck ? { stuck } : {}) };
  }

  /** 把一个卡住的 (instance, task) 翻成需求那句问话的答案。 */
  private async reasonOf(instance: ProcessInstance, task: ProcessTask): Promise<ProcessStuckReason> {
    const defs = await this.repos.processDefinitions.list(instance.tenantId, (d) => d.key === instance.definitionKey);
    const def = defs[0];
    const waitedMs =
      task.waitingSince !== undefined
        ? Math.max(0, this.clock().getTime() - Date.parse(task.waitingSince))
        : undefined;
    const ownerDisplayName = OWNER_DISPLAY[task.ownerFunctionKey];

    return {
      instanceId: instance.id,
      definitionKey: instance.definitionKey,
      // 查不到定义 ⇒ 字段缺席。**不填 definitionKey 充数** —— 那会让前端把 "P17" 当流程名显示给 COO。
      ...(def?.name ? { definitionName: def.name } : {}),
      subjectRef: instance.subjectRef,
      taskId: task.id,
      taskName: task.name,
      taskSeq: task.seq,
      waitState: task.status as ProcessTaskWaitState,
      ...(task.waitRef ? { waitRef: task.waitRef } : {}),
      ownerFunctionKey: task.ownerFunctionKey,
      ...(ownerDisplayName ? { ownerDisplayName } : {}),
      ...(task.waitingSince ? { waitingSince: task.waitingSince } : {}),
      ...(waitedMs !== undefined ? { waitedMs } : {}),
    };
  }

  /**
   * 全租户「现在有哪些流程卡着、各卡在哪」。这是 COO 那句问话的入口。
   *
   * 排序：`waitedMs` 降序（等最久的排最前），缺 `waitedMs` 的沉底，同值按 `instanceId`
   * 字典序 —— 三级全定序，同数据两次查询必得同一个数组（R6）。
   */
  async stuck(tenantId: string): Promise<ProcessStuckResponse> {
    const instances = await this.repos.processInstances.list(tenantId, (i) => i.status === "WAITING");
    const reasons: ProcessStuckReason[] = [];
    for (const inst of instances) {
      if (!inst.currentTaskId) continue;
      const task = await this.repos.processTasks.get(tenantId, inst.currentTaskId);
      if (!task || !isWaitState(task.status)) continue;
      reasons.push(await this.reasonOf(inst, task));
    }

    reasons.sort((a, b) => {
      const aw = a.waitedMs ?? -1;
      const bw = b.waitedMs ?? -1;
      if (aw !== bw) return bw - aw;
      return a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0;
    });

    // 五个 key 恒在。这里的 0 是**统计事实**（真的没有流程在等审批），不是「诚实位说谎」——
    // 与可选字段缺席的纪律不冲突：那条针对的是「不知道」，这里是「知道，且为零」。
    const byWaitState = Object.fromEntries(
      PROCESS_TASK_WAIT_STATES.map((s) => [s, reasons.filter((r) => r.waitState === s).length]),
    ) as Record<ProcessTaskWaitState, number>;

    return { evaluatedAt: this.clock().toISOString(), stuck: reasons, byWaitState };
  }
}
