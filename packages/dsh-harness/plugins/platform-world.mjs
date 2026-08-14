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

import * as McpClient from '@deepseek-ai/dsh-mcp-client'

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
  if (spec.mcpServers !== undefined) {
    if (!Array.isArray(spec.mcpServers)) throw new TypeError('setup.mcpServers must be an array')
    // 逐条按 dsh mcp-client Config schema 校验（zod parse；缺字段补默认也在这步发生）。
    out.mcpServers = spec.mcpServers.map((c) => McpClient.Config.parse(c))
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
    systemPrompt.section.call(agentCtx.get('systemPrompt'), {
      name: AGENT_PERSONA_SECTION,
      order: AGENT_PERSONA_ORDER,
      text: spec.persona,
    })
  }

  // MCP：每 server 一个 scoped mcp-client 实例，工具按 mcp__<serverName>__<tool> 进本层 ToolRuntime。
  // 已知限制（S2 裁决）：dsh mcp-client 的 serverName 预留是**根级**的（activeServerNames 按 ctx.root
  // 键控）——两个 agent 挂同名 server 会撞「duplicate namespace」。S2 要在「根级共享连接池 + scoped
  // 可见性过滤」与「每会话后缀改名（破坏 mcp__ 审计名）」之间选。POC 期同 server 单 agent 先用直通。
  for (const config of spec.mcpServers ?? []) {
    await agentCtx.plugin(McpClient, config)
  }

  // TODO(S2): tools 允许表强执（scoped restrict / pre-execute 闸）+ skills SkillProvider + governance 网桥。
  // spec.tools / spec.skills / spec.governance 已校验透传到此，S2 直接消费。
}
