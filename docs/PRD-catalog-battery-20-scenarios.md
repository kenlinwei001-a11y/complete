# PRD · 锂电产销运营 20 场景目录（Skills × Agents × Workflows × Solvers × 约束全集）

| 项 | 值 |
|---|---|
| 版本 | v1.0（场景包 battery-manufacturing 的完整内容目录；初级开发照 §0 流水实施，零设计决策；基线裁决 #26，WBS 追加 W38） |
| 复用声明 | 8 个求解器已有公式级规格（capacity_forecast/affected_orders/risk_timeline/plan_audit/plan_generate/bottleneck_matrix/capex_scenario/sop_balance），本文新增 **13 个**；规则在 C01–C25 基础上新增 **C26–C33** |
| 自动填充 | 全部数据由 §7 的 GenSpec 扩展生成；意图/场景/评测用例按 §8 规则从 §1 总表自动派生 |

## 0. 初级开发实施流水（每场景固定五步，禁止跳步）

① 按 §2 实现/复用求解器（参照实现双算进 VLE）→ ② 按 §3 注册规则 → ③ 按 §6 创建 workflow（DRAFT→发布校验）→ ④ 按 §4+公共模板写 skill（lint+评测双门禁）→ ⑤ 按 §5 创建 agent 并在 §1 指定视图挂载意图与场景入口。完成判据 = §8 自动生成的 3 条评测用例 + 1 条端到端用例全绿。

## 1. 场景总表（20 行，所有派生物的单一来源）

| S# | 场景 | 视图 | 意图 key / 触发问句（评测"应触发"用例即此句） | Solver | 规则 | 风险级 |
|---|---|---|---|---|---|---|
| S01 | 订单可承接性评审 | project | capacity_feasibility／"4680-NCM 加 20% 六周能不能接？" | capacity_forecast✓ | C01 C02 C03 C09 | COMPUTE |
| S02 | 交期风险与受影响订单 | risk | affected_orders／"常州基地影响哪些订单？" | affected_orders✓ | C05 | COMPUTE |
| S03 | 风险越线根因 | risk | risk_root_cause／"常州物料齐套为什么这天越线？" | risk_timeline✓ | C06 C11 | COMPUTE |
| S04 | 月度规划体检 | audit | plan_audit_q／"现金垫 45 亿过得了体检吗？" | plan_audit✓ | C15 C16 C18 C21 C23 | COMPUTE |
| S05 | 经营方案比选 | generate | plan_recommend／"推荐哪个经营方案？" | plan_generate✓ | C08 C15 C18 | COMPUTE |
| S06 | 处置方案采纳 | risk | adopt_mitigation／"采纳常州的三班制方案" | mitigation_select＋ | C08 C10 | ACTION_DRAFT |
| S07 | 产线认证排期 | project | cert_scheduling／"待认证的型号怎么排认证顺序？" | cert_schedule＋ | C04 C26 | COMPUTE |
| S08 | 物料齐套分析 | risk | kit_analysis／"下周哪些订单缺料开不了工？" | kit_readiness＋ | C06 C16 | COMPUTE |
| S09 | 长协执行与补缺 | dash | lta_gap_q／"7 月正极长协覆盖够吗？缺口怎么补？" | lta_gap＋ | C16 C27 | COMPUTE |
| S10 | 库存水位优化 | dash | inventory_opt／"哪些物料超储/欠储？能释放多少资金？" | inventory_optimize＋ | C16 C28 | COMPUTE |
| S11 | 换型排序优化 | project | changeover_opt／"下周订单怎么排能少换型？" | changeover_sequence＋ | C22 C29 | COMPUTE |
| S12 | 良率波动诊断 | risk | yield_diag／"涂布良率为什么掉了？" | yield_diagnosis＋ | C30 | COMPUTE |
| S13 | 检修窗口错峰 | risk | maint_stagger／"检修计划和交付高峰撞了怎么调？" | maintenance_stagger＋ | C11 | COMPUTE |
| S14 | 外协决策 | generate | outsourcing_q／"缺口 8 万套自产加班还是外协？" | outsourcing_split＋ | C08 C31 | COMPUTE |
| S15 | 接单毛利评审 | dash | quote_margin_q／"电网公司 F 这单毛利过线吗？" | quote_margin＋ | C15 C24 | COMPUTE |
| S16 | 客户信用风险 | dash | credit_check／"商用车集团 G 还能接新单吗？" | credit_exposure＋ | C13 C32 | COMPUTE |
| S17 | 产能投资评审 | generate | capex_review／"枣庄储能线值得投吗？" | capex_scenario✓ | C18 C23 | COMPUTE |
| S18 | S&OP 月度平衡 | sop（新视图） | sop_status／"本月产销平衡到哪一步了？" | sop_balance✓ | C18 C21 C22 | COMPUTE |
| S19 | 季度缺口对策 | quarter（新视图） | quarterly_gap_q／"Q2 缺口用什么组合补？" | quarterly_gap＋ | C08 C29 | COMPUTE |
| S20 | 碳足迹核算 | dash | carbon_q／"4680-NCM 出口欧盟的碳足迹达标吗？" | carbon_footprint＋ | C33 | COMPUTE |

（✓=已有规格直接复用；＋=本文 §2 新增。每意图的槽位从触发问句可见：型号/基地/客户/物料/季度，按 QOS-PRD SlotDef 模板登记，objectRef 类一律带 `defaultFrom:$.selectedObjects[0]`。）

## 2. 新增 13 个求解器（公式级，全部确定性、需参照实现双算）

**S06 `mitigation_select`** 入参 `{baseName, factor}`：从方案库（求解器增量 RISK_SOL 七因素×3 案）取该因素方案集，`score_i = eff_i × urgency / (cost_rank_i × t_days_i)`，`urgency = max(0,(当前紧张度−70)/30)`，cost_rank 低/中/高=1/2/3；输出按 score 降序 + 推荐首位 + 生成草稿所需 payload。

**S07 `cert_schedule`** 入参 `{horizon_weeks}`：待认证集 = 认证关系中 status=认证中/待认证 的 (型号×产线)；`priority_i = 该型号未来 horizon 需求缺口贡献(万套) / 认证工时_i`；按 priority 降序、受 C26 并行认证数 ≤ 工程师组数 约束贪心装箱到周；输出排期表 {项, 开始周, 完成周, 解锁产能}。

**S08 `kit_readiness`** 入参 `{fromDay, toDay}`：对窗口内订单逐单 `齐套率 = min_物料( (现库存+ETA≤开工日的在途) / (BOM单耗×qty) )`，<1 即缺料；输出 {订单, 齐套率, 缺料项[{物料, 缺口量, 最早补齐日}], 建议(加急采购/调拨/顺延)}；开工日 = 交期 − 标准生产周期(型号属性)。

**S09 `lta_gap`** 入参 `{material, month}`：`净需求 = Σ(月需求×BOM单耗) − 现库存 − 在途`；`长协可用 = 长协年锁量×月配额 − 本月已执行`；`现货缺口 = max(0, 净需求 − 长协可用)`；输出 {净需求, 覆盖率, 缺口, 建议PO[{批量=缺口/2 两批, 最迟下单日=需求日−交期}]}。

**S10 `inventory_optimize`**：每物料 `目标水位 = 日均耗用(A8 近30日) × (采购交期天数 + 安全天数5)`；`超储 = max(0, 现库 − 1.5×目标)`，`欠储 = max(0, 0.8×目标 − 现库)`；`可释放资金 = Σ超储×单价`；呆滞 = 90 日无耗用批次（C28）；输出三清单+资金合计。

**S11 `changeover_sequence`** 入参 `{lineId, week}`：该线周订单集，换型矩阵 `M[型号A][型号B]=分钟`；最近邻贪心：从当前在产型号起，每步选 M 最小的未排订单；输出 {序列, 总换型时长, vs 交期序节省分钟, 违反交期的订单(若有→标注不可行需人工)}；冻结期内订单位置锁定（C29）。

**S12 `yield_diagnosis`** 入参 `{processKey, baseName, window=30}`：良率时序滑窗突变检测——`突变点 = 首个 |后7日均值 − 前7日均值| > 2σ(前30日)` 的日；候选根因 = 突变点 ±2 日内的事件对象（换批/换型/检修/来料批次切换），按时间贴近度排序；输出 {突变日, 降幅, 根因候选[{事件, 距离天数, 来源}], 建议核查项}。

**S13 `maintenance_stagger`**：冲突 = 检修周与交付高峰周（订单交期聚集度 top3 周）重叠的基地；对每冲突基地在 ±4 周窗内选 `新周 = argmin(当周需求负荷)`，约束：与上次检修间隔 ≥26 周、同集团同周检修基地 ≤3；输出调整表 {基地, 原周, 建议周, 负荷降幅} + 不可解冲突清单。

**S14 `outsourcing_split`** 入参 `{gap, weeks}`：三渠道成本 `加班 c1=1.0 上限 a1=gap×0.4`、`外协 c2=1.4 上限 a2=总需求×20%(C08)`、`延期罚 c3=2.5`；按单位成本升序贪心分配；外协部分附 C31 质量条件；输出 {分配[{渠道, 量, 成本}], 总成本, vs 全延期节省}。

**S15 `quote_margin`** 入参 `{orderId | (custName, modelId, qty, price)}`：`BOM成本 = Σ(单耗×大宗现价×(1+加工费率))`（大宗价取外部域对象，C24 联动）；`毛利率 = (价 − BOM − 制造费率×价 − 物流费) / 价`；对比细分底线（C15）；输出 {毛利率, 底线, 差额, 判定, 成本构成分解}。

**S16 `credit_exposure`** 入参 `{custName, newOrderAmount?}`：`敞口 = 在手应收 + 在产未开票订单金额`；`可用 = 信用额度 − 敞口`；逾期 = 应收中 dueDate+30 未回（C32）；判定：新单 ≤ 可用 ∧ 无逾期；输出 {额度, 敞口构成, 可用, 逾期清单, 新单判定}。

**S19 `quarterly_gap`** 入参 `{quarter}`：缺口 = 季度滚动 gap；候选对策 = {提前爬坡(释放=Δramp×产能, 成本低), 换型优化(释放=S11 节省折算, 低), 错峰检修(S13 折算, 低), 外协(上限 C08, 中), 顺延非战略单(罚, 高)}；按成本升序贪心覆盖；输出 {对策组合, 各自释放量, 残余缺口, 落地动作建议(关联 S07/S11/S13/S14 场景)}。

**S20 `carbon_footprint`** 入参 `{modelId, baseName}`：`产品碳足迹(kgCO2e/套) = Σ(物料单耗×物料碳因子) + Σ工序(单位能耗×电网因子(基地省份))`；能耗取 A8 能耗时序近 90 日均；对比欧盟电池法阈值（CarbonRule 对象）；输出 {总值, 物料/能耗分解, 阈值, 判定, 最大改善杠杆}。

## 3. 约束注册表新增（C26–C33，DSL 表达式；C01–C25 沿用既有）

| 规则 | 表达式（规则 DSL） | 级 | 绑定场景 |
|---|---|---|---|
| C26 认证资源上限 | `并行认证任务数 <= 认证工程师组数` | BLOCK | S07 |
| C27 长协执行偏差 | `ABS(实际到货-长协计划)/长协计划 <= 0.05` | WARN | S09 |
| C28 呆滞预警 | `批次无耗用天数 <= 90` | WARN | S10 |
| C29 排产冻结期 | `重排订单.开工日 - today >= 3`（冻结期内重排走变更 Action） | BLOCK | S11 S19 |
| C30 良率连降停线评审 | `SUSTAIN(工序.日良率 < 基线-0.02, 3)` | BLOCK(评审) | S12 |
| C31 外协质量门 | `外协厂.良率 >= 自产良率 - 0.02` | BLOCK | S14 |
| C32 逾期冻结 | `客户.最大逾期天数 <= 30`（违反→新单冻结） | BLOCK | S16 |
| C33 碳护照前置 | `订单.目的地=='EU' IMPLIES 型号基地.碳足迹 <= 欧盟阈值`（IMPLIES = `NOT a OR b`） | BLOCK | S20 |

## 4. Skills 目录（20 个；公共段模板 + 各 skill 差异内容）

**公共段模板**（全部 skill 共用，编写时原样填入）：`前置检查`＝"确认求解结果的 snapshotVersion 与入参回显一致；选中对象与问句指代一致（不一致→先向用户确认）"；`失败处理`＝"求解器返回错误码→原样转述错误含义并给出可行的下一步（换参数/换场景/联系域负责人），禁止编造结果；规则 BLOCK→解释规则含义与解锁条件"。

各 skill 给定：**summary（逐字使用）｜步骤要点｜反例｜输出要求**。正例段按步骤要点扩写为祈使句（扩写只许细化措辞不得增删语义——lint+评测门禁兜底）：

| S# | summary（验证过 lint 模板：能力句+当…时使用+不适用句） | 步骤要点 | 反例（必写入 body） | 输出要求 |
|---|---|---|---|---|
| S01 | 解读产能可承接结论的口径。当对比 P50/P90、解释认证系数或爬坡折减、用户追问"两个产能数为何对不上"时使用。不适用：产能计算本身（调 capacity_forecast，本技能只解读结果）。 | 口径三连查：健康度系数→认证系数→爬坡/检修窗；逐基地表指认主瓶颈 | 把 P50 与 P90 平均成"综合值"（分位数不可平均） | 每个口径解释挂溯源角标；结论句含 ok/gap 与主瓶颈 |
| S02 | 解读交期风险扫描结果。当说明哪些订单受影响、解释延误估计与窗口口径时使用。不适用：单一订单的承接性测算（用 S01）。 | 按交期升序呈现；说明 [T−7,T+14] 窗口口径；跨基地订单注明关联风险点 | 把"受影响"说成"必延误"（是风险暴露非既成事实） | table block + 窗口口径脚注 |
| S03 | 解释风险越线的根因与时序。当用户问"为什么这天越线/峰值多高/什么事件推的"时使用。不适用：给处置方案（用 S06）。 | 引用公式三件套：基线、目标位、事件脉冲；逐事件给 来源系统+幅度 | 只报结论不报事件证据链 | text 含公式与事件清单，均带溯源 |
| S04 | 解读规划体检结论。当解释硬矛盾/软风险条目、说明评分与修正建议时使用。不适用：直接改计划（fix 仅演示，生效走审批）。 | 先评分档位后逐条；每条带规则号与代入数值；fix 注明审批边界 | 把"一键应用"说成已生效 | rule_violation block 逐条 + 评分 kpi |
| S05 | 解读三方案比选。当解释推荐理由、五维取舍、硬约束违反与解锁条件时使用。不适用：替用户拍板（系统只算路径与后果）。 | 推荐=无违反中总分最高；逐案讲牺牲了什么；⛔ 案给解锁条件 | 替用户决策（"应该选进取型"） | 比对表 + 推荐句注明"拍板由人" |
| S06 | 协助采纳风险处置方案。当用户说"采纳/就用 X 方案/下单处理"时使用。不适用：比较方案优劣（用 S03 的根因 + 本技能仅执行采纳）。 | 确认 基地+因素+方案名 三要素；调 mitigation_select 取 payload；创建草稿后明示待审批 | 声称"已安排夜班"（只产生了草稿） | action_draft block + 审批去向说明 |
| S07 | 解读认证排期建议。当问"先认证哪个/何时完成/解锁多少产能"时使用。不适用：修改认证状态（PLM 域职责）。 | 解释 priority=缺口贡献/工时；指出资源约束 C26 卡点；给完成日与解锁量 | 承诺认证一定按期（排期是计划非承诺） | 排期表 + 资源占用说明 |
| S08 | 解读齐套分析。当问"哪些单开不了工/缺什么料/何时补齐"时使用。不适用：直接下采购单（给建议，下单走采购流程）。 | 齐套率公式口径（含在途按 ETA）；缺料项按最早补齐日排序；区分 加急/调拨/顺延 三类建议 | 把在途当现货（ETA 晚于开工日的在途不算） | 逐单表 + 缺料明细 + 建议分类 |
| S09 | 解读长协覆盖与补缺。当问"长协够不够/现货要补多少/何时下单"时使用。不适用：长协条款变更（年度 AOP 决策）。 | 净需求公式逐项代入；缺口分两批的理由（C16 覆盖天数）；最迟下单日=需求日−交期 | 用年锁量直接比月需求（须按月配额） | kpi(覆盖率/缺口) + PO 建议表 |
| S10 | 解读库存优化清单。当问"哪些超储/欠储/呆滞、能释放多少资金"时使用。不适用：执行调拨（建议态）。 | 目标水位公式；超欠判定带 1.5/0.8 系数口径；呆滞=90 日无耗用（C28） | 把安全库存当超储削减对象 | 三清单 + 资金合计 kpi |
| S11 | 解读换型排序建议。当问"怎么排单换型最少/能省多少时间"时使用。不适用：冻结期内重排（须走变更 Action，C29）。 | 贪心序列与节省分钟；标注因交期不可行的单；冻结期边界 | 为省换型牺牲交期不作标注 | 序列表 + 节省 kpi + 不可行清单 |
| S12 | 解读良率波动诊断。当问"良率为什么掉/从哪天开始/疑似什么原因"时使用。不适用：判定责任（给根因候选与核查建议，定责走质量流程）。 | 突变点判据（2σ）；候选按时间贴近度排序并给来源；C30 触发状态 | 把相关性说成因果（"就是换批导致的"） | 突变日 kpi + 候选表 + 核查建议 |
| S13 | 解读检修错峰建议。当问"检修和交付撞期怎么办/挪到哪周"时使用。不适用：直接改检修计划（EAM 域，建议经 Action）。 | 冲突识别口径（top3 交付周）；新周=负荷最低；间隔/同周上限约束 | 建议取消检修（只能挪不能砍，年度强制） | 调整表 + 不可解冲突明示 |
| S14 | 解读外协分配方案。当问"加班还是外协/各多少/成本差异"时使用。不适用：选外协厂（采购域，本技能给量与成本结构）。 | 三渠道单位成本与上限；C08 红线在分配中的体现；C31 质量门条件 | 外协超 20% 还往外协塞（红线不可越） | 分配表 + 总成本 kpi + 红线余量 |
| S15 | 解读接单毛利评审。当问"这单毛利过不过线/成本怎么构成"时使用。不适用：调价谈判策略（给数据不给话术）。 | 成本四项分解；大宗联动口径（C24）；与细分底线差额 | 用历史大宗价算现报价（须现价） | 分解表 + 判定 kpi（过线/触线/低于） |
| S16 | 解读客户信用判定。当问"还能不能接 X 客户新单/敞口多大"时使用。不适用：调整信用额度（财务域审批）。 | 敞口=应收+在产；C32 逾期冻结优先于额度判断；可用额与新单比较 | 只看额度不查逾期 | 敞口构成表 + 判定句 + 逾期清单 |
| S17 | 解读产能投资评审。当问"值不值得投/IRR 多少/利用率预测"时使用。不适用：替投委会决策（C23 是门槛非批准）。 | IRR 与 util24 双门槛；缺口/过剩窗口对投产时点的意义；敏感性提示（需求曲线情景） | 把通过 C23 说成"已批准" | 双指标 kpi + 窗口图描述 + 门槛判定 |
| S18 | 解读 S&OP 进度与平衡状态。当问"走到第几步/缺口多少/哪些要上会"时使用。不适用：代行第⑤步决策。 | 五步各自产物；C21 提报项即议程；④门禁状态 | 在④未过时讨论定稿 | 步骤状态 + 缺口 kpi + 议程清单 |
| S19 | 解读季度缺口对策组合。当问"Q 几缺口怎么补/组合成本"时使用。不适用：执行单项对策（跳转对应场景 S07/S11/S13/S14）。 | 对策按成本升序的覆盖逻辑；残余缺口明示；每对策给落地场景跳转 | 用单一对策硬补（组合最优被忽略） | 组合表 + 残余 kpi + 跳转指引 |
| S20 | 解读碳足迹核算。当问"碳足迹多少/达不达标/怎么降"时使用。不适用：申报文件制作（合规域）。 | 物料/能耗两段分解；电网因子按基地省份；最大杠杆=分解中最大项 | 用全国均值电网因子算（须分省） | 分解表 + 判定 kpi + 改善杠杆句 |

## 5. Agents 目录（20 个；基座模板 + 差异表）

**基座系统提示词模板**（全员共用，{}为差异槽）：QOS-PRD analyst 提示词全文（数字红线/写降级/能力边界/注入防护）+ 追加段："你的专长是{专长}。优先调用 {主求解器}；解读结论时遵循已加载技能的输出要求。超出专长的问题明确建议用户切换到{相邻场景}视图。"

| Agent key（=场景） | 专长槽 | tools（在 analyst 基础上的增减） | scope.objectTypes | 预算档 |
|---|---|---|---|---|
| s01_feasibility…s20_carbon（20 个，key=表 §1 意图前缀） | 取 §1 场景名 | 全员：query_objects/invoke_solver/evaluate_rules/discover/aggregate_objects；S06 增 create_action_draft；S08–S10 增 query_timeseries_agg；S12/S20 增 query_timeseries_agg；其余不增 | 全员 Base/Model/Order + 场景对象：S08–S10 增 Material/PO/Batch；S15–S16 增 Customer/ARInvoice/PriceBook；S20 增 CarbonFactor/EnergyMeter；S07 增 Certification | S01–S05/S17–S19：标准档（既有 AgentBudget）；S06：动作档（maxToolCalls 6）；其余：标准档 |

每 agent 绑定：skills=[对应 S# 技能, S01 技能（口径解读为全员第二技能）]，ruleBindings=该场景 §1 规则列（mode=POST_CHECK）。

## 6. Workflows 目录（20 个；步骤用既有 DSL 紧凑记法）

记法：`solver(key,args)` `rules([ids],payload)` `draft(type,payload)` `render(blocks)`；slots 引用 `{{s.x}}`。

| WF | 步骤序列 |
|---|---|
| p_feasibility✓ p_affected✓ p_rootcause✓ p_audit✓ p_generate✓ | 沿用骨架已实现的五个（QOS 种子） |
| p_adopt(S06) | solver(mitigation_select,{base,factor}) → rules([C08],推荐案) → draft(采纳产能保障方案, 推荐案payload) → render(action_draft+text) |
| p_cert(S07) | solver(cert_schedule,{horizon:{{s.weeks∥12}}}) → rules([C26],排期) → render(table排期+kpi解锁产能+text) |
| p_kit(S08) | solver(kit_readiness,{fromDay:1,toDay:14}) → render(table逐单+table缺料+text建议) |
| p_lta(S09) | solver(lta_gap,{material:{{s.material∥三元正极}},month}) → rules([C27],执行偏差) → render(kpi×3+table PO建议+text) |
| p_inv(S10) | solver(inventory_optimize,{}) → render(kpi可释放资金+table×3+text) |
| p_chg(S11) | solver(changeover_sequence,{line:{{s.lineId}},week}) → rules([C29],重排集) → render(table序列+kpi节省+text) |
| p_yield(S12) | solver(yield_diagnosis,{process:{{s.processKey}},base:{{s.baseName}}}) → rules([C30],时序) → render(kpi突变日+table候选+text核查) |
| p_maint(S13) | solver(maintenance_stagger,{}) → render(table调整+text不可解项) |
| p_outs(S14) | solver(outsourcing_split,{gap:{{s.gap}},weeks:{{s.weeks∥6}}}) → rules([C08,C31],分配) → render(table分配+kpi成本+text) |
| p_quote(S15) | solver(quote_margin,{order:{{s.orderRef}}}) → rules([C15,C24],报价) → render(table分解+kpi判定+text) |
| p_credit(S16) | solver(credit_exposure,{cust:{{s.custName}},newAmount:{{s.amount∥null}}}) → rules([C13,C32],敞口) → render(table敞口+text判定+逾期表) |
| p_capex(S17) | solver(capex_scenario,{scenario:基准}) → rules([C23,C18],项目集) → render(kpi IRR/util24+table窗口+text) |
| p_sop(S18) | sop_balance 工作流模板（§S1.8 五步，已有）→ render(步骤状态+议程) |
| p_qgap(S19) | solver(quarterly_gap,{quarter:{{s.quarter}}}) → render(table组合+kpi残余+text跳转) |
| p_carbon(S20) | solver(carbon_footprint,{model:{{s.modelId}},base:{{s.baseName∥主产基地}}}) → rules([C33],{目的地:EU,值}) → render(table分解+kpi判定+text杠杆) |

## 7. 数据自动填充（GenSpec 扩展，A9 一键生成；全部走正门）

**新增对象类型与量（S 规模）**：Certification（型号×产线 18 条，状态分布 量产12/认证中4/待认证2，认证工时 lognormal）｜ChangeoverMatrix（6 型号×6，对角 0，同化学体系 30–60 分钟、跨体系 90–180）｜Material（8 关键料：单耗/交期/碳因子/单价）｜MaterialBatch（120 批：库龄指数分布，植入 6 批 >90 日呆滞）｜PO/在途（30 单，2 单植入延迟）｜Customer 扩展（信用额度/账期/在手应收；商用车集团 G 植入逾期 38 天）｜ARInvoice（60 张）｜PriceBook（细分基价+客户折扣）｜CapexProject（3 项目：枣庄达标/江门临界/一虚构不达标）｜CarbonFactor（8 物料 + 12 省电网因子）｜EnergyMeter 时序（12 基地×日，AR1）｜认证工程师组=3（C26 用）。
**因果植入（供场景有戏可演）**：S12 用 yield_drop 剧本事件（涂布，T−40 起 −3pct）；S13 植入常州检修周=交付 top 周；S14/S19 用 Q4 缺口；S20 让 4680-NCM 常州达标、成都超标 8%（电网因子差异）。
**自动接线**：20 意图+槽位、场景入口（含新增 sop/quarter 视图）、agent/skill/workflow 全部进场景包种子；运营态回放的 OpsPlaybook 追加每周轮询 20 触发问句中的 6 句（任务史覆盖新场景）。

## 8. 验收（自动派生规则 + 总体）

1. **每场景 3 条评测用例自动生成**：应触发=§1 触发问句（断言 intentKey+主求解器调用+输出要求关键词）；不应触发=表中相邻行问句（断言不加载本场景 skill）；行为增益=挂载/卸载 skill 对跑（断言输出要求字段差异）。共 60 条入 OC2 套件。
2. **每场景 1 条端到端**：A9 生成→正门流转→触发问句→答案数值 vs 参照实现（VLE ⑤段断言）。
3. **总体**：20 场景全部 lint+评测+端到端绿 = W38 完成；VLE 断言矩阵 ⑤段覆盖 20 求解器双算；§7 植入的 6 处"戏剧点"（呆滞/逾期/良率突变/检修冲突/碳超标/PO 延迟）各被对应场景检出（构造真值断言）。
