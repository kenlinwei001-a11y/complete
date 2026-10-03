# AUDIT · UNIT-DICT-ASYMMETRY 取证与裁决建议书

- 基线：`origin/claude/verify-reclaim-6` @ `3aacfd9f170cfb214a474713b1387899a7380bb7`
- 分支：`claude/handoff-wo-unit-dict-asymmetry-forensics`
- 画像：轻（只读取证，未跑 vitest/build）
- 工具纪律：全程 `/usr/bin/grep`（本机 grep 被包装成 ugrep --ignore-files 吞命中）

## 背景一句话

`POST /a/v1/ontology/object-types` 路由内有单位字典门（`apps/datacore/src/app.ts:3194-3196`）：
`p.unit && !dict.has(p.unit) ⇒ 400 未知单位`。
而种子类型定义经 in-process `ontology.upsertType` 直写（`apps/datacore/src/databuilder/service.ts:1156`、
`apps/datacore/src/pipeline/service.ts:141`），**绕过该门** ⇒ 种子里字典外单位入库无感，
事后任何人经 REST 重 upsert 同一类型即被门 400。'点' 只是其中一例。

---

## 取证 ① 全仓普查：字典外单位完整清单

字典成员（`apps/datacore/src/ontology-governance.ts:55`）：
`["万套","GWh","%","吨","天","元","万元","件","秒"]`（9 个）。

### 扫描面与金丝雀

```
grep -rn "unit: *['\"]" --include=*.ts/tsx/js .   # 573 行原始命中
```

金丝雀（字典内单位命中数，证明扫描面没瞎）：

| 字典内单位 | 全仓字面量命中 | 其中本体 PropertyDef 上 |
|---|---|---|
| % | 166 | 2（battery.ts:1098 health_score；:1187 MaterialBalance.coverage 多行块） |
| 万套 | 53 | 0（"万套/年"是另一个字符串，不算） |
| 天 | 19 | 3（battery.ts:1137 everyDays、:1138 offsetDays、:1297 tn） |
| 元 | 12 | 1（battery.ts:1396 OrderLine.unitPrice） |
| 件 | 6 | 1（battery.ts:1393 OrderLine.qty） |

门相关面 = **本体类型 PropertyDef.unit**（门只校验 type upsert 的 `properties[].unit`，
数据行/solver 配置/mock 里的 unit 是属性**值**，门咬不到）。

### Tier 1 · 门相关不对称清单（9 条 · 5 个字典外单位 · 全部在 battery.ts）

| # | 类型.属性 | 单位 | 文件:行 |
|---|---|---|---|
| 1 | Process.requiredThroughput | 电芯/天 | apps/datacore/src/synthetic/battery.ts:1075 |
| 2 | Equipment.mtbf | h | apps/datacore/src/synthetic/battery.ts:1096 |
| 3 | Equipment.mttr | h | apps/datacore/src/synthetic/battery.ts:1097 |
| 4 | Cadence.intervalCount | 个 | apps/datacore/src/synthetic/battery.ts:1141 |
| 5 | DemandSegment.demandWanPerYearP50 | 万套/年 | apps/datacore/src/synthetic/battery.ts:1151 |
| 6 | DemandSegment.demandWanPerYearP90 | 万套/年 | apps/datacore/src/synthetic/battery.ts:1152 |
| 7 | SopVersionRow.demand | 万套/年 | apps/datacore/src/synthetic/battery.ts:1271 |
| 8 | SopVersionRow.supply | 万套/年 | apps/datacore/src/synthetic/battery.ts:1272 |
| 9 | AdoptedMitigation.eff | 点 | apps/datacore/src/synthetic/battery.ts:1296 |

（类型归属由各 `const *Props` 数组追到 `plain()/plainD()/显式注册` 调用点确认：
battery.ts:2489 Process、:2490 Equipment、:2508 Cadence、:2509 DemandSegment、
:2520-2527 AdoptedMitigation、:2528 SopVersionRow。）

**'点' 不是孤例**——REST 重 upsert Process/Equipment/Cadence/DemandSegment/SopVersionRow
任一类型同样 400。

### Tier 2 · 门咬不到的字典外单位（列出以防误收进同一工单）

- **migrations SQL 默认值**：`grep -rni unit apps/datacore/migrations/` = **0 命中**
  （金丝雀：同目录 `grep -rl "CREATE TABLE"` = 37 文件命中，扫描面有效）。
- **solver 硬编码**：`apps/datacore/src/solvers/chain-impediment.ts:134` `unit: "电芯/天"`
  —— 与 battery.ts:1075 同词但是**独立硬编码**，被
  `apps/datacore/test/chain-impediment-seam.test.ts:277` `expect(i.evidence.unit).toBe("电芯/天")`
  咬死（改 seed 的 PropertyDef **不会**红它，改 solver 那行才会）。
- **agentcore mocks**（B 侧假数据，不经 datacore 门）：`apps/agentcore/src/mocks/clients.ts`
  的 `套`(×3)/`小时`/`批`/`万套/窗口`。
- **数据行单位**（物料 kg/㎡/L、质检 mΩ/Ah/级、信号 元/吨 等，battery.ts:3805-4421 一带）：
  属性**值**非类型定义，门不校验。

---

## 取证 ② '点' 的语义定性

**量纲：0–100 风险张力指数上的「指数点」扣减量，不是百分比、不是评分。**

链：`params.risk.mitigations[factor][]` 配 `eff ∈ [7,15]`（battery.ts:515-545，如 提前备料 eff:12）
→ adopt_mitigation 执行器解出落库 `AdoptedMitigation.eff`
→ `adoptedMitigationIndex`（apps/datacore/src/solvers/risk.ts:522）按 (baseId,factor) 索引
→ `tensionSeries`（risk.ts:410）：`if (d >= tn) v = round(Math.max(0, v - mitigation.eff), 4)`，
被减数 v 是 `saturateTension(...)` 产出的 **0–100 张力指数**（risk.ts:367 注释「0–100 张力指数不越界」）。

**前端显示**：
- 方案对比矩阵（apps/frontend-shell/src/views/RiskBoardView.tsx:1935-1939）表头写死
  「**见效(pp)**」，`{p.eff}` 裸数字渲染 —— pp（百分点）与「点」同义，无单位字符串拼接。
- `card.adoptedMitigation`（risk.ts:675 下发）前端 **0 消费方**（grep frontend-shell 零命中）。
- 「点」字串会上屏的口子只有通用属性渲染：
  `WhatIfView.tsx:432`（`· ${p.unit}`）与 `ProcessInspectPanel.tsx:212`（`{p.unit ?? "—"}`）
  —— R14 设计就是后端下发什么前端显示什么。

---

## 取证 ③ 两种修法爆炸半径对账

### 修法 A：UNIT_DICTIONARY 加成员

**消费方全清单**（grep UNIT_DICTIONARY 全仓，追到调用条件）：

1. `ontology-governance.ts:55` 定义本体。
2. `app.ts:3194-3196` 唯一门：`POST /a/v1/ontology/object-types` 逐 property 校验。
3. 测试：`apps/datacore/test/ontology-governance.test.ts` G10（:313-336）——
   放行样例用「吨」（字典内，加成员不影响）、拒绝样例用「光年」（加「点」后仍字典外，照样 400）。
   **加「点」或加全部 5 个单位，G10 均不红。**
4. 字典 join 串只出现在 400 错误消息里，全仓无快照断言
   （`grep "万套/GWh"` 仅命中定义行与 agentcore numerics.ts 无关正则）。
5. docs：`docs/PRD-addendum-ontology-governance.md:83` 把字典写成
   「"万套"|"GWh"|"%"|"吨"|"天"…」**开放式枚举**，扩成员与 PRD 表述不冲突。

**语义漏洞评估**：字典是 lint 白名单，扩枚举成员是**有意放行**而非开口子；
不放行任何未列举单位。唯一代价：未来拼错「点」类词时门不再拦——可接受。

**注意**：只加「点」= 只修 1/9 条，其余 4 个单位（万套/年、电芯/天、h、个）的 REST 重 upsert 照样 400。

### 修法 B：改种子单位向字典收敛

**会红什么**（逐类核过）：

- 断言「点」的测试：**0 个**（grep `['"]点['"]` apps/datacore/test 零命中；
  金丝雀：G10「光年」断言命中，扫描有效）。
- R6 确定性金值：AdoptedMitigation **出厂零实例**（battery.ts:2519 注释），
  对象指纹类测试（synth-validation-lite.ts fingerprint / synthetic.test.ts SY1 rerun deep-equal）
  只哈希**对象实例**，不含类型定义字节 ⇒ 不红。
- 类型计数金值（demo-chain-provenance.test.ts:89 `toBe(94)`）只数个数 ⇒ 不红。
- risk_timeline 金值：eff/tn 数值进曲线，**unit 字符串不进求解器输出** ⇒ 不红。
- 前端：WhatIfView/ProcessInspectPanel 改显或缺省显示，纯展示差异。

**即 B 的测试半径也是零** —— 但 B 的代价在语义：
- `点`→`%`：错。eff 是指数点不是百分比（矩阵表头自带 pp，改成 % 反而与表头打架）。
- `点`→去掉 unit：丢 R14 单位元数据（「中文名/单位必须随响应下发」），
  WhatIf 面板该属性从此无单位显示。
- 若把 B 推广到全部 9 条：`万套/年`→`万套` 丢失年化口径（description 里专门区分了
  年度口径 vs S&OP 月度台账口径）；`h`→`天` 量级错；`电芯/天`/`个` 字典里无对应物可换。
  ⇒ **B 对其中 4 个单位根本无字典成员可收敛，必须靠 A 兜底。**

---

## 取证 ④ 裁决

**裁决问句**：种子类型定义实际使用的 5 个字典外单位（万套/年、电芯/天、h、个、点），
是扩 `UNIT_DICTIONARY` 覆盖它们，还是改 9 处种子 PropertyDef 单位向现有 9 成员收敛？

**推荐方案：修法 A——扩字典，且一次扩齐 5 个**（`["万套/年","电芯/天","h","个","点"]` 追加进
`ontology-governance.ts:55`），理由：

1. **语义对**：5 个单位全是种子里有意的口径区分（年化 vs 月度、小时 vs 天、指数点 vs 百分比），
   字典 PRD 本就是开放式场景包枚举；改种子是拿错误精度换门的欢心。
2. **半径小**：A 的爆炸半径实测为零红（唯一消费门 + G10 双样例均对加成员免疫）；
   B 虽也零红，但对 9 条里的 4 条无成员可换，做不彻底，还得回头做 A。
3. **方向对**：门的作用是拦「乱造单位」，不是拦「种子已在用的合理单位」——
   现状等于门咬不到直写路径却反咬 REST 重放，字典向事实收敛才消掉这条不对称。

**若仓主只批最小单**：先只加「点」闭掉本单病灶，其余 4 个另开一张小单补齐——
但须知晓 REST 重 upsert 那 5 个类型在补齐前照样 400。
