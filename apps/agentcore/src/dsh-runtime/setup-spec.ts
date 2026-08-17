/**
 * WO-DSH-POC-S1 · 路 B 适配层：我方 AgentDefinition/McpServerConfig/SkillDefinition
 * → dsh 可序列化 SetupSpec 的**纯映射**（零 IO、零进程、零 dsh 运行时依赖——
 * 输出物过 JSON-RPC wire，所以只能含 JSON 值）。
 *
 * 对侧执行体：packages/dsh-harness/plugins/platform-world.mjs（applySetupSpec）。
 * wire 扩展点：session/prompt 的 `setup` 字段（仅会话创建那次生效）。
 *
 * 映射语义单一出处原则：凡本仓已有单源判定的（isWriteModeSkill / skillGovernance /
 * mcpServerNameSlug / 解密），这里**调用或复刻同一口径并注明出处**，不另起炉灶。
 */

import { createHash } from "node:crypto";
import type { AgentDefinition, McpServerConfig, SkillDefinition } from "@platform/contracts";
import { isWriteModeSkill, mcpServerNameSlug } from "@platform/contracts";
import { DEFAULT_FINAL_ANSWER_SCHEMA, FINAL_ANSWER_DESC } from "../agent/loop.js";

// ---------------------------------------------------------------------------
// SetupSpec：过 wire 的会话创建期组态（与 packages/dsh-harness 侧 validateSetupSpec 对偶）
// ---------------------------------------------------------------------------

export interface DshSetupSpec {
  /** agent 级 system prompt（scoped section，order 1，跟在部署 persona 后）。 */
  persona?: string;
  /** scoped 工具允许表（S2 在 harness 侧强执；scopeToolNames 语义见 engine.ts 并集规则）。 */
  tools?: { name: string }[];
  /** dsh mcp-client Config 直通（secret 已在映射期解密注入——见 mapMcpConfig 安全注记）。 */
  mcpServers?: DshMcpServerSpec[];
  /** 技能全文spec（S2 注册 scoped SkillProvider；load_skill 语义见 mapSkill）。 */
  skills?: DshSkillSpec[];
  /** 治理线（S2 answerer 网桥消费；fail-closed 方向对我方有利）。 */
  governance?: DshGovernanceSpec;
  /**
   * final_answer 终止工具的 schema 下发（harness 侧 scoped 注册；模型调它收尾 =
   * 我方 Answer 的结构化载体）。description/schema 单一出处 = agent/loop.ts 导出常量；
   * expectsSchema 模式下由 buildSessionSetup 替换为调用方 schema（raw input 直通 structured）。
   */
  finalAnswer?: { description: string; schema: Record<string, unknown> };
}

export interface DshMcpServerSpec {
  transport: "stdio" | "streamable-http";
  serverName: string;
  // stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  // streamable-http
  url?: string;
  headers?: Record<string, string>;
  // 公共（dsh 缺省 60s；我方契约上限 60s、缺省 20s —— 显式下发不依赖对侧默认）
  toolCallTimeoutMs: number;
  failOnStartupError: boolean;
  reconnect: { enabled: boolean; initialDelayMs: number; maxDelayMs: number; maxAttempts: number };
}

export interface DshSkillSpec {
  key: string;
  version: number;
  name: string;
  summary: string;
  body: string;
  resources: { name: string; blobKey: string; mime?: string; description?: string }[];
  /** skillGovernance(skill) 同口径三件套（loop.ts:451 单源；治理位不进 tool_result 字节）。 */
  governance: { writeMode: boolean; provenancePolicy: "required" | "best_effort" | "none" };
  inputSchema?: Record<string, unknown>;
  /** AgentDefinition.skills[].arguments 预填默认值（WO-SKILL-1）。 */
  defaultArguments?: Record<string, unknown>;
}

export interface DshGovernanceSpec {
  ruleBindings: { ruleKeys: string[] | "ALL_APPLICABLE"; mode: "PRE_CHECK" | "POST_CHECK" | "BOTH" };
  /** scopeDeclaration 原文携带（对象域强执在 S2 网桥；toolNames 并集规则在 buildSessionSetup 已展开）。 */
  scopeObjectTypes: string[];
}

// ---------------------------------------------------------------------------
// ① mapAgentOptions：AgentDefinition → dsh agentOptions（provider/model/maxTokens）
// ---------------------------------------------------------------------------

/**
 * provider 是 harness 侧 LLM 适配器的**路由名**（POC = "mock"；生产 = 我方 platform 适配器
 * 注册名）。model 必须是**已解析**的具体模型（engine.ts:381 的 roleModel 回落在调用方完成，
 * 本函数不重复回落——单源）。maxTokens 取 AgentBudget 无对应字段，dsh 侧 cap 由 initialize
 * maxTokens 承担，此处不出。
 */
export function mapAgentOptions(
  agent: Pick<AgentDefinition, "model" | "tenantId">,
  resolvedModel: string,
  providerRoute: string,
): { provider: string; model: string } {
  if (!resolvedModel) throw new Error("mapAgentOptions requires a resolved model (roleModel fallback happens in engine)");
  // agent.model 为空串 = 继承租户绑定矩阵（契约注释），此时 resolvedModel 就是继承结果；
  // 非空且与 resolvedModel 不一致 = 调用方拿错版本，显式报错不静默。
  if (agent.model && agent.model !== resolvedModel) {
    throw new Error(`mapAgentOptions: agent.model "${agent.model}" != resolved "${resolvedModel}"`);
  }
  return { provider: providerRoute, model: resolvedModel };
}

// ---------------------------------------------------------------------------
// ② mapMcpConfig：McpServerConfig → dsh mcp-client Config（解密在映射期完成）
// ---------------------------------------------------------------------------

/**
 * dsh publicToolName 规整复刻（/tmp/dsh/packages/mcp/mcp-client/src/tools.ts:96-102）：
 * 拼接 mcp__{serverName}__{rawName} → 非 [A-Za-z0-9_-] 折叠为 _ → 超 64 字符截断并追加
 * 12 位 sha256。我方 serverName 正则 ^[a-z0-9_]{2,24}$（contracts/agentcore.ts:96）是 dsh
 * ^[A-Za-z0-9_-]{1,32}$ 的**安全子集**，拼接段本身不会触发规整；但 MCP server 自己的
 * rawName 可能含非法字符/超长 —— 审计名预测必须走与 dsh 同一算法。
 */
export function dshPublicToolName(serverName: string, rawName: string): string {
  const joined = `mcp__${serverName}__${rawName}`;
  const normalized = joined.replace(/[^A-Za-z0-9_-]/g, "_");
  if (normalized === joined && normalized.length <= 64) return normalized;
  const hash = createHash("sha256").update(`${serverName}\0${rawName}`).digest("hex").slice(0, 12);
  return `${normalized.slice(0, 64 - 12 - 1)}_${hash}`;
}

/**
 * McpServerConfig → dsh mcp-client Config。
 *
 * 安全注记（S0 结论的落地）：dsh Config 只有**明文** headers/env，而我方 credentialRef 是
 * AES-256-GCM 密文（crypto.ts encryptSecret；运行时解密 mcp/runtime.ts:161-164；注入
 * mcp/client.ts:39-56 = streamable_http 走 Bearer header / stdio 走 MCP_CREDENTIAL env）。
 * 故解密必须在 agentcore 侧映射期完成（decryptSecret 由调用方注入，本函数不读 env 不碰
 * 文件，保纯）；明文随 SetupSpec 过 stdio wire —— 仅在本机父子进程间，与今日进程内明文
 * 内存驻留同级，但**绝不落日志/持久化**（S3 SSE 桥不许转发 setup 帧）。
 */
export function mapMcpConfig(
  config: McpServerConfig,
  decryptSecret: (credentialRef: string) => string | undefined,
): DshMcpServerSpec {
  // serverName 缺省从 name 推导（契约 mcpServerNameSlug 单源）；推导结果仍须过契约正则。
  const serverName = config.serverName ?? mcpServerNameSlug(config.name);
  if (!/^[a-z0-9_]{2,24}$/.test(serverName)) {
    throw new Error(`mapMcpConfig: serverName "${serverName}" violates ^[a-z0-9_]{2,24}$`);
  }
  const secret = config.credentialRef ? decryptSecret(config.credentialRef) : undefined;
  if (config.credentialRef && secret === undefined) {
    // 与 mcp/runtime.ts 同口径：引用了凭据但解不出 = MISSING_CREDENTIAL 类失败，不许静默降级为无凭据连接。
    throw new Error(`mapMcpConfig: credentialRef unresolvable for mcp config ${config.id}`);
  }
  const base = {
    serverName,
    toolCallTimeoutMs: config.toolTimeoutMs ?? 20_000, // 我方契约缺省 20s（增量 §4.1），显式下发
    failOnStartupError: false, // 与 dsh 默认一致：首连失败不阻插件激活（状态面 ERROR 由我方外壳管）
    reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 }, // RECONNECT_DEFAULTS
  };
  if (config.transport.type === "streamable_http") {
    return {
      ...base,
      transport: "streamable-http",
      url: config.transport.url,
      headers: secret === undefined ? {} : { Authorization: `Bearer ${secret}` }, // mcp/client.ts:39-56 同口径
    };
  }
  return {
    ...base,
    transport: "stdio",
    command: config.transport.command,
    args: config.transport.args,
    env: secret === undefined ? {} : { MCP_CREDENTIAL: secret }, // 同口径
    cwd: "",
  };
}

// ---------------------------------------------------------------------------
// ③ mapSkill：SkillDefinition(PUBLISHED) → DshSkillSpec（load_skill 全文按需取的载体）
// ---------------------------------------------------------------------------

export function mapSkill(
  skill: SkillDefinition,
  binding?: { arguments?: Record<string, unknown> },
): DshSkillSpec {
  if (skill.status !== "PUBLISHED") {
    throw new Error(`mapSkill: skill ${skill.key}@${skill.version} is ${skill.status}, only PUBLISHED is mappable`);
  }
  return {
    key: skill.key,
    version: skill.version,
    name: skill.name,
    summary: skill.summary,
    body: skill.body,
    resources: skill.resources.map((r) => ({
      name: r.name,
      blobKey: r.blobKey,
      ...(r.mime !== undefined ? { mime: r.mime } : {}),
      ...(r.description !== undefined ? { description: r.description } : {}),
    })),
    governance: {
      writeMode: isWriteModeSkill(skill), // 契约单源（sideEffect ∪ approvalGate 两半）
      provenancePolicy: skill.provenancePolicy ?? "best_effort", // loop.ts skillGovernance 缺省同口径
    },
    ...(skill.inputSchema !== undefined ? { inputSchema: skill.inputSchema as Record<string, unknown> } : {}),
    ...(binding?.arguments !== undefined ? { defaultArguments: binding.arguments } : {}),
  };
}

// ---------------------------------------------------------------------------
// ④ buildSessionSetup：组装一份完整 SetupSpec（engine.ts:379-460 的语义压缩）
// ---------------------------------------------------------------------------

/**
 * persona 组装对齐 engine.ts:460 现状：`${agent.systemPrompt}\n\n${AGENT_SYSTEM_CORE}${skillSection}`。
 * S1 骨架不做 Phase5C skill 语义路由（top-k 摘要注入）与导航切片/语义锚定（那是 userContent 侧的
 * 投影，属 S3 提示词装配）；skill 全文经 DshSkillSpec 走 load_skill 机制，summary 列表由
 * harness 侧 SkillProvider 目录自然呈现（S2）。故 S1 persona = agent.systemPrompt 原文 +
 * AGENT_SYSTEM_CORE（由调用方传入，本函数不 import engine 私有常量——避免反向依赖）。
 *
 * tools 允许表 = scopeDeclaration.toolNames ∪ 实际授予工具名（engine.ts 「显式配置的工具
 * 绝不应被自身 scope 门拒」并集规则，只加不减）。实际授予集由调用方传入（expandAgentTools
 * + MCP router 收窄后的终态）。
 */
export function buildSessionSetup(input: {
  agent: AgentDefinition;
  agentSystemCore: string;
  grantedToolNames: string[];
  mcpServers?: DshMcpServerSpec[];
  skills?: DshSkillSpec[];
  /** loop.ts AgentLoopOpts.expectsSchema 对位：提供则替换 final_answer schema，raw input 进 structured。 */
  expectsSchema?: Record<string, unknown>;
  finalAnswerDescription?: string;
}): DshSetupSpec {
  const { agent } = input;
  // final_answer/load_skill 是循环自加的元工具（AgentLoopOpts 契约：调用方 tools 不得含，
  // 循环自加）——dsh 路的允许表同理在适配层自加，否则治理闸会把收尾工具一并拒掉。
  const loopMetaTools = ["final_answer", ...(input.skills?.length ? ["load_skill"] : [])];
  const effectiveToolNames = [...new Set([...agent.scopeDeclaration.toolNames, ...input.grantedToolNames, ...loopMetaTools])];
  return {
    persona: `${agent.systemPrompt}\n\n${input.agentSystemCore}`,
    tools: effectiveToolNames.map((name) => ({ name })),
    ...(input.mcpServers?.length ? { mcpServers: input.mcpServers } : {}),
    ...(input.skills?.length ? { skills: input.skills } : {}),
    governance: {
      ruleBindings: agent.ruleBindings,
      scopeObjectTypes: agent.scopeDeclaration.objectTypes,
    },
    finalAnswer: {
      description: input.finalAnswerDescription ?? FINAL_ANSWER_DESC,
      schema: input.expectsSchema ?? DEFAULT_FINAL_ANSWER_SCHEMA,
    },
  };
}
