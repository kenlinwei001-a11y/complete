# PRD · 场景启动器问题「接地化」+ 空结果→认领补数据

> 状态：设计（待 dev） · 分支 `claude/vigilant-knuth-b1nmxn` · 遵 R14(数据驱动零硬编码) / R13(可溯) / 不作假 / R-PRD
> 用户亲定：**「场景启动器点启动后反馈空无法推演的，要一个『认领』按钮触发自动合成数据并跳转对应页；问题要基于数据库+本体切片+意图预设的现状展示可回答的卡片，不要宽泛不具象的（如『推荐哪个经营方案？』），相对时间要补具体值（如『本月』要给具体月份）。」**
> 关联：`GROWTH-WORKLIST-HUMAN-FILL`（空结果→认领→人工触发补数据，是同一 human-gated fill 流的启动器侧入口）。

## 0. 根因实证（真起 datacore·curl·`scenarios-catalog.ts` 20 卡）

| 类 | 卡 | 实证 |
|---|---|---|
| **预设引用不存在对象** | **S11 换型排序优化** | 预设 `lineId:"常州·动力线-A"` —— 真实 Line 为 `LINE-changzhou/chengdu/…`（curl `objects?type=Line`），**该 lineId 不存在** → `changeover_sequence` 返 `infeasible:[]`+空 sequence（用户亲遇）。 |
| **缺必填槽→报错** | **S18 S&OP 月度平衡** | `slotPresets:{}` 无 month；真实 SOP 月份 2026-07…2025-10 存在、clock t0=2026-06-10 →「本月」=2026-06 本可答，但预设不传 → `sop_balance` **ERR:NOT_FOUND**（用户亲遇）。 |
| **抽象/宽泛问题** | **S05 经营方案比选** | 问句「推荐哪个经营方案？」无具象锚点（solver 能出 3 方案，但问题不具象·用户点名删/改）。 |
| **问句含相对时间未解析** | S03「这天」· S08「下周」· S18「本月」· S19「Q2」 | 问句字面相对时间，未在卡面解析为具体值（S19 预设有 2026Q2 但问句只说 Q2）。 |
| **部分覆盖（诚实）** | S19 季度缺口 | `residualGap` 非空=缺口未被对策覆盖（诚实·非 bug·但应提示补杠杆）。 |

**结论**：`SCENARIO_CATALOG` 的 presetContext/triggerQuestion 是**出厂硬编码**，未对当前租户真实数据（对象实例 + sim-clock + 本体切片 + intent 槽位）校验接地 → 引用死对象（S11）或缺参报错（S18）→ 启动即空/无解，无补救入口。

## 1. Part A · 问题接地化（根因·R14 数据驱动）

**原则**：启动器卡 = 「对当前 (数据库 ∩ 本体切片 ∩ 意图预设) 现状确实可答」的问题。接地在**服务端 `GET /b/v1/scenarios` 下发时按租户真实数据求解**，非前端、非硬编码。

对每张卡：
1. **对象接地**：`presetContext.selectedObjects[].objectId` 必须 resolve 到租户真实实例（查对象库）。不存在 → **自动替换为同类型真实首选实例**（S11 `常州·动力线-A`→`LINE-changzhou`），或标记该卡 `groundingGap`（→ Part B）。
2. **相对时间解析**：问句/预设的「本月/下周/这天/本周/Q?」由 **sim-clock 解析为具体值**注入 slotPresets 与问句文案（S18 month=`2026-06`；S03 具体 day；S08 week 区间；S19 quarter=`2026Q2`）。缺必填槽（S18 month）**必补**。
3. **问句具象化**：抽象问句改为具象、决策导向、含解析后参数：
   - S05「推荐哪个经营方案？」→「保毛利还是保规模？给 3 方案比选 + 管理动作」（或按 intent 槽位具象）。
   - S18「本月产销平衡到哪一步了？」→「2026-06 产销平衡到哪一步了？」（月份由 clock 注入）。
   - S03「常州物料齐套为什么这天越线？」→「…在第 N 天越线（具体日）」。
4. **可答性过滤**：接地后仍不可答（引用对象类型在租户根本无实例）→ 卡**不进"可推演"区**，改入"待补数据"区（Part B），诚实不展示为可点。

## 2. Part B · 空结果 → 认领补数据（human-gated·复用 GROWTH-WORKLIST）

启动某卡后，若答案为**空/infeasible/NOT_FOUND/residualGap>阈**（数据缺）：
- 答案坞渲染 `<GapCard>` 变体，含 **「认领并补数据」按钮**（非自动补·守用户"人点击后再触发"）。
- 点认领 → 登记 `WorklistItem(kind=DATA_GAP, fromQuestion=该卡问句, gapCode=推导自 infeasible/NOT_FOUND 的缺失实体)`（复用 `GROWTH-WORKLIST-HUMAN-FILL` 的 worklist）→ **跳转对应补数据页**（该实体的建模/上传/合成入口·带回跳锚点）。
- 补完 → 「继续推演」重跑原卡问句（复用 launcher launch）。
- 诚实：S11 型缺"该线的订单/换型数据"、S18 型缺"该月 SopVersion"——`GapReport.detail` 指名缺什么、补在哪。

## 3. 逐卡处置表（20 卡·彻查）

| 卡 | 问题 | 处置 |
|---|---|---|
| S01 4680-NCM 加20%六周能不能接 | 具象✓ | 保留（clock 校验 weeks 锚点） |
| S02 常州影响哪些订单 | 具象✓ | 保留 |
| S03 常州物料齐套为什么这天越线 | 「这天」相对 | 解析具体越线日注入 |
| S04 现金垫45亿过体检 | 具象✓ | 保留 |
| **S05 推荐哪个经营方案** | **抽象·点名** | **改具象决策问**（保毛利vs保规模+动作） |
| S06 采纳常州三班制 | 具象✓ | 保留（校验"常州·物料齐套·三班制"存在） |
| S07 待认证型号怎么排 | 稍泛 | 保留+校验有待认证型号 |
| S08 下周哪些订单缺料 | 「下周」相对 | 解析 week 区间注入 |
| S09 7月正极长协覆盖 | 具象✓ | 保留 |
| S10 哪些物料超储/欠储 | 可答（无参） | 保留 |
| **S11 下周订单怎么排少换型** | **预设死lineId+相对下周** | **lineId 接地真线+解析week**（元凶修） |
| S12 涂布良率为什么掉 | 具象✓ | 保留（校验涂布/常州） |
| S13 检修与交付高峰撞了怎么调 | 无锚点 | 保留+校验有检修/交付冲突，否则待补 |
| S14 缺口8万自产还是外协 | 具象✓ | 保留 |
| S15 电网公司F毛利过线 | 具象✓ | 保留（校验客户存在，否则接地真客户） |
| S16 商用车集团G还能接单 | 具象✓ | 同 S15 |
| S17 枣庄储能线值得投 | 具象✓ | 保留 |
| **S18 本月产销平衡到哪一步** | **缺month→NOT_FOUND** | **注入 clock 当前月 2026-06**（元凶修） |
| S19 Q2缺口用什么组合补 | Q2 未具年+residualGap | 问句注 2026Q2+residualGap>0 提示补杠杆 |
| S20 4680-NCM出口欧盟碳足迹 | 具象✓ | 保留 |

## 4. 《本体引用与影响》

- **对象**：`Scenario/ScenarioCard`（`scenarios-catalog.ts` + `GET /b/v1/scenarios`）· `presetContext`（§8 场景域 D8）· `SimulationClock`（时间解析 D10）· `WorklistItem`（Part B·复用 GROWTH-WORKLIST）· 各 solver（接地校验读对象库）。
- **链路**：`sys.scenario.launch`（ScenarioCard→presetContext→Query）新增**接地校验节点**（下发前对真实数据 resolve）；空结果→`AnswerBlock.gap`→认领→WorklistItem→补数据页（接 `sys.meta.change_loop` 发育闭环）。
- **事件**：复用 `growth.fill_claimed/fill_triggered`。
- **不变量**：R14（卡接地数据驱动·零硬编码死对象/死月份）· R13（空结果诚实标缺什么+补在哪·不假装可答）· R6（同数据同 clock 同接地结果确定）· R4（补数据人工闸）。
- **断点**：G-3（场景启动器 presetContext 注入 QOS）邻域——本单补"presetContext 未对真实数据接地"这一新残口。
- **回写**：改场景卡接地机制 + 空结果补救链路 → 回写 `SYSTEM-ONTOLOGY.md` §8 场景域/G-3 + §3 sys.scenario.launch（加接地校验）；`pnpm ontology:slices`。

## 5. 验收（DoD·真起服务真点）

| # | 类型 | 断言 |
|---|---|---|
| C1 | curl | 接地:`GET /b/v1/scenarios`(demo) 每卡 presetContext.selectedObjects[].objectId 均 resolve 到真实例(对 objects 库校验·0 悬空);S11 lineId 为真线(LINE-changzhou 类·非"常州·动力线-A");S18 slotPresets.month 非空=clock 当前月。 |
| C2 | curl | 空结果不再死:S11/S18 启动(QOS 或 solver invoke 用下发后的接地预设)→ 不再 infeasible空/NOT_FOUND;若某租户真缺数据→返 gap 结构(gapCode+detail 指名缺失实体)非裸空/500。 |
| C3 | browser | 认领闭环:真浏览器启动一个数据缺的卡→答案坞出「认领并补数据」按钮→点→登记 WorklistItem 且跳转对应补数据页(带回跳)→(补后)「继续推演」重跑出真答案。截图。 |
| C4 | browser | 问句具象:启动器无抽象问句(S05 已改具象)、无未解析相对时间(S18 显具体月份 2026-06 非"本月")。逐卡问句含具象锚点。 |
| C5 | gate | 回写§8/G-3/§3+ontology:slices 绿;四包 build/test 绿;新增卡接地校验单测(死对象/缺月→接地或标 gap·R6 同 clock 同结果)。 |

## 6. 诚实边界
- 接地"自动替换真实首选实例"仅用于出厂 demo 卡的健壮性；真租户自建场景仍以其自配 presetContext 为准（校验不 resolve 则标 gap 引导补，不静默换）。
- Part B 的"补数据"对 SOFT 缺→合成正门(PROVISIONAL·标)、HARD 缺真实业务→真人导入(DataRequest)——沿 GROWTH-WORKLIST 既定 HARD/SOFT 分流，人工闸。
