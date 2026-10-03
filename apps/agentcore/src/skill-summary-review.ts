import { PLATFORM_PROMPT_DEFAULTS, type SkillSummaryReview } from "@platform/contracts";
import { z } from "zod";
import type { LlmClient } from "./llm/types.js";
import type { PromptClient, ToolAuthCtx } from "./tools/clients.js";
import { resolvePromptTemplate } from "./agent/prompts.js";

/**
 * WO-PROMPT-KEY-LINT · 门禁一·语义补「LLM 摘要语义审查」（**建议式·不阻断发布**）。
 *
 * 病灶（断点 `G-PROMPT-KEYS-CONFIG-ONLY` 的 `skill_summary_lint` 一支）：该提示词键此前
 * 只活在 contracts 配置表里——admin 存得进、读得回、版本号会涨，而两个 app 的 src
 * 一次都没读过它（带金丝雀实测：同一条 grep 换 classifier 命中 51 处 ⇒ 0 是真的 0）。
 * 为什么值得接：摘要写不好，下游选技能就选错，而它**不报错**——摘要缺业务化触发句时，
 * 模型只是选不中该技能，屏上少一个答案，没有任何红灯。
 *
 * 裁决① · 门排序：结构 lint → 引用闭合（probeMissingRefs）→ **本审查** → 评测门。
 * 结构错的先被零成本正则挡掉（lint 的报错更可操作）；引用死路是事实问题、确定性探针先挡；
 * 评测门跑完整 B1 管线最贵排最后。本审查的实际执行点在全部阻断判据通过后、
 * `repos.skills.update` 之前——被 422 拒掉的发布**不跑**审查（不浪费 LLM 调用在被拒发布上；
 * 机器判据：lint 失败 ⇒ composeRequests 为零）。
 *
 * 裁决② · R6 不破（本单硬约束）—— 建议式 + 审计留痕，阻断判据保持纯确定性：
 * 发布门的 422 判据**不读**本审查的 verdict（LLM 判定进留痕、不进发布判据 ⇒ 同输入的
 * 发布结果恒确定，R6 不破）。**不选「结果缓存 + 版本钉死」的理由**：缓存命中才确定、
 * 首调仍不确定；缓存要新持久面（本仓铁律：新表 = migrations + pg + memory + repo 接口
 * 四处同改）；且坏 verdict 会被钉住直到版本 bump——失效策略比病本身更危险。
 * mock 掉 LLM 之后本门剩下的判据 = 请求构造判据（键解出的模板真进 compose 请求体
 * instruction、摘要原文真进 inputs）+ 响应处理判据（PASS/ISSUES/UNPARSEABLE/UNAVAILABLE
 * 四档确定映射）+ R6 机器判据（固定注入时钟下同输入跑两遍逐字节相同）。
 *
 * 与 classifier 的关键差异（**不是**照抄 resolvePromptOverride 的消费形态）：
 * classifier 有更详的 AgentCore 硬编码兜底，故 PLATFORM_DEFAULT 不流入（R6 字节兼容）；
 * 本键**没有**更详的硬编码兜底——`PLATFORM_PROMPT_DEFAULTS.skill_summary_lint` 就是
 * 执行提示词本体，无租户 override 时**必须流入**，否则本键依然是「只活在配置里」。
 *
 * fail-open 但诚实（与本仓 fail-open 文化一致，两档都不许读成「通过」）：
 * - LLM 抛错 → `UNAVAILABLE`（issues 含错误原文）——不阻断发布；
 * - 输出不可解析为裁决 JSON → `UNPARSEABLE`（issues 含原文前 120 字）——不阻断发布。
 *
 * 启动期种子审计（`auditSeededSkills`）**刻意不跑**本维度：建议式输出不属阻断判据，
 * 且启动期不该对 LLM 有依赖——这是写明的设计决定，不是静默缺口。
 */

export interface SkillSummaryReviewDeps {
  llm: LlmClient;
  prompts?: PromptClient;
  ctx: ToolAuthCtx;
  model: string;
  /** 时钟注入（R6：测试钉死，不吃真实时间）；缺省 = 真实墙钟。 */
  now?: () => string;
}

/** LLM 裁决 JSON 的解析契约（与 instruction 里的【输出契约】尾一一对应）。 */
const VerdictSchema = z.object({ ok: z.boolean(), issues: z.array(z.string()) });

/** 固定输出契约尾（确定性拼接——同模板同摘要 ⇒ 请求体逐字节相同，R6）。 */
const OUTPUT_CONTRACT =
  "\n\n【输出契约】只输出一行 JSON：{\"ok\":boolean,\"issues\":string[]}。ok=摘要是否合格（含业务化的『当…时使用』触发句与『不适用』排除句、无空泛禁用词）；issues=不合格时的具体问题（ok=true 时为空数组）。禁止输出 JSON 以外任何字符。";

/** 剥 ```json / ``` 代码围栏（确定性容错：模型包了围栏也能解析；剥不了就落 UNPARSEABLE 诚实档）。 */
function stripCodeFence(raw: string): string {
  const t = raw.trim();
  const m = t.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  return m?.[1]?.trim() ?? t;
}

/**
 * 跑一次摘要语义审查（建议式）：解析生效模板 → 确定性拼请求 → compose → 解析裁决 → 留痕。
 * 任何 LLM 侧失败都**不抛**——落 UNAVAILABLE/UNPARSEABLE 诚实档返回（发布路据此不阻断）。
 */
export async function runSkillSummaryReview(
  skill: { name: string; summary: string },
  d: SkillSummaryReviewDeps,
): Promise<SkillSummaryReview> {
  const reviewedAt = (d.now ?? (() => new Date().toISOString()))();

  // ① 生效模板：TENANT_OVERRIDE 接管（带 version 留痕）；无 override → 平台默认**流入**
  //   （与 classifier 相反——本键无更详硬编码兜底，平台默认即执行提示词）。
  const override = await resolvePromptTemplate(d.prompts, d.ctx, "skill_summary_lint");
  const template = override?.template ?? PLATFORM_PROMPT_DEFAULTS.skill_summary_lint;
  const templateSource: SkillSummaryReview["templateSource"] = override ? "TENANT_OVERRIDE" : "PLATFORM_DEFAULT";
  const templateVersion = override?.version ?? 0;

  const instruction = `${template}${OUTPUT_CONTRACT}`;
  const base = { templateSource, templateVersion, model: d.model, reviewedAt };

  // ② LLM 调用（fail-open：抛错 → UNAVAILABLE 诚实档，绝不阻断发布）
  let raw: string;
  try {
    raw = await d.llm.compose({
      model: d.model,
      instruction,
      inputs: [{ name: skill.name, summary: skill.summary }],
      tenantId: d.ctx.tenantId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ...base, verdict: "UNAVAILABLE", issues: [`LLM 调用失败（建议式审查未执行，不得读作摘要合格）：${msg}`] };
  }

  // ③ 解析裁决（不可解析 → UNPARSEABLE 诚实档；「我没读到裁决」与「摘要合格」是两个命题）
  try {
    const v = VerdictSchema.parse(JSON.parse(stripCodeFence(raw)));
    return v.ok
      ? { ...base, verdict: "PASS", issues: [] }
      : { ...base, verdict: "ISSUES", issues: v.issues };
  } catch {
    return {
      ...base,
      verdict: "UNPARSEABLE",
      issues: [`LLM 输出不可解析为裁决 JSON（建议式审查未得出结论，不得读作摘要合格）。原文前 120 字：${raw.slice(0, 120)}`],
    };
  }
}
