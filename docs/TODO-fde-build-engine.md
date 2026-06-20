# TODO · 数据构建发动机 → FDE 全栈倒推（真实目标对齐版）

> 立此清单的背景：用户反复强调"数据构建发动机"的目标——**一句故事倒推推演所需的一切（数据/规则/agent/本体切片…），系统自动审核后在各模块"生成"，从而不断增加真实数据、不断完善本体切片**——而既往交付离目标甚远。本清单以**用户真实目标**为靶（非 PRD-DoD），验收按 `fde-delivery` skill：**亲手用一遍能用才算完成**。
>
> 状态：✅ 已完成并亲手验过 · ◐ 部分 · ⬜ 未做 · 🔴 阻塞核心目标

## 0. 全量真相审计（基础，先做）

- ⬜ **PRD ↔ 用户目标 ↔ 开发结果 ↔ 亲手用一遍** 逐模块对账。方法：起真服务（datacore+agentcore+frontend / docker compose），以用户身份驱动真实端到端流程（非单测），记录"声称完成 vs 实际能用"的差距，产出 `docs/AUDIT-hand-run.md`。覆盖：数据构建发动机 / 场景启动器 / 连接器 / 切片库 / Agent 页 / 本体浏览 / 推演链路。逐模块给 verdict（能用 / 空洞 / 半通 / 断）。

## 1. 已修（本轮，多为用户实测找出的空洞/bug）

- ✅ 行业模版下拉空 → 内置模版并入端点
- ✅ 连接器深链整页刷新掉登录 → 改 react-router 客户端跳转
- ✅ 三建域按钮无说明 → 加取舍说明
- ✅ 故事倒推切片不入库 → runStory 注册 SliceSpec（切片库可见，单根）
- ✅ admin 推演"权限不足" → authz 加租户 admin 全量读（CONNECTION 边界保留）
- ✅ 场景卡对话混合 → 每卡独立对话线程

## 2. 🔴 核心目标差距（"发动机真能听懂任意故事并满足推演"）

> 这一组是用户目标的本体。当前确定性关键词 comprehend 对新颖故事（工序/设备/共享瓶颈/降级/后果）产出空骨架（0 规则/0 求解器/0 agent）——**这是离目标最远的地方**。

- 🔴 ⬜ **LLM comprehend 大脑**：意图解析 + 推演步骤分析 + 全栈倒推；用途绑定 `template_gen`/`comprehend`，输出 `freezePlan` 封存守 R6。听懂任意业务语言 → 倒推 Process/Equipment + 瓶颈求解器 + 降级规则 + 后果推演 + 对应 agent。
- 🔴 ⬜ **富切片（多跳）生成**：当前单根切片；真正有用是 Order→Line→Process→Equipment 多跳。
- ⬜ **拟真值域合成数据**：当前通用 hash（demandDelta=390）；需域调优生成器或 LLM 模版（值落业务区间 + 植入恰当越线样本）。
- ⬜ **终态闭环**：生成（全 DRAFT）→ R11 全链闭包 → R4 审批 → publish → **进场景启动器** → 末步重跑问句**验证真能推演出结果**。
- ⬜ **B 栈 scaffold 单机可见**：当前 agents/意图/计划/场景仅在配 `AGENTCORE_BASE_URL+SERVICE_TOKEN` 时生成；否则用户看不到生成的 agent。需本地可 scaffold 或明确提示。
- ⬜ **真实数据接入选项**：缺数据时可选"等真人/真系统补真数据"工单 或 绑真连接器，而非只合成兜底（落实"不断增加*真实*数据"）。

## 3. 本体域 + 两库 + 多跳切片（用户最新需求，基于参考 14 域本体）

- ⬜ **14 域参考运营本体编码为数据**（factory/product/process/equip/people/quality/capacity/forecast/sales/material/finance/plan/external/decision + 对象类型 + 带语义多跳关系）。
- ⬜ **域内本体库**（读模型）：按 `from.domain==to.domain` 切出每域子图。
- ⬜ **跨域本体库**（读模型，面向 8 业务分类）：跨域桥接关系。
- ⬜ **多跳切片规划器**：种子实体+目标 → 图路径搜索（确定性地板 BFS）→ 拼 SliceSpec；LLM 作可选路径排序 + 切片命名/描述。
- ⬜ **切片索引存储 + 复用**：生成切片附 description + indexEntities，落库；下次近似问句按索引检索复用，不重规划。
- 验收（体验）：UI 看得见两库 → 跑问句看着现生成跨域切片 → 切片库出现（带描述/索引）→ 再问命中复用 → executeSlice 真解析出跨域子图。

## 4. 数据接入控制台分类（用户需求）

- ⬜ **锂电数据分类 taxonomy**（配置化 R14，两层：大类→数据集，对齐 14 域）。
- ⬜ 现有连接器/对象类型**并入分类**。
- ⬜ 每类可选 **系统对接 / 文件上传**（ingestMode）。
- ⬜ 文件上传**模版（字段表）前端可看 + 可下载**（复用已建 `buildDataTemplates` + `/a/v1/data-templates/:typeKey`）。
- ◐ 合成数据与字段对齐（schema-gen 已从 properties 生成）。
- ⬜ **每字段实体被 ≥1 本体切片覆盖**（R12 + 切片注册；先软提示，可升硬门）。

## 5. 模块可见性补缺（用户实测找不到）

- ⬜ **对象/类型浏览器管理页**（当前无；对象图谱仅 `/v/graph` 业务视图）：列已发布对象类型 + 物化对象计数 + 下钻实例。

## 6. FDE 编排工作流（统摄 2/3/5，用户提的"模拟 FDE 工作"的工作流）

- ⬜ 一条显式、可观测、有保证终态的工作流：意图解析 → 推演步骤分析 → 倒推所需 → **查现有能力**（CapabilityInventory 读模型，不新建库 R9）→ 比对差异 → 触发各模块生成 → **各模块状态回填工作流节点**（复用 ModuleSyncMatrix）→ 前端节点状态图 → 终态**进场景启动器可推演**。

## 7. 治理 / 防复发（SOP）

- ✅ `fde-delivery` skill（交付纪律 SOP：完成定义=体验、亲手用一遍、报北极星距离、真实故事验收）。
- ⬜ 考虑加一道治理维度：现有 `prd:coverage` 只验"PRD↔测试"，缺"PRD实现↔用户目标↔亲手验"——可加一份 hand-run 验收登记（§0 审计的常态化）。

## 8. 多跳跨域推理引擎 · 选型与集成（开源采用，封装为平台自有 API）

> 原则（已定）：**能净室重写的自写（零外部名、零依赖、R6 可控）；重引擎作依赖封装**（产品/UI 零外部名，库的许可证仅保留在依赖清单——MIT/Apache 要求，不可删）。每个采用前**先读真代码/许可证实测**(不信 README)，过 **4 闸**：① 许可证合规 ② R6 确定性(钉种子/确定性封装) ③ R11 声明 SOLVER_OUTPUT_SHAPES ④ R13 审计+供应链安全。
>
> ⚠️ **架构现实**：平台是 TS/Node + pg×2；下列多为 **Python/C++** → 集成 = 起一个 **求解器 sidecar 微服务**（Python/原生,REST 暴露,datacore 经 OBO 调）+ docker-compose 加服务。这是新基建,非小事,故按类**选一个**落地,不是 12 个全上。
> ⚠️ **同类是替代,不是叠加**：每类挑 1 个主选;**RDFox 是商用闭源、Datomic 是专有**(非开源,不采)。

- ⬜ **8a 图查询 / 多跳穿行**：主选 **Gremlin/TinkerPop**(Apache-2.0,厂商中立) 或 **Neo4j Community**(GPLv3;Enterprise 商用)。`Neo4j GDS` 依附 Neo4j。**现状**：平台切片引擎(root+hops+in/out)已覆盖中小规模 → **暂缓,规模/深度顶不住再上**。集成=部署图库服务 + adapter。
- ⬜ **8b Datalog 递归传导（传导面/影响半径，Q1/Q2）**：主选 **Soufflé**(Apache-2.0,编译 C++,快,**确定性✅**)。~~RDFox(商用闭源)~~、~~Datomic(专有)~~ 不采。**现状**：平台 `recompute`(反向依赖闭包重算) 已是传导雏形 → 先净室扩,规模不够再封 Soufflé。
- ⬜ **8c 图算法 / 集中度聚合（暗线 Q5）**：主选 **NetworkX**(BSD,Python,确定性) 或 **igraph**(GPLv2,C,快)。**现状**：反向切片 + `aggregate_objects` groupBy 已覆盖基础 → 复杂中心性/社区发现再上。
- ⬜ **8d 约束求解 / 排产冲突（Q4 shared_bottleneck）**：主选 **OR-Tools**(Apache-2.0,Google,成熟;CP-SAT 钉 seed 可确定性)。集成=sidecar 封装为 `shared_bottleneck` 求解器,声明输出形状。
- ⬜ **8e 归因 / 因果（毛利倒挂 Q3）**：主选 **DoWhy**(MIT,因果推断,比 SHAP 更适合"哪个环节吃掉多少毛利")；备 **EconML**(MIT)、**SHAP**(MIT,⚠️ 默认不确定,须钉种子)。**或**先净室确定性归因分解(沿因果链逐环节差分),够用就不引依赖。
- ⬜ **8f 求解器 sidecar 基建**：起 Python/原生求解器微服务(docker-compose 加服务)+ 平台自有 REST 契约 + OBO 透传 + 4 闸评审流水。8b/8c/8d/8e 的依赖落地都靠它。**这是 8 类落地的前置基建。**
- ⬜ **8g 封装引擎暴露为 MCP 工具(B3,可见+可治理)**：依赖引入的引擎(OR-Tools/DoWhy/Soufflé sidecar)封装成平台自有 API 后，**注册为一个 MCP server**(`mcpConfigs`)→ 其工具(shared_bottleneck/margin_attribution… 带 `inputSchema`)在 **MCP 页(`McpPage` `mcp-tools`)可见、连接测试可发现、agent 经 `mcp-router` 可调**;凭据 AES-GCM(no-secrets-echo)。**即:不止是内部求解器调用,而是在 MCP 模块看得到它们 + API/schema。** 同时按需注册为 datacore 求解器(SOLVER_KEYS,声明输出形状,供闭包/渲染 R11)——一鱼两吃:确定性 workflow 走求解器、agent 探索走 MCP 工具。

> 落地顺序建议：先净室扩 8b(传导)/8c(聚合)满足 Q1/Q2/Q5(平台底座已有雏形,零依赖)；Q4 上 **OR-Tools**、Q3 上 **DoWhy**(需 8f sidecar)；8a 图库规模不够才上。**默认不全上 12 个。**

---

### 建议执行顺序（FDE 视角）

`§0 审计`（先看清真相）→ `§2 LLM comprehend 大脑 + 终态闭环`（离目标最远、价值最大）→ `§3 两库+多跳切片`（与 §2 共用本体图）→ `§5 对象浏览器 + §4 分类控制台`（可见性）→ `§6 编排工作流`（把上面串成一条可观测的 FDE 流）。每项按 `fde-delivery` 验收：**亲手用一遍能用才算完成**。
