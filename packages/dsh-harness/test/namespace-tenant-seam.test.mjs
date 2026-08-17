// WO-DSH-N4 · MCP namespace 租户隔离 A/B 负向接缝套件（plan assertions A0-A10、A12；A11 在
// apps/agentcore/test/dsh-runtime-map.test.ts 映射侧）。
//
// 结构：真 cordis root + 真 dsh-system-prompt/dsh-tools 服务 + 真 scoped 层级（dsh-scope createScope，
// 仿 dsh-agent-loop 的 agent scope 铸造：scope key = agent 替身，ctx.extend({agent})），
// MCP server = test/fixtures/mock-mcp-tenant.mjs（真 stdio 子进程，NDJSON JSON-RPC）。
// 驱动面 = harness 侧 validateSetupSpec → applySetupSpec（与 platform-sdk-server 创建路径同款）。
//
// A0 门：本套件只在 DSH_HARNESS=1 下有意义（§6 前置C 判据③：原生路绿不算）。

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as cordis from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { createScope } from '@deepseek-ai/dsh-scope'
import { validateSetupSpec, applySetupSpec } from '../plugins/platform-world.mjs'

// --- A0 门（测试进程顶部断言，非 1 即 fail） ---
assert.equal(process.env.DSH_HARNESS, '1', 'A0 gate: namespace seam suite requires DSH_HARNESS=1')

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(here, 'fixtures', 'mock-mcp-tenant.mjs')

// ---------------------------------------------------------------------------
// 世界/agent 替身构造
// ---------------------------------------------------------------------------

const worlds = []

async function makeWorld() {
  const app = new cordis.Context()
  await app.plugin(SystemPrompt, { persona: 'n4 seam' })
  await app.plugin(ToolRuntime, { mode: 'native' })
  worlds.push(app)
  return app
}

/** agent 替身：scope key 与 exec.agent 归因载体是同一对象（仿 agent-loop:376-377）。 */
function makeAgent(app, tenantId, id) {
  const agent = { id, sessionId: id, tenantId }
  const scope = createScope(app, agent)
  const ctx = scope.ctx.extend({ agent })
  return { agent, scope, ctx }
}

/** 与 platform-sdk-server 创建路径同款：validate → apply。 */
async function mount(agentCtx, spec) {
  await applySetupSpec(agentCtx, validateSetupSpec(spec))
}

const stdioCfg = (serverName, marker, pidFile) => ({
  transport: 'stdio',
  serverName,
  command: process.execPath,
  args: [FIXTURE, marker, pidFile],
  toolCallTimeoutMs: 5000,
  failOnStartupError: true, // 挂载 resolve ⇒ 首连+首轮工具同步已完成（挂载语义机器核）
  reconnect: { enabled: false, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 1 },
})

const viewNames = (app, agent) => [...app.get('tools').view(agent).visible.keys()].sort()

let callSeq = 0
async function callTool(app, agent, name, args = {}) {
  const ac = new AbortController()
  const result = await app.get('tools').execute({
    callId: `n4-${++callSeq}`,
    name,
    arguments: args,
    agent,
    signal: ac.signal,
  })
  return result
}

const resultText = (result) => (result.content ?? []).map((b) => b.text ?? '').join('\n')

const readPids = (pidFile) => readFileSync(pidFile, 'utf8').split('\n').filter(Boolean).map(Number)

const pidAlive = (pid) => {
  try { process.kill(pid, 0); return true } catch { return false }
}

async function waitFor(cond, label, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await cond()) return
    if (Date.now() > deadline) throw new Error(`waitFor timeout: ${label}`)
    await new Promise((r) => setTimeout(r, 50))
  }
}

after(async () => {
  for (const app of worlds) {
    try { await app.fiber.dispose() } catch { /* 清理尽力而为 */ }
  }
})

// ---------------------------------------------------------------------------
// A9 fail-closed：mcpServers 非空但 tenantId 缺失/空串 → validateSetupSpec 创建期抛
// ---------------------------------------------------------------------------

test('A9: validateSetupSpec rejects mcpServers without tenantId (fail-closed)', () => {
  const mcp = [{ transport: 'stdio', serverName: 'erp', command: '/bin/cat' }]
  assert.throws(() => validateSetupSpec({ mcpServers: mcp }), /tenantId/)
  assert.throws(() => validateSetupSpec({ tenantId: '', mcpServers: mcp }), /tenantId/)
  assert.throws(() => validateSetupSpec({ tenantId: 42, mcpServers: mcp }), /tenantId/)
  assert.throws(() => validateSetupSpec({ tenantId: 't\0A', mcpServers: mcp }), /tenantId/)
  // 合法形态放行；空 mcpServers / 无 mcp 的 spec 不强制 tenantId；undefined 直通（既有语义）。
  const ok = validateSetupSpec({ tenantId: 'tA', mcpServers: mcp })
  assert.equal(ok.tenantId, 'tA')
  assert.doesNotThrow(() => validateSetupSpec({ mcpServers: [] }))
  assert.doesNotThrow(() => validateSetupSpec({ persona: 'x' }))
  assert.equal(validateSetupSpec(undefined), undefined)
})

// ---------------------------------------------------------------------------
// 簇 1（W1）：A1/A2 双租户同名各起 · A3 互不可见 · A4 路由不串 · A5 审计名逐字节+归因 · A12 异名对位
// ---------------------------------------------------------------------------

const W1 = {}
before(async () => {
  W1.dir = mkdtempSync(join(tmpdir(), 'n4-w1-'))
  W1.pidFile = join(W1.dir, 'pids')
  W1.app = await makeWorld()
  W1.audit = []
  W1.app.on('tools/pre-execute', (exec, next) => {
    W1.audit.push({ name: exec.name, tenantId: exec.agent?.tenantId })
    return next()
  })
  W1.agentA = makeAgent(W1.app, 'tA', 'agent-a1')
  W1.agentB = makeAgent(W1.app, 'tB', 'agent-b1')
  W1.agentC = makeAgent(W1.app, 'tB', 'agent-c1')
})

test('A1: tenant tA mounts serverName=erp via applySetupSpec → resolve, no duplicate namespace', async () => {
  await mount(W1.agentA.ctx, { tenantId: 'tA', mcpServers: [stdioCfg('erp', 'tA', W1.pidFile)] })
  assert.ok(viewNames(W1.app, W1.agentA.agent).includes('mcp__erp__whoami'))
})

test('A2: tenant tB mounts SAME serverName=erp → resolve（原生 T2 原败例转绿）', async () => {
  await mount(W1.agentB.ctx, { tenantId: 'tB', mcpServers: [stdioCfg('erp', 'tB', W1.pidFile)] })
  assert.ok(viewNames(W1.app, W1.agentB.agent).includes('mcp__erp__whoami'))
})

test('A3: 互不可见 —— A 视图含 tA 独有工具且不含 tB 独有工具，B 对称', () => {
  const aView = viewNames(W1.app, W1.agentA.agent)
  const bView = viewNames(W1.app, W1.agentB.agent)
  assert.ok(aView.includes('mcp__erp__only_tA'), 'A sees only_tA')
  assert.ok(!aView.includes('mcp__erp__only_tB'), 'A must not see only_tB')
  assert.ok(bView.includes('mcp__erp__only_tB'), 'B sees only_tB')
  assert.ok(!bView.includes('mcp__erp__only_tA'), 'B must not see only_tA')
})

test('A4: 路由不串 —— 同名 whoami，A 调用回 tA 标记、B 调用回 tB 标记', async () => {
  const ra = await callTool(W1.app, W1.agentA.agent, 'mcp__erp__whoami')
  const rb = await callTool(W1.app, W1.agentB.agent, 'mcp__erp__whoami')
  assert.match(resultText(ra), /whoami:tA/)
  assert.match(resultText(rb), /whoami:tB/)
})

test('A5: 审计名逐字节（E4 基线字面量写死）+ 调用审计帧携带 tenantId 归因', async () => {
  // 公开名与 E4 基线字面量逐字节相等 —— 不经 publicToolName 现算。
  assert.deepEqual(viewNames(W1.app, W1.agentA.agent), ['mcp__erp__only_tA', 'mcp__erp__whoami'])
  assert.deepEqual(viewNames(W1.app, W1.agentB.agent), ['mcp__erp__only_tB', 'mcp__erp__whoami'])
  // 归因链：工具调用审计帧 exec.agent → tenantId（不靠工具名区分 —— 两侧名字逐字节相同）。
  W1.audit.length = 0
  await callTool(W1.app, W1.agentA.agent, 'mcp__erp__whoami')
  await callTool(W1.app, W1.agentB.agent, 'mcp__erp__whoami')
  assert.deepEqual(W1.audit, [
    { name: 'mcp__erp__whoami', tenantId: 'tA' },
    { name: 'mcp__erp__whoami', tenantId: 'tB' },
  ])
})

test('A12: 异名对位 —— tB 再挂 crm 各自成、互不影响（原生 T3 对位）', async () => {
  await mount(W1.agentC.ctx, { tenantId: 'tB', mcpServers: [stdioCfg('crm', 'tB', join(W1.dir, 'pids-crm'))] })
  assert.deepEqual(viewNames(W1.app, W1.agentC.agent), ['mcp__crm__only_tB', 'mcp__crm__whoami'])
  // A 侧视图不受 C 挂载影响。
  assert.deepEqual(viewNames(W1.app, W1.agentA.agent), ['mcp__erp__only_tA', 'mcp__erp__whoami'])
})

// ---------------------------------------------------------------------------
// A6（W2）：同 tenant 两 agent 同 serverName → 子进程计数=1（共享池），两 scope 均见工具
// ---------------------------------------------------------------------------

test('A6: 同 tenant 两 agent 共享一条连接（stdio 子进程计数=1）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'n4-w2-'))
  const pidFile = join(dir, 'pids')
  const app = await makeWorld()
  const a1 = makeAgent(app, 'tA', 'agent-a1')
  const a2 = makeAgent(app, 'tA', 'agent-a2')
  await mount(a1.ctx, { tenantId: 'tA', mcpServers: [stdioCfg('erp', 'tA', pidFile)] })
  await mount(a2.ctx, { tenantId: 'tA', mcpServers: [stdioCfg('erp', 'tA', pidFile)] })
  assert.equal(readPids(pidFile).length, 1, 'shared pool: exactly one stdio child process for one tenant key')
  assert.deepEqual(viewNames(app, a1.agent), ['mcp__erp__only_tA', 'mcp__erp__whoami'])
  assert.deepEqual(viewNames(app, a2.agent), ['mcp__erp__only_tA', 'mcp__erp__whoami'])
})

// ---------------------------------------------------------------------------
// A7（W3）：释放语义 —— dispose A 视图清空、B 仍可调；最后订阅者 dispose → 连接关闭/子进程退出/键释放可重挂
// ---------------------------------------------------------------------------

test('A7: dispose 释放语义（原生 T5/T6 对位）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'n4-w3-'))
  const pidFile = join(dir, 'pids')
  const app = await makeWorld()
  const a1 = makeAgent(app, 'tA', 'agent-a1')
  const a2 = makeAgent(app, 'tA', 'agent-a2')
  const b1 = makeAgent(app, 'tB', 'agent-b1')
  await mount(a1.ctx, { tenantId: 'tA', mcpServers: [stdioCfg('erp', 'tA', pidFile)] })
  await mount(a2.ctx, { tenantId: 'tA', mcpServers: [stdioCfg('erp', 'tA', pidFile)] })
  await mount(b1.ctx, { tenantId: 'tB', mcpServers: [stdioCfg('erp', 'tB', pidFile)] })
  const [pidTA] = readPids(pidFile)

  // dispose A 的一个 agent：A1 视图清空；同池 A2 与异池 B 均不受影响（连接不随部分订阅者走）。
  await a1.scope.dispose()
  assert.deepEqual(viewNames(app, a1.agent), [])
  assert.deepEqual(viewNames(app, a2.agent), ['mcp__erp__only_tA', 'mcp__erp__whoami'])
  const rb = await callTool(app, b1.agent, 'mcp__erp__whoami')
  assert.match(resultText(rb), /whoami:tB/)
  assert.ok(pidAlive(pidTA), 'tA connection survives while a subscriber remains')
  assert.equal(readPids(pidFile).length, 2, 'no new child process on partial release')

  // 最后订阅者 dispose → 连接关闭 / 子进程退出 / 键释放；同 tenant 新 agent 同名可重挂。
  await a2.scope.dispose()
  await waitFor(() => !pidAlive(pidTA), 'tA child process exits after last subscriber disposes')
  const a3 = makeAgent(app, 'tA', 'agent-a3')
  await mount(a3.ctx, { tenantId: 'tA', mcpServers: [stdioCfg('erp', 'tA', pidFile)] })
  assert.deepEqual(viewNames(app, a3.agent), ['mcp__erp__only_tA', 'mcp__erp__whoami'])
  assert.equal(readPids(pidFile).length, 3, 'remount spawns a fresh child (key was released)')
})

// ---------------------------------------------------------------------------
// A8（W4）：tools/list_changed 扇出 —— 同池所有订阅者 scope 完成重注册，异池不受影响
// ---------------------------------------------------------------------------

test('A8: list_changed 通知扇出到同池全部订阅者（代际不混）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'n4-w4-'))
  const pidFile = join(dir, 'pids')
  const app = await makeWorld()
  const a1 = makeAgent(app, 'tA', 'agent-a1')
  const a2 = makeAgent(app, 'tA', 'agent-a2')
  const b1 = makeAgent(app, 'tB', 'agent-b1')
  await mount(a1.ctx, { tenantId: 'tA', mcpServers: [stdioCfg('erp', 'tA', pidFile)] })
  await mount(a2.ctx, { tenantId: 'tA', mcpServers: [stdioCfg('erp', 'tA', pidFile)] })
  await mount(b1.ctx, { tenantId: 'tB', mcpServers: [stdioCfg('erp', 'tB', pidFile)] })
  const [pidTA] = readPids(pidFile)

  process.kill(pidTA, 'SIGUSR1') // mock server 广播 notifications/tools/list_changed
  await waitFor(
    () => viewNames(app, a1.agent).includes('mcp__erp__late_tA') && viewNames(app, a2.agent).includes('mcp__erp__late_tA'),
    'both tA subscribers re-register after list_changed',
  )
  assert.deepEqual(viewNames(app, a1.agent), ['mcp__erp__late_tA', 'mcp__erp__only_tA', 'mcp__erp__whoami'])
  assert.deepEqual(viewNames(app, a2.agent), ['mcp__erp__late_tA', 'mcp__erp__only_tA', 'mcp__erp__whoami'])
  // 异池 B 未收到 tA 的 list_changed，视图不变。
  assert.deepEqual(viewNames(app, b1.agent), ['mcp__erp__only_tB', 'mcp__erp__whoami'])
  // 重同步后路由仍正确（代际 swap 没把执行体指错连接）。
  const ra = await callTool(app, a1.agent, 'mcp__erp__whoami')
  const rl = await callTool(app, a2.agent, 'mcp__erp__late_tA')
  assert.match(resultText(ra), /whoami:tA/)
  assert.match(resultText(rl), /late_tA:tA/)
})

// ---------------------------------------------------------------------------
// A10：原生基线回归 —— vendored 插件无 tenantId 时逐条复刻六用例（与上游逐字节等价）
// （红 commit 期：vendored 模块尚不存在，dynamic import 即红 = 变更缺席的机器证。）
// ---------------------------------------------------------------------------

test('A10: 无 tenantId 路径复刻原生六用例（同 root 同名撞 / 异名成 / 独立 root 同名成 / 重试仍拒 / dispose 释放可重挂）', async () => {
  const Vendored = await import('../plugins/mcp-client-tenant.mjs')
  const catCfg = (serverName) => ({
    transport: 'stdio',
    serverName,
    command: '/bin/cat', // 真二进制非 MCP server：连接失败，failOnStartupError=false 容忍（原生夹具同款）
    failOnStartupError: false,
    reconnect: { enabled: false, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 1 },
  })
  const app = await makeWorld()
  // T1 同 root 首挂成
  const s1 = createScope(app, { case: 'T1' })
  await s1.ctx.plugin(Vendored, catCfg('erp'))
  // T2 同 root 同名 plugin load 期 reject（duplicate namespace）
  await assert.rejects(app.plugin(Vendored, catCfg('erp')), /serverName "erp" is already in use/)
  // T3 异名成
  const s3 = createScope(app, { case: 'T3' })
  await s3.ctx.plugin(Vendored, catCfg('crm'))
  // T4 独立 root 同名成（预约 per-root 而非全局）
  const app2 = await makeWorld()
  await app2.plugin(Vendored, catCfg('erp'))
  // T5 重试仍拒不污染持有方
  await assert.rejects(app.plugin(Vendored, catCfg('erp')), /serverName "erp" is already in use/)
  // T6 dispose 释放可重挂
  await s1.dispose()
  await app.plugin(Vendored, catCfg('erp'))
})
