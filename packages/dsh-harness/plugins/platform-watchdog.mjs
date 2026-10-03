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

// ---------------------------------------------------------------------------
// WO-DSH-GOV-CREDENTIAL · deny 侧上界（本文件第二个看门狗，与上方 STALL_LOOP 互补）
//
// ## 为什么 STALL_LOOP 那只看门狗**结构上看不见** deny 环
//
// 两条独立的原因，**各自单独就足以让计数器永不递增**（修一条不够）：
//   ① 挂载点错位：治理 deny 发生在 `tools/pre-execute`，而 STALL_LOOP 挂 `tools/post-execute`。
//      `platform-world.mjs` 的治理闸 `return { kind:'deny', … }` **不调 `next()`** ⇒ 瀑布短路
//      ⇒ 工具从未派发 ⇒ post-execute 这一帧根本不存在。
//      （上方 :81-82 的注释写「deny 的调用也过同一瀑布」—— 那句话对 stock 的内建 deny 成立，
//       对**我方 pre-execute 监听器自己短路掉的 deny 不成立**。这正是「我用『注释这么写』
//       当作『行为如此』的证据」那一类错。）
//   ② 豁免集：`final_answer` ∈ META_TOOLS，即便 ① 不成立也照样被 skip ——
//      而实测烧掉 ~4,963 轮的那个环，锤的恰恰就是 `final_answer`。
//
// ## 本上界看得见它的原因
//
// 计数点搬到**产生 deny 的那一行本身**（`platform-world.mjs` 治理闸出口，
// 经 `record()` 回调），不依赖任何下游事件帧，也**不设 meta 豁免** ——
// 被拒的 `final_answer` 正是要数的东西。
//
// ## 累计而非连续（刻意）
//
// 采**累计**语义，与上方 STALL_LOOP 选 cumulative-per-signature 的理由同源
// （见 :11-13：交替 A-B-A-B 在 consecutive 下逃逸）。deny 环同样能靠
// 「allow 一个廉价工具 → 再锤一次 final_answer」把连续计数清零逃逸掉。
// 累计 = 预算语义：**一次 run 最多消化 N 次治理拒绝**，超了就诚实收摊。
//
// ## 缺省**启用**（与 STALL_LOOP 的 opt-in 刻意不同）
//
// STALL_LOOP 可以 opt-in，因为出货 compose 显式给了 `QOS_AGENT_LOOP_REPEAT_CAP:-3`。
// 本上界若也 opt-in，而 compose 不在本单范围内（改不了）⇒ 出货态恒禁用 ⇒
// 就成了本仓最忌的「接了线没数据」：代码在、测试绿、生产一次都不触发。
// 故：未设 ⇒ 缺省 12；显式 `0`/负数/非整数 ⇒ 禁用（留给运维的逃生阀）。
// 12 的取法：真实治理 run 里散落的拒绝远少于此，而它比实测的 4,963 轮小三个数量级。
const DEFAULT_DENY_CAP = 12

/**
 * deny 上界解析。语义与 parseLoopRepeatCap **不同**（缺省启用），故单独一支，不复用。
 *   undefined/'' → DEFAULT_DENY_CAP（缺省启用）
 *   整数 >=1     → 该值
 *   0 / 负数 / 非整数 → undefined（禁用）
 */
export function parseDenyCap(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULT_DENY_CAP
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) return undefined
  return n
}

/**
 * 安装 deny 预算。返回 `{ enabled, cap, record }`；`record(exec, decision)` 由
 * `platform-world.mjs` 的治理闸在**每次产出裁决时**调用（allow 也要调——它是分母）。
 *
 * 触顶动作 = `exec.agent.cancel({kind:'budget-exhausted', reason})`。
 * 为什么复用 `budget-exhausted` 而不是新造一个 `deny-loop` 种类：
 *   - `apps/agentcore/src/dsh-runtime/reassemble.ts` 已有该 cause 的分类器，落
 *     `outcome: BUDGET_EXHAUSTED` + 诚实摘要头，且**把 `reason` 原样**印进用户可见文案
 *     ⇒ 「说清为什么」白得，不需要第二个分类器；
 *   - 新造种类要改 reassemble.ts —— **不在本单范围**，且会多出一条与既有两条同构的分支
 *     （本仓「不许第二份实现」纪律）。
 * 终态因此是**诚实的非成功态**（BUDGET_EXHAUSTED + 原因逐字），不是假装成功。
 */
export function installDenyBudget(agentCtx, env = process.env) {
  const cap = parseDenyCap(env.QOS_AGENT_DENY_CAP)
  if (cap === undefined) return { enabled: false, cap: undefined, record: () => {} }

  let denies = 0
  let fired = false

  // 见 user-source 消息复位（与上方 STALL_LOOP 的 agent/pre-step 复位同机制、同理由）。
  if (typeof agentCtx?.on === 'function') {
    agentCtx.on('agent/pre-step', ({ messages }, next) => {
      if (messages.some((message) => message.source?.kind === 'user')) {
        denies = 0
        fired = false
      }
      return next()
    })
  }

  return {
    enabled: true,
    cap,
    record(exec, decision) {
      if (decision?.kind !== 'deny') return
      denies += 1
      if (denies < cap || fired) return
      fired = true // 只喊一次：cancel 后到 turn 边界之间可能还有 in-flight 调用
      const reason =
        `治理连续拒绝 ${denies} 次已达上界（QOS_AGENT_DENY_CAP=${cap}）；` +
        `最后被拒：工具 ${exec?.name ?? '未知'} —— ${String(decision.reason ?? '未给出理由').slice(0, 300)}`
      exec?.agent?.cancel({ kind: 'budget-exhausted', reason })
    },
  }
}

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
