# WO-EXPERIMENT FDE 证据（④·决策 A/B·冠军-挑战者）

> 真起 datacore（内存 `SEED_DEMO=1`，端口 4051）+ 亲手 curl 自验 + 单测背书。
> 本体引用：对象类型 `SolverExperiment`/`ExperimentArm`（§2.B）· 链路「实验分流」边（§3 数据→本体→推演链）·
> 事件 `experiment.concluded`（§4 L18）· 门 `experiment-determinism:check`（§7）· 不变量 R2/R6/R13。

## 改了什么（按审核方设计 dev 实装）

- **契约** `packages/contracts/src/solvers.ts`：`SolverExperiment{id,tenantId,solverKey,championVersion,challengerVersion,splitPct(0-100),metricKey,status:DRAFT|RUNNING|CONCLUDED,startedAt,winner}` + `ExperimentArm{experimentId,arm:CHAMPION|CHALLENGER,paramsVersion,invokeCount,metricSum}` + 回执 `ExperimentReport`。
- **分流** `apps/datacore/src/solvers/service.ts`：`invoke` 取该 solverKey 的 RUNNING 实验 → 确定性 `hashString(tenantId+'|'+solverKey+'|'+canonicalJson(args)) % 100 < splitPct` 选挑战者臂 → `paramsAt(tenantId, challengerVersion)` 取参（否则 champion 当前版本，经 `loadContext(...paramsOverride)` 注入）→ 输出附 `__experiment{id,arm}`（不污染主结果·R13）→ 按 `metricKey` 输出字段值累加到对应臂（`recordExperimentOutcome`，确定性 R6）。
- **生命周期** `createExperiment/startExperiment/concludeExperiment/experimentReport`：conclude 按两臂均值落胜方（高者胜·并列/无数据 null），发 `experiment.concluded`。
- **路由** `apps/datacore/src/app.ts`：`POST /a/v1/experiments`(admin) · `POST /a/v1/experiments/:id/{start,conclude}` · `GET /a/v1/experiments/:id`（两臂 invokeCount/均值/胜负）。
- **仓储**：memory+pg 双实现（`repo.ts` 接口 + `memory.ts` + `pg.ts`）+ migration `030_solver_experiments.sql`（`solver_experiments`/`experiment_arms` doc-table·R2 租户列）。
- **门** `scripts/check-experiment-determinism.mjs`（并入 `pnpm gates`）。

## 真跑自验（curl·端口 4051·tenant demo·admin）

### 1) 建实验(split=50, metricKey=p50) → start
```
POST /a/v1/experiments {"solverKey":"capacity_forecast","championVersion":0,"challengerVersion":1,"splitPct":50,"metricKey":"p50"}
→ {"id":"exp_demo_emr0p95rnqbff7c", ... "status":"DRAFT","winner":null}
POST /a/v1/experiments/exp_demo_emr0p95rnqbff7c/start
→ {... "status":"RUNNING","startedAt":"2026-06-30T13:45:51.455Z"}
```

### 2) 真 invoke capacity_forecast 20 次（变请求键 k=req-1…req-20）→ 两臂各约半（确定性分流）
```
req-1:CHAMPION  req-2:CHALLENGER req-3:CHAMPION  req-4:CHALLENGER req-5:CHAMPION
req-6:CHAMPION  req-7:CHAMPION    req-8:CHAMPION  req-9:CHALLENGER req-10:CHALLENGER
req-11:CHAMPION req-12:CHALLENGER req-13:CHALLENGER req-14:CHALLENGER req-15:CHAMPION
req-16:CHALLENGER req-17:CHAMPION req-18:CHALLENGER req-19:CHAMPION req-20:CHAMPION
```
确定性 hash 分流，两臂均非空、量级各约半（非全落一臂）。

### 3) 同请求键恒同臂（R6·确定性）
```
req-1=CHAMPION  req-1=CHAMPION   （重跑同臂）
req-7=CHAMPION  req-7=CHAMPION
req-13=CHALLENGER req-13=CHALLENGER
```

### 4) GET 回执：两臂 invokeCount/均值
```
GET /a/v1/experiments/exp_demo_emr0p95rnqbff7c
arms:[
  {arm:CHAMPION,   paramsVersion:0, invokeCount:15, metricSum:77.754, metricMean:5.1836},
  {arm:CHALLENGER, paramsVersion:1, invokeCount:11, metricSum:57.020, metricMean:5.1836}
] winner:null
```
（challenger 版本 1 不在历史 → `paramsAt` 诚实回落当前版本 → 两臂均值相等 → 胜方 null·诚实平局。
metric **有显著差异 → 落胜方** 的对照见单测 ②，挑战者 `ramp.base` 拉低使 p50 更小 → winner=CHAMPION。）

### 5) conclude 落胜方（平局 → null·诚实）
```
POST /a/v1/experiments/exp_demo_emr0p95rnqbff7c/conclude
→ {... "status":"CONCLUDED","winner":null,"concludedAt":"2026-06-30T13:46:45.101Z"}
outbox: [{"event":"experiment.concluded","createdAt":"2026-06-30T13:46:45.101Z"}]   ← §4 L18 事件真发出
```

### 6) 关实验（无 RUNNING）→ 恒走 champion 当前版本·零影响既有
```
（conclude 后）POST /a/v1/solvers/capacity_forecast/invoke {"args":{"modelId":"4680-NCM","k":"after"}}
→ __experiment present? false   p50=5.1836   dataMode=LIVE     ← 输出不带 __experiment，主结果不变
```

### 7) authz（admin only）+ R2 租户隔离
```
planner 建实验  → HTTP 403
other 租户 GET demo 的实验 → HTTP 404
```

## 单测背书 `apps/datacore/test/experiment.test.ts`（4 passed）

- ① 确定性分流：split=50·40 次 invoke 两臂各约半 + 同请求键恒同臂；**挑战者参数版本（seeded v7·ramp.base 拉低）真生效 → chall.metricMean < champ.metricMean**；conclude → **winner=CHAMPION**（均值高者胜）；CONCLUDED 后 GET 仍回落定胜方。
- ② split=0 恒走 champion · split=100 恒走 challenger。
- ③ 无 RUNNING（DRAFT 未 start）→ 输出无 `__experiment`、两臂计数 0（零影响既有）。
- ④ 非 admin 建实验 403 · 未知 solverKey 400。

## 红线核对

- pnpm -r build（全 4 包）✅ · 求解器/校准回归批 48 tests passed（experiment/solvers/solvers-extended/solver-rowlevel/a18-llm-solver/m11-calibration）✅。
- `pnpm gates` 全绿（含新门 `experiment-determinism:check` + `ontology-writeback` + `seed-demo-smoke`）。
- R2 tenant_id everywhere（实验/臂 store 带 tenantId·跨租户 404）· R6 分流确定性（hash·非随机·canonicalJson(args) 请求键·同键恒同臂）· R13 不污染主结果（仅附 `__experiment` 诚实标）· R9 双仓储四处同改（repo.ts/memory.ts/pg.ts/migration030）。
- 模型标识 / 密钥不入提交物。
