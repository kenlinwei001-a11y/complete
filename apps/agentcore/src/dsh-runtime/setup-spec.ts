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
  /**
   * 租户隔离池键（WO-DSH-N4）：harness 侧 vendored mcp-client-tenant 按 `${tenantId}\0${serverName}`
   * 共享/隔离 MCP 连接；mcpServers 非空时 harness validateSetupSpec fail-closed 必填。
   * tenantId 永不进公开工具名、永不上 wire 给 MCP server；过的是 session/prompt setup 帧。
   */
  tenantId: string;
  /** agent 级 system prompt（scoped section，order 1，跟在部署 persona 后）。 */
  persona?: string;
  /** scoped 工具允许表（S2 在 harness 侧强执；scopeToolNames 语义见 engine.ts 并集规则）。 */
  tools?: { name: string }[];
  /** dsh mcp-client Config 直通（secret 已在映射期解密注入——见 mapMcpConfig 安全注记）。 */
  mcpServers?: DshMcpServerSpec[];
  /** 技能全文 spec（P2A：harness 侧注册平台自有 SkillProvider，模型面目录 + `skill` 加载器见 mapSkill）。 */
  skills?: DshSkillSpec[];
  /** 治理线（S2 answerer 网桥消费；fail-closed 方向对我方有利）。 */
  governance?: DshGovernanceSpec;
  /**
   * WO-DSH-PROD-READY · W8主：授予的 BUILTIN 工具面（反向通道注册素材）。
   * harness 侧 platform-world 逐条注册成「反向工具」（execute = fetch 宿主 tool-execute
   * 端点）；description/inputSchema 过 wire 让子进程模型面与 native 同形同参。
   * 空/缺省 = 键不出（setup 帧逐字节旧行为）。
   */
  hostTools?: { name: string; description: string; inputSchema: Record<string, unknown> }[];
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
  /**
   * WO-DSH-PROD-READY · W8副（可见性 parity）：注册期工具允许表（公开名集合）。
   * additive 可选键——ref 无 toolFilter ⇒ 键缺席（setup 帧逐字节旧行为，A6 形态B 咬点）；
   * 有 ⇒ 子进程 mcp-client-tenant syncTools 注册期按表收窄（exotic 规范化名不匹配裸拼接
   * 表项 ⇒ fail-closed 丢弃）。键缺席与空数组语义不同：空数组 = 全丢（toolFilter: []）。
   */
  toolAllowlist?: string[];
}

/**
 * dsh-skill `SKILL_NAME` 正则逐字复刻（dsh-skill/lib/index.js `const SKILL_NAME`）：
 * kebab-case，只允许 [a-z0-9]，段间单连字符。**下划线/大写/连续连字符都不合法** ——
 * 违规名不会当场报错，而是被 dsh-skill 的 `validateCandidate` 抛出后由注册表
 * **吞成 warn 并跳过整个 provider**（目录静默变空），故必须在本侧映射期 fail-closed。
 */
const DSH_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 我方 `SkillDefinition.key` → dsh 面技能名（下划线→连字符）。 */
export function dshSkillName(key: string): string {
  return key.replace(/_/g, "-");
}

export interface DshSkillSpec {
  /** 我方业务键（审计/归因/重组装用；**不直接给模型** —— 模型面名是 dshName）。 */
  key: string;
  version: number;
  /** 我方显示名（人读；dsh 目录不渲染它）。 */
  name: string;
  /**
   * dsh 面技能名（= key 下划线换连字符）。模型在目录里看到、在 `skill({name})` 里回传的
   * 就是它；也是 SkillRegistry 层内去重键。
   */
  dshName: string;
  /**
   * 目录描述 = `SkillDefinition.summary`（**同一个量**，不是"语义相当"）：触发器短句，
   * 契约上限 200（contracts/agentcore.ts `SkillDefinitionSchema.summary` .max(200)）。
   * 逐条进模型面目录，是运行期 token 成本字段 —— 故 cordis.yml 把 dsh 侧
   * `catalogDescriptionMaxLength` 显式钉 200（上游默认 500 会把两端口径撬开）。
   */
  description: string;
  /**
   * 技能全文 = `SkillDefinition.body` 逐字节（dsh `SkillDefinition.content` 位，
   * 由 `<skill_instructions>` 包裹后给模型）。
   */
  content: string;
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
// ③ mapSkill：SkillDefinition(PUBLISHED) → DshSkillSpec（P2A：模型面目录 + `skill` 全文加载）
// ---------------------------------------------------------------------------

export function mapSkill(
  skill: SkillDefinition,
  binding?: { arguments?: Record<string, unknown> },
): DshSkillSpec {
  if (skill.status !== "PUBLISHED") {
    throw new Error(`mapSkill: skill ${skill.key}@${skill.version} is ${skill.status}, only PUBLISHED is mappable`);
  }
  const dshName = dshSkillName(skill.key);
  // 映射期 fail-closed（两处都是"违规不会当场报错、只会让目录静默变空"的形态）：
  // ① 名字不合 SKILL_NAME ⇒ dsh-skill validateCandidate 抛 → 注册表吞成 warn 跳过整个 provider；
  // ② description 空串 ⇒ 同上（validateCandidate 要求非空）。
  // 两者都必须在这里炸，否则模型面会得到**一份空目录而无人报错**。
  if (!DSH_SKILL_NAME.test(dshName)) {
    throw new Error(`mapSkill: skill key "${skill.key}" → dsh name "${dshName}" violates dsh SKILL_NAME (kebab-case ^[a-z0-9]+(-[a-z0-9]+)*$)`);
  }
  if (skill.summary.length === 0) {
    throw new Error(`mapSkill: skill ${skill.key}@${skill.version} has an empty summary; dsh requires a non-empty description`);
  }
  return {
    key: skill.key,
    version: skill.version,
    name: skill.name,
    dshName,
    description: skill.summary, // 同一个量（见 DshSkillSpec.description 注）
    content: skill.body, // 逐字节
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
 * 投影，属 S3 提示词装配）；skill 全文经 DshSkillSpec → harness 侧平台自有 SkillProvider
 * （P2A 已落地），目录与 `skill` 加载器由 dsh-tool-skill 从 ctx.skills 现取 —— 故 persona 里
 * **不写技能段**（旧 native 路的 buildSkillSection 是另一条臂，本函数不 import）。
 * 故 persona = agent.systemPrompt 原文 + AGENT_SYSTEM_CORE（由调用方传入，
 * 本函数不 import engine 私有常量——避免反向依赖）。
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
  /** W8主：授予工具中 binding.kind==="BUILTIN" 的子集（name/description/inputSchema），engine 分叉处筛入。 */
  hostTools?: { name: string; description: string; inputSchema: Record<string, unknown> }[];
  // ⛔ WO-WORKFLOW-MCP：`hostWorkflowTools` 已**退场**（工作流改走 DSH 原生 MCP 面
  // `mcp__workflow__{key}`，见 dsh-runtime/workflow-mcp-server.ts），此处刻意不再保留该形参。
}): DshSetupSpec {
  const { agent } = input;
  // P2A：dsh 面技能名层内唯一（SkillRegistry 层内同名后到者静默忽略）—— 映射期 fail-closed，
  // 否则两个不同 key 折成同一个 dshName 时会**静默少一个技能**。
  if (input.skills?.length) {
    const seen = new Set<string>();
    for (const s of input.skills) {
      if (seen.has(s.dshName)) throw new Error(`buildSessionSetup: duplicate dsh skill name "${s.dshName}" (keys collide after "-" mapping)`);
      seen.add(s.dshName);
    }
  }
  // final_answer/skill 是循环自加的元工具（AgentLoopOpts 契约：调用方 tools 不得含，循环自加）
  // ——dsh 路的允许表同理在适配层自加，否则治理闸（platform-world 白名单）会把它们一并拒掉。
  // P2A 换名：hand-rolled `load_skill` 已摘除，模型面加载器 = dsh-tool-skill 注册的 `skill`
  // （工具名是上游常量，不可配）；不并进允许表 ⇒ 治理闸 deny，模型面看得到目录但取不到全文。
  const loopMetaTools = ["final_answer", ...(input.skills?.length ? ["skill"] : [])];
  const effectiveToolNames = [...new Set([...agent.scopeDeclaration.toolNames, ...input.grantedToolNames, ...loopMetaTools])];
  return {
    tenantId: agent.tenantId, // N4：harness 侧 mcp namespace 池键的唯一来源（A11 机器核）
    persona: `${agent.systemPrompt}\n\n${input.agentSystemCore}`,
    tools: effectiveToolNames.map((name) => ({ name })),
    ...(input.mcpServers?.length ? { mcpServers: input.mcpServers } : {}),
    ...(input.skills?.length ? { skills: input.skills } : {}),
    ...(input.hostTools?.length ? { hostTools: input.hostTools } : {}),
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
