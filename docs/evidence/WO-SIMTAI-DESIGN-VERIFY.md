# WO-SIMTAI-DESIGN-VERIFY · 决策推演台设计稿 10 条批注实测

| 项 | 值 |
|---|---|
| **base commit** | `f6ed5b07` |
| **canonical** | `f6ed5b07`（`origin/claude/inspiring-gates-aqczjg`，`merge-base --is-ancestor` 判：不落后） |
| **取证时刻** | 2026-09-10T04:24Z 起 ～ 05:10Z |
| **树龄探针** | `wc -l apps/datacore/src/sim/propagation.ts` = **1025** |
| **取证环境** | 真后端 `SEED_DEMO=1` 内存模式，datacore `:41871`（自证：请求逐条落在**我自己**的 log 里，且重启臂核对过无 `EADDRINUSE`）。禁 `VITE_MOCK`。 |
| **被测对象** | 设计稿页面二「决策推演台 · 多扰动叠加」末尾 `<div class="ann">` 表 10 行 |
| **实现落点** | 设计稿的「决策推演台」= 仓内**统一推演控制台** `apps/frontend-shell/src/views/sim/unified/`（金丝雀：`推演台` 全仓 0 命中，而`推演沙盘`/`演习结论` 命中正常 ⇒ 是命名不同，不是工具坏） |

> ⚠ 取证副作用（如实记）：早期一次 `kill` 用了过宽的命令行匹配，**误杀了另外 3 个 agent 的 datacore 实例**（pid 855/2649/5296）。此后改为「只杀我自己 log 里记的 pid」。本报告全部读数取自我自己那一个实例。

---

## 一、10 条逐条实测

| 批注号 | 断言原文（截取） | 实测结果 | 判定 | 证据 |
|---|---|---|---|---|
| **1** | 「多扰动并列，逐条可开关…**今天只能一条一条试**」 | 后端**并列已成立**：同一会话实测 6 条扰动并存、叠加生效（当前留存 2 条：种子 `obj_material_elyte.shortageRisk` + 我的 `obj_model_4680-NCM.supplyRisk`）。**逐条开关/删除的 UI 存在但没挂在控制台上** | **部分闭合**（残留=接线） | `GET /a/v1/sim/sessions/sims_demo_seed_world/perturbations` → 200，`items.length=2`，两条 `durationTicks:null` 同时 active。删除写口 `deleteSimPerturbation` 已接：`PerturbationTimeline.tsx:123`；但该组件只挂在**推演沙盘** `SandboxView.tsx:1728`，统一控制台 `unified/rail/PerturbRail.tsx:66` **只 import 常量 `PERTURBATION_KINDS`、不挂组件** |
| **2** | 「整个推演区 **13 页签 0 个金额数**」 | **两半都不成立**。页签实测 **8 档**非 13（5 档可点 / 3 档 pending）。金额数**已有**：`方案寻优` 三根轴带 `unit:"元"` 且有真值 | **已闭合** | 金丝雀先行：先证「有金额的页签」存在 —— `POST /a/v1/sim/optimize-pareto` → 200，`revenue=25,823,889,856`、`cost=866,897,877`、`penalty=10,400,629,400`，objectives 各带 `unit:"元"`；前端 `useParetoFrontier.ts:535 fmtCompact(v,unit)` + `:671 unit: obj.unit ?? ""` 渲染。页签源：`unified/unifiedModes.ts` `UNIFIED_MODE_SPEC` 8 个 key |
| **3** ⚠A类原点 | 「起始拍默认 `0` 而世界在 T+3 ⇒ 填 0 **一次都不生效**、**零提示**」 | **默认值已闭合**（后端默认 = `curTick`，前端默认 = `cur+1`）。「填 0 不生效」**分两态、原文把两件事写成一句**。「零提示」**后端仍成立** | **已闭合（前端）· 残留（后端静默 201）** | 见下 §二 完整 HTTP 序列 |
| **4** | 「传导链每跳带系数、延迟拍、来源。**今天有路径无口径**」 | **已给全**：披露层逐规则带 `coefficient` / `coefficientSource(INLINE\|CONFIG_REF)` / `coefficientRef` / `delayTicks` / `combine` / `via`（含完整跳串），且屏上真渲染 | **已闭合** | `POST …/tick {n:1,disclose:true}` → 200，`disclosure.rules.items[0]` = `{coefficient:0.35, coefficientSource:"INLINE", delayTicks:1, combine:"sum", via:"Base.loadIndex --base_has_shipment--> Shipment.inboundExpeditePressure"}`；渲染在 `DisclosurePanel.tsx:381-395`（`系数`/`内联常数`/`延迟 N 拍`/`via`）。⚠ 整块默认折叠，见 #6 |
| **5** | 「同一张单在对象层带 `广汽 / 7,259 套 / ¥1.57 亿 / 06-24`，进推演层变 `5496.22`」 | **结构性断言成立**（具体数 5496.22 未复现，今天是 4 个 0–100 压力数）。推演层 **500 个 `obj_order_*` 里非数值格 0 个** —— 无客户名、无金额、无交期 | **仍成立** | 对象层 `GET /a/v1/objects?type=Order&page=1&pageSize=3` → 200：`obj_order_SO-3391` = `{cust:"广汽集团", qty:7259, due:"2026-06-24", value:161135282, unitPrice:22198}`（**恰是设计稿点名那张单**，金额 1.61 亿 vs 稿上 1.57 亿）。推演层 `GET …/world` 同 id = `{costPressure:93.671510585628, demandPressure:0, orderChurn:14, shortageRisk:92.926101673363}` |
| **6** | 「运行日志常驻，含『没动什么』…今天这条是**全页唯一默认折叠的**」 | 「默认折叠」✓成立；「**唯一**」✗不成立（顶层有 2 块折叠）。「没动什么」两个数**已上屏且不折叠** | **部分闭合** | `DisclosurePanel.tsx:153` `<details data-testid="sim-disclosure">` **无 `open`** ⇒ 折叠。全树 `<details>` 共 **8 个、带 `open` 的 0 个**（7 个在 DisclosurePanel 内，1 个是 `PerturbRail.tsx:675 rail-blocked`）⇒ 顶层两块。`实测格 N/M` 渲染在**常驻状态条** `UnifiedSimShell.tsx:747`；`今天扰不动的量（N）` 在 `<summary>` 上（折叠态可见）。披露层实测确含 `derivedCells 7204 / measuredCells 0` |
| **7** | 「出口是可导出的方案。今天**控制台内 0 导出**，『演习结论』页签置灰」 | **两半都仍成立** | **仍成立** | 控制台导出 = **0**：`unified/` 全树无 `download`/`导出`/`ExportChip`/`downloadProvenanceReport`。金丝雀（证明我搜得到导出）：`exportCsv` 真存在且被用 —— `graph/MappingOverlay.tsx:36`、`DashboardView.tsx:16`；`downloadProvenanceReport` 在 `sim/shared.tsx:9` 且挂在 `GlobalSimView.tsx:763`（**推演沙盘**，不是控制台）。置灰：`unifiedModes.ts:145` `verdict.pending="这次推演的结论页还没有做好，所以现在点不动 —— 三个后端接口已经好了，缺的是这一档的版面"` |
| **8** | 「权重上屏…**权重变时前沿不变、排序变**」 | **机制在、屏上有、实测成立** | **已闭合** | 屏上：`SandboxOpt.tsx:293` `data-testid="sandbox-opt-weights"` 滑杆组，`:181` 客户端 `rerankByWeights`（不重发请求）。**对照实验**（只改权重）：前沿集合**逐元素相同**、`ranking` **不同**（A 序第 4 位 `hefei=138973…xinyang=37924`，B 序第 4 位 `hefei=37924…xinyang=138973`） |
| **9** | 「500 订单 / 6 型号 = **83.3 扇入** × 0.8 × 51.9 ⇒ 每拍 ~3,460，稳态 **94× 天花板**；因 `x*=inflow/λ≥inflow`，**任何衰减率都修不了**」 | **入流算术完全复现**；**天花板不再成立**（换了非衰减机制绕过）；**残留：源变量顶死在 ~99.75，100× 输入差只换 0.105 位移** | **部分闭合** | 见下 §三 逐步算给你看 |
| **10** | 「`方案寻优` 已有帕累托前沿 **12 解**，但两根轴**写死为** `OrderLine.unitPrice`/`Base.serveCost`；无 cash 字段；『代价 248』是**惩罚加权分·非货币**」 | 前沿 **22 解**非 12。**轴已换**：屏上 X/Y = 获排率 × 营收。penalty 现为**元**且有真值，非加权分。cash 仍缺，但已从留白改为**显式报缺** | **已闭合（轴）· cash 仍缺但诚实** | `POST /a/v1/sim/optimize-pareto/assemble` → 200：`objectives = [serviceRate(获排率,""), revenue(OrderLine.unitPrice × OrderLine.qty, 元), penalty(OrderLine.breachPenalty, 元), cost(Base.serveCost + OrderLine.unitCost × OrderLine.qty, 元)]`。前端取前两根当 X/Y（`useParetoFrontier.projectPareto` 的 `const [ax0,ax1]=axes`）⇒ **不再是 unitPrice × serveCost**。求解 → `frontier=22 / dominated=5 / iterations=27`。`unavailableObjectives` 显式带原因报缺 **3 根**：`margin`（两侧都是单价、本体未声明"每什么"，实测比值 25.7×–40.6×）、`changeover`（指派问题无次序）、`cash`（无时间维、OrderLine 无账期字段） |

---

## 二、第 3 条 · 可复现的 HTTP 序列（A 类原点，逐条给全）

**世界基线**：种子会话 `sims_demo_seed_world`，`curTick = 3`（**与设计稿「世界 T+3」一致**），4775 对象 / **7295 数值格**（稿上 7204）。

### 对照实验设计
> 同一格 `obj_material_elyte.shortageRisk` 上施同一条 `delta` 扰动，**只改 `startTick` 与 `durationTicks`**；
> 每一臂都配一个「同幅度、`startTick=curTick`」的**金丝雀**，金丝雀不动 ⇒ 报量法坏了，不报「不生效」。

| 臂 | 请求体（差异部分） | HTTP | 落库 `startTick` | 世界态 Δ | 判定 |
|---|---|---|---|---|---|
| **A** 不传 `startTick` | `{magnitude:7, mode:"delta", durationTicks:null}` | **201** | **3**（= `curTick`，**不是 0**） | `98.352927154825 → 105.352927154825`，**Δ=+7.000000** | 默认值已闭合 |
| **B** `startTick:0`，永久 | `{…, startTick:0, durationTicks:null}` | **201** | 0 | `105.352927154825 → 112.352927154825`，**Δ=+7.000000** | **生效** ⇒ 稿上「填 0 一次都不生效」**在这一态是错的** |
| **C** 金丝雀 `startTick:3` | `{…, startTick:3, durationTicks:null}` | 201 | 3 | **Δ=+7.000000** | 量法有鉴别力 ✓ |
| **E** `startTick:0` + **有限时长** | `{magnitude:55, mode:"delta", startTick:0, durationTicks:2}`，世界在 **T+4** | **201** | 0 / dur 2 | `98.408423262184 → 98.408423262184`，**Δ=0.000000** | **★静默失效★** |
| **F** 金丝雀（同幅度、当前拍） | `{magnitude:55, …, startTick:4, durationTicks:2}` | 201 | 4 | `98.408423262184 → 153.408423262184`，**Δ=+55.000000** | 量法有鉴别力 ✓ |
| **G** 再推 3 拍 | `POST …/tick` ×3 → `curTick=7` | 200 | — | E 那条**始终未被施加过** | 生效窗 `[0,2)` 已在窗外，**永不补生效** |

### 三条结论
1. **「默认 0」已闭合（两层都是）**
   - 后端：`app.ts` `createPerturbationWorld` → `startTick: body.startTick ?? s.curTick`（实测臂 A 落库 = 3）
   - 前端：`PerturbRail.tsx:212` 初值是**空串**不是 `"0"`；`:228` effect 把它灌成 `defaultStartTick(curTick)` = **cur+1**；`:560` 标签直接写「起始拍（不早于第 N 拍）」；提交前 `perturbRailModel.ts:624` `startTickPhaseOf(...)==="past"` ⇒ 拒绝 `START_TICK_PAST`
2. **「填 0 一次都不生效」原文把两件事写成了一句** —— 实测两态相反：`0×null` **生效**（Δ=+7）、`0×有限时长` **静默失效**（Δ=0）。
   仓内 `perturbRailModel.ts:82-112` 已有同结论的二维表（它自己订正过一维版那句「彻底不生效」是错的）—— **我的独立实测与它一致**。
3. **「零提示」在后端仍成立（这是唯一残留）**
   臂 E 回包顶层只有 `perturbation / curTick / state`，全文扫 `warn|警|提示|hint|notice|过期|不生效|无效|ignored|past|已结束` ⇒ **一个都没有**。
   ⇒ 门是**纯客户端**的；任何绕过前端的调用方（脚本 / 别的界面 / 未来的 agent）仍会拿到「201 + 世界不动 + 零解释」。

---

## 三、第 9 条 · 算给你看

### ① 扇入与入流（**算术完全复现设计稿**）
实测实例数（`GET /a/v1/objects?type=…` 的 `total`）：`Order = 500`、`Model = 6`。

| 边（`GET /a/v1/sim/propagation-rules`，47 条） | 扇入 | coeff | 每拍灌入 |
|---|---|---|---|
| `demo_order_demand_pressure`：`Order.demandPressure → Model.demandLoad` | **500 / 6 = 83.33** | **0.8** | **66.67 × 源值** |
| `demo_order_churn_to_model_demand_load`：`Order.orderChurn → Model.demandLoad` | 83.33 | 0.5 | 41.67 × 源值 |

`66.67 × 51.9 = 3,460` ⇒ **设计稿那句「83.3 扇入 × 0.8 × 51.9 ⇒ 每拍 ~3,460」今天逐项对得上**（扇入、系数都是实测值，51.9 是源值量级）。
扇入 Top3 之后依次为 `WorkOrder.releasePressure → Model.*` 43.33（260/6）、`PurchaseOrder → CustomsClearance` 30.00（30/1）。

### ② 天花板：**不再成立，但修法不是衰减**
- 设计稿的推理前提是「纯积分器 + 衰减」，稳态 `x* = inflow/λ ≥ inflow` ⇒ 任何 λ 都压不到 100 以下。**这个推理本身没错。**
- 仓里换了**另一种机制**绕过它：`WO-PROP-CLAMP` 的 `saturateToDomain`（`propagation.ts:436`）—— **双曲保序饱和**，`band=(max−rest)×0.25`，`raw>kneeHi` 时取 `max − band/(1+u)`，`u=(raw−kneeHi)/band`。
  它**不是硬截断**（硬截断会让 +30 与 +300 读数相同、Δ 恒 0，把病换成另一个病），而是**严格单调**、恒不达界。
- 实测读数确实回到域内：`costPressure = 93.67`、`supplyRisk = 99.71`（域 0–100）。反解 `93.67 = 100 − 25/(1+(raw−75)/25)` ⇒ `raw ≈ 148.8`，即**原始过冲仅约 1.5×，不是 94×**。
- 衰减也是真配上的（不是没配）：披露层 `constraints.stateVarBounds[]` 给出 `decayLambda 0.37`、`decayRef "C35.pressureDecayPerTick"`、`decayRuleExpression "SimStateVar.decayPerTick == params.pres…"`。
  ⚠ 但**规则级** `decay` 字段 **0/47 非空**、`clamp` **1/47** —— 衰减来自**域声明**不是逐边配置。

### ③ 对照实验：引擎还分辨得出幅度吗（判据一：跑得起来 ≠ 算得对）
> 设计：`obj_model_4680-NCM.supplyRisk` **`set`** 到 30 vs 3000（差 100×），各自在**刚重启的干净世界**上（内存模式 ⇒ 字节级一致）推 1 拍，量下游 `obj_order_SO-3391.shortageRisk`（走 `demo_model_supply_risk_to_order_shortage`，coeff 0.8）。
> **金丝雀 = 两臂基线必须逐字节相同**，否则两臂不可比、结论作废。

| 臂 | 基线 tick | 源基线 | 源施后 | Δ源 | 下游基线 | 下游施后 | **Δ下游** |
|---|---|---|---|---|---|---|---|
| `set 30` | 3 | 99.712094 | 99.752763 | +0.040669 | 92.844955 | 80.764686 | **−12.080269** |
| `set 3000` | 3 | 99.712094 | 99.857923 | +0.145829 | 92.844955 | 99.740502 | **+6.895547** |

- **金丝雀通过**：两臂基线 `99.712094 / 92.844955` **逐字节相同** ⇒ R6 确定性成立，两臂可比。
- **引擎仍分辨得出幅度**：Δ下游 **−12.08 vs +6.90**，相差 **18.98** ⇒ **没有被夹死**，`saturateToDomain` 的保序性在真链路上成立。
- **⚠ 残留（这才是今天真正的病）**：源变量被顶在 **~99.75 / 100**。把输入放大 **100×**，源读数只移动 **0.105**（99.752763 → 99.857923）。
  ⇒ 用户在屏上施一个 100 倍的扰动，那一格几乎**看不出变化** —— 这与设计稿 #3 描述的「引擎不读输入被误判三次」是**同一个病的另一个形态**：不是引擎不读，是**分辨率被饱和吃光**。

---

## 四、推演过程可披露层（判据四 · 顺带核）

`POST …/tick {n:1, disclose:true}` → 200，`disclosure` **62,577 字节**，六项**全给得出**：

| 判据要求 | 今天给不给得出 | 实测值 |
|---|---|---|
| 引用的数据（对象类型 + 条数） | ✓ | `objects 12849 / links 13533`，逐类型条数（`EquipmentOEE 5460`、`OrderLine 873`、`Order 500`…） |
| 走过的本体切片（sliceKey + 跳数） | ✓ | `{sliceKey:"GLOBAL", hops:1, nodes:12849, edges:13533, droppedNodes:0, droppedEdges:0}` |
| 命中的规则（key + 系数 + 内联还是配置） | ✓ | `declared 46 / fired 46 / withCoefficientRef **0** / contributions 9136 / perturbationWrites 2`，逐条带 `coefficientSource:"INLINE"` |
| 约束来源 | ✓ | `stateVarBounds[]` 带 `min/max/restPoint/unit/decayLambda/decayRef/decayRuleExpression` |
| **agent 是否参与** | ✓ **明写不留白** | `{"invoked":false,"calls":0,"provider":null,"model":null}` |
| 各环节耗时 | ✓ | `graph 276ms / shadow 370ms / engine 232ms / persist 24ms / total 974ms` |

⚠ **`withCoefficientRef = 0 / 46`**（独立复核：`GET /a/v1/sim/propagation-rules` 全 47 条 `coefficientRef` **全为 null**）——
即页面一批注 #12 那句「机制在、没人走，**42 条边里 0 条在用，全部内联回落**」在**推演路今天仍然成立**，只是边数 42 → 47。
（金丝雀：同一份回包里 `coefficient` 非空 **47/47**、`withWeightRef` **4** ⇒ 我读的是真字段，不是全 null 的空对象。）

---

## 五、① 哪几条是 A 类

**判据**：这条不修，用户会不会在屏上看到坏东西 / 得出与事实相反的结论。

| A 类 | 为什么 |
|---|---|
| **#5**（推演层降级成无量纲数） | 对象层明明有 `广汽集团 / 7,259 套 / ¥1.61 亿 / 2026-06-24`，进推演层只剩 4 个 0–100 压力数，**500 张单里非数值格 0 个**。COO 在推演层排优先级时看不到金额与客户 ⇒ 会把 1.61 亿的单和小单同等对待，**得出与事实相反的结论**。 |
| **#9 残留**（源变量饱和到无分辨率） | 施 100× 扰动，源读数只动 **0.105**。用户会得出「**这个杠杆没用**」—— 而实测下游 Δ 差了 18.98，**杠杆是有用的**。这正是设计稿 #3 说的那个「被误判三次」的病，换了个位置复发。 |
| **#1 残留**（控制台无逐条开关） | 控制台里关不掉任何一条已存在的扰动。实测种子扰动 `+100 shortageRisk` **一直在生效**，用户的每一个读数里都掺着它却无从剔除 ⇒ **把别人的扰动算进自己的结论**。 |
| **#3 残留**（后端静默 201） | **边缘 A 类**：前端 `START_TICK_PAST` 已拦住，**正常点界面的用户碰不到**。但门是纯客户端的 ⇒ 脚本/别的界面/未来 agent 仍会拿到「201 + 世界不动 + 零解释」。按「用户会不会在屏上看到坏东西」严格判 ⇒ **今天不算 A 类**，但门的位置是错的。 |

**非 A 类**：#6（数已在常驻状态条，只是详情要展开）、#7（缺导出是缺能力，不产生错误结论）、#2 / #4 / #8 / #10（已闭合）。

## 六、② 下一张实现单是「接线」「改轴」还是「造门」

| 形态 | 条数 | 是哪几条 | 说明 |
|---|---|---|---|
| **接线**（能力已存在，缺挂载点/缺投影） | **4** | #1、#5、#6、#7 | #1 = `PerturbationTimeline`（含 delete）已实现且已挂在沙盘，**把它挂进 `unified/` 即可**；#5 = 对象层业务量已在 `GET /a/v1/objects`，缺的是**推演层把它投影上屏**；#6 = 给 `DisclosurePanel` 的 `<details>` 加 `open`（或把「没动什么」提到常驻层，`实测格` 已经在了）；#7 = `downloadProvenanceReport` 已实现且挂在 `GlobalSimView.tsx:763`，控制台复用即可 |
| **改轴 / 改参**（机制对，参数或口径不对） | **1** | #9 残留 | 不是造求解器，也不是改衰减 —— 是 `SATURATION_BAND_FRACTION=0.25` 这条饱和曲线在源变量已顶到 99.7 时**分辨率不够**，外加入流本身 66.67× 未做扇入归一。**归一化口径**才是要动的那一格 |
| **造门** | **0** | — | 十条里**没有一条需要新造门**。⚠ 且本仓禁令 3 明令冻结新增门/棘轮/基线 JSON |
| **只改台账 / 无需动代码**（前提已过期） | **5** | #2、#3（主体）、#4、#8、#10 | 这 5 条的断言**今天已不成立**，实现单不该照稿开工；设计稿对应行需回写 |

### ⚠ 给下一张单的前提订正（照铁律 0.6 第 5 条：台账说「没做」不度量「真没做」）
设计稿 10 条里有 **5 条前提已过期**，若照稿直接派单会重做已完成的工作：
- #2「13 页签 0 个金额数」→ 实测 **8 页签**，且 `方案寻优` 三根轴带 `元` 有真值
- #3「默认 0」→ 后端 `?? s.curTick`、前端 `cur+1` + `START_TICK_PAST` 拦截（`WO-SIM-TICK-GATE` 已做）
- #4「有路径无口径」→ 逐规则 `系数/延迟/来源/via` 已给且已渲染
- #8「权重上屏」→ 滑杆已在屏（`sandbox-opt-weights`），且「前沿不变排序变」实测成立
- #10「轴写死 unitPrice/serveCost」「前沿 12 解」→ 实测轴已换成 `获排率 × 营收`、前沿 **22 解**；`WO-PARETO-AXES` / `WO-MARGIN-AXIS` / `WO-MARGIN-AXIS-HONESTY` 三单已落地
