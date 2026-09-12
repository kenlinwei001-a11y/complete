# PRD 增量 · 管理面引用闭合性与执行计划编辑器（客户自助配置验收）

| 项 | 值 |
|---|---|
| 版本 | v1.0（验收级缺陷修复：真实系统验收发现"绑定执行计划"为死路；修订 QOS-PRD §4.2/§8.4、管理平台增量 §4、前端 PRD §7.8；基线裁决 #27） |
| 触发 | 客户验收："意图目录可绑定执行计划，但执行计划无创作页面，下拉框点击无法进入下一级" |
| 性质 | 类别级缺陷——所有"引用型下拉/绑定"的闭合性，非单页面 bug |

## 0. 本体引用与影响（补录）

> 遗留 PRD 追溯补录（治理 #2，prd:check 入图）；仅引用平台真实不变量(§5 R1–R14)/断点(§8 G-1..G-8)。

- **触及不变量**（§5）：R1 · R3
- **触及断点**（§8）：G-4
- **范畴**：管理面引用闭合 + 执行计划编辑器（自助创建无死路）

## 1. 概念澄清（先消除根因：ExecutionPlan 与 Workflow 是同一资源）

**裁决**：平台内只有**一个** workflow 资源类型，承载两种用途：
- 路径 A 用途（QOS 意图绑定的"执行计划"）= 步骤为 query_objects/invoke_solver/evaluate_rules/render_answer/create_action_draft 的声明式计划；
- 编排用途（B2 的 workflow）= 额外含 invoke_agent/invoke_mcp_tool 步骤。

二者**同表同编辑器同 CRUD**，仅 `kind: "PLAN" | "ORCHESTRATION"` 区分（kind 由步骤类型自动判定：含 invoke_agent/invoke_mcp_tool → ORCHESTRATION，否则 PLAN）。
- 表/资源统一命名 `workflows`（ID 前缀 `wf_`）；`ExecutionPlan` 为其 kind=PLAN 的别称，文档与 UI 统一显示"执行计划/工作流"，**不再作为两个独立资源**；
- 意图 `planRef.planKey` → 改为 `workflowRef: { key, version }`，绑定下拉只列 `kind=PLAN` 且 `status=PUBLISHED` 的工作流（kind=ORCHESTRATION 不可被意图直接绑定——它从 agent 工具或独立触发）；
- nav 的"Workflow"页 = 这唯一资源的创作页，含 PLAN/ORCHESTRATION 两个 tab 过滤。

**对既有文档的覆盖**：QOS-PRD §4.2 ExecutionPlan = workflows(kind=PLAN)；§8.4 的 plans 端点并入 §3 的 workflows 端点；20 场景目录 §6 的 p_* 计划 = kind=PLAN 工作流种子。

## 2. 管理面引用闭合性总原则（强制，全管理台适用）

**任何配置页中指向其它资源的引用控件（下拉/绑定/多选），必须满足三条，缺一即验收不通过：**

1. **可达**：控件旁有"＋新建"按钮，点击→内联创建抽屉或跳转目标资源创作页（带返回锚点，创建后自动回填并选中）；
2. **空态有路**：被引用资源列表为空时，下拉位置显示"尚无{资源名}，点击创建"，绝不出现无选项的死下拉；
3. **可查看**：已选项旁有"查看/编辑"图标→跳目标资源详情（带返回）。

**引用控件清单（逐一落实，§6 验收逐条核对）**：

| 来源页 | 引用控件 | 目标资源（创作页） |
|---|---|---|
| 意图编辑器 | 绑定执行计划 | workflows(kind=PLAN)（§3 编辑器） |
| 意图编辑器 | 槽位 type=objectRef 的对象类型 | 本体对象类型（本体建模页） |
| Agent 编辑器 | skills 多选 | Skill 库 |
| Agent 编辑器 | tools 中 workflow 引用 | workflows |
| Agent 编辑器 | mcpServers 多选 | MCP 配置页 |
| Agent 编辑器 | ruleBindings 规则多选 | 规则库 |
| Workflow 步骤 | invoke_solver 的 solverKey | 求解器目录（只读发现页，§4） |
| Workflow 步骤 | invoke_agent 的 agentKey | Agent 库 |
| Workflow 步骤 | evaluate_rules 的 ruleIds | 规则库 |
| 场景入口编辑器 | defaultAgentKey | Agent 库 |
| 场景入口编辑器 | intentCatalogFilter | 意图目录 |
| 权限策略编辑器 | role | 角色清单（用户管理页） |

## 3. 工作流/执行计划编辑器（补缺的核心页面，/admin/workflows）

**列表区**：PLAN/ORCHESTRATION/全部 三 tab + 状态筛选；行显示 key/名称/kind 徽章/版本/状态/被引用数（点击看引用方）。

**编辑器（DRAFT 可改）**：
1. 基础：key（发布后不可改）、显示名、kind（自动判定只读显示）；
2. **步骤序列编辑器**（核心）：
   - 步骤列表，每步：类型下拉（query_objects/invoke_solver/evaluate_rules/llm_compose/render_answer/create_action_draft/invoke_agent/invoke_mcp_tool）+ 该类型的参数表单；
   - 参数中的资源引用（solverKey/agentKey/ruleIds）遵循 §2 闭合原则（带＋新建/查看）；
   - 模板值输入 `{{slots.*}}` `{{steps.*}}` 带自动补全（来源=该工作流绑定意图的 slots + 前序步骤 id，QOS-PRD 已规定）；
   - 步骤上移/下移/删除/插入；前向引用即时校验（引用未来步骤标红）；
3. **render_answer 可视编排**：block 模板（text/table/kpi/rule_violation/action_draft）增删，值绑定到 `{{steps.x.output.path}}`；
4. **测试运行**：编辑器内"试运行"按钮——选一组样例槽位值→调 `POST /b/v1/workflows/{id}/run`（既有同步端点）→ 内嵌展示步骤时间线与渲染结果（所见即所得，客户自助验证的关键）；
5. **发布**：发布校验（QOS-PRD §4.2 全部：前向引用/render_answer 必为末步/ACTION_DRAFT 越级/环检测/嵌套深度）→ 错误定位到具体步骤行；通过→PUBLISHED 并自动在意图编辑器的绑定下拉中可见。

**API**（统一资源模式，并入既有）：
```
GET/POST/PUT  /b/v1/workflows[?kind=&status=]
POST /b/v1/workflows/{id}/new-version | /publish | /retire
GET  /b/v1/workflows/{id}/references          被引用清单
POST /b/v1/workflows/{id}/run                 试运行（OBO）
POST /b/v1/workflows/{id}/validate            发布前干校验（编辑器实时调用）
```

## 4. 求解器目录页（只读，补 invoke_solver 引用的目标）

求解器是代码注册非用户创建，但引用它必须能查：`/admin/solvers`（只读）列出全部已注册求解器的 key/名称/description/argHints（能力发现增量 §1 的 description 在此复用）；workflow 步骤的 solverKey 下拉数据源即此页 API `GET /b/v1/solvers`（已存在于能力路由增量的 discover，此处补一个管理台只读列表端点）。空态文案："求解器由平台提供，如需新增请联系实施"——这是合法的"不可自助创建但可见"边界，需显式声明而非留死路。

## 5. 逐页缺陷审计（举一反三：执行计划只是同类问题之一）

> 审计标准（八项）：创建 / 编辑 / 发布版本 / **引用闭合（无死路）** / **输入辅助（DSL 与表达式不能裸输）** / 试运行预览 / 删除退役带引用检查 / 空态引导。下表只列**已发现的具体缺陷**（同执行计划那种程度），每条都是验收不通过项，须在实现中补齐。

| 页面 | 已发现的具体缺陷（验收必修） |
|---|---|
| **意图目录** | ① 绑定执行计划=死路（§1/§3 已修）；② **槽位 type=objectRef 时缺"目标对象类型"字段**——objectRef 不指定解析到哪类对象，则无法校验/搜索（截图中槽位只有 name/type/required/clarify，缺 refType）；③ 无"分类测试"——改了 examples/description 后无法当场验证示例问句是否真能命中本意图（应内联调分类器试跑） |
| **工作流/执行计划** | **整页缺失**（§3 新建）：步骤编辑器、模板值补全、render_answer 可视化、试运行、发布校验定位 |
| **本体建模** | ① **缺域归属选择器**（治理增量定为发布强制，UI 未落）；② 属性缺 **unit/displayFormat** 录入（工业系统硬需求）；③ PATCH 操作要支持**新增关系类型/合并实体**入口，不能只改属性；④ 发布缺**域 owner 会签**流程页（治理 §7.1 状态机无 UI）；⑤ 对象类型的 searchable 标记无勾选位（搜索功能依赖它） |
| **规则库** | ① **DSL 编辑器缺自动补全**——`Order.demandDelta` 需对象类型/属性联想，否则盲写非自助；② 规则 scope 的对象类型引用未闭合（无＋查看）；③ dry-run 的 samplePayload 应能从真实对象一键填充而非手敲 JSON |
| **权限策略** | ① rowFilter 表达式同样缺 DSL 补全；② `${user.attr}` 引用缺**用户属性注册表/选择器**——客户不知道有哪些属性可用（baseScope 等）；③ 资源选择（对象类型/连接器/Action 类型）未闭合 |
| **Agent** | ① scopeDeclaration 的 objectTypes/toolNames 多选须引用本体与工具注册表（闭合）；② systemPrompt 缺模板骨架与变量提示；③ model 选择须引用 **LLM Provider 用途矩阵**而非裸字符串；④ **"跑评测"依赖评测用例存在，但评测用例无编辑页**（见 §6 缺失页）；⑤ ruleBindings/skills/workflow/mcp 四处引用全部要闭合 |
| **Skill 库** | ① lint 结果需**逐行内联**定位（不能只给通过/拒绝）；② **发布要求 ≥3 评测用例，但无评测用例编辑入口**（同 Agent，指向 §6 缺失页）；③ summary 的触发模板需实时模板校验提示；④ resource 引用 `{{resource:name}}` 需可解析校验 |
| **MCP** | ① 凭据 write-only 录入（保存后显 ••• 已配置）；② **toolFilter 鸡生蛋**——过滤工具前必须先"连接测试"拉到 tools/list，UI 须强制先测试再过滤；③ 等价能力组 capabilityGroup 字段（能力路由增量）无录入位 |
| **场景入口** | ① viewKey 须引用**视图配置**（闭合，且不能绑到不存在的视图）；② suggestedQuestions 自由文本但应可校验是否命中现有意图（否则前台点了无反应）；③ **presetContext 编辑器缺失**（启动器增量要求每场景预置选中对象/槽位，无录入页则一键推演会被反问） |
| **LLM Provider** | ① model 能力（tools/structuredOutput/maxContext）勾选位；② **用途矩阵 Tab**（6 用途×provider 绑定，能力不足项禁用）；③ 单价录入（成本看板依赖）；④ fallback/capabilityGroup 选择 |
| **视图配置** | ① **dashboard 的 widget 编辑器缺失**——加一张 KPI 卡/图表需可视化配 widget 的数据声明（聚合查询构建器），否则客户改不了驾驶舱；② renderer 选择（12 选 1）；③ 导航分组与排序；④ graphOptions 八视角配置表单（图谱类视图） |
| **数据连接器** | ① configSchema **动态表单生成**（按 connectorType 渲染，secret 字段特殊处理）；② 文件上传后字段画像页；③ 同步调度 cron 录入（OpsSchedule 关联） |
| **合成数据** | ① **A9 数据工坊编辑器**（提示词框 + 配置器三栏 + 直方图预览）是否在 nav——A9 规格有、入口未在审计内确认；② 模拟时钟控制台（推进/重置/剧本） |
| **功能开通 / 校准报告 / 兜底统计 / Action 审批 / 用户管理** | 这些主体合规；校验点：校准的"批准提案"须走 Action 审批（不可直改）；兜底的 promote 生成 DRAFT 意图后须跳意图编辑器续填；Action 审批须有审批链可视；用户管理参数化角色（base_manager:常州）需"角色+参数"两段录入 |

## 6. 整页缺失清单（不只执行计划——审计发现 7 个被引用却无创作页的资源）

| # | 缺失页 | 谁引用它（死路来源） | 须补规格出处 |
|---|---|---|---|
| 1 | **工作流/执行计划编辑器** | 意图目录、agent 工具 | §3（本文已补） |
| 2 | **评测用例编辑器** `/admin/evals` | Agent 发布门禁、Skill 发布门禁（各需 ≥3 用例）、20 场景目录自动派生 60 用例 | 评测体系 OC2——补：用例 CRUD（input/expect 表单）、套件管理、从兜底/任务一键转用例、跑套件出报告 |
| 3 | **本体切片编辑器** `/admin/slices` | 工作流 resolve_slice、agent、GenSpec、discover 目录 | 本体核心 §3 有 SliceSpec 结构、无 UI——补：root+hops 可视化构建、contractFixture 录入、试切预览子图 |
| 4 | **域管理页** `/admin/domains` | 本体对象类型归属、域级权限/功能开通、域 owner 会签 | 治理增量 §1——补：域 CRUD、owner 指派、域内资源总览 |
| 5 | **运营自动化页** `/admin/ops-schedule` | 真实租户的定时预测/S&OP 自动开启/审批催办 | 回放增量 §6 OpsSchedule——补：cron 配置、催办/升级规则、autoApprove 开关（默认关） |
| 6 | **数据工坊页** `/admin/data-forge` | 合成数据、运营态、A9 全部 | A9 §2 三种创作方式——确认进 nav 并实现三栏配置器+提示词框 |
| 7 | **运营页组**：合并队列/隔离区/配置迁移/通知中心 | 实体解析、A9 异常、多客户交付、各类待办 | 运营完备性增量——四个页面均需入 nav 与实现 |

**新增导航分组建议**（避免 nav 过长）：把管理台分组为「内容配置」（本体/域/切片/规则/意图/工作流/agent/skill/mcp/场景/视图/评测/功能开通/LLM）｜「数据」（连接器/合成数据/数据工坊/隔离区/合并队列/配置迁移）｜「运营」（Action 审批/校准/兜底/运营自动化/通知）｜「治理」（用户/权限）。

## 7. 通用输入辅助规范（§5 多处"裁输"缺陷的统一解法）

凡涉及平台 DSL（规则表达式 / 派生公式 / rowFilter / 模板值）的输入框，必须提供：① 对象类型与属性的**自动补全**（数据源=本体元模型）；② 实时语法校验+错误位标注；③ 旁置"测试"按钮（dry-run/试运行）。裸文本框输入 DSL 即验收不通过（裁决表追加 D-28）。

## 8. 验收用例（自助配置闭环，全自动化 + 关键人工巡检）

| # | 用例 | 预期 |
|---|---|---|
| AC1 | 意图绑定工作流 | 绑定下拉列 kind=PLAN 已发布工作流；空列表显示"创建工作流"入口；＋新建跳编辑器、发布后自动回填选中 |
| AC2 | 工作流编辑器全流程 | 新建→加 invoke_solver（solverKey 下拉来自求解器目录带查看）→render_answer→试运行出结果→发布校验通过→意图下拉即可见 |
| AC3 | 发布校验定位 | render_answer 非末步/引用未来步骤/ACTION_DRAFT 越级 → 错误精确定位到步骤行 |
| AC4 | **objectRef 槽位闭合** | 槽位选 objectRef 后出现"目标对象类型"下拉（引用本体）；不选则发布被拒 |
| AC5 | **DSL 输入辅助** | 规则/权限/公式编辑框输入"Order."弹出属性补全；裸文本框无补全即不通过（D-28） |
| AC6 | **七个缺失页存在性** | §6 七类缺失页（工作流/评测/切片/域/运营自动化/数据工坊/运营页组）均在 nav 可达且可创建首个资源 |
| AC7 | 引用闭合全遍历 | 自动遍历 §2 全部 12 引用控件 + §5 各页引用：每个＋新建可达、空态有路、已选可查看（任一死路即红） |
| AC8 | **端到端零代码自助** | catalog_admin 从零建场景（建切片→建工作流→建意图绑定→建 agent 挂 skill→配场景入口）→前台触发→推演出结果，全程不碰代码、不遇死路、不被反问 |
| AC9（人工巡检） | 全部管理页逐控件点击 | 无"可点但无反应/无下一级"的控件；每个声明为不可自助的边界（如求解器）有明确说明文案 |

## 9. 实施手册修订

- W17 扩展为含 §3 工作流编辑器完整规格；W19 资源 CRUD 引用控件一律按 §2 闭合原则；
- **新增工单**：W39 评测用例编辑器、W40 切片编辑器、W41 域管理+会签页、W42 运营自动化页、W43 运营页组（合并/隔离/迁移/通知）、W44 视图 widget 编辑器+数据工坊页；插入于前端工单段；
- 裁决表追加：**D-27 任何引用型 UI 控件必须实现"选择/＋新建/查看"三态，禁止裸下拉**；**D-28 任何 DSL/表达式输入必须带对象-属性自动补全+实时校验+试运行，禁止裸文本框**；
- 验收 AC1–AC9 纳入 VLE 的 UI 子集（SMOKE 跑 AC4/AC5/AC7 机械项，FULL 跑 AC8 端到端，AC9 人工巡检清单随每次 UI 发布执行）。

## 10. 验收基线声明（回应"客户可自己配置自己使用"的总判据）

**自助验收通过 = AC8 成立**：一个客户管理员，**不接触任何代码、不遇任何死路控件、不被任何未配置反问**，能从零搭出一个可推演的新场景。本文 §5 的逐页缺陷与 §6 的缺失页全部修复，是 AC8 成立的必要条件。在此之前，系统是"开发者可用、客户不可自助"的状态——这正是本次真实验收暴露的差距，不是个别页面的 bug。
