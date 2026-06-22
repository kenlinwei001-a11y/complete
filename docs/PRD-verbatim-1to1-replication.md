# PRD · 参考原型逐行 1:1 复刻（verbatim · 全视图 · 取代结构骨架版）

| 项 | 值 |
|---|---|
| 版本 | v1.0 · 状态 DRAFT · 日期 2026-06-22 · 全栈 |
| 性质 | **总纲（取代）**——此前各 1:1 子 PRD（cockpit/aop/sop/quarter/audit/generate/order/inference）是**结构骨架,不足以 1:1**。本 PRD 立 **verbatim 逐行标准** + **每视图精确源行号索引** + **generate 完整样板**,要求实现者把 HTML 的**每个常量/字符串/公式/交互**逐行转抄为生成器种子配置 + 求解器口径（R14/R6,前端零写死）。 |
| 取代 | 升级 `PRD-reference-views-1to1-roadmap.md` 统辖的全部 1:1 子 PRD 为 verbatim 档（它们降为"结构说明",数据/交互以本 PRD 的源行号索引为准）。 |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§5 R6/R13/R14）· **`docs/reference-prototype-decision-platform.html`（唯一 verbatim 真相源）** · `docs/PRD-plan-generate-1to1.md`（结构面）· `docs/REFERENCE-HTML-INVENTORY.md` |

> 一句话：经逐行核对证实——结构骨架式 PRD **会漏会错**（实证:generate 目标是 **6 个不是 5**,漏「库存周转 invTurns」;GEN_PATHS 精确算子/GEN_EXT_SENS 5×3/GEN_FOCUS 5×2 的 why+传播链/timelineFor 9×4/五维评分公式 全未枚举）。**真 1:1 = 把 HTML 对应行的每个常量/字符串/公式/交互逐行复刻**,作为电池域**生成器种子配置**(值)+ **求解器口径**(算法)产出,前端按声明渲染、零写死(R14),同 seed 字节一致(R6)。本 PRD 给出**每视图的精确源行号**(实现者照那些行逐行抄)+ generate 的**完整样板**(§3),并把"像素级对比 HTML"列为验收硬条件。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2）：各视图涉及的全部对象类型 + `Solver`(各视图求解器口径) + `GenSpec/种子配置`（HTML 精确值落点）+ `ViewDef`(声明式渲染)。详见各子 PRD §0 与本 PRD §2 索引。
- **触及链路**（§3）：`HTML 行(verbatim) → 生成器种子配置 + 求解器口径 → 物化/派生/求解 → 声明式渲染 → 像素对齐 HTML`。
- **触及不变量**（§5）：**R14**(每个值/字符串/结构来自种子/配置,前端零写死,`debattery:check`)· **R6**(同 industry,seed 字节一致)· **R13**(每数可溯)· **R-一致**(跨视图同口径)。
- **门禁**（§7）：`debattery:check`·`chain:check`·`ontology:check`·前端回归·**FDE 亲手跑 + 逐元素勾验 + 像素对比**。
- **数据闭环合规**（`PRD-data-closure-spec §6`）：逐项;精确值入 **T3 种子配置**(非 bespoke)· I1 单一上传口 · V1 声明式渲染 · R6/R14。
- **回写承诺**：各视图种子配置/求解器口径落地 → 回写本体 §2/§3。

## 1. verbatim 逐行标准（1:1 的定义,硬）
**1:1 = 逐元素 100% 对齐 HTML,唯色调/字体可调。** 对每个视图,必须把 HTML 源码里的下列四类**逐行转抄**,不得用"结构概括"代替:
1. **常量**：每个 `const` 数据表的**每行每字段**(GEN_GOALS 6 行、GEN_PATHS 5×8 字段、SOP_SEG/SUPPLY/MAT/FIN/VERS、Q_ROLL/Q_LTA、ORDERS 24、MODEL_DEF、KSF_DEF、timelineFor 9×4…)→ 落**生成器种子配置**。
2. **字符串**：每个标题/副标/hint/按钮/徽章/列名/叙事文案(如 GEN_FOCUS 的 why 长文、风险传播链节点标签)→ 落**配置/i18n**,逐字。
3. **公式**：每个计算口径(genPathOutcome 五维评分=50+(gm−底线)×22…、total=均值−硬违规×15、probSeqVal 分段线性+抖动、capacity/MRP/财务测算)→ 落**求解器口径**,确定性。
4. **交互**：每个 onclick/onchange/hover/折叠/跳转/采纳(genSet/genToggleHard/genTogglePlan/probDayTip/genAdopt…)→ 逐项还原。
> 验收锚点：把实现页与 HTML 对应视图**并排截图,逐元素勾**(色/字可不同,**结构/值/字符串/交互必须一致**)。

## 2. 每视图精确源行号索引（实现者照这些行逐行转抄）
> HTML = `docs/reference-prototype-decision-platform.html`。下表给**渲染函数**与**数据常量块**的行号;实现者必须打开这些行,逐行复刻其常量/字符串/公式/交互。

| 视图 | 渲染函数(行号) | 关键数据常量(行号) | 交互/子函数 |
|---|---|---|---|
| **经营驾驶舱 dash** | `buildDash` L3779 | problemAgg/ledger/八卡 KPI + 共享 ORDERS L1558 / SEG_* / RULES | 问题卡/台账逐单 DAG/三线/AI 对话 L3459 |
| **产能推演 risk** | (riskCards/RISK_SOL/FACTOR_OBJ + `riskVal`/`showDayTip`) | BASE_DATA L1526 · MODEL_DEF L1542 · riskCards/RISK_SOL/FACTOR_OBJ · buildRiskPlanRows L3424 | 逐日圆点轴/越线/处置方案/人机对话 |
| **年度情景规划台 aop** | `buildAOP` L3163 | AOP 情景×3/触发条件×4/capex(battery 同源) | 三情景对比/触发挂牌/拍板 Action |
| **月度 S&OP sop** | `buildSOP` L5026 · `sopStep1..5` L5051-5118 | `SOP_MONTH/SEG/SUPPLY/MAT/FIN/VERS` **L4992-5019** | 五步 chips/三线/MRP/量价本利/版本对比/定稿 |
| **季度滚动 quarter** | `buildQuarter` L3200 | `Q_ROLL/Q_LTA` **L3187-3199** | 双条/缺口三档/事件规则深链/跳风险 |
| **规划体检 audit** | `buildAuditView` L4910 · `buildAuditPlanRows` L3426 | 诊断码 X01-X05/R01-R02 · 行动行(owner/start/done/eff/rule) L3427-3450 | 时序逐日轴/KSF 图/最终修正规划表 |
| **规划建议 generate** | `buildGenView` L4602 · `renderGenResult` L4652 | `GEN_GOALS/BASE/PATHS/EXT_SENS/FOCUS` **L4288-4559** · `genPathOutcome` L4560 · `gen3Plans` L4628 | **见 §3 完整样板** |
| **项目/订单推演 order** | `buildOrderView` L3341 · `odNodes`/`odDagSVG` · `orderJudge` L3230 | `ORDERS` L1558 · `MODEL_DEF` L1542 · `ORDER_OVR`/`BOM_T`/`SEG_FLOOR`/`SEG_PRICE`/`SEG_MARGIN` | 选单/6KPI/三判/11 节点 DAG/采纳 |
| **型号产能推演 model** | `renderProjModel` L3728 | `PM_STEPS` · `MODEL_DEF` L1542 · what-if(夜班/通道/外协) | 六步/收敛网络/批量/CSV/DAG |
| **编排推演 DAG story** | `buildStoryDAG` L5135 | `STORY_SHORT/POS/EDGES` **L5118-5131** · steps IPO L1394+ | 10 节点 par/conv/aux/fb/逐节点 IPO |
| **业务建模映射 map** | (VIEWS/N() 决策域对象 L1185+) | 决策域一等对象 L1185-1196 · KINDCOLOR L1481 | 图谱高亮/MappingOverlay |
| **受影响订单聚合** | `buildOrderAgg` L2418 | ORDERS + 问题归并 4 类 | 聚合/逐单/跳转 |
| 共享时序/KSF 引擎 | `timelineFor` **L4342-4405**(9 类×4 阶段) · `probSeqHTML` L4481 · `ksfSVG`/`KSF_DEF` L4407 · `radarSVG` L4594 | SEV_V/anchors/三档图例 | 逐日轴/悬停/KSF 联动 |

> 共享数据(多视图复用,各转抄一次):`MODEL_DEF` L1542 · `BASE_DATA` L1526 · `ORDERS` L1558 · `SEG_PRICE/SEG_MARGIN/SEG_FLOOR` · `RULES_REG`(C01–C25) · `DATASET` L1552(工厂/产线全量)。

## 3. 完整样板 · generate（逐行 verbatim,实现者照此深度做其余视图）
> 这是"够 1:1"的深度基准。其余视图须做到同等颗粒度。

### 3.1 `GEN_GOALS`（6 项 · L4288-4295）
| key | label | v | unit | hard |
|---|---|---|---|---|
| revGrow | 收入增长率 | 18 | % | 软 |
| gmFloor | 毛利率底线 | 15.5 | % | **硬** |
| cashFloor | 现金安全垫底线 | 50 | 亿 | **硬** |
| shareGrow | 市场份额增长 | 12 | % | 软 |
| capexCap | CAPEX 上限 | 20 | 亿 | **硬** |
| **invTurns** | **库存周转(次/年)** | **6.0** | **次** | **软** |
- `GEN_BASE`={rev:3400,gm:16.0,share:18.0,capex:14,turns:5.6,cash:58,demBase:1580}（L4298）。

### 3.2 `GEN_PATHS`（5 条 · L4300-4326,逐字段）
| id | n | c | eff{rev,gm,share,capex,turns,cashD} | rules | risk |
|---|---|---|---|---|---|
| A 保毛利型 | #62BE77 | 1.12,+1.4,+6,0,+0.6,+6 | C15 上浮1pct | 规模不达;流失储能份额 |
| B 保规模型 | #5E8FE8 | 1.22,−0.8,+16,2,−0.4,−4 | C13从严·C18复核 | 毛利击穿;现金压力 |
| C 扩产型 | #9D8BF0 | 1.20,+0.2,+22,27,−0.2,−12 | C23·C18 | C23校验;现金逼近红线 |
| D 外协型 | #D08A66 | 1.16,−0.5,+12,0,+0.2,+2 | C08红线 | C08≤20%;质量波动 |
| E 混合型★ | #54B5C4 | 1.18,+0.4,+14,14,+0.3,−2 | C23枣庄·C08·C15守价 | 执行复杂度最高 |
- desc/tag 逐字见 L4301-4325。

### 3.3 `genPathOutcome` 口径（L4560-4593）
rev=base×eff.rev;revGrowAbs=(eff.rev−1)×100;gm=base.gm+eff.gm;shareGrow=eff.share;capex=eff.capex;turns=base.turns+eff.turns;cash=base.cash+eff.cashD。
达成(容差):meetGM gm≥gmFloor−0.05·meetCash cash≥cashFloor·meetCapex capex≤capexCap·meetRev revGrowAbs≥revGrow−0.5·meetShare≥shareGrow−0.5·meetTurns turns≥invTurns−0.05。
硬违规:gmFloor/cashFloor/capexCap 各违反生成对应 C15/C18/CAPEX 文案。
**五维评分**:盈利=50+(gm−gmFloor)×22·规模=40+shareGrow×3·现金=50+(cash−cashFloor)×4·增长=30+revGrowAbs×2.5·稳健=90−capex×2.2(均 clamp 0-100)。**total=round(Σ/5)−hardViol×15**(≥0)。

### 3.4 `gen3Plans`+卡片（L4628-4745）
3 方案:壹 稳健·守盈利(盈利+现金+稳健 max)/贰 均衡(total max)/叁 进取·冲规模(规模+增长 max);★=可行且 total 最高。卡片:折叠头(序号/名/intent/3KPI带 provSpan 溯源/综合分/取舍分析)+展开体(radarSVG 150/目标达成 6 行/得舍/五维取舍矩阵表/KSF 图 ksfSVG/外部敏感性/执行关键点+问题卡 why+chain+probSeqHTML/采纳→下发AOP)+导引文案。

### 3.5 `GEN_EXT_SENS`(5×3 · L4501-4517)·`GEN_FOCUS`(5×2 含 why+chain4 · L4518-4559)·`timelineFor`(9 类×4 阶段 · L4342-4405)·`KSF_DEF`(5 · L4407-4413)·`radarSVG`(L4594)·`probSeqHTML`(SEV_V{0:64,1:79,2:90};anchors[[0,58]]+阶段;三档<70/70-84/≥85;90 天压缩 · L4481-4500)·AI QA(L3493-3498)。
> **全部逐字段见对应行**——实现者打开这些行转抄,不得概括。

## 4. 数据来源归属（HTML 前端写死 → 系统管线分流）★ 核心
> **本质差异**：HTML 把数据**写死在前端代码里**（`const GEN_GOALS=…`、`SOP_SEG=…` 就在脚本里）；**我们系统代码与数据分离**——前端**不持有任何业务值**,只拿 ViewDef + 求解器/查询输出渲染。所以 verbatim 1:1 = **可见的值与 HTML 逐字一致,但每个值的"出处"必须是管线里的正确一层,不得照抄进 React**（R14/`debattery:check`）。

### 4.1 转抄前先判性质 → 分流到唯一来源（每个 HTML 常量都要走这步）
| HTML 数据类别 | 怎么判 | 系统单一来源（管线层） | HTML 例子 |
|---|---|---|---|
| **① 业务数据·实例** | 是"一条条业务记录"（订单/基地/产线/版本/物料行/情景） | **合成生成器种子 → RawDataset → 物化 ObjectInstance（→派生）** | `ORDERS`(24单)·`BASE_DATA`·`MODEL_DEF`·`SOP_SEG/SUPPLY/MAT/FIN/VERS`·`Q_ROLL/Q_LTA`·`DATASET`(产线全量)·AOP 情景 |
| **② 阈值·默认·系数（口径参数）** | 是"门槛/默认值/作用算子"（可配置,不是记录也不是算法） | **IndustryTemplate / WorkspaceConfig / ViewConfig.layout / SolverParam** | `GEN_GOALS` 默认值+硬软·`gmFloor 15.5`·`capexCap 20`·`GEN_PATHS.eff` 算子·`SEV_V{0:64,1:79,2:90}`·三档图例阈值(70/85)·`GEN_BASE` |
| **③ 计算公式·算法** | 是"由输入算出来的"（评分/传导/聚合/判定） | **求解器代码口径（确定性 R6）——不是数据** | `genPathOutcome` 五维评分(50+(gm−底线)×22…)·`total`·`probSeqVal` 分段线性+抖动·`gen3Plans` 选案·capacity/MRP/财务测算·`orderJudge` 三判 |
| **④ 文案·字符串** | 标题/副标/hint/叙事/规则说明 | **i18n / 配置（行业别名）** | "规划建议"·`GEN_FOCUS` 的 why 长文·风险传播链节点标签·`GEN_EXT_SENS` 解读·导引文案·按钮文字 |
| **⑤ 结构·布局** | 节点坐标/网格/列定义/连边 | **ViewDef / layout 配置** | `STORY_POS` DAG 坐标·11 节点 DAG 边表·grid 列宽·KSF 图布局·五步 chips 顺序（`radarSVG`/`ksfSVG` 几何属"渲染逻辑",随组件） |
| **⑥ 规则** | C01–C25 约束 | **Rule DSL（规则库）** | C15/C18/C23/C08/C13/C21（HTML 里 `linkRules(...)` 引用的） |

> 铁律：**同一字段唯一来源（单一上传口,R-一致）**——一个值只能在①~⑥的某一处,不得两处各写一份。前端**零业务常数**（`debattery:check` 基线 0）。

### 4.2 同一视图的常量会分散到多层（以 generate 为例）
- `GEN_GOALS` 的**默认值**(18/15.5/50/12/20/6.0)+硬软 → **②配置**（ViewConfig/WorkspaceConfig,用户可改）；但用户**改后的实例**不是数据库记录,是会话输入(前端 state 合法,因为它是用户当下输入,非"业务真值")。
- `GEN_BASE`(2027 基准 3400/16.0/58…) → **①业务数据**（AOP 基准情景派生,与 aop 同源,不另写）。
- `GEN_PATHS.eff` 算子(1.12,+1.4,…) → **②口径参数**（IndustryTemplate 或 plan_generate SolverParam,可调）。
- `genPathOutcome`/`gen3Plans` 评分与选案 → **③求解器代码**（plan_generate 口径,前端不算）。
- `GEN_FOCUS` why/chain 文案 + `GEN_EXT_SENS` 解读 → **④i18n/配置**；其 `kind`/`rule`/`chain 对象` 关系 → ⑤结构 + ⑥规则。
- `timelineFor` 9×4 阶段(日期/财务/订单筛选) → **③求解器**（audit_timeline 口径,数字取自①ORDERS,确定性）。
- 卡片折叠/雷达/矩阵/KSF 渲染 → **⑤ViewDef + 组件**（值来自③求解器输出）。

### 4.3 前端的角色（必须）
- 前端**只做声明式渲染**：读 `ViewDef`(结构) + 求解器/查询输出(值) + i18n(文案),**自身不内联任何业务值/阈值/公式**。
- 验收 `debattery:check`：扫前端命中业务常数即红。**这是"代码数据分离"对 1:1 的硬约束**——HTML 那种"const 写在脚本里"在我们这里**非法**,必须分流到①~⑥。

### 4.4 §2 索引需补"来源"列（实现指引）
实现每视图时,对 §2 列出的每个数据常量,**先按 4.1 判类 → 落到对应来源层**,再让前端从该层取。例：`SOP_SEG/SUPPLY/MAT/FIN/VERS`=①(合成种子→物化)；`Q_ROLL/Q_LTA`=①(quarter 已是 quarterlyFromContext 实算,种子对齐)；`SEV_V`/三档阈值=②(config)；`timelineFor`=③(求解器)；`GEN_FOCUS` why=④(i18n)。

> **同 seed 字节一致**(R6)、**逐数可溯**(R13)、**前端零写死**(R14)——三者一起保证"值=HTML 且来源=管线"。

## 5. 验收（DoD = 真 1:1）
- **逐元素勾验**:每视图与 HTML **并排截图**,常量/字符串/公式/交互**逐项核对一致**(色/字可不同)。漏一项即不通过。
- 数据走管线、前端零写死(`debattery:check`);同 (industry,seed) 字节一致(R6)。
- `pnpm -r build && pnpm -r test` 全绿;`chain:check`/`ontology:check` 过。
- **FDE 亲手跑每视图**(不是绿测试)——真人操作每个交互,核对行为=HTML。
- 回写本体 §2/§3。

## 6. 分期（按视图,各做到 §3 深度）
- **V.1** generate(样板已备)→ 校核落地。
- **V.2** sop · quarter(数据密集,种子转抄量大)。
- **V.3** dash · risk(共享时序/KSF 引擎 + 八卡 + 逐单 DAG)。
- **V.4** aop · audit(时序+KSF 复用 risk 引擎)。
- **V.5** order · model(11 节点 DAG + 三判 + 收敛网络)。
- **V.6** story(编排 DAG) · map(图谱) — 横切。
> 每波交付前过 §5 DoD(逐元素勾验 + 像素对比)。

## 7. 与既有 1:1 子 PRD 的关系
- 各子 PRD(`PRD-{cockpit,aop,sop,quarter,plan-audit,plan-generate,order-project-sim,inference-process}-1to1.md`)**保留为结构/接缝说明**(讲清复用哪些求解器、断点、对象类型);**数据/字符串/公式/交互以本 PRD §2 源行号 + §3 样板深度为准**。
- `PRD-plan-generate-1to1.md` 已含 generate 的部分结构;本 PRD §3 是其 verbatim 补全。

> 诚实声明:本 PRD **不把 10000 行 HTML 全文转抄**(那样既不可靠也冗余)——HTML 本身是 verbatim 真相源,本 PRD 给**精确行号索引 + 深度样板 + 逐元素验收**,确保实现者照行复刻、无遗漏、可像素核对。结构骨架式"差不多"被本标准作废。
