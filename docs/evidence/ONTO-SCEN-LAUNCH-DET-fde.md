# ONTO-SCEN-LAUNCH-DET · FDE 真验记录（PRD-scenario-ontogenesis §2.4/§2.5 · 验收 #3/#4）

> 2026-07-05 · 真起双服务（**无任何 LLM key = 天然解绑 classifier**）+ 真浏览器实拍。不作假：所有值来自真服务响应，前端所见逐值对照后端。

## 环境（复现命令）

```bash
pnpm -r build
# datacore（内存模式·seed demo·服务间凭证）
PORT=4801 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 \
  CREDENTIAL_KEY=0123…cdef SERVICE_TOKEN=svc-launch-det node apps/datacore/dist/server.js
# agentcore（无 LLM key —— classify LLM 天然不可用）
PORT=4802 DATACORE_BASE_URL=http://127.0.0.1:4801 SERVICE_TOKEN=svc-launch-det node apps/agentcore/dist/main.js
# 前端（真浏览器用）
VITE_DATACORE_URL=http://127.0.0.1:4801 VITE_AGENTCORE_URL=http://127.0.0.1:4802 npx vite --port 5211
```

## 验收 #3 · 解绑 classifier → 点 GOVERNED 卡仍 Path A 出真答案

1. `POST /b/v1/scenarios/S01/grow`（admin）→ `maturity=GOVERNED · VERIFIED · path=WORKFLOW · preview="…P50 产能=5.1836GWh"`。
2. `POST /b/v1/scenarios/S01/launch`（planner）→ 终态：

```
status=COMPLETED | path=WORKFLOW | classification.model=deterministic:scenario-bind
KPI: P50 产能=5.1836GWh · P90 产能=4.8585GWh · 缺口比例=0%
```

- 全程**零 classifier**（本环境无 LLM key，classify 物理不可用；单测另证 classify 调用计数=0，revert §2.4 绑定 → 3 例红）。
- 真浏览器（S15 同理，grow→GOVERNED→点卡）：`ONTO-SCEN-LAUNCH-DET-governed.png` —— 对话坞「命中工作流 · quote_margin_q · conf 1.00」+「已验证 · 工作流」+ **毛利率 0.2565**，与后端 grow preview `毛利率=0.2565` 逐值一致。

## 验收 #4 · 人为删求解器 → 卡降 PROVISIONAL + 前端显缺口工单

「删求解器」经真 admin API 落地（求解器注册表为代码静态，运行期等价断链）：发布 `capacity_feasibility` 计划新版（`invoke_solver.solverKey=capacity_forecast_deleted`）+ 意图新版（`planRef latest`）→ datacore 对该 key 真 404。

1. `POST /b/v1/scenarios/S01/launch` → `FAILED`，答案含结构化 gap 块：

```
gapCode=SOLVER_NOT_FOUND
evidence=TOOL_ERROR: DataCore POST /a/v1/solvers/capacity_forecast_deleted/invoke -> 404 …
scenario={"scenarioKey":"S01","name":"订单可承接性评审","maturity":"PROVISIONAL","ticketId":"gtk_01KWRZP15BYX65BRECVXD3YRF1"}
```

2. 卡真降级：`GET /b/v1/scenarios/S01` → `maturity=PROVISIONAL`，`lastOntogenesisRun.gaps=[{SOLVER_NOT_FOUND, NEEDS_HUMAN, ticketId}]`（launch 起源留痕·taskId 溯源）。
3. 工单：`GET /api/v1/growth/tickets` → 1 张 OPEN（SOLVER_NOT_FOUND）；**二次点卡后仍 1 张**（同卡同码幂等复用）。
4. 通知 + 收件箱：datacore `GET /a/v1/notifications`（admin）→ **1 条** `scenario_gap`（两次点卡仅新开票时通知一次），`refType=growth_ticket · refId=gtk_…` 深链；planner 不收（角色扇出边界，datacore 齿另证；用户态调服务间路由 403）。
5. outbox：`scenario.gap_detected` + `growth.ticket_opened` 可被 `/b/v1/outbox` 轮询（下游失效/订阅）。
6. 真浏览器：`ONTO-SCEN-LAUNCH-DET-devcard.png` —— 对话坞诚实发育卡「**此卡发育中** ·「订单可承接性评审」暂未长成：缺求解器（需开发/骨架）· **已建工单 #gtk_01KWRZP15BYX65BRECVXD3YRF1 →**」（深链工单·截图时为 `/admin/growth?ticket=`，rebase 后 TICKET-CENTER 统一工单中心已落，现深链 `/admin/tickets?ticket=` 直开详情抽屉）+ invoke_solver 步 FAILED 红标 + GapCard「查看成长工单 →」。`ONTO-SCEN-LAUNCH-DET-inbox.png` —— admin 通知中心 scenario_gap 收件。

## 验收（DoD③）· 全站零「未能产出回答」

- **产出面**：`agent/loop.ts degrade` 死答串已删——文本/推理全空 → 结构化 gap 块（OTHER·question=原问句可续推）。上述所有终态 JSON 与两页真浏览器 `document.body.innerText` 均无死答串（脚本断言）。
- **grep 门**：`ontogenesis:check` 增 §2.5 断言——apps/agentcore、apps/datacore、apps/frontend-shell、packages/contracts、packages/llm-adapters 五个 src 根零该串，回潮即红（开发中曾真红过一次：server.ts 注释含该串 → 门拦下，自证有牙）。

## 接缝修真 bug（沿链路走出来的）

`useScenarioLaunch` 此前只带 `scenarioIntentKey` 不带 `scenarioKey` → **UI 点卡**时编排器识别不出场景任务：O10 卡规则注入、GOVERNED 守底、整条缺口处置链全部失联（curl 直打 launch 端点则正常——典型接缝断点）。已补 `scenarioKey: card.sNo`。

## 齿（revert→红 实证）

- `apps/agentcore/test/scenario-launch-deterministic.test.ts`（5 例）：把 §2.4 绑定块禁用（`if (false && forcedKey)`）实测 **3 例红**（零 classifier / 删求解器降级链 / NO_INTENT 守底），恢复后 5 绿。
- `apps/datacore/test/scenario-gap-notify.test.ts`（2 例）：服务间扇出落收件箱（planner 不收）· 用户态 403。
- `apps/frontend-shell/test/gap-card.test.tsx` 增 2 例：发育卡文案+工单深链 · 无 scenario 字段零回归。

## 结果状态

- 四包 build/typecheck 0 err；套件全绿：agentcore 531 · datacore 942(+2) · contracts 12 · frontend 473(+2)；`pnpm gates` exit 0（含新 grep 断言）。

## 北极星距离（诚实边界）

- GOVERNED 确定性启动、缺口诚实卡、工单/通知/深链、零死答已闭；**AGENT_* 模式卡**（如 S03）launch 仍走场景 agent（需 LLM），无 LLM 环境 grow 诚实 PROVISIONAL——设计如此（agent 答案本就非确定性面）。
- launch 缺口目前一律 NEEDS_HUMAN 开票（不在 launch 内自动跑 runGrowthLoop——重补齐仍走 grow/在办看板人工闸，与 GROWTH-WORKLIST 语义一致）；GapCard 既有「触发诊断/补齐」按钮仍可用（三道边界闸）。
- 深链指 `/admin/tickets?ticket=<id>`（TICKET-CENTER 统一工单中心·本单为其补 `?ticket=` 直开详情抽屉；GapCard 通用「查看成长工单」链保持 /admin/growth 不动）。
