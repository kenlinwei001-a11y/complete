# QUERY30-P5 发育层 · FDE 真跑证据（DESIGN-query30 §2.5/§2.6 · 闭 G-9）

> 一切以真实测试为原则（铁律 0.4）：真起 datacore(4001)+agentcore(4102) 双服务（内存模式·SEED_DEMO=1·无 LLM key），
> 真 admin/planner API grow→launch·curl 逐值 + 逐值对照 datacore 直 invoke 真值。**未伪造任何 GOVERNED / 任何 KPI。**
> P5 只补 QUERY30-ORCH 缺口③的**发育层欠账**（7 workflow / 2 agent / 5 skill / intent），不新建求解器（P0–P4 已交付 58 求解器 + 编排层）。

## 0. 服务

- datacore：`PORT=4001 JWT_SECRET=dev BLOB_DIR=… SEED_DEMO=1 CREDENTIAL_KEY=<64hex> SERVICE_TOKEN=svc node apps/datacore/dist/server.js`（PID 记录·用完按 PID kill）
- agentcore：`PORT=4102 DATACORE_BASE_URL=http://127.0.0.1:4001 SERVICE_TOKEN=svc node apps/agentcore/dist/main.js`
- admin：`X-Debug-User: demo:user-admin:catalog_admin|planner` · planner：`X-Debug-User: demo:user-planner:planner`

## 1. 补齐清单（发育层欠账）

### 7 workflow 多步链（串起已交付求解器·s1→s2→render 各投真实字段）
| 卡 | intentKey | 链（s1 → s2） | 服务问句 |
|---|---|---|---|
| S26（已上·Q01 样板） | what_if_displacement_q | `what_if_displacement → multi_plan_compare` | 接单挤占推演全链 |
| **S37** | cash_alert_combo_chain | `cash_projection → countermeasure_combo` | 现金流哪周最紧张·缺口用什么杠杆组合补 |
| **S38** | disruption_reroute_chain | `supplier_disruption_radius → reroute_decision` | 断供波及哪些线·产量改道到哪成本最低 |
| **S39** | kit_schedule_chain | `kit_readiness → multi_constraint_schedule` | 齐套就绪 + 三约束联合排产 |
| **S40** | fullcost_margin_chain | `full_cost_rollup → margin_attribution` | 全成本态势 + 哪些订单毛利倒挂根因 |
| **S41** | signal_concentration_chain | `signal_propagation → concentration_risk` | 信号沿产线图传导半径 + 隐性集中敞口 |
| **S42** | capex_cash_chain | `cash_projection → capex_alternatives` | 现金约束下 CAPEX 方案哪套 IRR 最优 |

每条 workflow：`plan.steps` = s1 invoke_solver → s2 invoke_solver → render_answer（两 solver_summary 块各投 `SOLVER_RENDER_BINDINGS[solver]` 真实字段）+ `injectScenarioRuleStep` 把卡声明 rules 烘焙进 `evaluate_rules`（路径A 真裁决）。定义源 `apps/agentcore/src/mocks/seed.ts CHAIN_WORKFLOWS`。

### 5 skill 方法论（methodology.{conclusionTemplate,criteria}·确定性消费·非 LLM 注入）
`skl_displacement_analysis`（接单挤占分析法·四型枚举）· `skl_supply_risk`（供应链风险法·断供半径+集中度）· `skl_cash_projection`（现金投影法·安全垫+对策联动）· `skl_carbon_path`（碳合规路径法·碳价→毛利→绿电→CAPEX）· `skl_sop_transplant`（SOP 移植法·参数集对齐+代差风险）。
挤占/现金/供应链/信号/能耗卡从通用 skill 迁挂专门方法论（`intents/materialize.ts INTENT_SKILL`）。skl_sop_transplant 入库为方法论资产（SOP 移植场景需新本体·属后续单，诚实未挂卡）。

### 2 agent（绑求解器族 + 对口 skill + POST_CHECK 规则）
- `agt_order_advisor` 接单参谋：绑 what_if_displacement/multi_plan_compare/quote_margin/credit_exposure + 挂 skl_displacement_analysis + POST_CHECK **C34/C35/C13/C24**。
- `agt_supply_risk_control` 供应链风控：绑 supplier_disruption/signal_propagation/concentration_risk/reroute_decision + 挂 skl_supply_risk + POST_CHECK **C05/C16/C22**。
定义源 `apps/agentcore/src/mocks/seed.ts sceneAgent(...)`。（诚实边界：agent 路径 B 结构化作答需真 LLM·本确定性环境无 key → agent 由 `scene-agent-config:check` 静态验配置一致性，同既有 7 张 AGENT_FIRST 卡·非本单回归。）

### intent 目录
出厂目录 36→**42 卡**（QUERY30 30 问集的求解器直连意图 S26–S36 已入 + P5 六条多步链 S37–S42）；全 42 卡经 `materializeIntents` 物化一等 Intent（全绑定链 6 项齐）。

## 2. 发育闭环真跑（grow → GOVERNED·闭 G-9·非 seed 手装）

6 张新卡入 `SCENARIO_CATALOG`（PROVISIONAL 起）经 `growScenario` 三环长成 GOVERNED（发育 run 留痕）。真跑（admin grow）：

```
POST /b/v1/scenarios/S37/grow → maturity=GOVERNED · vstatus=VERIFIED · path=WORKFLOW · rings={data:true,ontology:true,capability:true}
  answerPreview: 现金安全垫(最低点)=5280944.6万元
POST /b/v1/scenarios/S40/grow → runId=sor_01KX7MFQX2GJJZ7K3C51PJ3WSR · maturity=GOVERNED · vstatus=VERIFIED · gaps=[]
  answerPreview: 全成本卷积：产能 4.9696 万套/周（12 基地）→ 收入 246.4/销售成本 206.1/毛利 40.3（毛利率 16.4%·C15）⟦ref:prov_…⟧
S38/S39/S41/S42 grow → 均 maturity=GOVERNED · vstatus=VERIFIED · rings 三环全闭
```
发育 run `ScenarioOntogenesisRun`（`sor_*`·runId/scenarioKey/ranAt/rings/verification/gaps）逐卡留痕；`GET /b/v1/outbox` 事件：`scenario.matured × 7`（本轮 grow 升相）+ `growth.pre_analysis_started/done`。**非 seed.ts 手装 GOVERNED**——卡出厂 PROVISIONAL，GOVERNED 由 grow 真验证 triggerQuestion 经 QOS 实跑到终态出真答案才判定（闭 G-9）。

## 3. launch 真跑（WORKFLOW COMPLETED·两求解器真值）

`POST /b/v1/scenarios/S37/launch`（planner）→ taskId → `GET /api/v1/queries/<taskId>`：status=COMPLETED · path=WORKFLOW，答案块（两求解器均真投影）：
```
TEXT: 现金流投影 13 周：期初 5820000 万元·回款 272820/付款 539055.4 万元·安全垫最低 5280944.6 万元(第 6 周·24 单) ⟦ref:prov_…⟧
KPI: 现金安全垫(最低点)=5280944.6 万元 · 期初现金=5820000 · 安全垫最低周=6 周 · 累计回款=272820 · 订单数=24 · 基地数=12
TABLE: [week/weekStart/inflowWan/outflowWan/netWan/endingCashWan] 12 行
TEXT(s2 countermeasure_combo): 跨求解器编排真调 4 子求解器·选 2 杠杆闭合缺口 ⟦ref:prov_…⟧
KPI: 总成本=46.6732 · 残余缺口=0 · 缺口=144 · Sub Solvers=cert_schedule、changeover_sequence、outsourcing_split、capex_scenario
TEXT(方法论口径·确定性组装): 〔现金投影方法论〕…安全垫最低周/最低值…缺口对策组合联动…
依据规则：C08、C23、C29 ⟦ref:prov_…⟧
```
S38–S42 launch 同样 COMPLETED·path=WORKFLOW·两求解器真数据块（摘）：
- S38：`半径 3 跳·受影响 12 个·末端 6 设备`（disruption）+ `11 候选线改道表`（reroute）
- S39：`8 缺料项表`（kit）+ `changeover/cert/sequencing 三子求解器`（multi_constraint）
- S40：`毛利率 16.4%·收入 246.4·销售成本 206.1`（fullcost）+ `倒挂 24 项·12 行订单毛利表`（margin_attribution）
- S41：`半径 3 跳·affected set 8 线`（signal）+ `最高集中度 Model 8 项`（concentration）
- S42：`安全垫 5280944.6 万·最低周 6`（cash）+ `推荐方案 B·2 可比方案`（capex_alternatives）

## 4. 逐值对照后端真值（铁律 0.4·字节一致·非 mock/兜底）

agentcore workflow 答案 == datacore 直 invoke 真值（`POST /a/v1/solvers/<key>/invoke`）：
```
datacore cash_projection {horizonWeeks:13}: minCashWan=5280944.6 · minCashWeek=6 · openingCashWan=5820000 · orderCount=24 · baseCount=12 · totalInflowWan=272820 · dataMode=SYNTHETIC
  == agentcore S37 launch（5280944.6 / 6 / 5820000 / 24 / 12 / 272820）✓ 字节一致
datacore full_cost_rollup {}: marginPct=16.4 · grossMargin=40.3 · revenue=246.4 · cost=206.1
  == agentcore S40 launch（16.4% / 40.3 / 246.4 / 206.1）✓ 字节一致
```
`dataMode=SYNTHETIC`（合成种子·LIVE 计算·诚实标注非真实接入）——**非 mock/哈希/兜底冒充真值**。

## 5. 自由 NL 路由（QOS POST /api/v1/queries·无 LLM 确定性分类器）

```
Q「未来 13 周现金流哪周最紧张？安全垫击穿了用什么杠杆组合来补缺口？」（view=dash）
  → status=COMPLETED · path=WORKFLOW · KPIs 安全垫最低点=5280944.6/最低周=6/…（命中 cash_alert_combo_chain）
Q「全成本口径下现在经营态势怎么样？有哪些订单毛利倒挂、主要是哪个成本项拖的？」（变体问句·view=dash）
  → status=COMPLETED · path=WORKFLOW · KPIs 毛利率=16.4/收入=246.4/…（命中 fullcost_margin_chain）
```
**诚实边界**：无 LLM 时走 `deterministicMatchScore`（字符 bigram 覆盖率·`orchestrator.ts`）——含具象锚点槽（如 Base objectRef）的卡自由问句未选中对象时诚实 `AWAITING_CLARIFICATION`（同既有 S02/S24·非失败）；跨 42 卡精确 NL 分辨需真 LLM classifier（生产链路配 provider·测试环境一律 mock）。发育层核心（workflow 多步链真执行出真数据）由 grow + launch 双坐实（路径A 确定性·不依赖 LLM）。

## 6. 门（全绿·EXIT=0）

- `scenario-ontogenesis-runtime:check`：42 卡真 grow 42/42 GOVERNED·36 张 WORKFLOW_FIRST 工作流地板全 GOVERNED（硬编码卡数 36→42 同步）。
- `scene-agent-config:check`：13 入口 + **42 一等 Intent 全绑定链 6 项齐** + 兜底 agt_universal 全工具面。
- `skill-integrity:check`：**16 skill** · 17 agent / 3 workflow / 42 plan / 42 intent 引用零孤儿 · 42 目录卡全显式映射。
- `ontogenesis:check` / `solver-coverage:check`（58 求解器零幽灵）/ `ontology-slices:check`（母体 hash 947bcbb6·11 切片同步）全过。
- 完整 `pnpm gates` EXIT=0（4 包 build + 全部 check-*.mjs + pnpm -r test）。

## 7. 本体回写

`docs/SYSTEM-ONTOLOGY.md`：§2.E 求解推演域末追加「Q30-P5 发育层已交付」段（7 workflow/5 skill/2 agent 清单 + 发育闭环真跑）；§8 G-9 断点行追加「✅ Q30-P5 发育层多步链已闭 G-9 该维」。`node scripts/build-ontology-slices.mjs` 重生成切片（母体 hash 947bcbb6f178ae77）。

## 8. 诚实边界与剩余

- **agent 路径 B 活体**：需真 LLM（本确定性环境无 key）→ 2 agent 由 `scene-agent-config:check` 静态验配置一致（tools/POST_CHECK/skill 齐），同既有 7 张 AGENT_FIRST 卡的验证口径；真 LLM 环境下方可 path-B 结构化作答。
- **skl_sop_transplant**：入库为方法论资产·SOP 移植场景卡需新本体（SopVersionRow.paramSet/Equipment.modelGeneration·DESIGN §2.2 未在 P5 求解器/编排范围）→ 诚实未挂卡，属后续单。
- **自由 NL 精确分辨**：无 LLM 确定性分类器为字符相似度地板·跨 42 卡精确路由需真 classifier；核心 workflow 执行由 grow+launch 确定性坐实。
