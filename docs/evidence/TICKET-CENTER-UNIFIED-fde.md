# TICKET-CENTER-UNIFIED · FDE 真浏览器验收（2026-07-05）

用户亲定：『所有类似需要补数据/补求解器/补…，认领之后都集中在一个页面，点击每个工单，都可以看到详情，列举补充的内容』。

## 环境（真栈·非 mock）

- datacore `:14001`（内存模式 SEED_DEMO=1）+ agentcore `:14002` + vite `:15173`（`VITE_DATACORE_URL/VITE_AGENTCORE_URL` 指真后端，无 VITE_MOCK）。
- **全新租户自播种**（每次跑可重现）：platform_admin 建租户（industry=battery-manufacturing）+ 用户 `fde@tc.local/demo1234` → 浏览器**真 JWT 登录**。
- 工单由**真诊断长出**（零手造行）：
  1. 空租户 LOOP `POST /b/v1/growth/run`（confirmed=true）→ `terminalState=NEEDS_HUMAN` → 登记 `WorklistItem(DATA_GAP·provisionWorld·OPEN)`；
  2. B3 越界（slotValues base=火星基地 ∉ 注册表）+ 人工数据描述 → `HARD_BLOCK` → 登记 `DATA_REQUEST` 人工描述单（`dataRequest` 结构化留痕）；
  3. 世界 provision 后再跑一问 → `BOUNDARY` 开 `GrowthTicket(FEATURE·gtk_)`。

## 断言（真浏览器 Playwright·逐值对照后端 `/b/v1/growth/board` 与 `/b/v1/growth/tickets/:id/detail`）

全部 ✓（脚本 `fde-ticket-center.mjs`，输出 `ALL PASS`）：

- **① 聚合**：导航「工单中心」入册（构建与成长组）；board 行数=真源行数（零造行）；DATA_GAP + DATA_REQUEST + FEATURE 三类同页；每行 问句/gapCode/状态 与后端逐值一致。
- **③ 详情抽屉（点行侧滑）**：
  - DATA_GAP → 通用段（问句/缺口码/状态时间线/认领人）+ fillPlan（provisionWorld·seed=42 R6）+ B2 模式封闭闸结论；
  - DATA_REQUEST → B3 越界闸结论 + DataRequest（typeKey/列清单/涉实体/原因/人工描述）+ descriptionSchema 字段清单逐条（fields/valueDomain/samples·hint 逐值）+「去导入（真人正门）」深链 `/connections`；
  - FEATURE → ioContract.outputShape 逐值 + 验收线索；行内**无认领按钮**（kind-first 只读·409 guard 不绕）。
- **② Tab**：认领 DATA_GAP → 状态 CLAIMED·认领人前后端逐值（`usr_…` == JWT sub）→ **默认落「我的在办」**且未认领行真收窄；触发「补数据缺口」→ provisionWorld **真跑**（合成起步世界·登录后业务视图导航随之出现）→ DONE → 「已完成」Tab 可见 → 后端状态同步一致。

## 截图

| 文件 | 内容 |
|---|---|
| `TICKET-CENTER-01-board.png` | 工单中心聚合看板（DATA_REQUEST + DATA_GAP·Tab 计数） |
| `TICKET-CENTER-02-drawer-datagap.png` | DATA_GAP 详情抽屉（fillPlan + B2 结论 + 时间线） |
| `TICKET-CENTER-03-drawer-datarequest.png` | DATA_REQUEST 详情抽屉（B3 + descriptionSchema 字段清单 + 人工描述 + 去导入） |
| `TICKET-CENTER-04-claimed-mine.png` | 认领后「我的在办」聚合 |
| `TICKET-CENTER-05-filled-done.png` | 补数据缺口真跑 → DONE（已完成 Tab） |
| `TICKET-CENTER-06-feature-drawer.png` | FEATURE 详情抽屉（ioContract/验收） |
| `TICKET-CENTER-07-board-3kinds.png` | 三类工单同板（缺功能 OPEN·补数描述单 OPEN·缺数据 DONE·继续推演） |

## 齿轮（单测·revert 即红）

- `apps/agentcore/test/ticket-center.test.ts`（5 例）：T1 三源 union 统一 kind 标+claimable（零造行行数守恒）· T2 详情清单字段完整性（fillPlan/B2/B3/descriptionSchema/ioContract/scaffoldedDrafts/deeplink 按类型逐条）· T3 gtk_ 认领 409 WORKLIST_ITEM_READONLY 不绕 + 认领后 owner=me board 收窄 · T4 R2 跨租户 board 空/detail 404 · T5 solver entryRef → checkReadiness manifest requires 逐条投影。
- `apps/frontend-shell/test/f62.ticket-center.test.tsx`（3 例）：聚合 4 类同页 + Tab/类型筛真收窄 + FEATURE 只读无认领 + 抽屉按类型清单逐值 + 认领落我的在办 + fill→DONE 已完成 Tab。

## 诚实边界

- FEATURE 工单在本环境的真实缺口码为 `OTHER`（LLM provider 未配 → LLM_PURPOSE_UNBOUND），属环境事实非造数；SOLVER_GAP（gapCode=SOLVER_NOT_FOUND）分标经 T1/T2 单测坐实（demo 环境难以自然诱发·不伪造）。
- GrowthTicket 无独立流转时间戳字段 → 详情时间线诚实标注「以开单时间呈现」（不造中间态）。
- `/admin/growth` 驾驶舱保留为诊断运行视图（操作列保留·看板区加「→ 工单中心」跳转）——dev 定夺声明：驾驶舱是"跑诊断→就地补"工作流，收敛其操作会打断闭环；聚合+详情唯一面在工单中心。
