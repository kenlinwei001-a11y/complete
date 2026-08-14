# 后端↔前端接缝长尾分诊清单（WO-BEFE-G）

> **本文件是什么**：门 `befe-seam:check` 载体② 报出的 196 条「后端注册了、前端零调用」端点里，
> 不属于任何已派域组（ontology / action-drafts / agents / org / solvers / llm …）的 **58 条长尾**，
> 逐条追到路由处理函数、鉴权、消费方之后的**分诊结论**。闭本体 §8 断点 `G-BE-FE-SEAM-DEAD`。
>
> **本文件不是什么**：不是接线计划。分诊 ≠ 接线；本单只接了其中判定为「高价值且小成本」的 **1 条**
> （`POST /a/v1/auth/logout`，见 §6），其余按类给出处置建议，由排期方决定。

---

## 0 · 测量前提与金丝雀（铁律 0.6：否定结论必须先自证工具）

本文件通篇是**否定结论**（「前端零调用」「零测试」「零调用方」）。先给金丝雀。

### 0.1 门自己的金丝雀

```
$ node scripts/check-backend-frontend-seam.mjs --verbose
· 金丝雀 19/19 全中（词法 2 · SSE 抽取 4 · 路由 8 · 消费判据 5）
· 载体② HTTP 端点：后端注册 525 条（结构性豁免 13）· 前端 URL 字面量 257 条
  · 前端零调用 196（基线 186 · 新增 10 · 已修复 0）
```

### 0.2 分诊流程自己的金丝雀（本单加的 · 双向）

判据：「已知**有**前端消费方的端点，走同一套分诊流程必须判成**不在**清单」。7 正向 + 2 反向，全中。

| 金丝雀端点 | 前端调用点（file:line） | 在缺口清单？ |
|---|---|---|
| `GET /a/v1/databuilder/workflow-runs` | `apps/frontend-shell/src/api/endpoints.ts:1207` | 不在 ✓ |
| `GET /a/v1/rules/*/references` | `apps/frontend-shell/src/api/endpoints.ts:452-453`（带 `${id}` 插值） | 不在 ✓ |
| `GET /a/v1/objects/*/neighbors` | 门自带金丝雀 C7b | 不在 ✓ |
| `GET /a/v1/process-instances/stuck` | `apps/frontend-shell/src/api/endpoints.ts:1667` | 不在 ✓ |
| `POST /b/v1/evals/run` | `apps/frontend-shell/src/api/endpoints.ts:1274` | 不在 ✓ |
| `GET /a/v1/me/workspace` | `apps/frontend-shell/src/api/endpoints.ts:98` | 不在 ✓ |
| `GET /b/v1/scene-entries` | `apps/frontend-shell/src/api/endpoints.ts:903` | 不在 ✓ |
| **反向①** 已知缺口 `GET /a/v1/action-types` | — | **在** ✓（判据非恒假） |
| **反向②** 不存在的 `GET /a/v1/__befe_g_never_exists__` | — | 不在 ✓（判据非恒真） |

前端文件面金丝雀：生产文件 **210** 个（`src/**` 剔 `mocks/` 与测试）· 含 mock/测试全量 **224** 个；
正向搜 `/a/v1/me/workspace` 命中 1 处、反向搜不存在路径命中 0 处。

### 0.3 计数对账（派单说 57，实测 58）

派单按**基线**筛得 57 条；按门**当前实跑**结果筛是 **58** 条。
多出来的 `POST /a/v1/process-instances`（`apps/datacore/src/app.ts:4619`）是本分支
（`claude/verify-reclaim-6`）相对基线**新增**的 10 条缺口之一，其余 9 条落在已派域组里
（`causal-graphs`×2 · `org`×4 · `queries`×1 · `agents`×1 · `process-instances`×1）。
本文件按 **58 条**分诊，不漏报新增。

---

## 1 · 四类计数（对账平）

| 类 | 条数 | 含义 |
|---|---:|---|
| **(1) 真缺口** | **51** | 租户/管理员该用的能力，今天只能 curl |
| **(2) 设计上不该有前端** | **5** | 服务间调用 / CLI 专用 / 运维手动触发 / 供应脚本 |
| **(3) 门的假阳性** | **0** | 前端确实调了、门抓不到 —— 本组一条都没有 |
| **(4) 疑似死路由** | **2** | 后端注册了但连后端自己都不调、无测试、无文档 |
| 合计 | **58** | = 门实跑筛出的本组端点数（三重对账见 §7.1） |

> **计数的时间基准**：上表是**分诊当时**（本单开工态，门报 196 条）的快照。
> 本单随后接上了 (1) 里的 #1 `POST /a/v1/auth/logout` ⇒ 门现报 **195** 条、基线 **185** 条，
> 本组真缺口余 **50**。§2 的表**不删** #1 —— 删了就看不出这条缺口存在过、被谁怎么闭的。

### 为什么 (3) = 0 不是「没查」

58 条逐条在前端**生产**代码里搜过「路径字面前缀」与「尾段 token」两轮。有命中的 4 处全是
**注释或散文**，门剔掉它们是**对的**：

| 看似命中 | 实际是什么 |
|---|---|
| `api/endpoints.ts:792` 提到 `POST /a/v1/inference/whatif` | 注释（讲"与既有两个出口平行"） |
| `views/sim/physicalTopology.ts:304` 提到 `POST /a/v1/objects/query` | 注释（讲 `limit` 被夹在 ≤1000） |
| `store/eventInvalidation.ts` 5 处 `event-subscriptions` | 注释 + 缺口台账字符串 |
| `views/registry.ts:124` 提到 `/a/v1/process-instances/stuck` | 注释（讲 view 归属） |

另测门「只认字符串字面量」在本仓当前写法下**没有盲区**：

```bash
grep -rnE 'api\.[ab]\w*\(\s*(path|url|endpoint|href)\b' apps/frontend-shell/src --include=*.ts --include=*.tsx | grep -v /mocks/   # 0
grep -rnE '`\$\{[a-zA-Z]' apps/frontend-shell/src/api/endpoints.ts                                                                  # 0（无「变量打头」的 URL 模板）
```

⇒ 前端不存在「变量拼 URL 前缀」的写法，门抓不到的那一类**今天不存在**。
**但门有另一种漏 —— 假阴性，见 §5。**

---

## 2 · (1) 真缺口 · 51 条

鉴权列：`user` = 普通用户 JWT · `admin` = `requireAdmin`/角色判定 · `cat-admin` = `requireCatalogAdmin` ·
`feat:x` = entitlement 暗发（关 = 404 `FEATURE_NOT_FOUND`，R3 先于 authz）。
工作量：**S** ≈ 半天内（挂在已有页/已有按钮）· **M** ≈ 需新面板或新交互 · **+决策** = 还要仓主定信息架构。

### 2.1 DataCore · 41 条（`apps/datacore/src/app.ts`）

| # | 端点 | file:line | 鉴权 | 它能做什么 · 为什么算真缺口 | 量 |
|---:|---|---|---|---|---|
| 1 | `POST /a/v1/auth/logout` | `:1090` | 公开（`:945` `PUBLIC_PATHS`） | **安全性缺口**：前端 `store/authSession.ts:18 logoutSession()` 只清本地 token + Query 缓存，**从不调后端**；而 `refresh_token` 是 httpOnly cookie（`:1091 clearCookie path=/a/v1/auth`），`api/apiClient.ts:44 silentRefresh` 带 `credentials:"include"` 仍能用它换新 accessToken ⇒ **「退出登录」后会话在服务端并未失效** | **S · 本单已接** |
| 2 | `GET /a/v1/action-types` | `:4015` | user | Action 类型清单（含 `approvalChain`）。`ActionsPage.tsx` 审批时看不到类型定义 | S |
| 3 | `POST /a/v1/action-types` | `:4016`（`:4018` admin） | admin | 租户自助注册 ActionType | M |
| 4 | `GET /a/v1/actions/metrics` | `:4046` | user | 租户级 Action 执行稳定率明细。**基线注（2026-08-13）已判为真欠账**；未接的理由是「放哪个导航组」属仓主决策 | S+决策 |
| 5 | `GET /a/v1/capability-inventory` | `:2507` | user | 本租户 类型/规则/求解器/切片 全清单 | S |
| 6 | `POST /a/v1/capability-inventory/diff` | `:2508` | user | 「建之前就知缺什么」的能力缺口比对 | S |
| 7 | `GET /a/v1/data-templates` | `:2516` | user | 由已发布对象类型派生的 CSV 上传模版清单 | S |
| 8 | `GET /a/v1/data-templates/:typeKey` | `:2523` | user | 单类型模版**直接下载**（`text/csv` + `content-disposition`）。`DataCategoriesPanel` 讲的正是「文件上传走该类对象类型派生的字段模版（**可看可下载**）」，下载口零调用 | **S · 高性价比** |
| 9 | `GET /a/v1/decisions/:id` | `:3910` | user | 决策一等可查。`views/DecisionPlayView.tsx:627/630` 只**建**（`POST /a/v1/decisions`）和**定**（`/commit`），建完读不回 | S |
| 10 | `POST /a/v1/decisions/:id/outcome` | `:3921` | user | 成效反馈闭环（COMMITTED→REALIZED·回填实测 `realizedGapClose`）。`decision/causal-graph.ts:767` 的输出文案明写「由运营经本端点一次性回填」 | M |
| 11 | `GET /a/v1/decision-outcome-stats` | `:3927` | user | 决策成效权重归集（配合 #10） | S |
| 12 | `GET /a/v1/entity-catalog` | `:2449` | user | 字段目录（类型→字段·标时序） | S |
| 13 | `GET /a/v1/entity-catalog/resolve` | `:2453` | user | 模糊实体消歧（"常州"→具体候选；域外诚实报空，不带占位符进数据生成） | S |
| 14 | `GET /a/v1/exec-locks` | `:1357`（`:1359` admin） | admin | 执行锁可观测（持锁/租约/fence/`active`） | S |
| 15 | `GET /a/v1/outbox/dead` | `:1331`（`:1333` admin） | admin | Outbox 死信列表。注释写「中台可见」—— 中台没有这一面 | S |
| 16 | `POST /a/v1/outbox/:id/redeliver` | `:1348`（`:1350` admin） | admin | 死信手动重投（与 #15 成对：只有列表没重投 = 看得见修不了） | S |
| 17 | `GET /a/v1/external-signals/:key/references` | `:3019` | user | 外部信号 → 因果因子 / `caused_by` 链 / 顶层 Metric 归因（R13 溯源闭环）。**`pages/admin/ExternalSignalsPage.tsx` 已存在**，已接 `/external-signals`、`/sensitivity`、`/:key/series`（`endpoints.ts:619/625/627`），**唯独 references 没接** | **S · 高性价比** |
| 18 | `GET /a/v1/field-coverage` | `:2614` | user | 切片字段覆盖（R12「所有字段实体需被 ≥1 切片覆盖」）+ 分类归并完整性 | S |
| 19 | `GET /a/v1/ksf` | `:3551` | user | SPINE 关键成功要素清单 | S |
| 20 | `GET /a/v1/principals` | `:3555` | user | SPINE 责任主体清单 | S |
| 21 | `GET /a/v1/metrics/:key` | `:3536` | user | 单指标 + **R13 血缘**（源连接→原始表→行号）。⚠️其兄弟 `GET /a/v1/metrics`（`:3529`）**被门误豁免**，见 §5 | S |
| 22 | `POST /a/v1/metrics/snapshot` | `:3561` | user | 指标快照回采（发 `metric.snapshot_recorded`；越线发 `metric.breached`） | S |
| 23 | `GET /a/v1/records/materialize/templates` | `:4489` | `feat:data-import.record-materialize` | 「列→属性」默认映射模板（喂 #24 的 body）。**零测试零文档**，但**不是**死路由：`RECORD_MATERIALIZE_TEMPLATES` 被同族 POST 在 `:4530` 读 | S |
| 24 | `POST /a/v1/records/materialize` | `:4501` | admin + feat | 真 RawDataset **逐行 1:1** 物化成一等真对象（CEO 驾驶舱真值供给正门）。8 处测试 + `docs/WO-CEO-DATA-supply.md` | M |
| 25 | `GET /a/v1/rule-docs/:id/segments` | `:4255` | user | 分段抽取的段落级状态（PARTIAL 任务）。**`pages/admin/RuleDocsPage.tsx` 已存在**，已接 `/rule-docs`、`/:id`、`/:id/candidates`（`endpoints.ts:435/444/445`），**唯独分段面没接** | **S · 高性价比** |
| 26 | `POST /a/v1/rule-docs/:id/segments/:segNo/retry` | `:4259` | user | 失败段落单独重试（与 #25 成对） | **S · 高性价比** |
| 27 | `GET /a/v1/tenants/:id/features/audit` | `:4958`（`:4960` requireAdmin · `:4962` 跨租户 403） | admin | 功能开关**变更审计**。**`pages/admin/FeaturesPage.tsx` 已存在**，已接 `/features`、`/features/roles/:role`、`/features/preview`（`endpoints.ts:103/108/114/121`），**唯独 audit 没接** | **S · 高性价比** |
| 28 | `GET /a/v1/timeseries/agg-specs` | `:5221` | user | 时序聚合规约清单（`docs/pipeline-verification.md:16` 记「6 个规约 · ✅ 真实」= 人手 curl 验过） | S |
| 29 | `POST /a/v1/timeseries/aggregate` | `:5222` | user | 人工补跑一轮聚合（周期路径是调度器 `TS_AGGREGATE`） | S |
| 30 | `GET /a/v1/views/pull-targets` | `:2477` | user | 视图拉取靶 ↔ 求解器输出形状覆盖校验（UNMET = G-8/R12 生长信号） | S |
| 31 | `GET /a/v1/webhooks` | `:5299` | user | 租户自助注册的 webhook 清单 | S |
| 32 | `POST /a/v1/webhooks` | `:5292` | user | 注册 webhook。⚠️`outbox.ts:61` 明写「收下 body 里的任意 `url`，`app.ts` **不做白名单**」—— 接前端须一并评审 SSRF 面 | M+安全评审 |
| 33 | `POST /a/v1/bootstrap` | `:5036`（`:5038` requireAdmin） | admin | 空租户冷启动 7 步一键引导（幂等·逐步回执·任一步核对未达即停并报缺口）。`docs/AUDIT-prd-reality-batch3.md:535` **已立单** `WO-BOOTSTRAP-GUI`「前端『一键引导』按钮接 `/a/v1/bootstrap`」 | M |
| 34 | `POST /a/v1/ceo/dataset/generate` | `:4579` | admin + `feat:ceo.dataset.generate` | CEO 驾驶舱原子颗粒数据集生成。`scripts/feature-rollout.json:56` 记「真路由已落 ⇒ 非『没做完』」 | M |
| 35 | `POST /a/v1/derivations/run` | `:3649` | user | 手动跑派生管线（发 `derivation.completed` → 失效驾驶舱/风险页） | S |
| 36 | `POST /a/v1/derive/decision-fields` | `:4409`（`:4411` requireAdmin） | admin | 导入记录字段 → 决策字段可配置派生（R14 零平台业务常数）。⚠️**「函数有测试、链路没测试」的典型**：`deriveDecisionFields` 在 `apps/datacore/test/derive-fields.test.ts` 有单测，**路由本身零测试零前端** —— 与假绿第 9 形态 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR` 同形 | M |
| 37 | `POST /a/v1/history/live-ingest` | `:5283` | admin + `apiTags:history` | 运营态真实数据回填（覆盖合成水印）。`scripts/parity-audit.mjs:1823` 有审计脚本调用 —— **审计脚本不是生产消费方**，只证明路由活着 | M |
| 38 | `POST /a/v1/inference/whatif` | `:3768` | user | 通用 what-if（前向重算受影响派生属性 · `dryRun` 不落真值）。**零测试**，16 处文档提及 | M |
| 39 | `POST /a/v1/process-instances` | `:4619` | `feat:process-runtime` | **建**流程实例。前端只接了**读**的三条（`stuck` / `:id` / `:id/advance` — `endpoints.ts:1667/1671/1678`），**建**没接 ⇒ 实例只能由后端自采产生。本条是本分支相对基线的**新增**缺口 | S |
| 40 | `POST /a/v1/writeback-echoes` | `:1313`（`mustAdmin`） | admin | OC5 写回回声登记 | S |
| 41 | `POST /a/v1/writeback-echoes/reconcile` | `:1319`（`mustAdmin`） | admin | 回声抑制 / 不一致告警（发 `writeback.divergence`） | S |

### 2.2 AgentCore · 10 条（`apps/agentcore/src/server.ts`）

| # | 端点 | file:line | 鉴权 | 它能做什么 · 为什么算真缺口 | 量 |
|---:|---|---|---|---|---|
| 42 | `GET /api/v1/perception/metrics` | `:373` | user（`auth(req)`） | A5 感知层埋点：实体解析**误触发率** + 最近域外明细（带最近邻候选）。**与 #4 同族** —— `datacore/src/app.ts:4044` 自己写着「形态与 `router/perception-metrics.ts` + `GET /api/v1/perception/metrics` 同款」。#4 已被基线判为真欠账，本条判据必须一致 | S+决策 |
| 43 | `GET /b/v1/event-subscriptions` | `:2510` | user | 事件→缓存失效接线表。⚠️**两份真相**：`event-subscriptions.ts:6` 自称「经本端点**下发给前端**缓存失效路由」，而前端 `store/eventInvalidation.ts:121` 的 `EVENT_INVALIDATES` 是**硬编码表**，注释写「与 agentcore event-subscriptions **单源同步**」—— 同步靠人手，不靠这条线 | M（先定「谁是源」） |
| 44 | `GET /b/v1/mcp/servers/solvers` | `:975` | user | 内置 `solvers` MCP server + 全部工具（31 个 `mcp__solvers__*`，已按 entitlement 过滤）。⚠️后端注释白纸黑字「**MCP 页据此显示/治理**」，而 `pages/admin/McpPage.tsx` 只调 `/b/v1/mcp-configs*`（`endpoints.ts:1139/1141/1143`）⇒ **注释承诺了、前端一个字没接**（本门要治的头号形态） | **S · 高性价比** |
| 45 | `GET /b/v1/rules/:key/references` | `:1264` | user | **B 侧**反查：改了某规则 → 哪些**编排资源**（agent/workflow/skill）引用它。⚠️易混：前端 `endpoints.ts:452` 调的是 **A 侧** `/a/v1/rules/:id/references`（规则库内引用），语义不同、不可互相顶替。**零测试** | S |
| 46 | `GET /b/v1/scene-entries/:id/references` | `:3180` | user | 场景入口引用清单（统一形态 `{references,count}`）。`pages/admin/ScenesPage.tsx` 已在，只接了列表/PUT（`endpoints.ts:903/905`） | S |
| 47 | `GET /b/v1/workflow-runs/:runId/events` | `:1335` | user | workflow 运行的 **SSE 事件流**。前端只有 `sse/useTaskStream.ts:85` 的 `/b/v1/queries/:taskId/events`（QOS 任务流）；workflow 直跑（`POST /b/v1/workflows/:id/run`）没有过程可见面。**零测试** | M（SSE 面） |
| 48 | `POST /b/v1/plan-builders/:id/new-version` | `:1714` | cat-admin + `feat:plan-builder` | 画布新版本。**基线注（WO-R2）已判为真缺口**：`PlanBuilderPage` 做了 列表/新建/编辑/编译/发布/试运行，这两个按钮未做 | S |
| 49 | `POST /b/v1/plan-builders/:id/retire` | `:1722` | cat-admin + feat | 画布下线。同上 | S |
| 50 | `POST /b/v1/skill-graphs/run` | `:1528` | cat-admin | Skill 图调度运行（编译期拒环/拒未实现节点·运行期按层并发）。`docs/CHECK-DSL-CMP.md:35` 记「唯一生产消费方 = 这条路由的请求体字段」⇒ 整个 `GraphScheduler` 的**唯一**入口就是这条零前端的路由 | M |
| 51 | `POST /b/v1/evals/seed-parity` | `:2480` | cat-admin | 从场景包播种 parity 期望用例。`pages/admin/EvalsPage.tsx` 已在且已接 `/b/v1/evals`、`/runs`、`/run`（`endpoints.ts:1271/1272/1274/1282`），**播种入口没接**。⚠️**判定边界见 §3 末**：其孪生 `seed-scenarios` 有运维脚本消费方被我判 (2)，本条**没有**任何脚本消费方 ⇒ 判 (1)。这条边界值得排期方复核 | S |

---

## 3 · (2) 设计上不该有前端 · 5 条（**不接**）

理由必须是**结构性**的（服务间 / CLI / 运维触发 / 供应脚本），不能是「暂时没做」。

| 端点 | file:line | 结构性理由（带证据） |
|---|---|---|
| `POST /a/v1/objects/query` | `app.ts:2939` | **B→A 服务间数据面**：`apps/agentcore/src/tools/datacore-http.ts:141` 经 OBO 调（QOS 工具层 `query_objects`）。前端走的是 `GET /a/v1/objects/:type`（台账/选择器 —— `app.ts:2952` 注释明写此分工） |
| `GET /a/v1/epoch/current` | `app.ts:2935` | **B→A 服务间**：`datacore-http.ts:317`，任务启动时捕获 `taskEpoch` 注入后续读取的 `asOfEpoch`（并发一致性 §13.1）。属编排内部机制，前端无对应语义 |
| `POST /a/v1/plan/triggers/scan` | `app.ts:5141` | **运维/演示手动触发**：生产触发路径是调度器 —— `app.ts:883` `RULE_SCAN` 钩子里 `await plan.scanTriggers(tenantId)`；路由注释自明「此端点供运维/演示手动触发一轮」。服务层另有测试（`planviews.test.ts:118`） |
| `POST /b/v1/operations/classify` | `server.ts:2441` | **CLI 专用**：生产消费方 `scripts/platform-cli.mjs:461`。`docs/PRD-A15-cli-universal-operation-shell.md:104` 定稿「分类在 AgentCore、CLI 瘦客户端」；GUI 侧等价能力是 QOS `ask`（路由注释「CLI 与 GUI **平行同源**」） |
| `POST /b/v1/evals/seed-scenarios` | `server.ts:2432` | **供应/开通脚本**：生产消费方 `scripts/provision-enterprise.mjs:224`（企业开通时播种场景评测用例） |

### ⚠️ 我差点划错的三条（诚实位）

- `POST /a/v1/history/live-ingest`（有 `parity-audit.mjs` 调用）与 `POST /a/v1/records/materialize`（8 处测试）
  一度想划进 (2)。**审计脚本与测试都不是「设计上不该有前端」的理由** —— 它们只证明路由活着，
  不证明它不该有 UI。二者留在 (1)。
- `POST /b/v1/evals/seed-parity` 与 `seed-scenarios` 是**孪生**（同一族 seeding），我把它们分判两类，
  唯一分野是**有没有生产脚本消费方**。这条判据是我定的，**不是仓里已有的成文标准** —— 请排期方复核。

### 本组**未使用**的豁免通道

`ROUTE_EXEMPTIONS`（`scripts/check-backend-frontend-seam.mjs:566-575`）今天豁免 13 条，
本组 58 条**一条都不该进那张表**：没有一条是探活 / `/internal/` 钩子 / JWKS / `credential` / openapi。
上面 5 条 (2) 的理由（服务间数据面 / CLI / 运维触发 / 供应脚本）虽也是结构性的，
但**颗粒不同**——豁免表是"这类路由永远不该有前端"，而这 5 条是"这条路由今天的消费方在别处"。
把它们塞进豁免表会让表失去可判定性，故**建议仍留在基线**。

### ⛔ 派单让我"往基线条目加 `why` 注解"—— **今天做不到，做了会被下一次 `--update` 抹掉**

派单 §3 写「往基线条目加 `why` 注解说明理由」。**实测这条指令不可执行**，两层原因（见 §5.3）：

1. `endpoints` 是**扁平字符串数组**，**没有 per-entry 的 `why` 槽位** —— 一条端点只能是一个字符串；
2. 唯一能放散文的 `note` 字段，会被 `--update` **整段覆盖**（`writeBaseline` 写死 `note: BASELINE_NOTE`）
   —— 本单跑 `--update` 时**当场实测到**：`note` 978 → 237 字。

⇒ 全部 `why` 落在**本文件**里（`docs/` 不会被任何脚本覆盖）。
本单对基线的改动 = **恰好 1 行删除**（logout 接上了，按棘轮摘掉），`note` 已逐字节还原。

---

## 3.5 · 跨组结构发现：「引用反查」整族 11 条零消费，却被切进 5+ 张单

分诊到 `GET /b/v1/rules/*/references` 与 `GET /b/v1/scene-entries/*/references` 时，
往上追一层发现它们不是孤例 —— **全 196 条缺口里带 `/references` 的有 11 条**：

| 侧 | 端点 | 注册点 |
|---|---|---|
| B | `GET /b/v1/agents/*/references` | `server.ts:905` |
| B | `GET /b/v1/workflows/*/references` | `server.ts:1254` |
| B | `GET /b/v1/rules/*/references` | `server.ts:1264` ← **本组** |
| B | `GET /b/v1/solvers/*/references` | `server.ts:1270` |
| B | `GET /b/v1/skills/*/references` | `server.ts:1595` |
| B | `GET /b/v1/mcp-configs/*/references` | `server.ts:1964` |
| B | `GET /b/v1/scene-entries/*/references` | `server.ts:3180` ← **本组** |
| A | `GET /a/v1/ontology/references` | `app.ts:2808` |
| A | `GET /a/v1/slices/*/references` | `app.ts:2838` |
| A | `GET /a/v1/ontology/slices/*/references` | `app.ts:2842` |
| A | `GET /a/v1/external-signals/*/references` | `app.ts:3019` ← **本组** |

B 侧 7 条**全部**由同一个函数 `computeReferences(deps.repos, tenantId, kind, id)` 支撑
（`server.ts` 里共 15 处调用，`kind` 取 `agent|workflow|rule|solver|skill|mcp-config|scene-entry`）。
⇒ **这是一个能力整体缺前端面，不是 11 个独立缺口**。今天它被按域切进 5+ 张单
（本组 3 条 · agents 组 · skills/workflows 组 · mcp-configs 组 · ontology/slices 组），
每张单各接一点 = 大概率长出 5 份形态不同的「引用面板」。

**建议**：收成**一张单** —— 一个共享 `<ReferencesPanel kind={…} id={…}>` +
一个按 `kind` 拼 URL 的通用客户端。

**⚠️ 先替这个建议排掉一个雷**：通用客户端会写成 `` `/b/v1/${kind}/${id}/references` ``，
`kind` 是**变量** —— 门还认得出「前端调了」吗？**用门自己的导出函数实测（不另抄正则）**：

```
金丝雀：extractFrontendPaths 抽出已知路径 ✓
门从通用写法里抽出的前端路径： [ '/b/v1/*/*/references' ]
  ✓ /b/v1/rules/*/references        ✓ /b/v1/scene-entries/*/references
  ✓ /b/v1/agents/*/references       ✓ /b/v1/skills/*/references
  ✓ /b/v1/workflows/*/references    ✓ /b/v1/solvers/*/references
  ✓ /b/v1/mcp-configs/*/references
  ✓ 反向 /b/v1/rules/*/references/extra（段数不同，必须不中）
```

`pathMatches` 逐段比、两侧的 `*` 都当通配 ⇒ **`/b/v1/*/*/references` 一条就把 7 条全覆盖**，
门会如实把它们从缺口里摘掉。**这也反证了 §5.2 第 3 条**：不必给门加「模板串拼 URL」支持。

---

## 4 · (4) 疑似死路由 · 2 条（**不删** · 建议另立单）

判据：**① 后端自己不调 ② 零测试 ③ 零文档 ④ 零前端** —— 四条全中才算。

| 端点 | file:line | 四项证据 | 建议 |
|---|---|---|---|
| `POST /a/v1/data-builders/validate-config` | `app.ts:4674` | ① 全仓搜 `validate-config` 只命中**两个文件**：`apps/datacore/src/app.ts`（注册行本身）与 `scripts/backend-frontend-seam-baseline.json`（缺口台账）；符号 `validateConfig` 0 命中 ② 0 测试 ③ 0 文档 ④ 0 前端 | 注释写「二次配置时前端可预检」，而 `DataBuilderConfigSchema` 本就在 `@platform/contracts` 里、前端可**本地** zod 校验 ⇒ 设计上冗余。建议另立单确认后删（**删后端超出本单边界**） |
| `POST /b/v1/evals/from-fallback/:taskId` | `server.ts:2487` | ① `evals.fromFallback`（`apps/agentcore/src/evals.ts:138`）的**唯一**调用方就是这条路由（`server.ts:2493`）② 0 测试 ③ 0 文档 ④ 0 前端 | 语义（把一次 fallback 追踪固化成 EvalCase）与 `EvalsPage` 天然配对 ⇒ **要么接要么删**，不该悬着。建议另立单二选一 |

> ⚠️ **「疑似」二字是认真的**：本判据只证明「今天没人调」，不证明「不该有」。
> 两条都保留在基线，删除需要一次**显式可评审**的动作。

---

## 5 · 给门的判据建议：(3) 类是 0，但照出一条**假阴性**

派单要的是 (3)「前端确实调了、门抓不到」。本组 **0 条** —— 门在本组**假阳性率 = 0**。
同一次追查却照出门的**反向**问题，价值更大。

### 5.1 结构性豁免 `metrics` 恒误伤一条业务端点

`scripts/check-backend-frontend-seam.mjs:568`：

```js
{ re: /^\/[ab]\/v1\/(healthz|readyz|metrics)$/, why: "网关前缀下的探活别名·同上" },
```

**实测（全部可复验）**：

| 事实 | 证据 |
|---|---|
| 该正则对 `/a/v1/metrics` 判 `true` | `node -e 'console.log(/^\/[ab]\/v1\/(healthz\|readyz\|metrics)$/.test("/a/v1/metrics"))'` → `true` |
| 后端**没有**任何 `/a/v1/metrics` 或 `/b/v1/metrics` 形态的探活别名 | 全仓只注册了裸 `/healthz` `/readyz` `/metrics`（`app.ts:1029/1055/1058` · `server.ts:213/231`）与 `/a/v1/healthz` `/a/v1/readyz`（`app.ts:1064/1065`）、`/b/v1/healthz` `/b/v1/readyz`（`server.ts:238/239`）—— **`metrics` 那一支在两个前缀下都不存在** |
| 唯一能被这条豁免命中的，是**业务**端点 | `app.ts:3529 app.get("/a/v1/metrics", …)` —— SPINE 指标列表（按 `level`/`ksf` 过滤），用户鉴权，返回 `Metric` 对象 + `snapshotVersion` |
| 它前端零调用 | 前端生产代码搜 `/a/v1/metrics` = **0 处**（含 mocks/测试也是 0） |
| 它因此**不在** 196 条缺口清单里 | 缺口清单里只有 `GET /a/v1/metrics/*` 与 `POST /a/v1/metrics/snapshot`，没有 `GET /a/v1/metrics` |

⇒ **这条豁免今天的唯一效果，就是把一条真缺口藏起来**，而它写的理由（探活别名）
描述的是一个**不存在的路由**。形态照铁律 0.6 句式：

> **「我用『路径末段叫 metrics』当作『它是探活端点』的证据，而前者并不度量后者。」**

旁证：后端自己**分得清**这两个东西 —— `app.ts:959` 的
`SERVICE_ONLY_PATHS = new Set(["/metrics"])` 只含**裸** `/metrics`，
`/a/v1/metrics` 从来不在其中；`app.ts:4036` 的注释也把二者分工写得很清楚
（`/metrics` = 全租户合计 · Prometheus 文本 · 服务间抓取）。**只有门把它们混成了一条正则。**

### 5.2 建议（本单**不改门** —— 门在别的单手里，避免撞车）

1. **把 `metrics` 从带 `/[ab]/v1/` 前缀的那条豁免里摘掉**，只留裸路径那条
   （`/^\/(healthz|readyz|metrics)$/` 已经在 `:567` 存在）。摘掉后 `GET /a/v1/metrics` 会作为**新增缺口**报出来
   —— 按棘轮「只减不增」，它需要一次人手记账（与 `GET /a/v1/actions/metrics` 当时同办法）。
2. **给豁免表加自证金丝雀**（这是本条真正的机制，比修一条正则重要）：断言
   **每条豁免至少命中一条真实注册路由，且命中的都符合它写的 `why`**。
   今天 `metrics` 那一支命中 1 条、且那 1 条**不符合**理由 —— 一条与主逻辑共用
   `extractBackendRoutes` 的金丝雀就能当场抖出来（形态同门里现有的 C13c「无散文路径漏网」活体回归）。
   没有这条金丝雀，第二条写歪的豁免还会以同样方式静悄悄吞掉缺口。
3. **（可选）支持模板串拼 URL 的识别 —— 建议先不加**。本组实测用不上：前端当前没有任何变量拼前缀的写法
   （§1 两条 grep 均为 0）。真出现之前加它是过度设计，还会把「散文剔除」那条判据的边界搞模糊
   （欠账 #174 的老坑：描述缺口的那段话反而把缺口盖住）。**等真样例再动。**

### 5.3 第二条：`--update` 会**抹掉基线里手写的 `why` 记账**（一枪上了膛）

派单要求「往基线条目加 `why` 注解」。实测**做不到**，且**现存记账正处于被抹的风险里**：

| 事实 | 证据 |
|---|---|
| `endpoints` 是**扁平字符串数组**，没有 per-entry `why` 槽位 | `scripts/backend-frontend-seam-baseline.json:11-198`，每条就是一个字符串 |
| 唯一能放散文的是 `note` 一个字段 | 同上 `:3` |
| `--update` 把 `note` **写死成罐头** | `scripts/check-backend-frontend-seam.mjs:867-876` `writeBaseline()` 里 `note: BASELINE_NOTE`（`:860-865` 的常量），**不读旧值** |
| 当前 `note` = 罐头 **237** 字 + 手写记账 **741** 字 | 手写部分是 WO-R2（+9 条 ontology/interfaces 与 plan-builders）与 WO-R6（`actions/metrics` 挂账）两笔**可评审的显式记账** |
| 它至今没被抹，纯属侥幸 | 文件里 `generatedBy` 已经是 `--update` —— 说明手写是在**最后一次 `--update` 之后**补的 |
| **⚠️ 这枪本单当场击发过（不是预测，是实测）** | 本单接完 logout 后按派单要求跑 `--update` 收紧基线，实测 `note` **978 → 237 字**（741 字 WO-R2/WO-R6 记账当场归零）。本单**手工逐字节还原**（还原后 `note === 快照` 为 `true`），最终 `git diff` 只剩 **1 行删除**（`POST /a/v1/auth/logout`）。**下一个跑 `--update` 的人如果不知道这件事，那 741 字就没了** |

形态照铁律 0.6 句式：
> **「我用『把理由写进基线』当作『理由被保存下来了』的证据，而前者并不度量后者 —— 那个字段是脚本的输出位，不是人的输入位。」**

**建议**（同样属门的当值单，本单不改）：
1. `writeBaseline()` **保留旧 `note`**（读旧值、罐头只在文件不存在时用），或把罐头挪到独立字段
   （如 `schemaNote`），把 `note` 留给人。
2. 更彻底：把 `endpoints` 从 `string[]` 升成 `{ key, why? }[]`（读侧兼容旧的纯字符串），
   让 `why` 有**每条**的落点 —— 这才是派单那句话真正需要的东西。
3. **在此之前，一切 `why` 写进 `docs/`**（本文件即是），因为 `docs/` 不会被任何脚本覆盖。
4. **在修好之前，跑 `--update` 必须配一次「存快照 → 跑 → 还原 `note` → 核对只删不增」**
   —— 本单就是这么做的（见上表最后一行）。

**本单对该文件的改动 = 恰好 1 行删除**（`POST /a/v1/auth/logout` 接上了，按棘轮摘掉），
`note` 与 `sseFields` 逐字节不变。

复验：

```bash
node -e '
const fs=require("fs");
const g=fs.readFileSync("scripts/check-backend-frontend-seam.mjs","utf8");
const b=JSON.parse(fs.readFileSync("scripts/backend-frontend-seam-baseline.json","utf8"));
const wb=/function writeBaseline\([\s\S]*?\n\}/.exec(g)[0];
console.log("writeBaseline 写死 note:", /note:\s*BASELINE_NOTE/.test(wb));
console.log("endpoints 全是字符串（无 why 槽位）:", b.endpoints.every(e=>typeof e==="string"));
console.log("generatedBy:", b.generatedBy, "· note 长度:", b.note.length);'
```

---

## 6 · 本单实接的 1 条：`POST /a/v1/auth/logout`

### 为什么只接这一条

其余高性价比候选（#8 模版下载 · #17 信号引用 · #25/#26 分段重试 · #27 功能审计 · #44 solvers MCP）
**全都要新增一块可见面**（新面板 / 新分栏 / 新按钮组），属界面信息架构决策。
基线注（WO-R6 `actions/metrics`）已立先例：**「加哪个页 / 放进哪个导航组」属仓主决策，收编方不得擅自决定**；
且「只加 `api/endpoints.ts` 的客户端函数而不给消费方 = 把一个死端点换成一个死客户端函数，纯为消红」。

而 logout 这条**不新增任何界面**：按钮早就在（`pages/ShellLayout.tsx:598` `data-testid="logout-btn"`），
缺的只是它按下去时**没有告诉服务端**。这是**修正既有行为**，不是**开辟新面**。

### 病灶（三跳 · 逐跳 file:line）

```
pages/ShellLayout.tsx:600         onClick → logoutSession()
  └─ store/authSession.ts:18-21   logoutSession(){ tokenStore.clear(); clearAccountState(); }
       └─ 只动浏览器内存：tokenStore(accessToken) + queryClient.clear() + sessionStore.reset()
          ✗ 从不发任何请求
反面证据：refresh_token 是 httpOnly cookie（datacore app.ts:1091 clearCookie path=/a/v1/auth）
  └─ api/apiClient.ts:41-62 silentRefresh() 用 credentials:"include" POST /a/v1/auth/refresh
     ⇒ 「退出登录」后该 cookie 仍在 ⇒ 任意一次 401 重试即可换回新 accessToken
```

### 改法

- `apps/frontend-shell/src/api/endpoints.ts` 加 `logout()` → `POST /a/v1/auth/logout`；
- `apps/frontend-shell/src/store/authSession.ts:logoutSession()` 先**发出**登出请求再清本地态
  —— 顺序不可反：先清 token 不影响本请求（该路由在 `PUBLIC_PATHS` 里、认的是 cookie 不是 Bearer），
  但**必须不阻塞本地清理**：网络失败时本地仍要登出（否则断网就退不出去，比不调更糟）。

### 接缝测试与变异反证

`apps/frontend-shell/test/befe-g-logout.seam.test.tsx` —— 真 route + 真 `endpoints.ts` +
MSW 拦**真实 URL**（不 `vi.mock("@/api/endpoints")`，那会把病灶那一跳一起 mock 掉）。
变异反证记录见该文件顶注。

---

## 7 · 复验命令

### 7.1 分诊台账的三重对账（机器先说话）

分诊结论的计数不靠人数，靠三条机器对账：
① 台账每条**必须**在门的缺口清单里（不许分诊一个不存在的端点）；
② 门筛出的本组每条**必须**被分诊（不许漏）；③ 不许重复分诊。
实跑结果：`58 = 51 + 5 + 0 + 2`，三条全平。

```bash
# 复现本组 58 条（门实跑筛，非读基线）
node scripts/check-backend-frontend-seam.mjs --verbose 2>&1 \
  | sed -n '/当前零调用端点明细/,$p' | tail -n +2 | sed 's/^  //' > /tmp/gaps.txt
node -e 'const fs=require("fs");
 const s=e=>(/^\/(?:a|b|api)\/v1\/([^/*]+)/.exec(e.split(" ")[1]||"")||[])[1];
 const TAKEN=["ontology","ontology-workflows","slices","meta","action-drafts","ops","scheduler","calendars",
  "agents","skills","workflows","queries","mcp-configs","prompt-templates","org","causal-graphs","growth",
  "scenarios","solvers","opt","sim","databuilder","catalog","llm","llm-budgets","kb","resources"];
 const mine=fs.readFileSync("/tmp/gaps.txt","utf8").trim().split("\n")
   .map(l=>l.split("  ←  ")[0].trim()).filter(e=>!TAKEN.includes(s(e)));
 console.log(mine.length); mine.forEach(x=>console.log(" ",x));'
```

### 7.2 门本体（显式捕获退出码）

```bash
out=$(node scripts/check-backend-frontend-seam.mjs --verbose 2>&1); rc=$?; echo "RC=$rc"
```

### 7.3 §5 假阴性的最小复现

```bash
node -e 'const RE=/^\/[ab]\/v1\/(healthz|readyz|metrics)$/; console.log("/a/v1/metrics =>", RE.test("/a/v1/metrics"))'   # true
grep -n 'app.get("/a/v1/metrics"' apps/datacore/src/app.ts                                                              # :3529 业务端点
grep -rn "/a/v1/metrics" apps/frontend-shell/src --include=*.ts --include=*.tsx | grep -v /mocks/ | wc -l               # 0
```

### 7.4 §6 接线的接缝测试

```bash
out=$(pnpm --filter frontend-shell exec vitest run test/befe-g-logout.seam.test.tsx 2>&1); rc=$?; echo "RC=$rc"
```

---

## 8 · 本体引用与影响

- **断点**：`G-BE-FE-SEAM-DEAD`（本体 §8）—— 本文件是它在长尾域的逐条取证。
- **门**：`befe-seam:check`（本体 §7）—— §5 指出其 `ROUTE_EXEMPTIONS` 有一条**假阴性**，
  修法与记账办法已给；**本单不改门**（门在当值单手里，避免撞车）。
- **不变量**：R2（tenant everywhere）与 R3（entitlement 先于 authz）在本组多条端点上**已实现**
  （`records/materialize` · `ceo/dataset/generate` · `process-instances` 均先判 entitlement 再判角色）；
  本单未改变任何不变量。
- **对象类型 / 链路 / 事件**：本单只加了一处前端调用（logout），不新增对象类型、链路或事件，
  也不改变任何门禁 ⇒ **无需回写** `docs/SYSTEM-ONTOLOGY.md` 的 §2/§3/§4。
  §5 的门判据建议若被采纳（摘豁免 + 加金丝雀），**那时**需回写本体 §7 的门条目。
