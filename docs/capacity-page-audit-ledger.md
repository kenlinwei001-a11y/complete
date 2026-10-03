# 「产能推演」页 100% 功能实证台账（WO-CAPACITY-PAGE-100PCT · LOOP）

> 方法：**在真浏览器里把每个可点/可切/可展开的控件当人一样操作一遍**（Playwright + 预装 Chromium `/opt/pw-browsers/chromium-1194`
> 驱动 vite dev → 真 datacore / agentcore 内存态；R1–R6 轮用 5199→4001，**R7 轮起改用 5299→4051 并加路由改写**，原因见下框），
> 对屏幕上每个数字做**变异**（改上游/换基地/换作用域/拖杠杆/后端直调对拍）
> 再判 **A 真算 / B mock / C 写死或没接上 / D 静默降级**。只读代码得出的结论一律不算数。
>
> 双侧对拍：① 浏览器记屏幕值 ② 同一组入参 `curl -X POST /a/v1/solvers/<key>/invoke` 直调求解器 ③ 比对。
>
> ⚠ **取证隔离（R7 轮踩到的坑·必读）**：前端 `src/env.ts` 在 localhost 下**写死直连 `http://127.0.0.1:4001`**，
> **不走 vite dev proxy**（`VITE_DEV_DATACORE` 只改代理、改不动浏览器端 baseURL）。R7 轮本机同时跑着**另外两条 WO 的
> 后台 dev**，:4001 已被 `worktree/agent-aa8750b3c6505d86b` 的 datacore 占用 → 第一次跑浏览器取证时，屏幕上 8/8 卡全是
> `瓶颈工序`（= 别人 worktree 的构建，R1 未修形态），**差点把别人的输出当成自己的证据**。
> 判据：`/proc/<pid>/cwd` 指向哪个 worktree。修法：本单自建 datacore 用 **:4051**，Playwright 里做
> `page.route("**://127.0.0.1:4001/**", → 改写到 :4051)` 并**打印改写命中次数**（=0 就说明证据取错了源）。
> 「进程还在≠还活着」的孪生坑：**端口是通的≠对面是我的构建**。
>
> 本体引用：R6 确定性 · R13 结论可溯源 · R14 应用层无业务常数 · R-一致 一个事实一个出处 · R-ARG-FIDELITY 接缝丢参保真 ·
> 断点 G-CAPACITY-INFER-PROCESS / G-CAPACITY-BASE-OUTLOOK / G-GAP-SCOPE / G-SEG-ATTR-BASE-SCOPE / G-WHATIF-HARDCODED-LEVERS /
> G-DISPOSITION-STATIC / G-UNIT-NORMALIZE / G-5。

## 一、控件台账（穷举）

| # | 控件/元素 | 操作 | 屏幕结果（修前） | 变异手法 | 屏幕是否变 | 分类 | 后端直调值 | 对得上？ | 结论/发现 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 视角 chip「瓶颈视角」 | 点 | 卡片网格 | 与「订单聚合」互切 | 是 | A | — | — | 纯前端态切换，正常 |
| 2 | 视角 chip「订单聚合」 | 点 | 经营聚合表 + 订单明细 24 单 | 切「按基地」维度 | 是（行从 3 应用细分 → 8 基地） | A | `affected_orders{horizon:30}` summary 24 单 | ✅ | 金额=Σqty×SEG 单价/1e4，带 Provenance；库存/产能列诚实「—」 |
| 3 | 推演窗口 chip 30/60/90 | 逐个点 | 修前：KPI 5 值/8 张卡**完全不变**（"受影响订单 1 批"三档同值） | 30→60→90→30 | 修前否；**修后是** | **A** | 修前 `risk_timeline{horizon}` 只改 series 长度，受影响订单被 21 天小窗锁死 → KPI 恒定；修 C3 后 30天→**8 单/4 客户**、60天→**22 单/8 客户**、90天→**22 单/8 客户** | ✅ | 修前"点了没反应"的真因是 C3（订单窗口口径），不是窗口 chip 本身没接线。**残留恒定项**「风险基地 8」＝`maxCards` 上限、「最早越线日 T+1」＝所有基地 LIVE 张力起点已 ≥ 阈值 85 故 `crossDay` 恒 1 —— 数学上必然，**可核查理由**，非缺陷 |
| 4 | 基地卡片（逐张 8 张） | 逐张点 | **8/8 卡「首要风险对象」全同 `瓶颈工序`**；7/8 张同时挂「⚠ 首要风险」徽章 | 逐基地对拍 `bottleneck_matrix{dataMode:LIVE}` | — | **C**（本基地真正的主瓶颈被代码排除 + 封顶值 tie-break 退化为数组序） | 信阳 物流时长 **92** > 瓶颈工序 91；江门 物料齐套 **96**；自贡 人力工时 **94** | ❌ 卡面 91 vs 真值 92/96/94 | **R1 已修**（见下 F1/F2）。修后：江门 物料齐套 / 邯郸 物料齐套 / 自贡 人力工时 / 信阳 物流时长 / 其余 4 张 瓶颈工序，**卡面因子恒等于该基地 LIVE 张力最高因子** |
| 5 | 卡面 dataMode 徽章 | 观察 | 「合成·未接实测」 | — | — | A（诚实灰） | `provenanceSynthetic:true` | ✅ | demo 底料确为合成物化，诚实标注正确 |
| 6 | 卡面峰值/越线日 | 悬停 Provenance | T+1 / 峰值张力 98 | 换基地 | 是（各基地当前张力 90–96） | A | `peak` 96–98·`currentTightness` 90–96 | ✅ | 峰值 98 是 `params.risk.cap` 量表上界（见 #9） |
| 7 | 卡面因素 chip（top2） | 观察 | 带「张力 N/100」量纲 | 换基地 | 是 | A | `bottleneck_matrix` 逐基地真值 | ✅ | 修前与卡面 headline 自相矛盾（#4），修后一致 |
| 8 | 卡面「N 个风险因素 / M 批订单受影响」 | 观察 | **8 张卡里 7 张恒显「0 批订单受影响」**；KPI「受影响订单(批)」= **1** | 与「订单聚合」tab 对拍 | — | **C/D**（窗口口径打架 → 恒空） | 卡用 `[crossDay−7, crossDay+14]`＝21 天小窗；聚合 tab 用 `[0, horizon]` → 24 单 | ❌ 同屏 1 批 vs 24 批 | **R7 已修**（F7）。修后 5/8 卡有单（信阳 D+28 / 厦门 D+18 / 合肥 D+14 / 常州 5 单 / 成都 2 单），江门·邯郸·自贡真无单（与聚合表一致） |
| 9 | 时序全景 30 天点阵 · 主因素行 | 悬停/观察每行颜色序列 | **每行 30 个点同一个色值**；瓶颈工序 91→98 / 物流时长 92→98 / 设备OEE 84→98 **三因子终点全 98** | 逐点取 `getComputedStyle().backgroundColor` | 否（红档色数=1） | **C（渲染层写死平色）+ D（封顶不披露）** | series 逐日真变（91,91,92,…,98,98…）；98 = `params.risk.cap` 封顶 | 数值对得上，**渲染把它抹平了** | **R2 已修**（F3/F4）：档内加深浅（信阳 物流时长 行色数 1→7，厦门 1→8）+ 行标注「末段贴顶 张力98/100 连续 N 天（张力量表上界·非逐日恶化）」 |
| 10 | 时序全景 · 其余 6 因素行 | 观察 | 各因素真逐日梯度（色数 5–7） | 换基地 | 是 | A | `factorSeries` 逐因素真序列 | ✅ | 本就是真算（每因素独立 `tensionSeries` 锚 `liveTightness`） |
| 11 | 逐日点点击 → 受影响订单弹窗 | 点第 i 天 | 恒「该基地在 D+i 无在产订单关联」 | 逐日点 | 否 | **C**（同 #8 病根） | `card.affectedOrders` 恒空 | — | 随 F7 一并修：订单交付 icon（▾ CT-a）现能真亮 |
| 12 | 逐日点 tooltip | 悬停 | 「D+1 · 张力91/100」 | 换日/换因素 | 是 | A | series[i] | ✅ | 带量纲，正常 |
| 13 | 图例三档 | 观察 | <70 正常 / 70–84 关注 / ≥85 瓶颈 | — | — | A | `threshold=85` 求解器下发 | ✅ | — |
| 14 | 根因推演树（全部因子·基地级） | 点卡展开 | 真树（6–22 节点，各基地节点数不同） | 换基地 | 是（信阳 6 / 邯郸 12 / 常州 22 / 厦门 10） | A | `gap_attribution{scope:{baseId}}` levels 真值 | ✅ | G-GAP-SCOPE 基地作用域**确已闭**且真生效 |
| 15 | 根因树叶级下钻 | 观察 | 订单叶 `SO-3470（南方电网）` 真单号；设备叶 `xinyang 设备瓶颈` drillId=`xinyang` | — | — | A（订单叶）/ **D（设备叶）** | `provenance.drillType=Equipment, drillId="xinyang"` | 部分 | **诚实边界**：设备叶下钻落的是**基地键**不是真设备号（引擎按基地聚合 OEE 缺口）。本单未修（属 `gap_attribution` 结构分摊颗粒度，改动面超出本页范围）→ 记为**已知残口**，见 §四 |
| 16 | 因子作用域 chip（7 个「按XX细分」） | **逐个点** | **点任何一个 → 整棵树消失**，落到「根因推演树暂不可用（诚实灰）」+ 一段过期病因「引擎…不接受 base×factor 作用域 / 仅缺引擎侧作用域」 | 7 个 chip 逐个点 + curl 对拍两个不同 factorId | 是（都变成同一个空态） | **C（作用域丢参）+ D（伪造病因）** | `gap_attribution{scope:{baseId:"信阳",factorId:"瓶颈工序"}}` → `scope` 里 **baseId 被丢掉**，只剩 `{factorId}`；且**两个不同因子返回逐字节相同**的单节点退化树 | ❌ | **R3+F5 已修**：factorId 必须命中真 `CausalFactor` 才走因果域；否则**保住 base 结构树**并诚实标 `factorApplied:false`+原因。修后 7 个 chip 全部 dagNodes=6，注解逐字变为「本次作用域 = 基地「信阳」；未按因子「X」细分——因子「X」无对应 CausalFactor 因果域」 |
| 17 | 根因树 loading 态 | 慢响应 | 请求还在飞就渲「根因推演树**暂不可用**」 | msw delay 3s | — | **D（把加载态渲成失败态）** | — | — | **R3-a 已修**：loading 单独渲「加载中…」，`rootcause-loading-<base>` |
| 18 | 20 因素本体图例（块C） | 观察 | 6 层 ①–⑳ 徽标 | 换基地 | 是（因子集随卡变） | A | `factorOntology` 单源 | ✅ | — |
| 19 | 可用产能派生诊断 DAG（块A） | 观察 | 自下而上 6 层 | 换基地 | 是 | A | `capacity_forecast` 派生链 | ✅ | — |
| 20 | 前瞻产能推演四线（BaseOutlookPanel） | 点 30/60/90 tab | 四线 + 缺口 | 换基地 | 是（江门 3,648 / 邯郸 7,432 / 信阳 11,380 / 常州 67,681 套） | A | `base_capacity_outlook{baseId}` 逐字对上 | ✅ | 真算 |
| 21 | 前瞻四线 · baseId 形态 | curl 三形态 | — | `obj_base_xinyang` / `xinyang` / `信阳` | — | **C（硬 404）** | `obj_base_xinyang` → `NOT_FOUND: Base obj_base_xinyang not found` | ❌ | **R4 已修**（F6）：走 `normalizeBaseRef` 单一出处，三形态返回逐字节相同 |
| 22 | 前瞻 · P1 逐日处置过程 | 展开 | D+1/D+8/D+15 三步 + rationale + 溯源 | 换基地 | 是 | A | `dayPlan[]` 逐字对上 | ✅ | 守恒：Σ closesGap == shortfall |
| 23 | 前瞻「按产品」维度 tab | 点 | byModel 每产品 T+30/60/90 | 换基地 | 是 | A | `outlookByModel`（join capacity_forecast） | ✅ | — |
| 24 | 产能爬坡 min 包络（块B） | 观察 | 6 子爬坡取 min | 换基地 | 是 | A | — | ✅ | — |
| 25 | what-if 杠杆区 · 杠杆集 | 打开不同基地卡 | 5 根滑杆 | 信阳 vs 江门 curl 对拍 | **否——两个基地返回逐字节相同，且对象全是 `obj_process_LINE-WS-**changzhou**-…`** | **C（`scopeObjectIds` 被引擎整个丢弃 + 候选按 id 字母序 slice(50) 恒截到常州）** | `generic_inference{mode:levers,scopeObjectIds:["base-信阳"]}` == `scopeObjectIds:["base-江门"]` | ❌ | **F8 已修**（本单最重）：作用域基地先过滤再探针 + 目标产能同尺度收窄到该基地。修后信阳卡拖杆下游派生显 `xinyang\|LINE-WS-xinyang-pack-coating`，敏感度从 1,162,710（全域）降为 50,454（本基地口径） |
| 26 | what-if 杠杆 · 逐根拖 | **逐个拖到 80% 位** | 5 根都能拖；tornado/before-after 真变 | 拖前 26天→拖后 41.6天 等 | 是 | A（重算是真的） | `generic_inference` dryRun deltas | ✅ | 修前"真重算但算的是别的基地" |
| 27 | what-if「调整前 X」 | 观察 | **「调整前可用产能 98.0」** | — | — | **C（量纲错标）** | 传入的是 `card.peak`＝峰值张力（0–100 指数），不是产能 | ❌ | **R8 已修**（F9）：文案改为「调整前峰值张力（0–100）」 |
| 28 | what-if 多方案利弊矩阵 | 观察/采纳 | 3 方案 产能增益 271,996.704 等 | 换基地 | 是 | A（值真算）/ **B-裸数字** | `generic_inference` 逐方案真算 | ✅ | **残口**：「产能增益」列无单位（后端 `capGain` 无 unit 字段可消费）→ 见 §四 |
| 29 | 方案存/分支/横比（CapacityScenarioPanel） | 存/分支/横比/采纳 | 需先有活推演态，否则诚实提示 | 拖杆后存 | 是 | A | `/a/v1/live-scenarios` | ✅ | 采纳走 `plan_change` Action 草稿（C5 门不绕） |
| 30 | 对症方案比对矩阵（MitigationCards） | 观察/采纳 | 5 列比对 + 逐方案推演链 | 换基地/换因子 | 是 | A | `mitigation_select{baseName,factor,tightness}` | ✅ | 「预期堵口 = 峰值 − 见效pp」链条可追 |
| 31 | 对话态 QA 预设快答 | 逐个点 4 个预设 + 自由输入 | 答案随卡真值变 | 换基地 | 是 | A | 派生自本卡 `affectedOrders/crossDay/peak` | ✅ | 已诚实标「预设快答·非智能问答」 |
| 32 | 人机对话（CapacityLiveDialog） | 提问 | 经 agentcore orchestrator | 停 agentcore | — | A/D | — | — | agentcore 停机时该块 `ERR_CONNECTION_REFUSED`，界面无显式错误码 → 见 §四 |
| 33 | 处置计划表 · 行数/字段 | 观察 | 17 行 · 带单位「套」「T+N·MM-DD」 | 换窗口 | 是 | A | `planRows` 逐字对上 | ✅ | — |
| 34 | 处置计划表 · 逐行点开 | 逐行点 | DispositionDetailPanel 逐 step + 守恒校验行 | 有缺口 vs 无缺口基地 | 是（无缺口行诚实标「窗内无产能缺口」） | A | `steps[]` + `Σclosesgap+residual==shortfall` | ✅ | — |
| 35 | 处置表「⚙ 生成/重算行动计划」 | 拖满 5 根杠杆后点 | **表格一个字没变，也不解释为什么** | 后端直调 `risk_timeline{apply:[...]}` 对拍 | 否 | **D（静默无操作）** | 修 F8 前：overlay 落在常州 → 8 张卡全无感；修 F8 后 overlay 真落本基地（capRatio 0.9895），但**信阳窗内 shortfall=0 ⇒ 行动项本就该不变**，而界面不说 | 修 F8 后对得上 | **F10 已修**：契约里一直有的 `planRows[].overlay{count,capRatio}` **前端从来没渲染过** → 现渲染引擎回执「杠杆落在 hefei ×0.980、xinyang ×0.990；其中 1 个基地窗内有缺口→行动项已重算，1 个窗内无缺口→行动项理应不变」。**液性反证**：`risk_timeline{apply: hefei 良率 0.5×2}` → hefei shortfall 1385 → **1500.2**（真变） |
| 36 | 处置表「⬇ 导出最终规划」 | 点 | 下载独立 HTML | 改 planRows | 是 | A | 前端生成，字段同页表 | ✅ | — |
| 37 | 订单聚合 · 基地筛选下拉 | 选/清除 | 明细真裁剪 | 选「合肥」 | 是 | A | `affected_orders{base}` 后端真裁剪 | ✅ | — |
| 38 | 历史处置案例区 | 观察 | **整块不出现** | — | — | **D（静默消失）** | `GET /a/v1/history/bundle?pageSize=1` → **404**（内存态无该路由） | — | `cases.length===0 → return null`：后端 404 与「本来就没有案例」被渲成同一种"什么都没有"。见 §四（未修·超出本页求解器范围） |
| 39 | 风险推演编排过程 DAG | 观察 | 渲染 | — | — | A | — | ✅ | — |
| 40 | 空态/错误态：断开 datacore | 停 4001 后刷新 | 顶层「加载中」长挂 | 停服务 | — | **D** | — | — | 见 §四（未修·属全局 QueryClient 错误边界，非本页局部） |
| 41 | 空态：选无 Line/Process 数据的基地 | 点江门/邯郸/自贡 | 杠杆区 5 根（修 F8 前是常州的） | — | 是 | A（修后） | 修后作用域内无可写对象 → 诚实空 | ✅ | `③b` 测试守：作用域给了但无交集 → **诚实空**，绝不回落全域 |
| 42 | **推演窗口 chip 30/60/90 × 「订单聚合」表**（R7 轮新查） | 切到订单聚合 tab 后逐个点 30/60/90 | **表格行数恒 24（DOM `<tr>` 恒 28），三档逐字节相同**；而同一屏顶部 KPI「受影响订单」30天=8 / 60天=22 → **一屏两个打架的数** | ① 浏览器逐档读 DOM 行数 ② `curl affected_orders{horizon:30\|60\|90\|180}` 取 rows.so 列表算 md5 | **否**（md5 四档全等 `5390c03a84311685ab742214f167e53c`） | **C（窗口写死）** | 修前四档 `rows=24` 恒定；修后 30天=10 / 60天=24 / 90天=24 | ❌→✅ | **⑬ 已修**（F11）：`affectedOrdersAggregate` 里 `affectedOrders(c,{baseId, toDay:180})` **把 `horizon` 整个丢掉**（R-ARG-FIDELITY）。改为 **显式 fromDay/toDay > horizon > 历史默认 180** 的优先级；不传窗口的调用方（order-chain 视图/驾驶舱/`planviews.test.ts`）逐字节不变。浏览器复验：`✅ 30/60/90 chip 真改聚合表行数：13/28/28` |
| 43 | 订单聚合表 vs 顶部 KPI 覆盖面（R7 轮新查） | 同屏对读 | 修 #42 后 30 天：KPI=8 批 / 聚合表=10 单 | 逐基地 `affected_orders{baseId,fromDay:0,toDay:30}` 求和 | — | **口径差（非缺陷·须交底）** | KPI = 看板**展示的 8 张卡**并集；聚合表 = **全部基地**（demo 有 13+ 基地，maxCards=8） | ✅ 数学上一致 | **已加屏上交底** `risk-order-agg-caliber`：「口径：未来 N 天内交期 · 覆盖全部基地（顶部 KPI 只统计上方展示的风险卡，覆盖面更窄，数值可能略少）」 |
| 45 | 订单聚合 · **基地筛选下拉**（R8 轮新查·组合操作才炸） | 选「合肥」后**再去选「金华」** | **选不了**——下拉当场只剩「全部风险基地(1) / 合肥」，必须先点 ✕清除；且那个 (1) 是**假总数**（真值 13） | ① 浏览器读 `<option>` 全集 ② `curl affected_orders{horizon:90,base:X}` 逐基地取单号 | 修前：换基地屏幕**不动**（三个基地都停在合肥的 4 行）；修后真换 | **C（选项集用"已过滤响应"冒充全域）** | 合肥 4 单 `SO-3391/3481/3523/3534` · 金华 7 单 · 武汉 4 单 · 厦门 3 单 | ✅ 修后浏览器与 curl 逐单号全等 | **⑭ 已修**（F12）：选项集只在 `__all__` 未过滤响应回来时刷新并记住；经营表按基地聚合仍用本次响应的 `bases`（不许凭空多空行）。**注意**：R1–R7 轮都"点过"这个下拉但只点了一次就换别的控件，**没连着点第二个基地**，所以 7 轮没抓到 |
| 44 | **取证链路本身**（R7 轮·方法论） | 起浏览器取证 | 屏幕 8/8 卡全 `瓶颈工序`（= R1 未修形态），与我 `curl :4051` 的结果完全对不上 | `/proc/<pid>/cwd` 查端口归属 + Playwright 打印路由改写命中数 | — | **取证污染（不是产品缺陷）** | :4001 归 `worktree/agent-aa8750b3c6505d86b`（另一条 WO 的后台 dev），前端 `env.ts` 在 localhost 下**写死直连 4001·不走 vite proxy** | ❌ 差点把别人的构建当自己的证据 | 已改用 :4051 + Playwright `page.route` 改写并打印命中次数（15 次）。见文首「取证隔离」框 |

## 二、A/B/C/D 分类汇总

| 类 | 计数 | 明细 |
|---|---|---|
| **A 真算** | 24 | #1,2,5,6,7,10,12,13,14,18,19,20,22,23,24,26,29,30,31,33,34,36,37,39（+#3 特例：本数据下恒定，理由可核查）；#43 为**口径差**（已屏上交底）·#44 为取证方法论条目，二者均不计入 A/B/C/D |
| **B mock** | 0 | 本页全程接真 datacore；未发现 mock 冒充真值 |
| **C 写死/没接上** | 10 | #4 主因子(R1) · #8 受影响订单窗口(R7) · #9 逐日点平色(R2) · #11 逐日弹窗恒空 · #16 因子作用域丢参(R3) · #21 baseId 形态 404(R4) · #25 杠杆丢基地作用域 · #27 量纲错标(R8) · **#42 订单聚合窗口写死 180（R7 轮新查）** · **#45 基地筛选下拉自锁死（R8 轮新查）**（前几版此格写「7 / 8」与所列条目对不上，本轮据实重数订正为 10） |
| **D 静默降级** | 6 | #9 封顶不披露 · #16 伪造病因 · #17 loading 渲成失败 · #35 重算无回执 · #38 历史案例 404 静默消失 · #40 断服务无错误码 |

> 注：下表的修法条目 **C1–C11 共 12 条**（含 C2b）多于 C 类控件行数 10，因为 #4 一行同时含 C1/C2/C2b 三处病灶（主因素被排除 / 卡内去重序 / 看板排序）。计数口径：**控件行**按行数，**修法**按病灶数。

**C/D 逐条 file:line + 修法**（✅=本单已修）

| 编号 | file:line（修前） | 病因 | 修法 |
|---|---|---|---|
| C1 ✅ | `apps/datacore/src/solvers/risk.ts:329` `if (f === primary) continue;` | 本基地主瓶颈被无条件排除出候选 | 改为 `if (f !== primary && mockTightness(...) >= threshold) continue;`（主因素恒为候选） |
| C2 ✅ | `apps/datacore/src/solvers/risk.ts:418` `if (!existing \|\| num(card.peak) > num(existing.peak))` | peak 被 `cap=98` 封顶打平 → `>` 恒 false → tie-break 退化为 `bottleneck.factors` 数组序 | 抽出纯函数 `preferRiskCard`（导出可直接测）：**当前张力↓ 主序 → peak↓ tie-break → 越线日↑ → 因素名**（R6 全序）。⚠ **复审裁定修正**：我第一版写成 *peak 主序 / 当前张力 tie-break*，那是**靠 `cap=98` 硬截断的巧合**才等效于"按当前张力排"——上游换保序饱和 `saturateTension`（峰值 97.9508/97.9248/97.8399 互不相同）后平顶消失、主序翻面即穿帮。现按产品语义写实并加纯函数牙测 ①c（见 §三 R1） |
| C2b ✅ | `apps/datacore/src/solvers/risk.ts:447` `ca - cb \|\| (str(a.base) < str(b.base) ? -1 : 1)` | 越线日全同 → 卡片排序退化为基地名字典序 → 最严重的江门(96) 被 `slice(maxCards)` 挤出 | 加 实测当前张力↓ → 峰值↓ 两级 tie-break |
| C3 ✅ | `apps/datacore/src/solvers/risk.ts:391` `day: crossDay ?? horizon` | 受影响订单窗 `[crossDay−7, crossDay+14]` 与页面/聚合 tab 的 `[0,horizon]` 打架 | 改 `fromDay:0, toDay:horizon` |
| C4 ✅ | `apps/frontend-shell/src/components/Risk/RiskPopover.tsx:20-21`（红/黄档平色常量）被 `RiskBoardView` 逐日点消费 | 档内无深浅 → 30 点一色 | 本页新增 `tensionDotColor`（档内 alpha 斜坡·不动共享 `heatColor`，OrderChain 零回归） |
| C5 ✅ | `apps/datacore/src/solvers/service.ts:1394-1398` `res.scope = { factorId: scopedFactorId }` | ① baseId 被丢弃 ② 任何字符串都当合法因子入口 → 未知因子静默退化成单节点 | factorId 须命中真 `CausalFactor`；否则保住 base 树 + `factorApplied:false` + `factorNote` |
| C6 ✅ | `apps/datacore/src/solvers/service.ts:2615` `bases.find(b => b.baseId===baseArg \|\| b.name===baseArg)` | 不认真实对象 id `obj_base_<id>` → 硬 404 | 经 `normalizeBaseRef` 归一（与兄弟求解器 `risk.ts resolveBaseId` 同一出处） |
| C7 ✅ | `apps/datacore/src/solvers/service.ts:794-829` `discoverCapacityLevers` | `scopeObjectIds` 整个未读；候选按 `id.localeCompare` 排序 `slice(PROBE_CAP=50)` 恒截到常州 | 解析 scope→baseId 集合，**先过滤再探针**；`computeByProcessModel(..., baseFilter)` 同尺度；scope 给了但无交集 → 诚实空 |
| C8 ✅ | `apps/frontend-shell/src/locales/zh.ts:429` `leverBefore: "调整前可用产能"` | 传入值是 `card.peak`（0–100 张力指数），标成产能 | 文案改「调整前峰值张力（0–100）」 |
| C9 ✅ | `apps/frontend-shell/src/views/RiskBoardView.tsx:230` `objectId: \`base-${card.base}\`` · `:783` `scopeObjectIds={[\`base-${baseIdForScope}\`]}` | 写入 mock 形态 id，后端 `normalizeBaseRef` 不认 | 新增单一出处 `baseObjectId(card)` → `obj_base_<baseId>` |
| C10 ✅ | `apps/datacore/src/solvers/risk.ts:913` `affectedOrders(c, { baseId, toDay: 180 })` + `service.ts:3933` 类型断言只留 `{base,horizon}` | 订单聚合窗口**写死 180 天**，`horizon` 只用于 risks[] 时序、对行集完全无效 → 30/60/90 chip 是死的（四档 md5 全等）；且与同屏 KPI 的 `[0,horizon]` 口径打架 | 窗口优先级改为 **显式 `fromDay`/`toDay` > `horizon` > 历史默认 180**，`service.ts` 透传窗口参；不传窗口的调用方零回归 |
| C11 ✅ | `apps/frontend-shell/src/views/RiskBoardView.tsx:515,635-636`（`bases` 由**本次已过滤响应**派生，同时喂经营表与下拉） | 选中一个基地 → 下拉塌成只剩它，无法直接改选；「全部风险基地（N）」显示过滤后的 N（假总数） | 拆成两个来源：`bases`（本次响应·喂经营表）与 `selectBases`（记住的**全域**集合·喂下拉），只在 `__all__` 响应回来时刷新 |
| D1 ✅ | `apps/frontend-shell/src/views/RiskBoardView.tsx:870` | loading 与失败共用「暂不可用」标题 | loading 单独分支渲「加载中…」 |
| D2 ✅ | `apps/frontend-shell/src/views/RiskBoardView.tsx:875,877` | 内联**已过期**的因果推断（G-GAP-SCOPE 早闭） | 只陈述可观测事实（调用失败／无返回／返回里没有本基地节点 + 本次作用域） |
| D3 ✅ | `apps/frontend-shell/src/views/RiskBoardView.tsx`（`planRows[].overlay` 从未渲染） | 拖杆→重算→屏幕零变化零解释 | 新增 `OverlayEffectNote` 渲染引擎回执 |
| D4 ✅ | 逐日点/行标无封顶披露 | 三因子终点同为 98 看着像写死 | `plateauNote()` 据实标「末段贴顶 张力98/100 连续 N 天（张力量表上界·非逐日恶化）」 |
| D5 ❌ 未修 | `RiskBoardView.tsx HistoricalCasesSection` `if (cases.length === 0) return null` | `/a/v1/history/bundle` 404 与「真没有案例」渲成同一种消失 | 建议：区分 `isError` → 诚实灰 + HTTP 状态码。**超出本单范围**（该 section 不属产能推演求解器链），登记为残口 |
| D6 ❌ 未修 | 全局 QueryClient 无错误边界 | 断 datacore → 顶层「加载中」长挂，无错误码 | 属全局壳层，非本页局部；登记为残口 |

## 三、R1–R8 逐条结论

| 红咬 | 复现到了吗 | 定性 | 修了没 | 测试名 |
|---|---|---|---|---|
| **R1** 所有基地瓶颈都一样 | ✅ **完全复现**（浏览器 8/8 卡全是 `瓶颈工序`） | **C**。`primaryFactor()` 确实吃 baseId（13 基地 13 个不同 primary），但 `riskTimeline` 把它**排除**出候选；剩下的 `瓶颈工序`（利用率派生·各基地都 90–91）恒为非主因素最大值；且 peak 被 `cap=98` 打平后 tie-break 退化为数组序 | ✅ 修（C1+C2+C2b）。**排序语义（复审裁定后）= 当前张力主序 / peak 仅 tie-break**，写在纯函数 `preferRiskCard` 里，**不依赖 peak 是否被截断打平**。修后 4 种不同主因子，且**卡面因子 == 该基地 LIVE 当前张力最高因子**。残留 4 张仍为 `瓶颈工序` 有**可核查理由**：这 4 个基地的 `瓶颈工序` 确为其 LIVE 当前张力最高项（91 > 设备OEE 84/85），已写进测试注释 | ①（端到端）/ ①b（看板序）/ **①c（纯函数排序契约·不吃种子数据）** |
| **R2** 30 点一色 · 三因子终点同为 98 | ✅ **完全复现**（红档色数=1；91→98 / 92→98 / 84→98） | 双病因：① `tensionSeries` `Math.min(p.cap=98,…)` 硬封顶（**有意的量表上界·非硬编码假数**，但界面从不披露 → D）② `heatColor` 红/黄档是平色常量 → 档内无深浅（C）。**"所谓时序其实是静态阈值分桶"不成立**：series 逐日真变（91,91,92,…），是渲染把它抹平了 | ✅ 修（C4+D4）。修后信阳 物流时长 行色数 1→7、厦门 1→8；行标出现「末段贴顶 … 连续 N 天」 | `frontend-shell/test/capacity-page-100pct.test.tsx` R2-a/R2-b/R2-c |
| **R3** 诚实灰伪造病因 | ✅ **完全复现**，且比原描述更严重：点**任何**因子 chip 都会触发它 | `:870` loading 与失败共用空态（D）；`:875/:877` 内联过期因果推断（D）；真正的触发源是 C5（引擎丢 baseId + 未知因子静默退化） | ✅ 修（C5+D1+D2） | 后端 ④；前端 R3-a/R3-b |
| **R4** `base_capacity_outlook` 硬 404 | ✅ **完全复现**（`obj_base_xinyang` → `NOT_FOUND`） | C | ✅ 修（C6），三形态逐字节一致 | 后端 ② |
| **R5** 前端写 mock 形态 id | ✅ **完全复现**（`base-信阳`；真 id 是 `obj_base_xinyang`，`/a/v1/objects?type=Base` 亲验） | C | ✅ 修（C9）。`mocks/fixtures.ts:59` 的 `id: base-${b.name}` 服务的是 GeoMap 展示态、非求解器入参，本单不动（避免超范围），已在 §四登记 | 前端 R5 |
| **R6** what-if 杠杆写死 | ✅ **复现出一个更深的变种**：杠杆名不是写死的（`discoverLevers` 真反推），但**杠杆打在的对象**恒为常州——任何基地卡返回逐字节相同的 5 根杠杆 | **C**（作用域丢参 + 字母序截断）。`G-WHATIF-HARDCODED-LEVERS` 本体侧已闭无误；`G-DISPOSITION-STATIC`／`WO-LIVE-DISPOSITION` 也**没有回潮**（后端直调 `risk_timeline{apply:hefei 良率0.5}` → hefei shortfall 1385→**1500.2** 真变）；页面上"纹丝不动"的真因是杠杆落错基地 + 无回执 | ✅ 修（C7+D3） | 后端 ③/③b；前端 ⑪ |
| **R7** 受影响订单恒空 | ✅ **完全复现**（8 张卡 7 张 0 批；KPI 1 批 vs 聚合 tab 24 批） | C/D（窗口口径两处不一致） | ✅ 修（C3）。修后 5/8 卡有单；江门/邯郸/自贡真无单（与聚合表一致·非缺陷） | 后端 ⑫ |
| **⑬⑭（R7/R8 轮新增·非原 8 条红咬）** | ✅ 亲手复现（窗口 chip 对聚合表无效 / 下拉自锁死） | 均为 **C**（丢参 · 选项集来源错） | ✅ 已修，均带变异反证（B6 后端 / B8 前端） | datacore `⑬` · frontend `⑬`/`⑭` |
| **R8** 裸数字 | ✅ 复现（「调整前可用产能 98.0」量纲错到底；方案矩阵「产能增益」无单位） | C（错标）+ 残口（无单位） | ✅ 修错标（C8）。「产能增益」列**后端/契约无 unit 字段可消费** → 按 WO 规则登记残口，不就近臆造单位 | — |

## 四、诚实边界（未覆盖 / 未修 · 及原因）

1. **#15 根因树设备叶下钻落基地键而非真设备号** —— `gap_attribution` 结构分摊本就按基地聚合 OEE 缺口（`drillId=xinyang`）。修它要动归因颗粒度，波及 CEO 驾驶舱等多个消费方，超出本页范围。
2. **#28 方案矩阵「产能增益」无单位** —— 后端 `capGain` 与契约均无 `unit` 字段可消费；按 WO「先查后端/契约有没有 unit 可消费·有就消费·没有才就近标注」的次序，本单**不臆造单位**，登记残口。
3. **#38 历史处置案例 404 静默消失 / #40 断 datacore 无错误码** —— 前者属 `history/bundle` 路由（非本页求解器链），后者属全局 QueryClient 错误边界；两者都不在 🚦 范围内。
4. **`mocks/fixtures.ts:59` `id: base-${b.name}`** —— 该 id 只服务 GeoMap 展示态与前端 fixture 自洽，不作为求解器入参；改它会波及 GeoMap/其它视图测试，超出本单范围。
5. **`params.risk.cap = 98` 本身未改** —— 本单只做**披露**（`plateauNote`）不改口径，判断"改 cap 属产品决策"。**复审已在正线用保序饱和 `saturateTension` 消除了平顶**（本 worktree 基线 `8511b017` 尚无此改动）。两者关系：`plateauNote` 是**自失效**的诚实标注——平顶消失后它自然返回空串、不再显示，无需回改；但台账 §三 R2 里"行标出现末段贴顶"这条**修后证据是在平顶未消除的基线上取的**，并线后该文案预期不再出现，这不是回归。
6. **agentcore 侧（CapacityLiveDialog 真 NL）未做变异审计** —— 🚦 范围明确禁止碰 B 系统；仅记录其停机时的表现。
7. **pg 模式未验证** —— 全程内存态（`SEED_DEMO=1`）；本单改动不涉及仓储层，无新表。
8. **不传窗口参的 `affected_orders` 调用方仍是 180 天默认** —— order-chain 视图 / CEO 驾驶舱 / `planviews.test.ts` 都不传窗口，本单**刻意保持其逐字节不变**（只让显式传 `horizon` 的产能推演页收窄），避免顺手改坏 🚦 范围外的视图。那个 180 是否是那些视图想要的口径，**本单不下结论**，登记残口。
9. **本机并行三条 WO·`scripts/gate.sh` 的 datacore 段两次被 `SIGTERM`（RC=143）打断** —— 两次都是 **vitest 刚 `RUN v3.2.6` 就被杀、一条断言都没跑**（同一次 gate 里 agentcore 728/729 全绿、BUILD/三道静态门全 RC=0），`dmesg` 无 OOM 记录，故**不是我的断言失败、也不是 OOM**，判为**外部进程清理**（另外两条 WO 的 dev 在各自 worktree 也跑 `vitest`，其清理动作会波及同名进程）。处理：**不粉饰、不当成绿**，改为单独重跑 datacore 套件并显式捕获退出码（见交付报告的逐包点名）。审核方若在独占机器上复跑，`bash scripts/gate.sh` 应当一次过。
10. **我自己写的 R3-a 测试曾是"时序脆弱"的（已修·据实交底）** —— 它用 `delay(3000)` 造 loading 观察窗，**单跑该文件恒绿、整包跑偶红**：`test/setup.ts` 的 `asyncUtilTimeout` 已是 15s，所以问题不在轮询超时，而在**观察窗只有 3s**——整包 + 本机三条 WO 并跑（load avg > 20）时"点卡→面板挂载"可能超过 3s，断言去看时响应早已返回、loading 元素已消失 → **假红**。已把观察窗改成 60s（`testTimeout=20s < 60s`，该 timer 在测试内永不触发）。教训：**"单文件绿、整包红"几乎总是我自己的测试时序脆弱，不是被测代码的问题**——但也绝不能因此就把它当噪声忽略，必须找到机理再改。
11. **`packages/contracts` 未改**（按 WO 要求）—— 因此 R2 的「封顶披露」放在前端由 `series` 自行推导（后端加 `tensionCap` 字段会被 `z.object` 非 strict 解析静默丢弃，等于无效），已在代码注释说明。

## 五、LOOP 轮次

| 轮 | 操作了哪些控件 | 新增发现 |
|---|---|---|
| **R1（首轮）** | 登录 → /v/risk → 8 张卡逐张 DOM 取证 + KPI + curl 对拍 `risk_timeline`/`bottleneck_matrix`/`base_capacity_outlook`/`gap_attribution`/`generic_inference` | **9 条**（R1 主因子 / R2 一色+98 / R3 loading+伪造病因 / R4 404 / R5 mock id / R6 杠杆丢作用域 / R7 订单恒空 / R8 量纲错标 / 首要风险徽章 7 连挂） |
| **R2** | 逐日点阵逐行取色、因子 chip 逐个点（7 个）、杠杆逐根拖（5 根）、重算按钮、处置表 | **2 条**（因子 chip 点了树就消失·比原 R3 描述更严重；重算后零变化零解释=静默降级） |
| **R3（修后复验 + 穷举）** | 窗口 chip 30/60/90、订单聚合 tab（两个维度）、基地筛选、**8 张卡逐张展开**取前瞻/根因/杠杆、逐日点色数 | **1 条**（#8/#11 受影响订单窗口口径与聚合 tab 打架 → R7 真因） |
| **R4** | 同 R3 全量重跑（C3 修后）：窗口 chip×3、订单聚合两维度、8 张卡逐张展开、逐日点色数、根因节点数、滑杆数 | **0 条新缺陷**；1 条**台账更正**——#3 窗口 chip 修 C3 后**真联动**（30天 8 单/4 客户 → 60/90天 22 单/8 客户），首轮判的"恒定"是 C3 的下游症状而非独立问题 |
| **R5** | 同 R4 全量重跑 + 因子 chip×7 + 杠杆×5 拖动 + 重算 + 处置表逐行 | **0 条** |
| **R6（复审裁定驱动·非我自查发现）** | 复核 ④b tie-break 语义 vs 注释/测试描述是否一致 | **1 条（我自己的假绿）**：④b 写成 peak 主序、只因 `cap=98` 把 peak 全打平才等效"按当前张力排"；注释与 ① 描述的是后者 → **靠巧合对齐**。上游 `saturateTension` 消除平顶后主序翻面即穿帮。已按**当前张力主序 / peak tie-break** 写实 + 加纯函数牙测 ①c |
| **R7（复审裁定后首轮·全量重跑）** | 重建取证链路（自建 datacore :4051 + Playwright 路由改写）→ 8 张卡逐张 + 首要风险徽章 + KPI 5 值 + **订单聚合 tab × 窗口 chip 30/60/90** + curl 四档 md5 对拍 | **2 条**：① **#42 订单聚合窗口写死 180**（C 类·chip 是死的 + 同屏 KPI 打架）② **#44 取证污染**（:4001 是别人 worktree 的 dev，前端 localhost 下写死直连 4001 不走 proxy）。另 1 条口径差 #43（已屏上交底，非缺陷） |
| **R8（组合操作专轮）** | 组合 A：订单聚合 × 窗口(3) × 分类维度(2) × 基地筛选(4 个基地)；组合 B：瓶颈视角 × 窗口(2) × 展开卡 × 因子 chip(3)；组合 C：**90 天档**下展开合肥 × 拖杠杆 × 重算 | **1 条**：**#45 基地筛选下拉自锁死**（选了合肥就没法直接改选金华；「全部风险基地(1)」是假总数）。另**排除**两个疑似：① 处置表 30/90 都是 17 行 → curl 对拍 `planRows` md5 **不同**（c590a9ab vs 3293c2c6），行数相同是"每基地×动作"结构使然，非写死；② 拖杆后 overlay 落在 8 个基地 → 因为拖的是 `Material:obj_material_pos_lfp.leadTime` 这个**跨基地共享物料**，回执如实列出 8 个基地与各自 ×1.141，属**正确且已披露**，非作用域泄漏 |
| **R9（全量复验）** | 8 张卡逐张展开（点阵色数/根因节点/滑杆/处置行）+ KPI 5 值 + 首要风险徽标 + 基地筛选逐基地单号对拍 + 滑杆根数与后端响应对拍 | **0 条**。滑杆"屏 5 根 vs curl 6 根"经**抓浏览器真实请求体**排除：前端传了 `factors` 收窄，后端对该请求就返回 5 根，屏幕 5 根**逐个 objectId 全对**（且全属 hefei，仅共享物料例外） |
| **R10（补盲区轮·零新增）** | R9 没碰的：逐日点下钻弹窗（带 icon 的 D+22/D+23 与不带 icon 的 D+3）· **9 个因子 chip 全量逐个点**（含「全部因子」）· 历史案例区 · 导出按钮 · 溯源 DAG | **0 条**。D+22→`SO-3402 长安汽车 4680-NCM 14518套 2026-07-02`、D+23→`SO-3512`，与 `affected_orders{baseId:常州,fromDay:0,toDay:30}` 直调的 dueDay 22/23 **逐单号对上**；D+3 诚实说「该基地在 D+3 的产能传导窗口内 无在产订单 关联」；9 个 chip 全部保住 22 节点（无一塌树）；历史案例区仍 0（**已登记残口 D5**·非新增）；导出/DAG 各 1 |

**连续 2 轮零新增缺陷（R4/R5）→ LOOP 退出条件曾达成；R6 由复审裁定打回一条我自己的假绿；R7 我自己又查出 1 条真 C 类（#42）；R8 又查出 1 条（#45）。**
**R9 零新增 + R10 零新增 → 「连续 2 轮零新增」退出条件重新达成。**
（R7 的 #42 说明前 5 轮**没把"订单聚合 tab × 窗口 chip"这对组合真拖过**；R8 的 #45 说明前 7 轮点下拉都**只点了一次就走**——两条都是"逐个点一遍"漏掉的**组合态**缺陷。教训写死在方法里：**控件要两两组合着连续操作，且同一个控件要连着换值两次**，不是每个点一下就算穷举。R8 还额外证明"看起来可疑的不一定是缺陷"——两个疑似都靠对拍排除，没有凑数报红。）
（R4 的那 1 条是对已有台账行的更正，不是新缺陷；R6 的这条是**真缺陷**，且是我 LOOP 自查**没抓到**的——诚实记账：我的 5 轮自查全程跑在"平顶未消除"的旧基线上，端到端断言在该基线下对 peak/当前张力两种主序**都绿**，故自查看不见；只有对排序契约本身下断言才抓得住。已补 ①c 堵此类。）

## 六、本体回写

本单**未新增/改变**对象类型、链路、事件、不变量或门禁，故不新增本体章节；已闭断点的**残口**修正在 §8 对应条目下追记（见 commit 同批 `docs/SYSTEM-ONTOLOGY.md`）：
- `G-CAPACITY-BASE-OUTLOOK`：追记 baseId 归一残口（不认 `obj_base_<id>`）已补闭。
- `G-GAP-SCOPE`：追记 `scope.factorId` 分支丢 `baseId` + 未知因子静默退化 的残口已补闭。
- `G-WHATIF-HARDCODED-LEVERS`：追记 `discoverCapacityLevers` 丢 `scopeObjectIds` 的接缝残口（R-ARG-FIDELITY）已补闭。
