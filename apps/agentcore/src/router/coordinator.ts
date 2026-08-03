import type { Answer, AnswerBlock, CoordinatorPlan, PageContext, RoleDispatch } from "@platform/contracts";
import { AGENT_ROLE_ORDER } from "@platform/contracts";
import { roleProfile } from "../mocks/seed.js";
import { roleSystemFragment } from "../agent/prompts.js";
import { pageContextSummary } from "../agent/prompts.js";
import type { ExtendedPlanStep } from "../workflow/executor.js";
import { isCapacityFeasibilityQuery } from "../agent/sim-planner.js"; // WO-AGENT-RUNTIME-S01 · 定式意图（产能可行性变体）不拆多角色·直路 capacity_forecast
import { domainResolveMulti } from "./domain-resolver.js"; // WO-QOS-CROSS-DOMAIN-UNIFIED · Coordinator 降级：能 solver 分解的跨域题让位②
import { selectDeterministicMultiRoute } from "./multi-route.js";

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
export const DELIVERY_RISK_RE = /(交付|按时交|能不能交|交期)/;
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
  deterministicMultiEnabled = false,
): CoordinatorPlan | undefined {
  const q = question ?? "";
  // ★ WO-QOS-CROSS-DOMAIN-UNIFIED · Coordinator 降级（Q2 修复·关键）——与 S01 `isCapacityFeasibilityQuery` 同一机制、
  // **非新开关/非裸关键词 bypass**：若本题能被 `selectDeterministicMultiRoute` 分解成 ≥2 条**真 solver 路**（各有金库 solver +
  // 槽可填）→ 返 undefined **让位②确定性多路**（秒答·零 LLM·不烧 5min）。判据用 selectDeterministicMultiRoute 一个（非"命中多域
  // 关键词就无脑 bypass"）——真开放/需会诊的题（"综合分析连锁影响给整体结论"·无 solver 锚·被 open/orchestration 惩罚压到阈下）
  // selectDeterministicMultiRoute 返 null → **仍落 Coordinator**（保住只能会诊的题）。暗发门 `deterministicMultiEnabled` 关
  // → 逐字节沿用现 Coordinator 行为（SEAM-6 零回归·含默认关态 Coordinator 一字不变）。
  if (deterministicMultiEnabled && selectDeterministicMultiRoute(domainResolveMulti(q, pageContext))) return undefined;
  // WO-AGENT-RUNTIME-S01 · 直路（治病根头号杠杆）：产能可行性变体（「型号+上浮X%+N周+能不能接」）有对口**单一**
  // solver（capacity_forecast），**绝不拆多角色会诊**——否则供应链/产能/质量子 agent 各自盲扫烧预算（decision-trace
  // 铁证 ~5min 卡死）。命中即返 undefined → orchestrator 上游确定性路由（会话继承 path-A / compose 直路）已先接住；
  // 即便未被上游接住（feature/上下文差异），这里也拒绝拆分 → 落 path-B 单 agent（有导航切片·仍对口 capacity_forecast）。
  if (isCapacityFeasibilityQuery(q, pageContext)) return undefined;
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
 * WO-LOOP-CONTROL-P2.5 · Escalation Ladder rung② stalled-mode 兜底拆解（**reactive·仅 orchestrator 反应式重路由调用**）。
 *
 * 缺口：`planCoordination` 只对**命中 ≥2 域关键词 / 交付风险**的题拆多角色；单 agent 自由多跳题若**没命中**这些关键词、
 * 却在 `runAgentLoop` 停滞 → proactive Coordinator 从不接手 → 现只能 rung①→rung③ 直接 degrade·**从不尝试拆多角色重解**。
 * 本函数是 rung② 的最后一级：单 agent **已停滞**（rung① 换策略仍无进展）时，即便无跨域关键词信号，也召集"交付风险三角"
 *（供应链[物料齐套] + 生产[产能瓶颈] + 质量[良率]）多角色重解——各自 scope 取证 → `synthesize` 汇总（复用零改扇出/汇总）。
 *
 * **不改既有 proactive `planCoordination` 行为**（本函数仅 reactive rung② 路径调用·proactive 路由一字不动·SEAM ③ 防双）。
 * 无绑定 agent 的角色跳过（诚实不空调）；绑定后不足 2 角色 → 返 undefined（rung② no-op → 落既有 degrade·诚实边界）。
 * R6 确定性（AGENT_ROLE_ORDER 稳定序·无 LLM/时钟/随机·同题两跑同 plan）。
 */
export function planStalledCoordination(
  question: string,
  _pageContext: PageContext | undefined,
  _baseScope: string[] = [],
): CoordinatorPlan | undefined {
  const q = question ?? "";
  const dispatches: RoleDispatch[] = [];
  for (const role of AGENT_ROLE_ORDER) {
    if (!DELIVERY_TRIAD.includes(role)) continue; // 停滞兜底只召集交付风险三角（供应链/生产/质量）
    const prof = roleProfile(role);
    if (!prof?.agentId) continue; // 无绑定 agent 的角色跳过（诚实不空调）
    const focusHint = ROLE_LABELS[role] ?? role;
    dispatches.push({
      role,
      subQuestion: subQuestionFor(role, focusHint, q),
      agentId: prof.agentId,
      scope: { allBases: prof.scope.allBases, baseIds: [...prof.scope.baseIds] },
      objectTypes: [...prof.objectTypes],
      focusHint,
    });
  }
  if (dispatches.length < 2) return undefined; // 绑定后仍不足 2 角色 → 不跨域（rung② no-op → 落既有 degrade）
  return { question: q, trigger: "单 agent 停滞→反应式升级三角会诊（rung②·供应链/生产/质量）", dispatches };
}

/**
 * WO-FIVE-ROLE P1 · C2：单域问题 → 该域角色（path-B 按 role 选对应 agent·非永远 universal）。
 * 恰好命中一个角色关键词组、且**非**跨域触发（交付风险/复合）→ 返该角色；否则 undefined（走通用 path-B）。
 */
export function detectSingleRole(question: string): RoleDispatch["role"] | undefined {
  const q = question ?? "";
  // WO-AGENT-RUNTIME-S01：产能可行性变体不落单域角色 agent（该 agent 仍需把「上浮X%/N周」映射成 solver 参·同样盲扫）——
  // 让它落到 runPathB 组合路径（compileSolverPlan→capacity_forecast）或既有 path-B 导航切片（对口 solver 一步到位）。
  if (isCapacityFeasibilityQuery(q)) return undefined;
  if (DELIVERY_RISK_RE.test(q) || COMPOSITE_RE.test(q)) return undefined; // 跨域 → 不作单域
  const hit = ROLE_KEYWORDS.filter((k) => k.re.test(q));
  return hit.length === 1 ? hit[0]!.role : undefined;
}

/**
 * 每条 dispatch → 一个 invoke_agent 步（扇出）：prompt = 角色 system 片段 + 页面上下文 + [DRIL 资源包] + 子问；enforceObjectScope 真隔离。
 *
 * WO-AGENT-RUNTIME-S01 · item 5：把 Coordinator 组好的 DRIL 智能资源包（对口 solver/slice 预选）作为子 agent prompt 的
 * 一部分传下去——让每个角色子 agent 也知道优先调对口 solver（如 capacity_forecast）· 不盲扫烧预算。drilSection 空（未开
 * qos.dril-routing / 组包空）→ 不注入（byte-compatible·既有 Coordinator 扇出 prompt 逐字节不变）。
 */
export function buildDispatchSteps(
  plan: CoordinatorPlan,
  pageContext: PageContext | undefined,
  drilSection?: string,
): ExtendedPlanStep[] {
  const pcSummary = pageContextSummary(pageContext);
  const dril = (drilSection ?? "").trim();
  return plan.dispatches.map((d, i) => {
    const scopeNote = d.scope.allBases
      ? "全域"
      : `限基地[${d.scope.baseIds.join(",") || "由身份行级过滤"}]`;
    const prompt = [
      roleSystemFragment(d.role),
      `你的取证对象域：${d.objectTypes.join("/") || "（全域）"}（越界读对象会被拒）。scope：${scopeNote}。`,
      pcSummary ? `页面上下文：\n${pcSummary}` : "",
      dril || "",
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
