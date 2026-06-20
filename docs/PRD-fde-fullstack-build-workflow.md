# PRD · FDE 全栈倒推工作流（故事 → 具体化 → 倒推 → 双层索引 → 数据模拟 → 复用各模块 create → 闭环可推演）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-20 |
| 取代/扩展 | **扩展** A7「数据构建发动机」(`apps/datacore/src/databuilder/`) · `PRD-unified-build-engine.md` · `PRD-fullstack-story-build-g8.md` · `PRD-demand-pulled-growth-engine.md`；落实 `docs/AUDIT-hand-run.md` 暴露的核心差距与 `docs/LOOP-runbook.md` 决策门 |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md` · `.claude/skills/fde-delivery/SKILL.md`（交付纪律：完成=亲手用一遍能用）· `docs/AUDIT-hand-run.md` |
| 核心一句话 | 把「数据构建发动机」做成一条**模拟 FDE 专家工作的确定性编排 workflow**：用户故事 →（消歧成具体实体）→ Kimi-comprehend 倒推推演所需 schema + **场景拓扑** → 据**两层索引（能力索引 + 实体与字段目录索引）**比对系统缺什么 → **构造"被问现象真实存在"的合成数据** → **复用各模块已有 create（全 DRAFT 经 R4 审批）** → 全链闭包 → publish 进场景启动器 → 重跑验证真能答。缺的求解器（代码）走 generic_inference 兜底 / 自成长工单，不假装能答。 |

## 0. 本体引用与影响（强制 · 不填即未读本体）

- **触及对象类型**（本体 §2）：BuildPlan / BuildJob / ClosureReport / DataBuilderAgent · StoryBuildRun / InputManifest · GapReport / GrowthTicket · OntologyType / SliceSpec / Rule / Solver(SOLVER_KEYS) / Connector / RawDataset / ObjectInstance · Intent / ExecutionPlan / Workflow / Skill / Agent / Scenario(一等) · LlmProvider / LlmPurposeBinding · SystemObjectType 等元对象。**新增对象类型（回写 §2）**：**EntityFieldCatalog**（实体与字段目录索引：实体名→类型/id、类型→字段 schema 含时序标记、样本值；倒排可检索）· **SliceIndex**（生成切片的描述 + 索引实体，供检索复用）。**读模型（不入 §2，非持久真值）**：**CapabilityInventory**（schema 级能力清单：类型/规则/求解器/切片，读 repos + 元本体）。
- **触及链路**（§3）：数据构建发动机链（StoryScript→消歧→comprehend→inventory-diff→数据模拟→闭包→publish→launcher，扩到 B 栈与全链）· 编排链 `Scenario→Intent→Plan→Solver→render` · 数据→本体→推演链 · 数据→本体→推演链的合成支线（SyntheticJob→Connection+RawDataset→materialize）。**新接缝**：BuildPlan → 各模块 create 端点（连接器/对象/规则/切片/意图/计划/场景/Agent）。
- **触及事件/数据流**（§4，遵守 R10 D-29）：复用 `storybuild.run_recorded` · `growth.gap_detected/fill_proposed/ticket_opened/converged` · `entity.out_of_domain`（L16，消歧失败信号）· `ontology.published/materialize.completed/rules.updated/dataset.regenerated/intent.published/scenario.published`。**新增 1 个**：`capability.indexed`（实体与字段目录/切片索引重建完成 → 失效检索缓存；登记 §4，事件号顺延，不占已用号）。
- **触及不变量**（§5，R1–R14）：
  - **R2 tenant_id everywhere**：两层索引、CapabilityInventory、生成数据全带 tenantId；跨租户零可见。
  - **R4 真值经 Action**：发动机触发的一切 create 一律落 **DRAFT，经审批/publish 才生效**（与"人在 UI 点创建"同一道闸；不绕审批写真值）。
  - **R6 确定性**：消歧→comprehend→数据生成 同 (故事+具体实体+seed) 字节级一致；LLM 输出经 freezePlan 封存重放；测试 LLM 一律 mock。
  - **R9 仓储双实现**：EntityFieldCatalog / SliceIndex 新表需 migrations + repo/pg.ts + repo/memory.ts + repo.ts 四处同改。
  - **R11 全链闭包**：故事→意图→计划→求解器(输出形状匹配渲染)→渲染 全链不接通即拒发布；缺求解器诚实暴露（不空心、不谎报 ANSWERABLE）。
  - **R12 双向闭包 / 字段全建模**：每个字段实体被 ≥1 本体切片覆盖（软提示门，对齐数据接入控制台诉求）。
  - **R13 可溯源**：StoryBuildRun 留全血缘；生成数据走正门可溯回 RawRow。
  - **R14 应用层无业务常数**：行业分类 / Kimi provider / 模型 id 全 config-drive，不写死前端。
- **关闭/影响的已知断点**（§8）：主修 **G-5**（去电池锁死：任意行业故事 → 全栈自动生成 + 听懂任意业务语言）· **G-8**（数据构建闭包跨全链 + 真能答）；协同 **G-3**（场景 publish 进启动器可推演）· **G-6**（数据模版/合成统一 + FK 一致）· **G-7**（新增 comprehend LLM 用途绑定 Kimi）。
- **需走的检测门禁**（§7）：闭包门（升全链 CHAIN+SHAPE）· validate · 准备度 · A6 行级过滤 · VLE · 断链审计 · `ontology:check` · `chain:check` · `prd:check` · `debattery:check`。
- **回写承诺**：落地后回写本体 §2（EntityFieldCatalog / SliceIndex 新对象；CapabilityInventory 标读模型）· §3（消歧链路 + BuildPlan→各模块 create 接缝 + 多跳切片生成链）· §4（`capability.indexed`）· §5（R11 跨系统构建时强制 · R12 切片覆盖软门）· §7（切片覆盖门）· §8（G-5/G-8 进度、G-3/G-6/G-7 触及）。

## 1. 目标 / 非目标

### 1.1 目标
1. **发动机 = 确定性编排 workflow + 单个 Kimi-comprehend 节点**：固定阶段、可重放(R6)、逐节点状态可观测；唯一不确定环节是"听懂故事"，封装为带 schema+freeze 的 Kimi LLM 节点（非放养 agent）。
2. **问题消歧成具体实体**：模糊指代（C客户/D客户）必经实体目录索引 + 最近邻解析为具体实体名；歧义/缺失 → InputManifest 补录，**绝不带占位符进数据生成**。
3. **两层索引知现状 + 算缺口**：① 能力索引(schema)；② **实体与字段目录索引(instance/value，含时序字段)**——元本体只到 type key，不含实例/字段/时序，故第二层必建。comprehend 倒推的"需求清单" diff 两层索引 → 建之前就知缺什么。
4. **数据模拟 = 构造"被问现象真实存在"的世界**：不是造类型对的随机行，而是由 comprehend 输出 **scenarioTopology**（共享资源边 + 植入的争用/越线值）→ FK 一致确定性生成，让求解器能真找出"共享瓶颈/谁挤占谁/哪张单降级"。
5. **复用各模块已有 create（全 DRAFT 经 R4 审批）**：发动机不另开写路；触发连接器/对象/规则/切片/意图/计划/场景/Agent 的既有 create。补两缺口：① 本体切片库前端"创建"UI；② 求解器不可运行时创建 → generic_inference 兜底 / 工单。
6. **多跳本体切片（两库读模型 + 索引）**：域内本体库（域内子图）+ 跨域本体库（跨域桥，面向业务分类）均为现有本体图的**读模型**（不复制真值 R9）；**确定性图搜索(BFS/最短路)做地板**，LLM 作可选"路径排序 + 切片命名/描述"；生成切片落库 + SliceIndex（描述+索引实体）供检索复用。
7. **终态闭环可推演**：生成→全链闭包→R4 审批→publish→**进场景启动器**→重跑问句**验证真能答**；缺能力诚实落工单。
8. **达标=亲手用一遍能用**（fde-delivery）：以真实新颖故事（"工序/设备/共享瓶颈/降级/后果"）端到端验，不以测试绿为准。

9. **多跳推演原型库（报表做不到的命脉，一等验收基准）**：把"跨域多跳穿行 + 关系/规则联合推理"做成发动机的核心能力，以下 5 类杀手问题为验收基准（详 §3.8）：① 客户违约传导面 ② 供应商断供影响半径 ③ 毛利倒挂归因链路 ④ 产能瓶颈优先级冲突 ⑤ 隐性客户集中度。每类 = 一个多跳切片(路径) + 一个推理(求解器/聚合/generic_inference/工单)。
10. **data-first 本体/切片创建（bottom-up，补故事先行盲区）**：真实数据表到达 → A3 `deriveModelingSuggestion`(字段→类型、FK→链路) + Kimi 建模节点(语义增强/多跳切片提议) → 创建本体 + 切片。**复用 A3 + LLM 节点,不嵌独立放养 agent**（守 workflow 决策 + R6）。

### 1.2 非目标
- **自动发明并实现领域求解器**（缺求解器 → generic_inference 兜底 + 出带 I/O 契约工单，逻辑由人/agent 填、经审批，不臆造算法；承 `PRD-unified-build-engine` §1.2）。
- 真值的真实世界有效性（合成是"已知真值世界"，非真数据；真实数据接入是连接器绑定另议）。
- 实时流式（本期批量、按故事/问句触发）。
- 替换 QOS / 合成器 / Action / 连接器 / 本体服务（全部复用，发动机只做"消歧—倒推—诊断—驱动—闭环"的编排层）。

## 2. 现状与缺口（对照代码，带 file:line）

**已存在（复用，勿重造）**：
- comprehend：确定性关键词地板 + **§2 已落 Kimi 可插拔 seam**（`apps/datacore/src/databuilder/comprehend.ts` `comprehendScript`/`assemblePlanBody`/`LlmComprehendSchema`；`service.ts comprehendPlanBody`，purpose `comprehend` 路由 Kimi）。
- 自检：`databuilder/selfcheck.ts selfCheckGaps`（**已修**：故事提推演诉求却 0 求解器 → 报 NO_INTENT，不再谎报 ANSWERABLE）。
- 数据生成：`synthetic/schema-gen.ts generateFromSchema/generateRelatedDatasets`（FK 一致、R6）；`synthetic/data-template.ts buildDataTemplates`（模版可下载）。
- 切片：`runStory` 已 `registerStorySlices` 注册单根切片（`service.ts`）；`executeSlice` 多跳遍历。
- 消歧雏形：`agentcore/src/router/slots.ts nearestEntities`（A5 最近邻）+ OC1 实体解析 + g8-P2 `InputManifest` 补录。
- 各模块 create 端点：连接器 `POST /a/v1/connections`+`connectors.upload`；对象 `POST /a/v1/ontology/object-types`；规则 `POST /a/v1/rules`；切片 `PUT /a/v1/ontology/slices/:key`；意图/计划 `createIntent/createPlan`；Agent `POST /b/v1/agents`；场景 `POST /b/v1/scenarios`。
- 元本体（schema 自我认知）：`meta/parse.ts`（仅 type key：`{kind:"SystemObjectType", key:ot}`）。

**缺口**：
- 🔴 **无"实体与字段目录索引"**：元本体不含实例/字段/时序；无可检索目录 → 消歧不了"C客户"、不知现有字段细节（本 PRD §3.2）。
- 🔴 **comprehend 不产 scenarioTopology**：只产 schema，数据造不出"被问现象"（§3.4）。
- 🔴 **数据生成不针对场景**：`generateRelatedDatasets` 类型对、FK 对，但不植入争用/越线（§3.4）。
- 🔴 **切片库无前端创建 UI**（`SlicesPage` 列表 only）；多跳/跨域切片生成器 + SliceIndex 检索复用未建（§3.6）。
- 🔴 **终态闭环缺**：生成场景 DRAFT 默认不进启动器（`AUDIT-hand-run.md`）。
- 🔴 **发动机 workflow 化 + 节点状态可观测**未成型（现为服务管线，无 FDE 节点图）。

## 3. 设计（复用优先；标 复用 / 绿地新建 / 门禁新增）

### 3.1 发动机 = 确定性 workflow + Kimi-comprehend 节点（复用 + 绿地）
节点图（每节点 input/output/status，复用 StoryBuildRun 阶段 + ModuleSyncMatrix 回填）：
`① 消歧 → ② comprehend[Kimi] → ③ 查现状(两层索引)+比对差异 → ④ 数据模拟规划(scenarioTopology) → ⑤ FK一致确定性生成 → ⑥ 触发各模块 create(DRAFT) → ⑦ 全链闭包 → ⑧ R4 审批→publish→进启动器→重跑验证`。

### 3.2 实体与字段目录索引 EntityFieldCatalog（绿地新建，R9 四处）
读 repos.objects + ontologyTypes 建倒排：`实体名/别名 → {type,id}`、`type → 字段[{name,dataType,temporal,unit,sample}]`、热门样本值。供：消歧(§3.3)、知现有字段(§3.4)、切片检索(§3.6)。重建发 `capability.indexed`。**不复制真值**：索引项指回 repos（R9 单一来源）。

### 3.3 问题消歧（复用 A5 + InputManifest）
模糊指代 → EntityFieldCatalog 检索 + `nearestEntities` 最近邻 → 命中钉具体名；歧义/缺失 → `InputManifest` 弹补录（用户填具体客户名）→ 问题重写为具体实体再下行。消歧不了 → `entity.out_of_domain`(L16)。

### 3.4 comprehend 扩 scenarioTopology（扩 §2 已落 seam）
`LlmComprehendSchema` 增 `scenarioTopology`：`sharedResources[]`（哪些实体共享同一工序/设备）+ `plantedContention[]`（产能差额 / 优先级 / 越线值）。Kimi 输出 schema **⊕** 场景拓扑 → ④/⑤ 据此造"瓶颈真实存在"的数据。缺 Kimi → 地板（仅 schema，无拓扑，老实空心+自检报缺口）。

### 3.5 CapabilityInventory 读模型（绿地，非持久）
聚合本租户 ontologyTypes/rules/sliceSpecs/SOLVER_KEYS/intents/agents + 元本体 → schema 级清单。③节点 diff `BuildPlan 需求 + scenarioTopology 实体` vs（CapabilityInventory ⊕ EntityFieldCatalog）→ 缺类型/实例/字段/切片/求解器清单。

### 3.6 多跳切片两库 + SliceIndex（读模型 + 绿地）
- 域内库/跨域库 = 对 LinkType 按 `from.domain==to.domain` 切分的**读模型**。
- 多跳切片规划器：种子实体+目标 → 确定性 BFS/最短路（地板）→ SliceSpec；LLM 可选排序/命名。
- `SliceIndex`（绿地，R9 四处）：切片 description + indexEntities → 检索复用；命中则不重规划。
- **门禁新增**：切片覆盖软门（每字段被 ≥1 切片覆盖，未覆盖高亮待办，R12）。
- **缺口补**：`SlicesPage` 加前端"创建/新建切片"UI（复用 PUT 端点）。

### 3.7 复用各模块 create + R4 一致（复用）
⑥节点对缺口分派到各模块既有 create，**一律 DRAFT**：数据→`connectors.upload`；类型→`ontology.upsertType`；规则→`rules.create`；切片→注册；B 栈→scaffold。求解器缺 → generic_inference 兜底 / GrowthTicket。**全部经 R4 审批闸 publish**。

### 3.8 多跳推演原型库（5 类杀手问题 → 切片 + 求解器映射；一等验收）
报表只能给结果数,给不出"横向传导 / 跨域影响 / 反向暗线"。本库把这类推理一等化:每类 = 多跳切片(路径,复用 §3.6 两库+planner,支持 out/in 双向) + 推理件。已验证底座:`generic_inference` 做**沿链路前向/反向重算传导**(ontology-core `recompute` 反向依赖闭包 + 反向链路导航);`aggregate_objects` 做 groupBy 聚合;切片 `direction:"in"` 支持反向遍历。

| 原型 | 多跳切片(路径) | 推理件 | 现状 |
|---|---|---|---|
| ① 客户违约传导面 | 订单→共享设备/产线→其他订单→客户→营收(out) | Δ延迟→generic_inference 沿链路重算 + 聚合波及营收 | ✅ 复用 |
| ② 供应商断供影响半径 | 供应商→物料→BOM→产品→订单→客户(跨采购/生产/质量/销售 out) | 前向遍历 + aggregate 金额 + 质量域查认证替代供应商 | ✅ 复用(跨域库) |
| ③ 毛利倒挂归因链路 | 订单→工艺路线→设备稼动→物料价格→质量返工(因果链) | **归因分解求解器**(每环节吃掉多少毛利) | 🔴 **绿地新建**(或 calibration REPLAY_ATTRIBUTION 复用探索);缺则 generic_inference 部分 + GrowthTicket |
| ④ 产能瓶颈优先级冲突 | 订单→工艺-设备共享节点 | shared_bottleneck(对象关系 + 排产行为规则联合推理) | ◐ §5 已含,求解器待实现/兜底 |
| ⑤ 隐性客户集中度 | 客户←订单←物料←二级供应商(**反向 in** 聚合) | 反向遍历 + aggregate groupBy 找汇聚单点(单点敞口) | ✅ 复用(切片 in + aggregate) |

诚实:命脉(多跳跨域穿行)由切片两库 + planner 提供;1/2/5 推理由 generic_inference/aggregate 复用满足,④求解器待实现/兜底,**③归因分解是唯一须绿地新建的求解器**(否则诚实落工单,不假装)。

### 3.9 data-first 本体/切片创建（bottom-up，补故事先行盲区）
真实数据表/字段到达(连接器上传或既有 RawDataset) → A3 `deriveModelingSuggestion`(dataset→ObjectType、column→PropertyDef、FK→ref+LinkType,确定性) → **Kimi 建模节点**(语义增强:域归类、关系命名、据字段提议多跳切片) → 经 EntityFieldCatalog 索引 → 创建本体 + 切片(全 DRAFT,R4)。**复用 A3 + LLM 节点,非独立放养 agent**。与故事先行(top-down)互补:故事缺的对象,数据先行可从真实表补齐。

## 4. 契约 / 端点 / 数据模型（contracts-only-shared；双仓储四处）

- **contracts 新增**：`EntityFieldCatalogEntry` · `SliceIndexEntry` · `LlmComprehendSchema.scenarioTopology` 扩展 · `CapabilityGapReport`（diff 结果）· `FdeWorkflowNode`（节点状态）。
- **新表（R9 四处：migrations + repo.ts + memory.ts + pg.ts）**：`entity_field_catalog` · `slice_index`。
- **端点**：`GET /a/v1/capability-inventory`（schema 清单）· `GET /a/v1/entity-catalog/resolve?q=`（消歧检索）· `POST /a/v1/databuilder/runs` 扩（消歧→拓扑→生成→闭环）· `POST /a/v1/ontology/slices`（创建，补前端）· `GET /a/v1/slices/search`（SliceIndex 检索）。
- **事件**：`capability.indexed`（event-subscriptions.ts + 本体 §4）。
- **LLM 用途**：`comprehend`（已加）绑定 Kimi（openai_compatible provider，模型 id 用户填，凭据 AES-GCM 落库，no-secrets-echo）。

## 5. 关键流程（端到端，那条故事）

输入："下季度同时吃下 C、D 两客户的扩产订单，哪些工序/设备成共享瓶颈、谁挤占谁、哪张单降级、后果？"
1. **消歧**：C/D → EntityFieldCatalog 检索 → 钉星辰汽车/蓝海储能（缺则 InputManifest 补录）。
2. **comprehend(Kimi)**：倒推 Customer/Order/Model/Process/Equipment/Routing/ScheduleRule + 求解器 shared_bottleneck + **scenarioTopology**（C、D 订单共享同一化成工序/设备；植入产能<需求、蓝海优先级低）。
3. **查现状+diff**：缺 Process/Equipment 类型、两客户实例、路由、产能字段、shared_bottleneck → 缺口清单。
4. **数据模拟规划**：按 scenarioTopology 构造争用拓扑 + 植入值。
5. **FK 一致生成**：Customer/Process/Equipment 父表先（真实名）→ Order/Equipment ref 指真实 PK；同 seed 字节级一致。
6. **触发各模块 create(DRAFT)**：走正门物化 + 复用 create。
7. **闭包 + 跑求解器**：shared_bottleneck 算 → 瓶颈/谁挤占谁/哪单降级/后果；缺则 generic_inference 兜底 / 工单。
8. **审批→publish→进启动器→重跑验证**。

## 6. 非功能与约定（§5 不变量逐条）
R2 全索引/数据带 tenantId；R4 全 create DRAFT 经审批；R6 同输入字节级一致 + LLM mock；R9 新表四处；R11 全链闭包拒发布；R12 切片覆盖软门；R13 全血缘；R14 分类/provider config-drive；no-secrets-echo（Kimi key 加密）。

## 7. 验收（DoD：亲手用一遍能用 + 全绿 + 回归锁）
- **体验级（fde-delivery 主判据）**：起真服务 + 绑 Kimi（用户填 key）→ 那条真实故事 → **亲手走通**：消歧出具体客户 → 数据里瓶颈真实存在 → 各模块 UI 看得见生成物(含切片库) → 场景 publish 进启动器 → 重跑**真答出**谁挤占谁/哪单降级/后果（或诚实落工单）。录证据。
- **多跳推演原型基准（§3.8 五问）**：1/2/4/5 端到端真答出(横向传导/跨域影响/瓶颈冲突/反向暗线聚合);③毛利归因或建归因求解器答出、或诚实落工单。这是"报表做不到"的命脉验收。
- **工业级测试**：每期 100 字真实/新颖故事完整测；EntityFieldCatalog 消歧 ×N、scenarioTopology 生成"瓶颈存在" ×N、多跳切片+SliceIndex 复用 ×N、R4 审批闸 ×N、切片覆盖软门 ×N。
- **全绿**：`pnpm -r build && test` 四包 + `pnpm gates`（含 prd:check / chain:check / debattery:check）+ ontology 回写 + meta:sync。
- **诚实**：每期报"距离北极星还差什么"，标清合成/兜底/happy-path。

## 8. 分期（每期按 fde-delivery 亲手验收）
- **P1** EntityFieldCatalog 索引 + `/entity-catalog/resolve` 消歧 + CapabilityInventory + diff 节点（Q2 地基，自主可验）。
- **P2** comprehend 扩 scenarioTopology + 场景化数据生成（"瓶颈真实存在"）。
- **P3** 多跳切片两库 + 规划器(out/in 双向) + SliceIndex 检索复用 + 切片库创建 UI + 覆盖软门 + **data-first 建模节点(§3.9)**；以 §3.8 原型 ①②⑤(复用 generic_inference/aggregate)为回归基准。
- **P4** 复用各模块 create + R4 审批闸统一 + 终态闭环（publish→启动器→重跑验证）。
- **P4.5** 多跳推演原型 ③毛利归因分解求解器（绿地新建,§3.8）+ ④shared_bottleneck 实现/兜底收口。
- **P5** 发动机 workflow 化（FDE 节点图 + 状态回填 + 前端节点状态图）。
- **P6** 绑 Kimi 端到端 live（用户填 key）+ 真实故事 hand-run 验收 + 审计其余模块收口。
