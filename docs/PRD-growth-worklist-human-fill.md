# PRD · 自成长发动机·在办看板 + 人工触发补数据缺口（去自动补）

> 状态：设计（待 dev 落地）· 分支 `claude/vigilant-knuth-b1nmxn` · 遵 R-PRD（逐元素量化）/ R4(真值经审批) / R6(补仍确定性) / 不作假
> 用户亲定：**「需要一个按状态/认领人筛的在办看板，人点击后再触发『补数据缺口』，而不是自动补。」**

## 0. 《本体引用与影响》

**触及对象类型/域**：D11 治理·自成长发动机（`apps/agentcore/src/growth/*`）· D1 接入(fillData/provisionWorld) · GapReport/GrowthTicket/GrowthRunReport(契约 `packages/contracts`)。
**触及链路**：`sys.meta.change_loop` 的发育闭环（探针→**补**→重跑→收敛）——**改「补」步的触发权**：SOFT 缺数据由 LOOP 内自动 `fillData` → 改为**入在办看板·人工点击触发**。
**触及事件（§4）**：新增 `growth.fill_claimed`（认领）· `growth.fill_triggered`（人工点补）；既有 `growth.fill_proposed` 语义收窄为「诊断出可补项·待人工」。失效 `growth-ledger`/`growth-worklist`。
**触及不变量**：R4（补数据=写真值·经人工闸门·非静默）· R6（点触发后 fillData 仍 seed 确定性）· R14（补法零行业常数·现状保持）· R13（每项带来源/证据）。
**命中断点**：G-9（发育闭环招牌）——语义从「自动补到收敛」调为「诊断+入队·人工补到收敛」（更诚实·人可控）。
**回写承诺**：改了「补」步触发权 + 新事件 → 回写 `SYSTEM-ONTOLOGY.md` §J/G-9 发育闭环描述（自动补→人工闸控补）+ §4 事件表；跑 `pnpm ontology:slices`。

## 1. 行为变更（核心·去自动补）

现状 `growth/scenario-grow.ts:54 fill()` 在 runGrowth 的 LOOP 内**自动**分派：
- EMPTY_DATA·world 空 → 自动 `provisionWorld`（合成起步世界）
- EMPTY_DATA·HARD（缺真实业务实体）→ 出 `DataRequest`（**已人工正门·不改**）
- EMPTY_DATA·SOFT → **自动 `fillData()` 合成 PROVISIONAL**（`:96` ← 本单要改为人工触发）
- SCAFFOLDABLE → 自动 scaffold DRAFT 计划（**待审批发布·已 R4 闸·不改**）
- else → 骨架工单（缺功能·需开发·不改）

**改**：runGrowth 的 LOOP **不再自动执行 SOFT `fillData` 与 `provisionWorld`**；改为把每个「可补项」登记为**在办项（WorklistItem）**，终态标 `NEEDS_HUMAN`（非 CONVERGED）。人在看板**认领 → 点「补数据缺口」→ 才真跑** `fillData`/`provisionWorld`（R6 seed 不变）→ 补成后可「继续推演」重跑原问句。
（HARD DataRequest、scaffold DRAFT 审批、缺功能工单——本就人工闸，纳入同一看板统一呈现。）

## 2. 在办看板（WorklistBoard·GrowthCockpitPage 内新区·逐元素量化）

替换现「成长工单」单表为**在办看板**：
- **筛选行**（顶部·`display:flex·gap:8·flex-wrap`）：
  - 状态 `<select data-testid="wl-filter-status">`：全部 / OPEN(待认领) / CLAIMED(已认领) / IN_PROGRESS / DONE / NEEDS_HUMAN。
  - 认领人 `<select data-testid="wl-filter-owner">`：全部 / 我(当前 user) / 各 claimer（去重自 items）。
  - 类型 `<select data-testid="wl-filter-kind">`：全部 / 缺数据(DATA_GAP) / 缺计划(PLAN_SCAFFOLD) / 缺功能(FEATURE)。
- **表**（`table.cmp`·列固定）：问题(fromQuestion) | 缺口码(gapCode·mono) | 类型徽标 | 状态徽标 | 认领人 | 操作。
  - 徽标色：OPEN amber · CLAIMED/IN_PROGRESS blue · DONE green · NEEDS_HUMAN amber · FEATURE(需开发) 灰。
  - **操作列按 (kind,status) 派生**：
    - OPEN → `[认领]`(`data-testid=wl-claim-{id}`)
    - CLAIMED·DATA_GAP → `[补数据缺口]`(`data-testid=wl-fill-{id}`·主 CTA·点→触发 fillData/provisionWorld) + `[释放]`
    - CLAIMED·PLAN_SCAFFOLD → `[去审批]`深链 `/admin/actions`
    - CLAIMED·FEATURE → `[标在办/已合并]`(状态流转)
    - DONE → `[继续推演]`(重跑原问句·复用 launch)
- **量化头条**（现有指标行扩）：待认领 N · 我的在办 M · 补成率 =DONE/总。空态诚实「暂无在办项——跑一个问题诊断缺口」。

## 3. 后端（R4 人工闸·R6 确定性）

- 契约加 `WorklistItem { id, tenantId, fromQuestion, gapCode, kind: DATA_GAP|PLAN_SCAFFOLD|FEATURE, status: OPEN|CLAIMED|IN_PROGRESS|DONE|NEEDS_HUMAN, owner?: userId, fillPlan?: {mode:SOFT|HARD, action}, evidence }`（`packages/contracts`·R1）。仓储双实现四处同改（R9）。
- runGrowth：SOFT/provision 不自动跑 → 产 WorklistItem(status=OPEN,kind=DATA_GAP)；LOOP 该轮终态 `NEEDS_HUMAN`。
- 端点：`GET /b/v1/growth/worklist?status=&owner=&kind=`（筛）· `POST .../worklist/:id/claim`（认领·记 owner=actor·发 `growth.fill_claimed`）· `POST .../worklist/:id/fill`（**人工触发**·真跑 fillData/provisionWorld·seed 确定性·发 `growth.fill_triggered`·成→status DONE）· 释放/流转。
- R2 tenant + R3 entitlement + R4：fill 写真值前校当前 actor==owner（认领人才可触发·或 admin）。

## 4. 验收（DoD·真起服务真点）

| # | 类型 | 断言 |
|---|---|---|
| C1 | curl | runGrowth 对 SOFT 缺数据问句 → **不再自动 fillData**：跑后 `GET /b/v1/growth/worklist` 出 status=OPEN·kind=DATA_GAP 项；且该轮 report 终态含 NEEDS_HUMAN（非 CONVERGED 自动补）。对照：改前会自动 advanced=true 补掉。 |
| C2 | curl | 人工触发闭环：`POST .../worklist/:id/claim`(owner=admin) → status CLAIMED；`POST .../:id/fill` → 真跑 fillData(seed 确定性·R6 两次同结果)→ status DONE + 对象真落库(datacore listObjects 该 typeKey 实例数增)。未认领直接 fill → 403(非 owner)。 |
| C3 | browser | 在办看板：筛状态=CLAIMED/认领人=我 → 只显匹配行(逐值对 curl worklist?status=CLAIMED&owner)；点「补数据缺口」→ 表状态 blue→green DONE·datacore 真增对象(前端所见对照后端)。真浏览器截图。 |
| C4 | gate | 回写 §J/G-9/§4 + `pnpm ontology:slices` 绿；四包 build/test 绿；新增 worklist 单测(人工闸·R6 补确定性·R2 隔离·非owner 403)。 |

## 5. 诚实边界
- 缺功能(FEATURE)工单本就需开发·非本单自动化范围（看板统一呈现+状态流转即可）。
- HARD DataRequest（缺真实业务数据）本就人工正门导入·纳入看板但触发的是「去导入」深链非合成补。
