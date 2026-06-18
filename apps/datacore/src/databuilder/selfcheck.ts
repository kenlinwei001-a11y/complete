import type { ClosureReport, GapFinding, GapReport, ScaffoldReceipt } from "@platform/contracts";

/**
 * g8-P4 功能缺失自检：把一次建域的缺口（A 栈闭包 MISSING/FAILED + B 栈 scaffold MISSING）
 * 聚合映射为自成长发动机的 7 码 GapReport（复用同一缺口分类法，g8 §9 归一）。
 * 干净建域 → verdict ANSWERABLE、零 findings；有缺口 → BLOCKED + 逐项 7 码。
 * 纯函数，确定性。
 */
export function selfCheckGaps(
  script: string,
  runId: string,
  closure?: ClosureReport,
  receipt?: ScaffoldReceipt,
): GapReport {
  const findings: GapFinding[] = [];

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
