# WO-L7A 交付说明 · 内置求解器 10 类决策问题归档

分支 `claude/handoff-wo-l7a-solver-taxonomy`（base = `origin/claude/inspiring-gates-aqczjg` @ `69804185`）。
**纯分类单：不动任何求解器实现、不改任何 key 名（改 key = 断链）、不碰 agentcore / frontend-shell / SYSTEM-ONTOLOGY.md。**

---

## 0 · 分支判据（用祖先关系，不用「某文件在不在」）

```
$ git merge-base --is-ancestor HEAD origin/claude/inspiring-gates-aqczjg; echo "ANCESTOR_RC=$?"
ANCESTOR_RC=0            # HEAD 是 canonical 的祖先 ⇒ 落后，必须重开
$ git checkout -B claude/handoff-wo-l7a-solver-taxonomy origin/claude/inspiring-gates-aqczjg
$ git rev-parse HEAD
69804185f90e7961bd6b182207bdb114d7dbc2a5
```

环境前置两条都真跑了（否则会报与本单无关的假红）：`pnpm install --prefer-offline`、
`pnpm --filter @platform/contracts build`。另外 `pnpm --filter datacore typecheck` 起初报
`Cannot find module '@platform/llm-adapters'` —— 这是 **llm-adapters 未 build 的假红**，
`pnpm --filter @platform/llm-adapters build` 后消失，与本单无关。

---

## 1 · 实测的 solver 总数与命令：**59**（文档里的 57 已过期）

### 1.1 先自证工具（金丝雀），再报数

抽取脚本与金丝雀**共用同一份 `extract()` 实现**（不许各抄一份正则 —— 抄了就是装饰品）：

```js
// 剥掉行注释再取引号内的 key（注释里有中文引号/方括号，不剥会混进来）
const m = src.match(/export const SOLVER_KEYS = \[([\s\S]*?)\n\] as const;/);
const body = m[1].split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
return [...body.matchAll(/"([A-Za-z0-9_]+)"/g)].map((x) => x[1]);
```

```
$ node extract-solver-keys.mjs apps/datacore/src/solvers/service.ts
✅ 金丝雀命中：capacity_forecast 在第 2 位
✅ 反证金丝雀未命中：definitely_not_a_solver_key
SOLVER_KEYS 总数 = 59，重复 = 无
```

正向金丝雀（确定在册的 key 必须命中）与**反证**金丝雀（确定不在册的 key 必须不命中）都跑了 ——
只有正向会漏掉"正则过宽把注释吞进来"这一类坏法。

### 1.2 五个互相独立的口径都是 59（不是同一个数字被抄了五遍）

| # | 口径 | 命令 / 位置 | 结果 |
|---|---|---|---|
| 1 | 静态解析源码 | 上面的 `extract-solver-keys.mjs` | `59`，零重复 |
| 2 | **类型层穷举**（编译期） | `Record<(typeof SOLVER_KEYS)[number], SolverCategory>` + `pnpm --filter datacore typecheck` | `RC=0` |
| 3 | 资源投影门 | `node scripts/check-resource-descriptor.mjs` | `solver:59` |
| 4 | 全链闭包门 | `node scripts/check-chain-closure.mjs` | `求解器注册表：59 个` |
| 5 | 本体一致性门 | `node scripts/check-system-ontology.mjs` | `SOLVER_KEYS 59 个，本体覆盖 59 个` |

既有金值 `apps/datacore/test/ontology-core.test.ts:497` 也是 `toBe(59)` —— **与实测一致，无需改动**。
`docs/ONTOLOGY-7ELEM-AUDIT.md` 等文档里写的 57 是过期值（该文件不在本单范围，未动）。

---

## 2 · 10 个类目的定义

**归纳原则**：按「**解决什么决策问题**」分，**不**按「用什么算法」分。
所以 `job_shop_schedule`（CP-SAT）与 `changeover_sequence`（贪心）同属「计划与排程」——
它们回答同一句话；`margin_attribution`（净室通用）与 `plan_rootcause`（电池域）同属「归因与根因诊断」，
尽管一个通用一个专用。类目判据写成**问句**而不是名词，是为了让归类可证伪：
一个 solver 属不属于本类，看它回答的是不是这句话。

定义在 `packages/contracts/src/solver-taxonomy.ts`（`SOLVER_CATEGORIES` + `SOLVER_CATEGORY_META`）。

| 类目 key | 类目 | 决策问句 | 条数 |
|---|---|---|---|
| `capacity_bottleneck` | 产能与瓶颈 | 产能够不够、被哪道工序/哪个共享资源卡住了？ | 6 |
| `planning_scheduling` | 计划与排程 | 谁在什么时候、按什么顺序、在哪个基地做？这版计划行不行？ | 9 |
| `material_inventory` | 物料与库存 | 料够不够齐套、缺口补多少、库存水位摆在哪？ | 4 |
| `risk_propagation` | 风险预警与影响传导 | 未来会不会出事、什么时候越线、会波及到谁？ | 6 |
| `root_cause_attribution` | 归因与根因诊断 | 为什么没达标？缺口一路归到哪些根因、各占多少、证据是什么？ | 6 |
| `countermeasure_closure` | 对策与缺口闭合 | 怎么补？有哪些方案、各自代价多大、组合起来能收窄多少？ | 5 |
| `order_commitment` | 商务接单与承诺 | 这单能不能接、能接多少、何时交、赚不赚、客户能不能欠？ | 4 |
| `performance_finance` | 经营绩效与财务测算 | 经营指标达成多少、钱怎么样、这笔投入投不投？ | 6 |
| `combinatorial_allocation` | 通用组合最优化 | 给定候选集与约束，选谁/分给谁/装哪/怎么流，才是可证最优的组合？ | 10 |
| `whatif_exploration` | 假设推演与关联探查 | 把某个假设值改掉，下游会怎样？沿本体从这里能关联到什么？ | 3 |

**合计 6+9+4+6+6+5+4+6+10+3 = 59**，10 个类目，成员互不重叠（是**划分**，不是打标签）。

### 几个边界判断（说明理由，便于复议）

- **`sequencing_optimize` / `job_shop_schedule` 归「计划与排程」而非「通用组合最优化」**：
  它们和其余 CP-SAT 族同用一套引擎，但回答的是「按什么顺序 / 什么时候做」——
  与 `changeover_sequence`、`cert_schedule` 同一句问话。按问题分，不按算法分。
- **`portfolio` / `sop_reschedule` 归「计划与排程」而非「通用组合最优化」**：
  它们回答具体的「订单交付怎么排」；`assignment_optimize` 等回答抽象的「给定候选与约束怎么选最优」，
  不预设业务对象。区别在**决策语境是否具体**，不在算法。
- **`shared_bottleneck` / `concentration_risk` / `margin_attribution` / `supplier_disruption_radius` /
  `generic_inference` / `ontology_query` 虽同属仓内 `GENERIC_SOLVER_CATALOG`，却分散在 4 个不同类目** ——
  可见本分类**不是**既有 `GENERIC/COCKPIT/SOLVER_CATALOG` 三池划分的镜像，也不是 `domain` 字段
  （plan/decision/generic/commercial 四值）的换皮。
- **`carbon_footprint` 归「经营绩效与财务测算」**：它算的是单位产品碳成本、对标阈值差多少 ——
  是一本经营账，不是一个独立的合规决策问题（单独成类会造出一个只有 1 条的摆设类目）。

---

## 3 · 59 条逐条映射表（一条不漏，非抽样）

下表由脚本**从构建产物读回**生成（`apps/datacore/dist/solvers/taxonomy.js` + `dist/catalog.js`），
不是手抄；生成前先跑金丝雀 `capacity_forecast → capacity_bottleneck` + 反证金丝雀未命中。
行序 = `SOLVER_KEYS` 声明序。

| # | solver key | 中文名 | 类目 key | 类目 |
|---|---|---|---|---|
| 1 | `capacity_rollup` | 产能上卷 | `capacity_bottleneck` | 产能与瓶颈 |
| 2 | `capacity_forecast` | 产能推演 | `capacity_bottleneck` | 产能与瓶颈 |
| 3 | `bottleneck_matrix` | 瓶颈矩阵 | `capacity_bottleneck` | 产能与瓶颈 |
| 4 | `risk_timeline` | 风险时间线 | `risk_propagation` | 风险预警与影响传导 |
| 5 | `affected_orders` | 受影响订单 | `risk_propagation` | 风险预警与影响传导 |
| 6 | `plan_audit` | 计划体检 | `planning_scheduling` | 计划与排程 |
| 7 | `plan_generate` | 计划生成 | `planning_scheduling` | 计划与排程 |
| 8 | `capex_scenario` | 年度情景测算 | `performance_finance` | 经营绩效与财务测算 |
| 9 | `mitigation_select` | 处置方案优选 | `countermeasure_closure` | 对策与缺口闭合 |
| 10 | `cert_schedule` | 认证排期 | `planning_scheduling` | 计划与排程 |
| 11 | `kit_readiness` | 物料齐套 | `material_inventory` | 物料与库存 |
| 12 | `lta_gap` | 长协补缺 | `material_inventory` | 物料与库存 |
| 13 | `inventory_optimize` | 库存优化 | `material_inventory` | 物料与库存 |
| 14 | `changeover_sequence` | 换型排序 | `planning_scheduling` | 计划与排程 |
| 15 | `yield_diagnosis` | 良率诊断 | `root_cause_attribution` | 归因与根因诊断 |
| 16 | `maintenance_stagger` | 检修错峰 | `planning_scheduling` | 计划与排程 |
| 17 | `outsourcing_split` | 外协分配 | `countermeasure_closure` | 对策与缺口闭合 |
| 18 | `quote_margin` | 接单毛利 | `order_commitment` | 商务接单与承诺 |
| 19 | `credit_exposure` | 信用敞口 | `order_commitment` | 商务接单与承诺 |
| 20 | `quarterly_gap` | 季度缺口对策 | `countermeasure_closure` | 对策与缺口闭合 |
| 21 | `carbon_footprint` | 碳足迹核算 | `performance_finance` | 经营绩效与财务测算 |
| 22 | `countermeasure_combo` | 对策组合编排器 | `countermeasure_closure` | 对策与缺口闭合 |
| 23 | `plan_rootcause` | 规划决策根因归因 | `root_cause_attribution` | 归因与根因诊断 |
| 24 | `metric_rollup` | 经营指标卷算 | `performance_finance` | 经营绩效与财务测算 |
| 25 | `cockpit_kpi` | 经营驾驶舱富 KPI | `performance_finance` | 经营绩效与财务测算 |
| 26 | `counterfactual_timeline` | 反事实双轨推演 | `risk_propagation` | 风险预警与影响传导 |
| 27 | `order_fullchain` | 订单全链推演 | `order_commitment` | 商务接单与承诺 |
| 28 | `mrp_netting` | 物料 MRP 净需求 | `material_inventory` | 物料与库存 |
| 29 | `finance_pnl` | 量价本利科目表 | `performance_finance` | 经营绩效与财务测算 |
| 30 | `audit_timeline` | 审计项时序推演 | `risk_propagation` | 风险预警与影响传导 |
| 31 | `ksf_graph` | 财务 KSF 图 | `performance_finance` | 经营绩效与财务测算 |
| 32 | `generic_inference` | 通用假设推演 | `whatif_exploration` | 假设推演与关联探查 |
| 33 | `shared_bottleneck` | 共享瓶颈 | `capacity_bottleneck` | 产能与瓶颈 |
| 34 | `concentration_risk` | 隐性集中度 | `risk_propagation` | 风险预警与影响传导 |
| 35 | `margin_attribution` | 毛利倒挂归因 | `root_cause_attribution` | 归因与根因诊断 |
| 36 | `supplier_disruption_radius` | 断供影响半径 | `risk_propagation` | 风险预警与影响传导 |
| 37 | `selection_optimize` | 组合最优化 | `combinatorial_allocation` | 通用组合最优化 |
| 38 | `assignment_optimize` | 指派最优化 | `combinatorial_allocation` | 通用组合最优化 |
| 39 | `sequencing_optimize` | 排序最优化 | `planning_scheduling` | 计划与排程 |
| 40 | `packing_optimize` | 装箱最优化 | `combinatorial_allocation` | 通用组合最优化 |
| 41 | `job_shop_schedule` | 工序排程最优化 | `planning_scheduling` | 计划与排程 |
| 42 | `facility_location` | 选址最优化 | `combinatorial_allocation` | 通用组合最优化 |
| 43 | `min_cost_flow` | 最小成本流 | `combinatorial_allocation` | 通用组合最优化 |
| 44 | `set_cover` | 集合覆盖 | `combinatorial_allocation` | 通用组合最优化 |
| 45 | `independent_set` | 最大独立集 | `combinatorial_allocation` | 通用组合最优化 |
| 46 | `combinatorial_auction` | 组合拍卖 | `combinatorial_allocation` | 通用组合最优化 |
| 47 | `multi_objective` | 多目标最优化 | `combinatorial_allocation` | 通用组合最优化 |
| 48 | `cross_object_occupancy` | 跨对象占用最优化 | `combinatorial_allocation` | 通用组合最优化 |
| 49 | `optimize_whatif` | 优化 what-if | `whatif_exploration` | 假设推演与关联探查 |
| 50 | `gap_attribution` | 深度反向缺口归因 | `root_cause_attribution` | 归因与根因诊断 |
| 51 | `decision_play` | 决策推演(多方案+触发行动) | `countermeasure_closure` | 对策与缺口闭合 |
| 52 | `supply_demand_gap_attribution` | 供需失衡双向归因 | `root_cause_attribution` | 归因与根因诊断 |
| 53 | `atp_check` | 订单承诺(ATP/CTP) | `order_commitment` | 商务接单与承诺 |
| 54 | `sop_reschedule` | 产销重排推演 | `planning_scheduling` | 计划与排程 |
| 55 | `portfolio` | 全局联合推演 | `planning_scheduling` | 计划与排程 |
| 56 | `base_capacity_outlook` | 每基地前瞻产能推演 | `capacity_bottleneck` | 产能与瓶颈 |
| 57 | `ontology_query` | 本体查询 | `whatif_exploration` | 假设推演与关联探查 |
| 58 | `chain_loss_attribution` | 环节级损失归因 | `root_cause_attribution` | 归因与根因诊断 |
| 59 | `chain_impediments` | 全链阻滞点扫描 | `capacity_bottleneck` | 产能与瓶颈 |

脚本尾行输出：`总数=59 漏网=[]` · `合计 = 59；类目数 = 10`。

### 按类目分组（同一份数据的另一视图）

| 类目 | 条数 | 成员 |
|---|---|---|
| 产能与瓶颈 | 6 | `capacity_rollup` · `capacity_forecast` · `bottleneck_matrix` · `shared_bottleneck` · `base_capacity_outlook` · `chain_impediments` |
| 计划与排程 | 9 | `plan_audit` · `plan_generate` · `cert_schedule` · `changeover_sequence` · `maintenance_stagger` · `sequencing_optimize` · `job_shop_schedule` · `sop_reschedule` · `portfolio` |
| 物料与库存 | 4 | `kit_readiness` · `lta_gap` · `inventory_optimize` · `mrp_netting` |
| 风险预警与影响传导 | 6 | `risk_timeline` · `affected_orders` · `counterfactual_timeline` · `audit_timeline` · `concentration_risk` · `supplier_disruption_radius` |
| 归因与根因诊断 | 6 | `yield_diagnosis` · `plan_rootcause` · `margin_attribution` · `gap_attribution` · `supply_demand_gap_attribution` · `chain_loss_attribution` |
| 对策与缺口闭合 | 5 | `mitigation_select` · `outsourcing_split` · `quarterly_gap` · `countermeasure_combo` · `decision_play` |
| 商务接单与承诺 | 4 | `quote_margin` · `credit_exposure` · `order_fullchain` · `atp_check` |
| 经营绩效与财务测算 | 6 | `capex_scenario` · `carbon_footprint` · `metric_rollup` · `cockpit_kpi` · `finance_pnl` · `ksf_graph` |
| 通用组合最优化 | 10 | `selection_optimize` · `assignment_optimize` · `packing_optimize` · `facility_location` · `min_cost_flow` · `set_cover` · `independent_set` · `combinatorial_auction` · `multi_objective` · `cross_object_occupancy` |
| 假设推演与关联探查 | 3 | `generic_inference` · `optimize_whatif` · `ontology_query` |

---

## 4 · 消费方接在哪（file:line）—— 「只有契约声明没有 src 消费方 = 没做完」

### 4.1 定义侧（新增两个文件）

| 文件 | 内容 |
|---|---|
| `packages/contracts/src/solver-taxonomy.ts` | `SOLVER_CATEGORIES`(10) · `SolverCategorySchema` · `SOLVER_CATEGORY_META`(标签+决策问句) · `isSolverCategory()` |
| `apps/datacore/src/solvers/taxonomy.ts` | 59 条 `SOLVER_CATEGORY_MAP` · `solverCategoryOf` · `solversInCategory` · `solversByCategory` · `uncategorizedSolverKeys` |

### 4.2 消费侧（**src 里真被读**，不是只声明）

| 消费点 | file:line | 干什么 |
|---|---|---|
| 求解器目录条目挂类目（派生投影） | `apps/datacore/src/catalog.ts:39-44`（`withSolverCategory`，读 `solverCategoryOf`:41） | 目录数组不手写 category，按 key 查出来挂上（单一出处，防两处漂移） |
| **注册表按类目硬过滤**（论域=全 59） | `apps/datacore/src/catalog.ts:315-316`（`solverRegistry`） | 类目过滤先于关键词打分 ⇒ 结果集与类目成员集**严格相等** |
| discover 场景池按类目过滤 | `apps/datacore/src/catalog.ts:268-270`（`discover`） | 场景池按类收窄；切片池给了类目 → 诚实空集 |
| 资源投影带类目 | `apps/datacore/src/catalog.ts:194,205`（`datacoreResourceDescriptors`） | 59 条 solver 描述符全部带 `category`，发现门实测 `solver:59` |
| HTTP · 注册表检索 | `apps/datacore/src/app.ts:2846,2849`（`GET /a/v1/solvers/registry?category=`） | 非法类目 **400**，不静默返全量 |
| HTTP · discover | `apps/datacore/src/app.ts:2742,2745`（`GET /a/v1/catalog?kind=solvers&category=`） | 同上 |
| HTTP · 类目登记表（新端点） | `apps/datacore/src/app.ts:2748-2761`（`GET /a/v1/solvers/categories`） | 10 类 + 决策问句 + 成员 key + `count` + `uncategorized`（空=无漏网，诚实亮出） |
| 契约字段 | `packages/contracts/src/resource-descriptor.ts:47`（`category` 可选） | 声明进 `ResourceDescriptorSchema`，投影过 schema 不被 strip |

调用链追到底（不止 grep 一层）：
`GET /a/v1/solvers/registry?category=` → `app.ts:2849 catalog.solverRegistry(c, query, category)`
→ `catalog.ts:315 withSolverCategory(ALL_SOLVER_CATALOG)` → `catalog.ts:41 solverCategoryOf(key)`
→ `solvers/taxonomy.ts SOLVER_CATEGORY_MAP`。这条链在测试里**被 HTTP inject 真跑过**（见 §5.3）。

### 4.3 机器先说话（铁律 0.6 的机制，不是「下次注意」）

`SOLVER_CATEGORY_MAP` 的键类型是 `Record<(typeof SOLVER_KEYS)[number], SolverCategory>` ——
**新增 solver 忘归类 / key 写错 / 类目名写错，`tsc` 当场红**，不用等谁想起来。

**变异反证（证明这道门不是装饰品）**：删掉 `atp_check: "order_commitment",` 一行后重跑 typecheck ——

```
$ pnpm --filter datacore typecheck
src/solvers/taxonomy.ts(30,14): error TS2741: Property 'atp_check' is missing in type
  '{ capacity_rollup: ...; ... 52 more ...; ontology_query: "whatif_exploration"; }'
  but required in type 'Record<"job_shop_schedule" | ... 50 more ... | "ontology_query", ...>'
MUTATION_TSC_RC=2
$ # 恢复后
RESTORE_TSC_RC=0
```

（顺带第三次反证总数：报文里 6 个列出的键 + "52 more" = 58 = 59−1。）

---

## 5 · 两条判据的实测输出

测试文件：`apps/datacore/test/solver-taxonomy.test.ts`（10 个 case，全绿）。
**期望表在测试侧独立写死一份**与 `SOLVER_CATEGORY_MAP` 对拍 —— 不从被测对象反推期望值
（从被测对象推期望就是自证自明，改错了照样绿）。

```
$ cd apps/datacore && npx vitest run test/solver-taxonomy.test.ts
 ✓ test/solver-taxonomy.test.ts (10 tests) 4144ms
 Test Files  1 passed (1)
      Tests  10 passed (10)
```

### 5.1 判据①「按某个类目检索 → 返回的 solver 集合**恰好**等于该类目下的那些 key」

在**两层**各断言一次（只测纯函数 = 测的是函数不是链路，本仓明令的老坑）：

- **纯函数层**（`solversInCategory`，严格按声明序 `toEqual`）：对 **10 个类目逐个**断言，非抽样。
  另有反证：`solversInCategory("whatif_exploration")` **不含** `atp_check`（防"全都返回"的假绿）。
- **HTTP 层**（`GET /a/v1/solvers/registry?category=`，驱动真消费方）：对 10 个类目逐个断言
  **集合相等 + 计数相等**，且每条 `category` 字段回填正确。

> **实测过程中暴露的一处真差异，据实处理（不是绕过）**：注册表论域
> `ALL_SOLVER_CATALOG = [...SOLVER_CATALOG, ...GENERIC_SOLVER_CATALOG, ...COCKPIT_SOLVER_CATALOG]`
> 的三池拼接序 **≠** `SOLVER_KEYS` 声明序 —— `chain_impediments` 在 GENERIC 池、
> `base_capacity_outlook` 在 COCKPIT 池，故注册表里前者排在后者之前，而 `SOLVER_KEYS` 里正相反。
> 第一版测试用严格序比对，**当场红**：
> ```
> AssertionError: 类目 capacity_bottleneck 的注册表检索结果不符
> - "base_capacity_outlook"     (Expected)
>   "chain_impediments"
> + "base_capacity_outlook"     (Received)
> ```
> 判据要的是「返回的 solver **集合**恰好等于」——集合相等。故 HTTP 层改用集合口径 + 计数口径，
> 声明序那条约束由纯函数层严格守。**没有**去改既有注册表端点的返回顺序：那是别的消费方的既有契约，
> 为了让自己的测试变绿去改它 = 越界的行为变更。

### 5.2 判据②「每个 solver 都有类目，没有漏网（59 === 已分类数）」

```
SOLVER_KEYS.length            === 59
uncategorizedSolverKeys()     === []            // 0 漏网
已分类数（逐 key 查）          === 59
Object.keys(SOLVER_CATEGORY_MAP) 集合 === SOLVER_KEYS 集合   // 防反向漂移（多归了已删 key）
10 个类目成员数之和            === 59
去重后成员总数                 === 59            // 互不重叠 ⇒ 是划分不是打标签
每个类目非空 + 有标签 + 有决策问句
```

HTTP 层同样验一遍：不带 `category` 时 `/a/v1/solvers/registry` 返回 **59** 条，
`solvers.filter((s) => !s.category)` 为 `[]`（无漏网传到线上），各类目计数逐个对上。

### 5.3 其余同文件断言

- 金丝雀双向：在册 key 必查得到类目 / 不在册 key 必查不到（**查不到 = 工具坏了，不是"没分类"**）。
- 非法类目 → **400**（`/a/v1/solvers/registry` 与 `/a/v1/catalog` 各一条）。
- `GET /a/v1/solvers/categories`：10 类 + 决策问句 + 成员 key + `total=59` + `uncategorized=[]`。
- 资源投影 59/59 带类目；切片条目**不**被塞类目。
- R6 确定性：`solversByCategory()` 重复调用 JSON 字节级一致；类目间序 = `SOLVER_CATEGORIES` 声明序；
  类目内序 = `SOLVER_KEYS` 声明序；输出不取 `Object.keys(SOLVER_CATEGORY_MAP)`。

### 5.4 回归（未跑 `gate.sh`、未跑 `pnpm -r test`，按工单纪律逐文件跑）

| 项 | 命令 | 结果 |
|---|---|---|
| contracts build | `pnpm --filter @platform/contracts build` | `RC=0` |
| datacore typecheck | `pnpm --filter datacore typecheck` | `RC=0` |
| datacore build | `pnpm --filter datacore build` | `RC=0` |
| agentcore build（未改，仅为让门跑起来） | `pnpm --filter agentcore build` | `RC=0` |
| 本单测试 | `npx vitest run test/solver-taxonomy.test.ts` | 10/10 |
| 目录 + 资源描述符回归 | `npx vitest run test/catalog.test.ts test/resource-descriptor.test.ts` | 9/9 |
| 金值回归 | `npx vitest run test/ontology-core.test.ts test/databuilder.test.ts` | 53/53 |
| 跨服务冒烟（B 侧读 A 注册表） | `npx vitest run test/xservice-smoke.test.ts` | 6/6 |
| contracts 包全测 | `cd packages/contracts && npx vitest run` | 66/66 |
| 资源投影门 | `node scripts/check-resource-descriptor.mjs` | `RC=0`，`solver:59` |
| 全链闭包门 | `node scripts/check-chain-closure.mjs` | `RC=0`，`59/59` |
| 本体一致性门 | `node scripts/check-system-ontology.mjs` | `RC=0`，`59 个覆盖 59 个` |
| DRIL 检索门 | `node scripts/check-dril-retrieval.mjs` | `RC=0`，top-3 命中率 100% |

---

## 6 · 金值同步：**无需改动**（先 grep 后逐个点开确认，不是"提及即算"）

工单要求「若有任何 golden 快照里含 solver 计数或字段形状，必须一并更新」。实查：

- **无 vitest 快照文件**：仓内**不存在** `__snapshots__` 目录。
  金丝雀：同一条 `find ... -type d \( -name "__snapshots__" -o -name "test" \)` 能列出
  4 个 `test` 目录 ⇒ **工具是好的**，`__snapshots__` 确实不存在（不是"我没找到"）。
- 本仓的"金值"是硬编码数字断言，逐个点开确认：
  - `apps/datacore/test/ontology-core.test.ts:497` `SOLVER_KEYS.length` `toBe(59)` —— 本单不增 solver，**仍是 59，不动**。
  - `apps/datacore/test/catalog.test.ts:61-63` 注册表键集 `toEqual(new Set(SOLVER_KEYS))` +
    `toBe(SOLVER_KEYS.length)` + `toBe(ALL_SOLVER_CATALOG.length)` —— 相对断言，本单只加**可选**字段
    不增删条目，实跑绿。
  - `apps/datacore/test/databuilder.test.ts:79` 遍历 `SOLVER_KEYS` 断言每 key 有非空 `SOLVER_OUTPUT_SHAPES`
    —— 未动 `SOLVER_OUTPUT_SHAPES`，实跑绿。
  - `apps/datacore/test/resource-descriptor.test.ts:49` 场景池计数相对断言 —— 实跑绿。
- **字段形状**：`ResourceDescriptorSchema` 新增 `category` 为 **optional**（additive），
  既有 `findUndescribed` / `AnyIntelligenceResourceSchema` 校验不受影响；四道门实测全绿。

---

## 7 · 范围边界自查

| 允许 | 实际改动 |
|---|---|
| `apps/datacore/src/solvers/**` | ✅ 新增 `taxonomy.ts`（**零求解器计算逻辑**，`service.ts` 一行未改） |
| `packages/contracts/src/` | ✅ 新增 `solver-taxonomy.ts`；`index.ts` +1 行导出；`resource-descriptor.ts` +1 可选字段 |
| `apps/datacore/test/**` | ✅ 新增 `solver-taxonomy.test.ts` |

**超出"只碰这些"清单但属工单明确要求的落点**（工单 §2.4「至少接到求解器目录/资源投影的检索或筛选上」，
而求解器目录与资源投影都在这两个文件里；二者均**不在**"不许碰"清单上）：

- `apps/datacore/src/catalog.ts` —— 求解器目录本体（`solverRegistry` / `discover` / `datacoreResourceDescriptors`）。
  不接这里就只有契约声明没有 src 消费方 = 按工单定义"没做完"。
- `apps/datacore/src/app.ts` —— 3 处路由（2 处加 `category` 参数 + 1 个新端点），让筛选从 HTTP 可达。

**未碰**：`apps/agentcore/**`、`apps/frontend-shell/**`、`docs/SYSTEM-ONTOLOGY.md`、任何求解器的计算逻辑、
任何 solver key 名。（本体未新增链路/事件/对象类型/不变量，故按铁律 0 无需回写本体；
但**新增了一个端点** `GET /a/v1/solvers/categories`，若审核方认为需登记进本体 §2/§3，由审核方在
`SYSTEM-ONTOLOGY.md` 落笔 —— 本单范围边界禁止我动该文件。)

---

## 8 · 分支落盘

```
$ git ls-remote origin claude/handoff-wo-l7a-solver-taxonomy
f9b3d8ea6ef11da53856014578c4a22ffd0dfba8	refs/heads/claude/handoff-wo-l7a-solver-taxonomy
```

⚠ 上面这个 sha 是**本文件写下那一刻**的实测值；此后每追加一次文档提交它都会前进
（写死在文档里的 sha 天然会过期——**以 `git ls-remote` 当场实跑为准**，别信文档里的这一行）。

提交（每完成一个可命名单元即 commit + push，不等门 —— push 与"过 gate"是两回事）：

1. `6c928b3d feat(solvers): WO-L7A 内置求解器 10 类决策问题分类维（59/59 全覆盖·类型层强制）` —— 定义 + 消费方接线
2. `421fe8ea test(solvers): WO-L7A 两条效果层判据（类目集合恰好相等 + 59/59 无漏网）·纯函数层⊥HTTP 层各一遍`
3. `f9b3d8ea docs: WO-L7A 交付说明`（本文件）
4. `4989b76a docs: 补 §8 落盘 sha + 'diffstat 的减号 ≠ 删除' 复验提醒`

**代码/测试只在提交 1–2**（提交 3–4 是纯文档），复验时只需看前两个提交的 8 个文件里的 6 个非文档文件。

工作树 `git status --porcelain` 为空（无未提交残留；临时脚本已删，未入库）。

### 8.1 给审核方的一个提醒：diffstat 别对着"现在的 canonical"读

复验时若跑 `git diff --stat origin/claude/inspiring-gates-aqczjg..HEAD`，会看到
`docs/STATUS-2026-08-09-loop-ledger.md`(-202) 与 `scripts/check-verdict-rollup.mjs`(-61)
两个**我从未碰过**的文件显示为"删除"。**那不是删除**：canonical 在我开分支之后前进了 1 个提交
`684f78f1 docs: 进度实测账`，正是它新增了这两个文件（`git show --stat 684f78f1` 实测：
2 files changed, 263 insertions(+)，纯新增）。我的分支只是还没有这个提交而已。

对着**真正的分支点**看才是本单的实际改动面：

```
$ git diff --stat 69804185..HEAD      # 69804185 = 开分支时的 canonical
 apps/datacore/src/app.ts                      |  33 ++-
 apps/datacore/src/catalog.ts                  |  76 ++++--
 apps/datacore/src/solvers/taxonomy.ts         | 137 ++++++++++
 apps/datacore/test/solver-taxonomy.test.ts    | 261 ++++++++++++++++++
 docs/WO-L7A-delivery.md                       | 374 ++++++++++++++++++++++++++
 packages/contracts/src/index.ts               |   1 +
 packages/contracts/src/resource-descriptor.ts |   6 +
 packages/contracts/src/solver-taxonomy.ts     |  95 +++++++
 8 files changed, 963 insertions(+), 20 deletions(-)
```

8 个文件、零文件删除。`git merge-base --is-ancestor 69804185 684f78f1` → `RC=0`，
两条线无冲突面（新增的 2 个文件与本单 8 个文件无交集），cherry-pick / rebase 上 canonical 应为直进。

**形态归档**（照铁律 0.6 的句式）：*「我用『diff 里出现减号』当作『这个分支删了文件』的证据，
而前者并不度量后者 —— 它度量的是『目标 ref 有而本分支没有』，包括本分支根本没赶上的新提交。」*
