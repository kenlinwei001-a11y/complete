// A18.2 · LLM 临时求解器生成（消灭 P5：缺求解器 → LLM 生成纯函数代码）。
// 只在生成时刻调一次 LLM，产物随后冻结（hash+版本）+ 锁死沙箱跑通——LLM 的不确定性被隔离在"生成时刻"之外（R6）。
import type { LlmClient } from "../llm.js";
import { SolverGenDraftSchema, type SolverGenDraft } from "@platform/contracts";

export interface SolverGenSpec {
  /** 缺失的求解器 key（如 capacity_switch_optimizer）。 */
  key: string;
  /** 自然语言意图（这个求解器要算什么）。 */
  intent: string;
  /** 可用对象类型 schema（ctx.objectsByType 的键 + 字段），供 LLM 写正确字段引用。 */
  objectTypes: { typeKey: string; props: string[] }[];
}

const SYSTEM = [
  "你为决策平台生成**临时求解器纯函数**。严格约束（违反即被沙箱拒）：",
  "1) 只输出一个纯函数表达式 `(ctx, args) => output`，无 import/require/网络/fs；",
  "2) **禁用** Date.now/new Date()/Math.random 等非确定来源（沙箱会掐死，必须确定性）；",
  "3) 只读 `ctx.objectsByType[<类型>]`（对象行数组）与 `args`（调用参数），返回可 JSON 序列化的对象；",
  "4) outputShape 列出 output 的顶层 key；argHints 给入参提示；rationale 一句话说明算法。",
  "computeSource 形如：(ctx, args) => { const orders = ctx.objectsByType.Order || []; return { total: orders.length }; }",
].join("\n");

/** 调 LLM 产出求解器草稿（沙箱跑通自检前）。mock LLM 测试；真 Kimi env-gated。 */
export async function generateSolverDraft(llm: LlmClient, spec: SolverGenSpec, opts: { tenantId?: string } = {}): Promise<SolverGenDraft> {
  const schemaText = spec.objectTypes.map((t) => `${t.typeKey}{${t.props.join(",")}}`).join(" · ");
  const draft = await llm.parseStructured<SolverGenDraft>({
    model: "default",
    maxTokens: 1500,
    system: SYSTEM,
    messages: [{ role: "user", content: `求解器 key：${spec.key}\n意图：${spec.intent}\n可用对象类型：${schemaText}\n生成 {computeSource,outputShape,argHints,rationale}。` }],
    schema: SolverGenDraftSchema,
    ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
    purpose: "comprehend",
  });
  return draft;
}
