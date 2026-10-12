import { mcpServerNameSlug, mcpToolFullName, type McpServerConfig } from "@platform/contracts";

/**
 * DSH 原生 MCP 面在屏上的**唯一**读法来源。
 *
 * 管理端此前只显示「名称 + 凭据」，于是运维问不出「这个 agent 能调到哪些命名空间下的哪些工具」——
 * 命名空间 `mcp__{serverName}__{toolName}` 是模型真正看见的名字（scopeDeclaration 与审计同用全名），
 * 而屏上连 `serverName` 都没有。
 *
 * 本模块**不发明任何字段**，只做两件事：
 * ① 把契约里已有的东西翻译成屏上文本（命名空间全名取契约的 `mcpToolFullName`，不另抄一份拼接）；
 * ② 把契约里**取不到**的东西如实标注来源（见 `mcpNamespaceOf` 的 `downlinked`）。
 */

/**
 * 平台保留的 MCP 配置行 id 前缀。**不是契约字段**，是平台自有的登记约定：
 * 三个平台内置 server（本体切片 / 求解器 / 工作流）的配置行 id 都以此为前缀，
 * 而租户新建的配置行走服务端生成的 `mcp_<ulid>`（形如 `mcp_01J...`）—— 两者结构上不可能撞。
 *
 * ⚠ 判定依据只是这个前缀，故屏上一律标注判据（`MCP_ORIGIN_BASIS`），
 * ⛔ 不许把它当成契约里的 `builtin` 字段来用（契约里没有这个字段）。
 */
export const PLATFORM_MCP_CONFIG_ID_PREFIX = "mcp_builtin_";

/** 屏上给出的判据原文（R-UI-4：只讲数据依据，不出现源码文件名/行号）。 */
export const MCP_ORIGIN_BASIS = `按平台保留的配置行 id 前缀 ${PLATFORM_MCP_CONFIG_ID_PREFIX} 判定`;

/** 命名空间通配前缀 `mcp__{serverName}__*`（复用契约的全名构造，不另抄拼接）。 */
export function mcpNamespaceWildcard(serverName: string): string {
  return mcpToolFullName(serverName, "*");
}

export interface McpNamespace {
  /** 运行时真正生效的命名空间标识（进 `mcp__{serverName}__{toolName}`）。 */
  serverName: string;
  /**
   * true = 该值由后端下发（契约字段 `serverName` 存在）；
   * false = 契约字段缺席，取值按服务端**同一条回落规则**（展示名推导）算出 —— 屏上必须标注，
   *         不许把它画成「后端下发了」。
   */
  downlinked: boolean;
  /** `mcp__{serverName}__*` */
  wildcard: string;
}

/**
 * 取一条 MCP 配置的运行时命名空间。
 *
 * 回落规则与服务端逐字同源：`serverName ?? mcpServerNameSlug(name)`（契约导出的 `mcpServerNameSlug`，
 * 服务端在创建、详情聚合、运行装配三处都用它）。故此处不是前端自行发明的推导，而是复现服务端既有行为；
 * 但它**仍然是推导**，所以 `downlinked:false` 会被屏上如实标成「未下发」。
 */
export function mcpNamespaceOf(cfg: Pick<McpServerConfig, "name" | "serverName">): McpNamespace {
  const serverName = cfg.serverName ?? mcpServerNameSlug(cfg.name);
  return { serverName, downlinked: cfg.serverName != null, wildcard: mcpNamespaceWildcard(serverName) };
}

export type McpOrigin = "PLATFORM" | "TENANT";

/** 平台内置 / 租户自建。判据见 `MCP_ORIGIN_BASIS`。 */
export function mcpOriginOf(cfg: Pick<McpServerConfig, "id">): McpOrigin {
  return cfg.id.startsWith(PLATFORM_MCP_CONFIG_ID_PREFIX) ? "PLATFORM" : "TENANT";
}

export const MCP_ORIGIN_LABEL: Record<McpOrigin, string> = {
  PLATFORM: "平台内置",
  TENANT: "租户自建",
};

/** 工具过滤面：`toolFilter` 缺席 ≡ 全部工具（不是「没有工具」）。 */
export function mcpToolFilterLabel(toolFilter: string[] | undefined): string {
  return toolFilter && toolFilter.length > 0 ? toolFilter.join("、") : "全部工具（未设过滤）";
}
