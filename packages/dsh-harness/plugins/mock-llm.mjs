// WO-DSH-POC-S0 · 路 B 的本地 mock LLM 适配器插件（相对插件，随 cordis.yml 解析）。
// 剧本默认：第一轮调 echo_tool，第二轮纯文本收尾 —— 与路 A 同一剧本。
// S3 起支持 env MOCK_SCENARIO=final_answer：第一轮调 final_answer（blocks+provenance），
// 第二轮文本收尾 —— 取证 scoped final_answer 注册过 wire。
// N3 起支持 MOCK_SCENARIO=stall_loop / stall_loop_varying（watchdog 集成臂有界剧本）：
//   stall_loop         = 8 轮**同参** echo_tool + 文本收尾（病态同签名循环，对位 native ③ 的 24 轮同参 query_objects）
//   stall_loop_varying = 8 轮**每轮异参** echo_tool + 文本收尾（不误伤对照组：签名含入参，异参不累加）
// call id 用 requests.length 唯一化（帧流 callId 不复用）；剧本有界 ⇒ 负例/变异臂不等 120s 默认超时。
export const name = 'mock-llm'
export const inject = ['llm']

const STALL_ROUNDS = 8

function stallCallChunks(callId, args) {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name: 'echo_tool', argumentsDelta: args },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name: 'echo_tool', arguments: args } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

const stallTextChunks = [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: 'stall scenario done' },
  { type: 'block-end', index: 0, block: { type: 'text', text: 'stall scenario done' } },
  { type: 'usage', usage: { inputTokens: 20, outputTokens: 6 } },
  { type: 'finish', reason: { kind: 'stop' } },
]

function stallScenarioChunks(scenario, round) {
  if (round <= STALL_ROUNDS) {
    const args = scenario === 'stall_loop' ? '{"text":"same"}' : `{"text":"vary-${round}"}`
    return stallCallChunks(`call_${round}`, args)
  }
  if (round === STALL_ROUNDS + 1) return stallTextChunks
  return null // 剧本耗尽
}


const finalAnswerArgs = JSON.stringify({
  blocks: [{ type: 'text', markdown: 'structured answer via dsh final_answer' }],
  provenance: [],
})

const scriptFinalAnswer = [
  [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: 'call_1', name: 'final_answer', argumentsDelta: finalAnswerArgs },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call_1', name: 'final_answer', arguments: finalAnswerArgs } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ],
  [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'done' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } },
    { type: 'usage', usage: { inputTokens: 20, outputTokens: 6 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ],
]

const scriptEcho = [
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
  const scenario = process.env.MOCK_SCENARIO
  const script = scenario === 'final_answer' ? scriptFinalAnswer : scriptEcho
  ctx.llm.registerAdapter(['mock'], {
    providerInfo: (provider) => ({ id: provider, name: provider }),
    providerRetryPolicy: () => undefined,
    listModels: async () => [],
    resolveModel: (provider, model) => ({ provider, id: model, name: model }),
    async *stream(options) {
      requests.push(options)
      if (scenario === 'stall_loop' || scenario === 'stall_loop_varying') {
        const chunks = stallScenarioChunks(scenario, requests.length)
        if (!chunks) throw new Error('mock script exhausted')
        for (const c of chunks) yield c
        return
      }
      const chunks = script.length ? script.shift() : null
      if (!chunks) throw new Error('mock script exhausted')
      for (const c of chunks) yield c
    },
  })
  ctx.effect(() => () => {}, 'mock-llm.noop')
}
