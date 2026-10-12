# WO-PROP-REVIEW-V2 · 交付报告（传导规则业务评审 v2 · 实施单）

- **分支**：`wo-real-cells` → `claude/handoff-real-cells` · **tip = `24dae88ab`**
- **日期**：2026-09-17/18 · **评审核心判据（仓主原话）**：「推演推的是『变化』，不是『存量』」——
  一条边该进图，当且仅当它传导的东西**经常变**；排序尺子 = 场景敞口（单次金额 × 年频次）。
- **一句话结论**：评审 §4 实施顺序 ①②④⑤ + 形态② **全部落地并套件级验证**；
  ③⑦ 属引擎缺口、⑫⑭ 属业务裁决，连同 6 个待定档项**如实挂账交仓主**，一个不藏。
- **本体回写**：`docs/SYSTEM-ONTOLOGY.md`「评审 v2 · 落地段」落地①—⑤ + 诚实挂账段（铁律 0 已守）。

---

## 一、逐条裁决表（评审 §4 实施顺序）

| # | 评审条目 | 裁决 | 落地 | 关键证据 |
|---|---|---|---|---|
| ① | ㊶ `orderChurn→demandLoad` 符号+量级 | **翻负 +0.5 → −0.5** | ✅ | 变更里取消/缩水占多 ⇒ 在手需求被高估；事务扰动半截由既有 `demo_order_churn_to_line_split`(+0.7) 表达，不重复。全图第 2 条负系数。`weightRef: source_qty_relative` 与同格同链 `demo_order_demand_pressure` 同口径。triad 远端臂改窗口有向极值（轨物理实测） |
| ② | 库存 buffer 两条边 | **落** | ✅ | `coverDays` 经派生规格 `fgi_cover_days`（`qtyOnHand/dailyDemand`，COALESCE 兜底）落到世界格 = 库存侧第一个被读的量纲；`coverDays→demandLoad` **−0.5**（缓冲吸收）+ `drawdownPressure→demandLoad` +0.5（回补）。二拍环增益 0.6×0.5=**0.3<1** 阻尼收敛；`fg_of_model` 18 条已物化 ⇒ 零新 linkType |
| ③ | ⑦ Kingman 排队形状 | **引擎缺口，单独立项** | ⛔ 挂账 | 引擎今天只有 `delayTicks` 整数延迟，无形状参数 —— 不是改系数能做的事 |
| ④ | 物料环 3 条边 | **先补本体两链再落三边** | ✅ | 新链 `inspection_for_material`(30 条·影响向) + `balance_drives_po`(30 条·MRP 唯一一跳)；三边：替代料 `switchPressure→shortageRisk` **−0.3**（第 4 条负系数·负环自阻尼·delay1）、检验 `queueDays→shortageRisk` +0.2、缺口 `gapPressure→expeditePressure` +0.5·delay1。环增益 0.06≪1。世界格 6381/4189 **逐字节不变** |
| ⑤ | ㉜⑭ 方向 | **㉜ 反向落地；⑭ 只标不动** | ✅/⛔ | ㉜：`queuePressure→loadPressure` 反转为 `Equipment.loadPressure→Process.queuePressure`（系数 0.5 原样、规则 id 保留防 pg 幽灵行、key 改名 C36 同步）。**代价如实记**：`loadPressure` 入度 1→0 升格**第 7 个根源**（以前由 ㊜ 喂）。triad 远端臂重瞄 `Line.blockedPressure`。⑭ 评审措辞是「**可能**反」⇒ 交仓主（见挂账） |
| ⑥ | ⑫ 删或改接 | **交仓主** | ⛔ 挂账 | 出处已查清（§6 Q5），保留/删除是业务裁决 |
| ⑦ | 系数进配置 | **已闭（T1，先行单）** | ✅ | 55 条边系数单源 `C36.params`；披露夹具实测 `withCoefficientRef` **0 → 54**（54 = 55 发布 − 1 挂起还手），`refUnresolved=0`。前端面板断言已翻转为「守收口不回退」 |
| ⑧ | 形态②：15 个纯积分器 | **6 进表 + 4 defer + 5 本就真值支** | ✅ | 见下节 |

## 二、形态② 收口明细（评审：「消化速率 = 产能，这是有出处的」）

- **契约**：`StateVarDomain.max` 改 **nullable**（`null` = 无界声明；⛔ 不用 `Infinity`——zod 4 拒无限值、
  JSON 落 `null` 两条路实测都死）。引擎 `saturateToDomain` 加显式 null 支（不许 `?? Infinity` 混进有界路径）。
- **6 个进表**（λ 同一把尺：几何衰减、med 工期后残留 25% ⇒ `λ = 1 − 0.25^(1/med)`，工期全部实测）：

| 变量 | λ | 出处 | 档 |
|---|---|---|---|
| `queueDays` | 0.37 | 检验周期 med 3 天（n=30） | 实测 |
| `repairBacklog` | 0.75 | 维修工期 med 1 天（n=193） | 实测 |
| `qualificationQueue` | 0.22 | certHours med 134h=5.58 天（n=18） | 实测 |
| `inspectBacklog` | 0.37 | QualityLot 无工期属性，借检验周期 | **⚠ 暂定** |
| `handlingBacklog` | 0.75 | ExceptionEvent 无处置工期，借维修工期 | **⚠ 暂定** |
| `blockedPressure` | 共享 0.37 | 归压力族 [0,100]（评审：「名字是 0–100 压力指数，却无界累积到 945」） | 定档 |

  五个 λ 全部走 `C35.params` 新增 paramKey（R14 零内联）。
- **4 个 defer（理由各异）**：`clearanceQueueDays`（实测 **−8.9 天负值**可疑 ⇒ 交仓主，
  夹下界 0 = 把数据 bug 藏成正常）· `procurementDelay`/`deliveryDelay`（根源入度 0，非积分器）·
  `coverDays`（根源 + 真值支 + restPoint≠0 无出处）。
- **行为探针全绿**：纯衰减对照 7/7（100×(1−λ) 逐位相等）、1e6 无暗夹、
  `blockedPressure` 200→91.78 夹入带内 + saturations 记账；真实世界 tick1 `decayApplied` 含 6 个新 λ，
  `undeclaredStateVars` **16 → 10**。
- **种子超界如实归档**：`Line.blockedPressure` 实测 27.72–182.73（n=130，越界 49 条）——
  引擎 tick1 软夹 129 条逐笔记 saturations；臂2 入 EXCEPTIONS `[0,183]`；**种子生成式收口交仓主**（动种子=动 hash）。
- **triad G-ROOT-4 金值重测**：远端轨迹从「积分器累积 +0.2050→+0.4563」变为
  「tick2 峰 +0.0026 后逐拍衰减」（λ=0.37 + [0,100] 软夹 ⇒ 均衡不累积），断言 `farMax > 0` 不变。
- **披露层两处顺手修**（T6 引入的屏上矛盾，不收就是披露撒谎）：
  ① 面板「上界」`null` 渲染「无上界」（纯渲染分支，禁令 2 不触，**仓主可否决**）；
  ② C35 衰减规则表达式按 `decayRef.paramKey` **逐变量解析**（否则积压族 5 行「衰减出处」与「规则表达式」同行矛盾；压力族替换恒等）。

## 三、§6 五问答复

| 问 | 答 | 状态 |
|---|---|---|
| **Q1 引擎非线性？** | **纯线性**：`amount = coeff × sourceVal × factor`；仅有的非线性是还手边的 hinge 容忍线（deadband）与 `weightRef` 逐对权重（bom_cost_share 等 4 条）。要 Kingman 那种形状参数 = 引擎缺口（裁决表 ③） | ✅ 已答（引擎源码） |
| **Q2 缺口余量怎么组合补？** | 机械事实：`demandLoad→loadIndex` 0.6 × `loadIndex→utilPressure` 0.5 = **0.3 到达率**；系数值是种子作者的建模判断（loadIndex 实测 74–552）。**余量代表什么是业务裁决 ⇒ 交仓主** | ◑ 事实已答·裁决待仓主 |
| **Q3 覆盖天数口径？** | 已按 `qtyOnHand ÷ dailyDemand` 落地（`fgi_cover_days` 规格）。实测发现：in-sim `coverDays` **准静态**（派生于播种、无入边随拍重算）——它的动态需要 `drawdown→coverDays` 入边，**超出评审两条边的范围**，作形态②邻接 follow-up 挂账；口径签认交仓主 | ◑ 已落·口径待签 |
| **Q4 替代料可用比例？** | 待生产线给数。系数 **−0.3 是暂定档**：只取「方向对 + 量级不压过主链（短缺入边 0.8/0.6/0.5）」，**不拿系数凑大屏数** | ⛔ 待仓主 |
| **Q5 ⑫ 是谁加的？** | git blame ⇒ **`8ea87e19e`** | ✅ 已答 |

## 四、验证证据（全部本机真跑 · .txt+.rc 成对）

| 层 | 结果 | 证据 |
|---|---|---|
| datacore 受影响集 11 文件（triad/seed-prop/real-cells/slice-deriv/inventory-3tier/atp-promise/display-name/adversary/chain-provenance/prop-clamp/sim-disclosure） | **97/97 绿**（96/97 + prop-clamp §3 换样后 7/7） | `/tmp/t6-datacore-affected.txt` RC=1→归因 + `/tmp/t6-propclamp.txt` **RC=0** |
| 前端披露门 2 文件（panel + adversary） | **26/26 绿**（先 6 红 → 归因修绿，见五） | `/tmp/t6-frontend-disclosure2.txt` **RC=0** |
| 前端 tsc / datacore build | RC=0 / RC=0 | `/tmp/t6-frontend-tsc.rc` · `/tmp/t6-fix-build.rc` |
| T6 行为探针（纯衰减对照 7/7 · 6λ 上真世界 · undeclared 16→10 · 129 条饱和记账） | RC=0 | `/tmp/t6-probe.txt` |
| λ 工期实测探针（n=30/193/18） | RC=0 | `/tmp/t6-duration-probe.txt` |
| triad 重测（farMax=0.002557>0） | RC=0 | `/tmp/t6-triad-probe.txt` |
| 臂2 全扫（blockedPressure 27.72–182.73 · n=130 · 越界 49） | RC=0 | `/tmp/t6-arm2-scan.txt` |
| 披露夹具重采 ×2（54/54 CONFIG_REF · 38 域 5 无界 · 10 未声明 · 表达式逐变量解析） | RC=0 | `/tmp/t6-fixture-capture2.txt` |
| T2–T5 各单探针（不变式逐字节 / 触发计数 / 环增益） | RC=0 | `/tmp/t2-*.txt` `/tmp/t4-probe2.txt` `/tmp/t5-probe*.txt`（提交信息逐一引用） |

**full-suite 背景照实记**：并行快照 agent 的全量套件终态 2 红（`features.test.ts` E7 /
`empty-tenant-bootstrap` CL.4），**均不在本单 11 文件受影响面**，归因归该 agent（已交接，不属本单）。

## 五、本窗自伤与修复（如实记，形态 = 「重采夹具 ⇒ 旧前提失格」）

首轮验证 6 红，全部归因为 **T6⑦ 夹具重采改动了别人断言里的前提**，不是产品回归：

1. **对抗方门 4 红（同根）**：重采后 `sim-disclosure.real.json` 带上 `rules.adversary`（后端现在恒下发），
   而它被对抗方门当 **ABSENT 态真样本**用 ⇒ 前提失格。**修**：2026-09-03 原样回包从 git 历史单独存档为
   `sim-disclosure.pre-adversary.real.json`（46 规则/12,745 对象，一个字节没改），证据链恢复。
2. **面板门 :74**：断言写死 `12,745`（旧夹具对象数），重采后世界是 12,499 ⇒ 改钉 `REAL.data.objects`
   （夹具=屏，不再写死字面量）。
3. **面板门 :106 金丝雀**：38 条 `stateVarBounds[].source` 已全无文件坐标（0/38 实测），
   天然载体没了 ⇒ 改**注入式金丝雀**（克隆夹具塞坐标再渲染，直接证「面板永不渲 source」，比旧版更强）。
4. **prop-clamp-decay §3**：它拿 `queueDays`/`inspectBacklog` 当「刻意不声明」探针，
   而 T6 恰好把这两个声明掉了（出处成立：消化速率=产能）⇒ 换样 `clearanceQueueDays`（defer 负值交仓主）
   + `qty`（Order 真值支，设计上永不登记）。

## 六、交仓主裁决清单（按敞口排序，均不阻塞本报告交付）

| # | 事项 | 我的建议 |
|---|---|---|
| 1 | **种子 `blockedPressure` 0–100 收口**（实测 27.72–182.73，n=130 越界 49；动种子=动 hash） | 收。名字自报 0–100 压力指数，种子超界 = 种子自己说谎；hash 变化面已在臂2 归档 |
| 2 | **λ 暂定档 ×2**（`inspectBacklog` 0.37 借检验周期 / `handlingBacklog` 0.75 借维修工期） | 给 QualityLot 补检验工期属性、给 ExceptionEvent 补处置工期属性后改实测档；或认借用档 |
| 3 | **§6 Q4 替代料可用比例** ⇒ `switchPressure→shortageRisk` −0.3 定档 | 比例出来前维持暂定档（方向对、量级不压主链） |
| 4 | **§6 Q2 余量语义**（0.6×0.5=0.3 到达率背后的经营含义） | 业务判断，不替答 |
| 5 | **⑭ 方向**（评审措辞「可能反」：单型号负荷高反而长批次、换型更少） | 倾向不动——「可能」级证据不该翻一条有出处的边 |
| 6 | **⑫ 保留/删除**（出处 `8ea87e19e` 已查） | 业务裁决 |
| 7 | **⑦ Kingman 排队形状**（引擎只有整数延迟，无形状参数） | 单独立项，属引擎能力建设 |
| 8 | **`clearanceQueueDays` −8.9 天负值数据** | 先查数据 bug 再谈域声明 |
| 9 | **DisclosurePanel「无上界」渲染**（T6 顺手落，纯渲染分支） | 可否决；否决即回退该分支 |
| 10 | **`coverDays` 动态化**（准静态 ⇒ 需 `drawdown→coverDays` 入边，超评审范围） | 另立单，形态②邻接 |

## 七、红线自查

- 禁令 1（B 类停工）：未触 · 禁令 2（沙盘 UX）：未触（面板改动是纯渲染分支，已报备可否决）·
  禁令 3（新门/棘轮/基线）：未触。
- `Order.qty/unitPrice/leadDays`：未动 · 种子生成式：未动（hash 不变，收口交仓主）·
  R14 零内联：5 个新 λ 全走 `C35.params`，新边系数全走 `C36.params`。
- v1 化成/分容 4 边：维持撤回，从未落地。
