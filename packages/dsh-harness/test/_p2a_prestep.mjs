import './../runtime-compat.mjs'
import { makeSkillWorld, makeSkillAgent, mountSetupSpec } from './skill-seam-driver.mjs'
const app = await makeSkillWorld()
const w = makeSkillAgent(app, 't1', 'prestep')
await mountSetupSpec(w.ctx, {
  skills: [
    { key: 'capacity_check', dshName: 'capacity-check', description: '产能校验：当用户问某型号能否按时交付时使用', content: 'BODY-A', resources: [], governance: { writeMode: false, provenancePolicy: 'best_effort' } },
    { key: 'order_tracking', dshName: 'order-tracking', description: '订单跟踪：当用户问订单当前状态时使用', content: 'BODY-B', resources: [], governance: { writeMode: false, provenancePolicy: 'best_effort' } },
  ],
  tools: [{ name: 'skill' }],
})
const ac = new AbortController()
// 真 dsh-agent-loop 的 payload 形状：{messages, ...position, signal}，agent 在 position 里
const decision = await app.waterfall(app, 'agent/pre-step',
  { agent: w.agent, messages: [], turn: 1, step: 1, signal: ac.signal },
  async () => ({ kind: 'enter', messages: [] }))
console.log('kind=' + decision.kind + ' addedMessages=' + (decision.messages?.length ?? 0))
console.log('===PRESTEP_TEXT_BEGIN===')
for (const m of decision.messages ?? []) for (const c of m.content ?? []) if (c.type === 'text') console.log(c.text)
console.log('===PRESTEP_TEXT_END===')
