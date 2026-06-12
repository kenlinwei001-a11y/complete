# PRD · 前端应用（Workspace Shell + 决策工作台）

| 项 | 值 |
|---|---|
| 版本 | v1.0（与 **平台 PRD v2.0**、**QOS-PRD v1.0** 配套，三份文档一起交付开发） |
| 目标读者 | 负责实现的开发 Agent / 前端工程师（TypeScript + React） |
| 交付物 | 单一 SPA（`apps/frontend-shell`）+ Mock 模式（无后端可独立开发）+ 测试 |
| 设计基准 | 原型 HTML（全域数字化智能决策支撑系统单文件原型）的视觉与交互语言：深色主题、高信息密度、点击即溯源 |

---

## 0. 给开发 Agent 的执行说明

1. 本文是前端唯一需求来源；后端契约以 `packages/contracts`（来自平台 PRD §1.2 C-3）为准，**前端不得自定义与契约重复的类型**。
2. 字段、路由、事件名、组件契约不得更改；视觉细节（间距/圆角等）可在设计 token（§5）约束内自由发挥。
3. 必须先实现 **Mock 模式**（§9，MSW），使前端在两个后端都不在场时可完整开发与演示；验收用例（§11）默认在 Mock 模式下跑，另设少量真连冒烟。
4. 实现顺序建议：工程骨架+设计 token（§2/§5）→ 登录与 Workspace Shell（§6.1）→ 查询对话组件（§6.2–6.5，全平台核心）→ 业务视图渲染器（§7.1–7.3）→ 管理台（§7.4–7.9）→ 验收。
5. 完成标准：§11 全部通过 + `pnpm lint` / `pnpm test` / `pnpm build` 通过。

---

## 1. 范围

**范围内**：登录与多租户 Workspace；元数据驱动的业务视图（驾驶舱/本体图谱/推演看板/台账）；查询对话组件（QOS 客户端全交互）；DataCore 管理台（连接器/文档审核/本体建模/权限/合成数据/Action 审批）；AgentCore 管理台（agent/workflow/skill/MCP/场景入口/意图目录）。
**范围外**：移动端适配（仅保证 ≥1280px 桌面）；原型中的纯演示动画（学习曲线动画等）；富文本/BI 自助报表。

---

## 2. 技术栈与工程约定

| 项 | 选型（不得替换为同类竞品，除非 PR 说明理由） |
|---|---|
| 框架 | React 18 + TypeScript 5.4+（strict）、Vite 5 |
| 路由 | react-router v6（数据路由模式） |
| 服务端状态 | TanStack Query v5（所有 REST 读写；key 规范见 §4.2） |
| 客户端状态 | zustand（仅 UI 态：面板开合、选中节点、对话 dock 状态） |
| 校验/契约 | zod（直接复用 `packages/contracts` 的 schema 做运行时解析） |
| 样式 | CSS 变量设计 token + CSS Modules（不引 UI 组件库；表格/弹窗/抽屉自实现，原型已给出全部样式范式） |
| 图表 | echarts（驾驶舱/时序曲线）；本体图谱自研 SVG 力导向（§7.2，原型已验证可行） |
| Mock | MSW v2 |
| 测试 | vitest + @testing-library/react + playwright（少量 E2E） |

环境变量：`VITE_DATACORE_URL`、`VITE_AGENTCORE_URL`、`VITE_MOCK=1`。所有 API 调用经统一 `apiClient`（自动附 JWT、401 时静默刷新、刷新失败跳登录；分别指向 A/B 两个 baseURL——**前端是两系统松耦合的汇合点，禁止经任一后端中转另一后端**）。

---

## 3. 信息架构与路由表

```
/login
/ ………………………………… Workspace Shell（鉴权守卫；加载 GET /a/v1/me/workspace）
├─ /v/:viewKey …………… 业务视图（动态：按 workspace.views[].renderer 分发，§7.1–7.3）
├─ /tasks/:taskId ……… 查询任务详情页（完整回放：分类→步骤→回答→溯源）
└─ /admin（按角色显隐，§8）
   ├─ /admin/connections        连接器与上传（A1）
   ├─ /admin/rule-docs          规则文档审核台（A2）
   ├─ /admin/modeling           本体建模工作台（A3）
   ├─ /admin/rules              规则库（A5）
   ├─ /admin/permissions        权限策略 + authz explain（A6）
   ├─ /admin/synthetic          合成数据向导（A7）
   ├─ /admin/actions            Action 草稿与审批（A4）
   ├─ /admin/catalog            意图目录与执行计划（B6/QOS §8.4）
   ├─ /admin/agents | /admin/workflows | /admin/skills | /admin/mcp | /admin/scenes   （B1–B5）
   └─ /admin/ops/fallback       兜底统计与意图孵化（QOS §8.5）
```

导航不硬编码：Shell 按 `workspace.navigation` 渲染业务视图项，按角色渲染 admin 分组。`viewKey` 未知/无权 → 统一 403/404 空态页。

---

## 4. 数据层契约

### 4.1 启动序列
`POST /a/v1/auth/login` → 存 token（内存 + refresh 落 httpOnly 由后端 Set-Cookie；access 不进 localStorage）→ `GET /a/v1/me/workspace` → 渲染 Shell。workspace 结构（contracts 已定义）：`{ tenant, user, theme, navigation[], views: ViewConfig[], scenarioPackages[] }`。

### 4.2 TanStack Query key 规范
`[system, resource, params]`，如 `["a","objects",{type,filter}]`、`["b","intents",{packageId}]`。写操作后按前缀失效。SSE 不走 Query（§6.3 专用 hook）。

### 4.3 SSE 客户端（`useTaskStream(taskId)`，全局唯一实现）
- `EventSource` 连 `GET {B}/b/v1/queries/{taskId}/events`（token 经 query 参数 `?access_token=`，契约补充项）。
- 维护 `lastEventId`；`onerror` 后指数退避（1s/2s/4s，上限 30s）重连并带 `Last-Event-ID`；按事件 id 去重。
- 收到终态事件（`answer.final`/`task.failed`/`task.cancelled`）→ 关闭连接并将任务写入 Query 缓存。
- 对外暴露：`{ status, events[], answer?, clarification?, error? }`（reducer 聚合，事件名与 QOS-PRD §8.2 一字不差）。

---

## 5. 设计系统（token 取自原型，规范性）

```css
:root{
  --bg:#0D1117; --bg2:#11161D; --panel:#161C24; --panel2:#10151C;
  --line:rgba(226,235,245,.07); --line2:rgba(226,235,245,.13);
  --txt:#E9EEF5; --muted:#9AA8B6; --muted2:#67737F; --accent:#4C90F0;
  /* 领域色（图谱/图例/标签复用） */
  --c-factory:#5E8FE8; --c-product:#36BFA5; --c-process:#DD9551; --c-equip:#9D8BF0;
  --c-people:#DD7E9E; --c-quality:#62BE77; --c-capacity:#43B7D7; --c-forecast:#D2B04C;
  --c-solver:#C470B8; --c-agent:#5FC2AE;
  --font-sans:"Inter","Segoe UI",system-ui,"PingFang SC","Microsoft YaHei",sans-serif;
  --font-mono:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;
}
```

- 数字一律 `--font-mono`；中文正文 `--font-sans`。
- **信任级视觉（全局一致，不得变体）**：`VERIFIED_WORKFLOW` → 绿色徽章「已验证 · 工作流」；`AGENT_EXPLORATORY` → 琥珀色徽章「探索 · AI」+ 回答卡虚线边框；`unverifiedNumerics=true` → 回答卡顶部琥珀警示条「部分数字未能溯源，仅供参考」。
- 主题可被 `workspace.theme` 覆盖（仅 token 值，不改结构）——这是"不同账号不同前端"的视觉部分。

---

## 6. 核心交互规格（查询对话，全平台复用）

### 6.1 Workspace Shell
左侧导航（分组：业务视图/管理台）+ 顶栏（租户名、用户菜单、全局搜索占位）+ 内容区 + **查询 Dock**。Dock 是底部可展开抽屉（收起=单行输入框，展开=对话面板 720px 宽右侧滑出），在所有 `/v/:viewKey` 页面常驻；admin 页面不显示。

### 6.2 提交查询
- 输入回车 → 组装 `SessionContext`：`{ view: 当前viewKey, selectedObjects: 页面选中集(§7 各视图维护), filters: 当前筛选, timeWindow, conversationId }` → `POST {B}/b/v1/queries`（带 `Idempotency-Key`=uuid）→ 拿 taskId → `useTaskStream`。
- 输入框 placeholder 与推荐问题 chips 来自该视图的 `SceneEntryConfig.uiHints`（`GET {B}/b/v1/scenes?view=`）。
- 同一会话多次提问追加在同一对话流；`conversationId` 保持。

### 6.3 流式过程展示
按事件渲染时间线：`routing.completed` → 路径徽章（工作流名 或「探索模式」提示）；`step.started/completed` → 可折叠步骤行（图标按 step type，耗时 mono 字体；失败步红色）；心跳超过 30s 无事件 → 显示「仍在执行…」。

### 6.4 澄清交互
- `clarification.required(kind=INTENT_CHOICE)` → 选项卡片（name+description）+「都不是」按钮 → `POST /queries/{id}/clarification`。
- `kind=SLOT_FILLING` → 内联表单：按 SlotDef.type 渲染控件（date→日期选择；enum→下拉；objectRef→对象搜索选择器，调 `GET {A}/a/v1/objects?type=&q=`；timeWindow→双日期）。round 显示「第 n/2 次确认」。

### 6.5 AnswerBlock 渲染器（每种 block 一个组件，契约固定）

| block.type | 渲染 |
|---|---|
| `text` | markdown 渲染；`⟦ref:provId⟧` 替换为上标引用角标，点击/悬停 → 溯源弹窗 |
| `table` | 紧凑数据表（原型 `.cmp` 样式）；表头右侧溯源角标（provId） |
| `kpi` | KPI 卡（label/value/unit，value 用 mono 大号）；整卡可悬停溯源 |
| `rule_violation` | 红边卡：规则 key 徽章 + explanation + 溯源角标 |
| `action_draft` | 卡片含「待审批」状态徽章 + 摘要 + 跳转 `/admin/actions` 链接 |

**溯源弹窗（ProvenancePopover，全局唯一组件，交互复刻原型的 provSpan 弹窗）**：悬停 300ms 出现/点击固定。内容四段：值与口径（value+label）→ 来源（toolName + snapshotVersion）→ 计算（outputPath；workflow 路径下追加 stepId 与公式说明，取自 step.completed payload）→ 规则（命中的规则 key，点击展开 expression）。数据来自 `answer.provenance` 解引用 + `GET /tasks/{id}` 详情。

### 6.6 反馈与详情
回答尾部 👍/👎（`POST /queries/{id}/feedback`）+「查看完整执行过程」→ `/tasks/:taskId`（全量事件回放 + 分类结果 + 工具调用审计表）。

---

## 7. 页面模块规格

### 7.1 业务视图分发器
`ViewConfig.renderer ∈ "dashboard" | "ontology-graph" | "risk-board" | "ledger"`。未知 renderer → 显式「该视图类型暂不支持」卡（不白屏）。各视图把用户选中实体写入共享 store（`selectedObjects`），供查询 Dock 取用——**这是上下文随问句提交的来源，必须实现**。

### 7.2 本体图谱视图（renderer=ontology-graph）
- 数据：`GET {A}/a/v1/ontology/graph?packageId=`（类型级图：节点=ObjectType（含 domain/tier），边=LinkType）。
- 自研 SVG 力导向（参数对齐原型：斥力/弹簧/中心引力 + alpha 退火），要求 ≤300 节点拖拽/缩放流畅（>16ms 帧任务需节流渲染）；节点按 domain 着色（§5 token），求解器菱形/agent 六边形/对象圆形。
- 点击节点 → 右侧检查器面板：属性清单、源系统（sourceBindings）、适用规则（点击看 expression）、派生公式；并写入 `selectedObjects`。
- 图例可按 domain 过滤（淡出非选中，复刻原型 dim 交互）。

### 7.3 驾驶舱（renderer=dashboard）与推演看板（renderer=risk-board）、台账（renderer=ledger）
- dashboard：卡片网格由 ViewConfig.layout 声明（kpi/chart/table 三种 widget，数据源为声明式 query 定义，前端只执行不硬编码）；每个数字可悬停溯源（widget 配置含 provenance 描述）。
- risk-board：风险卡网格（峰值/越线日）+ 点开详情的逐日时序条（echarts heat strip）+ 时点点击 → 受影响订单弹窗（`GET {A}` 对象查询）；交互密度对齐原型预判推演看板。
- ledger：服务端分页表格 + 行展开下钻 + 列筛选（筛选状态进 SessionContext.filters）。

### 7.4 数据接入控制台（/admin/connections）
连接列表（状态/上次同步/错误）→ 新建向导（选 ConnectorType → 按 configSchema 动态表单（JSONSchema→表单生成器，支持 string/number/boolean/enum/secret；secret 输入后不回显）→ 测试连接 → 保存）；文件上传卡（拖拽，进度条，完成后跳字段画像页）；字段画像页：数据集表 + FieldProfile 表（类型徽章/枚举候选 chips/空值率条）。同步任务进度轮询 `GET sync jobs`。

### 7.5 规则文档审核台（/admin/rule-docs）
左右分栏：左=文档段落（高亮当前候选的 sourceQuote span）；右=候选规则卡（name/expression 可编辑、scope 多选、severity 选择、置信度条）+ 操作 APPROVE / EDIT_APPROVE / REJECT。顶部进度（n/m 已审）。diff 模式：文档更新后展示 新增/变更/疑似删除 三组。

### 7.6 本体建模工作台（/admin/modeling）
三栏：源字段（FieldProfile 列表，按数据集分组）｜映射画布（建议的对象类型卡：属性行=propKey←sourceField，主键星标，ref 连线；MAP_TO_EXISTING 显示「复用」徽章）｜操作面板（PATCH 操作：改名/加删属性/改类型/设引用——每个操作即时调 PATCH 端点，乐观更新+失败回滚）。发布按钮 → 校验错误内联展示在对应卡上。发布成功 → 引导触发 materialize 并展示作业进度。

### 7.7 合成数据向导（/admin/synthetic）
三步：① 输入行业（已有模板下拉 + 自由输入）+ 规模 S/M/L + seed → ② 提交后进度页（六阶段 stepper，对齐平台 PRD §7.2 ①–⑥，轮询 job）→ ③ 校验报告页（行数表/规则扫描结果/抽样复算结论；失败项红色展开）。重跑入口注明「将清除该租户全部 SYNTHETIC 数据」二次确认。

### 7.8 AgentCore 管理台（/admin/agents|workflows|skills|mcp|scenes|catalog）
- agents：列表+版本下拉；编辑器分区（基础/模型/系统提示词（mono 编辑框）/工具（三类 AgentToolRef 的选择器：内置勾选、MCP 选服务器+工具过滤、workflow 选择器）/规则绑定/skills/scopeDeclaration（对象类型多选+工具多选，醒目提示"最小授权"）/预算）。发布按钮含校验错误展示。
- workflows：步骤列表编辑器（上下移/增删；每种 step type 一个参数表单；TemplateValue 输入框带 `{{slots.*}}/{{steps.*}}` 自动补全，来源为已声明 slots 与前序步骤）；发布校验错误定位到具体步骤行（含环检测错误）。
- catalog：意图列表（status 筛选）；意图编辑（examples 列表、slots 表格、绑定计划选择）；发布/退役。`/admin/ops/fallback`：聚类列表（querySample/count/趋势）+ 一键 promote → 跳转生成的 DRAFT 意图编辑页。
- scenes：每视图一行：mode 四选一 + defaultAgent + 建议问题编辑。
- skills/mcp：常规 CRUD；mcp 凭据字段 secret 处理；「连接测试」按钮显示 tools/list 发现结果。

### 7.9 权限与 Action（/admin/permissions、/admin/actions）
- permissions：策略表（资源/角色授权矩阵/rowFilter 表达式编辑）；**authz explain 调试器**：选用户+资源 → 展示命中策略链与最终行过滤（直连 `POST /a/v1/authz/explain`）。
- actions：草稿列表（状态机：PENDING_APPROVAL→APPROVED/REJECTED），详情含参数快照与来源任务链接；审批操作二次确认。

---

## 8. 权限驱动 UI（规范）
- 路由级：admin 各页按角色显隐（workspace 返回的 `user.roles` 与导航配置共同决定）；直接输 URL 无权 → 403 页。
- 操作级：无权操作**隐藏**（非置灰），避免泄露能力面；唯一例外是审批类按钮（置灰+原因 tooltip）。
- 数据级不在前端做：后端已过滤，前端不得二次"补偿过滤"或缓存跨账号数据（切换账号必须清空 Query 缓存与 zustand store）。

## 9. Mock 模式（MSW）
- `VITE_MOCK=1` 时启用：handlers 覆盖本文引用的全部端点，fixtures 与平台 PRD §7.6 电池种子数据一致（12 基地/20 订单/4 意图）；SSE 用 mock EventSource（脚本化事件序列：正常流/澄清流/失败流/断线重放流四套）。
- Mock 必须能演示：A1/A2/B1（QOS-PRD 验收编号）三条对话样例、澄清两种 kind、unverifiedNumerics 警示、权限差异（mock 两个账号）。

## 10. 非功能
- 首屏（登录后到 Shell 可交互）≤2s（Mock 模式）；路由按页 code-split。
- 所有列表虚拟化阈值 200 行；图谱节点 >300 给降级提示。
- 错误边界：页面级 ErrorBoundary + 全局 toast；API 错误展示 `error.code + message + requestId`（requestId 可复制）。
- 中文为第一语言；文案集中 `locales/zh.ts`（预留 i18n 结构，不做翻译）。
- 可访问性底线：全部交互可键盘到达；弹窗 focus trap。

## 11. 验收标准（Mock 模式，playwright/vitest 自动化）

| # | 用例 | 预期 |
|---|---|---|
| F1 | 登录账号 planner 与 base_manager | 导航/视图/主题不同（workspace 驱动）；切账号后缓存清空 |
| F2 | 在 risk 视图选中常州基地后提问"影响哪些订单？" | 请求体 SessionContext 含该 selectedObject；流式步骤时间线渲染；最终 table 回答 + VERIFIED 徽章 |
| F3 | 澄清流（INTENT_CHOICE 与 SLOT_FILLING 各一） | 选项卡/内联表单正确渲染并回传；round 显示正确 |
| F4 | 探索回答（AGENT_EXPLORATORY + unverifiedNumerics） | 琥珀徽章+虚线边框+警示条同时出现 |
| F5 | 溯源弹窗 | text 角标、kpi 卡、table 角标三处均可打开；四段内容齐全 |
| F6 | SSE 断线重连（mock 中途断开） | 带 Last-Event-ID 重连，事件不重复，最终收到 answer.final |
| F7 | 本体图谱 | 节点按 domain 着色、拖拽缩放、点击出检查器并写入 selectedObjects、图例过滤 dim |
| F8 | 连接器向导 | configSchema 动态表单（含 secret 不回显）；上传文件后字段画像渲染 |
| F9 | 文档审核台 | sourceQuote 高亮对照；EDIT_APPROVE 修改 expression 后提交体正确 |
| F10 | 建模工作台 | PATCH 操作乐观更新与失败回滚；发布校验错误定位到卡片 |
| F11 | workflow 编辑器 | TemplateValue 自动补全只提示前序步骤；环检测错误定位步骤行 |
| F12 | 权限 UI | base_manager 看不到 /admin/permissions 导航；直输 URL 得 403 页 |
| F13 | 合成数据向导 | 六阶段进度推进与校验报告渲染；重跑二次确认文案 |

## 12. 默认约定
pnpm workspace 内 `apps/frontend-shell`；ESLint + typescript-eslint + prettier；提交即跑 lint+test（CI 脚本）。对外不可变更项：路由表（§3）、SessionContext 组装规则（§6.2）、SSE 事件处理（§4.3/QOS-PRD §8.2）、AnswerBlock 渲染契约（§6.5）、信任级视觉（§5）。其余实现自由。
