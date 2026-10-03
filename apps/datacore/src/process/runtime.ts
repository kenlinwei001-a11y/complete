import {
  PROCESS_OWNER_FUNCTIONS,
  PROCESS_TASK_WAIT_STATES,
  evaluateGate,
  isWaitState,
  processInstanceId,
  processInstanceKey,
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
    /**
     * ⚠ **合并后 id 必须经 `processInstanceId()` 铸**（WO-R9-PROCESS-MERGE）。
     * 合并前这里就地拼 `` `pinst_${tenantId}_${def.key}_${objectId}` ``，
     * 而反推器（`process/reconstruct.ts` → contracts §6）拼出来的是**逐字节相同的串** ——
     * 同一个 `(租户, P##, 承载对象)` 被两边各写一行时**互相覆盖**，是静默数据丢失。
     * 现在 `origin` 参与构成（MANAGED ⇒ `pinst_mg_…`）⇒ 结构上不可能再撞。
     */
    const instanceId = processInstanceId("MANAGED", tenantId, def.key, body.subjectRef.objectId);

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

    /**
     * 请求体（DTO）→ 合并后实体的字段映射**只在这一处**发生，不散落到别处：
     *   `definitionKey` → `processKey` · `subjectRef.{typeKey,objectId}` → `carrier{TypeKey,ObjectId}`。
     * 运行时实例是**单站**（一条 P## 上的一次经过），故 `flowKey = key`、`stationIndex = 0` ——
     * 这与契约里「单站流程此值 = 自身 key」是同一条口径，不是为凑字段临时编的。
     */
    const instance: ProcessInstance = {
      id: instanceId,
      tenantId,
      key: processInstanceKey(def.key, body.subjectRef.objectId),
      processKey: def.key,
      carrierObjectId: body.subjectRef.objectId,
      carrierTypeKey: body.subjectRef.typeKey,
      flowKey: processInstanceKey(def.key, body.subjectRef.objectId),
      stationIndex: 0,
      enteredAt: now,
      exitedAt: null,
      waitState: null,
      waitStateOrigin: null,
      status: "RUNNING",
      // 责任方：职能层取定义上的 ownerFunctionKey；**具体责任方如实留空** ——
      // 运行时实例的"具体是谁"落在每一步的 task 上，在实例这一层硬填一个就是把两层压成一层。
      ownerRef: { functionKey: def.ownerFunctionKey, partyField: null, partyValue: null },
      origin: "MANAGED",
      // MANAGED 的时刻由引擎自采，**没有**源单据可溯 —— 塞一条假溯源才是造假（契约 superRefine 挡住）。
      sourceDocuments: [],
      scopeObjectTypes: [body.subjectRef.typeKey],
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
   * ══ 一次 advance 只做**一件**事 ═══════════════════════════════════════════
   * 要么让当前步**开工**，要么让当前步**收工**。取决于它现在的状态：
   *
   * | 当前步状态        | gate 未满足        | gate 满足                              |
   * |-------------------|--------------------|----------------------------------------|
   * | `PENDING`/`WAITING_*` | 停在（新的）等待态 | → `RUNNING`（开工），**不收工**        |
   * | `RUNNING`         | 退回等待态         | → `DONE`（收工），下一步随即入场并判 gate |
   *
   * ⚠ **初版在这里是错的，实测抓出来的**：初版让 gate 一满足就一路跑到底，
   * 于是一条没有任何前置条件的流程**在创建的那一刻就 `DONE` 了**，
   * `Duration` 恒为 0 —— 一个「瞬间完成」的 45 天产能立项流程。
   * 根因是把 `gate`（能不能**开工**）读成了「是不是**做完了**」。
   * 前者是前置条件，后者要由调用方明说，两者不可互相推断。
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

    let next: ProcessInstance = { ...instance };

    /**
     * 让 `tasks[i]` **入场**：判它的 gate，落成等待态或 RUNNING，并同步实例状态。
     *
     * `startedAt` 在**入场即写**（不是等到 RUNNING 才写）：一个步从进入流程那一刻
     * 就开始占用前置期，等待也是耗时。于是 `durationMs` = 该步的**总停留时长**（含等待），
     * 而「其中此刻还在等多久」由 `waitingSince`/`waitedMs` 单独回答 —— 两个数各答各的问题。
     */
    const enter = (i: number) => {
      const task = tasks[i]!;
      const verdict = evaluateGate(task.gate, ctx);
      if (verdict.waitState) {
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
        tasks[i] = touch(blocked);
        /**
         * 合并后**实例这一层也要说得出「在等什么」**（原来只有 task 层有）。
         * 关键是同时落 `waitStateOrigin: "TASK_GATE"` —— 它宣告这一格是**这一单自己**
         * 的 gate 判出来的现场值，而不是从 `ProcessDefinition.waitKind` 抄来的平均值。
         * 反推产物在同一个字段上写的是 `DEFINITION_TEMPLATE`，两者一眼可辨（契约 §4 裁法①）。
         */
        next = {
          ...next,
          status: "WAITING",
          currentTaskId: task.id,
          waitState: verdict.waitState,
          waitStateOrigin: "TASK_GATE",
          ...(verdict.waitRef ? { waitRef: verdict.waitRef } : {}),
        };
        if (!verdict.waitRef) delete (next as Partial<ProcessInstance>).waitRef;
        return;
      }
      // gate 已满足 ⇒ 开工。清掉等待痕迹（不再卡着了）。
      const running: ProcessTask = { ...task, status: "RUNNING", startedAt: task.startedAt ?? nowIso };
      delete (running as Partial<ProcessTask>).waitingSince;
      delete (running as Partial<ProcessTask>).waitRef;
      tasks[i] = touch(running);
      next = { ...next, status: "RUNNING", currentTaskId: task.id, waitState: null, waitStateOrigin: null };
      delete (next as Partial<ProcessInstance>).waitRef;
    };

    if (cursor < tasks.length) {
      const task = tasks[cursor]!;
      if (task.status === "RUNNING") {
        // ── 收工 ──（只有已开工的步才能收工；`output`/`decision` 落在这一步上）
        const startedAt = task.startedAt ?? nowIso;
        const done: ProcessTask = {
          ...task,
          status: "DONE",
          startedAt,
          endedAt: nowIso,
          durationMs: Math.max(0, now.getTime() - Date.parse(startedAt)),
          ...(body.output ? { output: body.output } : {}),
          ...(body.decision ? { decision: body.decision } : {}),
        };
        // 收工即清等待痕迹：留着 waitingSince 会让一个已完成的步看起来还在等。
        delete (done as Partial<ProcessTask>).waitingSince;
        delete (done as Partial<ProcessTask>).waitRef;
        tasks[cursor] = touch(done);

        cursor += 1;
        if (cursor >= tasks.length) {
          // 合并后出站时刻叫 `exitedAt` 且是 **nullable 而非 optional**（契约裁法：
          // optional 会让「漏写」与「空值」同形，nullable 两态都能被断言）。
          next = { ...next, status: "DONE", exitedAt: nowIso, waitState: null, waitStateOrigin: null };
          delete (next as Partial<ProcessInstance>).currentTaskId;
          delete (next as Partial<ProcessInstance>).waitRef;
        } else {
          enter(cursor); // 下一步随即入场并判它的 gate
        }
      } else {
        // ── 开工（或继续卡着）── PENDING / WAITING_* 都走这里。
        enter(cursor);
      }
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
    const defs = await this.repos.processDefinitions.list(instance.tenantId, (d) => d.key === instance.processKey);
    const def = defs[0];
    const waitedMs =
      task.waitingSince !== undefined
        ? Math.max(0, this.clock().getTime() - Date.parse(task.waitingSince))
        : undefined;
    const ownerDisplayName = OWNER_DISPLAY[task.ownerFunctionKey];

    return {
      instanceId: instance.id,
      processKey: instance.processKey,
      // 查不到定义 ⇒ 字段缺席。**不填 processKey 充数** —— 那会让前端把 "P17" 当流程名显示给 COO。
      ...(def?.name ? { definitionName: def.name } : {}),
      // 合并后实体是**平铺**的两个字段；此处重新组回嵌套形，让前端能整块下钻（投影形状未变）。
      subjectRef: { typeKey: instance.carrierTypeKey, objectId: instance.carrierObjectId },
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
    /**
     * 🔴 **合并后这张表里住着两种产地的实例**（WO-R9-PROCESS-MERGE），本方法只答得了其中一种。
     *
     * 本投影的每一条都要给出 `taskId/taskName/taskSeq`（需求 §4.5「卡在第几步」），
     * 而反推产物（`DERIVED_FROM_DOCUMENT`）**没有步**——单据上没有这个事实，
     * 编一个步名出来就是造假。故此处按 `origin` 显式收窄。
     *
     * ⚠ 收窄的判据是 `origin`，**不是**「有没有 `currentTaskId`」。后者也能过滤出同一批，
     * 但那是**碰巧**：它把「这条实例是另一种东西」误表述成「这条实例数据不全」，
     * 于是下一个人会去"修"那个并不存在的缺字段。判据必须说出真正的理由。
     *
     * 且被排除的那批**不许静默消失**：`derivedStuckCount` 如实报数并指路到
     * `process_flow_time` / `GET /a/v1/process-definitions/:key/instances`。
     * 「没算」与「算出来是 0」是两个命题——不报数就是把前者伪装成后者。
     */
    const instances = await this.repos.processInstances.list(
      tenantId,
      (i) => i.status === "WAITING" && i.origin === "MANAGED",
    );
    const derivedStuckCount = (
      await this.repos.processInstances.list(
        tenantId,
        (i) => i.status === "WAITING" && i.origin === "DERIVED_FROM_DOCUMENT",
      )
    ).length;
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

    return { evaluatedAt: this.clock().toISOString(), stuck: reasons, byWaitState, derivedStuckCount };
  }
}
