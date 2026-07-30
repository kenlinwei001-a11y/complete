# 「产能推演」页 100% 功能实证台账（WO-CAPACITY-PAGE-100PCT · LOOP）

> 方法：**在真浏览器里把每个可点/可切/可展开的控件当人一样操作一遍**（Playwright + 预装 Chromium `/opt/pw-browsers/chromium-1194`
> 驱动 vite:5199 → 真 datacore:4001 / agentcore:4002 内存态），对屏幕上每个数字做**变异**（改上游/换基地/换作用域/拖杠杆/后端直调对拍）
> 再判 **A 真算 / B mock / C 写死或没接上 / D 静默降级**。只读代码得出的结论一律不算数。
>
> 双侧对拍：① 浏览器记屏幕值 ② 同一组入参 `curl -X POST /a/v1/solvers/<key>/invoke` 直调求解器 ③ 比对。
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

## 二、A/B/C/D 分类汇总

| 类 | 计数 | 明细 |
|---|---|---|
| **A 真算** | 24 | #1,2,5,6,7,10,12,13,14,18,19,20,22,23,24,26,29,30,31,33,34,36,37,39（+#3 特例：本数据下恒定，理由可核查） |
| **B mock** | 0 | 本页全程接真 datacore；未发现 mock 冒充真值 |
| **C 写死/没接上** | 7 | #4 主因子(R1) · #8 受影响订单窗口(R7) · #9 逐日点平色(R2) · #11 逐日弹窗恒空 · #16 因子作用域丢参(R3) · #21 baseId 形态 404(R4) · #25 杠杆丢基地作用域 · #27 量纲错标(R8) |
| **D 静默降级** | 6 | #9 封顶不披露 · #16 伪造病因 · #17 loading 渲成失败 · #35 重算无回执 · #38 历史案例 404 静默消失 · #40 断服务无错误码 |

**C/D 逐条 file:line + 修法**（✅=本单已修）

| 编号 | file:line（修前） | 病因 | 修法 |
|---|---|---|---|
| C1 ✅ | `apps/datacore/src/solvers/risk.ts:329` `if (f === primary) continue;` | 本基地主瓶颈被无条件排除出候选 | 改为 `if (f !== primary && mockTightness(...) >= threshold) continue;`（主因素恒为候选） |
| C2 ✅ | `apps/datacore/src/solvers/risk.ts:418` `if (!existing \|\| num(card.peak) > num(existing.peak))` | peak 被 `cap=98` 封顶打平 → `>` 恒 false → tie-break 退化为 `bottleneck.factors` 数组序 | 全序 tie-break：peak↓ → 实测当前张力↓ → 越线日↑ → 因素名 |
| C2b ✅ | `apps/datacore/src/solvers/risk.ts:447` `ca - cb \|\| (str(a.base) < str(b.base) ? -1 : 1)` | 越线日全同 → 卡片排序退化为基地名字典序 → 最严重的江门(96) 被 `slice(maxCards)` 挤出 | 加 实测当前张力↓ → 峰值↓ 两级 tie-break |
| C3 ✅ | `apps/datacore/src/solvers/risk.ts:391` `day: crossDay ?? horizon` | 受影响订单窗 `[crossDay−7, crossDay+14]` 与页面/聚合 tab 的 `[0,horizon]` 打架 | 改 `fromDay:0, toDay:horizon` |
| C4 ✅ | `apps/frontend-shell/src/components/Risk/RiskPopover.tsx:20-21`（红/黄档平色常量）被 `RiskBoardView` 逐日点消费 | 档内无深浅 → 30 点一色 | 本页新增 `tensionDotColor`（档内 alpha 斜坡·不动共享 `heatColor`，OrderChain 零回归） |
| C5 ✅ | `apps/datacore/src/solvers/service.ts:1394-1398` `res.scope = { factorId: scopedFactorId }` | ① baseId 被丢弃 ② 任何字符串都当合法因子入口 → 未知因子静默退化成单节点 | factorId 须命中真 `CausalFactor`；否则保住 base 树 + `factorApplied:false` + `factorNote` |
| C6 ✅ | `apps/datacore/src/solvers/service.ts:2615` `bases.find(b => b.baseId===baseArg \|\| b.name===baseArg)` | 不认真实对象 id `obj_base_<id>` → 硬 404 | 经 `normalizeBaseRef` 归一（与兄弟求解器 `risk.ts resolveBaseId` 同一出处） |
| C7 ✅ | `apps/datacore/src/solvers/service.ts:794-829` `discoverCapacityLevers` | `scopeObjectIds` 整个未读；候选按 `id.localeCompare` 排序 `slice(PROBE_CAP=50)` 恒截到常州 | 解析 scope→baseId 集合，**先过滤再探针**；`computeByProcessModel(..., baseFilter)` 同尺度；scope 给了但无交集 → 诚实空 |
| C8 ✅ | `apps/frontend-shell/src/locales/zh.ts:429` `leverBefore: "调整前可用产能"` | 传入值是 `card.peak`（0–100 张力指数），标成产能 | 文案改「调整前峰值张力（0–100）」 |
| C9 ✅ | `apps/frontend-shell/src/views/RiskBoardView.tsx:230` `objectId: \`base-${card.base}\`` · `:783` `scopeObjectIds={[\`base-${baseIdForScope}\`]}` | 写入 mock 形态 id，后端 `normalizeBaseRef` 不认 | 新增单一出处 `baseObjectId(card)` → `obj_base_<baseId>` |
| D1 ✅ | `apps/frontend-shell/src/views/RiskBoardView.tsx:870` | loading 与失败共用「暂不可用」标题 | loading 单独分支渲「加载中…」 |
| D2 ✅ | `apps/frontend-shell/src/views/RiskBoardView.tsx:875,877` | 内联**已过期**的因果推断（G-GAP-SCOPE 早闭） | 只陈述可观测事实（调用失败／无返回／返回里没有本基地节点 + 本次作用域） |
| D3 ✅ | `apps/frontend-shell/src/views/RiskBoardView.tsx`（`planRows[].overlay` 从未渲染） | 拖杆→重算→屏幕零变化零解释 | 新增 `OverlayEffectNote` 渲染引擎回执 |
| D4 ✅ | 逐日点/行标无封顶披露 | 三因子终点同为 98 看着像写死 | `plateauNote()` 据实标「末段贴顶 张力98/100 连续 N 天（张力量表上界·非逐日恶化）」 |
| D5 ❌ 未修 | `RiskBoardView.tsx HistoricalCasesSection` `if (cases.length === 0) return null` | `/a/v1/history/bundle` 404 与「真没有案例」渲成同一种消失 | 建议：区分 `isError` → 诚实灰 + HTTP 状态码。**超出本单范围**（该 section 不属产能推演求解器链），登记为残口 |
| D6 ❌ 未修 | 全局 QueryClient 无错误边界 | 断 datacore → 顶层「加载中」长挂，无错误码 | 属全局壳层，非本页局部；登记为残口 |

## 三、R1–R8 逐条结论

| 红咬 | 复现到了吗 | 定性 | 修了没 | 测试名 |
|---|---|---|---|---|
| **R1** 所有基地瓶颈都一样 | ✅ **完全复现**（浏览器 8/8 卡全是 `瓶颈工序`） | **C**。`primaryFactor()` 确实吃 baseId（13 基地 13 个不同 primary），但 `riskTimeline` 把它**排除**出候选；剩下的 `瓶颈工序`（利用率派生·各基地都 90–91）恒为非主因素最大值；且 peak 被 `cap=98` 打平后 tie-break 退化为数组序 | ✅ 修（C1+C2+C2b）。修后 4 种不同主因子，且**卡面因子 == 该基地 LIVE 张力最高因子**（可核查）。残留 4 张仍为 `瓶颈工序` 有**可核查理由**：这 4 个基地的 `瓶颈工序` 确为其 LIVE 张力最高项（91 > 设备OEE 84/85），已写进测试注释 | `datacore/test/capacity-page-100pct.test.ts` ①/①b |
| **R2** 30 点一色 · 三因子终点同为 98 | ✅ **完全复现**（红档色数=1；91→98 / 92→98 / 84→98） | 双病因：① `tensionSeries` `Math.min(p.cap=98,…)` 硬封顶（**有意的量表上界·非硬编码假数**，但界面从不披露 → D）② `heatColor` 红/黄档是平色常量 → 档内无深浅（C）。**"所谓时序其实是静态阈值分桶"不成立**：series 逐日真变（91,91,92,…），是渲染把它抹平了 | ✅ 修（C4+D4）。修后信阳 物流时长 行色数 1→7、厦门 1→8；行标出现「末段贴顶 … 连续 N 天」 | `frontend-shell/test/capacity-page-100pct.test.tsx` R2-a/R2-b/R2-c |
| **R3** 诚实灰伪造病因 | ✅ **完全复现**，且比原描述更严重：点**任何**因子 chip 都会触发它 | `:870` loading 与失败共用空态（D）；`:875/:877` 内联过期因果推断（D）；真正的触发源是 C5（引擎丢 baseId + 未知因子静默退化） | ✅ 修（C5+D1+D2） | 后端 ④；前端 R3-a/R3-b |
| **R4** `base_capacity_outlook` 硬 404 | ✅ **完全复现**（`obj_base_xinyang` → `NOT_FOUND`） | C | ✅ 修（C6），三形态逐字节一致 | 后端 ② |
| **R5** 前端写 mock 形态 id | ✅ **完全复现**（`base-信阳`；真 id 是 `obj_base_xinyang`，`/a/v1/objects?type=Base` 亲验） | C | ✅ 修（C9）。`mocks/fixtures.ts:59` 的 `id: base-${b.name}` 服务的是 GeoMap 展示态、非求解器入参，本单不动（避免超范围），已在 §四登记 | 前端 R5 |
| **R6** what-if 杠杆写死 | ✅ **复现出一个更深的变种**：杠杆名不是写死的（`discoverLevers` 真反推），但**杠杆打在的对象**恒为常州——任何基地卡返回逐字节相同的 5 根杠杆 | **C**（作用域丢参 + 字母序截断）。`G-WHATIF-HARDCODED-LEVERS` 本体侧已闭无误；`G-DISPOSITION-STATIC`／`WO-LIVE-DISPOSITION` 也**没有回潮**（后端直调 `risk_timeline{apply:hefei 良率0.5}` → hefei shortfall 1385→**1500.2** 真变）；页面上"纹丝不动"的真因是杠杆落错基地 + 无回执 | ✅ 修（C7+D3） | 后端 ③/③b；前端 ⑪ |
| **R7** 受影响订单恒空 | ✅ **完全复现**（8 张卡 7 张 0 批；KPI 1 批 vs 聚合 tab 24 批） | C/D（窗口口径两处不一致） | ✅ 修（C3）。修后 5/8 卡有单；江门/邯郸/自贡真无单（与聚合表一致·非缺陷） | 后端 ⑫ |
| **R8** 裸数字 | ✅ 复现（「调整前可用产能 98.0」量纲错到底；方案矩阵「产能增益」无单位） | C（错标）+ 残口（无单位） | ✅ 修错标（C8）。「产能增益」列**后端/契约无 unit 字段可消费** → 按 WO 规则登记残口，不就近臆造单位 | — |

## 四、诚实边界（未覆盖 / 未修 · 及原因）

1. **#15 根因树设备叶下钻落基地键而非真设备号** —— `gap_attribution` 结构分摊本就按基地聚合 OEE 缺口（`drillId=xinyang`）。修它要动归因颗粒度，波及 CEO 驾驶舱等多个消费方，超出本页范围。
2. **#28 方案矩阵「产能增益」无单位** —— 后端 `capGain` 与契约均无 `unit` 字段可消费；按 WO「先查后端/契约有没有 unit 可消费·有就消费·没有才就近标注」的次序，本单**不臆造单位**，登记残口。
3. **#38 历史处置案例 404 静默消失 / #40 断 datacore 无错误码** —— 前者属 `history/bundle` 路由（非本页求解器链），后者属全局 QueryClient 错误边界；两者都不在 🚦 范围内。
4. **`mocks/fixtures.ts:59` `id: base-${b.name}`** —— 该 id 只服务 GeoMap 展示态与前端 fixture 自洽，不作为求解器入参；改它会波及 GeoMap/其它视图测试，超出本单范围。
5. **`params.risk.cap = 98` 本身未改** —— 它是有意的张力量表上界（0–100 指数），不是假数据；本单只做**披露**不改口径。若要让三因素终点分开，须改 `riskTarget/cap` 口径，属产品决策，不由本单擅改。
6. **agentcore 侧（CapacityLiveDialog 真 NL）未做变异审计** —— 🚦 范围明确禁止碰 B 系统；仅记录其停机时的表现。
7. **pg 模式未验证** —— 全程内存态（`SEED_DEMO=1`）；本单改动不涉及仓储层，无新表。
8. **`packages/contracts` 未改**（按 WO 要求）—— 因此 R2 的「封顶披露」放在前端由 `series` 自行推导（后端加 `tensionCap` 字段会被 `z.object` 非 strict 解析静默丢弃，等于无效），已在代码注释说明。

## 五、LOOP 轮次

| 轮 | 操作了哪些控件 | 新增发现 |
|---|---|---|
| **R1（首轮）** | 登录 → /v/risk → 8 张卡逐张 DOM 取证 + KPI + curl 对拍 `risk_timeline`/`bottleneck_matrix`/`base_capacity_outlook`/`gap_attribution`/`generic_inference` | **9 条**（R1 主因子 / R2 一色+98 / R3 loading+伪造病因 / R4 404 / R5 mock id / R6 杠杆丢作用域 / R7 订单恒空 / R8 量纲错标 / 首要风险徽章 7 连挂） |
| **R2** | 逐日点阵逐行取色、因子 chip 逐个点（7 个）、杠杆逐根拖（5 根）、重算按钮、处置表 | **2 条**（因子 chip 点了树就消失·比原 R3 描述更严重；重算后零变化零解释=静默降级） |
| **R3（修后复验 + 穷举）** | 窗口 chip 30/60/90、订单聚合 tab（两个维度）、基地筛选、**8 张卡逐张展开**取前瞻/根因/杠杆、逐日点色数 | **1 条**（#8/#11 受影响订单窗口口径与聚合 tab 打架 → R7 真因） |
| **R4** | 同 R3 全量重跑（C3 修后）：窗口 chip×3、订单聚合两维度、8 张卡逐张展开、逐日点色数、根因节点数、滑杆数 | **0 条新缺陷**；1 条**台账更正**——#3 窗口 chip 修 C3 后**真联动**（30天 8 单/4 客户 → 60/90天 22 单/8 客户），首轮判的"恒定"是 C3 的下游症状而非独立问题 |
| **R5** | 同 R4 全量重跑 + 因子 chip×7 + 杠杆×5 拖动 + 重算 + 处置表逐行 | **0 条** |

**连续 2 轮零新增缺陷（R4/R5）→ LOOP 退出条件达成。**（R4 的那 1 条是对已有台账行的更正，不是新发现的缺陷。）

## 六、本体回写

本单**未新增/改变**对象类型、链路、事件、不变量或门禁，故不新增本体章节；已闭断点的**残口**修正在 §8 对应条目下追记（见 commit 同批 `docs/SYSTEM-ONTOLOGY.md`）：
- `G-CAPACITY-BASE-OUTLOOK`：追记 baseId 归一残口（不认 `obj_base_<id>`）已补闭。
- `G-GAP-SCOPE`：追记 `scope.factorId` 分支丢 `baseId` + 未知因子静默退化 的残口已补闭。
- `G-WHATIF-HARDCODED-LEVERS`：追记 `discoverCapacityLevers` 丢 `scopeObjectIds` 的接缝残口（R-ARG-FIDELITY）已补闭。
