# WO-SIM-PRESET-INJECT · FDE 真实交付证据（G-3 / G-VIS-1）

> **v2（BLOCK 复修）**：审核方首轮 BLOCK——视图侧 URL 注入真实但**接错通道**（真启动器点卡走 sessionStore.slotPresets 且落 `/v/project` bare·未注入）+ 参数名不对齐（modelId/demandDelta vs model/demand）+ targetView 短键落点不渲染 + 仅 1/4 视图。本轮**接命门单一通道 + 对齐参数 + 修落点键 + 扩 4 视图 + C5 软阻断**，真启动器点卡 e2e 已通（见 §3-命门）。

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

## 3-命门（v2·BLOCK 复修）· 真启动器点卡 e2e（单一通道 · 4 视图 · C1-C5）

**根因修（3 重断链·narrow）**：
1. **接命门（C4 单一通道）**：`useQuickLaunch` 除把 slotPresets 送 QOS 对话坞外，**同时**落 `sessionStore.scenarioPreset{targetView,slotPresets,label,nonce}`；落点视图经 `useScenarioPreset(viewKey)` 读之（`normalizeViewKey` 两侧归一·nonce 只消费一次）。此前 slotPresets 只进 Dock → 视图用 models[0]×40万（G-3 未治）。
2. **对齐参数（治「名不同/相对vs绝对」）**：`scenarioSlotsToPreset` 把卡的 `modelId→model`、`demandDelta`(相对)→绝对 `demand`（以 DEFAULT_QTY=40 为基·`0.2→48`）、`weeks` 直传。
3. **修落点键（治「/v/project 不渲染」）**：`useQuickLaunch` 导航用 `normalizeViewKey(targetView)`（`project→project-sim`）——ViewPage 按 `workspace.views` 的**规范键**查视图，短键 `/v/project` 查不到 → ForbiddenPage（真启动器点卡落空白·视图不渲染）。

**真启动器点卡 e2e（真浏览器·datacore4101+agentcore4102+前端真构建4105·planner 登录）**：
`/scenarios` → 点 **S01 卡「4680-NCM 加 20% 六周能不能接？」**（后端真卡·`slotPresets={modelId:4680-NCM,demandDelta:0.2,weeks:6}`·targetView=project）：

| 断言 | 结果 |
|---|---|
| 落点 URL | `/v/project-sim`（规范键·非 bare `/v/project`）✓ |
| ProjectSimView 渲染 | present ✓（此前 ForbiddenPage） |
| sim-preset-context 上下文条 | 出「4680-NCM 加 20% 六周能不能接？」✓ |
| 型号注入 | select=**4680-NCM** ✓ |
| 需求注入（demandDelta 0.2→绝对） | 需求(万套) input=**48**（=40×1.2·非默认 40）· 上下文条「需求 48 万套（+20%）」✓ |
| 时窗注入 | 交期(周) input=**6** ✓ |
| 求解器真用注入值 | qty=48 → 后端 oracle p50=5.18/p90=4.82/gap=43.18·dataMode SYNTHETIC（前端 input 48 == 求解器入参）✓ |

证据 `docs/evidence/screens/SIM-PRESET-INJECT-launcher-click.png`。

**C2（plan-audit·cashCushion）**：牙齿 e2e——scenarioPreset(targetView=audit·cashCushion=4.5e9 元)→ `/v/plan-audit` 现金安全垫输入注入=**45 亿**（元→亿转换）+ `audit-preset-context` 条。
**C4（4 视图单一通道·不串台）**：project-sim/plan-audit/plan-generate/sop-balance 各经 `useScenarioPreset` 读通道；牙齿证 targetView=project 的 preset **不落到** plan-audit（归一比对·不污染）。
**C5（sop-balance 软阻断）**：需求三线仍是示例占位值（=DEFAULT_SEGMENTS·电池兜底）→ 运行前 `sop-run-2-softblock` 强确认（防把示例值当真值喂 C21·改任一值即解闸）。

牙齿：`sim-preset-inject.test.tsx` 8 用例（原 4 URL 深链 + 新 4：scenarioSlotsToPreset 映射·命门 e2e qty=48·C2 cashCushion·C4 不串台）。

## 4-2. 边界（诚实·v2）
- ✅ 命门 C1 真启动器点卡 e2e 通（型号/+20%/6周注入·前端 input==求解器入参）· C2/C4/C5 达 · C3 逐值对上后端。
- ⚠ plan-generate 的 demo 卡（S05/S14/S17）slot 不含 GoalsState 数值目标键 → 通道已接（`useScenarioPreset`+goal-key override）但 demo 卡无可注入目标 slot 时不显条（诚实·非硬塞）；携带目标 slot 的卡即注入。
- 🔭 URL 深链通道保留（deep-link 兼容·原 4 用例仍绿），与 sessionStore 命门通道并存（launcher 走 sessionStore·分享链接走 URL）。

## 5. 门（本轮·v2）

`pnpm -r build` 4 包绿 · `pnpm -r test` 全绿（sim-preset-inject 8 用例 + 全前端 364） · `pnpm gates` 绿。
