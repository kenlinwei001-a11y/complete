# QUERY30-P4 跨求解器编排层 · FDE 真跑证据（治 countermeasure_combo 诈账根）

> 单：**Q30-P4 跨求解器编排层**（QUERY30-ORCH epic·DESIGN-query30-orch §1 P4 行）。
> 基线：`abf80fc`（含 P2+P3·SOLVER_REGISTRY 58 键）。
> 真起服务真跑真数据真看结果（铁律 0.4）——不作假、不图省事、以根因为原则。

## 0. 一句话

`countermeasure_combo` 历史诈账根（`gap×{0.3,0.15,…}` 启发系数**冒充各求解器决策级释放量**）本体已治：改由**编排层真调 4 子求解器**（`cert_schedule`/`changeover_sequence`/`outsourcing_split`/`capex_scenario`），把各**异构、无公共 release 字段**的真产出经**确定性映射器**归一到**统一 万套 gap 释放账本**（release 逐值溯自子求解器真输出字段·非魔数系数），再真贪心最小成本闭合缺口 + 保交付/保毛利/保信用「三选二」权衡。

## 1. 真起双服务

```
# datacore
PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 CREDENTIAL_KEY=<64hex> SERVICE_TOKEN=svc node apps/datacore/dist/server.js
# agentcore
PORT=4102 JWT_SECRET=dev DATACORE_BASE_URL=http://127.0.0.1:4001 SERVICE_TOKEN=svc node apps/agentcore/dist/main.js
```
`GET /b/v1/scenarios`（demo:planner）→ total 36·S36 `对策组合编排`·intentKey `countermeasure_combo_q`·mode `WORKFLOW_FIRST`·triggerQuestion「保交付/保毛利/保信用三选二，杠杆组合怎么排？」。

## 2. Q6 真痛点问句经 QOS 命中（path=WORKFLOW COMPLETED·非手喂合成入参）

```
POST /api/v1/queries   X-Debug-User: demo:planner:planner
{ "packageId":"pkg_battery_manufacturing",
  "query":"保交付/保毛利/保信用三选二，杠杆组合怎么排？",
  "context":{"view":"plan","selectedObjects":[],"filters":{}} }
→ task ... status=ROUTING → 轮询 status=COMPLETED·path=WORKFLOW
```

**答案块（真渲染·solver_summary 投影 countermeasure_combo 真输出）**：
- text：`结论：存在可行方案；缺口已被完全覆盖`
- text（note）：`跨求解器编排真调 4 子求解器·选 2 杠杆闭合缺口·各释放量逐值溯自子求解器真产出（非魔数系数·KILL-MOCK-RED）`
- kpi：`总成本 46.6732` · `残余缺口 0` · `是否可行 是` · `缺口 144`
- kpi：`Sub Solvers cert_schedule、changeover_sequence、outsourcing_split、capex_scenario`
- kpi：`Tradeoff·Note 缺口闭合；保 [保交付]，舍 [无]`
- table（combo）：
  | key | solver | release | cost | basis |
  |---|---|---|---|---|
  | cert_unlock | cert_schedule | 107.33 | 10.0032 | Σ schedule[].unlockCapacity=107.33（认证解锁产能贡献·直接求和·最晚完成周 10） |
  | outsource_overtime | outsourcing_split | 36.67 | 36.67 | allocation[overtime].qty=57.6万套·单位成本1（渠道真产出） |
- table（objectives）：delivery=PROTECTED / margin=NEUTRAL / credit=NEUTRAL
- 口径：dataMode SYNTHETIC · needsRealLevers false · 置信度 PARTIAL（合成数据·非真实接入）

## 3. 逐值对照子求解器直 invoke 真值（证真调·非魔数）

`POST /a/v1/solvers/<key>/invoke`（demo:planner）：

| 子求解器 | 直 invoke 真值 | 编排组合里对应杠杆 | 对照 |
|---|---|---|---|
| `cert_schedule` | Σ `unlockCapacity` = **107.33**（6 待认证型号·maxFinishWeek 10） | cert_unlock **release=107.33** | ✅ 逐值等 |
| `outsourcing_split`(gap=144,totalDemand=960) | overtime qty=**57.6**·cost 57.6→unitCost 1.0 | outsource_overtime basis「qty=57.6」·组合取用 **36.67**（=残余缺口 144−107.33·择优 min(remaining,cap)） | ✅ 溯真产出 |
| `changeover_sequence` | `savedVsDueMin` = **0**（排序无省时） | 杠杆**诚实缺席**（映射器返 null·不补位） | ✅ 诚实空 |
| `capex_scenario`(aggressive) | 峰值新增 max(S−s0)=**9.5** 万套/季·IRR ZZ 18.88%/JM 9.31% | capex_expand（costRank3·组合未选·cert+overtime 已闭合缺口） | ✅ 真调·择优未选 |

**证真调非魔数**：cert_unlock 释放量 107.33 **恰等** cert_schedule 直 invoke 的 Σ unlockCapacity；若为历史魔数系数 `gap×0.3=43.2` 则不会随子求解器真产出变。

## 4. 真调证据（换子求解器输出 → 组合跟变）

- 单测（`test/q30-p4-orchestration.test.ts`）：`mapCertLever({unlockCapacity:10})`→组合 residualGap=90；`mapCertLever({unlockCapacity:80})`→组合 residualGap=20。换 cert 真产出，组合释放量/残余缺口随之变（魔数系数不会随 unlockCapacity 变）。
- 端到端逐值对照（上表）：组合 cert_unlock release === cert_schedule 直 invoke Σ unlockCapacity（真世界·随认证数据变而变）。

## 5. R6 确定性

`countermeasure_combo` 无参 invoke 两次 → 输出字节一致（`byte-identical: true`）；`gap=50` → 组合仅 cert_unlock=50（随输入变·确定性）。全编排纯函数·无时钟/随机/网络。

## 6. 诚实降级仍在（不回潮魔数）

- 子求解器真无产出（如 changeover savedVsDueMin=0）→ 该杠杆诚实缺席（映射器返 null·不补位）。
- **maintenance_stagger 不入决策级账本**（其 loadByWeek 演示合成·loadDrop 量纲≠产能·纳入即借名/单位错配诈账）。
- 杠杆不足闭合缺口 → `feasible:false` + 残余缺口明示（单测：gap100·仅 release30 杠杆 → feasible false·residualGap 70）。
- 无任何真杠杆（直调纯函数无 levers）→ `needsRealLevers:true` + 空组合 + note「绝不以启发系数冒充」（KILL-MOCK-RED·历史诈账不回潮）。

## 7. 门 / 测试

- 4 包 build 绿。
- datacore 全测绿（含新 `test/q30-p4-orchestration.test.ts` 15 用例：映射器逐个真映射+诚实空·组合择优三选二·真调证据·R6·诚实降级）。
- agentcore 全测绿（含 `evals-scenario-suite` 36/36 场景经 QOS 跑通·S36 真执行产出非空答案）。
- 门：`solver-coverage:check` / `solver-label-coverage:check`(418=418·含 objectives/tradeoff) / `no-silent-mock:check` / `ontology:check` / `ontology-slices:check` / `chain:check` 绿。
- 本体回写：§2.E 求解推演域（编排层）+ §8 G-16（countermeasure 诈账根本体已治）+ 切片同步（`node scripts/build-ontology-slices.mjs`）。

**诚实边界（非本单范围）**：`genuine-sim:check` / `datadep-manifest:check` 在**基线 abf80fc 即已红**（P3 遗留 3 求解器 energy_cost_schedule/reroute_decision/multi_constraint_schedule 未入前端消费面/DATADEP 分类，与本单无关·经 git stash 清基线复跑核实同红）；本单 countermeasure_combo 于两门均已正确归类（datadep.ts SOLVER_DATADEP + genuine-sim VIA_PROJECTION），**零新增红**。
