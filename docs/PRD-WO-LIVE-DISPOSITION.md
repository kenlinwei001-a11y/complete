# PRD · WO-LIVE-DISPOSITION —「产能风险处置 · 最终方案与行动计划」活推演化

> 一张工单 · 一个 dev 整单做（数据半＋引擎半＋前端半一并，禁拆两半）。
> 版本 v1.0 · 关联本体 `docs/SYSTEM-ONTOLOGY.md` · 关联 solver `risk_timeline` / `base_capacity_outlook`。

---

## 0 · 一句话

产能风险看板底部的「📋 产能风险处置 · 最终方案与行动计划」表，从 **「静态 · 从配置库选方案 · 每行点不开 · 调杠杆不变」** 升级到 **「真缺口贪心派生 · 每行可点开看推导过程 · 点『生成/重算』吃当前杠杆推演态实时重算」**。

用户原话（痛点，逐条对应验收）：
1. 「你确认…不是写死的？为何没有触发写这些方案的按钮？」→ **加『生成/重算行动计划』按钮**（触发可见）。
2. 「物料杠杆怎么调整，为何结论、内容、行动都是不变的。应该是调整完杠杆，点『行动计划』，再实时输出」→ **吃 `liveState.apply` reactive 重算**（调杠杆→点重算→计划真变）。
3. 「每个行动项，点击都看不到详情，也不知这个行动是如何推演出来的」→ **每行可点开 → 展开推导过程**（触发缺口/收窄量/溯源）。

---

## 1 · 现状 AS-IS（精确接线 · 已亲验）

### 1.1 处置表数据来自哪 · 为何"像写死"

- `risk_timeline` solver（`apps/datacore/src/solvers/risk.ts` · `riskTimeline`，`planRows` 在 **risk.ts:401**）→ 调 `buildRiskPlanRows(c, shown, threshold)`（**risk.ts:425–482**）。
- `buildRiskPlanRows` 的真相：
  - 每基地一行，`act` = **`mits[factor][0].name`**（`mits = c.params.risk.mitigations`，即**从配置方案库直接选第 0 个**，risk.ts:444–448）——不是从真缺口派生的方案。
  - `det` = `` `峰值${peak}·${对象名}` ``（risk.ts:449）——**浅**，无推导。
  - `eff` = `` `消解≈${s0.eff}·${s0.tn}天起效` ``（配置里的固定 eff/tn，risk.ts:453）。
  - `峰值≥90` 追加备份行（`mits[factor][1]`，risk.ts:456–466）；14 天内越线追加"反提 S&OP"行（C21，risk.ts:468–478）。
  - **`void threshold`（risk.ts:479）** —— 连阈值都没真用；入参只有 `cards`+`threshold`，**没有任何杠杆推演态入口** → 所以"调杠杆结论不变"是真的（结构上就没接）。
  - **没有任何 per-row 推导字段**（无 steps/rationale/provenance）→ 所以"点不开看不到推导"也是真的。

### 1.2 富推导逻辑其实已存在 —— 只是在另一个 solver 里没被处置表复用

- `base_capacity_outlook` solver（`apps/datacore/src/solvers/base-outlook.ts`）里 **`dayPlan: DayAction[]`（base-outlook.ts:203–252）** 才是真推演：
  - `shortfall = -gap` → `trigDay = crossDay`（真触发日）→ 三杠杆贪心补缺口：
    - ① 加班承接（`overtime = min(remaining, available*overtimeUpliftPct)`，base-outlook.ts:210–221）
    - ② 跨基地调剂（base-outlook.ts:224–237）
    - ③ 外协补足（残余，base-outlook.ts:239–251）
  - 每个 `DayAction` 带：`day/date/action/rationale/triggerValue/closesGap/provenance{kind,drillType,drillId,drillField,drillValue}`。
  - `rationale` 例：`「第X天累计需求越过可用产能（触发缺口 N套）→ 加班上浮 15% 收窄 M套（溯 Line.capacityDaily=…/日）」`。
  - **这正是用户点开行动项想看到的"如何推演出来的"** —— 现成的、带溯源的、真缺口驱动的。**本 WO 的核心 = 把这套派生接进处置表**。

### 1.3 前端处置表怎么渲染 · 为何点不开、没按钮

- `apps/frontend-shell/src/views/RiskBoardView.tsx:273–316`：渲染 `data.planRows`，列 = `#/act(+det)/owner/start/done/eff/rule`。
  - **每行 `<tr>` 无 onClick**（RiskBoardView.tsx:302–311）→ 点不开。
  - 只有一个「⬇ 导出最终规划」按钮（`exportPlanRows`，RiskBoardView.tsx:281/328）→ **没有"生成/重算"触发按钮**。
- `liveState`（**RiskBoardView.tsx:574**）= `LiveLeverState { apply, capGain, affected }`，由 `DynamicLeverPanel` 经 `onLiveState` 上抛（DynamicLeverPanel.tsx:110）。**目前 `liveState` 只喂"存方案/横比"，完全没回流进 `planRows`**（RiskBoardView.tsx:575 注释自证）→ 所以调杠杆处置表不动。

### 1.4 杠杆 → 重算的现成机制（reactive 直接复用 · 别新造）

- 杠杆 apply 语义 = `{ objectType, objectId, prop, value }[]`（DynamicLeverPanel.tsx:110 / 190）。
- **克隆-覆写重算已有单源**：`capacity.ts:309` 注释明确 —— `service.ts` 的 `capacityInferenceApply`（**service.ts:826**）与 capacity 重算**共用同一克隆语义（单源·避免两处漂移）**。
- 结论：`risk_timeline` 接受一个 `apply` overlay → **复用同一克隆-覆写 helper** 把 override 打进 SolverContext 对象快照的 props → 重新跑 `riskTimeline`（cards + planRows 全部在覆写后的世界里重算）。**禁止另写一套 override**（会漂移 → 违背单源，重蹈 metric-aware 反复炸的覆辙）。

---

## 2 · 目标 TO-BE（三件事 · 一并交付）

### T1 · 富推演接入（数据半 · 引擎）
处置表每一行的方案与效果**从真缺口贪心派生**，并携带**可展开的推导步骤**：
- 抽出 `base_capacity_outlook.dayPlan` 的三杠杆贪心为一个**共享纯函数**（如 `deriveDisposition(c, base, factor, shortfall, ctxOverlay?)`，放 `base-outlook.ts` 或新 `disposition.ts`，两个 solver 都 import 同一份——**单源**），`buildRiskPlanRows` 改为调它。
- `planRows[i]` 新增字段 `steps: DispositionStep[]`（每步 = `{ action, rationale, triggerValue, closesGap, provenance }`，形状对齐 `DayAction`）；`det` 改为真派生的头行摘要（如 `触发缺口 N套 · 3 步收窄至残留 R套`），不再是 `峰值·对象名` 的配置串。
- 守恒：`Σ steps[].closesGap + 残留 = shortfall`（R6 可测的硬等式）。

### T2 · 杠杆 reactive（引擎半 · 前端 + solver 入参）
- `risk_timeline` solver 新增可选入参 `apply?: {objectType,objectId,prop,value}[]`（overlay）；有 overlay → 复用 §1.4 克隆-覆写 helper 重算；无 overlay → 与现状字节一致（**向后兼容**）。
- `RiskBoardView` 处置表区加 **「⚙ 生成/重算行动计划」按钮**：点击 → 用当前 `liveState.apply` 重新 invoke `risk_timeline` → `planRows` 真变。
  - 无杠杆调整（`liveState.apply` 空）→ 按钮给出"基线方案"（等同现状）。
  - 有杠杆调整 → 标注"（含 N 项杠杆推演）"，并允许与基线并列对照（可选，非阻塞）。

### T3 · 每行可点开（引擎半 · 前端）
- 处置表每行 `<tr>` 加 onClick → 展开/弹出 `DispositionDetailPanel`（新组件或复用 `RiskDetailPanel` 的 provenance 展示样式）：
  - 逐 `step`：动作 + `rationale` + `触发值→收窄量` + `Provenance{来源系统·drillType.drillField=drillValue}`（R13 悬浮即出处）。
  - 与现有 `RiskDetailPanel`/`AffectedOrdersModal`（RiskBoardView.tsx:260/271）交互风格一致，不新造范式。

---

## 3 · 详设与接线

| 层 | 改动 | 文件:锚点 |
|---|---|---|
| 契约 | 新增 `DispositionStepSchema`（action/rationale/triggerValue/closesGap/provenance）；`planRows[].steps` 可选字段。前端只引用，不重定义（R1/R14） | `packages/contracts/src/`（若已有 provenance schema 则复用其 provenance 子结构） |
| 引擎-派生 | 抽 `deriveDisposition` 共享纯函数（三杠杆贪心，单源）；`buildRiskPlanRows` 改调它，输出 `steps`+真 `det` | `risk.ts:425` · `base-outlook.ts:203`（抽公共） |
| 引擎-reactive | `riskTimeline` 接 `apply` overlay → 复用克隆-覆写 helper 重算；无 overlay 向后兼容 | `risk.ts:377` · 复用 `capacity.ts:309`/`service.ts:826` 克隆语义 |
| 前端-按钮 | 「⚙ 生成/重算」按钮吃 `liveState.apply` → re-invoke risk_timeline | `RiskBoardView.tsx:273`（表头旁，紧邻导出按钮 :281） |
| 前端-钻取 | 行 onClick → `DispositionDetailPanel`（逐 step + provenance） | `RiskBoardView.tsx:302`（`<tr>`）+ 新组件 |
| 文案 | 按钮/步骤/摘要文案入 i18n（R14 前端无业务常数） | `apps/frontend-shell/src/locales/zh.ts`（`zh.risk.*`） |
| mock 对等 | mock 端 planRows 带 steps + overlay 重算镜像（改杠杆前端也真变） | `apps/frontend-shell/src/mocks/*`（risk_timeline mock 求解器） |

**关键接线纪律**：reactive 重算**必须复用** `capacityInferenceApply` 的克隆-覆写单源（capacity.ts:309）。若另起炉灶，SEAM 红咬②会咬——两半 override 口径漂移 = 处置表"看着变了但和杠杆面板算的不是一个世界"。

---

## 4 · 《本体引用与影响》（铁律 0 · 必填）

- **对象类型（§2）**：`Metric`（越线触发源）· `Process/Line/Material/WorkOrder/Order`（`dayPlan` provenance 溯源落点）· `Action`（"采纳方案"→审批→工单，R4）· `ScenarioCard`（风险处置页入口）。
- **链路（§3）**：`sys.scenario.launch`（**§3 · D8**，场景卡→风险看板）→ `metric.breached`（**§4 · L17**，`actual<floorVal` → 触发 `risk_timeline` 推演）→ `risk_timeline` 出 `cards`+`planRows` → 用户调杠杆（`DynamicLeverPanel`→`liveState`）→ **本 WO 新增：`liveState.apply` overlay 回流 → risk_timeline 重算 planRows** → 采纳经 `Action`（R4 真值写入经审批→落工单）。
- **事件（§4）**：消费既有 `metric.breached`（L17）；**重算是 solver invoke（幂等·无副作用·不落真值）→ 不新增领域事件**；只有"采纳方案"才走 `Action` EXECUTED（R4）。→ 无 D-29 新增生产者/订阅缺口。
- **不变量（§5）**：
  - **R4 真值经 Action**：重算/展开只读推演，**不写真值**；唯"采纳"经 `domainExecutor` 审批落工单。本 WO 不放宽 R4。
  - **R6 确定性**：同 `apply` overlay 两跑字节一致；`Σ closesGap+残留=shortfall` 守恒。
  - **R13 结论可溯源**：每 `step` 带 `provenance{drillType.drillField=drillValue}`——`dayPlan` 已合规，接过来即满足；处置表红/黄数字不裸渲染。
  - **R14 前端无业务常数**：方案名/步骤文案/摘要来自后端 `steps` + i18n，前端不内联（守 `debattery:check`）。
  - **R-一致**：处置表用的 gap/缺口与产能推演 `base_capacity_outlook` 同一 `deriveDisposition` 单源 → 同基地同结论，跨视图不漂移。
- **断点（§8）**：
  - 关联既闭 **G-GAP-SCOPE**（因子作用域，§8 已闭）、同族 **G-CAPACITY-FACTOR-SHALLOW**（宽而浅→深而真）。
  - **本 WO 堵新断点 → 登记 `G-DISPOSITION-STATIC`**：「处置计划表脱离活推演态——config 选方案 / 无 per-row 推导 / 不吃杠杆 overlay」。交付须回写 §8（断点闭合）+ §3（链路补 overlay 回流）+ §5/R13（steps 溯源延伸）。

> **回写要求**：本改动新增了链路环（overlay 回流）+ 字段（planRows.steps）+ 断点（G-DISPOSITION-STATIC）→ **必须回写 `docs/SYSTEM-ONTOLOGY.md` §3/§4/§5/§8**，否则本体过期失效。

---

## 5 · SEAM-GATE 红咬（头号验收判据 · 数据半×引擎半接缝驱动，非各半绿）

> 接缝 = 「引擎派生 `deriveDisposition`＋overlay 重算」× 「前端处置表 reactive＋钻取」。四个咬点任一漏 = 红。

**datacore 组合测（`apps/datacore/test/live-disposition-seam.test.ts`，新建）**
1. **红咬①（杠杆真传导）**：`invoke risk_timeline {}` 得 `planRows0`；改一个物料杠杆（`Material.onHand ↑` 或 `leadTime ↓`）作 `apply` overlay → `invoke risk_timeline {apply}` 得 `planRows1`。断言 `planRows1` 的 `det`/`steps[].closesGap`/`残留` **数字真变**（`JSON.stringify(planRows1)!==JSON.stringify(planRows0)`）。**不变即红**（这条就是用户痛点②的机器化）。
2. **红咬②（单源不漂移）**：同一 overlay 下，`risk_timeline` 重算所依赖的覆写后产能，与 `capacityInferenceApply`（generic_inference apply）算出的同基地产能**同口径**（证复用同一克隆语义，非各算各的）。
3. **红咬③（推导非空壳）**：每个 `shortfall>0` 的行 `steps.length≥1` 且每 step `provenance.drillType/drillField/drillValue` 齐全；`Σ steps.closesGap + 残留 == shortfall`（守恒等式）。
4. **红咬④（R6 确定性）**：同 overlay 两跑 `JSON.stringify` 字节一致。

**frontend 组合测（`apps/frontend-shell/src/views/__tests__/…` 或 RiskBoardView 测）**
5. **红咬⑤（前端 reactive）**：mock 下调物料杠杆 → 点「⚙ 生成/重算」→ 处置表行内容 **DOM 真变**；点某行 → `DispositionDetailPanel` 展开、见 `rationale`+provenance。**mock 与真引擎口径对齐**（mock 也要真重算，不能写死两套）。

---

## 6 · 🚦 范围边界（这就是本单 dev 的"身份"·靠文件边界不靠人名）

**只碰**：
- `apps/datacore/src/solvers/risk.ts`（`buildRiskPlanRows` + `riskTimeline` 接 overlay）
- `apps/datacore/src/solvers/base-outlook.ts`（抽 `deriveDisposition` 共享；`dayPlan` 改调它，行为不变）或新 `apps/datacore/src/solvers/disposition.ts`
- `packages/contracts/src/`（`DispositionStep` schema，如需强类型）
- `apps/frontend-shell/src/views/RiskBoardView.tsx`（处置表按钮 + 行 onClick）
- 新组件 `DispositionDetailPanel`（前端）
- `apps/frontend-shell/src/locales/zh.ts`（文案）
- `apps/frontend-shell/src/mocks/*`（risk_timeline mock steps + overlay 重算镜像）
- `docs/SYSTEM-ONTOLOGY.md`（§3/§4/§5/§8 回写）

**禁碰**（别的边界/别的 dev）：
- `resolveBaseId` / `affected_orders` / `tensionSeries` / `factorSeries`（risk.ts 内这些是 base-id 保真单的地盘，已并 canonical，别动）。
- `gap_attribution`（根因树，另一条线）。
- `DynamicLeverPanel.tsx` 内部逻辑（**只消费**它上抛的 `liveState`，不改它的杠杆计算）。
- `service.ts capacityInferenceApply` 内部（**复用**其克隆语义，不改它）。

**整单一个 dev 做**：跨"数据半（引擎派生）＋引擎半（前端 reactive/钻取）"，按铁律**必须一个 dev 整单**——拆两半用不同机制不对接 = 处置表"看着变实则没接杠杆"的老坑。

---

## 7 · 验收 / 门 / 金值

- **头号判据**：§5 红咬①③⑤ 通（接缝驱动，非各半绿）+ **亲手真跑**（本地起服务，调杠杆→点重算→肉眼见处置表变、点行见推导）。
- **四包全绿**：`pnpm -r build && pnpm -r --workspace-concurrency=1 test`（datacore 勿并发多 vitest）。
- **门**：`debattery:check`（前端无业务常数）、`genuine-sim:check`（推演 schema 带 dataMode/前端消费）、`arg-drop-seam`（新入参 `apply` 不丢参）全绿。
- **金值/注册即更**：`risk_timeline` schema 变（+steps/+apply overlay）→ 若有 solver golden/snapshot 计数（catalog/ontology-core/demo-chain）涉及 → **同步更新**，漏金值即退。
- **本体回写**：§4 的三处回写落地（不回写即过期失效）。

---

## 8 · 交付方式（LOOP 纪律）

- **一张 WO = 一条 handoff 分支**：dev 建 `claude/handoff-wo-live-disposition`（**注意**：此分支名此前被我预留、现已释放，从最新 canonical `claude/inspiring-gates-aqczjg` 切），push，**不碰正线**。
- 审核方（我）**隔离复验**：worktree 独立 checkout → 组合四包 gate + §5 红咬亲跑 → cherry-pick 上 canonical → push。
- 退单标准：给精确 `file:line` + 最小修路径；**头号判据 = 接缝驱动通 + 四包全绿 + 亲手真跑**（绿测试≠能用）。

---

### 附 · 给 dev 的最短上手路径
1. 读 `base-outlook.ts:203–252` 的 `dayPlan` —— 这就是要接进处置表的"金子"。
2. 读 `risk.ts:425–482` 的 `buildRiskPlanRows` —— 这是要被替换的"配置选择"逻辑。
3. 读 `capacity.ts:309` + `service.ts:826` —— 这是 overlay 重算要复用的单源克隆语义。
4. 读 `RiskBoardView.tsx:273–316`（表）+ `:574`（`liveState`）—— 前端接线点。
5. 先写 §5 红咬①③（datacore），红着，再实现到绿——测试先行守住接缝。
