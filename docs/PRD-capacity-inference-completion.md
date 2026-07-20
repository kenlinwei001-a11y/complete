# PRD · 产能推演域补全（Equipment/OEE 全基地数据缺口 + 基地作用域 + 前瞻推演 + 逐日过程）

> 基线 canonical `claude/inspiring-gates-aqczjg` @ `0736908d`（integ-wave-11 + scale-coherence + m11-fix + Tier-3〔metric-split/agent-timeout/cash-gm〕已并·四包全绿·89 类型/11082 实例）。
> 【审核方基线更新】原稿基于 c52f6600（11074），已推进：scale-coherence 已解 toy 产能半（gwh 派生·realized 层同锚），本单依赖满足；cash-gm 已带 demo-chain 至 **11082**，故本单金值基线取 **11082**（见下）。dev 请 rebase 到 `0736908d` 后开工，勿基 c52f6600。
> 触发：用户实测「产能推演→合肥根因推演树暂不可用」+「行动计划缺逐日推演过程」+「每基地卡片需 +30/60/90 天前瞻」。
> 纪律：本 PRD 结论**全部经活系统真跑核实**（非前端自诊断转述·绿测试≠能用），含《本体引用与影响》。

---

## §1 核实发现（活 datacore·SEED_DEMO=1·真跑纠偏）

前端「根因推演树暂不可用」附的后端诊断**部分错**。逐条实测：

| 前端诊断 | 活系统实测 | 判定 |
|---|---|---|
| gap_attribution 全局树**无「合肥」结构节点** | 实测 L1 基地层含 `hefei`（9 基地：handan/changzhou/chengdu/wuhan/meishan/**hefei**/jiangmen/yangzhou/xinyang·目标 Metric=seg_attain_ess·totalGap 27.8） | **❌ 前端错·合肥在树里** |
| 该基地未落入分摊基地集 | 合肥有 **2 张 OPEN 订单**（首基地=hefei·`Order.bases[0]`） | **❌ 前端错·数据在** |
| 基地名与 Order.bases 未对齐 | `Order.bases` 存 **ID**（`hefei`）非中文（`合肥`）；前端若传「合肥」确不匹配 | **✅ 真（命名归一）** |
| （前端未识别的真根因） | **Equipment 50 个 + EquipmentOEE 50 个 = 100% changzhou·其余 12 基地全 0**（service.ts:903-904 `equipment.filter(baseId===e.base)`→合肥 baseEquip.length=0→oeeDeficit=0） | **✅ 真数据缺口·根因** |

**结论**：**真缺数据**——但不是前端说的「合肥无结构节点」。合肥节点/订单都在；真缺的是**设备与 OEE 只给常州生成、12 基地全空** → 合肥 L2「设备OEE 瓶颈叶」恒 0 → 根因推演树的**设备瓶颈分支不可用**（诚实灰）。这是生成器级缺口，非 seed 偶然。

---

## §2 缺口分类（4 类·1 真数据 + 3 关联补全）

| 编号 | 类别 | 缺口 | 用户诉求 |
|---|---|---|---|
| **D1** | **数据·真缺·P0** | Equipment/EquipmentOEE 仅常州（50/50）·12 基地全 0 → 逐基地 OEE 瓶颈/根因树设备分支空 | 合肥根因树 |
| D2 | 数据·命名·P1 | 基地键 id(`hefei`) vs 中文(`合肥`) 无归一层 → 前端按中文查空 | 合肥根因树 |
| E1 | 引擎·P1 | gap_attribution 只做**全局最严重 Metric** 归因·无 `scope:{baseId,factorId}` 入参 → 出不了「某基地的树」 | 合肥根因树 |
| F1 | 前瞻·P1（新） | 无「每基地 +30/60/90 天产能 vs 在产/未来订单/销售预测」对比投影 | 基地卡片前瞻 |
| P1 | 过程·P2（新） | 产能风险处置行动计划**逐日行动缺推演过程**（只给结论不给「为什么这天这么做」） | 行动计划过程 |

---

## §3 补齐方案

### D1 · Equipment/EquipmentOEE 全基地生成（真数据缺口·核心）
- **现状**：`battery.ts` equipment 生成段只对常州（或首基地）产 50 台；`EquipmentOEE` 同。
- **改**：循环 `BASE_REGISTRY` 全 13 基地，每基地按其 gwh/产线数派生 N 台 equipment（N 随基地规模·非写死 50·R14）+ 对应 EquipmentOEE（oee_current 确定性哈希·R6 同 seed 一致）。
- **对象预算护栏**（守 narrowed-P0 同款纪律·避逾万对象）：每基地设备数取**代表值**（如 8–15 台·非 50），13 基地 ≈ 130–180 台 equipment + 同量 OEE（vs 现 50）——增量 ~250 对象，可控。**Phase3 高量执行层（停机/告警明细）仍保持现覆盖不铺全基地**。
- **金值**：`demo-chain-provenance.test.ts` 对象数 **11082**→+~250（真跑取值·基线 11082 已含 cash-gm 毛利桥 +8）；类型集不变（Equipment/EquipmentOEE 已存在）。

### D2 · 基地键归一（id ↔ 中文）
- gap_attribution L1 节点补 `baseId`(hefei) + `displayName`(合肥·取 `Base.name`)；`scope` 入参同时接受 id 或中文（内部归一到 baseId）。前端传「合肥」或「hefei」皆命中。
- 单一出处：基地名映射走 `BASE_REGISTRY`/`Base` 对象（非内联·R14）。

### E1 · gap_attribution 加 base×factor 作用域（service.ts:792）
- 入参扩 `scope?:{baseId?, factorId?}`：
  - `scope.baseId` → 只对该基地的 OPEN 订单做结构分摊 + 该基地设备 OEE / 物料瓶颈叶 → 出**该基地的根因树**（父=该基地对全局 gap 的贡献·勾稽不变）。
  - `scope.factorId` → 从该因子入口沿 caused_by 下钻（已有 metricDomain 逻辑复用）。
- **兼容**：无 scope 时 = 现全局行为（不回归）；R6 确定性/R13 provenance/勾稽 Σ子+residual=父 全保持。

### F1 · 每基地前瞻产能推演（+30/60/90d·新）
- **数据多已就绪**：`capacity_forecast`（已有·per-base P50/P90/gap/bottleneck·我实测 gap 89520/常州 tightness 91）+ `Order.due`（未来订单排期）+ `DemandSegment.p50`（销售预测）。
- **新增**：per-base 前瞻投影——对 horizon∈{30,60,90} 各算：可用产能（capacity_forecast）vs 在产订单占用（WorkOrder/OPEN Order 到期铺开）vs 未来订单（Order.due 落在窗内）vs 销售预测（DemandSegment.p50 摊到窗）→ 四线对比 + 缺口/富余标记。
- 可作 `capacity_forecast` 的 `horizonDays` 多值扩展，或新 `base_capacity_outlook` 求解器（读同源对象·R6）。前端每基地卡片加前瞻子面板（三档 tab）。

### P1 · 行动计划逐日推演过程（新）
- 产能风险处置行动计划每条日行动补 `rationale`：该日为何做此动作（触发指标越线值 + 该动作对 gap 的收窄量 + provenance 溯到源对象），复用 `decision_play` 的 triggers/试算收窄逻辑（非新造·R13 每步可溯）。

---

## §4 SEAM 验收（接缝驱动·活系统亲验·非各半绿）
1. **D1+E1 组合**：生成全基地 equipment 后，`gap_attribution({scope:{baseId:"hefei"}})` → 断言返回**合肥专属树**·L2 设备OEE 瓶颈叶**非空**（drillValue=合肥真设备 oee_current）·勾稽 Σ子+residual=父·每叶 provenance 可溯。**活系统 curl 亲验**（我复验必跑）。
2. **D2**：`scope:{baseId:"合肥"}` 与 `"hefei"` 返回同树（归一生效）。
3. **F1**：`base_capacity_outlook({baseId, horizon:90})` → 四线（产能/在产/未来单/预测）齐 + 缺口标记 · 改 Order.due/DemandSegment.p50 → 前瞻真变（非写死）。
4. 四包全绿 + 金值同步（对象数）+ 本体回写。

---

## §5《本体引用与影响》（铁律0）
- **对象类型**：`Equipment`/`EquipmentOEE`（D1 全基地铺开）· `Base`(§B·displayName 归一源) · `Order`(bases/due) · `Metric`(seg_attain_ess·归因目标) · `CausalFactor`(因果叶) · `DemandSegment`(p50 预测) · `WorkOrder`(在产)。
- **链路**：**归因链**（§3）`Metric.gap → 结构反向分摊(Order→基地→设备OEE/物料瓶颈) → CausalFactor`；本 PRD 补 D1（设备叶数据源）+ E1（base 作用域旁路）。**产能推演链** `capacity_forecast(per-base) → 前瞻投影(F1)`。
- **事件**：`gap.attributed`（已有·scope 版复用）；F1 无新事件（同步查询）。
- **不变量**：R6 确定性（equipment 哈希派生·前瞻无时钟）· R13 provenance（每叶/每日行动可溯）· R14（设备数/系数非内联·走 BASE_REGISTRY/SolverParam）· 勾稽（Σ子+residual=父 gap 不破）。
- **断点**：**新登 G-CAPACITY-BASE-DATA**（Equipment/OEE 仅常州→逐基地 OEE 根因不可用·D1 闭）+ **G-GAP-SCOPE**（gap_attribution 无 base×factor 作用域·E1 闭）。回写 §2E（求解器 scope）+ §8（两断点）+ §4（Equipment 数据流全基地）。

## §6 派发建议
- **一个 dev 整单做 D1+D2+E1**（同属 gap_attribution 根因树可用性·跨数据+引擎但同一特性·文件边界：battery.ts 生成器 + service.ts gapAttribution + 金值测）。
- F1（前瞻）+ P1（逐日过程）可作**第二张 WO**（前端卡片 + capacity outlook·依赖 D1 数据但接缝独立）。
- 复验头号判据：**活系统 `gap_attribution(scope:hefei)` 真出合肥非空设备叶**（绿测试≠能用·亲手真跑）。
