# 裁决材料 · 设备 OEE 的单一出处（`G-OEE-DUAL-TRUTH`）

> **给仓主的一页纸。** 取证方 = WO-OEE-SSOT（纯只读 + 写文档 + 写门，未动 `apps/**` `packages/**` 一行）。
> **本单不替你选**，本单只把「选错了会怎样」量出来，让这个选择从今天起是**能下的**。
> 复算命令（无需 vitest／无需 build）：见 §7。

---

## 0. 一句话

TRACE「🔶 等你裁决」第 2 条写的是**两套**口径。实测是 **三套**，三套算出**三台不同的「最差设备」**，
两两「最差 10 台」名单重叠 **0/10 · 0/10 · 1/10** —— 这不是精度差异，是**指向不同的设备**。
而且：**无论你最后选哪一套，「三套并存且互不知情」本身已经是缺陷**，因为屏上今天就在同时显示它们、且不标明。

---

## 1. 三套口径 · 实测（demo 真实入参 `seed=42, scale="S"`，780 台设备）

| | 口径 | 实现位置（`file:line`） | 真值怎么来 | **最差设备** | 值域 |
|---|---|---|---|---|---|
| ① | **铭牌三原子** | `apps/datacore/src/synthetic/battery.ts:3939-3941` 生成；`apps/datacore/src/solvers/capacity.ts:48` 计算 `oeeA×oeeP×oeeQ` | 设备台账静态值（rngTopo 播种，之后**从不更新**） | `LINE-WS-changzhou-formation-winding-E2`<br>**0.769233** | [0.7692, 0.8976] |
| ② | **时序聚合快照** | `apps/datacore/src/synthetic/battery.ts:2880` 规格 `oee_daily_7d`；`apps/datacore/src/timeseries.ts:322` 物化写回 `Equipment.oee_current` | `oee:equip` 日序列（`battery.ts:2854`，mean 0.78 / noise 0.04 / 含检修+周末效应）近 **7 日按 output 加权平均** | `LINE-WS-jinhua-slitting-winding-E1`<br>**0.710781** | [0.7108, 0.8024] |
| ③ | **IoT 日粒度事实表** | `apps/datacore/src/synthetic/battery.ts:4787` 产出 `equipmentOEEs`（**5460 行** = 780 台 × 7 天）；类型定义 `battery.ts:2435` | 事实表**自带**一组 `availability/performance/quality`，且 `oee = a×p×q`（前 200 行 0 例外） | `LINE-WS-xinyang-formation-coating-E1`<br>**0.776429** | [0.7764, 0.8750] |

**分歧幅度（②−①，逐台）**：平均 `0.0814` · 中位 `0.0821` · 最大 `0.1666`（即 8 个百分点量级，不是小数点后第三位）。
**排名互毁**：① 的最差那台，在 ② 里排 **731/780**（属最好的一档）；② 的最差那台，在 ① 里排 **637/780**。

**同一台设备，三个数（且三组 a/p/q 也不是同一组）**：

```
LINE-WS-jinhua-slitting-winding-E1
  ① 铭牌   oeeA×oeeP×oeeQ = 0.952 × 0.921 × 0.981 = 0.860133
  ② 时序   oee_current                            = 0.710781
  ③ 事实表 EquipmentOEE.oee 均值 = 0.854857（该设备 7 行，样例 a/p/q = 0.94/0.89/0.97）
```

### 1.1 病灶在**接缝**，不在任何一个模块内部

`Equipment.oee_current` 这**一个字段**有**两个写入方**，而且它们写的是**两个不同定义的量**：

```
播种期  battery.ts:3958   if (eq.oee_current === undefined) eq.oee_current = round(oeeA×oeeP×oeeQ, 3)
                              ↓  （780/780 台实测全部相等 —— 本单金丝雀 B 咬住了这一步）
物化期  timeseries.ts:349 obj.props.oee_current = round(weighted_avg(oee:equip 近7日), 6)
                              ↑  **覆写**，并把 __prov.oee_current.source 改成 "TS_AGGREGATE"
```

第二个写入方**覆盖**第一个，于是「`oee_current` 是 A×P×Q 的合成值」这个前提在**运行时不成立**，
但代码里到处仍按这个前提写。**这就是本仓反复讲的「断在接缝、不在模块内部」。**

### 1.2 一条被这个接缝证伪的既有记账（**必须回写**）

`packages/contracts/src/capacity-factors.ts:100` 写着：

> 「可用率 OEE-A 可由 `oee_current /(oeeP × oeeQ)` 反解，**不因 ③ 改指而丢失可解释性**。」

**实测这句话在生产数据下不成立**（780 台全量）：

| | 反解值与真 `oeeA` 的绝对误差 |
|---|---|
| 用 TS 物化后的 `oee_current`（= 生产实际状态） | 平均 **0.0901** · 中位 0.0911 · 最大 0.1798 |
| 对照组：用播种期快照 `round(A×P×Q,3)` | 平均 **0.000293** |

即：**反解在 TS 物化之前成立、物化之后失效**。误差 9 个百分点，`oeeA` 本身值域才 0.90–0.96 —— 反解出来的是另一个数。
（诚实边界：反解值没有超过 1，所以不会以"物理不可能"的形式自曝；它只是**安静地错**。）

**形态（铁律 0.6 句式）**：*「同一段注释里写了『回填 = A×P×Q』和『时序也持续物化它』两句都对的话，
却把它们读成了『所以它一直等于 A×P×Q』—— 我用『两句都对』当作『它们一致』的证据，而前者并不度量后者。」*

---

## 2. 各屏在用哪一套（追到触发条件，不止 grep）

| 屏 / 接口 | 用的口径 | 调用链（追到触发条件） |
|---|---|---|
| **产能派生 DAG**（`views/capacity/CapacityDerivationDag.tsx:178`） | **②** | 前端请求 `bottleneck_matrix{dataMode:"LIVE"}` → 后端 `solvers/capacity.ts:264 oeeAvg = mean(equipmentOee(props))` → `equipmentOee` **快照优先**（`capacity.ts:46-48`：`oee_current>0` 就直接返回，否则才乘 A×P×Q）。**生产 780/780 台都有 `oee_current` ⇒ 乘积分支恒不进入** |
| **全局沙盘 / 项目推演 拨杆**（`lever-slider-oee_current`） | **②** | `solvers/service.ts discoverCapacityLevers` 只收 `CAPACITY_FACTOR_BINDINGS` 里 `writable:true` 的落点 → ③ 号因子 = `Equipment.oee_current`（`capacity-factors.ts:52`）。④⑦（`oeeP`/`oeeQ`）标 `writable:false`，**拨了对 Σp50 零影响**（`test/lever-binding-drift.test.ts:142` 已咬） |
| **供需缺口归因 / 根因树**（`DashboardView`·`ProvenanceDag`·`cockpit-gap-attribution-dag`） | **②** | 因子 `cf-cap-equipment-oee` / `cf-capacity-short` 在数据里自带 `drillField:"oee_current"` + `drillPick:"min"`（`battery-extended.ts:431,465`），**查询期**由 `solvers/dynamic-drill.ts` 解析 |
| **物理拓扑屏**（`views/sim/PhysicalTopologyView.tsx` + `physicalTopology.ts:775,782`） | **③** | 直读 `EquipmentOEE` 对象：`util = Σ实际工时/Σ计划工时`、`oee = avg(EquipmentOEE.oee)`；取不到时诚实回落 `placeholder`（**这一屏的做法是对的，见 §5**） |
| **流程巡检属性表**（`views/process/ProcessInspectPanel.tsx:210`） | **①+②同屏** | 后端 `battery.ts:2312 withPropDisplayNames` 把中文名塞进 `PropertyDef.displayName` 下发。`Equipment` 上四个 OEE 名并列：`OEE可用率`/`OEE表现性`/`OEE质量率`/`OEE`。**前三个乘起来 ≠ 第四个**，而屏上没有一个字说明为什么 |
| **产能因子本体面板**（`views/capacity/factorOntology.ts:51,91`） | **①名 + ②值** | 圈号 ③ 在前端叫「**可用率 OEE-A**」（口径①的分解原子），而 `BN_FACTOR_TO_MARK["设备OEE"]="③"` 把后端那个 **口径②** 的数映到同一个圈号；③④⑦ 并排展示为乘法分解。**本单新门扫出的唯一存量违规就是它** |

> ⚠️ **反向记账（不许当成「② 与 ① 在产能链里打架」）**：在**产能链内部**，`equipmentOee()` 是唯一出入口、快照优先，
> 所以 ①的乘积分支属「**接了线没数据**」（生产恒不进入），不是「两条打架的可写路径」——
> `capacity-factors.ts:84` 这句判断是**对的**，本单复核确认。真正打架的是**跨屏**（②/③/①名 各据一屏）与**跨写入方**（§1.1）。

---

## 3. 三套各自答的是哪个问题（不是谁对谁错，是量的定义不同）

| 口径 | 它回答的问题 | 什么场景下它是**对的那一个** | 它答不了什么 |
|---|---|---|---|
| ① 铭牌 A×P×Q | 「这台设备**设计上**能干到多好？」 | 选型 / 投资论证 / 产能规划基线 / 与供应商对标 —— 需要一个**不随本周波动**的常量 | 「今天为什么少产了」——它一年不变 |
| ② 时序 7 日加权 | 「这台设备**最近这一周**实际跑成什么样？」 | 瓶颈定位 / 推演拨杆 / 缺口归因 —— 需要**跟着世界变**的值，拨它下游才会动 | 「差在可用率还是质量率」——它是合成后的单值，不可分解 |
| ③ 日事实表 | 「**哪一天**、在哪条线、A/P/Q 各是多少？」 | 明细追溯 / 班组考核 / 拓扑逐格看板 —— 需要**可下钻到天**且**自带分解** | 跨设备横比要先定聚合口径（本单按 7 日算术均值，事实表并未规定） |

**关键判断**：③ 在信息量上**严格包含**①与②所需的一切（它有 a/p/q 三原子，也有日粒度可做任意窗口聚合），
只是今天没人从它派生出①②。这一点决定了 §4 的推荐。

---

## 4. 选任一套的连坐面（**列出来的，不是估的**）

> 判据：下列文件我逐个打开确认过引用点；测试列的是**会因口径改变而必须改断言**的，不是「凡提到 OEE 的」。

### 选项 A ·「② 时序快照」当权威（= 承认现状，把 ①③ 降级为参考）
- **代码改动最小**：`Equipment.oee_current` 已是产能链/拨杆/归因的唯一落点，无需改引擎。
- 要改的：`packages/contracts/src/capacity-factors.ts:100` 那句**已被证伪**的反解说明（§1.2）；
  `apps/datacore/src/synthetic/battery.ts:3958` 的播种期回填要么删、要么明确标注为「TS 物化前的临时占位」。
- 屏上会变的数字：**0 个**（这就是现状）。
- 会红的测试：**0 个**。
- **代价**：①③ 继续在屏上以「OEE可用率/OEE表现性/OEE质量率」「EquipmentOEE.oee」的名义显示**互不一致的数**，
  §2 表里那两行同屏混用**原样保留**。等于把缺陷合法化。

### 选项 B ·「① 铭牌三原子」当权威（让 `equipmentOee` 真走乘积分支）
- 要改的文件（逐个已确认引用点）：
  `apps/datacore/src/solvers/capacity.ts:46-48`（去掉快照优先）· `apps/datacore/src/vle-oracle.ts:105-107`（同形，另一份拷贝）·
  `apps/datacore/src/synthetic/battery.ts:2880`（撤 `oee_daily_7d` 对 `oee_current` 的物化）·
  `packages/contracts/src/capacity-factors.ts:52-58`（③ 拆成 A/P/Q 三个可写落点，④⑦ 改回 `writable:true`）·
  `apps/datacore/src/synthetic/battery-extended.ts:431,465`（`drillField` 改指）· `apps/agentcore/src/agent/sim-planner.ts:110`（意图→落点映射）
- 屏上会变的数字：**产能派生 DAG 的 OEE 张力 · 沙盘/项目推演的 OEE 拨杆当前值 · 供需缺口归因的 `oee_loss` 驱动值 · 根因树 L2 设备叶的 `drillValue`**（平均移动 8 个百分点，最差设备**换人**）。
- 会红的测试/门（已逐条定位断言行）：
  `apps/datacore/test/lever-binding-drift.test.ts:139`（`expect(equipmentOee({...oee_current:0.76})).toBe(0.76)` —— 直接咬快照优先）·
  同文件 `:119,:142`（反证「拨三原子零影响」，改后前提反转）·
  `apps/datacore/test/dynamic-drill-resolve.seam.test.ts:191-196`（现算 `oee_current` 最低那台并断言 `drillValue`）·
  `apps/datacore/test/ceo-data2-seam.test.ts:346`（`expect(drillField).toBe("oee_current")`）·
  `apps/datacore/test/prov-drillfield-truth.test.ts:431`（路径清单含 `Equipment.oee_current`）·
  `apps/datacore/test/timeseries.test.ts`·`apps/datacore/test/derive-fields.test.ts`（`oee_daily_7d` 物化）·
  `apps/datacore/test/synth-validation-lite.test.ts:24-31`（FULL/LITE **唯一**允许差异面就是 tsAgg 物化目标属性）·
  `apps/datacore/test/capacity-atom-factor.test.ts:44-45`·`apps/datacore/test/gap-attribution.test.ts`·`apps/datacore/test/supply-demand-gap-attribution.test.ts`·
  `apps/frontend-shell/test/caplive-cockpit.test.tsx`（6 处 `lever-slider-oee_current`）·`f19.project-sim-whatif.test.tsx`（5 处）·
  `live-disposition.test.tsx:54`·`global-sim-cockpit.test.tsx:125-130`·`risk-inference-process.test.tsx:109`·`dash-supply-demand.test.tsx:37,58`
  门：`scripts/check-lever-binding-drift.mjs`（第 17-18、155 行明确断言 ③=`oee_current`、④⑦ 不可写）·`scripts/check-lever-prop-resolvable.mjs`
- **额外代价（这条最硬）**：铭牌值**从不更新** ⇒ **拨杆拨不动世界、推演变成常量**。
  本仓已经为「设备层拨杆永远反推不出候选」建过门（`G-LEVER-BINDING-DRIFT`），选 B 等于把那个断点原样请回来。

### 选项 C ·「③ 日事实表」当权威（其余两套从它派生）
- 要改的文件：新增一条派生（`Equipment.oee_current ← agg(EquipmentOEE.oee)`，落点与今天相同）+
  `Equipment.oeeA/P/Q ← agg(EquipmentOEE.availability/performance/quality)`；
  撤 `battery.ts:2880` 的 `oee:equip → oee_current` 物化与 `battery.ts:3958` 的播种期回填（**两个写入方合并成一个**）。
  引擎侧 `capacity.ts` / `vle-oracle.ts` / `capacity-factors.ts` 的落点**都不用动**（仍是 `oee_current`）。
- 屏上会变的数字：与 B 同一批屏，但**移动幅度小得多**（③ 与 ② 的最差 10 台已重叠 1/10、值域也更接近），且移动后**三套自动一致**。
- 会红的测试：**B 列表里与「口径值」相关的那些同样会红**（数值断言基本都是现算的，`dynamic-drill-resolve.seam.test.ts` 那种现算式会自动跟随）；
  但**结构性断言全部保留**（`drillField` 仍是 `oee_current`、③ 仍 `writable:true`、拨杆仍拨得动），
  故 `check-lever-binding-drift.mjs` / `sim-planner.ts` / 前端 6 个 `lever-slider-oee_current` 测试**不受影响**。
- 另需处理一个已知规模坑：`physicalTopology.ts:303` 记着 `type=EquipmentOEE` 分页 **5460 行只拿得到 1000 行（18%）**——
  ③ 若升为权威，这条必须先修，否则派生会拿不全数据。

---

## 5. 推荐 —— **选 C（③ 当权威），并同时落 §5.1 的「屏上必须标明」**

**论据（按分量排序）**：

1. **只有 ③ 同时具备「会变」和「可分解」。** ① 不变（推演拨不动）、② 不可分（问「差在哪个因子」答不出）。
   ③ 两者都有 —— 这不是偏好，是信息量的**包含关系**（§3）。
2. **它把「一个字段两个写入方」这个真正的病根消掉。** A 保留病根、B 换个病根，只有 C 让 `oee_current` 变成
   **单一派生**（`EquipmentOEE → agg → oee_current`），与本仓 `oee_daily_7d` 已有的派生机制同形，不新造机制。
3. **它保住已经付出的代价。** `G-LEVER-BINDING-DRIFT` 的修复（③ 绑 `oee_current`、④⑦ 标不可写）、
   `WO-DYNAMIC-DRILL-RESOLVE` 的查询期解析、6 个前端拨杆测试 —— 在 C 下**全部继续有效**，在 B 下**全部要返工**。
4. **它让 §1.2 那句反解说明重新成立**：a/p/q 与 oee 同源于一张表，`oee = a×p×q` 逐行自洽（实测前 200 行 0 例外），
   分解的可解释性是**真的**，不是注释里许诺的。

**唯一要付的代价**：屏上数字会动一次（幅度小于选 B），以及先修 `EquipmentOEE` 的分页 18% 问题。

### 5.1 不等裁决就该做的那一半（**已在本单交付**）

无论 A/B/C 哪一个，**「同屏两个数打架而用户不知道」都是错的**。故本单已建门
`scripts/check-oee-ssot.mjs`（`oee-ssot:check`）：

> 同一个屏上出现 ≥2 套 OEE 口径 ⇒ **每一套都必须在可上屏文本里标明自己是哪一套**（注释不算，注释不上屏）。

**这道门今天就有价值**：裁决可能要几周，而 §2 表里最后两行**此刻**就在误导人。
门的正面样板已经在仓里：`views/sim/physicalTopology.ts` 逐格发 `source:"EquipmentOEE"` +
`formula:"OEE = avg(EquipmentOEE.oee) over N 条"`，取不到就诚实回落 `placeholder` 而**不补 0**。
**其余屏照抄这个做法即可。**

### 5.2 若你选 A（维持现状）—— 那 §5.1 就从「加分项」变成「必做项」
因为 A 等于承认三套长期并存，屏上不标明就是长期误导。此时应把 `factorOntology.ts` 圈号 ③ 的名字
从「可用率 OEE-A」改为「设备OEE（时序 7 日加权）」，并把 ①的三原子在属性表上标注「铭牌值·不随生产更新」。

---

## 6. 本体引用与影响

- **对象类型**：`Equipment`（属性 `oeeA`/`oeeP`/`oeeQ`/`oee_current`）· `EquipmentOEE`（链路 `oee_for_equip`，`battery.ts:2552`）· `CausalFactor`（`cf-cap-equipment-oee` / `cf-capacity-short`）
- **链路**：`oee:equip 时序 → oee_daily_7d@v1 → Equipment.oee_current`（写入方 2）· `battery 播种 → Equipment.oee_current`（写入方 1）· `Equipment.oee_current → equipmentOee() → bottleneck_matrix.设备OEE → 产能派生 DAG` · `EquipmentOEE → physicalTopology → 物理拓扑屏`
- **事件**：无新增。
- **不变量**：触 **R6**（确定性：本单全部实测均为同 seed 可复算）· **R12**（全建模对齐：同一业务量三处建模）· **R13/provenance**（`__prov.oee_current.source="TS_AGGREGATE"` 已如实记录，是 §5 第三条路可行的技术前提）· **R14**（口径由数据声明：`drillField`/`drillPick` 已在数据里，属正面样板）
- **断点**：新登 **`G-OEE-DUAL-TRUTH`**（§8）。相关已闭断点 `G-LEVER-BINDING-DRIFT`（选 B 会把它请回来）。
- **门**：新增 `oee-ssot:check`（§7）；受影响的既有门 `check-lever-binding-drift.mjs`、`check-lever-prop-resolvable.mjs`。

---

## 7. 复算（不需要 vitest / 不需要 build，单进程 node）

本单所有数字由**直接 import 生产源码**算出（`generateBattery(42,"S")` + `tsgen.genPoint` + 复现 `timeseries.ts:322` 的
`round(weighted_avg, 6)`），不是照公式重写、也不是读注释抄来的。两条金丝雀先自证工具：
① `entityRefFieldOf("Equipment")==="equipId"`；② **780/780 台**播种期 `oee_current` 必须逐台等于 `round(oeeA×oeeP×oeeQ,3)`
（不等 ⇒ 说明我读错了 `battery.ts:3959`，脚本 `exit 2` 报「工具坏了」而不是报数）。

门的复算：

```bash
node scripts/check-oee-ssot.mjs            # RC=0 干净（含豁免挂账明细）
node scripts/check-oee-ssot.mjs --census   # 每个屏触及哪几套、披露了哪几套
node scripts/check-oee-ssot.mjs --selftest # 金丝雀 C1–C5 + 起子进程实测 RC=0/1/2
node scripts/check-oee-ssot.mjs --explain apps/frontend-shell/src/views/capacity/factorOntology.ts
```

**诚实边界**：门量的是「屏上标没标」，**不量「三套口径该不该并存」**——后者就是本页要你裁的那件事。
另有一类屏门看不见（属性名由后端运行时下发，如 `ProcessInspectPanel`），已写进门顶注，需靠接缝测试补。
