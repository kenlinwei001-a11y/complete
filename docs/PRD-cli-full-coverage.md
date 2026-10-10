# PRD — CLI 能力全覆盖（操作目录自动派生 `deriveOperationCatalog` + 覆盖门 `cli-coverage:check`）

> 版本 v1.0 · 状态 DRAFT · 落地分支 `claude/vigilant-knuth-b1nmxn` · **增量**（CLI/A15/R15 已在，补"全覆盖 + 构造上不回潮"）。
> 目标读者：本仓实现 agent。先读：根 `CLAUDE.md`、`docs/SYSTEM-ONTOLOGY.md`（本 PRD grounded 于 v1.0）。
> 一句话：CLI（`scripts/platform-cli.mjs` 18 命令 + `do` 万能 NL + `shell` REPL）+ **R15「CLI 对等」** + `cli-parity:check` 门**已在**；但 `OPERATION_CATALOG` 是**手维护、域级**（~18 op），**约 10 个能力区无 CLI op**，且新能力忘登记门照绿（catalog rot）。本 PRD = 把操作目录**从能力注册表自动派生** + 加**注册表↔目录覆盖门**，使"每个功能 CLI 可达"且**构造上不回潮**（落实 **R16 能力环**）。**不重建 CLI。**

---

## 本体引用与影响（铁律0 · `prd:check` 强制）

- **触及不变量**：**R15**（CLI 对等——主，每对外能力必须有 CLI 命令或 `uiDeepLink`）· **R16**（发育闭环·**能力环 = 目录从注册表自动派生 `deriveOperationCatalog`/`FEATURE_REGISTRY`/`SOLVER_CATALOG`，非手维护**——本 PRD 是其落地）· **R6**（确定性派生，同注册表同目录字节一致）· **R3**（entitlement 先于 authz——CLI op 同受 feature 门）· **R2**（租户隔离）· **R7**（错误信封统一）。
- **触及断点**：**G-7**（LLM 用途枚举写死不可扩展——LLM provider/binding 正是"无 CLI op"缺区之一，本 PRD 顺带把它纳入覆盖）。
- **触及对象类型（§2）**：`OperationCatalogEntry`/`OPERATION_CATALOG`/`classifyOperation`（§116，`contracts/operation-intent.ts`）· `SOLVER_KEYS`（§88，`solvers/service.ts:14`，32 个）· `FEATURE_REGISTRY`（`apps/agentcore/src/features/registry.ts`，VIEW/BLOCK/ACTION 级）· `Scenario`/`SceneEntry`（§118/§119，views 经 `ask`/`scenarios` 可达）。
- **触及链路（§3）**：`CLI → POST /b/v1/operations/classify → {QUERY:ask / OPERATION:模块}`（§116 通用操作外壳）。
- **触及门禁（§7）**：扩 `cli-parity:check`（现验"目录↔CLI"）→ **新增 `cli-coverage:check`**（验"注册表↔目录"）。
- **触及域（§10）**：D7 编排（CLI 客户端）· D11 治理元（R16 能力环自动派生）。
- **回写承诺**：实现后回写本体 **§5 R16**（能力环自动派生落地）+ **§7**（新门）+ **§2.H A15**（目录改为自动派生）。

---

## 0. 现状（grounded audit，实测 file:line）

- **CLI 入口**：`scripts/platform-cli.mjs`（336 行，run 表 :328）—— 18 命令 `login·ask·do·shell·import·model·rule·solve·synth·build·generate·types·scenarios·approve·whoami·tickets·claim·grow`；**`do`** = NL 万能（:289 → `/b/v1/operations/classify`）；**`shell`** = 交互 REPL（:277）。
- **操作目录**：`OPERATION_CATALOG`（`contracts/operation-intent.ts:44`）≈18 op（import/model/browse/rule/solve/synth/build/scenario/approve/agent/calibration/policy/signal/quarantine/features/growth/kb/bootstrap）；分类器 `classifyOperation`（:96，确定性 R6）。
- **门**：`cli-parity:check`（`scripts/check-cli-parity.mjs`）现绿——`cli-parity-baseline.json` = `{"missingImpl": []}`。
- **覆盖现状**：views 全经 `ask`/`scenarios` 可达；32 求解器经 `solve <key>` 可达；~18 操作域有子命令。
- **缺口（真）**：
  | 类型 | 说明 |
  |---|---|
  | **~10 能力区无 op** | 时序/聚合(A8)·模拟时钟 tick(A8)·**LLM provider/binding(G-7)**·config-bundle 迁移(OC3)·evals·meta-ontology/影响分析·slices/slice-planner·lineage 溯源·OC 平台配置(prompt/budget/calendar/writeback)·replay/ops-schedule —— `OPERATION_CATALOG` 无对应条目 |
  | **目录手维护 → rot** | 目录是显式数组；`cli-parity:check` 只验"**目录↔CLI**"，**不验"注册表↔目录**" → 新增能力忘登记，门照绿、CLI 却缺 |
  | **部分 GUI 深链** | 如 `solve` 的 `uiDeepLink:/admin/solvers/new`（可发现、执行跳 GUI） |

> 结论：不是"没 CLI",是"**覆盖未到每个功能 + 无机制保证不回潮**"。修法 = R16 能力环（自动派生 + 覆盖门）。

## 1. 设计（统一·不分服务侧）

### 1.1 `deriveOperationCatalog`（注册表 → 目录，确定性 R6）—— `contracts/operation-intent.ts`（扩）
从平台**能力注册表**确定性派生操作目录，取代/合并手维护数组：
- **求解器**：`SOLVER_KEYS`（32）→ 每 key 派生 `{op:"solve:<key>", endpoint:"/a/v1/solvers/<key>/invoke", cliCommand:"solve <key>", r4:false}`。
- **视图**：`FEATURE_REGISTRY` 的 `view.*` → `{op:"view:<key>", uiDeepLink:"/<route>", cliCommand:"scenarios"（经 launch/ask 可达）}`。
- **缺区（~10）**：新增显式 **`OPERATION_REGISTRY`**（`contracts/operation-registry.ts`）逐条登记：timeseries/clock/llm-provider/config-bundle/evals/meta/slice/lineage/oc-config/replay —— 每条 `{op, label, keywords, endpoint, requiredSlots, r4, cliCommand | uiDeepLink}`。
- **合并**：`deriveOperationCatalog() = 求解器派生 ⊕ 视图派生 ⊕ OPERATION_REGISTRY ⊕ 手写 override`（去重，确定性排序）→ 即新的 `OPERATION_CATALOG`（`classifyOperation` 消费它，零改）。

### 1.2 `cli-coverage:check` 门（注册表↔目录 parity）—— `scripts/check-cli-coverage.mjs`（新）
- 枚举**全能力**：`SOLVER_KEYS ∪ FEATURE_REGISTRY ∪ OPERATION_REGISTRY ∪ 对外端点清单`。
- 断言：每个能力在 `deriveOperationCatalog()` 输出里有 `cliCommand` 或 `uiDeepLink`，否则**红**。
- 棘轮基线 `scripts/cli-coverage-baseline.json` 防回潮；并入 `pnpm gates`。
- **与 `cli-parity:check` 分工**：parity 验"目录条目都可调"（目录↔CLI）；coverage 验"能力都进目录"（注册表↔目录）—— 两道合起来 = "每个功能 CLI 可达"闭环。

### 1.3 CLI 命令补全 —— `scripts/platform-cli.mjs`（run 表 :328 扩）
为缺区补子命令（`timeseries·clock·llm·config·evals·meta·slice·lineage·replay…`），薄客户端打对应公开 REST（OBO）；不宜内联的（复杂可视化）登记 `uiDeepLink`。

### 1.4（可选）GUI `do` 入口 —— 补反向洼地
前端 `CommandPalette`/`QueryDock` 接 `/b/v1/operations/classify`：QUERY 走对话坞、OPERATION 走 `uiDeepLink` 跳管理页 → 网页也能"一句话驱动任意操作"。

## 2. 契约（zod）

```ts
// contracts/operation-registry.ts（新，补缺区）
export const OperationRegistryEntrySchema = z.object({
  op: z.string(), label: z.string(), keywords: z.array(z.string()),
  endpoint: z.string(), requiredSlots: z.array(z.string()).default([]),
  r4: z.boolean().default(false),
  cliCommand: z.string().optional(), uiDeepLink: z.string().optional(),  // 二选一（cli-coverage:check 强制）
});
export const OPERATION_REGISTRY: z.infer<typeof OperationRegistryEntrySchema>[] = [ /* ~10 缺区 */ ];
// contracts/operation-intent.ts：OperationCatalogEntry += source: z.enum(["DERIVED","MANUAL"]).default("MANUAL")
// deriveOperationCatalog(): OperationCatalogEntry[]  // 求解器⊕视图⊕OPERATION_REGISTRY⊕override，确定性排序
```

## 3. 现有文件锚点（exact · 已 grep 核实）

| 文件 | 改 |
|---|---|
| `packages/contracts/src/operation-intent.ts:44` `OPERATION_CATALOG` | 改为 `deriveOperationCatalog()` 输出；`OperationCatalogEntry += source`；`classifyOperation:96` 零改 |
| `packages/contracts/src/operation-registry.ts`（新） | `OPERATION_REGISTRY` 补 ~10 缺区 |
| `apps/datacore/src/solvers/service.ts:14` `SOLVER_KEYS` | 只读消费（派生 solve op） |
| `apps/agentcore/src/features/registry.ts` `FEATURE_REGISTRY` | 只读消费（派生 view op） |
| `scripts/platform-cli.mjs:328` run 表 | 补缺区子命令 |
| `scripts/check-cli-coverage.mjs`（新）+ `cli-coverage-baseline.json`（新）+ `package.json "gates"` | 新覆盖门并入 |
| `apps/agentcore/src/server.ts:1701` `/b/v1/operations/classify` | 不改（已消费 catalog） |
| （可选）`apps/frontend-shell/src/components/ScenarioLauncher/CommandPalette.tsx` | 接 `/b/v1/operations/classify`（GUI do） |

## 4. 开发顺序 DF（依赖排序）

- **DF.1 缺区审计**（本 PRD §0 已起）：枚举 `SOLVER_KEYS ∪ FEATURE_REGISTRY ∪ 端点` − `OPERATION_CATALOG` = 精确缺口清单。**无代码。**
- **DF.2 `OPERATION_REGISTRY` + CLI 命令**：补 **20** 缺区条目（DF.1 审计实测，非估算 ~10；条目草案见**附录 B**，已并入本文）+ `platform-cli.mjs` 对应子命令（cliCommand 或 uiDeepLink）。**依赖 DF.1。验收见 §6 A3b——补完必重跑 classify 批量，0 误路由才算过。**
- **DF.3 `deriveOperationCatalog`**：求解器/视图/registry 自动派生 + 合并 override；`classifyOperation` 切到它。**依赖 DF.2。**
- **DF.4 `cli-coverage:check` 门**：注册表↔目录 parity + 基线 + 并入 gates。**依赖 DF.3。**
- **DF.5（可选）GUI `do`**：前端接 `operations/classify`。**依赖 DF.3。**
- 起手 **P0 = DF.1+DF.2**（把缺口补齐、立即可用），紧接 **DF.3+DF.4**（自动化 + 不回潮）。

## 5. 门禁 + 测试

- 新门 `cli-coverage:check`（`pnpm gates`）：任何注册能力无 CLI 命令/深链即红。
- 测试（确定性、无网络）：`derive-operation-catalog`（注册表→目录，同输入字节一致 R6 + solve/<key> 全 32 覆盖）· `cli-coverage`（缺区补全后 baseline 全绿；删一条 registry 命令→红）· `operation-registry`（每条有 cliCommand 或 uiDeepLink）。

## 6. 验收

- A1 `deriveOperationCatalog()` 输出覆盖 `SOLVER_KEYS`(32) 全部 + `FEATURE_REGISTRY` view 全部 + `OPERATION_REGISTRY` 缺区全部。
- A2 `pnpm cli-coverage:check` 绿；故意删一条 registry 对应 cliCommand → 红（证门有效）。
- A3 `platform do "<任一缺区自然语>"`（如"看常州时序"/"配 LLM provider"）→ 正确路由到对应操作或 uiDeepLink。
- **A3b（FDE 回归·关键）补 20 op 后必重跑《DF.1 验收痕迹》的 classify 批量**：对 10 缺区代表（配 LLM 供应商 / 配 MCP / 跑评测套件 / 看通知中心 / 配工厂日历 / 管理租户用户 / S&OP 月度平衡 / 看系统本体影响分析 / 跑 VLE 校验 / 本体切片规划）+ 其余，要求 **10/10 路由到正确新 op、0 误路由**（`meta`/`slice` 不再→`model`、`validate` 不再→`rule`、7 个 QUERY 项不再落问句）。**未过则调 `keywords` 重试**（关键词碰撞——如"本体"现把切片/影响分析拉向 model——必须靠词权调到新 op 胜出）。再亲手 `platform do "配 LLM 供应商"` 端到端复核一条真出结果。**保留通过后的 classify 批量为 `cli-routing` 回归测试（确定性 R6）。**
- A4 R6：同注册表 `deriveOperationCatalog()` 重跑字节一致。
- A5 四包 `pnpm -r build && test` 全绿 + `pnpm gates`（含新门）全过 + **回写本体 §5 R16/§7**（否则 `ontology:check`/`prd:check` 红）。

---

## 附录 · DF.1 缺区审计（精确清单 · grounded 2026-06-23 · read-only，无代码）

> **方法**：枚举 4 路由文件（`apps/datacore/src/app.ts` 265 · `adminplatform.ts` · `llmproviders.ts` · `apps/agentcore/src/server.ts` 115）全部 `app.{get,post,put,delete,patch}` 路由 → 按 `/服务/资源` 归域 → 与 `OPERATION_CATALOG` 端点 + CLI run 表命令 + 间接可达（`solve`/`ask`/`scenarios`）交叉。
> **规模**：**398 路由 · 93 资源域 · 22 已覆盖 · 71 原始未覆盖** → curate（去基础设施/只读噪声）后 **真功能缺口 ≈20 能力域 / ~190 端点无 CLI 路径**。

### A. 真功能缺口（需补 op）

| 能力域 | 端点 | 现状 | 建议 op |
|---|---|---|---|
| Workflow 编排 | `workflows` 11 | `agent` op 标称含但无独立命令 | `workflow` |
| Skill 技能 | `skills` 11 | 同上 | `skill` |
| MCP 配置/服务 | `mcp-configs` 12 + `mcp` 1 | 无 | `mcp` |
| Eval 套件 | `evals` 7 | 无 | `eval` |
| **LLM 供应商/用途绑定/预算** | `llm-providers` 7 + `llm` 5 + `llm-bindings` 2 + `llm-budgets` 3 = **17** | 无（**G-7**） | `llm` |
| 运营/调度/时钟/回放 | `ops` 11 + `scheduler` 4 + `sync-jobs` 1 = **16** | 无（含模拟时钟 tick/replay·A8） | `ops`/`clock` |
| 租户/用户/角色 IAM | `tenants` 10 + `users` 1 + `roles` 1 = **12** | 无 | `tenant`/`user` |
| 语义目录 | `catalog` 11 | 无（Part A 新建·已现端点） | `catalog` |
| 场景/视图配置 | `scene-entries` 4 + `scenario-packages` 3 + `view-configs` 4 + `scenes` 1 = **12** | `scenario` 仅 launch，无配置 CRUD | `scene-config` |
| 数据接入实例/分类/模版 | `connections` 7 + `data-categories` 4 + `raw-datasets` 3 + `data-templates` 2 + `uploads` 1 = **17** | `import` 仅上传 | `connection`/`data` |
| Meta/dogfooding 影响分析 | `meta` 8 | 无 | `meta` |
| 切片/切片规划器 | `slices` 6 | 无 | `slice` |
| 规则文档抽取（A2） | `rule-docs` 6 + `rule-candidates` 1 = 7 | `rule` 仅建规则 | `rule-extract` |
| S&OP 版本台 | `sop` 6 | 无（sop_balance 是工作流） | `sop` |
| OC 平台配置 | `prompt-templates` 3 + `calendars` 3 + `writeback-echoes` 2 = 8 | 无（OC5/6/9） | `platform-config` |
| 校验/VLE | `validation` 3 | 无 | `validate` |
| 指标/SPINE | `metrics` 3 + `ksf` 1 + `principals` 1 = 5 | 读经 ask 部分可达 | `metric` |
| 通知中心 | `notifications` 3 | 无 | `notify` |
| 配置迁移 ConfigBundle | `config-bundles` 2 | 无（OC3） | `config-bundle` |
| 生成边界 GenerationBoundary | `boundary` 2 | 无（Part A 新·已现端点） | `boundary` |

→ **约 20 能力域 / ~190 端点无 CLI 路径。** 其中 G-7(LLM 绑定)、ops/clock(A8) 是 §0 已点的；新发现大块：workflows/skills/mcp/tenants/scene-config/connections。

### B. 只读/元数据（可选 CLI 查询·低优先·不阻断）
`lineage · derivations · inference · history · plan/aop · plan-versions · data-health · field-coverage · entity-catalog · references · industry-templates · action-types · authz/explain · business-domains` —— 多为读/元数据，经 `ask`/`types` 间接可达，补查询命令是 nice-to-have。

### C. 排除（非用户功能·基础设施）
`healthz · readyz · .well-known · internal · exec-locks · epoch · webhooks · event-subscriptions · perception · capability-inventory · connector-types/categories · outbox`。

### 结论（喂 DF.2/DF.3）
- 缺口集中在：**LLM 绑定(G-7) · workflow · skill · mcp · tenant/user · ops/clock(A8) · scene-config · connection · meta · slice · sop · eval · rule-extract · OC 平台配置 · validation · config-bundle · boundary · catalog**。
- **手补 20 op 易再漏 → DF.3 `deriveOperationCatalog`（从注册表自动派生）+ DF.4 `cli-coverage:check` 才是根治**。本审计即"目录手维护漏一大片（71/93 域未覆盖）"的实证。

---

## DF.1 验收痕迹（实跑证据 · 2026-06-24 · FDE 亲手验收 · read-only）

> 按 FDE 纪律"完成=亲手用一遍"，对 DF.1 缺口做**负向验证**：`vigilant-knuth` 真后端（datacore:4001 + agentcore:4002，memory/seed/Kimi `kimi-k2.5`）+ 真 CLI（`scripts/platform-cli.mjs`），**未改任何 source**（git clean，仅 build dist[gitignored] + 跑进程 + 还原 pnpm-lock）。证明这 20 类缺口现在**路由不到/误路由**。

### 亲手 `platform do`
| 输入 | 结果 | 判定 |
|---|---|---|
| `看有哪些场景` | 判为操作型 `scenario` → `/b/v1/scenarios` | ✓ 现有能力路由对 |
| `新建一个工作流编排` | 判为操作型 `agent` → `/b/v1/agents` | ◐ 误路由（工作流→agent 端点） |
| `配置 LLM 供应商 kimi` | 判为 QUERY → 送 Kimi `ask` 当问句 → 超时 Terminated | ❌ 配置请求被当问题答 |
| `把常州库存导进来` | 同上 Terminated | ❌ |

### `classifyOperation` 批量（确定性·瞬时·R6 可复现）
**现有 5（应对，全对）**：导入csv→`import`✓ · 建规则→`rule`✓ · 跑合成→`synth`✓ · 看对象类型→`model`✓ · 审批草稿→`approve`✓

**20 缺区代表 10（应路由不到对应新模块）**：

| 输入 | classify | 判定 |
|---|---|---|
| 配置 LLM 供应商 | QUERY / 无 op | ❌ 落问句 |
| 配 MCP 工具服务 | QUERY / 无 op | ❌ |
| 跑评测套件 | QUERY / 无 op | ❌ |
| 看通知中心 | QUERY / 无 op | ❌ |
| 配工厂日历 | QUERY / 无 op | ❌ |
| 管理租户用户角色 | QUERY / 无 op | ❌ |
| S&OP 月度平衡版本 | QUERY / 无 op | ❌ |
| 看系统本体影响分析 | OPERATION `model` | ◐ 误路由→错模块 |
| 跑 VLE 校验 | OPERATION `rule` | ◐ 误路由→rule |
| 本体切片规划 | OPERATION `model` | ◐ 误路由→model |

### 实跑结论（DF.1 验收）
- **7/10** 缺区 → 落 `QUERY`（无 op）→ 被当**业务问句**送进 QOS/Kimi（就是上面 `platform do` 挂超时的真相：配 LLM 供应商被当问题"回答"）。
- **3/10** → **误路由到错的现有 op**（影响分析/切片→`model`、VLE→`rule`）→ **会去执行错误操作**（调 modeling/rules 端点）。缺口实为"**做错事**"，非"做不了"。
- **0/10** 路由到正确新模块。**DF.1 审计的 20 缺口被真系统逐条证实。**
- ⚠️ **FDE 边界**：本痕迹是**负向验证（证问题真实）**，**非**验证修复——20 op 未建。"CLI 全覆盖"真完成判据 = DF.2 补 op 后**再亲手敲** `platform do "配 LLM 供应商"` 路由到 `/a/v1/llm-providers` 并真出结果。

---

## 附录 B · OPERATION_REGISTRY 20 条草案（DF.2 数据 · 端点取自 DF.1 审计实测）

> DF.2 的具体内容 = 填满 §2 契约里 `OPERATION_REGISTRY = [/* 缺区 */]` 占位。**纯数据，无执行代码**；实现 agent 转抄进 `packages/contracts/src/operation-registry.ts`。`r4` 仅 `sop`(定稿走 Action)/`boundary`(DRAFT→PUBLISH 经审批) 为 true。补完**必过 §6 A3b**（重跑 classify，0 误路由）。

### B.1 可直接转抄的条目
```ts
export const OperationRegistryEntrySchema = z.object({
  op: z.string(), label: z.string(), keywords: z.array(z.string()),
  endpoint: z.string(), requiredSlots: z.array(z.string()).default([]),
  r4: z.boolean().default(false),
  cliCommand: z.string().optional(), uiDeepLink: z.string().optional(),  // 至少其一（cli-coverage:check 强制）
});
export const OPERATION_REGISTRY: z.infer<typeof OperationRegistryEntrySchema>[] = [
  { op: "workflow",        label: "工作流编排·建/发布/列",            keywords: ["工作流","编排","workflow","流程","步骤"],                          endpoint: "/b/v1/workflows",        requiredSlots: [],    r4: false, cliCommand: "workflow" },
  { op: "skill",           label: "技能·建/绑定/列",                  keywords: ["技能","skill","能力句","解读"],                                   endpoint: "/b/v1/skills",           requiredSlots: [],    r4: false, cliCommand: "skill" },
  { op: "mcp",             label: "MCP·服务/工具配置",                keywords: ["mcp","外部工具","工具服务","server","tool"],                      endpoint: "/b/v1/mcp-configs",      requiredSlots: [],    r4: false, cliCommand: "mcp" },
  { op: "eval",            label: "评测套件·跑/历史/parity",          keywords: ["评测","eval","用例","套件","回归","parity"],                       endpoint: "/b/v1/evals",            requiredSlots: [],    r4: false, cliCommand: "eval" },
  { op: "llm",             label: "LLM 供应商/用途绑定/预算",         keywords: ["llm","供应商","provider","模型","绑定","binding","预算","budget"], endpoint: "/a/v1/llm-providers",    requiredSlots: [],    r4: false, cliCommand: "llm" },
  { op: "ops",             label: "运营/调度/模拟时钟/回放",          keywords: ["运营","调度","scheduler","时钟","tick","回放","replay","persona"], endpoint: "/a/v1/scheduler/jobs",   requiredSlots: [],    r4: false, cliCommand: "ops" },
  { op: "tenant",          label: "租户/用户/角色 IAM",               keywords: ["租户","tenant","用户","user","角色","role","账号"],                endpoint: "/a/v1/tenants",          requiredSlots: [],    r4: false, cliCommand: "tenant", uiDeepLink: "/admin/tenants" },
  { op: "catalog",         label: "语义目录·检索（schema-linking）",   keywords: ["目录","catalog","检索","schema","找列","找表","描述"],             endpoint: "/a/v1/catalog/search",   requiredSlots: ["q"], r4: false, cliCommand: "catalog" },
  { op: "scene-config",    label: "场景/视图配置·入口/包/视图",        keywords: ["场景配置","视图配置","scene","入口","包","view-config"],           endpoint: "/b/v1/scene-entries",    requiredSlots: [],    r4: false, cliCommand: "scene-config", uiDeepLink: "/admin/scenes" },
  { op: "connection",      label: "连接器实例·校验策略/分类/模版",     keywords: ["连接器实例","连接","connection","校验策略","数据分类","模版"],      endpoint: "/a/v1/connections",      requiredSlots: [],    r4: false, cliCommand: "connection" },
  { op: "meta",            label: "系统自我本体·同步/影响分析",        keywords: ["meta","系统本体","元本体","影响分析","dogfooding","impact"],       endpoint: "/a/v1/meta/sync",        requiredSlots: [],    r4: false, cliCommand: "meta" },
  { op: "slice",           label: "本体切片·规划/库/索引",            keywords: ["切片","slice","路径","子图","规划器"],                            endpoint: "/a/v1/slices",           requiredSlots: [],    r4: false, cliCommand: "slice" },
  { op: "rule-extract",    label: "规则文档抽取·上传/候选审核",        keywords: ["规则抽取","规则文档","ruledoc","抽取","候选","审核规则"],          endpoint: "/a/v1/rule-docs",        requiredSlots: [],    r4: false, cliCommand: "rule-extract" },
  { op: "sop",             label: "S&OP 月度平衡·版本/定稿",          keywords: ["sop","产销平衡","月度平衡","版本","定稿","五步法"],                endpoint: "/a/v1/sop/versions",     requiredSlots: [],    r4: true,  cliCommand: "sop" },
  { op: "platform-config", label: "平台配置·提示词/工厂日历/写回回声", keywords: ["平台配置","提示词","prompt","日历","calendar","写回","writeback"], endpoint: "/a/v1/prompt-templates", requiredSlots: [],    r4: false, cliCommand: "platform-config" },
  { op: "validate",        label: "校验/VLE·跑验证",                  keywords: ["校验","validation","vle","验证","查全查准","参照"],                endpoint: "/a/v1/validation/runs",  requiredSlots: [],    r4: false, cliCommand: "validate" },
  { op: "metric",          label: "经营指标/KSF/责任主体（SPINE）",    keywords: ["指标","metric","ksf","责任主体","principal","达成"],               endpoint: "/a/v1/metrics",          requiredSlots: [],    r4: false, cliCommand: "metric", uiDeepLink: "/admin/metrics" },
  { op: "notify",          label: "通知中心·列/已读",                 keywords: ["通知","notification","消息","收件箱","提醒"],                      endpoint: "/a/v1/notifications",    requiredSlots: [],    r4: false, cliCommand: "notify" },
  { op: "config-bundle",   label: "配置迁移·导出/导入（环境间 Saga）", keywords: ["配置迁移","config bundle","导出配置","导入配置","环境迁移","saga"], endpoint: "/a/v1/config-bundles",   requiredSlots: [],    r4: false, cliCommand: "config-bundle" },
  { op: "boundary",        label: "生成边界·词表/影响/发布",          keywords: ["生成边界","boundary","业务词表","边界","接地","发布边界"],         endpoint: "/a/v1/boundary",         requiredSlots: [],    r4: true,  cliCommand: "boundary" },
];
```

### B.2 速览表

| # | op | 能力域 | endpoint | r4 | cliCommand | uiDeepLink |
|---|---|---|---|---|---|---|
| 1 | `workflow` | 工作流编排 | `/b/v1/workflows` | – | `workflow` | |
| 2 | `skill` | 技能 | `/b/v1/skills` | – | `skill` | |
| 3 | `mcp` | MCP 配置 | `/b/v1/mcp-configs` | – | `mcp` | |
| 4 | `eval` | 评测套件 | `/b/v1/evals` | – | `eval` | |
| 5 | `llm` | LLM 供应商/绑定/预算 (G-7) | `/a/v1/llm-providers` | – | `llm` | |
| 6 | `ops` | 运营/调度/时钟/回放 (A8) | `/a/v1/scheduler/jobs` | – | `ops` | |
| 7 | `tenant` | 租户/用户/角色 IAM | `/a/v1/tenants` | – | `tenant` | `/admin/tenants` |
| 8 | `catalog` | 语义目录检索 | `/a/v1/catalog/search` | – | `catalog` | |
| 9 | `scene-config` | 场景/视图配置 | `/b/v1/scene-entries` | – | `scene-config` | `/admin/scenes` |
| 10 | `connection` | 连接器实例/分类/模版 | `/a/v1/connections` | – | `connection` | |
| 11 | `meta` | 系统自我本体/影响分析 | `/a/v1/meta/sync` | – | `meta` | |
| 12 | `slice` | 本体切片/规划器 | `/a/v1/slices` | – | `slice` | |
| 13 | `rule-extract` | 规则文档抽取 (A2) | `/a/v1/rule-docs` | – | `rule-extract` | |
| 14 | `sop` | S&OP 月度平衡 | `/a/v1/sop/versions` | **✓** | `sop` | |
| 15 | `platform-config` | 提示词/日历/写回回声 (OC5/6/9) | `/a/v1/prompt-templates` | – | `platform-config` | |
| 16 | `validate` | 校验/VLE | `/a/v1/validation/runs` | – | `validate` | |
| 17 | `metric` | 指标/KSF/责任主体 (SPINE) | `/a/v1/metrics` | – | `metric` | `/admin/metrics` |
| 18 | `notify` | 通知中心 | `/a/v1/notifications` | – | `notify` | |
| 19 | `config-bundle` | 配置迁移 (OC3) | `/a/v1/config-bundles` | – | `config-bundle` | |
| 20 | `boundary` | 生成边界 GenerationBoundary | `/a/v1/boundary` | **✓** | `boundary` | |

### B.3 说明（给实现 agent）
- 这 20 是**非 solver/非 view 缺区**——求解器（`SOLVER_KEYS`→`solve <key>`）/视图（`FEATURE_REGISTRY`→`scenarios`/`ask`）由 DF.3 `deriveOperationCatalog` **自动派生**，不在表内。
- **多资源归一**：`llm`=providers+bindings+budgets · `ops`=ops+scheduler+sync-jobs · `tenant`=tenants+users+roles · `connection`=connections+data-categories+raw-datasets+data-templates · `scene-config`=scene-entries+scenario-packages+view-configs+scenes · `platform-config`=prompt-templates+calendars+writeback-echoes。子动作由 `cliCommand` 参数/子命令分发。
- **`requiredSlots`** 默认 list/get 故多为 `[]`；`catalog` 需 `q`。
- 落 DF.2 后**必跑 §6 A3b**（重跑 classify 批量，0 误路由——`meta`/`slice` 不再→`model`、`validate` 不再→`rule`），否则调 keywords。
- **落地前再 grep 核对端点**（并发分支在动，资源名/路由会漂）。

---

> 状态：**v1.0 DRAFT，待评审**。grounded 于本体 v1.0。本文**自包含**（设计 + DF.1 审计 + FDE 验收痕迹 + DF.2 验收 + 附录 B 20 条数据）。核心 = CLI 已在，补"操作目录自动派生 + 注册表覆盖门"使**每个功能 CLI 可达且不回潮**（落实 R16 能力环）。只定义设计，落地听指示。
