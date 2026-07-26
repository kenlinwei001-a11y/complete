import { SOLVER_ARGS_SCHEMAS, requiredArgKeys, solverArgsSchema } from "@platform/contracts";
import type { DomainRoute } from "./domain-resolver.js";

/**
 * PRD-multi-intent-L2L3 · **L2 真分解**（`qos.multi-intent-l2-decompose`·暗发）：补 ② 关键词族覆盖不到的意图。
 *
 * 病根：② 靠 DOMAIN_FAMILIES 关键词·novel 措辞（没写"产能"但问"接不接得住"）漏意图；⑤ 靠分类器候选·候选是"意图"
 * 非"solver 计划"。L2：classify 之后（⑤ 未命中时），对**复合问句**让 LLM 产一份 **solver 执行计划**
 * `[{solverKey, args, section}]` —— **LLM 只做分解/选型/抽参（非推理·非算数·§3 D-模型分层·绝不产业务数字）**，
 * 计划逐条**确定性校验**（solverKey ∈ SOLVER_ARGS_SCHEMAS 已登记 + args 过该 solver zod schema + 必填齐 + 同 solver 去重），
 * 验不过的条目**丢弃**（诚实 gap·不硬凑）→ 幸存 ≥2 → 接 L1 `runDeterministicMultiPath` 同一共享后半（铁律不另建）。
 *
 * R6 边界：LLM 产计划本身非确定（这是 L2 与 ②⑤ 的分界·PRD 明示）；**校验/映射/装配全确定性**——同一份计划文本
 * 两次校验字节一致；真值全来自 solver（KILL-MOCK-RED）。
 */

/** 复合问句启发（R6·避免对简单问句多花一次 LLM 调用）：多子句连接词 / 多问号 / 枚举顿号。 */
export function isCompoundQuery(query: string): boolean {
  const q = query ?? "";
  if ((q.match(/[？?]/g) ?? []).length >= 2) return true;
  if (/(、|，|；|;)/.test(q) && /(和|及|还是|同时|分别|以及|加上|顺便|另外)/.test(q)) return true;
  return /(哪些.{0,20}(哪些|多少|能不能|接不接))|(既.{0,12}又)|(一边.{0,12}一边)/.test(q);
}

/** L2 计划条目（LLM 产·经确定性校验后）。 */
export interface L2PlanEntry {
  solverKey: string;
  args: Record<string, unknown>;
  /** 分节标题（LLM 给的人话·可缺省回落 solverKey）。 */
  section?: string;
}

/**
 * 给 LLM 的分解指令（solver 菜单从 SOLVER_ARGS_SCHEMAS 单一来源派生——只列**已登记 args schema** 的 solver·
 * 未登记者 L2 无从校验 → 不进菜单·fail-safe）。硬约束进 prompt：只选型/抽参·不产任何业务数字/结论。
 */
export function buildL2Instruction(): string {
  const menu = Object.keys(SOLVER_ARGS_SCHEMAS)
    .sort()
    .map((k) => {
      const req = requiredArgKeys(k);
      return `- ${k}${req.length > 0 ? `（必填 args：${req.join("、")}）` : "（无必填 args）"}`;
    })
    .join("\n");
  return (
    `你是求解器计划分解器。把用户的复合问句拆成一份 solver 执行计划——**只做分解/选型/入参抽取，绝不推理、绝不算数、` +
    `绝不产生任何业务数字或结论**（真值全部由求解器计算）。\n` +
    `输出：一个 JSON 数组（不要任何其它文字），每项 {"solverKey": string, "args": object, "section": string}。\n` +
    `- solverKey 只能从下方菜单选（菜单外的一律不选·宁缺毋滥）；\n` +
    `- args 只放从问句里**逐字抽取**的值（型号/基地/比例/周数等），抽不出必填 args 就**不要选该 solver**；\n` +
    `- section 是该子问的一句话中文标题。\n` +
    `可用求解器菜单：\n${menu}`
  );
}

/**
 * 确定性校验 LLM 计划文本（R6 纯函数·同文本同结果）：抽取首个 JSON 数组 → 逐条过门——
 * ① solverKey 已登记（SOLVER_ARGS_SCHEMAS·未登记=输入模式未知·丢弃）② args 过该 solver zod schema（safeParse·
 * 必填缺/类型错=丢弃·**不硬凑**）③ 同 solverKey 去重（首个胜）④ 截到 maxEntries。幸存 <2 → null（调用方回落既有路径）。
 */
export function validateSolverPlan(rawText: string, maxEntries: number): L2PlanEntry[] | null {
  const m = (rawText ?? "").match(/\[[\s\S]*\]/);
  if (!m) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(m[0]);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const seen = new Set<string>();
  const out: L2PlanEntry[] = [];
  for (const raw of parsed) {
    if (out.length >= Math.max(0, maxEntries)) break;
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    const solverKey = typeof e.solverKey === "string" ? e.solverKey : "";
    const schema = solverArgsSchema(solverKey);
    if (!schema) continue; // ① 未登记 → 丢弃（诚实 gap·不臆造输入模式）
    if (seen.has(solverKey)) continue; // ③ 同 solver 去重
    const args = e.args && typeof e.args === "object" && !Array.isArray(e.args) ? (e.args as Record<string, unknown>) : {};
    const check = schema.safeParse(args);
    if (!check.success) continue; // ② 必填缺/类型错 → 丢弃（不硬凑）
    seen.add(solverKey);
    out.push({
      solverKey,
      args: check.data as Record<string, unknown>,
      ...(typeof e.section === "string" && e.section ? { section: e.section } : {}),
    });
  }
  return out.length >= 2 ? out : null;
}

/**
 * 计划条目 → 共享后半的 DomainRoute（确定性映射）。perDomainScore 置 0——L2 无分类置信可言，
 * 门是**确定性校验**（solverKey 登记 + args 过 schema）而非置信阈；0 诚实反映"非置信路"（观测面可辨）。
 */
export function l2EntriesToRoutes(entries: L2PlanEntry[]): DomainRoute[] {
  return entries.map((e) => ({
    domain: e.solverKey,
    route: e.solverKey,
    solverKey: e.solverKey,
    args: e.args,
    perDomainScore: 0,
    ...(e.section ? { label: e.section } : {}),
  }));
}
