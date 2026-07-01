# WO-KILL-MOCK-RED · 阶段②（前端消费门·治本）· FDE 交付证据

> 用户第一性原则：推演/决策/告警必须基于**真实数据**。诚实标注 mock ≠ 满足原则——治本 = 把
> `dataMode` 从「徽章」升级为「渲染门」：`dataMode!=="LIVE"`（MOCK/SYNTHETIC/无真源）⇒ 决策级输出
> （红/越线/✗/峰值削减/裁决/推荐）一律**排除/灰/空态**，绝不渲染为可行动结论。

## 基线校正（关键·诚实记录）

工单称本 worktree「从含阶段①的 `claude/vigilant-knuth-b1nmxn` 分出」。实测本 worktree 初始 HEAD 为
`778cc58`（ontoflow 分支），**不含阶段①**（无 nullable peak / hasData / DataModeBadge / 578 行 RiskBoardView）。
`git merge`/`cherry-pick a624a7d`（阶段①提交）到 ontoflow base 产生大量无关冲突（两分支已大幅分叉）。
遂将本 worktree `git reset --hard claude/vigilant-knuth-b1nmxn`（阶段①所在真基线·含 nullable 契约 +
富前端 + 27 处待修 null 类型错），在正确基线上施工。`pnpm install` + `pnpm --filter @platform/contracts build` 后
`tsc --noEmit` 复现 27 错（planFixtures 13 / RiskBoardView 8 / ProjectSimView 4 / PropagationTimeline 2），
与工单一致，确认基线正确。

## 改动清单

### 新增·核心抽象
- `apps/frontend-shell/src/components/DecisionValue.tsx`（**唯一渲染门入口**）
  - `isLiveDecision(dataMode)`：仅 `"LIVE"` 为真（严格）。
  - `decisionColor(value, threshold, dataMode, opts?)`：非 LIVE 或 value=null ⇒ 中性灰 `var(--muted)`，**绝不返 danger**；LIVE 越阈→danger，关注档→amber，正常档→calm。
  - `decisionHeat(value, threshold, dataMode)`：非 LIVE/null ⇒ 中性灰 rgba；LIVE 三档热力。
  - `<DecisionValue>`：非 LIVE 值降级为灰 + "估算·不可作决策依据"；null→空态；LIVE 越阈显 crossedLabel。
  - `NON_LIVE_HINT` / `NO_DATA_HINT` 统一诚实文案。

### 可复用祸首补 dataMode 分叉（一改多处受益）
- `components/Risk/RiskPopover.tsx`：`RiskPopoverData` 加 `dataMode`（peak 可空）；峰值/日条经 decisionColor/decisionHeat 门；非 LIVE 不显越线日、日条区改诚实空态。**向后兼容：dataMode 未传按 LIVE**（旧 fixture 不误灰）。
- `components/DailyDotAxis.tsx`：`DailyDotAxisProps` 加 `dataMode`；圆点/峰值/越线经门；显式非 LIVE 才灰化，未传→LIVE（PlanAudit/KsfGraph 真曲线保持既有行为）。

### 逐决策视图据 dataMode 分叉
- `views/RiskBoardView.tsx`（**洛阳原案·最优先**）：`cardDecisionMode()` 融合顶层+卡级 dataMode+hasData；
  `hasData===false` 或显式非 LIVE ⇒ 整卡灰/移出越线网格/显 noDataReason/不进首要红标；peak/crossDay null 安全；
  详情弹窗非真数据卡出诚实空态（不画红曲线/日条）；BottleneckDetailPanel 无真源格灰、状态"无实测"；
  planRows 面板顶层非 LIVE 抑制；MiniStrip 经 decisionHeat 门。
- `views/sim/SandboxView.tsx`：风险 TOP3 峰值色 `&& cLive`（顶层+卡级非显式非 LIVE 且 hasData）；peak/baseline null 安全。
- `views/sim/PropagationTimeline.tsx`：`buildPropagation` 越线/财务击穿 sev 仅真数据判；peak 可空；非 LIVE 越线节点文案降级。
- `views/sim/ProjectSimView.tsx`：perBaseRows 紧张度色经 decisionColor/decisionHeat（gate `r.live`，null 安全）；bnMatrix 格显式非 LIVE/null→灰（◉ 结构标记保留·仅红/黄决策色受门控）。
- `views/plan/OrderChainView.tsx`：风险 chip 色经 decisionColor（gate `k.dataMode`）；非 LIVE 不显越线日。
- `views/DashboardView.tsx`：MetricStrip（MetricRow 补 dataMode·显式非 LIVE 抑制 miss 红）；CounterfactualWidget（补 dataMode·非 LIVE→诚实空态·不出 delta 结论）。
- `components/ProvenanceDag.tsx`：DagData 补 dataMode·显式非 LIVE ⇒ KPI RED status 降级中性灰。
- `components/KsfGraph.tsx`：KsfGraphData 补 dataMode·显式非 LIVE 抑制问题严重度红；audit_timeline→DailyDotAxis 透传 dataMode。

### VM 契约补 dataMode + null（前端想守也得有字段）
- `api/types.ts`：`OrderRiskRefVM.peak` 可空 + 加 `dataMode`。
- `views/DashboardView.tsx`：`MetricRow` / `CounterfactualData` 加 `dataMode`。
- `components/ProvenanceDag.tsx` `DagData` / `components/KsfGraph.tsx` `KsfGraphData` 加 `dataMode`。
- `mocks/planFixtures.ts`：`riskRef` 透传 dataMode（peak 可空）。
- `mocks/fixtures.ts`：RISK_TIMELINE 增 **洛阳·设备OEE 诚实空态卡**（dataMode=MOCK·hasData=false·peak=null·series=[]·noDataReason）——用户原案落 mock，供浏览器 C5/C6 与 demo 演示诚实。

**设计口径统一：仅「显式非 LIVE」(MOCK/SYNTHETIC/STALE/PARTIAL) 或 hasData===false 才抑制决策红；
未标 dataMode 的旧 fixture / 真 LIVE 保持既有行为**（避免误灭真裁决·非无脑灭红）。后端阶段①对
洛阳合成租户返 SYNTHETIC、无真源因子返 MOCK/hasData=false，恰命中抑制。

## §3 验收结果（真跑）

### typecheck / build
- `pnpm --filter frontend-shell typecheck` → **0 error**（27 错全清）。
- `pnpm --filter frontend-shell build` → ✓ built。
- `pnpm --filter frontend-shell lint`（我改动的全部文件）→ 0 error（另有 4 处 App/Graph/Decisions/setup/gap-card 为**预存**·非本次触及）。

### test
- **全套 `pnpm --filter frontend-shell test` → 126 files / 327 tests 全绿·零回归**。
- 新增 `test/decision-value.test.tsx`（14 例）：LIVE 越阈→red / 非 LIVE(MOCK/SYNTHETIC/STALE/PARTIAL/null)→灰·绝不 danger / decisionHeat 门 / `<DecisionValue>` 组件门。
- 新增 `test/risk-board-kill-mock-red.test.tsx`（4 例·全应用 jsdom + MSW 覆盖 risk_timeline）：
  - 洛阳·设备OEE(MOCK/hasData=false·顶层 SYNTHETIC)：卡内**零 `var(--danger)` 内联色** + 显 noDataReason。
  - 顶层 SYNTHETIC ⇒ planRows 面板不渲染。
  - **C6 对照**：顶层 LIVE + 真数据卡(常州 peak96)→ danger 红照常渲染 + planRows 面板出（非无脑灭红）。
  - 顶层 LIVE 但洛阳卡 hasData=false 仍不出红。

### green→red→green（牙齿自证）
```
### GREEN (baseline)                                                Tests 14 passed
### RED (guard broken: decisionColor 去掉 !isLiveDecision 守卫)      Tests 4 failed | 10 passed
### GREEN (guard restored)                                          Tests 14 passed
```

### C5/C6 真浏览器（Playwright·playwright-core + /opt/pw-browsers chromium headless_shell）
VITE_MOCK=1 起前端(127.0.0.1:5199)·登录 demo/planner/demo（mock 账号口径；真部署为 demo/admin/demo1234，
mock ACCOUNTS 用 planner/demo）·**SPA 点「预判推演看板」**（内存 token·goto 会 401 故走 SPA 导航）·
`getComputedStyle` 断言：
- **C5 PASS**：洛阳·设备OEE 卡 `getComputedStyle` 全后代**无 `rgb(224,98,108)`(danger)** + 文案含"无真实数据·不参与越线判定·请接入实测数据（连接器与上传）"。
- **C6 PASS**：常州（真数据卡·mock 未标 dataMode→按 LIVE）峰值 96 **确有 `rgb(224,98,108)` 红**（证明非无脑灭红）。
- 截图存证：`docs/evidence/WO-KILL-MOCK-RED-phase2-c5c6-riskboard.png`（洛阳卡灰空态 vs 常州/江门红峰值·一目了然）。

## 洛阳·设备OEE 是否不再红？
**是**。jsdom（4 例）+ 真 Chromium（C5）双证：该卡不含任何 danger 内联色，渲染为灰底诚实空态卡显
noDataReason，峰值/越线/日条全排除；顶层 SYNTHETIC 时处置工单亦不产。同时真数据卡（常州/江门·LIVE）
红越线照常（C6），**治本非无脑灭红**。

## 诚实缺口
- 本 worktree 基线经 reset 至 vigilant-knuth（见上），阶段①后端/契约按工单红线**未改语义**，仅前端加 VM 字段。
- C5/C6 走 VITE_MOCK 前端（工单允许「VITE_MOCK=1 起前端 或 起真前后端」）；未起真 datacore 双服务（沙箱未验真后端 SYNTHETIC 叠加链路，但阶段① FDE 已在其分支 curl 实证 C1/C2/C4）。mock 账号为 planner/demo（非 admin/demo1234）——真部署账号需真后端。
- Dashboard/Dag/Ksf/Sop 等以**后端布尔裁决**（miss/cashOk/status==="RED"/passed）为红的视图，采「仅显式非 LIVE 才抑制」策略补 dataMode 分叉——后端当前多数未对这些输出下发 dataMode，故其现有真裁决行为不变；待后端补发 dataMode 即自动生效（字段已就位·前端已守）。这是「补字段+守门」而非强行灰化真裁决，避免误伤。
- 阶段③（genuine-sim:check v2 语义门 + 展示层门 + 本体 G-DM-1 回写）不在本阶段②任务范围内，未做。

## 不 push·不跑 collab-queue（主循环收敛）。仅本 worktree commit（代码+测试+本证据+截图）。
