import type { ClosureReport, GapFinding, GapReport, ScaffoldReceipt } from "@platform/contracts";

/**
 * g8-P4 功能缺失自检：把一次建域的缺口（A 栈闭包 MISSING/FAILED + B 栈 scaffold MISSING）
 * 聚合映射为自成长发动机的 7 码 GapReport（复用同一缺口分类法，g8 §9 归一）。
 * 干净建域 → verdict ANSWERABLE、零 findings；有缺口 → BLOCKED + 逐项 7 码。
 * 纯函数，确定性。
 */
/** 推演诉求标记：故事是否在"问/要分析/要推演"（而非纯数据装载）。 */
const INFERENCE_INTENT = /[?？]|推演|分析|瓶颈|预测|影响|风险|缺口|后果|能不能|会不会|哪些|为什么|谁会|挤占|降级|多大|怎么|是否/;

export function selfCheckGaps(
  script: string,
  runId: string,
  closure?: ClosureReport,
  receipt?: ScaffoldReceipt,
  /** 本次倒推出的求解器数（comprehend 是否理解出"可答的能力"的硬信号）。 */
  solverCount?: number,
): GapReport {
  const findings: GapFinding[] = [];

  // 理解缺口（修 selfCheckGaps 谎报 ANSWERABLE）：故事明确提出推演诉求,却一个求解器都没倒推出来
  // → comprehend 没理解出"怎么答" → 必须报缺口,而不是因为"没有 MISSING 项"就判无缺口。
  // 让系统"知道自己不懂"：建域绿 ≠ 能答用户的问题。
  if (solverCount === 0 && INFERENCE_INTENT.test(script)) {
    findings.push({
      gapCode: "NO_INTENT",
      atStep: "comprehend",
      evidence: "故事提出推演诉求,但未倒推出任何求解器/规则——comprehend 未理解该问题（建域成功≠能答）。",
      suggestedFill: "接 LLM comprehend 解析意图→倒推所需求解器/规则/对象；或人工补建对应推演能力。",
      blocking: true,
    });
  }

  // A 栈闭包缺口（求解器未注册 / 渲染形状不符 / 正向依赖字段缺失）
  for (const f of closure?.findings ?? []) {
    if (f.status !== "MISSING" && f.status !== "FAILED") continue;
    const gapCode =
      f.kind === "CHAIN" ? "SOLVER_NOT_FOUND" :
      f.kind === "SHAPE" ? "SHAPE_MISMATCH" :
      f.kind === "FORWARD" ? "NO_SLICE" :
      f.kind === "OBJECT" ? "NO_SLICE" :
      "OTHER";
    findings.push({
      gapCode,
      atStep: `closure:${f.kind}`,
      evidence: `${f.kind} ${f.ref}：${f.detail ?? f.status}`,
      suggestedFill: gapCode === "SOLVER_NOT_FOUND" ? "注册求解器 / 出骨架工单" : gapCode === "SHAPE_MISMATCH" ? "修渲染绑定 / 出工单" : "建切片 / 补字段",
      blocking: true,
    });
  }

  // B 栈 scaffold 缺口（场景→意图→计划 断链）
  for (const it of receipt?.items ?? []) {
    if (it.status !== "MISSING") continue;
    const refs = (it.missingRefs ?? []).join("；");
    const gapCode =
      it.kind === "intent" || /未配置/.test(refs) ? "NO_INTENT" :
      it.kind === "plan" || /未绑定执行计划/.test(refs) ? "NO_PLAN" :
      "NO_CAPABILITY";
    findings.push({
      gapCode,
      atStep: `scaffold:${it.kind}`,
      evidence: `${it.kind} ${it.key}：${refs || "MISSING"}`,
      suggestedFill: "scaffold 补建 B 栈制品（DRAFT）",
      blocking: true,
    });
  }

  return {
    question: script,
    taskId: runId,
    verdict: findings.length === 0 ? "ANSWERABLE" : "BLOCKED",
    path: "NONE", // 构建期静态自检，非 QOS 运行时路径
    findings,
    generatedAt: new Date().toISOString(),
  };
}
