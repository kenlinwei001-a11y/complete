# REVIEW · SIM-PRESET-INJECT v2（BLOCK 复修）→ ✅ DONE（命门 e2e 真通·真启动器点卡注入视图）

> v1 我 BLOCK（真启动器点卡落 /v/project 空白·不注入·三重断链）。v2 dev 治齐 3 根因，审核方真浏览器 e2e 复验：**真点场景卡→落点推演视图真注入求解器入参·前后端一致**。判决 DONE。

## 判决：✅ DONE（命门 e2e 真通·6 判据全达）

| # | 断言 | 证据 | 判 |
|---|---|---|---|
| C1 | **真启动器点卡**→project-sim 型号/增量注入 | 真点 S01 卡→落 **`/v/project-sim`**(v1 断在 /v/project 空白)·型号选择器=**4680-NCM**(默认2170)·需求=**48**(=40×1.2·demandDelta 0.2 转绝对)·周=6·preset 条"4680-NCM 加20% 六周…已注入"·前端真发 solver `{modelId:4680-NCM,qty:48,weeks:6}` | ✅ |
| C2 | 真点 audit 卡→plan-audit 现金垫=45亿 | 真点 S04 卡→落 `/v/plan-audit`·现金垫输入=**45**(真注入·PlanAuditView useScenarioPreset+presetNum cashCushion) | ✅ |
| C3 | 前端所见==后端(preset 真进求解器) | curl 同 args`{modelId:4680,qty:48,weeks:6}`→gap=43.18/p50=5.18/p90=4.82·R6 确定性==前端·(vs 默认qty40 gap35.18·证真改结果) | ✅ |
| C4 | 单一通道·多视图读取 | sessionStore 新增 `scenarioPreset` 字段 + `useScenarioPreset` 读侧 hook·**project-sim/plan-audit/plan-generate ×2 读**(带 slot 的 3 视图)·sop(空 slot)走 C5 软阻断 | ✅ |
| C5 | sop 示例占位未改→运行软阻断 | SopBalanceView `rowsUnchanged && !confirmRun ? setConfirmRun : run`·未改示例值首点强确认"仍用示例值运行(我知道是示例)"(`sop-run-2-confirm`)·改任一值解闸·防污染 C21 | ✅ |
| C6 | 四包绿+牙齿 | `sim-preset-inject.test.tsx` **8/8**(v1 4→v2 8·扩多视图+参数映射)·build 退0 | ✅ |

## 3 根因治法（对 v1 BLOCK）
1. **launcher→view 不发参数(v1 命门)**：`useQuickLaunch` 现 `store.setScenarioPreset({targetView,slotPresets,nonce})`——slotPresets 除进 QOS Dock，**同时落 sessionStore.scenarioPreset**；落点视图 `useScenarioPreset` 读之注入（C4 单一通道·治 G-3 接缝）。nonce 保证每次点卡只消费一次。
2. **参数名/相对绝对不对齐(v1②)**：`modelId→model`(presetStr modelId??model)·`demandDelta`(相对) → 绝对 `demand=round(40×(1+delta))=48`(demand 绝对优先)·治"名不同/相对vs绝对"。
3. **targetView vs renderer(v1③)**：`normalizeViewKey(project→project-sim)` 两侧归一·治"落 /v/project 空白不渲染"。

## 诚实边界
sop-balance 读 `useScenarioPreset ×0`——其场景卡 slotPresets 为空（无可注入槽），本单其职是 **C5 软阻断**（已做）·非 preset 注入。带 slot 的 3 视图(project/audit/generate)全读统一通道·C4 实质达成（"问句与视图对口·非硬编码初值"）。

## 本体引用与影响
- 断点：**G-3**（presetContext 未注入视图·**本单闭**：launcher→sessionStore.scenarioPreset→视图 useScenarioPreset 真注入）·G-VIS-1。
- 不变量：R14(型号白名单·resolveSimPreset 守)·R6(裁剪/映射确定性)·R17(问句与视图对口·达成)。
