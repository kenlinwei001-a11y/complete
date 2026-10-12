# PRD · 物理拓扑 130 格接真数据（WO-TOPO-REALDATA）

> 交付分支 `claude/handoff-wo-topo-realdata` · 基线 `7b1e5e4ea4b1842ed55b72c8ec3784d98721600f`
> 触及文件：`apps/frontend-shell/src/views/sim/physicalTopology.ts` ·
> `PhysicalTopologyView.tsx` · `PhysicalTopologyView.module.css` · `apps/frontend-shell/test/physical-topology*.tsx`
> **datacore 零改动**（结论见 §3.3）。

---

## 1 · 病名：不是「没数据」，是「有数据没接线」

`物理拓扑`（`/v/physical-topology`，也是推演沙盘控制台的 `topo` 画布模式）13 基地 × 10 车间 = **130 格**，
接线前每格四条度量的来源是：

| 度量 | 接线前 | 出处 |
|---|---|---|
| 利用率 | `hash01("${seed}\|${baseId}\|${suffix}\|util")` 纯结构哈希占位 | `physicalTopology.ts` 旧 `spread()` |
| OEE | 同上 | 同上 |
| 在制 | 同上 | 同上 |
| 节拍 | `EMPTY`，reason 写「前端无 `Equipment.ctSeconds` 接口」 | 同上 |

而真数据**早就在种子里并且已物化**（实测 `GET /a/v1/ontology/object-types/stats`）：

```
EquipmentOEE  count=5460  pk=oeeId       (13 基地 × 10 车间 × 3 串行工序 × 2 台 × 7 天)
Equipment     count=780   pk=equipId
WIPLot        count=260   pk=lotId
Workshop      count=130   pk=workshopId
Line          count=130   pk=lineId
```

所以本单是**接线**，不是造数；也不是"造一道门"。修法与工作量差一个数量级，先把病名定死。

---

## 2 · join 键的裁决：`lineId`，**不是** `processId`（工单初判被实测推翻）

工单原文给的链是 `EquipmentOEE.equipId → Equipment.equipId → Equipment.processId`。**实测证伪**。

实测原文（`GET /a/v1/objects?type=Equipment`，全 780 行两页取完）：

```json
{ "equipId":   "LINE-WS-changzhou-assembly-assembly-E1",
  "processId": "LINE-WS-changzhou-assembly-assembly",
  "lineId":    "LINE-WS-changzhou-assembly",
  "baseId":    "changzhou", "ctSeconds": 0.48, "equipment_type": "装配线" }
```

```
processId 末段 distinct（全 780 行）= ["assembly","coating","winding"]        ← 仅 3 值
lineId    末段 distinct（全 780 行）= 十车间 suffix 全集（slurry…pack）        ← 10 值
```

根因是种子的层级结构（`apps/datacore/src/synthetic/battery.ts:3547`(workshopId) / `:3554`(lineId) / `:3570-3600`(process+equipment)）：

```
Base(13) → Workshop(10/基地) → Line(1/车间) → Process(SERIAL_STEPS 3 + 化成 + 老化) → Equipment(2/串行工序)
                                     ↑                        ↑
                     本矩阵的列轴在这一层            Equipment.processId 在这一层
```

`Equipment.processId` 属 **Process 层**（`SERIAL_STEPS` = 涂布/卷绕/装配，仅 3 道），
而本矩阵列轴是 **Workshop 层**（`WORKSHOP_REGISTRY` 十车间）。**两层不同口径**。
照工单那条链接，130 格会塌成 13×3 = **39 格**，另外 91 格永远空。

**故本单按 `lineId` 接**：`EquipmentOEE` / `Equipment` / `WIPLot` 三者都直接带 `lineId`，
而 `lineId = "LINE-" + workshopId` —— 这不是我发明的字符串戏法，datacore 自己在
`apps/datacore/src/synthetic/service.ts:928` 就是这么**反着**算的：

```ts
const workshopId = (l.lineId as string).replace("LINE-", "");
```

前端用它的正向，封装在 `lineIdOfWorkshop()` **一处**。`Workshop` 对象同时持有 `baseId` 与 `processType`，
是「产线 → (基地, 车间列)」唯一的桥。

---

## 3 · 传输：为什么必须走 `/objects/aggregate`

### 3.1 前端 join 拿不全数据（不是"慢"，是"拿不到"）

| 通路 | 实测结果 |
|---|---|
| `GET /a/v1/objects?type=EquipmentOEE&pageSize=500` | `total=1000`、`page=3` 回 **0 条** —— 5460 行只能拿到 1000 行（**18%**） |
| `POST /a/v1/objects/query` `{"limit":6000}` | `400 VALIDATION_ERROR: limit: Too big: expected number to be <=1000` |

根因：`apps/datacore/src/app.ts:2369` 写死 `ontology.queryObjects(ctx(req), type, {}, 1000)`，
**截断发生在分页之前**，翻页翻不出来。契约 `ObjectsQuerySchema.limit ≤ 1000` 同理。

### 3.2 `/objects/aggregate` 服务端全量读

`apps/datacore/src/ontology-governance.ts:721` 自述：

> `// A6 数据层过滤 + 全量读（不受 queryObjects 的 ≤1000 LLM 截断影响 —— 否则规模下聚合静默算错）`

实测：`POST /a/v1/objects/aggregate` `groupBy:["baseId","lineId"]` → **130 组 / `truncated=false` / 29 680 B / 160 ms**。
每组 `count = 42`（6 台 × 7 天），130 × 42 = 5460 —— 全量读到了。

契约边界（`AggregateRequestSchema`）：`groupBy ≤ 2 维`、`metrics ≤ 5 条`、分组基数 > 500 直接 400。
本单四个请求全部贴着上限内排；样本量不占 metrics 额度（由 `Σplanned ÷ min(planned)` 反解）。

### 3.3 结论：**datacore 零改动**

工单允许"必要时加只读聚合端点"。实测下来**不必要**——所需能力既有端点全都有。
四个只读请求并发：3 × `POST /objects/aggregate` + 1 × `GET /objects?type=Workshop&pageSize=500`。
实测总计 **~102 KB / 最慢 160 ms**（首屏一次，`staleTime` 60 s）。

---

## 4 · 聚合口径（多设备/多日 → 一格）

全部写在 `physicalTopology.ts` 的 `buildCellFacts()` **一处**；组件层只做传输与呈现，一行口径都不写。
每条真值随值带 `Measure.basis` 算式上屏（R13）。

| 度量 | 口径 | 为什么这么定 |
|---|---|---|
| **计划工时利用率** | `Σ actualProductionTime ÷ Σ plannedProductionTime` | **和比和 = 天然按计划工时加权**，不是"各设备利用率的平均"。比率类聚合的正确形态。 |
| **OEE** | `avg(oee)`，**带等权门** | OEE 是比率，正确合并是 `Σ(oeeᵢ×plannedᵢ)÷Σplannedᵢ`。聚合端点只有 count/sum/avg/min/max，**算不出乘积和**。故只在 `min(planned) === max(planned)`（等权 ⇒ 算术均 **恒等于** 加权均）时承认 `avg`；不等权即标 `EMPTY` 并写明原因。 |
| **节拍** | `max(ctSeconds)` | 一格 = 一条车间线上 6 台设备，线速由**最慢工位**决定。把各工位节拍平均没有物理含义（平均后的数既不是任何一台的能力，也不是线的能力）。`basis` 同时带出 `min`，快慢差一眼可见。 |
| **在制** | `Σ qty`，按 `lineId` 归车间列 | **刻意不用 `WIPLot.currentProcess`**：实测 260/260 行该字段恒为 `"涂布"`（`battery.ts:4101` 是字面量常数）。拿它定列会把全仓在制一股脑塞进"涂布"一列 = 硬凑。 |

### 4.1 命名红线：两个"利用率"不许共用一个中文名

- 格内 **计划工时利用率** = 设备侧 `Σ实际生产时间 ÷ Σ计划生产时间`（口径上≈可用率）。
- 行首 **基地产能利用率** = `BASE_REGISTRY.util`（基地产能侧，`registry` 档）。

两者数值量级接近但口径完全不同。详情面板两行分别叫「计划工时利用率」与「基地产能利用率」，
**不许合成一个「利用率」混过去**。

### 4.2 孤儿事实：整行丢弃，绝不"就近"摊派

聚合行的 `lineId` 若不在车间册派生出的产线集合里（缺维 / 拼错 / `null`），**整行丢弃并计数**。
摊派 = 凭空造数。诊断数逐项在横幅上播报，不许悄悄吞掉。

---

## 5 · 诚实分层：只加档，一条没拆

`Provenance` 由三态扩为四态。**「占位·未接真值」这条机制一个字都没删** —— 本单是让部分格子从占位升为真值，
不是把诚实位拆掉。

| 档 | 含义 | 格内角标 |
|---|---|---|
| `registry` | 真值·基地册（`BASE_REGISTRY`，行首四项） | 真值 |
| `aggregate` | **新增**·真值·对象聚合（附 `basis` 算式） | 真值 |
| `placeholder` | 占位·未接真值（seed 派生，**不是实测**）；真值取不到时**仍然是它**，并写明"为什么没接上" | 占位 |
| `empty` | 算不出来就标空，`value=null`，**不补 0** | 空 |

回落路径（不是功能开关，是诚实回落）：未登录 / 请求失败 / 后端无该对象 → `buildTopology(seed, null)`
**逐字节等于接线前的行为**，并把原因写进每条 `reason`。
**节拍例外：不回落占位** —— 一个假节拍会被当成排产输入，比空白危险。

统计口径也改了：`placeholderMeasures` 等此前是 `cellCount × 常数`。真值/占位混排之后这个假设不成立，
继续乘常数就是**屏上播报一个假数**，故改为逐条数。

跨视图契约（**改动前必读**）：横幅 testid `phys-topo-placeholder-banner` 与正文里的「占位值」三字被
`test/sandbox-console.seam.test.tsx:360` 依赖（证明"重组时诚实位没丢"）。故来源图例段**恒定出现**，不随数据变。

---

## 6 · 实测结果（真浏览器 · 内存态 datacore · 非 mock）

登录 demo/admin → **点左侧导航**（不 `page.goto`，全页刷新会丢内存态登录）→「物理拓扑」/「推演沙盘 → 物理拓扑模式」：

```
cellCount        : 130
byProvenance     : { "aggregate": 130 }     ← 130/130 格全部接上真值
真值度量          : 520 项（130 × 4）
占位度量          : 0 项
EMPTY 度量        : 0 项
接线诊断          : 命中 130 格 · 车间册映射不到列 0 行 · 孤儿事实行 OEE 0 / 设备 0 / 在制 0 ·
                   OEE 因计划工时不等权判 EMPTY 0 格
pageerror        : 0
console error    : 2（均为 Vite dev 的 /favicon.ico 404，与本视图无关）
```

悬停「常州 · 装配」，屏上读数与 curl 实测逐位一致：

| 度量 | 屏上 | 算式（屏上同显） |
|---|---|---|
| 计划工时利用率 | **91 %** | `Σ实际 18342 ÷ Σ计划 20160`（42 条·和比和=按计划工时加权） |
| OEE | **81.6 %** | `avg(EquipmentOEE.oee) over 42 条`；各条计划工时全等(480) ⇒ 等权 ≡ 加权 |
| 在制 | **8079 电芯** | `Σ WIPLot.qty over 2 批` |
| 节拍 | **0.48 s/电芯** | `max(Equipment.ctSeconds) over 6 台`（取最慢工位） |
| 基地产能利用率 | 88 %（`registry`） | `BASE_REGISTRY` |

### 6.1 实测发现：真值口径下热力只剩两色（**照实登记，本单不改**）

130 格计划工时利用率实测落在 **89.663 % – 93.978 %**（均值 91.945），
按现行 `HEAT_THRESHOLDS`（偏紧 ≥80 / 过载 ≥92）分布为 **偏紧 68 格 / 过载 62 格**，无低载、无正常。
若改用 OEE 驱动热力则 **130 格全落偏紧**。

这是**数据的真相**（种子里各线可用率本就 0.85–0.99），不是阈值坏了。`HEAT_THRESHOLDS` 是业务刻度，
改它属于业务裁决，不在本单范围。已在 `UTIL_HEAT_RANGE` 注释处留档。

---

## 7 · 接缝门与变异反证

新增 `test/physical-topology-realdata.seam.test.tsx`（20 例），载荷形状照抄 curl 实测原文，
期望值**手算硬编码**（不拿实现再算一遍去比自己 —— 那是同义反复）：
`1800÷2400=75` · `1751÷1920=91.2` · `0.6421×100=64.2` · `max(2.5,0.9)=2.5` · `Σ=1234`。

变异反证 8 条，**全部被抓住**（应用 → 跑测试 → `git checkout --` 撤回 → `git status --porcelain` 干净）：

| # | 变异 | RC |
|---|---|---|
| M1 | **占位冒充真值**：`placeholder()` 恒返回 `provenance="registry"` | 1 RED |
| M2 | **avg 冒充 weighted_avg**：拆掉 OEE 等权门 | 1 RED |
| M3 | util 口径掉包：`Σ实际÷Σ计划` 换成 `avg(oee)` | 1 RED |
| M4 | 节拍取平均而非最慢工位 | 1 RED |
| M5 | 孤儿事实就近摊派（落不到格却塞进第一格） | 1 RED |
| M6 | `lineIdOfWorkshop` 丢掉 `LINE-` 前缀 → 全体事实变孤儿 | 1 RED |
| M7 | 统计回到 `cellCount × 常数` | 1 RED |
| M8 | 拆掉横幅里的「占位值」诚实位（跨视图契约） | 1 RED |

---

## 8 · 本体引用与影响

### 8.1 触及的对象类型

| 对象类型 | 角色 | 读法 |
|---|---|---|
| `EquipmentOEE` | 事实源（util / oee） | `POST /objects/aggregate` groupBy `[baseId, lineId]` |
| `Equipment` | 事实源（takt） | 同上 |
| `WIPLot` | 事实源（wip） | 同上，groupBy `[lineId]`（**该类型无 `baseId` 属性**） |
| `Workshop` | 维度桥（产线 → 基地 × 车间列） | `GET /objects?type=Workshop&pageSize=500` |
| `Base` | 行轴 + 行首真值 | `@platform/contracts` `BASE_REGISTRY`（既有） |

**未新增对象类型 / 链路类型 / 领域事件 / 门禁**，故 `docs/SYSTEM-ONTOLOGY.md` 无需回写章节结构。
（本单只把既有对象接进一个既有视图；若后续把口径下沉成 datacore 求解器，届时须回写。）

### 8.2 触及的链路

`Base → Workshop → Line → Process → Equipment → EquipmentOEE` 与 `Line → WorkOrder → WIPLot`
两条既有物化链的**读侧新增一个消费方**（本视图）。写侧不变。

### 8.3 不变量

| 不变量 | 本单如何满足 |
|---|---|
| **R1 contracts-only-shared** | 前端只从 `@platform/contracts` 取 `WORKSHOP_REGISTRY` / `BASE_REGISTRY`；未跨 app import 源码；未新增契约类型 |
| **R2 tenant_id everywhere** | 全部读取走 `/a/v1/objects*`，租户由 JWT 决定；**无 token 则不发请求**（`enabled` 门），未登录不读租户对象 |
| **R6 确定性** | 占位回落路径逐字节确定（同 seed 同输出）；真值路径无时钟/随机；测试网络全桩 |
| **R7 错误信封** | 失败经 `ApiClientError` 冒泡，横幅显 `{code,message}`，不吞 |
| **R13 结论可溯源** | **本单的核心新增**：每条真值随值带 `basis` 算式（算式 + 样本量 + 加权说明）上屏；每条非真值带 `reason` 说明缺什么 |

### 8.4 断点

- **G-5（应用层电池锁死）**：本单**收窄**了一点——这张图的 130 格数值从"前端 seed 哈希"改为"后端对象聚合"，
  少了 130×3 个前端内联伪值。列轴/行轴此前已单源到 contracts。
- **未触及** G-1…G-4 / G-6…G-12。

### 8.5 新增的「假绿」形态记录（供后续门参考）

1. **毒值撞进占位值域**：孤儿事实的毒值首版取 `88.8`，恰好落在占位 OEE 值域 52–98 内 → 「没被摊派」被占位值撞出假红。
   判据：**毒值必须落在所有占位值域之外**。
2. **库的定时器被计成组件泄漏**：`vi.getTimerCount()` 不认归属，把 react-query 的 `gcTime` 句柄计进来
   （`test/leakGuard.ts` 按 `node_modules` 归属过滤掉了它，`vi.getTimerCount()` 没这层过滤）。
   判据：**两种守卫的归属语义不同，混用会互相误报**。
3. **过期的诚实位比没有更危险**：接线前 takt 的 reason 写「前端无 `Equipment.ctSeconds` 接口」——
   今天这句话是假的。留着它，读者会以为真值源不存在而不去接。**接上真值时必须同步作废旧缺口文案。**
4. **上屏文案里的 Markdown 记号**：`basis` 串直接进 DOM，`**x**` 会原样显示成星号（真浏览器实拍抓到）。

---

## 9 · 没做到的（明说）

1. **口径没有下沉到 datacore**。聚合语义今天活在前端 `buildCellFacts()`。对本视图是单源的，
   但**如果第二个消费方（求解器 / 另一个视图）也要"车间格 OEE"，它不会自动共享这份口径**。
   真正的单源应当是 datacore 侧一个 `workshop_metrics` 只读端点或求解器。本单没做，因为：
   ① 既有端点已足够，加端点是净增面积；② 工单范围边界要求 datacore 改动仅在"必须"时。
   **这是一笔明账，不是已解决。**
2. **`mocks/**` 未补 fixture**。mock 模式（`VITE_MOCK=1`）下 `/objects/aggregate` 对
   `EquipmentOEE/Equipment/WIPLot` 返回 `rows: []` → 130 格诚实回落占位。
   刻意不补：给 mock 数据打上「真值·对象聚合」标签有把编造值说成实测的风险，代价大于收益。
   代价是 mock 模式看不到本单效果（真浏览器验证走的是内存态真后端）。
3. **热力刻度未随真值重标**（见 §6.1）。屏上只剩两色，可读性下降，但改业务阈值不是我的裁决。
4. **`capacity_rollup` / `bottleneck_matrix` 仍未接**（维度不匹配，理由在 §台账），台账里照实登记为「仍是缺口」。
5. **未验 pg 模式**。全部实测在内存态（`SEED_DEMO=1`）。聚合走的是 `queryObjects` 同一层，
   理论上 pg 同样成立，但**我没有亲手跑过 pg**。
6. **未跑 datacore / agentcore / contracts 的测试**（工单明令禁止，有别的 dev 在跑）。
   本单 datacore 零改动，但四包全绿由审核方复验。
