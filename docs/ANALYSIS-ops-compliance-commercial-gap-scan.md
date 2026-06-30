# 分析 · 换视角扫一轮：运营 / 合规 / 商业化 缺口（决策闭环之外的"企业 SaaS 右半边"）

> 用户提示：上轮按"决策闭环右半边"找断点；换**运营/合规/商业化**视角大概率还能挖。本扫描沿这三镜头逐能力对照**本会话真读源所得**（✅见代码 / ◐有基建有裂缝 / ❌ grep 无实装）。**证据级别**：读源 gap-scan（非逐项真起服务实拍——"缺失"无法真跑，"存在"附文件:行）。

## §1 运营（Operations）

| 能力 | 状态 | 证据（真读源） | → 建议 WO |
|---|---|---|---|
| **可观测·指标** | ✅ | `/metrics` Prometheus 文本端点（datacore `app.ts:729` + agentcore `server.ts:192`·`metrics.render()`）+ `/a/v1/metrics/*` 业务指标 | — |
| **可观测·追踪/告警/SLO** | ❌ | 无分布式追踪（无 otel/trace-id 跨服务透传）·无告警规则·无 SLO 定义/燃尽。`requestId` 有、但不串联两系统 | **WO-OBS**（trace-id 透传 + SLO + 告警） |
| **灾备 / 数据备份** | ❌ | 无应用级 backup/restore/PITR（`pg_dump`/`pg_restore` 零命中）。`config-bundle.ts`(OC3) 只迁**配置**(featureOverrides)非数据。DEPLOY.md 无备份 runbook | **WO-DR**（备份/恢复 runbook + 演练） |
| **多实例 / 伸缩** | ◐ | `tenant_id` everywhere ✅；但多实例有已验缺口（T5 steal 仅单实例·无 job 队列分发·PG 是共享态）——本会话真 PG 坐实 | WO-T5-LEASE-HEARTBEAT（已交设计）+ job 队列 |
| **作业/调度健康** | ◐ | SchedulerService + execution_locks + outbox relay + 重启续跑✅；但无队列深度/滞后监控·无死信可见性 | WO-OBS 内含 |
| **部署/回滚** | ◐ | docker-compose + 幂等迁移自动跑✅；无蓝绿/金丝雀·无迁移回滚·无版本锁定叙事 | — |

## §2 合规（Compliance）

| 能力 | 状态 | 证据（真读源） | → 建议 WO |
|---|---|---|---|
| **数据血缘/溯源审计** | ✅ **强** | ValidationTrace/RuleRef/Provenance·temporal 属性 append-only 历史(`domain.ts:385`)·outbox 域事件·dataMode 诚实位（本会话验） | — |
| **管理操作审计（who-did-what）** | ◐ | 散点：`audit()` 助手(`adminplatform.ts:131`·配置/视图变更带 `by:userId`)·`updatedBy`(features.ts)；**但无统一防篡改审计日志**捕获每次写的 actor+前后值 | **WO-AUDIT**（统一 actor 审计日志·append-only） |
| **数据主体权利（导出/删除·GDPR）** | ❌ | 无编排式 `exportTenant`（可携带）/ `purgeTenant`（被遗忘权·级联删两系统全资源）。`TenantStore.remove` 原语在(`repo.ts:78`)·但无 offboarding 级联流 | **WO-DSR**（租户数据导出 + 级联清除） |
| **数据分级 / PII** | ❌ | `DataCategory`（业务域）在·但无 PII/敏感度分级·无字段级合规脱敏·无驻留控制。`no-secrets-echo` 只管凭据非客户 PII | **WO-PII**（敏感度分级 + 脱敏策略） |
| **数据留存 / TTL** | ❌ | 无留存策略/TTL/自动清理——outbox 事件/tasks/ts 点无界增长 | **WO-RETENTION** |
| **外部审计对接** | ❌ | 无只读审计员角色·无审计证据导出（SOC2 式）。A6 行级过滤是访问控制·非审计员专用 | WO-AUDIT 内含 |
| **职责分离（SoD）** | ◐ | RBAC 角色 + Action 审批(R4)✅；但无正式 SoD 强制（maker≠checker 未强制） | — |

## §3 商业化（Commercialization）

| 能力 | 状态 | 证据（真读源） | → 建议 WO |
|---|---|---|---|
| **Entitlement → 定价层** | ✅ **强** | features.ts entitlement + `config-bundle` 把 featureOverrides 视为**"可售包形态"**——功能开关即定价层原语（暗发 defaultOn:false·关=404） | — |
| **计量 / 计费** | ◐ | `llm_budgets`(OC7·`migration019`) + `/a/v1/llm-budgets/record` 计量 + `budgetStatus`✅；**但仅 LLM 成本·无通用 SaaS 计费**（无开票/用量定价/订阅/支付） | **WO-BILLING** |
| **LLM 预算·硬阻断** | ◐ **裂缝** | 租户 LLM 预算是**计量+状态上报（advisory）·非调用前硬阻断**——agentcore 无 grep 命中查 `/a/v1/llm-budgets` 再放行。**逐任务** token/时长预算✅硬执行(`loop.ts` degrade BUDGET_EXHAUSTED)，**租户月度成本配额**超了不拦下一次 | **WO-BUDGET-ENFORCE**（超额硬阻断/降级） |
| **配额 / 限流** | ◐ | 每用户并发 ≤3✅(`orchestrator.ts:156` 429)；**无租户级速率限**（req/min·API 配额·存储/对象数配额按层） | WO-QUOTA |
| **A/B 决策实验（champion-challenger）** | ❌ | SimCompare/Sandbox = 手动 what-if·evals = 测试套件；**无冠军-挑战者/影子部署/holdout** 在真流量上 A/B 两个求解器参数版本测结果。M11 校准调参·但非受控实验 | **WO-EXPERIMENT**（决策实验框架） |
| **自助接入 / 用量看板** | ◐ | "空世界开箱"租户(`seed.ts:98`) + admin 平台租户/用户管理✅；无自助注册/开通·无面向客户用量看板 | — |
| **成本归因** | ◐ | LLM 预算逐租户 + 指标；无逐租户 compute/storage 成本归因 | WO-BILLING 内含 |

## §4 综合判断 · 缺的是"企业 SaaS 右半边"

**模式很清楚：系统在"决策闭环 + 多租户语义"原语上强（entitlement 即定价层·租户隔离·血缘审计·逐任务预算·RBAC+审批），但"企业 SaaS 运营层"有真缺口。**

**最该补的 6 环（按风险/商业化阻断度排序）：**

| 环 | 一句话 | 主 WO | 为何要紧 |
|---|---|---|---|
| **① 灾备/备份** | 无应用级数据备份/恢复 | WO-DR | 生产数据丢失=灭顶·当前裸靠底层 PG |
| **② 数据主体权利** | 无租户数据导出/被遗忘权 | WO-DSR | EU/受监管客户的**签约前置**·商业化硬门槛 |
| **③ LLM 预算硬阻断** | 月度成本配额超了不拦 | WO-BUDGET-ENFORCE | 失控 LLM 花费=真金白银·当前 advisory 拦不住 |
| **④ 决策 A/B 实验** | 无冠军-挑战者验证决策质量 | WO-EXPERIMENT | "成熟决策系统"的自证闭环·改了参数怎么知道更好 |
| **⑤ 数据留存/TTL** | 事件/任务无界增长 | WO-RETENTION | 长跑必爆存储·合规也要留存上限 |
| **⑥ 统一审计 + 追踪** | who-did-what 散点·无跨服务 trace | WO-AUDIT / WO-OBS | 合规审计 + 生产排障地基 |

## §5 诚实边界

- 本扫描是**读源 gap-scan**（标 ✅ 的见文件:行·标 ❌ 的是 grep 无实装的"缺失证据"），**非逐项真起服务实拍**——与本会话其它"真跑核发"证据级别不同，已显式区分。
- 三镜头取**工程/合规/商业模式**通用维度·非穷举（如军用密级分层、特定行业监管按需）。
- 部分"❌"可能有我没命中的实装（如分散在 admin 页/迁移里）——**dev 若指出已实装、请给文件:行，我真起复验**；本表是审核方"换视角"的断点清单、非终判。
- 与上轮"决策闭环"断点（hollow-data/P0-LOCK/DL9/场景接地）**正交互补**——那批是"决策算得准/接得地/扛得住"，本批是"卖得出/审得过/运维得了"。

## 本体引用与影响

- **不变量**：R2（租户隔离·本批多处依赖）·R4（Action 审批=SoD 雏形）·R5（凭据加密·但不覆客户 PII）·R13（溯源诚实=血缘审计强项）。**本批若落地将新增不变量**：如 R-RETENTION（数据留存上限）·R-DSR（租户级联导出/清除完整性）·R-BUDGET（超额硬阻断）——届时回写本体 §5。
- **链路/事件**：WO-DR/DSR 涉跨两系统级联（DataCore 数据 + AgentCore tasks/runs）——新增 `tenant.purged`/`tenant.exported` 事件需登记 §4；WO-EXPERIMENT 涉 solver 版本路由（接 §6 求解器链）。
- **断点**：本批 6 环建议登记为新断点（如 G-OPS-1 无 DR·G-OPS-2 无 DSR…）入本体 §8，与 G-1…G-12 并列。
- **门禁**：WO-RETENTION/WO-AUDIT 可立结构门（如"每写路径带 actor"门、"留存策略覆盖每增长表"门）入 §7。

---
*审核方架构分析（design+review·读源 gap-scan·换运营/合规/商业化视角）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
