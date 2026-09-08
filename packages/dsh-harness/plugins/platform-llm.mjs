// WO-DSH-N1-PROVIDER · 生产形态 LLM 适配器桥（路 B harness 侧，与 mock-llm 相对的生产件）。
//
// 单一路由 'platform'（= apps/agentcore/src/config.ts PRODUCTION_DSH_HARNESS_PROVIDER 同值；
// engine 分叉 provider 实参与此路由同源，改路由只改那一处常量）。
//
// 连接事实不进 yml（每 run 不同租户/模型/key）：全部由 agentcore 经 runner opts.env 缝注入
// 子进程 env —— PLATFORM_LLM_API（openai-completions|anthropic-messages）/ PLATFORM_LLM_BASE_URL /
// PLATFORM_LLM_MODEL（已剥 dcp: 前缀的 modelId）/ PLATFORM_LLM_API_KEY / 可选 PLATFORM_LLM_CONTEXT_WINDOW。
//
// env 未注入 ⇒ 本插件**不注册路由**（惰性）：dsh 路由由 engine 分叉发起且必带注入，缺注入的
// 子进程（POC/mock 夹具、手动冒烟）不该因本平台件在场而崩 boot；以 provider 'platform' initialize
// 而无注册 ⇒ platform-sdk-server 防呆位诚实报 no adapter registered（与本仓「缺适配器直接报错
// 更安全」同向）。
//
// 委托 @deepseek-ai/dsh-llm-pi-ai 的 apply（编程构造手声明路由 profile：api/baseURL/models 全从
// env 读）——wire 线 = E1 已证的 pi-ai openai-completions 路（usage DISJOINT 折出在 pi-ai 侧：
// prompt_cache_hit_tokens 从 prompt_tokens 折出为 cacheReadTokens）。
//
// 凭据红线：profile 只携带 apiKeyEnv **引用名**；key 值由上游 resolveApiKey 经 launchEnvironment
// 回退 process.env 按名解析（缺失 ⇒ LlmError MISSING_CREDENTIAL，错误串只含引用名不含值——
// assertUsableApiKey 契约 "The key never enters the message"）。key 永不进 JSON-RPC 帧/日志/落盘，
// 随子进程关闭消散（每 run 独立进程）。
import { apply as applyPiAi } from '@deepseek-ai/dsh-llm-pi-ai'

export const name = 'platform-llm'
export const inject = ['llm']

const REQUIRED_ENV = ['PLATFORM_LLM_API', 'PLATFORM_LLM_BASE_URL', 'PLATFORM_LLM_MODEL']

export function platformLlmEnvReady(env = process.env) {
  return REQUIRED_ENV.every((k) => typeof env[k] === 'string' && env[k].length > 0)
}

export function apply(ctx) {
  if (!platformLlmEnvReady()) {
    // 惰性不注册（见文件头）：生产路由缺 env 注入 ⇒ 路由不存在 ⇒ initialize 防呆诚实报错。
    ctx.effect(() => () => {}, 'platform-llm.noop')
    return
  }
  const contextWindow = Number(process.env.PLATFORM_LLM_CONTEXT_WINDOW)
  applyPiAi(ctx, {
    providers: {
      platform: {
        displayName: 'Platform LLM（绑定矩阵）',
        apiKeyEnv: 'PLATFORM_LLM_API_KEY',
        api: process.env.PLATFORM_LLM_API,
        baseURL: process.env.PLATFORM_LLM_BASE_URL,
        models: [
          {
            id: process.env.PLATFORM_LLM_MODEL,
            ...(Number.isFinite(contextWindow) && contextWindow > 0 ? { contextWindow } : {}),
          },
        ],
      },
    },
  })
}
