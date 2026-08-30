# 推演台 UX · 逐元素后端支撑度核实

| 项 | 值 |
|---|---|
| **base commit** | `3408572c`（`docs(loop): 矛盾地图换成仓主原文五问 + 本仓追加两问`·2026-08-29 09:00:59 +0000） |
| **取证时刻** | 2026-08-30 03:11–04:2x UTC |
| **树龄探针** | `wc -l apps/datacore/src/synthetic/battery.ts` = **5357**（今天的树；开工时 worktree 停在 `778cc589`/1249 行，已按铁律 3 重开） |
| **取证环境** | 真后端 datacore:4441 `SEED_DEMO=1` 内存模式 + agentcore:4442 + 真 vite:5441 + 真 Chromium 登录 demo/admin。**全程禁 `VITE_MOCK`**，无一个数来自 mock |
| **本单性质** | 核实，非实现。`src/` 零改动 |

---

## 一句话结论

**12 个元素：✅ 1 个 / 🟡 6 个 / 🔵 4 个 / 🔴 1 个。**

真正的坏消息只有一条，但它是整页的地基：

> **元素 1（13 基地 × 7 指标的 Δ）是 🔴，而且不是「接一条线」能补的。**
> 金额确实存在（驾驶舱 601.50 亿 / 118.85 亿，实测可见），扰动也确实生效（实测世界态
> `base_changzhou.loadIndex` 34,864 → 94,570），但**对照实验证明：扰动之后金额逐字节不变**。
> 两层之间不是「没接线」，是**结构上无法接** —— 见 §对照实验 A。

**顶回来的三条**（我给的线索被实测推翻或需要修正）：

| 线索 | 实测 |
|---|---|
| 「推演区 13 页签 0 个带数金额」 | **成立，但我第一次的扫描器是坏的**（金丝雀 0 命中）。修好后：驾驶舱 23 处金额，推演沙盘 / 统一控制台 **0 处** —— 结论不变，证据换了 |
| 「`OrderPromise` 全空 ⇒ 各晚几天算不出」 | **一半错**。`shortfallQty` 0/50、`bottleneck` 0/50 确实全空；但 **`affected_orders` 求解器直接给出 127 单 × `delay` 1–3 天 + 18 客户 + 147.21 亿**。「各晚几天」**今天就有**，只是不在推演层 ⇒ 🔵 不是 🔴 |
| 「代价 248 无单位」 | **有单位，且明确声明非货币**：契约 `global-sim.ts` `OBJECTIVE_UNITS.cost = { unit: "代价单位", note: "惩罚加权分·非货币" }`。硬按「万元」画就是骗人 |

**线索证实的两条**：`coefficientRef` **0/42**（全部内联回落）；`实测格 0/7204`（且这行字已经打在统一控制台屏上）。

---

## 主表

| # | 元素 | 态 | 端点 / 字段 | 实测证据 | 不撑则最近落点 |
|---|---|---|---|---|---|
| 1 | 底图 13 基地 × 7 指标 Δ | 🔴 | — | 13 基地 ✅ 存在；推演世界里**每个基地只有 1 个变量 `loadIndex`**，40 个 stateVar **零个货币量纲**（金丝雀：`pressure` 命名 21 个，扫描器可用）。金额在求解器层，**扰动动不了它**（对照实验 A） | 无。需新建「扰动 → 金额」的换算层 |
| 2 | 多扰动一次提交 | 🟡 | `POST /a/v1/sim/sessions/:id/perturbations` | **数组被拒**：`VALIDATION_ERROR`（路由 `...body` 展开，数组下标变成属性）⇒ 一次一条。**但叠加是真加法**：对照实验 B，44/44 格可加、0 格不可加 | 前端连发 N 次即可，语义正确 |
| 3 | 6 种扰动类型 | 🔵 | 控制台 `PerturbationKindSchema`(5) vs 沙盘 `GET /a/v1/sim/drill/catalog`(11) | **两套互不相通的分类法**。6 种需求：沙盘覆盖 5 种、控制台覆盖 3 种、**换产切型两边都没有** | 沙盘 drill 侧 |
| 4 | 起始拍默认 = 当前拍 | ✅ | `curTick`；`startTick: body.startTick ?? s.curTick` | 实测：会话 `curTick=2` 时不传 `startTick` → 回包 `perturbation.startTick=2`。`curTick` 在列表与详情两个端点都有 | — |
| 5 | 传导链每跳带 系数·延迟拍·来源 | 🟡 | `POST …/tick` → `trace[]` | 逐跳**有**：8749 跳 / 42 条规则。但 `PropagationTraceSchema` 只有 5 字段 `{ruleKey,fromObjectId,toObjectId,amount,viaLinkKey}` —— **系数与延迟不在里面**，须按 `ruleKey` join `/sim/propagation-rules`（前端已经这么做，屏上真的显示「系数 0.5 · 延迟 0声明值」）。**884/8749 延迟跳的来源丢失**，`fromObjectId` 被写成字符串 `"(delayed)"` | join 可补系数/延迟；延迟跳的来源**真丢了** |
| 6 | `coefficientRef` 引用率 | 🟡 | `GET /a/v1/sim/propagation-rules` | **线索证实：42 条边 0 条走引用，42 条全内联 `coefficient`**（金丝雀：`coefficient` 非空 42/42，字段读取正常）。系数取值仅 10 个离散值 `-0.6,0.3,0.35,0.4,0.5,0.6,0.65,0.7,0.8,0.9` | 字段在、消费方在、**数据为空** |
| 7 | 后果 KPI（毛利/在手订单额/准时交付率/违约赔付） | 🔵 | 三处各有一半 | 传导引擎**零货币**；`GlobalSimKpi` = `ontime/cost/changeoverHours/freight/fgInv/transitInv/margin`（margin 是**毛利代理**）；沙盘方案环下拉**有真货币**：营收(亿)/毛利(亿)/经营现金(亿)；`affected_orders` 给 `revenue 147.2093 亿`。**违约赔付 🔴 三处都没有** | 求解器层（非推演层） |
| 8 | 受影响清单 17 单 · 8 客户 · 各晚几天 | 🔵 | `POST /a/v1/solvers/affected_orders/invoke` | **两条路，结论相反**：<br>· 传导层：物料延期 4 拍 → **363 张订单 + 30 条承诺**真的动了，但动的是 `shortageRisk`，**363 张全部等于 336.00**（订单规模差 24.9 倍，冲击一模一样）<br>· 求解器层：`rows[127]` = `{so,cust,qty,due,**delay:1–3 天**,risks[{base,factor,peak,crossDay,threshold}]}`，`summary{orderCount:127,custCount:18,revenue:147.2093}` | **求解器层已完整支撑**，推演层不支撑 |
| 9 | 选中订单全字段 | 🟡 | `/o/Order/SO-3391`（真浏览器） | 屏上 17 项：客户 ✅广汽集团 · 数量 ✅7259件 · 原交期 ✅2026-06-24 · 基地 ✅hefei,jinhua · 单价 ✅21626元。<br>**金额 ❌ 屏上没有** —— API 里 `value=156,983,134` 存在，但 `Order` 本体类型只声明 17 个属性、**`value` 不在其中**（金丝雀：`qty` 已声明），所以 Object360 不渲染。<br>**新交期 ❌**（可由 `due + affected_orders.delay` 算）· **赔付 ❌ 全仓没有** | 金额=声明一下即可；新交期=join；赔付=真缺 |
| 10 | 方案对比 3 案 × 毛利Δ/交付Δ/现金Δ | 🟡 | `packages/contracts/src/global-sim.ts` | **「代价」单位 = `"代价单位"`，note 明写「惩罚加权分·非货币」** ⇒ 248 不是钱。<br>交付Δ ✅（`ontime` 单 / `delay` 套·天）· 毛利Δ 🟡（`margin` 是代理，非元）· **现金Δ 🔴（`GlobalSimKpi` 无 cash 字段）**。<br>另：`decision_play` 是**求解器**不是对象类型（`type=DecisionPlay` 实测 total=0） | 三维只有一维是真的 |
| 11 | 导出 | 🔵 | 无后端端点 | **控制台内没有任何导出端点**。导出是**纯前端**：`views/sim/exportProvenance.ts` 的 `downloadProvenanceReport()` 在浏览器里拼 HTML + `a.download`，5 处挂载（GlobalSim / RiskBoard / DisruptionRadius / OrderChain / ProjectSim）。格式 = 自带「口径与出处」+「导出时间」的 HTML | **可复用**（本就是共享件），但导不出后端算的东西 |
| 12 | 运行日志 10 项 | 🟡 | 见下表 | 6 项有 · 2 项部分 · **2 项真缺** | — |

### 元素 12 逐项

| 项 | 态 | 出处 |
|---|---|---|
| 耗时 | 🔴 | **5 份推演回包全扫，零个耗时字段**（tick / drill / certification / metric-series / affected_orders；金丝雀 `ruleKey` 8749 命中，扫描器可用） |
| 引用对象数 | ✅ | `tick.scope` = `{objects:12740, links:11282, droppedObjects:0, droppedLinks:0}` |
| 切片 | ✅ | `tick.scope` = `{kind:"GLOBAL", target:null, hops:1}` |
| 命中规则 | ✅ | `trace[].ruleKey` 42 个去重 + `firedRuleKeys`；认证口 `propagationRulesFired 42 / Declared 42` |
| 系数来源 | 🟡 | 有，但**恒为「声明值」**（0/42 走 `coefficientRef`）—— 屏上那句「声明值」是诚实的，只是永远只有这一种 |
| 阈值来源 | ✅ | drill finding `provenance` = `{basis:"阈值取该变量在本世界的分位数（零配置）", p90, p95, sampleCount:508, severityBasis}` |
| agent 是否参与 | 🔴 | **零字段**。铁律 1.5 判据二要求「零 LLM 必须明写『本次未调用 agent』」，今天是**留白** |
| 变化格 | ✅ | 可由 state diff 现算（本单实测：44 格 / 412 格 / 5512 格三组） |
| 实测格 | ✅ | `scope.baseSnapshotOrigin` = `{cells:7204, measuredCells:0, derivedCells:7204}`，且**已打在统一控制台屏上**：「世界态出处：DERIVED … 实测格 0/7204」 |
| 扰不动项 | ✅ | 统一控制台屏上：「**今天扰不动的量（20）**」；分层「根源 6 / 枢纽 14 / 末端 20」 |

---

## 对照实验（铁律 1.5 判据一）

### A · 沙盘扰动能不能让金额动 —— **不能，逐字节相同**

```
读数 1（扰动前）  summary {orderCount:127, totalQty:735405, custCount:18, revenue:147.2093}
                 financeImpact DELIVERY=74.2019 MARGIN=13.4811 KIT=7.7529 CREDIT=149.1971
施加            capacity_loss on obj_base_changzhou.loadIndex  delta +99999，推 5 拍
读数 2（扰动后）  summary {orderCount:127, totalQty:735405, custCount:18, revenue:147.2093}
                 financeImpact DELIVERY=74.2019 MARGIN=13.4811 KIT=7.7529 CREDIT=149.1971
金丝雀           base_changzhou.loadIndex  34,864.61 → 94,570.07   ← 世界态确实变了
```

**判定**：扰动生效、金额不动。求解器读**对象库真值**，扰动只写 `sim_tick_state` —— 这是 R4
（沙盘不写真值）的**正确行为**，但也正因如此，**「扰动 → 金额 Δ」这条链今天不存在**，
不是没接，是两端各自都对、中间没有换算器。

### B · 多扰动是叠加还是覆盖 —— **叠加，且是精确加法**

四个分支同一检查点（`sims_demo_seed_world` @tick3），各推 3 拍，**带对照组**（对照组必须有，
否则 3 拍的自然演化会被误读成扰动效果 —— 我第一版就栽在这里，5512 格「都变了」全是噪声）：

| 格 | ΔA（SO-3391） | ΔB（SO-3402） | ΔAB（两条都加） | ΔA+ΔB | 判定 |
|---|---|---|---|---|---|
| `model_4680-NCM.demandLoad` | 150.0 | 150.0 | **300.0** | 300.0 | 可加 |
| `base_changzhou.loadIndex` | 90.0 | 90.0 | **180.0** | 180.0 | 可加 |
| `base_hefei.loadIndex` | 90.0 | 90.0 | **180.0** | 180.0 | 可加 |

**44 格可加 / 0 格不可加**；金丝雀：38 格「A 和 B 都动过」（若为 0 则这个实验什么都没证明）。

⚠ **成立范围**：`mode:"delta"` 且落点不同。落点相同 + `mode:"set"` 时按
`applyPerturbationToState` 是**后写覆盖**（`bucket[v] = m`），不是叠加 —— 前端若允许两条扰动
落同一格，必须自己防。

### C · 冲击幅度与订单规模无关 —— **铁律 1.5 那个病在订单轴上复现**

一次物料延期后，363 张受影响订单的 `Δ shortageRisk`：

| 订单 | 数量 | 金额(亿) | Δ |
|---|---|---|---|
| SO-3490 | 16,131 | 3.49 | **336.00** |
| SO-3402 | 14,518 | 3.14 | **336.00** |
| … | | | |
| SO-900427 | 919 | 0.20 | **336.00** |
| SO-900148 | 648 | 0.14 | **336.00** |

**规模差 24.9 倍，冲击完全相同**（去重后 Δ 只有一个值：`336.0000`）。
与 CLAUDE.md 铁律 1.5 记的「碳酸锂与铝箔各涨 15% 得同一个 9.75」是**同一个形态**，
只是这次的轴是订单规模而不是 BOM 占比。

---

## 补一处能解锁几个元素（给前端的排序）

| 排序 | 补什么 | 解锁 | 工作量性质 |
|---|---|---|---|
| **1** | **接 `affected_orders` 到推演台**（它已经在驾驶舱跑着） | **元素 8 全部 + 元素 9 的「新交期」+ 元素 7 的「在手订单额/准时交付率」** = **3 个** | 接一条线。端点在、数据在、字段对得上 |
| **2** | `Order` 本体类型声明 `value` 属性（`unitPrice × qty`，认证口已把它列为 `entering` 的派生） | **元素 9 的「金额」+ 元素 1/7 的任何按单聚合金额** | 一行声明 |
| **3** | 回包补 `elapsedMs` + `ranAgentLoop:false` | **元素 12 的 2 个真缺项** | 两个字段 |
| **4** | `trace[]` 补 `coefficient`/`delayTicks`（或前端 join 一次，前端**已经在 join**） | 元素 5 的 2/3 | 前端已具备，后端补更省 |
| **5** | 沙盘 drill 的 11 型接进统一控制台 | 元素 3 | 中等：两套机制要对齐 |
| **6** | 给 42 条边填 `coefficientRef` | 元素 6 | 纯数据 |

---

## ⚠ 必须改设计的（后端结构上给不了，硬画就是骗人）

### 一 · 元素 1「13 基地 × 7 指标随扰动变化的 Δ」—— **今天画不出来，且不是接线问题**

三个事实叠在一起：

1. 推演世界里**每个基地只有 `loadIndex` 一个变量**（不是 7 个）；
2. 全部 40 个 stateVar **零个货币量纲**（金丝雀验过扫描器可用）；
3. 对照实验 A：**扰动无法让求解器层的金额移动一分钱**。

⇒ 屏上若画「常州 · 毛利 −2.3 亿」，这个数**今天没有任何来源**。
要么改设计（底图只画 `loadIndex` 这一个真会动的指标 + 明写量纲是无量纲指数），
要么先立一个「扰动 → 经营量」的换算层，那是一张独立的单，不是 UX 单。

### 二 · 元素 10「毛利Δ / 交付Δ / 现金Δ 三维」—— **只有交付Δ 是真的**

- 交付Δ ✅ 真的（`ontime` 单 / `delay` 套·天）
- 毛利Δ 🟡 `margin` 是**代理量**（营收 − cost·相对量），不是元
- 现金Δ 🔴 `GlobalSimKpi` 里**根本没有 cash 字段**

且「代价」那一列的单位契约里写死是 **「惩罚加权分·非货币」**。
三维并排画、单位留空或标「万元」，是把一个无量纲罚分冒充成钱。

### 三 · 元素 7 的「违约赔付」—— **全仓没有这个概念**

`Order` 17 个声明属性、`OrderPromise` 10 个属性、40 个 stateVar、`GlobalSimKpi` 7 个字段
—— 逐个扫过，**没有任何赔付/违约金字段**（金丝雀：同法可扫到 `value`/`unitPrice`）。
这不是「取不到」，是这个业务概念还没进本体。

### 四 · 元素 8 的「各晚几天」—— **能给，但必须换数据源，且不能画成传导结果**

`affected_orders` 的 `delay` 是**求解器按 C03 规则 + 越线窗口算的**，
与传导引擎的 `promiseRisk` **不是一回事、也对不上**（一个是天、一个是无量纲指数，
且传导层 363 张单的值全相同）。
屏上若把「各晚几天」摆在传导链路的下游，视觉上就在宣称「这是推演推出来的」——
**它不是**。要么标清来源，要么把这块挪出推演链路。

---

## 附 · 本单踩到并修好的一个自伤（照铁律 0.6 记账）

第一版金额扫描器**对驾驶舱报 0 命中**。按判据这必须报「工具坏了」而不是「没有金额」——
照做了，回去查，两个 bug 各一个：

1. 路由猜错：`/` 是场景启动器，**经营驾驶舱是 `/v/dash`**（后来改成从真 nav 里读 105 条链接，不再猜）；
2. 正则写死了 `(?![\/a-zA-Z一-龥]{0,0})` —— **对零宽必成功模式取反，恒假**，所以恒 0 命中。

修好后驾驶舱 **23 处金额**（`118.85亿` / `601.50亿` / `58亿` / `149亿` / `74亿` …），
推演沙盘与统一控制台**仍是 0 处**。**结论没变，但在金丝雀报红之前，我没有资格说这句话。**

---

## 复验命令

```bash
# 起真后端（内存模式，无需数据库）
PORT=4441 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 \
  CREDENTIAL_KEY=$(printf '0123456789abcdef%.0s' 1 2 3 4) \
  node apps/datacore/dist/server.js

H='X-Debug-User: demo:usr_demo_admin:admin|planner|catalog_admin|tenant_admin'

# 元素 6：42 条边 0 条走引用
curl -s -H "$H" localhost:4441/a/v1/sim/propagation-rules \
 | node -e 'const r=JSON.parse(require("fs").readFileSync(0)).items;
   console.log("rules",r.length,"withRef",r.filter(x=>x.coefficientRef!=null).length,
   "canary(coef non-null)",r.filter(x=>x.coefficient!=null).length)'
# => rules 42 withRef 0 canary 42

# 元素 8：各晚几天确实存在（求解器层）
curl -s -H "$H" -H 'content-type: application/json' \
 -d '{"args":{}}' localhost:4441/a/v1/solvers/affected_orders/invoke \
 | node -e 'const d=JSON.parse(require("fs").readFileSync(0)).data;
   console.log(JSON.stringify(d.summary), "delays:", [...new Set(d.rows.map(r=>r.delay))])'
# => {"orderCount":127,...,"custCount":18,"revenue":147.2093} delays: [3,1,2]

# 元素 1：实测格 0/7204
curl -s -H "$H" localhost:4441/a/v1/sim/sessions \
 | node -e 'const s=JSON.parse(require("fs").readFileSync(0)).items[0];
   console.log(JSON.stringify(s.scope.baseSnapshotOrigin.measuredCells)+"/"+s.scope.baseSnapshotOrigin.cells)'
# => 0/7204
```

---

## 本体引用与影响（铁律 0）

- **对象类型**：`Base`(13) · `Order`(500·声明 17 属性·`value` 未声明) · `OrderPromise`(50·`shortfallQty` 与 `bottleneck` 全空) · `Customer`(20) · `Material` · `Model`
- **链路**：`Order.orderChurn →0.5→ Model.demandLoad →0.6→ Base.loadIndex`（实测可走）；
  `Material.shortageRisk →0.7→ Model.supplyRisk →0.8→ Order.shortageRisk →0.8→ OrderPromise.promiseRisk`（实测可走，363/30 实例）
- **事件**：`sim.perturbation_created` · `sim.tick_completed` · `sim.checkpoint_saved` · `sim.branched`（本单实际触发过前三个）
- **不变量**：**R4（沙盘不写真值）是元素 1 🔴 的直接成因** —— 它是对的，但它意味着
  「扰动 → 经营金额」必须另立换算层，不能靠放宽 R4 解决
- **新增断点建议**：`G-SIM-MONEY-GAP` —— 推演层与求解器层各有一半，中间无换算器；
  对照实验 A 是它的回归判据。本单只核实、**未回写本体**（按范围边界，不改 src / 门 / 基线）
