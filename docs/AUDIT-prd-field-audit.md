# AUDIT · PRD 数据前置讨论逐份三态审计（WO-PRD-FIELD-AUDIT-REOPEN）

> 工单：G-PRD-DATA-UNGROUNDED 断点清册 —— 对「数据前置讨论为零或接近零」的约 80 份 PRD **逐份打开**，
> 三态分类：**真缺口 / 误报 / 覆盖不到**。基线 `be449a1c9`（WO-PRD-GROUNDING-BURNDOWN 落点，
> 7 豁免 + 5 裁定已清零，ratchetHigh/maxExemptions = 0）。审计日 2026-08-19。
>
> **纪律**：每份都打开看过原文才算数（不是照描述猜）。逐份证据来自对全部 138 份 `docs/PRD-*.md`
> 的整文机器摘要（标题 + 全部章节标题 + 验收区全文）逐份目读，叠加对 ~25 份关键文件的章节级原文精读
> （sed 定位到行）。本文件每个结论行的「why」都指向具体小节/判据号，可当场复核。

## 0. 与同族文件的关系

- 树上已有 **`docs/AUDIT-prd-field-grounding.md`**（WO-PRD-FIELD-AUDIT，2026-08-11）：审的是
  「PRD 里 `Type.field` 引用是否真存在于本体真值源」，产出 7 处字段不存在 → 已全部修复清零（burndown）。
- **本文是同一断点族（G-PRD-DATA-UNGROUNDED）的另一维**：审的是「PRD 验收判据是否声明了数据前置
  （判据依赖的数据从哪来、不在场时怎么办）」。两文互补不重叠；grounding 文的 7 处修复属于
  「字段引用准确性」，本文的 11 份真缺口属于「判据数据前提缺席」。
- **旧分支打捞结论**：`claude/handoff-wo-prd-field-audit` @ `8ed7727b6` 的
  `docs/AUDIT-prd-field-grounding.md`（494 行）与基线树（531 行）逐行 diff，基线版 = 旧版全文 +
  过期横幅（WO-RECLAIM-DOCS 收编标记）。**可迁移条目 = 0**，无需任何「迁移自 8ed7727b6」标注。
- 工单提及的 `docs/WO-QUEUE-breakpoints-2.md` 在基线与集成 tip `7c52b9b42` 上**均不存在**
  （只有 `WO-QUEUE-breakpoints.md`，且不含本单文本）；本审计按派单消息原文执行。

## 1. 清册口径与重算

旧审计（2026-08-11）已把「80 份/86%」重算为 57/103。本次在 138 份 PRD 上按同一关键词表
（`种子|seed|覆盖率|没数据|无数据|零数据|字段缺失|属性缺失|数据前置|接了线没数据|恒空|空表|0 条|没有值|无对象承载|未落值|缺口|数据缺|NO_CARRIER|没定义`）
匹配**验收/判据/DoD/接受标准区**（标题正则 `/验收|判据|DoD|Definition of Done|接受标准/i`）重算：

- 138 份总盘：**117 份**有验收区，其中 **66 份**验收区零数据讨论关键词命中（审计集 A）；
  **21 份**无验收区（审计集 B，度量口径外但同样逐份打开定性）；51 份命中（无需审）。
- 金丝雀：`PRD-data-backfill.md`（已知必有数据讨论）→ 命中 HAS_DATA ✓，工具可信。
- **审计集 = 66 + 21 = 87 份**。与历史「80 份」的差异来自总盘从 103 → 138 与口径微调，
  不是漏审；66 份零命中集与旧审计 57 份集是同一母集在不同时点的快照。

## 2. 三态判据（本次执行口径 v3）

| 态 | 判据 | 修法归属 |
|---|---|---|
| **真缺口** | 验收判据**依赖既有业务数据在场**（具名实体/种子/求解器产出/⟦ref⟧/注册表内容），而全文**无任何数据安排声明**——数据缺席时判据空转或骑 happy-path | 修 PRD（补数据前置声明） |
| **误报** | 验收区自带数据安排（显式构造/注入/mock/合成声明、空态/EMPTY/诚实空反证、落库/在册断言、规模/覆盖断言、数据出处声明），关键词表恰好没盖住 | 无需修；关键词表可加词 |
| **覆盖不到** | 无验收区（度量口径外），或判据根本没有业务数据维度（纯 UI 结构/布局、配置开关、字节兼容、性能、流程/门设计文档） | 无需修；本就不该进此度量 |

⚠️ 「真缺口」≠「这 PRD 是坏的」。多份真缺口 PRD 的判据在有种子数据的 demo 租户上确实能跑通；
缺口在于**判据没声明这个前提**，换一个空租户/空注册表环境判据就静默空转——正是
G-PRD-DATA-UNGROUNDED 要登记的病。

## 3. 金丝雀义务：「逐份打开」的证据摘录（≥5 条）

以下为审计过程中亲手读到的原文证据（非标题扫描）：

1. **PRD-sandbox-metro-semantics §4**：时序可算性三级判据表逐数据源列字段有无——「Shipment 只有
   etaDay（日粒度）没有 eta（时刻）⇒ 不画车」「Cadence 没有一条数据 ⇒ EMPTY」——教科书级数据前置讨论，
   但关键词表未命中「三级判据」语境 ⇒ 误报。
2. **PRD-capacity-feasibility-demanddelta-fix §6.1 ③**：「全零诚实路径：构造型号只认证在零产能基地
   → p50===0 → dataMode: EMPTY + 数据缺口文案」——数据缺席路径被写成一等判据 ⇒ 误报。
3. **PRD-UPGRADE-decision-sandbox-v2 §5.1**：验收标尺逐维盘点承载物，明写「四维零承载物」；
   §5.2 十四步 Demo 链逐阶段标 ✅/🔴 数据依赖 ⇒ 误报。
4. **PRD-sandbox-metro-ops §4.3**：逐字引用引擎 `missingInputs` 登记
   （ARInvoice.invoiceDate / FinanceAccount.period / PurchaseOrder.paymentTermDays），并明写
   「今天算不出来……直到那三个字段真被建模」——缺失自认，门 PDG-5 未判定三条据此判误报。
5. **PRD-data-backfill D5**：`~~Shipment.eta~~ → Shipment.etaDay 已存在…无需补（我先前按 eta 查，名字错了）`
   —— 划线自我更正，门未判定键 Shipment.eta 据此判误报。
6. **PRD-A3-multihop-slice-completion §2**：验收 C1-C5 以**加粗段落**（非 markdown 标题）呈现
   「**验收(C1-C5,逐条给证据)**」，标题正则漏捕进 noAcc 桶；内容实为种子基线（≈95 节点）+ 覆盖报告
   诚实列缺 ⇒ 误报（本文唯一一份「验收区存在但标题形态特殊」的文件，已单独核原文）。

## 4. 逐份三态清册（87 份，按文件名字典序）

### 4.1 审计集 A：有验收区、零数据讨论关键词（66 份）

| PRD | 三态 | why（小节/判据定位） |
|---|---|---|
| PRD-1to1-README-HANDOFF | 误报 | DoD§6 要求 FDE 亲手把数据从生成→渲染走一遍核对「数值=HTML」，即数据链路走查入判据 |
| PRD-A9-external-engines-design-deferred | 覆盖不到 | 设计稿 PRD；DoD=契约齐备+`prd:check` 绿+「不产生任何代码改动」，无数据承载面 |
| PRD-UPGRADE-decision-sandbox-v2 | 误报 | §5.1 验收标尺逐维盘点承载物（「四维零承载物」明写）；§5.2 十四步 Demo 链逐阶段标数据依赖 ✅/🔴 |
| PRD-WO-LIVE-DISPOSITION | **真缺口** | 红咬③「每个 shortfall>0 的行 steps≥1」在零 shortfall 行时 vacuous 通过；红咬①杠杆依赖 Material.onHand/leadTime 在场；全文无一句数据前置声明 |
| PRD-addendum-admin-console-closure | 误报 | AC1/AC7 空态入判据（「空列表显示创建工作流入口」），空/有两态都管 |
| PRD-addendum-admin-platform | 误报 | M1 空库启动、M2 一键合成后八页有内容、M8 未合成空态引导——数据有无两态皆判据 |
| PRD-addendum-capability-routing | 误报 | CR1 Mock 脚本自带情境；「无 description 的切片发布被拒」= 数据质量门入判据 |
| PRD-addendum-dataflow-loop-closure | 误报 | TR8「一键合成→全模块有数据且跨页同一事实数字相等」即数据齐备断言 |
| PRD-addendum-excel-seed-700B-expansion | 误报 | §12 验收全是数据规模断言（月≥数百条/周≥数千/日≥数万、700亿/17%） |
| PRD-addendum-llm-providers-and-references | **真缺口** | L5「改规则 C08 阈值→所有绑定该规则的 agent 60s 内用新值」：C08 与绑定关系不在场时判据空转；L6 同依赖 planRef 意图与计划版本；无前置声明 |
| PRD-addendum-m11-calibration | 误报 | C2/C3/C5 逐条声明构造数据（「构造 OEE 实测均值 0.78 vs 基线 0.85」「注入仅爬坡偏差的合成历史」） |
| PRD-addendum-ontology-core | 误报 | O3 构造环；O7「删除有数据的属性→无迁移声明拒绝发布」直接谈数据在场性 |
| PRD-addendum-ontology-governance | **真缺口** | G7「『常州』命中基地…czmgr 搜不到其他基地」依赖种子多基地+角色数据；G8「avg(util) 与手算一致」依赖带 pos/util 的对象在场；均未声明 |
| PRD-addendum-operational-completeness | 覆盖不到 | CC1-CC4 并发语义判据（互斥/投递/Saga），数据非判据维度 |
| PRD-addendum-skill-authoring | 误报 | SA2/SA3 就地标注「范例技能全仓 0 命中→阻塞不计通过」——被测对象缺失被显式管理 |
| PRD-admin-self-approval | 覆盖不到 | 配置开关行为判据（STRICT/ALLOW 字节一致回归锁），无业务数据面 |
| PRD-agent-react-harness | **真缺口** | 验收3「排产优化问句→轨迹真出现 invoke_solver+数字全⟦ref⟧」依赖求解器与业务数据在场；头号判据无数据声明（验收2 的静默失败场景才是自构造） |
| PRD-agentcore-dsh-upgrade | 覆盖不到 | §12 总判据=开关来回切外部可观察面逐字节一致；机制迁移，自构造 |
| PRD-build-workflow-runtime | 覆盖不到 | AC1-AC11 工作流状态机行为判据，stopAfter 自构造崩溃场景，无业务数据面 |
| PRD-capacity-feasibility-demanddelta-fix | 误报 | §6.1③ 全零诚实路径（p50===0→dataMode:EMPTY+数据缺口文案）——数据缺席路径是一等判据 |
| PRD-capacity-live-cockpit | **真缺口** | DoD「点常州基地卡→拨化成良率滑杆看产能 deltas 真变」依赖常州基地与产能数据在场，无前置声明 |
| PRD-de-battery-multitenant-config | 误报 | DoD「构造第二个 industry 的 workspace 配置（非电池术语/数据）」= 判据自带数据安排 |
| PRD-decision-resource-intelligence-layer | 误报 | §12 `dril-registry:check`「启动后所有资源可投影；无空 description 资源」+ golden query set = 注册表数据断言 |
| PRD-deterministic-cross-domain | **真缺口** | SEAM-1「风控员例→并行 3 solver·装配三域答案+各⟦ref⟧」依赖三域求解器在真实数据上产出可引用数字；无前置声明 |
| PRD-discover-real-type-names | 误报 | DoD「类型存在但空→EMPTY_DATA+引导」「未知类型→UNKNOWN_TYPE」——空/不存在两态入判据 |
| PRD-dogfooding-self-ontology | 误报 | DoD2「sync 后元租户含八类元对象+链路」= 数据落库断言；DoD6 双跑字节一致 |
| PRD-enterprise-decision-twin | 误报 | 裁定二「只补真数据不做 mock」+ 验收2「API 打 500→诚实空+reason，仍显示=写死=红」反证判据 |
| PRD-external-signal-domain | 误报 | 验收直接断言 sync 后 external_signals 在 raw-datasets、端点返回带 source/unit/asOf |
| PRD-fde-fullstack-build-workflow | 误报 | DoD「数据里瓶颈真实存在」「各模块 UI 看得见生成物」= 数据存在性一等判据 |
| PRD-frontend-addendum-sim-views | 误报 | 验收章标题明示「Mock 模式」；F14-F20 数据由 mock 供给，出处有声明 |
| PRD-frontend | 误报 | §11 验收标题明示「Mock 模式，playwright/vitest 自动化」，数据出处有声明 |
| PRD-generic-inference | 误报 | DoD① 在「非电池小本体（SY3 vertical-farming Farm/Batch）」上验证 = 自带构造本体 |
| PRD-global-sim-live-upgrade | **真缺口** | DoD「拨自由杠杆看七维 KPI 真变→采纳走审批→下一轮读真变」依赖联合推演数据链在场，无前置声明 |
| PRD-goal-metric-owner-spine | 误报 | DoD「三对象落库」「血缘 Metric.actual→DataSource 可查」「定目标→喂数据→越线」闭环 = 数据安排入判据 |
| PRD-hardcoded-absence | 误报 | 主题即缺席声明真假；§3.3 事实锁「会红的断言」+§6 变异反证 RC=1 实测记录 |
| PRD-inference-line | 误报 | DoD-3「数据种绑定×引擎路由任一半漏即红」+颗粒铁律「改颗粒→归因变」= 数据安排入判据 |
| PRD-lever-binding-drift | 误报 | §1.2 路径开关假绿分析（生产实参 vs 测试实参）+§5 变异反证三条带 RC——数据/路径前提即主题 |
| PRD-llm-agent-empty-response-guard | 误报 | DoD「mock agent 返回 undefined→断言抛 LlmEmptyResponseError」自带夹具 |
| PRD-maturity-master-plan | 误报 | §7 裁决#29-b「成熟度只认 VLE 自动化证据+真实数据规模基线，不认 demo 演示」 |
| PRD-multi-intent-L2-L3-coupled-solving | **真缺口** | SEAM-L3-守恒「一次 portfolio_optimize·capacityLedger reconChecks 逐格守恒·三量组合」依赖产能账本数据在场；篡改反证自构造但头号判据依赖真数据，无声明 |
| PRD-multi-intent-orchestration | **真缺口** | SEAM-1「风控员例→并行真跑 yield_diagnosis+affected_orders+margin_attribution，答案含三域分节+各⟦ref⟧」依赖三类业务数据；无前置声明 |
| PRD-nav-ia-reorg | 覆盖不到 | 导航 IA/字号判据，无业务数据面 |
| PRD-ontoflow-data-builder | 误报 | DoD 端到端「上传 Excel→…→对象入库·异常行入隔离区」+ parseXlsx 测试 = 自带数据安排 |
| PRD-ontoflow-v2-unified-modeling | 误报 | DoD 双模式端到端自带图谱/Excel 数据安排；promote 缺主键/状态变量则拒 |
| PRD-ontology-browser-field-coverage | 误报 | 主题即字段覆盖门；DoD「构造含未映射列样例→fieldCoverage HARD 必红；全映射→绿」 |
| PRD-optimize-whatif-conversational-wiring | 误报 | §5/步④「CI 用 JS MockFive 真重解·真 CP-SAT env-gated」= 数据/求解安排声明 |
| PRD-plan-audit-1to1 | 误报 | DoD「数据走管线、前端零写死（debattery:check）」= 数据出处声明 |
| PRD-plan-generate-1to1 | 误报 | 同上「数据走管线、前端零写死」出处声明 |
| PRD-prototype-intake-databuilder | 误报 | DoD「上传原型→抽数据表…未解析块诚实列出」「对账 4 类 action 人确认」= 数据安排 |
| PRD-qos-cross-domain-unified | **真缺口** | SEAM-Q2/SEAM-1 依赖 Q2 例三域求解器在真实数据上产出（哪些订单延误），无数据前置声明 |
| PRD-query-orchestration-service | 误报 | line 24 明写「Mock 需加载 §7.6 的种子数据，保证验收用例（§12）可端到端跑通」；§7.6「Mock 种子数据（电池制造场景包，必须内置）」逐一枚举 12 基地/6 型号/20 订单/规则 C03·C08·C13/常州行级过滤——判据对着必须内置的确定性夹具跑，数据出处有声明（复验指正：此前漏读 §7.6，初判真缺口系误分） |
| PRD-rules-as-references | 误报 | 验收②「零未定义：/rules 含全部被引用码」③「零空过：退役 ruleKey→门禁红/诚实标规则缺失」= 数据在册性判据 |
| PRD-sandbox-a2 | 误报 | H6「规则在册（事实层）」H7「溯源可达」+§3.1 实测口径——判据表自带事实源列 |
| PRD-sandbox-metro-semantics | 误报 | §4 时序可算性三级判据逐数据源列字段有无（Shipment 只有 etaDay 不画车；Cadence 无数据→EMPTY）——教科书级数据前置讨论 |
| PRD-sandbox-multiplan | 误报 | L1-A4「诚实空不凑数：构造杠杆集为空阻滞点→candidates[]+noCandidateReason」；L1-A2 掐派生边→门红 |
| PRD-sandbox-v3-three-zone | 覆盖不到 | 验收判据=testid/信息块数/输入控件计数——UI 结构计数，无业务数据面 |
| PRD-scenario-launcher | 误报 | DoD「20 场景经 launch 注入后零 AWAITING_CLARIFICATION」+chain:check 新增「presetContext 零反问」故障注入可红 = 数据接线断言 |
| PRD-scenario-ontogenesis | 误报 | 验收1「20 张卡每张 grow→VERIFIED→点卡得真决策视图」；4「人为缺一环→降 PROVISIONAL 不静默」= 在场性判据 |
| PRD-seam-arg-drop-audit | **真缺口** | 验收「端到端 SEAM 测（带实体深问→答案只含该实体）」依赖实体数据在场；Phase1 台账「覆盖全 ceoCaps+sim-planner plans+intent catalog」依赖注册表内容，无前置声明 |
| PRD-semantics-singlesource | 覆盖不到 | 门判据设计文档；判据对象是门面本身（语义单一来源门），无业务数据维度 |
| PRD-skill-compiler-registry | 误报 | S1「种一个 references 不存在 key 的 skill→4xx」S3「种引用 C08 的 skill→反查真通」= 自带数据安排 |
| PRD-skill-contract-dsl | 误报 | S3「requires.solvers key 改成不存在→422·改回→通过」S6「既有计划迁移后仍可执行」= 在册性/构造判据 |
| PRD-skill-runtime-orchestrator | 误报 | B1「同一份 mock LLM 脚本」明示；A1「32 个既有意图逐个跑·字节相等」= 在册回归锁 |
| PRD-stale-claims | 误报 | 主题即数据声明真假；变异②「声称某对象类型 0 条而它在册→STALE-3 红」 |
| PRD-system-ontogenesis-spec | 误报 | DoD「数据 build-to-verify ✓、新对象进活体本体 ✓、新能力进目录 ✓」在场性判据 |
| PRD-unified-build-engine | 误报 | DoD「喂 20 个故事→20 场景端到端出答案」「上传 Excel 真解析」「故意制造形状不匹配→闭包 SHAPE 报红」= 数据安排入判据 |

### 4.2 审计集 B：无验收区标题（21 份，度量口径外，仍逐份打开定性）

| PRD | 三态 | why |
|---|---|---|
| PRD-A3-multihop-slice-completion | 误报 | 验收 C1-C5 以加粗段落呈现（标题正则漏捕）：种子基线 ≈95 节点（seed 42·R6）+ C4 覆盖报告「诚实列缺，不凑数」 |
| PRD-addendum-execution-semantics | 覆盖不到 | 互斥/投递/Saga 执行语义规范，无验收区，数据非维度 |
| PRD-chain-24nodes | 覆盖不到 | 无验收区；§5 自带 seed42/SO-3391 实测结果（有数据讨论但口径外） |
| PRD-console-cleanup | 覆盖不到 | 无验收区标题；② NO_CARRIER 十节点/诚实位清点本身是数据缺席治理（有讨论但口径外） |
| PRD-data-closure-spec | 覆盖不到 | 无验收区；本身是 21 维数据闭环规范（规范的规范） |
| PRD-demo-lightup-2 | 覆盖不到 | 无验收区；§2 逐条带数据证据（有数据有挂点/数据没跟上诚实标注），口径外 |
| PRD-global-sim | 覆盖不到 | 无验收区；总纲+冻结契约+§6 诚实边界 |
| PRD-implementation-handbook | 覆盖不到 | 无验收区；实施手册 WBS |
| PRD-node-semantics | 覆盖不到 | 无验收区；§2.1 自带 seed42/SO-3391 实测 |
| PRD-ontology-7elements | 覆盖不到 | 无验收区；取证复核文档 |
| PRD-opt-whatif-data | 覆盖不到 | 无验收区；本身是数据半修复（两成本字段派生+seed42 产出值表） |
| PRD-reference-views-1to1-roadmap | 覆盖不到 | 无验收区；索引总纲 |
| PRD-sandbox-ontogenesis-buildplan | 覆盖不到 | 无验收区；倒序发育规格 |
| PRD-sandbox-v4-backward-derivation | 覆盖不到 | 无验收区；§2-§3 逐 UX 元素倒推数据承载（有讨论但口径外） |
| PRD-self-driving-qos-data-foundation | 覆盖不到 | 无验收区；落档评审批注 |
| PRD-skill-crossreview | 覆盖不到 | 无验收区；五份 PRD 对照审查 |
| PRD-topo-realdata | 覆盖不到 | 无验收区；主题「有数据没接线」·§6 自带真浏览器实测（有讨论但口径外） |
| PRD-traceability-and-baseline | 覆盖不到 | 无验收区；追踪矩阵收口 |
| PRD-traceability-and-baseline-v2 | 覆盖不到 | 无验收区；同上 v2 |
| PRD-transit-geometry | 覆盖不到 | 无验收区；几何单源文档自带真浏览器实拍 |
| PRD-v2-skill | 覆盖不到 | 无验收区；四态对账文档 |

> 上两表合计恰为 87 份（66 + 21），与 §1 清册一一对应。

## 5. 三态分布与结论

| 态 | 份数 | 占比（87） |
|---|---|---|
| 真缺口 | **11** | 12.6% |
| 误报 | **48** | 55.2% |
| 覆盖不到 | **28** | 32.2% |

**真缺口 11 份清单**：PRD-WO-LIVE-DISPOSITION · PRD-addendum-llm-providers-and-references ·
PRD-addendum-ontology-governance · PRD-agent-react-harness · PRD-capacity-live-cockpit ·
PRD-deterministic-cross-domain · PRD-global-sim-live-upgrade · PRD-multi-intent-L2-L3-coupled-solving ·
PRD-multi-intent-orchestration · PRD-qos-cross-domain-unified ·
PRD-seam-arg-drop-audit。

**11 份真缺口的共同形态**：验收判据以「在 demo 租户/种子数据上跑一遍」为隐含前提
（具名实体：常州基地、Material.onHand、capacityLedger、⟦ref⟧ 引用数字），但没有任何一句
「若这些数据不在场，判据如何处置」。它们**不是**「字段不存在」病（grounding 门管的那个），
而是「判据前提不声明」病。修法统一且轻量：每份在验收章补一句数据前置声明
（依赖哪些种子/注册表内容；缺席时判据阻塞还是 N/A），属文档补丁，零代码。

**对 G-PRD-DATA-UNGROUNDED 断点的总结论**：「约 80 份零数据前置讨论」的原始估计，
逐份打开后实际为 **11 份真缺口（12.6%）**。55.2% 是关键词度量失手（误报），32.2% 在度量口径外。
断点应当保留但**重述口径**：从「80 份」收敛为「11 份判据前提未声明」。

## 6. 基线并入方案与结构冲突分析（重要）

工单要求把逐条 kind 标注并入 `scripts/prd-data-grounding-baseline.json`，同时要求棘轮只降不升、
门脚本与 gate-ledger.json 零字节改动、不许塞 exemptions、合并后门仍 RC=0。四者兼容性分析：

1. **门只读四个键**（`ratchetHigh` / `maxExemptions` / `adjudicated` / `exemptions`），
   未知 JSON 键被忽略（RC 中性）——已通读 `scripts/check-prd-data-grounding.mjs` 全文确认。
2. 36 条未判定键（25 PDG-5 + 7 PDG-7 + 4 PDG-8）逐条定性结果：**0 条真缺口**
   （11 覆盖不到 + 14 误报 + 7 PDG-7 命名空间提示 + 4 PDG-8 规则域提示，详见基线文件 `audit` 键）。
   ⇒ **无需向 `adjudicated` 添任何键**（adjudicated 只收「判为真缺陷」的 key），
   结构冲突**没有实际触发**。
3. 因此并入方式是**纯新增信息键** `"audit"`（携带本 36 条的 key/kind/why + 本 11 份真缺口 PRD 的
   文档级登记），四个门禁键一律不动：ratchetHigh=0、maxExemptions=0、adjudicated=[]、exemptions=[]。
4. **若未来某条 PDG-5 键被人工判为真缺陷**，则必须二选一（届时是真实停点，本次未到）：
   修 PRD 使 key 消失（推荐），或破棘轮加豁免（工单禁止）。本次 36 条无一落入此分支。

**本文与基线 `audit` 键的分工**：本文按 PRD 粒度（87 份三态），基线 `audit` 键按门的未判定键粒度
（36 条 kind 标注）。同一审计的两个投影，结论一致。

## 7. 复验记录（2026-08-19）

- 门 RC：合并前 `node scripts/check-prd-data-grounding.mjs` → **RC=0**（违规 0 / 未判定 36 /
  金丝雀 5+11 全中）；合并 `audit` 键后复跑 → **RC=0**（同上，逐字一致）。
- 零字节纪律：`scripts/check-prd-data-grounding.mjs` 与 `scripts/gate-ledger.json` 全程未触碰
  （`git diff` 为空）；棘轮值 ratchetHigh=0 / maxExemptions=0 未动；exemptions/adjudicated 保持空。
- 基线 diff 形态：纯新增信息键 `audit`（244 行），对既有四键的唯一机械改动是
  `"exemptions": []` 行尾补逗号。
- 旧分支迁移：**0 条**（8ed7727b6 内容已全量在基线树上，见 §0）。
- 勘误（2026-08-19 复验退回一件）：PRD-query-orchestration-service 初判真缺口系误分——
  其 line 24 + §7.6 明列「必须内置」的 Mock 种子包（12 基地/6 型号/20 订单/C03·C08·C13/常州行级过滤），
  已按 v3 判据改判误报；真缺口 12→11、误报 47→48。复验方抽查其余 8 份未抽真缺口同类扫描零命中，
  孤例性成立。改后复跑门 RC=0 不变。
