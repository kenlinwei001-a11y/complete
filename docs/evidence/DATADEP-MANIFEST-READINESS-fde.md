# DATADEP-MANIFEST-READINESS · 真实测试证据（真起服务·真跑·逐值对照后端·不作假）

数据补齐拱心石/脊（六站一脊）。真起 datacore(:4055 内存 SEED_DEMO) + agentcore(:4066·DATACORE_BASE_URL→4055)，
真跑推演入口就绪闭环，curl 逐值对照后端。R6 确定性 seed=42。runtime 不调 LLM（纯计数探测）。

## 站②治本 · loadContext 读清单并集（非写死 22 类）

`loadContext` 从内联硬编码 22 个 `listByType` 改为迭代 `CONTEXT_ROLES ∩ ⋃(SOLVER_DATADEP 各求解器清单角色)`。
门 `datadep-manifest:check`：`uncoveredContextRoles()==[]`（每上下文角色被某清单覆盖）→ 并集==全 22 角色 → 字节一致。

```
$ node scripts/check-datadep-manifest.mjs
✓ datadep-manifest:check 通过（26 入口声明清单 + 21 豁免 = 47 求解器全覆盖·22 上下文角色全被清单覆盖·loadContext 读清单并集字节一致 R6）。
```

牙齿（green→red 自证·摘一个入口清单 → 红）：
```
$ (dist 内删 capacity_rollup 清单) node scripts/check-datadep-manifest.mjs
✗ capacity_rollup：既无 SOLVER_DATADEP 清单、又不在 EXEMPT → 推演入口无输入数据契约（拱心石缺·run-first 回潮）
✗ datadep-manifest:check 未过  (exit 1)
```

单测 `apps/datacore/test/datadep-manifest.test.ts` 9/9 绿（loadContext 读清单并集 + R6 重跑字节一致；checkReadiness 空租户诚实缺口 / 已播种就绪 / present-vs-needed）。

## 站③ 通用就绪探测 · present-vs-needed（precondition-first·非 run-first）

### 已播种 demo 租户 → ready（POST /a/v1/solvers/capacity_rollup/readiness）
```json
{"entryRef":"solver:capacity_rollup","ready":true,
 "roles":[{"roleType":"base","resolvedType":"Base","present":12,"needed":1,"ok":true},
          {"roleType":"line","resolvedType":"Line","present":12,"needed":1,"ok":true},
          {"roleType":"process","resolvedType":"Process","present":60,"needed":1,"ok":true},
          {"roleType":"equipment","resolvedType":"Equipment","present":72,"needed":1,"ok":true},
          {"roleType":"model","resolvedType":"Model","present":6,"needed":1,"ok":true}],
 "missingParams":[],"gaps":[]}
```
**逐值对照后端**（`GET /a/v1/ontology/object-types/stats`）：Base count=12、Model=6、Order=24 —— 与 readiness `present` 逐值一致（非合成/非哈希·真 listByType 计数）。

### 非上下文角色解析（order_fullchain·materialBalance）
```
ready True
order Order 24 >= 1 True
model Model 6 >= 1 True
demandSegment DemandSegment 3 >= 1 True
materialBalance MaterialBalance 3 >= 1 True   ← 清单角色可超出 22 上下文字段·就绪探测覆盖
```

### 空租户 → 诚实缺口（非静默空·非假就绪）
```json
{"entryRef":"solver:capacity_rollup","ready":false,
 "roles":[{"roleType":"base","resolvedType":"Base","present":0,"needed":1,"ok":false}, ...],
 "gaps":[{"gapCode":"EMPTY_DATA","atStep":"readiness:base","evidence":"角色「base」→ 类型 Base 现有 0 行 < 需 1 行",
          "suggestedFill":"补 Base 数据（SOFT 走 synthetic.runJob 确定性合成 / HARD 涉真实业务实体走真人正门）","blocking":true}, ...]}
```

## 站④⑤⑥ 全闭环 · 探测→看板(人工闸)→认领→SOFT synthetic 真物化→重跑 ready

`POST /b/v1/entries/solver:capacity_rollup/readiness`（fresh 空租户 freshco9）：
```
1. readiness → ready:False | gaps:5 | registered:1
   - DATA_GAP OPEN SOFT provisionWorld | [solver:capacity_rollup|world-empty] 空世界（5 个角色全 0 行）→ 合成确定性起步世界
   （空世界 → 单条 provisionWorld·避免逐角色刷屏；部分世界单类型缺口 → 逐角色 SOFT fillData / HARD importData）
2. 看板 GET /b/v1/growth/worklist?kind=DATA_GAP → 1 项 OPEN（人工闸·不自动补·G-9 触发权交回人手）
   幂等：重 POST readiness → registered 复用同项（不刷屏·open DATA_GAP 去重）
3. claim → CLAIMED；fill → DONE：「已 provision 确定性合成起步世界（battery-manufacturing·493 对象·seed=42）」
   （⑤ SOFT 走 synthetic.runJob 真物化一致世界·origin=SYNTHETIC·R6·替通用正则 fill-data 值不接地弱点）
4. ⑥ 重跑 readiness → ready:True | remaining gaps:0
   base present=12 ok=True / line 12 / process 60 / equipment 72 / model 6
```
**逐值对照后端**（freshco9 `stats`）：`{Base:12, Line:12, Process:60, Equipment:72, Model:6}` == readiness present —— 真物化对象、真计数、真就绪（非假收敛）。

## 边界（诚实）
- **空/新租户** SOFT → provisionWorld（synthetic.runJob·可合成起步世界·真物化）；**HARD 真实业务实体缺口**（命中 BASE/SEG 词表）→ importData 真人正门深链 `/connections`（不自动合成真业务事实·符合真实业务边界）。
- readiness 为纯计数确定性探测·runtime 不调 LLM（R6）；design-time comprehend 倒推填清单是另一路（不进 runtime）。
