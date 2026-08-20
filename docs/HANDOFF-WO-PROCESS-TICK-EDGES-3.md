# HANDOFF · WO-PROCESS-TICK-EDGES-3（断点 G-PROCESS-TICK-COVERAGE 剩余 18 条「有对象无入边」）

- 基线：`origin/claude/verify-reclaim-6` @ `e1694f00fdfab62e83f96e37ae9660be974e92a1`（开工前 fetch 实测与派单给定一致）
- 分支：`claude/handoff-wo-process-tick-edges-3`
- worktree：`.claude/worktrees/agent-ac9b930cd530073a0`

## 结论先行

**补 0 条，保留 18 条。覆盖率维持 29/65（TICK_DRIVEN 29 · NO_CARRIER_OBJECTS 0 · NOT_TICK_DRIVEN 36）。**
这不是停工，是逐条裁决后的诚实终局：18 条里 **2 条结构上有可用入边但被本体已登记红线挡下**、
**1 条等仓主裁决（派单明令不许碰）**、**15 条真链路表零入边或链底无源**（补 = 新 linkType + 新物化，
超出本单 scope「只允许 `DEMO_PROPAGATION_RULES` + 测试计数断言」，且业务上编不出日节拍因果）。

**本单唯一代码改动**：把挡住我的那句红线机器化 —— §B2 原来只守 D01/D02，本体红线后半句
「同理拒绝 D04 产品平台/系列规划（60/30 天战略周期，与 D01 同类）」此前**靠人记**；现 §B2 增加
「D04 除 P22 外 7 条整批必须 NOT_TICK_DRIVEN」断言。`seed.ts` 与规则表**一字节未动**。

## 一、18 条清单是现算的（不是照抄旧清单）

现算方法：临时探针测试（已删，未提交）真跑 `makeApp + seedBattery + seedDemoPropagationRules +
seedDemoProcessLayer`，从真路由 `GET /a/v1/process-definitions` + `/sim/propagation-rules` +
`/sim/view-config` 现算三档（与门同口径）。基线实测：

```
DRIVEN=29 DARK=36 NODATA=0 TOTAL=65
```

36 条 DARK 分解：**D01/D02 红线 11 条**（P01–P11）+ **零物化 7 条**（P37/P40 `ProductionSchedule` ·
P44 `WIPMove` · P53 `SparePartConsumption` · P61 `ShiftPlan` · P62 `OperatorSkillCert` ·
P65 `AdoptedMitigation`，均 objs=0）+ **有对象无入边 18 条** —— 与派单给定的 18 条**一致，无数差**。

入边证据的权威口径 = 真链路表实例（同「方向可达门」的判据：`links.list` 逐条核对 from/to 端类型）。
探针金丝雀：`Model` 实测 9 种入边（order_for_model×24、version_belongs_to_model×15、
routing_belongs_to_model×15、standard_belongs_to_model×36、change_affects_model×9、
transfer_of_model×17、material_used_by_model×24、fg_of_model×34、orderline_for_model×38）、
`Customer` 2 种 —— 工具能报出已知必中项，下面的「ZERO」才可信（铁律 0.6）。

## 二、18 条逐条处置

| # | 流程 | 承载物（对象数） | 处置 | why |
|---|---|---|---|---|
| 1 | P20 产品平台规划 | ProductPlatform(3) | **不补（红线）** | 唯一入边 `series_belongs_to_platform`×6（ProductSeries→ProductPlatform）**结构上可用**，但本体 §8 红线已登记「同理拒绝 D04 产品平台/系列规划（60/30 天战略周期，与 D01 同类）」—— 60 天战略周期流程跟着日节拍抖动 = 红线定义的造假 |
| 2 | P21 产品系列规划 | ProductSeries(6) | **不补（红线）** | 同上：唯一入边 `model_belongs_to_series`×6（Model→ProductSeries，全 6 个型号都挂系列）结构上可用，同属红线后半句 |
| 3 | P23 产品版本发布 | ProductVersion(15) | 不补（链底无源） | 唯一入边 `bom_belongs_to_version`×15，源 BOMHeader 自身只有 `detail_belongs_to_bom`×105 一条入边，链底 BOMDetail **零入边** |
| 4 | P24 BOM 编制与维护 | BOMHeader(15) | 不补（链底无源） | 唯一入边源 BOMDetail 零入边 |
| 5 | P26 工艺路线与工序设计 | Routing(15) | 不补（链底无源） | 入边 `operation_belongs_to_routing`×150，链底 ProcessCapabilityWindow **零入边**（实测） |
| 6 | P46 质量标准制定 | QualityStandard(36) | 不补（链底无源） | 入边 `char_belongs_to_standard`×72，链底 InspectionResult 无任何入边 linkType；且标准制定是 20 天周期工程活动，非日节拍量 |
| 7 | P12 商机漏斗跟进 | PipelineOpportunity(2) | 不补（零入边） | 真链路表 ZERO；`segment` 是字符串不是 FK（本体原话），连不出真边；商机是外部事件驱动 |
| 8 | P13 询报价与投标 | BidRecord(2) | 不补（零入边） | 真链路表 ZERO；投标是外部事件驱动 |
| 9 | P14 赢单丢单复盘 | WinLossRecord(2) | 不补（零入边） | 真链路表 ZERO；复盘是事后归因产物 |
| 10 | P25 工程变更处理 | EngineeringChange(9) | 不补（零入边） | 真链路表 ZERO（`change_affects_model`×9 是 EC→Model **出边**）；ECN 是工程事件驱动 |
| 11 | P27 工艺能力窗口标定 | ProcessCapabilityWindow(345) | 不补（零入边） | 真链路表 ZERO；标定结果不是日节拍量 |
| 12 | P29 长期协议谈判 | LongTermAgreement(3) | 不补（零入边） | 真链路表 ZERO；45 天谈判周期、WAITING_EXTERNAL_SYSTEM |
| 13 | P30 备份供应池维护 | BackupSupplierPool(2) | 不补（零入边） | 真链路表 ZERO；周期性人工维护动作 |
| 14 | P39 节拍闸门维护 | Cadence(8) | 不补（零入边 + 语义颠倒） | 真链路表 ZERO；且 Cadence 是传导的**节拍闸门本体**（约束条件），让它被它所约束的流推着走是循环语义 |
| 15 | P58 财务预算编制 | FinancePlan(3) | 不补（零入边） | 真链路表 ZERO；20 天预算周期、WAITING_USER |
| 16 | P63 经营指标越线监控 | Metric(10) | 不补（零入边） | 真链路表 ZERO（`metric_affects_ksf`/`metric_ownedby` 都是出边）；本体原话「没有任何业务对象 FK 指向 Metric，硬造一条就是发明关系」；指标值由求解/派生写，不由 tick 传导写 |
| 17 | P64 根因归因与复盘 | RootCauseChain(4) | 不补（零入边） | 真链路表 ZERO；根因链是事后归因产物 |
| 18 | P52 OEE 采集与损失分解 | EquipmentOEE(5460) | **不补（等仓主裁决）** | 派单明令不许碰；本体已量化代价（`equipment_has_oee` = +5460 条链路实例，链路表翻倍，原判不值） |

「链底无源」的含义：入边存在但源类型自身没有任何规则能写它、也再无入边 —— 规则挂上去就是
「接了线没数据」恒不触发（#158 的第二种死法），补了也是假点亮。

### 关于 P20/P21 的额外说明（本单最接近"补"的两条）

这两条是三判据里 ①业务因果 ②链路方向 ③源有数据 **后两条全过**的唯二候选（roll-up：
型号需求负载 ⇒ 系列汇总 ⇒ 平台汇总，S&OP 里真实的聚合因果，且 `demo_order_demand_pressure`
确实写 `Model.demandLoad`）。中途曾实现过一版（2 条规则、35→37、29/65→31/65），
三个测试文件 22 例实测全绿（RC=0）——**但**本体红线后半句「同理拒绝 D04 产品平台/系列规划」
是已登记的建模裁决，派单也明言「你补的边不许把这三个域染成 tick-driven」。
技术性全绿 ≠ 该补；已整体回滚（`git checkout`），并把这句红线机器化（见下）。

## 三、代码改动（唯一一处）

`apps/datacore/test/process-tick-coverage.seam.test.ts` §B2：新增红线 1b 断言 ——

```ts
const d04strategic = [...tri.byKey.entries()].filter(([k, v]) => v.domainKey === "D04" && k !== "P22");
expect(d04strategic.length).toBe(7); // P20/P21/P23/P24/P25/P26/P27
expect(d04strategic.filter(([, v]) => v.drive !== "NOT_TICK_DRIVEN").map(([k]) => k)).toEqual([]);
```

P22（Model）不在红线内：它在档 1/2 已被点亮（既有基线事实，非本单所染）。
§B1 计数断言**不需要重写**：未补边，29/0/36 与基线一致（本单现算复核过，见下测试证据）。

### 与派单描述的差异（如实登记）

派单写「§B2 红线（D01/D02/D04 整域 NOT_TICK_DRIVEN）保持绿」。实测基线上的 §B2 **只守 D01/D02**
（D04 的 P22 在基线上本就是 TICK_DRIVEN，「D04 整域 dark」在基线上就不成立）。按内容不按字面执行：
本单把 D04 战略层 7 条补进 §B2，使派单意图（D04 不许再被染）成为机器判据。

## 四、测试证据（命令 + RC + 关键输出）

机器红灯，避让水位声明见 §六。全部 `--maxWorkers=1`，只跑相关文件，未跑全量。

1. **最终态门（含 §B2 新断言）**：
   `cd apps/datacore && npx vitest run test/process-tick-coverage.seam.test.ts --maxWorkers=1`
   **RC=0**，7/7 通过（§A1–A3 金丝雀 · §B1 29/0/36 现算 · **§B2 含新 D04 断言** · §C 接缝 29 真动/36 精确为 0/C4 sourceOnly 恒空 · §D 变异反证）。耗时 218s。
   关键输出：`✓ … > §B2 🔴 反面判据（红线 1）：D01 经营规划 与 D02 外部信号整域、及 D04 除 P22 外的战略/工程周期 7 条，必须是「本层不随节拍变」 35209ms` / `Test Files 1 passed (1)` / `Tests 7 passed (7)`。
2. **入边取证探针**（临时文件，用后已删）：RC=0。金丝雀 `Model` 9 种入边 / `Customer` 2 种命中；
   12 个候选类型 ZERO 入边、4 个链底无源、P20/P21 各 6 条可用入边 —— 逐条数字见 §二表。
3. **（中性证据）2 边变体曾全绿**：实现过 35→37 条规则的变体，
   `npx vitest run test/process-tick-coverage.seam.test.ts test/seed-demo-propagation.test.ts test/sim-rule-domain.seam.test.ts --maxWorkers=1` **RC=0，22/22**。
   该变体因触碰本体红线已整体回滚，此处仅证明「回滚不是因为跑不过」。
4. 未改动的 `seed-demo-propagation.test.ts` / `sim-rule-domain.seam.test.ts` 在最终态未重跑
   （最终态相对基线只动了 seam 测试一个文件的一个 `it` 块；这两个文件与基线逐字节一致，
   其基线绿态由集成线既有证据覆盖）。

## 五、merge-tree 自测

```
$ git merge-tree --write-tree origin/claude/verify-reclaim-6 HEAD > /tmp/mt-tick3.out 2>&1; echo $?
0        # MT_RC=0（干净可并），写入树 f906ec5c0737027fcd90ce8bb2e7a748dc53efdc
```

完工 `git status --porcelain` 为空。

## 六、避让水位声明（硬性合规）

- 跑 vitest 前探针 `ps -eo args | grep -F "node (vitest" | grep -v grep | wc -l`：
  首轮 10:43 测得 0（跑了探针 v1）；10:59 测得 4（>3）→ 等 3 分钟 × 3 轮：11:03 测得 4、
  11:06 测得 8、11:09 测得 4，仍 >3 ⇒ 按纪律 `--maxWorkers=1` 推进。
- uptime 证据：11:09 `load averages: 665.10 617.49 489.04`（用户侧高负载，load 振荡远超 20–70 区间）。
- 只跑了相关测试文件（探针 + 本 seam 门 + 中途变体的三个文件），未跑全量 `pnpm -r test`。

## 七、本体回写

`docs/SYSTEM-ONTOLOGY.md` §8 `G-PROCESS-TICK-COVERAGE` 行句尾追加档 4 终局裁决（不删改既有文字）。
