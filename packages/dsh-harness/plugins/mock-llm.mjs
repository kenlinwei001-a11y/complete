// WO-DSH-POC-S0 · 路 B 的本地 mock LLM 适配器插件（相对插件，随 cordis-b.yml 解析）。
// 剧本：第一轮要求调 echo_tool，第二轮纯文本收尾 —— 与路 A 同一剧本。
export const name = 'mock-llm'
export const inject = ['llm']

const script = [
  [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: 'call_1', name: 'echo_tool', argumentsDelta: '{"text":"hello' },
    { type: 'tool-call-delta', index: 0, id: 'call_1', name: 'echo_tool', argumentsDelta: ' from dsh-B"}' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call_1', name: 'echo_tool', arguments: '{"text":"hello from dsh-B"}' } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ],
  [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'final answer from dsh jsonrpc loop' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'final answer from dsh jsonrpc loop' } },
    { type: 'usage', usage: { inputTokens: 20, outputTokens: 6 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ],
]

export function apply(ctx) {
  const requests = []
  ctx.llm.registerAdapter(['mock'], {
    providerInfo: (provider) => ({ id: provider, name: provider }),
    providerRetryPolicy: () => undefined,
    listModels: async () => [],
    resolveModel: (provider, model) => ({ provider, id: model, name: model }),
    async *stream(options) {
      requests.push(options)
      const chunks = script.length ? script.shift() : null
      if (!chunks) throw new Error('mock script exhausted')
      for (const c of chunks) yield c
    },
  })
  ctx.effect(() => () => {}, 'mock-llm.noop')
}
