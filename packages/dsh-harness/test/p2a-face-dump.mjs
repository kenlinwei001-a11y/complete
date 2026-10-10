// WO-DSH-P2A-SKILL-SEAM · **模型面字节转储器**（支承件，非测试：不以 .test 结尾，
// test/run.mjs 的 `test/**/*.test.mjs` 发现式不会捡它）。
//
// 用途：把「新路（dsh 原生缝）」模型面实际拿到的字节原样打出来，供报告里逐字节对比
// 与第三方复验。跑法：`node test/p2a-face-dump.mjs`
//
// 覆盖三层模型面：
//   ① `skill` 工具的 tool_result（命中 + 合式缺失 + 不合式名）
//   ② `agent/pre-step` 注入的 <system-reminder> 目录消息（N=2 / N=1 / N=0）
//   ③ 目录数据源（dsh-tool-skill 的 pre-step 监听逐拍读的那份 snapshot）
//
// pre-step 的载荷形状照抄真 dsh-agent-loop（lib/index.js:501 的
// `{messages: claimed, ...position, signal}`；agent 在 position 里），
// 不是自造 —— 少了 messages/agent 任一，挂在同事件上的既有监听会当场抛。

import '../runtime-compat.mjs'
import { makeSkillWorld, makeSkillAgent, mountSetupSpec, callSkillTool, catalogOf, prestepTexts } from './skill-seam-driver.mjs'

const skill = (key, description, content) => ({
  key,
  dshName: key.replace(/_/g, '-'),
  description,
  content,
  resources: [],
  governance: { writeMode: false, provenancePolicy: 'best_effort' },
})

const app = await makeSkillWorld()
const SRC = [
  skill('capacity_check', '产能校验：当用户问某型号能否按时交付时使用', '第一行\n第二行 <b>不转义</b>\n'),
  skill('order_tracking', '订单跟踪：当用户问订单当前状态时使用', 'BODY-B'),
]

async function world(id, skills) {
  const w = makeSkillAgent(app, 't1', id)
  await mountSetupSpec(w.ctx, { skills, tools: [{ name: 'skill' }] })
  return w
}
// pre-step 驱动已收进 skill-seam-driver.prestepTexts（单一实现 —— 两份抄件迟早不同步）
const prestep = (w) => prestepTexts(app, w.agent)

const w2 = await world('n2', SRC)
console.log('=== ①-a skill 工具命中（tool_result 原文）===')
console.log((await callSkillTool(app, w2.agent, 'capacity-check')).text)
console.log('=== ①-b 合式名但不在目录 ===')
const miss = await callSkillTool(app, w2.agent, 'nope-nope')
console.log(`isError=${miss.isError} text=${JSON.stringify(miss.text)}`)
console.log('=== ①-c 不合式名（下划线形态）===')
const bad = await callSkillTool(app, w2.agent, 'capacity_check')
console.log(`isError=${bad.isError} text=${JSON.stringify(bad.text)}`)
console.log('=== ②-a pre-step 注入（N=2）===')
console.log((await prestep(w2))[0])
console.log('=== ②-b pre-step 注入（N=1）===')
console.log((await prestep(await world('n1', [SRC[1]])))[0])
console.log('=== ②-c pre-step 注入（N=0）===')
const t0 = await prestep(await world('n0', []))
console.log(`注入消息数=${t0.length}（空目录不注入 —— 逐字节旧行为：DshSession 无技能时模型面零技能字节）`)
console.log('=== ③ 目录数据源（snapshot）===')
console.log(JSON.stringify(await catalogOf(app, w2.agent)))
