// WO-DSH-E2E · L4 池键/审计同世界组合断言（node:test，DSH_HARNESS=1 门）。
//
// 与 N4 namespace-tenant-seam 的关系：复用其世界构造形态（cordis root + system-prompt +
// tools + createScope agent 替身 + validateSetupSpec→applySetupSpec），**不重复其断言**——
// 本文件净增：① 同世界双 tenant 同 serverName 的 pidFile 计数 == 2（A1/A2 只断言挂载成功
// 与路由，从未数 pid；A6 数的是同 tenant == 1）；② 本文件是 E2E WO 自己的 mutation #8
// （池键摘 tenantId 段）红位——池键退化 ⇒ P1 挂载即抛 /already in use/ 或 pid 计数 == 1，
// P2 whoami 路由串 tenant（回 tenantAlpha 标记）⇒ 红。
// 标记选型同 agentcore 侧：大小写混合防 base36 假撞。

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as cordis from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { createScope } from '@deepseek-ai/dsh-scope'
import { validateSetupSpec, applySetupSpec } from '../plugins/platform-world.mjs'

assert.equal(process.env.DSH_HARNESS, '1', 'gate: pool-collision e2e requires DSH_HARNESS=1')

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(here, 'fixtures', 'mock-mcp-tenant.mjs')

const T_ALPHA = 'tenantAlpha'
const T_BETA = 'tenantBeta'

const worlds = []
async function makeWorld() {
  const app = new cordis.Context()
  await app.plugin(SystemPrompt, { persona: 'l4 pool e2e' })
  await app.plugin(ToolRuntime, { mode: 'native' })
  worlds.push(app)
  return app
}

function makeAgent(app, tenantId, id) {
  const agent = { id, sessionId: id, tenantId }
  const scope = createScope(app, agent)
  const ctx = scope.ctx.extend({ agent })
  return { agent, scope, ctx }
}

const stdioCfg = (marker, pidFile) => ({
  transport: 'stdio',
  serverName: 'erp',
  command: process.execPath,
  args: [FIXTURE, marker, pidFile],
  toolCallTimeoutMs: 5000,
  failOnStartupError: true,
  reconnect: { enabled: false, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 1 },
})

const readPids = (pidFile) => readFileSync(pidFile, 'utf8').split('\n').filter(Boolean).map(Number)

let callSeq = 0
async function callWhoami(app, agent) {
  const ac = new AbortController()
  return app.get('tools').execute({
    callId: `l4pool-${++callSeq}`,
    name: 'mcp__erp__whoami',
    arguments: {},
    agent,
    signal: ac.signal,
  })
}

const resultText = (result) => (result.content ?? []).map((b) => b.text ?? '').join('\n')

after(async () => {
  for (const app of worlds) {
    try { await app.fiber.dispose() } catch { /* 清理尽力而为 */ }
  }
})

const W = {}
before(async () => {
  W.dir = mkdtempSync(join(tmpdir(), 'l4-pool-'))
  W.pidFile = join(W.dir, 'pids')
  writeFileSync(W.pidFile, '')
  W.app = await makeWorld()
  W.audit = []
  W.app.on('tools/pre-execute', (exec, next) => {
    W.audit.push({ name: exec.name, tenantId: exec.agent?.tenantId })
    return next()
  })
  W.agentA = makeAgent(W.app, T_ALPHA, 'agent-alpha')
  W.agentB = makeAgent(W.app, T_BETA, 'agent-beta')
})

test('P1 池键各立：同世界双 tenant 同 serverName ⇒ pidFile 恰 2 异 pid（不共享不互撞）', async () => {
  await applySetupSpec(W.agentA.ctx, validateSetupSpec({ tenantId: T_ALPHA, mcpServers: [stdioCfg(T_ALPHA, W.pidFile)] }))
  await applySetupSpec(W.agentB.ctx, validateSetupSpec({ tenantId: T_BETA, mcpServers: [stdioCfg(T_BETA, W.pidFile)] }))
  const pids = readPids(W.pidFile)
  assert.equal(pids.length, 2, '双 tenant 同 serverName 各起一只夹具子进程')
  assert.equal(new Set(pids).size, 2, '两连接不共享同一子进程')
})

test('P2 路由+审计归属：whoami 各回各 marker；pre-execute 审计帧 tenantId 不错位', async () => {
  const ra = await callWhoami(W.app, W.agentA.agent)
  const rb = await callWhoami(W.app, W.agentB.agent)
  assert.match(resultText(ra), new RegExp(`whoami:${T_ALPHA}`))
  assert.match(resultText(rb), new RegExp(`whoami:${T_BETA}`))
  // 审计归属：两侧公开名逐字节相同，归因只靠 exec.agent.tenantId（N4 A5 口径）。
  assert.deepEqual(W.audit, [
    { name: 'mcp__erp__whoami', tenantId: T_ALPHA },
    { name: 'mcp__erp__whoami', tenantId: T_BETA },
  ])
})
