// WO-DSH-POC-S1 · harness 包自证冒烟：用低层 HarnessClient 驱动我方 platform-sdk-server，
// 第一发 prompt 携带 setup spec（persona + 空 tools/mcp/skills），断言：
//   ① server 变体收下 setup 不报错（wire 扩展生效）；
//   ② 事件流与 stock 一致（24 帧词表同 S0）；turn/end reason=completed；
//   ③ 对已活会话再带 setup → 显式报错（创建期语义）。
// mock LLM 剧本：一轮 echo_tool 调用 + 一轮文本收尾。
import { HarnessClient } from '@deepseek-ai/dsh-sdk-client'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const events = []

const client = new HarnessClient({
  command: process.execPath,
  args: [join(here, 'node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/bin.js'), 'cordis.yml'],
  cwd: here,
  requestTimeoutMs: 30000,
})

const sub = client.subscribeSessionTree('s1-smoke')
const collector = (async () => {
  for await (const n of sub) {
    if (n.method === 'session.event') events.push(n.params?.event?.type ?? '?')
  }
})()

client.start()
const init = await client.initialize({ cwd: here, provider: 'mock', model: 'mock' })
console.log('SMOKE_INIT=' + JSON.stringify(init))

const setup = {
  persona: 'smoke persona via setup spec',
  tools: [],
  mcpServers: [],
  skills: [],
  governance: { ruleBindings: { ruleKeys: [], mode: 'PRE_CHECK' } },
}
const messageId = await client.request('session/prompt', {
  sessionId: 's1-smoke',
  contentBlocks: [{ type: 'text', text: 'call echo_tool then answer' }],
  setup,
})
console.log('SMOKE_PROMPT_OK messageId=' + JSON.stringify(messageId))

// 等 turn/end（reason=completed）；30s 兜底。
const deadline = Date.now() + 30000
while (!events.includes('turn/end') && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 100))
}
console.log('SMOKE_EVENTS=' + JSON.stringify(events))

// ③ 负向：活会话再带 setup 必须报错。
let replayError = ''
try {
  await client.request('session/prompt', {
    sessionId: 's1-smoke',
    contentBlocks: [{ type: 'text', text: 'again' }],
    setup,
  })
} catch (e) {
  replayError = String(e?.message ?? e)
}
console.log('SMOKE_SETUP_REPLAY_ERROR=' + JSON.stringify(replayError))

await sub.return?.()
await client.close()
await collector.catch(() => {})

if (!events.includes('turn/end')) { console.log('SMOKE_FAIL: no turn/end'); process.exit(1) }
if (!events.includes('tool/result')) { console.log('SMOKE_FAIL: no tool/result'); process.exit(1) }
if (!replayError.includes('creation-only')) { console.log('SMOKE_FAIL: setup replay not rejected'); process.exit(1) }
console.log('SMOKE_OK')
process.exit(0)
