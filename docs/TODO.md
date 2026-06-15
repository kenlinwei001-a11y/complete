# TODO · 系统协同进化路线（按重要程度排序）

> 状态：✅ 已完成 · 🔄 进行中 · ⬜ 待办。断点编号见 `docs/SYSTEM-ONTOLOGY.md` §8；域/切片见 §10。
> 纪律：每批 `pnpm -r build && test` + `ontology:check` 全绿；改链路/事件回写系统本体。

## ✅ Tier 0 · 已完成（基线）
- 系统本体 `docs/SYSTEM-ONTOLOGY.md` §1–§10（含域/切片/跨域节点）+ 治理闭环（CLAUDE.md 铁律0 / SessionStart 钩子 / `/ontology` skill / `ontology:check` / PRD 模板）
- PRD `docs/PRD-unified-build-engine.md`（统一构建发动机）
- 审核 `docs/AUDIT-0614-fullchain.md`
- **P0 修复**：G-1（20 场景全接通意图+计划）· G-2（跨服务形状）· 跨服务冒烟 · G-7（model 显示）

## 🥇 Tier 1 · 机制定型（最高：决定能否持续敏捷+稳定+协同进化）
- 🔄 **1. 运行模型文档** `docs/OPERATING-MODEL.md`（协同进化闭环 + 两层本体 + 防腐三防线 + 域/切片/跨域节点 + Claude 嵌入）
- 🔄 **2. 全链闭包门 R11 落地** —— 第一块砖已落：`pnpm chain:check`（跨系统校验场景↔求解器注册，故障注入验证有效）+ scenarios-wiring 回归 + 跨服务冒烟。完整版（BuildPlan 扩 AgentCore 栈 + ClosureReport CHAIN/SHAPE + 焊进构建发动机）待 PRD P1 —— 大

## 🥈 Tier 2 · 人机/AI 统一入口 + 可追溯
- ✅ **3. CLI 对话入口** `scripts/platform-cli.mjs`（login/ask/SSE 渲染/clarification 多轮/approve）—— 实测：login✓(真实 DataCore 认证)、scenarios✓(跨服务 JWT+读路径)、ask✓(全 QOS 管线跑通；唯一待配=LLM provider API key)。Claude 嵌入落地形态。
- ⬜ **4. PRD库结构化**（PRD 入图、《本体引用》机器可解析、需求↔制品↔缺口可查）

## 🥉 Tier 3 · 剩余断点修复（产品可用性）
- ✅ **5. G-4** 前端自助闭合：CatalogPage ＋新建执行计划(createPlan) · WorkflowsPage/SkillsPage ＋新建 + mock POST handlers + db.plans 隔离；g4 回归 + 112 前端测试绿、0 渲染错误
- 🔄 **6. G-3** 场景启动器（workflow-first 骨架 ⊕ agent 解读节点）—— **PRD 已出** `docs/PRD-scenario-launcher.md`（Scenario 升一等主键 + presetSlots 注入通道 + riskLevel 分流 + ⌘K/目录/首页三入口 + chain:check 上架门）；待实现
- ⬜ **7. G-5** `generic-inference` 通用 what-if + scaffold 去电池锁死 —— 大
- ⬜ **8. G-6** `parseXlsx` + 在线数据模版 + 合成并入连接器（含引库决策）
- ⬜ **9. G-7 余项** LLM 用途枚举可扩展 + 按页面标注
- 🔄 **10. 本体浏览器 + 字段全建模门 + 半自动建模引擎**（D1→D2，切片 `sys.ingest.data_to_object`，强化不变量 R12）—— 大 —— **PRD 已出** `docs/PRD-ontology-browser-field-coverage.md`（合并参考 [`jingw2/nano-ontoprompt`](https://github.com/jingw2/nano-ontoprompt) 的确定性映射管线 + 参考原型 `docs/reference-prototype-decision-platform.html` 的节点检视器/CSV模板/覆盖徽章 UI 策展）
  - **确定性优先、LLM 兜底**：A3 `suggest()` LLM-only → 补 `dataset→ObjectType · column→PropertyDef · FK/值重叠→LinkType · 基数推断 + 质量评分`。
  - **字段全建模门（用户硬要求）**：每个导入 column 必映射到某 PropertyDef 或显式 waive，未覆盖即拦发布（R12 升 HARD + `coverage:check` 门）。
  - **本体浏览器**：域分组图谱 → 节点检视器（数据源+字段schema+样例+公式+规则+被谁操作+覆盖徽章）+ 每节点下载 CSV 导入模板。
  - 待实现；与 G-6 rawin 三路对齐。

## 🔭 Tier 4 · dogfooding 终态
- ⬜ **11.** 本体落库 PoC（系统本体注册为平台 ObjectType/SliceSpec/Rule → 平台切系统自己）
- ⬜ **12.** 本体活查询面（MCP/端点，Claude 问运行中的系统）
- ⬜ **13.** 本体自动派生扩展（§2/§3/§4 从代码生成，人只策展语义）

---
执行顺序：1（框架）→ 3（CLI 快赢+嵌入实体）→ 2（结构性稳定）→ Tier 3 修断点（含 #10 建模引擎）→ Tier 4 dogfooding。
