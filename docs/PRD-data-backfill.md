# PRD · 数据补齐：先分清「没定义 / 定义了没数据 / 有数据」，再谈补

| 项 | 值 |
|---|---|
| 版本 | v1.0（2026-08-04） |
| 上游 | `docs/PRD-sandbox-redesign.md` 附录 A 的 **20 个场景例**反查出的数据缺口 · 任务 #93 派生 |
| 解决问题 | 沙盘附录 A 的 20 例逐条反查数据可得性，查出 **1 个既有缺陷 + 4 个真缺字段 + 1 个时序粒度空档**。这些**不属于沙盘**——它们动的是数据地基，爆炸半径覆盖所有读这些对象的页 |
| 不解决 | 不做沙盘本身（`PRD-sandbox-redesign`）· 不新增求解器 · 不改本体建模机制 |
| 交付形态 | 本文只是 PRD。**零代码改动** |

> **为什么独立成单**：往合成种子加属性 = **改 R6 确定性的输入**。
> `a3-refbase.test.ts:23` 断言「元租户确定性种子 ≈95 节点（同 seed 字节一致 R6）」，
> `boundary-version.test.ts` 守指纹，CLAUDE.md LOOP 纪律④ 写死「**金值/注册即更，漏金值即退**」。
> 沙盘 PRD 的 🚦范围边界是 `views/sim/**` + 求解器；本单是 `synthetic/**` + `contracts/**`。
> **两个不同的风险区域，不该给同一个 dev、同一轮 gate。**

---

## 0. 本体引用与影响（铁律 0 · 强制）

- **触及对象类型**（§2）：**不新增对象类型**。只给既有类型补属性：
  `MaterialBalance` · `Customer` · `MaintPlan` · `Base`。另补时序序列（非对象）。
- **触及链路**（§3）：不改任何链路拓扑。补的属性进入既有派生/切片投影链
  （`navigation-slice.ts` 投影 · `LEVER_FACTOR_PROPS` 杠杆发现 · 规则表达式求值）。
- **触及事件**（§4）：**不新增事件**。
- **触及不变量**（§5）—— 本单的**主要风险全在这里**：

  | 不变量 | 风险与处置 |
  |---|---|
  | **R6 确定性** | ⚠ **头号风险**：加属性会改变种子输出字节。处置：每加一个属性，**同批更新金值**，且必须证明「同 seed 双跑仍字节一致」 |
  | **R18 尺度自洽** | 新属性若带量纲（`capexWan` 万元），必须走既有桥常数口径，**不得另造换算** |
  | **R14 去业务锁死** | 新属性取值不得内联业务常数；派生自 `SEG_REGISTRY`/`BASE_REGISTRY` 或显式列为种子数据 |
  | **R13 可溯源** | 每个新属性要能说清「这个值哪来的」——种子给定 vs 派生计算 |
  | **R16 需求拉动** | 本单本身就是 R16 的产物：**沙盘的场景例充当了需求探针** |
- **触及门禁**（§7）：
  - 既有必过：`boundary-singlesource:check`（禁内联）· `ontology-descriptions:check`（**新属性必须带
    非空 `displayName` + `description`**，否则该门直接红——这是硬约束不是建议）· `genuine-sim:check`（禁假数据）。
  - **不新增门**。本单的验收靠既有门 + §5 的金值同步。
- **触及断点**（§8）：
  - **新登记 1 条**（实施时写入）：
    ```
    | G-LEVER-PROP-PHANTOM | 杠杆因子表声明了对象上并不存在的属性：
      LEVER_FACTOR_PROPS.物料齐套（solvers/service.ts:322）列出 "MaterialBalance.coverage"，
      LEVER_PROP_META（:344）也给了 label/unit/kind，navigation-slice.ts:214 还把它列进投影；
      但 MaterialBalance 的种子行只有 gapTon/netDemandTon（battery-extended.ts:394），
      全部规则（C06/C16）、因子下钻、聚合查询一律用 gapTon，**coverage 一处未产**。
      service.ts:331 注释「缺项 → 下游诚实兜底不臆造」使它静默降级——
      于是「物料齐套」这个杠杆候选**永远不出现**，且不报错。
      属铁律 0.5 形态②「接了线没数据」。
      | LEVER_FACTOR_PROPS → 杠杆发现 → DynamicLeverPanel（该候选恒缺） | 🔴 未修（本单治）|
    ```
  - 关联：`G-TIMEGRAIN-SPLIT`（沙盘 PRD §6 登记）的**数据半**由本单交付。

---

## 1. 调查方法与两次自纠（写在前面，因为方法比结论重要）

本单的清单来自对沙盘附录 A **20 个场景例**的逐条反查。过程中我犯了两次同族错误，**两次都是继续追才发现的**，记录如下以免复现：

1. **只按一种声明形式扫**：先按 `propKey: "x"` 统计，得出 `Supplier.leadTime` 等「完全没有」。
   **错** —— `battery-extended.ts:14` 有 helper `const p = (propKey, dataType, isPrimaryKey) => ({...})`，
   属性写作 `p("leadTime")`。修正后 PropertyDef 总数 **384 → 507**。
2. **只扫一个文件**：只查 `battery.ts`。**错** —— `Material`/`Customer` 等定义在 `battery-extended.ts`。

> **⇒ 判据（写给执行方）**：统计属性存在性时，**必须同时匹配 `propKey:"x"` 与 `p("x"` 两种形式，
> 且扫遍 `synthetic/**` 全部文件**。少一种形式或少一个文件，结论就是反的。

---

## 2. AS-IS：六项缺口的**三分法定性**（铁律 0.5）

| # | 项 | 形态 | 证据 | 修法 |
|---|---|---|---|---|
| **D1** | `MaterialBalance.coverage` | **② 接了线没数据** | 声明在 `service.ts:322`(`LEVER_FACTOR_PROPS`) + `:344`(`LEVER_PROP_META`) + `navigation-slice.ts:214`(切片投影)；但种子行只有 `gapTon`/`netDemandTon`（`battery-extended.ts:394`），规则 C06/C16 与全部下钻均用 `gapTon` | ✅ **已裁决：选 A 补数据**（§3.1）——`coverage` 派生自 `gapTon`/`netDemandTon` |
| **D2** | `Customer.tier` | **① 没定义** | 全仓引用数 **0**；`Customer` 对象存在 | 加属性 + 种子产值 |
| **D3** | `MaintPlan.start` | **① 没定义** | 全仓引用数 **0**；`MaintPlan` 对象存在（已用于 `risk_timeline`） | 同上 |
| **D4** | `Base.capexWan` | **① 没定义** | 全仓引用数 **0** | 同上 |
| **D5** | ~~`Shipment.eta`~~ → **`Shipment.etaDay` 已存在** | **③ 有数据** | `etaDay` 已定义，且已接 `LEVER_FACTOR_PROPS.物流时长`（`service.ts:325`）+ `LEVER_PROP_META`（`:349`） | ✅ **无需补**（我先前按 `eta` 查，名字错了） |
| **D6** | shift 档时序种子 | **① 没定义** | 5 条序列全 `grain:"day"`（`battery.ts:2526-2530`）；引擎支持 shift（`timeseries.ts:48`） | 加 shift 档 + 班次剧本 |

> **D5 是本单第二处自纠**：我先前把它列为「缺失」，实际是我查错了属性名。**真正缺的是四个不是五个。**

---

## 3. 逐项详规

### 3.1 D1 · `MaterialBalance.coverage`（✅ **仓主 2026-08-04 已裁决：选 A · 补数据**）

> **裁决记录**：仓主授权「按你认为对的进行」→ 采纳选项 **A（补数据）**。
> 下方两选项对照保留存档，便于日后追溯为何这么定。

| 选项 | 含义 | 代价 |
|---|---|---|
| **A · 补数据** | `MaterialBalance` 加 `coverage`（%，`kind:"ratio"`），种子按 `1 - gapTon/netDemandTon` 派生 | 动种子 → 撞金值；但「物料齐套」杠杆从此真能用 |
| **B · 删声明** | 从 `LEVER_FACTOR_PROPS` / `LEVER_PROP_META` / `navigation-slice` 三处删掉 `coverage`，杠杆改用 `gapTon` | 不动数据；但丢掉「比率」这个更直观的表达（`gapTon` 是绝对量，跨物料不可比） |

**裁决依据（选 A）**：**可比性** —— `gapTon` 是绝对吨数，正极粉缺 1000 吨和隔膜缺 10 吨没法排序；
`coverage` 是比率，才能回答「哪个物料最缺」。而沙盘的断点判定（`PRD-sandbox-redesign` §5.1）
正需要这个排序。**代价已知并接受**：动种子 → 撞金值，故 §6 A1/A2 把「双跑字节一致 + 金值同批更新」列为硬验收。

**落地硬约束**：
- `coverage` 必须**派生自 `gapTon`/`netDemandTon`**，不得独立随机生成 —— 否则两个字段会打架（同一事实两个真源）。
- 派生公式写进注释并配一条断言：`coverage` 与 `gapTon` 必须同向（`gapTon` 增 → `coverage` 降）。
- 必须带 `displayName` + `description`（`ontology-descriptions:check` 强制）。

### 3.2 D2 · `Customer.tier`（客户分级）

- **用途**：附录 A 的 **B6**「三业务抢产能保谁」的判据（按客户等级那一支）。
- **取值来源**：**不得随机**。建议派生自既有事实——如按该客户历史订单金额分位（S/A/B/C），
  与 `Supplier.rating`（已有 S/A/B）同构，**复用同一套枚举词表**。
- ⚠ **不得内联业务规则**：分级阈值若是业务规则，须进规则表；若只是数据标签，则由种子给定并说明口径。

### 3.3 D3 · `MaintPlan.start`（检修窗起止）

- **用途**：附录 A 的 **A8**「交付高峰与检修窗撞在同一周」——今天算不出「撞窗」正是因为缺时间窗字段。
- **现状**：`MaintPlan` 已被 `risk_timeline` 消费（在其 `SOLVER_OUTPUT_SHAPES` 里），
  说明对象活着，**只是没有时间窗字段** —— 所以今天算不出「撞窗」。
- **取值**：`start` + `end`（或 `start` + `durationDays`）。**两个一起加**，
  只加 `start` 无法表达窗口。

### 3.4 D4 · `Base.capexWan`（加线投资额）

- **用途**：附录 A 的 **B9**「加线还是外协」的回本测算。
- ⚠ **R18 尺度自洽**：单位是**万元**，必须与 `SEG_REGISTRY.priceWan`、`scaleAnchorRevenue`（亿）
  的口径链对得上。**不得另造换算常数**。
- **诚实边界**：真实 capex 是业务输入不是可派生量。若种子只能给示意值，
  **必须在 description 里写明「示意值，非真实报价」**，避免下游拿它做真实投资决策。

### 3.5 D6 · shift 档时序种子

- **用途**：附录 A 的 **A9**「夜班良率低于白班」—— 日粒度下这个差异被平均掉，**shift 粒度才暴露**。
- **硬要求（否则提频是白提）**：必须给**班次剧本**（早/中/夜的良率与产出差异）。
  **三个班产同一个数 = 把一个数抄三遍，是新一种假数据**，`genuine-sim:check` 该咬住。
- **范围**：只给③段产能类序列上 shift（`output:line` / `yield:process` / `util:line` / `oee:equip`），
  ①②④段保持 day —— 理由见 `PRD-sandbox-redesign` §6.3（120 桶上限）。
- **聚合算子必须同批声明**（`PRD-sandbox-redesign` §7.2①）：
  `output:line` → `sum`；`util`/`yield`/`attainment` → `weighted_avg`（须配 `weightField`）。
  **用错算子的后果**：`output` 用 avg → 三班产出被平均成一班，**产能凭空少 3×**；
  `util` 用 sum → **利用率 276%，荒谬但不报错**。

---

## 4. 目标 / 非目标

### 4.1 目标

1. **G1** · D1 **按选项 A 落地**：`MaterialBalance` 加 `coverage`（%·`kind:"ratio"`），**派生自 `gapTon`/`netDemandTon`**，不得独立随机生成；且 `LEVER_FACTOR_PROPS` 与对象实际属性对齐。
2. **G2** · D2/D3/D4 三个属性加定义 + 种子产值 + `displayName`/`description`。
3. **G3** · D6 shift 档序列 + 班次剧本 + 聚合算子声明。
4. **G4** · **金值同步**：所有受影响的确定性断言与计数金值同批更新，且证明双跑字节一致。

### 4.2 非目标

- ❌ 不动沙盘任何代码。
- ❌ 不新增对象类型、不新增求解器、不新增门。
- ❌ 不补齐「所有本体属性缺口」—— **只补附录 A 那 20 例真正用到的**。
  发现的其他缺口记进 `notes` 另立单（防范围膨胀）。
- ❌ 不改 120 桶上限（那是沙盘 PRD §6.3 的取舍，本单只产数据）。

---

## 5. 🚦 范围边界

```
修改：
  apps/datacore/src/synthetic/battery-extended.ts   D2/D3/D4 属性定义 + 种子行
  apps/datacore/src/synthetic/battery.ts            D6 序列定义（shift 档）+ displayName 词典
  （选 A 已定 → service.ts / navigation-slice.ts 的 coverage 声明**保持不动**，只需让数据追上声明）
  docs/SYSTEM-ONTOLOGY.md                           §8 新登 G-LEVER-PROP-PHANTOM
  受影响的金值/基线文件                              同批更新（见 §6 A4）

⛔ 不碰：apps/frontend-shell/** · 任何求解器算法 · 规则表达式 · 门脚本
```

---

## 6. 验收判据

| # | 判据 | 怎么核 |
|---|---|---|
| **A1** | **R6 双跑字节一致**：同 `(industry, scale, seed=42)` 连生成两次，输出 `toEqual` | 双跑 diff |
| **A2** | **金值已同步**：`bash scripts/gate.sh` `REAL_GATE_RC=0`，五包全绿 | 显式捕获退出码，**禁 `cmd \| tail; echo $?`** |
| **A3** | **描述门绿**：新属性均带非空 `displayName` + `description`，`ontology-descriptions:check` RC=0 | 门 |
| **A4** | **禁内联**：`boundary-singlesource:check` RC=0 | 门 |
| **A5** | **D1 效果层**：「物料齐套」杠杆候选**真的出现在杠杆面板**（今天恒不出现）。**补前跑一次证明它不在，补后跑一次证明它在** —— 前后对比才算数 | 亲手驱动杠杆发现，贴两次输出 |
| **A6** | **D3 效果层**：加了 `start`/`end` 后，「交付高峰撞检修窗」**真能算出来**（今天算不出） | 构造一个撞窗用例 |
| **A7** | **D6 反假数据**：三个班次的值**必须不同**；把班次剧本去掉使三班同值 → 断言必须**红** | 变异反证，贴红的原文 |
| **A8** | **D6 聚合算子**：`output:line` 按 `sum`、比率类按 `weighted_avg` 且配 `weightField`；**把 `util` 的算子改成 `sum` → 必须红** | 变异反证 |
| **A9** | 本体 §8 已登 `G-LEVER-PROP-PHANTOM` | `ontology-writeback:check` |

> **A5/A6/A7/A8 是本单的核心** —— 前四条只证「没弄坏」，后四条才证「**真的有用**」。
> 只交 A1–A4 不算过：那只说明加了字段，不说明字段能用。

---

## 7. 依赖与排期

| 谁依赖谁 | 说明 |
|---|---|
| 沙盘 **S1（卡点）** | **不依赖本单** —— ③段产能数据已齐（`util:line`/`bottleneck_matrix` 现成），可立刻开工 |
| 沙盘 **S2（断点）** | **依赖 D1** —— 断点排序需要 `coverage` 的可比性 |
| 沙盘 **S4（粒度/三业务）** | **依赖 D6 + D2** |
| 本单 **D1** | ✅ 已裁决（选 A · 补数据），可直接开工 |

**执行顺序**：D1+D2+D3+D4 一批（都是属性，同一 gate 轮次）→ D6 单独一批（时序改动面更大，金值影响不同）。

---

## 8. 诚实边界

- 本单的缺口清单**只覆盖沙盘附录 A 那 20 个场景例**用到的数据，**不是本体属性的全面体检**。
  其他页面可能有别的缺口，本单不负责。
- D1 的两个选项我给了建议（A），但**没有实测过选 A 后金值的实际影响面**——
  可能牵动的断言数量未知。执行方应**先跑一次 dry-run 看金值 diff 规模**，再决定是否拆批。
- D4 `capexWan` 的取值我明确说了「种子只能给示意值」——**这是本单唯一一个无法给真值的字段**。
  若业务方能提供真实 capex 口径，应优先用真值。
- §2 的三分法定性基于**静态读码**，D1 我追到了消费点（`service.ts:707` 的 filter），
  但**没有真跑一次杠杆发现确认它确实不出现**。A5 就是为了补这一步。
