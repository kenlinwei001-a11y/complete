import { z } from "zod";

/**
 * WO-RESOURCE-DESCRIPTOR · 统一资源描述契约（发现供给侧的单一形状）。
 *
 * 平台里"可被发现/被 LLM 选用"的能力分散在多池：求解器目录、本体切片、工作流·操作意图、
 * 字段目录、MCP 工具。历史上每池各有各的描述字段（description / label / descriptionForLLM…），
 * 「没有给 LLM 看的描述就不允许发布」的纪律先前只在 catalog.test 守求解器一池（约 line 54）。
 * 本契约把该纪律推广到全池：任何可发现资源都必须能投影成 ResourceDescriptor，且 description 非空。
 *
 * 派生投影（R13）：ResourceDescriptor 不是新真值源——由各池现有元数据映射而来，不改各池存储。
 * 发现门 `resource-descriptor:check`（scripts/check-resource-descriptor.mjs）扫全池：任一资源
 * 投影后 description 为空 → 门红（发布纪律有牙）。R14：描述是能力语义，非内联业务常数。
 */

/**
 * 可发现资源类别。前 6 类与发现池一一对应（workflow/intent 同源于操作意图目录）；
 * WO-RESOURCE-CATALOG-ONTOLOGY 增第 7 类 `object_type`（本体对象类型池——Agent 搜得到"有什么数据"）。
 */
export const RESOURCE_KINDS = ["solver", "slice", "workflow", "intent", "field", "mcp_tool", "object_type"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export const ResourceKindSchema = z.enum(RESOURCE_KINDS);

export const ResourceDescriptorSchema = z.object({
  /** 资源类别（决定它出现在哪个发现池）。 */
  kind: ResourceKindSchema,
  /** 池内唯一键（如求解器 key / 切片 sliceKey / 操作 op / 字段 typeKey.propKey / MCP 工具名）。 */
  key: z.string().min(1),
  /** 人类可读短标签（一句话名）。 */
  label: z.string().min(1),
  /** LLM 可读描述——**非空是发布硬门**（无描述不允许发布，全池统一）。 */
  description: z.string().min(1),
  /** 该资源能回答的问句样例（供近似问句检索/选型，可选）。 */
  answersQuestions: z.array(z.string()).optional(),
  /** 检索标签（可选）。 */
  tags: z.array(z.string()).optional(),
  /** 参数提示（字段名 → 说明，可选）。 */
  argHints: z.record(z.string(), z.string()).optional(),
  /** 所属域（可选）。 */
  domain: z.string().optional(),
  /** 关联 feature key（未开通 → 不出现在发现池，可选）。 */
  featureKey: z.string().optional(),
});
export type ResourceDescriptor = z.infer<typeof ResourceDescriptorSchema>;

/** 单条投影校验失败信息。 */
export interface DescriptorViolation {
  index: number;
  kind?: string;
  key?: string;
  reason: string;
}

/**
 * 发现门核心校验（纯函数·确定性 R6·供 gate 脚本与单测共用）：对一组候选资源投影逐条跑
 * ResourceDescriptorSchema。任一条不合法（尤以 description 空）→ 记一条 violation。
 * 返回空数组 = 全池达标（门绿）；非空 = 门红。真闸：造无描述资源即被捕获。
 */
export function findUndescribed(candidates: unknown[]): DescriptorViolation[] {
  const out: DescriptorViolation[] = [];
  candidates.forEach((c, index) => {
    const parsed = ResourceDescriptorSchema.safeParse(c);
    if (!parsed.success) {
      const rec = (c ?? {}) as Record<string, unknown>;
      const reason = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      out.push({
        index,
        ...(typeof rec.kind === "string" ? { kind: rec.kind } : {}),
        ...(typeof rec.key === "string" ? { key: rec.key } : {}),
        reason,
      });
    }
  });
  return out;
}
