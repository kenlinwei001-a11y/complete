# PRD 增量 · Agent 运行时强化（上下文管理 / Workflow 执行语义 / Skill 资源 / MCP 运行时）

| 项 | 值 |
|---|---|
| 版本 | v1.0（增量：修订 QOS-PRD §5.4/§6.3、平台 PRD §8.2–8.4；全部为运行时层缺口，配置模型不变） |
| 解决问题 | Agent 上下文压缩与超窗处理、多轮连续性、Workflow 崩溃语义、Skill 附件可被 agent 消费、MCP 连接生命周期与 stdio 安全 |

## 1. Agent 上下文管理（修订 QOS-PRD §6.3 循环，最高优先）

### 1.1 Token 预算器
- 每次迭代前估算当前 messages 总量：Anthropic provider 用 `count_tokens` API（每 2 轮实测一次，期间用增量估算 chars/3.5）；openai_compatible 用 chars/3.5 估算。
- 上下文软阈值 = min(模型 maxContext, 200K) × **70%**；硬阈值 90%。

### 1.2 工具结果入上下文的截断策略（逐条强制）
1. 单个 tool_result 进入 messages 前截断至 **8KB**（JSON 在数组维度截断，保结构合法），截断时附尾注：`[已截断：共 n 条，仅含前 k 条。请用更精确的过滤条件或聚合工具重查]`——把"取太多"转化为模型可自纠的信号；
2. 完整结果仍全量入审计（tool_calls 表既有规则不变），截断只作用于 LLM 上下文；
3. `query_timeseries_agg` 等已有桶数上限的工具不受二次截断影响。

### 1.3 上下文清理（超软阈值时，按序执行直至回到阈值下）
1. **第 1 刀**：将最旧迭代的 tool_result 内容替换为占位摘要 `[第 i 轮 {tool} 结果已折叠：{首行摘要}。如需请重新调用]`（assistant 的 tool_use 块保留——保持消息结构合法）；逐迭代向新折叠，**最近 2 轮永不折叠**；
2. **第 2 刀**（仍超）：Anthropic provider 启用服务端 compaction（beta `compact-2026-01-12`，compaction 块按官方语义原样回传）；openai_compatible 无此能力 → 跳到第 3 刀；
3. **第 3 刀**（达硬阈值或收到 `model_context_window_exceeded`）：强制收尾——注入系统提醒"上下文已满，立即基于已有结果调用 final_answer"，再给 1 次迭代机会，仍无 → 按预算耗尽语义（QOS-PRD §5.4-6）降级收尾。
- 全过程记录 `contextOps[]` 入 AgentRunRecord（折叠/压缩/强制收尾各计 metric：`ac_context_ops_total{op}`）。

### 1.4 多轮对话连续性（修订 QOS-PRD §5.1/buildAgentUser）
- 同 conversationId 的后续任务：**不复用**上一任务的原始循环 messages（脏上下文+成本）；注入**前情摘要块**：最近 ≤3 个已完成任务的 `(用户问句, 回答首个 text block ≤300 字, resolvedRefs 关键实体)`，外加当前 selectedObjects——指代消解（"那常州呢"）靠摘要+上下文对象，而非全量历史；
- 分类器的 6 轮摘要规则不变，两处共用同一摘要构建器。

## 2. Workflow 执行语义（修订 QOS-PRD §5.3 / 平台 PRD §8.2）

1. **有界同步执行声明**：workflow 总时限 = Σ步骤超时上限，且 ≤ **5 分钟**（发布校验：步骤超时合计超限 → 拒绝发布）。本期**不做持久化恢复**——这是显式边界而非疏漏。
2. **崩溃语义**：服务启动时扫描 `EXECUTING_*` 状态超过 10 分钟的任务 → 置 `FAILED`，error=`{code:"INTERRUPTED_BY_RESTART"}`，SSE 回放可见；前端对此错误码显示「系统重启中断，请重试」+一键重发（幂等键自动更换）。
3. **预留接口**：`WorkflowCheckpointStore`（空实现 + 接口），步骤边界写检查点的 durable execution 留待 v2；DSL 条件分支同列 v2（当前 BLOCK 终止语义覆盖主要分支需求）。

## 3. Skill 资源可消费（修订平台 PRD §8.4）

1. 新增内置工具 `read_skill_resource`（sideEffect=READ）：入参 `{skillId, resourceName}`；文本类（md/txt/csv/json，按 mime 判定）返回内容（≤64KB，超出截断+提示）；二进制类返回元信息（mime/大小/用途描述）并明示"无法直接读取"；
2. SkillDefinition.resources 增加 `mime` 与 `description` 字段（让模型知道附件是什么、何时读）；
3. skill body 中可用 `{{resource:name}}` 标注引用，load_skill 返回时附资源清单——渐进披露三级：summary → body → resource。

## 4. MCP 运行时（修订平台 PRD §8.3）

### 4.1 连接生命周期
- **streamable_http**：每 server 连接池（≤4），空闲 30s 关闭；每次 tools/call 超时 **20s**（可按 server 配置覆盖，≤60s）；失败重连退避 1s/2s/4s，连续 5 次失败 → server 置 `ERROR` 状态 + 告警事件，引用它的 agent 调用即时返回 is_error tool_result（不阻塞循环）。
- **stdio**：持久子进程（非每调用拉起），30s 心跳（`ping`），崩溃自动重启 ≤3 次/小时后置 ERROR；进程资源限制（预留：容器内 ulimit/cgroup 参数位）。
- 工具 schema 缓存 TTL 10min + 配置页「刷新工具清单」按钮。

### 4.2 工具命名空间（防重名冲突）
暴露给模型的工具名一律 `mcp__{serverName}__{toolName}`（serverName 即 McpServerConfig.name，创建时校验 `^[a-z0-9_]{2,24}$` 且租户内唯一）；scopeDeclaration.toolNames 与审计均用全名。

### 4.3 stdio 安全（红线级修订）
1. stdio 传输**默认禁用**：需部署方设置环境变量 `MCP_STDIO_ENABLED=1` 且 `MCP_STDIO_COMMAND_ALLOWLIST`（绝对路径白名单，逗号分隔）；
2. stdio 类型的 McpServerConfig **仅 platform_admin 可创建/修改**（catalog_admin 只能配 http 类）——堵死"租户管理员配任意 command 即在主机执行任意代码"的 RCE 路径；
3. command 必须命中白名单（前缀不行，全路径精确匹配），args 禁止 shell 元字符（白名单字符集校验）；
4. 以上三条任一不满足 → 创建/启动即拒绝，原因明确。

### 4.4 边界声明
本期：MCP 仅消费 **tools**（prompts/resources 不支持，配置页注明）；凭据仅**静态 bearer**（OAuth 授权码/刷新流程 v2 预留 `credentialKind` 字段）。

## 5. 工具并行执行（修订 QOS-PRD §6.3）

同一轮 LLM 返回的多个 tool_use：`sideEffect=READ` 的并行执行（Promise.all，并发 ≤4）；含 COMPUTE/ACTION_DRAFT/EXTERNAL 的混合轮全部串行（保守保证审计顺序与预算计数确定性）。tool_result 按 tool_use 原顺序回填。

## 6. 验收用例

| # | 用例 | 预期 |
|---|---|---|
| R1 | 工具返回 500 条对象（>8KB） | 上下文中被截断+尾注；审计存全量；模型下一轮用更窄过滤重查（Mock 脚本断言提示词生效） |
| R2 | 构造 6 轮大结果迭代触发软阈值 | 第 1 刀折叠最旧轮、最近 2 轮完整；contextOps 记录；任务正常完成 |
| R3 | 硬阈值强制收尾 | 注入收尾提醒后 1 轮内 final_answer 或降级；不抛 context 异常给用户 |
| R4 | 同 conversation 追问"那常州呢" | 前情摘要注入，回答正确解析指代；不携带上一任务原始 messages（token 断言） |
| R5 | workflow 执行中 kill 进程重启 | 任务置 INTERRUPTED_BY_RESTART；前端一键重试成功 |
| R6 | read_skill_resource | 文本附件可读且截断规则生效；二进制返回元信息 |
| R7 | MCP http 端点宕机 | 退避重连→ERROR 状态→agent 调用得 is_error 不阻塞；恢复后自动回 ACTIVE |
| R8 | 工具重名 | 两个 server 同名工具以命名空间区分，scope 与审计用全名 |
| R9 | stdio 安全 | 未设 env 时创建 stdio 配置被拒；catalog_admin 创建被拒；白名单外 command 被拒；args 注入字符被拒 |
| R10 | 并行执行 | 同轮 3 个 READ 工具并行（耗时断言 < 串行）；含 COMPUTE 的轮全串行；结果顺序与 tool_use 一致 |
