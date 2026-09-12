# AUDIT · 业务规则可发现性（`WO-DIAG-RULES`）· 2026-09-12

> **本单只诊断，一行产品代码都没改。** 范围边界：只新建本文件。

---

## 1 · 报告头（树龄自证）

| 项 | 值 |
|---|---|
| **起点 HEAD（重开前）** | `778cc589` —— **旧树** |
| **起点树龄探针** | `wc -l apps/datacore/src/synthetic/battery.ts` = **1249** 行（PIN 应 ≈7053） |
| **重开后 HEAD** | `c69d345d`（= `origin/claude/inspiring-gates-aqczjg` 逐字节同一 commit） |
| **重开后树龄探针** | `wc -l apps/datacore/src/synthetic/battery.ts` = **7053** 行 ✅ |
| **分支 tip** | `claude/handoff-wo-diag-rules` |
| **`git status --porcelain`** | 空（重开后、交单前各验一次） |
| **取证时刻** | 2026-09-12 |
| **取证环境** | 真起 datacore `SEED_DEMO=1`（内存模式）· 自起端口 **4931** · 无 `VITE_MOCK` |

**⚠ 派单里给的树龄探针自己有个坑，顺手记一笔**：

```bash
git merge-base --is-ancestor HEAD $PIN && echo "落后⇒重开" || echo "不落后"
```

**`HEAD` 与 `PIN` 完全相等时它照样打「落后⇒重开」** —— 因为 git 的祖先关系**含自反**（一个 commit 是它自己的祖先）。
我重开后再跑它仍报「落后」，靠 `git rev-parse` 两边比对才确认 `c69d345d == c69d345d`。

> **形态（铁律 0.6 句式）**：**「我用『HEAD 是 PIN 的祖先』当作『HEAD 落后于 PIN』的证据，而前者并不度量后者 —— 祖先关系含相等这一档。」**

判据应落在 `HEAD != PIN && is-ancestor` 上，或直接比 `rev-parse` 的两个 sha。**这条不影响本单结论**（两个探针都做了），只是这句模板每张单都在用，值得订正。

---

## 2 · 真实规则条数：**30 条**，派单里的「39」**推翻**

### 2.1 实测

**源码侧**（`apps/datacore/src/synthetic/battery.ts` `BATTERY_RULES`，剥注释后逐行扫「行首 `{ key: "Cxx"`」）：

```
提取到 key 数 = 30 ；去重后 = 30
金丝雀 C08 in? true  C35 in? true  C03 in? true
C01..C35 区间内缺号 = C07,C14,C17,C19,C20
```

**运行期侧**（真起 datacore·`GET /a/v1/rules`·`X-Debug-User: demo:admin:admin`）：

```
运行期规则总数 = 30
按 status = {"PUBLISHED":30}
PUBLISHED keys = C01,C02,C03,C04,C05,C06,C08,C09,C10,C11,C12,C13,C15,C16,C18,
                 C21,C22,C23,C24,C25,C26,C27,C28,C29,C30,C31,C32,C33,C34,C35
金丝雀 C08 = {"key":"C08","name":"外协比例红线","expression":"Order.outsourceRatio > params.outsourceRatioMax",...,"status":"PUBLISHED"}
```

**源码 30 = 运行期 30，两侧互证。**

### 2.2 「39」是怎么来的 —— 以及它为什么恰好是本仓最爱犯的那个病

派单里写「我是 grep `"C[0-9]+"` 数的」。我复跑了那个查法：**同文件 `C\d\d` 命中 134 次**，
因为规则码在**注释里**被反复引用（`// C04 认证系数 · C09 数据健康降级 · C18 现金底线 · C21 产销偏差`
这类一行就有 4 个）。任何基于「出现次数」的估计都会落在 30 与 134 之间，取到 39 毫不意外。

> **形态**：**「我用『规则码字符串在文件里出现了多少次』当作『规则有多少条』的证据，而前者并不度量后者。」**

**并且区间里真的有 5 个洞**：`C07 / C14 / C17 / C19 / C20` **在规则库里不存在**。
它们不是被 retire 的（运行期 30 条全是 `PUBLISHED`，零 `RETIRED`），是**从来没定义过**。
这一点下面 §5.2 会变得很要命 —— 因为 agent 拿到的工具说明恰好把这 5 个洞圈在了推荐范围里。

### 2.3 顺带订正两个相邻的数

| 出处 | 原文 | 实测 |
|---|---|---|
| `apps/datacore/src/solvers/decision-info.ts:658` | 「场景包 `BATTERY_RULES` **29 条**」 | **30 条**（`C35` 是后加的，这句注释停在加它之前） |
| 派单 | 「**60** 个求解器」 | **63** 个（`GET /a/v1/solvers/registry`，金丝雀 `capacity_forecast` 在） |

---

## 3 · 元数据缺口：派单的核心指控 **成立**，且比它说的更整齐

真起服务实测（30 条规则 vs 63 个求解器，同一棵树、同一次取证）：

| 字段 | 规则 | 求解器 | 这个字段是干什么的 |
|---|---|---|---|
| `description` | **0 / 30** | **63 / 63** | DRIL 语义检索的**主文本**（`search-engine.ts:266` 候选文本第一项） |
| `tags` | **0 / 30** | **63 / 63** | 语义候选文本 + 五级标签加权 |
| `answersQuestions` | **0 / 30** | **63 / 63** | **样例问句** —— 让「用户怎么问」直接对上「这个资源答什么」 |
| `category` | 30 / 30 | 63 / 63 | 业务类目（规则有） |
| `severity` | 30 / 30 | — | 规则专有 |
| `expression` | 30 / 30 | — | 规则专有 |
| `scopeObjectTypes` | **29 / 30** | — | 唯一空的是 `C35 推演状态量衰减率` |

**三个检索相关字段，规则侧全零、求解器侧全满。** 这不是「有些规则没填」，是**这三个字段在规则这条线上从没被填过一次**。

### 3.1 但「没有 description」不等于「规则完全没有可检索文本」——必须说清

`apps/agentcore/src/dril/resource-projector.ts:170 projectRules()` 有兜底：

```ts
description:
  nonEmpty(r.description, r.name && r.name !== r.key ? r.name : undefined, `合规规则 ${r.key}`) ?? `合规规则 ${r.key}`,
...
expressionSummary: nonEmpty(r.expression),
```

⇒ 规则进检索索引时 `description` **回落成它的 `name`**（如「外协比例红线」），并另带 `expressionSummary`。
**所以规则不是「零文本」，是「只有一个 4–8 字的名字 + 一条 DSL 表达式」。**

**而同一个文件里，切片那一路是这么写的**（`:158-159`）：

```ts
...(s.answersQuestions && s.answersQuestions.length > 0 ? { answersQuestions: s.answersQuestions } : {}),
...(s.tags && s.tags.length > 0 ? { tags: s.tags } : {}),
```

**规则那一路没有这两行。** 即便哪天有人给规则填了 `tags`/`answersQuestions`，
**`projectRules` 也不会把它们投出去** —— 这是「接了线接错地方」那一档，不是「没数据」那一档。
**两者修法不同**：前者要改投影函数，后者只要补种子。**这条是本单最容易被误报的一处**，单独标出。

---

## 4 · 逐条分类表（30 条，一条不漏）

**定性判据回顾**：A 可达 / B 结构性不可达 / C 有映射但排不进 top-6 / D 判不了。

⚠ **在给表之前必须先纠正派单的一个前提** —— 否则整张表会分错。详见 §5。派单说「唯一通路是
`navigation-slice.ts:545-549` 的 `SOLVER_RULE_HINTS`」。**实测这条前提不成立**：
`SOLVER_RULE_HINTS` 是 `Record<string, string>`，**值是 7 句手写散文，一个规则 key 都不含**
（见 §5.1）。真正把规则带进模型视野的是**另外三条线**（`SOLVER_RULE_REFS` / 场景卡 / DRIL 检索）。
本表按**真实的三条线**定性。

**「能被哪些问句带出来」一列给的是本仓自己钉死的场景卡问句**（`apps/agentcore/src/scenarios-catalog.ts`，
20 张卡各带一条 `triggerQuestion` —— 这是本仓对「真实问句」最有出处的定义，不是我编的）。

| 规则 key | 名称 | 描述 | 今天能被哪些问句带出来 | 定性 |
|---|---|---|---|---|
| C01 | 产线设计产能上限 | ⛔无 | 「4680-NCM 加 20% 六周能不能接？」→ `capacity_forecast` (S01) | **A** |
| C02 | 化成/老化串并产能口径 | ⛔无 | 同上 → `capacity_forecast` (S01) | **A** |
| C03 | 产能上限约束 | ⛔无 | 同上 → `capacity_forecast` (S01) | **A** |
| C04 | 仅认证产线计入产能 | ⛔无 | 「待认证的型号怎么排认证顺序？」→ `cert_schedule` (S07) | **A** |
| C05 | 产线利用率持续越线 | ⛔无 | 「常州基地影响哪些订单？」→ `affected_orders` (S02) | **A** |
| C06 | 物料齐套缺口口径(MRP) | ⛔无 | 「常州物料齐套为什么这天越线？」→ `risk_timeline` (S03)；「下周哪些订单缺料开不了工？」→ `kit_readiness` (S08) | **A** |
| C08 | 外协比例红线 | ⛔无 | 「推荐哪个经营方案？」→ `plan_generate` (S05)；「缺口 8 万套自产加班还是外协？」→ `outsourcing_split` (S14)；「Q2 缺口用什么组合补？」→ `quarterly_gap` (S19) | **A** |
| C09 | 数据时延临时降级 | ⛔无 | 「4680-NCM 加 20% 六周能不能接？」→ `capacity_forecast` (S01) | **A** |
| C10 | 场景必填+行动审批留痕 | ⛔无 | 「采纳常州的三班制方案」→ `mitigation_select` (S06) | **A** |
| C11 | 检修窗口与交付高峰错峰 | ⛔无 | 「常州物料齐套为什么这天越线？」→ `risk_timeline` (S03)；「检修计划和交付高峰撞了怎么调？」→ `maintenance_stagger` (S13) | **A** |
| **C12** | **预测偏差触发重校** | ⛔无 | **⛔ 无任何求解器 / 场景卡引用** | **B** |
| C13 | 客户信用额度 | ⛔无 | 「宇通客车还能接新单吗？」→ `credit_exposure` (S16) | **A** |
| C15 | 经营毛利底线 | ⛔无 | 「现金垫 45 亿过得了体检吗？」→ `plan_audit` (S04)；「小鹏汽车这单毛利过线吗？」→ `quote_margin` (S15) | **A** |
| C16 | 齐套缺口预警 | ⛔无 | 「7 月正极长协覆盖够吗？」→ `lta_gap` (S09)；「哪些物料超储/欠储？」→ `inventory_optimize` (S10) | **A** |
| C18 | 现金垫底线 | ⛔无 | 「现金垫 45 亿过得了体检吗？」→ `plan_audit` (S04)；「枣庄储能线值得投吗？」→ `capex_scenario` (S17) | **A** |
| C21 | 产销平衡偏差 | ⛔无 | 「现金垫 45 亿过得了体检吗？」→ `plan_audit` (S04)；「本月产销平衡到哪一步了？」→ `sop_balance` (S18) | **A** |
| C22 | 换型损失/排产约束 | ⛔无 | 「下周订单怎么排能少换型？」→ `changeover_sequence` (S11) | **A** |
| C23 | CAPEX 情景测算门槛 | ⛔无 | 「现金垫 45 亿过得了体检吗？」→ `plan_audit` (S04)；「枣庄储能线值得投吗？」→ `capex_scenario` (S17) | **A** |
| C24 | 接单毛利过线 | ⛔无 | 「小鹏汽车这单毛利过线吗？」→ `quote_margin` (S15) | **A** |
| **C25** | **外部终端需求假设偏离** | ⛔无 | **⛔ 无任何求解器 / 场景卡引用** | **B** |
| C26 | 认证资源上限 | ⛔无 | 「待认证的型号怎么排认证顺序？」→ `cert_schedule` (S07) | **A** |
| C27 | 长协执行偏差 | ⛔无 | 「7 月正极长协覆盖够吗？缺口怎么补？」→ `lta_gap` (S09) | **A** |
| C28 | 呆滞预警 | ⛔无 | 「哪些物料超储/欠储？能释放多少资金？」→ `inventory_optimize` (S10) | **A** |
| C29 | 排产冻结期 | ⛔无 | 「下周订单怎么排能少换型？」→ `changeover_sequence` (S11)；「Q2 缺口用什么组合补？」→ `quarterly_gap` (S19) | **A** |
| C30 | 良率连降停线评审 | ⛔无 | 「涂布良率为什么掉了？」→ `yield_diagnosis` (S12) | **A** |
| C31 | 外协质量门 | ⛔无 | 「缺口 8 万套自产加班还是外协？」→ `outsourcing_split` (S14) | **A** |
| C32 | 逾期冻结 | ⛔无 | 「宇通客车还能接新单吗？」→ `credit_exposure` (S16) | **A** |
| C33 | 碳护照前置 | ⛔无 | 「4680-NCM 出口欧盟的碳足迹达标吗？」→ `carbon_footprint` (S20) | **A** |
| **C34** | **跨业务线产能争用** | ⛔无 | **⛔ 无任何求解器 / 场景卡引用**（详见下） | **B** |
| **C35** | **推演状态量衰减率** | ⛔无 | **⛔ 无任何求解器 / 场景卡引用**（详见下） | **B** |

### 4.1 四类计数

| 定性 | 条数 | 规则 |
|---|---|---|
| **A · 可达** | **26** | C01–C06, C08–C11, C13, C15, C16, C18, C21–C24, C26–C33 |
| **B · 结构性不可达** | **4** | **C12 · C25 · C34 · C35** |
| **C · 条件可达但极难** | **0** | 见 §4.2 —— 这一档在本仓**结构上不成立** |
| **D · 判不了** | **0** | — |

### 4.2 为什么 **C 档（排不进 top-6）实测为 0** —— 派单的 `MAX_SOLVERS = 6` 担忧不落在规则上

派单担心「`MAX_SOLVERS = 6` 把上游夹死 ⇒ 带它的求解器排不进 top-6 ⇒ 实际不可达」。
**追到读取点后这条不成立，理由是规则根本不走那条路**：

`MAX_SOLVERS` 只截断 `navigation-slice.ts` 投影给模型的**提示文本**里列几个求解器（`:528`）。
而规则进入模型视野靠的是**求解器真被调用之后**的 `evaluatedRules` 回包
（`apps/datacore/src/solvers/service.ts:6543 evaluateRuleRefs`）—— 那是**执行期**，与「提示里列了几个」无关。

**判据**：一次 `invoke_solver("carbon_footprint")` 无论 `carbon_footprint` 在导航图里排第几、
甚至**根本没被列出来**，只要模型调了它，`SOLVER_RULE_REFS["carbon_footprint"] = ["C33"]` 就会被逐条求值并回带。
⇒ **截断影响「模型容易不容易想到调它」，不影响「调了之后规则出不出来」。**
这是两个不同的量，不该合成一句。

故 26 条的可达性**不由 top-6 决定**，C 档无实例。**真正的门槛在别处**（§5.2 的工具说明、§6 的根因）。

### 4.3 B 档四条各自的性质**不一样**，不许合成一句

| 规则 | 三分法定性 | 证据 | 修法 |
|---|---|---|---|
| **C12** 预测偏差触发重校 | **没接线** | `SOLVER_RULE_REFS` 19 个条目无一含 C12；20 张场景卡无一声明 C12。而它 `scopeObjectTypes=["Model"]`、`category=需求`，业务上明显该挂 `demand_*` 一族 | 补一条引用 |
| **C25** 外部终端需求假设偏离 | **没接线** | 同上。`scopeObjectTypes=["ExternalSignal"]` | 补一条引用 |
| **C34** 跨业务线产能争用 | **接了线接错地方**（近似） | 它是规则库里**唯一的多主体谓词**（`COUNT(Base.segClaims.dailyRate) > 1 AND ...`），`battery.ts:806-820` 大段注释说明它是为 A6 争用判定新建的。但**没有任何求解器在 `SOLVER_RULE_REFS` 里认领它** ⇒ 建了、发布了、没人评估 | 认领到 `capacity_*` / A6 相关求解器 |
| **C35** 推演状态量衰减率 | **刻意如此·不是缺陷** | `battery.ts:821` 明写「**这条规则存在的唯一理由就是让 λ 可编辑**」。它的消费方是**推演引擎读 `params.pressureDecayPerTick`**（`STATE_DECAY_RULE_KEY`），不是规则引擎判定。且它是 30 条里**唯一 `scopeObjectTypes` 为空**的 | **不该修** —— 它是参数载体，不是判定规则 |

> **⚠ C35 是本表最容易被误报的一条**：按「无人引用」的机械判据它落 B，但它**本来就不该被问句带出来**。
> 把它和 C12/C25 摆在一起说「4 条不可达」会**把一条正常设计报成缺陷**。
> 故 **B 档里真正需要动的是 3 条（C12 / C25 / C34），C35 是名义 B、实质豁免。**

---
