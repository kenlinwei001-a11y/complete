# WO-PORTFOLIO-OPTIMAL · 全订单×全基地×时间 联合最优组合推演（消灭「逐单求解=局部最优」）

> **已读系统本体 v（§8 截至 0614 全链审核）**，本次涉及：对象类型 `Order`/`WorkOrder`/`DemandSegment`/`Base`/`Line`（+`ChangeoverMatrix`）· 链路 `优化融合链路（G-12）`+新增`联合最优组合链路` · 不变量 `R6`/`R13`/`R14`/`R4`+新增`共享产能守恒` · 断点 新登 `G-PORTFOLIO-LOCAL-ONLY`（关联既有 `G-SOP-COMPOSE`/`G-ATP-PROMISE-VOID`/`G-UNIT-NORMALIZE`）。

## 派发 / 基线 / 分支

| 项 | 值 |
|---|---|
| **派发对象** | **整单一人做**（跨数据绑定 + CP-SAT 引擎 + 前端 + 金值·**不可拆两半**）。理由见 CLAUDE.md「跨数据/引擎两半的特性必须一个 dev 整单做」——本单数据种绑定（喂全订单/WIP/预测）× 引擎路由（新 CP-SAT 联合模型）× 前端（全局推演入口）任一半漏即接缝炸（metric-aware 反复炸的根）。 |
| **基线** | `claude/inspiring-gates-aqczjg` @ `0736908d`（原稿基于 c52f6600；canonical 已推进 scale-coherence + m11-fix + Tier-3〔metric-split/agent-timeout/cash-gm〕·89 类型/11082 实例·四包全绿。**依赖 SCALE-COHERENCE 已满足**——全订单×基地×时间联合最优可读真产能/真单价。dev 请 rebase 到 `0736908d` 开工，勿基 c52f6600） |
| **handoff 分支** | `claude/handoff-portfolio-optimal`（dev 建 → push，不碰正线；审核方 worktree 隔离复验 → cherry-pick 上 canonical） |

### ⚠ 依赖 note（先决条件·否则优化的是玩具级产能）
- **依赖 `WO-SCALE-COHERENCE`（产能须先尺度自洽）**：现状 `Line.capacityDaily = 72 + lineHash%29`（**72–100 套/日**·`battery.ts:2789`），而 `Order.qty` 为 **4033–21777 套**（`battery.ts` 种子）。单线日产 <100 套 vs 单订单上万套 = **玩具级产能颗粒**；若不先尺度自洽，联合优化在「几乎无产能」上求最优 → 全被挤、residual 爆表，最优解无业务意义。**本单可在 `WO-SCALE-COHERENCE` 未完成时先落算法与接线，但 SEAM 亲验的产能数字必须在尺度自洽后才作数**（WO 顶部显式标注此前提）。
- **单位归一（关联 `G-UNIT-NORMALIZE` §8:560）**：`DemandSegment.p50` 单位是**万套**（`battery.ts:744` `p50: 需求 P50(万)`；乘用车 201.7 = 201.7 万套），`Order.qty` 单位是**套**。喂进同一联合解前 **预测需求须 ×1e4 归一为套**（否则预测被当成几百套的零头，联合解退化）。此归一是**纯单位换算**（非业务常数·R14 例外，判定同 `wanToYi`）。

---

## 目标

把「项目推演」从**逐个项目 / 逐张订单单独求解（只到局部最优）**升级为**全订单 × 全基地 × 时间 的联合最优组合推演**：

1. **A·全局最优组合模式**：一次性选 **所有 `OPEN` 订单** + **在产订单（`WorkOrder`/WIP）** + **销售预测（`DemandSegment.p50`）** 作为联合需求集 → 跨基地 × 时间窗联合分配 → **全局最优**（目标可选 `max_ontime` 最多按期交 / `min_delay+cost` 最小总延误+代价 / 多目标权衡）。**共享产能不重复占用**：同一基地在同一时间窗的产能被跨所有订单**联合守恒**分配（`Σ_i qty_i·x[i,b,t] ≤ cap[b,t]`），根治「S4 双单同时提前 / S7 4 单批量分开 invoke 时两单都挤同一 `SO-3415` 产能 → 重复占用」。
2. **B·「暂停/冻结其他订单」选项**：What-if 入参 `frozenOrderIds` 指定冻结/排除某些订单再联合解——被冻订单**从决策集排除**且**其产能锁定/预留**（其余订单在残余产能上联合最优），支持「只保这几单看极限方案」（= 冻结其补集）。
3. **C（关联·另单 `WO-PROJECT-SIM-WHATIF` 承接量化矩阵）**：本单只需在输出里为全局解提供 **≥2 个可比方案**（`max_ontime` vs `min_cost`（vs `min_changeover`））+ **量化利弊真算差异**（各方案 按期数/总延误/换型/代价 分别回报），供前端矩阵展示。
4. **确定性 R6**：seed 固定 + CP-SAT 单线程 + 无挂钟时限 + 无 `Date.now`/`Math.random`（时间锚 = `forecastStart`）；同输入同参数版本 → 字节级一致。**R13** 每条分配/被挤/方案值带 provenance。

### 求解器路线判断（task 调研问 1/2 的结论）

> **判断：新建 `portfolio` 求解器（SOLVER_KEYS 54→55），而非扩 `assignment_optimize`/`cross_object_occupancy`。** 理由：
> - **`cross_object_occupancy`（`server.py:699` + `service.ts` `crossObjectOccupancy`）是最接近的骨架**——已有 `x[o,l]`+`served[o]`、**共享产能约束 `Σ_o qty·x[o,l] ≤ capacity[l]`**（`server.py:750`）、多目标（营收/违约金/换型 走 `weighted`/`epsilon`/`lexicographic`）、`displaced` 被挤订单。但它 **无时间维**（capacity 是单标量/线，非「基地×窗口」）、**无按期/延误目标**（served 是二值，无 delayDays）、**无 Order+WIP+预测 三源需求归一**。
> - **重复占用 bug 的本质是「时间」**：两单在各自交期前的**重叠窗口**都要 `SO-3415` 的产能。联合解必须把产能索引到 `(base, 时间窗)`：`Σ_i qty_i·x[i,b,t] ≤ cap[b,t]`——这是 `cross_object_occupancy` 结构性没有的维度，硬扩会破坏其既有 binding/测试。
> - **范围边界铁律「禁碰其他求解器算法」** → 不改 `cross_object_occupancy`/`assignment_optimize`，**新建 sidecar CP-SAT 模型 `portfolio_optimize`**，**复用**其多目标引擎 `_optimize_multi`（`server.py:556`）+ 确定性红线 `_new_solver`（`server.py:535`：`num_search_workers=1`+`random_seed`+无挂钟+`to_int(scale)`+tie-break）。
> - **承载模型**：新 sidecar 模型是 `cross_object_occupancy` 的「加时间窗」变体 = 装箱/指派族（每 `(base,窗口)` 是容量 bin，需求项按交期前可行窗口 mask 指派），目标走 `_optimize_multi` 多方案。**未配 `OPTIMIZER_BASE_URL` 显式「未接入」不兜底**（同既有 opt 族·本体 §3:315）。

---

## 🚦范围边界（只碰这些文件/包 = 本单「身份」）

**数据绑定 / 引擎半（datacore + optimizer sidecar）**
- `apps/datacore/src/solvers/service.ts` — `SOLVER_KEYS`(:30-128 加 `"portfolio"`) · `SOLVER_OUTPUT_SHAPES`(:136-198 加一条) · `invoke` if 链(:2913 旁加分支) · **新增私有方法 `portfolioOptimize(ctx,args)`**（照 `sopReschedule`:1769 / `atpCheck`:2139 模式，inline `listByType` 读对象）。
- `apps/datacore/src/solvers/portfolio.ts` — **新建**：纯算法（需求集组装 + 窗口 mask + payload 构建 + 结果后处理 + 共享产能守恒 reconChecks + 方案对比），照 `solvers/sop-reschedule.ts` 结构（纯函数·`coeff(k,dflt)` 注入·R6）。
- `apps/datacore/src/solvers/optimizer-client.ts` — 加 `PortfolioRequest`/`PortfolioResult` 接口 + `solvePortfolio?()`（可选方法·未实现调用方抛「未接入」）+ `HttpOptimizerClient.solvePortfolio`（走单端点 `/solve`·按 `model` dispatch·同 :313 `solveCrossObjectOccupancy` 范式）。
- `services/optimizer/server.py` — **新增 `solve_portfolio(payload)`** + 注册进 `MODELS`(:911-927)；复用 `_optimize_multi`/`_new_solver`/`_expr`/`_eval`。**禁碰** 既有 9 模型算法。
- `apps/datacore/src/catalog.ts` — 加 1 条目录条目到 `COCKPIT_SOLVER_CATALOG`(:73-88) 或 `GENERIC_SOLVER_CATALOG`(:95-116)（**建议 COCKPIT**·保 discover 计数 22 不变）。
- （**可选·R14 多行业**）`apps/datacore/src/solvers/opt-binding.ts` — 若要跨行业通用绑定，仿 `bindCrossObjectOccupancy`(:227) 加 `bindPortfolio()`；**电池 demo 主路径走 `service.ts` inline `listByType`（同 `sop_reschedule`），opt-binding 非必需**（见实施④诚实说明）。

**前端半（frontend-shell）**
- `apps/frontend-shell/src/views/sim/GlobalSimView.tsx` — **新建**全局联合推演视图（订单多选 + 冻结/排除勾选 + 方案对比矩阵）。
- `apps/frontend-shell/src/views/registry.ts` — `:61` 后加 `registerRenderer("global-sim", ()=>import("./sim/GlobalSimView"))`（+ 可选 `VIEW_ALIAS` :25-39 别名）。
- `apps/frontend-shell/src/pages/ShellLayout.tsx` — `:38`「推演」组 items 加 `"global-sim"`。
- `apps/frontend-shell/src/mocks/fixtures.ts` — `:429` 旁加视图下发条目 + `:102` 旁加 feature `view.global-sim`（`bindings.solverKeys:["portfolio"]`·否则 `handlers.ts:2142` 404）。
- `apps/frontend-shell/src/mocks/handlers.ts` — `:2138` `/b/v1/solvers/:key/run` dispatch 内加 `portfolio` 分支（照 `:2204` sop_reschedule）。
- `apps/frontend-shell/src/mocks/simSolvers.ts` — 新增 `mockPortfolio`（照 `mockSopReschedule`:969·逐口径移植真算法·KILL-MOCK-RED·徽标「推演结果·非数据库事实」）。
- **复用不改**：`useLiveSolver.ts:19`（传 args 即可·无需改 api client）· `endpoints.ts:202 runSolver`。

**金值 / 测试**
- `apps/datacore/test/ontology-core.test.ts:490`（`toBe(54)`→`55`）· `apps/datacore/test/catalog.test.ts`（:54-56 相对断言自动跟随·若目录条目误加进 `SOLVER_CATALOG` 则 :16 `toBe(22)`→23·**故加 COCKPIT/GENERIC**）· **`apps/datacore/test/databuilder.test.ts:78-83`**（遍历 `SOLVER_KEYS` 断言每 key 有非空 `SOLVER_OUTPUT_SHAPES` → **必须同步补 ②**）。
- 新增 `apps/datacore/test/portfolio.test.ts`（默认门·mock optimizer + 输出守恒 reconChecks）+ `apps/datacore/test/portfolio-sidecar.integration.test.ts`（`skipIf(!OPTIMIZER_BASE_URL)`·真 CP-SAT）+ 前端 `apps/frontend-shell/test/portfolio-globalsim.test.tsx`。

**⛔ 禁碰**：`cross_object_occupancy`/`assignment_optimize`/`sop_reschedule`/`multi_objective`/`optimize_whatif` 等**其他求解器算法**（只复用其 sidecar 多目标引擎 `_optimize_multi`，不改其模型）；不动对象类型 schema（`battery.ts` 不新增类型 → demo-chain/objectType 金值不变）。

---

## 实施（编号·file:line）

### ① 选/扩求解器承载联合指派 —— 新建 `portfolio_optimize` CP-SAT 模型
- **sidecar `services/optimizer/server.py`**：新增 `solve_portfolio(payload)`，注册进 `MODELS`(:924 旁)。模型（复用 `_optimize_multi` :556 + `_new_solver` :535）：
  - **需求项集** `items:[{id, qty, dueWindow, eligibleBases, model, kind:"order"|"wip"|"forecast"}]`——联合需求（订单/在产/预测三源归一）。
  - **决策变量** `x[i,b,t] ∈ {0,1}`（需求项 i 由基地 b 在时间窗 t 承接）+ `served[i]`（是否获排）；跨基地拆产用 `qty` 分摊整型变量（照 `sop_reschedule` 跨基地拆产语义）。
  - **可行窗口 mask**：`x[i,b,t]` 仅在 `t ≤ item.dueWindow` 且 `b ∈ item.eligibleBases` 时建变量（资格 mask·同 `assignment` 的 cost mask :103）。
  - **共享产能约束（核心·防重复占用）**：对每 `(base b, 窗口 t)` — `Σ_i qty_i · x[i,b,t] ≤ cap[b,t]`（`cap[b,t] = Σ 该基地 Line.capacityDaily × 窗口天数 × (1−util/100)`）。**这是「共享产能守恒」不变量的引擎落点**。
  - **每需求项至多一处**：`Σ_{b,t} x[i,b,t] == served[i]`（无窗口可行 → served 强制 0，同 `cross_object_occupancy` :742）。
  - **目标（多方案·走 `_optimize_multi`）**：`ontime = Σ served_i·按期`（max）· `delay = Σ 延误天×qty`（min）· `changeover = Σ 换型分钟`（min，取 `ChangeoverMatrix`）· `cost = Σ 加班/延误/换型代价`（min）。`method` 走 `weighted`/`epsilon`/`lexicographic`（同 `multi_objective`），各目标值分别回报（`objectiveValues`）。
  - **确定性**：`num_search_workers=1`+`random_seed=seed`+无 `max_time_in_seconds`+`to_int(scale)`+tie-break（照 :773 稳定序）。
- **`optimizer-client.ts`**：加 `PortfolioRequest{model:"portfolio", seed, scale?, items, bases:[{id,windows:[{t,cap}]}], changeover?, objectives?, method?, frozen?}` / `PortfolioResult{status,optimal,values,objectiveValues,occupancy:[{item,base,window,qty}],displaced,scenarios?,summary}` + `solvePortfolio?()`（:247 旁）+ `HttpOptimizerClient.solvePortfolio`（:313 范式·走 `/solve`）。

### ② 冻结子集入参 `frozenOrderIds` —— 从解集排除并锁其产能
- `portfolioOptimize(ctx,args)` 接 `args.frozenOrderIds: string[]`。
- **排除**：被冻订单**不进 `items`**（不建 `x[i,·,·]` 变量·不被优化）。
- **锁产能（预留）**：被冻订单当前承诺量按其（现）承接基地×窗口 **从 `cap[b,t]` 预扣**（`cap'[b,t] = cap[b,t] − Σ_{被冻 j 占该(b,t)} qty_j`）→ 其余订单在**残余产能**上联合最优（模型「冻结这几单不动、其余围着它优化」）。
- **可选 `frozenCapacityMode: "reserve"（默认锁）| "release"（释放）`**：`release` 用于「只保这几单」——冻结补集且释放其产能，看极限方案。（默认 `reserve` 对应 task ②「排除并锁其产能」的字面语义。）
- **诚实边界**：被冻订单在输出里标 `frozen:true`（不参与 served/displaced 统计·R13 透明）。

### ③ 目标可选 → 出多方案（≥2 可比·量化利弊）
- `args.objective: "max_ontime" | "min_cost" | "min_changeover"`（缺省 `max_ontime`）单方案；`args.scenarios: ["max_ontime","min_cost",...]`（≥2）→ 对每目标各求一次联合解（seed 固定·R6），汇成 `scenarios:[{key, objectiveValues:{ontime,delay,changeover,cost}, servedCount, displacedCount, allocation}]`。
- **量化利弊真算**（非贴标签）：各方案的 按期数/总延误/换型分钟/总代价 由**同一联合解真算**回报（改目标 → 分配与各目标值**真漂移**）。供 `WO-PROJECT-SIM-WHATIF` 前端矩阵直接消费。

### ④ 喂全订单 + WIP + 预测（数据绑定·inline `listByType`·同 `sop_reschedule` 兄弟）
> **诚实说明**：本类求解器（`sop_reschedule`:1772 / `atp_check`:2150）在 `invoke` if 链拦截、**私有方法内 inline `listByType`**，**不走 `loadContext`（那服务 `compute()` switch 的电池金字塔）、不经 `opt-binding`（那是抽象 5 核心 + `cross_object_occupancy` 的多行业绑定）**。`portfolioOptimize` 照此模式：
- `Order`（`OPEN`）：`listByType(tenantId,"Order")`（:1772 范式）→ 每单 `{so,model,qty(套),due,bases(可产基地),pri,cust}`。
- `WorkOrder`（在产 WIP·**未完工**）：`listByType(...,"WorkOrder")`（:2151 范式）→ 过滤 `status ∉ {已完成,已关闭} && qtyActual>0`（排除完工单避免与 FG 双算·同 `atp_check` :2245）→ 每单 `{modelId, qtyActual, baseId, endDate}` 作**在产需求项**（占用其在产基地×窗口产能）。
- `DemandSegment`（预测）：`listByType(...,"DemandSegment")`（先例 :1651/:2031/:2062）→ `{segId,segment,p50(万套),priceWan}`；**`p50 × 1e4` 归一为套**（依赖 note·G-UNIT-NORMALIZE）作**预测需求项**（`kind:"forecast"`·可产基地取该型号全集/兜底全基地）。
- `Base`：`{baseId,name,util}`（:1773）· `Line`：`{baseId,capacityDaily}`（:1774）· `ChangeoverMatrix`：`{fromModel,toModel,minutes}`（:1775·供 `min_changeover` 目标）。
- 时间锚 `forecastStart = getParams(...).forecastStart`（:1787·**禁 `Date.now`·R6**）；系数走 PUBLISHED `RuleEntry("portfolio_optimize_coeffs").params`（照 `sop_reschedule_coeffs` :1778·**R14 可校准·缺省诚实兜底**）。
- **组装**：三源需求项归一为统一 `items`（`qty`统一套·`dueWindow`由 `due−forecastStart` 折算窗口·`eligibleBases`取订单 `bases`/型号可产基地）→ 构建 `(base,窗口)` 产能表 → 调 `optimizer.solvePortfolio(...)`。

### ⑤ 前端全局模式入口 + 方案对比矩阵渲染
- **视图** `GlobalSimView.tsx`（新建）：
  - **订单多选**（补「读所有订单联合求解」那根缺线·当前 `ProjectSimView` 订单只填参不进 args·mock 用硬编码 `SOP_ORDERS`）：`searchObjects("Order","")`（`ProjectSimView.tsx:173` 范式）→ 列表**多选/全选** → **订单集真传进 args**（`orderIds`/或空=全 OPEN）。
  - **冻结/排除 UI**（当前不存在）：每单勾选框 → 写入 `args.frozenOrderIds`。
  - **方案对比矩阵**：复用 `SimComparePanel.tsx` 差异表骨架 / `ProjectSimView.tsx:429-472` `bottleneck_matrix` 表格样式，维度改为 **订单×方案** 或 **方案×指标（按期/延误/换型/代价）**；被挤单展示复用 `SopReschedulePanel.tsx:55-78` / `MultiObjWhatifPanel.tsx:145-165` 范式。
  - 调用：`useLiveSolver("portfolio",{orderIds,frozenOrderIds,scenarios},parse)`（`useLiveSolver.ts:19`·底层 `endpoints.ts:202 runSolver`→`/b/v1/solvers/portfolio/run`·**无需改 api client**）。
- **注册**：`registry.ts:61` 加 renderer · `ShellLayout.tsx:38` 加导航 · `fixtures.ts:429/:102` 加视图下发 + feature（`solverKeys:["portfolio"]`）。
- **MSW**：`handlers.ts:2138` 加 `portfolio` 分支 · `simSolvers.ts` 加 `mockPortfolio`（逐口径移植真算法·改 orderIds/frozenOrderIds→方案真变·KILL-MOCK-RED）。

### ⑥ 注册 catalog + SOLVER_KEYS + 金值
- `service.ts:127`（`"sop_reschedule"` 后·`] as const` :128 前）加 `"portfolio",` → `SOLVER_KEYS` 54→55。
- `service.ts:190` 附近 `SOLVER_OUTPUT_SHAPES` 加 `portfolio: ["status","optimal","feasible","allocation","occupancy","displaced","scenarios","objectiveValues","capacityLedger","reconChecks","reconciled","cost","frozen","summary"]`（**databuilder.test:78-83 强制·task 原清单遗漏此项**）。
- `service.ts:2913` 旁加 `if (solverKey === "portfolio") return this.portfolioOptimize(ctx, args);`。
- `catalog.ts` `COCKPIT_SOLVER_CATALOG`(:88 末) 加 `{ key:"portfolio", name:"全局联合推演", description:"全订单×全基地×时间联合最优组合——共享产能不重复占用、支持冻结子集、多方案量化利弊（CP-SAT 可证最优）", argHints:{orderIds:"订单集(缺省=全OPEN)", frozenOrderIds:"冻结/排除订单(可选)", scenarios:"方案集 max_ontime|min_cost|min_changeover(≥2)"}, domain:"plan" }` → `ALL_SOLVER_CATALOG` 54→55（`catalog.test.ts:54-56` 相对断言自动跟随·discover 计数 22 不变）。
- `ontology-core.test.ts:490` `toBe(54)`→`toBe(55)`。
- **无新增对象类型** → demo-chain-provenance / objectType 金值**不变**。

---

## SEAM 判据（组合测·活系统亲验·审核头号判据）

> **铁律**：CP-SAT 求解器有两条测试路——① 默认门用**脚本 mock optimizer**（`setOptimizer(mock)`·如 `opt-multiobj.test.ts:51`），mock 只回预置数据、**证不了约束**；② `skipIf(!OPTIMIZER_BASE_URL)` **真 sidecar 集成测**（`opt-real-sidecar.integration.test.ts:21` / `jobshop-schedule.test.ts:142`）。**「共享产能无重复占用」是真 CP-SAT 约束的产物，mock 冒充即「绿测试≠能用」**。故 SEAM 判据分两层，**审核复验头号判据 = 真 sidecar 亲跑无重复占用 + 单/联对拍**，非各半绿：

**层1·输出内不变量守恒（默认四包门·mock 也逃不掉）**
- `portfolio` 结果携带 `capacityLedger:[{baseId,window,cap,allocated}]` + `reconChecks`，断言**对每个 `(base,窗口)`：`allocated = Σ_i qty_i·x[i,b,t] ≤ cap[b,t]`** → `noDoubleOccupancy:true`、`reconciled:true`（照 `sop_reschedule` reconChecks :179 / `supply_demand` 勾稽末叶分摊）。**mock 若回一个超发解 → reconChecks 必 false**（默认门就此咬住畸形 mock）。
- `portfolio.test.ts`（默认门）：注入回「合法 CP-SAT 形状解」的 mock → 断言 `capacityLedger` 每格 `allocated ≤ cap`、`Σscenarios ≥ 2 且各 objectiveValues 不同`、`frozenOrderIds` 项标 `frozen` 不入 served/displaced、每分配带 provenance。

**层2·真 CP-SAT 亲验（`portfolio-sidecar.integration.test.ts`·`skipIf(!OPTIMIZER_BASE_URL)`·活系统亲跑）**
- **① 全 24 单 × 4 基地联合解 → 无重复占用**：起真 `services/optimizer`（`PORT=4003 python server.py`）+ `OPTIMIZER_BASE_URL` → `seedBattery` → `invoke(ADMIN,"portfolio",{})`（全 OPEN + WIP + 预测）→ 断言**每 `(base,窗口)` Σ 分配 ≤ 产能**（非各单独立超发）·`status=OPTIMAL`。
- **② 单/联对拍（接缝头号·证「联 ≠ 分开」）**：分别 `invoke("sop_reschedule",{targetOrderId:SO-A})` 与 `invoke("sop_reschedule",{targetOrderId:SO-B})`（两单都挤 `SO-3415`·`sop-reschedule.test.ts:37` 已证单单都会挤它）→ 两解合并 `SO-3415` 窗口 **Σ > cap（重复占用）**；同输入 `invoke("portfolio",{})` → `SO-3415` 那格产能**只被指派一次·Σ ≤ cap**。**断言：分开模式重复占用、联合模式守恒**——这是「逐单=局部/联合=全局」的接缝真证。
- **③ 冻结真排除 + 锁产能**：`invoke("portfolio",{frozenOrderIds:["SO-3415"]})` → `SO-3415` 标 `frozen`、不在 served/displaced、其产能被预扣（其余单在残余产能联合解·断言解随之变）。
- **④ ≥2 方案量化利弊真差异**：`invoke("portfolio",{scenarios:["max_ontime","min_cost"]})` → 两方案 `objectiveValues.ontime`/`.cost` **实测不同**（`max_ontime` 按期数 ≥、`min_cost` 代价 ≤）·每方案每值带 provenance（R13）。
- **⑤ R6**：同 seed 双跑字节一致（`allocation`/`objectiveValues` 逐字段相等）。
- **⑥ 活系统亲验（绿测试≠能用·亲手真跑）**：dev **必须** 亲起真 sidecar 跑通 ①–⑤ 并在 handoff 贴证据（分配台账 + 单/联对拍数字）；审核方 worktree 独立 checkout **亲手复跑真 sidecar**，不看 mock 绿。

---

## DoD（交付底线）

- [ ] **四包全绿**：`pnpm -r build && pnpm -r --workspace-concurrency=1 test`（datacore 勿并发多 vitest）——datacore（+`portfolio.test.ts`）/ agentcore / frontend（+`portfolio-globalsim.test.tsx`）/ contracts 全绿。
- [ ] **SEAM 无重复占用亲验**：真 `services/optimizer` + `OPTIMIZER_BASE_URL` 起 → `portfolio-sidecar.integration.test.ts` 全过 + **手跑贴证据**（全 24 单每格 Σ≤cap·单/联对拍 `SO-3415` 分开超发 vs 联合守恒·冻结真排除·≥2 方案真差异）。
- [ ] **金值**：`SOLVER_KEYS` 55（`service.ts:127`+`ontology-core.test.ts:490`）· `SOLVER_OUTPUT_SHAPES` +1（`databuilder.test:78-83` 绿）· `ALL_SOLVER_CATALOG` 55（`catalog.test.ts:54-56` 绿·discover 22 不变）。
- [ ] **确定性 R6**：无 `Date.now`/`Math.random`·CP-SAT 单线程+seed+无挂钟·同输入同参数版本字节一致。
- [ ] **R13**：每分配/被挤/方案值带 `provenance{drillType:Line/Order/WorkOrder/DemandSegment, drillField, drillValue}`。
- [ ] **R14**：系数走 `RuleEntry(portfolio_optimize_coeffs).params`·无内联业务常数·`debattery:check` 不回潮·前端 `p50×1e4` 仅纯单位换算。
- [ ] **本体回写**（不回写即过期失效）：`docs/SYSTEM-ONTOLOGY.md` §2（对象类型触及）/§3（新增`联合最优组合链路`）/§5（新增不变量`共享产能守恒`）/§8（新登 `G-PORTFOLIO-LOCAL-ONLY` 标 ✅ 已闭）。
- [ ] **push** `claude/handoff-portfolio-optimal`（不碰正线）。
- [ ] 依赖 `WO-SCALE-COHERENCE` 未完成时：显式标注「产能尺度自洽后 SEAM 数字方作数」。

---

## 《本体引用与影响》

**对象类型（§2）**
- `Order`（product 域·`OPEN`·so/model/qty(套)/due/bases/pri）· `OrderLine`（残口·行级消费下沉·本单读头级）
- `WorkOrder`（factory 域·在产 WIP·qtyActual/status/baseId·排除完工单）
- `DemandSegment`（forecast 域·p50(万套)·预测需求源·×1e4 归一）
- `Base`（factory 域·util）· `Line`（factory 域·capacityDaily 套/日）· `ChangeoverMatrix`（换型分钟·min_changeover 目标）

**链路（§3·新增）** —— 追加到「优化融合链路（G-12）」(:312-329) 后，并仿 `G-SOP-COMPOSE` 链体登记：
```
{全 OPEN Order + 在产 WorkOrder + DemandSegment.p50(×1e4)} --portfolioOptimize(inline listByType·forecastStart 锚·R6)-->
  统一需求项 items[{qty,dueWindow,eligibleBases}] × (Base×窗口)产能表 cap[b,t]
  --optimizer.solvePortfolio → sidecar solve_portfolio(x[i,b,t]·Σ_i qty·x≤cap[b,t]·served[i]·_optimize_multi 多目标)-->
  {occupancy(基地×窗口×qty·Line/WorkOrder 溯源) ⊥ displaced(Order 溯源) + scenarios(≥2·objectiveValues) + capacityLedger + reconChecks}
  经 `/a/v1/solvers/portfolio/invoke`（B 侧 `/b/v1/.../run`）  ⚠ 未配 OPTIMIZER_BASE_URL 显式「未接入」不兜底
  ⚠ SEAM 铁律：改 Line.capacityDaily/订单集/frozenOrderIds → 联合最优真变（共享产能守恒·单/联对拍 SO-3415 不重复占用）
  ⚠ R4：推演模拟态禁写真值（RL4）；采纳走 ActionDraft 正门
```

**事件（§4）**：求解器 invoke 为**读/算**（无副作用·不发领域事件）；采纳经 `ActionDraft` 走正门（R4）——**无新增 L-event**（模拟态禁写真值 RL4）。

**不变量（§5）**
- `R6` 确定性（seed + CP-SAT 单线程 + 无挂钟 + `forecastStart` 时间锚·无 `Date.now`/随机）
- `R13` 每分配/被挤/方案值 provenance 可溯
- `R14` 系数 `RuleEntry.params`·应用层无业务常数
- `R4`/`RL4` 模拟态禁写真值·采纳走 Action
- **新增 `共享产能守恒`**（回写 §5·或作链路 SEAM 铁律）：**`∀(base b, 窗口 t): Σ_{跨所有订单 i} qty_i·x[i,b,t] ≤ cap[b,t]`**——跨单联合守恒、非各单独立超发；`reconChecks` 硬校验、`capacityLedger` 逐格亮出（与 `sop_reschedule` 端内勾稽、`supply_demand` 双向勾稽同族的守恒纪律）。

**断点（§8·新登）**
- **`G-PORTFOLIO-LOCAL-ONLY`**（本单闭）：**推演逐个项目/逐张订单单独求解 → 只到局部最优·无跨单联合**。审核实测坐实（`sop_reschedule` 边界）：S4（双单同时提前）/S7（4 单批量）分开 invoke 时**两单都挤同一 `SO-3415` 产能 → 重复占用**（`sop-reschedule.test.ts:37` 单单都排 `SO-3415` 让位·分开求解各自假设其产能可用 → 双占）；`cross_object_occupancy` 有共享产能约束但**无时间维、无 Order+WIP+预测三源、无冻结子集** → 切不出「全订单×全基地×时间」全局解。→ **✅ 已闭（`portfolio` 求解器·新 sidecar CP-SAT `solve_portfolio` + service 委派·净室复用 `_optimize_multi`·无新对象类型）**：全 OPEN 订单+在产 WorkOrder+DemandSegment.p50 归一联合需求 → `Σ_i qty_i·x[i,b,t]≤cap[b,t]` 共享产能守恒（无重复占用）→ 支持 `frozenOrderIds` 冻结子集 → ≥2 方案量化利弊。SEAM 真 sidecar 亲验单/联对拍。
- 关联既有：`G-SOP-COMPOSE`(:562·单订单重排·本单泛化到全订单联合)·`G-ATP-PROMISE-VOID`(:567·残口「三源共享产能未按型号分摊」本单以联合守恒推进)·`G-UNIT-NORMALIZE`(:560·p50 单位归一)。
