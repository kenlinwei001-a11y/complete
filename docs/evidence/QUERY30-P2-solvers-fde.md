# QUERY30-P2 求解器横铺 A（复用·低成本）· FDE 真跑证据

> WO：Q30-P2（DESIGN-query30-orch-split.md §1 P2 行）。分支 claude/vigilant-knuth-b1nmxn。
> 铁律 0.4：真起 datacore(4001·SEED_DEMO=1)+agentcore(4102) 真跑真数据真看结果·逐值对照后端 invoke·不作假。

## 0. 交付物（3 个 path-A 求解器·各复用现有机器·非从零）

| 求解器 key | route | 复用的现有机器 | registry↔catalog | problemClass |
|---|---|---|---|---|
| `capex_alternatives` | context | `capex_scenario`（各方案跑 IRR/util24/C23 后聚合） | ✓ SOLVER_CATALOG | investment_scenario / alternative_comparison |
| `full_cost_rollup` | graph | `capacity_rollup`(computeRollup) + `finance_pnl` | ✓ COCKPIT_SOLVER_CATALOG | descriptive_aggregation |
| `signal_propagation` | graph | `supplier_disruption_radius` 反向多跳 BFS（抽出 `traverseGraphRadius` 共用） | ✓ GENERIC_SOLVER_CATALOG | propagation_radius |

registry↔catalog 键集相等（`ontology-core.test` sync-guard 绿：`Set(SOLVER_KEYS)===Set(ALL_SOLVER_CATALOG)`）。
`solver-coverage:check` 绿（3 key 全 ∈ SOLVER_REGISTRY·零幽灵）。

## 1. 真跑环境

```
PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs-p2 SEED_DEMO=1 CREDENTIAL_KEY=<64hex> SERVICE_TOKEN=svc-p2 node apps/datacore/dist/server.js
PORT=4102 DATACORE_BASE_URL=http://127.0.0.1:4001 SERVICE_TOKEN=svc-p2 SEED_DEMO=1 node apps/agentcore/dist/main.js
```

NL 经 QOS：`POST /api/v1/queries`，`packageId=pkg_battery_manufacturing`，`x-debug-user: demo:admin:...`。
无 LLM → 确定性分类（deterministicClassify·bigram 覆盖率）命中意图 → 路径 A workflow。
**问句为真实业务痛点句（非场景卡 triggerQuestion 逐字·非手喂合成入参）**；入参走场景卡 slotPresets（对真 DataCore 合法）。

## 2. 逐求解器真 NL 命中 + 逐值对照后端 invoke

### 2.1 capex_alternatives（复用 capex_scenario）

- **真 NL 问句**：「枣庄储能线这几套投资方案哪套内部收益率IRR和回报最优？」
- **QOS 真跑**：`status=COMPLETED · path=WORKFLOW · intent=capex_alternatives_q · trustLevel=VERIFIED_WORKFLOW`
- **答案真值**（NL 答案 blocks）：
  - 结论：推荐「一步到位」（全项目 C23 达标·NPV 合计最优）
  - 表（五维比较矩阵·逐行）：A 小步快跑 avgIrr **26.35** / npvSum **0.004629** / C23达标 是 / peakGap 5；B 一步到位 avgIrr **53.64** / npvSum **0.009959** / C23达标 是 / peakGap 1
  - dataMode **SYNTHETIC**（demo 合成种子·诚实态·非兜底魔数）
- **逐值对照后端 invoke**（`POST /a/v1/solvers/capex_alternatives/invoke` 同 slotPresets）：recommendedKey=B / comparedCount=2 / A(26.35, 0.004629) / B(53.64, 0.009959) — **与 NL 答案逐值一致**。
- **复用真调证据**：直接 `capex_scenario`（单方案 B·同项目）→ project irr=**53.64** / npv=**0.009959**，与 `capex_alternatives` 方案 B 的 avgIrr/npvSum **字节一致** → 确证真复用 capex_scenario 机器（非另算）。

### 2.2 full_cost_rollup（复用 capacity_rollup + finance_pnl）

- **真 NL 问句**：「把产能卷到成本再到损益，全成本口径下的经营态势怎么样？」
- **QOS 真跑**：`status=COMPLETED · path=WORKFLOW · intent=full_cost_rollup_q · trustLevel=VERIFIED_WORKFLOW`
- **答案真值**：
  - 结论：产能 0 万套/周（0 基地）→ 收入 **246.4** / 销售成本 **206.1** / 毛利 **40.3**（毛利率 **16.4%**·C15）
  - 表（量价本利科目·逐行）：收入[241.5,246.4,4.9] / 销售成本[202,206.1,4.1] / 毛利[39.5,40.3,0.8]
  - dataMode **SYNTHETIC**
- **逐值对照后端 invoke**：
  - `finance_pnl` 直调 → pnl 收入 rolling **246.4** / 销售成本 **206.1** / 毛利 **40.3** / gmRow.rollPct **16.4** — 与 full_cost_rollup 损益侧**逐值一致**（真复用 finance_pnl）。
  - `capacity_rollup` 直调（无 arg 与 modelId=4680-NCM）→ **bases 0**（SEED_DEMO 下 computeRollup 读出层无产线/设备产能真值）。full_cost_rollup 产能侧 capacityWeeklyWan=**0**、capacityBases=**[]** — **诚实反映 capacity_rollup 真实空产能**（不合成/不兜底冒充；诚实空态·产能侧无真数据即诚实 0，财务侧真值照出）。
- 说明：产能侧 0 是 SEED_DEMO 世界 `capacity_rollup` 的真实读出（与 seedBattery 测试夹具不同；测试夹具下 computeRollup 有 bases，见 `q30-p2-reuse-solvers.test.ts` 复用真调齿）。full_cost_rollup 忠实卷积二源真值，绝不为「凑数」编造产能。

### 2.3 signal_propagation（复用 supplier_disruption_radius BFS）

- **真 NL 问句**：「某个信号从常州基地沿产线图传导，会扩散波及到哪些工序设备？」
- **QOS 真跑**：`status=COMPLETED · path=WORKFLOW · intent=signal_propagation_q · trustLevel=VERIFIED_WORKFLOW`
- **答案真值**：
  - 结论：信号「产能扰动」自「changzhou」沿图传导半径 **3** 层、波及 **12** 个对象；末端触达 Equipment **6** 个
  - 表（逐层受影响集）：Line:1（LINE-changzhou）/ Process:5 / Equipment:6（真 seed 图：LINE-changzhou-* / *-coating-E1 等）
  - dataMode **SYNTHETIC**
- **逐值对照后端 invoke**：`signal_propagation` 直调 → radius 3 / totalAffected 12 / reachedCount 6 / Line:1,Process:5,Equipment:6 — 与 NL 答案**逐值一致**。
- **复用真调证据**：`supplier_disruption_radius` 同 layers 直调 → radius **3** / totalAffected **12** / leafCount **6** / Line:1,Process:5,Equipment:6 — 与 signal_propagation **字节一致** → 确证真复用同一 `traverseGraphRadius` BFS 机器（仅语义外壳不同）。

## 3. R6 确定性 + 诚实空态（禁 random/时钟）

- `q30-p2-reuse-solvers.test.ts`（12 用例·真起 datacore seedBattery 世界）逐求解器钉：
  - I/O 契约：输出形状字段全在场；
  - R6：同输入同 seed 重跑 `JSON.stringify` 字节一致；
  - 诚实空态：capex_alternatives 空 alternatives→空+note；signal_propagation 断链根→半径0+空 affectedSet（不虚构传导）；
  - **复用机器真调**：capex_alternatives 单方案 avgIrr == capex_scenario 项目 irr；full_cost_rollup 损益侧 == finance_pnl 真值、产能侧 == computeRollup 求和；signal_propagation layers == supplier_disruption_radius layers。
- `render-bindings-real-fields.test.ts`：真起 datacore 真 invoke 3 求解器，逐 render 绑定字段断言**真在输出中在场**（挂名/占位即红）。

## 4. 门 / 测试绿状态

| 门 / 测试 | 状态 |
|---|---|
| `pnpm --filter {contracts,datacore,agentcore} build` | 绿 |
| `q30-p2-reuse-solvers.test.ts`（新增·12 用例） | 绿 |
| `solver-registry.test.ts`（快照+55 key 分桶） | 绿 |
| `render-bindings-real-fields.test.ts`（真 invoke 逐字段） | 绿 |
| `ontology-core.test.ts`（registry↔catalog sync-guard） | 绿 |
| `catalog.test.ts` / `solver-coverage.test.ts` | 绿 |
| `scenarios-wiring` / `evals-scenario-suite`（agentcore·30 卡全物化+非空答案） | 绿 |
| `solver-coverage:check` / `solver-label-coverage:check` | 绿 |
| `ontogenesis:check` / `scene-agent-config:check` / `skill-integrity:check` | 绿 |
| `no-fake-done:check` | 绿 |

## 5. 本体引用与影响（铁律 0）

- **对象类型**：Base/Line/Process/Equipment（signal_propagation 图传导）、FinancePlan/DemandSegment（full_cost_rollup 损益）、AnnualScenario 投资项目（capex_alternatives）。
- **链路**：L-SOLVER（求解链·3 求解器）、L-QOS（NL→QOS 场景路由·S28/S29/S30 入目录单一来源→seed 派生意图+计划→路径A）。
- **不变量**：R6 确定性（全 3 求解器·禁 random/时钟）、R3 视图过滤（NL 路由）、R14 抽象（capex_alternatives/full_cost_rollup 零业务魔数·signal_propagation args 驱动泛化）。
- **无新增链路/事件/对象类型/门** → 本体母体无需回写（复用既有 L-SOLVER/L-QOS·未改接线）。
