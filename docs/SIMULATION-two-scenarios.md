# 仿真两场景 · 逐步细节与推演结果（推演 + 规划体检）

> 来源：`scripts/provision-enterprise.mjs` 第【5b】步，跑在工业级 **XL** 数据上（10⁴ 订单 / 12 基地 / 6 型号 / 2000 物料批次 / 90 天时序）。所有数值取自真实运行，过程取自代码（标 `文件:函数`）。两场景均经操作员 JWT 走正门 API、行级权限贯穿、结果带 snapshotVersion 可下钻溯源、支持增删改查后二次推演。

环境前置（同一脚本第【1】–【5】步，全经 REST 配置，非硬编码）：
- 登录 demo/admin → JWT（A 签发 / B 经 JWKS 验签，OBO 透传）
- `POST /a/v1/synthetic/jobs {battery, scale:XL}` 一键合成：10 数据域 + 23 跨域本体类型 + 链接 + **10000 订单 + 2000 物料批次 + 3000 采购单 + 60 客户 + 90 天时序** + C01–C25 规则 + 21 求解器
- `POST /a/v1/rules` 追加并发布 C26–C33（共 15 约束）；`/b/v1/skills`×20、`/b/v1/agents`×10、场景入口×10

---

## 场景一 · 推演：受影响订单（"常州基地影响哪些订单？"）

意图 `affected_orders` · 视图 `risk` · 风险级 COMPUTE · 求解器 `affected_orders`。

### 逐步 IPO

| 步 | 模块 | 输入 I | 处理 P（做什么·怎么做） | 输出 O | 数据量 |
|---|---|---|---|---|---|
| 1 | AgentCore 鉴权 | `Bearer <JWT>` | resolveAuth 验签取 tid/sub/roles，保留 OBO token | RequestAuth{demo, admin} | — |
| 2 | 求解端点 entitlement | solverKey=affected_orders | `requireFeatureTag("solverKeys","affected_orders")`（关→404 不泄露） | 放行 | — |
| 3 | A6 行级取数 | ctx + args{baseId:"changzhou"} | `ontology.invokeSolver` 先经 **A6 过滤的 `queryObjects("Order")`** 取 visibleOrders（行策略 `Object.bases IN ${user.baseScope}`；admin 全量=10000） | visibleOrders(10000) | 扫 10⁴ 订单 |
| 4 | 上下文装载 | tenantId, visibleOrders | `loadContext`：并行拉 Bases(12)/Models(6)/Segments… + visibleOrders（#4 优化：不加载 13 新求解器才用的扩展类型） | SolverContext | 12+6+… |
| 5 | 求解算法 | ctx + {baseId, fromDay,toDay} | `affectedOrders`（risk.ts:275）：取 base=常州订单，窗口 **[day−7, day+14]** 过滤；逐单 `delay=⌈扰动/delayDiv(8)⌉`、`impact`；归并 **problems[]（4 类）** + **rootChains[]（order→judgement→rootCause→remedy）**。确定性，无时钟/随机 | {affected, total, problems, rootChains} | 命中子集 |
| 6 | 快照戳 | — | `snapshotVersion = ontology_version.epoch` | "1.2" | — |
| 7 | 返回 | — | `{ data:{…}, snapshotVersion }`（每数字可经 toolCall→snapshot 下钻） | JSON | — |

### 推演结果（真实运行）

- **受影响订单：45 单**（10000 单中按常州 + 窗口过滤命中）
- 样本行：`SO-10799 · 蓝海储能 · L148-LFP · 269 万套 · 交期 2026-07-01 · 延误估计 2 天 · 影响度 0.40`
- **problems[]：3 组**（按交期/齐套/瓶颈等归并）；每单挂 **rootChain** 根因链
- snapshotVersion `1.2`（可二次推演：改订单/扰动后重算，同输入字节级一致）
- 权限：base_manager:常州 跑同一推演只会命中含常州的订单子集（A6 行级贯穿，已有回归锁）

---

## 场景二 · 规划体检（"这版月度计划过得了体检吗？"）

意图 `plan_audit_q` · 视图 `audit` · 求解器 `plan_audit`（plan.ts:planAudit）。

### 输入（操作员录入的本月计划口径，单位 万套 / 亿 / %）

| 字段 | 值 | 含义 |
|---|---|---|
| dem | 480 | 总需求 |
| seg_pas / seg_ess / seg_com | 220 / 170 / 90 | 动力/储能/商用 三细分（合计 480，自洽） |
| sup | 450 | 总供给 |
| gmTarget | 18% | 毛利目标 |
| cashCushion | 55 亿 | 现金垫 |
| capex | 60 亿 | 资本开支 |
| ltaCov / kitGap | 0.85 / 5 | 长协覆盖率 / 齐套缺口 |

### 处理：逐条体检（硬矛盾 H / 软风险 M / 建议 S）

| 检查 | 规则 | 逻辑 | 本次判定 |
|---|---|---|---|
| X01 细分自洽 | — | `|Σseg − dem| ≤ 容差` | ✅ 通过（220+170+90=480） |
| X02 产销缺口 | — | `dem − sup` vs 软/硬阈值 | ❌ **硬**：缺口 30 万套 > 硬阈值 |
| X03 毛利结构 | C15 | `gmTarget` vs 细分加权结构毛利 `Σ wᵢ×marginᵢ` | ❌ **硬**：18% 超结构毛利上限 |
| X04 物料齐套 | C16 | 齐套缺口 vs 阈值 | ⚠ 软风险 |
| R02 CAPEX 门槛 | C18/C23 | capex/现金垫与门槛 | ⚠ 软风险 |
| 现金垫底线 | C18 | `cashCushion ≥ 底线` | ✅（55 亿过线） |

模块：DataCore A5 规则库（C15/C16/C18）+ A4 细分对象（segMargins 取应用细分毛利）+ 求解器评分。评分=满分扣 H/M 罚分（`c.params.audit` 权重）。

### 体检结果（真实运行）

- **评分 34 / 100 · 结论：不通过**
- **硬矛盾（2）**：`X02 产销缺口`、`X03 毛利结构`
- **软风险（2）**：`X04 物料齐套`、`R02 CAPEX 门槛`
- **修正建议（3）**：`S-X02`（夜班+加急采购供给增量包，补缺口 30）、`S-X03`（毛利目标回归结构毛利）、`S-X04`（齐套补料）
- 每条 H/M 带 `why`（代入数值）+ `fix.patch`（可一键试修 → **二次体检**）；fix 仅演示，真正生效走 S2 Action 审批

---

## 两场景共性（工业级 + 可审计 + 可二次推演）

- **数据规模**：均在 10⁴ 订单 + 配套工业级数据上运行（非 demo 量级）。
- **非硬编码**：场景/agent/skill/规则/数据全经 REST 配置产生（见 provision-enterprise.mjs），可增删改查。
- **引用源/输入源**：每条数据带 `origin`（SYNTHETIC/MANUAL/连接器）；每个推演数字可经 toolCall→snapshotVersion 下钻到来源行。
- **二次推演**：改输入（订单/计划口径/规则参数）后重算；同 (seed/args/snapshot) 确定性一致。
- **权限**：行级策略贯穿求解器取数（base_manager 只见本基地）。
- **持久化**：对 PG 部署运行 `--remote` 后，以上配置与数据落库，部署重启后依旧可见、可继续推演。

---

# 补充（表格版）· 推演链条 / 模块数据量 / 引用与上下游

## A. 推演链条（两场景逐环表）

### A1 · 推演·受影响订单（链条）

| # | 环节 | 模块 | 输入 | 处理 | 输出 | 引用数据量 |
|---|---|---|---|---|---|---|
| 1 | 鉴权 | AgentCore A0 | JWT | 验签取 tid/sub/roles | RequestAuth | — |
| 2 | 功能门禁 | DataCore 功能开通 | solverKey | requireFeatureTag | 放行/404 | — |
| 3 | 行级取数 | DataCore A6+A4 | baseId | queryObjects(Order)+rowAllowed | visibleOrders | **Order 10000** |
| 4 | 上下文 | DataCore A4 | tenant | loadContext(核心类型) | SolverContext | Base12+Model6+Line12+Process60+Equip72+MaintPlan12+Shipment12+Segment3 |
| 5 | 求解 | DataCore S1 求解器 | ctx+窗口 | affectedOrders [day−7,+14] | affected/problems/rootChain | 命中 **45 单** |
| 6 | 快照 | DataCore A4 §1 | — | snapshotVersion | "1.2" | — |
| 7 | 溯源返回 | AgentCore→前端 | data | provenance ⟦ref⟧ | 表+结论 | — |

### A2 · 规划体检（链条）

| # | 环节 | 模块 | 输入 | 处理 | 输出 | 引用数据量 |
|---|---|---|---|---|---|---|
| 1 | 鉴权+门禁 | AgentCore/DataCore | JWT, plan_audit | 验签+entitlement | 放行 | — |
| 2 | 细分毛利 | DataCore A4 细分对象 | tenant | segMargins(取应用细分) | wPas/wEss/wCom×margin | **Segment 3** |
| 3 | 规则联动 | DataCore A5 规则库 | 计划口径 | C15/C16/C18 代入 | H/M/S 条目 | 约束 15 |
| 4 | 评分 | DataCore S1 | H/M 罚分 | params.audit 权重 | 评分/结论 | — |
| 5 | 试修/二次体检 | DataCore A4 | fix.patch | 一键试修→重算（生效走 S2 审批） | 新评分 | — |

## B. 引用的模块 × 每模块数据量（XL 档真实计数）

| 数据域 | 对象类型 | 数据量 | 被哪些场景/求解器引用 |
|---|---|---|---|
| product | **Order 订单** | **10000** | 推演·受影响订单 / 产能推演 / 体检(dem) / 聚合 |
| product | Model 型号 | 6 | 几乎全部场景 |
| product | Segment 细分 | 3 | **规划体检(毛利结构)** / S&OP |
| factory | Base 基地 | 12 | 推演 / 产能上卷 / 瓶颈 |
| factory | Line 产线 | 12 | 产能上卷 / 换型 |
| factory | Equipment 设备 | 72 | 产能上卷 / 良率 |
| factory | Certification 认证 | 18 | 认证排期 |
| factory | EnergyMeter 能耗 | 12 | 碳足迹 |
| factory | ChangeoverMatrix 换型矩阵 | 30 | 换型排序 |
| process | Process 工序 | 60 | 产能上卷 / 良率诊断 |
| equip | MaintPlan 检修计划 | 12 | 检修错峰 |
| capacity | Shipment 发运 | 12 | 物流 / 交付 |
| supply | **MaterialBatch 物料批次** | **2000** | 库存优化 / 齐套 |
| supply | **PurchaseOrder 采购单** | **3000** | 齐套 / 长协补缺 |
| supply | Material 物料 | 8 | 齐套 / 库存 / 碳足迹 |
| supply | CarbonFactor 碳因子 | 14 | 碳足迹 |
| commercial | **ARInvoice 应收发票** | **2400** | 客户信用 |
| commercial | Customer 客户 | 60 | 信用风险 / 毛利 |
| plan | PlanTarget 目标分解 | 17 | 计划域 / AOP |
| plan | AnnualScenario 年度情景 | 3 | 产能投资 |
| plan | ScenarioTrigger 触发条件 | 4 | 情景监测 |
| plan | CapexProject 投资项目 | 3 | 产能投资评审 |
| quality | DataSourceHealth 数据健康 | 1 | 降级/数据健康 |
| 时序层 (A8) | 时序聚合规约 | **6 系列** × 12基地/72设备 × **90 天** | 良率/OEE/能耗 → 求解器输入 |

**对象总量 ≈ 17,759 条**（23 类型 · 10 数据域）+ 90 天时序。

## C. 这两个场景共引用了多少数据

| 场景 | 直接读取的数据（量） | 输出 |
|---|---|---|
| 推演·受影响订单 | Order **10000**（行过滤后）+ Base12+Model6+Line12+Process60+Equip72+MaintPlan12+Shipment12+Segment3 ≈ **10,201 条** | 命中 45 单 + problems/rootChain |
| 规划体检 | Segment 3 + 约束 15 + 计划口径入参（operator 录入，非对象） | 评分 34/100 + 2硬2软3建议 |
| **合计去重** | **≈ 10,204 条对象**被这两个场景读取（其中订单 10000 为主体） | — |

> 说明：推演侧"重"（读全量订单 + 拓扑），体检侧"轻"（读细分 + 规则 + operator 口径入参）。两者都只读、确定性、可二次推演。

## D. 数据上下游（血缘）

| 对象 | 上游（来源/引用源） | 下游（被谁消费） |
|---|---|---|
| Order | A9 合成 / 连接器同步(ERP) / Excel 上传 → RawDataset → 建模发布 → materialize | 受影响订单 / 产能推演 / 体检(dem) / 聚合 / 驾驶舱 |
| Base/Line/Process/Equipment | 本体 materialize（origin=MATERIALIZED/SYNTHETIC） | 产能上卷 → capacity_forecast / bottleneck / affected_orders |
| Segment | A9 合成 | 规划体检(毛利结构) / sop_balance |
| Material/MaterialBatch/PurchaseOrder | 采购连接器 / Excel（预留 API） | kit_readiness / inventory_optimize / lta_gap |
| Customer/ARInvoice | CRM 连接器 | credit_exposure / quote_margin |
| EnergyMeter/CarbonFactor | A8 时序 / 主数据 | carbon_footprint |
| Certification | PLM 连接器 | cert_schedule |
| 时序点(ts_points) | A8 连接器/合成（90 天） | 聚合规约 → 快照属性 → 派生 → 求解器输入（OEE/良率） |
| 派生属性 | 上游对象 × derivation 公式（A4 管线） | 驾驶舱/场景/求解器；变上游 → 自动重算（联动刷新 §28） |
| Action 草稿 | 推演/体检 fix（写降级） | S2 审批 → 写回 objects → 回声对账 → 驾驶舱（闭环） |

> 链条贯通性：上游任一节点变更 → 领域事件 → 下游派生重算/缓存失效（≤SLO）；每个推演数字可经 toolCall→snapshotVersion 反向下钻到来源行。跨 ≥5 域的本体链（product→factory→process→equip→supply→commercial→plan）支撑切片检索与求解器取数。
