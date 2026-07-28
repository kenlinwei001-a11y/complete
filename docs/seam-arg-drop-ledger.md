# SEAM-ARG-DROP 台账（Phase 1 · AUDIT）

> WO-SEAM-ARG-DROP · 2026-07-28 · 规格 `docs/PRD-seam-arg-drop-audit.md`
> 交叉扫描 **(a) 路由解析 ∖ slotNames = 静默丢的实体** × **(b) 求解器缺过滤维的静默默认**。**(a)∩(b) = CONFIRMED**。
> 沿链路走（本体 §3 `sys.scenario.launch`）：`问句 → resolveCeoRoute(args) → extractedSlots → fillSlots(仅填 intent.slots) → plan {{slots.X}} → solver`。
> **断点在接缝**：`fillSlots`（`apps/agentcore/src/router/slots.ts:307`）**只迭代 `intent.slots`**——路由解析出但未声明为 slot 的实体在此**静默丢弃**；下游求解器缺过滤维再落"全部/首个/qty=0"默认 → plausible-but-WRONG。

## 0. 机制铁证（两处一线穿）

| 环节 | 文件:行 | 事实 |
|---|---|---|
| 路由解析实体 | `apps/agentcore/src/router/ceo-route.ts` | `creditArgsFrom` 解析 `custName`（`/([一-龥]{2,10}(?:客户\|公司))/`）；`whatIfArgsFrom` 解析 `scopeObjectIds:[baseId]`；等 |
| 丢参接缝 | `apps/agentcore/src/router/slots.ts:307` `fillSlots` | `for (const slot of intent.slots)`——**只填声明的 slot**；`extractedSlots` 里未声明的键被无视（丢） |
| 模板要求 | `apps/agentcore/src/util/template.ts:25` | `{{slots.X}}` 若 X 不在填好的 slots → `TemplateResolutionError`（故"补映射"必须"补 slot 声明"，两者绑定） |
| 求解器静默默认 | `apps/datacore/src/solvers/extended.ts:466` `deriveExtendedArgs` credit | 旧：`... .find(x=>custName===...) ?? customers[0]`——**custName 丢即静默落首个客户（整车厂A）** |

## A. CEO 深问能力（`mocks/seed.ts` ceoCaps · 全覆盖）

| intent | solver | 路由解析（route.args 过滤实体） | slotNames（修前→修后） | 丢的实体 | 求解器缺参默认 | 判定 |
|---|---|---|---|---|---|---|
| ceo_root_cause | gap_attribution | metricKey, factorId | `[metricKey]` | factorId | metricKey→用（缺=最严重越线 metric·诚实）；factorId→读 `args.scope.factorId`（**非顶层**·顶层恒被无视） | **NEEDS-CHECK**（factorId 双端未接=独立 seam·非静默错答；metric 维通） |
| ceo_decision | decision_play | metricKey, factorId | `[metricKey, factorId]` | 无（直路） | decision_play 用 metricKey/factorId | **SAFE**（直路齐）；※跨路由 `sop_reschedule→ceo_decision` 丢 targetOrderId 且错跑 decision_play → NEEDS-CHECK（路由/绑定层·router 只读） |
| ceo_metric | metric_rollup | metricKey | `[metricKey]` | 无 | 用 `args.level`（缺=全部·rollup 本义）·**不用 metricKey** | **SAFE**（全域=达标总览本义） |
| **ceo_credit_exposure** | **credit_exposure** | **custName** | **`[]` → `[custName]`** | **custName** | **`deriveExtendedArgs` `?? customers[0]`=首客户（整车厂A）** | **✅ CONFIRMED（锚点·seed.ts:532）** |
| ceo_finance_pnl | finance_pnl | metricKey | `[]` | metricKey | `financePnl(ctx)` **无 args**·全公司 P&L | **SAFE**（全域 by design·无 scope 维可误默认；metricKey 无处可用） |
| ceo_supply_demand_gap | supply_demand_gap_attribution | metricKey, factorId | `[metricKey]` | factorId | 全 S&OP 双向归因·**不吃 metricKey/factorId** | **SAFE**（全域 by design·无 scope 过滤维） |
| ceo_atp_check | atp_check | orderRef | `[orderRef]` | 无 | orderRef 命中→用；未命中→`throw notFound`；缺省→首个 OPEN 单 | **SAFE**（orderRef 直达；缺省才取首 OPEN·非丢参） |
| ceo_bottleneck | bottleneck_matrix | baseIds | `[baseIds]`（WO-Q2·json 槽） | 无 | baseIds 缺→全域（risk.ts） | **SAFE**（WO-Q2 已修·baseIds 达） |
| ceo_base_outlook | base_capacity_outlook | baseId | `[baseId]` | 无 | `if(!baseArg) throw validationError`（**诚实典范**） | **SAFE**（诚实报错典范·service.ts:2534） |
| **ceo_whatif** | **generic_inference** | **scopeObjectIds, factors**（+mode/targetType/targetProp/topK 常量） | **`[baseId,factors]` → `[scopeObjectIds,factors]`** | **scopeObjectIds** | **名字不对接**：路由发 `scopeObjectIds`，槽叫 `baseId` → 旧映射 `["{{slots.baseId}}"]` 串成 **`[null]`** → `discoverLevers` scope=`["null"]` | **✅ CONFIRMED（名字不对接丢参·seed.ts:543）** |
| ceo_capacity_threshold | capacity_forecast(mode:threshold) | modelId, weeks | `[modelId, weeks]`（专门映射+mode 常量） | 无 | capacity_forecast threshold | **SAFE**（专门映射·mode 常量注入） |
| capacity_feasibility※ | capacity_forecast | model, demandDelta, weeks | 种子槽 `[model(objectRef), demandDelta, weeks]` | 无 | capacity_forecast | **SAFE**（声明齐）※非 ceoCap·`capacity_forecast` route 落此意图 |

## B. sim-planner plans（`apps/agentcore/src/agent/sim-planner.ts` · 只读）

sim-planner 走 **compose 路径**（`compileSolverPlan(query, navSlice, slots)`）——`*ComposeSlots()` 产出的 slots **直传** solver args，**不经 ceoCaps 的 slotNames 声明层**，故无"路由解析 vs slotNames"丢参接缝。

| 入口 | 求解器链 | composeSlots | 判定 |
|---|---|---|---|
| `buildSimNavSlice` | portfolio ⊕ affected_orders ⊕ mrp_netting | `{scenarios}` | **SAFE**（slots→solver args 直传） |
| `buildCapacityNavSlice` | gap_attribution(scope) ⊕ capacity_forecast | `{scope:{baseId,factorId}}` | **SAFE**·**正范式**：把 `scope` 塞给 `gap_attribution`（与 solver 读 `args.scope.*` 一致）——正是 ceo_root_cause 缺的对接（对照组） |
| `buildFeasibilityNavSlice` | capacity_forecast | `{modelId, demandDelta, weeks}` | **SAFE**（声明齐） |

## C. 意图目录（seed 20 场景 + Base 4 意图）

- **20 场景派生意图**（`SCENARIO_CATALOG`·slots `[]`）：plan solverArgs = `card.presetContext.slotPresets` / `ARG_OVERRIDE`（**常量直传·非 `{{slots}}` 路由注入**）——场景卡启动预置路径，非 `resolveCeoRoute` 深问路径，无路由丢参面。**SAFE**（诚实边界：这些是"点场景卡零反问直达"的预置，不吃 NL 路由解析实体）。
- **Base 4 意图**（affected_orders / capacity_feasibility / risk_root_cause / adopt_mitigation）：有真 slots + `defaultFrom`，`{{slots.X}}` ⊆ 声明槽，经 fillSlots 由 classifier/domain-resolver 注入。逐一 **SAFE**（声明齐·无孤儿模板引用）。

## D. CONFIRMED 项 · 修复（Phase 2 · 两半一并）

### D-1 · ceo_credit_exposure（锚点）
- **数据半**（`apps/agentcore/src/mocks/seed.ts`）：`slotNames [] → ["custName"]` + 通用单字段映射产出 `{custName:"{{slots.custName}}"}` + custName 槽定义（string）。
- **引擎半·诚实化**（`apps/datacore/src/solvers/extended.ts` `deriveExtendedArgs` credit_exposure + `creditExposure`）：
  - 指定客户命中 → 该客户 + `scope:{mode:"CUSTOMER",custName}`（稳健匹配：精确→双向子串·治路由正则截尾拉丁「电网公司」→真实「电网公司F」）。
  - 指定客户**无匹配** → `throw AppError("AMBIGUOUS_SCOPE",…,400)`（错误信封·**不静默落首客户**）。
  - **未指定客户** → 全部客户合计 + `scope:{mode:"ALL",…}`（前端可见"未指定→全域合计"·**非首客户**）。
  - `credit_exposure` 输出形状加 `scope`（`SOLVER_OUTPUT_SHAPES`）。

### D-2 · ceo_whatif（名字不对接丢参）
- **数据半**（`seed.ts`）：槽 `baseId(string) → scopeObjectIds(json)` 对齐路由输出；专门映射 `scopeObjectIds:["{{slots.baseId}}"] → "{{slots.scopeObjectIds}}"`（whole-slot 数组注入）。有基地→`["changzhou"]` 真达；无基地→槽 null→整值 null→`discoverLevers` scope=undefined 全域（诚实）。
- **引擎半·防御**（`apps/datacore/src/solvers/service.ts` `discoverLevers`）：`scopeObjectIds` 过滤 `null/"null"/空` → 空则 undefined（避免 `["null"]` 冒充真作用域）。

## E. 本体引用与影响

- **链路**：`sys.scenario.launch`（本体 §3）——bug 落在 **plan→solverArgs** 接缝（`fillSlots` 只填声明槽）。
- **不变量（新增）R-ARG-FIDELITY**：路由解析出的过滤实体必达求解器或被显式声明/豁免；求解器缺过滤维不得静默返全域/首个（本体 §5 回写）。
- **断点（新增）G-ARG-DROP-SEAM**：路由解析→计划构建静默丢参 + 求解器全部/首个默认 → 静默错答（本体 §8 回写·Phase 3 门落地即闭）。
- **门（新增）** `arg-drop-seam:check`（`scripts/check-arg-drop-seam.mjs`·并入 `pnpm gates`·本体 §7 回写）。

## F. base 族续篇（WO-BASE-ID-FIDELITY · 2026-07-28 · 用户实测两症·同根：base 标识没穿到求解器 / 没对齐）

> 同 G-ARG-DROP-SEAM 病类（base 族）：路由/前端解析出 base 但**格式不规范 / 求解器无过滤维** → 静默错答或硬 400。
> 沿链路走（本体 §3）：`问句/前端「XX基地/obj_base_<id>」→ 解析 base → (compose slots | fillSlots) → solver`。**断点在接缝**：base 键形态不统一（`obj_base_<id>` 图节点 id vs 拼音 baseId vs 中文名）+ 求解器缺 base 过滤维。
> **③（作废·非本单）**：疑似「gap_attribution base×factor 根因树暂不可用」经 canonical 新构 datacore 亲验 **G-GAP-SCOPE 早已闭**（`{scope:{baseId}}`/`{scope:{baseId,factorId}}` 均返真根因树·noBaseData undefined）——用户所见「暂不可用」= 后端镜像陈旧未 rebuild datacore·非代码 bug。本单**不碰 gap_attribution**（service.ts 逐字节不动）。

**规范化单一出处（收敛·勿散落·可复用）**：`apps/datacore/src/solvers/types.ts` `normalizeBaseRef(ref)`——strip `obj_base_` 前缀 + object ref 取 id + trim；`risk.ts` `resolveBaseId`（唯一严格解析·未知 throw）与 `bottleneckMatrix.resolveRef` 均经它；`capacity.ts` base 过滤复用 `resolveBaseId`。

| # | 症状（用户实测·canonical 复现确认） | 数据/路由半（file:line） | 引擎半（file:line） | 判定 |
|---|---|---|---|---|
| ① | **base 静默丢（错答）**：`capacity_feasibility` 槽 `[model,demandDelta,weeks]` 无 base + `parseCapacityFeasibilityVariant` 不抽 base → 「常州基地 4680-NCM 加20%」≡「4680-NCM 加20%（全网）」（capacity_forecast 跑全网多基地·复现 net.p50=base.p50=12.3016） | `mocks/seed.ts` capacity_feasibility 补 `base` 槽（string·非必填）+ plan s2 专门透传 `base:"{{slots.base}}"`；`agent/sim-planner.ts` `parseCapacityFeasibilityVariant` 抽「XX基地」→ baseId（BASE_REGISTRY 单源）+ `feasibilityComposeSlots` 带 base | `solvers/capacity.ts` `capacityForecast` 可选 base 过滤（给 base→收窄该基地 cert·`scope:"BASE"`；无→`scope:"ALL"` 全网合计诚实标·不冒充）·`computeByProcessModel`/`computeBaselineDemand` 同尺度收窄 | **✅ CONFIRMED→已修**（复现后 base=常州 p50=5.5176≠全网12.3016） |
| ② | **base 格式不规范（硬 400）**：`affected_orders`→`resolveBaseId` 不识 `obj_base_changzhou`（`synthetic/service.ts:820 toId:obj_base_${baseId}` 产的图节点 id）→ `400 unknown base: obj_base_changzhou`；`changzhou`/`常州` 本已 200（复现确认·修很窄=多认 `obj_base_` 前缀） | —（前端/图发 `obj_base_<id>` 形态·无需改数据半） | `solvers/risk.ts` `resolveBaseId` 经 `normalizeBaseRef` strip `obj_base_` 前缀 → 认 `obj_base_<id>`/`<id>`/中文名/object ref；未知仍诚实 throw | **✅ CONFIRMED→已修**（obj_base_changzhou 200·三形态同订单集·未知仍 400） |

**门扩（`scripts/check-arg-drop-seam.mjs`·门有牙亲验）**：新增 `PROJECT_BASE_EMITS`（capacity_feasibility/affected_orders/risk_root_cause/adopt_mitigation）断言「吃 base 维 intent 的 base ∈ slotNames ∩ plan 任一步 {{slots.base}} 透传」（声明⊕透传双半齐）+ 两引擎哨兵（capacity `scope:"BASE"|"ALL"` 诚实标 · risk.resolveBaseId 经 normalizeBaseRef 归一）。**门牙测**：删 capacity_feasibility base 槽 → `pnpm --filter agentcore build` 后门变红（读 dist 编译产物·已亲验红/绿）。

**SEAM 测（接缝驱动·非各半绿）**：`apps/datacore/test/base-id-fidelity-seam.test.ts`（症② obj_base_×solver 规范化三形态同订单集/未知仍 400 + 症① 带基地 vs 全网真区分 scope:BASE/ALL/未认证 throw·2 测）；`apps/agentcore/test/base-id-fidelity-seam.test.ts`（parse→compose→compileSolverPlan 带 base + seed 意图/计划声明⊕透传 + compose 直路端到端 capacity_forecast args.base='changzhou'·6 测）。
