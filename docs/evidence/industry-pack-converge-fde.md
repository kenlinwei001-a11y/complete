# INDUSTRY-PACK-CONVERGE · FDE 真实测试证据（P1 北极星·答"如何换行业不改~15文件"）

> 日期 2026-07-04 · 分支 `claude/vigilant-knuth-b1nmxn` · WO INDUSTRY-PACK-CONVERGE
> 收敛：5 层散落电池硬编码（派发 SolverDescriptor / 结构 ViewConfig.layout / 阈值 SolverParam / 时间 t0 / 实体 SEG）
> → **单一声明式 `IndustryPack` 契约 + 加载器**。电池散落配置收编进 `batteryPack`（byte-identical R6）；
> `logisticsPack` 换行业零码实证。

## 契约 + 加载器
- 契约 `packages/contracts/src/industrypack.ts`：`IndustryPackSchema`（消费既有 IndustryTemplate/viewlayout/SEG 类型不重定义）。
- 加载器 `apps/datacore/src/synthetic/industry-pack.ts`：`batteryPack`/`logisticsPack`/`PACK_REGISTRY`/`loadIndustryPack`/`packSolverDescriptors`。
- 装配点（loader 驱动解析）：`resolveTemplate`（原 `industry==='battery-manufacturing'` 直返 + BUILTIN 查表两处 → 一处 pack 路由）·
  `seedBatteryParamsAndSpecs`（阈值层经 pack）·`seedViewConfigs`（结构层从 `BATTERY_VIEW_FRAGMENTS` 消费·不再本地内联）。

## 收编·byte-identical（R6）
`batteryPack` 各字段 **identity 引用**既有单源：`template=BATTERY_TEMPLATE` · `params=BATTERY_SOLVER_PARAMS` ·
`entities.segments=SEG_REGISTRY` · `views=BATTERY_VIEW_FRAGMENTS`（从 service.ts 内联迁入 pack）· `clock.t0=forecastStart`。
**现有 datacore 断言不变** → `pnpm --filter datacore test`：**基线 915 passed → 924 passed（+9 teeth）**，15 skipped，exit 0。
（915 全部原样通过=搬家不改值的字节一致证。）

## 真起服务 · 电池（demo）逐值对照（`SEED_DEMO=1`·内存·:4051）
- **结构层**（`GET /a/v1/me/workspace`）：`plan-audit` view `layout.fieldGroups` titles = `["需求侧（万套）","供给侧","财务侧"]`，
  需求侧 seg labels = `["月度需求总量","乘用车","储能","商用车"]`；`order-chain` `categoryLabels` = `{DELIVERY:"交期",MARGIN:"毛利",KIT:"齐套",CREDIT:"信用"}`
  → 即 `batteryPack.views` / `BATTERY_VIEW_FRAGMENTS` 逐值（结构层经 pack 落库到真 UI 契约）。
- **时间层**（`GET /a/v1/synthetic/clock`）：`t0=2026-06-10` = `batteryPack.clock.t0`；`GET /a/v1/sop/versions` month=`2026-06`（currentMonth(t0) 派生）。

## 换行业零码（2nd pack·真起服务·非纸面契约）
`POST /a/v1/synthetic/jobs {industry:"logistics-warehouse",scale:"S",seed:42}`（租户 `logidemo`）→
- `status:SUCCEEDED` · `rowCounts:{Warehouse:6,Store:10}`（`logisticsPack` 装配全栈·**零跨文件代码改动**）。
- `GET /a/v1/objects?type=Warehouse` → 6 条，抽象 role props `{whId:"WH-001",region:"east",openCost:264,serveCost:15.3,capacity:2541}`（零电池业务常数·R14）。
- `GET /a/v1/objects?type=Store` → 10 条。`GET /a/v1/objects?type=Base` → **0**（非电池世界·零电池实体泄露）。

## teeth（防漂移·`apps/datacore/test/industry-pack.test.ts` 9/9 绿）
- T1 收编 identity（pack 各字段 === 源常量·byte-identical）。
- T2 loader 驱动解析：runJob 后 storage `solver_params`（阈值/时间层）与 `plan-audit` view `layout.fieldGroups`（结构层）逐值 == pack 装配值（退回 bypass/内联即红）。
- T3 换行业零码：`logisticsPack` 登记即装配全栈·`packSolverDescriptors` 子集绑共享 `SOLVER_REGISTRY`·runJob 真物化非电池世界。

## 诚实边界
`usesBatteryPipeline`（`instantiateBattery` 半自动建模链 viaModelingChain·bespoke·R6 467-obj 基线风险）仍留特例——
本 WO 收敛**描述子/配置层**（派发/结构/阈值/时间/实体），不重写实例化流水线（AUDIT γ3 明列后续）。
`solverDescriptors` 为**平台共享**（R14 零业务常数）——pack 按 key 绑定共享 `SOLVER_REGISTRY`（不复制进包）。
前置 5 层 dep 均 code-present-但-复验-pending（reviewer stalled）；本 WO build on current branch state 消费其既有 descriptor/registry。
