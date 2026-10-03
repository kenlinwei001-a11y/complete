// WO-DSH-POC-S0/S2 · 路 B 的 echo 工具插件。
// S2 起带 execute 计数：每次 execute 向 ECHO_COUNT_FILE 追加一行 —— kill 条件
// 「deny 规则 ⇒ 工具 execute 零调用」的取证锚（跨进程：harness 子进程写，smoke 读）。
import { appendFileSync } from 'node:fs'

export const name = 'echo-tool'
export const inject = ['tools']

export function apply(ctx) {
  ctx.tools.register({
    name: 'echo_tool',
    description: 'echo back the input text',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    output: {
      schema: { type: 'object', properties: { echoed: { type: 'string' } } },
      render: (args, value) => [{ type: 'text', text: `echoed: ${value.echoed}` }],
    },
    execute: async (args) => {
      if (process.env.ECHO_COUNT_FILE) appendFileSync(process.env.ECHO_COUNT_FILE, '1\n')
      return { echoed: args.text }
    },
  })
}
