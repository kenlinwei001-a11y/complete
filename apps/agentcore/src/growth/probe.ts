import type { GapCode, GapFinding, GapReport, QueryTask } from "@platform/contracts";

/**
 * 需求拉动的自成长发动机 · P1：QOS 缺口探针的分类核心。
 * 把"客户问句真跑一遍 orchestrator"后的**终态 QueryTask** 映射为结构化 GapReport（PRD §5 分类法）。
 * 纯函数、确定性（R6）：同终态 → 同缺口分类。不调网络/LLM。
 */

export const FILL: Record<GapCode, string> = {
  ANSWERABLE: "无需补齐",
  NO_INTENT: "scaffold 意图（跨系统经 B catalog）或归并到既有意图",
  NO_PLAN: "scaffold 执行计划并绑回意图",
  NO_SLICE: "建本体切片（root→hops）",
  EMPTY_DATA: "生成 Excel→连接器页导入→物化（真人正门），经 Action 审批",
  NO_RULE: "建规则（DSL），经 Action 审批",
  SOLVER_NOT_FOUND: "B：绑 generic-inference 兜底；C：产出带 I/O 契约的求解器骨架 GrowthTicket",
  SHAPE_MISMATCH: "修渲染绑定使 ⊆ 求解器输出形状，或出工单",
  NO_CAPABILITY: "产出需开发 GrowthTicket（带 I/O 契约）→ code agent 施工",
  OTHER: "人工核实内部错误",
};

/** 错误码/消息 → 缺口码（启发式，按 QOS 实跑产生的真实错误归类）。 */
function codeFromError(errCode: string, errMsg: string): GapCode {
  const s = `${errCode} ${errMsg}`.toLowerCase();
  if (/plan_not_found|plan not found/.test(s)) return "NO_PLAN";
  if (/solver/.test(s)) return "SOLVER_NOT_FOUND";
  if (/slice/.test(s)) return "NO_SLICE";
  if (/template_resolution|shape|render|output\./.test(s)) return "SHAPE_MISMATCH";
  if (/rule/.test(s)) return "NO_RULE";
  // ONTO-SCEN-LAUNCH-DET：GOVERNED 卡确定性启动时意图不可绑定（被退发布/删除/entitlement 关闭）
  // → 编排器以 INTENT_NOT_AVAILABLE 终止（零 classifier）——归类 NO_INTENT（补法=重新发布/重 grow）。
  if (/intent/.test(s)) return "NO_INTENT";
  return "OTHER";
}

/**
 * 诚实门（G-9 收尾，与 server.ts verifyScenario 同口径单一来源）：答案必须**投影出真实承载数据**才算可答。
 * 含承载数据块 = kpi/table/rule_violation/action_draft 或带 ⟦ref:⟧ 的文本。此前 classifyGap 只认 trustLevel
 * 而不查 dataBearing → "WORKFLOW 完成但空投影" 被误判 ANSWERABLE，使发育闭环 runGrowthLoop **零补齐假收敛**、
 * 重验仍空、永不 GOVERNED。对齐后空投影正确产 EMPTY_DATA（可自动补 → SOFT fill 真触发）。
 */
function isDataBearing(blocks: { type?: string; markdown?: string }[]): boolean {
  return blocks.some(
    (b) =>
      b.type === "kpi" || b.type === "table" || b.type === "rule_violation" || b.type === "action_draft" ||
      (b.type === "text" && /⟦ref:/.test(String(b.markdown ?? ""))),
  );
}

export function classifyGap(task: QueryTask): GapReport {
  const findings: GapFinding[] = [];
  const path = task.path ?? "NONE";
  const answer = task.answer;

  // ① 路径A 完成 + VERIFIED → 需再过诚实门（dataBearing）才算可答
  if (task.status === "COMPLETED" && path === "WORKFLOW" && answer?.trustLevel === "VERIFIED_WORKFLOW") {
    // 但若是 WORKFLOW_ONLY「请换个问法」兜底答案，也走 WORKFLOW/VERIFIED → 需判文本
    const isMiss = answer.blocks.some((b) => b.type === "text" && /请换个问法/.test(b.markdown));
    if (isMiss) {
      findings.push({ gapCode: "NO_INTENT", atStep: "classify", evidence: "本入口无意图命中（WORKFLOW_ONLY 兜底「请换个问法」）", suggestedFill: FILL.NO_INTENT, blocking: true });
      return { question: task.query, taskId: task.id, verdict: "BLOCKED", path, findings, generatedAt: new Date().toISOString() };
    }
    // 诚实门：VERIFIED 但未投影承载数据（空集）→ EMPTY_DATA（可自动补），不再误判 ANSWERABLE 致假收敛。
    if (!isDataBearing(answer.blocks)) {
      findings.push({ gapCode: "EMPTY_DATA", atStep: "render", evidence: "工作流跑通但未投影承载数据（对象类型在、数据空/未物化）", suggestedFill: FILL.EMPTY_DATA, blocking: true });
      return { question: task.query, taskId: task.id, verdict: "BLOCKED", path, findings, generatedAt: new Date().toISOString() };
    }
    return { question: task.query, taskId: task.id, verdict: "ANSWERABLE", path, findings: [], generatedAt: new Date().toISOString() };
  }

  // ② 失败 → 按错误码归类断点
  if (task.status === "FAILED" && task.error) {
    const code = codeFromError(task.error.code, task.error.message);
    findings.push({ gapCode: code, atStep: task.error.stepId, evidence: `${task.error.code}: ${task.error.message}`.slice(0, 240), suggestedFill: FILL[code], blocking: true });
    return { question: task.query, taskId: task.id, verdict: code === "NO_CAPABILITY" ? "BOUNDARY" : "BLOCKED", path, findings, generatedAt: new Date().toISOString() };
  }

  // ③ 路径B 完成（探索模式）→ 本体内无覆盖，靠 agent 自由推理 = 缺意图/缺能力（已能答但非验证）
  if (task.status === "COMPLETED" && path === "AGENT") {
    const outOfCatalog = task.classification?.outOfCatalog ?? true;
    const code: GapCode = outOfCatalog ? "NO_INTENT" : "NO_CAPABILITY";
    findings.push({
      gapCode: code,
      atStep: "routing",
      evidence: outOfCatalog ? "分类 outOfCatalog，无意图覆盖；路径B agent 兜底作答（本体外，未验证）" : "命中意图但落路径B；疑缺确定性能力（求解器/计划）",
      suggestedFill: FILL[code],
      blocking: false, // 已出答案（探索级），非硬阻塞
    });
    return { question: task.query, taskId: task.id, verdict: "BOUNDARY", path, findings, generatedAt: new Date().toISOString() };
  }

  // ④ 其它（取消/未路由）
  findings.push({ gapCode: "OTHER", evidence: `任务终态 ${task.status}`, suggestedFill: FILL.OTHER, blocking: true });
  return { question: task.query, taskId: task.id, verdict: "BLOCKED", path, findings, generatedAt: new Date().toISOString() };
}
