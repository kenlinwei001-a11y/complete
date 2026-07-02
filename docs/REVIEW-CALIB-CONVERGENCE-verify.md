# 复验 CALIB-CONVERGENCE-UI（BUILT 80f4e38）→ 窄 BLOCK

审核方运行时真验（重编 dist + 真 datacore SEED_DEMO + 真浏览器 + curl）。

## 核心功能已建（非推倒重来）
- CalibrationPage 收敛史面板渲染（`calib-convergence-panel`）+ mapeAfter/mapeBefore EChart 折线（`calib-convergence-chart`）+ converging/improvedPct 徽章 + sweep 按钮（`calib-sweep-btn`）+ 诚实空态。
- endpoints.ts 补 `fetchCalibrationConvergence`/`runCalibrationSweep`（类型自 contracts·C5 结构达）。
- 消费 GET /a/v1/calibration/convergence + POST /a/v1/calibration/sweep。

## ❌ BLOCK 理由：合成"越用越准"冒充真值（违平台红线·KILL-MOCK-RED 同源）
1. **前端零合成披露**（真浏览器坐实）：收敛面板把 `seed.ts` 硬编码手绘下降曲线 **9.4→8.6→7.3→6.7→6.1** 当"越用越准"真值**直渲染**，面板文案「共 N 轮清扫·逐轮 mapeAfter 应单调下降 = 参数版本推进后预测更准」，**无任何 合成/demo/演示/种子 徽标**。截图 `p0-calib.png`。
2. **真 sweep 自曝种子**（curl 坐实）：`POST /a/v1/calibration/sweep` → `{paired:0, slicesEvaluated:0, created:0, round:5}`（demo 内存态**无 live 配对**，与本体 §2.E 记载一致）→ 真引擎第 5 轮 `mapeAfter=6.53` **静止**（before==after）**且高于**种子第 4 轮的 6.1。即：前 4 轮漂亮下降是**手绘假曲线**，一点 sweep（本 feature 的核心动作）就露馅——本该证明"越用越准"的功能，恰恰证明 demo 里根本没变准。
3. 违 FDE 红线「合成 ≠ 真实：别用确定性合成冒充真实数据源」+ 平台「不得用合成冒充决策/质量级真值」。质量声明（越用越准）的**证据本身**被伪造，比普通合成对象更重。

## 修法（dev 二选一，核心面板不用动）
- **(优·根因)** 改种子为**真引擎确定性输出**：本体 §2.E 记真校准机制 = 25→13.64→5.26（测试驱动真配对）。让 demo 收敛曲线 = 真机制产物，非另编。
- **(次·诚实兜底)** 收敛面板加**诚实披露徽标**「demo 合成轨迹·真实租户由真 sweep 逐轮累积」+ **区分** seeded 轮 vs 真 sweep 轮；真 sweep 返 paired:0 时显「demo 无 live 配对·MAPE 静止（非真收敛）」，不让静止轮混进"改善 N 个百分点"。

## 验收其余
- C1 curl：convergence 返 ≥2 轮·末<首 → 技术达（但值是种子·见上）。
- C6 gate（四包）：未在本轮单独重跑（栈资源让位）；dev 声称绿，回归留 done 前复核。
