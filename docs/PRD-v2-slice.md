# PRD-v2 · 本体切片（统一版 · 对齐实测）

> 2026-08-10 · 分支 `claude/handoff-prd-v2-slice` · 基线 canonical `origin/claude/inspiring-gates-aqczjg`（`282b8239`）
>
> **本文合并并取代**以下五份切片相关文档的**判断部分**（史料部分保留，不删原文）：
> `docs/PRD-A3-multihop-slice-completion.md` · `docs/IMPLEMENTATION-phase1-4-slice-rules.md` ·
> `docs/SLICE-order-fulfillment-360.md` · `docs/PRD-agent-navigation-slice-latency.md` ·
> `docs/ONTOLOGY-SLICE-GAPS.md`（后者是门产物，不是条款，只作为连通性证据引用）。
> 十六层两套的对账**不重做**，直接采信 `docs/RECONCILE-slice-16-layers-two-sets.md`（分支 `claude/handoff-wo-slice16-reconcile`），本文只出**裁决建议**（§2.5）。
>
> **本文只写文档，不改任何生产代码 / 本体 / 门 / 前端。**
> 首屏空卡那条缺陷由 `WO-SLICE-DEFAULT-ARGS` 另单在修，本文只把它当**证据**引用，不给修法。

---

## §0 · 取证方法与金丝雀（铁律 0.5 / 0.6 的前置自证）

本文所有「实测」二字都指下面这**两台真跑起来的服务**（DataCore 4051 + AgentCore 4052），不是读代码猜：

```bash
pnpm --filter @platform/contracts build
pnpm --filter @platform/llm-adapters build      # ⚠ 不先建这个，datacore build 会报
                                                #   "Cannot find module '@platform/llm-adapters'"（与本单无关的假红）
pnpm --filter datacore build && pnpm --filter agentcore build
PORT=4051 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 \
  CREDENTIAL_KEY=$(printf '%064d' 1) node apps/datacore/dist/server.js
PORT=4052 DATACORE_BASE_URL=http://127.0.0.1:4051 node apps/agentcore/dist/main.js
# 全部探针一律带：-H 'X-Debug-User: demo:admin:admin|planner|catalog_admin'
```

**双服务都起了才算数**：本文有三条结论只有把 AgentCore 也起起来、**亲手把那条链跑一遍**才成立
（§2.3 的工作流失败、§1.1③ 的资源目录 2 条、§3-T1 的检索召回）——「我 grep 了」不是复验。

**否定结论的金丝雀（铁律 0.6：报「0 命中 / 不存在 / 零调用方」前必须先证工具是对的）**

| 本文要报的否定结论 | 检索 | 结果 | 金丝雀（同工具同路径·已知必中） | 判定 |
|---|---|---|---|---|
| 出厂 Skill 没有一条 `kind:"slice"` 的引用 | 真跑 `GET /b/v1/skills` 逐条读 `references` | **0/7**（全是 `solver:`/`rule:`/`workflow:`/`skill:`） | 同一次读到 `sop_meeting.references=["workflow:sop_balance_wf"]`、`capacity_action_draft.dependsOn=[{skill:capacity_analysis}]` | ✅ 读到的确实是引用字段 |
| `navigation-slice.ts` 零行读本体切片 | `grep -n "slice-index\|SliceSpec\|sliceKey\|resolve_slice" apps/agentcore/src/agent/navigation-slice.ts` | **0** | 同文件 `grep -c "SOLVER_CATALOG"` → **8** | ✅ 工具正常 ⇒ 0 是真 0 |
| 生产种子里没有 `kind:"slice"` 的 Skill 引用 | `grep -n 'kind: "slice"' apps/agentcore/src/mocks/seed.ts` | **0** | 同文件 `grep -c 'kind: "workflow"'` → **1** | ✅ 工具正常 |
| 98 条 SliceSpec 全部没有 `spec.description` | 逐条 `GET /a/v1/ontology/slices/{key}` 读 `spec.description` | **0/98** | 同一次读同一条 `order_fulfillment_360` → `root.typeKey=Order` · `paths=4` · `contractFixtures=1` | ✅ 读到的确实是 spec |
| 切片契约 fixture 从不走一等规则 | `grep -rn "ruleRef" apps/datacore/src`（排除 `solvers/capacity.ts:604` 的同名无关字段） | 生产种子 **0** | `grep -c "contractFixtures" apps/datacore/src/synthetic/battery.ts` → **4** | ✅ 工具正常 |
| `docs/SYSTEM-ONTOLOGY.md` 上无 `G-SLICE16-TWO-VOCABS` | `grep -c` 于 canonical 的本体 | **0** | 同文件 `grep -c "G-SLICE-16LAYER-PROJECTION"` → **3** | ✅ 工具正常（该断点在 reconcile 分支上，未并 canonical） |

**踩过的坑，就地留证（免得下一个人重踩）**：

1. ⚠️ 首轮探针我用 `POST /a/v1/slices/model_capacity_network/resolve` 不带参，拿到 `400 VALIDATION_ERROR`，
   **差一步就要写成「生产计划引用了不存在的切片」**。照铁律 0.5 再追一层 —— 那是**旧内置解析器**
   （`apps/datacore/src/ontology.ts:624 (resolveSlice)`），它 `modelId required` 先抛 400。
   补上真参数 `{"modelId":"2170-NCM"}` → **HTTP 200**，返回 `model/bases/edges`。
   **「参数不对」和「东西不存在」是两个命题。**
2. ⚠️ `GET /a/v1/ontology/slices` 返回的是**裸数组**不是 `{items:[…]}`。按 `json.items` 读会得到 `0`，
   于是「98 条切片一条都没有」这种反向结论会当场成立。判据：先打印 `Array.isArray(j)`。

---

## §1 · 一页纸 · 本体切片今天为推演贡献什么（如实写）

**一句话：切片**已经**在推演链上，但它今天主要是「取证与可视」，只有一条路让它真参与算数；而用户以为的那份「Agent 推演时读的本体视图」，Agent 读的其实不是它。**

### 1.1 四个真实落点（全部有非 test 调用方）

| # | 落点 | 谁在调 | 它让平台多推演出什么 | 定性 |
|---|---|---|---|---|
| ① | **Path-A 执行计划的取证跳** `resolve_slice` | `apps/agentcore/src/workflow/executor.ts:131`（dispatch）· `:184 (collectSliceObjects)` ← 生产种子计划 `apps/agentcore/src/mocks/seed.ts:266/331`（`main.ts:26 → ensureScenarioPackageSeed → seedIntentsAndPlans`） | 产出 **ValidationTrace**：切片对象类型进一致性检查（`executor.ts:596` `ENTITY_DEFINED`）、切片对象标量属性反向核对知识图谱（`executor.ts:623` `crossValidate`） | **已实现且在生产链路上**。但**切片结果不进求解器入参**（同计划 `s2` 的 args 里没有任何 `{{steps.s1…}}`，`seed.ts:266-280`）⇒ 它贡献的是**可信度**，不是**结论** |
| ② | **`ontology_query` 薄层遍历求解器** | `apps/datacore/src/solvers/service.ts:1156-1157`（装配 `executeSlice` 进 `QueryEngineDeps`）→ `apps/datacore/src/ontology/query-engine.ts:198` | **唯一一条切片真参与算数的路**。实测 `rootType=Order --order_of_customer--> Customer, count` → `{"Customer.count(custName)":8}`，且逐行带 `provenance{typeKey,objId,linkPath}` | **已实现且在生产链路上**（求解器注册表实测 59 条，含 `ontology_query`） |
| ③ | **Agent 的「能发现的切片」供给侧** | `apps/agentcore/src/dril/resource-registry.ts:109 → :182 (projectSlices)` ← `apps/datacore/src/catalog.ts:284` | 让 Agent 在 discover 时看得见「有哪些切片可用」 | **接了线没数据**：双服务实测 `GET /b/v1/resources` 总资源 **1055** 条，其中 `kind=slice` 恰 **2** 条（`base_risk_profile` / `model_capacity_network`，硬编码于 `catalog.ts:47 (BUILTIN_SLICE_CATALOG)`）。98 条 SliceSpec **一条都进不去**（门槛是 `spec.description` 非空，实测 0/98） |
| ④ | **管理台可视** | `apps/frontend-shell/src/App.tsx:174/175`（`/admin/slices` · `/admin/slice-library`）· `SliceInspector.tsx:95` 内联十六层面板 | 让人看见切片长什么样 | **已实现且在生产链路上**（但首屏默认路径出空卡，见 §2.3） |

### 1.2 三个「用户以为有、实测不是」的地方

- **「导航切片」不是本体切片 —— 同名不同物。**
  `apps/agentcore/src/agent/navigation-slice.ts:283 (projectNavigationSlice)`（非 test 调用方：`router/orchestrator.ts:1893` · `engine.ts:417`）
  是 AgentCore 里一张**硬编码求解器目录**（`SOLVER_CATALOG`，8 处）按问句正则投影出来的地图。
  金丝雀背书的实测：该文件对 `SliceSpec` / `sliceKey` / `slice-index` / `resolve_slice` **零命中**。
  ⇒ `docs/PRD-agent-navigation-slice-latency.md:53` 写的「复用既有：`ontology/slice-index` 切片」**没有按这个写法落地**。
  它不是没做（提速那半确实做了），是**做成了另一个东西**，且和本体切片同名。

- **十六层的 ①业务场景 / ②决策意图 恒空，缺的是上报方不是切片。**
  实测 `GET /a/v1/ontology/slices/order_fulfillment_360/references` → `{"refs":[],"total":0}`。
  与本体 §8 `G-SLICE-REF-PRODUCER-EMPTY` 记载一致（消费方 `ontology-governance.ts:336` 在，生产方从不产 `kind:"slice"`）。

- **「切片字段全覆盖」这句话的判别力接近 0。**
  门 `scripts/check-ontology-slice-coverage.mjs:68` 把 `batteryCoverageSlices()`（`apps/datacore/src/synthetic/data-categories.ts:109`）
  一起喂进覆盖计算，而那是**每类型一条零跳根切片** `{root:{typeKey},paths:[]}`；
  覆盖算法 `apps/datacore/src/databuilder/slice-coverage.ts:47` 又写着「root 自身全字段恒覆盖」。
  ⇒ **只要一个类型进了数据分类，它的字段就自动「被切片覆盖」**。这句话是真的，但它**不度量**「多跳业务切片能不能取到这些字段」。

### 1.3 切片 / Skill / Agent 是同一份本体视图吗 —— **不是，各读各的**（派单问题 4 的正面回答）

| 谁 | 它读的那份「本体视图」是什么 | 真源 file:line | 与 `SliceSpec`（98 条）的关系 |
|---|---|---|---|
| **本体切片引擎** | `slice_specs` 表 → `executeSlice` 真子图 | `apps/datacore/src/ontology-core.ts:552` | **就是它本身** |
| **Agent 选型时看的地图**（NavigationSlice） | AgentCore 内**硬编码**的 `SOLVER_CATALOG` 按问句正则投影 | `apps/agentcore/src/agent/navigation-slice.ts:283` | **零关系**（金丝雀背书的 0 命中） |
| **Agent discover 的供给侧**（DRIL 资源目录） | `catalog.discover("slices")` | `apps/datacore/src/catalog.ts:284` → `dril/resource-registry.ts:109/182` | **只看得见 2 条硬编码的**，98 条一条不在（双服务实测：1055 资源里 `kind=slice`=2） |
| **Skill 的引用图** | `Skill.references[] / dependsOn[]` | 契约允许 `kind:"slice"`（本体 §3:251） | **实测 7 个出厂 skill 全是 `solver:` / `rule:` / `workflow:` / `skill:`，`kind:"slice"` 一条没有** |
| **资源关系图**（`workflow --includes--> slice`） | `extractResourceRelations` 真会从 `resolve_slice` 步抽这条边 | `apps/agentcore/src/dril/relations.ts:57` | ⚠️ **抽出来了又被丢掉**：`resource-registry.ts:221` 要求**两端都在册**，而切片只在册 2 条 ⇒ 指向那 4 条多跳切片的边**全被静默过滤**。实测 `GET /b/v1/resources/workflow/sop_balance_wf/relations` = 2 条边，**全是 rule，零 slice**（该工作流的 `s1` 明明就是 `resolve_slice`） |

**⇒ 一句话**：平台里叫「切片」的东西**至少有三份互不相干的实现**（本体切片 / 导航切片 / 目录里那 2 条硬编码切片），
**只有第一份是真的本体视图，而 Agent 主要读的是另外两份**。
这也是 `G-SLICE-CATALOG-TWO-ITEMS` 的**二阶后果**：切片不在册，不只是「搜不到」，
连**已经算出来的 `workflow→slice` 关系边都会被丢掉** ⇒ 资源图上永远看不到「哪条工作流用了哪条切片」。

### 1.4 结论（给排期用的一句话）

> 切片的地基（引擎 / 规划器 / 索引 / 两库 / 契约 / 连通性门 / 十六层投影）**都在，而且真能跑**；
> 断的全在**接缝的最后一米**：**没进 Agent 的地图**（③）、**没喂进求解器入参**（①）、**默认参数没人给**（§2.3）。
> 这三条都不是「造新引擎」，是**接线 + 补数据**。

---

## §2 · 实测现状 · 四态对账

判据（照派单，不自创）：
**A=已实现且在生产链路上**（须给**非 test** 调用方 file:line）·
**B=只有实现没接线**（只有 test 调用）·
**C=接了线没数据 / 接错地方**·
**D=没做**（须给金丝雀）·
**U=未判定**（须给原因）。

### 2.1 `docs/PRD-addendum-ontology-core.md` §3–§4（切片语法的权威原子规格）

| 条款 | 判定 | 证据 |
|---|---|---|
| SliceSpec 结构（root.selector / paths ≤4×≤6 跳 / maxNodes 缺省 500 上限 1000） | **A** | `apps/datacore/src/ontology-core.ts:552 (executeSlice)`；`:567` `Math.min(spec.maxNodes ?? 500, 1000)`。实测 `order_fulfillment_360` `paths=4` |
| Hop.filter / limitPerNode 缺省 50 / project | **A** | `ontology-core.ts:664 (perParentLimit = hop.limitPerNode ?? 50)` · `:637 (project)` |
| O8 slice 执行 · truncated | **A** | `ontology-core.ts:632 (truncated=true)`；实测 `enterprise_360@so=SO-3391` → `nodes=555` |
| O9 逐跳 A6 行级过滤剪枝 | **A** | `ontology-core.ts:573 (visibilityFor)` · `:670 (if (!vis(child)) continue)`；回归锁 `apps/datacore/test/slice-order-fulfillment.test.ts` SL3 |
| O10 `{{args.x}}` 只作字面量参数（无注入面） | **A** | `ontology-core.ts:596 (resolveTemplate)` 严格全匹配正则 `^\{\{\s*args\.([\w]+)\s*\}\}$` |
| **PRD 举的示例切片 `model_capacity_network` 本身** | **C·接错地方** | PRD `:126-135` 把它写成**声明式 SliceSpec**；实现却是**硬编码解析器** `apps/datacore/src/ontology.ts:630`（入口 `:624 resolveSlice`）。⇒ 它不在 `GET /a/v1/ontology/slices` 的 98 条里、不过 `executeSlice`、不受十六层投影/连通性门/覆盖门管辖。实测：`POST /a/v1/ontology/slices/model_capacity_network/resolve` → **404**；`POST /a/v1/slices/model_capacity_network/resolve {"modelId":"2170-NCM"}` → **200**（`model/bases/edges`） |

### 2.2 `docs/PRD-A3-multihop-slice-completion.md`

| 条款 | 判定 | 证据 |
|---|---|---|
| A3.2 域内/跨域两库 | **A** | `apps/datacore/src/ontology/slice-library.ts:78 (deriveSliceLibrary)` ← 路由 `app.ts` `/a/v1/slices/library`；实测 `intra=7 cross=36`（=43，与 `docs/ONTOLOGY-SLICE-GAPS.md:9` 一致） |
| A3.3 多跳规划器（确定性 BFS + 固定 tie-break） | **A** | `apps/datacore/src/ontology/slice-planner.ts:69 (planSlice)` ← `app.ts:42` 导入、`/a/v1/slices/plan` 路由；另有非路由调用方 `databuilder/comprehend.ts:288` 与 `agentcore/src/dril/resource-registry.ts:317`（graphDistance）。实测 `Order→{Base,Material,Customer}` 出 3 条 pathEvidence + `spannedDomains` 4 域 |
| A3.4 索引 + 复用（`lookupReusable`） | **A** | `apps/datacore/src/ontology/slice-index.ts:48` ← `app.ts:2949`；实测规划 `Order→…` 返回 `"reused":true` 并复用到 `order_fulfillment_360` |
| 事件 `slice.planned` | **A** | `apps/datacore/src/app.ts:2964 (outbox.emit …"slice.planned")` · `:2987`；订阅方 `apps/agentcore/src/event-subscriptions.ts:64` |
| §2 WO-A3-REFBASE 参考本体基线（元租户 ≈95 节点） | **A** | `apps/datacore/src/ontology/refbase.ts` + `refbase-coverage.ts` ← 非 test 调用方 `apps/datacore/src/app.ts:62/63`、端点 `:2104 (GET /a/v1/meta/refbase)` |
| §3-1 **切片约束一等化**（`mustIncludeTypes` 从写死 → 引用一等 `RuleEntry.params`，"改规则即改切片验收"） | **C·接了线没数据** | 消费方在：`apps/datacore/src/ontology-governance.ts:412 (resolveStringArray)` · `:429/:433` 读 `fx.expect.ruleRef`；契约字段在：`apps/datacore/src/domain.ts:476 (ruleRef)`。**但生产种子从不设 `ruleRef`**（金丝雀背书），`apps/datacore/src/synthetic/battery.ts:2480/2548/2588/2615` 全是内联数组 ⇒ 永远走 fallback。**改规则今天不改切片验收** |
| §3-2 QOS 动态切片深接（`plan_slice` → 登记为一等 SliceSpec → 后续 `resolve_slice` 可消费） | **A** | `apps/agentcore/src/tools/executor.ts:334-357`（`planSlice` → `putSliceSpec`）· 工具声明 `tools/registry.ts:63`；工作流一等步骤 `workflow/executor.ts:138` |
| §3-3 切片库/规划可视面（G-VIS-1） | **A** | `apps/frontend-shell/src/App.tsx:175 (/admin/slice-library)` · `pages/admin/SliceLibraryPage.tsx` |
| §3-4 SHAPE 门扩（slice-planner 输出形状纳入 `chain:check`） | **A** | 本体 §7 已登记（`docs/SYSTEM-ONTOLOGY.md:903` A3-SUITE-4：脚本内跑 `planSlice` 并以 `SlicePlanSchema` 校验 + 删 `pathEvidence` 的 tooth test） |

### 2.3 `docs/SLICE-order-fulfillment-360.md` / `docs/IMPLEMENTATION-phase1-4-slice-rules.md`

| 条款 | 判定 | 证据 |
|---|---|---|
| 跨域链路边 + 边实例确定性派生（8→13→…） | **A** | `apps/datacore/src/synthetic/battery.ts batteryLinkTypes()` / `synthetic/service.ts instantiateBattery()`；实测本体 **类型 94 · 链路 85**（`docs/ONTOLOGY-SLICE-GAPS.md:8`） |
| 4 条多跳业务切片合成即落库 | **A** | 实测 `GET /a/v1/ontology/slices` = **98 条**，`hops>0` 恰 **4** 条：`aop_scenario_chain`(3 跳) / `enterprise_360` / `order_fulfillment_360` / `order_to_cash_720`；其余 **94** 条为 `coverage_*` |
| 契约 fixture 全绿 | **A** | 实测 `POST /a/v1/ontology/slice-contracts/run` → **fixtures=4 ok=4 fail=0**（含「首单全链可达 6 域」「10 域（含财务+计划）」「最大广度 8 域 + 12 类节点」「基准情景根可达 plan+finance」） |
| P0-a「`resolve_slice` fall-through 到通用引擎」 | **A** | `apps/datacore/src/app.ts:2997-3013`（先旧解析器，`NOT_FOUND` 才 fall-through `getSliceSpec`+`executeSlice`） |
| **「两场景都经它检索再推演」**（`SLICE-order-fulfillment-360.md` §3） | **C·接了线接错地方** | 该说法成立**只在脚本里**（`scripts/provision-enterprise.mjs` 第 5b 步 / `scripts/slice-scenarios-excel.mjs`——非在线推演链）。**在线**的 Path-A 计划里，`resolve_slice` 的产物只进 ValidationTrace（`workflow/executor.ts:183-184`），求解器入参不引用它 |
| 首屏默认多跳切片可用 | **C·接了线没数据** | 实测 4 条多跳切片 `args={}` 直解 **全部 nodes=0 edges=0**；十六层投影 `args={}` → `present=3 / not_in_slice=3 / absent=10` + `graph.empty.reason=missing_args`。给真参（`so=SO-3391`）后：`order_fulfillment_360` **nodes=531 · 12/1/3**、`enterprise_360` **555 · 12/1/3**、`order_to_cash_720` **540 · 12/1/3**、`aop_scenario_chain@key=aggressive` **5 节点 · 11/1/4**。调用点 `apps/frontend-shell/src/pages/admin/SliceInspector.tsx:95` 不传 args → `SliceLayersPanel.tsx:192` 默认 `args = {}`。**（此条归 `WO-SLICE-DEFAULT-ARGS`，本文不给修法）** |
| **已发布工作流 `sop_balance_wf` 的切片引用** | **D·悬空**（金丝雀见下） | `apps/agentcore/src/mocks/seed.ts:970` 步骤 `s1 = resolve_slice(monthly_balance)`。实测 `monthly_balance` **两条路由都 404**（`/a/v1/ontology/slices/*/resolve` 与 `/a/v1/slices/*/resolve`），且不在 98 条 SliceSpec 里、不在 `BUILTIN_SLICE_CATALOG` 的 2 条里、mock 客户端也抛 `unknown slice`（`apps/agentcore/src/mocks/clients.ts:201`）。⇒ 该工作流第一步必落 `!r.ok`（`workflow/executor.ts:168`）→ `onError` 缺省 `FAIL`（`:125`）⇒ **整条工作流必失败**。<br/>**金丝雀**：同一探针同一路由，`order_fulfillment_360` → **200**；`model_capacity_network`+正确参数 → **200**。⇒ 404 是真 404。<br/>**⚠️ 亲手真跑（绿测试≠能用·不是读代码推的）**：双服务起好后 `POST /b/v1/workflows/wf_seed_sop_balance/run {"inputs":{"month":"2026-03","segment":"ESS"}}` → HTTP 200、**`status:"FAILED"`**、`error.code=TOOL_ERROR`、`stepId:"s1"`、原文 `DataCore POST /a/v1/slices/monthly_balance/resolve -> 404 {"code":"NOT_FOUND"}`、`stepOutputs:{}` |

### 2.4 `docs/PRD-agent-navigation-slice-latency.md`

| 条款 | 判定 | 证据 |
|---|---|---|
| A · 确定性优先门（高置信题拉回 path-A） | **A** | `apps/agentcore/src/router/domain-resolver.ts` + `router/orchestrator.ts` 确定性优先门（本体 §8 `G-AGENT-BLIND-REACT` 记 ✅ 闭·commit `c1803364`） |
| B · NavigationSlice 注入首轮 prompt | **A**（做了）／**C**（做成了另一个东西） | 非 test 调用方 `router/orchestrator.ts:1893` · `engine.ts:417`。但 §3-B 原文承诺「复用 `ontology/slice-index` 切片」——实测 `navigation-slice.ts` 对本体切片零命中（金丝雀 `SOLVER_CATALOG`=8）。**它不读本体切片** |
| C · 规划式执行（plan-then-execute，round-trip ≤4） | **A** | `apps/agentcore/src/agent/loop.ts` plan 模式（commit `9a0ad16c`·SEAM `test/qos-agent-slice-seam.test.ts` 11/11） |
| D · 模型分层（快模型做选型） | **U·未判定** | 需真 LLM 凭据与 live 计时；本单无凭据、且不跑 live LLM。原文 §7.4 自述「真 Kimi 20 题 live 重测」是唯一未闭环项，与本判定一致 |
| §4 SEAM-1/2/3（活系统真跑时延） | **U·未判定** | 同上，墙钟时延必须 live 测；SEAM 测证的是机制不是墙钟 |

### 2.5 十六层「两套」的裁决建议（不重做对账，只裁决）

采信 `docs/RECONCILE-slice-16-layers-two-sets.md` 的结论：**A≠B 已由反例证死**（B 集含 `Function`/`Interface` 两层，A 集 16 个 id 里这两个名字一个都没有），而 B 集的 16 个层名**从未写进本仓**，所以「谁是谁的版本」没有证据。

**裁决建议（三条，建议原样进本体 §8 与契约注释）**：

1. **以 A 集为准 —— 唯一合法的「十六层」= `packages/contracts/src/slice-layers.ts:18 (SLICE_LAYER_IDS)`。**
   理由不是「A 更好」，是 **A 是唯一被机器守住的那套**：契约（`.length(16)` + `total: z.literal(16)`，`:145/:148`）→
   引擎（`apps/datacore/src/ontology/slice-layers.ts:168`）→ 路由（`apps/datacore/src/app.ts:4831`）→
   前端（`SliceLayersPanel.tsx:192`）→ 测试 → 本体 §8 六条断点。B 集这张表**整行是空的**。
2. **B 集收编方式 = 改名降级为「REQ153 十六层（外部出处 S7 · 本仓未收录原文）」，不作废、不合并、不再简称「十六层」。**
   它**不是被否定**，是**在本仓不可核**（四个裸数 0/8/26/25 无口径、无 file:line、逐个试对不上今天的实测）。
   收编动作只有一个：**把 S7 原文档收进 `docs/`**（或至少把 16 个层名逐字抄进 REQ153 的证据位）。在那之前不许拿它排期。
3. **覆盖数三要素纪律入门禁（建议）**：任何一处写「N/16 层」必须同时写明
   ①哪一套 ②哪条切片+什么 args+哪个快照 ③`present/not_in_slice/absent` 三态分开。
   理由是实测证明 A 集的覆盖数**是变量不是常数**：同一天同一快照，`order_fulfillment_360@so=SO-3391` 是 **12/1/3**，
   `aop_scenario_chain@key=aggressive` 是 **11/1/4**，无参时四条一律 **3/3/10**。
   ⚠️ 落地位置提示：`G-SLICE16-TWO-VOCABS` 目前**只在 reconcile 分支的本体上**，canonical 的 `docs/SYSTEM-ONTOLOGY.md` 实测 **0 命中**（金丝雀：同文件 `G-SLICE-16LAYER-PROJECTION` = 3 命中）⇒ **reconcile 分支未并线前，canonical 上这条纪律不存在**。

### 2.6 三个「不工作」形态的分栏（混了必修错地方）

| 形态 | 本域实例 | 修法 |
|---|---|---|
| **没接线** | —— 本域**没有**这一类。切片的每个组件都有非 test 调用方 | — |
| **接了线没数据** | ① 98 条 SliceSpec 无 `description` ⇒ Agent 目录只有 2 条<br/>② 切片契约 `ruleRef` 从不设 ⇒ 一等规则不驱动验收<br/>③ `reported_refs` 无 `kind:"slice"` ⇒ 十六层 ①② 恒空<br/>④ 场景卡无 `sliceTargets` ⇒ 发育闭环那条判据恒 N/A（门自己写着：`scripts/check-ontogenesis.mjs:144`「出厂目录卡未声明 sliceTargets 字段 → N/A」）<br/>⑤ Skill 的 `references` 里 `kind:"slice"` 为 0（种子侧金丝雀 `kind:"workflow"`=1；真跑侧 7/7 个 skill 全无 slice 引用）<br/>⑥ `workflow --includes--> slice` 边算出来就被「两端在册」过滤丢掉（`resource-registry.ts:221`）——**是 ① 的二阶后果，不是独立缺陷，修 ① 即自动好** | 补数据 |
| **接了线接错地方** | ① `model_capacity_network`/`base_risk_profile` 走硬编码解析器而非 SliceSpec<br/>② 「先切片检索再推演」只在离线脚本成立，在线计划里切片产物只进 ValidationTrace<br/>③ 覆盖门把零跳根切片计入覆盖 | 补挂载点 / 换判据 |
| **悬空** | `sop_balance_wf` 引用 `monthly_balance`（不存在） | 补切片或改引用 + 加门 |

---

## §3 · 目标能力（按用户可见的推演价值排序）

每条给：**它让平台多推演出什么** + **机器可验证的验收判据**。

### T1 · 切片进 Agent 的地图（推演价值最高·成本最低）

**多推演出什么**：今天 Agent 能"看见"的切片只有 2 条硬编码的；用户问「这张单从下单到回款牵涉谁」，
Agent 手里**没有** `order_to_cash_720` 这个词，只能逐跳 `query_objects` 自己拼——拼出来的图**和本体登记的那条切片不是一个东西**，
于是同一个问题两次问可能给两张不同的图。放开后，Agent 一步命中一条**已被契约锁住的**跨域子图（10 域·540 节点），
答案的证据链从"我拼的"变成"平台登记的那条链"。

**今天的基线（双服务实测，供验收对拍）**
- `GET /b/v1/resources` 总资源 **1055**，`kind=slice` = **2**；
- `POST /b/v1/resources/search {"query":"这张订单从下单到回款牵涉哪些对象"}` → 前 20 名 **一条切片都没有**
  （命中的是 `intent:affected_orders 0.381` / `solver:affected_orders 0.381` / `solver:ontology_query 0.375` / `intent:order_deep_360 0.375` / `object_type:OrderLine` …）。
  ⇒ 平台**有**一条为这个问题量身定做的切片（`order_to_cash_720`，10 域 540 节点），**而检索层看不见它**。

**验收判据（机器可验证）**
- `GET /b/v1/resources?kind=slice` 从 **2** → **≥6**（4 条多跳 + 2 条内置），且含 `order_to_cash_720`；
- 每条自定义切片带 `description`（非空）与 `argHints`（含 root selector 的 `{{args.X}}` 名，见 T3）；
- **变异反证**：把某条切片的 `description` 清空 → 该条从目录消失（证明门槛是它，不是别的）；
- **SEAM（接缝驱动）**：上面那条真问句的 top-20 里出现 `slice:order_to_cash_720`。
  ⚠️ 判据必须写成「**那条问句**召回**那条切片**」，不许写成「资源目录里切片数 > 2」——
  后者是供给侧计数，**不度量**「Agent 真能用上」。
- **顺带自动闭合的二阶判据**（需与 T2 一起才完全成立）：`GET /b/v1/resources/workflow/sop_balance_wf/relations`
  出现 `relType:"includes" toKind:"slice"` 的边。**今天实测 = 2 条边全是 `toKind:"rule"`（C18/C21）、零 slice 边**，
  尽管它的 `s1` 就是 `resolve_slice` —— 因为 `resource-registry.ts:221` 要求两端在册，而切片只在册 2 条。
  ⚠️ 注意 `capacity_feasibility` **不是 Workflow**（实测 `/b/v1/resources/workflow/capacity_feasibility` → 404，它是 ExecutionPlan/Intent），
  别拿它当探针。

### T2 · 悬空切片引用清零 + 一道守它的门

**多推演出什么**：`sop_balance_wf`（S&OP 月度平衡，已发布）今天**第一步必失败**——用户问月度平衡，拿到的是错误而不是结论。
清零后这条工作流能跑到底。
**今天的基线（亲手真跑）**：`POST /b/v1/workflows/wf_seed_sop_balance/run` → `status:"FAILED"` · `stepId:"s1"` · `TOOL_ERROR … 404 NOT_FOUND`。

**验收判据**
- 静态门：扫全部 `PUBLISHED` 的 ExecutionPlan/Workflow 步骤里的 `params.sliceKey`，
  每个 key 必须命中「98 条 SliceSpec ∪ `BUILTIN_SLICE_CATALOG`」之一，否则 exit 1；
- **金丝雀内建**（与主逻辑共用同一份解析，不许另抄正则）：门自己先断言 `order_fulfillment_360` 命中；金丝雀不中 ⇒ 报「工具坏了」，不许报「无悬空引用」；
- 变异反证：把某个 `sliceKey` 改成 `zzz_not_exist` → 门必红。

### T3 · 「这条切片要什么参数」全链可发现（后端半）

**多推演出什么**：今天 4 条多跳切片是**平台仅有的跨域推演入口**，而它们 100% 需要参数；
参数需求既不在列表摘要里（实测 `GET /a/v1/ontology/slices` 只给 `rootType/hops/linkKeys/maxNodes/fixtures`），
也不在 Agent 目录里。补上之后，**Agent 与前端都能先问一句「要哪张单？」再切**，而不是切出空图再猜。

**验收判据**
- `GET /a/v1/ontology/slices` 摘要**加性**下发 `requiredArgs: string[]`（口径与 `apps/datacore/src/ontology-core.ts:596 (resolveTemplate)` 的占位符正则**同源**，不许各抄一份）；
- 实测该字段：4 条多跳切片分别为 `["so"]`/`["so"]`/`["so"]`/`["key"]`，其余 94 条为 `[]`；
- `argHints` 与 `requiredArgs` 同源派生（一个来源两处消费，禁双写）；
- 变异反证：给某切片 root selector 加一个 `{{args.zzz}}` → 摘要 `requiredArgs` 必须多出 `zzz`。
- 🚦 **边界**：本条只做**后端摘要**；前端如何显示归 `WO-SLICE-DEFAULT-ARGS` / 另单。

### T4 · 切片产物真喂求解器（把「取证」升级成「推演输入」）

**多推演出什么**：今天 `capacity_feasibility` 计划里 `s1` 切出型号可产基地网络，`s2` 却**另起炉灶**自己取数，
两者对不齐时没人会红。接上之后，「这个型号在哪些基地能做」**只有一个答案**，
且切片一旦被 A6 行级过滤剪枝，求解器看到的范围**自动同步收窄**（今天不会）。

**验收判据**
- 至少一条生产计划的 `invoke_solver.args` 引用 `{{steps.<resolve_slice 步>.output…}}`；
- **SEAM（接缝驱动·非各半绿）**：同一问句、同一租户，用 `base_manager:常州` 身份跑 → 切片剪枝后节点集变小 ⇒ **求解器结果随之变**；用 admin 跑 → 恢复。两次结果必须不同（今天必然相同）；
- R6：同 args 同快照重跑字节一致。

### T5 · 十六层 ①业务场景 / ②决策意图 的生产方接线

**多推演出什么**：让「这条切片支撑哪些业务场景、被哪些决策意图用」**从界面上答得出来**。
今天这两层恒 `absent`，用户看到的是"平台没有这层"，而真相是"没人上报"。

**验收判据**
- B 侧发布 workflow/plan/agent 时把步骤里的 `sliceKey` 一并上报（现成抽取逻辑在 `apps/agentcore/src/dril/relations.ts:57`）；
- 实测 `GET /a/v1/ontology/slices/order_fulfillment_360/references` 从 `{"refs":[],"total":0}` 变为非空；
- 十六层投影里 ①② 从 `absent` 翻为 `present`，且 `absentReason` 消失；
- **三态不许合并**：平台有但本切片没纳入 ⇒ `not_in_slice`；平台无 ⇒ `absent`。

### T6 · 覆盖门换判据（从"每类型一条根切片"改为"业务切片可达"）

**多推演出什么**：今天绿的那道覆盖门，**换一个新类型进数据分类就自动变绿**。
换判据后，它才开始度量「跨域推演真能取到这些字段」。

**验收判据**
- 覆盖计算**分两栏**报：`root-only 覆盖`（今天这套，保留但降级为索引）与 `多跳可达覆盖`（新判据）；
- 新判据走**棘轮基线**（同 `debattery`/`cli-parity` 模式）：存量记基线只减不增，新增未覆盖即红；
- 变异反证：删掉 `order_fulfillment_360` 的一条 path → 多跳可达数下降 → 门红（今天删了也绿）。

### T7 · 切片契约由一等规则驱动（"改规则即改切片验收"）

**多推演出什么**：切片的验收标准（必须含哪些类型/链路）今天写死在合成种子里，
业务侧改不了。接上后，改一条规则的 `params` 就改切片验收——这是 G-10「规则即引用」在切片维的兑现。

**验收判据**
- 至少 1 条生产切片 fixture 设 `ruleRef`，`runSliceContracts` 实测走 `resolveStringArray` 的**规则分支**而非 fallback；
- 变异反证：改那条规则的 `params` 去掉一个类型 → 契约结果随之变（今天改规则零影响）；
- ⚠️ **路径开关类假绿的防线（铁律 0.5 判据 6）**：`resolveStringArray` 有 `ruleRef` / fallback 两条分支，
  **必须核对「生产传的那个值」被测试覆盖**——今天两个分支的生产实参恒为 `undefined`（走 fallback），
  若只测 `ruleRef` 分支就是「测试验的是生产已经放弃的那条路」。

### T8 · ⑮行动层的 join 键（结构缺口，唯一一条不是"补取数"能解的）

**多推演出什么**：让「这条切片上能做哪些动作」可答（→ 从"看图"走到"在图上动手"）。

**验收判据**：`ActionType` 加 `targetTypeKey`（或回填 `ObjectTypeDef.actions[]`），
十六层 ⑮ 从 `absent` 翻 `present`；实测今天 94 类 `actions` 非空 **0** 类（金丝雀：同查询 `sourceBindings` 非空 **93** 类）。

---

## §4 · 分期交付

**P0 判据（派单原文）= 做完当天用户在屏上能看到推演结果变了。**

### P0（一周内 · 三张单 · 互不冲突）

| 单 | 内容 | 屏上当天可见的变化 | 范围边界 |
|---|---|---|---|
| **P0-1 = T1** 切片进 Agent 地图 | 给 4 条多跳切片补 `spec.description` + `argHints`（种子侧），不动 catalog 门槛逻辑 | 对话坞「推演过程」的**②检索切片**节点从"用不上"变成真命中；答案证据链 `slicesUsed` 出现 `order_to_cash_720` 这类真 key | `apps/datacore/src/synthetic/battery.ts`（切片登记）+ SEAM 测 |
| **P0-2 = T2** 悬空切片引用清零 + 门 | 修 `sop_balance_wf` 的 `monthly_balance`（补切片或改引用）+ 加 `slice-ref:check` | S&OP 月度平衡工作流**从必失败变成出结论** | `apps/agentcore/src/mocks/seed.ts` + `scripts/check-slice-ref.mjs` |
| **P0-3 = T3(后端半)** 摘要下发 `requiredArgs` | `GET /a/v1/ontology/slices` 加性字段，口径与 `resolveTemplate` 同源 | 与 `WO-SLICE-DEFAULT-ARGS` 汇合后，列表页能标「需参数」；即便前端不改，CLI/Agent 也立刻能读到 | `apps/datacore/src/app.ts` 摘要投影 · **不碰前端** |

> ⚠️ **P0-1 与 P0-3 有一处共享真源**（root selector 的占位符解析），必须**一个 dev 整单做**或明确指定单一实现方，
> 否则就是本仓吃过亏的「拆两半用不同机制不对接」。建议 P0-1 + P0-3 合并为一张单。

### P1（两周 · 需接缝测）

| 单 | 内容 | 依赖 |
|---|---|---|
| **P1-1 = T4** 切片产物喂求解器（先只做 `capacity_feasibility` 一条计划打样） | SEAM：换身份 → 剪枝 → 求解器结果随之变 | 无 |
| **P1-2 = T5** ①② 生产方接线（B→A 上报 `kind:"slice"`） | 闭 `G-SLICE-REF-PRODUCER-EMPTY` | 无 |
| **P1-3 = T6** 覆盖门换判据（双栏 + 棘轮） | 需先有 P1-1 的多跳消费实例才有基线意义 | P1-1 |
| **P1-4** 命名裁决落地：把「导航切片」在代码与文档里更名为**求解器导航图**（`SolverNavigationMap` 或同类平台自有术语），并加一条**禁混用门**（同名不同物检测） | 治 §1.2 第一条；纯改名 + 门，不动算法 | 无 |

### P2（有条件才做）

| 单 | 条件 |
|---|---|
| **P2-1 = T7** 切片契约规则化（`ruleRef` 真落数据） | 需业务侧确认哪条规则承载切片验收 |
| **P2-2 = T8** ⑮行动层 join 键 | 结构改动，需与 `docs/ONTOLOGY-7ELEM-AUDIT.md` 的 Action 缺口**合并裁决**（两者缺的字段不同，见 RECONCILE §5.3，**不许当一件做**） |
| **P2-3** ⑭证据层 `DerivationSpec` 补种（闭 `G-DERIVSPEC-EMPTY`） | 需先定「`derivation_specs` 到底作不作为证据来源」 |
| **P2-4** REQ153 十六层补录 | **仓外条件**：S7 原文档进仓。不进仓不排期 |

---

## §5 · 砍掉与降级（逐条给理由）

| # | 处置 | 对象 | 理由 |
|---|---|---|---|
| 1 | **砍** | 「再造一份统一切片视图，把导航切片/本体切片/DRIL 资源图合三为一」 | 三者今天各自都有非 test 调用方、各自有测试、各自在跑。合并 = 同时动 QOS 路由 + 本体引擎 + 资源检索三条链，是本仓反复吃亏的「平行造第二套」的镜像版（RL10）。**改为 P1-4 只做改名 + 禁混用门**——先让"同名不同物"这件事本身停止骗人，成本一天，收益立刻 |
| 2 | **降级（不是删）** | 94 条 `coverage_*` 切片 | 不再作为「字段被切片覆盖」的证据，降级为**字段可达性索引**（它确实能取到那个字段，只是零跳）。理由：覆盖算法 `slice-coverage.ts:47` 对 root 类型「全字段恒覆盖」，加上 `data-categories.ts:109` 每类型自动生成一条根切片 ⇒ 判别力≈0。**注意措辞**：这道门**不是在撒谎**（root-only 切片真能返回全字段），是**它度量的东西不是我们要的东西**。<br/>**降级安全性已追一层调用**：`batteryCoverageSlices` 的全部消费方仅两处——`apps/datacore/src/synthetic/service.ts:1152`（合成即落库，因此它们出现在 `GET /a/v1/ontology/slices` 的 98 条里、并被 `SlicesPage.tsx:34` 默认折叠）与 `scripts/check-ontology-slice-coverage.mjs:68`。⇒ **只改门的判据、不删这 94 条**，不会打断别的链 |
| 3 | **降级** | 「平台 12/16 层有承载物」这类光秃秃的覆盖数 | 实测证明 A 集覆盖数是变量：同一快照 11–12 present 随切片/参数变，无参时全部掉到 3。任何不带「哪一套 + 哪条切片 + 什么 args + 三态分开」的覆盖数，一律不得引用（§2.5 裁决 3） |
| 4 | **砍** | REQ153 那套十六层的对账收尾 | 缺的输入（S7 原文档）不在仓里。继续对账只会产生更多没有证据的猜测。**判定停在「已证不同、成因未知」是正确的终点，不是欠账** |
| 5 | **砍** | 「让所有 98 条切片都 16/16」 | `aop_scenario_chain` 实测 5 节点 → 11 present 是**合理的**（那条链本来就只跨 plan+finance 两域）。追求全绿会逼出造数据。**十六层的正确用法是诊断，不是 KPI** |
| 6 | **降级** | `docs/SLICE-order-fulfillment-360.md` §3「两场景都经它检索再推演」 | 该表述在**在线推演链**上不成立（只在 `scripts/*` 离线脚本成立）。建议就地加一行注记指向本文 §2.3，**不删原文**（它是当时脚本行为的真实记录） |
| 7 | **不做** | 首屏默认参数修复 | 已由 `WO-SLICE-DEFAULT-ARGS` 承担。本文只提供实测数据（`args={}` → `present=3`；给参 → `present=11~12`）供那张单当基线 |
| 8 | **降级** | `docs/PRD-agent-navigation-slice-latency.md` §3-B「复用 `ontology/slice-index`」 | 实现选了另一条路（硬编码 `SOLVER_CATALOG`）且**跑通了提速目标**。不追认、不返工，改为在该 PRD 就地注记「落地实现不读本体切片」+ P1-4 改名 |

---

## §6 · 本体引用与影响（铁律 0）

### 6.1 对象类型（§2）

`SliceSpec`（D2 本体域）· `ObjectInstance`（含 `origin`/`epoch`）· `LinkInstance` · `OntologyType`/`OntologyLink` ·
`SlicePlan`（A3.3 规划器产物，`docs/SYSTEM-ONTOLOGY.md:77`）· `RuleEntry`（`params`，T7）· `ActionType`（T8 加 `targetTypeKey`）·
`DerivationSpec`（P2-3）· `Skill`/`ExecutionPlan`/`WorkflowDefinition`（T1/T2/T5 的引用方）·
`ResourceDescriptor`（`kind=slice` 投影，T1）· `Policy(A6)`（T4 的剪枝语义）。

### 6.2 链路（§3 / §10.3）

- `sys.ontology.type_lineage`（D2）：`ObjectType→PropertyDef→DerivationSpec→SliceSpec`——T6 改的是这条链末端的度量口径。
- **`sys.ontology.slice_16layers`（D2）**：T5/T8/P2-3 各补一层承载物，**不改层定义**。
- `sys.orch.query_to_answer`（D7）：T1（切片进 discover 供给侧）、T4（切片产物进 solver 入参）都落在这条中枢链上 ⇒ **属跨域节点改动，涟漪最广**。
- `sys.access.row_filter`（D6）：T4 的 SEAM 判据正是让这条链**穿透到求解器结果**。
- 跨域节点 `SliceSpec`（D2↔D7↔D6，本体 §10.4）：本文 P0/P1 全部坐在它上面——照 §10.5 规律，**断点高发**，因此每条都要求接缝驱动测而非各半绿。

### 6.3 事件（§4）

- 复用 `slice.planned`（L1 · `apps/datacore/src/app.ts:2964`，订阅方 `agentcore/src/event-subscriptions.ts:64` 失效 `slice-library`/`slice-index`）。
- 复用 `ontology.published`（索引重建）。
- **本文不新增事件名。** T5 的上报走既有 `POST /a/v1/references/report`（非事件）。

### 6.4 不变量（R1–R19）

| 不变量 | 本文怎么触碰 |
|---|---|
| **R2** tenant_id everywhere | 切片一切读写带 tenantId；T1 的 catalog 投影按租户过滤（现状已合规） |
| **R3** entitlement 先于 authz | T1 放开目录后仍走 `catalog.ts:291` 的 `featureKey` 过滤，未开通即不出现 |
| **R6** 确定性 | T3 的 `requiredArgs`、T6 的双栏覆盖、T1 的目录排序**必须纯函数**；口径与 `ontology-core.ts:596 resolveTemplate` **同源**（禁各抄一份正则——这正是本仓 0.6 立的机制） |
| **R11** 全链闭包 | T2 的 `slice-ref:check` 是 R11 在切片维的一块砖（「场景声明的切片必须可解析」与「场景声明的求解器必须注册」同族） |
| **R12** 双向闭包 | T6 直接改「对象必落切片」这条 HARD 判据的**度量方式**——⚠️ 换判据会让 `closure.ts` 的历史结论口径变化，**必须同批回写**，否则新旧两个"覆盖率"会同时存在（正是本文 §5-3 要杀的病） |
| **R13** 结论可溯源 | T4 让切片的 `origin`/`epoch`（`ontology-core.ts:640` 已加性带出，实测 531/531）真正流到求解器结论上；T5 让 ①② 层可溯源 |
| **R14** 应用层无业务常数 | T1 的 `description`/`argHints` 属**本体配置**不属应用层常数，须落在切片登记而非前端 |
| **R-一致** 一个事实一个出处 | T4 的核心：「型号能在哪些基地做」今天有两个出处（切片 vs 求解器自取），接上后收敛为一个 |
| **RL3/RL10**（十红线） | §5-1 砍掉"三合一"正是 RL10「不与在建分叉」；P1-4 的禁混用门是 RL3 单一来源的落法 |

### 6.5 断点（§8）

**引用既有（本文不改其定性）**：
`G-SLICE-16LAYER-PROJECTION`（✅已修）· `G-SLICE-PROVENANCE-DROPPED`（✅已修）·
`G-SLICE-EMPTYGRAPH-MISREAD`（✅已修）· `G-SLICE-REF-PRODUCER-EMPTY`（开·T5 修）·
`G-SLICE-ROOT-ARGS-UNDISCOVERABLE`（开·T3 修）· `G-ACTIONTYPE-NO-TARGET`（开·T8 修）·
`G-DERIVSPEC-EMPTY`（开·P2-3）· `G-UPSERTTYPE-DROPS-FIELDS`（开·⑦⑮ 恒空的第二道原因）·
`G-BUILD-LINK`（连通性门的检测面，实测孤岛 0）· `G-VIS-1`（已落）· `G-AGENT-BLIND-REACT`（已闭）·
`G-SLICE16-TWO-VOCABS`（◐·**只在 reconcile 分支**，canonical 实测 0 命中）。

**本文建议新登记 4 条（⚠️ 需回写 `docs/SYSTEM-ONTOLOGY.md` §8；本单不改本体文件）**：

| 建议编号 | 断点 | 链路位置 | 性质 |
|---|---|---|---|
| **G-SLICE-CATALOG-TWO-ITEMS** | **Agent 能发现的切片只有 2 条硬编码的，98 条一等 SliceSpec 一条都进不去**。门槛是 `spec.description` 非空（`apps/datacore/src/catalog.ts:276`，合并于 `:284`），实测 0/98 满足 ⇒ 平台唯一的跨域推演入口对 Agent 不可见（双服务实测：`/b/v1/resources` 1055 条资源里 `kind=slice`=2；DRIL 检索「订单从下单到回款」top-20 零切片）。**二阶后果**：`resource-registry.ts:221` 的「关系两端都须在册」过滤，会把 `relations.ts:57` 已经算出的 `workflow --includes--> slice` 边**静默丢掉** ⇒ 资源图上永远看不到哪条工作流用了哪条切片（实测 `sop_balance_wf` 的 relations = 2 条 rule 边、零 slice 边，而它的 `s1` 就是 `resolve_slice`） | `catalog.discover("slices") → dril/resource-registry.ts:109/182/221 → discover 工具 / /b/v1/resources[/relations]` | **接了线没数据**（修法=补数据，不是改引擎） |
| **G-SLICE-KEY-DANGLING** | **已发布工作流引用不存在的切片**：`sop_balance_wf` 的 `s1 = resolve_slice(monthly_balance)`（`apps/agentcore/src/mocks/seed.ts:970`），实测两条路由均 404、mock 亦抛 `unknown slice` ⇒ 该工作流第一步必 FAIL 且**四包全绿**（测试咬的是执行器，不是这条引用） | `seed 计划/工作流.params.sliceKey → slices 表 / BUILTIN_SLICE_CATALOG` | **悬空引用**（无门守·T2 补门） |
| **G-SLICE-COVERAGE-TAUTOLOGY** | **切片字段覆盖门由「每类型一条零跳根切片」自动满足**：`data-categories.ts:109` 自动派生 94 条 `coverage_*`，`slice-coverage.ts:47` 又规定 root 全字段恒覆盖 ⇒ 新类型进分类即自动绿。**门为真但判别力≈0** | `check-ontology-slice-coverage.mjs:68/75 → computeFieldCoverage` | **判据不度量目标**（形态：「我用『每个类型都有一条根切片』当作『字段被业务切片覆盖』的证据」） |
| **G-NAVSLICE-NOT-ONTOLOGY** | **「导航切片」与「本体切片」同名不同物**：`agent/navigation-slice.ts:283` 是硬编码 `SOLVER_CATALOG` 的正则投影，对 `SliceSpec`/`sliceKey`/`slice-index` **零命中**（金丝雀 `SOLVER_CATALOG`=8）。而 `docs/PRD-agent-navigation-slice-latency.md:53` 白纸黑字写「复用 `ontology/slice-index` 切片」⇒ 读文档的人会以为 Agent 已经在读本体切片 | `Query → projectNavigationSlice → 首轮 prompt`（与 `SliceSpec` 无任何边） | **同名不同物 · 文档承诺与实现分岔**（P1-4 改名 + 禁混用门） |

> **回写要求**：以上 4 条 ID 若被采纳，**必须回写本体 §8**；`G-SLICE-COVERAGE-TAUTOLOGY` 若按 T6 换判据，
> 还需同步回写 §7（`ontology-slice-coverage:check` 的判据描述）与 R12 的检测点。
> **本单只提建议，不改 `docs/SYSTEM-ONTOLOGY.md`。**

---

## §7 · 诚实边界（没判定的逐条列出）

| # | 未判定的事 | 为什么没判 | 判它需要什么 |
|---|---|---|---|
| 1 | **REQ153 那套十六层的其余 12 个层名** | 出处 S7 原文档不在仓里（reconcile §3.2 已给检索证据，含已删目录 `docs/req-inventory/`）。**「我没找到」≠「它不存在」** | 把 S7 收进 `docs/`，或把 16 个层名逐字抄进 REQ153 证据位 |
| 2 | **path-B agent 在真 LLM 下会不会真选中切片** | 本单无 LLM 凭据，且不跑 live LLM。SEAM 测证的是机制，不是"模型会不会选" | 真 LLM 20 题 live 重测（与 `PRD-agent-navigation-slice-latency.md` §7.4 同一笔未闭环账） |
| 3 | **导航切片 + 规划式执行的墙钟提速** | 同上：墙钟只能 live 测 | live 计时（原观测 137s → 目标 path-A <5s / path-B <10s） |
| 4 | **pg 模式下切片行为是否与 memory 模式一致** | 本单只跑了 memory 模式（`SEED_DEMO=1`，无 `DATABASE_URL`）。R9 双实现要求两边一致，但我**没测 pg** | 起 pg 跑同一组探针，逐条比对 nodes/edges 与十六层三态 |
| 5 | **`sop_balance_wf` 在生产里被触发过几次 / 有没有用户真撞上** | 「它必失败」已由**亲手真跑**坐实（`status:FAILED` · `stepId:s1` · 404），但**被调用的频次**我没证；仓里也没有可读的调用计数。**「它一定坏」和「它一定被用过」是两个命题** | 查生产 task 表按 workflow key 计数，或加 metric |
| 6 | **T4 的 SEAM 判据今天是否真的"必然相同"** | 我从代码读到求解器入参不引用切片步骤（`seed.ts:266-280`），**但没有真跑两种身份对拍**——双服务虽已起，造 `base_manager:常州` 会话 + 对拍同问句结论超出本单只读取证的边界 | 用 `X-Debug-User: demo:u1:base_manager:常州` 与 admin 各跑一次 `capacity_feasibility` 同问句，对拍结论是否逐字节相同 |
| 7 | ~~94 条 `coverage_*` 有无别的消费方~~ **已判定** | 追一层调用后穷举完毕：仅 `synthetic/service.ts:1152`（落库）与 `check-ontology-slice-coverage.mjs:68`（门）两处。**降级安全**，见 §5-2 | — |
| 8 | **T1 放开目录后 Agent 上下文预算是否够** | `catalog.ts:296` 有 `query ? filtered.slice(0,20)` 的截断，但**无关键词全量列表**（管理台那条路）会不会撑爆 prompt/页面，我没量 | 量一次投影后的 token 体积；必要时对 `coverage_*` 单独设 `description` 策略 |
| 9 | ~~`GET /a/v1/resources?kind=slice` 404~~ **已判定（两步）** | ①路由不在 DataCore 在 **AgentCore**（`apps/agentcore/src/server.ts:910/912`），我把 AgentCore 的路由打到了 4051 ⇒ 那个 404 是**探针错**不是**缺口**（第一版差点据此写成"统一资源目录里没有切片"）。②起 AgentCore 后实测：总资源 **1055**、`kind=slice` **2**、DRIL 检索 top-20 **零切片** ⇒ 缺口是真的，但**理由和那个 404 无关** | — |
| 10 | **AgentCore 端的资源目录会不会有第二个切片供给源** | 我只验到「总数 2 且 key 与 `BUILTIN_SLICE_CATALOG` 逐字相同」，这**强烈提示**唯一供给源是 `catalog.discover("slices")`，但我**没有**变异反证（改 catalog 后看资源目录是否随之变） | 改一条 `BUILTIN_SLICE_CATALOG` 的 key → 重启 → 看 `/b/v1/resources?kind=slice` 是否跟着变 |
| 11 | **本文所有行号的时效** | 锚点取自 canonical `282b8239`；`docs/RECONCILE-slice-16-layers-two-sets.md` 引的 `slice-layers.ts:33/34-49` 是 **reconcile 分支**的行号（该分支给 `SLICE_LAYER_IDS` 加了 15 行注释），canonical 上同一符号在 **:18**。**两套行号不可混用** | 并线后统一校准 |
