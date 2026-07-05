# SCENARIO-PACK-SCOPE 实证 — 启动器目录按行业 pack 作用域（治跨行业泄漏 · G-3 邻域）

真起 datacore(4001·SEED_DEMO=1 SEED_OPT_INDUSTRY=1) + agentcore(4002)，OBO 真链路（HttpDataCore → DataCore loadIndustryPack）。

## 缺陷（fixed）
`ensureScenarios` 曾无条件把 SCENARIO_CATALOG（20 张电池卡）懒播给任意租户 → 物流（logi）租户被种 20 张电池卡（乘用车/储能/规划体检…）= 跨行业泄漏。

## 治本
启动器目录按**租户行业包**作用域播种：DataCore `GET /a/v1/scenarios/pack` 据 tenant.industry 解析 IndustryPack（loadIndustryPack 单一来源）；AgentCore 据 industryKey 分派——电池→SCENARIO_CATALOG（字节不变 R6）；非电池→pack.scenarios（不重建）；无自带 scenarios 且非电池→诚实空目录（不静默回落电池）。

## DataCore /a/v1/scenarios/pack（真 loadIndustryPack）
- logi  → `{"industryKey":"logistics-warehouse","scenarios":[network-demand, site-cost-profile]}`
- demo  → `{"industryKey":"battery-manufacturing","scenarios":[]}`

## AgentCore GET /b/v1/scenarios（真 HTTP → 真 datacore pack）
### logi 租户（零电池泄漏）
- total=2 launcherEnabled=true
- keys = ["network-demand","site-cost-profile"]
- names = ["配送网络覆盖规模","候选配送仓成本画像"]
- 逐值反证 battery-words-present: []  (乘用车/储能/规划体检/4680-NCM 全 absent)

### demo 租户（电池字节不变 R6）
- total=20 launcherEnabled=true
- keys = ["S01".."S20"]（出厂 20 卡全在）
- logistics-leak-into-demo: 0
- has "规划体检": true（S04 电池卡仍在）

## 齿检（test/scenario-pack-scope.test.ts）
- 物流 logi → 只有 logistics 键·零电池·仓储层同样零电池键
- 电池 demo → 20 张 S01..S20·字节不变
- 反证 teeth：把 isBattery 强置 true（撤 pack 作用域）→ logi 被种 S01..S20 → 红（已实证 revert → red）

原始响应：dc-pack-logi.json / dc-pack-demo.json / b-scenarios-logi.json / b-scenarios-demo.json（scratchpad）。
