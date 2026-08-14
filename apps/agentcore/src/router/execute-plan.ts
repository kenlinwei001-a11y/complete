import type { Answer, AnswerBlock, ComposePlan, ProvenanceRef } from "@platform/contracts";
import { newId } from "../ids.js";
import type { LlmClient } from "../llm/types.js";
import type { GuardedToolExecutor } from "../tools/executor.js";

/**
 * WO-Phase2-C-COMPLETE · 组合路径执行器（executePlan·「能用半」）。
 *
 * 定位（本体 §3 QOS 编排链·组合路径节点）：`compileSolverPlan` 出 ComposePlan 后，本执行器在**服务端**逐步跑：
 *  - 复用 path-A 的 invoke 通道——orchestrator 传入 `makeExecutor(taskId, auth, budget)` 产出的 `GuardedToolExecutor`，
 *    `executor.run("invoke_solver", {solverKey, args})` 直达 DataCore 求解器（OBO 透传），**全程不经 `runAgentLoop`**
 *    （这是与 path-B 的分水岭：组合命中题绝不落 agent 盲选多跳）。
 *  - 按 `parallelGroup` 升序：**同组并发**（`Promise.all`·无依赖）·**组间串行**（后组 argsFrom 依赖前组产物）。
 *  - **动态接线在服务端做·不经 LLM**：每步执行前把 `argsFrom{fromStep,outputPath,toArg}` 从上游产物按 outputPath 取值填入本步 args。
 *  - 全步跑完 → 汇总各步 {data, provenance} → **调一次 LLM `compose`** 综合产 `synthesizeBlocks`。无 provider → 诚实确定性兜底（不假装 LLM）。
 *
 * 不变量：
 *  - **R6**：同 plan 同执行序 → 同产物（组间串行·组内无共享写副作用·汇总按 step 顺序稳定）。
 *  - **数字红线**：综合步不产数——每业务数字须 `⟦ref:N⟧` 溯到第 N 步产物；scan 到未溯源裸数 → `unverifiedNumerics=true`（诚实标）。
 *  - **R13 provenance 贯通**：每步一条 ProvenanceRef（source=TOOL_RESULT·toolCallId 指向该步 invoke_solver 审计）。
 *  - **口径**：含 LLM 综合 → trustLevel=`AGENT_EXPLORATORY`（绝不冒充 VERIFIED_WORKFLOW「数据库事实」）。
 */

/** 单步产物（服务端执行留痕·上游产物供下游 argsFrom 取值 + 综合输入）。 */
export interface StepProduct {
  stepId: string;
  solverKey: string;
  toolCallId: string;
  ok: boolean;
  outcome: string;
  data: unknown;
  snapshotVersion?: string;
  args: Record<string, unknown>;
}

export interface ExecutePlanCtx {
  /** path-A invoke 通道（makeExecutor 产物）——组合路径复用之，绝不另起 runAgentLoop。 */
  executor: GuardedToolExecutor;
  /** 综合用 LLM（compose 单次原语·与 agent()/runAgentLoop 完全分离）。 */
  llm: LlmClient;
  model: string;
  tenantId: string;
  /** 逐步/诊断事件（复用既有事件名·不新增 PRD §8.2）。 */
  emit?: (event: string, payload: unknown) => Promise<void>;
  /**
   * 本租户该用途**是否真有可用 provider**（`llmSettings.providerAvailable` 的结果）。
   * 只用于综合失败时把「真没绑」与「绑了但打不通」分开——这两种病的修法完全不同。
   * 不传 ⇒ 保守当作「有」（既有调用方零回归；此时失败会归入 MODEL_MISSING/RATE_LIMITED/CALL_FAILED 而非诬告没绑）。
   */
  hasLlmProvider?: boolean;
}

export interface ExecutePlanResult {
  answer: Answer;
  /** 服务端真跑的步数（= plan.steps 数）。 */
  stepCount: number;
  /** LLM 综合调用次数（恒 0 或 1·组合路径只综合一次）。 */
  synthCount: number;
  /** 是否真调了 LLM 综合（false = 无 provider 确定性兜底）。 */
  usedLlm: boolean;
  products: StepProduct[];
}

/** ToolPayload 一般为 {data, snapshotVersion}；取其 data 作为求解器业务产物（无 data 字段则退回整体）。 */
function extractData(payload: unknown): { data: unknown; snapshotVersion?: string } {
  if (payload && typeof payload === "object" && "data" in (payload as Record<string, unknown>)) {
    const p = payload as Record<string, unknown>;
    const snap = typeof p.snapshotVersion === "string" ? p.snapshotVersion : undefined;
    return snap ? { data: p.data, snapshotVersion: snap } : { data: p.data };
  }
  return { data: payload };
}

/** 按 outputPath 从上游产物取值（顶层 key·支持 `$` / `$.x` / `x.y` 形）。取不到 → undefined（宁缺不臆造）。 */
function readOutputPath(data: unknown, outputPath: string): unknown {
  let path = (outputPath ?? "").trim();
  if (path === "$" || path === "") return data;
  if (path.startsWith("$.")) path = path.slice(2);
  else if (path.startsWith("$")) path = path.slice(1);
  let cur: unknown = data;
  for (const seg of path.split(".")) {
    if (!seg) continue;
    if (cur && typeof cur === "object" && seg in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

/** 数字红线扫描：去掉 ⟦…⟧ 溯源标记后仍存在裸业务数字 → 未溯源（诚实标 unverifiedNumerics）。 */
function scanUnverified(text: string): boolean {
  const stripped = text.replace(/⟦[^⟧]*⟧/g, "");
  return /\d/.test(stripped);
}

/**
 * 提取单步产物的**核心标量字段**（top-level number/string/boolean）→ 供确定性兜底内嵌可核数字。
 * 跳过数组/嵌套对象（perBaseRows/provenance 等大结构·避免噪声）；核心口径值（thresholdQty/capWanP90/baselineDemand/
 * mainBottleneck/gap/ok/summary …）均为 top-level 标量，故此过滤即覆盖各求解器的可核心数。长串截断。
 */
export function coreScalars(data: unknown): { key: string; value: string }[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const out: { key: string; value: string }[] = [];
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (typeof v === "number" || typeof v === "boolean") out.push({ key: k, value: String(v) });
    else if (typeof v === "string" && v.length > 0) out.push({ key: k, value: v.length > 160 ? `${v.slice(0, 157)}…` : v });
    // 数组/对象跳过（大结构·非顶层标量口径值）。
  }
  return out;
}

/**
 * LLM 综合**失败时**的确定性兜底（诚实：明说未经 LLM 综合叙述·不假装）。每步以 ⟦ref:N⟧ 指向其产物。
 * ⚠️ 这句原文是「无 LLM provider 时的确定性兜底」——**与函数实际触发条件不符**：它由 executePlan 的
 *    `catch` 触发，四种失败（真没绑 / 模型名不存在 / 限流 / 调用失败）都会走到这里。留着这句注释，
 *    等于让下一个读代码的人继续相信「走到这儿 = 没绑 provider」，而那正是 classifySynthFailure 刚治好的病。
 * WO-DIALOGUE-Q1Q2（治「未溯源空壳」类·reviewer flag）：**为所有 solver 步**内嵌其核心标量字段
 * （thresholdQty/capWanP90/baselineDemand/mainBottleneck/summary …），使无 LLM 时答案也显**可核数字**而非空 ⟦ref⟧ 壳；
 * 每数仍绑其步 ⟦ref:N⟧（→ provenance[N]·R13 溯源），非裸编（数字红线 scanUnverified 只对 LLM 综合启用·此处诚实标）。
 */
/**
 * 综合失败的**真实原因**（诚实分档）。此前一律说「无 LLM provider」，
 * 而实际有四种完全不同的失败，处置方式各不相同 —— 说错了会把人指去错的地方修：
 *  · NO_PROVIDER   —— 真没绑        ⇒ 去「设置 → LLM」绑一个
 *  · MODEL_MISSING —— 绑了但模型名不存在/无权限（如 404 model not found） ⇒ 去改模型名
 *  · RATE_LIMITED  —— 限流/配额     ⇒ 等或换模型
 *  · CALL_FAILED   —— 其余调用失败（超时/网络/5xx）⇒ 看原文
 * 仓主实测踩过：绑了 kimi 但模型名写成不存在的 `kimi-k2-0905-preview`（Kimi 返 404），
 * 系统却报「当前未接入可用的 LLM 提供商」——**明明接了**，于是人跑去设置页反复检查绑定，白费工夫。
 */
export type SynthFailKind = "NO_PROVIDER" | "MODEL_MISSING" | "RATE_LIMITED" | "CALL_FAILED";

export function classifySynthFailure(err: unknown, hasProvider: boolean): { kind: SynthFailKind; detail: string } {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (!hasProvider) return { kind: "NO_PROVIDER", detail: msg };
  if (/not found the model|model_not_found|resource_not_found|\b404\b|permission denied/i.test(msg)) {
    return { kind: "MODEL_MISSING", detail: msg };
  }
  if (/rate.?limit|too many requests|\b429\b|quota/i.test(msg)) return { kind: "RATE_LIMITED", detail: msg };
  return { kind: "CALL_FAILED", detail: msg };
}

/** 失败原因 → 人读抬头（**含可执行的下一步**，不只是"失败了"）。 */
function synthFailHead(f: { kind: SynthFailKind; detail: string }): string {
  const d = f.detail ? `：${f.detail.slice(0, 160)}` : "";
  switch (f.kind) {
    case "NO_PROVIDER":
      return "未接入 LLM 提供商 → 未作综合叙述。请在「设置 → LLM」绑定一个提供商";
    case "MODEL_MISSING":
      return `LLM 已绑定，但**模型不存在或无权限**${d} → 未作综合叙述。请在「设置 → LLM」改用该 provider 真实支持的模型名`;
    case "RATE_LIMITED":
      return `LLM 已绑定，但**被限流/超配额**${d} → 未作综合叙述。请稍后重试或更换模型`;
    default:
      return `LLM 已绑定，但**调用失败**${d} → 未作综合叙述`;
  }
}

function deterministicSynthesis(products: StepProduct[], blocks: string[], fail?: { kind: SynthFailKind; detail: string }): string {
  const head = `【组合路径·确定性汇总（${fail ? synthFailHead(fail) : "未作综合叙述"}，逐步产物+核心数字如下）】`;
  const want = blocks.length ? `（拟综合：${blocks.join("/")}）` : "";
  const lines = products.map((p, i) => {
    const scalars = coreScalars(p.data);
    const nums = scalars.length ? `：${scalars.map((s) => `${s.key}=${s.value}`).join("，")}` : "（无标量字段·详见 ⟦ref⟧）";
    return `- 步骤 ${i} · ${p.solverKey}（outcome=${p.outcome}·⟦ref:${i}⟧）${nums}`;
  });
  return [head + want, ...lines].join("\n");
}

/**
 * 执行组合计划（服务端多步 + 一次综合·全程不落 runAgentLoop）。
 */
export async function executePlan(plan: ComposePlan, ctx: ExecutePlanCtx): Promise<ExecutePlanResult> {
  const products = new Map<string, StepProduct>();
  // parallelGroup 升序（组间串行·后组依赖前组产物）。
  const groups = [...new Set(plan.steps.map((s) => s.parallelGroup))].sort((a, b) => a - b);

  for (const g of groups) {
    // 组内按 stepId 稳定排序（R6·汇总顺序确定·并发无序副作用无害）。
    const groupSteps = plan.steps
      .filter((s) => s.parallelGroup === g)
      .sort((a, b) => (a.stepId < b.stepId ? -1 : a.stepId > b.stepId ? 1 : 0));

    const groupResults = await Promise.all(
      groupSteps.map(async (step): Promise<StepProduct> => {
        const args: Record<string, unknown> = { ...step.args };
        // 动态接线：从已完成上游产物按 outputPath 取值填入本步 args[toArg]（服务端做·不经 LLM）。
        for (const wire of step.argsFrom) {
          const up = products.get(wire.fromStep);
          if (!up) continue;
          const v = readOutputPath(up.data, wire.outputPath);
          if (v != null) args[wire.toArg] = v;
        }
        const run = await ctx.executor.run("invoke_solver", { solverKey: step.solverKey, args });
        const { data, snapshotVersion } = extractData(run.payload);
        await ctx.emit?.("step.completed", {
          stepId: step.stepId,
          type: "compose_step",
          outcome: `${step.solverKey}:${run.outcome}`,
          durationMs: run.durationMs,
        });
        return {
          stepId: step.stepId,
          solverKey: step.solverKey,
          toolCallId: run.toolCallId,
          ok: run.ok,
          outcome: run.outcome,
          data,
          ...(snapshotVersion ? { snapshotVersion } : {}),
          args,
        };
      }),
    );
    for (const r of groupResults) products.set(r.stepId, r);
  }

  // 汇总：按 plan.steps 声明顺序稳定排列（供 ⟦ref:N⟧ 索引对齐）。
  const ordered: StepProduct[] = plan.steps.map((s) => products.get(s.stepId)).filter((p): p is StepProduct => Boolean(p));

  // R13：每步一条 provenance（source=TOOL_RESULT·指向该步 invoke_solver 审计）。⟦ref:N⟧ ↔ provenance[N]。
  const provenance: ProvenanceRef[] = ordered.map((p) => ({
    id: newId("prov"),
    source: "TOOL_RESULT" as const,
    toolCallId: p.toolCallId,
    toolName: "invoke_solver",
    outputPath: "$",
    ...(p.snapshotVersion ? { snapshotVersion: p.snapshotVersion } : {}),
  }));

  // 综合一次（compose 单原语·不经 runAgentLoop）。无 provider/异常 → 诚实确定性兜底。
  const inputs = ordered.map((p, i) => ({ ref: i, solverKey: p.solverKey, data: p.data }));
  let synthText: string;
  let usedLlm = false;
  let synthCount = 0;
  let synthFail: { kind: SynthFailKind; detail: string } | undefined;
  try {
    synthText = await ctx.llm.compose({
      model: ctx.model,
      instruction:
        `你是组合路径综合器。综合以下 ${ordered.length} 个求解器步骤的产物，产出【${plan.synthesizeBlocks.join("】【")}】结论。` +
        `硬约束：综合步**不得自行编造任何数字**；每个业务数字必须以 ⟦ref:N⟧ 标注其来自第 N 步产物（N 从 0 起，对应输入 inputs[N]）。`,
      inputs,
      tenantId: ctx.tenantId,
    });
    usedLlm = true;
    synthCount = 1;
  } catch (err) {
    // ⛔ 此处**曾是裸 catch**：任何失败（模型名不存在 / 限流 / 超时 / 真没绑）都被吞掉，
    //    然后统一打印「无 LLM provider」。四种病一个诊断 —— 人照着它去修，多半修错地方。
    //    现改为：拿真实错误 + 是否真有 provider，派生出**能指导下一步**的原因。
    const hasProvider = ctx.hasLlmProvider !== false; // 未传 ⇒ 保守认为有（不倒扣既有调用方）
    synthFail = classifySynthFailure(err, hasProvider);
    synthText = deterministicSynthesis(ordered, plan.synthesizeBlocks, synthFail);
  }

  const blocks: AnswerBlock[] = [{ type: "text", markdown: synthText }];
  const unverifiedNumerics = usedLlm ? scanUnverified(synthText) : false;
  const answer: Answer = {
    trustLevel: "AGENT_EXPLORATORY", // 含 LLM 综合 → 非 VERIFIED_WORKFLOW（绝不冒充「数据库事实」）
    blocks,
    provenance,
    unverifiedNumerics,
    // R13 · 槽位归一化留痕：如天→周归一化，供诊断与 seam-gate 断言。
    ...(plan.normalizedSlots
      ? {
          validationTrace: {
            slicesUsed: [],
            consistency: { checks: [], verdict: "ALL_PASS" as const },
            crossValidation: { claims: [], verdict: "NO_CLAIMS" as const },
            normalizedSlots: plan.normalizedSlots,
            generatedAt: new Date().toISOString(),
          },
        }
      : {}),
  };

  return { answer, stepCount: ordered.length, synthCount, usedLlm, products: ordered };
}
