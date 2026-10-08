/**
 * WO-DOMAIN-BY-INTENT · 分类结果的**域归属面**（`domainRole`）单源读数器 —— openai / anthropic / degrade 三条路共用。
 *
 * 为什么需要它：分类器（LLM 意图分析）今日只输出 `candidates/outOfCatalog/extractedSlots`，域归属靠
 * **调用侧的关键词正则**另判。本字段让「这句话的**意图**属于哪个域」成为 LLM 分析结果的一部分，
 * 由调用侧（agentcore）据以选角色 agent。
 *
 * ⚠ **三态语义是判据的命门**，三条路必须收敛到同一份（不许各写各的 `?? undefined`）：
 *   - `string`  = 分析作出了判断：本题意图属于该域（值 = 域目录里的 key）；
 *   - `null`    = 分析作出了判断：**判不出域**（意图不属于任何域）—— 这是**有信息**的答案，不是"没有"；
 *   - `undefined` = **没有这份分析**（模型没吐该字段 / 老结果 / 分类器压根没跑）⇒ 调用侧落关键词兜底。
 *
 * 形态归一（**只归一形态，不校验域 key** —— key 的合法性由调用侧按域目录判，本层不认识任何业务域名）：
 *   · `"quality"` → `"quality"`（去空白）
 *   · `""` / 全空白 → `null`（模型以空串表达"判不出"；与 null 同义，不许读成"没分析"）
 *   · 非字符串（数组/对象/数字 —— 模型偶发形态漂）→ `undefined`（不猜、不猜成 null：猜成了就凭空多一个"判断"）
 *
 * 这是 `slot-harvest.ts` 的同族纪律：**读数要跑在 raw 上，且"我没找到"与"它没有"必须能分辨**。
 */

/** 判断字段名（单一来源·三条适配器引用同一个常量，防改名漂）。 */
export const DOMAIN_ROLE_FIELD = "domainRole";
/** 域判断理由字段名（同上·单一来源）。 */
export const DOMAIN_REASON_FIELD = "domainReason";

/** raw 分类响应 → 域归属三态（string | null | undefined）。**纯函数·无 IO**。 */
export function readDomainRole(raw: unknown): string | null | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const v = (raw as Record<string, unknown>)[DOMAIN_ROLE_FIELD];
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  if (v === null) return null;
  return undefined;
}

/**
 * raw 分类响应 → 域判断**理由**（一句·两域都沾边的模糊问句靠它可见"为什么选了它/为什么都不选"）。
 * 形态归一：非字符串 / 空串 / 全空白 → `undefined`（**没有理由**；⛔ 不编一个"无理由"的占位串）。
 */
export function readDomainReason(raw: unknown): string | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const v = (raw as Record<string, unknown>)[DOMAIN_REASON_FIELD];
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}
