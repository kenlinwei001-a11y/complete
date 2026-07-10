# PRD · 产能推演决策流重构（假推演根治 + 型号维度 + 运营负责人一条龙）

> 触发：用户 2026-07-10 逐条实测产能推演/推演沙盘，指出"每基地恒红=假推演？利用率2%/demandDelta0 不合逻辑、tick 要手点、分支点了没反应、跳转丢基地、没有型号维度、看不到瓶颈/方案、不知每功能解决运营负责人什么问题"。
> 三个真跑代理（真起服务·真浏览器·逐值对照后端）诊断落定，本 PRD 把诊断转 8 张 WO。**证据源**：`scratchpad/DIAG-capacity-sim.md`（每条带 file:line + 真端点响应）。
> **纪律（钉死·铁律0.4）**：一切真实测试；前端真看 UI 逐值对照后端；绝不用合成/哈希/兜底冒充真值；暗发 feature key·additive·旧路径保留·回退演练入齿。

## §0 本体引用与影响（铁律0·必读）
- **对象类型**（§2）：Base（基地）· Line（产线，`utilization` 百分）· Process（工序，`utilization` 分数）· Model（电池型号，一等类型·graphmeta product 域）· Order · DemandSegment（需求预测）· SopVersionRow（S&OP 供需）· SimSession（沙盘会话，scope.presetContext）· RiskCard（风险卡·tightness/series）。
- **链路**（§3）：① 风险张力链 `Line.utilization(合成)→risk.ts liveTightness→RiskCard.series→前端染色`；② 真供需链 `DemandSegment/SopVersion→demandCapacityTightness`（**现存但被①绕过**）；③ 沙盘 KPI 链 `view-config→SandboxView stateVar 均值`；④ what-if 跳转链 `openWhatIf→URL→SimSession.scope.presetContext→deriveBaseSnapshot`；⑤ 型号产能链 `capacity_forecast(modelId)→型号可产基地网络 PRODUCIBLE_AT`（**后端有·前端未surface**）。
- **不变量**（§5）：R6 确定性种子 · R13 可溯源 · R14 配置驱动零业务常数 · **R17 十红线/KILL-MOCK-RED**（本 PRD 核心·"绝不用合成冒充真值"）· R2/R3 租户与沙盘隔离。
- **断点**（§8）：**新登 G-SIM-FAKE**（风险张力建在合成扁平 `util:line`(mean92 全基地同) 上、绕过真供需模型 demandCapacityTightness=假推演·WO-CAP-01 闭）· **G-3**（presetContext 未真注入生效·WO-CAP-06 闭）· G-5（应用层电池锁死·相关）。
- **回写**：WO-CAP-01 落地后回写母体 §8 新增 G-SIM-FAKE 并标闭；WO-CAP-06 落地后回写 G-3 状态；WO-CAP-07 新增链路⑤前端 surface 回写 §3。跑 `pnpm ontology:slices` 同步切片（门 ontology-slices:check）。

---

## §1 总诊断（真跑坐实·一句话）
**没伪造数据数组，但"红/张力"是合成扁平常数（`battery.ts:1280` util:line mean92 全基地同值）驱动、绕过了系统自有的真供需模型（`demandCapacityTightness` 对常州算 ~65 本不该红）= 假推演；沙盘数据诚实但口径（跨异质变量混算÷575 的无量纲大数）/布局（分支结果甩到 1652px 首屏外）/信息架构（4 卡默认全折叠·技术黑话·无量纲）差到让诚实数据看着又假又坏。** 型号维度后端现成、前端从未建。

---

## §2 WO 清单（8 张·分层·带开发细节 file:line）

### 🔴 WO-CAP-01-REALDEMAND（P0·假推演根治·闭 G-SIM-FAKE）
**问题**（真跑 Agent A）：风险张力 = `Line.utilization×0.9+8`（`apps/datacore/src/solvers/risk.ts:183`，utilK=0.9/utilBase=8 `battery.ts:143`），输入是合成扁平 `util:line`(mean92·全基地同种子)→每基地算出~92 全 ≥ 阈值 85 → 全红。系统自有真供需模型 `demandCapacityTightness`（读 DemandSegment/SopVersion 真预测 vs 产能·`risk.ts:144-162`）对常州算 ~65（<阈值·本不该红），但 `liveTightness` 先走 lines-utilization 分支（`risk.ts:179-184`）→ 真信号根本没被采用。改订单/需求红条纹丝不动。
**改造**（file:line + 改法）：
1. `risk.ts:179-184`：需求驱动的瓶颈因子（"物料齐套/交付/产能"类）**优先取 `demandCapacityTightness`**（真 DemandSegment/SopVersion vs 产能）；仅当无真供需数据时才回落 Line.utilization，且回落时**标注 source=SYNTHETIC**。设备/工艺类因子（OEE/良率）保留读工序序列（那本就是设备态·合理）。
2. `risk.ts:428-437`（代表因子选择"取真张力最高的真源因子"）：**排除 source=SYNTHETIC 的因子**参与"决策级染红"竞选（合成因子只作背景估算灰显·不当主瓶颈）。
3. `risk.ts:481` + `apps/datacore/src/solvers/service.ts:1967-1971`（applyConfidenceDimensions·isSyntheticDecision）：**诚实位下沉到卡/因子级**——卡输入是合成物化序列时，`dataMode` 继承 SYNTHETIC 而非自报 LIVE；前端 `RiskBoardView.tsx:133-138` cardDecisionMode 据此不把合成数据当决策级 LIVE 染红（改走灰"估算·无实测"）。
**Feature**：env/feature `qos.risk_realdemand`（defaultOn:false·暗发·关闸=现行 lines-utilization 分支不变）。
**验收**：
- C1 真跑：`POST /a/v1/solvers/risk_timeline`（或前端风险看板真浏览器）开关 ON → 常州"物料齐套/产能"类因子张力取 demandCapacityTightness(~65) < 阈值 85 → **常州不再决策级染红**（走灰估算或绿）；至少一个真紧约束基地（hefei/合肥·真供需 tight）仍红。**逐值对照**：卡 tightness == demandCapacityTightness 端点值。
- C2 真跑·敏感性：改一个基地的 DemandSegment.p50（真需求）→ 该基地张力**真变**（证红对真需求敏感·非合成常数）。开关 OFF → 回现行全红（回退演练）。
- C3 诚实位：合成源卡 dataMode=SYNTHETIC·前端不染决策红（真浏览器截图对照）。
- C4 gate：genuine-sim/no-fake-done 绿·datacore test 绿·母体 §8 回写 G-SIM-FAKE（ontology-writeback:check 绿）。
- C5 R6：同 seed 同输入两跑字节一致。

### 🔴 WO-CAP-02-SEED-VARY（P0·种子按基地分化+衰减·治恒红无涨落）
**问题**（真跑 Agent B/A）：`util:line` 全基地钉 mean92（`battery.ts:1280`）；传导规则 `combine:"sum"+decay:null`（`apps/datacore/src/seed.ts:300/316/333`）→ loadIndex 单调增无衰减·只涨不落（无涨落）。
**改造**：
1. `battery.ts:1710-1711/1728/1747-1748`（产能生成）+ `:1280`（util:line）：按 baseId 乘**确定性固定映射表**（⛔非 rng·守 R6），瓶颈基地（`BATTERY_SOLVER_PARAMS.bottleneck.primary` `:127-140` 已定常州/江门/合肥）给高负荷、非瓶颈给低负荷。示例配比（真需求/真产能落 60–110%·有红有绿）：产能乘子 `{常州:0.78,合肥:0.75,江门:0.82,成都:1.15,厦门:1.25,其余:1.0}`。
2. `seed.ts:300/316/333`：传导规则加 `decay`（0.85~0.95）/`clamp`（上限），使 loadIndex 有升有降（逐日涨落）。
**验收**：
- C1 真跑：风险看板 8 基地**有红有绿**（非全红）；沙盘逐日 tick 时间轴**有涨有落**（非单调）。真浏览器截图 + 端点值对照。
- C2 测试影响：只调产能常量/订单量/per-base 乘子（**⛔勿动 util/OEE/良率时序均值**·否则 `solvers.test.ts:211-314` risk_timeline/bottleneck "常州物料齐套"基线断言破）；`synthetic.test.ts` SY1(:17-46 确定性 deep-equal)/SY2(:142-183 从同源重算) 应仍绿。列出受影响断言。
- C3 R6：同 (industry,scale,seed=42) 重跑字节一致。

### 🟡 WO-CAP-03-KPI-FIX（P1·沙盘 KPI 口径正名·治利用率2%误导）
**问题**（真跑 A/B）：沙盘 KPI（`apps/frontend-shell/src/views/sim/SandboxView.tsx:1003`）= 各 stateVar 在**全部 575 对象**取均值 → 92%线利用率+0.95分数工序利用率混算÷575=2.0（误标"利用率"）；`globalKpi`(`:743-747`) 跨异质变量混算原始量级(totalDemand 32万)→ 3339.5 远超注释宣称 0-100、恒过阈值 70 恒红。B 另指就绪雷达"利用率"= `cert.knowledge`=schema 覆盖率（`certification.ts:131-133`·SandboxView `:302/401`）与产能利用率无关、只 init 算一次。
**改造**：
1. `SandboxView.tsx:1003`：每 stateVar **只在携带该变量的对象上取均值**（非÷575·按 nodeType 归属分母）；`Line.utilization`(百分)与 `Process.utilization`(分数`battery.ts:1690`)**聚合前统一量纲**（都归一到 0-1 或 0-100）。
2. `SandboxView.tsx:743-747` globalKpi：按变量归一后再聚合，或改"各 stateVar 分列展示"，勿冒称"0-100 全局态"（注释 `:998` 与真值矛盾·一并订正）。
3. `SandboxView.tsx:302/401`：把 `cert.knowledge` 的展示名从"利用率"**正名为"schema 覆盖率/建模完整度"**（它就是这个·R14 展示词入 i18n `zh.ts`）。
**验收**：C1 真跑逐值：每 KPI == 后端该变量在其归属对象上的真均值（浏览器对照端点）；利用率显真产能利用率区间（非 2.0 稀释值）。C2 R6/gate 绿。

### 🟡 WO-CAP-04-TICK-DAYS（P1·tick 改输入天数批量推演·纯前端）
**问题**（真跑 B）：`SandboxView.tsx:1016-1018`「推进 tick」`onTick`(`:790-804`) 每点调 `simTick(sessionId,1)` 恒 +1。后端 `apps/datacore/src/app.ts:1412/1426` `for i<n` **本就支持 N 步**（body.n）；前端已有 `runTicks(n)`(`SandboxView.tsx:867-892`)。
**改造（纯前端·后端不动）**：命令条(`:1015`)加 `<input type=number>` 天数 N（`useState`）；「推进 tick」按钮改调 `runTicks(days)`（逐日 push history·时间轴逐日有值）。可选放宽 `parseSandboxIntent:541` 的 `Math.min(50)` 上限。
**验收**：C1 真跑：输入 N=7 点一次 → 推进 7 天、时间轴 7 个点、curTick +7（浏览器对照端点 curTick）。C2 R6：同 N 同 seed 字节一致。C3 回退：默认 N=1 等价现行。

### 🟡 WO-CAP-05-BRANCH-VISIBLE（P1·分支结果可达·治"点了没反应"）
**问题**（真跑 C）：分支后端全绿（checkpoint201→branch201→compare200）、`SimComparePanel` 真渲染真值（A3339.5/B9617.1/差+6277.6），但对比卡在右栏折叠栈**倒数第二**（`SandboxView.tsx:1196-1209`）、boundingBox.y=**1652px 首屏外**→ 用户不下滚以为失效。
**改造**：① 对比卡移出右栏栈底（`:1196-1209`）到**左主区**（DAG 下/AI 台上）或右栏顶·分支活跃时优先可见；② `onBranch` 成功后（`:817-832` setCompare 后）加 `scrollIntoView`/高亮定位到对比卡。
**验收**：C1 真跑真浏览器：点「分支」→ 对比卡**进入首屏视口**（boundingBox.inViewport=true）+ 真 A/B 五维差异可见（对照端点 compare 值）。C2：不破右栏折叠记忆（§5 密度）。

### 🟡 WO-CAP-06-WHATIF-SCOPE（P1·跳转真带基地并生效·闭 G-3）
**问题**（代码确认+真跑）：`openWhatIf`(`whatif.ts`)把 subject(基地)编进 URL、沙盘 `SandboxView.tsx:972-982` 渲染徽章、`:754` 注入 scope.presetContext；但 `:750-755` init 用 `deriveBaseSnapshot(cfg)` 从**全量 view-config** 派生世界、**未按 presetContext.subject 裁剪**=基地名只是摆设、推演没真聚焦（G-3）。且"开始推演"(`zh.sim.run`)在 tsx 无消费点→疑另一按钮不接 openWhatIf。
**改造**：① `SandboxView.tsx:750-755` init：当 `whatIf.subject` 存在时，`deriveBaseSnapshot` **按该基地裁剪世界对象**（只纳入该基地及其上下游·R3 隔离）→ 推演真聚焦；② 排查产能推演/风险看板所有跳沙盘按钮，统一走 `openWhatIf`（带 whatif 参）·消灭裸 navigate；③ "开始推演"按钮（找到其组件）接 `openWhatIf({subject:base,...})`。
**验收**：C1 真跑：从产能推演基地卡点"开始推演"→ 沙盘**显基地徽章 + 世界真按该基地裁剪**（对象数 < 全量·对照端点 SimSession.scope + baseSnapshot）；C2 回写母体 §8 G-3 标闭（ontology-writeback 绿）。

### 🟢 WO-CAP-07-MODEL-DIM（P2·产能推演加电池型号维度·用户明确要）
**问题**（代码确认）：后端型号维度**现成**——`capacity_forecast` 求解器按 modelId 建（`apps/datacore/src/catalog.ts:86`「给定型号/数量/周数·P50/P90/缺口率/主瓶颈」）·Model 一等类型（`graphmeta.ts:40`）·型号可产基地网络 PRODUCIBLE_AT（`catalog.ts:33`）·Model.totalDemand·型号×产线认证·BOM。但前端产能推演（风险看板 `/v/risk`）**纯基地视角·无型号切片**。
**改造**：① 产能推演页加**型号维度切换/筛选**（型号列表来自本体 Model 对象·R14 配置驱动）；② 选型号 → 调 `capacity_forecast(modelId,qty,weeks)` 出**该型号的产能满足度 P50/P90/缺口率/主瓶颈**；③ 型号级瓶颈（该型号在哪些基地/工序卡点·走 PRODUCIBLE_AT）+ 型号级方案（mitigation 按型号）；④ 跳沙盘时带 `model` 入参（whatif.ts 已有 model/demand/weeks 字段·`:24-26`）→ 型号级 what-if。
**验收**：C1 真跑真浏览器：选一个真型号（如 4680-NCM）→ 产能推演显该型号 P50/P90/缺口/主瓶颈（逐值对照 `capacity_forecast` 端点）·型号级瓶颈基地列表真（对照 PRODUCIBLE_AT）。C2：型号列表来自本体非写死。C3 R6/gate 绿。**《本体影响》**：新增链路⑤前端 surface·回写母体 §3。

### 🟢 WO-CAP-08-OPS-FLOW（P2·运营负责人一条龙·治设计不清晰·依赖 05/06/07）
**问题**（真跑 C）：瓶颈量化矩阵+方案在风险看板页、推演+对比在沙盘页、拆两页；4 卡默认全折叠（仅就绪卡展开）·卡名技术黑话·无量纲 → "技术自证正确但运营看不懂/找不到"。
**改造**：① 把「看瓶颈（风险看板）→ 开推演（沙盘·带基地/型号）→ 比方案（分支对比）→ 采纳（Action 审批）」串成**一条可见路径**（风险看板卡上"开推演对策"已通沙盘·补沙盘内"回看瓶颈/看方案→风险看板"跳链·双向导引不落死路）；② 沙盘 4 卡（`SandboxView.tsx` CollapsibleCard `:1143/1163/1177/1184`）title/summary 各加**一句"解决运营负责人什么问题"**的场景语（雷达=决策可信度体检·风险TOP3=哪基地工序张力最高·Schema=口径透明可审计·运行台=对话式深挖）；③ **默认展开风险 TOP3**（运营最关心）；④ 本页无 bottleneck_matrix/mitigation 处加"深挖瓶颈/处置方案 → 风险看板"跳链（别让用户以为本页该有却没有）。
**验收**：C1 真跑真浏览器走一条龙：风险看板选基地→开推演→沙盘聚焦该基地→分支比 2 方案→采纳产 Action 草稿（逐步真跑不断链）。C2：4 卡场景语可见·风险 TOP3 默认展开。C3：跨页跳链无 404 死路（R3 门控·关沙盘 entitlement 时诚实降级）。

---

## §3 依赖与批次
- **批 1（P0·假推演根治·先做）**：WO-CAP-01（绑真供需·闭 G-SIM-FAKE）→ WO-CAP-02（种子分化·02 可与 01 并行·但验收"有红有绿"需 01+02 合力）。
- **批 2（P1·口径+交互·并行）**：WO-CAP-03（KPI 口径）· WO-CAP-04（tick 天数·纯前端最快）· WO-CAP-05（分支可达）· WO-CAP-06（跳转 scope·闭 G-3）。
- **批 3（P2·功能·后做）**：WO-CAP-07（型号维度）→ WO-CAP-08（一条龙·依赖 05/06/07 落地后串接）。
- **复验（审核方·每单真跑）**：真起服务 + 真浏览器逐值对照后端（铁律0.4）；P0 两单必须真浏览器看到"不再全基地恒红 + 红对真需求敏感"；造假零容忍。
