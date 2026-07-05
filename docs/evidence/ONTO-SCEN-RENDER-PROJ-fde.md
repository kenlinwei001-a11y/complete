# FDE 证据 · WO ONTO-SCEN-RENDER-PROJ（P2 · 16 卡占位根除 · 真投影）

> 2026-07-05 · 真起双服务（非 mock 冒充）：DataCore `:4011`（内存模式 `SEED_DEMO=1` seed=42 确定性合成世界）+ AgentCore `:4172`（`DATACORE_BASE_URL=http://127.0.0.1:4011`）。鉴权 `X-Debug-User: demo:admin:admin|planner|catalog_admin`。

## ① 抽 3 卡逐值对照（答案块 vs `/a/v1/solvers/:key/invoke` 直调）——16/16 一致

抽样 S15（接单毛利·quote_margin）/ S18（S&OP 月度平衡·mrp_netting，规则注入卡）/ S16（客户信用·credit_exposure）。每卡 `POST /b/v1/scenarios/:key/grow` → 全部 `maturity=GOVERNED · VERIFIED · WORKFLOW · gaps=[]`，取验证任务 `GET /api/v1/queries/:taskId` 答案块，与同入参直调求解器逐值比对：

```
✓ S15 毛利率: 答案块=0.2565 | 直调求解器=0.2565
✓ S15 毛利下限: 答案块=0.12 | 直调求解器=0.12
✓ S15 差额: 答案块=0.1365 | 直调求解器=0.1365
✓ S15 判定: 答案块=过线 | 直调求解器=过线
✓ S15 构成·价格: 答案块=500 | 直调求解器=500
✓ S18 缺料项数: 答案块=2 | 直调求解器=2
✓ S18 叙事 summary: 答案块=3 种物料，2 种现货缺口（C06 齐套口径） | 直调求解器=（同）
✓ S18 表行0·物料: 答案块=三元正极 | 直调求解器=三元正极
✓ S18 表行0·净需求: 答案块=8180 | 直调求解器=8180
✓ S18 表行0·缺口: 答案块=654 | 直调求解器=654
✓ S16 授信额度: 答案块=5782 | 直调求解器=5782
✓ S16 风险敞口: 答案块=2075 | 直调求解器=2075
✓ S16 可用额度: 答案块=3707 | 直调求解器=3707
✓ S16 新单判定: 答案块=冻结（存在逾期>30天） | 直调求解器=（同）
✓ S16 逾期行0·发票: 答案块=arinvoice_4_0 | 直调求解器=arinvoice_4_0
✓ S16 逾期行0·金额: 答案块=1120 | 直调求解器=1120
逐值对照: 16/16 一致
```

投影形态（S15 为例，KPI 绑定序打头 = `SOLVER_RENDER_BINDINGS.quote_margin`，静态占位文案零出现）：
结论叙事（判定为「过线」带 provId 溯源标）→ KPI 毛利率/毛利下限/差额/判定（bound-first）→ 构成展开 KPI → evaluatedRules 真裁决表（C15/C24 PASS）→「依据规则：C15、C24」→ 口径脚注（dataMode SYNTHETIC 诚实标）。

## ② 规则真执行进答案依据（S18 注入路径）

S18 卡声明 `rules=[C18,C21,C22]`，其求解器 mrp_netting 不在 `SOLVER_RULE_REFS` → 种子期 `injectScenarioRuleStep` 烘焙 `evaluate_rules` 步（payload=求解器输出整对象）。真跑验证任务的 `answer.validationTrace.consistency.checks`：

```
{"kind":"AXIOM","ref":"C18","status":"PASS","detail":"C18 现金垫底线: 通过"}
{"kind":"AXIOM","ref":"C21","status":"PASS","detail":"C21 产销平衡偏差: 通过"}
{"kind":"AXIOM","ref":"C22","status":"PASS","detail":"C22 换型损失/排产约束: 通过"}
```

已被求解器 evaluatedRules 覆盖的卡（如 S15 C15/C24）不重复注入（轨E 单源），其真裁决以 evaluatedRules 表直接进答案（上①可见 PASS 行）。

## ③ sliceTargets 自动生成（datadep 派生候选 → slice-planner 校验回写·A3.4 索引复用）

20 卡 grow 后卡上回写的 planner 校验覆盖（此前出厂 20 卡 `sliceTargets===undefined` 零生效）：

```
S01 Model->[Base,Equipment,Line,MaintPlan,Process]   S02 Base->[Model,Order]
S03 Base->[DataSourceHealth,Order,Segment,Shipment]（DemandSegment/SopVersionRow 无本体链路→可达子集收敛）
S04 Base->[Segment]  S05 Base->[Segment]  S06 Base->[]  S07 Model->[Certification]
S08 Material->[MaterialBatch]  S09 Material->[PurchaseOrder]  S10 Material->[MaterialBatch]
S11 Line->[ChangeoverMatrix]  S12 Process->[EnergyMeter]  S13 MaintPlan->[Equipment]
S14 Base->[Order]  S15 Order->[Customer]  S16 Customer->[ARInvoice]  S17 Base->[CapexProject]
S18 MaterialBalance->[]  S19 Segment->[]（SopVersionRow 全无链路→收敛空目标，不误开 NO_SLICE 票）
S20 Model->[CarbonFactor]
```

- A3.4 索引复用实测：S15 规划命中既有已发布切片 `order_fulfillment_360`（`reused:true`），未重复建切片。
- 20 卡全部挂上 `genome`（intentKey/planSteps/renderBindings/ruleIds/sliceTargets/solverKey/dataNeeds，`deriveScenarioGenomes` 从计划本体+数据依赖清单派生，零手焙）。

## 20 卡全量 grow + 正序 launch

- **13 卡 GOVERNED**（VERIFIED/WORKFLOW·render 真投影）：S01 S02 S04 S06 S07 S08 S09 S10 S11 S15 S16 S18 S20。
- **7 卡 PROVISIONAL（诚实·非本单缺陷）**：S03 S05 S12 S13 S14 S17 S19 —— 均为 MODE-DISPATCH 钉死的 **AGENT_FIRST** 卡（价值在推理→路径 B），本环境无 LLM key → 探索无答案 → 诚实 `NOT_VERIFIED/OTHER`，与本 WO 之前行为一致（其 GOVERNED 化属 LLM 栈环境/GATE-WRITEBACK 批次）。
- 正序 launch S16：`status=COMPLETED path=WORKFLOW model=deterministic:scenario-bind`，KPI 与 grow 验证同值（授信额度 5782 / 风险敞口 2075 / 可用额度 3707 / 新单判定 冻结）。

## 齿（revert→red 亲测）

- `ontogenesis:check` §6.2/E：把 contracts dist 中 `quote_margin.margin` 改成 bogus 字段 → **exit 1**；还原 → exit 0。
- `ontogenesis:check` §6.2/F：向 seed 派生 render 塞回静态 markdown「…推演结果：」→ **exit 1**；还原 → exit 0。
- 运行期投影：`summarizeSolverOutput` 绑定字段缺席 → 抛 `RENDER_BINDING_MISSING`（`scenario-render-projection.test.ts` 断言 throw；静默降级会红）。
- 真值齿：`apps/datacore/test/render-bindings-real-fields.test.ts` 真合成世界真 invoke 16 求解器，逐绑定字段断言在场（挂名字段即红）+ 绑定 ⊆ `SOLVER_OUTPUT_SHAPES` + `DATADEP_ROLE_CANONICAL`↔`ROLE_CANONICAL` 逐键对账。
- `datadep-manifest:check` 增角色映射漂移红。

## 诚实边界

- 逐值对照基于确定性**合成**世界（SEED_DEMO seed=42，答案口径脚注亦标 `SYNTHETIC` 诚实位）；真实客户数据仍走真人正门。
- 7 张 AGENT_FIRST 卡在无 LLM 环境不产出可验证答案（设计内诚实降级），本单不改路径 B。
- S01 逐值口径此前已由 ONTO-SCEN-GROW FDE 坐实（P50/P90/缺口 与直调一致），本单补齐其 genome 绑定登记（gapPct/mainBottleneck 契约形状补登记，闭 G-2 残）。
