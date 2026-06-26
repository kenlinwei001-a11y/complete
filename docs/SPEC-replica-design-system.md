# SPEC · 复刻设计系统（1:1 竞品对标 · 双 shell + 导航 IA + token + 组件库 · 全页地基）

> **这是什么**：把竞品(低代码本体/推演平台)的**设计系统**1:1 复刻成平台自有设计系统——所有"复刻页 SPEC"都引用本份的 shell/导航/token/组件。**一次立标准,各页只填内容。**
>
> **两硬约束(全程)**：① **平台自有术语**——竞品品牌名/外部产品名一律换平台名(铁律);视觉/布局/交互 1:1。② **接现有后端**——每个组件绑真求解器/本体/数据,非视觉空壳(融合优先;违则=假推演)。
>
> **像素源**：竞品 7 页逐张拆解(scratchpad,含 hex/坐标/组件);本份是其平台化编码。

---

## 1. 页面内多窗格布局（**非重建应用导航** · 见 §9 范围决定）

> 范围收窄后:**不重建竞品的两套应用 shell/导航**(§9)。下表描述的是竞品两类页面的**页内多窗格布局**——2 个复刻页(建模/沙盘)在**系统现有 ShellLayout 内**采用对应的页内布局(三栏/主区+抽屉),应用级导航沿用系统现有。

| | **Shell A · 顶部横向导航**(建模工作台族) | **Shell B · 左侧竖向导航**(推演沙盘族) |
|---|---|---|
| 出现页 | 数据流DAG/认证/对象配置(image1/2/5/6) | 沙盘列表/向导/运行台(image7/8) |
| 导航位 | 顶部 1 行横排(h≈28) + 第二行多标签 tab(可关 ×) + 第三行操作区 | 左竖栏 ~135px(图标+文字, 项高~48) |
| 主区 | 左画布(~40%) / 中面板(~33%) / 右 Agent(~18%) 三栏 | 主区列表 + 右抽屉/运行三分区 |
| 备注 | image8 顶横+左竖叠加→两套同源可叠 | 顶部仅 logo+当前页标题 |
| **平台落法** | 复用现 `ShellLayout` 顶栏扩"操作区段控+保存/发布";建模类页走此 | `ShellLayout` 左 NAV 即此;沙盘类页走此 |

## 2. 导航 IA（认知映射 · **不做 IA 复刻**）

> **范围决定(已定)：不复刻竞品 13 顶栏 IA、不重建系统导航**——11 个非建模/非沙盘模块平台多已有(见 §9),沿用系统现有页与入口。下表仅为"竞品模块 ↔ 平台已有能力"的**认知映射(非施工目标)**：

| 竞品菜单(原文) | 平台自有项 | 系统现状 |
|---|---|---|
| 探索 / 元数据摄取 / 元数据资产 | 数据接入(连接器/上传/数据集) | A1 连接器已建 |
| 本体建模 | **本体建模工作台** | ModelingPage(轨L 真值闭合) |
| 推演沙盘 | **推演沙盘** | SandboxView/SimInit(轨A) |
| 智能体 | Agent | B1 已建 |
| 知识库 | 知识库 | S4 已建 |
| 图谱可视化 | 本体图谱 | 已建 |
| 模型管理 | LLM 供应商/模型 | 已建 |
| MCP | MCP | B3 已建 |
| 素材库 / 插件 | 素材/技能 | B4 Skill |
| 系统管理(用户/角色/菜单/日志/定时/令牌/反馈) | 管理面 | A0/admin 大部已建 |
> 右上工具区(1:1)：`搜索 ⌘K · 设置 · 主题切换 · 语言 · 全屏 · 头像`。**主题切换接轨O 的 light/dark。**

## 3. 暗色 Token（hex · 接轨O 主题系统）

```
--bg:#0a0c12~#0e1117  --panel:#10141c~#161a24  --line:#262b38(1px低对比)
--accent紫:#7c5cff/#8b5cf6  --ok绿:#22c55e/#16a34a  --danger红:#ef4444
--warn橙:#d97706/#f59e0b  --info蓝:#3b82f6/#3b9bff  --cyan青:#14b8a6
--txt:#e5e7eb  --muted:#8b93a7
```
- **语义节点色**(对象类型上色)：实体类型各一色(复刻 Supplier紫/Factory青绿/Order蓝 的"按类型上色"规则 → 平台用本体域色)。
- 写进 `tokens.css` 作复刻主题组(与轨O 浅色组并列, 域色 theme-invariant)。**RL5 零业务常数:颜色=配置。**

## 4. 组件库（1:1 复刻 · 每个标注接什么后端）

| 组件 | 1:1 规格 | 接现有后端(融合) |
|---|---|---|
| **6维健康雷达** | 六边形双层网格+紫描边填充+6轴(规则覆盖/激活/可观测/环安全/闭包/利用率)+底部图例+右上综合分 | 接 `deriveCertification`/closure 五维(现成,扩到6维) |
| **4维信任雷达** | Runtime/Explainability/Temporal/Data Trust;可计算态 vs `🔒Reserved`;`Partial N/4` | 接 Temporal Trust(沙盘)+lineage(R13);不可计算诚实 Reserved |
| **L0-L4 认证台阶** | 5 圆点+双行标签(L0 Invalid→L4 Certified)+Schema lint/Trial Tick/已持久化✓ | 接 `deriveCertification`(L0-L4 数据已算,现成) |
| **准备度三联条** | 结构/知识/行为 三横条(圆头紫填充)+综合分 | 接 certification 三维(现成) |
| **半圆 gauge** | ~270° 圆头+中心指针;满绿/部分橙(如75) | 接逐对象/全局准备度% |
| **环形进度** | 粗描边带辉光;绿(就绪)/蓝(世界完整度) | 接 certification/scope-precheck |
| **数据流 DAG** | 事件表→数据处理→实体/关系 横向分层;节点连接桩;正交折线箭头 | 接 RawDataset→建模→ObjectType 真链(轨L provenance);复用 PmDag/FdeGraph |
| **本体节点(两态)** | 建模态=半透明深卡+双徽标`[模][动]`;运行态=实色按类型上色+底部Action/派生计数 | 接真 ObjectType/Object;tick 时变色(轨A tick 已修) |
| **Agent 指挥台**(全站右栏) | tab `会话/历史会话/运行结果`;气泡左3px竖色条(用户紫/Agent绿)+时间戳+📌置顶+推理▾;markdown 含彩色 code token;底部输入+多级模型下拉+发送 | **接 AgentCore QOS**(路径A/B+SSE)注入 presetContext(补G-3);非新建聊天 |
| **段控/胶囊tab/badge** | 段控选中紫底白字;胶囊全圆角;badge 绿/橙/灰/红语义 | 纯前端样式 |
| **审计行** | `PASS`绿徽+时间戳+描述+`system` | 接 L3 认证审计/事件 |

## 5. 复刻味道（最关键的"竞品感"· 必抓）

1. **双布局并存**(建模顶导航 / 沙盘左导航)——两套 shell 都建。
2. **节点两态**(建模半透明双徽标 / 运行实色按类型上色)——必须区分。
3. **认证/准备度体系**(L0-L4台阶+三色条+gauge+环+雷达)是核心视觉资产,到处复用。
4. **Agent 指挥台**统一右栏(竖色条气泡+彩色code token+多级模型下拉)是强辨识特征。
5. **信息密度梯度**:运行台>认证>配置>评估>向导。

## 6. 红线 + 真值判据

- **红线**:① 不出现任何外部产品名/品牌(铁律);② 每个雷达/数字/DAG/认证**接真后端**(非写死/假数据,违=假推演 见 `AUDIT-fake-simulation-inventory`);③ 域色 theme-invariant(RL5);④ 接现有(deriveCertification/PmDag/QOS/PdgDag)不新建并行。
- **真值判据**:像素级与竞品图比对(布局/配色/组件齐) + 每个组件的数字能溯到后端真值 + 主题切换可用(接轨O)。

## 7. 引用关系

- 各页 SPEC(`SPEC-replica-modeling-*` 建模族 / `SPEC-replica-sandbox-*` 沙盘族)**引用本份**的 shell/token/组件,只描述页面专属布局+数据+融合。
- 主题接 `HANDOFF-theme-switch`(轨O);Agent 接 QOS(G-3);DAG/provenance 接轨L;沙盘 tick 接轨A;溯源接 `SPEC-trust-traceability`。

---

## 8. 补遗（完整性查漏审计补入 · 之前漏的共享元素/能力）

> 独立查漏审计揪出的系统性遗漏,补为复刻必含项。

- **业务动作接口（能力面板·竞品 image4②）**：4 类运行态可调用业务动作 `断供 / 恢复供货 / 产能调整(adjustCapacity) / 订单延期(delayOrder)`——"为 AI 提供可调用的业务调整能力,实现场景模拟"。组件=动作列表+参数表单;**接现有 Action/RL4 走正门**(采纳才写真值),运行态由 AI 指挥台/手动触发。
- **图查询能力（几乎整块漏·image4③/image1）**：查询构建器 + **查询代码生成(平台自有查询语言,非外部品牌名)** + 查询结果表(高风险筛选/连锁风险排查) + **Query→Skill 绑定 + Query→MCP Tool 暴露**(端点同义 `query_save_code/bind_skill/update_exposure`)。**接现有 B3 MCP / B4 Skill**(融合非新建);**单列一页**(见 §9)。
- **信任雷达双语义（文案·image1）**：`Temporal Trust = 时间快照·防未来数据泄漏`、`Data Trust = 来源可追溯(lineage)`;不可计算标 `🔒Reserved`;顶 `Partial N/4 可计算` + `可计算维度综合分`。作雷达 tooltip/副标题,**不可计算诚实 Reserved 非编假**。
- **Shell A 顶操作行全控件（image1/6）**：`‹面包屑` · 段控 `本体工作流流程 | 架构本体设计` · `画布布局⌄` · `其它操作⌄` · `保存` · `实时调试未启动`(状态指示) · `高级` · `发布`(绿)。§1 补齐。
- **约束类型体系（image8）**：`+ GEO_WITHIN 约束` 等**类型化约束**(约束类型枚举:地理围栏…) + `+ 声明目标`。
- **运行态状态卡组件（image8）**：`世界状态`卡(健康**字母分级 A–C** + 需关注态势 + 阈控 + 展开详情) · `Schema对齐`卡(时序窗口对齐值 + 聚合算子 `Sum·字段 / Max·字段` + 窗口契约 + 展开 Label 契约) · `诞生N规则✓` · `并行全分支/Step+N`。

## 9. 复刻范围（已定 · 11 模块不做 1:1）

**决定(用户定)：其余 11 模块无需 1:1 复刻。** 摸真代码核实平台多已有(仅入口分组与竞品扁平 13 顶栏不同),**沿用系统现有页与入口、不重建**：

| 竞品模块 | 平台已有(file/路由) |
|---|---|
| 智能体 | `AgentsPage` · `/b/v1/agents` |
| 元数据摄取 | `ConnectionsPage`/`DataBuilderPage` · `/a/v1/connector` |
| 元数据资产 | `ObjectTypesBrowserPage`/`FieldProfilePage` · `/a/v1/ontology` |
| 知识库 | `/a/v1/kb`(前端嵌 DataBuilderPage) |
| 模型管理 | `LlmProvidersPage` · `/a/v1/llm-providers` |
| MCP | `McpPage` · `/b/v1/mcp` |
| 探索 | `QueryHistoryPage`/`ScenesPage`(场景启动器)+QOS |
| 系统管理 | `UsersPage`/`PermissionsPage`/`OpsSchedulePage`/`CalibrationPage` |
| 图谱可视化 / 素材库 / 插件 | ◐ 能力在(DomainsPage 图谱 / `SkillsPage` 技能 / Skill+MCP=插件)·无专页,沿用现有 |

**∴ 1:1 复刻范围 = 仅 2 模块**：本体建模(`SPEC-replica-modeling-family` · 轨P)+ 推演沙盘(`SPEC-replica-sandbox-family` · 轨Q)。其页面内容渲染在**系统现有 ShellLayout** 内,套本份 §3 token + §4/§8 组件库;**不重建应用导航、不做 §2 那 13 项 IA 复刻**。

---

## 10. 后端可达性（摸真代码核实 · **修正 §4/各页"接现有"乐观注**）

> 独立后端审计逐元素摸真代码:**§4 与各页里大量"接现有 X"是假设**。实情分三类。**复刻前先看本节判定;③类后端未建 → 暂不做(见 §10.1 TO-DO),只做①接现成的 full 1:1;禁画假数据壳(继承 `AUDIT-fake-simulation-inventory` 真推演红线)。**

**① 真·接现成(0 后端活·SPEC 注准确)**：L0-L4 五级状态机 + 三维准备度条 + 世界完整度环 + entering 清单(`deriveCertification`/`sim/certification.ts`,端点 `app.ts:1410`) · gauge/环 · provenance RawDataset→ObjectType 两层 + 逐对象 lineage(`/ontology/graph`、`/lineage/object`) · tick/checkpoint/branch/curTick(Step+N)/rulesFired(诞生N规则) · 派生计数 · 段控/badge/token/Agent指挥台接 QOS。

**② 要扩后端(有基础·中等)**：数据流 DAG 中间"数据处理"层(前端从 `sourceBindings.fieldMappings` 合成,无新端点) · Schema 聚合算子加 `Last`(现 sum/max) · `[RUNTIME]/[INGEST]` 阶段标(PropagationRule 加 phase 字段) · 风险 TOP3(截断+**守已有 dataMode 红线**;扩 4 个 MOCK 因素真数据源) · 并行分支计数 API · 逐类型 Action 计数(ActionType 加 targetTypeKey) · Query→MCP 动态暴露(B3 框架可扩 `update_exposure`)。

**③ 基本从零建后端(高工作量·复刻前必建·审核方最该警惕)**：
1. **6 维健康雷达** — 契约无 `healthRadar` 字段,`deriveCertification` 只产 **3 维**;第六维 Cycle Safety 只有布尔无分值投影。要新写投影+加契约+回填。
2. **4 维信任雷达** — 契约+实现全无;Temporal/Data Trust **连可计算来源都没有**(诚实做=4 维全 RESERVED→雷达=空壳)。
3. **图查询构建器 + 平台自有查询语言 + 代码生成** — 全 0 命中(Slice 是声明式子图非查询语言)。整块新建。
4. **Query→Skill 绑定** — Skill 包 markdown 手册无 queryId,要新建绑定+codegen。("接 B4 融合非新建"=**假**)
5. **4 业务动作(断供/恢复/产能调整/订单延期)+ RL4 驱动运行态** — 动作全缺;且沙盘 `act` 端点绕过 ActionDraft、`propagateTick` 零动作入参→**"动作→改沙盘态→tick 响应"机制断裂**。("接现有 Action/RL4 走正门"=**假**)
6. **分层推演目标体系(总体/分系统/局部)** — 沙盘 `SimSession` 无 goal 字段。
7. **类型化约束 + GEO_WITHIN** — 完全不存在,Rule DSL 不能复用为空间约束。
8. **世界状态 A–C 字母分级** — 无(有 L 级/数值)。
9. **L4 子项 Schema lint / 已持久化** — cert 链路无这两子项(Trial Tick 有)。

> **施工纪律(用户定 · 分层交付 b)**：**③类 9 项后端未建 → 暂不做,登记为 TO-DO(下 §10.1,待后端 backlog 排期)。** 轨 P/Q 当前**只交付 ①接现成的 full 1:1**(+ 便宜的 ②扩);**后端未建前不碰③——不画壳、不画假数据雷达**(画了就是假推演)。各页 SPEC 凡与本节③冲突的"接现有"注以本节为准。后端补齐后再回来复刻+点亮③。

### 10.1 后端 TO-DO 清单（③类 · 暂不做 · 排期建后端后才复刻对应前端）
1. 6维健康雷达投影(+第六维 Cycle Safety)+ `healthRadar` 契约/端点
2. 4维信任雷达(Runtime/Explainability/Temporal/Data Trust)契约+实现(含可计算来源)
3. 图查询构建器 + 平台自有查询语言 + 代码生成
4. Query→Skill 绑定 + Query→MCP 动态暴露
5. 4 业务动作(断供/恢复/产能调整/订单延期)+ RL4 驱动运行态(动作→改沙盘态→tick 响应)
6. 分层推演目标体系(总体/分系统/局部)+ 声明端点
7. 类型化约束 + GEO_WITHIN(空间约束类型系统)
8. 世界状态 A–C 字母分级
9. L4 子项 Schema lint / 已持久化

### 10.2 数据 pipeline 断点（①元素 · 前端渲染侧 · 补在轨P/Q 增量内 · **无需建后端**）

> Pipeline 审计:6 个①元素**后端/端点/前端client/字段全对齐,无真后端断点**(无 G-2)。但有两类隐藏断点都在前端/渲染侧——SPEC 写"接现有"准确指**后端**现成,但**前端多处零接线**,须当"前端从零接"做(非"接现成组件"):

| ①元素 | pipeline 现状 | 增量内要补(前端) |
|---|---|---|
| ③ tick/检查点/分支/变色 | **全通** | 直接做(SandboxView 已接) |
| ① L0-L4 认证面板 | **全通**(SimReadinessPanel 已砌齐) | 直接做(只差 demo 开功能) |
| ② 数据流 DAG | 后端通(`/ontology/graph` 出 `sourceBindings.fieldMappings`) | **建本体专用 DAG 组件**消费 fieldMappings(PmDag/FdeGraph 形状不直接适用) |
| ④ 风险榜 | 后端通(risk_timeline+dataMode) | SandboxView **从零接** `invokeSolver("risk_timeline")`+**复用 RiskBoardView 诚实 dataMode 渲染**(`RiskBoardView.tsx:79-90`) |
| ⑤ 逐对象 gauge(LOCAL) | 后端通(`certification?scope=LOCAL`) | ModelingPage **从零接** `fetchSimCertification(type,"LOCAL")`+gauge(现 ModelingPage 零 cert) |
| ⑥ Agent 指挥台(G-3) | 后端通道全通(presetSlots `slots.ts:318`) | 两页**嵌 QueryDock 类面板**+`setSelectedObjects`→`SessionContext` 注入(后端现成,G-3 前端段未闭) |

**demo 开箱前置(沙盘族·否则增量0 真跑 404)**：① 开 demo 的 `sim.*` 功能(`features.ts:83-89` defaultOn:false,需 demo override 或确认 battery 模板已开)② 加 `/v/sim-sandbox`、`/v/sim-init` 的 demo workspace **nav 入口**(现无入口)③ 可选预建/确认 SimSession 现建路通。**建模族 `/admin/modeling` 常驻 admin 页无此门。**
