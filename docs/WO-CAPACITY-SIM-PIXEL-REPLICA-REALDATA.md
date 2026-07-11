# WO · 「产能推演」页 1:1 复刻黑曜石 HTML · 接真求解器(禁 mock) · 重定位到基地卡片下

> **这是什么**:把用户提供的 `锂电产能预测业务建模_决策中台_黑曜石版_1.html` 里的"产能推演"看板,在平台 **1:1 像素复刻**(布局/交互/间距照抄,颜色/字体换成平台 `tokens.css`),**每个元素接到平台已有的真求解器**(禁复制 HTML 的 `hashN`/`riskVal` mock),并把它从左侧导航**移除**、改挂到"产能推演"里**每个基地卡片的『开推演决策』下一级页**。**「推演沙盘」作为独立页/导航项彻底取消,统一并入本看板**——原沙盘的对话/what-if 能力迁入看板"对话态"提问框,就绪认证迁入看板"信任条 + 抽屉"(见 §5)。含四项增强:多方案(数量可选)+比较、缺失信息结构化面板、全元素悬浮溯源、推演过程图。
> **一句话**:**前端照抄 HTML 是易事;真正的活是"让照抄出来的每个数字都来自真求解器+真数据,无真源就诚实标缺、不造假红"——平台后端 90% 已就绪(risk_timeline/mitigation_select/... + dataMode 诚实标),本单是把它们接全 + 补 UI。**
> **诚信红线(最高优先)**:**禁止复制 HTML 的 `hashN()`/`riskVal()`/`mockTightness` 造红**——那正是平台已治本删除的根断点 `G-DM-1`。无真源 → 走平台既有 `dataMode!=LIVE → 灰/noDataReason` 诚实空态,**绝不假红**。
> **状态**:待派单。锚点已核对(平台 `RiskBoardView.tsx`/`risk.ts`/`solver-registry.ts`/`tokens.css` · HTML 行号 · `2026-07`)。

---

## §0 本体引用与影响(铁律 0)
- **对象类型**(母体 §2):`RiskTimelineOutput`/`SolverArtifact`(§2 求解器域)· `ActionType`(R4)· `SimCertification`(§2.I·缺失面板复用其 gaps)。
- **链路**(母体 §3):中枢链(问句→求解器→答案·溯源)。
- **不变量**(母体 §5):**R14** 颜色/阈值/文案全走 config/tokens·零写死 · **R6** 求解器确定性 · **R13** 每元素可溯源(ruleRefs/provenance)· **R2** 租户隔离 · **KILL-MOCK-RED / G-DM-1**:决策级红只来自 `dataMode=LIVE` 真数据,无源诚实灰。
- **断点**(母体 §8):**G-8**(接入)· **G-DM-1**(mock 值上线为决策级红·本单红线守其不复发)。
- **回写**:重定位(沙盘出导航→挂基地卡片)回写母体 §2.I 沙盘域 + 导航信息架构;缺失面板结构回写 §2.I。

---

## §1 复刻范围与"1:1"的准确含义

| 维度 | 要求 | 说明 |
|---|---|---|
| **布局/间距/交互** | **像素 100% 复刻** | 照抄 HTML:KPI 条、基地风险卡网格、逐因素时间轴、方案卡、经营表、处置计划表、嵌入问答、悬浮源 |
| **颜色/字体** | **换成平台 `tokens.css`** | 同一设计语言;`--bg#1A2230→#0E1420`、`--accent#4C90F0→#5B7CFA`、域色 `--c-*` 已存在、字体 Inter+JetBrains Mono 一致。近乎零改 |
| **数据** | **全接真求解器·禁 mock** | HTML 的 `hashN/riskVal/RISG_SOL/AOP_SCEN` 静态数据**一律不搬**;见 §2 绑定表 |
| **入口** | **移出左导航** | 见 §5 重定位 |

> "1:1"= **视觉与交互 1:1,数据源 0:100**(HTML 数据一个字节都不进平台)。

---

## §2 后端真数据绑定表(本单核心 · 逐元素接真求解器)

| HTML mock 元素(行号) | HTML 假来源 | 平台真求解器(锚点) | 现状 | 复刻接法 |
|---|---|---|---|---|
| 基地风险卡·越线日/峰值(`:2454`) | `riskVal()`/`hashN` 恒红 | `risk_timeline`(registry:59)+`demandCapacityTightness`(risk.ts:138) | ✅**已真**·带 dataMode·无源灰(治 G-DM-1) | 接 `invokeSolver("risk_timeline")`;**禁 hashN** |
| 逐因素时间轴 rk-dots·30/60/90天(`:2545`) | `riskVal(b,f,d,H)` hash | `risk_timeline` series(逐日 tightness) | 部分真:真需求-产能→LIVE;纯设备/物流因素无源→`null`灰 | 接 series;无源诚实灰(§4) |
| 多方案 rk-sol(`:2560`) | `RISK_SOL[factor]` 静态 | `mitigation_select`(registry:64·plans/recommended/draftPayload) | ✅**真求解器** | 接 `mitigation_select`;+§3 数量可选+比较 |
| 采纳→工单(`:2561`) | `adoptRiskSol()` | `adopt_mitigation` ActionType(R4 审批) | ✅真·草稿待审批 | 接 `adopt_mitigation`(不直改真值) |
| 受影响订单经营表(`:2477` econTable) | `ordEcon()` hash 价/利 | `affected_orders`(registry:60·marginLedger 真价/利 SEG_REGISTRY 勾稽闭合) | ✅**真·闭合** | 接 `affected_orders` |
| 三情景对比 scen-card(`:3252`) | `AOP_SCEN` 静态 | `capex_scenario`(registry:63·demand/S/G/windows/c23) | ✅真 | 接 `capex_scenario` |
| 订单三关联判 orderJudge(`:3318`) | hash 价/覆盖/周供给 | `quote_margin`+`kit_readiness`+`credit_exposure`+`capacity_rollup` | ✅真·4 求解器 | 接四求解器 |
| 季度滚动 Q_ROLL(`:3275`) | 静态 | `quarterly_gap`/`capacity_forecast`(registry:75/57) | ✅真 | 接 |
| 处置计划表 planTable(`:2461`) | `buildRiskPlanRows()` | `plan_generate`/`plan_audit`(registry:62/61·liveDefault) | ✅真 | 接 |
| 悬浮源 showRiskPop/showDayTip(`:2534/2548`) | `linkRules()` 静态文案 | `RiskPopover` + 各 solver 输出 `ruleRefs` | ✅**有组件** | 扩展到全元素(§4 溯源) |
| 订单全链过程图 odNodes DAG(`:3350`) | 静态节点 `det` | `InferenceProcessDag` + solver provenance | ✅**有组件** | 接真 provenance(§4 过程图) |

> **结论**:平台后端**约 90% 已是真求解器**。本单后端工作量主要是"接线 + 补 `risk_timeline` series 逐日输出 + 无源诚实灰",不是造引擎。

---

## §3 增强① 多方案(数量可选)+ 方案比较

- **现状**:HTML `rk-sol` 显固定方案列表;平台 `mitigation_select` 返回 `options/plans/recommended`。二者都**没有"用户选方案数量 + 并排比较"**。
- **改法**:
  1. 方案区加 `[方案数 2/3/4 ▾]` 选择器 → 传 `mitigation_select({ topN })`,后端按性价比返回前 N 个(N 为参数·R14 config 上限)。
  2. 加**方案比较表**(照 HTML `.cmp` 表样式):行=方案,列=消解幅度/起效时间/投入/风险/规则校验/残余缺口,`recommended` 行高亮。数据全来自 `mitigation_select` 输出,**禁自造**。
  3. 每方案"采纳→工单"接 `adopt_mitigation`。
- **验收**:选"4"→出 4 个方案 + 比较表;每格可溯源(§4);切 2/3/4 确定性一致(R6)。

---

## §4 增强②③④ 缺失面板 / 全元素溯源 / 过程图

### ② 缺失信息结构化面板(系统无法推演时·明确列缺什么)
- **来源**:复用 `risk.ts` 的 `dataMode!=LIVE` + `noDataReason`(RiskBoardView:93 已有诚实空态)+ 沙盘 `SimCertification.gaps`。
- **改法**:把散落的"灰/noDataReason"聚合成一个**分类缺件面板**,四类:
  | 类 | 判据 | 例 |
  |---|---|---|
  | **缺主数据** | 无 DemandSegment/对象实例 | "无基地×产品需求预测→紧张度无法算" |
  | **缺时序数据** | 无逐日 OEE/利用率/良率 series | "洛阳无逐设备 OEE 时序→设备因子无法出红" |
  | **缺派生规则** | `worldCompleteness` derivationRules present<needed | "缺 2 条紧张度派生规则" |
  | **缺求解器绑定** | solver 未注册/LLM 未绑 | "mitigation_select 未绑 → 无方案" |
- **红线**:缺 → **显"缺什么 + 去补"**,**不显假数字**(对齐 G-DM-1)。

### ③ 全元素悬浮溯源(鼠标放规则/约束/数据→自动显源)
- **现状**:`RiskPopover` 已对风险 chip 做悬浮源;HTML `linkRules()` 给每条规则挂点击/悬浮。
- **改法**:把 `RiskPopover` 的悬浮溯源**统一扩到每个规则(C08/C15/C18/C23…)、约束、数据字段**——悬浮弹出:`来源系统 / 字段 / 求解器 / ruleRef / dataMode`。数据来自各 solver 输出的 `ruleRefs` + 对象 `provenance`(R13),**零写死**。
- **验收**:鼠标放任一规则码/数字→弹真源;`dataMode!=LIVE` 的源标灰。

### ④ 推演过程图(引用的规则/约束/数据可溯源)
- **现状**:平台有 `InferenceProcessDag`;HTML `odNodes`(:3350)是"订单→本体对象链→三求解器→结论"的可点 DAG,点节点看`判定逻辑/输入数据/源/规则`。
- **改法**:用 `InferenceProcessDag` 渲染真推演链;每节点下钻接 solver `provenance`(输入数据+ruleRefs+source),不是 HTML 的静态 `det`。
- **验收**:点过程图任一节点→出该步真输入/规则/源;链路与实际 invoke 的 solver 序一致。

---

## §5 增强⑤ 统一为一个推演 surface + 两种模式(「推演沙盘」独立页取消)

> **信息架构定案(本单唯一 surface 原则)**:平台**不再有两个推演入口**。"推演沙盘"作为**独立页 / 左导航一级项彻底取消**,一切收敛到唯一 surface = 本"产能推演"看板。原沙盘能力**不丢**,而是并入看板对应位置。

- **一个 surface · 两种模式**(推演不局限对话,但两态都在同一看板内):
  | 模式 | 入口 | 形态 |
  |---|---|---|
  | **嵌入场景态**(主) | 基地卡片『开推演决策』/『风险传播』→ 选 X 天 | 产能推演看板(时间轴/方案/过程图)·**非对话** |
  | **对话态**(辅·同一看板内) | 看板内"提问"框 / AI 指挥台 | 自然语言问 → 同一批求解器 → 同源答案 |

- **重定位(彻底)**:
  1. **左侧导航删除"推演沙盘"一级项**——不再是独立菜单/独立页。
  2. 唯一入口 = **"产能推演"页 → 每个基地卡片『开推演决策』→ 下一级看板**(scope 聚焦该基地)。
  3. 原 `SandboxView`(对话沙盘)**不再作为独立路由**;`/sandbox` 若保留则 302 重定向到产能推演。其对话/what-if 能力迁入看板"对话态"提问框(复用同一批求解器)。

- **并入既有两份沙盘 WO(以本单为准 · 杜绝双 surface)**:
  | 此前文档 | 原设定 | 并入本看板后 |
  |---|---|---|
  | `WO-SANDBOX-READINESS-UX` | 沙盘就绪认证进抽屉 | → 看板顶部**一行信任条 + [查看完整体检] 抽屉**(L0-L4/三雷达进抽屉·守 RL3 不动投影) |
  | "问→答→因→行"对话稿 | 独立对话沙盘页 | → 看板**对话态提问框**(问=提问框 · 答/因/行 = 看板结果/过程图/采纳→工单) |

- **母体回写**:§2.I 沙盘域改述"沙盘 = 产能推演看板的下钻态 · 非独立导航/路由";导航信息架构删沙盘项;`SandboxView` 独立路由退役登记。

- **验收**:①左导航无"推演沙盘";②无独立 `/sandbox` 路由(或 302 重定向到产能推演);③基地卡片『开推演决策』→ 进看板 scope=该基地;④对话/嵌入两态走同一求解器同源(R6);⑤就绪认证呈现为**信任条+抽屉**(非独立页)。

---

## §6 前端像素复刻映射(HTML 类 → 平台)

| HTML 类(锚点) | 平台组件/令牌 | 说明 |
|---|---|---|
| `.rk-card`/`.rk-grid`(`:2454`) | 升级 `RiskBoardView` 卡网格 | 照抄间距/圆角/hover;色换 `--c-*` |
| `.rk-dots`/`.rk-frow`(`:2545`) | 新增逐因素时间轴组件 | 逐日圆点·hover `showDayTip`→`RiskPopover` |
| `.rk-sol`(`:2560`) | 方案卡 + §3 比较表 | 接 `mitigation_select` |
| `.rk-tip`(`:197`) | `RiskPopover`(已有) | 扩到全元素(§4③) |
| `.cmp` 表(econTable) | 平台 `.cmp`/表组件 | 接 `affected_orders` |
| `.scen-card`(`:3252`) | 情景卡 | 接 `capex_scenario` |
| DAG `odNodes`(`:3350`) | `InferenceProcessDag`(已有) | 接真 provenance |
| 令牌 `--bg/--accent/--c-*`/字体 | `tokens.css`(已有全套) | **直接换·近零工** |

---

## §7 验收(green→red 自证)
- **像素**:并排 HTML 与平台产能推演页,布局/间距/交互一致(除颜色字体=平台令牌)。
- **真数据(最重)**:每个数字可追到真 solver 输出;**注入 `risk_timeline` 返回全 MOCK/无源 → 页面对应格灰 + 缺件面板列出"缺什么",绝不出红**(green→red:临时把 `demandCapacityTightness` 换回 `mockTightness` → 出恒红 = 违 G-DM-1 = 打回)。
- **多方案**:选 4 → 4 方案 + 比较表 + 每格可溯源。
- **缺件面板**:断掉需求预测源 → 面板显"缺主数据/缺时序",不显假紧张度。
- **溯源**:鼠标放任一规则/数字 → 弹真源(ruleRef/来源系统/dataMode)。
- **重定位**:左导航无沙盘项;基地卡片『开推演决策』→ 进看板 scope=该基地。
- **全局**:`pnpm --filter frontend-shell test` + `--filter datacore test` 全绿;`debattery:check` 绿(R14·颜色走 tokens);`node scripts/check-prd-ontology.mjs` 认 §0。

## §7.5 · 1:1 复刻测试标准(三层分治 · 数据层反直觉 · dev 照此写验收测试)

> **核心**:"1:1"= 结构/交互**严格一致**,颜色/字体**换平台令牌**,数据值**全新且必须真**。三层各有独立口径——混为一谈会写错测试(尤其数据层)。

### L1 结构与几何(UI · 严格 1:1)
- **断言**:每个 HTML 元素在平台有对应 DOM;计算样式几何一致(padding/margin/gap/grid-template-columns/border-radius/对齐/断点)。
- **方法**:computed-style 逐属性比对,**或**同视口截图叠加 diff **但遮蔽颜色/字体图层**。
- **陷阱**:带颜色的像素 diff 会因换皮全红 → 误判;必须做**几何 diff**,颜色字体属性排除出对比集。

### L2 交互与状态(UX · 严格 1:1)
- **断言**:每个可交互点存在且行为一致——30/60/90天切换、瓶颈/订单 tab、卡片展开、hover→tooltip、时间轴逐点 hover→day tip、采纳→工单、问答 chip、基地下拉、方案数量选择+比较。
- **方法**:RTL/Playwright 逐个 replay affordance,断言触发后的 DOM/状态转移与 HTML 一致(复用 `risk-*.test.tsx` 模式)。

### L3 数据溯源(**标准是反的** · 绝不比数字)
- **红线**:**禁止断言"屏幕数字 == HTML 数字"**——HTML 数字是 `hashN` 假值,断言相等 = 逼 dev 抄 mock = 违 G-DM-1。
- **正确断言三条**:
  | # | 断言 | 测试 |
  |---|---|---|
  | a | 每个数字可溯到 SQL 行 | seed 已知 Postgres 行 → 屏显派生自它 + `dataMode==="LIVE"`;`SELECT` 查得回 |
  | b | 无 JS 常量路径 | 删除 mock 常量 → 页面照跑(不依赖任何前端硬编码) |
  | c | 无源诚实空 | 清空该基地 SQL → 灰 + 缺件面板列"缺什么",**不出假数字** |

### JS→SQL 真数据 · 5 条验收用例(本 WO 数据侧的硬门)
1. **Seed→显真**:`INSERT` 一个基地的真需求/产能行 → 页面越线日/紧张度**派生自该行** + 卡 `dataMode=LIVE`(仿 `capacity-basecards-realdata.test.ts:66`)。
2. **Mutate→联动**:`UPDATE` 该行需求 +20% → 屏上越线日相应提前(证 live 绑定非常量)。
3. **Query-back→可溯**:屏上任一数字能 `SELECT` 回其 Postgres 源行(F001=51 式 provenance)。
4. **Anti-mock(green→red)**:把 `demandCapacityTightness` 换回 `mockTightness` → `risk-board-kill-mock-red.tsx` **必须红**;删 HTML 静态常量 → 页面仍正常。
5. **No-data 诚实**:清空某基地需求预测源 → 该卡灰 + 缺件面板显"缺主数据/缺时序",不显假紧张度。

> **复用既有测试**:`capacity-basecards-realdata`(dataMode LIVE)· `risk-board-kill-mock-red`(禁假红)· `risk-live-under-synthetic`(真卡不被顶层合成抹)· `risk-rename-capacity`(命名产能推演)。本 WO 只是把复刻页新元素纳进同一批门。

---

## §8 别做清单
- ❌ 复制 HTML 的 `hashN()`/`riskVal()`/`RISG_SOL`/`AOP_SCEN` 任何静态数据进平台(违 KILL-MOCK-RED)。
- ❌ 无真源时用 `mockTightness` 造决策级红(违 G-DM-1·平台已删,禁复活)。
- ❌ 把 HTML 的黑曜石色值硬写进组件(违 R14·必须走 `tokens.css`)。
- ❌ 保留"推演沙盘"作为左导航一级项(违重定位)。
- ❌ 方案/越线日/经营数字前端自算(必须来自 solver 输出)。

## 附录 · 证据锚点
平台:`RiskBoardView.tsx:28/48-66/93`(risk_timeline invoke·KILL-MOCK-RED 渲染门·noDataReason)· `risk.ts:54`(mockTightness=G-DM-1 毒)/`:138`(demandCapacityTightness 真)/`:211`(dataMode LIVE/MOCK)· `solver-registry.ts:56-80`(capacity_rollup/risk_timeline/mitigation_select/affected_orders/capex_scenario/quote_margin/kit_readiness/credit_exposure/quarterly_gap/plan_generate 全真注册)· `RiskPopover.tsx`(悬浮源)· `InferenceProcessDag`(过程图)· `tokens.css:4-36`(颜色/字体全套)。HTML:`:2437`(h3 产能推演)/`:2454`(rk-card)/`:2545`(时间轴)/`:2560`(方案)/`:2477`(经营表)/`:3252`(情景)/`:3318`(订单判)/`:3350`(过程 DAG)/`:197`(rk-tip 悬浮)。母体 §2/§2.I/§5(R14/R6/R13/KILL-MOCK-RED/G-DM-1)/§8(G-8)。
