# HANDOFF · WO-TITLE-DIVERGENCE · mock 与真后端的三处标题/单位分叉

- 分支：`wo-title-divergence` → 推送 `claude/handoff-wo-title-divergence`
- 提交线：`990c9b21`（占位）→ `888a44c3`（①）→ `b65ee84d`（②）→ `696303cc`（④a 基线清零）→ `67e7847e`（④b 扩门）
- 范围边界遵守：只写了 `apps/frontend-shell/src/mocks/**`、`apps/frontend-shell/test/**`、`apps/datacore/test/**`、`scripts/check-mock-fidelity.mjs` + `scripts/lib/widget-copy.mjs`（扩门所必需，WO 明文「把这一维加进门」）、`scripts/mock-fidelity-baseline.json`（3→0 只降）、`docs/SYSTEM-ONTOLOGY.md`、`docs/`。**未碰** `apps/agentcore/**`、`apps/frontend-shell/src/views/**`、`apps/datacore/src/**`（生产源码一行未动——三处分叉全在 mock 侧）。

---

## ① 三条复核实测（逐条含金丝雀/否定结论证据）

### ① aop-base 单位分叉：mock 错，后端权威，已修（`888a44c3`）

**复核链（不信行号，搜符号串）**：
- 后端计算：`apps/datacore/src/solvers/service.ts` `cockpit_kpi` solver `aopBaseRev: round(num(baseline.props.revenue), 1)`。
- 单位权威：`apps/datacore/src/synthetic/battery.ts` `revenueOf = (demand) => round((demand * avgUnitPrice) / 10000, 1)`，注释逐字「万套×元/套 → 亿」；`packages/contracts/src/base-registry.ts` revenue.unit = 「亿」；决策信息契约 revenue 单位「亿元」。三处同源。
- mock 分叉点：`apps/frontend-shell/src/mocks/fixtures.ts` DASH_LAYOUT 的 `aop-base` 条目原写 `unit: "万"`；同 key 后端 `apps/datacore/src/synthetic/service.ts` 写 `unit: "亿"`。
- **数值自洽性反证**：mock 的 cockpit_kpi 桩（`handlers.ts`）回 `aopBaseRev: 240`——按「亿」自洽（电池厂年营收 240 亿），按「万」荒谬（240 万）。后端权威成立，不是「后端写错单位」。
- **修法**：改 mock 一字（万→亿），后端不动。已提交。

### ② oee-trend 窗口实测答案：**两侧数据都是 14 天，错的只是 mock 标题文案**（`b65ee84d`）

派单警告「若 mock 真只造了 7 天数据，要改的是数据不是标题」——实测结论：**不是那情形**。
- mock query：`fixtures.ts` oee-trend 条目 `query: { kind: "timeseries", seriesKey: "oee_daily", …, days: 14 }`。
- mock 数据桩：`fixtures.ts` `TS_AGG_POINTS = Array.from({ length: 14 }, …)`——**真造 14 个点**，不缺一半。
- 后端 query：`service.ts` oee-trend 条目 `days: 14`，标题「OEE 14 日趋势」与数据自洽。
- **修法**：改 mock 标题「OEE 7日趋势」→「OEE 14 日趋势」，数据不动。改标题在这里**不是**粉饰数据缺口——数据本来不缺。

### ③ aop 视图定性：**已废弃遗留·有意保留的兜底演示，不是真后端漏注册**。处置：保留，一行未改

- **否定结论金丝雀**：`grep -rn '"aop"' apps/datacore/src` RC=1 零命中；同工具跑已知必中的 `key: "oee-trend"` 命中 `service.ts`——工具没瞎，零命中可信。
- **不是漏注册的论据（四条独立证据）**：
  1. mock 侧注释明写意图（`fixtures.ts` feature 表 `view.aop` 行）：「原型中的 story 视图无后端支持 → 保留 aop 直链入口演示『该视图类型暂不支持』兜底（renderer="aop" 未注册）」；
  2. 前端注册表同口径注释（`views/registry.ts`）：「story 等原型视图无后端支持 → 不注册，落『该视图类型暂不支持』兜底卡（aop 旧入口保留演示）」；
  3. **有测试咬它**：`test/f12.permissions.test.tsx` 用例「planner：aop（原型存在但无后端支持，renderer 未注册）→『该视图类型暂不支持』兜底卡」渲染 `/v/aop`。删 mock 条目 ⇒ f12 当场红，且兜底卡失去唯一演练路径；
  4. **真实功能的后继者在两侧都在册**：`view.annual-scenario`「年度规划」——后端 `features.ts`（绑 `plan-aop`）+ `planviews.ts aop()` + `app.ts /a/v1/plan/aop` 端点 + 前端 `AnnualScenarioView.tsx` 全接线。年度规划这件事真后端**有**，只是不叫 `aop`。
- 照派单「两者修法相反」：定性为遗留 ⇒ 不往真后端补注册（给一个废弃入口注册假 renderer 是错方向）；也不删 mock 条目（它是有文档、有测试的兜底演示）。**无需产品裁决**——功能不缺位，条目有主。

## ② mock-fidelity 基线增减对照：**3 → 0（只降不升成立）**

| 基线条目 | 处置 | 证据 |
|---|---|---|
| `LINK line_belongs_to_base.from` | 摘 | 此前已被 WO-SANDBOX-PROP-DIRECTION 修好（handlers.ts 现为 Base→Line），豁免一直没摘；`--update` 收紧 |
| `LINK line_belongs_to_base.to` | 摘 | 同上 |
| `LINK order_for_model.cardinality` | **本单修掉** | mock 两处字面量（`MOCK_LINK_SEED` + registries handler）1:1 → 1:N，对齐后端单源 `battery.ts` `order_for_model 1:N`（一型号对多订单）；连坐的 `mock-linktype-direction.gate.test.ts` `KNOWN_CARDINALITY_DRIFT` 按其设计意图删行（该测试顶注原文：「修好了 ⇒ 顺手把这一行删掉」） |

`--update` 输出原文：`· 基线已收紧：3 → 0 条（新增谎报 0 条**未**收编）`。基线文件现 `exemptions: {}`。

连坐测试实测：`mock-linktype-direction.gate.test.ts` 2/2 绿 · `ontology-relations.seam.test.tsx` 16/16 绿（该测试运行时跨两端点对账种子一致性，两处同改故绿）。

## ③ 扩门：载体③ widget 文案 title/unit 维（`67e7847e`）

**为什么必须扩**：①②两条分叉在 `fixtures.ts` 自称「与后端 DASH_LAYOUT 同步，门A 守不漂」的注释底下活着——门A（`cockpit-widgets:check`）只查 widget **type 存在性**（正则 `type: "kpi"` 在不在文件里），一个字的文案都不比。形态：「我用『type 三处齐』当作『两套 DASH_LAYOUT 不漂』的证据，而前者并不度量后者。」

**新判据**：mock 与后端**同 key** 的 widget 条目（形状：`key`/`title`/`type` 字符串字面量 + `query` 字段在场；视图条目/feature 条目天然排除），`title` 逐字节相等，`unit` 一侧有一侧没有也算分叉。实现单源 `scripts/lib/widget-copy.mjs`（`widgetEntries`/`compareWidget`），门与接缝测试 `apps/frontend-shell/test/mock-widget-copy.seam.test.tsx` **共用同一份**（不另抄）。金丝雀 9→11：C9 真文件两侧抽取必中（含 aop-base/oee-trend）· C10 比对双向（含「万 vs 亿」「7日 vs 14 日」两枚变异原形）。后端扫描面刻意只含 datacore（widget 唯一下发方）。新增故障注入开关 `MOCK_FIDELITY_FORCE_NO_WIDGETCOPY=1`。

**RC 三态实测输出原文**：

- **RC=0（修复态）**：
  ```
  · 金丝雀 11/11 全中（词法 1 · 路由 4 · 对象解析 2 · 条目 2 · widget 2）……
  · 载体③ widget 文案：mock widget 23 条 · 后端同类 key 24 个 · **title/unit 分叉 0 条**
  ✓ mock-fidelity:check 通过：mock 声明的目录、条目与 widget 文案无**新增**谎报（存量 0 条已记基线，只减不增）。
  ```
- **RC=1（变异反证：把 fixtures 改回 unit「万」+ title「OEE 7日趋势」）**：
  ```
  · 载体③ widget 文案：mock widget 23 条 · 后端同类 key 24 个 · **title/unit 分叉 2 条**
      ★新增 WIDGET aop-base.unit  …/fixtures.ts:401  mock="万" vs 后端="亿"（…/service.ts:1587）
      ★新增 WIDGET oee-trend.title  …/fixtures.ts:419  mock="OEE 7日趋势" vs 后端="OEE 14 日趋势"（…/service.ts:1635）
  ✗ mock-fidelity:check 未通过（2 条**新增** mock 谎报 · 棘轮只许降不许升）
  MUTANT_RC=1
  ```
  撤回变异后复跑 RC=0。
- **RC=2（故障注入缺 lib）**：`MOCK_FIDELITY_FORCE_NO_WIDGETCOPY=1` ⇒ `⛔ 读不到词法原语库 … ⇒ 工具坏了，不是代码坏了`，直接实测退出码 = 2。

**接缝测试变异反证**：把 `aop-base` unit 改回「万」⇒ §2 红，报错原文 `aop-base.unit: mock="万" vs 后端="亿": expected [ 'aop-base.unit: mock="万" vs 后端="亿"' ] to deeply equal []`；同轮 §1 金丝雀保持绿（证明红的是真源断言不是判据本身）。撤回后 3/3 绿。§2 含交集下界断言（`shared.length >= 10`）防「交集空 ⇒ 逐字节相等恒真」的哑门。

**四门复验**（扩门后）：`mock-fidelity` RC=0 · `gate-exit-discipline` RC=0 · `system-ontology` RC=0 · `baseline-writer-honesty` RC=0。本体 §7 门条目与 §8 `G-MOCK-OVERCLAIM` 已回写。

## ④ 残余盲区（如实亮出，不在本单修）

**widget 集合差集**：mock 有 `risk-orders`/`demand-supply-gap`/`problem-summary`，后端有 `demand-p50`/`gross-margin`/`material-gap`/`orders-table`，互不在对方册上（疑似改名等价物，如 risk-orders↔orders-table，但未逐对定性）。载体③按门既定诚实边界只比同 key 交集——差集自动配对此前实测不可靠（门顶注记载：按 key 交集自动配对会把 mock 求解器 key 配到后端意图 key 上，产出整条假「多出」）。要做需先人工逐对定性「改名等价物 vs 真多出」，建议另立 WO。已写入本体 §8 该断点条目。

## 复跑入口

```bash
node scripts/check-mock-fidelity.mjs --verbose            # 门（含载体③）
pnpm --filter frontend-shell exec vitest run test/mock-widget-copy.seam.test.tsx
pnpm --filter datacore exec vitest run test/mock-linktype-direction.gate.test.ts
pnpm --filter frontend-shell exec vitest run test/ontology-relations.seam.test.tsx
```
