// WO-DSH-POC-S2 · harness 自证冒烟（含 S1 回归）。每例 spawn 独立子进程（裁决器配置走 env，进程级）。
//
// S1 断言（case B 顺带）：setup spec 被接收；事件流 24 帧含 tool/result+turn/end；活会话重放 setup 被拒。
// S2 kill 条件断言：
//   case A（governance deny echo_tool）   → execute 计数 == 0，turn 仍 completed
//   case B（无治理拒绝，基线）            → execute 计数 == 1
//   case C（setup.tools 允许表不含 echo_tool）→ execute 计数 == 0（允许表强执）
// ⚠ 必须排在**所有**其他 import 之前（病因详见 ./runtime-compat.mjs 头注）。
import { RUNTIME_COMPAT_URL } from './runtime-compat.mjs'
import { HarnessClient } from '@deepseek-ai/dsh-sdk-client'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))

// 子进程要 boot 的 cordis 档。**只此一处出处** —— 下面的自检与 spawn 实参共用它，
// 不许各写各的（写两份迟早漂：自检验的是 A 档、跑的是 B 档，照样全绿）。
const CORDIS_FILE = 'cordis.poc.yml'

// ── WO-HARNESS-SMOKE-RED · spawn 前先自检本包依赖链农场 ──────────────────────
// 病因（2026-09-17 实测，不是预防性代码）：`packages/dsh-harness/node_modules/` 缺条目时，
// cordis 的 `./plugins/*.mjs` 条目 import 不到，而 cordis-plugin-loader 的 EntryGroup.update
// 是 `Promise.allSettled(config.map(create))`：
//   · 失败 **1 条** ⇒ 原因原样抛出，屏首就写着「Cannot find package 'X' imported from <哪个插件>」，可诊断；
//   · 失败 **≥2 条** ⇒ `new AggregateError(failures, 'loader entries failed to apply')`，
//     而上游 dsh-app-boot 的 boot() 只沿 `.cause` 链走、**不碰 `.errors`** ⇒ 屏首只剩
//     `loader entries failed to apply` 一句空话，逐条真原因掉到子进程 stderr 第 30 行以后。
// 父进程这边只看到 `TransportClosedError: JSON-RPC input closed`（子进程死了、管道关了），
// 与本冒烟真正要验的治理/允许表毫无关系 —— 一次真实排查为此走了两条错误假设。
// ⇒ 与其让它走进那条 90 行的级联，不如 spawn 之前一行点名。
function preflightHarnessDeps() {
  const cordisText = readFileSync(join(here, CORDIS_FILE), 'utf8')
  const entryNames = [...cordisText.matchAll(/^\s*name:\s*['"]([^'"]+)['"]/gm)].map((m) => m[1])
  const probes = new Map() // 包名 -> 首个出处（报错时点名"谁要它"）
  const seenFiles = new Set()
  const queue = []
  // 说明符 ≠ 包名：`@scope/pkg/sub/path.js` 的链农场条目是 `@scope/pkg`。
  // 不收敛这一步，子路径 import 会被误报成"缺包"（首版实测 4 条假阳，全是
  // `@modelcontextprotocol/sdk/client/index.js` 这种）—— 假阳比没自检更坏。
  const pkgNameOf = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0])
  for (const name of entryNames) {
    if (name.startsWith('.')) queue.push(name)
    else if (!probes.has(pkgNameOf(name))) probes.set(pkgNameOf(name), CORDIS_FILE)
  }
  // 沿 plugins/ 内部的相对 import 走全闭包：真正让条目挂掉的常常是插件的插件
  // （如 platform-sdk-server → platform-world → mcp-client-tenant 的那几个包）。
  while (queue.length > 0) {
    const rel = queue.shift()
    const abs = join(here, rel)
    if (seenFiles.has(abs) || !existsSync(abs)) continue
    seenFiles.add(abs)
    const src = readFileSync(abs, 'utf8')
    // 本包插件的 import 一律单行 `import … from '…'`（已逐文件核过，无多行形态）。
    // 行首锚定 ⇒ 注释与字符串里的 "from '…'" 进不来，无需剥注释（剥注释会把 http:// 截断，反造假阳）。
    for (const m of src.matchAll(/^\s*(?:import|export)\b[^\n]*?\bfrom\s*['"]([^'"]+)['"]/gm)) {
      const spec = m[1]
      if (spec.startsWith('node:')) continue
      if (spec.startsWith('.')) { queue.push(join(dirname(rel), spec)); continue }
      if (!probes.has(pkgNameOf(spec))) probes.set(pkgNameOf(spec), rel)
    }
  }
  // 金丝雀：探针数为 0 = **解析坏了**，不是"依赖齐全"。
  // 两者若在屏上长得一样，这段自检就是装饰品——正是本仓反复栽的那个跟头。
  if (probes.size === 0) {
    console.log(`HARNESS_PREFLIGHT_BROKEN: 从 ${CORDIS_FILE} + plugins 闭包解析出 0 个裸说明符`)
    console.log('  → 这是解析坏了（cordis 档格式变了？import 写法变了？），不许读作"依赖齐全"。')
    process.exit(1)
  }
  const missing = [...probes].filter(([spec]) => !existsSync(join(here, 'node_modules', spec, 'package.json')))
  if (missing.length > 0) {
    console.log(`HARNESS_DEPS_MISSING=${missing.length}/${probes.size}: ${missing.map(([s, by]) => `${s}（${by} 要）`).join(', ')}`)
    console.log('  → packages/dsh-harness/node_modules 链农场不完整。先跑 `pnpm install --prefer-offline` 再重试。')
    console.log('  → 不修直接跑：子进程 boot 挂，父进程只报 TransportClosedError: JSON-RPC input closed —— 那句话与治理/允许表无关，别照着它去查插件。')
    process.exit(1)
  }
  console.log(`HARNESS_PREFLIGHT_OK deps=${probes.size} files=${seenFiles.size} cordis=${CORDIS_FILE}`)
}
preflightHarnessDeps()

// 本进程装好补齐**不等于**子进程装好：下面每个 case 都 spawn 一只独立 dsh host（jsonrpc-demo bin），
// 而 agent-loop 的 `Promise.withResolvers` 是在**那只子进程**里调的 —— 不带过去，Node 20 上
// 子进程注册不出 agent 工厂，父进程只看到一句 `no agent factory registered (load an agent-loop plugin)`，
// 与治理/允许表这些本冒烟真正要验的东西毫无关系。追加而非覆盖：保住外部传进来的 NODE_OPTIONS。
const CHILD_NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --import ${RUNTIME_COMPAT_URL}`.trim()

async function runCase(label, { extraEnv = {}, setup } = {}) {
  const countFile = join(mkdtempSync(join(tmpdir(), 'dsh-s2-')), 'count')
  writeFileSync(countFile, '')
  const events = []
  const toolResults = []
  const client = new HarnessClient({
    command: process.execPath,
    args: [join(here, 'node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/bin.js'), CORDIS_FILE], // WO-DSH-N1-PROVIDER：测试专档（生产档 cordis.yml 只挂 platform-llm）；档名出处见上方 CORDIS_FILE
    cwd: here,
    requestTimeoutMs: 30000,
    env: { ...process.env, NODE_OPTIONS: CHILD_NODE_OPTIONS, ECHO_COUNT_FILE: countFile, ...extraEnv },
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
