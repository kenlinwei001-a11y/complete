# PRD · A15 · CLI 通用操作外壳（一切经 CLI：意图识别→模块路由→CLI 交互→触发模块）

| 项 | 值 |
|---|---|
| 版本 | v0.2 · 状态 DRAFT（工业级落地规格已补全，可交付研发） · 日期 2026-06-23 · 波次 Wave 5（新增需求） |
| 取代/扩展 | 扩 `scripts/platform-cli.mjs`（现有 CLI 对话入口）· `PRD-query-orchestration-service.md`（QOS 分类/编排）· `PRD-addendum-capability-routing.md`（能力路由）· 消费 A1（求解器 MCP）/A3（能力发现）/A4（浏览）/A5（FDE 建域）/A10（建域验证） |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§2.H CLI 对话入口/客户端 · §3 编排链 · §5 R3/R4/R8/R13 · §10.3 切片 `sys.orch.query_to_answer`） · `scripts/platform-cli.mjs` · `apps/agentcore/src/router/orchestrator.ts`（classify）· `apps/agentcore/src/tools/registry.ts`（discover）· `apps/datacore/src/app.ts`（模块端点：connectors.upload:1041 · modeling/derive · rules · solvers/invoke） |
| 索引 | `PRD-A-series-roadmap.md` |

> 一句话：把现有"只能 ask 问句"的 CLI 升级为**通用操作外壳**——用户在终端用自然语言（或子命令）即可完成**一切**：数据导入、基于上传数据建模、规则上传、求解器调用/注册……走"**意图识别 → 判断哪个模块能满足 → CLI 内交互补参/确认 → 触发该模块端点完成**"。CLI 与 GUI **平行同源**（同一套 REST、同一套 R3/R4/R6 纪律），不是绕过后端的旁路。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2）：`Query/Intent`（QOS 分类）·`Connection/RawDataset`（导入）·`OntologyDraft/OntologyType`（建模）·`Rule/RuleDoc`（规则）·`Solver`（调用/A1 MCP）·`ActionDraft`（R4 审批，CLI 内批复）·`Scenario`（启动器，CLI 是一等客户端）·`BuildPlan/StoryBuildRun`（A5 建域）·**新增** `OperationIntent`（操作型意图目录，区别于查询型 Intent）。
- **触及链路**（§3）：`CLI 输入 → operationClassify → { 查询型→QOS ask(已有) | 操作型→模块 op } → CLI 交互补参/确认 → 模块 REST(OBO) → 结果/审批 → 下一步建议`。CLI 是切片 `sys.orch.query_to_answer` **与各模块写操作链**的统一客户端。
- **触及事件/数据流**（§4，D-29）：CLI 触发的产出操作（上传/建模/发布/审批）发既有领域事件（`raw_dataset.uploaded`/`ontology.published`/`rules.updated`/`action.executed`…），GUI 端经 F1 全局通道实时反映——**CLI 与 GUI 共享同一事件总线**（一端操作另一端可见）。
- **触及不变量**（§5）：
  - **R8 认证（核心）**：CLI 经 `POST /a/v1/auth/login` 拿 JWT（已有 session 文件），所有调用带 Bearer；服务间不豁免。
  - **R4 真值经 Action**：CLI 触发的本体/对象/规则写入**仍生成 ActionDraft 经审批**；CLI 内 `approve` 批复（已有 cmdApprove）——**CLI 不绕审批**。
  - **R3 entitlement**：操作路由先过功能开通（关闭模块 → CLI 提示 FEATURE_NOT_FOUND，不存在）。
  - **R6 确定性**：操作本身确定（合成/建模/规则求值）；意图分类用 LLM（mock 测试 / 真 Kimi env-gated），**分类不确定不影响被触发操作的确定性**。
  - **R13 可溯源**：CLI 输出的结论数字带溯源（answer + validationTrace 文本化）。
  - **R2** 租户隔离：CLI session 带 tenantId。
  - **R15 CLI 对等（本 PRD 定义）**：本 PRD 即 R15 的来源——确立"每个对外模块能力必须有 CLI 等价命令"为系统不变量 + `cli-parity:check` 门 + PRD 模板必填（见 §10/§11，已回写本体 §5/§7）。
- **关闭/影响断点**（§8）：补 **G-3**（CLI 作为第四个场景/操作启动器入口，与 ⌘K/目录/首页并列）；让"人与 code-agent 共用同一操作面"（CLI 即 agent 可驱动的接口）。
- **门禁**（§7）：跨服务联调冒烟（CLI → 真 DataCore/AgentCore 端到端）· `chain:check`（操作路由命中真实端点）· `ontology:check`（事件锚不漂）· CLI 回归脚本。
- **回写承诺**：回写本体 §2.H（CLI 通用操作外壳 + OperationIntent）· §3（CLI→操作链）· §8（G-3 第四入口）· §10.3（`sys.orch.query_to_answer` 客户端补 CLI 操作面）。

## 1. 目标 / 非目标
### 目标
0. **全模块功能对等（总目标）**：**目前系统每个模块/管理页能做的事，CLI 都能做**——GUI 与 CLI 是同一套后端能力的两个平行外壳，无功能洼地（覆盖矩阵见附录 A，逐行可验收）。
1. **CLI 一站式**：终端内完成 ① 数据导入 ② 基于上传数据建模 ③ 规则上传 ④ 求解器调用/注册 ⑤ 合成数据 ⑥ 建域（FDE）⑦ 场景启动/问答 ⑧ Action 审批 —— 不必进 GUI。
1b. **查询与推演类问答经 CLI**：自然语言 query 经 CLI 走 QOS ask（已有 SSE+多轮澄清），**含推演类问答**——QOS 编排自动路由到推演求解器（`capacity_forecast`/`risk_timeline`/`affected_orders`/`counterfactual_timeline`…）与工作流/Agent，CLI 流式渲染答案 + 溯源 + 待审批草稿。"产能能否按期交付 / 如不解决 XX 未来 30 天 / 哪些订单受影响"等推演问句与 GUI 同源同答。
2. **意图识别 → 模块路由**：自然语言输入 → 判别**查询型**（走 QOS ask，已有）还是**操作型**（导入/建模/规则/求解器/合成/建域…）→ 路由到对应模块处理器；不确定时 `discover` 列候选能力让用户选。
3. **CLI 内交互**：补参（文件路径/类型/参数）、预览（dry-run）、确认（R4 审批），多轮直到完成。
4. **平行同源**：复用 GUI 同一套 REST + R3/R4/R6 + 事件；CLI 操作 GUI 实时可见，反之亦然。
5. **人机共用**：同一 CLI 既给人用，也给 code-agent 用（如自成长工单施工 `claim/grow` 已有范式）。

### 非目标
- 不绕过后端/审批做"本地直写"；CLI 是 REST 客户端。
- 不实现任意**求解器代码上传**（R6/安全约束，见 §9 需确认）——求解器走"调用既有 / 注册需求(FDE scaffold) / DSL 派生"。
- 不替代 GUI；CLI 是平行入口。

## 2. 现状与缺口（file:line）
| 维度 | 现状 | 缺口 |
|---|---|---|
| CLI 基座 | `platform-cli.mjs`：login/ask(SSE+多轮澄清)/scenarios/approve/tickets/claim/grow | 仅 QOS 问答 + 少量；无通用操作路由 |
| 意图分类 | `orchestrator.classify`（查询型 Intent） | 无"操作型意图"分类/目录 |
| 能力发现 | `discover`(slices/solvers/mcp_tools) | 未在 CLI 暴露为"判断哪个模块能满足" |
| 模块端点 | 导入 `connectors.upload:1041` · 建模 `/modeling/derive` · 规则 `/rules`(+dry-run) · 求解器 `/solvers/:key/invoke` · 合成 `/synthetic/jobs` · 建域 `/databuilder/runs` | 无 CLI 子命令 + 交互流封装 |
| 审批 | `cmdApprove`（已有） | 未串进操作流末步 |

## 3. 设计（操作意图路由 + 模块交互流 + 同源复用）
### 3.1 CLI 形态（REPL + 一次性子命令，二者皆可）
- 扩 `scripts/platform-cli.mjs`：
  - **一次性**：`platform import <file>` / `platform model <datasetIds>` / `platform rule "<NL或表达式>"` / `platform solve <key> --args ...` / `platform build "<story>"` / `platform do "<自然语言>"`（万能入口，自动路由）。
  - **REPL**：`platform shell` → 持续对话，每行走 `do` 路由。
### 3.2 操作意图路由 `operationClassify`
- AgentCore 新增轻端点 `POST /b/v1/operations/classify`（或复用 classify 加"操作意图"类）：输入 NL → 输出 `{kind: QUERY|OPERATION, op?: import|model|rule|solver|synth|build|approve|browse, confidence, slots, candidates[]}`。
- **操作意图目录 `OPERATION_CATALOG`**（配置化 R14）：每 op 关键词/示例 + 目标模块端点 + 必填槽位 + 是否 R4。
- 不确定（低置信/多候选）→ CLI 列候选（含 `discover` 的 slices/solvers/mcp_tools）让用户选，**不瞎猜**。
### 3.3 模块交互流（每 op 一个 handler）
- **import**：选/传文件 → `connectors.upload`（或建连接）→ RawDataset 回执（行数/可溯）→ 提示"下一步：model"。
- **model**：对上传 datasets → `POST /a/v1/modeling/derive`（nano-ontoprompt 确定性映射，A6/A3 同源）→ 预览类型/字段/FK/覆盖 → 确认 → 发布(R4 草稿)→ CLI `approve`。
- **rule**：NL → 规则抽取（RuleDoc extraction）或直接表达式 → `POST /a/v1/rules/dry-run` 预览命中 → 确认 → 创建 + `publish`(R4)。
- **solver**：① 调用既有 `solvers/:key/invoke`（args 交互补 / A13 角色解析默认）② 或"注册求解器需求"→ 走 A5 FDE 建域 scaffold（DRAFT，非代码上传）。
- **synth / build**：`synthetic/jobs` / `databuilder/runs`（FDE 节点图状态文本化输出，A5）→ 建完接 A10 自动验证。
### 3.6 CLI→GUI 深链回退（不适合 CLI 内联的操作）
- 某些操作更适合在 GUI 完成（**求解器上传/编排**、复杂可视化建模、大图浏览等）。此时 CLI **不强行内联**，而是**输出一个可点击深链**（终端超链接 OSC 8 / 或打印 URL）→ 跳 GUI 对应页（带上下文参数，如租户/草稿 id）。
- 典型：`solve --new "<NL>"` 或意图判为"新增求解器" → CLI 打印 `🔗 求解器上传：<baseUrl>/admin/solvers/new?ctx=...`（GUI 完成）。
- 这是 R15 CLI 对等的**诚实边界**：CLI 覆盖"能在 CLI 干净完成的"，其余给**一键深链**直达 GUI——既不假装能做、也不让用户自己找页。深链目标页登记进 `OPERATION_CATALOG`（`uiDeepLink` 字段），`cli-parity:check` 认"有 CLI 命令或有深链"为已覆盖。

### 3.4 同源 + 末步
- 全部 OBO 带 JWT；写操作生成 ActionDraft → CLI 内 `approve`（R4）→ 触发事件 → GUI 实时可见。
- 每步末给"下一步建议"（import→model→rule→solve→ask 验证），形成 CLI 内闭环。
### 3.5 人机共用
- 同一子命令人和 code-agent 共用（输出可 `--json` 供 agent 解析）；与自成长 `claim/grow` 同范式。

## 4. 契约 / 端点
- 复用：`auth/login` · `connectors.upload` · `modeling/derive|suggest` · `rules`(+dry-run/publish) · `solvers/:key/invoke` · `synthetic/jobs` · `databuilder/runs` · `action-drafts/:id/approve` · `queries`(ask SSE) · `discover`。
- 新增（AgentCore）：`POST /b/v1/operations/classify`（NL→操作意图，复用 classifier provider）；`OPERATION_CATALOG`（配置）。
- CLI：新增子命令 + `do`/`shell` 路由 + 各 op handler + `--json` 输出。
- 契约：`contracts/operation-intent.ts`（`OperationIntentSchema`/`OperationClassifyOutput`）。

## 5. 关键流程（端到端）
`platform shell` → 输入"把这个 csv 导进来按它建模" → `operationClassify` 判 OPERATION/import+model → CLI：确认文件 → upload(RawDataset 12 行) → derive(预览 ObjectType: Phone/SO/…+FK+覆盖) → 确认 → 发布草稿 → `approve` → `ontology.published` 事件 → 提示"建模完成，下一步可 `rule` 或 `ask`" → 输入"哪个机型产销缺口最大" → 走 QOS ask → 出答案(带溯源)。全程不进 GUI。

## 6. 非功能（§5）
R8（JWT）· R4（写经审批，CLI 内批）· R3（entitlement 路由）· R6（操作确定，分类 LLM mock/真 Kimi env-gated）· R13（溯源文本化）· R2（租户）。

## 7. 验收（DoD）
- `platform do/shell` 能路由并完成 import/model/rule/solve/synth/build/ask/approve 全套；不确定时列候选不瞎猜。
- CLI 写操作经 R4 审批、发事件、GUI 实时可见（跨服务冒烟实测）。
- `--json` 输出供 agent 解析（人机共用）。
- `pnpm -r build && pnpm -r test` 全绿（operations/classify 单测 + CLI 端到端冒烟）；`chain:check`/`ontology:check` 过；agentcore 维持先存 2 失败基线不恶化。
- 回写本体 §2.H/§3/§8/§10.3。

## 8. 分期
- **A15.1** CLI 框架升级（REPL + 子命令 + `--json`）+ `do` 万能路由 + `operationClassify` 端点 + OPERATION_CATALOG。
- **A15.2** 模块交互流：import / model（接 A3/A6 映射）/ rule（dry-run→publish）。
- **A15.3** solver（调用 + A5 注册需求）/ synth / build（FDE 节点文本化 + A10 验证）+ 末步"下一步建议"链。
- **A15.4** 人机共用打磨（agent 驱动 + 自成长 claim/grow 归一）+ 跨服务冒烟回归。

## 9. 已确认（用户裁决 2026-06-21）
1. **意图路由落点 ✅**：采用**服务端轻端点** `POST /b/v1/operations/classify`（分类在 AgentCore、CLI 瘦客户端）——便于真 Kimi、人机共用、与 GUI/QOS 同源。定稿。
2. **"求解器上传"语义 ✅（用户裁决 2026-06-21）**：`solve <key>` **只做调用既有求解器**；**不保留** CLI"求解器需求登记"子命令。"上传/新增求解器"由 CLI **输出一个可点击深链** → 跳转 GUI **求解器上传页**（见 §3.6 CLI→GUI 深链回退），由该页完成（R6/安全：求解器是受治理的代码/规约注册，不在 CLI 内联完成）。

> 基线分支：CLI(scripts) + AgentCore 轻端点为主，冲突小。依赖 A1(求解器调用)/A3(能力发现)/A5(建域)/A10(验证)——可独立先做 import/model/rule 三条，solver/build 随依赖项就绪接入。

## 10. 永续机制：让"未来新功能必须 CLI 打通"不靠自觉（不变量 + 门禁 + 模板）

> 仅靠附录 A 的时点矩阵会随新功能漂移。本节把"CLI 对等"固化为**三件套永续机制**（已回写本体）：

1. **不变量 R15「CLI 对等」**（本体 §5 已新增）：每个对外模块能力**必须有 CLI 等价命令**（注册 `OPERATION_CATALOG`），经同一 REST + R3 + R4 + 事件触发；新模块无 CLI = 功能洼地，返工。GUI-only 须显式声明理由。
2. **门禁 `cli-parity:check`**（本体 §7 已登记，A15 落 `scripts/check-cli-parity.mjs`）：静态校验"模块/操作注册表 ⊆ `OPERATION_CATALOG`/CLI 子命令"——新增对外能力无 CLI 命令即 **CI 红**；棘轮基线 `scripts/cli-parity-baseline.json` 防回潮；`// cli-only` 豁免须注明理由。**与 `debattery:check`/`chain:check` 同款治理范式**。
3. **PRD 模板 §0 强制声明**（`docs/_PRD-TEMPLATE.md` 已加"CLI 打通（R15，强制）"必填行）：今后**每篇 PRD** 在《本体引用与影响》必须声明其 CLI 等价命令或 GUI-only 理由；`prd:check` 解析校验（缺失告警）。
4. **注册即对等**：新模块端点落地时，**同 PR 必须在 `OPERATION_CATALOG` 注册 CLI 命令**（与"新表四处同改 R9"同纪律），否则 `cli-parity:check` 红。

→ 三者叠加：新功能**没法绕过 CLI**（模板逼声明 + 门禁逼实现 + 不变量定纪律），CLI 对等从"自觉"变"强制"。

## 11. 回写本体（已落）
- §5 新增 **R15 CLI 对等**（不变量表）。
- §7 新增 **`cli-parity:check`** 门（待落脚本 A15）。
- `_PRD-TEMPLATE.md` §0 加"CLI 打通（R15，强制）"必填项 + 不变量范围 R1–R15。
- 实现期再回写 §2.H（CLI 通用操作外壳 + OperationIntent）· §3（CLI→操作链）· §8（G-3 第四入口）· §10.3（`sys.orch.query_to_answer` 客户端补 CLI 操作面）。

---

## 附录 A · 全模块 → CLI 覆盖矩阵（对等覆盖验收清单）

> 原则：每个模块/管理页的核心动作都有 CLI 等价命令（复用同一 REST + R3/R4）。`do "<NL>"` 万能路由可命中下表任一；下列为显式子命令。**逐行可勾验**。

| 模块 / 页 | GUI 能力 | CLI 等价命令 | 后端端点（复用） |
|---|---|---|---|
| 业务视图（驾驶舱/产能推演/规划…）| 看板 + 推演问答 | `ask "<query>"` / `shell` | QOS `POST /api/v1/queries`（SSE） |
| 推演（产能/风险/反事实）| 推演问答出答案 | `ask "<推演问句>"`（自动路由推演求解器）| QOS → `capacity_forecast`/`risk_timeline`/`counterfactual_timeline`… |
| 连接器 | 建连接/上传/同步 | `import <file> [--category]` / `conn create\|sync\|ls` | `connectors.upload` / `/connections*`（+A11） |
| 半自动建模 | 数据→本体草稿→发布 | `model <datasetIds>` / `model --publish` | `/modeling/derive\|suggest` + R4 |
| 对象/类型浏览（A4）| 列类型/物化数/下钻实例 | `types [--domain]` / `objects <type>` / `obj <type> <id>` | `/ontology/object-types` · `/objects` · Object360 |
| 规则库 | 建/改/dry-run/发布 | `rule "<NL或表达式>"` / `rule dry-run` / `rule publish <id>` | `/rules*`（+extraction） |
| 求解器 | 调用/参数 | `solve <key> [--args]` / `solvers ls`（discover）；**新增求解器→深链**跳 `/admin/solvers/new`（§3.6）| `/solvers/:key/invoke`（+A1 MCP/A13 角色） |
| 合成数据 | 生成作业 + 报告 | `synth <industry> --scale --seed` | `/synthetic/jobs` |
| 数据构建发动机（FDE）| 故事→建域→闭包 | `build "<story>"`（FDE 节点状态文本流，A5）| `/databuilder/runs`（+A7/A10）|
| 场景入口/启动器 | 场景目录/启动 | `scenarios` / `launch <key>` | `/b/v1/scenarios*`（+launch）|
| Action 审批 | 草稿审批 | `drafts ls` / `approve <id>` | `/action-drafts/:id/approve`（R4）|
| Agent / Skill / Workflow | 配置/绑定/发布 | `agent\|skill\|workflow ls\|show\|publish` | AgentCore `/b/v1/*`（+A1 工具）|
| MCP | 列/治理工具 | `mcp ls` / `discover mcp_tools` | MCP 列举（+A1 求解器 server）|
| 校准 | 提案/应用 | `calib ls` / `calib apply <id>` | 校准端点（R4）|
| 权限/策略 | 行级过滤策略 | `policy ls\|set` | A6 策略端点 |
| 外部信号 | 信号/敏感性 | `signals` / `sensitivity --delta` | `/external-signals*` |
| 隔离区 / 实体合并 | 重入/合并 | `quarantine ls\|reprocess` / `merge <a> <b>` | 隔离/合并端点（R4）|
| 功能开通 | entitlement | `features ls\|toggle <key>` | `/features*`（R3）|
| 自成长 | 工单/施工 | `tickets` / `claim` / `grow`（已有）| `/api/v1/growth/*` |
| 知识库 | 索引/检索 | `kb search "<q>"` / `kb index <file>` | KB 端点 |

> 覆盖纪律：A15 验收即"逐行命令真跑通 + 与 GUI 同源（事件互见）"，由 A12 hand-run 复验。未覆盖项 = CLI 功能洼地，须补齐或在本表标"GUI-only + 原因"。

---

# v0.2 增补 · 工业级落地规格（研发可 1:1 实现，无需再问作者）

> 上文（§0–§11 + 附录 A）确立**为什么/做什么**；本增补给**怎么做到可验收的精度**：把 `OPERATION_CATALOG`、契约、`operationClassify`、`cli-parity:check` 从"命名"补成"机器可落地的定稿"。所有锚点已核对真实代码（DataCore `app.ts` 226 路由 / AgentCore `server.ts` 111 路由 / `features.ts` entitlement 键 / `scripts/check-*.mjs` 门禁范式）。

## 附录 B · `OPERATION_CATALOG` 定稿（机器可读 · 单一来源）

落点 `apps/agentcore/src/operations/catalog.ts`（B 栈，与 `operationClassify` 同模块）。每条 = 一个**对外操作能力**到**REST 调用 + CLI 交互**的完整声明。

### B.1 条目结构（契约见附录 C）
```
OperationCatalogEntry {
  opKey: string            // 稳定主键，如 "import" "model" "rule.publish"
  kind: "QUERY" | "OPERATION"
  cli: string              // CLI 子命令模板，如 "import <file> [--category]"
  nl: { keywords: string[]; examples: string[] }   // operationClassify 关键词/示例（确定性预匹配 + LLM few-shot）
  service: "A" | "B"       // DataCore / AgentCore
  method: "GET"|"POST"|"PUT"|"DELETE"
  path: string             // 端点模板（带 :param），如 "/a/v1/connectors/upload"
  slots: Slot[]            // 必填/选填参数（见 B.2）
  r4: boolean              // 写真值是否经 Action 审批（true=产 ActionDraft，CLI 内 approve）
  entitlement: string|null // features.ts 的 feature 键；关闭→404 FEATURE_NOT_FOUND（R3 先于 authz）
  dryRun: string|null      // 预览端点（如 rule 的 /rules/dry-run），无则 null
  uiDeepLink: string|null  // 不宜 CLI 内联者的 GUI 深链模板（§3.6），与 path 二选一即算覆盖
  json: string             // --json 输出形状名（附录 D 的 envelope.data 子型）
  next: string[]           // 完成后"下一步建议"的 opKey 列表
  emits: string[]          // 触发的领域事件（§4），用于跨服务冒烟断言 GUI 互见
}
Slot { name; type:"file"|"string"|"string[]"|"enum"|"number"|"bool"; required:bool;
       source:"arg"|"flag"|"prompt"|"discover"; prompt?:string; enum?:string[] }
```

### B.2 全量条目（与附录 A 逐行对应 · 22 op · dev 照此填 `catalog.ts`）

| opKey | cli | service·method·path | slots(必填) | r4 | entitlement | dryRun | uiDeepLink | emits |
|---|---|---|---|---|---|---|---|---|
| `ask` | `ask "<q>"` | B·POST·/api/v1/queries | q:string | – | shell.query-dock | – | – | （只读，task.*） |
| `import` | `import <file> [--category]` | A·POST·/a/v1/connectors/upload | file:file, category?:enum(discover) | – | – | – | – | raw_dataset.uploaded |
| `conn.create` | `conn create <type>` | A·POST·/a/v1/connections | type:enum | ✓ | – | – | – | connection.sync_completed |
| `conn.sync` | `conn sync <id>` | A·POST·/a/v1/connections/:id/sync | id:string | – | – | – | – | connection.sync_completed |
| `conn.ls` | `conn ls` | A·GET·/a/v1/connections | – | – | – | – | – | – |
| `model` | `model <datasetIds> [--publish]` | A·POST·/a/v1/modeling/derive | datasetIds:string[] | ✓ | view.ontology-graph | /a/v1/modeling/suggest | – | ontology.published |
| `types` | `types [--domain]` | A·GET·/a/v1/ontology/object-types | – | – | – | – | – | – |
| `objects` | `objects <type>` | A·GET·/a/v1/objects?type= | type:string | – | – | – | – | – |
| `obj` | `obj <type> <id>` | A·GET·/a/v1/objects/:type/:id | type,id:string | – | – | – | – | – |
| `rule` | `rule "<NL或表达式>"` | A·POST·/a/v1/rules | expr:string | ✓ | view.rule-library | /a/v1/rules/dry-run | – | rules.updated |
| `rule.publish` | `rule publish <id>` | A·POST·/a/v1/rules/:id/publish | id:string | ✓ | view.rule-library | – | – | rules.updated |
| `solve` | `solve <key> [--args j]` | A·POST·/a/v1/solvers/:key/invoke | key:enum(discover), args?:string | – | （随 solver） | – | – | – |
| `solve.new` | `solve --new "<NL>"` | – | nl:string | – | – | – | /admin/solvers/new?ctx= | – |
| `synth` | `synth <industry> [--scale --seed]` | A·POST·/a/v1/synthetic/jobs | industry:enum, scale?:enum, seed?:number | – | – | – | – | dataset.regenerated |
| `build` | `build "<story>"` | A·POST·/a/v1/databuilder/runs | story:string | ✓ | – | – | – | storybuild.run_recorded |
| `scenarios` | `scenarios` | B·GET·/b/v1/scenarios | – | – | – | – | – | – |
| `launch` | `launch <key>` | B·POST·/b/v1/scenarios/:key/launch | key:string | – | – | – | – | task.* |
| `drafts` | `drafts ls` | A·GET·/a/v1/action-drafts?status=PENDING | – | – | – | – | – | – |
| `approve` | `approve <id>` | A·POST·/a/v1/action-drafts/:id/approve | id:string | ✓(本身即批) | – | – | – | action.executed |
| `agent` / `skill` / `workflow` | `<m> ls\|show <id>\|publish <id>` | B·GET/POST·/b/v1/{agents,skills,workflows}* | m:enum, id?:string | ✓(publish) | – | – | – | {agent,workflow}.published |
| `mcp` | `mcp ls` | B·GET·/b/v1/mcp/tools | – | – | – | – | – | – |
| `calib` | `calib ls\|apply <id>` | A·GET/POST·/a/v1/calibration* | id?:string | ✓(apply) | – | – | – | calibration.applied |
| `policy` | `policy ls\|set <j>` | A·GET/PUT·/a/v1/policies | j?:string | ✓(set) | – | – | – | policy.updated |
| `signals` | `signals` / `sensitivity --delta j` | A·GET/POST·/a/v1/external-signals[/sensitivity] | delta?:string | – | – | – | – | – |
| `quarantine` | `quarantine ls\|reprocess <id>` | A·GET/POST·/a/v1/quarantine* | id?:string | ✓(reprocess) | – | – | – | quarantine.row_added |
| `merge` | `merge <a> <b>` | A·POST·/a/v1/objects/merge | a,b:string | ✓ | – | /a/v1/objects/merge/preview | – | objects.merged |
| `features` | `features ls\|toggle <key>` | A·GET/PUT·/a/v1/features | key?:string | ✓(toggle, admin) | – | – | – | features.updated |
| `tickets`/`claim`/`grow` | （已有）| B·/api/v1/growth/* | – | – | – | – | – | growth.* |
| `kb` | `kb search "<q>"` / `kb index <file>` | A·POST/GET·/a/v1/kb* | q\|file | ✓(index) | view.review | – | – | kb.indexed |

> **裁决项（dev 落地前确认，标注以守诚实）**：① `policy.set`/`features.toggle`/`merge`/`agent.publish` 的精确端点路径需以实现期 `app.ts` 为准（上表 path 为 as-designed，可能与真实命名差一截——`cli-parity:check` 反向校验会暴露 dangling，按真实路径修表）；② `solve` 的 entitlement 随具体 solver 的 feature 键（如 `capacity_forecast`），运行期解析非静态；③ `kb` entitlement 暂挂 `view.review`，若 KB 独立 feature 键则改。

## 附录 C · `contracts/operation-intent.ts` 契约定稿（zod，dev 直接落）

```ts
import { z } from "zod";
export const OperationKind = z.enum(["QUERY", "OPERATION"]);
export const SlotType = z.enum(["file","string","string[]","enum","number","bool"]);
export const SlotSchema = z.object({
  name: z.string(), type: SlotType, required: z.boolean(),
  source: z.enum(["arg","flag","prompt","discover"]),
  prompt: z.string().optional(), enum: z.array(z.string()).optional(),
});
export const OperationCatalogEntrySchema = z.object({
  opKey: z.string(), kind: OperationKind, cli: z.string(),
  nl: z.object({ keywords: z.array(z.string()), examples: z.array(z.string()) }),
  service: z.enum(["A","B"]), method: z.enum(["GET","POST","PUT","DELETE"]),
  path: z.string(), slots: z.array(SlotSchema),
  r4: z.boolean(), entitlement: z.string().nullable(),
  dryRun: z.string().nullable(), uiDeepLink: z.string().nullable(),
  json: z.string(), next: z.array(z.string()), emits: z.array(z.string()),
});
export type OperationCatalogEntry = z.infer<typeof OperationCatalogEntrySchema>;

export const OperationClassifyInput = z.object({
  text: z.string().min(1), packageId: z.string().optional(), view: z.string().optional(),
});
export const OperationClassifyOutput = z.object({
  kind: OperationKind,
  opKey: z.string().nullable(),          // 命中的操作；QUERY 时 null（交回 ask）
  confidence: z.number().min(0).max(1),
  slots: z.record(z.string(), z.unknown()),   // 已抽到的槽位
  missing: z.array(z.string()),          // 仍缺的必填槽位 name（CLI prompt 补）
  candidates: z.array(z.object({ opKey: z.string(), label: z.string(), score: z.number() })),
  decision: z.enum(["AUTO","CONFIRM","DISAMBIGUATE","FALLBACK_QUERY"]),
});
```
> `OperationIntent` 一等对象（本体 §2.H 提案）= 持久化的 `OperationCatalogEntry` 投影；MVP 阶段 catalog 为代码内常量（R6 确定性），P2 再落库使其可被 dogfooding 切片。

## 附录 D · `operationClassify` 算法 + 阈值 + 永不瞎猜回退

端点 `POST /b/v1/operations/classify`（裁决①已定，§9）。**两段式 = 确定性预匹配优先，LLM 兜底**：

1. **确定性关键词预匹配（R6）**：对 `OPERATION_CATALOG[*].nl.keywords` 做归一化包含匹配，命中唯一 → `decision=AUTO`，`confidence=1.0`，不调 LLM。
2. **LLM 分类（仅预匹配未命中/多命中时）**：用 `classifier` 用途绑定的 provider（§5 R6：测试 mock / 真 Kimi env-gated），few-shot = catalog 的 `nl.examples` → 返 `{kind, opKey, confidence, slots}`。
3. **阈值与决策**（硬编码常量，可配）：
   - `confidence ≥ 0.75` → `AUTO`（直接进 handler，缺槽位走 prompt 补）。
   - `0.40 ≤ confidence < 0.75` → `CONFIRM`（CLI 打印"将执行 <op>，确认？[y/N]"）。
   - `< 0.40` 或 `candidates ≥ 2 且分差 < 0.15` → `DISAMBIGUATE`（列候选 + `discover`(slices/solvers/mcp_tools) 让用户选，**绝不瞎猜**，对齐 §3.2）。
   - `kind=QUERY` → `FALLBACK_QUERY`（交回既有 `ask` SSE 管线）。
4. **槽位抽取**：从 NL 抽 catalog 声明的 slots；`source=file` 校验路径存在、`source=enum` 经 `discover` 解析候选；缺必填 → 入 `missing`，CLI 逐个 prompt。
5. **诚实边界**：分类用 LLM **不影响被触发操作的确定性**（操作本身确定 R6）；分类错只会"问错模块"，由 CONFIRM/DISAMBIGUATE 兜住，不会静默误执行写操作。

## 附录 E · `cli-parity:check` 门禁算法定稿（R15 永续机制的命门）

落点 `scripts/check-cli-parity.mjs` + 基线 `scripts/cli-parity-baseline.json`（范式同 `check-debattery.mjs`/`debattery-baseline.json`，已核对存在）。**这是"100% 对等"唯一可机器验证的支点——没有它，附录 A 只是会漂的时点快照。**

### E.1 枚举"对外模块能力"的单一来源（关键）
- **路由宇宙 `ROUTE_UNIVERSE`** = 正则扫描 `apps/datacore/src/app.ts`（226 条）+ `apps/agentcore/src/server.ts`（111 条）的 `app.<method>("<path>"` 声明（已验证可枚举），归一为 `METHOD path`。
- **排除集（非对外能力，不计入对等）**：`/healthz`/`/readyz`/`/metrics`、`*/internal/*`（SERVICE_TOKEN 服务间，如 scaffold/invalidate）、`auth/refresh|logout`（会话机制非模块能力）、纯 SSE 子流。排除规则写进脚本常量 `PARITY_EXEMPT_PREFIXES`，每条带注释理由。
- **覆盖集 `COVERED`** = `OPERATION_CATALOG[*].{method,path}` ∪ `uiDeepLink` 覆盖项 ∪ 路由文件行内 `// cli-only: <理由>` 显式豁免。

### E.2 双向校验
- **正向（漏命令即红）**：`ROUTE_UNIVERSE \ EXEMPT \ COVERED ≠ ∅` → 列出"有端点无 CLI 命令"的对外能力 → **CI 红**（除非在 `cli-parity-baseline.json` 棘轮基线内；新增能力一律不得进基线，只能补 catalog）。
- **反向（dangling 即红）**：`OPERATION_CATALOG[*].path \ ROUTE_UNIVERSE ≠ ∅` → catalog 引用了不存在的端点（路径写错/已删）→ 红。**这条直接帮 dev 修正附录 B.2 的 as-designed 路径裁决项。**

### E.3 输出与退出
- 报告：`✓/✗ CLI 对等：覆盖 N/M 对外端点；未覆盖 K（基线 J）；dangling D`，逐条 `METHOD path → 缺 CLI 命令 / 建议 opKey`。
- 退出码：全覆盖（或未超基线且无 dangling）→ 0；否则 1。
- 棘轮：基线只减不增（同 debattery）；CI 跑 `pnpm cli-parity:check`，并入 `pnpm gates`。

### E.4 "注册即对等"PR 纪律（R15 §10.4 落地）
新模块端点落地的同一 PR 必须在 `catalog.ts` 注册条目（或 `// cli-only` 声明理由），否则 `cli-parity:check` 红——与"新表四处同改 R9"同款强制。

## 附录 F · CLI 命令面定稿（dispatch / flags / --json / 退出码）

扩 `scripts/platform-cli.mjs`（现 8 命令 → 全 catalog）。

- **全局 flag**：`--json`（机读 envelope，人机共用）· `--yes`（跳过非破坏性确认）· `--view <v>` · `--package <p>` · `--base <url>`。
- **分发**：`do "<NL>"`（万能 → `operationClassify` 路由）· `shell`（REPL，每行走 `do`）· 显式子命令（附录 B.2 `cli` 列）直达对应 handler，跳过分类。
- **`--json` 输出 envelope**（与错误信封 R7 对齐）：
  ```
  { ok:true, op, data:<json型>, draftId?, deepLink?, next:[...], events:[...] }
  | { ok:false, error:{ code, message, requestId }, decision?, candidates? }
  ```
- **退出码**：`0` 成功 · `1` 错误（含 REST 4xx/5xx，error.code 透传）· `2` 需确认被中止（CONFIRM 拒绝/DISAMBIGUATE 未选）· `3` 鉴权/entitlement（401/403/404 FEATURE_NOT_FOUND）。
- **错误映射**：REST `{error:{code,message,requestId}}` → CLI stderr 红字 + 对应退出码；`FEATURE_NOT_FOUND` → 提示"模块未开通（features toggle）"。
- **R4 写操作末步**：handler 产 `draftId` → 非 `--yes` 则提示 `approve <draftId>`；`--yes` 且操作声明 `r4` → 自动接 `approve`（仍走真审批端点，非绕过）。

## 附录 G · 行级验收矩阵（DoD 可勾验 · A12 hand-run 复验）

| 验收项 | 通过判据 |
|---|---|
| 枚举完整 | `cli-parity:check` 报告覆盖率 = 对外端点 100%（或全部未覆盖项有 `// cli-only` 理由）；dangling = 0 |
| 分类不瞎猜 | 低置信/多候选输入 → CLI 列候选不执行；CONFIRM 拒绝 → 退出码 2 |
| 写经审批 | `import→model→approve` 后 `action.executed` 事件发出，GUI 端 `useDomainEventStream` 实时刷新（跨服务冒烟实测） |
| 同源互见 | CLI `rule publish` 与 GUI 规则库同改、事件互见（双向） |
| 人机共用 | 每命令 `--json` 输出符合附录 F envelope，code-agent 可解析驱动 |
| 深链回退 | `solve --new` 输出 `/admin/solvers/new` 可点击深链，`cli-parity:check` 认其覆盖 |
| 确定性 | `operationClassify` 关键词预匹配段不调网络；LLM 段测试全 mock；`pnpm -r test` 绿 |
| 门禁并入 | `pnpm gates` 含 `cli-parity:check`；新增端点不注册 catalog → CI 红（注入用例验证） |

## v0.2 增补 · 本体回写增量

本增补**不新增**链路/事件/不变量/断点——R15 与 `cli-parity:check` 已于 v0.1 回写本体 §5/§7。增补仅把它们**精化为可落地算法**，故：

- **无需改 `SYSTEM-ONTOLOGY.md`**（R15 文案、`cli-parity:check` 登记、`OperationIntent` 提案项均已在册）。
- 实现期落地时按 §11 承诺回写 §2.H（OperationIntent 由提案转一等）· §3（CLI→操作链具体化）· §8（G-3 第四入口）· §10.3（切片补 CLI 操作面）——届时 `OPERATION_CATALOG` 真实路径以 `app.ts` 为准订正附录 B.2 裁决项。
