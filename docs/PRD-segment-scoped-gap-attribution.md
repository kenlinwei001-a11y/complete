# PRD · 细分作用域化的缺口反向归因（Segment-Scoped Gap Attribution）

> 编号：WO-SEG-ATTR-SCOPE · 类型：正确性缺陷修复（Bug PRD） · 域：求解/推演域（DataCore E · GAP-ATTR）
> 状态：待评审 · 作者：审核方（root-cause 复验 + 亲手真跑） · 日期：2026-07-27
> 前置阅读：`docs/SYSTEM-ONTOLOGY.md`（已读 §2 对象类型 / §3 关系图谱 / §5 不变量 / §8 断点登记）

---

## 0. 执行摘要（TL;DR）

- **现象**：驾驶舱「规划决策推演 · 未达成指标根因下钻」中，点开**储能达成率**（`seg_attain_ess`）的根因树，叶层出现**乘用车/商用车整车厂客户**（长安汽车、东风汽车、广汽集团、吉利汽车、宇通客车）——储能细分的达成率缺口，不该由整车厂订单来解释。
- **定性**：**(B) 归因链路缺少业务细分过滤**。**不是数据/种子问题**（`Order.businessType` 字段存在且正确落值），**不是错标**（`seg_attain_ess`「储能达成率」确为储能细分指标）。`gap_attribution` 求解器的**结构反向分摊回落路径**把**全部 OPEN 订单**不分细分地铺进基地×订单叶。
- **根因位置**：`apps/datacore/src/solvers/service.ts:1340` —
  `const affected = orders.filter((o) => str(o.status) === "OPEN");` 只按状态过滤，**无 `businessType`/细分过滤**。
- **亲手真跑复现**（memory 模式·seed 42·port 14031·`demo:admin`）：`gap_attribution({metricKey:"seg_attain_ess"})`（gap=27.8）返回**全部 24 张订单叶**，其中 **15 张为整车厂/商用车叶**（东风×3、长安×3、广汽×4、吉利×2、宇通×3），仅 **9 张为真储能客户**（国家电网、南方电网、国家电投）。归因节点**未携带** `businessType`/`segment` 标签（前端也无从二次过滤）。
- **修法**：在结构回落路径入口按目标细分过滤订单（细分从 `Metric.businessType` 取，缺省回落 key 后缀 `seg_attain_(ess|pas|com)`）。非细分指标（`gm_rate`/`material_cov`）目标细分为空 → 不缩窄 → **字节兼容不变**。
- **头号验收判据（SEAM-GATE）**：一条接缝驱动组合测试断言 `gap_attribution({metricKey:"seg_attain_ess"})` 的订单叶**只含储能客户**（无长安/东风），且非细分指标 `gm_rate` 行为不变；叠加**四包全绿**。
- **本体回写**：新增 §8 断点 **`G-SEG-ATTR-CROSS-SEGMENT`**（gap_attribution 细分作用域缺失·当前未登记）并标闭；§3 line 406「seg_attain 无专属域仍复用供应链」补注"复用须按细分裁订单"。

---

## 1. 背景与问题

### 1.1 用户可见现象

页面「规划决策推演 · 未达成指标根因下钻」（前端块 `plan-drill`，`apps/frontend-shell/src/mocks/fixtures.ts:271` 定义标题）。用户点未达成的**储能达成率**，根因树 DAG 的叶层混入乘用车整车厂（长安汽车、东风汽车）。业务上，需求/客户按业态分**乘用车 / 商用车 / 储能**三细分，储能达成率的根因下钻应只归因储能客户/订单。

### 1.2 链路（沿本体 §3 走·断点在接缝）

| 环 | 位置 | 说明 |
|---|---|---|
| 前端视图 | `apps/frontend-shell/src/views/DashboardView.tsx:454` `PlanDrillWidget()` | 点未达成 KPI → `openKpi = k.kpiId`（:506） |
| 前端调用 | `DashboardView.tsx:468` | `invokeSolver("gap_attribution", { metricKey: openKpi })` → 投影 `gapAttributionToDag` 渲染 `ProvenanceDag` |
| API | `apps/frontend-shell/src/api/endpoints.ts:184-185` | `POST /a/v1/solvers/gap_attribution/invoke`，body `{args:{metricKey}}` |
| 求解器 | `apps/datacore/src/solvers/service.ts:1247` `gapAttribution()` | 定位 Metric → 路由 → 结构反向分摊 + 因果遍历 |
| **断点** | **`service.ts:1340`** | **`affected = orders.filter(status==="OPEN")`——无细分过滤** |

### 1.3 路由：为何储能达成率落到"全订单"回落路径

`gapAttribution()` 的分派顺序（`service.ts`）：

1. `scope.factorId` 下钻（:1310）→ 否。
2. `market_share` 专用域（:1317）→ 否。
3. **metric-aware 泛化域**（:1326-1332）：查是否存在 `CausalFactor.metricKey === m.key && !isRoot` 的入口因子。`seg_attain_ess` 的 `m.key` = `"seg_attain_ess"`；而供应链因果域的 `CausalFactor.metricKey` 为空串（共享域，`battery-extended.ts:205`「seg_attain 复用此域；metricKey 为空表示共享域」），CEO 数据集里最接近的也只是 `"seg_attain"`（`ceo-dataset.ts:217`）——**均不等于 `"seg_attain_ess"`** → `domainEntry` 为 `undefined`。
4. **回落结构反向分摊**（:1334 起）：`orders → affected(OPEN) → 按基地分组 → 基地×订单叶`。

本体 §3 line 406 已明载："**seg_attain 无专属域仍复用供应链，兼容 v1**"——即**设计上**储能达成率就走这条通用结构分摊路径。问题是这条路径**未按指标所属细分裁订单**。

### 1.4 根因代码（file:line 证据）

```text
service.ts:1335   const orders = (...listByType("Order")).map(o => o.props);
service.ts:1340   const affected = orders.filter((o) => str(o.status) === "OPEN");   // ← 只按状态，无细分
service.ts:1341-1347  按 o.bases[0] 分组到 byBase
service.ts:1359-1367  Level1 基地节点（父 = 总 gap G）——由 affected 派生
service.ts:1387-1389  Level2 订单叶： factor = `订单 ${o.so}（${o.cust}）`   // ← 客户名在此铺出
service.ts:1402-1405  叶节点仅 {id,factor,contribution,unit,share,path,causalPath,provenance}——未拷 businessType
```

`affected` 同时喂给 **L1（基地分组）**与 **L2（订单叶）**，故一处漏过滤 → 两层都跨细分。

### 1.5 定性：(B)，排除 (A)/(C)

- **排除 (A) 数据/种子**：`Order` 对象类型**有** `businessType` 枚举字段（`passenger|commercial|storage`，属性定义 `battery.ts:778`），实例在 `battery.ts:2875`（`businessTypeOfCustomer(o.cust)`）→ `:2890`（`businessType` 落到订单 props）**正确落值**。亲跑分布：`passenger:12 / commercial:3 / storage:9`。长安/东风被正确标 `passenger`，且其订单均为 NCM（动力）型号（`HTML_ORDERS` `battery.ts:143/145/148/156/160/164`）——**没有把储能需求错配给整车厂**。
- **排除 (C) 错标**：`seg_attain_ess`「储能达成率」`actual 72.2 < floor 95`（越线），确系储能细分指标（`battery.ts:3369-3376`，名取自 `DemandSegment.segment`「储能」）。下钻只是**忽略**了它的细分。
- **判定 (B) 逻辑缺陷**：细分字段**存在但未用于下钻过滤**——是缺过滤，非缺字段、非缺数据。

### 1.6 复现（亲手真跑·非只看绿测试）

```bash
# 构建 + memory 模式起 datacore（spare port·seed 42）
pnpm --filter @platform/contracts build && pnpm --filter datacore build
PORT=14031 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 \
  CREDENTIAL_KEY=<64hex> node apps/datacore/dist/server.js
# 越线细分指标一览
curl -s -H 'X-Debug-User: demo:admin:admin' 'http://127.0.0.1:14031/a/v1/objects?type=Metric'
#   kpi-seg-ess | seg_attain_ess | 储能达成率 | actual 72.2 floor 95   ← 越线
# 下钻
curl -s -H 'X-Debug-User: demo:admin:admin' -H 'Content-Type: application/json' \
  -X POST 'http://127.0.0.1:14031/a/v1/solvers/gap_attribution/invoke' \
  -d '{"args":{"metricKey":"seg_attain_ess"}}'
```

**观测**：`rootMetric=储能达成率 / totalGap=27.8`；`levels=[(1,基地,9),(2,订单/瓶颈,34),(3,因果链,7)]`；订单叶 24 张，其中 **15 张整车厂/商用车**（东风汽车×3、长安汽车×3、广汽集团×4、吉利汽车×2、宇通客车×3），仅 9 张储能（国家电网/南方电网/国家电投）；叶节点 `businessType=None`。**与用户报告一字吻合。**

---

## 2. 目标与非目标

### 2.1 目标

- G1：细分达成率指标（`seg_attain_ess/pas/com`）的 `gap_attribution` 结构反向分摊，**订单/基地叶只归因本细分**（储能达成率 → 仅 storage 客户/订单）。
- G2：叶节点携带 `businessType`，前端可显示/二次过滤（R13 出处透明）。
- G3：**非细分指标字节兼容**（`gm_rate`/`material_cov` 等无目标细分者行为不变）。
- G4：勾稽（Σ子+residual=父gap）、R6 确定性、因果遍历（cf-cathode-shortage→决策/地缘终点）**保持**。
- G5：以**接缝驱动测试**锁死"细分纯度"这一此前无人断言的不变量。

### 2.2 非目标

- 不改因果遍历算法、不新增 `caused_by` 边、不改归因系数（`gap_attribution_coeffs`）。
- 不改 `market_share` / metric-aware 专属域（cash/revenue/demand_attain/gross_profit）路径。
- 不为 `seg_attain` 新建专属因果域（保持复用供应链结构分摊，仅加细分裁剪）。
- 不动 `Order`/`Customer`/`HTML_ORDERS` 的量/价/交期口径（R6 锚不动）。
- 不解决 `G-ORDER-FLAT`（订单头级扁平·一单多型号行级）——正交问题，另 WO。

---

## 3. 《本体引用与影响》（铁律 0 · 必填）

### 3.1 对象类型（§2）

| 对象类型 | 域 | 关键字段 | file:line | 本 PRD 关系 |
|---|---|---|---|---|
| `Order` | 数据/产品域 | `so / cust / model / qty / unitPrice / bases / status / **businessType**(passenger\|commercial\|storage) / early` | 属性定义 `battery.ts:778`；实例落值 `battery.ts:2875,2890` | **过滤依据**（已有字段，未被下钻使用） |
| `DemandSegment` | 需求域 | `segId / **segment**(乘用车/储能/商用车) / **businessType** / p50 / act / priceWan / marginPct / floorPct` | `battery.ts:868,876` | 细分口径单一来源（`SEG_REGISTRY`，本体 §2 line 55） |
| `Metric` | 驾驶舱绿地对象（本体 §2 line 94） | `metricId / key(`seg_attain_{ess\|pas\|com}`) / name / category("segment") / target / actual / floorVal / ownerRef` | `battery.ts:3369-3376` | 下钻目标；**当前无 `businessType` 字段**（本 PRD 建议补） |
| `CausalFactor` + `caused_by` 边 | 求解/推演域（GAP-ATTR·§2 line 94 / §8 line 809 已闭） | `factorId / label / drillType / drillId / metricKey / isRoot` | `gap-attribution.ts:148`；`battery-extended.ts:205,277` | 路由判据（`metricKey===m.key` 决定是否走专属域） |
| `GapAttributionOutput` | 契约（R1 contracts-only-shared） | `rootMetric / levels[] / atomicLeaves[] / causalEdges[] / reconChecks[] / reconciled / residualPct` | `packages/contracts/src/gap-attribution.ts:71-91` | 产物形状**不变**（仅叶集合缩小） |

辅助纯函数（同 `battery.ts` 模块内，供种子派生）：`businessTypeOfCustomer`（`battery.ts:111`，客户名→业态）、`businessTypeOfSegment`（`battery.ts:119`，细分名→业态，返回 `storage/commercial/passenger`）。

### 3.2 链路（§3）

`Metric(未达成) --gap_attribution(按 metricKey 路由)--> [有专属域? metric-aware : 结构反向分摊] --> 基地×订单×瓶颈叶 --caused_by--> 地缘/决策终点`（本体 §3 line 406-407）。本 PRD 只改**结构反向分摊分支**的订单选取（:1334-1352 段），不改路由前段与因果后段。

### 3.3 事件（§4）

- `gap.attributed`（L17，本体 §4 line 681）：`{metricKey, leafCount, residualPct, reconciled, ...}` → 失效"缺口归因页/决策看板"。本 PRD 只使 `leafCount` **数值变小**（细分裁剪后叶更少），**事件名/payload schema 不变** → 不触发 D-29/R10 新增订阅，下游无需改。`service.ts:1293/1438/1470` 三处 emit 保持。

### 3.4 不变量（§5 · R1–R18）

| 不变量 | 是否触及 | 说明 |
|---|---|---|
| **R2 tenant_id everywhere** | 保持 | `orders` 经 `listByType(ctx.tenantId, "Order")` 取，过滤在租户内进行，无跨租户。 |
| **R6 确定性** | 保持 | 过滤谓词纯函数（读 `o.businessType`/`m.businessType`/key 正则），无时钟/随机；同 seed 同输出，两跑字节一致（现有 C7 `gap-attribution.test.ts:92-98` 继续守）。 |
| **R13 结论可溯源** | 增强 | 叶携带 `businessType`（G2），下钻出处更完整；过滤依据是**已建模真字段**非隐式约定。 |
| **R14 应用层无业务常数** | 无违反 | 过滤逻辑在**求解器层**（DataCore，非前端）；细分优先取 `Metric.businessType`**数据字段**，key 后缀回落映射（`ess→storage`）读的是指标**自身身份**（`seg_attain_{k}` 是既定 key 契约），非租户业务常数。前端不内联任何细分文案。 |
| **R-一致 一个事实一个出处** | 保持/增强 | 细分口径统一走 `SEG_REGISTRY`/`businessTypeOfSegment`（本体 §2 line 55）；建议把 `Metric.businessType` 由 `businessTypeOfSegment(d.segment)` 派生 = 与 `Order.businessType` 同源同口径。 |
| R1 contracts-only-shared | 保持 | `GapAttributionOutput` 契约不变；不新增跨包类型。 |

### 3.5 断点（§8 · G-*）

- 触及并**新增登记**：**`G-SEG-ATTR-CROSS-SEGMENT`**（本 PRD 提出，见 §7）——"gap_attribution 结构分摊跨细分铺订单"。经排查**当前 §8 未登记**此断点。
- 相关但**相异**（不要混）：
  - `G-ORDER-FLAT`（§8 line 824）：订单头级扁平、一单一型号——**行级**粒度问题，与细分作用域正交。
  - `G-GAP-SCOPE`（§8 line 833，**已闭**）：base×factor 作用域——是"某基地/某因子"的空间作用域，本 PRD 是"某**细分**"的业态作用域，机制不同。
  - `WO-W5 global-sim-business-type-seam`（本体 §3 line 541）：是 `global_sim`/portfolio 的**产能占用**按勾选细分重解，与 `gap_attribution` 归因无关。

---

## 4. 详细设计

### 4.1 主修（求解器）· `service.ts:1340`

在结构回落路径入口，先解出**目标业态**，再对订单做 OPEN ∩ 细分过滤。

**改前（`service.ts:1340`）**
```ts
const affected = orders.filter((o) => str(o.status) === "OPEN");
```

**改后**
```ts
// ── 业务细分作用域（WO-SEG-ATTR-SCOPE·闭 §8 G-SEG-ATTR-CROSS-SEGMENT）──
// seg_attain_{ess|pas|com} 是「细分达成率」，其根因下钻必须只归因**本细分**订单
// （储能达成率→仅 storage 客户/订单）。目标业态优先取 Metric.businessType（种子经
// businessTypeOfSegment 派生的一等字段·R13 可溯），缺省回落 key 后缀解析（向后兼容）。
const SEG_SUFFIX_BT: Record<string, "passenger" | "commercial" | "storage"> =
  { ess: "storage", pas: "passenger", com: "commercial" };
const segSuffix = /^seg_attain_(ess|pas|com)$/.exec(str(m.key))?.[1];
const targetBusinessType = m.businessType
  ? str(m.businessType)
  : (segSuffix ? SEG_SUFFIX_BT[segSuffix] : undefined);
// 受影响订单 = OPEN ∩ 目标细分；无目标细分（非细分指标）时不缩窄 → 字节兼容不变。
const affected = orders.filter(
  (o) => str(o.status) === "OPEN" && (!targetBusinessType || str(o.businessType) === targetBusinessType),
);
```

因 `affected` 同源喂 **L1（:1359-1367）**与 **L2（:1387-1389）**，此一处过滤即让两层同时细分作用域化；勾稽（:1368-1371 / :1408-1413）自然自洽（父/子和都由过滤后集合重算）。因果遍历段（:1474 起，从 `cf-cathode-shortage` 沿 `caused_by`）**不依赖订单集**，保持不变。

### 4.2 加固 (a)：种子给 `Metric` 补 `businessType`（推荐）· `battery.ts:3373`

让"细分"成为 `Metric` 的**一等建模字段**，而非靠 key 后缀解析：

**改后（`battery.ts:3372-3376` push 对象内增一行）**
```ts
metrics.push({
  metricId: `kpi-seg-${k}`, key: `seg_attain_${k}`, name: `${d.segment}达成率`,
  level: "op", category: "segment",
  businessType: businessTypeOfSegment(d.segment as string), // ← 新增：储能→storage（与 Order.businessType 同源同口径·R-一致）
  target: 100, actual: round((d.act as number) / (d.tgt as number) * 100, 1),
  floorVal: 95, unit: "%", weight: 0.1,
  ksfRef: "ksf-dem", ownerRef: `prin-seg-${k}`, chainKey: "rc-scale-demand",
});
```
`businessTypeOfSegment` 已在同文件 `battery.ts:119` 定义，直接调用无需 import。落库后主修 §4.1 的 `m.businessType` 分支即命中，key 正则退居兜底。

### 4.3 加固 (b)：叶节点携带 `businessType`（推荐）· `service.ts:1388/1402`

订单叶构造时把业态带上（前端 DAG 可显示/二次过滤·R13）：`childDrivers.push({... , businessType: str(o.businessType)})`（:1388），并在 :1402 节点对象里透传 `...(c.businessType ? { businessType: c.businessType } : {})`。仅订单叶带，设备/物料叶不带（无业态语义）。

### 4.4 安全性（字节兼容）

- 非细分指标（`gm_rate`/`material_cov` 等落到结构回落路径者）：`m.businessType` 缺 + key 不匹配 `seg_attain_(ess|pas|com)` → `targetBusinessType === undefined` → 过滤器短路（`!targetBusinessType` 为真）→ **等价原 `status==="OPEN"` 单条件** → 输出字节不变。
- `market_share` / metric-aware 专属域指标：在 :1317-1332 已提前返回，**根本到不了** :1340，零影响。

---

## 5. 《待定 / 推荐》

**决策点**：目标细分怎么解？

| 方案 | 机制 | 优 | 劣 |
|---|---|---|---|
| **A · 种子建模 + 字段过滤（推荐主选）** | `Metric.businessType`（种子派生）+ 求解器读字段过滤，key 正则兜底 | 过滤依据是**一等建模字段**（R13/R-一致）；求解器逻辑泛化（"指标带 businessType 就按它裁"），未来新增细分指标零改引擎；**数据+引擎同一机制**，契合 SEAM-GATE"整单做两半、不拆两半用不同机制"纪律 | 触种子 → `Metric` 加字段，需**复核并重基**任何按 `Metric` props 求哈希的金值（demo-chain-provenance 对象指纹）；`gap-attribution.test.ts` 叶计数阈值需复验 |
| B · 纯 key 后缀解析（补丁兜底） | 仅求解器内 `/^seg_attain_(ess\|pas\|com)$/` + `SEG_SUFFIX_BT` 映射 | **只碰 `service.ts` 一文件**，零种子/金值扰动，patch 发布最省 | 引擎耦合命名约定；`Metric` 仍无建模细分字段（数据半未闭合，本体不够诚实） |

**推荐**：**采 A（§4.2 种子建模）作为目标态 + §4.1 求解器保留 key 正则作 fallback 分支 + §4.3 叶携带 businessType**。理由：本缺陷正是"数据半（Order 有 businessType）与引擎半（下钻）没对接"的接缝漏，按本仓 SEAM-GATE 纪律应**一 dev 整单、同一机制（真字段）**闭两半；把细分升为 `Metric` 一等字段，才真正让"储能指标只归因储能"从**建模层**成立，而非引擎里靠拆字符串续命。**若发布节奏要求零金值扰动的最小热修**，可先只落 B（§4.1 去掉 `m.businessType ?` 分支即纯 key 解析），后续补 A。

---

## 6. 验收标准

### 6.1 头号判据（SEAM-GATE · 接缝驱动组合测试）

**新增** `apps/datacore/test/gap-attribution-segment-scope.test.ts`（遵 `apps/datacore/test/*.test.ts` 约定，复用 `helpers` 的 `makeApp`/`seedBattery`，`t.services.solvers.invoke(ADMIN,...)`）：

```ts
import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";

const ADMIN: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
const AUTOMAKER = ["长安", "东风", "广汽", "吉利", "小鹏", "宇通", "客车"]; // 乘用车/商用车整车厂
const STORAGE   = ["国家电网", "南方电网", "国家电投", "龙源电力"];       // 储能客户

const custOf = (factor: string) => /（(.+?)）/.exec(factor)?.[1] ?? "";

describe("SEAM · gap_attribution 细分作用域（G-SEG-ATTR-CROSS-SEGMENT）", () => {
  it("储能达成率下钻只含储能客户订单（无整车厂·断在接缝不在各半）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const g: any = await t.services.solvers.invoke(ADMIN, "gap_attribution", { metricKey: "seg_attain_ess" });
    expect(g.rootMetric.key).toBe("seg_attain_ess");
    const orderLeaves = g.atomicLeaves.filter((l: any) => l.provenance?.drillType === "Order");
    expect(orderLeaves.length).toBeGreaterThan(0);
    const custs = orderLeaves.map((l: any) => custOf(l.factor));
    // 头号断言：不含任何整车厂/商用车客户
    expect(custs.some((c: string) => AUTOMAKER.some((a) => c.includes(a)))).toBe(false);
    // 且全部属储能
    expect(custs.every((c: string) => STORAGE.some((s) => c.includes(s)))).toBe(true);
    // 勾稽/确定性未被破坏
    expect(g.reconciled).toBe(true);
  });

  it("非细分指标（gm_rate）不被细分裁剪 · 行为字节不变", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const g: any = await t.services.solvers.invoke(ADMIN, "gap_attribution", { metricKey: "gm_rate" });
    const custs = g.atomicLeaves.filter((l: any) => l.provenance?.drillType === "Order").map((l: any) => custOf(l.factor));
    // 非细分指标仍跨细分（含整车厂）——证明过滤严格作用于 seg_attain_* 而非误伤全局
    expect(custs.some((c: string) => ["长安", "东风", "广汽"].some((a) => c.includes(a)))).toBe(true);
  });
});
```

> 关键断言（一句话）：`gap_attribution({metricKey:"seg_attain_ess"})` 的订单叶客户名 **∩ {长安,东风,广汽,吉利,小鹏,宇通,客车} = ∅**，且全部 ∈ 储能客户集；`gm_rate` 仍含整车厂（未误伤）。

### 6.2 既有测试再基线（"绿测试≠能用"实证 · 金值即更）

现有 `apps/datacore/test/gap-attribution.test.ts` **正以 `seg_attain_ess` 为主测指标**（:26-27,:36），却只断言勾稽/深度/确定性/出处，**从不断言细分纯度**——所以跨细分泄漏一路绿。修复须复验并按真值再基线：

- `:67-74` C3「≥18 叶子·跨≥3 基地」：储能仅 9 张 OPEN 订单，叶集合缩小，**`atomicLeaves.length>=18` 可能临界**。须亲跑取储能作用域真叶数，若跌破 18 则把阈值改为真值并加注释（细分作用域后叶数下降是**正确**结果）；`baseNodes>=3` 需复验储能订单是否仍跨 ≥3 基地（储能型号 方形-LFP/圆柱-LFP/4680-LFP 分布，`battery.ts:50`）。
- `:76-90` C4、`:100-117` C5、`:92-98` C7：动态挑首个 Order 叶，储能作用域下仍有 9 张储能订单叶，逻辑自适应，须**重跑确认全绿**（不改断言逻辑）。

### 6.3 底线

- **四包全绿**：`pnpm -r build && pnpm -r --workspace-concurrency=1 test`（datacore 勿并发多 vitest）——datacore 69 / agentcore 66 / frontend 25+ 全绿（含 6.1 新增 + 6.2 再基线）。
- `pnpm -r lint && pnpm -r typecheck` 通过。
- 若采方案 A：`pnpm gates` 相关金值（demo-chain-provenance 对象计数/指纹、ontology-core、catalog）复核，`Metric` 加字段**不改对象计数**但如有 props 指纹须同步（LOOP 纪律④金值即更）。

---

## 7. 回写本体清单（§8 新增断点）

在 `docs/SYSTEM-ONTOLOGY.md` §8 表（表头 `| 编号 | 断点 | 链路位置 | 性质 |`，line 787-788）**新增一行**：

```md
| G-SEG-ATTR-CROSS-SEGMENT | **gap_attribution 结构反向分摊跨细分铺订单·细分达成率根因下钻混入他细分客户**（WO-SEG-ATTR-SCOPE）：`seg_attain_{ess|pas|com}` 无专属因果域 → 回落通用结构分摊（`service.ts:1334-1352`），`affected = orders.filter(status==="OPEN")`（`service.ts:1340`）**未按 Metric 所属细分裁订单** → 储能达成率下钻铺出乘用车/商用车整车厂（长安/东风）叶。`Order.businessType`（`battery.ts:778/2890`）字段在但未用于过滤（缺过滤非缺字段）。→ **✅ 已闭**（`service.ts:1340` 按目标业态过滤：`Metric.businessType`〔`battery.ts:3373` 经 `businessTypeOfSegment` 派生〕优先·key 后缀 `seg_attain_(ess\|pas\|com)` 回落；叶携 `businessType`；SEAM 门 `gap-attribution-segment-scope.test.ts` 断言储能叶∩整车厂=∅、`gm_rate` 不误伤）。异于 `G-ORDER-FLAT`（行级粒度）/`G-GAP-SCOPE`（base×factor 空间作用域）/`WO-W5 global-sim-business-type-seam`（portfolio 产能占用）。 | 求解器·`service.ts:1340` 结构分摊订单选取 | ✅ 已闭（SEAM 门守·四包全绿·亲手真跑储能叶无整车厂） |
```

同时在 **§3 line 406** 「seg_attain 无专属域仍复用供应链，兼容 v1」后补注：`（复用须按 Metric.businessType 裁订单·否则跨细分泄漏·见 §8 G-SEG-ATTR-CROSS-SEGMENT）`。

> 若最终只落方案 B（纯 key 解析，未补 `Metric.businessType`），§8 与 §3 文字相应去掉"`Metric.businessType` 优先"表述，改为"key 后缀 `seg_attain_(ess|pas|com)` 解析"。

---

## 8. 风险与回滚

| 项 | 评估 |
|---|---|
| 变更面 | 极小：主修单文件单表达式（`service.ts:1340`）；加固各 +1~2 行（`battery.ts:3373` / `service.ts:1388,1402`）。 |
| 行为回归 | Additive/scoped：仅 `seg_attain_*` 指标缩窄订单集；非细分指标短路不变（§4.4）；`market_share`/metric-aware 域到不了该行。 |
| 既有金值/测试 | `gap-attribution.test.ts` C3 叶阈值需复验再基线（§6.2）——这是**正确性修复的应有代价**，不是回归。 |
| R6 确定性 | 过滤纯函数无随机/时钟，两跑字节一致（C7 继续守）。 |
| 暗发标志（dark-feature flag）？ | **不需要**。理由：这是**正确性修复**（当前是明确 bug，非新特性/新模块）；十红线 RL2「暗发」针对**新模块 defaultOn:false**，不适用于修既有错误行为——给正确性修复挂 flag 等于让"默认继续错"，反违 R13"不裸渲染假结论"精神。修复对全租户即时生效即所欲。（对照：若这是"新增细分维度分析特性"才需 RL2 暗发。） |
| 回滚 | 还原 `service.ts:1340` 单行即回到旧行为；方案 A 需连带回滚 `battery.ts:3373` 一行 + 金值。无迁移、无数据结构破坏，秒级可逆。 |

---

## 9. WO 拆分

**一张 WO · 一 fresh dedicated dev · 一 handoff 分支 `claude/handoff-seg-attr-scope`**（数据+引擎接缝小，整单一人做以免"拆两半用不同机制不对接"）。

**🚦范围边界（本单身份 = 只碰这些文件）**
- `apps/datacore/src/solvers/service.ts` —— **仅** `gapAttribution()` 结构回落段（:1334-1352 的 `affected` 过滤 + :1388/:1402 叶携 `businessType`）。**不碰**路由前段（:1247-1332）、`market_share`/metric-domain 分支、因果遍历段（:1474+）、`scope` 分支。
- `apps/datacore/src/synthetic/battery.ts` —— **仅** `:3372-3376` seg metric push 处 +1 行 `businessType`（方案 A）。**不碰** `HTML_ORDERS`/量价口径/其他种子。
- `apps/datacore/test/gap-attribution-segment-scope.test.ts` —— **新增**（§6.1）。
- `apps/datacore/test/gap-attribution.test.ts` —— **仅** C3 叶阈值再基线（§6.2），不改其余断言逻辑。
- `docs/SYSTEM-ONTOLOGY.md` —— §8 新增 `G-SEG-ATTR-CROSS-SEGMENT` 行 + §3 line 406 补注（§7）。

**交付判据（审核方复验头号 = 接缝驱动通，非各半绿）**
1. SEAM 门 `gap-attribution-segment-scope.test.ts` 通（储能叶 ∩ 整车厂 = ∅ + `gm_rate` 不误伤）。
2. 四包全绿（`pnpm -r build && pnpm -r --workspace-concurrency=1 test`）+ lint + typecheck。
3. 亲手真跑：memory 模式起服务，`curl` 下钻 `seg_attain_ess`，肉眼确认无长安/东风、只剩国网/南网/国电投（绿测试≠能用）。
4. 本体回写到位（§7）；方案 A 金值同步（LOOP ④）。

**不在本单**：前端 `DashboardView`/`ProvenanceDag` 无需改（叶少了自然少画；若要用叶上新 `businessType` 上色/分组是后续增强，另 WO）。

---

## 附录 · 复现实测原始观测（2026-07-27 · seed 42）

- 越线细分指标：`kpi-seg-ess | seg_attain_ess | 储能达成率 | actual 72.2 floor 95`（另 `pas 99.5` / `com 115.8` 未越线）。
- `Order.businessType` 分布：`passenger:12 / commercial:3 / storage:9`；`SO-3402 长安汽车/passenger/OPEN/4680-NCM`、`SO-3420 东风汽车/passenger/OPEN`、`SO-3452 国家电网/storage/OPEN/方形-LFP`。
- 下钻 `seg_attain_ess`：`totalGap 27.8`；订单叶 24，整车厂/商用车叶 15（东风×3、长安×3、广汽×4、吉利×2、宇通×3），储能叶 9；叶 `businessType=None`。
