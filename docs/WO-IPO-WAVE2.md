# WO 集 · IPO 逐页审计第2波（业务看板+推演+规划+资源+运营 5 簇·后端有真值→前端无处可见/导航死路/假值冒充）

> **由来**：接 `WO-VISIBILITY-CHAIN.md`（首波 3 路自动扫 17 断层→5 WO）。审核方按用户 IPO 方法（每个展示数据的 I 上游页 / P 处理过程 / O 下游页可见可导航否）派 **5 个并行审计 agent** 逐页遍历首波未覆盖的簇：**决策看板**(dashboard/risk/ledger/review/graph)·**推演**(plan-audit/generate/project-sim/sop)·**规划**(annual/quarterly/order-chain/geo)·**规则求解器场景资产**(rules/ruledocs/solvers/scenes/agents/wf/skill/mcp)·**IAM运营系统**(schedule/llm/decisions/simclock/…)。
> **合并 21 断层（去重后·3 P0 → 归 2 P0·10 P1·8 P2）**，均"后端 curl/静态可证有真值 X · 前端整块无处可见/导航死路/藏别处/假值冒充"。拆 **6 WO 入 dev loop**。
> **诚实**：D2 簇 ~15 页 IPO 健全无断层（Tenants/Users/Permissions/Features/Synthetic/Validation/Evals/Merge/Domains/Boundary/ConfigMigration/Meta/Growth/PrototypeIntake/Catalog），不凑数。审计全程无运行服务，后端 oracle 为静态路由/契约证据；每单验收仍真 curl+真浏览器。

## §0 全景（5 簇合并·file:line·后端 oracle）

### 决策看板簇（Agent A）
- **[已覆盖 KILL-MOCK-RED]** DashboardView PlanDrillWidget 月/季/年 KPI 投影(×0.97/1.04)当真红无诚实位·ProblemPanel/OrderLedger/handleExport 财务(PARTIAL 哈希)当真值——`DashboardView.tsx`（阶段②已列 DashboardView·**复验加验点**：投影档+导出路径也须挂 dataMode）。
- **[已覆盖 VIS-SIGNALS C4]** OntologyGraphView 类型节点无"→实例"深链、实例数不可见（真值在 `object-types/stats`）。
- **[P1·新]** LedgerView 行无任何下游导航（what-if/风险/order-chain/action 端点齐·`LedgerView.tsx` 全文无 navigate）。
- **[P2·新]** ReviewView 空态"先运行 livedIn 合成"无深链。

### 推演簇（Agent B·★P/O 层已真接后端·断在 I 层）
- **[P0·新]** 场景 presetContext/slotPresets 到不了推演视图求解器入参：project-sim `demandDelta`（后端 `capacity.ts:176` 支持·前端 `ProjectSimView.tsx:242` 不发）、plan-audit `cashCushion`（`plan.ts:8` 支持·`PlanAuditView.tsx:79` 恒用基线）、plan-generate goals、sop-balance。根：`ViewRendererProps`(`registry.ts:4-6`) + `sessionStore`(`sessionStore.ts:11-13`) 无 presetContext 通道 → 关联本体 G-3。
- **[P1·并入]** sop 步②④示例占位可点"运行"喂 C21/C15/C18 裁决（有 DataModeBadge 缓解未硬阻断）。
- **[P2·并入]** useQuickLaunch 落点视图(自算) vs QOS 答案(落 Dock) 双 surface 割裂（G-3 接缝·slotPresets 前端无落点字段）。

### 规划簇（Agent C）
- **[P1·新]** GeoMapView「在图谱查看」发 `focus=n-base`（小写），真后端节点 id=`n-Base`（`app.ts:2221` `n-${t.key}`·类型键 Base 大写）→ 图谱开但不聚焦（软死路·mock/test 全绿掩盖·`GeoMapView.tsx:235`）。
- **[P1·新]** OrderChainView 综合毛利率旁路 `Σgp/Σsales` 自算（`OrderChainView.tsx:103-137`），不接同 `affected_orders` 求解器已产权威可勾稽 `marginLedger`（`risk.ts:843`·VM `types.ts:285` 已就绪·驾驶舱/沙盘已切唯订单页没切·同数据两口径丢溯源）。
- **[P2·新]** QuarterlyRollingView 需求线 dem 无上游溯源/无跳年度分解（`QuarterlyRollingView.tsx:81`）·AnnualScenarioView 缺口窗口 badge 无下游导航（`AnnualScenarioView.tsx:92`）·OrderChainView 财务判 creditUsedRatio/priceUpPct 未并列（`OrderChainView.tsx:497`）。

### 规则求解器场景资产簇（Agent D1）
- **[P0·新]** SolverBinding 前端零可见零可激活（G-17 命门）：后端 CRUD+自动 DRAFT 草案+activate 齐（`app.ts:2484-2525`·`ontology.ts:212`），前端 `solver-binding` 零命中·`SolversPage` 仅显 argHints 文本 → "上传自有类型→求解器认得→真答案"链前端物理走不通（补 DONE 的 SOLVER-BINDING 后端之前端缺口·该 WO 验收全 curl/gate 无 browser）。
- **[P1·新]** 反向引用图"被谁引用"：后端 `computeReferences`（agent/wf/skill/mcp/solver·含被场景引用·`resources.ts:101-196`·`server.ts:776/1038/1252/1523/1054`）前端仅 `fetchRuleReferences` 消费·各资源页无"被引用(n)"区。
- **[P1·新]** RuleDocs↔Rules 双向溯源（`publishedRuleId`/`origin.docId` 都存·`ruledocs.ts:528/520`·两端都不透）·ScenesPage 行内 agent 缺列/intent/view/启动器落点不可导航·WorkflowsPage `invoke_mcp_tool` mcpConfigId 裸文本无 picker·McpPage 凭据/ERROR 健康状态列表不可见（`agentcore.ts:132` status 含 ERROR·`McpPage.tsx:34` ERROR 落空色）。
- **[P2·新]** SolverReview 晋升 GOVERNED 后下游去向不可导航·RulesPage 展开只显 expression 不显 params 命名阈值。

### IAM运营系统簇（Agent D2）
- **[P1·新]** OpsSchedulePage scheduler_runs 执行状态全不可见（`app.ts:3654-3668`·`scheduler.ts:98-154` RUNNING/SUCCEEDED/FAILED/MISSED+error·`endpoints.ts` 零 scheduler 端点）——配了就跑跑了看不见成败（SCHEDULED_FORECAST 失败=校准断供·SOP_AUTO_OPEN 失败=月流程没开）。
- **[P1·新]** LlmProvidersPage LLM token 用量/预算配额全不可见（`app.ts:1020-1033` budgetStatus·`usage7dTokens` 死列·`llm-budgets` 前端零命中）。
- **[P1·新]** DecisionsPage 决策溯源链 links 纯文本不可导航（`DecisionsPage.tsx:145`）+ 数据层根本没捕获（`CreateDecisionForm` 无 links 输入→恒空·R13 双层未接）。
- **[P2·新]** SimClockConsole tick 告警/属性变更不可跳规则/对象·ExternalSignalsPage 信号上游连接器不可导航。

## §1 WO 拆分（6 单入 loop·IPO 验收锚：后端得 X → 前端对应页显同 X + 上下游可导航）

### WO-SIM-PRESET-INJECT（P0·推演 I 层单根：场景上下文注入推演视图）
- 修：`ViewRendererProps` + `sessionStore` 增 `presetContext`（含 `slotPresets`）单一通道；useScenarioLaunch 把 slotPresets 写入；4 个推演视图（project-sim/plan-audit/plan-generate/sop-balance）初始化读它并合并到各自表单/求解器入参（project-sim 传 `demandDelta` 入 capacity_forecast·plan-audit 覆盖 cashCushion·plan-generate 覆盖 goals·sop 选版本/月份）；sop 步②④未改示例值时对 run 软阻断/强确认。
- IPO 验收：真浏览器从场景启动器点 S01「4680-NCM 加 20% 六周能不能接」→ 落 project-sim → **视图内型号=4680-NCM·增量=20%·出对口推演**（非 models[0]×40 万整单）；curl `capacity_forecast` 带 demandDelta 返对应结果=前端所见。P/O 层不回归（求解器真接·adopt→action-drafts 通）。

### WO-SOLVER-BINDING-UI（P0·G-17 命门：绑定可见+DRAFT 草案激活 UI）
- 修：SolversPage 每行展开显该求解器 `roleBindings`（role→typeKey/fieldMap·DRAFT/ACTIVE 徽章）·加"激活草案"按钮接 `POST /a/v1/solvers/:key/activate`·"建议绑定"接 `/bindings/suggest`；`endpoints.ts` 补 solver-binding 端点。
- IPO 验收：真浏览器 realco 上传自有类型+发布本体（触发自动 DRAFT 草案）→ SolversPage 展开某求解器**看到 DRAFT 绑定草案**→ 点"激活"→ 变 ACTIVE → 随后 invoke 该求解器出真答案（前端全程可达·不再只能 curl）。curl `/bindings` 返绑定=前端所见。

### WO-BIZVIEW-DOWNSTREAM（P1·业务视图下游导航+权威值接线）
- 修：①LedgerView 行/展开区加"就此对象开 what-if / 看风险 / 起 action 草案"深链（复用 useOpenWhatIf/useActionDraft）②OrderChainView 综合毛利率/毛利合计接 `out.marginLedger`（复用 DashboardView 勾稽 details 组件·econTable 保留库存估算列+"估算"披露）③GeoMapView 图谱下钻改 `focus=n-Base`（或图谱定位大小写不敏感）+ mock/test 对齐真后端键。
- IPO 验收：①台账点越期订单→可跳 order-chain/开 what-if（location 变）②订单全链毛利率==`affected_orders.marginLedger.gmRatePct`（curl 得同值·带 reconciled✓）③geo 点基地「在图谱查看」→图谱**聚焦选中**该 Base 节点（非空跳）。

### WO-RESOURCE-REF-NAV（P1·资源反向引用图+导航透出）
- 修：①各资源编辑器（agents/workflows/skills/mcp/solvers）加"被引用(n)"只读区接对应 `/references` 端点·列 kind/name/via 可点跳引用方②ScenesPage 行内加 agent 列（跳 /admin/agents）·intent/view 做链接·发布态加"在启动器打开→"③RuleDocs APPROVED 卡加"→查看规则"链接（补 `publishedRuleId`）·RulesPage DOCUMENT 行加"源文档"链接④WorkflowsPage `invoke_mcp_tool` mcpConfigId 改 ReferenceSelect⑤McpPage 列表徽章按 status 三态着色（ERROR→红）+已配凭据徽章。
- IPO 验收：agent+skill 引用某规则/求解器/MCP→打开该资源"被引用"区**列出引用方且可点跳**（curl `/references` 得同集）；RuleDocs 批准候选→点"查看规则"落 RulesPage 该规则；MCP ERROR 态列表显红。

### WO-OPS-GOV-VISIBILITY（P1·运营/治理三盲区透出）
- 修：①OpsSchedulePage 每作业加"状态+最近运行"面板（`GET /scheduler/jobs` 显 nextRunAt/lastRunAt/lastError + 展开 `/jobs/:id/runs` 红绿表 + pause/resume）②LlmProvidersPage 加"本月配额"横幅（`GET /llm-budgets` used/soft/hard/降级徽标）+ 移除或真接 usage7dTokens 死列③DecisionsPage links 按 kind 渲染深链（ACTION_DRAFT→/admin/actions 等）+ CreateDecision/mitigation 采纳流补 links 捕获·`endpoints.ts` 补 scheduler/llm-budgets 端点。
- IPO 验收：①注册定期作业→跑一轮→调度页显该 run 成/败（curl `/jobs/:id/runs` 得同条·失败显 error）②记 token 用量→配额横幅显 used/soft/hard（curl `/llm-budgets` 同值）③做决策带 link→详情 links 可点跳目标页。

### WO-VIS-SIGNALS-2（P2·透出批）
- 修：①ReviewView 空态深链跳合成/DataBuilder②QuarterlyRolling 需求条加 Provenance/跳年度分解③AnnualScenario 缺口窗口 badge 加下钻链接④OrderChain 财务判补 creditUsedRatio/priceUpPct 并列⑤SolverReview 晋升后加"查看目录中此求解器→"⑥RulesPage 展开补 params 小表⑦SimClock tick 告警/变更加深链⑧ExternalSignals source 加连接器深链。
- IPO 验收：逐条真浏览器验（空态有深链·窗口可下钻·财务值并列·params 可见·信号源可跳）。

## §2 本体引用与影响
- **链路**：场景启动器→presetContext→推演视图求解器入参（补 G-3 视图侧注入接缝）·SolverBinding activate（G-17 命门前端）·computeReferences 反向引用图（§3:238）·scheduler_runs/llm_budgets/decision.links→前端消费·RawDataset→marginLedger 权威勾稽。
- **断点**：**G-VIS-1**（后端产物真存·前端无处可见/导航走/藏别处·本 WO 集主治）·**G-3**（presetContext 未注入·此处补视图侧）·**G-17**（SolverBinding 命门·此处补前端 activate UI）·G-10（规则 params 展示）·R13（决策/tick/信号溯源可导航）。
- **不变量**：R11/R12 全链闭包（对象→切片/字段→消费·UI 须把"数据走到哪"显性化）·R13（结论可溯源·决策 links/调度成败/预算/引用图可见）·R6（行级权限效果已由 authz explain 透出·健全不动）。
- **回写**：本 WO 集落地后回写 §8 G-VIS-1（扩例）+ §3 场景注入接缝可见接续 + G-3/G-17 前端侧标注。

---
*审核方 IPO 第2波（5 簇并行审计·21 断层去重→6 WO 入 loop·后端 oracle 静态实证·2 DONE 后端 WO 前端缺口诚实surface·D2 ~15 页健全清账不凑数）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
