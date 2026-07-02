# REVIEW · SIM-PRESET-INJECT → 🔴 BLOCK（命门 e2e 未通·真启动器点卡不注入视图）

> 审核方真 curl + 真浏览器（chromium + 真 datacore4001/agentcore4002/vite5200·非 mock）逐条核。判决 **BLOCK**：dev 把视图侧 URL-param 注入做真了（可 credit），但**接错通道 + 只 1/4 视图 + 真启动器根本不发这些参数** → WO 的命门目标"从场景启动器点卡→落视图对口"e2e 未达。

## 判决：🔴 BLOCK（3/6 达 · 命门 C1 e2e 断 · C2/C4/C5 未做）

| # | 断言 | 结果 | 证据 |
|---|---|---|---|
| C1 | 从**场景启动器点卡**→落 project-sim→型号=4680-NCM/+20%/6周注入 | 🔴 **e2e 断** | 真点启动器卡→落 `/v/project`(bare·无 whatif 参数)·型号选择器空·preset 上下文条 null·**未注入**。仅**手搓 URL** `?whatif=1&model=4680-NCM&demand=55&weeks=8` 才注入(见下 credit)——真用户路径不通 |
| C3 | capacity_forecast 带入参 curl==前端所见 | ✅(隔离) | 手搓 URL→前端发 `{modelId:4680-NCM,qty:55,weeks:8}`→gap=48.4953/p50=6.9943/p90=6.5047·curl 同 args **逐值一致**·control 默认 qty40/weeks6→gap=35.18(证 preset 真改结果) |
| C2 | plan-audit 带 cashCushion=45亿→现金垫字段覆盖 | 🔴 **未做** | PlanAuditView **0 处** parseWhatIfPreset/preset 读；卡 `{cashCushion:4.5e9}` 无处消费 |
| C4 | 单一通道·**4 视图**初始化读取 | 🔴 **仅 1/4** | project-sim 读 URL whatif；plan-generate/plan-audit/sop-balance **各 0 处**读 preset 通道·无 sessionStore.presetContext 字段 |
| C5 | sop-balance 示例占位值未改→运行软阻断/强确认 | 🔴 **未做** | 仅前序 WO-DM-tail 的诚实徽标(DataModeBadge"勿喂 C21")·**无运行前 soft-block/confirm** |
| C6 | 四包 build/test 退0 + 牙齿 | ✅ | `sim-preset-inject.test.tsx` 4/4·build 退0(审核方复跑) |

## 命门根因（3 重断链·真启动器点卡为何不注入）
1. **launcher→view 不发参数**：`useQuickLaunch`（`ScenarioLauncher/useScenarioLaunch.ts:38`）`navigate(\`/v/${targetView}\`)` **bare·无 query**；slotPresets 只进 `submitQuery` 的 QOS query context(:41·→对话坞)。而 `ProjectSimView` 只读 **URL searchParams**(`parseWhatIfPreset(searchParams)`)——两者无接线 → **slotPresets 到不了视图**。这正是 WO 要治的 G-3("presetContext 只进 QOS Dock·视图用 models[0]×40万")·**未治**。
2. **参数名不对齐**：卡 slotPresets 用 `modelId`/`demandDelta`(相对+20%)；whatif 通道 + `resolveSimPreset` 用 `model`/`demand`(绝对)——即便接上 URL 也**映射不上**(名不同·相对 vs 绝对语义也不同)。
3. **targetView vs renderer 不对齐**：卡 `targetView="project"`，renderer 键 = **`project-sim`**(registry.ts:46)——`/v/project` 不渲染 ProjectSimView(e2e 型号/输入全空即证)。

## Credit（不抹杀·可复用）
project-sim **视图侧 URL-param 注入本身真实可用**：手搓 URL→`resolveSimPreset`(R14 型号白名单守·R6 裁剪) 真注入型号/需求/时窗初值·真发进 capacity_forecast·前端所见=后端 oracle 逐值·control 证真生效·牙齿 4/4·preset 上下文条 honest 可见。**问题是接错通道(URL 而非 launcher slotPresets)+ 只 1/4 视图 + launcher 不发这些参数**。

## 修法（给 dev·narrow）
1. **接命门**：`useQuickLaunch` 把 slotPresets 编码进落点 URL(`navigate(\`/v/${targetView}?${whatIfQuery(...)}\`)`)**或**存 `sessionStore.presetContext` 供视图读(C4 要的单一通道)。
2. **对齐**：参数名 `modelId→model`(或 resolveSimPreset 兼容 modelId)·`demandDelta`换算绝对 demand(或求解器支持 demandDelta)·`targetView` 修为 `project-sim`。
3. **扩 4 视图 + C5**：plan-audit 读 cashCushion·plan-generate·sop-balance 读各自 slot·sop 运行前对未改示例占位值 soft-block/强确认。
4. 复用现成 `resolveSimPreset`/`whatIfQuery`(已真跑)·additive 不回归 P/O 层。

## 本体引用与影响
- 断点：**G-3**(presetContext 未注入视图·本单目标未达·仍断在 launcher→view 接缝)·G-VIS-1。
- 不变量：R14(型号白名单·resolveSimPreset 已守)·R6(裁剪确定性·已守)·R17(问句与视图对口·未达)。
