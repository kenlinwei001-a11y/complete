import { z } from "zod";

/**
 * Dogfooding P2 · 元本体访问策略（可配置鉴权,按租户）：
 * `/a/v1/meta/*` + meta MCP 工具的角色白名单,默认仅 `admin`,admin 可增删其他角色。
 * 元数据 = 平台自我模型（跨全租户治理信息）,按调用方所在租户的策略放行。R14：默认值非硬编码业务常数。
 */
export const META_ACCESS_DEFAULT_ROLES = ["admin"] as const;

export const MetaAccessPolicySchema = z.object({
  tenantId: z.string(),
  /** 可访问 /meta/* 的角色白名单（默认 ["admin"]）。 */
  roles: z.array(z.string()).min(1).default([...META_ACCESS_DEFAULT_ROLES]),
  updatedAt: z.string().optional(),
});
export type MetaAccessPolicy = z.infer<typeof MetaAccessPolicySchema>;

/** PUT /a/v1/meta/access-policy 请求体。 */
export const MetaAccessPolicyBodySchema = z.object({
  roles: z.array(z.string()).min(1),
});
export type MetaAccessPolicyBody = z.infer<typeof MetaAccessPolicyBodySchema>;
