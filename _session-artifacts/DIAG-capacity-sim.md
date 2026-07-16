# 产能推演/推演沙盘 根因诊断（滚动·待A/C真跑合并）

## Agent B（代码勘查·已回·read-only）——推翻"seed供需失衡"假设

**颠覆性发现：利用率2%/恒红 不来自 seed 供需比，来自展示层。**

### tick-UX（确定结论·不依赖真跑）
- 「推进 tick」= SandboxView.tsx:1016-1018 → onTick(:790-804) → 第794 `simTick(sessionId,1)` 每点+1。
- 端点 endpoints.ts:631-632 `simTick(sid,n=1)` body`{n}`；后端 app.ts:1412 `n=max(1,floor(body.n))`、:1426 `for i<n` 逐tick真传导、:1439 只回最终态。**后端本就支持 N 步**。
- 前端已有 `runTicks(n)`（SandboxView.tsx:867-892），AI指挥台「推进N tick」用之，parseSandboxIntent:536-549 已解析N、:541 clamp Math.min(50)。
- **改造=纯前端**：命令条加 `<input type=number>` days；onTick 改 `simTick(sid,days)`(方案A·1请求·时间轴只1点) 或 `runTicks(days)`(方案B·N请求·逐日时间轴有值·推荐)。后端无需加 steps。唯一"后端才更好"=让 app.ts:1439 回逐tick序列。

### 利用率"恒2%"真因（非供需·是展示层）
- 沙盘"利用率"= `cert.dims.knowledge`（SandboxView.tsx:302 雷达维/:401 评估清单）。
- 定义 certification.ts:131-133 `knowledge=pct(consumedFields,totalFields)` = **schema覆盖率**（规则消费字段/本体总字段），**与产能利用率无关**。电池本体~150+字段、仅3条传导规则→天然~2%。
- "恒"：cert 只 init 算一次（SandboxView.tsx:762-766），onTick 不重算 → 推进多少天都不变。
- **=严重误标**：叫"利用率"实为schema覆盖率。

### "恒红"真因（非供需·是展示层量纲错配）
- 节点着色 heatColor(v,threshold=70) SandboxView.tsx:82-86；aggregate=对象所有stateVar均值:73-78。
- demo传导规则 seed.ts:287-339 状态变量量纲严重错配：Model.totalDemand≈百万(电芯)/Line.utilization≈92/Base.loadIndex累加到百万/Order.demandDelta≈0.3。大数节点 aggregate 恒≥70→**恒红·与tick无关**。
- 传导 combine:"sum"+decay:null（seed.ts:300/316/333），propagateTick 上态克隆再累加（propagation.ts:83/107）→ loadIndex **单调增无衰减**→只涨不落(无涨落)。

### seed供需真值（B的量纲核算）
- 常州日产能 capacityDaily≈60,000-64,000电芯/日（battery.ts:1780 min(formation:1747,aging:1748)；channels 1710 randInt600-780×channelOutput 1711 80-95）。
- 常州日需求≈84,000电芯/日（ORDER_QTY_CELLS_PER_LOT=40000 :92；HTML_ORDERS qty6-18万套 :52-77 ×40000；~8单/6周42天）。
- **利用率≈需求/产能≈90-130%（合理·高负荷=瓶颈基地叙事）**。battery.ts:82-92 注释白纸黑字：×40000 是为修"修前 qty(6-18)直对capacityDaily(6万)→利用率≈0/2% bug"。**故当前seed供需比OK，非2%来源。**
- Base.util（battery.ts:1571 0.62-0.97）独立随机·与产能无因果。

### 修复分层（B建议）
- **层一（真因·非seed）**：① SandboxView.tsx:73-86 aggregate/heatColor 需先把stateVar归一到0-100再着色，或引入真"利用率比值"派生属性(日需求/日产能)按它着色；② 传导加decay/clamp（seed.ts:300/316/333全null）→有升有降；③ SandboxView.tsx:302/401"利用率"正名或改真利用率。
- **层二（若坚持seed分化各基地红绿·守R6确定性乘子非rng）**：battery.ts:1710-1711/1728/1747-1748 产能生成按baseId乘固定映射表；示例 {常州:0.75,江门:0.80,成都:1.15,厦门:1.25}→常州112%红/成都72%绿。瓶颈基地已在 BATTERY_SOLVER_PARAMS.bottleneck.primary(:127-140)定常州/江门。逐日波动仍需层一decay。

### 测试影响
- 改产能常量/订单量→现有断言基本不破（synthetic.test.ts SY1:17-46自指deep-equal确定性守门·不pin产能值；SY2:142-183从同源props重算期望）。
- **规避**：勿动 utilization/OEE/良率时序均值（battery.ts:1280 util mean92 / OEE 1686-1706）→否则 solvers.test.ts:211-314 risk_timeline/bottleneck"常州物料齐套"基线断言破。risk-rules-agents.test.ts:109 是字符串断言(安全)。
- **只调产能常量/订单量/per-base产能乘子（无测试pin其值）**。

## Agent A（真跑·已回·worktree 4011/4111/5211·真端点+真浏览器）——假推演坐实·verdict(c)

**核心裁决：数据作假成立·假推演坐实·两侧同源(合成Line.utilization≈92)不同变换·都不基于真实供需。**

### A侧 张力红 = 合成序列驱动·伪LIVE
- 张力公式 risk.ts:183 `liveTightness("瓶颈工序")=round(avg×0.9+8)`（utilK=0.9/utilBase=8 battery.ts:143）。
- 输入 `Line.utilization`=合成扁平时序 util:line(mean92·全基地同种子 battery.ts:1280→物化:1306)。真端点 Line/LINE-changzhou utilization=93.0886 provenance TS_AGGREGATE。
- 精确对账：round(93.0886×0.9+8)=92 == 常州卡tightness 92。真浏览器常州详情 30/30日条全红#E0626C。
- 代表因子恒=瓶颈工序（risk.ts:428-437 取真张力最高·bottleneck_matrix 瓶颈工序全12基地89-92恒最高）→每基地都红。
- **铁证**：系统自有真供需模型 demandCapacityTightness(读DemandSegment/SopVersion真预测vs产能·risk.ts:144-162)对常州只算~65(<阈值85·本不该红)，但liveTightness先走lines-utilization分支(risk.ts:179-184)→真供需信号根本没被采用。改订单/需求红条纹丝不动=假推演定义。
- "LIVE"标签骗人：卡自报dataMode:LIVE(risk.ts:481)前端据此染红(RiskBoardView.tsx:133-138)；顶层banner却诚实标合成。DEFAKE已删旧hash·换成读合成物化序列(值是算的·源是合成扁平常数)。

### B侧 利用率2%/demandDelta0/需求负载0 = 真但退化·分母错+单位混
- 沙盘KPI(SandboxView.tsx:1003)=各stateVar在**全部575对象**取均值。
- utilization仅72对象有值(60 Process~0.95分数+12 Line~92百分·**单位混**)→(1104+57)/575=2.02→UI"2.0"。非真实利用率低·是稀释。
- demandDelta仅24 Order有值/575→0.01→"0.0"；demandLoad 0对象带值(纯传导·无种子源·未tick恒0)。
- seed真值(真端点)：常州capacityDaily=61698电芯/日=0.4192万套/周；网络需求DemandSegmentΣp50=132万套·SopVersionΣdemand507/supply480(load≈1.06)。"2%"根本不是demand/capacity。

### 修复锚点(真跑给·6处)
1. **battery.ts:1280 util:line mean92扁平=root**：每线钉~92%全基地同均值=全红直源。应随基地/真订单负载变或下调绑真需求。
2. risk.ts:179-184 liveTightness瓶颈工序分支：勿纯建在与需求无关Line.utilization·需求因子应优先取demandCapacityTightness。
3. risk.ts:428-437 代表因子选择：瓶颈工序因合成92恒最高→每卡红·应排除合成源因子。
4. risk.ts:481+service.ts:1967-1971 isSyntheticDecision：卡输入是合成物化时dataMode应继承SYNTHETIC非自报LIVE(顶层SYNTHETIC对·缺下沉到卡/因子级)。
5. SandboxView.tsx:1003 沙盘KPI均值：每stateVar只在携带该变量对象上取均值(非÷575)或限定nodeType。
6. 单位统一：Line.utilization(百分~92 battery.ts:1280)vs Process.utilization(分数~0.95 battery.ts:1690)聚合前统一量纲。

### A/B 交叉核对
- A的"利用率2%"=沙盘KPI stateVar均值(SandboxView.tsx:1003·真跑所见)；B的"利用率2%"=就绪雷达cert.knowledge=schema覆盖率(SandboxView.tsx:302/401)。**两个不同的~2%都在页上**·A的是真跑所见KPI头条·B的是就绪卡雷达维。都需正名。

## Agent C（真跑·已回·worktree 4013/4113/5213·穷尽点击+6截图）——沙盘页不作假·分支是布局bug

**沙盘页(SandboxView /v/sim-sandbox)裁决：不作假·无一前端写死数组·每按钮功能性均WORK。**
- 按钮全WORK真跑对账：tick(200·curTick0→1·全局态3339.5→9617.1真变)/checkpoint(201)/adopt(201真产R4 action-draft)/DAG切换/节点lineage(200)/AI台真发N次tick/6折叠卡全有真内容。
- **分支根因=布局非功能**：checkpoint201→branch201→compare200全绿·SimComparePanel真渲染真值(tick0 A3339.5/B9617.1/差+6277.6)·但boundingBox.y=**1652px首屏外**(视口1000)。对比卡在右栏heroSide折叠栈**倒数第二**(SandboxView.tsx:1196-1209)·排在超高就绪认证卡(26项)+5折叠卡后·分支按钮在左上命令条(1022)→结果甩到右下1652px·用户不下滚→主观"点了没反应"。**真实可达性缺陷·非功能bug**。
- 数据真伪逐控件:26状态变量(cert.worldCompleteness.entering真派生)/缺件4(cert.gaps真诚实)/基地卡(常州util0.83→83%·oee0.76→76%·bottleneck模组·gwh36.7逐值对后端一致)/雷达(DERIVE自cert)/风险TOP3(dataMode=SYNTHETIC诚实标·值真求解器输出·峰98不染决策红=KILL-MOCK-RED正确)/Schema派生14条(真derivedProperties公式)。**全局态3339.5=跨异质stateVar混算原始量级(Model.totalDemand达32万)→远超注释宣称0-100·恒过阈值70恒红·口径设计弱非造假**。
- 4卡场景:雷达=决策可信度体检/风险TOP3=哪基地工序张力高(合成态诚实标估算)/Schema=口径透明可审计/运行台=对话式深挖。
- 瓶颈/方案:基地卡有瓶颈工序名+张力·但量化bottleneck_matrix+mitigation在风险看板页本页无;方案对比(分支→SimComparePanel)本页有但被布局埋1652px够不着。
- C修复锚点:分支卡移出右栏栈底(1196-1209)到左主区+onBranch成功scrollIntoView(817-832);globalKpi(743-747)归一或分列勿冒称0-100;4卡(1143/1163/1177/1184)title补"解决什么运营问题"+默认展开风险TOP3;加"深挖瓶颈/方案→风险看板"跳链。

## ★★ A vs C 调和（关键·不和稀泥）
两页两裁决不矛盾·查的是不同东西:
- **"前端写死伪造数组冒充后端"=没有**(A+C都确认:非写死假数组·是合成数据真派生+诚实标注)。
- **"推演基于真实供需"=没做到(真问题·A坐实)**:风险看板的红完全建在合成扁平util序列(mean92全基地同·battery.ts:1280)·系统自有真供需模型demandCapacityTightness(常州~65本不该红)却被risk.ts:179-184绕过→红对真实需求不敏感=假推演。
- **沙盘页"分支失效"=布局bug非功能坏**(C:后端全绿·面板真渲染真值·埋在1652px)。
- **沙盘页"数据作假"=基本不成立**(C:逐值对后端一致)·真毛病=口径设计(跨异质变量混算无量纲大数)+信息架构没翻译成运营语言(4卡默认全折叠·技术黑话·无量纲)。
调和一句话:**没伪造数据·但"红/张力"是合成扁平常数驱动、绕过了真供需模型=假推演;沙盘数据诚实但口径/布局/信息架构差到让诚实数据看着又假又坏。**

## ═══ WO 清单（诊断→施工·待用户GO后写发）═══
- **P0-A `WO-SIM-REALDEMAND`**(假推演根治·数据可信):risk.ts:179-184瓶颈因子优先取demandCapacityTightness(真DemandSegment/SopVersion vs产能)·别纯建合成util;risk.ts:428-437代表因子排除合成源;risk.ts:481+service.ts:1967-71诚实位下沉到卡/因子级(合成→别自报LIVE)。→红对真需求敏感·不再全基地恒红。
- **P0-B `WO-SEED-DEMAND-VARY`**(种子分化):battery.ts:1280 util:line扁平mean92→按基地/真订单负载分化(守R6确定性乘子非rng·瓶颈基地已定BATTERY_SOLVER_PARAMS:127-140);传导加decay/clamp(seed.ts:300/316/333全null)→有涨落。测试影响:只调产能常量/订单量/per-base乘子(无测试pin其值)·勿动util/OEE时序均值(否则solvers.test.ts:211-314破)。
- **P1-C `WO-SANDBOX-KPI-FIX`**(口径可读):SandboxView.tsx:1003 KPI均值按携带该变量对象算(非÷575)+单位统一(Line百分vs Process分数)+"利用率"正名;743-747 globalKpi归一或分列勿冒称0-100。
- **P1-D `WO-SIM-TICK-DAYS`**(tick改天数):纯前端·命令条加数字输入·onTick调runTicks(days)(SandboxView.tsx:867-892现成)·后端app.ts:1426已支持N步不动。
- **P1-E `WO-SANDBOX-BRANCH-VISIBLE`**(分支可达):对比卡移出右栏栈底(1196-1209)到左主区/右栏顶+onBranch成功scrollIntoView(817-832)。
- **P1-F `WO-WHATIF-SCOPE`**(跳转带基地真生效·补G-3):deriveBaseSnapshot按presetContext.subject裁剪世界(现用全量cfg=摆设);核实"开始推演"(zh.sim.run)按钮接openWhatIf(疑另一按钮不带whatif参)。
- **P2-G `WO-CAPACITY-MODEL-DIM`**(型号维度·用户明确要):产能推演加电池型号维度(型号切片/按型号分析/推演/卡点/方案)·后端capacity_forecast已modelId-keyed(catalog.ts:86)+Model一等类型+型号可产基地网络(catalog.ts:33)现成·前端补型号选择+型号级瓶颈/方案。
- **P2-H `WO-OPS-FLOW`**(运营负责人一条龙):瓶颈(风险看板)→推演(沙盘)→方案对比→采纳串成一流;4卡加"解决什么"场景语+默认展开风险TOP3+跨页导引。

## 我已代码确认（前几轮）
- 跳转：openWhatIf(whatif.ts)编码subject→URL·沙盘SandboxView:972-982渲染徽章+注入scope；但(a)"开始推演"=zh.sim.run 无tsx消费点（疑另一按钮不带whatif参）(b)世界=deriveBaseSnapshot(全量cfg)未按基地裁剪=G-3 presetContext未真生效(摆设)。
- 型号维度：后端有（capacity_forecast solver按modelId·catalog.ts:86；Model一等类型graphmeta;型号可产基地网络catalog.ts:33;Model.totalDemand;型号×产线认证;BOM）；前端产能推演(风险看板/v/risk)纯基地视角·无型号切片=真功能缺口。
- 瓶颈/方案在RiskBoardView(风险看板)·推演/对比在SandboxView(沙盘)·分裂两页；方案对比=分支→SimComparePanel而分支失效→路径断。
