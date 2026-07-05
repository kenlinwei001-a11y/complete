# ONTO-SCEN-GROW · FDE 亲手实证（P0 场景卡发育闭环核心）

> 2026-07-05 · 真起双服务 curl 实跑（非单测冒充）。PRD `docs/PRD-scenario-ontogenesis.md` §2.2/2.3/§0/§8。
> 环境：datacore 4001（内存 SEED_DEMO=1）+ agentcore 4002（内存）/ 4003（**真 PG** `agentcore_grow_live`，PostgreSQL 16 本机）。

## 一、内存模式：grow S01 → GOVERNED → 点卡出真 KPI（逐值对照后端）

```
POST /b/v1/scenarios/S01/grow   (x-debug-user: demo:user-admin:catalog_admin|planner)
→ 200 {
  "runId": "sor_01KWRVCYAPG56CNJ8Z0RY6JXA3", "scenarioKey": "S01",
  "rings": { "data": true, "ontology": true, "capability": true },
  "verification": { "status": "VERIFIED", "path": "WORKFLOW", "gapCode": null,
    "answerPreview": "本次回答所用参数：型号=4680 三元圆柱、需求增量=0.2、周数=6。 P50 产能=5.1836GWh",
    "taskId": "task_01KWRVCYB79KVJWCNKAPZHZ8ZM" },
  "gaps": [], "maturity": "GOVERNED" }

GET /b/v1/outbox → 含 { "event": "scenario.matured", "eventId": "evt_01KWRVCYHH1SDYG5020PHKJJD5" }（域事件 outbox 真在）

POST /b/v1/scenarios/S01/launch → 202 task_01KWRVDAB65V8FA2TWF9FTYNPR
GET /b/v1/queries/{task} → COMPLETED · path=WORKFLOW · classification.model=deterministic:scenario-bind（§2.4 跳过 LLM classify）
  答案 blocks：
    TEXT  本次回答所用参数：型号=4680 三元圆柱、需求增量=0.2、周数=6。
    KPI   P50 产能 = 5.1836 GWh
    KPI   P90 产能 = 4.8585 GWh
    KPI   缺口比例 = 0 %
    TEXT  主要瓶颈为瓶颈工序 …（⟦ref:prov_*⟧ 溯源三条）
```

**逐值对照后端真值**（KILL-MOCK-RED：前端所见 == 后端求解器直调）：

```
POST /a/v1/solvers/capacity_forecast/invoke {"args":{"modelId":"4680-NCM","demandDelta":0.2,"weeks":6}}
→ data.p50 = 5.1836 · data.p90 = 4.8585 · gap = -4.8585（无缺口→缺口比例 0%）
```
launch KPI（5.1836 / 4.8585 / 0%）与求解器直调**逐值一致**。非占位、非探索兜底、非合成冒充。

## 二、真 PG live-fire：种子守卫根治（PRD 验收 #2 复现修复）

DB `postgres://…/agentcore_grow_live`（PostgreSQL 16 真库·启动幂等迁移 001–012）：

```
B1 boot 后：intent_definitions=20 · scenario_packages=1（per-id 幂等播种在位）
B2 复现烂状态（服务在跑）：DELETE FROM intent_definitions; DELETE FROM execution_plans;
   → intent_definitions=0，包仍在 —— 即 §0 根因表「包已存在则意图永不再种」的真部署死态
B3 POST :4003/b/v1/scenarios/S01/grow（烂状态下直接 grow，不重启）
   → 200 maturity=GOVERNED · verification=VERIFIED/WORKFLOW · answerPreview「…P50 产能=5.1836GWh」
B4 SQL 直证（psql 行级）：
   SELECT count(*) FROM intent_definitions                      → 20（意图自愈回满）
   SELECT status … WHERE key='capacity_feasibility'             → PUBLISHED
   SELECT record->>'maturity' FROM scenario_ontogenesis_runs …  → GOVERNED（留痕落真 PG·migration 012）
   SELECT event FROM domain_events WHERE event LIKE 'scenario.%' → scenario.matured（outbox 真 PG 行）
B5 POST :4003/b/v1/scenarios/S01/launch → COMPLETED · WORKFLOW · deterministic:scenario-bind
   KPI P50 产能=5.1836 GWh · P90=4.8585 GWh · 缺口比例=0 %（与内存/后端直调同值·R6 确定性）
```

根治点：`main.ts` 播种不再挂「包存在」守卫（`ensureScenarioPackageSeed` per-id 幂等·任意租户），
`grow`/任何场景端点经 `ensureScenarios` 懒自愈——**包在意图空的库上 grow 即自动补齐意图→S01 出 KPI**。

## 三、齿（真实测试·revert 即红·全部前台跑读 exit code）

| 齿 | 文件 | revert 自证 |
|---|---|---|
| 事件齿：三事件入 outbox（matured/gap_detected/growth_triggered·SSE ⊕ 域事件双通道） | `test/scenario-ontogenesis-outbox.test.ts`（3 例） | 删 growScenario 末段 `emitDomainEvent` → **3 红**（亲测） |
| 验证门齿：答案空（零 blocks）→ NO_ANSWER 不 GOVERNED | 同上 · 与既有占位样本 `scenario-honest-gate.test.ts` 互补 | 把 `hasReal` 放水成 `status==="COMPLETED"` → **2 红**（亲测） |
| 真 PG 齿：烂状态→grow 自愈→GOVERNED→launch KPI + SQL 行级直证 | `test/scenario-grow-pg.integration.test.ts`（3 例·env-gated `DATABASE_URL_TEST`·仿 datacore execlock-pg 约定） | 真 PG 上 3/3 绿（本机 PostgreSQL 16 实跑） |
| 既有 P1/P3 齿回归 | scenario-ontogenesis / scenario-growth-wiring / scenario-honest-gate / scenario-seed-multitenant 等 | 20/20 绿 |

agentcore 全套：**94 passed | 2 skipped（521 tests）**。`pnpm -r build` 0 err · `pnpm gates` **exit 0**（含 ontogenesis:check / ontology-slices:check）。

## 四、复用链（复用不重写·在既有机件上编排）

- 意图/计划：`ensureScenarioPackageSeed`（per-id 幂等 upsert + PUBLISH）——种子守卫根治即自愈通道。
- 规则：`injectScenarioRuleStep`（O10·卡 rules[] 减求解器已覆盖 = 待补集自动插 `evaluate_rules` 步）。
- 切片：OBO `planSlice` → DataCore `/a/v1/slices/plan`（A3.3 slice-planner·确定性 BFS·索引复用 A3.4）。
- 缺件补齐：`buildGrowthLoopWiring` 单源 probe/fill（与 `/api/v1/growth/run` 共用·RL3 不分叉）→
  缺数据走 **DF.9 正门**（`/a/v1/growth/fill-data` 经 connectors.upload；空租户 `/a/v1/growth/provision-world` 经 synthetic.runJob 真合成正门）；
  缺计划/求解器 → `scaffoldDraftPlan` DRAFT（R4 禁自动发布）或诚实开 `GrowthTicket`（A18 临时求解器晋升走 L15 既有链）。
- 末步 A10：`verifyScenario` 把 `triggerQuestion` 经 QOS 正序实跑到终态（同 `verifyBuild` 语义·真答案=非空/非 gap/非兜底/dataBearing）。

## 五、PRD §8 验收映射（诚实边界）

| §8 | 状态 | 证 |
|---|---|---|
| 1 逐卡 20 张跑通 | ◐ 本单证 S01 内存+PG 双模全链；20 卡逐张 grow 属 GATE-WRITEBACK 单（`ontogenesis:check` 扩逐卡断言已在 gates） | 上文一/二 |
| 2 PG 复现修复 | ✅ 本单核心交付 | 上文二 + PG 齿 |
| 3 classifier 关掉仍 Path A | ✅ 机制已证：`deterministic:scenario-bind`（本次两模式 launch 均未走 LLM classify·ScriptedLlm 零消耗） | launch 输出 clf-model |
| 4 缺则不静默 | ✅ 后端面：缺件卡 grow → PROVISIONAL+gapCode+GrowthTicket+gap_detected（outbox 可订阅）；前端诚实卡片属 LAUNCH-DET 单 | 事件齿 + growth-wiring 齿 |
| 5 门绿 | ✅ gates exit 0 + 4 包测试绿 | 上文三 |
| 6 北极星距离 | 见下 | — |

**北极星距离（fde-delivery 诚实汇报）**：还差——① 前端「此卡发育中：缺 X，工单 #N」诚实卡片（LAUNCH-DET 单）；② 20 卡逐张 grow 全验 + `scenarioClosure` 升 A10 门（GATE-WRITEBACK 单）；③ O9「缺件→自动补→GOVERNED」活体收敛仍止于 BOUNDARY+诚实开票（scaffold 计划 DRAFT·R4 禁自动发布，评审已钉）；④ 本证据数据源为合成种子世界（demo 租户·seed 42），非真实客户数据——真实数据仍走 DF.9 真人正门。
