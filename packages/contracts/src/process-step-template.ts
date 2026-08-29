/**
 * WO-STEP-TEMPLATE-LAYER · **流程步骤模板层**（`ProcessDefinition` 与 `ProcessTask` 之间缺的那一层）。
 *
 * ══ 这一层为什么必须存在（不是"顺手补个字段"）═══════════════════════════════
 *
 * `POST /a/v1/process-instances` 的请求体 `CreateProcessInstanceRequestSchema`
 * （`process-runtime.ts`）要求 `tasks.min(1)` —— **建实例必须把步骤逐条给全**。
 * 而 `ProcessDefinitionSchema`（`process.ts`）**九个字段里没有一个是步骤**
 * （`id`/`tenantId`/`key`/`domainKey`/`name`/`ownerFunctionKey`/`stdDurationDays`/
 * `waitKind`/`carrierTypeKey`），`seed.ts` 的 65 条种子同样没有。
 * ⇒ 前端**没有任何数据源可填 `tasks`**：接一个"启动流程"按钮，前端就得凭空发明步骤 ——
 * 那正是 `process/runtime.ts` `create()` 自己那条「不许凭空建」红线所反对的。
 *
 * 本文件补的就是那个数据源。**红线不放宽**：`tasks.min(1)` 一个字未动，
 * 变的是"步骤从哪来" —— 从**模板**来，不从前端的想象来。
 *
 * ══ 🔴 三条设计裁决（都要能被机器咬住，不是注释里的自觉）═══════════════════
 *
 * **① 独立对象类型，不内嵌进 `ProcessDefinition`。** 三条实测理由：
 *   · `ProcessDefinitionSchema` 是 `z.strictObject`，而**上屏文案**逐字声称它的字段就那几个
 *     （`apps/frontend-shell/src/locales/zh.ts` 第五档线路图那段：「ProcessDefinition 是 zod
 *     strictObject，字段恰好是 key/domainKey/name/ownerFunctionKey/stdDurationDays/waitKind/
 *     carrierTypeKey，没有 predecessor/successor/stationIndex」，`docs/SYSTEM-ONTOLOGY.md`
 *     同样写着「字段就那九个」）。内嵌一个步骤数组，这两处当场变成**假话**，
 *     且它们是**说给用户看的诚实位** —— 本仓 `G-FRONTEND-HARDCODED-ABSENCE` 记的就是这个病。
 *   · 步骤是 N 条 / 流程、可增删改的配置；塞进 doc-jsonb 会让「改一步」变成「重写整条定义」。
 *   · 65 条里**只有一部分**有模板。独立表让「有没有模板」= **行存在与否**，
 *     天然分得开「没有模板」与「模板是空数组」；内嵌方案里这两者同形（`undefined` vs `[]`），
 *     而它们该给用户看的话完全不同。
 *
 * **② 模板层与运行时层的边界一个字不糊**（`process.ts` §1 与 `process-runtime.ts` 文件头
 *   已经立好的那条界，本文件只是落在同一侧）：
 *
 *   | 本文件（模板层）                    | 运行时层 `ProcessTask`                |
 *   |-------------------------------------|---------------------------------------|
 *   | `waitKind` **四值**（模板词表）     | `status` 五值（含 `WAITING_APPROVAL`）|
 *   | `stdDurationDays` **计划**工期      | `startedAt/endedAt/durationMs` **实测**|
 *   | 「**这类**流程通常怎么走」          | 「**这一单**此刻走到哪」              |
 *
 *   ⛔ 因此本文件**刻意不含 `gate`**。`ProcessTaskGate` 里装的是 `ActionDraft.id` /
 *   具体数据 key / 外部回执号 —— 全是**这一单的现场事实**，模板给不出。
 *   模板硬塞一个 gate = 拿平均值冒充现场，与「不拿标准工期冒充实测卡顿」同一条禁令。
 *   于是 `tasksFromStepTemplate()` 产出的 task **一律无 gate**（= 无前置条件），
 *   现场事实由调用方随后经 `advance` 喂进来。这条由接缝测试咬住。
 *
 * **③ 步骤不许凭空发明 —— 每一步必须有可核锚点 + 工期守恒。** 见 §2 的两条不变量。
 *
 * ══ R6 确定性 / R14 行业无关 ═══════════════════════════════════════════════
 * 本文件全是常量、zod schema 与纯函数，无时钟无随机。
 * 步名/责任职能/工期分摊属**电池制造行业模板**内容，落 `apps/datacore/src/process/step-templates.ts`，
 * 不在本文件 —— 与 `process.ts` 文件头「换行业换种子，契约不动」同一条纪律。
 */
import { z } from "zod";
import { ProcessWaitKindSchema } from "./process.js";

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 一步（`ProcessStepTemplate`）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 一步在**承载对象**上留下的痕迹 —— 「这一步不是我编的，它在单据上有落点」。
 *
 * 两种锚各有判据，**不许混用**：
 *  · `TIMESTAMP_FIELD` —— 这一步在承载对象上对应一个**时刻字段**（如 `IncomingInspection.arrivedDay`）。
 *    可核判据：该 `propKey` 必须在**真跑过种子的本体**里该 `carrierTypeKey` 上查得到。
 *  · `STATUS_VALUE`    —— 这一步对应承载对象**状态机的一个阶段值**（如 `WorkOrder.status="生产中"`）。
 *    可核判据更严：除 `propKey` 要存在外，`value` 必须在该类型的**真实对象**里至少出现过一次 ——
 *    注释里写着的枚举不算数（本仓 `PropertyDef.enumValues` 大量未声明，只写在行尾注释里，
 *    照注释建模就是照"看起来相关的东西"下结论，铁律 0.6 点名的那个病）。
 *
 * ⚠ **`null` 不是本类型的合法取值**：`ProcessStepTemplateSchema.carrierAnchor` 本身也不可为 `null`。
 * 「这一步在单据上没有痕迹」= 这一步**建不出来**，不是"建出来但标个空" ——
 * 允许无锚的步，就等于给"发明步骤"留了一个语法上合法的口子。
 */
export const ProcessStepAnchorSchema = z.strictObject({
  kind: z.enum(["TIMESTAMP_FIELD", "STATUS_VALUE"]),
  /** 承载对象上的属性 key（`TIMESTAMP_FIELD` 即时刻字段名；`STATUS_VALUE` 通常是 `status`）。 */
  propKey: z.string().min(1),
  /** 阶段值。`STATUS_VALUE` 必填；`TIMESTAMP_FIELD` 必须为 `null`（时刻字段没有"值"这一说）。 */
  value: z.string().min(1).nullable(),
});
export type ProcessStepAnchor = z.infer<typeof ProcessStepAnchorSchema>;

/**
 * **工期粒度：半天**。
 *
 * 为什么要有这条：工期守恒（§2 不变量 ②）会逼着把定义工期分摊到各步。
 * 若粒度不限，一条 1 天的流程拆三步就会写出 `0.34 / 0.33 / 0.33` —— 那个精度是**编出来的**，
 * 没有任何依据。限死半天之后，「1 天拆三步」在算术上就不成立 ⇒ 那条流程**建不出模板**，
 * 于是它会如实落到缺席清单里，而不是被一组假小数糊过去。
 *
 * 0.5 这个粒度不是随手定的：`ProcessDefinitionSchema.stdDurationDays` 的注释原文就是
 * 「允许小数（`0.5` = 半天）」—— 本层沿用同一个刻度，不另立一个。
 */
export const PROCESS_STEP_DURATION_GRAIN_DAYS = 0.5;

/** 浮点比较的整数化倍率（0.5 粒度 ⇒ ×2 即化为整数，彻底避开 `0.1+0.2 !== 0.3`）。 */
const GRAIN_SCALE = 1 / PROCESS_STEP_DURATION_GRAIN_DAYS;

export const ProcessStepTemplateSchema = z.strictObject({
  /** 仓储主键。种子里形如 `pstep_<tenant>_P35_1`（由 `processStepTemplateId()` 单一产地铸）。 */
  id: z.string().min(1),
  tenantId: z.string().min(1), // R2
  /** 所属流程定义 → `ProcessDefinition.key`。 */
  processKey: z.string().regex(/^P\d{2}$/, "processKey 必须形如 P01"),
  /** 步序（1 起，同一流程内连续无缺号 —— 由 §2 不变量 ① 校验）。 */
  seq: z.number().int().positive(),
  /** 步名（行业模板内容）。 */
  name: z.string().min(1),
  /** 谁做。词表见 `process.ts` §2 `PROCESS_OWNER_FUNCTIONS`（契约不闭合，种子受测试约束）。 */
  ownerFunctionKey: z.string().min(1),
  /**
   * 本步的**计划**工期（天）。半天粒度、必须为正；各步之和 == 定义的 `stdDurationDays`。
   * ⛔ 这是计划值，不是实测 —— 实测在 `ProcessTask.durationMs`，两个数各答各的问题。
   */
  stdDurationDays: z.number().positive(),
  /** 本步通常卡在哪类等待。**模板层四值**（不含 `WAITING_APPROVAL`，见文件头裁决 ②）。 */
  waitKind: ProcessWaitKindSchema,
  /** 承载对象上的锚点（见上）。**不可缺席** —— 无锚 = 这一步没有依据。 */
  carrierAnchor: ProcessStepAnchorSchema,
  /**
   * 依据出处：这一步是**从哪读来的**，具体到文件 + 那段话在说什么。
   * 照 `apps/datacore/src/process/flow-rules.ts` `PROCESS_FLOW_STRUCTURAL_NOTES.probe` 的既有惯例 ——
   * 把「为什么这么建」连同取证留在原地，下一个人才不会照缺省理由改错方向。
   */
  basis: z.string().min(1),
});
export type ProcessStepTemplate = z.infer<typeof ProcessStepTemplateSchema>;

/** id 单一产地（照 `processInstanceId()` 的既有做法：拼串只许有一处，免两边各拼一份而撞车）。 */
export const processStepTemplateId = (tenantId: string, processKey: string, seq: number): string =>
  `pstep_${tenantId}_${processKey}_${seq}`;

// ══════════════════════════════════════════════════════════════════════════
// § 2 · 一组模板的不变量 —— 「凭空发明步骤」在这里要付代价
// ══════════════════════════════════════════════════════════════════════════

/**
 * 一条流程的整组步骤模板必须同时满足：
 *
 * **① 步序连续**：`seq` 从 1 起、逐一递增、无重复、无缺号。
 *    缺号意味着"有一步被删了但没人知道"，那会让「第 3 步」在不同时间指向不同的事。
 *
 * **② 工期守恒**：`Σ 步.stdDurationDays === ProcessDefinition.stdDurationDays`，
 *    且每步工期是 `PROCESS_STEP_DURATION_GRAIN_DAYS` 的整数倍。
 *
 *    这一条是本层**最重要**的一条，形态抄的是 `procurement.ts` 里已经生效的那把锁
 *    （`ProcurementLeadTimeSchema` superRefine 硬绑 `totalDays === procurementTotalDays(legs)`，
 *      文件头写着「把四段耗时合成一个数这件事在契约层就过不去」）。
 *
 *    它治的病很具体：**步骤模板层不许引入新的"总量"真值**。加一步就必须从别的步匀出天数，
 *    于是"随手多编一步"不再是免费的 —— 它会当场改变一个已经被别处引用的数
 *    （`ProcessDefinition.stdDurationDays` 是 `/inspect` 与线路图都在下发的口径），
 *    要么算术不成立、要么改动可见。两条路都通不到"悄悄多一步"。
 *
 * **③ 同属一条流程**：所有 `processKey` 必须等于该定义的 `key`（孤儿模板一律拒）。
 *
 * 返回**问题清单**而不是抛异常：调用方（种子 / 路由 / 测试）各有各的处置 ——
 * 种子要当场炸，路由要转成 400，测试要逐条比对。抛异常会把这三种处置压成一种。
 */
export interface ProcessStepTemplateSetIssue {
  code: "SEQ_NOT_CONTIGUOUS" | "DURATION_SUM_MISMATCH" | "DURATION_GRAIN" | "FOREIGN_PROCESS_KEY" | "EMPTY_SET";
  message: string;
}

export function validateProcessStepTemplateSet(
  definition: { key: string; stdDurationDays: number },
  steps: readonly ProcessStepTemplate[],
): ProcessStepTemplateSetIssue[] {
  const issues: ProcessStepTemplateSetIssue[] = [];

  if (steps.length === 0) {
    // 空集不是"没有模板"——"没有模板"是这条流程一行都没有。走到这里说明有人存了个空数组。
    issues.push({
      code: "EMPTY_SET",
      message: `流程 ${definition.key} 的步骤模板为空集。「没有模板」应表现为一行都没有，不是存一个空数组`,
    });
    return issues;
  }

  const foreign = steps.filter((s) => s.processKey !== definition.key);
  if (foreign.length > 0) {
    issues.push({
      code: "FOREIGN_PROCESS_KEY",
      message: `步骤模板的 processKey 与流程 ${definition.key} 不符：${[...new Set(foreign.map((s) => s.processKey))].join(",")}`,
    });
  }

  const seqs = [...steps].map((s) => s.seq).sort((a, b) => a - b);
  const expected = seqs.map((_, i) => i + 1);
  if (seqs.join(",") !== expected.join(",")) {
    issues.push({
      code: "SEQ_NOT_CONTIGUOUS",
      message: `流程 ${definition.key} 的步序必须从 1 起连续无缺号，实测 [${seqs.join(",")}]`,
    });
  }

  for (const s of steps) {
    const scaled = s.stdDurationDays * GRAIN_SCALE;
    if (Math.abs(scaled - Math.round(scaled)) > 1e-9) {
      issues.push({
        code: "DURATION_GRAIN",
        message: `流程 ${definition.key} 第 ${s.seq} 步的工期 ${s.stdDurationDays} 天不是 ${PROCESS_STEP_DURATION_GRAIN_DAYS} 天的整数倍 —— 那个精度没有依据（见契约 §1 半天粒度一节）`,
      });
    }
  }

  // 整数化后比较：0.5 粒度 ×2 恒为整数，绕开浮点累加误差。
  const sumScaled = steps.reduce((acc, s) => acc + Math.round(s.stdDurationDays * GRAIN_SCALE), 0);
  const defScaled = Math.round(definition.stdDurationDays * GRAIN_SCALE);
  if (Math.abs(definition.stdDurationDays * GRAIN_SCALE - defScaled) > 1e-9 || sumScaled !== defScaled) {
    issues.push({
      code: "DURATION_SUM_MISMATCH",
      message: `工期守恒不成立：流程 ${definition.key} 的 stdDurationDays=${definition.stdDurationDays}，而各步之和=${sumScaled / GRAIN_SCALE}。步骤模板不得引入新的总量真值（见契约 §2 不变量 ②）`,
    });
  }

  return issues;
}

// ══════════════════════════════════════════════════════════════════════════
// § 3 · 模板 → 建实例请求的 `tasks` —— **唯一一处转换实现**
// ══════════════════════════════════════════════════════════════════════════

/**
 * 把一组步骤模板折成 `CreateProcessInstanceRequest["tasks"]`。
 *
 * ⚠ **前端不许自己拼这个数组**。前端拼一份、后端将来再拼一份，就是本仓反复出事的
 * 「两个 dev 各发明一套词表、交集为 0」的形态。转换只此一处，两侧 import 同一个函数。
 *
 * ⛔ **不产出 `gate`**（文件头裁决 ②）：模板知道「这类流程通常等数据」，
 * 不知道「这一单在等哪个数据 key」。前者是 `waitKind`（已在模板里、供界面提示），
 * 后者是 `gate`（现场事实，只能由调用方经 `advance` 喂进来）。
 * 拿 `waitKind` 造一个 gate 出来，建出的实例会一上来就"卡"在一个**编出来的**成因上。
 *
 * 入参按 `seq` 升序排好再转（不依赖调用方给的数组序 —— R6：同一组模板必得同一份 tasks）。
 */
export function tasksFromStepTemplate(
  steps: readonly ProcessStepTemplate[],
): { name: string; ownerFunctionKey: string }[] {
  return [...steps]
    .sort((a, b) => a.seq - b.seq)
    .map((s) => ({ name: s.name, ownerFunctionKey: s.ownerFunctionKey }));
}

// ══════════════════════════════════════════════════════════════════════════
// § 4 · 读侧投影 `GET /a/v1/process-definitions/{key}/step-template`
// ══════════════════════════════════════════════════════════════════════════

/**
 * 「这条流程还没有步骤模板」的**结构化**说明。
 *
 * 做成字段而不是一句前端文案，理由与 `ProcessInspectRuntimeSchema` 那条一样：
 * 写在前端的诚实位会随改版蒸发，字段能被测试咬住。
 * `probe` 是**可复跑的探针**（照 `PROCESS_FLOW_STRUCTURAL_NOTES.probe` 惯例）——
 * 「暂无数据」这种什么都没说的话在本层是不合格的。
 */
export const ProcessStepTemplateAbsenceSchema = z.strictObject({
  /** 缺在哪一环。必须说清是"没观察过这条流程"还是"观察过但拆不出两步"。 */
  reason: z.string().min(1),
  /** 怎么自己复验这句话。 */
  probe: z.string().min(1),
});
export type ProcessStepTemplateAbsence = z.infer<typeof ProcessStepTemplateAbsenceSchema>;

export const ProcessStepTemplateResponseSchema = z.strictObject({
  processKey: z.string().min(1),
  /** 流程名（定义查得到才有；查不到本端点直接 404，故此处必有）。 */
  processName: z.string().min(1),
  /** 承载物类型 key —— 建实例时 `subjectRef.typeKey` 必须等于它（`create()` 会校验）。 */
  carrierTypeKey: z.string().min(1),
  /** 定义的标准工期（**对照列**：各步之和恒等于它，见 §2 不变量 ②）。 */
  definitionStdDurationDays: z.number().positive(),
  /** `true` = 有模板，`steps` 非空且 `absence` 为 `null`；`false` = 反之。两者互斥，由服务端保证。 */
  available: z.boolean(),
  /** 按 `seq` 升序（R6：不依赖 Store 迭代序）。 */
  steps: z.array(ProcessStepTemplateSchema),
  /** `available=false` 时非空。 */
  absence: ProcessStepTemplateAbsenceSchema.nullable(),
  /**
   * 各步工期之和。`available=false` 时为 `null` —— **不是 0**：
   * 「没有模板所以算不出」与「模板算出来是 0」是两个命题，0 会被读成后者。
   */
  stepsTotalStdDurationDays: z.number().nullable(),
});
export type ProcessStepTemplateResponse = z.infer<typeof ProcessStepTemplateResponseSchema>;
