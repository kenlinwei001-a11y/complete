# WO-ROUTING-RETRIEVAL-FIRST · 检索前置：把路由决定权从正则手里交还给检索层

> **一句话病根**：查询路由由分散在 4 个文件、互不知情的 **10 道正则门"抢答"**完成，全部排在
> 语义检索（DRIL·确定性·不调 LLM）与意图分类器**之前**。任何一道门认得问句里半个词就 `return`，
> 检索层与分类器被永久架空 —— **系统里最会选型的两个组件，排在最不会选型的组件后面。**

---

## 🚦 范围边界（本单 dev 只碰这些文件）

**允许改**

```
apps/agentcore/src/router/orchestrator.ts      路由主管线（10 道门的编排顺序）
apps/agentcore/src/router/coordinator.ts       多角色会诊门 + 其关键词表
apps/agentcore/src/router/domain-resolver.ts   域解析关键词表
apps/agentcore/src/router/ceo-route.ts         CEO/free-LLM 判定（含 24 字长度门）
apps/agentcore/src/agent/sim-planner.ts        定式题识别词表
apps/agentcore/src/dril/*.ts                   检索层（打分/投影/注册表）
apps/agentcore/src/tools/registry.ts           仅限：discover 补 intents kind
apps/agentcore/src/metrics.ts                  仅限：新增 routeSource 计数
apps/agentcore/test/**                         测试与接缝门
scripts/check-*.mjs                            新增词表一致性门
docs/SYSTEM-ONTOLOGY.md                        §3/§7/§8 回写（强制）
```

**禁止碰**

```
apps/datacore/**            本单纯 AgentCore 路由层，不跨系统
packages/contracts/**       不改契约（若发现必须改 → 停单回报，不自行扩契约）
proceedWithIntent / fillSlots / plan 执行段    ← 全链唯一没病的一段，一行不动
意图池播种 / 生长回路                          ← 另立单（见下"已知但不在本单"）
任何 pi 相关                                   ← #85 治理边界·仓主未决策不得开工
```

---

## 一 · 证据链（全部为本会话实测，均可复跑）

| # | 结论 | 取证方式 |
|---|---|---|
| **E1** | 同一道产能可行性题，**只换动词**就换路由：说「接」→ `deterministic:ceo-route` 秒答；说「交付」→ `coordinator` 三角色串行 203 s 无答案。**加不加「常州基地」、问句长短均无影响** | 2×2 正交归属取证，真编排器 HTTP 路由 |
| **E2** | 两张词表对同一个词判断相反：`coordinator.ts:34 DELIVERY_RISK_RE=/(交付\|按时交\|能不能交\|交期)/` 认领它；`sim-planner.ts:215 FEASIBILITY_ACCEPT_RE` 13 个词条全「接」族、认不出它 → `coordinator.ts:84` 那道**专为此题写的**护栏静默失效 | 源码 + 变异反证 |
| **E3** | 分类器是**第 11 站**，前面有 10 个 `return` 出口，全部为正则/关键词判断，零 LLM 参与 | `orchestrator.ts` runPipeline 出口枚举 |
| **E4** | 分类器对该问句**完全正确**：`capacity_feasibility@0.95` + 四槽全对（`{model,demandDelta,weeks,base}`）；耗时 13.4 / 14.6 / 17.5 s（三跑·已强制非推理档） | 真 LLM 探针，与生产 catalog 逐字节同构 |
| **E5** | 203 s 拆解：60059 + 82842 + 60025 = **202,926 ms** ≈ 总时长 → 三角色**串行**（`workflow/executor.ts:104` 为 `for…await`，循环体内无 `Promise.all`）；其中两段精确等于 `QOS_AGENT_LLM_TIMEOUT_MS=60000`（首轮 LLM 超时·一个工具都没调）；有效计算 `invoke_solver` **527 ms = 0.26 %** | 截屏时延 + 源码 |
| **E6** | **DRIL 检索全程不调 LLM**（`grep "llm\.\|classify(\|LlmClient" src/dril/*.ts` 零命中），确定性 R6（同 query 同注册表字节级同序），覆盖求解器/切片/规则/技能/工作流/Agent/**意图** 七类 —— 但**路由层零使用**，只在 path-B 内部给 agent 塞资源包 | 源码 |
| **E7** | `discover` 的 kind 枚举 `["object_types","slices","solvers","mcp_tools"]` —— **无 `intents`**；而 agent 系统提示语原话是「不确定用什么时先调本工具」→ agent 按提示发现能力时看不到意图池 | `tools/registry.ts:14` |
| **E8** | 意图池是**死目录**：播种按 id 幂等（代码改了种子，已有库永不更新）；`updateIntent` 仅允许改 DRAFT（已发布的改一下 409）；生长回路 `growth/probe.ts` 只产 `NO_INTENT` finding，全仓 `intents.insert` 调用点里没有它 —— **只报缺口，从不建意图** | 源码三处 |

**病根不是「少了一个词」。** 补一个词是我已交付的补丁（见"已完成"）。病根是**决策次序**：
E4 证明最会选型的组件判得对，E3 证明它排在第 11 位，E6 证明还有一个更快更全的检索层被完全架空，
E1/E2 证明抢在前面的那些门靠词法猜、而且互相矛盾。**同义词打地鼠永远打不完，因为架构在鼓励它。**

---

## 二 · 本体引用与影响

**触及对象类型**（§2.H 交互/编排域）：`Intent` · `ExecutionPlan` · `ScenarioPackage` · `QueryTask` ·
`NavigationSlice` · `AgentDefinition`；（§2.E）`Solver`；（§2.G）`FeatureFlag`。

**触及链路**（§3 编排链）：`Query → 候选收窄 → [10 道确定性门] → classify → τ 决策 → proceedWithIntent →
fillSlots → plan 步（resolve_slice → invoke_solver → evaluate_rules → render_answer）`。
本单**只改方框内那一段的次序与判据**，右侧 `proceedWithIntent` 之后一行不动。

**触及事件**（§4）：`routing.completed` · `coordinator.planned` · `routing.degraded` · `step.started/completed`。
新增诉求：`routing.completed` 载荷补 `routeSource`（哪道门做的决定）——**不新增事件名**（守 QOS-PRD §8.2）。

**不变量核对**（§5）：

| 不变量 | 本单影响 | 处置 |
|---|---|---|
| R2 tenant_id everywhere | DRIL 注册表已按租户投影 | 不变，测试须覆盖跨租户不串 |
| R3 Entitlement 先于 authz | 检索前置后，未开通资源**不得**出现在候选 | `resource-registry.ts:186` 已按 `intentAllowed` 过滤 —— 须加断言锁死 |
| R6 确定性 | DRIL 无 LLM、无时钟、无随机 → 同输入同序 | **本单最强资产**：正则换检索不损失确定性 |
| R7 错误信封 | 不变 | — |
| R13 结论可溯源 | 路由改道后仍须 ⟦ref⟧ 链完整 | 现有 provenance 断言须全绿 |

**断点（§8）**：本单**新登记两条**，并关闭/降级既有两条。

```
| G-ROUTE-REGEX-PREEMPTS-RETRIEVAL | 确定性正则门抢在语义检索/分类器之前做路由决定，
  分散 4 文件互不知情、判据互相矛盾；检索层（DRIL·无 LLM·确定性·覆盖含意图 7 类资源）
  被架空只用于 path-B 内部 | Query→候选收窄→[10 门]→classify | 🔴 未修（本单 Track A 治）|

| G-TIMEOUT-AS-VERDICT | 超时被当作**判决**（abort→降级）而非**信号**（触发诊断）：
  「慢」与「坏」处置相同；全部现场证据压成一个枚举 degraded:{reason:"TIMEOUT"}，
  不留 modelId / 是否推理档 / 输入规模 / provider 当时健康度 → 事后只能靠人对时延手工反推。
  加剧因素：LLM 调用非流式，拿不到 first-token，无法区分挂死与慢但活着
  | runAgentLoop 单次 LLM 调用 deadline（loop.ts:772） | 🔴 未修（本单 Track B3 治）|
```

- 关联既有断点 `G-AGENT-BLIND-REACT`（路由侧那一半正是本单）；
- 本单落地后，`orchestrator.ts:618-621` 注释里自陈的「**长≠开放**」问题（24 字长度门把说得清楚的问句判成开放深问）自然消解，无需再靠 L2 真分解暗发功能兜。

> **本体回写是本单交付物之一**，不是可选项：§3 链路次序改了、§4 载荷加了 `routeSource`、§8 新增断点 —— 三处都必须回写，漏写即退单。

---

## 三 · Track A｜路由架构（分期·Phase 0 是硬门槛）

### Phase 0 · 先量后改（**不改一行生产代码**·不达标则整个 Track A 停单）

**为什么必须有这一期**：本仓反复吃亏的模式是「把一个没考过试的组件放到最关键的位置」。
DRIL 今天只用于给 agent 塞资源包，**从未作为路由主判据被考核过**。直接前置 = 用一个未知准确率的
组件替换一个已知有病的组件，那是换病不是治病。

**做什么**

1. 造金标集 `apps/agentcore/test/fixtures/routing-goldset.ts`：
   - 现有 20 场景的注册例句（各取 3 句）
   - 本会话 2×2 四句变体（接/交付 × 有无基地）
   - 同义词扩展：交货 / 出货 / 供得上 / 来不来得及 / 吃不吃得下
   - **真开放题负例**（"综合分析连锁影响给整体结论"类）—— 检索**不该**命中，命中即误判
   - 每条标注：期望 intentKey（或 `OPEN` = 应落探索）
2. 跑 DRIL 检索（`retrieve_knowledge` 同一入口），量：
   - **top-1 意图准确率** / top-3 覆盖率
   - **误判率**：真开放题被判成定式意图的比例（这个比 top-1 更致命）
   - 单次检索耗时（毫秒级预期，须实测证实）
3. 产出 `docs/REPORT-dril-routing-recall.md`（数字 + 逐条明细 + 失败样本分析）

**放行判据（达不到就停单回报，不许"差不多先上"）**

| 指标 | 门槛 | 理由 |
|---|---|---|
| top-1 意图准确率 | **≥ 90 %** | 低于此则前置检索会比今天的正则更常判错 |
| 真开放题误判率 | **≤ 2 %** | 把开放题误判成窄意图 = 自信错答，比慢更糟 |
| 单次检索耗时 P95 | **≤ 200 ms** | 超过则失去"比正则门更划算"的立论基础 |
| 确定性 | 同 query 连跑 3 次**字节级同序** | R6 硬要求 |

> Phase 0 交付即可独立评审。**不达标不是失败，是省下了后面三期的返工** —— 届时选项是
> 改 DRIL 打分权重、或补意图样例、或换方案，都由仓主决策。

### Phase 1 · 观测先行（低风险·可与 Phase 0 并行）

给 10 道门每一道加 `routeSource` 标签，计入 `routing.completed` 载荷 + metrics 计数器。
**先看真实流量里每道门各吃掉多少请求、其中多少本可由检索命中**。没有这份数据，
后面"哪些门该降级成白名单"就只能拍脑袋。

### Phase 2 · 正则门降级为白名单（不改次序·先去毒）

把「认得半个词就拦截」改成「**显式白名单才短路**」：每道门必须声明它精确接管哪一类问句，
判据不满足即放行下游。本期**不动次序**，只把拦截面从"模糊匹配"收窄到"精确声明"，
风险最低、收益立竿见影（E1 类事故整类消失）。

配套门：`scripts/check-router-vocab-consistency.mjs` —— 跨 4 个文件的词表做一致性校验，
任一表新增词条而其对偶表未同步 → 红。（本单已交付的 `deliver-verb-seam.test.ts` ② 是这道门的雏形，本期推广到全部词表对。）

### Phase 3 · 检索前置（Phase 0 达标方可开工）

```
query
 └─ ① DRIL 检索（确定性·无 LLM·毫秒级）→ 跨意图/求解器/切片/规则 打分排序
     ├─ top1 高分 ∧ 槽可填 ─────────► 直走预设流程（复用今日 proceedWithIntent·一行不改）
     ├─ 有候选但分不开 / 槽填不满 ──► ② 分类器（吃 DRIL **收窄后**的小目录，不再整段塞全表）
     │                                 └─ τ 分流：高置信→预设 / 中→澄清 / 低→③
     └─ 零候选（真开放题）──────────► ③ agent 探索
 白名单正则 → 降级为①之前的加速缓存（命中即跳过①，未命中一律进①）
```

**附带修掉的扩展性病**：今天是把**全部**候选意图整段拼成 catalog 字符串塞进分类器 prompt
（`orchestrator.ts:1117-1122`）。20 个意图塞得下，200 个塞不下。检索前置天然解决。

### Phase 4 · 收口

- `discover` 补 `intents` kind（E7）—— 让 agent 在探索态也看得见意图池
- agent 探索段的**强制序**：本体 → 求解器 → 查库填槽（今天是自由 ReAct 靠 prompt 劝）
- 本体 §3/§4/§8 回写

---

## 四 · Track B｜探索成本（**独立于 Track A·不依赖 Phase 0·可先落地**）

E5 证明：即便路由判错，203 s 这个代价本身也是不该付的。两条低风险高收益：

| # | 改动 | 预期 | 风险 | 判据 |
|---|---|---|---|---|
| **B1** | Coordinator 角色扇出**并行**（`workflow/executor.ts` 对 `invoke_agent` 步支持并发；各角色本就独立、scope 已隔离） | 203 s → **≈ 83 s**（取最慢一路） | 低 | 须证：预算 `BudgetTracker` 并发安全、事件流顺序稳定、各角色 scope 越界仍被拒 |
| **B2** | **agent 用途也避开推理档**（今天只有 classifier 传 `forceNonReasoning`，见 `providers.ts:446`；机制现成 `effectiveModelId` 已支持） | 首轮不再撞 60 s 上限 | 低 | 须**实测**非推理档下 agent 首轮时延，不许只改不量 |
| B4 | 首轮不注入全部 30 个工具 schema，按 DRIL 预选裁剪 | 降输入 token → 降首轮时延 | 中·DRIL 漏选会让 agent 无工具可用 | 依赖 Phase 0 的 DRIL 质量数据 |

**B1/B2 建议先做**（不依赖任何未决策事项）；B4 等 Phase 0 数据。

### B3 · 超时是**信号**不是**判决**（本节由仓主指正后重写）

**范畴错误**：今天 `loop.ts:772` 超时即 abort → 降级收尾，全部现场证据压成一个枚举
`degraded:{reason:"TIMEOUT"}` + 一句"单次调用超出有界时限"。**「慢」与「坏」被当成同一件事处理**，
而它们的正确处置完全不同。E5 那 203 s 就是代价：两个角色 agent 各烧 60 s，
**产出为零，且不告诉任何人为什么** —— 该诊断最后是靠人对着截屏时延手工反推出来的，本该系统自产。

**硬约束（先说清，免得设计跑偏）**：全仓 LLM 调用**非流式**
（`grep stream packages/llm-adapters/src apps/agentcore/src/llm` 零命中，排除前端 SSE）。
所以**今天拿不到 first-token 时延**，无法靠"有无 token 流入"区分挂死与慢。探针必须绕开这一点。

**同样要说清的边界**：有界终止（G-9）本身是对的，它防的是无限空转。本节**不是取消上界**，
是"上界触发时**先诊断再决定**"；任何延长都必须有硬上限且计入总预算，否则等于拆掉有界终止。

| 子项 | 做什么 | 依赖 | 风险 |
|---|---|---|---|
| **B3-a 现场取证包**（先做·零新机制） | 超时事件载荷从 1 个枚举扩成一份现场快照：`modelId` · 是否推理档 · 输入 token 估算 · 本轮序号 / 已完成轮数 · 已调工具数 · **该 provider 本任务内已成功调用的时延分布** | 无——全是已有的量，只是没记 | 极低。纯观测，不改行为 |
| **B3-b provider 健康探针** | 超时触发时并发打一个极小请求（`max_tokens=1`）到同 provider 量往返：**ping 也慢 → provider 侧（排队/限流）；ping 快 → 本请求自身（输入大 / 推理链长）** | B3-a | 低。一次极小请求的成本可忽略 |
| **B3-c 据诊断分流**（而非一律 kill） | · provider 慢 → 换非推理档兄弟 / 备用 provider **重试一次**<br>· 输入过大 → 裁剪工具集/上下文**重试一次**<br>· 本请求慢但 provider 健康 → **延长一次** deadline（硬上限 + 计入预算）<br>· 无法分类 → **走今天的降级**（保底行为逐字节不变） | B3-a/b | 中。每条分流都须有对应测试；"无法分类"必须回落既有行为 |
| **B3-d 接流式**（较大·单列） | `llm-adapters` 支持 streaming → 拿到 first-token 时延，真正区分"挂死"与"慢但活着"；顺带给前端真进度条 | 独立 | 中。触及共享适配器层，影响面超出 agentcore |

**B3 与 B2 是互补不是重复**：若 B3-a/b 早已存在，那 203 s 现场会直接报出
「首轮 60 s 零产出 · provider ping 正常 · 模型为推理档 · 输入 token 正常」——
**指向的处置恰好就是 B2**（换非推理档）。探针的价值不在于救这一次，在于让下一次不用人来反推。

**验收判据**：造一个可控慢 provider（stub 延迟可编），断言四条分流各自走对分支，
且"无法分类"分支的行为与今日**逐字节一致**（零回归）。只测"超时被记下来"不算过 —— 那是运输层断言。

---

## 五 · SEAM-GATE 验收判据（头号复验依据）

不接受"各半 unit 绿"。必须有一条**驱动接缝**的组合测试，在集成态断言端到端行为：

1. **同义词矩阵 × 上下文矩阵**：`{接, 交付, 交货, 出货, 供得上, 来不来得及}` × `{有基地, 无基地}` ×
   `{有 PageContext, 无 PageContext}` —— **全部**落同一条确定性路由，`path ≠ AGENT` 且 agent 往返 = 0。
2. **词表一致性不变量**：任一路由词表新增词条而对偶表未同步 → **自动变红**（不靠人记得去改）。
3. **诚实边界三条不许误伤**：真开放会诊题仍召集多角色；用户显式要"综合分析/会诊"仍让位；
   单订单重排（SO-号 + 重排/提前）不被误吞。
4. **变异反证**：每条修复须能被"打掉实现→测试变红"证明，且须先证 `tsc --noEmit` RC=0（否则红是编译红）。
5. **四包全绿**：`pnpm -r build && pnpm -r --workspace-concurrency=1 test`（datacore 勿并发多 vitest）。
6. **门必须显式捕获退出码**：一律走 `bash scripts/gate.sh`；失败须打印 `error TS|FAIL|AssertionError`
   原文，**禁止** `cmd | tail -n` 把错误挤掉（本会话刚在 WO-80 的包装脚本上真实踩过）。

---

## 六 · 已完成（本单立项前的补丁·已验证·勿重复做）

针对 E1/E2 的**症状**已修并通过验证，作为本单的既有基线：

- `sim-planner.ts` — 护栏补「交」族词条 + **结构信号兜底**（型号增量% ∧ 周数齐备即认，与动词无关）
- `orchestrator.ts` — L2 / free-LLM 两道慢路对定式产能题让位
- `coordinator.ts` — 导出 `DELIVERY_RISK_RE` 供接缝门单源消费
- `deliver-verb-seam.test.ts`（6 条）— 含 2×2 效果层 + 接缝不变量 + 三条诚实边界
- 验证：`tsc --noEmit` RC=0；变异 M1（打掉词表+兜底）→ ①②③红④⑤⑥绿；变异 M2（打掉让位守卫）→ ①红其余绿；
  agentcore 全量 **139 文件 / 791 passed / 1 skipped / 0 failed**

> **这是补丁不是治本**：它让「交付」这一类问句活了下来，但没有改变"正则抢答"这个结构。
> 下一个同义词、下一张词表，仍会重演。本单治的是那个结构。

---

## 七 · 已知但**不在本单**（各自另立单·勿夹带）

| 项 | 内容 | 为何不在本单 |
|---|---|---|
| 意图池是死目录（E8） | 播种按 id 幂等永不更新 · PUT 仅限 DRAFT · 生长回路只报不写 | 属"意图生命周期"域，与路由次序正交；且触及部署/迁移 |
| 部署库意图版本可能落后 | 若库首次播种早于 `base` 槽加入，那份意图永久缺槽且因已 PUBLISHED 连 PUT 都改不了 | 同上。**须先查实**再立单（本会话无法访问部署库） |
| WO-80 五包 gate 未过 | `Test Files 1 failed / Tests 0 failed` = 套件级错误；日志被 tail 挤掉失败文件名 | 与本单无关，独立处置 |

---

## 八 · 交付物清单

1. `docs/REPORT-dril-routing-recall.md`（Phase 0·含金标集与逐条明细）
2. `apps/agentcore/test/fixtures/routing-goldset.ts`
3. `scripts/check-router-vocab-consistency.mjs` + 纳入 `package.json` gates 串
4. Phase 2/3 的路由改动 + SEAM 组合测试
5. Track B 的 B1/B2 改动 + 时延**实测**数字（不许只改不量）
6. **`docs/SYSTEM-ONTOLOGY.md` 回写**：§3 链路次序 · §4 `routing.completed` 载荷补 `routeSource` ·
   §8 新增 `G-ROUTE-REGEX-PREEMPTS-RETRIEVAL` 并在闭合时改状态
7. 金值/注册即更：新增 gate → 同步 gates 串计数；路由改动若动 demo-chain/catalog 金值 → 同步更新
