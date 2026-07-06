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
  LLM_PURPOSE_UNBOUND: "设置→LLM 用途绑定：为该用途绑定可用 provider 与有效密钥（AES-GCM 落库），再重跑本问句",
  // GAP-ACTIONABLE（P3 修）：绝不再是"人工核实内部错误"占位——即便未归类，也据真实 evidence 给可行动补法。
  OTHER: "据实跑 evidence 原文定位真实断点后补齐（保留原始错因，不以人工兜底占位掩盖真相）",
};

/**
 * GAP-ACTIONABLE（PRD §3.4 · P3 修）：每个缺口码的可行动导语 `{what 缺什么, where 补在哪}`。
 * `acceptance 验收` 恒由**本问句**派生（E2E 真跑答出真实承载数据），不写死。用户实测痛点：
 * 「常州基地的瓶颈是?」被拍 OTHER→"人工核实内部错误"（丢真相）——此表让每张工单渲染真修法。
 */
const ACTIONABLE_WHAT_WHERE: Record<GapCode, { what: string; where: string }> = {
  ANSWERABLE: { what: "无缺口（全链实跑通、VERIFIED 答案）", where: "—" },
  NO_INTENT: { what: "无意图覆盖该问句（分类无候选命中）", where: "B catalog：scaffold 意图或归并到既有意图" },
  NO_PLAN: { what: "命中意图但缺执行计划（PLAN_NOT_FOUND）", where: "scaffold 执行计划并绑回意图（DSL/求解器步骤）" },
  NO_SLICE: { what: "缺本体切片（resolve_slice 未注册/解析失败）", where: "本体建模：建切片（root→hops）" },
  EMPTY_DATA: { what: "对象类型在但数据空/未物化", where: "连接器导入页 / Excel 上传→物化（真人正门·Action 审批）" },
  NO_RULE: { what: "引用规则不存在（evaluate_rules）", where: "规则页：建规则（DSL）→ Action 审批" },
  SOLVER_NOT_FOUND: { what: "求解器未注册（invoke_solver）", where: "绑 generic-inference 兜底，或出带 I/O 契约的求解器骨架工单" },
  SHAPE_MISMATCH: { what: "渲染绑定字段不在求解器输出形状（G-2）", where: "修渲染绑定使 ⊆ 求解器输出，或出工单" },
  NO_CAPABILITY: { what: "缺领域能力（本体/求解器根本没有）", where: "产出需开发 GrowthTicket（带 I/O 契约）→ code agent 施工" },
  LLM_PURPOSE_UNBOUND: { what: "LLM 用途未解析到可用 provider 或密钥无效", where: "设置→LLM 用途绑定（配置 provider 与有效密钥）" },
  OTHER: { what: "未归类内部错误（真实 evidence 原文已保留）", where: "据 evidence 原文定位真实断点后补齐（非人工兜底占位）" },
};

/**
 * 据缺口码 + 本问句派生 actionable 三元 `{what, where, acceptance}` 与 suggestedFill。
 * acceptance 恒钉「本问句经 NL 真跑 E2E 答出真实承载数据」——即 DoD 验收线（永不 dash/人工核实）。
 */
export function actionableFill(code: GapCode, question: string): Pick<GapFinding, "what" | "where" | "acceptance" | "suggestedFill"> {
  const g = ACTIONABLE_WHAT_WHERE[code];
  const acceptance = code === "ANSWERABLE"
    ? "无需补齐"
    : `验收=「${question}」经 NL 真跑 E2E 答出真实承载数据（非空投影、过诚实门）`;
  const suggestedFill = code === "ANSWERABLE"
    ? FILL.ANSWERABLE
    : `缺什么：${g.what}；补在哪：${g.where}；${acceptance}`;
  return { what: g.what, where: g.where, acceptance, suggestedFill };
}

/**
 * ONTO-SCEN-GROWTH-LOOP（PRD-scenario-ontogenesis §2.5/§2.6）· 缺口二分处置单一来源（R16 · G-9）。
 * 每个缺口码**显式**落在 AUTO_DERIVE（系统能自己确定性派生）或 NEEDS_HUMAN（缺真实业务实体/缺功能→真人正门/工单）
 * 一侧——**没有第三种"静默残缺"**（穷尽 switch，新增缺口码未分类即编译期红，守 R16「绝不静默残缺」）。
 *
 *  - AUTO_DERIVE：意图/计划可由卡基因组 + 出厂目录**确定性重建**（re-seed + re-publish + growScenario 重验），
 *    launch 时触发倒序发育自动补齐→升相；补不上（如幽灵意图无出厂来源）时**回落** NEEDS_HUMAN 开工单（仍不静默）。
 *  - NEEDS_HUMAN：缺真实业务数据（真人正门）/ 缺规则、切片本体链路、求解器、渲染形状、领域能力（施工工单）/ 需人工核实。
 */
export type GapDisposition = "AUTO_DERIVE" | "NEEDS_HUMAN";
export function gapDisposition(gapCode: GapCode): GapDisposition {
  switch (gapCode) {
    // 卡声明闭包可确定性重建：意图/计划（seedIntentsAndPlans 单源 + catalog 重发布，R6 幂等）。
    case "NO_INTENT":
    case "NO_PLAN":
      return "AUTO_DERIVE";
    // 缺真实业务实体 / 缺功能 / 需人工核实 → 真人正门 / 施工工单（绝不合成冒充）。
    case "EMPTY_DATA":
    case "NO_RULE":
    case "NO_SLICE":
    case "SOLVER_NOT_FOUND":
    case "SHAPE_MISMATCH":
    case "NO_CAPABILITY":
    case "LLM_PURPOSE_UNBOUND": // 缺配置绑定（真人到 设置→LLM 用途绑定 补 provider/密钥），系统不能凭空造密钥。
    case "OTHER":
    case "ANSWERABLE": // 非缺口（verdict 处理），二分穷尽性占位——落人工侧最保守。
      return "NEEDS_HUMAN";
    default: {
      // 穷尽性哨兵：新增 GapCode 未在此分类 → 编译期 never 违规（= 无静默残缺的类型级保证）。
      const _exhaustive: never = gapCode;
      return _exhaustive;
    }
  }
}

/** 错误码/消息 → 缺口码（启发式，按 QOS 实跑产生的真实错误归类）。 */
function codeFromError(errCode: string, errMsg: string): GapCode {
  const s = `${errCode} ${errMsg}`.toLowerCase();
  // GAP-ACTIONABLE：LLM 用途未绑定/密钥无效（orchestrator sanitizeLlmAuthLeak 归一码）——具体可行动错因，
  // **入正式码表**（不再被下方 catch-all 拍成 OTHER→"人工核实内部错误"丢真相）。含未归一前的鉴权泄漏签名兜底。
  if (/llm_purpose_unbound|用途绑定|用途未|no api key|apikey|x-api-key|could not resolve authentication|authentication_error/.test(s)) return "LLM_PURPOSE_UNBOUND";
  if (/plan_not_found|plan not found/.test(s)) return "NO_PLAN";
  if (/solver/.test(s)) return "SOLVER_NOT_FOUND";
  if (/slice/.test(s)) return "NO_SLICE";
  if (/template_resolution|shape|render|output\./.test(s)) return "SHAPE_MISMATCH";
  if (/rule/.test(s)) return "NO_RULE";
  // ONTO-SCEN-LAUNCH-DET：GOVERNED 卡确定性启动时意图不可绑定（被退发布/删除/entitlement 关闭）
  // → 编排器以 INTENT_NOT_AVAILABLE 终止（零 classifier）——归类 NO_INTENT（补法=重新发布/重 grow）。
  if (/intent/.test(s)) return "NO_INTENT";
  // GAP-ACTIONABLE：**去 OTHER catch-all 的"丢真相"** —— 仍归 OTHER 码（枚举封闭），但调用方保留 evidence 原文
  // 并经 actionableFill 派生真 what/where/acceptance，永不"人工核实内部错误"。
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
      findings.push({ gapCode: "NO_INTENT", atStep: "classify", evidence: "本入口无意图命中（WORKFLOW_ONLY 兜底「请换个问法」）", blocking: true, ...actionableFill("NO_INTENT", task.query) });
      return { question: task.query, taskId: task.id, verdict: "BLOCKED", path, findings, generatedAt: new Date().toISOString() };
    }
    // 诚实门：VERIFIED 但未投影承载数据（空集）→ EMPTY_DATA（可自动补），不再误判 ANSWERABLE 致假收敛。
    if (!isDataBearing(answer.blocks)) {
      findings.push({ gapCode: "EMPTY_DATA", atStep: "render", evidence: "工作流跑通但未投影承载数据（对象类型在、数据空/未物化）", blocking: true, ...actionableFill("EMPTY_DATA", task.query) });
      return { question: task.query, taskId: task.id, verdict: "BLOCKED", path, findings, generatedAt: new Date().toISOString() };
    }
    return { question: task.query, taskId: task.id, verdict: "ANSWERABLE", path, findings: [], generatedAt: new Date().toISOString() };
  }

  // ② 失败 → 按错误码归类断点。GAP-ACTIONABLE：**保留 evidence 原文**（`${code}: ${message}`），并派生
  // 真 what/where/acceptance（LLM_PURPOSE_UNBOUND 等具体错因入码表·永不"人工核实内部错误"）。
  if (task.status === "FAILED" && task.error) {
    const code = codeFromError(task.error.code, task.error.message);
    findings.push({ gapCode: code, atStep: task.error.stepId, evidence: `${task.error.code}: ${task.error.message}`.slice(0, 240), blocking: true, ...actionableFill(code, task.query) });
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
      blocking: false, // 已出答案（探索级），非硬阻塞
      ...actionableFill(code, task.query),
    });
    return { question: task.query, taskId: task.id, verdict: "BOUNDARY", path, findings, generatedAt: new Date().toISOString() };
  }

  // ④ 其它（取消/未路由）——仍派生 actionable（永不"人工核实内部错误"占位）。
  findings.push({ gapCode: "OTHER", evidence: `任务终态 ${task.status}`, blocking: true, ...actionableFill("OTHER", task.query) });
  return { question: task.query, taskId: task.id, verdict: "BLOCKED", path, findings, generatedAt: new Date().toISOString() };
}
