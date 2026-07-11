import { z } from "zod";
import { SimilarityHitSchema } from "./cbr.js";

// ---------------------------------------------------------------------------
// L1.5 · 企业记忆 / CBR · agent「先查案例库」检索工具契约（WO-L1.5-3B）
//
// AgentCore 的 `retrieve_similar_cases` 工具 = **薄 OBO 适配器**：把 agent 的问题
// 特征/上下文经用户 JWT（OBO）转发给 DataCore `POST /a/v1/memory/cases/retrieve-similar`，
// 原样返回 DataCore 侧计算的相似案例（RetrievalResult）。相似度数学（pseudoEmbed ⊕
// scenario ⊕ business 加权）**只在 DataCore 计算**——AgentCore 绝不重算（薄 OBO·R1 契约）。
//
// 不变量：R1 contracts-only（跨 A/B 边界·故进 @platform/contracts）· R2 tenantId 随身
//   （由 DataCore 据 OBO 上下文注入·工具入参不含 tenantId）· R6 确定性（DataCore 侧纯函数打分）·
//   KILL-MOCK-RED：命中随行 origin(SEED/LEARNED) + disclaimer（案例数字不冒充业务真值）。
// ---------------------------------------------------------------------------

/** `retrieve_similar_cases` 工具入参（新问题特征/上下文·喂 DataCore 相似检索）。 */
export const RetrieveSimilarCasesInputSchema = z.object({
  /** 新问句/新问题文本（喂 DataCore pseudoEmbed·主检索信号）。 */
  text: z.string().min(1),
  /** 可选结构化上下文（有则精化 Scenario 维·∈ INTENT_PROBLEM_CLASS）。 */
  problemClass: z.string().nullable().default(null),
  /** 已解析本体键（base/model/segment…·精化 Business 维）。 */
  entities: z.array(z.string()).default([]),
  metrics: z.array(z.string()).default([]),
  topK: z.number().int().min(1).max(20).default(5),
});
export type RetrieveSimilarCasesInput = z.infer<typeof RetrieveSimilarCasesInputSchema>;

/** DataCore 检索结果（= RetrievalResult 的跨包投影·hits 逐条 SimilarityHit·AgentCore 原样透传）。 */
export const SimilarCasesResultSchema = z.object({
  hits: z.array(SimilarityHitSchema),
  total: z.number().int(),
  disclaimer: z.string(),
});
export type SimilarCasesResult = z.infer<typeof SimilarCasesResultSchema>;
