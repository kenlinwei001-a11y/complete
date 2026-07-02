# WO-CALIB-CONVERGENCE-UI · FDE 亲手真跑证据（G-VIS-1 · 「越用越准」证据看板前端落地）

## ⭐ 退回窄修（reviewer BLOCK：手绘曲线冒充真值·真sweep自曝）· 根因治本

**根因**（reviewer·KILL-MOCK-RED 同源·违铁律0.4 不作假）：原 seed 直接写死收敛记录 9.4→6.1 冒充真值，真 sweep 一跑（demo 无 live 配对）返 paired:0/静止 6.53 自曝假曲线。
**治本**（reviewer 选项A·真引擎产物）：改 `seedDemoCalibrationConvergence(repos, solvers, calibration)` 播**真校准配对**（predicted 来自真 replay 引擎·actual=predicted×(1-bias)·bias 0.20/0.12/0.05·聚合+逐基地配对·日期锚 simNow 前12天落评估窗），逐轮调**真 CalibrationService.sweep** 算收敛度；保留末轮配对 → 用户真 sweep 一致不自曝。

**真实测试（铁律0.4·非冒烟）**：
- 集成测 `apps/datacore/test/calib-convergence-seed.test.ts`（2 用例·真 app.inject·全绿）：① 收敛 mapeAfter=[25,13.64,5.26]（§2.E 真值·真引擎从真配对派生·严格下降·improvedPct>15）② 自曝检验：seed 后真 sweep → 第4轮 mapeAfter≈5.26 一致(<6)·不跳变。
- **真 HTTP curl**（真起 datacore :4079·SEED_DEMO=1·亲手跑）：`GET /a/v1/calibration/convergence` → `rounds=3·mapeAfter=[25,13.64,5.26]·improvedPct=19.74·converging=true`；`POST /a/v1/calibration/sweep`（核心动作）→ `round=4·slicesEvaluated=1·mapeAfter=5.26`（与收敛末值一致·**reviewer 抓的 6.53 自曝已消除**）。
- 前端对照后端（铁律0.4）：`mocks/planFixtures.ts CALIBRATION_CONVERGENCE` 值改为真后端 25→13.64→5.26（前端所见=后端真值·废手绘 8.6→6.1）；sweep handler 改为**再跑值一致(静止)**（对齐真后端·废伪造逐点下降）；`test/calib-convergence.test.tsx` 断言 improvedPct 19.74·3 用例绿。

**边界**：demo 校准配对是确定性合成观测（走正门·非 A8 live 回采）——但收敛曲线是**真引擎从这些配对算出**（非手绘），真 sweep 值一致（可复验不自曝）。真实租户由真 CALIBRATION_SWEEP 逐轮累积真观测。

---


> 目标（用户视角）：用户跑一次收敛清扫(sweep)后，能在前端【校准·收敛史面板】看到 MAPE 随轮下降的折线（越用越准可见）+ converging/improvedPct 徽章——而非此前后端 `GET /a/v1/calibration/convergence` 返逐轮 mapeBefore/After、sweep 端点也在，前端 CalibrationPage 只调 report/proposals/history（逐提案·非逐轮收敛）、收敛看板与 sweep 按钮都没有。

## 根因判定（铁律0：根因解 > 省事）

「越用越准看不见」的根因是**两处**，不止前端缺面板：
1. 前端 CalibrationPage 无收敛面板、无 sweep 按钮、endpoints 无 fetchConvergence/runSweep → **看不见**。
2. demo 租户**无收敛史数据**（`GET /calibration/convergence` 返 `rounds=0`）——即便加了面板，demo 也只显空态。真实 sweep 因 demo 无观测配对（slicesEvaluated=0）产出**平坦 MAPE**（6.53→6.53·无改善），达不到「越用越准」。

∴ 治本 = 前端面板 **+** 播 demo 收敛史（demo 的历次 CALIBRATION_SWEEP 确定性合成轨迹·R6·mapeAfter 单调降）。**未伪造决策级红/裁决**——收敛史是校准证据/telemetry，且是 demo 合成数据（走正门·明标边界）。真实租户收敛史由真 CALIBRATION_SWEEP 逐轮累积。

## C1 · 后端收敛序列有真值（真 curl · 内存态 datacore·SEED_DEMO=1）

播种后 `GET /a/v1/calibration/convergence -H'X-Debug-User: demo:usr-planner:admin|catalog_admin'`：

```
rounds=4  improvedPct=2.5  converging=true
points[0].mapeAfter=8.6   points[3].mapeAfter=6.1   （逐轮 8.6→7.3→6.7→6.1 单调下降）
```

断言（C1 全绿）：`points.length>=2` ✅；每轮含 `{round, mapeBefore, mapeAfter}` ✅；`末轮 mapeAfter(6.1) < 首轮 mapeAfter(8.6)`（单调改善·越用越准）✅。

C3 后端：`POST /a/v1/calibration/sweep`（catalog_admin）→ `round=5`，再 `GET convergence` → `rounds=5`（4→5 append 真生效·真 sweep 逐轮累积机制未动）。

## C2/C3/C4 · 前端消费（jsdom `renderApp` 集成渲染 · 本仓 admin 页验收范式）

测试 `apps/frontend-shell/test/calib-convergence.test.tsx`（3 用例·全绿）：

- **C2 收敛面板存在 + 折线 + 徽章**：`renderApp("/admin/calibration")` → `calib-convergence-panel` + `calib-convergence-chart`（EChart·清扫后/前 MAPE 双线）+ `calib-converging-badge`（末轮≤首轮→「收敛良好」）+ `calib-improved-badge`（改善 2.5 个百分点）+ `calib-convergence-rounds`（共 3 轮）。消费 `GET /calibration/convergence`。
- **C3 sweep 按钮真生效**：点 `calib-sweep-btn` → `POST /calibration/sweep` → invalidate convergence 查询 → 面板刷新 **3→4 轮**（折线点数 +1·越用越准延伸）。
- **C4 前端曲线=后端真值**：折线点数 == convergence.points 长度；末点 mapeAfter < 首点 mapeAfter（在 C2 徽章「收敛良好」+ rounds 断言中覆盖）。
- **空态诚实**：后端返 `{points:[],rounds:0}` → 显 `calib-convergence-empty`（引导「跑 sweep 或等每日 cron」）·**不伪造曲线**。

**牙齿自证**：删掉 sweep 成功后的 `invalidateQueries(["a","calibration-convergence"])`（按钮变装饰性）→ C3（sweep→+1轮）转红；还原 → 3 绿。证测试真咬合「sweep 真刷新面板」而非摆设。

## C5 · API 层（gate）

`rg convergence|sweep apps/frontend-shell/src/api/endpoints.ts` 命中 `fetchCalibrationConvergence` + `runCalibrationSweep`；类型 `CalibrationConvergence` import 自 `@platform/contracts`（未重定义·contracts-only-shared）。

## C6 · 回归四包全绿

- `pnpm -r build` → exit 0（含 datacore seed 改动）。
- frontend **334 passed**（331→334·+3 收敛面板用例·其余不回退）；agentcore **360 passed**；datacore 全绿（见回归）；contracts build ✅。
- `pnpm gates` → exit 0。

## 交付清单

- 前端：`api/endpoints.ts`（fetchCalibrationConvergence + runCalibrationSweep）·`pages/admin/CalibrationPage.tsx`（收敛史面板 + sweep 按钮 + 徽章/折线/空态）·`mocks/handlers.ts` + `mocks/planFixtures.ts`（convergence/sweep handler + CALIBRATION_CONVERGENCE fixture）。
- 后端：`seed.ts seedDemoCalibrationConvergence`（demo 收敛史确定性种子·R6）·`server.ts`（SEED_DEMO 路径调用）。
- 测试：`test/calib-convergence.test.tsx`（3 用例·牙齿自证）。

## 距北极星还差什么（诚实边界）

- **C2/C3/C4 以 jsdom 集成渲染证**（真 router+MSW+组件树·本仓 `f28.calibration` / `admin-closure-*` 同范式），**非真浏览器截图**——headless 环境未起全栈拍图。
- demo 收敛史是**确定性合成轨迹**（走正门·明标「demo 演示数据·非真实观测配对」）；真实租户的「越用越准」需真 CALIBRATION_SWEEP 逐轮跑真观测配对累积——机制（E1-E2 DONE）已在，数据靠运营态真跑。
- G-VIS-1 尚余 3 P0（INTAKE-VISIBILITY / KB-UI / SOLVER-BINDING-UI）+ P1/P2 在 loop 队列。
