# 轨P · 复刻建模族 · 增量4：中栏 6 子 tab + Agent 指挥台接 QOS + 主题接轨O（收尾）

> SPEC-replica-modeling-family 增量4 + 补遗（中栏 6 子 tab）+ design-system §10③ 边界。分层交付 b：
> ①接现成 full 1:1（Skills/MCP/日志/QOS 真后端）；③类（图查询）显式 RESERVED 不画假壳。
> **完成判据 = 真浏览器每 tab 接真后端 + Agent 真提交 QOS（补 G-3），非测试绿。**

## 1. 落点
`ModelingPage` 新增 `ModelingConsole`（DAG 之下）：左中栏 6 tab + 右 Agent 指挥台。
6 tab：`基本信息 | 图查询 | Skills | MCP服务 | 日志 | 指南`；右胶囊 `执行节点(选中)⤢ | 清除 | ‹折叠`。

## 2. 逐 tab 真后端核对（真浏览器·`p4-console-fde.mjs`）

| tab | 来源 | 真跑结果 | 类别 |
|---|---|---|---|
| **基本信息** | `deriveCertification` GLOBAL（复用增量2 面板） | L0-L4 真级 + 综54/结100/知28/行18 + L4三勾 | ①接现成 |
| **图查询** | —（后端整块未建） | **◌ RESERVED**（§10.1 #3/#4）·不画假构建器/假结果表 | ③类 TO-DO |
| **Skills** | `GET /b/v1/skills`（B4） | 真技能「产能分析方法论 / capacity_analysis / PUBLISHED」 | ①接现成 |
| **MCP服务** | `GET /b/v1/mcp-configs`（B3） | demo 0 → **诚实空态**（真态为空·非假壳） | ①接现成 |
| **日志** | `GET /a/v1/outbox`（领域事件馈源） | 真 69 事件（sim.session_created / supply_risk / rule.alert …）近30条 | ①接现成 |
| **指南** | 静态帮助文档 | 建模工作流 5 步指引（非数据·不属假推演） | 静态 |

逐 tab 实测片段（节选）：
```
6 tab 存在: [基本信息, 图查询, Skills, MCP服务, 日志, 指南]
[Skills] 产能分析方法论 capacity_analysis PUBLISHED 产能金字塔口径与 P50/P90 解读要点 → ✓ 真技能
[MCP服务] demo 未配置 MCP 服务（真态为空·非假壳）→ ✓
[日志] 领域事件日志（真 outbox·近 30/69）… sim.session_created / supply_risk / rule.alert
[图查询] ◌ 图查询 · RESERVED（后端未建·§10.1 TO-DO）… 不画假构建器/假结果表
```

## 3. Agent 指挥台接 QOS（补 G-3 前端段）
- 复用 `useQuickLaunch`（既有 QOS 管线·不新建聊天）：选中对象 → 注入 `presetContext.selectedObjects=[{objectType,objectId,label}]` → `POST /b/v1/queries` → 对话坞。
- 真浏览器：点 DAG 实体节点 Order（选中持久）→ Agent 摘要显**真 ObjectType 数据** `📌 node_obj_Order · 销售订单：属性 13 · 派生 1 · 域 product` → 输入提问 → **`POST /b/v1/queries` 提交 1 次 ✓**（落 /v/dash 对话流）。
- demo 无 LLM → 真答案受限（继承轨M 2b 口径），但**提交 + presetContext 注入是真 G-3 前段**。
- 选中/抽屉解耦：关抽屉不清选中 → 中栏「执行节点」胶囊 + Agent 持续反映当前对象（image2 形态），胶囊可重开抽屉、「清除」复位。

## 4. 主题接轨O
全 `var(--token)`（--txt/--muted2/--border/--ok/--panel…），无硬编码域色；域色 theme-invariant（RL5）。截图深色主题整页一致。

## 5. 诚实降级
- AgentCore off → Skills/MCP tab 显「不可达·诚实降级」（不画假技能/假 MCP）。
- 图查询 ③类 → RESERVED（后端 backlog §10.1 建成后点亮）。

## 6. 门
`build` ✓ · `typecheck` ✓ · `lint`(ModelingPage.tsx) ✓ · `test` 278/278 ✓。
脚本：`scratchpad/p4-console-fde.mjs`。截图：`replica-modeling-p4-console-{skills,logs,guide}.png`。

## 本体引用与影响
- **对象类型**：SkillDefinition(B4)/McpServerConfig(B3)/DomainEvent(outbox)/ObjectType（读·展示）；QOS Query（提交·presetContext）。
- **链路**：QOS 查询编排链（前端注入 presetContext → submitQuery → SSE）——**补 G-3 前端段**（场景上下文注入 QOS），复用 useQuickLaunch，无新端点。
- **断点**：**G-3 ◐→** 建模页新增 presetContext 注入入口（与轨M 2b 驾驶舱 AI 栏同机制）；其余不触。
- **不变量**：R13（Skills/日志/对象摘要溯真后端）；RL5（域色 theme-invariant）；R14（无业务常数·全接端点）。
- **门禁**：纯前端接现成端点（B4/B3/outbox/QOS），无契约/后端改动；图查询③类未建仍登记 TO-DO（design-system §10.1 不变）。无需回写本体新章节（仅 G-3 前端段扩展，与轨M 2b 同口径）。
