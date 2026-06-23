# PRD · A15 · CLI 通用操作外壳（一切经 CLI：意图识别→模块路由→CLI 交互→触发模块）

| 项 | 值 |
|---|---|
| 版本 | v0.2.1 · 状态 DRAFT（落地规格已对齐 vigilant-knuth as-built 实现） · 日期 2026-06-23 · 波次 Wave 5（新增需求） |
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

# v0.2 增补 · 工业级落地规格（**已对齐 vigilant-knuth as-built 实现**）

> 上文（§0–§11 + 附录 A）确立**为什么/做什么**；本增补给**怎么做到可验收的精度**。
>
> **⚠ 对齐说明（2026-06-23）**：dev 已在 `claude/vigilant-knuth-b1nmxn` 落地本特性的契约 + 分类 + 门禁。本增补**以 as-built 代码为单一真相源**订正——契约落 `packages/contracts/src/operation-intent.ts`（非 `apps/agentcore/src/operations/`）；字段为 `op/label/keywords/endpoint/requiredSlots/r4/cliCommand/uiDeepLink`（未实现我早先设计的 `service/method/dryRun/json/next/emits` 富字段）；分类为**纯关键词确定性打分、无 LLM**（非早先的两段式 LLM）；op 粒度收敛为 **18 个**（早先 22 行细分已合并，新增 `bootstrap`）。下文附录 B/C/D **逐字对应 as-built**；附录 E 标注门禁的 as-built 范围与未实现增强。

## 附录 B · `OPERATION_CATALOG` 定稿（as-built · `packages/contracts/src/operation-intent.ts`）

每条 = 一个**对外操作能力**到 **CLI 命令 / GUI 深链**的注册（R15 对等真值源）。条目结构（as-built）：

```
OperationCatalogEntry {
  op: OperationKind        // 18 枚举之一（稳定主键）
  label: string            // GUI 能力一句话（= 附录 A 覆盖矩阵行）
  keywords: string[]       // 确定性分类关键词（命中即候选，多命中按命中数排序）
  endpoint: string         // 复用的后端端点（信息性；CLI/GUI 同源调用）
  requiredSlots: string[]  // 必填槽位（CLI 内交互补参），默认 []
  r4: boolean              // 是否经 R4 审批（写真值），默认 false
  cliCommand?: string      // CLI 等价命令（与 uiDeepLink 至少其一）
  uiDeepLink?: string      // 不宜 CLI 内联时的 GUI 深链（§3.6 诚实边界）
}
OperationKind = import|model|browse|rule|solve|synth|build|scenario|approve
              | agent|calibration|policy|signal|quarantine|features|growth|kb|bootstrap
```

### B.2 全量条目（18 op · as-built 逐条，与附录 A 收敛对应）

| op | label | endpoint | requiredSlots | r4 | cliCommand | uiDeepLink |
|---|---|---|---|---|---|---|
| `import` | 连接器·建连接/上传/同步 | `/a/v1/connectors/upload` | file | – | `import` | – |
| `model` | 半自动建模·数据→本体草稿→发布 | `/a/v1/modeling/derive` | datasetIds | ✓ | `model` | – |
| `browse` | 对象/类型浏览（A4） | `/a/v1/ontology/object-types/stats` | – | – | `types` | – |
| `rule` | 规则库·建/dry-run/发布 | `/a/v1/rules` | expression | ✓ | `rule` | – |
| `solve` | 求解器·调用既有 | `/a/v1/solvers` | solverKey | – | `solve` | `/admin/solvers/new` |
| `synth` | 合成数据·生成作业 | `/a/v1/synthetic/jobs` | industry | – | `synth` | – |
| `build` | 数据构建发动机（FDE）·故事建域 | `/a/v1/databuilder/runs` | script | – | `build` | – |
| `scenario` | 场景入口/启动器 | `/b/v1/scenarios` | – | – | `scenarios` | – |
| `approve` | Action 审批 | `/a/v1/action-drafts` | draftId | ✓ | `approve` | – |
| `agent` | Agent/Skill/Workflow 配置 | `/b/v1/agents` | – | – | `agent` | – |
| `calibration` | 校准·提案/应用 | `/a/v1/calibration` | – | ✓ | `calib` | – |
| `policy` | 权限/策略·行级过滤 | `/a/v1/policies` | – | – | `policy` | – |
| `signal` | 外部信号·敏感性 | `/a/v1/external-signals` | – | – | `signals` | – |
| `quarantine` | 隔离区/实体合并 | `/a/v1/quarantine` | – | ✓ | `quarantine` | – |
| `features` | 功能开通·entitlement | `/a/v1/features` | – | – | `features` | – |
| `growth` | 自成长·工单/施工 | `/api/v1/growth` | – | – | `tickets` | – |
| `kb` | 知识库·索引/检索 | `/a/v1/kb` | – | – | `kb` | – |
| `bootstrap` | 空租户冷启动引导·计划域 seed→SopVersion 定稿 | `/a/v1/bootstrap` | – | ✓ | `bootstrap` | – |

> 说明（as-built 与早先设计的差异）：① `endpoint` 为**信息性单值**（不拆 service/method），CLI handler 内部决定具体 method/子路径（如 rule 的 dry-run/publish、quarantine 的 reprocess/merge 都在 `rule`/`quarantine` 一条下交互分支）；② `solve` 同时带 `uiDeepLink:/admin/solvers/new`——调用既有走 CLI、新增求解器走深链（§3.6 诚实边界）；③ 早先的 `ask/launch/drafts/mcp` 未单列为操作 op（`ask` 是 QUERY 分支非操作；`launch`/`drafts` 并入 `scenario`/`approve` handler 交互；`mcp` 经 `agent`/discover）。

## 附录 C · `contracts/operation-intent.ts` 契约（as-built 全文）

```ts
export const OPERATION_KINDS = [
  "import","model","browse","rule","solve","synth","build","scenario","approve",
  "agent","calibration","policy","signal","quarantine","features","growth","kb","bootstrap",
] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

export const OperationCatalogEntrySchema = z.object({
  op: z.enum(OPERATION_KINDS),
  label: z.string(),
  keywords: z.array(z.string()),
  endpoint: z.string(),
  requiredSlots: z.array(z.string()).default([]),
  r4: z.boolean().default(false),
  cliCommand: z.string().optional(),
  uiDeepLink: z.string().optional(),
});

export const OperationClassifyKindSchema = z.enum(["QUERY", "OPERATION"]);
export const OperationCandidateSchema = z.object({ op: z.enum(OPERATION_KINDS), score: z.number(), label: z.string() });
export const OperationClassifyOutputSchema = z.object({
  kind: OperationClassifyKindSchema,
  op: z.enum(OPERATION_KINDS).optional(),
  confidence: z.number(),
  endpoint: z.string().optional(),
  r4: z.boolean().optional(),
  requiredSlots: z.array(z.string()).default([]),
  cliCommand: z.string().optional(),
  uiDeepLink: z.string().optional(),
  candidates: z.array(OperationCandidateSchema).default([]),
});
export const OperationClassifyRequestSchema = z.object({ input: z.string().min(1) });
```
> `OperationIntent` 一等对象（本体 §2.H 提案）= 持久化的 `OperationCatalogEntry` 投影；as-built 阶段 `OPERATION_CATALOG` 为**契约包内代码常量**（R6 确定性），P2 再落库使其可被 dogfooding 切片。

## 附录 D · `classifyOperation` 算法（as-built · **纯关键词确定性 · 无 LLM**）

as-built 选了**纯确定性关键词打分**（非早先的两段式 LLM）——更简单、完全确定（R6），分类不确定不影响被触发操作的确定性。算法（`operation-intent.ts classifyOperation`，纯函数）：

1. 输入归一小写；对 `OPERATION_CATALOG[*].keywords` 逐条计**命中数**（包含匹配），保留 `score>0` 者。
2. 按 `score` 降序、并列时按 catalog 顺序稳定排序。
3. **无命中 → `{kind:"QUERY", confidence:1}`**（交回 QOS `ask`）。
4. **有命中 → `{kind:"OPERATION", op:top, ...}`**，置信度：
   - 多 op 并列最高分（`tiedTop>1`）→ `confidence=0.5`（低，CLI 列 `candidates` 让用户选，**不瞎猜**）；
   - 独占最高 → `confidence = min(1, top.score/totalHits + 0.3)`。
5. 输出携 `endpoint/r4/requiredSlots/cliCommand/uiDeepLink/candidates`，CLI 据此交互补参 + R4 末步。
6. 端点 `POST /b/v1/operations/classify`（请求 `{input}`，§9 裁决①）。测试 `apps/agentcore/test/a15-operation-classify.test.ts`。

> 与早先设计的差异（诚实记录）：早先附录 D 写两段式（确定性预匹配→LLM 兜底）+ 阈值 0.75/0.40 + `decision` 四态枚举；**as-built 未采用 LLM 段、无 `decision/missing` 字段**，仅以 `confidence` + `candidates` 表达"高置信直执行 / 并列低置信列候选 / 无命中走 QUERY"。本附录已改写为 as-built 真实逻辑。

## 附录 E · `cli-parity:check` 门禁（as-built 范围 + 未实现增强）

落点 `scripts/check-cli-parity.mjs`（66 行，**已实现**）+ 基线 `scripts/cli-parity-baseline.json`（`{"missingImpl":[]}`），已并入 `pnpm gates`。

### E.1 as-built 校验（dev 已落，三步）
1. **catalog 自洽**：`OPERATION_CATALOG` 每条都有 `cliCommand` 或 `uiDeepLink`（R15 对等的诚实边界），否则红。
2. **CLI 可达**：每个 `cliCommand` 在 `scripts/platform-cli.mjs` 的 `run{}` 调度表命中，**或** `do` 万能路由存在（`cmdDo`/`operations/classify`）即视为可经分类可达；纯深链项不要求 `run{}` 实现。
3. **棘轮基线**：`cli-parity-baseline.json.missingImpl` 记已知缺实现存量，缺实现数 ≤ 基线才绿（`--update` 重刷）；范式同 `debattery:check`。

### E.2 已知局限（as-built 未含 · 非本次工单）
- **当前门校验"catalog 自洽 + 命令可达"，不枚举路由宇宙**（不扫 `app.ts`/`server.ts` 反向 diff catalog）。后果：若某对外端点**根本没进 `OPERATION_CATALOG`**，本门发现不了——即"对等覆盖率"未被机器证明，门可在 catalog 不完整时绿（**绿测试≠能用**）。
- 这是一个**可选增强方向**（反向路由枚举：`ROUTE_UNIVERSE \ EXEMPT \ COVERED ≠ ∅ → 红`），**未在本轮实现、不作为本 PRD 强制要求**；如要把"100% 对等"做成机器可证，由 dev 评估后另行决定。本节如实标注，避免文档高于实现。

## 附录 F · CLI 命令面（as-designed · 待 dev 落地处以 as-built 为准）

扩 `scripts/platform-cli.mjs`（现 `login/ask/scenarios/approve/whoami/tickets/claim/grow` 8 命令 → 全 catalog 的 `cliCommand`）。

- **分发**：`do "<NL>"`（万能 → `classifyOperation`/`operations/classify` 路由）· `shell`（REPL）· 显式子命令（附录 B.2 `cliCommand` 列）直达 handler。
- **R4 末步**：`r4:true` 的 op（model/rule/approve/calibration/quarantine/bootstrap）产 `draftId` → 提示 `approve <draftId>`（CLI 内批，不绕审批）。
- **同源**：全部 OBO 带 JWT；写操作发既有领域事件（§4）→ GUI 经 F1 全局通道实时可见。
- `--json` 输出供 code-agent 解析（人机共用，与自成长 `claim/grow` 同范式）。

> 退出码/`--json` envelope 等细节为 as-designed 实施建议；以 dev 实现期 `platform-cli.mjs` 为准（`cli-parity:check` 的"CLI 可达"会守住命令存在性）。

## 附录 G · 行级验收矩阵（DoD · A12 hand-run 复验）

| 验收项 | 通过判据 |
|---|---|
| catalog 对等 | `cli-parity:check` 绿：每条有 `cliCommand`/`uiDeepLink`，命令在 CLI 可达；缺实现 ≤ 基线 |
| 分类不瞎猜 | 多 op 并列命中（`tiedTop>1`）→ `confidence=0.5` 列 `candidates`，不直执行；无命中 → QUERY 走 ask |
| 确定性 | `classifyOperation` 纯关键词、不调网络；`a15-operation-classify.test.ts` 绿；`pnpm -r test` 绿 |
| 写经审批 | `import→model→approve` 后 `action.executed` 事件发出，GUI `useDomainEventStream` 实时刷新（跨服务冒烟） |
| 同源互见 | CLI `rule` 发布与 GUI 规则库同改、事件互见（双向） |
| 深链回退 | `solve`（新增求解器）输出 `/admin/solvers/new` 深链，`cli-parity:check` 认其覆盖 |
| 门禁并入 | `pnpm gates` 含 `cli-parity:check`（as-built 已并入） |

## v0.2 增补 · 本体回写增量

本增补**不新增**链路/事件/不变量/断点——R15 与 `cli-parity:check` 已于 v0.1 回写本体 §5/§7；as-built 已落 `cli-parity:check` 脚本 + `ontogenesis:check` + `boundary-singlesource:check`（vigilant），故：

- **无需改 `SYSTEM-ONTOLOGY.md`**（R15 文案、`cli-parity:check` 登记、`OperationIntent` 提案项均已在册）；惟本体 §5/§7 标 `cli-parity:check` 为"⏳ 待落"已与 as-built **不符**——dev 分支已实现，下次同步本体时应将其状态从"⏳ 待落"更新为"✅ 已落（catalog 自洽版，路由枚举增强未含）"。
- 实现期落地时按 §11 承诺回写 §2.H（OperationIntent 由提案转一等）· §3（CLI→操作链具体化）· §8（G-3 第四入口）· §10.3（切片补 CLI 操作面）。
