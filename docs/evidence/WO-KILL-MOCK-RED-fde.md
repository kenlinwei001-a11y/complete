# WO-KILL-MOCK-RED · 反假推演总攻 — 交付证据（三阶段治本·C1–C8）

> 用户原案：点洛阳·设备OEE D+6 显红越线，下钻却"无在产订单"——红是后端 `mockTightness` 哈希造的假越线。
> 第一性原则：**推演/决策/告警必须基于真实数据；无真数据→诚实空态，绝不伪造决策级红/裁决。诚实标 mock ≠ 满足原则。**
> 治本 = `dataMode` 从「徽章」升级为「渲染门」：`dataMode!=="LIVE"`（MOCK/SYNTHETIC/无真源）⇒ 决策级红/越线/裁决/推荐一律排除·灰·空态。

## 三阶段（commit）
- **阶段①后端治本**（`risk.ts`/`capacity.ts`/`service.ts`/`extended.ts`/`catalog.ts`/`contracts`）
- **阶段②前端消费门**（`DecisionValue.tsx` + RiskBoard/Sandbox/ProjectSim/OrderChain/Dashboard/ProvenanceDag/Ksf/PropagationTimeline·VM 契约）
- **阶段③门+本体**（`genuine-sim:check v2` 语义门 + §8 G-DM-1）

## 关键根因发现（诚实）
洛阳·设备OEE 在 demo 实为**合成数据**（有合成 oee_current）→ 顶层 `SYNTHETIC`（非 MOCK）。故其假红分两层根治：
- **无任何数据源的因子**（洛阳·物流时长/换型损失）→ 后端 MOCK·crossDay=null（阶段①）。
- **合成数据因子**（洛阳·设备OEE）→ 后端诚实返 SYNTHETIC + 真形值·**前端 `dataMode!=="LIVE"` 抑制红**（阶段②）。
真数据因子（常州真 OEE·LIVE）→ 红越线照常（C6·非无脑灭红）。

## 验收契约 C1–C8 结果
| # | 判据 | 证据 | 判 |
|---|---|---|---|
| C1 | 无真源因子 risk_timeline → MOCK·crossDay=null·不在越线/planRows | 真起 datacore curl 洛阳·物流时长/换型损失 → `{top:MOCK,card:MOCK,hasData:false,crossDay:null,peak:null,planRows:0,reason:"…无真实数据源…"}` | ✅ |
| C2 | orderFullchain 交期读真 computeRollup·删 基地数×700·无真产能→"无数据·不裁决" | `service.ts:1129` 删 `bases.length*700`·读 `computeRollup(loadContext)` Σ可产基地 weeklyWan·无真产能 deliveryJudge="无数据·不裁决" | ✅ |
| C3 | genuine-sim:check v2 语义门·零真数据真调求解器断言决策级空·牙齿自证 | 导入 dist 零数据 ctx 真调 riskTimeline→断言 crossDay/peak=null·planRows=[]；**改回 mockTightness→门红("crossDay=1!==null 伪造越线红")→复原绿** | ✅ |
| C4 | 生产求解器路径零 mockTightness 调用 | `grep mockTightness apps/datacore/src/solvers` → 仅定义+注释·零调用（liveTightness 无真源返 null） | ✅ |
| C5 | 前端真浏览器：洛阳·设备OEE 不再红·显"无真实数据/待接入" | 真 Chromium：`getComputedStyle` 该卡无 rgb(224,98,108) danger·文案含"无真实数据"·截图 `WO-KILL-MOCK-RED-phase2-c5c6-riskboard.png` | ✅ |
| C6 | 有真数据因素红越线照常（真数据出真红·非无脑灭红） | 真 Chromium：常州真数据卡红越线正常；后端 bottleneck LIVE 请求设备OEE 真值(非哈希·非 null) | ✅ |
| C7 | 展示层：决策组件数据路径有 dataMode 分支守卫 | `DecisionValue.decisionColor(v,threshold,dataMode)` 非 LIVE→灰·8 决策视图分叉·genuine-sim ④⑤⑥ 静态门守 | ✅ |
| C8 | 四包全绿 + 本体回写 | `pnpm gates` **exit 0·31 门**（含 -r build 4 包 + v2 语义门）·datacore 859 passed·frontend 327/327·§8 G-DM-1 转 ✅ | ✅ |

## 门 / 测试（真跑）
- `pnpm gates` = **exit 0**（31 门·含 `pnpm -r build` 四包 + `genuine-sim:check v2` + ontology:check/meta:sync）。
- `pnpm --filter datacore test` = **859 passed**（1 例 audit-sink 全套并发 flake·隔离 6/6 绿·与本 WO 无关·属 DR-AUDIT）。
- `pnpm --filter frontend-shell test` = **327/327**。
- green→red→green：C3 语义门牙齿（改治本行→门红→复原绿）；阶段② decisionColor dataMode 守卫（破→4 例红→复原绿）。

## 诚实边界 / 距北极星
- C5/C6 真浏览器走 VITE_MOCK 前端（工单允许）；未起真 datacore 双服务端到端（沙箱限制）——但阶段① FDE 已真 curl 后端·前后端契约一致（dataMode 透传链已证）。
- 展示层门为保守静态哨兵（钉死已闭诚实通道）+ v2 运行时语义门（riskTimeline 零数据行为）；其余决策求解器(counterfactual/plan_rootcause 等)的运行时零数据断言未逐一进 v2（可后续扩，本 WO 钉 risk 主链）。
- Dashboard/Dag/Ksf 等以后端布尔裁决为红的视图采「补 dataMode 字段 + 仅显式非 LIVE 才抑制」，后端多未下发 dataMode 故其真裁决不变（待后端补发即自动生效·避免误灰真裁决）。

## 本体引用与影响
- 不变量：R13（真推演·从"贴徽章"落到"排除/空态"）·R8（假推演大扫除残口治本）·R30（真实数据出真答案）·R6（无真源确定性空态）。
- 断点：**G-DM-1 转 ✅**（MOCK/无真源值上线为决策级红·三阶段治本）。
- 门禁：`genuine-sim:check` 升级 v2（语义·牙齿）·已在 `pnpm gates`。
- 回写：§8 G-DM-1 ✅。

---

## 退回窄修（reviewer BLOCK 09f1d25 → 复修·C7 驾驶舱消费门）
reviewer curl 硬证：affected_orders 返 dataMode:SYNTHETIC + 8 财务问题·/b 透传·ProblemPanel 不读 → 8 张合成硬红决策卡（C7 实质未达）。dev 前提"后端未下发 dataMode"经证伪。
窄修（复用 isLiveDecision·仅显式非 LIVE 抑制·不误灰真裁决）：
- `DashboardView`：ProblemPanel danger 边框 + "影响 N 单·X 亿" 据 `notLive` 降级中性灰 + "合成/估算·不作决策依据"；PlanDrillWidget offTarget「未达成」红、OrderLedgerWidget delay 红 → notLive 门控。
- `SopBalanceView`：MrpTable 现货缺口 + PnlTable 量价本利差异（solver 输出带 dataMode）→ notLive 门控。
- `AffectedOrdersOutputVM` 补 dataMode 字段。
- `genuine-sim:check v2` 扩齿⑨：静态断言 DashboardView 3 决策组件有 notLive 守卫（`borderLeft:"3px solid var(--danger)"` 硬编码即红）。**牙齿自证**：破 ProblemPanel 守卫 → 门红（"ProblemPanel danger 边框未据 notLive 降级"）→ 复原绿。
验收：typecheck 0·dash+decision 测 21/21·**pnpm gates exit0(31门·含 v2 扩齿)**·frontend 327/327。
诚实边界：C5/C7 render-proof 曾试 jsdom 全应用 renderApp + MSW 覆盖 affected_orders·因全仪表盘 harness 超时不稳（非代码问题）→ 遂以**门扩齿(牙齿自证·reviewer 明示=C7 展示层门)** + 现有 dash-problem-drill/dash-new-widgets(21/21 渲染 ProblemPanel) 承接 C7；SopBalance 主表 gm/cash ✗ 来自 fetchSopVersion 域对象(无 solver dataMode)·非 mock-hash·未强灰(诚实标·根因在后端是否给版本 dataMode·另单)；ProvenanceDag/OrderChain 剩余 danger 为真算勾稽(margin/attain)·非合成决策红。
