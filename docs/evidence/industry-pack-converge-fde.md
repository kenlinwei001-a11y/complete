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

---

## 复验 BLOCK 收敛（2026-07-04 · 两条验收条款达成）

### ① C2『换行业 0 码改』字面达成 —— 目录约定 + auto-discover（治本）
- **外置目录约定**：`apps/datacore/src/synthetic/packs/<industryKey>.pack.{ts,json}`（`.ts` identity-引用既有常量保
  byte-identical·`.pack.json` 供纯数据行业·文件名即 industryKey）。已迁 `battery-manufacturing.pack.ts`（引用
  `BATTERY_TEMPLATE`/`BATTERY_SOLVER_PARAMS`/`SEG_REGISTRY`）+ `logistics-warehouse.pack.ts`。
- **auto-discover 加载器**：`industry-pack.ts` 的 `PACK_REGISTRY` 由**运行期扫描目录**构建
  （`readdirSync` + 动态 `import()`/`readFileSync` + top-level-await·**非手工登记数组**）。**新增行业 = 往
  `packs/**` 放一个文件·既有代码零改**（`git diff --name-only` 仅含该 pack 文件）。无 bundler（`tsc` 逐文件产 dist）
  →Node 运行期扫描 dist；build 脚本拷 `.pack.json` 入 dist；vitest 源码态扫 `src/**/packs/*.pack.ts`（同一扫描口径）。
- **门 `industry-pack:check`**（`scripts/check-industry-pack.mjs`·并入 `pnpm gates`）五断言：① registry===目录扫描
  · ② 源码无手工 `PACK_REGISTRY=[…]` 数组且确用 `buildRegistry`/`readdirSync` · ③ 文件名===industryKey ·
  ④ battery/logistics 存在且过 `IndustryPackSchema` · ⑤ **0 码发现活证**：落一个 `.pack.json`→同一扫描立即发现→复位。
- **byte-identical R6**：`pnpm --filter datacore test` = **940 passed / 15 skipped**（既有断言原样不变=搬家不改值）+
  新 teeth（C2 目录派生/探针·C3 非电池视图/场景）。

### ② C3『非电池完整 app 活体』达成 —— pack 驱动非电池视图/场景 + 真浏览器
- **pack 自带非电池 viewLayouts + 决策场景**：`IndustryPack` 增 `scenarios`（契约 `IndustryScenarioSchema`）。
  `logisticsPack` 自带「配送网络看板」（dashboard·KPI 全来自 Warehouse/Store 聚合）+ 2 决策场景卡；
  `seedViewConfigs` 消费 `pack.views`/`pack.scenarios` 物化为该租户视图（非覆盖合入+去重→电池视图集字节不变·
  引擎零 `if(industry===)`）。`me/workspace` 把已下发视图的 `view.<key>` 并入 features（前端 ViewPage 严格门对齐·
  换行业 pack 视图无需在 FEATURE_REGISTRY 逐个登记·0 码改）。
- **真浏览器 logi 租户逐值对后端**（`SEED_OPT_INDUSTRY=1` 真起 datacore:4051 + vite:5200·真登录 logi/admin/demo1234·
  `scripts/fde-industry-pack-logi.mjs` playwright 实拍）：
  - 非电池断言过：无 乘用车/储能/商用车/规划体检/订单全链 泄露。
  - 6 KPI 逐值 == 后端 `/a/v1/objects/aggregate`：门店总数 **10**·配送仓总数 **6**·月度配送需求总量 **1,330 件**
    （=Σ Store.demand）·总日吞吐产能 **12,410 件/日**（=Σ Warehouse.capacity）·平均单仓服务成本 **12.87 元/件**
    （=avg serveCost 12.866667）·平均开仓成本 **209.50 万元**（=avg openCost 209.5）。
  - 配送仓清单（候选设施 WH-001…006）+ 门店清单（需求点 ST-0001…）真渲染。
  - 决策场景卡真答：卡1「全网需覆盖多少月度配送需求量？」→ **1,330 件**（=后端 sum demand·逐值一致）·
    卡2「各候选配送仓的开仓成本/服务成本/日吞吐？」→ 配送仓成本清单。
  - 截图 `docs/evidence/industry-pack-logi-network.png` + `industry-pack-logi-scenarios.png`。
- **诚实边界（最小口径显式声明）**：
  - `facility_location` 选址最优化（真 CP-SAT）由 `logisticsPack.solverKeys` 绑定共享 `SOLVER_REGISTRY` +
    env-gated `opt-real-sidecar.integration.test.ts`/`opt-logistics-industry.test.ts` 证——**真 CP-SAT 需 OR-Tools
    sidecar**（无 sidecar 环境场景卡以 objects-aggregate/objects 直答真数据·浏览器可见）；「求解器派发选址活体浏览器答」
    属 sidecar-on 后续。
  - 物流视图沿用平台通用 `dashboard` renderer（config-driven·零新增每行业渲染器代码）；共享看板 chrome 的 AI 输入框
    placeholder 为通用占位文案（非业务数据·shared component），业务 KPI/数据全为物流真值。
  - 业务导航链接（配送网络看板/决策场景）落 ShellLayout「其它」组（平台对未在 NAV_GROUPS 映射的视图的既有 leftover 归类）。
