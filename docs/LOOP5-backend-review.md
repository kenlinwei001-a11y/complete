# LOOP 第 5 轮 · 后端开发经理评审（可实现性：接口 / 算力 / 工期）

> **日期**：2026-08-28 · **角色**：后端开发经理 · **本轮零代码改动**，本文件是唯一新增物。
> **评审对象**：`docs/UX-mainline-screens.md`（逐屏 UX 规格）· `docs/PRD-decision-mainline.md`
> **裁决前提**：`docs/LOOP4-ceo-verdict.md` = **B 收敛**，预算 **入场券 2 周 + 下月三件事共 5 周**。
> 本文件的每条方案**优先复用现有接口**，不提议新建门/棘轮（仓主禁令 3）。
>
> **我判什么**：接口通不通、算得动算不动、要几人周。
> **我不判**：数据在不在、准不准 —— 那是数据经理的。重叠处我标「**与数据经理重叠，以他为准**」。
>
> **取证**：DataCore `127.0.0.1:4001` 内存模式 `SEED_DEMO=1`（已在跑，进程存活 1h36m，
> `dist` 构建于 08-28 03:38，即当前工作树 `wo-cust-slot-regex` 的构建）。
> 全部 curl 带 `--noproxy '*'`。下文标「**实测**」的都是本轮亲手跑的回包。
>
> **本体引用与影响**：本文件只读不改，**不新增/不改变**任何链路 / 事件 / 对象类型 / 不变量 / 门禁，
> 不触发回写 `docs/SYSTEM-ONTOLOGY.md` 的义务。触及的既有对象：`SimSession` · `TickState` ·
> `PropagationRule` · `Perturbation` · `ChainImpediment` · `SolutionCandidate` · `ActionDraft` ·
> `AnnualScenario`；既有链路：推演传导链 · 演习链 · 求解链。

---

## §0 · 先自证工具，再报三条被今天实测推翻的前提

### 0.1 金丝雀（铁律 0.6：报否定结论前先跑）

本文件要报「这个数后端没有接口」「这条路图上不通」这类**否定结论**，四类各自的金丝雀：

| 金丝雀 | 今日实测 | 撑住哪条否定结论 |
|---|---|---|
| 探针能区分「有」与「没有」 | `GET /a/v1/me/workspace` → **200**；`GET /a/v1/definitely-not-a-real-path-xyz` → **404** | 全部「没有这个接口」 |
| 求解器注册表读得到 | `GET /a/v1/solvers/registry` → `solvers.length = **61**`（与架构师 08-27 同数） | 全部求解器类结论 |
| 源码路由正则没坏 | 用同一条正则抓 `"/a/v1/me/workspace"` → **命中 1** | 「审计/登录类路由不存在」 |
| 传导图 BFS 没坏 | `priceShock` 的可达闭包**含** `costPressure` = **true**；图非空（源变量 20 · 边 42） | **「`loadIndex` 到钱之间图上没有路」** |
| 归因接口在别的指标上有输出 | `cash` → `atomicLeaves` 3 条；`ess_attain` → 21 条；`material_cov` → 64 条 | 「毛利归因回 0 条是真 0」 |
| 求解器输出可复现 | `chain_impediments` 连跑 3 次，条数/严重度序**逐位相同** | 「18 条不是抖动」 |

⇒ 下面每一条「没有 / 不通 / 算不出来」都带着上面这些命中证据，不是「我没找到」。

### 0.2 ⚠️ 三条今天实测与 UX 稿对不上的前提（照铁律 0.6 第 5 条：前提是线索不是结论）

派单要求我以 UX 稿为评审对象。我照做了，但**开工第一件事是把关键数字亲手跑一遍**。三条对不上：

| UX 稿写的（2026-08-27 实测） | 我今天实测（2026-08-28） | 处置 |
|---|---|---|
| 卡点 **17 处**，带候选 **4** 处，严重度序 `67 34 29 21* 17 12 9 8 7 7 6* 5 4 2 1* 1 0*` | **18 处**，带候选 **4** 处，序 `100 100 34 29 21* 20 17 12 9 8 7 7 6* 5 4 1* 1 0*`（连跑 3 次逐位相同） | **不是抖动，是漂移。** ⇒ §1 判定为：版面**不许写死** 17/4/13 |
| 「常州靠自己消化要 **264 天**」（缺口 55,768 套 ÷ 211.2） | `doNothing.catchUp.days = **740.31**`，`shortfall = **156354**`，`freeDaily = 211.2` | 同上。分母没变，分子变了 2.8 倍 |
| 决策窗口出处「**合肥卡**上 `物料齐套 crossDay 14`」（`LOOP3-coo-screen §2.4`） | `risk_timeline` 今天回 **8 张卡：江门 邯郸 自贡 信阳 常州 枣庄 金华 成都 —— 没有合肥**。常州的 `物料齐套 crossDay = 28` | 「还剩 13 天」这个数**今天复现不出来**。机制在（见 §3-③），数不在 |

> **这三条的共同形态**（照铁律 0.6 句式）：
> **「我用『昨天屏上那个数』当作『这个数是稳定的』的证据，而前者并不度量后者。」**
> ⇒ **凡是求解器现算出来的计数（17 处 / 7 张单 / 264 天 / 31.1 亿），
> 都不许进版面常量，只能从回包读。** 这一条我在 §6 列为头号风险。

---

## §1 · 逐屏的接口账（核心）

**判定口径**：
**✅ 现有接口直接给** = 今天调一个已存在的端点就拿得到这个数，字段名可点。
**◑ 有接口但要改** = 数在回包里，但要改口径 / 加汇总 / 跨两个数组 join / 换词表。
**🔴 要新建** = 今天全仓没有任何端点回这个数。

---

### 1.1 · 经营现状（`views/DashboardView.tsx` + `RiskBoardView.tsx`）

| 屏上这个数 | 今天有没有接口 | 实测证据 | 判定 |
|---|---|---|---|
| 交不出去的货 **31.1 亿** | 有，但只到**逐基地**，无全网汇总 | `risk_timeline.cards[].exposure.revenueYi`：常州 35.54 / 金华 17.82 / 成都 15.60 / 枣庄 11.36 / 自贡 5.85 / 江门 1.41 / 信阳 1.25 / 邯郸 0.74。**8 卡直接相加 = 89.58 亿（含跨基地重复单）**；按 `so` 去重后 = **63.16 亿 / 53 张单** | **◑** 前端要 join + dedup；或后端加一个全网汇总对象 |
| 7 张单 · 4 家客户 | 有 | `exposure.orders[]` / `exposure.customers[]` 逐基地齐全（`so/cust/qty/due/dueDay/revenueYi/seg/pri`） | **◑** 同上，今天去重后是 **53 张 / 9 家** |
| 常州占 **13.7 亿**（最大） | 口径对不上 | 常州整卡 `exposure.revenueYi = 35.54`；`customers[0]`（广汽埃安）= **13.43** | **◑** 13.7 像是「广汽埃安在常州」不是「常州」。见 §4-Q1 |
| 卡住的地方 **17 处 / 能动 4 处** | 有 | `POST /solvers/chain_impediments/invoke` → `impediments.length = **18**`，`candidates.length>0` 的 = **4** | **✅**（数从回包读，不写死） |
| 另外 13 处「今天没有对策」 | 有，且原文可直接上屏 | `noCandidateReason` 逐字：「枚举已跑完，有效候选 0 个（探了 10 个杠杆锚点 / 34 次试算），不足 2 个 ⇒ 构不成多方案对比，诚实不下发。缺口：LOCUS_PROP 够不着：对象类型 `Base` 在 `CAPACITY_FACTOR_BINDINGS` 上没有任何可拨动落点｜RULE_GATE 够不着：规则 `C34` 不是任何可拨动因子的 ruleGate」 | **✅** |
| 最早出事的日子 **第 14 天** | **两个不同的量，UX 用的是第二个** | ① `cards[].crossDay`（产能越线日）**8 张卡今天全部 = 1**；② `exposure.orders[].dueDay`（订单交期第几天）SO-3391 = **14** | **◑ 口径必须改**，详见 §3-② |
| 广汽 SO-3391 · 7,259 套 | 有 | `cards[金华].exposure.orders[]` 含 `{so:"SO-3391",cust:"广汽集团",qty:7259,due:"2026-06-24",dueDay:14}` | **✅** |
| 会晚 **4 天** | 有，但是 hash 估算 | `doNothing.delay.orders[].delayDays`，`basis:"ESTIMATED"`，`basisNote` 逐字：「delay = max(1, round((峰值 − 阈值 85) ÷ 8) + **hash(so) mod 3**)——确定性估算（R6 可重跑），**非实测交付延误**」 | **◑** 接口有，口径必须在屏上标「估」（§3-①） |
| 储能达成率 **72.2%** 差 27.8 个点 | 有 | `metric_rollup(level=op)` → `{key:"seg_attain_ess",actual:72.2,target:100,delta:-27.8,miss:true}` | **✅** 逐位一致 |
| 需求达成率 **90.8%** 差 9.2 个点 | 有 | 同上 → `{key:"demand_attain",actual:90.8,delta:-9.2,miss:true}` | **✅** |
| 「另外 4 项正常 ▸」 | 有，`miss` 布尔可直接折叠 | 6 条里 `miss:true` 恰 2 条（储能/需求），`missCount` 字段现成 | **✅** |
| 现金比目标少 **2 亿** | 有 | `gap_attribution(cash).rootMetric = {name:"经营现金",unit:"亿",target:60,actual:58,gap:2}` | **✅** |
| 应收账龄恶化 **1.17 亿** | 有 | `atomicLeaves[0] = {factor:"应收账龄恶化(root)",contribution:**1.173**,unit:"亿",provenance.kind:"实测"}` | **✅** |
| 客户集中度 **0.23 亿** | 有 | `atomicLeaves[1].contribution = **0.2325**` | **✅** |
| 账期拉长 **0.003 亿** | 有（引擎叫「DSO 拉伸(root)」） | `atomicLeaves[2].contribution = **0.0025**` | **✅** 只是改名 |
| 「这几个数加起来对得上账 ▸」 | 有，但**加起来对不上** | `reconChecks = [{depth:1,parentGap:2,sumChildren:1.76,residual:0.24,ok:true},{depth:2,parentGap:1.76,sumChildren:1.408,residual:0.352,ok:true}]`，`reconciled:true`，**`residualPct: 12`**。三条叶子相加 = **1.408**，而抬头写「少 2 亿」 | **◑** 勾稽面板有，但版面必须把 **0.59 亿残差**画出来，否则用户一加就发现对不上 |
| 〔催料〕〔改期〕〔挪产〕+ 还剩 N 天 | 机制有、数不对 | 见 §3-③ | **◑** |
| 「计划达成率 0.91% · 差 8.7pt」自相矛盾 | 与数据经理重叠 | 我只验到接口层：`metric_rollup` 回的 6 条里**没有「计划达成率」这一条**（6 条 = demand_attain / gm_rate / material_cov / seg_attain_com / seg_attain_ess / seg_attain_pas） ⇒ 这张卡的数**不来自 metric_rollup** | **◑**·**与数据经理重叠，以他为准** |

**小计**：✅ 8 · ◑ 7 · 🔴 0

---

### 1.2 / §2 · 主线五步（`views/sim/**` —— **整段属禁令 2，须逐案批准**）

#### ① 我要试什么

| 屏上这个数 | 今天有没有接口 | 实测证据 | 判定 |
|---|---|---|---|
| 八条事件模板（业务话） | 有 **11 条**，不是 12 也不是 8 | `GET /sim/drill/catalog` → `specs.length = **11**`，逐条带 `label`（中文）+ `payloadKeys`（含 type/hint）：`ORDER_RESCHEDULE 订单改交期(advanceDays,newDueDate)` / `ORDER_CANCEL 订单取消()` / `ORDER_INSERT 临时插单(qtyDelta,modelId)` / `ORDER_RELOCATE 改交付地点(newLocationId)` / `ORDER_REPRICE 订单改价(priceDelta)` / `MATERIAL_DELAY 物料到货延迟(delayDays)` / `MATERIAL_SHORTAGE 物料短缺(qtyDelta)` / `SUPPLIER_SWITCH 更换供应商(newSupplierId)` / `EQUIPMENT_FAILURE 设备故障(downDays)` / `CAPACITY_LOSS 产能损失(lossPct)` / `FORECAST_BIAS 预测偏差(biasPct,modelId)` | **◑** 见下逐行 |
| ├ `正极材料 涨价 20%` | **没有这个事件类型** | 11 类里**零个**是「物料涨价」。`ORDER_REPRICE` 是**订单**改价（`priceDelta` 落在 Order 上），不是物料。金丝雀：同一份 catalog 里 `MATERIAL_DELAY`/`MATERIAL_SHORTAGE` 都在 ⇒ 不是我漏读 | **🔴** 要新建事件类型 |
| ├ `常州 停线 2 天` | 半有 | `EQUIPMENT_FAILURE(downDays)` 的落点是**设备**，不是**基地**；`CAPACITY_LOSS(lossPct)` 落点可以是基地但语义是「减产百分比」不是「停 N 天」 | **◑** 口径要改 |
| ├ `常州 减产 40%` | 有 | `CAPACITY_LOSS(lossPct:number)` → `bottleneck_matrix` | **✅** |
| ├ `广汽 加单 1 万套` | 半有 | `ORDER_INSERT(qtyDelta,modelId)`，但 `modelId` 对 `capacity_forecast` 路由是 `required:true` ⇒ 用户选「广汽」还不够，必须再选型号 | **◑** |
| ├ `宇部 断供 7 天` | 半有 | 最近的是 `MATERIAL_DELAY(delayDays)`（到货延迟）与 `SUPPLIER_SWITCH(newSupplierId)`（换供应商）。**「断供」不等于这两个** | **◑** 口径要改 |
| ├ `SO-3391 要提前 5 天交` | 有 | `ORDER_RESCHEDULE(advanceDays)` + `hint:"提前天数（正数 = 提前）"` | **✅** |
| ├ `订单比预期 多/少 10%` | 有 | `FORECAST_BIAS(biasPct,modelId)` | **✅** |
| └ `分切线 设备坏了 3 天` | 有 | `EQUIPMENT_FAILURE(downDays)` | **✅** |
| 「已加的事叠成一个可见清单」（能删能改） | **两套词表，只有一套能存** | `GET/POST/DELETE /sim/sessions/:id/perturbations` **真通**（实测 GET 200，回 `{kind,targetObjectId,targetStateVar,startTick,durationTicks,magnitude,mode,label}`）—— 这是**引擎语汇**。而 drill 是**一次性 POST**，`GET /sim/drill/*` 只有 `catalog`，**没有任何「已加事件清单」的存储或列表端点** | **🔴** 用业务事件做清单 ⇒ 要新建存储；或按架构师 A2 做 `DrillEvent⇄Perturbation` 转换器 |
| 「已经加了 2 件事」计数 | 随上一条 | 同上 | **🔴** |
| 「还有 20 件事这里试不了 ▸」 | 名单没有出处 | 11 个事件 vs 40 个状态变量 vs 20 个产能因子 —— **「20」这个数今天没有任何端点直接回**，要人工定义「一件事」的粒度 | **🔴**（也可降级为 ◑：直接列 11 类之外即可，但那不是 20） |
| 「上一次那条推演带进来」 | 有 | `GET /sim/sessions` → 6 个会话，全部 `tickDays:1` | **✅** |

#### ② 预演

| 屏上这个数 | 今天有没有接口 | 实测证据 | 判定 |
|---|---|---|---|
| 「正在算未来 30 天…」+ 秒数 | 不需要接口 | 架构师实测全链串行 **2.485 s**，零 LLM。我今天复测单拍 `POST /sim/sessions/:id/tick` = **0.292 s** | **✅** |
| 〔算一下〕一个按钮跑完 ①→⑤ | **没有编排端点** | 今天要串 4–6 次独立 invoke（perturbations → tick → drill → chain_impediments → decision_play → finance_world_projection）。全仓无一个端点把它们编排起来 | **◑** 前端串起来即可（2.5 s 内），不必新建后端端点 |
| 「算完了，一项都没动」（≠ 空白） | 引擎已经这么写了 | `finance_world_projection.notes[0]` 与 `doNothing.catchUp.status:"EMPTY"` 都是这种克制写法 | **✅** |

#### ③ 钱上差多少

| 屏上这个数 | 今天有没有接口 | 实测证据 | 判定 |
|---|---|---|---|
| 毛利 `118.9 → ▼62.4` 少 56.5 亿 | 接口有，**数不可用** | `finance_world_projection.lines[毛利] = {budget:116.5, rolling:118.9, projected:**-3272.25**, delta:-3391.15, deltaPct:**-2852.10**}` | **◑** 见 §3-补充 |
| 多花的成本 `+41.2 亿` | 同上 | `lines[销售成本] = {rolling:581.1, projected:**3972.25**, deltaPct:**583.57**}`，`formula:"581.1 ×（1 + 583.573731 ÷ 100）"` | **◑** |
| 少收的钱「这次算不出来」 | **引擎已经原样这么说了** | `lines[收入] = {rolling:700, projected:700, delta:0, driver:"", formula:"700（本链不驱动收入 —— 世界态需求侧变量与 FinancePlan 收入行之间今天没有传导规则）"}` + `notes[0]` 全文 | **✅** UX 这一格的设计与引擎已有行为**逐字吻合** |
| 压住的应收 `+15.3 亿` | **finance 只有 3 行** | `lines[]` 逐条 = 销售成本 / 毛利 / 收入。**没有应收行** | **🔴** |
| 一句人话归因「主要是常州停线那两天」 | 没有 | `lines[].driver` 只有 `"Order.costPressure"`（变量名），无「哪一条扰动贡献多少」的分解 | **🔴** |
| 「这几个数加起来对得上账 ▸」 | 有 | `finance_world_projection` 同样带 `reconChecks` / `reconciled` | **✅** |
| 「估」角标的成色来源 | 有 | `basis = {kind:"PROJECTION", pressureUnit:"pp", divisor:100, source:"DEFAULT_DECLARED", note:"…这是**推演投影**不是实测值…"}` | **✅** |

#### ④ 哪里卡住了 · 什么时候

| 屏上这个数 | 今天有没有接口 | 实测证据 | 判定 |
|---|---|---|---|
| 能动的 4 处，每处一句话 | 有 | `impediments[].locus.label` 逐字：`金华分切线` / `自贡分容线` / `磷酸铁锂正极` / `pos_lfp_b2` ⇒ **4 个里 3 个是人话，1 个是机器号** | **◑** 1/4 的 label 是 `pos_lfp_b2` |
| 「有 N 种改法」 | 有 | `candidates.length` = 2 / 2 / 4 / 4 | **✅** |
| 只能盯着的 13 处 + 点名最严重 | 有 | `severity` 序 + `noCandidateReason` 原文 | **✅**（今天是 14 处） |
| 事件顺序线（第 14/22/23/25/26/28/29 天） | 有 | `cards[].events[]` = `{type,day,amp,factors[],tag,obj,desc,src}`，常州 **28 条**。样本逐字：`{day:3, tag:"交付高峰", obj:"SO-900269", desc:"SO-900269·广汽埃安 交付 2941 万套到期：当周产线排产负载 +12 个百分点，需额外工时约 4706 人·班", src:"S&OP/ERP 订单交期"}` | **✅** |
| 每个点一句人话 | 有 | 同上 `events[].desc` 就是业务话 | **✅**（`desc` 里 `2941 万套` vs `qty:2941 套` 的单位矛盾 —— **与数据经理重叠，以他为准**） |
| **「第 14 天之前动手，后面七张全躲得过」** | **没有** | 这是一句**反事实断言**（「动了手 ⇒ 这七张不晚」）。`counterfactual_timeline` 求解器存在（`DashboardView.tsx:912` 真调），但它按 `base` 算指标轨迹，**不回「若在第 N 天执行动作 X，则订单集合 S 全部转准时」**。全仓无端点回这个 | **🔴** |
| 「17 类判据，都在红线内」（空态） | 有 | `evaluatedRules[]` + `ruleSetVersion` | **✅** |

#### ⑤ N 个方案 + 对比（四栏）

| 屏上这个数 | 今天有没有接口 | 实测证据 | 判定 |
|---|---|---|---|
| 方案名是人话（空运补料 / 提前备料 / 换备选供应商 / 增开夜班 / 临时用工 / 预防性维护前置 / 备用产线切换 / 厂商驻场支持） | **有，而且一字不差** | `risk_timeline.mitigationLibrary` = **7 类 × 3 = 21 个方案**，逐字含 `空运补料` `提前备料` `备选供应商切换` `增开夜班` `临时用工` `预防性维护前置` `备用产线切换` `厂商驻场支持` `跨基地借调` `瓶颈工序扩容` `工艺路线调整` `工序外协` `前置仓备货` `双线路运输` `加急运输` `快速换型改善` `批次合并排产` `冻结排产窗口` `SPC 管控收紧` `黄金批次参数回滚` `来料加严检验` | **✅** |
| 多久见效 `1 / 2 / 5 天` | **有，逐位对得上** | `mitigationLibrary.物料齐套 = [{name:"提前备料",tn:**2**,cost:"中",risk:"低"},{name:"备选供应商切换",tn:**5**,cost:"高",risk:"中"},{name:"空运补料",tn:**1**,cost:"极高",risk:"低"}]` | **✅** |
| 代价 `极高 / 中 / 高` | 有 | 同上 `cost` 字段，取值域 `{极高,高,中,低}` | **✅** |
| 风险 `低 / 低 / 中` | 有 | 同上 `risk` 字段，取值域 `{高,中,低}` | **✅** |
| **把这三栏挂到「金华分切线」这个卡点上** | **词表对不上** | `mitigationLibrary` 的 key 是 **7 个因子类**（物料齐套/设备OEE/人力工时/瓶颈工序/物流时长/换型损失/良率波动）；而 `chain_impediments.candidates[].lever.factorName` 的取值是**另一套**（实测：`物料到货`(⑮) / `瓶颈工序` / `利用率` / `在岗出勤/熟练` / `工序良率`）。**两套只有「瓶颈工序」一个词重合** | **◑** 要一张 7↔20 的因子映射表 |
| **「保住这几张单：广汽 7,259 套 / 长安 14,518 套 / …共 7 张」** | **没有** | `candidates[].dims` 逐条实测只有三个键：`breach` / `severity` / `capacityP50`。**没有任何订单列表、没有金额、没有交期** | **🔴** |
| 第四栏 · 七张单逐张（带到期日 + 会晚几天） | 有 | `cards[].doNothing.delay.orders[]` = `{so,cust,qty,due,dueDay,delayDays,basis,basisNote}`。常州今天 **26 条** | **✅**（条数从回包读） |
| 第四栏 · 合计 **31.1 亿** | 要 join | `doNothing.delay.orders[]` **不带金额**；`exposure.orders[]` 带 `revenueYi`。**实测：按 `so` join，全网 53 张延误单 0 张缺 revenue，合计 63.16 亿** ⇒ join 可行 | **◑** |
| 第四栏 · 「常州靠自己消化要 264 天」 | 有 | `doNothing.catchUp = {status:"OK", shortfall:156354, freeDaily:211.2, days:**740.31**, unit:"天", formula:"缺口(套) ÷ 空闲日产能(套/日)；空闲日产能 = Σ Line.capacityDaily × (1 − Base.util/100)", provenance:[…]}`。⚠️ **8 个基地里 2 个（江门/自贡）`catchUp.status = "EMPTY"`** | **✅**（EMPTY 那两个照 §3.3 不许画成 0） |
| 「系统不给推荐、不标星」 | 后端**给**推荐，UI 忽略即可 | `decision_play.recommendedPlan = {planId:"plan-cf-decision-gap", optionIds:["opt-lta-clause","opt-backup-cert","opt-insource"], steps:[…]}` | **✅** 撤星是纯前端 |
| 「按〔多久见效〕排序」表头可点 | 有 | `tn` 是数值，可排序 | **✅** |
| 〔就这么办〕→「已经生成一份待批的动作」 | 有 | `POST /a/v1/action-drafts`（`app.ts:5128`）+ `/submit` `/approve` `/reject` `/decision` `/cancel` `/audit` 全套在。实测 `GET /a/v1/action-drafts` → **200，0 条** | **✅** 接口全，数据空 —— **与数据经理重叠** |
| 「候选 0 条」空态原文 | 有 | `noCandidateReason` 逐字可用（见 1.1） | **✅** |
| 三张卡 KPI 逐字相同（今天的死点 1） | 病因确认 | `decision_play` **带 `worldId` 与不带，回包长度逐字节相同（lenA = lenB = 9363）** ⇒ 架构师结论今天仍成立 | **◑** 属 A1 |

**主线五步小计**：✅ 20 · ◑ 10 · 🔴 7

---

### 1.3 · 订单与交付（`views/plan/OrderChainView.tsx`）

| 屏上这个数 | 今天有没有接口 | 实测证据 | 判定 |
|---|---|---|---|
| 24 张单里 7 张要晚 · 4 家客户 | 有 | `affected_orders` → `rows.length = **127**`；`problems[0] = {category:"DELIVERY", title:"交期风险订单", orderCount:**60**, financeImpact:**74.2019**, rootCauseSummary:"18 单交期落入 常州基地 化成柜 越线窗口"}` | **✅**（数从回包读；今天不是 24/7） |
| SO-3391 「不建议接」 | 有 | `order_fullchain(so=SO-3391)` → `verdict:"**不建议接**"` | **✅** |
| 四条理由 | 有，且已是人话 | `conds[]` 逐字：「信用占用超限（C13），需先收款/降额」/「周供给 P90 2520 套/周 < 本单需求 7259 套（按整单落单周折算·C02），需夜班/外协对冲」/「三元正极 缺口 1858 吨（C06），最早齐套 2026-06-28」 | **✅** 规则码降层是纯前端 |
| 毛利率 19% vs 底线 12% | 有 | `kpis = {qty:7259, segment:"乘用车", marginPct:19, floorPct:12, deliveryPacksPerWeekP90:2520, kitGap:1858}` | **✅** |
| 料晚在哪一段：供应商 12 天 ▸ 在途 ▸ 清关 ▸ 到货检 | 有 | `kit_readiness(fromDay:1,toDay:14)` → `rows[8]`，`rows[0].shortItems[0].procurement.leadTime.legs[] = [{leg:"supplier_production", owner:"SUPPLIER", ownerRef:"**宇部兴产**", days:**12**, status:"**MEASURED**", source:{objectType:"Supplier",...}}, …]` | **✅** 有 owner / 中文 ownerRef / days / 成色 |
| 〔打给广汽谈改期〕48 小时内 | 窗口无出处 | 见 §3-③ | **◑** |
| 〔拆两批交〕〔催正极〕 | 动作本身无端点 | `action-drafts` 能存一份待批动作，但「拆两批交」不是 11 类事件之一 | **◑** |

**小计**：✅ 5 · ◑ 2 · 🔴 0

---

### 1.4 · 计划与平衡（`views/plan/AnnualScenarioView.tsx`）

| 屏上这个数 | 今天有没有接口 | 实测证据 | 判定 |
|---|---|---|---|
| 三条路 × 卖多少套 | 有 | `GET /a/v1/objects?type=AnnualScenario` → 3 条，`demand` = **283.5 / 322.2 / 380.2** | **✅** 与 UX 稿逐位一致 |
| 三条路 × 收入 | 有 | `revenue` = **529.2 / 601.5 / 709.7** | **✅** |
| 三条路 × 要花多少 | 有 | `capex` = **3 / 8 / 27** | **✅** |
| 三条路 × 手上现金剩 | 有 | `cashCushion` = **72 / 58 / 42** | **✅** |
| 「（已拍板）」 | 有 | `finalized: true` 只在 baseline 上（`finalizedAt:"2026-06-20T09:00:00.000Z"`） | **✅** |
| 不新增产线 / 合肥四期 8GWh 2027-Q2 投产 / 合肥四期+盐城二期 20GWh | 有，且已是人话 | `capacityDecision` 逐字：「维持现有产线，不新增产能投资」/「合肥四期 8GWh 扩产，2027-Q2 投产」/「合肥四期 + 盐城二期合计 20GWh 扩产」 | **✅** |
| ⚠ 会击穿现金底线 | 要算 | `cashCushion:42` 与 C18 底线要比一次；`GET /a/v1/rules` 回 **29 条全 PUBLISHED**，含 C 系规则码 | **◑** 一次比较，前端可做 |
| 「第二年需求 = 第一年原样重放」诚实位 | 未验 | **与数据经理重叠，以他为准** | — |
| 2026-Q3 缺 11.77 万套 | 未验 | **与数据经理重叠，以他为准** | — |
| `IRR` 今天先不上屏 | 有（撤掉即可） | `irr` = 9.5 / 14.2 / 18.6 | **✅** 纯前端 |

**小计**：✅ 8 · ◑ 1 · 🔴 0（另 2 条归数据经理）

---

### 1.5 · 系统后台

| 屏上这个数 | 今天有没有接口 | 实测证据 | 判定 |
|---|---|---|---|
| 待你批的 **3 件** | 有 | `GET /a/v1/action-drafts` → 200，**0 条** | **✅** 接口在，数据空（**与数据经理重叠**） |
| 数据接进来了 **4 个源** | 有 | `GET /a/v1/connections` → **8 条** | **✅** |
| 开着的功能 **108 项** | 有 | `GET /a/v1/me/workspace` → `features = **108**`（另 `navigation = 51`，`views = 33`） | **✅** 逐位一致 |
| 规则改动待审 **1 条** | 有 | `GET /a/v1/rules` → 29 条，状态分布 `{"PUBLISHED":29}` ⇒ 待审 **0** | **✅** 接口在，数据空 |
| **今天出错的 0 件** | **没有路由** | 探了 `audit-logs` `audit` `metrics/errors` `sessions` `login-events` **全部 404**（金丝雀：同批 `rules` 200、`me/workspace` 200 ⇒ 探针没坏）。源码里 `audit` 相关路由只有 2 条，都是**单对象**的：`/a/v1/action-drafts/:id/audit`、`/a/v1/tenants/:id/features/audit`。`/a/v1/actions/metrics` 存在但只回 `{submit:[],approval:[],execute:[],stability:{executions:0,succeeded:0,failed:0,failureRate:0}}` —— **是 Action 执行失败率，不是「今天系统出错几件」，且无日期过滤** | **🔴** |
| **今天登录的人 12 人** | **没有路由** | 同上。全仓与 login 相关的只有 `/a/v1/auth/login`（**签发**，不是**统计**） | **🔴** |
| 七个分组入口 · 46 个 admin 项降二级 | 纯前端 | `pages/adminRegistry.ts` + `ShellLayout.tsx` | **✅** |

**小计**：✅ 5 · ◑ 0 · 🔴 2

---

### §1 判定统计

| | ✅ 现有接口直接给 | ◑ 有接口但要改 | 🔴 要新建 |
|---|---:|---:|---:|
| 1.1 经营现状 | 8 | 7 | 0 |
| §2 主线五步 | 20 | 10 | 7 |
| 1.3 订单与交付 | 5 | 2 | 0 |
| 1.4 计划与平衡 | 8 | 1 | 0 |
| 1.5 系统后台 | 5 | 0 | 2 |
| **合计** | **46** | **20** | **9** |

> **一句话读这张表**：**75 个数里 46 个今天调一个端点就有（61%）。**
> UX 稿的绝大部分不是「后端做不到」，是**「后端做到了但埋在第三层」** ——
> 这正好是裁决 B（收敛）该干的活，而不是 C（加倍）。
> **9 个 🔴 里有 7 个集中在主线五步的 ① / ③ / ④ / ⑤，且全部落在 `views/sim/`（禁令 2 范围）。**

---

## §2 · 工期（人周）

**估算口径**：1 人周 = 1 个工程师 5 个工作日。含写测试与自测，不含四包 gate 排队时间。
只估 §1 里判 **◑** 与 **🔴** 的条目，✅ 的按「纯版面」另计在包内。

### 2.1 逐条工作包

| 包 | 内容 | 人周 | 依赖 | 禁令 2？ |
|---|---|---:|---|---|
| **W0a** | **加一条 `utilPressure → costPressure` 传导边**（`seed.ts` 一条 `PropagationRule`） | **0.2** | — | 否（datacore） |
| **W0b** | **40 个状态变量的量纲声明表**（架构师 C1）：`stateVar → {unit,kind,baselineRef,divisor}`，`finance-world.ts` 读表代替 `basis.divisor=100` | **2.0** | W0a | 否 |
| **W1** | 首屏经营现状：全网去重汇总 join(0.5) + `miss` 折叠(0.2) + 现金三条含残差(0.4) + 12→3 大数(0.3) + `P50/AOP/C18/终版` 改名(0.2) + 5.13 达成率打架修掉(0.2) | **1.8** | — | 否 |
| **W2** | **决策窗口字段**：后端把 `cards[].allFactors[].crossDay` + `otd.rows[].slackDays` 归一成一个 `decisionWindow{days,basis,anchor}`(0.5) + 三个按钮上屏(0.3) | **0.8** | — | 否 |
| **W3** | 订单与交付：`order_fullchain` 括号/规则码降层(0.3) + 四段腿挂回(0.3) + 三个按钮(0.2) | **0.8** | W2 | 否 |
| **W4** | 计划与平衡：措辞 + `IRR/CAPEX/C18/C23` 改写 + 现金底线比较 | **0.5** | — | 否 |
| **W5a** | 系统后台：四个**有接口**的计数 + 46 项降二级 | **0.9** | — | 否 |
| **W5b** | 「今天出错的 / 今天登录的人」：落审计表 + 两条聚合路由 + pg/memory 双实现 + 迁移 | **1.5** | — | 否 |
| **W6** | ④ 卡点两栏 + `noCandidateReason` 上屏(0.5) + 事件顺序线接 `events[].day/desc`(0.5) | **1.0** | — | **是**（P4/P5） |
| **W7a** | ⑤ 三栏接 `mitigationLibrary`(0.5) + **7↔20 因子映射表**(0.5) | **1.0** | — | **是**（P6） |
| **W7b** | ⑤ 第四栏：`doNothing` 上屏 + 金额 join + `catchUp.EMPTY` 空态 | **0.6** | — | **是**（P6） |
| **W7c** | ⑤ **「保住这几张单」** —— 每个候选跑一次 `affected_orders` 差分，回订单集合 | **2.5** | A1 | **是** |
| **W7d** | 〔应用方案〕死控件接 `action-drafts` | **0.4** | — | **是**（P12） |
| **W8a** | ① 用 11 类 drill 事件铺 UI（含 `payloadKeys` 表单生成） | **0.5** | — | **是**（P1） |
| **W8b** | ① 补「物料涨价 / 基地停线 / 供应商断供」三类事件 kind + 路由 + normalize | **2.0** | — | 否（contracts+datacore） |
| **W8c** | ① 事件清单可存可删（drill 今天无存储）—— 或做 `DrillEvent⇄Perturbation` 转换器（架构师 A2） | **2.0** | W8b | 部分 |
| **W9** | ② 一个按钮串完 ①→⑤（纯前端编排，2.5 s 内） | **0.5** | W8a | **是**（P2） |
| **W10a** | ③ 三行钱搬到正中 | **0.3** | W0b | **是**（P3） |
| **W10b** | ③ 「压住的应收」第四行 —— finance 加一条 `RECEIVABLE` 行 + 一条传导边 | **1.0** | W0b | 否 |
| **W10c** | ③ 一句人话归因「主要是常州停线那两天」—— 按扰动做贡献分解 | **1.5** | A1 | 否 |
| **W11** | ④ 「第 14 天之前动手，后面七张全躲得过」反事实断言 | **2.0** | W7c | **是** |
| **W12** | 诚实位三记号 + 页脚汇总（P10） | **1.5** | — | **是** |
| **W13** | 清死物：假英文菜单(P8) + 假窗口条(P9) + `**` 星号(P14) + 13 个旋钮(P13) | **0.8** | — | **是** |
| **W14** | **A1 `SolverContext` 带 `worldId`/`tickState`**（架构师判为唯一关键路径） | **1.5** | — | 否 |
| **W15** | C4 tick 回包投影 —— **今天实测 2,020,731 B ≈ 2.02 MB**（架构师 08-27 测 1.13 MB，**8 天涨 79%**） | **1.0** | — | 否 |
| | **合计** | **28.1** | | |

### 2.2 关键路径

```
W0a(0.2) → W0b(2.0) → W10a(0.3)                      = 2.5   ③ 的数能不能放大
W14(1.5) → W7c(2.5) → W11(2.0)                       = 6.0   ⑤「保住哪几张单」到「躲得过」
W8b(2.0) → W8c(2.0) → W9(0.5) → W6(1.0) → W7a(1.0)   = 6.5   ① 的事件到 ⑤ 的方案
```

**关键路径 = 6.5 人周**（①→⑤ 那条），**全量交付 = 28.1 人周**。

### 2.3 与 CEO 预算对照

| | 人周 |
|---|---:|
| CEO 批的（入场券 2 周 + 下月三件事 5 周，同一个人串行） | **5.0** |
| UX 稿全量 | **28.1** |
| **超** | **+23.1 人周（5.6 倍）** |
| 只走关键路径（①→⑤ 串成一条真链，不含四栏「保住哪几张单」） | **6.5** |
| **仍超** | **+1.5 人周** |

### 2.4 我建议的 5 人周切法（**正好落在预算内，且 0 行 `views/sim/` 改动 ⇒ 不触禁令 2**）

| 包 | 人周 | 交付物 |
|---|---:|---|
| **W0a** 加一条 `utilPressure → costPressure` 边 | 0.2 | **CEO 红线 1 的验收物**：常州拉满 vs 什么都不做，毛利出现两个不同的数（依据见 §3-补充） |
| **W1** 首屏经营现状 | 1.8 | 三个大数 + 掉队两项 + 现金三条 + 达成率 bug |
| **W2** 决策窗口字段 | 0.8 | 三个按钮各带一个**有出处**的「还剩 N 天」 |
| **W3** 订单与交付 | 0.8 | SO-3391 那一屏 + 四段腿 |
| **W4** 计划与平衡 | 0.5 | 三情景四个数 + 改写 |
| **W5a** 系统后台四个计数 | 0.9 | 46 项降二级 |
| **合计** | **5.0** | |

**这一集为什么值这 5 周**：它覆盖 §1 里 **46 个 ✅ 中的 31 个**，而且**一行 `views/sim/` 都不碰**
—— 换句话说，**红线 1（9/30 沙盘死刑）若判死，这 5 周的产出一分钱都不作废。**
反过来，W6–W11（沙盘那 12.9 人周）**全部押在红线 1 上**，红线 1 一判死就全废。
**这就是我建议先做这一集的全部理由。**

---

## §3 · 我认为 UX 稿里做不到的

### 3.A · 三条特别评审

#### ① 第 ⑤ 步「四栏并排 + 什么都不做那一栏也有代价数字」—— **代价数字后端算得出来吗？**

**结论：三个构成里两个✅一个◑，但「保住这几张单」那半🔴。四栏能画，画不满。**

| 第四栏要的 | 后端 | 实测 |
|---|---|---|
| 七张单逐张（客户 + 第几天 + 晚几天） | **✅ 有** | `cards[].doNothing.delay.orders[]`，常州今天 26 条，字段 `{so,cust,qty,due,dueDay,delayDays}` 齐全 |
| 合计 **31.1 亿** | **◑ 要 join** | `doNothing.delay.orders[]` 不带金额；按 `so` 与 `exposure.orders[].revenueYi` join —— **实测 53 张延误单 0 张缺 revenue** ⇒ join 可行，今天合计 63.16 亿 |
| 「常州靠自己消化要 264 天」 | **✅ 有** | `doNothing.catchUp = {days:740.31, shortfall:156354, freeDaily:211.2, formula:"缺口(套) ÷ 空闲日产能…"}` |

**但有三条必须写进设计，否则这一栏会骗人**：

1. **「晚 4 天」是 hash 算的。** `basisNote` 逐字：
   > 「delay = max(1, round((峰值 − 阈值 85) ÷ 8) + **hash(so) mod 3**)——确定性估算（R6 可重跑），
   > **非实测交付延误**；要变成实测需接 Shipment 实际交付日 / 排产完工日回写。」

   ⇒ 第四栏那一列**必须带「估」角标**（§3.2 已有这个记号），
   **绝不许**和左边三栏的 `mitigationLibrary.tn`（同样是估但来源不同）并排成同一种字。
   ⚠️ 实测 **8 个基地的 `worstDays` 全部 = 4** —— 一个 hash 出来的数在 8 个基地上取同一个值，
   这本身就是「它不是测出来的」的旁证。

2. **8 个基地里 2 个（江门 / 自贡）`catchUp.status = "EMPTY"`。**
   照 UX §3.3，这两个**绝不许画成「0 天」**（会被读成「这两个基地立刻能补上」）。
   引擎已经给了空态，界面别把它折成 0。

3. **前三栏的「代价」和第四栏的「代价」不是同一个量纲。**
   前三栏 `cost` 是**枚举档**（极高/高/中/低），第四栏是**金额 + 天数**。
   UX 稿里第四栏写「代价 见下」已经回避了这个问题 —— **这个处理是对的，我支持**，
   但表头那一行「代价」在四栏上意思不同，**建议第四栏表头改成「不做的后果」**。

**🔴 真做不到的那半**：**「保住这几张单：广汽 7,259 套 / 长安 14,518 套 / …共 7 张」。**
实测 `chain_impediments.candidates[].dims` 逐条只有三个键：`breach` / `severity` / `capacityP50`。
**没有订单列表、没有金额、没有交期。** 要算出「这个方案能保住哪几张单」，
必须**给每个候选跑一次带干预的 `affected_orders` 差分**（W7c，2.5 人周，且依赖 A1）。

> ⇒ **我的建议**：**第一版四栏，前三栏只出「名字 / 多久见效 / 代价档 / 风险档」四行，
> 「保住这几张单」整块删掉**，第四栏照常出。
> 理由：前三栏那四行**今天零后端改动就能给**（`mitigationLibrary` 一个字段都不用加），
> 而「保住这几张单」要 2.5 人周 + A1。**四栏并排的决策价值 90% 在「第四栏 vs 前三栏」这个对照上，
> 不在每栏里那份订单明细。**

---

#### ② 首屏「第 14 天 · 最早出事的日子」—— **「第几天」这个量后端有没有？**

**结论：后端有三个不同的「第几天」，UX 稿用的是其中语义最弱的那个，而标题写的是另一个的意思。**

| 后端的「第几天」 | 字段 | 今天实测 | 语义 |
|---|---|---|---|
| **越线日** | `cards[].crossDay` | **8 张卡全部 = 1** | 产能主因素越过阈值 85 的那一天 |
| **逐因子越线日** | `cards[].allFactors[].crossDay` | 常州：人力工时 **2** · 物料齐套 **28** · 物流时长 **28** · 良率波动 **22** | 每个因子各自的越线日 |
| **订单交期日** | `exposure.orders[].dueDay` / `doNothing.delay.orders[].dueDay` | SO-3391（金华·广汽集团·7259 套）= **14** | 这张单**到期**的那一天 |

**UX 稿「最早出事的日子 · 第 14 天 · 广汽 SO-3391 · 7,259 套 · 会晚 4 天」用的是第三个（`dueDay`）。**

**问题**：`dueDay` 是**交期日**，不是**出事日**。
按「出事 = 越线」这个所有人都会这么读的口径，答案是 **第 1 天**（8 个基地今天全部 `crossDay=1`），
而不是第 14 天。**这一屏最大的那个数，标题和取数口径说的是两件事。**

**而且这个错会往下传**：§1.1 的三个按钮写「还剩 13 天」，13 = 14 − 1。
若口径改成 `crossDay`，答案是 **0 天（今天就得动）** —— **三个按钮全部要改**。

**能做但要改口径（我建议的写法，零后端改动）**：

- 大数那一格的标题**从「最早出事的日子」改成「最早交不出去的那一张」**，
  下面写「第 14 天 · 广汽 SO-3391 · 7,259 套」。这样 `dueDay` 的口径和标题就对上了。
- **真正的「最早出事的日子」是第 1 天**，这句话该出现在页脚成色行，
  原文：「8 个基地的产能主因素今天（第 1 天）都已经越线」。
- ⚠️ **不许写「6 月 24 号」** —— UX §6-8 已经点到了，我复核**成立**：
  `dueDay` 与 `due`（`2026-06-24`）在回包里都在，**日期是有的**，
  但 `crossDay` 那一族只有天号没有日期，两个混排会造出一个假精度。

---

#### ③ 「催料 / 改期 / 挪产 还剩 N 天」的决策窗口 —— **这个 N 从哪来？**

**结论：机制有，今天这三个数一个都复现不出来。归类为「能做但要改口径」，0.8 人周。**

COO 给的出处（`LOOP3-coo-screen §2.4`）逐条复核：

| 按钮 | COO 写的出处 | 我今天实测 |
|---|---|---|
| 催料 · 还剩 13 天 | 「物料齐套这一项在第 14 天越线（**合肥卡**上 `物料齐套 crossDay 14`）」 | **`risk_timeline` 今天回的 8 张卡里没有合肥**（江门 邯郸 自贡 信阳 常州 枣庄 金华 成都）。常州的 `物料齐套 crossDay = 28` ⇒ 同口径今天是「还剩 27 天」 |
| 改期 · 还剩 13 天 | 「最早一张 SO-3391 第 14 天到期」 | `dueDay = 14` ✅ **这一条今天仍成立** |
| 挪产 · 今天就得动 | 「常州主因素当天已越线，且缺口 55,768 套靠自己消化要 264 天」 | 越线 ✅（`crossDay=1`）；缺口 **156,354 套 / 740.31 天**（不是 55,768 / 264） |

**所以 N 的三个候选来源，逐个判**：

| 来源 | 字段 | 判定 |
|---|---|---|
| **逐因子越线日** `crossDay − 1` | `cards[].allFactors[].crossDay` | **✅ 最好的一个。** 语义正（「这个因子还有 N 天越线」），逐基地逐因子都有，可直接减 |
| **订单交期日** `dueDay − 1` | `exposure.orders[].dueDay` | **✅ 可用**，但语义是「离交期还剩 N 天」不是「离出事还剩 N 天」 |
| **订单剩余裕度** `slackDays` | `cards[].otd.rows[].slackDays` | **✅ 语义最准，但今天全是负的。** 常州实测 `otd = {total:26, onTimeCount:0, rate:0, avgLateDays:6, worstSlackDays:**-16**}`，逐条如 `{so:"SO-3445", dueDay:25, delayDays:2, predictedDay:27, slackDays:**-16**}` |
| **计划行的启动日** | `planRows[].start` | **🔴 不能用。** 逐字：`"T+-6·06-04（越线前7天）"` `"T+-2·06-08"` —— **17 条计划行的启动日全部是负的 T+，即全部在过去。** CEO 那轮也测到了这条 |

**⇒ 我的判定与做法（W2，0.8 人周）**：
后端在 `risk_timeline.cards[]` 上加一个归一字段
`decisionWindow: { days, basis: "FACTOR_CROSS" | "ORDER_DUE" | "ORDER_SLACK", anchor }`，
三个来源按优先级取（`slackDays` > `allFactors[].crossDay` > `dueDay`），
**`days ≤ 0` 时不回 0，回 `basis:"OVERDUE"` + 一句原文**，前端照 §3.3 画成「今天就得动」。

⚠️ **不许让前端自己减**。三个来源的语义不同，减法写在前端 = 三个页面三种口径，
下个月就会出现「同一个按钮在两屏上剩不同的天数」。

---

### 3.B · 真做不到（要新建模 / 新引擎，超出收敛预算）

| # | UX 稿原文 | 为什么真做不到 | 人周 |
|---|---|---|---|
| **1** | §2⑤「**保住这几张单：广汽 7,259 套 / 长安 14,518 套 / …共 7 张**」 | 候选身上 `dims` 只有 `breach/severity/capacityP50`，**零订单信息**。要算必须给每个候选跑一次带干预的 `affected_orders` 差分，且候选要能"施加"—— 而候选是 `{objectType,objectId,prop,fromValue,toValue}`，**今天没有把它变成一次可执行干预的通路** | 2.5 + A1 1.5 |
| **2** | §2④「**↑ 这一天之前动手，后面七张全躲得过**」 | 反事实断言。`counterfactual_timeline` 存在但回的是**指标轨迹**，不回**订单集合的转态**。要它成立必须先有 #1 | 2.0（依赖 #1） |
| **3** | §2③「**压住的应收 +15.3 亿**」 | `finance_world_projection.lines[]` 实测只有 3 行（销售成本 / 毛利 / 收入）。**没有应收行**，且 `receivablePressure` 到 `FinancePlan` 之间**没有传导边**（我 BFS 过全图） | 1.0 |
| **4** | §2③「**主要是常州停线那两天**」 | 要按**单条扰动**做金额贡献分解。`lines[].driver` 今天只回一个变量名 `Order.costPressure`，没有「哪条扰动贡献多少」的拆解 | 1.5 + A1 |
| **5** | §2①「**还有 20 件事这里试不了 ▸**」的名单 | 「一件事」的粒度今天没有定义：11 个 drill 事件 / 40 个状态变量 / 20 个产能因子，三个数都不是 20。**这不是接口缺失，是概念没定义** | — （见 §4-Q4） |
| **6** | §1.5「**今天出错的 0 件**」「**今天登录的人 12 人**」 | 全仓无审计日志/登录事件的列表或聚合路由（探了 5 条全 404，金丝雀通过）。要做得落一张审计表 + pg/memory 双实现 + 迁移 | 1.5 |

### 3.C · 能做但要改口径（说清改什么、影响谁）

| # | UX 稿原文 | 改什么 | 影响谁 |
|---|---|---|---|
| **1** | 「**17 处 / 能动 4 处 / 只能盯着 13 处**」写进版面 | **一律从回包读，版面不许写死。** 今天已经是 18 / 4 / 14 | §1.1 三大数、§2④ 两栏、页脚成色第 2 条 |
| **2** | 「**31.1 亿**」「**7 张单**」「**264 天**」「**第 14 天**」 | 同上。今天分别是 63.16 亿 / 53 张 / 740.31 天 / 14（只有最后一个没变） | §1.1、§1.2、§2④、§2⑤ 第四栏 |
| **3** | 「**最早出事的日子**」 | 改成「最早交不出去的那一张」；真正的越线日（第 1 天）降到页脚 | §1.1 大数三、三个按钮的 N |
| **4** | 「**现金比目标少 2 亿，三个原因：1.17 / 0.23 / 0.003**」 | **三条相加 = 1.408 ≠ 2**（`residualPct: 12`）。版面必须多画一条「其余 0.59 亿分不到具体原因」 | §1.1 归因区、「加起来对得上账」那个入口 |
| **5** | §2⑤ 三栏的「多久见效 / 代价 / 风险」挂到卡点上 | `mitigationLibrary` 的 7 个因子类与 `candidates[].lever.factorName` 的取值域**只有「瓶颈工序」一个词重合**，要一张映射表 | §2⑤ 三栏、§2④「有 N 种改法」 |
| **6** | §2① 八条事件模板 | 后端只有 11 类，且**「涨价」「停线」「断供」三件事没有对应 kind**。而「碳酸锂涨价」正是 §1.2 / §2③ 的头号例子 | §1.2 页头、§2①、§2③ 的示例全要换 |
| **7** | §2⑤「什么都不做」的「晚 N 天」 | 是 `hash(so) mod 3` 的估算，必须带「估」角标，且 8 基地同为 4 天这件事要说 | §2⑤ 第四栏、§2④ 时间线 |

---

### 3.D · 补充：我实测到的一条 CEO / 架构师都没点名的事实（决定入场券的工程量）

> **CEO 的结论**：「这台机器不读我的输入。」
> **我今天的实测**：**机器读了输入，输入也确实扩散了 —— 只是它扩散到的 12 个变量里，
> 一个都不是财务的驱动量。**

**取证（纯读，BFS 全图 42 条边，带两个金丝雀）**：

```
loadIndex 的可达闭包（12 个）：
  inboundExpeditePressure, utilPressure, windowSqueeze, transferPressure,
  queuePressure, releasePressure, loadPressure, inspectBacklog,
  feedPressure, repairBacklog, defectPressure, handlingBacklog
costPressure 在闭包内？   false
demandPressure 在闭包内？ false

金丝雀①：priceShock 的闭包含 costPressure → true
          （闭包 = costPressure, receivablePressure, collectionPressure, overduePressure, deliveryHoldRisk）
金丝雀②：图非空 —— 源变量 20 个 / 边 42 条

全图 20 个源变量里，能走到 costPressure 的：**只有 1 个 —— priceShock**
```

而 `finance_world_projection` 的驱动逐字是：
`lines[销售成本].driver = "Order.costPressure"`、
`lines[毛利].driver = "Order.costPressure（经 收入Δ − 成本Δ 传导）"`、
`lines[收入].driver = ""`。

⇒ **CEO 把常州 `loadIndex` 设成 100，世界态真的变了（12 个变量在动），
但这 12 个里没有一个是 `costPressure`，所以钱一分不动。**
这**不是**「引擎不读输入」，是**「这条输入到钱之间，图上没有路」**。

**这个区分值 2 人周**：
- 若是「引擎不读输入」⇒ 要改 `SolverContext` + 61 个求解器的装载（架构师 A1，1.5 人周起）；
- 若是「图上没路」⇒ **加一条边就够了**（`seed.ts` 一条 `PropagationRule`，**0.2 人周**）。

**业务上这条边完全成立**：产能利用率压力 ↑ ⇒ 加班 / 外协 / 换型损失 ⇒ 成本压力 ↑。
即 `utilPressure → costPressure`。而 `loadIndex → utilPressure` 这条边**今天已经在**（delay 1）。

> ⇒ **CEO 红线 1 的验收物（「两张截图上两个不同的数字」）
> 我判定为 0.2 人周，不是 2 周。**
> ⚠️ 但**必须同时说清**：加了这条边，两个数会不同，**但两个数都还是不可用的量级**
> （今天毛利 `projected = -3272.25`，`deltaPct = -2852%`）。
> 让数字**可用**要 W0b（量纲表，2.0 人周）——**那才是 CEO 批的那 2 周该买的东西。**
> **我建议两件一起做，合计 2.2 人周**，验收物同时满足红线 1 与「屏上每个钱都带单位」。

---

## §4 · 我要问 UX 的问题

| # | 我看不出它要什么数 | 请补 |
|---|---|---|
| **Q1** | §1.1「**常州占 13.7 亿（最大）**」 | 13.7 是哪个量？常州整卡 `exposure.revenueYi = 35.54`；`customers[0]`（广汽埃安）= 13.43。**你要的是「常州这个基地的敞口」还是「常州最大的那个客户」？** 两个数差 2.6 倍，取数路径完全不同 |
| **Q2** | §1.1 顶行「**7 张单要晚**」与三大数里「**7 张单 · 4 家客户**」 | 这两个 7 是同一个集合吗？后端有**三个**不同的「要晚的单」集合：`doNothing.delay.orders`（今天去重 53）、`otd.rows` 里 `onTime:false` 的、`affected_orders.problems[0].orderCount`（60）。**请指定一个**，否则三处会各算各的 |
| **Q3** | §2⑤ 第四栏表头「**代价 见下**」，而前三栏表头是「**代价 极高/中/高**」 | 同一行表头在四栏里是两个量纲（枚举档 vs 金额+天数）。**是否同意第四栏表头改成「不做的后果」？** |
| **Q4** | §2①「**还有 20 件事这里试不了 ▸**」 | **「一件事」的粒度是什么？** 后端三个候选分母：11 个业务事件 / 40 个状态变量 / 20 个产能因子。**没有一个等于 20**。请给「一件事」的定义，我才能算出这个名单 |
| **Q5** | §2③「**主要是常州停线那两天**」 | 这句话要的是「哪条扰动贡献最大」。**你要的是金额贡献占比，还是只要一个名字？** 只要名字 ⇒ 前端拿用户输入的第一条事件即可（0 人周）；要占比 ⇒ 1.5 人周 + A1 |
| **Q6** | §2④「**↑ 这一天之前动手，后面七张全躲得过**」 | 「动手」指哪一个动作？是 ⑤ 的三个方案之一，还是泛指？**若是泛指，这句话没有可计算的定义**；若指某一个方案，那它依赖 §3.B-1（2.5 人周） |
| **Q7** | §1.1 三个按钮的「还剩 N 天」 | §3-② 证明按 `crossDay` 口径今天是 **0 天（今天就得动）**，按 `dueDay` 口径是 13 天。**三个按钮你要哪个口径？** 这决定 W2 的取数优先级 |
| **Q8** | §1.5「**今天出错的 0 件**」 | 「出错」指什么？① Action 执行失败（`/actions/metrics.stability.failureRate` 今天有，0）② HTTP 5xx ③ 求解器 `ok:false`。**①今天 0 人周就能给，②③要 1.5 人周落审计表** |
| **Q9** | §2⑤「候选只有 1 条时仍然摆两栏」 | 今天 4 个有候选的卡点，候选数分别是 2/2/4/4，**没有 1 条的情形**。这条规则是为将来写的还是我漏了某个入口？ |

---

## §5 · 我要问数据经理的（接口通但数据空 / 数不对）

| # | 接口 | 我实测到的 | 归他判 |
|---|---|---|---|
| **D1** | `GET /a/v1/action-drafts` | **200，0 条**。而 §1.5 要「待你批的 3 件」、§2⑤ 要〔就这么办〕落一份待批动作 | 种子里该不该有待批 Action |
| **D2** | `GET /a/v1/rules` | 29 条**全部 `PUBLISHED`**，`DRAFT`/待审 **0 条**。而 §1.5 要「规则改动待审 1 条」 | 同上 |
| **D3** | `risk_timeline.cards[]` | 今天 **8 张卡：江门 邯郸 自贡 信阳 常州 枣庄 金华 成都**。**没有合肥、没有武汉、没有厦门** —— 而 COO 的决策窗口引的是「合肥卡」，`affected_orders.rows[0].risks` 里又出现「武汉」「厦门」 | 基地清单为何两处不一致 |
| **D4** | `chain_impediments` | 昨天 17 条（top severity 67），**今天 18 条（top 100, 100）**，连跑 3 次稳定 | 是种子变了还是判据变了 |
| **D5** | `doNothing.catchUp`（常州） | `shortfall` 昨天 55,768 → **今天 156,354**（2.8×），`days` 264 → **740.31**。`freeDaily` 没变（211.2） | 分子为何变 |
| **D6** | `cards[].events[].desc` | 逐字「SO-900269·广汽埃安 交付 **2941 万套**到期」，而同一对象 `qty: 2941`（单位「套」，见 `exposure.units = {qty:"套"}`）| **「万套」还是「套」** —— 差 10,000 倍，且这句话要原样上屏 |
| **D7** | `gap_attribution(cash)` | 三条叶子合计 **1.408**，而 `rootMetric.gap = 2`，`residualPct = 12` | 0.59 亿的残差是真残差还是漏了因子 |
| **D8** | `doNothing.delay` | **8 个基地 `worstDays` 全部 = 4** | 一个 hash 出来的量在 8 个基地取同值，正常吗 |
| **D9** | `catchUp.status = "EMPTY"` | 江门 / 自贡两个基地 | 是真的没缺口，还是没数 |
| **D10** | `metric_rollup` | 只回 6 条，**不含「计划达成率」**。而 `/v/dash` 屏上有「计划达成率 0.91% · 差 8.7pt」 | 那张卡的数从哪来 |
| **D11** | `finance_world_projection` | 毛利 `projected` 三轮实测三个数：架构师 −13587 / CEO −1532 / **我今天 −3272.25** | 它随什么变 |

---

## §6 · 我的风险提示

### 6.1 会打红既有测试的改动（预估范围）

| 改动 | 预估打红范围 | 依据 |
|---|---|---|
| **W0a 加一条 `utilPressure → costPressure` 传导边** | **中–高**。传导规则数从 42 → 43，凡断言「42 条」的金丝雀全红；且 tick 后的世界态数值全变 ⇒ 所有对 `costPressure`/`receivablePressure` 数值做快照断言的测试全红 | UX 稿附录自己就有一条 `delayTicks` 计数复验；架构师文里 `42 条` 出现 6 次 |
| **W0b 量纲表** | **高**。`finance-world.ts` 的 `basis.divisor` 从常量 100 换成查表 ⇒ 所有财务投影数值断言全红 | `basis.source` 今天是 `"DEFAULT_DECLARED"`，改后变别的值，凡断言这个串的都红 |
| **W2 `decisionWindow` 新字段** | **低**。纯新增字段，zod schema 若用 `.strict()` 则契约测试会红 | 需先确认 `risk_timeline` 输出 schema 是否 strict |
| **W8b 新增 3 类 drill 事件** | **中**。`DRILL_EVENT_SPECS` 从 11 → 14，`GET /sim/drill/catalog` 的计数断言红；drill 结论条数（今天 480 量级）会变 | 架构师实测 `specs 11` |
| **W1 首屏 12 → 3 个大数** | **中**。前端快照/可见文本计数类测试 | UX 稿附录逐屏字数基线表本身就是一组会红的断言 |
| **W15 tick 回包投影** | **高**。回包结构改变 ⇒ 沙盘全域前端测试 + 契约测试 | 回包今天 2.02 MB，字段裁剪影响面大 |

> ⚠️ **一条必须先做的功课**：以上「会红」全是**我按结构推的，没有真跑测试**。
> 照铁律 0.5，**派单前必须先跑一次 `pnpm -r test` 拿到基线**，
> 否则会重演「拿结构推断当测量」的老病。**我不建议任何人拿这张表当排期依据，
> 它只是「要留多少调试余量」的粗估。**

### 6.2 不可逆 / 影响面大的

| # | 改动 | 为什么危险 |
|---|---|---|
| **1** | **W0a 加传导边** | 42 条传导规则是**全系统唯一的因果知识来源**（架构师原话），且是 `seed.ts` 手写的。加一条边等于**改公理**：它同时改变 tick 世界态、drill 的 470 条阈值扫描结论、`chain_impediments` 的判定、财务投影。**一条边动，四个下游全动。** 建议：加边的同一个 commit 里把四个下游的基线数各截一份留档 |
| **2** | **W0b 量纲表** | 一旦声明了 `stateVar → unit`，**屏上所有金额的含义就被这张表锁死了**。表定错了比没有表更糟 —— 今天至少大家知道那个数不能信，定了表之后它看起来就能信了 |
| **3** | **W5b 落审计表** | 新增表 ⇒ 要同时改 `migrations/*.sql` + `repo/pg.ts` + `repo/memory.ts` + `repo.ts` 接口（`CLAUDE.md` 明列）。**这是本轮唯一一个动 schema 的包**，且它只服务于 §1.5 的两个计数 |
| **4** | **W8c 事件清单存储** | 若给 drill 事件加存储，就等于**造了第三套输入词表的持久化**（今天已有 `Perturbation` 一套）。**我强烈建议走架构师 A2 的转换器，不要新增存储** |

### 6.3 我不建议做、但 COO 会要的（附替代方案）

| # | COO 会要的 | 我不建议的理由 | 我的替代方案 |
|---|---|---|---|
| **1** | §2⑤ **「保住这几张单」** | 2.5 人周 + 依赖 A1（1.5）= **4 人周，占 5 周预算的 80%**，而它只是四栏里的一个块。且做完了那份订单明细仍然建立在 `hash(so) mod 3` 的延误天数上 | **第一版删掉这一块。** 前三栏只出「名字 / 多久见效 / 代价 / 风险」四行（**0 后端改动**），第四栏照常出。四栏的决策价值在「做 vs 不做」的对照，不在每栏的订单明细 |
| **2** | §2④ **「第 14 天之前动手，后面七张全躲得过」** | 依赖上一条，再加 2 人周。而这句话是**最容易被当真、也最容易被证伪**的一句 —— 一旦某张单动了手还是晚了，整屏信任归零 | 改成**不带承诺的写法**：「第 14 天是最早到期的那一张；后面七张在第 22–30 天」。**陈述事实，不做反事实承诺。** 0 人周 |
| **3** | §1.5 **「今天出错的 / 今天登录的人」** | 1.5 人周 + 唯一一个动 schema 的包，只为两个计数；且这两个数**对 §1.5 那一屏的目标（「不挡路」）零贡献** | **删掉这两格，六个计数变四个。** UX 稿自己写了「这一项的设计目标不是好用，是不挡路」。0 人周 |
| **4** | §2③ **三个金额搬到屏幕正中** | UX §6-6 自己已经判了「在这个数修好之前一天都不能上」，我复核**成立**（今天毛利 `projected = -3272.25`）。**先搬位置再修数，等于把「你公司在巨亏」放大到全屏** | **顺序反过来**：先 W0a + W0b（2.2 人周）让数可用，**再**搬位置（0.3 人周）。W10a 必须排在 W0b 之后，不许并行 |
| **5** | **把 ①–⑤ 五步全做完** | 12.9 人周落在 `views/sim/`，**全部押在红线 1（9/30）上**。红线 1 一判死，这 12.9 人周全废 | **先做 §2.4 那 5 人周**（0 行 `views/sim/`），**红线 1 过了再开沙盘的工**。这样最坏情况下沉没成本是 0 |
| **6** | **一次把 11 类事件全铺成 UI** | `payloadKeys` 有 5 种形状（number/string/required/optional/带 hint），一次全铺要写一个通用表单生成器 | **先铺 4 类**（`ORDER_RESCHEDULE` / `CAPACITY_LOSS` / `EQUIPMENT_FAILURE` / `FORECAST_BIAS`）—— 这 4 类**今天就能完整表达 UX 八条里的 4 条**，且 payload 全是 `number`，不需要生成器。0.3 人周而不是 0.5 |

### 6.4 一条给排期方的提醒（不是风险，是纪律）

**§0.2 那三条漂移不是偶然。** `17 处 / 31.1 亿 / 264 天 / 7 张单` 这类数
**全部是求解器对当前种子现算出来的**，一次 seed 改动就会变。
UX 稿把它们写进了**版面草图**（第几栏放什么），**这是对的**（草图就该有具体数）；
但**开工时必须逐条换成字段引用**，否则会长出一批「屏上写死 17，接口回 18」的僵尸常量
—— 而这类常量**类型系统一个都看不见**（`CLAUDE.md` 铁律 0.6 第 4 条正是这个形态）。

**建议写进每张派单的第一段**：
> 「本单版面草图里的每一个数（17 / 4 / 13 / 31.1 / 264 / 第 14 天 / 7 张 / 3 件 / 12 人）
> **都是 2026-08-27 那天的读数，不是常量**。开工第一件事是把它们逐条替换成回包字段路径，
> **替换不出来的那一个，就是这一单真正的缺口** —— 顶回来，别编一个数填进去。」

---

## 附 · 本轮取证的可复验命令

```bash
H='X-Debug-User: demo:usr_demo_admin:admin|planner|catalog_admin'; B=http://127.0.0.1:4001/a/v1
# ⚠ 本机 curl 必须带 --noproxy '*'

# 金丝雀（先跑，否则下面任何「没有」都不成立）
curl -s --noproxy '*' -o /dev/null -w '%{http_code}\n' -H "$H" "$B/me/workspace"                 # 200
curl -s --noproxy '*' -o /dev/null -w '%{http_code}\n' -H "$H" "$B/definitely-not-a-real-path"   # 404

# ① 卡点条数与候选（§0.2 漂移、§1.1、§2④）
curl -s --noproxy '*' -H "$H" -X POST -H 'Content-Type: application/json' \
  "$B/solvers/chain_impediments/invoke" -d '{"scope":{}}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s).data.impediments;
      console.log(a.length,'|',a.filter(x=>x.candidates.length).length,'|',a.map(x=>x.severity).join(','))})"
#   今日：18 | 4 | 100,100,34,29,21,20,17,12,9,8,7,7,6,5,4,1,1,0

# ② doNothing / crossDay / mitigationLibrary（§3-①②③ 全部三条特别评审）
curl -s --noproxy '*' -H "$H" -X POST -H 'Content-Type: application/json' \
  "$B/solvers/risk_timeline/invoke" -d '{"args":{"horizon":30}}' > /tmp/rt.json
node -e "const d=require('/tmp/rt.json').data;
  console.log('基地:',d.cards.map(c=>c.base).join(' '));
  console.log('crossDay:',d.cards.map(c=>c.base+'='+c.crossDay).join(' '));
  const cz=d.cards.find(c=>c.base==='常州');
  console.log('常州 allFactors:',JSON.stringify(cz.allFactors));
  console.log('常州 catchUp:',JSON.stringify(cz.doNothing.catchUp).slice(0,200));
  console.log('方案库类别:',Object.keys(d.mitigationLibrary).join(','));
  console.log('物料齐套:',JSON.stringify(d.mitigationLibrary['物料齐套']));"

# ③ 传导图 BFS —— loadIndex 够不到 costPressure（§3.D，含两个金丝雀）
curl -s --noproxy '*' -H "$H" "$B/sim/propagation-rules" > /tmp/pr.json
node -e "const a=require('/tmp/pr.json'); const g={};
  for(const r of a){(g[r.sourceStateVar]=g[r.sourceStateVar]||new Set()).add(r.targetStateVar);}
  const reach=s=>{const S=new Set([s]),q=[s];while(q.length){const x=q.shift();
    for(const y of (g[x]||[])) if(!S.has(y)){S.add(y);q.push(y);}} S.delete(s); return S;};
  console.log('loadIndex→costPressure?', reach('loadIndex').has('costPressure'));      // false
  console.log('金丝雀 priceShock→costPressure?', reach('priceShock').has('costPressure')); // true
  console.log('金丝雀 边数', a.length, '源变量', Object.keys(g).length);"                  // 42 / 20

# ④ 毛利归因是真 0（§1.1、§6-1 复核）
for m in gross_profit gm_rate cash ess_attain; do echo -n "$m "; \
  curl -s --noproxy '*' -H "$H" -X POST -H 'Content-Type: application/json' \
    "$B/solvers/gap_attribution/invoke" -d "{\"args\":{\"metricKey\":\"$m\"}}" \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s).data;
        console.log('levels',d.levels.length,'noGap',!!d.noGap,'gap',d.rootMetric.gap)})"; done
#   gross_profit 0/true · gm_rate 0/true · cash 2/false · ess_attain 3/false（后两条是金丝雀）

# ⑤ 事件模板只有 11 类，且没有「涨价」（§1.2①、§3.C-6）
curl -s --noproxy '*' -H "$H" "$B/sim/drill/catalog" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s).data||JSON.parse(s);
      console.log(d.specs.length); d.specs.forEach(x=>console.log(' ',x.kind,x.label))})"

# ⑥ 1.5 六个计数：四个有、两个 404（金丝雀 rules=200）
for p in action-drafts connections rules audit-logs login-events; do \
  printf '%-14s %s\n' "$p" "$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' -H "$H" "$B/$p")"; done
#   action-drafts 200 · connections 200 · rules 200 · audit-logs 404 · login-events 404

# ⑦ tick 回包体积（§2 W15）
curl -s --noproxy '*' -o /dev/null -w 'time=%{time_total}s size=%{size_download}B\n' \
  -H "$H" -X POST -H 'Content-Type: application/json' -d '{"n":1}' \
  "$B/sim/sessions/sims_demo_seed_world/tick"
#   今日：time=0.29s size=2020731B（架构师 08-27 测 1.13 MB）
```

---

## 附 2 · 本单范围声明

**🚦范围边界**：只新建 `docs/LOOP5-backend-review.md` 这一个文件。
`apps/**` / `packages/**` / `scripts/**` / 其它 `docs/**` **零改动**；
未 `git checkout` / `git commit` / `git push` / 切分支；
未碰另三位同时在写的 `LOOP5-coo-demands.md` / `LOOP5-ux-review.md` / `LOOP5-data-review.md`；
工作区那 10 个别人的未提交文件**原样未动**。

**本轮全部写操作 = 0**：所有 curl 均为 `GET` 或求解器 `invoke`（纯计算，不落库）。
**未创建推演会话、未 POST 任何扰动** —— 因为 `sims_demo_seed_world` 是共享的，
新建扰动会污染别人正在跑的测量。§3.D 那条结论**用纯读的 BFS 得到，不需要写**。
