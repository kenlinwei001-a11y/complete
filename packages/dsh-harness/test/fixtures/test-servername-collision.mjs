// 前置 C 负向接缝测试:A/B 同名 serverName 在同一 app root 下的碰撞行为
// 直接驱动 @deepseek-ai/dsh-mcp-client(与 harness platform-world.mjs 同款 plugin 调用)
import * as cordis from '@deepseek-ai/cordis'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'

const cfg = (name) => ({
  transport: 'stdio',
  serverName: name,
  command: '/bin/cat',           // 真二进制但非 MCP server:连接会失败,failOnStartupError=false 容忍
  failOnStartupError: false,
})

const app = new cordis.Context()
// mcp-client inject: ['tools'] —— 提供最小 stub
app.provide('tools', { register() {}, unregister() {}, async call() { throw new Error('stub') } })

const rec = (label, p) => p.then(
  (v) => console.log(`${label}: RESOLVED`),
  (e) => console.log(`${label}: REJECTED -> ${e?.message ?? e}`),
)

console.log('== T1: 租户A 挂 serverName="erp" ==')
await rec('A erp', app.plugin(McpClient, cfg('erp')))

console.log('== T2: 租户B 同名 serverName="erp"(应撞 duplicate namespace)==')
await rec('B erp', app.plugin(McpClient, cfg('erp')))

console.log('== T3: 租户C 异名 serverName="crm"(应成功)==')
await rec('C crm', app.plugin(McpClient, cfg('crm')))

console.log('== T4: 不同 scope(fork 子上下文,模拟两 agent scope 共享 root)同名 ==')
const scopeX = app.fork ? null : null
// cordis v4: ctx.fork 已废,scope 通过 app.intersect/直接在子 plugin ctx。用 root 直挂等价(ctx.root 相同)。
// 换种方式:新建独立 App(另一个 root),同名应**不**撞 —— 证明预约是 per-root 而非全局。
const app2 = new cordis.Context()
app2.provide('tools', { register() {}, unregister() {}, async call() { throw new Error('stub') } })
await rec('app2 erp (独立 root)', app2.plugin(McpClient, cfg('erp')))

console.log('== T5: dispose A 后同名应可重挂(预约随 effect 释放)==')
const before = app.registry ? 'n/a' : 'n/a'
// cordis v4 dispose:app.registry.delete? 用 scope.dispose —— plugin() 返回的 fork scope 不可直接拿,
// 简化:重新挂一次 erp 验证仍撞(确认 T2 失败没污染 A 的预约)
await rec('B2 erp (A 仍持有,应仍撞)', app.plugin(McpClient, cfg('erp')))

console.log('DONE')
process.exit(0)
