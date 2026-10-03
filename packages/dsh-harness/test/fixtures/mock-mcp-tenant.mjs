// WO-DSH-N4 · A/B 租户隔离接缝的 mock stdio MCP server 夹具（协议仿 /tmp/dsh-web-run/mock-mcp-onto.mjs，
// NDJSON JSON-RPC 2.0，每行一条）。
//
// argv: [script, marker, pidFile?]
//   marker  —— 租户标记：工具集 = whoami + only_<marker>；whoami 应答文本携带 marker（A4 路由分叉锚）。
//   pidFile —— 启动时把本进程 pid 追加一行（A6 共享池子进程计数锚；每连接一行）。
//
// SIGUSR1 —— 模拟 tools/list_changed：工具集追加 late_<marker> 并广播 notifications/tools/list_changed
//           （A8 扇出重注册锚；测试侧从 pidFile 读 pid 后发信号，跨进程确定性触发）。
const marker = process.argv[2]
const pidFile = process.argv[3]

if (pidFile) {
  const { appendFileSync } = await import('node:fs')
  appendFileSync(pidFile, `${process.pid}\n`)
}

let lateAdded = false
const toolList = () => {
  const tools = [
    {
      name: 'whoami',
      description: 'return the tenant marker this connection serves',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: `only_${marker}`,
      description: `tool unique to tenant ${marker}`,
      inputSchema: { type: 'object', properties: {} },
    },
  ]
  if (lateAdded) {
    tools.push({
      name: `late_${marker}`,
      description: `tool added to ${marker} after list_changed`,
      inputSchema: { type: 'object', properties: {} },
    })
  }
  return tools
}

const notifyListChanged = () =>
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }) + '\n')

process.on('SIGUSR1', () => {
  lateAdded = true
  notifyListChanged()
})

const respond = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
const respondErr = (id, code, message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n')

let buf = ''
process.stdin.on('data', (chunk) => {
  buf += chunk
  let idx
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim()
    buf = buf.slice(idx + 1)
    if (!line) continue
    let msg
    try { msg = JSON.parse(line) } catch { continue }
    if (msg.id === undefined) continue // notification
    switch (msg.method) {
      case 'initialize':
        respond(msg.id, {
          protocolVersion: msg.params?.protocolVersion ?? '2024-11-05',
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: `mock-mcp-${marker}`, version: '0.1.0' },
        })
        break
      case 'ping':
        respond(msg.id, {})
        break
      case 'tools/list':
        respond(msg.id, { tools: toolList() })
        break
      case 'tools/call': {
        const { name } = msg.params ?? {}
        if (name === 'whoami') {
          respond(msg.id, { content: [{ type: 'text', text: `whoami:${marker}` }] })
        } else if (name === `only_${marker}` || (lateAdded && name === `late_${marker}`)) {
          respond(msg.id, { content: [{ type: 'text', text: `${name}:${marker}` }] })
        } else {
          respondErr(msg.id, -32602, `unknown tool: ${name}`)
        }
        break
      }
      default:
        respondErr(msg.id, -32601, `method not found: ${msg.method}`)
    }
  }
})
process.stdin.on('end', () => process.exit(0))
