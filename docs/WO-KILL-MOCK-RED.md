# WO-KILL-MOCK-RED · 反假推演总攻：无真数据 → 诚实空态，绝不伪造决策级红/裁决

> **由来**：用户点「预判推演看板」洛阳·设备OEE，D+6 显红色越线，下钻却「无在产订单」——红是后端 `mockTightness` 哈希造的假越线（无真设备数据回落），前端照画红只贴个「估算」徽章。用户第一性原则被违反：**推演/决策/告警必须基于真实数据；无真数据应诚实空态，不得伪造决策级数值。诚实标注 mock ≠ 满足原则——把假的老实贴个「估算」标签，它还是假的。**
> **3 路审计确认这是系统性结构缺口**（非孤例）：披露层（dataMode 诚实位）完整，**消费层缺一条强制接线**——全链无一处把 MOCK 转成「排除/灰/空态」。

## §0 违规全景（3 路扫描合并·排序·file:line）

### A. 后端求解器伪造决策级值（路1）
| 严重 | file:line | 伪造什么 | 手段 |
|---|---|---|---|
| P0 | `apps/datacore/src/solvers/risk.ts:29-39` `mockTightness` | 基地×因子紧张度(可越线红) | 基地名+因子名 charCodeAt 哈希·`primaryBase=88 > threshold=85` **恒红** |
| P0 | `risk.ts:165` `liveTightness` 回落 | 无真源因子紧张度 | `return {value: mockTightness(...), live:false}`（**根语句**） |
| P0 | `risk.ts:189` `bottleneckMatrix` MOCK 分支 | 整张瓶颈矩阵格子 | 逐格 `mockTightness` 哈希染红 |
| P0 | `risk.ts:293` `tensionSeries` baseline | 90 天风险曲线基线 | `cur = baseline ?? mockTightness(...)` → 第1天就红 |
| P0 | `apps/datacore/src/solvers/service.ts:1129-1157` `orderFullchain` | 订单交期裁决(可接/提价/不建议接) | 硬编码 `weeklyBase = 基地数 × 700` 当产能算 P50/P90·前端 Provenance 却写"真产能×OEE×良率" |
| P0 | `apps/datacore/src/solvers/extended.ts:542` `deriveExtendedArgs` | 方案推荐紧迫度 | 硬编码 `tightness: 85`·`extendedDataMode` 还标 "LIVE" |
| P1 | `extended.ts:56` `mitigationSelect` | 方案 urgency 评分 | `num(args.tightness, 85)` 默认 |
| P1 | `risk.ts:504-538` `auditTimeline` | 审计项 90 天曲线+越线峰 | `hashString(kind)` → peakVal 恒 ≥threshold+2 |
| P1 | `risk.ts:224-270` `riskEvents` | 事件量化数字(停机天/齐套率…) | `hashString%mod` 系列(锚点真·数字哈希) |
| P2 | `risk.ts:274-278` `riskTarget` | 曲线目标终值 | charCodeAt 哈希 lift |
| P2 | `risk.ts:666/770/780` `affectedOrders` | 延误抖动+营收兜底单价 | `hashString%jitter` + `?? 0.6` |

### B. 门 + 诚实位结构缺口（路2）
- `scripts/check-genuine-sim.mjs`：**只断言「dataMode 字段存在 + 『估算/实测』文案存在」，对 series/peak/crossDay/planRows/verdict 的渲染行为零断言**。MOCK 卡 peak=95/crossDay=D+7 原样渲红，门全绿。
- `scripts/check-no-silent-mock.mjs`：只查 `SOLVER_OUTPUT_SHAPES[k]` 含 `"dataMode"` 字符串（`service.ts:196` 循环恒补），**连运行时求解器吐没吐 MOCK 红都不查**。
- `service.ts:1853 applyConfidenceDimensions`：连 **SYNTHETIC（纯合成·零真实接入）也只把头条改「SYNTHETIC」字样，红峰值一分不减**。
- 本体 §8 断点表**没有一条**登记「MOCK 值上线为决策级红/裁决」这类洞。

### C. 前端消费层零抑制（路3）
- **全前端没有一处按 dataMode 抑制决策红**（grep 确认）。诚实性一律=红旁贴徽章。
- 可复用祸首：`components/DailyDotAxis.tsx`（签名不含 dataMode）、`components/Risk/RiskPopover.tsx`（`RiskPopoverData` 不带 dataMode）——被多视图共用，一改多处受益。
- P0：`RiskBoardView.tsx:118/127/169/183/499`（主板假红·洛阳原案）、`RiskPopover.tsx:19-22`、`DailyDotAxis.tsx:41-42/52/69`、`KsfGraph.tsx:90-112`（连徽章都没有）、`SandboxView.tsx:367-372`、`DashboardView.tsx:662/684/162`（驾驶舱 KPI红/反事实/问题卡三处）。
- P1：`SopBalanceView.tsx:351-352/456/664-675`、`ProjectSimView.tsx:519/531/552/824-829`、`ProvenanceDag.tsx:159/162`、`KsfGraph.tsx:56/76`、`OrderChainView.tsx:346`、`AnnualScenarioView.tsx:149/175`。
- **契约缺字段**（前端想守也守不住）：`packages/contracts/src/solvers.ts` 的 `counterfactual/metric_rollup/plan_rootcause/ksf_graph` 输出 + `RiskPopoverData/DailyDotAxisProps/MetricRow/CounterfactualData/DagData/KsfGraphData` VM 均缺 `dataMode`。
- **mocks/ 已排除泄漏**：`src/mocks/*.ts` 只经 MSW 在 `VITE_MOCK=1` 挂载·无 app 视图 import·不结构性泄漏。病在「真实模式后端返 dataMode=MOCK·前端不认这个标」。

### D. 整改范式（库里已存在的「做对了」·照抄）
`capex.ts`（病态输入 throw `IRR_DIVERGED` 不兜底）· `cockpit_kpi/plan_rootcause/ksf_graph/mrp_netting`（空数据 throw 或返 0/空态）· CP-SAT 优化族（未接引擎显式抛「未接入」）· `SandboxView.tsx:184/233` 雷达（`hasData=false → 灰轴+不画顶点`真排除）· `EvaluatedRules.tsx`（NOT_APPLICABLE 显式诚实）· `RiskBoardView.tsx:512-575 AffectedOrdersModal`（无订单诚实解释）。

## §1 修法（三阶段·端到端·治本非贴标签）

**核心原则落地：`dataMode`/`live` 从「徽章」升级为「渲染门」——`dataMode!=="LIVE"`（MOCK/SYNTHETIC/无真源）⇒ 决策级输出（红/越线/裁决/推荐/delta）一律排除/灰/空态，绝不渲染为可行动结论。**

### 阶段① 契约 + 后端治本（根）
1. **契约补 `dataMode` 字段**（`packages/contracts/src/solvers.ts`）：`counterfactual_timeline / metric_rollup / plan_rootcause / ksf_graph / affected_orders` 输出补 `dataMode: SolverDataModeSchema`；端到端透传。
2. **`risk.ts` 无真源 → 不伪造**（照 `demandCapacityTightness:121` 的 `{value:0, live:false}` 范式，进一步到"该因子不参与决策"）：
   - `liveTightness:165`：无真源返回 `{value:null, live:false, hasData:false}`，**不再 `return mockTightness(...)`**。
   - `tensionSeries:293`/`bottleneckMatrix:189`：`hasData=false` 的因子/格子 → **不产红点**（series 该因子标"无数据"·矩阵格灰）。
   - MOCK 卡（`!live`）：`crossDay` 强制 `null`、**不进 `cards` 的决策级筛选**、**不进 `buildRiskPlanRows`**（`risk.ts:344/439`）。决策级越线/处置工单只能来自 `live===true`。
3. **`service.ts:1129 orderFullchain`**：交期 P50/P90 读 `computeRollup` 真周产能（capacity.ts 已有），**删硬编码 `基地数×700`**；无真产能 → 交期维标"无数据·不裁决"，不吐假 P90 结论。
4. **`extended.ts:542/56`**：`tightness` 从真风险卡（risk_timeline 真 currentTightness）取；无 → 不推荐/标"无紧迫度数据"，**删硬编码 `85`**；`extendedDataMode` 对无真源分支返 MOCK（不得标 LIVE）。
5. **保留 `mockTightness` 仅作 VITE_MOCK 演示**（若前端 mock 需要）·但**生产求解器路径任何调用点删除**（穷举 grep `mockTightness` 全调用点逐一改）。

### 阶段② 前端消费门（治本·抽象复用）
1. **抽 `<DecisionValue>` / `decisionColor(value, threshold, dataMode)`**（新 `components/DecisionValue.tsx`）：`dataMode!=="LIVE"` → 返回中性灰 + 把"越线/✗/峰值削减/裁决"降级为"估算·不可作决策依据"（或空态）。**替换所有 `heatColor(v,threshold)` / `>=threshold?var(--danger)` 直用点**。
2. **给可复用祸首补 dataMode 入参并分叉**：`DailyDotAxis`（签名加 `dataMode`·非 LIVE 不画红越线）、`RiskPopover`（`RiskPopoverData` 加 `dataMode`·MOCK→灰）。这两个一改，RiskBoard/OrderChain/KsfGraph/PlanAudit 多处受益。
3. **逐个决策视图据 dataMode 分叉**（照 `SandboxView:184/233` 雷达排除范式）：RiskBoardView（MOCK 卡整卡灰/移出网格/"待接入实测"·planRows 按 dataMode 过滤）、SandboxView:367（红判定 `&& dataMode==="LIVE"`）、DashboardView（MetricStrip/Counterfactual/ProblemPanel 补 dataMode·MOCK→空态）、ProjectSimView/SopBalanceView/ProvenanceDag/KsfGraph/AnnualScenarioView 同理。
4. **无真数据 → 诚实空态文案**："该基地×因子无真实数据源，不参与越线判定——请接入真实设备/订单数据（连接器与上传）"，**不出红**。

### 阶段③ 门 + 本体（防回潮）
1. **`check-genuine-sim.mjs` v2（语义门·治本）**：从「存在性」升级为「行为」——导入 dist，构造**零真数据 SolverContext**（无 Equipment/Order/DemandSegment/SopVersion），真调 `risk_timeline/bottleneck_matrix/capacity_forecast/order_fullchain`，**断言 `dataMode∈{MOCK,SYNTHETIC}` 时决策级字段为空/中性**（`cards[].crossDay===null`、`planRows.length===0`、`verdict` 非红态、`bottleneck` 格无红）。把该调用行注释掉 → 门必红（牙齿自证）。
2. **展示层门**（仿 no-silent-mock 展示版）：静态断言「凡渲染 `var(--danger)`/"越线"/✗ 裁决的决策组件，其数据路径上必有 `dataMode` 分支守卫」。
3. **本体回写**（铁律0·必做）：`docs/SYSTEM-ONTOLOGY.md` §8 新增断点 **G-DM-1「MOCK/无真源值上线为决策级红/裁决/推荐」**（登记这类洞）；§5 R13 检测点从 `genuine-sim:check`（存在性）升级为 `genuine-sim:check v2`（语义：MOCK⇒无决策级输出）；§4 记 `dataMode` 消费不变量。

## §2 验收契约（反偷懒·目标/测试标准/测试方法·端到端锚在用户原案）

GOAL：用户在预判推演看板点**任何无真实数据源的基地×因子**（如洛阳·设备OEE），看到的**不再是哈希造的假红越线**，而是诚实"无真实数据·不参与越线判定"（灰/空态·引导接入真实数据）；**红越线只在有真数据时出**（真设备OEE/真订单→真产能负载）；且门永久挡住"MOCK 值上线为决策级红"的回潮。

| # | 测试标准(可证伪·带期望) | 类型 | 测试方法(精确可复现·产出即证据) |
|---|---|---|---|
| C1 | 起真 datacore(SEED_DEMO)：对**无真设备 OEE 数据**的基地×设备OEE invoke risk_timeline → 该因子卡 `dataMode==="MOCK"` 且 **`crossDay===null` 且不在越线 cards / planRows 里**（不再吐 ≥88 的哈希红） | curl | `curl :4001/a/v1/solvers/risk_timeline/invoke -d '{"args":{"base":"洛阳","factor":"设备OEE","horizon":30}}' | jq '{dataMode:.data.dataMode, cross:.data.crossDay, peak:.data.peak}'` → 期望 crossDay=null·peak 不 ≥threshold（或该卡不返回）·非"SYNTHETIC 也照红" |
| C2 | `orderFullchain` 交期裁决不再来自硬编码 `基地数×700`：读真 computeRollup 产能；无真产能 → 交期维标"无数据"不吐假 P90 | curl | invoke order_fullchain·grep 响应无 `700` 硬编码痕迹·jq deliveryJudge 有真产能溯源或"无数据"（非假 P90） |
| C3 | genuine-sim:check v2 语义门：零真数据 context 真调求解器 → 断言 dataMode∈{MOCK,SYNTHETIC} 时决策级字段空/中性·**把治本行注释掉门变红**（牙齿自证） | gate | `pnpm genuine-sim:check` exit0·脚本含运行时零数据断言·注释 risk.ts 治本行重跑 exit≠0 |
| C4 | grep 生产求解器路径**零 mockTightness 调用**（仅 mocks/ 或测试可留） | gate | `grep -rn 'mockTightness' apps/datacore/src/solvers | grep -v test` → 期望 0（或仅定义无调用） |
| C5 | 前端**真浏览器像素级**：登录 demo/admin→预判推演看板→点洛阳·设备OEE→D+6 **不再红**（灰/中性）·下钻/卡面显"无真实数据·不参与越线判定·请接入"·**页内无 var(--danger) 红越线**（辨识确切色 rgb） | browser | Playwright 真起前后端·点洛阳·设备OEE·截图·`getComputedStyle` 断言该因子峰值/点色 **非 rgb(224,98,108)**(danger)·文案含"无真实数据/待接入" |
| C6 | 对照：**有真数据**的基地×因子（真 Equipment.oee_current / 真订单）→ 红越线**照常出**（真数据出真红·非全灭红） | browser+curl | 造/取一个有真 OEE 的基地×因子→invoke live=true→前端该卡红越线正常渲染（证明不是无脑灭红·而是真数据出真红） |
| C7 | 展示层门：凡渲染 danger/越线/✗ 裁决的决策组件·数据路径必有 dataMode 分支 | gate | 新展示门 exit0·把某决策红改成无 dataMode 守卫 → 门红 |
| C8 | 回归四包全绿 + 本体回写：`pnpm -r build && pnpm -r test` exit0·`pnpm ontology:check && meta:sync` exit0·§8 含 G-DM-1·R13 检测点升级 | gate | 四包全绿·本体门绿·`grep G-DM-1 docs/SYSTEM-ONTOLOGY.md` 命中 |

## 本体引用与影响（铁律0）
- **不变量**：R13（真推演·红/黄/财务数字绝不裸渲染当真值——本 WO 把它从「贴徽章」落到「排除/空态」）· R8（假推演大扫除·这是其残口的治本）· R30（真实数据出真答案·同源）· R6（确定性·无真数据确定性空态）。
- **断点**：**新增 G-DM-1**「MOCK/无真源值上线为决策级红/裁决/推荐」（本体自身洞图此前缺此条）；关联 G-13（源数据不透明残口）。
- **链路**：risk_timeline / order_fullchain / extended 求解器 → dataMode 透传 → 前端决策视图消费（本 WO 补齐"消费层强制排除"这条此前断裂的接线）。
- **回写**：本 WO 落地后回写 §5 R13 检测点(→genuine-sim v2)、§8 G-DM-1、§4 dataMode 消费不变量。

---
*审核方反假推演总攻施工单（3 路审计合并·file:line 全钉·端到端锚用户原案·治本非贴标签）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
