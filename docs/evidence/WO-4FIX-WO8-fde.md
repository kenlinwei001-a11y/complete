# FDE 证据：WO-4-FIX（P0 域迁移回归）+ WO-8（场景启动器 entitlement）

> 真跑环境：内存模式双服务（datacore :4001 + agentcore :4002，DATACORE_BASE_URL 串接），
> SEED_DEMO=1。所有判据经真 HTTP 端点 curl，非仅 vitest。

## P0 回归（WO-4 80e351a 余孽）：demo 真启动崩 → 已修

### 根因（与审核方独立判断一致）
WO-4 把 `modeling.publishDraft` 归域门从「存在性」收紧为「∈ `BUSINESS_DOMAIN_KEYS`(14)」。
但 14 枚举含 `sales`/`material`（且 `primaryTypes:[]` 空占位 = 半截迁移），合成电池种子
的扩展类型仍用迁移前域名 `commercial`(Customer/ARInvoice) / `supply`(Material/MaterialBatch/
PurchaseOrder/CarbonFactor)。门一收紧，`SEED_DEMO=1` 走 `viaModelingChain:true` 的 publishDraft
即被自己的种子类型拒 → datacore 启动 Exit 1、demo 整站起不来。

### 为何单测全绿漏过（绿测试≠能用典型）
- `seedBattery`/helpers 走 A 路（chainMode=false，直 upsert 绕开发布门）；
- 归域 garbage 单测用合法域 `product`，从不跑真合成种子链；
- `pnpm gates` 不真起 SEED_DEMO 数据面。

### 修向（完成审核方 todo §0 ①②）
① 种子域 ↔ 14 枚举对齐（根因解，非补枚举的省事解）：
   - `supply` → `material`（Material/MaterialBatch/PurchaseOrder/CarbonFactor）
   - `commercial` → `sales`（Customer/ARInvoice）
   - 同步 `seedDomains`、`BUSINESS_DOMAINS.primaryTypes` 填充（material/sales 不再空占位）、
     依赖单测（slice-order-fulfillment）、excel 脚本 domOrder。
② 真启动冒烟门（防同类漂移复发）：
   - `ontology-governance.test.ts` 新增「SEED_DEMO 真路径冒烟」——直呼
     `synthetic.runJob({viaModelingChain:true})` 复刻真启动，断言 SUCCEEDED + ≥34 类型物化 +
     无类型落非法域。归域/字段全建模门任何漂移都会在此 throw（不再靠真起服务才暴露）。
   - 另加一条 batteryObjectTypes+extendedObjectTypes 域合法性静态断言（快速定位 offender）。

### 真启动验证（修复后）
```
$ SEED_DEMO=1 ... node apps/datacore/dist/server.js
... "SEED_DEMO=1: seeded demo S&OP version 2026-07"
... "Server listening at http://127.0.0.1:4001"   ← 不再 Exit 1
$ curl /a/v1/data-health → overall: OK，9 源系统 + 合成连接器齐全
$ curl /a/v1/ontology/graph → 34 object types 全物化
```

## WO-8：view.scenarios 注册到 DataCore 权威 entitlement 源

### 根因
AgentCore `/b/v1/scenarios` 的 `launcherEnabled = viewAllowed(enabledSet, "scenarios")`，
`enabledSet` 取自 DataCore `/a/v1/tenants/{t}/features`（权威源）。DataCore `FEATURE_REGISTRY`
此前缺 `view.scenarios` → 解析集永不含该键 → `featureEnabled` 对「已注册(agentcore侧)但不在集」
返 false → `launcherEnabled` 结构性恒 false，SL2「关 view.scenarios 隐藏启动器」门永不可触发。
修：DataCore 注册 `{ key:"view.scenarios", level:"VIEW", defaultOn:true }`（两系统注册表同源）。

### FDE 真跑矩阵（真 JWT 跨服务路径）
> 注：dev `X-Debug-User` 不向 DataCore 透传 Bearer → FeatureGate fail-open 到 ALL（launcher 恒真，
> 无法证伪）。故用真 JWT（demo/admin/demo1234 login → accessToken）走真跨服务取数。

| 状态 | DataCore features 含 view.scenarios | AgentCore launcherEnabled |
|---|---|---|
| 默认（defaultOn） | ✅ true | ✅ **true**（20 卡） |
| L3 override 关闭 | ❌ false | ✅ **false** |
| 重新开启（恢复默认） | ✅ true | ✅ **true** |

```
# 默认
GET /a/v1/tenants/demo/features → view.scenarios: true (66 features)
GET /b/v1/scenarios (Bearer) → launcherEnabled: true | total: 20
# 关闭
PUT /a/v1/tenants/demo/features {"overrides":{"view.scenarios":false}} → features 不含 view.scenarios
GET /b/v1/scenarios (Bearer, fresh gate cache) → launcherEnabled: false
# 恢复
PUT ... {"overrides":{"view.scenarios":true}} → GET /b/v1/scenarios → launcherEnabled: true
```

### 距北极星 / 诚实标注
- ⚠️ AgentCore FeatureGate 内部缓存 TTL 60s，`/b/v1/internal/invalidate` 清的是资源缓存
  （llm-providers/features 资源），**不清 gate 的 enabledSet 缓存** → 切换 entitlement 实际生效
  最迟 60s（或重启）。本验证用重启 agentcore 取干净读。SLO「传播≤60s」对 launcher 切换成立
  （TTL 兜底），但「事件即时失效」对 gate 缓存不成立——属既有失效链缺口，非 WO-8 缺陷，记此备查。
- ⚠️ dev X-Debug-User 跨服务 fail-open 到 ALL：launcher 在 dev 调试头下恒真，仅真 JWT 链可证伪。

## WO-7：来源系统总览逐源真对象数归因（非0非假）

### 根因
来源系统总览前端 join `graph.nodes[].sourceBindings[].connId` ↔ `data-health.sources[].connId`。
但 demo 全部对象经"单一合成连接器"物化（provenance 诚实——确实只有一个合成数据源），34 类型
的 sourceBindings.connId 全 = 合成连接器 id，与 9 业务源系统的 sourceId(mes/erp/...) 恒不匹配
→ 逐源对象数恒 0（实测修前 0/9）。

### 修向（根因解·不伪造分布）
按"对象类型→真实来源系统主"权威归因（制造业 IT 架构事实：SCADA 实时遥测 / MES 生产执行 /
ERP 销售财务计划 / SRM 供应商 / PLM 型号认证 / WMS 仓储物料 / QMS 质量 / EMS 能耗）建
`graphmeta.TYPE_SOURCE_SYSTEM`；服务端 `buildDataHealth` 据此计算逐源**真实物化实例数**下发
`sources[].members/objectCount`（契约 additive）；前端改读服务端归因（弃失效的 graph 连接）。
此归因是真实业务建模而非伪造数字；**对象 provenance 管道仍诚实=单一合成连接器**（两概念分离）。

### FDE 真跑（真 HTTP GET /a/v1/data-health，修后）
```
ems         26 对象 / 2 类型  [CarbonFactor:14, EnergyMeter:12]
erp        111 对象 / 13 类型 [ARInvoice:24, AnnualScenario:3, CapexProject:3, Customer:8,
                              DemandSegment:3, FinanceAccount:12, FinanceMetric:3, FinancePlan:3,
                              Order:24, PlanTarget:17, ScenarioTrigger:4, Segment:3, SopVersionRow:4]
iot-scada   72 对象 / 1 类型  [Equipment:72]
lims         0 对象 / 0 类型  [监控中·无物化对象]   ← 诚实空，不伪造
mes         96 对象 / 4 类型  [Base:12, Line:12, MaintPlan:12, Process:60]
plm         54 对象 / 3 类型  [Certification:18, ChangeoverMatrix:30, Model:6]
qms          9 对象 / 1 类型  [DataSourceHealth:9]
srm         42 对象 / 2 类型  [PurchaseOrder:30, Shipment:12]
wms         35 对象 / 3 类型  [Material:8, MaterialBalance:3, MaterialBatch:24]
非0 业务源: 8/9（修前 0/9）
```
集成门：`test/wo7-source-attribution.test.ts`（真 endpoint·3 用例）——8 源非0+归因键一致、
LIMS 诚实空、objectCount=成员实例和（无虚增）。

### 距北极星 / 诚实标注（FDE 红线）
- 📏 FDE 字面要求"9 源各非0"。当前诚实只达 **8/9**：**LIMS(实验室) demo 无任何物化对象类型**，
  强行塞对象=伪造分布（违反 WO-7 红线"禁止伪造"）。
- 🔭 **达 9/9 的根因解（待操作方拍板·避免擅自扩 demo 数据模型）**：给 demo 走正门确定性合成
  新增一个真实属于 LIMS 的对象类型（如 电芯实验室检测 `LabTest`：批次/测试项/结果/采样时延），
  并入 `TYPE_SOURCE_SYSTEM[LabTest]="lims"`（归因表已就位，加一行即生效）。届时 9/9 真实非0。
  > 我未擅自新增该类型——它会把 34→35 类型、动多处"34"断言与基线，属扩 demo 数据模型的产品
  > 决策，应由操作方批准。归因基础设施已建好，批准后补 LabTest 即闭合 9/9。
- ⚠️ `AskUserQuestion` 在本会话两次因容器重启/权限流中断不可用，故未能交互确认 LIMS 方向；
  按 FDE 红线"诚实优先"先交付 8/9 真实归因（共用基础设施，9/9 不返工），并在此显式上呈根因解待批。
