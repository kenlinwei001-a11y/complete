/**
 * WO-PROCESS-INSTANCE · **流程运行时层**（`ProcessInstance` / `ProcessTask`）。
 *
 * 需求原文（`docs/PRD-enterprise-decision-twin.md` §4.5「『等待』是一等状态」）：
 *
 * > `ProcessTask.status` 必须包含：`WAITING_USER` / `WAITING_APPROVAL` / `WAITING_DATA` /
 * > `WAITING_EXTERNAL_SYSTEM` / `WAITING_SCHEDULE`。
 * > 没有这个，系统答不出「为什么这个流程现在卡住了」——而这恰恰是 COO 最想问的问题。
 *
 * ══ 这一层与 `process.ts`（模板层）是**两层**，不是一层的两半 ═══════════════
 *
 * |            | 模板层 `process.ts`                   | 运行时层（本文件）                     |
 * |------------|---------------------------------------|----------------------------------------|
 * | 回答什么   | 企业有哪些业务活动、**通常**卡在哪类等待 | **这一单**现在卡在第几步、**此刻**在等谁 |
 * | 载体       | `ProcessDefinition`（65 条·配置）      | `ProcessInstance` + `ProcessTask`（业务数据）|
 * | 时间       | `stdDurationDays`（**标准**工期）      | `startedAt/endedAt/durationMs`（**实际**）  |
 * | 等待       | `waitKind`（**这类流程**易卡在哪）     | `status: WAITING_*`（**这一单**此刻卡在哪）  |
 *
 * 混为一谈会出的错很具体：模板说「销售订单评审接单通常 `WAITING_USER`」，
 * 而**这一单**可能正卡在 `WAITING_DATA`（信用数据没回来）。
 * 用模板字段回答「为什么卡住」= 拿**平均值**冒充**现场**，那正是本仓「诚实位在说谎」的形态。
 *
 * ══ 🔴 `WAITING_APPROVAL`：为什么运行时有、模板层没有 ═══════════════════════
 *
 * `process.ts` §1 明写四值刻意不含 `WAITING_APPROVAL`，并给了**唯一的开门条件**：
 *
 * > ⚠ 这是**诚实缺席，不是漏写** …… 补了它，`ProcessDefinition` 就会开始承诺一个平台不做的能力
 * > （流程级审批既无承载物、也无状态机、也无消费方）…… **真要做审批，先有承载物再回来加这一项。**
 *
 * 三个「没有」在**运行时层**逐条落地了，所以这一项在这一层是有资格的（复验命令附后）：
 *  · **承载物** = `ActionDraft`（`apps/datacore/src/actions.ts`，`approvalSteps[]` 实存）；
 *  · **状态机** = S2 `DRAFT → PENDING_APPROVAL → APPROVED → EXECUTING`（`actions.ts:410` 注释即其原文）；
 *  · **消费方** = 本层 `evaluateGate()` 按 `approvals[actionDraftId]` 分支 + 前端卡点面板。
 *
 * ⚠ 但**模板层那四值一个字都没动**，`ProcessDefinition.waitKind` 仍拒收 `WAITING_APPROVAL`
 * （`process-layer.test.ts` 的两条断言照旧全绿）。仓主裁的是「**流程**审批不体现」——
 * 即不做「流程定义自带审批环节」这套元能力；而「**这一单**正卡在一个已存在的 `ActionDraft` 上」
 * 是对既有 S2 事实的**如实转述**，两者不是同一件事。
 *
 * ══ 单一来源：五值是**派生**的，不是重打一遍 ═══════════════════════════════
 *
 * `PROCESS_TASK_WAIT_STATES = [...PROCESS_WAIT_KINDS, "WAITING_APPROVAL"]`。
 * **刻意不写成字面量数组** —— 手抄一份四值就是 `process.ts` §1 警告的
 * 「任何一侧再写一份字面量数组」，即「两个 dev 各发明一套词表、交集为 0」那次事故的形态。
 * 派生的好处是机器化的：模板层将来增删一个 `waitKind`，本层**自动跟随**，
 * 不会出现「模板层五种、运行时四种」这种只有用户能发现的漂移。
 * 该派生关系由 `apps/datacore/test/process-instance.test.ts` 断言（不是靠注释自觉）。
 *
 * ══ R6 确定性 ═════════════════════════════════════════════════════════════
 * 本文件全是常量与 zod schema，**无时钟、无随机**。`evaluateGate()` 的「现在几点」
 * 由调用方经 `ProcessGateContext.now` 注入 —— 欠账 #141「挂在墙钟上的断言并发时必假红」的直接对策。
 */
import { z } from "zod";
import { IsoTime } from "./common.js";
import { PROCESS_WAIT_KINDS } from "./process.js";

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 运行时等待态 —— 模板四值**派生** + 审批一值
// ══════════════════════════════════════════════════════════════════════════

/**
 * 一个 `ProcessTask` 可能停住的五种等待态（需求 §4.5 逐字）。
 *
 * 顺序 = `PROCESS_WAIT_KINDS` 原序 + `WAITING_APPROVAL` 末位追加。
 * 末位追加而非插中间，是为了让「模板四值」在本数组里始终是一段**连续前缀**，
 * 派生断言可以直接比前四位，改一个字就红。
 */
export const PROCESS_TASK_WAIT_STATES = [...PROCESS_WAIT_KINDS, "WAITING_APPROVAL"] as const;
export const ProcessTaskWaitStateSchema = z.enum(PROCESS_TASK_WAIT_STATES);
export type ProcessTaskWaitState = (typeof PROCESS_TASK_WAIT_STATES)[number];

/** 非等待态：还没开始 / 正在做 / 做完了 / 不做了。 */
export const PROCESS_TASK_LIVE_STATES = ["PENDING", "RUNNING", "DONE", "CANCELLED"] as const;

/**
 * `ProcessTask.status` 全集 = 四个推进态 + 五个等待态。
 * 同样是**派生**（见文件头「单一来源」）。
 */
export const PROCESS_TASK_STATUSES = [...PROCESS_TASK_LIVE_STATES, ...PROCESS_TASK_WAIT_STATES] as const;
export const ProcessTaskStatusSchema = z.enum(PROCESS_TASK_STATUSES);
export type ProcessTaskStatus = (typeof PROCESS_TASK_STATUSES)[number];

/** 类型收窄：这个 status 是不是「卡住了」。前端「为什么卡住」区块的唯一判据。 */
export function isWaitState(s: ProcessTaskStatus): s is ProcessTaskWaitState {
  return (PROCESS_TASK_WAIT_STATES as readonly string[]).includes(s);
}

/**
 * 五个等待态的**人话**（前端展示用，单一来源在此，前端不得再写一份）。
 * `blocker` 回答「等谁/等什么」，是「为什么卡住」那句话的主语。
 */
export const PROCESS_TASK_WAIT_STATE_META: Record<
  ProcessTaskWaitState,
  { readonly displayName: string; readonly blocker: string }
> = {
  WAITING_USER: { displayName: "等人处理", blocker: "责任岗位尚未做动作" },
  WAITING_DATA: { displayName: "等数据齐", blocker: "上游数据未到齐" },
  WAITING_EXTERNAL_SYSTEM: { displayName: "等外部回话", blocker: "外部方/外部系统未回执" },
  WAITING_SCHEDULE: { displayName: "等窗口开闸", blocker: "节拍/窗口时间未到" },
  WAITING_APPROVAL: { displayName: "等审批", blocker: "审批单未批复" },
};

// ══════════════════════════════════════════════════════════════════════════
// § 2 · 前置条件 `gate` —— **五个等待态的唯一入口**
// ══════════════════════════════════════════════════════════════════════════

/**
 * 一个任务开工前必须满足的前置条件。**这是五个等待态唯一的进入方式**。
 *
 * ── 为什么是「一个声明 + 一个判定函数」而不是五个 setter ────────────────────
 * 若给每个等待态写一个 `blockOnXxx()`，那五个入口就是五条各自可能没人调的线 ——
 * 本仓 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 的标准形态（实现有、测试有、零生产调用方）。
 * 收敛成**一条** `advance() → evaluateGate()` 之后，五个态共用同一条生产链路：
 * 任何一个态没被覆盖，覆盖它的是**数据**（gate 字段）而不是**新代码**，
 * 于是「这个态能不能进入」变成可被单测穷举的问题。
 *
 * 全部字段可选：`gate` 为空 = 无前置条件 = 该任务可直接 RUNNING。
 */
export const ProcessTaskGateSchema = z.strictObject({
  /** 等**人**做动作。值为需要完成的动作标识（如 `"review"`），完成后由调用方填进 `userActionsDone`。 */
  requiresUserAction: z.string().min(1).optional(),
  /**
   * 等**审批**。值为 `ActionDraft.id`（S2 承载物 —— 见文件头「为什么运行时有」）。
   * ⚠ 这里存的是 id 不是布尔：没有具体审批单就不该声称在等审批（否则又是一个「无承载物」的空壳）。
   */
  requiresApprovalOf: z.string().min(1).optional(),
  /** 等**数据齐**。全部 key 都出现在 `availableDataKeys` 才算齐（AND 语义，不是任一）。 */
  requiresDataKeys: z.array(z.string().min(1)).optional(),
  /** 等**外部回话**。`system` = 外部方标识，`ref` = 单据/回执号。 */
  requiresExternalAck: z.strictObject({ system: z.string().min(1), ref: z.string().min(1) }).optional(),
  /** 等**窗口开闸**。ISO 时刻；`now < notBeforeAt` 即未开闸。 */
  notBeforeAt: IsoTime.optional(),
});
export type ProcessTaskGate = z.infer<typeof ProcessTaskGateSchema>;

/**
 * 判定 `gate` 时的外部事实。**`now` 必须由调用方注入** —— 见文件头 R6。
 */
export interface ProcessGateContext {
  /** 「现在几点」。注入而非 `new Date()`：欠账 #141 的直接对策。 */
  now: Date;
  /** 已到齐的数据 key。 */
  availableDataKeys?: readonly string[];
  /** 已收到的外部回执，形如 `"<system>:<ref>"`。 */
  externalAcks?: readonly string[];
  /** 审批单当前状态（key = `ActionDraft.id`）。缺 key = 尚无结论 ⇒ 仍在等。 */
  approvals?: Readonly<Record<string, "APPROVED" | "REJECTED" | "PENDING">>;
  /** 已完成的人工动作标识。 */
  userActionsDone?: readonly string[];
}

/**
 * 判定优先序 —— **确定性要求**（R6），不是审美问题。
 *
 * 一个任务可能同时缺好几项前置条件；若不定序，「为什么卡住」这句话会随实现细节抖动，
 * 同一份数据两次查询给出两个不同答案 —— 那比不显示更糟。
 *
 * 序的理由是**因果深度**：窗口没开时，数据齐不齐都推不动；数据没齐时，找外部方也没用。
 * 所以从「最外层的、最不由人控制的」排到「最内层的、最由人控制的」：
 *   窗口 → 数据 → 外部 → 审批 → 人工
 * 这个序被 `process-instance.test.ts` 的「多重阻塞取最外层」断言钉死。
 */
export const PROCESS_GATE_PRECEDENCE = [
  "WAITING_SCHEDULE",
  "WAITING_DATA",
  "WAITING_EXTERNAL_SYSTEM",
  "WAITING_APPROVAL",
  "WAITING_USER",
] as const satisfies readonly ProcessTaskWaitState[];

/** `evaluateGate` 的结论：卡住了（含成因引用），或没卡住。 */
export interface ProcessGateVerdict {
  /** 卡在哪个等待态；`undefined` = 前置条件全满足，可以推进。 */
  waitState?: ProcessTaskWaitState;
  /** 卡住的**具体对象**（审批单 id / 缺的数据 key / 外部回执号 / 窗口时刻 / 人工动作名）。 */
  waitRef?: string;
}

/**
 * 纯函数：给定 `gate` 与外部事实，判定该任务此刻卡在哪个等待态。
 *
 * **五个等待态全部由本函数产生，没有第二个产地** —— 这是上面「一个判定函数」纪律的落点。
 * 无时钟、无随机、无 I/O：同输入同输出（R6）。
 */
export function evaluateGate(gate: ProcessTaskGate | undefined, ctx: ProcessGateContext): ProcessGateVerdict {
  if (!gate) return {};

  // ① 窗口未开闸（最外层：时间没到，别的都白搭）。
  if (gate.notBeforeAt) {
    const openAt = Date.parse(gate.notBeforeAt);
    // 解析不出来的时刻不当作「已开闸」放行（fail-closed）——放行会把一个坏数据读成「一切正常」。
    if (Number.isNaN(openAt) || ctx.now.getTime() < openAt) {
      return { waitState: "WAITING_SCHEDULE", waitRef: gate.notBeforeAt };
    }
  }

  // ② 数据未齐（AND 语义；waitRef 报**第一个**缺的 key，序稳定 ⇒ 结论稳定）。
  if (gate.requiresDataKeys?.length) {
    const have = new Set(ctx.availableDataKeys ?? []);
    const missing = gate.requiresDataKeys.find((k) => !have.has(k));
    if (missing !== undefined) return { waitState: "WAITING_DATA", waitRef: missing };
  }

  // ③ 外部未回执。
  if (gate.requiresExternalAck) {
    const token = `${gate.requiresExternalAck.system}:${gate.requiresExternalAck.ref}`;
    if (!(ctx.externalAcks ?? []).includes(token)) {
      return { waitState: "WAITING_EXTERNAL_SYSTEM", waitRef: token };
    }
  }

  // ④ 审批未批复。缺 key（尚无结论）与 PENDING 同样算「在等」；REJECTED **不算在等** ——
  //    被否了不是卡住，是走另一条路，由调用方决定取消还是改单（本函数不替它做决定）。
  if (gate.requiresApprovalOf) {
    const decision = ctx.approvals?.[gate.requiresApprovalOf];
    if (decision !== "APPROVED" && decision !== "REJECTED") {
      return { waitState: "WAITING_APPROVAL", waitRef: gate.requiresApprovalOf };
    }
  }

  // ⑤ 人工动作未做（最内层）。
  if (gate.requiresUserAction) {
    if (!(ctx.userActionsDone ?? []).includes(gate.requiresUserAction)) {
      return { waitState: "WAITING_USER", waitRef: gate.requiresUserAction };
    }
  }

  return {};
}

// ══════════════════════════════════════════════════════════════════════════
// § 3 · `ProcessTask` —— 需求原文点名的八个字段
// ══════════════════════════════════════════════════════════════════════════

/**
 * 任务上挂的决策记录（需求八字段之 `Decision`）。
 *
 * ⚠ 只在**真做过决策**的任务上有；没决策就整个字段缺席 —— 不许塞
 * `{ choice: "未知" }` 之类的占位（本仓「诚实位在说谎」事故的复现方式）。
 */
export const ProcessTaskDecisionSchema = z.strictObject({
  /** 决定了什么（如 `"接单"` / `"退回改期"`）。 */
  choice: z.string().min(1),
  /** 谁决定的（userId）。 */
  decidedBy: z.string().min(1),
  decidedAt: IsoTime,
  /** 依据引用（Decision/DecisionOption/规则 id 等）。空数组 = 无依据，与「没这个字段」区别对待。 */
  basisRefs: z.array(z.string().min(1)).optional(),
});
export type ProcessTaskDecision = z.infer<typeof ProcessTaskDecisionSchema>;

/**
 * 流程实例里的一步。需求原文要的八个字段逐条落位：
 *
 * | 需求原文     | 本 schema                    |
 * |--------------|------------------------------|
 * | `Start Time` | `startedAt`                  |
 * | `End Time`   | `endedAt`                    |
 * | `Duration`   | `durationMs`（**实测**，见下）|
 * | `Owner`      | `ownerFunctionKey`           |
 * | `Status`     | `status`（4 推进 + 5 等待）  |
 * | `Input`      | `input`                      |
 * | `Output`     | `output`                     |
 * | `Decision`   | `decision`                   |
 */
export const ProcessTaskSchema = z.strictObject({
  id: z.string().min(1),
  tenantId: z.string().min(1), // R2
  /** 所属实例。 */
  instanceId: z.string().min(1),
  /** 步序（1 起）。确定性展示序，不靠 Map 迭代序（R6）。 */
  seq: z.number().int().positive(),
  name: z.string().min(1),

  /** **Owner** —— 责任职能，词表见 `process.ts` §2 `PROCESS_OWNER_FUNCTIONS`。 */
  ownerFunctionKey: z.string().min(1),

  /** **Status**。 */
  status: ProcessTaskStatusSchema,

  /** **Start Time**。未开工则缺席（不是空串）。 */
  startedAt: IsoTime.optional(),
  /** **End Time**。未结束则缺席。 */
  endedAt: IsoTime.optional(),
  /**
   * **Duration** —— 实际耗时（毫秒），**只在 `endedAt` 落定时写入**。
   *
   * ⚠ 进行中的任务**不写**这个字段，由读侧用注入时钟现算「已经跑了多久」。
   * 若在这里存一个「截至上次写库的耗时」，它会随时间静默失真 —— 那是个会说谎的字段。
   */
  durationMs: z.number().int().nonnegative().optional(),

  /** **Input**：本步的输入引用/参数。缺席 = 没有输入，不是「未知」。 */
  input: z.record(z.string(), z.unknown()).optional(),
  /** **Output**：本步的产出。同上。 */
  output: z.record(z.string(), z.unknown()).optional(),
  /** **Decision**：本步做出的决策（见上）。 */
  decision: ProcessTaskDecisionSchema.optional(),

  /** 前置条件声明（§2）。五个等待态由它 + `evaluateGate()` 产生。 */
  gate: ProcessTaskGateSchema.optional(),

  /**
   * 进入当前等待态的时刻。**只有 `status` 是 `WAITING_*` 时才有值**。
   * 「等了多久」= `now - waitingSince`，由读侧用注入时钟现算（同 `durationMs` 的理由）。
   */
  waitingSince: IsoTime.optional(),
  /** 卡住的具体对象（`evaluateGate` 的 `waitRef`）。 */
  waitRef: z.string().min(1).optional(),
});
export type ProcessTask = z.infer<typeof ProcessTaskSchema>;

// ══════════════════════════════════════════════════════════════════════════
// § 4 · `ProcessInstance`
// ══════════════════════════════════════════════════════════════════════════

/** 实例整体状态。`WAITING` = 当前步卡在某个等待态。 */
export const PROCESS_INSTANCE_STATUSES = ["RUNNING", "WAITING", "DONE", "CANCELLED"] as const;
export const ProcessInstanceStatusSchema = z.enum(PROCESS_INSTANCE_STATUSES);
export type ProcessInstanceStatus = (typeof PROCESS_INSTANCE_STATUSES)[number];

/**
 * 一条**正在跑的**业务流程 —— 即「这一单现在走到哪一步」的承载物。
 *
 * 🔴 `subjectRef` 是本层的红线，同 `ProcessDefinition.carrierTypeKey`（模板层红线 3）：
 * 模板层要求「一条流程必须有承载物**类型**」，本层要求「一个实例必须作用在具体**对象**上」。
 * 没有 subject 的实例 = 一条不知道在处理什么的流程，那是空壳不是孪生。
 */
export const ProcessInstanceSchema = z.strictObject({
  id: z.string().min(1),
  tenantId: z.string().min(1), // R2
  /** → `ProcessDefinition.key`（形如 `P17`）。 */
  definitionKey: z.string().regex(/^P\d{2}$/, "definitionKey 必须形如 P01"),
  /** 🔴 作用在哪个具体对象上（`typeKey` 应与该定义的 `carrierTypeKey` 一致）。 */
  subjectRef: z.strictObject({ typeKey: z.string().min(1), objectId: z.string().min(1) }),
  status: ProcessInstanceStatusSchema,
  startedAt: IsoTime,
  endedAt: IsoTime.optional(),
  /** 当前所在步（`ProcessTask.id`）。已完成/已取消则缺席。 */
  currentTaskId: z.string().min(1).optional(),
});
export type ProcessInstance = z.infer<typeof ProcessInstanceSchema>;

// ══════════════════════════════════════════════════════════════════════════
// § 5 · 「为什么这个流程现在卡住了」—— 读侧投影
// ══════════════════════════════════════════════════════════════════════════

/**
 * 需求那句话的**直接答案**，一条一个卡住的实例。
 *
 * 前端四问逐条对位：卡在哪一步 `taskName` · 为什么 `waitState`+`blocker` ·
 * 等谁 `ownerFunctionKey` · 等多久了 `waitedMs`。
 *
 * ⚠ **可选字段一律「没有就不下发」**，前端据此「没有就不显示那一块」。
 * 全仓已有多起「诚实位在说谎」事故 —— 下发 `"未知"`/`"-"`/`"N/A"` 比缺席更糟：
 * 缺席只是没说，占位符是**说了一句假的**，且看不出来是假的。
 */
export const ProcessStuckReasonSchema = z.strictObject({
  instanceId: z.string().min(1),
  definitionKey: z.string().min(1),
  /** 流程名（来自 `ProcessDefinition.name`）。查不到定义则缺席。 */
  definitionName: z.string().min(1).optional(),
  subjectRef: z.strictObject({ typeKey: z.string().min(1), objectId: z.string().min(1) }),

  /** 卡在哪一步。 */
  taskId: z.string().min(1),
  taskName: z.string().min(1),
  taskSeq: z.number().int().positive(),

  /** 为什么卡住（五值之一）。 */
  waitState: ProcessTaskWaitStateSchema,
  /** 卡住的具体对象（审批单 id / 缺的数据 key / 外部回执号 / 窗口时刻 / 人工动作名）。 */
  waitRef: z.string().min(1).optional(),

  /** 等谁。 */
  ownerFunctionKey: z.string().min(1),
  /** 责任职能中文名（登记册外的自定义 key 查不到 ⇒ 缺席，前端退回显示 key）。 */
  ownerDisplayName: z.string().min(1).optional(),

  /** 从什么时候开始等。 */
  waitingSince: IsoTime.optional(),
  /**
   * 等了多久（毫秒）。**由服务端用注入时钟算**，不是前端拿 `Date.now()` 减 ——
   * 前后端时钟不同步时前端会算出负数或几小时的偏差。
   * `waitingSince` 缺席时本字段一并缺席（缺就不显示，不填 0）。
   */
  waitedMs: z.number().int().nonnegative().optional(),
});
export type ProcessStuckReason = z.infer<typeof ProcessStuckReasonSchema>;

/** `GET /a/v1/process-instances/stuck` 响应。 */
export const ProcessStuckResponseSchema = z.strictObject({
  /** 判定「此刻」用的时刻（服务端注入时钟）。前端展示口径可核对，也让响应自解释。 */
  evaluatedAt: IsoTime,
  /** 按 `waitedMs` 降序（等最久的排最前）；无 `waitedMs` 的排最后。确定性序（R6）。 */
  stuck: z.array(ProcessStuckReasonSchema),
  /** 各等待态计数（五个 key 恒在，值可为 0 —— 这是**统计**不是「诚实位」，0 有意义）。 */
  byWaitState: z.record(ProcessTaskWaitStateSchema, z.number().int().nonnegative()),
});
export type ProcessStuckResponse = z.infer<typeof ProcessStuckResponseSchema>;

/** `GET /a/v1/process-instances/:id` 响应：实例 + 全部步骤（八字段齐）。 */
export const ProcessInstanceDetailSchema = z.strictObject({
  instance: ProcessInstanceSchema,
  /** 按 `seq` 升序。 */
  tasks: z.array(ProcessTaskSchema),
  /** 当前卡点；实例未卡住则缺席。 */
  stuck: ProcessStuckReasonSchema.optional(),
});
export type ProcessInstanceDetail = z.infer<typeof ProcessInstanceDetailSchema>;

// ── 请求体 ────────────────────────────────────────────────────────────────

/** `POST /a/v1/process-instances` 建实例。 */
export const CreateProcessInstanceRequestSchema = z.strictObject({
  definitionKey: z.string().regex(/^P\d{2}$/),
  subjectRef: z.strictObject({ typeKey: z.string().min(1), objectId: z.string().min(1) }),
  tasks: z
    .array(
      z.strictObject({
        name: z.string().min(1),
        ownerFunctionKey: z.string().min(1),
        gate: ProcessTaskGateSchema.optional(),
        input: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1, "至少一步 —— 零步的流程实例是空壳"),
});
export type CreateProcessInstanceRequest = z.infer<typeof CreateProcessInstanceRequestSchema>;

/**
 * `POST /a/v1/process-instances/:id/advance` 推进。
 *
 * body 里带的是**外部事实**（数据到齐了 / 外部回执收到了 / 审批批了 / 人做完了），
 * 引擎据此重判 gate —— 而不是让调用方直接指定「把状态改成 X」。
 * 后者等于把状态机交给调用方，五个等待态就又变成五个可以被随便写的字符串。
 */
export const AdvanceProcessInstanceRequestSchema = z.strictObject({
  availableDataKeys: z.array(z.string().min(1)).optional(),
  externalAcks: z.array(z.string().min(1)).optional(),
  approvals: z.record(z.string(), z.enum(["APPROVED", "REJECTED", "PENDING"])).optional(),
  userActionsDone: z.array(z.string().min(1)).optional(),
  /** 为当前步落 Output（推进成功时写入）。 */
  output: z.record(z.string(), z.unknown()).optional(),
  /** 为当前步落 Decision（推进成功时写入）。 */
  decision: ProcessTaskDecisionSchema.optional(),
});
export type AdvanceProcessInstanceRequest = z.infer<typeof AdvanceProcessInstanceRequestSchema>;
