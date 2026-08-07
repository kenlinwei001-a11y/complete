# PRD · 推演沙盘线路图语义（WO-SANDBOX-METRO-SEMANTICS）

> 范围：`/v/sim-sandbox` 一页控制台的**中央画布「线路图」模式** ＋ 其节点语义包。
> 本文只写**字段来源**与**诚实边界**；几何常量与判据的唯一实现在
> `apps/frontend-shell/src/views/sim/chainLineMap.ts` / `chainFamilyLines.ts`，本文不复述以免漂移。

---

## 1 · 形：从「两根直线」到「环 + 同心环」

设计稿（`sandbox-console-DESIGN-v2-with-zoom.html:737/:748`）把产销链画成椭圆环，
三条产品族线是三圈同心环。改形**不是审美**，它带三条直线画法给不了的信息：

| # | 信息 | 直线画法为什么给不了 |
|---|---|---|
| ① | **闭环**：回款 → 再投入需求（cash-to-cash） | 直线把链尾画成"走到头就没了" |
| ② | **多族并行**：三条产品族链按半径分层 | 直线要么叠三张图、要么看不出来 |
| ③ | **共线区段 / 换乘站 = 共享瓶颈** | 三个半径上**同角度对齐**才一眼可读 |

③ 是环相对直线**唯一的信息增益**，因此它必须**可算**而不是装饰：
判据 = 一个 `stepId` 在**每一圈**上都出现 ⇒ 该环节被所有族线共用。
单圈时该集合恒空（一条线谈不上共线），界面据此不画共线标记。

### 1.1 闭环段是**结构推定**，不是引擎给的边

引擎 `chain_loss_attribution` 返回的是一条**有序链**（`nodes[]` 按 stage 顺序），
载荷里**没有任何字段**说"链尾回指链头"。因此闭环段：

- `SegmentVM.state = "closure"`（与 `live` / `suspended` 三态分开）；
- 图元在**粗细 / 颜色 / 线型三处**都与实测区间不同（细虚线 + `--ok` 绿），
  刻意不做成"淡一点的实线"——那会被读成一条弱一点的真边；
- `ChainLineMap.closureBasis` 原文常驻，说明它是推定。

与 `AndJoin.basis`（齐套 AND 也是结构推定）同族纪律。

### 1.2 标签减密：**减的是标签不是站**

实测 26 站 × 4–8 汉字 × 3 圈 = 78 组标签，在 ~600px 画布槽里不可读。
处置：只标前 `MAX_LABELS_PER_RING` 个（按引擎 `pctOfChainLoss` 降序，并列按 stepId 字典序）；
**停运站位不参与减标**（算不出来必须一直看得见）；多圈时只有最外圈标名；
无名站保留 `<title>` 读数节点（读屏/测试仍取得到），悬浮与右栏给全量；屏上明写这条规则。

---

## 2 · 三条产品族线的**数据依据**（本单最需要先查清楚的一件事）

### 2.1 堵死的那条路

`chain_loss_attribution` **不吃 `businessTypes` / `modelIds`**：

- 实测传 `baseIds` → 结果**逐字节不变**（anchor 仍 hefei、16 节点、leadTime 79.389D）；
- `chain_impediments` 对另两维**直接 400**（`R-ARG-FIDELITY`：拒绝静默返全域）。

⇒ "按产品族分三条链"**不能**靠给求解器加一个 scope 维度来做。

### 2.2 走通的那条路（选项 b）

该求解器**认 `so`（锚点订单）**，而**订单自带 `businessType`**。
每个业务类型取一张真实订单当锚点，各调一次求解器 ⇒ 三条真的不一样的链。

实测（demo 租户 seed 42）：

| 族 | 锚点 | 型号 | 基地 | 前置期 | top3 特征 |
|---|---|---|---|---|---|
| passenger 乘用车 | SO-3391 | 4680-NCM | hefei | 79.389D | 含 `capacity.aging` 6.39% |
| commercial 商用车 | SO-3437 | 2170-NCM | wuhan | **80.389D** | 含 `supplier_leadtime` **7.58%** |
| storage 储能 | SO-3452 | 方形-LFP | meishan | 79.389D | — |

`totals` / 归因排序 / 节点 `scope.modelIds` / 锚点基地 / 工艺路线**逐项不同**
⇒ 三圈同心环是**有信息的**，不是给同一份数据上三个颜色。

**代价明写**：N 条族线 = **N 次求解器调用**，故开关**默认关**，打开时状态条显示多发了几次。
（这与"同一份数据不许发第二次"不矛盾：那说的是**同一个问题**不许问两遍，这里是 N 个不同锚点。）

锚点选取判据（R6 全序）：同业务类型内 `so` **字典序最小**，与引擎"锚点订单 = Order 按 so 字典序第一张"同口径；
族序 = `BusinessTypeSchema` 枚举声明序；`businessType` 不合契约枚举的订单**计数后丢弃**，不猜。

---

## 3 · 节点语义包「七件套」逐字段来源

| 字段 | 内容 | 今天从哪来 | 状态 |
|---|---|---|---|
| `vars` 七类变量 + 分类学 | T/K/B/C/P/R/S ＋每类的**推演机理**＋控件形态约束 | **已存在**：`views/sim/inspectorModel.ts`（比设计稿多一层 `mechanism`）。控制台右栏「变量输入」页签直接复用 `InspectorNodePanel` | ✅ 复用，未重造 |
| 五段耗时瀑布 + 流动效率 | 逐段占前置期% / 占损失% / 真实性徽标 / 缺载原因原文 | **已存在**：`InspectorNodePanel`（含「补上承载物之前不要拿这个数对外报」那句） | ✅ 复用，未重造 |
| `rules` 规则码 + 阈值 | 引哪条规则的哪个 param / literal / field | **真源**：`chain_impediments.thresholds[]`（实测 C02 field=`Process.requiredThroughput` 166768 电芯/天 · C05 literal 95% · C06 literal 0 吨 · C09 param=`staleHours`） | ◐ 变量级已接（R 类）；**节点级清单未接** |
| `im` 阻滞点人话解释 | 这个节点为什么被卡住 | **真源**：`chain_impediments.impediments[]`（自带 `evidence.ruleKey` / 实测值 vs 阈值 / `dataMode`） | ◐ 已按 `stage` 联动（两求解器无共同 id 维度，见 §4） |
| `o` 承载对象 + 诚实缺席 | 这一段挂在哪个真对象上 / 为什么算不出来 | **真源**：`chain_loss_attribution.evidence[]` 的 R13 下钻三元组（`drillType`/`drillId`/`drillField`/`drillValue`/`drillUnit`/`conversion`/`derivationEdge`）＋ `empty[]` 的 `NO_CARRIER`/`NO_INSTANCE` + `reason` + `probe` | ◐ `empty[]` 已上屏；**`evidence[]` 三元组未上屏** |
| `pos` 节点定位白话 | 这环节在干什么 | 后端无 → 前端语义常量（需门约束键 ⊆ `CHAIN_NODE_REGISTRY`） | ❌ 未做 |
| `cf` 跨节点冲突 | 改这里会连累谁 | 后端无 → 只保留能在代码里指出依据的那几条 | ❌ 未做 |
| `kpi` 流指标 | — | 优先接真值，接不到不显示；**绝不写设计稿里那些编的数字**（14.8% 之类） | ❌ 未做 |

---

## 4 · 在途 / 在制：**时序可算性三级判据**（替代设计稿那个假时钟）

设计稿的 `D+0.0` 时钟 + `1×/4×/16×` + 区间上匀速滑动的方块，**是本仓明确拒绝的画法**。
三个数据源的位置精度天然不同（字段逐条实测于 `apps/datacore/src/synthetic/battery.ts`）：

| 档 | 源 | 有什么字段 | 只能画到什么程度 |
|---|---|---|---|
| ① | `InterBaseTransfer` | `dispatchDay` + `etaDay`（= `dispatchDay + transitDays` 派生） | **区间位置可算** ⇒ 真沿区间移动 |
| ② | `Shipment` | 只有 `etaDay` + `baseId`(目的地) | 位置**算不出来** ⇒ 只画到站倒计时，**不画车**（那条进度条会是纯发明的） |
| ③ | `WIPLot` | 有 `currentProcess`，**无任何 eta** | 只能站驻留 + 排队/放行，不画工序间行进 |
| ④ | `Cadence` | 只有契约、**没有对象、没有一条数据** | `EMPTY` + 补齐路径 |
| ⑤ | 采购支线 | 无 ASN / 无清关 / 无到货检验；`PurchaseOrder` 无发运日与起终点 | `EMPTY` + 逐条取证 |

**控制台不另造时钟**：播控仍由 `TransitFlowLayer` 提供（作为线路图图层）。
控制台负责把这套判据显式呈现（`modeReason` **逐字透传**，前端零改写）。

**SEAM 咬点**：只有 `etaDay`、没有 `dispatchDay` 的批次，渲染结果**不得包含区间位置**
（`progress === null` 且 `segmentId === null`），并配一个三件套齐全的对照组必须真能算出
`progress = 0.5` —— 否则这道门就是恒真的废门。

---

## 5 · 本体引用与影响

- **对象类型**：`ChainNode` / `ChainStep` / `LossAttribution` / `ChainScope`（S0 冻结，只读不改）；
  `Order.businessType`（族锚点分组键）；`InterBaseTransfer` / `Shipment` / `WIPLot` / `Cadence`（在途三源 + 节拍）。
- **链路**：`ViewPage → registry("sim-sandbox") → SandboxView → SandboxConsole → ChainLineMapView`
  → `runSolver → B /b/v1/solvers/chain_loss_attribution/run → OBO → A /a/v1/solvers/.../invoke`
  （族线模式下 **N 次**，每次带不同 `so`）；族锚点发现走 `GET /a/v1/objects?type=Order`。
- **事件**：无新增、无订阅变更。
- **不变量**：
  - **R1** 跨包只依赖 `@platform/contracts`（族键/中文名取 `BusinessTypeSchema` / `BUSINESS_TYPE_LABEL`，零手抄）；
  - **R6** 几何与锚点选取皆纯函数、全序、无时钟无随机；
  - **R13** 闭环段与齐套 AND 两处**结构推定**均带 `basis` 原文常驻；在途 `modeReason` 逐字透传；
  - **R14** 零业务常数、零硬编码色值（全走 `tokens.css`）；
  - **R-ARG-FIDELITY** `businessTypes` / `modelIds` 原样透传让引擎报 400，前端不吞维度；
  - **RL3 / RL5 / RL6 / RL10** 复用既有派生层（`inspectorModel` / `transitFlow` / `chainImpediment`），不造第二套。
- **门禁**：`chain-line-map.seam`（33 例，含「源码零 nodeId 字面量」——本单施工时它当场抓到我在**注释里**
  写了两个 nodeId）；新增 `metro-semantics.seam`（17 例）；`sandbox-console.seam`（22 例）。
- **断点**：
  - 既有 `G-RENDERER-UNREGISTERED` 不受影响（registry 键未动）。
  - **新记一条（本单实测）**：`chain_impediments` 的 locus 是**对象**（`MaterialBatch`/`Line`/`Process`…），
    `chain_loss_attribution` 的节点是**链路节点**——两个求解器**没有共同的 id 维度**，
    今天只有 `stage` 能对上。⇒ 阻滞点只能按 `stage` 联动高亮，**不能按节点精确点亮**。
    这是真实的接缝缺口，不拿一个看着合理的映射盖过去。
