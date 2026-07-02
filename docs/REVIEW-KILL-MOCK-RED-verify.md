# 复验 · WO-KILL-MOCK-RED（反假推演总攻·三阶段治本）

> 审核方独立复验（真跑·非橡皮章）。**复验前已 `pnpm -r build`（dist fresh·避免 stale-dist 误判）**。真起 datacore 内存态（SEED_DEMO=1·127.0.0.1:4001）逐条 curl + 静态核 + 门。

## 核心结论（诚实）
**根断点真治本 = 成立**：洛阳·无真源因子（物流时长）不再哈希造假红，返诚实空态。**但 阶段② 前端消费门未覆盖驾驶舱决策组件（ProblemPanel 等），C7 实质未达**——`affected_orders` 返 `dataMode:SYNTHETIC` + 8 条财务问题，ProblemPanel 无 dataMode 守卫、逐条渲染 `var(--danger)` 硬红「影响 N 单·9.5 亿」下钻卡。**违背本 WO 自身原则（SYNTHETIC/非 LIVE ⇒ 决策级红排除·灰·空态），且 ProblemPanel 明列 阶段② scope。→ 门红不核发·BLOCK（窄修）。**

## 逐条判据（真证据）
| # | 判据 | 真证据 | 判 |
|---|---|---|---|
| C1 | 无真源因子 risk_timeline → MOCK·crossDay=null·不吐假红 | curl 洛阳·物流时长 → `{dataMode:MOCK, cards[0]:{hasData:false, currentTightness:{value:null,live:false}, noDataReason:"该基地×因子无真实数据源…不参与越线判定—请接入…"}}`·planRows=0 | ✅ **真诚实空态** |
| C2 | orderFullchain 交期不来自硬编码×700·读真 computeRollup | curl order_fullchain → `dataMode:SYNTHETIC·deliveryJudge:"不建议接"`（合成诚实标·非假 LIVE）·静态 service.ts:1129 删×700 读 computeRollup | ✅ |
| C3 | genuine-sim:check v2 语义门 | `node scripts/check-genuine-sim.mjs` → exit 0（**但保守哨兵：只钉 risk_timeline/capacity/bottleneck + RiskBoardView/ProjectSimView·不覆盖 ProblemPanel/PlanDrill**） | ◐ 绿但不覆盖驾驶舱 |
| C4 | 生产求解器路径零 mockTightness 调用 | `grep mockTightness(` apps/datacore/src/solvers 排除定义行29+注释 → **零真调用** | ✅ |
| C5 | 洛阳·设备OEE 不再红（真浏览器像素级） | dev VITE_MOCK RiskBoard 截图（`phase2-c5c6-riskboard.png`）·审核方 curl 佐证后端 SYNTHETIC/MOCK 抑制链·**未独立起真双服务浏览器验 DashboardView** | ◐ 后端证·RiskBoard 侧 |
| C6 | 有真数据→红越线照常（非无脑灭红） | dev 截图·后端 bottleneck LIVE 真值 | ◐ |
| **C7** | **凡渲染 danger/越线/✗裁决决策组件·数据路径必有 dataMode 分支守卫** | **ProblemPanel（DashboardView.tsx:163）硬编码 `borderLeft:"3px solid var(--danger)"`·无 dataMode 守卫·真 curl `affected_orders` dataMode=SYNTHETIC+8问题·/b 代理(server.ts:1684)透传 dataMode·前端不读→8 张 SYNTHETIC 硬红决策卡。PlanDrillWidget(:291/296) offTarget「未达成」/OrderLedgerWidget(:245) delay 同无守卫。仅 MetricStrip(:665)/Counterfactual(:689) 有守卫。** | 🔴 **实质未达** |
| C8 | 四包全绿 + 本体回写 | **审核方独立复跑（dist fresh）：datacore 860 passed/15 skipped·frontend 327 passed**·§8 G-DM-1 ✅ | ✅ 测试绿 |

## BLOCK 理由（窄·可快修）
**阶段② 前端消费门未完成**：dev 已给 MetricStrip/Counterfactual 补 dataMode 守卫（正确范式 `miss = m.miss && (m.dataMode==null || isLiveDecision(m.dataMode))`），但**未覆盖同页 ProblemPanel / PlanDrillWidget / OrderLedgerWidget**——而 ProblemPanel 明列本 WO 阶段② scope（"DashboardView（MetricStrip/Counterfactual/**ProblemPanel** 补 dataMode·MOCK→空态）"）。

**dev 前提有误（curl 证伪）**：dev 交付说明称"后端多未下发 dataMode 故其真裁决不变"。**实测 `POST /a/v1/solvers/affected_orders/invoke` → `dataMode:"SYNTHETIC"`**（8 problems·财务 9.53 亿），且 `/b/v1/solvers/:key/run`（server.ts:1684 Promise.race 直返 dataCore.solver.invoke 全体）**保留 dataMode**——诚实位真到了前端，ProblemPanel 只是没读。故非"后端没给"，是"前端没消费"。

**危害**：驾驶舱（CEO/规划员每天第一眼）现渲染 8 张 SYNTHETIC 来源的硬红「影响 N 单·X 亿」可点决策卡，违背本 WO 与用户反复强调的第一性原则（无真数据/合成→诚实空态·绝不伪造决策级红）。这正是"绿门≠达标"（genuine-sim 绿因其不覆盖 ProblemPanel）。

## 窄修要求（BLOCKED→dev·可快闭）
1. **ProblemPanel / PlanDrillWidget / OrderLedgerWidget（delay/gap 红）** 补 dataMode 守卫（复用已有 `isLiveDecision`/`decisionColor` 范式）：`dataMode!=="LIVE"` ⇒ 决策红降级为中性灰 + 标"估算/合成·不作决策依据"（或诚实空态）。ProblemPanel 的 `.data` 已含 `dataMode`（直接读，无需改后端）。
2. **genuine-sim:check v2 扩齿**：把 ProblemPanel/PlanDrill/OrderLedger 的 dataMode 守卫纳入门断言（破守卫→门红），使 C7 的门真覆盖驾驶舱决策面（当前门是"保守哨兵"·不覆盖→绿门漏真洞）。
3. 真浏览器像素级复验 **DashboardView**（非仅 RiskBoard）：demo 种子下 ProblemPanel 8 卡应为中性/带诚实标·非 `rgb(224,98,108)` 硬红。

## 决策视图 dataMode 守卫覆盖普查（grep isLiveDecision/decisionColor/dataMode）
| 视图 | 守卫命中 | 判 |
|---|---|---|
| RiskBoardView | 22 | ✅ 重点覆盖（洛阳原案·主战场） |
| SandboxView | 6 · ProjectSimView 6 · KsfGraph 7 | ✅ 已守 |
| **DashboardView** | 10（**仅 MetricStrip/Counterfactual·ProblemPanel/PlanDrill/OrderLedger 未守**） | 🔴 半守·curl 证 ProblemPanel 8 SYNTHETIC 红卡 |
| **SopBalanceView** | **0**（WO 阶段② 明列"同理"·零守卫） | 🔴 名列 scope 零落地·需扫 |
| ProvenanceDag | 4 守 / 8 danger 点 · OrderChainView 3 守 / 4 danger | ◐ 部分·需扫剩余 danger 点是否 decision-red |
| AnnualScenarioView | 0 守 / **0 danger 点** | ✅ 无 danger 渲染·无需守 |

> **结论**：阶段② 前端消费门**不均匀**——主战场（RiskBoard·洛阳原案）扎实，但驾驶舱 ProblemPanel（curl 硬证 SYNTHETIC 红）与 SopBalanceView（名列 scope·零守卫）等仍漏。C7 "凡渲染 danger 决策组件必守" 实质未达。BLOCK 要求：**逐个决策视图扫 danger/越线渲染点补 dataMode 守卫（复用已建范式）+ genuine-sim 门扩齿覆盖之**。审核方仅对 ProblemPanel 做了 curl 级硬证；SopBalance/ProvenanceDag/OrderChain 的剩余 danger 点由 dev 逐点核（本 grep 为线索非终判）。

## 已达·不否定（核心真进步）
C1（洛阳诚实空态）/C4（零 mockTightness 调用）/后端 dataMode 透传链 = **真治本·根断点已闭**。本 BLOCK 是 阶段② 前端侧的**窄完成缺口**（2/5 决策组件已守·补齐剩 3），非否定后端与 risk 主链的扎实交付。

## 本体引用与影响
- 不变量：R13/R8/R30——后端已闭·前端驾驶舱侧未闭（ProblemPanel SYNTHETIC 红）。
- 断点：G-DM-1「MOCK/无真源值上线为决策级红」——后端转 ✅·**前端消费门在驾驶舱决策组件仍半开**（本 BLOCK 促其全闭）。
- 门禁：genuine-sim v2 需扩覆盖驾驶舱决策组件（现保守哨兵漏 ProblemPanel）。

---

## 复验二轮（退回窄修 053d705+046402e）→ ✅ DONE

审核方逐层真验（非信 dev 自报）：
1. **代码守卫**：5 决策点全补 `notLive = data?.dataMode!=null && !isLiveDecision(...)`（DashboardView ProblemPanel/OrderLedger/PlanDrill + SopBalance MrpTable/PnlTable），复用 DecisionValue 范式，仅显式非 LIVE 抑制 → 未标 dataMode 的真值保持红（C6 不误灭）。
2. **后端接缝 curl 硬证**：affected_orders / plan_rootcause / mrp_netting / finance_pnl 四 solver 均在 `data.dataMode` 顶层返 `"SYNTHETIC"`（与前端读取路径逐字对齐）；`invokeSolver` 直连 `/a/v1/solvers/{key}/invoke`（endpoints.ts:204，无中间层吞字段）。
3. **C5 真浏览器**（Playwright + 真双后端 + vite 真后端模式，登录 demo/admin）：`/v/dash` ProblemPanel `data-decision-mode=MUTED`，8 张 SYNTHETIC 决策卡边框全为 `rgb(103,115,127)`(--muted2)、零 `rgb(224,98,108)`(--danger)，诚实文案「合成/估算数据·不作决策依据」已渲染。截图 dash-c5.png（会话交付）。
4. **门禁全绿**：`pnpm -r test` exit 0 · `pnpm gates` exit 0（34 门含 genuine-sim v2）。
5. **牙齿自证**：手动还原 ProblemPanel 硬编码 danger → `genuine-sim:check` exit 1（⑨ 齿两条精确报错）→ 复原 → exit 0。改守卫即门红，回潮被锁死。

诚实边界（登记非隐瞒）：
- SopBalance mrp/pnl 守卫已入码（diff 复核）但⑨齿只锁 DashboardView 三组件——SopBalance 守卫未齿锁，属可接受小债（后续扩齿可并入任一 sim 相关 WO）。
- dev 披露 render-proof jsdom harness 超时不稳 → 以门扩齿承接；审核方以真浏览器渲染取证补强（强于 jsdom）。

---
## AUDIT-LOG-UI 复验（bf1a4ba）→ ✅ DONE
- C1 curl：两次 PATCH usr_demo_planner → audit-log 1→3；顶条 iam.user.updated·actor=admin·before.displayName=复验C1→after=复验C1b（前后值忠实）。
- C2/C3/C4 真浏览器 8/8：/admin/audit-log 渲染·平台治理组入口 3 处·顶条同 curl 值·展开 before→after diff 忠实·action 客户端筛(3→1)·actor 服务端筛(不存在→诚实空态)。截图 audit-c3.png。
- C5：fetchAuditLog 存在·AuditLogEntry import 自 contracts 未重定义。
- C6：pnpm -r build && test && gates 全 ALL_GREEN。本体 §8 G-VIS-1 首单回写。
