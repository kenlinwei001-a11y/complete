# WO-CAP-06-WHATIF-SCOPE 真跑证据（闭 G-3 沙盘侧末环）

> 纪律：铁律 0.4 一切真实测试·前端真看 UI 逐值对照后端。真起 datacore:4001 + agentcore:4002 + vite preview:5199（VITE_*_URL 指真服务），真浏览器（chromium /opt/pw-browsers）驱动登录 → 产能推演 → 基地卡「开始推演」→ 沙盘，逐值对照后端 `SimSession.scope`+`baseSnapshot`。

## 问题（改前）
`openWhatIf` 把 subject(基地) 编进 URL、沙盘渲染徽章、`init` 注入 `scope.presetContext`，但 `SandboxView init` 用 `deriveBaseSnapshot(cfg)` 从**全量 view-config（575 对象）**派生世界、**从不按 presetContext.subject 裁剪** → 基地徽章只是摆设、推演进的仍是全网世界（假聚焦·G-3）。且 `zh.sim.run`「开始推演」在 tsx **无消费点**（产能推演基地卡无跳沙盘按钮）。

## 修法（纯前端·R6 确定性·无网络/随机）
- `apps/frontend-shell/src/views/sim/whatif.ts`：新增 `resolveBaseId`（subject 中文名/拼音 → 规范 baseId·**`BASE_REGISTRY` 单一来源** `@platform/contracts`）· `objectBelongsToBase`（对象 id 内嵌基地拼音 token·`[_-]` 分隔符定界防误配）· `cropConfigToBase`（nodeObjectIds/nodeObjectState 只留本基地·无匹配→退全量防空世界）· `cropWorldToBase`（baseSnapshot 滤键）。
- `apps/frontend-shell/src/views/sim/SandboxView.tsx`：cfg 经 `cropConfigToBase` 裁剪（DAG/KPI 聚焦本基地）；`init` 的 baseSnapshot 经 `cropWorldToBase` 只含本基地对象；scope 记 `baseId`。
- `apps/frontend-shell/src/views/sim/ProjectSimView.tsx`：产能推演 step5 逐基地行新增「开始推演 →」按钮走 `openWhatIf({source:project-sim,subject:base,factor:瓶颈,model})`；`sim.sandbox` 关时禁用不跳 404。

## 真浏览器 + 真后端复验（脚本 scratchpad/verify-cap06.mjs）
```
全量 view-config 对象数 = 575
产能推演基地卡「开始推演」按钮数 = 3
点击基地卡「开始推演」：常州
沙盘 what-if 基地徽章 = 「常州」
SimSession.id = sims_9f2z4c7a1x7rv451
SimSession.scope = {"presetContext":{"source":"project-sim","subject":"常州","factor":"瓶颈工序",
                    "label":"常州 · 瓶颈工序","model":"4680-NCM"},"baseId":"changzhou"}
baseSnapshot 对象数（裁剪后） = 22  vs 全量 575
baseSnapshot 中不属于 changzhou 的键数 = 0（应为 0·R3 隔离）
presetContext.subject = 常州 → scope.baseId = changzhou
✓ WO-CAP-06 复验通过
```
截图 `docs/evidence/WO-CAP-06-WHATIF-SCOPE.png`（what-if 上下文条「常州 · 瓶颈工序」+ 常州徽章可见）。

### 逐值核对（前端所见 ↔ 后端真值）
- 前端沙盘徽章 = 「常州」 ↔ 后端 `SimSession.scope.presetContext.subject = 常州`、`scope.baseId = changzhou`。
- 世界真裁剪：`baseSnapshot` 22 对象 < 全量 575（= view-config `nodeObjectIds` 展平数）。
- R3 隔离：`baseSnapshot` 全部键归属 changzhou（不属于 changzhou 的键 = 0）——他基地对象一律不入本会话世界。
- 常州 22 对象（真列出）：`obj_base_changzhou` + `obj_line_LINE-changzhou` + 5 工序 + 6 设备 + 检修/在途/2 认证/能耗/碳因子/财务/2 人力班次。各基地 20~23 对象 disjoint（无跨基地误配，curl 全 12 基地交叉核实）。

## 牙齿
`apps/frontend-shell/test/wo-cap-06-whatif-scope.test.tsx`（6 例）：resolveBaseId/objectBelongsToBase/cropConfigToBase/cropWorldToBase 纯函数 + `<SandboxView injectedPreset={subject:常州}>` → createSimSession 的 baseSnapshot 只含常州 4 类对象（数<全量）+ scope.baseId=changzhou；revert 裁剪 → 红。前端全量 `pnpm --filter frontend-shell test` 533 绿（含本 6 例）。

## 母体回写
`docs/SYSTEM-ONTOLOGY.md` §8 G-3 补 WO-CAP-06 闭合条（沙盘侧末环 ✅）+ 重生成 11 切片（`build-ontology-slices.mjs`·hash 一致）；`ontology-writeback:check` 绿。
