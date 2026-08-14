// WO-DSH-POC-S0 · 路 B 的 echo 工具插件。
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
    execute: async (args) => ({ echoed: args.text }),
  })
}
