# 求解器阈值台账（WO-66-RULES-FIRST-CLASS · P0 普查产物）

> ## ⚠️ 过期横幅（收编时加·2026-08-13）
> - **基线 sha**：`8511b017` — **canonical 已在其后 863 个提交**。
> - **本次有没有重跑**：**没有**（纯普查台账，无可执行断言）⇒ 改做**抽查 3 个 `file:line` 锚点回代码核对**。
> - **抽查结论（3/3 行号已漂，符号全在 ⇒ 台账的「结论」可用、「行号」不可直接引用）**：
>   | 文中锚点 | 收编日实测 | 判 |
>   |---|---|---|
>   | `base-outlook.ts:107` 时间单位 `86400000` | 实为 **`base-outlook.ts:116`**（`:107` 现为 `horizons: HorizonOutlook[];`） | ⚠️ 漂移 +9 |
>   | `app.ts:1273-1292` `RuleParamLookup` 装配 | 实为 **`app.ts:1499`** `const ruleParams: RuleParamLookup = {}`（`:1273` 现为 `throw forbidden(...)`） | ⚠️ 漂移 +226 |
>   | §「本体记 `capacity.ts:151`，实测已漂移到 `capacity.ts:179`」 | **两个都已过期** —— 收编日实测 `ruleRefs:["C01","C02"]` 在 **`capacity.ts:181`** | ⚠️ 该文自带的「订正值」本身也漂了 |
> - **⇒ 这份台账的 140 个 `file:line` 一律按「863 提交前的坐标」读**；要据它开工，先按符号名重新定位，
>   不许照抄行号（照抄会指到 `throw forbidden` 这种毫不相干的行上）。**结论层（哪些阈值硬编码、M4 是最正确范式）未被推翻。**

> **状态**：P0 台账，**仅普查、未改任何代码**。待审核方过目后再授权 P1/P2。
> **普查范围**：`apps/datacore/src/solvers/**` 全部 21 个文件（20 `.ts` + 1 `.mjs`），逐个数值字面量与比较运算判定。
> **分支**：`claude/handoff-wo-66-rules-first-class`（基线 canonical `8511b017`）。
> **日期**：2026-07-30。

---

## §0 本体引用与影响（铁律 0 · 强制节）

已读 `docs/SYSTEM-ONTOLOGY.md`（v1.0，973 行）。本台账涉及：

- **对象类型**（§2）：`RuleEntry`（§2.C 规则/约束域·含 `params`）· `SolverDef`/`SOLVER_KEYS`（§2.E 求解/推演域）· `SolverContext`（§2.E·`rules`/`ruleSetVersion`）· `SolverParam`/`SolverParamsHistory`（§2.E）· `PropagationRule`（§2.I·`coefficientRef`）· `OntologyBinding`（§2.J·`coeffSource`）· `EvaluatedRule`。
- **链路**（§3）：`规则库 → SOLVER_RULE_REFS → 求解器评估 → EvaluatedRule[] → 答案的规则闸`；以及 §3 传导链 `PropagationRule.coefficient/delayTicks --引用--> rule.params(G-10 P1)`、优化融合链 `系数 --coeffSource=rule_params--> rule.params`。
- **不变量**（§5）：**R14 应用层无业务常数（本单主战场）** · R6 确定性 · R13 结论可溯源 · R-一致（一个事实一个出处）· R18 尺度自洽 · RL3 单一来源 / RL5 零业务常数。
- **门禁**（§7）：`rule-closure:check` · `no-hardcoded-rules:check` · `debattery:check` · `boundary-singlesource:check`。
- **断点**（§8）：**G-10「规则被引用、被写死，但非一等可编辑引用」= 本单目标断点**（本体现记 ◐ P1+P2 已落 + P3 ◐）。

**本台账对本体的校正意见（P0 结论，待审核方裁决后回写 §8 G-10）**：本体 G-10 词条称 P1/P2 已落、「改规则即改推演」已验。经本次普查，该结论**在 `Cxx` 码维度成立**（26 码闭引用 + `evaluateRuleRefs` 真评估），但在**阈值/系数维度存在实质缺口**——详见 §4「头号发现」。本节不改本体，仅登记待裁决项。

---

## §1 普查手法与统计

### 1.1 手法

1. 脚本提取 `solvers/**` 每文件的数值字面量（先剥离字符串字面量与行注释，避免把文案/颜色码/编号误计）。
2. 过滤平凡集（`0/1/2/3/4/7/10/12/24/30/60/90/100/365/1000/1e4/1e6/0.5`）+ 保留所有与比较运算符相邻的数值 → 得候选行。
3. 候选行逐行人工判读，二分为「业务阈值」/「算法常数（非业务·不迁移）」，算法常数逐条给理由（§3）。
4. 平凡集内的数字**未被无条件放弃**：`30/90/365/7` 等出现在 horizon/年化/周折算处的，已回查上下文并在 §2 中登记（如 `base-outlook.ts:126-127`、`service.ts:2382`、`extended.ts:156`）。

### 1.2 统计

| 项 | 数 |
|---|---|
| 扫描文件数（`solvers/**` 全量） | **21**（20 `.ts` + 1 `.mjs`） |
| 原始数值字面量总数（含 JSDoc/块注释内编号） | **2199** |
| 去平凡 + 保留比较运算后的候选行 | **282** |
| 判为**业务阈值**的站点（§2 表，B1–B86） | **86** |
| 判为**算法常数/非业务·不迁移**的类别（§3，A–M 类，覆盖余下全部候选） | **13 类** |
| 其中「已走 `coeff()` 读 `rule.params` 但**该规则从未播种**」的站点 | **30**（B51–B80，见 §4.1） |

### 1.3 逐文件扫描结果（**零命中文件也逐行登记**，无遗漏）

| # | 文件 | 行数 | 命中行/字面量 | 业务阈值站点 | 结论 |
|---|---|---|---|---|---|
| 1 | `solvers/args-schemas.ts` | 23 | 0 / 0 | 0 | **零命中**（纯 zod schema 声明，无数值） |
| 2 | `solvers/base-outlook.ts` | 255 | 40 / 70 | 4 | 全部业务系数已走注入 `coeff()`，但规则未播种（§4.1） |
| 3 | `solvers/capacity.ts` | 722 | 115 / 174 | 4 | 大部分已迁 `c.params`（`no-hardcoded-rules` 门守），残留兜底默认 |
| 4 | `solvers/capex.ts` | 279 | 72 / 100 | 6 | C23 门槛读 `c.params` 非 `rule.params`；税率/爬坡裸写 |
| 5 | `solvers/extended.ts` | 534 | 171 / 310 | **26** | **重灾区**：13 求解器的业务阈值几乎全裸写 |
| 6 | `solvers/field-role-lexicon.ts` | 28 | 0 / 0 | 0 | **零命中**（纯字符串词库） |
| 7 | `solvers/field-roles.ts` | 113 | 18 / 43 | 0 | 仅置信度标定常数（算法·D/N 类） |
| 8 | `solvers/inproc-optimizer.ts` | 244 | 35 / 40 | 0 | 仅浮点容差 + 注释编号 |
| 9 | `solvers/llm-gen.ts` | 69 | 3 / 3 | 0 | 仅 `maxTokens:1500`（运行时护栏·J 类） |
| 10 | `solvers/opt-binding.ts` | 300 | 14 / 18 | 0 | 仅 `seed:42`（R6·F 类）+ 注释编号 |
| 11 | `solvers/opt-embedding.ts` | 75 | 13 / 20 | 0 | `coverageGap` 阈值 0.05 属 advisory 检索、不入确定性路径（边界·见 §6） |
| 12 | `solvers/opt-whatif.ts` | 206 | 17 / 21 | 0 | **候选全为块注释内编号**（§4/§5 核心数），代码无业务常数 |
| 13 | `solvers/optimizer-client.ts` | 375 | 2 / 3 | 0 | **零业务命中**（HTTP 客户端，仅超时/状态码） |
| 14 | `solvers/plan.ts` | 393 | 49 / 77 | 3 | 目标值读 `c.params.planGenerate`，残留默认 18/12 |
| 15 | `solvers/portfolio.ts` | 1064 | 159 / 220 | **16** | 全部走注入 `coeff()`，但规则未播种（§4.1） |
| 16 | `solvers/risk.ts` | 1052 | 132 / 213 | **15** | 分级阈值/齐套基线/单价兜底裸写；MOCK 造数常数另计 |
| 17 | `solvers/sandbox-runner.mjs` | 37 | 3 / 4 | 0 | **零业务命中**（仅错误串截断长度·J 类） |
| 18 | `solvers/sandbox.ts` | 60 | 3 / 5 | 0 | **零业务命中**（timeout/maxOutputBytes·J 类） |
| 19 | `solvers/service.ts` | 4262 | 504 / 793 | **28** | 归因/决策推演大量裸系数；含 3 处完全重复的分级阈值 |
| 20 | `solvers/sop-reschedule.ts` | 208 | 54 / 80 | 4 | 3 系数走 `coeff()`（规则未播种）+ `advancePct` 裸写 |
| 21 | `solvers/types.ts` | 331 | 5 / 5 | 0 | **零业务命中**（类型声明 + 日期换算 86400000·A 类） |

> **零命中/零业务命中文件共 9 个**：`args-schemas.ts`、`field-role-lexicon.ts`（字面零命中）；`field-roles.ts`、`inproc-optimizer.ts`、`llm-gen.ts`、`opt-binding.ts`、`opt-whatif.ts`、`optimizer-client.ts`、`sandbox-runner.mjs`、`sandbox.ts`、`types.ts`、`opt-embedding.ts`（零**业务**命中）。已逐个登记，未跳过任何文件。

---

## §2 业务阈值穷举表（B1–B86）

> 「现在能否改（不改代码）」列语义：
> **否** = 必须改代码重新发版；
> **半** = 可经 `args` 或 `SolverParam` 改，但**改规则库不生效**（G-10 本体：规则不是真出处）；
> **半†** = 已写成读 `rule.params`，**但该规则键从未播种**（见 §4.1），实际恒走内联兜底 → 对用户等同「否」。

### 2.1 `extended.ts`（13 求解器 · 重灾区）

| # | 求解器 | 位置 `file:line` | 当前值 | 业务含义 | 应归属规则 | 建议 param 名 | 能否改 |
|---|---|---|---|---|---|---|---|
| B1 | mitigation_select | `extended.ts:20-50` | 21 条方案 `eff`/`tn`（8–15 / 1–7） | 缓解方案效力/前置期库 | 风险域（无码） | `mitigations`（**已存在于 `BATTERY_SOLVER_PARAMS.risk.mitigations`·此处是第二份**） | 半 |
| B2 | mitigation_select | `extended.ts:57`,`529` | `85` | 张力基线默认 | 风险域 | `risk.threshold`（**已存在=85·重复**） | 半 |
| B3 | mitigation_select | `extended.ts:66` | `70` / `30` | 紧迫度起算线 / 归一跨度 | 风险域 | `urgencyBase` / `urgencySpan` | 否 |
| B4 | cert_schedule | `extended.ts:87` | `40` | 认证工时→周折算（40h/周工时制） | C26 认证资源上限 | `certHoursPerWeek` | 否 |
| B5 | cert_schedule | `extended.ts:431` | `3` / `80` | 工程师组数 / 单项认证默认工时 | C26 | `engineerGroups` / `defaultCertHours` | 否 |
| B6 | inventory_optimize | `extended.ts:142` | `5` | 安全库存天数 | C16 齐套缺口预警 | `safetyDays` | 半 |
| B7 | inventory_optimize | `extended.ts:149` | `1.5` | 超储线 = 目标水位 ×1.5 | C28 呆滞预警 | `overstockMultiple` | 否 |
| B8 | inventory_optimize | `extended.ts:150` | `0.8` | 欠储线 = 目标水位 ×0.8 | C16 | `understockMultiple` | 否 |
| **B9** | inventory_optimize | `extended.ts:156` | `90` | **呆滞判定天数**（`idleDays>90`） | **C28 呆滞预警** | `idleDaysThreshold` | 否 |
| B10 | changeover_sequence | `extended.ts:170` | `999` | 换型矩阵缺行的兜底分钟（哨兵） | C22 换型损失 | `missingChangeoverMin` | 否 |
| **B11** | maintenance_stagger | `extended.ts:241` | `26` | **两次检修最小间隔周** | **C11 检修窗口错峰** | `minMaintIntervalWeeks` | 否 |
| B12 | maintenance_stagger | `extended.ts:242` | `3` | 同组同周检修上限 | C11 | `maxGroupMaintPerWeek` | 否 |
| B13 | maintenance_stagger | `extended.ts:236` | `±4` | 错峰搜索窗（周） | C11 | `staggerSearchWeeks` | 否 |
| B14 | outsourcing_split | `extended.ts:265` | `1.0` / `0.4` | 加班单位成本 / 加班上限=缺口×40% | C08 外协比例红线 | `overtimeUnitCost` / `overtimeCapPct` | 否 |
| **B15** | outsourcing_split | `extended.ts:266` | `1.4` / `0.2` | 外协单位成本 / **外协上限=总需求×20%** | **C08 外协比例红线** | `outsourceUnitCost` / `outsourceRatioMax` | 否 |
| B16 | outsourcing_split | `extended.ts:267`,`280` | `2.5` | 延期单位成本（兼作 savedVsAllDelay 基准） | C08 | `delayUnitCost` | 否 |
| **B17** | quote_margin | `extended.ts:294` | `0.1` | **细分毛利底线默认** | **C15 经营毛利底线 / C24 接单毛利过线** | `segmentFloorPct` | 半 |
| B18 | quote_margin | `extended.ts:299` | `0.01` | 「触线」判定带宽 | C24 | `marginTouchBand` | 否 |
| B19 | quote_margin | `extended.ts:468` | `500`/`0.1`/`8`/`0.12`/`0.05` | 默认报价/制造费率/物流费/细分底线/加工费率 | C15·C24 | `quote.*` | 否 |
| **B20** | credit_exposure | `extended.ts:315`,`477`,`498` | `30` | **逾期冻结天数**（3 处重复） | **C32 逾期冻结** | `overdueDaysThreshold` | 否 |
| B21 | credit_exposure | `extended.ts:492`,`495` | `5000` | 客户信用额度默认（万元） | C13 客户信用额度 | `defaultCreditLimit` | 否 |
| B22 | countermeasure_combo | `extended.ts:354-358` | `0.3/0.15/0.1/0.2/0.5` | 五杠杆各自可释放缺口占比 | C08·C23·C29 | `comboLevers[].releasePct` | 半 |
| B23 | countermeasure_combo | `extended.ts:354-358` | `0.5/0.6/0.7/1.4/2.2` + costRank `1/1/2/2/3` | 五杠杆单位成本与成本档 | C08·C23 | `comboLevers[].unitCost/costRank` | 半 |
| **B24** | carbon_footprint | `extended.ts:385`,`504` | `70` | **欧盟碳阈值** | **C33 碳护照前置** | `euCarbonThreshold` | 半 |
| B25 | lta_gap | `extended.ts:445` | `0.8` / `365` | 长协年度锁量比 / 年化天数 | C27 长协执行偏差 | `ltaLockRatio` / `annualDays` | 否 |
| B26 | quarterly_gap / countermeasure_combo | `extended.ts:464`,`525`,`522` | `0.15` / `50` | 缺口默认=总需求×15% / 季度缺口默认 | C08 | `defaultGapPct` | 半 |

### 2.2 `risk.ts`

| # | 求解器 | 位置 | 当前值 | 业务含义 | 应归属规则 | 建议 param 名 | 能否改 |
|---|---|---|---|---|---|---|---|
| **B27** | risk_timeline（案例分级） | `risk.ts:24-29` | `92` / `78` / `12` | **高危线 / 中危线 / 主瓶颈加成**（注释自承「业务区间」） | 风险域（无码·建议新登记） | `severityHigh`/`severityMedium`/`primaryFactorBonus` | 否 |
| **B28** | risk_timeline | `risk.ts:191` + 文案 | `70`+`12`；文案写死「阈值 5 天」「阈值 80%」 | **齐套率基线与文案阈值**（文案阈值与规则完全不联动） | **C06 物料齐套缺口 / C16** | `kitFloorPct` / `coverDaysFloor` | 否 |
| B29 | risk_timeline | `risk.ts:190` | `3`+`3` | 安全库存覆盖天数基线 | C06 | `coverDaysBase` | 否 |
| B30 | risk_timeline | `risk.ts:201` | `2`+`5` | 在途到货延迟天数基线 | 物流域 | `transitDelayBase` | 否 |
| **B31** | risk_timeline | `risk.ts:219` | `96` | 张力爬坡上限——**与 `BATTERY_SOLVER_PARAMS.risk.cap=98` 不一致（同概念两值）** | 风险域 | `risk.cap`（复用既有） | 否 |
| B32 | risk_timeline | `risk.ts:595` | `90` | 峰值触发第二处置方案的线 | 风险域 | `secondPlanPeak` | 否 |
| B33 | affected_orders | `risk.ts:764`,`812`,`868` | `180` | 波及订单默认窗口（天，3 处重复） | 无码 | `affectedWindowDays` | 半 |
| B34 | affected_orders | `risk.ts:809` | `0.2` + `/10` | 延期→影响度标定 | 无码 | `delayImpactBase/Span` | 否 |
| **B35** | risk 财务派生 | `risk.ts:897`,`1033` | `0.6` | **单价兜底（万元/套）——绕过 `SEG_REGISTRY` 单一来源（违 R14「单价单一来源」）** | R14 单价条款 | 应删兜底、强制 `SEG_REGISTRY` | 否 |
| **B36** | 订单越线注入 | `risk.ts:931`,`940` | `1.05` | **信用占用比越限线** | **C13 客户信用额度** | `creditOverLimitRatio` | 否 |
| B37 | risk_timeline（MOCK 曲线） | `risk.ts:635`,`644`,`650` | clamp `[40,97]` | MOCK 张力曲线上下限 | 风险域（MOCK 口径） | `mock.tensionFloor/Cap` | 否 |
| B38 | risk_timeline（MOCK） | `risk.ts:643`,`645`,`648` | `16`+`%40` / `48`+`%10` / `0.4` | MOCK 峰值日/基线/衰减斜率 | 风险域（MOCK） | `mock.*` | 否 |
| B39 | risk_timeline（MOCK） | `risk.ts:654`,`657` | `-14` / `+18` | 「事件窗」「财务击穿」标注偏移日 | 风险域（MOCK） | `mock.markerOffsets` | 否 |
| B40 | base outlook（risk 侧） | `risk.ts:508` | `0.15` | 加班可提升可用产能比例 | 无码（`base_outlook_coeffs`） | `overtimeUpliftPct` | **半†** |
| B41 | base outlook（risk 侧） | `risk.ts:509` | `0.6` | 跨基地调剂吸收比例 | 无码（`base_outlook_coeffs`） | `crossBaseAbsorbPct` | **半†** |

### 2.3 `capex.ts`

| # | 求解器 | 位置 | 当前值 | 业务含义 | 应归属规则 | 建议 param 名 | 能否改 |
|---|---|---|---|---|---|---|---|
| **B42** | capex_scenario | `capex.ts:13` | `0.25` | **企业所得税率 25%** | C23 CAPEX 门槛（或新登记财务码） | `taxRate` | 否 |
| B43 | capex_scenario | `capex.ts:14` | `[0.5,0.75,0.9,1.0]` | 投产后各季爬坡系数默认 | C23 | `defaultRamp` | 半 |
| **B44** | capex_scenario | `capex.ts:149` | `0.15` / `0.75` | **IRR 门槛 / 24 月利用率门槛**——注释自称「取规则库 C23 参数」，**实际读 `c.params.capexScenario`（SolverParam），C23 规则 `params` 为空** | **C23** | `irrThreshold` / `util24Threshold` | 半 |
| B45 | capex_scenario | `capex.ts:166` | `40` | 项目生命周期默认（季）= 10 年 | C23 | `defaultLifeQuarters` | 半 |
| B46 | capex_scenario | `capex.ts:184` | `0.05` | 过剩窗口判定：`G < −5%·S` | C23 | `surplusPct` | 半 |
| B47 | capex_scenario | `capex.ts:155`区 | `2` | 缺口窗口最小连续季数 | C23 | `gapMinQuarters` | 半 |

### 2.4 `service.ts`

| # | 求解器 | 位置 | 当前值 | 业务含义 | 应归属规则 | 建议 param 名 | 能否改 |
|---|---|---|---|---|---|---|---|
| B48 | gap_attribution | `service.ts:1385` | `0.88` | 结构层可解释比 | 无码（`gap_attribution_coeffs`） | `structuralExplained` | **半†** |
| B49 | gap_attribution | `service.ts:1386` | `0.8` | 因果层可解释比 | 无码（`gap_attribution_coeffs`） | `causalExplained` | **半†** |
| B50 | supply_demand_gap_attribution | `service.ts:2361` | `0.85` | 可解释比（**未走 `coeff()`·直接内联读**） | 无码 | `explained` | **半†** |
| B51 | supply_demand_gap_attribution | `service.ts:2362` | `0.01` | 物料缺吨→万套折算率 | 无码 | `matTonToWan` | **半†** |
| **B52** | gap_attribution | `service.ts:1422` | `600` | **订单单价兜底（元？万元？）——与 `portfolio.avgUnitPrice=1.8 万` 口径冲突**（R18/R-一致风险） | R14 单价条款 | 应统一到 `SEG_REGISTRY` | 否 |
| **B53** | gap_attribution ×3 | `service.ts:1486`,`1550`,`2392` | `0.85` | **设备 OEE 名义基线（3 处完全重复）** | C05 产线利用率 / 设备域 | `nominalOee` | 否 |
| B54 | gap_attribution | `service.ts:1640` | `0.15` | 物料因子贡献占比 | 无码 | `matContributionPct` | 否 |
| B55 | gap_attribution | `service.ts:1676` | `/10` | 矿价涨幅%→严重度归一上限 | 无码 | `orePriceSevCap` | 否 |
| **B56** | gap_attribution | `service.ts:1677` | `120000` | **锂价严重度归一上限（元/吨）** | 无码（建议新登记） | `liPriceCap` | 否 |
| B57 | gap_attribution | `service.ts:1678` | `5` | 备份供应池「足够」成员数基线 | 无码 | `backupPoolFloor` | 否 |
| B58 | gap_attribution | `service.ts:1679` | `26` | 认证周期严重度归一上限（周·与 B11 的 26 重复概念） | C26 | `certWeeksCap` | 否 |
| **B59** | gap_attribution ×3 | `service.ts:1685-1687`,`1931-1933`,`2187-2189` | `0.7`/`0.4`/`0.2` | **严重度分级（critical/major/minor）——3 处逐字重复** | 无码（建议新登记） | `sevCritical/Major/Minor` | 否 |
| B60 | decision_play | `service.ts:2739` | `16` | 备份池认证周期默认（周） | C26 | `defaultCertWeeks` | 否 |
| B61 | decision_play | `service.ts:2742` | `0.2` / `26` | 备份方案有效性下限 / 认证周归一上限 | C26 | `effBackupFloor`/`certWeeksCap` | 否 |
| B62 | decision_play | `service.ts:2743` | `0.3` / `0.7` | 长协条款方案有效性（有/无价格联动） | C27 | `effClauseLinked/Unlinked` | 否 |
| B63 | decision_play | `service.ts:2744` | `0.9` | 自采内制方案有效性 | C27 | `effInsource` | 否 |
| B64 | decision_play | `service.ts:2745` | `2000` | 长协缺口规模归一上限（吨） | C27 | `shortfallCapTon` | 否 |
| B65 | decision_play | `service.ts:2747` | `0.6`+`0.4` | 缺口规模对方案收益的加权 | 无码 | `cgBase`/`cgSpan` | 否 |
| B66 | decision_play | `service.ts:2750` | `120`+`8×`,`×7`,`0.25`,`0.6`,`0.8` | 备份认证方案成本/周期/风险/敞口/可逆性 | C26 | `option.backupCert.*` | 否 |
| B67 | decision_play | `service.ts:2753` | `180`,`×0.5`,`30`,`0.2`,`0.5`,`0.4/0.15`,`0.9` | 长协条款方案各维 | C27 | `option.ltaClause.*` | 否 |
| B68 | decision_play | `service.ts:2756` | `800`+`1200×`,`180`,`0.55`,`0.05`,`0.2` | 自采内制方案各维 | C27 | `option.insource.*` | 否 |
| B69 | decision_play | `service.ts:2774-2777` | 触发阈值 override | 走 `rule?.params?.[triggerId]`（`trigger_thresholds`） | 无码 | `<triggerId>` | **半†** |
| B70 | decision_play | `service.ts:2787` | `30` / `90` | 行动分期：即刻/本季/半年 | 无码 | `phaseImmediate/Quarter` | 否 |
| **B71** | supply_demand_gap_attribution | `service.ts:2382` | `300` | **年化工作日——旁路 `BATTERY_SOLVER_PARAMS.operatingDaysPerYear`（contracts 单一来源）**，同文件 `:2587` 却正确读取 → R-一致违规 | R18 | 复用 `operatingDaysPerYear` | 否 |
| B72 | atp_check | `service.ts:2685` | `90` | 订单纳入窗口（天） | 无码 | `atpWindowDays` | 否 |
| **B73** | （报价/交期判） | `service.ts:2981`,`2983` | `700` / `0.9` | **周产能基线 = 基地数 ×700**（与 `capacity_rollup` 真产能口径无关）/ P90 折扣 | C02·C03 | `weeklyBasePerBase` / 复用 `health.degraded` | 否 |
| B74 | capacity_forecast 包装 | `service.ts:3999`,`4192` | `6` | 预测窗默认周数 | 无码 | `defaultWeeks` | 半 |
| B75 | plan_audit 规则闸 | `service.ts:4126` | `0.3` | 储能占比基线（读 `c.params.audit.essShareBaseline`，默认 0.3） | **C21 产销平衡偏差** | `essShareBaseline` | 半 |
| B76 | 跨基地物流 | `service.ts:2526` | `600`/`1`/`0.55`/`0.4` | 日均卡车里程/最小在途/吨公里费率/套→吨——**内联兜底与 `BATTERY_SOLVER_PARAMS.interbase` 重复** | 无码 | 复用 `interbase.*` | 半 |

### 2.5 `portfolio.ts`（全部已走注入 `coeff()`，但规则未播种 → **半†**）

| # | 位置 | 值 | 业务含义 | param 名 | 能否改 |
|---|---|---|---|---|---|
| B77 | `portfolio.ts:142`,`795` | `14` | 调度时间窗（天） | `windowDays` | 半† |
| B78 | `portfolio.ts:143` | `2` | 允许延后窗口数 | `lateWindows` | 半† |
| B79 | `portfolio.ts:146`,`147` | `0`/`1` | 产能利用率折扣 / 填充率 | `capacityUtilHaircut`/`capacityFillPct` | 半† |
| B80 | `portfolio.ts:241` | `10` | 最大窗口数 | `maxWindows` | 半† |
| B81 | `portfolio.ts:329`,`526` | `72` | 换型全链成本（元/小时） | `changeoverCostPerHour` | 半† |
| B82 | `portfolio.ts:330`,`527` | `0.05` | 延期罚金（单位·日） | `delayPenaltyPerUnitDay` | 半† |
| B83 | `portfolio.ts:331`,`439`,`471`,`528` | `0.5` | 未承接罚金（单位） | `unservedPenaltyPerUnit` | 半† |
| B84 | `portfolio.ts:332` | `1` | 跨基地换型工时兜底 | `crossBaseChangeoverHours` | 半† |
| B85 | `portfolio.ts:333` | `0.5` | 成品持有成本（单位·日） | `fgHoldingCostPerUnitDay` | 半† |
| B86 | `portfolio.ts:356`,`357`,`374`,`718`,`723`,`756`,`777`,`1005` | `3000`/`4`/`0.02`/`3`/`0.15`/`1.8`/`30000`/`300` | 拆批量/最大拆分数/拆分固定费/在途天/运费/**均价 1.8 万**/线日产能/年化工作日 | `splitBatch`/`splitMaxParts`/`splitFixedCostPerUnit`/`mockTransitDays`/`mockFreightPerUnit`/`avgUnitPrice`/`leverLineCapDaily`/`operatingDaysPerYear` | 半† |

### 2.6 `base-outlook.ts` / `sop-reschedule.ts` / `plan.ts` / `capacity.ts`

| # | 求解器 | 位置 | 值 | 业务含义 | 应归属规则 | param 名 | 能否改 |
|---|---|---|---|---|---|---|---|
| （见 B40/B41） | base_capacity_outlook | `base-outlook.ts:126`,`127`,`128`,`129` | `90`/`365`/`0.15`/`0.6` | 在产铺窗参照期/年化基期/加班提升比/跨基地吸收比 | 无码（`base_outlook_coeffs`） | `inProdRefDays`/`forecastAnnualDays`/`overtimeUpliftPct`/`crossBaseAbsorbPct` | 半† |
| （并入 B86 族） | sop_reschedule | `sop-reschedule.ts:160`,`161`,`162` | `72`/`2.5`/`0.05` | 换型小时成本/加班单位成本/延期罚金 | 无码（`sop_reschedule_coeffs`） | 同名 | 半† |
| — | sop_reschedule | `sop-reschedule.ts:71` | `0.2` | 交期提前比例默认（**未走 `coeff()`**） | 无码 | `defaultAdvancePct` | 否 |
| — | plan_generate | `plan.ts:277`,`278` | `18` / `12` | 营收增长目标% / 份额提升点 | C15·C21 | `revGrowthPct`/`sharePts`（已在 `c.params.planGenerate.targets`，此为兜底） | 半 |
| — | capacity_forecast | `capacity.ts:459` | `6` | 预测窗默认周数 | 无码 | `defaultWeeks` | 否 |
| — | capacity_rollup | `capacity.ts:94`,`150` | `1`/`1`/`24`/`1`/`0.01` | availFactor/ctSeconds/shiftHours/shifts 缺值兜底 + CT 下限 | 无码 | `defaults.*` | 否（属兜底默认·弱业务·见 §6） |

> **`capacity.ts` 总体已达标**：C09（`p.health.staleHours`/`normal`/`degraded`）与 C04（`p.certFactors`）已完成迁移并由 `no-hardcoded-rules:check` 门守；`packCellCount`/`packEnergyKwh`/`operatingDaysPerYear` 走 contracts 单一来源。**它是本仓「阈值去硬编码」的正确范式样板**。

---

## §3 判为「算法常数·非业务·不迁移」的逐类理由

> WO 要求逐条给理由，不许一句「都是算法常数」带过。以下 13 类**覆盖 §1.2 中 282 候选行里未进 §2 表的全部剩余项**，每类给判定依据与代表位置。

**A. 时间单位换算 `86400000`**（`base-outlook.ts:107`、`risk.ts:467`、`sop-reschedule.ts:55`、`types.ts:298`、`service.ts:296`）
理由：1 天 = 86 400 000 毫秒，由 SI 秒与历法定义，**换租户/换行业恒不变**。符合本体 §5 R14 明文的「纯单位换算例外」判定标准（值仅由物理单位定义者不算业务常数，同 `wanToYi=v/1e4` 判例）。

**B. 数量级单位换算 `10000` / `1e4` / `1e6` / `1e8`**（`capacity.ts:160`,`385`；`risk.ts:897`,`1033`；`service.ts:1422`,`2382`；`capex.ts:240`）
理由：套→万套、元→万元→亿元、GWh→kWh 的十进制单位阶。与 B 类同判例。**注意**：与之相乘的**价格/产能因子**（如 `risk.ts:897` 的 `0.6`、`service.ts:1422` 的 `600`）**不属本类**，已分别列为 B35/B52 业务阈值。

**C. 浮点比较容差 `1e-4` / `1e-6` / `1e-9` / `1e-12`**（`base-outlook.ts:163`,`202`；`portfolio.ts:310`,`603`,`878`,`965`；`sop-reschedule.ts:121`,`187`,`190`；`service.ts:1474`,`1515`,`1568`,`1599`,`1767`,`1854`,`2023`,`2163`,`2285`,`2430`,`2433`,`2435`；`inproc-optimizer.ts:85`）
理由：IEEE-754 双精度累加尾差的吸收阈，量级由浮点尾数位（2⁻⁵²≈2.2e-16）与累加项数决定，**与业务语义无关**；改之只会让勾稽校验误判，不会改变任何业务结论。

**D. 输出小数位 `round(x, 2|3|4|6)`**（全仓遍布，如 `capacity.ts:235`,`276`；`service.ts:699`,`834`,`1126`,`1130`,`1142`）
理由：展示/序列化精度，服务 R6「字节级一致」的确定性收尾，不参与任何判定分支。改位数不改结论只改小数尾。

**E. 字符串偏移与切片 `slice(0,10)` / `slice(5,10)` / `slice(0,16)` / `slice(0,300)` / `slice(0,200)`**（`base-outlook.ts:107`；`risk.ts:467-468`；`service.ts:461`；`sandbox-runner.mjs:33`；`sandbox.ts:54`）
理由：`0..10` = ISO-8601 日期部分 `YYYY-MM-DD` 的固定长度，`5..10` = `MM-DD`，`0..16` = SHA-256 十六进制前 16 位。由**格式规范**而非业务定义。

**F. 确定性种子与哈希常数 `42` / `31` / `997`**（`opt-binding.ts:118`,`235`；`service.ts:2553`,`3154`,`3199`,`3226`,`3253`,`3317`,`3521`,`3542`,`3561`,`3581`,`3599`,`3623`,`3650`；`risk.ts:463`）
理由：`42` 是 CLAUDE.md 与本体 R6 明文规定的默认种子；`31`/`997` 是多项式滚动哈希的乘子与模数（选质数以散列均匀）。改之**破坏 R6 确定性**而非改变业务口径——属确定性机制常数。

**G. 数值方法收敛参数**（`capex.ts:130` 初值 `0.1`、`:131` 最大 `20` 次、`:133` 容差 `0.01`、`:134` 导数退化 `1e-9`、`:140` 越界回拉 `-0.999`/`/2`）
理由：IRR 牛顿-拉弗森迭代的求解器参数（初值/收敛判据/迭代上限/奇异保护）。它们决定**能不能算出 IRR**，不决定**IRR 达标与否**——后者是 `irrThreshold=0.15`，已单列为 B44。二者必须区分，混为一谈是典型误判。

**H. HTTP/协议状态码 `400` / `422`**（`capex.ts:128`,`135`,`139`,`143`,`155`）
理由：错误信封（本体 R7）的 HTTP 语义码，协议层常数。

**I. 除零与下界保护 `Math.max(1,…)` / `Math.max(0,…)` / `Math.max(0.0001,…)` / `Math.max(0.01,…)`**（`capacity.ts:94`,`160`,`235`；`plan.ts:51`,`86`；`service.ts:4124`；`portfolio.ts:142`,`356`,`795`,`1005`）
理由：防除零/防负的数学卫哨，`0.0001`/`0.01` 是「足够小的正数」而非任何业务下限。若某业务量真的应有下限（如 CT 节拍下限 0.4/1.9），该值已在 `BATTERY_SOLVER_PARAMS.scaleCoherence` 登记而非裸写。

**J. 运行时资源护栏**（`sandbox.ts:27` 超时 `1500`ms、`:28` 输出上限 `256*1024`；`service.ts:492`,`573` 探针超时 `1500`；`llm-gen.ts:60` `maxTokens:1500`；`service.ts:645`,`781` `PROBE_CAP=50`）
理由：沙箱/探针的资源与安全边界，防失控；由基础设施容量决定，与租户业务口径无关。`PROBE_CAP=50` 另兼 R6 确定性上界（sorted 取前 N）。

**K. 正则字符类内的数字**（`opt-embedding.ts:28` `/[a-z0-9]+|[一-鿿]/gi` 中的 `9`）
理由：**扫描器误报**——`0-9` 是字符区间端点，非数值。此类误报仅此 1 处。

**L. 注释/JSDoc 内的编号与引用**（`opt-whatif.ts:4`,`11`,`58`；`opt-binding.ts:4`,`6`,`96`；`inproc-optimizer.ts:16`,`35`,`170`；`extended.ts:7`,`10`,`422`；`types.ts:166`,`317`；`service.ts:168`,`533`,`581`,`751`,`926`,`991`,`1044`,`1100`,`1162`,`2710`,`3092`,`3132`,`3335`,`3355`,`3841`；`portfolio.ts:17`；`risk.ts:21`,`24`,`635`；`capex.ts:71`,`121`）
理由：文档编号（`§7.10`/`§4.5`/`§3.1`）、求解器计数（「13 个新增求解器」「20 场景」「5 CP-SAT 核心」）、示例单号（`SO-3415`）、铁律编号（`铁律 0.4`）、历史行号引用（`service.ts:2586`）。**非代码常数**。这是 2199 原始字面量与 282 候选行之间落差的主要来源之一。

**M. 结构/维数常数**（`plan.ts:228` `M.length>=3`、`:309` 五维均分 `/5`；`field-roles.ts:60` 置信度 `0.5+gap*0.2`；`capex.ts:71` 注释「13 周/季」；`capacity.ts:160` `×7` 日→周）
理由：`/5` 是「利润/规模/现金/增长/稳定」五个评分维度的算术平均分母，由**维数**决定（加一维就该是 6），非可调业务权重；`>=3` 是「至少三点才能判趋势」的统计最小样本；`×7` 是一周天数；「13 周/季」是历法。`field-roles.ts:60` 的置信度线性标定是 A13 角色解析的**内部打分刻度**（输出 `confidence` + `ambiguous` 标供人裁决），不构成业务判定门槛。

> **诚实边界**：M 类中 `field-roles.ts:60` 与 `opt-embedding.ts:70`（`coverageGap` 阈值 `0.05`）我判为**非业务但存疑**，理由见 §6。

---

## §4 头号发现（P1/P2 前必须让审核方拍板的三件事）

### 4.1 ★ 最严重：5 个「系数规则」被求解器读取，但**从未播种** → `coeff()` 恒走内联兜底

代码里已有 6 处「读 `rule.params` 取系数」的写法，分别指向这些 ruleKey：

| ruleKey | 被谁读 | 消费站点 |
|---|---|---|
| `gap_attribution_coeffs` | `service.ts:1383` | B48/B49 |
| `metric_causal_binding` | `service.ts:1389` | 因果绑定权重 |
| `sop_reschedule_coeffs` | `service.ts:2467` | `sop-reschedule.ts:160-162` |
| `portfolio_optimize_coeffs` | `service.ts:2498` | `portfolio.ts` 16 处 |
| `base_outlook_coeffs` | `service.ts:2624` **与** `risk.ts:506` | `base-outlook.ts:126-129`、`risk.ts:508-509` |
| `trigger_thresholds` | `service.ts:2774` | B69 |

**实测复核**：规则播种的唯一路径是 `synthetic/service.ts:225`（`for (const r of template.rules)`），模板即 `battery.ts` 的 `rules[]`。全仓 grep 确认这 6 个 key **在 `battery.ts` / `battery-extended.ts` / 任何 migration SQL 中都不存在**，仅出现在：① 求解器代码的 `pubRules.find(...)`；② 测试文件里现场 `create` 的临时规则（`gap-attribution.test.ts:160`、`decision-play.test.ts:53`、`ceo-data2-seam.test.ts:61`）。

→ **后果**：在 demo/真实租户中 `coeffRule` 恒为 `undefined`，`coeff(k, dflt)` 恒返回内联默认值。**「R14 可校准」在架构上成立、在运行上是死代码**。相关测试之所以全绿，正是因为测试自己先把规则建出来了——这是本项目「绿测试 ≠ 能用」的又一例：**测试证明了机制能用，没证明产品里它在用**。

→ **且 `rule-closure:check` 抓不到**：该门的引用集正则是 `/"(C\d+)"/`，只认 `Cxx` 码，**命名 ruleKey 完全不在其视野内**。这是门的覆盖缺口，非门的 bug。

### 4.2 ★ 同一概念多套实现（WO §七.5 警告的第 4 次）

本仓**已有 5 套**读参数的机制，语义重叠且互不对接：

| # | 机制 | 定义位置 | 形状 | 状态 |
|---|---|---|---|---|
| M1 | `SolverParam` / `c.params` | `battery.ts:203 BATTERY_SOLVER_PARAMS` + `getParams()` | 嵌套对象树，版本化 | ✅ **活跃且质量最高**（`capacity.ts` 范式） |
| M2 | 临时 `coeff()` 闭包（**重复定义 4 次**） | `service.ts:1384`,`2468`,`2499`,`2625` | `(k,dflt)=>num(rule?.params?.[k] ?? dflt)`，各自 `repos.rules.list` 全表扫 + 各自硬编 ruleKey 字符串 | ◐ 机制在，规则未播种（§4.1） |
| M3 | `SolverContext.rules[key].params` | `risk.ts:506` | 走已注入快照，**不再查库** | ◐ 与 M2 **对同一 `base_outlook_coeffs` 走两条不同取数路径** |
| M4 | `PropagationRule.coefficientRef` + `RuleParamLookup` | `sim/propagation.ts:27-63 effectiveCoefficient` | **声明式**：规则对象自带 `{ruleKey, paramKey}` 引用，查找表外部注入（`app.ts:1273-1292`） | ✅ **设计最正确的一套** |
| M5 | `OntologyBinding.coeffSource="rule_params"` | `opt-binding.ts:27-28 ruleParams?(tenantId, ruleKey)` | 异步接口 | ✘ **仅声明，全仓无任何实现/调用者 → 死接口** |

（另有 `ontology-governance.ts:417` 的 `rule?.params?.[ref.paramKey]` 作第 6 处独立读法。）

**M2 vs M3 是真实的接缝风险**：`base_outlook_coeffs` 被 `base_capacity_outlook`（M2·查库）和 `risk_timeline`（M3·读 ctx 快照）分别取用。二者取数时机与过滤条件不同（M3 依赖 `loadContext` 已注入 PUBLISHED 快照，M2 当场再查一次），一旦规则真被播种，两条路径的一致性**目前无任何测试驱动**。这正是 CLAUDE.md SEAM-GATE 条款所指的接缝。

### 4.3 ★ `SOLVER_RULE_REFS` 是编译期硬编码（G-10 本体断点，本单目标）

`packages/contracts/src/datacore.ts:127` 起，`Record<string,string[]>` 字面量，**19 个求解器 / 26 个 `Cxx` 码**（已实测：`node` 解析确认 19 与 26）。唯一消费点 `service.ts:4023 const refs = SOLVER_RULE_REFS[solverKey] ?? []`。

→ 给 `capacity_forecast` 多校验一条 C31 **必须改 contracts 源码 + 重新发版**。且注意：全仓 `SOLVER_KEYS` 有 38+ 个求解器，**只有 19 个进了这张表**；本体 §8 G-10 已诚实登记 `capacity_rollup` 是「第 20 个会引用规则但未登记」的（本体记 `capacity.ts:151`，**实测已漂移到 `capacity.ts:179`** —— 输出 `ruleRefs:["C01","C02"]` 装饰标签却不被评估）。

经本次普查补充：`extended.ts` 有 **12 处**在返回体里自带 `ruleRefs: [...]` 硬编码数组，与 contracts 的 `SOLVER_RULE_REFS` 构成**第二份求解器→规则映射**——又一处「同一概念两套」：

`extended.ts:98`(C26) · `:118`(C06,C16) · `:136`(C16,C27) · `:158`(C16,C28) · `:191` · `:224`(C30) · `:282`(C08,C31) · `:301`(C15,C24) · `:319`(C13,C32) · `:342`(C08,C29) · `:373`(C08,C23,C29) · `:398`(C33)。

其中 `extended.ts:373 countermeasureCombo` 返回 `ruleRefs:["C08","C23","C29"]`，而 contracts 的 `SOLVER_RULE_REFS` 里**根本没有 `countermeasure_combo` 条目** → 该求解器的关联规则在前端显示为装饰标签、永不被 `evaluateRuleRefs` 评估。

---

## §5 附节

### 5.1 既有 `ruleParam` 范式调查（★ 防重复造）

见 §4.2 表 M1–M5。**结论与建议**：

- **应作为统一入口者 = M4 的声明式引用范式**（`sim/propagation.ts:56 effectiveCoefficient` + `RuleParamLookup`，`app.ts:1273` 装配）。理由：① 它是唯一「引用关系写在数据里（`coefficientRef`）而非代码里」的一套，正是 G-10 要的「一等可编辑引用」；② 它已有内联 fallback 的冷启动语义（`propagation.ts:60-63`），与现有 `coeff(k,dflt)` 的兜底语义天然兼容，迁移无行为跳变；③ 它已被本体 §3 明文登记为链路（`PropagationRule.coefficient --引用--> rule.params(G-10 P1 可编辑)`）。
- **应作为取数底座者 = M3 的 `SolverContext.rules`**（`service.ts:3781-3785` 已注入 PUBLISHED 快照 + `ruleSetVersion` 指纹）。理由：已经在 `loadContext` 里查过一次库了，M2 的四处重复 `repos.rules.list` 是**纯粹的重复全表扫描**（性能 + 一致性双输）。
- **P1 的正确做法** = 把 M2 的 4 个重复闭包 + M3 收敛成**一个** `ctx.ruleParam(ruleKey, paramKey, dflt)`（读 `SolverContext.rules`，与 M4 同签名语义），**并把 M5 死接口要么实现要么删除**。**禁止新造第 6 套。**
- **M1（`SolverParam`）不应被吞并**：它承载的是「求解器算法配置」（节拍上下限、哈希取模、MOCK 造数形状），与「业务规则阈值」是**两个不同的一等概念**。二者边界建议以「这个数值改了，用户会不会说『规则变了』」为判据。本台账 §6 列出我判不准的边界项。

### 5.2 现有规则种子的 `params` 覆盖情况（`battery.ts`）

实测（`battery.ts` 大括号配平解析，非正则近似）：**28 条规则种子**，码为 `C01–C33` 去掉 `C07/C14/C17/C19/C20`（这 5 码未定义，也未被引用，故 `rule-closure:check` 绿）。

| 分类 | 数 | 明细 |
|---|---|---|
| 有**非空** `params` | **7** | `C02{tolerancePct:0.05}` · `C04{productionFactor:1,pendingCertFactor:0.6}` · `C09{staleHours:2,normalFactor:0.93,degradedFactor:0.9}` · `C11{minBufferDays:3}` · `C21{balanceDeviationPct:0.1}` · `C22{maxChangeoverMin:120}` · `C25{assumeTolerancePct:0.05}` |
| 有 `params` 但**为空 `{}`**（等同没有） | **6** | `C01` `C06` `C10` `C15` `C16` `C24` |
| **无** `params` 字段 | **15** | `C03` `C05` `C08` `C12` `C13` `C18` `C23` `C26` `C27` `C28` `C29` `C30` `C31` `C32` `C33` |

→ **P1 补种优先级（按 §2 表中「有裸阈值等着它」排序）**：
1. **C08**（外协红线 20% + 三渠道成本）← B14/B15/B16/B22
2. **C28**（呆滞 90 天 + 超储 1.5×）← B7/B9
3. **C32**（逾期 30 天，3 处重复）← B20
4. **C33**（欧盟碳阈 70）← B24
5. **C11**（检修间隔 26 周 + 同组≤3 + 搜索窗 ±4）← B11/B12/B13（注：C11 已有 `minBufferDays:3`，需**扩**而非新建）
6. **C23**（IRR 0.15 / util24 0.75 / 税率 0.25 / 爬坡）← B42/B43/B44
7. **C13**（信用越限 1.05 + 额度默认）← B21/B36
8. **C15/C24**（毛利底线 0.1/0.12）← B17/B19 — 二者 `params` 现为空 `{}`
9. **C26/C27**（认证 26 周 / 长协锁量 0.8、缺口 2000 吨）← B4/B5/B25/B58/B60–B68
10. **C06/C16**（齐套 80% / 覆盖 5 天 / 安全库存 5 天 / 欠储 0.8×）← B6/B8/B28/B29 — `C06`/`C16` `params` 现为空 `{}`

→ **另需新建的「系数规则」6 条**（§4.1 那批，非 `Cxx` 码）：`gap_attribution_coeffs`、`metric_causal_binding`、`sop_reschedule_coeffs`、`portfolio_optimize_coeffs`、`base_outlook_coeffs`、`trigger_thresholds`。

### 5.3 `SOLVER_RULE_REFS` 现状快照 + 闭包门现状

**快照**（`packages/contracts/src/datacore.ts:127`，19 求解器 / 26 码）：

```
capacity_forecast:[C01,C02,C03,C09]   affected_orders:[C05]        risk_timeline:[C06,C11]
plan_audit:[C15,C16,C18,C21,C23]      plan_generate:[C08,C15,C18]  mitigation_select:[C08,C10]
cert_schedule:[C04,C26]               kit_readiness:[C06,C16]      lta_gap:[C16,C27]
inventory_optimize:[C16,C28]          changeover_sequence:[C22,C29] yield_diagnosis:[C30]
maintenance_stagger:[C11]             outsourcing_split:[C08,C31]  quote_margin:[C15,C24]
credit_exposure:[C13,C32]             capex_scenario:[C18,C23]     quarterly_gap:[C08,C29]
carbon_footprint:[C33]
```

**闭包门 `scripts/check-rule-closure.mjs` 现在校验什么**（亲手真跑，显式退出码）：

```
$ node scripts/check-rule-closure.mjs        → EXITCODE=0
· rule-closure：定义 28 · 引用 26（SOLVER_RULE_REFS 26 ∪ 卡 26） · 缺失 0
✓ rule-closure:check：全部被引用规则码均有定义，无悬空引用。

$ node scripts/check-no-hardcoded-rules.mjs  → EXITCODE=0
· no-hardcoded-rules：C09 健康阈值/系数 + C04 认证系数均从参数读，无裸字面量回潮。
✓ no-hardcoded-rules:check 通过（保守哨兵：钉死已迁移阈值；新阈值引入需扩断言）。
```

- **它校验的**：`⋃(SOLVER_RULE_REFS, SCENARIO_CATALOG.rules) ⊆ battery.ts rules[]` 的 **key 存在性**（纯静态正则读源码，不起服务、不查库）。
- **它不校验的（P2 扩展面）**：
  1. **命名 ruleKey 完全不在视野**（正则 `/"(C\d+)"/` 只认 `Cxx`）→ §4.1 那 6 条 `*_coeffs` 规则悬空而门全绿。
  2. **不校验 `params` 有无/键名**——`C08` 无 `params` 而 `outsourcing_split` 引用它、门照绿。
  3. **不校验反向**：求解器代码里出现的裸业务阈值是否已有对应 param（那是 `no-hardcoded-rules:check` 的活，而它只钉死了 C09/C04 两条，是自承的「保守哨兵」）。
  4. **不校验 `extended.ts` 返回体里的第二份 `ruleRefs` 硬编码数组**（§4.3 列出 12 处）与 contracts 是否一致——`countermeasure_combo` 自称引用 C08/C23/C29 却不在 contracts 表内，门全绿。
  5. **不校验数据侧绑定**（WO 所指 P2 目标）：`SOLVER_RULE_REFS` 若一等化成数据，门须改为查库/查种子而非查源码字面量。

---

## §6 诚实边界（我判不准 / 需审核方拍板）

1. **`SolverParam`(M1) 与 `RuleEntry.params` 的分界线**——最需要拍板的一条。例如 `BATTERY_SOLVER_PARAMS.risk.threshold=85`、`certFactors{量产:1.0,认证中:0.6}`、`health{normal:0.93,degraded:0.9,staleHours:2}` 看着都像业务规则阈值（C04/C09 也确实**同时**在规则种子的 `params` 里有一份同值！）。**C04/C09 目前是两处各存一份 0.6/0.93/0.9 的同值**——`no-hardcoded-rules:check` 守的是 `capacity.ts` 读 `p.certFactors`（M1），而规则种子里的 `params` 那份**没人读**。这到底算「已达标」还是「两套并存、规则那份是装饰」？我倾向后者，但这直接决定 P1 工作量，请拍板。
2. **`extended.ts:20-50 MITIGATION_LIB` vs `BATTERY_SOLVER_PARAMS.risk.mitigations`**：代码注释（`extended.ts:141-143`）自承「优先用注入的 canonical 方案库，直接单测无 context 时回落内置」。这个「为了单测方便而保留的第二份」是否该在 P1 删掉（改为测试自己构造 ctx）？我倾向删，但它会动测试，超出本单范围。
3. **MOCK 造数常数（B37–B39，`risk.ts:635-657`）**：它们不影响任何 LIVE 判定，只塑造 MOCK 曲线形状。迁进规则库会让「规则」里混入造数参数（违 §3 中 FUS4「规则是 gate 非系数源」的精神）。我倾向**留在 `BATTERY_SOLVER_PARAMS.risk.mock`**（该处已有 `mock:{mod,factorMult,primaryBase,...}`），不进 `RuleEntry`。请确认。
4. **`opt-embedding.ts:70 coverageGap(threshold=0.05)`**：本体 §3 明记 embedding 检索是 advisory、不入确定性路径（FUS2）。我判为非业务，但若审核方认为「复用率阈值」是产品可调项，则应列入。
5. **`field-roles.ts:60` 置信度标定 `0.5+gap*0.2`**：A13 角色解析的内部打分刻度。判为非业务，但它决定 `ambiguous` 标志是否触发人工裁决——若视作「产品灵敏度」则属业务。
6. **`service.ts:1422` 的 `600` 与 `portfolio.ts:756` 的 `1.8`（B52/B86）单价口径冲突**：两处都是「订单单价兜底」，量纲疑似不同（元 vs 万元）。我**判不准哪个对**，需要产品口径确认——这可能是一个潜藏的 R18 尺度 bug，而非单纯的 R14 硬编码问题。**建议单独立 WO，不要混进本单**。
7. **`service.ts:2981` 的 `weeklyBase = bases.length * 700`（B73）**：它绕开了 `capacity_rollup` 的真实产能派生链，直接用「基地数 × 700」估周产能。这已经不只是硬编码，是**口径旁路**（违 R-一致「一个事实一个出处」）。是否属本单范围（迁 param）还是该单独修（改为调真产能链）？我倾向后者，请拍板。
8. **`extended.ts` 返回体内的第二份 `ruleRefs` 数组（§4.3）**：是否在 P2 一并收敛进 `SOLVER_RULE_REFS` 的一等化数据？涉及 `countermeasure_combo` 等**不在 contracts 表里**的求解器，会改变 `evaluateRuleRefs` 的评估面（可能引出新的 NOT_APPLICABLE 分支）。范围不小，需明确授权。
9. **`C07/C14/C17/C19/C20` 五个空缺码**：不确定是历史删除还是预留。若 P1 新增规则，应确认是复用这些码还是续 `C34+`。

---

## §7 P1 / P2 实施建议

### P1（阈值一等化 · 数据侧）

1. **先收敛机制，再迁阈值**（否则就是造第 6 套）：在 `SolverContext` 上加**唯一入口** `ruleParam(ruleKey, paramKey, dflt)`，实现读 `c.rules[ruleKey].params[paramKey]`（M3 底座），签名与 `sim/propagation.ts effectiveCoefficient` 的解析语义对齐（引用优先、缺失回落内联）。随后：删掉 `service.ts` 的 4 处重复 `coeff()` 闭包与其重复 `repos.rules.list` 全表扫；`risk.ts:506` 改走新入口；`opt-binding.ts:28` 的死接口 M5 就地实现或删除（二选一，别留着）。
2. **补种 §5.2 的规则 `params`** + 新建 6 条 `*_coeffs` 规则进 `battery.ts rules[]`（这样它们才会经 `synthetic/service.ts:225` 真播种，而不是只活在测试里）。
3. **按 §5.2 优先级迁 §2 表阈值**，从 B9/B15/B20/B24（单值、语义清晰、恰好对应一条已存在的规则）起步。
4. **SEAM 测试（CLAUDE.md 接缝门硬要求）**：不是「改了 param 单测能读到」，而是**端到端**——播种态起服务 → 改 C28 `idleDaysThreshold` 90→30 并发布 → 同一 `inventory_optimize` 调用的 `idle[]` 真变 + `ruleSetVersion` 变。**且必须覆盖 M2/M3 双路径**：改 `base_outlook_coeffs.overtimeUpliftPct` → `base_capacity_outlook`（查库路径）与 `risk_timeline`（ctx 快照路径）**两个求解器的输出同步变**。这条是 §4.2 接缝的唯一真判据。

### P2（绑定一等化）：建议选 **独立绑定表**，不用 `RuleEntry.appliesToSolvers`

理由（三条，按权重）：

1. **基数与所有权方向不对**。`SOLVER_RULE_REFS` 是 `solver → rules[]` 的多对多。塞进 `RuleEntry.appliesToSolvers` 等于把它反向存成 `rule → solvers[]`，而**消费点只有一个方向**（`service.ts:4172` 拿 `solverKey` 查 refs）。反向存意味着每次评估都要**全表扫规则再反查**——而 `loadContext` 已经在扫一次了，会诱发第二次全表扫（正是 §4.2 M2 犯的错，别复制它）。
2. **生命周期不同源**。规则由 A2 文档抽取/A5 规则库/合成种子三条路产生（`ruledocs.ts:362`、`app.ts:2966`、`synthetic/service.ts:225`），求解器由 `SOLVER_KEYS`/`catalog.ts` 注册。绑定是**两个注册表之间的关系**，天然属于第三张表；挂在任一侧都会让另一侧的新增走不通（新增求解器时得去改一堆规则记录，荒谬）。
3. **门与事件更好写**。独立 `SolverRuleBinding{tenantId, solverKey, ruleKey, enabled, source}` 可以：让 `rule-closure:check` 从「扫源码字面量」升级为「查表 + 双向校验（ruleKey 存在 ∧ solverKey ∈ SOLVER_KEYS）」；发 `solver_rule_binding.updated` 事件走既有 60s 失效通道；带 `tenantId` 天然满足 R2（而 `RuleEntry.appliesToSolvers` 里塞的 solverKey 是全局概念，租户维度会拧巴）。

**兼容路径**：`SOLVER_RULE_REFS` 保留为**出厂默认种子**（`battery.ts` 播种时物化成绑定行），运行期只读绑定表；contracts 那份降级为 seed 常量而非运行期真相源。这样 `capacity_rollup`（本体已登记的第 20 个）与 §4.3 发现的 `extended.ts` 那批可以**纯数据**补进来，不改代码不发版——这正是 G-10 的验收语义。

**P2 门扩展**：`rule-closure:check` 改查绑定表 + 加两条新断言（① 每条绑定的 ruleKey 有非空定义；② 被引用规则若在 §2 表中有对应 param 名，则该 param 必须存在于规则的 `params`）。第 ② 条是堵「规则播种了但 params 空、求解器仍走兜底」这个 §5.2 里 6 条空 `{}` 规则暴露出来的具体坑。

---

*本文件为 P0 普查产物。未改任何 `solvers/**`、`contracts`、`repo`、测试代码。P1/P2 待审核方过目本台账后另行授权。*
