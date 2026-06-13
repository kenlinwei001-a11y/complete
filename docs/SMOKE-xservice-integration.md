# 跨服务真实联调冒烟报告

| 项 | 值 |
|---|---|
| 目标 | 起**真实 DataCore**（监听端口）+ **真实 AgentCore HTTP 求解器客户端**，走真实 `fetch` 跨进程联调，验证生产同一份代码路径 |
| 区别于上一轮 | 上一轮 AgentCore 侧用的是 mock DataCore（接线层）；本轮是**真实 AgentCore HTTP 客户端 ↔ 真实 DataCore 进程**，无 mock |
| 结论 | 跨进程链路（序列化 + OBO 鉴权头 + 真实求解器 + 错误信封 + 行级策略）全通；§7 戏剧点真值跨进程一致 |
| 验证 | 新增 `apps/datacore/test/xservice-integration-smoke.test.ts`（5 用例）；datacore **237 测试**、lint+typecheck 全绿 |

## 搭台方式

- DataCore：复用 `makeApp()` 构建真实应用（内存仓储）+ `seedBattery()` 灌入电池种子，`app.listen({port:0, host:127.0.0.1})` 监听真实端口。
- AgentCore：`createHttpDataCore(baseUrl)`（生产同一份 HTTP 客户端，跨包相对路径导入），求解器调用 = 真实 `fetch` → `POST /a/v1/solvers/{key}/invoke`。
- 鉴权：AgentCore 客户端按 OBO 透传 `x-debug-user`（URI 编码），DataCore `debugCtx` URI 解码并解析 `tenantId:userId:role1|role2`（`NODE_ENV!=production` 放行）。

## 5 个用例（全绿）

1. **真实端口 + 联通**：baseUrl 形如 `http://127.0.0.1:<port>`，客户端经 fetch 联通。
2. **14 个场景求解器经真实 HTTP** → 全部返回 `{data, snapshotVersion}`、无错误码（覆盖 8 复用中的 2 个 + 13 新增中的 11 个）。
3. **§7 戏剧点跨进程真值一致**：碳超标(成都)、信用冻结(商用车集团G，逾期清单非空)、外协有节省、认证排期数组。
4. **错误信封透传**：未知求解器 → `DataCoreHttpError{statusCode:404, code:"NOT_FOUND"}`，不静默吞。
5. **行级策略跨进程生效**：`base_manager:常州` 经 OBO 头解析为受限角色，affected_orders 可见集 ⊆ 全量。

## 覆盖边界（诚实声明）

- 本冒烟联调的是 **AgentCore 求解器工具路径 ↔ DataCore**（QOS 实际调用 `invoke_solver` 的那段）。
- **未**经 AgentCore 的 LLM 路由/工作流编排层（那层用 scripted LLM mock 单独测，避免每场景 LLM 脚本）。即"问句→意图→工作流→invoke_solver"的前半段仍是 mock LLM；从 `invoke_solver` 起到 DataCore 求解器是本轮真实联调的部分。
- 真实 PostgreSQL 未接入（用内存仓储，与既有测试一致）；DataCore 迁移另由 migrate 脚本覆盖。

## 交付

`SMOKE-xservice.tar.gz`（1 文件）+ 刷新的完整源码 zip。提交于分支 `claude/vigilant-knuth-b1nmxn`。
