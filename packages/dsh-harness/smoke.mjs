// WO-DSH-POC-S2 · harness 自证冒烟（含 S1 回归）。每例 spawn 独立子进程（裁决器配置走 env，进程级）。
//
// S1 断言（case B 顺带）：setup spec 被接收；事件流 24 帧含 tool/result+turn/end；活会话重放 setup 被拒。
// S2 kill 条件断言：
//   case A（governance deny echo_tool）   → execute 计数 == 0，turn 仍 completed
//   case B（无治理拒绝，基线）            → execute 计数 == 1
//   case C（setup.tools 允许表不含 echo_tool）→ execute 计数 == 0（允许表强执）
import { HarnessClient } from '@deepseek-ai/dsh-sdk-client'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))

async function runCase(label, { extraEnv = {}, setup } = {}) {
  const countFile = join(mkdtempSync(join(tmpdir(), 'dsh-s2-')), 'count')
  writeFileSync(countFile, '')
  const events = []
  const toolResults = []
  const client = new HarnessClient({
    command: process.execPath,
    args: [join(here, 'node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/bin.js'), 'cordis.poc.yml'], // WO-DSH-N1-PROVIDER：测试专档（生产档 cordis.yml 只挂 platform-llm）
    cwd: here,
    requestTimeoutMs: 30000,
    env: { ...process.env, ECHO_COUNT_FILE: countFile, ...extraEnv },
  })
  const sessionId = `s2-${label}`
  const sub = client.subscribeSessionTree(sessionId)
  const collector = (async () => {
    for await (const n of sub) {
      if (n.method !== 'session.event') continue
      const t = n.params?.event?.type ?? '?'
      events.push(t)
      if (t === 'tool/result') toolResults.push(JSON.stringify(n.params.event).slice(0, 300))
    }
  })().catch(() => {}) // close() 会拒 pending waiter；立即挂 catch 防 unhandled rejection
  let replayError = ''
  try {
    client.start()
    await client.initialize({ cwd: here, provider: 'mock', model: 'mock' })
    await client.request('session/prompt', {
      sessionId,
      contentBlocks: [{ type: 'text', text: 'call echo_tool then answer' }],
      ...(setup ? { setup } : {}),
    })
    const deadline = Date.now() + 30000
    while (!events.includes('turn/end') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100))
    }
    if (label === 'B') {
      try {
        await client.request('session/prompt', { sessionId, contentBlocks: [{ type: 'text', text: 'again' }], setup: setup ?? {} })
      } catch (e) { replayError = String(e?.message ?? e) }
    }
  } finally {
    sub.close()
    await client.close()
    await collector
  }
  const count = readFileSync(countFile, 'utf8').split('\n').filter(Boolean).length
  const turnEnd = events.includes('turn/end')
  const toolResultSeen = toolResults.some((r) => r.includes('final answer recorded'))
  console.log(`CASE_${label}_EVENTS=${JSON.stringify(events)}`)
  if (toolResults.length > 0) console.log(`CASE_${label}_TOOLRESULT=${toolResults[0]}`)
  if (replayError) console.log(`CASE_${label}_REPLAY_ERROR=${JSON.stringify(replayError)}`)
  console.log(`CASE_${label}_EXECUTE_COUNT=${count} TURN_END=${turnEnd}`)
  return { count, turnEnd, replayError, toolResultSeen }
}

const BASE_SETUP = {
  persona: 'smoke persona via setup spec',
  mcpServers: [],
  skills: [],
  governance: { ruleBindings: { ruleKeys: ['r_deny_echo'], mode: 'PRE_CHECK' }, scopeObjectTypes: [] },
}

const a = await runCase('A', { extraEnv: { PLATFORM_GOV_DENY: 'echo_tool' }, setup: BASE_SETUP })
const b = await runCase('B', { setup: BASE_SETUP })
const c = await runCase('C', { setup: { ...BASE_SETUP, governance: undefined, tools: [{ name: 'not_echo' }] } })
// S3 · case D：scoped final_answer 过 wire（mock 剧本调它收尾；允许表含 final_answer 不被治理闸误伤）
const d = await runCase('D', {
  extraEnv: { MOCK_SCENARIO: 'final_answer' },
  setup: {
    ...BASE_SETUP,
    governance: undefined,
    tools: [{ name: 'final_answer' }],
    finalAnswer: {
      description: '终止工具（S3 smoke）',
      schema: { type: 'object', properties: { blocks: { type: 'array' }, provenance: { type: 'array' } }, required: ['blocks', 'provenance'] },
    },
  },
})

let fail = 0
if (!(a.count === 0 && a.turnEnd)) { console.log('SMOKE_FAIL: case A (governance deny ⇒ execute 0)'); fail = 1 }
if (!(b.count === 1 && b.turnEnd)) { console.log('SMOKE_FAIL: case B (baseline ⇒ execute 1)'); fail = 1 }
if (!b.replayError.includes('creation-only')) { console.log('SMOKE_FAIL: case B setup replay not rejected'); fail = 1 }
if (!(c.count === 0 && c.turnEnd)) { console.log('SMOKE_FAIL: case C (allow-list exclude ⇒ execute 0)'); fail = 1 }
if (!(d.turnEnd && d.toolResultSeen)) { console.log('SMOKE_FAIL: case D (final_answer recorded over wire)'); fail = 1 }
if (fail) process.exit(1)
console.log('SMOKE_OK')
process.exit(0)
