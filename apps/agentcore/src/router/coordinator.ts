import type { Answer, AnswerBlock, CoordinatorPlan, PageContext, RoleDispatch } from "@platform/contracts";
import { AGENT_ROLE_ORDER } from "@platform/contracts";
import { roleProfile } from "../mocks/seed.js";
import { roleSystemFragment } from "../agent/prompts.js";
import { pageContextSummary } from "../agent/prompts.js";
import type { ExtendedPlanStep } from "../workflow/executor.js";

/**
 * WO-FIVE-ROLE-AI-EMPLOYEE P1 · Coordinator 编排（确定性·R6 无 LLM/时钟/随机）。
 *
 * 一个跨域问题 → `planCoordination` 判定跨域（命中多角色关键词共现 / 交付风险等复合触发）→ **确定性拆**成子问
 * 分派给相关角色（供应链[物料齐套] + 生产[产能瓶颈] + 质量[良率]）→ `buildDispatchSteps` 产 invoke_agent 步扇出
 *（各带自己角色 agent + scope + system 片段·enforceObjectScope 真隔离）→ `synthesize` 结构化汇总
 *（谁答什么 + 一致/冲突 + 综合结论 + 每角色溯源）。
 *
 * **不劫持**：仅 ≥2 个不同角色命中才算跨域（单域返 undefined → orchestrator 照走 path-B 单 agent）。
 * P2 双向 A2A（角色间相互提问/协商）标"二期"·不在本模块。
 */

/** 角色关键词表（命中即该角色相关·确定性）。 */
const ROLE_KEYWORDS: { role: RoleDispatch["role"]; focusHint: string; re: RegExp }[] = [
  { role: "supply-chain", focusHint: "物料齐套", re: /(物料|齐套|供应商|供应|采购|断供|缺料|库存|长协|到货|BOM)/ },
  { role: "production", focusHint: "产能瓶颈", re: /(产能|产线|瓶颈|排产|换型|爬坡|工序|装配|化成|涂布|卷绕|注液|OEE|利用率)/ },
  { role: "quality", focusHint: "良率", re: /(质量|良率|合格|检验|不良|缺陷|一致性|合规|SPC)/ },
];

/**
 * 复合跨域触发：交付风险/综合诊断/整体评估等——即便只显式命中一个域关键词，也应召集"交付风险三角"
 *（供应链·生产·质量）联合会诊。命中即把这三角纳入分派集（与显式命中的角色并集）。
 */
const DELIVERY_RISK_RE = /(交付|按时交|能不能交|交期)/;
const COMPOSITE_RE = /(综合诊断|全面评估|整体.{0,4}风险|系统性|会诊|多角度|全链|端到端)/;

const DELIVERY_TRIAD: RoleDispatch["role"][] = ["supply-chain", "production", "quality"];

/** 角色中文名（汇总卡渲染 + 溯源）。 */
export const ROLE_LABELS: Record<string, string> = {
  ceo: "CEO",
  "supply-chain": "供应链",
  production: "生产",
  quality: "质量",
  "base-planner": "基地规划",
};

/** 子问模板（确定性·把大问题按角色关注面拆开）。 */
function subQuestionFor(role: RoleDispatch["role"], focusHint: string, question: string): string {
  const q = question.trim();
  const lens: Record<string, string> = {
    "supply-chain": "物料齐套与供应保障",
    production: "产能与产线瓶颈",
    quality: "质量与良率",
    ceo: "顶层目标达成",
    "base-planner": "本基地产销平衡",
  };
  return `围绕「${lens[role] ?? focusHint}」拆解并作答：${q}`;
}

/**
 * 判定跨域并产 CoordinatorPlan（确定性）。跨域 = 命中"交付风险/复合触发"（召集三角）或 ≥2 个不同角色关键词共现。
 * 单域 / 无角色命中 → 返 undefined（不劫持·orchestrator 照走 path-B 单 agent）。
 * @param baseScope 运行者 OBO 身份 baseScope（base_manager:常州→["changzhou"]）——注入 base-planner 若参与。
 */
export function planCoordination(
  question: string,
  pageContext: PageContext | undefined,
  baseScope: string[] = [],
): CoordinatorPlan | undefined {
  const q = question ?? "";
  const matched = new Set<RoleDispatch["role"]>();
  const hintByRole = new Map<string, string>();
  for (const k of ROLE_KEYWORDS) {
    if (k.re.test(q)) {
      matched.add(k.role);
      hintByRole.set(k.role, k.focusHint);
    }
  }

  let trigger = "";
  const deliveryRisk = DELIVERY_RISK_RE.test(q) || COMPOSITE_RE.test(q);
  if (deliveryRisk) {
    for (const r of DELIVERY_TRIAD) matched.add(r);
    trigger = DELIVERY_RISK_RE.test(q) ? "交付风险→供应链/生产/质量三角会诊" : "复合跨域触发→多角色会诊";
  }

  if (matched.size < 2) return undefined; // 单域/无域 → 不召集 Coordinator（不劫持）
  if (!trigger) trigger = `多角色关键词共现（${[...matched].map((r) => ROLE_LABELS[r]).join("/")}）`;

  // 确定性角色序（AGENT_ROLE_ORDER）：产稳定的 dispatch 顺序（R6·扇出/汇总一致）。
  const dispatches: RoleDispatch[] = [];
  for (const role of AGENT_ROLE_ORDER) {
    if (!matched.has(role)) continue;
    const prof = roleProfile(role);
    if (!prof?.agentId) continue; // 无绑定 agent 的角色跳过（诚实不空调）
    const focusHint = hintByRole.get(role) ?? ROLE_LABELS[role] ?? role;
    const scope =
      role === "base-planner"
        ? { allBases: false, baseIds: [...baseScope].sort() }
        : { allBases: prof.scope.allBases, baseIds: [...prof.scope.baseIds] };
    dispatches.push({
      role,
      subQuestion: subQuestionFor(role, focusHint, q),
      agentId: prof.agentId,
      scope,
      objectTypes: [...prof.objectTypes],
      focusHint,
    });
  }
  if (dispatches.length < 2) return undefined; // 绑定后仍不足 2 角色 → 不跨域

  return { question: q, trigger, dispatches };
}

/**
 * WO-FIVE-ROLE P1 · C2：单域问题 → 该域角色（path-B 按 role 选对应 agent·非永远 universal）。
 * 恰好命中一个角色关键词组、且**非**跨域触发（交付风险/复合）→ 返该角色；否则 undefined（走通用 path-B）。
 */
export function detectSingleRole(question: string): RoleDispatch["role"] | undefined {
  const q = question ?? "";
  if (DELIVERY_RISK_RE.test(q) || COMPOSITE_RE.test(q)) return undefined; // 跨域 → 不作单域
  const hit = ROLE_KEYWORDS.filter((k) => k.re.test(q));
  return hit.length === 1 ? hit[0]!.role : undefined;
}

/** 每条 dispatch → 一个 invoke_agent 步（扇出）：prompt = 角色 system 片段 + 页面上下文 + 子问；enforceObjectScope 真隔离。 */
export function buildDispatchSteps(plan: CoordinatorPlan, pageContext: PageContext | undefined): ExtendedPlanStep[] {
  const pcSummary = pageContextSummary(pageContext);
  return plan.dispatches.map((d, i) => {
    const scopeNote = d.scope.allBases
      ? "全域"
      : `限基地[${d.scope.baseIds.join(",") || "由身份行级过滤"}]`;
    const prompt = [
      roleSystemFragment(d.role),
      `你的取证对象域：${d.objectTypes.join("/") || "（全域）"}（越界读对象会被拒）。scope：${scopeNote}。`,
      pcSummary ? `页面上下文：\n${pcSummary}` : "",
      `<sub_question>${d.subQuestion}</sub_question>`,
    ]
      .filter(Boolean)
      .join("\n");
    return {
      id: `dispatch_${i}`,
      type: "invoke_agent",
      params: { agentId: d.agentId, version: "latest", prompt, enforceObjectScope: true },
    } as unknown as ExtendedPlanStep;
  });
}

/** 一致/冲突启发判定：扫每角色答的风险/良好信号。 */
function riskSignal(text: string): "风险" | "良好" | "中性" {
  const neg = /(缺口|不足|瓶颈|风险|越线|短缺|不达标|波动|断供|超期|延期|拉穿|告警|异常)/;
  const pos = /(可承接|充足|通过|达标|正常|无缺口|齐套|满足|良好|稳定|合格)/;
  if (neg.test(text)) return "风险";
  if (pos.test(text)) return "良好";
  return "中性";
}

export interface RoleAnswerInput {
  role: RoleDispatch["role"];
  agentId: string;
  subQuestion: string;
  answerText: string;
  scope: { allBases: boolean; baseIds: string[] };
  objectTypes: string[];
}

/**
 * 结构化汇总（确定性·P1 compose LLM 可 env-gated 后续）：谁答什么 + 一致/冲突 + 综合结论 + 每角色溯源。
 * 每角色一栏（角色名 + 子问 + 答 + scope 徽标 + 对象域）；末尾综合结论标"一致/存在分歧"。
 */
export function synthesize(plan: CoordinatorPlan, answers: RoleAnswerInput[]): Answer {
  const blocks: AnswerBlock[] = [];
  blocks.push({
    type: "text",
    markdown: `**跨域协调（Coordinator）**：${plan.trigger}。已分派 ${answers.length} 个角色协作作答，汇总如下。`,
  });

  const signals: Record<string, "风险" | "良好" | "中性"> = {};
  for (const a of answers) {
    const label = ROLE_LABELS[a.role] ?? a.role;
    const scopeBadge = a.scope.allBases ? "全域" : `基地[${a.scope.baseIds.join(",") || "行级过滤"}]`;
    signals[a.role] = riskSignal(a.answerText);
    blocks.push({
      type: "text",
      markdown:
        `### 【${label}】 ⟨scope: ${scopeBadge} · 对象域: ${a.objectTypes.join("/") || "全域"}⟩\n` +
        `**子问**：${a.subQuestion}\n\n` +
        `**${label} agent（${a.agentId}）作答**：${a.answerText || "（无文本结论）"}`,
    });
  }

  const kinds = new Set(Object.values(signals));
  const conflict = kinds.has("风险") && kinds.has("良好");
  const allRisk = [...kinds].every((k) => k === "风险") && kinds.has("风险");
  const consensusLine = conflict
    ? `⚠ **存在分歧**：${Object.entries(signals).map(([r, s]) => `${ROLE_LABELS[r] ?? r}=${s}`).join("、")}——各角色判断不一致，需人工权衡（见各栏溯源）。`
    : allRisk
      ? `**一致判断**：各角色均识别到风险（${Object.keys(signals).map((r) => ROLE_LABELS[r] ?? r).join("、")}），建议优先处置交叉根因。`
      : `**综合结论**：各角色作答如上，未见互相冲突的判断。`;
  blocks.push({ type: "text", markdown: `---\n${consensusLine}\n\n_每角色结论均来自其专职 agent 在自身 scope 内的取证（越界已被拒）。_` });

  return { trustLevel: "AGENT_EXPLORATORY", blocks, provenance: [], unverifiedNumerics: false };
}
