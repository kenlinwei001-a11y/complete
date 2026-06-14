# 实施结果 · 跨域切片 + 规则真触发(Phase 1–4)

按「10 场景自检缺口」逐项实施。本轮闭合了让 8 域场景"真能经切片检索并推演 + 约束真触发"的主干缺口,全程 4 套测试 + parity 全绿。

## 一、缺口闭合对照(自检 → 实施后)

| 优先级 | 缺口(自检) | 状态 | 实施 |
|---|---|---|---|
| P0-a | `resolve_slice` 工具接旧 2 键解析器,够不到声明式切片 | ✅ 已闭合 | 旧 `/a/v1/slices/:key/resolve` fall-through 到通用 SliceSpec 引擎(executeSlice);Agent/Workflow 现可检索 order_fulfillment_360 / order_to_cash_720 / enterprise_360 |
| P0-b | 仅 8 条链路边 → 最大连通切片 6 域 | ✅ 已闭合 | 新增 **13 条跨域链路边**,合成确定性派生边实例;落库 2 条 **8 域切片** |
| P0-b | `supply` / `commercial` 域被对象使用却未注册 | ✅ 已闭合 | seedDomains 补注册两域 |
| P1 | ~8 条已发布规则引用对象上不存在的属性 → 哑弹 | ✅ 已闭合 | 给对象补约束承载属性(确定性派生+植入越线);C03/C08/C13 在真实数据上 violations>0 |
| P1 | C26–C33 表达式反转(误写为合规条件) | ✅ 已闭合 | 改为「越线条件」语义 |
| P1 | C01/C06/C09/C15/C21/C22 被代码引用却未发布 | ✅ 已闭合 | provision 补建并发布,均引用已存在属性、真触发 |
| P0-c | finance 域无对象类型 | ⏳ 后续(Phase 5) | 现 8 域切片以 Order 根覆盖 产品/工厂/工艺/设备/供给/商务/产能/质量,不含 finance;AOP 财务入切片待补 Finance 对象 |
| P1 | skill 语义路由 / 跨求解器编排器 | ⏳ 后续(Phase 5) | 见自检报告;属更大改造 |
| P2 | 语义压缩层 / MCP router / Path A MCP / ts 入切片 / asOf | ⏳ 后续 | — |

## 二、新增本体(本轮)

**13 条跨域链路边**(均对象 FK 确定性派生,同 seed 字节级一致):
`model_has_cert · customer_has_invoice · material_has_batch · material_supplied_by_po · material_carbon · base_energy_meter · base_has_shipment · base_maint_plan · model_changeover · model_in_segment · base_data_health · scenario_to_target · scenario_to_capex`

**2 条 8 域内置切片**(合成即落库):
- `order_to_cash_720` — Order 根,跨 产品·工厂·工艺·设备·供给·商务·产能·质量 8 域(订单到回款 + 数据可信度)
- `enterprise_360` — Order 根,8 域 + 18 类节点最大广度(加 认证/能耗/换型/细分/检修/碳因子)

**约束承载属性**(让规则真触发):
Order.demandDelta/outsourceRatio/creditUsedRatio/leadDays · Model.carbonFootprint · Material.devPct/outsourceYield · Shipment.coverageDays

## 三、验证

| 套件 | 结果 |
|---|---|
| datacore | **244** 全绿(新增 SL5–SL9 八域切片 + SY-rules-live) |
| agentcore | 173 全绿 |
| frontend | 106 全绿 |
| parity | 129/129 |

回归锁:
- `slice-order-fulfillment.test.ts` SL5(8 域可达)/SL6(最大广度 18 类节点)/SL7(契约)/SL8(域注册+边遍历)/SL9(旧端点 fall-through)
- `synthetic.test.ts` SY-rules-live(C03/C08/C13 在真实数据 violations>0)

## 四、证据 Excel

`deliverables/enterprise_360-8域推演节点.xls`(5 表):
- 概览 / 场景①推演·节点明细 / 场景①链路血缘 / 场景②体检·节点明细 / 场景②链路血缘
- 两场景均**先经 8 域切片检索**(场景① 142 节点、场景② 280 节点),节点按域分组,逐节点列出 域/类型/主键/履约角色/关键属性/来源绑定。

复现:
```bash
pnpm --filter datacore build
node scripts/slice-scenarios-excel.mjs L enterprise_360   # 8 域证据
node scripts/slice-scenarios-excel.mjs L order_to_cash_720
```

## 五、Phase 5(已完成 5A/5B/5C)

| 子项 | 状态 | 实施 |
|---|---|---|
| 5A Finance 域 | ✅ | 新增 `FinanceAccount`(基地现金账户)/`FinanceMetric`(情景财务指标) + `base_finance`/`scenario_to_finance` 边 → `order_to_cash_720` 升至 **9 域**(产品/工厂/工艺/设备/供给/商务/产能/质量/**财务**)。闭合 P0-c。 |
| 5B 稀疏域数据 | ✅ | `DataSourceHealth` 1→**9 源系统**(MES/ERP/SRM/PLM/WMS/QMS/EMS/LIMS/IoT-SCADA)+ XL 档每基地 IoT 采集器。关键源 ≤2h 不扰动 P90 降级,>2h 仅落非关键源 → C09 仍可触发。 |
| 5C skill 语义路由 | ✅ | 新增 `skill-router.ts`:按 query 词法相关性(CJK 二元组+ASCII,确定性)排序,仅注入 top-k 全文 summary,其余降级 `load_skill` 按需取。闭合自检「agent 工程化最弱项」。 |

验证(Phase5 后):datacore **244** / agentcore **178** / frontend 106 / parity **129/129** 全绿。
回归锁:SL5 升级为 9 域断言;`skill-router.test.ts` SR1–SR5。

证据 Excel:`order_to_cash_720-跨域推演节点.xls`(9 域)、`enterprise_360-跨域推演节点.xls`(8 域最大广度)。

## 六、Phase 6(已完成 6A–6E)

| 子项 | 状态 | 实施 |
|---|---|---|
| 6A 语义压缩回写管线 | ✅ | `orchestrator.recordExperience`:path B 任务完成后蒸馏为 `exp_auto_` 经验案例落经验记忆库(approach = 工具/求解器调用轨迹蒸馏 = 折叠/丢弃上下文的结构化留存;`pseudoEmbed`;upsert 幂等),供 `search_experience` 检索。 |
| 6B 跨求解器编排器 | ✅ | `countermeasure_combo` meta-solver:多杠杆按 成本档→单位成本 贪心最小成本闭合缺口,每段标注来源求解器(solver/scene),返回组合/残差/总成本/可行性。求解器 21→22。 |
| 6C MCP router | ✅ | `mcp-router.ts` 词法相关性(复用 skill-router)对 MCP 工具 top-k 收窄(其余经 discover 发现),wire 进 `runRegisteredAgent`。 |
| 6D Path A 工作流 MCP 绑定 | ✅(实查已存在) | `invoke_mcp_tool` 已是 contract + workflow executor 一等步骤;补回归锁 WM1/WM2。 |
| 6E AnnualScenario 根切片 | ✅ | `aop_scenario_chain` 以 AnnualScenario 为根经 scenario_to_target/capex/finance 可达 plan+finance(修复「plan 子图仅 scenario 根可达、Order 根够不到」)。 |

验证(Phase6 后):datacore **246** / agentcore **185** / frontend 106 / parity **129/129** 全绿。
回归锁:SL10(AOP 切片)、countermeasure_combo 编排断言、catalog 22、EW1/EW2(经验回写)、MR1-MR3(MCP router)、WM1/WM2(Path A MCP)。

### 全部 Phase 5/6 缺口闭合
自检的 P0/P1/P2 缺口至此基本闭合。

## 七、Phase 7(增量优化，已完成 7A–7C)

| 子项 | 状态 | 实施 |
|---|---|---|
| 7A plan↔product 连边 | ✅ | 新增 `order_to_plantarget`(订单→交期月对应月度计划目标) → Order 根直达 plan 域。`order_to_cash_720` 升至 **10 域**(+plan)。 |
| 7B 路由升级为 embedding | ✅ | skill/MCP 路由改为 **embedding 向量余弦**排序(主) + 词法重叠(次，平手裁决);`Embedder` 可插拔——生产可注入真 embedding provider，CI 用确定性 `pseudoEmbed`(256 维 hash bag-of-ngrams)。SR6 证明可插拔覆盖词法。 |
| 7C 消息级滚动摘要 | ✅ | agent loop 折叠最旧轮时把其工具蒸馏(`第N轮[tool:firstLine]`)累积为「前情摘要」，每轮注入 `system`(`effectiveSystem()`);`summarizer` 可插拔(生产注入 LLM 摘要器，CI 确定性兜底);compaction 时复位避免重复。 |

验证(Phase7 后):datacore **246** / agentcore **187** / frontend 106 / parity **129/129** 全绿。
回归锁:SL5(10 域)、SR6(embedder 可插拔)、runtime-context Phase7C(折叠→前情摘要注入)。

至此自检列出的"增量优化"三项亦全部落地。后续可继续的方向:把可插拔 `Embedder`/`summarizer` 在生产侧接真 LLM provider(接口已就位);更多 plan↔product / finance↔product 连边丰富跨域切片。
