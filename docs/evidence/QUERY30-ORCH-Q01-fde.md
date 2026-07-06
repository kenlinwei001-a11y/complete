# QUERY30-ORCH · Q01 样板 FDE 证据（接单挤占推演 what_if_displacement）

> 铁律 0.4：真起服务真跑真数据真看结果·逐值对照·不作假。
> 设计源 `docs/DESIGN-query30-multihop-gaps.md` §2.5/§3（Q01 全链样板打穿·不横铺）。
> 分期诚实边界见本文末「未做（横铺待 QUERY30-ORCH-SCALE）」。

## 环境（真起双服务·内存模式）

```
PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 CREDENTIAL_KEY=<64hex> SERVICE_TOKEN=svc node apps/datacore/dist/server.js
PORT=4002 DATACORE_BASE_URL=http://127.0.0.1:4001 SERVICE_TOKEN=svc JWT_SECRET=dev node apps/agentcore/dist/main.js
X-Debug-User: demo:admin:admin|planner|catalog_admin
```
demo 租户经 SEED_DEMO=1 合成 battery（seed 42）：真 Order（so/cust/pri/qty/model/bases + QUERY30-ONTOLOGY-EXT 挤占五件套 marginPct/penaltyClause/substitutable/promiseDate/priceLockedUntil）· 真 Line（12 条·baseId/capacityDaily/certifiedModels）。

---

## (A) 真实数据 · baseId=changzhou · `POST /a/v1/solvers/what_if_displacement/invoke`

入参 `{"model":"4680-NCM","qty":4200,"advancePct":0.2,"weeks":6,"baseId":"changzhou"}`
求解器 deriveArgs 从真本体图装配：changzhou 线 `LINE-changzhou capacityDaily=61698 certifiedModels=["4680-NCM","4680-LFP","方形-NCM"]`（真值）+ changzhou 在手 4680-NCM/方形-NCM 单。

逐值输出：
```
dataMode=SYNTHETIC  freeDaily=61696.57  shortfallDaily=0  feasibleWithoutDisplacement=true
schemeCount=3  recommended=delay
evaluatedRules: C34=PASS  C35=PASS
summary: 急单 4680-NCM ×4200（6 周）自由产能足量承接、无需挤占；3 个可行方案，推荐「延期在手单」。
```
→ 求解器**真接真本体对象**（真 Line.capacityDaily 61696.57）跑出结论·C34/C35 经 evaluate_rules 真裁决。

**诚实数据质量注记（供 SCALE 复盘）**：合成 battery 的 `Line.capacityDaily`(~6.2万/日) 与 `Order.qty`(~8–14) 单位不同尺度（前者套/日、后者疑万套），故 4680-NCM ×4200 相对真实产能极小 → 免挤占直接承接。四型挤占能力以下 (C) 显式争抢集验证（同 Q01 口径·经同一真起服务）。

## (B) 真实服务 · 显式争抢集（模型化挤占·同 Q01 口径）· 同一 datacore invoke

入参含显式 `lines=[{L1 capacityDaily:120 cert:[MX,MA]}]` + 2 张争线在手单（低 pri SO-A2 2100 / 高 pri SO-A1 2100·均不可外协）·急单 MX ×4200（提前 20%·6 周·dailyDemand=100）。

逐值输出：
```
freeDaily=20  shortfallDaily=80  feasibleWithoutDisplacement=false  highPriDisplaceDays=21  schemeCount=2  recommended=downgrade

四型方案（确定性枚举·五维量化）:
  delay      feasible=true  挤占=2 交期Δ=21 毛利=13.5 违约=15.75万 现金=252万 | 位移 2 单
  outsource  feasible=false 挤占=0 交期Δ=0  毛利=11.5 违约=0     现金=252万 | 可外协单不足
  split      feasible=false 挤占=2 交期Δ=0  毛利=13   违约=0     现金=252万 | 认证线不足 2 条
  downgrade  feasible=true  挤占=0 交期Δ=34 毛利=13.5 违约=0     现金=50.4万| 仅接 840/4200 套

挤占清单（Q01「会挤占哪些订单」+ 逐单再方案）:
  SO-A2 储能大客户F pri=低 位移=21天 再方案=延期 21 天（违约金 5.25 万）
  SO-A1 动力集团A   pri=高 位移=21天 再方案=延期 21 天（违约金 10.5 万）

规则裁决（真接 evaluate_rules·非卡面挂名）:
  C34=BLOCK  命中违规条件（Displace.highPriDisplaceDays 21 > maxDisplaceDays 5）
  C35=PASS   通过（PlanSet.schemeCount 2 ≥ minSchemes 2）
```
→ **四型方案枚举完整** + **挤占级联正确**（高 pri SO-A1 位移 21 天）+ **逐单再方案** + **C34 挤占优先级不变量真 BLOCK / C35 ≥2方案门真 PASS**。提前 20% → 毛利率 15→13.5（提前侵蚀，回答 Q01「毛利率是否因提前而变化」）。

## (C) 意图经 ONTO-SCEN 发育管道长成卡 · 真起 agentcore（非 seed 手装）

`POST /b/v1/scenarios`（Q01·DRAFT·**maturity=undefined 未手装**）→ `/publish` → `POST /b/v1/scenarios/Q01/grow`：
```
runId=sor_01KWTMQX0NW38MT8WESNSY50NV        ← 发育 run 真实留痕（ScenarioOntogenesisRun）
rings={data:true, ontology:true, capability:true}
verification=VERIFIED / WORKFLOW
maturity=GOVERNED                           ← 由 grow 亲手把 triggerQuestion 经 QOS 路径 A 跑通后设定（非 seed 手装）
answerPreview: 本次回答所用参数：型号=4680 三元圆柱、数量=4200、提前交付比例=0.2、周数=6、基地=常州。Recommended=delay
```

`POST /b/v1/scenarios/Q01/launch` → SSE 渲染答案（前端所见·逐值对照后端）：
```
KPI  Recommended=delay · 可行方案数=3 个 · 高优先级最长位移=0 天 · 急单 型号/数量/提前比例/周数/日需求
TABLE 四型方案 4 行（key/name/feasible/displacedCount/promiseDeltaDays/marginPct/outsourceRatio/penaltyTotalWan/cashOccupiedWan/note）
TEXT 结论：推荐「delay」 · 依据规则 C34、C35 · 数据模式 SYNTHETIC
```
→ QOS 路径 A（scenarioIntentKey→deterministic:scenario-bind）真路由到 `what_if_displacement_q` 意图 → 计划 invoke `what_if_displacement` → **render 投影四型方案表 + KPI + 规则依据**（`SOLVER_RENDER_BINDINGS` 真实字段·静态占位死）。

---

## 齿（自动化·revert 亲验红）

- `apps/datacore/test/query30-orch.test.ts`（6 项·EXIT=0）：R6 字节一致 · 四型枚举完整 · 挤占级联 highPriDisplaceDays=21 · C34 BLOCK/PASS 翻转（qty 4200→2940 使高 pri 不再被挤）· 免挤占直接承接。**revert 亲验**：注掉 service.ts `Displace` 命名空间注入 → C34 断言由 BLOCK 转红（已实测）。
- `apps/agentcore/test/query30-orch-grow.test.ts`（2 项·EXIT=0）：意图+计划一等注册（不入 SCENARIO_CATALOG）· DRAFT→发布→grow→GOVERNED + 发育 run 留痕（maturity 由 grow 设定·非手装）。
- 门：`ontology:check`（SOLVER_KEYS 48/48 覆盖）· `ontology-slices:check`（母体一致）· `solver-label-coverage:check`（48 器 320 字段零裸 key）· `scene-agent-config:check` · `ontogenesis:check` · `scenario-ontogenesis-runtime:check`（20/20 GOVERNED·Q01 不入目录不扰）全绿。

## 未做（横铺待 QUERY30-ORCH-SCALE·诚实边界）

本单**只交付 Q01 全链样板**（设计 §3「先 Q01 打穿再横铺」）。以下**未做**：
- 其余 9 求解器：multi_plan_compare / cash_projection / labor_balance / energy_cost_schedule / full_cost_rollup / signal_propagation / reroute_decision / multi_constraint_schedule / capex_alternatives（+ countermeasure_combo 跨期增强）。
- 其余 6 workflow 链（质量追溯/排产三约束/碳价敏感性/年度情景滚动/停复线闭环/资本组合）· 2 agent（接单参谋/供应链风控）· 5 skill（挤占分析法等方法论·接未落 SKILL-LIBRARY-EVERYWHERE）· 其余 29 intent。
- 数据质量：Line.capacityDaily 与 Order.qty 单位尺度对齐（SCALE 单校准·使真实数据即可触发挤占）。
