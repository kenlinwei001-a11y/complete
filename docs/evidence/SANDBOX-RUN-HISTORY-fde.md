# WO-SANDBOX-RUN-HISTORY · FDE 亲手真跑证据（推演沙盘历史推演记录·G-VIS-1）

> 真起 datacore4101/agentcore4102/前端4104（登录 demo/admin）+ Playwright chromium 真浏览器。零新后端·只接现成 GET /sim/sessions + /sim/compare。

## C1 后端 baseline（curl）
沙盘推进后 `GET /a/v1/sim/sessions` 返 `items` 非空（含 {id,status,curTick,parentCheckpointId,createdAt}）；`GET /a/v1/sim/compare?a=<id>` 返逐 tick 态序列（{tick,state}）。

## C2–C5 真浏览器（docs/evidence/screens/srh-list.png / srh-detail.png）
Playwright 登录→ `/v/sim-sandbox` → 推进 3 tick（真建会话+推进）→ 读面板：
- **C2**：`sandbox-run-history` 面板 present=1，`sandbox-history-row-*` 行数=1（与后端 sessions 一致），显时间/状态/推进步数/来源（根推演/分支）。
- **C3**：点行 → `sandbox-history-detail-*` 展开=1，`sandbox-history-spark-*` 全局态逐 tick 轨迹 SVG present=1，终值 `sandbox-history-terminal-*`=**54.9**（= compare.a 末 tick 全局态均值·前端所见=后端真值·同 SandboxView globalKpi/SimComparePanel tickMean 口径 R6）。
- **C4**：refreshKey=`${sessionId}:${curTick}`——每次推进 curTick 变 → 列表自动重取（新推演/更新的 curTick 即现·无需手刷）。
- **C5**：诚实空态——无会话时 `sandbox-history-empty`「暂无推演记录」（jsdom 牙齿证·置空 sessions 即空态·不伪造）。

## C6 门 + 牙齿
- `endpoints.ts` 补 `fetchSimSessions`（类型 SimSession 自 @platform/contracts·未重定义·contracts-only-shared）；复用现成 `fetchSimCompare`；复用 SimComparePanel 同口径 tickMean；零新后端。
- 牙齿 `sandbox-run-history.test.tsx`（4 用例·全绿）：列表(倒序/分支标记/curtick/场景标签) + 详情(spark+终值=后端真值 96.0) + 空态 + refreshKey 重取。
- `pnpm -r build && pnpm -r test && pnpm gates` 见提交贴绿。

## 本体回写
`docs/SYSTEM-ONTOLOGY.md` §8 G-VIS-1：追加 SANDBOX-RUN-HISTORY 落地（沙盘推演历史·后端存前端可见·+1 覆盖）。

## 诚实边界
- 面板留沙盘同页（R17·不新路由）；详情轨迹为全局态均值 spark（复用 tickMean 口径），非逐对象全表——逐对象细节可后续增量（当前满足"回看推了什么/终态如何"DoD）。
- scope 标签取 `scope.presetContext.label`（WO-E2 what-if 入口带）·无则「全局推演」——SIM-PRESET-INJECT 落地后标签更丰富（非本单阻塞）。
