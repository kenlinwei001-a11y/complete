# WO-SIM-PRESET-INJECT · FDE 真实交付证据（G-3 / G-VIS-1）

**WO**：推演 I 层入参对口 — 场景卡/决策入口带 `presetContext`（型号/需求/时窗）进**项目推演视图**（`/v/project-sim`），
把型号/需求/时窗**注入 capacity_forecast 求解器入参初值**（问句与视图对口）。此前 `modelId/qty/weeks` 硬编码、
丢弃 preset → I 层不对口（P/O 层已真接，断在 I 层）。

**关联断点**：G-3（presetContext 注入）· G-VIS-1（前端所见=后端真值）
**红线守法**：R6（纯函数确定性·非法值忽略）· R14（型号须命中当前 models 白名单·不硬塞未知型号）· KILL-MOCK-RED（SYNTHETIC 裁决降级灰）

---

## 1. 改了什么（additive·零回归）

- `apps/frontend-shell/src/views/sim/whatif.ts`：`WhatIfPreset` 扩 `model?/demand?/weeks?`（向后兼容），
  `whatIfQuery` 编码 + `parseWhatIfPreset` 解码（`num()` 助手·非有限数→忽略·R6）。复用 WO-E2 whatif 通道，不新建传参协议。
- `apps/frontend-shell/src/views/sim/ProjectSimView.tsx`：
  - 新增导出纯函数 `resolveSimPreset(preset, models)`：型号命中 `models` 白名单才注入（R14），
    需求下限 `Math.max(0.1, demand)`、时窗裁剪 `[1,52]`、缺省/非法→undefined（消费方走默认·诚实不硬塞）。
  - 组件：`useSearchParams` → `parseWhatIfPreset` → `resolveSimPreset` → 注入 `useState(injected.modelId/qty/weeks ?? 默认)`。
  - 新增 `sim-preset-context` 上下文条（问句与视图对口·honest 可见：场景带入/来源/型号/需求/时窗/已注入求解器入参）。
- 牙齿测试 `apps/frontend-shell/test/sim-preset-inject.test.tsx`（4 用例，全绿）：
  纯函数 R14/R6 裁剪 · whatif encode/decode 往返向后兼容 · e2e URL→上下文条+qty=55 · 无 preset→无上下文条走默认。

## 2. 真起服务真跑（无 mock·真三层）

- datacore `:4101`（SEED_DEMO=1·内存模式）· agentcore `:4102`（DATACORE_BASE_URL=4101）· 前端真构建 vite preview `:4105`
  （`VITE_DATACORE_URL/VITE_AGENTCORE_URL` 指向 4101/4102）。
- 真浏览器 Playwright（chromium）真表单登录 `demo / planner / demo1234`（走 app 自身 `loginSession`·非注 token）。

## 3. 前后端逐值对照（①curl 后端真值 ②真浏览器 screenshot ③逐值对上）

深链：`/v/project-sim?whatif=1&source=risk-board&model=4680-NCM&demand=55&weeks=8&label=4680 六周需求高企`

**后端 oracle**（`POST /b/v1/solvers/capacity_forecast/run` · args `{modelId:4680-NCM, qty:55, weeks:8}`）：
```json
{ "qty":55, "p50":6.9943, "p90":6.5047, "gap":48.4953, "ok":false, "dataMode":"SYNTHETIC", "healthFactor":0.93 }
```

| 值 | 后端真值 | 前端真浏览器所见 | 结论 |
|---|---|---|---|
| 需求 qty | 55 | 需求(万套) input = **55**（默认 40）· kpi-demand 55.0 · 上下文条「需求 55 万套」 | ✓ **preset 真注入求解器入参** |
| 时窗 weeks | 8 | 交期(周) input = **8**（默认 6）· 上下文条「8 周」 | ✓ 注入生效 |
| 型号 modelId | 4680-NCM | 上下文条「型号 4680-NCM」· 型号下拉选中 | ✓ 命中白名单注入 |
| p50 | 6.9943 | kpi-p50 **7.0**（fmt 一位小数） | ✓ 逐值对上 |
| p90 | 6.5047 | kpi-p90 **6.5** | ✓ |
| gap | 48.4953 | 裁决条「✗ 缺口 **48.5** 万套」 | ✓ |
| dataMode | SYNTHETIC | 披露横幅 `proj-datamode-banner` present · 裁决条 color = `rgb(140,150,166)` 中性灰（非决策红） | ✓ KILL-MOCK-RED |
| label/source | risk-board | 上下文条「4680 六周需求高企 / 来源：risk-board」 | ✓ 问句与视图对口 |

**证据截图**：`docs/evidence/screens/SIM-PRESET-INJECT-context-bar.png`（上下文条+入参初值）、
`docs/evidence/screens/SIM-PRESET-INJECT-step6-kpi.png`（step⑥ KPI 逐值+裁决灰）。

## 4. 边界 / 距北极星（诚实）

- ✅ **真做到**：URL preset（型号/需求/时窗）→ 项目推演视图入参初值真注入 → 求解器真用注入值算（qty=55 逐值对上后端），
  上下文条 honest 可见「哪个问句带入了哪些入参」；未知型号不注入（R14）；非法数值忽略（R6）；SYNTHETIC 裁决降级灰（KILL-MOCK-RED）。
- ⚠ **合成边界**：capacity_forecast 走 SYNTHETIC 产能基线（诚实标·非 LIVE），接入真实 IoT/MES 产能数据后转真实裁决——本 WO 不改此边界。
- 🔭 **下一环**：`resolveSimPreset` 目前只消费 whatif URL 通道；后续场景卡/风险板一键跳转到项目推演（而非仅沙盘）时，
  发起侧需传 model/demand/weeks（发起侧编码已具备 `whatIfQuery`，接线到具体决策入口按钮属后续 WO）。

## 5. 门（本轮）

`pnpm -r build` 4 包绿 · `pnpm -r test` 全绿（新增 sim-preset-inject 4 用例）· `pnpm gates` 绿。
