# WO-FAKE-08 · P0 前端 defake 堵根 · FDE 交付证据

## 病根（堵前）
`SimComparePanel.tsx` 与 `SandboxRunHistory.tsx` 各自的 `tickMean` = **跨维扁平均**
（`Σ 所有对象 × 所有 stateVar ÷ cnt`·同 ÷575 病）：把 `totalDemand`(32 万量级) 等**无界计数变量**
与 `util`(0-100) 混进一个平均，产出既非 0-100 也无量纲意义的数，却被 A/B 对比表 / heat strip / sparkline
当**权威全局态 KPI** 显示 → 误导决策。

## 修复（一处口径·一处修双处引）
新增权威口径 `globalKpiFromState(state)`（`apps/frontend-shell/src/views/sim/shared.tsx`），与已修的
WO-CAP-03 `computeGlobalKpi`/`carrierMean`（`SandboxView.tsx`）**同口径**：
① 各 stateVar 只在**携带该变量的对象**上取均值（分母=携带者）；② 同变量跨分数(≤1)/百分(>1)两量纲则分数×100 归一到 0-100；
③ 仅纳入归一后 ≤100 的有界比率/百分变量（排除无界计数变量）；④ 末端 clamp 0-100；无有界变量→诚实返 0。
`SimComparePanel` 与 `SandboxRunHistory` 两控件同引本函数（删除各自的 `tickMean`）。

## C1/C2 真渲染 · 逐值对照后端真值（真起 datacore+agentcore+前端 Vite + 真 Chromium）
- 真起：datacore(:4001, SEED_DEMO=1 内存) + agentcore(:4002) + 前端 Vite dev(:5199·代理 /a/v1→4001)。
- 真数据：经**真 REST** 创建两个多变量 sim 会话（各对象携 `util` 有界 + `totalDemand` 32 万无界计数），
  逐 tick 真推进 + `/act` 真改态；`GET /a/v1/sim/compare` 为后端真值。
- 真浏览器：`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` Chromium(1194) 真 JWT 登录（demo/admin/demo1234）后
  挂载**真组件** `SimComparePanel` + `SandboxRunHistory`（非 jsdom），截图见 `WO-FAKE-08-render.png`。

### 逐值对照（真浏览器 DOM 所见 == 后端真值分维归一·非扁平均）
| tick | 后端真态(util L1/L2) | 分维归一 KPI(权威) | 若回潮扁平均 | 前端 DOM 所见(A) |
|------|----------------------|--------------------|--------------|-------------------|
| 0 | 60 / 40 | **50.0** | 155025.0 | **50.0** ✓ |
| 1 | 75 / 55 | **65.0** | 155032.5 | **65.0** ✓ |
| 2 | 90 / 80 | **85.0** | 155042.5 | **85.0** ✓ |

B 分支同法：DOM 所见 75.0 / 80.0 / 90.0 == 后端归一真值；差异列 +25.0 / +15.0 / +5.0 == B−A。
`totalDemand`(32 万) 被剔除，KPI 全落 0-100（此前扁平均恒 ~155042·恒过阈恒红）。
SandboxRunHistory 详情 sparkline：全局态起 75.0 → 终 **90.0**（= B tick2 归一真值），非扁平。

## C3 gate · 牙齿（跨维扁平均口径回潮即测红）
- 新增 `test/sim-compare-panel.test.tsx`（分维归一 + 量纲统一 + 诚实空态）；
  `test/sandbox-run-history.test.tsx` 补多变量+无界计数变量牙齿（终值须 85.0·非 155042.5）。
- 牙齿验证：临时把 `globalKpiFromState` 改回扁平均 → 3 条断言**红**；恢复后**全绿**（口径回潮即被逮）。
- frontend 全量回归：170 files / 547 tests 全绿。4 包 build 绿。`pnpm gates` EXIT=0（含 frontend 回归 / genuine-sim / no-fake-data）。
