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
- 🔄 **1. 全链闭包门 R11 完整版**（chain:check 已是第一块砖）：BuildPlan 扩 AgentCore 栈 + ClosureReport CHAIN/SHAPE + 焊进构建发动机 —— 大
- ⬜ **2. PRD库结构化**（PRD 入图、《本体引用》机器可解析、需求↔制品↔缺口可查）

## 🥈 Tier 2 · 可信赖的推演（Palantir UX 哲学贯彻）— 本轮主线延伸
- 🔄 **3. 项目推演 = 可点穿/可验证的对象链**（哲学 #1/#3/#6）
  - ✅ `<Provenance>` 升通用（对象 lineage 模式 ⊕ 作者标注模式）；P50/P90 结论数字接六要素溯源
  - ⬜ DAG 节点点击 → 抽屉：判定逻辑/推导公式/输入数据(含来源+新鲜度)/关联规则（接 `<Provenance>`/lineage）
  - ⬜ 缺口/毛利 等其余结论数字补六要素溯源
  - ⬜ DAG 可拖拽/缩放（直接操纵 #7）
  - ⬜ 结论 → 采纳 Action 写回（insight→action #2，f19 已有雏形）
- ⬜ **4. 结论溯源覆盖 backlog**（附录A 优先级）：**S&OP 三线 > 产能推演峰值/对策量 > 订单全链 DAG 关键数字 > 体检输入项**
- ⬜ **5. 驾驶舱 widget 升级**：富出处悬浮 / 三线偏差复合图 / 问题聚合摘要（借鉴 HTML dash）

## 🥉 Tier 3 · 场景启动器 + 本体浏览器（产品可用性）
- 🔄 **6. 场景启动器 P2/P3**（`docs/PRD-scenario-launcher.md`，P1 已完成）
  - ⬜ P2：`Scenario` 升一等对象 + 仓储四处 + 出厂 upsert + 发布/退役事件
  - ⬜ P3：前端 ⌘K 命令面板 + 按域目录 + 首页高频
- 🔄 **7. 本体浏览器 + 字段全建模门 + 半自动建模引擎**（`docs/PRD-ontology-browser-field-coverage.md`）—— 大
  - **参考软件**：[`jingw2/nano-ontoprompt`](https://github.com/jingw2/nano-ontoprompt)（半自动·基于数据的本体建模；v2 数据集成链 Data→Raw→Transform→Curated→Ontology Mapping，确定性映射 dataset→entity / column→property / FK→link + 基数推断）— 融进 A3 `modeling.ts`；+ 参考原型 `reference-prototype-decision-platform.html` 的节点检视器/CSV模板/覆盖徽章 UI
  - ⬜ 确定性映射管线（dataset→ObjectType · column→PropertyDef · FK/值重叠→LinkType · 基数/质量）
  - ⬜ 字段全建模门（R12 升 HARD + `coverage:check`）
  - ⬜ 本体浏览器（域分组图谱 + 节点检视器 + CSV 模板 + 覆盖徽章）

## 🔧 Tier 3.5 · 剩余断点
- 🔄 **8. G-5 去电池锁死 / 多租户配置层**（本轮审计量化：范围远超"一行断点"，**撑不起其他租户/行业**）—— 大 —— **PRD 已出** `docs/PRD-de-battery-multitenant-config.md`（含 R14「应用层无业务常数」+ `debattery:check` 门）；本体 §5(R14)/§8(G-5) 已回写
  - **8a 视图结构写死**（≈9 视图）：ProjectSimView 的 6 层 DAG(`buildDag`)、PlanAuditView 9 字段组、PlanGenerateView 5 目标+3 方案、SopBalanceView 五步状态机、RiskBoardView 色阶、GeoMapView 坐标、OrderChainView 分类、AnnualScenario/QuarterlyRolling 档位 —— 应由 ExecutionPlan 派生 + ViewConfig.layout 声明（学 DashboardView 标杆）
  - **8b 业务数据写死（进生产、不可覆盖）**：GeoMap 基地坐标×8 · ProjectSim 型号/地址/物流表 · PlanGenerate 目标默认值 · SopBalance 阈值+三段 · Calibration 基地筛选(4/12) —— 应从 API(Base/Model 对象)/WorkspaceConfig/SolverParams 取
  - **8c 文案写死**：~35 处中文内联绕过 `zh.ts`；i18n 本身混入租户专属串（`zh.ts:569 "如 常州"`、`:377 "扩化成通道"`）—— 归集 i18n + 行业别名映射
  - **8d Agent/配置写死**：Agent `systemPrompt`/tools/scope(`seed.ts:539-576`)、模型写死 `claude-opus-4-8`(`seed.ts:538`)、`BATTERY_SOLVER_PARAMS`(`battery.ts`) —— 出厂种子可接受**前提是可经 admin 覆盖**（编辑既有 Agent 的可改性待核实）；模型应走 LLM Provider 用途绑定
  - **8e `generic-inference`** 通用 what-if（脱离电池求解器）
  - 注：出厂种子（场景目录/意图/计划/场景入口/经验库/规则库）经核实**可被租户 DRAFT→PUBLISH 覆盖 = 可接受**；mock 数据隔离良好不进生产
- ⬜ **9. G-6** `parseXlsx` + 在线数据模版 + 合成并入连接器（与 #7 协同）
- ⬜ **10. G-7 余项** LLM 用途枚举可扩展 + 按页面标注
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
