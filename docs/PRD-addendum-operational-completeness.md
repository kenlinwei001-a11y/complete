# PRD 增量 · 运营完备性查漏补缺（实体解析 / 评测 / 迁移 / 隔离区等十项）

| 项 | 值 |
|---|---|
| 版本 | v1.0（FDE 第二轮自查收口；基线 Part B 追加裁决 #21；实施手册 WBS 追加 W33–W36） |
| 分级 | §1–§4 高危（二源/二客户/优化 agent 时爆发）；§5–§10 中危；§11 低危统一裁决 |

## 1. 实体解析与黄金记录（Entity Resolution，挂 A3）

```sql
match_rules(id PK, tenant_id, type_key, rule JSONB, priority INT, status);
  -- rule: { kind:"exact", fields:["物料编码"] } | { kind:"fuzzy", field:"名称", method:"trigram", threshold:0.85 }
  --     | { kind:"composite", all:[...] }
merge_candidates(id PK, tenant_id, type_key, object_ids TEXT[], rule_id, score, status
  /*PENDING|MERGED|DISMISSED*/, created_at);
object_merges(id PK, golden_id FK, merged_ids TEXT[], survivorship JSONB, merged_by, merged_at);
```

- **触发**：materialize/连接器同步后增量跑 match_rules → 命中产出 merge_candidates；阈值 ≥0.95 且规则标 `autoMerge:true` 才自动合并，否则进人审队列（前端 /admin/merge-queue：并排字段对照 + 选黄金值）。
- **存活策略（survivorship）**：字段级来源优先序（元模型属性新增 `sourcePriority?: string[]`，如 `["ERP/SAP","MES"]`）；冲突字段默认按优先序取值，全记录进 object_merges.survivorship。
- **合并语义**：保留 golden 对象；被并对象置 `mergedInto`（不删除——见 §5），其 links 重指 golden（同 link 去重）；派生增量重算；**拆分** = 按 merge 记录逆操作（API `POST /a/v1/objects/merges/{id}/unmerge`，72h 内可用，超期需人工处理并审计）。
- 验收 OC1：双源同设备（exact 编码映射表+fuzzy 名称）→ 候选→人审合并→检索/切片/聚合只见 golden；unmerge 还原。

## 2. Agent 评测体系（AIP Evals，挂 AgentCore，团队优化 agent 的基础设施）

```ts
interface EvalCase {                  // 表 eval_cases，场景包内容
  id; suite: string;                  // 套件：classifier | agent_quality | regression
  input: { query: string; context: Partial<SessionContext> };
  expect: {
    intentKey?: string | null;        // 分类断言（null=应判 outOfCatalog）
    toolSequence?: { name: string; argsSubset?: object }[];   // 工具选择断言（子序列匹配）
    answerMust?: string[];            // 回答必须包含（事实关键词）
    answerMustNot?: string[];         // 禁止出现（幻觉黑名单）
    maxToolCalls?: number; trust?: "VERIFIED_WORKFLOW"|"AGENT_EXPLORATORY";
  };
}
```

- **执行**：`POST /b/v1/evals/run` Body `{ suite, agentKey?, configOverride? }` → 在隔离 eval 租户（合成数据快照固定 seed）逐 case 跑真实 QOS → 报告 `{ pass, fail[], 指标: 意图准确率/工具选择正确率/平均工具数/平均时延/token 成本 }`，落库可对比历史。
- **门禁用法**：agent/意图/提示词发布前**必须**跑关联套件且通过率 ≥ 上一已发布版本（回归不通过 → 发布阻断，force 走审计）；中台 agent 编辑器内嵌「跑评测」按钮与历史曲线。
- **种子套件**：电池场景包出厂带 ≥40 case（QOS-PRD §12 用例转化 + 兜底真问句沉淀转化——FallbackTrace 一键转 EvalCase 入口）。
- 验收 OC2：故意改坏分类提示词 → 套件通过率下降 → 发布被阻断并列出失败 case diff。

## 3. 环境间配置迁移（Config Export/Import，多客户交付工作流）

- **导出**：`POST /a/v1/config-bundles/export` Body `{ include: ["ontology","slices","rules","intents","plans","agents","workflows","skills","scenes","features","genspecs","lexicons"], packageId }` → 自包含 bundle（JSON，含全部版本化资源的 PUBLISHED 版 + 依赖闭包 + 校验和）。**不含**：实例数据、凭据、用户、租户配置（密钥类一律置占位符清单随包说明）。
- **导入**：`POST /a/v1/config-bundles/import`（目标环境/租户）→ 三阶段：① 干跑 diff 报告（新增/更新/冲突，key 级）② 人确认 ③ 事务化应用（资源按依赖序导入，全部以新 DRAFT 落地再批量 publish——走既有发布门禁，含 slice 契约测试）。冲突策略：同 key 同内容跳过、同 key 异内容默认拒绝（`--overwrite` 显式覆盖并审计）。
- bundle 版本兼容：携带 `platformSchemaVersion`，不匹配拒绝导入（提示升级路径）。
- 验收 OC3：模板租户导出 → 空白生产租户导入 → 干跑报告正确 → 应用后全部发布物可用、契约测试全绿、凭据占位符清单输出。

## 4. 数据隔离区（Quarantine，补 A1/A3/A9 的悬空引用）

```sql
quarantine_rows(id PK, tenant_id, conn_id, dataset, raw JSONB, reason TEXT
  /*SCHEMA_MISMATCH|TYPE_ERROR|REF_NOT_FOUND|UNIT_ERROR|RULE_REJECT|DUP_KEY*/,
  detail TEXT, status/*PENDING|REPROCESSED|DISCARDED*/, created_at);
```

- 写入点：连接器同步行级失败、materialize 行级失败、A8 时序点越界、单位 lint 运行期命中——**行级失败不再使批次失败**（批次结果含 `quarantined: n`）。
- 前端 /admin/quarantine：按原因分组、原始行查看、**修复并重处理**（行内编辑→重投对应管线）与批量丢弃（需意见）；连接器健康度卡显示隔离率，>5% 告警。
- 验收 OC4：注入 hostile 数据 → 批次成功+异常行全量入隔离区且原因正确 → 修复重处理后进入正常管线。

## 5. 对象实例归档语义（修正实施手册裁决 D-08 的雷）

本体对象实例**禁止物理 DELETE**（溯源/derivation_runs/审计引用会断链）。统一为：`objects.status: ACTIVE | ARCHIVED | MERGED(=mergedInto 非空)`；检索八模式默认仅 ACTIVE（参数 `includeArchived` 可开）；派生公式的聚合默认排除非 ACTIVE；归档需无 ACTIVE 下游强依赖（links 提示）；溯源/历史回看不受状态影响（永远可达）。**D-08 修订为**：仅适用于"非本体、非被引用"的纯配置行。物理清除只经数据保留作业（§11-d）。

## 6. 写回回声抑制（Action writeback echo）

Action 写回成功时登记 `writeback_echoes(action_id, conn_id, dataset, matchKey, expectedValue, expireAt=+7d)`；连接器同步管道对命中 matchKey 的行做回声对账：值一致 → 标记 `echoOf: actionId`（不重复触发派生告警，溯源上行链接到 Action——闭环证据）；值不一致 → 产出 `WRITEBACK_DIVERGENCE` 告警（源系统侧被人改过，必须人看）。验收 OC5：写回→模拟同步回流→一致打标/不一致告警两路。

## 7. 平台内置提示词配置化

分类器、A2 抽取、A3 建模、A7 模板生成、agent 收尾提醒等**全部内置提示词**收编为 `prompt_templates(tenant_id, key, version, body, status)`（场景包内容，版本化+发布+引用 latest 语义全套适用）；代码内仅保留出厂缺省（租户无覆盖时回退）。中台 /admin/prompts 编辑器带「用评测套件验证」按钮（联动 §2——改提示词必须过评测门禁）。验收 OC6：租户覆盖分类器提示词→生效；回归不过→发布阻断。

## 8. LLM 成本配额与看板

`llm_budgets(tenant_id, period:"month", hardLimitTokens, softLimitPct=80)`：用量按 `{tenant, purpose, provider, model}` 维度计量（既有指标落库化）；软线→事件通知 tenant_admin；硬线→**降级而非熔断**（路径 B 拒新任务返回 `LLM_BUDGET_EXCEEDED`+提示走预设问答；路径 A 的 llm_compose 跳过改用模板拼接；分类器降级走 WORKFLOW_ONLY 行为）。中台 /admin/llm-providers 增加用量 Tab（按用途/模型/日的成本曲线，单价表配置在 provider 上）。验收 OC7：压到硬线→路径 B 拒绝且路径 A 仍可用。

## 9. 通知中心

`notifications(id, tenant_id, user_id, kind, title, body, refType, refId, readAt, createdAt)`；产生方=既有事件体系订阅规则（审批待办→审批人；催办/升级→OpsSchedule 定义；告警→域 owner/基地负责人；C21 提报→S&OP 主持人）。前端：Shell 顶栏铃铛（未读数）+ 下拉列表 + 点击跳 refType 对应页；用户偏好（按 kind 开关站内/邮件，邮件通道接口预留实现留空）。验收 OC8：审批流转产生定向通知、已读状态、跳转正确。

## 10. 工厂日历（业务时间语义）

`calendars(tenant_id, calendar_key, weekendMode, holidays: date[], shifts?: …)`（A9 行业字典的 calendar 升级为运行时一等对象，基地对象可引用 calendar_key）。**语义钉死**：SUSTAIN(n 日)=自然日（监测连续性不应跳过周末）；计划达成率/班次实绩聚合=工作日历日；交付期"净生产窗口"扣减节假日（capacity_forecast 的 wkEff 计算接入日历，原公式语义不变、日数改按日历折算）；检修周定义=ISO 周。每处消费点在实现时必须显式声明用哪种日历（代码评审项）。验收 OC9：春节周跨越的 6 周交付窗口，净窗口正确扣减。

## 11. 低危项统一裁决（并入实施手册 §4，编号续）

| # | 事项 | 裁决 |
|---|---|---|
| D-21 | 通用导出 | 所有数据表格组件统一带 CSV 导出（act.export feature 控制）；定期报告订阅=v2 |
| D-22 | 多会话管理 | Dock 增加会话列表（最近 20 条，可重命名/删除）；删除=软删（任务记录保留） |
| D-23 | API 对外开放 | 本期不开放第三方直调；预留 service account + API key 表结构，端点不暴露 |
| D-24 | 密码策略 | ≥8 位含字母数字；连续 5 次失败锁定 15 分钟；审计登录失败 |
| D-25 | 审计不可篡改 | 审计类表（tool_calls/审批/合并/发布）无 UPDATE/DELETE 路由，DB 角色层面禁写回 |
| D-26 | 备份恢复 | 属部署运维文档（非 PRD 范围）；PRD 层仅要求：所有状态在 PG+BlobStore，无本地文件状态 |

## 12. 实施手册 WBS 追加

W33 实体解析+隔离区（依赖 W08/W10；判据 OC1/OC4）｜W34 评测体系+提示词配置化（依赖 W15；OC2/OC6）｜W35 配置迁移 bundle（依赖 W19/W20；OC3）｜W36 通知中心+成本配额+日历+回声（OC5/OC7–OC9）。插入位置：W24 之后、前端工单之前（前端工单相应扩展隔离区/合并队列/通知/用量页）。

## 13. 并发一致性补遗（写冲突评审反照出的平台三缺口）

### 13.1 任务级快照读（Task-Scoped Snapshot Read）

**问题**：长 workflow/agent 任务的多个步骤分别读"当前数据"，步骤间数据可能被并发写入改变（同型于"模拟结果基于旧规则"问题）；本体核心 §1 已承认完整 MVCC 为 v2，本节给出**本期可实现的折中**：

- 任务启动时记 `taskEpoch = 当前租户 epoch`；任务内全部读 API（objects/query、resolveSlice、aggregate、规则定义读取）增加可选参数 `asOfEpoch`，工具层自动注入 taskEpoch；
- **本期实现语义**（无完整 MVCC 的近似）：`objects.epoch ≤ asOfEpoch` 行过滤 + temporal 属性按 prop_history 回溯 + 派生值按 derivation_runs(epoch≤) 回溯；**非 temporal 普通属性在任务执行窗口内被改写的，按当前值返回并在结果标记 `epochApprox:true`**（窗口短：workflow ≤5min，发生概率低且可观测）；
- 求解器输入因此获得稳定快照（QOS-PRD M6"快照引用而非活数据"由此真正落地）；溯源 snapshotVersion 含 taskEpoch；
- 配置类读取（规则/计划/提示词的 latest 解析）**不**按 taskEpoch 回溯——同一任务内首读后缓存于任务上下文（任务内一致即可，跨任务跟随 latest，与引用模式语义一致）。

### 13.2 代次取消（取消优于仲裁）

- 同一 `conversationId` 提交新任务时，仍在执行中的旧任务**默认自动取消**（`CANCELLED, reason:"SUPERSEDED"`，SSE 发 task.cancelled）；前端提交时可传 `keepPrevious:true` 显式保留并行（多问题并行是合法场景，但默认收敛）；
- 任务携带 `generation`（会话内单调），工具执行器在每次调用前检查任务 cancelled 标志（既有循环边界检查强化为工具粒度）；被取消任务已产生的 Action 草稿保留（提案并存原则）。

### 13.3 并发可观测性指标

新增：`qos_tasks_cancelled_total{reason}`、`dc_version_conflicts_total{resource}`（D-07 的 409 计数）、`dc_epoch_approx_reads_total`（13.1 近似读命中）、`sched_lock_wait_ms`（SKIP LOCKED 等待直方图）。冲突治理从断言变为数据。

### 验收用例

| # | 用例 | 预期 |
|---|---|---|
| CC1 | 任务执行中并发改一个 temporal 属性 | 任务内两次读取值一致（=taskEpoch 时值）；任务后新任务读到新值 |
| CC2 | 改非 temporal 属性 | 结果带 epochApprox 标记且指标 +1（诚实暴露近似） |
| CC3 | 同会话连发两问 | 旧任务 SUPERSEDED 取消、SSE 事件正确；keepPrevious=true 时并行完成 |
| CC4 | 配置 latest 任务内一致 | 任务执行中发布新规则版本 → 该任务仍用启动时版本，下一任务用新版（留痕 resolvedRefs 验证） |
