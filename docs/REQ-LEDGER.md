# REQ-LEDGER · 需求溯源台账（单一权威·反代理·v3 穷尽227条）

> **为什么有这份**：审核方反复"拿能测绿的小问题冒充满足真要求"（见 `SELF-AUDIT-…md`），且状态散在 prose + 任务列表口径不一。本台账=**需求状态唯一权威来源**。
> **v3 更新**：经 workflow 穷尽 227 条用户消息（74 实质需求→**31 主题 R1–R31**），证明 v1 的 7 行、v2 的 R8-R12 仍不全。本版重建为完整 R1–R31 + 真核实状态。
> **铁律**：①prose 与台账冲突→**以台账为准**。②**永不在"代理满足"上标 🟢真闭**——只用户动作证据才真闭。③状态变化回写此处。

## 状态图例
| 标 | 含义 | 凭据 |
|---|---|---|
| 🟢 真闭 | 真目标达成·有**用户动作证据** | 截图/真响应/亲手走通 |
| ✅ 已核发/已建 | dev 交付经审核(代码+证据)闭 | 核发 doc/evidence |
| 🟠 真验中·钉断点 | 实跑验证中·已钉真断点 | 真响应 |
| 🔵 设计交付·待建 | 施工单在·待 dev 建+复验(**≠真闭**) | doc 链接 |
| ◐ 大部建·有缺 | 主体在·有真缺口/部分 | file 证据 |
| 🟡 代理验证·未真闭 | 测试/门绿·无用户动作证据 | 仅测试 |
| ❓ 未核实 | 未对账·**不准猜色** | 待真验 |
| 🔴 未建/未达 | 没建 or 招牌未达 | — |

## 反代理 DoD 三问（每次声明完成硬过）
①这是你原话目标吗 ②证据是用户体验还是代理指标 ③有没有把难目标换成易子问题再冒充。**只测试绿→强制🟡不准🟢。**

## §1 完整需求台账 R1–R31（穷尽227条·真核实状态）
> 状态来源：workflow 5-agent 真核实(landed/可信溯源/R9-12/批次) + 审核方 option A 真跑 + 既有核发。未经本会话核实的标 ❓。

| R | 主题（L#） | 状态 | 证据/备注 |
|---|---|---|---|
| R1 | 100%零遗漏闭环+反遗漏机制(312/388/4046/9277) | 🟠 本台账即应对 | 本ledger+穷尽227 是这条的执行 |
| R2 | 单一收口入口+提示词+链接派单(357/862/5939) | ◐ | START-HERE 在·待并入新 WO；DISPATCH-MANIFEST 待出 |
| R3 | 未完成项独立 HANDOFF(367/1527) | ❓ | 多份 HANDOFF 在·未逐一对账 |
| R4 | ModelingPage 本体从源数据长出·根因非补丁(1396/2128) | 🟠 | option A 实证 derive→publish→materialize 真通(18对象)·但 solver 卡 B3 |
| R5 | 三板块对齐HTML母版像素级+主题开关(1556/3317) | ◐ | 母版三板块外壳大部·像素打折(chrome缺·竞品原图不在仓库) |
| R6 | 设计与已有后端融合非只前端(1642/9241) | ❓ | 原则·未单独核 |
| **R7** | **可信溯源4件套 U3-U6(1650/4294)** | **✅ 大部建(轨N `8567ca0`/`6412476`)** | **U3下钻回退`OrderChainView:142`/U4规则悬停谁设定`RuleRef:54-65`/U6风险详情`RiskPopover`=BUILT；U5数据溯源◐(order-chain仅annotation非live lineage)。L4294说"0提交"后被轨N接了** |
| R8 | 假推演大扫除(不止洛阳)(1681/7881/8438) | ◐ | genuine-sim门+FORECAST-SIM根治risk·但"全类扫"未穷尽核 |
| R9 | 1:1复刻竞品多页平台术语真后端(2249/4947) | ◐ 大部建 | 项目~90%/规划~80%/驾驶舱壳~70%·多份含后端对照doc·像素保真打折 |
| R10 | 多租户from开源框架真数据(5991/6037) | ◐ | >1租户真立(电池+logi)·**但logi数据=合成模板非真实框架DATA**(借的是CP-SAT方法) |
| R11 | 亲手真跑建本体+全系统真测(4947/5049/6602) | 🟠 | option A 即此(部分)·全系统全量真测未做 |
| R12-old | retire BaseFdeTest+无LLM降级UX(5049/5170) | ◐ | BaseFdeTest运行态·无LLM有/derive确定性(B1前端不自动降级) |
| R13 | demo Kimi端到端+独立复验(10033) | ✅ | 真Kimi SCENE-B 验过(前序核发) |
| R14 | 开源框架借鉴全交付(G-5/G-12)(6037/6078) | ◐ | G-12优化融合last-mile闭·G-5非电池视图部分(同R10) |
| **R15** | **统一资源模型:规则库含约束·求解器是MCP一种·wf/agent/skill真引用规则与MCP(6103-6337)** | 🟢 **前端收口闭** | RESOURCE-REF(`eee4cd6`·审核核发)：AgentsPage 规则绑定自由文本 bug→**库 picker**(RuleRefSelect)·SkillsPage 加规则引用+MCP 引用两区·MCP 页内置求解器(46 工具 mcp__solvers__*)。**闭环真跑**：agent+skill 勾 K01+发布→`rules/{K01}/references` 列二者为引用方(count=2·via reported)——前端勾的码真进后端引用图(非装饰)·你原话"看着有实际没关联"闭。C4 引用图 curl + C5/C6 真浏览器像素级(截图 rr-c5/c6)。closure `REVIEW-RESOURCE-REF-closure.md` |
| **R16** | **agent资产广度+每个需LLM入口预设场景配置(6229)** | ◐ | SCENE-C铺5场景agent(landed)·但"资产广度"质疑+全入口预配体系未闭 |
| R17 | 二级页普遍缺回退(1650/6229/6337) | 🟡 | 普查已做·统一 `DrillBack` 组件替代手搓·死路页已补清单：对象360(o360-back)/任务详情(task-back)/风险看板(focus态)/地理地图(focus态)/季度滚动(focus态)/本体图谱(focus态)/来源系统总览/发育驾驶舱/字段核对(换硬编码Link)·OrderChain迁DrillBack·门(typecheck/build)+测试绿(green→red→green自证)·**待用户亲手走一遍真闭** |
| R18 | 逐源真对象数归因+真连接器接入臂(7066/7134) | ◐ | BUILDER-ROLE逐源归因(landed PASS)·真接入臂=合成单源(option A证真上传臂在但demo不走) |
| R19 | 1C规则文档抽取解析率+异步化(7134/7939) | 🟢 **闭** | 1C-PARSE(`ab61e2a`·审核核发)：强约束抽取 prompt 提解析率 + `extractProgress` 进度可视(前端进度条真浏览器像素级实拍 3/4+失败1·`rd-c7-progress.png`) + Anthropic 路有界纠错重试(anthropic.test.ts 3 测)。C1-C5 确定性单测+grep 验·C7 进度条实拍·C6 零新增回归。诚实：LLM 活取端到端受环境无 LLM 限制·抽取逻辑由 ScriptedLlm 单测(ruledocs.test.ts 真路由)覆盖。closure `REVIEW-1C-PARSE-closure.md` |
| R20 | QOS Path B终答流式+逐字流实拍(7634/8215) | ✅ | WO-Q1增量2/3 真Kimi验(前序) |
| **R21** | **ontology文件过大优化(markdown非YAML)(4406)** | ❓ | 未核是否加§0.5快查索引 |
| **R22** | **深色字→浅色对比度(8438②)** | 🟢 **闭** | CONTRAST-FIX(`49bbdcc`·审核核发)：DAG `.nodeKind`副行+两处`.legend` var(--muted2)#67737f(暗)→var(--muted)#9aa8b6(亮·WCAG AA≈6.3:1)。C7 真浏览器计算色实拍 `.nodeKind fill=rgb(154,168,182)`=var(--muted)(非旧暗色)·主标签/状态色未动·门绿。closure `REVIEW-CONTRAST-FIX-closure.md` |
| R23 | 场景入口预设配置(规划体检为例)(8438③/8763) | ✅ | SCENE-A/B/C/D landed+门(前序核发) |
| **R24** | **图谱多模块融合/分散(基于本体建模+切片实时图谱)(8847)** | ◐ | GRAPH-1/2/3/4 landed·但**GRAPH-3/4有CONCERN(见§3)** |
| **R25** | **导航重组+销售预测多维时序+沙盘归并+隔离区价值(8880)** | ✅ 大部 | 导航重组✅+沙盘并入推演✅+隔离区诚实空态✅(NAV/QUARANTINE landed)·销售预测✅(=R同FORECAST) |
| R26 | 对标Maven差距+成熟PRD含pipeline/合成改造(9133/9241) | ◐ | Maven分析docs在·PRD是否显含data pipeline+合成改造未确认 |
| **R27** | **运营/合规/商业化:灾备/A/B实验/外部审计融合单(10341/10393)** | ◐ | A/B实验=EXPERIMENT landed·**灾备备份/外部审计对接未建** |
| R28 | 复刻Maven先设计:模拟独有问题虚拟跑全链(10831/10978) | ✅ | 5批Maven问题+CEO10问+接线图(本会话+前序) |
| R29 | CEO 10问数据管线接线全图(11032) | ✅ | DESIGN-CEO-10q-data-pipeline-wiring(本会话) |
| **R30** | **连接器改上传+源数据入库前端可见+求解器/规则预部署+本体基于源数据+模拟真实业务全流程(11077)** | 🟢 **B3+透明双闭** | ①**源数据前端可见**：SOURCE-TRANSPARENCY(`cd90287`·审核核发)——连接器页 35 数据集逐张预览+真下载 .xlsx 见真业务数据(源库有+前端可见·SYNTHETIC 诚实不冒充)+no-orphan 门治本。真浏览器实拍 `st-c6-connectors.png`。②**上传真实数据→出真答案**：SOLVER-BINDING(`8bffa3a`·审核核发·B3命门闭)——上传→建模→归域→物化→配绑定→**真答案「提价4%接」**(HTTP 全链)。option A 的 solver 拒(B3)已解。closure `REVIEW-SOURCE-TRANSPARENCY-closure.md`+`REVIEW-SOLVER-BINDING-closure.md` |
| **R31** | **WO-ACTUATE出站writeBack+WO-OBSERVABILITY OTel span树(11238)** | ✅ **已核发(dev建·代码级)** | dev `e5c41cc`(ACTUATE)/`22443b2`(OBS)照设计建·审核方**独立核实**:代码符设计+**datacore 829回归绿**+诚实(MockWriteback R6 hash/ErpRest NOT_CONFIGURED/tracing no-op/禁明文凭据)+本体G-14回写。**诚实边界**:用户动作走查(curl写回/起OTel collector)取dev FDE证据·审核方未独立起服务实拍(代码级核发) |

## §2 option A 真跑断点（真响应实证）
- **B1**◐：`/modeling/suggest` LLM-gated·`/derive`确定性已在·前端不自动降级(对R12-old/L5049)。
- **B2**🔴：fresh租户publish卡(0注册域+手动归域)·已实测可过但摩擦大。
- **B3**✅**最深命门已闭**(SOLVER-BINDING·`8bffa3a`·审核核发)：canonical求解器经 `resolveSolverType(idx,solverKey,role)` 按 role 取租户真实类型/字段(无绑定回退 canonical·demo 零回归)。**HTTP 全链真跑实证**：realco 注册域→建4非canonical类型+发布→上传CSV+objectify真物化→配 SolverBinding+**激活**→invoke order_fullchain **出真答案** `{RO-2001,提价4%接,qty500读上传,毛利8%<底线12%经fieldMap读出,缺口30吨}`(求解器代码零改)。契约 C1-C7 逐条过(未绑定拒✅/真答案✅/demo回退✅/DF.8接地400不落库✅/确定性门exit0✅/回归838passed✅/R14两行业✅)·本体回写齐(SolverBinding类型+事件L20+门+G-17断点标闭)。closure `REVIEW-SOLVER-BINDING-closure.md`。

## §3 dev 批次核发（workflow 5-agent 代码评审·7 PASS / 2 CONCERN）
| commit | WO | 判 |
|---|---|---|
| de151ea DECISION-RECORD·27dd224 T5-LEASE·baba605 EXPERIMENT·431053b BUILDER-ROLE·565a748 RETENTION·399e6ca AUDIT-OBS·6918b28 PIPE-INCR③ | 7 单 | ✅ **PASS**(代码符·诚实·R2/R4/R6/本体回写齐) |
| **cc3b152 GRAPH-3/4** → 修 `82b168a` | R24 | ✅ **已复验核发**(FIX-2CONCERN·FIX-1)：`Object360Page.tsx:148` 补 `{drawer && <DagNodeDrawer.../>}`。**真浏览器像素级实拍**(真后端·非mock)：登录 demo/admin → 深链 `/o/Base/obj_base_changzhou`(常州) → 点血缘节点 → 抽屉弹出(before=false→after=true)·Escape 关·重开·前后端 18 节点/7 组同值。证据 `docs/evidence/optV-02/03.png` + `REVIEW-FIX-2CONCERN-closure.md`。 |
| **6cc1f97 FRESHNESS** → 修 `82b168a` | R8/R13 | ✅ **已复验核发**(FIX-2CONCERN·FIX-2)：`ontology.ts:688` runDerivations 写路径收口调 `invalidateConfidenceCache`。**运行中真服务 E2E**：合成→`{synthetic:true,SYNTHETIC}`→上传 real-orders.csv+objectify(2 真 Order·零手动失效)→`{synthetic:false,LIVE}` 诚实位自动翻转。契约 C1-C5 逐条过(单测①b·门 pipeline-freshness exit0·全套 830 passed 0 failed)。 |

## §4 landed 对账（workflow landed-status agent）
- ✅ LANDED：WO-SCENE-C(`8cbd5fa`)·WO-NAV(`f969638`)·WO-QUARANTINE(`f969638`)——均有 evidence+真浏览器实拍。
- 🔴 **NOT-LANDED**：WO-E1(校准活体常态化)·WO-E2(沙盘what-if)——**仅设计施工单`8d021d0`·零代码**(scheduler 有 RETENTION_SWEEP 无 CALIBRATION_SWEEP·无 openWhatIf)。

## §5 设计交付物（MEANS·🔵≠真闭·待 dev 建+我复验）
SOURCE-TRANSPARENCY · ACTUATE · OBSERVABILITY · **WO-SOLVER-ONTOLOGY-BINDING(B3命门·待写)** · WO-MULTISRC-FUSION-DOMAIN(N1·待写) · DISPATCH-MANIFEST(待出)。

## §6 维护约定
每次声明完成先查/改对应行并引用·真闭必附用户动作证据·新需求立刻加行·你可拿任一行质问"凭什么这个色"。

---
*审核方治理制品（单一权威·反代理·v3 穷尽227条·钉 L# 可复核）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
