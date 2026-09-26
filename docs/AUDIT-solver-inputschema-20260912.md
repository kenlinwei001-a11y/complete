# AUDIT · 求解器入参模式（inputSchema）—— 根因、落地与 51 个待办

**单号** `WO-SOLVER-INPUTSCHEMA` · **日期** 2026-09-12 · **分支** `claude/handoff-wo-solver-inputschema`
**PIN** `origin/claude/inspiring-gates-aqczjg` @ `c69d345d`（树龄探针 `battery.ts` = 7053 行）

---

## 0. 一句话

**模型调求解器只能猜参数，因为全仓没有一处机器可读的入参模式。**
本单给 **12 个**求解器补了从**实现反推**的 JSON Schema，并把它带进 MCP 工具描述。
实测 `portfolio` 模型可见参数从 **4 → 30**，`plan_audit` 从 **1 → 10**。

---

## 1. 派单前提的四处实测订正（⚠ 先读这节，别照派单原文理解）

派单给的 file:line 与状态是线索不是结论。逐条实测后，**四条前提不成立**：

| # | 派单原文 | 实测 | 影响 |
|---|---|---|---|
| ① | 「`args-schemas.ts` **是空的**（条目数 0）—— 文件建好了，活没做完」 | **不空**。它是**薄 re-export**，真表在 `packages/contracts/src/solver-args.ts`，**已登记 11 条** zod schema | 若信了会去「从零建表」，实际该做的是**另起一张用途不同的表**（见 §3） |
| ② | 「`global_sim_optimize`（`lineGranularity`/`frozenCapacityMode`）」 | **`global_sim_optimize` 不是求解器 key**，全仓 `apps/*/src` 零命中。它是 `portfolio` 内部的编排函数 `globalSimOptimize`（`service.ts:3554` 起按条件路由）。对应的求解器 key 是 **`portfolio`** | 按原文找不到目标；已按实现落到 `portfolio` |
| ③ | 「`lineGranularity` 这个开关**全仓零调用方**」 | **有调用方**：`service.ts:3512 asBool(args.lineGranularity)` → `portfolio.ts:278/283/321/404/408`。**代码接了线、数据也在** | 定性完全不同：不是「没接线」，是**「接了线，但没有任何地方告诉模型它可以传」**——这是第四态，修法是补声明不是补实现 |
| ④ | 「`frozenCapacityMode` 模型看不到」 | **本来就看得见**，它是 `portfolio` 目录 `argHints` 四键之一 | 被本单的接缝测试**当场咬红**（见 §5）。真正不可见的只有 `lineGranularity` |

> **③ 的形态**（照铁律 0.6 句式）：
> 「我用『`grep lineGranularity` 在 `argHints` 里没命中』当作『它没有调用方』的证据，而前者并不度量后者。」
> 铁律 0.5 的三分法（没接线 / 接了线没数据 / 接了线接错地方）**答不了这一态**——
> 它接对了、有数据、会触发，**只是调用方不知道它存在**。本单把它记为**第五态：接了线但没声明**。

**数目也不对**：派单说 60 个求解器 / 48 个待办。实测 **`SOLVER_KEYS` = 63、`ALL_SOLVER_CATALOG` = 63**
（场景 23 + 通用 22 + 决策 18），两者**互为子集、零漂移**（金丝雀：双向差集都是 0）。
⇒ 覆盖 12 后**剩 51 个**，不是 48。

---

## 2. 根因：模型拿不到机器可读的入参模式

模型今天想调求解器，只有两个信息源，**两个都不是 schema**：

| 源 | 位置 | 问题 |
|---|---|---|
| ① `argHints` | `apps/datacore/src/catalog.ts` | `Record<string,string>` **人读散文**——无类型、无必填、无枚举。且**自己在漂**：`finance_world_projection` 实现读 6 键、目录只声明 5（漏 `turnWindow`）；`plan_audit` 声明的 `versionId` **实现根本不读** |
| ② `invoke_solver.inputSchema` | `apps/agentcore/src/tools/registry.ts:182` | 字面就是 `args: { type: "object", description: "…" }` ——**没有 `properties`、没有 `required`**。散文里只硬编了 3 个求解器的口径，其余 60 个全靠模型猜 |

**代价可量**：`portfolio` 实现真读 **30** 个 args 键（`portfolioOptimize` 27 + `normalizeChainScope` 3），
目录只声明 4 个 ⇒ 另外 26 个键模型无从知道可以传。线级排产（`lineGranularity`）这个能力，
**对模型而言等于不存在**。

---

## 3. 落地：为什么**另起一张表**而不是往旧表里塞

| 表 | 问的问题 | 消费方 | 加一个 key 的后果 |
|---|---|---|---|
| `SOLVER_ARGS_SCHEMAS`（旧·11 条） | 「**组合器能不能自动把它串进链**」 | `router/compile-plan.ts:64` `.filter(s => solverArgsSchema(s.key) !== undefined)` | **候选集变大 = 行为变更** |
| `SOLVER_INPUT_SCHEMAS`（新·12 条） | 「**模型可以传哪些参数**」 | `mcp/solvers-catalog.ts` → `server.ts:986` | 纯声明，只影响模型看得见什么 |

往旧表加 key 会让组合器**新把这些求解器纳入自动编排**——那是行为变更，不是本单该做的事（R6）。
故新起一张。**双份真相的风险由机器接管**（§3 对账断言）：两表重叠的 key（`portfolio`/`capacity_forecast`）
必填集必须一致、旧表字段必须是新表子集。`plan_audit` 更进一步——**形状直接派生自
`solvers.ts:512` 既有契约**（`.shape.<名>` 取字段再加说明），基表改名当场 TS 报错。

**改动清单**（4 文件 + 1 测试 + 本文档）：
- 新增 `packages/contracts/src/solver-input-schema.ts`（12 schema + JSON Schema 投影 + 校验器）
- `packages/contracts/src/index.ts` 导出
- `apps/agentcore/src/mcp/solvers-catalog.ts` — `SolverMcpTool` 加**可缺席**的 `inputSchema`
- `apps/datacore/src/solvers/args-schemas.ts` — re-export 新符号
- 新增 `apps/datacore/test/solver-inputschema.seam.test.ts`（24 断言）

**未登记者不发空壳**：`{type:"object",properties:{}}` 等于对模型宣称「此求解器无入参」，
而真相是「我们还没给它写模式」。诚实缺席 > 静默错答。

---

## 4. 12 个求解器的入参（逐个·键/类型/必填/枚举/出处）

选取依据：**4 个派单必含**（②③ 已按实测映射到真 key）+ **8 个按实读键数从高到低**。
`changeover_sequence` 与 `selection_optimize` 同为 7 键并列，取前者（业务场景卡 S11，已有 `WO-ENGINE-SCOPE-FORENSICS` 记录其 `lineId` 只回显，信息量更大）。

| # | 求解器 | 键数 | 必填 | 出处 |
|---|---|---|---|---|
| 1 | `portfolio` | **30** | 无 | `service.ts:3438` + `scope.ts:75` |
| 2 | `capacity_forecast` | 9 | `modelId` | `capacity.ts:391 ForecastArgs` |
| 3 | `chain_impediments` | 1(嵌套2) | 无 | `service.ts:4549` |
| 4 | `finance_world_projection` | 6 | `worldId` | `finance-world.ts:153` |
| 5 | `plan_audit` | 10 | **全部 10 个** | `plan.ts:8` + `service.ts:6112` |
| 6 | `lta_gap` | 10 | 无 | `extended.ts:257` |
| 7 | `cross_object_occupancy` | 10 | `orders`/`lines`/`eligibility` | `service.ts:5562` |
| 8 | `job_shop_schedule` | 9 | 无 | `service.ts:5098` |
| 9 | `risk_timeline` | 5 | 无 | `risk.ts:440` |
| 10 | `multi_objective` | 9 | `vars`/`objectives` | `service.ts:5535` |
| 11 | `optimize_whatif` | 8 | `family`/`perturbations` | `service.ts:5221` |
| 12 | `changeover_sequence` | 4 | 无 | `extended.ts:328` |

### 逐键明细（只列**枚举**与**必填**这两类"猜不出来"的，其余见源码注释）

**`portfolio`**（30 键，全可选）
`lineGranularity: boolean` ← `service.ts:3512`（**本单的活证据**：线级拆分总开关，此前模型完全看不见）·
`frozenCapacityMode: "reserve"|"release"` ← `:3501` · `method: "weighted"|"epsilon"|"lexicographic"` ← `:3504` ·
其余：`orderIds/frozenOrderIds/objective/scenarios/methodWeights/epsilon/priority/seed/lineModelCompat/
allowSplit/splitBatch/splitOrderIds/finalDueDays/materialConstraint/bom/twoStage/cellSourceMap/
transitDaysMap/freightCostMap/levers/priorityLocks/committedBatches/scope/globalSim` +
`businessTypes/baseIds/modelIds`（← `scope.ts:75/88/97`，**三维是经 `normalizeChainScope(args)` 间接读的，
grep `portfolioOptimize` 一层看不见**）。

**`capacity_forecast`**（9 键）
`modelId: string` **必填**（`capacity.ts:410-411` 无兜底）· `granularity: "base"|"process-model"` ←`:400` ·
`mode: "forecast"|"threshold"` ←`:402` · **`whatIf: {nightShifts?, extraChannels?, outsourceRatio?}`** ←`:396`
（三根产能杠杆，此前完全不在 argHints 里）· `demandDelta: number` ←`:398` · `batches[]` ←`:395` ·
`base`（别名 `baseId`/`baseName` ← `arg-aliases.ts:53`）。

**`finance_world_projection`**（6 键）
`worldId: string` **必填**（`:176-179` 显式 throw）· `pressureUnit: "pp"|"ratio"`（`:202-205` 传别的值**显式拒绝**）·
`revenueLine`/`costLine`/`marginLine: string` · **`turnWindow: number`** ←`:284-288`（**目录 argHints 漏了它**）。

**`plan_audit`**（10 键**全必填 number**）
`dem/seg_pas/seg_ess/seg_com/sup/ltaCov/kitGap/gmTarget/cashCushion/capex` ——
`service.ts:6112-6117` 逐键 `typeof !== "number"` 即抛。**目录 argHints 只声明 `versionId`，而它根本不被读**
⇒ 模型照说明书调用，10 个必填一个都填不上。**全仓声明缺口最大的一个。**

**`chain_impediments`**：`scope: {businessTypes?, baseIds?}`。
⚠ **故意不声明 `scope.modelIds`** —— `service.ts:4550` 对它**直接抛错**；声明一个会被拒的键 = 骗模型。

**`multi_objective`**：`vars[]`/`objectives[]` **必填非空**（`:5540`）·`method` 三枚举·`constraints[].op: "<="|">="|"=="`。
**`cross_object_occupancy`**：`orders[]`/`lines[]`/`eligibility[]` **必填非空**（`:5568`）·`objectives[].key: "revenue"|"penalty"|"cost"`。
**`optimize_whatif`**：`family` **必填**，12 枚举（`opt-template.ts:14`）·`perturbations[]` **必填**·基线三选一 `selection+autoBind` / `binding` / `args`。
**`job_shop_schedule`**：9 键全可选，全部是**本体类型名/属性名映射**（`opType` 缺省 `"Operation"` 等）——默认值对应标准电池域本体。
**`risk_timeline`**：别名 `base←baseId|baseName`、`horizon←days`（`arg-aliases.ts:55`）。
**`lta_gap`**：全可选带兜底（`bomUnit` 缺省 1、`monthQuota` 缺省 1/12、`leadDays` 缺省 30）。
**`changeover_sequence`**：`lineId` **今天只被回显不参与计算**（已如实写进 description）；`lineScope` 是**输出**回显位（`extended.ts:364`），**不是入参**，故不进 schema。

### 判不了的（⛔ 不发明 schema 硬塞）
- `portfolio` 的 `levers[]` / `priorityLocks[]` / `committedBatches[]`：实现里以 `PortfolioInput[...]` 原样透传给
  `portfolio.ts`，**元素形状在本单范围内读不全**（需展开 `portfolio.ts` 的内部类型，属求解器实现文件，本单不碰）。
  ⇒ 声明为 `array(unknown)` + 中文说明，**如实标注形状未定**，不编造元素结构。
- `optimize_whatif` 的 `roleHints` / `binding`：同理，落 `unknown` + 说明。

---

## 5. 对照实验（四个数 + 校验前后两个回包）

命令：`pnpm --filter datacore exec vitest run test/solver-inputschema.seam.test.ts --no-file-parallelism`

> **「前」怎么量的**：`argHints` 是补 schema 之前模型唯一的入参信息源，**本单一字未改它**
> ⇒「前」= `argHints` 条数、「后」= `inputSchema.properties` 条数，两数**同一轮实测**、可复现。
> 另有一份**改代码之前**跑的独立基线（`zz-before-probe`，RC=0）与下表逐字一致。

| 求解器 | 前 | 后 | 关键新增 |
|---|---|---|---|
| **`portfolio`** | **4** `[frozenCapacityMode,frozenOrderIds,orderIds,scenarios]` | **30** | ✅ 含 `lineGranularity` |
| **`capacity_forecast`** | **4** `[base,modelId,qty,weeks]` | **9** | ✅ 含 `whatIf`/`demandDelta` |
| `plan_audit`（外加一组） | **1** `[versionId]`（且实现不读它） | **10** | 10 个必填全可见 |

**能力性判据 —— `lineGranularity` 错类型必须被拒**（病根：`service.ts:3461`
`asBool = v => v == null ? undefined : v === true || v === "true"` ⇒ `asBool("yes") === false`，
调用方以为开了线级排产、实际拿到基地级结果）：

```
【校验·拒】{"ok":false,"errors":["lineGranularity: Invalid input: expected boolean, received string"]}
【校验·收】{"ok":true}
```

---

## 6. 测试与爆炸半径（逐个 RC）

| 项 | 命令 | RC |
|---|---|---|
| 接缝测试（24 断言） | `vitest run test/solver-inputschema.seam.test.ts` | **0** |
| **变异反证·变异后** | 删掉 `finance_world_projection.worldId` 必填声明 | **1**（2 条红：§2 必填缺席、§5 保真） |
| **变异反证·还原后** | `git diff` 空 | **0**（24 passed） |
| 爆炸半径 · agentcore | `a1-solvers-mcp` + `compose-plan` + `compose-plan-seam` | **0**（3 文件 / 14 断言） |
| 爆炸半径 · datacore | `xservice-smoke` + `solver-args-schemas` + `catalog` + `solver-arghints-contract.seam` | **0**（4 文件 / 31 断言） |
| BUILD contracts / datacore / agentcore | `pnpm --filter <p> build` | **0 / 0 / 0** |
| TYPECHECK datacore | `tsc --noEmit` | **0** |

退出码一律 `cmd > out.log 2>&1; RC=$?`，**未使用** `cmd \| tail; echo $?`。

---

## 7. 屏幕上多了什么 / 少了什么

- **多了**：`GET /b/v1/mcp/servers/solvers` 的 12 个工具条目多出 `inputSchema` 字段（标准 MCP JSON Schema，
  带类型 / 必填 / 枚举 / 每字段中文说明）。MCP 治理页若渲染该字段，会显示完整入参表。
- **少了**：**什么都没少**。`argHints` 原样保留（接缝测试 §4 逐条比对断言）；
  其余 51 个工具**不带** `inputSchema` 键（不发空壳），旧消费方逐字节不变。
- **用户屏上**：本单未动任何前端文件，终端用户界面**零变化**。

---

## 8. 51 个待办（按入参复杂度降序·供后续单接力）

复杂度 = 实现真读的 args 键数（金丝雀已验：`portfolio` 必中 `lineGranularity`、`capacity_forecast` 必中 `whatIf`）。
**「差额」= 实读键数 − `argHints` 声明数**，即**模型看不见的键数**；负数表示 `argHints` 声明了实现不读的键（同样是病，方向相反）。

| 复杂度档 | 求解器（差额） | 建议 |
|---|---|---|
| **高（6–10 键）** | `selection_optimize`(+5) · `capex_scenario`(+2) · `mitigation_select`(+4) · `quote_margin`(+2) · `credit_exposure`(+4) · `carbon_footprint`(+4) · `generic_inference`(+5) · `shared_bottleneck`(0) · `assignment_optimize`(+4) · `facility_location`(+3) | **下一张单优先**，尤其 `selection_optimize`/`assignment_optimize`/`facility_location`（CP-SAT 族，与本单 ⑦⑧⑩⑪ 同构，可批量复用片段） |
| **中（4–5 键）** | `kit_readiness`(0) · `inventory_optimize`(+4) · `yield_diagnosis`(+3) · `quarterly_gap`(+3) · `counterfactual_timeline`(+1) · `sop_reschedule`(+2) · `plan_generate`(+3) · `countermeasure_combo`(+2) · `margin_attribution`(**−4**) · `packing_optimize`(+2) · `min_cost_flow`(+2) · `set_cover`(+2) · `independent_set`(+2) · `ontology_query`(**−2**) · `process_flow_time`(0) | 中批 |
| **低（2–3 键）** | `cert_schedule`(+1) · `maintenance_stagger`(+2) · `concentration_risk`(**−6**) · `supplier_disruption_radius`(**−6**) · `sequencing_optimize`(+1) · `combinatorial_auction`(+1) · `outsourcing_split`(0) · `plan_rootcause`(+1) · `audit_timeline`(0) · `gap_attribution`(+1) · `decision_play`(0) · `atp_check`(+1) · `base_capacity_outlook`(0) · `chain_loss_attribution`(+1) | 后批 |
| **零入参 / 需先追一层** | `capacity_rollup` · `capacity_ledger`(argHints 4，**实读经 `CapacityLedgerArgs` 4 字段**) · `bottleneck_matrix` · `affected_orders` · `metric_rollup` · `cockpit_kpi` · `mrp_netting` · `finance_pnl` · `ksf_graph` · `supply_vulnerability` · `supply_demand_gap_attribution` · `order_fullchain` | ⚠ 这 12 个静态扫报 0 键，**不等于无入参**——多为**薄透传**（如 `capacity_ledger` 委托给 `computeCapacityLedger(…, args as CapacityLedgerArgs)`）。下单前**必须追一层到被委托的类型**，⛔ 不许直接报「无入参」 |

**⚠ 负差额那 4 个（`concentration_risk` −6 · `supplier_disruption_radius` −6 · `margin_attribution` −4 · `ontology_query` −2）
值得优先看一眼**：它们的 `argHints` 声明了实现**不读**的键 ⇒ 模型照说明书传了也会被静默丢掉，
正是 `scripts/check-solver-arg-key-drift.mjs` 咬的那个形态。**本单未改它们**（不在范围），如实记账。

---

## 9. 我可能错在哪（≤3 条）

1. **静态抽取可能漏「字符串键分发」形态的读取。** 我的抽取器覆盖 `args.X` / `args["X"]` / `args?.X` /
   解构四种形态，并对薄透传追了一层到 TS 接口；但若某求解器用 `for (const k of KEYS) args[k]` 这类
   **运行时键遍历**，静态扫看不见。⇒ 12 个里我逐个读过实现原文，风险集中在 §8 那 51 个的**复杂度估值**上，
   不影响已交付的 12 个。缓解：接缝测试 §5 对 4 个求解器钉死「schema 字段集 === 实现真读集」作回潮哨兵。
2. **`inputSchema` 今天只到 MCP 工具清单这一条消费路（`server.ts:986`），没到 agent 主循环。**
   agent 的工具集来自 `BUILTIN_TOOLS`（`orchestrator.ts:1869`），`invoke_solver` 的
   `args` 仍是无 `properties` 的裸 object —— **那个文件（`tools/registry.ts`）不在本单范围边界内**。
   ⇒ 诚实结论：**本单让 MCP 客户端与治理页拿到了模式，但 ReAct 主循环里的模型还没拿到**。
   这是**接了线但只接了一处**，不是接错；补挂载点应是下一张单（改 `registry.ts` 让
   `invoke_solver` 按 `solverKey` 动态下发 `solverInputSchema()`，或把 `mcp__solvers__*` 纳入 agent 工具集）。
3. **`validateSolverInput` 目前只有测试调用方，无生产调用方。** 它证明了「有了模式就能拒掉
   `lineGranularity:"yes"`」这个能力，但**真正的运行时拦截需要改 `executor.ts` / `service.ts`**，
   两者都在本单范围之外（不碰求解器实现）。⇒ 按铁律 0.5 判据 2 如实标注：
   **这是「已排练」，不是「已实现」**。⛔ 不许把 §5 的两个回包读成「生产已经开始拒绝错类型入参了」。

---

## 10. WO-INPUTSCHEMA-B · 剩余 51 个补满（63/63 全覆盖）

**分支** `claude/handoff-inputschema-b` · **基线** `claude/handoff-wo-solver-inputschema` @ `2916311e`（⛔ 不从 canonical 切——canonical 没有前 12 个）。

### 10.1 口径（与前 12 相同，三条纪律原样继承）

① 每个 schema **从实现反推**（接口即真相 / 函数体逐键 grep / deriveExtendedArgs 逐 case 读），⛔ 不照 argHints 抄；
② 不改任何求解器实现；③ R6 静态声明、新增字段一律 optional、既有回包逐字节不变。

### 10.2 四条实测下来的判定口径（51 个统一适用）

- **「不读 args」= 空 object schema `{}`**：`capacity_rollup` / `cockpit_kpi` / `mrp_netting` / `finance_pnl` / `ksf_graph` / `supply_vulnerability` / `supply_demand_gap_attribution` 共 7 个，逐一经函数签名（如 `mrpNetting(ctx)`、`supplyVulnerability(…, _args)`）证实不读 args。空 schema 是「**实测无入参**」的诚实声明，与基线时代「未登记=模式未知」是两个命题（§4 全覆盖断言的注释写明了这一区分）。
- **引擎派生的诚实位不是入参**：`kitScope` / `lineScope` / `quarterScope` / `scope` / `tightnessDataMode` / `dataMode` / `provenanceSynthetic` 由 `deriveExtendedArgs` 写回 args 供**输出回显**，模型传了也没人当入参读 ⇒ 一律不声明（前 12 的 `changeover_sequence.lineScope` 判例原样延伸）。
- **旧表声明而实现不读的键，如实保留并标注**：`credit_exposure.custId`、`metric_rollup.metricKey`、`gap_attribution` 顶层 `factorId`/`factors` —— 双表对账（§3）要求旧表字段 ⊆ 新表字段，删了会对不齐；保留但 describe 里明写「⚠ 实现未读」，不假装它有效。
- **别名以规范化后的键声明**：`arg-aliases.ts` 在 `compute()` 入口统一归一一次（`base←baseId|baseName` 等），schema 声明归一后的键 + describe 里注明别名（与 `capacity_forecast`/`risk_timeline` 判例一致）。

### 10.3 两个被当场咬出来的目录漂移（负差额形态）

- `selection_optimize`：目录 argHints 声明 `items`，实现读的是 **`itemType`**（`service.ts:4961`）——模型照说明书传 `items` 会被静默丢掉。schema 按实现声明 `itemType`/`budget` 必填。
- `quote_margin` 的 `destination`、`yield_diagnosis` 的 `processKey`/`baseName`、`kit_readiness` 的 `toDay`（derive 写、无人读）、`margin_attribution` 的 `sign`（注释提及、无消费方）—— **均不声明**。声明一个没人读的键 = 骗模型。

### 10.4 对照实验（本单两案 · 四个数）

| 求解器 | 前（argHints 条数） | 后（inputSchema properties） | 新增可见 |
|---|---|---|---|
| `sop_reschedule` | **3** `[newDueDate,objective,targetOrderId]` | **5** | `advanceDays` `advancePct`（`service.ts:3423-3424` 三种重排口径之二，此前只在散文里） |
| `credit_exposure` | **2** `[creditLimit,custName]` | **7** | `custId` `newOrderAmount` `overdue` `receivables` `wipUnbilled`（敞口=应收+在产未开票，两个加数此前完全不可见） |

能力性判据（`plan_generate.hard.gm` 嵌套布尔，`"yes"` 必须被拒）：

```
【校验·拒】{"ok":false,"errors":["hard.gm: Invalid input: expected boolean, received string"]}
【校验·收】{"ok":true}
```

前态（本单补登记之前）：`plan_generate` 未登记 → `{"ok":true,"unchecked":true}` 静默放行（机制证据：§2「未登记求解器诚实报 unchecked」一测至今仍在，`zzz_未登记` 走的就是同一条代码路）。

### 10.5 测试与爆炸半径（逐个 RC · datacore vitest 全程串行）

| 项 | RC |
|---|---|
| 接缝测试（45 断言：§1 五案对照 + §2 校验 + §3 双表对账 11 key + §4 全覆盖 63/63 + §5 保真） | **0** |
| 变异反证·变异后（`sop_reschedule.targetOrderId` 去掉必填） | **1**（恰好咬 §3 该 key：「expected [] to deeply equal ['targetOrderId']」，1 failed / 44 passed） |
| 变异反证·还原后（cp 还原 + porcelain 空 + 重建 dist） | **0**（45 passed） |
| 爆炸半径 · datacore（solver-args-schemas / catalog / solver-arghints-contract.seam / xservice-smoke） | **0 / 0 / 0 / 0** |
| 爆炸半径 · agentcore（a1-solvers-mcp / compose-plan / compose-plan-seam） | **0 / 0 / 0** |
| BUILD `@platform/contracts` | **0**（每次 schema 改动后都重建，含变异/还原两轮） |

### 10.6 §4 断言的改写（覆盖补满后的必然）

原断言「未登记者不带 inputSchema 键」自带逃生注释「全登记了 ⇒ 本断言恒真，需换别的样例」。63/63 后它按注释指示改写为**全覆盖断言**（目录每个求解器都带 inputSchema + 反向金丝雀：注册表 key 不许飘出目录）。「不发空壳」纪律由 §10.2 第一条接手：空 schema 只发给**实测无入参**的 7 个，出处注到函数行。

### 10.7 屏幕上多了什么 / 少了什么

- **多了**：`GET /b/v1/mcp/servers/solvers` 的 63 个工具条目**全部**带 `inputSchema`（前 12 → 63）。
- **少了**：什么都没少。argHints 逐字节保留（§4 断言守着）；7 个无入参求解器带的是 `properties:{}` 的空 object schema（诚实声明，非空壳）。
- **用户屏上**：本单未动任何前端文件，终端用户界面零变化。

### 10.8 我可能错在哪（≤3 条）

1. **`generic_inference.apply` 的必填是契约口径不是实现全集**：实现里 `mode:"levers"` 与 rootType/select/nl 两条岔路都不读 apply，但旧表把它钉为必填，§3 对账要求两表必填集一致 ⇒ 新表保持必填并在 describe 里写明两条例外。风险：模型走岔路时被模式要求多传一个用不上的 `apply`。**这是旧契约的原样延伸，不是本单新引入的约束。**
2. **51 个里我只对 9 个双表重叠 key 有机器对账**，其余 42 个的「必填」判定靠逐行读实现（asArr 缺即抛 / 显式 throw / `=== undefined` 判空三类证据）。若某处「缺省后静默兜底」被我读成「必填」（或反之），模型的可见性与实现行为会差一档——但方向只会是「声明比实现严」，不会比实现松（宁缺毋滥的那侧）。
3. **`capacity_ledger.loadWorkOrders` / `inventory_optimize.inbound`/`locations` 等少数内部形状**，实现以 TS 断言/透传消费，元素形状我按断言点所见的字段声明；若上游装配处还写入了断言之外的字段，schema 不会拒（未声明 additionalProperties:false），只是模型看不见它们。
