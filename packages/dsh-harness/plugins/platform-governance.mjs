// WO-DSH-POC-S2 · 治理裁决网桥（harness 侧）。
//
// 位，仲裁什么：dsh 的 `tools/pre-execute` waterfall（core/tools/src/index.ts:152）是
// 工具派发前唯一闸口，PreToolDecision = allow|deny|ask（:588-592）。我方
// AgentDefinition.ruleBindings（PRE_CHECK/POST_CHECK/BOTH）的 PRE_CHECK 语义映射到此闸。
// dsh 无 answerer 时 ask→deny（fail-closed），默认方向对我方有利。
//
// 两种裁决器（cordis.yml config.mode 选择）：
//   mock — S2 kill 条件用。deny 清单来自 config.deny 或 env PLATFORM_GOV_DENY（csv，env 优先）。
//   http — 生产缝。POST {tool, args, governance} 到 agentcore 规则评估端点（带外通道，
//          与 dsh 自家 Host 的 POST /api/respond 同模式 —— host/apiproxy/src/api/approvals.ts）。
//          网络错误/超时/畸形应答一律 fail-closed 转 deny。
//
// 模块级单例注册表：platform-world.mjs 的 pre-execute 监听器经 getAdjudicator() 取当前裁决器
// （setup spec 是可序列化 JSON，带不了函数，裁决器必须由部署侧插件提供）。

let adjudicator = null

export function setAdjudicator(fn) { adjudicator = fn }
export function getAdjudicator() { return adjudicator }

export const name = 'platform-governance'

export function apply(ctx, config = {}) {
  const mode = config.mode ?? 'mock'
  if (mode === 'mock') {
    const fromEnv = (process.env.PLATFORM_GOV_DENY ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    const deny = new Set(fromEnv.length > 0 ? fromEnv : (config.deny ?? []))
    setAdjudicator(async (call) =>
      deny.has(call.name)
        ? { kind: 'deny', reason: `mock rule engine: tool ${call.name} denied by ruleBindings PRE_CHECK` }
        : { kind: 'allow' })
    return
  }
  if (mode === 'http') {
    const url = config.url ?? process.env.PLATFORM_GOV_URL
    if (!url) throw new Error('platform-governance http mode requires config.url or PLATFORM_GOV_URL')
    const timeoutMs = config.timeoutMs ?? 5000
    // WO-DSH-E2E（additive）：裁决端点守 x-service-token（agentcore requireServiceToken 单源），
    // 服务间凭据取 config.serviceToken ?? env PLATFORM_GOV_TOKEN；缺省不发头（旧部署零行为差）。
    const serviceToken = config.serviceToken ?? process.env.PLATFORM_GOV_TOKEN
    setAdjudicator(async (call, governance) => {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(serviceToken ? { 'x-service-token': serviceToken } : {}),
          },
          body: JSON.stringify({ tool: call.name, arguments: call.arguments, governance }),
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (!res.ok) return { kind: 'deny', reason: `governance endpoint HTTP ${res.status} (fail-closed)` }
        const body = await res.json()
        if (body?.decision === 'allow') return { kind: 'allow' }
        if (body?.decision === 'deny') return { kind: 'deny', reason: String(body.reason ?? 'denied by rule engine') }
        return { kind: 'deny', reason: 'governance endpoint returned malformed verdict (fail-closed)' }
      } catch (e) {
        return { kind: 'deny', reason: `governance endpoint unreachable: ${e?.message ?? e} (fail-closed)` }
      }
    })
    return
  }
  throw new Error(`platform-governance: unknown mode "${mode}"`)
}
