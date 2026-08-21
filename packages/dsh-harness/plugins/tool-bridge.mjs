// WO-DSH-PROD-READY · W8主：tool-execute 反向通道桥（harness 侧）。
//
// 位，桥什么：dsh 子进程世界的工具调用 → 宿主 agentcore 的 GuardedToolExecutor（中央治理
// 执行器，scope/OBO/IAM/预算/审计全链）。platform-world.mjs 把 setup.hostTools 注册成
// 「反向工具」，其 execute = 本模块单例 executor = fetch POST 宿主 /b/v1/dsh/tool-execute
// （带外通道，与 platform-governance http 模式同构）。
//
// wire 形态：
//   请求  {runToken, callId, toolName, input, timeoutMs}——runToken = engine fork 铸的
//         per-run 一次性随机 token（env DSH_RUN_TOKEN 注入）；callId = 桥侧每次调用新铸
//         （宿主同 run 域内重放 ⇒ 409）。零静态鉴权材料上 wire（x-service-token 是
//         服务间凭据，与治理端点同一枚）。
//   应答  200 OK ⇒ {outcome:'OK', payloadJson, truncated, note?, toolCallId, durationMs}
//         （payloadJson 是宿主端点用单源 truncateToolResultJson 截断后的**串**——原样透传，
//          禁 parse/stringify 往返：JSON 会重排 integer-like 键，逐字等契约会破）；
//         200 非 OK ⇒ {outcome:'DENIED'|'ERROR'|'BUDGET_EXCEEDED', payload, toolCallId, durationMs}。
//
// 回执文案 = native loop.ts 单源镜像（逐字等，禁漂移——eam-test B2/B8 咬的就是这几个串）：
//   DENIED  payload.error==='AGENT_SCOPE_VIOLATION' ⇒ SCOPE 文案（loop.ts:880 第一支）；
//           其余 ⇒ '无权访问'（loop.ts:880 第二支）；
//   BUDGET_EXCEEDED ⇒ '预算已尽，请基于已有结果调用 final_answer 收尾'（loop.ts:868）
//           + 包络带 reason ⇒ platform-world 的 tools/execute 包装触发 B6 降级桥 cancel；
//   ERROR   ⇒ JSON.stringify(payload)（loop.ts:889 同形）；
//   传输层  非 200/不可达/超时/畸形 ⇒ ERROR 包络（TOOL_EXECUTE_HTTP/UNREACHABLE/TIMEOUT/
//           MALFORMED）——fail-closed，绝不静默放行（mutation a/b 锚）。
//
// 双档超时（相互独立，孤儿行构造面）：
//   per-call 档 DSH_TOOL_EXEC_TIMEOUT_MS（缺省 20000）随请求上行，宿主端点再与预算剩余
//   取 min ⇒ 宿主 executor withTimeout 档；fetch 档 DSH_TOOL_EXEC_FETCH_TIMEOUT_MS
//   （缺省 = per-call 档 + 5000 宽限）是桥本地放弃线——桥先放弃而宿主仍跑完 ⇒ 帧 ERROR ∧
//   宿主晚落 OK 审计行（孤儿行，REC §3 B3 登记的合法形态）。
//
// 部署形态：env 缺 url 或 runToken ⇒ **休眠**（executor 置 null，不抛）——runToken 是
// per-run 动态量，runner 级消费方（POC/smoke/L2 三实）不经 engine 分叉、没有该 env，
// 硬抛会全部拒 boot。fail-closed 收在使用点：setup.hostTools 非空而 executor 为 null ⇒
// platform-world 创建期抛（「带畸形 spec 的会话不许出生」同口径）。engine 分叉恒注入三键
// ⇒ 生产链路永远 armed。

import { randomUUID } from 'node:crypto'

let executor = null

export function setToolExecutor(fn) { executor = fn }
export function getToolExecutor() { return executor }

export const name = 'platform-tool-bridge'

// native loop.ts 回执文案（逐字镜像，单源注释锚；改 loop.ts 必须同步此处——eam 测试会咬）。
const DENIED_SCOPE_TEXT = 'AGENT_SCOPE_VIOLATION: 该工具超出本 Agent 的能力声明' // loop.ts:880 第一支
const DENIED_GENERIC_TEXT = '无权访问' // loop.ts:880 第二支
const BUDGET_RECEIPT_TEXT = '预算已尽，请基于已有结果调用 final_answer 收尾' // loop.ts:868

export function apply(ctx, config = {}) {
  const url = config.url ?? process.env.PLATFORM_TOOL_EXEC_URL
  const runToken = process.env.DSH_RUN_TOKEN
  if (!url || !runToken) {
    setToolExecutor(null) // 休眠（见头注部署形态）；hostTools 到达时 platform-world fail-closed
    return
  }
  const serviceToken = config.serviceToken ?? process.env.PLATFORM_TOOL_EXEC_TOKEN
  const callTimeoutMs = Number(process.env.DSH_TOOL_EXEC_TIMEOUT_MS ?? 20000)
  const fetchTimeoutMs = Number(process.env.DSH_TOOL_EXEC_FETCH_TIMEOUT_MS ?? (callTimeoutMs + 5000))

  setToolExecutor(async ({ toolName, input }) => {
    const envelope = (out) => ({ __w8bridge: true, ...out })
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(serviceToken ? { 'x-service-token': serviceToken } : {}),
        },
        body: JSON.stringify({
          runToken,
          callId: `dshcall_${randomUUID()}`, // 每次调用新铸；宿主同 run 域内重放 ⇒ 409
          toolName,
          input,
          timeoutMs: callTimeoutMs,
        }),
        signal: AbortSignal.timeout(fetchTimeoutMs),
      })
      if (!res.ok) {
        return envelope({
          ok: false,
          outcome: 'ERROR',
          text: JSON.stringify({ error: 'TOOL_EXECUTE_HTTP', message: `tool-execute endpoint HTTP ${res.status}` }),
        })
      }
      const body = await res.json()
      if (body?.outcome === 'OK' && typeof body.payloadJson === 'string' && typeof body.toolCallId === 'string') {
        return envelope({
          ok: true,
          toolCallId: body.toolCallId,
          payloadJson: body.payloadJson,
          ...(typeof body.note === 'string' ? { note: body.note } : {}),
        })
      }
      if ((body?.outcome === 'DENIED' || body?.outcome === 'ERROR' || body?.outcome === 'BUDGET_EXCEEDED')
        && typeof body.toolCallId === 'string') {
        const payload = (body.payload && typeof body.payload === 'object') ? body.payload : {}
        if (body.outcome === 'DENIED') {
          return envelope({
            ok: false,
            outcome: 'DENIED',
            text: payload.error === 'AGENT_SCOPE_VIOLATION' ? DENIED_SCOPE_TEXT : DENIED_GENERIC_TEXT,
          })
        }
        if (body.outcome === 'BUDGET_EXCEEDED') {
          return envelope({
            ok: false,
            outcome: 'BUDGET_EXCEEDED',
            text: BUDGET_RECEIPT_TEXT,
            ...(typeof payload.reason === 'string' ? { reason: payload.reason } : {}),
          })
        }
        return envelope({ ok: false, outcome: 'ERROR', text: JSON.stringify(payload) })
      }
      return envelope({
        ok: false,
        outcome: 'ERROR',
        text: JSON.stringify({ error: 'TOOL_EXECUTE_MALFORMED', message: 'tool-execute endpoint returned malformed response' }),
      })
    } catch (e) {
      const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError'
      return envelope({
        ok: false,
        outcome: 'ERROR',
        text: JSON.stringify(timedOut
          ? { error: 'TOOL_EXECUTE_TIMEOUT', message: `tool-execute endpoint timed out after ${fetchTimeoutMs}ms` }
          : { error: 'TOOL_EXECUTE_UNREACHABLE', message: `tool-execute endpoint unreachable: ${e?.message ?? e}` }),
      })
    }
  })
}
