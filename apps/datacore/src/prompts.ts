import type { PromptKey } from "@platform/contracts";
import type { Repos } from "./repo/repo.js";

/**
 * OC6 服务侧生效提示词（G-PROMPT-KEYS-CONFIG-ONLY 接线·WO-PROMPT-KEYS-WIRE）：
 * 把「只在配置表里」的提示词键接到真实 LLM 调用点——本 helper 是 A 侧统一取值口。
 *
 * 语义与 AgentCore 侧 resolvePromptOverride 对齐：**只采纳租户 override**——
 * repos 里有该键的非空模板 → 返回模板文本（admin 真 PUT 过才生效·灭漂移）；
 * 无记录 / 空白 → undefined（调用方兜底各自硬编码常量·R6 字节兼容·既有行为逐字节不变）。
 * 不回落 PLATFORM_PROMPT_DEFAULTS：那是管理台展示的精简占位，真实默认提示词在各调用点的
 * 硬编码常量里（更详），与 classifier 接线同语义。
 * A 侧直读本地仓储（同事务一致性·无网络），无需 B 侧那层 fail-open。
 */
export async function promptTemplateOverride(
  repos: Repos,
  tenantId: string,
  key: PromptKey,
): Promise<string | undefined> {
  const rec = await repos.promptTemplates.get(tenantId, `pt_${tenantId}_${key}`);
  return rec && rec.template.trim() ? rec.template : undefined;
}
