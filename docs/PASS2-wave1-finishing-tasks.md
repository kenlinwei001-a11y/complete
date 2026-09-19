# PASS2-WAVE1 · 收尾任务清单（6 块真跑定级结果）

> **这是什么**：`COMPLETION-LEDGER §3`「待 Pass-2 定级」前 6 块的真跑摸底结果。**结论：6 块全部 72–95% 已建，台账标 ⬜未跑全是虚标。都是"收尾"不是"建"**——故不各配整份 HANDOFF，统一列收尾任务（带锚点/优先级/完成判据）。
>
> **铁律（同所有 HANDOFF）**：每块"已建别重写"项**只接不重写**；缺口任务**先 FDE 真跑定基线再动**；完成=亲手跑一遍能用+证据，不是测试绿；只 push `claude/vigilant-knuth-b1nmxn`、push 前 rebase。
>
> **建设度（摸底实勘）**：M11 95% · 回放 92% · A8 90% · agent运行时 85%(余为 v2 边界) · 运营完备性 72% · 执行语义 72%。

---

## 1. P0 任务（最该先做 · 多为"钩子已预埋但没接线"）

| # | 块 | 任务 | 锚点（现状） | 完成判据 |
|---|---|---|---|---|
| P0-1 | M11 | **C12 触发钩子接线** | `calibration/service.ts:222` `onCalibrationRequired()` 已定义**无 caller** | RULE_SCAN/C12 命中→真调钩子→产校准提案（贴证据） |
| P0-2 | M11 | **周度 CALIBRATION_RUN 定时任务** | 代码定义在(L87)，**无 S3 scheduler 集成** | scheduler 注册每周 job，到点真跑全量配对 |
| P0-3 | 运营完备性 | **OC6 提示词配置化消费端** | 表已建 `migration018`；classifier/A2/A3/A7 **仍硬编**，无 resolver latest 消费 | 租户覆盖分类器提示词→生效；回归不过→发布阻断 |
| P0-4 | 运营完备性 | **对象 status 三态 ACTIVE/ARCHIVED/MERGED** | `ObjectInstance` 无 status 字段；检索仅过滤 mergedInto | 归档对象默认不出现于检索，溯源/历史仍可达 |
| P0-5 | 运营完备性 | **§13.1 asOfEpoch 全链回溯** | `tools/executor.ts:66` 已捕获；**ontology/solvers/rules 读层未全接** | 任务内改 temporal→任务内两次读一致（asOfEpoch 贯穿） |
| P0-6 | 执行语义 | **任务级三态 FAILED_RETRYABLE/PERMANENT** | `contracts/execution.ts:61` enum **零引用**；A2/A3/A7 无错误分类落地 | LLM 不可用→RETRYABLE 可一键重试；输入非法→PERMANENT |
| P0-7 | 回放 | **ask/promoteIntent HTTP 端到端验证** | `app.ts:446`/`replay.ts:212` 依赖 `AGENTCORE_BASE_URL`，**仅 mock 无集成测试** | 起双服务真跑回放：ask→QOS→taskId 闭环，promote→intentId（贴证据） |
| P0-8 | A8 | **回放 OpsPlaybook 真实运营驱动** | `simclock.ts:54-58` `setOpsPlaybookRunner` **钩子预埋未驱动** | 真实租户 tick→SCHEDULED_FORECAST/SOP_AUTO_OPEN 真产出（与回放轨交叉） |

## 2. P1 任务

| # | 块 | 任务 | 锚点 | 判据 |
|---|---|---|---|---|
| P1-1 | M11 | 参数版本+值原子化 | `performApply` setParam+bumpParamsVersion **两步非原子** | 中断不致版本/值不同步（事务/saga） |
| P1-2 | M11 | rollback 分布式回滚验证 + API 错误边界 + 前端元闭环渲染测试 | `performRollback L690`；`f28.calibration.test` 缺 realizedMape mock | 多条目对象回滚一致；非 PENDING/APPLIED 状态报错被 catch |
| P1-3 | A8 | livedIn 365 天回放真接 tick 链路 | `simclock.ts:30-35` 钩子预埋；`livedin/engine.ts` | 新租户 livedIn→7 入口有历史；同 seed 字节一致 |
| P1-4 | A8 | tick 完成跨页刷新 | `SimClockConsole.tsx:149` emit `synthetic.tick_completed`，**依赖全局 SSE 订阅** | tick 后驾驶舱/风险卡自动变化（不重登） |
| P1-5 | A8 | M11 配对+元闭环真跑（T9 偏差演示） | `simclock.ts:50-51` setCalibrationTicker（与 M11 交叉） | 连 tick→偏差累积→C12→提案→应用后 MAPE 收敛 |
| P1-6 | 回放 | OpsSchedule put **service 层**权限校验 | `schedule.ts:40` 仅靠路由 ctx，无 service 层 tenant_admin 检查 | 绕过路由 planner 改配置→被拒 |
| P1-7 | 回放 | 文本池多行业扩展 + A9 合成预生成入口 + 前端 /admin/ops-schedule 管理台 | `pools.ts:14` 4 key 硬编电池语料；前端缺管理台 | 换行业语料可切；管理台可配/看剧本报告 |
| P1-8 | agent运行时 | 多轮连续性核实（messages 真清剔 vs 仅文本摘要） | `loop.ts:152` rollingNotes 注入 | 同 conversationId 第二任务 messages 数组 << 第一任务（token 证明无原始复用） |
| P1-9 | 运营完备性 | OC8 通知前端页 /admin/notifications | 后端 `notifications.ts` 完整，**前端零** | 审批流转→定向通知+已读+跳转 |
| P1-10 | 运营完备性 | OC9 工厂日历 CRUD + netProductionWindow + capacity 接入 | 表 `migration020`，缺 CRUD/计算/接入 | 春节周交付窗口净窗口正确扣减 |
| P1-11 | 执行语义 | LLM fallback 调用端集成 | `llm/breaker.ts` 基建在，**QOS/Agent 调用链缺"取 fallback→重试"** | 主 provider 5xx→走 fallback（不直接失败） |
| P1-12 | 执行语义 | Idempotency-Key 头 A3/S&OP/孵化端点 | 表已备，`sop.ts`/`actions.ts`/promote **未解析头** | 同 Idempotency-Key 重复请求返回首次结果 |
| P1-13 | 执行语义 | replay_progress 心跳 + extract_segments→RuleDoc PARTIAL 聚合 | `replay.ts runTick` 未调 put；ruledocs PARTIAL 聚合不足 | 中断重入准确续跑；段失败→doc PARTIAL 一致 |

## 3. 已建·别重写速查（动手前核对，免砸已能用的）

- **A8**：ts_series/ts_points 表+写入+增量聚合+SUSTAIN DSL+模拟时钟 7 步+query_timeseries_agg+SimClockConsole（`timeseries.ts`/`simclock.ts`/`ruledsl.ts`/`profiler.ts`）。
- **M11**：配对引擎+三方法(EMA/重放归因/分位)+回测门+频率/级联抑制+autoApply+元闭环+CalibrationPage（`calibration/*.ts`/`CalibrationPage.tsx`）。
- **回放**：VirtualPersona 6 人+正门红线(不直写)+OpsPlaybook DSL+文本池+tick 末执行+OpsSchedule 三类+隔离（`opsteam/*.ts`）。
- **agent运行时**：Token 预算器+8KB 截断+三刀清理+工具并行+MCP 全生命周期+stdio 安全（`agent/context.ts`/`loop.ts`/`mcp/runtime.ts`）。durable execution/OAuth/MCP prompts 是**文档明标 v2 边界，不做**。
- **运营完备性**：实体解析+合并队列+评测体系+config-bundle Saga+隔离区+写回回声+LLM 配额（`entity-resolution.ts`/`config-bundle.ts`/`quarantine.ts` 等）。
- **执行语义**：execlock 互斥+Fencing+Outbox 有序+5 档退避死信+Saga 补偿+熔断器（`execlock.ts`/`outbox.ts`/`breaker.ts`）——**核心 100%，别碰**。

## 4. 派活 + 评审
- **可拆给多 agent**：按块认领（M11/回放/A8 三块互相钩子交叉，建议同一 agent 或先 P0-1/2/7/8 一起做）。每项**先 FDE 真跑定基线**再动。
- **评审**：同各 HANDOFF §5——①不重写已建 ②门绿 ③本体回写 ④**FDE 亲手证据**（真跑非测试绿）⑤北极星距离。审核方据此 ✅/🔴。
- **诚实定性**：这 6 块**无架构断裂**，差的是"接钩子 + 补前端页 + 加字段/头 + 逐卡真跑验"。
