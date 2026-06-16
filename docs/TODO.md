# TODO · 系统协同进化路线（按重要程度排序）

> 状态：✅ 已完成 · 🔄 进行中 · ⬜ 待办。断点编号见 `docs/SYSTEM-ONTOLOGY.md` §8；域/切片见 §10；不变量 R1–R13 见 §5。
> 纪律：每批 `pnpm -r build && test` + `pnpm gates`(ontology:check+chain:check) 全绿；改链路/事件/不变量回写系统本体。
> 哲学北极星：**可信赖的推演 = 出处 + 推导可当场亮出**（R13）；输入侧"字段全建模"(R12) ⊕ 输出侧"结论可溯源"(R13)。

## ✅ 已完成（基线 + 本轮）
- 系统本体 `SYSTEM-ONTOLOGY.md` §1–§10 + 治理闭环（铁律0 / SessionStart 钩子 / `/ontology` / `ontology:check` / `chain:check` / PRD 模板）
- 运行模型 `OPERATING-MODEL.md`；审核 `AUDIT-0614-fullchain.md`
- **PRD 全集**：统一构建发动机 · 场景启动器 · 本体浏览器/字段全建模 · 活数据可溯
- **参考原型完整盘点** `REFERENCE-HTML-INVENTORY.md`（逐节/逐注册表 + 采纳决策 + 信任哲学章 + 附录A溯源backlog）
- **断点修复**：G-1（20场景接通）· G-2（跨服务形状）· G-4（前端自助创建）· G-7（model 显示）
- **CLI 对话入口** `platform-cli.mjs`（login/ask/SSE/clarification/approve）
- **场景启动器 P1**：`presetSlots` 注入通道 + fillSlots 消费 + `POST /b/v1/scenarios/:key/launch` + 零反问门（20/20）
- **活数据可溯 P1**：合成→合成源连接器→RawDataset/RawRow→物化，对象 origin 记 rawDatasetId/rowIdx（数据源页可见原始数据）
- **活数据可溯 P2**：对象 lineage 端点 `GET /a/v1/lineage/object/:type/:id`（对象→原始行→RawDataset→连接器+派生口径）
- **活数据可溯 P3 增量1**：`<Provenance>` 悬浮溯源（接 LedgerView）+ 数据源原始表（FieldProfilePage 已现成）
- **R13「结论可溯源」+ R-一致** 固化进本体；`<Provenance>` 升**六要素**（来源/新鲜度/推导/输入因子/关联规则/备注）+ 新鲜度降级（C09）
- **项目推演 DAG 放大**：全宽独占 + maxHeight 480→760 + 节点/字号加大（借鉴 HTML 项目推演布局）

## ✅ Tier 0.5 · 端到端活数据 + 全链可溯（地基，已完成）
- ✅ **0. 活数据可溯 收尾**（`docs/PRD-live-traceable-data.md`）
  - ✅ 结果→入参对象 lineage（`GET /api/v1/queries/:taskId/lineage`：selectedObjects + objectRef 槽位 → 每对象再溯回原始数据）
  - ✅ `DATA_HEALTH` 新鲜度统一来源：`<Provenance>` 的 fresh 接全局 `data-health`（按 connId/源系统名匹配，源延迟→全链一致降级 + C09 影响 P90 0.93→0.90）
  - ✅ `<RuleRef code>` 规则锚点两跳（数字→规则→规则详情，接 fetchRules）
  - ✅ 合并静态 F5 溯源：ProvenancePopover 规则段改用共享 `<RuleRef>`（两套溯源统一规则机制）
  - 注：P1（合成落原始表）/P2（对象 lineage 端点）/P3增量1（Provenance+数据源原始表）已先期完成

## 🥇 Tier 1 · 机制定型
- ✅ **1. 全链闭包门 R11 完整版**：✅ chain:check · ✅ **CHAIN 维**（求解器注册）· ✅ **SHAPE 维（BuildPlan 扩 AgentCore 渲染栈）**——`SOLVER_OUTPUT_SHAPES` 全 **22/22 注册求解器覆盖**（5 个契约 schema `.shape` 权威 + 17 个取自实现）+ `BuildPlan.solverNeeds[].renderBindings` 渲染契约；`validateClosure` 校验渲染绑定 ⊆ 输出形状（不命中即 SHAPE FAIL，建图期挡 G-2）；**chain:check SHAPE 覆盖升为门**（新求解器缺形状即红）；R11-SHAPE ×6 回归；本体 §5/§7/§8 回写。⬜ 余（增强）：渲染契约从 ExecutionPlan render_answer 自动生成 renderBindings
- 🔄 **2. PRD库结构化**：✅ **`prd:check` 门 + 机器可读索引**（`scripts/check-prd-ontology.mjs` 解析 34 篇 PRD 的《本体引用》§0 → `docs/prd-ontology-index.json`：PRD↔不变量(R)/断点(G) 映射 + 断点 PRD 覆盖(8/8) + 缺口 + 遗留缺 §0 清单；悬空引用即红；并入 `pnpm gates`）—— PRD 入图 ✅ ·《本体引用》机器可解析 ✅ · 需求↔制品↔缺口可查 ✅。⬜ 余（增强）：28 篇遗留 PRD 补 §0 + 制品(代码锚点)↔需求双向（PRD→实现文件）

## 🥈 Tier 2 · 可信赖的推演（Palantir UX 哲学贯彻）— 本轮主线延伸
- 🔄 **3. 项目推演 = 可点穿/可验证的对象链**（哲学 #1/#3/#6）
  - ✅ `<Provenance>` 升通用（对象 lineage 模式 ⊕ 作者标注模式）；P50/P90 结论数字接六要素溯源
  - ✅ **DAG 节点点击 → 抽屉**（`DagNodeDrawer`）：判定逻辑/推导公式/输入数据(含来源+新鲜度)/关联规则（`dagNodeDetail` 每节点六要素 + 规则两跳 RuleRef；每节点同一份 out，数字一致可溯）；f18 回归（聚合求解器/结论节点点穿）
  - ⬜ 缺口/毛利 等其余结论数字补六要素溯源
  - ⬜ DAG 可拖拽/缩放（直接操纵 #7）
  - ⬜ 结论 → 采纳 Action 写回（insight→action #2，f19 已有雏形）
- ✅ **4. 结论溯源覆盖 backlog**（附录A 优先级，全完成）：✅ **S&OP 六卡（三线 需求/供给/缺口 + 收入/毛利/现金）统一走共享 `<Provenance>` 六要素**（取代原 2 要素自绘浮层 → R-一致「一个事实一个出处」；C21/C15/C18 规则两跳；f17 回归改悬浮断言）· ✅ **产能推演峰值/对策量**（项目推演 what-if 对策后P50 六要素 + C03/C08 截顶）· ✅ **订单全链关键数字**（受影响量/营收六要素，财务/订单域）· ✅ **体检结构毛利率**（plan_audit gmStruct 六要素 + C15 口径）—— 至此四大视图结论数字全接共享溯源机制
- ✅ **5. 驾驶舱 widget 升级**（借鉴 HTML dash，全完成）：✅ **富出处悬浮**（widget ⓘ 升共享 `<Provenance>` 六要素）· ✅ **三线偏差复合图**（chartKind `trideviation`：需求/供给/缺口逐月折线 + 偏差柱；数据源 `HistoryBundle.deviation`，后端 bundle 从 trend+危机窗口派生、真实可溯）· ✅ **问题聚合摘要**（type `summary`：`affected_orders` problems[] 四类归并卡）；f37 dash 回归

## 🥉 Tier 3 · 场景启动器 + 本体浏览器（产品可用性）
- 🔄 **6. 场景启动器 P2/P3**（`docs/PRD-scenario-launcher.md`，P1 已完成）
  - ✅ **P2：`Scenario` 升一等对象**（修 G-3 模型倒置）：契约 `ScenarioSchema` + 仓储四处（repos/memory/pg/migration006）+ 出厂幂等 upsert + DRAFT→PUBLISHED→RETIRED + `scenario.*` 事件 + 管理 CRUD（`/scenarios/manage`·POST/PUT·publish·retire）；GET/launch 改 repo 驱动；本体 §2/§4/§8 回写
  - 🔄 **P3：场景配置编辑器 + 启动器三入口**：✅ **场景配置编辑器**（场景为主键 UI——场景第一列 + mode 选择 + 默认 agent + 落点视图闭合 + presetContext 编辑器 + 状态机；治理铁律全展示可配；f37）· ✅ **按域目录墙**（`ScenarioLauncherPage` /scenarios，域分组卡片 + ▶启动）· ✅ **⌘K 命令面板**（`CommandPalette` 全局快捷键搜场景启动）· ✅ 启动复用 `useScenarioLaunch`（注入 presetContext + submitQuery + 对话坞 SSE）+ 左导航入口；f39 回归。⬜ 余：首页高频区（4–6 张按角色高频卡）
  - ✅ **引用闭合「无死路」+ 上架门**：`scenarioClosure`（intent→plan→agent 全配置好，断链拒发布 409）+ manage 就绪态 + `computeReferences` 纳入 Scenario（Agent/Workflow 页可见"被场景引用"）+ ScenesPage 引用闭合列
  - ✅ **响应式失效环（Loop 前端消费端）**：`invalidateForEvent`（本体 §4 event→queryKey）——规则/数据/工作流发布 → 失效引用方 agent/workflow/场景缓存自动重取；接入 RulesPage/ScenesPage 发布；f38 回归
  - ✅ **首页高频区**（`HomePage` 替换裸重定向）：高频场景卡一键启动 + 业务视图快捷入口 + 全部场景入口；至此 P3 启动器三入口（⌘K + 目录墙 + 首页高频）全齐；f39 回归
  - ✅ **命中校验 #2 完成**：intentKey（场景编辑器 datalist + 未命中警示）+ **suggestedQuestions**（QueryDock 建议问句优先取本视图已发布场景的触发问句——经引用闭合验证、点了必命中不落死路）；workflow solverKey/ruleId 闭合（B→A 探针）+ computeReferences 纳入 Scenario。⬜ 余：computeReferences 扩 rule/solver 反查
- 🔄 **7. 本体浏览器 + 字段全建模门 + 半自动建模引擎**（`docs/PRD-ontology-browser-field-coverage.md`）—— 大
  - **参考软件**：[`jingw2/nano-ontoprompt`](https://github.com/jingw2/nano-ontoprompt)（半自动·基于数据的本体建模；v2 数据集成链 Data→Raw→Transform→Curated→Ontology Mapping，确定性映射 dataset→entity / column→property / FK→link + 基数推断）— 融进 A3 `modeling.ts`；+ 参考原型 `reference-prototype-decision-platform.html` 的节点检视器/CSV模板/覆盖徽章 UI
  - ✅ **确定性映射管线**（`deriveModelingSuggestion`：dataset→ObjectType · column→PropertyDef(类型按画像推断) · FK→ref+LinkType · PK=唯一率最高字段；`POST /a/v1/modeling/derive` 无 LLM 出草稿，构造上 100% 覆盖）
  - ✅ **字段全建模门**（`computeFieldCoverage` + `GET /a/v1/modeling/drafts/:id/coverage`；publish `requireFullCoverage` 开门则未建模字段阻断；R12 落地。OM4/OM5/OM6 回归）· ⬜ 升 HARD 默认 + 前端开关
  - 🔄 **本体浏览器**（域分组图谱已有）：✅ **节点检视器增强**（OntologyGraphView Inspector）——字段全建模覆盖徽章（源/派生/手工占比，R12）+ 每字段来源溯源（← 源字段 / 派生 / 手工）+ **CSV 数据模版下载**（借鉴参考原型"每字段100%本体建模覆盖 + 数据模版下载"）；f7 回归。⬜ 余：确定性映射前端工作台（接 `/modeling/derive` + coverage 报告 UI）

## 🔧 Tier 3.5 · 剩余断点
- 🔄 **8. G-5 去电池锁死 / 多租户配置层**（本轮审计量化：范围远超"一行断点"，**撑不起其他租户/行业**）—— 大 —— **PRD 已出** `docs/PRD-de-battery-multitenant-config.md`（含 R14「应用层无业务常数」+ `debattery:check` 门）；本体 §5(R14)/§8(G-5) 已回写
  - **8a 视图结构写死**：✅ PlanAudit 字段组 · ✅ PlanGenerate 目标字段 · ✅ **项目推演 DAG 驱动因子层**（回答"DAG 哪里可配"）· ✅ OrderChain 分类/配色 · ✅ Quarterly 缺口档位 · ✅ GeoMap 利用率阈值 · ✅ **后端 VIEW_DEFS 真下发**（前后端闭环，改后端配置界面就变）· 余项（**纯颜色映射、低价值**，建议交 `debattery:check` 盘出后批量）：RiskBoard 色阶 · GeoMap 定位色(POSITION_COLORS) · AnnualScenario 配色/YEAR · SopBalance 五步标签
  - **8b 业务数据写死** ✅ **全部完成 + 后端闭环**：ProjectSim 型号（**接真实 Model 对象**，消对不齐）/地址/物流（`simConfig`）· GeoMap 坐标（`Base.props.lon/lat`）· Calibration 基地（Base 对象）· SopBalance 阈值+三段（`sopConfig`）· PlanGenerate 目标（`planGoals`）
  - **8c 文案/业务常数写死** ✅ **完成（de-battery 目的达成，debattery 基线 22→0）**：always-rendered 电池专属文案 genericize（ProjectSim 对策行 化成→产能瓶颈、SopBalance 增量行→通用名）· SopBalance 决议默认项 config-drive（`sopConfig.defaultResolutions`，电池名移入租户配置）· 其余兜底逐行 `// debattery-allow`（gate 扫描 0 未声明业务常数）· **`zh.ts` 行业专属串已清零**：GeoMap 定位配色/图例 config-drive（`view.layout.positionColors`，POSITION_COLORS 仅兜底）+ 删除死 i18n 项 `geo.power/storage/mixed`（实测未被引用，图例本就数据驱动自 `base.position`）
    - **审计澄清**：原"~35 处内联文案"实测为 **~500 处通用中文 UI 文案**（表头/步骤标签/提示语），属**多语言 i18n 外化**（仅当新增英文 locale 才需），**与多租户/去电池无关**（业务术语死路已 0）。**判定为刻意非目标**（单语中文产品 + 多租户经配置已满足）；若未来需多语言，另起 i18n PRD 专项，勿在此塞 churn。
  - **8d Agent/配置** ✅ **经核实已满足**（既有架构已解决）：运行时模型走 `roleModel(tenant,"agent",fallback)` LLM Provider 用途绑定（`orchestrator.ts:618`，seed 的 `model` 字段运行时不读）· 既有 Agent 可经 `PUT /b/v1/agents/:id` + AgentsPage 编辑 systemPrompt/tools · seed=出厂默认可覆盖 · `BATTERY_SOLVER_PARAMS` 为电池行业模板，其他行业走各自 IndustryTemplate（SY3 已证）
  - **8e `generic-inference`** ✅ **已落**（PRD `docs/PRD-generic-inference.md`）：`recompute(dryRun+apply)` 克隆图前向重算派生、不落真值 + `POST /a/v1/inference/whatif`，行业无关；O4b 回归（前向重算+无副作用）。注：作用于 compileSpecs 派生本体；合成 demo 用 runDerivations 另一路（后续可统一）
  - **门禁 `debattery:check`**（待办）：静态扫描视图/页内联业务常数 + i18n 租户串 → 自动盘出剩余 + 防回潮（落地 R14）
  - 注：出厂种子（场景目录/意图/计划/场景入口/经验库/规则库）经核实**可被租户 DRAFT→PUBLISH 覆盖 = 可接受**
- ⬜ **8.5 `debattery:check` 门禁**（独立工具，与 `ontology:check`/`chain:check` 同级，并入 `pnpm gates`）：静态扫描 `views/`+`pages/` 内联业务常数（基地名/型号/工序/坐标）+ `zh.ts` 租户专属串 → 自动盘出剩余写死项 + 防回潮（落地不变量 R14）。`DEFAULT_*` 兜底常量白名单豁免。
- 🔄 **9. G-6** ✅ `parseXlsx`（node-xlsx，xlsx 上传→解析→RawDataset，三路 csv/json/xlsx 统一；CN1b 回归）· ✅ 合成并入连接器（活数据 P1）· ⬜ 在线数据模版（并入 #7 本体浏览器）
- ⏸ **10. G-7 余项**（评估为低价值，暂缓）：6 用途各对应固定调用点（classifier/agent/compose…），"枚举可扩展"无消费点即无意义；真实 LLM 扩展性（多供应商/按用途绑定模型/降级）已由 `roleModel`/`bindingFor` 满足。如需自定义用途，须先定义其调用点（另起 PRD）。
- ⬜ **11. 外部域（EXT_SIG）** 环境信号一等对象化 + 新 EXTERNAL 连接器（规划体检/建议敏感性输入）

## 🔭 Tier 4 · dogfooding 终态
- ⬜ **12.** 本体落库 PoC（系统本体注册为平台 ObjectType/SliceSpec/Rule → 平台切系统自己）
- ⬜ **13.** 本体活查询面（MCP/端点，Claude 问运行中的系统）
- ⬜ **14.** 本体自动派生扩展（§2/§3/§4 从代码生成，人只策展语义）

## 📌 非开发遗留
- ⚠ **吊销并更换暴露的 Gemini API key**（早前明文发过）
- ⬜ 上云部署脚本（本机 `docker compose up --build` 已可；公网域名需自控主机）

---
**建议下一步**：Tier 2 #3（把放大的 DAG 接上六要素溯源 → "大画布 + 每节点可验证"，一次兑现 Palantir 哲学 #1/#3/#6）。
