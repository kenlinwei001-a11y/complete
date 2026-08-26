// WO-DSH-POC-S1 · 我方 SDK server 变体（路 B 的 harness 侧部署物）。
//
// 为什么必须存在（S0 取证结论）：
//   stock `HarnessSdkJsonRpcServer.createSession` 调 `ctx.agents.create({sessionId, meta,
//   agentOptions})`，**不收 setup 钩子**（/tmp/dsh/packages/sdk/server/src/server.ts:223-231），
//   而 setup 是「按 AgentDefinition 组 scoped 世界」（scoped 工具 / prompt section / MCP / skill）
//   的唯一入口（core/agent/src/index.ts CreateAgentOptions.setup 文档：
//   "Everything registered through agentCtx … exists before session/created"）。
//   ⇒ 协议面不动（仍 3 方法），但 session/prompt 的 params 扩一个可选 `setup` 字段：
//   可序列化 SetupSpec（agentcore 侧 buildSessionSetup 的产物），仅在**会话创建那次** prompt 生效。
//
// 复用边界：构造器的四类通知订阅（session.event / session.status / subagent.*）原样继承；
// 会话表、initialize、prompt、shutdown 全部自管（父类对应成员是 TS private，且语义要改）。
// 与 stock 的一处功能差：不做 deepseek-official 兜底适配器自动挂载 —— 我方部署必带自己的
// LLM 适配器插件（POC 期 = mock-llm，生产 = platform 适配器），缺适配器直接报错更安全。

import { HarnessSdkJsonRpcServer } from '@deepseek-ai/dsh-sdk-jsonrpc-server'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { resolve } from 'node:path'
import { applySetupSpec, validateSetupSpec } from './platform-world.mjs'

export const name = 'platform-sdk-server'
// 同 stock：只要 agent 工厂；llm 经 ctx.get() 可选读取。
export const inject = ['agents']

class PlatformSdkServer extends HarnessSdkJsonRpcServer {
  constructor(ctx, transport, options = {}) {
    super(ctx, transport, options)
    // 自管状态（不用父类 private 成员，避免语义纠缠）。
    this.platformCtx = ctx
    this.platformCwd = process.cwd()
    this.platformProvider = undefined
    this.platformModel = undefined
    this.platformMaxTokens = undefined
    this.platformSessions = new Map()
    this.platformSessionCreations = new Map()
  }

  async handleRequest(method, params) {
    switch (method) {
      case 'initialize':
        return this.platformInitialize(params ?? {})
      case 'session/prompt':
        return this.platformPrompt(params ?? {})
      case 'shutdown':
        return this.platformShutdown()
      default:
        throw new Error(`unknown DeepSeek Harness SDK runtime method: ${method}`)
    }
  }

  async platformInitialize(params) {
    if (params.maxTokens !== undefined
      && (!Number.isSafeInteger(params.maxTokens) || params.maxTokens <= 0)) {
      throw new TypeError('initialize maxTokens must be a positive safe integer')
    }
    if (typeof params.cwd !== 'string' || typeof params.provider !== 'string' || typeof params.model !== 'string') {
      throw new TypeError('initialize requires cwd/provider/model strings')
    }
    this.platformCwd = resolve(params.cwd)
    this.platformProvider = params.provider
    this.platformModel = params.model
    this.platformMaxTokens = params.maxTokens
    const llm = this.platformCtx.get('llm')
    const hasAdapter = llm?.listProviders().some((entry) => entry.id === this.platformProvider) ?? false
    if (!hasAdapter) {
      throw new Error(`no adapter registered for provider "${this.platformProvider}" (platform-sdk-server mounts no fallback; declare one in cordis.yml)`)
    }
    return { serverInfo: { name: 'platform-dsh-harness-sdk-runtime', version: '0.1.0' } }
  }

  async platformPrompt(params) {
    if (typeof params.sessionId !== 'string' || !Array.isArray(params.contentBlocks)) {
      throw new TypeError('session/prompt requires sessionId string and contentBlocks array')
    }
    const rec = await this.platformGetOrCreateSession(params.sessionId, params.setup)
    if (this.platformCtx.agents.get(rec.handle.agent.id) !== rec.handle.agent) {
      throw new Error(`session agent was disposed outside the server: ${params.sessionId}`)
    }
    const message = createUserMessage({ content: params.contentBlocks, source: { kind: 'user' } })
    rec.handle.agent.followup(message)
    return { messageId: message.id }
  }

  platformGetOrCreateSession(sessionId, setupSpec) {
    const existing = this.platformSessions.get(sessionId)
    if (existing) {
      // setup 只在创建那次有效；对已活会话再带 setup = 客户端 bug，显式报错不静默吞。
      if (setupSpec !== undefined) {
        throw new Error(`session/prompt carried setup for live session ${sessionId}; setup is creation-only`)
      }
      return existing
    }
    const pending = this.platformSessionCreations.get(sessionId)
    if (pending) return pending
    const creation = this.platformCreateSession(sessionId, setupSpec)
    this.platformSessionCreations.set(sessionId, creation)
    void creation.then(
      () => { this.platformSessionCreations.delete(sessionId) },
      () => { this.platformSessionCreations.delete(sessionId) },
    )
    return creation
  }

  async platformCreateSession(sessionId, setupSpec) {
    const spec = validateSetupSpec(setupSpec)
    const handle = await this.platformCtx.agents.create({
      sessionId: SessionId(sessionId),
      meta: { cwd: this.platformCwd },
      agentOptions: {
        provider: this.platformProvider,
        model: this.platformModel,
        ...(this.platformMaxTokens === undefined ? {} : { maxTokens: this.platformMaxTokens }),
      },
      // ★ 与 stock 的唯一本质差异：setup 钩子进创建路径。
      setup: spec === undefined ? undefined : (agentCtx) => applySetupSpec(agentCtx, spec),
    })
    const rec = { handle }
    this.platformSessions.set(sessionId, rec)
    return rec
  }

  async platformShutdown() {
    this.platformShutdownTask ??= (async () => {
      const pendingCreations = [...this.platformSessionCreations.values()]
      await Promise.allSettled(pendingCreations)
      this.platformSessionCreations.clear()
      const records = [...this.platformSessions.values()]
      this.platformSessions.clear()
      const teardown = await Promise.allSettled(
        records.map((rec) => Promise.resolve().then(() => rec.handle.dispose())),
      )
      const failures = teardown.filter((r) => r.status === 'rejected').map((r) => r.reason)
      // 父类 shutdown 处理通知订阅与（不会有的）父类会话/兜底适配器。
      await super.shutdown()
      if (failures.length === 1) throw failures[0]
      if (failures.length > 1) throw new AggregateError(failures, 'platform SDK server teardown failed')
      return {}
    })()
    return this.platformShutdownTask
  }
}

// apply  wiring 与 stock sdk-jsonrpc-server 相同（stdout 只走协议帧；shutdown 应答冲刷后
// dispose 根上下文并 exit 0，EOF/信号退出归 app bin 管）。
export function apply(ctx) {
  const rootFiber = ctx.root.fiber
  const transport = new JsonRpcLineTransport(process.stdin, process.stdout)
  const server = new PlatformSdkServer(ctx, transport, {})

  let exitTask
  const disposeAndExit = () => {
    exitTask ??= (async () => {
      await Promise.allSettled([Promise.resolve().then(() => transport.flush())])
      await Promise.allSettled([Promise.resolve().then(() => rootFiber.dispose())])
      process.exit(0)
    })()
    return exitTask
  }

  transport.onRequest(async (method, params) => {
    const result = await server.handleRequest(method, params)
    if (method === 'shutdown') {
      setImmediate(() => { void disposeAndExit() })
    }
    return result
  })

  ctx.effect(() => {
    transport.start()
    return async () => {
      await server.platformShutdown()
      transport.close()
    }
  }, 'platform-jsonrpc.serve')
}
