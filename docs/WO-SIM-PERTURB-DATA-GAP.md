# WO-SIM-PERTURB-DATA-GAP · 扰动输入面的数据补齐工单

> **来历**：仓主要求「把推演沙盘改成只负责输入扰动因素」，并要求**仿真必须基于真实需要的数据**，
> 缺什么就出补齐工单。本文件是对账结果 + 待补清单。
>
> **对账方法（不是 grep 猜的）**：起真 datacore（内存模式 `SEED_DEMO=1`，`/readyz ready` 后），
> 按 `GET /a/v1/objects?type=<T>&limit=N` 逐类型拉**真实例**，
> 对 `CAPACITY_FACTOR_BINDINGS`（`packages/contracts/src/capacity-factors.ts`）20 条逐条核
> 「属性在不在 / 有没有值 / 落点类型有没有 baseId」。

## 0 · 探针自证（报否定结论前必须先过这一关）

本单**三次**被自己的探针纠正，全是同一形态 ——
**「我用『我这次查询的命中数』当作『数据存在与否』的证据，而前者并不度量后者。」**

| # | 我的错误结论 | 真相 | 纠正机制 |
|---|---|---|---|
| 1 | `bomUnit` 缺失（`battery.ts` 命中 0） | `battery-extended.ts:731` 有播种 | 只扫了单文件 |
| 2 | `yield_baseline` 零播种 | datacore 7 个文件有命中，且**实测有真值 0.9407** | 正则只认 `prop: value` 写法 |
| 3 | **全部 7 类对象数 = 0** | 端点参数名是 **`type`** 不是 `objectType`；原查询回 `400 VALIDATION_ERROR`，被我的解析读成"空列表" | 金丝雀：打端点原始回包看 HTTP 码 |

**判据（写进本单，后续同类对账必须照做）**：
- 报「不存在 / 为 0 / 没有」之前，**先看 HTTP 码与原始回包**，确认不是自己的查询错了。
- 错误信封 `{"error":{"code":...}}` 与空列表 `{"items":[]}` **必须分开处理** —— 它们一个是"我问错了"，一个是"真没有"，处置相反。

## 1 · 对账结果：**20/20 属性全部存在且有真值**

| 记号 | 因子 | 落点类型 | prop | 可写 | 对象数 | 属性 | 值 | 样本 | baseId |
|---|---|---|---|---|---|---|---|---|---|
| ① | 节拍 CT | Equipment | `ctSeconds` | 可写 | 780 | ✓ | ✓ | 0.48 | ✓ |
| ② | 通道数 | Process | `channels` | 可写 | 650 | ✓ | ✓ | 0 / 1932 | ✓ |
| ③ | 设备OEE | Equipment | `oee_current` | 可写 | 780 | ✓ | ✓ | 0.814 | ✓ |
| ④ | 性能 OEE-P | Equipment | `oeeP` | 只读 | 780 | ✓ | ✓ | 0.923 | ✓ |
| ⑤ | 换型损失 | ChangeoverMatrix | `minutes` | 可写 | 30 | ✓ | ✓ | 158 | **✗** |
| ⑥ | 工序良率 | Process | `yield_baseline` | 可写 | 650 | ✓ | ✓ | 0.9407 | ✓ |
| ⑦ | 质量 OEE-Q | Equipment | `oeeQ` | 只读 | 780 | ✓ | ✓ | 0.971 | ✓ |
| ⑧ | 利用率 | Process | `utilization` | 可写 | 650 | ✓ | ✓ | 0.903 | ✓ |
| ⑨ | 良率爬坡 | Line | `target_yield` | 只读 | 130 | ✓ | ✓ | 0.978 | ✓ |
| ⑩ | 瓶颈工序 | Line | `utilization` | 可写 | 130 | ✓ | ✓ | **92.55** | ✓ |
| ⑪ | 在制 WIP | Line | `capacityDaily` | 只读 | 130 | ✓ | ✓ | 176 | ✓ |
| ⑫ | 产线平衡 | Line | `max_capacity_day` | 只读 | 130 | ✓ | ✓ | 16896 | ✓ |
| ⑬ | 物料齐套 | Material | `onHand` | 可写 | **8** | ✓ | ✓ | 9558 | **✗** |
| ⑭ | BOM 齐套 | Material | `bomUnit` | 只读 | **8** | ✓ | ✓ | 2.396 | **✗** |
| ⑮ | 物料到货 | Material | `leadTime` | 可写 | **8** | ✓ | ✓ | 14 | **✗** |
| ⑯ | 班次时长×班次 | Process | `shifts` | 可写 | 650 | ✓ | ✓ | 1 / 2 | ✓ |
| ⑰ | 在岗出勤/熟练 | Process | `attendance` | 可写 | 650 | ✓ | ✓ | 0.92 | ✓ |
| ⑱ | 设备检修 | MaintPlan | `week` | 只读 | 13 | ✓ | ✓ | 5 | ✓ |
| ⑲ | 需求 | Order | `qty` | 只读 | **24** | ✓ | ✓ | 7259 | **✗** |
| ⑳ | 投产爬坡 | Line | `status` | 只读 | 130 | ✓ | ✓ | "调试" | ✓ |

**结论：没有"属性缺失"这一类缺口** —— 属性全在、值全有。
真实缺口是另外四类，见下。

## 2 · 待补齐清单（按影响排序）

### G1 · 五个落点类型**没有 `baseId`** ⇒「按基地下钻」在这些因子上不成立

| 因子 | 落点类型 | 后果 |
|---|---|---|
| ⑤ 换型损失 | `ChangeoverMatrix` | 选「合肥」也只能扰全体 30 条换型对 |
| ⑬⑭⑮ 物料三项 | `Material` | 8 条物料全局共享，按基地会退化成「13 张卡同一个数」 |
| ⑲ 需求 | `Order` | 订单有 `bases`（复数）但无单一 `baseId` |

代码里已有人记过这笔账（`apps/datacore/src/synthetic/battery-extended.ts` 的
`CAPACITY_CAUSAL_FACTORS` 上方注释）：
> `ChangeoverMatrix.changeoverMin` —— 该字段不存在（真属性是 `minutes`），且 `lineId` 恒 null 无法按基地落；
> `Material.onHand` —— 字段真实但 `Material` 无 baseId，会退化成 13 张卡同一个数（R1「8/8 卡全同」老病）。

**补齐方向（三选一，需仓主定）**
1. **给对象补 baseId**：`ChangeoverMatrix.lineId` 现恒 null → 填真产线，再经 `Line.baseId` 解析到基地；`Material` 按基地拆实例（8 → 8×13）。代价：对象数上升、种子要改。
2. **UI 侧诚实降级**：这 5 个因子的基地下拉**置灰**并标「本因子为全局量，不按基地区分」。零后端改动。
3. **走 `drillPick` 约定**：契约已有 `drillId:"*"` = 按类型聚合/作用域内解析，让引擎按 `baseScopeField` 在本基地内解析。需确认这条路对扰动写入是否也成立（目前只见于因果因子读取侧）。

> ⚠ 方案 1 与 `Material` 只有 **8 个对象**这件事相关：拆基地会变 104 个，会不会撑坏别的页面需要实测。

### G2 · `Line.utilization` 与 `Process.utilization` **量纲不一致**（同名不同义）

实测：
- `Process.utilization` = **0.903**（比率 0–1）
- `Line.utilization` = **92.55**（百分数 0–100）

而因子目录里 ⑧（Process）与 ⑩（Line）**都叫"利用率"、都用 `utilization` 这个 prop 名**。

**后果**：扰动表单若按 prop 名统一处理幅度，「+10」在两处含义相差 100 倍 —— 用户在 Line 上拨 +10 得到 102.55（还算合理），在 Process 上拨 +10 得到 10.903（等于 1090%，荒谬）。这是**静默错答**，不报错。

**补齐方向**：契约 `CapacityFactorBinding` 加 `valueKind`（`ratio` / `percent` / `absolute` / `duration`）+ `range`，让 UI 按量纲渲染控件与校验。
（旁证：前端 mock `handlers.ts` 里的 lever 已经有 `valueKind:"ratio"` 这个字段，说明这个概念在别处已存在，只是因子目录没有。）

### G3 · `Process.channels` **50 个样本里 40 个是 0**

实测分布：`[0, 1932, 1849, 1911, 2023, 1829, 2000, 1977]`，非零仅 10/50。

**这不一定是缺陷** —— 可能"非通道型工序"本就没有通道数。但对扰动输入面是真问题：
用户选中一个 `channels=0` 的工序去扰"通道数"，扰了也不会有任何传导。

**补齐方向**：
- 若 0 = 语义上"不适用" ⇒ 契约补 `applicableWhen`，UI 在该实例上把这个因子**置灰**；
- 若 0 = 漏播 ⇒ 补种子。

**需先确认属于哪一种**，不要直接补数（补错了会造出假的传导）。

### G4 · 扰动写入需要 `targetObjectId`，而**四页拿不到实例**

这条是已知断点（见 `views/sim/console/PerturbTree.tsx` 头注 + `useConsoleSession.ts` 头注），
在此登记以便与上面三条一起排期：

```
后端 service.ts VIEW_DEFS   "sim-console": { …, layout: {} }   ← 无 options
  → SandboxHomeRoute            p.targetObjectId === undefined
  → PerturbTree                 if (targetObjectId === undefined) return;   ⇒ POST 恒不触发
```

因子目录只给到 `objectType`（类型），而契约 `PerturbationSchema.targetObjectId` 要**实例 id**。
中间缺"类型 → 具体哪个实例"这一步。

**补齐方向**：落点实例选择器（仓主已批准接，排在沙盘改造之后）。
选择器的数据源现已确认可用：`GET /a/v1/objects?type=<T>&limit=N` 回真实例，
**注意参数名是 `type`**（本单第 0 节那个坑）。

## 3 · 仿真页需要按真数据重做的部分

当前仿真（`scratchpad/sandbox-input.html`）与真实契约的偏差：

| 仿真里 | 真实 | 处置 |
|---|---|---|
| 6 个环节含「客户」 | 因子目录**没有客户**，只有 7 类：Equipment / Process / Line / Material / ChangeoverMatrix / MaintPlan / Order | 删「客户」，补「换型矩阵」「检修计划」 |
| 20 个具名因子一个没有 | ①–⑳ 全表，11 可写 / 9 只读 | 按 mark 列出，只读画虚线不可点 |
| 基地下拉对所有因子可用 | 5 个因子的落点类型无 baseId | 那 5 个上置灰 |
| 幅度统一 ±% | 至少 4 种量纲（ratio / percent / 绝对值 / 分钟 / 周） | 按 `valueKind` 分别渲染 |
| 落点是个泛下拉 | 需要真实例（G4） | 接 `?type=` 查询 |

## 4 · 建议排期

| 序 | 事项 | 依赖 | 画像 |
|---|---|---|---|
| 1 | **G2 量纲**（契约加 `valueKind`/`range`） | 无 | 中 |
| 2 | **G3 定性**（`channels=0` 是"不适用"还是"漏播"） | 无 | 轻·取证 |
| 3 | 仿真按真因子重做 | 1、2 的结论 | 轻 |
| 4 | **G4 落点选择器** | 仓主已批准 | 中 |
| 5 | **G1 baseId**（三方案择一） | 需仓主定方向 | 重（改种子） |

> G2 排第一的理由：它是**静默错答**（不报错、数字看着正常但差 100 倍），
> 其余几条都是"做不了"而不是"做错了"。本仓的判据是
> **「用户会不会看到坏东西」** —— G2 会，且看不出来。
