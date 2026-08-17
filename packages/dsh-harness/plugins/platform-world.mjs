// WO-DSH-POC-S1 · SetupSpec → AgentSetup 的 harness 侧装配（路 B 的「组 scoped 世界」执行体）。
//
// SetupSpec 是 agentcore 侧 buildSessionSetup() 的**可序列化**产物（过 JSON-RPC wire，
// 所以不能含函数/类实例）；本模块在 harness 进程内把 spec 兑现成 setup 回调里的真实注册。
// 对侧映射纯函数见 apps/agentcore/src/dsh-runtime/。
//
// S1 骨架兑现范围（其余字段先校验+透传，S2/S3 逐个落地，见各 TODO）：
//   - persona        → agentCtx  scoped system-prompt section（order 1，跟在部署 persona 后）
//   - mcpServers     → 每 server 一个 scoped mcp-client 插件实例（dsh mcp-client Config 直通）
//   - tools          → 校验形态；scoped 允许表强执行为 S2（连同 governance 网桥）
//   - skills         → 校验形态；scoped SkillProvider 注册为 S2
//   - governance     → 校验形态；answerer 网桥（rules PRE_CHECK → tools/pre-execute 裁决）为 S2

import * as McpClient from './mcp-client-tenant.mjs'
import { getAdjudicator } from './platform-governance.mjs'

/** agent 级 system prompt section 的固定名/序（root persona 是 order 0，agent 追加其后）。 */
export const AGENT_PERSONA_SECTION = 'platform:agent-persona'
export const AGENT_PERSONA_ORDER = 1

/**
 * 校验并归一客户端带来的 setup spec。undefined → undefined（无 setup 的普通会话）。
 * 形态错误**当场抛**（创建期 fail-closed：带畸形 spec 的会话不许出生）。
 */
export function validateSetupSpec(spec) {
  if (spec === undefined || spec === null) return undefined
  if (typeof spec !== 'object' || Array.isArray(spec)) {
    throw new TypeError('setup spec must be an object')
  }
  const out = {}
  if (spec.persona !== undefined) {
    if (typeof spec.persona !== 'string') throw new TypeError('setup.persona must be a string')
    out.persona = spec.persona
  }
  if (spec.tools !== undefined) {
    if (!Array.isArray(spec.tools) || spec.tools.some((t) => typeof t?.name !== 'string')) {
      throw new TypeError('setup.tools must be an array of {name}')
    }
    out.tools = spec.tools.map((t) => ({ name: t.name }))
  }
  if (spec.tenantId !== undefined) {
    // tenantId 是 mcp namespace 池键的唯一来源（N4）；拒空串/非串/NUL（\0 是池键分隔符，
    // contracts 侧 tenantId 仅 z.string() 无格式约束 —— 此处兜底，见 plan risks #3）。
    if (typeof spec.tenantId !== 'string' || spec.tenantId.length === 0 || spec.tenantId.includes('\0')) {
      throw new TypeError('setup.tenantId must be a non-empty string without NUL')
    }
    out.tenantId = spec.tenantId
  }
  if (spec.mcpServers !== undefined) {
    if (!Array.isArray(spec.mcpServers)) throw new TypeError('setup.mcpServers must be an array')
    // N4 fail-closed：mcpServers 非空但 tenantId 缺失 → 创建期抛（带畸形 spec 的会话不许出生，
    // 与现有校验风格一致；无 tenant 的池键会退化成根级独占语义，跨租户同名必然互撞）。
    if (spec.mcpServers.length > 0 && out.tenantId === undefined) {
      throw new TypeError('setup.tenantId is required when setup.mcpServers is non-empty (mcp namespace tenant isolation)')
    }
    // 逐条按 vendored mcp-client-tenant Config schema 校验（schemastery schema 是 callable、
    // 无 .parse —— S1 原写法 Config.parse 在 mcpServers 非空时必抛，冒烟 mcpServers:[] 从未踩到；
    // 缺字段补默认也在这步发生）。
    out.mcpServers = spec.mcpServers.map((c) => McpClient.Config(c))
  }
  if (spec.skills !== undefined) {
    if (!Array.isArray(spec.skills) || spec.skills.some((s) => typeof s?.key !== 'string' || typeof s?.body !== 'string')) {
      throw new TypeError('setup.skills entries require {key, body} strings')
    }
    out.skills = spec.skills
  }
  if (spec.governance !== undefined) {
    if (typeof spec.governance !== 'object' || spec.governance === null) {
      throw new TypeError('setup.governance must be an object')
    }
    out.governance = spec.governance
  }
  if (spec.finalAnswer !== undefined) {
    if (typeof spec.finalAnswer !== 'object' || spec.finalAnswer === null
      || typeof spec.finalAnswer.description !== 'string'
      || typeof spec.finalAnswer.schema !== 'object' || spec.finalAnswer.schema === null) {
      throw new TypeError('setup.finalAnswer requires {description: string, schema: object}')
    }
    out.finalAnswer = spec.finalAnswer
  }
  return out
}

/**
 * AgentSetup 回调本体：在 agentCtx（未发布的 agent scope）上兑现 spec。
 * 同步部分注册完即返；MCP 首连要 await —— AgentSetup 允许 async（工厂在发布前等它 settle）。
 */
export async function applySetupSpec(agentCtx, spec) {
  // persona：scoped section，只对本 agent 的 prompt 装配可见（cordis 层级waterfall）。
  if (spec.persona !== undefined) {
    const systemPrompt = agentCtx.get('systemPrompt')
    if (!systemPrompt) throw new Error('setup.persona requires the system-prompt plugin in cordis.yml')
    systemPrompt.section({
      name: AGENT_PERSONA_SECTION,
      order: AGENT_PERSONA_ORDER,
      text: spec.persona,
    })
  }

  // MCP（N4 已销账 S2 裁决）：每 server 一个 scoped mcp-client-tenant 实例，tenantId 注入
  // 连接池键 —— 同 tenant 同 serverName 共享一条连接，异 tenant 同 serverName 各起独立连接；
  // 公开名 mcp__<serverName>__<tool> 逐字节不变（tenantId 不进名、不上 wire 给 MCP server），
  // 可见性靠 dsh-tools 原生 scope 层（平级租户 scope 互不可见）。工具进本层 ToolRuntime。
  for (const config of spec.mcpServers ?? []) {
    await agentCtx.plugin(McpClient, { ...config, tenantId: spec.tenantId })
  }

  // TODO(S2·部分落地): skills SkillProvider 注册仍待 S2 后半；governance 网桥见下。

  // --- S3 · final_answer / load_skill scoped 注册（Answer 结构化载体 + 技能全文按需取） ---
  // final_answer：模型调它 = 收尾。harness 侧只做形状兜底校验（严校验在 agentcore 重组装侧
  // 对 AnswerBlockSchema —— wire 宽松、重组装严格，单校验点不双写）。
  const tools = agentCtx.get('tools')
  if (spec.finalAnswer !== undefined) {
    if (!tools) throw new Error('setup.finalAnswer requires the tools plugin in cordis.yml')
    tools.register({
      name: 'final_answer',
      description: spec.finalAnswer.description,
      parameters: spec.finalAnswer.schema,
      output: {
        schema: { type: 'object', properties: { recorded: { type: 'boolean' } }, required: ['recorded'] },
        render: () => [{ type: 'text', text: 'final answer recorded' }],
      },
      execute: async (args) => {
        if (typeof args !== 'object' || args === null) throw new Error('final_answer arguments must be an object')
        return { recorded: true }
      },
    })
  }
  // load_skill：spec.skills 自带全文，纯查找（我方 load_skill 语义：返回 body+resources+治理位；
  // 治理位不进 tool_result 字节 —— 这里 render 只出 body/resources 文本，governance 留在 value 里
  // 供会话日志/重组装读取，与 loop.ts「治理位不进字节」同口径）。
  if (spec.skills !== undefined && spec.skills.length > 0) {
    if (!tools) throw new Error('setup.skills requires the tools plugin in cordis.yml')
    const byKey = new Map(spec.skills.map((s) => [s.key, s]))
    tools.register({
      name: 'load_skill',
      description: '按需加载技能全文（目录摘要在 system prompt；调此取 body/resources）。',
      parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
      output: {
        schema: { type: 'object' },
        render: (args, value) => [{ type: 'text', text: value.found === false ? `skill not found: ${args.key}` : `## ${value.key}\n\n${value.body}` }],
      },
      execute: async (args) => {
        const skill = byKey.get(args?.key)
        if (!skill) return { found: false, key: args?.key ?? '' } // 缺省 fail-closed：找不到 = 明确否定，不编造
        return { found: true, key: skill.key, body: skill.body, resources: skill.resources, governance: skill.governance }
      },
    })
  }

  // --- S2 · 治理闸：scoped tools/pre-execute 监听器（只收本 agent 的调用） ---
  // 次序：① 允许表（spec.tools 非空 = 白名单，表外即 deny）② ruleBindings 裁决器。
  // 监听器挂在 agentCtx 上 —— dsh scope-filtered dispatch 保证只收本 agent 的调用
  // （core/tools 事件文档：agent-scoped listeners receive only that agent's calls）。
  const allow = spec.tools !== undefined && spec.tools.length > 0
    ? new Set(spec.tools.map((t) => t.name))
    : undefined
  if (allow !== undefined || spec.governance !== undefined) {
    agentCtx.on('tools/pre-execute', async (exec, next) => {
      if (allow !== undefined && !allow.has(exec.name)) {
        return { kind: 'deny', reason: `tool ${exec.name} not in agent scope allow-list (scopeDeclaration ∪ granted)` }
      }
      if (spec.governance !== undefined) {
        const adjudicator = getAdjudicator()
        // 有治理声明但部署没配裁决器 = 配置错误，fail-closed 拒（不静默放行）。
        if (!adjudicator) {
          return { kind: 'deny', reason: 'governance ruleBindings present but no adjudicator plugin configured (fail-closed)' }
        }
        return adjudicator({ name: exec.name, arguments: exec.arguments }, spec.governance)
      }
      return next()
    })
  }
}
