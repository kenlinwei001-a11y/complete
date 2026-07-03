# FDE — WO-CALIB-HONEST-EMPTY（校准「越用越准」造假回退治本·不作假红线）

审计簇 C（`docs/AUDIT-fake-value-remnants.md §2 簇C`）：校准引擎真（有真 pair→真算 MAPE），但**无真 pair 时回退造漂亮下降线**，UI 无 SYNTHETIC 标 → 看 demo「越用越准」的人分不清"真学会"vs"脚本画"。本单治本 6 site + 前端标合成/静态基线边界。

## 治本落点

| # | 造假 | 治本 |
|---|---|---|
| C1 `calibration/service.ts` | 无历史回退 `mape=11.2-i*0.32+噪声` 线性下降 | 静态基线常数 `BASELINE_STATIC_MAPE=11.2`（水平线·无衰减/噪声）+ `report()` 回落到 baselineSeries 时置 `CalibrationReport.baselineOnly=true` |
| C2 `livedin/bundle.ts` | 部署态 mapeSeries 手画 52 周指数收敛 | bundle `HistoryBundle.synthetic=true`（整条回放叙事标合成·曲线走正门保留但明标） |
| C3 `livedin/engine.ts` | `realizedMape=simulatedAfter+0.3` 自证 | 取合成序列生效 2 周后真实点 `mapeAt(week+2)`（元环预测 vs 实现对真序列·非自证） |
| C4 `synthetic/service.ts` | seed 提案 evidence 手填 | `CalibrationProposal.synthetic=true`+`evidence.synthetic=true` |
| C5 `livedin/engine.ts` | seeded 提案 improvement/bias 手填 | 同标 `synthetic=true`（叙事内自洽·标合成边界） |
| C6 `seed.ts` | demo 收敛反解 `actual=predicted*(1-bias)` | 走正门（确定性合成观测→真引擎算 MAPE·非绕引擎手画）·码注披露·UI 由全局 synthetic watermark 覆盖 demo 租户 |

契约扩：`CalibrationEvidenceSchema.synthetic?`/`CalibrationProposalSchema.synthetic?`/`CalibrationReportSchema.baselineOnly?`/`HistoryBundleSchema.synthetic`/`HistoryCalibrationProposalSchema.synthetic?` + `domain.ts` record 双字段。

## C1 真起 datacore·curl 后端真值（内存模式·SEED_DEMO=1 SEED_LIVED_IN=1）

```
# ① history/bundle（demo·livedIn 回放）
synthetic= true
mapeSeries.len= 52
proposals[0].synthetic= true realizedMape= 10.66 evid.synthetic= true

# C3 验证：realizedMape=10.66 = mapeAt(week 6) = round(7 + 5*exp(-5/16), 2) = 10.66
#   （首提案 week=4 生效·2 周后取 week6 真序列点·非 simulatedAfter+0.3 自证）✓

# ② calibration/proposals（demo·含 cold-start seed）
total= 12 synthetic-count= 10
  calp_demo_seed_maint synthetic= true evid.synthetic= true
  calp_demo_seed_ramp  synthetic= true evid.synthetic= true

# ③ calibration/report —— baselineOnly 边界（诚实静态基线 vs 真收敛）
fresh 租户(无 pair): baselineOnly= true  points.len= 14  first.mape= 11.2  last.mape= 11.2  (flat= true)
demo  租户(有真 pair): baselineOnly= undefined  points.len= 12
```

**关键对照**：无真 pair 的 fresh 租户 → 14 点**全平 11.2**（诚实"未测得改进"·非线性下降造假），`baselineOnly=true`；有真配对的 demo 租户 → 真收敛序列，`baselineOnly` 不置（真学会）。看的人分得清。

## C2 真浏览器（Playwright + chromium·mock 模式真起 preview·登录 planner/demo）

`scratchpad/calib-honest-fde.mjs`（in-memory token → in-app 导航非 hard goto）：

```
LOGIN OK
REVIEW synthetic badge: "合成演示 · 非真实学习"     # ReviewView 顶部（bundle.synthetic）
MAPE synthetic note:    "合成回放"                  # MAPE 收敛曲线段
CALIB prop-1 SYNTHETIC badge: "SYNTHETIC"           # 合成提案（evidence 手填）
CALIB prop-2 badge count (expect 0): 0              # 牙齿：非合成提案不误标
```

截图：
- `docs/evidence/CALIB-HONEST-EMPTY-review.png` —— 运营回顾「越用越准」页顶部 amber「合成演示·非真实学习」+ MAPE 曲线标「合成回放」。
- `docs/evidence/CALIB-HONEST-EMPTY-calibration.png` —— 校准页合成提案 SYNTHETIC 徽章。

**前端所见 == 后端真值**：bundle.synthetic=true（curl）→ 前端「合成演示·非真实学习」渲染（browser）；seed 提案 synthetic=true（curl）→ SYNTHETIC 徽章（browser），非合成提案无徽章（牙齿）。

## C3 jsdom 牙齿 `test/calib-honest-empty.test.tsx`（4 用例·摘条件即红）

- ①a ReviewView 合成 bundle → review-synthetic-badge + mape-synthetic-note；
- ①b 牙齿：`bundle.synthetic=false`（真实学习）→ 徽章不出（对照）；
- ② report.baselineOnly → calib-baseline-only「静态基线·无真实配对」；
- ③ synthetic 提案 → calib-synthetic-prop-1 SYNTHETIC，非 synthetic prop-2 无徽章。

## 四包全绿 + gates

- datacore 879 passed / frontend 388 passed（含新 4 用例）/ agentcore 363 passed。
- `pnpm gates` exit 0（含 ontology-slices 母体一致 hash dafb44a78d94ca0d·genuine-sim:check v2·no-orphan-source 等全绿）。

## 本体回写

`docs/SYSTEM-ONTOLOGY.md §8 G-DM-1` 追加 WO-CALIB-HONEST-EMPTY 治本记录（6 site + 契约 + 前端消费门 + 牙齿）；`docs/AUDIT-fake-value-remnants.md §2 簇C` 全 6 行标 ✅ 已闭 + 治本列。

## 诚实边界（距北极星）

- 合成回放曲线**保留**（确定性合成走正门·平台自身允许），治本是**标 SYNTHETIC 边界**让人分辨，非删除演示数据。
- C6 demo 收敛走真引擎（真算 MAPE）·输入 observation 是确定性合成（reverse-solve biases）→ 属"确定性合成走正门"，UI 标由全局 synthetic watermark 覆盖 demo 租户；真实租户由真 CALIBRATION_SWEEP 逐轮累积真观测产生真收敛。
- 真实精度提升只在 LIVE·真 pair 路径出现（baselineOnly=false）；这是"越用越准"的真实证据边界。
