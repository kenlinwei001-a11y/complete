# FDE 证据 — ONTO-SCEN-GATE-WRITEBACK（场景发育闭环收口门）

> 亲手真跑（非冒烟）：内存态真起 agentcore（buildServer + memory repos + mock DataCore 合成世界），
> 逐张 grow 20 卡经 QOS 正序实跑 triggerQuestion 到终态 → 读回 task.answer.blocks 逐卡比对。
> 复现：`node scripts/check-scenario-ontogenesis-runtime.mjs`（已并入 `pnpm gates`）。
> 数据源诚实边界：mock DataCore = A7 合成数据发动机（确定性种子 seed=42·R6 字节级可复现），**非**外部真实业务数据源；
> 求解器为真实注册求解器真 invoke（capacity_forecast/quote_margin/carbon_footprint…），KPI 值为求解器真算，非哈希/兜底。

## 1. 20 卡 grow 状态表（PRD 验收#1·逐卡）

| 卡 | 名称 | mode | maturity | verif | path | 答案块 | 样本 KPI（求解器真值） |
|---|---|---|---|---|---|---|---|
| S01 | 订单可承接性评审 | WORKFLOW | GOVERNED | VERIFIED | WORKFLOW | text×2 kpi×3 | P50 产能=74.7GWh; P90 产能=65.1GWh |
| S02 | 交期风险与受影响订单 | WORKFLOW | GOVERNED | VERIFIED | WORKFLOW | text×2 table×1 | 受影响订单表（table 投影） |
| S03 | 风险越线根因 | AGENT | GOVERNED | VERIFIED | WORKFLOW | text×3 kpi×1 table×1 | Base=常州（根因时序表） |
| S04 | 月度规划体检 | WORKFLOW | GOVERNED | VERIFIED | WORKFLOW | text×4 kpi×2 table×1 | 评分=50; 判定=站不住 |
| S05 | 经营方案比选 | AGENT | GOVERNED | VERIFIED | WORKFLOW | kpi×1 table×1 text×1 | 推荐方案=D |
| S06 | 处置方案采纳 | WORKFLOW | GOVERNED | VERIFIED | WORKFLOW | text×2 action_draft×1 | 行动草稿（action_draft 投影） |
| S07 | 产线认证排期 | WORKFLOW | GOVERNED | VERIFIED | WORKFLOW | text×3 kpi×1 table×1 | 认证工程师组数=3组 |
| S08 | 物料齐套分析 | WORKFLOW | GOVERNED | VERIFIED | WORKFLOW | text×3 kpi×1 table×1 | 缺料项数=1项 |
| S09 | 长协执行与补缺 | WORKFLOW | GOVERNED | VERIFIED | WORKFLOW | text×3 kpi×5 table×1 | 净需求=7617.12; 覆盖量=0.52 |
| S10 | 库存水位优化 | WORKFLOW | GOVERNED | VERIFIED | WORKFLOW | kpi×1 table×1 text×4 | 可释放现金=0元 |
| S11 | 换型排序优化 | WORKFLOW | GOVERNED | VERIFIED | WORKFLOW | text×4 kpi×3 table×1 | 换型总耗时=46分钟; 较交期节省=0分钟 |
| S12 | 良率波动诊断 | AGENT | GOVERNED | VERIFIED | WORKFLOW | text×3 kpi×2 table×1 | 良率断点·发生日=31; 降幅=0.0571 |
| S13 | 检修窗口错峰 | AGENT | GOVERNED | VERIFIED | WORKFLOW | table×1 text×3 | 错峰表 + ⟦ref:prov…⟧ 溯源 |
| S14 | 外协决策 | AGENT | GOVERNED | VERIFIED | WORKFLOW | text×3 kpi×3 table×1 | 总成本=151947.2元; 较全延期节省=48052.8元 |
| S15 | 接单毛利评审 | WORKFLOW | GOVERNED | VERIFIED | WORKFLOW | text×4 kpi×8 | 毛利率=0.2565; 毛利下限=0.12 |
| S16 | 客户信用风险 | WORKFLOW | GOVERNED | VERIFIED | WORKFLOW | text×4 kpi×6 table×1 | 授信额度=5782元; 风险敞口=2075元 |
| S17 | 产能投资评审 | AGENT | GOVERNED | VERIFIED | WORKFLOW | text×3 kpi×8 table×1 | 季度序列=4; 情景=基准 |
| S18 | S&OP 月度平衡 | WORKFLOW | GOVERNED | VERIFIED | WORKFLOW | text×2 kpi×1 table×1 | 缺料项数=2项（sop_balance→mrp_netting 改绑，BP-4） |
| S19 | 季度缺口对策 | AGENT | GOVERNED | VERIFIED | WORKFLOW | text×5 kpi×2 | 季度=2026Q2; 残余缺口=50 |
| S20 | 碳足迹核算 | WORKFLOW | GOVERNED | VERIFIED | WORKFLOW | text×4 kpi×8 | 碳足迹合计=349.62kgCO₂e; 碳阈值=70kgCO₂e |

**分布：`{"GOVERNED":20}`** — 20/20 grow→VERIFIED，每卡答案含承载数据块（kpi/table/action_draft/⟦ref⟧），无占位、无探索兜底。

### 诚实说明：为何 7 张 AGENT_FIRST 卡也 GOVERNED（不是假装）
mode 钉死表 7 张 AGENT_FIRST（S03/S05/S12/S13/S14/S17/S19）价值在推理叙事「为什么/哪个好/怎么选」。
本闭环里它们**同样长成 GOVERNED**，原因是 §2.4 确定性 scenario-bind：点卡/grow 携 `scenarioIntentKey` →
编排器**确定性绑定意图→计划走 Path A（WORKFLOW）**，跑其工作流计划投影求解器真值，**不需 LLM**（path 列全 WORKFLOW 即证）。
- **这里 GOVERNED 的含义**：该卡工作流计划真投影出承载数据块（数字/表/行动草稿）——决策视图可用。
- **本环境未覆盖的边界**：AGENT_FIRST 卡的**agent 推理叙事路径**（Path B·需 LLM）未在此跑；若某卡因缺 LLM 落 Path B
  失败，收口门 §6.5 分支保证它**诚实 PROVISIONAL + gaps 处置**而非静默——两种都合规。当前 mock 世界下无一落此分支。

## 2. 点卡真决策视图（launch 正序抽样·§2.4）

| 卡 | status | classification.model | path | KPI（前端决策视图逐值 = 后端求解器真值） |
|---|---|---|---|---|
| S01 | COMPLETED | deterministic:scenario-bind | WORKFLOW | P50 产能=74.7GWh; P90 产能=65.1GWh; 缺口比例=9.8% |
| S15 | COMPLETED | deterministic:scenario-bind | WORKFLOW | 毛利率=0.2565; 毛利下限=0.12; 差额=0.1365 |
| S20 | COMPLETED | deterministic:scenario-bind | WORKFLOW | 碳足迹合计=349.62kgCO₂e; 碳阈值=70kgCO₂e; 判定=超标 |

`classification.model=deterministic:scenario-bind` 证 §2.4 跳过 LLM classify（与 classifier 死活解耦）；
KPI 即答案块 value，前端 renderer 直接投影同一 task.answer.blocks（前后端同源，无二次加工）。

## 3. 收口门齿 · revert-red 亲验

- 门：`scripts/check-scenario-ontogenesis-runtime.mjs`（并入 `pnpm gates`）。绿：`✓ … 20/20 GOVERNED`。
- **revert 实验**（临时把 seed 派生计划的 `solver_summary` 投影 render 步换成静态 text 占位 → 重建 agentcore → 跑门）：
  - 分布塌成 `{"GOVERNED":4,"PROVISIONAL":16}`；门 **exit 1** 红，报例：
    - `工作流地板 卡 S04(WORKFLOW_FIRST): 应确定性 GOVERNED，实 PROVISIONAL/RENDER_NOT_PROJECTED`
    - `§6.5 卡 S04: NEEDS_HUMAN 缺口 RENDER_NOT_PROJECTED …`
  - 还原投影 render + 重建 → 门复绿 20/20。证门有牙（§6.1 承载数据块 + 工作流地板真守渲染投影退化）。

## 4. 北极星距离表（还差哪几环 · 诚实边界）

| 北极星环节（PRD §1 DoD-as-experience） | 现状 | 距离 / 诚实边界 |
|---|---|---|
| 点任一卡→真决策视图或诚实缺口，永不"未能产出回答" | ✅ 达成 | 20/20 出真数据块；全站零死答串（check-ontogenesis grep 门守）。**合成数据源**下达成 |
| 新建/导入卡=胚胎→倒序发育长全闭包→A10 验证→GOVERNED | ✅ 达成 | growScenario 全环（意图/计划/投影/规则/切片/求解器）+ verifyScenario A10 |
| 与 classifier/目录/部署模式/角色解耦（确定性绑定） | ✅ 达成 | launch classification.model=deterministic:scenario-bind |
| GapReport→倒序生长/开单，绝不静默 | ✅ 达成 | AUTO_DERIVE→runGrowthLoop；NEEDS_HUMAN→GrowthTicket+通知（§6.5 门守 disposition+ticketId） |
| scenarioClosure 查存在→查跑通 | ✅ 本单达成 | ready ⟺ 无结构缺口 ∧（未 grow 或已 grow 到 VERIFIED）；grow-失败卡 ready=false（本单新测钉） |
| **真实外部数据源接入** | ⛔ 未接（设计外 · PRD §1.4 明列不在范围） | 现全部经 A7 合成正门（确定性种子）。真业务实体仍走真人正门（DF.9 HARD） |
| **AGENT_FIRST 卡的 agent 推理叙事路径（Path B·需 LLM）** | ⛔ 本环境未跑 | 无 LLM。当前经确定性 Path A 出数据块即 GOVERNED；推理叙事质量未验（合规边界，非缺陷） |
| **真浏览器逐值对照前端 UI** | ◐ 部分 | 本单为后端真跑 + launch 同源 blocks 证据；真浏览器对照由 `ui-smoke:ontogenesis`（需 chromium，本环境 SKIP）承 |

**一句话诚实结论**：收口门让"20 卡 grow→VERIFIED→点卡出真决策视图"从**单测冒烟**升级为 **gates 链里真跑一遍**的硬门；
GOVERNED 均以**合成数据源 + 确定性 Path A**为前提，非外部真数据、非 agent 推理叙事——这两环按 PRD 属范围外/环境外，如实标注不冒充。
