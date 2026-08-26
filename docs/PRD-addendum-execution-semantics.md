# PRD 增量 · 执行语义统一规范（互斥/投递/迁移 Saga/回放幂等/降级）

| 项 | 值 |
|---|---|
| 版本 | v1.0（深度补齐：把五处"正确性级"执行语义提升到 §13 同级标准；基线 Part B 追加裁决 #22） |
| 适用 | 全平台所有后台执行体（派生/同步/生成/回放/导入/投递），实现必须逐条对照 |

## 0. 本体引用与影响（补录）

> 遗留 PRD 追溯补录（治理 #2，prd:check 入图）；仅引用平台真实不变量(§5 R1–R14)/断点(§8 G-1..G-8)。

- **触及不变量**（§5）：R10 · R6
- **触及断点**（§8）：（无特定断点）
- **范畴**：执行语义统一：互斥/投递/迁移 Saga/回放幂等/降级（at-least-once 排序）

## 1. 管线执行互斥与重入（统一机制，A1/A4/A8/A9/A3 全部适用）

```sql
execution_locks(tenant_id, resource_kind TEXT/*derivation_spec|connection_sync|forge_generate|
                materialize|replay|bundle_import*/, resource_key TEXT, holder_id TEXT,
                acquired_at, lease_until TIMESTAMPTZ, fence BIGINT/*单调，每次获取+1*/,
                PRIMARY KEY(tenant_id, resource_kind, resource_key));
```

1. **获取**：`INSERT … ON CONFLICT DO UPDATE WHERE lease_until < now()`（原子抢占过期租约）；获取成功返回 `fence`；默认租约 = 任务预估时长×2（派生 5min/同步 30min/生成 15min/回放 30min），执行中每 1/3 租约心跳续租；
2. **Fencing**：执行体的每次结果写入携带 fence，写入路径校验 `fence ≥ 锁表当前 fence`，否则拒绝（`STALE_EXECUTOR`）——锁过期后"复活"的旧执行体写不进任何东西；
3. **同键互斥语义**：同 (kind, key) 第二个触发者**不排队**——`SKIPPED_ALREADY_RUNNING` 立即返回（携 holder 信息）；变更触发类（派生）改为置"待重跑"标志，当前轮结束后由持有者收尾检查并连跑（合并风暴：连续变更只多跑一轮）；
4. **重入**：所有管线任务必须支持"从检查点或幂等重做"二选一并在实现中声明——派生=幂等重做（写值幂等）；同步=cursor 检查点（每批提交后持久化 cursor，重入从 cursor 续）；A9 生成=分 dataset 检查点；回放=见 §4；
5. 指标：`exec_lock_skipped_total{kind}`、`exec_fence_rejects_total`、`exec_lease_expired_total`。

## 2. Outbox 投递语义（平台契约 C-2 的精确化）

1. **保证级别：at-least-once，按聚合内有序**——outbox 行带 `(aggregate_key, seq)`（如同一 action_id 的事件串行投递），不同聚合并行；全局有序**不保证**（消费端不得依赖）；
2. 投递循环：批量取未投递行（SKIP LOCKED）→ POST 消费端 → 2xx 标记 done；非 2xx 退避 1m/5m/30m/2h/12h（5 档后置 DEAD，进死信列表，中台可见可手动重投）；
3. **消费端去重契约**：每事件带全局唯一 `eventId` 与 `aggregate_key/seq`，消费端必须按 eventId 幂等（B 侧缓存失效类消费天然幂等；外部 webhook 在文档中声明此契约）；
4. 投递与业务同库同事务写 outbox 行（已有原则），投递器独立循环——**禁止**业务事务内同步外呼。

## 3. 跨系统配置迁移 Saga（修订运营完备性 §3"事务化应用"）

bundle 含 A 系（本体/规则/切片/GenSpec…）与 B 系（agent/workflow/skill/scene/意图）资源，跨系统无分布式事务，应用阶段为**两段顺序 Saga + 显式补偿**：

```
导入状态机：DRY_RUN_OK → APPLYING_A → APPLYING_B → COMPLETED
                              ↘ A 失败：A 内事务回滚 → FAILED（无需补偿）
                                          ↘ B 失败：执行补偿 → COMPENSATING_A → ROLLED_BACK
补偿语义：A 段应用以"新 DRAFT 批量创建+批量发布"完成，补偿 = 将本次发布的版本批量 RETIRE
          并恢复前一版本为 latest（版本化资源天然支持；A 段记录 appliedManifest 供补偿遍历）
顺序依据：B 资源引用 A 资源（agent 引用规则/切片），反向不存在 → A 先 B 后，B 失败时 A 可安全回退
          （新版本尚无 B 侧引用）
```

- 整个导入持 §1 锁 `(bundle_import, tenantId)`（同租户同时只允许一个导入）；
- `import_jobs` 表记录状态机与 appliedManifest；COMPENSATING 失败 → `MANUAL_INTERVENTION` 状态+告警（死信级，中台展示残留清单）；
- 验收 ES3：B 段注入失败 → A 段自动补偿、目标租户回到导入前状态（资源版本断言）；补偿期间查询不见半成品（DRAFT 不可见性已天然保证）。

## 4. 回放编排器的真实 API 幂等（修订回放增量 §3）

1. 每个 OpsAction 执行携带**幂等键** `opKey = hash(seed, tick, persona, actionIndex)`；QOS 提问复用既有 Idempotency-Key 机制；审批/S&OP/孵化端点增加可选头 `Idempotency-Key`（管理平台增量端点统一补此能力：同键重复请求返回首次结果，存 `idempotency_records(key, response_digest, expires=7d)`）；
2. 回放进度检查点：`replay_progress(tenant_id, last_completed_tick)` 每 tick 提交；中断重入从 `last_completed_tick+1` 继续，**tick 内**部分完成的动作由幂等键去重——重复执行返回原结果不产新记录；
3. 验收 ES4：在 tick 200 杀进程 → 重入 → 最终任务/审批/版本记录数与不中断跑一致（逐表计数断言）。

## 5. LLM Provider 故障切换语义（修订 LLM 增量 §1.1 fallback 一句话）

1. **触发 fallback 的条件**（仅这些）：连接超时/5xx/429 且重试耗尽（SDK 内建重试后）/ provider 显式 DISABLED。**不触发**：4xx 参数错误（说明请求有问题，换厂商无意义）、内容审查拒绝（保留原语义返回）；
2. **熔断**：滚动 1 分钟窗口失败率 >50% 且样本 ≥5 → OPEN（直接走 fallback，不再探测主 provider）；30s 后半开放 1 个探测请求，成功 → CLOSED；
3. fallback 仅一级（既有规则）；fallback 也熔断时按该调用点的既有失败语义处理（分类→路径 B / agent→任务失败 / 抽取→任务 FAILED 可重试）；
4. 每请求审计补 `providerAttempts: [{providerId, outcome, ms}]`；指标 `llm_breaker_state{provider}`、`llm_fallback_total{from,to}`；
5. 验收 ES5：主 provider 注入 5xx → 熔断打开走 fallback；恢复后半开探测回切；4xx 不触发切换。

## 6. LLM 管线任务的失败与部分结果语义（A2 抽取 / A3 建议 / A7 模板）

统一三态：任务级 `FAILED_RETRYABLE`（LLM 不可用类，保留输入可一键重试）/ `FAILED_PERMANENT`（输入不合法类）/ `PARTIAL`（分段任务如 A2 多段抽取：已成功段落保留并可审，失败段落标记可单独重试——段落级状态表 `extract_segments(doc_id, seg_no, status, error)`）。禁止"整任务失败丢弃已完成段落"。验收 ES6：20 段文档第 13 段注入失败 → 12 段可审、1 段可单独重试、任务态 PARTIAL。

## 7. 其余文档的深度分级声明（避免无限深挖）

| 深度级 | 标准 | 适用文档 |
|---|---|---|
| L1 协议级 | 并发/故障/边界全部钉死（本文与 §13 标准） | 本体核心/治理、QOS、M11、Agent 运行时、本文 |
| L2 算法/契约级 | 公式与 API 精确，执行语义引用 L1 通则（本文 §1–§2 即通则） | 求解器、A8、A9、回放、功能开通、LLM&引用 |
| L3 流程/UI 契约级 | 交互与数据契约精确，实现细节由样板+裁决表约束 | 前端系列、管理平台、运营态 |
| 治理级 | 索引/裁决/手册 | 基线、实施手册 |

L2/L3 文档中任何后台执行体一律继承本文 §1–§2 通则（裁决 #22）；此分级即"达标"的正式定义——**不再以 L1 标准要求 L3 文档**，遗留个案走 OPEN_QUESTIONS。
