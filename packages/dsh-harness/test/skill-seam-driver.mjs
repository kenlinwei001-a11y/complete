// WO-DSH-P2A-SKILL-SEAM · 技能缝驱动（**测试支承件，非测试**：文件名不以 .test 结尾，
// test/run.mjs 的 `test/**/*.test.mjs` 发现式不会捡它）。
//
// 为什么要有这个文件：技能缝的两半住在两个语言边界的两侧 ——
//   · agentcore 侧是 TypeScript（buildSessionSetup 造 spec，vitest 才跑得起来）；
//   · harness 侧是 ESM + @deepseek-ai/* 闭包（只有 packages/dsh-harness 的 node_modules 解析得到）。
// agentcore 的 vitest 里 `import '@deepseek-ai/dsh-skill'` 会 ENOENT（agentcore 的
// node_modules/@deepseek-ai 只有 sdk-client / sdk-protocol 两件）。所以世界搭建放这里、
// spec 由调用方从真 agentcore 函数取了传进来 —— 接缝测的是**两边接起来**，不是各半自证。
//
// 与生产路径同款：真 cordis root + 真 dsh-skill/dsh-tools/dsh-system-prompt/dsh-agent +
// 真 dsh-tool-skill（模型面消费方）+ 真 platform-world.applySetupSpec（与 platform-sdk-server
// 会话创建路径同一函数，见 plugins/platform-sdk-server.mjs setup 钩子）。

import '../runtime-compat.mjs'
import * as cordis from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import { createScope } from '@deepseek-ai/dsh-scope'
import { validateSetupSpec, applySetupSpec } from '../plugins/platform-world.mjs'

/**
 * 与 cordis.yml 三档里 `tool-skill.config.catalogDescriptionMaxLength` **同一个值**。
 * 测试世界不用读 yaml（读 yaml 的断言在 vitest 侧另有其例），这里显式钉同一数，
 * 任一侧改了而另一侧没改 ⇒ 目录字节断言当场红。
 */
export const CATALOG_DESCRIPTION_MAX_LENGTH = 200

/** 真 cordis root + 真插件（与生产 cordis.yml 同 id 同序，只去掉部署态专属的 sdk-server/llm 桥）。 */
export async function makeSkillWorld() {
  const app = new cordis.Context()
  await app.plugin(SystemPrompt, { persona: 'p2a skill seam' })
  await app.plugin(ToolRuntime, { mode: 'native' })
  await app.plugin(SkillRegistry)
  await app.plugin(AgentRegistry)
  await app.plugin(ToolSkill, { catalogDescriptionMaxLength: CATALOG_DESCRIPTION_MAX_LENGTH })
  return app
}

/**
 * agent 替身：scope key 与 exec.agent 归因载体是同一对象（仿 agent-loop 的 agent scope 铸造）。
 * `session.header.cwd` / `session.surface` / `session.events` 是 dsh-tool-skill 读的三处
 * （execute 读 cwd；pre-step 目录监听读 surface/events）—— 缺了会得 "Cannot read properties
 * of undefined"，那不是缝断了，是替身不全。
 */
export function makeSkillAgent(app, tenantId, id) {
  const agent = {
    id,
    sessionId: id,
    tenantId,
    session: { header: { cwd: process.cwd() }, surface: { nodes: [] }, events: [] },
  }
  const scope = createScope(app, agent)
  return { agent, scope, ctx: scope.ctx.extend({ agent }) }
}

/** 与 platform-sdk-server 创建路径同款：validate → apply（顺序不可换）。 */
export async function mountSetupSpec(agentCtx, spec) {
  await applySetupSpec(agentCtx, validateSetupSpec(spec))
}

/** 模型面目录的**来源数组**：dsh-tool-skill 的 pre-step 监听逐拍读的就是它。 */
export async function catalogOf(app, agent) {
  const snap = await app.get('skills').snapshot({ scope: agent })
  return { complete: snap.complete, skills: snap.skills.map((s) => ({ name: s.name, description: s.description })) }
}

/** 真调 `skill` 工具（模型面唯一的全文入口）：返回模型收到的 tool_result 文本。 */
export async function callSkillTool(app, agent, name, callId = 'p2a-call') {
  const ac = new AbortController()
  const result = await app.get('tools').execute({
    callId,
    name: 'skill',
    arguments: { name },
    agent,
    signal: ac.signal,
  })
  const text = (result.content ?? []).map((b) => b.text ?? '').join('\n')
  return { text, isError: result.isError === true }
}

/** `skill` 工具在本 agent 视图里存不存在（存在 ≠ 目录非空 —— 目录由 scope 链决定）。 */
export const hasSkillTool = (app, agent) => app.get('tools').get('skill', agent) !== undefined
