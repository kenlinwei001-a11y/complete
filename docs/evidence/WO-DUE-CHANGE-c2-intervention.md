# C2 干预实验 —— 根因诊断的最后一道检验（2026-10-02）

环境 4019（本机 dev 实例，手工 nohup）· SEED_DEMO=1 · 真后端 · 无 mock
分支 `claude/handoff-console-c2-specbase` · 原始输出同目录 `c2-*.txt`（逐份配同名 `.rc`）。

## 一、预言（写于取数之前，⛔ 不许事后改）

根因模型说：**值在播种期被正确算出，然后被 tick 循环丢掉**；衰减相按 λ=0.37 向
`restPoint` 漏，且豁免判据是「入度 0」。若在传导层之外合成 `state = 派生基值 + 传导量`，
则递推变成

```
x' = (1−λ)·x + λ·base + c        （c = 每拍净入流）
⇒ 不动点  x* = base + c/λ
```

`SO-3391`：`base = demandDelta×100 = 60`；该格**唯一**入边是
`Model.forecastBias --×(−0.222)--> Order.demandPressure`，其型号 `4680-NCM` 的
`forecastBias = 50` ⇒ `c = −11.1`；λ = 0.37 ⇒ `c/λ = −30` ⇒ **x\* = 30**。

> 判据：**不是 0、也不是 60**。
> 读数仍是 0 ⇒ 合成没生效；收敛到 60 ⇒ 过度修正，把传导量也吃掉了。

## 二、实测：命中（`c2-prediction.txt`）

```
引擎自报 λ(demandPressure) = 0.37
逐拍：48.9 → 41.907 → 37.50141 → 34.725888 → 32.97731 → 31.875705 → 31.181694
    → 30.744467 → 30.469014 → 30.295479 → … → 30.029324(t15) → 30.00291(t20)
末拍实测 = 30.00291 · 预言 = 30 · 差 = 0.00291
```

**递推形式被独立自证**：整条轨迹以**恰好 1−λ = 0.63** 的比率几何收敛（`18.9→11.907`
比率 0.630；t10→t15 偏离量 `0.2955→0.0293`，每步 `0.0992^(1/5) = 0.630`）。
**形式错了就不会是 0.63** —— 这不是拿第一拍凑出来的。

## 三、对照实验：同探针 · 同种子 · 补丁前后（`c2-specowned-indeg.txt` vs `specowned-indeg.txt`）

时间分界干净：**21:05:44 = C2 前**，服务 21:16:08 带新 dist 重启，**21:17:33 = C2 后**。

| 规格拥有格 | 入度 | C2 前 | C2 后 | 变化 |
|---|---|---|---|---|
| `Order.demandPressure` | 1 | **0** | **59.403723** | 从 0 起死 |
| `Model.demandLoad` | 4 | **0** | **130.927016** | 从 0 起死 |
| `Order.costPressure` | 1 | 3.123032 | 122.956030 | ×39.4 |
| `Base.loadIndex` | 1 | 1.966257 | 299.937580 | ×152.5 |
| `Line.utilPressure` | 1 | 7.939099 | 127.446501 | ×16.1 |
| `Model.supplyRisk` | 2 | 15.746350 | 2.471655 | ×0.157（↓，见 §5） |
| …（其余 11 格同向） | >0 | — | — | ×2.8 ~ ×10.5 |
| **8 个入度 0 格** | **0** | 22 / 22.4 / 42.34 / 154 / 8 / −7 / 10 / −6 | **逐字节相同** | **×1.000** |

**两条控制同时成立**：
1. **爆半径 = 衰减相的作用域**：豁免的 8 格**一格没动**，17 格全动。
   C2 没有溢出到它不该碰的地方。
2. **播种态没被碰**：建会话后立刻读 `/world` = 基值 60、`tick=0`
   （`c2-n0.txt`）—— 补丁只在 tick 循环里生效。

## 四、C2 达成了什么 / 没达成什么（⛔ 不许拿 C2 的绿去顶别的账）

**达成**：入度>0 的规格格不再退化成纯传导积分器。此前它们的读数 = 净入流的产物、
**与规格值无关**（`Order.demandPressure` / `Model.demandLoad` 恒 0）；现在贴近基值。

**没达成 · 根因 2 原样存在**：负边仍恒 ≤ 0，地板仍在。证据就在上表 ——
`Order.demandPressure` 停在 **59.4**，而基值是 **59.778**：**它是被那条 −0.222 的边
从基值往下拉的，不是贴着基值**。这与预言 `x* = base + c/λ` 逐位一致，不是偏差。

**没达成 · 世界的「对」**：C2 让读数忠实于**播种基值**，而有些播种基值自身是可疑的负数
（`Material.shortageRisk` max = **−59.72**、`Model.supplyRisk` max = **−10.89**、
`PurchaseOrder.procurementDelay` = **−7**、`Supplier.procurementDelay` = **−6**）。
这些**是播种期的既有值、不是 C2 造出来的**（C2 前它们被衰减掩盖，看不见）。
⇒ **新开一条独立账：播种基值的符号合理性**，与本次根因**分开验、分开修**。

## 四之二、🔴 第一版有缺陷，A/B 当场抖出（2026-10-02 当晚补）

第一版「预言命中」是真的（§二），**但那个命中只证明了 `Order.demandPressure` 这一格对了**，
不能推出「整层对了」。跑 diff 半径测试（10 文件）时 **5 文件 7 红**。做了 A/B 才定性：

| 臂 | C2 形态 | 红 |
|---|---|---|
| **A** | 无 C2（源码回 `4e708bae0`，撤销有自证：`restoreSpecBase` 命中 0） | **2 条** |
| **B** | 松守卫 C2（第一版） | **7 条** |
| C | 紧守卫 C2（修正后） | 见 §四之三 |

- **B−A = 6 条是 C2 引入的**（跨 4 文件）
- **A∩B = 1 条两臂都红**（`seed-demo-propagation` M0-A11 `Test timed out in 120000ms`）⇒ **与 C2 无关**
- **A−B = 1 条只有撤 C2 才红** ⇒ **负载 flaky**，不是 C2 的功劳

⚠ **时长不可作判据**：同一文件 B 臂 27.6s、A 臂超时、C 臂 145s。机器 load average
一度 **42 / 86 / 130**（4 核机），且 C 臂第一次整轮**被宿主杀掉**（vitest 进程数 0、
日志 mtime 冻结、rc 为空）⇒ 半份日志**不许**读成「零红」。**只有跑完后的红绿集合能用。**

### 病原一 · 守卫条件写错 ⇒ 从「修 17 格」变成「改全世界」

第一版的守卫是 `if (typeof base !== "number") continue;`，**没有任何「归不归规格所有」的判据**，
而我给它写的注释还自称「缺键 = 该格不是规格格 ⇒ 跳过，正是播种路那条判据」——
**那句话是错的**。播种路（`seed-world.ts:472-485`）对**每一格**都写数：

```
const real = o.props[v];
if (typeof real === "number" && Number.isFinite(real)) { row[v] = real;  ... }
else { row[v] = Math.round(seedHash01(`${o.id}|${v}`) * 100); ... }
```

⇒ **`baseSnapshot` 的键永不缺失**，判据恒真 ⇒ 合成作用到**全世界每一个非外生衰减格**，
把合法瞬态也锚死在 tick0。这正是那 6 条红的形状（其中多条是「对照实验：读数按占比拉开」）。

**正确判据仓里早有**，而且**播种路自己就在用**（同函数 `measuredRefVarKeys` 那一行）：
`stateVarValueRef(typeKey, stateVar)`（`synthetic/battery.ts:3996` 导出）。
**复用，不另立登记表。**

### 病原二 · 只改生产 tick 路 ⇒ 与手工镜像的回放环分叉

`metric-series.ts` 的回放环是 `simAdvanceTicks` 的**手工镜像副本**（该文件 `:84` 自述「逐行对齐」、
`:39` 自述为什么不复用）。第一版只给生产路加了合成，镜像副本没跟上 ⇒
**曲线与落盘世界对不上** ⇒ `sim-seed-world.seam.test.ts ⑤` 变红。

⚠ **那一臂的字段注释里逐字记着同一个错的上一次**：
> 「本模块的回放曾**只传 `pairWeights` 不传 `stateVarDomains`** ⇒ 曲线按『无衰减纯积分器』跑…
> `sim-seed-world.seam.test.ts ⑤` 的『落盘世界与曲线 actual 对不上』那一臂就是咬这个的。」

**接缝门在同一个地方咬了第二次 —— 这是设计意图，不是意外。**
⛔ 而且它是**本仓警告过的那类错**（CLAUDE.md 铁律 0.6 第 2 条：「两套真相源」）。

**修法**：抽 `apps/datacore/src/sim/spec-base-synthesis.ts`，**一份实现、两个调用点**。

### 基值同源（修病原二时发现）

`metric-series` 的 `seed` = 「本会话自己的 tick0 行」（`/act` 直写过时与 `baseSnapshot` 不同），
而生产路锚的是**不含扰动的 `baseSnapshot`**（扰动是叠加在基值上的瞬态，该落在「累积传导量」那半）。
两边基值必须同源 ⇒ 给 `MetricSeriesEngine` 加**必填**字段 `specBase`，路由传 `s.baseSnapshot`。
**不给缺省**：可选字段会被静默漏传，而漏传的表现是「曲线看着正常但对不上数」。

⚠ **修完复验：预言值逐位不变 = `30.00291`** —— 修正**只切掉了不该动的格**，没碰根因修复本身
（`SO-3391.demandPressure` 是登记在册的规格格，两种守卫都含它）。

### §四之三 · 修正后的复验（`c2final-tests.*` / `c2fix6-tests.*`）

```
test/sim-seed-world.seam.test.ts             ✓  4 tests   67176ms
test/process-tick-coverage.seam.test.ts      ✓  7 tests   40758ms
test/sim-real-cells.seam.test.ts             ✓ 20 tests   36037ms
test/sandbox-e4-cadence-propagation.seam…    ✓  8 tests   14762ms
test/seed-demo-propagation.test.ts           ✓ 27 tests  191018ms
────────────────────────────────────────────────────────────────
Test Files  5 passed (5)      Tests  66 passed (66)      RC=0
```

⇒ **B 臂的 6 条红全部消除。**

**另一处冒出来的红不是 C2 的**：`sim-order-real-fields.seam.test.ts ⑤`
（`obj_model_4680-NCM.backlogHorizonDays @tick1: expected undefined to be 110`）。
单文件 A/B：**撤掉 C2 后逐字同错** ⇒ **既有红**，本单未引入、也未修，**如实登记为独立账**。

### §四之四 · `specBase` 设成「必填」的用意当场兑现

改成必填后，两处测试的自建引擎漏传了它。**vitest 用 esbuild 只剥类型、不做类型检查**
⇒ 没有编译报错，直接变成运行时 `TypeError: Cannot read properties of undefined
(reading 'obj_arinvoice_arinvoice_0_0')`（`spec-base-synthesis.ts:72`）。

这正是把它设成必填要换的东西：**可选字段会被静默漏传，而漏传的表现是「曲线看着正常但对不上数」**
（`stateVarDomains` 那次事故的形态）。**宁可当场炸，不要屏上悄悄错。**

### §四之五 · 覆盖边界（⛔ 没跑到的不许写成绿的）

**跑到且全绿 —— 两批共 20 个文件 210 个测试：**

| 批 | 文件 | 测试 | rc |
|---|---|---|---|
| 1（最终确认臂 `c2final-tests.*`） | 5 | 66 | 0 |
| 2（`c2rest-tests.*`） | 15 | 144 | 0 |

批 1：`sim-seed-world` · `process-tick-coverage` · `sim-real-cells` ·
`sandbox-e4-cadence-propagation` · `seed-demo-propagation`
批 2：`sim-root-triad` · `sim-root-procurement` · `sim-drill` · `sim-sessions-projection` ·
`sim-node-detail-fields` · `sim-certification` · `sim-rule-domain` · `impact-propagation` ·
`sim-session-lifecycle` · `sim-cert-contract-reconcile` · `slice-deriv-empty` ·
`sim-checkpoint-list` · `sim-act-close` · `sim-disclosure` · `sim-trial-scope-reconcile`

另有三个文件在 A/B 各臂中跑过并绿：`sim-propagation` · `sim-propagation-direction` · `sim-perturbation`；
`sim-session` · `sim-scope-trial` 亦绿。`sim-order-real-fields` 含 **1 条既有红**（见 §四之三）。

**NOT-MEASURED**：`apps/datacore/test/` 下 **gsim / global-sim / derive / seed-demo 其余族
以及 agentcore、frontend-shell 两包**本轮**未跑**（四包全量门在本机跑不动，判据按 diff 半径取）。
**⛔ 不许把本节读成「四包全绿」或「整个 datacore 全绿」——只读了这张表里点名的那些。**

## 五、本轮自己撞出的两个坑（都是「我用 X 当作 Y 的证据」）

1. **`POST /tick {n:0}` 会静默推一拍**（`app.ts:2773`）：
   ```ts
   const n = Math.max(1, Math.floor(Number((req.body as { n?: number })?.n ?? 1)));
   ```
   本意是「推 0 拍、读 tick0」，实测回包 `curTick=1`。**tick 路由不走 zod**，
   而 sibling 的 `counterfactual` 路由走（`z.number().int().min(1).max(64).optional()`）
   —— 两条同族路由的 `n` 校验口径**不一致**。
   ⇒ 后果：`specowned-indeg` 探针表头 **「tick0」实为第 1 拍、「tickN」实为第 11 拍**。
   **该探针的前后对照仍然成立**（两次跑的是同一份探针代码），但**标签是错的，已订正**。
   ⚠ **不牵连锚点**：`_tmp-tick0-spec.mjs` 读 `/world` **且没调 tick** ⇒
   「tick0 世界态 150/150 逐位 === 规格值」**有效**（本次实测复核：建会话后 `/world` = 播值、`tick=0`）。
2. **探针取 `forecastBias` 取错地方**（上一版）：去 `props` 里找，而该量**没有规格、已退役、
   是哈希占位**，根本不在 props 里 ⇒ `c = NaN`、判定行误报 ❌。
   改为**从递推式反解 c**（`c = x₁ − (1−λ)x₀ − λ·x₀`），不依赖读任何外部量。**金丝雀当场拦下，未进入结论。**

## 六、复现

```bash
# 对照：真后端 + 真前端，禁 VITE_MOCK
node _tmp-c2-prediction.mjs                 # 预言检验（先写后测）
TICK=10 node _tmp-specowned-indeg.mjs       # 25 格全量（⚠ 表头 tick0 实为第 1 拍）
node _tmp-n0.mjs                            # 判定 tick{n:0} 是否空操作
```
