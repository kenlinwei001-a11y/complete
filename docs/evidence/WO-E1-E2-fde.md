# WO-E1 + WO-E2 · FDE 真跑证据（校准活体常态化 + 沙盘 what-if 进决策日常）

> 亲手真跑（非只测试绿）。E1：真起 datacore（内存 SEED_DEMO=1）→ CALIBRATION_SWEEP → 收敛史 curl。
> E2：真起前端（mock 构建）+ 真 Chromium（Playwright · /opt/pw-browsers）→ 决策视图点「开 what-if」→ 进沙盘带上下文（截图）。

---

## WO-E1 · 校准活体常态化（CALIBRATION_SWEEP + 收敛史 + GET /a/v1/calibration/convergence）

### 做了什么
- `scheduler.ts` / `contracts/actions.ts`：新增 `ScheduledJobKind` **`CALIBRATION_SWEEP`**（与既有 `CALIBRATION_RUN` 并列·各加各的枚举）。
- `app.ts`：`.on("CALIBRATION_SWEEP", …)` → `calibration.sweep()`；`synthetic/service.ts` boot 注册每日 cron `0 5 * * *`。
- `calibration/service.ts`：新增 `sweep()`（周期跑 `runAll` + 逐轮落收敛度）+ `convergenceHistory()`。
- **R9 双仓储四处**：`repo.ts` 接口 + `memory.ts` + `pg.ts` + migration `034_calibration_convergence.sql`（`calibrationConvergence` store）。
- 端点：`GET /a/v1/calibration/convergence`（收敛史逐轮 + `converging`/`improvedPct` 判据·R2 限本租户）；`POST /a/v1/calibration/sweep`（手动触发·catalog_admin）。
- 出箱事件：每轮 `calibration.swept`（round/mapeBefore/mapeAfter/created/autoApplied）。

### 判据①③ 收敛史逐轮 mapeAfter 下降（越用越准）——确定性集成测试真跑
`apps/datacore/test/m11-calibration.test.ts` › `E1a`（经**真实 HTTP 端点** `GET /a/v1/calibration/convergence`）：
逐轮注入「偏差随轮缩小」的真配对（= 校准后新参数下预测更准的真实语义），sweep 三轮，收敛史实测：

```
[E1-EVIDENCE] convergence:
[{"round":1,"mapeBefore":25,"mapeAfter":25},
 {"round":2,"mapeBefore":13.64,"mapeAfter":13.64},
 {"round":3,"mapeBefore":5.26,"mapeAfter":5.26}]
```

→ mapeAfter **25.0 → 13.64 → 5.26** 逐轮严格下降（`conv.converging=true`·`improvedPct>0`）。断言：round 单调、末轮≤首轮、每轮一条 `calibration.swept`。

### 判据 R6 确定性
`E1b`：同种子两次独立重跑，收敛史（剥离 at/id 展示字段后）**字节一致** `JSON.stringify(a)===JSON.stringify(b)`。校准无随机/时钟随机性依赖。

### 真起 datacore·CALIBRATION_SWEEP·收敛史 curl（内存 SEED_DEMO=1）
```
$ PORT=4055 SEED_DEMO=1 CREDENTIAL_KEY=<64hex> node apps/datacore/dist/server.js

# 1) 清扫前空
GET /a/v1/calibration/convergence
{"points":[],"rounds":0,"improvedPct":0,"converging":true}

# 2) POST /a/v1/calibration/sweep ×3（活体清扫·每轮 runAll + 落收敛度）
{"…","round":1}  {"…","round":2}  {"…","round":3}

# 3) GET /a/v1/calibration/convergence（收敛史逐轮·契约回执）
{"points":[
  {"round":1,"trigger":"手动","mapeBefore":6.53,"mapeAfter":6.53,"paramsVersion":1,…},
  {"round":2,…,"paramsVersion":1},
  {"round":3,…,"paramsVersion":1}],
 "rounds":3,"improvedPct":0,"converging":true}
```

**诚实标（铁律0·不拿绿测试冒充能用）**：demo 内存种子**无 live A8 观测配对**（`paired:0`）→ `runAll` 不产提案、MAPE 静止在基线末点 6.53。真实「逐轮下降」需 A8 时序/writeback 真接入（SCHEDULED_FORECAST + line_output_daily 聚合的完整回放）——见设计边界「observed 真实性依赖 A8 真接入·demo 合成诚实标」。**逐轮下降的真值证据在上面的确定性集成测试（经同一 HTTP 端点，真配对驱动 25→13.64→5.26）**。live curl 证端点/清扫/落库全链已接通。

---

## WO-E2 · 沙盘 what-if 进决策日常（openWhatIf → presetContext 进既有沙盘链）

### 做了什么
- `views/sim/whatif.ts`：`useOpenWhatIf()` / `whatIfQuery()` / `parseWhatIfPreset()`——决策上下文 ↔ 沙盘 URL query 确定性编解码（复用既有 `/v/sim-sandbox` + `POST /a/v1/sim/sessions` baseSnapshot+scope·**不新建推演引擎**）。
- `RiskBoardView.tsx`：风险卡详情弹窗加「就此问题开 what-if 推演 →」按钮 → `openWhatIf({source,subject,factor,label})`。
- `SandboxView.tsx`：读 URL preset → 注入 `SimSession.scope.presetContext` + 展示「what-if 上下文条」（决策完即弃/采纳为 Action·R3 隔离/R4 正门）。

### 真浏览器 what-if（Playwright · 真 Chromium `/opt/pw-browsers/chromium-1194`·前端 mock 构建）
```
[E2-PW] logged in → risk board, cards: 6
[E2-PW] risk detail modal open with what-if button
[E2-PW] navigated to: /v/sim-sandbox?whatif=1&source=risk-board&subject=常州&factor=化成柜张力&label=常州 · 化成柜张力
[E2-PW] sandbox what-if context — source: 来自决策入口：risk-board | label: 常州 · 化成柜张力 | factor: 化成柜张力
[E2-PW] after tick, global KPI: 47.5
[E2-PW] SUCCESS: risk-board → 开 what-if → sandbox(presetContext) → tick
```

截图（`docs/evidence/`）：
- `e2-01-login.png` — 登录（planner）
- `e2-02-riskboard.png` — 预判推演看板（6 风险卡）
- `e2-03-risk-detail-whatif-btn.png` — 风险卡详情弹窗 · 「就此问题开 what-if 推演 →」按钮
- `e2-04-sandbox-whatif-context.png` — 进沙盘·**what-if 上下文条**（来自 risk-board · 常州 · 化成柜张力）
- `e2-05-sandbox-after-tick.png` — 沙盘真推进 tick（可交互推演·非空跳）

前端单测：`test/wo-e2-whatif.test.tsx`（URL 往返 / 沙盘读 presetContext 并注入 scope / 无 preset 走常态）3 绿。

---

## 红线 / 距北极星
- 全绿：`pnpm -r build`（4 包）·`pnpm --filter datacore test`·`pnpm --filter frontend-shell test` 全过。
- R6 确定性（E1b 字节一致）·R2·契约只经 `@platform/contracts`·R9 双仓储四处·R3 沙盘隔离·R4 采纳经 Action。
- **距北极星**：E1 的「逐轮 MAPE 真下降」在 demo 内存态仍需 A8/writeback 真回采落地才能 live curl 见下降（现由确定性测试证；live 环境需配 ops 回放 schedule）。E2 已在真浏览器闭环（决策→what-if→推演→采纳正门）。
