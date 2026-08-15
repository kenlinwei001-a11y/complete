# @platform/dsh-harness（WO-DSH-POC-S1 · 路 B）

dsh（deepseek-harness）运行时的**独立部署包**。路 B 的核心取舍：38 包闭包、cordis.yml、
bin 进程全部收敛在本包，agentcore 只经 `@deepseek-ai/dsh-sdk-client` + JSON-RPC stdio 驱动——
preview 版上游漂移（0.1.0-rc.6 dist-tag 分裂已实证）停在 packages/dsh-harness 边界内。

## 内容

- `cordis.yml` — 运行时装配单。与 stock 的关键差异：sdk-jsonrpc-server 替换为
  `plugins/platform-sdk-server.mjs`（stock `createSession` 不收 setup 钩子，而 setup 是按
  AgentDefinition 组 scoped 世界的唯一入口）。
- `plugins/platform-sdk-server.mjs` — 我方 server 变体。协议面不变（initialize /
  session/prompt / shutdown），`session/prompt` 参数扩一个**仅创建期生效**的 `setup`
  字段（可序列化 SetupSpec，对侧产物见 `apps/agentcore/src/dsh-runtime/`）。
- `plugins/platform-world.mjs` — SetupSpec → AgentSetup 装配。persona（scoped
  system-prompt section）、mcpServers（scoped mcp-client 实例）、**S2 治理闸**（scoped
  `tools/pre-execute` 监听器：允许表白名单 + ruleBindings 裁决，只收本 agent 的调用）。
  skills SkillProvider 注册仍待 S2 后半。
- `plugins/platform-governance.mjs` — 治理裁决网桥。`mode: mock`（S2 kill 条件用，deny
  清单取 env `PLATFORM_GOV_DENY`）/ `mode: http`（生产缝：POST 到 agentcore 规则评估端点，
  与 dsh 自家 Host 的 `/api/respond` 带外回答同模式；超时/畸形应答 fail-closed 转 deny）。
- `plugins/mock-llm.mjs` / `plugins/echo-tool.mjs` — POC 夹具（S0 冒烟原物）。
  生产部署以 platform LLM 适配器插件替换 mock-llm。
- `smoke.mjs` — 自证：`pnpm smoke` 应打印 `SMOKE_OK`。断言：setup 接收 + setup 重放拒绝
  （S1 回归）+ **S2 kill 条件**（case A 治理 deny ⇒ execute 0；case B 基线 ⇒ execute 1；
  case C 允许表排除 ⇒ execute 0）。

## 运行

```bash
pnpm install        # 闭包全量钉 0.1.0-rc.6（dist-tag 分裂，禁裸 latest）
pnpm smoke          # 自证（mock LLM，零真 key）
pnpm start          # 手工起 JSON-RPC stdio 服务（正常由 agentcore spawn）
```

## 已知限制（S2 裁决项）

1. dsh mcp-client 的 serverName 预留是根级的：两个 agent 挂同名 MCP server 会撞
   duplicate namespace。S2 在「根级共享连接池 + scoped 可见性过滤」与「会话后缀改名
   （破坏 mcp__ 审计名）」之间选。
2. governance（ruleBindings → tools/pre-execute 裁决）走 harness 侧 answerer 插件 +
   带外通道回 agentcore，S2 实现；无 answerer 时 dsh fail-closed（默认拒），方向对我方有利。
