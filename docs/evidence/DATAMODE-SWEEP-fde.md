# WO-DATAMODE-SWEEP · FDE 亲手真跑证据（T1 合成充真成片 · KILL-MOCK-RED 漏网点扫齐）

> 目标（用户视角）：demo 租户（合成数据 SYNTHETIC）下打开 4 个决策页，**不得**看到"站不住 / 不建议接 / ✗缺口35万套 / ⛔硬约束违反"被渲染成**决策级真红**——它们必须降级为中性灰 + 顶部披露横幅"此结论基于合成/估算数据·不作真实决策依据"。断点：T1（后端已下发 dataMode，多处 renderer 未消费→合成渲染成决策红）。

## 根因判定（治本·非贴标签）

后端 `SolverService.invoke`（service.ts:1794-1796 + applyConfidenceDimensions）**已保证每个求解器输出带顶层 `dataMode`**，demo 合成租户恒为 `SYNTHETIC`。前端 4 决策页把裁决色（`站不住`=danger / `不建议接`=vc / `⛔硬约束` / `✗缺口`=danger）**直接按状态上色**，未消费 dataMode → 合成充真。

治本：新增两个共享门 helper（`components/DecisionValue.tsx`）——
- `notLiveDecision(dataMode)` = `dataMode!=null && dataMode!=="LIVE"`（与 RiskBoardView 既有判据同源·向后兼容：未标 dataMode 不误灰）；
- `decisionVerdictColor(liveColor, dataMode)` = 显式非 LIVE → `var(--muted)`，否则 liveColor（**分类型裁决**门，与既有 `decisionColor` 阈值门互补）。
- 新增共享 `components/DecisionModeBanner.tsx`（移植风险看板 `risk-confidence-banner` 范式）——非 LIVE 才渲染披露横幅 + `DataModeBadge`。

4 页逐一接门：PlanAuditView（verdict 色/评分/段头 + banner）、PlanGenerateView（⛔硬违规 badge/综合分/达标✗/问题规则红 + banner）、ProjectSimView（capacity_forecast ✗缺口 okBar/批次✗/DAG fc 节点/what-if gap + order_fullchain verdict + banner）、OrderChainView（affected_orders 问题卡红标/延误红 + order_fullchain "不建议接" verdict 节点/结论 + banner）。

## C1 · 后端顶层 dataMode（真 curl · 内存态 datacore :4087 · SEED_DEMO=1）

`POST /a/v1/solvers/{key}/invoke`（X-Debug-User demo:admin），6 求解器 + order_fullchain 全返顶层 `dataMode=SYNTHETIC`（合成租户真值）：

```
metric_rollup     -> dataMode=SYNTHETIC
plan_rootcause    -> dataMode=SYNTHETIC
affected_orders   -> dataMode=SYNTHETIC   problems=credit,lta,ramp,push,crm,cost,frame,maint
capacity_forecast -> dataMode=SYNTHETIC   ok=false gap=35.1793 p50=5.1836 p90=4.8207
plan_generate     -> dataMode=SYNTHETIC
plan_audit        -> dataMode=SYNTHETIC   verdict=站不住
order_fullchain   -> dataMode=SYNTHETIC   verdict=不建议接
```

跨系统同值（agentcore :4088 → datacore OBO）：`POST /b/v1/solvers/capacity_forecast/run` → `dataMode=SYNTHETIC ok=false gap=35.1793`（前端实走此路）。

## C2/C5 · 真浏览器前后端逐值对照（Playwright + chromium · 真起三服务 datacore4087/agentcore4088/前端4090）

真登录 demo/admin/demo1234 → 逐页 screenshot（`docs/evidence/screens/dm-*.png`）+ 读渲染裁决元素 computedStyle：

| 页 | 前端渲染文案 | 前端裁决色（computed） | 后端真值 | 一致？ |
|---|---|---|---|---|
| project-sim | `✗ 缺口 35.2 万套` | `rgb(140,150,166)`=`--muted` 灰 | capacity_forecast gap=35.18 SYNTHETIC | ✅ 文案=后端·色=灰非红 |
| plan-audit | `站不住（评分 43/100）` | 非 danger 红（verdict `<b>` 走 `--muted`） | plan_audit 站不住 SYNTHETIC | ✅ |
| order-chain | `不建议接` + 问题卡红标数=**0** | ofc verdict `rgb(140,150,166)` 灰 | order_fullchain 不建议接 + affected_orders SYNTHETIC | ✅ |
| plan-generate | banner 出（gen-datamode-banner=1） | ⛔硬违规分非 danger 红 | plan_generate SYNTHETIC | ✅ |

4 页均：**披露横幅 present（banner=1）** + 决策裁决**中性灰非决策红**，与后端 SYNTHETIC 逐值对上（"缺口 35.2 万套" ↔ 后端 gap 35.18）。这是"合成不出决策红 + 诚实披露"的真浏览器实证（非 jsdom/非 mock）。

## C3/C4 · jsdom 消费门 + LIVE 对照（牙齿·`test/datamode-sweep.test.tsx` 8 用例全绿）

同一 override 注入后端 dataMode，一对 SYNTHETIC/LIVE 证门是承重的：
- **SYNTHETIC**：4 页裁决降级中性灰（`不含 var(--danger)` / 问题卡 `badge.red` 数=0）+ 披露横幅出。
- **LIVE 对照（C4·非无脑灭红）**：plan-audit 站不住红照常（`style` 含 `var(--danger)`）+ 无横幅；order-chain 问题卡 `badge.red` 数 > 0 + 无横幅。
- 摘掉 gate（`decisionVerdictColor` 恒返 liveColor）→ SYNTHETIC 用例转红失败（同码路仅 dataMode 差 → 门承重）。

## C6 · 回归四包全绿 + gates

- 前端 `pnpm --filter frontend-shell test`：**131 files / 346 tests 全绿**（含新增 datamode-sweep 8 用例；既有 f14/f16/f18/f23/debattery.* 未标 dataMode 保持既有行为·零回退）。
- `pnpm -r build && pnpm -r test && pnpm gates`：见提交贴绿。

## 本体回写

`docs/SYSTEM-ONTOLOGY.md` §8 G-DM-1 / G-VIS-1：追加 DATAMODE-SWEEP（4 决策页 dataMode 消费门补齐·合成充真漏网点闭合）。

## 距北极星还差什么（诚实边界）

- 已覆盖扫描坐实的 4 自身型面（plan-audit/plan-generate/project-sim/order-chain）+ 顺带 order_fullchain 裁决；驾驶舱 metric-strip/根因DAG 由前一 WIP commit（valuePath dataMode 透传）修。
- LIVE 对照为 jsdom 注入（demo 租户无真实 LIVE 数据源）；真浏览器覆盖的是 demo=SYNTHETIC 的**真实缺陷态**（即用户会看到的态）。真 LIVE 红需接入真实数据源租户方能真浏览器实拍。
- 门 helper 为全站共享，后续新增决策页应直接复用 `decisionVerdictColor`/`DecisionModeBanner`（防再漏网）。

---

## FIX 轮（窄 BLOCK 补漏·审核方 1572b8c 复验后 2 类残余）

审核方真浏览器 getComputedStyle 复验确认主扫齐达标，另抓 2 类 decision 级 danger 红在合成页未守（违 WO 自身"凡 danger 决策组件必守 dataMode"）：

1. **毛利率勾稽「对缺口贡献(pp)」负值 cell** 裸 `var(--danger)` 无 notLive 守卫——两处：
   - `DashboardView.tsx` `dash-order-ledger`（summary gapPp + 逐 seg gapContributionPp cell）：加 `notLive`（既在 §204 算）守卫 → 合成→`var(--muted2)`+「·估算」。
   - `shared.tsx MarginLedgerTable`（plan-audit/plan-generate 共用·testId margin-ledger-*）：此前 queryFn 只取 `.marginLedger` 丢顶层 dataMode → 改透传 `{...marginLedger, dataMode: vm.dataMode}` + `mlNotLive=notLiveDecision(data.dataMode)` + `gapColor(v)` 门（4 处 danger：逐 seg/Σ/文末缺口/reconciled 徽章）。
2. **order-chain 问题归并卡 `.probCard`** CSS `border-left: 3px solid var(--danger)`（oc-problem-*×8）无守卫——用页级已算 `ocNotLive`（OrderChainView:105）内联 `style={ocNotLive?{borderLeftColor:"var(--muted2)"}:undefined}` 覆盖 CSS 红边。

**牙齿（datamode-sweep.test.tsx 扩·8 用例仍全绿）**：
- plan-generate SYNTHETIC 用例注入含负缺口贡献 seg 的 marginLedger → 断言 `margin-ledger-generate-table` 内 `[style*="var(--danger)"]` 数=0 + reconciled 徽章非 danger（摘 gapColor 守卫 → 转红失败）。
- order-chain SYNTHETIC 用例断言每张 `oc-problem-*` 的 `style.borderLeftColor` 含 `muted`（合成不出决策红左边框）。

排除（审核方确认非缺陷·未动）：plan-generate hard-chip=硬约束/软偏好配置切换（非裁决输出）· 根因DAG「RED」徽标已 muted · 规则号 C13/C15=RuleRef 链接色。

**前后端一致性（FIX 补充）**：这 2 类均为**合成数据（dataMode=SYNTHETIC）不得渲染 decision 红**的一致性——后端 affected_orders/plan_* 顶层 SYNTHETIC（C1 已 curl 证），前端这 2 面此前漏消费 → 现按同一 notLive 门降级中性。真浏览器复验由审核方按 getComputedStyle 范式再跑（本轮 dev 侧 jsdom getComputedStyle-等价 style 断言 + 既有 6 面真浏览器基线覆盖）。
