// WO-DSH-N3 · STALL_LOOP 看门狗（路 B harness 侧部署物半侧，与 platform-governance 同层）。
//
// 治什么：dsh agent 无环检测（POC E6 三档 verdict 的「放弃或外壳保留」项）——模型反复以
// 相同参数调同一工具、每轮都"成功"但原地打转时，没有任何机制打断。本插件补上
// 「advisory → interrupt」两档升级，达 cap 即 cancel 整个 turn，turn/end 落
// {kind:'aborted', reason:{kind:'stall-loop', tool, count, cap}}，由 agentcore 侧
// reassemble 分类前置重组装成 STALL_LOOP 诚实降级（对位 loop.ts:1178-1182）。
//
// 挂载形：scoped 挂载（installStallLoopWatchdog(agentCtx)，由 platform-world.mjs
// applySetupSpec 治理段调用）⇒ 天然 per-agent、随 agent dispose、cordis.yml 零改动。
// 计数语义 = cumulative-per-signature（对齐 loop.ts:1172-1175 全程累计 Map）；
// **刻意不采 stock 的 consecutive-chain**（stock :284-289 同键+1异键归1）——交替
// A-B-A-B 在 consecutive 下逃逸、native 下触顶，判据①语义对齐 loopRepeatCap 要求对齐 native。
//
// cap 同 env 源：子进程内读 process.env.QOS_AGENT_LOOP_REPEAT_CAP（runner.ts env spread
// 把 agentcore 进程的出货 compose 值原样带入——同一变量、零新增键、无第二真值）。
// opt-in：缺失/非整数/<=0 → 禁用（对位 loop.ts:533 `repeatCap>0 才启用`）。

import { randomUUID } from 'node:crypto'

// ---------------------------------------------------------------------------
// 指纹函数 · 逐字对位 stock dsh-repeat-tool-reminder
// 出处：/private/tmp/dsh-web-run/node_modules/@deepseek-ai/dsh-repeat-tool-reminder/lib/index.js:207-220
// （dist 0.1.0-rc.6 原文；stock 不导出——同文件 :323 仅 export {Config, apply, name}——
//  『复用』无法 import 只能逐字对位复刻；D1 夹具测试锁语义等价）。
// ---------------------------------------------------------------------------
/* eslint-disable */
function sortJsonValue(value) {
	if (Array.isArray(value)) return value.map(sortJsonValue);
	if (value !== null && typeof value === "object") {
		const record = value;
		const sorted = {};
		for (const key of Object.keys(record).sort()) sorted[key] = sortJsonValue(record[key]);
		return sorted;
	}
	return value;
}
function canonicalize(argumentsValue) {
	return JSON.stringify(sortJsonValue(argumentsValue));
}
/* eslint-enable */

// stock :193 GENTLE_REMINDER 逐字引（advisory 档文案与 stock 同一来源，防措辞漂移）。
const GENTLE_REMINDER = "You are repeating the exact same tool call with identical arguments. Carefully analyze the previous result before calling again: if the task is not complete, try a different approach or different arguments instead of repeating the call.";

// meta 工具 skip（loop.ts:1171 同口径：final_answer/load_skill 元操作不计入环检测）。
const META_TOOLS = new Set(['final_answer', 'load_skill'])

/**
 * cap 解析：Number() → 整数且 >=1 启用；缺失/非整数/<=0 禁用。
 * 与 native 的分叉（已登记）：native 侧 zod coerce 失败 = config load 抛错拒 boot，
 * 本侧解析失败 = 静默禁用；出货 compose 由 seam ① 正整数断言 + check-deploy-governance.mjs
 * 守门 ⇒ 出货态不可达该分叉。
 */
export function parseLoopRepeatCap(raw) {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) return undefined
  return n
}

// 测试夹具对拍用（stock 不导出；我方导出供 D1 锁语义）。
export { canonicalize, sortJsonValue }

/**
 * 在 agent scope 上安装 STALL_LOOP 看门狗。cap 未启用 = 零挂载（监听器都不注册，
 * 休眠态与无 watchdog 逐字节同行为）。
 *
 * 两档升级：
 *   rung1 advisory：n===cap-1 且 cap>=3 时往 downstream.additionalContexts prepend 提醒
 *     （手法=stock :303-315 先 next() 后 prepend；source {kind:'plugin'} 标签 load-bearing——
 *      stock :180-188 自陈无标签的 context 在派生历史里会被渲染成 user prompt）。
 *     边：cap=1/2 无 advisory 档（对齐 stock validateThresholds :240-245 阈值>=2 约束，
 *     cap=2 时 cap-1=1 即首轮即提醒语义太吵，stock 同阈值设计不认 1）。
 *   rung2 interrupt：n>=cap 时 await next() 后 exec.agent.cancel({kind:'stall-loop', ...})
 *     —— 公共 API（dsh-agent-loop lib/types/agent.d.ts 声明 cancel(cause, options)；
 *     实现 index.js:405-412 清 inbox + phase.abort.abort(cause)；turn/end 落
 *     {kind:'aborted', reason:cause}（index.js:575-580/592-595）；cause 纯 JSON 对象
 *     过 session lossless-JSON 校验）。
 *   post-execute 计数 ⇒ 第 cap 次调用**已执行后**才中断（native 在 dispatch 前拦，
 *   第 cap 次不执行）——工具执行数差 1，已登记为语义 delta（事件面/轮次/outcome 不受影响）。
 *   计数放 post-execute 的另一理由（stock :274-278 同语）：deny 的调用也过同一瀑布，
 *   模型锤一个被拒调用正是要打断的环。
 */
export function installStallLoopWatchdog(agentCtx) {
  const cap = parseLoopRepeatCap(process.env.QOS_AGENT_LOOP_REPEAT_CAP)
  if (cap === undefined) return { enabled: false }

  // per-agent Map<sig, n>（scoped 挂载 ⇒ 本 Map 天然 per-agent，无需 stock 的 WeakMap 键控）。
  const counts = new Map()

  agentCtx.on('tools/post-execute', async (exec, _result, next) => {
    if (!exec.agent) return next() // stock observe :280 同守卫（无 agent 的执行不计）
    if (META_TOOLS.has(exec.name)) return next()
    const sig = JSON.stringify([exec.name, canonicalize(exec.arguments)]) // 链键同构 stock :282-283
    const n = (counts.get(sig) ?? 0) + 1
    counts.set(sig, n)
    const downstream = await next()
    // rung2 interrupt：达 cap 即 cancel（第 cap 次结果已落帧，abort 在下一步边界生效）。
    if (n >= cap) {
      exec.agent.cancel({ kind: 'stall-loop', tool: exec.name, count: n, cap })
      return downstream
    }
    // rung1 advisory：cap-1 处 prepend 温和提醒（block/accept 两态都 prepend，stock :307-315 同构）。
    if (n === cap - 1 && cap >= 3) {
      const reminder = {
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: GENTLE_REMINDER }],
        source: { kind: 'plugin', plugin: 'platform-watchdog', form: 'notice', summary: `${exec.name} × ${n}` },
      }
      const additionalContexts = [reminder, ...(downstream.additionalContexts ?? [])]
      if (downstream.kind === 'block') {
        return { kind: 'block', feedback: downstream.feedback, additionalContexts }
      }
      return { ...downstream, additionalContexts }
    }
    return downstream
  })

  // agent/pre-step 见 user-source 消息复位（stock :317-320 同机制，防跨 prompt 串计；
  // 今日拓扑一 session 一 prompt，属双保险不构成正确性依赖。
  // 推断标注：scoped agent/pre-step 监听是否触发未单独取证——pre-execute scoped 已被
  // POC E2 实证，同 scopeTarget 分发模式推断同性；不触发仅 = 双保险失效，无正确性影响）。
  agentCtx.on('agent/pre-step', ({ messages }, next) => {
    if (messages.some((message) => message.source?.kind === 'user')) counts.clear()
    return next()
  })

  return { enabled: true, cap }
}
